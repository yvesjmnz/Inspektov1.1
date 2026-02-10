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
  if (['rejected', 'invalid', 'cancelled', 'canceled'].includes(s)) return 'status-badge status-danger';
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
              </div>
              <div className="track-result-id-section">
                <span className="track-result-id-label">Complaint ID:</span>
                <span className="track-result-id-value">{complaint.id}</span>
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
                          className={`progress-step ${isCompleted ? 'completed' : ''} ${isCurrent ? 'current' : ''}`}
                        >
                          {isCompleted ? '✓' : index + 1}
                        </div>
                        <div className="progress-step-label">{step}</div>
                        <div className="progress-step-tooltip">{dateDisplay}</div>
                        {index < PROGRESS_STEPS.length - 1 && (
                          <div className={`progress-line ${isCompleted ? 'completed' : ''}`}></div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Complaint Summary */}
              <div className="complaint-summary">
                <div className="summary-item">
                  <span className="summary-label">Business</span>
                  <span className="summary-value">{complaint.business_name || '—'}</span>
                </div>
                <div className="summary-item">
                  <span className="summary-label">Address</span>
                  <span className="summary-value">{complaint.business_address || '—'}</span>
                </div>
                <div className="summary-item">
                  <span className="summary-label">Description</span>
                  <span className="summary-value summary-description">
                    {complaint.complaint_description
                      ? complaint.complaint_description.length > 100
                        ? complaint.complaint_description.substring(0, 100) + '…'
                        : complaint.complaint_description
                      : '—'}
                  </span>
                </div>
              </div>

              <div className="track-result-row">
                <span className="track-result-label">Complaint ID</span>
                <span className="track-result-value">{complaint.id}</span>
              </div>
              <div className="track-result-row">
                <span className="track-result-label">Status</span>
                <span className={statusBadgeClass(complaint.status)}>
                  {formatStatus(complaint.status)}
                </span>
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
