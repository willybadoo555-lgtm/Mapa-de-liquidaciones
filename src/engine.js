// Motor del mapa de liquidaciones (ESTIMADO). SOLO LECTURA: solo APIs públicas de mercado.
// Mismo modelo que la app. El símbolo activo está en symbols.js (BTC; ETH ya definido).
// runEngine({http, hlTop, store, cgSeed, onProgress}) -> {DATA, SLOW}.
import { SYM, ACTIVE } from './symbols.js';
export { SYM };
const DAY = 86400000;
export const FRAMES = {
  '5m': { bar: 300000, binance: '5m', bybit: '5min', okx: '5m', kf: '5m', warm: 4 * DAY, data: 2 * DAY, bin: 0.0007 },
  '15m': { bar: 900000, binance: '15m', bybit: '15min', okx: null, kf: '15m', warm: 8 * DAY, data: 6 * DAY, bin: 0.001 },
  '1h': { bar: 3600000, binance: '1h', bybit: '1h', okx: '1H', kf: '1h', warm: 21 * DAY, data: 14 * DAY, bin: 0.002 },
  '4h': { bar: 14400000, binance: '4h', bybit: '4h', okx: null, kf: '4h', warm: 240 * DAY, data: 180 * DAY, bin: 0.004 },
  '1D': { bar: DAY, binance: '1d', bybit: '1d', okx: '1D', kf: '1d', warm: null, data: null, bin: 0.01 },
};
const HIST_START_1D = 1609459200000;
const LEVERAGE = [[5, .15], [10, .30], [25, .30], [50, .17], [100, .08]], MMR = 0.005, DECAY_PER_DAY = 0.05;
const BASIS_WIN = { '5m': 24, '15m': 16, '1h': 12, '4h': 6, '1D': 5 };
const EXNAMES = { binance: 'Binance', bybit: 'Bybit', okx: 'OKX', bitget: 'Bitget', hyperliquid: 'Hyperliquid', deribit: 'Deribit' };
// columnas mostradas y filas máximas por temporalidad (la app no tiene el límite de tamaño de la Page)
export const CFG = { '5m': [576, .012], '15m': [384, .025], '1h': [336, .05], '4h': [540, .10], '1D': [730, .15], '1W': [150, .2], '1M': [200, .2] };
const BARS = { '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1D': 86400, '1W': 604800 };
const LV = 11, GAMMA = 0.75;
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BINANCE_HOSTS = ['https://fapi.binance.com', 'https://data-api.binance.vision'];
const BYBIT_HOSTS = ['https://api.bybit.com', 'https://api.bytick.com'];
const OKX_BAR = { '5m': '5m', '15m': '15m', '1h': '1H', '4h': '4H', '1D': '1D' };
const OKX_OI_PERIOD = OKX_BAR;
const BYBIT_IV = { '5m': '5', '15m': '15', '1h': '60', '4h': '240', '1D': 'D' };
const BITGET_BAR = { '5m': '5m', '15m': '15m', '1h': '1H', '4h': '4H', '1D': '1D' };

export function cgWeight(ageH) {
  if (!(ageH >= 0)) return 0;
  if (ageH <= 3.75) return 1;
  return Math.max(0, 1 - (ageH - 3.75) / (10 - 3.75));
}
function errText(e) { return String((e && (e.message || e)) || 'error').replace(/\s+/g, ' ').slice(0, 180); }
async function getAny(get, urls) {
  const errs = [];
  for (const u of urls) {
    try { return await get(u); }
    catch (e) { errs.push(errText(e)); }
  }
  throw new Error(errs.find((m) => /451|403|CORS/.test(m)) || errs[errs.length - 1] || 'sin respuesta');
}

