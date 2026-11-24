'use strict';
const config = require('./config');
const { one, all, run, now, getSettings, setSetting, DEFAULT_SETTINGS, audit } = require('./db');
const { requireRole, publicUser, killUserSessions } = require('./auth');
const { hashPassword, tempPassword, passwordProblems, randomToken, sha256 } = require('./security');
const P = require('./participants');
const printing = require('./printing');
const labels = require('./labels');
const backup = require('./backup');
const exporter = require('./exporter');
const realtime = require('./realtime');
const { participantFilter, SORTS } = require('./routes-app');

const ADMIN = requireRole('admin');
const STAFF = requireRole('admin', 'recepcao');
const SELLER = requireRole('vendedor', 'admin');
const id = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };

function bucketer(tz) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' });
  return (iso) => {
    const parts = Object.fromEntries(f.formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
    return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}`;
  };
}

function stats() {
  const s = getSettings();
  const tz = s.timezone;
  const parts = all('SELECT created_at, captured_at, captured_by, lead_status, source, temperature FROM participants WHERE anonymized_at IS NULL');
  const total = parts.length;
  const captured = parts.filter((p) => p.captured_by).length;
  const sellers = all("SELECT id, name, username, active, last_login_at FROM users WHERE role='vendedor'");
  const online = new Set(realtime.connectedUsers());
  const recentSeen = new Set(all('SELECT DISTINCT user_id FROM sessions WHERE last_seen_at > ?', new Date(Date.now() - 10 * 60_000).toISOString()).map((r) => r.user_id));
  const dayKey = bucketer(tz);
  const today = dayKey(new Date().toISOString()).slice(0, 10);

  const perSeller = sellers.map((u) => {
    const mine = parts.filter((p) => p.captured_by === u.id);
    const last = mine.map((p) => p.captured_at).sort().pop() || null;
    return {
      id: u.id, name: u.name, active: !!u.active, online: online.has(u.id) || recentSeen.has(u.id),
      total: mine.length, today: mine.filter((p) => dayKey(p.captured_at).slice(0, 10) === today).length,
      hot: mine.filter((p) => p.temperature === 'quente').length,
      advanced: mine.filter((p) => ['em_negociacao', 'oportunidade', 'venda'].includes(p.lead_status)).length,
      sales: mine.filter((p) => p.lead_status === 'venda').length,
      last_capture: last,
    };
  }).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

  // Série por hora: do primeiro cadastro até agora (máx. 48 horas mais recentes).
  const reg = {}, cap = {};
  for (const p of parts) {
    const k = dayKey(p.created_at); reg[k] = (reg[k] || 0) + 1;
    if (p.captured_at) { const c = dayKey(p.captured_at); cap[c] = (cap[c] || 0) + 1; }
  }
  const keys = [...new Set([...Object.keys(reg), ...Object.keys(cap)])].sort();
  let hourly = [];
  if (keys.length) {
    const start = keys[0];
    const nowKey = dayKey(new Date().toISOString());
    const toDate = (k) => new Date(`${k.slice(0, 10)}T${k.slice(11)}:00:00Z`);
    for (let d = toDate(start); d <= toDate(nowKey > keys[keys.length - 1] ? nowKey : keys[keys.length - 1]); d = new Date(d.getTime() + 3600_000)) {
      const k = d.toISOString().slice(0, 13).replace('T', ' ');
      hourly.push({ hour: k, registrations: reg[k] || 0, captures: cap[k] || 0 });
    }
    // Remove horas vazias nas pontas e limita a 48 barras.
    hourly = hourly.slice(-48);
  }

  const funnel = {};
  for (const k of Object.keys(P.LEAD_STATUS)) funnel[k] = 0;
  for (const p of parts) funnel[p.lead_status] = (funnel[p.lead_status] || 0) + 1;

  const recent = all(`SELECT e.type, e.at, e.data, u.name user_name, p.name participant_name, p.company, p.id participant_id
                      FROM lead_events e JOIN participants p ON p.id=e.participant_id LEFT JOIN users u ON u.id=e.user_id
                      WHERE e.type IN ('credenciado','captado','lead_reatribuido','lead_atualizado') AND p.anonymized_at IS NULL
                      ORDER BY e.id DESC LIMIT 14`).map((e) => ({ ...e, data: e.data ? JSON.parse(e.data) : null }));

  const printsHour = one("SELECT SUM(status='impresso') ok, SUM(status='falhou') fail, SUM(status IN ('pendente','imprimindo')) pend FROM print_jobs WHERE created_at > ?", new Date(Date.now() - 3600_000).toISOString());

  return {
    generated_at: new Date().toISOString(),
    totals: {
      participants: total, captured, uncaptured: total - captured,
      conversion: total ? captured / total : 0,
      sellers_active: sellers.filter((u) => u.active).length,
      sellers_online: perSeller.filter((u) => u.online).length,
      from_totem: parts.filter((p) => p.source === 'totem').length,
      from_reception: parts.filter((p) => p.source === 'recepcao').length,
      today: parts.filter((p) => dayKey(p.created_at).slice(0, 10) === today).length,
      hot: parts.filter((p) => p.temperature === 'quente').length,
    },
    per_seller: perSeller, hourly, funnel, recent,
    prints: { ok: printsHour.ok || 0, failed: printsHour.fail || 0, pending: printsHour.pend || 0 },
    stations: all('SELECT * FROM stations ORDER BY id').map((st) => printing.stationView(st)),
  };
}

function agentConfigSnippet(req, token) {
  const host = req.headers.host || `localhost:${config.HTTP_PORT}`;
  const hostname = host.split(':')[0];
  // Nuvem: endereço público com HTTPS. Rede local: HTTP direto no IP do servidor.
  const server = config.PUBLIC_URL || (config.TRUST_PROXY ? `${req.protocol}://${host}` : `http://${hostname}:${config.HTTP_PORT}`);
  return {
    server,
    token,
    printer: { type: 'windows-raw', name: 'NOME DA IMPRESSORA NO WINDOWS' },
  };
}

