import React from 'react';
import { ResponsiveContainer } from 'recharts';

// Drop-in replacement for <ResponsiveContainer width="100%" height={h}> that makes
// the chart user-resizable: drag the handle at the bottom-right corner to change
// width and/or height. The chart reflows to fit.
export default function ResizableChart({ height = 360, minHeight = 160, children }) {
  return (
    <div
      style={{
        height, minHeight, width: '100%', maxWidth: '100%',
        resize: 'both', overflow: 'hidden', position: 'relative',
        borderBottom: '1px dashed #334155', // hints the drag handle is below-right
      }}
      title="Drag the bottom-right corner to resize"
    >
      <ResponsiveContainer width="100%" height="100%">
        {children}
      </ResponsiveContainer>
    </div>
  );
}
