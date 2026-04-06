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

    const supabaseUrl = process.env.SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('❌ Variáveis SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não definidas')
      return json({ erro: 'Configuração de armazenamento ausente.' }, 500)
    }

    const timestamp = Date.now()
    const safeName = sanitizarNome(arquivo.name || 'arquivo')
    const filePath = `chat/${targetUser.id}/${categoria}/${timestamp}-${safeName}`
    const uploadUrl = `${supabaseUrl}/storage/v1/object/chat-anexos/${filePath}`
    const bytes = Buffer.from(await arquivo.arrayBuffer())

    console.log(`📤 Upload para Supabase: ${uploadUrl}, tamanho: ${bytes.length} bytes`)

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
      console.error('❌ Erro no upload Supabase:', uploadResponse.status, errorText)
      throw new Error(`Erro no upload Supabase: ${uploadResponse.status} - ${errorText}`)
    }

    const publicUrl = `${supabaseUrl}/storage/v1/object/public/chat-anexos/${filePath}`

    // Salvar no banco Neon (tabela arquivos_publicacao)
    const inserido = await sql`
      INSERT INTO arquivos_publicacao (
        usuario_id, submissao_id, categoria, nome_original, mime_type, tamanho_bytes, blob_key, blob_store, url_acesso, publico
      ) VALUES (
        ${targetUser.id}, ${submissaoId}, ${categoria}, ${arquivo.name}, ${arquivo.type}, ${arquivo.size}, ${filePath}, 'supabase', ${publicUrl}, TRUE
      ) RETURNING id, url_acesso, blob_key
    `

    console.log('✅ Arquivo salvo com sucesso, URL:', publicUrl)

    // ---------- Registrar nova revisão ----------
    if (action === 'registrar_revisao') {
      if (!canAccess(user, ['autor'])) return json({ erro: 'Acesso negado.' }, 403);
      const { submissaoId, arquivoUrl, arquivoPath, nomeArquivo, comentario } = body;
      const maxVersao = await sql`SELECT COALESCE(MAX(versao), 0) as max FROM revisoes_submissoes WHERE submissao_id = ${submissaoId}`;
      const novaVersao = (maxVersao[0].max || 0) + 1;
      await sql`
        INSERT INTO revisoes_submissoes (submissao_id, versao, arquivo_url, arquivo_path, nome_arquivo, comentario)
        VALUES (${submissaoId}, ${novaVersao}, ${arquivoUrl}, ${arquivoPath}, ${nomeArquivo}, ${comentario})
    `;
      const sub = await sql`SELECT editor_responsavel_id, editor_adjunto_id FROM submissoes WHERE id = ${submissaoId}`;
      const editores = [sub[0].editor_responsavel_id, sub[0].editor_adjunto_id].filter(Boolean);
      for (const editorId of editores) {
        await criarNotificacao(editorId, 'revisao', `Nova versão enviada para submissão #${submissaoId}`, `O autor enviou uma nova revisão.`, `/cadastro-login/editor-chefe-submissoes?submissao=${submissaoId}`);
      }
      return json({ sucesso: true, versao: novaVersao });
    }

    // ---------- Enviar mensagem sobre submissão ----------
    if (action === 'enviar_mensagem_submissao') {
      if (!canAccess(user, ['autor', 'editor_chefe'])) return json({ erro: 'Acesso negado.' }, 403);
      const { submissaoId, mensagem, anexoUrl, anexoPath, anexoNome } = body;
      const sub = await sql`SELECT autor_id, editor_responsavel_id, editor_adjunto_id FROM submissoes WHERE id = ${submissaoId}`;
      if (!sub.length) return json({ erro: 'Submissão não encontrada.' }, 404);
      let destinatarioId;
      if (user.perfil === 'autor') {
        destinatarioId = sub[0].editor_responsavel_id || sub[0].editor_adjunto_id;
        if (!destinatarioId) return json({ erro: 'Nenhum editor responsável encontrado.' }, 400);
      } else {
        destinatarioId = sub[0].autor_id;
      }
      await sql`
        INSERT INTO conversas_submissao (submissao_id, remetente_id, destinatario_id, mensagem, anexo_url, anexo_path, anexo_nome)
        VALUES (${submissaoId}, ${user.id}, ${destinatarioId}, ${mensagem}, ${anexoUrl}, ${anexoPath}, ${anexoNome})
    `;
      await criarNotificacao(destinatarioId, 'mensagem_submissao', `Nova mensagem sobre submissão #${submissaoId}`, mensagem.substring(0, 100), `/cadastro-login/autor-submissoes?submissao=${submissaoId}`);
      return json({ sucesso: true });
    }

    // Retornar também o storage_path para ser usado na mensagem
    return json({
      sucesso: true,
      arquivo: {
        url_acesso: publicUrl,
        storage_path: filePath,
        id: inserido[0].id
      }
    })
  } catch (erro) {
    console.error('❌ upload-material erro:', erro)
    return json({ erro: 'Erro ao enviar arquivo.', detalhe: erro.message }, 500)
  }
}

exports.handler = wrapHttp(main)