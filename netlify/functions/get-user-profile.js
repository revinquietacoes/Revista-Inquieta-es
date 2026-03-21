const { json, getUserById } = require('./_db')
const { wrapHttp } = require('./_netlify')

function getHeader(headers, name) {
  return headers?.get?.(name) || headers?.get?.(name.toLowerCase()) || headers?.[name] || headers?.[name.toLowerCase()] || null
}

const main = async (req) => {
  try {
    if (req.method !== 'GET') return json({ erro: 'Método não permitido.' }, 405)

    const url = new URL(req.url)
    const userId = Number(getHeader(req.headers, 'x-user-id') || getHeader(req.headers, 'X-User-Id') || url.searchParams.get('user_id') || 0)
    if (!userId) return json({ erro: 'Usuário não autenticado.' }, 401)

    const user = await getUserById(userId)
    if (!user) return json({ erro: 'Usuário não encontrado.' }, 404)
    if (user.status !== 'ativo') return json({ erro: 'Usuário inativo.' }, 403)

    return json({
      id: user.id,
      full_name: user.nome,
      email: user.email,
      institution: user.instituicao,
      profile: user.perfil,
      status: user.status,
      orcid: user.orcid,
      lattes: user.lattes,
      origin: user.origem,
      phone: user.telefone,
      avatar_url: user.foto_perfil_url
    })
  } catch (error) {
    console.error('get-user-profile error:', error)
    return json({ erro: 'Erro interno ao buscar perfil.', detalhe: error.message }, 500)
  }
}

exports.handler = wrapHttp(main)