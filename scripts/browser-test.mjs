// Prueba de verdad: la página publicada localmente pinta velas y mapa, el filtro y
// Zonas persisten, En vivo intenta el ticker y Actualizar recalcula.
import http from 'http';
import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dist = path.join(root, 'dist');
const shots = '/opt/cursor/artifacts';
fs.mkdirSync(shots, { recursive: true });

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  let p = decodeURIComponent(u.pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(dist, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end('no'); return;
  }
  res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(4173, '127.0.0.1', r));

const browser = await chromium.launch({
  executablePath: process.env.CHROME || '/usr/local/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, locale: 'es-ES' });
const fails = [];
page.on('pageerror', (e) => fails.push('pageerror ' + e.message));
const sample = () => page.evaluate(() => {
  const c = document.querySelector('canvas');
  if (!c) return null;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const w = c.width, h = c.height;
  const d = ctx.getImageData(0, 0, w, h).data;
  let green = 0, red = 0, blue = 0, mag = 0, hot = 0;
  for (let i = 0; i < d.length; i += 16) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    if (r < 18 && g < 24 && b < 32) continue;
    hot++;
    if (g > 100 && g > r + 25 && g > b - 5) green++;
    else if (r > 140 && r > g + 30 && r > b + 20) red++;
    else if (b > 70 && b > r + 15 && b >= g - 10) blue++;
    else if (r > 90 && b > 80 && r + b > g * 2) mag++;
  }
  return { w, h, hot, green, red, blue, mag, heat: blue + mag };
});
function assert(cond, msg) { if (!cond) throw new Error(msg); }

try {
  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
  await page.waitForSelector('canvas', { timeout: 20000 });
  await page.waitForSelector('text=PF_XBTUSD', { timeout: 15000 });
  await page.getByText('Última actualización').waitFor({ timeout: 10000 });
  await page.waitForFunction(() => (document.getElementById('filtro-label') || {}).textContent?.includes('Filtro 3'), null, { timeout: 10000 });
  await page.waitForTimeout(600);
  const before = await sample();
  console.log('pixels inicial', JSON.stringify(before));
  assert(before && before.green > 15, 'no hay velas verdes: ' + JSON.stringify(before));
  assert(before.red > 8, 'no hay velas rojas: ' + JSON.stringify(before));
  assert(before.heat > 40, 'no hay mapa de calor: ' + JSON.stringify(before));
  const body = await page.locator('body').innerText();
  assert(body.includes('hora de Canarias'), 'falta la hora de Canarias');
  assert(body.includes('ESTIMADO'), 'falta la marca ESTIMADO');
  assert(/fuente/.test(body) && /M\$/.test(body), 'falta la lectura de zonas');
  assert(/longs \(se liquidan si baja\)/.test(body) && /shorts \(si sube\)/.test(body), 'falta la leyenda');
  await page.screenshot({ path: path.join(shots, 'heatmap-desktop.png'), fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  const mobile = await sample();
  assert(mobile && mobile.heat > 10 && mobile.green + mobile.red > 5, 'el mapa no pinta en móvil: ' + JSON.stringify(mobile));
  await page.screenshot({ path: path.join(shots, 'heatmap-mobile.png'), fullPage: false });
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.waitForTimeout(300);

  const zonasBtn = page.getByRole('button', { name: 'Zonas' });
  assert(await zonasBtn.getAttribute('aria-pressed') === 'true', 'Zonas debería empezar activado');
  await page.getByRole('button', { name: 'Más filtro' }).click();
  await page.waitForFunction(() => document.getElementById('filtro-label').textContent.includes('Filtro 4'), null, { timeout: 5000 });
  const hidden = await page.locator('#filtro-label').innerText();
  assert(/oculta < .+ M\$/.test(hidden), 'el filtro no dice qué oculta: ' + hidden);
  await page.waitForTimeout(250);
  const mid = await sample();
  console.log('pixels filtro 4', JSON.stringify(mid));
  assert(mid.heat < before.heat, `el filtro no ocultó celdas (${before.heat} -> ${mid.heat})`);
  const thrStored = await page.evaluate(() => localStorage.getItem('liqmap.thr'));
  assert(thrStored === '4', 'liqmap.thr = ' + thrStored);

  const sig = () => page.evaluate(() => {
    const c = document.querySelector('canvas');
    const d = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data;
    let h = 2166136261;
    for (let i = 0; i < d.length; i += 32) h = Math.imul(h ^ d[i] ^ d[i + 1] ^ d[i + 2], 16777619);
    return h >>> 0;
  });
  const withZones = await sig();
  await zonasBtn.click();
  await page.waitForTimeout(250);
  assert(await zonasBtn.getAttribute('aria-pressed') === 'false', 'Zonas no se apagó');
  const zonasStored = await page.evaluate(() => localStorage.getItem('liqmap.zonas'));
  assert(zonasStored === '0', 'liqmap.zonas = ' + zonasStored);
  const noZones = await sig();
  assert(noZones !== withZones, 'ocultar Zonas no cambió el gráfico');
  await page.screenshot({ path: path.join(shots, 'heatmap-filtro-zonas.png'), fullPage: false });
  await zonasBtn.click();
  await page.getByRole('button', { name: 'Menos filtro' }).click();

  await page.getByRole('button', { name: 'En vivo' }).click();
  await page.waitForFunction(() => {
    const t = document.body.innerText;
    return t.includes('websocket') || t.includes('REST') || t.includes('conectando') || t.includes('Kraken Futures');
  }, null, { timeout: 20000 });
  await page.waitForTimeout(6000);
  const liveTxt = await page.locator('body').innerText();
  console.log('en vivo:', (liveTxt.match(/●[^\n]+|Kraken Futures:[^\n]+|conectando…/) || ['sin línea'])[0]);
  await page.getByRole('button', { name: 'En vivo' }).click();

  const btn = page.getByRole('button', { name: 'Actualizar ahora' });
  await btn.click();
  await page.waitForFunction(() => /Actualizando|Descargando/.test(document.body.innerText), null, { timeout: 15000 });
  await page.waitForFunction(() => {
    const b = document.querySelector('button[aria-label="Actualizar ahora"]');
    return b && !b.disabled && /Actualizar/.test(b.textContent) && !/Actualizando/.test(b.textContent);
  }, null, { timeout: 240000 });
  await page.waitForSelector('canvas', { timeout: 15000 });
  await page.waitForTimeout(500);
  const after = await sample();
  console.log('pixels tras actualizar', JSON.stringify(after));
  assert(after.green > 10 && after.red > 5 && after.heat > 20, 'tras Actualizar el mapa no pinta: ' + JSON.stringify(after));
  const fuentes = await page.locator('#fuentes').innerText();
  console.log('--- FUENTES ---\n' + fuentes);
  fs.writeFileSync(path.join(shots, 'fuentes.txt'), fuentes);
  await page.screenshot({ path: path.join(shots, 'heatmap-despues-actualizar.png'), fullPage: true });
  assert(fails.length === 0, fails.join('\n'));
  console.log('BROWSER TEST OK');
} finally {
  await browser.close();
  server.close();
}
