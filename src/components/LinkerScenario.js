import React, { useMemo, useState } from 'react';

// Scenario return comparator: one linker vs one nominal vs one cash/NCD over a
// chosen horizon, with an inflation assumption and a SARB rate shock. Shows each
// instrument's total/annualised return and the inflation hurdle the linker needs
// to beat the other two.

const cell = (x = {}) => ({ padding: '8px 10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', ...x });
const COUPON_FIX = { 'I2050 Bond': 0.025 };

function bondPV(y, n, c) {
  if (n <= 0) return 100;
  const i = y / 200, tp = n * 2, count = Math.ceil(tp - 1e-9);
  let pv = 0;
  for (let k = 1; k <= count; k++) { const t = tp - (count - k); pv += (c / 2) / Math.pow(1 + i, t); }
  return pv + 100 / Math.pow(1 + i, tp);
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

const CASH_TENORS = {
  '3m Fixed Rate NCD': 0.25, '6m Fixed Rate NCD': 0.5, '12m Fixed Rate NCD': 1,
  '2y Fixed Rate NCD': 2, '3y Fixed Rate NCD2': 3,
};
const cashLabel = (n) => n.replace(' Fixed Rate NCD2', ' NCD').replace(' Fixed Rate NCD', ' NCD');

export default function LinkerScenario({ data, instruments }) {
  const latest = data?.dataRows?.length ? data.dataRows[data.dataRows.length - 1] : null;
  const sane = (v) => v != null && Number(v) > 0.2 && Number(v) < 40;

  const { linkers, nominals, cashes, realCurve, nomCurve } = useMemo(() => {
    const now = new Date();
    const yrs = (d) => (new Date(d) - now) / (1000 * 3600 * 24 * 365);
    const linkers = (instruments || [])
      .filter(i => i.category === 'Inflation Linked' && i.maturity_date && sane(latest?.[i.name]) && (COUPON_FIX[i.name] != null || i.coupon != null))
      .map(i => ({ name: i.name, label: i.display_label || i.name, mat: i.maturity_date, N: yrs(i.maturity_date), y: Number(latest[i.name]), c: (COUPON_FIX[i.name] != null ? COUPON_FIX[i.name] : Number(i.coupon)) * 100 }))
      .filter(x => x.N > 0.05).sort((a, b) => a.N - b.N);
    const nominals = (instruments || [])
      .filter(i => i.category === 'Government Bonds' && i.maturity_date && i.coupon != null && sane(latest?.[i.name]))
      .map(i => ({ name: i.name, label: i.display_label || i.name, mat: i.maturity_date, N: yrs(i.maturity_date), y: Number(latest[i.name]), c: Number(i.coupon) * 100 }))
      .filter(x => x.N > 0.05).sort((a, b) => a.N - b.N);
    let fdBps = 5; try { fdBps = Number(localStorage.getItem('fdPremiumBps')) || 5; } catch { /* ignore */ }
    const ncds = Object.entries(CASH_TENORS)
      .filter(([n]) => sane(latest?.[n]))
      .map(([n, T]) => ({ name: n, label: cashLabel(n), T, rate: Number(latest[n]) }));
    // Fixed Deposit = NCD + flat premium (non-negotiable pick-up), shown alongside.
    const fds = ncds.map(c => ({ name: c.name + '_FD', label: c.label.replace(' NCD', ' FD'), T: c.T, rate: +(c.rate + fdBps / 100).toFixed(3) }));
    const cashes = [...ncds, ...fds];
    const realCurve = linkers.map(x => ({ N: x.N, y: x.y }));
    const nomCurve = nominals.map(x => ({ N: x.N, y: x.y }));
    return { linkers, nominals, cashes, realCurve, nomCurve };
  }, [instruments, latest]); // eslint-disable-line react-hooks/exhaustive-deps

  const [horizon, setHorizon] = useState('1.5');
  const [infl, setInfl] = useState('4.5');
  const [shock, setShock] = useState('50');
  const pick = (list, re) => (list.find(x => re.test(x.label) || re.test(x.name)) || list[0] || null);
  const [linkName, setLinkName] = useState('');
  const [nomName, setNomName] = useState('');
  const [cashName, setCashName] = useState('');

  const H = Math.max(0.1, Number(horizon) || 1.5);
  const pi = (Number(infl) || 0) / 100;
  const s = (Number(shock) || 0) / 100; // %-points

  const linker = linkers.find(x => x.name === linkName) || pick(linkers, /R210/);
  const nominal = nominals.find(x => x.name === nomName) || pick(nominals, /R2030/);
  const cash = cashes.find(x => x.name === cashName) || pick(cashes, /2y/);

  // Growth factor (1+total return) over the horizon for each instrument.
  const reinvest = () => cash ? (cash.rate + s) / 100 : 0.08; // post-shock short rate (fraction)
  const linkerGrow = (piX) => {
    if (!linker) return null;
    if (linker.N <= H) {
      return Math.pow((1 + linker.y / 100) * (1 + piX), linker.N) * Math.pow(1 + reinvest(), Math.max(0, H - linker.N));
    }
    const P0 = bondPV(linker.y, linker.N, linker.c);
    const rollReal = interp(realCurve, linker.N - H) + s;
    const PH = bondPV(rollReal, linker.N - H, linker.c);
    const realPriceTR = (PH + linker.c * H - P0) / P0; // real carry + roll + reprice
    return (1 + realPriceTR) * Math.pow(1 + piX, H);
  };
  const nominalGrow = () => {
    if (!nominal) return null;
    if (nominal.N <= H) {
      return Math.pow(1 + nominal.y / 100, nominal.N) * Math.pow(1 + reinvest(), Math.max(0, H - nominal.N));
    }
    const P0 = bondPV(nominal.y, nominal.N, nominal.c);
    const rollY = interp(nomCurve, nominal.N - H) + s;
    const PH = bondPV(rollY, nominal.N - H, nominal.c);
    return (PH + nominal.c * H - P0) / P0 + 1;
  };
  const cashGrow = () => {
    if (!cash) return null;
    if (H <= cash.T) return Math.pow(1 + cash.rate / 100, H);            // locked, hike-proof
    return Math.pow(1 + cash.rate / 100, cash.T) * Math.pow(1 + (cash.rate + s) / 100, H - cash.T);
  };

  const lG = linkerGrow(pi), nG = nominalGrow(), cG = cashGrow();
  const ann = (g) => g == null ? null : (Math.pow(g, 1 / H) - 1) * 100;
  const tot = (g) => g == null ? null : (g - 1) * 100;

  // Inflation hurdle: solve linkerGrow(pi) = targetGrow by bisection.
  const breakeven = (targetGrow) => {
    if (targetGrow == null || !linker) return null;
    let lo = -0.5, hi = 0.5;
    const f = (p) => linkerGrow(p) - targetGrow;
    if (f(lo) > 0) return -Infinity; if (f(hi) < 0) return Infinity;
    for (let k = 0; k < 80; k++) { const m = (lo + hi) / 2; if (f(m) < 0) lo = m; else hi = m; }
    return ((lo + hi) / 2) * 100;
  };
  const beNom = breakeven(nG), beCash = breakeven(cG);

  const inp = { width: 70, fontSize: 13, padding: '5px 8px', borderRadius: 8, border: '1px solid #334155', background: '#1e293b', color: '#e2e8f0', fontVariantNumeric: 'tabular-nums' };
  const sel = { fontSize: 13, padding: '5px 8px', borderRadius: 8, border: '1px solid #334155', background: '#1e293b', color: '#e2e8f0' };
  const rank = [
    linker && { kind: 'Linker', label: linker.label, g: lG, color: '#38bdf8' },
    nominal && { kind: 'Nominal', label: nominal.label, g: nG, color: '#4ade80' },
    cash && { kind: 'Cash', label: cash.label, g: cG, color: '#c4b5fd' },
  ].filter(Boolean).filter(r => r.g != null).sort((a, b) => b.g - a.g);
  const fmt = (v, d = 2) => v == null ? '—' : (!isFinite(v) ? (v > 0 ? '>50' : 'any') : v.toFixed(d));

  if (!latest || !linkers.length) return null;

  return (
    <div style={{ marginTop: 20, background: '#1e293b', border: '1px solid #334155', borderRadius: 12, padding: 16 }}>
      <h3 style={{ fontSize: 16, fontWeight: 700, color: '#f1f5f9', margin: 0 }}>Scenario: linker vs nominal vs cash</h3>
      <p style={{ fontSize: 12, color: '#64748b', margin: '2px 0 12px' }}>
        Pick a horizon, an inflation view and a SARB rate move, then compare a linker, a nominal bond and a cash/NCD over that horizon · as at {latest.dateStr}
      </p>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: '#94a3b8' }}>Horizon</span>
        <input type="number" step="0.25" value={horizon} onChange={e => setHorizon(e.target.value)} style={inp} /><span style={{ fontSize: 12, color: '#64748b' }}>yrs</span>
        <span style={{ fontSize: 12, color: '#94a3b8', marginLeft: 6 }}>Inflation</span>
        <input type="number" step="0.1" value={infl} onChange={e => setInfl(e.target.value)} style={inp} /><span style={{ fontSize: 12, color: '#64748b' }}>%</span>
        <span style={{ fontSize: 12, color: '#94a3b8', marginLeft: 6 }}>SARB move</span>
        <input type="number" step="25" value={shock} onChange={e => setShock(e.target.value)} style={inp} /><span style={{ fontSize: 12, color: '#64748b' }}>bp (by horizon)</span>
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: '#38bdf8' }}>Linker</span>
        <select value={linker?.name || ''} onChange={e => setLinkName(e.target.value)} style={sel}>
          {linkers.map(x => <option key={x.name} value={x.name}>{x.label}</option>)}
        </select>
        <span style={{ fontSize: 12, color: '#4ade80' }}>Nominal</span>
        <select value={nominal?.name || ''} onChange={e => setNomName(e.target.value)} style={sel}>
          {nominals.map(x => <option key={x.name} value={x.name}>{x.label}</option>)}
        </select>
        <span style={{ fontSize: 12, color: '#c4b5fd' }}>Cash</span>
        <select value={cash?.name || ''} onChange={e => setCashName(e.target.value)} style={sel}>
          {cashes.map(x => <option key={x.name} value={x.name}>{x.label} ({x.rate.toFixed(2)}%)</option>)}
        </select>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, color: '#e2e8f0' }}>
        <thead>
          <tr style={{ color: '#94a3b8' }}>
            <th style={{ padding: '6px 10px', textAlign: 'left' }}>#</th>
            <th style={{ padding: '6px 10px', textAlign: 'left' }}>Instrument</th>
            <th style={cell()}>Annualised</th>
            <th style={cell()}>Total over {H}y</th>
            <th style={cell()}>On R1,000,000</th>
          </tr>
        </thead>
        <tbody>
          {rank.map((r, i) => (
            <tr key={r.kind} style={{ borderTop: '1px solid #0f172a', fontWeight: i === 0 ? 700 : 400 }}>
              <td style={{ padding: '6px 10px', textAlign: 'left', color: i === 0 ? '#4ade80' : '#64748b' }}>{i + 1}</td>
              <td style={{ padding: '6px 10px', textAlign: 'left' }}>
                <span style={{ color: r.color, fontWeight: 700 }}>{r.label}</span> <span style={{ color: '#64748b', fontSize: 11 }}>· {r.kind}</span>
              </td>
              <td style={cell({ fontWeight: 700 })}>{fmt(ann(r.g))}%</td>
              <td style={cell()}>{fmt(tot(r.g))}%</td>
              <td style={cell({ color: '#94a3b8' })}>+R{Math.round(tot(r.g) * 10000).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 14 }}>
        <div style={{ flex: '1 1 220px', background: '#0f172a', border: '1px solid #334155', borderRadius: 10, padding: '10px 12px' }}>
          <div style={{ fontSize: 11, color: '#94a3b8' }}>Inflation for {linker?.label} to beat {nominal?.label}</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: pi * 100 >= beNom ? '#4ade80' : '#f87171', fontVariantNumeric: 'tabular-nums' }}>{fmt(beNom)}%</div>
          <div style={{ fontSize: 10, color: '#64748b' }}>your view {(pi * 100).toFixed(1)}% → {pi * 100 >= beNom ? 'linker wins' : 'nominal wins'}</div>
        </div>
        <div style={{ flex: '1 1 220px', background: '#0f172a', border: '1px solid #334155', borderRadius: 10, padding: '10px 12px' }}>
          <div style={{ fontSize: 11, color: '#94a3b8' }}>Inflation for {linker?.label} to beat {cash?.label}</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: pi * 100 >= beCash ? '#4ade80' : '#f87171', fontVariantNumeric: 'tabular-nums' }}>{fmt(beCash)}%</div>
          <div style={{ fontSize: 10, color: '#64748b' }}>your view {(pi * 100).toFixed(1)}% → {pi * 100 >= beCash ? 'linker wins' : 'cash wins'}</div>
        </div>
      </div>

      <p style={{ fontSize: 11, color: '#475569', margin: '12px 2px 0', lineHeight: 1.5 }}>
        Bonds maturing inside the horizon are held to maturity (then the stub sits in cash at the picked rate + shock); longer bonds are repriced at the horizon on the rolled curve plus the SARB move (applied to the bond's yield by the horizon). The linker earns its real yield grossed up by your inflation; cash/NCD is locked at today's fixed rate (a hike doesn't help it unless it matures inside the horizon). Semi-annual, ACT-ish; coupons not reinvested. The <strong>hurdle</strong> cards solve for the inflation that ties the linker with each alternative — above it the linker wins.
      </p>
    </div>
  );
}
