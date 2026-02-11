import { useMemo, useState } from 'react';
import Header from '../../../components/Header';
import Footer from '../../../components/Footer';
import { getComplaintById } from '../../../lib/complaints';
import './TrackComplaint.css';

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
      const data = await getComplaintById(idForQuery);
      setComplaint(data);
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
                  <button className="track-btn" type="submit" disabled={!canSearch || loading}>
                    {loading ? 'Checking…' : 'Check Status'}
                  </button>
                </div>
              </form>

              {error ? <div className="track-alert track-alert-error">{error}</div> : null}

              <div className="track-help">
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
              {/* Progress Indicator with Dates */}
              <div className="progress-indicator">
                <div className="progress-steps">
                  {PROGRESS_STEPS.map((step, index) => {
                    const currentStep = getStatusStep(complaint.status);
                    const isCompleted = index < currentStep;
                    const isCurrent = index === currentStep;
                    
                    let dateDisplay = '—';
                    
                    if (index === 0 && complaint.created_at) {
                      // Submitted step uses created_at
                      dateDisplay = new Date(complaint.created_at).toLocaleString();
                    } else if (isCurrent && complaint.updated_at) {
                      // Current step uses updated_at
                      dateDisplay = new Date(complaint.updated_at).toLocaleString();
                    } else if (isCompleted && complaint.updated_at) {
                      // Completed steps use updated_at as fallback
                      dateDisplay = new Date(complaint.updated_at).toLocaleString();
                    } else if (!isCompleted && !isCurrent) {
                      // Future steps show Pending
                      dateDisplay = 'Pending';
                    }
                    
                    return (
                      <div key={index} className="progress-step-wrapper" title={dateDisplay}>
                        <div
                          className={`progress-step ${isCompleted ? 'completed' : ''} ${isCurrent && !(String(complaint.status || '').toLowerCase() === 'approved' || String(complaint.status || '').toLowerCase() === 'declined') ? 'current' : ''} ${String(complaint.status || '').toLowerCase() === 'approved' && index === 1 ? 'approved' : ''} ${String(complaint.status || '').toLowerCase() === 'declined' && index === 1 ? 'declined' : ''}`}
                        >
                          {(() => {
                            const s = String(complaint.status || '').toLowerCase();
                            const isFinalDecisionStep = index === 1;
                            const isApproved = s === 'approved';
                            const isDeclined = s === 'declined';

                            // Industry-standard: show clear final outcome indicator on the final step.
                            if (isFinalDecisionStep && (isApproved || isDeclined)) {
                              return isApproved ? '✓' : '✕';
                            }

                            // Keep original behavior for other steps.
                            return isCompleted ? '✓' : index + 1;
                          })()}
                        </div>
                        <div className="progress-step-label">
                          {(() => {
                            if (index !== 1) return step;
                            const s = String(complaint.status || '').toLowerCase();
                            if (s === 'approved') return 'Approved';
                            if (s === 'declined') return 'Declined';
                            return 'Decision';
                          })()}
                        </div>
                        <div className="progress-step-tooltip">{dateDisplay}</div>
                        {index < PROGRESS_STEPS.length - 1 && (
                          <div className={`progress-line ${isCompleted ? 'completed' : ''}`}></div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Director Decision (industry-standard: clear outcome + timestamp + reason for decline) */}
              <div className="complaint-summary">
                <div className="summary-row-full">
                  <div className="summary-card summary-card-with-footer summary-card-decision">
                    <div>
                      <div className="summary-item-header">
                        <img src="/ui_icons/revision.png" alt="Decision" className="summary-item-icon" style={{ filter: 'brightness(0) saturate(100%)' }} />
                        <span className="summary-label">Director Decision</span>
                      </div>
                      <div className="director-decision-body">
                        {(() => {
                          const s = String(complaint.status || '').toLowerCase();
                          const isApproved = s === 'approved';
                          const isDeclined = s === 'declined';

                          const label = isApproved ? 'Approved' : isDeclined ? 'Declined' : formatStatus(complaint.status);

                          return (
                            <span className="director-decision-status">
                              <span className={statusBadgeClass(complaint.status)}>{label}</span>
                            </span>
                          );
                        })()}

                        {String(complaint.status || '').toLowerCase() === 'declined' && complaint.decline_comment ? (
                          <div className="director-decision-reason" role="note" aria-label="Reason for decision">
                            <div className="director-decision-reason-label">Reason</div>
                            <div className="director-decision-reason-text">{complaint.decline_comment}</div>
                          </div>
                        ) : null}
                      </div>
                    </div>
                    <div className="summary-card-footer">
                      <span className="summary-footer-label">Decision date:</span>
                      <span className="summary-footer-value">
                        {String(complaint.status || '').toLowerCase() === 'approved'
                          ? (complaint.approved_at ? new Date(complaint.approved_at).toLocaleString() : (complaint.updated_at ? new Date(complaint.updated_at).toLocaleString() : '—'))
                          : String(complaint.status || '').toLowerCase() === 'declined'
                          ? (complaint.declined_at ? new Date(complaint.declined_at).toLocaleString() : (complaint.updated_at ? new Date(complaint.updated_at).toLocaleString() : '—'))
                          : 'Pending'}
                      </span>
                    </div>
                  </div>
                </div>

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
                    <div className="summary-card-footer">
                      <span className="summary-footer-label">Submitted on:</span>
                      <span className="summary-footer-value">
                        {complaint.created_at ? new Date(complaint.created_at).toLocaleString() : '—'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="track-result-actions">
                <button 
                  className="track-btn-back"
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
