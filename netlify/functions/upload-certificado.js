const { getStore } = require('@netlify/blobs')
const { sql, json, getUserById, ensureSupportTables, canAccess } = require('./_db')
const { wrapHttp } = require('./_netlify')

const certificatesStore = getStore('certificados-usuarios')

function getHeader(headers, name) {
  if (!headers) return null
  if (typeof headers.get === 'function') {
    return headers.get(name) || headers.get(name.toLowerCase()) || null
  }
  return headers[name] || headers[name.toLowerCase()] || null
}

function getAuthenticatedUserId(req) {
  return Number(
    getHeader(req.headers, 'x-user-id') ||
    getHeader(req.headers, 'X-User-Id') ||
    0
  )
}

function sanitizeFileName(name) {
  return String(name || 'certificado.pdf')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
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
    if (req.method !== 'POST') {
      return json({ erro: 'Método não permitido.' }, 405)
    }

    await ensureSupportTables()

    const editorId = getAuthenticatedUserId(req)
    if (!editorId) {
      return json({ erro: 'Usuário não autenticado.' }, 401)
    }

    const editor = await getUserById(editorId)
    if (!editor) {
      return json({ erro: 'Usuário não encontrado.' }, 404)
    }

    if (editor.status !== 'ativo') {
      return json({ erro: 'Usuário inativo.' }, 403)
    }

    if (!canAccess(editor, ['editor_chefe'])) {
      return json({ erro: 'Apenas o editor-chefe pode enviar certificados.' }, 403)
    }

    const form = await req.formData()
    const targetUserId = Number(form.get('target_user_id') || form.get('targetUserId') || 0)
    const certificateType = String(form.get('certificate_type') || form.get('tipo') || '')
    const title = String(form.get('title') || form.get('titulo') || '')
    const description = String(form.get('description') || form.get('descricao') || '')
    const arquivo = form.get('arquivo') || form.get('file')

    if (!targetUserId || !certificateType || !title || !arquivo || typeof arquivo === 'string') {
      return json({
        erro: 'Campos obrigatórios: target_user_id, certificate_type, title e arquivo.'
      }, 400)
    }

    const targetUser = await getUserById(targetUserId)
    if (!targetUser) {
      return json({ erro: 'Usuário destinatário não encontrado.' }, 404)
    }

    if (targetUser.status !== 'ativo') {
      return json({ erro: 'Usuário destinatário inativo.' }, 403)
    }

    const mimeType = arquivo.type || 'application/pdf'
    if (mimeType !== 'application/pdf') {
      return json({ erro: 'Envie um arquivo PDF.' }, 400)
    }

    const bytes = Buffer.from(await arquivo.arrayBuffer())
    if (!bytes.length) {
      return json({ erro: 'Arquivo vazio ou inválido.' }, 400)
    }

    const safeFileName = sanitizeFileName(arquivo.name || `${title}.pdf`)
    const timestamp = Date.now()
    const blobKey = `usuarios/${targetUser.id}/certificados/${certificateType}/${timestamp}-${safeFileName}`

    await certificatesStore.set(blobKey, bytes, {
      metadata: {
        title,
        tipo: certificateType,
        target_user_id: String(targetUser.id),
        uploaded_by: String(editorId),
        mime_type: mimeType
      }
    })

    const inserted = await sql`
      INSERT INTO certificados_privados (
        usuario_id,
        enviado_por_usuario_id,
        titulo,
        descricao,
        tipo,
        categoria,
        blob_key,
        nome_arquivo,
        mime_type,
        tamanho_bytes
      )
      VALUES (
        ${targetUser.id},
        ${editorId},
        ${title},
        ${description || null},
        ${certificateType},
        ${mapCategory(certificateType)},
        ${blobKey},
        ${safeFileName},
        ${mimeType},
        ${bytes.length}
      )
      RETURNING id, criado_em
    `

    return json({ sucesso: true, certificado: inserted[0] }, 201)
  } catch (error) {
    return json({
      erro: 'Erro interno ao enviar certificado.',
      detalhe: error.message
    }, 500)
  }
}

exports.handler = wrapHttp(main)
