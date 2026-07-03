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
    'Money Market': [],
    'Swaps': [],
    'Government Bonds': [],
    'Inflation Linked': [],
    'NCDs': [],
    'T-Bills': [],
    'FRAs': [],
    'International': [],
    'Policy Rates': [],
    'Other': [],
  };

  for (const col of columns) {
    const n = col.name;
    if (/JIBAR|Repo Rate|Prime|ZARONIA|Zaronia/i.test(n)) groups['Policy Rates'].push(col);
    else if (/SWAP/i.test(n)) groups['Swaps'].push(col);
    else if (/T-Bill/i.test(n)) groups['T-Bills'].push(col);
    else if (/NCD/i.test(n)) groups['NCDs'].push(col);
    else if (/FRA/i.test(n)) groups['FRAs'].push(col);
    else if (/I\d{4}|Inflation/i.test(n) || /Inflation Linked/i.test(n)) groups['Inflation Linked'].push(col);
    else if (/R\d{3,4}|Bond|Generic.*Nominal/i.test(n)) groups['Government Bonds'].push(col);
    else if (/US |EU |USD ZAR|CPI/i.test(n)) groups['International'].push(col);
    else groups['Other'].push(col);
  }

  return groups;
}
