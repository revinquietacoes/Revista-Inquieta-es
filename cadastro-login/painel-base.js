const API_DATA = '/.netlify/functions/data';
const API_ACTION = '/.netlify/functions/action';

function getLoggedUser() { return JSON.parse(localStorage.getItem('usuario_logado') || 'null'); }
function setLoggedUser(user){ localStorage.setItem('usuario_logado', JSON.stringify(user)); }
function resolveAsset(path) {
  if (!path) return '../assets/avatares/avatar-padrao.png';
  if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('/.netlify/functions/arquivo')) return path;
  if (path.startsWith('../')) return path;
  return '../' + path.replace(/^\/+/, '');
}
function photoAllowed(user){ return !!(user?.foto_perfil_url && user?.foto_perfil_aprovada && user?.consentimento_foto_publica); }
function applyUserIdentity(user) {
  const avatarEls = document.querySelectorAll('[data-avatar-user]');
  const nameEls = document.querySelectorAll('[data-user-name]');
  const roleEls = document.querySelectorAll('[data-user-role]');
  avatarEls.forEach((el) => {
    el.src = photoAllowed(user) ? resolveAsset(user.foto_perfil_url) : '../assets/avatares/avatar-padrao.png';
    el.onerror = () => { el.src = '../assets/avatares/avatar-padrao.png'; };
  });
  nameEls.forEach((el) => { el.textContent = user?.nome || 'Usuário(a)'; });
  roleEls.forEach((el) => { el.textContent = formatRole(user?.perfil); });
}
function userChipHtml(user, subtitle=''){
  const img = photoAllowed(user) ? resolveAsset(user.foto_perfil_url) : '../assets/avatares/avatar-padrao.png';
  return `<div class="user-row"><img src="${img}" alt="Foto de perfil" onerror="this.src='../assets/avatares/avatar-padrao.png'"><div class="meta-grow"><div class="item-title">${user.nome||'Usuário(a)'}</div><div class="item-meta">${subtitle}</div></div></div>`;
}
function formatRole(role) {
  return { autor:'Autor(a)', parecerista:'Parecerista', editor_adjunto:'Editor(a) adjunto(a)', editor_chefe:'Editor(a)-chefe' }[role] || 'Usuário(a)';
}
function currentUserHeaders(){
  const user = getLoggedUser();
  return user?.id ? { 'x-user-id': String(user.id) } : {};
}
async function apiData(action, extra = {}) {
  const user = getLoggedUser();
  const res = await fetch(API_DATA, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ action, userId:user?.id, ...extra }) });
  const data = await res.json(); if (!res.ok) throw new Error(data.erro || data.detalhe || 'Erro ao carregar dados.'); return data;
}
async function apiAction(action, extra = {}) {
  const user = getLoggedUser();
  const res = await fetch(API_ACTION, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ action, userId:user?.id, ...extra }) });
  const data = await res.json(); if (!res.ok) throw new Error(data.erro || data.detalhe || 'Erro ao executar ação.');
  if (data.usuario) setLoggedUser(data.usuario);
  return data;
}
function requireRole(allowed) {
  const user = getLoggedUser();
  if (!user) { window.location.href='login.html'; return null; }
  if (!allowed.includes(user.perfil)) {
    const redirects={autor:'painel-autor.html',parecerista:'painel-parecerista.html',editor_adjunto:'painel-editor.html',editor_chefe:'painel-editor-chefe.html'};
    window.location.href = redirects[user.perfil] || 'login.html'; return null;
  }
  applyUserIdentity(user); return user;
}
function footerHtml(){return `<div>Revista Inquietações — periódico científico em acesso aberto.</div><div>Organização editorial: Diego Vinícius Brito dos Santos • @iamthed1</div><div><a href="https://github.com/revinquietacoes/Revista-Inquieta-es/blob/main/CODE_OF_CONDUCT.md" target="_blank">Código de Conduta</a></div><div><a href="https://www.netlify.com" target="_blank" rel="noopener noreferrer">Este site é desenvolvido com apoio de Netlify</a></div>`;}
function bindLogout(){document.querySelectorAll('[data-action="logout"]').forEach(btn=>btn.addEventListener('click',()=>{localStorage.removeItem('usuario_logado');window.location.href='login.html';}));}
function injectCommonButtons(){
  const user=getLoggedUser(); if(!user) return; const row=document.querySelector('.topbar .actions-row'); if(!row) return;
  const links=[];
  links.push(['perfil.html','Perfil']);
  links.push(['certificados.html','Certificados']);
  if (user.perfil==='autor') links.push(['inscricoes-eventos.html','Inscrições']);
  if (['autor','parecerista','editor_adjunto','editor_chefe'].includes(user.perfil)) links.push(['chat-interno.html','Chat']);
  if (['editor_adjunto','editor_chefe'].includes(user.perfil)) links.push(['usuarios-online.html','Quem está online']);
  for(const [href,label] of links){ if(!row.querySelector(`[href="${href}"]`)){ const a=document.createElement('a'); a.className='btn btn-soft'; a.href=href; a.textContent=label; row.insertBefore(a,row.lastElementChild); } }
}
async function pingPresence(){ try{ await apiAction('presence_ping'); }catch(e){} }
document.addEventListener('DOMContentLoaded',()=>{ bindLogout(); injectCommonButtons(); const foot=document.querySelector('.page-footer'); if(foot) foot.innerHTML=footerHtml(); pingPresence(); setInterval(pingPresence, 60000); });
window.AppPanel={getLoggedUser,setLoggedUser,apiData,apiAction,requireRole,applyUserIdentity,formatRole,resolveAsset,userChipHtml,photoAllowed,currentUserHeaders};
