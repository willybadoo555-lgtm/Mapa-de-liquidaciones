import React, { useState, useRef, useEffect, useMemo } from "react";
import { Page } from "./shim";
import { cgWeight, CG_FRESH_H, CG_FADE_END_H } from "./engine.js";

// Datos: bloques de una línea generados por /workspace/liqmap/build_canvas.py / canvas_update.py (no editar a mano)
let DATA: any = null;
let SLOW: any = null;
let CGD: any = null;
let TFD: any = {};
export const LIVE: any = { px: 0, ts: 0 };
export const BUMP: any = { f: null };
export function bump() { if (BUMP.f) BUMP.f(); }
export function setLivePx(p: number) { if (!(p > 0)) return; LIVE.px = p; LIVE.ts = Date.now(); if (DATA) DATA.px = p; bump(); }
function applyLive(X: any) {
  if (!LIVE.px || !X || !X.C || !X.T || typeof X.t[0] !== "number") return;
  const i = X.C - 1, bar = X.t[1];
  if (isNaN(X.O[i]) || Date.now() / 1000 >= X.T[i] + bar) return;   // la última vela ya cerró: se espera al recálculo
  if (!X._c0) X._c0 = [X.H[i], X.Lo[i]];
  X.Cl[i] = LIVE.px; X.H[i] = Math.max(X._c0[0], LIVE.px); X.Lo[i] = Math.min(X._c0[1], LIVE.px);
}
export function setData(d: any, sl: any) { DATA = d; SLOW = sl; TFD = { ...d.tf, ...sl.tf }; CGD = d.cg && Array.isArray(d.cg.g) ? { ...d.cg, ex: (d.cg.ex || []).filter((e: any[]) => e[7] && e[0] !== "Agregado").map((e: any[]) => e[0]) } : d.cg && !d.cg.ok ? d.cg : null; }
export const UIS: any = { tf: "1h" };

const B = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const LV: number = 11, GAM = 0.75;
const TFS = ["5m", "15m", "1h", "4h", "1D", "1W", "1M"];
const VIEW: Record<string, number> = { "5m": 144, "15m": 96, "1h": 72, "4h": 90, "1D": 150, "1W": 130, "1M": 71 };
const MINSPAN: Record<string, number> = { "5m": 0.012, "15m": 0.025, "1h": 0.05, "4h": 0.1 };
const CL = "#22d3ee", CS = "#d946ef", BG = "#0b0f14";
const TOUCH_OFF = 72; // px que la cruceta táctil queda por encima del dedo

function unrle(s: string, n: number): Uint8Array {
  const o = new Uint8Array(n); let k = 0;
  for (let i = 0; i < s.length && k < n; i++) {
    if (s[i] === "~") { const v = B.indexOf(s[i + 1]), r = B.indexOf(s[i + 2]) + 4; for (let j = 0; j < r && k < n; j++) o[k++] = v; i += 2; }
    else o[k++] = B.indexOf(s[i]);
  }
  return o;
}
function lut(st: number[][]): string[] {
  const c: string[] = [];
  for (let i = 0; i <= LV; i++) {
    const t = i / LV; let k = 0; while (k < st.length - 2 && t > st[k + 1][0]) k++;
    const a = st[k], b = st[k + 1], u = (t - a[0]) / (b[0] - a[0]);
    const m = (j: number) => a[j] + (b[j] - a[j]) * u;
    c.push(`rgba(${Math.round(m(1))},${Math.round(m(2))},${Math.round(m(3))},${m(4).toFixed(3)})`);
  }
  return c;
}
const LUTL = lut([[0, 10, 40, 110, 0.30], [0.35, 20, 90, 200, 0.62], [0.7, 30, 170, 245, 0.9], [1, 110, 230, 255, 1]]);   // longs: azul → cian (sin blanco)
const LUTS = lut([[0, 60, 15, 100, 0.30], [0.35, 130, 30, 190, 0.62], [0.7, 200, 60, 240, 0.9], [1, 240, 140, 255, 1]]);   // shorts: violeta → magenta (sin blanco)

function decode(x0: any) {
  const x = { ...x0, hmL: [].concat(x0.hmL).join(""), hmS: [].concat(x0.hmS).join(""), cd: [].concat(x0.cd).join("") };
  const C = x.C, R = x.R, lr = Math.log(x.hi / x.lo);
  const L = unrle(x.hmL, R * C), S = unrle(x.hmS, R * C);
  const q = (s: string) => x.lo + ((B.indexOf(s[0]) << 6) + B.indexOf(s[1])) / 4095 * (x.hi - x.lo);
  const O: number[] = [], H: number[] = [], Lo: number[] = [], Cl: number[] = [];
  for (let i = 0; i < C; i++) {
    const s = x.cd.substr(i * 8, 8);
    if (s[0] === "~") { O.push(NaN); H.push(NaN); Lo.push(NaN); Cl.push(NaN); }
    else { O.push(q(s.substr(0, 2))); H.push(q(s.substr(2, 2))); Lo.push(q(s.substr(4, 2))); Cl.push(q(s.substr(6, 2))); }
  }
  const T: number[] = [];
  if (x.t[0] === "M") { const d0 = new Date(x.t[1] * 1000); for (let i = 0; i < C; i++) T.push(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + i, 1) / 1000); }
  else for (let i = 0; i < C; i++) T.push(x.t[0] + i * x.t[1]);
  const edge = (r: number) => x.lo * Math.exp((r / R) * lr);
  return { ...x, L, S, O, H, Lo, Cl, T, edge, lr };
}
const fmtN = (v: number, d = 0) => v.toLocaleString("es-ES", { minimumFractionDigits: d, maximumFractionDigits: d });
const p2 = (n: number) => (n < 10 ? "0" : "") + n;
const FMT = typeof Intl !== "undefined" ? new Intl.DateTimeFormat("en-GB", { timeZone: "Atlantic/Canary", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }) : null;
function fmtT(t: number, tf: string, long = false) {
  const d = new Date(t * 1000);
  let D = p2(d.getUTCDate()), M = p2(d.getUTCMonth() + 1), Y = d.getUTCFullYear(), h = p2(d.getUTCHours()), m = p2(d.getUTCMinutes());
  if (FMT && tf !== "1D" && tf !== "1W" && tf !== "1M") {
    const g: Record<string, string> = {}; for (const x of FMT.formatToParts(d)) g[x.type] = x.value;
    D = g.day; M = g.month; Y = +g.year; h = g.hour; m = g.minute;
  }
  if (tf === "1M") return `${M}/${Y}`;
  if (tf === "1D" || tf === "1W") return long ? `${D}/${M}/${Y}` : `${D}/${M}/${String(Y).slice(2)}`;
  return long ? `${D}/${M}/${Y} ${h}:${m}` : (h === "00" && m === "00" ? `${D}/${M}` : `${D}/${M} ${h}:${m}`);
}
const valM = (lv: number, zm: number) => (lv ? Math.pow(lv / LV, 1 / GAM) * zm : 0);

