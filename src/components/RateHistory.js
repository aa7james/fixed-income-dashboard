import React, { useState, useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import styles from './RateHistory.module.css';

const COLORS = ['#38bdf8', '#34d399', '#fb923c', '#818cf8', '#f472b6'];
const PERIODS = [
  { label: '1M',  days: 30 },
  { label: '3M',  days: 90 },
  { label: '6M',  days: 180 },
  { label: '1Y',  days: 365 },
  { label: '3Y',  days: 365 * 3 },
  { label: '5Y',  days: 365 * 5 },
  { label: 'All', days: null },
];

export default function RateHistory({ data, groups }) {
  const [selected, setSelected] = useState([]);
  const [search, setSearch] = useState('');
  const [period, setPeriod] = useState('1Y');

  const allCols = data.columns;
  const filtered = search
    ? allCols.filter(c => c.name.toLowerCase().includes(search.toLowerCase()))
    : allCols;

  const toggle = (name) => {
    setSelected(prev =>
      prev.includes(name) ? prev.filter(x => x !== name) : [...prev, name].slice(-5)
    );
  };

  const chartData = useMemo(() => {
    if (!selected.length) return [];
    const p = PERIODS.find(x => x.label === period);
    const cutoff = p?.days
      ? new Date(Date.now() - p.days * 86400000)
      : new Date(0);

    return data.dataRows
      .filter(r => r.date >= cutoff)
      .map(r => {
        const point = { date: r.dateStr };
        selected.forEach(name => { point[name] = r[name]; });
        return point;
      });
  }, [selected, period, data.dataRows]);

  const fmtDate = (s) => {
    const d = new Date(s);
    return d.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: '2-digit' });
  };

  return (
    <div>
      <h2 className={styles.heading}>Rate History</h2>
      <p className={styles.sub}>Select up to 5 instruments to chart</p>

      <div className={styles.layout}>
        <div className={styles.sidebar}>
          <input
            className={styles.search}
            placeholder="Search…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <div className={styles.list}>
            {filtered.map(col => (
              <button
                key={col.name}
                className={`${styles.item} ${selected.includes(col.name) ? styles.itemActive : ''}`}
                onClick={() => toggle(col.name)}
              >
                {col.name}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.chartArea}>
          <div className={styles.periodBar}>
            {PERIODS.map(p => (
              <button
                key={p.label}
                className={`${styles.periodBtn} ${period === p.label ? styles.periodActive : ''}`}
                onClick={() => setPeriod(p.label)}
              >
                {p.label}
              </button>
            ))}
          </div>

          {selected.length === 0 ? (
            <div className={styles.empty}>
              <p>Select instruments from the left panel to view history.</p>
            </div>
          ) : (
            <div className={styles.chart}>
              <ResponsiveContainer width="100%" height={400}>
                <LineChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis
                    dataKey="date"
                    tickFormatter={fmtDate}
                    tick={{ fill: '#94a3b8', fontSize: 11 }}
                    minTickGap={60}
                  />
                  <YAxis
                    tick={{ fill: '#94a3b8', fontSize: 12 }}
                    tickFormatter={v => `${v}%`}
                    domain={['auto', 'auto']}
                  />
                  <Tooltip
                    contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }}
                    labelStyle={{ color: '#94a3b8', fontSize: 12 }}
                    labelFormatter={fmtDate}
                    formatter={(v) => v != null ? [`${v.toFixed(3)}%`] : ['—']}
                  />
                  <Legend wrapperStyle={{ color: '#94a3b8', fontSize: 12 }} />
                  {selected.map((name, i) => (
                    <Line
                      key={name}
                      type="monotone"
                      dataKey={name}
                      stroke={COLORS[i % COLORS.length]}
                      strokeWidth={2}
                      dot={false}
                      connectNulls
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
