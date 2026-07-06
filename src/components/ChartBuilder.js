import React, { useState, useMemo, useCallback } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { supabase } from '../utils/supabase';
import styles from './ChartBuilder.module.css';

const PERIODS = ['1M', '3M', '6M', '1Y', '2Y', '5Y', '10Y', 'ALL', 'Custom'];
const SERIES_COLORS = ['#38bdf8', '#4ade80', '#fb923c', '#f472b6', '#a78bfa', '#facc15', '#34d399', '#f87171'];

function filterByPeriod(dataRows, period, customFrom, customTo) {
  if (!dataRows.length) return dataRows;
  if (period === 'ALL') return dataRows;
  if (period === 'Custom') {
    const from = customFrom ? new Date(customFrom) : null;
    const to = customTo ? new Date(customTo) : null;
    return dataRows.filter(r => (!from || r.date >= from) && (!to || r.date <= to));
  }
  const last = dataRows[dataRows.length - 1].date;
  const months = { '1M': 1, '3M': 3, '6M': 6, '1Y': 12, '2Y': 24, '5Y': 60, '10Y': 120 }[period] || 12;
  const cutoff = new Date(last);
  cutoff.setMonth(cutoff.getMonth() - months);
  return dataRows.filter(r => r.date >= cutoff);
}

function buildChartData(dataRows, series, period, customFrom, customTo) {
  const rows = filterByPeriod(dataRows, period, customFrom, customTo);
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
      <p style={{ color: '#94a3b8', fontSize: 12, marginBottom: 6 }}>{label}</p>
      {payload.map(p => (
        <p key={p.dataKey} style={{ color: p.color, fontSize: 13, margin: '2px 0' }}>
          {p.name}: <strong>{p.value != null ? p.value : '—'}{p.unit}</strong>
        </p>
      ))}
    </div>
  );
};

