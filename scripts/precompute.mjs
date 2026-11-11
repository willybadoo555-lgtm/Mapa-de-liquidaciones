// Precalcula data/latest.json con el mismo motor que el navegador.
// Los runners de GitHub están en EE. UU.: Binance y Bybit pueden responder 451/403.
// Esas fuentes se marcan y el mapa sigue con el resto. CoinGlass sale del fichero del repo.
import fs from 'fs';
import path from 'path';
import { runEngine } from '../src/engine.js';
import { http } from '../src/http.js';
import { prepareCoinGlass } from '../src/coinglass.js';
import { fetchHlTop } from '../src/hl.js';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const storePath = path.join(root, 'data', 'engine-store.json');
let mem = new Map();
if (fs.existsSync(storePath)) {
  try { mem = new Map(Object.entries(JSON.parse(fs.readFileSync(storePath, 'utf8')))); }
  catch (e) { console.warn('caché del motor ilegible, se empieza de cero:', e.message); mem = new Map(); }
}
const hlSeed = JSON.parse(fs.readFileSync(path.join(root, 'data', 'hl_seed.json'), 'utf8'));
try {
  const a = await fetchHlTop(http, 200);
  mem.set('hl_addrs', JSON.stringify({ ts: Date.now(), a }));
  console.log('leaderboard Hyperliquid', a.length);
} catch (e) {
  console.warn('leaderboard Hyperliquid:', e.message);
  if (!mem.has('hl_addrs')) mem.set('hl_addrs', JSON.stringify(hlSeed));
}
const store = {
  get: async (k) => (mem.has(k) ? mem.get(k) : null),
  set: async (k, v) => { mem.set(k, v); },
};
const rawCg = JSON.parse(fs.readFileSync(path.join(root, 'data', 'coinglass_latest.json'), 'utf8'));
let prevCg = null;
try { prevCg = JSON.parse(await store.get('last_cg')); } catch (_) { prevCg = null; }
const prepared = await prepareCoinGlass(http, rawCg, prevCg);
if (prepared.seed && prepared.seed.ok) {
  try { await store.set('last_cg', JSON.stringify(prepared.seed)); } catch (_) { /* */ }
}
const t0 = Date.now();
const r = await runEngine({
  http,
  hlTop: null,
  store,
  cgSeed: prepared.seed,
  wsLiqs: [],
  onProgress: (a, b) => process.stdout.write(`\rpeticiones ${a}/${b}   `),
});
process.stdout.write('\n');
if (prepared.notes && prepared.notes.length) r.DATA.notes = [...(r.DATA.notes || []), ...prepared.notes];
let slow = r.SLOW;
if (slow && Object.keys(slow.tf || {}).length) await store.set('last_slow', JSON.stringify(slow));
else {
  try { slow = JSON.parse(await store.get('last_slow')); } catch (_) { slow = null; }
  slow = slow && slow.tf ? slow : { upd: '—', tf: {} };
}
fs.writeFileSync(storePath, JSON.stringify(Object.fromEntries(mem)));
const outDir = path.join(root, 'dist', 'data');
fs.mkdirSync(outDir, { recursive: true });
fs.copyFileSync(path.join(root, 'data', 'coinglass_latest.json'), path.join(outDir, 'coinglass_latest.json'));
const pack = { DATA: r.DATA, SLOW: slow };
fs.writeFileSync(path.join(outDir, 'latest.json'), JSON.stringify(pack));
const tfs = { ...(r.DATA.tf || {}), ...(slow.tf || {}) };
const x = (r.DATA.tf && r.DATA.tf['1h']) || Object.values(tfs)[0];
const sec = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`tiempo ${sec}s · peticiones ${r.stats.req} · precio ${r.DATA.px} · ${r.DATA.upd} · OI ${(r.DATA.oi / 1e9).toFixed(2)} B$ · HL ${r.DATA.hln}`);
console.log('OK:', r.DATA.ok);
console.log('FAIL:', JSON.stringify(r.DATA.fail));
console.log('NOTAS:', (r.DATA.notes || []).join(' | ') || '—');
if (r.DATA.basis) console.log('basis', JSON.stringify(r.DATA.basis.ex));
for (const [f, row] of Object.entries(tfs)) {
  console.log(f, 'C', row.C, 'R', row.R, 'zm', row.zm, 'kSrc', row.kSrc, 'zonas', (row.zu || []).map((z) => (z[0] ? '↑' : '↓') + z[1] + ' ' + z[2] + 'M$ ' + z[3] + 'f').join(' · '));
}
const lines = [
  `### Precomputo`,
  `- Precio ${r.DATA.kf}: ${r.DATA.px}`,
  `- Actualización (Canarias): ${r.DATA.upd}`,
  `- OK: ${r.DATA.ok}`,
  `- Fallos: ${JSON.stringify(r.DATA.fail)}`,
  `- Notas: ${(r.DATA.notes || []).join(' · ') || '—'}`,
  `- CoinGlass: ${prepared.seed && prepared.seed.ok ? prepared.seed.at + ' peso ' + r.DATA.cgw : (prepared.seed && prepared.seed.err) || 'no'}`,
];
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
if (!r.DATA.px || !x || !(x.zm > 0) || !x.C || !String(x.hmL || '').length || !String(x.cd || '').replace(/~/g, '').length) {
  console.error('el mapa no tiene velas o intensidad; no se publica un JSON vacío');
  process.exit(1);
}
console.log('latest.json', (fs.statSync(path.join(outDir, 'latest.json')).size / 1024).toFixed(0), 'KB');
