import { h, $, $$, api, toast, modal, confirmDialog, boot, live, logout, fmtTime, fmtDateTime, fmtRel, fmtInt, fmtPct, debounce, setTimezone, statusChip, icon, raw, copyText } from '/shared/app.js';
import { openParticipant, jobChip, setStatusLabels } from '/shared/participant.js';

const user = await boot({ roles: ['admin'] });
$('#who').textContent = user.name;
$('#logout').addEventListener('click', logout);
let conf = await api('GET', '/api/app/config');
setTimezone(conf.timezone);
setStatusLabels(conf.lead_status);
$('#event-name').textContent = conf.event_name;

const main = $('#main');
let stations = [], sellers = [];
async function loadRefs() {
  const [s, u] = await Promise.all([api('GET', '/api/stations'), api('GET', '/api/sellers')]);
  stations = s.items; sellers = u.items;
}
await loadRefs();
const drawerOpts = () => ({ admin: true, stations, sellers, statusMap: conf.lead_status, defaultStationId: (stations.find((s) => s.kind === 'recepcao') || stations[0] || {}).id, onChange: () => refresh() });
const ROLE = { admin: 'Administrador', vendedor: 'Vendedor', recepcao: 'Recepção' };

// ---------- Roteamento ----------
const PAGES = { painel: pagePainel, participantes: pageParticipantes, leads: pageLeads, equipe: pageEquipe, estacoes: pageEstacoes, configuracoes: pageConfig, auditoria: pageAuditoria, backups: pageBackups };
let current = 'painel';
let refresh = () => {};
function route() {
  current = location.hash.replace('#', '') || 'painel';
  if (!PAGES[current]) current = 'painel';
  $$('.ad-nav a').forEach((a) => { if (a.dataset.r === current) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  refresh = () => {};
  main.innerHTML = '';
  PAGES[current]();
  main.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);
main.addEventListener('click', (e) => { const r = e.target.closest('.feed-row[data-p]'); if (r && current === 'painel') openParticipant(Number(r.dataset.p), drawerOpts()); });
const head = (title, sub, actions = '') => h`<div class="page-head"><div><h1>${title}</h1>${sub ? h`<p class="sub">${sub}</p>` : ''}</div><div class="actions">${actions}</div></div>`;
const searchBox = (id, ph) => h`<div class="search">${icon('search')}<input class="input" id="${id}" placeholder="${ph}" autocomplete="off"></div>`;

// ================= PAINEL =================
function hourlyChart(rows) {
  if (!rows.length) return h`<div class="empty"><strong>Sem credenciamentos ainda</strong><span>O gráfico começa a ser desenhado no primeiro cadastro.</span></div>`;
  const W = 760, H = 230, pl = 30, pb = 26, pt = 10;
  const max = Math.max(4, ...rows.map((r) => Math.max(r.registrations, r.captures)));
  const step = Math.ceil(max / 4);
  const top = step * 4;
  const bw = (W - pl) / rows.length;
  const y = (v) => pt + (H - pt - pb) * (1 - v / top);
  const grid = [0, 1, 2, 3, 4].map((i) => h`<line class="grid" x1="${pl}" x2="${W}" y1="${y(i * step)}" y2="${y(i * step)}"/><text x="${pl - 6}" y="${y(i * step) + 4}" text-anchor="end">${i * step}</text>`);
  const labelEvery = Math.ceil(rows.length / 12);
  const bars = rows.map((r, i) => {
    const x = pl + i * bw;
    const w = Math.max(2, bw * 0.36);
    return h`<rect class="bar-r" x="${x + bw * 0.12}" y="${y(r.registrations)}" width="${w}" height="${Math.max(0, H - pb - y(r.registrations))}" rx="1.5"><title>${r.hour.slice(11)}h — ${r.registrations} credenciamento(s)</title></rect>
      <rect class="bar-c" x="${x + bw * 0.12 + w + 1}" y="${y(r.captures)}" width="${w}" height="${Math.max(0, H - pb - y(r.captures))}" rx="1.5"><title>${r.hour.slice(11)}h — ${r.captures} lead(s) captado(s)</title></rect>
      ${i % labelEvery === 0 ? h`<text x="${x + bw / 2}" y="${H - 8}" text-anchor="middle">${r.hour.slice(11)}h</text>` : ''}`;
  });
  return h`<svg class="chart-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Credenciamentos e captações por hora">${grid}${bars}</svg>`;
}

function feedText(e) {
  const who = e.participant_name;
  if (e.type === 'credenciado') return h`<b>${who}</b> credenciado${e.company ? h` <span class="muted">— ${e.company}</span>` : ''}`;
  if (e.type === 'captado') return h`<b>${e.user_name}</b> captou <b>${who}</b>`;
  if (e.type === 'lead_reatribuido') return h`Lead <b>${who}</b> ${e.data && e.data.para ? `atribuído a ${e.data.para}` : 'liberado'}`;
  if (e.type === 'lead_atualizado') return h`<b>${e.user_name}</b> atualizou o lead <b>${who}</b>`;
  return h`${e.type} — ${who}`;
}

async function pagePainel() {
  main.innerHTML = String(h`${head('Painel da inauguração', 'Atualizado em tempo real.', h`<a class="btn" href="/api/export/leads.xlsx">${icon('download')}Exportar leads</a>`)}<div id="dash"><div class="skeleton" style="height:110px;margin-bottom:18px"></div><div class="skeleton" style="height:280px"></div></div>`);
  const draw = async () => {
    let s;
    try { s = await api('GET', '/api/admin/stats'); } catch (e) { toast(e.message, 'erro'); return; }
    if (current !== 'painel') return;
    const t = s.totals;
    const maxSeller = Math.max(1, ...s.per_seller.map((x) => x.total));
    const funnelMax = Math.max(1, ...Object.values(s.funnel));
    $('#dash').innerHTML = String(h`
      <section class="kpi-band" aria-label="Indicadores">
        <div class="kpi"><span class="v">${fmtInt(t.participants)}</span><span class="l">Participantes credenciados</span><span class="s">${fmtInt(t.from_totem)} no totem, ${fmtInt(t.from_reception)} na recepção</span></div>
        <div class="kpi accent"><span class="v">${fmtInt(t.captured)}</span><span class="l">Leads captados</span><span class="s">${fmtInt(t.hot)} marcados como quentes</span></div>
        <div class="kpi"><span class="v">${fmtInt(t.uncaptured)}</span><span class="l">Ainda não captados</span><span class="s">oportunidades em aberto</span></div>
        <div class="kpi"><span class="v">${fmtPct(t.conversion)}</span><span class="l">Conversão em leads</span><span class="s">captados ÷ credenciados</span></div>
        <div class="kpi"><span class="v">${t.sellers_online}<span style="font-size:.5em;color:var(--tinta-3)"> / ${t.sellers_active}</span></span><span class="l">Vendedores em atividade</span><span class="s">online agora / cadastrados ativos</span></div>
      </section>
      <div class="grid-2">
        <section class="panel"><div class="panel-head"><h2>Credenciamentos e captações por hora</h2><div class="legend"><span><i class="sw" style="background:var(--petroleo)"></i>Credenciamentos</span><span><i class="sw" style="background:var(--laranja)"></i>Leads captados</span></div></div><div class="panel-body">${hourlyChart(s.hourly)}</div></section>
        <section class="panel"><div class="panel-head"><h2>Leads por vendedor</h2></div><div class="panel-body">
          ${s.per_seller.length ? h`<div class="rank">${s.per_seller.map((v, i) => h`<div class="rank-row"><span class="rank-pos">${i + 1}</span>
            <div style="min-width:0"><div class="rank-name"><span class="dot ${v.online ? 'ok' : 'off'}" title="${v.online ? 'Online' : 'Offline'}"></span><span>${v.name}</span></div>
            <div class="rank-bar"><i style="width:${(v.total / maxSeller) * 100}%"></i></div>
            <div class="rank-meta">${v.today} hoje — ${v.hot} quentes — ${v.advanced} em negociação ou adiante${v.last_capture ? ` — última ${fmtRel(v.last_capture)}` : ''}</div></div>
            <span class="rank-num">${v.total}</span></div>`)}</div>`
            : h`<div class="empty"><strong>Nenhum vendedor cadastrado</strong><a class="btn btn-primary" href="#equipe">Cadastrar equipe</a></div>`}
        </div></section>
      </div>
      <div class="grid-2b">
        <section class="panel"><div class="panel-head"><h2>Funil comercial</h2></div><div class="panel-body"><div class="funnel">
          ${Object.entries(s.funnel).map(([k, n]) => h`<div class="funnel-row"><span>${conf.lead_status[k]}</span><span class="bar"><i style="width:${(n / funnelMax) * 100}%;${k === 'venda' ? 'background:var(--ok)' : k === 'nao_captado' ? 'background:var(--linha)' : ''}"></i></span><b>${n}</b></div>`)}
        </div></div></section>
        <section class="panel"><div class="panel-head"><h2>Estações e impressoras</h2><span class="muted" style="font-size:13px">última hora: ${s.prints.ok} impressas, ${s.prints.failed} falhas, ${s.prints.pending} na fila</span></div><div class="panel-body"><div class="stations-mini">
          ${s.stations.map((st) => h`<div class="st-mini"><span class="dot ${st.agent.online ? 'ok' : 'erro'}"></span><div><strong>${st.name}</strong> <span class="muted">${st.kind === 'totem' ? 'Totem' : 'Recepção'}${st.active ? '' : ' — desativada'}</span><div class="muted">${st.agent.online ? `Impressora online${st.agent.info && st.agent.info.printer && st.agent.info.printer.ok === false ? ` — atenção: ${st.agent.info.printer.detail}` : ''}` : st.agent.configured ? `Agente offline desde ${fmtRel(st.agent.last_seen)}` : 'Agente de impressão não configurado'}</div></div>
            ${!st.agent.online ? h`<span class="chip erro">Sem impressora</span>` : st.queue.failed_last_hour ? h`<span class="chip erro">${st.queue.failed_last_hour} falha(s)</span>` : st.queue.pending ? h`<span class="chip alerta">${st.queue.pending} na fila</span>` : h`<span class="chip ok">OK</span>`}</div>`)}
        </div></div></section>
      </div>
      <section class="panel"><div class="panel-head"><h2>Atividade recente</h2></div><div class="panel-body"><div class="feed">
        ${s.recent.length ? s.recent.map((e) => h`<div class="feed-row" data-p="${e.participant_id}" style="cursor:pointer"><time>${fmtTime(e.at)}</time><span>${feedText(e)}</span></div>`) : h`<div class="empty"><span>Nenhuma atividade ainda.</span></div>`}
      </div></div></section>`);
  };
  refresh = debounce(draw, 700);
  await draw();
}

// ================= PARTICIPANTES =================
async function pageParticipantes() {
  const companies = await api('GET', '/api/participants/companies').catch(() => []);
  main.innerHTML = String(h`${head('Participantes', 'Todos os credenciados da inauguração.', h`<a class="btn" id="exp-csv">${icon('download')}CSV</a><a class="btn btn-primary" id="exp-xlsx">${icon('download')}Excel</a>`)}
    <section class="panel">
      <div class="filters">${searchBox('pq', 'Nome, telefone, e-mail, empresa, código ou nº')}
        <select class="select" id="pstatus"><option value="">Todos</option><option value="captado">Captados</option><option value="nao_captado">Não captados</option>${Object.entries(conf.lead_status).filter(([k]) => k !== 'nao_captado').map(([k, l]) => h`<option value="${k}">${l}</option>`)}</select>
        <select class="select" id="pcompany"><option value="">Todas as empresas</option>${companies.map((c) => h`<option value="${c.company}">${c.company} (${c.n})</option>`)}</select>
        <select class="select" id="pseller"><option value="">Todos os vendedores</option>${sellers.map((s) => h`<option value="${s.id}">${s.name}</option>`)}</select>
        <select class="select" id="psource"><option value="">Totem e recepção</option><option value="totem">Totem</option><option value="recepcao">Recepção</option></select>
      </div>
      <div class="table-wrap"><table class="data"><thead><tr><th>Nº</th><th>Participante</th><th>Contato</th><th>Credenciado</th><th>Status</th><th>Vendedor</th><th>Etiquetas</th></tr></thead><tbody id="ptbody"></tbody></table></div>
      <div class="pager" id="ppager"></div>
    </section>`);
  let offset = 0;
  const LIMIT = 50;
  const params = () => new URLSearchParams({ q: $('#pq').value.trim(), status: $('#pstatus').value, company: $('#pcompany').value, seller: $('#pseller').value, source: $('#psource').value });
  const load = async () => {
    const p = params();
    $('#exp-csv').href = `/api/export/participants.csv?${p}`;
    $('#exp-xlsx').href = `/api/export/participants.xlsx?${p}`;
    p.set('limit', LIMIT); p.set('offset', offset);
    const r = await api('GET', `/api/participants?${p}`);
    if (current !== 'participantes') return;
    $('#ptbody').innerHTML = r.items.length ? String(h`${r.items.map((x) => h`<tr data-id="${x.id}">
      <td class="num muted">${String(x.seq).padStart(4, '0')}</td>
      <td><div class="cell-name">${x.name}</div><div class="cell-sub">${x.company || 'Sem empresa'}</div></td>
      <td><div>${x.phone_fmt}</div><div class="cell-sub">${x.email}</div></td>
      <td><div>${fmtDateTime(x.created_at)}</div><div class="cell-sub">${x.source === 'totem' ? 'Totem' : 'Recepção'}</div></td>
      <td>${statusChip(x.lead_status, x.lead_status_label)}</td>
      <td>${x.captured_by_name || h`<span class="muted">—</span>`}</td>
      <td class="num">${x.print_count}</td></tr>`)}`)
      : String(h`<tr><td colspan="7"><div class="empty"><strong>Nenhum participante encontrado</strong><span>Ajuste a busca ou os filtros.</span></div></td></tr>`);
    $('#ppager').innerHTML = String(h`<span>${r.total ? `${offset + 1}–${Math.min(offset + LIMIT, r.total)} de ${fmtInt(r.total)}` : '0 resultados'}</span>
      <button class="btn btn-sm" id="pprev" ${offset === 0 ? raw('disabled') : ''}>Anterior</button><button class="btn btn-sm" id="pnext" ${offset + LIMIT >= r.total ? raw('disabled') : ''}>Próxima</button>`);
    $('#pprev').onclick = () => { offset = Math.max(0, offset - LIMIT); load(); };
    $('#pnext').onclick = () => { offset += LIMIT; load(); };
  };
  $('#pq').addEventListener('input', debounce(() => { offset = 0; load(); }, 250));
  ['pstatus', 'pcompany', 'pseller', 'psource'].forEach((id) => $(`#${id}`).addEventListener('change', () => { offset = 0; load(); }));
  $('#ptbody').addEventListener('click', (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) openParticipant(Number(tr.dataset.id), drawerOpts()); });
  refresh = debounce(load, 600);
  await load();
}

// ================= LEADS =================
async function pageLeads() {
  main.innerHTML = String(h`${head('Leads', 'Participantes captados pelos vendedores e acompanhamento comercial.', h`<a class="btn" id="lexp-csv">${icon('download')}CSV</a><a class="btn btn-primary" id="lexp-xlsx">${icon('download')}Excel</a>`)}
    <section class="panel">
      <div class="filters">${searchBox('lq', 'Buscar lead')}
        <select class="select" id="lstatus"><option value="">Todos os status</option>${Object.entries(conf.lead_status).filter(([k]) => k !== 'nao_captado').map(([k, l]) => h`<option value="${k}">${l}</option>`)}</select>
        <select class="select" id="lseller"><option value="">Todos os vendedores</option>${sellers.map((s) => h`<option value="${s.id}">${s.name}</option>`)}</select>
        <select class="select" id="ltemp"><option value="">Todas as temperaturas</option>${Object.entries(conf.temperatures).map(([k, l]) => h`<option value="${k}">${l}</option>`)}</select>
      </div>
      <div class="table-wrap"><table class="data"><thead><tr><th>Lead</th><th>Vendedor</th><th>Captado</th><th>Status comercial</th><th>Temperatura</th><th>Interesses</th></tr></thead><tbody id="ltbody"></tbody></table></div>
      <div class="pager" id="lpager"></div>
    </section>`);
  const load = async () => {
    const p = new URLSearchParams({ q: $('#lq').value.trim(), status: $('#lstatus').value, seller: $('#lseller').value, temperature: $('#ltemp').value });
    $('#lexp-csv').href = `/api/export/leads.csv?${p}`;
    $('#lexp-xlsx').href = `/api/export/leads.xlsx?${p}`;
    p.set('limit', 500);
    const r = await api('GET', `/api/leads?${p}`);
    if (current !== 'leads') return;
    $('#ltbody').innerHTML = r.items.length ? String(h`${r.items.map((x) => h`<tr data-id="${x.id}">
      <td><div class="cell-name">${x.name}</div><div class="cell-sub">${x.company || 'Sem empresa'} — ${x.phone_fmt}</div></td>
      <td>${x.captured_by_name}</td>
      <td>${fmtDateTime(x.captured_at)}</td>
      <td><select class="select" data-status="${x.id}" aria-label="Status de ${x.name}">${Object.entries(conf.lead_status).filter(([k]) => k !== 'nao_captado').map(([k, l]) => h`<option value="${k}" ${k === x.lead_status ? raw('selected') : ''}>${l}</option>`)}</select></td>
      <td>${x.temperature ? h`<span class="temp-${x.temperature}" style="font-weight:600">${conf.temperatures[x.temperature]}</span>` : h`<span class="muted">—</span>`}</td>
      <td class="cell-sub">${(x.interests || []).join(', ') || '—'}</td></tr>`)}`)
      : String(h`<tr><td colspan="6"><div class="empty"><strong>Nenhum lead captado com esses filtros</strong><span>Os leads aparecem aqui assim que um vendedor captar um participante.</span></div></td></tr>`);
    $('#lpager').textContent = `${fmtInt(r.total)} lead(s)`;
  };
  $('#ltbody').addEventListener('click', (e) => {
    if (e.target.closest('select')) return;
    const tr = e.target.closest('tr[data-id]');
    if (tr) openParticipant(Number(tr.dataset.id), drawerOpts());
  });
  $('#ltbody').addEventListener('change', async (e) => {
    const sel = e.target.closest('[data-status]');
    if (!sel) return;
    try { await api('PATCH', `/api/leads/${sel.dataset.status}`, { lead_status: sel.value }); toast('Status atualizado.', 'ok'); } catch (ex) { toast(ex.message, 'erro'); load(); }
  });
  $('#lq').addEventListener('input', debounce(load, 250));
  ['lstatus', 'lseller', 'ltemp'].forEach((id) => $(`#${id}`).addEventListener('change', load));
  refresh = debounce(load, 800);
  await load();
}

// ================= EQUIPE =================
async function pageEquipe() {
  main.innerHTML = String(h`${head('Equipe', 'Vendedores, recepção e administradores. Cada pessoa usa seu próprio acesso.', h`<button class="btn btn-primary" id="new-user">${icon('plus')}Novo usuário</button>`)}
    <section class="panel"><div class="table-wrap"><table class="data"><thead><tr><th>Nome</th><th>Usuário</th><th>Perfil</th><th>Situação</th><th>Leads</th><th>Último acesso</th><th></th></tr></thead><tbody id="utbody"></tbody></table></div></section>`);
  const load = async () => {
    const r = await api('GET', '/api/users');
    if (current !== 'equipe') return;
    $('#utbody').innerHTML = String(h`${r.items.map((u) => h`<tr data-id="${u.id}" style="cursor:default">
      <td><div class="cell-name">${u.name}</div><div class="cell-sub">${u.email || ''}</div></td>
      <td class="num">${u.username}</td><td>${ROLE[u.role]}</td>
      <td>${u.active ? (u.must_change_password ? h`<span class="chip alerta">Aguardando 1º acesso</span>` : h`<span class="chip ok">Ativo</span>`) : h`<span class="chip neutro">Desativado</span>`}</td>
      <td class="num">${u.role === 'vendedor' ? u.leads : '—'}</td>
      <td class="muted">${u.last_login_at ? fmtRel(u.last_login_at) : 'Nunca'}</td>
      <td style="white-space:nowrap;text-align:right"><button class="btn btn-sm" data-edit="${u.id}">Editar</button> <button class="btn btn-sm" data-reset="${u.id}">${icon('key')}Nova senha</button> <button class="btn btn-sm ${u.active ? 'btn-perigo' : ''}" data-toggle="${u.id}" data-active="${u.active}">${u.active ? 'Desativar' : 'Ativar'}</button></td></tr>`)}`);
    $('#utbody').onclick = async (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const u = r.items.find((x) => x.id === Number(b.dataset.edit || b.dataset.reset || b.dataset.toggle));
      if (b.dataset.edit) userForm(u).then((ok) => ok && load());
      if (b.dataset.reset) {
        if (!(await confirmDialog('Gerar nova senha', `Uma senha temporária será criada para ${u.name}. As sessões abertas dessa pessoa serão encerradas.`, 'Gerar senha'))) return;
        try { const x = await api('POST', `/api/users/${u.id}/reset-password`, {}); showPassword(u, x.temp_password); load(); } catch (ex) { toast(ex.message, 'erro'); }
      }
      if (b.dataset.toggle) {
        const activate = b.dataset.active !== 'true';
        if (!activate && !(await confirmDialog('Desativar acesso', `${u.name} perderá o acesso imediatamente. Os leads captados continuam registrados.`, 'Desativar', true))) return;
        try { await api('PATCH', `/api/users/${u.id}`, { active: activate }); toast(activate ? 'Acesso ativado.' : 'Acesso desativado.', 'ok'); load(); loadRefs(); } catch (ex) { toast(ex.message, 'erro'); }
      }
    };
  };
  $('#new-user').onclick = () => userForm(null).then((ok) => ok && load());
  await load();
}
function showPassword(u, pw) {
  return modal({
    title: 'Senha temporária',
    body: h`<p>Entregue a ${u.name} pessoalmente. A troca é exigida no primeiro acesso e esta senha não será exibida de novo.</p>
      <dl class="kv"><dt>Endereço</dt><dd>${location.origin}/entrar</dd><dt>Usuário</dt><dd class="num">${u.username}</dd><dt>Senha</dt><dd class="num" style="font-size:20px">${pw}</dd></dl>`,
    actions: [{ label: 'Copiar dados', onClick: () => { copyText(`Acesso Mills Seminovos\n${location.origin}/entrar\nUsuário: ${u.username}\nSenha temporária: ${pw}`); return false; } }, { label: 'Concluir', cls: 'btn-primary' }],
  });
}
function userForm(u) {
  return modal({
    title: u ? 'Editar usuário' : 'Novo usuário',
    body: h`<div class="field"><label for="uf-name">Nome completo</label><input class="input" id="uf-name" value="${u ? u.name : ''}"></div>
      ${u ? '' : h`<div class="field"><label for="uf-user">Usuário de acesso</label><input class="input" id="uf-user" autocapitalize="none" placeholder="ex.: joao.silva"><span class="hint">Letras minúsculas, números, ponto ou hífen.</span></div>`}
      <div class="two"><div class="field"><label for="uf-role">Perfil</label><select class="select" id="uf-role">${Object.entries(ROLE).map(([k, l]) => h`<option value="${k}" ${(u ? u.role : 'vendedor') === k ? raw('selected') : ''}>${l}</option>`)}</select></div>
      <div class="field"><label for="uf-phone">Telefone</label><input class="input" id="uf-phone" value="${u && u.phone ? u.phone : ''}"></div></div>
      <div class="field"><label for="uf-email">E-mail</label><input class="input" id="uf-email" value="${u && u.email ? u.email : ''}"></div>
      <span class="err" id="uf-err"></span>`,
    onOpen(ov) {
      if (!u) $('#uf-name', ov).addEventListener('input', (e) => {
        const f = $('#uf-user', ov);
        if (f.dataset.touched) return;
        const parts = e.target.value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z ]/g, '').trim().split(/\s+/).filter(Boolean);
        f.value = parts.length > 1 ? `${parts[0]}.${parts[parts.length - 1]}` : parts[0] || '';
      });
      if (!u) $('#uf-user', ov).addEventListener('input', (e) => { e.target.dataset.touched = '1'; });
    },
    actions: [{ label: 'Cancelar', value: false }, {
      label: u ? 'Salvar' : 'Criar usuário', cls: 'btn-primary', onClick: async (ov) => {
        const body = { name: $('#uf-name', ov).value, role: $('#uf-role', ov).value, phone: $('#uf-phone', ov).value, email: $('#uf-email', ov).value };
        try {
          if (u) { await api('PATCH', `/api/users/${u.id}`, body); toast('Usuário atualizado.', 'ok'); }
          else { const r = await api('POST', '/api/users', { ...body, username: $('#uf-user', ov).value }); setTimeout(() => showPassword(r.user, r.temp_password), 50); }
          loadRefs();
          return true;
        } catch (ex) { $('#uf-err', ov).textContent = ex.message; return false; }
      },
    }],
  });
}

