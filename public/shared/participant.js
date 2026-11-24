import { h, $, api, toast, modal, drawer, confirmDialog, fmtDateTime, fmtRel, statusChip, icon, raw } from '/shared/app.js';

const V = window.MSValidation;
const SOURCE = { totem: 'Totem', recepcao: 'Recepção', admin: 'Painel' };
const REASON = { credenciamento: 'credenciamento', recuperacao_totem: 'recuperação no totem', reimpressao: 'reimpressão', teste: 'teste' };

export function eventText(e) {
  const d = e.data || {};
  switch (e.type) {
    case 'credenciado': return `Credenciado ${d.origem ? `pelo ${SOURCE[d.origem] || d.origem}` : ''}`;
    case 'captado': return `Lead captado por ${e.user_name || d.vendedor || 'vendedor'}`;
    case 'qr_lido': return `Credencial lida por ${e.user_name || 'vendedor'}`;
    case 'etiqueta_impressa': return `Etiqueta impressa (${REASON[d.motivo] || d.motivo || 'impressão'})`;
    case 'dados_editados': return `Dados editados por ${e.user_name || 'equipe'}`;
    case 'lead_reatribuido': return `Lead ${d.para ? `atribuído a ${d.para}` : 'liberado'}${d.de ? ` (antes: ${d.de})` : ''}${d.motivo ? ` — ${d.motivo}` : ''}`;
    case 'lead_atualizado': {
      const parts = [];
      if (d.lead_status) parts.push(`status: ${STATUS_LABEL[d.lead_status.para] || d.lead_status.para}`);
      if (d.temperature) parts.push(`temperatura: ${d.temperature.para || '—'}`);
      if (d.interests) parts.push('interesses atualizados');
      if (d.notes) parts.push('observações atualizadas');
      return `${e.user_name || 'Equipe'} atualizou ${parts.join(', ')}`;
    }
    default: return e.type;
  }
}
let STATUS_LABEL = {};
export const setStatusLabels = (m) => { STATUS_LABEL = m; };

const JOB = { pendente: ['alerta', 'Na fila'], imprimindo: ['alerta', 'Imprimindo'], impresso: ['ok', 'Impressa'], falhou: ['erro', 'Falhou'], cancelado: ['neutro', 'Cancelada'] };
export const jobChip = (j) => { const [c, l] = JOB[j.status] || ['neutro', j.status]; return h`<span class="chip ${c}">${l}</span>`; };

