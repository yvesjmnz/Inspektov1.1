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

          {complaint ? (
            <div className="track-result">
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

              {/* Optional fields (shown only if present in your table) */}
              {complaint.created_at ? (
                <div className="track-result-row">
                  <span className="track-result-label">Submitted</span>
                  <span className="track-result-value">{new Date(complaint.created_at).toLocaleString()}</span>
                </div>
              ) : null}

              {complaint.updated_at ? (
                <div className="track-result-row">
                  <span className="track-result-label">Last Updated</span>
                  <span className="track-result-value">{new Date(complaint.updated_at).toLocaleString()}</span>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="track-help">
            <a className="track-back" href="/">Back to Home</a>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
