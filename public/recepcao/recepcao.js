import { h, $, api, toast, modal, boot, live, logout, fmtTime, fmtRel, debounce, createOutbox, uid, setTimezone, statusChip, icon, raw, ApiError } from '/shared/app.js';
import { openParticipant, jobChip, setStatusLabels } from '/shared/participant.js';

const V = window.MSValidation;
const user = await boot({ roles: ['recepcao', 'admin'] });
$('#who').textContent = user.name;
$('#logout').addEventListener('click', logout);
if (user.role === 'admin') $('#to-admin').hidden = false;

const conf = await api('GET', '/api/app/config');
setTimezone(conf.timezone);
setStatusLabels(conf.lead_status);
$('#marketing-text').textContent = conf.marketing_text;

// ---------- Estação de impressão ----------
let stations = [];
let stationId = Number(localStorage.getItem('ms_rc_station')) || null;
async function loadStations() {
  stations = (await api('GET', '/api/stations')).items;
  if (!stations.find((s) => s.id === stationId)) stationId = (stations.find((s) => s.kind === 'recepcao') || stations[0] || {}).id || null;
  $('#station').innerHTML = String(h`${stations.map((s) => h`<option value="${s.id}" ${s.id === stationId ? raw('selected') : ''}>Imprimir em: ${s.name}</option>`)}`);
  printerState();
}
function printerState() {
  const s = stations.find((x) => x.id === stationId);
  const el = $('#printer-state');
  if (!s) { el.innerHTML = String(h`<span class="dot erro"></span>Sem estação`); return; }
  el.className = `live${s.agent.online ? '' : ' off'}`;
  el.innerHTML = String(h`<span class="dot"></span>Impressora ${s.agent.online ? 'online' : 'offline'}`);
  el.title = s.agent.online ? '' : 'O agente de impressão desta estação não está conectado.';
}
$('#station').addEventListener('change', (e) => { stationId = Number(e.target.value); localStorage.setItem('ms_rc_station', String(stationId)); printerState(); renderJobs(); });
await loadStations();

// ---------- Formulário ----------
const F = { name: $('#f-name'), phone: $('#f-phone'), email: $('#f-email'), company: $('#f-company') };
const ORDER = ['name', 'phone', 'email', 'company'];
F.phone.addEventListener('input', () => { F.phone.value = V.maskPhoneInput(F.phone.value); });
F.email.addEventListener('input', () => { F.email.value = F.email.value.replace(/\s/g, '').toLowerCase(); $('#email-suggest').hidden = true; });
F.email.addEventListener('blur', () => {
  const s = V.suggestEmail(F.email.value.trim());
  const b = $('#email-suggest');
  if (s) { b.textContent = `Corrigir para ${s}?`; b.dataset.v = s; b.hidden = false; } else b.hidden = true;
});
$('#email-suggest').addEventListener('click', (e) => { F.email.value = e.currentTarget.dataset.v; e.currentTarget.hidden = true; F.company.focus(); });

const check = (k) => {
  const v = F[k].value;
  const r = k === 'name' ? V.normalizeName(v) : k === 'phone' ? V.normalizePhone(v) : k === 'email' ? V.normalizeEmail(v) : { ok: true };
  const e = $(`#e-${k}`);
  if (e) e.textContent = r.ok ? '' : r.error;
  F[k].setAttribute('aria-invalid', String(!r.ok));
  return r.ok;
};
for (const k of ORDER) {
  F[k].addEventListener('blur', () => { if (F[k].value.trim()) check(k); });
  F[k].addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      const i = ORDER.indexOf(k);
      if (i < ORDER.length - 1) F[ORDER[i + 1]].focus(); else $('#f-privacy').focus();
    }
  });
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !document.querySelector('.overlay')) { e.preventDefault(); $('#form').requestSubmit(); }
});
$('#f-privacy').addEventListener('change', () => { $('#e-privacy_ack').textContent = ''; });
$('#open-privacy').addEventListener('click', () => modal({ title: 'Aviso de privacidade', body: h`<p style="line-height:1.55">${conf.privacy_text}</p>`, actions: [{ label: 'Fechar', cls: 'btn-primary' }] }));
$('#form').addEventListener('reset', () => setTimeout(() => {
  for (const k of ORDER) { F[k].removeAttribute('aria-invalid'); const e = $(`#e-${k}`); if (e) e.textContent = ''; }
  $('#e-privacy_ack').textContent = ''; $('#email-suggest').hidden = true; $('#f-print').checked = true; F.name.focus();
}));

