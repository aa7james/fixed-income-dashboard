import React, { useMemo, useState } from 'react';

const cell = (x = {}) => ({ padding: '8px 10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', ...x });

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

// 1-year holding-period total return (decimal): bought at y0 today, marked at the
// horizon yield yH 1 year shorter; in-year coupons reinvested at yH.
function trAtHorizonYield(y0, yH, N, c) {
  const D0 = bondPV(y0, N, c);
  const D1 = bondPV(yH, N - 1, c);
  const tp = N * 2, count = Math.ceil(tp - 1e-9);
  let reinv = 0;
  for (let k = 1; k <= count; k++) {
    const t = tp - (count - k);
    if (t <= 2 + 1e-9) reinv += (c / 2) * Math.pow(1 + yH / 100, (2 - t) / 2);
  }
  return (D1 + reinv) / D0 - 1;
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

function modDuration(y0, N, c) {
  const h = 0.01; // 1bp bump in % units
  const up = bondPV(y0 + h, N, c), dn = bondPV(y0 - h, N, c), p = bondPV(y0, N, c);
  // y is in %, so convert dP/d(%)/P to years (× 100 to get per-decimal duration)
  return (-((up - dn) / (2 * h)) / p) * 100;
}

// Yield rise (in %) above a baseline horizon yield at which bond 1y TR == target cash return.
function breakevenRise(y0, yBase, N, c, target) {
  const f = (dy) => trAtHorizonYield(y0, yBase + dy, N, c) - target;
  let lo = -1, hi = 3; // yield move in %: -100bps .. +300bps
  if (f(lo) < 0) return lo;
  if (f(hi) > 0) return hi;
  for (let k = 0; k < 60; k++) { const mid = (lo + hi) / 2; if (f(mid) > 0) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}

export default function SAGovBonds({ data, instruments }) {
  const [bench, setBench] = useState('NCD'); // 'NCD' | 'T-Bill'
  const latest = data?.dataRows?.length ? data.dataRows[data.dataRows.length - 1] : null;

  const cashRate = useMemo(() => {
    if (!latest) return null;
    const v = bench === 'NCD' ? latest['12m Fixed Rate NCD'] : latest['12m T-Bill'];
    return v == null ? null : Number(v);
  }, [latest, bench]);

  const rows = useMemo(() => {
    if (!latest || !instruments?.length || cashRate == null) return [];
    const now = new Date();
    const target = cashRate / 100; // 1y cash return (simple)
    const govies = instruments
      .filter(i => i.category === 'Government Bonds' && i.is_active !== false && i.coupon != null && i.maturity_date && latest[i.name] != null)
      .map(i => ({
        label: i.display_label || i.name, c: Number(i.coupon) * 100, maturity: i.maturity_date,
        N: (new Date(i.maturity_date) - now) / (1000 * 3600 * 24 * 365), ytm: Number(latest[i.name]),
      }));
    // Yield curve = every govie point (incl. sub-1y) so N-1 can be interpolated.
    const curve = govies.map(g => ({ N: g.N, y: g.ytm })).sort((a, b) => a.N - b.N);

    return govies
      .filter(g => g.N > 1.02) // need a 1y horizon left
      .map(g => {
        const yRoll = interp(curve, g.N - 1);          // where it rolls to on an unchanged curve
        const roll = g.ytm - yRoll;                    // roll-down (yield gives up)
        const trFlat = trAtHorizonYield(g.ytm, g.ytm, g.N, g.c);   // curve-unchanged, no roll
        const trRoll = trAtHorizonYield(g.ytm, yRoll, g.N, g.c);   // curve-unchanged, with roll
        const beFlat = breakevenRise(g.ytm, g.ytm, g.N, g.c, target) * 100;
        const beRoll = breakevenRise(g.ytm, yRoll, g.N, g.c, target) * 100;
        return {
          ...g, mod: modDuration(g.ytm, g.N, g.c),
          rollBps: roll * 100, trFlat: trFlat * 100, trRoll: trRoll * 100,
          beFlat, beRoll, diff: beRoll - beFlat,
        };
      })
      .sort((a, b) => new Date(a.maturity) - new Date(b.maturity));
  }, [latest, instruments, cashRate]);

  if (!latest) return <div style={{ color: '#64748b' }}>No data available.</div>;

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: '#f1f5f9', margin: 0 }}>SA Government Bonds — Cash Breakeven</h2>
        <p style={{ fontSize: 13, color: '#64748b', margin: '2px 0 0' }}>
          How far can each bond's yield rise over 1 year before you'd have been better off in 1‑year cash? · as at {latest.dateStr}
        </p>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: '#94a3b8' }}>Benchmark (1‑year cash):</span>
        {['NCD', 'T-Bill'].map(b => (
          <button key={b} onClick={() => setBench(b)}
            style={{ fontSize: 12, padding: '5px 12px', borderRadius: 8, cursor: 'pointer', fontWeight: bench === b ? 700 : 400,
              border: '1px solid #334155', background: bench === b ? '#0ea5e9' : '#1e293b', color: bench === b ? '#fff' : '#94a3b8' }}>{b}</button>
        ))}
        <span style={{ fontSize: 13, color: '#cbd5e1' }}>
          1y {bench} = <strong style={{ color: '#38bdf8' }}>{cashRate != null ? cashRate.toFixed(2) : '—'}%</strong>
        </span>
      </div>

      <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 12, padding: 16 }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, color: '#e2e8f0' }}>
            <thead>
              <tr style={{ color: '#64748b', fontSize: 11 }}>
                <th colSpan={5}></th>
                <th colSpan={2} style={{ padding: '2px 8px', textAlign: 'center', borderBottom: '1px solid #334155' }}>No roll‑down</th>
                <th colSpan={2} style={{ padding: '2px 8px', textAlign: 'center', borderBottom: '1px solid #334155' }}>With roll‑down</th>
                <th></th>
              </tr>
              <tr style={{ color: '#94a3b8' }}>
                <th style={{ padding: '8px 10px', textAlign: 'left' }}>Bond</th>
                <th style={cell()}>Coupon</th>
                <th style={cell()}>Maturity</th>
                <th style={cell()}>YTM</th>
                <th style={cell()}>Mod. dur.</th>
                <th style={cell()}>1y TR</th>
                <th style={cell()}>Breakeven</th>
                <th style={cell()}>1y TR</th>
                <th style={cell()}>Breakeven</th>
                <th style={cell()}>Roll adds</th>
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
                  <td style={cell()}>{r.trFlat.toFixed(2)}%</td>
                  <td style={cell({ fontWeight: 700, color: r.beFlat >= 20 ? '#4ade80' : r.beFlat >= 0 ? '#fbbf24' : '#f87171' })}>{r.beFlat >= 0 ? '+' : ''}{Math.round(r.beFlat)}</td>
                  <td style={cell({ color: '#2dd4bf' })}>{r.trRoll.toFixed(2)}%</td>
                  <td style={cell({ fontWeight: 700, color: r.beRoll >= 20 ? '#4ade80' : r.beRoll >= 0 ? '#fbbf24' : '#f87171' })}>{r.beRoll >= 0 ? '+' : ''}{Math.round(r.beRoll)}</td>
                  <td style={cell({ color: '#a78bfa' })}>+{Math.round(r.diff)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p style={{ fontSize: 12, color: '#cbd5e1', margin: '12px 2px 0', lineHeight: 1.5 }}>
          <strong style={{ color: '#4ade80' }}>Breakeven</strong> (bps) = how far the bond's yield can rise over the year before its 1‑year total return drops to the 1y {bench} ({cashRate?.toFixed(2)}%). Bigger = more cushion.
          <strong style={{ color: '#2dd4bf' }}> With roll‑down</strong> assumes the curve is unchanged, so the bond ages to a lower yield (the (N‑1)‑year point) — adding return and widening the cushion by <strong style={{ color: '#a78bfa' }}>Roll adds</strong>.
        </p>
        <p style={{ fontSize: 11, color: '#475569', margin: '8px 2px 0', lineHeight: 1.4 }}>
          Full repricing (semi‑annual), coupons reinvested at the horizon yield. "No roll‑down" = parallel move off today's yield. Roll‑down interpolated from the govie curve. ACT/365, clean entry, bonds maturing within a year excluded.
        </p>
      </div>
    </div>
  );
}
