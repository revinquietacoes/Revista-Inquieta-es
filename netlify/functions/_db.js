const { neon } = require('@netlify/neon')

const DB_URL =
  process.env.NETLIFY_DATABASE_URL_UNPOOLED ||
  process.env.DATABASE_URL ||
  process.env.NETLIFY_DATABASE_URL ||
  ''

if (!DB_URL) {
  console.error('Nenhuma URL de banco configurada nas variáveis de ambiente.')
}

const sql = neon(DB_URL)
const columnCache = new Map()

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  })
}

async function parseJson(req) {
  try {
    return await req.json()
  } catch {
    return {}
  }
}

function getHeader(headers, name) {
  if (!headers) return null
  if (typeof headers.get === 'function') {
    return headers.get(name) || headers.get(name.toLowerCase()) || null
  }
  return headers[name] || headers[name.toLowerCase()] || null
}

function normalizeRole(role) {
  const value = String(role || '').toLowerCase().trim()
  if (value === 'editor') return 'editor_adjunto'
  return value
}

function canAccess(user, allowed) {
  if (!user || !user.perfil) return false
  const perfil = normalizeRole(user.perfil)
  const allowedNormalized = allowed.map(normalizeRole)
  return allowedNormalized.includes(perfil)
}

async function getTableColumns(tableName) {
  const key = String(tableName || '').trim().toLowerCase()
  if (!key) return new Set()
  if (columnCache.has(key)) return columnCache.get(key)

  const rows = await sql`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${key}
  `

  const cols = new Set((rows || []).map((row) => row.column_name))
  columnCache.set(key, cols)
  return cols
}

async function tableExists(tableName) {
  const rows = await sql`SELECT to_regclass(${`public.${String(tableName || '').trim().toLowerCase()}`}) AS reg`
  return !!rows?.[0]?.reg
}

function selectExpr(cols, name, fallback = 'NULL') {
  return cols.has(name) ? name : `${fallback} AS ${name}`
}

async function getUserById(id, withPassword = false) {
  const userId = Number(id)
  if (!userId) return null

  const cols = await getTableColumns('usuarios')
  if (!cols.size) return null

  const selectParts = [
    'id',
    selectExpr(cols, 'nome'),
    selectExpr(cols, 'email'),
    `${cols.has('perfil') ? 'perfil' : "NULL::text"} AS perfil`,
    selectExpr(cols, 'instituicao'),
    selectExpr(cols, 'orcid'),
    selectExpr(cols, 'lattes'),
    selectExpr(cols, 'origem'),
    selectExpr(cols, 'telefone'),
    selectExpr(cols, 'foto_perfil_url'),
    `${cols.has('foto_perfil_aprovada') ? 'foto_perfil_aprovada' : 'FALSE'} AS foto_perfil_aprovada`,
    `${cols.has('consentimento_foto_publica') ? 'consentimento_foto_publica' : 'FALSE'} AS consentimento_foto_publica`,
    `${cols.has('receber_noticias_email') ? 'receber_noticias_email' : 'FALSE'} AS receber_noticias_email`,
    `${cols.has('status') ? 'status' : "'ativo'::text"} AS status`,
    selectExpr(cols, 'criado_em'),
    selectExpr(cols, 'atualizado_em'),
    `${cols.has('ultimo_acesso_em') ? 'ultimo_acesso_em' : 'NULL::timestamptz'} AS ultimo_acesso_em`,
    `${cols.has('ultimo_acesso_em') ? "CASE WHEN ultimo_acesso_em IS NOT NULL AND ultimo_acesso_em > (CURRENT_TIMESTAMP - INTERVAL '2 minutes') THEN TRUE ELSE FALSE END" : 'FALSE'} AS online`
  ]

  if (withPassword) {
    selectParts.push(selectExpr(cols, 'senha_hash'))
  }

  const query = `SELECT ${selectParts.join(', ')} FROM usuarios WHERE id = $1 LIMIT 1`
  const rows = await sql.query(query, [userId])
  const user = rows?.[0] || null
  if (user?.perfil) user.perfil = normalizeRole(user.perfil)
  return user
}

