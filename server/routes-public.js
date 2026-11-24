'use strict';
const config = require('./config');
const { one, all, getSettings, audit } = require('./db');
const { sha256, RateLimiter } = require('./security');
const P = require('./participants');
const printing = require('./printing');
const V = require('../public/shared/validation');

const registerLimiter = new RateLimiter({ windowMs: 60_000, max: 60 });
const TOTEM_REPRINT_LIMIT = 2;

const stationByKey = (key) => (key ? one('SELECT * FROM stations WHERE station_key=? AND active=1', String(key)) : null);

function publicConfig(station) {
  const s = getSettings();
  return {
    mode: config.MODE,
    event_name: s.event_name, event_place: s.event_place,
    welcome_kicker: s.welcome_kicker, welcome_title: s.welcome_title, welcome_highlight: s.welcome_highlight, welcome_text: s.welcome_text,
    promo_items: JSON.parse(s.promo_items || '[]'),
    privacy_text: s.privacy_text, privacy_version: s.privacy_version, marketing_text: s.marketing_text,
    totem_return_seconds: parseInt(s.totem_return_seconds, 10) || 12,
    timezone: s.timezone,
    station: station ? { id: station.id, name: station.name, kind: station.kind, printer_online: printing.isOnline(station) } : null,
  };
}

function totemResponse(result, station) {
  const p = result.participant;
  const job = one('SELECT * FROM print_jobs WHERE participant_id=? ORDER BY id DESC LIMIT 1', p.id);
  return { status: result.status, first_name: V.firstName(p.name), seq: p.seq, job: job ? printing.jobView(job) : null, station_id: station.id };
}

