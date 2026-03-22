export default function MiniRefreshButton({
  onClick,
  disabled = false,
  title = 'Refresh',
  ariaLabel = 'Refresh',
  className = '',
}) {
  const classes = ['dash-mini-refresh-btn', className].filter(Boolean).join(' ');

  return (
    <button
      type="button"
      className={classes}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      title={title}
    >
      <img src="/refresh.png" alt="" aria-hidden="true" className="dash-mini-refresh-icon" />
    </button>
  );
}
