const { sql, json, getAuthenticatedUserId, getUserById, canAccess } = require('./_db')
const { wrapHttp } = require('./_netlify')

const main = async (req) => {
  try {
    if (req.method !== 'POST') return json({ erro: 'Método não permitido.' }, 405)

    const formData = await req.formData()
    const actorId = getAuthenticatedUserId(req, formData.get('usuario_id'))
    const requestedAuthorId = Number(formData.get('usuario_id') || formData.get('autor_id') || actorId || 0)
    const titulo = String(formData.get('titulo') || '').trim()
    const secao = String(formData.get('secao') || '').trim()
    const idioma = String(formData.get('idioma') || 'pt-BR').trim()
    const resumo = String(formData.get('resumo') || '').trim()
    const palavrasChave = String(formData.get('palavras_chave') || '').trim()
    const dossieRaw = formData.get('dossie_id')
    const dossieId = dossieRaw ? Number(dossieRaw) : null

    if (!actorId || !requestedAuthorId) return json({ erro: 'Usuário inválido para criar submissão.' }, 403)
    if (!titulo || !secao || !idioma || !resumo) return json({ erro: 'Preencha os campos obrigatórios da submissão.' }, 400)

    const actor = await getUserById(actorId)
    if (!actor) return json({ erro: 'Usuário autenticado não encontrado.' }, 404)
    if (actor.status && actor.status !== 'ativo') return json({ erro: 'Usuário autenticado inativo.' }, 403)

    const author = await getUserById(requestedAuthorId)
    if (!author) return json({ erro: 'Autor(a) não encontrado(a).' }, 404)
    if (author.status && author.status !== 'ativo') return json({ erro: 'O cadastro do autor não está ativo.' }, 403)
    if (author.perfil !== 'autor') return json({ erro: 'O usuário selecionado não é autor(a).' }, 400)

    if (actorId !== requestedAuthorId && !canAccess(actor, ['editor_chefe', 'editor_adjunto'])) {
      return json({ erro: 'Você não pode criar submissão para outro usuário.' }, 403)
    }

    const prazo = new Date()
    prazo.setDate(prazo.getDate() + 60)
    const prazoIso = prazo.toISOString().slice(0, 10)

    const rows = await sql`
      INSERT INTO submissoes (autor_id, titulo, secao, idioma, resumo, palavras_chave, dossie_id, status, prazo_final_avaliacao)
      VALUES (${author.id}, ${titulo}, ${secao}, ${idioma}, ${resumo}, ${palavrasChave || null}, ${dossieId || null}, 'submetido', ${prazoIso})
      RETURNING id, titulo, status, prazo_final_avaliacao, data_submissao
    `

    return json({ sucesso: true, submissao: rows[0] })
  } catch (erro) {
    console.error('submissao erro:', erro)
    return json({ erro: 'Erro ao registrar submissão.', detalhe: erro.message }, 500)
  }
}

exports.handler = wrapHttp(main)
