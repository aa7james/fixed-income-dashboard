import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../utils/supabase';

const FIELD_OPTIONS = ['PX_LAST', 'YLD_YTM_MID', 'PX_ASK', 'PX_BID', 'EARN_YLD', 'AMT_OUTSTANDING'];

const blank = {
  name: '', bloomberg_ticker: '', bloomberg_field: 'PX_LAST',
  category: '', display_label: '', is_active: true,
};

const inputStyle = {
  fontSize: 13, padding: '8px 10px', borderRadius: 8,
  border: '1px solid #334155', background: '#0f172a', color: '#e2e8f0', width: '100%',
};
const labelStyle = { fontSize: 11, color: '#94a3b8', marginBottom: 4, display: 'block', fontWeight: 600 };

export default function InstrumentsAdmin() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(blank);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('instruments')
      .select('*')
      .order('category', { ascending: true })
      .order('name', { ascending: true });
    if (!error) setRows(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const categories = useMemo(
    () => Array.from(new Set(rows.map(r => r.category).filter(Boolean))).sort(),
    [rows]
  );

  const setField = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const addInstrument = async () => {
    if (!form.name.trim() || !form.bloomberg_ticker.trim() || !form.category.trim()) {
      setMsg({ type: 'err', text: 'Name, Bloomberg ticker and category are required.' });
      return;
    }
    setSaving(true); setMsg(null);
    const payload = {
      name: form.name.trim(),
      bloomberg_ticker: form.bloomberg_ticker.trim(),
      bloomberg_field: form.bloomberg_field.trim() || 'PX_LAST',
      category: form.category.trim(),
      display_label: (form.display_label || form.name).trim(),
      is_active: true,
    };
    const { error } = await supabase
      .from('instruments')
      .upsert(payload, { onConflict: 'name' });
    setSaving(false);
    if (error) { setMsg({ type: 'err', text: `Could not save: ${error.message}` }); return; }
    setMsg({ type: 'ok', text: `Added "${payload.name}". Click Refresh Data to pull it from Bloomberg.` });
    setForm(blank);
    load();
  };

  const toggleActive = async (row) => {
    const { error } = await supabase
      .from('instruments')
      .update({ is_active: !row.is_active })
      .eq('name', row.name);
    if (!error) setRows(rs => rs.map(r => r.name === row.name ? { ...r, is_active: !r.is_active } : r));
  };

  const filtered = rows.filter(r =>
    !search ||
    r.name.toLowerCase().includes(search.toLowerCase()) ||
    (r.bloomberg_ticker || '').toLowerCase().includes(search.toLowerCase()) ||
    (r.category || '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 700, color: '#f1f5f9', margin: '0 0 4px' }}>Instruments</h2>
      <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 20px' }}>
        Add a new instrument here, then click <strong>Refresh Data</strong> to pull it from Bloomberg.
      </p>

      {/* Add form */}
      <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 12, padding: 20, marginBottom: 24 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9', margin: '0 0 16px' }}>Add new instrument</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
          <div>
            <label style={labelStyle}>Name *</label>
            <input style={inputStyle} value={form.name} onChange={e => setField('name', e.target.value)} placeholder="e.g. US 5Y Treasury" />
          </div>
          <div>
            <label style={labelStyle}>Bloomberg ticker *</label>
            <input style={inputStyle} value={form.bloomberg_ticker} onChange={e => setField('bloomberg_ticker', e.target.value)} placeholder="e.g. USGG5YR Index" />
          </div>
          <div>
            <label style={labelStyle}>Bloomberg field</label>
            <input style={inputStyle} list="field-opts" value={form.bloomberg_field} onChange={e => setField('bloomberg_field', e.target.value)} />
            <datalist id="field-opts">
              {FIELD_OPTIONS.map(f => <option key={f} value={f} />)}
            </datalist>
          </div>
          <div>
            <label style={labelStyle}>Category *</label>
            <input style={inputStyle} list="cat-opts" value={form.category} onChange={e => setField('category', e.target.value)} placeholder="e.g. Government Bonds" />
            <datalist id="cat-opts">
              {categories.map(c => <option key={c} value={c} />)}
            </datalist>
          </div>
          <div>
            <label style={labelStyle}>Display label</label>
            <input style={inputStyle} value={form.display_label} onChange={e => setField('display_label', e.target.value)} placeholder="(defaults to name)" />
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 16 }}>
          <button
            onClick={addInstrument}
            disabled={saving}
            style={{
              fontSize: 14, fontWeight: 600, padding: '9px 20px', borderRadius: 8, cursor: 'pointer',
              border: 'none', background: '#0ea5e9', color: '#fff', opacity: saving ? 0.6 : 1,
            }}
          >
            {saving ? 'Saving…' : '+ Add instrument'}
          </button>
          {msg && (
            <span style={{ fontSize: 13, color: msg.type === 'ok' ? '#4ade80' : '#f87171' }}>{msg.text}</span>
          )}
        </div>
      </div>

      {/* Existing list */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9', margin: 0 }}>
          Existing instruments {loading ? '' : `(${rows.length})`}
        </h3>
        <input
          style={{ ...inputStyle, width: 240 }}
          placeholder="Search…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      <div style={{ overflowX: 'auto', border: '1px solid #334155', borderRadius: 12 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#1e293b', color: '#94a3b8', textAlign: 'left' }}>
              <th style={{ padding: '10px 12px' }}>Name</th>
              <th style={{ padding: '10px 12px' }}>Category</th>
              <th style={{ padding: '10px 12px' }}>Ticker</th>
              <th style={{ padding: '10px 12px' }}>Field</th>
              <th style={{ padding: '10px 12px' }}>Active</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(r => (
              <tr key={r.name} style={{ borderTop: '1px solid #1e293b', color: '#e2e8f0', opacity: r.is_active ? 1 : 0.5 }}>
                <td style={{ padding: '8px 12px' }}>{r.name}</td>
                <td style={{ padding: '8px 12px', color: '#94a3b8' }}>{r.category}</td>
                <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontSize: 12 }}>{r.bloomberg_ticker}</td>
                <td style={{ padding: '8px 12px', color: '#94a3b8' }}>{r.bloomberg_field}</td>
                <td style={{ padding: '8px 12px' }}>
                  <button
                    onClick={() => toggleActive(r)}
                    style={{
                      fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 10, cursor: 'pointer',
                      border: `1px solid ${r.is_active ? '#4ade80' : '#475569'}`,
                      background: r.is_active ? 'rgba(74,222,128,0.15)' : 'transparent',
                      color: r.is_active ? '#4ade80' : '#64748b',
                    }}
                  >
                    {r.is_active ? 'Active' : 'Inactive'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