function lastWick(X: any) {
  let h = -Infinity, l = Infinity;
  // X puede ser el payload crudo (QuickRead) o el decodificado (el gráfico, con H/Lo)
  if (X && X.H && X.Lo && X.C) {
    const i = X.C - 1;
    if (X.H[i] > 0) h = X.H[i];
    if (X.Lo[i] > 0) l = X.Lo[i];
  }
  if (DATA && DATA.px > 0) { h = Math.max(h === -Infinity ? DATA.px : h, DATA.px); l = Math.min(l === Infinity ? DATA.px : l, DATA.px); }
  return { h, l };
}
function zoneAlive(side: number, p: number, w: { h: number; l: number }) { return side ? w.h < p : w.l > p; }
function applyLastWickCell(l: number, sv: number, X: any, r: number, i: number) {
  if (i !== X.C - 1) return [l, sv] as const;
  const p = X.lo * Math.exp((r + 0.5) / X.R * X.lr);
  const w = lastWick(X);
  if (w.l <= p) l = 0;
  if (w.h >= p) sv = 0;
  return [l, sv] as const;
}

function niceStep(span: number, n: number) {
  const raw = span / n, p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p;
  return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p;
}

function Chart({ tf, thr, zonas }: { tf: string; thr: number; zonas: boolean }) {
  const X = useMemo(() => decode(TFD[tf]), [tf, TFD[tf]]);
  const opts = useRef({ thr, zonas });
  opts.current = { thr, zonas };
  const wrap = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const xb = useRef<HTMLButtonElement>(null);
  const st = useRef<any>({ a: 0, b: 1, pl: null, ph: null, cross: null, tx: false, W: 600, H: 420, raf: 0, pw: 400, ph2: 300 });
  const TX = 24;
  const dec = DATA.px < 100 ? 2 : 0;

  const draw = () => {
    applyLive(X);
    const c = cv.current; if (!c) return;
    const s = st.current, ctx = c.getContext("2d"); if (!ctx) return;
    const dpr = (typeof window !== "undefined" && window.devicePixelRatio) || 1;
    const W = s.W, H = s.H, narrow = W < 520;
    const AX = narrow ? 58 : 66, HW = 0;
    const pw = W - AX - HW, ph = H - TX, xa = pw + HW;   // xa = inicio del eje de precio
    if (c.width !== Math.round(W * dpr)) c.width = Math.round(W * dpr);
    if (c.height !== Math.round(H * dpr)) c.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H);
    const C = X.C, R = X.R, a = s.a, b = s.b, cw = pw / (b - a);
    const i0 = Math.max(0, Math.floor(a)), i1 = Math.min(C - 1, Math.ceil(b));
    let lo = s.pl, hi = s.ph;
    if (lo == null || hi == null) {
      lo = Infinity; hi = -Infinity;
      for (let i = i0; i <= i1; i++) if (!isNaN(X.H[i])) { lo = Math.min(lo, X.Lo[i]); hi = Math.max(hi, X.H[i]); }
      if (!isFinite(lo)) { lo = X.lo; hi = X.hi; }
      const m = (hi - lo) * 0.08; lo -= m; hi += m;
      const ms = MINSPAN[tf]; if (ms) { lo = Math.min(lo, DATA.px * (1 - ms)); hi = Math.max(hi, DATA.px * (1 + ms)); }
    }
    s.lo = lo; s.hi = hi; s.pw = pw; s.ph2 = ph; s.cw = cw;
    const yOf = (p: number) => ((hi - p) / (hi - lo)) * ph;
    const xOf = (i: number) => (i - a) * cw + cw / 2;
    const thrv = opts.current.thr;
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, pw, ph); ctx.clip();
    const step = niceStep(hi - lo, Math.max(3, Math.floor(ph / 55)));
    ctx.strokeStyle = "rgba(110,118,129,.18)"; ctx.lineWidth = 1;
    for (let p = Math.ceil(lo / step) * step; p < hi; p += step) { const y = Math.round(yOf(p)) + 0.5; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(pw, y); ctx.stroke(); }
    // heatmap (debajo de las velas); se ocultan niveles por debajo del umbral de sensibilidad
    const w = Math.ceil(cw) + 1;
    for (let r = 0; r < R; r++) {
      const y0 = yOf(X.edge(r + 1)), y1 = yOf(X.edge(r));
      if (y1 < 0 || y0 > ph) continue;
      const yA = Math.round(y0), hh = Math.max(1, Math.round(y1) - yA);
      for (let i = i0; i <= i1; i++) {
        const k = r * C + i; let l = X.L[k], sv = X.S[k];
        [l, sv] = applyLastWickCell(l, sv, X, r, i);
        if (l < thrv) l = 0; if (sv < thrv) sv = 0;
        if (!l && !sv) continue;
        const x = Math.round((i - a) * cw), wx = Math.max(1, Math.round((i + 1 - a) * cw) - x);
        if (l) { ctx.fillStyle = LUTL[l]; ctx.fillRect(x, yA, wx, hh); }
        if (sv) { ctx.fillStyle = LUTS[sv]; ctx.fillRect(x, yA, wx, hh); }
      }
    }
    // velas: verde/rojo saturados con contorno oscuro fino (el mapa usa azul-cian y violeta-magenta, sin blanco)
    const bw = Math.max(1, Math.min(cw * 0.7, cw - 1)), bwr = Math.max(1, Math.round(bw));
    ctx.fillStyle = "rgba(11,15,20,.4)";   // atenúa un poco el mapa justo detrás de cada vela
    for (let i = i0; i <= i1; i++) { if (isNaN(X.O[i])) continue; const x = xOf(i), yh = yOf(X.H[i]); ctx.fillRect(Math.round(x - bwr / 2) - 1, yh - 1, bwr + 2, yOf(X.Lo[i]) - yh + 2); }
    for (let i = i0; i <= i1; i++) {
      if (isNaN(X.O[i])) continue;
      const sub = X.sub && i >= X.sub[0] && i <= X.sub[1];
      const up = X.Cl[i] >= X.O[i], x = Math.round(xOf(i)) + 0.5;
      const col = up ? (sub ? "#4d9e6a" : "#22e55a") : (sub ? "#a85a5a" : "#ff3b30");
      const yh = yOf(X.H[i]), yl = yOf(X.Lo[i]), yo = yOf(X.O[i]), yc = yOf(X.Cl[i]);
      ctx.strokeStyle = "rgba(0,0,0,.85)"; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(x, yh); ctx.lineTo(x, yl); ctx.stroke();
      ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, yh); ctx.lineTo(x, yl); ctx.stroke();
      const bx = Math.round(x - bwr / 2), by = Math.min(yo, yc), bh = Math.max(1, Math.abs(yc - yo));
      ctx.fillStyle = col; ctx.fillRect(bx, by, bwr, bh);
      if (bwr >= 3) { ctx.strokeStyle = "rgba(0,0,0,.9)"; ctx.strokeRect(bx - 0.5, by - 0.5, bwr + 1, bh + 1); }
    }
    // las 3 zonas más fuertes por lado del mapa unificado: línea punteada + etiqueta simple
    const wick = lastWick(X);
    const tags: any[] = opts.current.zonas ? X.zu.map((z: any[]) => ({ side: z[0], p: z[1], m: z[2], n: z[3], src: z[4], d: z[5] })).filter((t: any) => zoneAlive(t.side, t.p, wick)) : [];
    for (const t of tags) { t.y0 = yOf(t.p); t.y = t.y0; }
    const vis = tags.filter((t) => t.y0 > 6 && t.y0 < ph - 6).sort((p, q) => p.y0 - q.y0);
    for (let k = 1; k < vis.length; k++) if (vis[k].y < vis[k - 1].y + 17) vis[k].y = vis[k - 1].y + 17;
    ctx.font = (narrow ? "10px" : "11px") + " system-ui, sans-serif"; ctx.textBaseline = "middle";
    for (const t of vis) {
      ctx.setLineDash([2, 4]); ctx.strokeStyle = t.side ? "rgba(217,70,239,.75)" : "rgba(34,211,238,.75)";
      ctx.beginPath(); ctx.moveTo(0, t.y0); ctx.lineTo(pw, t.y0); ctx.stroke(); ctx.setLineDash([]);
      const txt = `${fmtN(t.p, dec)} · ${fmtN(t.m, 0)} M$ · ${t.n === 1 ? "1 fuente" : `confirmado por ${t.n} fuentes`}`;
      const tw = ctx.measureText(txt).width + 10;
      ctx.fillStyle = "rgba(11,15,20,.85)"; ctx.fillRect(pw - tw - 2, t.y - 8, tw, 16);
      ctx.fillStyle = t.side ? "#f0abfc" : "#67e8f9"; ctx.textAlign = "right"; ctx.fillText(txt, pw - 7, t.y); ctx.textAlign = "left";
    }
    ctx.font = "11px system-ui, sans-serif";
    // precio actual
    const yp = yOf(DATA.px);
    ctx.setLineDash([6, 4]); ctx.lineWidth = 1.5; ctx.strokeStyle = "#facc15"; ctx.beginPath(); ctx.moveTo(0, yp); ctx.lineTo(xa, yp); ctx.stroke(); ctx.setLineDash([]); ctx.lineWidth = 1;
    if (yp > 14 && yp < ph) { ctx.fillStyle = "rgba(11,15,20,.8)"; ctx.fillRect(4, yp - 17, 92, 14); ctx.fillStyle = "#facc15"; ctx.fillText("Precio actual", 8, yp - 10); }
    // cruceta
    const cr = s.cross;
    let ci = -1;
    if (cr && cr.x < pw && cr.y < ph) {
      ci = Math.max(0, Math.min(C - 1, Math.floor(a + cr.x / cw)));
      ctx.setLineDash([3, 3]); ctx.strokeStyle = s.tx ? "rgba(255,255,255,.9)" : "rgba(201,209,217,.75)";
      ctx.beginPath(); ctx.moveTo(xOf(ci), 0); ctx.lineTo(xOf(ci), ph); ctx.moveTo(0, cr.y); ctx.lineTo(xa, cr.y); ctx.stroke(); ctx.setLineDash([]);
      if (s.tx) { ctx.strokeStyle = "#fff"; ctx.beginPath(); ctx.arc(xOf(ci), cr.y, 5, 0, Math.PI * 2); ctx.stroke(); }
    }
    ctx.restore();
    ctx.strokeStyle = "#30363d"; ctx.beginPath(); ctx.moveTo(xa + 0.5, 0); ctx.lineTo(xa + 0.5, H); ctx.stroke();
    // eje de precio
    ctx.font = "11px system-ui, sans-serif"; ctx.fillStyle = "#c9d1d9"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
    for (let p = Math.ceil(lo / step) * step; p < hi; p += step) { const y = yOf(p); if (y > 8 && y < ph - 8) ctx.fillText(fmtN(p, dec), xa + 6, y); }
    const tag = (y: number, txt: string, bg: string, fg: string) => { ctx.fillStyle = bg; ctx.fillRect(xa + 1, y - 8, AX - 1, 16); ctx.fillStyle = fg; ctx.fillText(txt, xa + 4, y); };
    for (const t of vis) {
      ctx.strokeStyle = t.side ? "#d946ef" : "#22d3ee"; ctx.beginPath(); ctx.moveTo(xa - 6, t.y0); ctx.lineTo(xa, t.y); ctx.stroke();
      tag(t.y, fmtN(t.p, dec), t.side ? "#a21caf" : "#0e7490", "#fff");
    }
    if (yp >= 0 && yp <= ph) tag(yp, fmtN(DATA.px, dec), "#facc15", "#000");
    // eje de tiempo
    ctx.textAlign = "center"; ctx.fillStyle = "#c9d1d9";
    const every = Math.max(1, Math.ceil(78 / cw));
    for (let i = Math.ceil(i0 / every) * every; i <= i1; i += every) { const x = xOf(i); if (x > 20 && x < pw - 20) ctx.fillText(fmtT(X.T[i], tf), x, ph + TX / 2); }
    let pr = 0;
    if (cr && ci >= 0) {
      pr = lo + ((ph - cr.y) / ph) * (hi - lo);
      ctx.textAlign = "left"; tag(cr.y, fmtN(pr, dec), "#2962ff", "#fff");
      ctx.textAlign = "center"; const tl = fmtT(X.T[ci], tf, true), tw = ctx.measureText(tl).width + 12;
      const tx = Math.max(tw / 2, Math.min(pw - tw / 2, xOf(ci)));
      ctx.fillStyle = "#2962ff"; ctx.fillRect(tx - tw / 2, ph + 1, tw, TX - 2); ctx.fillStyle = "#fff"; ctx.fillText(tl, tx, ph + TX / 2);
    }
    ctx.textAlign = "left";
    if (xb.current) xb.current.style.display = s.tx ? "block" : "none";
    // etiqueta de información
    const tp = tip.current;
    if (!tp) return;
    if (!(cr && ci >= 0)) { tp.style.display = "none"; return; }
    const r = Math.floor((Math.log(pr / X.lo) / X.lr) * R);
    const ok = r >= 0 && r < R, k = r * C + ci;
    let vl = ok ? X.L[k] : 0, vs = ok ? X.S[k] : 0;
    if (ok) [vl, vs] = applyLastWickCell(vl, vs, X, r, ci);
    const dist = (pr / DATA.px - 1) * 100;
    const lines: [string, string][] = [];
    const sg = dist > 0 ? "+" : "";
    // etiqueta fija arriba a la izquierda (estilo panel OHLC de TradingView), compacta y semitransparente
    const oc = !isNaN(X.O[ci]) ? (X.Cl[ci] >= X.O[ci] ? "#4ade80" : "#f87171") : "#9ca3af";
    const ohlc = !isNaN(X.O[ci]) ? `O ${fmtN(X.O[ci], dec)} H ${fmtN(X.H[ci], dec)} L ${fmtN(X.Lo[ci], dec)} C ${fmtN(X.Cl[ci], dec)}` : "sin vela";
    const tlab = `${fmtT(X.T[ci], tf, true)} ${X.daily ? "UTC" : "Canarias"}`;
    if (narrow) lines.push([tlab, "#e6edf3"], [ohlc, oc]);
    else lines.push([`${tlab} · ${ohlc}`, oc]);
    lines.push([`✛ ${fmtN(pr, dec)} $ (${sg}${fmtN(dist, 2)} %) · <L ~${fmtN(valM(vl, X.zm), 1)}> <S ~${fmtN(valM(vs, X.zm), 1)}> M$`, "#e6edf3"]);
    while (tp.firstChild) tp.removeChild(tp.firstChild);
    for (const [txt, col] of lines) {
      const d = document.createElement("div"); d.style.color = col;
      // colorea los tramos <L ...> (longs) y <S ...> (shorts)
      for (const part of txt.split(/(<[LS] [^>]*>)/)) {
        if (!part) continue; const sp = document.createElement("span");
        if (part[0] === "<") { sp.textContent = part.slice(1, -1); sp.style.color = part[1] === "L" ? "#67e8f9" : "#f0abfc"; sp.style.fontWeight = "600"; }
        else sp.textContent = part;
        d.appendChild(sp);
      }
      tp.appendChild(d);
    }
    tp.style.display = "block"; tp.style.left = "4px"; tp.style.top = "4px";
  };
  const drawR = useRef<any>(null); drawR.current = draw;
  const req = () => { const s = st.current; if (s.raf) return; s.raf = requestAnimationFrame(() => { s.raf = 0; drawR.current(); }); };
  useEffect(() => { req(); });
  const closeCross = () => { const s = st.current; s.tx = false; s.cross = null; req(); };

  useEffect(() => {
    const s = st.current, n = Math.max(8, Math.round(Math.min(VIEW[tf] || 80, X.C) * ((wrap.current && wrap.current.clientWidth < 520) ? 0.6 : 1)));
    s.a = X.C - n; s.b = X.C + Math.max(2, n * 0.04); s.pl = null; s.ph = null; s.cross = null; s.tx = false; req();
  }, [tf]);
  useEffect(() => {
    const el = cv.current, wr = wrap.current; if (!el || !wr) return;
    const s = st.current;
    const size = () => {
      s.W = Math.max(280, wr.clientWidth);
      const vh = typeof window !== "undefined" ? window.innerHeight : 800;
      s.H = Math.round(Math.max(360, Math.min(660, vh * 0.66)));
      el.style.width = s.W + "px"; el.style.height = s.H + "px"; req();
    };
    size();
    let ro: any = null;
    if (typeof ResizeObserver !== "undefined") { ro = new ResizeObserver(size); ro.observe(wr); }
    const clampX = () => { const span = s.b - s.a; if (s.b > X.C + span * 0.5) { s.b = X.C + span * 0.5; s.a = s.b - span; } if (s.a < -span * 0.5) { s.a = -span * 0.5; s.b = s.a + span; } };
    const zoomX = (f: number, mx: number) => {
      const span = s.b - s.a, ns = Math.max(10, Math.min(X.C * 1.4, span * f)), anc = s.a + (mx / s.pw) * span;
      s.a = anc - (anc - s.a) * (ns / span); s.b = s.a + ns; clampX();
    };
    const zoomY = (f: number) => { const lo = s.lo, hi = s.hi, mid = (lo + hi) / 2, h = ((hi - lo) / 2) * f; s.pl = mid - h; s.ph = mid + h; };
    const pos = (e: any) => { const r = el.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const inPlot = (p: { x: number; y: number }) => p.x >= 0 && p.x < s.pw && p.y >= 0 && p.y < s.ph2;
    const onWheel = (e: WheelEvent) => { e.preventDefault(); const p = pos(e), f = Math.exp(e.deltaY * 0.0015); if (p.x > s.pw) zoomY(f); else zoomX(f, p.x); req(); };
    const pts = new Map<number, { x: number; y: number }>();
    let drag: any = null, pinch: any = null, moved = false;
    const onDown = (e: PointerEvent) => {
      try { el.setPointerCapture(e.pointerId); } catch (_) { /* sin captura */ }
      const p = pos(e); pts.set(e.pointerId, p); if (pts.size === 1) moved = false;
      if (pts.size === 2) {
        const [p1, p2] = Array.from(pts.values());
        pinch = { d: Math.hypot(p1.x - p2.x, p1.y - p2.y), a: s.a, b: s.b, mx: (p1.x + p2.x) / 2 }; drag = null; moved = true;
      } else if (e.pointerType !== "mouse" && s.tx && p.x < s.pw) drag = { cross: true, x: p.x, y: p.y };
      else drag = { x: p.x, y: p.y, a: s.a, b: s.b, pl: s.pl, ph: s.ph, lo: s.lo, hi: s.hi, axis: p.x > s.pw };
    };
    const onMove = (e: PointerEvent) => {
      const p = pos(e);
      if (pts.has(e.pointerId)) pts.set(e.pointerId, p);
      if (pinch && pts.size === 2) {
        const [p1, p2] = Array.from(pts.values()), d = Math.hypot(p1.x - p2.x, p1.y - p2.y);
        s.a = pinch.a; s.b = pinch.b; zoomX(pinch.d / Math.max(10, d), pinch.mx); req(); return;
      }
      if (drag && drag.cross) {
        // cruceta táctil activa: el dedo mueve la cruz (desplazada hacia arriba), no hay pan
        if (Math.abs(p.x - drag.x) + Math.abs(p.y - drag.y) > 6) moved = true;
        if (moved) { s.cross = { x: Math.max(0, Math.min(s.pw - 1, p.x)), y: Math.max(0, Math.min(s.ph2 - 1, p.y - TOUCH_OFF)) }; req(); }
        return;
      }
      if (drag) {
        const dx = p.x - drag.x, dy = p.y - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
        if (drag.axis) {
          const f = Math.exp(dy * 0.006), mid = (drag.lo + drag.hi) / 2, h = ((drag.hi - drag.lo) / 2) * f; s.pl = mid - h; s.ph = mid + h;
        } else {
          const cw = s.pw / (drag.b - drag.a); s.a = drag.a - dx / cw; s.b = drag.b - dx / cw; clampX();
          if (drag.pl != null) { const dp = (dy / s.ph2) * (drag.ph - drag.pl); s.pl = drag.pl + dp; s.ph = drag.ph + dp; }
        }
        if (e.pointerType === "mouse") s.cross = inPlot(p) ? p : null;
        req(); return;
      }
      if (e.pointerType === "mouse") { s.cross = inPlot(p) ? p : null; req(); }
    };
    const onUp = (e: PointerEvent) => {
      const p = pos(e), last = pts.size === 1;
      if (last && !moved && e.pointerType !== "mouse") {
        if (s.tx) { s.tx = false; s.cross = null; }               // segundo toque: desactiva
        else if (inPlot(p)) { s.tx = true; s.cross = p; }          // primer toque: activa
      }
      pts.delete(e.pointerId); if (pts.size < 2) pinch = null; if (pts.size === 0) drag = null; req();
    };
    const onLeave = (e: PointerEvent) => { if (e.pointerType === "mouse" && !drag) { s.cross = null; req(); } };
    const onDbl = (e: MouseEvent) => { const p = pos(e); s.pl = null; s.ph = null; if (p.x < s.pw) { const n = Math.max(8, Math.round(Math.min(VIEW[tf] || 80, X.C) * ((wrap.current && wrap.current.clientWidth < 520) ? 0.6 : 1))); s.a = X.C - n; s.b = X.C + Math.max(2, n * 0.04); } req(); };
    const onDocDown = (e: PointerEvent) => { if (s.tx && e.target instanceof Node && !wr.contains(e.target)) { s.tx = false; s.cross = null; req(); } };
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("pointerdown", onDown); el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp); el.addEventListener("pointercancel", onUp); el.addEventListener("pointerleave", onLeave);
    el.addEventListener("dblclick", onDbl);
    document.addEventListener("pointerdown", onDocDown);
    return () => {
      if (ro) ro.disconnect();
      el.removeEventListener("wheel", onWheel); el.removeEventListener("pointerdown", onDown); el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp); el.removeEventListener("pointercancel", onUp); el.removeEventListener("pointerleave", onLeave);
      el.removeEventListener("dblclick", onDbl);
      document.removeEventListener("pointerdown", onDocDown);
    };
  }, [tf]);

  return (
    <div ref={wrap} style={{ position: "relative", width: "100%", borderRadius: "0 0 8px 8px", overflow: "hidden", background: BG }}>
      <canvas ref={cv} style={{ display: "block", touchAction: "none", cursor: "crosshair" }} />
      <div ref={tip} style={{ position: "absolute", display: "none", pointerEvents: "none", background: "rgba(11,15,20,.55)", color: "#e6edf3", borderRadius: 4, padding: "2px 6px", fontSize: 11, lineHeight: 1.35, whiteSpace: "nowrap", zIndex: 3, fontVariantNumeric: "tabular-nums" }} />
      <button ref={xb} onClick={closeCross} aria-label="Cerrar cruceta" style={{ position: "absolute", display: "none", right: 2, bottom: 1, zIndex: 4, font: "inherit", fontSize: 12, padding: "2px 8px", borderRadius: 11, border: "1px solid #6e7681", background: "rgba(13,17,23,.92)", color: "#fff", cursor: "pointer" }}>✕ cruz</button>
    </div>
  );
}

