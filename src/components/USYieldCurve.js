import React, { useMemo } from 'react';
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import styles from './YieldCurve.module.css';

// US on-the-run benchmarks, plotted at NOMINAL tenor (the generic CT##/CB##
// tickers roll to the current benchmark, so stored maturities would drift).
const US_TSY_TENORS = {
  'US 2Y Treasury': 2,   'US 3Y Treasury': 3,   'US 5Y Treasury': 5,
  'US 7Y Treasury': 7,   'US 10Y Treasury': 10, 'US 20Y Treasury': 20,
  'US 30Y Treasury': 30,
};
const US_BILL_TENORS = {
  'US 1M T-Bill': 1/12, 'US 2M T-Bill': 2/12, 'US 3M T-Bill': 0.25,
  'US 4M T-Bill': 4/12, 'US 6M T-Bill': 0.5,  'US 1Y T-Bill': 1,
};

const TSY_COLOR  = '#fb7185';
const BILL_COLOR = '#c084fc';

function formatTenor(x) {
  if (x < 1) return `${Math.round(x * 12)}m`;
  return `${x}y`;
}

const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  return (
    <div className={styles.tooltip}>
      <p className={styles.tooltipLabel}>{d.label}</p>
      <p className={styles.tooltipTenor}>{d.x < 1 ? `${Math.round(d.x * 12)}m` : `${d.x.toFixed(1)}y`}</p>
      <p className={styles.tooltipYield}>{d.y.toFixed(2)}%</p>
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

function buildSeries(tenorMap, color, label, row) {
  const pts = [];
  for (const [name, tenor] of Object.entries(tenorMap)) {
    const y = row?.[name];
    if (y == null) continue;
    pts.push({ x: tenor, y: +y.toFixed(2), label: formatTenor(tenor), name });
  }
  pts.sort((a, b) => a.x - b.x);
  return { key: label, color, data: pts, label };
}

export default function USYieldCurve({ data }) {
  const latest = data?.dataRows?.length ? data.dataRows[data.dataRows.length - 1] : null;

  const series = useMemo(() => {
    if (!latest) return [];
    const s = [
      buildSeries(US_BILL_TENORS, BILL_COLOR, 'US T-Bills', latest),
      buildSeries(US_TSY_TENORS,  TSY_COLOR,  'US Treasuries', latest),
    ];
    return s.filter(x => x.data.length > 0);
  }, [latest]);

  const allPts = series.flatMap(s => s.data);
  if (!allPts.length) return null; // hide until US data exists

  const xMax = Math.ceil(Math.max(...allPts.map(p => p.x))) + 1;
  const yVals = allPts.map(p => p.y);
  const yDomain = [
    Math.max(0, Math.floor(Math.min(...yVals) * 2) / 2 - 0.5),
    Math.ceil(Math.max(...yVals) * 2) / 2 + 0.5,
  ];

  const fmtDate = latest.dateStr || '';

  return (
    <div style={{ marginTop: 32 }}>
      <div>
        <h2 className={styles.heading}>US Treasury Yield Curve</h2>
        <p className={styles.sub}>On-the-run benchmarks · Tenor vs Yield{fmtDate ? ` · as at ${fmtDate}` : ''}</p>
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
                shape={<CustomDot fill={s.color} />}
              />
            ))}
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
