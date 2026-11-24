'use strict';
// Silencia apenas o aviso "experimental" do SQLite nativo do Node (o restante permanece).
const _emit = process.emitWarning;
process.emitWarning = function (w, ...rest) {
  if (String(w && w.message ? w.message : w).includes('SQLite')) return;
  return _emit.call(process, w, ...rest);
};

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

fs.mkdirSync(path.dirname(config.DB_FILE), { recursive: true });
const db = new DatabaseSync(config.DB_FILE);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
`);

const now = () => new Date().toISOString();

const MIGRATIONS = [
  `CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT);

   CREATE TABLE users (
     id INTEGER PRIMARY KEY,
     name TEXT NOT NULL,
     username TEXT NOT NULL UNIQUE COLLATE NOCASE,
     email TEXT, phone TEXT,
     role TEXT NOT NULL CHECK (role IN ('admin','vendedor','recepcao')),
     password_hash TEXT NOT NULL,
     active INTEGER NOT NULL DEFAULT 1,
     must_change_password INTEGER NOT NULL DEFAULT 1,
     created_at TEXT NOT NULL, updated_at TEXT, last_login_at TEXT
   );

   CREATE TABLE sessions (
     id TEXT PRIMARY KEY,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     created_at TEXT NOT NULL, expires_at TEXT NOT NULL, last_seen_at TEXT,
     ip TEXT, user_agent TEXT
   );
   CREATE INDEX ix_sessions_user ON sessions(user_id);

   CREATE TABLE stations (
     id INTEGER PRIMARY KEY,
     name TEXT NOT NULL,
     kind TEXT NOT NULL CHECK (kind IN ('totem','recepcao')),
     station_key TEXT NOT NULL UNIQUE,
     agent_token_hash TEXT,
     label_config TEXT NOT NULL,
     fallback_station_id INTEGER REFERENCES stations(id) ON DELETE SET NULL,
     active INTEGER NOT NULL DEFAULT 1,
     agent_last_seen TEXT, agent_info TEXT,
     created_at TEXT NOT NULL
   );

   CREATE TABLE participants (
     id INTEGER PRIMARY KEY,
     code TEXT NOT NULL UNIQUE,
     seq INTEGER NOT NULL UNIQUE,
     name TEXT, phone TEXT, email TEXT, company TEXT,
     privacy_ack_at TEXT, privacy_version TEXT,
     marketing_opt_in INTEGER NOT NULL DEFAULT 0,
     source TEXT NOT NULL,
     station_id INTEGER REFERENCES stations(id) ON DELETE SET NULL,
     created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
     client_ref TEXT UNIQUE,
     created_at TEXT NOT NULL, updated_at TEXT,
     captured_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
     captured_at TEXT,
     lead_status TEXT NOT NULL DEFAULT 'nao_captado',
     temperature TEXT, interests TEXT, notes TEXT,
     print_count INTEGER NOT NULL DEFAULT 0,
     last_printed_at TEXT,
     anonymized_at TEXT
   );
   CREATE UNIQUE INDEX ux_participants_phone ON participants(phone) WHERE anonymized_at IS NULL;
   CREATE UNIQUE INDEX ux_participants_email ON participants(email) WHERE anonymized_at IS NULL;
   CREATE INDEX ix_participants_captured ON participants(captured_by);
   CREATE INDEX ix_participants_created ON participants(created_at);

   CREATE TABLE lead_events (
     id INTEGER PRIMARY KEY,
     participant_id INTEGER NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
     user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
     type TEXT NOT NULL, data TEXT, at TEXT NOT NULL
   );
   CREATE INDEX ix_lead_events_participant ON lead_events(participant_id);

   CREATE TABLE print_jobs (
     id INTEGER PRIMARY KEY,
     participant_id INTEGER REFERENCES participants(id) ON DELETE CASCADE,
     station_id INTEGER NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
     requested_station_id INTEGER,
     reason TEXT NOT NULL,
     status TEXT NOT NULL DEFAULT 'pendente',
     attempts INTEGER NOT NULL DEFAULT 0,
     error TEXT, requested_by INTEGER,
     created_at TEXT NOT NULL, updated_at TEXT, claimed_at TEXT, done_at TEXT
   );
   CREATE INDEX ix_print_jobs_station ON print_jobs(station_id, status);

   CREATE TABLE audit_log (
     id INTEGER PRIMARY KEY,
     user_id INTEGER, actor TEXT,
     action TEXT NOT NULL, entity TEXT, entity_id TEXT,
     details TEXT, ip TEXT, at TEXT NOT NULL
   );
   CREATE INDEX ix_audit_at ON audit_log(at);`,
];

function migrate() {
  db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)');
  const row = db.prepare("SELECT value FROM meta WHERE key='schema_version'").get();
  let version = row ? parseInt(row.value, 10) : 0;
  while (version < MIGRATIONS.length) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[version]);
      version += 1;
      db.prepare("INSERT INTO meta(key,value) VALUES('schema_version',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(version));
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
}
migrate();

const cache = new Map();
function stmt(sql) {
  let s = cache.get(sql);
  if (!s) { s = db.prepare(sql); cache.set(sql, s); }
  return s;
}
const one = (sql, ...p) => stmt(sql).get(...p);
const all = (sql, ...p) => stmt(sql).all(...p);
const run = (sql, ...p) => stmt(sql).run(...p);

let depth = 0;
function tx(fn) {
  if (depth > 0) return fn();
  depth++;
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch { /* já revertido */ }
    throw e;
  } finally {
    depth--;
  }
}

// ---------- Configurações do evento ----------
const DEFAULT_SETTINGS = {
  event_name: 'Inauguração Mills Seminovos',
  event_place: '',
  welcome_kicker: 'Inauguração',
  welcome_title: 'Mega ofertas em seminovos',
  welcome_highlight: 'Condições especiais só durante a inauguração',
  welcome_text: 'Faça seu credenciamento em menos de um minuto e fale com um consultor para garantir a sua oferta.',
  promo_items: JSON.stringify([
    'Condições especiais de pagamento', 'Plataformas e manipuladores seminovos',
    'Ofertas exclusivas da inauguração', 'Atendimento com consultor na hora',
  ]),
  privacy_version: '1',
  privacy_text:
    'A Mills coleta seu nome, telefone, e-mail e empresa para realizar seu credenciamento e identificação nesta inauguração. ' +
    'Ao apresentar sua credencial a um consultor da Mills Seminovos, seus dados de contato serão compartilhados com ele para retorno comercial sobre os equipamentos de seu interesse. ' +
    'Os dados ficam restritos à equipe autorizada e são mantidos pelo prazo definido na política de retenção. ' +
    'Você pode solicitar acesso, correção ou exclusão a qualquer momento pelos canais de privacidade da Mills.',
  marketing_text: 'Quero receber ofertas de equipamentos seminovos e novidades da Mills.',
  totem_return_seconds: '12',
  retention_days: '365',
  timezone: 'America/Sao_Paulo',
  interests: JSON.stringify([
    'Plataforma tesoura', 'Plataforma articulada', 'Plataforma telescópica',
    'Manipulador telescópico', 'Linha amarela', 'Outros equipamentos',
  ]),
  sellers_see_unclaimed_count: 'true',
};

function getSettings() {
  const out = { ...DEFAULT_SETTINGS };
  for (const r of all('SELECT key, value FROM settings')) out[r.key] = r.value;
  return out;
}
function setSetting(key, value) {
  run('INSERT INTO settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at',
    key, String(value), now());
}

function audit({ user, actor, action, entity, entityId, details, ip }) {
  run('INSERT INTO audit_log(user_id, actor, action, entity, entity_id, details, ip, at) VALUES (?,?,?,?,?,?,?,?)',
    user ? user.id : null, actor || (user ? `${user.name} (${user.username})` : 'sistema'),
    action, entity || null, entityId != null ? String(entityId) : null,
    details ? JSON.stringify(details) : null, ip || null, now());
}

module.exports = { db, one, all, run, tx, now, getSettings, setSetting, DEFAULT_SETTINGS, audit };
