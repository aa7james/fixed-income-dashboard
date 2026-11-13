import React, { useMemo } from 'react';
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, Label,
} from 'recharts';
import ResizableChart from './ResizableChart';
import styles from './YieldCurve.module.css';

const PREF_COLOR = '#c084fc'; // purple — distinct from the bond/swap/cash palette

// Dot with the share code floating above it.
const PrefDot = (props) => {
  const { cx, cy, payload } = props;
  if (cx == null || cy == null) return null;
  return (
    <g>
      <circle cx={cx} cy={cy} r={5} fill={PREF_COLOR} stroke="#0f172a" strokeWidth={1} />
      <text x={cx} y={cy - 10} textAnchor="middle" fill={PREF_COLOR} fontSize={9.5} fontWeight={700}>
        {payload?.label}
      </text>
    </g>
  );
};

const PrefTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  return (
    <div className={styles.tooltip} style={{ maxWidth: 220 }}>
      <p className={styles.tooltipLabel}>{d.label}</p>
      <p className={styles.tooltipTenor}>Preference share · perpetual</p>
      <p className={styles.tooltipYield}>{d.y.toFixed(2)}% dividend yield</p>
    </div>
  );
};

export default function PreferenceShares({ data, instruments }) {
  const latest = data?.dataRows?.[data.dataRows.length - 1];

  // Each active pref with a sensible dividend-yield reading, sorted low → high.
  const prefs = useMemo(() => {
    if (!latest) return [];
    const rows = (instruments || [])
      .filter(i => i.category === 'Preference Shares' && i.is_active !== false)
      .map(i => {
        const v = Number(latest[i.name]);
        return (latest[i.name] != null && isFinite(v) && v > 0 && v < 40)
          ? { name: i.name, label: i.display_label || i.name, y: +v.toFixed(2) }
          : null;
      })
      .filter(Boolean)
      .sort((a, b) => a.y - b.y);
    return rows.map((r, i) => ({ ...r, x: i }));
  }, [latest, instruments]);

  const avg = useMemo(
    () => (prefs.length ? +(prefs.reduce((s, p) => s + p.y, 0) / prefs.length).toFixed(2) : null),
    [prefs]
  );

  // Longest-dated SA government bond yield, as a comparison reference.
  const saLong = useMemo(() => {
    if (!latest) return null;
    const pts = (instruments || [])
      .filter(i => i.category === 'Government Bonds' && i.maturity_date
        && latest[i.name] != null && Number(latest[i.name]) > 0.5 && Number(latest[i.name]) < 40)
      .map(i => ({
        x: (new Date(i.maturity_date) - latest.date) / (365.25 * 24 * 3600 * 1000),
        y: Number(latest[i.name]),
      }))
      .filter(p => p.x > 0)
      .sort((a, b) => a.x - b.x);
    if (!pts.length) return null;
    const p = pts[pts.length - 1];
    return { y: +p.y.toFixed(2), yr: Math.round(p.x) };
  }, [latest, instruments]);

  const yDomain = useMemo(() => {
    const vals = [...prefs.map(p => p.y), avg, saLong?.y].filter(v => v != null && isFinite(v));
    if (!vals.length) return [0, 15];
    const lo = Math.floor((Math.min(...vals) - 0.5) * 2) / 2;
    const hi = Math.ceil((Math.max(...vals) + 0.5) * 2) / 2;
    return [Math.max(0, lo), hi];
  }, [prefs, avg, saLong]);

  const Header = (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
      <div>
        <h2 className={styles.heading} style={{ marginBottom: 2 }}>Preference Shares</h2>
        <p className={styles.sub}>
          Indicated gross dividend yield · perpetual (no maturity, so shown as a separate band)
        </p>
      </div>
      {avg != null && (
        <div style={{ textAlign: 'right', fontSize: 12, color: '#94a3b8' }}>
          <div><span style={{ color: PREF_COLOR, fontWeight: 700 }}>●</span> Average {avg.toFixed(2)}%</div>
          {saLong && <div><span style={{ color: '#4ade80', fontWeight: 700 }}>●</span> SA {saLong.yr}y govt {saLong.y.toFixed(2)}%</div>}
        </div>
      )}
    </div>
  );

  if (!prefs.length) {
    return (
      <div style={{ marginTop: 32 }}>
        {Header}
        <div className={styles.empty} style={{ marginTop: 12 }}>
          No preference-share data yet. Click <strong>Refresh Data</strong> (top of the dashboard) to pull today’s dividend yields.
        </div>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 32 }}>
      {Header}
      <div className={styles.chartWrap} style={{ marginTop: 10 }}>
        <ResizableChart width="100%" height={360}>
          <ScatterChart margin={{ top: 24, right: 120, left: 0, bottom: 16 }}>
            <CartesianGrid strokeDasharray="4 4" stroke="#334155" strokeOpacity={0.8} />
            <XAxis
              dataKey="x"
              type="number"
              domain={[-0.5, prefs.length - 0.5]}
              ticks={prefs.map(p => p.x)}
              tickFormatter={(i) => prefs[i]?.label || ''}
              tick={{ fill: '#94a3b8', fontSize: 10 }}
              angle={-45}
              textAnchor="end"
              height={56}
              interval={0}
            />
            <YAxis
              dataKey="y"
              type="number"
              name="Dividend yield"
              domain={yDomain}
              tickFormatter={v => `${v.toFixed(1)}%`}
              tick={{ fill: '#94a3b8', fontSize: 11 }}
              width={56}
            />
            <Tooltip content={<PrefTooltip />} cursor={{ strokeDasharray: '3 3' }} />
            {avg != null && (
              <ReferenceLine y={avg} stroke={PREF_COLOR} strokeDasharray="6 4" strokeWidth={1.5} ifOverflow="extendDomain">
                <Label value={`Avg ${avg.toFixed(2)}%`} position="right" fill={PREF_COLOR} fontSize={10.5} fontWeight={700} />
              </ReferenceLine>
            )}
            {saLong && (
              <ReferenceLine y={saLong.y} stroke="#4ade80" strokeDasharray="6 4" strokeWidth={1.5} ifOverflow="extendDomain">
                <Label value={`SA ${saLong.yr}y govt ${saLong.y.toFixed(2)}%`} position="right" fill="#4ade80" fontSize={10.5} fontWeight={700} />
              </ReferenceLine>
            )}
            <Scatter data={prefs} fill={PREF_COLOR} shape={<PrefDot />} />
          </ScatterChart>
        </ResizableChart>

        {/* Exact values, for quick reading */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
          {prefs.map(p => (
            <span key={p.name} style={{
              fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 8,
              border: '1px solid #334155', background: '#0f172a', color: '#e2e8f0',
            }}>
              <span style={{ color: PREF_COLOR }}>{p.label}</span>&nbsp;{p.y.toFixed(2)}%
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
