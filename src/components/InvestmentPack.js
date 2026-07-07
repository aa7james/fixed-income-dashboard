import React, { useRef } from 'react';
import YieldCurve from './YieldCurve';
import InflationLinkedBonds from './InflationLinkedBonds';
import MarketPricing from './MarketPricing';
import { ChartInner } from './MyCharts';
import styles from './InvestmentPack.module.css';

export default function InvestmentPack({ packItems, data, instruments }) {
  const printRef = useRef();

  const handlePrint = () => window.print();

  if (!packItems.length) {
    return (
      <div className={styles.empty}>
        <p className={styles.emptyTitle}>Your Investment Pack is empty</p>
        <p className={styles.emptyHint}>
          Click <strong>"+ Add to Pack"</strong> on any chart in the other tabs to include it here.
        </p>
      </div>
    );
  }

  const findItem       = (key) => packItems.find(item => item.key === key);
  const showYieldCurve = !!findItem('yield-curve');
  const showInflation  = !!findItem('inflation-linked');
  const fraKeys        = packItems.filter(item => item.key === 'jibar-fra' || item.key === 'zaronia-fra').map(i => i.key);
  const myChartItems   = packItems.filter(item => item.key.startsWith('my-chart-'));

  return (
    <div>
      {/* Screen header */}
      <div className={styles.header}>
        <div>
          <h2 className={styles.title}>Investment Pack</h2>
          <p className={styles.subtitle}>{packItems.length} chart{packItems.length !== 1 ? 's' : ''} selected</p>
        </div>
        <button className={styles.printBtn} onClick={handlePrint}>
          🖨 Print to PDF
        </button>
      </div>

      {/* Printable content */}
      <div ref={printRef} className={styles.packContent} id="investment-pack-content">

        <div className={styles.printHeader}>
          <h1 className={styles.printTitle}>Fixed Income — Investment Pack</h1>
          <p className={styles.printDate}>Aylett &amp; Co · {new Date().toLocaleDateString('en-ZA', { day: '2-digit', month: 'long', year: 'numeric' })}</p>
        </div>

        {showYieldCurve && (
          <div className={styles.chartSection}>
            <YieldCurve
              data={data}
              instruments={instruments}
              packMode
              packConfig={findItem('yield-curve')?.config}
            />
          </div>
        )}

        {showInflation && (
          <div className={styles.chartSection}>
            <InflationLinkedBonds />
          </div>
        )}

        {fraKeys.length > 0 && (
          <div className={styles.chartSection}>
            <MarketPricing data={data} instruments={instruments} packMode packKeys={fraKeys} />
          </div>
        )}

        {myChartItems.map(item => {
          const cfg = item.config;
          const chart = { id: cfg.chartId, name: cfg.chartName, series: cfg.series };
          return (
            <div key={item.key} className={styles.chartSection}>
              <h3 style={{ color: '#f1f5f9', fontSize: 15, fontWeight: 700, margin: '0 0 12px 0' }}>{cfg.chartName}</h3>
              <ChartInner
                chart={chart}
                data={data}
                period={cfg.period}
                customFrom={cfg.customFrom}
                customTo={cfg.customTo}
                height={300}
              />
            </div>
          );
        })}

      </div>
    </div>
  );
}
