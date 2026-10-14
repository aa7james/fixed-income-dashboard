import React, { useMemo, useState, useCallback } from 'react';
import { ComposedChart, Bar, Line, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, Cell, LineChart, LabelList } from 'recharts';
import ResizableChart from './ResizableChart';
import { niceTicks } from './useYAxisBounds';
import { fmtTenor, tenorTicks, makeDateFmt, dateSpanDays } from './axisFormat';

const ALBI_DUR = 6.33; // benchmark reference (ALBI modified duration)
// In-memory only: survives tab switches within the app, but is wiped on a page
// refresh / new session — so a refresh always re-prompts for the password.
let SESSION = null;
const TYPE_COLOR = { Bond: '#38bdf8', 'RSA T-Bill': '#4ade80', NCD: '#fbbf24', 'Money Market': '#a78bfa' };

// Vertical bond-code label drawn up from the bar's base (skips the curve rows).
const BarLabel = ({ x, y, width, height, value }) => {
  if (x == null || width == null || height == null || !value) return null;
  const cx = x + width / 2, cy = y + height - 4;
  return <text x={cx} y={cy} transform={`rotate(-90, ${cx}, ${cy})`} textAnchor="start" fill="#bae6fd" fontSize={9} fontWeight={600}>{value}</text>;
};
// Bond-code label above each holding dot.
const DotLabel = ({ x, y, value }) => {
  if (x == null || y == null || !value) return null;
  return <text x={x} y={y - 9} textAnchor="middle" fill="#7dd3fc" fontSize={9} fontWeight={600}>{value}</text>;
};

function bondPV(y, n, c) {
  if (n <= 0) return 100;
  const i = y / 200, tp = n * 2, cnt = Math.ceil(tp - 1e-9);
  let pv = 0;
  for (let k = 1; k <= cnt; k++) { const t = tp - (cnt - k); pv += (c / 2) / Math.pow(1 + i, t); }
  return pv + 100 / Math.pow(1 + i, tp);
}
function modDur(y, n, c) { const h = 0.01; return (-((bondPV(y + h, n, c) - bondPV(y - h, n, c)) / (2 * h)) / bondPV(y, n, c)) * 100; }
const isoOf = (d) => { const z = d instanceof Date ? d : new Date(d); return `${z.getFullYear()}-${String(z.getMonth() + 1).padStart(2, '0')}-${String(z.getDate()).padStart(2, '0')}`; };
// Parse a T-Bill / NCD description e.g. "RSA TB 7.45% 21102026" -> {rate, mat}
function parseDated(name) {
  const rm = String(name).match(/(\d+(?:\.\d+)?)\s*%/);
  const dm = String(name).match(/(\d{2})(\d{2})(\d{4})\s*$/) || String(name).match(/(\d{2})(\d{2})(\d{2})\s*$/);
  let mat = null;
  if (dm) { let yy = dm[3]; if (yy.length === 2) yy = '20' + yy; mat = `${yy}-${dm[2]}-${dm[1]}`; }
  return { rate: rm ? parseFloat(rm[1]) : null, mat };
}

