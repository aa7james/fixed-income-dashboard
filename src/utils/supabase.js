import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL;
const SUPABASE_KEY = process.env.REACT_APP_SUPABASE_KEY;

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Fetch all bond data from Supabase, paginated
export async function loadFromSupabase() {
  const chunkSize = 1000;
  let allRows = [];
  let from = 0;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase
      .from('bond_data')
      .select('date, data')
      .order('date', { ascending: true })
      .range(from, from + chunkSize - 1);

    if (error) throw new Error(error.message);
    allRows = [...allRows, ...data];
    hasMore = data.length === chunkSize;
    from += chunkSize;
  }

  return transformData(allRows);
}

function transformData(rows) {
  if (!rows || rows.length === 0) return { columns: [], dataRows: [] };

  // Collect all unique instrument names from all rows
  const nameSet = new Set();
  rows.forEach(row => Object.keys(row.data || {}).forEach(k => nameSet.add(k)));

  const columns = Array.from(nameSet).map((name, index) => ({
    index,
    name,
    maturity: '',
    coupon: '',
    ticker: '',
  }));

  const dataRows = rows.map(row => {
    // Parse ISO date without timezone shifting
    const [year, month, day] = row.date.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    const dateStr = `${month}/${day}/${year}`;
    return { date, dateStr, ...(row.data || {}) };
  });

  return { columns, dataRows };
}
