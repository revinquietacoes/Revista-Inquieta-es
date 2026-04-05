exports.handler = async (event) => {
  const { code } = event.queryStringParameters || {};

  if (!code) {
    // Inicia o fluxo OAuth: redireciona para Google
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI;
    const scope = 'openid email profile';
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}`;
    return { statusCode: 302, headers: { Location: authUrl } };
  }

  // Trocar código por token
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: process.env.GOOGLE_REDIRECT_URI,
      grant_type: 'authorization_code'
    })
  });
  const tokenData = await tokenRes.json();
  if (!tokenRes.ok) throw new Error(tokenData.error);

  // Obter informações do usuário
  const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${tokenData.access_token}` }
  });
  const userData = await userRes.json();

  // Montar dados para o cadastro
  const userInfo = {
    nome: userData.name || '',
    email: userData.email || '',
    foto_perfil_url: userData.picture || '',
    // Google não fornece telefone, instituição, etc.
  };
  // Redireciona para cadastro com dados via query string
  const params = new URLSearchParams({
    provider: 'google',
    nome: userInfo.nome,
    email: userInfo.email,
    foto: userInfo.foto_perfil_url || ''
  });
  return {
    statusCode: 302,
    headers: { Location: `/cadastro-login/cadastro.html?${params.toString()}` }
  };
};