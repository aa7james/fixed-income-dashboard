import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../utils/supabase';

// "Why are yields here?" — an editable blame-allocation of the drivers of high
// bond yields, SA and US. Labels, weights, notes, colours + which drivers exist
// all persist to Supabase (yield_drivers), shared across everyone. Collapse
// state is per-browser (localStorage).

const REGIONS = [
  { key: 'SA', title: 'South Africa', sub: '10y ≈ 10%' },
  { key: 'US', title: 'United States', sub: '10y ≈ 4.5%' },
];

const PALETTE = ['#e34948', '#eda100', '#2a78d6', '#008300', '#6250d6', '#eb6834', '#1baf7a', '#e87ba4'];

const loadPref = (k, fallback) => {
  try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
};
const savePref = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };

function DriverRow({ r, noteOpen, confirming, onToggleNote, onEdit, onCycleColor, onAskDelete, onConfirmDelete, onCancelDelete }) {
  const hasNote = (r.note || '').trim().length > 0;
  return (
    <div style={{ marginBottom: 6, paddingBottom: 6, borderBottom: '1px solid #1e293b' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <span
          onClick={() => onCycleColor(r)}
          title="Click to change colour"
          style={{ width: 9, height: 9, borderRadius: 2, background: r.color || '#2a78d6', flex: '0 0 auto', cursor: 'pointer' }}
        />
        <input
          type="text"
          value={r.label || ''}
          placeholder="Driver name"
          onChange={e => onEdit(r.id, 'label', e.target.value)}
          style={{ fontSize: 11, color: '#cbd5e1', lineHeight: 1.2, flex: 1, minWidth: 0, padding: '1px 3px', borderRadius: 4, border: '1px solid transparent', background: 'transparent' }}
          onFocus={e => { e.target.style.border = '1px solid #334155'; e.target.style.background = '#0f172a'; }}
          onBlur={e => { e.target.style.border = '1px solid transparent'; e.target.style.background = 'transparent'; }}
        />
        <input
          type="number" step="1" min="0" max="100"
          value={r.weight ?? ''}
          onChange={e => onEdit(r.id, 'weight', e.target.value)}
          style={{ width: 38, fontSize: 11, padding: '1px 3px', borderRadius: 4, border: '1px solid #334155', background: '#0f172a', color: '#e2e8f0', textAlign: 'right' }}
        />
        <span style={{ fontSize: 10, color: '#64748b' }}>%</span>
        {confirming ? (
          <span style={{ display: 'flex', gap: 3, flex: '0 0 auto' }}>
            <button onClick={() => onConfirmDelete(r.id)} title="Remove" style={{ fontSize: 10, lineHeight: 1, padding: '2px 5px', borderRadius: 4, border: '1px solid #7f1d1d', background: '#7f1d1d', color: '#fecaca', cursor: 'pointer' }}>✓</button>
            <button onClick={onCancelDelete} title="Keep" style={{ fontSize: 10, lineHeight: 1, padding: '2px 5px', borderRadius: 4, border: '1px solid #334155', background: 'transparent', color: '#94a3b8', cursor: 'pointer' }}>✕</button>
          </span>
        ) : (
          <button onClick={() => onAskDelete(r.id)} title="Remove this driver" style={{ fontSize: 12, lineHeight: 1, padding: '0 3px', border: 'none', background: 'transparent', color: '#475569', cursor: 'pointer', flex: '0 0 auto' }}>×</button>
        )}
      </div>
      <div style={{ height: 3, background: '#1e293b', borderRadius: 2, overflow: 'hidden', margin: '3px 0 3px 14px' }}>
        <div style={{ width: `${Math.max(0, Math.min(100, Number(r.weight) || 0))}%`, height: '100%', background: r.color || '#2a78d6' }} />
      </div>
      <div
        onClick={() => onToggleNote(r.id)}
        style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 14, cursor: 'pointer', color: hasNote ? '#60a5fa' : '#64748b', fontSize: 10 }}
      >
        <span style={{ fontSize: 9 }}>{noteOpen ? '▾' : '▸'}</span>
        <span>note</span>
        {!noteOpen && hasNote && (
          <span style={{ color: '#64748b', fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 }}>— {r.note}</span>
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

export default function YieldDrivers({ sa10y = null, us10y = null }) {
  const liveSub = (key) => {
    const y = key === 'SA' ? sa10y : key === 'US' ? us10y : null;
    const r = REGIONS.find(x => x.key === key);
    return (y != null && isFinite(y)) ? `10y ${y.toFixed(2)}%` : (r ? r.sub : '');
  };
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState('loading'); // loading | ready | setup | error
  const [savedAt, setSavedAt] = useState(null);
  const [confirmId, setConfirmId] = useState(null);
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

  const flash = () => { setSavedAt(Date.now()); setTimeout(() => setSavedAt(null), 1500); };
  const toggleRegion = (k) => setOpenRegions(prev => { const next = { ...prev, [k]: !prev[k] }; savePref('yd_openRegions', next); return next; });
  const toggleNote = (id) => setOpenNotes(prev => { const next = { ...prev, [id]: !prev[id] }; savePref('yd_openNotes', next); return next; });

  const edit = (id, field, value) => {
    setRows(rs => rs.map(r => (r.id === id ? { ...r, [field]: value } : r)));
    clearTimeout(timers.current[id + field]);
    timers.current[id + field] = setTimeout(async () => {
      const patch = { [field]: field === 'weight' ? (Number(value) || 0) : value, updated_at: new Date().toISOString() };
      const { error } = await supabase.from('yield_drivers').update(patch).eq('id', id);
      if (!error) flash();
    }, 600);
  };

  const cycleColor = async (r) => {
    const i = PALETTE.indexOf(r.color);
    const color = PALETTE[(i + 1) % PALETTE.length];
    setRows(rs => rs.map(x => (x.id === r.id ? { ...x, color } : x)));
    const { error } = await supabase.from('yield_drivers').update({ color, updated_at: new Date().toISOString() }).eq('id', r.id);
    if (!error) flash();
  };

  const addDriver = async (region) => {
    const inReg = rows.filter(x => x.region === region);
    const sort = inReg.reduce((m, x) => Math.max(m, x.sort || 0), 0) + 1;
    const color = PALETTE[inReg.length % PALETTE.length];
    const { data, error } = await supabase
      .from('yield_drivers')
      .insert({ region, sort, label: 'New driver', weight: 0, note: '', color })
      .select()
      .single();
    if (!error && data) { setRows(rs => [...rs, data]); flash(); }
  };

  const confirmDelete = async (id) => {
    setConfirmId(null);
    setRows(rs => rs.filter(r => r.id !== id));
    await supabase.from('yield_drivers').delete().eq('id', id);
    flash();
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
              <span style={{ fontSize: 10, color: '#64748b' }}>{liveSub(reg.key)}</span>
              <span style={{ fontSize: 10.5, color: off ? '#f87171' : '#94a3b8', fontVariantNumeric: 'tabular-nums', minWidth: 28, textAlign: 'right' }}>{total.toFixed(0)}%</span>
            </div>
            {open && (
              <>
                {r.map(row => (
                  <DriverRow
                    key={row.id} r={row}
                    noteOpen={!!openNotes[row.id]}
                    confirming={confirmId === row.id}
                    onToggleNote={toggleNote}
                    onEdit={edit}
                    onCycleColor={cycleColor}
                    onAskDelete={setConfirmId}
                    onConfirmDelete={confirmDelete}
                    onCancelDelete={() => setConfirmId(null)}
                  />
                ))}
                <button
                  onClick={() => addDriver(reg.key)}
                  style={{ fontSize: 10.5, color: '#60a5fa', padding: '3px 0', border: 'none', background: 'transparent', cursor: 'pointer' }}
                >+ add driver</button>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
