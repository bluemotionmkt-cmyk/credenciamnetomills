'use strict';
/*
 * Preparação da máquina servidora: cria .env a partir do modelo e verifica a versão do Node.
 * O administrador inicial e as estações padrão são criados na primeira execução de `npm start`.
 */
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
require('./check-node');
const env = path.join(root, '.env');
if (!fs.existsSync(env)) { fs.copyFileSync(path.join(root, '.env.example'), env); console.log('Arquivo .env criado a partir de .env.example.'); }
else console.log('.env já existe — mantido.');
fs.mkdirSync(path.join(root, 'data'), { recursive: true });
console.log('Pronto. Inicie com: npm start');
