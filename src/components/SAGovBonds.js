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

// 1-year holding-period total return (decimal) for a yield change dy (%).
// Coupons paid within the year are reinvested at the horizon yield to the horizon.
function horizonTR(y0, dy, N, c) {
  const y1 = y0 + dy;
  const D0 = bondPV(y0, N, c);
  const D1 = bondPV(y1, N - 1, c);
  const tp = N * 2, count = Math.ceil(tp - 1e-9);
  let reinv = 0;
  for (let k = 1; k <= count; k++) {
    const t = tp - (count - k);
    if (t <= 2 + 1e-9) reinv += (c / 2) * Math.pow(1 + y1 / 100, (2 - t) / 2);
  }
  return (D1 + reinv) / D0 - 1;
}

function modDuration(y0, N, c) {
  const h = 0.01;
  const up = bondPV(y0 + h, N, c), dn = bondPV(y0 - h, N, c), p = bondPV(y0, N, c);
  return -((up - dn) / (2 * h)) / p;
}

// Δy (decimal of %, i.e. 0.0123 = +1.23%) at which bond 1y TR == target cash return.
function breakevenDy(y0, N, c, target) {
  const f = (dy) => horizonTR(y0, dy, N, c) - target;
  let lo = -0.05, hi = 0.25; // search -5% .. +25% yield move
  if (f(lo) < 0) return lo;
  if (f(hi) > 0) return hi;  // cushion exceeds +25%
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
    return instruments
      .filter(i => i.category === 'Government Bonds' && i.is_active !== false && i.coupon != null && i.maturity_date)
      .map(i => {
        const y0 = latest[i.name];
        const N = (new Date(i.maturity_date) - now) / (1000 * 3600 * 24 * 365);
        if (y0 == null || N <= 1.02) return null; // need a 1y horizon left
        const c = Number(i.coupon) * 100;
        const y = Number(y0);
        const tr0 = horizonTR(y, 0, N, c);        // 1y TR if yield unchanged
        const be = breakevenDy(y, N, c, target);  // breakeven yield rise
        return {
          label: i.display_label || i.name, coupon: c, maturity: i.maturity_date, N,
          ytm: y, tr0: tr0 * 100, mod: modDuration(y, N, c),
          pickup: (tr0 - target) * 10000, // bps of 1y return vs cash if yields flat
          beBps: be * 10000,
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.beBps - a.beBps);
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
              <tr style={{ color: '#94a3b8' }}>
                <th style={{ padding: '8px 10px', textAlign: 'left' }}>Bond</th>
                <th style={cell()}>Coupon</th>
                <th style={cell()}>Maturity</th>
                <th style={cell()}>YTM</th>
                <th style={cell()}>Mod. dur.</th>
                <th style={cell()}>1y TR (flat)</th>
                <th style={cell()}>vs cash (flat)</th>
                <th style={cell()}>Breakeven yield rise</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.label} style={{ borderTop: '1px solid #0f172a' }}>
                  <td style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 600 }}>{r.label}</td>
                  <td style={cell({ color: '#94a3b8' })}>{r.coupon.toFixed(2)}%</td>
                  <td style={cell({ color: '#94a3b8' })}>{r.maturity}</td>
                  <td style={cell({ fontWeight: 700 })}>{r.ytm.toFixed(2)}%</td>
                  <td style={cell({ color: '#94a3b8' })}>{r.mod.toFixed(1)}</td>
                  <td style={cell()}>{r.tr0.toFixed(2)}%</td>
                  <td style={cell({ color: r.pickup >= 0 ? '#4ade80' : '#f87171' })}>{r.pickup >= 0 ? '+' : ''}{Math.round(r.pickup)} bps</td>
                  <td style={cell({ fontWeight: 700, color: r.beBps >= 100 ? '#4ade80' : r.beBps >= 0 ? '#fbbf24' : '#f87171' })}>
                    {r.beBps >= 0 ? '+' : ''}{Math.round(r.beBps)} bps
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p style={{ fontSize: 12, color: '#cbd5e1', margin: '12px 2px 0', lineHeight: 1.5 }}>
          <strong style={{ color: '#4ade80' }}>Breakeven yield rise</strong> = how much the bond's own yield can rise over the year before its 1‑year total return
          drops to the 1y {bench} return. Bigger = more cushion. If the yield rises by <em>less</em> than this, the bond beats cash; by <em>more</em>, cash wins.
        </p>
        <p style={{ fontSize: 11, color: '#475569', margin: '8px 2px 0', lineHeight: 1.4 }}>
          Full repricing: bond priced today (semi‑annual) and re‑priced 1 year shorter at the shifted yield; coupons paid in the year are reinvested at the horizon yield.
          "Flat" = yield unchanged. Assumes a parallel move in the bond's own yield (no curve roll‑down), ACT/365, and clean entry. Bonds maturing within a year are excluded.
        </p>
      </div>
    </div>
  );
}
