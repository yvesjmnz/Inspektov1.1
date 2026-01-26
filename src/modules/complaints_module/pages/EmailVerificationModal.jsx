import { useState, useEffect } from 'react';
import { requestEmailVerification } from '../../../lib/api';
import { supabase } from '../../../lib/supabase';
import './EmailVerificationModal.css';

export default function EmailVerificationModal({ isOpen, onClose }) {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [redirecting, setRedirecting] = useState(false);

  const checkForValidToken = async (emailToCheck) => {
    try {
      // Query email_verification_tokens table for valid tokens
      const { data, error: queryError } = await supabase
        .from('email_verification_tokens')
        .select('email, expires_at, used_at')
        .eq('email', emailToCheck.toLowerCase())
        .is('used_at', null)
        .order('expires_at', { ascending: false })
        .limit(1);

      if (queryError) {
        return false;
      }

      if (data && data.length > 0) {
        const token = data[0];
        const expiresAt = new Date(token.expires_at);

        // Check if token is still valid (not expired)
        if (expiresAt > new Date()) {
          // Valid token found, show redirecting message then navigate
          setRedirecting(true);
          setTimeout(() => {
            window.location.href = `/complaint?email=${encodeURIComponent(emailToCheck)}`;
          }, 1500);
          return true;
        }
      }
      return false;
    } catch (err) {
      console.error('Token check error:', err);
      return false;
    }
  };

  // Handle Escape key press
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape' && isOpen) {
        handleClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      // Check for valid token first
      const hasValidToken = await checkForValidToken(email);
      
      // If valid token found, checkForValidToken will redirect
      if (hasValidToken) {
        return;
      }

      // No valid token, send verification email
      await requestEmailVerification(email);
      setSuccess(true);
      setSubmitted(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    // Reset state when closing
    setEmail('');
    setError(null);
    setSuccess(false);
    setSubmitted(false);
    onClose();
  };

  const handleOverlayClick = (e) => {
    // Only close if clicking directly on the overlay, not the modal
    if (e.target === e.currentTarget) {
      handleClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={handleOverlayClick}>
      <div className="modal-content">
        <div className="modal-header">
          <h2 className="modal-title">Email Verification</h2>
          <button className="modal-close-btn" onClick={handleClose} aria-label="Close modal">
            ✕
          </button>
        </div>
        <div className="modal-divider"></div>

        {redirecting ? (
          <div className="modal-body success">
            <div className="success-icon">✓</div>
            <h3>Great! We Found Your Verification</h3>
            <p className="success-email">Taking you to the complaint form...</p>
            <p className="info-text">
              We found a valid verification for <strong>{email}</strong>. You're all set to submit your complaint.
            </p>
          </div>
        ) : submitted && success ? (
          <div className="modal-body success">
            <div className="success-icon">✓</div>
            <h3>Verification Email Sent</h3>
            <p className="success-email">We've sent a verification link to <strong>{email}</strong></p>
            <p className="info-text">
              Please check your email and click the verification link to proceed with your complaint submission. The link expires in 30 minutes.
            </p>
          </div>
        ) : (
          <div className="modal-body">
            <form onSubmit={handleSubmit} className="verification-form">
              <div className="form-group">
                <label htmlFor="modal-email">Email Address</label>
                <input
                  id="modal-email"
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
                {loading ? (
                  <>
                    <span className="spinner-small"></span>
                    Sending...
                  </>
                ) : (
                  'Send Verification Link'
                )}
              </button>
            </form>

            <p className="modal-description">A secure verification link will be sent to your email. The link expires in 30 minutes.</p>
          </div>
        )}
      </div>
    </div>
  );
}