// A fund's fixed-income sleeve at one snapshot: per-instrument tenor/yield/duration + weighted metrics.
function computeFund(holdings, maturities, yieldRow, shortRate, asOf, instruments) {
  const now = new Date(asOf);
  const yrs = (d) => (new Date(d) - now) / (1000 * 3600 * 24 * 365);
  const matByCode = Object.fromEntries((maturities || []).map(m => [m.bond, m]));
  const ybCode = {};
  (instruments || []).forEach(i => { if (yieldRow && i.display_label) { const v = Number(yieldRow[i.name]); if (v > 0.2 && v < 40) ybCode[i.display_label] = v; } });

  const items = (holdings || []).map(h => {
    const mv = Number(h.mv) || 0; if (mv <= 0) return null;
    if (h.type === 'Bond') {
      const m = matByCode[h.share]; if (!m) return null;
      const N = yrs(m.maturity_date); if (N <= 0) return null;
      let y = ybCode[h.share];
      if (y == null && Number(h.book_price) > 0.2 && Number(h.book_price) < 40) y = Number(h.book_price);
      if (y == null) return null;
      return { label: h.share, kind: 'Bond', N, y, dur: modDur(y, N, Number(m.coupon)), mv };
    }
    if (h.type === 'RSA T-Bill' || h.type === 'NCD') {
      const p = parseDated(h.share); if (!p.mat) return null;
      const N = Math.max(yrs(p.mat), 0); const y = (p.rate != null && p.rate > 0.5) ? p.rate : shortRate;
      return { label: `${h.type === 'NCD' ? 'NCD' : 'TB'} ${p.mat.slice(0, 7)}`, kind: h.type, N, y, dur: N / (1 + (y || 0) / 100), mv };
    }
    if (h.type === 'Money Market') return { label: h.share, kind: 'Money Market', N: 0.03, y: shortRate, dur: 0.08, mv };
    return null;
  }).filter(Boolean).sort((a, b) => a.N - b.N);

  const tot = items.reduce((a, x) => a + x.mv, 0) || 1;
  items.forEach(x => { x.wt = (x.mv / tot) * 100; });
  const wsum = (f) => items.reduce((a, x) => a + (x.mv / tot) * f(x), 0);
  return {
    items,
    metrics: {
      mv: tot, modDur: wsum(x => x.dur || 0), ytm: wsum(x => x.y || 0), term: wsum(x => x.N),
      cashPct: items.filter(x => x.kind === 'Money Market').reduce((a, x) => a + x.wt, 0), n: items.length,
    },
  };
}

