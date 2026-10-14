// Vercel serverless function — READ-ONLY portfolio data, gated by a shared password.
// The database key lives ONLY in Vercel env vars (never in the browser bundle).
// Set these in Vercel → Project → Settings → Environment Variables:
//   PORTFOLIO_SUPABASE_URL   e.g. https://xxxx.supabase.co
//   PORTFOLIO_SECRET_KEY     the portfolio project's secret key
//   DASHBOARD_PASSWORD       the shared password the team types in
// This function only ever READS (GET) — it never writes to the database.
export default async function handler(req, res) {
  const url = process.env.PORTFOLIO_SUPABASE_URL;
  const key = process.env.PORTFOLIO_SECRET_KEY;
  const pw = process.env.DASHBOARD_PASSWORD;
  if (!url || !key || !pw) return res.status(500).json({ error: 'Server not configured — missing env vars.' });

  const supplied = req.headers['x-dashboard-password'] || '';
  if (supplied !== pw) return res.status(401).json({ error: 'Incorrect password.' });

  const H = { apikey: key, Authorization: 'Bearer ' + key };
  const get = async (path) => {
    const r = await fetch(`${url}/rest/v1/${path}`.replace(/ /g, '%20'), { headers: H });
    if (!r.ok) throw new Error(`${path} -> ${r.status}`);
    return r.json();
  };

  try {
    const snaps = await get('snapshots?select=id,snapshot_date&order=snapshot_date.asc');
    // One snapshot per month (the last of each month, since sorted ascending) + the very latest.
    const byMonth = {};
    snaps.forEach(s => { byMonth[s.snapshot_date.slice(0, 7)] = s; });
    const chosen = Object.values(byMonth);
    const latest = snaps[snaps.length - 1];
    if (latest && !chosen.find(s => s.id === latest.id)) chosen.push(latest);

    const idList = chosen.map(s => `"${s.id}"`).join(',');
    const typeList = ['Bond', 'RSA T-Bill', 'NCD', 'Money Market'].map(t => `"${t}"`).join(',');
    const holdings = await get(`holdings?select=fund,share,type,units,mv,book_price,snapshot_id&snapshot_id=in.(${idList})&type=in.(${typeList})&limit=20000`);
    const maturities = await get('bond_maturities?select=bond,coupon,maturity_date');

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      snapshots: chosen.map(s => ({ id: s.id, date: s.snapshot_date })).sort((a, b) => (a.date < b.date ? -1 : 1)),
      holdings, maturities,
    });
  } catch (e) {
    return res.status(502).json({ error: 'Portfolio fetch failed', detail: String(e.message || e) });
  }
}
