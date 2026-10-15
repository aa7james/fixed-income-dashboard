import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../utils/supabase';

// "Why are yields here?" — an editable blame-allocation of the drivers of high
// bond yields, SA and US. Weights + notes persist to Supabase (yield_drivers),
// shared across everyone. Collapse state is per-browser (localStorage).

const REGIONS = [
  { key: 'SA', title: 'South Africa', sub: '10y ≈ 10%' },
  { key: 'US', title: 'United States', sub: '10y ≈ 4.5%' },
];

const loadPref = (k, fallback) => {
  try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
};
const savePref = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };

function DriverRow({ r, noteOpen, onToggleNote, onEdit }) {
  const hasNote = (r.note || '').trim().length > 0;
  return (
    <div style={{ marginBottom: 6, paddingBottom: 6, borderBottom: '1px solid #1e293b' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <span style={{ width: 7, height: 7, borderRadius: 2, background: r.color || '#2a78d6', flex: '0 0 auto' }} />
        <span style={{ fontSize: 11, color: '#cbd5e1', lineHeight: 1.2, flex: 1 }}>{r.label}</span>
        <input
          type="number" step="1" min="0" max="100"
          value={r.weight ?? ''}
          onChange={e => onEdit(r.id, 'weight', e.target.value)}
          style={{ width: 38, fontSize: 11, padding: '1px 3px', borderRadius: 4, border: '1px solid #334155', background: '#0f172a', color: '#e2e8f0', textAlign: 'right' }}
        />
        <span style={{ fontSize: 10, color: '#64748b' }}>%</span>
      </div>
      <div style={{ height: 3, background: '#1e293b', borderRadius: 2, overflow: 'hidden', margin: '3px 0 3px 12px' }}>
        <div style={{ width: `${Math.max(0, Math.min(100, Number(r.weight) || 0))}%`, height: '100%', background: r.color || '#2a78d6' }} />
      </div>
      <div
        onClick={() => onToggleNote(r.id)}
        style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 12, cursor: 'pointer', color: hasNote ? '#60a5fa' : '#64748b', fontSize: 10 }}
      >
        <span style={{ fontSize: 9 }}>{noteOpen ? '▾' : '▸'}</span>
        <span>note</span>
        {!noteOpen && hasNote && (
          <span style={{ color: '#64748b', fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 170 }}>— {r.note}</span>
        )}
      </div>
      {noteOpen && (
        <textarea
          value={r.note || ''}
          placeholder="Add a note…"
          onChange={e => onEdit(r.id, 'note', e.target.value)}
          rows={2}
          style={{ width: '100%', fontSize: 11, lineHeight: 1.35, padding: '4px 6px', marginTop: 4, borderRadius: 5, border: '1px solid #334155', background: '#0f172a', color: '#e2e8f0', resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit' }}
        />
      )}
    </div>
  );
}

export default function YieldDrivers() {
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState('loading'); // loading | ready | setup | error
  const [savedAt, setSavedAt] = useState(null);
  const [openRegions, setOpenRegions] = useState(() => loadPref('yd_openRegions', { SA: true, US: true }));
  const [openNotes, setOpenNotes] = useState(() => loadPref('yd_openNotes', {}));
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

  const toggleRegion = (k) => setOpenRegions(prev => { const next = { ...prev, [k]: !prev[k] }; savePref('yd_openRegions', next); return next; });
  const toggleNote = (id) => setOpenNotes(prev => { const next = { ...prev, [id]: !prev[id] }; savePref('yd_openNotes', next); return next; });

  const edit = (id, field, value) => {
    setRows(rs => rs.map(r => (r.id === id ? { ...r, [field]: value } : r)));
    clearTimeout(timers.current[id]);
    timers.current[id] = setTimeout(async () => {
      const patch = { [field]: field === 'weight' ? (Number(value) || 0) : value, updated_at: new Date().toISOString() };
      const { error } = await supabase.from('yield_drivers').update(patch).eq('id', id);
      if (!error) { setSavedAt(Date.now()); setTimeout(() => setSavedAt(null), 1500); }
    }, 600);
  };

  return (
    <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 10, padding: 11 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 1 }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: '#f1f5f9' }}>Why are yields here?</span>
        {savedAt && <span style={{ fontSize: 10, color: '#4ade80' }}>saved</span>}
      </div>
      <div style={{ fontSize: 10, color: '#64748b', marginBottom: 10 }}>Drivers of high bond yields — shared.</div>

      {status === 'loading' && <div style={{ fontSize: 11, color: '#64748b' }}>Loading…</div>}
      {status === 'error' && <div style={{ fontSize: 11, color: '#f87171' }}>Couldn't load the drivers. Refresh to retry.</div>}
      {status === 'setup' && (
        <div style={{ fontSize: 11, color: '#fbbf24', lineHeight: 1.5 }}>
          Notes storage isn't set up yet. Run the one-time setup SQL in Supabase, then refresh.
        </div>
      )}

      {status === 'ready' && REGIONS.map(reg => {
        const r = rows.filter(x => x.region === reg.key);
        if (!r.length) return null;
        const open = openRegions[reg.key];
        const total = r.reduce((a, x) => a + (Number(x.weight) || 0), 0);
        const off = Math.abs(total - 100) > 0.5;
        return (
          <div key={reg.key} style={{ marginBottom: 12 }}>
            <div
              onClick={() => toggleRegion(reg.key)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', padding: '3px 0', borderBottom: '1px solid #334155', marginBottom: open ? 8 : 0 }}
            >
              <span style={{ fontSize: 10, color: '#94a3b8' }}>{open ? '▾' : '▸'}</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#e2e8f0', flex: 1 }}>{reg.title}</span>
              <span style={{ fontSize: 10, color: '#64748b' }}>{reg.sub}</span>
              <span style={{ fontSize: 10.5, color: off ? '#f87171' : '#94a3b8', fontVariantNumeric: 'tabular-nums', minWidth: 28, textAlign: 'right' }}>{total.toFixed(0)}%</span>
            </div>
            {open && r.map(row => (
              <DriverRow key={row.id} r={row} noteOpen={!!openNotes[row.id]} onToggleNote={toggleNote} onEdit={edit} />
            ))}
          </div>
        );
      })}
    </div>
  );
}
