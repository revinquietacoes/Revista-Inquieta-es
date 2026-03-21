import { sql, json, parseJson, getUserById, canAccess } from './_db.js'

export default async (req) => {
  try {
    if (req.method !== 'POST') return json({ erro: 'Método não permitido.' }, 405)
    const body = await parseJson(req)
    const { action, userId, targetUserId } = body
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
        ORDER BY s.data_submissao DESC`
      return json({ sucesso: true, usuario: user, submissoes })
    }

    if (action === 'reviewer_dashboard') {
      if (!canAccess(user, ['parecerista'])) return json({ erro: 'Acesso negado.' }, 403)
      const avaliacoes = await sql`
        SELECT da.id, da.status, da.prazo_parecer, da.dias_adicionais,
               s.id AS submissao_id, s.titulo, s.resumo, s.palavras_chave, s.secao,
               CASE WHEN da.status IN ('aceito','em_andamento','concluido') THEN af.url_arquivo ELSE NULL END AS url_arquivo,
               CASE WHEN da.status IN ('aceito','em_andamento','concluido') THEN af.nome_arquivo ELSE NULL END AS nome_arquivo
        FROM designacoes_avaliacao da
        JOIN submissoes s ON s.id = da.submissao_id
        LEFT JOIN arquivos_submissao af ON af.submissao_id = s.id AND af.categoria = 'principal'
        WHERE da.parecerista_id = ${user.id}
        ORDER BY da.criado_em DESC`
      return json({ sucesso: true, usuario: user, avaliacoes })
    }

    if (action === 'editor_dashboard') {
      if (!canAccess(user, ['editor_adjunto'])) return json({ erro: 'Acesso negado.' }, 403)
      const dossies = await sql`
        SELECT dt.*, uc.nome AS criado_por_nome
        FROM dossies_tematicos dt
        LEFT JOIN usuarios uc ON uc.id = dt.criado_por_editor_chefe_id
        WHERE dt.editor_responsavel_id = ${user.id}
        ORDER BY dt.criado_em DESC`
      const submissoes = await sql`
        SELECT s.id, s.titulo, s.status, s.secao, s.data_submissao, s.resumo, s.palavras_chave,
               a.nome AS autor_nome, a.foto_perfil_url AS autor_foto, a.foto_perfil_aprovada, a.consentimento_foto_publica,
               dt.titulo AS dossie_titulo, af.url_arquivo, af.nome_arquivo
        FROM submissoes s
        LEFT JOIN usuarios a ON a.id = s.autor_id
        LEFT JOIN dossies_tematicos dt ON dt.id = s.dossie_id
        LEFT JOIN arquivos_submissao af ON af.submissao_id = s.id AND af.categoria = 'principal'
        WHERE s.editor_adjunto_id = ${user.id}
           OR s.dossie_id IN (SELECT id FROM dossies_tematicos WHERE editor_responsavel_id = ${user.id})
        ORDER BY s.data_submissao DESC`
      const pareceristas = await sql`
        SELECT u.id, u.nome, u.email, u.instituicao, u.orcid, u.lattes, u.foto_perfil_url, u.foto_perfil_aprovada, u.consentimento_foto_publica,
               COALESCE(c.total_avaliacoes, 0) AS total_avaliacoes,
               CASE WHEN u.ultimo_acesso_em IS NOT NULL AND u.ultimo_acesso_em > (CURRENT_TIMESTAMP - INTERVAL '2 minutes') THEN TRUE ELSE FALSE END AS online,
               u.ultimo_acesso_em
        FROM usuarios u
        LEFT JOIN contribuicoes_usuarios c ON c.usuario_id = u.id
        WHERE u.perfil = 'parecerista' AND u.status = 'ativo'
        ORDER BY u.nome ASC`
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
               c.observacoes,
               CASE WHEN u.ultimo_acesso_em IS NOT NULL AND u.ultimo_acesso_em > (CURRENT_TIMESTAMP - INTERVAL '2 minutes') THEN TRUE ELSE FALSE END AS online,
               u.ultimo_acesso_em
        FROM usuarios u
        LEFT JOIN contribuicoes_usuarios c ON c.usuario_id = u.id
        ORDER BY u.perfil, u.nome`
      const submissoes = await sql`
        SELECT s.id, s.titulo, s.status, s.secao, s.resumo, s.palavras_chave,
               s.prazo_final_avaliacao, s.data_submissao,
               a.nome AS autor_nome, a.foto_perfil_url AS autor_foto, a.foto_perfil_aprovada, a.consentimento_foto_publica,
               er.nome AS editor_responsavel_nome,
               ea.nome AS editor_adjunto_nome,
               dt.titulo AS dossie_titulo,
               af.url_arquivo, af.nome_arquivo
        FROM submissoes s
        LEFT JOIN usuarios a ON a.id = s.autor_id
        LEFT JOIN usuarios er ON er.id = s.editor_responsavel_id
        LEFT JOIN usuarios ea ON ea.id = s.editor_adjunto_id
        LEFT JOIN dossies_tematicos dt ON dt.id = s.dossie_id
        LEFT JOIN arquivos_submissao af ON af.submissao_id = s.id AND af.categoria = 'principal'
        ORDER BY s.data_submissao DESC`
      const dossies = await sql`
        SELECT dt.*, u.nome AS editor_nome
        FROM dossies_tematicos dt
        LEFT JOIN usuarios u ON u.id = dt.editor_responsavel_id
        ORDER BY dt.criado_em DESC`
      const mensagens = await sql`
        SELECT m.*, ur.nome AS remetente_nome, ur.perfil AS remetente_perfil
        FROM mensagens_internas m
        LEFT JOIN usuarios ur ON ur.id = m.remetente_id
        WHERE m.destinatario_id = ${user.id} OR m.remetente_id = ${user.id}
        ORDER BY m.criado_em DESC
        LIMIT 100`
      return json({ sucesso: true, usuario: user, usuarios, submissoes, dossies, mensagens })
    }

    if (action === 'public_dossiers') {
      const dossies = await sql`
        SELECT dt.id, dt.titulo, dt.descricao, dt.status, dt.data_abertura, dt.data_fechamento,
               u.nome AS editor_nome
        FROM dossies_tematicos dt
        LEFT JOIN usuarios u ON u.id = dt.editor_responsavel_id
        WHERE dt.status = 'aberto'
        ORDER BY dt.data_abertura DESC, dt.titulo ASC`
      return json({ sucesso: true, dossies })
    }

    if (action === 'online_users') {
      if (!canAccess(user, ['editor_adjunto', 'editor_chefe'])) return json({ erro: 'Acesso negado.' }, 403)
      const rows = user.perfil === 'editor_chefe'
        ? await sql`SELECT id, nome, perfil, foto_perfil_url, foto_perfil_aprovada, consentimento_foto_publica, CASE WHEN ultimo_acesso_em IS NOT NULL AND ultimo_acesso_em > (CURRENT_TIMESTAMP - INTERVAL '2 minutes') THEN TRUE ELSE FALSE END AS online, ultimo_acesso_em FROM usuarios WHERE status='ativo' ORDER BY online DESC, ultimo_acesso_em DESC NULLS LAST, perfil, nome`
        : await sql`SELECT id, nome, perfil, foto_perfil_url, foto_perfil_aprovada, consentimento_foto_publica, CASE WHEN ultimo_acesso_em IS NOT NULL AND ultimo_acesso_em > (CURRENT_TIMESTAMP - INTERVAL '2 minutes') THEN TRUE ELSE FALSE END AS online, ultimo_acesso_em FROM usuarios WHERE status='ativo' AND perfil IN ('editor_chefe','editor_adjunto','parecerista') ORDER BY online DESC, ultimo_acesso_em DESC NULLS LAST, perfil, nome`
      return json({ sucesso: true, usuarios: rows })
    }

    if (action === 'chat_recipients') {
      let rows
      if (user.perfil === 'autor') rows = await sql`SELECT id, nome, perfil, foto_perfil_url, foto_perfil_aprovada, consentimento_foto_publica, CASE WHEN ultimo_acesso_em IS NOT NULL AND ultimo_acesso_em > (CURRENT_TIMESTAMP - INTERVAL '2 minutes') THEN TRUE ELSE FALSE END AS online, ultimo_acesso_em FROM usuarios WHERE status='ativo' AND perfil IN ('editor_chefe','editor_adjunto') ORDER BY online DESC, ultimo_acesso_em DESC NULLS LAST, perfil, nome`
      else if (user.perfil === 'editor_adjunto') rows = await sql`SELECT id, nome, perfil, foto_perfil_url, foto_perfil_aprovada, consentimento_foto_publica, CASE WHEN ultimo_acesso_em IS NOT NULL AND ultimo_acesso_em > (CURRENT_TIMESTAMP - INTERVAL '2 minutes') THEN TRUE ELSE FALSE END AS online, ultimo_acesso_em FROM usuarios WHERE status='ativo' ORDER BY online DESC, ultimo_acesso_em DESC NULLS LAST, perfil, nome`
      else rows = await sql`SELECT id, nome, perfil, foto_perfil_url, foto_perfil_aprovada, consentimento_foto_publica, CASE WHEN ultimo_acesso_em IS NOT NULL AND ultimo_acesso_em > (CURRENT_TIMESTAMP - INTERVAL '2 minutes') THEN TRUE ELSE FALSE END AS online, ultimo_acesso_em FROM usuarios WHERE status='ativo' ORDER BY online DESC, ultimo_acesso_em DESC NULLS LAST, perfil, nome`
      return json({ sucesso: true, usuarios: rows })
    }

    if (action === 'chat_messages') {
      const targetId = Number(targetUserId)
      if (!targetId) return json({ erro: 'Destinatário não informado.' }, 400)
      const allowedRecipients = user.perfil === 'autor'
        ? await sql`SELECT id FROM usuarios WHERE status='ativo' AND perfil IN ('editor_chefe','editor_adjunto') AND id = ${targetId}`
        : await sql`SELECT id FROM usuarios WHERE status='ativo' AND id = ${targetId}`
      if (!allowedRecipients.length) return json({ erro: 'Você não pode acessar esta conversa.' }, 403)
      const messages = await sql`
        SELECT m.*, ur.nome AS remetente_nome, ur.perfil AS remetente_perfil, ur.foto_perfil_url AS remetente_foto,
               ur.foto_perfil_aprovada AS remetente_foto_aprovada, ur.consentimento_foto_publica AS remetente_foto_consent,
               ud.nome AS destinatario_nome
        FROM mensagens_internas m
        JOIN usuarios ur ON ur.id = m.remetente_id
        JOIN usuarios ud ON ud.id = m.destinatario_id
        WHERE (m.remetente_id = ${user.id} AND m.destinatario_id = ${targetId}) OR (m.remetente_id = ${targetId} AND m.destinatario_id = ${user.id})
        ORDER BY m.criado_em ASC
        LIMIT 300`
      return json({ sucesso: true, mensagens: messages })
    }

    if (action === 'certificates') {
      const mapa = {
        autor: 'https://drive.google.com/drive/folders/1t_xVWLyB8qsC6Zm77z7OUXqalRu6XdWr?usp=drive_link',
        parecerista: 'https://drive.google.com/drive/folders/1mLe8TLFmVkL6QpscMVW2pZNmOJDTPcbs?usp=drive_link',
        editor_adjunto: 'https://drive.google.com/drive/folders/12oMGUyoZm3qLzuxdLIo-3x7plUMEWUyF?usp=drive_link',
        editor_chefe: 'https://drive.google.com/drive/folders/12oMGUyoZm3qLzuxdLIo-3x7plUMEWUyF?usp=drive_link'
      }
      return json({ sucesso: true, link: mapa[user.perfil] })
    }

    return json({ erro: 'Ação inválida.' }, 400)
  } catch (erro) {
    return json({ erro: 'Erro ao carregar dados.', detalhe: erro.message }, 500)
  }
}