const card = (label, value, sub, color = '#f1f5f9') => (
  <div key={label} style={{ flex: '1 1 130px', minWidth: 120, background: '#0f172a', border: '1px solid #334155', borderRadius: 10, padding: '10px 12px' }}>
    <div style={{ fontSize: 11, color: '#94a3b8' }}>{label}</div>
    <div style={{ fontSize: 20, fontWeight: 700, color, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    {sub && <div style={{ fontSize: 10, color: '#64748b' }}>{sub}</div>}
  </div>
);

export default function Portfolios({ data, instruments }) {
  const dataRows = useMemo(() => data?.dataRows || [], [data]);
  const latest = dataRows.length ? dataRows[dataRows.length - 1] : null;
  const shortRate = latest ? (Number(latest['Zaronia']) || Number(latest['12m Fixed Rate NCD']) || 7.1) : 7.1;

  const [pw, setPw] = useState('');
  const [authed, setAuthed] = useState(() => !!SESSION);
  const [payload, setPayload] = useState(() => SESSION);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const [fund, setFund] = useState('');
  const [snapId, setSnapId] = useState('');

  const unlock = useCallback(async (p) => {
    if (!p) return;
    setLoading(true); setErr('');
    try {
      const r = await fetch('/api/portfolios', { headers: { 'x-dashboard-password': p } });
      if (r.status === 401) { setErr('Incorrect password.'); setLoading(false); return; }
      if (!r.ok) { setErr(`Server error (${r.status}). Is the portfolios function configured in Vercel?`); setLoading(false); return; }
      const j = await r.json();
      SESSION = j;              // in-memory only — cleared on refresh
      setPayload(j); setAuthed(true); setPw('');
    } catch { setErr('Could not reach the portfolios server.'); }
    setLoading(false);
  }, []);

  const lock = () => { SESSION = null; setAuthed(false); setPayload(null); setPw(''); };

  const rowByDate = useCallback((iso) => {
    if (!dataRows.length) return null;
    let best = dataRows[0];
    for (const r of dataRows) { if (isoOf(r.date) <= iso) best = r; else break; }
    return best;
  }, [dataRows]);

  const funds = useMemo(() => payload ? [...new Set(payload.holdings.map(h => h.fund))].sort() : [], [payload]);
  const snaps = useMemo(() => payload ? payload.snapshots : [], [payload]);
  const curFund = fund || funds[0];
  const curSnap = snaps.find(s => s.id === snapId) || snaps[snaps.length - 1];

  // Cash instruments (T-Bills, NCDs, money market) hidden for now — bonds only.
  const BONDS_ONLY = (h) => h.type === 'Bond';

  const active = useMemo(() => {
    if (!payload || !curFund || !curSnap) return null;
    const hs = payload.holdings.filter(h => h.fund === curFund && h.snapshot_id === curSnap.id && BONDS_ONLY(h));
    return computeFund(hs, payload.maturities, rowByDate(curSnap.date), shortRate, curSnap.date, instruments);
  }, [payload, curFund, curSnap, rowByDate, shortRate, instruments]);

  const fundSeries = useMemo(() => {
    if (!payload || !curFund) return [];
    return snaps.map(s => {
      const hs = payload.holdings.filter(h => h.fund === curFund && h.snapshot_id === s.id && BONDS_ONLY(h));
      const m = computeFund(hs, payload.maturities, rowByDate(s.date), shortRate, s.date, instruments).metrics;
      return { date: s.date, modDur: +m.modDur.toFixed(2), ytm: +m.ytm.toFixed(2), cashPct: +m.cashPct.toFixed(1) };
    });
  }, [payload, curFund, snaps, rowByDate, shortRate, instruments]);

  // ---- password gate ----
  if (!authed) {
    return (
      <div style={{ maxWidth: 420, margin: '40px auto', background: '#1e293b', border: '1px solid #334155', borderRadius: 12, padding: 24, textAlign: 'center' }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9', marginBottom: 4 }}>🔒 Portfolios</div>
        <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 16px' }}>Portfolio holdings are protected. Enter the shared password.</p>
        <form onSubmit={e => { e.preventDefault(); unlock(pw); }}>
          <input type="password" value={pw} onChange={e => setPw(e.target.value)} placeholder="Password" autoFocus
            style={{ width: '100%', fontSize: 14, padding: '9px 12px', borderRadius: 8, border: '1px solid #334155', background: '#0f172a', color: '#e2e8f0', boxSizing: 'border-box', marginBottom: 10 }} />
          <button type="submit" disabled={loading}
            style={{ width: '100%', fontSize: 14, fontWeight: 700, padding: '9px 12px', borderRadius: 8, border: 'none', background: '#0ea5e9', color: '#fff', cursor: 'pointer' }}>
            {loading ? 'Checking…' : 'Unlock'}
          </button>
        </form>
        {err && <div style={{ fontSize: 12, color: '#f87171', marginTop: 10 }}>{err}</div>}
      </div>
    );
  }

  if (!active) return <div style={{ color: '#64748b' }}>No holdings found.</div>;
  const m = active.metrics;
  const hasItems = active.items.length > 0;
  const wTicks = hasItems ? niceTicks(0, Math.max(...active.items.map(i => i.wt))) : null;
  // Full government yield curve at the snapshot date, drawn behind the fund's bonds.
  const prow = rowByDate(curSnap.date);
  const cNow = new Date(curSnap.date);
  const cYrs = (d) => (new Date(d) - cNow) / (1000 * 3600 * 24 * 365);
  const govCurve = (instruments || [])
    .filter(i => i.category === 'Government Bonds' && i.maturity_date && prow && Number(prow[i.name]) > 0.2 && Number(prow[i.name]) < 40)
    .map(i => ({ N: cYrs(i.maturity_date), curveY: Number(prow[i.name]) })).filter(p => p.N > 0).sort((a, b) => a.N - b.N);
  const chartData = [...govCurve, ...active.items].sort((a, b) => a.N - b.N);
  const maxN = Math.max(1, ...chartData.map(d => d.N));
  const allY = [...active.items.map(i => i.y), ...govCurve.map(p => p.curveY)];
  const yld = allY.length ? niceTicks(Math.min(...allY) - 0.3, Math.max(...allY) + 0.3) : null;
  const durTicks = niceTicks(Math.min(0, ...fundSeries.map(s => s.modDur)) , Math.max(...fundSeries.map(s => s.modDur)) + 0.3);
  const histFmt = makeDateFmt(dateSpanDays(fundSeries, 'date'));
  const durColor = m.modDur < ALBI_DUR ? '#fbbf24' : '#4ade80';

  const Tip = ({ active: a, payload: p }) => {
    if (!a || !p?.length) return null;
    const d = (p.find(x => x.payload?.kind) || p[0]).payload;
    const box = { background: '#0f172a', border: '1px solid #334155', borderRadius: 8, padding: '8px 10px', fontSize: 12, color: '#e2e8f0' };
    if (!d.kind) return <div style={box}>Govt curve<br />{d.N?.toFixed(1)}y · <strong style={{ color: '#38bdf8' }}>{d.curveY?.toFixed(2)}%</strong></div>;
    return (
      <div style={box}>
        <strong>{d.label}</strong> <span style={{ color: TYPE_COLOR[d.kind] }}>{d.kind}</span><br />
        {d.N.toFixed(2)}y · yield <strong>{d.y?.toFixed(2)}%</strong> · dur {d.dur?.toFixed(2)}<br />
        weight <strong>{d.wt.toFixed(1)}%</strong> · MV R{(d.mv / 1e6).toFixed(1)}m
      </div>
    );
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: '#f1f5f9', margin: 0 }}>Portfolios — fixed income on the curve</h2>
          <p style={{ fontSize: 13, color: '#64748b', margin: '2px 0 0' }}>
            Each fund's government bonds by tenor, priced at {rowByDate(curSnap.date)?.dateStr}. Cash instruments (T‑Bills, NCDs, MM) hidden. Benchmark: ALBI modified duration ≈ {ALBI_DUR}.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={curFund} onChange={e => setFund(e.target.value)} style={{ fontSize: 13, padding: '6px 10px', borderRadius: 8, border: '1px solid #334155', background: '#1e293b', color: '#e2e8f0', fontWeight: 700 }}>
            {funds.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
          <select value={curSnap.id} onChange={e => setSnapId(e.target.value)} style={{ fontSize: 12, padding: '6px 10px', borderRadius: 8, border: '1px solid #334155', background: '#1e293b', color: '#e2e8f0' }}>
            {[...snaps].reverse().map(s => <option key={s.id} value={s.id}>{s.date}</option>)}
          </select>
          <button onClick={lock} title="Lock the portfolios (re-asks for the password)"
            style={{ fontSize: 12, padding: '6px 10px', borderRadius: 8, border: '1px solid #334155', background: '#1e293b', color: '#94a3b8', cursor: 'pointer' }}>🔒 Lock</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        {card('Bond MV', `R${(m.mv / 1e6).toFixed(0)}m`)}
        {card('Modified duration', m.modDur.toFixed(2), `vs ALBI ${ALBI_DUR}`, durColor)}
        {card('vs ALBI', `${(m.modDur - ALBI_DUR >= 0 ? '+' : '')}${(m.modDur - ALBI_DUR).toFixed(2)}`, 'years of duration', durColor)}
        {card('Weighted yield', `${m.ytm.toFixed(2)}%`)}
        {card('Avg term', `${m.term.toFixed(2)}y`)}
        {card('Bonds held', m.n, 'government bonds')}
      </div>

      <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 12, padding: 16 }}>
        {!hasItems && <div style={{ color: '#64748b', fontSize: 13, padding: '12px 2px' }}>{curFund} held no government bonds on {rowByDate(curSnap.date)?.dateStr} (cash instruments hidden).</div>}
        <ResizableChart height={340}>
          <ComposedChart data={chartData} margin={{ top: 10, right: 16, bottom: 24, left: 8 }}>
            <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
            <XAxis type="number" dataKey="N" domain={[0, Math.ceil(maxN)]} ticks={tenorTicks(maxN)} tickFormatter={fmtTenor}
              tick={{ fill: '#94a3b8', fontSize: 11 }} stroke="#475569" allowDuplicatedCategory={false}
              label={{ value: 'Years to maturity', position: 'insideBottom', offset: -12, fill: '#64748b', fontSize: 12 }} />
            <YAxis yAxisId="yield" domain={yld?.domain} ticks={yld?.ticks} interval={0} tick={{ fill: '#38bdf8', fontSize: 11 }}
              tickFormatter={v => `${v.toFixed(1)}%`} stroke="#475569" width={50} label={{ value: 'Yield', angle: -90, position: 'insideLeft', fill: '#38bdf8', fontSize: 11 }} />
            <YAxis yAxisId="wt" orientation="right" domain={wTicks?.domain} ticks={wTicks?.ticks} interval={0} tick={{ fill: '#a78bfa', fontSize: 11 }}
              tickFormatter={v => `${v}%`} stroke="#475569" width={46} label={{ value: 'Weight', angle: 90, position: 'insideRight', fill: '#a78bfa', fontSize: 11 }} />
            <Tooltip content={<Tip />} />
            <Line yAxisId="yield" type="monotone" dataKey="curveY" name="Govt curve" stroke="#64748b" strokeWidth={1.5} dot={false} connectNulls isAnimationActive={false} />
            <Bar yAxisId="wt" dataKey="wt" name="Weight" barSize={14} isAnimationActive={false}>
              {chartData.map((d, i) => <Cell key={i} fill={d.kind ? (TYPE_COLOR[d.kind] || '#64748b') : 'transparent'} fillOpacity={0.5} />)}
              <LabelList dataKey="label" content={BarLabel} />
            </Bar>
            <Scatter yAxisId="yield" dataKey="y" name="Holding" isAnimationActive={false}>
              {chartData.map((d, i) => <Cell key={i} fill={d.kind ? (TYPE_COLOR[d.kind] || '#e2e8f0') : 'transparent'} />)}
              <LabelList dataKey="label" content={DotLabel} />
            </Scatter>
          </ComposedChart>
        </ResizableChart>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 11, marginTop: 6 }}>
          <span style={{ color: '#64748b' }}>— Govt curve</span>
          {[...new Set(active.items.map(i => i.kind))].map(k => <span key={k} style={{ color: TYPE_COLOR[k] || '#94a3b8' }}>● {k}</span>)}
        </div>

        {fundSeries.length > 1 && (
          <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid #334155' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#cbd5e1', marginBottom: 6 }}>{curFund} — duration & yield over time</div>
            <ResizableChart height={240}>
              <LineChart data={fundSeries} margin={{ top: 8, right: 16, bottom: 4, left: 8 }}>
                <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 10 }} tickFormatter={histFmt} minTickGap={24} stroke="#475569" />
                <YAxis yAxisId="d" domain={durTicks?.domain} ticks={durTicks?.ticks} interval={0} tick={{ fill: '#fbbf24', fontSize: 10 }} tickFormatter={v => `${v}y`} stroke="#475569" width={40} />
                <YAxis yAxisId="y" orientation="right" tick={{ fill: '#38bdf8', fontSize: 10 }} tickFormatter={v => `${v}%`} stroke="#475569" width={44} />
                <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }} labelFormatter={histFmt} />
                <Line yAxisId="d" type="monotone" dataKey="modDur" name="Mod duration" stroke="#fbbf24" strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line yAxisId="y" type="monotone" dataKey="ytm" name="Yield" stroke="#38bdf8" strokeWidth={1.5} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResizableChart>
          </div>
        )}
        <p style={{ fontSize: 11, color: '#475569', margin: '8px 2px 0', lineHeight: 1.4 }}>
          Weights by market value within the FI sleeve. Govies priced off our live curve at the snapshot date; T‑Bills/NCDs use their quoted rate (zero‑coupon duration ≈ term); money‑market funds treated as ~0 duration. Monthly snapshots. Read‑only — nothing is written to the portfolio database.
        </p>
      </div>
    </div>
  );
}
