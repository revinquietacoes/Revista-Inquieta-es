exports.handler = async (event) => {
  const { code } = event.queryStringParameters || {};

  if (!code) {
    const clientId = process.env.FACEBOOK_CLIENT_ID;
    const redirectUri = process.env.FACEBOOK_REDIRECT_URI;
    const authUrl = `https://www.facebook.com/v18.0/dialog/oauth?client_id=${clientId}&redirect_uri=${redirectUri}&scope=email,public_profile`;
    return { statusCode: 302, headers: { Location: authUrl } };
  }

  // Trocar código por token
  const tokenRes = await fetch(`https://graph.facebook.com/v18.0/oauth/access_token?client_id=${process.env.FACEBOOK_CLIENT_ID}&redirect_uri=${process.env.FACEBOOK_REDIRECT_URI}&client_secret=${process.env.FACEBOOK_CLIENT_SECRET}&code=${code}`);
  const tokenData = await tokenRes.json();
  if (!tokenRes.ok) throw new Error(tokenData.error);

  // Obter dados do usuário
  const userRes = await fetch(`https://graph.facebook.com/me?fields=id,name,email,picture&access_token=${tokenData.access_token}`);
  const userData = await userRes.json();

  const userInfo = {
    nome: userData.name || '',
    email: userData.email || '',
    foto_perfil_url: userData.picture?.data?.url || ''
  };
  const params = new URLSearchParams({
    provider: 'facebook',
    nome: userInfo.nome,
    email: userInfo.email,
    foto: userInfo.foto_perfil_url
  });
  return {
    statusCode: 302,
    headers: { Location: `/cadastro-login/cadastro.html?${params.toString()}` }
  };
};