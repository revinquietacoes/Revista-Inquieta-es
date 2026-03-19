import bcrypt from 'bcryptjs'
import { sql, json, parseJson, getUserById, canAccess } from './_db.js'

export default async (req) => {
  try {
    if (req.method !== 'POST') return json({ erro: 'Método não permitido.' }, 405)
    const body = await parseJson(req)
    const { action, userId } = body
    const user = await getUserById(Number(userId), action === 'delete_submission')
    if (!user) return json({ erro: 'Usuário não encontrado.' }, 404)

    if (action === 'presence_ping') {
      await sql`UPDATE usuarios SET ultimo_acesso_em = CURRENT_TIMESTAMP, online = TRUE, atualizado_em = CURRENT_TIMESTAMP WHERE id = ${user.id}`
      const refreshed = await getUserById(user.id)
      return json({ sucesso: true, usuario: refreshed })
    }

    if (action === 'update_profile') {
      const { nome, instituicao, orcid, lattes, origem, telefone, receber_noticias_email } = body
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
        WHERE id = ${user.id}`
      const refreshed = await getUserById(user.id)
      return json({ sucesso: true, usuario: refreshed })
    }

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

    if (action === 'create_dossier') {
      if (!canAccess(user, ['editor_chefe'])) return json({ erro: 'Acesso negado.' }, 403)
      const { titulo, descricao, editorResponsavelId, dataAbertura, dataFechamento } = body
      if (!titulo || !descricao || !editorResponsavelId) return json({ erro: 'Preencha título, descrição e editor responsável.' }, 400)
      await sql`INSERT INTO dossies_tematicos (titulo, descricao, editor_responsavel_id, criado_por_editor_chefe_id, status, data_abertura, data_fechamento) VALUES (${titulo}, ${descricao}, ${editorResponsavelId}, ${user.id}, 'aberto', ${dataAbertura || null}, ${dataFechamento || null})`
      return json({ sucesso: true })
    }

    if (action === 'assign_reviewer') {
      if (!canAccess(user, ['editor_chefe', 'editor_adjunto'])) return json({ erro: 'Acesso negado.' }, 403)
      const { submissaoId, pareceristaId, prazoParecer, mensagemConvite } = body
      if (!submissaoId || !pareceristaId) return json({ erro: 'Informe submissão e parecerista.' }, 400)
      await sql`INSERT INTO designacoes_avaliacao (submissao_id, parecerista_id, editor_id, status, prazo_parecer, mensagem_convite) VALUES (${submissaoId}, ${pareceristaId}, ${user.id}, 'convite_enviado', ${prazoParecer || null}, ${mensagemConvite || null})`
      await sql`UPDATE submissoes SET status = 'alocada_sem_aceite', editor_responsavel_id = COALESCE(editor_responsavel_id, ${user.id}), editor_adjunto_id = CASE WHEN ${user.perfil} = 'editor_adjunto' THEN ${user.id} ELSE editor_adjunto_id END WHERE id = ${submissaoId}`
      return json({ sucesso: true })
    }

    if (action === 'update_designacao_status') {
      if (!canAccess(user, ['parecerista', 'editor_chefe', 'editor_adjunto'])) return json({ erro: 'Acesso negado.' }, 403)
      const { designacaoId, status, diasAdicionais } = body
      const rows = await sql`SELECT submissao_id FROM designacoes_avaliacao WHERE id = ${designacaoId} LIMIT 1`
      const statusVal = status || 'aceito'
      await sql`UPDATE designacoes_avaliacao SET status = ${statusVal}, dias_adicionais = COALESCE(${diasAdicionais || null}, dias_adicionais), atualizado_em = CURRENT_TIMESTAMP WHERE id = ${designacaoId}`
      if (rows[0]) {
        if (statusVal === 'aceito' || statusVal === 'em_andamento') await sql`UPDATE submissoes SET status = 'em_avaliacao' WHERE id = ${rows[0].submissao_id}`
        if (statusVal === 'recusado') await sql`UPDATE submissoes SET status = 'nao_alocada' WHERE id = ${rows[0].submissao_id}`
      }
      return json({ sucesso: true })
    }

    if (action === 'send_direct_message') {
      const { destinatarioId, mensagem, anexoUrl, anexoNome, anexoMime } = body
      if (!destinatarioId || !mensagem) return json({ erro: 'Informe destinatário e mensagem.' }, 400)
      await sql`INSERT INTO mensagens_internas (remetente_id, destinatario_id, mensagem, anexo_url, anexo_nome, anexo_mime) VALUES (${user.id}, ${destinatarioId}, ${mensagem}, ${anexoUrl || null}, ${anexoNome || null}, ${anexoMime || null})`
      return json({ sucesso: true })
    }

    if (action === 'submit_review') {
      if (!canAccess(user, ['parecerista'])) return json({ erro: 'Acesso negado.' }, 403)
      const { designacaoId, submissaoId, relevanciaAcademica, clarezaOrganizacao, consistenciaTeorica, adequacaoMetodologica, qualidadeRedacao, contribuicaoRelevanteArea, comentarioAutor, comentarioEditor, parecerFinal, tempoAvaliacao, devolutivaUrl } = body
      await sql`INSERT INTO avaliacoes (submissao_id, parecerista_id, designacao_id, relevancia_academica, clareza_organizacao, consistencia_teorica, adequacao_metodologica, qualidade_redacao, contribuicao_relevante_area, comentario_autor, comentario_editor, devolutiva_doc_url, parecer_final, tempo_avaliacao) VALUES (${submissaoId}, ${user.id}, ${designacaoId}, ${relevanciaAcademica}, ${clarezaOrganizacao}, ${consistenciaTeorica}, ${adequacaoMetodologica}, ${qualidadeRedacao}, ${contribuicaoRelevanteArea}, ${comentarioAutor || null}, ${comentarioEditor || null}, ${devolutivaUrl || null}, ${parecerFinal}, ${tempoAvaliacao})`
      await sql`UPDATE designacoes_avaliacao SET status = 'concluido' WHERE id = ${designacaoId}`
      return json({ sucesso: true })
    }

    if (action === 'request_certificate') {
      if (!canAccess(user, ['autor'])) return json({ erro: 'Acesso negado.' }, 403)
      const { nomeCompleto, email, certificadoMinicurso, certificadoParticipacaoGeral, certificadoComunicacaoOral, minicursos, autorizaPublicacaoTexto, resumoExpandido, tituloComunicacaoOral, autoresComunicacaoOral } = body
      await sql`INSERT INTO solicitacoes_certificados_evento (usuario_id, nome_completo, email, certificado_minicurso, certificado_participacao_geral, certificado_comunicacao_oral, minicursos, autoriza_publicacao_texto, resumo_expandido, titulo_comunicacao_oral, autores_comunicacao_oral) VALUES (${user.id}, ${nomeCompleto}, ${email}, ${!!certificadoMinicurso}, ${!!certificadoParticipacaoGeral}, ${!!certificadoComunicacaoOral}, ${minicursos || null}, ${typeof autorizaPublicacaoTexto === 'boolean' ? autorizaPublicacaoTexto : null}, ${resumoExpandido || null}, ${tituloComunicacaoOral || null}, ${autoresComunicacaoOral || null})`
      return json({ sucesso: true })
    }

    if (action === 'delete_submission') {
      if (!canAccess(user, ['editor_chefe'])) return json({ erro: 'Acesso negado.' }, 403)
      const { submissaoId, senhaConfirmacao } = body
      if (!submissaoId || !senhaConfirmacao) return json({ erro: 'Informe submissão e senha.' }, 400)
      const ok = await bcrypt.compare(senhaConfirmacao, user.senha_hash)
      if (!ok) return json({ erro: 'Senha de confirmação inválida.' }, 401)
      await sql`DELETE FROM submissoes WHERE id = ${submissaoId}`
      return json({ sucesso: true })
    }

    if (action === 'create_submission_for_author') {
      if (!canAccess(user, ['editor_chefe','editor_adjunto'])) return json({ erro: 'Acesso negado.' }, 403)
      const { autorId, titulo, secao, idioma, resumo, palavrasChave, dossieId } = body
      if (!titulo || !secao || !resumo) return json({ erro: 'Preencha título, seção e resumo.' }, 400)
      const autorFinal = autorId ? Number(autorId) : user.id
      const created = await sql`INSERT INTO submissoes (autor_id, titulo, secao, idioma, resumo, palavras_chave, dossie_id, status, editor_responsavel_id, editor_adjunto_id) VALUES (${autorFinal}, ${titulo}, ${secao}, ${idioma || 'pt-BR'}, ${resumo}, ${palavrasChave || null}, ${dossieId || null}, 'submetido', ${user.perfil === 'editor_chefe' ? user.id : null}, ${user.perfil === 'editor_adjunto' ? user.id : null}) RETURNING id`
      return json({ sucesso: true, submissaoId: created[0]?.id })
    }

    return json({ erro: 'Ação inválida.' }, 400)
  } catch (erro) {
    return json({ erro: 'Erro ao executar ação.', detalhe: erro.message }, 500)
  }
}
