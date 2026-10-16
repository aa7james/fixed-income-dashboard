import React, { useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, LabelList } from 'recharts';
import ResizableChart from './ResizableChart';
import { fmtTenor, tenorTicks } from './axisFormat';

const cell = (x = {}) => ({ padding: '8px 10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', ...x });
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// US constant-maturity benchmarks. Bills (≤1y) seed the short end of the curve
// for roll interpolation; the table itself covers 2y+ (needs a 1y horizon left).
const US_TENORS = {
  'US 1M T-Bill': 1 / 12, 'US 3M T-Bill': 0.25, 'US 6M T-Bill': 0.5, 'US 1Y T-Bill': 1,
  'US 2Y Treasury': 2, 'US 3Y Treasury': 3, 'US 5Y Treasury': 5, 'US 7Y Treasury': 7,
  'US 10Y Treasury': 10, 'US 20Y Treasury': 20, 'US 30Y Treasury': 30,
};
const shortLabel = (name) => name.replace('US ', '').replace(' Treasury', '').replace(' T-Bill', '');

const CurveTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, padding: '6px 10px', fontSize: 12, color: '#e2e8f0' }}>
      <strong>{p.label}</strong><br />
      {p.mat.toFixed(1)}y · <strong style={{ color: '#38bdf8' }}>{p.ytm.toFixed(2)}%</strong>
    </div>
  );
};

// Dirty price per 100 face, semi-annual. y, c in %; n = years to maturity (fractional ok).
function bondPV(y, n, c) {
  if (n <= 0) return 100;
  const i = y / 200;
  const tp = n * 2;
  const count = Math.ceil(tp - 1e-9);
  let pv = 0;
  for (let k = 1; k <= count; k++) {
    const t = tp - (count - k);
    pv += (c / 2) / Math.pow(1 + i, t);
  }
  pv += 100 / Math.pow(1 + i, tp);
  return pv;
}

// Linear interpolation of a {N, y} curve at x years.
function interp(curve, x) {
  if (!curve.length) return null;
  if (x <= curve[0].N) return curve[0].y;
  if (x >= curve[curve.length - 1].N) return curve[curve.length - 1].y;
  for (let i = 1; i < curve.length; i++) {
    if (x <= curve[i].N) {
      const a = curve[i - 1], b = curve[i];
      return a.y + (x - a.N) / (b.N - a.N) * (b.y - a.y);
    }
  }
  return curve[curve.length - 1].y;
}

// Modified duration (% price change per 1% yield move) via 1bp finite difference.
function modDuration(y0, N, c) {
  const h = 0.01;
  const up = bondPV(y0 + h, N, c), dn = bondPV(y0 - h, N, c), p = bondPV(y0, N, c);
  return (-((up - dn) / (2 * h)) / p) * 100;
}

// Breakeven yield rise (bps) by full reprice: the extra move dy on the roll-to yield
// at which the bond's 1y total return equals the cash return.
function breakevenReprice(yRoll, N, c, couponRet, P0, cashRate) {
  const tr = (dy) => couponRet + (bondPV(yRoll + dy, N - 1, c) / P0 - 1) * 100;
  const f = (dy) => tr(dy) - cashRate;
  let lo = -5, hi = 8;
  if (f(lo) <= 0) return lo * 100;
  if (f(hi) >= 0) return hi * 100;
  for (let k = 0; k < 80; k++) { const mid = (lo + hi) / 2; if (f(mid) > 0) lo = mid; else hi = mid; }
  return ((lo + hi) / 2) * 100;
}

// Build a sorted {N, y, name, label} curve from one data row.
function buildCurve(row) {
  if (!row) return [];
  const pts = [];
  for (const [name, N] of Object.entries(US_TENORS)) {
    const v = row[name];
    if (v == null || Number(v) <= 0.2 || Number(v) >= 40) continue;
    pts.push({ N, y: Number(v), name, label: shortLabel(name) });
  }
  return pts.sort((a, b) => a.N - b.N);
}

