'use strict';
const { one, all, run, now, getSettings, audit } = require('./db');
const { requireRole } = require('./auth');
const P = require('./participants');
const printing = require('./printing');
const labels = require('./labels');
const V = require('../public/shared/validation');

const ADMIN = requireRole('admin');
const STAFF = requireRole('admin', 'recepcao');
const SELLER = requireRole('vendedor', 'admin');
const ANY = requireRole();

const id = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };
const likeEsc = (s) => String(s).replace(/[\\%_]/g, (c) => '\\' + c);

/** Monta WHERE de busca de participantes a partir dos filtros. */
function participantFilter(q, extra = {}) {
  const where = ['p.anonymized_at IS NULL'];
  const params = [];
  const term = V.collapse(q.q || '');
  if (term) {
    const digits = V.digitsOnly(term);
    const like = `%${likeEsc(term.toLowerCase())}%`;
    const parts = ["lower(p.name) LIKE ? ESCAPE '\\'", "p.email LIKE ? ESCAPE '\\'", "lower(p.company) LIKE ? ESCAPE '\\'", 'p.code = ?'];
    params.push(like, like, like, term.toUpperCase());
    if (digits.length >= 4) { parts.push('p.phone LIKE ?'); params.push(`%${digits}%`); }
    if (/^\d{1,6}$/.test(term)) { parts.push('p.seq = ?'); params.push(Number(term)); }
    where.push(`(${parts.join(' OR ')})`);
  }
  const status = q.status || extra.status;
  if (status === 'captado') where.push('p.captured_by IS NOT NULL');
  else if (status === 'nao_captado') where.push('p.captured_by IS NULL');
  else if (status && P.LEAD_STATUS[status]) { where.push('p.lead_status = ?'); params.push(status); }
  if (q.company) { where.push('p.company = ?'); params.push(q.company); }
  if (q.seller) { where.push('p.captured_by = ?'); params.push(Number(q.seller)); }
  if (q.temperature && P.TEMPERATURES[q.temperature]) { where.push('p.temperature = ?'); params.push(q.temperature); }
  if (q.source) { where.push('p.source = ?'); params.push(q.source); }
  if (extra.capturedOnly) where.push('p.captured_by IS NOT NULL');
  if (extra.sellerId) { where.push('p.captured_by = ?'); params.push(extra.sellerId); }
  return { sql: where.join(' AND '), params };
}
const SORTS = {
  recentes: 'p.created_at DESC', antigos: 'p.created_at ASC', nome: 'p.name COLLATE NOCASE ASC',
  captacao: 'p.captured_at DESC', empresa: 'p.company COLLATE NOCASE ASC',
};

