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
    const tabelaParam = url.searchParams.get('tabela') || 'privado'

    console.log(`📥 [get-my-certificate] id=${certificateId}, download=${download}, queryUserId=${queryUserId}, tabela=${tabelaParam}`)

    let tabelaReal
    if (tabelaParam === 'parecerista') {
      tabelaReal = 'certificados_parecerista'
    } else {
      tabelaReal = 'certificados_privados'
    }

    if (!certificateId) {
      return new Response('Parâmetro id é obrigatório.', { status: 400 })
    }

    let userId = getAuthenticatedUserId(req)
    console.log(`🔑 userId do header: ${userId}`)
    if (!userId && queryUserId) {
      userId = queryUserId
      console.log(`📌 userId da query string (fallback): ${userId}`)
    }

    if (!userId) {
      console.log('❌ Nenhum userId encontrado')
      return new Response('Usuário não autenticado.', { status: 401 })
    }

    const queryText = `SELECT id, titulo, blob_key, mime_type, nome_arquivo, usuario_id
                       FROM ${tabelaReal}
                       WHERE id = $1
                       LIMIT 1`
    console.log(`🔍 SQL: ${queryText} [${certificateId}]`)

    const rows = await sql.query(queryText, [certificateId])

    if (!rows || rows.length === 0) {
      console.log(`❌ Nenhum certificado encontrado com id=${certificateId} na tabela ${tabelaReal}`)
      return new Response('Certificado não encontrado.', { status: 404 })
    }

    const cert = rows[0]
    console.log(`📦 Certificado encontrado: id=${cert.id}, usuario_id=${cert.usuario_id} (tipo: ${typeof cert.usuario_id}), blob_key=${cert.blob_key}`)
    console.log(`👤 userId comparado: ${userId} (tipo: ${typeof userId})`)

    if (Number(cert.usuario_id) !== Number(userId)) {
      console.log(`🚫 Acesso negado: usuario_id do cert (${cert.usuario_id}) !== userId (${userId})`)
      return new Response('Acesso negado a este certificado.', { status: 403 })
    }

    if (!cert.blob_key) {
      console.log(`❌ blob_key vazio para certificado ${cert.id}`)
      return new Response('Certificado sem arquivo associado.', { status: 404 })
    }

    const { data, error } = await supabase.storage
      .from('certificados')
      .download(cert.blob_key)

    if (error || !data) {
      console.error('❌ Erro no download do Supabase:', error)
      return new Response('Arquivo do certificado não encontrado.', { status: 404 })
    }

    const bytes = await data.arrayBuffer()
    const fileName = safeDownloadName(cert.nome_arquivo || cert.titulo || `certificado-${cert.id}.pdf`)
    const finalFileName = fileName.toLowerCase().endsWith('.pdf') ? fileName : `${fileName}.pdf`

    console.log(`✅ Sucesso: entregando certificado ${cert.id} para usuário ${userId}`)
    return new Response(bytes, {
      status: 200,
      headers: {
        'Content-Type': cert.mime_type || 'application/pdf',
        'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${finalFileName}"`,
        'Cache-Control': 'public, max-age=3600'
      }
    })
  } catch (error) {
    console.error('❌ Erro interno em get-my-certificate:', error)
    return new Response(`Erro interno: ${error.message}`, { status: 500 })
  }
}

exports.handler = wrapHttp(main)