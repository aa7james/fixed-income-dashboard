import React, { useRef } from 'react';
import styles from './DataUploader.module.css';

export default function DataUploader({ onData, hasData }) {
  const inputRef = useRef();

  const handleFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => onData(ev.target.result);
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div className={styles.wrapper}>
      <input
        ref={inputRef}
        type="file"
        accept=".csv"
        onChange={handleFile}
        className={styles.hidden}
      />
      <button className={styles.btn} onClick={() => inputRef.current.click()}>
        {hasData ? '🔄 Update Data' : '📂 Load CSV'}
      </button>
    </div>
  );
}
