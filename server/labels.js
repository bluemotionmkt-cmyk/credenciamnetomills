'use strict';
/*
 * Motor de etiquetas.
 * 1) Calcula o layout em "dots" da impressora (203/300 dpi) e monta um SVG.
 * 2) Rasteriza o SVG (resvg) com as fontes embarcadas e converte para 1 bit (preto/branco).
 * 3) Envolve o bitmap no idioma da impressora: ZPL (^GFA), TSPL (BITMAP) ou PDF (driver).
 * Resultado: a etiqueta impressa é idêntica à pré-visualização, com acentos, logo e QR nítido
 * em qualquer impressora térmica, sem depender das fontes internas de cada modelo.
 */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const QRCode = require('qrcode');
const fontkit = require('fontkit');
const { Resvg } = require('@resvg/resvg-js');
const PDFDocument = require('pdfkit');
const config = require('./config');
const V = require('../public/shared/validation');

const FONT_DIR = path.join(config.ASSETS_DIR, 'fonts');
const FONT_FILES = ['FiraSans-Regular.ttf', 'FiraSans-Medium.ttf', 'FiraSans-SemiBold.ttf', 'FiraSans-Bold.ttf'].map((f) => path.join(FONT_DIR, f));
const FONTS = {
  400: fontkit.openSync(FONT_FILES[0]),
  500: fontkit.openSync(FONT_FILES[1]),
  600: fontkit.openSync(FONT_FILES[2]),
  700: fontkit.openSync(FONT_FILES[3]),
};
const LOGO_FILE = path.join(config.ASSETS_DIR, 'logo-etiqueta.png');
const LOGO_URI = 'data:image/png;base64,' + fs.readFileSync(LOGO_FILE).toString('base64');
const LOGO_RATIO = (() => { const b = fs.readFileSync(LOGO_FILE); return b.readUInt32BE(16) / b.readUInt32BE(20); })();

const PRESETS = {
  '100x60': { width_mm: 100, height_mm: 60 },
  '100x50': { width_mm: 100, height_mm: 50 },
  '90x50': { width_mm: 90, height_mm: 50 },
  '80x50': { width_mm: 80, height_mm: 50 },
  '60x40': { width_mm: 60, height_mm: 40 },
  '62x100': { width_mm: 62, height_mm: 100 },
};

const DEFAULT_LABEL = {
  preset: '100x60', width_mm: 100, height_mm: 60, dpi: 203, gap_mm: 3, margin_mm: 3,
  language: 'zpl', media: 'gap', darkness: 20, speed: 4, offset_x: 0, offset_y: 0,
  rotate180: false, show_logo: true, show_company: true, show_phone: false, show_number: true, copies: 1,
};

function normalizeLabelConfig(input = {}) {
  const c = { ...DEFAULT_LABEL, ...input };
  const num = (v, min, max, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d; };
  c.width_mm = num(c.width_mm, 25, 120, 100);
  c.height_mm = num(c.height_mm, 15, 200, 60);
  c.dpi = [152, 203, 300, 600].includes(Number(c.dpi)) ? Number(c.dpi) : 203;
  c.gap_mm = num(c.gap_mm, 0, 20, 3);
  c.margin_mm = num(c.margin_mm, 0, 10, 3);
  c.language = ['zpl', 'tspl', 'pdf'].includes(c.language) ? c.language : 'zpl';
  c.media = ['gap', 'continuous', 'blackmark'].includes(c.media) ? c.media : 'gap';
  c.darkness = Math.round(num(c.darkness, 0, 30, 20));
  c.speed = Math.round(num(c.speed, 1, 8, 4));
  c.offset_x = Math.round(num(c.offset_x, -200, 200, 0));
  c.offset_y = Math.round(num(c.offset_y, -200, 200, 0));
  c.copies = Math.round(num(c.copies, 1, 5, 1));
  for (const k of ['rotate180', 'show_logo', 'show_company', 'show_phone', 'show_number']) c[k] = c[k] === true || c[k] === 'true' || c[k] === 1;
  return c;
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const textWidth = (s, size, weight = 700) => {
  const f = FONTS[weight] || FONTS[400];
  return (f.layout(String(s)).advanceWidth / f.unitsPerEm) * size;
};

function wrap(text, size, maxW, weight, maxLines) {
  const words = text.split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    const tryLine = cur ? cur + ' ' + w : w;
    if (textWidth(tryLine, size, weight) <= maxW) cur = tryLine;
    else {
      if (!cur) return null; // palavra sozinha não cabe
      lines.push(cur); cur = w;
      if (textWidth(cur, size, weight) > maxW) return null;
    }
  }
  if (cur) lines.push(cur);
  return lines.length <= maxLines ? lines : null;
}

