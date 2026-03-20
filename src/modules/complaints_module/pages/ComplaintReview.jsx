import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import DashboardSidebar from '../../../components/DashboardSidebar';
import ErrorToast from '../../../components/ErrorToast.jsx';
import { notifyHeadInspectorComplaintApproved } from '../../../lib/notifications/notificationTriggers';
import {
  DECLINE_TEMPLATES,
} from '../../../lib/complaints/decisionSupport';
import '../../dashboard_module/pages/Dashboard.css';

// Complaint Category grouping (derive from tags like "Violation: <Sub>")
const GUIDED_CATEGORY_LABELS = [
  'Business Permit & Licensing Issues',
  'Alcohol & Tobacco Violations',
  'Sanitation & Environmental Violations',
  'Health, Hygiene, & Nutrition',
  'Public Security Compliance',
];
const GUIDED_SUBCAT_BY_CATEGORY = new Map([
  ['Business Permit & Licensing Issues', [
    'Operating Without a Valid Business Permit',
    'Missing Commerical Space Clearance',
    'Unregistered or Untaxed Employees',
  ]],
  ['Alcohol & Tobacco Violations', [
    'Selling Alcohol Near Schools',
    'Selling Alcohol to Minors',
    'Selling Cigarettes to Minors',
  ]],
  ['Sanitation & Environmental Violations', [
    'Improper Waste Disposal or Segregation',
    'Illegal Disposing of Cooking Oil',
    'Unpaid Garbage Tax',
  ]],
  ['Health, Hygiene, & Nutrition', [
    'Poor Food-Handler Hygiene',
    'Missing Menu Nutrition Labels',
  ]],
  ['Public Security Compliance', [
    'CCTV System Non-Compliance',
  ]],
]);
function groupComplaintCategoriesFromTags(tags) {
  const result = [];
  if (!Array.isArray(tags) || tags.length === 0) return result;
  const selectedSubs = tags
    .map((t) => String(t || ''))
    .filter((t) => /^Violation:\s*/i.test(t))
    .map((t) => t.replace(/^Violation:\s*/i, '').trim());
  if (selectedSubs.length === 0) return result;
  const subToCat = new Map();
  for (const cat of GUIDED_CATEGORY_LABELS) {
    const subs = GUIDED_SUBCAT_BY_CATEGORY.get(cat) || [];
    subs.forEach((s) => subToCat.set(s, cat));
  }
  const byCat = new Map();
  for (const sub of selectedSubs) {
    const cat = subToCat.get(sub);
    if (!cat) continue;
    if (!byCat.has(cat)) byCat.set(cat, new Set());
    byCat.get(cat).add(sub);
  }
  for (const [cat, setSubs] of byCat) {
    result.push({ category: cat, subs: Array.from(setSubs) });
  }
  return result;
}

