import React, { useMemo, useState, useEffect } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { supabase } from '../utils/supabase';
import ResizableChart from './ResizableChart';
import { useYAxisBounds } from './useYAxisBounds';

const BENCHMARK = 'ALBI';
const inp = { background: '#0f172a', border: '1px solid #334155', borderRadius: 6, color: '#e2e8f0', padding: '6px 8px', fontSize: 13 };
const btn = { background: '#334155', border: 'none', borderRadius: 6, color: '#e2e8f0', padding: '6px 10px', fontSize: 12, cursor: 'pointer' };
const cell = (x = {}) => ({ padding: '6px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', ...x });

// Rough modified-duration default per instrument (editable per holding).
function estDuration(name, instruments) {
  const inst = (instruments || []).find(i => i.name === name);
  if (inst?.maturity_date) {
    const yrs = (new Date(inst.maturity_date) - new Date()) / (1000 * 3600 * 24 * 365);
    return Math.max(0.1, +yrs.toFixed(2));
  }
  const ym = name.match(/(\d+)\s*y/i); if (ym) return +ym[1];
  const mm = name.match(/(\d+)\s*m/i); if (mm) return +(+mm[1] / 12).toFixed(2);
  return 1;
}

// Daily return for one instrument between two rows.
function instReturn(name, dur, prev, cur, dtDays) {
  const a = prev[name], b = cur[name];
  if (a == null || b == null) return null;
  if (Math.abs(a) > 50) return b / a - 1;              // index/price level (e.g. ALBI)
  return (a / 100) * (dtDays / 365) - dur * ((b - a) / 100); // yield: carry − duration×Δy
}

const PerfTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, padding: '8px 12px' }}>
      <p style={{ color: '#94a3b8', fontSize: 11, margin: '0 0 4px' }}>{label}</p>
      {payload.map(p => (
        <p key={p.dataKey} style={{ color: p.color, fontSize: 12, margin: '2px 0' }}>
          {p.name}: <strong>{p.value?.toFixed(2)}</strong> ({(p.value - 100).toFixed(2)}%)
        </p>
      ))}
    </div>
  );
};

