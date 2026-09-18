import React, { useMemo, useState, useEffect } from 'react';
import { supabase } from '../utils/supabase';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList,
} from 'recharts';
import CashScenario from './CashScenario';

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

  const fraRead = useMemo(() => {
    if (fraPath.length < 2) return null;
    const first = fraPath[0].rate, last = fraPath[fraPath.length - 1].rate;
    const bps = Math.round((last - first) * 100);
    if (Math.abs(bps) < 5) return { dir: 'flat', text: `The forward curve is roughly flat — the market expects the short rate to stay near ${first.toFixed(2)}%.` };
    if (bps < 0) return { dir: 'down', text: `The market is pricing the short rate ${Math.abs(bps)}bps LOWER over the next ~${fraPath[fraPath.length - 1].month} months (from ${first.toFixed(2)}% to ${last.toFixed(2)}%) — i.e. rate cuts. Locking term now captures today's higher rates before they fall.` };
    return { dir: 'up', text: `The market is pricing the short rate ${bps}bps HIGHER over the next ~${fraPath[fraPath.length - 1].month} months (from ${first.toFixed(2)}% to ${last.toFixed(2)}%) — i.e. rate hikes. Staying short and rolling may beat locking term.` };
  }, [fraPath]);

  // Variable Rate NCDs: floating = Zaronia + spread (spread stored in bps, over Zaronia).
  const varNcd = useMemo(() => {
    if (!latest || !instruments?.length) return [];
    const on = latest['Zaronia'] == null ? null : Number(latest['Zaronia']);
    return instruments
      .filter(i => i.category === 'Variable Rate NCDs' && i.name.toLowerCase().includes('zaronia'))
      .map(i => {
        const spreadBps = latest[i.name] == null ? null : Number(latest[i.name]);
        const tenor = (i.name.match(/^(\d+m)/) || [])[1] || (i.display_label || i.name);
        return { tenor, spreadBps, allIn: (on != null && spreadBps != null) ? on + spreadBps / 100 : null };
      })
      .filter(x => x.spreadBps != null)
      .sort((a, b) => parseInt(a.tenor, 10) - parseInt(b.tenor, 10));
  }, [latest, instruments]);

  // Term vs roll: lock the best term rate now, or stay short and roll the Zaronia strip?
  // Build the forward 3-month strip from the Zaronia FRAs. The spot 3m (months 0-3)
  // isn't quoted directly, so approximate it from the overnight + 1x2 + 2x3 forwards.
  const termVsRoll = useMemo(() => {
    if (!latest) return [];
    const num = k => latest[k] == null ? null : Number(latest[k]);
    const near = [num('Zaronia'), num('FRA 1x2 - Zaronia'), num('FRA 2x3 - Zaronia')].filter(x => x != null);
    const spot3 = near.length ? near.reduce((a, b) => a + b, 0) / near.length : null;
    const blocks = [spot3, num('FRA 3X6 - Zaronia'), num('FRA 6X9 - Zaronia'), num('FRA 9X12 - Zaronia')]; // 0-3, 3-6, 6-9, 9-12
    if (blocks[0] == null) return [];
    const horizons = [
      { col: '6m',  n: 2, label: '6 months' },
      { col: '9m',  n: 3, label: '9 months' },
      { col: '12m', n: 4, label: '12 months' },
    ];
    return horizons.map(h => {
      const legs = blocks.slice(0, h.n);
      if (legs.some(x => x == null)) return null;
      const roll = legs.reduce((a, b) => a + b, 0) / legs.length; // avg forward-3m over the horizon
      const lock = bestByCol[h.col];
      if (lock == null) return null;
      const pickup = Math.round((lock - roll) * 100); // bps: +ve => locking beats expected roll
      const verdict = pickup > 5 ? 'Lock' : pickup < -5 ? 'Roll' : 'Neutral';
      return { ...h, lock, roll, pickup, verdict };
    }).filter(Boolean);
  }, [latest, bestByCol]);

  const bestLock = useMemo(() => {
    const wins = termVsRoll.filter(r => r.pickup > 5);
    if (!wins.length) return null;
    return wins.reduce((a, b) => b.pickup > a.pickup ? b : a);
  }, [termVsRoll]);

  const fmt = (v) => v == null ? '—' : v.toFixed(2);
  const fmtPickup = (v) => v == null || callRate == null ? '' : `${v - callRate >= 0 ? '+' : ''}${((v - callRate) * 100).toFixed(0)}`;
  const vColor = (v) => v === 'Lock' ? '#4ade80' : v === 'Roll' ? '#fbbf24' : '#94a3b8';

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
            All-in rate = Zaronia ({latest['Zaronia'] != null ? Number(latest['Zaronia']).toFixed(3) : '—'}%) + spread. Resets with Zaronia, so the all-in moves as the o/n rate moves.
          </p>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, color: '#e2e8f0' }}>
              <thead>
                <tr style={{ color: '#94a3b8' }}>
                  <th style={{ padding: '8px 12px', textAlign: 'left' }}>Tenor</th>
                  <th style={cell()}>Spread over Zaronia</th>
                  <th style={cell()}>All-in (today)</th>
                  <th style={cell()}>vs Call</th>
                </tr>
              </thead>
              <tbody>
                {varNcd.map(v => (
                  <tr key={v.tenor} style={{ borderTop: '1px solid #0f172a' }}>
                    <td style={{ padding: '8px 12px', textAlign: 'left', color: '#e2e8f0', fontWeight: 600 }}>{v.tenor}</td>
                    <td style={cell({ color: '#94a3b8' })}>+{v.spreadBps.toFixed(1)} bps</td>
                    <td style={cell({ fontWeight: 700 })}>{v.allIn == null ? '—' : `${v.allIn.toFixed(2)}%`}</td>
                    <td style={cell({ color: '#475569', fontSize: 12 })}>{v.allIn == null ? '' : fmtPickup(v.allIn)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
        </div>
      )}

      {/* SECTION 4 — term vs roll (the decision) */}
      {termVsRoll.length > 0 && (
        <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 12, padding: 16 }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9', margin: '0 0 4px' }}>Lock or roll?</h3>
          <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 12px' }}>
            "Lock" = best term rate you can put on now. "Roll (implied)" = the market's expected return from staying short
            and rolling the 3-month JIBAR strip over the same horizon. Pickup &gt; 0 means locking beats the expected roll.
          </p>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, color: '#e2e8f0' }}>
              <thead>
                <tr style={{ color: '#94a3b8' }}>
                  <th style={{ padding: '8px 12px', textAlign: 'left' }}>Horizon</th>
                  <th style={cell()}>Lock now</th>
                  <th style={cell()}>Roll (implied)</th>
                  <th style={cell()}>Pickup for locking</th>
                  <th style={cell()}>Verdict</th>
                </tr>
              </thead>
              <tbody>
                {termVsRoll.map(r => (
                  <tr key={r.col} style={{ borderTop: '1px solid #0f172a' }}>
                    <td style={{ padding: '8px 12px', textAlign: 'left', color: '#94a3b8' }}>{r.label}</td>
                    <td style={cell({ fontWeight: 700 })}>{r.lock.toFixed(2)}%</td>
                    <td style={cell({ color: '#cbd5e1' })}>{r.roll.toFixed(2)}%</td>
                    <td style={cell({ color: r.pickup >= 0 ? '#4ade80' : '#fbbf24', fontWeight: 700 })}>
                      {r.pickup >= 0 ? '+' : ''}{r.pickup} bps
                    </td>
                    <td style={cell({ color: vColor(r.verdict), fontWeight: 700 })}>{r.verdict}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ fontSize: 13, color: '#cbd5e1', margin: '12px 4px 0', lineHeight: 1.5 }}>
            <strong style={{ color: bestLock ? '#4ade80' : '#fbbf24' }}>
              {bestLock ? '✓ Sweet spot' : '→ Stay short'}:
            </strong>{' '}
            {bestLock
              ? `Locking ${bestLock.label} at ${bestLock.lock.toFixed(2)}% earns +${bestLock.pickup}bps over what the market expects rolling to return (${bestLock.roll.toFixed(2)}%) — the best term pickup on the curve.`
              : `The market prices rolling short to match or beat every term rate on offer, so there's no reward for locking out — stay short and roll.`}
          </p>
          <p style={{ fontSize: 11, color: '#475569', margin: '8px 4px 0', lineHeight: 1.4 }}>
            Roll return = simple average of the forward 3-month Zaronia strip (spot 3m + FRAs). Indicative; ignores
            compounding and the small credit/liquidity spread of T-Bills &amp; NCDs over the o/n benchmark.
          </p>
        </div>
      )}

      {/* SECTION 5 — scenario calculator */}
      <CashScenario latest={latest} instruments={instruments} markers={markers} />
    </div>
  );
}
