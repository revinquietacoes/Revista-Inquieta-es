const API_DATA = '/.netlify/functions/data';
const API_ACTION = '/.netlify/functions/action';

function getLoggedUser() {
  return JSON.parse(localStorage.getItem('usuario_logado') || 'null');
}

function resolveAsset(path) {
  if (!path) return '../assets/avatares/avatar-padrao.png';
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  if (path.startsWith('../')) return path;
  return '../' + path.replace(/^\/+/, '');
}

function applyUserIdentity(user) {
  const avatarEls = document.querySelectorAll('[data-avatar-user]');
  const nameEls = document.querySelectorAll('[data-user-name]');
  const roleEls = document.querySelectorAll('[data-user-role]');
  avatarEls.forEach((el) => {
    const approved = user?.foto_perfil_aprovada && user?.consentimento_foto_publica;
    el.src = approved ? resolveAsset(user.foto_perfil_url) : '../assets/avatares/avatar-padrao.png';
    el.onerror = () => { el.src = '../assets/avatares/avatar-padrao.png'; };
  });
  nameEls.forEach((el) => { el.textContent = user?.nome || 'Usuário(a)'; });
  roleEls.forEach((el) => { el.textContent = formatRole(user?.perfil); });
}

function formatRole(role) {
  return {
    autor: 'Autor(a)',
    parecerista: 'Parecerista',
    editor_adjunto: 'Editor(a) adjunto(a)',
    editor_chefe: 'Editor(a)-chefe'
  }[role] || 'Usuário(a)';
}

async function apiData(action, extra = {}) {
  const user = getLoggedUser();
  const res = await fetch(API_DATA, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, userId: user?.id, ...extra })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.erro || data.detalhe || 'Erro ao carregar dados.');
  return data;
}

async function apiAction(action, extra = {}) {
  const user = getLoggedUser();
  const res = await fetch(API_ACTION, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, userId: user?.id, ...extra })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.erro || data.detalhe || 'Erro ao executar ação.');
  return data;
}

function requireRole(allowed) {
  const user = getLoggedUser();
  if (!user) {
    window.location.href = 'login.html';
    return null;
  }
  if (!allowed.includes(user.perfil)) {
    const redirects = {
      autor: 'painel-autor.html',
      parecerista: 'painel-parecerista.html',
      editor_adjunto: 'painel-editor.html',
      editor_chefe: 'painel-editor-chefe.html'
    };
    window.location.href = redirects[user.perfil] || 'login.html';
    return null;
  }
  applyUserIdentity(user);
  return user;
}

function bindLogout() {
  document.querySelectorAll('[data-action="logout"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      localStorage.removeItem('usuario_logado');
      window.location.href = 'login.html';
    });
  });
}

function footerHtml(){
  return `
    <div>Revista Inquietações — periódico científico em acesso aberto.</div>
    <div>Organização editorial: Diego Vinícius Brito dos Santos • @iamthed1</div>
    <div><a href="../CODE_OF_CONDUCT.md" target="_blank">Código de Conduta</a></div>
    <div>Este site é desenvolvido com apoio de <a href="https://www.netlify.com" target="_blank">Netlify</a></div>`;
}

document.addEventListener('DOMContentLoaded', () => {
  bindLogout();
  const foot = document.querySelector('.page-footer');
  if (foot) foot.innerHTML = footerHtml();
});

window.AppPanel = { getLoggedUser, apiData, apiAction, requireRole, applyUserIdentity, formatRole, resolveAsset };
