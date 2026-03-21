const { getStore } = require('@netlify/blobs')
const { sql, json, ensureSupportTables, requireAuthenticatedUser, getUserById, canAccess } = require('./_db')
const { wrapHttp } = require('./_netlify')

const certificatesStore = getStore('certificados-usuarios')

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
    if (req.method !== 'POST') {
      return json({ erro: 'Método não permitido.' }, 405)
    }

    await ensureSupportTables()

    const auth = await requireAuthenticatedUser(req)
    if (auth.error) return auth.error
    const editor = auth.user

    if (!canAccess(editor, ['editor_chefe'])) {
      return json({ erro: 'Apenas o editor-chefe pode enviar certificados.' }, 403)
    }

    const form = await req.formData()
    const targetUserId = Number(form.get('target_user_id') || 0)
    const certificateType = String(form.get('certificate_type') || '')
    const title = String(form.get('title') || '').trim()
    const description = String(form.get('description') || '').trim()
    const arquivo = form.get('arquivo')

    if (!targetUserId || !certificateType || !title || !arquivo || typeof arquivo === 'string') {
      return json({ erro: 'Campos obrigatórios: target_user_id, certificate_type, title e arquivo.' }, 400)
    }

    const targetUser = await getUserById(targetUserId)
    if (!targetUser) {
      return json({ erro: 'Usuário destinatário não encontrado.' }, 404)
    }

    const mimeType = arquivo.type || 'application/pdf'
    if (mimeType !== 'application/pdf') {
      return json({ erro: 'Envie um arquivo PDF.' }, 400)
    }

    const buffer = Buffer.from(await arquivo.arrayBuffer())
    if (!buffer.length) {
      return json({ erro: 'Arquivo vazio ou inválido.' }, 400)
    }

    const safeFileName = sanitizeFileName(arquivo.name || `${title}.pdf`)
    const timestamp = Date.now()
    const blobKey = `usuarios/${targetUser.id}/certificados/${certificateType}/${timestamp}-${safeFileName}`

    await certificatesStore.set(blobKey, buffer, {
      metadata: {
        title,
        tipo: certificateType,
        target_user_id: String(targetUser.id),
        uploaded_by: String(editor.id),
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
        ${editor.id},
        ${title},
        ${description || null},
        ${certificateType},
        ${mapCategory(certificateType)},
        ${blobKey},
        ${safeFileName},
        ${mimeType},
        ${buffer.length}
      )
      RETURNING id, criado_em
    `

    return json({ sucesso: true, certificado: inserted[0] }, 201)
  } catch (error) {
    return json({ erro: 'Erro interno ao enviar certificado.', detalhe: error.message }, 500)
  }
}

exports.handler = wrapHttp(main)
