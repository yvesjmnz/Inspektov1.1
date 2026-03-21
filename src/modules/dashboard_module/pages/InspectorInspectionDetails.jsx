import { useEffect, useMemo, useState } from 'react';
import Header from '../../../components/Header';
import Footer from '../../../components/Footer';
import { supabase } from '../../../lib/supabase';
import { pickPreferredInspectionReport } from '../../../lib/inspectionReports';
import './Dashboard.css';

function getMissionOrderIdFromQuery() {
  const params = new URLSearchParams(window.location.search);
  return params.get('id');
}

function formatStatus(status) {
  if (!status) return 'Unknown';
  const s = String(status || '').toLowerCase();
  // MO status rename: completed -> for inspection
  if (s === 'completed' || s === 'for_inspection' || s === 'for inspection') return 'For Inspection';

  return String(status)
    .replace(/_/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function statusBadgeClass(status) {
  const s = String(status || '').toLowerCase();
  if (['completed', 'approved'].includes(s)) return 'status-badge status-success';
  if (['cancelled', 'declined', 'rejected', 'invalid'].includes(s)) return 'status-badge status-danger';
  if (['issued', 'submitted', 'pending', 'new'].includes(s)) return 'status-badge status-warning';
  if (['on hold', 'on_hold', 'hold'].includes(s)) return 'status-badge status-info';
  return 'status-badge';
}

// Live inspection pacing hook, driven by inspection_reports.started_at / completed_at
function useInspectionPace({ status, startedAt, completedAt }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!startedAt || String(status || '').toLowerCase().indexOf('in progress') === -1) return;

    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [startedAt, status]);

  const startMs = startedAt ? new Date(startedAt).getTime() : null;
  const endMs =
    String(status || '').toLowerCase().indexOf('in progress') !== -1 || !completedAt
      ? now
      : new Date(completedAt).getTime();

  let elapsedMinutes = 0;
  if (startMs && endMs && endMs > startMs) {
    elapsedMinutes = Math.floor((endMs - startMs) / 60000);
  }

  const TARGET_MINUTES = 42;
  const overByMinutes = Math.max(0, elapsedMinutes - TARGET_MINUTES);

  let phase = 'green';
  if (elapsedMinutes >= 42) {
    phase = 'red';
  } else if (elapsedMinutes >= 31) {
    phase = 'yellow';
  }

  const rawPercent = (elapsedMinutes / TARGET_MINUTES) * 100;
  const percentOfTarget = Math.max(0, Math.min(rawPercent, 160));

  const color =
    phase === 'green'
      ? '#22c55e'
      : phase === 'yellow'
        ? '#eab308'
        : '#ef4444';

  return {
    elapsedMinutes,
    overByMinutes,
    phase,
    color,
    percentOfTarget,
  };
}

function InspectionPaceWidget({ status, startedAt, completedAt }) {
  const { elapsedMinutes, overByMinutes, phase, color, percentOfTarget } = useInspectionPace({
    status,
    startedAt,
    completedAt,
  });

  if (!startedAt) return null;

  const label =
    phase === 'green'
      ? 'On Track'
      : phase === 'yellow'
        ? 'Approaching Limit'
        : 'Target Exceeded';

  const overLabel = overByMinutes > 0 ? `+${overByMinutes}m` : '';

  return (
    <div
      className="pace-widget"
      style={{
        minWidth: 220,
        padding: 12,
        borderRadius: 12,
        background: '#0f172a',
        color: '#e5e7eb',
        boxShadow: '0 8px 20px rgba(15,23,42,0.35)',
      }}
    >
      <div
        style={{
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: '#9ca3af',
          marginBottom: 4,
        }}
      >
        Pace
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 8,
          marginBottom: 6,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 22, fontWeight: 900, color: '#f9fafb' }}>{elapsedMinutes}m</span>
          <span style={{ fontSize: 12, fontWeight: 600, color }}>
            {label} {overLabel && <span style={{ marginLeft: 4 }}>{overLabel}</span>}
          </span>
        </div>
        <div
          style={{
            padding: '3px 8px',
            borderRadius: 999,
            border: `1px solid ${color}`,
            fontSize: 11,
            fontWeight: 800,
            color,
            background: 'rgba(15,23,42,0.7)',
          }}
        >
          Target: 42m
        </div>
      </div>

      <div
        style={{
          width: '100%',
          height: 8,
          borderRadius: 999,
          background: '#020617',
          overflow: 'hidden',
        }}
        aria-label="Inspection pacing progress"
      >
        <div
          style={{
            height: '100%',
            width: `${percentOfTarget}%`,
            maxWidth: '100%',
            background: color,
            transition: 'width 0.3s ease-out, background 0.2s ease-out',
          }}
        />
      </div>
    </div>
  );
}

