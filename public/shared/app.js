/* Mills Seminovos — utilitários compartilhados do front-end (ES module, sem dependências). */

// ---------- HTML seguro ----------
class Safe { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Safe(String(s));
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);
function val(v) {
  if (v == null || v === false) return '';
  if (v instanceof Safe) return v.s;
  if (Array.isArray(v)) return v.map(val).join('');
  return esc(String(v));
}
/** Template que escapa automaticamente tudo o que for interpolado. */
export function h(strings, ...vals) {
  let out = '';
  strings.forEach((s, i) => { out += s; if (i < vals.length) out += val(vals[i]); });
  return new Safe(out);
}
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export function render(el, tpl) { el.innerHTML = String(tpl); return el; }

// ---------- Ícones (traço 24x24) ----------
const ICONS = {
  qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  chart: '<path d="M3 3v18h18"/><path d="M7 16v-4M12 16V8M17 16v-7"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  printer: '<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5M12 15V3"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.64-6.36L21 8"/><path d="M21 3v5h-5"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  x: '<path d="M18 6L6 18M6 6l12 12"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 3"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.18 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.1 9.9a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>',
  mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 6l-10 7L2 6"/>',
  building: '<rect x="4" y="2" width="16" height="20" rx="1"/><path d="M9 22v-4h6v4M8 6h.01M12 6h.01M16 6h.01M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14h.01"/>',
  camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  trash: '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
  back: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
  key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="M11.4 11.6L21 2M16 7l3 3M19 4l2 2"/>',
  flip: '<path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>',
  whatsapp: '<path d="M21 11.5a8.4 8.4 0 0 1-12.6 7.3L3 21l2.3-5.3A8.4 8.4 0 1 1 21 11.5z"/><path d="M9 9.5c.3 2 2 3.8 4 4.4l1.3-1.2 2 .8-.4 1.6c-3.3.4-7-3.2-6.7-6.6l1.6-.4.8 2z"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
};
export const icon = (name, cls = '') => raw(`<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`);

// ---------- API ----------
export class ApiError extends Error {
  constructor(message, status, data, network = false) { super(message); this.status = status; this.data = data; this.network = network; }
}
export async function api(method, url, body, opts = {}) {
  const { timeout = 15000, retries = method === 'GET' ? 2 : 0, headers = {}, redirectOnAuth = true } = opts;
  for (let attempt = 0; ; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeout);
    let res;
    try {
      res = await fetch(url, {
        method, signal: ctrl.signal, credentials: 'same-origin',
        headers: { 'X-Requested-With': 'mills', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      clearTimeout(t);
      if (attempt < retries) { await new Promise((r) => setTimeout(r, 600 * (attempt + 1))); continue; }
      throw new ApiError('Sem conexão com o servidor. Verifique a rede e tente novamente.', 0, null, true);
    }
    clearTimeout(t);
    let data = null;
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) { try { data = await res.json(); } catch { /* vazio */ } }
    if (res.ok) return data;
    if (res.status === 401 && data && data.code === 'auth' && redirectOnAuth) {
      location.href = `/entrar?volta=${encodeURIComponent(location.pathname + location.hash)}`;
      return new Promise(() => {});
    }
    if (res.status === 403 && data && data.code === 'must_change_password') window.dispatchEvent(new Event('must-change-password'));
    if (res.status >= 502 && attempt < retries) { await new Promise((r) => setTimeout(r, 800)); continue; }
    throw new ApiError((data && data.error) || `Erro ${res.status}.`, res.status, data, res.status >= 502);
  }
}

// ---------- Avisos ----------
let toastBox;
export function toast(msg, type = 'info', ms = 4200) {
  if (!toastBox) { toastBox = document.createElement('div'); toastBox.className = 'toasts'; toastBox.setAttribute('role', 'status'); toastBox.setAttribute('aria-live', 'polite'); document.body.append(toastBox); }
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = String(h`<span class="dot"></span><span>${msg}</span>`);
  toastBox.append(el);
  setTimeout(() => { el.style.transition = 'opacity .3s'; el.style.opacity = '0'; setTimeout(() => el.remove(), 320); }, ms);
}

// ---------- Modal e gaveta ----------
export function modal({ title, body, actions = [], onOpen, dismissable = true, wide = false }) {
  return new Promise((resolve) => {
    const ov = document.createElement('div');
    ov.className = 'overlay';
    ov.innerHTML = String(h`<div class="modal" role="dialog" aria-modal="true" aria-label="${title}" ${wide ? raw('style="width:min(760px,100%)"') : ''}>
      <header><h2>${title}</h2></header><div class="body">${body}</div>
      ${actions.length ? h`<footer>${actions.map((a, i) => h`<button class="btn ${a.cls || ''}" data-i="${i}" type="button">${a.label}</button>`)}</footer>` : ''}
    </div>`);
    const close = (v) => { document.removeEventListener('keydown', onKey); ov.remove(); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape' && dismissable) close(null); };
    document.addEventListener('keydown', onKey);
    ov.addEventListener('mousedown', (e) => { if (e.target === ov && dismissable) close(null); });
    ov.querySelectorAll('footer .btn').forEach((b) => b.addEventListener('click', async () => {
      const a = actions[Number(b.dataset.i)];
      if (a.onClick) {
        b.setAttribute('aria-busy', 'true');
        try { const r = await a.onClick(ov); if (r !== false) close(r === undefined ? a.value : r); } finally { b.removeAttribute('aria-busy'); }
      } else close(a.value);
    }));
    document.body.append(ov);
    const first = ov.querySelector('input, select, textarea, footer .btn-primary, footer .btn-acao, footer .btn');
    if (first) setTimeout(() => first.focus(), 30);
    if (onOpen) onOpen(ov, close);
  });
}
export const confirmDialog = (title, text, okLabel = 'Confirmar', danger = false) =>
  modal({ title, body: h`<p>${text}</p>`, actions: [{ label: 'Cancelar', value: false }, { label: okLabel, value: true, cls: danger ? 'btn-perigo' : 'btn-primary' }] });

export function drawer(build) {
  const wrap = document.createElement('div');
  wrap.className = 'drawer-wrap';
  wrap.innerHTML = '<aside class="drawer" role="dialog" aria-modal="true"></aside>';
  const panel = wrap.firstChild;
  const close = () => { document.removeEventListener('keydown', onKey); wrap.remove(); };
  const onKey = (e) => { if (e.key === 'Escape' && !document.querySelector('.overlay')) close(); };
  document.addEventListener('keydown', onKey);
  wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) close(); });
  document.body.append(wrap);
  build(panel, close);
  return close;
}