function nameVariants(full) {
  const parts = full.split(' ');
  const out = [full];
  if (parts.length > 2) {
    const first = parts[0], last = parts[parts.length - 1];
    const mid = parts.slice(1, -1);
    const isPart = (w) => ['da', 'de', 'do', 'das', 'dos', 'e'].includes(w.toLowerCase());
    out.push([first, ...mid.map((w) => (isPart(w) ? w : w[0].toUpperCase() + '.')), last].join(' '));
    out.push([first, ...mid.filter((w) => !isPart(w)).map((w) => w[0].toUpperCase() + '.'), last].join(' '));
    out.push(`${first} ${last}`);
  }
  return [...new Set(out)];
}

function fitText(text, maxW, startSize, minSize, weight, maxLines) {
  for (const variant of nameVariants(text)) {
    for (let size = startSize; size >= minSize; size -= Math.max(1, Math.round(size * 0.04))) {
      const lines = wrap(variant, size, maxW, weight, maxLines);
      if (lines) return { lines, size };
    }
  }
  // Último recurso: corta com reticências no tamanho mínimo.
  let s = text;
  while (s.length > 3 && textWidth(s + '…', minSize, weight) > maxW) s = s.slice(0, -1);
  return { lines: [s + '…'], size: minSize };
}

function ellipsize(text, size, maxW, weight) {
  if (textWidth(text, size, weight) <= maxW) return text;
  let s = text;
  while (s.length > 1 && textWidth(s + '…', size, weight) > maxW) s = s.slice(0, -1);
  return s.trimEnd() + '…';
}

function qrPath(code, x0, y0, mod) {
  const qr = QRCode.create(code, { errorCorrectionLevel: 'Q' });
  const n = qr.modules.size;
  const d = [];
  for (let r = 0; r < n; r++) {
    let c = 0;
    while (c < n) {
      if (qr.modules.get(r, c)) {
        let run = 1;
        while (c + run < n && qr.modules.get(r, c + run)) run++;
        d.push(`M${x0 + c * mod},${y0 + r * mod}h${run * mod}v${mod}h-${run * mod}z`);
        c += run;
      } else c++;
    }
  }
  return { d: d.join(''), n };
}
const qrModules = (code) => QRCode.create(code, { errorCorrectionLevel: 'Q' }).modules.size;

