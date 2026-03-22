import { useMemo, useState } from 'react';
import Header from '../../../components/Header';
import Footer from '../../../components/Footer';
import { getComplaintTracking } from '../../../lib/complaints';
import { normalizeInspectionReportStatus, pickPreferredInspectionReport } from '../../../lib/inspectionReports';
import './TrackComplaint.css';

const COMPLIANCE_OPTIONS = ['Full Compliance', 'Partial Compliance', 'Non-Compliance'];
const MISSION_ORDER_INSPECTION_READY_STATUSES = new Set(['for inspection', 'for_inspection', 'complete', 'completed', 'done']);
const MISSION_ORDER_COMPLETE_STATUSES = new Set(['complete', 'completed', 'done']);

function formatDateTime(date) {
  if (!date) return '—';
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '—';

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

function parseInspectionComments(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return {
      complianceStatus: '',
      remarks: '',
    };
  }

  const legacyMatch = raw.match(
    /^Compliance Status:\s*(Full Compliance|Partial Compliance|Non-Compliance)\s*(?:\r?\n){1,2}([\s\S]*)$/i
  );

  if (legacyMatch) {
    return {
      complianceStatus:
        COMPLIANCE_OPTIONS.find((option) => option.toLowerCase() === String(legacyMatch[1] || '').toLowerCase()) || '',
      remarks: String(legacyMatch[2] || '').trim(),
    };
  }

  const tagMatch = raw.match(/^\[(Full Compliance|Partial Compliance|Non-Compliance)\]\s*/i);
  if (!tagMatch) {
    return {
      complianceStatus: '',
      remarks: raw,
    };
  }

  return {
    complianceStatus:
      COMPLIANCE_OPTIONS.find((option) => option.toLowerCase() === String(tagMatch[1] || '').toLowerCase()) || '',
    remarks: raw.replace(tagMatch[0], '').trim(),
  };
}

function pickLatestInspectionRecord(reports, predicate = () => true) {
  const candidates = (reports || []).filter(predicate);
  if (!candidates.length) return null;

  return [...candidates].sort((a, b) => {
    const aTime = new Date(a?.updated_at || a?.completed_at || a?.created_at || 0).getTime();
    const bTime = new Date(b?.updated_at || b?.completed_at || b?.created_at || 0).getTime();
    return bTime - aTime;
  })[0];
}

function pickLatestMissionOrderRecord(records, predicate = () => true) {
  const candidates = (records || []).filter(predicate);
  if (!candidates.length) return null;

  return [...candidates].sort((a, b) => {
    const aTime = new Date(a?.updated_at || a?.submitted_at || a?.created_at || 0).getTime();
    const bTime = new Date(b?.updated_at || b?.submitted_at || b?.created_at || 0).getTime();
    return bTime - aTime;
  })[0];
}

