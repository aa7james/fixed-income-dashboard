import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { supabase } from '../utils/supabase';
import styles from './MyCharts.module.css';

const SERIES_COLORS = ['#38bdf8', '#4ade80', '#fb923c', '#f472b6', '#a78bfa', '#facc15', '#34d399', '#f87171'];

function filterByPeriod(dataRows, period) {
  if (period === 'ALL' || !dataRows.length) return dataRows;
  const last = dataRows[dataRows.length - 1].date;
  const months = { '1M': 1, '3M': 3, '6M': 6, '1Y': 12, '2Y': 24, '5Y': 60 }[period] || 12;
  const cutoff = new Date(last);
  cutoff.setMonth(cutoff.getMonth() - months);
  return dataRows.filter(r => r.date >= cutoff);
}

function buildChartData(dataRows, series, period) {
  const rows = filterByPeriod(dataRows, period);
  return rows.map(row => {
    const point = { dateStr: row.dateStr };
    series.forEach(s => {
      if (s.type === 'spread') {
        const a = row[s.instrumentA];
        const b = row[s.instrumentB];
        point[s.key] = (a != null && b != null) ? +((a - b) * 100).toFixed(2) : null;
      } else {
        const v = row[s.instrument];
        point[s.key] = v != null ? +v.toFixed(4) : null;
      }
    });
    return point;
  });
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, padding: '10px 14px' }}>
      <p style={{ color: '#94a3b8', fontSize: 11, marginBottom: 4 }}>{label}</p>
      {payload.map(p => (
        <p key={p.dataKey} style={{ color: p.color, fontSize: 12, margin: '2px 0' }}>
          {p.name}: <strong>{p.value != null ? p.value : '—'}{p.unit}</strong>
        </p>
      ))}
    </div>
  );
};

function SavedChart({ chart, data, onDelete }) {
  const [period, setPeriod] = useState(chart.timeframe || '1Y');
  const [deleting, setDeleting] = useState(false);

  const chartData = useMemo(() =>
    buildChartData(data.dataRows, chart.series, period),
    [data.dataRows, chart.series, period]
  );

  const handleDelete = async () => {
    if (!window.confirm(`Delete "${chart.name}"?`)) return;
    setDeleting(true);
    await supabase.from('saved_charts').delete().eq('id', chart.id);
    onDelete(chart.id);
  };

  const PERIODS = ['1M', '3M', '6M', '1Y', '2Y', '5Y', 'ALL'];

  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <h3 className={styles.cardTitle}>{chart.name}</h3>
        <div className={styles.cardActions}>
          <div className={styles.miniPeriods}>
            {PERIODS.map(p => (
              <button
                key={p}
                className={`${styles.miniPeriod} ${period === p ? styles.miniPeriodOn : ''}`}
                onClick={() => setPeriod(p)}
              >{p}</button>
            ))}
          </div>
          <button className={styles.deleteBtn} onClick={handleDelete} disabled={deleting}>
            {deleting ? '…' : '🗑'}
          </button>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#0f172a" />
          <XAxis
            dataKey="dateStr"
            tick={{ fill: '#64748b', fontSize: 9 }}
            interval="preserveStartEnd"
            tickFormatter={d => {
              const parts = d.split('/');
              return parts.length === 3 ? `${parts[0]}/${parts[2].slice(2)}` : d;
            }}
          />
          <YAxis tick={{ fill: '#64748b', fontSize: 10 }} width={46} />
          <Tooltip content={<CustomTooltip />} />
          <Legend wrapperStyle={{ fontSize: 11, color: '#64748b' }} />
          {chart.series.map((s, i) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={s.color || SERIES_COLORS[i % SERIES_COLORS.length]}
              dot={false}
              strokeWidth={1.5}
              connectNulls={false}
              unit={s.type === 'spread' ? ' bps' : '%'}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function MyCharts({ data, refreshTrigger }) {
  const [charts, setCharts] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadCharts = useCallback(async () => {
    setLoading(true);
    const { data: rows, error } = await supabase
      .from('saved_charts')
      .select('*')
      .order('created_at', { ascending: false });
    if (!error) setCharts(rows || []);
    setLoading(false);
  }, []);

  useEffect(() => { loadCharts(); }, [loadCharts, refreshTrigger]);

  const handleDelete = (id) => setCharts(prev => prev.filter(c => c.id !== id));

  if (loading) return <div className={styles.empty}>Loading saved charts…</div>;

  if (!charts.length) return (
    <div className={styles.empty}>
      <p>No saved charts yet.</p>
      <p style={{ fontSize: 13, marginTop: 8, color: '#475569' }}>
        Go to <strong>Chart Builder</strong> to create and save your first chart.
      </p>
    </div>
  );

  return (
    <div>
      <div className={styles.header}>
        <h2 className={styles.heading}>My Charts</h2>
        <p className={styles.sub}>{charts.length} saved chart{charts.length !== 1 ? 's' : ''} — updated automatically with latest data</p>
      </div>
      <div className={styles.grid}>
        {charts.map(chart => (
          <SavedChart key={chart.id} chart={chart} data={data} onDelete={handleDelete} />
        ))}
      </div>
    </div>
  );
}
