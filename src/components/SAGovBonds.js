import React, { useMemo, useState, useEffect } from 'react';
import { ComposedChart, Line, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, LabelList, Legend } from 'recharts';
import ResizableChart from './ResizableChart';
import { fmtTenor, tenorTicks } from './axisFormat';

const cell = (x = {}) => ({ padding: '8px 10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', ...x });
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const CurveTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, padding: '6px 10px', fontSize: 12, color: '#e2e8f0' }}>
      <strong>{p.label}</strong>{p.isCorp && <span style={{ color: '#fb7185' }}> · corporate</span>}<br />
      {p.mat.toFixed(1)}y · <strong style={{ color: p.isCorp ? '#fb7185' : '#38bdf8' }}>{p.ytm.toFixed(2)}%</strong>
    </div>
  );
};

// Point label that skips null rows (combined govie + corporate dataset).
const PointLabel = ({ x, y, value, fill, dy }) => {
  if (x == null || y == null || Number.isNaN(+y) || value == null) return null;
  return <text x={x} y={+y + dy} textAnchor="middle" fill={fill} fontSize={10} fontWeight={600}>{value}</text>;
};

// Dirty price per 100 face, semi-annual. y, c in %; n = years to maturity (fractional ok).
function bondPV(y, n, c) {
  if (n <= 0) return 100;
  const i = y / 200;                // per semi-annual period
  const tp = n * 2;                 // total periods to maturity
  const count = Math.ceil(tp - 1e-9);
  let pv = 0;
  for (let k = 1; k <= count; k++) {
    const t = tp - (count - k);     // periods from now to coupon k
    pv += (c / 2) / Math.pow(1 + i, t);
  }
  pv += 100 / Math.pow(1 + i, tp);  // principal at maturity
  return pv;
}

// Linear interpolation of a {N, y} curve at x years.
function interp(curve, x) {
  if (!curve.length) return null;
  if (x <= curve[0].N) return curve[0].y;
  if (x >= curve[curve.length - 1].N) return curve[curve.length - 1].y;
  for (let i = 1; i < curve.length; i++) {
    if (x <= curve[i].N) {
      const a = curve[i - 1], b = curve[i];
      return a.y + (x - a.N) / (b.N - a.N) * (b.y - a.y);
    }
  }
  return curve[curve.length - 1].y;
}

// Modified duration (% price change per 1% yield move) via 1bp finite difference.
function modDuration(y0, N, c) {
  const h = 0.01; // 1bp bump in % units
  const up = bondPV(y0 + h, N, c), dn = bondPV(y0 - h, N, c), p = bondPV(y0, N, c);
  return (-((up - dn) / (2 * h)) / p) * 100;
}

// Breakeven yield rise (bps) by full reprice: the extra move dy (on the roll-to yield,
// realised at the horizon H years) at which the bond's total return equals the cash return.
function breakevenReprice(yRoll, N, c, couponRet, P0, cashTarget, H) {
  const tr = (dy) => couponRet + (bondPV(yRoll + dy, N - H, c) / P0 - 1) * 100; // total return (%)
  const f = (dy) => tr(dy) - cashTarget; // decreasing in dy
  let lo = -5, hi = 8; // yield move in %-pts
  if (f(lo) <= 0) return lo * 100;
  if (f(hi) >= 0) return hi * 100;
  for (let k = 0; k < 80; k++) { const mid = (lo + hi) / 2; if (f(mid) > 0) lo = mid; else hi = mid; }
  return ((lo + hi) / 2) * 100;
}

// Government yield curve ({N, y}) as at a given row's date, measured from `now`.
const YR_MS = 365 * 24 * 3600 * 1000;
function curveAt(instruments, row, now) {
  const pts = [];
  for (const i of instruments) {
    if (i.category !== 'Government Bonds' || i.coupon == null || !i.maturity_date) continue;
    const v = row[i.name];
    if (v == null || !(Number(v) > 0.5 && Number(v) < 40)) continue;
    const N = (new Date(i.maturity_date) - now) / YR_MS;
    if (N > 0) pts.push({ N, y: Number(v) });
  }
  pts.sort((a, b) => a.N - b.N);
  return pts;
}

const BeHistTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  const d = new Date(label);
  const val = (k) => { const p = payload.find(x => x.dataKey === k); return p && p.value != null ? p.value : null; };
  const be = val('breakeven'), ac = val('actChange'), ex = val('actExcess');
  const row = (c, t, v) => v == null ? null : (
    <div style={{ color: c }}>{t}: <strong>{v}</strong></div>
  );
  return (
    <div style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, padding: '6px 10px', fontSize: 12, color: '#e2e8f0' }}>
      <strong>{d.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' })}</strong>
      {row('#fbbf24', 'Breakeven cushion', be == null ? null : `${be >= 0 ? '+' : ''}${Math.round(be)} bp`)}
      {row('#38bdf8', 'Actual Δyield (next period)', ac == null ? null : `${ac >= 0 ? '+' : ''}${Math.round(ac)} bp`)}
      {row('#4ade80', 'Actual excess vs cash', ex == null ? null : `${ex >= 0 ? '+' : ''}${ex.toFixed(2)}%`)}
      {be != null && ac != null && (
        <div style={{ color: '#94a3b8', marginTop: 3, fontSize: 11 }}>
          {ac <= be ? 'yield rose less than the cushion → beat cash' : 'yield rose more than the cushion → behind cash'}
        </div>
      )}
    </div>
  );
};

