// Verificar reCAPTCHA
const { recaptcha } = body;
if (!recaptcha) return json({ erro: 'Confirme que você não é um robô.' }, 400);
const recaptchaSecret = process.env.RECAPTCHA_SECRET_KEY;
const recaptchaRes = await fetch('https://www.google.com/recaptcha/api/siteverify', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: `secret=${recaptchaSecret}&response=${recaptcha}`
});
const recaptchaData = await recaptchaRes.json();
if (!recaptchaData.success) return json({ erro: 'Falha na verificação do captcha.' }, 400);
const bcrypt = require('bcryptjs')
const { sql, json, getTableColumns, normalizeRole } = require('./_db')
const { wrapHttp } = require('./_netlify')

const main = async (req) => {
  try {
    if (req.method !== 'POST') return json({ erro: 'Método não permitido.' }, 405)

    const body = await req.json().catch(() => ({}))
    const {
      nome, email, senha, perfil, instituicao, orcid, lattes,
      origem, telefone, foto_perfil_url, consentimento_foto_publica,
      receber_noticias_email
    } = body

    if (!nome || !email || !senha || !perfil) return json({ erro: 'Preencha nome, e-mail, senha e perfil.' }, 400)

    const perfilNormalizado = normalizeRole(perfil)
    const perfisPermitidos = ['autor', 'parecerista', 'editor_adjunto']
    if (!perfisPermitidos.includes(perfilNormalizado)) return json({ erro: 'Perfil inválido.' }, 400)

    const existente = await sql`SELECT id FROM usuarios WHERE email = ${email} LIMIT 1`
    if (existente.length > 0) return json({ erro: 'Já existe um usuário com este e-mail.' }, 409)

    const senhaHash = await bcrypt.hash(senha, 10)
    const statusInicial = perfilNormalizado === 'autor' ? 'ativo' : 'pendente'
    const cols = await getTableColumns('usuarios')

    const campos = ['nome', 'email', 'senha_hash', 'perfil']
    const valores = [nome, email, senhaHash, perfilNormalizado]

    if (cols.has('instituicao')) { campos.push('instituicao'); valores.push(instituicao || null) }
    if (cols.has('orcid')) { campos.push('orcid'); valores.push(orcid || null) }
    if (cols.has('lattes')) { campos.push('lattes'); valores.push(lattes || null) }
    if (cols.has('origem')) { campos.push('origem'); valores.push(origem || null) }
    if (cols.has('telefone')) { campos.push('telefone'); valores.push(telefone || null) }
    if (cols.has('foto_perfil_url')) { campos.push('foto_perfil_url'); valores.push(foto_perfil_url || 'assets/avatares/avatar-padrao.png') }
    if (cols.has('foto_perfil_aprovada')) { campos.push('foto_perfil_aprovada'); valores.push(false) }
    if (cols.has('consentimento_foto_publica')) { campos.push('consentimento_foto_publica'); valores.push(Boolean(consentimento_foto_publica)) }
    if (cols.has('receber_noticias_email')) { campos.push('receber_noticias_email'); valores.push(Boolean(receber_noticias_email)) }
    if (cols.has('status')) { campos.push('status'); valores.push(statusInicial) }

    const placeholders = valores.map((_, i) => `$${i + 1}`).join(', ')
    const returning = `id, nome, email, perfil, ${cols.has('status') ? 'status' : "'ativo'::text AS status"}`
    const query = `INSERT INTO usuarios (${campos.join(', ')}) VALUES (${placeholders}) RETURNING ${returning}`
    const inserted = await sql.query(query, valores)

    return json({
      sucesso: true,
      usuario: inserted[0],
      mensagem: statusInicial === 'ativo'
        ? 'Cadastro realizado com sucesso. Você já pode acessar o sistema.'
        : 'Cadastro recebido. O acesso é liberado após autorização da editoria-chefe.'
    })
  } catch (erro) {
    return json({ erro: 'Erro ao cadastrar usuário.', detalhe: erro.message }, 500)
  }
}

exports.handler = wrapHttp(main)
