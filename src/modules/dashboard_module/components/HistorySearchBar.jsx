import { useMemo, useState } from 'react';

function startOfDayLocal(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d, n) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

function addMonths(d, n) {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

function isSameDay(a, b) {
  return !!a && !!b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function isBetween(x, a, b) {
  if (!a || !b) return false;
  const t = startOfDayLocal(x).getTime();
  const s = startOfDayLocal(a).getTime();
  const e = startOfDayLocal(b).getTime();
  return t >= s && t <= e;
}

function calendarGrid(base) {
  const first = new Date(base.getFullYear(), base.getMonth(), 1);
  const day = first.getDay();
  const offset = (day + 6) % 7;
  const gridStart = addDays(first, -offset);
  const days = [];
  for (let i = 0; i < 42; i += 1) {
    days.push(addDays(gridStart, i));
  }
  return days;
}

function formatRangeLabel(start, end) {
  if (!start || !end) return 'All time';
  const fmt = (dt) => dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const startYear = start.getFullYear();
  const endYear = end.getFullYear();
  const startStr = fmt(start);
  const endStr = fmt(end);
  if (startYear === endYear) {
    return `${startStr} - ${endStr}, ${startYear}`;
  }
  return `${startStr}, ${startYear} - ${endStr}, ${endYear}`;
}

export default function HistorySearchBar({
  placeholder,
  searchValue,
  onSearchChange,
  filters,
  onFiltersChange,
  filterOptions,
  appliedRange,
  onAppliedRangeChange,
}) {
  const [searchFocused, setSearchFocused] = useState(false);
  const [datePopoverOpen, setDatePopoverOpen] = useState(false);
  const [viewMonth, setViewMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [pendingRange, setPendingRange] = useState({ start: null, end: null });
  const [datePreset, setDatePreset] = useState('last-week');

  const emptyFilters = useMemo(
    () => filterOptions.reduce((acc, option) => ({ ...acc, [option.key]: '' }), {}),
    [filterOptions]
  );

  const setCurrentWeekPending = () => {
    const t = startOfDayLocal(new Date());
    const weekday = t.getDay();
    const start = addDays(t, -weekday);
    const end = addDays(start, 6);
    setPendingRange({ start, end });
    setDatePreset('custom');
    setViewMonth(new Date(t.getFullYear(), t.getMonth(), 1));
  };

  const applyPresetRange = (preset) => {
    setDatePreset(preset);
    const today = new Date();
    const t = startOfDayLocal(today);

    if (preset === 'custom') {
      setPendingRange({ start: null, end: null });
      setViewMonth(new Date(t.getFullYear(), t.getMonth(), 1));
      return;
    }

    if (preset === 'last-week') {
      const weekday = t.getDay();
      const thisWeekStartSun = addDays(t, -weekday);
      const lastWeekStartSun = addDays(thisWeekStartSun, -7);
      const lastWeekEndSat = addDays(lastWeekStartSun, 6);
      setPendingRange({ start: lastWeekStartSun, end: lastWeekEndSat });
      setViewMonth(new Date(lastWeekEndSat.getFullYear(), lastWeekEndSat.getMonth(), 1));
      return;
    }

    if (preset === 'last-month') {
      const firstOfLastMonth = new Date(t.getFullYear(), t.getMonth() - 1, 1);
      const lastOfLastMonth = new Date(t.getFullYear(), t.getMonth(), 0);
      setPendingRange({ start: firstOfLastMonth, end: lastOfLastMonth });
      setViewMonth(new Date(firstOfLastMonth.getFullYear(), firstOfLastMonth.getMonth(), 1));
      return;
    }

    if (preset === 'last-year') {
      const prevYear = t.getFullYear() - 1;
      const start = new Date(prevYear, 0, 1);
      const end = new Date(prevYear, 11, 31);
      setPendingRange({ start, end });
      setViewMonth(new Date(prevYear, 0, 1));
    }
  };

  const onDayClick = (dayValue) => {
    setDatePreset('custom');
    const day = startOfDayLocal(dayValue);
    setPendingRange((current) => {
      if (!current.start || (current.start && current.end)) return { start: day, end: null };
      if (day < current.start) return { start: day, end: current.start };
      return { start: current.start, end: day };
    });
  };

  const onApplyDateRange = () => {
    if (pendingRange.start && pendingRange.end) {
      onAppliedRangeChange({
        start: startOfDayLocal(pendingRange.start),
        end: startOfDayLocal(pendingRange.end),
      });
      setDatePopoverOpen(false);
    }
  };

  const toggleFilter = (key) => {
    const isActive = filters[key] !== '';
    if (isActive) {
      onFiltersChange(emptyFilters);
      return;
    }
    onFiltersChange({
      ...emptyFilters,
      [key]: 'active',
    });
  };

  return (
    <div style={{ marginBottom: 20, display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <div style={{ flex: 1, position: 'relative' }}>
          <input
            type="text"
            placeholder={placeholder}
            value={searchValue}
            onChange={(e) => onSearchChange(e.target.value)}
            style={{
              width: '100%',
              padding: '12px 16px',
              background: '#ffffff',
              color: '#0f172a',
              border: '2px solid #cbd5e1',
              borderRadius: 10,
              fontSize: 14,
              fontWeight: 500,
              outline: 'none',
              transition: 'all 0.2s ease',
              boxShadow: '0 2px 4px rgba(0, 0, 0, 0.04)'
            }}
            onFocus={(e) => {
              e.target.style.borderColor = '#2563eb';
              e.target.style.boxShadow = '0 0 0 3px rgba(37, 99, 235, 0.1), 0 2px 8px rgba(0, 0, 0, 0.08)';
              setSearchFocused(true);
            }}
            onBlur={(e) => {
              e.target.style.borderColor = '#cbd5e1';
              e.target.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.04)';
              setSearchFocused(false);
            }}
          />
        </div>
      </div>

      {searchFocused && (
        <div
          onMouseDown={(e) => e.preventDefault()}
          style={{
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: 12,
            padding: 16,
            display: 'grid',
            gap: 16,
            animation: 'fadeIn 0.2s ease-in-out'
          }}
        >
          <style>{`
            @keyframes fadeIn {
              from {
                opacity: 0;
                transform: translateY(-8px);
              }
              to {
                opacity: 1;
                transform: translateY(0);
              }
            }
          `}</style>

          <div>
            <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 12px 0', fontWeight: 600 }}>Narrow down your search</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', position: 'relative' }}>
              {filterOptions.map(({ key, label }) => {
                const isActive = filters[key] !== '';
                return (
                  <button
                    key={key}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => toggleFilter(key)}
                    style={{
                      padding: '6px 14px',
                      background: isActive ? '#2563eb' : '#ffffff',
                      color: isActive ? '#ffffff' : '#0f172a',
                      border: `1px solid ${isActive ? '#2563eb' : '#cbd5e1'}`,
                      borderRadius: 999,
                      cursor: 'pointer',
                      fontWeight: 600,
                      fontSize: 13,
                      transition: 'all 0.2s ease',
                      whiteSpace: 'nowrap'
                    }}
                    onMouseEnter={(e) => {
                      if (!isActive) {
                        e.currentTarget.style.borderColor = '#2563eb';
                        e.currentTarget.style.color = '#2563eb';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isActive) {
                        e.currentTarget.style.borderColor = '#cbd5e1';
                        e.currentTarget.style.color = '#0f172a';
                      }
                    }}
                  >
                    {label}
                  </button>
                );
              })}

              <div className="date-filter" style={{ position: 'relative' }}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    if (!datePopoverOpen) {
                      if (appliedRange.start && appliedRange.end) {
                        setPendingRange({ start: appliedRange.start, end: appliedRange.end });
                        setDatePreset('custom');
                        setViewMonth(new Date(appliedRange.end.getFullYear(), appliedRange.end.getMonth(), 1));
                      } else {
                        setCurrentWeekPending();
                      }
                    }
                    setDatePopoverOpen((current) => !current);
                  }}
                  aria-haspopup="dialog"
                  aria-expanded={datePopoverOpen}
                  style={{
                    padding: '6px 14px',
                    background: datePopoverOpen || (appliedRange.start && appliedRange.end) ? '#2563eb' : '#ffffff',
                    color: datePopoverOpen || (appliedRange.start && appliedRange.end) ? '#ffffff' : '#0f172a',
                    border: `1px solid ${datePopoverOpen || (appliedRange.start && appliedRange.end) ? '#2563eb' : '#cbd5e1'}`,
                    borderRadius: 999,
                    cursor: 'pointer',
                    fontWeight: 600,
                    fontSize: 13,
                    transition: 'all 0.2s ease',
                    whiteSpace: 'nowrap'
                  }}
                  onMouseEnter={(e) => {
                    if (!datePopoverOpen && (!appliedRange.start || !appliedRange.end)) {
                      e.currentTarget.style.borderColor = '#2563eb';
                      e.currentTarget.style.color = '#2563eb';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!datePopoverOpen && (!appliedRange.start || !appliedRange.end)) {
                      e.currentTarget.style.borderColor = '#cbd5e1';
                      e.currentTarget.style.color = '#0f172a';
                    }
                  }}
                >
                  Date
                </button>
                {datePopoverOpen ? (
                  <div className="date-popover" role="dialog" aria-modal="true">
                    <div className="date-presets">
                      <button type="button" className={datePreset === 'last-week' ? 'active' : ''} onClick={() => applyPresetRange('last-week')}>Last Week</button>
                      <button type="button" className={datePreset === 'last-month' ? 'active' : ''} onClick={() => applyPresetRange('last-month')}>Last Month</button>
                      <button type="button" className={datePreset === 'last-year' ? 'active' : ''} onClick={() => applyPresetRange('last-year')}>Last Year</button>
                      <button type="button" className={datePreset === 'custom' ? 'active' : ''} onClick={() => applyPresetRange('custom')}>Custom</button>
                      <div className="date-apply">
                        <button type="button" className="dash-btn" style={{ width: '100%' }} onClick={onApplyDateRange} disabled={!pendingRange.start || !pendingRange.end}>Apply</button>
                      </div>
                    </div>
                    <div className="cal-wrap">
                      <div className="cal-header">
                        <div style={{ fontWeight: 900 }}>{viewMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</div>
                        <div className="cal-nav">
                          <button type="button" aria-label="Previous month" onClick={() => setViewMonth(addMonths(viewMonth, -1))}>{'<'}</button>
                          <button type="button" aria-label="Next month" onClick={() => setViewMonth(addMonths(viewMonth, 1))}>{'>'}</button>
                        </div>
                      </div>
                      <div className="cal-grid">
                        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((dayLabel) => (
                          <div key={`h-${dayLabel}`} className="cal-dow">{dayLabel}</div>
                        ))}
                        {calendarGrid(viewMonth).map((dayValue) => {
                          const inMonth = dayValue.getMonth() === viewMonth.getMonth();
                          const isStart = pendingRange.start && isSameDay(dayValue, pendingRange.start);
                          const isEnd = pendingRange.end && isSameDay(dayValue, pendingRange.end);
                          const inSel = pendingRange.start && pendingRange.end && isBetween(dayValue, pendingRange.start, pendingRange.end);
                          const cls = ['cal-day', inMonth ? '' : 'muted', inSel ? 'in-range' : '', isStart ? 'start' : '', isEnd ? 'end' : ''].filter(Boolean).join(' ');
                          return (
                            <div key={dayValue.toISOString()} className={cls} onClick={() => onDayClick(dayValue)}>{dayValue.getDate()}</div>
                          );
                        })}
                      </div>
                      <div className="range-summary">
                        {pendingRange.start && pendingRange.end ? formatRangeLabel(pendingRange.start, pendingRange.end) : 'Select a start and end date'}
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