function routes(app) {
  app.get('/api/health', (req, res) => res.json({ ok: true, mode: config.MODE, time: new Date().toISOString() }));

  // Só no ambiente de demonstração: links prontos na página inicial.
  app.get('/api/public/demo-links', (req, res) => {
    if (config.MODE !== 'demo') return res.status(404).json({ error: 'Rota não encontrada.' });
    const t = one("SELECT station_key FROM stations WHERE kind='totem' AND active=1 ORDER BY id LIMIT 1");
    res.json({ totem: t ? `/totem?estacao=${t.station_key}&teclado=1` : null });
  });

  app.get('/api/public/bootstrap', (req, res) => {
    const station = stationByKey(req.query.station || req.headers['x-station-key']);
    if (!station) return res.status(404).json({ error: 'Este totem ainda não foi vinculado a uma estação. Abra o link de configuração gerado no painel administrativo.', code: 'station' });
    res.json(publicConfig(station));
  });

  // Cadastro feito pelo próprio participante no totem.
  app.post('/api/public/register', (req, res) => {
    const station = stationByKey(req.headers['x-station-key']);
    if (!station) return res.status(401).json({ error: 'Estação não autorizada.', code: 'station' });
    if (!registerLimiter.check(req.ip)) return res.status(429).json({ error: 'Muitos cadastros em sequência. Aguarde um instante.' });
    const b = req.body || {};
    if (b.privacy_ack !== true) return res.status(422).json({ status: 'invalid', errors: { privacy_ack: 'Confirme que leu o aviso de privacidade.' } });
    const clientRef = typeof b.client_ref === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(b.client_ref) ? b.client_ref : null;
    const settings = getSettings();
    const result = P.register({
      input: b, source: 'totem', stationId: station.id, clientRef,
      marketing: b.marketing_opt_in === true, privacyVersion: settings.privacy_version,
    });

    if (result.status === 'invalid') return res.status(422).json(result);
    if (result.status === 'conflict') {
      return res.status(409).json({ status: 'conflict', error: 'Já existe um credenciamento com este telefone ou e-mail. Procure a recepção para recuperar sua etiqueta.' });
    }
    if (result.status === 'created') {
      if (!result.replay) printing.enqueue({ participantId: result.participant.id, stationId: station.id, reason: 'credenciamento' });
      return res.status(result.replay ? 200 : 201).json(totemResponse(result, station));
    }
    // Já cadastrado (telefone + e-mail conferem): reimprime, com limite para evitar abuso.
    const reprints = one("SELECT COUNT(*) c FROM print_jobs WHERE participant_id=? AND reason='recuperacao_totem'", result.participant.id).c;
    if (reprints >= TOTEM_REPRINT_LIMIT) {
      return res.status(200).json({ status: 'limit', first_name: V.firstName(result.participant.name), error: 'Sua etiqueta já foi impressa. Procure a recepção se precisar de outra.' });
    }
    printing.enqueue({ participantId: result.participant.id, stationId: station.id, reason: 'recuperacao_totem' });
    audit({ actor: `totem: ${station.name}`, action: 'etiqueta_recuperada', entity: 'participante', entityId: result.participant.id, ip: req.ip });
    return res.json(totemResponse(result, station));
  });

  app.get('/api/public/jobs/:id', (req, res) => {
    const station = stationByKey(req.headers['x-station-key']);
    if (!station) return res.status(401).json({ error: 'Estação não autorizada.' });
    const job = one('SELECT * FROM print_jobs WHERE id=? AND (station_id=? OR requested_station_id=?)', Number(req.params.id), station.id, station.id);
    if (!job) return res.status(404).json({ error: 'Impressão não encontrada.' });
    res.json(printing.jobView(job));
  });

  // ---------------- Agente de impressão ----------------
  function agentAuth(req, res, next) {
    const h = String(req.headers.authorization || '');
    const token = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
    const station = token ? one('SELECT * FROM stations WHERE agent_token_hash=?', sha256(token)) : null;
    if (!station) return res.status(401).json({ error: 'Token do agente inválido. Gere um novo token no painel (Estações e impressoras).' });
    if (!station.active) return res.status(403).json({ error: 'Estação desativada no painel.' });
    req.station = station;
    next();
  }

  app.get('/api/agent/hello', agentAuth, (req, res) => {
    printing.touchAgent(req.station, req.query.info ? { ...JSON.parse(req.query.info), since: new Date().toISOString() } : null);
    res.json({ station: printing.stationView(one('SELECT * FROM stations WHERE id=?', req.station.id)), server_time: new Date().toISOString(), mode: config.MODE });
  });

  app.get('/api/agent/jobs/next', agentAuth, async (req, res) => {
    const waitMs = Math.min(30, Math.max(0, Number(req.query.wait) || 25)) * 1000;
    const deadline = Date.now() + waitMs;
    let closed = false;
    res.on('close', () => { closed = true; });
    printing.touchAgent(req.station);
    while (!closed) {
      const job = await printing.claimNext(req.station.id);
      if (job) return res.json({ job });
      const left = deadline - Date.now();
      if (left <= 0) break;
      await printing.waitForJob(req.station.id, Math.min(left, 5000));
      if (!closed) printing.touchAgent(req.station);
    }
    if (!closed) res.status(204).end();
  });

  app.post('/api/agent/jobs/:id/result', agentAuth, (req, res) => {
    const job = one('SELECT * FROM print_jobs WHERE id=? AND station_id=?', Number(req.params.id), req.station.id);
    if (!job) return res.status(404).json({ error: 'Trabalho não encontrado para esta estação.' });
    const b = req.body || {};
    const v = printing.complete(job.id, { ok: b.ok === true, error: b.error, retryable: b.retryable === true });
    printing.touchAgent(req.station, b.printer ? { ...(JSON.parse(req.station.agent_info || '{}')), printer: b.printer } : null);
    res.json({ job: v });
  });

  app.post('/api/agent/status', agentAuth, (req, res) => {
    const info = { ...(JSON.parse(req.station.agent_info || '{}')), ...(req.body || {}), reported_at: new Date().toISOString() };
    printing.touchAgent(req.station, info);
    res.json({ ok: true });
  });
}

module.exports = { routes, publicConfig, stationByKey };
