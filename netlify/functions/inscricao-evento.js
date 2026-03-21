const { sql, json, parseJson, getUserById, canAccess } = require('./_db')
const { wrapHttp } = require('./_netlify')

async function ensureTables() {
  await sql`CREATE TABLE IF NOT EXISTS inscricoes_eventos (id BIGSERIAL PRIMARY KEY, usuario_id BIGINT NOT NULL, nome TEXT NOT NULL, email TEXT NOT NULL, telefone TEXT, instituicao TEXT, origem TEXT, orcid TEXT, atividade TEXT NOT NULL, modalidade TEXT, vinculo TEXT, observacoes TEXT, criado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, atualizado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP)`
  await sql`CREATE INDEX IF NOT EXISTS idx_inscricoes_eventos_usuario_id ON inscricoes_eventos (usuario_id)`
}

const main = async (req) => {
  try {
    if (req.method !== 'POST') return json({ erro: 'Método não permitido.' }, 405)
    await ensureTables()
    const body = await parseJson(req)
    const userId = Number(body.userId || body.usuario_id_visual)
    if (!userId) return json({ erro: 'Usuário não informado.' }, 400)
    const user = await getUserById(userId)
    if (!user) return json({ erro: 'Usuário não encontrado.' }, 404)
    if (!canAccess(user, ['autor'])) return json({ erro: 'Somente autores cadastrados podem se inscrever nas atividades por esta página.' }, 403)
    const nome = body.nome || user.nome
    const email = body.email || user.email
    const atividade = body.atividade
    if (!nome || !email || !atividade) return json({ erro: 'Preencha nome, e-mail e atividade.' }, 400)
    await sql`INSERT INTO inscricoes_eventos (usuario_id, nome, email, telefone, instituicao, origem, orcid, atividade, modalidade, vinculo, observacoes) VALUES (${user.id}, ${nome}, ${email}, ${body.telefone || user.telefone || null}, ${body.instituicao || user.instituicao || null}, ${body.origem || user.origem || null}, ${body.orcid || user.orcid || null}, ${atividade}, ${body.modalidade || null}, ${body.vinculo || 'Autor(a) cadastrado(a)'}, ${body.observacoes || null})`
    return json({ sucesso: true, mensagem: 'Inscrição registrada com sucesso na base do evento.' })
  } catch (erro) {
    return json({ erro: 'Erro ao registrar inscrição.', detalhe: erro.message }, 500)
  }
}

exports.handler = wrapHttp(main)
