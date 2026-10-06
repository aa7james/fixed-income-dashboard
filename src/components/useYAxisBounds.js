import React, { useState } from 'react';

// Reusable manual y-axis bounds. Each chart calls this, renders `Control`
// above the chart, and passes `domain` to its primary <YAxis>. Blank = auto.
const inpStyle = { width: 70, fontSize: 12, padding: '4px 6px', borderRadius: 6, border: '1px solid #334155', background: '#0f172a', color: '#e2e8f0' };

export function useYAxisBounds(label = 'Y-axis') {
  const [yMin, setYMin] = useState('');
  const [yMax, setYMax] = useState('');
  const lo = yMin !== '' && !isNaN(+yMin) ? +yMin : 'auto';
  const hi = yMax !== '' && !isNaN(+yMax) ? +yMax : 'auto';
  const domain = [lo, hi];

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

  return { domain, Control, yMin, yMax };
}