// ================= ESTAÇÕES =================
async function pageEstacoes() {
  main.innerHTML = String(h`${head('Estações e impressoras', 'Cada totem ou notebook com impressora é uma estação. O agente de impressão roda na máquina onde a impressora está ligada.', h`<button class="btn btn-primary" id="new-st">${icon('plus')}Nova estação</button>`)}<div id="st-list"></div>
    <section class="panel"><div class="panel-head"><h2>Últimas impressões</h2><button class="btn btn-sm" id="jobs-reload" style="margin-left:auto">${icon('refresh')}Atualizar</button></div><div class="table-wrap"><table class="data"><thead><tr><th>#</th><th>Participante</th><th>Estação</th><th>Motivo</th><th>Situação</th><th>Quando</th></tr></thead><tbody id="jobs"></tbody></table></div></section>`);
  const presets = (await api('GET', '/api/stations')).presets;
  const field = (id, label, val, attrs = '') => h`<div class="field"><label for="${id}">${label}</label><input class="input" id="${id}" value="${val}" ${raw(attrs)}></div>`;
  const drawStation = (s) => {
    const c = s.label;
    const totemUrl = `${location.origin}/totem?estacao=${s.station_key}`;
    return h`<section class="panel station" data-st="${s.id}">
      <div class="panel-head"><h2>${s.name}</h2><span class="chip neutro">${s.kind === 'totem' ? 'Totem' : 'Recepção'}</span>${s.active ? '' : h`<span class="chip erro">Desativada</span>`}
        <span class="agent-box" style="margin-left:auto"><span class="dot ${s.agent.online ? 'ok' : 'erro'}"></span>${s.agent.online ? `Agente online${s.agent.info && s.agent.info.hostname ? ` em ${s.agent.info.hostname}` : ''}${s.agent.info && s.agent.info.printer ? ` — impressora ${s.agent.info.printer.ok === false ? `com problema: ${s.agent.info.printer.detail}` : 'pronta'}` : ''}` : s.agent.configured ? `Agente offline${s.agent.last_seen ? ` desde ${fmtRel(s.agent.last_seen)}` : ''}` : 'Agente não configurado'}</span></div>
      <div class="panel-body station-body">
        <div class="stack">
          <div class="cfg-grid">
            <div class="field"><label>Nome</label><input class="input" data-k="name" value="${s.name}"></div>
            <div class="field"><label>Tipo</label><select class="select" data-k="kind"><option value="totem" ${s.kind === 'totem' ? raw('selected') : ''}>Totem</option><option value="recepcao" ${s.kind === 'recepcao' ? raw('selected') : ''}>Recepção</option></select></div>
            <div class="field"><label>Contingência</label><select class="select" data-k="fallback_station_id"><option value="">Nenhuma</option>${stations.filter((x) => x.id !== s.id).map((x) => h`<option value="${x.id}" ${x.id === s.fallback_station_id ? raw('selected') : ''}>${x.name}</option>`)}</select></div>
          </div>
          <p class="section-title" style="margin:6px 0 0">Etiqueta</p>
          <div class="cfg-grid">
            <div class="field"><label>Tamanho</label><select class="select" data-l="preset"><option value="">Personalizado</option>${Object.keys(presets).map((p) => h`<option value="${p}" ${c.preset === p ? raw('selected') : ''}>${p.replace('x', ' × ')} mm</option>`)}</select></div>
            ${field(`w${s.id}`, 'Largura (mm)', c.width_mm, 'data-l="width_mm" type="number" step="1"')}
            ${field(`h${s.id}`, 'Altura (mm)', c.height_mm, 'data-l="height_mm" type="number" step="1"')}
            <div class="field"><label>Linguagem</label><select class="select" data-l="language"><option value="zpl" ${c.language === 'zpl' ? raw('selected') : ''}>ZPL (Zebra)</option><option value="tspl" ${c.language === 'tspl' ? raw('selected') : ''}>TSPL (TSC)</option><option value="pdf" ${c.language === 'pdf' ? raw('selected') : ''}>PDF (driver)</option></select></div>
            <div class="field"><label>Resolução</label><select class="select" data-l="dpi">${[203, 300, 600].map((d) => h`<option value="${d}" ${c.dpi === d ? raw('selected') : ''}>${d} dpi</option>`)}</select></div>
            <div class="field"><label>Mídia</label><select class="select" data-l="media"><option value="gap" ${c.media === 'gap' ? raw('selected') : ''}>Com espaço (gap)</option><option value="blackmark" ${c.media === 'blackmark' ? raw('selected') : ''}>Marca preta</option><option value="continuous" ${c.media === 'continuous' ? raw('selected') : ''}>Contínua</option></select></div>
            ${field(`g${s.id}`, 'Espaço entre etiquetas (mm)', c.gap_mm, 'data-l="gap_mm" type="number" step="0.5"')}
            ${field(`m${s.id}`, 'Margem (mm)', c.margin_mm, 'data-l="margin_mm" type="number" step="0.5"')}
            ${field(`d${s.id}`, 'Escurecimento (0–30)', c.darkness, 'data-l="darkness" type="number"')}
            ${field(`s${s.id}`, 'Velocidade', c.speed, 'data-l="speed" type="number"')}
            ${field(`x${s.id}`, 'Ajuste horizontal (pontos)', c.offset_x, 'data-l="offset_x" type="number"')}
            ${field(`y${s.id}`, 'Ajuste vertical (pontos)', c.offset_y, 'data-l="offset_y" type="number"')}
            ${field(`c${s.id}`, 'Cópias', c.copies, 'data-l="copies" type="number" min="1" max="5"')}
          </div>
          <div class="cfg-checks">
            ${[['show_logo', 'Logo'], ['show_company', 'Empresa'], ['show_number', 'Nº da credencial'], ['show_phone', 'Telefone'], ['rotate180', 'Girar 180°']].map(([k, l]) => h`<label class="check"><input type="checkbox" data-l="${k}" ${c[k] ? raw('checked') : ''}><span>${l}</span></label>`)}
          </div>
        </div>
        <div class="stack">
          <p class="section-title" style="margin:0">Pré-visualização (exatamente como sai na impressora)</p>
          <div class="label-preview"><img alt="Pré-visualização da etiqueta" data-prev></div>
          ${s.kind === 'totem' ? h`<div class="field"><span class="label">Link do totem</span><div class="row" style="gap:6px"><input class="input grow" readonly value="${totemUrl}" style="font-size:12.5px"><button class="btn btn-sm" data-act="copy-link" data-v="${totemUrl}">${icon('copy')}Copiar</button></div><span class="hint">Abra uma vez no totem. A chave fica salva no equipamento e some da barra de endereço.</span></div>` : ''}
        </div>
      </div>
      <div class="station-actions">
        <button class="btn btn-primary" data-act="save">Salvar</button>
        <button class="btn" data-act="test">${icon('printer')}Imprimir teste</button>
        <button class="btn" data-act="agent">${icon('key')}${s.agent.configured ? 'Gerar novo token do agente' : 'Configurar agente'}</button>
        ${s.queue.failed_last_hour ? h`<button class="btn" data-act="retry">${icon('refresh')}Reenviar ${s.queue.failed_last_hour} falha(s)</button>` : ''}
        ${s.kind === 'totem' ? h`<button class="btn btn-ghost" data-act="rotate">Renovar link do totem</button>` : ''}
        <button class="btn btn-ghost ${s.active ? 'btn-perigo' : ''}" data-act="toggle" style="margin-left:auto">${s.active ? 'Desativar estação' : 'Ativar estação'}</button>
      </div></section>`;
  };
  const readCfg = (el) => {
    const label = {};
    $$('[data-l]', el).forEach((i) => { label[i.dataset.l] = i.type === 'checkbox' ? i.checked : i.value; });
    return label;
  };
  const previews = new Map();
  const timers = new Map();
  const preview = (el) => { clearTimeout(timers.get(el)); timers.set(el, setTimeout(() => drawPreview(el), 250)); };
  const drawPreview = async (el) => {
    try {
      const res = await fetch('/api/labels/preview', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'mills' }, body: JSON.stringify({ label: readCfg(el) }) });
      if (!res.ok) return;
      const url = URL.createObjectURL(await res.blob());
      const img = $('[data-prev]', el);
      if (previews.get(el)) URL.revokeObjectURL(previews.get(el));
      previews.set(el, url);
      img.src = url;
    } catch { /* ignora */ }
  };
  const loadJobs = async () => {
    const r = await api('GET', '/api/print-jobs');
    if (current !== 'estacoes') return;
    const REASON = { credenciamento: 'Credenciamento', recuperacao_totem: 'Recuperação no totem', reimpressao: 'Reimpressão', teste: 'Teste' };
    $('#jobs').innerHTML = r.items.length ? String(h`${r.items.map((j) => h`<tr style="cursor:default"><td class="num muted">${j.id}</td><td>${j.participant_name || h`<span class="muted">Etiqueta de teste</span>`}</td><td>${j.station_name}${j.requested_station_id && j.requested_station_id !== j.station_id ? h` <span class="chip alerta">contingência</span>` : ''}</td><td>${REASON[j.reason] || j.reason}</td><td>${jobChip(j)}${j.error ? h`<div class="cell-sub" style="color:var(--erro)">${j.error}</div>` : ''}</td><td class="muted">${fmtRel(j.created_at)}</td></tr>`)}`)
      : String(h`<tr><td colspan="6"><div class="empty"><span>Nenhuma impressão ainda. Use “Imprimir teste” para validar cada impressora.</span></div></td></tr>`);
  };
  const load = async () => {
    await loadRefs();
    if (current !== 'estacoes') return;
    const full = (await api('GET', '/api/stations')).items;
    $('#st-list').innerHTML = String(h`${full.map(drawStation)}`);
    $$('.station').forEach((el) => preview(el));
    loadJobs();
  };
  $('#st-list').addEventListener('input', (e) => {
    const el = e.target.closest('.station');
    if (!el || !e.target.dataset.l) return;
    if (e.target.dataset.l === 'preset' && e.target.value) {
      const p = presets[e.target.value];
      $('[data-l="width_mm"]', el).value = p.width_mm; $('[data-l="height_mm"]', el).value = p.height_mm;
    } else if (['width_mm', 'height_mm'].includes(e.target.dataset.l)) $('[data-l="preset"]', el).value = '';
    preview(el);
  });
  $('#st-list').addEventListener('change', (e) => { const el = e.target.closest('.station'); if (el && e.target.dataset.l) preview(el); });
  $('#st-list').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const el = b.closest('.station');
    const id = Number(el.dataset.st);
    const st = stations.find((x) => x.id === id) || {};
    const act = b.dataset.act;
    try {
      if (act === 'copy-link') return copyText(b.dataset.v);
      if (act === 'save') {
        b.setAttribute('aria-busy', 'true');
        await api('PATCH', `/api/stations/${id}`, { name: $('[data-k="name"]', el).value, kind: $('[data-k="kind"]', el).value, fallback_station_id: $('[data-k="fallback_station_id"]', el).value || null, label: readCfg(el) });
        toast('Estação salva.', 'ok'); load();
      }
      if (act === 'test') { const r = await api('POST', `/api/stations/${id}/test-print`, {}); toast(r.job.station_online ? `Teste enviado para ${r.job.station_name}.` : 'Teste na fila: o agente desta estação está offline.', r.job.station_online ? 'ok' : 'alerta'); setTimeout(loadJobs, 1500); }
      if (act === 'retry') { const r = await api('POST', `/api/stations/${id}/retry-failed`, {}); toast(`${r.retried} etiqueta(s) reenviada(s).`, 'ok'); load(); }
      if (act === 'rotate') {
        if (!(await confirmDialog('Renovar link do totem', 'O link atual deixa de funcionar. Será preciso abrir o novo link no totem.', 'Renovar'))) return;
        await api('POST', `/api/stations/${id}/rotate-key`, {}); toast('Novo link gerado.', 'ok'); load();
      }
      if (act === 'toggle') { await api('PATCH', `/api/stations/${id}`, { active: !st.active }); load(); }
      if (act === 'agent') {
        if (st.agent && st.agent.configured && !(await confirmDialog('Gerar novo token', 'O agente que usa o token atual será desconectado até receber o novo config.json.', 'Gerar token'))) return;
        const r = await api('POST', `/api/stations/${id}/agent-token`, {});
        const json = JSON.stringify(r.config, null, 2);
        modal({
          title: `Agente de impressão — ${st.name}`, wide: true,
          body: h`<p>Na máquina onde a impressora está conectada, copie a pasta <b>print-agent</b>, salve o conteúdo abaixo como <b>config.json</b> dentro dela e ajuste o nome da impressora. Depois execute <b>iniciar-agente.bat</b>. Este token aparece só agora.</p>
            <pre class="code">${json}</pre>
            <p class="muted" style="font-size:13px">Tipos de impressora: windows-raw (ZPL/TSPL pelo Windows), windows-pdf (via driver), tcp (rede, porta 9100), cups-raw e cups-pdf (Linux/macOS). Detalhes em docs/03-IMPRESSORA.md.</p>`,
          actions: [{ label: 'Copiar config.json', onClick: () => { copyText(json); return false; } }, { label: 'Concluir', cls: 'btn-primary' }],
        });
        load();
      }
    } catch (ex) { toast(ex.message, 'erro'); } finally { b.removeAttribute('aria-busy'); }
  });
  $('#new-st').onclick = () => modal({
    title: 'Nova estação',
    body: h`<div class="field"><label for="ns-name">Nome</label><input class="input" id="ns-name" placeholder="Ex.: Totem entrada B"></div><div class="field"><label for="ns-kind">Tipo</label><select class="select" id="ns-kind"><option value="totem">Totem</option><option value="recepcao">Recepção (notebook)</option></select></div><span class="err" id="ns-err"></span>`,
    actions: [{ label: 'Cancelar' }, { label: 'Criar', cls: 'btn-primary', onClick: async (ov) => { try { await api('POST', '/api/stations', { name: $('#ns-name', ov).value, kind: $('#ns-kind', ov).value }); load(); return true; } catch (ex) { $('#ns-err', ov).textContent = ex.message; return false; } } }],
  });
  $('#jobs-reload').onclick = loadJobs;
  refresh = debounce(loadJobs, 800);
  await load();
}

