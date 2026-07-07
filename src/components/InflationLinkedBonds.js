import React, { useState, useEffect } from 'react';
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceDot,
} from 'recharts';
import { loadYieldCurveInterpolated } from '../utils/supabase';
import styles from './InflationLinkedBonds.module.css';

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  return (
    <div className={styles.tooltip}>
      <p className={styles.tooltipDate}>{d.maturity_date} ({d.years_to_maturity}y)</p>
      {d.nominal_yield != null && (
        <p style={{ color: '#4ade80', margin: '2px 0', fontSize: 13 }}>
          Nominal: <strong>{Number(d.nominal_yield).toFixed(4)}%</strong>
          {d.nominal_bond ? ` (${d.nominal_bond})` : ''}
        </p>
      )}
      {d.real_yield != null && (
        <p style={{ color: '#2dd4bf', margin: '2px 0', fontSize: 13 }}>
          Real: <strong>{Number(d.real_yield).toFixed(4)}%</strong>
          {d.real_bond ? ` (${d.real_bond})` : ''}
        </p>
      )}
      {d.implied_inflation != null && (
        <p style={{ color: '#94a3b8', margin: '2px 0', fontSize: 13 }}>
          Implied Inflation: <strong>{Number(d.implied_inflation).toFixed(4)}%</strong>
        </p>
      )}
    </div>
  );
};

function xTick(years) {
  if (years < 1) return `${Math.round(years * 12)}m`;
  return `${Math.round(years)}y`;
}

export default function InflationLinkedBonds() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadYieldCurveInterpolated()
      .then(data => {
        setRows(data.map(r => ({
          ...r,
          years_to_maturity: Number(r.years_to_maturity),
          nominal_yield:     r.nominal_yield     != null ? Number(r.nominal_yield)     : null,
          real_yield:        r.real_yield        != null ? Number(r.real_yield)        : null,
          implied_inflation: r.implied_inflation != null ? Number(r.implied_inflation) : null,
        })));
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className={styles.msg}>Loading yield curve…</p>;
  if (error)   return <p className={styles.msg} style={{ color: '#f87171' }}>Error: {error}</p>;
  if (!rows.length) return <p className={styles.msg}>No data available.</p>;

  const knots = rows.filter(r => r.is_nominal_knot || r.is_real_knot);

  // X-axis: one tick per even year, matched to actual data points
  const ticks = [];
  for (let y = 2; y <= 28; y += 2) {
    const closest = rows.reduce((best, r) =>
      Math.abs(r.years_to_maturity - y) < Math.abs(best.years_to_maturity - y) ? r : best
    );
    if (Math.abs(closest.years_to_maturity - y) < 0.25) ticks.push(closest.years_to_maturity);
  }

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <h3 className={styles.title}>Inflation Linked Bonds — Yield Curve</h3>
        <div className={styles.legend}>
          <span className={styles.legendItem}>
            <span className={styles.dot} style={{ background: '#4ade80' }} /> Nominal yield
          </span>
          <span className={styles.legendItem}>
            <span className={styles.dot} style={{ background: '#2dd4bf' }} /> Real yield
          </span>
          <span className={styles.legendItem}>
            <span className={styles.dot} style={{ background: 'rgba(30,64,175,0.6)', borderRadius: 2 }} /> Implied inflation
          </span>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={380}>
        <ComposedChart data={rows} margin={{ top: 16, right: 24, left: 0, bottom: 12 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />

          <XAxis
            dataKey="years_to_maturity"
            type="number"
            domain={['dataMin', 'dataMax']}
            ticks={ticks}
            tickFormatter={xTick}
            tick={{ fill: '#64748b', fontSize: 10 }}
            label={{ value: 'Years to Maturity', position: 'insideBottom', offset: -4, fill: '#475569', fontSize: 11 }}
          />

          <YAxis
            domain={[2, 'auto']}
            tick={{ fill: '#64748b', fontSize: 10 }}
            tickFormatter={v => `${v}%`}
            width={52}
          />

          <Tooltip content={<CustomTooltip />} />

          {/* Stacked fill: card-background real_yield base + dark implied_inflation on top.
              The bottom area uses the card colour (#1e293b) so the fill only appears
              between the real yield line and the nominal line. */}
          <Area
            type="monotone"
            dataKey="real_yield"
            stackId="fill"
            fill="#1e293b"
            stroke="none"
            isAnimationActive={false}
            connectNulls={false}
            legendType="none"
          />
          <Area
            type="monotone"
            dataKey="implied_inflation"
            stackId="fill"
            fill="rgba(30,64,175,0.45)"
            stroke="none"
            isAnimationActive={false}
            connectNulls={false}
            legendType="none"
          />

          {/* Lines drawn on top of fill */}
          <Line
            type="monotone"
            dataKey="nominal_yield"
            name="Nominal"
            stroke="#4ade80"
            strokeWidth={2}
            dot={false}
            connectNulls={false}
            isAnimationActive={false}
            legendType="none"
          />
          <Line
            type="monotone"
            dataKey="real_yield"
            name="Real"
            stroke="#2dd4bf"
            strokeWidth={2}
            dot={false}
            connectNulls={false}
            isAnimationActive={false}
            legendType="none"
          />

          {/* Mark actual bond knot points */}
          {knots.map(r => r.is_nominal_knot && r.nominal_yield != null && (
            <ReferenceDot
              key={`n-${r.maturity_date}`}
              x={r.years_to_maturity}
              y={r.nominal_yield}
              r={4}
              fill="#4ade80"
              stroke="#0f172a"
              strokeWidth={1}
            />
          ))}
          {knots.map(r => r.is_real_knot && r.real_yield != null && (
            <ReferenceDot
              key={`r-${r.maturity_date}`}
              x={r.years_to_maturity}
              y={r.real_yield}
              r={4}
              fill="#2dd4bf"
              stroke="#0f172a"
              strokeWidth={1}
            />
          ))}
        </ComposedChart>
      </ResponsiveContainer>

      <p className={styles.note}>
        Dots mark actual bond maturities. Cubic spline interpolation between knot points.
        Real yield only shown where ILB bonds exist (from ~2028).
      </p>
    </div>
  );
}
