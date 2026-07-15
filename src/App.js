import React, { useState, useEffect, useCallback } from 'react';
import { parseBloombergCSV } from './utils/parseCSV';
import { loadFromSupabase, loadInstruments, loadLastUpdated } from './utils/supabase';
import { categoriseFromInstruments, categoriseColumns } from './utils/parseCSV';
import LatestRates from './components/LatestRates';
import YieldCurve from './components/YieldCurve';
import ChartBuilder from './components/ChartBuilder';
import MyCharts from './components/MyCharts';
import MarketPricing from './components/MarketPricing';
import InvestmentPack from './components/InvestmentPack';
import DataUploader from './components/DataUploader';
import RefreshDataButton from './components/RefreshDataButton';
import styles from './App.module.css';

const TABS = ['Latest Rates', 'Market Pricing', 'Yield Curve', 'Chart Builder', 'My Charts', 'Investment Pack'];

export default function App() {
  const [data, setData] = useState(null);
  const [groups, setGroups] = useState({});
  const [instruments, setInstruments] = useState([]);
  const [activeTab, setActiveTab] = useState('Latest Rates');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingMsg, setLoadingMsg] = useState('Connecting to database…');
  const [chartRefresh, setChartRefresh] = useState(0);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [packItems, setPackItems] = useState(() => {
    try { return JSON.parse(localStorage.getItem('investmentPack') || '[]'); } catch { return []; }
  });

  // Load pack from Supabase on startup
  useEffect(() => {
    import('./utils/supabase').then(({ supabase }) => {
      supabase.from('investment_pack').select('items').eq('id', 'default').single()
        .then(({ data: row }) => {
          if (row?.items?.length > 0) {
            setPackItems(row.items);
            localStorage.setItem('investmentPack', JSON.stringify(row.items));
          }
        });
    });
  }, []);

  const savePack = (items) => {
    setPackItems(items);
    localStorage.setItem('investmentPack', JSON.stringify(items));
    import('./utils/supabase').then(({ supabase }) => {
      supabase.from('investment_pack')
        .upsert({ id: 'default', items, updated_at: new Date().toISOString() })
        .then(() => {});
    });
  };

  const togglePack = (key, config = {}) =>
    savePack((() => {
      // Yield curve uses unique timestamp keys so always add; others toggle
      const exists = packItems.find(item => item.key === key);
      return exists
        ? packItems.filter(item => item.key !== key)
        : [...packItems, { key, config }];
    })());

  const reorderPack = (fromKey, toKey) => {
    const from = packItems.findIndex(i => i.key === fromKey);
    const to   = packItems.findIndex(i => i.key === toKey);
    if (from === -1 || to === -1 || from === to) return;
    const next = [...packItems];
    next.splice(to, 0, next.splice(from, 1)[0]);
    savePack(next);
  };

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

  const refreshFromSupabase = useCallback(() => {
    return Promise.all([loadFromSupabase(), loadInstruments(), loadLastUpdated()])
      .then(([parsed, instrumentList, lastUpdatedAt]) => {
        setInstruments(instrumentList);
        setLastUpdated(lastUpdatedAt);
        if (parsed.dataRows.length > 0) {
          applyData(parsed, instrumentList);
        } else {
          setError('Database is empty — use "Load CSV" to import data.');
        }
      })
      .catch(err => {
        setError(`Could not load data: ${err.message}`);
      });
  }, [applyData]);

  useEffect(() => {
    setLoadingMsg('Connecting to database…');
    refreshFromSupabase().finally(() => setLoading(false));
  }, [refreshFromSupabase]);

  return (
    <div className={styles.app}>
      <header className={styles.header} id="app-header">
        <div className={styles.headerLeft}>
          <span className={styles.logo}>📈</span>
          <div>
            <h1 className={styles.title}>Fixed Income Dashboard</h1>
            <p className={styles.subtitle}>Aylett &amp; Co</p>
          </div>
        </div>
        <div className={styles.headerRight}>
          {lastUpdated && (
            <span className={styles.lastUpdated}>
              Data last updated: {new Date(lastUpdated).toLocaleString('en-ZA', {
                day: '2-digit', month: 'short', year: 'numeric',
                hour: '2-digit', minute: '2-digit', second: '2-digit',
                timeZone: 'Africa/Johannesburg',
              })}
            </span>
          )}
          <RefreshDataButton onUpdated={refreshFromSupabase} />
          <DataUploader onData={handleCSV} hasData={!!data} />
        </div>
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
          <nav className={styles.tabs} id="app-tabs">
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
            {activeTab === 'Chart Builder'   && <ChartBuilder   data={data} instruments={instruments} onSaved={() => setChartRefresh(n => n + 1)} />}
            {activeTab === 'My Charts'       && <MyCharts       data={data} refreshTrigger={chartRefresh} onTogglePack={togglePack} isInPack={isInPack} />}
            {activeTab === 'Investment Pack' && <InvestmentPack packItems={packItems} onTogglePack={togglePack} onReorder={reorderPack} data={data} instruments={instruments} />}
          </main>
        </>
      )}
    </div>
  );
}