function formatComplaintStatusLabel(status) {
  const s = String(status || '').toLowerCase().trim();
  if (!s) return 'Pending';
  if (s === 'on_hold') return 'On Hold';
  if (s === 'submitted') return 'Submitted';
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

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

              {(() => {
                const s = String(complaint.status || '').toLowerCase();
                const missionOrders = related.missionOrders || [];
                const inspections = related.inspections || [];

                const receivedDate = complaint.created_at ? new Date(complaint.created_at) : null;
                const reviewDate = complaint.updated_at ? new Date(complaint.updated_at) : null;
                const approvedDate = complaint.approved_at ? new Date(complaint.approved_at) : null;
                const declinedDate = complaint.declined_at ? new Date(complaint.declined_at) : null;

                const isDeclined = ['declined', 'rejected', 'invalid'].includes(s);
                const reviewCompleteStatuses = ['approved', 'declined', 'rejected', 'invalid', 'completed', 'cancelled'];
                const reviewActiveStatuses = ['submitted', 'pending', 'new', 'on_hold'];
                const reviewCompleted = reviewCompleteStatuses.includes(s);
                const reviewStatusLabel = formatComplaintStatusLabel(s || 'pending');
                const reviewStatusClass =
                  s === 'approved' || s === 'completed'
                    ? 'status-approved'
                    : isDeclined || s === 'cancelled'
                      ? 'status-declined'
                      : s === 'on_hold'
                        ? 'status-inprogress'
                        : '';
                const reviewDescription =
                  s === 'completed'
                    ? 'Complaint review is complete and the case has moved forward.'
                    : s === 'approved'
                      ? 'Director approved your complaint for further action.'
                      : isDeclined
                        ? 'Director finished reviewing your complaint.'
                        : s === 'cancelled'
                          ? 'This complaint review has been cancelled.'
                          : s === 'on_hold'
                            ? 'Complaint review is temporarily on hold.'
                            : 'Director is reviewing your complaint.';
                const reviewDateValue = reviewCompleted
                  ? (approvedDate || declinedDate || reviewDate)
                  : reviewActiveStatuses.includes(s)
                    ? (reviewDate || receivedDate)
                    : reviewDate;

                const latestMissionOrder = pickLatestMissionOrderRecord(missionOrders);
                const latestMissionOrderStatus = String(latestMissionOrder?.status || '').toLowerCase().trim();
                const hasAnyInspection = inspections.length > 0;
                const latestInspection = hasAnyInspection ? pickPreferredInspectionReport(inspections) : null;
                const latestInspectionRecord = latestInspection;
                const latestCompletedInspection = pickLatestInspectionRecord(
                  inspections,
                  (report) => normalizeInspectionReportStatus(report) === 'completed'
                );
                const latestRemarksInspection = pickLatestInspectionRecord(
                  inspections,
                  (report) => String(report?.inspection_comments || '').trim().length > 0
                );
                const resolutionInspection = latestCompletedInspection || latestRemarksInspection || latestInspectionRecord || latestInspection;
                const remarksInfo = parseInspectionComments(
                  latestRemarksInspection?.inspection_comments || resolutionInspection?.inspection_comments
                );
                const normalizedInspectionStatus = normalizeInspectionReportStatus(latestInspectionRecord || latestInspection);
                const inspectionUnlockedByMissionOrder = MISSION_ORDER_INSPECTION_READY_STATUSES.has(latestMissionOrderStatus);
                const inspectionCompleted =
                  Boolean(latestCompletedInspection) ||
                  normalizedInspectionStatus === 'completed';
                const inspectionInProgress = !inspectionCompleted && Boolean(latestInspectionRecord);
                const inspectionStartedAt = latestInspectionRecord?.started_at
                  ? new Date(latestInspectionRecord.started_at)
                  : null;
                const inspectionProgressAt = latestInspectionRecord?.updated_at || latestInspectionRecord?.started_at
                  ? new Date(latestInspectionRecord?.updated_at || latestInspectionRecord?.started_at)
                  : null;
                const inspectionCompletedAt = latestInspectionRecord?.completed_at
                  ? new Date(latestInspectionRecord.completed_at)
                  : null;
                const inspectionDateValue = inspectionCompletedAt || inspectionProgressAt;

                const hasMo = Boolean(latestMissionOrder);
                const moStartAt = receivedDate;
                const moPreapprovedAt = latestMissionOrder?.director_preapproved_at
                  ? new Date(latestMissionOrder.director_preapproved_at)
                  : null;

                const moTouchedAt = latestMissionOrder?.updated_at || latestMissionOrder?.submitted_at || latestMissionOrder?.created_at
                  ? new Date(latestMissionOrder?.updated_at || latestMissionOrder?.submitted_at || latestMissionOrder?.created_at)
                  : null;
                const moComplete = Boolean(moPreapprovedAt) || MISSION_ORDER_COMPLETE_STATUSES.has(latestMissionOrderStatus);
                const moInProgress = !isDeclined && hasMo && !moComplete;
                const moStatusLabel = isDeclined ? 'Not applicable' : (moComplete ? 'Complete' : (moInProgress ? 'In-Progress' : '—'));
                const moStatusClass = moComplete ? 'status-complete' : (moInProgress ? 'status-inprogress' : '');
                const moDateValue = moPreapprovedAt || moTouchedAt;
                const moResolutionTime = hasMo && moStartAt && moDateValue ? formatDurationBetween(moStartAt, moDateValue) : '—';
                const inspectionStepReached = hasAnyInspection || inspectionUnlockedByMissionOrder;
                const inspectionStatusText = inspectionCompleted
                  ? 'Complete'
                  : inspectionInProgress
                    ? 'In Progress'
                    : inspectionStepReached
                      ? 'Pending Inspection'
                      : '—';
                const inspectionStatusClass = inspectionCompleted
                  ? 'status-complete'
                  : inspectionInProgress
                    ? 'status-inprogress'
                    : inspectionStepReached
                      ? 'status-pending-inspection'
                      : '';
                const inspectionResolutionTimeText =
                  inspectionStartedAt && (inspectionCompletedAt || (inspectionInProgress ? inspectionProgressAt : null))
                    ? formatDurationBetween(
                        inspectionStartedAt,
                        inspectionCompletedAt || inspectionProgressAt
                      )
                    : '—';

                const complaintMarkedComplete = ['resolved', 'closed', 'completed', 'done'].includes(s);
                const effectiveIsResolved =
                  isDeclined ||
                  complaintMarkedComplete ||
                  normalizedInspectionStatus === 'completed';
                const inspectionRemarks =
                  remarksInfo.remarks ||
                  String(latestRemarksInspection?.inspection_comments || resolutionInspection?.inspection_comments || '').trim();
                const showResolutionSummary =
                  Boolean(resolutionInspection) ||
                  !!remarksInfo.complianceStatus ||
                  !!inspectionRemarks;

                const fmt = (d) => formatDateTime(d);

                return (
                  <div className="progress-card">
                    <div className="progress-card-header">
                      <img src="/ui_icons/revision.png" alt="" className="progress-card-header-icon" />
                      <span className="progress-card-title">COMPLAINT PROGRESS</span>
                    </div>
                    <div className="vtl">
                      <div className="vtl-step completed">
                        <div className="vtl-marker">✓</div>
                        <div className="vtl-content">
                          <div className="vtl-title">Complaint Received</div>
                          <div className="vtl-desc">Your complaint has been logged in our system</div>
                          <div className="vtl-detail"><span className="vtl-detail-label">Date:</span> <span className="vtl-detail-value">{fmt(receivedDate)}</span></div>
                        </div>
                      </div>

                      <div className={`vtl-step ${reviewCompleted ? 'completed' : 'active'}`}>
                        <div className="vtl-marker">{reviewCompleted ? '✓' : 2}</div>
                        <div className="vtl-content">
                          <div className="vtl-title">Under Review</div>
                          <div className="vtl-desc">{reviewDescription}</div>
                          <div className="vtl-detail"><span className="vtl-detail-label">Status:</span> <span className={`vtl-detail-value ${reviewStatusClass}`}>{reviewStatusLabel}</span></div>
                          <div className="vtl-detail"><span className="vtl-detail-label">Date:</span> <span className="vtl-detail-value">{fmt(reviewDateValue)}</span></div>
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
                          <div className={`vtl-step ${hasMo ? (moComplete ? 'completed' : 'active') : 'inactive'}`}>
                            <div className="vtl-marker">{moComplete ? '✓' : 3}</div>
                            <div className="vtl-content">
                              <div className="vtl-title">Document Processing</div>
                              <div className="vtl-desc">Preparing documents needed for inspection</div>
                              <>
                                <div className="vtl-detail"><span className="vtl-detail-label">Status:</span> <span className={`vtl-detail-value ${moStatusClass}`}>{moStatusLabel}</span></div>
                                <div className="vtl-detail"><span className="vtl-detail-label">Resolution Time:</span> <span className="vtl-detail-value">{moResolutionTime}</span></div>
                                <div className="vtl-detail"><span className="vtl-detail-label">Date:</span> <span className="vtl-detail-value">{fmt(moDateValue)}</span></div>
                              </>
                            </div>
                          </div>

                          <div className={`vtl-step ${inspectionCompleted ? 'completed' : (inspectionStepReached ? 'active' : 'inactive')}`}>
                            <div className="vtl-marker">{inspectionCompleted ? '✓' : 4}</div>
                            <div className="vtl-content">
                              <div className="vtl-title">Inspection</div>
                              <div className="vtl-desc">An inspection will be conducted to verify this complaint</div>
                              <>
                                <div className="vtl-detail"><span className="vtl-detail-label">Status:</span> <span className={`vtl-detail-value ${inspectionStatusClass}`}>{inspectionStatusText}</span></div>
                                <div className="vtl-detail"><span className="vtl-detail-label">Resolution Time:</span> <span className="vtl-detail-value">{inspectionResolutionTimeText}</span></div>
                                <div className="vtl-detail"><span className="vtl-detail-label">Date:</span> <span className="vtl-detail-value">{fmt(inspectionDateValue)}</span></div>
                              </>
                            </div>
                          </div>

                          <div className={`vtl-step ${effectiveIsResolved ? 'completed' : 'inactive'}`}>
                            <div className="vtl-marker">{effectiveIsResolved ? '✓' : 5}</div>
                            <div className="vtl-content">
                              <div className="vtl-title">Resolution</div>
                              <div className="vtl-desc">
                                {showResolutionSummary
                                  ? 'Inspection completed. Summary from the inspector remarks is shown below.'
                                  : 'Summary of findings will appear after the inspection is completed.'}
                              </div>
                              {showResolutionSummary ? (
                                <div style={{ marginTop: 4 }}>
                                  <div
                                    style={{
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
                                    {remarksInfo.complianceStatus ? (
                                      <div style={{ marginBottom: inspectionRemarks ? 8 : 0, whiteSpace: 'normal' }}>
                                        <span style={{ color: '#64748b', fontWeight: 700 }}>Compliance Status:</span>{' '}
                                        <span style={{ fontWeight: 800 }}>{remarksInfo.complianceStatus}</span>
                                      </div>
                                    ) : null}
                                    <div>{inspectionRemarks || 'No remarks were provided in the inspection slip.'}</div>
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

              <div className="complaint-summary">
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
