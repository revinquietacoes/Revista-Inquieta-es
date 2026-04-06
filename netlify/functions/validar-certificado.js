const { sql, json } = require('./_db');
const { wrapHttp } = require('./_netlify');

const main = async (req) => {
  try {
    if (req.method !== 'GET') return json({ erro: 'Método não permitido.' }, 405);

    const url = new URL(req.url);
    const codigo = url.searchParams.get('codigo') || '';

    if (!codigo || codigo.trim() === '') {
      return json({ valido: false, erro: 'Código não informado.' }, 400);
    }

    const rows = await sql`
      SELECT 
        cp.id,
        cp.titulo,
        cp.descricao,
        cp.tipo,
        cp.categoria,
        cp.criado_em,
        u.nome AS destinatario_nome,
        u.email AS destinatario_email
      FROM certificados_privados cp
      JOIN usuarios u ON cp.usuario_id = u.id
      WHERE cp.codigo_autenticidade = ${codigo.trim()}
      LIMIT 1
    `;

    if (!rows.length) {
      return json({ valido: false, erro: 'Código inválido ou certificado não encontrado.' }, 404);
    }

    const cert = rows[0];
    return json({
      valido: true,
      certificado: {
        id: cert.id,
        titulo: cert.titulo,
        descricao: cert.descricao,
        tipo: cert.tipo,
        categoria: cert.categoria,
        emitido_em: cert.criado_em,
        destinatario: {
          nome: cert.destinatario_nome,
          email: cert.destinatario_email
        }
      }
    });
  } catch (error) {
    console.error('Erro na validação:', error);
    return json({ valido: false, erro: 'Erro interno ao validar certificado.' }, 500);
  }
};

exports.handler = wrapHttp(main);