function formatStatus(status) {
  if (!status) return 'Unknown';
  return String(status)
    .replace(/_/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function statusBadgeClass(status) {
  const s = String(status || '').toLowerCase();
  if (['approved'].includes(s)) return 'status-badge status-success';
  if (['declined', 'rejected', 'invalid'].includes(s)) return 'status-badge status-danger';
  if (['submitted', 'pending', 'new'].includes(s)) return 'status-badge status-warning';
  if (['on hold', 'on_hold', 'hold'].includes(s)) return 'status-badge status-info';
  return 'status-badge';
}

function getUrgencyText(authenticityLevel) {
  const u = Number(authenticityLevel);
  if (u < 50) {
    return 'Monitoring and Records';
  }
  if (u === 50) {
    return 'Scheduled Inspection';
  }
  if (u > 50) {
    return 'Immediate Inspection';
  }
  return '—';
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

function formatDatePipe(isoString) {
  if (!isoString) return '—';
  const date = new Date(isoString);
  const datePart = date.toLocaleDateString(undefined, {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
  const timePart = date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${datePart} | ${timePart}`;
}

export default function ComplaintReview() {
  const complaintId = useMemo(() => getComplaintIdFromQuery(), []);

  const [loading, setLoading] = useState(false);
  const [savingDecision, setSavingDecision] = useState(false);
  const [error, setError] = useState(null);
  const [errorToastKey, setErrorToastKey] = useState(0);
  const [toast, setToast] = useState('');

  const [complaint, setComplaint] = useState(null);
  const [previewImage, setPreviewImage] = useState(null);
  const [evidenceIndex, setEvidenceIndex] = useState(0);

  const [declineComment, setDeclineComment] = useState('');
  const [declineCommentError, setDeclineCommentError] = useState('');

  const [navCollapsed, setNavCollapsed] = useState(false);
  const [copiedId, setCopiedId] = useState(false);

  const [showGeneralCommentsEditor, setShowGeneralCommentsEditor] = useState(false);
  const [showRightCommentsEditor, setShowRightCommentsEditor] = useState(true);
  const commentInputRef = useRef(null);

  // Determine which tab the user came from (queue or history)
  const [source, setSource] = useState('queue');
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sourceParam = params.get('source') || 'queue'; // default to queue
    setSource(sourceParam);
    sessionStorage.setItem('complaintReviewSource', sourceParam);
  }, []);

  const handleCopyId = () => {
    if (complaint?.id) {
      navigator.clipboard.writeText(complaint.id);
    }
  };

  const showError = (msg) => {
    const m = String(msg || '').trim();
    if (!m) return;
    setError(m);
    setErrorToastKey((k) => k + 1);
  };

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!showRightCommentsEditor || source === 'history') return;
    const t = setTimeout(() => {
      commentInputRef.current?.focus();
    }, 0);
    return () => clearTimeout(t);
  }, [showRightCommentsEditor, source]);

  useEffect(() => {
    if (!declineCommentError || source === 'history') return;
    setShowRightCommentsEditor(true);
  }, [declineCommentError, source]);

  // Handle keyboard navigation in full-picture mode
  useEffect(() => {
    if (!previewImage || !complaint?.image_urls) return;

    const handleKeyDown = (e) => {
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        const n = complaint.image_urls.length;
        setEvidenceIndex((i) => (i - 1 + n) % n);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        const n = complaint.image_urls.length;
        setEvidenceIndex((i) => (i + 1) % n);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [previewImage, complaint?.image_urls]);

  const load = async () => {
    if (!complaintId) {
      setError('Missing complaint id. Open this page as /complaint/review?id=<uuid>');
      return;
    }

    setError(null);
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
      showError(e?.message || 'Failed to load complaint.');
      setComplaint(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Reset per-complaint UI state when navigating between complaints
    setDeclineComment('');
    setDeclineCommentError('');
    setShowRightCommentsEditor(true);

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

    setError(null);
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
        // Save comments even when approving (optional comments)
        patch.decline_comment = declineComment.trim() || null;
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

      // Notify Head Inspector when complaint is approved
      if (status === 'approved') {
        try {
          await notifyHeadInspectorComplaintApproved(
            complaintId,
            complaint?.business_name || 'Unknown Business'
          );
        } catch (notifErr) {
          console.error('Failed to send notification:', notifErr);
          // Don't fail the approval if notification fails
        }
      }

      setToast(status === 'approved' ? 'Complaint approved.' : 'Complaint declined.');
      await load();
    } catch (e) {
      showError(e?.message || 'Failed to save decision.');
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
    // Navigate back to review complaints after approval
    setTimeout(() => {
      window.location.href = '/dashboard/director?tab=queue';
    }, 100);
  };

  const handleReject = async () => {
    if (!requireReviewableState()) {
      setToast('This complaint is not in a reviewable state.');
      return;
    }

    if (!declineComment.trim()) {
      showError('Please provide a comment before declining.');
      return;
    }

    await updateComplaintStatus('declined');
    // Navigate back to review complaints after decline
    setTimeout(() => {
      window.location.href = '/dashboard/director?tab=queue';
    }, 100);
  };

  const openCommentEditor = () => {
    setShowRightCommentsEditor(true);
  };

  const handleCommentTemplateClick = (text) => {
    openCommentEditor();
    setDeclineComment((prev) => {
      const current = String(prev || '').trim();
      const next = String(text || '').trim();
      if (!current) return next;
      if (current.includes(next)) return prev;
      return `${current}\n\n${next}`;
    });
    setDeclineCommentError('');
  };

  const handleCommentChange = (value) => {
    setDeclineComment(value);
    if (declineCommentError && String(value || '').trim()) {
      setDeclineCommentError('');
    }
  };

  const handleLogout = async () => {
    setError(null);
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
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap', marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'nowrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', flex: '0 0 auto' }}>
                    <button
                      type="button"
                      onClick={() => {
                        window.location.assign(source === 'history' ? '/dashboard/director?tab=history' : '/dashboard/director?tab=queue');
                      }}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '6px 10px',
                        background: 'transparent',
                        border: 'none',
                        borderRadius: 8,
                        color: '#334155',
                        fontWeight: 800,
                        fontSize: 14,
                        textDecoration: 'none',
                        cursor: 'pointer',
                        transition: 'background 0.2s ease, color 0.2s ease',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = '#f1f5f9';
                        e.currentTarget.style.color = '#0f172a';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'transparent';
                        e.currentTarget.style.color = '#334155';
                      }}
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ display: 'block' }}>
                        <path d="M15 18L9 12L15 6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      Back
                    </button>
                  </div>

                  <span aria-hidden="true" style={{ width: 1, height: 36, background: '#e2e8f0', display: 'inline-block', marginTop: 2 }} />

                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 1000, fontSize: 20, color: '#0f172a' }}>Complaint Review</div>
                    <div style={{ color: '#475569', fontWeight: 800, marginTop: 6, fontSize: 14 }}>
                      {complaint?.business_name || '—'}
                    </div>
                  </div>
                </div>

                {/* Action Buttons - Top Right (Only show if from queue tab) */}
                {source !== 'history' ? (
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
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
                ) : null}
              </div>

              
              {toast ? <div className="dash-alert dash-alert-success">{toast}</div> : null}
              <ErrorToast message={error} triggerKey={errorToastKey} />
              {declineCommentError ? <div className="dash-alert dash-alert-error">{declineCommentError}</div> : null}

              {loading ? (
                <div className="dash-alert">Loading complaint…</div>
              ) : !complaint ? (
                <div className="dash-alert dash-alert-error">No complaint found.</div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 18, alignItems: 'start', marginTop: 16 }}>
                  {/* LEFT COLUMN */}
                  <div style={{ display: 'grid', gap: 16, alignSelf: 'start' }}>
                    {/* Summary / Details (MO Editor-style blue header card) */}
                    <div
                      id="complaint-summary-ribbon"
                      style={{
                        marginBottom: 0,
                        display: 'grid',
                        gridTemplateColumns: '1fr',
                        gap: 14,
                        padding: '20px 22px',
                        border: '1px solid #0b2249',
                        borderRadius: 14,
                        background: 'linear-gradient(90deg, #1e3a8a 0%, #0b2249 100%)',
                        color: '#fff',
                        boxShadow: '0 8px 16px rgba(2,6,23,0.25)',
                        position: 'relative',
                      }}
                    >
                      <style>{`
#complaint-summary-ribbon span[aria-hidden="true"] { color: #fff !important; opacity: 0.95; }
#complaint-summary-ribbon span[aria-hidden="true"] svg path { fill: #fff !important; stroke: #fff !important; }
`}</style>

                      {/* Top row: Business name + ID chip + urgency/status */}
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 18, flexWrap: 'wrap' }}>
                        <div style={{ minWidth: 0, flex: '1 1 620px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                            <div style={{ fontSize: 17, fontWeight: 1000, letterSpacing: 0.5, textTransform: 'uppercase' }}>
                              {complaint.business_name || '—'}
                            </div>

                            <button
                              type="button"
                              onClick={handleCopyId}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 6,
                                padding: '4px 8px',
                                background: 'rgba(255,255,255,0.12)',
                                border: '1px solid rgba(255,255,255,0.18)',
                                borderRadius: 999,
                                color: '#fff',
                                fontWeight: 900,
                                fontSize: 11,
                                cursor: 'pointer',
                              }}
                              title="Click to copy Complaint ID"
                            >
                              <span style={{ fontSize: 9, fontWeight: 1000, color: 'rgba(255,255,255,0.8)', textTransform: 'uppercase', letterSpacing: '0.3px' }}>ID</span>
                              <span style={{ fontFamily: 'monospace', fontSize: 10 }}>{complaint?.id ? String(complaint.id).slice(0, 8) + '…' : '—'}</span>
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ display: 'block' }} aria-hidden="true">
                                <path d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            </button>
                          </div>

                          <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                            <span aria-hidden="true" style={{ color: '#fff', opacity: 0.95, paddingTop: 1 }}>
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M12 22s8-4.5 8-10V6l-8-4-8 4v6c0 5.5 8 10 8 10Z" fill="#0b2249"/>
                              </svg>
                            </span>
                            <div
                              style={{
                                fontSize: 12.5,
                                fontWeight: 800,
                                color: 'rgba(255,255,255,0.9)',
                                lineHeight: 1.35,
                                display: '-webkit-box',
                                WebkitLineClamp: 2,
                                WebkitBoxOrient: 'vertical',
                                overflow: 'hidden',
                              }}
                            >
                              {complaint.business_address || '—'}
                            </div>
                          </div>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end', gap: 10, flex: '0 0 auto' }}>
                          {source === 'history' ? (
                            <span className={statusBadgeClass(complaint?.status)} style={{ fontWeight: 900, whiteSpace: 'nowrap' }}>
                              {formatStatus(complaint?.status) ?? '—'}
                            </span>
                          ) : (
                            <span
                              className="status-badge"
                              style={{
                                ...getUrgencyStyle(complaint?.authenticity_level).badge,
                                fontWeight: 900,
                                fontSize: 12,
                                padding: '6px 10px',
                                borderRadius: 999,
                                display: 'inline-block',
                                whiteSpace: 'nowrap',
                                // keep original urgency colors (no forced white pill)
                                border: '1px solid rgba(0,0,0,0.08)',
                              }}
                            >
                              {getUrgencyText(complaint?.authenticity_level)}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Row: labels */}
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                          gap: 22,
                          alignItems: 'center',
                          marginTop: 10,
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                          <span aria-hidden="true" style={{ color: '#fff', opacity: 0.95 }}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                              <path d="M12 12c2.761 0 5-2.686 5-6s-2.239-5-5-5-5 2.686-5 6 2.239 5 5 5Zm0 2c-4.418 0-8 2.239-8 5v1h16v-1c0-2.761-3.582-5-8-5Z" fill="#0b2249"/>
                            </svg>
                          </span>
                          <span style={{ color: 'rgba(255,255,255,0.8)', fontWeight: 900, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4 }}>Reported By</span>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                          <span aria-hidden="true" style={{ color: '#fff', opacity: 0.95 }}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                              <path d="M7 2a1 1 0 0 1 1 1v1h8V3a1 1 0 1 1 2 0v1h1a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h1V3a1 1 0 1 1 2 0v1Zm13 7H4v10a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9ZM5 7h14V6H5v1Z" fill="#0b2249"/>
                            </svg>
                          </span>
                          <span style={{ color: 'rgba(255,255,255,0.8)', fontWeight: 900, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4 }}>Date Filed</span>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                          <span aria-hidden="true" style={{ color: '#fff', opacity: 0.95 }}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                              <path d="M12 2 20 6v6c0 5-3.5 9.5-8 10-4.5-.5-8-5-8-10V6l8-4Z" fill="#0b2249"/>
                            </svg>
                          </span>
                          <span style={{ color: 'rgba(255,255,255,0.8)', fontWeight: 900, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4 }}>Violations</span>
                        </div>
                      </div>

                      {/* Row: values */}
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                          gap: 22,
                          alignItems: 'center',
                          marginTop: -2,
                        }}
                      >
                        <div style={{ minWidth: 0, color: '#fff', fontWeight: 900, fontSize: 13.5 }}>{complaint.reporter_email || '—'}</div>
                        <div style={{ minWidth: 0, color: '#fff', fontWeight: 900, fontSize: 13.5 }}>{formatDatePipe(complaint.created_at)}</div>
                        <div style={{ minWidth: 0, color: '#fff', fontWeight: 900, fontSize: 13.5 }}>
                          {(() => {
                            const groups = groupComplaintCategoriesFromTags(complaint?.tags || []);
                            const total = groups.reduce((acc, g) => acc + (Array.isArray(g.subs) ? g.subs.length : 0), 0);
                            const cats = groups.length;
                            if (!total) return '—';
                            return `${total} across ${cats} ${cats === 1 ? 'category' : 'categories'}`;
                          })()}
                        </div>
                      </div>
                    </div>

                    {/* Complaint Description + Alleged Violations */}
                    <div style={{
                      background: '#ffffff',
                      border: '1px solid #e2e8f0',
                      borderRadius: 12,
                      padding: 16,
                    }}>
                      <div style={{ fontSize: 13, fontWeight: 900, color: '#0f172a', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                        Complaint Description
                      </div>

                      <div style={{ marginTop: 12, color: '#0f172a', whiteSpace: 'pre-wrap', lineHeight: 1.6, fontSize: 15 }}>
                        {complaint.complaint_description || '—'}
                      </div>

                      <div aria-hidden="true" style={{ height: 1, background: '#e2e8f0', marginTop: 14, marginBottom: 12 }} />

                      <div style={{ fontSize: 13, fontWeight: 900, color: '#0f172a', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                        Alleged Violations
                      </div>

                      {/* Violations: compact dropdown tags (full category names) */}
                      <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                        {(() => {
                          const groups = groupComplaintCategoriesFromTags(complaint?.tags || []);
                          if (!groups.length) return null;

                          return groups.map((g) => (
                            <details key={g.category} style={{ position: 'relative' }}>
                              <summary
                                style={{
                                  cursor: 'pointer',
                                  listStyle: 'none',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 8,
                                  padding: '4px 8px',
                                  borderRadius: 10,
                                  border: '1px solid #e2e8f0',
                                  background: '#f1f5f9',
                                  color: '#0f172a',
                                  fontWeight: 900,
                                  fontSize: 11,
                                  maxWidth: 520,
                                  whiteSpace: 'nowrap',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  boxShadow: '0 1px 0 rgba(2,6,23,0.03)',
                                }}
                                title={String(g.category)}
                              >
                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                  {String(g.category).replace(/\s*&\s*/g, ' and ')}
                                </span>
                                <span
                                  style={{
                                    marginLeft: 2,
                                    color: '#475569',
                                    fontWeight: 1000,
                                    fontSize: 11,
                                    flex: '0 0 auto',
                                    background: '#e2e8f0',
                                    borderRadius: 8,
                                    padding: '0px 5px',
                                    lineHeight: '16px',
                                    height: 16,
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                  }}
                                >
                                  {Array.isArray(g.subs) ? g.subs.length : 0}
                                </span>
                              </summary>

                              {Array.isArray(g.subs) && g.subs.length > 0 ? (
                                <div
                                  style={{
                                    position: 'absolute',
                                    left: 0,
                                    top: 'calc(100% + 8px)',
                                    zIndex: 20,
                                    minWidth: 260,
                                    maxWidth: 520,
                                    background: '#ffffff',
                                    border: '1px solid #e2e8f0',
                                    borderRadius: 14,
                                    boxShadow: '0 14px 34px rgba(2,6,23,0.18)',
                                    padding: 10,
                                  }}
                                >
                                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                    {g.subs.map((s) => (
                                      <span
                                        key={s}
                                        style={{
                                          background: '#f1f5f9',
                                          border: '1px solid #e2e8f0',
                                          borderRadius: 10,
                                          padding: '5px 7px',
                                          fontWeight: 900,
                                          color: '#0f172a',
                                          fontSize: 11,
                                          boxShadow: '0 1px 0 rgba(2,6,23,0.03)',
                                        }}
                                      >
                                        {s}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              ) : null}
                            </details>
                          ));
                        })()}
                      </div>
                    </div>

                    {/* Submitted Evidence */}
                    <div style={{
                      background: '#ffffff',
                      border: '1px solid #e2e8f0',
                      borderRadius: 12,
                      padding: 16,
                    }}>
                      <div style={{ fontSize: 13, fontWeight: 900, color: '#0f172a', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                        Submitted Evidence
                      </div>
                      <div style={{ marginTop: 12 }}>
                        {Array.isArray(complaint.image_urls) && complaint.image_urls.length > 0 ? (
                          <div
                            style={{
                              display: 'grid',
                              gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
                              gap: 12,
                              alignItems: 'start',
                            }}
                          >
                            {complaint.image_urls.map((url, idx) => (
                              <button
                                key={url}
                                type="button"
                                onClick={() => {
                                  setEvidenceIndex(idx);
                                  setPreviewImage(url);
                                }}
                                style={{
                                  border: '1px solid #e2e8f0',
                                  background: '#f8fafc',
                                  borderRadius: 12,
                                  padding: 10,
                                  cursor: 'pointer',
                                  textAlign: 'left',
                                  boxShadow: '0 1px 0 rgba(2,6,23,0.03)',
                                  outline: 'none',
                                  WebkitTapHighlightColor: 'transparent',
                                }}
                                title="Click to preview"
                              >
                                <div
                                  style={{
                                    width: '100%',
                                    height: 160,
                                    borderRadius: 10,
                                    overflow: 'hidden',
                                    background: '#ffffff',
                                    border: '1px solid #e2e8f0',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                  }}
                                >
                                  <img
                                    src={url}
                                    alt={`Evidence ${idx + 1}`}
                                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                                    loading="lazy"
                                  />
                                </div>
                                <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                                  <div style={{ fontSize: 12, fontWeight: 900, color: '#0f172a' }}>Evidence {idx + 1}</div>
                                  <div style={{ fontSize: 11, fontWeight: 900, color: '#64748b' }}>Preview</div>
                                </div>
                              </button>
                            ))}
                          </div>
                        ) : (
                          <div style={{ color: '#64748b', fontWeight: 700, fontSize: 13 }}>No images</div>
                        )}
                      </div>
                    </div>

                    {null}
                  </div>

                  {/* RIGHT COLUMN */}
                  <div style={{ display: 'grid', gap: 16, alignSelf: 'start', position: 'sticky', top: 14 }}>
                    {/* Comments */}
                    <div style={{
                      background: 'transparent',
                      border: 'none',
                      borderRadius: 0,
                      boxShadow: 'none',
                      padding: 0,
                    }}>
                      <style>{`
                        textarea:focus {
                          border-color: #2563eb !important;
                          box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1) !important;
                        }
                      `}</style>

                      {source !== 'history' ? (
                        <button
                          type="button"
                          className="dash-btn"
                          onClick={() => setShowRightCommentsEditor((v) => !v)}
                          style={{
                            width: '100%',
                            background: '#0b2249',
                            color: '#fff',
                            padding: '14px 16px',
                            fontSize: 15,
                            fontWeight: 1000,
                            borderRadius: 14,
                            justifyContent: 'center',
                            outline: 'none',
                            boxShadow: 'none',
                            border: 'none',
                          }}
                        >
                          {showRightCommentsEditor
                            ? 'Hide Comment Field'
                            : (declineComment.trim() ? 'Edit Comment' : 'Add Comment')}
                        </button>
                      ) : (
                        <div style={{
                          background: '#ffffff',
                          border: '1px solid #e2e8f0',
                          borderRadius: 12,
                          overflow: 'hidden',
                        }}>
                          <div style={{
                            padding: '14px 16px',
                            borderBottom: '1px solid #e2e8f0',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                          }}>
                            {(() => {
                              const s = String(complaint?.status || '').toLowerCase();
                              const isApproved = s === 'approved';
                              const isDeclined = s === 'declined';
                              const label = isApproved ? 'Approved Comments' : isDeclined ? 'Declined Comments' : 'General Comments';
                              const color = isApproved ? '#16a34a' : isDeclined ? '#dc2626' : '#0f172a';

                              return (
                                <div style={{ fontSize: 13, fontWeight: 1000, color, textTransform: 'uppercase', letterSpacing: 1.2 }}>
                                  {label}
                                </div>
                              );
                            })()}
                          </div>
                        </div>
                      )}

                      <div
                        style={{
                          overflow: 'hidden',
                          maxHeight: source === 'history' ? 520 : (showRightCommentsEditor ? 520 : 0),
                          opacity: source === 'history' ? 1 : (showRightCommentsEditor ? 1 : 0),
                          transform: source === 'history' ? 'translateY(0px)' : (showRightCommentsEditor ? 'translateY(0px)' : 'translateY(-6px)'),
                          transition: 'max-height 260ms ease, opacity 200ms ease, transform 200ms ease',
                        }}
                      >
                        <div style={{ marginTop: 12, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 16, boxShadow: '0 2px 10px rgba(2,6,23,0.06)', padding: 16 }}>
                          {source !== 'history' ? (
                            <>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                                <div>
                                  <div style={{ fontSize: 13, fontWeight: 900, color: '#0f172a', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                                    Decision Comment
                                  </div>
                                  <div style={{ marginTop: 4, fontSize: 12, color: '#64748b', fontWeight: 700 }}>
                                    Required for decline, optional for approval.
                                  </div>
                                </div>
                                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                                  <div style={{ fontSize: 12, fontWeight: 800, color: declineComment.trim() ? '#0f172a' : '#64748b' }}>
                                    {declineComment.trim().length} characters
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setDeclineComment('');
                                      setDeclineCommentError('');
                                      openCommentEditor();
                                    }}
                                    disabled={loading || savingDecision || !declineComment}
                                    style={{
                                      padding: '8px 12px',
                                      background: '#ffffff',
                                      border: '1px solid #cbd5e1',
                                      borderRadius: 10,
                                      color: '#334155',
                                      fontSize: 12,
                                      fontWeight: 800,
                                      cursor: loading || savingDecision || !declineComment ? 'not-allowed' : 'pointer',
                                      opacity: loading || savingDecision || !declineComment ? 0.55 : 1,
                                    }}
                                  >
                                    Clear
                                  </button>
                                </div>
                              </div>

                              <div style={{ marginTop: 14 }}>
                                <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.3px' }}>
                                  Quick Decline Reasons
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
                                  {DECLINE_TEMPLATES.map((template) => (
                                    <button
                                      key={template.id}
                                      type="button"
                                      onClick={() => handleCommentTemplateClick(template.text)}
                                      style={{
                                        padding: '8px 12px',
                                        background: '#ffffff',
                                        border: '1px solid #cbd5e1',
                                        borderRadius: 8,
                                        color: '#0f172a',
                                        fontSize: 12,
                                        fontWeight: 600,
                                        cursor: 'pointer',
                                        transition: 'all 0.2s ease',
                                        textAlign: 'left',
                                      }}
                                      onMouseEnter={(e) => {
                                        e.currentTarget.style.background = '#f1f5f9';
                                        e.currentTarget.style.borderColor = '#94a3b8';
                                      }}
                                      onMouseLeave={(e) => {
                                        e.currentTarget.style.background = '#ffffff';
                                        e.currentTarget.style.borderColor = '#cbd5e1';
                                      }}
                                      title={template.text}
                                    >
                                      {template.label}
                                    </button>
                                  ))}
                                </div>
                              </div>

                              <textarea
                                id="declineComment"
                                ref={commentInputRef}
                                value={declineComment}
                                onChange={(e) => handleCommentChange(e.target.value)}
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
                                  marginTop: 12,
                                }}
                              />

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

                            </>
                          ) : (
                            <div style={{
                              background: '#ffffff',
                              border: '1px solid #e2e8f0',
                              borderRadius: 12,
                              padding: 12,
                              color: '#0f172a',
                              fontSize: 14,
                              lineHeight: 1.6,
                              whiteSpace: 'pre-wrap',
                              minHeight: 110,
                            }}>
                              {declineComment || <span style={{ color: '#94a3b8', fontStyle: 'italic' }}>No comments</span>}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {null}
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
              <img src="/X icon.png" alt="Close" style={{ width: 16, height: 16, display: 'block', filter: 'brightness(0) invert(1)' }} />
            </button>
            
            {/* Left Arrow Button */}
            {complaint?.image_urls && complaint.image_urls.length > 1 && (
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
                  left: 20,
                  transform: 'translateY(-50%)',
                  background: 'rgba(15,23,42,0.85)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 999,
                  width: 50,
                  height: 50,
                  display: 'grid',
                  placeItems: 'center',
                  cursor: 'pointer',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                  padding: 0,
                  lineHeight: 0,
                  boxSizing: 'border-box',
                  zIndex: 10,
                  transition: 'all 0.2s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(15,23,42,0.95)';
                  e.currentTarget.style.transform = 'translateY(-50%) scale(1.1)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(15,23,42,0.85)';
                  e.currentTarget.style.transform = 'translateY(-50%) scale(1)';
                }}
              >
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style={{ display: 'block' }}>
                  <path d="M15 18L9 12L15 6" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            )}

            {/* Right Arrow Button */}
            {complaint?.image_urls && complaint.image_urls.length > 1 && (
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
                  right: 20,
                  transform: 'translateY(-50%)',
                  background: 'rgba(15,23,42,0.85)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 999,
                  width: 50,
                  height: 50,
                  display: 'grid',
                  placeItems: 'center',
                  cursor: 'pointer',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                  padding: 0,
                  lineHeight: 0,
                  boxSizing: 'border-box',
                  zIndex: 10,
                  transition: 'all 0.2s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(15,23,42,0.95)';
                  e.currentTarget.style.transform = 'translateY(-50%) scale(1.1)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(15,23,42,0.85)';
                  e.currentTarget.style.transform = 'translateY(-50%) scale(1)';
                }}
              >
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style={{ display: 'block' }}>
                  <path d="M10 6L16 12L10 18" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            )}

            {/* Image Counter */}
            {complaint?.image_urls && complaint.image_urls.length > 1 && (
              <div style={{
                position: 'absolute',
                bottom: 20,
                right: 20,
                background: 'rgba(15,23,42,0.85)',
                color: '#fff',
                fontWeight: 800,
                padding: '8px 14px',
                borderRadius: 8,
                fontSize: 14,
                zIndex: 10,
              }}>
                {evidenceIndex + 1} / {complaint.image_urls.length}
              </div>
            )}

            <img src={complaint?.image_urls?.[evidenceIndex] || previewImage} alt="Evidence Preview" className="overlay-full-img" />
          </div>
        </div>
      ) : null}
    </div>
  );
}
