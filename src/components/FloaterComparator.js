import React, { useMemo, useState, useEffect } from 'react';

// Floater (FRN) comparator.
//
// A floating-rate note pays (benchmark + a fixed spread), resetting each quarter.
// The headline spread is NOT what you actually earn once you pay a price away from
// par: the pull back to 100 at maturity eats (or adds) spread, and it bites hardest
// when there's little time left. The real hold-to-maturity number is the DISCOUNT
// MARGIN (DM):
//
//     DM (bps) ≈ quoted spread − (price − 100) / years-left × 100
//
// But over a 1-year HOLDING period the coupon itself re-fixes every quarter to the
// new 3m benchmark. Today's coupon is only the first fix. We project each quarterly
// reset on the Zaronia FRA (forward) curve — exactly like the Variable NCDs / MM
// funds elsewhere on this tab — so the coupon drifts with where the market prices
// the short rate (right now: cuts → coupon drifts DOWN). The 1-year return then adds
// the premium pulling toward par over the year.
//
// Floaters live in this browser (localStorage). Seeded with three real examples.

const LS_KEY = 'floaterComparator_v1';
const inp = { background: '#0f172a', border: '1px solid #334155', borderRadius: 6, color: '#e2e8f0', padding: '6px 8px', fontSize: 13, boxSizing: 'border-box' };
const btn = { background: '#334155', border: 'none', borderRadius: 6, color: '#e2e8f0', padding: '6px 10px', fontSize: 12, cursor: 'pointer' };
const card = { background: '#1e293b', border: '1px solid #334155', borderRadius: 12, padding: 16, marginBottom: 24 };
const cell = (extra = {}) => ({ padding: '7px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', ...extra });

const BENCHMARKS = ['3m JIBAR', 'Zaronia'];
const BENCH_KEY = { '3m JIBAR': '3m JIBAR', 'Zaronia': 'Zaronia' };
const HORIZON_M = 12; // return horizon in months

let uid = 1;
const nid = () => `f${Date.now()}_${uid++}`;

// Seeded with the floaters we discussed (prices as at late Oct 2026). Edit freely.
const SEED = [
  { id: 'seed_toy27',  name: 'Toyota FSSA 11/27',  benchmark: '3m JIBAR', spread: '85',  price: '100.30', maturity: '2027-11-06', note: 'Sr unsec · AAA-ish finance arm' },
  { id: 'seed_sto27',  name: 'Stor-Age 04/27',     benchmark: '3m JIBAR', spread: '132', price: '100.33', maturity: '2027-04-18', note: 'Sr unsec · REIT · rating?' },
  { id: 'seed_sto29',  name: 'Stor-Age 04/29',     benchmark: '3m JIBAR', spread: '154', price: '100.86', maturity: '2029-04-18', note: 'Sr unsec · REIT · rating?' },
];

const yearsTo = (dateStr) => {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d)) return null;
  return (d - new Date()) / (365.25 * 24 * 3600 * 1000);
};

// Time-weighted average forward Zaronia over [a,b] months, holding the last forward
// flat past the end of the curve. (Same helper as the scenario comparator.)
function avgOverBlocks(blocks, a, b) {
  let acc = 0, cov = 0, last = null;
  for (const bl of blocks) {
    const s = Math.max(bl.start, a), e = Math.min(bl.end, b);
    if (e > s) { acc += bl.rate * (e - s); cov += (e - s); }
    if (bl.start < b) last = bl.rate;
  }
  if (cov < (b - a) && last != null) { acc += last * ((b - a) - cov); cov = b - a; }
  return cov > 0 ? acc / cov : null;
}

// Discount margin + hold-to-maturity numbers for one floater (benchmark flat).
function computeFloater(f, benchRate) {
  const s = Number(f.spread);
  const P = Number(f.price);
  const T = yearsTo(f.maturity);
  const B = benchRate;
  const valid = isFinite(s) && isFinite(P) && P > 0 && T != null && B != null && isFinite(B);
  const coupon = valid ? B + s / 100 : null;
  const dragBps = (valid && T > 0.04) ? ((P - 100) / T) * 100 : null;
  const dm = (valid && dragBps != null) ? s - dragBps : null;
  return { ...f, T, coupon, dragBps, dm, valid };
}

