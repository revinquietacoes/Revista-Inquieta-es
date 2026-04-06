const { sql, json, getUserById, ensureSupportTables } = require('./_db')
const { wrapHttp } = require('./_netlify')

function getHeader(headers, name) {
  if (!headers) return null
  if (typeof headers.get === 'function') {
    return headers.get(name) || headers.get(name.toLowerCase()) || null
  }
  return headers[name] || headers[name.toLowerCase()] || null
}

function getAuthenticatedUserId(req) {
  const headers = req.headers
  const headerId = getHeader(headers, 'x-user-id') || getHeader(headers, 'X-User-Id')
  return headerId ? Number(headerId) : null
}

const main = async (req) => {
  try {
    if (req.method !== 'GET') {
      return json({ erro: 'Método não permitido.' }, 405)
    }

    await ensureSupportTables()

    // Autenticação via header X-User-Id (não via query string por segurança)
    const userId = getAuthenticatedUserId(req)
    if (!userId) {
      console.log('❌ Nenhum X-User-Id encontrado no header')
      return json({ erro: 'Usuário não autenticado. Header X-User-Id ausente.' }, 401)
    }

    const user = await getUserById(userId)
    if (!user) {
      return json({ erro: 'Usuário não encontrado.' }, 404)
    }

    // Consulta apenas a tabela certificados_privados (já que a outra pode não existir ainda)
    // Se quiser unir com certificados_parecerista, descomente depois que a tabela existir
    const rows = await sql`
      SELECT id, tipo, categoria, titulo, nome_arquivo, mime_type, criado_em, blob_key, 'privado' as origem
      FROM certificados_privados
      WHERE usuario_id = ${user.id}
      ORDER BY criado_em DESC
    `

    return json({
      sucesso: true,
      certificados: rows.map(row => ({
        id: row.id,
        tipo: row.tipo,
        categoria: row.categoria,
        titulo: row.titulo,
        nome_arquivo: row.nome_arquivo,
        mime_type: row.mime_type,
        criado_em: row.criado_em,
        blob_key: row.blob_key,
        origem: row.origem
      }))
    })
  } catch (error) {
    console.error('❌ Erro em list-my-certificates:', error)
    return json({ erro: 'Erro interno ao listar certificados.', detalhe: error.message }, 500)
  }
}

exports.handler = wrapHttp(main)