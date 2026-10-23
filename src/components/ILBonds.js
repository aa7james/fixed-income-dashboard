import React, { useMemo, useState } from 'react';

const cell = (x = {}) => ({ padding: '8px 10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', ...x });

// Known-correct real coupons (DB has some wrong, e.g. I2050). Coupons are fixed
// for the life of a bond, so overriding here is safe. Fix at source in the DB too.
const COUPON_FIX = { 'I2050 Bond': 0.025 };
// Instruments whose reference data looks wrong / unverified — flagged in the table.
const SUSPECT = new Set(['I2031 Bond']);

function bondPV(y, n, c) {
  if (n <= 0) return 100;
  const i = y / 200, tp = n * 2, count = Math.ceil(tp - 1e-9);
  let pv = 0;
  for (let k = 1; k <= count; k++) { const t = tp - (count - k); pv += (c / 2) / Math.pow(1 + i, t); }
  return pv + 100 / Math.pow(1 + i, tp);
}
function modDuration(y0, N, c) {
  const h = 0.01;
  return (-((bondPV(y0 + h, N, c) - bondPV(y0 - h, N, c)) / (2 * h)) / bondPV(y0, N, c)) * 100;
}
function priceMove(y0, N, c, dy) { return (bondPV(y0 + dy, N, c) / bondPV(y0, N, c) - 1) * 100; }
function interp(curve, x) {
  if (!curve.length) return null;
  if (x <= curve[0].N) return curve[0].y;
  if (x >= curve[curve.length - 1].N) return curve[curve.length - 1].y;
  for (let i = 1; i < curve.length; i++) {
    if (x <= curve[i].N) { const a = curve[i - 1], b = curve[i]; return a.y + (x - a.N) / (b.N - a.N) * (b.y - a.y); }
  }
  return curve[curve.length - 1].y;
}
// 1y carry + roll total return (%), curve unchanged, no reinvestment.
function carryRoll(y0, yRoll, N, c) {
  const P0 = bondPV(y0, N, c);
  const couponRet = (c / P0) * 100;
  const rollRet = (bondPV(yRoll, N - 1, c) / P0 - 1) * 100;
  return couponRet + rollRet;
}