// Project the quarterly coupon path on the FRA curve, then the 1-year return.
// Each reset = today's benchmark + spread + the FRA-implied move of the 3m rate to
// that quarter's start (move vs today's 3m average forward). Horizon capped at
// maturity for notes that redeem within the year. Then add the premium pulling to par.
function projectFloater(f, J0, avgFwd) {
  const s = Number(f.spread), P = Number(f.price), T = yearsTo(f.maturity);
  if (!isFinite(s) || !isFinite(P) || P <= 0 || T == null || J0 == null) return null;
  const Hm = Math.min(HORIZON_M, Math.max(0, T * 12)); // horizon, months
  if (Hm < 0.5) return null;
  const a0 = avgFwd(0, 3);
  if (a0 == null) return null; // no FRA curve
  const legs = [];
  let growth = 1;
  for (let S = 0; S < Hm - 1e-6; S += 3) {
    const L = Math.min(3, Hm - S); // months this quarter contributes
    let move = 0;
    if (S > 0) { const aS = avgFwd(S, S + 3); if (aS != null) move = aS - a0; }
    const rate = J0 + s / 100 + move; // all-in coupon for this quarter
    growth *= 1 + (rate / 100) * (L / 12);
    legs.push({ startM: S, months: +L.toFixed(2), move: +move.toFixed(3), rate: +rate.toFixed(3) });
  }
  const couponEff = (Math.pow(growth, 12 / Hm) - 1) * 100;
  const heldToMat = Hm >= T * 12 - 1e-6;
  const premPct = -(P - 100) * (Hm / 12) / T;       // price pull over the horizon, %
  const totalGrowth = growth * (1 + premPct / 100);
  const totalEff = (Math.pow(totalGrowth, 12 / Hm) - 1) * 100;
  return { Hm, legs, couponEff, premPct, totalEff, heldToMat };
}

