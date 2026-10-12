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
        const yRoll = interp(curve, g.N - 1);       // where it rolls to on an unchanged curve
        const rollDown = g.ytm - yRoll;             // yield given up as it rolls (%-pts)
        const mod = modDuration(g.ytm, g.N, g.c);
        const price = bondPV(g.ytm, g.N, g.c);      // dirty price today = capital invested
        const priceH = bondPV(yRoll, g.N - 1, g.c); // dirty price in 1y, repriced on unchanged curve
        const couponRet = (g.c / price) * 100;      // coupon income / dirty price (%)
        const rollRet = (priceH / price - 1) * 100; // full reprice: roll-down + pull-to-par (%)
        const totalRet = couponRet + rollRet;       // bond's 1y return, curve unchanged (%)
        const excess = totalRet - cashRate;         // edge over 1y cash (%)
        const beBps = (excess / mod) * 100;         // yield rise that erases the edge (bps)
        return {
          ...g, mod, modH: modDuration(g.ytm, g.N - 1, g.c),
          yRoll, rollBps: rollDown * 100, couponRet, rollRet, totalRet, excess, beBps,
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
                  <td style={cell({ color: '#2dd4bf' })}>{r.rollRet >= 0 ? '+' : ''}{r.rollRet.toFixed(2)}%</td>
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
          <strong style={{ color: '#4ade80' }}> Excess vs cash</strong> = total return − 1y {bench} ({cashRate?.toFixed(2)}%): the price fall the bond can absorb before it loses.
          <strong style={{ color: '#fbbf24' }}> Breakeven</strong> (bps) = Excess ÷ mod. dur. — how far the yield can rise before the bond matches cash. Bigger = more cushion.
        </p>
        <p style={{ fontSize: 11, color: '#475569', margin: '8px 2px 0', lineHeight: 1.4 }}>
          Carry + roll model (no coupon reinvestment). Roll‑down is a full semi‑annual reprice; roll‑to yield interpolated from the govie curve. Breakeven uses today's modified duration; "Mod. dur. @ horizon" (bond 1y shorter) shown for reference. ACT/365, bonds maturing within a year excluded.
        </p>
      </div>
    </div>
  );
}
