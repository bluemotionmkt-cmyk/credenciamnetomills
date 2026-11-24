'use strict';
// Confere a versão do Node.js antes de iniciar (o banco usa o SQLite nativo do Node 22.13+).
const [maj, min] = process.versions.node.split('.').map(Number);
if (maj < 22 || (maj === 22 && min < 13)) {
  console.error(`\n  Node.js ${process.versions.node} encontrado, mas o sistema precisa do Node.js 22.13 ou mais novo.`);
  console.error('  Baixe e instale a versão LTS em https://nodejs.org (botão verde "LTS") e execute de novo.\n');
  process.exit(3);
}
module.exports = true;
