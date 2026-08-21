import React, { useMemo, useState } from 'react';
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import styles from './YieldCurve.module.css';

// US on-the-run benchmarks (constant-maturity generics), plotted at NOMINAL
// tenor. Bills + notes merged into one curve. 2M/4M omitted (no generic).
const US_TENORS = {
  'US 1M T-Bill': 1/12, 'US 3M T-Bill': 0.25, 'US 6M T-Bill': 0.5, 'US 1Y T-Bill': 1,
  'US 2Y Treasury': 2, 'US 3Y Treasury': 3, 'US 5Y Treasury': 5, 'US 7Y Treasury': 7,
  'US 10Y Treasury': 10, 'US 20Y Treasury': 20, 'US 30Y Treasury': 30,
};

const COMPARISON_PRESETS = [
  { label: '1W ago',  days: 7   },
  { label: '1M ago',  days: 30  },
  { label: '3M ago',  days: 91  },
  { label: '6M ago',  days: 182 },
  { label: '1Y ago',  days: 365 },
  { label: '2Y ago',  days: 730 },
];

const DATE_COLORS = ['#f1f5f9', '#fbbf24', '#a78bfa', '#34d399', '#f87171'];

function formatTenor(x) {
  if (x < 1) return `${Math.round(x * 12)}m`;
  return `${x}y`;
}

function nearestRow(dataRows, targetDate) {
  if (!dataRows.length) return null;
  const target = targetDate.getTime();
  let best = null, bestDiff = Infinity;
  for (const row of dataRows) {
    const diff = Math.abs(row.date.getTime() - target);
    if (diff < bestDiff) { bestDiff = diff; best = row; }
  }
  return best;
}

const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  return (
    <div className={styles.tooltip}>
      <p className={styles.tooltipLabel}>{d.tenorLabel}</p>
      <p className={styles.tooltipYield}>{d.y.toFixed(2)}%</p>
    </div>
  );
};

function DotWithLabel(props) {
  const { cx, cy, fill, payload, showLabel } = props;
  if (!cx || !cy) return null;
  return (
    <g>
      <circle cx={cx} cy={cy} r={4} fill={fill} stroke="#0f172a" strokeWidth={1} />
      {showLabel && (
        <text x={cx} y={cy - 9} textAnchor="middle" fill={fill} fontSize={9} fontWeight={600}>
          {payload?.tenorLabel}
        </text>
      )}
    </g>
  );
}

function buildCurve(row) {
  const pts = [];
  for (const [name, tenor] of Object.entries(US_TENORS)) {
    const y = row?.[name];
    if (y == null) continue;
    pts.push({ x: tenor, y: +y.toFixed(2), tenorLabel: formatTenor(tenor), name });
  }
  pts.sort((a, b) => a.x - b.x);
  return pts;
}

export default function USYieldCurve({ data }) {
  const [selectedPresets, setSelectedPresets] = useState([]);
  const dataRows = data?.dataRows || [];
  const latest = dataRows.length ? dataRows[dataRows.length - 1] : null;

  const fmtDate = (s) => new Date(s).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' });

  const comparisonRows = useMemo(() => {
    if (!latest) return [];
    const latestMs = latest.date.getTime();
    return selectedPresets.map(label => {
      const preset = COMPARISON_PRESETS.find(p => p.label === label);
      if (!preset) return null;
      return nearestRow(dataRows, new Date(latestMs - preset.days * 24 * 3600 * 1000));
    }).filter(Boolean);
  }, [selectedPresets, dataRows, latest]);

  const series = useMemo(() => {
    if (!latest) return [];
    const rows = [latest, ...comparisonRows];
    const single = rows.length === 1;
    return rows.map((row, i) => ({
      key: row.dateStr + i,
      color: DATE_COLORS[i % DATE_COLORS.length],
      label: single ? `US curve (${fmtDate(row.dateStr)})` : fmtDate(row.dateStr),
      data: buildCurve(row),
      showLabel: single,
    })).filter(s => s.data.length > 0);
  }, [latest, comparisonRows]);

  const allPts = series.flatMap(s => s.data);
  if (!allPts.length) return null;

  const xMax = Math.ceil(Math.max(...allPts.map(p => p.x))) + 1;
  const yVals = allPts.map(p => p.y);
  const yDomain = [
    Math.max(0, Math.floor(Math.min(...yVals) * 2) / 2 - 0.5),
    Math.ceil(Math.max(...yVals) * 2) / 2 + 0.5,
  ];

  const togglePreset = (label) =>
    setSelectedPresets(prev => prev.includes(label) ? prev.filter(p => p !== label) : [...prev.slice(0, 3), label]);

  return (
    <div style={{ marginTop: 32 }}>
      <div>
        <h2 className={styles.heading}>US Treasury Yield Curve</h2>
        <p className={styles.sub}>Constant-maturity benchmarks · Tenor vs Yield{latest ? ` · as at ${latest.dateStr}` : ''}</p>
      </div>

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
                  fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 12, cursor: 'pointer',
                  border: `1px solid ${isOn ? color : '#334155'}`,
                  background: isOn ? color + '22' : 'transparent',
                  color: isOn ? color : '#64748b',
                }}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className={styles.chartWrap}>
        <ResponsiveContainer width="100%" height={440}>
          <ScatterChart margin={{ top: 16, right: 24, left: 0, bottom: 24 }}>
            <CartesianGrid strokeDasharray="4 4" stroke="#334155" strokeOpacity={0.8} />
            <XAxis
              dataKey="x"
              type="number"
              name="Tenor"
              domain={[0, xMax]}
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
            {series.map(s => (
              <Scatter
                key={s.key}
                name={s.label}
                data={s.data}
                fill={s.color}
                line={{ stroke: s.color, strokeWidth: 2 }}
                lineType="joint"
                shape={<DotWithLabel fill={s.color} showLabel={s.showLabel} />}
              />
            ))}
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
