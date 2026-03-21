import { getStore } from '@netlify/blobs'
import { sql } from './_db.js'
import { wrapHttp } from './_netlify.js'

const store = getStore('revista-arquivos')

function sanitizarNome(nome = '') {
  return String(nome).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase()
}

export default async (req) => {
  try {
    if (req.method !== 'POST') return new Response(JSON.stringify({ erro: 'Método não permitido.' }), { status: 405, headers: { 'Content-Type': 'application/json' } })
    const form = await req.formData()
    const usuarioId = Number(form.get('usuario_id') || 0)
    const consentimento = String(form.get('consentimento') || 'false') === 'true'
    const arquivo = form.get('arquivo')
    if (!usuarioId || !arquivo || typeof arquivo === 'string') return new Response(JSON.stringify({ erro: 'Dados obrigatórios ausentes.' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
    const tipos = ['image/jpeg', 'image/png', 'image/webp']
    if (!tipos.includes(arquivo.type)) return new Response(JSON.stringify({ erro: 'Envie JPG, PNG ou WEBP.' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
    if (arquivo.size > 2_000_000) return new Response(JSON.stringify({ erro: 'A foto deve ter até 2 MB.' }), { status: 400, headers: { 'Content-Type': 'application/json' } })

    const antigos = await sql`SELECT id, blob_key FROM arquivos_publicacao WHERE usuario_id = ${usuarioId} AND categoria = 'foto_perfil' ORDER BY id DESC`
    for (const antigo of antigos) {
      if (antigo.blob_key) {
        try { await store.delete(antigo.blob_key) } catch {}
      }
    }
    await sql`DELETE FROM arquivos_publicacao WHERE usuario_id = ${usuarioId} AND categoria = 'foto_perfil'`

    const blobKey = `usuarios/${usuarioId}/avatar/${Date.now()}-${sanitizarNome(arquivo.name || 'avatar')}`
    const bytes = await arquivo.arrayBuffer()
    await store.set(blobKey, bytes, { metadata: { usuario_id: usuarioId, categoria: 'foto_perfil', nome_original: arquivo.name, mime_type: arquivo.type } })
    const urlAcesso = `/.netlify/functions/arquivo?key=${encodeURIComponent(blobKey)}`

    await sql`
      UPDATE usuarios
      SET foto_perfil_url = ${urlAcesso}, consentimento_foto_publica = ${consentimento}, foto_perfil_aprovada = FALSE, atualizado_em = CURRENT_TIMESTAMP
      WHERE id = ${usuarioId}
    `

    await sql`
      INSERT INTO arquivos_publicacao (usuario_id, categoria, nome_original, mime_type, tamanho_bytes, blob_key, blob_store, url_acesso, publico)
      VALUES (${usuarioId}, 'foto_perfil', ${arquivo.name}, ${arquivo.type}, ${arquivo.size}, ${blobKey}, 'revista-arquivos', ${urlAcesso}, FALSE)
    `

    return new Response(JSON.stringify({ sucesso: true, foto_perfil_url: urlAcesso, mensagem: 'Foto enviada. A publicação depende de aprovação editorial.' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  } catch (erro) {
    return new Response(JSON.stringify({ erro: 'Erro ao enviar foto.', detalhe: erro.message }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
}

export const handler = wrapHttp(default)