export default function ChartBuilder({ data, instruments, onSaved }) {
  const allNames = useMemo(() => {
    if (instruments?.length) return instruments.map(i => i.name).sort();
    return data.columns.map(c => c.name).sort();
  }, [instruments, data.columns]);

  const [search, setSearch] = useState('');
  const [series, setSeries] = useState([]);
  const [period, setPeriod] = useState('1Y');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [chartName, setChartName] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

  // For adding a new series
  const [addType, setAddType] = useState('raw'); // 'raw' | 'spread'
  const [pickA, setPickA] = useState('');
  const [pickB, setPickB] = useState('');

  const filtered = useMemo(() =>
    allNames.filter(n => n.toLowerCase().includes(search.toLowerCase())),
    [allNames, search]
  );

  const addSeries = useCallback(() => {
    if (addType === 'raw' && pickA) {
      const key = `raw_${pickA}_${Date.now()}`;
      setSeries(prev => [...prev, {
        key, type: 'raw', instrument: pickA,
        label: pickA, color: SERIES_COLORS[prev.length % SERIES_COLORS.length],
      }]);
      setPickA('');
    } else if (addType === 'spread' && pickA && pickB && pickA !== pickB) {
      const key = `spread_${pickA}_${pickB}_${Date.now()}`;
      setSeries(prev => [...prev, {
        key, type: 'spread', instrumentA: pickA, instrumentB: pickB,
        label: `${pickA} – ${pickB} (bps)`,
        color: SERIES_COLORS[prev.length % SERIES_COLORS.length],
      }]);
      setPickA('');
      setPickB('');
    }
  }, [addType, pickA, pickB]);

  const removeSeries = (key) => setSeries(prev => prev.filter(s => s.key !== key));

  const chartData = useMemo(() =>
    buildChartData(data.dataRows, series, period, customFrom, customTo),
    [data.dataRows, series, period, customFrom, customTo]
  );

  const saveChart = async () => {
    if (!chartName.trim() || !series.length) {
      setSaveMsg('Give the chart a name and add at least one series.');
      return;
    }
    setSaving(true);
    setSaveMsg('');
    const { error } = await supabase.from('saved_charts').insert({
      name: chartName.trim(),
      series: series,
      timeframe: period,
    });
    setSaving(false);
    if (error) {
      setSaveMsg(`Error saving: ${error.message}`);
    } else {
      setSaveMsg('Chart saved!');
      setChartName('');
      if (onSaved) onSaved();
      setTimeout(() => setSaveMsg(''), 3000);
    }
  };

  return (
    <div className={styles.wrap}>
      <h2 className={styles.heading}>Chart Builder</h2>
      <p className={styles.sub}>Build a custom chart with any instruments, then save it to My Charts</p>

      <div className={styles.layout}>
        {/* Left panel — add series */}
        <div className={styles.panel}>
          <p className={styles.panelTitle}>Add Series</p>

          <div className={styles.typeRow}>
            <button
              className={`${styles.typeBtn} ${addType === 'raw' ? styles.typeBtnOn : ''}`}
              onClick={() => setAddType('raw')}
            >Yield</button>
            <button
              className={`${styles.typeBtn} ${addType === 'spread' ? styles.typeBtnOn : ''}`}
              onClick={() => setAddType('spread')}
            >Spread (A − B)</button>
          </div>

          <input
            className={styles.search}
            placeholder="Search instruments…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />

          <div className={styles.pickRow}>
            <select
              className={styles.select}
              value={pickA}
              onChange={e => setPickA(e.target.value)}
            >
              <option value="">{addType === 'spread' ? 'Instrument A…' : 'Select instrument…'}</option>
              {filtered.map(n => <option key={n} value={n}>{n}</option>)}
            </select>

            {addType === 'spread' && (
              <select
                className={styles.select}
                value={pickB}
                onChange={e => setPickB(e.target.value)}
              >
                <option value="">Instrument B…</option>
                {filtered.filter(n => n !== pickA).map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            )}
          </div>

          <button className={styles.addBtn} onClick={addSeries}>+ Add to Chart</button>

          {series.length > 0 && (
            <>
              <p className={styles.panelTitle} style={{ marginTop: 20 }}>Current Series</p>
              <div className={styles.seriesList}>
                {series.map(s => (
                  <div key={s.key} className={styles.seriesItem}>
                    <span className={styles.seriesDot} style={{ background: s.color }} />
                    <span className={styles.seriesLabel}>{s.label}</span>
                    <button className={styles.removeBtn} onClick={() => removeSeries(s.key)}>×</button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Right panel — chart */}
        <div className={styles.chartPanel}>
          <div className={styles.periodBar}>
            {PERIODS.map(p => (
              <button
                key={p}
                className={`${styles.periodBtn} ${period === p ? styles.periodActive : ''}`}
                onClick={() => setPeriod(p)}
              >{p}</button>
            ))}
          </div>
          {period === 'Custom' && (
            <div className={styles.dateRange}>
              <input type="date" className={styles.dateInput} value={customFrom} onChange={e => setCustomFrom(e.target.value)} />
              <span style={{ color: '#475569' }}>→</span>
              <input type="date" className={styles.dateInput} value={customTo} onChange={e => setCustomTo(e.target.value)} />
            </div>
          )}

          {series.length === 0 ? (
            <div className={styles.empty}>Add a series on the left to preview your chart</div>
          ) : (
            <div className={styles.chart}>
              <ResponsiveContainer width="100%" height={380}>
                <LineChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis
                    dataKey="dateStr"
                    tick={{ fill: '#94a3b8', fontSize: 10 }}
                    interval="preserveStartEnd"
                    tickFormatter={d => {
                      const parts = d.split('/');
                      return parts.length === 3 ? `${parts[0]}/${parts[2].slice(2)}` : d;
                    }}
                  />
                  <YAxis
                    tick={{ fill: '#94a3b8', fontSize: 11 }}
                    tickFormatter={v => `${v}`}
                    width={52}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 12, color: '#94a3b8' }} />
                  {series.map(s => (
                    <Line
                      key={s.key}
                      type="monotone"
                      dataKey={s.key}
                      name={s.label}
                      stroke={s.color}
                      dot={false}
                      strokeWidth={2}
                      connectNulls={false}
                      unit={s.type === 'spread' ? ' bps' : '%'}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {series.length > 0 && (
            <div className={styles.saveRow}>
              <input
                className={styles.nameInput}
                placeholder="Chart name…"
                value={chartName}
                onChange={e => setChartName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && saveChart()}
              />
              <button className={styles.saveBtn} onClick={saveChart} disabled={saving}>
                {saving ? 'Saving…' : 'Save Chart'}
              </button>
              {saveMsg && <span className={styles.saveMsg}>{saveMsg}</span>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
