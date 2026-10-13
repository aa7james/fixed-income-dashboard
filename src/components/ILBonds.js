import React, { useMemo, useState } from 'react';

const cell = (x = {}) => ({ padding: '8px 10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', ...x });

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

// Modified duration (% price change per 1% yield move) via 1bp finite difference.
function modDuration(y0, N, c) {
  const h = 0.01;
  const up = bondPV(y0 + h, N, c), dn = bondPV(y0 - h, N, c), p = bondPV(y0, N, c);
  return (-((up - dn) / (2 * h)) / p) * 100;
}

// Full-reprice price change (%) for a parallel +dy move in yield.
function priceMove(y0, N, c, dy) {
  return (bondPV(y0 + dy, N, c) / bondPV(y0, N, c) - 1) * 100;
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

export default function ILBonds({ data, instruments }) {
  const latest = data?.dataRows?.length ? data.dataRows[data.dataRows.length - 1] : null;
  const cpiLive = latest && latest['SA CPI'] != null ? Number(latest['SA CPI']) : 4.5;
  const [cpiView, setCpiView] = useState(''); // blank = use live SA CPI
  const cpi = cpiView === '' || isNaN(Number(cpiView)) ? cpiLive : Number(cpiView);

  const rows = useMemo(() => {
    if (!latest || !instruments?.length) return [];
    const now = new Date();
    const yrs = (d) => (new Date(d) - now) / (1000 * 3600 * 24 * 365);
    const sane = (v) => v != null && Number(v) > 0.2 && Number(v) < 40;

    // Nominal govie curve for breakeven and comparable duration.
    const nomCurve = instruments
      .filter(i => i.category === 'Government Bonds' && i.maturity_date && sane(latest[i.name]))
      .map(i => ({ N: yrs(i.maturity_date), y: Number(latest[i.name]) }))
      .filter(p => p.N > 0)
      .sort((a, b) => a.N - b.N);

    return instruments
      .filter(i => i.category === 'Inflation Linked' && i.coupon != null && i.maturity_date && sane(latest[i.name]))
      .map(i => {
        const N = yrs(i.maturity_date);
        const c = Number(i.coupon) * 100;        // real coupon
        const realY = Number(latest[i.name]);     // real yield
        const nomY = interp(nomCurve, N);          // comparable nominal at same maturity
        const breakeven = nomY != null ? nomY - realY : null;
        const pickup = breakeven != null ? cpi - breakeven : null; // ILB vs nominal, given CPI view
        return {
          label: i.display_label || i.name, maturity: i.maturity_date, N, c, realY, nomY, breakeven, pickup,
          realDur: modDuration(realY, N, c),
          nomDur: nomY != null ? modDuration(nomY, N, nomY) : null,   // par-nominal at same maturity
          realHit: priceMove(realY, N, c, 1),                         // +100bps real
          nomHit: nomY != null ? priceMove(nomY, N, nomY, 1) : null,  // +100bps nominal
        };
      })
      .filter(r => r.N > 1)
      .sort((a, b) => new Date(a.maturity) - new Date(b.maturity));
  }, [latest, instruments, cpi]);

  if (!latest) return <div style={{ color: '#64748b' }}>No data available.</div>;

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: '#f1f5f9', margin: 0 }}>SA Inflation‑Linked Bonds — ILB vs Nominal</h2>
        <p style={{ fontSize: 13, color: '#64748b', margin: '2px 0 0' }}>
          Breakeven inflation (where an ILB ties the nominal bond) and the extra price risk from higher real‑yield duration · as at {latest.dateStr}
        </p>
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: '#94a3b8' }}>Your expected inflation (CPI):</span>
        <input type="number" step="0.1" value={cpiView} placeholder={cpiLive.toFixed(1)}
          onChange={e => setCpiView(e.target.value)}
          style={{ width: 80, fontSize: 13, padding: '5px 8px', borderRadius: 8, border: '1px solid #334155', background: '#1e293b', color: '#e2e8f0', fontVariantNumeric: 'tabular-nums' }} />
        <span style={{ fontSize: 12, color: '#94a3b8' }}>%</span>
        <span style={{ fontSize: 12, color: '#64748b' }}>
          live SA CPI = <strong style={{ color: '#38bdf8' }}>{cpiLive.toFixed(1)}%</strong> · SARB target band 3–6% (mid 4.5%)
        </span>
      </div>

      <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 12, padding: 16 }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, color: '#e2e8f0' }}>
            <thead>
              <tr style={{ color: '#64748b', fontSize: 11 }}>
                <th colSpan={4}></th>
                <th colSpan={3} style={{ padding: '2px 8px', textAlign: 'center', borderBottom: '1px solid #334155' }}>Inflation breakeven</th>
                <th colSpan={3} style={{ padding: '2px 8px', textAlign: 'center', borderBottom: '1px solid #334155' }}>Price risk (duration)</th>
              </tr>
              <tr style={{ color: '#94a3b8' }}>
                <th style={{ padding: '8px 10px', textAlign: 'left' }}>ILB</th>
                <th style={cell()}>Real coupon</th>
                <th style={cell()}>Maturity</th>
                <th style={cell()}>Real yield</th>
                <th style={cell()}>Nominal (same mat.)</th>
                <th style={cell()}>Breakeven infl.</th>
                <th style={cell()}>ILB vs nominal</th>
                <th style={cell()}>Real mod. dur.</th>
                <th style={cell()}>Nominal mod. dur.</th>
                <th style={cell()}>Price if yields +1%</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.label} style={{ borderTop: '1px solid #0f172a' }}>
                  <td style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 600 }}>{r.label}</td>
                  <td style={cell({ color: '#94a3b8' })}>{r.c.toFixed(2)}%</td>
                  <td style={cell({ color: '#94a3b8' })}>{r.maturity}</td>
                  <td style={cell({ fontWeight: 700 })}>{r.realY.toFixed(2)}%</td>
                  <td style={cell({ color: '#94a3b8' })}>{r.nomY != null ? r.nomY.toFixed(2) + '%' : '—'}</td>
                  <td style={cell({ fontWeight: 700, color: '#38bdf8' })}>{r.breakeven != null ? r.breakeven.toFixed(2) + '%' : '—'}</td>
                  <td style={cell({ fontWeight: 700, color: r.pickup == null ? '#475569' : r.pickup >= 0 ? '#4ade80' : '#f87171' })}>
                    {r.pickup == null ? '—' : `${r.pickup >= 0 ? '+' : ''}${r.pickup.toFixed(2)}%`}
                  </td>
                  <td style={cell({ fontWeight: 700, color: '#fbbf24' })}>{r.realDur.toFixed(1)}</td>
                  <td style={cell({ color: '#94a3b8' })}>{r.nomDur != null ? r.nomDur.toFixed(1) : '—'}</td>
                  <td style={cell({ color: '#f87171' })}>
                    {r.realHit.toFixed(1)}%{r.nomHit != null && <span style={{ color: '#475569', fontSize: 11 }}> (nom {r.nomHit.toFixed(1)}%)</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p style={{ fontSize: 12, color: '#cbd5e1', margin: '12px 2px 0', lineHeight: 1.5 }}>
          <strong style={{ color: '#38bdf8' }}>Breakeven inflation</strong> = nominal yield (at the ILB's maturity) − real yield. The ILB beats the nominal bond only if average inflation over its life exceeds this.
          <strong style={{ color: '#4ade80' }}> ILB vs nominal</strong> = your CPI view ({cpi.toFixed(1)}%) − breakeven: positive (green) = ILB expected to win; negative (red) = nominal wins.
          <strong style={{ color: '#fbbf24' }}> Real mod. dur.</strong> is the ILB's price sensitivity to a 1% move in <em>real</em> yields — larger than the comparable nominal because ILBs carry tiny real coupons, so a yield move hits price harder.
        </p>
        <p style={{ fontSize: 11, color: '#475569', margin: '8px 2px 0', lineHeight: 1.4 }}>
          "Price if yields +1%" is the full‑reprice price change for a +100bps parallel move (ILB on real yields; nominal in brackets on nominal yields). Nominal comparison uses a par bond at the ILB's maturity, interpolated off the govie curve. Semi‑annual, ACT/365. Caveat: real yields are usually <em>less</em> volatile than nominal yields, so higher ILB duration doesn't translate one‑for‑one into higher realised price swings.
        </p>
      </div>
    </div>
  );
}