export default function InspectorInspectionDetails() {
  const missionOrderId = useMemo(() => getMissionOrderIdFromQuery(), []);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [missionOrder, setMissionOrder] = useState(null);
  const [complaint, setComplaint] = useState(null);
  const [inspectionReport, setInspectionReport] = useState(null);

  const handleLogout = async () => {
    setError('');
    try {
      await supabase.auth.signOut({ scope: 'global' });
    } finally {
      try {
        localStorage.clear();
        sessionStorage.clear();
      } catch {
        // ignore
      }
      window.location.replace('/login');
    }
  };

  const load = async () => {
    if (!missionOrderId) {
      setError('Missing mission order id. Open this page as /dashboard/inspector/inspection?id=<uuid>');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // Confirm current user is assigned to this mission order.
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      const userId = userData?.user?.id;
      if (!userId) throw new Error('Not authenticated. Please login again.');

      const { data: assignment, error: assignmentError } = await supabase
        .from('mission_order_assignments')
        .select('mission_order_id, inspector_id')
        .eq('mission_order_id', missionOrderId)
        .eq('inspector_id', userId)
        .limit(1);

      if (assignmentError) throw assignmentError;
      if (!assignment || assignment.length === 0) {
        throw new Error('You are not assigned to this mission order.');
      }

      const { data: mo, error: moError } = await supabase
        .from('mission_orders')
        .select('id, title, content, status, complaint_id, created_at, updated_at, submitted_at')
        .eq('id', missionOrderId)
        .single();

      if (moError) throw moError;

      const { data: c, error: cError } = mo?.complaint_id
        ? await supabase
            .from('complaints')
            .select(
              [
                'id',
                'business_name',
                'business_address',
                'complaint_description',
                'reporter_email',
                'created_at',
                'status',
              ].join(', ')
            )
            .eq('id', mo.complaint_id)
            .single()
        : { data: null, error: null };

      if (cError) throw cError;

      // Load the single report that currently owns this mission order, if any.
      const { data: reportRows, error: reportError } = await supabase
        .from('inspection_reports')
        .select('id, inspector_id, status, started_at, completed_at, updated_at, created_at')
        .eq('mission_order_id', missionOrderId)
        .order('updated_at', { ascending: false })
        .limit(50);

      if (reportError) throw reportError;

      setMissionOrder(mo);
      setComplaint(c);
      setInspectionReport(pickPreferredInspectionReport(reportRows || []));
    } catch (e) {
      setError(e?.message || 'Failed to load inspection details.');
      setMissionOrder(null);
      setComplaint(null);
      setInspectionReport(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missionOrderId]);

  // Realtime: if MO or complaint changes, refresh.
  useEffect(() => {
    if (!missionOrderId) return;

    const channel = supabase
      .channel(`inspector-inspection-${missionOrderId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'mission_orders', filter: `id=eq.${missionOrderId}` },
        () => load()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'inspection_reports', filter: `mission_order_id=eq.${missionOrderId}` },
        () => load()
      )
      .subscribe();

    return () => {
      try {
        supabase.removeChannel(channel);
      } catch {
        // ignore
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missionOrderId]);

  const mapUrl = useMemo(() => {
    const address = complaint?.business_address || '';
    if (!address) return null;
    return `https://www.google.com/maps?q=${encodeURIComponent(address)}&output=embed`;
  }, [complaint?.business_address]);

  return (
    <div className="dash-container">
      <Header />
      <main className="dash-main">
        <section className="dash-card">
          <div className="dash-header">
            <div>
              <h2 className="dash-title">Inspection Details</h2>
              <p className="dash-subtitle">Mission order + business details for your assigned inspection.</p>
            </div>
            <div className="dash-actions" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {inspectionReport?.started_at && String(inspectionReport?.status || '').toLowerCase().includes('in progress') ? (
                <InspectionPaceWidget
                  status={inspectionReport.status}
                  startedAt={inspectionReport.started_at}
                  completedAt={inspectionReport.completed_at}
                />
              ) : null}
              <button className="dash-logout" type="button" onClick={handleLogout}>
                Logout
              </button>
            </div>
          </div>

          {error ? <div className="dash-alert dash-alert-error">{error}</div> : null}

          <div className="dash-grid" style={{ gridTemplateColumns: '1fr' }}>
            <div className="dash-tile">
              <h3>Mission Order</h3>
              <div className="dash-cell-sub" style={{ marginTop: 6 }}>
                <strong>ID:</strong> {missionOrderId ? `${String(missionOrderId).slice(0, 8)}…` : '—'}
              </div>
              <div className="dash-cell-sub">
                <strong>Status:</strong>{' '}
                <span className={statusBadgeClass(missionOrder?.status)}>{formatStatus(missionOrder?.status)}</span>
              </div>
              <div className="dash-cell-sub">
                <strong>Title:</strong> {missionOrder?.title || '—'}
              </div>
              <div className="dash-cell-sub">
                <strong>Submitted:</strong> {missionOrder?.submitted_at ? new Date(missionOrder.submitted_at).toLocaleString() : '—'}
              </div>
              <div className="dash-cell-sub">
                <strong>Updated:</strong> {missionOrder?.updated_at ? new Date(missionOrder.updated_at).toLocaleString() : '—'}
              </div>

              <div className="dash-note" style={{ marginTop: 12 }}>
                Mission order preview is read-only for inspectors.
              </div>

              <div
                className="mo-editor-wrap"
                aria-label="Mission Order Preview"
                style={{ marginTop: 12, background: '#fff' }}
              >
                <div
                  className="mo-editor-preview"
                  dangerouslySetInnerHTML={{ __html: missionOrder?.content || '<p style="color:#64748b;">No content.</p>' }}
                />
              </div>
            </div>

            <div className="dash-tile">
              <h3>Business / Complaint Details</h3>
              <div className="dash-cell-sub" style={{ marginTop: 6 }}>
                <strong>Business Name:</strong> {complaint?.business_name || '—'}
              </div>
              <div className="dash-cell-sub">
                <strong>Address:</strong> {complaint?.business_address || '—'}
              </div>
              <div className="dash-cell-sub">
                <strong>Reporter Email:</strong> {complaint?.reporter_email || '—'}
              </div>
              <div className="dash-cell-sub">
                <strong>Complaint ID:</strong> {complaint?.id ? `${String(complaint.id).slice(0, 8)}…` : '—'}
              </div>
              <div className="dash-cell-sub">
                <strong>Complaint Status:</strong>{' '}
                <span className={statusBadgeClass(complaint?.status)}>{formatStatus(complaint?.status)}</span>
              </div>
              <div className="dash-cell-sub">
                <strong>Submitted:</strong> {complaint?.created_at ? new Date(complaint.created_at).toLocaleString() : '—'}
              </div>

              <h4 style={{ marginTop: 14, marginBottom: 8, color: '#0f172a' }}>Complaint Description</h4>
              <div
                style={{
                  border: '1px solid #e2e8f0',
                  borderRadius: 10,
                  padding: 12,
                  background: '#f8fafc',
                  whiteSpace: 'pre-wrap',
                }}
              >
                {complaint?.complaint_description || '—'}
              </div>
            </div>

            <div className="dash-tile">
              <h3>Map Preview</h3>
              {!mapUrl ? (
                <div className="dash-note">No address available for map preview.</div>
              ) : (
                <div style={{ borderRadius: 12, overflow: 'hidden', border: '1px solid #e2e8f0', background: '#fff' }}>
                  <iframe
                    title="Business Location"
                    src={mapUrl}
                    width="100%"
                    height="320"
                    style={{ border: 0 }}
                    loading="lazy"
                    referrerPolicy="no-referrer-when-downgrade"
                  />
                </div>
              )}
            </div>
          </div>

          <div className="dash-note" style={{ marginTop: 14 }}>
            {loading ? 'Loading…' : ' '}
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
