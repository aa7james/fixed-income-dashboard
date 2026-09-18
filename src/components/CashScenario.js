import React, { useMemo, useState, useEffect } from 'react';

// Standalone cash scenario calculator: build Strategy A vs Strategy B from any
// legs (a "roll" is just >1 leg), type in expected future rates, and see the
// compounded money-market math and the winner. Custom instruments live in
// localStorage (this browser only).

const LS_KEY = 'cashCustomInstruments';
const zar = new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', maximumFractionDigits: 0 });

const inp = { background: '#0f172a', border: '1px solid #334155', borderRadius: 6, color: '#e2e8f0', padding: '6px 8px', fontSize: 13, width: '100%', boxSizing: 'border-box' };
const btn = { background: '#334155', border: 'none', borderRadius: 6, color: '#e2e8f0', padding: '6px 10px', fontSize: 12, cursor: 'pointer' };
const card = { background: '#1e293b', border: '1px solid #334155', borderRadius: 12, padding: 16, marginBottom: 24 };

// Legs use money-market simple interest per period, compounded across legs.
function evalStrategy(legs) {
  let growth = 1, months = 0;
  const steps = [];
  for (const leg of legs) {
    const r = Number(leg.rate) || 0, m = Number(leg.months) || 0;
    const g = 1 + (r / 100) * (m / 12);
    growth *= g; months += m;
    steps.push({ r, m, g });
  }
  const annualised = months > 0 ? (Math.pow(growth, 12 / months) - 1) * 100 : 0;
  return { growth, months, annualised, steps };
}

