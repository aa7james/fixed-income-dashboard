import React, { useState, useMemo } from 'react';
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import styles from './YieldCurve.module.css';

// Which categories appear on the yield curve, their colours, and whether on by default
const CURVE_CATEGORIES = {
  'Swaps':            { color: '#38bdf8', defaultOn: true  },
  'Government Bonds': { color: '#4ade80', defaultOn: true  },
  'Inflation Linked': { color: '#facc15', defaultOn: false },
  'Fixed Rate NCDs':  { color: '#fb923c', defaultOn: false },
  'T-Bills':          { color: '#818cf8', defaultOn: false },
  'SOE / Corporate Bonds': { color: '#f472b6', defaultOn: false },
};

// Swap tenors — fixed, won't change
const SWAP_TENORS = {
  '1 Year SWAP': 1,  '2 Year SWAP': 2,  '3 Year SWAP': 3,
  '4 Year SWAP': 4,  '5 Year SWAP': 5,  '6 Year SWAP': 6,
  '7 Year SWAP': 7,  '8 Year SWAP': 8,  '9 Year SWAP': 9,
  '10 Year SWAP': 10, '12 Year SWAP': 12, '15 Year SWAP': 15,
  '20 Year SWAP': 20,
};

// NCD tenors
const NCD_TENORS = {
  '1m Fixed Rate NCD': 1/12,  '2m Fixed Rate NCD': 2/12,
  '3m Fixed Rate NCD': 3/12,  '4m Fixed Rate NCD': 4/12,
  '5m Fixed Rate NCD': 5/12,  '6m Fixed Rate NCD': 6/12,
  '7m Fixed Rate NCD': 7/12,  '8m Fixed Rate NCD': 8/12,
  '9m Fixed Rate NCD': 9/12,  '10m Fixed Rate NCD': 10/12,
  '11m Fixed Rate NCD': 11/12, '12m Fixed Rate NCD': 1,
  '2y Fixed Rate NCD': 2,      '3y Fixed Rate NCD2': 3,
};

// T-Bill tenors
const TBILL_TENORS = {
  '3m T-Bill': 0.25, '6m T-Bill': 0.5,
  '9m T-Bill': 0.75, '12m T-Bill': 1,
};

const TENOR_RANGES = [
  { label: 'Short Term',  max: 2,    description: '0 – 2 years' },
  { label: 'Medium Term', max: 10,   description: '0 – 10 years' },
  { label: 'Full Curve',  max: null, description: 'All maturities' },
];

const DATE_COLORS = ['#e2e8f0', '#fbbf24', '#a78bfa', '#f87171', '#34d399'];

function yearsTo(refDate, isoStr) {
  return (new Date(isoStr) - refDate) / (365.25 * 24 * 3600 * 1000);
}

function buildPoints(catName, row, refDate, instruments) {
  if (!row) return [];
  const points = [];

  if (catName === 'Swaps') {
    for (const [col, tenor] of Object.entries(SWAP_TENORS)) {
      const y = row[col];
      if (y == null) continue;
      points.push({ x: tenor, y: +y.toFixed(4), label: `${tenor}Y` });
    }
  } else if (catName === 'Fixed Rate NCDs') {
    for (const [col, tenor] of Object.entries(NCD_TENORS)) {
      const y = row[col];
      if (y == null) continue;
      const months = Math.round(tenor * 12);
      points.push({ x: +tenor.toFixed(4), y: +y.toFixed(4), label: months < 12 ? `${months}m` : `${tenor}y` });
    }
  } else if (catName === 'T-Bills') {
    for (const [col, tenor] of Object.entries(TBILL_TENORS)) {
      const y = row[col];
      if (y == null) continue;
      points.push({ x: tenor, y: +y.toFixed(4), label: `${Math.round(tenor * 12)}m` });
    }
  } else {
    // Bond categories — use maturity_date from instruments table
    const catInstruments = instruments.filter(i => i.category === catName && i.maturity_date);
    for (const inst of catInstruments) {
      const y = row[inst.name];
      if (y == null) continue;
      const x = yearsTo(refDate, inst.maturity_date);
      if (x <= 0) continue;
      points.push({ x: +x.toFixed(2), y: +y.toFixed(4), label: inst.display_label || inst.name });
    }
    points.sort((a, b) => a.x - b.x);
  }

  return points;
}

