import { getStore } from '@netlify/blobs'
import { sql, json, getUserById } from './_db.js'

async function ensureTables() {
  await sql`CREATE TABLE IF NOT EXISTS certificados_privados (id BIGSERIAL PRIMARY KEY, usuario_id BIGINT NOT NULL, enviado_por_usuario_id BIGINT, titulo TEXT NOT NULL, descricao TEXT, tipo TEXT NOT NULL DEFAULT 'evento', categoria TEXT NOT NULL DEFAULT 'certificado_evento', blob_key TEXT NOT NULL, nome_arquivo TEXT NOT NULL, mime_type TEXT NOT NULL DEFAULT 'application/pdf', tamanho_bytes BIGINT, criado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP)`
  await sql`CREATE INDEX IF NOT EXISTS idx_certificados_privados_usuario_id ON certificados_privados (usuario_id)`
}

function formatTipo(tipo) {
  return { evento: 'Evento ou curso', parecer: 'Parecer realizado', equipe_editorial: 'Equipe editorial' }[tipo] || 'Documento'
}
function formatCategoria(cat) {
  return { certificado_evento: 'Certificado de evento', certificado_parecer: 'Certificado de parecer', certificado_equipe: 'Certificado de equipe editorial' }[cat] || cat
}

export default async (req) => {
  try {
    await ensureTables()
    const store = getStore('certificados-usuarios')
    const url = new URL(req.url)
    const action = url.searchParams.get('action') || (req.method === 'POST' ? 'list' : 'download')
    const userId = Number(url.searchParams.get('userId') || (req.method === 'POST' ? (await req.json()).userId : 0))
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
