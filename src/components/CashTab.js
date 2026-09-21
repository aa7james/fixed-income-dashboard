import React, { useMemo, useState, useEffect } from 'react';
import { supabase } from '../utils/supabase';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList,
} from 'recharts';
import CashScenario from './CashScenario';
import VariableNcdSchedule from './VariableNcdSchedule';

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

// Bonds with a nominal YTM roll into cash near maturity; ILBs quote real yields, so exclude.
const BOND_CATS = ['Government Bonds', 'SOE / Corporate Bonds', 'International'];

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

const IncrTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  return (
    <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, padding: '8px 12px' }}>
      <p style={{ color: '#94a3b8', fontSize: 11, margin: 0 }}>{d.label}</p>
      <p style={{ color: '#38bdf8', fontSize: 13, fontWeight: 700, margin: '2px 0 0' }}>+{d.incr}% vs base</p>
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

  // Short-dated bonds (<= 12 months to maturity) — cash-like
  const shortBonds = useMemo(() => {
    if (!latest || !instruments?.length) return [];
    const now = new Date();
    return instruments
      .filter(i => BOND_CATS.includes(i.category) && i.maturity_date)
      .map(i => {
        const months = (new Date(i.maturity_date) - now) / (1000 * 60 * 60 * 24 * 30.44);
        const yld = latest[i.name];
        return { label: i.display_label || i.name, maturity: i.maturity_date, months, yld: yld == null ? null : Number(yld) };
      })
      .filter(b => b.months > 0 && b.months <= 12 && b.yld != null)
      .sort((a, b) => a.months - b.months);
  }, [latest, instruments]);

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

  // Cumulative increase from base: each forward rate minus today's Zaronia (in %).
  const fraIncrease = useMemo(() => {
    if (!latest || !instruments?.length) return [];
    const base = latest['Zaronia'];
    if (base == null) return [];
    return instruments
      .filter(i => i.category === 'FRAs' && i.name.toLowerCase().includes('zaronia'))
      .map(f => {
        const v = latest[f.name];
        const m = f.name.match(/(\d+)[Xx×](\d+)/);
        if (v == null || !m) return null;
        return { label: `${m[1]}x${m[2]}`, month: +m[2], incr: +(Number(v) - Number(base)).toFixed(2) };
      })
      .filter(Boolean)
      .sort((a, b) => a.month - b.month);
  }, [latest, instruments]);

  const fraRead = useMemo(() => {
    if (fraPath.length < 2) return null;
    const first = fraPath[0].rate, last = fraPath[fraPath.length - 1].rate;
    const bps = Math.round((last - first) * 100);
    if (Math.abs(bps) < 5) return { dir: 'flat', text: `The forward curve is roughly flat — the market expects the short rate to stay near ${first.toFixed(2)}%.` };
    if (bps < 0) return { dir: 'down', text: `The market is pricing the short rate ${Math.abs(bps)}bps LOWER over the next ~${fraPath[fraPath.length - 1].month} months (from ${first.toFixed(2)}% to ${last.toFixed(2)}%) — i.e. rate cuts. Locking term now captures today's higher rates before they fall.` };
    return { dir: 'up', text: `The market is pricing the short rate ${bps}bps HIGHER over the next ~${fraPath[fraPath.length - 1].month} months (from ${first.toFixed(2)}% to ${last.toFixed(2)}%) — i.e. rate hikes. Staying short and rolling may beat locking term.` };
  }, [fraPath]);

  // Zaronia forward blocks (o/n + FRAs), used to project where a floating rate averages.
  const fwdBlocks = useMemo(() => {
    if (!latest || !instruments?.length) return [];
    const blocks = [];
    if (latest['Zaronia'] != null) blocks.push({ start: 0, end: 1, rate: Number(latest['Zaronia']) });
    instruments.filter(i => i.category === 'FRAs' && i.name.toLowerCase().includes('zaronia')).forEach(f => {
      const m = f.name.match(/(\d+)[Xx×](\d+)/);
      const v = latest[f.name];
      if (m && v != null) blocks.push({ start: +m[1], end: +m[2], rate: Number(v) });
    });
    return blocks.sort((a, b) => a.start - b.start);
  }, [latest, instruments]);

  const maxFwdMonth = fwdBlocks.length ? fwdBlocks[fwdBlocks.length - 1].end : 0;

  // Average expected Zaronia over [0, T] from the forward strip; holds the last
  // forward flat if the tenor runs past the FRA curve.
  const avgForward = (T) => {
    if (!fwdBlocks.length) return null;
    let acc = 0, cov = 0, last = null;
    for (const b of fwdBlocks) {
      if (b.start >= T) break;
      const s = Math.max(b.start, cov), e = Math.min(b.end, T);
      if (e > s) { acc += b.rate * (e - s); cov = e; }
      last = b.rate;
    }
    if (cov < T && last != null) { acc += last * (T - cov); cov = T; }
    return cov > 0 ? acc / cov : null;
  };

  // Variable Rate NCDs: spread (bps over Zaronia), current all-in, and where the
  // FRA curve implies the all-in averages over the life of the note.
  const varNcd = useMemo(() => {
    if (!latest || !instruments?.length) return [];
    const on = latest['Zaronia'] == null ? null : Number(latest['Zaronia']);
    return instruments
      .filter(i => i.category === 'Variable Rate NCDs' && i.name.toLowerCase().includes('zaronia'))
      .map(i => {
        const spreadBps = latest[i.name] == null ? null : Number(latest[i.name]);
        const tenorLbl = (i.name.match(/^(\d+m)/) || [])[1] || (i.display_label || i.name);
        const months = parseInt(tenorLbl, 10);
        const current = (on != null && spreadBps != null) ? on + spreadBps / 100 : null;
        const avgFwd = avgForward(months);
        const fraImplied = (avgFwd != null && spreadBps != null) ? avgFwd + spreadBps / 100 : null;
        const effective = fraImplied != null ? (Math.pow(1 + fraImplied / 100 / 365, 365) - 1) * 100 : null;
        return { tenor: tenorLbl, months, spreadBps, current, fraImplied, effective, approx: months > maxFwdMonth };
      })
      .filter(x => x.spreadBps != null)
      .sort((a, b) => a.months - b.months);
  }, [latest, instruments, fwdBlocks]); // eslint-disable-line

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

      {/* SECTION 2 — short-dated bonds (cash-like) */}
      {shortBonds.length > 0 && (
        <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 12, padding: 16, marginBottom: 24 }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9', margin: '0 0 4px' }}>Short-dated bonds (≤ 1 year) — cash-like</h3>
          <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 12px' }}>
            Nominal bonds within a year of maturity behave like cash. Yield shown is the bond's YTM; "vs Call" is the pickup over call (bps).
          </p>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, color: '#e2e8f0' }}>
              <thead>
                <tr style={{ color: '#94a3b8' }}>
                  <th style={{ padding: '8px 12px', textAlign: 'left' }}>Bond</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left' }}>Matures</th>
                  <th style={cell()}>Term left</th>
                  <th style={cell()}>Yield (YTM)</th>
                  <th style={cell()}>vs Call</th>
                </tr>
              </thead>
              <tbody>
                {shortBonds.map(b => (
                  <tr key={b.label} style={{ borderTop: '1px solid #0f172a' }}>
                    <td style={{ padding: '8px 12px', textAlign: 'left', color: '#e2e8f0', fontWeight: 600 }}>{b.label}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'left', color: '#94a3b8' }}>{b.maturity}</td>
                    <td style={cell({ color: '#94a3b8' })}>{b.months < 1 ? '<1' : Math.round(b.months)} mo</td>
                    <td style={cell({ fontWeight: 700 })}>{b.yld.toFixed(2)}%</td>
                    <td style={cell({ color: '#475569', fontSize: 12 })}>{fmtPickup(b.yld)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SECTION 2b — variable rate NCDs (floating = Zaronia + spread) */}
      {varNcd.length > 0 && (
        <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 12, padding: 16, marginBottom: 24 }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9', margin: '0 0 4px' }}>Variable Rate NCDs (floating)</h3>
          <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 12px' }}>
            Resets to Zaronia ({latest['Zaronia'] != null ? Number(latest['Zaronia']).toFixed(3) : '—'}%) + spread. <strong style={{ color: '#94a3b8' }}>Current</strong> = all-in if Zaronia stays flat.
            {' '}<strong style={{ color: '#38bdf8' }}>FRA-implied</strong> = spread + the average Zaronia the forward curve prices over the note's life (nominal — compare to quoted rates).
            {' '}<strong style={{ color: '#4ade80' }}>Effective</strong> = that path compounded daily (the realized return).
          </p>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, color: '#e2e8f0' }}>
              <thead>
                <tr style={{ color: '#94a3b8' }}>
                  <th style={{ padding: '8px 12px', textAlign: 'left' }}>Tenor</th>
                  <th style={cell()}>Spread</th>
                  <th style={cell()}>Current all-in</th>
                  <th style={cell()}>FRA-implied (nominal)</th>
                  <th style={cell()}>Effective (daily comp.)</th>
                  <th style={cell()}>Diff</th>
                </tr>
              </thead>
              <tbody>
                {varNcd.map(v => {
                  const diffBps = (v.current != null && v.fraImplied != null) ? Math.round((v.fraImplied - v.current) * 100) : null;
                  return (
                    <tr key={v.tenor} style={{ borderTop: '1px solid #0f172a' }}>
                      <td style={{ padding: '8px 12px', textAlign: 'left', color: '#e2e8f0', fontWeight: 600 }}>{v.tenor}</td>
                      <td style={cell({ color: '#94a3b8' })}>+{v.spreadBps.toFixed(1)} bps</td>
                      <td style={cell({ fontWeight: 700 })}>{v.current == null ? '—' : `${v.current.toFixed(2)}%`}</td>
                      <td style={cell({ fontWeight: 700, color: '#38bdf8' })}>
                        {v.fraImplied == null ? '—' : `${v.fraImplied.toFixed(2)}%`}{v.approx ? '*' : ''}
                      </td>
                      <td style={cell({ fontWeight: 700, color: '#4ade80' })}>
                        {v.effective == null ? '—' : `${v.effective.toFixed(2)}%`}{v.approx ? '*' : ''}
                      </td>
                      <td style={cell({ color: diffBps == null ? '#475569' : diffBps >= 0 ? '#4ade80' : '#fbbf24', fontSize: 12 })}>
                        {diffBps == null ? '' : `${diffBps >= 0 ? '+' : ''}${diffBps} bps`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {varNcd.some(v => v.approx) && (
            <p style={{ fontSize: 11, color: '#475569', margin: '10px 4px 0' }}>
              * Tenor runs past the FRA curve ({maxFwdMonth}m); the last forward is held flat beyond that, so the FRA-implied rate is approximate.
            </p>
          )}
          <VariableNcdSchedule latest={latest} instruments={instruments} />
        </div>
      )}

      {/* SECTION 3 — what the market is pricing (Zaronia forward curve) */}
      {fraPath.length > 1 && (
        <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 12, padding: 16, marginBottom: 24 }}>
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

          {/* Cumulative increase from base (as in Market Pricing) */}
          {fraIncrease.length > 0 && (
            <>
              <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: '#64748b', margin: '20px 0 8px' }}>
                Cumulative increase from base
              </p>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={fraIncrease} margin={{ top: 20, right: 20, left: 0, bottom: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis
                    dataKey="month" type="number" domain={[0, 'dataMax']}
                    ticks={fraIncrease.map(d => d.month)}
                    tickFormatter={m => { const pt = fraIncrease.find(d => d.month === m); return pt ? pt.label : m; }}
                    tick={{ fill: '#64748b', fontSize: 9 }} interval={0}
                  />
                  <YAxis domain={[0, 'auto']} tick={{ fill: '#64748b', fontSize: 10 }} tickFormatter={v => `${v}%`} width={50} />
                  <Tooltip content={<IncrTooltip />} />
                  <Bar dataKey="incr" name="Cum. Increase" fill="#38bdf8" radius={[4, 4, 0, 0]} barSize={28}>
                    <LabelList dataKey="incr" position="top" style={{ fill: '#94a3b8', fontSize: 10 }} formatter={v => v != null ? `${v}%` : ''} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </>
          )}
        </div>
      )}

      {/* SECTION 4 — scenario comparator */}
      <CashScenario latest={latest} instruments={instruments} markers={markers} />
    </div>
  );
}
