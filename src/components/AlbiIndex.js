import React, { useMemo, useState } from 'react';
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, LabelList } from 'recharts';
import ResizableChart from './ResizableChart';
import { niceTicks } from './useYAxisBounds';
import { fmtTenor, tenorTicks, makeDateFmt, dateSpanDays } from './axisFormat';
import ALBI_HISTORY from '../data/albiHistory.json';

// ALBI constituents (FTSE/JSE All Bond Index), effective 2026-09-04.
// [code, issuer, coupon %, maturity, raw index weight]. Update monthly from the
// index constituent file. Weights are normalised to % in code.
const AS_AT = '2026-09-04';
const ALBI = [
  ['R188', 'RSA', 10.500, '2027-12-21', 95905],
  ['TN27', 'Transnet', 8.900, '2027-11-14', 8565],
  ['R2030', 'RSA', 8.000, '2030-01-31', 305818],
  ['R213', 'RSA', 7.000, '2031-02-28', 218177],
  ['R2032', 'RSA', 8.250, '2032-03-31', 349557],
  ['TNG32', 'Transnet', 10.110, '2032-08-15', 6200],
  ['R2033', 'RSA', 10.000, '2033-03-31', 67855],
  ['ES33', 'Eskom', 7.500, '2033-09-15', 34542],
  ['R2035', 'RSA', 8.875, '2035-02-28', 369468],
  ['R209', 'RSA', 6.250, '2036-03-31', 104263],
  ['R2037', 'RSA', 8.500, '2037-01-31', 370245],
  ['R2038', 'RSA', 10.875, '2038-03-31', 74632],
  ['R2039', 'RSA', 9.875, '2039-03-31', 34836],
  ['R2040', 'RSA', 9.000, '2040-01-31', 329977],
  ['R214', 'RSA', 6.500, '2041-02-28', 93382],
  ['R2042', 'RSA', 10.125, '2042-03-31', 33573],
  ['ES42', 'Eskom', 8.500, '2042-04-25', 21437],
  ['R2044', 'RSA', 8.750, '2044-01-31', 330630],
  ['R2048', 'RSA', 8.750, '2048-02-28', 465462],
  ['R2053', 'RSA', 11.625, '2053-03-31', 116019],
];

