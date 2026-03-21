import bcrypt from 'bcryptjs'
import { sql, json, getTableColumns, normalizeRole } from './_db.js'
import { wrapHttp } from './_netlify.js'

export default async (req) => {
  try {
    if (req.method !== 'POST') return json({ erro: 'Método não permitido.' }, 405)

    const { email, senha } = await req.json()
    if (!email || !senha) return json({ erro: 'Informe e-mail e senha.' }, 400)

    const cols = await getTableColumns('usuarios')
    const rows = await sql(`
      SELECT
        id,
        nome,
        email,
        senha_hash,
        ${cols.has('perfil') ? 'perfil' : "'autor'::text"} AS perfil,
        ${cols.has('status') ? 'status' : "'ativo'::text"} AS status,
        ${cols.has('instituicao') ? 'instituicao' : 'NULL AS instituicao'},
        ${cols.has('orcid') ? 'orcid' : 'NULL AS orcid'},
        ${cols.has('lattes') ? 'lattes' : 'NULL AS lattes'},
        ${cols.has('origem') ? 'origem' : 'NULL AS origem'},
        ${cols.has('telefone') ? 'telefone' : 'NULL AS telefone'},
        ${cols.has('foto_perfil_url') ? 'foto_perfil_url' : 'NULL AS foto_perfil_url'},
        ${cols.has('foto_perfil_aprovada') ? 'foto_perfil_aprovada' : 'FALSE AS foto_perfil_aprovada'},
        ${cols.has('consentimento_foto_publica') ? 'consentimento_foto_publica' : 'FALSE AS consentimento_foto_publica'},
        ${cols.has('receber_noticias_email') ? 'receber_noticias_email' : 'FALSE AS receber_noticias_email'}
      FROM usuarios
      WHERE email = $1
      LIMIT 1
    `, [email])

    if (!rows.length) return json({ erro: 'Usuário não encontrado.' }, 404)

    const usuario = rows[0]
    usuario.perfil = normalizeRole(usuario.perfil)

    if (usuario.status === 'pendente') return json({ erro: 'Cadastro pendente de autorização da editoria-chefe.' }, 403)
    if (usuario.status !== 'ativo') return json({ erro: 'Usuário inativo.' }, 403)

    const senhaValida = await bcrypt.compare(senha, usuario.senha_hash)
    if (!senhaValida) return json({ erro: 'Senha inválida.' }, 401)

    return json({ sucesso: true, usuario })
  } catch (erro) {
    return json({ erro: 'Erro ao realizar login.', detalhe: erro.message }, 500)
  }
}

export const handler = wrapHttp(default)