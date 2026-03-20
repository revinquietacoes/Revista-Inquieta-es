import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL);

function json(statusCode, data) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(data),
  };
}

// Ajuste esta função se seu login usa cookie/sessão.
// Por enquanto, lê x-user-id ou ?user_id=
function getAuthenticatedUserId(event) {
  const headerId =
    event.headers['x-user-id'] ||
    event.headers['X-User-Id'] ||
    null;

  const queryId = event.queryStringParameters?.user_id || null;

  return headerId ? Number(headerId) : queryId ? Number(queryId) : null;
}

export async function handler(event) {
  try {
    if (event.httpMethod !== 'GET') {
      return json(405, { error: 'Método não permitido.' });
    }

    const userId = getAuthenticatedUserId(event);

    if (!userId) {
      return json(401, { error: 'Usuário não autenticado.' });
    }

    const rows = await sql`
      SELECT
        id,
        nome,
        email,
        instituicao,
        perfil,
        status,
        orcid,
        lattes,
        origem,
        telefone,
        foto_perfil_url
      FROM usuarios
      WHERE id = ${userId}
      LIMIT 1
    `;

    if (!rows.length) {
      return json(404, { error: 'Usuário não encontrado.' });
    }

    const user = rows[0];

    if (user.status !== 'ativo') {
      return json(403, { error: 'Usuário inativo.' });
    }

    return json(200, {
      id: user.id,
      full_name: user.nome,
      email: user.email,
      institution: user.instituicao,
      profile: user.perfil,
      status: user.status,
      orcid: user.orcid,
      lattes: user.lattes,
      origin: user.origem,
      phone: user.telefone,
      avatar_url: user.foto_perfil_url,
    });
  } catch (error) {
    console.error('get-user-profile error:', error);
    return json(500, { error: 'Erro interno ao buscar perfil.' });
  }
}