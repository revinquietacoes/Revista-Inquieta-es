import { neon } from '@netlify/neon'
import bcrypt from 'bcryptjs'

const sql = neon(process.env.DATABASE_URL || process.env.NETLIFY_DATABASE_URL)

export default async (req) => {
  try {
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ erro: 'Método não permitido.' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    const body = await req.json()
    const {
      nome, email, senha, perfil, instituicao, orcid, lattes,
      origem, telefone, foto_perfil_url, consentimento_foto_publica,
      receber_noticias_email
    } = body

    if (!nome || !email || !senha || !perfil) {
      return new Response(JSON.stringify({ erro: 'Preencha nome, e-mail, senha e perfil.' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
    }

    const perfisPermitidos = ['autor', 'parecerista', 'editor_adjunto']
    if (!perfisPermitidos.includes(perfil)) {
      return new Response(JSON.stringify({ erro: 'Perfil inválido.' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
    }

    const existente = await sql`SELECT id FROM usuarios WHERE email = ${email} LIMIT 1`
    if (existente.length > 0) {
      return new Response(JSON.stringify({ erro: 'Já existe um usuário com este e-mail.' }), { status: 409, headers: { 'Content-Type': 'application/json' } })
    }

    const senhaHash = await bcrypt.hash(senha, 10)
    const statusInicial = perfil === 'autor' ? 'ativo' : 'pendente'

    const resultado = await sql`
      INSERT INTO usuarios (
        nome, email, senha_hash, perfil, instituicao, orcid, lattes, origem, telefone,
        foto_perfil_url, foto_perfil_aprovada, consentimento_foto_publica,
        receber_noticias_email, status
      ) VALUES (
        ${nome}, ${email}, ${senhaHash}, ${perfil}, ${instituicao || null},
        ${orcid || null}, ${lattes || null}, ${origem || null}, ${telefone || null},
        ${foto_perfil_url || 'assets/avatares/avatar-padrao.png'},
        ${false}, ${Boolean(consentimento_foto_publica)},
        ${Boolean(receber_noticias_email)}, ${statusInicial}
      )
      RETURNING id, nome, email, perfil, status, instituicao, orcid, lattes, origem, telefone,
                foto_perfil_url, foto_perfil_aprovada, consentimento_foto_publica, receber_noticias_email
    `

    return new Response(JSON.stringify({
      sucesso: true,
      usuario: resultado[0],
      mensagem: statusInicial === 'ativo'
        ? 'Cadastro realizado com sucesso. Você já pode acessar o sistema.'
        : 'Cadastro recebido. O acesso é liberado após autorização da editoria-chefe.'
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  } catch (erro) {
    return new Response(JSON.stringify({ erro: 'Erro ao cadastrar usuário.', detalhe: erro.message }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
}
