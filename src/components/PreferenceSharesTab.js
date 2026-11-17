import React, { useMemo, useState } from 'react';

// Per-preference-share reference data.
//  pctPrime  = dividend rate as a % of prime (null if not prime-linked / unknown)
//  verified  = true where confirmed from the terms of issue / derived from declarations
//  par       = nominal value in Rand the % of prime applies to (default 100)
const PREF_META = {
  // Fixed-income / financial preferreds (prime-linked, R100 par)
  // Prime-linked (Bloomberg returns no dividend for these — use % of prime). Rates from
  // James's Bloomberg pref-yield workbook. NTCP verified against the declaration maths.
  NTCP:   { issuer: 'Netcare',               pctPrime: 82.5, verified: true },
  SBPP:   { issuer: 'Standard Bank',         pctPrime: 75.0, note: 'variable' },
  INPR:   { issuer: 'Investec Ltd',          pctPrime: 70.0, note: 'variable' },
  CPIP:   { issuer: 'Capitec',               pctPrime: 75.0, note: 'variable' },
  SBKP:   { issuer: 'Standard Bank 6.5%',    pctPrime: null, note: 'fixed 6.5%' },
  // Equity-classified (Bloomberg returns an actual dividend — use Div12M ÷ price).
  DSBP:   { issuer: 'Discovery',             pctPrime: null },
  GNDP:   { issuer: 'Grindrod',              pctPrime: null },
  INPPR:  { issuer: 'Investec plc',          pctPrime: null },
  FSRP:   { issuer: 'FirstRand',             pctPrime: null },
  AFEP:   { issuer: 'AECI',                  pctPrime: null },
  INPP:   { issuer: 'Investec',              pctPrime: null },
  INPMAU: { issuer: 'Investec Bank Mauritius', pctPrime: null },
  SUMIRF: { issuer: 'Summit Issuer RF',      pctPrime: null },
  IBEX:   { issuer: 'Ibex (ex-Steinhoff)',   pctPrime: null },
  // Industrial preferreds (basis not confirmed — fall back to live dividend)
  CATP:   { issuer: 'Caxton & CTP',          pctPrime: null },
  TFGP:   { issuer: 'The Foschini Group',    pctPrime: null },
  NPKP:   { issuer: 'Nampak',                pctPrime: null },
  NPP1:   { issuer: '(unconfirmed)',         pctPrime: null },
  AOVP:   { issuer: 'Afrox',                 pctPrime: null },
  BAWP:   { issuer: 'Barloworld',            pctPrime: null },
  GRSP:   { issuer: '(unconfirmed)',         pctPrime: null },
  RTOP:   { issuer: '(unconfirmed)',         pctPrime: null },
  IMRP11: { issuer: 'Imperial (redeemable)', pctPrime: null },
  IMRP14: { issuer: 'Imperial (redeemable)', pctPrime: null },
};

const DWT = 0.20;            // dividends withholding tax for individuals
const PRIME_KEY = 'Prime Interest rate';

const num = (v) => (v != null && isFinite(Number(v)) ? Number(v) : null);
// Bloomberg quotes JSE prices in cents; show Rand.
const toR = (cents) => (cents == null ? null : cents / 100);
const fmtR = (r) => (r == null ? '—' : `R${r.toFixed(2)}`);
const fmtPct = (v) => (v == null ? '—' : `${v.toFixed(2)}%`);

const card = { background: '#0f172a', border: '1px solid #1e293b', borderRadius: 10 };
const th = { padding: '8px 10px', fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.3, borderBottom: '1px solid #334155', whiteSpace: 'nowrap' };
const td = (extra = {}) => ({ padding: '8px 10px', fontSize: 13, color: '#e2e8f0', borderBottom: '1px solid #1e293b', fontVariantNumeric: 'tabular-nums', ...extra });

