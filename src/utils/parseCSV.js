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
    'JIBAR Money Market':    [],
    'Zaronia Money Market':  [],
    'Swaps':                 [],
    'T-Bills':               [],
    'Fixed Rate NCDs':       [],
    'Variable Rate NCDs':    [],
    'FRAs':                  [],
    'Government Bonds':      [],
    'Inflation Linked':      [],
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

    // JIBAR rates (standalone, no FRA) — keep these
    } else if (/JIBAR/i.test(n) && !/FRA/i.test(n) && !/Variable/i.test(n)) {
      groups['JIBAR Money Market'].push(col);

    // Skip JIBAR FRAs entirely
    } else if (/FRA/i.test(n) && /JIBAR/i.test(n)) {
      // dropped

    // Skip legacy FRAs without Zaronia suffix (also JIBAR-based)
    } else if (/FRA/i.test(n) && !/Zaronia/i.test(n)) {
      // dropped

    // Zaronia FRAs → FRAs section
    } else if (/FRA/i.test(n) && /Zaronia/i.test(n)) {
      groups['FRAs'].push(col);

    // Zaronia standalone rate
    } else if (/^Zaronia$/i.test(n)) {
      groups['Zaronia Money Market'].push(col);

    // Zaronia Variable Rate NCDs → Variable Rate NCDs
    } else if (/Variable Rate NCD/i.test(n) && /Zaronia/i.test(n)) {
      groups['Variable Rate NCDs'].push(col);

    // Skip JIBAR Variable Rate NCDs
    } else if (/Variable Rate NCD/i.test(n) && !/Zaronia/i.test(n)) {
      // dropped

    // Swaps
    } else if (/SWAP/i.test(n)) {
      groups['Swaps'].push(col);

    // T-Bills
    } else if (/T-Bill/i.test(n)) {
      groups['T-Bills'].push(col);

    // Fixed Rate NCDs
    } else if (/Fixed Rate NCD/i.test(n) && !/Variable/i.test(n)) {
      groups['Fixed Rate NCDs'].push(col);

    // Inflation-linked bonds (I-series and SA Generic ILBs)
    } else if (/^I\d{4}( Bond)?$/i.test(n) || /Inflation Linked/i.test(n)) {
      groups['Inflation Linked'].push(col);

    // Inflation-linked R-series (R210, R202, R197, R212)
    } else if (/^(R210|R202|R197|R212)( Bond)?$/i.test(n)) {
      groups['Inflation Linked'].push(col);

    // Nominal government bonds — R-series including short codes like R186, R187, R188
    } else if (/^R\d{3,4}( Bond)?$|SA Generic.*Nominal/i.test(n)) {
      groups['Government Bonds'].push(col);

    // SOE / Corporate bonds
    } else if (/^(ES\d+|HWAY\d+|TN\d+|FRX\d+|SOAF|T 0)/i.test(n)) {
      groups['SOE / Corporate Bonds'].push(col);

    // Call accounts / money market funds
    } else if (/Standard Bank|Investec|Nedbank|China Cons|^RMB$|Average Call|Average Money|CMMB|NIMMC|PRMFB|MMFCA/i.test(n)) {
      groups['Call Accounts'].push(col);

    // International
    } else if (/US |EU |USD ZAR|CPI|SA Generic 10|SA Generic 20|SA Generic 30|UST|EUT/i.test(n)) {
      groups['International'].push(col);

    } else {
      groups['Other'].push(col);
    }
  }

  // Remove empty groups
  return Object.fromEntries(Object.entries(groups).filter(([, cols]) => cols.length > 0));
}

// Categorise columns using the instruments table from Supabase
export function categoriseFromInstruments(columns, instruments) {
  const lookup = {};
  instruments.forEach(inst => { lookup[inst.name] = inst; });

  const groups = {};
  for (const col of columns) {
    const inst = lookup[col.name];
    const category = inst ? inst.category : 'Other';
    if (!groups[category]) groups[category] = [];
    groups[category].push({
      ...col,
      display_label: inst?.display_label || col.name,
      maturity_date: inst?.maturity_date || null,
      coupon: inst?.coupon || null,
      bloomberg_ticker: inst?.bloomberg_ticker || null,
    });
  }

  return Object.fromEntries(Object.entries(groups).filter(([, cols]) => cols.length > 0));
}
