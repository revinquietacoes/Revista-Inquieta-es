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

    if (action === 'author_dashboard') {
      if (!canAccess(user, ['autor'])) return json({ erro: 'Acesso negado.' }, 403)
      const submissaoCols = await getTableColumns('submissoes')
      const hasEditorAdjuntoSub = submissaoCols.has('editor_adjunto_id')
      const hasEditorResponsavelSub = submissaoCols.has('editor_responsavel_id')
      const submissoes = hasEditorAdjuntoSub && hasEditorResponsavelSub
        ? await sql`
            SELECT s.id, s.titulo, s.secao, s.status, s.data_submissao, s.prazo_final_avaliacao,
                   dt.titulo AS dossie_titulo, u.nome AS editor_nome
            FROM submissoes s
            LEFT JOIN dossies_tematicos dt ON dt.id = s.dossie_id
            LEFT JOIN usuarios u ON u.id = COALESCE(s.editor_adjunto_id, s.editor_responsavel_id)
            WHERE s.autor_id = ${user.id}
            ORDER BY s.data_submissao DESC`
        : hasEditorAdjuntoSub
          ? await sql`
              SELECT s.id, s.titulo, s.secao, s.status, s.data_submissao, s.prazo_final_avaliacao,
                     dt.titulo AS dossie_titulo, u.nome AS editor_nome
              FROM submissoes s
              LEFT JOIN dossies_tematicos dt ON dt.id = s.dossie_id
              LEFT JOIN usuarios u ON u.id = s.editor_adjunto_id
              WHERE s.autor_id = ${user.id}
              ORDER BY s.data_submissao DESC`
          : hasEditorResponsavelSub
            ? await sql`
                SELECT s.id, s.titulo, s.secao, s.status, s.data_submissao, s.prazo_final_avaliacao,
                       dt.titulo AS dossie_titulo, u.nome AS editor_nome
                FROM submissoes s
                LEFT JOIN dossies_tematicos dt ON dt.id = s.dossie_id
                LEFT JOIN usuarios u ON u.id = s.editor_responsavel_id
                WHERE s.autor_id = ${user.id}
                ORDER BY s.data_submissao DESC`
            : await sql`
                SELECT s.id, s.titulo, s.secao, s.status, s.data_submissao, s.prazo_final_avaliacao,
                       dt.titulo AS dossie_titulo, NULL::TEXT AS editor_nome
                FROM submissoes s
                LEFT JOIN dossies_tematicos dt ON dt.id = s.dossie_id
                WHERE s.autor_id = ${user.id}
                ORDER BY s.data_submissao DESC`
      return json({ sucesso: true, usuario: user, submissoes })
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
      const avaliacoes = await sql`
        SELECT da.id, da.status, da.prazo_parecer, da.dias_adicionais,
               s.id AS submissao_id, s.titulo, s.resumo, s.palavras_chave, s.secao
        FROM designacoes_avaliacao da
        JOIN submissoes s ON s.id = da.submissao_id
        WHERE da.parecerista_id = ${user.id}
        ORDER BY da.criado_em DESC`
      const fileMap = await getArquivoPrincipalPorSubmissaoIds(avaliacoes.map((r) => Number(r.submissao_id)).filter(Boolean))
      return json({
        sucesso: true,
        usuario: user,
        avaliacoes: avaliacoes.map((r) => ({ ...r, ...(fileMap.get(Number(r.submissao_id)) || { url_arquivo: null, nome_arquivo: null }) }))
      })
    }

    if (action === 'editor_dashboard') {
      if (!canAccess(user, ['editor', 'editor_adjunto'])) return json({ erro: 'Acesso negado.' }, 403)
      const dossieCols = await getTableColumns('dossies_tematicos')
      const submissaoCols = await getTableColumns('submissoes')
      const hasDossieAdj = dossieCols.has('editor_adjunto_id')
      const hasDossieResp = dossieCols.has('editor_responsavel_id')
      const hasSubAdj = submissaoCols.has('editor_adjunto_id')
      const hasSubResp = submissaoCols.has('editor_responsavel_id')

      const dossies = await maybeRows('dossies_tematicos', () => {
        if (hasDossieAdj && hasDossieResp) return sql`SELECT dt.*, uc.nome AS criado_por_nome FROM dossies_tematicos dt LEFT JOIN usuarios uc ON uc.id = dt.criado_por_editor_chefe_id WHERE COALESCE(dt.editor_adjunto_id, dt.editor_responsavel_id) = ${user.id} ORDER BY dt.criado_em DESC`
        if (hasDossieAdj) return sql`SELECT dt.*, uc.nome AS criado_por_nome FROM dossies_tematicos dt LEFT JOIN usuarios uc ON uc.id = dt.criado_por_editor_chefe_id WHERE dt.editor_adjunto_id = ${user.id} ORDER BY dt.criado_em DESC`
        if (hasDossieResp) return sql`SELECT dt.*, uc.nome AS criado_por_nome FROM dossies_tematicos dt LEFT JOIN usuarios uc ON uc.id = dt.criado_por_editor_chefe_id WHERE dt.editor_responsavel_id = ${user.id} ORDER BY dt.criado_em DESC`
        return sql`SELECT dt.*, uc.nome AS criado_por_nome FROM dossies_tematicos dt LEFT JOIN usuarios uc ON uc.id = dt.criado_por_editor_chefe_id ORDER BY dt.criado_em DESC`
      })

      let submissoes
      if (hasSubAdj && hasDossieAdj && hasDossieResp) {
        submissoes = await sql`
          SELECT s.id, s.titulo, s.status, s.secao, s.resumo, s.palavras_chave, s.prazo_final_avaliacao, s.data_submissao,
                 a.nome AS autor_nome, dt.titulo AS dossie_titulo
          FROM submissoes s
          LEFT JOIN usuarios a ON a.id = s.autor_id
          LEFT JOIN dossies_tematicos dt ON dt.id = s.dossie_id
          WHERE s.editor_adjunto_id = ${user.id}
             OR s.dossie_id IN (SELECT id FROM dossies_tematicos WHERE COALESCE(editor_adjunto_id, editor_responsavel_id) = ${user.id})
          ORDER BY s.data_submissao DESC`
      } else if (hasSubAdj && hasDossieResp) {
        submissoes = await sql`
          SELECT s.id, s.titulo, s.status, s.secao, s.resumo, s.palavras_chave, s.prazo_final_avaliacao, s.data_submissao,
                 a.nome AS autor_nome, dt.titulo AS dossie_titulo
          FROM submissoes s
          LEFT JOIN usuarios a ON a.id = s.autor_id
          LEFT JOIN dossies_tematicos dt ON dt.id = s.dossie_id
          WHERE s.editor_adjunto_id = ${user.id}
             OR s.dossie_id IN (SELECT id FROM dossies_tematicos WHERE editor_responsavel_id = ${user.id})
          ORDER BY s.data_submissao DESC`
      } else if (hasSubResp && hasDossieAdj && hasDossieResp) {
        submissoes = await sql`
          SELECT s.id, s.titulo, s.status, s.secao, s.resumo, s.palavras_chave, s.prazo_final_avaliacao, s.data_submissao,
                 a.nome AS autor_nome, dt.titulo AS dossie_titulo
          FROM submissoes s
          LEFT JOIN usuarios a ON a.id = s.autor_id
          LEFT JOIN dossies_tematicos dt ON dt.id = s.dossie_id
          WHERE s.editor_responsavel_id = ${user.id}
             OR s.dossie_id IN (SELECT id FROM dossies_tematicos WHERE COALESCE(editor_adjunto_id, editor_responsavel_id) = ${user.id})
          ORDER BY s.data_submissao DESC`
      } else if (hasSubResp && hasDossieResp) {
        submissoes = await sql`
          SELECT s.id, s.titulo, s.status, s.secao, s.resumo, s.palavras_chave, s.prazo_final_avaliacao, s.data_submissao,
                 a.nome AS autor_nome, dt.titulo AS dossie_titulo
          FROM submissoes s
          LEFT JOIN usuarios a ON a.id = s.autor_id
          LEFT JOIN dossies_tematicos dt ON dt.id = s.dossie_id
          WHERE s.editor_responsavel_id = ${user.id}
             OR s.dossie_id IN (SELECT id FROM dossies_tematicos WHERE editor_responsavel_id = ${user.id})
          ORDER BY s.data_submissao DESC`
      } else if (hasSubAdj) {
        submissoes = await sql`
          SELECT s.id, s.titulo, s.status, s.secao, s.resumo, s.palavras_chave, s.prazo_final_avaliacao, s.data_submissao,
                 a.nome AS autor_nome, dt.titulo AS dossie_titulo
          FROM submissoes s
          LEFT JOIN usuarios a ON a.id = s.autor_id
          LEFT JOIN dossies_tematicos dt ON dt.id = s.dossie_id
          WHERE s.editor_adjunto_id = ${user.id}
          ORDER BY s.data_submissao DESC`
      } else if (hasSubResp) {
        submissoes = await sql`
          SELECT s.id, s.titulo, s.status, s.secao, s.resumo, s.palavras_chave, s.prazo_final_avaliacao, s.data_submissao,
                 a.nome AS autor_nome, dt.titulo AS dossie_titulo
          FROM submissoes s
          LEFT JOIN usuarios a ON a.id = s.autor_id
          LEFT JOIN dossies_tematicos dt ON dt.id = s.dossie_id
          WHERE s.editor_responsavel_id = ${user.id}
          ORDER BY s.data_submissao DESC`
      } else {
        submissoes = await sql`
          SELECT s.id, s.titulo, s.status, s.secao, s.resumo, s.palavras_chave, s.prazo_final_avaliacao, s.data_submissao,
                 a.nome AS autor_nome, dt.titulo AS dossie_titulo
          FROM submissoes s
          LEFT JOIN usuarios a ON a.id = s.autor_id
          LEFT JOIN dossies_tematicos dt ON dt.id = s.dossie_id
          ORDER BY s.data_submissao DESC`
      }
      const fileMap = await getArquivoPrincipalPorSubmissaoIds(submissoes.map((r) => Number(r.id)).filter(Boolean))
      const pareceristas = await sql`
        SELECT u.id, u.nome, u.email, u.instituicao, u.orcid, u.lattes, u.foto_perfil_url, u.foto_perfil_aprovada,
               u.consentimento_foto_publica,
               COALESCE(c.total_avaliacoes, 0) AS total_avaliacoes,
               CASE WHEN u.ultimo_acesso_em IS NOT NULL AND u.ultimo_acesso_em > (CURRENT_TIMESTAMP - INTERVAL '2 minutes') THEN TRUE ELSE FALSE END AS online,
               u.ultimo_acesso_em
        FROM usuarios u
        LEFT JOIN contribuicoes_usuarios c ON c.usuario_id = u.id
        WHERE u.perfil = 'parecerista' AND COALESCE(u.status, 'ativo') = 'ativo'
        ORDER BY u.nome ASC`
      return json({
        sucesso: true,
        usuario: user,
        dossies,
        submissoes: submissoes.map((r) => ({ ...r, ...(fileMap.get(Number(r.id)) || { url_arquivo: null, nome_arquivo: null }) })),
        pareceristas
      })
    }

    if (action === 'chief_dashboard') {
      if (!canAccess(user, ['editor_chefe'])) return json({ erro: 'Acesso negado.' }, 403)
      const usuarios = await sql`
        SELECT u.id, u.nome, u.email, u.perfil, u.instituicao, u.orcid, u.lattes, u.origem, u.telefone, COALESCE(u.status, 'ativo') AS status,
               u.foto_perfil_url, u.foto_perfil_aprovada, u.consentimento_foto_publica,
               COALESCE(c.total_submissoes, 0) AS total_submissoes,
               COALESCE(c.total_avaliacoes, 0) AS total_avaliacoes,
               COALESCE(c.total_dossies, 0) AS total_dossies,
               COALESCE(c.total_decisoes_editoriais, 0) AS total_decisoes_editoriais,
               c.observacoes,
               CASE WHEN u.ultimo_acesso_em IS NOT NULL AND u.ultimo_acesso_em > (CURRENT_TIMESTAMP - INTERVAL '2 minutes') THEN TRUE ELSE FALSE END AS online,
               u.ultimo_acesso_em
        FROM usuarios u
        LEFT JOIN contribuicoes_usuarios c ON c.usuario_id = u.id
        ORDER BY u.perfil, u.nome`
      const submissaoCols = await getTableColumns('submissoes')
      const dossieCols = await getTableColumns('dossies_tematicos')
      const chiefHasSubAdj = submissaoCols.has('editor_adjunto_id')
      const chiefHasSubResp = submissaoCols.has('editor_responsavel_id')
      const chiefHasDossieAdj = dossieCols.has('editor_adjunto_id')
      const chiefHasDossieResp = dossieCols.has('editor_responsavel_id')

      const submissoes = chiefHasSubAdj && chiefHasSubResp
        ? await sql`
            SELECT s.id, s.titulo, s.status, s.secao, s.resumo, s.palavras_chave, s.prazo_final_avaliacao, s.data_submissao,
                   a.nome AS autor_nome, a.foto_perfil_url AS autor_foto, a.foto_perfil_aprovada, a.consentimento_foto_publica,
                   er.nome AS editor_responsavel_nome, ea.nome AS editor_adjunto_nome, dt.titulo AS dossie_titulo
            FROM submissoes s
            LEFT JOIN usuarios a ON a.id = s.autor_id
            LEFT JOIN usuarios er ON er.id = s.editor_responsavel_id
            LEFT JOIN usuarios ea ON ea.id = s.editor_adjunto_id
            LEFT JOIN dossies_tematicos dt ON dt.id = s.dossie_id
            ORDER BY s.data_submissao DESC`
        : chiefHasSubResp
          ? await sql`
              SELECT s.id, s.titulo, s.status, s.secao, s.resumo, s.palavras_chave, s.prazo_final_avaliacao, s.data_submissao,
                     a.nome AS autor_nome, a.foto_perfil_url AS autor_foto, a.foto_perfil_aprovada, a.consentimento_foto_publica,
                     er.nome AS editor_responsavel_nome, NULL::TEXT AS editor_adjunto_nome, dt.titulo AS dossie_titulo
              FROM submissoes s
              LEFT JOIN usuarios a ON a.id = s.autor_id
              LEFT JOIN usuarios er ON er.id = s.editor_responsavel_id
              LEFT JOIN dossies_tematicos dt ON dt.id = s.dossie_id
              ORDER BY s.data_submissao DESC`
          : chiefHasSubAdj
            ? await sql`
                SELECT s.id, s.titulo, s.status, s.secao, s.resumo, s.palavras_chave, s.prazo_final_avaliacao, s.data_submissao,
                       a.nome AS autor_nome, a.foto_perfil_url AS autor_foto, a.foto_perfil_aprovada, a.consentimento_foto_publica,
                       NULL::TEXT AS editor_responsavel_nome, ea.nome AS editor_adjunto_nome, dt.titulo AS dossie_titulo
                FROM submissoes s
                LEFT JOIN usuarios a ON a.id = s.autor_id
                LEFT JOIN usuarios ea ON ea.id = s.editor_adjunto_id
                LEFT JOIN dossies_tematicos dt ON dt.id = s.dossie_id
                ORDER BY s.data_submissao DESC`
            : await sql`
                SELECT s.id, s.titulo, s.status, s.secao, s.resumo, s.palavras_chave, s.prazo_final_avaliacao, s.data_submissao,
                       a.nome AS autor_nome, a.foto_perfil_url AS autor_foto, a.foto_perfil_aprovada, a.consentimento_foto_publica,
                       NULL::TEXT AS editor_responsavel_nome, NULL::TEXT AS editor_adjunto_nome, dt.titulo AS dossie_titulo
                FROM submissoes s
                LEFT JOIN usuarios a ON a.id = s.autor_id
                LEFT JOIN dossies_tematicos dt ON dt.id = s.dossie_id
                ORDER BY s.data_submissao DESC`
      const fileMap = await getArquivoPrincipalPorSubmissaoIds(submissoes.map((r) => Number(r.id)).filter(Boolean))
      const dossies = await maybeRows('dossies_tematicos', () => {
        if (chiefHasDossieAdj && chiefHasDossieResp) return sql`SELECT dt.*, u.nome AS editor_nome FROM dossies_tematicos dt LEFT JOIN usuarios u ON u.id = COALESCE(dt.editor_adjunto_id, dt.editor_responsavel_id) ORDER BY dt.criado_em DESC`
        if (chiefHasDossieResp) return sql`SELECT dt.*, u.nome AS editor_nome FROM dossies_tematicos dt LEFT JOIN usuarios u ON u.id = dt.editor_responsavel_id ORDER BY dt.criado_em DESC`
        if (chiefHasDossieAdj) return sql`SELECT dt.*, u.nome AS editor_nome FROM dossies_tematicos dt LEFT JOIN usuarios u ON u.id = dt.editor_adjunto_id ORDER BY dt.criado_em DESC`
        return sql`SELECT dt.*, NULL::TEXT AS editor_nome FROM dossies_tematicos dt ORDER BY dt.criado_em DESC`
      })
      const mensagens = await sql`SELECT m.*, ur.nome AS remetente_nome, ur.perfil AS remetente_perfil FROM mensagens_internas m LEFT JOIN usuarios ur ON ur.id = m.remetente_id WHERE m.destinatario_id = ${user.id} OR m.remetente_id = ${user.id} ORDER BY m.criado_em DESC LIMIT 100`
      return json({
        sucesso: true,
        usuario: user,
        usuarios,
        submissoes: submissoes.map((r) => ({ ...r, ...(fileMap.get(Number(r.id)) || { url_arquivo: null, nome_arquivo: null }) })),
        dossies,
        mensagens
      })
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
      const dossieCols = await getTableColumns('dossies_tematicos')
      const hasDossieAdj = dossieCols.has('editor_adjunto_id')
      const hasDossieResp = dossieCols.has('editor_responsavel_id')
      const dossies = await maybeRows('dossies_tematicos', () => {
        if (hasDossieAdj && hasDossieResp) return sql`SELECT dt.id, dt.titulo, dt.descricao, dt.status, dt.data_abertura, dt.data_fechamento, u.nome AS editor_nome FROM dossies_tematicos dt LEFT JOIN usuarios u ON u.id = COALESCE(dt.editor_adjunto_id, dt.editor_responsavel_id) WHERE dt.status = 'aberto' ORDER BY dt.data_abertura DESC, dt.titulo ASC`
        if (hasDossieResp) return sql`SELECT dt.id, dt.titulo, dt.descricao, dt.status, dt.data_abertura, dt.data_fechamento, u.nome AS editor_nome FROM dossies_tematicos dt LEFT JOIN usuarios u ON u.id = dt.editor_responsavel_id WHERE dt.status = 'aberto' ORDER BY dt.data_abertura DESC, dt.titulo ASC`
        if (hasDossieAdj) return sql`SELECT dt.id, dt.titulo, dt.descricao, dt.status, dt.data_abertura, dt.data_fechamento, u.nome AS editor_nome FROM dossies_tematicos dt LEFT JOIN usuarios u ON u.id = dt.editor_adjunto_id WHERE dt.status = 'aberto' ORDER BY dt.data_abertura DESC, dt.titulo ASC`
        return sql`SELECT dt.id, dt.titulo, dt.descricao, dt.status, dt.data_abertura, dt.data_fechamento, NULL::TEXT AS editor_nome FROM dossies_tematicos dt WHERE dt.status = 'aberto' ORDER BY dt.data_abertura DESC, dt.titulo ASC`
      })
      return json({ sucesso: true, dossies })
    }

    if (action === 'online_users') {
      if (!canAccess(user, ['editor', 'editor_adjunto', 'editor_chefe'])) return json({ erro: 'Acesso negado.' }, 403)
      const rows = user.perfil === 'editor_chefe'
        ? await sql`SELECT id, nome, perfil, foto_perfil_url, foto_perfil_aprovada, consentimento_foto_publica, CASE WHEN ultimo_acesso_em IS NOT NULL AND ultimo_acesso_em > (CURRENT_TIMESTAMP - INTERVAL '2 minutes') THEN TRUE ELSE FALSE END AS online, ultimo_acesso_em FROM usuarios WHERE COALESCE(status,'ativo')='ativo' ORDER BY online DESC, ultimo_acesso_em DESC NULLS LAST, perfil, nome`
        : await sql`SELECT id, nome, perfil, foto_perfil_url, foto_perfil_aprovada, consentimento_foto_publica, CASE WHEN ultimo_acesso_em IS NOT NULL AND ultimo_acesso_em > (CURRENT_TIMESTAMP - INTERVAL '2 minutes') THEN TRUE ELSE FALSE END AS online, ultimo_acesso_em FROM usuarios WHERE COALESCE(status,'ativo')='ativo' AND perfil IN ('editor_chefe','editor','editor_adjunto','parecerista') ORDER BY online DESC, ultimo_acesso_em DESC NULLS LAST, perfil, nome`
      return json({ sucesso: true, usuarios: rows })
    }

    if (action === 'chat_recipients') {
      let rows
      if (user.perfil === 'autor') rows = await sql`SELECT id, nome, perfil, foto_perfil_url, foto_perfil_aprovada, consentimento_foto_publica, CASE WHEN ultimo_acesso_em IS NOT NULL AND ultimo_acesso_em > (CURRENT_TIMESTAMP - INTERVAL '2 minutes') THEN TRUE ELSE FALSE END AS online, ultimo_acesso_em FROM usuarios WHERE COALESCE(status,'ativo')='ativo' AND perfil IN ('editor_chefe','editor','editor_adjunto') ORDER BY online DESC, ultimo_acesso_em DESC NULLS LAST, perfil, nome`
      else rows = await sql`SELECT id, nome, perfil, foto_perfil_url, foto_perfil_aprovada, consentimento_foto_publica, CASE WHEN ultimo_acesso_em IS NOT NULL AND ultimo_acesso_em > (CURRENT_TIMESTAMP - INTERVAL '2 minutes') THEN TRUE ELSE FALSE END AS online, ultimo_acesso_em FROM usuarios WHERE COALESCE(status,'ativo')='ativo' ORDER BY online DESC, ultimo_acesso_em DESC NULLS LAST, perfil, nome`
      return json({ sucesso: true, usuarios: rows })
    }

    if (action === 'chat_messages') {
      const targetId = Number(targetUserId)
      if (!targetId) return json({ erro: 'Destinatário não informado.' }, 400)
      const allowedRecipients = user.perfil === 'autor'
        ? await sql`SELECT id FROM usuarios WHERE COALESCE(status,'ativo')='ativo' AND perfil IN ('editor_chefe','editor','editor_adjunto') AND id = ${targetId}`
        : await sql`SELECT id FROM usuarios WHERE COALESCE(status,'ativo')='ativo' AND id = ${targetId}`
      if (!allowedRecipients.length) return json({ erro: 'Você não pode acessar esta conversa.' }, 403)
      const messages = await sql`
        SELECT m.*, ur.nome AS remetente_nome, ur.perfil AS remetente_perfil, ur.foto_perfil_url AS remetente_foto,
               ur.foto_perfil_aprovada AS remetente_foto_aprovada, ur.consentimento_foto_publica AS remetente_foto_consent,
               ud.nome AS destinatario_nome
        FROM mensagens_internas m
        JOIN usuarios ur ON ur.id = m.remetente_id
        JOIN usuarios ud ON ud.id = m.destinatario_id
        WHERE (m.remetente_id = ${user.id} AND m.destinatario_id = ${targetId})
           OR (m.remetente_id = ${targetId} AND m.destinatario_id = ${user.id})
        ORDER BY m.criado_em ASC
        LIMIT 300`
      return json({ sucesso: true, mensagens: messages })
    }

    if (action === 'certificates') {
      const mapa = {
        autor: 'https://drive.google.com/drive/folders/1t_xVWLyB8qsC6Zm77z7OUXqalRu6XdWr?usp=drive_link',
        parecerista: 'https://drive.google.com/drive/folders/1mLe8TLFmVkL6QpscMVW2pZNmOJDTPcbs?usp=drive_link',
        editor: 'https://drive.google.com/drive/folders/12oMGUyoZm3qLzuxdLIo-3x7plUMEWUyF?usp=drive_link',
        editor_adjunto: 'https://drive.google.com/drive/folders/12oMGUyoZm3qLzuxdLIo-3x7plUMEWUyF?usp=drive_link',
        editor_chefe: 'https://drive.google.com/drive/folders/12oMGUyoZm3qLzuxdLIo-3x7plUMEWUyF?usp=drive_link'
      }
      return json({ sucesso: true, link: mapa[user.perfil] })
    }

    // ===== NOVA AÇÃO update_profile =====
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
    return json({ erro: 'Erro ao carregar dados.', detalhe: erro.message }, 500)
  }
}

exports.handler = wrapHttp(main)