/** Monta o SVG da etiqueta em unidades de dots. */
function buildSvg(p, cfgIn) {
  const cfg = normalizeLabelConfig(cfgIn);
  const dpmm = cfg.dpi / 25.4;
  const W = Math.round(cfg.width_mm * dpmm);
  const H = Math.round(cfg.height_mm * dpmm);
  const m = Math.round(cfg.margin_mm * dpmm);
  const name = V.collapse(p.name || 'Participante');
  const company = cfg.show_company && p.company ? V.collapse(p.company) : '';
  const phone = cfg.show_phone && p.phone ? V.formatPhone(p.phone) : '';
  const number = cfg.show_number && p.seq != null ? `Credencial nº ${String(p.seq).padStart(4, '0')}` : '';
  const code = p.code;
  const n = qrModules(code);
  const els = [];
  const text = (x, y, size, weight, str, anchor = 'start') =>
    els.push(`<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-family="Fira Sans" font-weight="${weight}" font-size="${size.toFixed(1)}" text-anchor="${anchor}" fill="#000">${esc(str)}</text>`);

  const landscape = W >= H * 1.15;
  const footer = [];
  if (phone) footer.push({ str: phone, weight: 400 });
  if (number) footer.push({ str: number, weight: 600 });
  if (code) footer.push({ str: code, weight: 500 });
  const fitCompany = (maxW, base, min) => {
    if (!company) return null;
    for (let s = base; s >= min; s -= 1) if (textWidth(company, s, 500) <= maxW) return { lines: [company], size: s };
    const two = wrap(company, min, maxW, 500, 2);
    return two ? { lines: two, size: min } : { lines: [ellipsize(company, min, maxW, 500)], size: min };
  };
  if (landscape) {
    const qrBox = Math.min(H - 2 * m, W * 0.36);
    const mod = Math.max(2, Math.floor(qrBox / (n + 2)));
    const qrSize = mod * n;
    const qrX = W - m - mod - qrSize;
    const qrY = Math.round((H - qrSize) / 2);
    els.push(`<path d="${qrPath(code, qrX, qrY, mod).d}" fill="#000"/>`);
    const colX = m;
    const colW = qrX - mod - Math.round(3 * dpmm) - colX;
    let top = m;
    if (cfg.show_logo) {
      let lh = Math.round(H * 0.19);
      let lw = Math.round(lh * LOGO_RATIO);
      if (lw > colW * 0.7) { lw = Math.round(colW * 0.7); lh = Math.round(lw / LOGO_RATIO); }
      els.push(`<image x="${colX}" y="${top}" width="${lw}" height="${lh}" href="${LOGO_URI}"/>`);
      top += lh + Math.round(2.5 * dpmm);
    }
    const small = Math.max(2.3 * dpmm, H * 0.05);
    const footerH = footer.length * small * 1.25;
    const bottom = H - m - footerH - Math.round(2 * dpmm);
    const comp = fitCompany(colW, Math.max(2.6 * dpmm, Math.min(4.6 * dpmm, H * 0.08)), 2.4 * dpmm);
    const compH = comp ? comp.lines.length * comp.size * 1.15 + comp.size * 0.35 : 0;
    const fit = fitText(name, colW, Math.min(H * 0.17, (bottom - top - compH) / 2.15), 2.6 * dpmm, 700, 2);
    const blockH = fit.lines.length * fit.size * 1.06 + compH;
    let ty = top + Math.max(0, (bottom - top - blockH) / 2) + fit.size * 0.86;
    for (const line of fit.lines) { text(colX, ty, fit.size, 700, line); ty += fit.size * 1.06; }
    if (comp) {
      ty += comp.size * 0.35 - fit.size * 0.06;
      for (const line of comp.lines) { text(colX, ty, comp.size, 500, line); ty += comp.size * 1.15; }
    }
    let fy = H - m - (footer.length - 1) * small * 1.25 - small * 0.22;
    for (const f of footer) { text(colX, fy, small, f.weight, ellipsize(f.str, small, colW, f.weight)); fy += small * 1.25; }
  } else {
    // Retrato: logo, nome e empresa centralizados; QR embaixo.
    const cx = W / 2;
    let top = m;
    const colW = W - 2 * m;
    if (cfg.show_logo) {
      let lw = Math.round(colW * 0.5);
      let lh = Math.round(lw / LOGO_RATIO);
      if (lh > H * 0.14) { lh = Math.round(H * 0.14); lw = Math.round(lh * LOGO_RATIO); }
      els.push(`<image x="${Math.round(cx - lw / 2)}" y="${top}" width="${lw}" height="${lh}" href="${LOGO_URI}"/>`);
      top += lh + Math.round(3 * dpmm);
    }
    const small = Math.max(2.3 * dpmm, W * 0.042);
    const qrBox = Math.min(colW * 0.8, H * 0.42);
    const mod = Math.max(2, Math.floor(qrBox / (n + 2)));
    const qrSize = mod * n;
    const qrY = Math.round(H - m - footer.length * small * 1.25 - mod - qrSize);
    els.push(`<path d="${qrPath(code, Math.round(cx - qrSize / 2), qrY, mod).d}" fill="#000"/>`);
    const bottom = qrY - mod;
    const comp = fitCompany(colW, Math.max(2.6 * dpmm, Math.min(4.6 * dpmm, W * 0.06)), 2.4 * dpmm);
    const compH = comp ? comp.lines.length * comp.size * 1.15 + comp.size * 0.35 : 0;
    const fit = fitText(name, colW, Math.min(W * 0.12, (bottom - top - compH) / 2.15), 2.6 * dpmm, 700, 2);
    const blockH = fit.lines.length * fit.size * 1.06 + compH;
    let ty = top + Math.max(0, (bottom - top - blockH) / 2) + fit.size * 0.86;
    for (const line of fit.lines) { text(cx, ty, fit.size, 700, line, 'middle'); ty += fit.size * 1.06; }
    if (comp) {
      ty += comp.size * 0.35 - fit.size * 0.06;
      for (const line of comp.lines) { text(cx, ty, comp.size, 500, line, 'middle'); ty += comp.size * 1.15; }
    }
    let fy = qrY + qrSize + mod + small * 0.9;
    for (const f of footer) { text(cx, fy, small, f.weight, ellipsize(f.str, small, colW, f.weight), 'middle'); fy += small * 1.25; }
  }

  const inner = els.join('');
  const tx = cfg.offset_x, ty = cfg.offset_y;
  const transform = cfg.rotate180 ? `rotate(180 ${W / 2} ${H / 2}) translate(${tx} ${ty})` : `translate(${tx} ${ty})`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    `<rect width="${W}" height="${H}" fill="#fff"/><g transform="${transform}">${inner}</g></svg>`;
  return { svg, W, H, cfg };
}