// ---------------------------------------------------------------- utilidades
const CANF = new Intl.DateTimeFormat('en-GB', { timeZone: 'Atlantic/Canary', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export function can(ms, dateOnly = false) {
  const g = {}; for (const x of CANF.formatToParts(new Date(ms))) g[x.type] = x.value;
  return dateOnly ? `${g.year}-${g.month}-${g.day}` : `${g.year}-${g.month}-${g.day} ${g.hour}:${g.minute}`;
}
const utcDate = (ms) => new Date(ms).toISOString().slice(0, 10);
function percentile(arr, q) {   // como numpy (interpolación lineal)
  if (!arr.length) return NaN; const a = Float64Array.from(arr).sort(); const p = (a.length - 1) * q / 100, i = Math.floor(p), f = p - i;
  return i + 1 < a.length ? a[i] + (a[i + 1] - a[i]) * f : a[i];
}
const median = (a) => { const s = a.slice().sort((x, y) => x - y), n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
const r1 = (v, d = 1) => Math.round(v * 10 ** d) / 10 ** d;
function conv3(arr) { const n = arr.length, o = new Float64Array(n); for (let j = 0; j < n; j++) o[j] = (j > 0 ? arr[j - 1] : 0) + arr[j] + (j < n - 1 ? arr[j + 1] : 0); return o; }
function rle(sym) {
  const out = []; let i = 0; const n = sym.length;
  while (i < n) {
    let j = i; while (j < n && sym[j] === sym[i] && j - i < 67) j++;
    const r = j - i; out.push(r >= 4 ? '~' + B64[sym[i]] + B64[r - 4] : B64[sym[i]].repeat(r)); i = j;
  }
  return out.join('');
}

// ---------------------------------------------------------------- red
function makeGet(http, stats) {
  let active = 0; const q = [];
  const slot = () => new Promise((r) => { if (active < 6) { active++; r(); } else q.push(r); });
  const free = () => { const n = q.shift(); if (n) n(); else active--; };
  return async (url, body) => {
    await slot(); stats.req++;
    try {
      let last;
      for (let k = 0; k < 2; k++) {
        try { return await http(url, body); } catch (e) { last = e; if (/HTTP 4\d\d|CORS/.test(String(e)) && !/HTTP 429/.test(String(e))) break; await sleep(700); }
      }
      throw last;
    } finally { stats.done++; free(); }
  };
}

// ---------------------------------------------------------------- caché incremental (series por temporalidad)
async function loadCache(store, f) { try { return JSON.parse((await store.get('c3:' + f)) || 'null') || {}; } catch (_) { return {}; } }
async function saveCache(store, f, c) { try { await store.set('c3:' + f, JSON.stringify(c)); } catch (_) { /* cuota llena: se descarga entero la próxima vez */ } }
function merge(oldArr, rows, start) { const m = new Map((oldArr || []).map((r) => [r[0], r])); for (const r of rows) m.set(r[0], r); return [...m.values()].filter((r) => r[0] >= start).sort((a, b) => a[0] - b[0]); }

async function okxOi(get, period, start, full) {
  const B = 'https://www.okx.com/api/v5/rubik/stat/contracts';
  let end = null;
  const rows = [];
  for (let pg = 0; pg < 12; pg++) {
    const d = await get(`${B}/open-interest-history?instId=${SYM.okx_inst}&period=${period}&limit=100` + (end ? `&end=${end}` : ''));
    if (d.code && d.code !== '0') throw new Error(`OKX ${d.code} ${d.msg || ''}`.trim());
    const list = d.data || [];
    for (const r of list) rows.push([+r[0], +r[3]]);
    if (!full || !list.length || +list[list.length - 1][0] <= start) break;
    end = +list[list.length - 1][0];
    await sleep(280);
  }
  let ratio = [];
  try {
    const rd = await get(`${B}/long-short-account-ratio?ccy=${SYM.okx_ccy}&period=${period}`);
    if (!rd.code || rd.code === '0') ratio = (rd.data || []).map((r) => [+r[0], +r[1] / (1 + +r[1])]);
  } catch (_) { /* el ratio es opcional: sin él el modelo usa 0,5 */ }
  return { oi: rows, ratio };
}
function stopOld(full, oldest, start, n, page) { return !full || !n || n < page || oldest <= start; }
async function fetchBybitKlines(get, f, start, full) {
  const iv = BYBIT_IV[f];
  let end = null;
  const rows = [];
  for (let pg = 0; pg < (full ? 8 : 1); pg++) {
    const r = await getAny(get, BYBIT_HOSTS.map((h) => `${h}/v5/market/kline?category=linear&symbol=${SYM.bybit}&interval=${iv}&limit=1000` + (end ? `&end=${end}` : '')));
    const list = (r.result && r.result.list) || [];
    if (!list.length) break;
    for (const k of list) rows.push([+k[0], +k[1], +k[2], +k[3], +k[4], +k[5], null]);
    const oldest = Math.min(...list.map((k) => +k[0]));
    if (stopOld(full, oldest, start, list.length, 1000) || (end && oldest >= end)) break;
    end = oldest - 1;
  }
  return rows;
}
async function fetchOkxKlines(get, f, start, full) {
  const bar = OKX_BAR[f];
  let after = null;
  const rows = [];
  const pages = full ? Math.min(40, Math.ceil((Date.now() - start) / FRAMES[f].bar / 100) + 2) : 3;
  for (let pg = 0; pg < pages; pg++) {
    const d = await get(`https://www.okx.com/api/v5/market/history-candles?instId=${SYM.okx_inst}&bar=${bar}&limit=100` + (after ? `&after=${after}` : ''));
    if (d.code && d.code !== '0') throw new Error(`OKX ${d.code} ${d.msg || ''}`.trim());
    const list = d.data || [];
    if (!list.length) break;
    for (const k of list) rows.push([+k[0], +k[1], +k[2], +k[3], +k[4], +k[5], null]);
    const oldest = +list[list.length - 1][0];
    if (stopOld(full, oldest, start, list.length, 100) || (after && oldest >= after)) break;
    after = oldest;
    await sleep(120);
  }
  return rows;
}
async function fetchBitgetKlines(get, f, start, full) {
  const gran = BITGET_BAR[f];
  let end = Date.now();
  const rows = [];
  for (let pg = 0; pg < (full ? 20 : 2); pg++) {
    const d = await get(`https://api.bitget.com/api/v2/mix/market/history-candles?symbol=${SYM.bitget}&productType=USDT-FUTURES&granularity=${gran}&limit=200&endTime=${end}`);
    if (d.code && d.code !== '00000') throw new Error(`Bitget ${d.code} ${d.msg || ''}`.trim());
    const list = d.data || [];
    if (!list.length) break;
    for (const k of list) rows.push([+k[0], +k[1], +k[2], +k[3], +k[4], +k[5], null]);
    const oldest = Math.min(...list.map((k) => +k[0]));
    if (stopOld(full, oldest, start, list.length, 200) || oldest >= end) break;
    end = oldest - 1;
    await sleep(120);
  }
  return rows;
}

let gateMultP = null;
function gateMultiplier(get) {
  if (!gateMultP) gateMultP = (async () => {
    const c = await get(`https://api.gateio.ws/api/v4/futures/usdt/contracts/${SYM.gate}`);
    const m = +c.quanto_multiplier;
    if (!(m > 0)) throw new Error('Gate sin multiplicador');
    return m;
  })().catch((e) => { gateMultP = null; throw e; });
  return gateMultP;
}
const GATE_IV = { '5m': '5m', '15m': '15m', '1h': '1h', '4h': '4h', '1D': '1d' };
async function fetchGateOi(get, f, start, full) {
  const iv = GATE_IV[f];
  if (!iv || !SYM.gate) return [];
  const mult = await gateMultiplier(get);
  let to = Math.floor(Date.now() / 1000);
  const rows = [];
  const pages = full ? Math.min(40, Math.ceil((Date.now() - start) / FRAMES[f].bar / 100) + 2) : 2;
  for (let pg = 0; pg < pages; pg++) {
    const list = await get(`https://api.gateio.ws/api/v4/futures/usdt/contract_stats?contract=${SYM.gate}&interval=${iv}&limit=100&to=${to}`);
    if (!Array.isArray(list) || !list.length) break;
    for (const x of list) {
      const usd = +x.open_interest * mult * (+x.mark_price || 0);
      if (usd > 0) rows.push([+x.time * 1000, usd]);
    }
    const oldest = Math.min(...list.map((x) => +x.time));
    if (!full || list.length < 100 || oldest * 1000 <= start || oldest >= to) break;
    to = oldest - 1;
    await sleep(60);
  }
  return rows;
}

async function fetchFrame(get, f, cache, now, ok, fail) {
  const fr = FRAMES[f], S = SYM, start = fr.warm == null ? HIST_START_1D : now - fr.warm;
  const has = (k) => cache[k] && cache[k].length && cache[k][0][0] <= start + 3 * fr.bar;
  const out = {};
  let klSrc = null;
  const job = async (name, fn) => { try { await fn(); ok.add(name); } catch (e) { fail[`${name}_${f}`] = errText(e).slice(0, 160); } };
  await Promise.all([
    job('hist_binance', async () => {
      const p = fr.binance;
      const bget = (path) => getAny(get, BINANCE_HOSTS.map((h) => h + path));
      const [oi, tp, gl] = await Promise.all([
        bget(`/futures/data/openInterestHist?symbol=${S.binance}&period=${p}&limit=500`),
        bget(`/futures/data/topLongShortPositionRatio?symbol=${S.binance}&period=${p}&limit=500`),
        bget(`/futures/data/globalLongShortAccountRatio?symbol=${S.binance}&period=${p}&limit=500`)]);
      if (!Array.isArray(oi)) throw new Error('sin histórico de OI');
      out.oi_binance = oi.map((r) => [+r.timestamp, +r.sumOpenInterestValue]);
      if (oi.length === 500 && !(cache.oi_binance && cache.oi_binance.length && cache.oi_binance[0][0] < Math.min(...oi.map((r) => +r.timestamp)))) {
        let oend = Math.min(...oi.map((r) => +r.timestamp)) - 1;
        for (let pg = 0; pg < 3 && oend > Math.max(start, now - 29 * DAY); pg++) {
          const more = await bget(`/futures/data/openInterestHist?symbol=${S.binance}&period=${p}&limit=500&endTime=${oend}`);
          for (const r of more) out.oi_binance.push([+r.timestamp, +r.sumOpenInterestValue]);
          if (more.length < 500) break; oend = Math.min(...more.map((r) => +r.timestamp)) - 1;
        }
      }
      out.r_bin_top = tp.map((r) => [+r.timestamp, +r.longAccount]); out.r_bin_gl = gl.map((r) => [+r.timestamp, +r.longAccount]);
    }),
    job('hist_binance_klines', async () => {
      const p = fr.binance;
      const full = !has('kl') || cache.kl_src !== 'binance';
      let end = null, rows = [];
      for (let pg = 0; pg < 6; pg++) {
        const ks = await getAny(get, BINANCE_HOSTS.map((h) => `${h}/fapi/v1/klines?symbol=${S.binance}&interval=${p}&limit=${full ? 1500 : 200}` + (end ? `&endTime=${end}` : '')));
        if (!Array.isArray(ks)) throw new Error('sin velas');
        for (const k of ks) rows.push([+k[0], +k[1], +k[2], +k[3], +k[4], +k[5], +k[9]]);
        if (!full || ks.length < 1500 || +ks[0][0] <= start) break; end = +ks[0][0] - 1;
      }
      if (rows.length < 10) throw new Error('velas insuficientes');
      out.kl = rows; klSrc = 'binance';
    }),
    job('hist_bybit', async () => {
      let cursor = '', rows = [];
      const full = !has('oi_bybit');
      for (let pg = 0; pg < 15; pg++) {
        const r = (await getAny(get, BYBIT_HOSTS.map((h) => `${h}/v5/market/open-interest?category=linear&symbol=${S.bybit}&intervalTime=${fr.bybit}&limit=200` + (cursor ? `&cursor=${cursor}` : '')))).result;
        for (const x of r.list) rows.push([+x.timestamp, +x.openInterest]);
        if (!r.list.length) break; cursor = r.nextPageCursor;
        if (!full || !cursor || +r.list[r.list.length - 1].timestamp <= start) break;
      }
      out.oi_bybit = rows;
      const ratio = await getAny(get, BYBIT_HOSTS.map((h) => `${h}/v5/market/account-ratio?category=linear&symbol=${S.bybit}&period=${fr.bybit}&limit=500`));
      out.r_bybit = ratio.result.list.map((x) => [+x.timestamp, +x.buyRatio]);
    }),
    (fr.okx ? job('hist_okx', async () => {
      const pack = await okxOi(get, fr.okx, start, !has('oi_okx'));
      out.oi_okx = pack.oi; if (pack.ratio.length) out.r_okx = pack.ratio;
    }) : null),
    job('hist_kraken_futures', async () => {
      let frm = has('kf') ? cache.kf[cache.kf.length - 1][0] - 3 * fr.bar : Math.max(start, 1500000000000), rows = [];
      for (let pg = 0; pg < 8; pg++) {
        const d = await get(`https://futures.kraken.com/api/charts/v1/trade/${S.kf}/${fr.kf}?from=${Math.floor(frm / 1000)}`);
        const cd = d.candles || [];
        for (const k of cd) rows.push([+k.time, +k.open, +k.high, +k.low, +k.close, +k.volume]);
        if (!d.more_candles || !cd.length) break; frm = +cd[cd.length - 1].time + 1000;
      }
      out.kf = rows;
    }),
  ]);
  if (!(out.oi_binance && out.oi_binance.length) && !(out.oi_bybit && out.oi_bybit.length) && !(out.oi_okx && out.oi_okx.length) && OKX_OI_PERIOD[f]) {
    try {
      const pack = await okxOi(get, OKX_OI_PERIOD[f], start, !has('oi_okx'));
      if (pack.oi.length) { out.oi_okx = pack.oi; if (pack.ratio.length) out.r_okx = pack.ratio; ok.add('hist_okx'); delete fail[`hist_okx_${f}`]; }
      else if (!fail[`hist_okx_${f}`]) fail[`hist_okx_${f}`] = 'OKX sin histórico de OI';
    } catch (e) { fail[`hist_okx_${f}`] = errText(e).slice(0, 160); }
  }
  if (!(out.oi_binance && out.oi_binance.length) && !(out.oi_bybit && out.oi_bybit.length) && !(out.oi_okx && out.oi_okx.length)) {
    try {
      const rows = await fetchGateOi(get, f, start, !has('oi_gate'));
      if (rows.length) { out.oi_gate = rows; ok.add('hist_gate'); }
      else fail[`hist_gate_${f}`] = 'Gate sin histórico de OI';
    } catch (e) { fail[`hist_gate_${f}`] = errText(e).slice(0, 160); }
  }
  if (!(out.kl && out.kl.length >= 10)) {
    const attempts = [['Bybit', () => fetchBybitKlines(get, f, start, true)], ['OKX', () => fetchOkxKlines(get, f, start, !has('kl') || cache.kl_src !== 'OKX')], ['Bitget', () => fetchBitgetKlines(get, f, start, !has('kl') || cache.kl_src !== 'Bitget')]];
    const altErr = [];
    for (const [src, fn] of attempts) {
      try {
        const rows = await fn();
        if (rows.length >= 10) { out.kl = rows; klSrc = src; ok.add('klines_' + src); altErr.length = 0; break; }
        altErr.push(src + ' vacío');
      } catch (e) { altErr.push(src + ' ' + errText(e)); }
    }
    if (!(out.kl && out.kl.length >= 10)) fail[`klines_${f}`] = altErr.join(' | ').slice(0, 160);
  }
  const prevSrc = cache.kl_src || null;
  for (const k of Object.keys(out)) {
    if (k === 'kl' && prevSrc && klSrc && prevSrc !== klSrc) cache.kl = [];
    cache[k] = merge(cache[k], out[k], start - 2 * fr.bar);
  }
  if (klSrc) cache.kl_src = klSrc;
  return cache;
}

async function fetchLive(get, ok, fail) {
  const S = SYM, live = {}, px = {};
  const job = async (name, fn) => { try { const [p, o] = await fn(); px[name] = p; if (o != null) live[name] = o; ok.add(name); } catch (e) { fail[name] = String(e.message || e).slice(0, 80); } };
  await Promise.all([
    job('kraken_futures', async () => { const t = (await get(`https://futures.kraken.com/derivatives/api/v3/tickers/${S.kf}`)).ticker; return [+t.last, +t.openInterest * +t.last]; }),
    job('binance', async () => {
      const errs = [];
      for (const B of BINANCE_HOSTS) {
        try {
          const [t, o] = await Promise.all([get(`${B}/fapi/v1/ticker/price?symbol=${S.binance}`), get(`${B}/fapi/v1/openInterest?symbol=${S.binance}`)]);
          if (!t || t.price == null || !o || o.openInterest == null) throw new Error('respuesta sin precio');
          return [+t.price, +o.openInterest * +t.price];
        } catch (e) { errs.push(errText(e)); }
      }
      const geo = errs.find((m) => /451|403|CORS/.test(m));
      throw new Error(geo ? `${geo}; data-api.binance.vision sin futuros` : (errs[errs.length - 1] || 'sin respuesta'));
    }),
    job('bybit', async () => {
      const errs = [];
      for (const B of BYBIT_HOSTS) {
        try {
          const t = (await get(`${B}/v5/market/tickers?category=linear&symbol=${S.bybit}`)).result.list[0];
          return [+t.lastPrice, +t.openInterestValue];
        } catch (e) { errs.push(errText(e)); }
      }
      throw new Error(errs.find((m) => /451|403|CORS/.test(m)) || errs[errs.length - 1] || 'sin respuesta');
    }),
    job('okx', async () => {
      const [o, t] = await Promise.all([get(`https://www.okx.com/api/v5/public/open-interest?instType=SWAP&instId=${S.okx_inst}`), get(`https://www.okx.com/api/v5/market/ticker?instId=${S.okx_inst}`)]);
      return [+t.data[0].last, +o.data[0].oiUsd];
    }),
    job('bitget', async () => {
      const B = 'https://api.bitget.com/api/v2/mix/market';
      const [t, o] = await Promise.all([get(`${B}/ticker?symbol=${S.bitget}&productType=USDT-FUTURES`), get(`${B}/open-interest?symbol=${S.bitget}&productType=USDT-FUTURES`)]);
      const p = +t.data[0].lastPr; return [p, +o.data.openInterestList[0].size * p];
    }),
    job('hyperliquid', async () => {
      const [meta, ctxs] = await get('https://api.hyperliquid.xyz/info', { type: 'metaAndAssetCtxs' });
      const i = meta.universe.findIndex((a) => a.name === S.hl); const p = +ctxs[i].markPx; return [p, +ctxs[i].openInterest * p];
    }),
    job('deribit', async () => { const r = (await get(`https://www.deribit.com/api/v2/public/get_book_summary_by_instrument?instrument_name=${S.deribit}`)).result[0]; return [+r.last, +r.open_interest]; }),
  ]);
  return { live, px };
}

async function fetchHL(get, hlTop, store, ok, fail, maxAgeMin = 0) {
  try {
    if (maxAgeMin > 0) {   // reutiliza las posiciones de Hyperliquid si son recientes (actualización rápida)
      const pc = JSON.parse((await store.get('hl_pos')) || 'null');
      if (pc && Date.now() - pc.ts < maxAgeMin * 60000) { ok.add(`hyperliquid_positions (top ${pc.n}, caché ${can(pc.ts).slice(11)})`); return { pos: pc.pos, n: pc.n, ts: pc.ts }; }
    }
    let addrs = null; const c = JSON.parse((await store.get('hl_addrs')) || 'null');
    if (c && Date.now() - c.ts < 7 * DAY) addrs = c.a;
    if (!addrs && hlTop) { try { addrs = await hlTop(200); await store.set('hl_addrs', JSON.stringify({ ts: Date.now(), a: addrs })); } catch (e) { fail.hyperliquid_leaderboard = String(e.message || e).slice(0, 60); } }
    if (!addrs && c) addrs = c.a;
    if (!addrs) throw new Error('sin lista de cuentas del leaderboard');
    const pos = []; let nf = 0;
    await Promise.all(addrs.map(async (a) => {
      try {
        const r = await get('https://api.hyperliquid.xyz/info', { type: 'clearinghouseState', user: a });
        for (const x of r.assetPositions || []) { const p = x.position; if (p.coin !== SYM.hl || p.liquidationPx == null || p.liquidationPx === '') continue; pos.push([+p.szi, +p.liquidationPx, +p.positionValue]); }
      } catch (_) { nf++; }
    }));
    if (nf > addrs.length * 0.5) throw new Error(`${nf}/${addrs.length} consultas fallidas`);
    ok.add(`hyperliquid_positions (top ${addrs.length})`);
    try { await store.set('hl_pos', JSON.stringify({ ts: Date.now(), pos, n: addrs.length })); } catch (_) { /* */ }
    return { pos, n: addrs.length, ts: Date.now() };
  } catch (e) { fail.hyperliquid_positions = String(e.message || e).slice(0, 80); return { pos: [], n: 0 }; }
}

async function fetchOkxLiqs(get, ok, fail) {
  try {
    const d = (await get(`https://www.okx.com/api/v5/public/liquidation-orders?instType=SWAP&uly=${SYM.okx_uly}&state=filled&limit=100`)).data, out = [];
    for (const blk of d) for (const x of blk.details || []) { const p = +x.bkPx; out.push(['okx', +x.ts, (x.posSide === 'long' || x.side === 'sell') ? 'long' : 'short', p, +x.sz * 0.01 * p]); }
    ok.add('okx_liquidations'); return out;
  } catch (e) { fail.okx_liquidations = String(e.message || e).slice(0, 80); return []; }
}

// ---------------------------------------------------------------- modelo (idéntico a liqmap/model.py)
function barBasis(f, K, KF) {
  const ts = [...K.keys()].sort((a, b) => a - b), both = ts.filter((t) => KF.has(t) && K.get(t)[3] && KF.get(t)[3]);
  const w = BASIS_WIN[f] || 6, med = new Map(); let buf = [];
  for (const t of both) { buf.push(K.get(t)[3] / KF.get(t)[3] - 1); buf = buf.slice(-w); med.set(t, median(buf)); }
  const out = new Map(); let last = null; const firstKf = KF.size ? Math.min(...KF.keys()) : null, firstVal = both.length ? med.get(both[0]) : 0;
  for (const t of ts) { if (med.has(t)) last = med.get(t); out.set(t, firstKf == null || t < firstKf ? 0 : last != null ? last : firstVal); }
  return [out, both.length ? med.get(both[both.length - 1]) : null];
}

function simulate(f, cache, live, keepCols) {
  const fr = FRAMES[f], bar = fr.bar;
  let K = new Map(cache.kl.map((r) => [r[0], r.slice(1)]));
  const KF = new Map((cache.kf || []).map((r) => [r[0], r.slice(1)]));
  if (!K.size) throw new Error(`sin velas ${f}`);
  const rnd = (t) => Math.round(t / bar) * bar;
  const oi = {};
  if (cache.oi_binance && cache.oi_binance.length) { oi.binance = new Map(); for (const [t, v] of cache.oi_binance) oi.binance.set(rnd(t), v); }
  if (cache.oi_bybit && cache.oi_bybit.length) { oi.bybit = new Map(); for (const [t0, v] of cache.oi_bybit) { const t = rnd(t0), k = K.get(t - bar) || K.get(t); if (k) oi.bybit.set(t, v * k[3]); } }
  if (cache.oi_okx && cache.oi_okx.length) { oi.okx = new Map(); for (const [t, v] of cache.oi_okx) oi.okx.set(rnd(t), v); }
  if (cache.oi_gate && cache.oi_gate.length) { oi.gate = new Map(); for (const [t, v] of cache.oi_gate) oi.gate.set(rnd(t), v); }
  const rat = [];
  for (const k of ['r_bin_top', 'r_bin_gl', 'r_bybit', 'r_okx']) if (cache[k] && cache[k].length) { const m = new Map(); for (const [t, v] of cache[k]) m.set(rnd(t), v); rat.push(m); }
  const [bb, bbNow] = barBasis(f, K, KF);
  const K2 = new Map(); for (const [t, k] of K) { const d = 1 + bb.get(t); K2.set(t, [k[0] / d, k[1] / d, k[2] / d, k[3] / d, k[4], k[5]]); } K = K2;
  let hours = [...K.keys()].sort((a, b) => a - b); const cur = hours[hours.length - 1];
  const start = fr.warm == null ? HIST_START_1D : cur - fr.warm; hours = hours.filter((t) => t >= start);
  const lstep = Math.log(1 + fr.bin);
  let loAll = Infinity, hiAll = -Infinity; for (const t of hours) { loAll = Math.min(loAll, K.get(t)[2]); hiAll = Math.max(hiAll, K.get(t)[1]); }
  const pmin = loAll * 0.75, NB = Math.floor(Math.log(hiAll * 1.35 / pmin) / lstep) + 2;
  const grid = new Float64Array(NB); for (let j = 0; j < NB; j++) grid[j] = pmin * Math.exp(j * lstep);
  const idx = (p) => Math.round(Math.log(Math.max(p, 1e-9) / pmin) / lstep);
  const histEx = Object.keys(oi), liveSum = Object.values(live).reduce((a, b) => a + b, 0);
  const L = new Float64Array(NB), Sh = new Float64Array(NB), cols = [];
  const keep = Math.exp(Math.log(1 - DECAY_PER_DAY) * bar / DAY);
  hours.forEach((t, n) => {
    const [o, h, l, c, v, tb] = K.get(t), loI = idx(l), hiI = idx(h);
    let consumed = 0;
    for (let j = Math.max(loI, 0); j < NB; j++) { consumed += L[j]; L[j] = 0; }
    for (let j = 0; j < Math.min(Math.max(hiI + 1, 0), NB); j++) { consumed += Sh[j]; Sh[j] = 0; }
    let d = 0; const used = [];
    for (const ex of histEx) {
      const a = oi[ex].get(t); let b = oi[ex].get(t + bar);
      if (b == null && t === cur && live[ex] != null) b = live[ex];
      if (a != null && b != null) { d += b - a; used.push(ex); }
    }
    let scale = 0;
    if (used.length) { let den = 0; for (const e of used) den += live[e] || oi[e].get(t + bar) || oi[e].get(t); scale = den ? Math.min(6, Math.max(1, liveSum / den)) : 1; }
    const dOI = d * scale;
    const rv = rat.map((m) => m.get(t)).filter((x) => x);
    const tbf = (tb != null && v) ? tb / v : 0.5;
    const wl = Math.min(0.7, Math.max(0.3, 0.5 * tbf + 0.5 * (rv.length ? rv.reduce((a, b) => a + b, 0) / rv.length : 0.5)));
    if (dOI > 0) {
      for (const [p, pw] of [[o, .3], [h, .2], [l, .2], [c, .3]]) for (const [Lv, w] of LEVERAGE) {
        const j = idx(p * (1 - 1 / Lv + MMR)), k = idx(p * (1 + 1 / Lv - MMR));
        if (j >= 0 && j < NB) L[j] += dOI * wl * w * pw;
        if (k >= 0 && k < NB) Sh[k] += dOI * (1 - wl) * w * pw;
      }
    } else if (dOI < 0) {
      const closed = Math.max(0, -dOI - consumed); let tot = 0; for (let j = 0; j < NB; j++) tot += L[j] + Sh[j];
      if (tot > 0) { const fct = Math.max(0, 1 - closed / tot); for (let j = 0; j < NB; j++) { L[j] *= fct; Sh[j] *= fct; } }
    }
    for (let j = 0; j < NB; j++) { L[j] *= keep; Sh[j] *= keep; }
    if (n >= hours.length - keepCols || f === '1D') cols.push({ t, L: Float32Array.from(L), S: Float32Array.from(Sh), ex: used, ratio: rv.length });
  });
  return { K, KF, cols, grid, lstep, idx, pmin, bbNow, modelStart: hours[0] };
}

function clusters(arr, grid, px, below, smax) {
  const sm = conv3(arr), cand = [];
  for (let j = 1; j < arr.length - 1; j++) {
    const p = grid[j];
    if ((below && p >= px) || (!below && p <= px) || Math.abs(p / px - 1) > 0.15) continue;
    if (sm[j] > 0 && sm[j] >= sm[j - 1] && sm[j] >= sm[j + 1]) cand.push(j);
  }
  cand.sort((a, b) => sm[b] - sm[a]); const out = [];
  for (const j of cand) { if (out.some((k) => Math.abs(j - k) < 3)) continue; out.push(j); if (out.length === 5) break; }
  return out.map((j) => ({ price: r1(grid[j]), intensity: r1(sm[j] / smax, 3), est_usd: Math.round(sm[j]), dist_pct: r1((grid[j] / px - 1) * 100, 2) }));
}

function groupKey(t, g) { const d = new Date(t); if (g === 'week') { d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7); return utcDate(d.getTime()); } return utcDate(t).slice(0, 8) + '01'; }

// exporta una temporalidad directamente al formato compacto de la UI (export + tf_payload de Python)
function payload(f, sim, ctx) {
  const derived = f === '1W' || f === '1M', base = derived ? '1D' : f, bfr = FRAMES[base];
  let cols = sim.cols; const { grid, K, KF } = sim, daily = bfr.bar >= DAY;
  let allK = new Map();
  if (derived) {
    const groups = new Map(); for (const c of cols) { const k = groupKey(c.t, f === '1W' ? 'week' : 'month'); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(c); }
    const nw = [];
    for (const k of [...groups.keys()].sort()) { const cs = groups.get(k); nw.push({ t: Date.parse(k + 'T00:00:00Z'), L: cs[cs.length - 1].L, S: cs[cs.length - 1].S, ex: [...new Set(cs.flatMap((c) => c.ex))], ratio: Math.max(...cs.map((c) => c.ratio)), days: cs.map((c) => c.t) }); }
    cols = nw;
    const agg = (src, days) => { const ks = days.filter((d) => src.has(d)).map((d) => src.get(d)); return ks.length ? [ks[0][0], Math.max(...ks.map((k) => k[1])), Math.min(...ks.map((k) => k[2])), ks[ks.length - 1][3]] : null; };
    for (const c of cols) { const kf = agg(KF, c.days), bn = agg(K, c.days), full = kf && c.days.every((d) => KF.has(d)); allK.set(c.t, full ? [kf, 0] : bn ? [bn, 1] : [kf, 0]); }
  } else for (const c of cols) allK.set(c.t, KF.has(c.t) ? [KF.get(c.t).slice(0, 4), 0] : [K.get(c.t).slice(0, 4), 1]);
  if (bfr.data && !derived) cols = cols.filter((c) => c.t >= cols[cols.length - 1].t - bfr.data);
  const [Cmax, pad] = CFG[f];
  const allN = cols.length; cols = cols.slice(-Cmax);
  const px = ctx.px, last = cols[cols.length - 1];
  const cs = cols.map((c) => allK.get(c.t)[0] ? allK.get(c.t) : null);
  let lo = px, hi = px; for (const c of cs) if (c) { lo = Math.min(lo, c[0][2]); hi = Math.max(hi, c[0][1]); }
  lo *= 1 - pad; hi *= 1 + pad; const lr = Math.log(hi / lo);
  const R = Math.max(32, Math.min(160, Math.ceil(lr / Math.log(1 + bfr.bin) / (derived ? 1 : 1))));
  const C = cols.length, ZL = new Float64Array(R * C), ZS = new Float64Array(R * C);
  const rowOf = (j, n) => Math.floor(Math.log(grid[j] / lo) / lr * n);
  // umbral del export Python: celdas > 1 % del p98,5 de las últimas 400 columnas
  const nzAll = []; for (const c of cols.slice(-400)) { for (const v of c.L) if (v > 0) nzAll.push(v); for (const v of c.S) if (v > 0) nzAll.push(v); }
  const thr = (nzAll.length ? percentile(nzAll, 98.5) : 1) * 0.01;
  cols.forEach((c, i) => {
    for (let j = 0; j < grid.length; j++) {
      const a = c.L[j], b = c.S[j]; if (a <= thr && b <= thr) continue;
      const r = rowOf(j, R); if (r < 0 || r >= R) continue;
      if (a > thr) ZL[r * C + i] += a / 1e6; if (b > thr) ZS[r * C + i] += b / 1e6;
    }
  });
  const q12 = (p) => { const v = Math.max(0, Math.min(4095, Math.round((p - lo) / (hi - lo) * 4095))); return B64[v >> 6] + B64[v & 63]; };
  const cd = cs.map((c) => !c ? '~~~~~~~~' : c[0].map(q12).join('')).join('');
  const subI = cs.map((c, i) => (c && c[1] ? i : -1)).filter((i) => i >= 0);
  const tS = cols.map((c) => Math.floor(c.t / 1000)), step = C > 1 ? (tS[C - 1] - tS[0]) / (C - 1) : 0;
  // ---- MAPA UNIFICADO (igual que build_canvas.py): modelo ×1 + CoinGlass combinado ×0,5 + Hyperliquid ×1 + liquidaciones reales ×1, en M$ y precio PF_XBTUSD
  const W_CG = 0.5, W_HL = 1, W_LQ = 1, SNAP = 3, snap0 = Math.max(0, C - SNAP);
  const NP = 4 * R, prow = (p) => p > 0 ? Math.floor(Math.log(p / lo) / lr * NP) : -1, row = (p) => p > 0 ? Math.floor(Math.log(p / lo) / lr * R) : -1;
  const P = { model: [new Float64Array(NP), new Float64Array(NP)], cg: [new Float64Array(NP), new Float64Array(NP)], hl: [new Float64Array(NP), new Float64Array(NP)], lq: [new Float64Array(NP), new Float64Array(NP)] };
  for (let j = 0; j < grid.length; j++) { const r = prow(grid[j]); if (r < 0 || r >= NP) continue; P.model[0][r] += last.L[j] / 1e6; P.model[1][r] += last.S[j] / 1e6; }
  const cgn = new Map(), cg = ctx.cg;
  const cgAgeH = cg && cg.ok ? (Date.now() - cg.ts) / 3600000 : 99, cgw = cg && cg.ok ? cgWeight(cgAgeH) : 0;
  if (cg && cg.ok && Array.isArray(cg.g) && cgw > 0) {
    let i0 = tS.findIndex((t) => t >= cg.ts / 1000); if (i0 < 0) i0 = C; i0 = Math.min(i0, snap0);
    for (const g of cg.g) {
      const side = g[0] ? 1 : 0, Z = side ? ZS : ZL; const rs = [];
      for (let r = Math.max(row(g[4]), 0); r <= Math.min(row(g[5]), R - 1); r++) rs.push(r);
      if (!rs.length) { const r = row(g[1]); if (r >= 0 && r < R) rs.push(r); }
      for (const r of rs) for (let i = i0; i < C; i++) Z[r * C + i] += W_CG * cgw * g[3] / rs.length;
      const pr = prow(g[1]); if (pr >= 0 && pr < NP) { P.cg[side][pr] += W_CG * cgw * g[3]; const k = side + '|' + pr; cgn.set(k, Math.max(cgn.get(k) || 0, g[2])); }
    }
  }
  for (const [szi, liq, val] of ctx.hl) {
    const side = szi > 0 ? 0 : 1, v = W_HL * val / 1e6, r = row(liq), pr = prow(liq);
    if (r >= 0 && r < R) for (let i = snap0; i < C; i++) (side ? ZS : ZL)[r * C + i] += v;
    if (pr >= 0 && pr < NP) P.hl[side][pr] += v;
  }
  if (!derived) {
    const tRecent = tS[C - 1] - 86400;
    for (const [, ts, sd, p, usd] of ctx.liqs) {
      const t = ts / 1000, i = step ? Math.round((t - tS[0]) / step) : 0, side = sd === 'long' ? 0 : 1, v = W_LQ * usd / 1e6, r = row(p);
      if (i >= 0 && i < C && Math.abs(tS[i] - t) < step && r >= 0 && r < R) (side ? ZS : ZL)[r * C + i] += v;
      if (t >= tRecent) { const pr = prow(p); if (pr >= 0 && pr < NP) P.lq[side][pr] += v; }
    }
  }
  const nz = []; for (const Z of [ZL, ZS]) for (const v of Z) if (v > 0) nz.push(v);
  const zmax = nz.length ? percentile(nz, 98.5) : 1;
  const lev = (Z) => Array.from(Z, (z) => z > 0 ? Math.max(0, Math.min(LV, Math.ceil(Math.pow(Math.min(1, z / zmax), GAMMA) * LV - 0.3))) : 0);
  // 3 zonas más fuertes por lado
  const pe = (r) => lo * Math.exp((r + 0.5) / NP * lr), rp = prow(px), join = Math.max(1, Math.round(Math.log(1.003) / lr * NP)), zu = [];
  let nL = 0, nS = 0;
  for (const side of [1, 0]) {
    const U = new Float64Array(NP); for (const k of Object.keys(P)) for (let r = 0; r < NP; r++) U[r] += P[k][side][r];
    for (let r = 0; r < NP; r++) { const p = pe(r); if (p >= px * 0.95 && p <= px * 1.05) { if (side) nS += U[r]; else nL += U[r]; } }
    const sm = new Float64Array(NP); for (let r = 0; r < NP; r++) for (let q = Math.max(0, r - join); q <= Math.min(NP - 1, r + join); q++) sm[r] += U[q];
    const cand = []; for (let r = 1; r < NP - 1; r++) if (sm[r] > 0 && sm[r] >= sm[r - 1] && sm[r] >= sm[r + 1] && (side ? r > rp : r < rp) && Math.abs(pe(r) / px - 1) <= 0.12) cand.push(r);
    cand.sort((x, y) => sm[y] - sm[x]); const pick = [];
    for (const r of cand) {
      if (pick.length && !pick.every((q) => Math.abs(r - q) > 2 * join)) continue;
      const a = Math.max(0, r - join), b = Math.min(NP, r + join + 1), tot = sm[r], src = [];
      for (const [k, labl] of [['model', 'modelo'], ['cg', 'CoinGlass'], ['hl', 'Hyperliquid'], ['lq', 'liq. reales']]) {
        let v = 0; for (let q = a; q < b; q++) v += P[k][side][q];
        if (v > 0.5 && v >= 0.05 * tot) {
          let lab = labl; if (k === 'cg') { let n = 0; for (let q = a; q < b; q++) n = Math.max(n, cgn.get(side + '|' + q) || 0); if (n) lab = `CoinGlass ${n}/${cg.nt || n} exch`; }
          src.push(lab);
        }
      }
      if (!src.length) continue;
      pick.push(r);
      const p = pe(r); zu.push([side, Math.round(p), r1(tot), src.length, src.join(', '), r1((p / px - 1) * 100, 2)]);
      if (pick.length === 3) break;
    }
  }
  const firstKf = KF.size ? Math.min(...KF.keys()) : null;
  const fmtR = (t) => daily ? can(t, true) : can(t);
  return {
    lo: r1(lo, 2), hi: r1(hi, 2), R, C, zm: r1(zmax, 3), t: f === '1M' ? ['M', tS[0]] : [tS[C - 1] - (C - 1) * BARS[f], BARS[f]],
    hmL: rle(lev(ZL)), hmS: rle(lev(ZS)), cd, sub: subI.length ? [subI[0], subI[subI.length - 1]] : null, zu,
    nr: [r1(nL), r1(nS)], bb: sim.bbNow != null ? r1(sim.bbNow * 100, 4) : null, kSrc: ctx.kSrc || 'binance',
    rg: { f: fmtR(cols[0].t), l: fmtR(last.t), n: allN, m: can(sim.modelStart, true), k: firstKf ? can(firstKf, true) : null },
    daily, ns: subI.length,
  };
}

// ---------------------------------------------------------------- orquestación
export async function runEngine({ http, hlTop, store, cgSeed, wsLiqs = [], onProgress, slowEveryMin = 60, only = null, hlMaxAgeMin = 0, prev = null }) {
  const stats = { req: 0, done: 0 }, get = makeGet(http, stats), ok = new Set(), fail = {}, notes = [];
  const tick = setInterval(() => onProgress && onProgress(stats.done, stats.req), 400);
  try {
    const now = Date.now();
    const prevSlow = JSON.parse((await store.get('slow_meta')) || 'null');
    // only: lista de temporalidades a recalcular (modo rápido / en vivo); el resto se conserva de prev
    const doSlow = !only && (!prevSlow || now - prevSlow.ts > slowEveryMin * 60000 || !(await store.get('c3:1D')));
    const frames = only ? only.slice() : doSlow ? ['5m', '15m', '1h', '4h', '1D'] : ['5m', '15m', '1h', '4h'];
    const caches = {};
    const [{ live, px }, hl, okxL] = await Promise.all([
      fetchLive(get, ok, fail), fetchHL(get, hlTop, store, ok, fail, hlMaxAgeMin), fetchOkxLiqs(get, ok, fail),
      ...frames.map(async (f) => { caches[f] = await fetchFrame(get, f, await loadCache(store, f), now, ok, fail); })]);
    for (const f of frames) await saveCache(store, f, caches[f]);
    // precio de referencia: Kraken Futures PF_XBTUSD
    let pxNow = px.kraken_futures, pxSrc = 'kraken_futures';
    if (pxNow == null) for (const s of ['binance', 'bybit', 'okx', 'hyperliquid']) if (px[s] != null) { pxNow = px[s]; pxSrc = s; notes.push(`Precio actual de ${s} (Kraken Futures no respondió): ESTIMADO`); break; }
    if (pxNow == null) throw new Error('ningún exchange devolvió precio');
    // basis live (en %) y su histórico para pasar liquidaciones reales a precio Kraken
    const basisNow = {};
    if (px.kraken_futures) for (const ex of Object.keys(EXNAMES)) if (px[ex]) basisNow[ex] = px[ex] / px.kraken_futures - 1;
    let bh = JSON.parse((await store.get('basis_hist')) || '{}');
    for (const [ex, v] of Object.entries(basisNow)) bh[ex] = [...(bh[ex] || []), [now, v]].filter((r) => r[0] > now - 30 * DAY).slice(-3000);
    try { await store.set('basis_hist', JSON.stringify(bh)); } catch (_) { /* */ }
    const pctAt = (ex, t) => { const s = bh[ex]; if (!s || !s.length) return basisNow[ex] || 0; let best = s[0]; for (const r of s) if (Math.abs(r[0] - t) < Math.abs(best[0] - t)) best = r; return best[1]; };
    // liquidaciones reales (OKX REST + websockets Binance/Bybit de la app), guardadas 30 días
    let liqs = JSON.parse((await store.get('liqs')) || '[]');
    const seen = new Set(liqs.map((l) => l.join('|')));
    for (const l of [...okxL, ...wsLiqs]) { const k = l.join('|'); if (!seen.has(k)) { seen.add(k); liqs.push(l); } }
    liqs = liqs.filter((l) => l[1] > now - 30 * DAY).sort((a, b) => a[1] - b[1]).slice(-5000);
    try { await store.set('liqs', JSON.stringify(liqs)); } catch (_) { /* */ }
    if (wsLiqs.length || liqs.some((l) => l[0] !== 'okx')) ok.add('ws_liquidations (Binance/Bybit, solo con la app abierta)');
    const liqsK = liqs.map(([ex, t, sd, p, u]) => [ex, t, sd, p / (1 + pctAt(ex, t)), u]);
    const hlK = hl.pos.map(([szi, liq, val]) => [szi, liq / (1 + (basisNow.hyperliquid || 0)), val]);
    const ctx = { px: pxNow, liqs: liqsK, hl: hlK, cg: cgSeed };
    const tf = {}, errs = {};
    for (const f of frames) {
      try {
        const keep = { '5m': CFG['5m'][0] + 4, '15m': CFG['15m'][0] + 4, '1h': CFG['1h'][0] + 4, '4h': CFG['4h'][0] + 4 }[f] || 1e9;
        const sim = simulate(f, caches[f], live, Math.max(keep, 400));
        ctx.kSrc = (caches[f] && caches[f].kl_src) || 'binance';
        tf[f] = payload(f, sim, ctx);
        if (f === '1D') { tf['1W'] = payload('1W', sim, ctx); tf['1M'] = payload('1M', sim, ctx); }
      } catch (e) { errs[f] = String(e.message || e).slice(0, 80); fail[`modelo_${f}`] = errs[f]; }
      await sleep(0);
    }
    const okL = [...ok].sort();
    let cgw = 0;
    if (cgSeed && cgSeed.ok) {
      const age = (now - cgSeed.ts) / 3600000;
      cgw = cgWeight(age);
      if (age > 10) fail.coinglass_web = `desactualizado: lectura de ${cgSeed.at} (hace ${age.toFixed(1)} h); fuera del mapa`;
      else if (age > 3.75) fail.coinglass_web = `desactualizado: lectura de ${cgSeed.at} (hace ${age.toFixed(1)} h; peso ${(cgw * 100).toFixed(0)} %)`;
      else okL.push(`coinglass_web (fichero del repo, ${cgSeed.at})`);
    } else if (cgSeed && cgSeed.err) fail.coinglass_web = String(cgSeed.err).slice(0, 160);
    const alts = [...new Set(frames.map((f) => caches[f] && caches[f].kl_src).filter((s) => s && s !== 'binance'))];
    if (alts.length) notes.push(`Velas del modelo desde ${alts.join(' y ')} (Binance no respondió): ESTIMADO`);
    const head = {
      sym: ACTIVE, kf: SYM.kf, px: pxNow, upd: can(now), ts: now, lv: LV, ok: okL.join(', '), fail, oi: Math.round(Object.values(live).reduce((a, b) => a + b, 0)), hln: hl.n,
      notes, basis: Object.keys(basisNow).length ? { ref: `${SYM.kf} (last)`, at: can(now), ex: Object.entries(basisNow).sort().map(([ex, v]) => [EXNAMES[ex], r1(-v * px.kraken_futures), r1(v * 100, 4)]), bar: (tf['1h'] || (prev && prev.tf && prev.tf['1h']) || { bb: null }).bb } : null,
      cg: cgSeed || null, cgw, nreq: stats.req, tf: {},
    };
    for (const f of ['5m', '15m', '1h', '4h']) if (tf[f]) head.tf[f] = tf[f]; else if (prev && prev.tf && prev.tf[f]) head.tf[f] = prev.tf[f];
    head.part = only ? only.join('/') : null; head.hlts = hl.ts || null;
    let SLOW;
    if (doSlow) { SLOW = { upd: can(now), tf: {} }; for (const f of ['1D', '1W', '1M']) if (tf[f]) SLOW.tf[f] = tf[f]; if (Object.keys(SLOW.tf).length) await store.set('slow_meta', JSON.stringify({ ts: now })); }
    return { DATA: head, SLOW, errs, stats };
  } finally { clearInterval(tick); }
}
