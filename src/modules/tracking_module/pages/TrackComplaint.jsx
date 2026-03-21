import { useMemo, useState } from 'react';
import Header from '../../../components/Header';
import Footer from '../../../components/Footer';
import { getComplaintById, getComplaintTracking } from '../../../lib/complaints';
import { normalizeInspectionReportStatus, pickPreferredInspectionReport } from '../../../lib/inspectionReports';
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

function formatDurationBetweenLegacy(start, end = new Date()) {
  if (!start || !end) return 'â€”';

  const startDate = start instanceof Date ? start : new Date(start);
  const endDate = end instanceof Date ? end : new Date(end);
  const ms = endDate.getTime() - startDate.getTime();

  if (!Number.isFinite(ms) || ms < 0) return 'â€”';

  const totalMinutes = Math.floor(ms / 60000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;

  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  return parts.join(' ');
}

function formatDurationBetween(start, end) {
  if (!start || !end) return '—';

  const startDate = start instanceof Date ? start : new Date(start);
  const endDate = end instanceof Date ? end : new Date(end);
  const ms = endDate.getTime() - startDate.getTime();

  if (!Number.isFinite(ms) || ms < 0) return '—';

  const totalMinutes = Math.floor(ms / 60000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;

  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  return parts.join(' ');
}

function pickCompletedInspectionWithRemarks(reports) {
  const candidates = (reports || []).filter((report) => {
    const status = normalizeInspectionReportStatus(report);
    return status === 'completed' && String(report?.inspection_comments || '').trim();
  });

  if (!candidates.length) return null;
  return pickPreferredInspectionReport(candidates);
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

  const loadTrackingData = async (rawId) => {
    const idRaw = String(rawId || '').trim();
    if (!idRaw) {
      throw new Error('Please enter your complaint ID.');
    }

    const idForQuery = /^\d+$/.test(idRaw) ? Number(idRaw) : idRaw;
    const data = await getComplaintTracking(idForQuery);
    setComplaint(data.complaint);
    setRelated({ missionOrders: data.missionOrders, inspections: data.inspections });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setComplaint(null);

    try {
      setLoading(true);
      await loadTrackingData(complaintId);
    } catch (err) {
      setError(err?.message || 'Unable to find this complaint ID.');
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    if (!complaint?.id && !String(complaintId || '').trim()) return;

    try {
      setLoading(true);
      setError('');
      await loadTrackingData(complaint?.id || complaintId);
    } catch (err) {
      setError(err?.message || 'Unable to refresh complaint tracking.');
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
                <div className="track-result-title-row">
                  <h2 className="track-title">Complaint Status</h2>
                  <button
                    type="button"
                    className="track-refresh-btn"
                    onClick={handleRefresh}
                    disabled={loading}
                    aria-label="Refresh complaint tracking"
                    title="Refresh"
                  >
                    <img src="/refresh.png" alt="" aria-hidden="true" className="track-refresh-icon" />
                  </button>
                </div>
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
                const latestInspection = pickPreferredInspectionReport(inspections);
                const resolutionInspection = pickCompletedInspectionWithRemarks(inspections) || latestInspection;
                const hasAnyInspection = Boolean(latestInspection);
                const inspectionStatus = normalizeInspectionReportStatus(latestInspection);
                const inspectionCompleted = inspectionStatus === 'completed';
                const inspectionInProgress = inspectionStatus === 'in progress';
                const inspectionStartedAt = latestInspection?.started_at ? new Date(latestInspection.started_at) : null;
                const inspectionCompletedAt = latestInspection?.completed_at ? new Date(latestInspection.completed_at) : null;

                // Document Processing (MO) timestamps
                const hasMo = missionOrders.length > 0;
                const moCreatedAt = hasMo && missionOrders[0]?.created_at ? new Date(missionOrders[0].created_at) : null;
                // UX requirement: Document Processing resolution time starts when the complaint was received,
                // not when the draft mission order was created.
                const moStartAt = receivedDate;
                const moPreapprovedAt = (() => {
                  const times = (missionOrders || [])
                    .map((m) => m?.director_preapproved_at)
                    .filter(Boolean)
                    .map((t) => new Date(t));
                  return times.length ? times.sort((a, b) => a - b)[0] : null;
                })();

                const moComplete = Boolean(moPreapprovedAt);
                const moInProgress = !isDeclined && (hasMo || (isDecided && s === 'approved')) && !moComplete;
                const moStatusLabel = isDeclined ? 'Not applicable' : (moComplete ? 'Complete' : (moInProgress ? 'In-Progress' : '—'));

                const moResolutionTime = (() => {
                  if (!moComplete || !moStartAt || !moPreapprovedAt) return '—';
                  const ms = moPreapprovedAt.getTime() - moStartAt.getTime();
                  if (!Number.isFinite(ms) || ms < 0) return '—';

                  const totalMinutes = Math.floor(ms / 60000);
                  const days = Math.floor(totalMinutes / (60 * 24));
                  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
                  const minutes = totalMinutes % 60;

                  const parts = [];
                  if (days) parts.push(`${days}d`);
                  if (hours) parts.push(`${hours}h`);
                  parts.push(`${minutes}m`);
                  return parts.join(' ');
                })();

                const inspectionStatusLabel = inspectionCompleted
                  ? 'Complete'
                  : inspectionInProgress
                    ? 'In Progress'
                    : hasAnyInspection || moComplete
                      ? 'Pending Inspection'
                      : 'â€”';

                const inspectionStatusClass = inspectionCompleted
                  ? 'status-complete'
                  : inspectionInProgress
                    ? 'status-inprogress'
                    : hasAnyInspection || moComplete
                      ? 'status-pending-inspection'
                    : '';

                const inspectionResolutionTime = inspectionInProgress
                  ? formatDurationBetween(inspectionStartedAt, new Date())
                  : inspectionCompleted
                    ? formatDurationBetween(inspectionStartedAt, inspectionCompletedAt)
                    : 'â€”';

                const inspectionResolutionTimeDisplay = inspectionCompleted
                  ? formatDurationBetween(inspectionStartedAt, inspectionCompletedAt)
                  : '';

                const inspectionStepReached = hasAnyInspection || moComplete;

                const inspectionStatusText = inspectionCompleted
                  ? 'Complete'
                  : inspectionInProgress
                    ? 'In Progress'
                    : inspectionStepReached
                      ? 'Pending Inspection'
                      : '—';

                const inspectionResolutionTimeText = inspectionCompleted
                  ? formatDurationBetween(inspectionStartedAt, inspectionCompletedAt)
                  : '—';

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

                const inspectionRemarks = String(resolutionInspection?.inspection_comments || '').trim();

                // Resolution can now show the inspection remarks as soon as the inspection is completed.
                // We still also treat completed mission orders as resolved for downstream tracking state.
                const missionOrderIsComplete = (missionOrders || []).some((m) => {
                  const ms = String(m?.status || '').toLowerCase();
                  return ms === 'complete' || ms === 'completed' || ms === 'done';
                });

                const showFindingsSummary = inspectionCompleted;

                const effectiveIsResolved = isDeclined || inspectionCompleted;
                const resolutionStepCompleted = isDeclined || inspectionCompleted;

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
                            <div className="vtl-detail"><span className="vtl-detail-label">Status:</span> <span className={`vtl-detail-value ${s === 'approved' ? 'status-approved' : (s === 'declined' || s === 'rejected') ? 'status-declined' : ''}`}>{decisionLabel}</span></div>
                          ) : null}
                          <div className="vtl-detail"><span className="vtl-detail-label">Date:</span> <span className="vtl-detail-value">{fmt(isDecided ? decisionDate : reviewDate)}</span></div>
                        </div>
                      </div>

                      {isDeclined ? (
                        <div
                          style={{
                            marginTop: 14,
                            background: '#ffffff',
                            border: '1px solid #e2e8f0',
                            borderRadius: 12,
                            overflow: 'hidden',
                          }}
                        >
                          <div
                            style={{
                              padding: '12px 14px',
                              borderBottom: '1px solid #e2e8f0',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              gap: 10,
                            }}
                          >
                            <div style={{ fontSize: 13, fontWeight: 1000, color: '#dc2626', textTransform: 'uppercase', letterSpacing: 1.2 }}>
                              Declined Comments
                            </div>
                          </div>

                          <div style={{ padding: 14, background: '#f8fafc' }}>
                            <div
                              style={{
                                background: '#ffffff',
                                border: '1px solid #e2e8f0',
                                borderRadius: 12,
                                padding: 12,
                                color: '#0f172a',
                                fontSize: 14,
                                lineHeight: 1.6,
                                whiteSpace: 'pre-wrap',
                                minHeight: 90,
                              }}
                            >
                              {complaint?.decline_comment || complaint?.declined_comment || '—'}
                            </div>
                          </div>
                        </div>
                      ) : (
                        <>
                          {/* Step 3 - Document Processing */}
                          <div className={`vtl-step ${moComplete ? 'completed' : (moInProgress ? 'active' : 'inactive')}`}>
                            <div className="vtl-marker">{moComplete ? '✓' : 3}</div>
                            <div className="vtl-content">
                              <div className="vtl-title">Document Processing</div>
                              <div className="vtl-desc">Preparing documents needed for inspection</div>
                              <>
                                <div className="vtl-detail"><span className="vtl-detail-label">Status:</span> <span className={`vtl-detail-value ${moComplete ? 'status-complete' : (moInProgress ? 'status-inprogress' : '')}`}>{moStatusLabel}</span></div>
                                <div className="vtl-detail"><span className="vtl-detail-label">Resolution Time:</span> <span className="vtl-detail-value">{moResolutionTime}</span></div>
                                <div className="vtl-detail"><span className="vtl-detail-label">Date:</span> <span className="vtl-detail-value">{moComplete ? fmt(moPreapprovedAt) : '—'}</span></div>
                              </>
                            </div>
                          </div>

                          {/* Step 4 - Inspection (MO Workflow + Inspection Workflow) */}
                          <div className={`vtl-step ${inspectionCompleted ? 'completed' : ((inspectionInProgress || moComplete) ? 'active' : 'inactive')}`}>
                            <div className="vtl-marker">{inspectionCompleted ? '✓' : 4}</div>
                            <div className="vtl-content">
                              <div className="vtl-title">Inspection</div>
                              <div className="vtl-desc">An inspection will be conducted to verify this complaint</div>
                              <>
                                <div className="vtl-detail"><span className="vtl-detail-label">Status:</span> <span className={`vtl-detail-value ${inspectionStatusClass}`}>{inspectionStatusText}</span></div>
                                <div className="vtl-detail"><span className="vtl-detail-label">Resolution Time:</span> <span className="vtl-detail-value">{inspectionResolutionTimeText}</span></div>
                                <div className="vtl-detail"><span className="vtl-detail-label">Date:</span> <span className="vtl-detail-value">{fmt(inspectionCompletedAt)}</span></div>
                              </>
                            </div>
                          </div>

                          {/* Step 5 - Resolution */}
                          <div className={`vtl-step ${resolutionStepCompleted ? 'completed' : 'inactive'}`}>
                            <div className="vtl-marker">{effectiveIsResolved ? '✓' : 5}</div>
                            <div className="vtl-content">
                              <div className="vtl-title">Resolution</div>
                              <div className="vtl-desc">
                                {showFindingsSummary
                                  ? 'Inspection completed. Summary from the inspector remarks is shown below.'
                                  : 'Summary of findings will appear after the inspection is completed.'}
                              </div>
                              {showFindingsSummary ? (
                                <div style={{ marginTop: 6 }}>
                                  <div style={{ marginTop: 2 }}>
                                    <div className="vtl-desc" style={{ fontWeight: 800, margin: 0 }}>Inspector remarks</div>
                                    <div
                                      style={{
                                        marginTop: 8,
                                        padding: 12,
                                        background: '#f8fafc',
                                        border: '1px solid #e2e8f0',
                                        borderRadius: 12,
                                        color: '#0f172a',
                                        fontSize: 14,
                                        lineHeight: 1.6,
                                        whiteSpace: 'pre-wrap',
                                      }}
                                    >
                                      {inspectionRemarks || 'No remarks were provided in the inspection slip.'}
                                    </div>
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          </div>
                        </>
                      )}
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
