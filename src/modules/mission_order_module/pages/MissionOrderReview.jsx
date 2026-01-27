import { useEffect, useMemo, useRef, useState } from 'react';
import Header from '../../../components/Header';
import Footer from '../../../components/Footer';
import { supabase } from '../../../lib/supabase';
import '../pages/MissionOrderEditor.css';

function getMissionOrderIdFromQuery() {
  const params = new URLSearchParams(window.location.search);
  return params.get('id');
}

function formatStatus(status) {
  if (!status) return 'Unknown';
  return String(status)
    .replace(/_/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function MissionOrderReview() {
  const missionOrderId = useMemo(() => getMissionOrderIdFromQuery(), []);

  const [loading, setLoading] = useState(false);
  const [savingDecision, setSavingDecision] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  const [missionOrder, setMissionOrder] = useState(null);
  const [inspectors, setInspectors] = useState([]);
  const [assignedInspectorIds, setAssignedInspectorIds] = useState([]);

  const [directorComment, setDirectorComment] = useState('');

  const previewRef = useRef(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const load = async () => {
    if (!missionOrderId) {
      setError('Missing mission order id. Open this page as /mission-order/review?id=<uuid>');
      return;
    }

    setError('');
    setLoading(true);

    try {
      const { data: mo, error: moError } = await supabase
        .from('mission_orders')
        .select(
          'id, title, content, status, complaint_id, created_at, updated_at, submitted_at, submitted_by, reviewed_at, reviewed_by, director_comment, created_by'
        )
        .eq('id', missionOrderId)
        .single();

      if (moError) throw moError;

      const { data: inspectorsData, error: inspectorsError } = await supabase
        .from('profiles')
        .select('id, full_name, role')
        .eq('role', 'inspector')
        .order('full_name', { ascending: true });

      if (inspectorsError) throw inspectorsError;

      const { data: assignedRows, error: assignedError } = await supabase
        .from('mission_order_assignments')
        .select('id, inspector_id, assigned_at')
        .eq('mission_order_id', missionOrderId)
        .order('assigned_at', { ascending: true });

      if (assignedError) throw assignedError;

      setMissionOrder(mo);
      setInspectors(inspectorsData || []);
      setAssignedInspectorIds((assignedRows || []).map((r) => r.inspector_id));

      // Load existing director comment if you already have a column for it.
      // If not present, keep UI-only.
      setDirectorComment(mo?.director_comment || '');

      // Render HTML safely (this app stores MO content as HTML; we assume only trusted users can edit it)
      if (previewRef.current) {
        previewRef.current.innerHTML = mo?.content || '';
      }
    } catch (e) {
      setError(e?.message || 'Failed to load mission order.');
      setMissionOrder(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missionOrderId]);

  // Best-effort realtime refresh for decision state/edits
  useEffect(() => {
    if (!missionOrderId) return;

    const channel = supabase
      .channel(`mo-review-${missionOrderId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'mission_orders', filter: `id=eq.${missionOrderId}` },
        () => {
          load().catch(() => {});
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'mission_order_assignments',
          filter: `mission_order_id=eq.${missionOrderId}`,
        },
        () => {
          load().catch(() => {});
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missionOrderId]);

  const assignedInspectorNames = useMemo(() => {
    return assignedInspectorIds
      .map((id) => inspectors.find((x) => x.id === id)?.full_name)
      .filter(Boolean)
      .join(', ');
  }, [assignedInspectorIds, inspectors]);

  const requireReviewableState = () => {
    const s = String(missionOrder?.status || '').toLowerCase();
    // DB constraint only allows: draft | issued | cancelled | completed
    // "issued" is treated as the Director-review queue state.
    return ['issued'].includes(s);
  };

  const updateMissionOrderDecision = async (nextStatus) => {
    if (!missionOrderId) return;

    setError('');
    setToast('');
    setSavingDecision(true);

    try {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      const userId = userData?.user?.id;
      if (!userId) throw new Error('Not authenticated. Please login again.');

      const nowIso = new Date().toISOString();

      // Industry-standard approach: store decision + actor + timestamp.
      // Columns are assumed. If they don't exist, DB must be updated.
      const patch = {
        status: nextStatus,
        director_comment: directorComment || null,
        reviewed_by: userId,
        reviewed_at: nowIso,
        updated_at: nowIso,
      };

      const { error: updateError } = await supabase.from('mission_orders').update(patch).eq('id', missionOrderId);
      if (updateError) throw updateError;

      setToast(nextStatus === 'completed' ? 'Mission order approved.' : 'Mission order rejected.');
      await load();
    } catch (e) {
      setError(e?.message || 'Failed to save decision.');
    } finally {
      setSavingDecision(false);
    }
  };

  const handleApprove = async () => {
    if (!requireReviewableState()) {
      setToast('This mission order is not in a reviewable state.');
      return;
    }

    if (assignedInspectorIds.length === 0) {
      setError('Cannot approve: no inspectors assigned.');
      return;
    }

    // There is no "approved" status in the current DB constraint.
    // "completed" is treated as "Director-approved/finalized" in this workflow.
    await updateMissionOrderDecision('completed');
  };

  const handleReject = async () => {
    if (!requireReviewableState()) {
      setToast('This mission order is not in a reviewable state.');
      return;
    }

    if (!directorComment.trim()) {
      setError('Please provide a comment/instructions before rejecting.');
      return;
    }

    // There is no "rejected" status in the current DB constraint.
    // "cancelled" is treated as "Director-rejected" in this workflow.
    await updateMissionOrderDecision('cancelled');
  };

  return (
    <div className="mo-container">
      <Header />
      <main className="mo-main">
        <section className="mo-card">
          <div className="mo-header">
            <div className="mo-title-wrap">
              <div className="mo-label">Mission Order (Director Review)</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ fontWeight: 900, fontSize: 16, color: '#0f172a' }}>{missionOrder?.title || '—'}</div>
                <div className="mo-meta">
                  <span>MO ID: {missionOrderId ? `${missionOrderId.slice(0, 8)}…` : '—'}</span>
                  <span style={{ marginLeft: 10 }}>Status: {formatStatus(missionOrder?.status)}</span>
                </div>
              </div>
            </div>

            <div className="mo-actions">
              <a className="mo-link" href="/dashboard/director">
                Back
              </a>
              <button
                type="button"
                className="mo-btn mo-btn-primary"
                onClick={handleApprove}
                disabled={loading || savingDecision || !missionOrder || !requireReviewableState()}
                title={!requireReviewableState() ? 'Not in a reviewable status.' : 'Approve this mission order.'}
              >
                {savingDecision ? 'Saving…' : 'Approve'}
              </button>
              <button
                type="button"
                className="mo-btn"
                onClick={handleReject}
                disabled={loading || savingDecision || !missionOrder || !requireReviewableState()}
                title={!requireReviewableState() ? 'Not in a reviewable status.' : 'Reject this mission order.'}
              >
                {savingDecision ? 'Saving…' : 'Reject'}
              </button>
            </div>
          </div>

          {toast ? <div className="mo-alert mo-alert-success">{toast}</div> : null}
          {error ? <div className="mo-alert mo-alert-error">{error}</div> : null}

          <div className="mo-assignments" style={{ marginTop: 14 }}>
            <div className="mo-meta" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <span style={{ fontWeight: 800 }}>Assigned Inspectors:</span>
              {assignedInspectorIds.length === 0 ? (
                <span style={{ color: '#64748b' }}>None</span>
              ) : (
                <span style={{ color: '#0f172a', fontWeight: 900 }}>{assignedInspectorNames}</span>
              )}
            </div>
          </div>

          <div style={{ marginTop: 14 }}>
            <label className="mo-label" htmlFor="directorComment">
              Director Comments / Instructions
            </label>
            <textarea
              id="directorComment"
              value={directorComment}
              onChange={(e) => setDirectorComment(e.target.value)}
              placeholder="Add comments or specific instructions for the Head Inspector / assigned inspectors..."
              disabled={loading || savingDecision}
              style={{
                width: '100%',
                minHeight: 110,
                borderRadius: 12,
                border: '1px solid #cbd5e1',
                padding: 12,
                outline: 'none',
                fontSize: 14,
              }}
            />
            <div className="mo-meta" style={{ marginTop: 6 }}>
              Tip: Rejection requires a comment for auditability.
            </div>
          </div>

          <div className="mo-editor-wrap" aria-label="Mission Order Preview">
            <div
              ref={previewRef}
              className="mo-editor"
              contentEditable={false}
              suppressContentEditableWarning
              style={{ cursor: 'default' }}
            />
          </div>

          <div className="mo-note">
            Director review is read-only. Approve/reject changes the mission order status and stores your comments.
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
