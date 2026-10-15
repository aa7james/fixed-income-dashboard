import React, { useMemo, useState, useCallback } from 'react';
import { ComposedChart, Bar, Line, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, LineChart, LabelList } from 'recharts';
import ResizableChart from './ResizableChart';
import { niceTicks } from './useYAxisBounds';
import { fmtTenor, tenorTicks, makeDateFmt, dateSpanDays } from './axisFormat';
import { computeIndex } from './AlbiIndex';
import ALBI_HISTORY from '../data/albiHistory.json';

const ALBI_DUR = 6.33; // benchmark reference (ALBI modified duration)
// In-memory only: survives tab switches within the app, but is wiped on a page
// refresh / new session — so a refresh always re-prompts for the password.
let SESSION = null;

// Vertical bond-code label up from the bar's base — only where there's an actual bar (held bonds).
const BarLabel = ({ x, y, width, height, value }) => {
  if (x == null || width == null || !(height > 2) || !value) return null;
  const cx = x + width / 2, cy = y + height - 4;
  return <text x={cx} y={cy} transform={`rotate(-90, ${cx}, ${cy})`} textAnchor="start" fill="#e0f2fe" fontSize={9} fontWeight={700}>{value}</text>;
};

function bondPV(y, n, c) {
  if (n <= 0) return 100;
  const i = y / 200, tp = n * 2, cnt = Math.ceil(tp - 1e-9);
  let pv = 0;
  for (let k = 1; k <= cnt; k++) { const t = tp - (cnt - k); pv += (c / 2) / Math.pow(1 + i, t); }
  return pv + 100 / Math.pow(1 + i, tp);
}
function modDur(y, n, c) { const h = 0.01; return (-((bondPV(y + h, n, c) - bondPV(y - h, n, c)) / (2 * h)) / bondPV(y, n, c)) * 100; }
function convexity(y, n, c) { const h = 0.01; const p = bondPV(y, n, c); return ((bondPV(y + h, n, c) + bondPV(y - h, n, c) - 2 * p) / (p * h * h)) * 10000; }
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
      return { label: h.share, kind: 'Bond', N, y, dur: modDur(y, N, Number(m.coupon)), cvx: convexity(y, N, Number(m.coupon)), mv };
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
      convexity: wsum(x => x.cvx || 0),
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

  // Only funds that actually hold bonds or NCDs (drop money-market-only funds).
  const funds = useMemo(() => payload ? [...new Set(payload.holdings.filter(h => h.type === 'Bond' || h.type === 'NCD').map(h => h.fund))].sort() : [], [payload]);
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

  // ALBI benchmark metrics at the same snapshot date (nearest monthly ALBI file).
  const albi = useMemo(() => {
    if (!curSnap || !payload) return null;
    const t = new Date(curSnap.date);
    const snap = ALBI_HISTORY.reduce((a, s) => Math.abs(new Date(s.date) - t) < Math.abs(new Date(a.date) - t) ? s : a);
    return computeIndex(snap.rows, rowByDate(curSnap.date), curSnap.date, instruments).metrics;
  }, [curSnap, payload, rowByDate, instruments]);

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
  // Full government curve at the snapshot date: every govie, flagged + weighted if the fund holds it.
  const prow = rowByDate(curSnap.date);
  const cNow = new Date(curSnap.date);
  const cYrs = (d) => (new Date(d) - cNow) / (1000 * 3600 * 24 * 365);
  const heldByCode = {};
  active.items.forEach(it => { heldByCode[it.label] = it; });
  const chartData = (instruments || [])
    .filter(i => i.category === 'Government Bonds' && i.maturity_date && prow && Number(prow[i.name]) > 0.2 && Number(prow[i.name]) < 40)
    .map(i => {
      const code = i.display_label || i.name;
      const h = heldByCode[code];
      return { N: cYrs(i.maturity_date), code, curveY: Number(prow[i.name]), held: !!h, wt: h ? h.wt : undefined, mv: h ? h.mv : undefined, dur: h ? h.dur : undefined };
    }).filter(p => p.N > 0).sort((a, b) => a.N - b.N);
  const maxN = Math.max(1, ...chartData.map(d => d.N));
  const allY = chartData.map(d => d.curveY);
  const yld = allY.length ? niceTicks(Math.min(...allY) - 0.3, Math.max(...allY) + 0.3) : null;
  const heldWts = chartData.filter(d => d.held && d.wt != null).map(d => d.wt);
  const wTicks = heldWts.length ? niceTicks(0, Math.max(...heldWts)) : null;
  const durTicks = niceTicks(Math.min(0, ...fundSeries.map(s => s.modDur)) , Math.max(...fundSeries.map(s => s.modDur)) + 0.3);
  const histFmt = makeDateFmt(dateSpanDays(fundSeries, 'date'));
  const durColor = albi && m.modDur < albi.modDur ? '#fbbf24' : '#f1f5f9';
  // "ALBI X (±diff)" sub-line for a metric card.
  const cmpSub = (f, a, unit = '') => {
    if (a == null) return null;
    const d = f - a;
    return <>ALBI {a.toFixed(2)}{unit} <span style={{ color: d >= 0 ? '#4ade80' : '#f87171' }}>({d >= 0 ? '+' : ''}{d.toFixed(2)})</span></>;
  };

  const Tip = ({ active: a, payload: p }) => {
    if (!a || !p?.length) return null;
    const d = (p.find(x => x.payload?.held) || p[0]).payload;
    const box = { background: '#0f172a', border: '1px solid #334155', borderRadius: 8, padding: '8px 10px', fontSize: 12, color: '#e2e8f0' };
    if (!d.held) return <div style={box}><strong>{d.code}</strong> <span style={{ color: '#64748b' }}>· not held</span><br />{d.N?.toFixed(1)}y · <strong style={{ color: '#94a3b8' }}>{d.curveY?.toFixed(2)}%</strong></div>;
    return (
      <div style={box}>
        <strong style={{ color: '#38bdf8' }}>{d.code}</strong> <span style={{ color: '#4ade80' }}>· held</span><br />
        {d.N.toFixed(2)}y · yield <strong>{d.curveY?.toFixed(2)}%</strong> · dur {d.dur?.toFixed(2)}<br />
        weight <strong>{d.wt?.toFixed(1)}%</strong> · MV R{(d.mv / 1e6).toFixed(1)}m
      </div>
    );
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: '#f1f5f9', margin: 0 }}>Portfolios — fixed income on the curve</h2>
          <p style={{ fontSize: 13, color: '#64748b', margin: '2px 0 0' }}>
            Each fund's government bonds by tenor, priced at {rowByDate(curSnap.date)?.dateStr}. Cash instruments (T‑Bills, NCDs, MM) hidden. Benchmark: ALBI at this date (mod dur {albi ? albi.modDur.toFixed(2) : ALBI_DUR}, YTM {albi ? albi.ytm.toFixed(2) + '%' : '—'}).
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
        {card('Bond MV', `R${(m.mv / 1e6).toFixed(0)}m`, `${m.n} government bonds`)}
        {card('Modified duration', m.modDur.toFixed(2), cmpSub(m.modDur, albi?.modDur), durColor)}
        {card('Weighted yield', `${m.ytm.toFixed(2)}%`, cmpSub(m.ytm, albi?.ytm, '%'))}
        {card('Convexity', m.convexity.toFixed(0), cmpSub(m.convexity, albi?.convexity))}
        {card('Avg term', `${m.term.toFixed(2)}y`, cmpSub(m.term, albi?.term, 'y'))}
        {card('Bonds held', m.n, albi ? `ALBI holds ${albi.n}` : 'government bonds')}
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
            <Line yAxisId="yield" type="monotone" dataKey="curveY" name="Govt curve" stroke="#475569" strokeWidth={1.5} dot={false} connectNulls isAnimationActive={false} />
            <Bar yAxisId="wt" dataKey="wt" name="Weight" barSize={14} fill="#38bdf8" fillOpacity={0.5} isAnimationActive={false}>
              <LabelList dataKey="code" content={BarLabel} />
            </Bar>
            <Scatter yAxisId="yield" dataKey="curveY" name="Govie" isAnimationActive={false}
              shape={(props) => {
                const { cx, cy, payload } = props;
                if (cx == null || cy == null) return null;
                return <circle cx={cx} cy={cy} r={payload.held ? 5 : 3} fill={payload.held ? '#38bdf8' : '#64748b'} stroke={payload.held ? '#0f172a' : 'none'} strokeWidth={payload.held ? 1.5 : 0} />;
              }}>
              <LabelList dataKey="code" content={(props) => {
                const d = chartData[props.index];
                if (props.x == null || props.y == null || !d) return null;
                return <text x={props.x} y={props.y - 9} textAnchor="middle" fill={d.held ? '#7dd3fc' : '#64748b'} fontSize={d.held ? 10 : 8.5} fontWeight={d.held ? 700 : 400}>{d.code}</text>;
              }} />
            </Scatter>
          </ComposedChart>
        </ResizableChart>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 11, marginTop: 6 }}>
          <span style={{ color: '#475569' }}>— Govt curve</span>
          <span style={{ color: '#38bdf8', fontWeight: 700 }}>● Held</span>
          <span style={{ color: '#64748b' }}>● Not held</span>
          <span style={{ color: '#38bdf8' }}>▮ Weight (held)</span>
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
