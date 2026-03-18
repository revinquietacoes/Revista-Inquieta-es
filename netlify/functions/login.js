import { neon } from '@netlify/neon'
import bcrypt from 'bcryptjs'

const sql = neon(process.env.DATABASE_URL || process.env.NETLIFY_DATABASE_URL)

export default async (req) => {
  try {
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ erro: 'Método não permitido.' }), { status: 405, headers: { 'Content-Type': 'application/json' } })
    }

    const { email, senha } = await req.json()
    if (!email || !senha) {
      return new Response(JSON.stringify({ erro: 'Informe e-mail e senha.' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
    }

    const rows = await sql`
      SELECT id, nome, email, senha_hash, perfil, status, instituicao, orcid, lattes, origem, telefone,
             foto_perfil_url, foto_perfil_aprovada, consentimento_foto_publica, receber_noticias_email
      FROM usuarios
      WHERE email = ${email}
      LIMIT 1
    `

    if (!rows.length) {
      return new Response(JSON.stringify({ erro: 'Usuário não encontrado.' }), { status: 404, headers: { 'Content-Type': 'application/json' } })
    }

    const usuario = rows[0]
    if (usuario.status === 'pendente') {
      return new Response(JSON.stringify({ erro: 'Cadastro pendente de autorização da editoria-chefe.' }), { status: 403, headers: { 'Content-Type': 'application/json' } })
    }
    if (usuario.status !== 'ativo') {
      return new Response(JSON.stringify({ erro: 'Usuário inativo.' }), { status: 403, headers: { 'Content-Type': 'application/json' } })
    }

    const senhaValida = await bcrypt.compare(senha, usuario.senha_hash)
    if (!senhaValida) {
      return new Response(JSON.stringify({ erro: 'Senha inválida.' }), { status: 401, headers: { 'Content-Type': 'application/json' } })
    }

    return new Response(JSON.stringify({ sucesso: true, usuario }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  } catch (erro) {
    return new Response(JSON.stringify({ erro: 'Erro ao realizar login.', detalhe: erro.message }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
}
