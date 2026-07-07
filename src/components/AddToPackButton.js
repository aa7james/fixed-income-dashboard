import React from 'react';
import styles from './AddToPackButton.module.css';

export default function AddToPackButton({ isInPack, onToggle }) {
  return (
    <button
      className={`${styles.btn} ${isInPack ? styles.active : ''}`}
      onClick={onToggle}
      title={isInPack ? 'Remove from Investment Pack' : 'Add to Investment Pack'}
    >
      {isInPack ? '✓ In Pack' : '+ Add to Pack'}
    </button>
  );
}
