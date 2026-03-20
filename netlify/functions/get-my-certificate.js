import { neon } from '@neondatabase/serverless';
import { getStore } from '@netlify/blobs';

const sql = neon(process.env.DATABASE_URL);
const certificatesStore = getStore('certificados-privados');

function getAuthenticatedUserId(event) {
  const headerId =
    event.headers['x-user-id'] ||
    event.headers['X-User-Id'] ||
    null;

  const queryId = event.queryStringParameters?.user_id || null;

  return headerId ? Number(headerId) : queryId ? Number(queryId) : null;
}

function safeDownloadName(name) {
  return String(name || 'certificado')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-');
}

export async function handler(event) {
  try {
    if (event.httpMethod !== 'GET') {
      return {
        statusCode: 405,
        body: 'Método não permitido.',
      };
    }

    const userId = getAuthenticatedUserId(event);
    if (!userId) {
      return {
        statusCode: 401,
        body: 'Usuário não autenticado.',
      };
    }

    const certificateId = event.queryStringParameters?.id;
    if (!certificateId) {
      return {
        statusCode: 400,
        body: 'Parâmetro id é obrigatório.',
      };
    }

    const rows = await sql`
      SELECT
        id,
        user_id,
        title,
        blob_key,
        mime_type
      FROM private_certificates
      WHERE id = ${Number(certificateId)}
      LIMIT 1
    `;

    if (!rows.length) {
      return {
        statusCode: 404,
        body: 'Certificado não encontrado.',
      };
    }

    const cert = rows[0];

    if (Number(cert.user_id) !== Number(userId)) {
      return {
        statusCode: 403,
        body: 'Acesso negado.',
      };
    }

    const blob = await certificatesStore.get(cert.blob_key, {
      type: 'arrayBuffer',
    });

    if (!blob) {
      return {
        statusCode: 404,
        body: 'Arquivo do certificado não encontrado.',
      };
    }

    const base64 = Buffer.from(blob).toString('base64');
    const fileName = `${safeDownloadName(cert.title)}.pdf`;

    return {
      statusCode: 200,
      isBase64Encoded: true,
      headers: {
        'Content-Type': cert.mime_type || 'application/pdf',
        'Content-Disposition': `inline; filename="${fileName}"`,
        'Cache-Control': 'private, no-store',
      },
      body: base64,
    };
  } catch (error) {
    console.error('get-my-certificate error:', error);
    return {
      statusCode: 500,
      body: 'Erro interno ao obter certificado.',
    };
  }
}