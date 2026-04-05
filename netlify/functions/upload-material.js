const { sql, json, ensureSupportTables, getUserById, getAuthenticatedUserId, canAccess } = require('./_db')
const { wrapHttp } = require('./_netlify')

function sanitizarNome(nome = '') {
  return String(nome)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
}

async function resolveActorAndTarget(req, form) {
  const actorId = getAuthenticatedUserId(req, form.get('usuario_id')) || Number(form.get('usuario_id') || 0)
  const targetUserId = Number(form.get('usuario_id') || actorId || 0)

  if (!targetUserId) return { error: json({ erro: 'Usuário inválido para upload.' }, 403) }

  const actor = actorId ? await getUserById(actorId) : null
  if (actorId && !actor) return { error: json({ erro: 'Usuário autenticado não encontrado.' }, 404) }
  if (actor && actor.status && actor.status !== 'ativo') return { error: json({ erro: 'Usuário autenticado inativo.' }, 403) }

  const targetUser = await getUserById(targetUserId)
  if (!targetUser) return { error: json({ erro: 'Usuário de destino não encontrado.' }, 404) }
  if (targetUser.status && targetUser.status !== 'ativo') return { error: json({ erro: 'Usuário de destino inativo.' }, 403) }

  const ownUpload = actorId === targetUserId || !actorId
  const privileged = actor && canAccess(actor, ['editor_chefe', 'editor_adjunto'])

  if (!ownUpload && !privileged) return { error: json({ erro: 'Você não pode enviar arquivo para outro usuário.' }, 403) }

  return { actor, targetUser }
}

const main = async (req) => {
  try {
    if (req.method !== 'POST') return json({ erro: 'Método não permitido.' }, 405)
    await ensureSupportTables()

    const form = await req.formData()
    const submissaoId = form.get('submissao_id') ? Number(form.get('submissao_id')) : null
    const categoria = String(form.get('categoria') || 'outro')
    const arquivo = form.get('arquivo')

    if (!arquivo || typeof arquivo === 'string') return json({ erro: 'Selecione um arquivo válido.' }, 400)

    const roleInfo = await resolveActorAndTarget(req, form)
    if (roleInfo.error) return roleInfo.error
    const { targetUser } = roleInfo

    const permitidos = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'image/jpeg', 'image/png', 'image/webp', 'image/gif',
      'audio/mpeg', 'audio/wav', 'audio/webm', 'audio/ogg',
      'video/mp4', 'video/webm'
    ]

    if (!permitidos.includes(arquivo.type)) return json({ erro: 'Tipo de arquivo não permitido.' }, 400)
    if (arquivo.size > 10_000_000) return json({ erro: 'Arquivo acima do limite de 10 MB.' }, 400)

    // Usar Supabase Storage em vez de Netlify Blobs
    const supabaseUrl = process.env.SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Variáveis SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não definidas')
    }

    const timestamp = Date.now()
    const safeName = sanitizarNome(arquivo.name || 'arquivo')
    const filePath = `chat/${targetUser.id}/${categoria}/${timestamp}-${safeName}`

    // Upload para o Supabase Storage
    const uploadUrl = `${supabaseUrl}/storage/v1/object/chat-anexos/${filePath}`
    const bytes = Buffer.from(await arquivo.arrayBuffer())
    const uploadResponse = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${supabaseServiceKey}`,
        'Content-Type': arquivo.type
      },
      body: bytes
    })

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text()
      throw new Error(`Erro no upload Supabase: ${uploadResponse.status} - ${errorText}`)
    }

    // URL pública do arquivo
    const publicUrl = `${supabaseUrl}/storage/v1/object/public/chat-anexos/${filePath}`

    // Registrar no banco Neon (tabela arquivos_publicacao) – opcional, mas mantém compatibilidade
    const inserido = await sql`
      INSERT INTO arquivos_publicacao (
        usuario_id, submissao_id, categoria, nome_original, mime_type, tamanho_bytes, blob_key, blob_store, url_acesso, publico
      ) VALUES (
        ${targetUser.id}, ${submissaoId}, ${categoria}, ${arquivo.name}, ${arquivo.type}, ${arquivo.size}, ${filePath}, 'supabase', ${publicUrl}, TRUE
      ) RETURNING id, url_acesso, blob_key
    `

    // Se for anexo de chat, não precisa de lógica adicional de submissão
    if (submissaoId && categoria === 'manuscrito') {
      const check = await sql`SELECT to_regclass('public.arquivos_submissao') AS nome`
      if (check?.[0]?.nome) {
        await sql`
          INSERT INTO arquivos_submissao (submissao_id, nome_arquivo, tipo_arquivo, tamanho_bytes, url_arquivo, categoria)
          VALUES (${submissaoId}, ${arquivo.name}, ${arquivo.type}, ${arquivo.size}, ${publicUrl}, 'principal')
        `
      }
    }

    if (submissaoId && categoria === 'devolutiva') {
      try {
        const tableCheck = await sql`SELECT to_regclass('public.arquivos_avaliacao') AS nome`
        if (tableCheck?.[0]?.nome) {
          const colCheck = await sql`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'arquivos_avaliacao'`
          const cols = new Set((colCheck || []).map(r => r.column_name))
          if (cols.has('submissao_id')) {
            await sql`INSERT INTO arquivos_avaliacao (submissao_id, nome_arquivo, tipo_arquivo, tamanho_bytes, url_arquivo, categoria) VALUES (${submissaoId}, ${arquivo.name}, ${arquivo.type}, ${arquivo.size}, ${publicUrl}, 'devolutiva')`
          } else {
            await sql`INSERT INTO arquivos_avaliacao (nome_arquivo, tipo_arquivo, tamanho_bytes, url_arquivo, categoria) VALUES (${arquivo.name}, ${arquivo.type}, ${arquivo.size}, ${publicUrl}, 'devolutiva')`
          }
        }
      } catch (e) { console.error('Falha ao registrar devolutiva:', e) }
    }

    // Retornar a URL pública para ser usada no chat
    return json({ sucesso: true, arquivo: { url_acesso: publicUrl, id: inserido[0].id } })
  } catch (erro) {
    console.error('upload-material erro:', erro)
    return json({ erro: 'Erro ao enviar arquivo.', detalhe: erro.message }, 500)
  }
}

exports.handler = wrapHttp(main)