import { sql, json, getUserById, ensureSupportTables } from './_db.js'
import { wrapHttp } from './_netlify.js'

function getHeader(headers, name) {
  return headers?.get?.(name) || headers?.get?.(name.toLowerCase()) || headers?.[name] || headers?.[name.toLowerCase()] || null
}

function getAuthenticatedUserId(req, url) {
  const headerId = getHeader(req.headers, 'x-user-id') || getHeader(req.headers, 'X-User-Id')
  const queryId = url.searchParams.get('user_id')
  return Number(headerId || queryId || 0)
}

export default async (req) => {
  try {
    if (req.method !== 'GET') return json({ erro: 'Método não permitido.' }, 405)
    await ensureSupportTables()

    const url = new URL(req.url)
    const userId = getAuthenticatedUserId(req, url)
    if (!userId) return json({ erro: 'Usuário não autenticado.' }, 401)

    const user = await getUserById(userId)
    if (!user) return json({ erro: 'Usuário não encontrado.' }, 404)

    const type = String(url.searchParams.get('type') || '').trim()
    const rows = type
      ? await sql`SELECT id, tipo, categoria, titulo, nome_arquivo, mime_type, criado_em FROM certificados_privados WHERE usuario_id = ${user.id} AND tipo = ${type} ORDER BY criado_em DESC`
      : await sql`SELECT id, tipo, categoria, titulo, nome_arquivo, mime_type, criado_em FROM certificados_privados WHERE usuario_id = ${user.id} ORDER BY criado_em DESC`

    return json(rows.map((item) => ({
      id: item.id,
      certificate_type: item.tipo,
      category: item.categoria,
      title: item.titulo,
      file_name: item.nome_arquivo,
      mime_type: item.mime_type,
      created_at: item.criado_em
    })))
  } catch (error) {
    console.error('list-my-certificates error:', error)
    return json({ erro: 'Erro interno ao listar certificados.', detalhe: error.message }, 500)
  }
}

export const handler = wrapHttp(default)