const panel = { background: BG, color: "#e6edf3", border: "1px solid #30363d", borderRadius: 8, padding: "8px 12px" } as const;

function QuickRead({ X, tf }: { X: any; tf: string }) {
  const dec = DATA.px < 100 ? 2 : 0;
  const wickQ = lastWick(X);
  const zs = X.zu.map((z: any[]) => ({ side: z[0], p: z[1], m: z[2], n: z[3], d: z[5] })).filter((z: any) => zoneAlive(z.side, z.p, wickQ));
  const up = zs.filter((z: any) => z.side === 1).sort((a: any, b: any) => a.d - b.d)[0];
  const dn = zs.filter((z: any) => z.side === 0).sort((a: any, b: any) => b.d - a.d)[0];
  const f = (z: any) => `${fmtN(z.p, dec)} $ (${z.d > 0 ? "+" : ""}${fmtN(z.d, 1)} %, ~${fmtN(z.m, 0)} M$, ${z.n} fuente${z.n === 1 ? "" : "s"})`;
  const nL = X.nr[0], nS = X.nr[1];
  const where = X.zu.length ? (nL > nS * 1.2 ? "con más liquidaciones de longs debajo que de shorts encima" : nS > nL * 1.2 ? "con más liquidaciones de shorts encima que de longs debajo" : "con liquidez parecida por encima y por debajo") : "";
  const big = up && dn ? (up.m >= dn.m ? `El mayor es el de arriba (~${fmtN(up.m, 0)} M$ frente a ~${fmtN(dn.m, 0)} M$): una subida liquidaría más shorts.` : `El mayor es el de abajo (~${fmtN(dn.m, 0)} M$ frente a ~${fmtN(up.m, 0)} M$): una bajada liquidaría más longs.`) : "";
  return (
    <div style={{ ...panel, fontSize: 14, lineHeight: 1.55, margin: "8px 0" }}>
      <div>El precio ({fmtN(DATA.px, dec)} $) está {where} en ±5 % (~{fmtN(nL, 0)} M$ longs / ~{fmtN(nS, 0)} M$ shorts, {tf}).</div>
      <div><span style={{ color: "#f0abfc" }}>Imán más cercano arriba:</span> {up ? f(up) : "ninguno relevante"} · <span style={{ color: "#67e8f9" }}>abajo:</span> {dn ? f(dn) : "ninguno relevante"}.</div>
      {big ? <div>{big}</div> : null}
    </div>
  );
}

