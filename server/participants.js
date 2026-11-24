'use strict';
const { one, all, run, tx, now, audit } = require('./db');
const V = require('../public/shared/validation');
const { participantCode } = require('./security');
const realtime = require('./realtime');

const LEAD_STATUS = {
  nao_captado: 'Não captado',
  novo: 'Novo lead',
  em_contato: 'Em contato',
  em_negociacao: 'Em negociação',
  oportunidade: 'Oportunidade qualificada',
  venda: 'Venda realizada',
  sem_interesse: 'Sem interesse',
};
const TEMPERATURES = { quente: 'Quente', morno: 'Morno', frio: 'Frio' };

const sellerName = (id) => (id ? (one('SELECT name FROM users WHERE id=?', id) || {}).name || 'Usuário removido' : null);

function validateInput(input) {
  const errors = {};
  const name = V.normalizeName(input.name);
  const phone = V.normalizePhone(input.phone);
  const email = V.normalizeEmail(input.email);
  const company = V.normalizeCompany(input.company);
  if (!name.ok) errors.name = name.error;
  if (!phone.ok) errors.phone = phone.error;
  if (!email.ok) errors.email = email.error;
  return { errors, values: { name: name.value, phone: phone.value, email: email.value, company: company.value } };
}

/** Visão completa (admin e recepção). */
function fullView(p) {
  if (!p) return null;
  return {
    id: p.id, seq: p.seq, code: p.code, name: p.name, phone: p.phone, phone_fmt: V.formatPhone(p.phone || ''),
    email: p.email, company: p.company, source: p.source, station_id: p.station_id,
    created_at: p.created_at, updated_at: p.updated_at,
    marketing_opt_in: !!p.marketing_opt_in, privacy_ack_at: p.privacy_ack_at, privacy_version: p.privacy_version,
    captured_by: p.captured_by, captured_by_name: sellerName(p.captured_by), captured_at: p.captured_at,
    lead_status: p.lead_status, lead_status_label: LEAD_STATUS[p.lead_status] || p.lead_status,
    temperature: p.temperature, interests: p.interests ? JSON.parse(p.interests) : [], notes: p.notes,
    print_count: p.print_count, last_printed_at: p.last_printed_at, anonymized: !!p.anonymized_at,
  };
}

/**
 * Visão do vendedor: dados completos quando o participante está livre (ele apresentou a credencial)
 * ou quando o lead é dele. Lead de outro vendedor: só nome, empresa e responsável.
 */
function sellerView(p, user) {
  const f = fullView(p);
  const mine = p.captured_by === user.id;
  const free = !p.captured_by;
  const base = {
    id: f.id, seq: f.seq, code: f.code, name: f.name, company: f.company, created_at: f.created_at,
    lead_status: f.lead_status, lead_status_label: f.lead_status_label,
    captured_by_name: f.captured_by_name, captured_at: f.captured_at,
    ownership: mine ? 'mine' : free ? 'free' : 'other',
  };
  if (mine || free) Object.assign(base, { phone: f.phone, phone_fmt: f.phone_fmt, email: f.email, marketing_opt_in: f.marketing_opt_in });
  if (mine) Object.assign(base, { temperature: f.temperature, interests: f.interests, notes: f.notes });
  return base;
}

function publishParticipant(event, p) {
  const v = fullView(p);
  realtime.publish(event, v, { roles: ['admin', 'recepcao'] });
  realtime.publish('counts', countsPayload(), { roles: ['vendedor'] });
}

function countsPayload() {
  const r = one("SELECT COUNT(*) total, SUM(captured_by IS NOT NULL) captados FROM participants WHERE anonymized_at IS NULL");
  return { total: r.total || 0, captados: r.captados || 0, livres: (r.total || 0) - (r.captados || 0) };
}

/**
 * Cadastro com proteção contra duplicidade (telefone e e-mail).
 * Retorna: { status: 'created' | 'existing' | 'conflict' | 'invalid', participant?, matches?, errors? }
 */
