// painel-base.js - Versão definitiva
(function () {
  // Evita recriar se já existir
  if (window.AppPanel) return;

  // Helper para extrair headers de autenticação
  function authHeaders() {
    const token = localStorage.getItem('auth_token');
    const headers = {
      'Content-Type': 'application/json'
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    const user = JSON.parse(localStorage.getItem('usuario_logado') || '{}');
    if (user.id) {
      headers['X-User-Id'] = user.id;
    }
    return headers;
  }

  // Função genérica para chamar data.js (consultas)
  async function apiData(action, extra = {}) {
    const user = JSON.parse(localStorage.getItem('usuario_logado') || '{}');
    const payload = { action, userId: user.id || null, ...extra };
    const resp = await fetch('/.netlify/functions/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(err || 'Erro na requisição');
    }
    return resp.json();
  }

  // Função genérica para chamar action.js (modificações)
  async function apiAction(action, extra = {}) {
    const user = JSON.parse(localStorage.getItem('usuario_logado') || '{}');
    const payload = { action, userId: user.id || null, ...extra };
    const resp = await fetch('/.netlify/functions/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(err || 'Erro na ação');
    }
    return resp.json();
  }

  // Obtém usuário atual do localStorage
  function currentUser() {
    const u = localStorage.getItem('usuario_logado');
    return u ? JSON.parse(u) : null;
  }

  // Headers para uploads (FormData) – sem Content-Type
  function currentUserHeaders() {
    const user = currentUser();
    const headers = {};
    if (user && user.id) {
      headers['X-User-Id'] = user.id;
    }
    return headers;
  }

  // Verifica permissão e redireciona se não tiver
  function requireRole(allowedRoles) {
    const user = currentUser();
    if (!user || !allowedRoles.includes(user.perfil)) {
      window.location.href = 'login.html';
      return null;
    }
    return user;
  }

  function formatRole(role) {
    const roles = {
      autor: 'Autor(a)',
      parecerista: 'Parecerista',
      editor_adjunto: 'Editor(a) Adjunto(a)',
      editor_chefe: 'Editor(a)-chefe'
    };
    return roles[role] || role;
  }

  function formatPresenceShort(user) {
    return user.online ? '🟢 Online' : '⚫ Offline';
  }

  function formatLastSeen(date) {
    if (!date) return 'Nunca';
    const d = new Date(date);
    return d.toLocaleString('pt-BR');
  }

  function userChipHtml(user, extraText = '') {
    const avatar = user.foto_perfil_url || '../assets/avatares/avatar-padrao.png';
    return `<div class="user-chip" style="display: flex; align-items: center; gap: 8px;">
      <img src="${avatar}" style="width: 32px; height: 32px; border-radius: 50%; object-fit: cover;">
      <div><strong>${escapeHtml(user.nome)}</strong><br><small>${escapeHtml(extraText)}</small></div>
    </div>`;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, m => m === '&' ? '&amp;' : m === '<' ? '&lt;' : '&gt;');
  }

  // ========== FUNÇÕES DE NOTIFICAÇÃO ==========
  async function buscarNotificacoes(apenasNaoLidas = false, limit = 20, offset = 0) {
    return await apiData('notificacoes', { apenasNaoLidas, limit, offset });
  }

  async function marcarNotificacaoLida(id) {
    await apiAction('marcar_notificacao_lida', { notificacaoId: id });
  }

  async function marcarTodasLidas() {
    await apiAction('marcar_todas_lidas', {});
  }

  async function atualizarContadorNotificacoes() {
    const data = await buscarNotificacoes(true, 1);
    const badge = document.getElementById('notificacao-badge');
    if (badge) {
      const count = data.naoLidas || 0;
      badge.textContent = count > 0 ? count : '';
      badge.style.display = count > 0 ? 'inline-flex' : 'none';
    }
  }

  function iniciarPollingNotificacoes() {
    setInterval(() => atualizarContadorNotificacoes(), 30000);
  }

  async function mostrarDropdownNotificacoes(event) {
    event.stopPropagation();
    const dropdown = document.getElementById('notificacoes-dropdown');
    if (!dropdown) return;
    if (dropdown.style.display === 'block') {
      dropdown.style.display = 'none';
      return;
    }
    const data = await buscarNotificacoes(false, 5);
    const lista = data.notificacoes || [];
    const naoLidas = data.naoLidas || 0;
    dropdown.innerHTML = `
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
    dropdown.style.display = 'block';
    // Eventos
    document.querySelectorAll('.notificacao-item').forEach(el => {
      el.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = el.dataset.id;
        if (el.dataset.lida === 'false') {
          await marcarNotificacaoLida(id);
          el.style.background = '';
          el.dataset.lida = 'true';
          atualizarContadorNotificacoes();
        }
      });
    });
    const btnMarcar = document.getElementById('marcar-todas-lidas');
    if (btnMarcar) {
      btnMarcar.addEventListener('click', async (e) => {
        e.stopPropagation();
        await marcarTodasLidas();
        atualizarContadorNotificacoes();
        mostrarDropdownNotificacoes(event);
      });
    }
  }

  // ========== FUNÇÃO PARA ATUALIZAR AVATARES ==========
  function atualizarAvatares() {
    const user = currentUser();
    if (!user) return;
    const avatarUrl = user.foto_perfil_url || '../assets/avatares/avatar-padrao.png';
    document.querySelectorAll('[data-avatar-user]').forEach(img => {
      img.src = avatarUrl;
    });
  }

  // Expor globalmente
  window.AppPanel = {
    apiData,
    apiAction,
    currentUser,
    currentUserHeaders,
    requireRole,
    formatRole,
    formatPresenceShort,
    formatLastSeen,
    userChipHtml,
    escapeHtml,
    buscarNotificacoes,
    marcarNotificacaoLida,
    marcarTodasLidas,
    atualizarContadorNotificacoes,
    iniciarPollingNotificacoes,
    mostrarDropdownNotificacoes,
    atualizarAvatares   // <-- agora incluído
  };
})();