function routes(app) {
  // Configuração do evento para telas autenticadas.
  app.get('/api/app/config', ANY, (req, res) => {
    const s = getSettings();
    res.json({
      event_name: s.event_name, event_place: s.event_place, timezone: s.timezone,
      interests: JSON.parse(s.interests || '[]'), lead_status: P.LEAD_STATUS, temperatures: P.TEMPERATURES,
      privacy_text: s.privacy_text, privacy_version: s.privacy_version, marketing_text: s.marketing_text,
      sellers_see_unclaimed_count: s.sellers_see_unclaimed_count === 'true',
    });
  });

  // ---------- Recepção (notebook de apoio) ----------
  app.post('/api/reception/register', STAFF, (req, res) => {
    const b = req.body || {};
    if (b.privacy_ack !== true) return res.status(422).json({ status: 'invalid', errors: { privacy_ack: 'Confirme que o participante foi informado sobre o aviso de privacidade.' } });
    const stationId = id(b.station_id);
    const settings = getSettings();
    const clientRef = typeof b.client_ref === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(b.client_ref) ? b.client_ref : null;
    const r = P.register({ input: b, source: 'recepcao', stationId, user: req.user, clientRef, marketing: b.marketing_opt_in === true, privacyVersion: settings.privacy_version });
    if (r.status === 'invalid') return res.status(422).json(r);
    if (r.status === 'conflict') {
      return res.status(409).json({
        status: 'conflict',
        error: 'Telefone ou e-mail já pertence a outro credenciamento.',
        matches: { phone: P.fullView(r.matches.phone), email: P.fullView(r.matches.email) },
      });
    }
    if (r.status === 'existing') return res.json({ status: 'existing', participant: P.fullView(r.participant) });
    let job = null;
    if (!r.replay && stationId && b.print !== false) {
      try { job = printing.enqueue({ participantId: r.participant.id, stationId, reason: 'credenciamento', userId: req.user.id }); } catch (e) { job = { status: 'falhou', error: e.message }; }
    } else if (r.replay) {
      const j = one('SELECT * FROM print_jobs WHERE participant_id=? ORDER BY id DESC LIMIT 1', r.participant.id);
      job = j ? printing.jobView(j) : null;
    }
    audit({ user: req.user, action: 'credenciamento_recepcao', entity: 'participante', entityId: r.participant.id, ip: req.ip });
    res.status(r.replay ? 200 : 201).json({ status: 'created', participant: P.fullView(r.participant), job });
  });

  app.get('/api/jobs/:id', STAFF, (req, res) => {
    const j = one('SELECT * FROM print_jobs WHERE id=?', id(req.params.id));
    if (!j) return res.status(404).json({ error: 'Impressão não encontrada.' });
    res.json(printing.jobView(j));
  });

  // ---------- Participantes ----------
  app.get('/api/participants', STAFF, (req, res) => {
    const f = participantFilter(req.query);
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 50));
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const order = SORTS[req.query.sort] || SORTS.recentes;
    const total = one(`SELECT COUNT(*) c FROM participants p WHERE ${f.sql}`, ...f.params).c;
    const rows = all(`SELECT p.* FROM participants p WHERE ${f.sql} ORDER BY ${order} LIMIT ? OFFSET ?`, ...f.params, limit, offset);
    res.json({ total, items: rows.map(P.fullView) });
  });

  app.get('/api/participants/companies', STAFF, (req, res) => {
    res.json(all("SELECT company, COUNT(*) n FROM participants WHERE company IS NOT NULL AND anonymized_at IS NULL GROUP BY company ORDER BY n DESC, company LIMIT 300"));
  });

  app.get('/api/participants/:id', STAFF, (req, res) => {
    const p = one('SELECT * FROM participants WHERE id=?', id(req.params.id));
    if (!p) return res.status(404).json({ error: 'Participante não encontrado.' });
    const jobs = all('SELECT * FROM print_jobs WHERE participant_id=? ORDER BY id DESC LIMIT 20', p.id).map(printing.jobView);
    res.json({ participant: P.fullView(p), history: P.history(p.id), jobs });
  });

  app.patch('/api/participants/:id', STAFF, (req, res) => {
    const p = one('SELECT * FROM participants WHERE id=? AND anonymized_at IS NULL', id(req.params.id));
    if (!p) return res.status(404).json({ error: 'Participante não encontrado.' });
    const merged = { name: p.name, phone: p.phone, email: p.email, company: p.company, ...req.body };
    const { errors, values } = P.validateInput(merged);
    if (Object.keys(errors).length) return res.status(422).json({ status: 'invalid', errors });
    const clash = one('SELECT id, name FROM participants WHERE id<>? AND anonymized_at IS NULL AND (phone=? OR email=?)', p.id, values.phone, values.email);
    if (clash) return res.status(409).json({ error: `Telefone ou e-mail já usado por ${clash.name} (nº ${clash.id}).` });
    let marketing = p.marketing_opt_in;
    if (typeof req.body.marketing_opt_in === 'boolean') marketing = req.body.marketing_opt_in ? 1 : 0;
    run('UPDATE participants SET name=?, phone=?, email=?, company=?, marketing_opt_in=?, updated_at=? WHERE id=?',
      values.name, values.phone, values.email, values.company, marketing, now(), p.id);
    run("INSERT INTO lead_events(participant_id,user_id,type,data,at) VALUES (?,?, 'dados_editados', ?, ?)", p.id, req.user.id, JSON.stringify({ campos: Object.keys(req.body) }), now());
    audit({ user: req.user, action: 'participante_editado', entity: 'participante', entityId: p.id, details: { campos: Object.keys(req.body) }, ip: req.ip });
    const updated = one('SELECT * FROM participants WHERE id=?', p.id);
    P.publishParticipant('participant:update', updated);
    res.json({ participant: P.fullView(updated) });
  });

  app.post('/api/participants/:id/print', STAFF, (req, res) => {
    const p = one('SELECT * FROM participants WHERE id=? AND anonymized_at IS NULL', id(req.params.id));
    if (!p) return res.status(404).json({ error: 'Participante não encontrado.' });
    const stationId = id(req.body?.station_id);
    if (!stationId) return res.status(400).json({ error: 'Escolha a estação onde a etiqueta será impressa.' });
    try {
      const job = printing.enqueue({ participantId: p.id, stationId, reason: 'reimpressao', userId: req.user.id });
      audit({ user: req.user, action: 'etiqueta_reimpressa', entity: 'participante', entityId: p.id, details: { estacao: stationId }, ip: req.ip });
      res.status(201).json({ job });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  app.delete('/api/participants/:id', ADMIN, (req, res) => {
    const ok = P.anonymize(id(req.params.id), req.user, req.ip, String(req.body?.reason || 'solicitacao_titular'));
    if (!ok) return res.status(404).json({ error: 'Participante não encontrado.' });
    res.json({ ok: true });
  });

  // Pré-visualização exata da etiqueta (PNG 1 bit, igual ao impresso).
  app.get('/api/participants/:id/label.png', STAFF, (req, res) => {
    const p = one('SELECT * FROM participants WHERE id=? AND anonymized_at IS NULL', id(req.params.id));
    if (!p) return res.status(404).end();
    const st = id(req.query.station_id) ? one('SELECT * FROM stations WHERE id=?', id(req.query.station_id)) : one('SELECT * FROM stations WHERE active=1 ORDER BY id LIMIT 1');
    const cfg = st ? printing.parseCfg(st.label_config) : labels.normalizeLabelConfig({});
    res.type('png').set('Cache-Control', 'no-store').send(labels.monoPng(labels.rasterize(p, cfg)));
  });

  app.post('/api/labels/preview', ADMIN, (req, res) => {
    const cfg = labels.normalizeLabelConfig(req.body?.label || {});
    const p = id(req.body?.participant_id) ? one('SELECT * FROM participants WHERE id=? AND anonymized_at IS NULL', id(req.body.participant_id)) : null;
    const ras = labels.rasterize(p || { ...labels.TEST_PARTICIPANT, name: 'Maria Aparecida dos Santos', company: 'Construtora Horizonte Ltda', seq: 128 }, cfg);
    res.type('png').set('Cache-Control', 'no-store').send(labels.monoPng(ras));
  });

  // ---------- Leitura de QR e captação ----------
  app.get('/api/scan/:code', requireRole('vendedor', 'admin', 'recepcao'), (req, res) => {
    const code = String(req.params.code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!/^MS[A-Z0-9]{10}$/.test(code)) return res.status(400).json({ error: 'Este QR Code não é uma credencial Mills Seminovos.', code: 'invalid' });
    const p = one('SELECT * FROM participants WHERE code=?', code);
    if (!p || p.anonymized_at) return res.status(404).json({ error: 'Credencial não encontrada. Busque o participante pelo nome, telefone ou e-mail.', code: 'not_found' });
    if (req.user.role === 'vendedor') {
      const recent = one("SELECT 1 FROM lead_events WHERE participant_id=? AND user_id=? AND type='qr_lido' AND at > ?", p.id, req.user.id, new Date(Date.now() - 10 * 60_000).toISOString());
      if (!recent) run("INSERT INTO lead_events(participant_id,user_id,type,data,at) VALUES (?,?, 'qr_lido', NULL, ?)", p.id, req.user.id, now());
      return res.json({ participant: P.sellerView(p, req.user) });
    }
    res.json({ participant: { ...P.fullView(p), ownership: p.captured_by === req.user.id ? 'mine' : p.captured_by ? 'other' : 'free' } });
  });

  // Consulta manual quando o QR está danificado.
  app.get('/api/search', requireRole('vendedor', 'admin', 'recepcao'), (req, res) => {
    const term = V.collapse(req.query.q || '');
    if (term.length < 3) return res.json({ items: [] });
    const f = participantFilter({ q: term });
    const rows = all(`SELECT p.* FROM participants p WHERE ${f.sql} ORDER BY p.name COLLATE NOCASE LIMIT 15`, ...f.params);
    if (req.user.role !== 'vendedor') return res.json({ items: rows.map(P.fullView) });
    res.json({
      items: rows.map((p) => ({
        id: p.id, code: p.code, name: p.name, company: p.company, phone_masked: V.maskPhone(p.phone), email_masked: V.maskEmail(p.email),
        ownership: p.captured_by === req.user.id ? 'mine' : p.captured_by ? 'other' : 'free',
      })),
    });
  });

  app.get('/api/participant-by-id/:id', SELLER, (req, res) => {
    const p = one('SELECT * FROM participants WHERE id=? AND anonymized_at IS NULL', id(req.params.id));
    if (!p) return res.status(404).json({ error: 'Participante não encontrado.' });
    res.json({ participant: req.user.role === 'vendedor' ? P.sellerView(p, req.user) : P.fullView(p) });
  });

  app.post('/api/leads/:id/capture', SELLER, (req, res) => {
    const r = P.capture(id(req.params.id), req.user, req.ip);
    if (r.status === 404) return res.status(404).json({ error: 'Participante não encontrado.' });
    if (r.status === 409) {
      return res.status(409).json({
        error: `Este participante já foi captado por ${P.sellerName(r.participant.captured_by)}.`,
        participant: req.user.role === 'vendedor' ? P.sellerView(r.participant, req.user) : P.fullView(r.participant),
      });
    }
    res.status(r.status).json({ already: !!r.already, participant: req.user.role === 'vendedor' ? P.sellerView(r.participant, req.user) : P.fullView(r.participant) });
  });

  app.get('/api/leads/:id', SELLER, (req, res) => {
    const p = one('SELECT * FROM participants WHERE id=? AND anonymized_at IS NULL', id(req.params.id));
    if (!p) return res.status(404).json({ error: 'Lead não encontrado.' });
    if (req.user.role === 'vendedor' && p.captured_by !== req.user.id) return res.status(403).json({ error: 'Este lead pertence a outro vendedor.' });
    res.json({ participant: req.user.role === 'vendedor' ? P.sellerView(p, req.user) : P.fullView(p), history: P.history(p.id) });
  });

  app.patch('/api/leads/:id', SELLER, (req, res) => {
    const r = P.updateLead(id(req.params.id), req.user, req.body || {}, req.ip);
    if (r.status === 404) return res.status(404).json({ error: 'Lead não encontrado.' });
    if (r.status === 403) return res.status(403).json({ error: 'Este lead pertence a outro vendedor.' });
    if (r.status === 400) return res.status(400).json({ error: r.error });
    res.json({ participant: req.user.role === 'vendedor' ? P.sellerView(r.participant, req.user) : P.fullView(r.participant) });
  });

  // ---------- Área do vendedor ----------
  app.get('/api/my/leads', SELLER, (req, res) => {
    const f = participantFilter(req.query, { sellerId: req.user.id });
    const rows = all(`SELECT p.* FROM participants p WHERE ${f.sql} ORDER BY p.captured_at DESC LIMIT 1000`, ...f.params);
    res.json({ items: rows.map((p) => P.sellerView(p, req.user)) });
  });

  app.get('/api/my/stats', SELLER, (req, res) => {
    const s = getSettings();
    const tz = s.timezone;
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const mine = all('SELECT captured_at, lead_status, temperature FROM participants WHERE captured_by=? AND anonymized_at IS NULL', req.user.id);
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    const todayCount = mine.filter((r) => fmt.format(new Date(r.captured_at)) === today).length;
    const ranking = all("SELECT u.id, COUNT(p.id) n FROM users u LEFT JOIN participants p ON p.captured_by=u.id AND p.anonymized_at IS NULL WHERE u.role='vendedor' AND u.active=1 GROUP BY u.id ORDER BY n DESC");
    const pos = ranking.findIndex((r) => r.id === req.user.id);
    const byStatus = {};
    for (const r of mine) byStatus[r.lead_status] = (byStatus[r.lead_status] || 0) + 1;
    const counts = P.countsPayload();
    res.json({
      total: mine.length, today: todayCount,
      hot: mine.filter((r) => r.temperature === 'quente').length,
      position: pos >= 0 ? pos + 1 : null, sellers: ranking.length,
      by_status: byStatus,
      unclaimed: s.sellers_see_unclaimed_count === 'true' ? counts.livres : null,
    });
  });
}

module.exports = { routes, participantFilter, SORTS };
