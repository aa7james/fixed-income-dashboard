import React, { useMemo, useState, useEffect } from 'react';

// Floater (FRN) comparator.
//
// A floating-rate note pays (benchmark + a fixed spread), resetting each quarter.
// The headline spread is NOT what you actually earn once you pay a price away from
// par: the pull back to 100 at maturity eats (or adds) spread, and it bites hardest
// when there's little time left. The real number is the DISCOUNT MARGIN (DM):
//
//     DM (bps) ≈ quoted spread − (price − 100) / years-left × 100
//
// So a +132 floater bought at 100.33 with 0.5y left earns only ~+62 over the
// benchmark — basically the same as a near-AAA +85 name. This tool makes that
// visible and ranks floaters by DM. DM does NOT adjust for credit risk — a higher
// DM may simply mean riskier paper; that judgement stays with you (jot it in Note).
//
// Floaters live in this browser (localStorage). Seeded with three real examples.

const LS_KEY = 'floaterComparator_v1';
const inp = { background: '#0f172a', border: '1px solid #334155', borderRadius: 6, color: '#e2e8f0', padding: '6px 8px', fontSize: 13, boxSizing: 'border-box' };
const btn = { background: '#334155', border: 'none', borderRadius: 6, color: '#e2e8f0', padding: '6px 10px', fontSize: 12, cursor: 'pointer' };
const card = { background: '#1e293b', border: '1px solid #334155', borderRadius: 12, padding: 16, marginBottom: 24 };
const cell = (extra = {}) => ({ padding: '7px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', ...extra });

const BENCHMARKS = ['3m JIBAR', 'Zaronia'];
const BENCH_KEY = { '3m JIBAR': '3m JIBAR', 'Zaronia': 'Zaronia' };

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

// Discount margin and effective yield for one floater, given today's benchmark rate.
function computeFloater(f, benchRate) {
  const s = Number(f.spread);           // quoted spread, bps
  const P = Number(f.price);            // clean price
  const T = yearsTo(f.maturity);        // years to maturity
  const B = benchRate;                  // today's benchmark, %
  const valid = isFinite(s) && isFinite(P) && P > 0 && T != null && B != null && isFinite(B);
  const coupon = valid ? B + s / 100 : null;                       // resets with the benchmark
  // Premium drag only meaningful with enough time left; below ~2 weeks it blows up.
  const dragBps = (valid && T > 0.04) ? ((P - 100) / T) * 100 : null;
  const dm = (valid && dragBps != null) ? s - dragBps : null;      // effective spread over benchmark
  const effYield = (dm != null && B != null) ? B + dm / 100 : null;
  return { ...f, T, coupon, dragBps, dm, effYield, valid };
}

export default function FloaterComparator({ latest }) {
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

  const set = (id, patch) => setFloaters(list => list.map(f => f.id === id ? { ...f, ...patch } : f));
  const add = () => setFloaters(list => [...list, { id: nid(), name: 'New floater', benchmark: '3m JIBAR', spread: '', price: '100.00', maturity: '', note: '' }]);
  const remove = (id) => setFloaters(list => list.filter(f => f.id !== id));
  const resetSeed = () => setFloaters(SEED.map(s => ({ ...s })));

  const computed = useMemo(
    () => floaters.map(f => computeFloater(f, benchRate(f.benchmark))),
    [floaters, benchOv, latest] // eslint-disable-line
  );
  const ranked = useMemo(
    () => computed.filter(c => c.dm != null).sort((a, b) => b.dm - a.dm),
    [computed]
  );
  const bestDm = ranked.length ? ranked[0].dm : null;

  // Reference: best fixed NCD, expressed as a spread over 3m JIBAR (fixed, bank credit).
  const ref = useMemo(() => {
    if (!latest) return null;
    const j3 = latest['3m JIBAR'] == null ? null : Number(latest['3m JIBAR']);
    const tenors = [3, 6, 9, 12];
    let best = null;
    tenors.forEach(t => { const v = latest[`${t}m Fixed Rate NCD`]; if (v != null && (best == null || Number(v) > best.rate)) best = { t, rate: Number(v) }; });
    const ncd12 = latest['12m Fixed Rate NCD'] == null ? null : Number(latest['12m Fixed Rate NCD']);
    return { j3, best, ncd12, bestSpread: (best && j3 != null) ? Math.round((best.rate - j3) * 100) : null };
  }, [latest]);

  if (!latest) return null;

  const dmColor = (dm) => dm == null ? '#475569' : dm >= 120 ? '#4ade80' : dm >= 80 ? '#fbbf24' : '#f87171';

  return (
    <div style={card}>
      <h3 style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9', margin: '0 0 4px' }}>Floater comparator</h3>
      <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 14px', lineHeight: 1.6 }}>
        A floater pays <strong>benchmark + a fixed spread</strong>, reset quarterly. But what you actually earn is the{' '}
        <strong style={{ color: '#cbd5e1' }}>discount margin</strong> — the quoted spread <em>minus</em> the pull back to par when you pay above 100
        (<code style={{ color: '#94a3b8' }}>DM ≈ spread − (price − 100) / years × 100</code>). Ranked by DM, best first.{' '}
        <strong style={{ color: '#fbbf24' }}>DM ignores credit risk</strong> — a higher DM can just mean riskier paper, so weigh it against the Note.
      </p>

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
              <th style={cell()} title="Effective spread over the benchmark after the pull to par">DM (bps)</th>
              <th style={cell()} title="Benchmark + DM: what you earn if the benchmark holds">Eff. yield</th>
              <th style={{ padding: '6px 8px', textAlign: 'left' }}>Note</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {computed.map(c => {
              const isBest = c.dm != null && c.dm === bestDm;
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
                  <td style={cell({ fontWeight: 700 })}>{c.effYield == null ? '—' : `${c.effYield.toFixed(2)}%`}</td>
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
      </div>

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
        DM is a first-order approximation (ignores the exact coupon schedule, day-count and any bid/offer). Coupon now = today's benchmark + spread,
        so it moves when the benchmark resets — if the SARB cuts, your coupon falls with it. "IBOR Exposed" paper references JIBAR, which is being replaced
        by ZARONIA; check the note's fallback language. Credit, structural subordination and liquidity are not captured here — use the Note column.
      </p>
    </div>
  );
}
