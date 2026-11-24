'use strict';
require('../scripts/check-node');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const express = require('express');
const config = require('./config');
const { one, run, now, audit } = require('./db');
const auth = require('./auth');
const backup = require('./backup');
const { hashPassword, tempPassword, randomToken } = require('./security');
const labels = require('./labels');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', config.TRUST_PROXY);
app.set('etag', false);

// Cabeçalhos de segurança (sem dependências externas).
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
  next();
});

app.use(express.json({ limit: '200kb' }));
app.use(auth.sessionMiddleware);
app.use(auth.csrfGuard);
app.use('/api', (req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

auth.routes(app);
require('./routes-public').routes(app);
require('./routes-app').routes(app);
require('./routes-admin').routes(app);

app.use('/api', (req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));

// Arquivos estáticos. HTML sem cache para que atualizações cheguem aos totens.
app.use(express.static(config.PUBLIC_DIR, {
  extensions: ['html'],
  setHeaders(res, file) {
    if (file.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
    else res.setHeader('Cache-Control', 'public, max-age=3600');
  },
}));

// Tratamento central de erros: nunca expõe detalhes internos.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Dados inválidos.' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Conteúdo muito grande.' });
  console.error(`[erro] ${req.method} ${req.originalUrl}:`, err);
  res.status(err.status || 500).json({ error: err.status ? err.message : 'Erro interno. Tente novamente.' });
});

// ---------- Primeira inicialização ----------
async function firstRun() {
  const hasUsers = one('SELECT COUNT(*) c FROM users').c > 0;
  if (!hasUsers && config.MODE !== 'demo') {
    const pw = tempPassword();
    run(`INSERT INTO users(name, username, role, password_hash, active, must_change_password, created_at, updated_at)
         VALUES ('Administrador', 'admin', 'admin', ?, 1, 1, ?, ?)`, await hashPassword(pw), now(), now());
    const file = path.join(config.DATA_DIR, `CREDENCIAIS-INICIAIS-${config.MODE}.txt`);
    fs.writeFileSync(file, [
      'Mills Seminovos — Credenciamento',
      `Ambiente: ${config.MODE}`,
      `Gerado em: ${new Date().toLocaleString('pt-BR')}`,
      '',
      'Usuário: admin',
      `Senha temporária: ${pw}`,
      '',
      'A troca de senha é obrigatória no primeiro acesso.',
      'APAGUE ESTE ARQUIVO depois de entrar no sistema.',
    ].join('\n'), { mode: 0o600 });
    console.log('\n  ┌─────────────────────────────────────────────────────────────');
    console.log('  │ Primeiro acesso do administrador');
    console.log('  │ Usuário: admin');
    console.log(`  │ Senha temporária: ${pw}`);
    console.log(`  │ (também salva em ${file} — apague depois do primeiro login)`);
    console.log('  └─────────────────────────────────────────────────────────────\n');
    audit({ action: 'administrador_inicial_criado' });
  }
  if (one('SELECT COUNT(*) c FROM stations').c === 0) {
    const cfg = JSON.stringify(labels.normalizeLabelConfig({}));
    run("INSERT INTO stations(name, kind, station_key, label_config, active, created_at) VALUES ('Totem 1', 'totem', ?, ?, 1, ?)", randomToken(18), cfg, now());
    run("INSERT INTO stations(name, kind, station_key, label_config, active, created_at) VALUES ('Recepção 1', 'recepcao', ?, ?, 1, ?)", randomToken(18), cfg, now());
  }
  if (config.MODE === 'demo' && !hasUsers) await require('../scripts/seed-demo').seed();
}

// ---------- Certificado para HTTPS na rede local ----------
function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  return out;
}

function ensureCert() {
  fs.mkdirSync(config.CERT_DIR, { recursive: true });
  const custom = { key: path.join(config.CERT_DIR, 'custom-key.pem'), cert: path.join(config.CERT_DIR, 'custom-cert.pem') };
  if (fs.existsSync(custom.key) && fs.existsSync(custom.cert)) return { key: fs.readFileSync(custom.key), cert: fs.readFileSync(custom.cert), custom: true };
  const keyFile = path.join(config.CERT_DIR, 'key.pem');
  const certFile = path.join(config.CERT_DIR, 'cert.pem');
  const metaFile = path.join(config.CERT_DIR, 'ips.json');
  const ips = lanAddresses();
  const prevIps = fs.existsSync(metaFile) ? JSON.parse(fs.readFileSync(metaFile, 'utf8')) : null;
  const needs = !fs.existsSync(keyFile) || !prevIps || ips.some((ip) => !prevIps.includes(ip));
  if (needs) {
    const selfsigned = require('selfsigned');
    const altNames = [{ type: 2, value: 'localhost' }, { type: 2, value: os.hostname() }, { type: 7, ip: '127.0.0.1' }, ...ips.map((ip) => ({ type: 7, ip }))];
    const pems = selfsigned.generate([{ name: 'commonName', value: 'Mills Seminovos Credenciamento' }], {
      keySize: 2048, days: 825, algorithm: 'sha256',
      extensions: [{ name: 'basicConstraints', cA: false }, { name: 'keyUsage', digitalSignature: true, keyEncipherment: true }, { name: 'extKeyUsage', serverAuth: true }, { name: 'subjectAltName', altNames }],
    });
    fs.writeFileSync(keyFile, pems.private, { mode: 0o600 });
    fs.writeFileSync(certFile, pems.cert);
    fs.writeFileSync(metaFile, JSON.stringify(ips));
  }
  return { key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile), custom: false };
}

