import React, { useState } from 'react';
import styles from './LatestRates.module.css';

export default function LatestRates({ data, groups }) {
  const [search, setSearch] = useState('');
  const latest = data.dataRows[data.dataRows.length - 1];
  const prev    = data.dataRows[data.dataRows.length - 2];

  if (!latest) return <p style={{ color: '#64748b' }}>No data available.</p>;

  const fmt = (v) => v == null ? '—' : v.toFixed(2);
  const fmtDate = (d) => d.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' });

  const change = (name) => {
    if (!prev) return null;
    const cur = latest[name];
    const pre = prev[name];
    if (cur == null || pre == null) return null;
    return cur - pre;
  };

  const filteredGroups = Object.entries(groups).map(([groupName, cols]) => {
    const filtered = cols.filter(c =>
      !search || c.name.toLowerCase().includes(search.toLowerCase())
    );
    return [groupName, filtered];
  }).filter(([, cols]) => cols.length > 0);

  return (
    <div>
      <div className={styles.topBar}>
        <div>
          <h2 className={styles.heading}>Latest Rates</h2>
          <p className={styles.asOf}>As of {fmtDate(latest.date)}</p>
        </div>
        <input
          className={styles.search}
          placeholder="Search instrument…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {filteredGroups.map(([groupName, cols]) => {
        const isBps = groupName === 'Variable Rate NCDs';
        return (
        <div key={groupName} className={styles.group}>
          <h3 className={styles.groupTitle}>{groupName}</h3>
          <div className={styles.grid}>
            {cols.map(col => {
              const val = latest[col.name];
              const chg = change(col.name);
              return (
                <div key={col.name} className={styles.card}>
                  <p className={styles.cardName}>{col.name}</p>
                  <p className={styles.cardValue}>
                    {val == null ? '—' : (isBps ? val.toFixed(1) : fmt(val))}
                    <span className={styles.unit}>{isBps ? ' bps' : '%'}</span>
                  </p>
                  {chg != null && (
                    <p className={`${styles.cardChange} ${chg > 0 ? styles.up : chg < 0 ? styles.down : styles.flat}`}>
                      {chg > 0 ? '▲' : chg < 0 ? '▼' : '—'} {Math.abs(chg).toFixed(isBps ? 1 : 2)}{isBps ? ' bps' : ''}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        );
      })}
    </div>
  );
}
