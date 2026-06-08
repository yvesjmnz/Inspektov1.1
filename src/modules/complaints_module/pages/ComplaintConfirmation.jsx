import { useState } from 'react';
import Header from '../../../components/Header';
import Footer from '../../../components/Footer';
import './ComplaintConfirmation.css';

export default function ComplaintConfirmation() {
  const params = new URLSearchParams(window.location.search);
  const complaintCode = params.get('code') || params.get('id');
  const [copied, setCopied] = useState(false);

  const handleCopyId = () => {
    if (complaintCode) {
      navigator.clipboard.writeText(complaintCode).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    }
  };

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
            <div className="confirm-id-wrapper">
              <div className="confirm-id-value">{complaintCode || '—'}</div>
              <button
                className="btn btn-primary"
                onClick={handleCopyId}
                title="Copy Complaint ID"
              >
                {copied ? '✓ Copied' : 'Copy'}
              </button>
            </div>
          </div>

          <div className="confirm-actions">
            <a className="btn btn-primary" href={complaintCode ? `/track-complaint?id=${encodeURIComponent(complaintCode)}` : '/track-complaint'}>
              Track Complaint
            </a>
            <a className="btn btn-secondary" href="/">
              Back to Home
            </a>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