function UpdBox() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 20000); return () => clearInterval(id); }, []);
  const age = Math.max(0, Math.floor((now - DATA.ts) / 60000)), old = age > 30, col = old ? "#f59e0b" : "#3fb950";
  return (
    <div style={{ background: BG, color: "#e6edf3", border: `2px solid ${col}`, borderRadius: 8, padding: "6px 12px", margin: "6px 0 8px" }}>
      <div style={{ fontSize: 15, fontWeight: 700 }}>Última actualización: {String(DATA.upd).slice(11, 16)} (hora de Canarias) <span style={{ color: col }}>· hace {age} min{old ? " ⚠ más de 30 min" : ""}</span></div>
      <div style={{ fontSize: 11, color: "#9ca3af" }}>Se recalcula en esta página cada 15 min mientras esté abierta ({DATA.nreq} peticiones a APIs públicas) · 1D/1W/1M a las {String(SLOW.upd).slice(11, 16)}</div>
    </div>
  );
}

function Seg({ opts, value, onChange }: { opts: [string, any][]; value: any; onChange: (v: any) => void }) {
  return (
    <div style={{ display: "inline-flex", flex: "0 0 auto", border: "1px solid #3d444d", borderRadius: 8, overflow: "hidden" }}>
      {opts.map(([lab, v], k) => (
        <button key={k} onClick={() => onChange(v)} aria-pressed={v === value} style={{ font: "inherit", fontSize: 13, fontWeight: v === value ? 700 : 500, minHeight: 34, minWidth: 40, padding: "0 9px", border: "none", borderLeft: k ? "1px solid #3d444d" : "none", cursor: "pointer", whiteSpace: "nowrap", background: v === value ? "#2962ff" : "transparent", color: v === value ? "#fff" : "#c9d1d9" }}>{lab}</button>
      ))}
    </div>
  );
}

