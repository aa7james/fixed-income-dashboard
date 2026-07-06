import React, { useMemo } from 'react';
import {
  ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, LabelList,
} from 'recharts';
import styles from './MarketPricing.module.css';

// Parse "NxM" tenor into start month for sorting
function tenorStartMonth(name) {
  const m = name.match(/(\d+)[Xx](\d+)/);
  return m ? parseInt(m[1], 10) : 999;
}

function buildFraCurveData(fraInstruments, baseInstrument, latestRow) {
  if (!latestRow) return [];

  const baseVal = baseInstrument ? (latestRow[baseInstrument.name] ?? null) : null;

  // Sort FRAs by tenor
  const sorted = [...fraInstruments].sort((a, b) => tenorStartMonth(a.name) - tenorStartMonth(b.name));

  const points = [];

  // Prepend the base rate as first point
  if (baseInstrument && baseVal != null) {
    points.push({
      label: baseInstrument.display_label || baseInstrument.name,
      rate: +baseVal.toFixed(4),
      increase: null,
    });
  }

  sorted.forEach((inst, i) => {
    const rate = latestRow[inst.name] ?? null;
    const prevRate = i === 0 ? baseVal : (latestRow[sorted[i - 1].name] ?? null);
    const increase = rate != null && prevRate != null ? +((rate - prevRate).toFixed(4)) : null;
    points.push({
      label: inst.display_label || inst.name,
      rate: rate != null ? +rate.toFixed(4) : null,
      increase,
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

function FraCurveChart({ title, data }) {
  if (!data.length) return null;

  return (
    <div className={styles.chartCard}>
      <h3 className={styles.chartTitle}>{title}</h3>

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
              <td>Increase</td>
              {data.map(d => <td key={d.label}>{d.increase != null ? d.increase : '—'}</td>)}
            </tr>
          </tbody>
        </table>
      </div>

      {/* Line chart — rate level */}
      <p className={styles.subLabel}>FRA Curve</p>
      <ResponsiveContainer width="100%" height={220}>
        <ComposedChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis dataKey="label" tick={{ fill: '#64748b', fontSize: 10 }} />
          <YAxis
            domain={['auto', 'auto']}
            tick={{ fill: '#64748b', fontSize: 10 }}
            tickFormatter={v => `${v}%`}
            width={50}
          />
          <Tooltip content={<CustomTooltip />} />
          <Line
            type="monotone"
            dataKey="rate"
            name="Rate"
            stroke="#38bdf8"
            strokeWidth={2}
            dot={{ r: 4, fill: '#38bdf8' }}
            connectNulls={false}
          >
            <LabelList dataKey="rate" position="top" style={{ fill: '#38bdf8', fontSize: 10 }} formatter={v => `${v}%`} />
          </Line>
        </ComposedChart>
      </ResponsiveContainer>

      {/* Bar chart — increments */}
      <p className={styles.subLabel}>Increase</p>
      <ResponsiveContainer width="100%" height={180}>
        <ComposedChart data={data.slice(1)} margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis dataKey="label" tick={{ fill: '#64748b', fontSize: 10 }} />
          <YAxis
            domain={['auto', 'auto']}
            tick={{ fill: '#64748b', fontSize: 10 }}
            tickFormatter={v => `${v}%`}
            width={50}
          />
          <Tooltip content={<CustomTooltip />} />
          <Bar dataKey="increase" name="Increase" fill="#38bdf8" radius={[4, 4, 0, 0]}>
            <LabelList dataKey="increase" position="top" style={{ fill: '#94a3b8', fontSize: 10 }} formatter={v => v != null ? `${v}%` : ''} />
          </Bar>
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function MarketPricing({ data, instruments }) {
  const latestRow = useMemo(() => {
    if (!data?.dataRows?.length) return null;
    return data.dataRows[data.dataRows.length - 1];
  }, [data]);

  const latestDate = useMemo(() => {
    if (!data?.dataRows?.length) return '';
    return data.dataRows[data.dataRows.length - 1].dateStr || '';
  }, [data]);

  // Split FRA instruments into JIBAR and Zaronia groups
  const { jibarFras, zaroniaFras, jibarBase, zaroniaBase } = useMemo(() => {
    const fras = instruments.filter(i => i.category === 'FRAs');
    const jibarFras = fras.filter(i => i.name.toLowerCase().includes('jibar'));
    const zaroniaFras = fras.filter(i => i.name.toLowerCase().includes('zaronia'));

    // Base rates — most recent spot rate for each
    const jibarBase = instruments.find(i =>
      i.category !== 'FRAs' && i.name.toLowerCase().includes('jibar') && i.name.toLowerCase().includes('3m')
    );
    const zaroniaBase = instruments.find(i =>
      i.category !== 'FRAs' && i.name.toLowerCase() === 'zaronia'
    );

    return { jibarFras, zaroniaFras, jibarBase, zaroniaBase };
  }, [instruments]);

  const jibarData   = useMemo(() => buildFraCurveData(jibarFras,   jibarBase,   latestRow), [jibarFras,   jibarBase,   latestRow]);
  const zaroniaData = useMemo(() => buildFraCurveData(zaroniaFras, zaroniaBase, latestRow), [zaroniaFras, zaroniaBase, latestRow]);

  return (
    <div className={styles.wrap}>
      <div className={styles.heading}>
        <h2 className={styles.title}>Market Pricing</h2>
        {latestDate && <span className={styles.date}>as at {latestDate}</span>}
      </div>

      <div className={styles.grid}>
        {jibarData.length > 0   && <FraCurveChart title="JIBAR FRA Curve"   data={jibarData} />}
        {zaroniaData.length > 0 && <FraCurveChart title="Zaronia FRA Curve" data={zaroniaData} />}
      </div>
    </div>
  );
}
