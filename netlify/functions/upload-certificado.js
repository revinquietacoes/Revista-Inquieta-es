const { getStore } = require('@netlify/blobs')
const { sql, json, getUserById, ensureSupportTables, canAccess } = require('./_db')
const { wrapHttp } = require('./_netlify')

const certificatesStore = getStore('certificados-usuarios')

function getHeader(headers, name) {
  return headers?.get?.(name) || headers?.get?.(name.toLowerCase()) || headers?.[name] || headers?.[name.toLowerCase()] || null
}

function getAuthenticatedUserId(req) {
  return Number(getHeader(req.headers, 'x-user-id') || getHeader(req.headers, 'X-User-Id') || 0)
}

function sanitizeFileName(name) {
  return String(name || 'certificado.pdf')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
}

function mapCategory(tipo) {
  if (tipo === 'parecer' || tipo === 'parecerista') return 'certificado_parecer'
  if (tipo === 'equipe_editorial') return 'certificado_equipe'
  return 'certificado_evento'
}

const main = async (req) => {
  try {
    if (req.method !== 'POST') return json({ erro: 'Método não permitido.' }, 405)
    await ensureSupportTables()

    const editorId = getAuthenticatedUserId(req)
    if (!editorId) return json({ erro: 'Usuário não autenticado.' }, 401)

    const editor = await getUserById(editorId)
    if (!editor) return json({ erro: 'Usuário não encontrado.' }, 404)
    if (editor.status !== 'ativo') return json({ erro: 'Usuário inativo.' }, 403)
    if (!canAccess(editor, ['editor_chefe'])) return json({ erro: 'Apenas o editor-chefe pode enviar certificados.' }, 403)

    const body = await req.json()
    const { target_user_id, certificate_type, title, description, file_name, file_base64, mime_type } = body || {}
    const targetUserId = Number(target_user_id || 0)

    if (!targetUserId || !certificate_type || !title || !file_base64) {
      return json({ erro: 'Campos obrigatórios: target_user_id, certificate_type, title e file_base64.' }, 400)
    }

    const targetUser = await getUserById(targetUserId)
    if (!targetUser) return json({ erro: 'Usuário destinatário não encontrado.' }, 404)
    if (targetUser.status !== 'ativo') return json({ erro: 'Usuário destinatário inativo.' }, 403)

    const safeFileName = sanitizeFileName(file_name || `${title}.pdf`)
    const timestamp = Date.now()
    const blobKey = `usuarios/${targetUser.id}/certificados/${certificate_type}/${timestamp}-${safeFileName}`
    const buffer = Buffer.from(file_base64, 'base64')

    await certificatesStore.set(blobKey, buffer, {
      metadata: {
        title,
        tipo: certificate_type,
        target_user_id: String(targetUser.id),
        uploaded_by: String(editorId),
        mime_type: mime_type || 'application/pdf'
      }
    })

    const inserted = await sql`
      INSERT INTO certificados_privados (
        usuario_id, enviado_por_usuario_id, titulo, descricao, tipo, categoria,
        blob_key, nome_arquivo, mime_type, tamanho_bytes
      ) VALUES (
        ${targetUser.id}, ${editorId}, ${title}, ${description || null}, ${certificate_type}, ${mapCategory(certificate_type)},
        ${blobKey}, ${safeFileName}, ${mime_type || 'application/pdf'}, ${buffer.length}
      )
      RETURNING id, criado_em
    `

    return json({ ok: true, certificate: inserted[0] }, 201)
  } catch (error) {
    console.error('upload-certificado error:', error)
    return json({ erro: 'Erro interno ao enviar certificado.', detalhe: error.message }, 500)
  }
}

exports.handler = wrapHttp(main)