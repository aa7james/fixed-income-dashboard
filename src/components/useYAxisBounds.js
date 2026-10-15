import React, { useState } from 'react';

// Reusable manual y-axis bounds + clean, evenly-spaced gridlines.
// Call useYAxisBounds(label, values) where `values` is the array of numeric
// y-values the chart plots; render `Control` above the chart and pass
// `domain={yb.domain} ticks={yb.ticks} interval={0}` to the primary <YAxis>.
const inpStyle = { width: 70, fontSize: 12, padding: '4px 6px', borderRadius: 6, border: '1px solid #334155', background: '#0f172a', color: '#e2e8f0' };

// Nice-number tick generator: picks a step from 1/2/2.5/5 × 10^k so gridlines
// land on round values (e.g. 0.25% increments for yields, 10k for rand).
export function niceTicks(lo, hi, maxTicks = 11) {
  if (!isFinite(lo) || !isFinite(hi)) return null;
  if (lo === hi) { lo -= Math.abs(lo) * 0.1 || 0.5; hi += Math.abs(hi) * 0.1 || 0.5; }
  const span = hi - lo;
  if (span <= 0) return null;
  const mag = Math.pow(10, Math.floor(Math.log10(span / maxTicks)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => span / s <= maxTicks) || 10 * mag;
  const dLo = Math.floor(lo / step + 1e-9) * step;
  const dHi = Math.ceil(hi / step - 1e-9) * step;
  const ticks = [];
  for (let v = dLo; v <= dHi + step * 1e-6; v += step) ticks.push(+v.toFixed(6));
  return { domain: [+dLo.toFixed(6), +dHi.toFixed(6)], ticks, step };
}

// Flatten the finite numeric y-values out of an array of chart rows, skipping
// the x-axis / label keys so the nice-tick domain is based only on plotted values.
const DEFAULT_X_KEYS = ['x', 'month', 'date', 'dateStr', 'mat', 'tenor', 'name', 'label', 'maturity'];
export function flatY(data, exclude = DEFAULT_X_KEYS, keep = null) {
  const ex = new Set(exclude);
  const keepSet = keep ? new Set(keep) : null;
  const out = [];
  if (!Array.isArray(data)) return out;
  for (const row of data) {
    if (row && typeof row === 'object') {
      for (const k in row) {
        if (keepSet ? !keepSet.has(k) : ex.has(k)) continue;
        if (row[k] == null || row[k] === '') continue; // skip gaps — Number(null)===0 would be a phantom 0
        const v = Number(row[k]);
        if (isFinite(v)) out.push(v);
      }
    } else { const v = Number(row); if (isFinite(v)) out.push(v); }
  }
  return out;
}

export function useYAxisBounds(label = 'Y-axis', values = null) {
  const [yMin, setYMin] = useState('');
  const [yMax, setYMax] = useState('');
  const hasMin = yMin !== '' && !isNaN(+yMin);
  const hasMax = yMax !== '' && !isNaN(+yMax);

  let domain, ticks;
  const nums = Array.isArray(values) ? values.map(Number).filter(v => isFinite(v)) : [];
  if (nums.length) {
    const dataLo = Math.min(...nums), dataHi = Math.max(...nums);
    const pad = (dataHi - dataLo) * 0.04;
    const nt = niceTicks(hasMin ? +yMin : dataLo - pad, hasMax ? +yMax : dataHi + pad);
    if (nt) {
      const dlo = hasMin ? +yMin : nt.domain[0];
      const dhi = hasMax ? +yMax : nt.domain[1];
      domain = [dlo, dhi];
      ticks = nt.ticks.filter(t => t >= dlo - 1e-9 && t <= dhi + 1e-9);
    } else {
      domain = ['auto', 'auto'];
    }
  } else {
    // No values supplied: fall back to plain bounds (recharts auto-ticks).
    domain = (!hasMin && !hasMax) ? ['auto', 'auto'] : [hasMin ? +yMin : 'dataMin', hasMax ? +yMax : 'dataMax'];
  }

  const Control = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '4px 0 10px', flexWrap: 'wrap' }}>
      <span style={{ fontSize: 12, color: '#94a3b8' }}>{label}:</span>
      <input type="number" step="0.25" placeholder="min" value={yMin} onChange={e => setYMin(e.target.value)} style={inpStyle} />
      <span style={{ color: '#475569' }}>–</span>
      <input type="number" step="0.25" placeholder="max" value={yMax} onChange={e => setYMax(e.target.value)} style={inpStyle} />
      <span style={{ fontSize: 11, color: '#64748b' }}>blank = auto</span>
      {(yMin !== '' || yMax !== '') && (
        <button onClick={() => { setYMin(''); setYMax(''); }}
          style={{ fontSize: 11, padding: '3px 10px', borderRadius: 10, border: '1px solid #334155', background: 'transparent', color: '#f87171', cursor: 'pointer' }}>Reset</button>
      )}
    </div>
  );

  return { domain, ticks, Control, yMin, yMax };
}
