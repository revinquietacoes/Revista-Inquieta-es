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
const { sql, json, normalizeRole } = require('./_db')
const { wrapHttp } = require('./_netlify')

const main = async (req) => {
  try {
    if (req.method !== 'POST') {
      return json({ erro: 'Método não permitido.' }, 405)
    }

    const { email, senha } = await req.json().catch(() => ({}))

    if (!email || !senha) {
      return json({ erro: 'Informe e-mail e senha.' }, 400)
    }

    const rows = await sql`
      SELECT *
      FROM usuarios
      WHERE email = ${email}
      LIMIT 1
    `

    if (!rows.length) {
      return json({ erro: 'Usuário não encontrado.' }, 404)
    }

    const usuario = rows[0]
    usuario.perfil = normalizeRole(usuario.perfil)

    if (usuario.status === 'pendente') {
      return json({ erro: 'Cadastro pendente de autorização da editoria-chefe.' }, 403)
    }

    if (usuario.status && usuario.status !== 'ativo') {
      return json({ erro: 'Usuário inativo.' }, 403)
    }

    const senhaValida = await bcrypt.compare(senha, usuario.senha_hash || '')

    if (!senhaValida) {
      return json({ erro: 'Senha inválida.' }, 401)
    }

    return json({ sucesso: true, usuario })
  } catch (erro) {
    return json({ erro: 'Erro ao realizar login.', detalhe: erro.message }, 500)
  }
}

exports.handler = wrapHttp(main)