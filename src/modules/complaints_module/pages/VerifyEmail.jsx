import { useState, useEffect, useRef } from 'react';
import { verifyEmail } from '../../../lib/api';
import './VerifyEmail.css';

export default function VerifyEmail() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const verificationStartedRef = useRef(false);

  useEffect(() => {
    // React Strict Mode runs effects twice in development. Verification tokens
    // are single-use, so never issue a duplicate consume request.
    if (verificationStartedRef.current) return;
    verificationStartedRef.current = true;

    const handleVerify = async () => {
      const params = new URLSearchParams(window.location.search);
      const token = params.get('token');
      const formType = params.get('form') || 'complaint'; // 'complaint' or 'special-complaint'

      if (!token) {
        setError('No verification token provided');
        setLoading(false);
        return;
      }

      try {
        const result = await verifyEmail(token);
        // Redirect immediately on success to the appropriate form
        // Use formType from API response for accuracy
        const redirectFormType = result.formType || formType;
        const redirectPath = redirectFormType === 'special-complaint' ? '/special-complaint' : '/complaint';
        if (!result.accessToken) throw new Error('Verification succeeded but form access was not granted');
        window.location.replace(`${redirectPath}#access_token=${encodeURIComponent(result.accessToken)}`);
      } catch (err) {
        const message = String(err?.message || '');
        setError(
          message.toLowerCase().includes('already used')
            ? 'This verification link has already been used. Please request a new verification link.'
            : message
        );
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
