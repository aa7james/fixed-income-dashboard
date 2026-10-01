import React, { useState } from 'react';
import styles from './LatestRates.module.css';

export default function LatestRates({ data, groups }) {
  const [search, setSearch] = useState('');
  const latest = data.dataRows[data.dataRows.length - 1];

  if (!latest) return <p style={{ color: '#64748b' }}>No data available.</p>;

  const fmt = (v) => v == null ? '—' : v.toFixed(2);
  const fmtDate = (d) => d.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' });
  const fmtShort = (d) => d.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short' });

  // Most recent non-null value for an instrument (carries forward next-day/lagged
  // instruments like CDS so the card shows the last available price, not a dash).
  const lastAvail = (name) => {
    for (let i = data.dataRows.length - 1; i >= 0; i--) {
      const v = data.dataRows[i][name];
      if (v != null) return { v, i, date: data.dataRows[i].date };
    }
    return { v: null, i: -1, date: null };
  };
  const prevAvailValue = (name, beforeIdx) => {
    for (let i = beforeIdx - 1; i >= 0; i--) {
      const v = data.dataRows[i][name];
      if (v != null) return v;
    }
    return null;
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
              const { v: val, i: vi, date: vDate } = lastAvail(col.name);
              const pre = vi > 0 ? prevAvailValue(col.name, vi) : null;
              const chg = (val != null && pre != null) ? val - pre : null;
              const stale = val != null && vDate && vDate.getTime() < latest.date.getTime();
              return (
                <div key={col.name} className={styles.card}>
                  <p className={styles.cardName}>{col.name}</p>
                  <p className={styles.cardValue}>
                    {val == null ? '—' : (isBps ? val.toFixed(1) : fmt(val))}
                    <span className={styles.unit}>{isBps ? ' bps' : '%'}</span>
                  </p>
                  {stale && <p style={{ fontSize: 10, color: '#64748b', margin: '2px 0 0' }}>as of {fmtShort(vDate)}</p>}
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