function routes(app) {
  app.get('/api/admin/stats', ADMIN, (req, res) => res.json(stats()));

  // ---------- Leads (visão geral) ----------
  app.get('/api/leads', ADMIN, (req, res) => {
    const f = participantFilter(req.query, { capturedOnly: true });
    const limit = Math.min(1000, Math.max(1, Number(req.query.limit) || 100));
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const total = one(`SELECT COUNT(*) c FROM participants p WHERE ${f.sql}`, ...f.params).c;
    const rows = all(`SELECT p.* FROM participants p WHERE ${f.sql} ORDER BY ${SORTS[req.query.sort] || SORTS.captacao} LIMIT ? OFFSET ?`, ...f.params, limit, offset);
    res.json({ total, items: rows.map(P.fullView) });
  });

  app.post('/api/leads/:id/assign', ADMIN, (req, res) => {
    const r = P.assignLead(id(req.params.id), req.user, req.body?.user_id ? id(req.body.user_id) : null, req.body?.reason, req.ip);
    if (r.status !== 200) return res.status(r.status).json({ error: r.error || 'Participante não encontrado.' });
    res.json({ participant: P.fullView(r.participant) });
  });

  // ---------- Equipe ----------
  app.get('/api/users', ADMIN, (req, res) => {
    const counts = Object.fromEntries(all('SELECT captured_by id, COUNT(*) n FROM participants WHERE captured_by IS NOT NULL AND anonymized_at IS NULL GROUP BY captured_by').map((r) => [r.id, r.n]));
    res.json({ items: all('SELECT * FROM users ORDER BY active DESC, role, name COLLATE NOCASE').map((u) => ({ ...publicUser(u), last_login_at: u.last_login_at, created_at: u.created_at, leads: counts[u.id] || 0 })) });
  });

  app.get('/api/sellers', requireRole('admin', 'recepcao'), (req, res) => {
    res.json({ items: all("SELECT id, name FROM users WHERE role IN ('vendedor') AND active=1 ORDER BY name COLLATE NOCASE") });
  });

  app.post('/api/users', ADMIN, async (req, res) => {
    const b = req.body || {};
    const name = String(b.name || '').replace(/\s+/g, ' ').trim();
    const username = String(b.username || '').trim().toLowerCase();
    const role = ['admin', 'vendedor', 'recepcao'].includes(b.role) ? b.role : null;
    if (name.length < 3) return res.status(422).json({ error: 'Informe o nome completo.' });
    if (!/^[a-z0-9._-]{3,32}$/.test(username)) return res.status(422).json({ error: 'Usuário deve ter de 3 a 32 caracteres: letras minúsculas, números, ponto, hífen ou sublinhado.' });
    if (!role) return res.status(422).json({ error: 'Escolha o perfil.' });
    if (one('SELECT 1 FROM users WHERE username=?', username)) return res.status(409).json({ error: 'Este usuário já existe.' });
    let password = b.password ? String(b.password) : null;
    if (password) { const pr = passwordProblems(password); if (pr) return res.status(422).json({ error: pr }); }
    const temp = password ? null : tempPassword();
    const r = run('INSERT INTO users(name, username, email, phone, role, password_hash, active, must_change_password, created_at, updated_at) VALUES (?,?,?,?,?,?,1,1,?,?)',
      name, username, b.email ? String(b.email).trim().toLowerCase() : null, b.phone ? String(b.phone).replace(/\D/g, '') : null,
      role, await hashPassword(password || temp), now(), now());
    audit({ user: req.user, action: 'usuario_criado', entity: 'usuario', entityId: r.lastInsertRowid, details: { username, role }, ip: req.ip });
    res.status(201).json({ user: publicUser(one('SELECT * FROM users WHERE id=?', r.lastInsertRowid)), temp_password: temp });
  });

  app.patch('/api/users/:id', ADMIN, (req, res) => {
    const u = one('SELECT * FROM users WHERE id=?', id(req.params.id));
    if (!u) return res.status(404).json({ error: 'Usuário não encontrado.' });
    const b = req.body || {};
    const next = {
      name: b.name !== undefined ? String(b.name).replace(/\s+/g, ' ').trim() : u.name,
      role: b.role !== undefined ? b.role : u.role,
      active: b.active !== undefined ? (b.active ? 1 : 0) : u.active,
      email: b.email !== undefined ? (String(b.email).trim().toLowerCase() || null) : u.email,
      phone: b.phone !== undefined ? (String(b.phone).replace(/\D/g, '') || null) : u.phone,
    };
    if (next.name.length < 3) return res.status(422).json({ error: 'Informe o nome completo.' });
    if (!['admin', 'vendedor', 'recepcao'].includes(next.role)) return res.status(422).json({ error: 'Perfil inválido.' });
    const losingAdmin = u.role === 'admin' && u.active && (next.role !== 'admin' || !next.active);
    if (losingAdmin && one("SELECT COUNT(*) c FROM users WHERE role='admin' AND active=1").c <= 1) {
      return res.status(409).json({ error: 'É preciso manter pelo menos um administrador ativo.' });
    }
    run('UPDATE users SET name=?, role=?, active=?, email=?, phone=?, updated_at=? WHERE id=?', next.name, next.role, next.active, next.email, next.phone, now(), u.id);
    if (!next.active || next.role !== u.role) killUserSessions(u.id);
    audit({ user: req.user, action: 'usuario_editado', entity: 'usuario', entityId: u.id, details: { antes: { role: u.role, active: !!u.active }, depois: { role: next.role, active: !!next.active } }, ip: req.ip });
    res.json({ user: publicUser(one('SELECT * FROM users WHERE id=?', u.id)) });
  });

  app.post('/api/users/:id/reset-password', ADMIN, async (req, res) => {
    const u = one('SELECT * FROM users WHERE id=?', id(req.params.id));
    if (!u) return res.status(404).json({ error: 'Usuário não encontrado.' });
    const temp = tempPassword();
    run('UPDATE users SET password_hash=?, must_change_password=1, updated_at=? WHERE id=?', await hashPassword(temp), now(), u.id);
    killUserSessions(u.id);
    audit({ user: req.user, action: 'senha_redefinida', entity: 'usuario', entityId: u.id, ip: req.ip });
    res.json({ temp_password: temp });
  });

  // ---------- Estações e impressoras ----------
  app.get('/api/stations', STAFF, (req, res) => {
    const admin = req.user.role === 'admin';
    res.json({ items: all('SELECT * FROM stations ORDER BY active DESC, id').filter((s) => admin || s.active).map((s) => printing.stationView(s, { withKey: admin })), presets: labels.PRESETS });
  });

  app.post('/api/stations', ADMIN, (req, res) => {
    const b = req.body || {};
    const name = String(b.name || '').trim().slice(0, 60);
    const kind = ['totem', 'recepcao'].includes(b.kind) ? b.kind : null;
    if (name.length < 2 || !kind) return res.status(422).json({ error: 'Informe nome e tipo da estação.' });
    const cfg = labels.normalizeLabelConfig(b.label || {});
    const r = run('INSERT INTO stations(name, kind, station_key, label_config, active, created_at) VALUES (?,?,?,?,1,?)', name, kind, randomToken(18), JSON.stringify(cfg), now());
    audit({ user: req.user, action: 'estacao_criada', entity: 'estacao', entityId: r.lastInsertRowid, details: { name, kind }, ip: req.ip });
    res.status(201).json({ station: printing.stationView(one('SELECT * FROM stations WHERE id=?', r.lastInsertRowid), { withKey: true }) });
  });

  app.patch('/api/stations/:id', ADMIN, (req, res) => {
    const s = one('SELECT * FROM stations WHERE id=?', id(req.params.id));
    if (!s) return res.status(404).json({ error: 'Estação não encontrada.' });
    const b = req.body || {};
    const name = b.name !== undefined ? String(b.name).trim().slice(0, 60) : s.name;
    const kind = b.kind !== undefined ? b.kind : s.kind;
    if (name.length < 2 || !['totem', 'recepcao'].includes(kind)) return res.status(422).json({ error: 'Nome ou tipo inválido.' });
    const cfg = b.label !== undefined ? JSON.stringify(labels.normalizeLabelConfig(b.label)) : s.label_config;
    let fb = b.fallback_station_id !== undefined ? (b.fallback_station_id ? id(b.fallback_station_id) : null) : s.fallback_station_id;
    if (fb === s.id) fb = null;
    const active = b.active !== undefined ? (b.active ? 1 : 0) : s.active;
    run('UPDATE stations SET name=?, kind=?, label_config=?, fallback_station_id=?, active=? WHERE id=?', name, kind, cfg, fb, active, s.id);
    audit({ user: req.user, action: 'estacao_editada', entity: 'estacao', entityId: s.id, ip: req.ip });
    const v = printing.stationView(one('SELECT * FROM stations WHERE id=?', s.id), { withKey: true });
    realtime.publish('station:update', v, { roles: ['admin', 'recepcao'] });
    res.json({ station: v });
  });

  app.post('/api/stations/:id/agent-token', ADMIN, (req, res) => {
    const s = one('SELECT * FROM stations WHERE id=?', id(req.params.id));
    if (!s) return res.status(404).json({ error: 'Estação não encontrada.' });
    const token = randomToken(32);
    run('UPDATE stations SET agent_token_hash=? WHERE id=?', sha256(token), s.id);
    audit({ user: req.user, action: 'token_agente_gerado', entity: 'estacao', entityId: s.id, ip: req.ip });
    res.json({ token, config: agentConfigSnippet(req, token) });
  });

  app.post('/api/stations/:id/rotate-key', ADMIN, (req, res) => {
    const s = one('SELECT * FROM stations WHERE id=?', id(req.params.id));
    if (!s) return res.status(404).json({ error: 'Estação não encontrada.' });
    run('UPDATE stations SET station_key=? WHERE id=?', randomToken(18), s.id);
    audit({ user: req.user, action: 'link_totem_renovado', entity: 'estacao', entityId: s.id, ip: req.ip });
    res.json({ station: printing.stationView(one('SELECT * FROM stations WHERE id=?', s.id), { withKey: true }) });
  });

  app.post('/api/stations/:id/test-print', STAFF, (req, res) => {
    const s = one('SELECT * FROM stations WHERE id=? AND active=1', id(req.params.id));
    if (!s) return res.status(404).json({ error: 'Estação não encontrada.' });
    const job = printing.enqueue({ participantId: null, stationId: s.id, reason: 'teste', userId: req.user.id });
    res.status(201).json({ job });
  });

  app.post('/api/stations/:id/retry-failed', STAFF, (req, res) => {
    const s = one('SELECT * FROM stations WHERE id=?', id(req.params.id));
    if (!s) return res.status(404).json({ error: 'Estação não encontrada.' });
    const r = run("UPDATE print_jobs SET status='pendente', attempts=0, error=NULL, updated_at=? WHERE station_id=? AND status='falhou' AND created_at > ?",
      now(), s.id, new Date(Date.now() - 6 * 3600_000).toISOString());
    audit({ user: req.user, action: 'impressoes_reenviadas', entity: 'estacao', entityId: s.id, details: { quantidade: r.changes }, ip: req.ip });
    printing.wake(s.id);
    res.json({ retried: r.changes });
  });

  app.get('/api/print-jobs', STAFF, (req, res) => {
    const rows = all(`SELECT j.*, p.name participant_name FROM print_jobs j LEFT JOIN participants p ON p.id=j.participant_id ORDER BY j.id DESC LIMIT 60`);
    res.json({ items: rows.map((j) => ({ ...printing.jobView(j), participant_name: j.participant_name })) });
  });

  // ---------- Configurações ----------
  const EDITABLE = Object.keys(DEFAULT_SETTINGS);
  app.get('/api/admin/settings', ADMIN, (req, res) => res.json({ settings: getSettings(), mode: config.MODE }));
  app.put('/api/admin/settings', ADMIN, (req, res) => {
    const b = req.body || {};
    const prev = getSettings();
    const changed = [];
    for (const k of EDITABLE) {
      if (b[k] === undefined) continue;
      let v = b[k];
      if (k === 'interests' || k === 'promo_items') v = JSON.stringify((Array.isArray(v) ? v : String(v).split('\n')).map((x) => String(x).trim()).filter(Boolean).slice(0, 20));
      else if (k === 'totem_return_seconds') v = String(Math.min(120, Math.max(4, parseInt(v, 10) || 12)));
      else if (k === 'retention_days') v = String(Math.min(3650, Math.max(1, parseInt(v, 10) || 365)));
      else v = String(v).slice(0, 4000);
      if (v !== prev[k]) { setSetting(k, v); changed.push(k); }
    }
    // Mudou o texto de privacidade: nova versão para rastrear o aceite.
    if (changed.includes('privacy_text') && !changed.includes('privacy_version')) {
      setSetting('privacy_version', String((parseInt(prev.privacy_version, 10) || 1) + 1));
      changed.push('privacy_version');
    }
    if (changed.length) audit({ user: req.user, action: 'configuracoes_alteradas', details: { campos: changed }, ip: req.ip });
    res.json({ settings: getSettings(), changed });
  });

  // ---------- Auditoria ----------
  app.get('/api/admin/audit', ADMIN, (req, res) => {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const q = String(req.query.q || '').trim();
    const where = q ? "WHERE action LIKE ? OR actor LIKE ? OR entity_id = ?" : '';
    const params = q ? [`%${q}%`, `%${q}%`, q] : [];
    res.json({
      total: one(`SELECT COUNT(*) c FROM audit_log ${where}`, ...params).c,
      items: all(`SELECT * FROM audit_log ${where} ORDER BY id DESC LIMIT ? OFFSET ?`, ...params, limit, offset).map((r) => ({ ...r, details: r.details ? JSON.parse(r.details) : null })),
    });
  });

  // ---------- Backups e retenção ----------
  app.get('/api/admin/backups', ADMIN, (req, res) => res.json({ items: backup.list(), dir: config.BACKUP_DIR, extra_dir: config.BACKUP_EXTRA_DIR, interval_min: config.BACKUP_INTERVAL_MIN }));
  app.post('/api/admin/backups', ADMIN, (req, res) => {
    const r = backup.runBackup('manual');
    audit({ user: req.user, action: 'backup_manual', details: r, ip: req.ip });
    res.status(201).json(r);
  });
  app.get('/api/admin/backups/:name', ADMIN, (req, res) => {
    const f = backup.filePath(req.params.name);
    if (!f) return res.status(404).json({ error: 'Backup não encontrado.' });
    audit({ user: req.user, action: 'backup_baixado', details: { arquivo: req.params.name }, ip: req.ip });
    res.download(f);
  });
  app.post('/api/admin/retention', ADMIN, (req, res) => {
    res.json(backup.applyRetention({ user: req.user, dryRun: req.body?.dry_run === true }));
  });

  // ---------- Exportações ----------
  const sendExport = async (req, res, rows, base) => {
    const ext = req.params.ext;
    if (!['csv', 'xlsx'].includes(ext)) return res.status(404).json({ error: 'Formato não suportado.' });
    const stampName = `${base}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}`;
    audit({ user: req.user, action: 'exportacao', details: { arquivo: base, formato: ext, registros: rows.length }, ip: req.ip });
    if (ext === 'xlsx') {
      res.set('Content-Disposition', `attachment; filename="${stampName}.xlsx"`);
      return res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(await exporter.toXLSX(rows, base));
    }
    res.set('Content-Disposition', `attachment; filename="${stampName}.csv"`);
    res.type('text/csv; charset=utf-8').send(exporter.toCSV(rows));
  };
  app.get('/api/export/participants.:ext', ADMIN, async (req, res) => {
    const f = participantFilter(req.query);
    await sendExport(req, res, all(`SELECT p.* FROM participants p WHERE ${f.sql} ORDER BY p.seq`, ...f.params), 'participantes');
  });
  app.get('/api/export/leads.:ext', ADMIN, async (req, res) => {
    const f = participantFilter(req.query, { capturedOnly: true });
    await sendExport(req, res, all(`SELECT p.* FROM participants p WHERE ${f.sql} ORDER BY p.captured_at`, ...f.params), 'leads');
  });
  app.get('/api/my/export.:ext', SELLER, async (req, res) => {
    const f = participantFilter(req.query, { sellerId: req.user.id });
    await sendExport(req, res, all(`SELECT p.* FROM participants p WHERE ${f.sql} ORDER BY p.captured_at`, ...f.params), 'meus-leads');
  });
}

module.exports = { routes, stats };
