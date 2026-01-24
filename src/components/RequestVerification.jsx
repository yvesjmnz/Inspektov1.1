import { useState } from 'react';
import { requestEmailVerification } from '../lib/api';
import './RequestVerification.css';

export default function RequestVerification() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      await requestEmailVerification(email);
      setSuccess(true);
      setSubmitted(true);
      setEmail('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (submitted && success) {
    return (
      <div className="request-verification-container">
        <div className="request-verification-card success">
          <div className="success-icon">✓</div>
          <h1>Verification Email Sent</h1>
          <p>We've sent a verification link to <strong>{email}</strong></p>
          <p className="info-text">
            Please check your email and click the verification link to proceed with your complaint submission.
            The link will expire in 30 minutes.
          </p>
          <button
            onClick={() => {
              setSubmitted(false);
              setSuccess(false);
            }}
            className="btn btn-secondary"
          >
            Send Another Email
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="request-verification-container">
      <div className="request-verification-card">
        <h1>Request Email Verification</h1>
        <p>Enter your email address to receive a verification link for complaint submission.</p>

        <form onSubmit={handleSubmit} className="verification-form">
          <div className="form-group">
            <label htmlFor="email">Email Address</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your.email@example.com"
              required
              disabled={loading}
              className="form-input"
            />
          </div>

          {error && <div className="error-message">{error}</div>}

          <button
            type="submit"
            disabled={loading || !email}
            className="btn btn-primary btn-large"
          >
            {loading ? 'Sending...' : 'Send Verification Link'}
          </button>
        </form>

        <p className="info-text">
          We'll send you a secure link to verify your email. This helps us prevent spam and ensure authentic complaints.
        </p>
      </div>
    </div>
  );
}
