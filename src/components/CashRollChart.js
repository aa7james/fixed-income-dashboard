import React, { useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';

// Value-over-time of three cash strategies priced off the FRA curve:
//   3m rolled x4, 6m rolled x2, 12m locked x1.
// When each roll happens at the forward rate, all three end at the SAME value —
// the visual statement of "rolling = locking" (no-arbitrage). A dashed line shows
// the traded 12m NCD; any gap above the bundle is the credit + term premium.

// Time-weighted average forward rate over [a,b] from the Zaronia forward blocks.
function avgOver(blocks, a, b) {
  let acc = 0, cov = 0, last = null;
  for (const bl of blocks) {
    const s = Math.max(bl.start, a), e = Math.min(bl.end, b);
    if (e > s) { acc += bl.rate * (e - s); cov += (e - s); }
    if (bl.start < b) last = bl.rate;
  }
  if (cov < (b - a) && last != null) { acc += last * ((b - a) - cov); cov = b - a; }
  return cov > 0 ? acc / cov : null;
}

// Value of a strategy (base 100) at a given month. Simple interest within each
// leg, reinvested (compounded) at each roll.
function pathValue(legs, month) {
  let base = 100, elapsed = 0;
  for (const leg of legs) {
    if (month <= elapsed) return base;
    const within = Math.min(month - elapsed, leg.len);
    if (within < leg.len) return base * (1 + (leg.rate / 100) * (within / 12));
    base *= (1 + (leg.rate / 100) * (leg.len / 12));
    elapsed += leg.len;
  }
  return base;
}

const RollTip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, padding: '10px 12px' }}>
      <p style={{ color: '#94a3b8', fontSize: 11, margin: '0 0 4px' }}>Month {label}</p>
      {payload.map(p => (
        <p key={p.dataKey} style={{ color: p.color, fontSize: 12, margin: '2px 0' }}>
          {p.name}: <strong>{p.value?.toFixed(2)}</strong> ({(p.value - 100).toFixed(2)}%)
        </p>
      ))}
    </div>
  );
};

export default function CashRollChart({ latest, instruments }) {
  const model = useMemo(() => {
    if (!latest || !instruments?.length) return null;
    const blocks = [];
    if (latest['Zaronia'] != null) blocks.push({ start: 0, end: 1, rate: Number(latest['Zaronia']) });
    instruments.filter(i => i.category === 'FRAs' && i.name.toLowerCase().includes('zaronia')).forEach(f => {
      const m = f.name.match(/(\d+)[Xx×](\d+)/); const v = latest[f.name];
      if (m && v != null) blocks.push({ start: +m[1], end: +m[2], rate: Number(v) });
    });
    blocks.sort((a, b) => a.start - b.start);

    const f1 = avgOver(blocks, 0, 3), f2 = avgOver(blocks, 3, 6), f3 = avgOver(blocks, 6, 9), f4 = avgOver(blocks, 9, 12);
    if ([f1, f2, f3, f4].some(x => x == null)) return null;

    const q = r => 1 + (r / 100) * 0.25; // 3-month simple factor
    const r6a = ((q(f1) * q(f2)) - 1) / 0.5 * 100;   // 6m rate = compounded first two 3m legs
    const r6b = ((q(f3) * q(f4)) - 1) / 0.5 * 100;
    const r12 = ((q(f1) * q(f2) * q(f3) * q(f4)) - 1) * 100; // 12m rate = compounded strip

    const legs3 = [{ len: 3, rate: f1 }, { len: 3, rate: f2 }, { len: 3, rate: f3 }, { len: 3, rate: f4 }];
    const legs6 = [{ len: 6, rate: r6a }, { len: 6, rate: r6b }];
    const legs12 = [{ len: 12, rate: r12 }];

    const tradedNcd = latest['12m Fixed NCD'] != null ? Number(latest['12m Fixed NCD']) : null;

    const data = [];
    for (let m = 0; m <= 12; m++) {
      data.push({
        month: m,
        roll3: +pathValue(legs3, m).toFixed(3),
        roll6: +pathValue(legs6, m).toFixed(3),
        lock12: +pathValue(legs12, m).toFixed(3),
        ...(tradedNcd != null ? { traded: +(100 * (1 + (tradedNcd / 100) * (m / 12))).toFixed(3) } : {}),
      });
    }
    return { data, f: [f1, f2, f3, f4], r12, tradedNcd };
  }, [latest, instruments]);

  if (!model) return null;
  const endVal = model.data[12].lock12;

  return (
    <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 12, padding: 16, marginBottom: 24 }}>
      <h3 style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9', margin: '0 0 4px' }}>Rolling vs locking — value over 12 months</h3>
      <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 12px' }}>
        R100 growing over a year, priced off the FRA curve. Roll 3m ×4, roll 6m ×2, or lock 12m — when each roll is at the forward rate they all finish at the same value ({endVal.toFixed(2)}). That's "rolling = locking".
      </p>
      <ResponsiveContainer width="100%" height={320}>
        <LineChart data={model.data} margin={{ top: 10, right: 24, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#0f172a" />
          <XAxis dataKey="month" tick={{ fill: '#64748b', fontSize: 10 }} ticks={[0, 3, 6, 9, 12]} tickFormatter={m => `${m}m`} />
          <YAxis domain={[100, 'auto']} tick={{ fill: '#64748b', fontSize: 10 }} width={44} allowDecimals />
          <Tooltip content={<RollTip />} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Line type="monotone" dataKey="roll3" name="3m rolled ×4" stroke="#38bdf8" strokeWidth={2} dot={{ r: 2 }} isAnimationActive={false} />
          <Line type="monotone" dataKey="roll6" name="6m rolled ×2" stroke="#a78bfa" strokeWidth={2} dot={{ r: 2 }} isAnimationActive={false} />
          <Line type="monotone" dataKey="lock12" name="12m locked" stroke="#4ade80" strokeWidth={2} dot={{ r: 2 }} isAnimationActive={false} />
          {model.tradedNcd != null && (
            <Line type="monotone" dataKey="traded" name="12m NCD (traded)" stroke="#fbbf24" strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
          )}
        </LineChart>
      </ResponsiveContainer>
      <p style={{ fontSize: 12, color: '#cbd5e1', margin: '10px 4px 0', lineHeight: 1.5 }}>
        The <span style={{ color: '#38bdf8' }}>3m path</span> is flattest early (near-dated rates are lowest) then steepens as the curve rises; the <span style={{ color: '#4ade80' }}>12m lock</span> is a straight diagonal. They meet at the end.
        {model.tradedNcd != null && (
          <> The <span style={{ color: '#fbbf24' }}>dashed traded 12m NCD ({model.tradedNcd.toFixed(2)}%)</span> ends {model.tradedNcd > (model.r12) ? 'above' : 'below'} the bundle — that gap is the credit + term premium for locking a bank fixed rate versus the risk-free forward path.</>
        )}
      </p>
      <p style={{ fontSize: 11, color: '#475569', margin: '8px 4px 0' }}>
        Forward 3m rates from the Zaronia FRA strip: {model.f.map(x => x.toFixed(2) + '%').join(' → ')}. Simple interest within each leg, reinvested at each roll.
      </p>
    </div>
  );
}
