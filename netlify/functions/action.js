const bcrypt = require('bcryptjs')
const { sql, json, parseJson, getUserById, canAccess, ensureSupportTables } = require('./_db')
const { wrapHttp } = require('./_netlify')

// ==================== FUNÇÕES AUXILIARES ====================
async function getDesignacaoById(id) {
  const rows = await sql`
    SELECT da.*, s.status AS submissao_status
    FROM designacoes_avaliacao da
    JOIN submissoes s ON s.id = da.submissao_id
    WHERE da.id = ${id}
    LIMIT 1`
  return rows[0] || null
}

async function getTableColumns(tableName) {
  const rows = await sql`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${tableName}`
  return new Set((rows || []).map((row) => row.column_name))
}

async function ensureEditorialColumnsCompatibility() {
  await sql`ALTER TABLE submissoes ADD COLUMN IF NOT EXISTS editor_responsavel_id BIGINT`
  await sql`ALTER TABLE submissoes ADD COLUMN IF NOT EXISTS editor_adjunto_id BIGINT`
  await sql`ALTER TABLE dossies_tematicos ADD COLUMN IF NOT EXISTS editor_responsavel_id BIGINT`
  await sql`ALTER TABLE dossies_tematicos ADD COLUMN IF NOT EXISTS editor_adjunto_id BIGINT`
}

async function refreshSubmissionStatus(submissaoId) {
  if (!submissaoId) return
  const rows = await sql`
    SELECT status
    FROM designacoes_avaliacao
    WHERE submissao_id = ${submissaoId}`
  if (!rows.length) {
    await sql`UPDATE submissoes SET status = 'nao_alocada' WHERE id = ${submissaoId}`
    return
  }
  const statuses = rows.map((row) => row.status)
  let nextStatus = 'alocada_sem_aceite'
  if (statuses.some((status) => status === 'concluido')) {
    nextStatus = 'em_avaliacao'
  }
  else if (statuses.some((status) => ['aceito', 'em_andamento'].includes(status))) nextStatus = 'em_avaliacao'
  else if (statuses.every((status) => status === 'recusado')) nextStatus = 'nao_alocada'
  await sql`UPDATE submissoes SET status = ${nextStatus} WHERE id = ${submissaoId}`
}

async function findExistingReview(avaliacoesCols, designacaoId, submissaoId, pareceristaId) {
  if (avaliacoesCols.has('designacao_id')) {
    const rows = await sql`SELECT id FROM avaliacoes WHERE designacao_id = ${designacaoId} LIMIT 1`
    return rows[0] || null
  }
  const rows = await sql`
    SELECT id
    FROM avaliacoes
    WHERE submissao_id = ${submissaoId} AND parecerista_id = ${pareceristaId}
    ORDER BY id DESC
    LIMIT 1`
  return rows[0] || null
}