// Fila local para quedas de rede (reenvio idempotente).
const outbox = createOutbox('ms_rc_outbox', async (item) => {
  try {
    const r = await api('POST', '/api/reception/register', item, { retries: 0, timeout: 10000 });
    if (r.status === 'created') toast(`${r.participant.name} sincronizado.`, 'ok');
    loadList();
    return 'done';
  } catch (e) {
    if (e.network) return 'retry';
    toast(`Cadastro pendente de ${item.name} não foi aceito: ${e.message}`, 'erro', 9000);
    return 'done';
  }
}, (n) => {
  const el = $('#outbox');
  el.hidden = !n;
  el.textContent = n ? `${n} credenciamento(s) aguardando conexão com o servidor. O envio é automático.` : '';
});

$('#form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const okAll = ['name', 'phone', 'email'].map(check).every(Boolean);
  if (!$('#f-privacy').checked) $('#e-privacy_ack').textContent = 'Confirme que o participante foi informado sobre o aviso de privacidade.';
  if (!okAll || !$('#f-privacy').checked) {
    const bad = ['name', 'phone', 'email'].find((k) => F[k].getAttribute('aria-invalid') === 'true');
    (bad ? F[bad] : $('#f-privacy')).focus();
    return;
  }
  const payload = {
    name: F.name.value, phone: F.phone.value, email: F.email.value.trim(), company: F.company.value,
    privacy_ack: true, marketing_opt_in: $('#f-marketing').checked, print: $('#f-print').checked,
    station_id: stationId, client_ref: uid(),
  };
  const btn = $('#submit');
  btn.setAttribute('aria-busy', 'true');
  try {
    const r = await api('POST', '/api/reception/register', payload, { retries: 0, timeout: 12000 });
    if (r.status === 'existing') return existingDialog(r.participant);
    showLast(r.participant, r.job);
    $('#form').reset();
    loadList();
  } catch (ex) {
    if (ex.network) {
      outbox.add(payload);
      toast('Sem conexão: cadastro guardado e será enviado automaticamente.', 'alerta', 7000);
      $('#form').reset();
    } else if (ex.status === 422 && ex.data && ex.data.errors) {
      for (const [k, m] of Object.entries(ex.data.errors)) { const el = $(`#e-${k}`); if (el) el.textContent = m; }
    } else if (ex.status === 409 && ex.data && ex.data.matches) {
      conflictDialog(ex.data.matches);
    } else toast(ex.message, 'erro');
  } finally { btn.removeAttribute('aria-busy'); }
});

async function reprint(p) {
  try {
    const r = await api('POST', `/api/participants/${p.id}/print`, { station_id: stationId });
    showLast(p, r.job);
    toast(r.job.redirected ? `Impressora offline: enviada para ${r.job.station_name}.` : 'Etiqueta enviada para impressão.', r.job.station_online ? 'ok' : 'alerta');
  } catch (ex) { toast(ex.message, 'erro'); }
}

async function existingDialog(p) {
  const a = await modal({
    title: 'Participante já credenciado',
    body: h`<p><strong>${p.name}</strong>${p.company ? ` — ${p.company}` : ''}</p><p class="muted">Credencial nº ${String(p.seq).padStart(4, '0')}, criada às ${fmtTime(p.created_at)}. Telefone e e-mail conferem com este cadastro.</p>`,
    actions: [{ label: 'Ver cadastro', value: 'open' }, { label: 'Reimprimir etiqueta', cls: 'btn-primary', value: 'print' }],
  });
  if (a === 'print') { await reprint(p); $('#form').reset(); }
  if (a === 'open') openP(p.id);
}

