import { getStore } from '@netlify/blobs'
import { sql } from './_db.js'

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

export default async (req) => {
  try {
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ erro: 'Método não permitido.' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    const form = await req.formData()

    const usuarioId = Number(form.get('usuario_id') || 0)
    const submissaoId = form.get('submissao_id') ? Number(form.get('submissao_id')) : null
    const categoria = String(form.get('categoria') || 'outro')
    const arquivo = form.get('arquivo')

    if (!usuarioId || !arquivo || typeof arquivo === 'string') {
      return new Response(JSON.stringify({ erro: 'Dados obrigatórios ausentes.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    const permitidos = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'image/jpeg',
      'image/png',
      'image/webp'
    ]

    if (!permitidos.includes(arquivo.type)) {
      return new Response(JSON.stringify({ erro: 'Tipo de arquivo não permitido.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    if (arquivo.size > 4_500_000) {
      return new Response(JSON.stringify({ erro: 'Arquivo acima do limite de 4,5 MB.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    const agora = Date.now()
    const nomeSeguro = sanitizarNome(arquivo.name || 'arquivo')
    const blobKey = `usuarios/${usuarioId}/${categoria}/${agora}-${nomeSeguro}`

    const bytes = await arquivo.arrayBuffer()

    await store.set(blobKey, bytes, {
      metadata: {
        usuario_id: usuarioId,
        submissao_id: submissaoId,
        categoria,
        nome_original: arquivo.name,
        mime_type: arquivo.type
      }
    })

    const urlAcesso = `/.netlify/functions/arquivo?key=${encodeURIComponent(blobKey)}`

    const inserido = await sql`
      INSERT INTO arquivos_publicacao (
        usuario_id,
        submissao_id,
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
        ${submissaoId},
        ${categoria},
        ${arquivo.name},
        ${arquivo.type},
        ${arquivo.size},
        ${blobKey},
        ${'revista-arquivos'},
        ${urlAcesso},
        ${false}
      )
      RETURNING id, url_acesso, blob_key
    `

    if (submissaoId) {
      if (categoria === 'manuscrito') {
        await sql`INSERT INTO arquivos_submissao (submissao_id, nome_arquivo, tipo_arquivo, tamanho_bytes, url_arquivo, categoria) VALUES (${submissaoId}, ${arquivo.name}, ${arquivo.type}, ${arquivo.size}, ${urlAcesso}, 'principal')`
      }
      if (categoria === 'devolutiva') {
        await sql`INSERT INTO arquivos_avaliacao (nome_arquivo, tipo_arquivo, tamanho_bytes, url_arquivo, categoria) VALUES (${arquivo.name}, ${arquivo.type}, ${arquivo.size}, ${urlAcesso}, 'devolutiva')`
      }
    }

    return new Response(JSON.stringify({
      sucesso: true,
      arquivo: inserido[0]
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  } catch (erro) {
    return new Response(JSON.stringify({
      erro: 'Erro ao enviar arquivo.',
      detalhe: erro.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
}