const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  return (
    <div className={styles.tooltip}>
      <p className={styles.tooltipLabel}>{d.label}</p>
      <p className={styles.tooltipTenor}>{d.x < 1 ? `${Math.round(d.x * 12)}m` : `${d.x.toFixed(1)}y`}</p>
      <p className={styles.tooltipYield}>{d.y.toFixed(3)}%</p>
    </div>
  );
};

const CustomDot = (props) => {
  const { cx, cy, fill } = props;
  if (!cx || !cy) return null;
  return (
    <g>
      <circle cx={cx} cy={cy} r={4} fill={fill} stroke="#0f172a" strokeWidth={1} />
    </g>
  );
};

function formatTenor(x) {
  if (x < 1) return `${Math.round(x * 12)}m`;
  return `${x}y`;
}

export default function YieldCurve({ data, instruments }) {
  const allDates = data.dataRows.map(r => r.dateStr);
  const latest = data.dataRows[data.dataRows.length - 1];

  const [selectedDates, setSelectedDates] = useState([latest?.dateStr].filter(Boolean));
  const [inputDate, setInputDate] = useState('');
  const [activeCategories, setActiveCategories] = useState(
    () => Object.fromEntries(Object.entries(CURVE_CATEGORIES).map(([k, v]) => [k, v.defaultOn]))
  );
  const [tenorRange, setTenorRange] = useState('Full Curve');

  const addDate = () => {
    const match = allDates.find(d => d === inputDate || d.startsWith(inputDate));
    if (match && !selectedDates.includes(match) && selectedDates.length < 3) {
      setSelectedDates(prev => [...prev, match]);
    }
    setInputDate('');
  };

  const removeDate = (d) => setSelectedDates(prev => prev.filter(x => x !== d));
  const toggleCategory = (cat) => setActiveCategories(prev => ({ ...prev, [cat]: !prev[cat] }));
  const fmtDate = (s) => new Date(s).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' });

  const allSeries = useMemo(() => {
    const series = [];
    selectedDates.forEach((dateStr, di) => {
      const row = data.dataRows.find(r => r.dateStr === dateStr);
      const refDate = new Date(dateStr);
      const dateColor = DATE_COLORS[di % DATE_COLORS.length];
      Object.entries(CURVE_CATEGORIES).forEach(([catName, cfg]) => {
        if (!activeCategories[catName]) return;
        const points = buildPoints(catName, row, refDate, instruments);
        if (!points.length) return;
        series.push({
          key: `${catName}__${dateStr}`,
          catName,
          dateStr,
          color: selectedDates.length === 1 ? cfg.color : dateColor,
          stroke: cfg.color,
          data: points,
          label: selectedDates.length === 1 ? catName : `${catName} (${fmtDate(dateStr)})`,
        });
      });
    });
    return series;
  }, [selectedDates, activeCategories, data.dataRows, instruments]);

  const activeRange = TENOR_RANGES.find(r => r.label === tenorRange) || TENOR_RANGES[2];

  const filteredSeries = useMemo(() => {
    if (!activeRange.max) return allSeries;
    return allSeries.map(s => ({
      ...s,
      data: s.data.filter(p => p.x <= activeRange.max),
    })).filter(s => s.data.length > 0);
  }, [allSeries, activeRange]);

  const xDomain = useMemo(() => {
    if (activeRange.max) return [0, activeRange.max];
    const all = filteredSeries.flatMap(s => s.data.map(p => p.x));
    if (!all.length) return [0, 30];
    return [0, Math.ceil(Math.max(...all)) + 1];
  }, [filteredSeries, activeRange]);

  const yDomain = useMemo(() => {
    const all = filteredSeries.flatMap(s => s.data.map(p => p.y));
    if (!all.length) return [0, 15];
    const min = Math.floor(Math.min(...all) * 2) / 2;
    const max = Math.ceil(Math.max(...all) * 2) / 2;
    return [Math.max(0, min - 0.5), max + 0.5];
  }, [filteredSeries]);

  return (
    <div>
      <h2 className={styles.heading}>SA Fixed Income Yield Curve</h2>
      <p className={styles.sub}>Fixed-rate instruments only · Tenor vs Yield</p>

      {/* Tenor range selector */}
      <div className={styles.categoryBar}>
        {TENOR_RANGES.map(r => (
          <button
            key={r.label}
            className={`${styles.catBtn} ${tenorRange === r.label ? styles.catBtnOn : ''}`}
            style={tenorRange === r.label ? { borderColor: '#94a3b8', color: '#e2e8f0', background: '#94a3b822' } : {}}
            onClick={() => setTenorRange(r.label)}
            title={r.description}
          >
            {r.label}
          </button>
        ))}
      </div>

      {/* Category toggles */}
      <div className={styles.categoryBar}>
        {Object.entries(CURVE_CATEGORIES).map(([cat, cfg]) => (
          <button
            key={cat}
            className={`${styles.catBtn} ${activeCategories[cat] ? styles.catBtnOn : ''}`}
            style={activeCategories[cat] ? { borderColor: cfg.color, color: cfg.color, background: cfg.color + '22' } : {}}
            onClick={() => toggleCategory(cat)}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Date selector */}
      <div className={styles.dateRow}>
        <div className={styles.chips}>
          {selectedDates.map((d, i) => (
            <span key={d} className={styles.chip} style={{ borderColor: DATE_COLORS[i % DATE_COLORS.length] }}>
              <span style={{ color: DATE_COLORS[i % DATE_COLORS.length] }}>{fmtDate(d)}</span>
              <button className={styles.chipX} onClick={() => removeDate(d)}>×</button>
            </span>
          ))}
        </div>
        {selectedDates.length < 3 && (
          <div className={styles.addRow}>
            <input
              className={styles.dateInput}
              list="ycDatelist"
              placeholder="Add comparison date…"
              value={inputDate}
              onChange={e => setInputDate(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addDate()}
            />
            <datalist id="ycDatelist">
              {allDates.slice(-500).map(d => <option key={d} value={d} />)}
            </datalist>
            <button className={styles.addBtn} onClick={addDate}>+ Add</button>
          </div>
        )}
      </div>

      {filteredSeries.length > 0 ? (
        <div className={styles.chartWrap}>
          <ResponsiveContainer width="100%" height={440}>
            <ScatterChart margin={{ top: 16, right: 24, left: 0, bottom: 24 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis
                dataKey="x"
                type="number"
                name="Tenor"
                domain={xDomain}
                tickFormatter={formatTenor}
                label={{ value: 'Tenor', position: 'insideBottom', offset: -14, fill: '#475569', fontSize: 12 }}
                tick={{ fill: '#94a3b8', fontSize: 11 }}
              />
              <YAxis
                dataKey="y"
                type="number"
                name="Yield"
                domain={yDomain}
                tickFormatter={v => `${v.toFixed(2)}%`}
                tick={{ fill: '#94a3b8', fontSize: 11 }}
                width={56}
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ fontSize: 12, color: '#94a3b8', paddingTop: 8 }} />
              {filteredSeries.map(s => (
                <Scatter
                  key={s.key}
                  name={s.label}
                  data={s.data}
                  fill={s.color}
                  line={{ stroke: s.color, strokeWidth: 2 }}
                  lineType="joint"
                  shape={<CustomDot fill={s.color} />}
                />
              ))}
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className={styles.empty}>Enable at least one category above.</div>
      )}
    </div>
  );
}