const LS_KEY = 'albiConstituents';
// Parse an FTSE/JSE ALBI constituent CSV into [code, issuer, coupon, maturity, weight] rows.
function parseAlbiCsv(text) {
  const lines = text.split(/\r?\n/);
  const hi = lines.findIndex(l => l.startsWith('EffectiveDate,'));
  if (hi < 0) throw new Error('Not an ALBI constituent file (missing header row).');
  const cols = lines[hi].split(',').map(s => s.trim());
  const col = (name) => cols.indexOf(name);
  const iCode = col('InstrumentCode'), iIssuer = col('Issuer'), iCoupon = col('Coupon'), iMat = col('MaturityDate'), iW = col('Weight'), iEff = col('EffectiveDate');
  if ([iCode, iIssuer, iCoupon, iMat, iW].some(x => x < 0)) throw new Error('Unexpected columns in the file.');
  const rows = []; let asAt = '';
  for (let r = hi + 1; r < lines.length; r++) {
    const line = lines[r].trim();
    if (!line || /^X+$/.test(line)) continue;
    const f = line.split(',');
    const code = (f[iCode] || '').trim();
    const coupon = parseFloat(f[iCoupon]);
    const mat = (f[iMat] || '').trim().replace(/\//g, '-');
    const weight = parseFloat((f[iW] || '').replace(/[^0-9.-]/g, ''));
    if (!code || !isFinite(coupon) || !/^\d{4}-\d{2}-\d{2}$/.test(mat) || !isFinite(weight) || weight <= 0) continue;
    const iss = (f[iIssuer] || '').toUpperCase();
    const issuer = iss.includes('REPUBLIC OF SOUTH AFRICA') ? 'RSA'
      : iss.includes('ESKOM') ? 'Eskom' : iss.includes('TRANSNET') ? 'Transnet' : (f[iIssuer] || 'Other').trim();
    rows.push([code, issuer, coupon, mat, weight]);
    if (!asAt && iEff >= 0 && f[iEff]) asAt = f[iEff].trim().replace(/\//g, '-');
  }
  if (!rows.length) throw new Error('No constituents found in the file.');
  return { rows, asAt: asAt || 'uploaded' };
}

function bondPV(y, n, c) {
  if (n <= 0) return 100;
  const i = y / 200, tp = n * 2, count = Math.ceil(tp - 1e-9);
  let pv = 0;
  for (let k = 1; k <= count; k++) { const t = tp - (count - k); pv += (c / 2) / Math.pow(1 + i, t); }
  return pv + 100 / Math.pow(1 + i, tp);
}
// Modified duration (years) and convexity (years^2) via finite difference.
function risk(y, n, c) {
  const h = 0.01; // 1bp in % units
  const p = bondPV(y, n, c), up = bondPV(y + h, n, c), dn = bondPV(y - h, n, c);
  const modDur = (-((up - dn) / (2 * h)) / p) * 100;          // per 1.00 decimal
  const convexity = ((up + dn - 2 * p) / (p * h * h)) * 10000; // per decimal^2
  return { modDur, convexity };
}
function interp(curve, x) {
  if (!curve.length) return null;
  if (x <= curve[0].N) return curve[0].y;
  if (x >= curve[curve.length - 1].N) return curve[curve.length - 1].y;
  for (let i = 1; i < curve.length; i++) {
    if (x <= curve[i].N) { const a = curve[i - 1], b = curve[i]; return a.y + (x - a.N) / (b.N - a.N) * (b.y - a.y); }
  }
  return curve[curve.length - 1].y;
}

const isoOf = (d) => { const z = d instanceof Date ? d : new Date(d); return `${z.getFullYear()}-${String(z.getMonth() + 1).padStart(2, '0')}-${String(z.getDate()).padStart(2, '0')}`; };
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (iso) => { const [y, m] = iso.split('-'); return `${MON[+m - 1]} ${y}`; };

// Per-bond figures + weighted metrics for a constituent set, priced off `yieldRow`,
// with tenors measured from `asOfISO`.
export function computeIndex(constituents, yieldRow, asOfISO, instruments) {
  const now = new Date(asOfISO);
  const yrs = (d) => (new Date(d) - now) / (1000 * 3600 * 24 * 365);
  const sane = (v) => v != null && Number(v) > 0.2 && Number(v) < 40;
  const curve = (instruments || [])
    .filter(i => i.category === 'Government Bonds' && i.maturity_date && yieldRow && sane(yieldRow[i.name]))
    .map(i => ({ N: yrs(i.maturity_date), y: Number(yieldRow[i.name]) })).filter(p => p.N > 0).sort((a, b) => a.N - b.N);
  const yieldByCode = {};
  (instruments || []).forEach(i => { if (yieldRow && i.display_label && sane(yieldRow[i.name])) yieldByCode[i.display_label] = Number(yieldRow[i.name]); });
  const total = constituents.reduce((a, r) => a + r[4], 0);
  let proxy = false;
  const rws = constituents.map(([code, issuer, c, mat, w]) => {
    const N = yrs(mat); const wt = (w / total) * 100;
    let y = yieldByCode[code]; const isProxy = y == null;
    if (isProxy) { y = interp(curve, N); if (y != null) proxy = true; }
    const { modDur, convexity } = y != null ? risk(y, N, c) : { modDur: null, convexity: null };
    return { code, issuer, c, mat, N, wt, y, isProxy, modDur, convexity };
  }).filter(r => r.N > 0 && r.y != null).sort((a, b) => a.N - b.N);
  const wsum = (f) => rws.reduce((a, r) => a + (r.wt / 100) * f(r), 0);
  const metrics = {
    n: rws.length, ytm: wsum(r => r.y), modDur: wsum(r => r.modDur), convexity: wsum(r => r.convexity),
    term: wsum(r => r.N), coupon: wsum(r => r.c), rsaWt: rws.filter(r => r.issuer === 'RSA').reduce((a, r) => a + r.wt, 0),
  };
  return { rows: rws, chartRows: rws.filter(r => r.issuer === 'RSA'), metrics, anyProxy: proxy };
}

// Vertical bond-code label drawn upward from the bar's base.
const BarLabel = ({ x, y, width, height, value }) => {
  if (x == null || width == null) return null;
  const cx = x + width / 2, cy = y + height - 4;
  return (
    <text x={cx} y={cy} transform={`rotate(-90, ${cx}, ${cy})`} textAnchor="start"
      fill="#e9d5ff" fontSize={9} fontWeight={600}>{value}</text>
  );
};

const metricCard = (label, value, sub) => (
  <div key={label} style={{ flex: '1 1 130px', minWidth: 120, background: '#0f172a', border: '1px solid #334155', borderRadius: 10, padding: '10px 12px' }}>
    <div style={{ fontSize: 11, color: '#94a3b8' }}>{label}</div>
    <div style={{ fontSize: 20, fontWeight: 700, color: '#f1f5f9', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    {sub && <div style={{ fontSize: 10, color: '#64748b' }}>{sub}</div>}
  </div>
);

export default function AlbiIndex({ data, instruments }) {
  const latest = data?.dataRows?.length ? data.dataRows[data.dataRows.length - 1] : null;

  const [store, setStore] = useState(() => {
    try { const s = JSON.parse(localStorage.getItem(LS_KEY)); if (s?.rows?.length) return s; } catch { /* ignore */ }
    return { rows: ALBI, asAt: AS_AT };
  });
  const [uploadMsg, setUploadMsg] = useState('');
  const onUpload = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = parseAlbiCsv(String(reader.result));
        setStore(parsed);
        try { localStorage.setItem(LS_KEY, JSON.stringify(parsed)); } catch { /* ignore */ }
        setUploadMsg(`Loaded ${parsed.rows.length} constituents (as at ${parsed.asAt}).`);
      } catch (err) { setUploadMsg(`Could not read file: ${err.message}`); }
    };
    reader.readAsText(file);
  };
  const resetBuiltIn = () => {
    setStore({ rows: ALBI, asAt: AS_AT });
    try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
    setUploadMsg('Reverted to the built-in constituents.');
  };
  const custom = store.asAt !== AS_AT || store.rows !== ALBI;

  const [auctionCodes, setAuctionCodes] = useState(() => { try { return localStorage.getItem('albiAuctionCodes') || ''; } catch { return ''; } });
  const setAuction = (v) => { setAuctionCodes(v); try { localStorage.setItem('albiAuctionCodes', v); } catch { /* ignore */ } };
  const auctionSet = useMemo(() => new Set(auctionCodes.split(/[,\s]+/).map(s => s.trim().toUpperCase()).filter(Boolean)), [auctionCodes]);

  const dataRows = useMemo(() => data?.dataRows || [], [data]);
  // All monthly snapshots: bundled history + the uploaded/built-in current one.
  const snapshots = useMemo(() => {
    const map = new Map();
    ALBI_HISTORY.forEach(s => map.set(s.date, s.rows));
    if (store.rows?.length && store.asAt) map.set(store.asAt, store.rows);
    return [...map.entries()].map(([date, rows]) => ({ date, rows })).sort((a, b) => (a.date < b.date ? -1 : 1));
  }, [store]);
  const [selDate, setSelDate] = useState('');
  const sel = snapshots.find(s => s.date === selDate) || snapshots[snapshots.length - 1];

  // Nearest data row on or before a given ISO date (for historical yields).
  const rowByDate = (iso) => {
    if (!dataRows.length) return null;
    let best = dataRows[0];
    for (const r of dataRows) { if (isoOf(r.date) <= iso) best = r; else break; }
    return best;
  };

  const { rows, chartRows, metrics, anyProxy } = useMemo(() => {
    if (!sel) return { rows: [], chartRows: [], metrics: null, anyProxy: false };
    return computeIndex(sel.rows, rowByDate(sel.date), sel.date, instruments);
  }, [sel, dataRows, instruments]); // eslint-disable-line react-hooks/exhaustive-deps

  // Metric time-series across every monthly snapshot (priced at each date).
  const series = useMemo(() => snapshots.map(s => {
    const m = computeIndex(s.rows, rowByDate(s.date), s.date, instruments).metrics;
    return { date: s.date, modDur: +m.modDur.toFixed(2), term: +m.term.toFixed(2), ytm: +m.ytm.toFixed(2), convexity: +m.convexity.toFixed(1) };
  }), [snapshots, dataRows, instruments]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!latest) return null;
  if (!rows.length || !metrics) return <div style={{ color: '#64748b', fontSize: 13 }}>ALBI: no yields available yet.</div>;

  const maxN = Math.max(...chartRows.map(r => r.N));
  const yld = niceTicks(Math.min(...chartRows.map(r => r.y)) - 0.3, Math.max(...chartRows.map(r => r.y)) + 0.3);
  const wMax = Math.max(...chartRows.map(r => r.wt));
  const wTicks = niceTicks(0, wMax);
  const pricedRow = rowByDate(sel.date);
  const pricedStr = pricedRow ? pricedRow.dateStr : latest.dateStr;
  // Historical metrics chart scales
  const durTicks = niceTicks(Math.min(...series.map(s => Math.min(s.modDur, s.term))) - 0.5, Math.max(...series.map(s => Math.max(s.modDur, s.term))) + 0.5);
  const ytmTicks = niceTicks(Math.min(...series.map(s => s.ytm)) - 0.3, Math.max(...series.map(s => s.ytm)) + 0.3);
  const histDateFmt = makeDateFmt(dateSpanDays(series, 'date'));

  const Tip = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    const p = payload[0].payload;
    return (
      <div style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, padding: '8px 10px', fontSize: 12, color: '#e2e8f0' }}>
        <strong>{p.code}</strong> <span style={{ color: '#64748b' }}>{p.issuer} · {p.c.toFixed(2)}%</span><br />
        {p.N.toFixed(1)}y · yield <strong style={{ color: '#38bdf8' }}>{p.y.toFixed(2)}%</strong>{p.isProxy && <span style={{ color: '#fbbf24' }}> (est.)</span>}<br />
        weight <strong style={{ color: '#a78bfa' }}>{p.wt.toFixed(2)}%</strong> · mod dur {p.modDur?.toFixed(1)}
      </div>
    );
  };

  return (
    <div style={{ marginTop: 20, background: '#1e293b', border: '1px solid #334155', borderRadius: 12, padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <div>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: '#f1f5f9', margin: 0 }}>ALBI index — weights on the yield curve</h3>
          <p style={{ fontSize: 12, color: '#64748b', margin: '2px 0 0' }}>
            FTSE/JSE All Bond Index government constituents: weight by tenor (bars) behind the yield curve (line). Priced at {pricedStr}. Metrics below cover the full index.
          </p>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 6 }}>
            <span style={{ fontSize: 12, color: '#94a3b8' }}>As at:</span>
            <select value={sel.date} onChange={e => setSelDate(e.target.value)}
              style={{ fontSize: 12, padding: '4px 8px', borderRadius: 8, border: '1px solid #334155', background: '#0f172a', color: '#e2e8f0' }}>
              {[...snapshots].reverse().map(s => <option key={s.date} value={s.date}>{monthLabel(s.date)}{custom && s.date === store.asAt ? ' (uploaded)' : ''}</option>)}
            </select>
            <span style={{ fontSize: 11, color: '#64748b' }}>{snapshots.length} months of history</span>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <label style={{ fontSize: 12, fontWeight: 700, padding: '6px 12px', borderRadius: 8, cursor: 'pointer', background: '#0ea5e9', color: '#fff' }}>
              ⬆ Update from CSV
              <input type="file" accept=".csv,text/csv" onChange={onUpload} style={{ display: 'none' }} />
            </label>
            {custom && <button onClick={resetBuiltIn} title="Revert to the built-in constituents"
              style={{ fontSize: 11, padding: '6px 10px', borderRadius: 8, border: '1px solid #334155', background: 'transparent', color: '#94a3b8', cursor: 'pointer' }}>↺ Built‑in</button>}
          </div>
          {uploadMsg && <span style={{ fontSize: 10, color: uploadMsg.startsWith('Could not') ? '#f87171' : '#4ade80' }}>{uploadMsg}</span>}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        {metricCard('Weighted YTM', `${metrics.ytm.toFixed(2)}%`)}
        {metricCard('Modified duration', metrics.modDur.toFixed(2), 'years')}
        {metricCard('Convexity', metrics.convexity.toFixed(1))}
        {metricCard('Avg term', `${metrics.term.toFixed(1)}y`)}
        {metricCard('Avg coupon', `${metrics.coupon.toFixed(2)}%`)}
        {metricCard('Constituents', metrics.n, `${metrics.rsaWt.toFixed(0)}% RSA`)}
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: '#94a3b8' }}>On auction this week (Fri):</span>
        <input value={auctionCodes} onChange={e => setAuction(e.target.value)}
          placeholder="e.g. R2035, R2040, R2048"
          style={{ flex: '1 1 260px', minWidth: 200, fontSize: 12, padding: '5px 8px', borderRadius: 8, border: '1px solid #334155', background: '#0f172a', color: '#e2e8f0' }} />
        <span style={{ fontSize: 11, color: '#f59e0b', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#f59e0b', display: 'inline-block' }} /> = on auction
        </span>
      </div>

      <ResizableChart height={360}>
        <ComposedChart data={chartRows} margin={{ top: 10, right: 16, bottom: 24, left: 8 }}>
          <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
          <XAxis type="number" dataKey="N" domain={[0, Math.ceil(maxN)]} ticks={tenorTicks(maxN)} tickFormatter={fmtTenor}
            tick={{ fill: '#94a3b8', fontSize: 11 }} stroke="#475569"
            label={{ value: 'Years to maturity', position: 'insideBottom', offset: -12, fill: '#64748b', fontSize: 12 }} />
          <YAxis yAxisId="yield" domain={yld?.domain} ticks={yld?.ticks} interval={0} tick={{ fill: '#38bdf8', fontSize: 11 }}
            tickFormatter={v => `${v.toFixed(2)}%`} stroke="#475569" width={54}
            label={{ value: 'Yield', angle: -90, position: 'insideLeft', fill: '#38bdf8', fontSize: 11 }} />
          <YAxis yAxisId="wt" orientation="right" domain={wTicks?.domain} ticks={wTicks?.ticks} interval={0} tick={{ fill: '#a78bfa', fontSize: 11 }}
            tickFormatter={v => `${v}%`} stroke="#475569" width={46}
            label={{ value: 'Weight', angle: 90, position: 'insideRight', fill: '#a78bfa', fontSize: 11 }} />
          <Tooltip content={<Tip />} />
          <Bar yAxisId="wt" dataKey="wt" name="Weight" fill="#6d28d9" fillOpacity={0.55} barSize={16} isAnimationActive={false}>
            <LabelList dataKey="code" content={BarLabel} />
            <LabelList dataKey="code" content={(p) => {
              if (p.x == null || p.width == null || !auctionSet.has(String(p.value).toUpperCase())) return null;
              return <circle cx={p.x + p.width / 2} cy={p.y + p.height + 7} r={4} fill="#f59e0b" stroke="#0f172a" strokeWidth={1} />;
            }} />
          </Bar>
          <Line yAxisId="yield" type="monotone" dataKey="y" name="Yield" stroke="#38bdf8" strokeWidth={2}
            dot={{ r: 2.5, fill: '#38bdf8' }} activeDot={{ r: 5 }} isAnimationActive={false}>
            <LabelList dataKey="code" position="top" offset={8} style={{ fill: '#7dd3fc', fontSize: 9, fontWeight: 600 }} />
          </Line>
        </ComposedChart>
      </ResizableChart>
      <p style={{ fontSize: 11, color: '#475569', margin: '8px 2px 0', lineHeight: 1.4 }}>
        Bars = index weight at each bond's tenor; line = its yield. Chart shows government bonds only (Eskom/Transnet excluded); metrics are weight‑averaged over the full index (semi‑annual, full reprice; modified duration in years, convexity in years²).
        {anyProxy && ' Non-government constituents (~2% weight) have no live quote, so their yield is estimated off the govie curve for the metrics (ignores credit spread) — minor effect on the totals.'}
      </p>

      {series.length > 2 && (
        <div style={{ marginTop: 18, paddingTop: 12, borderTop: '1px solid #334155' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#cbd5e1', marginBottom: 2 }}>Index metrics over time</div>
          <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8 }}>
            Each monthly index snapshot ({monthLabel(series[0].date)} → {monthLabel(series[series.length - 1].date)}), priced at that month's yields. Modified duration &amp; term in years (left), YTM % (right).
          </div>
          <ResizableChart height={300}>
            <ComposedChart data={series} margin={{ top: 10, right: 16, bottom: 8, left: 8 }}>
              <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 10 }} tickFormatter={histDateFmt} minTickGap={30} stroke="#475569" />
              <YAxis yAxisId="yr" domain={durTicks?.domain} ticks={durTicks?.ticks} interval={0} tick={{ fill: '#fbbf24', fontSize: 10 }}
                tickFormatter={v => `${v}y`} stroke="#475569" width={44} />
              <YAxis yAxisId="ytm" orientation="right" domain={ytmTicks?.domain} ticks={ytmTicks?.ticks} interval={0} tick={{ fill: '#38bdf8', fontSize: 10 }}
                tickFormatter={v => `${v}%`} stroke="#475569" width={48} />
              <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }}
                labelFormatter={histDateFmt} formatter={(v, n) => [n === 'YTM' ? `${v}%` : `${v}`, n]} />
              <Line yAxisId="yr" type="monotone" dataKey="modDur" name="Mod duration" stroke="#fbbf24" strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line yAxisId="yr" type="monotone" dataKey="term" name="Avg term" stroke="#a78bfa" strokeWidth={1.5} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
              <Line yAxisId="ytm" type="monotone" dataKey="ytm" name="YTM" stroke="#38bdf8" strokeWidth={2} dot={false} isAnimationActive={false} />
            </ComposedChart>
          </ResizableChart>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 11, color: '#94a3b8', marginTop: 4 }}>
            <span style={{ color: '#fbbf24' }}>— Mod duration</span>
            <span style={{ color: '#a78bfa' }}>-- Avg term</span>
            <span style={{ color: '#38bdf8' }}>— YTM (right)</span>
          </div>
        </div>
      )}
    </div>
  );
}
