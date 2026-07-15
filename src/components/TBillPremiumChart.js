import React, { useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import styles from './YieldCurve.module.css';

const TENORS = [
  { label: '3M', tbill: '3m T-Bill', ncd: '3m Fixed Rate NCD ASK' },
  { label: '6M', tbill: '6m T-Bill', ncd: '6m Fixed Rate NCD ASK' },
  { label: '9M', tbill: '9m T-Bill', ncd: '9m Fixed Rate NCD ASK' },
  { label: '12M', tbill: '12m T-Bill', ncd: '12m Fixed Rate NCD ASK' },
];

const COMPARISONS = [
  { key: 'current', label: 'Current', days: 0,   color: '#f1f5f9', dash: undefined },
  { key: 'w1',       label: '1 Week Ago',  days: 7,   color: '#94a3b8', dash: '5 3' },
  { key: 'm1',       label: '1 Month Ago', days: 30,  color: '#818cf8', dash: '5 3' },
  { key: 'y1',       label: '1 Year Ago',  days: 365, color: '#4ade80', dash: '5 3' },
];

function nearestRow(dataRows, targetDate) {
  if (!dataRows.length) return null;
  const target = targetDate.getTime();
  let best = null, bestDiff = Infinity;
  for (const row of dataRows) {
    const diff = Math.abs(row.date.getTime() - target);
    if (diff < bestDiff) { bestDiff = diff; best = row; }
  }
  return best;
}

export default function TBillPremiumChart({ data }) {
  const dataRows = useMemo(() => data?.dataRows || [], [data]);
  const latest = dataRows[dataRows.length - 1];

  const chartData = useMemo(() => {
    if (!latest) return [];
    const latestMs = latest.date.getTime();

    const rowsByComparison = Object.fromEntries(
      COMPARISONS.map(c => [
        c.key,
        c.days === 0 ? latest : nearestRow(dataRows, new Date(latestMs - c.days * 24 * 3600 * 1000)),
      ])
    );

    return TENORS.map(t => {
      const point = { label: t.label };
      COMPARISONS.forEach(c => {
        const row = rowsByComparison[c.key];
        const tbill = row?.[t.tbill];
        const ncd = row?.[t.ncd];
        point[c.key] = (tbill != null && ncd != null) ? +(tbill - ncd).toFixed(4) : null;
      });
      return point;
    });
  }, [dataRows, latest]);

  const hasAnyData = chartData.some(p => COMPARISONS.some(c => p[c.key] != null));
  if (!hasAnyData) return null;

  return (
    <div className={styles.chartWrap} style={{ marginTop: 24 }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9', marginBottom: 4 }}>
        T-Bill Premiums (ASK)
      </div>
      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>
        Premium received on a T-Bill vs. the equivalent Fixed Rate NCD
      </div>
      <ResponsiveContainer width="100%" height={320}>
        <LineChart data={chartData} margin={{ top: 8, right: 24, left: 0, bottom: 8 }}>
          <CartesianGrid strokeDasharray="4 4" stroke="#334155" strokeOpacity={0.8} />
          <XAxis dataKey="label" tick={{ fill: '#94a3b8', fontSize: 11 }} />
          <YAxis
            tickFormatter={v => `${v.toFixed(2)}%`}
            tick={{ fill: '#94a3b8', fontSize: 11 }}
            width={56}
          />
          <Tooltip
            formatter={(value, name) => [value != null ? `${value.toFixed(3)}%` : '—', name]}
            contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }}
            labelStyle={{ color: '#94a3b8' }}
          />
          <Legend wrapperStyle={{ fontSize: 12, color: '#94a3b8', paddingTop: 8 }} />
          {COMPARISONS.map(c => (
            <Line
              key={c.key}
              type="monotone"
              dataKey={c.key}
              name={c.label}
              stroke={c.color}
              strokeWidth={c.key === 'current' ? 2.5 : 1.5}
              strokeDasharray={c.dash}
              dot={{ r: 3, fill: c.color }}
              connectNulls={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
