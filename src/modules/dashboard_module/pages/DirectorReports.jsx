import React, { useEffect, useMemo, useState } from 'react';
import { getDirectorMetrics } from '../../../lib/reports/metricsService';
import './Dashboard.css';

function formatDuration(hours) {
  if (hours === null || hours === undefined) return '—';
  if (hours < 1) {
    const mins = Math.round(hours * 60);
    return `${mins}m`;
  }
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function formatMinutes(minutes) {
  if (minutes === null || minutes === undefined) return '—';
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export default function DirectorReports() {
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dateRange, setDateRange] = useState(null);
  const [expandedSection, setExpandedSection] = useState('overview');

  useEffect(() => {
    const loadMetrics = async () => {
      setLoading(true);
      setError('');
      try {
        const data = await getDirectorMetrics(dateRange);
        setMetrics(data);
      } catch (err) {
        setError(err.message || 'Failed to load metrics');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    loadMetrics();
  }, [dateRange]);

  if (loading) {
    return (
      <div style={{ padding: 32, textAlign: 'center', color: '#64748b' }}>
        Loading metrics...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 32, background: '#fee2e2', border: '1px solid #fecaca', borderRadius: 12, color: '#991b1b' }}>
        {error}
      </div>
    );
  }

  if (!metrics) {
    return (
      <div style={{ padding: 32, textAlign: 'center', color: '#64748b' }}>
        No data available
      </div>
    );
  }

  const { complaints, missionOrders, inspections, timeline, complaintToMOPreapproval } = metrics;

  return (
    <div style={{ display: 'grid', gap: 24 }}>
      {/* KPI Cards - Overview */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>
            Total Complaints
          </div>
          <div style={{ fontSize: 32, fontWeight: 900, color: '#0f172a', marginBottom: 4 }}>
            {complaints.total}
          </div>
          <div style={{ fontSize: 13, color: '#64748b' }}>
            {complaints.approved} approved, {complaints.declined} declined
          </div>
        </div>

        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>
            Approval Rate
          </div>
          <div style={{ fontSize: 32, fontWeight: 900, color: '#22c55e', marginBottom: 4 }}>
            {complaints.approvalRate}%
          </div>
          <div style={{ fontSize: 13, color: '#64748b' }}>
            Of all complaints reviewed
          </div>
        </div>

        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>
            Avg Decision Time
          </div>
          <div style={{ fontSize: 32, fontWeight: 900, color: '#2563eb', marginBottom: 4 }}>
            {formatDuration(complaints.avgDecisionTime)}
          </div>
          <div style={{ fontSize: 13, color: '#64748b' }}>
            From submission to decision
          </div>
        </div>

        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>
            Pending Review
          </div>
          <div style={{ fontSize: 32, fontWeight: 900, color: '#f59e0b', marginBottom: 4 }}>
            {complaints.pending}
          </div>
          <div style={{ fontSize: 13, color: '#64748b' }}>
            Awaiting director decision
          </div>
        </div>

        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>
            Complaint to MO Pre-Approval
          </div>
          <div style={{ fontSize: 32, fontWeight: 900, color: complaintToMOPreapproval?.avgTime && complaintToMOPreapproval.avgTime <= 3 ? '#22c55e' : '#f59e0b', marginBottom: 4 }}>
            {formatDuration(complaintToMOPreapproval?.avgTime)}
          </div>
          <div style={{ fontSize: 13, color: '#64748b' }}>
            {complaintToMOPreapproval?.totalProcessed} processed (Target: 2-3h)
          </div>
        </div>
      </div>

      {/* Mission Orders Section */}
      <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden' }}>
        <div
          onClick={() => setExpandedSection(expandedSection === 'mission-orders' ? null : 'mission-orders')}
          style={{
            padding: '16px 20px',
            background: '#0b2249',
            color: '#ffffff',
            cursor: 'pointer',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            userSelect: 'none',
          }}
        >
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 900 }}>Mission Orders</h3>
          <span style={{ fontSize: 20, fontWeight: 900 }}>
            {expandedSection === 'mission-orders' ? '−' : '+'}
          </span>
        </div>

        {expandedSection === 'mission-orders' && (
          <div style={{ padding: 20, display: 'grid', gap: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
              <div style={{ background: '#f8fafc', padding: 12, borderRadius: 8 }}>
                <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>Total</div>
                <div style={{ fontSize: 24, fontWeight: 900, color: '#0f172a' }}>{missionOrders.total}</div>
              </div>
              <div style={{ background: '#f8fafc', padding: 12, borderRadius: 8 }}>
                <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>Draft</div>
                <div style={{ fontSize: 24, fontWeight: 900, color: '#0f172a' }}>{missionOrders.byStatus.draft}</div>
              </div>
              <div style={{ background: '#f8fafc', padding: 12, borderRadius: 8 }}>
                <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>Issued</div>
                <div style={{ fontSize: 24, fontWeight: 900, color: '#f59e0b' }}>{missionOrders.byStatus.issued}</div>
              </div>
              <div style={{ background: '#f8fafc', padding: 12, borderRadius: 8 }}>
                <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>For Inspection</div>
                <div style={{ fontSize: 24, fontWeight: 900, color: '#22c55e' }}>{missionOrders.byStatus.forInspection}</div>
              </div>
              <div style={{ background: '#f8fafc', padding: 12, borderRadius: 8 }}>
                <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>Complete</div>
                <div style={{ fontSize: 24, fontWeight: 900, color: '#2563eb' }}>{missionOrders.byStatus.complete}</div>
              </div>
              <div style={{ background: '#f8fafc', padding: 12, borderRadius: 8 }}>
                <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>Cancelled</div>
                <div style={{ fontSize: 24, fontWeight: 900, color: '#ef4444' }}>{missionOrders.byStatus.cancelled}</div>
              </div>
            </div>

            <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', marginBottom: 8 }}>
                Processing Timeline
              </div>
              <div style={{ display: 'grid', gap: 8, fontSize: 13 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: 12 }}>
                  <span style={{ color: '#64748b', fontWeight: 600 }}>Complaint to Approval:</span>
                  <span style={{ color: '#0f172a', fontWeight: 700 }}>
                    {formatDuration(timeline.avgComplaintToApproval)}
                  </span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: 12 }}>
                  <span style={{ color: '#64748b', fontWeight: 600 }}>Approval to Mission Order:</span>
                  <span style={{ color: '#0f172a', fontWeight: 700 }}>
                    {formatDuration(timeline.avgApprovalToMO)}
                  </span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: 12 }}>
                  <span style={{ color: '#64748b', fontWeight: 600 }}>Total (Complaint to MO):</span>
                  <span style={{ color: timeline.targetMet ? '#22c55e' : '#ef4444', fontWeight: 700 }}>
                    {formatDuration(timeline.avgComplaintToMO)}
                    {timeline.targetMet && ' ✓ (Target: 2-3h)'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Inspections Section */}
      <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden' }}>
        <div
          onClick={() => setExpandedSection(expandedSection === 'inspections' ? null : 'inspections')}
          style={{
            padding: '16px 20px',
            background: '#0b2249',
            color: '#ffffff',
            cursor: 'pointer',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            userSelect: 'none',
          }}
        >
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 900 }}>Inspections</h3>
          <span style={{ fontSize: 20, fontWeight: 900 }}>
            {expandedSection === 'inspections' ? '−' : '+'}
          </span>
        </div>

        {expandedSection === 'inspections' && (
          <div style={{ padding: 20, display: 'grid', gap: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
              <div style={{ background: '#f8fafc', padding: 12, borderRadius: 8 }}>
                <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>Total</div>
                <div style={{ fontSize: 24, fontWeight: 900, color: '#0f172a' }}>{inspections.total}</div>
              </div>
              <div style={{ background: '#f8fafc', padding: 12, borderRadius: 8 }}>
                <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>Completed</div>
                <div style={{ fontSize: 24, fontWeight: 900, color: '#22c55e' }}>{inspections.byStatus.completed}</div>
              </div>
              <div style={{ background: '#f8fafc', padding: 12, borderRadius: 8 }}>
                <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>In Progress</div>
                <div style={{ fontSize: 24, fontWeight: 900, color: '#2563eb' }}>{inspections.byStatus.inProgress}</div>
              </div>
              <div style={{ background: '#f8fafc', padding: 12, borderRadius: 8 }}>
                <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>Pending</div>
                <div style={{ fontSize: 24, fontWeight: 900, color: '#f59e0b' }}>{inspections.byStatus.pending}</div>
              </div>
              <div style={{ background: '#f8fafc', padding: 12, borderRadius: 8 }}>
                <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>Completion Rate</div>
                <div style={{ fontSize: 24, fontWeight: 900, color: '#0f172a' }}>{inspections.completionRate}%</div>
              </div>
            </div>

            <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', marginBottom: 8 }}>
                Inspection Duration
              </div>
              <div style={{ display: 'grid', gap: 8, fontSize: 13 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: 12 }}>
                  <span style={{ color: '#64748b', fontWeight: 600 }}>Average Duration:</span>
                  <span style={{ color: '#0f172a', fontWeight: 700 }}>
                    {formatMinutes(inspections.avgDuration)}
                  </span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: 12 }}>
                  <span style={{ color: '#64748b', fontWeight: 600 }}>Target Compliance (5-10m):</span>
                  <span style={{ color: inspections.targetCompliance >= 80 ? '#22c55e' : '#f59e0b', fontWeight: 700 }}>
                    {inspections.targetCompliance}%
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

    </div>
  );
}
