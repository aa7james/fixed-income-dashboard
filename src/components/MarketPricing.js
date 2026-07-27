import React, { useMemo, useState } from 'react';
import AddToPackButton from './AddToPackButton';
import {
  ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, LabelList,
} from 'recharts';
import styles from './MarketPricing.module.css';

// Parse "NxM" or "N×M" — returns end month for X-axis positioning
function tenorEndMonth(name) {
  const m = name.match(/(\d+)[Xx×](\d+)/);
  return m ? parseInt(m[2], 10) : 999;
}
function tenorStartMonth(name) {
  const m = name.match(/(\d+)[Xx×](\d+)/);
  return m ? parseInt(m[1], 10) : 999;
}

// Relative comparison presets
const COMPARISON_PRESETS = [
  { label: '1W ago',  days: 7   },
  { label: '1M ago',  days: 30  },
  { label: '3M ago',  days: 91  },
  { label: '6M ago',  days: 182 },
  { label: '1Y ago',  days: 365 },
];

// Find the nearest available row to a target date
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

function buildFraCurveData(fraInstruments, baseInstrument, latestRow) {
  if (!latestRow) return [];

  const baseVal = baseInstrument ? (latestRow[baseInstrument.name] ?? null) : null;

  const sorted = [...fraInstruments].sort((a, b) => tenorStartMonth(a.name) - tenorStartMonth(b.name));

  const points = [];

  // Base rate at month 0
  if (baseInstrument && baseVal != null) {
    points.push({
      label: baseInstrument.display_label || baseInstrument.name,
      month: 0,
      rate: +baseVal.toFixed(2),
      cumulative: null,
    });
  }

  sorted.forEach(inst => {
    const rate = latestRow[inst.name] ?? null;
    // Cumulative = total increase from base rate
    const cumulative = rate != null && baseVal != null ? +((rate - baseVal).toFixed(2)) : null;
    points.push({
      label: inst.display_label || inst.name,
      month: tenorEndMonth(inst.name),
      rate: rate != null ? +rate.toFixed(2) : null,
      cumulative,
    });
  });

  return points;
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, padding: '10px 14px' }}>
      <p style={{ color: '#94a3b8', fontSize: 12, marginBottom: 6 }}>{label}</p>
      {payload.map(p => p.value != null && (
        <p key={p.dataKey} style={{ color: p.color, fontSize: 13, margin: '2px 0' }}>
          {p.name}: <strong>{p.value}%</strong>
        </p>
      ))}
    </div>
  );
};

