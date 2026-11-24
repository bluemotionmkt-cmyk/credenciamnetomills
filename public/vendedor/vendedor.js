import { h, $, $$, api, toast, boot, live, logout, fmtTime, fmtDateTime, fmtRel, debounce, setTimezone, statusChip, icon, raw, fmtInt } from '/shared/app.js';

const user = await boot({ roles: ['vendedor', 'admin'] });
$('#who').textContent = user.name;
$('#logout').addEventListener('click', logout);
const conf = await api('GET', '/api/app/config');
setTimezone(conf.timezone);
$('#lstatus').insertAdjacentHTML('beforeend', String(h`${Object.entries(conf.lead_status).filter(([k]) => k !== 'nao_captado').map(([k, l]) => h`<option value="${k}">${l}</option>`)}`));
const TEMP = conf.temperatures;

// ---------- Navegação ----------
function route() {
  const v = location.hash.replace('#', '') || 'ler';
  for (const s of ['ler', 'leads']) $(`#v-${s}`).hidden = s !== v;
  $$('.vd-tab').forEach((a) => { if (a.dataset.v === v) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  if (v === 'leads') { stopCamera(); loadLeads(); } else if (camWanted) startCamera();
}
window.addEventListener('hashchange', route);

// ---------- Retorno tátil e sonoro ----------
let audio;
function beep(ok = true) {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const o = audio.createOscillator(), g = audio.createGain();
    o.frequency.value = ok ? 1150 : 320; o.type = 'sine';
    g.gain.setValueAtTime(0.0001, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.25, audio.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + (ok ? 0.12 : 0.3));
    o.connect(g).connect(audio.destination); o.start(); o.stop(audio.currentTime + 0.32);
  } catch { /* sem áudio */ }
  if (navigator.vibrate) navigator.vibrate(ok ? 40 : [60, 60, 60]);
}

// ---------- Câmera ----------
const video = $('#video'), canvas = $('#canvas'), cam = $('#cam');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
let stream = null, camWanted = false, devices = [], devIdx = 0, scanTimer = null, detector = null, lastCode = '', lastAt = 0, paused = false;
if ('BarcodeDetector' in window) {
  BarcodeDetector.getSupportedFormats().then((f) => { if (f.includes('qr_code')) detector = new BarcodeDetector({ formats: ['qr_code'] }); }).catch(() => {});
}

async function startCamera() {
  camWanted = true;
  if (stream) return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    $('#cam-text').textContent = window.isSecureContext ? 'Este navegador não oferece acesso à câmera. Use a busca manual ou um leitor USB.' : 'A câmera só funciona em conexão segura. Abra esta página pelo endereço https:// informado pela organização.';
    $('#cam-start').hidden = true;
    return;
  }
  try {
    const constraints = devices[devIdx] ? { deviceId: { exact: devices[devIdx].deviceId } } : { facingMode: { ideal: 'environment' } };
    stream = await navigator.mediaDevices.getUserMedia({ video: { ...constraints, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    video.srcObject = stream;
    await video.play();
    cam.classList.add('running');
    $('#cam-stop').hidden = false;
    devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
    $('#cam-flip').hidden = devices.length < 2;
    scanLoop();
  } catch (e) {
    stream = null;
    $('#cam-text').textContent = e.name === 'NotAllowedError' ? 'Permissão da câmera negada. Libere o acesso nas configurações do navegador e tente de novo.' : 'Não foi possível abrir a câmera. Confira se outro aplicativo está usando a câmera.';
    $('#cam-start').textContent = 'Tentar de novo';
  }
}
function stopCamera() {
  clearTimeout(scanTimer);
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
  cam.classList.remove('running');
  $('#cam-stop').hidden = true;
}
async function scanLoop() {
  clearTimeout(scanTimer);
  if (!stream) return;
  if (!paused && video.readyState >= 2) {
    let code = null;
    try {
      if (detector) {
        const r = await detector.detect(video);
        if (r.length) code = r[0].rawValue;
      } else if (window.jsQR) {
        const w = Math.min(720, video.videoWidth), hgt = Math.round(video.videoHeight * (w / video.videoWidth));
        canvas.width = w; canvas.height = hgt;
        ctx.drawImage(video, 0, 0, w, hgt);
        const img = ctx.getImageData(0, 0, w, hgt);
        const r = window.jsQR(img.data, w, hgt, { inversionAttempts: 'dontInvert' });
        if (r) code = r.data;
      }
    } catch { /* quadro inválido */ }
    if (code) onCode(code, 'camera');
  }
  scanTimer = setTimeout(scanLoop, 110);
}
$('#cam-start').addEventListener('click', startCamera);
$('#cam-stop').addEventListener('click', () => { camWanted = false; stopCamera(); $('#cam-text').textContent = 'Câmera pausada.'; $('#cam-start').textContent = 'Ativar câmera'; });
$('#cam-flip').addEventListener('click', () => { devIdx = (devIdx + 1) % devices.length; stopCamera(); startCamera(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) stopCamera(); else if (camWanted && !$('#v-ler').hidden) startCamera(); });

// ---------- Leitor USB (emula teclado: caracteres rápidos + Enter) ----------
let buf = '', bufAt = 0;
document.addEventListener('keydown', (e) => {
  const inField = e.target.matches('input, textarea, select');
  if (!$('#sheet-wrap').hidden && inField) return;
  const now = performance.now();
  if (e.key === 'Enter') {
    if (/^MS[A-Z0-9]{10}$/i.test(buf) && (!inField || e.target.id === 'manual')) { e.preventDefault(); onCode(buf, 'leitor'); if (e.target.id === 'manual') e.target.value = ''; }
    buf = '';
    return;
  }
  if (e.key.length === 1) {
    if (now - bufAt > 80) buf = '';
    buf += e.key;
    bufAt = now;
  }
});

// ---------- Busca manual ----------
const manual = $('#manual');
manual.addEventListener('input', debounce(async () => {
  const q = manual.value.trim();
  const box = $('#results');
  if (/^MS[A-Z0-9]{10}$/i.test(q)) { manual.value = ''; box.innerHTML = ''; return onCode(q, 'digitado'); }
  if (q.length < 3) { box.innerHTML = ''; return; }
  try {
    const r = await api('GET', `/api/search?q=${encodeURIComponent(q)}`);
    box.innerHTML = r.items.length ? String(h`${r.items.map((p) => h`<button type="button" class="vd-res" data-id="${p.id}">
        <strong>${p.name}</strong>${p.ownership === 'mine' ? h`<span class="chip ok">Seu lead</span>` : p.ownership === 'other' ? h`<span class="chip alerta">Já captado</span>` : h`<span class="chip neutro">Livre</span>`}
        <small>${p.company || 'Sem empresa'} — ${p.phone_masked}</small></button>`)}`)
      : String(h`<div class="empty" style="padding:18px"><span>Nenhum participante encontrado.</span></div>`);
  } catch (e) { toast(e.message, 'erro'); }
}, 250));
$('#results').addEventListener('click', async (e) => {
  const b = e.target.closest('.vd-res');
  if (!b) return;
  try { const r = await api('GET', `/api/participant-by-id/${b.dataset.id}`); openSheet(r.participant); } catch (ex) { toast(ex.message, 'erro'); }
});

// ---------- Leitura ----------
async function onCode(raw0, via) {
  const code = String(raw0).trim().toUpperCase();
  const now = Date.now();
  // A mesma credencial só reabre depois de sair do enquadramento por 2,5 s
  // (evita reabrir a ficha logo após fechá-la com a etiqueta ainda na frente da câmera).
  if (code === lastCode && now - lastAt < 2500) { lastAt = now; return; }
  lastCode = code; lastAt = now;
  if (!$('#sheet-wrap').hidden) return;
  paused = true;
  cam.classList.add('hit');
  try {
    const r = await api('GET', `/api/scan/${encodeURIComponent(code)}`, undefined, { retries: 1 });
    beep(true);
    openSheet(r.participant);
  } catch (e) {
    beep(false);
    toast(e.status === 400 ? 'Este QR Code não é uma credencial da inauguração.' : e.message, 'erro');
    setTimeout(() => { paused = false; }, 1200);
  } finally { setTimeout(() => cam.classList.remove('hit'), 600); }
  void via;
}

// ---------- Ficha ----------
let current = null;
function closeSheet() {
  $('#sheet-wrap').hidden = true;
  current = null;
  paused = false;
  lastAt = Date.now();
  if (manual.value.trim().length >= 3) manual.dispatchEvent(new Event('input'));
  if (!$('#v-ler').hidden && !matchMedia('(pointer: coarse)').matches) manual.focus({ preventScroll: true });
}
$('#sheet-wrap').addEventListener('mousedown', (e) => { if (e.target.id === 'sheet-wrap') closeSheet(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#sheet-wrap').hidden) closeSheet(); });

function openSheet(p, history = null) {
  current = p;
  $('#sheet-wrap').hidden = false;
  drawSheet(history);
}

function drawSheet(history) {
  const p = current;
  const s = $('#sheet');
  const contact = p.phone ? h`<div class="vd-contact">
      <a href="https://wa.me/55${p.phone}" target="_blank" rel="noopener">${icon('whatsapp')}${p.phone_fmt}<span class="muted" style="margin-left:auto;font-size:13px">WhatsApp</span></a>
      <a href="tel:+55${p.phone}">${icon('phone')}Ligar</a>
      <a href="mailto:${p.email}">${icon('mail')}${p.email}</a></div>` : '';
  let body;
  if (p.ownership === 'free') {
    body = h`${contact}
      <p class="vd-meta"><span>Credenciado às ${fmtTime(p.created_at)}</span>${statusChip(p.lead_status, p.lead_status_label)}${p.marketing_opt_in ? h`<span class="chip ok">Aceita ofertas</span>` : ''}</p>
      <button class="btn btn-acao vd-capture" id="capture" type="button">CAPTAR ESTE LEAD</button>
      <button class="btn" data-a="close" type="button">Ler próximo</button>`;
  } else if (p.ownership === 'other') {
    body = h`<p class="vd-owner other">Este participante já foi captado por <strong>${p.captured_by_name}</strong> às ${fmtTime(p.captured_at)}. Se houver engano, fale com o administrador.</p>
      <button class="btn btn-primary" data-a="close" type="button">Ler próximo</button>`;
  } else {
    body = h`<p class="vd-owner mine">${icon('check')}Este lead é seu desde ${fmtTime(p.captured_at)}.</p>
      ${contact}
      <div class="vd-qual">
        <div class="field"><span class="label">Temperatura</span><div class="pills" id="q-temp">${Object.entries(TEMP).map(([k, l]) => h`<button type="button" class="pill" data-v="${k}" aria-pressed="${p.temperature === k}">${l}</button>`)}</div></div>
        <div class="field"><span class="label">Interesses</span><div class="pills" id="q-int">${conf.interests.map((i) => h`<button type="button" class="pill" data-v="${i}" aria-pressed="${(p.interests || []).includes(i)}">${i}</button>`)}</div></div>
        <div class="field"><label for="q-status">Status</label><select class="select" id="q-status">${Object.entries(conf.lead_status).filter(([k]) => k !== 'nao_captado').map(([k, l]) => h`<option value="${k}" ${k === p.lead_status ? raw('selected') : ''}>${l}</option>`)}</select></div>
        <div class="field"><label for="q-notes">Observações</label><textarea class="textarea" id="q-notes" placeholder="Equipamento, prazo, quantidade, próximo passo…">${p.notes || ''}</textarea></div>
      </div>
      ${history ? h`<div class="timeline"><p class="section-title">Histórico</p><ul>${history.slice(0, 8).map((e) => h`<li><span></span><div>${({ credenciado: 'Credenciado', captado: 'Captado', qr_lido: 'Credencial lida', etiqueta_impressa: 'Etiqueta impressa', lead_atualizado: 'Lead atualizado', lead_reatribuido: 'Lead reatribuído', dados_editados: 'Dados editados' })[e.type] || e.type}${e.user_name ? ` — ${e.user_name}` : ''}<time>${fmtDateTime(e.at)}</time></div></li>`)}</ul></div>` : ''}
      <div class="vd-sheet-actions"><button class="btn" data-a="close" type="button">Fechar</button><button class="btn btn-primary" id="save" type="button">Salvar qualificação</button></div>`;
  }
  s.innerHTML = String(h`<div><h2>${p.name}</h2><p class="company">${p.company || 'Sem empresa informada'}</p></div>${body}`);
}

$('#sheet').addEventListener('click', async (e) => {
  const t = e.target;
  if (t.closest('[data-a="close"]')) return closeSheet();
  const pill = t.closest('.pill');
  if (pill) {
    if (pill.parentElement.id === 'q-temp') $$('#q-temp .pill').forEach((b) => b.setAttribute('aria-pressed', String(b === pill && b.getAttribute('aria-pressed') !== 'true')));
    else pill.setAttribute('aria-pressed', String(pill.getAttribute('aria-pressed') !== 'true'));
    return;
  }
  if (t.closest('#capture')) {
    const b = t.closest('#capture');
    b.setAttribute('aria-busy', 'true');
    try {
      const r = await api('POST', `/api/leads/${current.id}/capture`, {});
      beep(true);
      toast(r.already ? 'Este lead já era seu.' : `Lead captado: ${r.participant.name}.`, 'ok');
      current = r.participant;
      drawSheet();
      refreshStats();
    } catch (ex) {
      beep(false);
      if (ex.status === 409 && ex.data && ex.data.participant) { current = ex.data.participant; drawSheet(); }
      toast(ex.message, 'erro', 6000);
    } finally { b.removeAttribute('aria-busy'); }
  }
  if (t.closest('#save')) {
    const b = t.closest('#save');
    b.setAttribute('aria-busy', 'true');
    try {
      const temp = ($('#q-temp .pill[aria-pressed="true"]') || {}).dataset;
      const r = await api('PATCH', `/api/leads/${current.id}`, {
        temperature: temp ? temp.v : null,
        interests: $$('#q-int .pill[aria-pressed="true"]').map((x) => x.dataset.v),
        lead_status: $('#q-status').value,
        notes: $('#q-notes').value,
      });
      current = r.participant;
      toast('Qualificação salva.', 'ok');
      closeSheet();
      if (!$('#v-leads').hidden) loadLeads();
    } catch (ex) { toast(ex.message, 'erro'); } finally { b.removeAttribute('aria-busy'); }
  }
});

// ---------- Indicadores ----------
async function refreshStats() {
  try {
    const s = await api('GET', '/api/my/stats');
    $('#today').innerHTML = String(h`<div class="k"><b>${fmtInt(s.today)}</b><span>leads hoje</span></div>
      <div class="k"><b>${fmtInt(s.total)}</b><span>no total</span></div>
      ${s.position ? h`<div class="k"><b>${s.position}º</b><span>de ${s.sellers} vendedores</span></div>` : ''}
      ${s.unclaimed != null ? h`<div class="k"><b>${fmtInt(s.unclaimed)}</b><span>participantes ainda não captados</span></div>` : ''}`);
    $('#kpis').innerHTML = String(h`<div class="k"><b>${fmtInt(s.total)}</b><span>leads captados</span></div>
      <div class="k"><b>${fmtInt(s.today)}</b><span>captados hoje</span></div>
      <div class="k"><b>${fmtInt(s.hot)}</b><span>leads quentes</span></div>
      <div class="k"><b>${s.position ? `${s.position}º` : '—'}</b><span>posição entre ${s.sellers}</span></div>
      ${s.unclaimed != null ? h`<div class="k"><b>${fmtInt(s.unclaimed)}</b><span>ainda não captados na inauguração</span></div>` : ''}`);
  } catch { /* próxima atualização */ }
}

// ---------- Meus leads ----------
async function loadLeads(flashId) {
  const q = new URLSearchParams({ q: $('#lq').value.trim(), status: $('#lstatus').value, temperature: $('#ltemp').value });
  $('#export').href = `/api/my/export.xlsx?${q}`;
  try {
    const r = await api('GET', `/api/my/leads?${q}`);
    const filtered = [...q.values()].some(Boolean);
    $('#list').innerHTML = r.items.length ? String(h`${r.items.map((p) => h`<div class="vd-item${p.id === flashId ? ' flash' : ''}" data-id="${p.id}">
        <div style="min-width:0"><div class="n">${p.name}</div><div class="s">${p.company || 'Sem empresa'} — captado ${fmtRel(p.captured_at)}${p.interests && p.interests.length ? ` — ${p.interests.join(', ')}` : ''}</div></div>
        <div class="r">${p.temperature ? h`<span class="chip neutro temp-${p.temperature}">${TEMP[p.temperature]}</span>` : ''}${statusChip(p.lead_status, p.lead_status_label)}</div></div>`)}`)
      : String(h`<div class="empty"><strong>${filtered ? 'Nenhum lead com esses filtros' : 'Você ainda não captou leads'}</strong><span>${filtered ? 'Limpe a busca ou troque os filtros.' : 'Leia a credencial de um participante e toque em Captar este lead.'}</span>${filtered ? '' : h`<a class="btn btn-primary" href="#ler">Ler credencial</a>`}</div>`);
  } catch (e) { toast(e.message, 'erro'); }
  refreshStats();
}
$('#lq').addEventListener('input', debounce(() => loadLeads(), 250));
$('#lstatus').addEventListener('change', () => loadLeads());
$('#ltemp').addEventListener('change', () => loadLeads());
$('#list').addEventListener('click', async (e) => {
  const it = e.target.closest('.vd-item');
  if (!it) return;
  try { const r = await api('GET', `/api/leads/${it.dataset.id}`); openSheet(r.participant, r.history); } catch (ex) { toast(ex.message, 'erro'); }
});

// ---------- Tempo real ----------
live({
  'lead:captured': (p) => { refreshStats(); if (!$('#v-leads').hidden) loadLeads(p.id); },
  'lead:update': () => { if (!$('#v-leads').hidden && $('#sheet-wrap').hidden) loadLeads(); refreshStats(); },
  'lead:assigned': () => { refreshStats(); if (!$('#v-leads').hidden) loadLeads(); },
  counts: () => refreshStats(),
}, (on) => { $('#live').className = `live${on ? '' : ' off'}`; $('#live').lastChild.textContent = on ? 'Ao vivo' : 'Atualizando a cada 15 s'; }, { poll: () => { refreshStats(); if (!$('#v-leads').hidden && $('#sheet-wrap').hidden) loadLeads(); } });

route();
refreshStats();
// Em notebooks a câmera pode ligar direto; em celulares o navegador exige um toque.
if (!matchMedia('(pointer: coarse)').matches) startCamera();
