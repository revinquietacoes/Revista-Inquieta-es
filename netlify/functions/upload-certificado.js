import { neon } from '@neondatabase/serverless';
import { getStore } from '@netlify/blobs';

const sql = neon(process.env.DATABASE_URL);
const certificatesStore = getStore('certificados-privados');

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

function sanitizeFileName(name) {
  return String(name || 'certificado.pdf')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .toLowerCase();
}

export async function handler(event) {
  try {
    if (event.httpMethod !== 'POST') {
      return json(405, { error: 'Método não permitido.' });
    }

    const editorId = getAuthenticatedUserId(event);
    if (!editorId) {
      return json(401, { error: 'Usuário não autenticado.' });
    }

    const editorRows = await sql`
      SELECT id, perfil, status
      FROM usuarios
      WHERE id = ${editorId}
      LIMIT 1
    `;

    if (!editorRows.length) {
      return json(403, { error: 'Usuário não encontrado.' });
    }

    const editor = editorRows[0];

    if (editor.status !== 'ativo') {
      return json(403, { error: 'Usuário inativo.' });
    }

    if (editor.perfil !== 'editor_chefe') {
      return json(403, { error: 'Apenas o editor-chefe pode enviar certificados.' });
    }

    const body = JSON.parse(event.body || '{}');
    const {
      target_user_id,
      certificate_type,
      title,
      file_name,
      file_base64,
      mime_type,
    } = body;

    if (!target_user_id || !certificate_type || !title || !file_base64) {
      return json(400, {
        error: 'Campos obrigatórios: target_user_id, certificate_type, title, file_base64.',
      });
    }

    const userRows = await sql`
      SELECT id, nome, perfil, status
      FROM usuarios
      WHERE id = ${Number(target_user_id)}
      LIMIT 1
    `;

    if (!userRows.length) {
      return json(404, { error: 'Usuário destinatário não encontrado.' });
    }

    const targetUser = userRows[0];

    if (targetUser.status !== 'ativo') {
      return json(403, { error: 'Usuário destinatário inativo.' });
    }

    const safeFileName = sanitizeFileName(file_name || `${title}.pdf`);
    const timestamp = Date.now();
    const blobKey = `usuarios/${targetUser.id}/certificados/${certificate_type}/${timestamp}-${safeFileName}`;

    const buffer = Buffer.from(file_base64, 'base64');

    await certificatesStore.set(blobKey, buffer, {
      metadata: {
        title,
        certificate_type,
        target_user_id: String(targetUser.id),
        uploaded_by: String(editorId),
        mime_type: mime_type || 'application/pdf',
      },
    });

    const inserted = await sql`
      INSERT INTO private_certificates (
        user_id,
        certificate_type,
        title,
        blob_key,
        mime_type,
        uploaded_by
      )
      VALUES (
        ${targetUser.id},
        ${certificate_type},
        ${title},
        ${blobKey},
        ${mime_type || 'application/pdf'},
        ${editorId}
      )
      RETURNING id, created_at
    `;

    return json(201, {
      ok: true,
      certificate: inserted[0],
    });
  } catch (error) {
    console.error('upload-certificate error:', error);
    return json(500, { error: 'Erro interno ao enviar certificado.' });
  }
}