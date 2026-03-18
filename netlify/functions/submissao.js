import { neon } from '@netlify/neon'

const sql = neon(process.env.DATABASE_URL || process.env.NETLIFY_DATABASE_URL)

export default async (req) => {
  try {
    if (req.method !== 'POST') {
      return new Response(
        JSON.stringify({ erro: 'Método não permitido.' }),
        { status: 405, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const formData = await req.formData()

    const usuarioId = formData.get('usuario_id')
    const titulo = formData.get('titulo')
    const secao = formData.get('secao')
    const idioma = formData.get('idioma')
    const resumo = formData.get('resumo')
    const palavrasChave = formData.get('palavras_chave')

    if (!usuarioId || !titulo || !secao || !idioma || !resumo) {
      return new Response(
        JSON.stringify({ erro: 'Preencha os campos obrigatórios da submissão.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const usuarios = await sql`
      SELECT id, perfil, nome
      FROM usuarios
      WHERE id = ${usuarioId}
      LIMIT 1
    `

    if (usuarios.length === 0) {
      return new Response(
        JSON.stringify({ erro: 'Usuário não encontrado.' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const usuario = usuarios[0]

    if (usuario.perfil !== 'autor') {
      return new Response(
        JSON.stringify({ erro: 'Apenas autores podem criar submissões.' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const prazo = new Date()
    prazo.setDate(prazo.getDate() + 60)
    const prazoIso = prazo.toISOString().slice(0, 10)

    const resultado = await sql`
      INSERT INTO submissoes (
        autor_id,
        titulo,
        secao,
        idioma,
        resumo,
        palavras_chave,
        status,
        prazo_final_avaliacao
      )
      VALUES (
        ${usuarioId},
        ${titulo},
        ${secao},
        ${idioma},
        ${resumo},
        ${palavrasChave || null},
        'submetido',
        ${prazoIso}
      )
      RETURNING id, titulo, status, prazo_final_avaliacao
    `

    const submissao = resultado[0]

    const arquivoPrincipal = formData.get('arquivo_principal')
    if (arquivoPrincipal && typeof arquivoPrincipal === 'object' && arquivoPrincipal.name) {
      await sql`
        INSERT INTO arquivos_submissao (
          submissao_id,
          nome_arquivo,
          tipo_arquivo,
          tamanho_bytes,
          url_arquivo,
          categoria
        )
        VALUES (
          ${submissao.id},
          ${arquivoPrincipal.name},
          ${arquivoPrincipal.type || null},
          ${arquivoPrincipal.size || null},
          ${null},
          'principal'
        )
      `
    }

    const complementares = formData.getAll('arquivos_complementares')
    for (const arquivo of complementares) {
      if (arquivo && typeof arquivo === 'object' && arquivo.name) {
        await sql`
          INSERT INTO arquivos_submissao (
            submissao_id,
            nome_arquivo,
            tipo_arquivo,
            tamanho_bytes,
            url_arquivo,
            categoria
          )
          VALUES (
            ${submissao.id},
            ${arquivo.name},
            ${arquivo.type || null},
            ${arquivo.size || null},
            ${null},
            'complementar'
          )
        `
      }
    }

    await sql`
      INSERT INTO mensagens_submissao (
        submissao_id,
        remetente_id,
        mensagem
      )
      VALUES (
        ${submissao.id},
        ${usuarioId},
        ${'Submissão registrada no sistema editorial.'}
      )
    `

    return new Response(
      JSON.stringify({
        sucesso: true,
        submissao
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )

  } catch (erro) {
    return new Response(
      JSON.stringify({
        erro: 'Erro ao registrar submissão.',
        detalhe: erro.message
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}