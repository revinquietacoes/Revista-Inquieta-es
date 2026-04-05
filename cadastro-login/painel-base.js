const API_DATA = '/.netlify/functions/data';
const API_ACTION = '/.netlify/functions/action';

// Funções globais de notificação (adicione ao objeto AppPanel)
AppPanel.buscarNotificacoes = async (apenasNaoLidas = false, limit = 20, offset = 0) => {
  const data = await AppPanel.apiData('notificacoes', { apenasNaoLidas, limit, offset });
  return data;
};

AppPanel.marcarNotificacaoLida = async (id) => {
  await AppPanel.apiAction('marcar_notificacao_lida', { notificacaoId: id });
};

AppPanel.marcarTodasLidas = async () => {
  await AppPanel.apiAction('marcar_todas_lidas', {});
};

// Atualizar contador no ícone (chamar a cada 30s)
let contadorInterval = null;
AppPanel.iniciarPollingNotificacoes = () => {
  if (contadorInterval) clearInterval(contadorInterval);
  contadorInterval = setInterval(async () => {
    const data = await AppPanel.buscarNotificacoes(true, 1);
    const badge = document.getElementById('notificacao-badge');
    if (badge) {
      const count = data.naoLidas || 0;
      badge.textContent = count > 0 ? count : '';
      badge.style.display = count > 0 ? 'inline-flex' : 'none';
    }
  }, 30000);
};

// Chamar após o login (no painel-base.js, quando usuário é carregado)
AppPanel.atualizarContadorNotificacoes = async () => {
  const data = await AppPanel.buscarNotificacoes(true, 1);
  const badge = document.getElementById('notificacao-badge');
  if (badge) {
    const count = data.naoLidas || 0;
    badge.textContent = count > 0 ? count : '';
    badge.style.display = count > 0 ? 'inline-flex' : 'none';
  }
};

// Função para abrir dropdown (simples)
AppPanel.mostrarDropdownNotificacoes = async (event) => {
  event.stopPropagation();
  const dropdown = document.getElementById('notificacoes-dropdown');
  if (!dropdown) return;
  if (dropdown.style.display === 'block') {
    dropdown.style.display = 'none';
    return;
  }
  // Carregar últimas 5 notificações
  const data = await AppPanel.buscarNotificacoes(false, 5);
  const lista = data.notificacoes || [];
  const naoLidas = data.naoLidas || 0;
  const html = `
    <div style="width: 320px; max-height: 400px; overflow-y: auto;">
      <div style="padding: 8px 12px; border-bottom: 1px solid #ccc; display: flex; justify-content: space-between;">
        <strong>Notificações</strong>
        ${naoLidas > 0 ? `<button id="marcar-todas-lidas" style="background:none; border:none; color:#007bff; cursor:pointer;">Marcar todas como lidas</button>` : ''}
      </div>
      ${lista.length === 0 ? '<div style="padding: 16px; text-align: center;">Nenhuma notificação</div>' : lista.map(n => `
        <div class="notificacao-item" data-id="${n.id}" data-lida="${n.lida}" style="padding: 10px 12px; border-bottom: 1px solid #eee; ${!n.lida ? 'background: #f0f7ff;' : ''} cursor: pointer;">
          <div><strong>${escapeHtml(n.titulo)}</strong></div>
          <div style="font-size: 0.85rem; color: #555;">${escapeHtml(n.mensagem.substring(0, 80))}${n.mensagem.length > 80 ? '…' : ''}</div>
          <div style="font-size: 0.7rem; color: #999;">${new Date(n.criado_em).toLocaleString('pt-BR')}</div>
        </div>
      `).join('')}
      <div style="padding: 8px; text-align: center; border-top: 1px solid #eee;">
        <a href="notificacoes.html" style="color: #007bff;">Ver todas</a>
      </div>
    </div>
  `;
  dropdown.innerHTML = html;
  dropdown.style.display = 'block';
  // Eventos para marcar como lida ao clicar no item
  document.querySelectorAll('.notificacao-item').forEach(el => {
    el.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = el.dataset.id;
      if (!el.dataset.lida === 'true') {
        await AppPanel.marcarNotificacaoLida(id);
        el.style.background = '';
        el.dataset.lida = 'true';
        AppPanel.atualizarContadorNotificacoes();
      }
      const link = el.querySelector('a')?.href || (() => { })();
      if (link) window.location.href = link;
    });
  });
  const btnMarcarTodas = document.getElementById('marcar-todas-lidas');
  if (btnMarcarTodas) {
    btnMarcarTodas.addEventListener('click', async (e) => {
      e.stopPropagation();
      await AppPanel.marcarTodasLidas();
      AppPanel.atualizarContadorNotificacoes();
      AppPanel.mostrarDropdownNotificacoes(event); // recarrega
    });
  }
};

