const { sql, json, getUserById, getAuthenticatedUserId } = require('./_db')
const { wrapHttp } = require('./_netlify')

function err(message, status, detalhe) {
  return json({ erro: message, error: message, detalhe }, status)
}

const main = async (req) => {
  try {
    if (req.method !== 'POST') return err('Método não permitido.', 405)

    const userId = getAuthenticatedUserId(req)
    if (!userId) return err('Usuário não autenticado.', 401)

    const body = await req.json().catch(() => ({}))
    const { event_slug, course_name, observacoes = '' } = body
    if (!event_slug || !course_name) return err('Campos obrigatórios: event_slug e course_name.', 400)

    const user = await getUserById(userId)
    if (!user) return err('Somente usuários cadastrados podem se inscrever.', 403)
    if (user.status !== 'ativo') return err('Usuário inativo.', 403)
    if (user.perfil !== 'autor') return err('A inscrição é permitida apenas para usuários com perfil de autor.', 403)

    const existing = await sql`SELECT id FROM event_registrations WHERE user_id = ${userId} AND event_slug = ${event_slug} LIMIT 1`
    if (existing.length > 0) return err('Este usuário já está inscrito nesta atividade.', 409)

    const inserted = await sql`
      INSERT INTO event_registrations (user_id, event_slug, full_name, email, institution, course_name, observacoes)
      VALUES (${userId}, ${event_slug}, ${user.nome}, ${user.email}, ${user.instituicao || null}, ${course_name}, ${observacoes})
      RETURNING id, created_at
    `

    return json({ sucesso: true, ok: true, registration: inserted[0] }, 201)
  } catch (error) {
    return err('Erro interno ao criar inscrição.', 500, error.message)
  }
}

exports.handler = wrapHttp(main)
