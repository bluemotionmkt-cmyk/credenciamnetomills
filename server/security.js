'use strict';
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');

const BCRYPT_COST = 11;

const hashPassword = (pw) => bcrypt.hash(pw, BCRYPT_COST);
const verifyPassword = (pw, hash) => bcrypt.compare(pw, hash);
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

// Alfabeto sem caracteres ambíguos (0/O, 1/I/L). Só letras maiúsculas e dígitos:
// leitores USB de QR emulam teclado e trocam símbolos em layouts ABNT2 — alfanumérico não sofre com isso.
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
function randomCode(len) {
  const bytes = crypto.randomBytes(len * 2);
  let out = '';
  for (let i = 0; out.length < len; i++) {
    const v = bytes[i % bytes.length];
    if (v < 248) out += ALPHABET[v % ALPHABET.length]; // 248 = 8*31, evita viés
    if (i > len * 8) return randomCode(len);
  }
  return out;
}
// Código da credencial: "MS" + 10 caracteres aleatórios (~49 bits). Não contém dado pessoal.
const participantCode = () => 'MS' + randomCode(10);

function tempPassword() {
  // Senha temporária legível: 3 blocos de 4 (ex.: K7QM-4XTZ-9PAH)
  return [randomCode(4), randomCode(4), randomCode(4)].join('-');
}

function passwordProblems(pw) {
  if (typeof pw !== 'string' || pw.length < 8) return 'A senha precisa ter pelo menos 8 caracteres.';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'Use letras e números na senha.';
  return null;
}

// Limitador simples em memória (por chave), janela deslizante.
class RateLimiter {
  constructor({ windowMs, max }) { this.windowMs = windowMs; this.max = max; this.hits = new Map(); }
  check(key) {
    const t = Date.now();
    const arr = (this.hits.get(key) || []).filter((x) => t - x < this.windowMs);
    if (arr.length >= this.max) { this.hits.set(key, arr); return false; }
    arr.push(t); this.hits.set(key, arr);
    if (this.hits.size > 5000) for (const [k, v] of this.hits) if (!v.length || t - v[v.length - 1] > this.windowMs) this.hits.delete(k);
    return true;
  }
  reset(key) { this.hits.delete(key); }
}

module.exports = { hashPassword, verifyPassword, sha256, randomToken, participantCode, tempPassword, passwordProblems, RateLimiter, randomCode };
