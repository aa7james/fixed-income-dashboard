import React, { useMemo, useState } from 'react';

// Per-preference-share reference data.
//  pctPrime = dividend rate as a % of prime (forward run-rate basis); null where unknown
//  verified = confirmed from the terms of issue / derived from declarations
//  fixedPct = fixed dividend rate on par (for the non-prime-linked fixed prefs)
const PREF_META = {
  // Prime-linked (Bloomberg gives no dividend for these — rate from James's workbook).
  NTCP:   { issuer: 'Netcare',               pctPrime: 82.5, verified: true },
  SBPP:   { issuer: 'Standard Bank',         pctPrime: 75.0, note: 'variable' },
  INPR:   { issuer: 'Investec Ltd',          pctPrime: 70.0, note: 'variable' },
  CPIP:   { issuer: 'Capitec',               pctPrime: 75.0, note: 'variable' },
  DSBP:   { issuer: 'Discovery',             pctPrime: 100,  verified: true },
  SBKP:   { issuer: 'Standard Bank 6.5%',    pctPrime: null, note: 'fixed 6.5%' },
  AFEP:   { issuer: 'AECI',                  pctPrime: null, note: 'fixed 5.5%' },
  // Everything else: use Bloomberg's indicated (forward) dividend yield.
  // (Issuer names below are Bloomberg's own security names.)
  GNDP:   { issuer: 'Grindrod',              pctPrime: null },
  INPPR:  { issuer: 'Investec Ltd',          pctPrime: null },
  INPP:   { issuer: 'Investec plc',          pctPrime: null },
  FSRP:   { issuer: 'FirstRand',             pctPrime: null },
  INPMAU: { issuer: 'Investec Bank Mauritius', pctPrime: null },
  SUMIRF: { issuer: 'Summit Issuer RF',      pctPrime: null },
  IBEX:   { issuer: 'Ibex (ex-Steinhoff)',   pctPrime: null },
  CATP:   { issuer: 'Caxton & CTP',          pctPrime: null },
  BAWP:   { issuer: 'Barloworld',            pctPrime: null },
  GRSP:   { issuer: '(unconfirmed)',         pctPrime: null },
  IMRP11: { issuer: 'Investec Bank Mauritius', pctPrime: null },
  IMRP14: { issuer: 'Investec Bank Mauritius', pctPrime: null },
  // Legacy low-par, thinly-traded fixed-rate prefs (tiny issues). Yields are real
  // arithmetic but on micro/illiquid shares — not comparable to the bank prefs above.
  TFGP:   { issuer: 'Foschini 6.5%',         pctPrime: null, note: 'thinly traded' },
  NPKP:   { issuer: 'Nampak 6%',             pctPrime: null, note: 'thinly traded' },
  NPP1:   { issuer: 'Nampak 6.5%',           pctPrime: null, note: 'thinly traded' },
  AOVP:   { issuer: 'African & Overseas 6%', pctPrime: null, note: 'thinly traded' },
  RTOP:   { issuer: 'Rex Trueform',          pctPrime: null, note: 'thinly traded' },
};

const DWT = 0.20;
const PRIME_KEY = 'Prime Interest rate';
const PAR = 100; // Rand

