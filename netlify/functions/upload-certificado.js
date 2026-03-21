import { getStore } from '@netlify/blobs'
import { sql, getUserById, canAccess } from './_db.js'

const certificatesStore = getStore('certificados-usuarios')

function json(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  })
}

function sanitizeFileName(name) {
  return String(name || 'certificado.pdf')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .toLowerCase()
}

export default async (req) => {
  try {
    if (req.method !== 'POST') return json(405, { error: 'Método não permitido.' })

    const headerId = req.headers.get('x-user-id') || req.headers.get('X-User-Id')
    const editorId = Number(headerId || 0)
    if (!editorId) return json(401, { error: 'Usuário não autenticado.' })

    const editor = await getUserById(editorId)
    if (!editor || !canAccess(editor, ['editor_chefe'])) return json(403, { error: 'Apenas o editor-chefe pode enviar certificados.' })

    const body = await req.json()
    const { target_user_id, certificate_type, title, description, file_name, file_base64, mime_type } = body || {}

    if (!target_user_id || !certificate_type || !title || !file_base64) {
      return json(400, { error: 'Campos obrigatórios: target_user_id, certificate_type, title, file_base64.' })
    }

    const targetUser = await getUserById(Number(target_user_id))
    if (!targetUser) return json(404, { error: 'Usuário destinatário não encontrado.' })
    if (targetUser.status && targetUser.status !== 'ativo') return json(403, { error: 'Usuário destinatário inativo.' })

    const safeFileName = sanitizeFileName(file_name || `${title}.pdf`)
    const timestamp = Date.now()
    const blobKey = `usuarios/${targetUser.id}/certificados/${certificate_type}/${timestamp}-${safeFileName}`
    const buffer = Buffer.from(file_base64, 'base64')

    await certificatesStore.set(blobKey, buffer, {
      metadata: {
        titulo: title,
        descricao: description || '',
        tipo: certificate_type,
        usuario_id: String(targetUser.id),
        enviado_por_usuario_id: String(editorId),
        mime_type: mime_type || 'application/pdf'
      }
    })

    const inserted = await sql`
      INSERT INTO certificados_privados (usuario_id, enviado_por_usuario_id, titulo, descricao, tipo, categoria, blob_key, nome_arquivo, mime_type, tamanho_bytes)
      VALUES (${targetUser.id}, ${editorId}, ${title}, ${description || null}, ${certificate_type}, ${'certificado_' + certificate_type}, ${blobKey}, ${safeFileName}, ${mime_type || 'application/pdf'}, ${buffer.length})
      RETURNING id, criado_em
    `

    return json(201, { ok: true, certificate: inserted[0] })
  } catch (error) {
    console.error('upload-certificado error:', error)
    return json(500, { error: 'Erro interno ao enviar certificado.', detalhe: error.message })
  }
}
