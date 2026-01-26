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
  const [checkingToken, setCheckingToken] = useState(false);

  // Check for valid token when modal opens
  useEffect(() => {
    if (isOpen) {
      checkForValidToken();
    }
  }, [isOpen]);

  const checkForValidToken = async () => {
    setCheckingToken(true);
    try {
      const emailInput = prompt('Enter your email to check for valid verification token:');
      if (!emailInput) {
        setCheckingToken(false);
        return;
      }

      // Query email_verification_tokens table for valid tokens
      const { data, error: queryError } = await supabase
        .from('email_verification_tokens')
        .select('email, expires_at, used_at')
        .eq('email', emailInput.toLowerCase())
        .is('used_at', null)
        .order('expires_at', { ascending: false })
        .limit(1);

      if (queryError) {
        setCheckingToken(false);
        return;
      }

      if (data && data.length > 0) {
        const token = data[0];
        const expiresAt = new Date(token.expires_at);

        // Check if token is still valid (not expired)
        if (expiresAt > new Date()) {
          // Valid token found, redirect to complaint form
          window.location.href = `/complaint?email=${encodeURIComponent(emailInput)}`;
          return;
        }
      }

      // No valid token found, set email for verification request
      setEmail(emailInput);
    } catch (err) {
      console.error('Token check error:', err);
    } finally {
      setCheckingToken(false);
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

        {submitted && success ? (
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