// ================= CONFIGURAÇÕES =================
async function pageConfig() {
  const { settings: s } = await api('GET', '/api/admin/settings');
  const interests = JSON.parse(s.interests || '[]').join('\n');
  const promos = JSON.parse(s.promo_items || '[]').join('\n');
  main.innerHTML = String(h`${head('Configurações', 'Vitrine do totem, privacidade e regras da inauguração.')}
    <form class="settings" id="cfg">
      <section class="panel"><div class="panel-head"><h2>Inauguração e totem</h2></div><div class="panel-body">
        <div class="two"><div class="field"><label for="c-event_name">Nome da inauguração</label><input class="input" id="c-event_name" value="${s.event_name}"></div>
        <div class="field"><label for="c-event_place">Local ou data</label><input class="input" id="c-event_place" value="${s.event_place}"></div></div>
        <div class="two"><div class="field"><label for="c-welcome_kicker">Selo</label><input class="input" id="c-welcome_kicker" value="${s.welcome_kicker}"></div>
        <div class="field"><label for="c-welcome_title">Título principal</label><input class="input" id="c-welcome_title" value="${s.welcome_title}"></div></div>
        <div class="field"><label for="c-welcome_highlight">Faixa de destaque</label><input class="input" id="c-welcome_highlight" value="${s.welcome_highlight}"></div>
        <div class="field"><label for="c-promo_items">Condições e ofertas (uma por linha)</label><textarea class="textarea" id="c-promo_items">${promos}</textarea><span class="hint">As três primeiras aparecem em lista na tela inicial; todas passam na faixa animada. Confirme as condições com o comercial antes de publicar.</span></div>
        <div class="field"><label for="c-welcome_text">Chamada para o credenciamento</label><textarea class="textarea" id="c-welcome_text">${s.welcome_text}</textarea></div>
        <div class="two"><div class="field"><label for="c-totem_return_seconds">Volta automática ao início (segundos)</label><input class="input" type="number" min="4" max="120" id="c-totem_return_seconds" value="${s.totem_return_seconds}"></div>
        <div class="field"><label for="c-timezone">Fuso horário</label><select class="select" id="c-timezone">${['America/Sao_Paulo', 'America/Manaus', 'America/Cuiaba', 'America/Belem', 'America/Fortaleza', 'America/Recife', 'America/Bahia', 'America/Rio_Branco', 'America/Noronha'].map((z) => h`<option ${z === s.timezone ? raw('selected') : ''}>${z}</option>`)}</select></div></div>
      </div></section>
      <section class="panel"><div class="panel-head"><h2>Privacidade (LGPD)</h2><span class="chip neutro">Versão ${s.privacy_version}</span></div><div class="panel-body">
        <div class="field"><label for="c-privacy_text">Aviso de privacidade exibido no credenciamento</label><textarea class="textarea" id="c-privacy_text" style="min-height:150px">${s.privacy_text}</textarea><span class="hint">Ao alterar o texto, a versão sobe automaticamente e cada aceite registra a versão vigente. Recomendado validar com o jurídico/DPO da Mills.</span></div>
        <div class="field"><label for="c-marketing_text">Texto do aceite opcional de ofertas</label><input class="input" id="c-marketing_text" value="${s.marketing_text}"></div>
        <div class="field"><label for="c-retention_days">Retenção dos dados pessoais (dias após o cadastro)</label><input class="input" type="number" min="1" id="c-retention_days" value="${s.retention_days}" style="max-width:180px"><span class="hint">Depois desse prazo os cadastros são anonimizados automaticamente.</span></div>
      </div></section>
      <section class="panel"><div class="panel-head"><h2>Vendedores</h2></div><div class="panel-body">
        <div class="field"><label for="c-interests">Interesses para qualificação (um por linha)</label><textarea class="textarea" id="c-interests" style="min-height:130px">${interests}</textarea></div>
        <label class="check"><input type="checkbox" id="c-sellers_see_unclaimed_count" ${s.sellers_see_unclaimed_count === 'true' ? raw('checked') : ''}><span>Mostrar aos vendedores quantos participantes ainda não foram captados</span></label>
      </div></section>
      <div class="row"><button class="btn btn-primary btn-lg" type="submit">Salvar configurações</button></div>
    </form>`);
  $('#cfg').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {};
    body.promo_items = $('#c-promo_items').value.split('\n');
    for (const k of ['event_name', 'event_place', 'welcome_kicker', 'welcome_title', 'welcome_highlight', 'welcome_text', 'totem_return_seconds', 'timezone', 'privacy_text', 'marketing_text', 'retention_days']) body[k] = $(`#c-${k}`).value;
    body.interests = $('#c-interests').value.split('\n');
    body.sellers_see_unclaimed_count = $('#c-sellers_see_unclaimed_count').checked ? 'true' : 'false';
    try {
      const r = await api('PUT', '/api/admin/settings', body);
      toast(r.changed.length ? 'Configurações salvas. Os totens recebem a mudança em até 20 segundos.' : 'Nada foi alterado.', 'ok');
      conf = await api('GET', '/api/app/config');
      setTimezone(conf.timezone);
      $('#event-name').textContent = conf.event_name;
      pageConfig();
    } catch (ex) { toast(ex.message, 'erro'); }
  });
}

