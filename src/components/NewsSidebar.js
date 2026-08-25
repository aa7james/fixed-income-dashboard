import React, { useState, useEffect, useCallback } from 'react';

const TOPICS = ['All', 'Debt', 'FX', 'Commodities', 'Politics'];
const TOPIC_COLORS = {
  Debt: '#38bdf8', FX: '#4ade80', Commodities: '#fb923c', Politics: '#f472b6',
};

function relTime(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

export default function NewsSidebar({ open, onClose }) {
  const [items, setItems] = useState([]);
  const [topic, setTopic] = useState('All');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch('/api/news')
      .then(r => r.json())
      .then(d => { setItems(d.items || []); setError(d.error ? 'News feed unavailable' : null); })
      .catch(() => setError('Could not load news'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!open) return;
    load();
    const t = setInterval(load, 5 * 60 * 1000); // refresh every 5 min while open
    return () => clearInterval(t);
  }, [open, load]);

  if (!open) return null;

  const filtered = topic === 'All' ? items : items.filter(i => i.topic === topic);

  return (
    <div style={{
      position: 'fixed', top: 0, right: 0, height: '100vh', width: 'min(380px, 90vw)',
      background: '#0f172a', borderLeft: '1px solid #334155', zIndex: 1000,
      display: 'flex', flexDirection: 'column', boxShadow: '-8px 0 24px rgba(0,0,0,0.4)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: '1px solid #334155' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#f1f5f9' }}>📰 Macro News</h3>
          <p style={{ margin: '2px 0 0', fontSize: 11, color: '#64748b' }}>Debt · FX · Commodities · Politics</p>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 20, cursor: 'pointer', lineHeight: 1 }}>✕</button>
      </div>

      <div style={{ display: 'flex', gap: 6, padding: '10px 16px', flexWrap: 'wrap', borderBottom: '1px solid #1e293b' }}>
        {TOPICS.map(t => {
          const on = topic === t;
          const c = TOPIC_COLORS[t] || '#94a3b8';
          return (
            <button key={t} onClick={() => setTopic(t)}
              style={{
                fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 12, cursor: 'pointer',
                border: `1px solid ${on ? c : '#334155'}`,
                background: on ? c + '22' : 'transparent',
                color: on ? c : '#64748b',
              }}>
              {t}
            </button>
          );
        })}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
        {loading && items.length === 0 && (
          <p style={{ color: '#64748b', fontSize: 13, textAlign: 'center', marginTop: 24 }}>Loading news…</p>
        )}
        {error && (
          <p style={{ color: '#f87171', fontSize: 13, textAlign: 'center', marginTop: 24 }}>{error}</p>
        )}
        {!loading && !error && filtered.length === 0 && (
          <p style={{ color: '#64748b', fontSize: 13, textAlign: 'center', marginTop: 24 }}>No headlines.</p>
        )}
        {filtered.map((it, i) => {
          const c = TOPIC_COLORS[it.topic] || '#94a3b8';
          return (
            <a key={i} href={it.link} target="_blank" rel="noopener noreferrer"
              style={{ display: 'block', padding: '10px 16px', borderBottom: '1px solid #1e293b', textDecoration: 'none' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', color: c, letterSpacing: 0.4 }}>{it.topic}</span>
                <span style={{ fontSize: 10, color: '#475569' }}>· {it.source}</span>
                <span style={{ fontSize: 10, color: '#475569', marginLeft: 'auto' }}>{relTime(it.published)}</span>
              </div>
              <p style={{ margin: 0, fontSize: 13, color: '#e2e8f0', lineHeight: 1.35 }}>{it.title}</p>
            </a>
          );
        })}
      </div>
    </div>
  );
}
