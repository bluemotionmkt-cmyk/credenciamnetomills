'use strict';
const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');
const { db, now, audit, getSettings, all } = require('./db');

fs.mkdirSync(config.BACKUP_DIR, { recursive: true });

function stamp() {
  return new Date().toISOString().replace(/[:T]/g, '-').replace(/\..+/, '');
}

/** Cópia consistente do banco em uso (VACUUM INTO), sem parar o sistema. */
function runBackup(reason = 'automatico') {
  const name = `${config.MODE}-${stamp()}-${reason}.db`;
  const file = path.join(config.BACKUP_DIR, name);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  let extra = null;
  if (config.BACKUP_EXTRA_DIR) {
    try {
      fs.mkdirSync(config.BACKUP_EXTRA_DIR, { recursive: true });
      extra = path.join(config.BACKUP_EXTRA_DIR, name);
      fs.copyFileSync(file, extra);
    } catch (e) { extra = `falhou: ${e.message}`; }
  }
  prune();
  return { name, size: fs.statSync(file).size, extra };
}

function prune() {
  const files = list();
  for (const f of files.slice(config.BACKUP_KEEP)) {
    if (f.name.includes('-manual')) continue; // backups manuais nunca são apagados automaticamente
    try { fs.unlinkSync(path.join(config.BACKUP_DIR, f.name)); } catch { /* ignore */ }
  }
}

function list() {
  return fs.readdirSync(config.BACKUP_DIR)
    .filter((n) => n.endsWith('.db'))
    .map((n) => { const st = fs.statSync(path.join(config.BACKUP_DIR, n)); return { name: n, size: st.size, at: st.mtime.toISOString() }; })
    .sort((a, b) => b.at.localeCompare(a.at));
}

function filePath(name) {
  if (!/^[\w.-]+\.db$/.test(name)) return null;
  const p = path.join(config.BACKUP_DIR, name);
  return fs.existsSync(p) ? p : null;
}

let lastHash = null;
function schedule() {
  if (config.BACKUP_INTERVAL_MIN <= 0) return;
  setInterval(() => {
    try {
      // Evita backups idênticos quando nada mudou.
      const sig = JSON.stringify(all("SELECT (SELECT COUNT(*) FROM participants) a, (SELECT MAX(updated_at) FROM participants) b, (SELECT COUNT(*) FROM lead_events) c, (SELECT COUNT(*) FROM audit_log) d"));
      if (sig === lastHash) return;
      lastHash = sig;
      runBackup('automatico');
    } catch (e) { console.error('[backup] falhou:', e.message); }
  }, config.BACKUP_INTERVAL_MIN * 60_000).unref();
}

/** Política de retenção (LGPD): anonimiza cadastros mais antigos que N dias. */
function applyRetention({ user = null, dryRun = false } = {}) {
  const days = parseInt(getSettings().retention_days, 10);
  if (!days || days < 1) return { days, affected: 0 };
  const limit = new Date(Date.now() - days * 86400_000).toISOString();
  const rows = all('SELECT id FROM participants WHERE anonymized_at IS NULL AND created_at < ?', limit);
  if (!dryRun && rows.length) {
    const P = require('./participants');
    for (const r of rows) P.anonymize(r.id, user, null, 'politica_retencao');
    audit({ user, action: 'retencao_aplicada', details: { dias: days, anonimizados: rows.length } });
  }
  return { days, limit, affected: rows.length };
}

function scheduleRetention() {
  setInterval(() => { try { applyRetention(); } catch (e) { console.error('[retenção]', e.message); } }, 6 * 3600_000).unref();
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now());
}

module.exports = { runBackup, list, filePath, schedule, applyRetention, scheduleRetention };
