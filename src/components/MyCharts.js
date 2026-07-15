import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, LabelList,
} from 'recharts';
import { supabase } from '../utils/supabase';
import AddToPackButton from './AddToPackButton';
import TBillPremiumChart from './TBillPremiumChart';
import styles from './MyCharts.module.css';

const SERIES_COLORS = ['#38bdf8', '#4ade80', '#fb923c', '#f472b6', '#a78bfa', '#facc15', '#34d399', '#f87171'];
const PERIODS = ['1M', '3M', '6M', '1Y', '2Y', '5Y', '10Y', 'ALL', 'Custom'];

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
      <p style={{ color: '#94a3b8', fontSize: 11, marginBottom: 4 }}>{label}</p>
      {payload.map(p => (
        <p key={p.dataKey} style={{ color: p.color, fontSize: 12, margin: '2px 0' }}>
          {p.name}: <strong>{p.value != null ? p.value : '—'}{p.unit}</strong>
        </p>
      ))}
    </div>
  );
};

function EndLabel({ viewBox, value, color, unit, index, total }) {
  if (index !== total - 1) return null;
  if (value == null) return null;
  const { x, y } = viewBox;
  return (
    <text x={x + 6} y={y + 4} fill={color} fontSize={10} fontWeight={700}>
      {value}{unit}
    </text>
  );
}

export function ChartInner({ chart, data, period, customFrom, customTo, height }) {
  const chartData = useMemo(() =>
    buildChartData(data.dataRows, chart.series, period, customFrom, customTo),
    [data.dataRows, chart.series, period, customFrom, customTo]
  );

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={chartData} margin={{ top: 8, right: 55, left: 0, bottom: 8 }}>
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
        <YAxis
          tick={{ fill: '#64748b', fontSize: 10 }}
          width={52}
          domain={['auto', 'auto']}
          tickFormatter={v => v}
        />
        <Tooltip content={<CustomTooltip />} />
        <Legend wrapperStyle={{ fontSize: 11, color: '#64748b' }} />
        {chart.series.map((s, i) => {
          const color = s.color || SERIES_COLORS[i % SERIES_COLORS.length];
          const unit = s.type === 'spread' ? 'bps' : '%';
          return (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={color}
              dot={false}
              strokeWidth={1.5}
              connectNulls={false}
              unit={` ${unit}`}
            >
              <LabelList
                dataKey={s.key}
                position="right"
                content={({ x, y, value, index }) => (
                  <EndLabel
                    viewBox={{ x, y }}
                    value={value}
                    color={color}
                    unit={unit}
                    index={index}
                    total={chartData.length}
                  />
                )}
              />
            </Line>
          );
        })}
      </LineChart>
    </ResponsiveContainer>
  );
}

function PeriodSelector({ period, setPeriod, customFrom, setCustomFrom, customTo, setCustomTo }) {
  return (
    <div className={styles.periodWrap}>
      <div className={styles.miniPeriods}>
        {PERIODS.map(p => (
          <button
            key={p}
            className={`${styles.miniPeriod} ${period === p ? styles.miniPeriodOn : ''}`}
            onClick={() => setPeriod(p)}
          >{p}</button>
        ))}
      </div>
      {period === 'Custom' && (
        <div className={styles.dateRange}>
          <input type="date" className={styles.dateInput} value={customFrom} onChange={e => setCustomFrom(e.target.value)} />
          <span className={styles.dateSep}>→</span>
          <input type="date" className={styles.dateInput} value={customTo} onChange={e => setCustomTo(e.target.value)} />
        </div>
      )}
    </div>
  );
}

function SavedChart({ chart, data, layout, onDelete, onToggleWide, onMaximize, onPeriodChange, onDragStart, onDragOver, onDrop, isDragOver, onTogglePack, isInPack }) {
  const [period, setPeriod] = useState(layout?.period || chart.timeframe || '1Y');
  const [customFrom, setCustomFrom] = useState(layout?.customFrom || '');
  const [customTo, setCustomTo] = useState(layout?.customTo || '');
  const [deleting, setDeleting] = useState(false);
  const isWide = layout?.wide || false;

  const handlePeriodChange = (p) => { setPeriod(p); onPeriodChange(chart.id, { period: p, customFrom, customTo }); };
  const handleFromChange = (v) => { setCustomFrom(v); onPeriodChange(chart.id, { period, customFrom: v, customTo }); };
  const handleToChange = (v) => { setCustomTo(v); onPeriodChange(chart.id, { period, customFrom, customTo: v }); };

  const handleDelete = async () => {
    if (!window.confirm(`Delete "${chart.name}"?`)) return;
    setDeleting(true);
    await supabase.from('saved_charts').delete().eq('id', chart.id);
    onDelete(chart.id);
  };

  return (
    <div
      className={`${styles.card} ${isWide ? styles.cardWide : ''} ${isDragOver ? styles.dragOver : ''}`}
      draggable
      onDragStart={() => onDragStart(chart.id)}
      onDragOver={e => { e.preventDefault(); onDragOver(chart.id); }}
      onDrop={() => onDrop(chart.id)}
    >
      <div className={styles.cardHeader}>
        <div className={styles.dragHandle} title="Drag to reorder">⠿</div>
        <h3 className={styles.cardTitle}>{chart.name}</h3>
        <div className={styles.cardActions}>
          <PeriodSelector period={period} setPeriod={handlePeriodChange} customFrom={customFrom} setCustomFrom={handleFromChange} customTo={customTo} setCustomTo={handleToChange} />
          <button className={styles.iconBtn} onClick={() => onToggleWide(chart.id)} title={isWide ? 'Half width' : 'Full width'}>{isWide ? '⬛' : '⬜'}</button>
          <button className={styles.iconBtn} onClick={() => onMaximize({ chart, period, customFrom, customTo })} title="Maximise">⛶</button>
          {onTogglePack && (
            <AddToPackButton
              isInPack={isInPack}
              onToggle={() => onTogglePack(`my-chart-${chart.id}`, {
                chartId: chart.id,
                chartName: chart.name,
                series: chart.series,
                period,
                customFrom,
                customTo,
              })}
            />
          )}
          <button className={styles.deleteBtn} onClick={handleDelete} disabled={deleting}>{deleting ? '…' : '🗑'}</button>
        </div>
      </div>
      <ChartInner chart={chart} data={data} period={period} customFrom={customFrom} customTo={customTo} height={isWide ? 520 : 420} />
    </div>
  );
}

