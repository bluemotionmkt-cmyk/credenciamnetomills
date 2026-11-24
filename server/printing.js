'use strict';
const config = require('./config');
const { one, all, run, tx, now } = require('./db');
const labels = require('./labels');
const realtime = require('./realtime');

const MAX_ATTEMPTS = 3;
const STALE_SECONDS = 90;

const parseCfg = (s) => labels.normalizeLabelConfig(typeof s === 'string' ? JSON.parse(s || '{}') : s || {});

function isOnline(station) {
  return !!(station && station.agent_last_seen && Date.now() - Date.parse(station.agent_last_seen) < config.AGENT_OFFLINE_SECONDS * 1000);
}

function stationView(s, { withKey = false } = {}) {
  if (!s) return null;
  const info = s.agent_info ? JSON.parse(s.agent_info) : null;
  const pending = one("SELECT COUNT(*) c FROM print_jobs WHERE station_id=? AND status IN ('pendente','imprimindo')", s.id).c;
  const failed = one("SELECT COUNT(*) c FROM print_jobs WHERE station_id=? AND status='falhou' AND created_at > ?", s.id, new Date(Date.now() - 3600_000).toISOString()).c;
  return {
    id: s.id, name: s.name, kind: s.kind, active: !!s.active,
    label: parseCfg(s.label_config),
    fallback_station_id: s.fallback_station_id,
    agent: { configured: !!s.agent_token_hash, online: isOnline(s), last_seen: s.agent_last_seen, info },
    queue: { pending, failed_last_hour: failed },
    ...(withKey ? { station_key: s.station_key } : {}),
  };
}

const publishJob = (job) => realtime.publish('job:update', job, { roles: ['admin', 'recepcao'] });
const jobView = (j) => j && ({
  id: j.id, status: j.status, error: j.error, reason: j.reason, attempts: j.attempts,
  station_id: j.station_id, requested_station_id: j.requested_station_id, participant_id: j.participant_id,
  created_at: j.created_at, done_at: j.done_at,
  station_name: (one('SELECT name FROM stations WHERE id=?', j.station_id) || {}).name,
});

// ---- Espera longa dos agentes (resposta imediata quando surge um trabalho) ----
const waiters = new Map(); // stationId -> Set<fn>
function wake(stationId) {
  const set = waiters.get(stationId);
  if (!set) return;
  waiters.delete(stationId);
  for (const fn of set) fn();
}
function waitForJob(stationId, ms) {
  return new Promise((resolve) => {
    const set = waiters.get(stationId) || new Set();
    const done = () => { clearTimeout(t); set.delete(done); resolve(); };
    const t = setTimeout(done, ms);
    set.add(done);
    waiters.set(stationId, set);
  });
}

/**
 * Coloca uma etiqueta na fila. Se a impressora da estação estiver offline e houver
 * estação de contingência online, o trabalho é redirecionado automaticamente.
 */
function enqueue({ participantId, stationId, reason, userId = null }) {
  const station = one('SELECT * FROM stations WHERE id=? AND active=1', stationId);
  if (!station) throw Object.assign(new Error('Estação de impressão não encontrada ou inativa.'), { status: 400 });
  let target = station;
  if (!isOnline(station) && station.fallback_station_id) {
    const fb = one('SELECT * FROM stations WHERE id=? AND active=1', station.fallback_station_id);
    if (fb && isOnline(fb)) target = fb;
  }
  const r = run(`INSERT INTO print_jobs(participant_id, station_id, requested_station_id, reason, status, requested_by, created_at, updated_at)
                 VALUES (?,?,?,?, 'pendente', ?, ?, ?)`, participantId, target.id, station.id, reason, userId, now(), now());
  const job = jobView(one('SELECT * FROM print_jobs WHERE id=?', r.lastInsertRowid));
  job.redirected = target.id !== station.id;
  job.station_online = isOnline(target);
  publishJob(job);
  wake(target.id);
  return job;
}

