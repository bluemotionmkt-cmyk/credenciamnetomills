import { h, $, raw, modal, uid, createOutbox } from '/shared/app.js';
import { createKeyboard } from '/totem/keyboard.js';

const V = window.MSValidation;
const KEY_STORE = 'ms_totem_station';
const CFG_STORE = 'ms_totem_config';
const FIELDS = ['name', 'phone', 'email', 'company'];
const REQUIRED = ['name', 'phone', 'email'];
const INACTIVITY_MS = 75_000;

// ---------- Vínculo da estação: o link traz a chave, que fica guardada no equipamento ----------
const url = new URL(location.href);
if (url.searchParams.get('estacao')) {
  localStorage.setItem(KEY_STORE, url.searchParams.get('estacao'));
  url.searchParams.delete('estacao');
  history.replaceState(null, '', url.pathname + (url.search || ''));
}
const stationKey = localStorage.getItem(KEY_STORE);
const kbParam = url.searchParams.get('teclado');
const useVirtualKeyboard = kbParam === '1' || (kbParam !== '0' && matchMedia('(pointer: coarse)').matches);

let cfg = null;
try { cfg = JSON.parse(localStorage.getItem(CFG_STORE) || 'null'); } catch { cfg = null; }
let serverOnline = true;

const show = (id) => {
  for (const s of ['welcome', 'form-screen', 'done', 'setup']) $(`#${s}`).hidden = s !== id;
};

