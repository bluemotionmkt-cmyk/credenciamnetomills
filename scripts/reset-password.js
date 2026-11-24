'use strict';
/*
 * Recuperação de acesso pelo terminal do servidor (ex.: senha do admin perdida).
 * Uso: npm run reset-password -- <usuario>        (banco real)
 *      npm run reset-password -- <usuario> --demo (banco de demonstração)
 */
const { one, run, now, audit } = require('../server/db');
const { hashPassword, tempPassword } = require('../server/security');
const config = require('../server/config');

(async () => {
  const username = (process.argv.slice(2).find((a) => !a.startsWith('--')) || '').toLowerCase();
  if (!username) { console.log('Informe o usuário. Ex.: npm run reset-password -- admin'); process.exit(1); }
  const u = one('SELECT * FROM users WHERE username=?', username);
  if (!u) { console.log(`Usuário "${username}" não existe em ${config.DB_FILE}.`); process.exit(1); }
  const pw = tempPassword();
  run('UPDATE users SET password_hash=?, must_change_password=1, active=1, updated_at=? WHERE id=?', await hashPassword(pw), now(), u.id);
  run('DELETE FROM sessions WHERE user_id=?', u.id);
  audit({ actor: 'terminal do servidor', action: 'senha_redefinida', entity: 'usuario', entityId: u.id });
  console.log(`Senha temporária de ${u.username}: ${pw}\nA troca será exigida no próximo acesso.`);
})();
