'use strict';
const config = require('./config');
const { one, run, now, audit } = require('./db');
const { sha256, randomToken, verifyPassword, hashPassword, passwordProblems, RateLimiter } = require('./security');
const realtime = require('./realtime');

const COOKIE = config.MODE === 'producao' ? 'ms_sessao' : `ms_sessao_${config.MODE}`;
const loginLimiterUser = new RateLimiter({ windowMs: 5 * 60_000, max: 6 });
const loginLimiterIp = new RateLimiter({ windowMs: 5 * 60_000, max: 40 });
// Hash fictício: mantém o tempo de resposta igual quando o usuário não existe.
let DUMMY_HASH = null;
const dummyHash = async () => (DUMMY_HASH ||= await hashPassword('senha-inexistente-123'));

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

const publicUser = (u) => u && ({
  id: u.id, name: u.name, username: u.username, role: u.role, email: u.email, phone: u.phone,
  active: !!u.active, must_change_password: !!u.must_change_password,
});

function setCookie(res, req, token, maxAgeSec) {
  const secure = req.secure ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=${token ? encodeURIComponent(token) : ''}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSec}${secure}`);
}

function createSession(req, res, user) {
  const token = randomToken(32);
  const exp = new Date(Date.now() + config.SESSION_HOURS * 3600_000).toISOString();
  run('INSERT INTO sessions(id,user_id,created_at,expires_at,last_seen_at,ip,user_agent) VALUES (?,?,?,?,?,?,?)',
    sha256(token), user.id, now(), exp, now(), req.ip, String(req.headers['user-agent'] || '').slice(0, 200));
  setCookie(res, req, token, config.SESSION_HOURS * 3600);
}

// Carrega a sessão (se houver) em req.user.
function sessionMiddleware(req, res, next) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) {
    const sid = sha256(token);
    const s = one(`SELECT s.id sid, s.expires_at, s.last_seen_at, u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`, sid);
    if (s && s.expires_at > now() && s.active) {
      req.user = s; req.sessionId = sid;
      if (!s.last_seen_at || Date.now() - Date.parse(s.last_seen_at) > 60_000) run('UPDATE sessions SET last_seen_at=? WHERE id=?', now(), sid);
    } else if (s) {
      run('DELETE FROM sessions WHERE id=?', sid);
    }
  }
  next();
}

// Requisições que alteram dados exigem cabeçalho próprio (bloqueia CSRF entre sites).
function csrfGuard(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.path.startsWith('/api/agent/')) return next(); // agente usa token Bearer
  if (req.headers['x-requested-with'] !== 'mills') return res.status(403).json({ error: 'Requisição recusada.' });
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Sessão expirada. Entre novamente.', code: 'auth' });
    if (req.user.must_change_password && !req.path.endsWith('/change-password') && !req.path.endsWith('/me') && !req.path.endsWith('/logout')) {
      return res.status(403).json({ error: 'Troque sua senha temporária para continuar.', code: 'must_change_password' });
    }
    if (roles.length && !roles.includes(req.user.role)) return res.status(403).json({ error: 'Seu perfil não tem acesso a esta área.', code: 'forbidden' });
    next();
  };
}

function routes(app) {
  app.post('/api/auth/login', async (req, res) => {
    const username = String(req.body?.username || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    if (!loginLimiterIp.check(req.ip) || !loginLimiterUser.check(`${req.ip}|${username}`)) {
      return res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.' });
    }
    const user = one('SELECT * FROM users WHERE username = ?', username);
    const ok = user ? await verifyPassword(password, user.password_hash) : await verifyPassword(password, await dummyHash());
    if (!user || !ok) {
      audit({ actor: username || '(vazio)', action: 'login_falhou', ip: req.ip });
      return res.status(401).json({ error: 'Usuário ou senha incorretos.' });
    }
    if (!user.active) return res.status(403).json({ error: 'Seu acesso está desativado. Fale com o administrador.' });
    loginLimiterUser.reset(`${req.ip}|${username}`);
    createSession(req, res, user);
    run('UPDATE users SET last_login_at=? WHERE id=?', now(), user.id);
    audit({ user, action: 'login', ip: req.ip });
    res.json({ user: publicUser(user) });
  });

  app.post('/api/auth/logout', (req, res) => {
    if (req.sessionId) { run('DELETE FROM sessions WHERE id=?', req.sessionId); audit({ user: req.user, action: 'logout', ip: req.ip }); }
    setCookie(res, req, '', 0);
    res.json({ ok: true });
  });

  app.get('/api/auth/me', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Sem sessão.', code: 'auth' });
    res.json({ user: publicUser(req.user), mode: config.MODE });
  });

  app.post('/api/auth/change-password', requireRole(), async (req, res) => {
    const { current, next: nextPw } = req.body || {};
    const user = one('SELECT * FROM users WHERE id=?', req.user.id);
    if (!(await verifyPassword(String(current || ''), user.password_hash))) return res.status(400).json({ error: 'Senha atual incorreta.' });
    const problem = passwordProblems(nextPw);
    if (problem) return res.status(400).json({ error: problem });
    if (nextPw === current) return res.status(400).json({ error: 'A nova senha precisa ser diferente da atual.' });
    run('UPDATE users SET password_hash=?, must_change_password=0, updated_at=? WHERE id=?', await hashPassword(nextPw), now(), user.id);
    run('DELETE FROM sessions WHERE user_id=? AND id<>?', user.id, req.sessionId);
    audit({ user, action: 'senha_alterada', ip: req.ip });
    res.json({ ok: true });
  });

  // Tempo real para usuários autenticados.
  app.get('/api/stream', requireRole(), (req, res) => realtime.attach(req, res, req.user));
}

function killUserSessions(userId) {
  run('DELETE FROM sessions WHERE user_id=?', userId);
  realtime.disconnectUser(userId);
}

module.exports = { sessionMiddleware, csrfGuard, requireRole, routes, publicUser, killUserSessions, COOKIE };