async function publicFetch(method, path, body, timeout = 10000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(path, {
      method, signal: ctrl.signal,
      headers: { 'X-Requested-With': 'mills', 'X-Station-Key': stationKey || '', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => null);
    serverOnline = true;
    return { status: res.status, data };
  } catch {
    serverOnline = false;
    return { status: 0, data: null };
  } finally { clearTimeout(t); }
}

// ---------- Configuração da inauguração ----------
function applyConfig() {
  $('#w-event').textContent = [cfg.event_name, cfg.event_place].filter(Boolean).join(' — ');
  $('#w-kicker').textContent = cfg.welcome_kicker || 'Inauguração';
  $('#w-kicker').hidden = !cfg.welcome_kicker;
  $('#w-title').textContent = cfg.welcome_title;
  $('#w-highlight').textContent = cfg.welcome_highlight || '';
  $('#w-text').textContent = cfg.welcome_text;
  const items = (cfg.promo_items || []).filter(Boolean);
  $('#w-perks').innerHTML = String(h`${items.slice(0, 3).map((i) => h`<li>${i}</li>`)}`);
  const ticker = [cfg.welcome_kicker, ...items, cfg.welcome_highlight].filter(Boolean);
  const run = h`${ticker.map((i) => h`<span>${i}</span>`)}`;
  $('#w-ticker').innerHTML = String(h`${run}${run}${run}${run}`);
  $('#marketing-text').textContent = cfg.marketing_text;
  document.title = `Credenciamento — ${cfg.event_name}`;
  if (cfg.mode && cfg.mode !== 'producao' && !document.querySelector('.demo-banner')) {
    const b = document.createElement('div');
    b.className = 'demo-banner';
    b.textContent = cfg.mode === 'demo' ? 'Ambiente de demonstração — dados fictícios' : 'Ambiente de testes';
    document.body.prepend(b);
  }
  updateStatus();
}

async function loadConfig() {
  if (!stationKey) {
    show('setup');
    return false;
  }
  const r = await publicFetch('GET', '/api/public/bootstrap');
  if (r.status === 200) {
    cfg = r.data;
    localStorage.setItem(CFG_STORE, JSON.stringify(cfg));
    applyConfig();
    return true;
  }
  if (r.status === 404 || r.status === 401) {
    localStorage.removeItem(CFG_STORE);
    $('#setup-title').textContent = 'Link do totem inválido';
    $('#setup-text').textContent = (r.data && r.data.error) || 'Gere um novo link em Estações e impressoras.';
    show('setup');
    return false;
  }
  if (cfg) { applyConfig(); return true; } // sem rede: usa a última configuração conhecida
  $('#setup-title').textContent = 'Conectando ao servidor…';
  $('#setup-text').textContent = 'Verifique a rede deste equipamento. Tentaremos de novo automaticamente.';
  show('setup');
  setTimeout(boot, 4000);
  return false;
}

// ---------- Fila local (falha temporária de rede) ----------
const outbox = createOutbox('ms_totem_outbox', async (item) => {
  const r = await publicFetch('POST', '/api/public/register', item);
  if (r.status === 0 || r.status >= 500 || r.status === 429) return 'retry';
  return 'done';
}, () => updateStatus());

function updateStatus() {
  const el = $('#w-status');
  if (!el || !cfg) return;
  const pend = outbox.size();
  const printer = cfg.station && cfg.station.printer_online;
  el.innerHTML = String(h`${pend ? h`<span class="dot alerta pulse"></span>${pend} a sincronizar` : ''}
    <span class="dot ${serverOnline ? (printer ? 'ok' : 'alerta') : 'erro'}"></span>${cfg.station ? cfg.station.name : ''}`);
}
setInterval(async () => {
  if (!cfg || $('#welcome').hidden) return;
  const r = await publicFetch('GET', '/api/public/bootstrap', null, 5000);
  if (r.status === 200) { cfg = r.data; localStorage.setItem(CFG_STORE, JSON.stringify(cfg)); applyConfig(); } else updateStatus();
}, 20000);

// ---------- Formulário ----------
const inputs = Object.fromEntries(FIELDS.map((k) => [k, $(`#f-${k}`)]));
const state = { touched: {}, valid: {} };
let kb = null;
if (useVirtualKeyboard) {
  kb = createKeyboard($('#keyboard'), { onNext: (el) => focusNext(el) });
  for (const el of Object.values(inputs)) el.setAttribute('inputmode', 'none');
}

function validators(k, v) {
  if (k === 'name') return V.normalizeName(v);
  if (k === 'phone') return V.normalizePhone(v);
  if (k === 'email') return V.normalizeEmail(v);
  return { ok: true, value: V.normalizeCompany(v).value };
}

function setFieldState(k, showError) {
  const r = validators(k, inputs[k].value);
  state.valid[k] = r.ok;
  const wrap = inputs[k].closest('.t-field');
  wrap.classList.toggle('valid', r.ok && !!inputs[k].value.trim() && REQUIRED.includes(k));
  wrap.classList.toggle('invalid', !r.ok && showError);
  const err = $(`#e-${k}`);
  if (err) err.textContent = !r.ok && showError ? r.error : '';
  inputs[k].setAttribute('aria-invalid', String(!r.ok && showError));
  updateMast();
  return r;
}

function updateMast() {
  const done = REQUIRED.filter((k) => state.valid[k]).length;
  for (const k of REQUIRED) $(`.mast-tick[data-k="${k}"]`).classList.toggle('on', !!state.valid[k]);
  const pct = (done / REQUIRED.length) * 75;
  $('#platform').style.bottom = `calc(${pct}% - 15px)`;
  if (done === 0) $('#platform').style.bottom = '0px';
}

inputs.phone.addEventListener('input', () => {
  const pos = inputs.phone.value.length;
  inputs.phone.value = V.maskPhoneInput(inputs.phone.value);
  if (pos) inputs.phone.setSelectionRange(inputs.phone.value.length, inputs.phone.value.length);
});
inputs.email.addEventListener('input', () => {
  const v = inputs.email.value.replace(/\s/g, '').toLowerCase();
  if (v !== inputs.email.value) { inputs.email.value = v; }
  $('#email-suggest').hidden = true;
});
for (const k of FIELDS) {
  const el = inputs[k];
  el.addEventListener('input', () => { touch(); setFieldState(k, state.touched[k] && !state.valid[k] ? true : false); });
  el.addEventListener('blur', () => {
    if (el.value.trim()) state.touched[k] = true;
    setFieldState(k, state.touched[k]);
    if (k === 'email') suggestEmail();
  });
  el.addEventListener('focus', () => {
    touch();
    if (kb) kb.show(el, k, k === 'company');
    setTimeout(() => el.closest('.t-field').scrollIntoView({ block: 'center', behavior: 'smooth' }), 60);
  });
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); focusNext(el); } });
}

