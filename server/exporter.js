'use strict';
const ExcelJS = require('exceljs');
const { getSettings } = require('./db');
const P = require('./participants');
const V = require('../public/shared/validation');

const SOURCE = { totem: 'Totem', recepcao: 'Recepção', admin: 'Painel' };

function fmtDate(iso, tz) {
  if (!iso) return '';
  return new Intl.DateTimeFormat('pt-BR', { timeZone: tz, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

const COLUMNS = [
  ['Nº', (p) => p.seq, 8],
  ['Código', (p) => p.code, 16],
  ['Nome', (p) => p.name, 32],
  ['Telefone', (p) => V.formatPhone(p.phone || ''), 17],
  ['E-mail', (p) => p.email, 32],
  ['Empresa', (p) => p.company || '', 28],
  ['Credenciado em', (p, tz) => fmtDate(p.created_at, tz), 18],
  ['Origem', (p) => SOURCE[p.source] || p.source, 11],
  ['Aceite de privacidade', (p, tz) => (p.privacy_ack_at ? `v${p.privacy_version || '1'} em ${fmtDate(p.privacy_ack_at, tz)}` : ''), 24],
  ['Aceita ofertas', (p) => (p.marketing_opt_in ? 'Sim' : 'Não'), 13],
  ['Status do lead', (p) => P.LEAD_STATUS[p.lead_status] || p.lead_status, 22],
  ['Vendedor', (p) => P.sellerName(p.captured_by) || '', 22],
  ['Captado em', (p, tz) => fmtDate(p.captured_at, tz), 18],
  ['Temperatura', (p) => P.TEMPERATURES[p.temperature] || '', 12],
  ['Interesses', (p) => (p.interests ? JSON.parse(p.interests).join(', ') : ''), 30],
  ['Observações', (p) => p.notes || '', 40],
  ['Etiquetas impressas', (p) => p.print_count, 10],
];

// Evita injeção de fórmulas ao abrir no Excel (dados vêm do público).
const safeCell = (v) => {
  if (v == null) return '';
  const s = String(v);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
};

function toCSV(rows) {
  const tz = getSettings().timezone;
  const q = (v) => {
    const s = safeCell(v);
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [COLUMNS.map((c) => q(c[0])).join(';')];
  for (const p of rows) lines.push(COLUMNS.map((c) => q(c[1](p, tz))).join(';'));
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}

async function toXLSX(rows, title) {
  const s = getSettings();
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Mills Seminovos — Credenciamento';
  wb.created = new Date();
  const ws = wb.addWorksheet(title.slice(0, 31), { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = COLUMNS.map(([header, , width]) => ({ header, width }));
  for (const p of rows) ws.addRow(COLUMNS.map((c) => safeCell(c[1](p, s.timezone))));
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF004042' } };
  head.alignment = { vertical: 'middle' };
  head.height = 22;
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLUMNS.length } };
  const info = wb.addWorksheet('Sobre');
  info.addRow(['Inauguração', s.event_name]);
  info.addRow(['Gerado em', fmtDate(new Date().toISOString(), s.timezone)]);
  info.addRow(['Registros', rows.length]);
  info.addRow(['Aviso', 'Contém dados pessoais (LGPD). Compartilhe apenas com pessoas autorizadas.']);
  info.getColumn(1).width = 14; info.getColumn(2).width = 80;
  return Buffer.from(await wb.xlsx.writeBuffer());
}

module.exports = { toCSV, toXLSX };
