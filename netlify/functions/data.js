const { sql, json, parseJson, getUserById, canAccess, ensureSupportTables, tableExists } = require('./_db')
const { wrapHttp } = require('./_netlify')

function normalizeReviewBucket(status) {
  if (status === 'concluido') return 'concluidos'
  if (status === 'recusado') return 'nao_aceitos'
  if (status === 'aceito') return 'aceitos'
  if (status === 'em_andamento' || status === 'em_avaliacao') return 'em_avaliacao'
  return 'outros'
}

const CHIEF_ALLOWED_SUBMISSION_STATUSES = ['submetido', 'em_avaliacao', 'rejeitado', 'aceito_com_correcoes', 'correcoes_necessarias', 'aceito']

async function maybeRows(table, queryFn, fallback = []) {
  if (!(await tableExists(table))) return fallback
  return queryFn()
}

async function getTableColumns(tableName) {
  const rows = await sql`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${tableName}`
  return new Set((rows || []).map((row) => row.column_name))
}

async function getChiefSubmissionStatusQueue() {
  const rows = await sql`
    SELECT s.id, s.titulo, s.status, s.secao, s.data_submissao, s.status_atualizado_em, s.status_atualizado_por,
           a.nome AS autor_nome, dt.titulo AS dossie_titulo, u.nome AS atualizado_por_nome
    FROM submissoes s
    LEFT JOIN usuarios a ON a.id = s.autor_id
    LEFT JOIN dossies_tematicos dt ON dt.id = s.dossie_id
    LEFT JOIN usuarios u ON u.id = s.status_atualizado_por
    ORDER BY s.data_submissao DESC, s.id DESC`
  return { items: rows, statuses: CHIEF_ALLOWED_SUBMISSION_STATUSES }
}

async function updateChiefSubmissionStatus(payload, user) {
  if (!canAccess(user, ['editor_chefe'])) throw new Error('Acesso negado.')
  const submissaoId = Number(payload.submissaoId)
  const novoStatus = String(payload.status || '').trim()
  const observacao = String(payload.observacao || '').trim() || null
  if (!submissaoId || !novoStatus) throw new Error('Submissão ou status não informado.')
  if (!CHIEF_ALLOWED_SUBMISSION_STATUSES.includes(novoStatus)) throw new Error('Status inválido.')

  const atual = await sql`SELECT id, status FROM submissoes WHERE id = ${submissaoId} LIMIT 1`
  if (!atual.length) throw new Error('Submissão não encontrada.')

  await sql`UPDATE submissoes SET status = ${novoStatus}, status_atualizado_em = CURRENT_TIMESTAMP, status_atualizado_por = ${user.id} WHERE id = ${submissaoId}`
  if (await tableExists('historico_status_submissoes')) {
    await sql`INSERT INTO historico_status_submissoes (submissao_id, status_anterior, status_novo, observacao, atualizado_por) VALUES (${submissaoId}, ${atual[0].status}, ${novoStatus}, ${observacao}, ${user.id})`
  }
  return { ok: true, submissaoId, status: novoStatus, statusAnterior: atual[0].status }
}

async function getReviewerListForHistory(user) {
  if (!canAccess(user, ['editor_chefe', 'editor', 'editor_adjunto'])) throw new Error('Acesso negado.')
  const rows = await sql`
    SELECT DISTINCT u.id, u.nome, u.email
    FROM usuarios u
    JOIN designacoes_avaliacao da ON da.parecerista_id = u.id
    WHERE u.perfil = 'parecerista' AND COALESCE(u.status, 'ativo') = 'ativo'
    ORDER BY u.nome ASC`
  return { items: rows }
}

async function getEditorialQueue() {
  if (await tableExists('vw_fila_decisao_editorial')) {
    const rows = await sql`SELECT * FROM vw_fila_decisao_editorial`
    return { items: rows }
  }
  return { items: [] }
}

