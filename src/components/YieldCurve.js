import React, { useState, useMemo } from 'react';
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import styles from './YieldCurve.module.css';

// Hardcoded maturity dates — these never change for SA bonds
const BOND_MATURITIES = {
  'R210 Bond':   '2028-03-31',
  'R2030 Bond':  '2030-01-31',
  'R213 Bond':   '2031-02-28',
  'R2032 Bond':  '2032-03-31',
  'R2033':       '2033-03-31',
  'R202 Bond':   '2034-01-31',
  'R2035 Bond':  '2035-02-28',
  'R209 Bond':   '2036-03-31',
  'R2037 Bond':  '2037-01-31',
  'R2038 Bond':  '2038-03-31',
  'R2039 Bond':  '2039-03-31',
  'R2040 Bond':  '2040-01-31',
  'R2042 Bond':  '2042-03-31',
  'R214 Bond':   '2041-02-28',
  'R2044 Bond':  '2044-01-31',
  'R2048 Bond':  '2048-02-28',
  'R2053 Bond':  '2053-03-31',
  'TN27':        '2027-11-14',
  'TN30':        '2030-10-09',
  'FRX31':       '2031-02-21',
  'HWAY34':      '2034-07-31',
  'ES33':        '2033-09-15',
  'ES42':        '2042-04-25',
  'SOAF 5 7/8 06/22/30': '2030-06-22',
};

// Short display labels for bonds
const BOND_LABELS = {
  'R210 Bond': 'R210', 'R2030 Bond': 'R2030', 'R213 Bond': 'R213',
  'R2032 Bond': 'R2032', 'R2033': 'R2033', 'R202 Bond': 'R202',
  'R2035 Bond': 'R2035', 'R209 Bond': 'R209', 'R2037 Bond': 'R2037',
  'R2038 Bond': 'R2038', 'R2039 Bond': 'R2039', 'R2040 Bond': 'R2040',
  'R2042 Bond': 'R2042', 'R214 Bond': 'R214', 'R2044 Bond': 'R2044',
  'R2048 Bond': 'R2048', 'R2053 Bond': 'R2053',
  'TN27': 'TN27', 'TN30': 'TN30', 'FRX31': 'FRX31',
  'HWAY34': 'HWAY34', 'ES33': 'ES33', 'ES42': 'ES42',
  'SOAF 5 7/8 06/22/30': 'SOAF30',
};

const CATEGORIES = {
  'Swap Curve': {
    color: '#38bdf8',
    defaultOn: true,
    instruments: [
      { col: '1 Year SWAP',  label: '1Y',  tenor: 1 },
      { col: '2 Year SWAP',  label: '2Y',  tenor: 2 },
      { col: '3 Year SWAP',  label: '3Y',  tenor: 3 },
      { col: '4 Year SWAP',  label: '4Y',  tenor: 4 },
      { col: '5 Year SWAP',  label: '5Y',  tenor: 5 },
      { col: '6 Year SWAP',  label: '6Y',  tenor: 6 },
      { col: '7 Year SWAP',  label: '7Y',  tenor: 7 },
      { col: '8 Year SWAP',  label: '8Y',  tenor: 8 },
      { col: '9 Year SWAP',  label: '9Y',  tenor: 9 },
      { col: '10 Year SWAP', label: '10Y', tenor: 10 },
      { col: '12 Year SWAP', label: '12Y', tenor: 12 },
      { col: '15 Year SWAP', label: '15Y', tenor: 15 },
      { col: '20 Year SWAP', label: '20Y', tenor: 20 },
    ],
  },
  'Government Bonds': {
    color: '#4ade80',
    defaultOn: true,
    bonds: [
      'R210 Bond', 'R2030 Bond', 'R213 Bond', 'R2032 Bond', 'R2033',
      'R202 Bond', 'R2035 Bond', 'R209 Bond', 'R2037 Bond', 'R2038 Bond',
      'R2039 Bond', 'R2040 Bond', 'R2042 Bond', 'R214 Bond', 'R2044 Bond',
      'R2048 Bond', 'R2053 Bond',
    ],
  },
  'NCDs': {
    color: '#fb923c',
    defaultOn: false,
    instruments: [
      { col: '1m Fixed Rate NCD',  label: '1m',  tenor: 1/12 },
      { col: '2m Fixed Rate NCD',  label: '2m',  tenor: 2/12 },
      { col: '3m Fixed Rate NCD',  label: '3m',  tenor: 3/12 },
      { col: '4m Fixed Rate NCD',  label: '4m',  tenor: 4/12 },
      { col: '5m Fixed Rate NCD',  label: '5m',  tenor: 5/12 },
      { col: '6m Fixed Rate NCD',  label: '6m',  tenor: 6/12 },
      { col: '7m Fixed Rate NCD',  label: '7m',  tenor: 7/12 },
      { col: '8m Fixed Rate NCD',  label: '8m',  tenor: 8/12 },
      { col: '9m Fixed Rate NCD',  label: '9m',  tenor: 9/12 },
      { col: '10m Fixed Rate NCD', label: '10m', tenor: 10/12 },
      { col: '11m Fixed Rate NCD', label: '11m', tenor: 11/12 },
      { col: '12m Fixed Rate NCD', label: '12m', tenor: 1 },
      { col: '2y Fixed Rate NCD',  label: '2y',  tenor: 2 },
      { col: '3y Fixed Rate NCD2', label: '3y',  tenor: 3 },
    ],
  },
  'T-Bills': {
    color: '#818cf8',
    defaultOn: false,
    instruments: [
      { col: '3m T-Bill',  label: '3m',  tenor: 0.25 },
      { col: '6m T-Bill',  label: '6m',  tenor: 0.5 },
      { col: '9m T-Bill',  label: '9m',  tenor: 0.75 },
      { col: '12m T-Bill', label: '12m', tenor: 1 },
    ],
  },
  'SOE Bonds': {
    color: '#f472b6',
    defaultOn: false,
    bonds: ['TN27', 'TN30', 'FRX31', 'HWAY34', 'ES33', 'ES42'],
  },
};