function Sources({ X }: { X: any }) {
  const byMsg = new Map<string, string[]>();
  for (const [k, v] of Object.entries(DATA.fail || {})) {
    const label = k.replace(/_(5m|15m|1h|4h|1D|1W|1M)$/, "");
    const arr = byMsg.get(String(v)) || [];
    if (!arr.includes(label)) arr.push(label);
    byMsg.set(String(v), arr);
  }
  const fails = [...byMsg.entries()].map(([msg, names]) => `${names.join(", ")} (${msg})`);
  const cg = CGD, cgAge = cg && cg.ok ? (Date.now() - cg.ts) / 3600000 : 0;
  if (cg && !cg.ok) fails.push(`CoinGlass (${cg.err})`);
  const cgw = cg && cg.ok ? cgWeight(cgAge) : (DATA.cgw == null ? 0 : DATA.cgw);
  if (cg && cg.ok && cgAge > CG_FADE_END_H) fails.push(`CoinGlass desactualizado (hace ${fmtN(cgAge, 1)} h): fuera del mapa hasta la próxima lectura`);
  else if (cg && cg.ok && cgAge > CG_FRESH_H) fails.push(`CoinGlass (lectura de hace ${fmtN(cgAge, 1)} h): peso reducido al ${fmtN(cgw * 100, 0)} %`);
  const ob = DATA.ob || {};
  const obSpan = (ob.span || []).map((s: any[]) => `${s[0]} −${s[1]} %/+${s[2]} %`).join(", ");
  const obTxt = (ob.ok || []).length
    ? ` + libro de órdenes ${(ob.ok || []).join("/")} (×0,3, liquidez actual del book público${obSpan ? `, cobertura ${obSpan}` : ""}; no llega a ±5–10 % con las APIs públicas)`
    : " + libro de órdenes Binance/OKX/Bybit (×0,3; no disponible en esta pasada)";
  return (
    <div id="fuentes" style={{ fontSize: 11, color: "#8b949e", lineHeight: 1.5, marginTop: 6 }}>
      <div><b style={{ color: "#f59e0b" }}>ESTIMADO</b> · Mapa unificado en M$: modelo propio de OI y apalancamiento (×1) + CoinGlass combinado (×1{cg && cg.ok ? `${cgw < 1 ? ` × ${fmtN(cgw, 2)} por antigüedad` : ""}, ${cg.ex.length} exch, leído ${cg.at}` : ""}) + posiciones reales de Hyperliquid (×1) + liquidaciones reales (×1){obTxt}; donde coinciden, se suman y sale más intenso. Las fuentes «de ahora» (CoinGlass, Hyperliquid, libro de órdenes) se pintan en las últimas columnas. Todo en precio {DATA.kf}{DATA.basis ? ` (ajuste: ${DATA.basis.ex.map((e: any[]) => `${e[0]} ${e[1] > 0 ? "+" : e[1] < 0 ? "−" : ""}${fmtN(Math.abs(e[1]), 0)} $`).join(", ")})` : ""}. Velas {DATA.kf} verdes/rojas{X.ns ? ` (apagadas = sustitutas ${X.kSrc || "Binance"})` : ""}.</div>
      <div>Fuentes OK: {DATA.ok}{cg && cg.ok && cgAge <= CG_FRESH_H ? " · CoinGlass" : ""}</div>
      {fails.length ? <div style={{ color: "#f0883e" }}>Fallan: {fails.join(" · ")}</div> : null}
      {(DATA.notes || []).length ? <div>⚠ {(DATA.notes || []).join(" · ")}</div> : null}
      <div>Horas de Canarias (1D/1W/1M en UTC). Toque = cruz de lectura (otro toque o ✕ la cierra) · pellizco/rueda = zoom · arrastrar = mover. Solo datos públicos; no es asesoramiento.</div>
    </div>
  );
}