function MaximizedChart({ item, data, onClose }) {
  const { chart } = item;
  const [period, setPeriod] = useState(item.period || chart.timeframe || '1Y');
  const [customFrom, setCustomFrom] = useState(item.customFrom || '');
  const [customTo, setCustomTo] = useState(item.customTo || '');

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h2 className={styles.modalTitle}>{chart.name}</h2>
          <div className={styles.cardActions}>
            <PeriodSelector period={period} setPeriod={setPeriod} customFrom={customFrom} setCustomFrom={setCustomFrom} customTo={customTo} setCustomTo={setCustomTo} />
            <button className={styles.closeBtn} onClick={onClose} title="Close (Esc)">✕</button>
          </div>
        </div>
        <ChartInner chart={chart} data={data} period={period} customFrom={customFrom} customTo={customTo} height={700} />
      </div>
    </div>
  );
}

export default function MyCharts({ data, refreshTrigger, onTogglePack, isInPack }) {
  const [charts, setCharts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [order, setOrder] = useState(() => {
    try { return JSON.parse(localStorage.getItem('myCharts_order') || '[]'); } catch { return []; }
  });
  const [layouts, setLayouts] = useState(() => {
    try { return JSON.parse(localStorage.getItem('myCharts_layouts') || '{}'); } catch { return {}; }
  });
  const [maximized, setMaximized] = useState(null);
  const dragId = useRef(null);
  const [dragOverId, setDragOverId] = useState(null);

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

  // Sort charts by saved order
  const sortedCharts = useMemo(() => {
    if (!order.length) return charts;
    const indexed = [...charts].sort((a, b) => {
      const ai = order.indexOf(a.id);
      const bi = order.indexOf(b.id);
      if (ai === -1 && bi === -1) return 0;
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
    return indexed;
  }, [charts, order]);

  const saveOrder = useCallback((newOrder) => {
    setOrder(newOrder);
    localStorage.setItem('myCharts_order', JSON.stringify(newOrder));
  }, []);

  const saveLayouts = useCallback((newLayouts) => {
    setLayouts(newLayouts);
    localStorage.setItem('myCharts_layouts', JSON.stringify(newLayouts));
  }, []);

  const handleDragStart = (id) => { dragId.current = id; };
  const handleDragOver = (id) => { setDragOverId(id); };
  const handleDrop = (targetId) => {
    if (!dragId.current || dragId.current === targetId) { dragId.current = null; setDragOverId(null); return; }
    const ids = sortedCharts.map(c => c.id);
    const fromIdx = ids.indexOf(dragId.current);
    const toIdx = ids.indexOf(targetId);
    const newIds = [...ids];
    newIds.splice(fromIdx, 1);
    newIds.splice(toIdx, 0, dragId.current);
    saveOrder(newIds);
    dragId.current = null;
    setDragOverId(null);
  };

  const handleToggleWide = (id) => {
    const newLayouts = { ...layouts, [id]: { ...layouts[id], wide: !layouts[id]?.wide } };
    saveLayouts(newLayouts);
  };

  const handlePeriodChange = (id, periodState) => {
    const newLayouts = { ...layouts, [id]: { ...layouts[id], ...periodState } };
    saveLayouts(newLayouts);
  };

  const handleDelete = (id) => {
    setCharts(prev => prev.filter(c => c.id !== id));
    saveOrder(order.filter(x => x !== id));
  };

  if (loading) return <div className={styles.empty}>Loading saved charts…</div>;

  if (!charts.length) return (
    <div>
      <TBillPremiumChart data={data} onTogglePack={onTogglePack} isInPack={isInPack?.("tbill-premium")} />
      <div className={styles.empty}>
        <p>No saved charts yet.</p>
        <p style={{ fontSize: 13, marginTop: 8, color: '#475569' }}>
          Go to <strong>Chart Builder</strong> to create and save your first chart.
        </p>
      </div>
    </div>
  );

  return (
    <div>
      {maximized && (
        <MaximizedChart item={maximized} data={data} onClose={() => setMaximized(null)} />
      )}

      <TBillPremiumChart data={data} onTogglePack={onTogglePack} isInPack={isInPack?.("tbill-premium")} />

      <div className={styles.header}>
        <h2 className={styles.heading}>My Charts</h2>
        <p className={styles.sub}>
          {charts.length} saved chart{charts.length !== 1 ? 's' : ''} — drag to reorder · click ⬜/⬛ to resize · ⛶ to maximise
        </p>
      </div>

      <div className={styles.grid}>
        {sortedCharts.map(chart => (
          <SavedChart
            key={chart.id}
            chart={chart}
            data={data}
            layout={layouts[chart.id]}
            onDelete={handleDelete}
            onToggleWide={handleToggleWide}
            onPeriodChange={handlePeriodChange}
            onMaximize={setMaximized}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            isDragOver={dragOverId === chart.id}
            onTogglePack={onTogglePack}
            isInPack={isInPack?.(`my-chart-${chart.id}`)}
          />
        ))}
      </div>
    </div>
  );
}
