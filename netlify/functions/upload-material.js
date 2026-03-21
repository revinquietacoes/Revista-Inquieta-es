const { getStore } = require('@netlify/blobs')
const { sql, json, ensureSupportTables, getUserById, getAuthenticatedUserId } = require('./_db')
const { wrapHttp } = require('./_netlify')

const store = getStore('revista-arquivos')

function sanitizarNome(nome = '') {
  return String(nome)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
}

const main = async (req) => {
  try {
    if (req.method !== 'POST') return json({ erro: 'Método não permitido.' }, 405)
    await ensureSupportTables()

    const form = await req.formData()
    const authUserId = getAuthenticatedUserId(req, form.get('usuario_id'))
    const usuarioId = Number(form.get('usuario_id') || authUserId || 0)
    const submissaoId = form.get('submissao_id') ? Number(form.get('submissao_id')) : null
    const categoria = String(form.get('categoria') || 'outro')
    const arquivo = form.get('arquivo')

    if (!authUserId || !usuarioId || authUserId !== usuarioId) return json({ erro: 'Usuário inválido para upload.' }, 403)
    if (!arquivo || typeof arquivo === 'string') return json({ erro: 'Dados obrigatórios ausentes.' }, 400)

    const usuario = await getUserById(authUserId)
    if (!usuario) return json({ erro: 'Usuário não encontrado.' }, 404)
    if (usuario.status !== 'ativo') return json({ erro: 'Usuário inativo.' }, 403)

    const permitidos = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'image/jpeg',
      'image/png',
      'image/webp'
    ]
    if (!permitidos.includes(arquivo.type)) return json({ erro: 'Tipo de arquivo não permitido.' }, 400)
    if (arquivo.size > 4_500_000) return json({ erro: 'Arquivo acima do limite de 4,5 MB.' }, 400)

    const blobKey = `usuarios/${usuarioId}/${categoria}/${Date.now()}-${sanitizarNome(arquivo.name || 'arquivo')}`
    const bytes = await arquivo.arrayBuffer()
    await store.set(blobKey, bytes, {
      metadata: {
        usuario_id: String(usuarioId),
        submissao_id: submissaoId ? String(submissaoId) : '',
        categoria,
        nome_original: arquivo.name,
        mime_type: arquivo.type
      }
    })

    const urlAcesso = `/.netlify/functions/arquivo?key=${encodeURIComponent(blobKey)}`
    const inserido = await sql`
      INSERT INTO arquivos_publicacao (usuario_id, submissao_id, categoria, nome_original, mime_type, tamanho_bytes, blob_key, blob_store, url_acesso, publico)
      VALUES (${usuarioId}, ${submissaoId}, ${categoria}, ${arquivo.name}, ${arquivo.type}, ${arquivo.size}, ${blobKey}, 'revista-arquivos', ${urlAcesso}, FALSE)
      RETURNING id, url_acesso, blob_key
    `

    if (submissaoId && categoria === 'manuscrito') {
      const check = await sql`SELECT to_regclass('public.arquivos_submissao') AS nome`
      if (check?.[0]?.nome) {
        await sql`
          INSERT INTO arquivos_submissao (submissao_id, nome_arquivo, tipo_arquivo, tamanho_bytes, url_arquivo, categoria)
          VALUES (${submissaoId}, ${arquivo.name}, ${arquivo.type}, ${arquivo.size}, ${urlAcesso}, 'principal')
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
            await sql`INSERT INTO arquivos_avaliacao (submissao_id, nome_arquivo, tipo_arquivo, tamanho_bytes, url_arquivo, categoria) VALUES (${submissaoId}, ${arquivo.name}, ${arquivo.type}, ${arquivo.size}, ${urlAcesso}, 'devolutiva')`
          } else {
            await sql`INSERT INTO arquivos_avaliacao (nome_arquivo, tipo_arquivo, tamanho_bytes, url_arquivo, categoria) VALUES (${arquivo.name}, ${arquivo.type}, ${arquivo.size}, ${urlAcesso}, 'devolutiva')`
          }
        }
      } catch (e) {
        console.error('Falha ao registrar devolutiva em arquivos_avaliacao:', e)
      }
    }

    return json({ sucesso: true, arquivo: inserido[0] }, 200)
  } catch (erro) {
    return json({ erro: 'Erro ao enviar arquivo.', detalhe: erro.message }, 500)
  }
}

exports.handler = wrapHttp(main)