async function conflictDialog(m) {
  const rows = [];
  if (m.phone) rows.push({ field: 'telefone', p: m.phone });
  if (m.email && (!m.phone || m.email.id !== m.phone.id)) rows.push({ field: 'e-mail', p: m.email });
  if (m.email && m.phone && m.email.id === m.phone.id) rows[0].field = 'telefone e e-mail';
  const a = await modal({
    title: 'Dado já usado em outro credenciamento',
    body: h`<p>Confira com o participante. Se for a mesma pessoa, reimprima a etiqueta existente ou corrija o cadastro.</p>
      ${rows.map((r, i) => h`<div class="panel" style="padding:12px 14px;display:grid;gap:4px">
        <span class="muted" style="font-size:13px">Mesmo ${r.field}</span>
        <strong>${r.p.name}</strong><span class="muted">${r.p.phone_fmt} — ${r.p.email}${r.p.company ? ` — ${r.p.company}` : ''}</span>
        <div class="row" style="margin-top:6px"><button class="btn btn-sm btn-primary" data-pick="print:${i}">Reimprimir esta etiqueta</button><button class="btn btn-sm" data-pick="open:${i}">Abrir cadastro</button></div></div>`)}`,
    actions: [{ label: 'Voltar e corrigir', value: null }],
    onOpen(ov, close) { ov.addEventListener('click', (e) => { const b = e.target.closest('[data-pick]'); if (b) close(b.dataset.pick); }); },
  });
  if (!a) return;
  const [act, i] = a.split(':');
  const p = rows[Number(i)].p;
  if (act === 'print') { await reprint(p); $('#form').reset(); } else openP(p.id);
}

// ---------- Último credenciamento + acompanhamento da impressão ----------
let lastJobId = null;
function showLast(p, job) {
  lastJobId = job ? job.id : null;
  const el = $('#last');
  el.hidden = false;
  el.dataset.pid = p.id;
  el.innerHTML = String(h`<div class="rc-last-head"><span class="dot ok"></span><strong>${p.name}</strong><span class="chip neutro num">nº ${String(p.seq).padStart(4, '0')}</span><span id="last-job">${job ? jobChip(job) : h`<span class="chip neutro">Sem impressão</span>`}</span></div>
    <span class="muted" id="last-detail">${job ? (job.redirected ? `Impressora da estação escolhida offline: enviada para ${job.station_name}.` : `Impressão em ${job.station_name || 'estação'}.`) : ''}</span>
    <div class="row"><button class="btn btn-sm" id="last-print">${icon('printer')}Reimprimir</button><button class="btn btn-sm btn-ghost" id="last-open">Abrir cadastro</button></div>`);
  $('#last-print').onclick = () => reprint(p);
  $('#last-open').onclick = () => openP(p.id);
  if (job && job.id) trackLast(job.id, Date.now());
}
// Conferência ativa: cobre o caso de a impressão terminar antes de esta tela receber a resposta.
async function trackLast(id, t0) {
  if (id !== lastJobId || Date.now() - t0 > 30000) return;
  try {
    const j = await api('GET', `/api/jobs/${id}`, undefined, { retries: 0 });
    onJob(j);
    if (['impresso', 'falhou', 'cancelado'].includes(j.status)) return;
  } catch { /* tenta de novo */ }
  setTimeout(() => trackLast(id, t0), 900);
}
function onJob(job) {
  if (job.id === lastJobId && $('#last-job')) {
    $('#last-job').innerHTML = String(jobChip(job));
    if (job.status === 'falhou') $('#last-detail').textContent = job.error || 'Falha na impressão.';
  }
  renderJobs();
}

