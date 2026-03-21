import { sql, json, getUserById } from './_db.js'

export default async (req) => {
  try {
    if (req.method !== 'GET') return json({ error: 'Método não permitido.' }, 405)

    const url = new URL(req.url)
    const headerId = req.headers.get('x-user-id') || req.headers.get('X-User-Id')
    const userId = Number(headerId || url.searchParams.get('user_id') || 0)
    if (!userId) return json({ error: 'Usuário não autenticado.' }, 401)

    const user = await getUserById(userId)
    if (!user) return json({ error: 'Usuário não encontrado.' }, 404)

    const type = url.searchParams.get('type')
    const rows = type
      ? await sql`SELECT id, tipo AS certificate_type, titulo AS title, criado_em AS created_at FROM certificados_privados WHERE usuario_id = ${userId} AND tipo = ${type} ORDER BY criado_em DESC`
      : await sql`SELECT id, tipo AS certificate_type, titulo AS title, criado_em AS created_at FROM certificados_privados WHERE usuario_id = ${userId} ORDER BY criado_em DESC`

    return json(rows)
  } catch (error) {
    console.error('list-my-certificates error:', error)
    return json({ error: 'Erro interno ao listar certificados.' }, 500)
  }
}
