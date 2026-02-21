import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import DashboardSidebar from '../../../components/DashboardSidebar';
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
  const [copiedId, setCopiedId] = useState(false);

  const handleCopyId = () => {
    if (complaint?.id) {
      navigator.clipboard.writeText(complaint.id);
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 2000);
    }
  };

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
      setError('Please provide a comment before declining.');
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
          {/* Sidebar - Using reusable DashboardSidebar component */}
          <DashboardSidebar
            role="director"
            onLogout={handleLogout}
            collapsed={navCollapsed}
            onCollapsedChange={setNavCollapsed}
          />

          {/* Content */}
          <div className="dash-maincol">
            <div className="dash-card">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 20 }}>
                {/* Back Button - Top Left */}
                <a
                  href="/dashboard/director"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 12px',
                    background: 'transparent',
                    border: '1px solid #cbd5e1',
                    borderRadius: 8,
                    color: '#0f172a',
                    fontWeight: 700,
                    fontSize: 14,
                    textDecoration: 'none',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = '#f1f5f9';
                    e.currentTarget.style.borderColor = '#94a3b8';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                    e.currentTarget.style.borderColor = '#cbd5e1';
                  }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ display: 'block' }}>
                    <path d="M15 18L9 12L15 6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  Back to Review Queue
                </a>

                {/* Action Buttons - Top Right */}
                <div style={{ display: 'flex', gap: 10 }}>
                  <button
                    type="button"
                    className="dash-btn"
                    onClick={handleApprove}
                    disabled={loading || savingDecision || !complaint || !requireReviewableState()}
                    title={!requireReviewableState() ? 'Not in a reviewable status.' : 'Approve this complaint.'}
                    style={{ background: '#22c55e', color: '#fff', padding: '8px 16px', fontSize: 14, fontWeight: 700 }}
                  >
                    {savingDecision ? 'Saving…' : 'Approve'}
                  </button>
                  <button
                    type="button"
                    className="dash-btn"
                    onClick={handleReject}
                    disabled={loading || savingDecision || !complaint || !requireReviewableState()}
                    title={!requireReviewableState() ? 'Not in a reviewable status.' : 'Decline this complaint.'}
                    style={{ background: '#dc2626', color: '#fff', padding: '8px 16px', fontSize: 14, fontWeight: 700 }}
                  >
                    {savingDecision ? 'Saving…' : 'Decline'}
                  </button>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
                <h2 className="dash-title" style={{ margin: 0 }}>Complaint Review</h2>
                {/* Complaint ID - Copyable Chip - Smaller */}
                <button
                  type="button"
                  onClick={handleCopyId}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '4px 8px',
                    background: '#f1f5f9',
                    border: '1px solid #cbd5e1',
                    borderRadius: 4,
                    color: '#0f172a',
                    fontWeight: 700,
                    fontSize: 11,
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = '#e2e8f0';
                    e.currentTarget.style.borderColor = '#94a3b8';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = '#f1f5f9';
                    e.currentTarget.style.borderColor = '#cbd5e1';
                  }}
                  title="Click to copy Complaint ID"
                >
                  <span style={{ fontSize: 9, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.3px' }}>ID</span>
                  <span style={{ fontFamily: 'monospace', fontSize: 10 }}>{complaint?.id ? String(complaint.id).slice(0, 8) + '…' : 'Loading…'}</span>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ display: 'block' }}>
                    <path d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                {copiedId && <div style={{ fontSize: 11, color: '#22c55e', fontWeight: 700 }}>✓ Copied!</div>}
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
                  {/* Professional Header Section */}
                  <div style={{
                    background: '#ffffff',
                    border: '1px solid #e2e8f0',
                    borderRadius: 12,
                    padding: 24,
                    position: 'relative',
                  }}>
                    {/* Urgency Tag - Top Right */}
                    <div style={{ position: 'absolute', top: 24, right: 24 }}>
                      <span className="status-badge" style={{ ...urgencyStyle.badge, fontWeight: 800, fontSize: 14, padding: '8px 14px' }}>
                        {complaint?.authenticity_level ?? '—'}
                      </span>
                    </div>

                    {/* Business Name - Large Title */}
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ fontSize: 18, fontWeight: 900, color: '#0f172a', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        {complaint.business_name || '—'}
                      </div>
                    </div>

                    {/* Address with Icon */}
                    <div style={{ display: 'flex', gap: 8, marginBottom: 20, alignItems: 'flex-start' }}>
                      <span style={{ fontSize: 18, marginTop: -2 }}>📍</span>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>
                        {complaint.business_address || '—'}
                      </div>
                    </div>

                    {/* Divider */}
                    <div style={{ height: 1, background: '#e2e8f0', margin: '20px 0' }} />

                    {/* Details Grid - Form style: labels on left, values on right */}
                    <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: '16px 24px', alignItems: 'start' }}>
                      {/* Reported By Label */}
                      <div style={{ fontSize: 11, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Reported By</div>
                      {/* Reported By Value */}
                      <div style={{ fontSize: 16, fontWeight: 700, color: '#0f172a' }}>{complaint.reporter_email || '—'}</div>

                      {/* Submitted Label */}
                      <div style={{ fontSize: 11, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Submitted</div>
                      {/* Submitted Value */}
                      <div style={{ fontSize: 16, fontWeight: 700, color: '#0f172a' }}>{complaint.created_at ? new Date(complaint.created_at).toLocaleString() : '—'}</div>

                      {/* Description Label */}
                      <div style={{ fontSize: 11, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Description</div>
                      {/* Description Value */}
                      <div style={{ color: '#0f172a', whiteSpace: 'pre-wrap', lineHeight: 1.6, fontSize: 15 }}>
                        {complaint.complaint_description || '—'}
                      </div>

                      {/* Evidence Label */}
                      <div style={{ fontSize: 11, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Evidence</div>
                      {/* Evidence Value */}
                      <div>
                        {Array.isArray(complaint.image_urls) && complaint.image_urls.length > 0 ? (
                          <div style={{ display: 'grid', gap: 8 }}>
                            {/* Hero image - larger preview */}
                            <div style={{ position: 'relative', width: 320, background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0', padding: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 240 }}>
                              <img
                                src={complaint.image_urls[evidenceIndex]}
                                alt="Evidence hero"
                                onClick={() => setPreviewImage(complaint.image_urls[evidenceIndex])}
                                style={{ maxWidth: '100%', maxHeight: 210, objectFit: 'contain', cursor: 'pointer' }}
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
                                      left: 6,
                                      transform: 'translateY(-50%)',
                                      background: 'rgba(15,23,42,0.85)',
                                      color: '#fff',
                                      border: 'none',
                                      borderRadius: 999,
                                      width: 28,
                                      height: 28,
                                      aspectRatio: '1 / 1',
                                      display: 'grid',
                                      placeItems: 'center',
                                      cursor: 'pointer',
                                      boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
                                      padding: 0,
                                      lineHeight: 0,
                                      boxSizing: 'border-box',
                                    }}
                                  >
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style={{ display: 'block' }}>
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
                                      right: 6,
                                      transform: 'translateY(-50%)',
                                      background: 'rgba(15,23,42,0.85)',
                                      color: '#fff',
                                      border: 'none',
                                      borderRadius: 999,
                                      width: 28,
                                      height: 28,
                                      aspectRatio: '1 / 1',
                                      display: 'grid',
                                      placeItems: 'center',
                                      cursor: 'pointer',
                                      boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
                                      padding: 0,
                                      lineHeight: 0,
                                      boxSizing: 'border-box',
                                    }}
                                  >
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style={{ display: 'block' }}>
                                      <path d="M10 6L16 12L10 18" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                                    </svg>
                                  </button>
                                </>
                              ) : null}
                              <div style={{ position: 'absolute', right: 6, bottom: 6, background: 'rgba(15,23,42,0.7)', color: '#fff', fontWeight: 700, padding: '2px 5px', borderRadius: 999, fontSize: 10 }}>
                                {evidenceIndex + 1} / {complaint.image_urls.length}
                              </div>
                            </div>
                            {/* Thumbnails - compact */}
                            {complaint.image_urls.length > 1 ? (
                              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                {complaint.image_urls.map((url, idx) => (
                                  <img
                                    key={url}
                                    src={url}
                                    alt={`Evidence ${idx + 1}`}
                                    onClick={() => setEvidenceIndex(idx)}
                                    style={{
                                      width: 70,
                                      height: 50,
                                      objectFit: 'cover',
                                      borderRadius: 6,
                                      border: idx === evidenceIndex ? '2px solid #2563eb' : '1px solid #e2e8f0',
                                      boxShadow: idx === evidenceIndex ? '0 0 0 2px rgba(37,99,235,0.15)' : 'none',
                                      cursor: 'pointer',
                                    }}
                                    loading="lazy"
                                  />
                                ))}
                              </div>
                            ) : null}
                          </div>
                        ) : (
                          <div style={{ color: '#64748b', fontWeight: 700, fontSize: 13 }}>No images</div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* General Comments Card */}
                  <div style={{
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    borderRadius: 16,
                    boxShadow: '0 2px 10px rgba(2,6,23,0.06)',
                    padding: 16,
                  }}>
                    <style>{`
                      textarea:focus {
                        border-color: #2563eb !important;
                        box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1) !important;
                      }
                    `}</style>
                    
                    {/* Title */}
                    <label htmlFor="declineComment" style={{ display: 'block', marginBottom: 12 }}>
                      <div style={{ fontWeight: 900, color: '#0f172a', fontSize: 16, marginBottom: 8 }}>
                        General Comments
                      </div>
                      
                      {/* Rule Hints - Small rows */}
                      <div style={{ display: 'grid', gap: 4 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b' }}>
                          <span style={{ color: '#dc2626', fontWeight: 800 }}>•</span> Required if Declining
                        </div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b' }}>
                          <span style={{ color: '#22c55e', fontWeight: 800 }}>•</span> Optional if Approving
                        </div>
                      </div>
                    </label>

                    {/* Textarea */}
                    <textarea
                      id="declineComment"
                      value={declineComment}
                      onChange={(e) => setDeclineComment(e.target.value)}
                      placeholder="Provide the reason for declining, or optional instructions if approving…"
                      disabled={loading || savingDecision}
                      style={{
                        width: '100%',
                        minHeight: 110,
                        borderRadius: 12,
                        border: declineCommentError ? '1px solid #ef4444' : '1px solid #cbd5e1',
                        background: '#fff',
                        color: '#0f172a',
                        padding: 12,
                        outline: 'none',
                        fontSize: 14,
                        fontFamily: 'inherit',
                        transition: 'all 0.2s ease',
                        resize: 'vertical',
                        marginTop: 8,
                      }}
                    />

                    {/* Validation Message - Only show when declining and empty */}
                    {declineCommentError && (
                      <div style={{
                        marginTop: 8,
                        padding: 8,
                        background: '#fee2e2',
                        border: '1px solid #fecaca',
                        borderRadius: 8,
                        color: '#991b1b',
                        fontSize: 12,
                        fontWeight: 700,
                      }}>
                        {declineCommentError}
                      </div>
                    )}
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
