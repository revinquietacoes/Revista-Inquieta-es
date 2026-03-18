import { neon } from '@netlify/neon'
import bcrypt from 'bcryptjs'

const sql = neon()

export default async (req) => {
  try {
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ erro: 'Método não permitido.' }), { status: 405 })
    }

    const body = await req.json()
    const { email, senha } = body

    if (!email || !senha) {
      return new Response(JSON.stringify({ erro: 'Informe e-mail e senha.' }), { status: 400 })
    }

    const usuarios = await sql`
      SELECT * FROM usuarios
      WHERE email = ${email}
      LIMIT 1
    `

    if (usuarios.length === 0) {
      return new Response(JSON.stringify({ erro: 'Usuário não encontrado.' }), { status: 404 })
    }

    const usuario = usuarios[0]

    if (usuario.status && usuario.status !== 'ativo') {
      return new Response(JSON.stringify({ erro: 'Usuário inativo ou pendente.' }), { status: 403 })
    }

    const senhaOk = await bcrypt.compare(senha, usuario.senha_hash)

    if (!senhaOk) {
      return new Response(JSON.stringify({ erro: 'Senha inválida.' }), { status: 401 })
    }

    return new Response(JSON.stringify({
      sucesso: true,
      usuario: {
        id: usuario.id,
        nome: usuario.nome,
        email: usuario.email,
        perfil: usuario.perfil
      }
    }), { status: 200 })

  } catch (erro) {
    return new Response(JSON.stringify({
      erro: 'Erro ao realizar login.',
      detalhe: erro.message
    }), { status: 500 })
  }
}