const num = (v) => (v != null && isFinite(Number(v)) ? Number(v) : null);
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
      .filter(i => i.category === 'Preference Shares' && !/ /.test(i.name))
      .map(i => i.name);

    const out = codes.map(code => {
      const meta = PREF_META[code] || { issuer: code };
      const priceC = num(latest[code]);                 // cents
      const indYld = num(latest[`${code} INDY`]);        // Bloomberg indicated (forward) yield, %
      const lastDivC = num(latest[`${code} LDIV`]);      // last declared dividend, cents
      const priceR = toR(priceC);

      let fwdYield = null, fwdDivR = null, basis = null;
      if (meta.pctPrime != null && prime != null && priceR > 0) {
        fwdDivR = (meta.pctPrime / 100) * (prime / 100) * PAR;  // R/yr at current prime
        fwdYield = (fwdDivR / priceR) * 100;
        basis = 'prime';
      } else if (meta.fixedPct != null && priceR > 0) {
        fwdDivR = (meta.fixedPct / 100) * PAR;
        fwdYield = (fwdDivR / priceR) * 100;
        basis = 'fixed';
      } else if (indYld != null && indYld > 0) {
        fwdYield = indYld;
        fwdDivR = priceR != null ? (indYld / 100) * priceR : null;
        basis = 'indicated';
      }
      // Guard against par/unit mismatches producing absurd yields.
      if (fwdYield != null && (fwdYield <= 0 || fwdYield > 40)) { fwdYield = null; fwdDivR = null; basis = null; }
      return {
        code, issuer: meta.issuer || code, note: meta.note || null,
        pctPrime: meta.pctPrime ?? null, verified: !!meta.verified,
        priceR, lastDivR: toR(lastDivC), fwdDivR, fwdYield,
        fwdYieldNet: fwdYield != null ? fwdYield * (1 - DWT) : null,
        basis,
      };
    });

    const cmp = {
      yield: (a, b) => (b.fwdYield ?? -1) - (a.fwdYield ?? -1),
      code: (a, b) => a.code.localeCompare(b.code),
      issuer: (a, b) => a.issuer.localeCompare(b.issuer),
    };
    return out.sort(cmp[sortKey] || cmp.yield);
  }, [latest, instruments, prime, sortKey]);

  const live = rows.filter(r => r.fwdYield != null);
  const avg = live.length ? live.reduce((a, r) => a + r.fwdYield, 0) / live.length : null;

  if (!latest) return <div style={{ color: '#64748b', fontSize: 13, padding: 16 }}>Loading…</div>;

  const SortBtn = ({ k, children }) => (
    <button onClick={() => setSortKey(k)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: sortKey === k ? '#e2e8f0' : '#94a3b8', font: 'inherit', fontWeight: 700 }}>
      {children}{sortKey === k ? ' ↓' : ''}
    </button>
  );

  const basisLabel = { prime: '% of prime', fixed: 'fixed rate', indicated: 'Bloomberg indicated' };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 4 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: '#f1f5f9', margin: 0 }}>Preference Shares</h2>
          <p style={{ fontSize: 12, color: '#64748b', margin: '2px 0 0' }}>
            Forward dividend yield — what you earn at today’s prime{latest ? ` · as at ${latest.dateStr}` : ''}
          </p>
        </div>
        <div style={{ fontSize: 12, color: '#94a3b8', textAlign: 'right' }}>
          <div>Prime <strong style={{ color: '#facc15' }}>{prime != null ? `${prime.toFixed(2)}%` : '—'}</strong></div>
          {avg != null && <div><span style={{ color: '#38bdf8', fontWeight: 700 }}>{live.length}</span> priced · avg fwd <strong style={{ color: '#e2e8f0' }}>{avg.toFixed(2)}%</strong></div>}
        </div>
      </div>

      <div style={{ ...card, overflowX: 'auto', marginTop: 10 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 820 }}>
          <thead>
            <tr>
              <th style={{ ...th, textAlign: 'left' }}><SortBtn k="code">Code</SortBtn></th>
              <th style={{ ...th, textAlign: 'left' }}><SortBtn k="issuer">Issuer</SortBtn></th>
              <th style={{ ...th, textAlign: 'right' }}>% of prime</th>
              <th style={{ ...th, textAlign: 'right' }}>Price</th>
              <th style={{ ...th, textAlign: 'right' }}>Last dividend</th>
              <th style={{ ...th, textAlign: 'right' }}>Expected div/yr</th>
              <th style={{ ...th, textAlign: 'right' }}><SortBtn k="yield">Forward yield</SortBtn></th>
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
                  {r.pctPrime != null && !r.verified && <span title="from the workbook — not yet re-verified by me" style={{ color: '#64748b' }}> *</span>}
                </td>
                <td style={td({ textAlign: 'right', color: '#94a3b8' })}>{fmtR(r.priceR)}</td>
                <td style={td({ textAlign: 'right', color: '#94a3b8' })}>{fmtR(r.lastDivR)}</td>
                <td style={td({ textAlign: 'right', color: '#e2e8f0', fontWeight: 600 })}>{fmtR(r.fwdDivR)}</td>
                <td style={td({ textAlign: 'right', fontWeight: 700, color: r.fwdYield != null ? '#4ade80' : '#475569' })}>{fmtPct(r.fwdYield)}</td>
                <td style={td({ textAlign: 'right', color: '#94a3b8' })}>{fmtPct(r.fwdYieldNet)}</td>
                <td style={td({ color: '#64748b', fontSize: 11 })}>{r.basis ? basisLabel[r.basis] : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p style={{ fontSize: 11, color: '#64748b', marginTop: 10, lineHeight: 1.5 }}>
        <strong style={{ color: '#94a3b8' }}>Forward, not trailing.</strong> “Expected div/yr” is the dividend you’d receive over the next year at today’s prime, and
        “Forward yield” is that ÷ price. <strong style={{ color: '#94a3b8' }}>% of prime</strong> basis: dividend = (% of prime × live prime) on R100 par — the current run-rate.
        <strong style={{ color: '#94a3b8' }}> Bloomberg indicated</strong> basis: Bloomberg’s indicated (forward) dividend annualised from the latest payment — used where the % of prime isn’t confirmed.
        A <span style={{ color: '#64748b' }}>*</span> marks a % not yet re-verified by me (Netcare and Discovery are verified).
        Prices are Bloomberg PX_LAST; “Last dividend” is the most recent declared payment per share. Yields are gross, with the net column after 20% dividends tax.
      </p>
    </div>
  );
}
