import { getStore } from '@netlify/blobs'
import { sql, getUserById, ensureSupportTables } from './_db.js'
import { wrapHttp } from './_netlify.js'

const certificatesStore = getStore('certificados-usuarios')

function getHeader(headers, name) {
  return headers?.get?.(name) || headers?.get?.(name.toLowerCase()) || headers?.[name] || headers?.[name.toLowerCase()] || null
}

function getAuthenticatedUserId(req, url) {
  const headerId = getHeader(req.headers, 'x-user-id') || getHeader(req.headers, 'X-User-Id')
  const queryId = url.searchParams.get('user_id')
  return Number(headerId || queryId || 0)
}

function safeDownloadName(name) {
  return String(name || 'certificado')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-')
}

export default async (req) => {
  try {
    if (req.method !== 'GET') return new Response('Método não permitido.', { status: 405 })
    await ensureSupportTables()

    const url = new URL(req.url)
    const userId = getAuthenticatedUserId(req, url)
    if (!userId) return new Response('Usuário não autenticado.', { status: 401 })

    const user = await getUserById(userId)
    if (!user) return new Response('Usuário não encontrado.', { status: 404 })

    const certificateId = Number(url.searchParams.get('id') || 0)
    if (!certificateId) return new Response('Parâmetro id é obrigatório.', { status: 400 })

    const rows = await sql`
      SELECT id, usuario_id, titulo, blob_key, mime_type, nome_arquivo
      FROM certificados_privados
      WHERE id = ${certificateId}
      LIMIT 1
    `

    if (!rows.length) return new Response('Certificado não encontrado.', { status: 404 })

    const cert = rows[0]
    if (Number(cert.usuario_id) !== Number(user.id)) return new Response('Acesso negado.', { status: 403 })

    const blob = await certificatesStore.get(cert.blob_key, { type: 'arrayBuffer' })
    if (!blob) return new Response('Arquivo do certificado não encontrado.', { status: 404 })

    const fileName = safeDownloadName(cert.nome_arquivo || cert.titulo || 'certificado.pdf')
    return new Response(blob, {
      status: 200,
      headers: {
        'Content-Type': cert.mime_type || 'application/pdf',
        'Content-Disposition': `inline; filename="${fileName.endsWith('.pdf') ? fileName : `${fileName}.pdf`}"`,
        'Cache-Control': 'private, no-store'
      }
    })
  } catch (error) {
    console.error('get-my-certificate error:', error)
    return new Response('Erro interno ao obter certificado.', { status: 500 })
  }
}

export const handler = wrapHttp(default)