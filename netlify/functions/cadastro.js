import bcrypt from 'bcryptjs'
import { sql, json, getTableColumns, normalizeRole } from './_db.js'
import { wrapHttp } from './_netlify.js'

export default async (req) => {
  try {
    if (req.method !== 'POST') return json({ erro: 'Método não permitido.' }, 405)

    const body = await req.json()
    const {
      nome, email, senha, perfil, instituicao, orcid, lattes,
      origem, telefone, foto_perfil_url, consentimento_foto_publica,
      receber_noticias_email
    } = body

    if (!nome || !email || !senha || !perfil) return json({ erro: 'Preencha nome, e-mail, senha e perfil.' }, 400)

    const perfilNormalizado = normalizeRole(perfil)
    const perfisPermitidos = ['autor', 'parecerista', 'editor_adjunto']
    if (!perfisPermitidos.includes(perfilNormalizado)) return json({ erro: 'Perfil inválido.' }, 400)

    const existente = await sql`SELECT id FROM usuarios WHERE email = ${email} LIMIT 1`
    if (existente.length > 0) return json({ erro: 'Já existe um usuário com este e-mail.' }, 409)

    const senhaHash = await bcrypt.hash(senha, 10)
    const statusInicial = perfilNormalizado === 'autor' ? 'ativo' : 'pendente'
    const cols = await getTableColumns('usuarios')

    const inserted = await sql(`
      INSERT INTO usuarios (
        nome, email, senha_hash, perfil,
        ${cols.has('instituicao') ? 'instituicao,' : ''}
        ${cols.has('orcid') ? 'orcid,' : ''}
        ${cols.has('lattes') ? 'lattes,' : ''}
        ${cols.has('origem') ? 'origem,' : ''}
        ${cols.has('telefone') ? 'telefone,' : ''}
        ${cols.has('foto_perfil_url') ? 'foto_perfil_url,' : ''}
        ${cols.has('foto_perfil_aprovada') ? 'foto_perfil_aprovada,' : ''}
        ${cols.has('consentimento_foto_publica') ? 'consentimento_foto_publica,' : ''}
        ${cols.has('receber_noticias_email') ? 'receber_noticias_email,' : ''}
        ${cols.has('status') ? 'status' : ''}
      ) VALUES (
        $1, $2, $3, $4,
        ${cols.has('instituicao') ? '$5,' : ''}
        ${cols.has('orcid') ? '$6,' : ''}
        ${cols.has('lattes') ? '$7,' : ''}
        ${cols.has('origem') ? '$8,' : ''}
        ${cols.has('telefone') ? '$9,' : ''}
        ${cols.has('foto_perfil_url') ? '$10,' : ''}
        ${cols.has('foto_perfil_aprovada') ? '$11,' : ''}
        ${cols.has('consentimento_foto_publica') ? '$12,' : ''}
        ${cols.has('receber_noticias_email') ? '$13,' : ''}
        ${cols.has('status') ? '$14' : ''}
      )
      RETURNING id, nome, email, perfil, ${cols.has('status') ? 'status' : "'ativo'::text AS status"}
    `.replace(/,\s*\)/g, ')').replace(/\(\s*,/g, '('), [
      nome, email, senhaHash, perfilNormalizado,
      instituicao || null,
      orcid || null,
      lattes || null,
      origem || null,
      telefone || null,
      foto_perfil_url || 'assets/avatares/avatar-padrao.png',
      false,
      Boolean(consentimento_foto_publica),
      Boolean(receber_noticias_email),
      statusInicial
    ])

    return json({
      sucesso: true,
      usuario: inserted[0],
      mensagem: statusInicial === 'ativo'
        ? 'Cadastro realizado com sucesso. Você já pode acessar o sistema.'
        : 'Cadastro recebido. O acesso é liberado após autorização da editoria-chefe.'
    })
  } catch (erro) {
    return json({ erro: 'Erro ao cadastrar usuário.', detalhe: erro.message }, 500)
  }
}

export const handler = wrapHttp(default)