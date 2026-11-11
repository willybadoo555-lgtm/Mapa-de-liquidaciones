// Cliente HTTP de solo lectura. En el navegador un fallo de CORS llega como TypeError.
const isNode = typeof process !== 'undefined' && process.versions && process.versions.node;

export function errText(e) {
  return String((e && (e.message || e)) || 'error').replace(/\s+/g, ' ').slice(0, 180);
}

export async function http(url, body) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 45000);
  try {
    const headers = { Accept: 'application/json' };
    if (body) headers['Content-Type'] = 'application/json';
    if (isNode) headers['User-Agent'] = 'Mozilla/5.0 (MapaLiquidaciones read-only)';
    const r = await fetch(url, {
      method: body ? 'POST' : 'GET',
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    if (r.status === 451) throw new Error('HTTP 451 (bloqueo geográfico)');
    if (r.status === 403) throw new Error('HTTP 403 (bloqueo geográfico o prohibido)');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const text = await r.text();
    try { return JSON.parse(text); }
    catch (_) { throw new Error('JSON inválido'); }
  } catch (e) {
    if (e && e.name === 'AbortError') throw new Error('timeout');
    if (e instanceof TypeError) throw new Error('CORS o red');
    throw e;
  } finally { clearTimeout(t); }
}