function suggestEmail() {
  const s = V.suggestEmail(inputs.email.value.trim());
  const b = $('#email-suggest');
  if (s) { b.textContent = `Você quis dizer ${s}?`; b.dataset.v = s; b.hidden = false; } else b.hidden = true;
}
$('#email-suggest').addEventListener('click', (e) => {
  inputs.email.value = e.currentTarget.dataset.v;
  e.currentTarget.hidden = true;
  setFieldState('email', true);
});

function focusNext(el) {
  const i = FIELDS.indexOf(el.name);
  const k = FIELDS[i];
  state.touched[k] = !!el.value.trim() || REQUIRED.includes(k);
  setFieldState(k, state.touched[k] && REQUIRED.includes(k));
  if (k === 'email') suggestEmail();
  if (i < FIELDS.length - 1) inputs[FIELDS[i + 1]].focus();
  else { el.blur(); if (kb) kb.hide(); $('.t-consent').scrollIntoView({ block: 'center', behavior: 'smooth' }); }
}

$('#form').addEventListener('pointerdown', (e) => {
  if (kb && !e.target.closest('input') && !e.target.closest('.kb')) { /* toque fora: mantém teclado se em campo */ }
});
$('#f-privacy').addEventListener('change', () => { $('#e-privacy_ack').textContent = ''; touch(); });

$('#open-privacy').addEventListener('click', (e) => {
  e.preventDefault();
  modal({
    title: 'Aviso de privacidade',
    body: h`<div class="t-privacy">${cfg.privacy_text}</div>`,
    actions: [{ label: 'Fechar', value: false }, { label: 'Li e concordo', cls: 'btn-primary', value: true }],
  }).then((ok) => { if (ok) { $('#f-privacy').checked = true; $('#e-privacy_ack').textContent = ''; } });
});

function resetForm() {
  for (const k of FIELDS) { inputs[k].value = ''; inputs[k].closest('.t-field').classList.remove('valid', 'invalid'); const e = $(`#e-${k}`); if (e) e.textContent = ''; }
  $('#f-privacy').checked = false; $('#f-marketing').checked = false;
  $('#e-privacy_ack').textContent = '';
  $('#email-suggest').hidden = true;
  $('#form-banner').hidden = true;
  state.touched = {}; state.valid = {};
  updateMast();
  if (kb) kb.hide();
}

// ---------- Inatividade: volta ao início e limpa os dados digitados ----------
let idleTimer = null;
function touch() {
  clearTimeout(idleTimer);
  if (!$('#form-screen').hidden) idleTimer = setTimeout(goHome, INACTIVITY_MS);
}
document.addEventListener('pointerdown', touch, { passive: true });

function goHome() {
  clearTimeout(idleTimer); clearInterval(doneTimer); stopPolling();
  resetForm();
  document.querySelectorAll('.overlay').forEach((o) => o.remove());
  show('welcome');
}

$('#start').addEventListener('click', () => {
  resetForm();
  show('form-screen');
  touch();
  setTimeout(() => inputs.name.focus(), 80);
});
$('#cancel').addEventListener('click', goHome);

