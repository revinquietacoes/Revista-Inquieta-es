const { getStore } = require('@netlify/blobs')
const { sql } = require('./_db')
const { wrapHttp } = require('./_netlify')

const store = getStore('revista-arquivos')

const main = async (req) => {
  try {
    const url = new URL(req.url)
    const key = url.searchParams.get('key')

    if (!key) {
      return new Response('Arquivo não informado.', { status: 400 })
    }

    const registros = await sql`
      SELECT id, categoria, mime_type, url_acesso, publico
      FROM arquivos_publicacao
      WHERE blob_key = ${key}
      LIMIT 1
    `

    if (registros.length === 0) {
      return new Response('Arquivo não encontrado.', { status: 404 })
    }

    const blob = await store.get(key, { type: 'arrayBuffer' })

    if (!blob) {
      return new Response('Blob não encontrado.', { status: 404 })
    }

    return new Response(blob, {
      status: 200,
      headers: {
        'Content-Type': registros[0].mime_type || 'application/octet-stream',
        'Cache-Control': 'private, max-age=3600'
      }
    })
  } catch (erro) {
    return new Response(`Erro ao abrir arquivo: ${erro.message}`, { status: 500 })
  }
}

exports.handler = wrapHttp(main)