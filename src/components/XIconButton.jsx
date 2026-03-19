import React from 'react';

/**
 * XIconButton
 *
 * Reusable compact circular "X" icon button.
 * Design reference: ComplaintForm Step 3 (icon-btn / icon-btn--sm).
 *
 * Usage:
 *  <XIconButton label="Close" onClick={...} />
 *  <XIconButton size="sm" label="Remove image" onClick={...} />
 */
export default function XIconButton({
  onClick,
  label,
  title,
  size = 'md', // 'sm' | 'md'
  disabled = false,
  type = 'button',
  className = '',
  style,
}) {
  const isSm = size === 'sm';

  const btnSize = isSm ? 18 : 28;
  const iconSize = isSm ? 9 : 12;
  const shadow = isSm ? '0 2px 8px rgba(0, 0, 0, 0.16)' : '0 6px 16px rgba(0, 0, 0, 0.18)';

  return (
    <button
      type={type}
      onClick={onClick}
      aria-label={label}
      title={title || label}
      disabled={disabled}
      className={className}
      style={{
        width: btnSize,
        height: btnSize,
        borderRadius: 999,
        padding: 0,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(15, 23, 42, 0.85)',
        border: '1px solid rgba(255, 255, 255, 0.22)',
        boxShadow: shadow,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
        ...style,
      }}
    >
      <img
        src="/X icon.png"
        alt=""
        aria-hidden="true"
        style={{
          width: iconSize,
          height: iconSize,
          display: 'block',
          filter: 'brightness(0) invert(1)',
        }}
      />
    </button>
  );
}
