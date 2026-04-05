exports.handler = async (event) => {
  const { code } = event.queryStringParameters || {};

  if (!code) {
    const clientId = process.env.ORCID_CLIENT_ID;
    const redirectUri = process.env.ORCID_REDIRECT_URI;
    const scope = '/authenticate';
    const authUrl = `https://orcid.org/oauth/authorize?client_id=${clientId}&response_type=code&scope=${scope}&redirect_uri=${redirectUri}`;
    return { statusCode: 302, headers: { Location: authUrl } };
  }

  // Trocar código por token
  const tokenRes = await fetch('https://orcid.org/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.ORCID_CLIENT_ID,
      client_secret: process.env.ORCID_CLIENT_SECRET,
      redirect_uri: process.env.ORCID_REDIRECT_URI,
      grant_type: 'authorization_code'
    })
  });
  const tokenData = await tokenRes.json();
  if (!tokenRes.ok) throw new Error(tokenData.error);

  // Obter dados do usuário (ORCID retorna apenas o ORCID iD e nome)
  const userRes = await fetch('https://orcid.org/oauth/userinfo', {
    headers: { Authorization: `Bearer ${tokenData.access_token}` }
  });
  const userData = await userRes.json();

  const userInfo = {
    nome: userData.name || '',
    orcid: userData.sub || '', // ORCID iD
    email: userData.email || ''
  };
  const params = new URLSearchParams({
    provider: 'orcid',
    nome: userInfo.nome,
    email: userInfo.email,
    orcid: userInfo.orcid
  });
  return {
    statusCode: 302,
    headers: { Location: `/cadastro-login/cadastro.html?${params.toString()}` }
  };
};