export default function ModelPortfolio({ data, instruments }) {
  const [portfolios, setPortfolios] = useState([]);
  const [selId, setSelId] = useState(null);
  const [name, setName] = useState('New portfolio');
  const [startDate, setStartDate] = useState('');
  const [holdings, setHoldings] = useState([]); // [{instrument, weight, duration}]
  const [status, setStatus] = useState('');
  const yb = useYAxisBounds();

  const instNames = useMemo(() => (instruments || []).map(i => i.name).sort(), [instruments]);
  const dataRows = data?.dataRows || [];

  const loadList = () => supabase.from('model_portfolios').select('*').order('created_at')
    .then(({ data: rows }) => setPortfolios(rows || [])).catch(() => {});
  useEffect(() => { loadList(); }, []);

  // default start = ~1y ago (or earliest data)
  useEffect(() => {
    if (!startDate && dataRows.length) {
      const d = new Date(dataRows[dataRows.length - 1].date); d.setFullYear(d.getFullYear() - 1);
      setStartDate(d.toISOString().slice(0, 10));
    }
  }, [dataRows, startDate]);

  const loadPortfolio = (p) => {
    setSelId(p.id); setName(p.name); setStartDate(p.start_date || startDate);
    setHoldings((p.holdings || []).map(h => ({ instrument: h.instrument, weight: h.weight, duration: h.duration })));
  };
  const newPortfolio = () => { setSelId(null); setName('New portfolio'); setHoldings([]); };

  const addHolding = () => {
    const nm = instNames[0] || '';
    setHoldings(h => [...h, { instrument: nm, weight: 10, duration: estDuration(nm, instruments) }]);
  };
  const updateHolding = (i, patch) => setHoldings(h => h.map((x, j) => j === i ? { ...x, ...patch } : x));
  const pickInstrument = (i, nm) => updateHolding(i, { instrument: nm, duration: estDuration(nm, instruments) });
  const removeHolding = (i) => setHoldings(h => h.filter((_, j) => j !== i));

  const save = async () => {
    const row = { name, benchmark: BENCHMARK, start_date: startDate || null, holdings };
    setStatus('Saving…');
    try {
      if (selId) await supabase.from('model_portfolios').update(row).eq('id', selId);
      else { const { data: ins } = await supabase.from('model_portfolios').insert(row).select().single(); if (ins) setSelId(ins.id); }
      setStatus('Saved ✓'); loadList(); setTimeout(() => setStatus(''), 2500);
    } catch { setStatus('Save failed — did you run the SQL to create the table?'); }
  };
  const del = async () => {
    if (!selId) return;
    await supabase.from('model_portfolios').delete().eq('id', selId);
    newPortfolio(); loadList();
  };

  const totW = holdings.reduce((a, h) => a + (Number(h.weight) || 0), 0);

  // Total-return series: portfolio vs benchmark, indexed to 100 at the start date.
  const perf = useMemo(() => {
    if (dataRows.length < 2 || !holdings.length || !startDate) return null;
    const start = new Date(startDate);
    const rows = dataRows.filter(r => r.date >= start);
    if (rows.length < 2) return null;
    const w = totW || 1;
    let pIdx = 100, bIdx = 100;
    const series = [{ date: rows[0].dateStr, Portfolio: 100, [BENCHMARK]: 100 }];
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1], cur = rows[i];
      const dt = Math.max(1, (cur.date - prev.date) / (1000 * 3600 * 24));
      let pr = 0, used = 0;
      holdings.forEach(h => {
        const r = instReturn(h.instrument, Number(h.duration) || 0, prev, cur, dt);
        if (r != null) { pr += ((Number(h.weight) || 0) / w) * r; used += (Number(h.weight) || 0) / w; }
      });
      if (used > 0) pIdx *= (1 + pr);
      const br = instReturn(BENCHMARK, 0, prev, cur, dt);
      if (br != null) bIdx *= (1 + br);
      series.push({ date: cur.dateStr, Portfolio: +pIdx.toFixed(3), [BENCHMARK]: +bIdx.toFixed(3) });
    }
    return series;
  }, [dataRows, holdings, startDate, totW]);

  const stats = useMemo(() => {
    if (!perf || perf.length < 2) return null;
    const last = perf[perf.length - 1];
    const pRet = last.Portfolio - 100, bRet = last[BENCHMARK] - 100;
    const wYield = totW ? holdings.reduce((a, h) => {
      const y = dataRows.length ? dataRows[dataRows.length - 1][h.instrument] : null;
      return a + (y != null && Math.abs(y) < 50 ? (Number(h.weight) || 0) * Number(y) : 0);
    }, 0) / totW : 0;
    const wDur = totW ? holdings.reduce((a, h) => a + (Number(h.weight) || 0) * (Number(h.duration) || 0), 0) / totW : 0;
    return { pRet, bRet, excess: pRet - bRet, wYield, wDur, totW };
  }, [perf, holdings, totW, dataRows]);

  const colors = ['#38bdf8', '#f59e0b'];

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: '#f1f5f9', margin: 0 }}>Model Portfolio</h2>
        <p style={{ fontSize: 13, color: '#64748b', margin: '2px 0 0' }}>
          Pick instruments and weights; total return (carry − duration × Δyield) is tracked vs {BENCHMARK}.
        </p>
      </div>

      {/* portfolio controls */}
      <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 12, padding: 16, marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
          <select value={selId || ''} onChange={e => { const p = portfolios.find(x => x.id === e.target.value); if (p) loadPortfolio(p); else newPortfolio(); }} style={{ ...inp, minWidth: 180 }}>
            <option value="">— New / unsaved —</option>
            {portfolios.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Portfolio name" style={{ ...inp, flex: 1, minWidth: 160 }} />
          <label style={{ fontSize: 12, color: '#94a3b8' }}>Start</label>
          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={inp} />
          <button onClick={save} style={{ ...btn, background: '#0ea5e9', fontWeight: 700 }}>Save</button>
          <button onClick={newPortfolio} style={btn}>New</button>
          {selId && <button onClick={del} style={{ ...btn, background: '#7f1d1d' }}>Delete</button>}
          {status && <span style={{ fontSize: 12, color: status.includes('fail') ? '#f87171' : '#4ade80' }}>{status}</span>}
        </div>

        {/* holdings */}
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, color: '#e2e8f0' }}>
          <thead>
            <tr style={{ color: '#94a3b8' }}>
              <th style={{ padding: '6px 8px', textAlign: 'left' }}>Instrument</th>
              <th style={cell()}>Weight %</th>
              <th style={cell()}>Mod. duration</th>
              <th style={cell()}></th>
            </tr>
          </thead>
          <tbody>
            {holdings.map((h, i) => (
              <tr key={i} style={{ borderTop: '1px solid #0f172a' }}>
                <td style={{ padding: '4px 8px' }}>
                  <select value={h.instrument} onChange={e => pickInstrument(i, e.target.value)} style={{ ...inp, width: '100%' }}>
                    {instNames.map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </td>
                <td style={cell()}><input type="number" step="1" value={h.weight} onChange={e => updateHolding(i, { weight: e.target.value })} style={{ ...inp, width: 70, textAlign: 'right' }} /></td>
                <td style={cell()}><input type="number" step="0.1" value={h.duration} onChange={e => updateHolding(i, { duration: e.target.value })} style={{ ...inp, width: 70, textAlign: 'right' }} /></td>
                <td style={cell()}><button onClick={() => removeHolding(i)} style={{ ...btn, padding: '4px 8px', background: '#7f1d1d' }}>×</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ marginTop: 10, display: 'flex', gap: 10, alignItems: 'center' }}>
          <button onClick={addHolding} style={{ ...btn, background: '#0ea5e9' }}>+ Add holding</button>
          <span style={{ fontSize: 12, color: totW === 100 ? '#4ade80' : '#fbbf24' }}>Total weight: {totW}% {totW !== 100 ? '(normalised to 100%)' : ''}</span>
        </div>
      </div>

      {/* performance */}
      {stats && (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
          {[['Portfolio return', `${stats.pRet >= 0 ? '+' : ''}${stats.pRet.toFixed(2)}%`, '#38bdf8'],
            [`${BENCHMARK} return`, `${stats.bRet >= 0 ? '+' : ''}${stats.bRet.toFixed(2)}%`, '#f59e0b'],
            ['Excess vs bench', `${stats.excess >= 0 ? '+' : ''}${stats.excess.toFixed(2)}%`, stats.excess >= 0 ? '#4ade80' : '#f87171'],
            ['Weighted yield', `${stats.wYield.toFixed(2)}%`, '#cbd5e1'],
            ['Weighted duration', `${stats.wDur.toFixed(1)}y`, '#cbd5e1']].map(([lbl, val, col]) => (
            <div key={lbl} style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 10, padding: '10px 16px', minWidth: 140 }}>
              <div style={{ fontSize: 11, color: '#64748b' }}>{lbl}</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: col }}>{val}</div>
            </div>
          ))}
        </div>
      )}

      {perf && perf.length > 1 ? (
        <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#cbd5e1', marginBottom: 8 }}>Total return (indexed to 100 at start)</div>
          {yb.Control}
          <ResizableChart width="100%" height={460}>
            <LineChart data={perf} margin={{ top: 10, right: 20, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#0f172a" />
              <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 9 }} interval="preserveStartEnd" minTickGap={40} />
              <YAxis domain={yb.domain} allowDataOverflow tick={{ fill: '#64748b', fontSize: 10 }} width={48} />
              <Tooltip content={<PerfTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="Portfolio" stroke={colors[0]} strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey={BENCHMARK} stroke={colors[1]} strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
            </LineChart>
          </ResizableChart>
          <p style={{ fontSize: 11, color: '#475569', margin: '10px 4px 0' }}>
            Total return ≈ carry (yield × days/365) − modified duration × change in yield, per instrument; index levels (e.g. {BENCHMARK}) use their actual level change. Approximate — ignores convexity, roll-down and exact day-counts.
          </p>
        </div>
      ) : (
        <div style={{ color: '#64748b', fontSize: 13 }}>Add holdings and pick a start date to see performance.</div>
      )}
    </div>
  );
}
