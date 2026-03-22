const { getStore } = require('@netlify/blobs')
const {
  sql,
  json,
  getUserById,
  ensureSupportTables,
  getAuthenticatedUserId,
  canAccess
} = require('./_db')
const { wrapHttp } = require('./_netlify')

const store = getStore('revista-arquivos')

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
  const actorId = getAuthenticatedUserId(req, form.get('usuario_id'))
  const targetUserId = Number(form.get('usuario_id') || actorId || 0)
  if (!actorId || !targetUserId) return { error: json({ erro: 'Usuário inválido para envio da foto.' }, 403) }

  const actor = await getUserById(actorId)
  if (!actor) return { error: json({ erro: 'Usuário autenticado não encontrado.' }, 404) }
  if (actor.status && actor.status !== 'ativo') return { error: json({ erro: 'Usuário autenticado inativo.' }, 403) }

  const targetUser = await getUserById(targetUserId)
  if (!targetUser) return { error: json({ erro: 'Usuário de destino não encontrado.' }, 404) }
  if (targetUser.status && targetUser.status !== 'ativo') return { error: json({ erro: 'Usuário de destino inativo.' }, 403) }

  const ownUpload = actorId === targetUserId
  const privileged = canAccess(actor, ['editor_chefe', 'editor_adjunto'])
  if (!ownUpload && !privileged) return { error: json({ erro: 'Você não pode enviar foto para outro usuário.' }, 403) }

  return { actor, targetUser }
}

const main = async (req) => {
  try {
    if (req.method !== 'POST') return json({ erro: 'Método não permitido.' }, 405)
    await ensureSupportTables()

    const form = await req.formData()
    const consentimento = String(form.get('consentimento') || 'false') === 'true'
    const arquivo = form.get('arquivo')
    if (!arquivo || typeof arquivo === 'string') return json({ erro: 'Selecione um arquivo de imagem.' }, 400)

    const roleInfo = await resolveActorAndTarget(req, form)
    if (roleInfo.error) return roleInfo.error
    const { targetUser } = roleInfo

    const tiposPermitidos = ['image/jpeg', 'image/png', 'image/webp']
    if (!tiposPermitidos.includes(arquivo.type)) return json({ erro: 'Envie JPG, PNG ou WEBP.' }, 400)
    if (arquivo.size > 2_000_000) return json({ erro: 'A foto deve ter até 2 MB.' }, 400)

    const antigos = await sql`
      SELECT id, blob_key
      FROM arquivos_publicacao
      WHERE usuario_id = ${targetUser.id}
        AND categoria = 'foto_perfil'
      ORDER BY id DESC
    `

    const blobKey = `usuarios/${targetUser.id}/avatar/${Date.now()}-${sanitizarNome(arquivo.name || 'avatar')}`
    const buffer = Buffer.from(await arquivo.arrayBuffer())

    await store.set(blobKey, buffer, {
      metadata: {
        usuario_id: String(targetUser.id),
        categoria: 'foto_perfil',
        nome_original: arquivo.name,
        mime_type: arquivo.type
      }
    })

    const urlAcesso = `/.netlify/functions/arquivo?key=${encodeURIComponent(blobKey)}`

    await sql`
      UPDATE usuarios
      SET foto_perfil_url = ${urlAcesso},
          consentimento_foto_publica = ${consentimento},
          foto_perfil_aprovada = FALSE,
          atualizado_em = CURRENT_TIMESTAMP
      WHERE id = ${targetUser.id}
    `

    await sql`
      DELETE FROM arquivos_publicacao
      WHERE usuario_id = ${targetUser.id}
        AND categoria = 'foto_perfil'
        AND blob_key <> ${blobKey}
    `

    await sql`
      INSERT INTO arquivos_publicacao (
        usuario_id, categoria, nome_original, mime_type, tamanho_bytes, blob_key, blob_store, url_acesso, publico
      )
      VALUES (
        ${targetUser.id}, 'foto_perfil', ${arquivo.name}, ${arquivo.type}, ${arquivo.size}, ${blobKey}, 'revista-arquivos', ${urlAcesso}, FALSE
      )
    `

    for (const antigo of antigos) {
      if (antigo.blob_key && antigo.blob_key !== blobKey) {
        try { await store.delete(antigo.blob_key) } catch (err) { console.error('Falha ao remover blob antigo:', antigo.blob_key, err) }
      }
    }

    return json({ sucesso: true, foto_perfil_url: urlAcesso, mensagem: 'Foto enviada. A publicação depende de aprovação editorial.' })
  } catch (erro) {
    console.error('upload-avatar erro:', erro)
    return json({ erro: 'Erro ao enviar foto.', detalhe: erro.message }, 500)
  }
}

exports.handler = wrapHttp(main)
