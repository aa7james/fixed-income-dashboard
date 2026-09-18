import React, { useMemo, useState, useEffect } from 'react';
import { supabase } from '../utils/supabase';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList,
} from 'recharts';

// Cash instruments by tenor column. Values come from bond_data (latest row)
// or the manual reference levels (Call / MM) in yield_curve_markers.
const TENOR_COLS = ['O/N', '3m', '6m', '9m', '12m'];

const ROWS = [
  { label: 'Call',            src: { 'O/N': { marker: 'Call' } } },
  { label: 'Call (Flex)',     src: { 'O/N': { marker: 'Call (Flex)' } } },
  { label: 'Money Market',    src: { 'O/N': { marker: 'MM' } } },
  { label: 'Zaronia (o/n)',   src: { 'O/N': { key: 'Zaronia' } } },
  { label: 'Repo',            src: { 'O/N': { key: 'Repo Rate' } } },
  { label: 'JIBAR',           src: { '3m': { key: '3m JIBAR' }, '6m': { key: '6m JIBAR' }, '9m': { key: '9m JIBAR' }, '12m': { key: '12m JIBAR' } } },
  { label: 'T-Bill',          src: { '3m': { key: '3m T-Bill' }, '6m': { key: '6m T-Bill' }, '9m': { key: '9m T-Bill' }, '12m': { key: '12m T-Bill' } } },
  { label: 'Fixed Rate NCD',  src: { '3m': { key: '3m Fixed Rate NCD' }, '6m': { key: '6m Fixed Rate NCD' }, '9m': { key: '9m Fixed Rate NCD' }, '12m': { key: '12m Fixed Rate NCD' } } },
];

function tenorEndMonth(name) {
  const m = name.match(/(\d+)[Xx×](\d+)/);
  return m ? parseInt(m[2], 10) : 999;
}

const cell = (styleExtra = {}) => ({
  padding: '8px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', ...styleExtra,
});

const FraTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  return (
    <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, padding: '8px 12px' }}>
      <p style={{ color: '#94a3b8', fontSize: 11, margin: 0 }}>{d.label}</p>
      <p style={{ color: '#38bdf8', fontSize: 13, fontWeight: 700, margin: '2px 0 0' }}>{d.rate}%</p>
    </div>
  );
};

