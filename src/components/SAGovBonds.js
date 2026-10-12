import React, { useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine } from 'recharts';
import ResizableChart from './ResizableChart';

const cell = (x = {}) => ({ padding: '8px 10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', ...x });
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

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
  const i = y / 200;                // per semi-annual period
  const tp = n * 2;                 // total periods to maturity
  const count = Math.ceil(tp - 1e-9);
  let pv = 0;
  for (let k = 1; k <= count; k++) {
    const t = tp - (count - k);     // periods from now to coupon k
    pv += (c / 2) / Math.pow(1 + i, t);
  }
  pv += 100 / Math.pow(1 + i, tp);  // principal at maturity
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
  const h = 0.01; // 1bp bump in % units
  const up = bondPV(y0 + h, N, c), dn = bondPV(y0 - h, N, c), p = bondPV(y0, N, c);
  return (-((up - dn) / (2 * h)) / p) * 100;
}

// Breakeven yield rise (bps) by full reprice: the extra move dy (on the roll-to yield,
// realised at the horizon) at which the bond's 1y total return equals the cash return.
function breakevenReprice(yRoll, N, c, couponRet, P0, cashRate) {
  const tr = (dy) => couponRet + (bondPV(yRoll + dy, N - 1, c) / P0 - 1) * 100; // total return (%)
  const f = (dy) => tr(dy) - cashRate; // decreasing in dy
  let lo = -5, hi = 8; // yield move in %-pts
  if (f(lo) <= 0) return lo * 100;
  if (f(hi) >= 0) return hi * 100;
  for (let k = 0; k < 80; k++) { const mid = (lo + hi) / 2; if (f(mid) > 0) lo = mid; else hi = mid; }
  return ((lo + hi) / 2) * 100;
}

