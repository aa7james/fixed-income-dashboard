// Shared x-axis time/tenor formatting so every chart reads consistently:
// long horizons in years, shorter ones in months (and years).

// Tenor in YEARS -> label. <1y shows months; whole years show "Ny";
// fractional under 2y shows total months (e.g. 18m); otherwise "Xy Mm".
export function fmtTenor(years) {
  if (!isFinite(years)) return '';
  if (years < 1 / 24) return '0';
  if (years < 1) return `${Math.round(years * 12)}m`;
  const m = Math.round(years * 12);
  if (m % 12 === 0) return `${m / 12}y`;
  if (years < 2) return `${m}m`;
  const y = Math.floor(years + 1e-9), mm = Math.round((years - y) * 12);
  return mm ? `${y}y${mm}m` : `${y}y`;
}

// Nice, evenly-spaced tenor tick positions (years) from 0..maxYears.
export function tenorTicks(maxYears, target = 7) {
  if (!(maxYears > 0)) return undefined;
  const cand = [1 / 12, 0.25, 0.5, 1, 2, 2.5, 5, 10, 20];
  const step = cand.find(s => maxYears / s <= target) || Math.ceil(maxYears / target);
  const ticks = [];
  for (let v = 0; v <= maxYears + 1e-9; v += step) ticks.push(+v.toFixed(4));
  return ticks;
}

// Month-index axis (0,1,2,… months) -> label, switching to years at 12+.
export function fmtMonths(m) {
  if (!isFinite(m)) return '';
  if (m === 0) return '0';
  if (m % 12 === 0) return `${m / 12}y`;
  if (m < 12) return `${m}m`;
  const y = Math.floor(m / 12), mm = m % 12;
  return `${y}y${mm}m`;
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function parseDate(s) {
  if (s instanceof Date) return isNaN(+s) ? null : s;
  if (typeof s !== 'string') return null;
  if (s.includes('/')) { const [mm, dd, yy] = s.split('/').map(Number); return yy ? new Date(yy, (mm || 1) - 1, dd || 1) : null; }
  if (s.includes('-')) { const [yy, mm, dd] = s.split('-').map(Number); return yy ? new Date(yy, (mm || 1) - 1, dd || 1) : null; }
  const d = new Date(s); return isNaN(+d) ? null : d;
}

// Span (days) of a calendar-date series, for deciding label granularity.
export function dateSpanDays(arr, key) {
  const ts = (arr || []).map(r => parseDate(r && r[key])).filter(Boolean).map(d => +d);
  if (ts.length < 2) return 0;
  return (Math.max(...ts) - Math.min(...ts)) / 86400000;
}

// Calendar-date tick formatter: long spans -> year only ("2026"),
// shorter -> month + year ("Oct '26").
export function makeDateFmt(spanDays) {
  const yearOnly = spanDays > 1100; // ~3y+
  return (s) => {
    const d = parseDate(s);
    if (!d) return s;
    return yearOnly ? `${d.getFullYear()}` : `${MON[d.getMonth()]} '${String(d.getFullYear()).slice(2)}`;
  };
}