/** Abre a gaveta de detalhes. opts: { admin, stations, defaultStationId, sellers, statusMap, onChange } */
export function openParticipant(id, opts = {}) {
  return drawer(async (panel, close) => {
    panel.innerHTML = String(h`<header><div class="grow"><div class="skeleton" style="width:60%;height:22px"></div></div></header><div class="body"><div class="skeleton" style="height:120px"></div></div>`);
    let data;
    try { data = await api('GET', `/api/participants/${id}`); } catch (e) { toast(e.message, 'erro'); close(); return; }
    const p = data.participant;
    let stationId = opts.defaultStationId || (opts.stations && opts.stations[0] && opts.stations[0].id);

    const draw = () => {
      panel.innerHTML = String(h`
      <header>
        <div class="grow" style="min-width:0">
          <h2 style="font-size:21px">${p.name}</h2>
          <p class="muted" style="margin-top:4px">${p.company || 'Sem empresa informada'}</p>
          <div class="row" style="margin-top:10px;gap:8px">${statusChip(p.lead_status, p.lead_status_label)}
            ${p.captured_by_name ? h`<span class="chip neutro">${icon('user')}${p.captured_by_name}</span>` : ''}
            <span class="chip neutro num">nº ${String(p.seq).padStart(4, '0')}</span></div>
        </div>
        <button class="btn btn-ghost btn-sm" data-a="close" aria-label="Fechar">${icon('x')}</button>
      </header>
      <div class="body">
        <dl class="kv">
          <dt>Telefone</dt><dd>${p.phone_fmt} <a class="btn btn-ghost btn-sm" href="https://wa.me/55${p.phone}" target="_blank" rel="noopener">${icon('whatsapp')}WhatsApp</a></dd>
          <dt>E-mail</dt><dd><a href="mailto:${p.email}">${p.email}</a></dd>
          <dt>Credenciado em</dt><dd>${fmtDateTime(p.created_at)} — ${SOURCE[p.source] || p.source}</dd>
          <dt>Código</dt><dd class="num">${p.code}</dd>
          <dt>Privacidade</dt><dd>${p.privacy_ack_at ? `Aceite v${p.privacy_version || '1'} em ${fmtDateTime(p.privacy_ack_at)}` : '—'}</dd>
          <dt>Aceita ofertas</dt><dd>${p.marketing_opt_in ? 'Sim' : 'Não'}</dd>
          ${p.captured_at ? h`<dt>Captado em</dt><dd>${fmtDateTime(p.captured_at)}</dd>` : ''}
          ${p.temperature ? h`<dt>Temperatura</dt><dd class="temp-${p.temperature}">${{ quente: 'Quente', morno: 'Morno', frio: 'Frio' }[p.temperature]}</dd>` : ''}
          ${p.interests && p.interests.length ? h`<dt>Interesses</dt><dd>${p.interests.join(', ')}</dd>` : ''}
          ${p.notes ? h`<dt>Observações</dt><dd style="white-space:pre-wrap">${p.notes}</dd>` : ''}
          <dt>Etiquetas</dt><dd>${p.print_count} impressa(s)${p.last_printed_at ? `, última ${fmtRel(p.last_printed_at)}` : ''}</dd>
        </dl>

        <div>
          <p class="section-title">Etiqueta</p>
          <div class="label-preview"><img alt="Pré-visualização da etiqueta" src="/api/participants/${p.id}/label.png?station_id=${stationId || ''}&t=${Date.now()}"></div>
          <div class="row" style="margin-top:12px">
            <select class="select" id="pd-station" style="max-width:240px" aria-label="Estação de impressão">
              ${(opts.stations || []).map((s) => h`<option value="${s.id}" ${s.id === stationId ? raw('selected') : ''}>${s.name}${s.agent.online ? '' : ' (offline)'}</option>`)}
            </select>
            <button class="btn btn-primary" data-a="print">${icon('printer')}Reimprimir</button>
          </div>
        </div>

        <div class="row">
          <button class="btn" data-a="edit">${icon('edit')}Editar dados</button>
          ${opts.admin ? h`<button class="btn" data-a="assign">${icon('users')}${p.captured_by ? 'Reatribuir lead' : 'Atribuir a vendedor'}</button>` : ''}
          ${opts.admin && p.captured_by ? h`<button class="btn" data-a="status">Alterar status</button>` : ''}
          ${opts.admin ? h`<button class="btn btn-perigo" data-a="anon">${icon('shield')}Excluir dados (LGPD)</button>` : ''}
        </div>

        ${data.jobs.length ? h`<div><p class="section-title">Impressões</p><div class="stack" style="gap:6px">${data.jobs.slice(0, 6).map((j) => h`<div class="row" style="font-size:13.5px;gap:8px">${jobChip(j)}<span>${j.station_name || ''}</span><span class="muted">${fmtDateTime(j.created_at)}</span>${j.error ? h`<span class="muted" style="color:var(--erro)">${j.error}</span>` : ''}</div>`)}</div></div>` : ''}

        <div class="timeline"><p class="section-title">Histórico</p><ul>${data.history.map((e) => h`<li><span></span><div>${eventText(e)}<time>${fmtDateTime(e.at)}</time></div></li>`)}</ul></div>
      </div>`);
    };
    draw();

    panel.addEventListener('change', (e) => {
      if (e.target.id === 'pd-station') {
        stationId = Number(e.target.value);
        $('.label-preview img', panel).src = `/api/participants/${p.id}/label.png?station_id=${stationId}&t=${Date.now()}`;
      }
    });
    panel.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-a]');
      if (!btn) return;
      const a = btn.dataset.a;
      if (a === 'close') return close();
      if (a === 'print') {
        btn.setAttribute('aria-busy', 'true');
        try {
          const r = await api('POST', `/api/participants/${p.id}/print`, { station_id: stationId });
          toast(r.job.redirected ? `Impressora offline: etiqueta enviada para ${r.job.station_name}.` : `Etiqueta enviada para ${r.job.station_name}.`, r.job.station_online ? 'ok' : 'alerta');
          opts.onChange && opts.onChange();
        } catch (ex) { toast(ex.message, 'erro'); } finally { btn.removeAttribute('aria-busy'); }
      }
      if (a === 'edit') {
        const ok = await editParticipant(p);
        if (ok) { Object.assign(p, ok); draw(); opts.onChange && opts.onChange(); }
      }
      if (a === 'assign') {
        const r = await modal({
          title: p.captured_by ? 'Reatribuir lead' : 'Atribuir a vendedor',
          body: h`<div class="field"><label for="as-user">Vendedor responsável</label><select class="select" id="as-user"><option value="">Nenhum (liberar lead)</option>${(opts.sellers || []).map((s) => h`<option value="${s.id}" ${s.id === p.captured_by ? raw('selected') : ''}>${s.name}</option>`)}</select></div>
                  <div class="field"><label for="as-reason">Motivo</label><input class="input" id="as-reason" placeholder="Ex.: cliente já atendido por outro consultor"></div>`,
          actions: [{ label: 'Cancelar', value: null }, {
            label: 'Salvar', cls: 'btn-primary', onClick: async (ov) => {
              try {
                const res = await api('POST', `/api/leads/${p.id}/assign`, { user_id: $('#as-user', ov).value ? Number($('#as-user', ov).value) : null, reason: $('#as-reason', ov).value });
                return res.participant;
              } catch (ex) { toast(ex.message, 'erro'); return false; }
            },
          }],
        });
        if (r) { Object.assign(p, r); toast('Atribuição atualizada.', 'ok'); const d2 = await api('GET', `/api/participants/${p.id}`); data.history = d2.history; draw(); opts.onChange && opts.onChange(); }
      }
      if (a === 'status') {
        const map = opts.statusMap || {};
        const r = await modal({
          title: 'Status comercial',
          body: h`<div class="field"><label for="st-sel">Status</label><select class="select" id="st-sel">${Object.entries(map).filter(([k]) => k !== 'nao_captado').map(([k, l]) => h`<option value="${k}" ${k === p.lead_status ? raw('selected') : ''}>${l}</option>`)}</select></div>`,
          actions: [{ label: 'Cancelar', value: null }, {
            label: 'Salvar', cls: 'btn-primary', onClick: async (ov) => {
              try { return (await api('PATCH', `/api/leads/${p.id}`, { lead_status: $('#st-sel', ov).value })).participant; } catch (ex) { toast(ex.message, 'erro'); return false; }
            },
          }],
        });
        if (r) { Object.assign(p, r); const d2 = await api('GET', `/api/participants/${p.id}`); data.history = d2.history; draw(); opts.onChange && opts.onChange(); }
      }
      if (a === 'anon') {
        const ok = await confirmDialog('Excluir dados pessoais', `Os dados pessoais de ${p.name} serão apagados de forma permanente (nome, telefone, e-mail, empresa e observações). Os números agregados da inauguração são mantidos. Use para atender pedidos do titular (LGPD).`, 'Excluir dados', true);
        if (!ok) return;
        try { await api('DELETE', `/api/participants/${p.id}`, { reason: 'solicitacao_titular' }); toast('Dados pessoais excluídos.', 'ok'); close(); opts.onChange && opts.onChange(); } catch (ex) { toast(ex.message, 'erro'); }
      }
    });
  });
}

