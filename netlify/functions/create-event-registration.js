const { sql, json, getUserById } = require('./_db')
const { wrapHttp } = require('./_netlify')

function getHeader(headers, name) {
  if (!headers) return null
  if (typeof headers.get === 'function') {
    return headers.get(name) || headers.get(name.toLowerCase()) || null
  }
  return headers[name] || headers[name.toLowerCase()] || null
}

const main = async (req) => {
  try {
    if (req.method !== 'POST') return json({ erro: 'Método não permitido.' }, 405)

    const userId = Number(getHeader(req.headers, 'x-user-id') || getHeader(req.headers, 'X-User-Id') || 0)
    if (!userId) return json({ erro: 'Usuário não autenticado.' }, 401)

    const body = await req.json().catch(() => ({}))
    const { event_slug, course_name, observacoes = '' } = body

    if (!event_slug || !course_name) {
      return json({ erro: 'Campos obrigatórios: event_slug e course_name.' }, 400)
    }

    const user = await getUserById(userId)
    if (!user) return json({ erro: 'Somente usuários cadastrados podem se inscrever.' }, 403)
    if (user.status !== 'ativo') return json({ erro: 'Usuário inativo.' }, 403)
    if (user.perfil !== 'autor') {
      return json({ erro: 'A inscrição é permitida apenas para usuários com perfil de autor.' }, 403)
    }

    const existing = await sql`SELECT id FROM event_registrations WHERE user_id = ${userId} AND event_slug = ${event_slug} LIMIT 1`
    if (existing.length > 0) {
      return json({ erro: 'Este usuário já está inscrito nesta atividade.' }, 409)
    }

    const inserted = await sql`
      INSERT INTO event_registrations (
        user_id, event_slug, full_name, email, institution, course_name, observacoes
      ) VALUES (
        ${userId}, ${event_slug}, ${user.nome}, ${user.email}, ${user.instituicao || null}, ${course_name}, ${observacoes}
      )
      RETURNING id, created_at
    `

    return json({ ok: true, registration: inserted[0] }, 201)
  } catch (error) {
    return json({ erro: 'Erro interno ao criar inscrição.', detalhe: error.message }, 500)
  }
}

exports.handler = wrapHttp(main)
