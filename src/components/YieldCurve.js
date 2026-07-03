import React, { useState, useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import styles from './YieldCurve.module.css';

const SWAP_TENORS = [
  { label: '1Y',  col: '1 Year SWAP' },
  { label: '2Y',  col: '2 Year SWAP' },
  { label: '3Y',  col: '3 Year SWAP' },
  { label: '4Y',  col: '4 Year SWAP' },
  { label: '5Y',  col: '5 Year SWAP' },
  { label: '6Y',  col: '6 Year SWAP' },
  { label: '7Y',  col: '7 Year SWAP' },
  { label: '8Y',  col: '8 Year SWAP' },
  { label: '9Y',  col: '9 Year SWAP' },
  { label: '10Y', col: '10 Year SWAP' },
  { label: '12Y', col: '12 Year SWAP' },
  { label: '15Y', col: '15 Year SWAP' },
  { label: '20Y', col: '20 Year SWAP' },
];

const COLORS = ['#38bdf8', '#818cf8', '#34d399', '#fb923c', '#f472b6'];

export default function YieldCurve({ data }) {
  const latest = data.dataRows[data.dataRows.length - 1];
  const allDates = data.dataRows.map(r => r.dateStr);

  const [selectedDates, setSelectedDates] = useState([latest?.dateStr].filter(Boolean));
  const [inputDate, setInputDate] = useState('');

  const availableTenors = SWAP_TENORS.filter(t => data.columns.some(c => c.name === t.col));

  const curves = useMemo(() => {
    return selectedDates.map(dateStr => {
      const row = data.dataRows.find(r => r.dateStr === dateStr);
      return { dateStr, row };
    }).filter(c => c.row);
  }, [selectedDates, data.dataRows]);

  const chartData = availableTenors.map(t => {
    const point = { tenor: t.label };
    curves.forEach(c => {
      point[c.dateStr] = c.row[t.col];
    });
    return point;
  });

  const addDate = () => {
    const match = allDates.find(d => d === inputDate || d.startsWith(inputDate));
    if (match && !selectedDates.includes(match)) {
      setSelectedDates(prev => [...prev, match].slice(-5));
    }
    setInputDate('');
  };

  const removeDate = (d) => setSelectedDates(prev => prev.filter(x => x !== d));

  const fmtDate = (s) => {
    const d = new Date(s);
    return d.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  return (
    <div>
      <h2 className={styles.heading}>SA Swap Yield Curve</h2>
      <p className={styles.sub}>Compare the swap curve across up to 5 dates</p>

      <div className={styles.controls}>
        <div className={styles.chips}>
          {selectedDates.map((d, i) => (
            <span key={d} className={styles.chip} style={{ borderColor: COLORS[i % COLORS.length] }}>
              {fmtDate(d)}
              <button className={styles.chipRemove} onClick={() => removeDate(d)}>×</button>
            </span>
          ))}
        </div>
        <div className={styles.addRow}>
          <input
            className={styles.dateInput}
            list="datelist"
            placeholder="Add date (e.g. 6/30/2024)"
            value={inputDate}
            onChange={e => setInputDate(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addDate()}
          />
          <datalist id="datelist">
            {allDates.slice(-500).map(d => <option key={d} value={d} />)}
          </datalist>
          <button className={styles.addBtn} onClick={addDate}>Add</button>
        </div>
      </div>

      {chartData.length > 0 && curves.length > 0 ? (
        <div className={styles.chart}>
          <ResponsiveContainer width="100%" height={380}>
            <LineChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="tenor" tick={{ fill: '#94a3b8', fontSize: 12 }} />
              <YAxis
                tick={{ fill: '#94a3b8', fontSize: 12 }}
                tickFormatter={v => `${v}%`}
                domain={['auto', 'auto']}
              />
              <Tooltip
                contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }}
                labelStyle={{ color: '#94a3b8' }}
                formatter={(v, name) => [`${v?.toFixed(3)}%`, fmtDate(name)]}
              />
              <Legend formatter={(v) => fmtDate(v)} wrapperStyle={{ color: '#94a3b8', fontSize: 12 }} />
              {curves.map((c, i) => (
                <Line
                  key={c.dateStr}
                  type="monotone"
                  dataKey={c.dateStr}
                  stroke={COLORS[i % COLORS.length]}
                  strokeWidth={2}
                  dot={{ r: 4, fill: COLORS[i % COLORS.length] }}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className={styles.empty}>Select a date to view the curve.</p>
      )}
    </div>
  );
}
