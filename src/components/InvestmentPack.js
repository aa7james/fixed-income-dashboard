import React, { useRef, useState } from 'react';
import YieldCurve from './YieldCurve';
import InflationLinkedBonds from './InflationLinkedBonds';
import MarketPricing from './MarketPricing';
import { ChartInner } from './MyCharts';
import styles from './InvestmentPack.module.css';


function PackSection({ itemKey, onRemove, onDragStart, onDragOver, onDrop, isDragOver, children }) {
  return (
    <div
      className={`${styles.chartSection} ${isDragOver ? styles.dragOver : ''}`}
      draggable
      onDragStart={() => onDragStart(itemKey)}
      onDragOver={e => { e.preventDefault(); onDragOver(itemKey); }}
      onDrop={() => onDrop(itemKey)}
    >
      <div className={styles.sectionHeader}>
        <span className={styles.dragHandle} title="Drag to reorder">⠿</span>
        <button className={styles.removeBtn} onClick={() => onRemove(itemKey)}>✕ Remove</button>
      </div>
      {children}
    </div>
  );
}

export default function InvestmentPack({ packItems, onTogglePack, onReorder, data, instruments }) {
  const dragKey = useRef(null);
  const [dragOverKey, setDragOverKey] = useState(null);

  const handleDragStart = (key) => { dragKey.current = key; };
  const handleDragOver  = (key) => { setDragOverKey(key); };
  const handleDrop      = (key) => {
    if (dragKey.current && dragKey.current !== key) onReorder(dragKey.current, key);
    dragKey.current = null;
    setDragOverKey(null);
  };

  const sectionProps = (key) => ({
    itemKey: key,
    onRemove: onTogglePack,
    onDragStart: handleDragStart,
    onDragOver: handleDragOver,
    onDrop: handleDrop,
    isDragOver: dragOverKey === key,
  });

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

  return (
    <div>
      <div className={styles.header}>
        <div>
          <h2 className={styles.title}>Investment Pack</h2>
          <p className={styles.subtitle}>
            {packItems.length} chart{packItems.length !== 1 ? 's' : ''} — drag ⠿ to reorder
          </p>
        </div>
        <button className={styles.printBtn} onClick={handlePrint}>🖨 Print to PDF</button>
      </div>

      <div className={styles.packContent} id="investment-pack-content">

        <div className={styles.printHeader}>
          <h1 className={styles.printTitle}>Fixed Income — Investment Pack</h1>
          <p className={styles.printDate}>Aylett &amp; Co · {new Date().toLocaleDateString('en-ZA', { day: '2-digit', month: 'long', year: 'numeric' })}</p>
        </div>

        {packItems.map(item => {
          const key = item.key;
          const cfg = item.config;

          if (key.startsWith('yield-curve')) return (
            <PackSection key={key} {...sectionProps(key)}>
              <YieldCurve data={data} instruments={instruments} packMode packConfig={cfg} />
            </PackSection>
          );

          if (key === 'inflation-linked') return (
            <PackSection key={key} {...sectionProps(key)}>
              <InflationLinkedBonds />
            </PackSection>
          );

          if (key === 'jibar-fra' || key === 'zaronia-fra' || key === 'sofr-fra') return (
            <PackSection key={key} {...sectionProps(key)}>
              <MarketPricing data={data} instruments={instruments} packMode packKeys={[key]} />
            </PackSection>
          );

          if (key.startsWith('my-chart-')) {
            const chart = { id: cfg.chartId, name: cfg.chartName, series: cfg.series };
            return (
              <PackSection key={key} {...sectionProps(key)}>
                <h3 className={styles.sectionTitle}>{cfg.chartName}</h3>
                <ChartInner chart={chart} data={data} period={cfg.period} customFrom={cfg.customFrom} customTo={cfg.customTo} height={450} />
              </PackSection>
            );
          }

          return null;
        })}

      </div>
    </div>
  );
}
