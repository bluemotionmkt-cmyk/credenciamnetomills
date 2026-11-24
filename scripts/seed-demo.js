'use strict';
/*
 * Popula o banco de DEMONSTRAÇÃO (data/demo.db) com dados fictícios.
 * Recusa-se a rodar no banco real do evento.
 * Uso: npm run seed-demo   (ou automaticamente no primeiro `npm run demo`)
 */
if (!process.argv.includes('--demo') && !process.env.MODE) process.argv.push('--demo');
const config = require('../server/config');
const { one, run, tx, now, setSetting } = require('../server/db');
const { hashPassword, participantCode } = require('../server/security');

const FIRST = ['Ana', 'Bruno', 'Carla', 'Diego', 'Eduarda', 'Felipe', 'Gabriela', 'Henrique', 'Isabela', 'João', 'Karina', 'Lucas', 'Mariana', 'Nicolas', 'Olívia', 'Paulo', 'Rafaela', 'Sérgio', 'Tatiane', 'Vinícius', 'Wagner', 'Yasmin', 'Rodrigo', 'Fernanda', 'Marcelo', 'Patrícia', 'Leandro', 'Juliana', 'Thiago', 'Camila', 'Renato', 'Aline', 'Gustavo', 'Débora', 'Otávio', 'Luciana'];
const LAST = ['Almeida', 'Barbosa', 'Cardoso', 'Duarte', 'Esteves', 'Ferreira', 'Gonçalves', 'Henriques', 'Lima', 'Martins', 'Nogueira', 'Oliveira', 'Pereira', 'Queiroz', 'Ribeiro', 'Santos', 'Teixeira', 'Vasconcelos', 'Moura', 'Campos', 'Pacheco', 'Rezende', 'Fontes', 'Siqueira', 'Brandão', 'Conceição'];
const MID = ['', '', '', 'de Souza', 'da Silva', 'dos Reis', 'Costa', 'Prado', ''];
const COMPANIES = ['Construtora Exemplo Alfa', 'Locadora Fictícia Beta', 'Indústria Modelo Gama', 'Engenharia Demonstração Delta', 'Logística Teste Ômega', 'Montagens Exemplo Sigma', 'Agro Fictício Lambda', 'Mineração Modelo Kappa', null, null, 'Shopping Exemplo Centro', 'Infraestrutura Demo Zeta'];
const DDD = ['11', '19', '21', '31', '41', '15', '16', '13'];
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const strip = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z]+/g, '.');

async function seed() {
  if (config.MODE === 'producao') throw new Error('O gerador de demonstração não roda no banco real.');
  if (one('SELECT COUNT(*) c FROM participants').c > 0) { console.log('Demonstração já possui dados.'); return; }
  const pw = await hashPassword('demo1234');
  const users = [
    ['Administrador Demo', 'admin', 'admin'],
    ['Recepção Demo', 'recepcao', 'recepcao'],
    ['Ana Souza (demo)', 'ana.souza', 'vendedor'],
    ['Bruno Lima (demo)', 'bruno.lima', 'vendedor'],
    ['Carla Mendes (demo)', 'carla.mendes', 'vendedor'],
    ['Diego Rocha (demo)', 'diego.rocha', 'vendedor'],
    ['Elisa Prado (demo)', 'elisa.prado', 'vendedor'],
  ];
  const ids = {};
  tx(() => {
    for (const [name, username, role] of users) {
      const existing = one('SELECT id FROM users WHERE username=?', username);
      ids[username] = existing ? existing.id : run('INSERT INTO users(name, username, role, password_hash, active, must_change_password, created_at, updated_at) VALUES (?,?,?,?,1,0,?,?)', name, username, role, pw, now(), now()).lastInsertRowid;
    }
    setSetting('event_name', 'Inauguração Mills Seminovos — Demonstração');
    setSetting('event_place', 'Ambiente de testes');

    const sellers = ['ana.souza', 'bruno.lima', 'carla.mendes', 'diego.rocha', 'elisa.prado'].map((u) => ids[u]);
    const weights = [0.32, 0.26, 0.2, 0.14, 0.08];
    const statuses = ['novo', 'novo', 'novo', 'em_contato', 'em_contato', 'em_negociacao', 'oportunidade', 'venda', 'sem_interesse'];
    const temps = ['quente', 'morno', 'morno', 'frio', null];
    const interests = ['Plataforma tesoura', 'Plataforma articulada', 'Plataforma telescópica', 'Manipulador telescópico', 'Linha amarela'];
    const station = one("SELECT id FROM stations WHERE kind='totem' ORDER BY id LIMIT 1");
    const usedPhones = new Set(), usedEmails = new Set();
    const N = 148;
    const start = Date.now() - 7 * 3600_000;
    for (let i = 0; i < N; i++) {
      const name = [pick(FIRST), pick(MID), pick(LAST)].filter(Boolean).join(' ');
      let phone; do { phone = pick(DDD) + '9' + String(Math.floor(10000000 + Math.random() * 89999999)); } while (usedPhones.has(phone));
      usedPhones.add(phone);
      let email; let k = 0; do { email = `${strip(name)}${k ? k : ''}@exemplo.com.br`; k++; } while (usedEmails.has(email));
      usedEmails.add(email);
      // Fluxo concentrado na abertura e após o almoço.
      const tFrac = Math.random() < 0.55 ? Math.random() * 0.35 : 0.45 + Math.random() * 0.5;
      const created = new Date(start + tFrac * (Date.now() - start)).toISOString();
      const source = Math.random() < 0.72 ? 'totem' : 'recepcao';
      const r = run(`INSERT INTO participants(code, seq, name, phone, email, company, privacy_ack_at, privacy_version, marketing_opt_in, source, station_id, created_at, updated_at, print_count, last_printed_at)
                     VALUES (?,?,?,?,?,?,?, '1', ?, ?, ?, ?, ?, 1, ?)`,
        participantCode(), i + 1, name, phone, email, pick(COMPANIES), created, Math.random() < 0.6 ? 1 : 0, source, station ? station.id : null, created, created, created);
      const pid = r.lastInsertRowid;
      run("INSERT INTO lead_events(participant_id,type,data,at) VALUES (?, 'credenciado', ?, ?)", pid, JSON.stringify({ origem: source }), created);
      if (Math.random() < 0.58) {
        let x = Math.random(), si = 0;
        while (si < weights.length - 1 && x > weights[si]) { x -= weights[si]; si++; }
        const seller = sellers[si];
        const capAt = new Date(Math.min(Date.now() - 60_000, Date.parse(created) + (5 + Math.random() * 120) * 60_000)).toISOString();
        const st = pick(statuses);
        const ints = interests.filter(() => Math.random() < 0.3);
        run('UPDATE participants SET captured_by=?, captured_at=?, lead_status=?, temperature=?, interests=? WHERE id=?', seller, capAt, st, pick(temps), JSON.stringify(ints), pid);
        run("INSERT INTO lead_events(participant_id,user_id,type,data,at) VALUES (?,?, 'captado', NULL, ?)", pid, seller, capAt);
      }
    }
  });
  console.log(`Demonstração criada (${config.DB_FILE}). Usuários: admin, recepcao, ana.souza, bruno.lima, carla.mendes, diego.rocha, elisa.prado — senha demo1234`);
}

if (require.main === module) seed().catch((e) => { console.error(e.message); process.exit(1); });
module.exports = { seed };