// Demonstração: gera tokens e configurações dos agentes (modo arquivo) para rodar tudo com um comando.
function provisionDemoAgents() {
  const { sha256 } = require('./security');
  const dir = path.join(config.DATA_DIR, 'demo-agentes');
  fs.mkdirSync(dir, { recursive: true });
  for (const s of require('./db').all('SELECT * FROM stations WHERE active=1')) {
    const token = randomToken(32);
    run('UPDATE stations SET agent_token_hash=? WHERE id=?', sha256(token), s.id);
    const slug = s.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
    fs.writeFileSync(path.join(dir, `${slug}.json`), JSON.stringify({
      server: `http://localhost:${config.HTTP_PORT}`, token,
      printer: { type: 'file', dir: path.join(dir, `etiquetas-${slug}`) },
    }, null, 2));
  }
}

async function start() {
  // Na nuvem, sem disco persistente os dados se perderiam a cada atualização: não inicia.
  if (config.ON_RAILWAY && !config.HAS_PERSISTENT_DIR) {
    console.error('\n  FALTA O VOLUME PERSISTENTE. Sem ele, os cadastros seriam apagados a cada atualização.');
    console.error('  Na Railway: crie um volume com mount path /data neste serviço (comando: railway volume add --mount-path /data).\n');
    process.exit(1);
  }
  await firstRun();
  if (config.MODE === 'demo') provisionDemoAgents();
  backup.schedule();
  backup.scheduleRetention();

  const httpServer = http.createServer(app);
  httpServer.keepAliveTimeout = 65_000;
  await new Promise((resolve, reject) => {
    httpServer.once('error', (e) => reject(e.code === 'EADDRINUSE'
      ? new Error(`A porta ${config.HTTP_PORT} já está em uso. Feche a outra janela do sistema que está aberta (ou altere HTTP_PORT no arquivo .env) e tente de novo.`)
      : e));
    httpServer.listen(config.HTTP_PORT, '0.0.0.0', resolve);
  });

  let httpsServer = null;
  if (config.HTTPS_ENABLED) {
    try {
      const tls = ensureCert();
      httpsServer = https.createServer({ key: tls.key, cert: tls.cert }, app);
      await new Promise((r) => httpsServer.listen(config.HTTPS_PORT, '0.0.0.0', r));
    } catch (e) {
      console.error('[https] não foi possível iniciar:', e.message);
    }
  }

  if (config.CLOUD) {
    const u = config.PUBLIC_URL || '(gere o domínio público na plataforma)';
    console.log(`\nMills Seminovos — Credenciamento (nuvem)${config.MODE !== 'producao' ? ` [${config.MODE}]` : ''}`);
    console.log(`Dados em: ${config.DATA_DIR}`);
    console.log(`\n  Administração .... ${u}/admin\n  Recepção ......... ${u}/recepcao\n  Vendedores ....... ${u}/vendedor\n  Totem ............ link em Administração → Estações e impressoras\n`);
  }
  const ips = lanAddresses();
  const base = ips[0] || 'localhost';
  const tag = config.MODE === 'demo' ? '  [AMBIENTE DE DEMONSTRAÇÃO — dados fictícios]' : config.MODE === 'teste' ? '  [TESTE]' : '';
  if (!config.CLOUD) console.log(`\nMills Seminovos — Credenciamento${tag}`);
  if (!config.CLOUD) {
  console.log(`Banco de dados: ${config.DB_FILE}`);
  console.log(`\n  Totem ............ http://localhost:${config.HTTP_PORT}/totem   (no próprio equipamento)`);
  console.log(`  Recepção ......... http://${base}:${config.HTTP_PORT}/recepcao`);
  console.log(`  Administração .... http://${base}:${config.HTTP_PORT}/admin`);
  if (httpsServer) console.log(`  Vendedores ....... https://${base}:${config.HTTPS_PORT}/vendedor   (HTTPS: necessário para a câmera em celulares)`);
  console.log(`  Agente impressão . http://${base}:${config.HTTP_PORT}\n`);
  }

  const shutdown = () => {
    console.log('\nEncerrando: gerando backup final…');
    try { backup.runBackup('encerramento'); } catch (e) { console.error(e.message); }
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  return { app, httpServer, httpsServer };
}

if (require.main === module) start().catch((e) => { console.error(`\n  Não foi possível iniciar: ${e.message}\n`); process.exit(1); });

module.exports = { app, start };
