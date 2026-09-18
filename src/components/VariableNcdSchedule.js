import React, { useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

// Month-by-month accrual for a Zaronia-linked variable NCD. Each month the coupon
// resets to (forward Zaronia for that month + fixed spread); interest accrues at
// that rate for the month. The average of the monthly resets is the fair fixed
// rate the curve implies — which is what "the variable prices the fixed" means.

const zar = new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', maximumFractionDigits: 0 });
const VAR_TENORS = [12, 18, 24, 36, 48, 60];
const FIXED_MATCH = { 12: '12m Fixed Rate NCD', 24: '2y Fixed Rate NCD', 36: '3y Fixed Rate NCD2' };

const inp = { background: '#1e293b', border: '1px solid #334155', borderRadius: 6, color: '#e2e8f0', padding: '6px 8px', fontSize: 13 };
const btn = (on) => ({ background: on ? '#0ea5e9' : '#1e293b', border: '1px solid #334155', borderRadius: 6, color: on ? '#fff' : '#94a3b8', padding: '5px 12px', fontSize: 12, cursor: 'pointer', fontWeight: on ? 700 : 400 });

const SchedTip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, padding: '8px 12px' }}>
      <p style={{ color: '#94a3b8', fontSize: 11, margin: 0 }}>Month {d.month}</p>
      <p style={{ color: '#64748b', fontSize: 11, margin: '2px 0 0' }}>Zaronia {d.zaronia}% + spread</p>
      <p style={{ color: '#38bdf8', fontSize: 13, fontWeight: 700, margin: '2px 0 0' }}>{d.yield}%</p>
    </div>
  );
};