function register({ input, source, stationId = null, user = null, clientRef = null, marketing = false, privacyVersion = null }) {
  if (clientRef) {
    const prev = one('SELECT * FROM participants WHERE client_ref=?', clientRef);
    if (prev) return { status: 'created', participant: prev, replay: true };
  }
  const { errors, values } = validateInput(input);
  if (Object.keys(errors).length) return { status: 'invalid', errors };

  return tx(() => {
    const byPhone = one('SELECT * FROM participants WHERE phone=? AND anonymized_at IS NULL', values.phone);
    const byEmail = one('SELECT * FROM participants WHERE email=? AND anonymized_at IS NULL', values.email);
    if (byPhone && byEmail && byPhone.id === byEmail.id) return { status: 'existing', participant: byPhone };
    if (byPhone || byEmail) {
      return { status: 'conflict', matches: { phone: byPhone || null, email: byEmail || null } };
    }
    let code;
    for (let i = 0; i < 10; i++) { code = participantCode(); if (!one('SELECT 1 FROM participants WHERE code=?', code)) break; }
    const seq = (one('SELECT COALESCE(MAX(seq),0)+1 n FROM participants').n);
    const t = now();
    const r = run(`INSERT INTO participants(code, seq, name, phone, email, company, privacy_ack_at, privacy_version, marketing_opt_in,
                   source, station_id, created_by, client_ref, created_at, updated_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      code, seq, values.name, values.phone, values.email, values.company, t, privacyVersion, marketing ? 1 : 0,
      source, stationId, user ? user.id : null, clientRef, t, t);
    const p = one('SELECT * FROM participants WHERE id=?', r.lastInsertRowid);
    run("INSERT INTO lead_events(participant_id,user_id,type,data,at) VALUES (?,?, 'credenciado', ?, ?)",
      p.id, user ? user.id : null, JSON.stringify({ origem: source, estacao: stationId }), t);
    publishParticipant('participant:new', p);
    return { status: 'created', participant: p };
  });
}

/** Captação atômica: só um vendedor consegue captar o mesmo participante. */
function capture(participantId, user, ip) {
  return tx(() => {
    const p = one('SELECT * FROM participants WHERE id=? AND anonymized_at IS NULL', participantId);
    if (!p) return { status: 404 };
    if (p.captured_by === user.id) return { status: 200, already: true, participant: p };
    if (p.captured_by) return { status: 409, participant: p };
    const t = now();
    const r = run("UPDATE participants SET captured_by=?, captured_at=?, lead_status='novo', updated_at=? WHERE id=? AND captured_by IS NULL",
      user.id, t, t, participantId);
    if (r.changes !== 1) return { status: 409, participant: one('SELECT * FROM participants WHERE id=?', participantId) };
    run("INSERT INTO lead_events(participant_id,user_id,type,data,at) VALUES (?,?, 'captado', ?, ?)",
      participantId, user.id, JSON.stringify({ vendedor: user.name }), t);
    audit({ user, action: 'lead_captado', entity: 'participante', entityId: participantId, ip });
    const updated = one('SELECT * FROM participants WHERE id=?', participantId);
    realtime.publish('lead:captured', fullView(updated), { roles: ['admin', 'recepcao'] });
    realtime.publish('lead:captured', sellerView(updated, user), { userIds: [user.id] });
    realtime.publish('counts', countsPayload(), { roles: ['vendedor'] });
    return { status: 201, participant: updated };
  });
}

function updateLead(participantId, user, patch, ip) {
  const p = one('SELECT * FROM participants WHERE id=? AND anonymized_at IS NULL', participantId);
  if (!p) return { status: 404 };
  if (user.role === 'vendedor' && p.captured_by !== user.id) return { status: 403 };
  if (!p.captured_by) return { status: 400, error: 'Capte o lead antes de qualificá-lo.' };
  const changes = {};
  if (patch.lead_status !== undefined) {
    if (!LEAD_STATUS[patch.lead_status] || patch.lead_status === 'nao_captado') return { status: 400, error: 'Status inválido.' };
    if (patch.lead_status !== p.lead_status) changes.lead_status = [p.lead_status, patch.lead_status];
  }
  if (patch.temperature !== undefined) {
    const t = patch.temperature || null;
    if (t && !TEMPERATURES[t]) return { status: 400, error: 'Temperatura inválida.' };
    if (t !== p.temperature) changes.temperature = [p.temperature, t];
  }
  if (patch.interests !== undefined) {
    const arr = Array.isArray(patch.interests) ? patch.interests.map((s) => String(s).slice(0, 60)).slice(0, 12) : [];
    const json = JSON.stringify(arr);
    if (json !== (p.interests || '[]')) changes.interests = [p.interests ? JSON.parse(p.interests) : [], arr];
  }
  if (patch.notes !== undefined) {
    const n = String(patch.notes || '').slice(0, 2000) || null;
    if (n !== p.notes) changes.notes = [p.notes, n];
  }
  if (!Object.keys(changes).length) return { status: 200, participant: p };
  const t = now();
  const sets = Object.keys(changes).map((k) => `${k}=?`).join(', ');
  const vals = Object.keys(changes).map((k) => (k === 'interests' ? JSON.stringify(changes[k][1]) : changes[k][1]));
  run(`UPDATE participants SET ${sets}, updated_at=? WHERE id=?`, ...vals, t, participantId);
  const evData = {};
  for (const [k, [a, b]] of Object.entries(changes)) evData[k] = k === 'notes' ? 'atualizadas' : { de: a, para: b };
  run("INSERT INTO lead_events(participant_id,user_id,type,data,at) VALUES (?,?, 'lead_atualizado', ?, ?)", participantId, user.id, JSON.stringify(evData), t);
  if (changes.lead_status) audit({ user, action: 'status_lead', entity: 'participante', entityId: participantId, details: evData.lead_status, ip });
  const updated = one('SELECT * FROM participants WHERE id=?', participantId);
  realtime.publish('lead:update', fullView(updated), { roles: ['admin'] });
  if (updated.captured_by) {
    const owner = one('SELECT * FROM users WHERE id=?', updated.captured_by);
    if (owner) realtime.publish('lead:update', sellerView(updated, owner), { userIds: [owner.id] });
  }
  return { status: 200, participant: updated };
}

function assignLead(participantId, admin, toUserId, reason, ip) {
  const p = one('SELECT * FROM participants WHERE id=? AND anonymized_at IS NULL', participantId);
  if (!p) return { status: 404 };
  let to = null;
  if (toUserId) {
    to = one("SELECT * FROM users WHERE id=? AND role IN ('vendedor','admin')", toUserId);
    if (!to) return { status: 400, error: 'Vendedor não encontrado.' };
  }
  const t = now();
  const from = p.captured_by;
  if (to) run("UPDATE participants SET captured_by=?, captured_at=COALESCE(captured_at, ?), lead_status=CASE WHEN lead_status='nao_captado' THEN 'novo' ELSE lead_status END, updated_at=? WHERE id=?", to.id, t, t, participantId);
  else run("UPDATE participants SET captured_by=NULL, captured_at=NULL, lead_status='nao_captado', temperature=NULL, updated_at=? WHERE id=?", t, participantId);
  const data = { de: sellerName(from), para: to ? to.name : null, motivo: String(reason || '').slice(0, 300) || null };
  run("INSERT INTO lead_events(participant_id,user_id,type,data,at) VALUES (?,?, 'lead_reatribuido', ?, ?)", participantId, admin.id, JSON.stringify(data), t);
  audit({ user: admin, action: 'lead_reatribuido', entity: 'participante', entityId: participantId, details: data, ip });
  const updated = one('SELECT * FROM participants WHERE id=?', participantId);
  realtime.publish('lead:assigned', fullView(updated), { roles: ['admin', 'recepcao'] });
  const ids = [from, to && to.id].filter(Boolean);
  if (ids.length) realtime.publish('lead:assigned', { id: participantId }, { userIds: ids });
  realtime.publish('counts', countsPayload(), { roles: ['vendedor'] });
  return { status: 200, participant: updated };
}

function history(participantId) {
  return all(`SELECT e.type, e.data, e.at, u.name user_name FROM lead_events e LEFT JOIN users u ON u.id=e.user_id
              WHERE e.participant_id=? ORDER BY e.at DESC, e.id DESC LIMIT 200`, participantId)
    .map((e) => ({ ...e, data: e.data ? JSON.parse(e.data) : null }));
}

/** LGPD: anonimiza mantendo apenas os números agregados. */
function anonymize(participantId, user, ip, reason = 'solicitacao') {
  const p = one('SELECT * FROM participants WHERE id=? AND anonymized_at IS NULL', participantId);
  if (!p) return false;
  const t = now();
  run(`UPDATE participants SET name=NULL, phone=NULL, email=NULL, company=NULL, notes=NULL, interests=NULL, client_ref=NULL,
       anonymized_at=?, updated_at=? WHERE id=?`, t, t, participantId);
  run("DELETE FROM lead_events WHERE participant_id=? AND type<>'credenciado'", participantId);
  run("UPDATE print_jobs SET status='cancelado' WHERE participant_id=? AND status IN ('pendente','imprimindo')", participantId);
  audit({ user, action: 'participante_anonimizado', entity: 'participante', entityId: participantId, details: { motivo: reason }, ip });
  realtime.publish('participant:update', { id: participantId, anonymized: true }, { roles: ['admin', 'recepcao'] });
  return true;
}

module.exports = { LEAD_STATUS, TEMPERATURES, validateInput, fullView, sellerView, register, capture, updateLead, assignLead, history, anonymize, countsPayload, publishParticipant, sellerName };