// ---------- Formatação ----------
let TZ = 'America/Sao_Paulo';
export const setTimezone = (tz) => { if (tz) TZ = tz; };
const dtf = (o) => new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, ...o });
export const fmtDateTime = (iso) => (iso ? dtf({ day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)).replace(',', '') : '—');
export const fmtTime = (iso) => (iso ? dtf({ hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) : '—');
export const fmtDate = (iso) => (iso ? dtf({ day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(iso)) : '—');
export function fmtRel(iso) {
  if (!iso) return '—';
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (s < 45) return 'agora';
  if (s < 3600) return `há ${Math.round(s / 60)} min`;
  if (s < 86400) return `há ${Math.round(s / 3600)} h`;
  return fmtDateTime(iso);
}
export const fmtInt = (n) => new Intl.NumberFormat('pt-BR').format(n || 0);
export const fmtPct = (x) => new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 1 }).format(x || 0);
export const debounce = (fn, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
export const statusChip = (st, label) => h`<span class="chip st-${st}">${label}</span>`;

// ---------- Tempo real ----------
/**
 * Tempo real com plano B: se nenhum evento chegar por 35 s (rede corporativa ou provedor que
 * segura a conexão), a tela passa a se atualizar por consulta a cada 15 s e tenta reconectar.
 */
export function live(handlers, onState = () => {}, { poll = null } = {}) {
  let es;
  let stopped = false;
  let lastAt = Date.now();
  let lastPoll = 0;
  let lastReconnect = Date.now();
  let state = null;
  const setState = (v) => { if (state !== v) { state = v; onState(v); } };
  const mark = () => { lastAt = Date.now(); setState(true); };
  const connect = () => {
    if (es) es.close();
    es = new EventSource('/api/stream');
    es.addEventListener('hello', mark);
    es.addEventListener('ping', mark);
    es.onerror = () => setState(false);
    for (const [ev, fn] of Object.entries(handlers)) es.addEventListener(ev, (e) => { mark(); try { fn(JSON.parse(e.data)); } catch (err) { console.error(err); } });
  };
  connect();
  setInterval(() => {
    if (stopped || document.visibilityState !== 'visible') return;
    const stale = Date.now() - lastAt > 35000;
    if (!stale) return;
    setState(false);
    if (poll && Date.now() - lastPoll > 15000) { lastPoll = Date.now(); try { poll(); } catch (e) { console.error(e); } }
    if (Date.now() - lastReconnect > 60000) { lastReconnect = Date.now(); connect(); }
  }, 5000);
  document.addEventListener('visibilitychange', () => {
    if (!stopped && document.visibilityState === 'visible' && es.readyState === 2) connect();
  });
  return { close() { stopped = true; es.close(); } };
}

// ---------- Fila local para falhas temporárias de rede ----------
/**
 * Guarda envios que falharam por rede e reenvia sozinho. Cada item tem um client_ref
 * (idempotência): o servidor nunca cria cadastro duplicado no reenvio.
 */
export function createOutbox(key, send, onChange = () => {}) {
  const read = () => { try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; } };
  const write = (arr) => { try { localStorage.setItem(key, JSON.stringify(arr)); } catch { /* armazenamento cheio */ } onChange(arr.length); };
  let busy = false;
  async function flush() {
    if (busy) return; busy = true;
    try {
      for (const item of read()) {
        let outcome;
        try { outcome = await send(item); } catch { outcome = 'retry'; }
        if (outcome === 'retry') break;
        write(read().filter((x) => x.client_ref !== item.client_ref));
      }
    } finally { busy = false; }
  }
  setInterval(flush, 5000);
  window.addEventListener('online', flush);
  setTimeout(() => onChange(read().length), 0);
  return {
    add(item) { write([...read().filter((x) => x.client_ref !== item.client_ref), { ...item, queued_at: new Date().toISOString() }]); },
    size: () => read().length,
    flush,
  };
}
export function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  return [...b].map((x, i) => ([4, 6, 8, 10].includes(i) ? '-' : '') + x.toString(16).padStart(2, '0')).join('');
}