export default function SAGovBonds({ data, instruments }) {
  const [bench, setBench] = useState('NCD'); // 'NCD' | 'T-Bill' | 'Call' | 'Zero'
  const [callRate, setCallRate] = useState('7.10'); // editable call-account rate (%)
  const [showCurve, setShowCurve] = useState(true);
  const allRows = useMemo(() => data?.dataRows || [], [data]);
  const minISO = allRows.length ? iso(allRows[0].date) : '';
  const maxISO = allRows.length ? iso(allRows[allRows.length - 1].date) : '';
  const [asOf, setAsOf] = useState(maxISO);

  // Investment horizon in years (how long you hold before comparing to cash).
  const [horizon, setHorizon] = useState(() => {
    const v = parseFloat(localStorage.getItem('saGovBondsHorizon')); return (isFinite(v) && v > 0) ? v : 1;
  });
  const setH = (v) => { setHorizon(v); try { localStorage.setItem('saGovBondsHorizon', String(v)); } catch { /* ignore */ } };
  const [htm, setHtm] = useState(() => localStorage.getItem('saGovBondsHtm') === '1'); // hold each bond to its own maturity
  const toggleHtm = () => setHtm(v => { const n = !v; try { localStorage.setItem('saGovBondsHtm', n ? '1' : '0'); } catch { /* ignore */ } return n; });

  // Corporate/SOE bonds the user has added to the view (one at a time, persisted).
  const [addedCorp, setAddedCorp] = useState(() => {
    try { return JSON.parse(localStorage.getItem('saGovBondsCorp')) || []; } catch { return []; }
  });
  const [pickCorp, setPickCorp] = useState('');
  const saveCorp = (arr) => { setAddedCorp(arr); try { localStorage.setItem('saGovBondsCorp', JSON.stringify(arr)); } catch { /* ignore */ } };
  const corpOptions = useMemo(() => (instruments || [])
    .filter(i => i.category === 'SOE / Corporate Bonds' && i.coupon != null && i.maturity_date)
    .map(i => i.name).sort(), [instruments]);
  const addCorp = () => { if (pickCorp && !addedCorp.includes(pickCorp)) saveCorp([...addedCorp, pickCorp]); setPickCorp(''); };
  const removeCorp = (nm) => saveCorp(addedCorp.filter(n => n !== nm));

  // Custom bonds the user typed in by hand (not in the data feed), persisted.
  // Each: { id, label, couponPct, maturity (ISO), ytm }.
  const [customBonds, setCustomBonds] = useState(() => {
    try { return JSON.parse(localStorage.getItem('saGovBondsCustom')) || []; } catch { return []; }
  });
  const saveCustom = (arr) => { setCustomBonds(arr); try { localStorage.setItem('saGovBondsCustom', JSON.stringify(arr)); } catch { /* ignore */ } };
  const [cf, setCf] = useState({ label: '', couponPct: '', maturity: '', ytm: '' });
  const cfValid = cf.label.trim() && cf.maturity && isFinite(parseFloat(cf.couponPct)) && isFinite(parseFloat(cf.ytm));
  const addCustom = () => {
    if (!cfValid) return;
    const label = cf.label.trim();
    const id = `custom:${label}:${cf.maturity}`;
    if (customBonds.some(b => b.id === id)) return;
    saveCustom([...customBonds, { id, label, couponPct: parseFloat(cf.couponPct), maturity: cf.maturity, ytm: parseFloat(cf.ytm) }]);
    setCf({ label: '', couponPct: '', maturity: '', ytm: '' });
  };
  const removeCustom = (id) => saveCustom(customBonds.filter(b => b.id !== id));

  // Manual YTM overrides (per bond, persisted). For illiquid lines the Bloomberg/BVAL
  // pull can sit well off the last traded level — type your own and it drives every column.
  const [ytmOvr, setYtmOvr] = useState(() => {
    try { return JSON.parse(localStorage.getItem('saGovBondsYtm')) || {}; } catch { return {}; }
  });
  const saveYtm = (o) => { setYtmOvr(o); try { localStorage.setItem('saGovBondsYtm', JSON.stringify(o)); } catch { /* ignore */ } };
  const setOneYtm = (name, val) => { const o = { ...ytmOvr }; if (val === '' || val == null) delete o[name]; else o[name] = val; saveYtm(o); };
  const clearYtm = (name) => { const o = { ...ytmOvr }; delete o[name]; saveYtm(o); };
  const hasOvr = (name) => { const v = ytmOvr[name]; return v != null && v !== '' && isFinite(Number(v)); };

  // Breakeven-history chart: which bond, and whether the (compute-heavy) section is open.
  const [showBeChart, setShowBeChart] = useState(false);
  const [beChartBond, setBeChartBond] = useState('');
  // Manual axis bounds for the breakeven-history chart (blank = auto), persisted.
  const beAxes0 = useMemo(() => { try { return JSON.parse(localStorage.getItem('saGovBondsBeAxes')) || {}; } catch { return {}; } }, []);
  const [beBpsMin, setBeBpsMin] = useState(beAxes0.beBpsMin ?? '');
  const [beBpsMax, setBeBpsMax] = useState(beAxes0.beBpsMax ?? '');
  const [bePctMin, setBePctMin] = useState(beAxes0.bePctMin ?? '');
  const [bePctMax, setBePctMax] = useState(beAxes0.bePctMax ?? '');
  useEffect(() => {
    try { localStorage.setItem('saGovBondsBeAxes', JSON.stringify({ beBpsMin, beBpsMax, bePctMin, bePctMax })); } catch { /* ignore */ }
  }, [beBpsMin, beBpsMax, bePctMin, bePctMax]);

  // the data row on or before the selected as-of date (rows are sorted ascending)
  const latest = useMemo(() => {
    if (!allRows.length) return null;
    const target = asOf || maxISO;
    let row = allRows[0];
    for (const r of allRows) { if (iso(r.date) <= target) row = r; else break; }
    return row;
  }, [allRows, asOf, maxISO]);

  const setYearsBack = (yrs) => {
    if (!maxISO) return;
    const d = new Date(allRows[allRows.length - 1].date);
    d.setFullYear(d.getFullYear() - yrs);
    setAsOf(iso(d));
  };

  const cashRate = useMemo(() => {
    if (bench === 'Zero') return 0;
    if (bench === 'Call') { const n = parseFloat(callRate); return isNaN(n) ? null : n; }
    if (!latest) return null;
    const v = bench === 'NCD' ? latest['12m Fixed Rate NCD'] : latest['12m T-Bill'];
    return v == null ? null : Number(v);
  }, [latest, bench, callRate]);

  const benchLabel = bench === 'NCD' ? '1y NCD' : bench === 'T-Bill' ? '1y T-Bill'
    : bench === 'Call' ? 'Call' : '0% (breakeven)';

  // The data row ~H years after the as-at date (for realised / "what actually happened" columns).
  const futureRow = useMemo(() => {
    if (!latest || !allRows.length) return null;
    const target = new Date(latest.date.getTime() + horizon * 365 * 24 * 3600 * 1000);
    let best = null, bestDiff = Infinity;
    for (const r of allRows) {
      if (r.date <= latest.date) continue;
      const diff = Math.abs(r.date - target);
      if (diff < bestDiff) { bestDiff = diff; best = r; }
    }
    if (!best) return null;
    const yrsAfter = (best.date - latest.date) / (1000 * 3600 * 24 * 365);
    return (yrsAfter >= 0.75 * horizon && yrsAfter <= 1.5 * horizon) ? best : null; // need ~H of forward data
  }, [latest, allRows, horizon]);

  const rows = useMemo(() => {
    if (!latest || !instruments?.length || cashRate == null) return [];
    const now = latest.date; // value the maturities are measured from = the as-at date
    const valid = (i) => i.coupon != null && i.maturity_date
      && latest[i.name] != null && Number(latest[i.name]) > 0.5 && Number(latest[i.name]) < 40;
    const mk = (i, isCorp) => {
      const pulled = Number(latest[i.name]);
      const ov = hasOvr(i.name);
      return {
        name: i.name, label: i.display_label || i.name, isCorp, c: Number(i.coupon) * 100, maturity: i.maturity_date,
        N: (new Date(i.maturity_date) - now) / (1000 * 3600 * 24 * 365),
        ytm: ov ? Number(ytmOvr[i.name]) : pulled, pulledYtm: pulled, ytmOvr: ov,
      };
    };
    const govies = instruments.filter(i => i.category === 'Government Bonds' && valid(i)).map(i => mk(i, false));
    // Yield curve = every govie point (incl. sub-1y) so N-1 can be interpolated.
    const curve = govies.map(g => ({ N: g.N, y: g.ytm })).sort((a, b) => a.N - b.N);
    // Corporate/SOE bonds the user added — priced off the SAME govie curve, keeping their spread.
    const corps = instruments.filter(i => addedCorp.includes(i.name) && valid(i)).map(i => mk(i, true));
    // Hand-entered custom bonds — priced off the same govie curve, keeping their spread.
    const customs = customBonds.map(cb => {
      const ov = hasOvr(cb.id);
      const pulled = Number(cb.ytm);
      return {
        name: cb.id, label: cb.label, isCorp: true, custom: true,
        c: Number(cb.couponPct), maturity: cb.maturity,
        N: (new Date(cb.maturity) - now) / (1000 * 3600 * 24 * 365),
        ytm: ov ? Number(ytmOvr[cb.id]) : pulled, pulledYtm: pulled, ytmOvr: ov,
      };
    }).filter(g => isFinite(g.N) && g.N > 0 && isFinite(g.ytm) && isFinite(g.c));

    return [...govies, ...corps, ...customs]
      .filter(g => htm ? g.N > 0.02 : g.N > horizon + 0.02) // in HTM mode keep everything still alive
      .map(g => {
        const H = htm ? g.N : horizon;              // hold-to-maturity: each bond held to its own maturity
        const atMat = g.N - H <= 0.08;              // <~1 month left at horizon end => redeems at par (no rate risk)
        const cashRet = cashRate * H;               // cash rolled over the SAME holding period as the bond
        const spread = g.ytm - interp(curve, g.N);            // credit spread over the govie curve (~0 for govies)
        const yRoll = atMat ? null : interp(curve, g.N - H) + spread;  // rolls down the govie curve, keeping its spread
        const rollDown = atMat ? null : g.ytm - yRoll;        // yield given up as it rolls (%-pts)
        const mod = modDuration(g.ytm, g.N, g.c);
        const price = bondPV(g.ytm, g.N, g.c);      // dirty price today = capital invested
        const priceH = atMat ? 100 : bondPV(yRoll, g.N - H, g.c); // redeems at par, else repriced on unchanged curve
        // Coupon income / dirty price. Held to maturity, count the ACTUAL coupons paid (each c/2),
        // so the return reconciles to the YTM; the dirty price already carries the imminent/accrued
        // coupon, which the pull-to-par then amortises. Carry case keeps the simple rate x time.
        const couponRet = atMat
          ? (Math.ceil(g.N * 2 - 1e-9) * (g.c / 2) / price) * 100
          : (g.c * H / price) * 100;
        const rollRet = (priceH / price - 1) * 100; // pull-to-par (and roll-down if sold early) (%)
        const totalRet = couponRet + rollRet;       // bond's return over the holding period, curve unchanged (%)
        const excess = totalRet - cashRet;          // edge over cash held for the same period (%)
        // Held to maturity there is no rate risk at all (par is paid regardless) => breakeven n/a.
        const beBps = atMat ? null : breakevenReprice(yRoll, g.N, g.c, couponRet, price, cashRet, H);
        // Realised: what actually happened to the yield (only meaningful when sold before maturity)
        let actChange = null, actTR = null, actExcess = null;
        if (futureRow && !atMat) {
          const fv = futureRow[g.name];
          if (fv != null && Number(fv) > 0.5 && Number(fv) < 40) {
            const fY = Number(fv);
            actChange = (fY - g.ytm) * 100;                           // actual yield move (bps)
            actTR = couponRet + (bondPV(fY, g.N - H, g.c) / price - 1) * 100; // realised total return (%)
            actExcess = actTR - cashRet;                             // realised edge over the benchmark (%)
          }
        }
        return {
          ...g, mod, modH: atMat ? 0 : modDuration(g.ytm, g.N - H, g.c), atMat, H, cashRet, price,
          yRoll, rollBps: atMat ? null : rollDown * 100, spreadBps: spread * 100, couponRet, rollRet, totalRet, excess, beBps,
          actChange, actTR, actExcess,
        };
      })
      .sort((a, b) => new Date(a.maturity) - new Date(b.maturity));
  }, [latest, instruments, cashRate, futureRow, addedCorp, customBonds, ytmOvr, horizon, htm]); // eslint-disable-line react-hooks/exhaustive-deps

  const hasActual = !!futureRow;

  // ---- Breakeven history: run the table's breakeven math on every day we have ----
  // Bonds you can chart (long enough to hold the horizon), nearest maturity first.
  const beBondOptions = useMemo(() => {
    if (!instruments?.length || !latest) return [];
    const now = latest.date;
    return instruments
      .filter(i => (i.category === 'Government Bonds' || addedCorp.includes(i.name)) && i.coupon != null && i.maturity_date)
      .map(i => ({ name: i.name, label: i.display_label || i.name, isCorp: addedCorp.includes(i.name),
        N: (new Date(i.maturity_date) - now) / YR_MS }))
      .filter(o => o.N > horizon + 0.5)
      .sort((a, b) => a.N - b.N);
  }, [instruments, latest, addedCorp, horizon]);

  const defaultBeBond = useMemo(() => {
    if (!beBondOptions.length) return '';
    const r2032 = beBondOptions.find(o => /r2032/i.test(o.name) || /r2032/i.test(o.label));
    return (r2032 || beBondOptions.find(o => o.N >= 5) || beBondOptions[0]).name;
  }, [beBondOptions]);

  // Constant-maturity tenors: synthetic par bonds read straight off the curve each day,
  // so you get an unbroken history (a real bond's maturity shrinks over time).
  const isCm = (v) => typeof v === 'string' && v.startsWith('CM:');
  const beCmOptions = useMemo(
    () => [2, 5, 10, 20, 30].filter(t => t > horizon + 0.5).map(t => ({ value: `CM:${t}`, label: `${t}y constant maturity` })),
    [horizon]
  );

  const effectiveBeBond = (beChartBond && (isCm(beChartBond) || beBondOptions.some(o => o.name === beChartBond)))
    ? beChartBond : defaultBeBond;
  const beBondLabel = isCm(effectiveBeBond)
    ? `${effectiveBeBond.slice(3)}y constant maturity`
    : ((beBondOptions.find(o => o.name === effectiveBeBond) || {}).label || effectiveBeBond);

  const beHistory = useMemo(() => {
    if (!showBeChart || !effectiveBeBond || !instruments?.length || !allRows.length || cashRate == null) return [];
    const cm = isCm(effectiveBeBond) ? Number(effectiveBeBond.slice(3)) : null;
    const inst = cm ? null : instruments.find(i => i.name === effectiveBeBond);
    if (!cm && (!inst || inst.coupon == null || !inst.maturity_date)) return [];
    const instC = inst ? Number(inst.coupon) * 100 : null;
    const mat = inst ? new Date(inst.maturity_date) : null;
    const H = horizon;
    const benchVal = (r) => {
      if (bench === 'Zero') return 0;
      if (bench === 'Call') { const n = parseFloat(callRate); return isNaN(n) ? null : n; }
      const v = bench === 'NCD' ? r['12m Fixed Rate NCD'] : r['12m T-Bill'];
      return v == null ? null : Number(v);
    };
    // Yield of the position (bond or constant-maturity point) on a given row, given its
    // remaining life n; for constant maturity it's a par bond read off that day's curve.
    const yieldOnRow = (r, n) => {
      if (cm) {
        const cv = curveAt(instruments, r, r.date);
        if (cv.length < 2 || cv[cv.length - 1].N < n - 3) return null; // need the curve to reach it
        return interp(cv, n);
      }
      const v = r[inst.name];
      return (v != null && Number(v) > 0.5 && Number(v) < 40) ? Number(v) : null;
    };
    const out = [];
    for (let idx = 0; idx < allRows.length; idx++) {
      const r = allRows[idx];
      const now = r.date;
      const N = cm ? cm : (mat - now) / YR_MS;
      if (N <= H + 0.02) continue;                 // must be able to hold the full horizon
      const ytm = yieldOnRow(r, N);
      if (ytm == null) continue;
      const cr = benchVal(r);
      if (cr == null) continue;
      const curve = curveAt(instruments, r, now);
      if (curve.length < 2) continue;
      const c = cm ? ytm : instC;                  // constant maturity = par bond (coupon = its yield)
      const spread = cm ? 0 : ytm - interp(curve, N);
      const yRoll = interp(curve, N - H) + spread;
      const price = bondPV(ytm, N, c);
      const couponRet = (c * H / price) * 100;
      const cashRet = cr * H;
      const beBps = breakevenReprice(yRoll, N, c, couponRet, price, cashRet, H);
      // What actually happened over the next H years (nearest row to now + H).
      let actChange = null, actExcess = null;
      const target = now.getTime() + H * YR_MS;
      let best = null, bestDiff = Infinity;
      for (let j = idx + 1; j < allRows.length; j++) {
        const tj = allRows[j].date.getTime();
        const diff = Math.abs(tj - target);
        if (diff < bestDiff) { bestDiff = diff; best = allRows[j]; }
        if (tj > target + 0.6 * H * YR_MS) break;
      }
      if (best) {
        const yrsAfter = (best.date - now) / YR_MS;
        if (yrsAfter >= 0.75 * H && yrsAfter <= 1.5 * H) {
          const fY = yieldOnRow(best, N - H);      // same position, now aged by H years
          if (fY != null) {
            actChange = (fY - ytm) * 100;
            const actTR = couponRet + (bondPV(fY, N - H, c) / price - 1) * 100;
            actExcess = actTR - cashRet;
          }
        }
      }
      out.push({
        t: now.getTime(),
        breakeven: +beBps.toFixed(1),
        actChange: actChange == null ? null : +actChange.toFixed(1),
        actExcess: actExcess == null ? null : +actExcess.toFixed(3),
      });
    }
    return out;
  }, [showBeChart, effectiveBeBond, instruments, allRows, cashRate, horizon, bench, callRate]); // eslint-disable-line react-hooks/exhaustive-deps

  const fmtAxisDate = (ms) => new Date(ms).toLocaleDateString('en-ZA', { month: 'short', year: '2-digit' });

  // Government yield curve points (incl. sub-1y) as at the selected date.
  const curvePoints = useMemo(() => {
    if (!latest || !instruments?.length) return [];
    const now = latest.date;
    return instruments
      .filter(i => i.category === 'Government Bonds' && i.maturity_date
        && latest[i.name] != null && Number(latest[i.name]) > 0.5 && Number(latest[i.name]) < 40)
      .map(i => ({
        mat: (new Date(i.maturity_date) - now) / (1000 * 3600 * 24 * 365),
        ytm: hasOvr(i.name) ? Number(ytmOvr[i.name]) : Number(latest[i.name]), label: i.display_label || i.name,
      }))
      .filter(p => p.mat > 0)
      .sort((a, b) => a.mat - b.mat);
  }, [latest, instruments, ytmOvr]); // eslint-disable-line react-hooks/exhaustive-deps

  // Corporate/SOE points as at the selected date (added bonds only).
  const corpCurvePoints = useMemo(() => {
    if (!latest || !instruments?.length) return [];
    const now = latest.date;
    return instruments
      .filter(i => addedCorp.includes(i.name) && i.maturity_date
        && latest[i.name] != null && Number(latest[i.name]) > 0.5 && Number(latest[i.name]) < 40)
      .map(i => ({
        mat: (new Date(i.maturity_date) - now) / (1000 * 3600 * 24 * 365),
        ytm: hasOvr(i.name) ? Number(ytmOvr[i.name]) : Number(latest[i.name]), label: i.display_label || i.name,
      }))
      .filter(p => p.mat > 0).sort((a, b) => a.mat - b.mat);
  }, [latest, instruments, addedCorp, ytmOvr]); // eslint-disable-line react-hooks/exhaustive-deps

  // Hand-entered custom bonds as curve points (plotted like corporates).
  const customCurvePoints = useMemo(() => {
    if (!latest) return [];
    const now = latest.date;
    return customBonds.map(cb => ({
      mat: (new Date(cb.maturity) - now) / (1000 * 3600 * 24 * 365),
      ytm: hasOvr(cb.id) ? Number(ytmOvr[cb.id]) : Number(cb.ytm), label: cb.label,
    })).filter(p => p.mat > 0 && isFinite(p.ytm)).sort((a, b) => a.mat - b.mat);
  }, [latest, customBonds, ytmOvr]); // eslint-disable-line react-hooks/exhaustive-deps

  // One combined dataset so the tooltip resolves by whichever point is under the cursor.
  const chartData = useMemo(() => ([
    ...curvePoints.map(p => ({ mat: p.mat, label: p.label, ytm: p.ytm, yGov: p.ytm })),
    ...corpCurvePoints.map(p => ({ mat: p.mat, label: p.label, ytm: p.ytm, yCorp: p.ytm, isCorp: true })),
    ...customCurvePoints.map(p => ({ mat: p.mat, label: p.label, ytm: p.ytm, yCorp: p.ytm, isCorp: true })),
  ].sort((a, b) => a.mat - b.mat)), [curvePoints, corpCurvePoints, customCurvePoints]);

  // Clean y-axis: domain rounded out to 0.25% with evenly-spaced ticks (0.10% when narrow).
  const curveY = useMemo(() => {
    if (!curvePoints.length) return { domain: ['auto', 'auto'], ticks: undefined };
    const ys = curvePoints.map(p => p.ytm)
      .concat(corpCurvePoints.map(p => p.ytm))
      .concat(customCurvePoints.map(p => p.ytm))
      .concat(cashRate != null && cashRate > 0 ? [cashRate] : []);
    const lo = Math.floor((Math.min(...ys) - 0.1) * 4) / 4;
    const hi = Math.ceil((Math.max(...ys) + 0.1) * 4) / 4;
    const range = hi - lo;
    let step = range <= 1.2 ? 0.10 : 0.25;
    if (range / step > 30) step = 0.5;
    const ticks = [];
    for (let v = lo; v <= hi + 1e-9; v += step) ticks.push(+v.toFixed(2));
    return { domain: [lo, hi], ticks };
  }, [curvePoints, corpCurvePoints, customCurvePoints, cashRate]);

  if (!latest) return <div style={{ color: '#64748b' }}>No data available.</div>;

  const hLbl = `${horizon} year${horizon === 1 ? '' : 's'}`;
  const cashHz = cashRate != null ? cashRate * horizon : null; // cash return over the horizon

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: '#f1f5f9', margin: 0 }}>SA Government Bonds — Cash Breakeven</h2>
        <p style={{ fontSize: 13, color: '#64748b', margin: '2px 0 0' }}>
          {htm
            ? <>Each bond held to its own maturity (redeemed at par) vs cash rolled over the same period · as at {latest.dateStr}</>
            : <>How far can each bond's yield rise over {hLbl} before you'd have been better off in cash? · as at {latest.dateStr}</>}
        </p>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: '#94a3b8' }}>As at:</span>
        <input type="date" value={asOf || maxISO} min={minISO} max={maxISO}
          onChange={e => setAsOf(e.target.value)}
          style={{ fontSize: 12, padding: '4px 8px', borderRadius: 8, border: '1px solid #334155', background: '#1e293b', color: '#e2e8f0' }} />
        {[['Latest', null], ['−1y', 1], ['−3y', 3], ['−5y', 5]].map(([lbl, yrs]) => (
          <button key={lbl} onClick={() => yrs == null ? setAsOf(maxISO) : setYearsBack(yrs)}
            style={{ fontSize: 12, padding: '5px 10px', borderRadius: 8, cursor: 'pointer',
              border: '1px solid #334155', background: '#1e293b', color: '#94a3b8' }}>{lbl}</button>
        ))}
        {latest && <span style={{ fontSize: 12, color: '#64748b' }}>using data from <strong style={{ color: '#cbd5e1' }}>{latest.dateStr}</strong></span>}
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: '#94a3b8' }}>Benchmark:</span>
        {[['1y NCD', 'NCD'], ['1y T-Bill', 'T-Bill'], ['Call', 'Call'], ['0% (breakeven)', 'Zero']].map(([lbl, val]) => (
          <button key={val} onClick={() => setBench(val)}
            style={{ fontSize: 12, padding: '5px 12px', borderRadius: 8, cursor: 'pointer', fontWeight: bench === val ? 700 : 400,
              border: '1px solid #334155', background: bench === val ? '#0ea5e9' : '#1e293b', color: bench === val ? '#fff' : '#94a3b8' }}>{lbl}</button>
        ))}
        {bench === 'Call' && (
          <span style={{ fontSize: 12, color: '#94a3b8', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            rate:
            <input type="number" step="0.05" value={callRate} onChange={e => setCallRate(e.target.value)}
              style={{ width: 70, fontSize: 12, padding: '4px 6px', borderRadius: 8, border: '1px solid #334155', background: '#1e293b', color: '#e2e8f0', fontVariantNumeric: 'tabular-nums' }} />%
          </span>
        )}
        <span style={{ fontSize: 13, color: '#cbd5e1' }}>
          {benchLabel} = <strong style={{ color: '#38bdf8' }}>{cashRate != null ? cashRate.toFixed(2) : '—'}%</strong>
          {!htm && horizon !== 1 && cashHz != null && <span style={{ color: '#64748b' }}> · {hLbl} cash ≈ {cashHz.toFixed(2)}%</span>}
          {htm && <span style={{ color: '#64748b' }}> · rolled per bond to its maturity</span>}
        </span>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: '#94a3b8' }}>Horizon:</span>
        <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', opacity: htm ? 0.4 : 1, pointerEvents: htm ? 'none' : 'auto' }}>
          {[1, 2, 3, 5].map(h => (
            <button key={h} onClick={() => setH(h)}
              style={{ fontSize: 12, padding: '5px 12px', borderRadius: 8, cursor: 'pointer', fontWeight: horizon === h ? 700 : 400,
                border: '1px solid #334155', background: horizon === h ? '#0ea5e9' : '#1e293b', color: horizon === h ? '#fff' : '#94a3b8' }}>{h}y</button>
          ))}
          <span style={{ fontSize: 12, color: '#94a3b8', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            or
            <input type="number" step="0.5" min="0.5" value={horizon}
              onChange={e => { const v = parseFloat(e.target.value); if (isFinite(v) && v > 0) setH(v); }}
              style={{ width: 64, fontSize: 12, padding: '4px 6px', borderRadius: 8, border: '1px solid #334155', background: '#1e293b', color: '#e2e8f0', fontVariantNumeric: 'tabular-nums' }} />years
          </span>
        </span>
        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <button onClick={toggleHtm} title="Hold each bond to its own maturity — redeems at par, no interest-rate risk"
            style={{ fontSize: 12, fontWeight: htm ? 700 : 500, padding: '6px 14px', borderRadius: 8, cursor: 'pointer',
              border: `1px solid ${htm ? '#15803d' : '#334155'}`, background: htm ? '#166534' : '#1e293b', color: htm ? '#fff' : '#94a3b8' }}>
            ⚓ Hold to maturity{htm ? ' · ON' : ''}
          </button>
        </span>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: '#94a3b8' }}>Add corporate bond:</span>
        <select value={pickCorp} onChange={e => setPickCorp(e.target.value)}
          style={{ fontSize: 12, padding: '5px 8px', borderRadius: 8, border: '1px solid #334155', background: '#1e293b', color: '#e2e8f0', minWidth: 170 }}>
          <option value="">— select —</option>
          {corpOptions.filter(n => !addedCorp.includes(n)).map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        <button onClick={addCorp} disabled={!pickCorp}
          style={{ fontSize: 12, fontWeight: 700, padding: '6px 12px', borderRadius: 8, cursor: pickCorp ? 'pointer' : 'default',
            border: 'none', background: pickCorp ? '#0ea5e9' : '#334155', color: '#fff', opacity: pickCorp ? 1 : 0.6 }}>+ Add</button>
        {addedCorp.map(nm => (
          <span key={nm} style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 999, background: '#3f1d2e', border: '1px solid #7f1d1d', color: '#fda4af' }}>
            {nm}
            <button onClick={() => removeCorp(nm)} title="Remove" style={{ background: 'none', border: 'none', color: '#fb7185', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 0 }}>×</button>
          </span>
        ))}
        {corpOptions.length === 0 && <span style={{ fontSize: 11, color: '#64748b' }}>No corporate bonds loaded — add them in the Instruments tab first.</span>}
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: '#94a3b8' }}>Add your own bond:</span>
        <input value={cf.label} onChange={e => setCf({ ...cf, label: e.target.value })} placeholder="Name"
          style={{ width: 90, fontSize: 12, padding: '5px 8px', borderRadius: 8, border: '1px solid #334155', background: '#1e293b', color: '#e2e8f0' }} />
        <span style={{ fontSize: 12, color: '#64748b', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
          <input type="number" step="0.01" value={cf.couponPct} onChange={e => setCf({ ...cf, couponPct: e.target.value })} placeholder="Coupon"
            style={{ width: 70, fontSize: 12, padding: '5px 6px', borderRadius: 8, border: '1px solid #334155', background: '#1e293b', color: '#e2e8f0' }} />%
        </span>
        <span style={{ fontSize: 12, color: '#64748b', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          matures
          <input type="date" value={cf.maturity} onChange={e => setCf({ ...cf, maturity: e.target.value })}
            style={{ fontSize: 12, padding: '4px 6px', borderRadius: 8, border: '1px solid #334155', background: '#1e293b', color: '#e2e8f0' }} />
        </span>
        <span style={{ fontSize: 12, color: '#64748b', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
          YTM
          <input type="number" step="0.01" value={cf.ytm} onChange={e => setCf({ ...cf, ytm: e.target.value })} placeholder="YTM"
            style={{ width: 64, fontSize: 12, padding: '5px 6px', borderRadius: 8, border: '1px solid #334155', background: '#1e293b', color: '#e2e8f0' }} />%
        </span>
        <button onClick={addCustom} disabled={!cfValid}
          style={{ fontSize: 12, fontWeight: 700, padding: '6px 12px', borderRadius: 8, cursor: cfValid ? 'pointer' : 'default',
            border: 'none', background: cfValid ? '#0ea5e9' : '#334155', color: '#fff', opacity: cfValid ? 1 : 0.6 }}>+ Add</button>
        <span style={{ fontSize: 11, color: '#64748b' }}>priced off the govie curve, keeping its spread</span>
      </div>

      <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 12, padding: 16 }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, color: '#e2e8f0' }}>
            <thead>
              <tr style={{ color: '#94a3b8' }}>
                <th style={{ padding: '8px 10px', textAlign: 'left' }}>Bond</th>
                <th style={cell()}>Coupon</th>
                <th style={cell()}>Maturity</th>
                <th style={cell()}>YTM</th>
                <th style={cell()}>Price</th>
                <th style={cell()}>Spread vs govt</th>
                <th style={cell()}>Mod. dur.</th>
                <th style={cell()}>Mod. dur. @ horizon</th>
                <th style={cell()}>Coupon return</th>
                <th style={cell()}>Rolls to</th>
                <th style={cell()}>Roll‑down return</th>
                <th style={cell()}>Total return</th>
                <th style={cell()}>Excess vs cash</th>
                <th style={cell()}>Breakeven</th>
                {hasActual && <th style={cell({ color: '#f1f5f9', borderLeft: '2px solid #334155' })}>Actual Δyield ({hLbl})</th>}
                {hasActual && <th style={cell({ color: '#f1f5f9' })}>Actual excess</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.label} style={{ borderTop: '1px solid #0f172a' }}>
                  <td style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 600, color: r.isCorp ? '#fb7185' : undefined }}>
                    {r.label}{r.isCorp && <span style={{ color: '#fda4af', fontSize: 11, fontWeight: 400 }}> · {r.custom ? 'custom' : 'corp'}</span>}
                    {r.custom && <button onClick={() => removeCustom(r.name)} title="Remove this custom bond"
                      style={{ background: 'none', border: 'none', color: '#fb7185', cursor: 'pointer', fontSize: 13, lineHeight: 1, padding: '0 0 0 6px' }}>×</button>}
                  </td>
                  <td style={cell({ color: '#94a3b8' })}>{r.c.toFixed(2)}%</td>
                  <td style={cell({ color: '#94a3b8' })}>{r.maturity}</td>
                  <td style={cell()}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
                      <input type="text" inputMode="decimal"
                        value={(r.name in ytmOvr) ? ytmOvr[r.name] : r.pulledYtm.toFixed(2)}
                        onChange={e => { const v = e.target.value; if (v === '' || /^[0-9]*\.?[0-9]*$/.test(v)) setOneYtm(r.name, v); }}
                        onFocus={e => e.target.select()}
                        title={r.ytmOvr ? `Your YTM — click and type to change it. Bloomberg/BVAL pull: ${r.pulledYtm.toFixed(2)}%` : 'Click and type your own YTM — it drives every column'}
                        style={{ width: 64, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700, fontSize: 13, cursor: 'text',
                          padding: '3px 6px', borderRadius: 6, background: r.ytmOvr ? '#3a2d0a' : '#0f172a',
                          border: `1px solid ${r.ytmOvr ? '#b45309' : '#475569'}`, color: r.ytmOvr ? '#fbbf24' : '#e2e8f0' }} />
                      <span style={{ color: '#64748b' }}>%</span>
                      {r.ytmOvr && <button onClick={() => clearYtm(r.name)} title={`Reset to Bloomberg ${r.pulledYtm.toFixed(2)}%`}
                        style={{ background: 'none', border: 'none', color: '#f59e0b', cursor: 'pointer', fontSize: 13, padding: 0, lineHeight: 1 }}>↺</button>}
                    </span>
                  </td>
                  <td style={cell({ color: '#94a3b8' })} title="All-in (dirty) price per 100 nominal — the capital the returns are based on">{r.price.toFixed(2)}</td>
                  <td style={cell({ fontWeight: 600, color: r.isCorp ? (r.spreadBps >= 0 ? '#fb7185' : '#4ade80') : '#475569' })}>
                    {r.isCorp ? `${r.spreadBps >= 0 ? '+' : ''}${Math.round(r.spreadBps)}` : '—'}
                  </td>
                  <td style={cell({ color: '#94a3b8' })}>{r.mod.toFixed(1)}</td>
                  <td style={cell({ color: '#64748b' })}>{r.modH.toFixed(1)}</td>
                  <td style={cell()}>{r.couponRet.toFixed(2)}%</td>
                  <td style={cell({ color: '#94a3b8' })}>{r.atMat
                    ? <span style={{ color: '#4ade80' }}>matures · par</span>
                    : <>{r.yRoll.toFixed(2)}% <span style={{ color: '#475569', fontSize: 11 }}>(−{Math.round(r.rollBps)}bp)</span></>}</td>
                  <td style={cell({ color: r.rollRet >= 0 ? '#2dd4bf' : '#f87171' })}>{r.rollRet >= 0 ? '+' : ''}{r.rollRet.toFixed(2)}%</td>
                  <td style={cell({ fontWeight: 700 })}>{r.totalRet.toFixed(2)}%</td>
                  <td style={cell({ color: r.excess >= 0 ? '#4ade80' : '#f87171' })}>{r.excess >= 0 ? '+' : ''}{r.excess.toFixed(2)}%</td>
                  <td style={cell({ fontWeight: 700, color: r.beBps == null ? '#4ade80' : r.beBps >= 20 ? '#4ade80' : r.beBps >= 0 ? '#fbbf24' : '#f87171' })}>
                    {r.beBps == null
                      ? <span title="Held to maturity, par is paid regardless of yields — no interest-rate risk, only default risk.">no rate risk</span>
                      : `${r.beBps >= 0 ? '+' : ''}${Math.round(r.beBps)}`}</td>
                  {hasActual && (
                    <td style={cell({ fontWeight: 600, borderLeft: '2px solid #334155', color: r.actChange == null ? '#475569' : r.actChange > 0 ? '#f87171' : '#4ade80' })}>
                      {r.actChange == null ? '—' : `${r.actChange > 0 ? '+' : ''}${Math.round(r.actChange)}`}
                    </td>
                  )}
                  {hasActual && (
                    <td style={cell({ fontWeight: 700, color: r.actExcess == null ? '#475569' : r.actExcess >= 0 ? '#4ade80' : '#f87171' })}>
                      {r.actExcess == null ? '—' : `${r.actExcess >= 0 ? '+' : ''}${r.actExcess.toFixed(2)}%`}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {htm && (
          <p style={{ fontSize: 12, color: '#bbf7d0', margin: '12px 2px 0', lineHeight: 1.5, background: '#052e16', border: '1px solid #166534', borderRadius: 8, padding: '8px 12px' }}>
            <strong style={{ color: '#4ade80' }}>⚓ Hold-to-maturity mode is ON.</strong> Each bond is held to its own maturity and redeemed at <strong>par</strong>, so <strong>there is no interest-rate risk</strong> — yields can do whatever they like and you still collect par plus coupons. The only risk left is default. “Rolls to” shows <em>matures · par</em>, “Breakeven” shows <em>no rate risk</em>, and <strong>Total return ≈ the bond's YTM</strong> over its life. <strong>Excess vs cash</strong> is your locked pickup over rolling the benchmark for the same period. Turn the button off to go back to a fixed selling horizon.
          </p>
        )}
        <p style={{ fontSize: 12, color: '#cbd5e1', margin: '12px 2px 0', lineHeight: 1.5 }}>
          <strong style={{ color: '#e2e8f0' }}>Total return</strong> (over your <strong>{hLbl}</strong> horizon) = <strong>Coupon return</strong> (coupon × {horizon} ÷ dirty price) + <strong style={{ color: '#2dd4bf' }}>Roll‑down return</strong> — reprice the bond {hLbl} on (now N−{horizon} years) at the <strong>Rolls to</strong> yield (the curve's (N−{horizon})‑year point) vs its price today: captures both the yield roll‑down and the pull‑to‑par.
          <strong style={{ color: '#4ade80' }}> Excess vs cash</strong> = total return − cash held for {hLbl} ({benchLabel} rolled, ≈{cashHz?.toFixed(2)}%): the price fall the bond can absorb before it loses.
          <strong style={{ color: '#fbbf24' }}> Breakeven</strong> (bps) = the extra yield rise (full reprice at the horizon) at which the bond's total return drops to the {hLbl} cash return. Bigger = more cushion; negative = already behind cash.
        </p>
        {hasActual && (
          <p style={{ fontSize: 12, color: '#cbd5e1', margin: '8px 2px 0', lineHeight: 1.5 }}>
            <strong style={{ color: '#f1f5f9' }}>Actual Δyield ({hLbl})</strong> = what the bond's yield actually did over the following {hLbl} (as at {futureRow.dateStr}); red = rose, green = fell.
            <strong style={{ color: '#f1f5f9' }}> Actual excess</strong> = the bond's realised total return over that period (repriced at the yield that actually occurred) minus the cash you'd have earned (≈{cashHz?.toFixed(2)}%). This is what would really have happened.
          </p>
        )}
        <p style={{ fontSize: 11, color: '#475569', margin: '8px 2px 0', lineHeight: 1.4 }}>
          <strong style={{ color: '#e2e8f0' }}>Spread vs govt</strong> (bps) = the bond's YTM minus the government curve at the same tenor — its credit spread (≈0 for govies, so shown as “—”).
          <strong style={{ color: '#fbbf24' }}> YTM is editable</strong>: for an illiquid line the Bloomberg/BVAL pull can sit well off the last trade — type your own and it drives every column (amber = your value; ↺ resets to the pull).
          {' '}Carry + roll model (no coupon reinvestment). Roll‑down and breakeven are both full semi‑annual reprices (no duration shortcut); roll‑to yield interpolated from the govie curve. Corporate/SOE bonds you add (shown in rose) roll down that same govie curve <strong>keeping their credit spread constant</strong> — so you see carry + govie roll‑down, not a spread tightening. Modified‑duration columns (today and at horizon) shown for reference. Cash held for the horizon = the benchmark rolled each year at the same rate. ACT/365, bonds maturing within the horizon excluded.
        </p>
      </div>

      <div style={{ marginTop: 16, background: '#1e293b', border: '1px solid #334155', borderRadius: 12, padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
          onClick={() => setShowCurve(v => !v)}>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9', margin: 0 }}>
            Government yield curve <span style={{ color: '#64748b', fontWeight: 400 }}>· {latest.dateStr}</span>
          </h3>
          <button onClick={(e) => { e.stopPropagation(); setShowCurve(v => !v); }}
            style={{ fontSize: 12, padding: '5px 12px', borderRadius: 8, cursor: 'pointer',
              border: '1px solid #334155', background: '#0f172a', color: '#94a3b8' }}>
            {showCurve ? '▾ Minimise' : '▸ Show'}
          </button>
        </div>
        {showCurve && (
          <div style={{ marginTop: 12 }}>
            <ResizableChart height={320}>
              <ComposedChart data={chartData} margin={{ top: 10, right: 24, bottom: 24, left: 8 }}>
                <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
                <XAxis type="number" dataKey="mat" domain={[0, 'dataMax']} tick={{ fill: '#94a3b8', fontSize: 11 }}
                  ticks={tenorTicks(chartData.length ? Math.max(...chartData.map(p => p.mat)) : 30)}
                  tickFormatter={fmtTenor} stroke="#475569"
                  label={{ value: 'Years to maturity', position: 'insideBottom', offset: -12, fill: '#64748b', fontSize: 12 }} />
                <YAxis domain={curveY.domain} ticks={curveY.ticks} interval={0} allowDecimals tick={{ fill: '#94a3b8', fontSize: 11 }}
                  tickFormatter={v => `${v.toFixed(2)}%`} stroke="#475569" width={52} />
                <Tooltip content={<CurveTooltip />} />
                {cashRate != null && cashRate > 0 && (
                  <ReferenceLine y={cashRate} stroke="#f59e0b" strokeDasharray="5 4"
                    label={{ value: `${benchLabel} ${cashRate.toFixed(2)}%`, position: 'insideTopRight', fill: '#f59e0b', fontSize: 11 }} />
                )}
                <Line type="monotone" dataKey="yGov" stroke="#38bdf8" strokeWidth={2} connectNulls
                  dot={{ r: 3, fill: '#38bdf8' }} activeDot={{ r: 5 }} isAnimationActive={false}>
                  <LabelList dataKey="label" content={(p) => <PointLabel {...p} fill="#7dd3fc" dy={-10} />} />
                </Line>
                {(corpCurvePoints.length > 0 || customCurvePoints.length > 0) && (
                  <Scatter dataKey="yCorp" fill="#fb7185" shape="diamond" isAnimationActive={false}>
                    <LabelList dataKey="label" content={(p) => <PointLabel {...p} fill="#fda4af" dy={16} />} />
                  </Scatter>
                )}
              </ComposedChart>
            </ResizableChart>
            <p style={{ fontSize: 11, color: '#475569', margin: '8px 2px 0' }}>
              Nominal govie YTMs by years to maturity (blue line), as at {latest.dateStr}.{corpCurvePoints.length > 0 ? ' Rose diamonds = corporate/SOE bonds you added — the gap above the line is their credit spread.' : ''}{cashRate > 0 ? ` Dashed line = ${benchLabel} (${cashRate?.toFixed(2)}%).` : ''} Drag the bottom‑right corner to resize.
            </p>
          </div>
        )}
      </div>

      {/* Breakeven vs actual — full history for one bond */}
      <div style={{ marginTop: 16, background: '#1e293b', border: '1px solid #334155', borderRadius: 12, padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <div style={{ cursor: 'pointer' }} onClick={() => setShowBeChart(v => !v)}>
            <h3 style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9', margin: 0 }}>
              Breakeven vs actual <span style={{ color: '#64748b', fontWeight: 400 }}>· history ({hLbl} horizon, {benchLabel})</span>
            </h3>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {showBeChart && (
              <select value={effectiveBeBond} onChange={e => setBeChartBond(e.target.value)}
                style={{ fontSize: 12, padding: '5px 8px', borderRadius: 8, border: '1px solid #334155', background: '#0f172a', color: '#e2e8f0', minWidth: 120 }}>
                {beCmOptions.length > 0 && (
                  <optgroup label="Constant maturity">
                    {beCmOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </optgroup>
                )}
                <optgroup label="Specific bonds">
                  {beBondOptions.map(o => <option key={o.name} value={o.name}>{o.label}{o.isCorp ? ' · corp' : ''}</option>)}
                </optgroup>
              </select>
            )}
            <button onClick={() => setShowBeChart(v => !v)}
              style={{ fontSize: 12, padding: '5px 12px', borderRadius: 8, cursor: 'pointer',
                border: '1px solid #334155', background: '#0f172a', color: '#94a3b8' }}>
              {showBeChart ? '▾ Minimise' : '▸ Show'}
            </button>
          </div>
        </div>
        {showBeChart && (
          <div style={{ marginTop: 12 }}>
            {beHistory.length === 0 ? (
              <p style={{ fontSize: 12, color: '#64748b' }}>Not enough history for {beBondLabel} at this horizon.</p>
            ) : (
              <>
                <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
                  <span style={{ fontSize: 12, color: '#fbbf24', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    Left axis (bps):
                    <input type="number" placeholder="min" value={beBpsMin} onChange={e => setBeBpsMin(e.target.value)}
                      style={{ width: 64, fontSize: 12, padding: '4px 6px', borderRadius: 8, border: '1px solid #334155', background: '#0f172a', color: '#e2e8f0' }} />
                    <span style={{ color: '#475569' }}>–</span>
                    <input type="number" placeholder="max" value={beBpsMax} onChange={e => setBeBpsMax(e.target.value)}
                      style={{ width: 64, fontSize: 12, padding: '4px 6px', borderRadius: 8, border: '1px solid #334155', background: '#0f172a', color: '#e2e8f0' }} />
                  </span>
                  <span style={{ fontSize: 12, color: '#4ade80', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    Right axis (%):
                    <input type="number" placeholder="min" value={bePctMin} onChange={e => setBePctMin(e.target.value)}
                      style={{ width: 64, fontSize: 12, padding: '4px 6px', borderRadius: 8, border: '1px solid #334155', background: '#0f172a', color: '#e2e8f0' }} />
                    <span style={{ color: '#475569' }}>–</span>
                    <input type="number" placeholder="max" value={bePctMax} onChange={e => setBePctMax(e.target.value)}
                      style={{ width: 64, fontSize: 12, padding: '4px 6px', borderRadius: 8, border: '1px solid #334155', background: '#0f172a', color: '#e2e8f0' }} />
                  </span>
                  <span style={{ fontSize: 11, color: '#64748b' }}>blank = auto</span>
                  {(beBpsMin || beBpsMax || bePctMin || bePctMax) && (
                    <button onClick={() => { setBeBpsMin(''); setBeBpsMax(''); setBePctMin(''); setBePctMax(''); }}
                      style={{ fontSize: 11, padding: '4px 10px', borderRadius: 8, cursor: 'pointer', border: '1px solid #334155', background: '#0f172a', color: '#94a3b8' }}>Reset axes</button>
                  )}
                </div>
                <ResizableChart height={360}>
                  <ComposedChart data={beHistory} margin={{ top: 10, right: 16, bottom: 24, left: 8 }}>
                    <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
                    <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']}
                      tickFormatter={fmtAxisDate} tick={{ fill: '#94a3b8', fontSize: 11 }} stroke="#475569" minTickGap={40} />
                    <YAxis yAxisId="bps" tick={{ fill: '#94a3b8', fontSize: 11 }} stroke="#475569" width={48}
                      allowDataOverflow domain={[beBpsMin !== '' ? +beBpsMin : 'auto', beBpsMax !== '' ? +beBpsMax : 'auto']}
                      tickFormatter={v => `${v}`}
                      label={{ value: 'bps', angle: -90, position: 'insideLeft', fill: '#64748b', fontSize: 11 }} />
                    <YAxis yAxisId="pct" orientation="right" tick={{ fill: '#4ade80', fontSize: 11 }} stroke="#4ade80" width={52}
                      allowDataOverflow domain={[bePctMin !== '' ? +bePctMin : 'auto', bePctMax !== '' ? +bePctMax : 'auto']}
                      tickFormatter={v => `${v.toFixed(1)}%`}
                      label={{ value: 'actual excess (%)', angle: 90, position: 'insideRight', fill: '#4ade80', fontSize: 11 }} />
                    <Tooltip content={<BeHistTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <ReferenceLine yAxisId="bps" y={0} stroke="#475569" />
                    <Line yAxisId="pct" type="monotone" dataKey="actExcess" name="Actual excess vs cash (%, right)"
                      stroke="#4ade80" strokeWidth={1.5} dot={false} connectNulls isAnimationActive={false} />
                    <Line yAxisId="bps" type="monotone" dataKey="breakeven" name="Breakeven cushion (bps)"
                      stroke="#fbbf24" strokeWidth={2} dot={false} isAnimationActive={false} />
                    <Line yAxisId="bps" type="monotone" dataKey="actChange" name="Actual Δyield (bps)"
                      stroke="#38bdf8" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
                  </ComposedChart>
                </ResizableChart>
                <p style={{ fontSize: 12, color: '#cbd5e1', margin: '10px 2px 0', lineHeight: 1.5 }}>
                  For <strong>{beBondLabel}</strong>, every day in our history: the <strong style={{ color: '#fbbf24' }}>breakeven cushion</strong> (how far its yield could rise over the next {hLbl} before underperforming {benchLabel}) vs the <strong style={{ color: '#38bdf8' }}>actual Δyield</strong> that then occurred. <strong>When blue sits below amber, the cushion held and the bond beat cash</strong> — quantified by <strong style={{ color: '#4ade80' }}>actual excess</strong> on the right axis (green above 0 = it won). Both yield lines are in bps; the two {`Δyield/excess`} lines stop ~{hLbl} before today (no future data yet). Uses the current <strong>horizon</strong> and <strong>benchmark</strong> buttons above, and each day's actual historical YTMs (not your manual overrides).
                </p>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