// Fechar dropdown ao clicar fora
document.addEventListener('click', () => {
  const dropdown = document.getElementById('notificacoes-dropdown');
  if (dropdown) dropdown.style.display = 'none';
});
function getLoggedUser() { return JSON.parse(localStorage.getItem('usuario_logado') || 'null'); }
function setLoggedUser(user) { localStorage.setItem('usuario_logado', JSON.stringify(user)); }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])); }
function resolveAsset(path) {
  if (!path) return '../assets/avatares/avatar-padrao.png';
  if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('/.netlify/functions/arquivo')) return path;
  if (path.startsWith('../')) return path;
  return '../' + path.replace(/^\/+/, '');
}
function photoAllowed(user) { return !!(user?.foto_perfil_url && user?.foto_perfil_aprovada && user?.consentimento_foto_publica); }
function formatRole(role) {
  return { autor: 'Autor(a)', parecerista: 'Parecerista', editor_adjunto: 'Editor(a) adjunto(a)', editor_chefe: 'Editor(a)-chefe' }[role] || 'Usuário(a)';
}
function formatPresenceShort(user) {
  if (typeof user?.online !== 'boolean') return '';
  return user.online ? 'Online agora' : 'Offline';
}
function formatLastSeen(value) {
  if (!value) return 'sem atividade recente';
  try { return new Date(value).toLocaleString('pt-BR'); } catch (e) { return 'sem atividade recente'; }
}
function presenceBadgeHtml(user) {
  if (typeof user?.online !== 'boolean') return '';
  const cls = user.online ? 'presence-pill is-online' : 'presence-pill is-offline';
  const label = user.online ? 'Online' : 'Offline';
  const title = user.online ? 'Usuário online agora' : `Última atividade: ${formatLastSeen(user.ultimo_acesso_em)}`;
  return `<span class="${cls}" title="${escapeHtml(title)}"><span class="presence-dot"></span>${label}</span>`;
}
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
function userChipHtml(user, subtitle = '') {
  const img = photoAllowed(user) ? resolveAsset(user.foto_perfil_url) : '../assets/avatares/avatar-padrao.png';
  const badge = presenceBadgeHtml(user);
  const subtitleHtml = subtitle ? `<div class="item-meta">${escapeHtml(subtitle)}</div>` : '';
  return `<div class="user-row"><img src="${escapeHtml(img)}" alt="Foto de perfil" onerror="this.src='../assets/avatares/avatar-padrao.png'"><div class="meta-grow"><div class="user-row-top"><div class="item-title">${escapeHtml(user.nome || 'Usuário(a)')}</div>${badge}</div>${subtitleHtml}</div></div>`;
}
function currentUserHeaders() {
  const user = getLoggedUser();
  return user?.id ? { 'x-user-id': String(user.id) } : {};
}
async function apiData(action, extra = {}) {
  const user = getLoggedUser();
  const res = await fetch(API_DATA, { method: 'POST', headers: { 'Content-Type': 'application/json', ...currentUserHeaders() }, body: JSON.stringify({ action, userId: user?.id, ...extra }) });
  const data = await res.json(); if (!res.ok) throw new Error(data.detalhe || data.erro || data.error || 'Erro ao carregar dados.'); return data;
}
async function apiAction(action, extra = {}) {
  const user = getLoggedUser();
  const res = await fetch(API_ACTION, { method: 'POST', headers: { 'Content-Type': 'application/json', ...currentUserHeaders() }, body: JSON.stringify({ action, userId: user?.id, ...extra }) });
  const data = await res.json(); if (!res.ok) throw new Error(data.detalhe || data.erro || data.error || 'Erro ao executar ação.');
  if (data.usuario) setLoggedUser(data.usuario);
  return data;
}
async function authedFormFetch(url, formData, init = {}) {
  const res = await fetch(url, {
    method: init.method || 'POST',
    headers: { ...currentUserHeaders(), ...(init.headers || {}) },
    body: formData
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detalhe || data.erro || data.error || 'Erro ao enviar dados.');
  return data;
}
function requireRole(allowed) {
  const user = getLoggedUser();
  if (!user) { window.location.href = 'login.html'; return null; }
  if (!allowed.includes(user.perfil)) {
    const redirects = { autor: 'painel-autor.html', parecerista: 'painel-parecerista.html', editor_adjunto: 'painel-editor.html', editor_chefe: 'painel-editor-chefe.html' };
    window.location.href = redirects[user.perfil] || 'login.html'; return null;
  }
  applyUserIdentity(user); return user;
}
function footerHtml() { return `<div>Revista Inquietações — periódico científico em acesso aberto.</div><div>Organização editorial: Diego Vinícius Brito dos Santos • @iamthed1</div><div><a href="https://github.com/revinquietacoes/Revista-Inquieta-es/blob/main/CODE_OF_CONDUCT.md" target="_blank">Código de Conduta</a></div><div><a href="https://www.netlify.com" target="_blank" rel="noopener noreferrer">Este site é desenvolvido com apoio de Netlify</a></div>`; }
async function notifyPresenceLeave() {
  const user = getLoggedUser();
  if (!user?.id) return;
  const body = JSON.stringify({ action: 'presence_leave', userId: user.id });
  try {
    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: 'application/json' });
      navigator.sendBeacon(API_ACTION, blob);
      return;
    }
  } catch (e) { }
  try {
    await fetch(API_ACTION, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true });
  } catch (e) { }
}
function bindLogout() { document.querySelectorAll('[data-action="logout"]').forEach(btn => btn.addEventListener('click', async () => { await notifyPresenceLeave(); localStorage.removeItem('usuario_logado'); window.location.href = 'login.html'; })); }
function injectCommonButtons() {
  const user = getLoggedUser(); if (!user) return; const row = document.querySelector('.topbar .actions-row'); if (!row) return;
  const links = [];
  links.push(['perfil.html', 'Perfil']);
  links.push(['certificados.html', 'Certificados']);
  if (user.perfil === 'autor') links.push(['inscricoes-eventos.html', 'Inscrições']);
  if (['autor', 'parecerista', 'editor_adjunto'].includes(user.perfil)) links.push(['chat-interno.html', 'Chat']);
  if (user.perfil === 'editor_chefe') links.push(['editor-chefe-chat.html', 'Chat']);
  if (['editor_adjunto', 'editor_chefe'].includes(user.perfil)) links.push(['usuarios-online.html', 'Quem está online']);
  for (const [href, label] of links) { if (!row.querySelector(`[href="${href}"]`)) { const a = document.createElement('a'); a.className = 'btn btn-soft'; a.href = href; a.textContent = label; row.insertBefore(a, row.lastElementChild); } }
}
async function pingPresence() { try { await apiAction('presence_ping'); } catch (e) { } }
document.addEventListener('DOMContentLoaded', () => { bindLogout(); injectCommonButtons(); const foot = document.querySelector('.page-footer'); if (foot) foot.innerHTML = footerHtml(); pingPresence(); setInterval(pingPresence, 30000); window.addEventListener('pagehide', () => { notifyPresenceLeave(); }); });
window.AppPanel = { getLoggedUser, setLoggedUser, apiData, apiAction, authedFormFetch, requireRole, applyUserIdentity, formatRole, resolveAsset, userChipHtml, photoAllowed, currentUserHeaders, escapeHtml, notifyPresenceLeave, presenceBadgeHtml, formatPresenceShort, formatLastSeen };
