const { getStore } = require('@netlify/blobs')
const { sql, json, getUserById, ensureSupportTables, getAuthenticatedUserId } = require('./_db')
const { wrapHttp } = require('./_netlify')

const store = getStore('revista-arquivos')

function sanitizarNome(nome = '') {
  return String(nome)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
}

const main = async (req) => {
  try {
    if (req.method !== 'POST') return json({ erro: 'Método não permitido.' }, 405)
    await ensureSupportTables()

    const form = await req.formData()
    const authUserId = getAuthenticatedUserId(req, form.get('usuario_id'))
    const usuarioId = Number(form.get('usuario_id') || authUserId || 0)
    const consentimento = String(form.get('consentimento') || 'false') === 'true'
    const arquivo = form.get('arquivo')

    if (!authUserId || !usuarioId || authUserId !== usuarioId) {
      return json({ erro: 'Usuário inválido para envio da foto.' }, 403)
    }
    if (!arquivo || typeof arquivo === 'string') return json({ erro: 'Selecione um arquivo de imagem.' }, 400)

    const usuario = await getUserById(authUserId)
    if (!usuario) return json({ erro: 'Usuário não encontrado.' }, 404)
    if (usuario.status !== 'ativo') return json({ erro: 'Usuário inativo.' }, 403)

    const tipos = ['image/jpeg', 'image/png', 'image/webp']
    if (!tipos.includes(arquivo.type)) return json({ erro: 'Envie JPG, PNG ou WEBP.' }, 400)
    if (arquivo.size > 2_000_000) return json({ erro: 'A foto deve ter até 2 MB.' }, 400)

    const antigos = await sql`SELECT id, blob_key FROM arquivos_publicacao WHERE usuario_id = ${usuarioId} AND categoria = 'foto_perfil' ORDER BY id DESC`
    for (const antigo of antigos) {
      if (antigo.blob_key) {
        try { await store.delete(antigo.blob_key) } catch {}
      }
    }
    await sql`DELETE FROM arquivos_publicacao WHERE usuario_id = ${usuarioId} AND categoria = 'foto_perfil'`

    const blobKey = `usuarios/${usuarioId}/avatar/${Date.now()}-${sanitizarNome(arquivo.name || 'avatar')}`
    const bytes = await arquivo.arrayBuffer()
    await store.set(blobKey, bytes, {
      metadata: {
        usuario_id: String(usuarioId),
        categoria: 'foto_perfil',
        nome_original: arquivo.name,
        mime_type: arquivo.type
      }
    })

    const urlAcesso = `/.netlify/functions/arquivo?key=${encodeURIComponent(blobKey)}`
    await sql`UPDATE usuarios SET foto_perfil_url = ${urlAcesso}, consentimento_foto_publica = ${consentimento}, foto_perfil_aprovada = FALSE, atualizado_em = CURRENT_TIMESTAMP WHERE id = ${usuarioId}`
    await sql`
      INSERT INTO arquivos_publicacao (usuario_id, categoria, nome_original, mime_type, tamanho_bytes, blob_key, blob_store, url_acesso, publico)
      VALUES (${usuarioId}, 'foto_perfil', ${arquivo.name}, ${arquivo.type}, ${arquivo.size}, ${blobKey}, 'revista-arquivos', ${urlAcesso}, FALSE)
    `

    return json({ sucesso: true, foto_perfil_url: urlAcesso, mensagem: 'Foto enviada. A publicação depende de aprovação editorial.' }, 200)
  } catch (erro) {
    return json({ erro: 'Erro ao enviar foto.', detalhe: erro.message }, 500)
  }
}

exports.handler = wrapHttp(main)