export default function CashTab({ data, instruments }) {
  const latest = data?.dataRows?.length ? data.dataRows[data.dataRows.length - 1] : null;
  const [markers, setMarkers] = useState([]);
  useEffect(() => {
    supabase.from('yield_curve_markers').select('label,value').then(({ data: rows }) => setMarkers(rows || [])).catch(() => {});
  }, []);

  const markerVal = (label) => {
    const m = markers.find(x => (x.label || '').toLowerCase() === label.toLowerCase());
    return m ? Number(m.value) : null;
  };

  const getVal = (src) => {
    if (!src) return null;
    if (src.marker) return markerVal(src.marker);
    if (src.key && latest) { const v = latest[src.key]; return v == null ? null : Number(v); }
    return null;
  };

  const callRate = markerVal('Call'); // benchmark for "pickup vs call"

  // Best payer per tenor column
  const bestByCol = useMemo(() => {
    const best = {};
    TENOR_COLS.forEach(col => {
      let max = -Infinity;
      ROWS.forEach(r => { const v = getVal(r.src[col]); if (v != null && v > max) max = v; });
      best[col] = max === -Infinity ? null : max;
    });
    return best;
  }, [markers, latest]); // eslint-disable-line

  // What the market is pricing: Zaronia forward (FRA) curve
  const fraPath = useMemo(() => {
    if (!latest || !instruments?.length) return [];
    const base = latest['Zaronia'];
    const fras = instruments.filter(i => i.category === 'FRAs' && i.name.toLowerCase().includes('zaronia'));
    const pts = [];
    if (base != null) pts.push({ month: 0, label: 'Zaronia o/n', rate: +Number(base).toFixed(2) });
    fras.forEach(f => {
      const v = latest[f.name];
      if (v == null) return;
      pts.push({ month: tenorEndMonth(f.name), label: (f.display_label || f.name), rate: +Number(v).toFixed(2) });
    });
    pts.sort((a, b) => a.month - b.month);
    return pts;
  }, [latest, instruments]);

  const fraRead = useMemo(() => {
    if (fraPath.length < 2) return null;
    const first = fraPath[0].rate, last = fraPath[fraPath.length - 1].rate;
    const delta = +(last - first).toFixed(2);
    const bps = Math.round(delta * 100);
    if (Math.abs(bps) < 5) return { dir: 'flat', text: `The forward curve is roughly flat — the market expects the short rate to stay near ${first.toFixed(2)}%.` };
    if (bps < 0) return { dir: 'down', text: `The market is pricing the short rate ${Math.abs(bps)}bps LOWER over the next ~${fraPath[fraPath.length - 1].month} months (from ${first.toFixed(2)}% to ${last.toFixed(2)}%) — i.e. rate cuts. Locking term now captures today's higher rates before they fall.` };
    return { dir: 'up', text: `The market is pricing the short rate ${bps}bps HIGHER over the next ~${fraPath[fraPath.length - 1].month} months (from ${first.toFixed(2)}% to ${last.toFixed(2)}%) — i.e. rate hikes. Staying short and rolling may beat locking term.` };
  }, [fraPath]);

  const fmt = (v) => v == null ? '—' : v.toFixed(2);
  const fmtPickup = (v) => v == null || callRate == null ? '' : `${v - callRate >= 0 ? '+' : ''}${((v - callRate) * 100).toFixed(0)}`;

  if (!latest) return <div style={{ color: '#64748b' }}>No data available.</div>;

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: '#f1f5f9', margin: 0 }}>Cash</h2>
        <p style={{ fontSize: 13, color: '#64748b', margin: '2px 0 0' }}>
          What's on offer vs. what the market is pricing · as at {latest.dateStr}
        </p>
      </div>

      {/* SECTION 1 — cash on offer */}
      <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 12, padding: 16, marginBottom: 24 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9', margin: '0 0 4px' }}>Cash on offer</h3>
        <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 12px' }}>
          Yields by tenor. <span style={{ color: '#4ade80' }}>Green</span> = best payer for that tenor. "vs Call" = pickup over the call rate (bps).
        </p>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, color: '#e2e8f0' }}>
            <thead>
              <tr style={{ color: '#94a3b8', textAlign: 'right' }}>
                <th style={{ padding: '8px 12px', textAlign: 'left' }}>Instrument</th>
                {TENOR_COLS.map(c => <th key={c} style={cell()}>{c}</th>)}
              </tr>
            </thead>
            <tbody>
              {ROWS.map(r => (
                <tr key={r.label} style={{ borderTop: '1px solid #0f172a' }}>
                  <td style={{ padding: '8px 12px', textAlign: 'left', color: '#94a3b8' }}>{r.label}</td>
                  {TENOR_COLS.map(col => {
                    const v = getVal(r.src[col]);
                    const isBest = v != null && bestByCol[col] != null && v === bestByCol[col] && col !== 'O/N';
                    return (
                      <td key={col} style={cell(isBest ? { color: '#4ade80', fontWeight: 700 } : {})}>
                        {v == null ? '—' : (
                          <>
                            {fmt(v)}%
                            {col !== 'O/N' && callRate != null && (
                              <span style={{ color: '#475569', fontSize: 11, marginLeft: 6 }}>{fmtPickup(v)}</span>
                            )}
                          </>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* SECTION 2 — what the market is pricing (Zaronia forward curve) */}
      {fraPath.length > 1 && (
        <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 12, padding: 16 }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9', margin: '0 0 4px' }}>What the market is pricing in</h3>
          <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 12px' }}>
            Zaronia forward curve (FRAs) — the market's expected path of the short rate.
          </p>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={fraPath} margin={{ top: 16, right: 40, left: 0, bottom: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#0f172a" />
              <XAxis dataKey="label" tick={{ fill: '#64748b', fontSize: 10 }} interval={0} angle={-30} textAnchor="end" height={50} />
              <YAxis domain={['auto', 'auto']} tick={{ fill: '#64748b', fontSize: 10 }} tickFormatter={v => `${v}%`} width={50} />
              <Tooltip content={<FraTooltip />} />
              <Line type="monotone" dataKey="rate" stroke="#38bdf8" strokeWidth={2} dot={{ r: 3, fill: '#38bdf8' }} connectNulls>
                <LabelList dataKey="rate" position="top" style={{ fill: '#38bdf8', fontSize: 9 }} formatter={v => `${v}%`} />
              </Line>
            </LineChart>
          </ResponsiveContainer>
          {fraRead && (
            <p style={{ fontSize: 13, color: '#cbd5e1', margin: '10px 4px 0', lineHeight: 1.5 }}>
              <strong style={{ color: fraRead.dir === 'down' ? '#4ade80' : fraRead.dir === 'up' ? '#f87171' : '#94a3b8' }}>
                {fraRead.dir === 'down' ? '↓ Cuts priced' : fraRead.dir === 'up' ? '↑ Hikes priced' : '→ Flat'}:
              </strong>{' '}
              {fraRead.text}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
