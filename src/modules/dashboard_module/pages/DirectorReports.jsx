import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { getDirectorMetrics } from '../../../lib/reports/metricsService';
import './Dashboard.css';

const COMPLAINT_GOAL_HOURS = 1;
const INSPECTION_GOAL_MINUTES = 42;

function formatHours(hours) {
  if (hours === null || hours === undefined) return 'N/A';
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  const wholeHours = Math.floor(hours);
  const minutes = Math.round((hours - wholeHours) * 60);
  return minutes > 0 ? `${wholeHours}h ${minutes}m` : `${wholeHours}h`;
}

function formatMinutes(minutes) {
  if (minutes === null || minutes === undefined) return 'N/A';
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const wholeHours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  return mins > 0 ? `${wholeHours}h ${mins}m` : `${wholeHours}h`;
}

function GoalPill({ label, value, goal, unit, subtitle }) {
  const hasValue = value !== null && value !== undefined;
  const delta = hasValue ? Number((value - goal).toFixed(2)) : null;
  const isMet = hasValue ? value <= goal : null;
  const accent = isMet === null ? '#64748b' : isMet ? '#16a34a' : '#dc2626';
  const soft = '#ffffff';
  const border = '#e2e8f0';
  const arrow = !hasValue || delta === 0 ? '' : isMet ? '↓' : '↑';
  const percentDelta = hasValue && goal > 0
    ? Math.round((Math.abs(value - goal) / goal) * 100)
    : null;
  const trendLabel = !hasValue
    ? 'Waiting for completed records'
    : delta === 0
      ? 'On goal'
      : `${arrow} ${percentDelta}%`;

  return (
    <div
      style={{
        background: soft,
        border: `1px solid ${border}`,
        borderRadius: 18,
        padding: '18px 20px',
        display: 'grid',
        gap: 10,
        boxShadow: '0 8px 20px rgba(15, 23, 42, 0.05)',
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        {label}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 34, fontWeight: 900, color: '#0f172a', lineHeight: 1 }}>
            {unit === 'hours' ? formatHours(value) : formatMinutes(value)}
          </div>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 12px',
              borderRadius: 999,
              background: isMet === null ? '#f8fafc' : isMet ? '#f0fdf4' : '#fef2f2',
              color: accent,
              border: `1px solid ${isMet === null ? '#cbd5e1' : isMet ? '#86efac' : '#fca5a5'}`,
              fontWeight: 800,
              fontSize: 12,
            }}
          >
            {trendLabel}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', fontSize: 13 }}>
        <span style={{ color: accent, fontWeight: 900 }}>
          Goal: {unit === 'hours' ? formatHours(goal) : formatMinutes(goal)} or below
        </span>
        <span style={{ color: '#94a3b8' }}>•</span>
        <span style={{ color: '#64748b' }}>{subtitle}</span>
      </div>
    </div>
  );
}

function SummaryCard({ label, value, accent, breakdown }) {
  return (
    <div
      style={{
        background: '#ffffff',
        border: '1px solid #dbe5f0',
        borderRadius: 22,
        padding: 22,
        boxShadow: '0 14px 34px rgba(15, 23, 42, 0.06)',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div style={{ position: 'relative', display: 'grid', gap: 14 }}>
        <div style={{ fontSize: 12, color: '#64748b', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          {label}
        </div>
        <div style={{ fontSize: 40, fontWeight: 900, color: '#0f172a', lineHeight: 1 }}>
          {value}
        </div>
        <div style={{ display: 'grid', gap: 8 }}>
          {breakdown.map((item) => (
            <div key={item.label} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13 }}>
              <span style={{ color: '#64748b' }}>{item.label}</span>
              <span style={{ color: '#0f172a', fontWeight: 800 }}>{item.value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function DirectorReports() {
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let isMounted = true;

    const loadMetrics = async (showLoader = false) => {
      if (showLoader && isMounted) setLoading(true);
      if (isMounted) setError('');

      try {
        const nextMetrics = await getDirectorMetrics();
        if (!isMounted) return;
        setMetrics(nextMetrics);
      } catch (err) {
        if (!isMounted) return;
        setError(err?.message || 'Failed to load metrics');
      } finally {
        if (showLoader && isMounted) setLoading(false);
      }
    };

    loadMetrics(true);

    const channel = supabase
      .channel('director-performance-report-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'complaints' }, () => loadMetrics(false))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mission_orders' }, () => loadMetrics(false))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inspection_reports' }, () => loadMetrics(false))
      .subscribe();

    const intervalId = window.setInterval(() => {
      loadMetrics(false);
    }, 60000);

    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
      supabase.removeChannel(channel);
    };
  }, []);

  const summaryCards = useMemo(() => {
    if (!metrics) return [];

    return [
      {
        label: 'Total Complaints',
        value: metrics.complaints.total,
        accent: '#1d4ed8',
        breakdown: [
          { label: 'Approved', value: metrics.complaints.approved },
          { label: 'Declined', value: metrics.complaints.declined },
          { label: 'Pending', value: metrics.complaints.pending },
        ],
      },
      {
        label: 'Total Mission Orders',
        value: metrics.missionOrders.total,
        accent: '#f59e0b',
        breakdown: [
          { label: 'Draft', value: metrics.missionOrders.byStatus.draft },
          { label: 'Issued', value: metrics.missionOrders.byStatus.issued },
          { label: 'Pre-Approved', value: metrics.missionOrders.byStatus.forInspection },
          { label: 'Completed', value: metrics.missionOrders.byStatus.complete },
          { label: 'Cancelled', value: metrics.missionOrders.byStatus.cancelled },
        ],
      },
      {
        label: 'Total Inspections',
        value: metrics.inspections.total,
        accent: '#0f766e',
        breakdown: [
          { label: 'Pending', value: metrics.inspections.byStatus.pending },
          { label: 'In Progress', value: metrics.inspections.byStatus.inProgress },
          { label: 'Completed', value: metrics.inspections.byStatus.completed },
        ],
      },
    ];
  }, [metrics]);

  if (loading) {
    return <div style={{ padding: 32, textAlign: 'center', color: '#64748b' }}>Loading analytics...</div>;
  }

  if (error) {
    return (
      <div style={{ padding: 32, background: '#fee2e2', border: '1px solid #fecaca', borderRadius: 12, color: '#991b1b' }}>
        {error}
      </div>
    );
  }

  if (!metrics) {
    return <div style={{ padding: 32, textAlign: 'center', color: '#64748b' }}>No data available.</div>;
  }

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
        <GoalPill
          label="Average Resolution Time (Document Processing)"
          value={metrics.complaintToMOPreapproval?.avgTime}
          goal={COMPLAINT_GOAL_HOURS}
          unit="hours"
          subtitle="Received complaint to director pre-approved mission order"
        />
        <GoalPill
          label="Average Resolution Time (Inspection)"
          value={metrics.inspections?.avgDuration}
          goal={INSPECTION_GOAL_MINUTES}
          unit="minutes"
          subtitle="Inspection status from In Progress to Completed"
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
        {summaryCards.map((card) => (
          <SummaryCard
            key={card.label}
            label={card.label}
            value={card.value}
            accent={card.accent}
            breakdown={card.breakdown}
          />
        ))}
      </div>
    </div>
  );
}
