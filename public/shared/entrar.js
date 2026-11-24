import { api, $ } from '/shared/app.js';

const HOME = { admin: '/admin', vendedor: '/vendedor', recepcao: '/recepcao' };
const params = new URLSearchParams(location.search);

function target(user) {
  const volta = params.get('volta') || '';
  const okPrefix = { admin: ['/admin', '/recepcao', '/vendedor'], vendedor: ['/vendedor'], recepcao: ['/recepcao'] }[user.role] || [];
  if (volta.startsWith('/') && !volta.startsWith('//') && okPrefix.some((p) => volta.startsWith(p))) return volta;
  return HOME[user.role] || '/';
}

(async () => {
  try {
    const me = await api('GET', '/api/auth/me', undefined, { redirectOnAuth: false, retries: 0 });
    if (me && me.user) location.replace(target(me.user));
  } catch { /* sem sessão: mostra o formulário */ }
})();

$('#username').focus();
$('#form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#submit'), err = $('#err');
  err.textContent = '';
  const username = $('#username').value.trim(), password = $('#password').value;
  if (!username || !password) { err.textContent = 'Informe usuário e senha.'; return; }
  btn.setAttribute('aria-busy', 'true');
  try {
    const r = await api('POST', '/api/auth/login', { username, password }, { redirectOnAuth: false });
    location.replace(target(r.user));
  } catch (ex) {
    err.textContent = ex.message;
    $('#password').select();
  } finally { btn.removeAttribute('aria-busy'); }
});