export function editParticipant(p) {
  return modal({
    title: 'Editar dados',
    body: h`<div class="field"><label for="ed-name">Nome completo</label><input class="input" id="ed-name" value="${p.name}"><span class="err" id="ed-e-name"></span></div>
      <div class="field"><label for="ed-phone">Telefone</label><input class="input" id="ed-phone" value="${p.phone_fmt}"><span class="err" id="ed-e-phone"></span></div>
      <div class="field"><label for="ed-email">E-mail</label><input class="input" id="ed-email" value="${p.email}"><span class="err" id="ed-e-email"></span></div>
      <div class="field"><label for="ed-company">Empresa</label><input class="input" id="ed-company" value="${p.company || ''}"></div>
      <label class="check"><input type="checkbox" id="ed-mkt" ${p.marketing_opt_in ? raw('checked') : ''}><span>Aceita receber ofertas</span></label>
      <span class="err" id="ed-err"></span>`,
    onOpen(ov) { $('#ed-phone', ov).addEventListener('input', (e) => { e.target.value = V.maskPhoneInput(e.target.value); }); },
    actions: [{ label: 'Cancelar', value: null }, {
      label: 'Salvar', cls: 'btn-primary', onClick: async (ov) => {
        ['name', 'phone', 'email'].forEach((k) => { $(`#ed-e-${k}`, ov).textContent = ''; });
        try {
          const r = await api('PATCH', `/api/participants/${p.id}`, {
            name: $('#ed-name', ov).value, phone: $('#ed-phone', ov).value, email: $('#ed-email', ov).value,
            company: $('#ed-company', ov).value, marketing_opt_in: $('#ed-mkt', ov).checked,
          });
          toast('Dados atualizados.', 'ok');
          return r.participant;
        } catch (ex) {
          if (ex.data && ex.data.errors) for (const [k, m] of Object.entries(ex.data.errors)) { const el = $(`#ed-e-${k}`, ov); if (el) el.textContent = m; }
          else $('#ed-err', ov).textContent = ex.message;
          return false;
        }
      },
    }],
  });
}
