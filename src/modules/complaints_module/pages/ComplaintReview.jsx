import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import '../../dashboard_module/pages/Dashboard.css';

function formatStatus(status) {
  if (!status) return 'Unknown';
  return String(status)
    .replace(/_/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function getUrgencyStyle(urgency) {
  const u = Number(urgency);
  if (u === 100) {
    return {
      badge: { background: '#dcfce7', border: '1px solid #22c55e', color: '#166534' },
    };
  }
  if (u === 50) {
    return {
      badge: { background: '#fef3c7', border: '1px solid #eab308', color: '#854d0e' },
    };
  }
  if (u === 25) {
    return {
      badge: { background: '#fee2e2', border: '1px solid #ef4444', color: '#991b1b' },
    };
  }
  return {
    badge: { background: '#e2e8f0', border: '1px solid #cbd5e1', color: '#334155' },
  };
}

function getComplaintIdFromQuery() {
  const params = new URLSearchParams(window.location.search);
  return params.get('id');
}

export default function ComplaintReview() {
  const complaintId = useMemo(() => getComplaintIdFromQuery(), []);

  const [loading, setLoading] = useState(false);
  const [savingDecision, setSavingDecision] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  const [complaint, setComplaint] = useState(null);
  const [previewImage, setPreviewImage] = useState(null);
  const [evidenceIndex, setEvidenceIndex] = useState(0);

  const [declineComment, setDeclineComment] = useState('');
  const [declineCommentError, setDeclineCommentError] = useState('');

  const [navCollapsed, setNavCollapsed] = useState(false);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const load = async () => {
    if (!complaintId) {
      setError('Missing complaint id. Open this page as /complaint/review?id=<uuid>');
      return;
    }

    setError('');
    setLoading(true);

    try {
      const { data, error: loadError } = await supabase
        .from('complaints')
        .select('*')
        .eq('id', complaintId)
        .single();

      if (loadError) throw loadError;

      setComplaint(data);
      setDeclineComment(data?.decline_comment || '');
      setEvidenceIndex(0);
    } catch (e) {
      setError(e?.message || 'Failed to load complaint.');
      setComplaint(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [complaintId]);

  // Real-time updates
  useEffect(() => {
    if (!complaintId) return;

    const channel = supabase
      .channel(`complaint-review-${complaintId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'complaints', filter: `id=eq.${complaintId}` },
        () => {
          load().catch(() => {});
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [complaintId]);

  const requireReviewableState = () => {
    const s = String(complaint?.status || '').toLowerCase();
    return ['submitted', 'pending', 'new'].includes(s);
  };

  const updateComplaintStatus = async (newStatus) => {
    if (!complaintId) return;

    setError('');
    setDeclineCommentError('');
    setSavingDecision(true);

    try {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;

      const user = userData?.user;
      if (!user) {
        throw new Error('Not authenticated. Please login again.');
      }

      const status = String(newStatus).toLowerCase();
      const nowIso = new Date().toISOString();

      // Enforce required rationale for declines
      if (status === 'declined') {
        const comment = declineComment.trim();
        if (!comment) {
          setDeclineCommentError('Comment is required to decline a complaint.');
          throw new Error('Comment is required to decline a complaint.');
        }
      }

      const patch = { status };

      if (status === 'approved') {
        patch.approved_by = user.id;
        patch.approved_at = nowIso;
        patch.declined_by = null;
        patch.declined_at = null;
        patch.decline_comment = null;
      } else if (status === 'declined') {
        patch.declined_by = user.id;
        patch.declined_at = nowIso;
        patch.approved_by = null;
        patch.approved_at = null;
        patch.decline_comment = declineComment.trim();
      }

      patch.updated_at = nowIso;

      const { error: updateError } = await supabase
        .from('complaints')
        .update(patch)
        .eq('id', complaintId);

      if (updateError) throw updateError;

      setToast(status === 'approved' ? 'Complaint approved.' : 'Complaint declined.');
      await load();
    } catch (e) {
      setError(e?.message || 'Failed to save decision.');
    } finally {
      setSavingDecision(false);
    }
  };

  const handleApprove = async () => {
    if (!requireReviewableState()) {
      setToast('This complaint is not in a reviewable state.');
      return;
    }
    await updateComplaintStatus('approved');
  };

  const handleReject = async () => {
    if (!requireReviewableState()) {
      setToast('This complaint is not in a reviewable state.');
      return;
    }

    if (!declineComment.trim()) {
      setError('Please provide a comment/instructions before declining.');
      return;
    }

    await updateComplaintStatus('declined');
  };

  const handleLogout = async () => {
    setError('');
    try {
      const { error: signOutError } = await supabase.auth.signOut({ scope: 'global' });
      if (signOutError) throw signOutError;
    } catch (e) {
      setError(e?.message || 'Logout failed. Clearing local session…');
    } finally {
      try {
        localStorage.clear();
        sessionStorage.clear();
      } catch {}
      window.location.replace('/login');
    }
  };

  const urgencyStyle = complaint ? getUrgencyStyle(complaint?.authenticity_level) : null;

  return (
    <div className="dash-container">
      <main className="dash-main">
        <section className="dash-shell" style={{ paddingLeft: navCollapsed ? 72 : 240 }}>
          {/* Sidebar */}
          <aside
            className="dash-side"
            title="Menu"
            style={{ width: navCollapsed ? 72 : 240, display: 'flex', flexDirection: 'column', cursor: 'pointer' }}
            onClick={(e) => {
              const t = e.target;
              if (t && typeof t.closest === 'function' && t.closest('.dash-nav-item')) return;
              setNavCollapsed((v) => !v);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                const t = e.target;
                if (t && typeof t.closest === 'function' && t.closest('.dash-nav-item')) return;
                e.preventDefault();
                setNavCollapsed((v) => !v);
              }
            }}
          >
            <div className="dash-side-brand" title="Menu">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 8 }}>
                <img src="/logo.png" alt="City Hall Logo" style={{ width: 44, height: 44, objectFit: 'contain', borderRadius: '50%' }} />
              </div>
              <div className="hamburger" aria-hidden="true">
                <div className="hamburger-bar"></div>
                <div className="hamburger-bar"></div>
                <div className="hamburger-bar"></div>
              </div>
            </div>
            <ul className="dash-nav" style={{ flex: 1 }}>
              <li>
                <a href="/dashboard/director" className="dash-nav-item" style={{ textDecoration: 'none' }}>
                  <span className="dash-nav-ico" aria-hidden="true" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                    <img src="/ui_icons/menu.png" alt="" style={{ width: 22, height: 22, objectFit: 'contain', display: 'block', filter: 'brightness(0) saturate(100%) invert(62%) sepia(94%) saturate(1456%) hue-rotate(7deg) brightness(88%) contrast(108%)' }} />
                  </span>
                  <span className="dash-nav-label" style={{ display: navCollapsed ? 'none' : 'inline' }}>Dashboard</span>
                </a>
              </li>
              <li className="dash-nav-section">
                <span className="dash-nav-section-label" style={{ display: navCollapsed ? 'none' : 'inline' }}>Complaints</span>
              </li>
              <li>
                <a href="/dashboard/director#queue" className="dash-nav-item" style={{ textDecoration: 'none' }}>
                  <span className="dash-nav-ico" aria-hidden="true" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                    <img src="/ui_icons/queue.png" alt="" style={{ width: 26, height: 26, objectFit: 'contain', display: 'block', filter: 'brightness(0) saturate(100%) invert(62%) sepia(94%) saturate(1456%) hue-rotate(7deg) brightness(88%) contrast(108%)' }} />
                  </span>
                  <span className="dash-nav-label" style={{ display: navCollapsed ? 'none' : 'inline' }}>Review Complaints</span>
                </a>
              </li>
              <li>
                <a href="/dashboard/director#history" className="dash-nav-item" style={{ textDecoration: 'none' }}>
                  <span className="dash-nav-ico" aria-hidden="true" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                    <img src="/ui_icons/history.png" alt="" style={{ width: 22, height: 22, objectFit: 'contain', display: 'block', filter: 'brightness(0) saturate(100%) invert(62%) sepia(94%) saturate(1456%) hue-rotate(7deg) brightness(88%) contrast(108%)' }} />
                  </span>
                  <span className="dash-nav-label" style={{ display: navCollapsed ? 'none' : 'inline' }}>Complaint History</span>
                </a>
              </li>
            </ul>
            <button
              type="button"
              className="dash-nav-item"
              onClick={handleLogout}
              style={{
                marginTop: 'auto',
                border: 'none',
                background: 'transparent',
                color: '#ef4444',
                fontWeight: 800,
                textAlign: 'left',
                padding: '10px 12px',
                borderRadius: 10,
                cursor: 'pointer',
                display: 'grid',
                gridTemplateColumns: '24px 1fr',
                alignItems: 'center',
                gap: 10,
              }}
            >
              <span className="dash-nav-ico" aria-hidden="true" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                <img src="/ui_icons/logout.png" alt="" style={{ width: 22, height: 22, objectFit: 'contain', display: 'block', filter: 'brightness(0) saturate(100%) invert(21%) sepia(97%) saturate(4396%) hue-rotate(346deg) brightness(95%) contrast(101%)' }} />
              </span>
              <span className="dash-nav-label" style={{ display: navCollapsed ? 'none' : 'inline' }}>Logout</span>
            </button>
          </aside>

          {/* Content */}
          <div className="dash-maincol">
            <div className="dash-card">
              <div className="dash-header">
                <div>
                  <h2 className="dash-title">Complaint Review</h2>
                  <p className="dash-subtitle">{complaint?.business_name || 'Loading…'}</p>
                </div>
                <div className="dash-actions">
                  <a className="dash-link" href="/dashboard/director">
                    ← Back
                  </a>
                </div>
              </div>

              {toast ? <div className="dash-alert dash-alert-success">{toast}</div> : null}
              {error ? <div className="dash-alert dash-alert-error">{error}</div> : null}
              {declineCommentError ? <div className="dash-alert dash-alert-error">{declineCommentError}</div> : null}

              {loading ? (
                <div className="dash-alert">Loading complaint…</div>
              ) : !complaint ? (
                <div className="dash-alert dash-alert-error">No complaint found.</div>
              ) : (
                <div style={{ display: 'grid', gap: 16, marginTop: 16 }}>
                  {/* Summary Card */}
                  <div style={{ background: '#eef2ff', border: '1px solid #e2e8f0', borderRadius: 16, boxShadow: '0 2px 10px rgba(2,6,23,0.06)', padding: 16 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                      <div>
                        <div style={{ fontSize: 18, fontWeight: 900, color: '#0f172a' }}>{complaint.business_name || '—'}</div>
                        <div style={{ color: '#334155', marginTop: 4, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                          <span aria-hidden>📍</span>
                          <span style={{ fontWeight: 700 }}>{complaint.business_address || '—'}</span>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        <span className="status-badge" style={{ ...urgencyStyle.badge, fontWeight: 700, fontSize: 13, padding: '6px 12px', borderRadius: 6, display: 'inline-block' }}>
                          {complaint?.authenticity_level ?? '—'}
                        </span>
                        <span className="status-badge" style={{ background: '#e2e8f0', fontWeight: 700, fontSize: 13, padding: '6px 12px', borderRadius: 6, display: 'inline-block' }}>
                          {formatStatus(complaint.status)}
                        </span>
                      </div>
                    </div>
                    <div style={{ height: 1, background: '#dbeafe', margin: '12px 0' }} />
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(220px, 1fr))', gap: 12 }}>
                      <div>
                        <div style={{ color: '#64748b', fontWeight: 800, fontSize: 12 }}>ID</div>
                        <div style={{ color: '#0f172a', fontWeight: 800 }}>{complaint.id}</div>
                      </div>
                      <div>
                        <div style={{ color: '#64748b', fontWeight: 800, fontSize: 12 }}>Submitted</div>
                        <div style={{ color: '#0f172a', fontWeight: 800 }}>
                          {complaint.created_at ? new Date(complaint.created_at).toLocaleString() : '—'}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Description Card */}
                  <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 16, boxShadow: '0 2px 10px rgba(2,6,23,0.06)', padding: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                      <span aria-hidden>📝</span>
                      <div style={{ fontWeight: 900, color: '#0f172a' }}>Description</div>
                    </div>
                    <div style={{ color: '#0f172a', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
                      {complaint.complaint_description || '—'}
                    </div>
                  </div>

                  {/* Evidence Card */}
                  <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 16, boxShadow: '0 2px 10px rgba(2,6,23,0.06)', padding: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                      <span aria-hidden>🖼️</span>
                      <div style={{ fontWeight: 900, color: '#0f172a' }}>Evidence</div>
                    </div>
                    {Array.isArray(complaint.image_urls) && complaint.image_urls.length > 0 ? (
                      <div style={{ display: 'grid', gap: 12 }}>
                        {/* Hero image */}
                        <div style={{ position: 'relative' }}>
                          <img
                            src={complaint.image_urls[evidenceIndex]}
                            alt="Evidence hero"
                            onClick={() => setPreviewImage(complaint.image_urls[evidenceIndex])}
                            style={{ width: '100%', height: 340, objectFit: 'cover', borderRadius: 16, border: '1px solid #e2e8f0', cursor: 'pointer' }}
                            loading="lazy"
                          />
                          {complaint.image_urls.length > 1 ? (
                            <>
                              <button
                                type="button"
                                aria-label="Previous image"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const n = complaint.image_urls.length;
                                  setEvidenceIndex((i) => (i - 1 + n) % n);
                                }}
                                style={{
                                  position: 'absolute',
                                  top: '50%',
                                  left: 14,
                                  transform: 'translateY(-50%)',
                                  background: 'rgba(15,23,42,0.85)',
                                  color: '#fff',
                                  border: 'none',
                                  borderRadius: 999,
                                  width: 44,
                                  height: 44,
                                  aspectRatio: '1 / 1',
                                  display: 'grid',
                                  placeItems: 'center',
                                  cursor: 'pointer',
                                  boxShadow: '0 2px 10px rgba(0,0,0,0.25)',
                                  padding: 0,
                                  lineHeight: 0,
                                  boxSizing: 'border-box',
                                }}
                              >
                                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style={{ display: 'block' }}>
                                  <path d="M14 6L8 12L14 18" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                              </button>
                              <button
                                type="button"
                                aria-label="Next image"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const n = complaint.image_urls.length;
                                  setEvidenceIndex((i) => (i + 1) % n);
                                }}
                                style={{
                                  position: 'absolute',
                                  top: '50%',
                                  right: 14,
                                  transform: 'translateY(-50%)',
                                  background: 'rgba(15,23,42,0.85)',
                                  color: '#fff',
                                  border: 'none',
                                  borderRadius: 999,
                                  width: 44,
                                  height: 44,
                                  aspectRatio: '1 / 1',
                                  display: 'grid',
                                  placeItems: 'center',
                                  cursor: 'pointer',
                                  boxShadow: '0 2px 10px rgba(0,0,0,0.25)',
                                  padding: 0,
                                  lineHeight: 0,
                                  boxSizing: 'border-box',
                                }}
                              >
                                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style={{ display: 'block' }}>
                                  <path d="M10 6L16 12L10 18" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                              </button>
                            </>
                          ) : null}
                          <div style={{ position: 'absolute', right: 10, bottom: 10, background: 'rgba(15,23,42,0.7)', color: '#fff', fontWeight: 800, padding: '4px 8px', borderRadius: 999, fontSize: 12 }}>
                            {evidenceIndex + 1} / {complaint.image_urls.length}
                          </div>
                        </div>
                        {/* Thumbnails */}
                        {complaint.image_urls.length > 1 ? (
                          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                            {complaint.image_urls.map((url, idx) => (
                              <img
                                key={url}
                                src={url}
                                alt={`Evidence ${idx + 1}`}
                                onClick={() => setEvidenceIndex(idx)}
                                style={{
                                  width: 110,
                                  height: 78,
                                  objectFit: 'cover',
                                  borderRadius: 12,
                                  border: idx === evidenceIndex ? '2px solid #2563eb' : '1px solid #e2e8f0',
                                  boxShadow: idx === evidenceIndex ? '0 0 0 3px rgba(37,99,235,0.15)' : 'none',
                                  cursor: 'pointer',
                                }}
                                loading="lazy"
                              />
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <div style={{ color: '#64748b', fontWeight: 700 }}>No images</div>
                    )}
                  </div>

                  {/* Reporter Card */}
                  <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 16, boxShadow: '0 2px 10px rgba(2,6,23,0.06)', padding: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                      <span aria-hidden>👤</span>
                      <div style={{ fontWeight: 900, color: '#0f172a' }}>Reporter</div>
                    </div>
                    <div style={{ background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 12, padding: 12, display: 'grid', gap: 6 }}>
                      <div style={{ color: '#64748b', fontWeight: 800, fontSize: 12 }}>Email</div>
                      <div style={{ fontWeight: 800, color: '#0f172a' }}>{complaint.reporter_email || '—'}</div>
                    </div>
                  </div>

                  {/* Audit Card */}
                  <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 16, boxShadow: '0 2px 10px rgba(2,6,23,0.06)', padding: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                      <span aria-hidden>•</span>
                      <div style={{ fontWeight: 900, color: '#0f172a' }}>Audit Trail</div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(220px, 1fr))', gap: 16 }}>
                      <div>
                        <div style={{ color: '#64748b', fontWeight: 800, fontSize: 12 }}>Approved By</div>
                        <div style={{ fontWeight: 800, color: '#0f172a' }}>{complaint.approved_by || '—'}</div>
                      </div>
                      <div>
                        <div style={{ color: '#64748b', fontWeight: 800, fontSize: 12 }}>Approved At</div>
                        <div style={{ fontWeight: 800, color: '#0f172a' }}>
                          {complaint.approved_at ? new Date(complaint.approved_at).toLocaleString() : '—'}
                        </div>
                      </div>
                      <div>
                        <div style={{ color: '#64748b', fontWeight: 800, fontSize: 12 }}>Declined By</div>
                        <div style={{ fontWeight: 800, color: '#0f172a' }}>{complaint.declined_by || '—'}</div>
                      </div>
                      <div>
                        <div style={{ color: '#64748b', fontWeight: 800, fontSize: 12 }}>Declined At</div>
                        <div style={{ fontWeight: 800, color: '#0f172a' }}>
                          {complaint.declined_at ? new Date(complaint.declined_at).toLocaleString() : '—'}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Decline Comment Card */}
                  <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 16, boxShadow: '0 2px 10px rgba(2,6,23,0.06)', padding: 16 }}>
                    <label htmlFor="declineComment" style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                      <span aria-hidden>💬</span>
                      <div style={{ fontWeight: 900, color: '#0f172a' }}>
                        Decline Comment <span style={{ color: '#ef4444' }}>*</span>
                      </div>
                    </label>
                    <textarea
                      id="declineComment"
                      value={declineComment}
                      onChange={(e) => setDeclineComment(e.target.value)}
                      placeholder="Add comments or specific instructions for declining this complaint..."
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
                    <div style={{ color: '#64748b', fontWeight: 700, fontSize: 12, marginTop: 6 }}>
                      Tip: Declining requires a comment for auditability.
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
                    <button
                      type="button"
                      className="dash-btn"
                      onClick={handleApprove}
                      disabled={loading || savingDecision || !complaint || !requireReviewableState()}
                      title={!requireReviewableState() ? 'Not in a reviewable status.' : 'Approve this complaint.'}
                      style={{ background: '#22c55e', color: '#fff' }}
                    >
                      {savingDecision ? 'Saving…' : 'Approve'}
                    </button>
                    <button
                      type="button"
                      className="dash-btn"
                      onClick={handleReject}
                      disabled={loading || savingDecision || !complaint || !requireReviewableState()}
                      title={!requireReviewableState() ? 'Not in a reviewable status.' : 'Decline this complaint.'}
                      style={{ background: '#dc2626', color: '#fff' }}
                    >
                      {savingDecision ? 'Saving…' : 'Decline'}
                    </button>
                  </div>

                  <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 12, padding: 12, color: '#166534', fontWeight: 700, fontSize: 13 }}>
                    Director review. Approve/decline changes the complaint status and stores your comments.
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>
      </main>

      {/* Image Preview Overlay */}
      {previewImage ? (
        <div
          className="image-overlay"
          onClick={() => setPreviewImage(null)}
          role="dialog"
          aria-modal="true"
        >
          <div className="overlay-content" onClick={(e) => e.stopPropagation()}>
            <button className="overlay-close" onClick={() => setPreviewImage(null)} aria-label="Close">
              &times;
            </button>
            <img src={previewImage} alt="Evidence Preview" className="overlay-full-img" />
          </div>
        </div>
      ) : null}
    </div>
  );
}
