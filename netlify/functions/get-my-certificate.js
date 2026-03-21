import { getStore } from '@netlify/blobs'
import { sql, getUserById } from './_db.js'

const certificatesStore = getStore('certificados-usuarios')

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

    const url = new URL(req.url)
    const headerId = req.headers.get('x-user-id') || req.headers.get('X-User-Id')
    const userId = Number(headerId || url.searchParams.get('user_id') || 0)
    if (!userId) return new Response('Usuário não autenticado.', { status: 401 })

    const user = await getUserById(userId)
    if (!user) return new Response('Usuário não encontrado.', { status: 404 })

    const certificateId = Number(url.searchParams.get('id') || 0)
    if (!certificateId) return new Response('Parâmetro id é obrigatório.', { status: 400 })

    const rows = await sql`SELECT id, usuario_id, titulo, blob_key, mime_type FROM certificados_privados WHERE id = ${certificateId} LIMIT 1`
    if (!rows.length) return new Response('Certificado não encontrado.', { status: 404 })

    const cert = rows[0]
    if (Number(cert.usuario_id) !== Number(userId)) return new Response('Acesso negado.', { status: 403 })

    const blob = await certificatesStore.get(cert.blob_key, { type: 'arrayBuffer' })
    if (!blob) return new Response('Arquivo do certificado não encontrado.', { status: 404 })

    const fileName = `${safeDownloadName(cert.titulo)}.pdf`
    return new Response(blob, {
      status: 200,
      headers: {
        'Content-Type': cert.mime_type || 'application/pdf',
        'Content-Disposition': `inline; filename="${fileName}"`,
        'Cache-Control': 'private, no-store'
      }
    })
  } catch (error) {
    console.error('get-my-certificate error:', error)
    return new Response('Erro interno ao obter certificado.', { status: 500 })
  }
}
