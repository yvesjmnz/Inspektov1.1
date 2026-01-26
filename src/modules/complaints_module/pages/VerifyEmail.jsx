import { useState, useEffect } from 'react';
import { verifyEmail } from '../../../lib/api';
import './VerifyEmail.css';

export default function VerifyEmail() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const handleVerify = async () => {
      const params = new URLSearchParams(window.location.search);
      const token = params.get('token');

      if (!token) {
        setError('No verification token provided');
        setLoading(false);
        return;
      }

      try {
        const result = await verifyEmail(token);
        // Redirect immediately on success
        window.location.href = `/complaint?email=${encodeURIComponent(result.email)}`;
      } catch (err) {
        setError(err.message);
        setLoading(false);
      }
    };

    handleVerify();
  }, []);

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

  return null;
}
