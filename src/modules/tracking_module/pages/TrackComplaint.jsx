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
                const currentStep = (() => {
                  if (["approved", "declined"].includes(s)) return 2;
                  if (["under_review", "under review", "in_progress", "in progress", "processing"].includes(s)) return 1;
                  return 0; // submitted/new/pending/default
                })();

                const receivedDate = complaint.created_at ? new Date(complaint.created_at).toLocaleString() : '—';
                const reviewDate = complaint.updated_at ? new Date(complaint.updated_at).toLocaleString() : '—';
                const decisionDate = (() => {
                  if (s === 'approved') return complaint.approved_at ? new Date(complaint.approved_at).toLocaleString() : (complaint.updated_at ? new Date(complaint.updated_at).toLocaleString() : '—');
                  if (s === 'declined') return complaint.declined_at ? new Date(complaint.declined_at).toLocaleString() : (complaint.updated_at ? new Date(complaint.updated_at).toLocaleString() : '—');
                  return '—';
                })();
                const decisionLabel = s === 'approved' ? 'Approved' : s === 'declined' ? 'Declined' : 'Pending';

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
                          <div className="vtl-detail"><span className="vtl-detail-label">Date:</span> <span className="vtl-detail-value">{receivedDate}</span></div>
                        </div>
                      </div>

                      {/* Step 2 - Under Review */}
                      <div className={`vtl-step ${["approved", "declined"].includes(s) ? 'completed' : 'active'}`}>
                        <div className="vtl-marker">{["approved", "declined"].includes(s) ? '✓' : 2}</div>
                        <div className="vtl-content">
                          <div className="vtl-title">Under Review</div>
                          <div className="vtl-desc">Director is reviewing your complaint</div>
                          <div className="vtl-detail"><span className="vtl-detail-label">Status:</span> <span className="vtl-detail-value">{currentStep === 1 ? 'Pending Review' : (currentStep > 1 ? 'Completed' : 'Queued')}</span></div>
                          <div className="vtl-detail"><span className="vtl-detail-label">Date:</span> <span className="vtl-detail-value">{reviewDate}</span></div>
                        </div>
                      </div>

                      {/* Step 3 - Decision Made */}
                      <div className={`vtl-step ${["approved","declined"].includes(s) ? 'active' : (currentStep > 2 ? 'completed' : 'inactive')}`}>
                        <div className="vtl-marker">{["approved","declined"].includes(s) ? (s === 'approved' ? '✓' : '✕') : 3}</div>
                        <div className="vtl-content">
                          <div className="vtl-title">Decision Made</div>
                          <div className="vtl-desc">Final decision has been issued</div>
                          <div className="vtl-detail"><span className="vtl-detail-label">Status:</span> <span className={`vtl-detail-value ${s === 'approved' ? 'status-approved' : s === 'declined' ? 'status-declined' : ''}`}>{decisionLabel}</span></div>
                          <div className="vtl-detail"><span className="vtl-detail-label">Decision Date:</span> <span className="vtl-detail-value">{decisionDate}</span></div>
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
