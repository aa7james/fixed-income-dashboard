import React, { useRef, useState } from 'react';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
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
      <div className={styles.pdfCapture} data-pdf-section>
        {children}
      </div>
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

  const [generating, setGenerating] = useState(false);

  const handleDownloadPdf = async () => {
    const container = document.getElementById('investment-pack-content');
    const sections = Array.from(container.querySelectorAll('[data-pdf-section]'));
    if (!sections.length) return;

    setGenerating(true);
    try {
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 8;
      const usableWidth = pageWidth - margin * 2;
      const titleHeight = 16;
      const slotHeight = pageHeight - margin * 2 - titleHeight;

      const dateStr = new Date().toLocaleDateString('en-ZA', { day: '2-digit', month: 'long', year: 'numeric' });

      const drawPageChrome = () => {
        pdf.setFillColor(15, 23, 42);
        pdf.rect(0, 0, pageWidth, pageHeight, 'F');
        pdf.setTextColor(241, 245, 249);
        pdf.setFontSize(16);
        pdf.setFont(undefined, 'bold');
        pdf.text('Fixed Income — Investment Pack', margin, margin + 6);
        pdf.setFontSize(10);
        pdf.setFont(undefined, 'normal');
        pdf.setTextColor(148, 163, 184);
        pdf.text(`Aylett & Co · ${dateStr}`, margin, margin + 12);
      };

      for (let i = 0; i < sections.length; i++) {
        if (i > 0) pdf.addPage();
        drawPageChrome();

        const canvas = await html2canvas(sections[i], { backgroundColor: '#0f172a', scale: 2 });
        const imgData = canvas.toDataURL('image/png');
        const ratio = canvas.height / canvas.width;

        let imgWidth = usableWidth;
        let imgHeight = imgWidth * ratio;
        if (imgHeight > slotHeight) {
          imgHeight = slotHeight;
          imgWidth = imgHeight / ratio;
        }

        const x = margin + (usableWidth - imgWidth) / 2;
        const y = margin + titleHeight + (slotHeight - imgHeight) / 2;
        pdf.addImage(imgData, 'PNG', x, y, imgWidth, imgHeight);
      }

      pdf.save(`Fixed-Income-Investment-Pack-${new Date().toISOString().slice(0, 10)}.pdf`);
    } finally {
      setGenerating(false);
    }
  };

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
        <button className={styles.printBtn} onClick={handleDownloadPdf} disabled={generating}>
          {generating ? '⏳ Generating…' : '⬇ Download PDF'}
        </button>
      </div>

      <div className={styles.packContent} id="investment-pack-content">

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
