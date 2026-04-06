const { sql, json, parseJson, getUserById, canAccess, ensureSupportTables, tableExists } = require('./_db')
const { wrapHttp } = require('./_netlify')

async function main(req) {

  try {

    const body = parseJson(req.body || "{}")
    const params = req.queryStringParameters || {}

    const action = params.action || body.action
    const userId = req.headers["x-user-id"]

    if (!userId) {
      return json({ erro: "Usuário não autenticado." }, 401)
    }

    const user = await getUserById(userId)

    if (!user) {
      return json({ erro: "Usuário inválido." }, 401)
    }

    await ensureSupportTables()

    // ===============================
    // CERTIFICADOS
    // ===============================

    if (action === "certificates") {

      const mapa = {

        autor:
          "https://drive.google.com/drive/folders/1t_xVWLyB8qsC6Zm77z7OUXqalRu6XdWr",

        parecerista:
          "https://drive.google.com/drive/folders/1mLe8TLFmVkL6QpscMVW2pZNmOJDTPcbs",

        editor:
          "https://drive.google.com/drive/folders/12oMGUyoZm3qLzuxdLIo-3x7plUMEWUyF",

        editor_adjunto:
          "https://drive.google.com/drive/folders/12oMGUyoZm3qLzuxdLIo-3x7plUMEWUyF",

        editor_chefe:
          "https://drive.google.com/drive/folders/12oMGUyoZm3qLzuxdLIo-3x7plUMEWUyF"

      }

      return json({
        sucesso: true,
        link: mapa[user.perfil]
      })

    }

    // ===============================
    // USUÁRIOS ONLINE
    // ===============================

    if (action === "online_users") {

      const rows = await sql`
        SELECT
          id,
          nome,
          perfil,
          foto_perfil_url,
          foto_perfil_aprovada,
          consentimento_foto_publica,
          CASE
            WHEN ultimo_acesso_em IS NOT NULL
            AND ultimo_acesso_em > (CURRENT_TIMESTAMP - INTERVAL '2 minutes')
            THEN TRUE
            ELSE FALSE
          END AS online,
          ultimo_acesso_em
        FROM usuarios
        WHERE COALESCE(status,'ativo')='ativo'
        ORDER BY online DESC, ultimo_acesso_em DESC NULLS LAST
      `

      return json({
        sucesso: true,
        usuarios: rows
      })

    }

    // ===============================
    // DOSSIÊS PÚBLICOS
    // ===============================

    if (action === "public_dossiers") {

      const dossies = await sql`
        SELECT
          id,
          titulo,
          descricao,
          status,
          data_abertura,
          data_fechamento
        FROM dossies_tematicos
        WHERE status='aberto'
        ORDER BY data_abertura DESC
      `

      return json({
        sucesso: true,
        dossies
      })

    }

    // ===============================
    // CHAT
    // ===============================

    if (action === "chat_messages") {

      const targetId = Number(params.targetUserId)

      if (!targetId) {
        return json({ erro: "Destinatário não informado." }, 400)
      }

      const mensagens = await sql`
        SELECT
          m.*,
          ur.nome AS remetente_nome,
          ur.perfil AS remetente_perfil,
          ud.nome AS destinatario_nome
        FROM mensagens_internas m
        JOIN usuarios ur ON ur.id = m.remetente_id
        JOIN usuarios ud ON ud.id = m.destinatario_id
        WHERE
          (m.remetente_id = ${user.id} AND m.destinatario_id = ${targetId})
          OR
          (m.remetente_id = ${targetId} AND m.destinatario_id = ${user.id})
        ORDER BY m.criado_em ASC
        LIMIT 300
      `

      return json({
        sucesso: true,
        mensagens
      })

    }

    // ===============================
    // PERFIL
    // ===============================

    if (action === "update_profile") {

      const {
        nome,
        instituicao,
        orcid,
        lattes,
        telefone
      } = body

      await sql`
        UPDATE usuarios
        SET
          nome = COALESCE(${nome || null}, nome),
          instituicao = ${instituicao || null},
          orcid = ${orcid || null},
          lattes = ${lattes || null},
          telefone = ${telefone || null},
          atualizado_em = CURRENT_TIMESTAMP
        WHERE id = ${user.id}
      `

      const refreshed = await getUserById(user.id)

      return json({
        sucesso: true,
        usuario: refreshed
      })

    }

    // ===============================
    // AÇÃO INVÁLIDA
    // ===============================

    return json({
      erro: "Ação inválida."
    }, 400)

  } catch (erro) {

    console.error("Erro em data.js:", erro)

    return json({
      erro: "Erro ao carregar dados.",
      detalhe: erro.message
    }, 500)

  }

}

exports.handler = wrapHttp(main)