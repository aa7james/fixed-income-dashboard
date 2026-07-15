import React, { useRef, useState } from 'react';
import { requestDataUpdate, getUpdateRequestStatus } from '../utils/supabase';
import styles from './DataUploader.module.css';

const POLL_INTERVAL_MS = 5000;
const TIMEOUT_MS = 3 * 60 * 1000;

const LABELS = {
  idle: '🔄 Refresh Data',
  pending: '⏳ Requesting…',
  running: '⏳ Updating…',
  done: '✅ Updated',
  error: '⚠️ Failed — try again',
};

export default function RefreshDataButton({ onUpdated }) {
  const [state, setState] = useState('idle');
  const pollTimer = useRef(null);

  const stopPolling = () => {
    if (pollTimer.current) clearInterval(pollTimer.current);
    pollTimer.current = null;
  };

  const finish = (nextState, delayMs = 5000) => {
    setState(nextState);
    setTimeout(() => setState('idle'), delayMs);
  };

  const handleClick = async () => {
    if (state === 'pending' || state === 'running') return;
    setState('pending');

    try {
      const req = await requestDataUpdate();
      let elapsed = 0;

      pollTimer.current = setInterval(async () => {
        elapsed += POLL_INTERVAL_MS;
        try {
          const status = await getUpdateRequestStatus(req.id);
          if (status.status === 'running') {
            setState('running');
          } else if (status.status === 'done') {
            stopPolling();
            finish('done');
            onUpdated?.();
          } else if (status.status === 'error') {
            stopPolling();
            finish('error', 7000);
          }
        } catch {
          // transient poll error — keep trying until timeout
        }

        if (elapsed >= TIMEOUT_MS) {
          stopPolling();
          finish('error', 7000);
        }
      }, POLL_INTERVAL_MS);
    } catch {
      finish('error', 7000);
    }
  };

  return (
    <button
      className={styles.btn}
      onClick={handleClick}
      disabled={state === 'pending' || state === 'running'}
      title="Runs the Bloomberg historical pull on the terminal PC and refreshes the dashboard"
    >
      {LABELS[state]}
    </button>
  );
}
