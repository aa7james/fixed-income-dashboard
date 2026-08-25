// Vercel serverless function: aggregates macro news via Google News RSS.
// No API key required. Grouped by topic: Debt, FX, Commodities, Politics.

const FEEDS = [
  { topic: 'Debt',        q: 'sovereign debt OR government bond yields OR fiscal deficit OR credit rating' },
  { topic: 'FX',          q: 'rand exchange rate OR US dollar OR emerging market currency OR forex' },
  { topic: 'Commodities', q: 'commodity prices OR gold price OR oil price OR iron ore OR platinum OR copper' },
  { topic: 'Politics',    q: 'South Africa politics OR geopolitics OR trade tariffs OR central bank policy' },
];

function decode(s) {
  return (s || '')
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .trim();
}

function parseItems(xml, topic) {
  const items = [];
  const blocks = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
  for (const b of blocks) {
    const title = decode((b.match(/<title>([\s\S]*?)<\/title>/) || [])[1]);
    const link = decode((b.match(/<link>([\s\S]*?)<\/link>/) || [])[1]);
    const pub = decode((b.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1]);
    const source = decode((b.match(/<source[^>]*>([\s\S]*?)<\/source>/) || [])[1]);
    if (!title || !link) continue;
    // Google News titles are "Headline - Source"; split the source off
    let headline = title, src = source;
    const dash = title.lastIndexOf(' - ');
    if (!src && dash > 0) { headline = title.slice(0, dash); src = title.slice(dash + 3); }
    items.push({ title: headline, link, source: src || 'News', published: pub, topic });
  }
  return items;
}

module.exports = async (req, res) => {
  try {
    const results = await Promise.all(FEEDS.map(async f => {
      const url = `https://news.google.com/rss/search?q=${encodeURIComponent(f.q)}&hl=en-ZA&gl=ZA&ceid=ZA:en`;
      try {
        const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (news-aggregator)' } });
        if (!r.ok) return [];
        const xml = await r.text();
        return parseItems(xml, f.topic).slice(0, 15);
      } catch { return []; }
    }));

    // Merge, dedupe by headline, sort newest first
    const seen = new Set();
    const merged = [];
    for (const item of results.flat()) {
      const key = item.title.toLowerCase().slice(0, 80);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(item);
    }
    merged.sort((a, b) => new Date(b.published) - new Date(a.published));

    // Cache at the edge for 10 minutes
    res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=1800');
    res.status(200).json({ items: merged.slice(0, 60), updated: new Date().toISOString() });
  } catch (e) {
    res.status(200).json({ items: [], error: String(e) });
  }
};
