const { createClient } = require('@supabase/supabase-js')
const { sql, ensureSupportTables } = require('./_db')
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
    
    // PRIORIDADE: user_id da query string (vem do front-end)
    let userId = Number(url.searchParams.get('user_id') || 0)
    
    // Se não veio na query, tenta pelo header X-User-Id
    if (!userId) {
      const headerId = req.headers['x-user-id'] || req.headers['X-User-Id']
      userId = Number(headerId || 0)
    }

    console.log(`📄 [get-my-certificate] id=${certificateId}, download=${download}, userId=${userId}`)

    if (!certificateId) {
      return new Response('Parâmetro id é obrigatório.', { status: 400 })
    }

    if (!userId) {
      console.log('❌ userId não encontrado')
      return new Response('Usuário não autenticado.', { status: 401 })
    }

    // Busca o certificado no banco
    const rows = await sql`
      SELECT id, titulo, blob_key, mime_type, nome_arquivo, usuario_id
      FROM certificados_privados
      WHERE id = ${certificateId}
      LIMIT 1
    `

    if (!rows.length) {
      console.log(`❌ Certificado ${certificateId} não encontrado.`)
      return new Response('Certificado não encontrado.', { status: 404 })
    }

    const cert = rows[0]
    console.log(`📦 Certificado: usuario_id=${cert.usuario_id}, blob_key=${cert.blob_key}`)

    // Verifica se o usuário logado é o dono
    if (cert.usuario_id !== userId) {
      console.log(`🚫 Acesso negado: usuário ${userId} ≠ dono ${cert.usuario_id}`)
      return new Response('Acesso negado a este certificado.', { status: 403 })
    }

    if (!cert.blob_key) {
      return new Response('Certificado sem arquivo associado.', { status: 404 })
    }

    // Download do Supabase Storage
    const { data, error } = await supabase.storage
      .from('certificados')
      .download(cert.blob_key)

    if (error || !data) {
      console.error('❌ Erro Supabase:', error)
      return new Response('Arquivo do certificado não encontrado no storage.', { status: 404 })
    }

    const bytes = await data.arrayBuffer()
    const fileName = safeDownloadName(cert.nome_arquivo || cert.titulo || `certificado-${cert.id}.pdf`)
    const finalFileName = fileName.toLowerCase().endsWith('.pdf') ? fileName : `${fileName}.pdf`

    console.log(`✅ Sucesso: entregando certificado ${certificateId}`)
    return new Response(bytes, {
      status: 200,
      headers: {
        'Content-Type': cert.mime_type || 'application/pdf',
        'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${finalFileName}"`,
        'Cache-Control': 'public, max-age=3600'
      }
    })
  } catch (error) {
    console.error('❌ Erro interno:', error)
    return new Response(`Erro interno: ${error.message}`, { status: 500 })
  }
}

exports.handler = wrapHttp(main)