import React, { useMemo, useState, useEffect } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';

// User-built cash scenario comparator: add as many options as you like, each
// built from one or more legs (a "roll" is just an extra leg with the rate you
// expect at that future point). Every option is ranked side by side. Custom
// instruments live in localStorage (this browser only).

const LS_KEY = 'cashCustomInstruments';
const zar = new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', maximumFractionDigits: 0 });

const inp = { background: '#0f172a', border: '1px solid #334155', borderRadius: 6, color: '#e2e8f0', padding: '6px 8px', fontSize: 13, boxSizing: 'border-box' };
const btn = { background: '#334155', border: 'none', borderRadius: 6, color: '#e2e8f0', padding: '6px 10px', fontSize: 12, cursor: 'pointer' };
const card = { background: '#1e293b', border: '1px solid #334155', borderRadius: 12, padding: 16, marginBottom: 24 };

// Money-market simple interest per leg, compounded across legs.
function evalOption(legs) {
  let growth = 1, months = 0;
  const steps = [];
  for (const leg of legs) {
    const r = Number(leg.rate) || 0, m = Number(leg.months) || 0;
    const g = 1 + (r / 100) * (m / 12);
    growth *= g; months += m;
    steps.push({ r, m });
  }
  const annualised = months > 0 ? (Math.pow(growth, 12 / months) - 1) * 100 : 0;
  return { growth, months, annualised, steps };
}

const COLORS = ['#38bdf8', '#4ade80', '#fbbf24', '#a78bfa', '#f87171', '#2dd4bf', '#f472b6', '#fb923c'];

// Value of an option (base = amount) at a given month: simple interest within
// each leg, reinvested (compounded) at each roll.
function optionValue(legs, month, base) {
  let bal = base, elapsed = 0;
  for (const leg of legs) {
    const len = Number(leg.months) || 0, rate = Number(leg.rate) || 0;
    if (month <= elapsed) return bal;
    const within = Math.min(month - elapsed, len);
    if (within < len) return bal * (1 + (rate / 100) * (within / 12));
    bal *= (1 + (rate / 100) * (len / 12));
    elapsed += len;
  }
  return bal;
}

// Time-weighted average forward Zaronia over [a,b], holding the last forward flat past the curve.
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

// Every ordered way to reach 12 months using 3/6/9/12-month legs.
function compositions(target, parts) {
  const out = [];
  const rec = (rem, acc) => {
    if (rem === 0) { out.push(acc.slice()); return; }
    for (const p of parts) if (p <= rem) rec(rem - p, [...acc, p]);
  };
  rec(target, []);
  return out;
}
const COMPS = compositions(12, [3, 6, 9, 12]);

// All ways to assign an instrument (NCD or T-Bill) to each of n legs.
function instrumentVectors(n) {
  let out = [[]];
  for (let i = 0; i < n; i++) {
    const next = [];
    for (const v of out) { next.push([...v, 'NCD']); next.push([...v, 'T-Bill']); }
    out = next;
  }
  return out;
}

let uid = 1;
const nid = () => `o${Date.now()}_${uid++}`;

