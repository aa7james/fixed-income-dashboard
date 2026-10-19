/* Reads the Money Market Yields Tracker (Comparison sheet, Monthly Nominal column)
 * and upserts the values into Supabase (mm_yields), which the dashboard's Cash tab
 * reads as a reference. Pure Node — no npm deps, no Excel. Run by a scheduled task.
 *
 *   node push_mm_yields.js         # read the file and push to Supabase
 *   node push_mm_yields.js --dry   # read and print only, no push
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const XLSX = 'C:\\Users\\JamesWhitaker\\Aylett & Co\\Funds - Documents\\Fund Accounting Tools\\Money Market Yields\\Money Market Yields Tracker.xlsx';
const SHEET_NAME = 'Comparison';
const DRY = process.argv.includes('--dry');

// --- tiny .env reader (REACT_APP_SUPABASE_URL / _KEY from the dashboard) ---
function readEnv() {
  const txt = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
  const env = {};
  txt.split(/\r?\n/).forEach(l => { const m = l.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ''); });
  return env;
}

// --- minimal zip reader: extract named entries from a .xlsx (zip) ---
function unzipEntries(buf, wanted) {
  const out = {};
  // End of Central Directory
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 22 - 65536; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('bad xlsx (no EOCD)');
  let cdOff = buf.readUInt32LE(eocd + 16);
  const count = buf.readUInt16LE(eocd + 10);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(cdOff) !== 0x02014b50) break;
    const method = buf.readUInt16LE(cdOff + 10);
    const compSize = buf.readUInt32LE(cdOff + 20);
    const nameLen = buf.readUInt16LE(cdOff + 28);
    const extraLen = buf.readUInt16LE(cdOff + 30);
    const commentLen = buf.readUInt16LE(cdOff + 32);
    const localOff = buf.readUInt32LE(cdOff + 42);
    const name = buf.toString('utf8', cdOff + 46, cdOff + 46 + nameLen);
    if (wanted(name)) {
      const lNameLen = buf.readUInt16LE(localOff + 26);
      const lExtraLen = buf.readUInt16LE(localOff + 28);
      const dataStart = localOff + 30 + lNameLen + lExtraLen;
      const comp = buf.subarray(dataStart, dataStart + compSize);
      out[name] = method === 0 ? comp.toString('utf8') : zlib.inflateRawSync(comp).toString('utf8');
    }
    cdOff += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

const decode = s => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");

function parse(buf) {
  const files = unzipEntries(buf, n =>
    n === 'xl/workbook.xml' || n === 'xl/_rels/workbook.xml.rels' ||
    n === 'xl/sharedStrings.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(n));

  // shared strings
  const ss = [];
  (files['xl/sharedStrings.xml'] || '').replace(/<si>(.*?)<\/si>/gs, (_, b) => {
    ss.push([...b.matchAll(/<t[^>]*>(.*?)<\/t>/gs)].map(m => decode(m[1])).join('')); return _;
  });

  // map sheet name -> file
  const sheets = [...(files['xl/workbook.xml'] || '').matchAll(/<sheet [^>]*name="([^"]*)"[^>]*r:id="([^"]*)"/g)];
  const rel = {};
  [...(files['xl/_rels/workbook.xml.rels'] || '').matchAll(/<Relationship [^>]*Id="([^"]*)"[^>]*Target="([^"]*)"/g)]
    .forEach(m => rel[m[1]] = m[2]);
  const sh = sheets.find(m => m[1] === SHEET_NAME);
  if (!sh) throw new Error(`sheet "${SHEET_NAME}" not found`);
  const file = 'xl/' + rel[sh[2]].replace(/^\//, '');
  const xml = files[file];
  if (!xml) throw new Error('sheet xml missing');

  const cellVal = (attrs, body) => {
    const t = (attrs.match(/ t="([^"]*)"/) || [])[1] || '';
    const v = (body.match(/<v>(.*?)<\/v>/s) || [])[1];
    const isv = (body.match(/<is>.*?<t[^>]*>(.*?)<\/t>.*?<\/is>/s) || [])[1];
    if (t === 's' && v != null) return ss[+v] || '';
    if (t === 'inlineStr' && isv != null) return decode(isv);
    return v != null ? v : '';
  };
  const rows = {};
  [...xml.matchAll(/<c r="([A-Z]+)(\d+)"([^>]*?)(?:\/>|>(.*?)<\/c>)/gs)].forEach(m => {
    const col = m[1], row = +m[2];
    (rows[row] = rows[row] || {})[col] = cellVal(m[3] || '', m[4] || '');
  });
  return rows;
}

function serialToISO(serial) {
  const n = Number(serial);
  if (!isFinite(n) || n < 1) return null;
  const d = new Date(Date.UTC(1899, 11, 30) + n * 86400000);
  return d.toISOString().slice(0, 10);
}

(async () => {
  const buf = fs.readFileSync(XLSX);
  const rows = parse(buf);
  const funds = [];
  for (let r = 6; r <= 40; r++) {
    const o = rows[r]; if (!o) continue;
    const manco = (o.A || '').trim(), fund = (o.B || '').trim();
    if (!manco || !fund) continue;                 // stops at the notes rows (blank B)
    const mn = Number(o.I), eff = Number(o.D);
    funds.push({
      manco, fund_class: fund,
      monthly_nominal: isFinite(mn) ? +(mn * 100).toFixed(4) : null,
      eff_7day: isFinite(eff) ? +(eff * 100).toFixed(4) : null,
      rate_date: serialToISO(o.C),
      rank: isFinite(Number(o.G)) ? Number(o.G) : null,
      updated_at: new Date().toISOString(),
    });
  }
  if (!funds.length) throw new Error('no fund rows parsed');

  console.log(`Parsed ${funds.length} funds:`);
  funds.forEach(f => console.log(`  ${f.rank ?? '?'}. ${f.fund_class.padEnd(20)} nom ${f.monthly_nominal}%  7d-eff ${f.eff_7day}%  (${f.rate_date})`));

  if (DRY) { console.log('\n--dry: not pushing.'); return; }

  const env = readEnv();
  const url = env.REACT_APP_SUPABASE_URL, key = env.REACT_APP_SUPABASE_KEY;
  if (!url || !key) throw new Error('Supabase URL/key missing from .env');
  const res = await fetch(`${url}/rest/v1/mm_yields?on_conflict=fund_class`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(funds),
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  console.log(`\nPushed ${funds.length} funds to Supabase mm_yields. ${new Date().toLocaleString()}`);
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