export default function ILBonds({ data, instruments }) {
  const latest = data?.dataRows?.length ? data.dataRows[data.dataRows.length - 1] : null;
  const allRows = useMemo(() => data?.dataRows || [], [data]);
  const cpiLive = latest && latest['SA CPI'] != null ? Number(latest['SA CPI']) : 4.5;
  const [inflShort, setInflShort] = useState(''); // ≤2y inflation view (blank = live CPI)
  const [inflLong, setInflLong] = useState('');    // 20y+ inflation view (blank = 4.5 SARB mid)
  const sVal = inflShort === '' || isNaN(Number(inflShort)) ? cpiLive : Number(inflShort);
  const lVal = inflLong === '' || isNaN(Number(inflLong)) ? 4.5 : Number(inflLong);
  const [shockBps, setShockBps] = useState('100'); // yield-move shock for the price-risk column (bps)
  const shockBpsN = shockBps === '' || isNaN(Number(shockBps)) ? 100 : Number(shockBps);
  const shockDy = shockBpsN / 100; // in %-points

  const rows = useMemo(() => {
    if (!latest || !instruments?.length) return [];
    const now = new Date();
    const yrs = (d) => (new Date(d) - now) / (1000 * 3600 * 24 * 365);
    const sane = (v) => v != null && Number(v) > 0.2 && Number(v) < 40;
    // expected average inflation over a bond of N years: interpolate short(2y)→long(20y)
    const expInfl = (N) => { const lo = 2, hi = 20; if (N <= lo) return sVal; if (N >= hi) return lVal; return sVal + (N - lo) / (hi - lo) * (lVal - sVal); };

    const nomCurve = instruments
      .filter(i => i.category === 'Government Bonds' && i.maturity_date && sane(latest[i.name]))
      .map(i => ({ N: yrs(i.maturity_date), y: Number(latest[i.name]) })).filter(p => p.N > 0).sort((a, b) => a.N - b.N);

    const ilbs = instruments.filter(i => i.category === 'Inflation Linked' && (COUPON_FIX[i.name] != null || i.coupon != null) && i.maturity_date && sane(latest[i.name]));
    const realCurve = ilbs.map(i => ({ N: yrs(i.maturity_date), y: Number(latest[i.name]) })).filter(p => p.N > 0).sort((a, b) => a.N - b.N);

    const cutoff = new Date(); cutoff.setFullYear(cutoff.getFullYear() - 3);

    return ilbs.map(i => {
      const N = yrs(i.maturity_date);
      const c = (COUPON_FIX[i.name] != null ? COUPON_FIX[i.name] : Number(i.coupon)) * 100;
      const realY = Number(latest[i.name]);
      const nomY = interp(nomCurve, N);
      const breakeven = nomY != null ? nomY - realY : null;
      const expI = expInfl(N);
      const inflEdge = breakeven != null ? expI - breakeven : null;
      // 1y total return: ILB (real carry+roll, grossed up by near-term inflation) vs par nominal.
      const yRollReal = interp(realCurve, N - 1);
      const realTR = carryRoll(realY, yRollReal, N, c);
      const ilbTR = ((1 + realTR / 100) * (1 + sVal / 100) - 1) * 100;
      let nomTR = null, trEdge = null;
      if (nomY != null) {
        const yRollNom = interp(nomCurve, N - 1);
        nomTR = carryRoll(nomY, yRollNom, N, nomY);
        trEdge = ilbTR - nomTR;
      }
      // real-yield 3y percentile (higher = cheaper linker)
      const hist = allRows.filter(r => r.date >= cutoff).map(r => Number(r[i.name])).filter(v => sane(v));
      const pctile = hist.length > 20 ? (hist.filter(v => v <= realY).length / hist.length) * 100 : null;
      return {
        label: i.display_label || i.name, suspect: SUSPECT.has(i.name), maturity: i.maturity_date, N, c, realY, nomY, breakeven, expI, inflEdge,
        realDur: modDuration(realY, N, c), realHit: priceMove(realY, N, c, shockDy),
        nomHit: nomY != null ? priceMove(nomY, N, nomY, shockDy) : null,
        ilbTR, nomTR, trEdge, pctile, histLo: hist.length ? Math.min(...hist) : null, histHi: hist.length ? Math.max(...hist) : null,
      };
    }).filter(r => r.N > 1).sort((a, b) => new Date(a.maturity) - new Date(b.maturity));
  }, [latest, instruments, allRows, sVal, lVal, shockDy]);

  if (!latest) return <div style={{ color: '#64748b' }}>No data available.</div>;

  const inputStyle = { width: 72, fontSize: 13, padding: '5px 8px', borderRadius: 8, border: '1px solid #334155', background: '#1e293b', color: '#e2e8f0', fontVariantNumeric: 'tabular-nums' };

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: '#f1f5f9', margin: 0 }}>SA Inflation‑Linked Bonds — ILB vs Nominal</h2>
        <p style={{ fontSize: 13, color: '#64748b', margin: '2px 0 0' }}>
          Breakeven inflation, a 1‑year total‑return comparison against nominals, and the extra price risk from higher real‑yield duration · as at {latest.dateStr}
        </p>
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: '#94a3b8' }}>Expected average inflation over the bond's life:</span>
        <span style={{ fontSize: 12, color: '#94a3b8' }}>near‑term (≤2y)</span>
        <input type="number" step="0.1" value={inflShort} placeholder={cpiLive.toFixed(1)} onChange={e => setInflShort(e.target.value)} style={inputStyle} />
        <span style={{ fontSize: 12, color: '#94a3b8' }}>%  ·  long‑term (20y+)</span>
        <input type="number" step="0.1" value={inflLong} placeholder="4.5" onChange={e => setInflLong(e.target.value)} style={inputStyle} />
        <span style={{ fontSize: 12, color: '#64748b' }}>% · interpolated by maturity · live CPI {cpiLive.toFixed(1)}%, SARB band 3–6%</span>
        <span style={{ width: 1, height: 18, background: '#334155', margin: '0 2px' }} />
        <span style={{ fontSize: 12, color: '#94a3b8' }}>Price‑risk yield shock</span>
        <input type="number" step="5" value={shockBps} placeholder="100" onChange={e => setShockBps(e.target.value)} style={inputStyle} />
        <span style={{ fontSize: 12, color: '#64748b' }}>bp (last column)</span>
      </div>

      <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 12, padding: 16 }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, color: '#e2e8f0' }}>
            <thead>
              <tr style={{ color: '#64748b', fontSize: 11 }}>
                <th colSpan={3}></th>
                <th colSpan={4} style={{ padding: '2px 8px', textAlign: 'center', borderBottom: '1px solid #334155' }}>Inflation breakeven</th>
                <th colSpan={3} style={{ padding: '2px 8px', textAlign: 'center', borderBottom: '1px solid #334155' }}>1‑year total return (curve unchanged)</th>
                <th colSpan={2} style={{ padding: '2px 8px', textAlign: 'center', borderBottom: '1px solid #334155' }}>Price risk</th>
              </tr>
              <tr style={{ color: '#94a3b8' }}>
                <th style={{ padding: '8px 10px', textAlign: 'left' }}>ILB</th>
                <th style={cell()}>Maturity</th>
                <th style={cell()}>Real yield<br /><span style={{ fontSize: 9, color: '#475569' }}>(3y %ile)</span></th>
                <th style={cell()}>Nominal</th>
                <th style={cell()}>Breakeven</th>
                <th style={cell()}>Exp. infl.</th>
                <th style={cell()}>ILB edge</th>
                <th style={cell()}>ILB</th>
                <th style={cell()}>Nominal</th>
                <th style={cell()}>Edge</th>
                <th style={cell()}>Real dur.</th>
                <th style={cell()}>Price +{shockBpsN}bp</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.label} style={{ borderTop: '1px solid #0f172a' }}>
                  <td style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 600 }}>
                    {r.label} <span style={{ color: '#475569', fontWeight: 400, fontSize: 11 }}>{r.c.toFixed(2)}%</span>
                    {r.suspect && <span title="reference data unverified — check coupon/maturity" style={{ color: '#fbbf24', marginLeft: 4 }}>⚠️</span>}
                  </td>
                  <td style={cell({ color: '#94a3b8' })}>{r.maturity}</td>
                  <td style={cell({ fontWeight: 700 })}>
                    {r.realY.toFixed(2)}%
                    {r.pctile != null && <><br /><span style={{ fontSize: 10, color: r.pctile >= 60 ? '#4ade80' : r.pctile <= 40 ? '#f87171' : '#64748b' }}>{Math.round(r.pctile)}th</span></>}
                  </td>
                  <td style={cell({ color: '#94a3b8' })}>{r.nomY != null ? r.nomY.toFixed(2) + '%' : '—'}</td>
                  <td style={cell({ fontWeight: 700, color: '#38bdf8' })}>{r.breakeven != null ? r.breakeven.toFixed(2) + '%' : '—'}</td>
                  <td style={cell({ color: '#94a3b8' })}>{r.expI.toFixed(2)}%</td>
                  <td style={cell({ fontWeight: 700, color: r.inflEdge == null ? '#475569' : r.inflEdge >= 0 ? '#4ade80' : '#f87171' })}>
                    {r.inflEdge == null ? '—' : `${r.inflEdge >= 0 ? '+' : ''}${r.inflEdge.toFixed(2)}%`}
                  </td>
                  <td style={cell({ color: '#2dd4bf' })}>{r.ilbTR.toFixed(2)}%</td>
                  <td style={cell({ color: '#94a3b8' })}>{r.nomTR != null ? r.nomTR.toFixed(2) + '%' : '—'}</td>
                  <td style={cell({ fontWeight: 700, color: r.trEdge == null ? '#475569' : r.trEdge >= 0 ? '#4ade80' : '#f87171' })}>
                    {r.trEdge == null ? '—' : `${r.trEdge >= 0 ? '+' : ''}${r.trEdge.toFixed(2)}%`}
                  </td>
                  <td style={cell({ fontWeight: 700, color: '#fbbf24' })}>{r.realDur.toFixed(1)}</td>
                  <td style={cell({ color: '#f87171' })}>
                    {r.realHit.toFixed(1)}%{r.nomHit != null && <span style={{ color: '#475569', fontSize: 11 }}> (nom {r.nomHit.toFixed(1)})</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p style={{ fontSize: 12, color: '#cbd5e1', margin: '12px 2px 0', lineHeight: 1.5 }}>
          <strong style={{ color: '#38bdf8' }}>Breakeven</strong> = nominal yield (at the ILB's maturity) − real yield; the market's implied average inflation (plus an inflation‑risk premium, minus a liquidity premium — so it's a hurdle, not a pure forecast).
          <strong style={{ color: '#4ade80' }}> ILB edge</strong> = your expected inflation (maturity‑matched) − breakeven: positive = ILB wins on the inflation call.
          <strong style={{ color: '#2dd4bf' }}> 1‑year total return</strong>: ILB = real carry + roll, grossed up by near‑term inflation; nominal = carry + roll. <strong>Edge</strong> = ILB − nominal over the next year.
          <strong style={{ color: '#fbbf24' }}> Real dur.</strong> & <strong style={{ color: '#f87171' }}>Price +{shockBpsN}bp</strong> shows the <strong>linker's</strong> price change for that rise in its real yield (the comparable nominal bond's change for the same-size move in its nominal yield is in brackets) — linkers run higher because of tiny real coupons. Edit the shock above to model any move.
        </p>
        <p style={{ fontSize: 11, color: '#475569', margin: '8px 2px 0', lineHeight: 1.4 }}>
          Real‑yield <strong>%ile</strong> = where today's real yield sits in its 3‑year range (higher = cheaper linker). Nominal comparison uses a par bond at the ILB's maturity off the govie curve. Semi‑annual, ACT/365, full reprice. ⚠️ = unverified reference data. I2050 coupon corrected to 2.50% in this view (DB still shows 10.50% — fix at source). Caveat: real yields are usually less volatile than nominal yields, so higher duration overstates the realised price‑risk gap.
        </p>
      </div>
    </div>
  );
}
