import React, { useState, useEffect, useCallback } from 'react';
import { parseBloombergCSV } from './utils/parseCSV';
import { loadFromSupabase, loadInstruments } from './utils/supabase';
import { categoriseFromInstruments, categoriseColumns } from './utils/parseCSV';
import LatestRates from './components/LatestRates';
import YieldCurve from './components/YieldCurve';
import RateHistory from './components/RateHistory';
import ChartBuilder from './components/ChartBuilder';
import MyCharts from './components/MyCharts';
import MarketPricing from './components/MarketPricing';
import InvestmentPack from './components/InvestmentPack';
import DataUploader from './components/DataUploader';
import styles from './App.module.css';

const TABS = ['Latest Rates', 'Market Pricing', 'Yield Curve', 'Rate History', 'Chart Builder', 'My Charts', 'Investment Pack'];

export default function App() {
  const [data, setData] = useState(null);
  const [groups, setGroups] = useState({});
  const [instruments, setInstruments] = useState([]);
  const [activeTab, setActiveTab] = useState('Latest Rates');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingMsg, setLoadingMsg] = useState('Connecting to database…');
  const [chartRefresh, setChartRefresh] = useState(0);
  const [packItems, setPackItems] = useState([]);
  // packItems: [{ key: string, config: object }]

  const togglePack = (key, config = {}) =>
    setPackItems(prev => {
      const exists = prev.find(item => item.key === key);
      return exists
        ? prev.filter(item => item.key !== key)
        : [...prev, { key, config }];
    });

  const isInPack = (key) => packItems.some(item => item.key === key);

  const applyData = useCallback((parsed, instrumentList) => {
    setData(parsed);
    if (instrumentList && instrumentList.length > 0) {
      setGroups(categoriseFromInstruments(parsed.columns, instrumentList));
    } else {
      setGroups(categoriseColumns(parsed.columns));
    }
    setError(null);
  }, []);

  const handleCSV = useCallback((text) => {
    try {
      applyData(parseBloombergCSV(text), instruments);
    } catch (e) {
      setError('Could not parse the CSV file. Please check the format.');
    }
  }, [applyData, instruments]);

  useEffect(() => {
    setLoadingMsg('Connecting to database…');
    Promise.all([loadFromSupabase(), loadInstruments()])
      .then(([parsed, instrumentList]) => {
        setInstruments(instrumentList);
        if (parsed.dataRows.length > 0) {
          applyData(parsed, instrumentList);
        } else {
          setError('Database is empty — use "Load CSV" to import data.');
        }
      })
      .catch(err => {
        setError(`Could not load data: ${err.message}`);
      })
      .finally(() => setLoading(false));
  }, [applyData]);

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
        <DataUploader onData={handleCSV} hasData={!!data} />
      </header>

      {loading && (
        <div className={styles.center}>
          <div className={styles.spinner} />
          <p>{loadingMsg}</p>
        </div>
      )}

      {!loading && !data && !error && (
        <div className={styles.center}>
          <p className={styles.placeholder}>No data found. Use "Load CSV" to import your data.</p>
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
            {activeTab === 'Latest Rates'    && <LatestRates    data={data} groups={groups} />}
            {activeTab === 'Market Pricing'  && <MarketPricing  data={data} instruments={instruments} packItems={packItems} onTogglePack={togglePack} isInPack={isInPack} />}
            {activeTab === 'Yield Curve'     && <YieldCurve     data={data} instruments={instruments} packItems={packItems} onTogglePack={togglePack} isInPack={isInPack} />}
            {activeTab === 'Rate History'    && <RateHistory    data={data} groups={groups} />}
            {activeTab === 'Chart Builder'   && <ChartBuilder   data={data} instruments={instruments} onSaved={() => setChartRefresh(n => n + 1)} />}
            {activeTab === 'My Charts'       && <MyCharts       data={data} refreshTrigger={chartRefresh} />}
            {activeTab === 'Investment Pack' && <InvestmentPack packItems={packItems} data={data} instruments={instruments} />}
          </main>
        </>
      )}
    </div>
  );
}