// ---------- Sessão ----------
export async function boot({ roles = [], onDemo } = {}) {
  let me;
  try { me = await api('GET', '/api/auth/me', undefined, { retries: 3 }); } catch (e) {
    if (e.status === 401) { location.href = `/entrar?volta=${encodeURIComponent(location.pathname + location.hash)}`; return new Promise(() => {}); }
    document.body.innerHTML = String(h`<div class="empty" style="min-height:100vh"><strong>Servidor indisponível</strong><span>${e.message}</span><button class="btn btn-primary" id="boot-retry">Tentar novamente</button></div>`);
    $('#boot-retry').addEventListener('click', () => location.reload());
    throw e;
  }
  const user = me.user;
  if (me.mode !== 'producao') {
    const b = document.createElement('div');
    b.className = 'demo-banner';
    b.textContent = me.mode === 'demo' ? 'Ambiente de demonstração — dados fictícios, separados da inauguração real' : 'Ambiente de testes';
    document.body.prepend(b);
    if (onDemo) onDemo(me.mode);
  }
  if (roles.length && !roles.includes(user.role)) {
    const home = { admin: '/admin', vendedor: '/vendedor', recepcao: '/recepcao' }[user.role];
    document.body.insertAdjacentHTML('beforeend', String(h`<div class="empty" style="min-height:80vh"><strong>Esta área não faz parte do seu perfil</strong><span>Você entrou como ${user.name}.</span><a class="btn btn-primary" href="${home}">Ir para minha área</a></div>`));
    throw new Error('perfil');
  }
  if (user.must_change_password) await forcePasswordChange(user);
  window.addEventListener('must-change-password', () => forcePasswordChange(user));
  return user;
}

export async function forcePasswordChange(user) {
  await modal({
    title: 'Crie sua senha',
    dismissable: false,
    body: h`<p>Olá, ${user.name.split(' ')[0]}. Você entrou com uma senha temporária. Defina uma senha pessoal para continuar.</p>
      <div class="field"><label for="pw-cur">Senha temporária</label><input id="pw-cur" class="input" type="password" autocomplete="current-password"></div>
      <div class="field"><label for="pw-new">Nova senha</label><input id="pw-new" class="input" type="password" autocomplete="new-password"><span class="hint">Mínimo de 8 caracteres, com letras e números.</span></div>
      <div class="field"><label for="pw-rep">Repita a nova senha</label><input id="pw-rep" class="input" type="password" autocomplete="new-password"><span class="err" id="pw-err"></span></div>`,
    actions: [{
      label: 'Salvar senha', cls: 'btn-primary', onClick: async (ov) => {
        const cur = $('#pw-cur', ov).value, nw = $('#pw-new', ov).value, rep = $('#pw-rep', ov).value;
        const err = $('#pw-err', ov);
        if (nw !== rep) { err.textContent = 'As senhas não conferem.'; return false; }
        try { await api('POST', '/api/auth/change-password', { current: cur, next: nw }); toast('Senha criada.', 'ok'); return true; } catch (e) { err.textContent = e.message; return false; }
      },
    }],
  });
  user.must_change_password = false;
}

export async function logout() {
  try { await api('POST', '/api/auth/logout', {}); } finally { location.href = '/entrar'; }
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('Copiado.', 'ok', 1800); }
  catch {
    const ta = document.createElement('textarea'); ta.value = text; document.body.append(ta); ta.select();
    try { document.execCommand('copy'); toast('Copiado.', 'ok', 1800); } catch { toast('Não foi possível copiar.', 'erro'); }
    ta.remove();
  }
}