function FraCurveChart({ title, subtitle, data, packKey, isInPack, onTogglePack }) {
  if (!data.length) return null;

  const barData = data.slice(1); // exclude base from bar chart

  return (
    <div className={styles.chartCard}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <h3 className={styles.chartTitle} style={{ margin: 0 }}>{title}</h3>
          {subtitle && <span style={{ fontSize: 12, color: '#64748b' }}>{subtitle}</span>}
        </div>
        {onTogglePack && (
          <AddToPackButton isInPack={isInPack} onToggle={() => onTogglePack(packKey)} />
        )}
      </div>

      {/* Summary table */}

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Tenor</th>
              {data.map(d => <th key={d.label}>{d.label}</th>)}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Rate</td>
              {data.map(d => <td key={d.label}>{d.rate ?? '—'}</td>)}
            </tr>
            <tr>
              <td>Cum. Increase</td>
              {data.map(d => <td key={d.label}>{d.cumulative != null ? d.cumulative : '—'}</td>)}
            </tr>
          </tbody>
        </table>
      </div>

      {/* Line chart — rate level, X-axis spaced by actual end month */}
      <p className={styles.subLabel}>FRA Curve</p>
      <ResponsiveContainer width="100%" height={220}>
        <ComposedChart data={data} margin={{ top: 16, right: 20, left: 0, bottom: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis
            dataKey="month"
            type="number"
            domain={[0, 'dataMax']}
            ticks={data.map(d => d.month)}
            tickFormatter={m => {
              const pt = data.find(d => d.month === m);
              return pt ? pt.label : m;
            }}
            tick={{ fill: '#64748b', fontSize: 9 }}
            interval={0}
          />
          <YAxis
            domain={['auto', 'auto']}
            tick={{ fill: '#64748b', fontSize: 10 }}
            tickFormatter={v => `${v}%`}
            width={50}
          />
          <Tooltip
            labelFormatter={m => { const pt = data.find(d => d.month === m); return pt ? pt.label : m; }}
            content={<CustomTooltip />}
          />
          <Line
            type="monotone"
            dataKey="rate"
            name="Rate"
            stroke="#38bdf8"
            strokeWidth={2}
            dot={{ r: 4, fill: '#38bdf8' }}
            connectNulls={true}
          >
            <LabelList dataKey="rate" position="top" style={{ fill: '#38bdf8', fontSize: 10 }} formatter={v => `${v}%`} />
          </Line>
        </ComposedChart>
      </ResponsiveContainer>

      {/* Bar chart — cumulative increase from base */}
      <p className={styles.subLabel}>Cumulative Increase from Base</p>
      <ResponsiveContainer width="100%" height={200}>
        <ComposedChart data={barData} margin={{ top: 20, right: 20, left: 0, bottom: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis
            dataKey="month"
            type="number"
            domain={[0, 'dataMax']}
            ticks={barData.map(d => d.month)}
            tickFormatter={m => {
              const pt = barData.find(d => d.month === m);
              return pt ? pt.label : m;
            }}
            tick={{ fill: '#64748b', fontSize: 9 }}
            interval={0}
          />
          <YAxis
            domain={[0, 'auto']}
            tick={{ fill: '#64748b', fontSize: 10 }}
            tickFormatter={v => `${v}%`}
            width={50}
          />
          <Tooltip
            labelFormatter={m => { const pt = barData.find(d => d.month === m); return pt ? pt.label : m; }}
            content={<CustomTooltip />}
          />
          <Bar dataKey="cumulative" name="Cum. Increase" fill="#38bdf8" radius={[4, 4, 0, 0]} barSize={28}>
            <LabelList dataKey="cumulative" position="top" style={{ fill: '#94a3b8', fontSize: 10 }} formatter={v => v != null ? `${v}%` : ''} />
          </Bar>
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function MarketPricing({ data, instruments, onTogglePack, isInPack, packMode = false, packKeys = [] }) {
  const [selectedPreset, setSelectedPreset] = useState(null);
  const [customDate, setCustomDate] = useState('');

  const latestRow = useMemo(() => {
    if (!data?.dataRows?.length) return null;
    return data.dataRows[data.dataRows.length - 1];
  }, [data]);

  const latestDate = useMemo(() => {
    if (!data?.dataRows?.length) return '';
    return data.dataRows[data.dataRows.length - 1].dateStr || '';
  }, [data]);

  const { zaroniaFras, sofrFras, zaroniaBase, sofrBase } = useMemo(() => {
    const fras = instruments.filter(i => i.category === 'FRAs');
    const zaroniaFras = fras.filter(i => i.name.toLowerCase().includes('zaronia'));
    const sofrFras = fras.filter(i => i.name.toLowerCase().includes('sofr') && i.name !== 'SOFR');

    const zaroniaBase = instruments.find(i =>
      i.category !== 'FRAs' && i.name.toLowerCase() === 'zaronia'
    );
    const sofrBase = instruments.find(i =>
      i.name === 'SOFR'
    );

    return { zaroniaFras, sofrFras, zaroniaBase, sofrBase };
  }, [instruments]);

  const zaroniaData = useMemo(() => buildFraCurveData(zaroniaFras, zaroniaBase, latestRow), [zaroniaFras, zaroniaBase, latestRow]);
  const sofrData    = useMemo(() => buildFraCurveData(sofrFras,    sofrBase,    latestRow), [sofrFras,    sofrBase,    latestRow]);

  // Resolve the selected comparison date to an actual data row
  const comparisonRow = useMemo(() => {
    if (!data?.dataRows?.length || !latestRow) return null;
    let target = null;
    if (customDate) {
      const [y, m, d] = customDate.split('-').map(Number);
      if (y && m && d) target = new Date(y, m - 1, d);
    } else if (selectedPreset) {
      const preset = COMPARISON_PRESETS.find(p => p.label === selectedPreset);
      if (preset) target = new Date(latestRow.date.getTime() - preset.days * 24 * 3600 * 1000);
    }
    if (!target) return null;
    return nearestRow(data.dataRows, target);
  }, [data, latestRow, customDate, selectedPreset]);

  const comparisonDateStr = comparisonRow?.dateStr || '';

  const zaroniaCompData = useMemo(() => buildFraCurveData(zaroniaFras, zaroniaBase, comparisonRow), [zaroniaFras, zaroniaBase, comparisonRow]);
  const sofrCompData    = useMemo(() => buildFraCurveData(sofrFras,    sofrBase,    comparisonRow), [sofrFras,    sofrBase,    comparisonRow]);

  const selectPreset = (label) => {
    setSelectedPreset(prev => prev === label ? null : label);
    setCustomDate('');
  };
  const selectCustom = (v) => {
    setCustomDate(v);
    setSelectedPreset(null);
  };
  const clearComparison = () => {
    setSelectedPreset(null);
    setCustomDate('');
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.heading}>
        <h2 className={styles.title}>Market Pricing</h2>
        {latestDate && <span className={styles.date}>as at {latestDate}</span>}
      </div>

      <div className={styles.grid}>
        {zaroniaData.length > 0 && (!packMode || packKeys.includes('zaronia-fra')) && (
          <FraCurveChart
            title="Zaronia FRA Curve"
            data={zaroniaData}
            packKey="zaronia-fra"
            isInPack={isInPack?.('zaronia-fra')}
            onTogglePack={packMode ? null : onTogglePack}
          />
        )}
        {sofrData.length > 0 && (!packMode || packKeys.includes('sofr-fra')) && (
          <FraCurveChart
            title="SOFR FRA Curve"
            data={sofrData}
            packKey="sofr-fra"
            isInPack={isInPack?.('sofr-fra')}
            onTogglePack={packMode ? null : onTogglePack}
          />
        )}
      </div>

      {/* Historical comparison — only in the interactive (non-pack) view */}
      {!packMode && (
        <>
          <div style={{ marginTop: 32, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#94a3b8', marginRight: 4 }}>Compare against date:</span>
            {COMPARISON_PRESETS.map(preset => {
              const on = selectedPreset === preset.label;
              return (
                <button
                  key={preset.label}
                  onClick={() => selectPreset(preset.label)}
                  style={{
                    fontSize: 11, fontWeight: 600, padding: '4px 12px', borderRadius: 12, cursor: 'pointer',
                    border: `1px solid ${on ? '#60a5fa' : '#334155'}`,
                    background: on ? 'rgba(96,165,250,0.15)' : 'transparent',
                    color: on ? '#60a5fa' : '#64748b',
                    transition: 'all 0.15s',
                  }}
                >
                  {preset.label}
                </button>
              );
            })}
            <span style={{ fontSize: 11, color: '#475569', margin: '0 4px' }}>or</span>
            <input
              type="date"
              value={customDate}
              onChange={e => selectCustom(e.target.value)}
              style={{
                fontSize: 12, padding: '4px 8px', borderRadius: 8,
                border: `1px solid ${customDate ? '#60a5fa' : '#334155'}`,
                background: '#0f172a', color: '#e2e8f0',
              }}
            />
            {(selectedPreset || customDate) && (
              <button
                onClick={clearComparison}
                style={{
                  fontSize: 11, fontWeight: 600, padding: '4px 12px', borderRadius: 12, cursor: 'pointer',
                  border: '1px solid #334155', background: 'transparent', color: '#f87171',
                }}
              >
                ✕ Clear
              </button>
            )}
          </div>

          {comparisonRow && (
            <div className={styles.grid}>
              {zaroniaCompData.length > 0 && (
                <FraCurveChart
                  title="Zaronia FRA Curve"
                  subtitle={`as at ${comparisonDateStr}`}
                  data={zaroniaCompData}
                />
              )}
              {sofrCompData.length > 0 && (
                <FraCurveChart
                  title="SOFR FRA Curve"
                  subtitle={`as at ${comparisonDateStr}`}
                  data={sofrCompData}
                />
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