function getAuthenticatedUserId(req, url = null) {
  const headerId = getHeader(req?.headers, 'x-user-id') || getHeader(req?.headers, 'X-User-Id')
  const queryId = url?.searchParams?.get?.('user_id') || null
  return Number(headerId || queryId || 0)
}

async function requireAuthenticatedUser(req, options = {}) {
  const { allowQuery = false } = options
  const url = allowQuery ? new URL(req.url) : null
  const userId = getAuthenticatedUserId(req, url)
  if (!userId) {
    return { error: json({ erro: 'Usuário não autenticado.' }, 401) }
  }

  const user = await getUserById(userId)
  if (!user) {
    return { error: json({ erro: 'Usuário não encontrado.' }, 404) }
  }

  if (user.status && user.status !== 'ativo') {
    return { error: json({ erro: 'Usuário inativo.' }, 403) }
  }

  return { user }
}

async function ensureSupportTables() {
  await sql`CREATE TABLE IF NOT EXISTS contribuicoes_usuarios (
    usuario_id BIGINT PRIMARY KEY,
    total_submissoes INTEGER NOT NULL DEFAULT 0,
    total_avaliacoes INTEGER NOT NULL DEFAULT 0,
    total_dossies INTEGER NOT NULL DEFAULT 0,
    total_decisoes_editoriais INTEGER NOT NULL DEFAULT 0,
    observacoes TEXT,
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`

  await sql`CREATE TABLE IF NOT EXISTS mensagens_internas (
    id BIGSERIAL PRIMARY KEY,
    remetente_id BIGINT NOT NULL,
    destinatario_id BIGINT NOT NULL,
    mensagem TEXT NOT NULL,
    anexo_url TEXT,
    anexo_nome TEXT,
    anexo_mime TEXT,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`

  await sql`CREATE TABLE IF NOT EXISTS arquivos_publicacao (
    id BIGSERIAL PRIMARY KEY,
    usuario_id BIGINT,
    submissao_id BIGINT,
    categoria TEXT NOT NULL,
    nome_original TEXT,
    mime_type TEXT,
    tamanho_bytes BIGINT,
    blob_key TEXT NOT NULL,
    blob_store TEXT NOT NULL DEFAULT 'revista-arquivos',
    url_acesso TEXT NOT NULL,
    publico BOOLEAN NOT NULL DEFAULT FALSE,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`

  await sql`CREATE TABLE IF NOT EXISTS certificados_privados (
    id BIGSERIAL PRIMARY KEY,
    usuario_id BIGINT NOT NULL,
    enviado_por_usuario_id BIGINT,
    titulo TEXT NOT NULL,
    descricao TEXT,
    tipo TEXT NOT NULL DEFAULT 'evento',
    categoria TEXT NOT NULL DEFAULT 'certificado_evento',
    blob_key TEXT NOT NULL,
    nome_arquivo TEXT NOT NULL,
    mime_type TEXT NOT NULL DEFAULT 'application/pdf',
    tamanho_bytes BIGINT,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`

  await sql`CREATE INDEX IF NOT EXISTS idx_certificados_privados_usuario_id ON certificados_privados (usuario_id)`
  await sql`CREATE INDEX IF NOT EXISTS idx_mensagens_internas_conversa ON mensagens_internas (remetente_id, destinatario_id, criado_em DESC)`
  await sql`CREATE INDEX IF NOT EXISTS idx_arquivos_publicacao_submissao_id ON arquivos_publicacao (submissao_id)`
}

module.exports = {
  sql,
  json,
  parseJson,
  getHeader,
  getAuthenticatedUserId,
  requireAuthenticatedUser,
  normalizeRole,
  canAccess,
  getTableColumns,
  tableExists,
  getUserById,
  ensureSupportTables
}
