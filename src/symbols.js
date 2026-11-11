// Símbolo activo del mapa. BTC ahora; ETH ya está definido.
// Para añadir ETH: cambia ACTIVE a 'ETH', sustituye data/coinglass_latest.json
// por una lectura de ETH (mismo esquema) y vuelve a publicar.
export const SYMBOLS = {
  BTC: {
    binance: 'BTCUSDT',
    bybit: 'BTCUSDT',
    okx_inst: 'BTC-USDT-SWAP',
    okx_uly: 'BTC-USDT',
    okx_ccy: 'BTC',
    bitget: 'BTCUSDT',
    gate: 'BTC_USDT',
    hl: 'BTC',
    kf: 'PF_XBTUSD',
    deribit: 'BTC-PERPETUAL',
  },
  ETH: {
    binance: 'ETHUSDT',
    bybit: 'ETHUSDT',
    okx_inst: 'ETH-USDT-SWAP',
    okx_uly: 'ETH-USDT',
    okx_ccy: 'ETH',
    bitget: 'ETHUSDT',
    gate: 'ETH_USDT',
    hl: 'ETH',
    kf: 'PF_ETHUSD',
    deribit: 'ETH-PERPETUAL',
  },
};

export const ACTIVE = 'BTC';
export const SYM = SYMBOLS[ACTIVE];