export default function SAGovBonds({ data, instruments }) {
  const [bench, setBench] = useState('NCD'); // 'NCD' | 'T-Bill' | 'Call' | 'Zero'
  const [callRate, setCallRate] = useState('7.10'); // editable call-account rate (%)
  const [showCurve, setShowCurve] = useState(true);
  const allRows = useMemo(() => data?.dataRows || [], [data]);
  const minISO = allRows.length ? iso(allRows[0].date) : '';
  const maxISO = allRows.length ? iso(allRows[allRows.length - 1].date) : '';
  const [asOf, setAsOf] = useState(maxISO);

  // the data row on or before the selected as-of date (rows are sorted ascending)
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
    if (bench === 'Call') { const n = parseFloat(callRate); return isNaN(n) ? null : n; }
    if (!latest) return null;
    const v = bench === 'NCD' ? latest['12m Fixed Rate NCD'] : latest['12m T-Bill'];
    return v == null ? null : Number(v);
  }, [latest, bench, callRate]);

  const benchLabel = bench === 'NCD' ? '1y NCD' : bench === 'T-Bill' ? '1y T-Bill'
    : bench === 'Call' ? 'Call' : '0% (breakeven)';

  const rows = useMemo(() => {
    if (!latest || !instruments?.length || cashRate == null) return [];
    const now = latest.date; // value the maturities are measured from = the as-at date
    const govies = instruments
      .filter(i => i.category === 'Government Bonds' && i.coupon != null && i.maturity_date
        && latest[i.name] != null && Number(latest[i.name]) > 0.5 && Number(latest[i.name]) < 40)
      .map(i => ({
        label: i.display_label || i.name, c: Number(i.coupon) * 100, maturity: i.maturity_date,
        N: (new Date(i.maturity_date) - now) / (1000 * 3600 * 24 * 365), ytm: Number(latest[i.name]),
      }));
    // Yield curve = every govie point (incl. sub-1y) so N-1 can be interpolated.
    const curve = govies.map(g => ({ N: g.N, y: g.ytm })).sort((a, b) => a.N - b.N);

    return govies
      .filter(g => g.N > 1.02) // need a 1y horizon left
      .map(g => {
        const yRoll = interp(curve, g.N - 1);       // where it rolls to on an unchanged curve
        const rollDown = g.ytm - yRoll;             // yield given up as it rolls (%-pts)
        const mod = modDuration(g.ytm, g.N, g.c);
        const price = bondPV(g.ytm, g.N, g.c);      // dirty price today = capital invested
        const priceH = bondPV(yRoll, g.N - 1, g.c); // dirty price in 1y, repriced on unchanged curve
        const couponRet = (g.c / price) * 100;      // coupon income / dirty price (%)
        const rollRet = (priceH / price - 1) * 100; // full reprice: roll-down + pull-to-par (%)
        const totalRet = couponRet + rollRet;       // bond's 1y return, curve unchanged (%)
        const excess = totalRet - cashRate;         // edge over 1y cash (%)
        const beBps = breakevenReprice(yRoll, g.N, g.c, couponRet, price, cashRate); // full reprice (bps)
        return {
          ...g, mod, modH: modDuration(g.ytm, g.N - 1, g.c),
          yRoll, rollBps: rollDown * 100, couponRet, rollRet, totalRet, excess, beBps,
        };
      })
      .sort((a, b) => new Date(a.maturity) - new Date(b.maturity));
  }, [latest, instruments, cashRate]);

  // Government yield curve points (incl. sub-1y) as at the selected date.
  const curvePoints = useMemo(() => {
    if (!latest || !instruments?.length) return [];
    const now = latest.date;
    return instruments
      .filter(i => i.category === 'Government Bonds' && i.maturity_date
        && latest[i.name] != null && Number(latest[i.name]) > 0.5 && Number(latest[i.name]) < 40)
      .map(i => ({
        mat: (new Date(i.maturity_date) - now) / (1000 * 3600 * 24 * 365),
        ytm: Number(latest[i.name]), label: i.display_label || i.name,
      }))
      .filter(p => p.mat > 0)
      .sort((a, b) => a.mat - b.mat);
  }, [latest, instruments]);

  if (!latest) return <div style={{ color: '#64748b' }}>No data available.</div>;

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: '#f1f5f9', margin: 0 }}>SA Government Bonds — Cash Breakeven</h2>
        <p style={{ fontSize: 13, color: '#64748b', margin: '2px 0 0' }}>
          How far can each bond's yield rise over 1 year before you'd have been better off in 1‑year cash? · as at {latest.dateStr}
        </p>
      </div>

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
        {[['1y NCD', 'NCD'], ['1y T-Bill', 'T-Bill'], ['Call', 'Call'], ['0% (breakeven)', 'Zero']].map(([lbl, val]) => (
          <button key={val} onClick={() => setBench(val)}
            style={{ fontSize: 12, padding: '5px 12px', borderRadius: 8, cursor: 'pointer', fontWeight: bench === val ? 700 : 400,
              border: '1px solid #334155', background: bench === val ? '#0ea5e9' : '#1e293b', color: bench === val ? '#fff' : '#94a3b8' }}>{lbl}</button>
        ))}
        {bench === 'Call' && (
          <span style={{ fontSize: 12, color: '#94a3b8', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            rate:
            <input type="number" step="0.05" value={callRate} onChange={e => setCallRate(e.target.value)}
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
                <th style={{ padding: '8px 10px', textAlign: 'left' }}>Bond</th>
                <th style={cell()}>Coupon</th>
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
                  <td style={cell({ color: '#94a3b8' })}>{r.yRoll.toFixed(2)}% <span style={{ color: '#475569', fontSize: 11 }}>(−{Math.round(r.rollBps)}bp)</span></td>
                  <td style={cell({ color: r.rollRet >= 0 ? '#2dd4bf' : '#f87171' })}>{r.rollRet >= 0 ? '+' : ''}{r.rollRet.toFixed(2)}%</td>
                  <td style={cell({ fontWeight: 700 })}>{r.totalRet.toFixed(2)}%</td>
                  <td style={cell({ color: r.excess >= 0 ? '#4ade80' : '#f87171' })}>{r.excess >= 0 ? '+' : ''}{r.excess.toFixed(2)}%</td>
                  <td style={cell({ fontWeight: 700, color: r.beBps >= 20 ? '#4ade80' : r.beBps >= 0 ? '#fbbf24' : '#f87171' })}>{r.beBps >= 0 ? '+' : ''}{Math.round(r.beBps)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p style={{ fontSize: 12, color: '#cbd5e1', margin: '12px 2px 0', lineHeight: 1.5 }}>
          <strong style={{ color: '#e2e8f0' }}>Total return</strong> = <strong>Coupon return</strong> (coupon ÷ dirty price) + <strong style={{ color: '#2dd4bf' }}>Roll‑down return</strong> — reprice the bond 1 year on (now N−1 years) at the <strong>Rolls to</strong> yield (the curve's (N−1)‑year point) vs its price today: captures both the yield roll‑down and the pull‑to‑par.
          <strong style={{ color: '#4ade80' }}> Excess vs cash</strong> = total return − {benchLabel} ({cashRate?.toFixed(2)}%): the price fall the bond can absorb before it loses.
          <strong style={{ color: '#fbbf24' }}> Breakeven</strong> (bps) = the extra yield rise (full reprice at the horizon) at which the bond's total return drops to the {benchLabel}. Bigger = more cushion; negative = already behind cash.
        </p>
        <p style={{ fontSize: 11, color: '#475569', margin: '8px 2px 0', lineHeight: 1.4 }}>
          Carry + roll model (no coupon reinvestment). Roll‑down and breakeven are both full semi‑annual reprices (no duration shortcut); roll‑to yield interpolated from the govie curve. Modified‑duration columns (today and at horizon) shown for reference. ACT/365, bonds maturing within a year excluded.
        </p>
      </div>

      <div style={{ marginTop: 16, background: '#1e293b', border: '1px solid #334155', borderRadius: 12, padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
          onClick={() => setShowCurve(v => !v)}>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9', margin: 0 }}>
            Government yield curve <span style={{ color: '#64748b', fontWeight: 400 }}>· {latest.dateStr}</span>
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
                  tickFormatter={v => `${v.toFixed(0)}y`} stroke="#475569"
                  label={{ value: 'Years to maturity', position: 'insideBottom', offset: -12, fill: '#64748b', fontSize: 12 }} />
                <YAxis domain={['auto', 'auto']} tick={{ fill: '#94a3b8', fontSize: 11 }}
                  tickFormatter={v => `${v.toFixed(1)}%`} stroke="#475569" width={48} />
                <Tooltip content={<CurveTooltip />} />
                {cashRate != null && cashRate > 0 && (
                  <ReferenceLine y={cashRate} stroke="#f59e0b" strokeDasharray="5 4"
                    label={{ value: `${benchLabel} ${cashRate.toFixed(2)}%`, position: 'insideTopRight', fill: '#f59e0b', fontSize: 11 }} />
                )}
                <Line type="monotone" dataKey="ytm" stroke="#38bdf8" strokeWidth={2}
                  dot={{ r: 3, fill: '#38bdf8' }} activeDot={{ r: 5 }} isAnimationActive={false} />
              </LineChart>
            </ResizableChart>
            <p style={{ fontSize: 11, color: '#475569', margin: '8px 2px 0' }}>
              Nominal govie YTMs by years to maturity, as at {latest.dateStr}.{cashRate > 0 ? ` Dashed line = ${benchLabel} (${cashRate?.toFixed(2)}%).` : ''} Drag the bottom‑right corner to resize.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
