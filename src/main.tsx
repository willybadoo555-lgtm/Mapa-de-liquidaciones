import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { runEngine, SYM } from "./engine.js";
import { prepareCoinGlass } from "./coinglass.js";
import { fetchHlTop } from "./hl.js";
import { http } from "./http.js";
import { MapView, setData, setLivePx, bump } from "./mapview";
import HL_SEED from "../data/hl_seed.json";

const REFRESH_MIN = 15;
const BG = "#0b0f14";
const LIVE_RECALC_MS = 60000;
const POLL_MS = 12000;

const store = {
  get: async (k: string) => localStorage.getItem(k),
  set: async (k: string, v: string) => {
    try { localStorage.setItem(k, v); }
    catch (e) { if (String(k).startsWith("c3:")) throw e; }
  },
};
try {
  if (!localStorage.getItem("hl_addrs")) localStorage.setItem("hl_addrs", JSON.stringify(HL_SEED));
} catch (_) { /* modo privado */ }

const hlTop = async (n: number) => fetchHlTop(http, n);

const WSQ: any[] = [];
function ws(url: string, onOpen: ((w: WebSocket) => void) | null, onMsg: (d: any) => void) {
  let back = 2000;
  const go = () => {
    let w: WebSocket;
    try { w = new WebSocket(url); }
    catch (_) { setTimeout(go, back); return; }
    w.onopen = () => { back = 2000; if (onOpen) onOpen(w); };
    w.onmessage = (m) => { try { onMsg(JSON.parse(m.data)); } catch (_) { /* */ } };
    w.onerror = () => { try { w.close(); } catch (_) { /* */ } };
    w.onclose = () => { setTimeout(go, back); back = Math.min(60000, back * 2); };
  };
  go();
}
try {
  ws(`wss://fstream.binance.com/ws/${SYM.binance.toLowerCase()}@forceOrder`, null, (m) => {
    const o = m.o; if (!o) return;
    const p = +(o.ap || o.p), q = +(o.z || o.q);
    WSQ.push(["binance", +o.T, o.S === "SELL" ? "long" : "short", p, p * q]);
  });
  ws("wss://stream.bybit.com/v5/public/linear", (w) => {
    w.send(JSON.stringify({ op: "subscribe", args: [`allLiquidation.${SYM.bybit}`] }));
    setInterval(() => { try { w.send('{"op":"ping"}'); } catch (_) { /* */ } }, 20000);
  }, (m) => {
    if (Array.isArray(m.data)) for (const o of m.data) WSQ.push(["bybit", +o.T, o.S === "Buy" ? "long" : "short", +o.p, +o.p * +o.v]);
  });
} catch (_) { /* el navegador puede bloquear estos websockets; el mapa sigue con el resto */ }

function fresh(x: any) {
  return x && x.tf && Object.keys(x.tf).length && Object.values(x.tf).every((t: any) => t && Array.isArray(t.zu));
}
function loadSaved() {
  try {
    const d = JSON.parse(localStorage.getItem("last_data") || "null");
    const s = JSON.parse(localStorage.getItem("last_slow") || "null");
    return fresh(d) && fresh(s) ? { d, s } : null;
  } catch (_) { return null; }
}
async function loadPublished() {
  try {
    const r = await fetch(new URL("data/latest.json", document.baseURI), { cache: "no-cache" });
    if (!r.ok) return null;
    const j = await r.json();
    if (!fresh(j.DATA)) return null;
    const s = j.SLOW && j.SLOW.tf ? j.SLOW : { upd: "—", tf: {} };
    return { d: j.DATA, s };
  } catch (_) { return null; }
}

