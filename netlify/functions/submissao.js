const { sql, json } = require('./_db')
const { wrapHttp } = require('./_netlify')

const main = async (req) => {
  try {
    if (req.method !== 'POST') {
      return json({ erro: 'Método não permitido.' }, 405)
    }

    const formData = await req.formData()
    const usuarioId = Number(formData.get('usuario_id') || 0)
    const titulo = String(formData.get('titulo') || '').trim()
    const secao = String(formData.get('secao') || '').trim()
    const idioma = String(formData.get('idioma') || 'pt-BR').trim()
    const resumo = String(formData.get('resumo') || '').trim()
    const palavrasChave = String(formData.get('palavras_chave') || '').trim()
    const dossieRaw = formData.get('dossie_id')
    const dossieId = dossieRaw ? Number(dossieRaw) : null

    if (!usuarioId || !titulo || !secao || !idioma || !resumo) {
      return json({ erro: 'Preencha os campos obrigatórios da submissão.' }, 400)
    }

    const usuarios = await sql`SELECT id, perfil, status FROM usuarios WHERE id = ${usuarioId} LIMIT 1`
    if (!usuarios.length) return json({ erro: 'Usuário não encontrado.' }, 404)
    if (usuarios[0].perfil !== 'autor') return json({ erro: 'Apenas autores(as) podem criar submissões.' }, 403)
    if (usuarios[0].status && usuarios[0].status !== 'ativo') return json({ erro: 'O cadastro do autor não está ativo.' }, 403)

    const prazo = new Date()
    prazo.setDate(prazo.getDate() + 60)
    const prazoIso = prazo.toISOString().slice(0, 10)

    const rows = await sql`
      INSERT INTO submissoes (
        autor_id, titulo, secao, idioma, resumo, palavras_chave, dossie_id, status, prazo_final_avaliacao
      ) VALUES (
        ${usuarioId}, ${titulo}, ${secao}, ${idioma}, ${resumo}, ${palavrasChave || null}, ${dossieId || null}, 'submetido', ${prazoIso}
      )
      RETURNING id, titulo, status, prazo_final_avaliacao, data_submissao
    `

    return json({ sucesso: true, submissao: rows[0] }, 200)
  } catch (erro) {
    return json({ erro: 'Erro ao registrar submissão.', detalhe: erro.message }, 500)
  }
}

exports.handler = wrapHttp(main)
