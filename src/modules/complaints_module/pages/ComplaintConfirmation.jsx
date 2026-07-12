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
          <div className="confirm-icon">{'\u2713'}</div>
          <h2 className="confirm-title">Complaint Submitted</h2>
          <p className="confirm-subtitle">
            Keep your Complaint ID to track the status of your report.
          </p>

          <div className="confirm-id">
            <div className="confirm-id-label">Complaint ID</div>
            <div className="confirm-id-wrapper">
              <div className="confirm-id-value">{complaintCode || '\u2014'}</div>
              <button
                className={`btn btn-primary confirm-copy-btn${copied ? ' is-copied' : ''}`}
                onClick={handleCopyId}
                title={copied ? 'Complaint ID copied' : 'Copy Complaint ID'}
                aria-label={copied ? 'Complaint ID copied' : 'Copy Complaint ID'}
                disabled={!complaintCode}
              >
                {copied ? (
                  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <rect x="8" y="8" width="11" height="11" rx="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                )}
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
