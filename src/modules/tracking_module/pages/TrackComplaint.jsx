import { useMemo, useState } from 'react';
import Header from '../../../components/Header';
import Footer from '../../../components/Footer';
import { getComplaintById, getComplaintTracking } from '../../../lib/complaints';
import './TrackComplaint.css';

function formatStatus(status) {
  if (!status) return 'Unknown';
  return String(status)
    .replace(/_/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDateTime(date) {
  if (!date) return '—';
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '—';

  // Month day, yyyy (word format) + time (no milliseconds)
  const datePart = d.toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  const timePart = d.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  return `${datePart} | ${timePart}`;
}

function statusBadgeClass(status) {
  const s = String(status || '').toLowerCase();
  if (['resolved', 'closed', 'completed', 'done'].includes(s)) return 'status-badge status-success';
  if (['rejected', 'invalid', 'cancelled', 'canceled', 'declined'].includes(s)) return 'status-badge status-danger';
  if (['pending', 'new', 'submitted'].includes(s)) return 'status-badge status-warning';
  if (['in_progress', 'in progress', 'processing', 'under_review', 'under review'].includes(s)) return 'status-badge status-info';
  return 'status-badge';
}

// Map complaint status to progress step based on actual system statuses
function getStatusStep(status) {
  const s = String(status || '').toLowerCase();
  
  // Define the ordered steps using only actual statuses in the system
  const steps = [
    { index: 0, statuses: ['submitted', 'new', 'pending'] },
    { index: 1, statuses: ['approved', 'declined'] },
  ];
  
  for (const step of steps) {
    if (step.statuses.includes(s)) {
      return step.index;
    }
  }
  
  return 0; // Default to first step
}

const PROGRESS_STEPS = [
  'Submitted',
  'Decision',
];

export default function TrackComplaint() {
  const [complaintId, setComplaintId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [complaint, setComplaint] = useState(null);
  const [related, setRelated] = useState({ missionOrders: [], inspections: [] });

  const canSearch = useMemo(() => String(complaintId).trim().length > 0, [complaintId]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setComplaint(null);

    const idRaw = String(complaintId).trim();
    if (!idRaw) {
      setError('Please enter your complaint ID.');
      return;
    }

    // complaints.id is likely numeric; allow either numeric or uuid-like input.
    const idForQuery = /^\d+$/.test(idRaw) ? Number(idRaw) : idRaw;

    try {
      setLoading(true);
      const data = await getComplaintTracking(idForQuery);
      setComplaint(data.complaint);
      setRelated({ missionOrders: data.missionOrders, inspections: data.inspections });
    } catch (err) {
      setError(err?.message || 'Unable to find this complaint ID.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="track-container">
      <Header />
      <main className="track-main">
        <section className="track-card">
          {!complaint ? (
            <>
              <h2 className="track-title">Track Complaint Status</h2>
              <p className="track-subtitle">Enter your complaint ID to view the current status.</p>

              <form className="track-form" onSubmit={handleSubmit}>
                <label className="track-label" htmlFor="complaintId">Complaint ID</label>
                <div className="track-input-row">
                  <input
                    id="complaintId"
                    className="track-input"
                    type="text"
                    inputMode="numeric"
                    placeholder="e.g., 123"
                    value={complaintId}
                    onChange={(e) => setComplaintId(e.target.value)}
                  />
                  <button className="btn btn-primary" type="submit" disabled={!canSearch || loading}>
                    {loading ? 'Checking…' : 'Check Status'}
                  </button>
                </div>
              </form>

              {error ? <div className="track-alert track-alert-error">{error}</div> : null}

              <div className="track-help">
                <span className="track-help-text">Need to file a new complaint? </span>
                <a className="track-back" href="/">Back to Home</a>
              </div>
            </>
          ) : (
            <div className="track-result">
              <div className="track-result-header">
                <h2 className="track-title">Complaint Status</h2>
                <div className="track-meta-container">
                  <div className="track-meta-left">
                    <div className="track-meta-item">
                      <span className="track-meta-label">Complaint ID:</span>
                      <span className="track-meta-value monospace">{complaint.id}</span>
                    </div>
                    <div className="track-meta-item">
                      <span className="track-meta-label">Reported by:</span>
                      <span className="track-meta-value">{complaint.reporter_email || '—'}</span>
                    </div>
                  </div>
                </div>
              </div>
              {/* Vertical Complaint Progress */}
              {(() => {
                const s = String(complaint.status || '').toLowerCase();
                // Related entities
                const missionOrders = related.missionOrders || [];
                const inspections = related.inspections || [];

                // Helper dates
                const receivedDate = complaint.created_at ? new Date(complaint.created_at) : null;
                const reviewDate = complaint.updated_at ? new Date(complaint.updated_at) : null;
                const approvedDate = complaint.approved_at ? new Date(complaint.approved_at) : null;
                const declinedDate = complaint.declined_at ? new Date(complaint.declined_at) : null;

                // Decision state
                const isDecided = ['approved', 'declined', 'rejected'].includes(s);
                const isDeclined = ['declined', 'rejected', 'invalid'].includes(s);
                const decisionLabel = s === 'approved' ? 'Approved' : isDeclined ? 'Declined' : 'Pending';
                const decisionDate = isDecided ? (approvedDate || declinedDate || reviewDate) : null;

                // Inspection step is driven by inspection_reports presence and status
                const hasAnyInspection = inspections.length > 0;
                const latestInspection = hasAnyInspection ? inspections[inspections.length - 1] : null;
                const inspectionStatus = latestInspection ? String(latestInspection.status || '').toLowerCase() : '';
                const inspectionCompleted = inspectionStatus === 'completed';
                const inspectionInProgress = ['in_progress', 'in progress', 'ongoing', 'processing'].includes(inspectionStatus);
                const inspectionStartedAt = latestInspection?.created_at ? new Date(latestInspection.created_at) : null;
                const inspectionCompletedAt = latestInspection?.completed_at ? new Date(latestInspection.completed_at) : null;

                // Document Processing (MO) timestamps
                const hasMo = missionOrders.length > 0;
                const moCreatedAt = hasMo && missionOrders[0]?.created_at ? new Date(missionOrders[0].created_at) : null;
                const moPreapprovedAt = (() => {
                  const times = (missionOrders || [])
                    .map((m) => m?.director_preapproved_at)
                    .filter(Boolean)
                    .map((t) => new Date(t));
                  return times.length ? times.sort((a, b) => a - b)[0] : null;
                })();

                // Resolution step rules:
                // - If declined: resolution is case closed at decision date.
                // - Else if inspection completed: resolution by inspection completion.
                // - Else terminal complaint states also considered resolved.
                const complaintMarkedComplete = ['resolved', 'closed', 'completed', 'done'].includes(s);
                const hasGeneratedInspectionSlipDocx = !!latestInspection?.generated_docx_url;
                const isResolved = isDeclined || complaintMarkedComplete || (inspectionCompleted && hasGeneratedInspectionSlipDocx);
                const resolutionDate = isDeclined ? (declinedDate || reviewDate) : (inspectionCompletedAt || approvedDate || declinedDate || null);
                const resolutionLabel = isDeclined
                  ? 'Case Closed'
                  : complaintMarkedComplete || (inspectionCompleted && hasGeneratedInspectionSlipDocx)
                    ? 'Business Inspected'
                    : inspectionCompleted
                      ? 'Inspection Completed'
                      : (s === 'approved' ? 'Approved' : 'Pending');

                const formatFindingStatus = (value) => {
                  const raw = String(value ?? '').trim().toLowerCase();
                  if (!raw) return '—';
                  if (raw === 'compliant') return 'Compliant';
                  if (raw === 'non_compliant') return 'Non-Compliant';
                  if (raw === 'na' || raw === 'n/a') return 'N/A';
                  return raw.replace(/_/g, ' ').replace(/\s+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
                };

                const cctvCountNum = Number(latestInspection?.cctv_count);
                const cctvCountDisplay =
                  Number.isFinite(cctvCountNum) && cctvCountNum > 0
                    ? `${cctvCountNum} CCTV${cctvCountNum === 1 ? '' : 's'}`
                    : null;

                const permitSummary = formatFindingStatus(latestInspection?.business_permit_status);
                const cctvSummaryBase = formatFindingStatus(latestInspection?.cctv_status);
                const cctvSummary =
                  cctvSummaryBase === 'Compliant' && cctvCountDisplay ? `Compliant (${cctvCountDisplay})` : cctvSummaryBase;
                const signageSummary = formatFindingStatus(latestInspection?.signage_status);

                // We mark tracking complete when the inspector downloads the slip.
                // That action updates mission_orders.status = 'complete' (best-effort).
                const missionOrderIsComplete = (missionOrders || []).some((m) => {
                  const ms = String(m?.status || '').toLowerCase();
                  return ms === 'complete' || ms === 'completed' || ms === 'done';
                });

                const showFindingsSummary =
                  inspectionCompleted &&
                  (complaintMarkedComplete || missionOrderIsComplete) &&
                  hasGeneratedInspectionSlipDocx;

                const effectiveIsResolved = isDeclined || complaintMarkedComplete || missionOrderIsComplete;

                // Utility to render date nicely
                const fmt = (d) => formatDateTime(d);

                return (
                  <div className="progress-card">
                    <div className="progress-card-header">
                      <img src="/ui_icons/revision.png" alt="" className="progress-card-header-icon" />
                      <span className="progress-card-title">COMPLAINT PROGRESS</span>
                    </div>
                    <div className="vtl">
                      {/* Step 1 - Complaint Received */}
                      <div className={`vtl-step completed`}>
                        <div className="vtl-marker">✓</div>
                        <div className="vtl-content">
                          <div className="vtl-title">Complaint Received</div>
                          <div className="vtl-desc">Your complaint has been logged in our system</div>
                          <div className="vtl-detail"><span className="vtl-detail-label">Date:</span> <span className="vtl-detail-value">{fmt(receivedDate)}</span></div>
                        </div>
                      </div>

                      {/* Step 2 - Under Review */}
                      <div className={`vtl-step ${isDecided ? 'completed' : 'active'}`}>
                        <div className="vtl-marker">{isDecided ? '✓' : 2}</div>
                        <div className="vtl-content">
                          <div className="vtl-title">Under Review</div>
                          <div className="vtl-desc">Director is reviewing your complaint</div>
                          {isDecided ? (
                            <div className="vtl-detail"><span className="vtl-detail-label">Director Decision:</span> <span className={`vtl-detail-value ${s === 'approved' ? 'status-approved' : (s === 'declined' || s === 'rejected') ? 'status-declined' : ''}`}>{decisionLabel}</span></div>
                          ) : null}
                          <div className="vtl-detail"><span className="vtl-detail-label">Date:</span> <span className="vtl-detail-value">{fmt(isDecided ? decisionDate : reviewDate)}</span></div>
                        </div>
                      </div>

                      {/* Step 3 - Document Processing */}
                      <div className={`vtl-step ${isDeclined ? 'inactive' : (moPreapprovedAt ? 'completed' : ((hasMo || (isDecided && s === 'approved')) ? 'active' : 'inactive'))}`}>
                        <div className="vtl-marker">{isDeclined ? 3 : (moPreapprovedAt ? '✓' : 3)}</div>
                        <div className="vtl-content">
                          <div className="vtl-title">Document Processing</div>
                          <div className="vtl-desc">Preparing documents needed for inspection</div>
                          {isDeclined ? (
                            <div className="vtl-detail"><span className="vtl-detail-label">Status:</span> <span className="vtl-detail-value">Not applicable</span></div>
                          ) : (
                            <>
                              <div className="vtl-detail"><span className="vtl-detail-label">Status:</span> <span className="vtl-detail-value">{moPreapprovedAt ? 'Pre-Approved' : (hasMo ? 'In Progress' : (isDecided && s === 'approved' ? 'Pending' : '—'))}</span></div>
                              <div className="vtl-detail"><span className="vtl-detail-label">Created:</span> <span className="vtl-detail-value">{fmt(moCreatedAt)}</span></div>
                              <div className="vtl-detail"><span className="vtl-detail-label">Pre-Approved:</span> <span className="vtl-detail-value">{fmt(moPreapprovedAt)}</span></div>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Step 4 - Inspection (MO Workflow + Inspection Workflow) */}
                      <div className={`vtl-step ${isDeclined ? 'inactive' : (inspectionCompleted ? 'completed' : (inspectionInProgress ? 'active' : 'inactive'))}`}>
                        <div className="vtl-marker">{isDeclined ? 4 : (inspectionCompleted ? '✓' : 4)}</div>
                        <div className="vtl-content">
                          <div className="vtl-title">Inspection</div>
                          <div className="vtl-desc">MO Workflow + Inspection Workflow</div>
                          {isDeclined ? (
                            <div className="vtl-detail"><span className="vtl-detail-label">Status:</span> <span className="vtl-detail-value">Not applicable</span></div>
                          ) : (
                            <>
                              <div className="vtl-detail"><span className="vtl-detail-label">Status:</span> <span className="vtl-detail-value">{inspectionCompleted ? 'Completed' : (inspectionInProgress ? 'In Progress' : '—')}</span></div>
                              <div className="vtl-detail"><span className="vtl-detail-label">Started:</span> <span className="vtl-detail-value">{fmt(inspectionStartedAt)}</span></div>
                              <div className="vtl-detail"><span className="vtl-detail-label">Completed:</span> <span className="vtl-detail-value">{fmt(inspectionCompletedAt)}</span></div>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Step 5 - Resolution */}
                      <div className={`vtl-step ${effectiveIsResolved ? 'active' : 'inactive'}`}>
                        <div className="vtl-marker">{effectiveIsResolved ? '✓' : 5}</div>
                        <div className="vtl-content">
                          <div className="vtl-title">Resolution</div>
                          <div className="vtl-desc">
                            {isDeclined
                              ? 'Case closed — no inspection will take place.'
                              : showFindingsSummary
                                ? 'Business has been inspected. Findings summary (no internal assessments).'
                                : 'Summary of findings will appear after the inspection slip is downloaded.'}
                          </div>
                          {showFindingsSummary ? (
                            <div style={{ marginTop: 12 }}>
                              <div className="vtl-detail">
                                <span className="vtl-detail-label">Inspected on:</span>{' '}
                                <span className="vtl-detail-value">{fmt(inspectionCompletedAt)}</span>
                              </div>
                              <div style={{ marginTop: 10, fontWeight: 900, color: '#0f172a' }}>
                                <div className="vtl-desc" style={{ fontWeight: 800, margin: 0 }}>Findings summary</div>
                                <div style={{ marginTop: 6 }}>
                                  <span style={{ fontWeight: 900 }}>Business Permit:</span> <span style={{ fontWeight: 800 }}>{permitSummary}</span>
                                </div>
                                <div style={{ marginTop: 6 }}>
                                  <span style={{ fontWeight: 900 }}>With CCTV:</span> <span style={{ fontWeight: 800 }}>{cctvSummary}</span>
                                </div>
                                <div style={{ marginTop: 6 }}>
                                  <span style={{ fontWeight: 900 }}>2sqm Signage:</span> <span style={{ fontWeight: 800 }}>{signageSummary}</span>
                                </div>
                              </div>
                            </div>
                          ) : null}
                                                  </div>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Director Decision (industry-standard: clear outcome + timestamp + reason for decline) */}
              <div className="complaint-summary">
                {/* Complaint Summary - 2-Column Grid Layout */}
                {/* Row 1: Business (Left) + Address (Right) */}
                <div className="summary-row-2col">
                  <div className="summary-card">
                    <div className="summary-item-header">
                      <img src="/ui_icons/Business.png" alt="Business" className="summary-item-icon" />
                      <span className="summary-label">Business</span>
                    </div>
                    <span className="summary-value">{complaint.business_name || '—'}</span>
                  </div>
                  <div className="summary-card">
                    <div className="summary-item-header">
                      <img src="/ui_icons/Address.png" alt="Address" className="summary-item-icon" />
                      <span className="summary-label">Address</span>
                    </div>
                    <span className="summary-value summary-address">{complaint.business_address || '—'}</span>
                  </div>
                </div>

                {/* Row 2: Complaint Description (Full Width) */}
                <div className="summary-row-full">
                  <div className="summary-card summary-card-with-footer">
                    <div>
                      <div className="summary-item-header">
                        <img src="/ui_icons/Complaint Description.png" alt="Description" className="summary-item-icon" />
                        <span className="summary-label">Complaint Description</span>
                      </div>
                      <span className="summary-value summary-description">
                        {complaint.complaint_description || '—'}
                      </span>
                    </div>
                                      </div>
                </div>
              </div>

              <div className="track-result-actions">
                <button 
                  className="btn btn-primary"
                  onClick={() => {
                    setComplaint(null);
                    setComplaintId('');
                  }}
                >
                  Back to Tracking
                </button>
              </div>
            </div>
          )}
        </section>
      </main>
      <Footer />
    </div>
  );
}