export default function CashScenario({ latest, instruments, markers }) {
  // Build the instrument menu (current rates) from the live data + custom list.
  const [custom, setCustom] = useState(() => {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch { return []; }
  });
  useEffect(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(custom)); } catch { /* ignore */ }
  }, [custom]);

  const menu = useMemo(() => {
    const items = [];
    const push = (label, key, months) => {
      const v = latest?.[key];
      if (v != null) items.push({ label, rate: +Number(v).toFixed(3), months });
    };
    const mk = (label, mLabel, months) => {
      const m = (markers || []).find(x => (x.label || '').toLowerCase() === mLabel.toLowerCase());
      if (m) items.push({ label, rate: +Number(m.value).toFixed(3), months });
    };
    mk('Call', 'Call', 1); mk('Money Market', 'MM', 1);
    [3, 6, 9, 12].forEach(t => push(`${t}m T-Bill`, `${t}m T-Bill`, t));
    [3, 6, 9, 12].forEach(t => push(`${t}m Fixed NCD`, `${t}m Fixed Rate NCD`, t));
    [3, 6, 9, 12].forEach(t => push(`${t}m JIBAR`, `${t}m JIBAR`, t));
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
  const defRate = (label, fallback) => (findMenu(label)?.rate ?? fallback);

  // Default to James's example: 12m NCD vs rolling a 6m T-Bill into another 6m T-Bill.
  const [amount, setAmount] = useState(1000000);
  const [stratA, setStratA] = useState(() => ({ name: 'Lock 12m NCD', legs: [{ label: '12m Fixed NCD', months: 12, rate: 0 }] }));
  const [stratB, setStratB] = useState(() => ({ name: 'Roll 6m T-Bill x2', legs: [{ label: '6m T-Bill', months: 6, rate: 0 }, { label: '6m T-Bill', months: 6, rate: 0 }] }));
  const [seeded, setSeeded] = useState(false);

  // Seed default rates once the menu has loaded.
  useEffect(() => {
    if (seeded || !menu.length) return;
    setStratA(s => ({ ...s, legs: s.legs.map(l => ({ ...l, rate: defRate(l.label, l.rate) })) }));
    setStratB(s => ({ ...s, legs: s.legs.map(l => ({ ...l, rate: defRate(l.label, l.rate) })) }));
    setSeeded(true);
  }, [menu, seeded]); // eslint-disable-line

  const updateLeg = (setS, idx, patch) => setS(s => ({ ...s, legs: s.legs.map((l, i) => i === idx ? { ...l, ...patch } : l) }));
  const pickInstrument = (setS, idx, label) => {
    const mItem = findMenu(label);
    updateLeg(setS, idx, mItem ? { label, rate: mItem.rate, months: mItem.months } : { label });
  };
  const addLeg = (setS) => setS(s => ({ ...s, legs: [...s.legs, { label: menu[0]?.label || '', months: 6, rate: menu[0]?.rate || 0 }] }));
  const removeLeg = (setS, idx) => setS(s => ({ ...s, legs: s.legs.filter((_, i) => i !== idx) }));

  const evA = useMemo(() => evalStrategy(stratA.legs), [stratA]);
  const evB = useMemo(() => evalStrategy(stratB.legs), [stratB]);
  const matA = amount * evA.growth, matB = amount * evB.growth;
  const winner = Math.abs(matA - matB) < 1 ? null : (matA > matB ? 'A' : 'B');
  const diffRand = Math.abs(matA - matB);
  const diffBps = Math.round(Math.abs(evA.annualised - evB.annualised) * 100);
  const horizonMismatch = evA.months !== evB.months;

  // custom instrument form
  const [cName, setCName] = useState(''); const [cRate, setCRate] = useState(''); const [cMonths, setCMonths] = useState('');
  const addCustom = () => {
    if (!cName || cRate === '' || cMonths === '') return;
    setCustom(c => [...c, { id: Date.now(), label: cName, rate: Number(cRate), months: Number(cMonths) }]);
    setCName(''); setCRate(''); setCMonths('');
  };

  const formula = (ev) => ev.steps.map(s => `(1 + ${s.r.toFixed(2)}% × ${s.m}/12)`).join(' × ');

  const renderStrategy = (strat, setS, ev, mat, tag, isWinner) => (
    <div style={{ flex: '1 1 320px', background: '#0f172a', border: `1px solid ${isWinner ? '#4ade80' : '#334155'}`, borderRadius: 10, padding: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <input value={strat.name} onChange={e => setS(s => ({ ...s, name: e.target.value }))}
          style={{ ...inp, width: 'auto', flex: 1, fontWeight: 700, fontSize: 14, border: 'none', background: 'transparent', padding: 0, color: isWinner ? '#4ade80' : '#f1f5f9' }} />
        <span style={{ fontSize: 11, color: '#64748b', marginLeft: 8 }}>Strategy {tag}</span>
      </div>
      {strat.legs.map((leg, i) => (
        <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 10, color: '#475569', width: 44 }}>{i === 0 ? 'Buy' : 'Roll →'}</span>
          <select value={leg.label} onChange={e => pickInstrument(setS, i, e.target.value)} style={{ ...inp, flex: 2 }}>
            {menu.map((m, k) => <option key={k} value={m.label}>{m.label}</option>)}
          </select>
          <input type="number" value={leg.months} onChange={e => updateLeg(setS, i, { months: e.target.value })} title="months" style={{ ...inp, width: 56, flex: '0 0 56px' }} />
          <input type="number" step="0.01" value={leg.rate} onChange={e => updateLeg(setS, i, { rate: e.target.value })} title="rate %" style={{ ...inp, width: 68, flex: '0 0 68px' }} />
          {strat.legs.length > 1 && <button onClick={() => removeLeg(setS, i)} style={{ ...btn, padding: '4px 8px', background: '#7f1d1d' }}>×</button>}
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, marginTop: 4, marginBottom: 12 }}>
        <button onClick={() => addLeg(setS)} style={btn}>+ Add roll</button>
        <span style={{ fontSize: 11, color: '#64748b', alignSelf: 'center' }}>cols: instrument · months · rate %</span>
      </div>
      <div style={{ borderTop: '1px solid #1e293b', paddingTop: 10, fontSize: 12, color: '#94a3b8', lineHeight: 1.7 }}>
        <div style={{ color: '#64748b', fontFamily: 'monospace', fontSize: 11 }}>
          {zar.format(amount)} × {formula(ev)}
        </div>
        <div>= <strong style={{ color: '#e2e8f0' }}>{zar.format(mat)}</strong> over {ev.months} months</div>
        <div>Interest: <strong style={{ color: isWinner ? '#4ade80' : '#e2e8f0' }}>{zar.format(mat - amount)}</strong></div>
        <div>Effective: <strong style={{ color: isWinner ? '#4ade80' : '#e2e8f0' }}>{ev.annualised.toFixed(2)}% p.a.</strong></div>
      </div>
    </div>
  );

  if (!latest) return null;

  return (
    <div style={card}>
      <h3 style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9', margin: '0 0 4px' }}>Scenario calculator — lock vs roll</h3>
      <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 14px' }}>
        Build two strategies and compare. A "roll" is just a second leg — pick the instrument and type the rate you <em>expect</em> at that future point. Rates auto-fill from today's data; edit any of them.
      </p>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
        <label style={{ fontSize: 12, color: '#94a3b8' }}>Amount (R)</label>
        <input type="number" value={amount} onChange={e => setAmount(Number(e.target.value) || 0)} style={{ ...inp, width: 160, flex: '0 0 160px' }} />
      </div>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {renderStrategy(stratA, setStratA, evA, matA, 'A', winner === 'A')}
        {renderStrategy(stratB, setStratB, evB, matB, 'B', winner === 'B')}
      </div>

      <div style={{ marginTop: 14, padding: 12, background: '#0f172a', borderRadius: 10 }}>
        {winner ? (
          <p style={{ fontSize: 14, color: '#e2e8f0', margin: 0, lineHeight: 1.5 }}>
            <strong style={{ color: '#4ade80' }}>Winner: Strategy {winner} — {(winner === 'A' ? stratA : stratB).name}.</strong>{' '}
            It earns <strong>{zar.format(diffRand)}</strong> more ({diffBps} bps p.a.) over the horizon, on your assumptions.
          </p>
        ) : (
          <p style={{ fontSize: 14, color: '#94a3b8', margin: 0 }}>The two strategies break even on these assumptions.</p>
        )}
        {horizonMismatch && (
          <p style={{ fontSize: 12, color: '#fbbf24', margin: '6px 0 0' }}>
            ⚠ The two strategies cover different horizons (A: {evA.months}m, B: {evB.months}m). For a fair lock-vs-roll call, match the total months — compare on "Effective % p.a." rather than the rand amount.
          </p>
        )}
        <p style={{ fontSize: 11, color: '#475569', margin: '8px 0 0' }}>
          Money-market simple interest per leg, compounded across legs. Ignores day-count precision, tax and any bid/offer.
        </p>
      </div>

      {/* custom instruments */}
      <div style={{ marginTop: 18, borderTop: '1px solid #334155', paddingTop: 14 }}>
        <h4 style={{ fontSize: 13, fontWeight: 700, color: '#cbd5e1', margin: '0 0 4px' }}>Add your own instrument</h4>
        <p style={{ fontSize: 11, color: '#64748b', margin: '0 0 10px' }}>Saved in this browser. Appears in the dropdowns above with a ★.</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input placeholder="Name (e.g. Corporate paper)" value={cName} onChange={e => setCName(e.target.value)} style={{ ...inp, width: 200, flex: '0 0 200px' }} />
          <input type="number" step="0.01" placeholder="Rate %" value={cRate} onChange={e => setCRate(e.target.value)} style={{ ...inp, width: 90, flex: '0 0 90px' }} />
          <input type="number" placeholder="Months" value={cMonths} onChange={e => setCMonths(e.target.value)} style={{ ...inp, width: 90, flex: '0 0 90px' }} />
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
    </div>
  );
}