// ---------- Lista e busca ----------
const openP = (id) => openParticipant(id, { stations, defaultStationId: stationId, onChange: loadList });
let term = '';
async function loadList() {
  try {
    const r = await api('GET', `/api/participants?limit=80&q=${encodeURIComponent(term)}`);
    $('#count').textContent = term ? `${r.total} encontrado(s)` : `${r.total} credenciado(s)`;
    $('#list').innerHTML = r.items.length ? String(h`${r.items.map(row)}`)
      : String(h`<div class="empty"><strong>${term ? 'Nenhum participante encontrado' : 'Nenhum credenciamento ainda'}</strong><span>${term ? 'Confira a grafia ou busque pelo telefone ou e-mail.' : 'Os cadastros do totem e desta tela aparecem aqui em tempo real.'}</span></div>`);
  } catch (e) { toast(e.message, 'erro'); }
}
const row = (p, flash = false) => h`<div class="rc-row${flash ? ' flash' : ''}" data-id="${p.id}">
  <span class="rc-seq">${String(p.seq).padStart(4, '0')}</span>
  <div style="min-width:0"><div class="name">${p.name}</div><div class="sub">${p.company || 'Sem empresa'} — ${p.phone_fmt} — ${fmtRel(p.created_at)}</div></div>
  ${statusChip(p.lead_status, p.lead_status_label)}
  <button class="btn btn-sm" data-print="${p.id}" title="Reimprimir etiqueta">${icon('printer')}</button></div>`;
$('#list').addEventListener('click', async (e) => {
  const pb = e.target.closest('[data-print]');
  if (pb) { e.stopPropagation(); const d = await api('GET', `/api/participants/${pb.dataset.print}`); return reprint(d.participant); }
  const r = e.target.closest('.rc-row');
  if (r) openP(Number(r.dataset.id));
});
$('#search').addEventListener('input', debounce((e) => { term = e.target.value.trim(); loadList(); }, 220));

// ---------- Fila de impressão da estação ----------
async function renderJobs() {
  try {
    const items = (await api('GET', '/api/print-jobs')).items.filter((j) => j.station_id === stationId || j.requested_station_id === stationId);
    const recent = items.filter((j) => Date.now() - Date.parse(j.created_at) < 3600_000);
    const failed = recent.filter((j) => j.status === 'falhou');
    const pending = recent.filter((j) => ['pendente', 'imprimindo'].includes(j.status));
    const el = $('#jobs');
    if (!failed.length && !pending.length) { el.innerHTML = ''; return; }
    el.innerHTML = String(h`${pending.length ? h`<span class="chip alerta">${pending.length} na fila</span>` : ''}
      ${failed.length ? h`<span class="chip erro">${failed.length} falha(s) na última hora</span><span class="muted">${failed[0].error || ''}</span><button class="btn btn-sm" id="retry">${icon('refresh')}Reenviar falhas</button>` : ''}`);
    const rb = $('#retry');
    if (rb) rb.onclick = async () => { try { const r = await api('POST', `/api/stations/${stationId}/retry-failed`, {}); toast(`${r.retried} etiqueta(s) reenviada(s).`, 'ok'); renderJobs(); } catch (ex) { toast(ex.message, 'erro'); } };
  } catch { /* próxima atualização */ }
}

// ---------- Tempo real ----------
live({
  'participant:new': (p) => {
    if (!term) {
      const empty = $('#list .empty'); if (empty) empty.remove();
      $('#list').insertAdjacentHTML('afterbegin', String(row(p, true)));
      const n = parseInt($('#count').textContent, 10) || 0;
      $('#count').textContent = `${n + 1} credenciado(s)`;
    }
  },
  'participant:update': () => loadList(),
  'lead:captured': (p) => { const r = document.querySelector(`.rc-row[data-id="${p.id}"]`); if (r) r.outerHTML = String(row(p)); },
  'job:update': onJob,
  'station:update': (s) => { const i = stations.findIndex((x) => x.id === s.id); if (i >= 0) stations[i] = s; else stations.push(s); printerState(); },
}, (on) => { $('#live').className = `live${on ? '' : ' off'}`; $('#live').lastChild.textContent = on ? 'Ao vivo' : 'Atualizando a cada 15 s'; }, { poll: () => { loadList(); renderJobs(); } });

setInterval(async () => { try { await loadStations(); } catch { /* ok */ } }, 30000);
loadList();
renderJobs();
F.name.focus();
void ApiError;