// ---------- Envio ----------
$('#form').addEventListener('submit', async (e) => {
  e.preventDefault();
  touch();
  let firstBad = null;
  for (const k of FIELDS) {
    state.touched[k] = true;
    const r = setFieldState(k, true);
    if (!r.ok && !firstBad) firstBad = k;
  }
  if (!$('#f-privacy').checked) { $('#e-privacy_ack').textContent = 'Para continuar, confirme o aviso de privacidade.'; if (!firstBad) firstBad = 'privacy'; }
  if (firstBad) {
    if (firstBad === 'privacy') $('.t-consent').scrollIntoView({ block: 'center', behavior: 'smooth' });
    else inputs[firstBad].focus();
    return;
  }
  if (kb) kb.hide();
  const payload = {
    name: inputs.name.value, phone: inputs.phone.value, email: inputs.email.value.trim(), company: inputs.company.value,
    privacy_ack: true, marketing_opt_in: $('#f-marketing').checked, client_ref: uid(),
  };
  $('#busy').hidden = false;
  $('#submit').disabled = true;
  const r = await publicFetch('POST', '/api/public/register', payload, 12000);
  $('#busy').hidden = true;
  $('#submit').disabled = false;

  if (r.status === 0 || r.status >= 500) {
    outbox.add(payload);
    return showDone({ kind: 'queued', first: V.firstName(V.normalizeName(payload.name).value || payload.name) });
  }
  if (r.status === 422 && r.data && r.data.errors) {
    for (const [k, msg] of Object.entries(r.data.errors)) { const el = $(`#e-${k}`); if (el) el.textContent = msg; }
    return;
  }
  if (r.status === 409 || r.status === 429 || r.status === 401) {
    const b = $('#form-banner');
    b.textContent = (r.data && r.data.error) || 'Não foi possível concluir. Procure a recepção.';
    b.hidden = false;
    b.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return;
  }
  const d = r.data;
  if (d.status === 'limit') return showDone({ kind: 'limit', first: d.first_name, text: d.error });
  showDone({ kind: d.status === 'existing' ? 'existing' : 'created', first: d.first_name, seq: d.seq, job: d.job });
});

// ---------- Resultado e acompanhamento da impressão ----------
const CHECK = raw('<svg viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg>');
const INFO = raw('<svg viewBox="0 0 24 24"><path d="M12 8v5M12 16.5v.01"/><circle cx="12" cy="12" r="9"/></svg>');
let doneTimer = null, pollTimer = null;
const stopPolling = () => { clearTimeout(pollTimer); pollTimer = null; };

function showDone({ kind, first, seq, job, text }) {
  show('done');
  const mark = $('#d-mark');
  mark.className = 'd-mark' + (kind === 'limit' ? ' warn' : '');
  mark.innerHTML = String(kind === 'limit' ? INFO : CHECK);
  const titles = {
    created: `Pronto, ${first}!`,
    existing: `Bem-vindo de volta, ${first}!`,
    queued: `Recebemos seu cadastro, ${first}.`,
    limit: `${first}, você já está credenciado.`,
  };
  const texts = {
    created: 'Seu credenciamento foi concluído.',
    existing: 'Encontramos seu credenciamento e estamos imprimindo sua etiqueta novamente.',
    queued: 'A conexão oscilou, mas seus dados ficaram guardados. A etiqueta será impressa assim que o sistema reconectar. Se não sair em 1 minuto, procure a recepção.',
    limit: text || 'Procure a recepção se precisar de outra etiqueta.',
  };
  $('#d-title').textContent = titles[kind];
  $('#d-text').textContent = texts[kind];
  $('#d-number').innerHTML = seq ? String(h`Credencial nº <strong>${String(seq).padStart(4, '0')}</strong>`) : '';
  setPrint(null);
  stopPolling();
  if (job) trackJob(job, Date.now());
  startCountdown(kind === 'queued' ? Math.max(cfg.totem_return_seconds, 15) : cfg.totem_return_seconds);
}

