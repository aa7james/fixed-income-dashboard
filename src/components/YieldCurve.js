import React, { useState, useMemo, useEffect } from 'react';
import InflationLinkedBonds from './InflationLinkedBonds';
import TBillPremiumChart from './TBillPremiumChart';
import AddToPackButton from './AddToPackButton';
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
  BarChart, Bar, Cell, ReferenceLine,
} from 'recharts';
import styles from './YieldCurve.module.css';

const CURVE_CATEGORIES = {
  'Swaps':            { color: '#38bdf8', defaultOn: true  },
  'Government Bonds': { color: '#4ade80', defaultOn: true  },
  'Inflation Linked': { color: '#facc15', defaultOn: false },
  'Fixed Rate NCDs':  { color: '#fb923c', defaultOn: false },
  'T-Bills':          { color: '#818cf8', defaultOn: false },
  'SOE / Corporate Bonds': { color: '#f472b6', defaultOn: false },
};

const SWAP_TENORS = {
  '1 Year SWAP': 1,  '2 Year SWAP': 2,  '3 Year SWAP': 3,
  '4 Year SWAP': 4,  '5 Year SWAP': 5,  '6 Year SWAP': 6,
  '7 Year SWAP': 7,  '8 Year SWAP': 8,  '9 Year SWAP': 9,
  '10 Year SWAP': 10, '12 Year SWAP': 12, '15 Year SWAP': 15,
  '20 Year SWAP': 20,
};

const NCD_TENORS = {
  '1m Fixed Rate NCD': 1/12,  '2m Fixed Rate NCD': 2/12,
  '3m Fixed Rate NCD': 3/12,  '4m Fixed Rate NCD': 4/12,
  '5m Fixed Rate NCD': 5/12,  '6m Fixed Rate NCD': 6/12,
  '7m Fixed Rate NCD': 7/12,  '8m Fixed Rate NCD': 8/12,
  '9m Fixed Rate NCD': 9/12,  '10m Fixed Rate NCD': 10/12,
  '11m Fixed Rate NCD': 11/12, '12m Fixed Rate NCD': 1,
  '2y Fixed Rate NCD': 2,      '3y Fixed Rate NCD2': 3,
};

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

// Relative comparison presets
const COMPARISON_PRESETS = [
  { label: '1W ago',  days: 7   },
  { label: '1M ago',  days: 30  },
  { label: '3M ago',  days: 91  },
  { label: '6M ago',  days: 182 },
  { label: '1Y ago',  days: 365 },
  { label: '2Y ago',  days: 730 },
  { label: '5Y ago',  days: 1825 },
];

const LS_KEY = 'yieldCurvePrefs';

function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch { return {}; }
}
function savePrefs(prefs) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(prefs)); } catch {}
}

function yearsTo(refDate, isoStr) {
  return (new Date(isoStr) - refDate) / (365.25 * 24 * 3600 * 1000);
}

// Find the nearest available date in dataRows to a target date
function nearestDate(dataRows, targetDate) {
  if (!dataRows.length) return null;
  const target = targetDate.getTime();
  let best = null, bestDiff = Infinity;
  for (const row of dataRows) {
    const diff = Math.abs(row.date.getTime() - target);
    if (diff < bestDiff) { bestDiff = diff; best = row.dateStr; }
  }
  return best;
}

function buildPoints(catName, row, refDate, instruments) {
  if (!row) return [];
  const points = [];

  if (catName === 'Swaps') {
    for (const [col, tenor] of Object.entries(SWAP_TENORS)) {
      const y = row[col];
      if (y == null) continue;
      points.push({ x: tenor, y: +y.toFixed(4), label: `${tenor}Y`, name: col });
    }
  } else if (catName === 'Fixed Rate NCDs') {
    for (const [col, tenor] of Object.entries(NCD_TENORS)) {
      const y = row[col];
      if (y == null) continue;
      const months = Math.round(tenor * 12);
      points.push({ x: +tenor.toFixed(4), y: +y.toFixed(4), label: months < 12 ? `${months}m` : `${tenor}y`, name: col });
    }
  } else if (catName === 'T-Bills') {
    for (const [col, tenor] of Object.entries(TBILL_TENORS)) {
      const y = row[col];
      if (y == null) continue;
      points.push({ x: tenor, y: +y.toFixed(4), label: `${Math.round(tenor * 12)}m`, name: col });
    }
  } else {
    const catInstruments = instruments.filter(i => i.category === catName && i.maturity_date);
    for (const inst of catInstruments) {
      const y = row[inst.name];
      if (y == null) continue;
      const x = yearsTo(refDate, inst.maturity_date);
      if (x <= 0) continue;
      points.push({ x: +x.toFixed(2), y: +y.toFixed(4), label: inst.display_label || inst.name, name: inst.name });
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
      <text x={cx} y={cy - 9} textAnchor="middle" fill={fill} fontSize={9} fontWeight={600}>
        {payload?.label}
      </text>
    </g>
  );
};

const SpreadTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0];
  const bps = d?.value;
  if (bps == null) return null;
  return (
    <div className={styles.tooltip}>
      <p className={styles.tooltipLabel}>{d.payload.label}</p>
      <p style={{ color: bps >= 0 ? '#f87171' : '#4ade80', fontWeight: 700, margin: 0 }}>
        {bps >= 0 ? '+' : ''}{bps.toFixed(1)} bps
      </p>
    </div>
  );
};

