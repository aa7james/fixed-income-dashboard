import React, { useMemo, useState } from 'react';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend,
} from 'recharts';
import ResizableChart from './ResizableChart';
import AddToPackButton from './AddToPackButton';
import styles from './YieldCurve.module.css';
import cb from './ChartBuilder.module.css';
import { useYAxisBounds, flatY } from './useYAxisBounds';
import { makeDateFmt, dateSpanDays } from './axisFormat';

const SA     = 'SA Generic 10 year';
const US     = 'US 10Y Treasury';      // Bloomberg renamed the US 10y to this (~Aug 2026)
const US_OLD = 'US Generic 10 year';   // older rows carry the US 10y under this name
const YANK   = 'SOAF Yankee Bond';

const PERIODS = ['1M', '3M', '6M', '1Y', '2Y', '5Y', '10Y', 'ALL', 'Custom'];
const CREDIT_COLOR   = '#fb923c'; // orange
const CURRENCY_COLOR = '#38bdf8'; // blue

function filterByPeriod(rows, period, customFrom, customTo) {
  if (!rows.length || period === 'ALL') return rows;
  if (period === 'Custom') {
    const from = customFrom ? new Date(customFrom) : null;
    const to = customTo ? new Date(customTo) : null;
    return rows.filter(r => (!from || r.date >= from) && (!to || r.date <= to));
  }
  const last = rows[rows.length - 1].date;
  const months = { '1M': 1, '3M': 3, '6M': 6, '1Y': 12, '2Y': 24, '5Y': 60, '10Y': 120 }[period] || 12;
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

export default function RiskPremiumChart({ data, onTogglePack, isInPack, defaultPeriod = '1Y' }) {
  const [period, setPeriod] = useState(defaultPeriod);
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const dataRows = useMemo(() => data?.dataRows || [], [data]);

  const chartData = useMemo(() => {
    const rows = filterByPeriod(dataRows, period, customFrom, customTo);
    return rows.map(row => {
      const sa = row[SA], us = row[US] ?? row[US_OLD], yank = row[YANK];
      if (sa == null || us == null || yank == null) {
        return { dateStr: row.dateStr, currency: null, credit: null };
      }
      return {
        dateStr: row.dateStr,
        currency: +((sa - yank) * 100).toFixed(2), // ZAR currency risk
        credit:   +((yank - us) * 100).toFixed(2), // SA sovereign credit risk (USD)
      };
    });
  }, [dataRows, period, customFrom, customTo]);

  const hasAnyData = chartData.some(p => p.currency != null || p.credit != null);
  const yb = useYAxisBounds('Y-axis', flatY(chartData, ['dateStr']).concat((chartData || []).map(r => (Number(r.credit) || 0) + (Number(r.currency) || 0))));
  const dateFmt = makeDateFmt(dateSpanDays(chartData, 'dateStr'));
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div className={cb.periodBar}>
            {PERIODS.map(p => (
              <button
                key={p}
                className={`${cb.periodBtn} ${period === p ? cb.periodActive : ''}`}
                onClick={() => setPeriod(p)}
              >{p}</button>
            ))}
          </div>
          {onTogglePack && (
            <AddToPackButton isInPack={isInPack} onToggle={() => onTogglePack('risk-premium')} />
          )}
        </div>
      </div>
      {period === 'Custom' && (
        <div className={cb.dateRange} style={{ marginBottom: 12 }}>
          <input type="date" className={cb.dateInput} value={customFrom} onChange={e => setCustomFrom(e.target.value)} />
          <span style={{ color: '#475569' }}>→</span>
          <input type="date" className={cb.dateInput} value={customTo} onChange={e => setCustomTo(e.target.value)} />
        </div>
      )}
      <p style={{ fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, margin: '0 0 4px' }}>
        Stacked — total premium
      </p>
      {yb.Control}
      <ResizableChart width="100%" height={300}>
        <BarChart data={chartData} margin={{ top: 8, right: 24, left: 0, bottom: 8 }} barCategoryGap={0}>
          <CartesianGrid strokeDasharray="4 4" stroke="#334155" strokeOpacity={0.8} />
          <XAxis
            dataKey="dateStr"
            tick={{ fill: '#94a3b8', fontSize: 9 }}
            interval="preserveStartEnd"
            minTickGap={40}
            tickFormatter={dateFmt}
          />
          <YAxis
            domain={yb.domain}
            ticks={yb.ticks}
            interval={0}
            allowDataOverflow
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
      </ResizableChart>

      <p style={{ fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, margin: '16px 0 4px' }}>
        Lines — each component
      </p>
      <ResizableChart width="100%" height={280}>
        <LineChart data={chartData} margin={{ top: 8, right: 24, left: 0, bottom: 8 }}>
          <CartesianGrid strokeDasharray="4 4" stroke="#334155" strokeOpacity={0.8} />
          <XAxis
            dataKey="dateStr"
            tick={{ fill: '#94a3b8', fontSize: 9 }}
            interval="preserveStartEnd"
            minTickGap={40}
            tickFormatter={dateFmt}
          />
          <YAxis
            domain={yb.domain}
            ticks={yb.ticks}
            interval={0}
            allowDataOverflow
            tickFormatter={v => `${v}`}
            tick={{ fill: '#94a3b8', fontSize: 11 }}
            width={48}
            unit=" bps"
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend wrapperStyle={{ fontSize: 12, color: '#94a3b8', paddingTop: 8 }} />
          <Line type="monotone" dataKey="currency" name="Currency risk" stroke={CURRENCY_COLOR} strokeWidth={1.5} dot={false} connectNulls={true} />
          <Line type="monotone" dataKey="credit"   name="Credit risk"   stroke={CREDIT_COLOR}   strokeWidth={1.5} dot={false} connectNulls={true} />
        </LineChart>
      </ResizableChart>
    </div>
  );
}
