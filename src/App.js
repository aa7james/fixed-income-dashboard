import React, { useState, useEffect, useCallback } from 'react';
import { parseBloombergCSV, categoriseColumns } from './utils/parseCSV';
import LatestRates from './components/LatestRates';
import YieldCurve from './components/YieldCurve';
import RateHistory from './components/RateHistory';
import DataUploader from './components/DataUploader';
import styles from './App.module.css';

const TABS = ['Latest Rates', 'Yield Curve', 'Rate History'];

export default function App() {
  const [data, setData] = useState(null);
  const [groups, setGroups] = useState({});
  const [activeTab, setActiveTab] = useState('Latest Rates');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const handleData = useCallback((text) => {
    try {
      const parsed = parseBloombergCSV(text);
      setData(parsed);
      setGroups(categoriseColumns(parsed.columns));
      setError(null);
    } catch (e) {
      setError('Could not parse the CSV file. Please check the format.');
    }
  }, []);

  // Try to load bundled CSV from public folder on first load
  useEffect(() => {
    fetch('/Historical_Bond_Data.csv')
      .then(r => {
        if (!r.ok) throw new Error('no bundled csv');
        return r.text();
      })
      .then(text => {
        handleData(text);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [handleData]);

  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.logo}>📈</span>
          <div>
            <h1 className={styles.title}>Fixed Income Dashboard</h1>
            <p className={styles.subtitle}>Aylett &amp; Co</p>
          </div>
        </div>
        <DataUploader onData={handleData} hasData={!!data} />
      </header>

      {loading && (
        <div className={styles.center}>
          <div className={styles.spinner} />
          <p>Loading data…</p>
        </div>
      )}

      {!loading && !data && (
        <div className={styles.center}>
          <p className={styles.placeholder}>Upload your CSV file using the button above to get started.</p>
        </div>
      )}

      {error && <div className={styles.error}>{error}</div>}

      {data && (
        <>
          <nav className={styles.tabs}>
            {TABS.map(tab => (
              <button
                key={tab}
                className={`${styles.tab} ${activeTab === tab ? styles.tabActive : ''}`}
                onClick={() => setActiveTab(tab)}
              >
                {tab}
              </button>
            ))}
          </nav>

          <main className={styles.main}>
            {activeTab === 'Latest Rates' && <LatestRates data={data} groups={groups} />}
            {activeTab === 'Yield Curve'  && <YieldCurve  data={data} />}
            {activeTab === 'Rate History' && <RateHistory data={data} groups={groups} />}
          </main>
        </>
      )}
    </div>
  );
}