async function decidirParecer(payload) {
  const { designacaoId, decisao, observacao, editorId } = payload
  if (!(await tableExists('designacoes_avaliacao'))) return { ok: false }
  if (await tableExists('registrar_decisao_editorial_parecer')) {
    await sql`SELECT registrar_decisao_editorial_parecer(${Number(designacaoId)}, ${Number(editorId)}, ${decisao}, ${observacao || ''})`
    return { ok: true }
  }
  return { ok: false }
}

async function updateDesignacaoStatus(payload, user) {
  const id = Number(payload.designacaoId)
  const status = String(payload.status || '')
  if (!id || !status) return { erro: 'Designação ou status não informados.', code: 400 }
  if (!canAccess(user, ['parecerista', 'editor_adjunto', 'editor_chefe'])) return { erro: 'Acesso negado.', code: 403 }

  if (user.perfil === 'parecerista') {
    const rows = await sql`UPDATE designacoes_avaliacao SET status = ${status}, atualizado_em = CURRENT_TIMESTAMP WHERE id = ${id} AND parecerista_id = ${user.id} RETURNING id, status`
    if (!rows.length) return { erro: 'Designação não encontrada.', code: 404 }
    return { ok: true, item: rows[0] }
  }

  const rows = await sql`UPDATE designacoes_avaliacao SET status = ${status}, atualizado_em = CURRENT_TIMESTAMP WHERE id = ${id} RETURNING id, status`
  if (!rows.length) return { erro: 'Designação não encontrada.', code: 404 }
  return { ok: true, item: rows[0] }
}

