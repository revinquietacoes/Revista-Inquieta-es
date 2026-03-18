import { sql, json, parseJson, getUserById, canAccess } from './_db.js'

export default async (req) => {
  try {
    if (req.method !== 'POST') return json({ erro: 'Método não permitido.' }, 405)
    const body = await parseJson(req)
    const { action, userId } = body
    const user = await getUserById(Number(userId))
    if (!user) return json({ erro: 'Usuário não encontrado.' }, 404)

    if (action === 'me') return json({ sucesso: true, usuario: user })

    if (action === 'author_dashboard') {
      if (!canAccess(user, ['autor'])) return json({ erro: 'Acesso negado.' }, 403)
      const submissoes = await sql`
        SELECT s.id, s.titulo, s.secao, s.status, s.data_submissao, s.prazo_final_avaliacao,
               dt.titulo AS dossie_titulo, u.nome AS editor_nome
        FROM submissoes s
        LEFT JOIN dossies_tematicos dt ON dt.id = s.dossie_id
        LEFT JOIN usuarios u ON u.id = COALESCE(s.editor_adjunto_id, s.editor_responsavel_id)
        WHERE s.autor_id = ${user.id}
        ORDER BY s.data_submissao DESC
      `
      return json({ sucesso: true, usuario: user, submissoes })
    }

    if (action === 'reviewer_dashboard') {
      if (!canAccess(user, ['parecerista'])) return json({ erro: 'Acesso negado.' }, 403)
      const avaliacoes = await sql`
        SELECT da.id, da.status, da.prazo_parecer, da.dias_adicionais,
               s.id AS submissao_id, s.titulo, s.resumo, s.palavras_chave, s.secao,
               af.url_arquivo, af.nome_arquivo
        FROM designacoes_avaliacao da
        JOIN submissoes s ON s.id = da.submissao_id
        LEFT JOIN arquivos_submissao af ON af.submissao_id = s.id AND af.categoria = 'principal'
        WHERE da.parecerista_id = ${user.id}
        ORDER BY da.criado_em DESC
      `
      return json({ sucesso: true, usuario: user, avaliacoes })
    }

    if (action === 'editor_dashboard') {
      if (!canAccess(user, ['editor_adjunto'])) return json({ erro: 'Acesso negado.' }, 403)
      const dossies = await sql`
        SELECT dt.*, uc.nome AS criado_por_nome
        FROM dossies_tematicos dt
        LEFT JOIN usuarios uc ON uc.id = dt.criado_por_editor_chefe_id
        WHERE dt.editor_responsavel_id = ${user.id}
        ORDER BY dt.criado_em DESC
      `
      const submissoes = await sql`
        SELECT s.id, s.titulo, s.status, s.secao, s.data_submissao,
               a.nome AS autor_nome, dt.titulo AS dossie_titulo
        FROM submissoes s
        LEFT JOIN usuarios a ON a.id = s.autor_id
        LEFT JOIN dossies_tematicos dt ON dt.id = s.dossie_id
        WHERE s.editor_adjunto_id = ${user.id}
           OR s.dossie_id IN (SELECT id FROM dossies_tematicos WHERE editor_responsavel_id = ${user.id})
        ORDER BY s.data_submissao DESC
      `
      const pareceristas = await sql`
        SELECT u.id, u.nome, u.email, u.instituicao, u.orcid, u.foto_perfil_url,
               COALESCE(c.total_avaliacoes, 0) AS total_avaliacoes
        FROM usuarios u
        LEFT JOIN contribuicoes_usuarios c ON c.usuario_id = u.id
        WHERE u.perfil = 'parecerista' AND u.status = 'ativo'
        ORDER BY u.nome ASC
      `
      return json({ sucesso: true, usuario: user, dossies, submissoes, pareceristas })
    }

    if (action === 'chief_dashboard') {
      if (!canAccess(user, ['editor_chefe'])) return json({ erro: 'Acesso negado.' }, 403)
      const usuarios = await sql`
        SELECT u.id, u.nome, u.email, u.perfil, u.instituicao, u.orcid, u.lattes,
               u.origem, u.telefone, u.status, u.foto_perfil_url,
               u.foto_perfil_aprovada, u.consentimento_foto_publica,
               COALESCE(c.total_submissoes, 0) AS total_submissoes,
               COALESCE(c.total_avaliacoes, 0) AS total_avaliacoes,
               COALESCE(c.total_dossies, 0) AS total_dossies,
               COALESCE(c.total_decisoes_editoriais, 0) AS total_decisoes_editoriais,
               c.observacoes
        FROM usuarios u
        LEFT JOIN contribuicoes_usuarios c ON c.usuario_id = u.id
        ORDER BY u.perfil, u.nome
      `
      const submissoes = await sql`
        SELECT s.id, s.titulo, s.status, s.secao, s.resumo, s.palavras_chave,
               s.prazo_final_avaliacao, s.data_submissao,
               a.nome AS autor_nome,
               er.nome AS editor_responsavel_nome,
               ea.nome AS editor_adjunto_nome,
               dt.titulo AS dossie_titulo
        FROM submissoes s
        LEFT JOIN usuarios a ON a.id = s.autor_id
        LEFT JOIN usuarios er ON er.id = s.editor_responsavel_id
        LEFT JOIN usuarios ea ON ea.id = s.editor_adjunto_id
        LEFT JOIN dossies_tematicos dt ON dt.id = s.dossie_id
        ORDER BY s.data_submissao DESC
      `
      const dossies = await sql`
        SELECT dt.*, u.nome AS editor_nome
        FROM dossies_tematicos dt
        LEFT JOIN usuarios u ON u.id = dt.editor_responsavel_id
        ORDER BY dt.criado_em DESC
      `
      const mensagens = await sql`
        SELECT ms.id, ms.mensagem, ms.criado_em, ms.visivel_ate,
               s.id AS submissao_id, s.titulo AS submissao_titulo,
               u.nome AS remetente_nome, u.perfil AS remetente_perfil
        FROM mensagens_submissao ms
        LEFT JOIN submissoes s ON s.id = ms.submissao_id
        LEFT JOIN usuarios u ON u.id = ms.remetente_id
        WHERE ms.visivel_ate > CURRENT_TIMESTAMP
        ORDER BY ms.criado_em DESC
        LIMIT 100
      `
      return json({ sucesso: true, usuario: user, usuarios, submissoes, dossies, mensagens })
    }

    if (action === 'public_dossiers') {
      const dossies = await sql`
        SELECT dt.id, dt.titulo, dt.descricao, dt.status, dt.data_abertura, dt.data_fechamento,
               u.nome AS editor_nome
        FROM dossies_tematicos dt
        LEFT JOIN usuarios u ON u.id = dt.editor_responsavel_id
        WHERE dt.status = 'aberto'
        ORDER BY dt.data_abertura DESC, dt.titulo ASC
      `
      return json({ sucesso: true, dossies })
    }

    return json({ erro: 'Ação inválida.' }, 400)
  } catch (erro) {
    return json({ erro: 'Erro ao carregar dados.', detalhe: erro.message }, 500)
  }
}
