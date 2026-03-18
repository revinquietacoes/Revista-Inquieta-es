import { neon } from '@netlify/neon'
import bcrypt from 'bcryptjs'

const sql = neon()

export default async (req) => {
  try {
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ erro: 'Método não permitido.' }), { status: 405 })
    }

    const body = await req.json()

    const {
      nome,
      email,
      senha,
      perfil,
      orcid,
      lattes,
      origem,
      telefone
    } = body

    if (!nome || !email || !senha || !perfil) {
      return new Response(JSON.stringify({ erro: 'Preencha os campos obrigatórios.' }), { status: 400 })
    }

    const perfisPermitidos = ['autor', 'parecerista', 'editor_adjunto']
    if (!perfisPermitidos.includes(perfil)) {
      return new Response(JSON.stringify({ erro: 'Perfil inválido.' }), { status: 400 })
    }

    const existente = await sql`
      SELECT id FROM usuarios WHERE email = ${email} LIMIT 1
    `

    if (existente.length > 0) {
      return new Response(JSON.stringify({ erro: 'Já existe um usuário com este e-mail.' }), { status: 409 })
    }

    const senhaHash = await bcrypt.hash(senha, 10)

    const resultado = await sql`
      INSERT INTO usuarios (
        nome,
        email,
        senha_hash,
        perfil,
        orcid,
        lattes,
        origem,
        telefone,
        status
      )
      VALUES (
        ${nome},
        ${email},
        ${senhaHash},
        ${perfil},
        ${orcid || ''},
        ${lattes || ''},
        ${origem || ''},
        ${telefone || ''},
        'ativo'
      )
      RETURNING id, nome, email, perfil
    `

    return new Response(JSON.stringify({
      sucesso: true,
      usuario: resultado[0]
    }), { status: 200 })

  } catch (erro) {
    return new Response(JSON.stringify({
      erro: 'Erro ao cadastrar usuário.',
      detalhe: erro.message
    }), { status: 500 })
  }
}