async function getReviewerReviewHistory(user, reviewerId) {
  if (!reviewerId) throw new Error('Parecerista não informado.')
  if (!canAccess(user, ['editor_chefe', 'editor', 'editor_adjunto'])) throw new Error('Acesso negado.')

  const allowedReviewer = await sql`
    SELECT id, nome, email, instituicao, foto_perfil_url, foto_perfil_aprovada, consentimento_foto_publica
    FROM usuarios
    WHERE id = ${reviewerId} AND perfil = 'parecerista' AND COALESCE(status, 'ativo') = 'ativo'
    LIMIT 1`

  const reviewer = allowedReviewer[0]
  if (!reviewer) {
    return { parecerista: null, resumo: { total: 0, em_avaliacao: 0, concluidos: 0, nao_aceitos: 0, aceitos: 0 }, avaliacoes: [] }
  }

  const hasAvaliacoes = await tableExists('avaliacoes')
  const hasAvaliacoesV2 = await tableExists('avaliacoes_v2')

  let rows = []
  if (hasAvaliacoes || hasAvaliacoesV2) {
    rows = await sql`
      SELECT
        da.id AS designacao_id,
        da.status AS designacao_status,
        da.criado_em AS designado_em,
        da.prazo_parecer,
        da.dias_adicionais,
        s.id AS submissao_id,
        s.titulo,
        s.secao,
        s.status AS submissao_status,
        a.nome AS autor_nome,
        ${hasAvaliacoesV2 ? sql`av2.parecer_final` : sql`NULL`} AS parecer_final_v2,
        ${hasAvaliacoes ? sql`av.parecer_final` : sql`NULL`} AS parecer_final_v1,
        ${hasAvaliacoesV2 ? sql`av2.tempo_avaliacao` : sql`NULL`} AS tempo_avaliacao_v2,
        ${hasAvaliacoes ? sql`av.tempo_avaliacao` : sql`NULL`} AS tempo_avaliacao_v1,
        ${hasAvaliacoesV2 ? sql`av2.comentario_autor` : sql`NULL`} AS comentario_autor_v2,
        ${hasAvaliacoes ? sql`av.comentario_autor` : sql`NULL`} AS comentario_autor_v1,
        ${hasAvaliacoesV2 ? sql`av2.comentario_editor` : sql`NULL`} AS comentario_editor_v2,
        ${hasAvaliacoes ? sql`av.comentario_editor` : sql`NULL`} AS comentario_editor_v1,
        ${hasAvaliacoesV2 ? sql`COALESCE(av2.devolutiva_doc_url, av2.devolutiva_url)` : sql`NULL`} AS devolutiva_v2,
        ${hasAvaliacoes ? sql`COALESCE(av.devolutiva_doc_url, av.devolutiva_url)` : sql`NULL`} AS devolutiva_v1,
        ${hasAvaliacoesV2 ? sql`av2.atualizado_em` : sql`NULL`} AS atualizado_v2,
        ${hasAvaliacoes ? sql`av.atualizado_em` : sql`NULL`} AS atualizado_v1,
        da.atualizado_em,
        da.criado_em
      FROM designacoes_avaliacao da
      JOIN submissoes s ON s.id = da.submissao_id
      LEFT JOIN usuarios a ON a.id = s.autor_id
      ${hasAvaliacoesV2 ? sql`LEFT JOIN avaliacoes_v2 av2 ON av2.designacao_id = da.id` : sql``}
      ${hasAvaliacoes ? sql`LEFT JOIN avaliacoes av ON av.designacao_id = da.id` : sql``}
      WHERE da.parecerista_id = ${reviewerId}
      ORDER BY da.criado_em DESC, da.id DESC`
  } else {
    rows = await sql`
      SELECT da.id AS designacao_id, da.status AS designacao_status, da.criado_em AS designado_em, da.prazo_parecer,
             da.dias_adicionais, s.id AS submissao_id, s.titulo, s.secao, s.status AS submissao_status,
             a.nome AS autor_nome, NULL AS parecer_final_v2, NULL AS parecer_final_v1, NULL AS tempo_avaliacao_v2,
             NULL AS tempo_avaliacao_v1, NULL AS comentario_autor_v2, NULL AS comentario_autor_v1,
             NULL AS comentario_editor_v2, NULL AS comentario_editor_v1, NULL AS devolutiva_v2, NULL AS devolutiva_v1,
             NULL AS atualizado_v2, NULL AS atualizado_v1, da.atualizado_em, da.criado_em
      FROM designacoes_avaliacao da
      JOIN submissoes s ON s.id = da.submissao_id
      LEFT JOIN usuarios a ON a.id = s.autor_id
      WHERE da.parecerista_id = ${reviewerId}
      ORDER BY da.criado_em DESC, da.id DESC`
  }

  const resumo = { total: rows.length, em_avaliacao: 0, concluidos: 0, nao_aceitos: 0, aceitos: 0 }
  const avaliacoes = rows.map((row) => {
    const bucket = normalizeReviewBucket(row.designacao_status)
    if (bucket === 'em_avaliacao') resumo.em_avaliacao += 1
    if (bucket === 'concluidos') resumo.concluidos += 1
    if (bucket === 'nao_aceitos') resumo.nao_aceitos += 1
    if (bucket === 'aceitos') resumo.aceitos += 1
    const parecer_final = row.parecer_final_v2 || row.parecer_final_v1 || null
    const tempo_avaliacao = row.tempo_avaliacao_v2 || row.tempo_avaliacao_v1 || null
    const comentario_autor = row.comentario_autor_v2 || row.comentario_autor_v1 || null
    const comentario_editor = row.comentario_editor_v2 || row.comentario_editor_v1 || null
    const devolutiva_url = row.devolutiva_v2 || row.devolutiva_v1 || null
    const atualizado_em = row.atualizado_v2 || row.atualizado_v1 || row.atualizado_em || row.criado_em || null
    return {
      ...row,
      bucket,
      parecer_final,
      tempo_avaliacao,
      comentario_autor,
      comentario_editor,
      devolutiva_url,
      tem_parecer: !!(parecer_final || comentario_autor || comentario_editor || devolutiva_url),
      atualizado_em_formatado: atualizado_em ? new Date(atualizado_em).toLocaleString('pt-BR') : '',
      prazo_parecer_formatado: row.prazo_parecer ? new Date(row.prazo_parecer).toLocaleDateString('pt-BR') : ''
    }
  })

  return { parecerista: reviewer, resumo, avaliacoes }
}

