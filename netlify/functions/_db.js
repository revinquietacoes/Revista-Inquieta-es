import { neon } from '@netlify/neon'

export const sql = neon(process.env.DATABASE_URL || process.env.NETLIFY_DATABASE_URL)

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

export async function parseJson(req) {
  try { return await req.json() } catch { return {} }
}

export async function getUserById(id, withPassword = false) {
  const fields = withPassword
    ? sql`SELECT id, nome, email, perfil, instituicao, orcid, lattes, origem, telefone,
           foto_perfil_url, foto_perfil_aprovada, consentimento_foto_publica,
           receber_noticias_email, status, criado_em, atualizado_em, senha_hash,
           ultimo_acesso_em,
           CASE WHEN ultimo_acesso_em IS NOT NULL AND ultimo_acesso_em > (CURRENT_TIMESTAMP - INTERVAL '2 minutes') THEN TRUE ELSE FALSE END AS online
    FROM usuarios WHERE id = ${id} LIMIT 1`
    : sql`SELECT id, nome, email, perfil, instituicao, orcid, lattes, origem, telefone,
           foto_perfil_url, foto_perfil_aprovada, consentimento_foto_publica,
           receber_noticias_email, status, criado_em, atualizado_em,
           ultimo_acesso_em,
           CASE WHEN ultimo_acesso_em IS NOT NULL AND ultimo_acesso_em > (CURRENT_TIMESTAMP - INTERVAL '2 minutes') THEN TRUE ELSE FALSE END AS online
    FROM usuarios WHERE id = ${id} LIMIT 1`;
  const rows = await fields
  return rows[0] || null
}

export function canAccess(user, allowed) {
  if (!user || !user.perfil) return false

  const perfil = String(user.perfil).toLowerCase().trim()
  const allowedNormalized = allowed.map(r => r.toLowerCase())

  return allowedNormalized.includes(perfil)
}
