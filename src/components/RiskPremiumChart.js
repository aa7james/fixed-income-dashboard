import React, { useMemo, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import AddToPackButton from './AddToPackButton';
import styles from './YieldCurve.module.css';

const SA   = 'SA Generic 10 year';
const US   = 'US Generic 10 year';
const YANK = 'SOAF Yankee Bond';

const PERIODS = ['1Y', '2Y', '5Y', 'ALL'];
const CREDIT_COLOR   = '#fb923c'; // orange
const CURRENCY_COLOR = '#38bdf8'; // blue

function filterByPeriod(rows, period) {
  if (!rows.length || period === 'ALL') return rows;
  const last = rows[rows.length - 1].date;
  const months = { '1Y': 12, '2Y': 24, '5Y': 60 }[period] || 24;
  const cutoff = new Date(last);
  cutoff.setMonth(cutoff.getMonth() - months);
  return rows.filter(r => r.date >= cutoff);
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  const credit = payload.find(p => p.dataKey === 'credit')?.value;
  const currency = payload.find(p => p.dataKey === 'currency')?.value;
  const total = (credit ?? 0) + (currency ?? 0);
  return (
    <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, padding: '10px 14px' }}>
      <p style={{ color: '#94a3b8', fontSize: 11, marginBottom: 6 }}>{label}</p>
      <p style={{ color: CURRENCY_COLOR, fontSize: 12, margin: '2px 0' }}>Currency risk: <strong>{currency != null ? currency.toFixed(1) : '—'} bps</strong></p>
      <p style={{ color: CREDIT_COLOR, fontSize: 12, margin: '2px 0' }}>Credit risk: <strong>{credit != null ? credit.toFixed(1) : '—'} bps</strong></p>
      <p style={{ color: '#f1f5f9', fontSize: 12, margin: '4px 0 0', borderTop: '1px solid #334155', paddingTop: 4 }}>Total premium: <strong>{total.toFixed(1)} bps</strong></p>
    </div>
  );
};

export default function RiskPremiumChart({ data, onTogglePack, isInPack, defaultPeriod = '2Y' }) {
  const [period, setPeriod] = useState(defaultPeriod);
  const dataRows = useMemo(() => data?.dataRows || [], [data]);

  const chartData = useMemo(() => {
    const rows = filterByPeriod(dataRows, period);
    return rows.map(row => {
      const sa = row[SA], us = row[US], yank = row[YANK];
      if (sa == null || us == null || yank == null) {
        return { dateStr: row.dateStr, currency: null, credit: null };
      }
      return {
        dateStr: row.dateStr,
        currency: +((sa - yank) * 100).toFixed(2), // ZAR currency risk
        credit:   +((yank - us) * 100).toFixed(2), // SA sovereign credit risk (USD)
      };
    });
  }, [dataRows, period]);

  const hasAnyData = chartData.some(p => p.currency != null || p.credit != null);
  if (!hasAnyData) return null;

  return (
    <div className={styles.chartWrap} style={{ marginTop: 24 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9', marginBottom: 4 }}>
            SA Risk Premium Decomposition (bps)
          </div>
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>
            Total premium of SA 10y over US 10y, split into currency risk (SA 10y − SOAF Yankee) and credit risk (SOAF Yankee − US 10y)
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ display: 'flex', gap: 4 }}>
            {PERIODS.map(p => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                style={{
                  fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 8, cursor: 'pointer',
                  border: `1px solid ${period === p ? '#60a5fa' : '#334155'}`,
                  background: period === p ? 'rgba(96,165,250,0.15)' : 'transparent',
                  color: period === p ? '#60a5fa' : '#64748b',
                }}
              >{p}</button>
            ))}
          </div>
          {onTogglePack && (
            <AddToPackButton isInPack={isInPack} onToggle={() => onTogglePack('risk-premium')} />
          )}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={340}>
        <BarChart data={chartData} margin={{ top: 8, right: 24, left: 0, bottom: 8 }} barCategoryGap={0}>
          <CartesianGrid strokeDasharray="4 4" stroke="#334155" strokeOpacity={0.8} />
          <XAxis
            dataKey="dateStr"
            tick={{ fill: '#94a3b8', fontSize: 9 }}
            interval="preserveStartEnd"
            minTickGap={40}
            tickFormatter={d => {
              const parts = d.split('/');
              return parts.length === 3 ? `${parts[0]}/${parts[2].slice(2)}` : d;
            }}
          />
          <YAxis
            tickFormatter={v => `${v}`}
            tick={{ fill: '#94a3b8', fontSize: 11 }}
            width={48}
            unit=" bps"
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend wrapperStyle={{ fontSize: 12, color: '#94a3b8', paddingTop: 8 }} />
          <Bar dataKey="credit"   name="Credit risk"   stackId="a" fill={CREDIT_COLOR} />
          <Bar dataKey="currency" name="Currency risk" stackId="a" fill={CURRENCY_COLOR} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