export default function USGovBonds({ data }) {
  const [bench, setBench] = useState('1Y'); // '1Y' | '3M' | 'Custom' | 'Zero'
  const [customRate, setCustomRate] = useState('4.00');
  const [showCurve, setShowCurve] = useState(true);
  const allRows = useMemo(() => data?.dataRows || [], [data]);
  const minISO = allRows.length ? iso(allRows[0].date) : '';
  const maxISO = allRows.length ? iso(allRows[allRows.length - 1].date) : '';
  const [asOf, setAsOf] = useState(maxISO);

  const latest = useMemo(() => {
    if (!allRows.length) return null;
    const target = asOf || maxISO;
    let row = allRows[0];
    for (const r of allRows) { if (iso(r.date) <= target) row = r; else break; }
    return row;
  }, [allRows, asOf, maxISO]);

  const setYearsBack = (yrs) => {
    if (!maxISO) return;
    const d = new Date(allRows[allRows.length - 1].date);
    d.setFullYear(d.getFullYear() - yrs);
    setAsOf(iso(d));
  };

  const cashRate = useMemo(() => {
    if (bench === 'Zero') return 0;
    if (bench === 'Custom') { const n = parseFloat(customRate); return isNaN(n) ? null : n; }
    if (!latest) return null;
    const v = bench === '1Y' ? latest['US 1Y T-Bill'] : latest['US 3M T-Bill'];
    return v == null ? null : Number(v);
  }, [latest, bench, customRate]);

  const benchLabel = bench === '1Y' ? '1y T-Bill' : bench === '3M' ? '3m T-Bill'
    : bench === 'Custom' ? 'Custom cash' : '0% (breakeven)';

  // Data row ~1 year after the as-at date (for realised columns).
  const futureRow = useMemo(() => {
    if (!latest || !allRows.length) return null;
    const target = new Date(latest.date); target.setFullYear(target.getFullYear() + 1);
    let best = null, bestDiff = Infinity;
    for (const r of allRows) {
      if (r.date <= latest.date) continue;
      const diff = Math.abs(r.date - target);
      if (diff < bestDiff) { bestDiff = diff; best = r; }
    }
    if (!best) return null;
    const yrsAfter = (best.date - latest.date) / (1000 * 3600 * 24 * 365);
    return (yrsAfter >= 0.75 && yrsAfter <= 1.5) ? best : null;
  }, [latest, allRows]);

  const rows = useMemo(() => {
    if (!latest || cashRate == null) return [];
    const curve = buildCurve(latest);
    if (!curve.length) return [];
    const futCurve = buildCurve(futureRow); // may be empty
    const now = latest.date;

    return curve
      .filter(g => g.N > 1.02) // 2y+ : need a 1y horizon left
      .map(g => {
        const c = g.y;                              // par curve → coupon = yield
        const matDate = new Date(now.getTime() + g.N * 365.25 * 24 * 3600 * 1000);
        const yRoll = interp(curve, g.N - 1);       // where it rolls to on an unchanged curve
        const rollDown = g.y - yRoll;
        const mod = modDuration(g.y, g.N, c);
        const price = bondPV(g.y, g.N, c);          // = 100 for integer-tenor par bond
        const priceH = bondPV(yRoll, g.N - 1, c);
        const couponRet = (c / price) * 100;
        const rollRet = (priceH / price - 1) * 100;
        const totalRet = couponRet + rollRet;
        const excess = totalRet - cashRate;
        const beBps = breakevenReprice(yRoll, g.N, c, couponRet, price, cashRate);
        // Realised: reprice at the yield a bond of (N-1)y actually had one year on.
        let actChange = null, actTR = null, actExcess = null;
        if (futCurve.length) {
          const fY = interp(futCurve, g.N - 1);
          if (fY != null) {
            actChange = (fY - g.y) * 100;           // yield the position moved through (incl. roll)
            actTR = couponRet + (bondPV(fY, g.N - 1, c) / price - 1) * 100;
            actExcess = actTR - cashRate;
          }
        }
        return {
          name: g.name, label: g.label, c, ytm: g.y, N: g.N, maturity: iso(matDate),
          mod, modH: modDuration(g.y, g.N - 1, c),
          yRoll, rollBps: rollDown * 100, couponRet, rollRet, totalRet, excess, beBps,
          actChange, actTR, actExcess,
        };
      })
      .sort((a, b) => a.N - b.N);
  }, [latest, cashRate, futureRow]);

  const hasActual = !!futureRow && rows.some(r => r.actExcess != null);

  const curvePoints = useMemo(() => {
    const curve = buildCurve(latest);
    return curve.map(p => ({ mat: p.N, ytm: p.y, label: p.label }));
  }, [latest]);

  const curveY = useMemo(() => {
    if (!curvePoints.length) return { domain: ['auto', 'auto'], ticks: undefined };
    const ys = curvePoints.map(p => p.ytm).concat(cashRate != null && cashRate > 0 ? [cashRate] : []);
    const lo = Math.floor((Math.min(...ys) - 0.1) * 4) / 4;
    const hi = Math.ceil((Math.max(...ys) + 0.1) * 4) / 4;
    const range = hi - lo;
    let step = range <= 1.2 ? 0.10 : 0.25;
    if (range / step > 30) step = 0.5;
    const ticks = [];
    for (let v = lo; v <= hi + 1e-9; v += step) ticks.push(+v.toFixed(2));
    return { domain: [lo, hi], ticks };
  }, [curvePoints, cashRate]);

  if (!latest) return <div style={{ color: '#64748b' }}>No data available.</div>;
  const noUS = !curvePoints.length;

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: '#f1f5f9', margin: 0 }}>US Treasuries — Cash Breakeven</h2>
        <p style={{ fontSize: 13, color: '#64748b', margin: '2px 0 0' }}>
          How far can each tenor's yield rise over 1 year before you'd have been better off in 1‑year cash? · as at {latest.dateStr}
        </p>
      </div>

      {noUS ? (
        <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 12, padding: 16, color: '#94a3b8', fontSize: 13 }}>
          No US Treasury yields in the data for this date.
        </div>
      ) : (<>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: '#94a3b8' }}>As at:</span>
        <input type="date" value={asOf || maxISO} min={minISO} max={maxISO}
          onChange={e => setAsOf(e.target.value)}
          style={{ fontSize: 12, padding: '4px 8px', borderRadius: 8, border: '1px solid #334155', background: '#1e293b', color: '#e2e8f0' }} />
        {[['Latest', null], ['−1y', 1], ['−3y', 3], ['−5y', 5]].map(([lbl, yrs]) => (
          <button key={lbl} onClick={() => yrs == null ? setAsOf(maxISO) : setYearsBack(yrs)}
            style={{ fontSize: 12, padding: '5px 10px', borderRadius: 8, cursor: 'pointer',
              border: '1px solid #334155', background: '#1e293b', color: '#94a3b8' }}>{lbl}</button>
        ))}
        {latest && <span style={{ fontSize: 12, color: '#64748b' }}>using data from <strong style={{ color: '#cbd5e1' }}>{latest.dateStr}</strong></span>}
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: '#94a3b8' }}>Benchmark:</span>
        {[['1y T-Bill', '1Y'], ['3m T-Bill', '3M'], ['Custom', 'Custom'], ['0% (breakeven)', 'Zero']].map(([lbl, val]) => (
          <button key={val} onClick={() => setBench(val)}
            style={{ fontSize: 12, padding: '5px 12px', borderRadius: 8, cursor: 'pointer', fontWeight: bench === val ? 700 : 400,
              border: '1px solid #334155', background: bench === val ? '#0ea5e9' : '#1e293b', color: bench === val ? '#fff' : '#94a3b8' }}>{lbl}</button>
        ))}
        {bench === 'Custom' && (
          <span style={{ fontSize: 12, color: '#94a3b8', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            rate:
            <input type="number" step="0.05" value={customRate} onChange={e => setCustomRate(e.target.value)}
              style={{ width: 70, fontSize: 12, padding: '4px 6px', borderRadius: 8, border: '1px solid #334155', background: '#1e293b', color: '#e2e8f0', fontVariantNumeric: 'tabular-nums' }} />%
          </span>
        )}
        <span style={{ fontSize: 13, color: '#cbd5e1' }}>
          {benchLabel} = <strong style={{ color: '#38bdf8' }}>{cashRate != null ? cashRate.toFixed(2) : '—'}%</strong>
        </span>
      </div>

      <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 12, padding: 16 }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, color: '#e2e8f0' }}>
            <thead>
              <tr style={{ color: '#94a3b8' }}>
                <th style={{ padding: '8px 10px', textAlign: 'left' }}>Tenor</th>
                <th style={cell()}>Coupon (par)</th>
                <th style={cell()}>Maturity</th>
                <th style={cell()}>YTM</th>
                <th style={cell()}>Mod. dur.</th>
                <th style={cell()}>Mod. dur. @ horizon</th>
                <th style={cell()}>Coupon return</th>
                <th style={cell()}>Rolls to</th>
                <th style={cell()}>Roll‑down return</th>
                <th style={cell()}>Total return</th>
                <th style={cell()}>Excess vs cash</th>
                <th style={cell()}>Breakeven</th>
                {hasActual && <th style={cell({ color: '#f1f5f9', borderLeft: '2px solid #334155' })}>Actual Δyield (1y)</th>}
                {hasActual && <th style={cell({ color: '#f1f5f9' })}>Actual excess</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.label} style={{ borderTop: '1px solid #0f172a' }}>
                  <td style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 600 }}>{r.label}</td>
                  <td style={cell({ color: '#94a3b8' })}>{r.c.toFixed(2)}%</td>
                  <td style={cell({ color: '#94a3b8' })}>{r.maturity}</td>
                  <td style={cell({ fontWeight: 700 })}>{r.ytm.toFixed(2)}%</td>
                  <td style={cell({ color: '#94a3b8' })}>{r.mod.toFixed(1)}</td>
                  <td style={cell({ color: '#64748b' })}>{r.modH.toFixed(1)}</td>
                  <td style={cell()}>{r.couponRet.toFixed(2)}%</td>
                  <td style={cell({ color: '#94a3b8' })}>{r.yRoll.toFixed(2)}% <span style={{ color: '#475569', fontSize: 11 }}>({r.rollBps <= 0 ? '+' : '−'}{Math.abs(Math.round(r.rollBps))}bp)</span></td>
                  <td style={cell({ color: r.rollRet >= 0 ? '#2dd4bf' : '#f87171' })}>{r.rollRet >= 0 ? '+' : ''}{r.rollRet.toFixed(2)}%</td>
                  <td style={cell({ fontWeight: 700 })}>{r.totalRet.toFixed(2)}%</td>
                  <td style={cell({ color: r.excess >= 0 ? '#4ade80' : '#f87171' })}>{r.excess >= 0 ? '+' : ''}{r.excess.toFixed(2)}%</td>
                  <td style={cell({ fontWeight: 700, color: r.beBps >= 20 ? '#4ade80' : r.beBps >= 0 ? '#fbbf24' : '#f87171' })}>{r.beBps >= 0 ? '+' : ''}{Math.round(r.beBps)}</td>
                  {hasActual && (
                    <td style={cell({ fontWeight: 600, borderLeft: '2px solid #334155', color: r.actChange == null ? '#475569' : r.actChange > 0 ? '#f87171' : '#4ade80' })}>
                      {r.actChange == null ? '—' : `${r.actChange > 0 ? '+' : ''}${Math.round(r.actChange)}`}
                    </td>
                  )}
                  {hasActual && (
                    <td style={cell({ fontWeight: 700, color: r.actExcess == null ? '#475569' : r.actExcess >= 0 ? '#4ade80' : '#f87171' })}>
                      {r.actExcess == null ? '—' : `${r.actExcess >= 0 ? '+' : ''}${r.actExcess.toFixed(2)}%`}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p style={{ fontSize: 12, color: '#cbd5e1', margin: '12px 2px 0', lineHeight: 1.5 }}>
          <strong style={{ color: '#e2e8f0' }}>Total return</strong> = <strong>Coupon return</strong> (coupon ÷ price) + <strong style={{ color: '#2dd4bf' }}>Roll‑down return</strong> — reprice the bond 1 year on (now N−1 years) at the <strong>Rolls to</strong> yield (the curve's (N−1)‑year point) vs its price today.
          <strong style={{ color: '#4ade80' }}> Excess vs cash</strong> = total return − {benchLabel} ({cashRate?.toFixed(2)}%): the price fall the bond can absorb before it loses.
          <strong style={{ color: '#fbbf24' }}> Breakeven</strong> (bps) = the extra yield rise (full reprice at the horizon) at which the bond's total return drops to the {benchLabel}. Bigger = more cushion; negative = already behind cash.
        </p>
        {hasActual && (
          <p style={{ fontSize: 12, color: '#cbd5e1', margin: '8px 2px 0', lineHeight: 1.5 }}>
            <strong style={{ color: '#f1f5f9' }}>Actual Δyield (1y)</strong> = where the (N−1)y yield actually ended up one year on (as at {futureRow.dateStr}) vs this tenor's yield today — the yield the position moved through, including roll; red = rose, green = fell.
            <strong style={{ color: '#f1f5f9' }}> Actual excess</strong> = realised total return (repriced at that actual yield) minus the {benchLabel} you'd have locked in ({cashRate?.toFixed(2)}%).
          </p>
        )}
        <p style={{ fontSize: 11, color: '#475569', margin: '8px 2px 0', lineHeight: 1.4 }}>
          Constant‑maturity par curve: each tenor is treated as a par bond (coupon = yield, priced at 100), so roll‑down reflects curve shape with no pull‑to‑par. Carry + roll model (no coupon reinvestment); roll‑down and breakeven are full semi‑annual reprices; roll‑to yield interpolated from the Treasury curve. Realised columns reprice off the future curve at the horizon (a CMT point isn't a single ageing bond). Tenors under 1y excluded.
        </p>
      </div>

      <div style={{ marginTop: 16, background: '#1e293b', border: '1px solid #334155', borderRadius: 12, padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
          onClick={() => setShowCurve(v => !v)}>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9', margin: 0 }}>
            US Treasury yield curve <span style={{ color: '#64748b', fontWeight: 400 }}>· {latest.dateStr}</span>
          </h3>
          <button onClick={(e) => { e.stopPropagation(); setShowCurve(v => !v); }}
            style={{ fontSize: 12, padding: '5px 12px', borderRadius: 8, cursor: 'pointer',
              border: '1px solid #334155', background: '#0f172a', color: '#94a3b8' }}>
            {showCurve ? '▾ Minimise' : '▸ Show'}
          </button>
        </div>
        {showCurve && (
          <div style={{ marginTop: 12 }}>
            <ResizableChart height={320}>
              <LineChart data={curvePoints} margin={{ top: 10, right: 24, bottom: 24, left: 8 }}>
                <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
                <XAxis type="number" dataKey="mat" domain={[0, 'dataMax']} tick={{ fill: '#94a3b8', fontSize: 11 }}
                  ticks={tenorTicks(curvePoints.length ? Math.max(...curvePoints.map(p => p.mat)) : 30)}
                  tickFormatter={fmtTenor} stroke="#475569"
                  label={{ value: 'Years to maturity', position: 'insideBottom', offset: -12, fill: '#64748b', fontSize: 12 }} />
                <YAxis domain={curveY.domain} ticks={curveY.ticks} interval={0} allowDecimals tick={{ fill: '#94a3b8', fontSize: 11 }}
                  tickFormatter={v => `${v.toFixed(2)}%`} stroke="#475569" width={52} />
                <Tooltip content={<CurveTooltip />} />
                {cashRate != null && cashRate > 0 && (
                  <ReferenceLine y={cashRate} stroke="#f59e0b" strokeDasharray="5 4"
                    label={{ value: `${benchLabel} ${cashRate.toFixed(2)}%`, position: 'insideTopRight', fill: '#f59e0b', fontSize: 11 }} />
                )}
                <Line type="monotone" dataKey="ytm" stroke="#38bdf8" strokeWidth={2}
                  dot={{ r: 3, fill: '#38bdf8' }} activeDot={{ r: 5 }} isAnimationActive={false}>
                  <LabelList dataKey="label" position="top" offset={8} style={{ fill: '#7dd3fc', fontSize: 10, fontWeight: 600 }} />
                </Line>
              </LineChart>
            </ResizableChart>
            <p style={{ fontSize: 11, color: '#475569', margin: '8px 2px 0' }}>
              US Treasury constant‑maturity yields by tenor, as at {latest.dateStr}.{cashRate > 0 ? ` Dashed line = ${benchLabel} (${cashRate?.toFixed(2)}%).` : ''} Drag the bottom‑right corner to resize.
            </p>
          </div>
        )}
      </div>

      </>)}
    </div>
  );
}
