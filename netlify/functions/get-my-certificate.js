const { getStore } = require('@netlify/blobs')
const { sql, ensureSupportTables } = require('./_db')
const { wrapHttp } = require('./_netlify')

function safeDownloadName(name) {
  return String(name || 'certificado')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function createCertificatesStore() {
  try {
    return getStore('certificados-usuarios')
  } catch (_) {
    const siteID =
      process.env.NETLIFY_SITE_ID ||
      process.env.SITE_ID ||
      process.env.BLOBS_SITE_ID

    const token =
      process.env.NETLIFY_BLOBS_TOKEN ||
      process.env.BLOBS_TOKEN ||
      process.env.NETLIFY_AUTH_TOKEN

    if (!siteID || !token) {
      throw new Error(
        'Netlify Blobs não configurado. Defina NETLIFY_SITE_ID e NETLIFY_BLOBS_TOKEN.'
      )
    }

    return getStore({
      name: 'certificados-usuarios',
      siteID,
      token
    })
  }
}

const main = async (req) => {
  try {
    if (req.method !== 'GET') {
      return new Response('Método não permitido.', { status: 405 })
    }

    await ensureSupportTables()

    const url = new URL(req.url)
    const certificateId = Number(url.searchParams.get('id') || 0)
    const download = url.searchParams.get('download') === '1'

    if (!certificateId) {
      return new Response('Parâmetro id é obrigatório.', { status: 400 })
    }

    const rows = await sql`
      SELECT id, titulo, blob_key, mime_type, nome_arquivo
      FROM certificados_privados
      WHERE id = ${certificateId}
      LIMIT 1
    `

    if (!rows.length) {
      return new Response('Certificado não encontrado.', { status: 404 })
    }

    const cert = rows[0]

    console.log('Certificado localizado:', {
      id: cert.id,
      titulo: cert.titulo,
      blob_key: cert.blob_key,
      mime_type: cert.mime_type,
      nome_arquivo: cert.nome_arquivo
    })

    if (!cert.blob_key) {
      return new Response('Certificado sem blob_key cadastrado.', { status: 404 })
    }

    const certificatesStore = createCertificatesStore()

    const blob = await certificatesStore.get(cert.blob_key, { type: 'arrayBuffer' })

    if (!blob) {
      return new Response('Arquivo do certificado não encontrado no Blobs.', { status: 404 })
    }

    const byteLength = blob.byteLength || blob.length || 0
    console.log('Tamanho do arquivo retornado:', byteLength)

    if (!byteLength) {
      return new Response('O arquivo do certificado está vazio.', { status: 404 })
    }

    const fileName = safeDownloadName(
      cert.nome_arquivo || cert.titulo || `certificado-${cert.id}.pdf`
    )

    const finalFileName = fileName.toLowerCase().endsWith('.pdf')
      ? fileName
      : `${fileName}.pdf`

    const contentType =
      cert.mime_type && String(cert.mime_type).trim()
        ? cert.mime_type
        : 'application/pdf'

    return new Response(blob, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(byteLength),
        'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${finalFileName}"`,
        'Cache-Control': 'public, max-age=3600',
        'X-Certificate-Id': String(cert.id)
      }
    })
  } catch (error) {
    console.error('Erro interno ao obter certificado:', error)
    return new Response(`Erro interno ao obter certificado: ${error.message}`, {
      status: 500,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    })
  }
  const cert = rows[0];
  if (cert.usuario_id !== userId) {
    return new Response('Acesso negado a este certificado.', { status: 403 });
  }
}

exports.handler = wrapHttp(main)