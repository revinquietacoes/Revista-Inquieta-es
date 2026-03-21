const { neon } = require('@netlify/neon')
const { wrapHttp } = require('./_netlify')

const sql = neon(
  process.env.NETLIFY_DATABASE_URL_UNPOOLED ||
  process.env.DATABASE_URL ||
  process.env.NETLIFY_DATABASE_URL ||
  ''
)

function json(data, statusCode = 200) {
  return new Response(JSON.stringify(data), {
    status: statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  })
}

function getAuthenticatedUserId(req, url) {
  const headerId = req.headers.get('x-user-id') || req.headers.get('X-User-Id')
  const queryId = url.searchParams.get('user_id')
  return Number(headerId || queryId || 0)
}

const main = async (req) => {
  try {
    if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405)

    const url = new URL(req.url)
    const userId = getAuthenticatedUserId(req, url)
    if (!userId) return json({ error: 'Usuário não autenticado.' }, 401)

    const body = await req.json().catch(() => ({}))
    const { event_slug, course_name, observacoes = '' } = body
    if (!event_slug || !course_name) {
      return json({ error: 'Campos obrigatórios: event_slug e course_name.' }, 400)
    }

    const users = await sql`SELECT id, nome, email, instituicao, perfil, status FROM usuarios WHERE id = ${userId} LIMIT 1`
    if (!users.length) return json({ error: 'Somente usuários cadastrados podem se inscrever.' }, 403)

    const user = users[0]
    if (user.status !== 'ativo') return json({ error: 'Usuário inativo.' }, 403)
    if (user.perfil !== 'autor') {
      return json({ error: 'A inscrição é permitida apenas para usuários com perfil de autor.' }, 403)
    }

    const existing = await sql`SELECT id FROM event_registrations WHERE user_id = ${userId} AND event_slug = ${event_slug} LIMIT 1`
    if (existing.length > 0) return json({ error: 'Este usuário já está inscrito nesta atividade.' }, 409)

    const inserted = await sql`
      INSERT INTO event_registrations (user_id, event_slug, full_name, email, institution, course_name, observacoes)
      VALUES (${userId}, ${event_slug}, ${user.nome}, ${user.email}, ${user.instituicao}, ${course_name}, ${observacoes})
      RETURNING id, created_at`

    return json({ ok: true, registration: inserted[0] }, 201)
  } catch (error) {
    console.error('create-event-registration error:', error)
    return json({ error: 'Erro interno ao criar inscrição.', detalhe: error.message }, 500)
  }
}

exports.handler = wrapHttp(main)
