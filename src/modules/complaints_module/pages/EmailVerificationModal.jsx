import { useState, useEffect, useRef } from 'react';
import { getReporterBanStatus, requestEmailVerification } from '../../../lib/api';
import './EmailVerificationModal.css';

export default function EmailVerificationModal({ isOpen, onClose }) {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const turnstileRef = useRef(null);
  const turnstileWidgetIdRef = useRef(null);

  const resetModalState = () => {
    setEmail('');
    setLoading(false);
    setError(null);
    setSuccess(false);
    setSubmitted(false);
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
      const banStatus = await getReporterBanStatus(email);
      if (banStatus?.banned) {
        throw new Error('This email address is not permitted to submit complaints.');
      }

      // Get Turnstile token from the widget
      const turnstileToken = window.turnstile?.getResponse();
      if (!turnstileToken) {
        setError('Please complete the CAPTCHA verification.');
        setLoading(false);
        return;
      }

      // Send verification email with Turnstile token
      await requestEmailVerification(email, null, turnstileToken, 'complaint');
      setSuccess(true);
      setSubmitted(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };
  // Render Turnstile widget when modal opens
  useEffect(() => {
    if (!isOpen || !turnstileRef.current) return;

    // Check if Turnstile script is loaded
    if (!window.turnstile) {
      console.error('Turnstile script not loaded');
      return;
    }

    // Check if site key is available
    const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY;
    if (!siteKey) {
      console.error('VITE_TURNSTILE_SITE_KEY not set');
      return;
    }

    turnstileRef.current.innerHTML = '';

    // Render the widget
    turnstileWidgetIdRef.current = window.turnstile.render('#cf-turnstile-widget', {
      sitekey: siteKey,
      theme: 'light',
    });

    // Cleanup: remove widget when modal closes
    return () => {
      if (window.turnstile && turnstileWidgetIdRef.current !== null) {
        try {
          window.turnstile.remove(turnstileWidgetIdRef.current);
        } catch {
          // Ignore Turnstile cleanup failures so the modal can still unmount.
        }
      }
      turnstileWidgetIdRef.current = null;
    };
  }, [isOpen]);

  const handleClose = () => {
    if (window.turnstile && turnstileWidgetIdRef.current !== null) {
      try {
        window.turnstile.reset(turnstileWidgetIdRef.current);
      } catch {
        // Ignore Turnstile reset failures so closing always succeeds.
      }
    }

    resetModalState();
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
          <button type="button" className="modal-close-btn" onClick={handleClose} aria-label="Close modal">
            <img
              src="/X icon.png"
              alt="Close"
              className="modal-close-icon"
            />
          </button>
        </div>
        <div className="modal-divider"></div>

        {false ? (
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
            {/* Cloudflare Turnstile CAPTCHA Widget - Always Visible */}
            <div
              id="cf-turnstile-widget"
              ref={turnstileRef}
              className="cf-turnstile"
            ></div>

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