export default function VariableNcdSchedule({ latest, instruments }) {
  const [tenor, setTenor] = useState(12);
  const [principal, setPrincipal] = useState(1000000);

  // Zaronia forward blocks (o/n + FRAs)
  const blocks = useMemo(() => {
    if (!latest || !instruments?.length) return [];
    const b = [];
    if (latest['Zaronia'] != null) b.push({ start: 0, end: 1, rate: Number(latest['Zaronia']) });
    instruments.filter(i => i.category === 'FRAs' && i.name.toLowerCase().includes('zaronia')).forEach(f => {
      const m = f.name.match(/(\d+)[Xx×](\d+)/); const v = latest[f.name];
      if (m && v != null) b.push({ start: +m[1], end: +m[2], rate: Number(v) });
    });
    return b.sort((a, b2) => a.start - b2.start);
  }, [latest, instruments]);

  const maxFwd = blocks.length ? blocks[blocks.length - 1].end : 0;
  const fwdForMonth = (m) => { // month m (1-based) covers [m-1, m)
    let last = null;
    for (const b of blocks) { if (b.start <= m - 1 && m - 1 < b.end) return { rate: b.rate, approx: false }; last = b.rate; }
    return last != null ? { rate: last, approx: true } : null;
  };

  const spreadBps = useMemo(() => {
    if (!latest || !instruments) return null;
    const inst = instruments.find(i => i.category === 'Variable Rate NCDs' && i.name.toLowerCase().includes('zaronia') && i.name.startsWith(`${tenor}m`));
    return inst && latest[inst.name] != null ? Number(latest[inst.name]) : null;
  }, [latest, instruments, tenor]);

  const { schedule, totalInterest, effective, avgYield, anyApprox } = useMemo(() => {
    if (spreadBps == null || !blocks.length) return { schedule: [], totalInterest: 0, effective: 0, avgYield: 0, anyApprox: false };
    const DAY = 365;
    const rows = [];
    let balance = principal;
    let cursor = new Date();
    const start = new Date(cursor);
    for (let m = 1; m <= tenor; m++) {
      const f = fwdForMonth(m); if (!f) break;
      const next = new Date(cursor); next.setMonth(next.getMonth() + 1);
      const days = Math.max(1, Math.round((next - cursor) / 86400000));
      const yld = f.rate + spreadBps / 100;
      const factor = Math.pow(1 + (yld / 100) / DAY, days); // Zaronia compounded daily, in arrears
      const interest = balance * (factor - 1);
      balance *= factor;
      rows.push({ month: m, days, zaronia: +f.rate.toFixed(3), yield: +yld.toFixed(3), interest, approx: f.approx });
      cursor = next;
    }
    const totalDays = Math.max(1, Math.round((cursor - start) / 86400000));
    const tot = balance - principal;
    const eff = (Math.pow(balance / principal, 365 / totalDays) - 1) * 100;
    const avg = rows.length ? rows.reduce((a, r) => a + r.yield, 0) / rows.length : 0;
    return { schedule: rows, totalInterest: tot, effective: eff, avgYield: avg, anyApprox: rows.some(r => r.approx) };
  }, [spreadBps, blocks, tenor, principal]); // eslint-disable-line

  const fixedKey = FIXED_MATCH[tenor];
  const fixedRate = fixedKey && latest[fixedKey] != null ? Number(latest[fixedKey]) : null;
  const gap = fixedRate != null ? Math.round((fixedRate - avgYield) * 100) : null;    // nominal rate view
  const effGap = fixedRate != null ? Math.round((effective - fixedRate) * 100) : null; // realized-return view

  if (!latest || !blocks.length) return null;

  return (
    <div style={{ marginTop: 18, borderTop: '1px solid #334155', paddingTop: 16 }}>
      <h4 style={{ fontSize: 13, fontWeight: 700, color: '#cbd5e1', margin: '0 0 4px' }}>Monthly accrual — how the variable NCD earns</h4>
      <p style={{ fontSize: 11, color: '#64748b', margin: '0 0 12px' }}>
        Each month resets to forward Zaronia + spread ({spreadBps != null ? `+${spreadBps.toFixed(1)}bps` : '—'}), compounded daily. The average reset is the fair fixed rate the curve implies; daily compounding then lifts the realized return above it.
      </p>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
        {VAR_TENORS.map(t => <button key={t} onClick={() => setTenor(t)} style={btn(t === tenor)}>{t}m</button>)}
        <span style={{ marginLeft: 12, fontSize: 12, color: '#94a3b8' }}>Amount (R)</span>
        <input type="number" value={principal} onChange={e => setPrincipal(Number(e.target.value) || 0)} style={{ ...inp, width: 140 }} />
      </div>

      {/* monthly yield chart */}
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={schedule} margin={{ top: 16, right: 16, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
          <XAxis dataKey="month" tick={{ fill: '#64748b', fontSize: 10 }} tickFormatter={m => `M${m}`} interval={0} />
          <YAxis domain={['auto', 'auto']} tick={{ fill: '#64748b', fontSize: 10 }} tickFormatter={v => `${v}%`} width={48} />
          <Tooltip content={<SchedTip />} cursor={{ fill: 'rgba(148,163,184,0.08)' }} />
          <Bar dataKey="yield" fill="#38bdf8" radius={[3, 3, 0, 0]} maxBarSize={38} />
        </BarChart>
      </ResponsiveContainer>

      {/* monthly table */}
      <div style={{ maxHeight: 300, overflowY: 'auto', marginTop: 12 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, color: '#e2e8f0' }}>
          <thead>
            <tr style={{ color: '#94a3b8', position: 'sticky', top: 0, background: '#1e293b' }}>
              <th style={{ padding: '6px 10px', textAlign: 'left' }}>Month</th>
              <th style={{ padding: '6px 10px', textAlign: 'right' }}>Zaronia (fwd)</th>
              <th style={{ padding: '6px 10px', textAlign: 'right' }}>Spread</th>
              <th style={{ padding: '6px 10px', textAlign: 'right' }}>Reset yield</th>
              <th style={{ padding: '6px 10px', textAlign: 'right' }}>Interest (month)</th>
            </tr>
          </thead>
          <tbody>
            {schedule.map(r => (
              <tr key={r.month} style={{ borderTop: '1px solid #0f172a' }}>
                <td style={{ padding: '6px 10px', textAlign: 'left', color: '#94a3b8' }}>M{r.month}</td>
                <td style={{ padding: '6px 10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.zaronia.toFixed(3)}%{r.approx ? '*' : ''}</td>
                <td style={{ padding: '6px 10px', textAlign: 'right', color: '#64748b' }}>+{spreadBps.toFixed(1)}bps</td>
                <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 700, color: '#38bdf8' }}>{r.yield.toFixed(3)}%</td>
                <td style={{ padding: '6px 10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{zar.format(r.interest)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: '2px solid #334155', fontWeight: 700 }}>
              <td style={{ padding: '8px 10px', textAlign: 'left', color: '#cbd5e1' }}>Total / avg</td>
              <td colSpan={2} style={{ padding: '8px 10px', textAlign: 'right', color: '#64748b' }}>avg reset</td>
              <td style={{ padding: '8px 10px', textAlign: 'right', color: '#4ade80' }}>{avgYield.toFixed(3)}%</td>
              <td style={{ padding: '8px 10px', textAlign: 'right', color: '#4ade80' }}>{zar.format(totalInterest)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div style={{ marginTop: 14, padding: 12, background: '#0f172a', borderRadius: 10, fontSize: 13, color: '#cbd5e1', lineHeight: 1.6 }}>
        <div>Projected return on {zar.format(principal)}: <strong style={{ color: '#4ade80' }}>{zar.format(totalInterest)}</strong> = <strong>{effective.toFixed(2)}% p.a. effective</strong> (Zaronia compounded daily in arrears).</div>
        <div style={{ marginTop: 4, color: '#94a3b8' }}>Average reset rate: <strong style={{ color: '#cbd5e1' }}>{avgYield.toFixed(2)}%</strong> (nominal) — the like-for-like number vs a quoted fixed rate; daily compounding lifts it to the {effective.toFixed(2)}% effective above.</div>
        {fixedRate != null ? (
          <div style={{ marginTop: 6 }}>
            vs the traded <strong>{tenor}m fixed NCD at {fixedRate.toFixed(2)}%</strong>: nominal{' '}
            <strong style={{ color: gap >= 0 ? '#4ade80' : '#fbbf24' }}>{gap >= 0 ? '+' : ''}{gap} bps</strong> in the fixed (term premium), but on realized cash the floater's daily compounding lands{' '}
            <strong style={{ color: effGap >= 0 ? '#4ade80' : '#fbbf24' }}>{effGap >= 0 ? '+' : ''}{effGap} bps</strong> {effGap >= 0 ? 'ahead of' : 'behind'} the fixed's simple rate.
          </div>
        ) : (
          <div style={{ marginTop: 6, color: '#64748b' }}>No traded {tenor}m fixed NCD to compare against directly.</div>
        )}
      </div>

      {anyApprox && (
        <p style={{ fontSize: 11, color: '#475569', margin: '10px 4px 0' }}>
          * Months past the FRA curve ({maxFwd}m) hold the last forward flat, so those resets are approximate.
        </p>
      )}
      <p style={{ fontSize: 11, color: '#475569', margin: '8px 4px 0' }}>
        Zaronia compounded daily in arrears (ACT/365), spread added to each day's rate. Forward Zaronia from the FRA strip — actual daily resets will differ. Fixed NCDs are quoted simple, so use the "average reset" line for a rate-vs-rate view and the effective line for realized cash.
      </p>
    </div>
  );
}
