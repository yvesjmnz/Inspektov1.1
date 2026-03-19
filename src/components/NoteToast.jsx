import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * NoteToast
 * Bottom-right informational flash message.
 * - Animates in
 * - Auto-dismisses after `durationMs`
 * - Re-triggers (resets timer/animation) when `message` changes OR when `triggerKey` changes
 */
export default function NoteToast({
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
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    if (!normalized) {
      setVisible(false);
      return;
    }

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
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        right: 18,
        bottom: 18,
        zIndex: 2147483647,
        maxWidth: 'min(520px, calc(100vw - 36px))',
        background: '#ffffff',
        borderRadius: 14,
        border: '1px solid rgba(15,23,42,0.10)',
        backgroundClip: 'padding-box',
        boxShadow: '0 18px 45px rgba(2,6,23,0.22)',
        overflow: 'hidden',
        display: 'grid',
        gridTemplateColumns: '6px auto 1fr',
        alignItems: 'stretch',
        animation: 'noteToastIn 220ms ease-out, noteToastOut 220ms ease-in forwards',
        animationDelay: `0ms, ${Math.max(0, durationMs - 220)}ms`,
        willChange: 'transform, opacity',
        padding: 0,
        margin: 0,
        boxSizing: 'border-box',
      }}
    >
      {/* Accent bar */}
      <div
        style={{
          background: 'linear-gradient(90deg, #f59e0b 0%, #f59e0b 70%, rgba(255,255,255,0.95) 100%)',
          width: '100%',
          height: '100%',
          margin: 0,
          padding: 0,
          justifySelf: 'stretch',
          alignSelf: 'stretch',
          borderTopLeftRadius: 14,
          borderBottomLeftRadius: 14,
        }}
      />

      {/* Circle ! icon (left side) */}
      <div
        aria-hidden="true"
        style={{
          padding: '10px 10px 10px 12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div
          style={{
            width: 34,
            height: 34,
            borderRadius: 999,
            border: '2px solid rgba(245,158,11,0.85)',
            display: 'grid',
            placeItems: 'center',
            background: '#ffffff',
          }}
        >
          <div
            style={{
              width: 16,
              height: 16,
              position: 'relative',
            }}
          >
            <span
              style={{
                position: 'absolute',
                left: '50%',
                top: 2,
                width: 3,
                height: 10,
                background: 'rgba(245,158,11,0.95)',
                transform: 'translateX(-50%)',
                borderRadius: 2,
              }}
            />
            <span
              style={{
                position: 'absolute',
                left: '50%',
                bottom: 1,
                width: 3,
                height: 3,
                background: 'rgba(245,158,11,0.95)',
                transform: 'translateX(-50%)',
                borderRadius: 999,
              }}
            />
          </div>
        </div>
      </div>

      <div style={{ padding: '12px 14px 12px 0' }}>
        <div style={{ fontWeight: 900, color: '#0f172a', fontSize: 13, marginBottom: 2 }}>Note</div>
        <div style={{ color: '#475569', fontWeight: 400, fontSize: 12, lineHeight: 1.25 }}>{normalized}</div>
      </div>

      <style>{`
        @keyframes noteToastIn {
          from { transform: translateY(10px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }

        @keyframes noteToastOut {
          from { transform: translateY(0); opacity: 1; }
          to { transform: translateY(10px); opacity: 0; }
        }
      `}</style>
    </div>
  );

  return createPortal(node, document.body);
}
