const { createClient } = require('@supabase/supabase-js')
const { sql, json, ensureSupportTables, getUserById, getAuthenticatedUserId } = require('./_db')
const { wrapHttp } = require('./_netlify')

const supabaseUrl = process.env.SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const supabase = createClient(supabaseUrl, supabaseServiceKey)

function sanitizarNome(nome = '') {
  return String(nome)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
}

const main = async (req) => {
  try {
    if (req.method !== 'POST') return json({ erro: 'Método não permitido.' }, 405)
    await ensureSupportTables()

    // Obtém o usuário autenticado
    const userId = getAuthenticatedUserId(req)
    if (!userId) return json({ erro: 'Usuário não autenticado.' }, 401)

    const user = await getUserById(userId)
    if (!user || user.status !== 'ativo') return json({ erro: 'Usuário inválido ou inativo.' }, 403)

    const form = await req.formData()
    const submissaoId = form.get('submissao_id') ? Number(form.get('submissao_id')) : null
    const categoria = String(form.get('categoria') || 'geral')
    const arquivo = form.get('arquivo')

    if (!arquivo || typeof arquivo === 'string') {
      return json({ erro: 'Nenhum arquivo enviado ou arquivo inválido.' }, 400)
    }

    // Validações de tipo e tamanho
    const tiposPermitidos = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'image/jpeg', 'image/png', 'image/webp', 'image/gif',
      'audio/mpeg', 'audio/wav', 'audio/webm', 'audio/ogg',
      'video/mp4', 'video/webm'
    ]
    if (!tiposPermitidos.includes(arquivo.type)) {
      return json({ erro: 'Tipo de arquivo não permitido.' }, 400)
    }
    if (arquivo.size > 10_000_000) {
      return json({ erro: 'Arquivo muito grande (máx. 10 MB).' }, 400)
    }

    const timestamp = Date.now()
    const safeName = sanitizarNome(arquivo.name || 'arquivo')
    const storagePath = `${categoria}/${userId}${submissaoId ? `/submissao_${submissaoId}` : ''}/${timestamp}-${safeName}`
    const bucket = 'uploads'  // Usando um bucket único, crie-o no Supabase

    console.log(`📤 Upload para bucket "${bucket}", caminho: ${storagePath}`)

    const { data, error } = await supabase.storage
      .from(bucket)
      .upload(storagePath, Buffer.from(await arquivo.arrayBuffer()), {
        contentType: arquivo.type,
        cacheControl: '3600',
        upsert: false
      })

    if (error) {
      console.error('❌ Erro no upload Supabase:', error)
      return json({ erro: 'Falha ao salvar arquivo no armazenamento.', detalhe: error.message }, 500)
    }

    const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(storagePath)
    const publicUrl = urlData.publicUrl

    // Registra na tabela arquivos_publicacao
    const inserido = await sql`
      INSERT INTO arquivos_publicacao (
        usuario_id, submissao_id, categoria, nome_original, mime_type, tamanho_bytes, blob_key, blob_store, url_acesso, publico
      ) VALUES (
        ${userId}, ${submissaoId}, ${categoria}, ${arquivo.name}, ${arquivo.type}, ${arquivo.size}, ${storagePath}, 'supabase', ${publicUrl}, TRUE
      ) RETURNING id, url_acesso, blob_key
    `

    console.log('✅ Upload concluído, ID:', inserido[0].id)

    return json({
      sucesso: true,
      arquivo: {
        url_acesso: publicUrl,
        storage_path: storagePath,
        id: inserido[0].id,
        nome_original: arquivo.name
      }
    })
  } catch (err) {
    console.error('❌ upload-material erro fatal:', err)
    return json({ erro: 'Erro interno no upload.', detalhe: err.message }, 500)
  }
}

exports.handler = wrapHttp(main)