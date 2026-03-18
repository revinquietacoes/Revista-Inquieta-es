import { neon } from '@netlify/neon'
import bcrypt from 'bcryptjs'

const sql = neon(process.env.NETLIFY_DATABASE_URL)

export default async (req) => {
  try {
    if (req.method !== 'POST') {
      return new Response(
        JSON.stringify({ erro: 'Método não permitido.' }),
        {
          status: 405,
          headers: { 'Content-Type': 'application/json' }
        }
      )
    }

    const body = await req.json()
    const { email, senha } = body

    if (!email || !senha) {
      return new Response(
        JSON.stringify({ erro: 'Informe e-mail e senha.' }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        }
      )
    }

    const usuarios = await sql`
      SELECT * FROM usuarios
      WHERE email = ${email}
      LIMIT 1
    `

    if (usuarios.length === 0) {
      return new Response(
        JSON.stringify({ erro: 'Usuário não encontrado.' }),
        {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        }
      )
    }

    const usuario = usuarios[0]

    if (usuario.status && usuario.status !== 'ativo') {
      return new Response(
        JSON.stringify({ erro: 'Usuário inativo ou pendente.' }),
        {
          status: 403,
          headers: { 'Content-Type': 'application/json' }
        }
      )
    }

    const senhaOk = await bcrypt.compare(senha, usuario.senha_hash)

    if (!senhaOk) {
      return new Response(
        JSON.stringify({ erro: 'Senha inválida.' }),
        {
          status: 401,
          headers: { 'Content-Type': 'application/json' }
        }
      )
    }

    return new Response(
      JSON.stringify({
        sucesso: true,
        usuario: {
          id: usuario.id,
          nome: usuario.nome,
          email: usuario.email,
          perfil: usuario.perfil
        }
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    )

  } catch (erro) {
    return new Response(
      JSON.stringify({
        erro: 'Erro ao realizar login.',
        detalhe: erro.message
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    )
  }
}
