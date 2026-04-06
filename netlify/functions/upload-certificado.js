const { makeStore } = require('./_blobs')
const { sql, json, getUserById, ensureSupportTables, canAccess, getAuthenticatedUserId } = require('./_db')
const { wrapHttp } = require('./_netlify')
const crypto = require('crypto')

const certificatesStore = makeStore('certificados-usuarios')

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

async function readPayload(req) {
  const ctype = String(req.headers.get('content-type') || '')
  if (ctype.includes('multipart/form-data')) {
    const form = await req.formData()
    const arquivo = form.get('arquivo') || form.get('file')
    return {
      targetUserId: Number(form.get('target_user_id') || form.get('targetUserId') || 0),
      certificateType: String(form.get('certificate_type') || form.get('certificateType') || form.get('tipo') || 'evento'),
      title: String(form.get('title') || form.get('titulo') || ''),
      description: String(form.get('description') || form.get('descricao') || ''),
      arquivo
    }
  }

  const body = await req.json().catch(() => ({}))
  return {
    targetUserId: Number(body.target_user_id || body.targetUserId || 0),
    certificateType: String(body.certificate_type || body.certificateType || body.tipo || 'evento'),
    title: String(body.title || body.titulo || ''),
    description: String(body.description || body.descricao || ''),
    fileName: body.file_name || body.fileName || null,
    mimeType: body.mime_type || body.mimeType || 'application/pdf',
    fileBase64: body.file_base64 || body.fileBase64 || null
  }
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
    if (!canAccess(editor, ['editor_chefe'])) {
      return json({ erro: 'Apenas o editor-chefe pode enviar certificados.' }, 403)
    }

    const payload = await readPayload(req)
    if (!payload.targetUserId || !payload.certificateType || !payload.title) {
      return json({ erro: 'Campos obrigatórios: usuário, tipo e título.' }, 400)
    }

    const targetUser = await getUserById(payload.targetUserId)
    if (!targetUser) return json({ erro: 'Usuário destinatário não encontrado.' }, 404)
    if (targetUser.status !== 'ativo') return json({ erro: 'Usuário destinatário inativo.' }, 403)

    let bytes, mimeType, safeFileName

    if (payload.arquivo && typeof payload.arquivo !== 'string') {
      mimeType = payload.arquivo.type || 'application/pdf'
      if (mimeType !== 'application/pdf') return json({ erro: 'Envie um arquivo PDF.' }, 400)
      bytes = Buffer.from(await payload.arquivo.arrayBuffer())
      safeFileName = sanitizeFileName(payload.arquivo.name || `${payload.title}.pdf`)
    } else if (payload.fileBase64) {
      try {
        bytes = Buffer.from(payload.fileBase64, 'base64')
      } catch {
        return json({ erro: 'Arquivo em base64 inválido.' }, 400)
      }
      mimeType = payload.mimeType || 'application/pdf'
      safeFileName = sanitizeFileName(payload.fileName || `${payload.title}.pdf`)
    } else {
      return json({ erro: 'Selecione um arquivo PDF.' }, 400)
    }

    if (!bytes || !bytes.length) return json({ erro: 'Arquivo vazio ou inválido.' }, 400)

    const blobKey = `usuarios/${targetUser.id}/certificados/${payload.certificateType}/${Date.now()}-${safeFileName}`

    await certificatesStore.set(blobKey, bytes, {
      metadata: {
        title: payload.title,
        tipo: payload.certificateType,
        target_user_id: String(targetUser.id),
        uploaded_by: String(editorId),
        mime_type: mimeType
      }
    })

    // Gera código único de autenticidade para validação pública
    const codigoAutenticidade = crypto.randomUUID()

    const inserted = await sql`
      INSERT INTO certificados_privados (
        usuario_id, enviado_por_usuario_id, titulo, descricao, tipo, categoria, blob_key,
        nome_arquivo, mime_type, tamanho_bytes, codigo_autenticidade
      )
      VALUES (
        ${targetUser.id}, ${editorId}, ${payload.title}, ${payload.description || null},
        ${payload.certificateType}, ${mapCategory(payload.certificateType)}, ${blobKey},
        ${safeFileName}, ${mimeType}, ${bytes.length}, ${codigoAutenticidade}
      )
      RETURNING id, criado_em, codigo_autenticidade
    `

    return json({
      sucesso: true,
      certificado: inserted[0],
      codigo_autenticidade: inserted[0].codigo_autenticidade
    }, 201)
  } catch (error) {
    console.error('Erro em upload-certificado:', error)
    return json({ erro: 'Erro interno ao enviar certificado.', detalhe: error.message }, 500)
  }
}

exports.handler = wrapHttp(main)