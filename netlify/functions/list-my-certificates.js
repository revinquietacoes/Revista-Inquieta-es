const { sql, json, getUserById, ensureSupportTables, tableExists } = require('./_db')
const { wrapHttp } = require('./_netlify')

function getHeader(headers, name) {
  if (!headers) return null
  if (typeof headers.get === 'function') {
    return headers.get(name) || headers.get(name.toLowerCase()) || null
  }
  return headers[name] || headers[name.toLowerCase()] || null
}

function getAuthenticatedUserId(req, url) {
  const headerId = getHeader(req.headers, 'x-user-id') || getHeader(req.headers, 'X-User-Id')
  const queryId = url.searchParams.get('user_id')
  return Number(headerId || queryId || 0)
}

const main = async (req) => {
  try {
    if (req.method !== 'GET') return json({ erro: 'Método não permitido.' }, 405)
    await ensureSupportTables()

    const url = new URL(req.url)
    const userId = getAuthenticatedUserId(req, url)
    if (!userId) return json({ erro: 'Usuário não autenticado.' }, 401)

    const user = await getUserById(userId)
    if (!user) return json({ erro: 'Usuário não encontrado.' }, 404)

    const type = String(url.searchParams.get('type') || '').trim()
    let todos = []

    // Verifica se a tabela certificados_privados existe
    const hasPrivados = await tableExists('certificados_privados')
    if (hasPrivados && (!type || type === 'privado')) {
      const privados = await sql`
        SELECT id, tipo, categoria, titulo, nome_arquivo, mime_type, criado_em, blob_key, 'privado' as origem
        FROM certificados_privados
        WHERE usuario_id = ${user.id}
      `
      todos.push(...privados)
    }

    // Verifica se a tabela certificados_parecerista existe
    const hasParecerista = await tableExists('certificados_parecerista')
    if (hasParecerista && (!type || type === 'parecerista')) {
      const pareceristas = await sql`
        SELECT id, tipo, categoria, titulo, nome_arquivo, mime_type, criado_em, blob_key, 'parecerista' as origem
        FROM certificados_parecerista
        WHERE usuario_id = ${user.id}
      `
      todos.push(...pareceristas)
    }

    todos.sort((a, b) => new Date(b.criado_em) - new Date(a.criado_em))

    return json({
      sucesso: true,
      certificados: todos.map(item => ({
        id: item.id,
        tipo: item.tipo,
        categoria: item.categoria,
        titulo: item.titulo,
        nome_arquivo: item.nome_arquivo,
        mime_type: item.mime_type,
        criado_em: item.criado_em,
        blob_key: item.blob_key,
        origem: item.origem
      }))
    })
  } catch (error) {
    console.error('Erro em list-my-certificates:', error)
    return json({ erro: 'Erro interno ao listar certificados.', detalhe: error.message }, 500)
  }
}

exports.handler = wrapHttp(main)