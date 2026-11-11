// Lee data/coinglass_latest.json (v1 o v2), lo pasa a precio Kraken Futures y lo deja
// en el formato compacto que consume el motor (grupos g[]). CoinGlass no se descarga:
// el fichero lo sustituye otra máquina con sesión iniciada.
import { SYM, ACTIVE } from './symbols.js';

const CANF = new Intl.DateTimeFormat('en-GB', { timeZone: 'Atlantic/Canary', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
function can(ms) {
  const g = {};
  for (const x of CANF.formatToParts(new Date(ms))) g[x.type] = x.value;
  return `${g.year}-${g.month}-${g.day} ${g.hour}:${g.minute}`;
}
const PANELS = ['heatmap_24h', 'heatmap_1w', 'liqmap_1d'];
const PANEL_ALIAS = { liqmap_agg_1d: 'liqmap_1d', liqmap_1d_agg: 'liqmap_1d', heatmap24h: 'heatmap_24h', heatmap1w: 'heatmap_1w' };
const PANEL_SHORT = { heatmap_24h: '24h', heatmap_1w: '1w', liqmap_1d: 'map 1d' };
const MERGE_PCT = 0.15;
const BINANCE_HOSTS = ['https://fapi.binance.com', 'https://data-api.binance.vision'];

function tsOf(iso) {
  if (!iso) return null;
  const t = Date.parse(String(iso));
  return Number.isFinite(t) ? t : null;
}
function toV2(d) {
  if (d && Array.isArray(d.levels)) return d;
  const parts = String((d && d.pair) || 'Binance BTCUSDT').split(/\s+/);
  const exName = parts[0] || 'Binance';
  const pair = parts.slice(1).join(' ') || 'BTCUSDT';
  const ref = d && d.price;
  const lv = [];
  for (const key of ['heatmap_24h', 'heatmap_1w', 'liqmap_agg_1d']) {
    const s = (d && d[key]) || {};
    const agg = key === 'liqmap_agg_1d';
    for (const side of ['above', 'below']) {
      for (const x of s[side] || []) {
        lv.push({
          ...x,
          panel: PANEL_ALIAS[key] || key,
          exchange: agg ? 'Agregado' : exName,
          members: agg ? (s.exchanges || null) : null,
          pair: agg ? 'BTC' : pair,
          ref_price: ref,
          side,
        });
      }
    }
  }
  return {
    ...d,
    schema_in: (d && d.schema) || 'liqmap.coinglass.v1',
    exchanges: [{ exchange: exName, pair, ref_price: ref, ok: true }],
    levels: lv,
  };
}
function merge(levels, nTotal) {
  const out = [];
  for (const side of ['above', 'below']) {
    const lv = levels.filter((l) => l.side === side).sort((a, b) => a.price - b.price);
    let cur = [];
    const close = () => {
      if (!cur.length) return;
      const per = {};
      let agg = 0;
      const members = new Set();
      for (const l of cur) {
        if (l.exchange === 'Agregado') {
          agg = Math.max(agg, l.usd_m);
          for (const m of l.members || []) members.add(m);
        } else per[l.exchange] = Math.max(per[l.exchange] || 0, l.usd_m);
      }
      const tot = cur.reduce((s, l) => s + l.usd_m, 0) || 1;
      const real = new Set([...Object.keys(per), ...members]);
      out.push({
        side,
        price: Math.round(cur.reduce((s, l) => s + l.price * l.usd_m, 0) / tot * 10) / 10,
        lo: Math.min(...cur.map((l) => l.price)),
        hi: Math.max(...cur.map((l) => l.price)),
        n_ex: real.size || 1,
        exchanges: [...real].sort() ,
        usd_m: Math.round(Math.max(Object.values(per).reduce((s, v) => s + v, 0), agg) * 10) / 10,
        panels: [...new Set(cur.map((l) => l.panel))].sort(),
        agg: agg > 0,
      });
    };
    for (const l of lv) {
      if (cur.length && (l.price / cur[0].price - 1) * 100 > MERGE_PCT) { close(); cur = []; }
      cur.push(l);
    }
    close();
  }
  const mx = Math.max(...out.map((g) => g.usd_m), 1) || 1;
  for (const g of out) {
    g.n_total = nTotal;
    g.score = Math.round((0.6 * Math.min(1, g.n_ex / Math.max(1, nTotal)) + 0.4 * g.usd_m / mx) * 1000) / 1000;
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}
async function kfClose(http, ts) {
  const m0 = Math.floor(ts / 60000) * 60000;
  const d = await http(`https://futures.kraken.com/api/charts/v1/trade/${SYM.kf}/1m?from=${Math.floor(m0 / 1000)}&to=${Math.floor(m0 / 1000) + 180}`);
  const rows = d.candles || [];
  const hit = rows.find((x) => +x.time === m0) || rows[0];
  return hit ? +hit.close : null;
}
async function binanceClose(http, ts) {
  const m0 = Math.floor(ts / 60000) * 60000;
  const errs = [];
  for (const host of BINANCE_HOSTS) {
    try {
      const b = await http(`${host}/fapi/v1/klines?symbol=${SYM.binance}&interval=1m&startTime=${m0}&limit=1`);
      if (Array.isArray(b) && b.length && +b[0][4] > 0) return +b[0][4];
      errs.push('sin vela');
    } catch (e) { errs.push(String(e.message || e)); }
  }
  throw new Error(errs.find((m) => /451|403|CORS/.test(m)) || errs[errs.length - 1] || 'sin vela Binance');
}
function toKraken(p, pct) { return pct ? p / (1 + pct) : p; }

/**
 * @param {Function} http
 * @param {object} raw  contenido de data/coinglass_latest.json
 * @param {object|null} prevCg  semilla ya ajustada de la misma lectura, por si este origen no puede leer Kraken
 */
export async function prepareCoinGlass(http, raw, prevCg) {
  const notes = [];
  if (!raw || typeof raw !== 'object') return { seed: { ok: false, err: 'JSON vacío' }, notes };
  if (raw.symbol && raw.symbol !== ACTIVE) return { seed: { ok: false, err: `el fichero es de ${raw.symbol}, el mapa es ${ACTIVE}` }, notes };
  const ts = tsOf(raw.read_at);
  if (ts == null) return { seed: { ok: false, err: 'read_at inválido o ausente' }, notes };
  let d;
  try { d = toV2(raw); }
  catch (e) { return { seed: { ok: false, err: 'no se pudo leer el fichero: ' + (e.message || e) }, notes }; }
  const exinfo = {};
  for (const e of d.exchanges || []) if (e && e.exchange) exinfo[e.exchange] = { ...e };
  for (const l of d.levels || []) {
    const name = l.exchange || '?';
    const e = exinfo[name] || (exinfo[name] = { exchange: name, ok: true });
    if (e.ref_price == null && l.ref_price != null) e.ref_price = l.ref_price;
    if (!e.pair && l.pair) e.pair = l.pair;
    if (!e.members && l.members) e.members = l.members;
  }
  let kf = null;
  let binClose = null;
  let binErr = null;
  try { kf = await kfClose(http, ts); }
  catch (e) { notes.push(`CoinGlass: no se pudo leer la vela ${SYM.kf} del minuto de la lectura (${String(e.message || e).slice(0, 80)}). ESTIMADO`); }
  try { binClose = await binanceClose(http, ts); }
  catch (e) { binErr = String(e.message || e).slice(0, 80); }
  const binPct = (binClose && kf) ? binClose / kf - 1 : null;
  for (const [name, e] of Object.entries(exinfo)) {
    let b = null;
    const key = name.toLowerCase().replace(/[^a-z0-9]/g, '');
    if ((key === 'binance' || name === 'Agregado') && binPct != null) {
      b = { pct: binPct, method: name === 'Agregado' ? 'basis Binance (mapa agregado, mayoría USDT)' : 'velas 1m Binance vs PF del minuto de lectura' };
    }
    if (!b && e.ref_price && kf) b = { pct: +e.ref_price / kf - 1, method: `precio CoinGlass del exchange vs ${SYM.kf} (vela 1m)` };
    if (b && Math.abs(b.pct) > 0.03) b = { pct: 0, method: `basis dudoso (${(b.pct * 100).toFixed(2)} %), no aplicado` };
    if (!b) b = { pct: 0, method: 'sin basis (0)' };
    e.basis_pct = b.pct;
    e.basis_method = b.method;
    e.adj_usd = e.ref_price != null ? Math.round((toKraken(+e.ref_price, b.pct) - +e.ref_price) * 10) / 10 : null;
  }
  if (binErr && binPct == null && kf) notes.push(`CoinGlass: Binance 1m no disponible (${binErr}); ajuste con el precio de la lectura frente a la vela ${SYM.kf}`);
  const noBasis = Object.values(exinfo).some((e) => String(e.basis_method).startsWith('sin basis'));
  if (noBasis && prevCg && prevCg.ok && prevCg.ts === ts && Array.isArray(prevCg.g)) {
    return { seed: prevCg, notes: ['CoinGlass: sin acceso a la vela de Kraken del minuto de lectura; se mantiene el ajuste ya calculado para esta misma lectura'] };
  }
  for (const e of Object.values(exinfo)) {
    if (String(e.basis_method).startsWith('sin basis') || String(e.basis_method).startsWith('basis dudoso')) notes.push(`CoinGlass ${e.exchange}: ${e.basis_method}. ESTIMADO`);
  }
  const levels = [];
  for (const x of d.levels || []) {
    const p = +x.price;
    const u = +x.usd_m;
    if (!(p > 0) || !(u >= 0)) continue;
    const side = x.side;
    const panel = PANEL_ALIAS[x.panel] || x.panel;
    if (side !== 'above' && side !== 'below') continue;
    if (!PANELS.includes(panel)) continue;
    const e = exinfo[x.exchange || '?'];
    const pct = e ? e.basis_pct : 0;
    levels.push({
      panel,
      exchange: x.exchange || '?',
      pair: x.pair || (e && e.pair) || '',
      side,
      price: Math.round(toKraken(p, pct) * 10) / 10,
      usd_m: u,
      members: x.members || null,
    });
  }
  const real = new Set();
  for (const e of Object.values(exinfo)) {
    const n = levels.filter((l) => l.exchange === e.exchange).length;
    e._n = n;
    e._ok = e.ok !== false && n > 0;
    if (!e._ok) continue;
    if (e.exchange === 'Agregado') for (const m of e.members || []) real.add(m);
    else real.add(e.exchange);
  }
  const nTotal = Math.max(1, real.size);
  const groups = merge(levels, nTotal);
  const exRows = Object.values(exinfo).map((e) => {
    const panels = [...new Set(levels.filter((l) => l.exchange === e.exchange).map((l) => PANEL_SHORT[l.panel] || l.panel))];
    return [
      e.exchange,
      e.pair || '',
      e.ref_price != null ? +e.ref_price : null,
      e.adj_usd,
      Math.round(e.basis_pct * 100 * 10000) / 10000,
      e.basis_method,
      panels.join('/'),
      e._ok ? 1 : 0,
      e.note || '',
    ];
  });
  const g = groups.map((gr) => [
    gr.side === 'above' ? 1 : 0,
    gr.price,
    gr.n_ex,
    gr.usd_m,
    gr.lo,
    gr.hi,
    (gr.exchanges || []).join('/'),
    gr.agg ? 1 : 0,
    gr.score,
  ]);
  const sch = String(d.schema_in || d.schema || '').includes('v1') ? 'v1' : 'v2';
  const seed = {
    ok: g.length > 0,
    sch,
    at: can(ts),
    ts,
    mp: MERGE_PCT,
    nt: nTotal,
    pn: PANELS.filter((p) => levels.some((l) => l.panel === p)).map((p) => PANEL_SHORT[p]),
    ex: exRows,
    g,
    err: g.length ? undefined : 'la lectura no tiene niveles utilizables',
  };
  if (!seed.ok) seed.err = seed.err || 'sin niveles';
  return { seed, notes };
}