async function upsertReview({ designacao, user, body }) {
  const avaliacoesCols = await getTableColumns('avaliacoes')
  const existing = await findExistingReview(avaliacoesCols, designacao.id, Number(designacao.submissao_id), Number(user.id))

  const rowId = existing?.id || await (async () => {
    if (avaliacoesCols.has('designacao_id')) {
      const created = await sql`INSERT INTO avaliacoes (submissao_id, parecerista_id, designacao_id) VALUES (${Number(designacao.submissao_id)}, ${Number(user.id)}, ${Number(designacao.id)}) RETURNING id`
      return created[0]?.id
    }
    const created = await sql`INSERT INTO avaliacoes (submissao_id, parecerista_id) VALUES (${Number(designacao.submissao_id)}, ${Number(user.id)}) RETURNING id`
    return created[0]?.id
  })()

  if (!rowId) throw new Error('Não foi possível criar ou localizar o parecer.')

  const updates = [
    ['relevancia_academica', body.relevanciaAcademica],
    ['clareza_organizacao', body.clarezaOrganizacao],
    ['consistencia_teorica', body.consistenciaTeorica],
    ['adequacao_metodologica', body.adequacaoMetodologica],
    ['qualidade_redacao', body.qualidadeRedacao],
    ['contribuicao_relevante_area', body.contribuicaoRelevanteArea],
    ['comentario_autor', body.comentarioAutor || null],
    ['comentario_editor', body.comentarioEditor || null],
    ['parecer_final', body.parecerFinal],
    ['tempo_avaliacao', body.tempoAvaliacao],
    ['devolutiva_doc_url', body.devolutivaUrl || null],
    ['devolutiva_url', body.devolutivaUrl || null]
  ]

  for (const [column, value] of updates) {
    if (!avaliacoesCols.has(column)) continue
    if (column === 'relevancia_academica') {
      await sql`UPDATE avaliacoes SET relevancia_academica = ${value} WHERE id = ${rowId}`
    } else if (column === 'clareza_organizacao') {
      await sql`UPDATE avaliacoes SET clareza_organizacao = ${value} WHERE id = ${rowId}`
    } else if (column === 'consistencia_teorica') {
      await sql`UPDATE avaliacoes SET consistencia_teorica = ${value} WHERE id = ${rowId}`
    } else if (column === 'adequacao_metodologica') {
      await sql`UPDATE avaliacoes SET adequacao_metodologica = ${value} WHERE id = ${rowId}`
    } else if (column === 'qualidade_redacao') {
      await sql`UPDATE avaliacoes SET qualidade_redacao = ${value} WHERE id = ${rowId}`
    } else if (column === 'contribuicao_relevante_area') {
      await sql`UPDATE avaliacoes SET contribuicao_relevante_area = ${value} WHERE id = ${rowId}`
    } else if (column === 'comentario_autor') {
      await sql`UPDATE avaliacoes SET comentario_autor = ${value} WHERE id = ${rowId}`
    } else if (column === 'comentario_editor') {
      await sql`UPDATE avaliacoes SET comentario_editor = ${value} WHERE id = ${rowId}`
    } else if (column === 'parecer_final') {
      await sql`UPDATE avaliacoes SET parecer_final = ${value} WHERE id = ${rowId}`
    } else if (column === 'tempo_avaliacao') {
      await sql`UPDATE avaliacoes SET tempo_avaliacao = ${value} WHERE id = ${rowId}`
    } else if (column === 'devolutiva_doc_url') {
      await sql`UPDATE avaliacoes SET devolutiva_doc_url = ${value} WHERE id = ${rowId}`
    } else if (column === 'devolutiva_url') {
      await sql`UPDATE avaliacoes SET devolutiva_url = ${value} WHERE id = ${rowId}`
    }
  }

  if (avaliacoesCols.has('atualizado_em')) {
    await sql`UPDATE avaliacoes SET atualizado_em = CURRENT_TIMESTAMP WHERE id = ${rowId}`
  } else if (avaliacoesCols.has('updated_at')) {
    await sql`UPDATE avaliacoes SET updated_at = CURRENT_TIMESTAMP WHERE id = ${rowId}`
  }
}

async function ensureReviewStoreV2() {
  await sql`
    CREATE TABLE IF NOT EXISTS avaliacoes_v2 (
      id BIGSERIAL PRIMARY KEY,
      designacao_id BIGINT NOT NULL UNIQUE,
      submissao_id BIGINT NOT NULL,
      parecerista_id BIGINT NOT NULL,
      relevancia_academica TEXT,
      clareza_organizacao TEXT,
      consistencia_teorica TEXT,
      adequacao_metodologica TEXT,
      qualidade_redacao TEXT,
      contribuicao_relevante_area TEXT,
      comentario_autor TEXT,
      comentario_editor TEXT,
      parecer_final TEXT,
      tempo_avaliacao TEXT,
      devolutiva_url TEXT,
      devolutiva_doc_url TEXT,
      criado_em TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      atualizado_em TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )`
}

