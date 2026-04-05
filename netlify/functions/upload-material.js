// netlify/functions/upload-material.js - versão corrigida usando API REST do Netlify Blobs
const { sql, json, ensureSupportTables, getUserById, getAuthenticatedUserId, canAccess } = require('./_db')
const { wrapHttp } = require('./_netlify')

function sanitizarNome(nome = '') {
  return String(nome)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
}

async function resolveActorAndTarget(req, form) {
  const actorId = getAuthenticatedUserId(req, form.get('usuario_id')) || Number(form.get('usuario_id') || 0)
  const targetUserId = Number(form.get('usuario_id') || actorId || 0)

  if (!targetUserId) {
    return { error: json({ erro: 'Usuário inválido para upload.' }, 403) }
  }

  const actor = actorId ? await getUserById(actorId) : null
  if (actorId && !actor) return { error: json({ erro: 'Usuário autenticado não encontrado.' }, 404) }
  if (actor && actor.status && actor.status !== 'ativo') {
    return { error: json({ erro: 'Usuário autenticado inativo.' }, 403) }
  }

  const targetUser = await getUserById(targetUserId)
  if (!targetUser) return { error: json({ erro: 'Usuário de destino não encontrado.' }, 404) }
  if (targetUser.status && targetUser.status !== 'ativo') {
    return { error: json({ erro: 'Usuário de destino inativo.' }, 403) }
  }

  const ownUpload = actorId === targetUserId || !actorId
  const privileged = actor && canAccess(actor, ['editor_chefe', 'editor_adjunto'])

  if (!ownUpload && !privileged) {
    return { error: json({ erro: 'Você não pode enviar arquivo para outro usuário.' }, 403) }
  }

  return { actor, targetUser }
}

const main = async (req) => {
  try {
    if (req.method !== 'POST') return json({ erro: 'Método não permitido.' }, 405)
    await ensureSupportTables()

    const form = await req.formData()
    const submissaoId = form.get('submissao_id') ? Number(form.get('submissao_id')) : null
    const categoria = String(form.get('categoria') || 'outro')
    const arquivo = form.get('arquivo')

    if (!arquivo || typeof arquivo === 'string') {
      return json({ erro: 'Selecione um arquivo válido.' }, 400)
    }

    const roleInfo = await resolveActorAndTarget(req, form)
    if (roleInfo.error) return roleInfo.error
    const { targetUser } = roleInfo

    const permitidos = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'image/jpeg',
      'image/png',
      'image/webp',
      'audio/mpeg', 'audio/wav', 'audio/webm', 'audio/ogg',
      'video/mp4', 'video/webm'
    ]

    if (!permitidos.includes(arquivo.type)) {
      return json({ erro: 'Tipo de arquivo não permitido.' }, 400)
    }

    if (arquivo.size > 10_000_000) { // 10MB para anexos de chat
      return json({ erro: 'Arquivo acima do limite de 10 MB.' }, 400)
    }

    // Usar API REST do Netlify Blobs em vez do getStore
    const siteID = process.env.NETLIFY_BLOBS_SITE_ID
    const token = process.env.NETLIFY_BLOBS_TOKEN
    const storeName = 'revista-arquivos'

    if (!siteID || !token) {
      throw new Error('Variáveis de ambiente do Blobs não configuradas')
    }

    const timestamp = Date.now()
    const safeName = sanitizarNome(arquivo.name || 'arquivo')
    const blobKey = `usuarios/${targetUser.id}/${categoria}/${timestamp}-${safeName}`

    const bytes = Buffer.from(await arquivo.arrayBuffer())
    const blobUrl = `https://api.netlify.com/api/v1/sites/${siteID}/blobs/${storeName}/${encodeURIComponent(blobKey)}`

    const uploadResponse = await fetch(blobUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': arquivo.type
      },
      body: bytes
    })

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text()
      throw new Error(`Erro ao salvar blob: ${uploadResponse.status} - ${errorText}`)
    }

    const urlAcesso = `/.netlify/functions/arquivo?key=${encodeURIComponent(blobKey)}`
    const inserido = await sql`
      INSERT INTO arquivos_publicacao (
        usuario_id, submissao_id, categoria, nome_original, mime_type, tamanho_bytes, blob_key, blob_store, url_acesso, publico
      )
      VALUES (
        ${targetUser.id}, ${submissaoId}, ${categoria}, ${arquivo.name}, ${arquivo.type}, ${arquivo.size}, ${blobKey}, 'revista-arquivos', ${urlAcesso}, FALSE
      )
      RETURNING id, url_acesso, blob_key
    `

    // ... resto igual (inserção em tabelas auxiliares)
    // (mantenha a parte de arquivos_submissao e arquivos_avaliacao)

    return json({ sucesso: true, arquivo: inserido[0] })
  } catch (erro) {
    console.error('upload-material erro:', erro)
    return json({ erro: 'Erro ao enviar arquivo.', detalhe: erro.message }, 500)
  }
}

exports.handler = wrapHttp(main)