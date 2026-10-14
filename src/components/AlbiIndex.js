import React, { useMemo } from 'react';
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import ResizableChart from './ResizableChart';
import { niceTicks } from './useYAxisBounds';
import { fmtTenor, tenorTicks } from './axisFormat';

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

const metricCard = (label, value, sub) => (
  <div key={label} style={{ flex: '1 1 130px', minWidth: 120, background: '#0f172a', border: '1px solid #334155', borderRadius: 10, padding: '10px 12px' }}>
    <div style={{ fontSize: 11, color: '#94a3b8' }}>{label}</div>
    <div style={{ fontSize: 20, fontWeight: 700, color: '#f1f5f9', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    {sub && <div style={{ fontSize: 10, color: '#64748b' }}>{sub}</div>}
  </div>
);

export default function AlbiIndex({ data, instruments }) {
  const latest = data?.dataRows?.length ? data.dataRows[data.dataRows.length - 1] : null;

  const { rows, chartRows, metrics, anyProxy } = useMemo(() => {
    const now = new Date();
    const yrs = (d) => (new Date(d) - now) / (1000 * 3600 * 24 * 365);
    const sane = (v) => v != null && Number(v) > 0.2 && Number(v) < 40;
    // Govie curve for yields of constituents we don't have a live quote for.
    const curve = (instruments || [])
      .filter(i => i.category === 'Government Bonds' && i.maturity_date && latest && sane(latest[i.name]))
      .map(i => ({ N: yrs(i.maturity_date), y: Number(latest[i.name]) })).filter(p => p.N > 0).sort((a, b) => a.N - b.N);
    // code -> live yield (match on display_label)
    const yieldByCode = {};
    (instruments || []).forEach(i => {
      if (latest && i.display_label && sane(latest[i.name])) yieldByCode[i.display_label] = Number(latest[i.name]);
    });

    const total = ALBI.reduce((a, r) => a + r[4], 0);
    let proxy = false;
    const rws = ALBI.map(([code, issuer, c, mat, w]) => {
      const N = yrs(mat);
      const wt = (w / total) * 100;
      let y = yieldByCode[code];
      const isProxy = y == null;
      if (isProxy) { y = interp(curve, N); proxy = true; }
      const { modDur, convexity } = y != null ? risk(y, N, c) : { modDur: null, convexity: null };
      return { code, issuer, c, mat, N, wt, y, isProxy, modDur, convexity };
    }).filter(r => r.N > 0 && r.y != null).sort((a, b) => a.N - b.N);

    const wsum = (f) => rws.reduce((a, r) => a + (r.wt / 100) * f(r), 0);
    const metrics = {
      n: rws.length,
      ytm: wsum(r => r.y),
      modDur: wsum(r => r.modDur),
      convexity: wsum(r => r.convexity),
      term: wsum(r => r.N),
      coupon: wsum(r => r.c),
      rsaWt: rws.filter(r => r.issuer === 'RSA').reduce((a, r) => a + r.wt, 0),
    };
    // Chart shows government bonds only; metrics still cover the whole index.
    const chartRows = rws.filter(r => r.issuer === 'RSA');
    return { rows: rws, chartRows, metrics, anyProxy: proxy };
  }, [latest, instruments]);

  if (!latest) return null;
  if (!rows.length) return <div style={{ color: '#64748b', fontSize: 13 }}>ALBI: no live yields available yet.</div>;

  const maxN = Math.max(...chartRows.map(r => r.N));
  const yld = niceTicks(Math.min(...chartRows.map(r => r.y)) - 0.3, Math.max(...chartRows.map(r => r.y)) + 0.3);
  const wMax = Math.max(...chartRows.map(r => r.wt));
  const wTicks = niceTicks(0, wMax);

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
      <div style={{ marginBottom: 12 }}>
        <h3 style={{ fontSize: 16, fontWeight: 700, color: '#f1f5f9', margin: 0 }}>ALBI index — weights on the yield curve</h3>
        <p style={{ fontSize: 12, color: '#64748b', margin: '2px 0 0' }}>
          FTSE/JSE All Bond Index government constituents (as at {AS_AT}): weight by tenor (bars) behind the yield curve (line). Yields live as at {latest.dateStr}. Metrics below cover the full index.
        </p>
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        {metricCard('Weighted YTM', `${metrics.ytm.toFixed(2)}%`)}
        {metricCard('Modified duration', metrics.modDur.toFixed(2), 'years')}
        {metricCard('Convexity', metrics.convexity.toFixed(1))}
        {metricCard('Avg term', `${metrics.term.toFixed(1)}y`)}
        {metricCard('Avg coupon', `${metrics.coupon.toFixed(2)}%`)}
        {metricCard('Constituents', metrics.n, `${metrics.rsaWt.toFixed(0)}% RSA`)}
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
          <Bar yAxisId="wt" dataKey="wt" name="Weight" fill="#6d28d9" fillOpacity={0.55} barSize={14} isAnimationActive={false} />
          <Line yAxisId="yield" type="monotone" dataKey="y" name="Yield" stroke="#38bdf8" strokeWidth={2}
            dot={{ r: 2.5, fill: '#38bdf8' }} activeDot={{ r: 5 }} isAnimationActive={false} />
        </ComposedChart>
      </ResizableChart>
      <p style={{ fontSize: 11, color: '#475569', margin: '8px 2px 0', lineHeight: 1.4 }}>
        Bars = index weight at each bond's tenor; line = its yield. Chart shows government bonds only (Eskom/Transnet excluded); metrics are weight‑averaged over the full index (semi‑annual, full reprice; modified duration in years, convexity in years²).
        {anyProxy && ' Non-government constituents (~2% weight) have no live quote, so their yield is estimated off the govie curve for the metrics (ignores credit spread) — minor effect on the totals.'}
      </p>
    </div>
  );
}
