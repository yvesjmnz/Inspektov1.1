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
  const [showComplaintSideBySide, setShowComplaintSideBySide] = useState(false);

  const [complaint, setComplaint] = useState(null);
  const [complaintLoading, setComplaintLoading] = useState(false);
  const [complaintError, setComplaintError] = useState('');

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

      // Load assignments.
      // In many Supabase setups, RLS can allow INSERT/DELETE but accidentally block SELECT,
      // which makes the UI think there are no assignments.
      // We therefore:
      // 1) Try to fetch assignments from mission_order_assignments.
      // 2) Fallback to mission_orders.assigned_inspector_ids if present.
      // 3) Finally, as a last-resort, infer from the MO HTML auto-field markers.
      const { data: assignedRows, error: assignedError } = await supabase
        .from('mission_order_assignments')
        .select('inspector_id, assigned_at')
        .eq('mission_order_id', missionOrderId)
        .order('assigned_at', { ascending: true });

      let assignedIds = [];

      if (!assignedError) {
        assignedIds = (assignedRows || []).map((r) => r.inspector_id).filter(Boolean);
      }

      // Fallback #1: if the schema has a denormalized column.
      if (assignedIds.length === 0) {
        const maybe = mo?.assigned_inspector_ids;
        if (Array.isArray(maybe)) assignedIds = maybe.filter(Boolean);
      }

      // Fallback #2: parse from stored HTML if it contains the inspector names list.
      // This is best-effort only and prevents a false-negative block on approval.
      if (assignedIds.length === 0 && mo?.content) {
        const m = String(mo.content).match(/data-mo-auto="inspectors"[^>]*>([\s\S]*?)<\/span>/i);
        if (m?.[1]) {
          const text = m[1].replace(/<[^>]+>/g, '').trim();
          if (text) {
            const nameSet = new Set(
              text
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean)
            );
            assignedIds = (inspectorsData || [])
              .filter((p) => nameSet.has(String(p.full_name || '').trim()))
              .map((p) => p.id);
          }
        }
      }

      // If SELECT is blocked by RLS, surface a warning but still allow approval when we have an alternate source.
      if (assignedError && assignedIds.length === 0) {
        // Don't hard-fail page load; allow director to see the mission order.
        // The approve handler will still block if we truly can't determine any assignments.
        // eslint-disable-next-line no-console
        console.warn('Failed to load mission_order_assignments (possible RLS):', assignedError);
      }

      setMissionOrder(mo);
      setInspectors(inspectorsData || []);
      setAssignedInspectorIds(assignedIds);

      // Best-effort complaint side panel data (read-only)
      if (mo?.complaint_id) {
        try {
          setComplaintError('');
          setComplaintLoading(true);
          const { data: complaintData, error: complaintLoadError } = await supabase
            .from('complaints')
            .select('*')
            .eq('id', mo.complaint_id)
            .single();
          if (complaintLoadError) throw complaintLoadError;
          setComplaint(complaintData);
        } catch (ce) {
          setComplaint(null);
          setComplaintError(ce?.message || 'Failed to load complaint details.');
        } finally {
          setComplaintLoading(false);
        }
      } else {
        setComplaint(null);
      }

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

      setToast(nextStatus === 'for inspection' ? 'Mission order approved.' : 'Mission order rejected.');
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

    // DB constraint allows: draft | issued | cancelled | for inspection
    // "for inspection" is treated as "Director-approved / ready for inspectors".
    await updateMissionOrderDecision('for inspection');
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
                style={{ background: '#dc2626' }}
              >
                {savingDecision ? 'Saving…' : 'Reject'}
              </button>
            </div>
          </div>

          {toast ? <div className="mo-alert mo-alert-success">{toast}</div> : null}
          {error ? <div className="mo-alert mo-alert-error">{error}</div> : null}

          
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: showComplaintSideBySide ? 'minmax(0, 3fr) minmax(0, 2fr)' : 'minmax(0, 1fr)',
              gap: showComplaintSideBySide ? 14 : 0,
              alignItems: 'start',
              marginTop: 14,
              transition: 'grid-template-columns 0.3s ease-in-out',
            }}
          >
            <div>
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
                  background: '#fff',
                  color: '#0f172a',
                  padding: 12,
                  outline: 'none',
                  fontSize: 14,
                }}
              />
              <div className="mo-meta" style={{ marginTop: 6 }}>
                Tip: Rejection requires a comment for auditability.
              </div>

              {/* Fixed toggle location (muscle-memory): right above the preview area */}
              <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="mo-btn"
                  onClick={() => setShowComplaintSideBySide((v) => !v)}
                  disabled={loading || savingDecision}
                  title="Toggle complaint details side panel"
                  style={{
                    background: 'transparent',
                    color: '#2563eb',
                    border: '1px solid #2563eb',
                  }}
                >
                  {showComplaintSideBySide ? 'Hide Complaint' : 'Show Complaint'}
                </button>
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
            </div>

            {showComplaintSideBySide ? (
              <aside
                style={{
                  background: '#fff',
                  border: '1px solid #e2e8f0',
                  borderRadius: 12,
                  padding: 12,
                }}
                aria-label="Complaint Details"
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
                  <div style={{ fontWeight: 900, color: '#0f172a' }}>Complaint Details</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    {complaint?.authenticity_level ? (
                      <span
                        style={{
                          padding: '4px 8px',
                          borderRadius: 999,
                          fontSize: 12,
                          fontWeight: 900,
                          border: '1px solid #e2e8f0',
                          background:
                            String(complaint.authenticity_level).toLowerCase() === 'urgent' ? '#fee2e2' : '#e0f2fe',
                          color: String(complaint.authenticity_level).toLowerCase() === 'urgent' ? '#991b1b' : '#075985',
                        }}
                        title="Urgency"
                      >
                        {complaint.authenticity_level}
                      </span>
                    ) : null}
                    <div style={{ color: '#64748b', fontWeight: 800, fontSize: 12 }}>
                      {missionOrder?.complaint_id ? `ID: ${missionOrder.complaint_id}` : 'No complaint linked'}
                    </div>
                  </div>
                </div>

                <div style={{ height: 1, background: '#f1f5f9', margin: '10px 0' }} />

                {complaintLoading ? <div className="mo-meta">Loading complaint…</div> : null}
                {complaintError ? <div className="mo-alert mo-alert-error">{complaintError}</div> : null}

                {!missionOrder?.complaint_id ? (
                  <div className="mo-meta">This mission order does not reference a complaint.</div>
                ) : !complaint && !complaintLoading ? (
                  <div className="mo-meta">No complaint record found.</div>
                ) : complaint ? (
                  <div style={{ display: 'grid', gap: 10 }}>
                    <div>
                      <div style={{ color: '#0f172a', fontWeight: 900, fontSize: 12 }}>Business</div>
                      <div style={{ fontWeight: 900, color: '#0f172a' }}>{complaint.business_name || '—'}</div>
                      <div style={{ color: '#475569', fontWeight: 800, fontSize: 12 }}>
                        {complaint.business_address || '—'}
                      </div>
                    </div>

                    <div>
                      <div style={{ color: '#0f172a', fontWeight: 900, fontSize: 12 }}>Description</div>
                      <div style={{ whiteSpace: 'pre-wrap', color: '#0f172a', fontWeight: 700, fontSize: 13 }}>
                        {complaint.complaint_description || '—'}
                      </div>
                    </div>

                    <div style={{ display: 'grid', gap: 6 }}>
                      <div style={{ color: '#0f172a', fontWeight: 900, fontSize: 12 }}>Evidence</div>
                      {Array.isArray(complaint.image_urls) && complaint.image_urls.length > 0 ? (
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {complaint.image_urls.slice(0, 6).map((url) => (
                            <a
                              key={url}
                              href={url}
                              target="_blank"
                              rel="noreferrer"
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                height: 30,
                                padding: '0 10px',
                                borderRadius: 10,
                                border: '1px solid #bfdbfe',
                                background: '#eff6ff',
                                color: '#1d4ed8',
                                fontWeight: 900,
                                textDecoration: 'none',
                                fontSize: 12,
                              }}
                            >
                              View
                            </a>
                          ))}
                        </div>
                      ) : (
                        <div className="mo-meta">No images</div>
                      )}
                    </div>

                    <div style={{ display: 'grid', gap: 6, gridTemplateColumns: '1fr 1fr' }}>
                      <div style={{ color: '#64748b', fontWeight: 800, fontSize: 12 }}>Reporter Email</div>
                      <div style={{ color: '#0f172a', fontWeight: 800, fontSize: 12 }}>
                        {complaint.reporter_email || '—'}
                      </div>
                    </div>

                    <div style={{ display: 'grid', gap: 6 }}>
                      <div style={{ color: '#0f172a', fontWeight: 900, fontSize: 12 }}>Submitted</div>
                      <div style={{ color: '#0f172a', fontWeight: 800, fontSize: 12 }}>
                        {complaint.created_at ? new Date(complaint.created_at).toLocaleString() : '—'}
                      </div>
                    </div>
                  </div>
                ) : null}

                {missionOrder?.complaint_id ? (
                  <div style={{ marginTop: 10 }}>
                    <a className="mo-link" href={`/complaints/view?id=${missionOrder.complaint_id}`} target="_blank" rel="noreferrer">
                      Open full complaint
                    </a>
                  </div>
                ) : null}
              </aside>
            ) : null}
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