const CANF = new Intl.DateTimeFormat("en-GB", { timeZone: "Atlantic/Canary", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
const hms = (ms: number) => CANF.format(new Date(ms));

function App() {
  const saved = useRef<any>(null);
  const [ready, setReady] = useState(false);
  const [ver, setVer] = useState(0);
  const verR = useRef(0);
  const [dataTs, setDataTs] = useState(0);
  const [busy, setBusy] = useState("");
  const [prog, setProg] = useState("");
  const [err, setErr] = useState("");
  const [live, setLive] = useState(() => { try { return localStorage.getItem("live") === "1"; } catch (_) { return false; } });
  const [lv, setLv] = useState<{ px: number; ts: number; via: string } | null>(null);
  const running = useRef(false);
  const lastRun = useRef(0);

  const run = async (kind: string) => {
    if (running.current) return;
    running.current = true;
    setBusy(kind);
    setErr("");
    try {
      const liqs = WSQ.splice(0, WSQ.length);
      const prev = saved.current ? saved.current.d : null;
      let cgSeed: any = prev && prev.cg;
      const cgNotes: string[] = [];
      try {
        const res = await fetch(new URL("data/coinglass_latest.json", document.baseURI), { cache: "no-cache" });
        if (!res.ok) cgNotes.push(`CoinGlass: no se pudo leer data/coinglass_latest.json (HTTP ${res.status}). ESTIMADO`);
        else {
          const raw = await res.json();
          const prep = await prepareCoinGlass(http, raw, prev && prev.cg);
          cgSeed = prep.seed;
          cgNotes.push(...(prep.notes || []));
        }
      } catch (e: any) {
        cgNotes.push(`CoinGlass: ${String(e && e.message || e).slice(0, 80)}. ESTIMADO`);
      }
      const r = await runEngine({
        http, hlTop, store, cgSeed, wsLiqs: liqs,
        onProgress: (a: number, b: number) => setProg(`${a}/${b}`),
        only: kind === "live" ? ["5m", "15m"] : null,
        hlMaxAgeMin: kind === "auto" ? 0 : 15,
        prev,
      });
      if (cgNotes.length) r.DATA.notes = [...(r.DATA.notes || []), ...cgNotes];
      let slow = r.SLOW || (saved.current && saved.current.s) || { upd: "—", tf: {} };
      if (!Object.keys(r.DATA.tf).length && !Object.keys(slow.tf || {}).length) throw new Error("no se pudo calcular ninguna temporalidad: " + JSON.stringify(r.errs || {}));
      try {
        localStorage.setItem("last_data", JSON.stringify(r.DATA));
        localStorage.setItem("last_slow", JSON.stringify(slow));
      } catch (_) { /* cuota */ }
      saved.current = { d: r.DATA, s: slow };
      setData(r.DATA, slow);
      setDataTs(r.DATA.ts);
      if (kind !== "live") lastRun.current = Date.now();
      if (kind === "live" && verR.current) bump();
      else { verR.current = r.DATA.ts; setVer(r.DATA.ts); }
    } catch (e: any) {
      setErr(String(e && e.message || e));
      if (kind !== "live") lastRun.current = Date.now() - (REFRESH_MIN - 2) * 60000;
    } finally {
      running.current = false;
      setBusy("");
      setProg("");
    }
  };

  useEffect(() => {
    let dead = false;
    (async () => {
      const pub = await loadPublished();
      const loc = loadSaved();
      const best = pub && loc ? (pub.d.ts >= loc.d.ts ? pub : loc) : (pub || loc);
      if (dead) return;
      if (best) {
        saved.current = best;
        setData(best.d, best.s);
        setDataTs(best.d.ts);
        lastRun.current = best.d.ts;
        verR.current = best.d.ts;
        setVer(best.d.ts);
      }
      setReady(true);
    })();
    return () => { dead = true; };
  }, []);
  useEffect(() => {
    if (!ready) return;
    if (Date.now() - lastRun.current > REFRESH_MIN * 60000) run("auto");
    const id = setInterval(() => { if (!document.hidden && Date.now() - lastRun.current > REFRESH_MIN * 60000) run("auto"); }, 30000);
    const vis = () => { if (!document.hidden && Date.now() - lastRun.current > REFRESH_MIN * 60000) run("auto"); };
    document.addEventListener("visibilitychange", vis);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", vis); };
  }, [ready]);
  useEffect(() => {
    try { localStorage.setItem("live", live ? "1" : "0"); } catch (_) { /* */ }
    if (!live) { setLv(null); return; }
    let w: WebSocket | null = null;
    let poll: any = null;
    let dead = false;
    let lastMsg = 0;
    let lastPush = 0;
    const push = (p: number, via: string) => {
      if (!(p > 0)) return;
      lastMsg = Date.now();
      if (lastMsg - lastPush < 1000) return;
      lastPush = lastMsg;
      setLivePx(p);
      setLv({ px: p, ts: lastMsg, via });
    };
    const startPoll = () => {
      if (poll || dead) return;
      const f = async () => {
        try {
          const t = (await http(`https://futures.kraken.com/derivatives/api/v3/tickers/${SYM.kf}`)).ticker;
          push(+t.last, "REST");
        } catch (e: any) {
          setLv((cur) => cur || { px: 0, ts: Date.now(), via: `REST no disponible (${String(e && e.message || e).slice(0, 48)})` });
        }
      };
      f();
      poll = setInterval(f, POLL_MS);
    };
    const open = () => {
      if (dead) return;
      try { w = new WebSocket("wss://futures.kraken.com/ws/v1"); }
      catch (_) { startPoll(); return; }
      w.onopen = () => { try { w!.send(JSON.stringify({ event: "subscribe", feed: "ticker", product_ids: [SYM.kf] })); } catch (_) { /* */ } };
      w.onmessage = (m) => {
        try {
          const d = JSON.parse(m.data as string);
          if (d.feed === "ticker" && d.product_id === SYM.kf) {
            push(+(d.last || d.markPrice), "websocket");
            if (poll) { clearInterval(poll); poll = null; }
          }
        } catch (_) { /* */ }
      };
      w.onerror = () => { try { w && w.close(); } catch (_) { /* */ } };
      w.onclose = () => { if (!dead) { startPoll(); setTimeout(open, 15000); } };
    };
    open();
    const watchdog = setInterval(() => { if (Date.now() - lastMsg > 10000) startPoll(); }, 5000);
    const recalc = setInterval(() => { if (!document.hidden) run("live"); }, LIVE_RECALC_MS);
    return () => {
      dead = true;
      clearInterval(watchdog);
      clearInterval(recalc);
      if (poll) clearInterval(poll);
      if (w) { w.onclose = null; try { w.close(); } catch (_) { /* */ } }
    };
  }, [live]);

  const pill = (on: boolean, col: string) => ({
    font: "inherit", fontWeight: 700, fontSize: 14, minHeight: 36, padding: "0 14px", borderRadius: 18,
    whiteSpace: "nowrap" as const, flex: "0 0 auto", border: `1.5px solid ${on ? col : "#3d444d"}`,
    background: on ? col + "33" : "transparent", color: on ? "#fff" : "#9ca3af",
    display: "inline-flex", alignItems: "center", gap: 6,
  });
  const bar = (
    <div style={{ position: "sticky", top: 0, zIndex: 10, display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", background: "#0d1117", borderBottom: "1px solid #21262d", fontSize: 12, overflowX: "auto" }}>
      <button onClick={() => run("manual")} disabled={!!busy} aria-label="Actualizar ahora" style={{ ...pill(true, "#2962ff"), background: busy ? "#2962ff22" : "#2962ff", fontSize: 15 }}>
        {busy ? <span style={{ width: 14, height: 14, border: "2px solid #fff", borderTopColor: "transparent", borderRadius: 7, display: "inline-block", animation: "spin .8s linear infinite" }} /> : <span style={{ fontSize: 17 }}>⟳</span>}{busy ? (busy === "live" ? "Recalculando…" : "Actualizando…") : "Actualizar"}
      </button>
      <button onClick={() => setLive(!live)} aria-pressed={live} aria-label="En vivo" style={pill(live, "#3fb950")}>
        <span style={{ width: 9, height: 9, borderRadius: 5, background: live ? "#3fb950" : "transparent", border: `1.5px solid ${live ? "#3fb950" : "#6e7681"}`, boxShadow: live ? "0 0 6px #3fb950" : "none" }} />En vivo
      </button>
      <span style={{ color: "#9ca3af", lineHeight: 1.25, whiteSpace: "nowrap" }}>
        {busy ? <span>Descargando datos públicos {prog}</span> : dataTs ? <span>Datos de las <b style={{ color: "#e6edf3" }}>{hms(dataTs)}</b> (Canarias)</span> : null}
        {live && lv && lv.px > 0 ? <><br /><span style={{ color: "#3fb950" }}>● {lv.px.toLocaleString("es-ES", { maximumFractionDigits: 1 })} $ · {hms(lv.ts)} ({lv.via}) · mapa cada 1 min</span></> : live && lv ? <><br /><span>Kraken Futures: {lv.via}</span></> : live ? <><br /><span>conectando…</span></> : !busy ? <><br /><span>auto cada {REFRESH_MIN} min</span></> : null}
      </span>
      {err ? <span style={{ color: "#f85149", whiteSpace: "nowrap" }}>⚠ {err.slice(0, 120)}{ver ? " · últimos datos guardados" : ""}</span> : null}
    </div>
  );
  if (!ver) return (
    <div>{bar}<div style={{ padding: 24, lineHeight: 1.6 }}>
      <h2 style={{ marginTop: 0 }}>Mapa Liquidaciones</h2>
      <p>{ready ? "Calculando el mapa con las APIs públicas que respondan desde este navegador. Si alguna falla por CORS o por bloqueo geográfico, se indica en la página y el mapa sigue con el resto." : "Cargando el último mapa publicado…"}</p>
      <p style={{ color: "#9ca3af" }}>{prog ? `Peticiones: ${prog}` : ""}</p>
    </div></div>
  );
  return <div>{bar}<MapView key={ver} /></div>;
}

document.body.style.margin = "0";
document.body.style.background = BG;
document.body.style.color = "#e6edf3";
document.body.style.fontFamily = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
createRoot(document.getElementById("root")!).render(<App />);