export default function CashScenario({ latest, instruments, markers }) {
  const [custom, setCustom] = useState(() => {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch { return []; }
  });
  useEffect(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(custom)); } catch { /* ignore */ }
  }, [custom]);

  // Instrument menu with today's rates.
  const menu = useMemo(() => {
    const items = [];
    const push = (label, key, months) => { const v = latest?.[key]; if (v != null) items.push({ label, rate: +Number(v).toFixed(3), months }); };
    const mk = (label, mLabel, months) => { const m = (markers || []).find(x => (x.label || '').toLowerCase() === mLabel.toLowerCase()); if (m) items.push({ label, rate: +Number(m.value).toFixed(3), months }); };
    mk('Call', 'Call', 1); mk('Money Market', 'MM', 1);
    [3, 6, 9, 12].forEach(t => push(`${t}m T-Bill`, `${t}m T-Bill`, t));
    [3, 6, 9, 12].forEach(t => push(`${t}m Fixed NCD`, `${t}m Fixed Rate NCD`, t));
    [3, 6, 9, 12].forEach(t => push(`${t}m JIBAR`, `${t}m JIBAR`, t));
    // Variable NCDs: all-in = Zaronia + spread
    const on = latest?.['Zaronia'];
    (instruments || []).filter(i => i.category === 'Variable Rate NCDs' && i.name.toLowerCase().includes('zaronia')).forEach(i => {
      const sp = latest?.[i.name]; const tenor = (i.name.match(/^(\d+)m/) || [])[1];
      if (on != null && sp != null && tenor) items.push({ label: `${tenor}m Variable NCD`, rate: +(Number(on) + Number(sp) / 100).toFixed(3), months: Number(tenor) });
    });
    // short-dated bonds (<=1yr) as cash
    const now = new Date();
    (instruments || []).filter(i => ['Government Bonds', 'SOE / Corporate Bonds', 'International'].includes(i.category) && i.maturity_date).forEach(i => {
      const months = (new Date(i.maturity_date) - now) / (1000 * 60 * 60 * 24 * 30.44);
      const v = latest?.[i.name];
      if (months > 0 && months <= 12 && v != null) items.push({ label: `${i.display_label || i.name} (bond)`, rate: +Number(v).toFixed(3), months: Math.max(1, Math.round(months)) });
    });
    custom.forEach(c => items.push({ label: `★ ${c.label}`, rate: Number(c.rate), months: Number(c.months) }));
    return items;
  }, [latest, instruments, markers, custom]);

  const findMenu = (label) => menu.find(m => m.label === label);

  // Zaronia forward blocks + average-forward helper (for FRA-implied assumptions).
  const fwdBlocks = useMemo(() => {
    if (!latest || !instruments?.length) return [];
    const b = [];
    if (latest['Zaronia'] != null) b.push({ start: 0, end: 1, rate: Number(latest['Zaronia']) });
    instruments.filter(i => i.category === 'FRAs' && i.name.toLowerCase().includes('zaronia')).forEach(f => {
      const m = f.name.match(/(\d+)[Xx×](\d+)/); const v = latest[f.name];
      if (m && v != null) b.push({ start: +m[1], end: +m[2], rate: Number(v) });
    });
    return b.sort((x, y) => x.start - y.start);
  }, [latest, instruments]);
  const avgFwd = (a, b) => avgOverBlocks(fwdBlocks, a, b);

  const [amount, setAmount] = useState(1000000);
  const [scenInstrument, setScenInstrument] = useState('All'); // 'NCD' | 'T-Bill' | 'All' (all mixes)

  // Build ladders. Each leg's rate = today's rate for that instrument+tenor + how much
  // the FRA curve rises to that start month (forward move) — NOT the raw FRA rate.
  // 'All' includes every T-Bill/NCD mix per leg; 'NCD'/'T-Bill' keep legs pure.
  const generated = useMemo(() => {
    if (!latest) return [];
    const spotKey = (instr, T) => instr === 'NCD' ? `${T}m Fixed Rate NCD` : `${T}m T-Bill`;
    const menuLabel = (instr, T) => instr === 'NCD' ? `${T}m Fixed NCD` : `${T}m T-Bill`;
    const spot = (instr, T) => { const v = latest[spotKey(instr, T)]; return v == null ? null : Number(v); };
    const out = [];
    COMPS.forEach(parts => {
      const vectors = scenInstrument === 'NCD' ? [parts.map(() => 'NCD')]
        : scenInstrument === 'T-Bill' ? [parts.map(() => 'T-Bill')]
          : instrumentVectors(parts.length);
      vectors.forEach(vec => {
        let S = 0; const legs = []; let ok = true;
        parts.forEach((T, idx) => {
          const instr = vec[idx];
          const s = spot(instr, T); if (s == null) { ok = false; return; }
          const a0 = avgFwd(0, T), aS = avgFwd(S, S + T);
          const move = (S > 0 && a0 != null && aS != null) ? (aS - a0) : 0;
          legs.push({ label: menuLabel(instr, T), months: T, rate: +(s + move).toFixed(3), _spot: +s.toFixed(3), _move: +move.toFixed(3), _a0: a0 != null ? +a0.toFixed(2) : null, _aS: aS != null ? +aS.toFixed(2) : null });
          S += T;
        });
        if (!ok) return;
        const name = parts.map((T, idx) => `${vec[idx] === 'NCD' ? 'NCD' : 'TB'} ${T}m`).join(' → ');
        out.push({ id: `gen_${parts.join('_')}_${vec.map(v => v === 'NCD' ? 'N' : 'T').join('')}`, name, legs });
      });
    });
    return out;
  }, [latest, fwdBlocks, scenInstrument]); // eslint-disable-line

  // Load the generated scenarios; reset whenever the data date or instrument changes.
  const [options, setOptions] = useState([]);
  const [loadedSig, setLoadedSig] = useState('');
  const sig = `${scenInstrument}|${latest?.dateStr || ''}`;
  useEffect(() => {
    if (generated.length && sig !== loadedSig) { setOptions(generated); setLoadedSig(sig); }
  }, [generated, sig, loadedSig]);

  const setOption = (id, patch) => setOptions(opts => opts.map(o => o.id === id ? { ...o, ...patch } : o));
  const updateLeg = (id, idx, patch) => setOptions(opts => opts.map(o => o.id === id ? { ...o, legs: o.legs.map((l, i) => i === idx ? { ...l, ...patch } : l) } : o));
  const pickInstrument = (id, idx, label) => { const m = findMenu(label); updateLeg(id, idx, m ? { label, rate: m.rate, months: m.months } : { label }); };
  const addLeg = (id) => setOptions(opts => opts.map(o => o.id === id ? { ...o, legs: [...o.legs, { label: menu[0]?.label || '', months: 6, rate: menu[0]?.rate || 0 }] } : o));
  const removeLeg = (id, idx) => setOptions(opts => opts.map(o => o.id === id ? { ...o, legs: o.legs.filter((_, i) => i !== idx) } : o));
  const addOption = () => setOptions(opts => [...opts, { id: nid(), name: `Option ${opts.length + 1}`, legs: [{ label: menu[0]?.label || '', months: 12, rate: menu[0]?.rate || 0 }] }]);
  const removeOption = (id) => setOptions(opts => opts.filter(o => o.id !== id));

  const results = useMemo(() => options.map(o => {
    const ev = evalOption(o.legs);
    return { ...o, ev, maturity: amount * ev.growth, interest: amount * ev.growth - amount };
  }), [options, amount]);

  // Value-over-time points for every option, at monthly steps to the longest horizon.
  const chartData = useMemo(() => {
    const totals = options.map(o => o.legs.reduce((a, l) => a + (Number(l.months) || 0), 0));
    const maxT = Math.max(1, ...totals);
    const rows = [];
    for (let m = 0; m <= maxT; m++) {
      const row = { month: m };
      options.forEach((o, i) => { row['v' + i] = m <= totals[i] ? +optionValue(o.legs, m, amount).toFixed(2) : null; });
      rows.push(row);
    }
    return rows;
  }, [options, amount]);

  // Months at which each option rolls (leg boundaries, excluding start and maturity).
  const rollSets = useMemo(() => options.map(o => {
    const rolls = new Set();
    let acc = 0;
    for (let k = 0; k < o.legs.length - 1; k++) { acc += Number(o.legs[k].months) || 0; rolls.add(acc); }
    return rolls;
  }), [options]);

  const renderTip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    return (
      <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, padding: '8px 12px' }}>
        <p style={{ color: '#94a3b8', fontSize: 11, margin: '0 0 4px' }}>Month {label}</p>
        {payload.filter(p => p.value != null).map(p => (
          <p key={p.dataKey} style={{ color: p.color, fontSize: 12, margin: '2px 0' }}>
            {p.name}: <strong>{zar.format(p.value)}</strong> ({((p.value / amount - 1) * 100).toFixed(2)}%)
          </p>
        ))}
      </div>
    );
  };

  const bestId = useMemo(() => {
    if (!results.length) return null;
    return results.reduce((a, b) => b.ev.annualised > a.ev.annualised ? b : a).id;
  }, [results]);

  const ranked = useMemo(() => [...results].sort((a, b) => b.ev.annualised - a.ev.annualised), [results]);
  const horizons = new Set(results.map(r => r.ev.months));
  const mixedHorizons = horizons.size > 1;

  const [methodOpen, setMethodOpen] = useState(false);        // methodology reference collapsed by default
  // Live worked example (2nd 6m T-Bill leg) so the reference always matches the data.
  const methodEg = useMemo(() => {
    if (!latest) return null;
    const num = k => latest[k] == null ? null : Number(latest[k]);
    const tb6 = num('6m T-Bill'), on = num('Zaronia'), f12 = num('FRA 1x2 - Zaronia'),
      f23 = num('FRA 2x3 - Zaronia'), f36 = num('FRA 3X6 - Zaronia'),
      f69 = num('FRA 6X9 - Zaronia'), f912 = num('FRA 9X12 - Zaronia');
    const a0 = avgFwd(0, 6), aS = avgFwd(6, 12);
    if ([tb6, on, f12, f23, f36, f69, f912, a0, aS].some(x => x == null)) return null;
    return { tb6, on, f12, f23, f36, f69, f912, a0, aS, move: aS - a0, rate: tb6 + (aS - a0) };
  }, [latest, fwdBlocks]); // eslint-disable-line

  const [cardsOpen, setCardsOpen] = useState(false);         // option cards collapsed by default
  const [filterMode, setFilterMode] = useState('topN');       // 'topN' | 'minYield' | 'all'
  const [topN, setTopN] = useState(10);
  const [minYield, setMinYield] = useState(7.8);
  const visibleIds = useMemo(() => {
    let sel;
    if (filterMode === 'topN') sel = ranked.slice(0, Math.max(1, topN));
    else if (filterMode === 'minYield') sel = ranked.filter(r => r.ev.annualised >= minYield);
    else sel = ranked;
    return new Set(sel.map(r => r.id));
  }, [ranked, filterMode, topN, minYield]);

  // custom instrument form
  const [cName, setCName] = useState(''); const [cRate, setCRate] = useState(''); const [cMonths, setCMonths] = useState('');
  const addCustom = () => {
    if (!cName || cRate === '' || cMonths === '') return;
    setCustom(c => [...c, { id: Date.now(), label: cName, rate: Number(cRate), months: Number(cMonths) }]);
    setCName(''); setCRate(''); setCMonths('');
  };

  const formula = (ev) => ev.steps.map(s => `(1 + ${s.r.toFixed(2)}% × ${s.m}/12)`).join(' × ');

  if (!latest) return null;

  return (
    <div style={card}>
      <h3 style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9', margin: '0 0 4px' }}>Scenario comparator</h3>
      <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 14px' }}>
        Every roll-to-12-month ladder, including all T-Bill/NCD mixes per leg ("All" ≈ 54 paths; "NCD"/"T-Bill" keep legs pure). Each leg = today's rate for that instrument+tenor <strong>+ how much the FRA curve rises to that point</strong> (shown under each roll leg). Rates refresh with the data. Edit anything, or "+ Add option" to build your own.
      </p>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
        <label style={{ fontSize: 12, color: '#94a3b8' }}>Amount invested (R)</label>
        <input type="number" value={amount} onChange={e => setAmount(Number(e.target.value) || 0)} style={{ ...inp, width: 160 }} />
        <span style={{ fontSize: 12, color: '#94a3b8', marginLeft: 12 }}>Scenarios:</span>
        {['NCD', 'T-Bill', 'All'].map(x => (
          <button key={x} onClick={() => setScenInstrument(x)}
            style={{ ...btn, background: scenInstrument === x ? '#0ea5e9' : '#1e293b', color: scenInstrument === x ? '#fff' : '#94a3b8', fontWeight: scenInstrument === x ? 700 : 400 }}>{x}</button>
        ))}
        <button onClick={() => { setOptions(generated); }} style={btn} title="Reset to the live FRA-implied ladders">↻ Reset</button>
      </div>

      {/* option cards (collapsible) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <button onClick={() => setCardsOpen(o => !o)} style={{ ...btn, fontWeight: 700 }}>
          {cardsOpen ? '▾' : '▸'} Options ({results.length})
        </button>
        <span style={{ fontSize: 11, color: '#64748b' }}>{cardsOpen ? 'click to minimise' : 'click to expand & edit'}</span>
      </div>
      {cardsOpen && (<>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {results.map((o) => {
          const isBest = o.id === bestId;
          return (
            <div key={o.id} style={{ flex: '1 1 300px', minWidth: 280, background: '#0f172a', border: `1px solid ${isBest ? '#4ade80' : '#334155'}`, borderRadius: 10, padding: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 8 }}>
                <input value={o.name} onChange={e => setOption(o.id, { name: e.target.value })}
                  style={{ ...inp, flex: 1, fontWeight: 700, fontSize: 14, border: 'none', background: 'transparent', padding: 0, color: isBest ? '#4ade80' : '#f1f5f9' }} />
                {results.length > 1 && <button onClick={() => removeOption(o.id)} title="remove option" style={{ ...btn, padding: '4px 8px', background: '#7f1d1d' }}>×</button>}
              </div>
              {o.legs.map((leg, i) => {
                const showNote = i > 0 && leg._move != null && leg._spot != null &&
                  Math.abs(Number(leg.rate) - (leg._spot + leg._move)) < 0.005;
                return (
                  <div key={i}>
                    <div style={{ display: 'flex', gap: 6, marginBottom: showNote ? 1 : 6, alignItems: 'center' }}>
                      <span style={{ fontSize: 10, color: '#475569', width: 40, flex: '0 0 40px' }}>{i === 0 ? 'Buy' : 'then'}</span>
                      <select value={leg.label} onChange={e => pickInstrument(o.id, i, e.target.value)} style={{ ...inp, flex: 2, minWidth: 0 }}>
                        {menu.map((m, k) => <option key={k} value={m.label}>{m.label}</option>)}
                      </select>
                      <input type="number" value={leg.months} onChange={e => updateLeg(o.id, i, { months: e.target.value })} title="months" style={{ ...inp, width: 52, flex: '0 0 52px' }} />
                      <input type="number" step="0.01" value={leg.rate} onChange={e => updateLeg(o.id, i, { rate: e.target.value })} title="rate %" style={{ ...inp, width: 64, flex: '0 0 64px' }} />
                      {o.legs.length > 1 && <button onClick={() => removeLeg(o.id, i)} style={{ ...btn, padding: '4px 7px', background: '#7f1d1d' }}>×</button>}
                    </div>
                    {showNote && (
                      <div style={{ fontSize: 10, color: '#64748b', margin: '0 0 6px 46px' }}>
                        = {leg._spot.toFixed(2)}% + {(leg._move * 100).toFixed(0)}bps
                        {leg._a0 != null && leg._aS != null ? ` · fwd ${leg.months}m FRA ${leg._a0.toFixed(2)}→${leg._aS.toFixed(2)}%` : ''}
                      </div>
                    )}
                  </div>
                );
              })}
              <div style={{ marginTop: 4, marginBottom: 12 }}>
                <button onClick={() => addLeg(o.id)} style={btn}>+ Add roll / leg</button>
                <span style={{ fontSize: 10, color: '#475569', marginLeft: 8 }}>instrument · months · rate %</span>
              </div>
              <div style={{ borderTop: '1px solid #1e293b', paddingTop: 10, fontSize: 12, color: '#94a3b8', lineHeight: 1.7 }}>
                <div style={{ color: '#64748b', fontFamily: 'monospace', fontSize: 10.5, wordBreak: 'break-word' }}>
                  {zar.format(amount)} × {formula(o.ev)}
                </div>
                <div>= <strong style={{ color: '#e2e8f0' }}>{zar.format(o.maturity)}</strong> over {o.ev.months} mo</div>
                <div>Interest: <strong style={{ color: isBest ? '#4ade80' : '#e2e8f0' }}>{zar.format(o.interest)}</strong></div>
                <div>Effective: <strong style={{ color: isBest ? '#4ade80' : '#e2e8f0' }}>{o.ev.annualised.toFixed(2)}% p.a.</strong></div>
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 12 }}>
        <button onClick={addOption} style={{ ...btn, background: '#0ea5e9', fontWeight: 700 }}>+ Add option</button>
      </div>
      </>)}

      {/* value over time of each option you've built */}
      {chartData.length > 1 && (
        <div style={{ marginTop: 16, padding: 12, background: '#0f172a', borderRadius: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#cbd5e1', marginBottom: 2 }}>Value over time</div>
          <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8 }}>
            {zar.format(amount)} growing under each option. Roll legs show as kinks; hover a line for its name and value.
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
            <span style={{ fontSize: 12, color: '#94a3b8' }}>Show:</span>
            {[['topN', 'Top N'], ['minYield', 'Yield ≥'], ['all', 'All']].map(([m, lbl]) => (
              <button key={m} onClick={() => setFilterMode(m)}
                style={{ ...btn, background: filterMode === m ? '#0ea5e9' : '#1e293b', color: filterMode === m ? '#fff' : '#94a3b8', fontWeight: filterMode === m ? 700 : 400 }}>{lbl}</button>
            ))}
            {filterMode === 'topN' && <input type="number" value={topN} onChange={e => setTopN(Number(e.target.value) || 1)} style={{ ...inp, width: 60 }} />}
            {filterMode === 'minYield' && <>
              <input type="number" step="0.05" value={minYield} onChange={e => setMinYield(Number(e.target.value) || 0)} style={{ ...inp, width: 72 }} />
              <span style={{ fontSize: 12, color: '#64748b' }}>% p.a.</span>
            </>}
            <span style={{ fontSize: 11, color: '#64748b' }}>showing {visibleIds.size} of {results.length}</span>
          </div>
          <ResponsiveContainer width="100%" height={480}>
            <LineChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="month" tick={{ fill: '#64748b', fontSize: 10 }} tickFormatter={m => `${m}m`} />
              <YAxis domain={['dataMin', 'dataMax']} tick={{ fill: '#64748b', fontSize: 10 }} width={64}
                allowDecimals={false} tickFormatter={v => `R${(v / 1000).toFixed(1)}k`} />
              <Tooltip content={renderTip} />
              {options.map((o, i) => {
                if (!visibleIds.has(o.id)) return null;
                const color = COLORS[i % COLORS.length];
                const rollDot = (props) => {
                  const { cx, cy, payload, index } = props;
                  if (payload && cx != null && cy != null && rollSets[i]?.has(payload.month)) {
                    return <circle key={`r${i}-${index}`} cx={cx} cy={cy} r={4.5} fill={color} stroke="#0f172a" strokeWidth={1.5} />;
                  }
                  return <g key={`r${i}-${index}`} />;
                };
                return (
                  <Line key={o.id} type="monotone" dataKey={'v' + i} name={o.name}
                    stroke={color} strokeWidth={2} dot={rollDot} activeDot={{ r: 4 }} connectNulls={false} isAnimationActive={false} />
                );
              })}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ranked summary */}
      {results.length > 1 && (
        <div style={{ marginTop: 16, padding: 12, background: '#0f172a', borderRadius: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#cbd5e1', marginBottom: 8 }}>Ranking (best first)</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, color: '#e2e8f0' }}>
            <thead>
              <tr style={{ color: '#94a3b8' }}>
                <th style={{ padding: '6px 8px', textAlign: 'left' }}>#</th>
                <th style={{ padding: '6px 8px', textAlign: 'left' }}>Option</th>
                <th style={{ padding: '6px 8px', textAlign: 'right' }}>Horizon</th>
                <th style={{ padding: '6px 8px', textAlign: 'right' }}>Interest</th>
                <th style={{ padding: '6px 8px', textAlign: 'right' }}>Effective % p.a.</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((r, i) => (
                <tr key={r.id} style={{ borderTop: '1px solid #1e293b', color: i === 0 ? '#4ade80' : '#e2e8f0', fontWeight: i === 0 ? 700 : 400 }}>
                  <td style={{ padding: '6px 8px', textAlign: 'left' }}>{i + 1}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'left' }}>{r.name}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.ev.months} mo</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{zar.format(r.interest)}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.ev.annualised.toFixed(2)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          {mixedHorizons && (
            <p style={{ fontSize: 12, color: '#fbbf24', margin: '8px 0 0' }}>
              ⚠ Options cover different horizons — the ranking uses "Effective % p.a." so they're comparable. The rand interest is over each option's own horizon.
            </p>
          )}
          <p style={{ fontSize: 11, color: '#475569', margin: '8px 0 0' }}>
            Money-market simple interest per leg, compounded across legs. Ignores day-count precision, tax and any bid/offer.
          </p>
        </div>
      )}

      {/* custom instruments */}
      <div style={{ marginTop: 18, borderTop: '1px solid #334155', paddingTop: 14 }}>
        <h4 style={{ fontSize: 13, fontWeight: 700, color: '#cbd5e1', margin: '0 0 4px' }}>Add your own instrument</h4>
        <p style={{ fontSize: 11, color: '#64748b', margin: '0 0 10px' }}>e.g. something you found on Bloomberg. Saved in this browser; appears in the dropdowns with a ★.</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input placeholder="Name (e.g. XYZ corporate paper)" value={cName} onChange={e => setCName(e.target.value)} style={{ ...inp, width: 220 }} />
          <input type="number" step="0.01" placeholder="Rate %" value={cRate} onChange={e => setCRate(e.target.value)} style={{ ...inp, width: 90 }} />
          <input type="number" placeholder="Months" value={cMonths} onChange={e => setCMonths(e.target.value)} style={{ ...inp, width: 90 }} />
          <button onClick={addCustom} style={{ ...btn, background: '#0ea5e9' }}>Add</button>
        </div>
        {custom.length > 0 && (
          <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {custom.map(c => (
              <span key={c.id} style={{ fontSize: 12, background: '#0f172a', border: '1px solid #334155', borderRadius: 999, padding: '4px 10px', color: '#cbd5e1' }}>
                ★ {c.label}: {Number(c.rate).toFixed(2)}% · {c.months}m
                <button onClick={() => setCustom(list => list.filter(x => x.id !== c.id))} style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', marginLeft: 6, fontSize: 13 }}>×</button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* methodology reference */}
      <div style={{ marginTop: 18, borderTop: '1px solid #334155', paddingTop: 14 }}>
        <button onClick={() => setMethodOpen(o => !o)} style={{ ...btn, fontWeight: 700 }}>
          {methodOpen ? '▾' : '▸'} How the forward (roll) rate is calculated
        </button>
        {methodOpen && (
          <div style={{ marginTop: 12, fontSize: 13, color: '#cbd5e1', lineHeight: 1.6 }}>
            <p style={{ margin: '0 0 10px' }}>
              A roll leg's rate = <strong>today's rate for that instrument+tenor + how much the FRA curve says that rate rises to the leg's start</strong>. It's a no-arbitrage <em>break-even</em>, not a forecast — realised rates often come in a little lower (term premium).
            </p>
            <p style={{ margin: '0 0 6px', color: '#94a3b8' }}><strong>General rule</strong> — for a leg of tenor T starting at month S:</p>
            <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: '10px 12px', fontFamily: 'monospace', fontSize: 12, color: '#e2e8f0', margin: '0 0 4px' }}>
              leg rate = today's rate(T) + [ avgFRA(S → S+T) − avgFRA(0 → T) ]
            </div>
            <p style={{ margin: '0 0 12px', fontSize: 11, color: '#64748b' }}>
              where avgFRA(a → b) = each FRA block's rate × its number of months, summed across the window, ÷ the window length (time-weighted average of the Zaronia forward strip).
            </p>

            {methodEg && (
              <>
                <p style={{ margin: '0 0 6px', color: '#94a3b8' }}><strong>Worked example (live)</strong> — 2nd leg of a 6m → 6m T-Bill roll:</p>
                <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: '10px 12px', fontFamily: 'monospace', fontSize: 11.5, color: '#e2e8f0', lineHeight: 1.8, wordBreak: 'break-word' }}>
                  <div style={{ color: '#64748b' }}>Step 1 — today's FRA 6m rate (months 0–6):</div>
                  <div>(Zaronia×1 + 1x2×1 + 2x3×1 + 3x6×3) ÷ 6</div>
                  <div>= ({methodEg.on} + {methodEg.f12} + {methodEg.f23} + {methodEg.f36}×3) ÷ 6 = <strong style={{ color: '#38bdf8' }}>{methodEg.a0.toFixed(3)}%</strong></div>
                  <div style={{ color: '#64748b', marginTop: 8 }}>Step 2 — FRA 6m rate in 6 months (months 6–12):</div>
                  <div>(6x9×3 + 9x12×3) ÷ 6</div>
                  <div>= ({methodEg.f69}×3 + {methodEg.f912}×3) ÷ 6 = <strong style={{ color: '#38bdf8' }}>{methodEg.aS.toFixed(3)}%</strong></div>
                  <div style={{ color: '#64748b', marginTop: 8 }}>Step 3 — forward move = Step 2 − Step 1:</div>
                  <div>= {methodEg.aS.toFixed(3)} − {methodEg.a0.toFixed(3)} = <strong style={{ color: '#fbbf24' }}>{methodEg.move >= 0 ? '+' : ''}{(methodEg.move).toFixed(3)}% ({(methodEg.move * 100).toFixed(0)}bps)</strong></div>
                  <div style={{ color: '#64748b', marginTop: 8 }}>Step 4 — assumed 2nd 6m T-Bill = today's 6m T-Bill + move:</div>
                  <div>= {methodEg.tb6.toFixed(2)} + {(methodEg.move).toFixed(3)} = <strong style={{ color: '#4ade80' }}>{methodEg.rate.toFixed(3)}%</strong></div>
                </div>
                <p style={{ margin: '8px 0 0', fontSize: 11, color: '#64748b' }}>
                  Values above are today's live FRA strip + 6m T-Bill, so this always matches the tool. As at {latest.dateStr}.
                </p>
              </>
            )}
            <p style={{ margin: '10px 0 0', fontSize: 11, color: '#475569' }}>
              Returns then use money-market simple interest per leg, compounded across legs. The forward move rides on the Zaronia FRA curve — if the FRA data is stale, the moves are too.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
