'use strict';
// Tempo real via Server-Sent Events: sem dependências, reconexão automática no navegador
// e funciona através de proxies HTTP comuns.
const clients = new Set();
let nextId = 1;

function attach(req, res, user) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');
  const client = { id: nextId++, res, user };
  clients.add(client);
  send(client, 'hello', { at: new Date().toISOString() });
  const ping = setInterval(() => send(client, 'ping', { at: Date.now() }), 15000);
  res.on('close', () => { clearInterval(ping); clients.delete(client); });
}

function send(client, event, data) {
  try { client.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch { clients.delete(client); }
}

/**
 * Publica um evento. `audience` decide quem recebe:
 *  - roles: perfis que recebem tudo (ex.: ['admin','recepcao'])
 *  - userIds: usuários específicos (ex.: vendedor dono do lead)
 */
function publish(event, data, audience = { roles: ['admin'] }) {
  for (const c of clients) {
    const u = c.user;
    if ((audience.roles && audience.roles.includes(u.role)) || (audience.userIds && audience.userIds.includes(u.id))) {
      send(c, event, data);
    }
  }
}

function disconnectUser(userId) {
  for (const c of clients) if (c.user.id === userId) { try { c.res.end(); } catch { /* ignore */ } clients.delete(c); }
}

const connectedUsers = () => [...new Set([...clients].map((c) => c.user.id))];

module.exports = { attach, publish, disconnectUser, connectedUsers };
