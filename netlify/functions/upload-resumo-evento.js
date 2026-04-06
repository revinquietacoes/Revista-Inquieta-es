const { createClient } = require('@supabase/supabase-js')
const { json, getAuthenticatedUserId } = require('./_db')
const { wrapHttp } = require('./_netlify')

const supabaseUrl = process.env.SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const supabase = createClient(supabaseUrl, supabaseServiceKey)

function sanitizeFileName(name) {
  return String(name || 'resumo.docx')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
}

const main = async (req) => {
  try {
    if (req.method !== 'POST') return json({ erro: 'Método não permitido.' }, 405)

    const userId = getAuthenticatedUserId(req)
    if (!userId) return json({ erro: 'Usuário não autenticado.' }, 401)

    const form = await req.formData()
    const arquivo = form.get('arquivo')
    if (!arquivo) return json({ erro: 'Nenhum arquivo enviado.' }, 400)

    const mimeType = arquivo.type || 'application/msword'
    const bytes = Buffer.from(await arquivo.arrayBuffer())
    const safeFileName = sanitizeFileName(arquivo.name || `resumo-${userId}.docx`)

    const storagePath = `resumos/${userId}/${Date.now()}-${safeFileName}`

    const { error: uploadError } = await supabase.storage
      .from('resumos') // Crie esse bucket no Supabase (público ou privado)
      .upload(storagePath, bytes, { contentType: mimeType, cacheControl: '3600' })

    if (uploadError) {
      console.error('Erro no upload:', uploadError)
      return json({ erro: 'Falha ao salvar o resumo.' }, 500)
    }

    const { data: urlData } = supabase.storage.from('resumos').getPublicUrl(storagePath)

    return json({ sucesso: true, url: urlData.publicUrl })
  } catch (error) {
    console.error(error)
    return json({ erro: 'Erro interno.', detalhe: error.message }, 500)
  }
}

exports.handler = wrapHttp(main)