async function upsertReviewV2({ designacao, user, body }) {
  await ensureReviewStoreV2()
  await sql`
    INSERT INTO avaliacoes_v2 (
      designacao_id, submissao_id, parecerista_id,
      relevancia_academica, clareza_organizacao, consistencia_teorica,
      adequacao_metodologica, qualidade_redacao, contribuicao_relevante_area,
      comentario_autor, comentario_editor, parecer_final, tempo_avaliacao,
      devolutiva_url, devolutiva_doc_url, atualizado_em
    ) VALUES (
      ${Number(designacao.id)}, ${Number(designacao.submissao_id)}, ${Number(user.id)},
      ${body.relevanciaAcademica || null}, ${body.clarezaOrganizacao || null}, ${body.consistenciaTeorica || null},
      ${body.adequacaoMetodologica || null}, ${body.qualidadeRedacao || null}, ${body.contribuicaoRelevanteArea || null},
      ${body.comentarioAutor || null}, ${body.comentarioEditor || null}, ${body.parecerFinal || null}, ${body.tempoAvaliacao || null},
      ${body.devolutivaUrl || null}, ${body.devolutivaUrl || null}, CURRENT_TIMESTAMP
    )
    ON CONFLICT (designacao_id) DO UPDATE SET
      submissao_id = EXCLUDED.submissao_id,
      parecerista_id = EXCLUDED.parecerista_id,
      relevancia_academica = EXCLUDED.relevancia_academica,
      clareza_organizacao = EXCLUDED.clareza_organizacao,
      consistencia_teorica = EXCLUDED.consistencia_teorica,
      adequacao_metodologica = EXCLUDED.adequacao_metodologica,
      qualidade_redacao = EXCLUDED.qualidade_redacao,
      contribuicao_relevante_area = EXCLUDED.contribuicao_relevante_area,
      comentario_autor = EXCLUDED.comentario_autor,
      comentario_editor = EXCLUDED.comentario_editor,
      parecer_final = EXCLUDED.parecer_final,
      tempo_avaliacao = EXCLUDED.tempo_avaliacao,
      devolutiva_url = EXCLUDED.devolutiva_url,
      devolutiva_doc_url = EXCLUDED.devolutiva_doc_url,
      atualizado_em = CURRENT_TIMESTAMP`
}

async function markDesignacaoStatus(designacaoId, status) {
  const cols = await getTableColumns('designacoes_avaliacao')
  if (cols.has('atualizado_em')) {
    await sql`UPDATE designacoes_avaliacao SET status = ${status}, atualizado_em = CURRENT_TIMESTAMP WHERE id = ${designacaoId}`
    return
  }
  if (cols.has('updated_at')) {
    await sql`UPDATE designacoes_avaliacao SET status = ${status}, updated_at = CURRENT_TIMESTAMP WHERE id = ${designacaoId}`
    return
  }
  await sql`UPDATE designacoes_avaliacao SET status = ${status} WHERE id = ${designacaoId}`
}

// ==================== NOTIFICAÇÕES (apenas uma definição) ====================
async function criarNotificacao(usuarioId, tipo, titulo, mensagem, link = null) {
  try {
    await sql`
      INSERT INTO notificacoes (usuario_id, tipo, titulo, mensagem, link)
      VALUES (${usuarioId}, ${tipo}, ${titulo}, ${mensagem}, ${link})
    `;
    enviarEmailNotificacao(usuarioId, titulo, mensagem, link).catch(console.error);
  } catch (err) {
    console.error('Erro ao criar notificação:', err);
  }
}