export default function PreferenceSharesTab({ data, instruments }) {
  const [sortKey, setSortKey] = useState('yield');
  const latest = data?.dataRows?.[data.dataRows.length - 1];
  const prime = latest ? num(latest[PRIME_KEY]) : null;

  const rows = useMemo(() => {
    if (!latest) return [];
    const codes = (instruments || [])
      .filter(i => i.category === 'Preference Shares' && !/ DIV$/.test(i.name))
      .map(i => i.name);

    const out = codes.map(code => {
      const meta = PREF_META[code] || { issuer: code };
      const priceC = num(latest[code]);           // cents
      const divC = num(latest[`${code} DIV`]);     // trailing 12m dividend, cents
      const par = meta.par || 100;

      let yieldGross = null, basis = null, annualDivR = null;
      if (meta.pctPrime != null && prime != null && priceC > 0) {
        // Forward run-rate: rate = pctPrime% of prime applied to par.
        annualDivR = (meta.pctPrime / 100) * (prime / 100) * par;     // Rand/yr
        yieldGross = (annualDivR / toR(priceC)) * 100;
        basis = 'prime';
      } else if (priceC > 0 && divC > 0) {
        annualDivR = toR(divC);
        yieldGross = (divC / priceC) * 100;
        basis = 'actual';
      }
      return {
        code, issuer: meta.issuer || code, note: meta.note || null,
        pctPrime: meta.pctPrime ?? null, verified: !!meta.verified,
        priceR: toR(priceC), annualDivR, yieldGross,
        yieldNet: yieldGross != null ? yieldGross * (1 - DWT) : null,
        basis,
      };
    });

    const cmp = {
      yield: (a, b) => (b.yieldGross ?? -1) - (a.yieldGross ?? -1),
      code: (a, b) => a.code.localeCompare(b.code),
      issuer: (a, b) => a.issuer.localeCompare(b.issuer),
    };
    return out.sort(cmp[sortKey] || cmp.yield);
  }, [latest, instruments, prime, sortKey]);

  const live = rows.filter(r => r.yieldGross != null);
  const avg = live.length ? live.reduce((a, r) => a + r.yieldGross, 0) / live.length : null;

  if (!latest) return <div style={{ color: '#64748b', fontSize: 13, padding: 16 }}>Loading…</div>;

  const SortBtn = ({ k, children }) => (
    <button onClick={() => setSortKey(k)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: sortKey === k ? '#e2e8f0' : '#94a3b8', font: 'inherit', fontWeight: 700 }}>
      {children}{sortKey === k ? ' ↓' : ''}
    </button>
  );

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 4 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: '#f1f5f9', margin: 0 }}>Preference Shares</h2>
          <p style={{ fontSize: 12, color: '#64748b', margin: '2px 0 0' }}>
            Prime-linked yield = (% of prime × prime) ÷ price{latest ? ` · as at ${latest.dateStr}` : ''}
          </p>
        </div>
        <div style={{ fontSize: 12, color: '#94a3b8', textAlign: 'right' }}>
          <div>Prime <strong style={{ color: '#facc15' }}>{prime != null ? `${prime.toFixed(2)}%` : '—'}</strong></div>
          {avg != null && <div><span style={{ color: '#38bdf8', fontWeight: 700 }}>{live.length}</span> priced · avg gross <strong style={{ color: '#e2e8f0' }}>{avg.toFixed(2)}%</strong></div>}
        </div>
      </div>

      <div style={{ ...card, overflowX: 'auto', marginTop: 10 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
          <thead>
            <tr>
              <th style={{ ...th, textAlign: 'left' }}><SortBtn k="code">Code</SortBtn></th>
              <th style={{ ...th, textAlign: 'left' }}><SortBtn k="issuer">Issuer</SortBtn></th>
              <th style={{ ...th, textAlign: 'right' }}>% of prime</th>
              <th style={{ ...th, textAlign: 'right' }}>Price</th>
              <th style={{ ...th, textAlign: 'right' }}>Annual div</th>
              <th style={{ ...th, textAlign: 'right' }}><SortBtn k="yield">Yield (gross)</SortBtn></th>
              <th style={{ ...th, textAlign: 'right' }}>Net (20% DWT)</th>
              <th style={{ ...th, textAlign: 'left' }}>Basis</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.code}>
                <td style={td({ fontWeight: 700, color: '#38bdf8' })}>{r.code}</td>
                <td style={td({ color: '#cbd5e1' })}>{r.issuer}{r.note && <span style={{ color: '#64748b', fontSize: 11 }}> · {r.note}</span>}</td>
                <td style={td({ textAlign: 'right', color: r.pctPrime != null ? '#facc15' : '#475569' })}>
                  {r.pctPrime != null ? `${r.pctPrime}%` : '—'}
                  {r.pctPrime != null && !r.verified && <span title="from published terms — not yet re-verified" style={{ color: '#64748b' }}> *</span>}
                </td>
                <td style={td({ textAlign: 'right', color: '#94a3b8' })}>{fmtR(r.priceR)}</td>
                <td style={td({ textAlign: 'right', color: '#94a3b8' })}>{fmtR(r.annualDivR)}</td>
                <td style={td({ textAlign: 'right', fontWeight: 700, color: r.yieldGross != null ? '#4ade80' : '#475569' })}>{fmtPct(r.yieldGross)}</td>
                <td style={td({ textAlign: 'right', color: '#94a3b8' })}>{fmtPct(r.yieldNet)}</td>
                <td style={td({ color: '#64748b', fontSize: 11 })}>
                  {r.basis === 'prime' ? '% of prime' : r.basis === 'actual' ? 'actual div (trailing)' : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p style={{ fontSize: 11, color: '#64748b', marginTop: 10, lineHeight: 1.5 }}>
        <strong style={{ color: '#94a3b8' }}>% of prime</strong> basis (preferred): forward dividend = (% of prime × live prime) on R100 par, ÷ live price — the current run-rate yield, immune to special dividends.
        A <span style={{ color: '#64748b' }}>*</span> marks a % taken from published pref-share terms and not yet re-verified by me (Netcare and Discovery are verified).
        <strong style={{ color: '#94a3b8' }}> Actual div</strong> basis: trailing 12-month dividend ÷ price, used where the % of prime isn’t confirmed — can be distorted by special or partial-year payments.
        Prices are Bloomberg PX_LAST (cents→Rand); yields are gross, with the net column after 20% dividends tax.
      </p>
    </div>
  );
}
