import { neon } from '@neondatabase/serverless';
import { wrapHttp } from './_netlify.js'

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
    if (event.httpMethod !== 'POST') {
      return json(405, { error: 'Método não permitido.' });
    }

    const userId = getAuthenticatedUserId(event);
    if (!userId) {
      return json(401, { error: 'Usuário não autenticado.' });
    }

    const body = JSON.parse(event.body || '{}');
    const {
      event_slug,
      course_name,
      observacoes = '',
    } = body;

    if (!event_slug || !course_name) {
      return json(400, {
        error: 'Campos obrigatórios: event_slug e course_name.',
      });
    }

    const users = await sql`
      SELECT
        id,
        nome,
        email,
        instituicao,
        perfil,
        status
      FROM usuarios
      WHERE id = ${userId}
      LIMIT 1
    `;

    if (!users.length) {
      return json(403, {
        error: 'Somente usuários cadastrados podem se inscrever.',
      });
    }

    const user = users[0];

    if (user.status !== 'ativo') {
      return json(403, {
        error: 'Usuário inativo.',
      });
    }

    // Regra pedida: só autor pode se inscrever
    if (user.perfil !== 'autor') {
      return json(403, {
        error: 'A inscrição é permitida apenas para usuários com perfil de autor.',
      });
    }

    const existing = await sql`
      SELECT id
      FROM event_registrations
      WHERE user_id = ${userId} AND event_slug = ${event_slug}
      LIMIT 1
    `;

    if (existing.length > 0) {
      return json(409, {
        error: 'Este usuário já está inscrito nesta atividade.',
      });
    }

    const inserted = await sql`
      INSERT INTO event_registrations (
        user_id,
        event_slug,
        full_name,
        email,
        institution,
        course_name,
        observacoes
      )
      VALUES (
        ${userId},
        ${event_slug},
        ${user.nome},
        ${user.email},
        ${user.instituicao},
        ${course_name},
        ${observacoes}
      )
      RETURNING id, created_at
    `;

    return json(201, {
      ok: true,
      registration: inserted[0],
    });
  } catch (error) {
    console.error('create-event-registration error:', error);
    return json(500, { error: 'Erro interno ao criar inscrição.' });
  }
}

export const handler = wrapHttp(default)