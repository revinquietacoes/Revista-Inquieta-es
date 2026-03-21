const { sql } = require('./_db')
const { wrapHttp } = require('./_netlify')

const main = async (req) => {
  try {
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ erro: 'Método não permitido.' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' }
      })
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
      return new Response(JSON.stringify({ erro: 'Preencha os campos obrigatórios da submissão.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    const usuarios = await sql`SELECT id, perfil, status FROM usuarios WHERE id = ${usuarioId} LIMIT 1`
    if (!usuarios.length) {
      return new Response(JSON.stringify({ erro: 'Usuário não encontrado.' }), { status: 404, headers: { 'Content-Type': 'application/json' } })
    }
    if (usuarios[0].perfil !== 'autor') {
      return new Response(JSON.stringify({ erro: 'Apenas autores(as) podem criar submissões.' }), { status: 403, headers: { 'Content-Type': 'application/json' } })
    }
    if (usuarios[0].status && usuarios[0].status !== 'ativo') {
      return new Response(JSON.stringify({ erro: 'O cadastro do autor não está ativo.' }), { status: 403, headers: { 'Content-Type': 'application/json' } })
    }

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

    return new Response(JSON.stringify({ sucesso: true, submissao: rows[0] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  } catch (erro) {
    return new Response(JSON.stringify({ erro: 'Erro ao registrar submissão.', detalhe: erro.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
}

exports.handler = wrapHttp(main)