async function enviarEmailNotificacao(usuarioId, titulo, mensagem, link = null) {
  try {
    const user = await getUserById(usuarioId);
    if (!user || !user.receber_noticias_email) return;
    const email = user.email;
    if (!email) return;
    const baseUrl = process.env.URL || 'https://revista-inquietacoes.netlify.app';
    const fullLink = link ? `${baseUrl}${link}` : baseUrl;
    const html = `<p>${mensagem}</p><p><a href="${fullLink}">Ver detalhes</a></p>`;
    await fetch(`${baseUrl}/.netlify/functions/send-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: email, subject: titulo, html })
    });
  } catch (err) {
    console.error('Erro no envio de e-mail:', err);
  }
}

// ==================== MAIN ====================
const main = async (req) => {
  try {
    await ensureSupportTables()
    await ensureEditorialColumnsCompatibility()

    if (req.method !== 'POST') {
      return json({ erro: 'Método não permitido.' }, 405)
    }

    const body = await parseJson(req)
    const { action, userId } = body
    const user = await getUserById(Number(userId), action === 'delete_submission')

    if (!user) {
      return json({ erro: 'Usuário não encontrado.' }, 404)
    }

    // ---------- Ações de presença ----------
    if (action === 'presence_ping') {
      await sql`UPDATE usuarios SET ultimo_acesso_em = CURRENT_TIMESTAMP, online = TRUE, atualizado_em = CURRENT_TIMESTAMP WHERE id = ${user.id}`
      const refreshed = await getUserById(user.id)
      return json({ sucesso: true, usuario: refreshed })
    }

    if (action === 'presence_leave') {
      await sql`UPDATE usuarios SET online = FALSE, ultimo_acesso_em = (CURRENT_TIMESTAMP - INTERVAL '10 minutes'), atualizado_em = CURRENT_TIMESTAMP WHERE id = ${user.id}`
      const refreshed = await getUserById(user.id)
      return json({ sucesso: true, usuario: refreshed })
    }

    // ---------- Atualização de perfil ----------
    if (action === 'update_profile') {
      const { nome, instituicao, orcid, lattes, origem, telefone, receber_noticias_email, avatarUrl } = body
      if (avatarUrl) {
        await sql`UPDATE usuarios SET foto_perfil_url = ${avatarUrl}, atualizado_em = CURRENT_TIMESTAMP WHERE id = ${user.id}`
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

    // ---------- Aprovar usuário ----------
    if (action === 'approve_user') {
      if (!canAccess(user, ['editor_chefe'])) return json({ erro: 'Acesso negado.' }, 403)
      const { targetUserId, status, foto_perfil_aprovada, consentimento_foto_publica, total_avaliacoes } = body
      if (status) await sql`UPDATE usuarios SET status = ${status}, atualizado_em = CURRENT_TIMESTAMP WHERE id = ${targetUserId}`
      if (typeof foto_perfil_aprovada === 'boolean' || typeof consentimento_foto_publica === 'boolean') {
        await sql`UPDATE usuarios SET foto_perfil_aprovada = COALESCE(${typeof foto_perfil_aprovada === 'boolean' ? foto_perfil_aprovada : null}, foto_perfil_aprovada), consentimento_foto_publica = COALESCE(${typeof consentimento_foto_publica === 'boolean' ? consentimento_foto_publica : null}, consentimento_foto_publica), atualizado_em = CURRENT_TIMESTAMP WHERE id = ${targetUserId}`
      }
      if (Number.isFinite(Number(total_avaliacoes))) {
        await sql`INSERT INTO contribuicoes_usuarios (usuario_id, total_avaliacoes) VALUES (${targetUserId}, ${Number(total_avaliacoes)}) ON CONFLICT (usuario_id) DO UPDATE SET total_avaliacoes = EXCLUDED.total_avaliacoes, atualizado_em = CURRENT_TIMESTAMP`
      }
      return json({ sucesso: true })
    }

    // ---------- Criar dossiê ----------
    if (action === 'create_dossier') {
      if (!canAccess(user, ['editor_chefe'])) return json({ erro: 'Acesso negado.' }, 403)
      const { titulo, descricao, editorResponsavelId, dataAbertura, dataFechamento } = body
      if (!titulo || !descricao || !editorResponsavelId) return json({ erro: 'Preencha título, descrição e editor responsável.' }, 400)
      const dossieCols = await getTableColumns('dossies_tematicos')
      if (dossieCols.has('editor_responsavel_id') && dossieCols.has('editor_adjunto_id')) {
        await sql`INSERT INTO dossies_tematicos (titulo, descricao, editor_responsavel_id, editor_adjunto_id, criado_por_editor_chefe_id, status, data_abertura, data_fechamento) VALUES (${titulo}, ${descricao}, ${editorResponsavelId}, ${editorResponsavelId}, ${user.id}, 'aberto', ${dataAbertura || null}, ${dataFechamento || null})`
      } else if (dossieCols.has('editor_responsavel_id')) {
        await sql`INSERT INTO dossies_tematicos (titulo, descricao, editor_responsavel_id, criado_por_editor_chefe_id, status, data_abertura, data_fechamento) VALUES (${titulo}, ${descricao}, ${editorResponsavelId}, ${user.id}, 'aberto', ${dataAbertura || null}, ${dataFechamento || null})`
      } else if (dossieCols.has('editor_adjunto_id')) {
        await sql`INSERT INTO dossies_tematicos (titulo, descricao, editor_adjunto_id, criado_por_editor_chefe_id, status, data_abertura, data_fechamento) VALUES (${titulo}, ${descricao}, ${editorResponsavelId}, ${user.id}, 'aberto', ${dataAbertura || null}, ${dataFechamento || null})`
      } else {
        await sql`INSERT INTO dossies_tematicos (titulo, descricao, criado_por_editor_chefe_id, status, data_abertura, data_fechamento) VALUES (${titulo}, ${descricao}, ${user.id}, 'aberto', ${dataAbertura || null}, ${dataFechamento || null})`
      }
      return json({ sucesso: true })
    }

    // ---------- Designar revisor ----------
    if (action === 'assign_reviewer') {
      if (!canAccess(user, ['editor_chefe', 'editor_adjunto'])) return json({ erro: 'Acesso negado.' }, 403)
      const { submissaoId, pareceristaId, prazoParecer, mensagemConvite } = body
      if (!submissaoId || !pareceristaId) return json({ erro: 'Informe submissão e parecerista.' }, 400)
      const existing = await sql`
        SELECT id, status
        FROM designacoes_avaliacao
        WHERE submissao_id = ${submissaoId}
          AND parecerista_id = ${pareceristaId}
          AND status <> 'recusado'
        LIMIT 1`
      if (existing.length) return json({ erro: 'Este parecerista já possui uma designação ativa para esta submissão.' }, 409)
      await sql`INSERT INTO designacoes_avaliacao (submissao_id, parecerista_id, editor_id, status, prazo_parecer, mensagem_convite) VALUES (${submissaoId}, ${pareceristaId}, ${user.id}, 'convite_enviado', ${prazoParecer || null}, ${mensagemConvite || null})`
      const submissaoCols = await getTableColumns('submissoes')
      if (submissaoCols.has('editor_responsavel_id') && submissaoCols.has('editor_adjunto_id')) {
        await sql`UPDATE submissoes SET status = 'alocada_sem_aceite', editor_responsavel_id = COALESCE(editor_responsavel_id, ${user.id}), editor_adjunto_id = CASE WHEN ${user.perfil} = 'editor_adjunto' THEN ${user.id} ELSE COALESCE(editor_adjunto_id, editor_responsavel_id, ${user.id}) END WHERE id = ${submissaoId}`
      } else if (submissaoCols.has('editor_responsavel_id')) {
        await sql`UPDATE submissoes SET status = 'alocada_sem_aceite', editor_responsavel_id = COALESCE(editor_responsavel_id, ${user.id}) WHERE id = ${submissaoId}`
      } else if (submissaoCols.has('editor_adjunto_id')) {
        await sql`UPDATE submissoes SET status = 'alocada_sem_aceite', editor_adjunto_id = CASE WHEN ${user.perfil} = 'editor_adjunto' THEN ${user.id} ELSE COALESCE(editor_adjunto_id, ${user.id}) END WHERE id = ${submissaoId}`
      } else {
        await sql`UPDATE submissoes SET status = 'alocada_sem_aceite' WHERE id = ${submissaoId}`
      }
      return json({ sucesso: true })
    }

    // ---------- Atualizar status da designação ----------
    if (action === 'update_designacao_status') {
      if (!canAccess(user, ['parecerista', 'editor_chefe', 'editor_adjunto'])) return json({ erro: 'Acesso negado.' }, 403)
      const { designacaoId, status, diasAdicionais } = body
      const designacao = await getDesignacaoById(Number(designacaoId))
      if (!designacao) return json({ erro: 'Designação não encontrada.' }, 404)
      if (user.perfil === 'parecerista' && Number(designacao.parecerista_id) !== Number(user.id)) return json({ erro: 'Você não pode alterar esta designação.' }, 403)
      const statusVal = status || 'aceito'
      if (designacao.status === 'concluido' && statusVal !== 'concluido') return json({ erro: 'Esta designação já foi concluída e não pode mais ser alterada.' }, 409)
      const cols = await getTableColumns('designacoes_avaliacao')
      if (cols.has('atualizado_em')) {
        await sql`UPDATE designacoes_avaliacao SET status = ${statusVal}, dias_adicionais = COALESCE(${diasAdicionais || null}, dias_adicionais), atualizado_em = CURRENT_TIMESTAMP WHERE id = ${designacao.id}`
      } else if (cols.has('updated_at')) {
        await sql`UPDATE designacoes_avaliacao SET status = ${statusVal}, dias_adicionais = COALESCE(${diasAdicionais || null}, dias_adicionais), updated_at = CURRENT_TIMESTAMP WHERE id = ${designacao.id}`
      } else {
        await sql`UPDATE designacoes_avaliacao SET status = ${statusVal}, dias_adicionais = COALESCE(${diasAdicionais || null}, dias_adicionais) WHERE id = ${designacao.id}`
      }
      await refreshSubmissionStatus(designacao.submissao_id)
      return json({ sucesso: true })
    }

    // ---------- Enviar mensagem direta (com notificação) ----------
    if (action === 'send_direct_message') {
      const { destinatarioId, mensagem, anexoUrl, anexoPath, anexoNome, anexoMime } = body
      const targetId = Number(destinatarioId)
      const cleanMessage = String(mensagem || '').trim()
      if (!targetId || !cleanMessage) return json({ erro: 'Informe destinatário e mensagem.' }, 400)
      if (targetId === Number(user.id)) return json({ erro: 'Não é possível enviar mensagem para si mesmo(a).' }, 400)
      const targetRows = await sql`SELECT id, status FROM usuarios WHERE id = ${targetId} LIMIT 1`
      if (!targetRows.length || targetRows[0].status !== 'ativo') return json({ erro: 'Destinatário inválido ou inativo.' }, 404)
      await sql`
        INSERT INTO mensagens_internas (remetente_id, destinatario_id, mensagem, anexo_url, anexo_path, anexo_nome, anexo_mime)
        VALUES (${user.id}, ${targetId}, ${cleanMessage}, ${anexoUrl || null}, ${anexoPath || null}, ${anexoNome || null}, ${anexoMime || null})
      `
      await criarNotificacao(targetId, 'mensagem', `Nova mensagem de ${user.nome}`, cleanMessage.substring(0, 100), `/cadastro-login/chat-interno?target=${user.id}`)
      return json({ sucesso: true })
    }

    // ---------- Submeter avaliação (com notificação) ----------
    if (action === 'submit_review') {
      if (!canAccess(user, ['parecerista'])) return json({ erro: 'Acesso negado.' }, 403)
      const { designacaoId, submissaoId } = body
      if (!designacaoId) return json({ erro: 'Identificação da avaliação não encontrada.' }, 400)
      const designacao = await getDesignacaoById(Number(designacaoId))
      if (!designacao) return json({ erro: 'Designação não encontrada.' }, 404)
      const submissaoFinalId = Number(designacao.submissao_id)
      if (submissaoId && Number(submissaoId) !== submissaoFinalId) return json({ erro: 'A submissão informada não corresponde à designação.' }, 400)
      if (Number(designacao.parecerista_id) !== Number(user.id)) return json({ erro: 'Você não pode enviar parecer para esta designação.' }, 403)
      if (designacao.status === 'recusado') return json({ erro: 'Não é possível enviar parecer para uma tarefa recusada.' }, 409)
      await upsertReviewV2({ designacao, user, body })
      try {
        await upsertReview({ designacao, user, body })
      } catch (legacyError) {
        console.error('Falha ao espelhar parecer em avaliacoes:', legacyError)
      }
      await markDesignacaoStatus(designacao.id, 'concluido')
      await refreshSubmissionStatus(designacao.submissao_id)
      // Notificar editores
      const submissaoInfo = await sql`SELECT editor_responsavel_id, editor_adjunto_id, titulo FROM submissoes WHERE id = ${submissaoFinalId}`
      if (submissaoInfo.length) {
        const { editor_responsavel_id, editor_adjunto_id, titulo } = submissaoInfo[0]
        const editores = [editor_responsavel_id, editor_adjunto_id].filter(Boolean)
        for (const editorId of editores) {
          await criarNotificacao(editorId, 'parecer_concluido', `Parecer concluído para "${titulo}"`, `O parecerista ${user.nome} finalizou a avaliação.`, `/cadastro-login/decisao-editorial?submissao=${submissaoFinalId}`)
        }
      }
      return json({ sucesso: true, armazenamento: 'avaliacoes_v2' })
    }

    // ---------- Solicitar certificado ----------
    if (action === 'request_certificate') {
      if (!canAccess(user, ['autor'])) return json({ erro: 'Acesso negado.' }, 403)
      const { nomeCompleto, email, certificadoMinicurso, certificadoParticipacaoGeral, certificadoComunicacaoOral, minicursos, autorizaPublicacaoTexto, resumoExpandido, tituloComunicacaoOral, autoresComunicacaoOral } = body
      await sql`INSERT INTO solicitacoes_certificados_evento (usuario_id, nome_completo, email, certificado_minicurso, certificado_participacao_geral, certificado_comunicacao_oral, minicursos, autoriza_publicacao_texto, resumo_expandido, titulo_comunicacao_oral, autores_comunicacao_oral) VALUES (${user.id}, ${nomeCompleto}, ${email}, ${!!certificadoMinicurso}, ${!!certificadoParticipacaoGeral}, ${!!certificadoComunicacaoOral}, ${minicursos || null}, ${typeof autorizaPublicacaoTexto === 'boolean' ? autorizaPublicacaoTexto : null}, ${resumoExpandido || null}, ${tituloComunicacaoOral || null}, ${autoresComunicacaoOral || null})`
      return json({ sucesso: true })
    }

    // ---------- Deletar submissão ----------
    if (action === 'delete_submission') {
      if (!canAccess(user, ['editor_chefe'])) return json({ erro: 'Acesso negado.' }, 403)
      const { submissaoId, senhaConfirmacao } = body
      if (!submissaoId || !senhaConfirmacao) return json({ erro: 'Informe submissão e senha.' }, 400)
      const ok = await bcrypt.compare(senhaConfirmacao, user.senha_hash)
      if (!ok) return json({ erro: 'Senha de confirmação inválida.' }, 401)
      await sql`DELETE FROM submissoes WHERE id = ${submissaoId}`
      return json({ sucesso: true })
    }

    // ---------- Criar submissão para autor ----------
    if (action === 'create_submission_for_author') {
      if (!canAccess(user, ['editor_chefe', 'editor_adjunto'])) return json({ erro: 'Acesso negado.' }, 403)
      const { autorId, titulo, secao, idioma, resumo, palavrasChave, dossieId } = body
      if (!titulo || !secao || !resumo) return json({ erro: 'Preencha título, seção e resumo.' }, 400)
      const autorFinal = autorId ? Number(autorId) : user.id
      const submissaoCols = await getTableColumns('submissoes')
      let created
      if (submissaoCols.has('editor_responsavel_id') && submissaoCols.has('editor_adjunto_id')) {
        created = await sql`INSERT INTO submissoes (autor_id, titulo, secao, idioma, resumo, palavras_chave, dossie_id, status, editor_responsavel_id, editor_adjunto_id) VALUES (${autorFinal}, ${titulo}, ${secao}, ${idioma || 'pt-BR'}, ${resumo}, ${palavrasChave || null}, ${dossieId || null}, 'submetido', ${user.perfil === 'editor_chefe' ? user.id : null}, ${user.perfil === 'editor_adjunto' ? user.id : null}) RETURNING id`
      } else if (submissaoCols.has('editor_responsavel_id')) {
        created = await sql`INSERT INTO submissoes (autor_id, titulo, secao, idioma, resumo, palavras_chave, dossie_id, status, editor_responsavel_id) VALUES (${autorFinal}, ${titulo}, ${secao}, ${idioma || 'pt-BR'}, ${resumo}, ${palavrasChave || null}, ${dossieId || null}, 'submetido', ${user.id}) RETURNING id`
      } else if (submissaoCols.has('editor_adjunto_id')) {
        created = await sql`INSERT INTO submissoes (autor_id, titulo, secao, idioma, resumo, palavras_chave, dossie_id, status, editor_adjunto_id) VALUES (${autorFinal}, ${titulo}, ${secao}, ${idioma || 'pt-BR'}, ${resumo}, ${palavrasChave || null}, ${dossieId || null}, 'submetido', ${user.id}) RETURNING id`
      } else {
        created = await sql`INSERT INTO submissoes (autor_id, titulo, secao, idioma, resumo, palavras_chave, dossie_id, status) VALUES (${autorFinal}, ${titulo}, ${secao}, ${idioma || 'pt-BR'}, ${resumo}, ${palavrasChave || null}, ${dossieId || null}, 'submetido') RETURNING id`
      }
      return json({ sucesso: true, submissaoId: created[0]?.id })
    }

    // ---------- Enviar notificação em massa (editor-chefe) ----------
    if (action === 'send_notification') {
      if (!canAccess(user, ['editor_chefe'])) return json({ erro: 'Acesso negado.' }, 403)
      const { targetType, targetIds, titulo, mensagem, link } = body
      let usuarios = []
      if (targetType === 'todos') {
        usuarios = await sql`SELECT id FROM usuarios WHERE status = 'ativo'`
      } else if (targetType === 'perfil') {
        usuarios = await sql`SELECT id FROM usuarios WHERE perfil = ${targetIds} AND status = 'ativo'`
      } else if (targetType === 'lista') {
        const ids = Array.isArray(targetIds) ? targetIds : [targetIds]
        usuarios = ids.map(id => ({ id: Number(id) }))
      } else {
        return json({ erro: 'Tipo de destino inválido.' }, 400)
      }
      for (const u of usuarios) {
        await criarNotificacao(u.id, 'notificacao_editor', titulo, mensagem, link)
      }
      return json({ sucesso: true, enviadas: usuarios.length })
    }
    // ---------- Marcar notificação como lida ----------
    if (action === 'marcar_notificacao_lida') {
      const { notificacaoId } = body;
      if (!notificacaoId) return json({ erro: 'ID da notificação não informado.' }, 400);
      await sql`UPDATE notificacoes SET lida = TRUE WHERE id = ${notificacaoId} AND usuario_id = ${user.id}`;
      return json({ sucesso: true });
    }

    // ---------- Marcar todas as notificações como lidas ----------
    if (action === 'marcar_todas_lidas') {
      await sql`UPDATE notificacoes SET lida = TRUE WHERE usuario_id = ${user.id}`;
      return json({ sucesso: true });
    }

    // ---------- Limpar conversa ----------
    if (action === 'clear_chat') {
      const { contactId } = body
      if (!contactId) return json({ erro: 'ID do contato não informado.' }, 400)
      const participantCheck = await sql`
        SELECT id FROM mensagens_internas
        WHERE (remetente_id = ${user.id} AND destinatario_id = ${contactId})
           OR (remetente_id = ${contactId} AND destinatario_id = ${user.id})
        LIMIT 1
      `
      if (!participantCheck.length) {
        return json({ erro: 'Você não tem permissão para limpar esta conversa.' }, 403)
      }
      const messages = await sql`
        SELECT id, anexo_path FROM mensagens_internas
        WHERE (remetente_id = ${user.id} AND destinatario_id = ${contactId})
           OR (remetente_id = ${contactId} AND destinatario_id = ${user.id})
      `
      const supabaseUrl = process.env.SUPABASE_URL
      const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
      if (supabaseUrl && supabaseServiceKey) {
        for (const msg of messages) {
          if (msg.anexo_path) {
            const deleteUrl = `${supabaseUrl}/storage/v1/object/chat-anexos/${msg.anexo_path}`
            try {
              await fetch(deleteUrl, { method: 'DELETE', headers: { 'Authorization': `Bearer ${supabaseServiceKey}` } })
            } catch (err) { console.error('Erro ao deletar arquivo:', err) }
          }
        }
      }
      await sql`
        DELETE FROM mensagens_internas
        WHERE (remetente_id = ${user.id} AND destinatario_id = ${contactId})
           OR (remetente_id = ${contactId} AND destinatario_id = ${user.id})
      `
      return json({ sucesso: true, mensagem: 'Conversa limpa com sucesso.' })
    }
    // ========== COMENTÁRIOS DOS CURSOS ==========
    if (action === 'add_comentario_curso') {
      const { curso_slug, comentario, anexo_url, anexo_storage_path, anexo_nome } = body;
      if (!curso_slug || !comentario) return json({ erro: 'Slug e comentário são obrigatórios.' }, 400);
      await sql`
        INSERT INTO comentarios_cursos (curso_slug, usuario_id, comentario, anexo_url, anexo_storage_path, anexo_nome)
        VALUES (${curso_slug}, ${user.id}, ${comentario}, ${anexo_url || null}, ${anexo_storage_path || null}, ${anexo_nome || null})
    `;
      return json({ sucesso: true });
    }

    // Se nenhuma ação corresponder
    return json({ erro: 'Ação inválida.' }, 400)

  } catch (erro) {
    console.error('Erro em action.js:', erro)
    return json({ erro: 'Erro ao executar ação.', detalhe: erro.message }, 500)
  }
}

exports.handler = wrapHttp(main)