export default function FloaterComparator({ latest, instruments = [], fraOverrides = {} }) {
  const [floaters, setFloaters] = useState(() => {
    try { const s = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); return Array.isArray(s) ? s : SEED; }
    catch { return SEED; }
  });
  useEffect(() => { try { localStorage.setItem(LS_KEY, JSON.stringify(floaters)); } catch { /* ignore */ } }, [floaters]);

  // Benchmark rates: auto-filled from the live data, editable to stress-test.
  const liveBench = (name) => { const v = latest?.[BENCH_KEY[name]]; return v == null ? null : Number(v); };
  const [benchOv, setBenchOv] = useState({});
  const benchRate = (name) => {
    const o = benchOv[name];
    if (o != null && o !== '') return Number(o);
    return liveBench(name);
  };
  const benchDirty = Object.values(benchOv).some(v => v != null && v !== '');

  // Zaronia forward strip (o/n + FRAs), honouring the tab's FRA overrides so a
  // stress-test on the curve above flows straight through to these projections.
  const fraEff = (name) => {
    const o = fraOverrides[name];
    if (o != null && o !== '') return Number(o);
    const v = latest?.[name];
    return v == null ? null : Number(v);
  };
  const fwdBlocks = useMemo(() => {
    if (!latest || !instruments?.length) return [];
    const b = [];
    const on = fraEff('Zaronia');
    if (on != null) b.push({ start: 0, end: 1, rate: on });
    instruments.filter(i => i.category === 'FRAs' && i.name.toLowerCase().includes('zaronia')).forEach(f => {
      const m = f.name.match(/(\d+)[Xx×](\d+)/); const v = fraEff(f.name);
      if (m && v != null) b.push({ start: +m[1], end: +m[2], rate: v });
    });
    return b.sort((x, y) => x.start - y.start);
  }, [latest, instruments, fraOverrides]); // eslint-disable-line
  const avgFwd = (a, b) => avgOverBlocks(fwdBlocks, a, b);
  const hasCurve = fwdBlocks.length > 1;

  const set = (id, patch) => setFloaters(list => list.map(f => f.id === id ? { ...f, ...patch } : f));
  const add = () => setFloaters(list => [...list, { id: nid(), name: 'New floater', benchmark: '3m JIBAR', spread: '', price: '100.00', maturity: '', note: '' }]);
  const remove = (id) => setFloaters(list => list.filter(f => f.id !== id));
  const resetSeed = () => setFloaters(SEED.map(s => ({ ...s })));

  const computed = useMemo(
    () => floaters.map(f => {
      const base = computeFloater(f, benchRate(f.benchmark));
      const proj = projectFloater(f, benchRate(f.benchmark), avgFwd);
      return { ...base, proj };
    }),
    [floaters, benchOv, latest, fwdBlocks] // eslint-disable-line
  );
  const ranked = useMemo(
    () => computed.filter(c => c.dm != null).sort((a, b) => b.dm - a.dm),
    [computed]
  );
  const bestDm = ranked.length ? ranked[0].dm : null;

  // Which way does the curve point over the next year? (coupons drift with it)
  const curveDrift = useMemo(() => {
    if (!hasCurve) return null;
    const a0 = avgFwd(0, 3), a12 = avgOverBlocks(fwdBlocks, 0, 12);
    if (a0 == null || a12 == null) return null;
    const bps = Math.round((a12 - a0) * 100);
    return { bps, dir: bps < -3 ? 'down' : bps > 3 ? 'up' : 'flat' };
  }, [fwdBlocks, hasCurve]); // eslint-disable-line

  // Reference: best fixed NCD, expressed as a spread over 3m JIBAR (fixed, bank credit).
  const ref = useMemo(() => {
    if (!latest) return null;
    const j3 = latest['3m JIBAR'] == null ? null : Number(latest['3m JIBAR']);
    let best = null;
    [3, 6, 9, 12].forEach(t => { const v = latest[`${t}m Fixed Rate NCD`]; if (v != null && (best == null || Number(v) > best.rate)) best = { t, rate: Number(v) }; });
    return { j3, best, bestSpread: (best && j3 != null) ? Math.round((best.rate - j3) * 100) : null };
  }, [latest]);

  const [pathOpen, setPathOpen] = useState(false);

  if (!latest) return null;

  const dmColor = (dm) => dm == null ? '#475569' : dm >= 120 ? '#4ade80' : dm >= 80 ? '#fbbf24' : '#f87171';

  return (
    <div style={card}>
      <h3 style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9', margin: '0 0 4px' }}>Floater comparator</h3>
      <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 12px', lineHeight: 1.6 }}>
        A floater pays <strong>benchmark + a fixed spread</strong>, re-fixed every quarter — so today's coupon is only the first fix.
        <strong style={{ color: '#cbd5e1' }}> DM</strong> is the hold-to-maturity spread after the pull to par
        (<code style={{ color: '#94a3b8' }}>spread − (price − 100)/years × 100</code>).
        <strong style={{ color: '#4ade80' }}> 1y return (FRA)</strong> projects each quarterly reset on the Zaronia forward curve
        and adds the premium pulling to par over the year — the realistic holding return.
        <strong style={{ color: '#fbbf24' }}> Neither adjusts for credit</strong> — weigh against the Note.
      </p>

      {curveDrift && (
        <p style={{ fontSize: 12.5, color: '#cbd5e1', margin: '0 0 14px', lineHeight: 1.5 }}>
          <strong style={{ color: curveDrift.dir === 'down' ? '#4ade80' : curveDrift.dir === 'up' ? '#f87171' : '#94a3b8' }}>
            {curveDrift.dir === 'down' ? `↓ Curve prices cuts (${curveDrift.bps}bps over 12m)` : curveDrift.dir === 'up' ? `↑ Curve prices hikes (+${curveDrift.bps}bps over 12m)` : '→ Curve roughly flat'}
          </strong>{' '}
          — so the projected coupons {curveDrift.dir === 'down' ? 'drift DOWN' : curveDrift.dir === 'up' ? 'drift UP' : 'stay near today\'s'} over the year.
        </p>
      )}

      {/* Benchmark rates (editable) */}
      <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14, padding: '10px 12px', background: '#0f172a', borderRadius: 8 }}>
        <span style={{ fontSize: 12, color: '#94a3b8', fontWeight: 600 }}>Benchmark (today):</span>
        {BENCHMARKS.map(name => {
          const live = liveBench(name);
          const edited = benchOv[name] != null && benchOv[name] !== '';
          return (
            <span key={name} style={{ fontSize: 12, color: '#94a3b8', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              {name}
              <input type="number" step="0.01"
                value={edited ? benchOv[name] : (live != null ? live.toFixed(3) : '')}
                placeholder={live != null ? live.toFixed(3) : 'n/a'}
                onChange={e => setBenchOv(o => ({ ...o, [name]: e.target.value }))}
                style={{ ...inp, width: 76, color: edited ? '#fbbf24' : '#38bdf8', borderColor: edited ? '#fbbf24' : '#334155' }} />
              %
            </span>
          );
        })}
        {benchDirty && (
          <button onClick={() => setBenchOv({})} style={{ ...btn, background: 'transparent', border: '1px solid #f87171', color: '#f87171' }}>↺ Reset</button>
        )}
        {!hasCurve && <span style={{ fontSize: 11, color: '#f87171' }}>No FRA curve loaded — 1y return unavailable.</span>}
      </div>

      {/* Editable floater rows */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, color: '#e2e8f0' }}>
          <thead>
            <tr style={{ color: '#94a3b8' }}>
              <th style={{ padding: '6px 8px', textAlign: 'left' }}>Floater</th>
              <th style={{ padding: '6px 8px', textAlign: 'left' }}>Benchmark</th>
              <th style={cell()}>Spread (bps)</th>
              <th style={cell()}>Price</th>
              <th style={cell()}>Maturity</th>
              <th style={cell()}>Yrs left</th>
              <th style={cell()}>Coupon now</th>
              <th style={cell()} title="Effective spread over the benchmark after the pull to par (hold to maturity)">DM (bps)</th>
              <th style={cell({ color: '#4ade80' })} title="Quarterly resets projected on the FRA curve + premium pulling to par over the year">1y return (FRA)</th>
              <th style={{ padding: '6px 8px', textAlign: 'left' }}>Note</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {computed.map(c => {
              const isBest = c.dm != null && c.dm === bestDm;
              const r1y = c.proj?.totalEff;
              return (
                <tr key={c.id} style={{ borderTop: '1px solid #0f172a', background: isBest ? 'rgba(74,222,128,0.06)' : 'transparent' }}>
                  <td style={{ padding: '5px 8px', textAlign: 'left' }}>
                    <input value={c.name} onChange={e => set(c.id, { name: e.target.value })} style={{ ...inp, width: 150, fontWeight: 600 }} />
                  </td>
                  <td style={{ padding: '5px 8px', textAlign: 'left' }}>
                    <select value={c.benchmark} onChange={e => set(c.id, { benchmark: e.target.value })} style={{ ...inp, width: 110 }}>
                      {BENCHMARKS.map(b => <option key={b} value={b}>{b}</option>)}
                    </select>
                  </td>
                  <td style={cell()}><input type="number" value={c.spread} onChange={e => set(c.id, { spread: e.target.value })} style={{ ...inp, width: 66, textAlign: 'right' }} /></td>
                  <td style={cell()}><input type="number" step="0.01" value={c.price} onChange={e => set(c.id, { price: e.target.value })} style={{ ...inp, width: 76, textAlign: 'right' }} /></td>
                  <td style={cell()}><input type="date" value={c.maturity} onChange={e => set(c.id, { maturity: e.target.value })} style={{ ...inp, width: 140 }} /></td>
                  <td style={cell({ color: '#94a3b8' })}>{c.T == null ? '—' : c.T.toFixed(2)}</td>
                  <td style={cell({ fontWeight: 600 })}>{c.coupon == null ? '—' : `${c.coupon.toFixed(2)}%`}</td>
                  <td style={cell({ fontWeight: 700, color: dmColor(c.dm) })}>{c.dm == null ? '—' : `+${Math.round(c.dm)}`}</td>
                  <td style={cell({ fontWeight: 700, color: r1y == null ? '#475569' : '#4ade80' })}>
                    {r1y == null ? '—' : `${r1y.toFixed(2)}%`}{c.proj && !c.proj.heldToMat ? '' : (c.proj ? '†' : '')}
                  </td>
                  <td style={{ padding: '5px 8px', textAlign: 'left' }}>
                    <input value={c.note || ''} onChange={e => set(c.id, { note: e.target.value })} placeholder="rating / credit" style={{ ...inp, width: 150, color: '#94a3b8' }} />
                  </td>
                  <td style={{ padding: '5px 4px' }}>
                    <button onClick={() => remove(c.id)} title="remove" style={{ ...btn, padding: '4px 8px', background: '#7f1d1d' }}>×</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button onClick={add} style={{ ...btn, background: '#0ea5e9', fontWeight: 700 }}>+ Add floater</button>
        <button onClick={resetSeed} style={btn} title="Restore the three seeded examples">↻ Reset to examples</button>
        {computed.some(c => c.proj && c.proj.heldToMat) && (
          <span style={{ fontSize: 11, color: '#64748b' }}>† matures within the year — return is to maturity, annualised.</span>
        )}
      </div>

      {/* Expandable quarterly coupon path */}
      {hasCurve && (
        <div style={{ marginTop: 14 }}>
          <button onClick={() => setPathOpen(o => !o)} style={{ ...btn, fontWeight: 700 }}>
            {pathOpen ? '▾' : '▸'} 1-year coupon path (FRA curve)
          </button>
          {pathOpen && (
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <p style={{ fontSize: 11.5, color: '#64748b', margin: 0, lineHeight: 1.6 }}>
                Each quarter re-fixes to the benchmark + spread. The move is the FRA-implied shift of the 3m rate to that quarter's start
                (vs today's 3m average forward). Coupons are averaged &amp; compounded to the effective coupon return, then the premium
                pulling to par over the year gives the total. Assumes a constant JIBAR–Zaronia basis (moves come off the Zaronia strip).
              </p>
              {computed.map(c => {
                if (!c.proj) return null;
                return (
                  <div key={c.id} style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: '10px 12px' }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0', marginBottom: 6 }}>{c.name}</div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'stretch', fontSize: 11.5 }}>
                      {c.proj.legs.map((l, i) => (
                        <div key={i} style={{ background: '#1e293b', borderRadius: 6, padding: '6px 10px', minWidth: 96 }}>
                          <div style={{ color: '#64748b', fontSize: 10 }}>Q{i + 1} · mo {l.startM}–{+(l.startM + l.months).toFixed(1)}</div>
                          <div style={{ color: '#38bdf8', fontWeight: 700, fontSize: 14 }}>{l.rate.toFixed(2)}%</div>
                          <div style={{ color: l.move === 0 ? '#475569' : l.move < 0 ? '#4ade80' : '#f87171', fontSize: 10 }}>
                            {i === 0 ? 'current fix' : `${l.move >= 0 ? '+' : ''}${(l.move * 100).toFixed(0)}bps FRA`}
                          </div>
                        </div>
                      ))}
                      <div style={{ background: 'rgba(74,222,128,0.08)', border: '1px solid #14532d', borderRadius: 6, padding: '6px 10px', minWidth: 150 }}>
                        <div style={{ color: '#64748b', fontSize: 10 }}>over {Math.round(c.proj.Hm)} mo{c.proj.heldToMat ? ' (to maturity)' : ''}</div>
                        <div style={{ color: '#cbd5e1', fontSize: 11 }}>coupon {c.proj.couponEff.toFixed(2)}% {c.proj.premPct >= 0 ? '+' : '−'} premium {Math.abs(c.proj.premPct).toFixed(2)}%</div>
                        <div style={{ color: '#4ade80', fontWeight: 700, fontSize: 15 }}>= {c.proj.totalEff.toFixed(2)}% p.a.</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Reference line: best fixed NCD as a spread over JIBAR */}
      {ref?.best && ref.bestSpread != null && (
        <div style={{ marginTop: 14, padding: '10px 12px', background: '#0f172a', borderRadius: 8, fontSize: 12.5, color: '#cbd5e1', lineHeight: 1.6 }}>
          <strong style={{ color: '#94a3b8' }}>Reference —</strong> your best fixed NCD is the{' '}
          <strong>{ref.best.t}m at {ref.best.rate.toFixed(2)}%</strong>, i.e. roughly{' '}
          <strong style={{ color: '#38bdf8' }}>JIBAR + {ref.bestSpread} bps</strong> (fixed, bank credit, more liquid).
          A floater only earns its keep if its <strong>DM clears ~{ref.bestSpread} bps by enough to pay for the extra credit and illiquidity risk.</strong>
          {ranked.length > 0 && bestDm != null && (
            <> On that test, <strong style={{ color: dmColor(bestDm) }}>{ranked[0].name}</strong> (DM +{Math.round(bestDm)}) {bestDm >= ref.bestSpread ? 'clears it' : 'does not clear it'}.</>
          )}
        </div>
      )}

      <p style={{ fontSize: 11, color: '#475569', margin: '12px 0 0', lineHeight: 1.6 }}>
        First-order estimates (ignore exact day-count and any bid/offer). The 1y return rides the Zaronia FRA strip and assumes a constant
        JIBAR–ZARONIA basis; if the SARB path differs, so will the coupons. "IBOR Exposed" paper references JIBAR, which is being replaced
        by ZARONIA — check the note's fallback language. Credit, structural subordination and liquidity are not captured — use the Note column.
      </p>
    </div>
  );
}