async function claimNext(stationId) {
  const job = tx(() => {
    const staleLimit = new Date(Date.now() - STALE_SECONDS * 1000).toISOString();
    run("UPDATE print_jobs SET status='pendente', updated_at=? WHERE station_id=? AND status='imprimindo' AND claimed_at < ?", now(), stationId, staleLimit);
    const j = one(`SELECT * FROM print_jobs WHERE station_id=? AND status='pendente' AND attempts < ? ORDER BY id LIMIT 1`, stationId, MAX_ATTEMPTS);
    if (!j) return null;
    run("UPDATE print_jobs SET status='imprimindo', attempts=attempts+1, claimed_at=?, updated_at=? WHERE id=?", now(), now(), j.id);
    return one('SELECT * FROM print_jobs WHERE id=?', j.id);
  });
  if (!job) return null;
  publishJob(jobView(job));
  const station = one('SELECT * FROM stations WHERE id=?', stationId);
  const cfg = parseCfg(station.label_config);
  let participant = labels.TEST_PARTICIPANT;
  if (job.participant_id) {
    participant = one('SELECT * FROM participants WHERE id=?', job.participant_id);
    if (!participant || participant.anonymized_at) {
      complete(job.id, { ok: false, error: 'Participante removido.', retryable: false });
      return null;
    }
  }
  try {
    const out = await labels.renderJob(participant, cfg);
    return { id: job.id, format: out.format, data: out.data.toString('base64'), bytes: out.data.length, copies: cfg.copies, reason: job.reason };
  } catch (e) {
    complete(job.id, { ok: false, error: `Falha ao gerar etiqueta: ${e.message}`, retryable: false });
    return null;
  }
}

function complete(jobId, { ok, error, retryable }) {
  const job = one('SELECT * FROM print_jobs WHERE id=?', jobId);
  if (!job) return null;
  if (ok) {
    run("UPDATE print_jobs SET status='impresso', error=NULL, done_at=?, updated_at=? WHERE id=?", now(), now(), jobId);
    if (job.participant_id) {
      run('UPDATE participants SET print_count=print_count+1, last_printed_at=? WHERE id=?', now(), job.participant_id);
      run("INSERT INTO lead_events(participant_id,user_id,type,data,at) VALUES (?,?, 'etiqueta_impressa', ?, ?)",
        job.participant_id, job.requested_by, JSON.stringify({ job: jobId, estacao: job.station_id, motivo: job.reason }), now());
    }
  } else {
    const status = retryable && job.attempts < MAX_ATTEMPTS ? 'pendente' : 'falhou';
    run('UPDATE print_jobs SET status=?, error=?, updated_at=? WHERE id=?', status, String(error || 'Erro desconhecido').slice(0, 300), now(), jobId);
  }
  const v = jobView(one('SELECT * FROM print_jobs WHERE id=?', jobId));
  publishJob(v);
  return v;
}

// Atualiza "visto por último" do agente e avisa os painéis quando muda de online/offline.
const lastState = new Map();
function touchAgent(station, info) {
  const params = [now()];
  let sql = 'UPDATE stations SET agent_last_seen=?';
  if (info) { sql += ', agent_info=?'; params.push(JSON.stringify(info).slice(0, 2000)); }
  run(sql + ' WHERE id=?', ...params, station.id);
  checkTransitions();
}
function checkTransitions() {
  for (const s of all('SELECT * FROM stations')) {
    const online = isOnline(s);
    if (lastState.get(s.id) !== online) {
      lastState.set(s.id, online);
      realtime.publish('station:update', stationView(s), { roles: ['admin', 'recepcao'] });
    }
  }
}
setInterval(checkTransitions, 10_000).unref();

module.exports = { wake, enqueue, claimNext, complete, waitForJob, touchAgent, stationView, jobView, isOnline, parseCfg };
