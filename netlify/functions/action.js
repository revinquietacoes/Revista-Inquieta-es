import { sql, json, parseJson, getUserById, canAccess } from './_db.js'

export default async (req) => {
  try {
    if (req.method !== 'POST') return json({ erro: 'Método não permitido.' }, 405)
    const body = await parseJson(req)
    const { action, userId } = body
    const user = await getUserById(Number(userId))
    if (!user) return json({ erro: 'Usuário não encontrado.' }, 404)

    if (action === 'approve_user') {
      if (!canAccess(user, ['editor_chefe'])) return json({ erro: 'Acesso negado.' }, 403)
      const { targetUserId, status, foto_perfil_aprovada, consentimento_foto_publica, total_avaliacoes } = body
      if (status) {
        await sql`UPDATE usuarios SET status = ${status} WHERE id = ${targetUserId}`
      }
      if (typeof foto_perfil_aprovada === 'boolean' || typeof consentimento_foto_publica === 'boolean') {
        await sql`
          UPDATE usuarios
          SET foto_perfil_aprovada = COALESCE(${typeof foto_perfil_aprovada === 'boolean' ? foto_perfil_aprovada : null}, foto_perfil_aprovada),
              consentimento_foto_publica = COALESCE(${typeof consentimento_foto_publica === 'boolean' ? consentimento_foto_publica : null}, consentimento_foto_publica)
          WHERE id = ${targetUserId}
        `
      }
      if (Number.isFinite(Number(total_avaliacoes))) {
        await sql`
          INSERT INTO contribuicoes_usuarios (usuario_id, total_avaliacoes)
          VALUES (${targetUserId}, ${Number(total_avaliacoes)})
          ON CONFLICT (usuario_id) DO UPDATE
          SET total_avaliacoes = EXCLUDED.total_avaliacoes,
              atualizado_em = CURRENT_TIMESTAMP
        `
      }
      return json({ sucesso: true })
    }

    if (action === 'create_dossier') {
      if (!canAccess(user, ['editor_chefe'])) return json({ erro: 'Acesso negado.' }, 403)
      const { titulo, descricao, editorResponsavelId, dataAbertura, dataFechamento } = body
      if (!titulo || !descricao || !editorResponsavelId) return json({ erro: 'Preencha título, descrição e editor responsável.' }, 400)
      await sql`
        INSERT INTO dossies_tematicos (
          titulo, descricao, editor_responsavel_id, criado_por_editor_chefe_id,
          status, data_abertura, data_fechamento
        ) VALUES (
          ${titulo}, ${descricao}, ${editorResponsavelId}, ${user.id},
          'aberto', ${dataAbertura || null}, ${dataFechamento || null}
        )
      `
      return json({ sucesso: true })
    }

    if (action === 'assign_reviewer') {
      if (!canAccess(user, ['editor_chefe', 'editor_adjunto'])) return json({ erro: 'Acesso negado.' }, 403)
      const { submissaoId, pareceristaId, prazoParecer, mensagemConvite } = body
      if (!submissaoId || !pareceristaId) return json({ erro: 'Informe submissão e parecerista.' }, 400)
      await sql`
        INSERT INTO designacoes_avaliacao (
          submissao_id, parecerista_id, editor_id, status, prazo_parecer, mensagem_convite
        ) VALUES (
          ${submissaoId}, ${pareceristaId}, ${user.id}, 'convite_enviado', ${prazoParecer || null}, ${mensagemConvite || null}
        )
      `
      await sql`UPDATE submissoes SET status = 'alocada_sem_aceite' WHERE id = ${submissaoId}`
      return json({ sucesso: true })
    }

    if (action === 'update_designacao_status') {
      if (!canAccess(user, ['parecerista', 'editor_chefe', 'editor_adjunto'])) return json({ erro: 'Acesso negado.' }, 403)
      const { designacaoId, status, diasAdicionais } = body
      const statusVal = status || 'aceito'
      await sql`
        UPDATE designacoes_avaliacao
        SET status = ${statusVal},
            dias_adicionais = COALESCE(${diasAdicionais || null}, dias_adicionais),
            atualizado_em = CURRENT_TIMESTAMP
        WHERE id = ${designacaoId}
      `
      if (statusVal === 'aceito' || statusVal === 'em_andamento') {
        const rows = await sql`SELECT submissao_id FROM designacoes_avaliacao WHERE id = ${designacaoId} LIMIT 1`
        if (rows[0]) await sql`UPDATE submissoes SET status = 'em_avaliacao' WHERE id = ${rows[0].submissao_id}`
      }
      return json({ sucesso: true })
    }

    if (action === 'send_message') {
      if (!canAccess(user, ['autor', 'parecerista', 'editor_adjunto', 'editor_chefe'])) return json({ erro: 'Acesso negado.' }, 403)
      const { submissaoId, mensagem } = body
      if (!mensagem) return json({ erro: 'Escreva a mensagem.' }, 400)
      await sql`
        INSERT INTO mensagens_submissao (submissao_id, remetente_id, mensagem)
        VALUES (${submissaoId || null}, ${user.id}, ${mensagem})
      `
      return json({ sucesso: true })
    }

    if (action === 'submit_review') {
      if (!canAccess(user, ['parecerista'])) return json({ erro: 'Acesso negado.' }, 403)
      const {
        designacaoId, submissaoId, relevanciaAcademica, clarezaOrganizacao, consistenciaTeorica,
        adequacaoMetodologica, qualidadeRedacao, contribuicaoRelevanteArea,
        comentarioAutor, comentarioEditor, parecerFinal, tempoAvaliacao, devolutivaUrl
      } = body
      await sql`
        INSERT INTO avaliacoes (
          submissao_id, parecerista_id, designacao_id,
          relevancia_academica, clareza_organizacao, consistencia_teorica,
          adequacao_metodologica, qualidade_redacao, contribuicao_relevante_area,
          comentario_autor, comentario_editor, devolutiva_doc_url,
          parecer_final, tempo_avaliacao
        ) VALUES (
          ${submissaoId}, ${user.id}, ${designacaoId},
          ${relevanciaAcademica}, ${clarezaOrganizacao}, ${consistenciaTeorica},
          ${adequacaoMetodologica}, ${qualidadeRedacao}, ${contribuicaoRelevanteArea},
          ${comentarioAutor || null}, ${comentarioEditor || null}, ${devolutivaUrl || null},
          ${parecerFinal}, ${tempoAvaliacao}
        )
      `
      await sql`UPDATE designacoes_avaliacao SET status = 'concluido' WHERE id = ${designacaoId}`
      await sql`UPDATE submissoes SET status = 'em_avaliacao' WHERE id = ${submissaoId}`
      return json({ sucesso: true })
    }

    if (action === 'request_certificate') {
      if (!canAccess(user, ['autor'])) return json({ erro: 'Acesso negado.' }, 403)
      const {
        nomeCompleto, email, certificadoMinicurso, certificadoParticipacaoGeral,
        certificadoComunicacaoOral, minicursos, autorizaPublicacaoTexto,
        resumoExpandido, tituloComunicacaoOral, autoresComunicacaoOral
      } = body
      await sql`
        INSERT INTO solicitacoes_certificados_evento (
          usuario_id, nome_completo, email,
          certificado_minicurso, certificado_participacao_geral, certificado_comunicacao_oral,
          minicursos, autoriza_publicacao_texto, resumo_expandido,
          titulo_comunicacao_oral, autores_comunicacao_oral
        ) VALUES (
          ${user.id}, ${nomeCompleto}, ${email},
          ${!!certificadoMinicurso}, ${!!certificadoParticipacaoGeral}, ${!!certificadoComunicacaoOral},
          ${minicursos || null}, ${typeof autorizaPublicacaoTexto === 'boolean' ? autorizaPublicacaoTexto : null}, ${resumoExpandido || null},
          ${tituloComunicacaoOral || null}, ${autoresComunicacaoOral || null}
        )
      `
      return json({ sucesso: true })
    }

    return json({ erro: 'Ação inválida.' }, 400)
  } catch (erro) {
    return json({ erro: 'Erro ao executar ação.', detalhe: erro.message }, 500)
  }
}
