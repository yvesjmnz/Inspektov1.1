import Header from '../../../components/Header';
import Footer from '../../../components/Footer';
import './ComplaintConfirmation.css';

export default function ComplaintConfirmation() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get('id');

  return (
    <div className="confirm-container">
      <Header />
      <main className="confirm-main">
        <section className="confirm-card">
          <div className="confirm-icon">✓</div>
          <h2 className="confirm-title">Complaint Submitted</h2>
          <p className="confirm-subtitle">
            Keep your Complaint ID to track the status of your report.
          </p>

          <div className="confirm-id">
            <div className="confirm-id-label">Complaint ID</div>
            <div className="confirm-id-value">{id || '—'}</div>
          </div>

          <div className="confirm-actions">
            <a className="confirm-btn" href={id ? `/track-complaint` : '/track-complaint'}>
              Track Complaint
            </a>
            <a className="confirm-btn confirm-btn-secondary" href="/">
              Back to Home
            </a>
          </div>

          <div className="confirm-note">
            If you provided an email address, you will receive an email confirmation shortly.
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
