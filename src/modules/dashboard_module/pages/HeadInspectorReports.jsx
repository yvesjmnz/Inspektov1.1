import React, { useEffect, useState } from 'react';
import { getHeadInspectorMetrics } from '../../../lib/reports/metricsService';
import './Dashboard.css';

function formatDuration(hours) {
  if (hours === null || hours === undefined) return '—';
  // Handle negative values (data integrity issue)
  if (hours < 0) return '—';
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

export default function HeadInspectorReports() {
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
        const data = await getHeadInspectorMetrics(dateRange);
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

  const { missionOrders, inspections, assignments, performance, timeline, complaintToMOPreapproval } = metrics;

  return (
    <div style={{ display: 'grid', gap: 24 }}>
      {/* Header */}
      <div style={{ display: 'grid', gap: 8 }}>
        <h2 style={{ margin: 0, fontSize: 24, fontWeight: 900, color: '#0f172a' }}>
          Head Inspector Performance Report
        </h2>
        <p style={{ margin: 0, fontSize: 14, color: '#64748b' }}>
          Mission order workflow and inspection performance metrics
        </p>
      </div>

      {/* KPI Cards - Overview */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>
            Total Mission Orders
          </div>
          <div style={{ fontSize: 32, fontWeight: 900, color: '#0f172a', marginBottom: 4 }}>
            {missionOrders.total}
          </div>
          <div style={{ fontSize: 13, color: '#64748b' }}>
            {missionOrders.byStatus.forInspection} ready for inspection
          </div>
        </div>

        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>
            Total Inspections
          </div>
          <div style={{ fontSize: 32, fontWeight: 900, color: '#0f172a', marginBottom: 4 }}>
            {inspections.total}
          </div>
          <div style={{ fontSize: 13, color: '#64748b' }}>
            {inspections.byStatus.completed} completed
          </div>
        </div>

        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>
            Completion Rate
          </div>
          <div style={{ fontSize: 32, fontWeight: 900, color: '#22c55e', marginBottom: 4 }}>
            {inspections.completionRate}%
          </div>
          <div style={{ fontSize: 13, color: '#64748b' }}>
            Of all inspections
          </div>
        </div>

        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>
            Avg Inspection Time
          </div>
          <div style={{ fontSize: 32, fontWeight: 900, color: '#2563eb', marginBottom: 4 }}>
            {formatMinutes(inspections.avgDuration)}
          </div>
          <div style={{ fontSize: 13, color: '#64748b' }}>
            Target: 5-10 minutes
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
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 900 }}>Mission Order Workflow</h3>
          <span style={{ fontSize: 20, fontWeight: 900 }}>
            {expandedSection === 'mission-orders' ? '−' : '+'}
          </span>
        </div>

        {expandedSection === 'mission-orders' && (
          <div style={{ padding: 20, display: 'grid', gap: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
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
            </div>

            <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', marginBottom: 8 }}>
                Average Creation Time
              </div>
              <div style={{ fontSize: 13, color: '#64748b' }}>
                From complaint approval to mission order creation:
              </div>
              <div style={{ fontSize: 24, fontWeight: 900, color: '#2563eb', marginTop: 8 }}>
                {formatDuration(missionOrders.avgCreationTime)}
              </div>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
                Target: 2-3 hours
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
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 900 }}>Inspection Performance</h3>
          <span style={{ fontSize: 20, fontWeight: 900 }}>
            {expandedSection === 'inspections' ? '−' : '+'}
          </span>
        </div>

        {expandedSection === 'inspections' && (
          <div style={{ padding: 20, display: 'grid', gap: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
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
            </div>

            <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', marginBottom: 12 }}>
                Duration Analysis
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

      {/* Inspector Performance Section */}
      <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden' }}>
        <div
          onClick={() => setExpandedSection(expandedSection === 'performance' ? null : 'performance')}
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
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 900 }}>Inspector Performance</h3>
          <span style={{ fontSize: 20, fontWeight: 900 }}>
            {expandedSection === 'performance' ? '−' : '+'}
          </span>
        </div>

        {expandedSection === 'performance' && (
          <div style={{ padding: 20 }}>
            {performance.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 20, color: '#64748b' }}>
                No inspector performance data available
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 12 }}>
                {performance.map((inspector, idx) => (
                  <div
                    key={inspector.inspectorId}
                    style={{
                      background: '#f8fafc',
                      border: '1px solid #e2e8f0',
                      borderRadius: 8,
                      padding: 12,
                      display: 'grid',
                      gap: 12,
                    }}
                  >
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, alignItems: 'center' }}>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>
                          Inspector {idx + 1}
                        </div>
                        <div style={{ fontSize: 12, color: '#64748b' }}>
                          ID: {String(inspector.inspectorId).slice(0, 8)}...
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 18, fontWeight: 900, color: '#2563eb' }}>
                          {inspector.completed}/{inspector.total}
                        </div>
                        <div style={{ fontSize: 12, color: '#64748b' }}>
                          Completed
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, fontSize: 12 }}>
                      <div>
                        <div style={{ color: '#64748b', marginBottom: 4 }}>Completion Rate</div>
                        <div style={{ fontWeight: 700, color: '#0f172a' }}>
                          {inspector.completionRate}%
                        </div>
                      </div>
                      <div>
                        <div style={{ color: '#64748b', marginBottom: 4 }}>Avg Duration</div>
                        <div style={{ fontWeight: 700, color: '#0f172a' }}>
                          {formatMinutes(inspector.avgDuration)}
                        </div>
                      </div>
                      <div>
                        <div style={{ color: '#64748b', marginBottom: 4 }}>In Progress</div>
                        <div style={{ fontWeight: 700, color: '#f59e0b' }}>
                          {inspector.inProgress}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Assignments Section */}
      <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', marginBottom: 8 }}>
          Mission Order Assignments
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
          <div style={{ background: '#f8fafc', padding: 12, borderRadius: 8 }}>
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>Total Assignments</div>
            <div style={{ fontSize: 24, fontWeight: 900, color: '#0f172a' }}>{assignments.total}</div>
          </div>
          <div style={{ background: '#f8fafc', padding: 12, borderRadius: 8 }}>
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>Inspectors</div>
            <div style={{ fontSize: 24, fontWeight: 900, color: '#0f172a' }}>{assignments.byInspector.length}</div>
          </div>
          <div style={{ background: '#f8fafc', padding: 12, borderRadius: 8 }}>
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>Avg per Inspector</div>
            <div style={{ fontSize: 24, fontWeight: 900, color: '#0f172a' }}>{assignments.avgPerInspector}</div>
          </div>
        </div>
      </div>

      {/* Key Metrics Summary */}
      <div style={{ background: '#f0f9ff', border: '1px solid #bfdbfe', borderRadius: 12, padding: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#1e40af', marginBottom: 12 }}>
          Key Performance Indicators
        </div>
        <div style={{ display: 'grid', gap: 8, fontSize: 13 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: 12 }}>
            <span style={{ color: '#1e40af', fontWeight: 600 }}>Inspection Target Compliance:</span>
            <span style={{ color: '#0f172a', fontWeight: 700 }}>
              {inspections.targetCompliance}% (Target: 5-10 minutes)
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: 12 }}>
            <span style={{ color: '#1e40af', fontWeight: 600 }}>Avg Inspection Duration:</span>
            <span style={{ color: '#0f172a', fontWeight: 700 }}>
              {formatMinutes(inspections.avgDuration)}
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: 12 }}>
            <span style={{ color: '#1e40af', fontWeight: 600 }}>Overall Completion Rate:</span>
            <span style={{ color: '#0f172a', fontWeight: 700 }}>
              {inspections.completionRate}%
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
