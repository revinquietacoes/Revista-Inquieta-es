const bcrypt = require('bcryptjs')
const { sql, json, normalizeRole } = require('./_db')
const { wrapHttp } = require('./_netlify')

const main = async (req) => {
  try {
    if (req.method !== 'POST') return json({ erro: 'Método não permitido.' }, 405)

    const body = await req.json().catch(() => ({}))
    const { email, senha } = body

    if (!email || !senha) return json({ erro: 'Informe e-mail e senha.' }, 400)

    const rows = await sql`
      SELECT *
      FROM usuarios
      WHERE email = ${email}
      LIMIT 1
    `

    if (!rows.length) return json({ erro: 'Usuário não encontrado.' }, 404)

    const usuario = rows[0]
    usuario.perfil = normalizeRole(usuario.perfil)

    if (usuario.status === 'pendente') {
      return json({ erro: 'Cadastro pendente de autorização da editoria-chefe.' }, 403)
    }
    if (usuario.status && usuario.status !== 'ativo') {
      return json({ erro: 'Usuário inativo.' }, 403)
    }

    const senhaValida = await bcrypt.compare(senha, usuario.senha_hash || '')
    if (!senhaValida) return json({ erro: 'Senha inválida.' }, 401)

    // Atualiza último acesso e online
    await sql`UPDATE usuarios SET ultimo_acesso_em = CURRENT_TIMESTAMP, online = TRUE, atualizado_em = CURRENT_TIMESTAMP WHERE id = ${usuario.id}`

    // Retorna o usuário (sem a senha)
    delete usuario.senha_hash
    return json({ sucesso: true, usuario })
  } catch (erro) {
    console.error('login erro:', erro)
    return json({ erro: 'Erro ao realizar login.', detalhe: erro.message }, 500)
  }
}

exports.handler = wrapHttp(main)