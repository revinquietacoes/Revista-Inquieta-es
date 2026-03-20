import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL);

function json(statusCode, data) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(data),
  };
}

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

    const type = event.queryStringParameters?.type || null;

    let rows;
    if (type) {
      rows = await sql`
        SELECT
          id,
          certificate_type,
          title,
          created_at
        FROM private_certificates
        WHERE user_id = ${userId}
          AND certificate_type = ${type}
        ORDER BY created_at DESC
      `;
    } else {
      rows = await sql`
        SELECT
          id,
          certificate_type,
          title,
          created_at
        FROM private_certificates
        WHERE user_id = ${userId}
        ORDER BY created_at DESC
      `;
    }

    return json(200, rows);
  } catch (error) {
    console.error('list-my-certificates error:', error);
    return json(500, { error: 'Erro interno ao listar certificados.' });
  }
}