function setPrint(job) {
  const el = $('#d-print');
  if (!job) { el.className = 'd-print'; el.innerHTML = ''; return; }
  const here = !job.station_id || !cfg.station || job.station_id === cfg.station.id;
  const where = here ? 'na impressora ao lado' : `na ${job.station_name || 'recepção'}`;
  if (job.status === 'impresso') { el.className = 'd-print ok'; el.innerHTML = String(h`<span class="dot"></span>Retire sua etiqueta ${where}.`); }
  else if (job.status === 'falhou' || job.status === 'cancelado') { el.className = 'd-print fail'; el.innerHTML = String(h`<span>Não conseguimos imprimir sua etiqueta. Procure a recepção e informe seu nome.</span>`); }
  else if (job.status === 'imprimindo') { el.className = 'd-print'; el.innerHTML = String(h`<span class="busy-spin"></span>Imprimindo sua etiqueta ${where}…`); }
  else { el.className = 'd-print'; el.innerHTML = String(h`<span class="busy-spin"></span>${here ? 'Preparando sua etiqueta…' : `Sua etiqueta será impressa ${where}.`}`); }
}

function trackJob(job, startedAt) {
  setPrint(job);
  if (['impresso', 'falhou', 'cancelado'].includes(job.status)) return;
  if (Date.now() - startedAt > 30000) {
    setPrint({ ...job, status: 'falhou' });
    return;
  }
  pollTimer = setTimeout(async () => {
    const r = await publicFetch('GET', `/api/public/jobs/${job.id}`, null, 5000);
    trackJob(r.status === 200 ? r.data : job, startedAt);
  }, 800);
}

function startCountdown(seconds) {
  clearInterval(doneTimer);
  const bar = $('#d-timer-bar');
  const total = seconds * 1000;
  const t0 = Date.now();
  bar.style.transform = 'scaleX(1)';
  doneTimer = setInterval(() => {
    const left = total - (Date.now() - t0);
    bar.style.transform = `scaleX(${Math.max(0, left / total)})`;
    if (left <= 0) goHome();
  }, 100);
}
$('#finish').addEventListener('click', goHome);
$('#done').addEventListener('pointerdown', (e) => { if (!e.target.closest('#finish')) startCountdown(cfg.totem_return_seconds); });

// ---------- Painel discreto da equipe: toque longo (3s) no logo ----------
let holdTimer = null;
$('#staff-hold').addEventListener('pointerdown', () => { holdTimer = setTimeout(openStaff, 3000); });
['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => $('#staff-hold').addEventListener(ev, () => clearTimeout(holdTimer)));
async function openStaff() {
  const r = await publicFetch('GET', '/api/public/bootstrap', null, 5000);
  if (r.status === 200) { cfg = r.data; applyConfig(); }
  const box = document.createElement('div');
  box.className = 'staff';
  box.innerHTML = String(h`<strong>${cfg.station ? cfg.station.name : 'Estação'}</strong>
    <span class="row"><span class="dot ${serverOnline ? 'ok' : 'erro'}"></span>Servidor ${serverOnline ? 'conectado' : 'sem conexão'}</span>
    <span class="row"><span class="dot ${cfg.station && cfg.station.printer_online ? 'ok' : 'erro'}"></span>Impressora ${cfg.station && cfg.station.printer_online ? 'online' : 'sem agente ativo'}</span>
    <span class="row"><span class="dot ${outbox.size() ? 'alerta' : 'ok'}"></span>${outbox.size()} cadastro(s) aguardando envio</span>
    <span class="row">Teclado virtual: ${useVirtualKeyboard ? 'ativo' : 'desativado'}</span>
    <div class="row"><button class="btn btn-sm" data-a="sync">Sincronizar agora</button><button class="btn btn-sm" data-a="reload">Recarregar</button><button class="btn btn-sm btn-primary" data-a="close">Fechar</button></div>`);
  box.addEventListener('click', (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'close') box.remove();
    if (a === 'reload') location.reload();
    if (a === 'sync') { outbox.flush(); box.remove(); }
  });
  document.body.append(box);
  setTimeout(() => box.remove(), 30000);
}

// Evita menus/gestos que tiram o totem da tela.
document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('gesturestart', (e) => e.preventDefault());

async function boot() {
  if (await loadConfig()) { show('welcome'); outbox.flush(); }
}
boot();
