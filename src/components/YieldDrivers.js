import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../utils/supabase';

// "Why are yields here?" — an editable blame-allocation of the drivers of high
// bond yields, SA and US. Weights + notes persist to Supabase (yield_drivers),
// shared across everyone who opens the dashboard.

const REGIONS = [
  { key: 'SA', title: 'South Africa', sub: '10y ≈ 10% · my allocation' },
  { key: 'US', title: 'United States', sub: '10y ≈ 4.5% · from the podcast' },
];

function RegionBlock({ title, sub, rows, onEdit }) {
  const total = rows.reduce((a, r) => a + (Number(r.weight) || 0), 0);
  const off = Math.abs(total - 100) > 0.5;
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 2 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>{title}</span>
        <span style={{ fontSize: 11, color: off ? '#f87171' : '#64748b', fontVariantNumeric: 'tabular-nums' }}>{total.toFixed(0)}%</span>
      </div>
      <div style={{ fontSize: 10, color: '#64748b', marginBottom: 8 }}>{sub}</div>

      {rows.map(r => (
        <div key={r.id} style={{ marginBottom: 10, paddingBottom: 10, borderBottom: '1px solid #1e293b' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: r.color || '#2a78d6', flex: '0 0 auto' }} />
            <span style={{ fontSize: 11.5, color: '#cbd5e1', lineHeight: 1.25, flex: 1 }}>{r.label}</span>
            <input
              type="number" step="1" min="0" max="100"
              value={r.weight ?? ''}
              onChange={e => onEdit(r.id, 'weight', e.target.value)}
              style={{ width: 42, fontSize: 11, padding: '2px 4px', borderRadius: 5, border: '1px solid #334155', background: '#0f172a', color: '#e2e8f0', textAlign: 'right' }}
            />
            <span style={{ fontSize: 11, color: '#64748b' }}>%</span>
          </div>
          <div style={{ height: 4, background: '#1e293b', borderRadius: 2, overflow: 'hidden', margin: '0 0 6px 14px' }}>
            <div style={{ width: `${Math.max(0, Math.min(100, Number(r.weight) || 0))}%`, height: '100%', background: r.color || '#2a78d6' }} />
          </div>
          <textarea
            value={r.note || ''}
            placeholder="Add a note…"
            onChange={e => onEdit(r.id, 'note', e.target.value)}
            rows={2}
            style={{ width: '100%', fontSize: 11, lineHeight: 1.4, padding: '5px 7px', borderRadius: 6, border: '1px solid #334155', background: '#0f172a', color: '#e2e8f0', resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit' }}
          />
        </div>
      ))}
    </div>
  );
}

export default function YieldDrivers() {
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState('loading'); // loading | ready | setup | error
  const [savedAt, setSavedAt] = useState(null);
  const timers = useRef({});

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data, error } = await supabase
        .from('yield_drivers')
        .select('*')
        .order('region', { ascending: true })
        .order('sort', { ascending: true });
      if (!alive) return;
      if (error) {
        setStatus(/relation|does not exist|schema cache/i.test(error.message) ? 'setup' : 'error');
        return;
      }
      setRows(data || []);
      setStatus('ready');
    })();
    return () => { alive = false; };
  }, []);

  const edit = (id, field, value) => {
    setRows(rs => rs.map(r => (r.id === id ? { ...r, [field]: value } : r)));
    clearTimeout(timers.current[id]);
    timers.current[id] = setTimeout(async () => {
      const patch = { [field]: field === 'weight' ? (Number(value) || 0) : value, updated_at: new Date().toISOString() };
      const { error } = await supabase.from('yield_drivers').update(patch).eq('id', id);
      if (!error) setSavedAt(Date.now());
    }, 600);
  };

  return (
    <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 2 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#f1f5f9' }}>Why are yields here?</span>
        {status === 'ready' && savedAt && <span style={{ fontSize: 10, color: '#4ade80' }}>saved</span>}
      </div>
      <div style={{ fontSize: 10.5, color: '#64748b', marginBottom: 12 }}>Drivers of high bond yields — weights &amp; notes, shared.</div>

      {status === 'loading' && <div style={{ fontSize: 11, color: '#64748b' }}>Loading…</div>}
      {status === 'error' && <div style={{ fontSize: 11, color: '#f87171' }}>Couldn't load the drivers. Check your connection and refresh.</div>}
      {status === 'setup' && (
        <div style={{ fontSize: 11, color: '#fbbf24', lineHeight: 1.5 }}>
          Notes storage isn't set up yet. Run the one-time setup SQL in Supabase, then refresh this tab.
        </div>
      )}
      {status === 'ready' && REGIONS.map(reg => {
        const r = rows.filter(x => x.region === reg.key);
        if (!r.length) return null;
        return <RegionBlock key={reg.key} title={reg.title} sub={reg.sub} rows={r} onEdit={edit} />;
      })}
    </div>
  );
}