/** Rasteriza e converte para bitmap de 1 bit (1 = preto), empacotado MSB-first por linha. */
function rasterize(p, cfgIn) {
  const { svg, W, H, cfg } = buildSvg(p, cfgIn);
  const r = new Resvg(svg, {
    background: '#ffffff',
    fitTo: { mode: 'original' },
    font: { fontFiles: FONT_FILES, loadSystemFonts: false, defaultFontFamily: 'Fira Sans' },
  }).render();
  const px = r.pixels; // RGBA
  const bpr = Math.ceil(W / 8);
  const bits = Buffer.alloc(bpr * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const lum = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
      if (lum < 150) bits[y * bpr + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return { W, H, bpr, bits, cfg, svg, png: r.asPng() };
}

function toZPL(ras) {
  const { W, H, bpr, bits, cfg } = ras;
  const hex = bits.toString('hex').toUpperCase();
  const mn = cfg.media === 'continuous' ? 'N' : cfg.media === 'blackmark' ? 'M' : 'Y';
  const zpl = [
    `~SD${String(cfg.darkness).padStart(2, '0')}`,
    '^XA', '^CI28', `^PW${W}`, `^LL${H}`, '^LH0,0', `^MN${mn}`, '^MMT', '^PON', `^PR${cfg.speed}`,
    `^FO0,0^GFA,${bpr * H},${bpr * H},${bpr},${hex}^FS`,
    `^PQ${cfg.copies},0,1,N`, '^XZ', '',
  ].join('\n');
  return Buffer.from(zpl, 'ascii');
}

function toTSPL(ras) {
  const { H, bpr, bits, cfg } = ras;
  const inv = Buffer.from(bits.map((b) => ~b & 0xff)); // TSPL: bit 0 = ponto impresso
  const gap = cfg.media === 'continuous' ? 'GAP 0 mm,0 mm' : cfg.media === 'blackmark' ? `BLINE ${cfg.gap_mm} mm,0 mm` : `GAP ${cfg.gap_mm} mm,0 mm`;
  const head = [
    `SIZE ${cfg.width_mm} mm,${cfg.height_mm} mm`, gap, 'DIRECTION 1,0', 'REFERENCE 0,0',
    `DENSITY ${Math.round((cfg.darkness / 30) * 15)}`, `SPEED ${cfg.speed}`, 'SET TEAR ON', 'CLS',
    `BITMAP 0,0,${bpr},${H},0,`,
  ].join('\r\n');
  return Buffer.concat([Buffer.from(head, 'ascii'), inv, Buffer.from(`\r\nPRINT 1,${cfg.copies}\r\n`, 'ascii')]);
}

function toPDF(ras) {
  const { cfg } = ras;
  return new Promise((resolve, reject) => {
    const wpt = (cfg.width_mm * 72) / 25.4, hpt = (cfg.height_mm * 72) / 25.4;
    const doc = new PDFDocument({ size: [wpt, hpt], margin: 0, autoFirstPage: true, info: { Title: 'Etiqueta Mills Seminovos' } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.image(monoPng(ras), 0, 0, { width: wpt, height: hpt });
    for (let i = 1; i < cfg.copies; i++) { doc.addPage({ size: [wpt, hpt], margin: 0 }); doc.image(monoPng(ras), 0, 0, { width: wpt, height: hpt }); }
    doc.end();
  });
}

// PNG de 1 bit (exatamente o que será impresso) para pré-visualização.
function monoPng(ras) {
  const { W, H, bpr, bits } = ras;
  const raw = Buffer.alloc((bpr + 1) * H);
  for (let y = 0; y < H; y++) {
    raw[y * (bpr + 1)] = 0;
    for (let i = 0; i < bpr; i++) raw[y * (bpr + 1) + 1 + i] = ~bits[y * bpr + i] & 0xff; // PNG cinza 1 bit: 1 = branco
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 1; ihdr[9] = 0; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Gera o conteúdo pronto para a impressora conforme o idioma configurado. */
async function renderJob(participant, cfgIn) {
  const ras = rasterize(participant, cfgIn);
  const lang = ras.cfg.language;
  const data = lang === 'zpl' ? toZPL(ras) : lang === 'tspl' ? toTSPL(ras) : await toPDF(ras);
  return { format: lang, data, width: ras.W, height: ras.H };
}

const TEST_PARTICIPANT = { name: 'Teste de Impressão', company: 'Mills Seminovos', phone: '19999990000', seq: 0, code: 'MSTESTE23456' };

module.exports = { PRESETS, DEFAULT_LABEL, normalizeLabelConfig, buildSvg, rasterize, monoPng, toZPL, toTSPL, toPDF, renderJob, TEST_PARTICIPANT };