function formatTenor(x) {
  if (x < 1) return `${Math.round(x * 12)}m`;
  return `${x}y`;
}

export default function YieldCurve({ data, instruments, packItems = [], onTogglePack, isInPack, packMode = false, packConfig = null }) {
  const latest = data.dataRows[data.dataRows.length - 1];

  const defaultCategories = Object.fromEntries(Object.entries(CURVE_CATEGORIES).map(([k, v]) => [k, v.defaultOn]));

  // Load saved prefs from localStorage
  const savedPrefs = useMemo(() => loadPrefs(), []);

  const initCategories = packMode && packConfig ? packConfig.activeCategories
    : (savedPrefs.activeCategories || defaultCategories);
  const initTenor = packMode && packConfig ? packConfig.tenorRange
    : (savedPrefs.tenorRange || 'Full Curve');
  const initPresets = packMode && packConfig ? (packConfig.selectedPresets || [])
    : (savedPrefs.selectedPresets || []);

  const [activeCategories, setActiveCategories] = useState(initCategories);
  const [tenorRange, setTenorRange] = useState(initTenor);
  const [selectedPresets, setSelectedPresets] = useState(initPresets);

  // Resolve preset labels to actual dates dynamically
  const comparisonDates = useMemo(() => {
    if (!latest) return [];
    const latestMs = latest.date.getTime();
    return selectedPresets.map(label => {
      const preset = COMPARISON_PRESETS.find(p => p.label === label);
      if (!preset) return null;
      const target = new Date(latestMs - preset.days * 24 * 3600 * 1000);
      return nearestDate(data.dataRows, target);
    }).filter(Boolean);
  }, [selectedPresets, data.dataRows, latest]);

  const selectedDates = useMemo(() => {
    const dates = [latest?.dateStr, ...comparisonDates].filter(Boolean);
    return [...new Set(dates)];
  }, [latest, comparisonDates]);

  // Save prefs to localStorage whenever they change
  useEffect(() => {
    if (packMode) return;
    savePrefs({ activeCategories, tenorRange, selectedPresets });
  }, [activeCategories, tenorRange, selectedPresets, packMode]);

  const togglePreset = (label) => {
    setSelectedPresets(prev =>
      prev.includes(label) ? prev.filter(p => p !== label) : [...prev.slice(0, 2), label]
    );
  };

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

  // Spread chart data — compare latest vs first comparison date
  const spreadData = useMemo(() => {
    if (comparisonDates.length === 0 || !latest) return [];
    const compDateStr = comparisonDates[0];
    const currentRow = data.dataRows.find(r => r.dateStr === latest.dateStr);
    const compRow = data.dataRows.find(r => r.dateStr === compDateStr);
    if (!currentRow || !compRow) return [];

    const refDate = new Date(latest.dateStr);
    const bars = [];

    Object.entries(CURVE_CATEGORIES).forEach(([catName, cfg]) => {
      if (!activeCategories[catName]) return;
      const currentPoints = buildPoints(catName, currentRow, refDate, instruments);
      const compPoints = buildPoints(catName, compRow, refDate, instruments);
      const compMap = Object.fromEntries(compPoints.map(p => [p.name, p.y]));

      currentPoints.forEach(p => {
        const compY = compMap[p.name];
        if (compY == null) return;
        const bps = (p.y - compY) * 100;
        bars.push({ label: p.label, bps: +bps.toFixed(1), x: p.x, catColor: cfg.color });
      });
    });

    bars.sort((a, b) => a.x - b.x);
    return bars;
  }, [comparisonDates, latest, data.dataRows, activeCategories, instruments]);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h2 className={styles.heading}>SA Fixed Income Yield Curve</h2>
          <p className={styles.sub}>Fixed-rate instruments only · Tenor vs Yield</p>
        </div>
        {!packMode && onTogglePack && (
          <button
            onClick={() => onTogglePack(`yield-curve-${Date.now()}`, {
              activeCategories,
              tenorRange,
              selectedPresets,
            })}
            style={{ fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 6, border: '1px solid #334155', background: 'transparent', color: '#64748b', cursor: 'pointer' }}
          >
            + Add to Pack
          </button>
        )}
      </div>

      {!packMode && (<>
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

        {/* Comparison date presets */}
        <div className={styles.dateRow}>
          <div className={styles.chips}>
            <span style={{ fontSize: 11, color: '#64748b', marginRight: 6, alignSelf: 'center' }}>Compare vs:</span>
            {COMPARISON_PRESETS.map(preset => {
              const isOn = selectedPresets.includes(preset.label);
              const idx = selectedPresets.indexOf(preset.label);
              const color = isOn ? DATE_COLORS[(idx + 1) % DATE_COLORS.length] : undefined;
              return (
                <button
                  key={preset.label}
                  onClick={() => togglePreset(preset.label)}
                  style={{
                    fontSize: 11, fontWeight: 600, padding: '3px 10px',
                    borderRadius: 12, cursor: 'pointer',
                    border: `1px solid ${isOn ? color : '#334155'}`,
                    background: isOn ? color + '22' : 'transparent',
                    color: isOn ? color : '#64748b',
                    transition: 'all 0.15s',
                  }}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
          {selectedPresets.length > 0 && (
            <div style={{ fontSize: 11, color: '#475569', marginTop: 4 }}>
              {selectedPresets.map((label, i) => {
                const resolved = comparisonDates[i];
                return resolved ? (
                  <span key={label} style={{ marginRight: 12 }}>
                    <span style={{ color: DATE_COLORS[(i + 1) % DATE_COLORS.length] }}>● {label}</span>
                    {' → '}{fmtDate(resolved)}
                  </span>
                ) : null;
              })}
            </div>
          )}
        </div>
      </>)}

      {filteredSeries.length > 0 ? (
        <div className={styles.chartWrap}>
          <ResponsiveContainer width="100%" height={440}>
            <ScatterChart margin={{ top: 16, right: 24, left: 0, bottom: 24 }}>
              <CartesianGrid strokeDasharray="4 4" stroke="#334155" strokeOpacity={0.8} />
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

      {/* Spread bar chart */}
      {spreadData.length > 0 && (
        <div className={styles.chartWrap} style={{ marginTop: 24 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#94a3b8', marginBottom: 8 }}>
            Spread vs {selectedPresets[0]} — change in yield (bps)
            <span style={{ fontSize: 11, fontWeight: 400, color: '#475569', marginLeft: 8 }}>
              positive = yields rose · negative = yields fell
            </span>
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={spreadData} margin={{ top: 8, right: 24, left: 0, bottom: 48 }}>
              <CartesianGrid strokeDasharray="4 4" stroke="#334155" strokeOpacity={0.8} />
              <XAxis
                dataKey="label"
                tick={{ fill: '#94a3b8', fontSize: 10 }}
                angle={-45}
                textAnchor="end"
                interval={0}
              />
              <YAxis
                tickFormatter={v => `${v > 0 ? '+' : ''}${v}`}
                tick={{ fill: '#94a3b8', fontSize: 11 }}
                width={48}
                unit=" bps"
              />
              <Tooltip content={<SpreadTooltip />} />
              <ReferenceLine y={0} stroke="#475569" strokeWidth={1.5} />
              <Bar dataKey="bps" radius={[3, 3, 0, 0]}>
                {spreadData.map((entry, i) => (
                  <Cell key={i} fill={entry.bps >= 0 ? '#f87171' : '#4ade80'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {!packMode && (
        <>
          <TBillPremiumChart data={data} />

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 24, marginBottom: 4 }}>
            <AddToPackButton isInPack={isInPack?.('inflation-linked')} onToggle={() => onTogglePack('inflation-linked')} />
          </div>
          <InflationLinkedBonds />
        </>
      )}
    </div>
  );
}