async function getArquivoPrincipalPorSubmissaoIds(ids) {
  if (!ids.length) return new Map()
  const hasArquivosPublicacao = await tableExists('arquivos_publicacao')
  if (!hasArquivosPublicacao) return new Map()

  const rows = await sql`
    SELECT DISTINCT ON (submissao_id) submissao_id, url_acesso, nome_original
    FROM arquivos_publicacao
    WHERE submissao_id = ANY(${ids})
      AND categoria IN ('principal', 'manuscrito')
    ORDER BY submissao_id, id DESC`

  return new Map(rows.map((r) => [Number(r.submissao_id), { url_arquivo: r.url_acesso, nome_arquivo: r.nome_original }]))
}

const main = async (req) => {
  try {
    await ensureSupportTables()
    if (req.method !== 'POST') return json({ erro: 'Método não permitido.' }, 405)

    const body = await parseJson(req)
    const { action, userId, targetUserId, pareceristaId } = body
    const user = await getUserById(Number(userId))
    if (!user) return json({ erro: 'Usuário não encontrado.' }, 404)

    if (action === 'me') return json({ sucesso: true, usuario: user })

    // ========== AÇÕES EXISTENTES ==========
    if (action === 'author_dashboard') {
      if (!canAccess(user, ['autor'])) return json({ erro: 'Acesso negado.' }, 403)
      // ... (mantenha o código original)
    }

    if (action === 'chief_submission_status_queue') {
      if (!canAccess(user, ['editor_chefe'])) return json({ erro: 'Acesso negado.' }, 403)
      return json({ sucesso: true, ...(await getChiefSubmissionStatusQueue()) })
    }

    if (action === 'chief_update_submission_status') {
      if (!canAccess(user, ['editor_chefe'])) return json({ erro: 'Acesso negado.' }, 403)
      return json({ sucesso: true, ...(await updateChiefSubmissionStatus(body, user)) })
    }

    if (action === 'reviewer_dashboard') {
      if (!canAccess(user, ['parecerista'])) return json({ erro: 'Acesso negado.' }, 403)
      // ... (mantenha o código original)
    }

    if (action === 'editor_dashboard') {
      if (!canAccess(user, ['editor', 'editor_adjunto'])) return json({ erro: 'Acesso negado.' }, 403)
      // ... (mantenha o código original)
    }

    if (action === 'chief_dashboard') {
      if (!canAccess(user, ['editor_chefe'])) return json({ erro: 'Acesso negado.' }, 403)
      // ... (mantenha o código original)
    }

    if (action === 'reviewer_list_for_history') {
      if (!canAccess(user, ['editor_chefe', 'editor', 'editor_adjunto'])) return json({ erro: 'Acesso negado.' }, 403)
      return json({ sucesso: true, ...(await getReviewerListForHistory(user)) })
    }

    if (action === 'reviewer_review_history') {
      if (!canAccess(user, ['editor_chefe', 'editor', 'editor_adjunto'])) return json({ erro: 'Acesso negado.' }, 403)
      const reviewerId = Number(pareceristaId || targetUserId || body?.pareceristaId || body?.id)
      if (!reviewerId) return json({ erro: 'Parecerista não informado.' }, 400)
      return json({ sucesso: true, usuario: user, ...(await getReviewerReviewHistory(user, reviewerId)) })
    }

    if (action === 'editorial_review_queue') {
      if (!canAccess(user, ['editor_chefe', 'editor', 'editor_adjunto'])) return json({ erro: 'Acesso negado.' }, 403)
      return json({ sucesso: true, ...(await getEditorialQueue()) })
    }

    if (action === 'editorial_review_decision') {
      if (!canAccess(user, ['editor_chefe', 'editor', 'editor_adjunto'])) return json({ erro: 'Acesso negado.' }, 403)
      return json({ sucesso: true, ...(await decidirParecer({ ...body, editorId: user.id })) })
    }

    if (action === 'update_designacao_status') {
      const result = await updateDesignacaoStatus(body, user)
      if (result?.erro) return json({ erro: result.erro }, result.code || 400)
      return json({ sucesso: true, ...result })
    }

    if (action === 'public_dossiers') {
      // ... (mantenha o código original)
    }

    if (action === 'online_users') {
      // ... (mantenha o código original)
    }

    if (action === 'chat_recipients') {
      // ... (mantenha o código original)
    }

    if (action === 'chat_messages') {
      // ... (mantenha o código original)
    }

    if (action === 'certificates') {
      // ... (mantenha o código original)
    }

    // ========== NOVAS AÇÕES DE NOTIFICAÇÃO ==========
    if (action === 'notificacoes') { const { limit = 20, offset = 0, apenasNaoLidas = false } = body; let query = sql` SELECT n.*, u.nome AS remetente_nome, u.foto_perfil_url AS remetente_foto FROM notificacoes n LEFT JOIN usuarios u ON u.id = n.remetente_id WHERE n.usuario_id = ${user.id} `; if (apenasNaoLidas) query = sql`${query} AND n.lida = FALSE`; query = sql`${query} ORDER BY n.criado_em DESC LIMIT ${limit} OFFSET ${offset}`; const notificacoes = await query; const naoLidasResult = await sql`SELECT COUNT(*) FROM notificacoes WHERE usuario_id = ${user.id} AND lida = FALSE`; const naoLidas = parseInt(naoLidasResult[0].count); return json({ sucesso: true, notificacoes, naoLidas }); }

    if (action === 'marcar_notificacao_lida') {
      const { notificacaoId } = body
      if (!notificacaoId) return json({ erro: 'ID da notificação não informado.' }, 400)
      await sql`UPDATE notificacoes SET lida = TRUE WHERE id = ${notificacaoId} AND usuario_id = ${user.id}`
      return json({ sucesso: true })
    }

    if (action === 'marcar_todas_lidas') {
      await sql`UPDATE notificacoes SET lida = TRUE WHERE usuario_id = ${user.id}`
      return json({ sucesso: true })
    }

    // ========== AÇÃO update_profile (caso ainda não exista) ==========
    if (action === 'update_profile') {
      const { nome, instituicao, orcid, lattes, origem, telefone, receber_noticias_email, avatarUrl } = body
      if (avatarUrl) {
        await sql`
          UPDATE usuarios
          SET foto_perfil_url = ${avatarUrl},
              atualizado_em = CURRENT_TIMESTAMP
          WHERE id = ${user.id}
        `
        const refreshed = await getUserById(user.id)
        return json({ sucesso: true, usuario: refreshed })
      }
      await sql`
        UPDATE usuarios
        SET nome = COALESCE(${nome || null}, nome),
            instituicao = ${instituicao || null},
            orcid = ${orcid || null},
            lattes = ${lattes || null},
            origem = ${origem || null},
            telefone = ${telefone || null},
            receber_noticias_email = ${!!receber_noticias_email},
            atualizado_em = CURRENT_TIMESTAMP
        WHERE id = ${user.id}
      `
      const refreshed = await getUserById(user.id)
      return json({ sucesso: true, usuario: refreshed })
    }

    return json({ erro: 'Ação inválida.' }, 400)
  } catch (erro) {
    console.error('Erro em data.js:', erro)
    return json({ erro: 'Erro ao carregar dados.', detalhe: erro.message }, 500)
  }
}

exports.handler = wrapHttp(main)