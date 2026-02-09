import { useEffect, useMemo, useState } from 'react';
import Header from '../../../components/Header';
import Footer from '../../../components/Footer';
import { supabase } from '../../../lib/supabase';
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

export default function InspectorInspectionDetails() {
  const missionOrderId = useMemo(() => getMissionOrderIdFromQuery(), []);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [missionOrder, setMissionOrder] = useState(null);
  const [complaint, setComplaint] = useState(null);

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

      setMissionOrder(mo);
      setComplaint(c);
    } catch (e) {
      setError(e?.message || 'Failed to load inspection details.');
      setMissionOrder(null);
      setComplaint(null);
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
            <div className="dash-actions">
              <a className="dash-link" href="/dashboard/inspector">
                Back to Assigned Inspections
              </a>
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
