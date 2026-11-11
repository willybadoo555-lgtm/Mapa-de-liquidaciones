# Mapa de liquidaciones · BTC

Mapa estimado de liquidaciones de BTC en futuros, en hora de Canarias (`Atlantic/Canary`). Una sola página estática: el precio va en vertical, el tiempo en horizontal, las liquidaciones de longs debajo del precio (azul → cian) y las de shorts encima (violeta → magenta). Las velas son las de Kraken Futures `PF_XBTUSD`.

Solo datos públicos de mercado. No usa APIs de trading, ni claves, ni la cuenta de nadie.

La página carga al instante el JSON que calcula GitHub Actions (`data/latest.json` dentro del sitio publicado). Con la página abierta se vuelve a calcular cada 15 minutos, el botón **Actualizar** lo hace en ese momento, y **En vivo** sigue el ticker de Kraken Futures (`wss://futures.kraken.com/ws/v1`; si el navegador no puede, sondea el REST). El filtro de intensidad (− / +) y el interruptor **Zonas** se guardan en `localStorage` (`liqmap.thr`, `liqmap.zonas`).

## Publicar

El flujo está en `.github/workflows/pages.yml`.

1. Fusionar este cambio en `main`. El cron (`*/15 * * * *`) y el despliegue a Pages solo corren desde la rama por defecto.
2. En el repositorio: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. La dirección prevista es <https://willybadoo555-lgtm.github.io/Mapa-de-liquidaciones/>.

Los runners están en Estados Unidos. Binance (`fapi.binance.com`, HTTP 451) y Bybit (HTTP 403) suelen estar bloqueados allí. El motor prueba después `data-api.binance.vision` (no publica los futuros; si responde 404 se anota) y, para las velas del modelo, Bybit, OKX y Bitget. El histórico de open interest de OKX (`rubik`) no envía CORS, así que en el navegador, si Binance, Bybit y OKX no dan ese histórico, se usa el de Gate.io (`contract_stats`, sí permite CORS) con el mismo modelo. Lo que no responda sale en «Fallan» y se marca **ESTIMADO**. El mapa se dibuja con las fuentes que sí respondieron.

Kraken Futures REST no envía CORS a `github.io`. Actions (Node) sí lee velas y precio. En el navegador, **En vivo** usa el websocket `wss://futures.kraken.com/ws/v1` y, si no llega, el REST; si el REST también falla, el precio de referencia pasa a otro exchange y se marca **ESTIMADO**.

CoinGlass no se puede descargar desde la web ni desde Actions. Se lee del fichero de abajo.

## `data/coinglass_latest.json`

Ruta en el repo: **`data/coinglass_latest.json`**. Sustitúyelo (mismo nombre) cuando haya una lectura nueva desde el navegador con sesión; el siguiente cálculo de Actions lo copia al sitio y lo pasa a precio `PF_XBTUSD`. La web no lo pide a CoinGlass.

Peso en el mapa unificado, igual que el motor de la app: peso 1 hasta **3 h 45 min**, luego baja en línea recta hasta **0 a las 10 h**. A partir de 3 h 45 min se marca **desactualizado** (sigue dentro del mapa con menos peso). A las 10 h sale del mapa hasta la próxima lectura. Dentro del mapa, CoinGlass entra con peso ×0,5 por ese factor de antigüedad.

### Esquema v2 (`"schema": "liqmap.coinglass.v2"`)

Es el que debe escribir la lectura.

| Campo | Obligatorio | Significado |
| --- | --- | --- |
| `read_at` | sí | ISO 8601 **con zona** (inicio de la lectura) |
| `symbol` | sí | `BTC` (con el mapa en BTC). Si no coincide con el símbolo activo, no se usa |
| `exchanges` | recomendado | Una entrada por exchange del selector, también si falla |
| `levels` | sí | Los 3 clusters mayores arriba y los 3 mayores abajo, por exchange y panel |
| `screenshot`, `notes` | no | Texto libre |

Cada exchange:

```json
{"exchange": "Binance", "pair": "BTCUSDT", "ref_price": 74356.0, "at": "2026-11-11T20:26:10+00:00", "ok": true}
```

`ref_price` es el precio que CoinGlass muestra **para ese exchange** (Current Price o cierre de la última vela), en la misma cotización que `price`. `at` es la hora real de esa fila; si falta, se usa `read_at`.

Cada nivel (`panel`, `exchange`, `side`, `price`, `usd_m` obligatorios):

| Campo | Valores |
| --- | --- |
| `panel` | `heatmap_24h`, `heatmap_1w` o `liqmap_1d` |
| `exchange` | Nombre del selector: Binance, Bybit, OKX, Bitget, Hyperliquid, Gate, Deribit, BingX, Coinbase, HTX… `Agregado` para el mapa agregado, con `members` |
| `pair` | Par del selector (`BTCUSDT`, `BTC_USDT`, `BTC-USD`…) |
| `side` | `above` (shorts, por encima) o `below` (longs, por debajo) |
| `price` | Precio del cluster en la cotización de ese exchange |
| `usd_m` | Millones de USD del tooltip |
| `price_lo`, `price_hi`, `approx`, `at` | Opcionales |

Ajuste a `PF_XBTUSD`: `precio_kraken = precio_exchange / (1 + basis)`.

1. Binance (y el agregado, que usa el mismo basis): vela 1m pública de Binance contra la vela 1m de `PF_XBTUSD` del minuto de `read_at`.
2. Si eso no está y hay `ref_price`: `ref_price / cierre PF_XBTUSD de ese minuto − 1`.
3. Si no hay nada: basis 0 y se marca **ESTIMADO**. Un basis de más de ±3 % no se aplica.

Los niveles del mismo lado a menos de **0,15 %** se funden. Por exchange se toma el mayor de sus paneles (sin doble conteo). Si hay un nivel `Agregado`, se toma el mayor entre él y la suma por exchange. La etiqueta «confirmado por N fuentes» es el número de exchanges (los `members` del agregado cuentan).

### Esquema v1 (`liqmap.coinglass.v1`)

El fichero que hay ahora. Se convierte solo a v2:

- `pair` tipo `"Binance BTCUSDT"` y `price` → exchange Binance, `ref_price = price`.
- `heatmap_24h` y `heatmap_1w` con `above` / `below` de `{price, usd_m}`.
- `liqmap_agg_1d` con `exchanges` y `above` / `below` → panel `liqmap_1d`, exchange `Agregado`.

## Añadir ETH

En `src/symbols.js` los símbolos de ETH ya están (`PF_ETHUSD`, `ETHUSDT`, `ETH-USDT-SWAP`, `ETH-PERPETUAL`). Cambia `ACTIVE` a `'ETH'`, sustituye `data/coinglass_latest.json` por una lectura con `"symbol": "ETH"` y vuelve a publicar. El sitio muestra un solo activo.

## En local

```bash
npm ci
npm run build          # dist/ con app.js, data/latest.json y el CoinGlass
npm run test:browser   # Chrome sin cabeza contra ese dist
```

`data/engine-store.json` es la caché incremental del motor (no se versiona). `data/hl_seed.json` es la lista de respaldo del leaderboard de Hyperliquid si esa API no responde; las posiciones se leen en vivo.

## Qué suma el mapa

Modelo de open interest y apalancamiento (×1) + CoinGlass combinado (×0,5, y el peso por antigüedad) + posiciones reales de Hyperliquid (×1) + liquidaciones reales de OKX y, si el websocket responde, Binance/Bybit (×1). Todo en millones de USD y en precio `PF_XBTUSD`. Donde coinciden, se suman.
