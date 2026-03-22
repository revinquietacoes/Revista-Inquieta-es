const { getStore } = require('@netlify/blobs')
const {
  sql,
  json,
  getUserById,
  ensureSupportTables,
  getAuthenticatedUserId
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

async function buscarFotosAntigas(usuarioId) {
  return sql`
    SELECT id, blob_key
    FROM arquivos_publicacao
    WHERE usuario_id = ${usuarioId}
      AND categoria = 'foto_perfil'
    ORDER BY id DESC
  `
}

async function validarUpload(req) {
  const form = await req.formData()

  const authUserId = getAuthenticatedUserId(req, form.get('usuario_id'))
  const usuarioId = Number(form.get('usuario_id') || authUserId || 0)
  const consentimento = String(form.get('consentimento') || 'false') === 'true'
  const arquivo = form.get('arquivo')

  if (!authUserId || !usuarioId || authUserId !== usuarioId) {
    return { erro: json({ erro: 'Usuário inválido para envio da foto.' }, 403) }
  }

  if (!arquivo || typeof arquivo === 'string') {
    return { erro: json({ erro: 'Selecione um arquivo de imagem.' }, 400) }
  }

  const usuario = await getUserById(authUserId)

  if (!usuario) {
    return { erro: json({ erro: 'Usuário não encontrado.' }, 404) }
  }

  if (usuario.status !== 'ativo') {
    return { erro: json({ erro: 'Usuário inativo.' }, 403) }
  }

  const tiposPermitidos = ['image/jpeg', 'image/png', 'image/webp']

  if (!tiposPermitidos.includes(arquivo.type)) {
    return { erro: json({ erro: 'Envie JPG, PNG ou WEBP.' }, 400) }
  }

  if (arquivo.size > 2_000_000) {
    return { erro: json({ erro: 'A foto deve ter até 2 MB.' }, 400) }
  }

  return {
    form,
    authUserId,
    usuarioId,
    consentimento,
    arquivo,
    usuario
  }
}

async function salvarNovoAvatar(usuarioId, arquivo) {
  const blobKey = `usuarios/${usuarioId}/avatar/${Date.now()}-${sanitizarNome(
    arquivo.name || 'avatar'
  )}`

  const arrayBuffer = await arquivo.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)

  await store.set(blobKey, buffer, {
    metadata: {
      usuario_id: String(usuarioId),
      categoria: 'foto_perfil',
      nome_original: arquivo.name,
      mime_type: arquivo.type
    }
  })

  const urlAcesso = `/.netlify/functions/arquivo?key=${encodeURIComponent(blobKey)}`

  return { blobKey, urlAcesso }
}

async function registrarAvatar(usuarioId, consentimento, arquivo, blobKey, urlAcesso) {
  await sql`
    UPDATE usuarios
    SET
      foto_perfil_url = ${urlAcesso},
      consentimento_foto_publica = ${consentimento},
      foto_perfil_aprovada = FALSE,
      atualizado_em = CURRENT_TIMESTAMP
    WHERE id = ${usuarioId}
  `

  await sql`
    INSERT INTO arquivos_publicacao (
      usuario_id,
      categoria,
      nome_original,
      mime_type,
      tamanho_bytes,
      blob_key,
      blob_store,
      url_acesso,
      publico
    )
    VALUES (
      ${usuarioId},
      'foto_perfil',
      ${arquivo.name},
      ${arquivo.type},
      ${arquivo.size},
      ${blobKey},
      'revista-arquivos',
      ${urlAcesso},
      FALSE
    )
  `
}

async function removerFotosAntigas(antigos) {
  for (const antigo of antigos) {
    if (!antigo.blob_key) continue

    try {
      await store.delete(antigo.blob_key)
    } catch (err) {
      console.error('Falha ao remover blob antigo:', antigo.blob_key, err)
    }
  }
}

const main = async (req) => {
  try {
    if (req.method !== 'POST') {
      return json({ erro: 'Método não permitido.' }, 405)
    }

    await ensureSupportTables()

    const validacao = await validarUpload(req)
    if (validacao.erro) return validacao.erro

    const {
      usuarioId,
      consentimento,
      arquivo
    } = validacao

    const antigos = await buscarFotosAntigas(usuarioId)

    const { blobKey, urlAcesso } = await salvarNovoAvatar(usuarioId, arquivo)

    await registrarAvatar(
      usuarioId,
      consentimento,
      arquivo,
      blobKey,
      urlAcesso
    )

    await sql`
      DELETE FROM arquivos_publicacao
      WHERE usuario_id = ${usuarioId}
        AND categoria = 'foto_perfil'
        AND blob_key <> ${blobKey}
    `

    await removerFotosAntigas(
      antigos.filter((item) => item.blob_key && item.blob_key !== blobKey)
    )

    return json(
      {
        sucesso: true,
        foto_perfil_url: urlAcesso,
        mensagem: 'Foto enviada. A publicação depende de aprovação editorial.'
      },
      200
    )
  } catch (erro) {
    console.error('upload-avatar erro:', erro)

    return json(
      {
        erro: 'Erro ao enviar foto.',
        detalhe: erro.message
      },
      500
    )
  }
}

exports.handler = wrapHttp(main)