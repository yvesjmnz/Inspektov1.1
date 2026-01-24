import { useState } from 'react';
import { verifyEmail } from '../lib/api';
import './VerifyEmail.css';

export default function VerifyEmail() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const [email, setEmail] = useState(null);

  const handleVerify = async () => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');

    if (!token) {
      setError('No verification token provided');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await verifyEmail(token);
      setEmail(result.email);
      setSuccess(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="verify-email-container">
        <div className="verify-email-card">
          <div className="spinner"></div>
          <p>Verifying your email...</p>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="verify-email-container">
        <div className="verify-email-card success">
          <div className="success-icon">✓</div>
          <h1>Email Verified Successfully</h1>
          <p className="email-display">{email}</p>
          <p className="success-message">
            Your email has been verified. You can now proceed to submit your complaint.
          </p>
          <a href={`/complaint?email=${encodeURIComponent(email)}`} className="btn btn-primary">
            Go to Complaint Form
          </a>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="verify-email-container">
        <div className="verify-email-card error">
          <div className="error-icon">!</div>
          <h1>Verification Failed</h1>
          <p className="error-message">{error}</p>
          <div className="button-group">
            <a href="/" className="btn btn-secondary">
              Back to Home
            </a>
            <a href="/request-verification" className="btn btn-primary">
              Request New Link
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="verify-email-container">
      <div className="verify-email-card">
        <h1>Verify Your Email</h1>
        <p>Click the button below to verify your email address and proceed with your complaint submission.</p>
        <button onClick={handleVerify} className="btn btn-primary btn-large">
          Verify Email
        </button>
      </div>
    </div>
  );
}
