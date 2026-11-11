// Direcciones del leaderboard público de Hyperliquid (solo lectura).
export async function fetchHlTop(http, n = 200) {
  const j = await http('https://stats-data.hyperliquid.xyz/Mainnet/leaderboard');
  const rows = (j.leaderboardRows || []).slice().sort((a, b) => (+b.accountValue) - (+a.accountValue));
  const addrs = [];
  for (const r of rows) {
    if (r && r.ethAddress) addrs.push(r.ethAddress);
    if (addrs.length >= n) break;
  }
  if (addrs.length < 10) throw new Error('leaderboard vacío');
  return addrs;
}
