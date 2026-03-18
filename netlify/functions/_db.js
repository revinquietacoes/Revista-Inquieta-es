import { neon } from '@netlify/neon'

export const sql = neon(process.env.DATABASE_URL || process.env.NETLIFY_DATABASE_URL)

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

export async function parseJson(req) {
  try {
    return await req.json()
  } catch {
    return {}
  }
}

export async function getUserById(id) {
  const rows = await sql`
    SELECT id, nome, email, perfil, instituicao, orcid, lattes, origem, telefone,
           foto_perfil_url, foto_perfil_aprovada, consentimento_foto_publica,
           receber_noticias_email, status, criado_em, atualizado_em
    FROM usuarios
    WHERE id = ${id}
    LIMIT 1
  `
  return rows[0] || null
}

export function canAccess(user, allowed) {
  return !!user && allowed.includes(user.perfil)
}
