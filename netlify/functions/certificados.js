const { getStore } = require('@netlify/blobs')
const { sql, json, getUserById, ensureSupportTables } = require('./_db')
const { wrapHttp } = require('./_netlify')

function formatTipo(tipo) {
  return { evento: 'Evento ou curso', parecer: 'Parecer realizado', equipe_editorial: 'Equipe editorial' }[tipo] || 'Documento'
}
function formatCategoria(cat) {
  return { certificado_evento: 'Certificado de evento', certificado_parecer: 'Certificado de parecer', certificado_equipe: 'Certificado de equipe editorial' }[cat] || cat
}

const main = async (req) => {
  try {
    await ensureSupportTables()
    const store = getStore('certificados-usuarios')
    const url = new URL(req.url)
    const action = url.searchParams.get('action') || (req.method === 'POST' ? 'list' : 'download')
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {}
    const userId = Number(url.searchParams.get('userId') || body.userId || 0)
    const user = await getUserById(userId)
    if (!user) return json({ erro: 'Usuário não encontrado.' }, 404)

    if (action === 'list') {
      const rows = await sql`SELECT id, titulo, descricao, tipo, categoria, nome_arquivo, criado_em FROM certificados_privados WHERE usuario_id = ${user.id} ORDER BY criado_em DESC`
      const items = rows.map((row) => ({ ...row, tipo_label: formatTipo(row.tipo), categoria_label: formatCategoria(row.categoria), data_envio_formatada: row.criado_em ? new Date(row.criado_em).toLocaleDateString('pt-BR') : '' }))
      return json({ sucesso: true, items })
    }

    if (action === 'download') {
      const certificateId = Number(url.searchParams.get('certificateId'))
      if (!certificateId) return json({ erro: 'Certificado não informado.' }, 400)
      const rows = await sql`SELECT * FROM certificados_privados WHERE id = ${certificateId} AND usuario_id = ${user.id} LIMIT 1`
      const item = rows[0]
      if (!item) return json({ erro: 'Certificado não encontrado para este usuário.' }, 404)
      const blob = await store.get(item.blob_key, { type: 'arrayBuffer' })
      if (!blob) return json({ erro: 'Arquivo não localizado no armazenamento.' }, 404)
      return new Response(blob, { status: 200, headers: { 'Content-Type': item.mime_type || 'application/pdf', 'Content-Disposition': `inline; filename="${item.nome_arquivo || 'certificado.pdf'}"`, 'Cache-Control': 'private, no-store' } })
    }

    return json({ erro: 'Ação inválida.' }, 400)
  } catch (erro) {
    return json({ erro: 'Erro ao carregar certificados.', detalhe: erro.message }, 500)
  }
}

exports.handler = wrapHttp(main)
