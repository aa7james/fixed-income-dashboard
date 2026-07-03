import Papa from 'papaparse';

// The CSV has 5 header rows: Instrument, Maturity, Coupon, Ticker, Date/field-type
// Data rows start from row 6 onward (index 5)

export async function loadCSV(url) {
  const response = await fetch(url);
  const text = await response.text();
  return parseBloombergCSV(text);
}

export function parseBloombergCSV(text) {
  const result = Papa.parse(text, { skipEmptyLines: false });
  const rows = result.data;

  // Extract header rows
  const instrumentRow = rows[0] || [];
  const maturityRow   = rows[1] || [];
  const couponRow     = rows[2] || [];
  const tickerRow     = rows[3] || [];
  // rows[4] is the field-type row (PX_Last etc.) — we skip it

  // Build column metadata (skip col 0 which is "Instrument"/"Date")
  const columns = [];
  for (let c = 1; c < instrumentRow.length; c++) {
    const name = instrumentRow[c]?.trim();
    if (!name) continue;
    columns.push({
      index: c,
      name,
      maturity: maturityRow[c]?.trim() || '',
      coupon: couponRow[c]?.trim() || '',
      ticker: tickerRow[c]?.trim() || '',
    });
  }

  // Parse data rows (from row 5 onward)
  const dataRows = [];
  for (let r = 5; r < rows.length; r++) {
    const row = rows[r];
    if (!row || !row[0] || !row[0].trim()) continue;

    const dateStr = row[0].trim();
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) continue;

    const values = {};
    for (const col of columns) {
      const raw = row[col.index]?.trim();
      const val = raw === '#N/A N/A' || raw === '' || raw == null ? null : parseFloat(raw);
      values[col.name] = isNaN(val) ? null : val;
    }

    dataRows.push({ date, dateStr, ...values });
  }

  dataRows.sort((a, b) => a.date - b.date);

  return { columns, dataRows };
}

// Group columns into categories based on name patterns
export function categoriseColumns(columns) {
  const groups = {
    'Policy Rates':          [],
    'Swaps':                 [],
    'Government Bonds':      [],
    'Inflation Linked':      [],
    'Fixed Rate NCDs':       [],
    'Variable Rate NCDs':    [],
    'T-Bills':               [],
    'JIBAR Money Market':    [],
    'JIBAR FRAs':            [],
    'Zaronia Money Market':  [],
    'Zaronia FRAs':          [],
    'SOE / Corporate Bonds': [],
    'Call Accounts':         [],
    'International':         [],
    'Other':                 [],
  };

  for (const col of columns) {
    const n = col.name;

    // Policy / benchmark rates
    if (/^(Repo Rate|Prime Interest rate)$/i.test(n)) {
      groups['Policy Rates'].push(col);

    // JIBAR rates (standalone JIBAR, no FRA)
    } else if (/JIBAR/i.test(n) && !/FRA/i.test(n)) {
      groups['JIBAR Money Market'].push(col);

    // Zaronia standalone rate
    } else if (/^Zaronia$/i.test(n)) {
      groups['Zaronia Money Market'].push(col);

    // Swaps
    } else if (/SWAP/i.test(n)) {
      groups['Swaps'].push(col);

    // T-Bills
    } else if (/T-Bill/i.test(n)) {
      groups['T-Bills'].push(col);

    // Fixed Rate NCDs (named "Fixed Rate NCD" or "Fixed Rate NCD2")
    } else if (/Fixed Rate NCD/i.test(n) && !/Variable/i.test(n)) {
      groups['Fixed Rate NCDs'].push(col);

    // Variable Rate NCDs — both JIBAR-spread and Zaronia-spread
    } else if (/Variable Rate NCD/i.test(n)) {
      groups['Variable Rate NCDs'].push(col);

    // JIBAR FRAs — "FRA … - JIBAR" or legacy "FRA 3X6" without a suffix
    } else if (/FRA/i.test(n) && /JIBAR/i.test(n)) {
      groups['JIBAR FRAs'].push(col);
    } else if (/FRA/i.test(n) && !/Zaronia/i.test(n)) {
      groups['JIBAR FRAs'].push(col);

    // Zaronia FRAs
    } else if (/FRA/i.test(n) && /Zaronia/i.test(n)) {
      groups['Zaronia FRAs'].push(col);

    // Zaronia NCD spreads that slipped through
    } else if (/Zaronia/i.test(n)) {
      groups['Zaronia Money Market'].push(col);

    // Inflation-linked bonds
    } else if (/^I\d{4}|Inflation Linked/i.test(n)) {
      groups['Inflation Linked'].push(col);

    // Nominal government bonds (R-series, generic SA)
    } else if (/^R\d{3,4}( Bond)?$|SA Generic.*Nominal/i.test(n)) {
      groups['Government Bonds'].push(col);

    // SOE / Corporate bonds (ES, HWAY, TN, FRX, SOAF)
    } else if (/^(ES\d+|HWAY\d+|TN\d+|FRX\d+|SOAF|T 0)/i.test(n)) {
      groups['SOE / Corporate Bonds'].push(col);

    // Call accounts / money market funds
    } else if (/Standard Bank|Investec|Nedbank|China Cons|^RMB$|Average Call|Average Money|CMMB|NIMMC|PRMFB|MMFCA/i.test(n)) {
      groups['Call Accounts'].push(col);

    // International
    } else if (/US |EU |USD ZAR|CPI|Generic 10|Generic 20|Generic 30|UST|EUT/i.test(n)) {
      groups['International'].push(col);

    } else {
      groups['Other'].push(col);
    }
  }

  // Remove empty groups
  return Object.fromEntries(Object.entries(groups).filter(([, cols]) => cols.length > 0));
}
