'use strict';
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

// Carrega .env simples (CHAVE=valor), sem dependências.
function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}
loadEnvFile(path.join(ROOT, '.env'));

const argv = process.argv.slice(2);
const MODE = argv.includes('--demo') ? 'demo' : (process.env.MODE || 'producao');
if (!['producao', 'demo', 'teste'].includes(MODE)) throw new Error(`MODE inválido: ${MODE}`);

// Nuvem: Railway (e plataformas parecidas) fornece PORT, volume persistente e HTTPS no proxy.
const ON_RAILWAY = !!(process.env.RAILWAY_PROJECT_ID || process.env.RAILWAY_ENVIRONMENT_NAME || process.env.RAILWAY_SERVICE_ID);
// Hostinger (Node.js web app): o sistema roda de ~/domains/<dominio>/hbuilds/..., pasta recriada a cada deploy.
const HB = ROOT.indexOf(`${path.sep}hbuilds${path.sep}`);
const ON_HOSTINGER = HB > 0;
const HOSTINGER_DATA = ON_HOSTINGER ? path.join(ROOT.slice(0, HB), 'mills-dados') : null;
const CLOUD = ON_RAILWAY || ON_HOSTINGER || process.env.NUVEM === 'true';
const DATA_DIR = path.resolve(ROOT, process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || HOSTINGER_DATA || 'data');
const PUBLIC_URL = (process.env.PUBLIC_URL || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : '')).replace(/\/+$/, '');
// Banco de demonstração e banco real ficam em arquivos separados: nunca se misturam.
const DB_FILE = path.join(DATA_DIR, MODE === 'producao' ? 'evento.db' : MODE === 'demo' ? 'demo.db' : 'teste.db');

const int = (v, d) => (v === undefined || v === '' ? d : parseInt(v, 10));

module.exports = {
  ROOT,
  MODE,
  CLOUD,
  ON_RAILWAY,
  ON_HOSTINGER,
  HAS_PERSISTENT_DIR: !!(process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || HOSTINGER_DATA),
  PUBLIC_URL,
  DATA_DIR,
  DB_FILE,
  BACKUP_DIR: path.resolve(ROOT, process.env.BACKUP_DIR || path.join(DATA_DIR, 'backups', MODE)),
  BACKUP_EXTRA_DIR: process.env.BACKUP_EXTRA_DIR ? path.resolve(process.env.BACKUP_EXTRA_DIR) : null,
  BACKUP_INTERVAL_MIN: int(process.env.BACKUP_INTERVAL_MIN, 10),
  BACKUP_KEEP: int(process.env.BACKUP_KEEP, 72),
  HTTP_PORT: int(process.env.HTTP_PORT || process.env.PORT, MODE === 'demo' ? 3100 : 3000),
  HTTPS_PORT: int(process.env.HTTPS_PORT, MODE === 'demo' ? 3543 : 3443),
  HTTPS_ENABLED: (process.env.HTTPS_ENABLED || (CLOUD ? 'false' : 'true')) !== 'false',
  CERT_DIR: path.join(DATA_DIR, 'certs'),
  SESSION_HOURS: int(process.env.SESSION_HOURS, 14),
  TRUST_PROXY: (process.env.TRUST_PROXY || (CLOUD ? 'true' : 'false')) === 'true',
  AGENT_OFFLINE_SECONDS: int(process.env.AGENT_OFFLINE_SECONDS, 45),
  PUBLIC_DIR: path.join(ROOT, 'public'),
  ASSETS_DIR: path.join(__dirname, 'assets'),
};
