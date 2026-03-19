import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * ErrorToast
 * Bottom-right error flash message.
 * - Animates in
 * - Auto-dismisses after `durationMs`
 * - Re-triggers (resets timer/animation) when `message` changes OR when `triggerKey` changes
 */
export default function ErrorToast({
  message,
  durationMs = 3000,
  triggerKey,
}) {
  const [visible, setVisible] = useState(false);
  const [animKey, setAnimKey] = useState(0);
  const timerRef = useRef(null);

  const normalized = useMemo(() => {
    const m = typeof message === 'string' ? message.trim() : '';
    return m;
  }, [message]);

  useEffect(() => {
    // Clear any existing timer
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    if (!normalized) {
      setVisible(false);
      return;
    }

    // Re-trigger animation + visibility
    setAnimKey((k) => k + 1);
    setVisible(true);

    timerRef.current = setTimeout(() => {
      setVisible(false);
      timerRef.current = null;
    }, durationMs);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [normalized, durationMs, triggerKey]);

  if (!visible || !normalized) return null;

  const node = (
    <div
      key={animKey}
      role="alert"
      aria-live="assertive"
      style={{
        position: 'fixed',
        right: 18,
        bottom: 18,
        zIndex: 2147483647,
        maxWidth: 'min(420px, calc(100vw - 36px))',
        background: '#ffffff',
        borderRadius: 14,
        border: '1px solid rgba(15,23,42,0.10)',
        boxShadow: '0 18px 45px rgba(2,6,23,0.22)',
        overflow: 'hidden',
        display: 'grid',
        gridTemplateColumns: '6px 1fr',
        animation: 'errorToastIn 220ms ease-out, errorToastOut 220ms ease-in forwards',
        animationDelay: `0ms, ${Math.max(0, durationMs - 220)}ms`,
        willChange: 'transform, opacity',
      }}
    >
      <div style={{ background: '#ef4444' }} />
      <div style={{ padding: '12px 14px' }}>
        <div style={{ fontWeight: 900, color: '#0f172a', fontSize: 13, marginBottom: 2 }}>Error</div>
        <div style={{ color: '#475569', fontWeight: 700, fontSize: 12, lineHeight: 1.25 }}>{normalized}</div>
      </div>

      <style>{`
        @keyframes errorToastIn {
          from { transform: translateY(10px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }

        @keyframes errorToastOut {
          from { transform: translateY(0); opacity: 1; }
          to { transform: translateY(10px); opacity: 0; }
        }
      `}</style>
    </div>
  );

  // Render into <body> so it is always viewport-fixed (not affected by transformed ancestors)
  return createPortal(node, document.body);
}
