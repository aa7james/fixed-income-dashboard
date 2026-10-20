// Office Script: reads the Comparison sheet of the Money Market Yields Tracker
// and returns the four funds' yields for Power Automate to POST to Supabase.
// Create it in Excel: Automate tab -> New Script -> paste this -> Save (name it
// "Export MM Yields for Supabase").

interface FundYield {
  manco: string;
  fund_class: string;
  monthly_nominal: number | null;
  eff_7day: number | null;
  rate_date: string | null;
  rank: number | null;
  updated_at: string;
}

function serialToISO(serial: number): string | null {
  if (!isFinite(serial) || serial < 1) return null;
  const ms = Date.UTC(1899, 11, 30) + serial * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}

function pct(v: number): number | null {
  return isFinite(v) ? Math.round(v * 100 * 10000) / 10000 : null;
}

function main(workbook: ExcelScript.Workbook): FundYield[] {
  const sheet = workbook.getWorksheet("Comparison");
  const vals = sheet.getUsedRange().getValues();
  const now = new Date().toISOString();
  const out: FundYield[] = [];
  // Header is row 5 (index 4); data starts row 6 (index 5).
  for (let r = 5; r < vals.length; r++) {
    const manco = (vals[r][0] ?? "").toString().trim();   // A
    const fund = (vals[r][1] ?? "").toString().trim();    // B
    if (!manco || !fund) continue;                        // stop at the notes rows
    out.push({
      manco,
      fund_class: fund,
      monthly_nominal: pct(Number(vals[r][8])),            // I  Monthly Nominal
      eff_7day: pct(Number(vals[r][3])),                   // D  7-Day Effective (NACA)
      rate_date: serialToISO(Number(vals[r][2])),          // C  Latest Rate Date
      rank: isFinite(Number(vals[r][6])) ? Number(vals[r][6]) : null, // G Rank
      updated_at: now,
    });
  }
  return out;
}