const DATE_COLORS = ['#e2e8f0', '#fbbf24', '#a78bfa', '#f87171', '#34d399'];

function yearsTo(refDate, isoStr) {
  return (new Date(isoStr) - refDate) / (365.25 * 24 * 3600 * 1000);
}

function buildSeries(category, row, refDate) {
  if (!row) return [];
  const points = [];

  if (category.instruments) {
    for (const { col, label, tenor } of category.instruments) {
      const y = row[col];
      if (y == null) continue;
      points.push({ x: +tenor.toFixed(4), y: +y.toFixed(4), label });
    }
  }

  if (category.bonds) {
    for (const col of category.bonds) {
      const matStr = BOND_MATURITIES[col];
      if (!matStr) continue;
      const y = row[col];
      if (y == null) continue;
      const x = yearsTo(refDate, matStr);
      if (x <= 0) continue;
      points.push({ x: +x.toFixed(2), y: +y.toFixed(4), label: BOND_LABELS[col] || col });
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
  const { cx, cy, fill, payload } = props;
  if (!cx || !cy) return null;
  return (
    <g>
      <circle cx={cx} cy={cy} r={4} fill={fill} stroke="#0f172a" strokeWidth={1} />
    </g>
  );
};

function formatTenor(x) {
  if (x < 1) return `${Math.round(x * 12)}m`;
  if (Number.isInteger(x)) return `${x}y`;
  return `${x}y`;
}

export default function YieldCurve({ data }) {
  const allDates = data.dataRows.map(r => r.dateStr);
  const latest = data.dataRows[data.dataRows.length - 1];

  const [selectedDates, setSelectedDates] = useState([latest?.dateStr].filter(Boolean));
  const [inputDate, setInputDate] = useState('');
  const [activeCategories, setActiveCategories] = useState(
    () => Object.fromEntries(Object.entries(CATEGORIES).map(([k, v]) => [k, v.defaultOn]))
  );

  const addDate = () => {
    const match = allDates.find(d => d === inputDate || d.startsWith(inputDate));
    if (match && !selectedDates.includes(match) && selectedDates.length < 3) {
      setSelectedDates(prev => [...prev, match]);
    }
    setInputDate('');
  };

  const removeDate = (d) => setSelectedDates(prev => prev.filter(x => x !== d));

  const toggleCategory = (cat) => {
    setActiveCategories(prev => ({ ...prev, [cat]: !prev[cat] }));
  };

  const fmtDate = (s) => new Date(s).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' });

  // Build all series: for each active category × each selected date
  const allSeries = useMemo(() => {
    const series = [];
    selectedDates.forEach((dateStr, di) => {
      const row = data.dataRows.find(r => r.dateStr === dateStr);
      const refDate = new Date(dateStr);
      const dateColor = DATE_COLORS[di % DATE_COLORS.length];
      Object.entries(CATEGORIES).forEach(([catName, cat]) => {
        if (!activeCategories[catName]) return;
        const points = buildSeries(cat, row, refDate);
        if (!points.length) return;
        series.push({
          key: `${catName}__${dateStr}`,
          catName,
          dateStr,
          color: selectedDates.length === 1 ? cat.color : dateColor,
          stroke: cat.color,
          data: points,
          label: selectedDates.length === 1 ? catName : `${catName} (${fmtDate(dateStr)})`,
        });
      });
    });
    return series;
  }, [selectedDates, activeCategories, data.dataRows]);

  const xDomain = useMemo(() => {
    const all = allSeries.flatMap(s => s.data.map(p => p.x));
    if (!all.length) return [0, 20];
    return [0, Math.ceil(Math.max(...all)) + 1];
  }, [allSeries]);

  const yDomain = useMemo(() => {
    const all = allSeries.flatMap(s => s.data.map(p => p.y));
    if (!all.length) return [0, 15];
    const min = Math.floor(Math.min(...all) * 2) / 2;
    const max = Math.ceil(Math.max(...all) * 2) / 2;
    return [Math.max(0, min - 0.5), max + 0.5];
  }, [allSeries]);

  return (
    <div>
      <h2 className={styles.heading}>SA Fixed Income Yield Curve</h2>
      <p className={styles.sub}>Fixed-rate instruments only · Tenor vs Yield</p>

      {/* Category toggles */}
      <div className={styles.categoryBar}>
        {Object.entries(CATEGORIES).map(([cat, cfg]) => (
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

      {/* Chart */}
      {allSeries.length > 0 ? (
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
              <Legend
                wrapperStyle={{ fontSize: 12, color: '#94a3b8', paddingTop: 8 }}
              />
              {allSeries.map(s => (
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
