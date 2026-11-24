/* Validações compartilhadas: o mesmo arquivo roda no servidor (require) e no navegador (<script>). */
(function (root) {
  'use strict';

  const PARTICLES = new Set(['da', 'de', 'do', 'das', 'dos', 'e', 'di', 'du', 'del', 'van', 'von']);
  const VALID_DDD = new Set([
    11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28, 31, 32, 33, 34, 35, 37, 38,
    41, 42, 43, 44, 45, 46, 47, 48, 49, 51, 53, 54, 55, 61, 62, 63, 64, 65, 66, 67, 68, 69,
    71, 73, 74, 75, 77, 79, 81, 82, 83, 84, 85, 86, 87, 88, 89, 91, 92, 93, 94, 95, 96, 97, 98, 99,
  ]);

  const collapse = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const digitsOnly = (s) => String(s == null ? '' : s).replace(/\D+/g, '');

  function capitalizeWord(w, i) {
    const lower = w.toLocaleLowerCase('pt-BR');
    if (i > 0 && PARTICLES.has(lower)) return lower;
    // Mantém siglas digitadas (ex.: "JR", "II") e trata hífen/apóstrofo.
    if (w.length <= 3 && w === w.toUpperCase() && /[A-Z]/.test(w) && i > 0) return w;
    return lower.split(/([-'’])/).map((p) => (p.length && !/[-'’]/.test(p) ? p[0].toLocaleUpperCase('pt-BR') + p.slice(1) : p)).join('');
  }

  function normalizeName(input) {
    const s = collapse(input).slice(0, 120);
    if (!s) return { ok: false, error: 'Informe seu nome completo.' };
    if (!/^[\p{L}][\p{L}\p{M} .'’-]*$/u.test(s)) return { ok: false, error: 'Use apenas letras no nome.' };
    const words = s.split(' ').filter((w) => w.replace(/[.'’-]/g, '').length > 0);
    if (words.length < 2) return { ok: false, error: 'Informe nome e sobrenome.' };
    const allSameCase = s === s.toUpperCase() || s === s.toLowerCase();
    const value = allSameCase ? words.map(capitalizeWord).join(' ') : words.join(' ');
    return { ok: true, value };
  }

  function normalizePhone(input) {
    let d = digitsOnly(input);
    if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
    if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
    if (d.length === 12 && d.startsWith('0')) d = d.slice(1);
    if (!d) return { ok: false, error: 'Informe seu telefone com DDD.' };
    if (d.length !== 10 && d.length !== 11) return { ok: false, error: 'Telefone incompleto. Use DDD + número.' };
    if (!VALID_DDD.has(parseInt(d.slice(0, 2), 10))) return { ok: false, error: 'DDD inválido.' };
    if (d.length === 11 && d[2] !== '9') return { ok: false, error: 'Celular deve começar com 9 após o DDD.' };
    if (/^(\d)\1+$/.test(d.slice(2))) return { ok: false, error: 'Telefone inválido.' };
    return { ok: true, value: d };
  }

  function formatPhone(d) {
    d = digitsOnly(d);
    if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
    if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    return d;
  }

  // Formatação progressiva enquanto a pessoa digita.
  function maskPhoneInput(raw) {
    const d = digitsOnly(raw).slice(0, 11);
    if (d.length === 0) return '';
    if (d.length <= 2) return `(${d}`;
    if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
    if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  }

  const EMAIL_RE = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.[a-z]{2,}$/;
  function normalizeEmail(input) {
    const s = collapse(input).toLowerCase().replace(/\s/g, '');
    if (!s) return { ok: false, error: 'Informe seu e-mail.' };
    if (s.length > 254 || !EMAIL_RE.test(s) || s.includes('..')) return { ok: false, error: 'E-mail inválido. Confira o endereço.' };
    return { ok: true, value: s };
  }

  const COMMON_DOMAINS = [
    'gmail.com', 'hotmail.com', 'outlook.com', 'yahoo.com.br', 'yahoo.com', 'icloud.com',
    'live.com', 'uol.com.br', 'bol.com.br', 'terra.com.br', 'outlook.com.br', 'hotmail.com.br', 'globo.com', 'ig.com.br',
  ];
  function distance(a, b) {
    const m = a.length, n = b.length;
    const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
    for (let j = 1; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) dp[i][j] = Math.min(dp[i][j], dp[i - 2][j - 2] + 1);
    }
    return dp[m][n];
  }
  // Sugere correção para erros comuns de digitação no domínio (ex.: gmial.com → gmail.com).
  function suggestEmail(email) {
    const at = String(email || '').lastIndexOf('@');
    if (at < 1) return null;
    const user = email.slice(0, at), dom = email.slice(at + 1).toLowerCase();
    if (!dom || COMMON_DOMAINS.includes(dom)) return null;
    let best = null, bestD = 3;
    for (const c of COMMON_DOMAINS) {
      const dd = distance(dom, c);
      if (dd < bestD) { bestD = dd; best = c; }
    }
    if (best && bestD <= 2 && dom.length >= 5) return `${user}@${best}`;
    return null;
  }

  function normalizeCompany(input) {
    const s = collapse(input).slice(0, 120);
    return { ok: true, value: s || null };
  }

  const firstName = (name) => collapse(name).split(' ')[0] || '';

  function maskEmail(e) {
    if (!e) return '';
    const [u, d] = String(e).split('@');
    if (!d) return '•••';
    return `${u.slice(0, 2)}${'•'.repeat(Math.max(2, Math.min(6, u.length - 2)))}@${d}`;
  }
  function maskPhone(d) {
    d = digitsOnly(d);
    if (d.length < 10) return '•••';
    return `(${d.slice(0, 2)}) •••••-${d.slice(-4)}`;
  }

  const api = {
    collapse, digitsOnly, normalizeName, normalizePhone, formatPhone, maskPhoneInput,
    normalizeEmail, suggestEmail, normalizeCompany, firstName, maskEmail, maskPhone,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MSValidation = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