function loadThr() {
  try { const n = parseInt(localStorage.getItem("liqmap.thr") || "", 10); if (n >= 1 && n <= 9) return n; } catch (_) { /* */ }
  return 3;
}
function loadZonas() {
  try { const v = localStorage.getItem("liqmap.zonas"); if (v === "0") return false; if (v === "1") return true; } catch (_) { /* */ }
  return true;
}
function Swatches({ lut, thr }: { lut: string[]; thr: number }) {
  return (
    <span style={{ display: "inline-flex", height: 10, borderRadius: 2, overflow: "hidden", border: "1px solid #30363d", flex: "0 0 auto" }}>
      {lut.slice(1).map((c, i) => <span key={i} style={{ width: 8, height: 10, background: i + 1 < thr ? "#1c2128" : c }} />)}
    </span>
  );
}

export function MapView() {
  const [, setBump] = useState(0);
  const [thr, setThr] = useState(loadThr);
  const [zonas, setZonas] = useState(loadZonas);
  useEffect(() => { BUMP.f = () => setBump((x: number) => x + 1); return () => { BUMP.f = null; }; }, []);
  useEffect(() => { try { localStorage.setItem("liqmap.thr", String(thr)); } catch (_) { /* */ } }, [thr]);
  useEffect(() => { try { localStorage.setItem("liqmap.zonas", zonas ? "1" : "0"); } catch (_) { /* */ } }, [zonas]);
  const AV = TFS.filter((t) => TFD[t] && TFD[t].hmL);
  const [tf0, setTf] = useState(TFD[UIS.tf] ? UIS.tf : Object.keys(TFD)[0] || "1h");
  const tf = AV.includes(tf0) ? tf0 : AV.includes("1h") ? "1h" : AV[0];
  if (!AV.length) return (<Page title={`Mapa Liquidaciones · ${(DATA && DATA.sym) || "BTC"}`} width="full"><div style={{ ...panel, margin: "8px 0" }}>Mapa en preparación: los datos llegan con la próxima actualización automática (cada 15 min).</div></Page>);
  UIS.tf = tf;
  const X = TFD[tf];
  const ticks = [1, Math.round(LV / 2), LV].map((l) => (l === LV ? `≥${fmtN(X.zm, 0)}` : fmtN(valM(l, X.zm), 0)));
  const hidden = thr > 1 ? `oculta < ${fmtN(valM(thr - 1, X.zm), 1)} M$` : "todo";
  const sbtn = { font: "inherit", fontSize: 18, fontWeight: 700, width: 34, height: 34, borderRadius: 17, border: "1px solid #3d444d", background: "#161b22", color: "#fff", cursor: "pointer", flex: "0 0 auto", lineHeight: "30px", padding: 0 } as const;
  return (
    <Page title={`Mapa Liquidaciones · ${DATA.sym || "BTC"}`} width="full">
      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px", alignItems: "baseline" }}>
        <span style={{ fontSize: 20, fontWeight: 700 }}>{DATA.kf} {fmtN(DATA.px, 1)} $</span>
        <span style={{ fontSize: 12, color: "#8b949e" }}>Kraken Futures · mapa unificado ESTIMADO</span>
      </div>
      <UpdBox />
      <div style={{ background: BG, color: "#e6edf3", border: "1px solid #30363d", borderRadius: 8 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", overflowX: "auto", flexWrap: "nowrap", padding: "6px 8px", borderBottom: "1px solid #21262d", WebkitOverflowScrolling: "touch" }}>
          <Seg opts={TFS.filter((t) => TFD[t]).map((t) => [t, t] as [string, any])} value={tf} onChange={setTf} />
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, flex: "0 0 auto" }}>
            <button onClick={() => setThr(Math.max(1, thr - 1))} disabled={thr <= 1} aria-label="Menos filtro" style={{ ...sbtn, opacity: thr <= 1 ? 0.35 : 1 }}>−</button>
            <span id="filtro-label" style={{ fontSize: 12, textAlign: "center", lineHeight: 1.15, minWidth: 78 }}>Filtro {thr}<br /><span style={{ color: "#8b949e", fontSize: 11 }}>{hidden}</span></span>
            <button onClick={() => setThr(Math.min(9, thr + 1))} disabled={thr >= 9} aria-label="Más filtro" style={{ ...sbtn, opacity: thr >= 9 ? 0.35 : 1 }}>+</button>
            <button onClick={() => setZonas((z) => !z)} aria-pressed={zonas} aria-label="Zonas" title="Muestra u oculta las líneas de las zonas fuertes" style={{ font: "inherit", fontSize: 13, fontWeight: zonas ? 700 : 500, minHeight: 34, padding: "0 12px", borderRadius: 17, cursor: "pointer", flex: "0 0 auto", border: `1.5px solid ${zonas ? "#22d3ee" : "#3d444d"}`, background: zonas ? "#22d3ee22" : "transparent", color: zonas ? "#fff" : "#8b949e" }}>Zonas</button>
          </span>
        </div>
        <Chart tf={tf} thr={thr} zonas={zonas} />
      </div>
      <QuickRead X={X} tf={tf} />
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 10px", fontSize: 12, color: "#c9d1d9" }}>
        <Swatches lut={LUTL} thr={thr} /> longs (se liquidan si baja)
        <Swatches lut={LUTS} thr={thr} /> shorts (si sube)
        <span style={{ color: "#8b949e" }}>{ticks.join(" → ")} M$ · gris = oculto por el filtro · <span style={{ color: "#facc15" }}>- - precio actual</span></span>
      </div>
      <Sources X={X} />
    </Page>
  );
}