// ================= AUDITORIA =================
const ACTIONS = {
  login: 'Entrou no sistema', logout: 'Saiu', login_falhou: 'Tentativa de login recusada', senha_alterada: 'Alterou a própria senha', senha_redefinida: 'Senha redefinida',
  usuario_criado: 'Usuário criado', usuario_editado: 'Usuário editado', lead_captado: 'Lead captado', lead_reatribuido: 'Lead reatribuído', status_lead: 'Status do lead alterado',
  participante_editado: 'Participante editado', participante_anonimizado: 'Dados pessoais excluídos', etiqueta_reimpressa: 'Etiqueta reimpressa', etiqueta_recuperada: 'Etiqueta recuperada no totem',
  credenciamento_recepcao: 'Credenciamento na recepção', estacao_criada: 'Estação criada', estacao_editada: 'Estação editada', token_agente_gerado: 'Token do agente gerado', link_totem_renovado: 'Link do totem renovado',
  configuracoes_alteradas: 'Configurações alteradas', exportacao: 'Exportação de dados', backup_manual: 'Backup manual', backup_baixado: 'Backup baixado', retencao_aplicada: 'Política de retenção aplicada',
  impressoes_reenviadas: 'Impressões reenviadas', administrador_inicial_criado: 'Administrador inicial criado',
};
async function pageAuditoria() {
  main.innerHTML = String(h`${head('Auditoria', 'Registro das ações administrativas e de acesso a dados.')}
    <section class="panel"><div class="filters">${searchBox('aq', 'Filtrar por ação ou pessoa')}</div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Quando</th><th>Quem</th><th>Ação</th><th>Detalhes</th><th>IP</th></tr></thead><tbody id="atbody"></tbody></table></div><div class="pager" id="apager"></div></section>`);
  let offset = 0;
  const load = async () => {
    const r = await api('GET', `/api/admin/audit?limit=50&offset=${offset}&q=${encodeURIComponent($('#aq').value.trim())}`);
    if (current !== 'auditoria') return;
    $('#atbody').innerHTML = String(h`${r.items.map((a) => h`<tr style="cursor:default"><td class="muted" style="white-space:nowrap">${fmtDateTime(a.at)}</td><td>${a.actor}</td><td>${ACTIONS[a.action] || a.action}${a.entity_id ? h` <span class="muted">#${a.entity_id}</span>` : ''}</td><td class="cell-sub" style="max-width:360px;overflow-wrap:anywhere">${a.details ? JSON.stringify(a.details) : ''}</td><td class="muted num">${a.ip || ''}</td></tr>`)}`);
    $('#apager').innerHTML = String(h`<span>${r.total} registro(s)</span><button class="btn btn-sm" id="aprev" ${offset === 0 ? raw('disabled') : ''}>Anterior</button><button class="btn btn-sm" id="anext" ${offset + 50 >= r.total ? raw('disabled') : ''}>Próxima</button>`);
    $('#aprev').onclick = () => { offset = Math.max(0, offset - 50); load(); };
    $('#anext').onclick = () => { offset += 50; load(); };
  };
  $('#aq').addEventListener('input', debounce(() => { offset = 0; load(); }, 300));
  await load();
}

