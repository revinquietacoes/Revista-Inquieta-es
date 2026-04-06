const { createClient } = require('@supabase/supabase-js')
const { sql, json, ensureSupportTables, getUserById, getAuthenticatedUserId } = require('./_db')
const { wrapHttp } = require('./_netlify')

const supabaseUrl = process.env.SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const supabase = createClient(supabaseUrl, supabaseServiceKey)

const BUCKET_NAME = 'chat-anexos'

async function ensureBucket() {
  const { data: buckets, error: listError } = await supabase.storage.listBuckets()
  if (listError) throw new Error(`Erro ao listar buckets: ${listError.message}`)
  const bucketExists = buckets.some(b => b.name === BUCKET_NAME)
  if (!bucketExists) {
    console.log(`📦 Criando bucket "${BUCKET_NAME}"...`)
    const { error: createError } = await supabase.storage.createBucket(BUCKET_NAME, { public: true })
    if (createError) throw new Error(`Erro ao criar bucket: ${createError.message}`)
    console.log(`✅ Bucket "${BUCKET_NAME}" criado com sucesso.`)
  }
}

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
    console.log('🔵 [upload-material] Iniciando...')
    if (req.method !== 'POST') return json({ erro: 'Método não permitido.' }, 405)

    await ensureSupportTables()
    await ensureBucket()

    const userId = getAuthenticatedUserId(req)
    if (!userId) {
      console.log('❌ Usuário não autenticado')
      return json({ erro: 'Usuário não autenticado.' }, 401)
    }

    const user = await getUserById(userId)
    if (!user || user.status !== 'ativo') {
      console.log('❌ Usuário inválido ou inativo')
      return json({ erro: 'Usuário inválido ou inativo.' }, 403)
    }

    const form = await req.formData()
    const submissaoId = form.get('submissao_id') ? Number(form.get('submissao_id')) : null
    let categoria = String(form.get('categoria') || 'outro')
    const arquivo = form.get('arquivo')

    if (!arquivo || typeof arquivo === 'string') {
      console.log('❌ Nenhum arquivo enviado')
      return json({ erro: 'Nenhum arquivo enviado.' }, 400)
    }

    // Garantir que a categoria seja uma das permitidas pela constraint
    const categoriasPermitidas = ['principal', 'manuscrito', 'outro', 'anexo', 'devolutiva', 'resumo_minicurso', 'revisao', 'mensagem_submissao']
    if (!categoriasPermitidas.includes(categoria)) {
      categoria = 'outro'  // fallback seguro
    }

    const tiposPermitidos = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'image/jpeg', 'image/png', 'image/webp', 'image/gif',
      'audio/mpeg', 'audio/wav', 'audio/webm', 'audio/ogg',
      'video/mp4', 'video/webm'
    ]
    if (!tiposPermitidos.includes(arquivo.type)) {
      console.log(`❌ Tipo não permitido: ${arquivo.type}`)
      return json({ erro: 'Tipo de arquivo não permitido.' }, 400)
    }
    if (arquivo.size > 10_000_000) {
      console.log(`❌ Arquivo muito grande: ${arquivo.size} bytes`)
      return json({ erro: 'Arquivo muito grande (máx. 10 MB).' }, 400)
    }

    const timestamp = Date.now()
    const safeName = sanitizarNome(arquivo.name || 'arquivo')
    const storagePath = `${categoria}/${userId}${submissaoId ? `/submissao_${submissaoId}` : ''}/${timestamp}-${safeName}`

    console.log(`📤 Fazendo upload para bucket "${BUCKET_NAME}", caminho: ${storagePath}`)
    const bytes = Buffer.from(await arquivo.arrayBuffer())
    const { data, error } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(storagePath, bytes, {
        contentType: arquivo.type,
        cacheControl: '3600',
        upsert: false
      })

    if (error) {
      console.error('❌ Erro no upload Supabase:', error)
      return json({ erro: 'Falha ao salvar arquivo no Supabase.', detalhe: error.message }, 500)
    }

    const { data: urlData } = supabase.storage.from(BUCKET_NAME).getPublicUrl(storagePath)
    const publicUrl = urlData.publicUrl

    const inserido = await sql`
      INSERT INTO arquivos_publicacao (
        usuario_id, submissao_id, categoria, nome_original, mime_type, tamanho_bytes, blob_key, blob_store, url_acesso, publico
      ) VALUES (
        ${userId}, ${submissaoId}, ${categoria}, ${arquivo.name}, ${arquivo.type}, ${arquivo.size}, ${storagePath}, 'supabase', ${publicUrl}, TRUE
      ) RETURNING id, url_acesso, blob_key
    `

    console.log(`✅ Upload concluído. ID: ${inserido[0].id}, URL: ${publicUrl}`)

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