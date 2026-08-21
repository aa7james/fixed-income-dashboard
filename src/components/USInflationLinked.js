import React, { useMemo } from 'react';
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts';
import styles from './InflationLinkedBonds.module.css';

// TIPS real-yield tenors paired with their nominal Treasury counterpart.
const TIPS_TENORS = [
  { tenor: 5,  real: 'US 5Y TIPS',  nominal: 'US 5Y Treasury',  label: '5Y' },
  { tenor: 7,  real: 'US 7Y TIPS',  nominal: 'US 7Y Treasury',  label: '7Y' },
  { tenor: 10, real: 'US 10Y TIPS', nominal: 'US 10Y Treasury', label: '10Y' },
  { tenor: 20, real: 'US 20Y TIPS', nominal: 'US 20Y Treasury', label: '20Y' },
  { tenor: 30, real: 'US 30Y TIPS', nominal: 'US 30Y Treasury', label: '30Y' },
];

const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  return (
    <div className={styles.tooltip}>
      <p className={styles.tooltipDate}>{d.label}</p>
      {d.nominal != null && (
        <p style={{ color: '#4ade80', margin: '2px 0', fontSize: 13 }}>
          Nominal: <strong>{d.nominal.toFixed(2)}%</strong>
        </p>
      )}
      {d.real != null && (
        <p style={{ color: '#2dd4bf', margin: '2px 0', fontSize: 13 }}>
          Real (TIPS): <strong>{d.real.toFixed(2)}%</strong>
        </p>
      )}
      {d.implied != null && (
        <p style={{ color: '#94a3b8', margin: '2px 0', fontSize: 13 }}>
          Implied Inflation: <strong>{d.implied.toFixed(2)}%</strong>
        </p>
      )}
    </div>
  );
};

export default function USInflationLinked({ data }) {
  const latest = data?.dataRows?.length ? data.dataRows[data.dataRows.length - 1] : null;

  const points = useMemo(() => {
    if (!latest) return [];
    return TIPS_TENORS.map(t => {
      const real = latest[t.real];
      const nominal = latest[t.nominal];
      if (real == null && nominal == null) return null;
      const implied = (real != null && nominal != null) ? +(nominal - real).toFixed(2) : null;
      return {
        tenor: t.tenor,
        label: t.label,
        real: real != null ? +real.toFixed(2) : null,
        nominal: nominal != null ? +nominal.toFixed(2) : null,
        implied,
      };
    }).filter(Boolean);
  }, [latest]);

  const hasData = points.some(p => p.real != null);
  if (!hasData) return null;

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <h3 className={styles.title}>US TIPS — Real Yields &amp; Breakeven Inflation</h3>
        <div className={styles.legend}>
          <span className={styles.legendItem}>
            <span className={styles.dot} style={{ background: '#4ade80' }} /> Nominal yield
          </span>
          <span className={styles.legendItem}>
            <span className={styles.dot} style={{ background: '#2dd4bf' }} /> Real yield (TIPS)
          </span>
          <span className={styles.legendItem}>
            <span className={styles.dot} style={{ background: 'rgba(30,64,175,0.75)', borderRadius: 2 }} /> Implied inflation
          </span>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={360}>
        <ComposedChart data={points} margin={{ top: 16, right: 24, left: 0, bottom: 12 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis
            dataKey="tenor"
            type="number"
            domain={['dataMin', 'dataMax']}
            ticks={points.map(p => p.tenor)}
            tickFormatter={v => `${v}y`}
            tick={{ fill: '#64748b', fontSize: 10 }}
            label={{ value: 'Tenor', position: 'insideBottom', offset: -4, fill: '#475569', fontSize: 11 }}
          />
          <YAxis
            domain={[0, 'auto']}
            tick={{ fill: '#64748b', fontSize: 10 }}
            tickFormatter={v => `${v}%`}
            width={52}
          />
          <Tooltip content={<CustomTooltip />} />
          <Area type="monotone" dataKey="implied" name="Implied Inflation"
            fill="rgba(15,40,120,0.85)" stroke="none" isAnimationActive={false} connectNulls />
          <Line type="monotone" dataKey="nominal" name="Nominal" stroke="#4ade80"
            strokeWidth={2} dot={{ r: 3, fill: '#4ade80' }} isAnimationActive={false} connectNulls />
          <Line type="monotone" dataKey="real" name="Real" stroke="#2dd4bf"
            strokeWidth={2} dot={{ r: 3, fill: '#2dd4bf' }} isAnimationActive={false} connectNulls />
        </ComposedChart>
      </ResponsiveContainer>

      <p className={styles.note}>
        Implied inflation (breakeven) = nominal Treasury yield − TIPS real yield, per tenor.
      </p>
    </div>
  );
}
