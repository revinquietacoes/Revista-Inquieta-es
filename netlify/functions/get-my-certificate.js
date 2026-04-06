const { createClient } = require('@supabase/supabase-js')
const { sql, ensureSupportTables, getAuthenticatedUserId } = require('./_db')
const { wrapHttp } = require('./_netlify')

const supabaseUrl = process.env.SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const supabase = createClient(supabaseUrl, supabaseServiceKey)

function safeDownloadName(name) {
  return String(name || 'certificado')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
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
    const queryUserId = Number(url.searchParams.get('user_id') || 0)
    const tabela = url.searchParams.get('tabela') === 'parecerista' ? 'certificados_parecerista' : 'certificados_privados'

    if (!certificateId) {
      return new Response('Parâmetro id é obrigatório.', { status: 400 })
    }

    let userId = getAuthenticatedUserId(req)
    if (!userId && queryUserId) {
      userId = queryUserId
    }

    if (!userId) {
      return new Response('Usuário não autenticado.', { status: 401 })
    }

    const [cert] = await sql`
      SELECT id, titulo, blob_key, mime_type, nome_arquivo, usuario_id
      FROM ${sql(tabela)}
      WHERE id = ${certificateId}
      LIMIT 1
    `

    if (!cert) {
      return new Response('Certificado não encontrado.', { status: 404 })
    }

    if (cert.usuario_id !== userId) {
      return new Response('Acesso negado a este certificado.', { status: 403 })
    }

    if (!cert.blob_key) {
      return new Response('Certificado sem arquivo associado.', { status: 404 })
    }

    const { data, error } = await supabase.storage
      .from('certificados')
      .download(cert.blob_key)

    if (error || !data) {
      console.error('Erro ao baixar do Supabase:', error)
      return new Response('Arquivo do certificado não encontrado.', { status: 404 })
    }

    const bytes = await data.arrayBuffer()
    const fileName = safeDownloadName(cert.nome_arquivo || cert.titulo || `certificado-${cert.id}.pdf`)
    const finalFileName = fileName.toLowerCase().endsWith('.pdf') ? fileName : `${fileName}.pdf`

    return new Response(bytes, {
      status: 200,
      headers: {
        'Content-Type': cert.mime_type || 'application/pdf',
        'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${finalFileName}"`,
        'Cache-Control': 'public, max-age=3600'
      }
    })
  } catch (error) {
    console.error('Erro interno:', error)
    return new Response(`Erro interno: ${error.message}`, { status: 500 })
  }
}

exports.handler = wrapHttp(main)