// ================= BACKUPS E LGPD =================
async function pageBackups() {
  main.innerHTML = String(h`${head('Backups e LGPD', 'Cópias do banco de dados e política de retenção.', h`<button class="btn btn-primary" id="bk-now">${icon('database')}Gerar backup agora</button>`)}
    <div class="grid-2b"><section class="panel"><div class="panel-head"><h2>Backups</h2></div><div class="panel-body" id="bk"></div></section>
    <section class="panel"><div class="panel-head"><h2>Retenção de dados pessoais</h2></div><div class="panel-body stack" id="ret"></div></section></div>`);
  const load = async () => {
    const r = await api('GET', '/api/admin/backups');
    const { settings } = await api('GET', '/api/admin/settings');
    if (current !== 'backups') return;
    $('#bk').innerHTML = String(h`<p class="muted" style="margin-bottom:12px">Automático a cada ${r.interval_min} minutos quando há mudanças, e ao encerrar o servidor. Pasta: <span class="num">${r.dir}</span>${r.extra_dir ? h`. Cópia extra em <span class="num">${r.extra_dir}</span>` : '. Configure BACKUP_EXTRA_DIR no .env para manter uma cópia fora desta máquina.'}</p>
      ${r.items.length ? h`<div class="table-wrap"><table class="data"><thead><tr><th>Arquivo</th><th>Tamanho</th><th>Data</th><th></th></tr></thead><tbody>${r.items.slice(0, 30).map((b) => h`<tr style="cursor:default"><td class="num" style="font-size:12.5px">${b.name}</td><td class="num">${(b.size / 1024).toFixed(0)} KB</td><td class="muted">${fmtDateTime(b.at)}</td><td><a class="btn btn-sm" href="/api/admin/backups/${encodeURIComponent(b.name)}">${icon('download')}Baixar</a></td></tr>`)}</tbody></table></div>` : h`<div class="empty"><span>Nenhum backup ainda.</span></div>`}`);
    $('#ret').innerHTML = String(h`<p>Prazo atual: <b>${settings.retention_days} dias</b> após o cadastro. Depois disso, nome, telefone, e-mail, empresa e observações são apagados automaticamente; os números agregados da inauguração permanecem.</p>
      <p class="muted">Pedidos individuais de exclusão são atendidos na ficha do participante, em Excluir dados (LGPD).</p>
      <div class="row"><button class="btn" id="ret-sim">Simular</button><button class="btn btn-perigo" id="ret-apply">Aplicar agora</button><a class="btn btn-ghost" href="#configuracoes">Alterar prazo</a></div><p id="ret-out" class="muted"></p>`);
    $('#ret-sim').onclick = async () => { const x = await api('POST', '/api/admin/retention', { dry_run: true }); $('#ret-out').textContent = `${x.affected} cadastro(s) seriam anonimizados agora.`; };
    $('#ret-apply').onclick = async () => {
      if (!(await confirmDialog('Aplicar retenção', 'Cadastros mais antigos que o prazo terão os dados pessoais apagados de forma permanente.', 'Aplicar', true))) return;
      const x = await api('POST', '/api/admin/retention', {}); toast(`${x.affected} cadastro(s) anonimizados.`, 'ok'); load();
    };
  };
  $('#bk-now').onclick = async () => { try { const r = await api('POST', '/api/admin/backups', {}); toast(`Backup criado: ${r.name}`, 'ok'); load(); } catch (ex) { toast(ex.message, 'erro'); } };
  await load();
}

// ---------- Tempo real ----------
const feedEvent = () => refresh();
live({
  'participant:new': feedEvent, 'participant:update': feedEvent, 'lead:captured': feedEvent, 'lead:update': feedEvent, 'lead:assigned': feedEvent,
  'job:update': feedEvent, 'station:update': feedEvent,
}, (on) => { $('#live').className = `live${on ? '' : ' off'}`; $('#live').lastChild.textContent = on ? 'Ao vivo' : 'Atualizando a cada 15 s'; }, { poll: () => refresh() });
setInterval(() => { if (current === 'painel') refresh(); }, 30000);
route();
