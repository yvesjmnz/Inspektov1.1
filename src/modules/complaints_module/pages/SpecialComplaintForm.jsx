import { useEffect, useMemo, useRef, useState } from 'react';
import { submitComplaint, getBusinesses, uploadImage, resolveBusinessJurisdiction } from '../../../lib/complaints';
import { getNearbyBusinesses } from '../../../lib/complaints/nearbyBusinesses';
import { requestEmailVerification } from '../../../lib/api';
import { supabase } from '../../../lib/supabase';
import Header from '../../../components/Header.jsx';
import Footer from '../../../components/Footer.jsx';
import Stepper from '../../../components/Stepper.jsx';
import ErrorToast from '../../../components/ErrorToast.jsx';
import LandingPage from '../../../LandingPage.jsx';
import '../../../components/Stepper.css';
import './ComplaintForm.css';

const EMPTY_MANUAL_JURISDICTION = {
  checkedAddress: '',
  resolvedAddress: '',
  resolvedLocality: '',
  withinManilaCity: null,
  errorMessage: '',
};

const GUIDED_CATEGORIES = [
  { key: 'cat1', label: 'Business Permit & Licensing Issues' },
  { key: 'cat2', label: 'Alcohol & Tobacco Violations' },
  { key: 'cat3', label: 'Sanitation & Environmental Violations' },
  { key: 'cat4', label: 'Health, Hygiene, & Nutrition' },
  { key: 'cat5', label: 'Public Security Compliance' },
];

const GUIDED_SUBCATS = {
  cat1: [
    { key: 'cat1-1', label: 'Operating Without a Valid Business Permit' },
    { key: 'cat1-2', label: 'Missing Commerical Space Clearance' },
    { key: 'cat1-3', label: 'Unregistered or Untaxed Employees' },
  ],
  cat2: [
    { key: 'cat2-1', label: 'Selling Alcohol Near Schools' },
    { key: 'cat2-2', label: 'Selling Alcohol to Minors' },
    { key: 'cat2-3', label: 'Selling Cigarettes to Minors' },
  ],
  cat3: [
    { key: 'cat3-1', label: 'Improper Waste Disposal or Segregation' },
    { key: 'cat3-2', label: 'Illegal Disposing of Cooking Oil' },
    { key: 'cat3-3', label: 'Unpaid Garbage Tax' },
  ],
  cat4: [
    { key: 'cat4-1', label: 'Poor Food-Handler Hygiene' },
    { key: 'cat4-2', label: 'Missing Menu Nutrition Labels' },
  ],
  cat5: [
    { key: 'cat5-1', label: 'CCTV System Non-Compliance' },
  ],
};

function buildOutsideJurisdictionMessage(baseMessage, result) {
  const resolvedAddress = String(result?.resolved_address || result?.resolvedAddress || '').trim();
  const resolvedLocality = String(result?.resolved_locality || result?.resolvedLocality || '').trim();

  if (resolvedAddress) {
    return `${baseMessage} Google Maps resolved this address to: ${resolvedAddress}.`;
  }

  if (resolvedLocality) {
    return `${baseMessage} Google Maps resolved this address to ${resolvedLocality}, not Manila City.`;
  }

  return baseMessage;
}

export default function SpecialComplaintForm({ verifiedEmail: initialVerifiedEmail }) {
  const [verifiedEmail, setVerifiedEmail] = useState(initialVerifiedEmail || null);
  const [showVerificationModal, setShowVerificationModal] = useState(!initialVerifiedEmail);
  const [step, setStep] = useState(1);

  const [formData, setFormData] = useState({
    business_pk: null,
    business_name: '',
    business_address: '',
    complaint_description: '',
    reporter_email: verifiedEmail || '',
    tags: [],
    reporter_lat: null,
    reporter_lng: null,
  });

  const [businessNotInDb, setBusinessNotInDb] = useState(false);

  const [businesses, setBusinesses] = useState([]);
  const [showBusinessList, setShowBusinessList] = useState(false);
  const [nearbyOnly, setNearbyOnly] = useState(false);
  const [nearbyBusinessesCache, setNearbyBusinessesCache] = useState([]);

  // Step 2: evidence images (required: at least 1, max 5)
  const [evidenceImages, setEvidenceImages] = useState([]);

  const [confirmTruth, setConfirmTruth] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [errorToastKey, setErrorToastKey] = useState(0);

  const showError = (msg) => {
    const m = String(msg || '').trim();
    if (!m) return;
    setError(m);
    setErrorToastKey((k) => k + 1);
  };

  const [searchQuery, setSearchQuery] = useState('');
  const [firstSearchDone, setFirstSearchDone] = useState(false);
  const [nameSearchQuery, setNameSearchQuery] = useState('');
  const [manualJurisdictionCheck, setManualJurisdictionCheck] = useState(EMPTY_MANUAL_JURISDICTION);
  const businessSearchQueryRef = useRef('');
  const nameSearchQueryRef = useRef('');

  const OUTSIDE_JURISDICTION_MESSAGE =
    'Location Outside Jurisdiction: This business address falls outside the City of Manila. Digital inspections are currently restricted to Manila City limits.';

  // Email verification modal state
  const [modalEmail, setModalEmail] = useState('');
  const [modalLoading, setModalLoading] = useState(false);
  const [modalError, setModalError] = useState(null);
  const [modalSuccess, setModalSuccess] = useState(false);
  const [modalSubmitted, setModalSubmitted] = useState(false);
  const [modalRedirecting, setModalRedirecting] = useState(false);
  const turnstileRef = useRef(null);
  const [selectedCategories, setSelectedCategories] = useState([]);
  const [expandedGuided, setExpandedGuided] = useState({});
  const [selectedSubcats, setSelectedSubcats] = useState({});

  const additionalImageInputRef = useRef(null);

  const TOTAL_STEPS = 4;

  // Update reporter_email when verifiedEmail changes
  useEffect(() => {
    setFormData((prev) => ({
      ...prev,
      reporter_email: verifiedEmail || '',
    }));
  }, [verifiedEmail]);

  // Render Turnstile widget when modal is shown
  useEffect(() => {
    if (!showVerificationModal) return;

    // Wait a tick for the DOM to update
    const timer = setTimeout(() => {
      if (window.turnstile && !modalSubmitted && !modalRedirecting) {
        try {
          window.turnstile.render('#cf-turnstile-widget-special', {
            sitekey: import.meta.env.VITE_TURNSTILE_SITE_KEY,
            theme: 'light',
          });
        } catch (err) {
          console.error('Turnstile render error:', err);
        }
      }
    }, 100);

    return () => clearTimeout(timer);
  }, [showVerificationModal, modalSubmitted, modalRedirecting]);

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
          // Valid token found, show redirecting message then proceed
          setModalRedirecting(true);
          setTimeout(() => {
            setVerifiedEmail(emailToCheck);
            setShowVerificationModal(false);
            setModalEmail('');
            setModalError(null);
            setModalSuccess(false);
            setModalSubmitted(false);
            setModalRedirecting(false);
            // Reset Turnstile widget
            if (window.turnstile) {
              window.turnstile.reset();
            }
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

  const handleVerificationSubmit = async (e) => {
    e.preventDefault();
    setModalError(null);
    setModalLoading(true);

    try {
      // Check for valid token first
      const hasValidToken = await checkForValidToken(modalEmail);

      // If valid token found, checkForValidToken will handle the redirect
      if (hasValidToken) {
        return;
      }

      // Get Turnstile token from the widget
      const turnstileToken = window.turnstile?.getResponse();
      if (!turnstileToken) {
        setModalError('Please complete the CAPTCHA verification.');
        setModalLoading(false);
        return;
      }

      // Send verification email with Turnstile token
      await requestEmailVerification(modalEmail, null, turnstileToken, 'special-complaint');
      setModalSuccess(true);
      setModalSubmitted(true);
    } catch (err) {
      setModalError(err.message);
    } finally {
      setModalLoading(false);
    }
  };

  const handleCloseVerificationModal = () => {
    // Redirect to home instead of just closing
    window.location.href = '/';
  };

  const handleVerificationModalOverlayClick = (e) => {
    // Don't allow closing by clicking overlay
    // Do nothing
  };

  // Handle Escape key press for verification modal
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape' && showVerificationModal) {
        handleCloseVerificationModal();
      }
    };

    if (showVerificationModal) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'unset';
    };
  }, [showVerificationModal]);

  const stepTitle = useMemo(() => {
    switch (step) {
      case 1:
        return 'Business Search';
      case 2:
        return 'Evidence (Photos)';
      case 3:
        return 'Complaint Description';
      case 4:
        return 'Confirmation';
      default:
        return '';
    }
  }, [step]);

  const progressPct = useMemo(() => Math.round((step / TOTAL_STEPS) * 100), [step]);

  const descLen = useMemo(() => String(formData.complaint_description || '').length, [formData.complaint_description]);

  const toggleCategory = (key, checked) => {
    if (checked) {
      setSelectedCategories((prev) => Array.from(new Set([...(prev || []), key])));
      setExpandedGuided((prev) => ({ ...(prev || {}), [key]: true }));
    } else {
      setSelectedCategories((prev) => (prev || []).filter((k) => k !== key));
      setExpandedGuided((prev) => ({ ...(prev || {}), [key]: false }));
      setSelectedSubcats((prev) => {
        const copy = { ...(prev || {}) };
        delete copy[key];
        return copy;
      });
    }
  };

  const toggleSubcat = (catKey, subKey, checked) => {
    setSelectedSubcats((prev) => {
      const cur = (prev && prev[catKey]) || [];
      const next = checked ? Array.from(new Set([...cur, subKey])) : cur.filter((k) => k !== subKey);
      return { ...(prev || {}), [catKey]: next };
    });
  };

  const handleBusinessSearch = async (query) => {
    const q = String(query || '');
    setSearchQuery(q);
    setError(null);
    businessSearchQueryRef.current = q;

    if (q.length <= 2) {
      setBusinesses([]);
      setShowBusinessList(false);
      return;
    }

    if (nearbyOnly) {
      const needle = q.toLowerCase();
      const filtered = (nearbyBusinessesCache || []).filter((b) => {
        const name = String(b.business_name || '').toLowerCase();
        const addr = String(b.business_address || '').toLowerCase();
        return name.includes(needle) || addr.includes(needle);
      });
      setBusinesses(filtered);
      setShowBusinessList(true);
      return;
    }

    if (q.length > 2) {
      try {
        const results = await getBusinesses(q);
        if (businessSearchQueryRef.current !== q) return;
        setBusinesses(results);
        setShowBusinessList(true);
      } catch (err) {
        if (businessSearchQueryRef.current !== q) return;
        showError(err?.message || String(err));
      }
    } else {
      setBusinesses([]);
      setShowBusinessList(false);
    }
  };

  const clearBusinessSearch = () => {
    setError(null);
    setSearchQuery('');
    businessSearchQueryRef.current = '';
    setBusinesses([]);
    setShowBusinessList(false);
  };

  const clearNameSearch = () => {
    clearSelectedBusiness();
    setError(null);
    setNameSearchQuery('');
    nameSearchQueryRef.current = '';
    setBusinesses([]);
    setShowBusinessList(false);
  };

  const handleNameSearch = async (query) => {
    const q = String(query || '');

    if (formData.business_pk) {
      setFormData((prev) => ({
        ...prev,
        business_pk: null,
        business_name: '',
        business_address: '',
      }));
      setBusinesses([]);
      setShowBusinessList(false);
    }

    setNameSearchQuery(q);
    setError(null);
    nameSearchQueryRef.current = q;

    if (q.length > 2) {
      try {
        const results = await getBusinesses(q);
        if (nameSearchQueryRef.current !== q) return;
        setBusinesses(results);
        setShowBusinessList(true);
      } catch (err) {
        if (nameSearchQueryRef.current !== q) return;
        showError(err?.message || String(err));
      }
    } else {
      setBusinesses([]);
      setShowBusinessList(false);
    }
  };

  const selectBusiness = (business, source = 'initial') => {
    setBusinessNotInDb(false);
    setManualJurisdictionCheck(EMPTY_MANUAL_JURISDICTION);

    setFormData((prev) => ({
      ...prev,
      business_pk: business.business_pk,
      business_name: business.business_name,
      business_address: business.business_address,
    }));
    // Close suggestions
    setShowBusinessList(false);

    if (source === 'initial') {
      setFirstSearchDone(true);
      setSearchQuery('');
      setNameSearchQuery(business.business_name || '');
    } else {
      // 'name' flow
      setNameSearchQuery(business.business_name || '');
    }
  };

  const clearSelectedBusiness = () => {
    setError(null);
    setBusinesses([]);
    setShowBusinessList(false);
    setSearchQuery('');
    setNameSearchQuery('');
    businessSearchQueryRef.current = '';
    nameSearchQueryRef.current = '';
    setFirstSearchDone(false);
    setManualJurisdictionCheck(EMPTY_MANUAL_JURISDICTION);

    setFormData((prev) => {
      return {
        ...prev,
        business_pk: null,
        business_name: '',
        business_address: '',
      };
    });
  };

  const MAX_PHOTOS = 5;
  const ALLOWED_FORMATS = ['image/jpeg', 'image/png'];

  const validatePhotoFile = (file) => {
    // Check file format
    if (!ALLOWED_FORMATS.includes(file.type)) {
      return `Invalid file format: ${file.name}. Only JPG, JPEG, and PNG are allowed.`;
    }
    return null;
  };

  const handleEvidenceFileUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    setError(null);

    // Check if adding these files would exceed the limit
    const totalPhotos = evidenceImages.length + files.length;
    if (totalPhotos > MAX_PHOTOS) {
      showError('You can only add up to 5 photos. Please remove an existing photo before adding another.');
      return;
    }

    // Validate file formats
    for (const file of files) {
      const validationError = validatePhotoFile(file);
      if (validationError) {
        showError(validationError);
        return;
      }
    }

    setLoading(true);

    try {
      const uploaded = await Promise.all(files.map((file) => uploadImage(file)));
      setEvidenceImages((prev) => [...prev, ...uploaded]);
    } catch (err) {
      showError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  const removeEvidenceImage = (index) => {
    setEvidenceImages((prev) => prev.filter((_, i) => i !== index));
  };

  const requestDeviceLocation = () => {
    setError(null);
    setLoading(true);

    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;

          setFormData((prev) => ({
            ...prev,
            reporter_lat: lat,
            reporter_lng: lng,
          }));

          setLoading(false);
          resolve({ lat, lng });
        },
        (err) => {
          const message =
            err.code === err.PERMISSION_DENIED
              ? 'Location permission was denied. Please enable it in your browser settings.'
              : err.code === err.POSITION_UNAVAILABLE
                ? 'Location is unavailable. Please try again.'
                : 'Location request timed out. Please try again.';

          showError(message);
          setLoading(false);
          resolve(null);
        },
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
      );
    });
  };

  const findNearbyBusinesses = async () => {
    setError(null);
    setLoading(true);

    try {
      const coords = await requestDeviceLocation();
      if (coords?.lat == null || coords?.lng == null) {
        showError('Unable to get your location. Please enable location services.');
        setLoading(false);
        return;
      }

      const nearby = await getNearbyBusinesses(coords.lat, coords.lng, 200);

      if (nearby.length === 0) {
        showError('No businesses found within 200m of your location.');
        setLoading(false);
        return;
      }

      setNearbyBusinessesCache(nearby);
      setBusinesses(nearby);
      setShowBusinessList(true);
      setError(null);
    } catch (err) {
      showError(err?.message || 'Failed to find nearby businesses.');
    } finally {
      setLoading(false);
    }
  };

  const validateManualBusinessJurisdiction = async () => {
    if (!businessNotInDb || formData.business_pk) return true;

    const address = String(formData.business_address || '').trim();
    if (!address) return true;

    if (manualJurisdictionCheck.checkedAddress === address) {
      if (manualJurisdictionCheck.withinManilaCity === true) {
        return true;
      }

      if (manualJurisdictionCheck.withinManilaCity === false) {
        showError(
          manualJurisdictionCheck.errorMessage ||
            buildOutsideJurisdictionMessage(OUTSIDE_JURISDICTION_MESSAGE, manualJurisdictionCheck)
        );
        return false;
      }
    }

    setLoading(true);

    try {
      const result = await resolveBusinessJurisdiction(address);
      const errorMessage = result.within_manila_city
        ? ''
        : buildOutsideJurisdictionMessage(OUTSIDE_JURISDICTION_MESSAGE, result);

      setManualJurisdictionCheck({
        checkedAddress: address,
        resolvedAddress: result.resolved_address || '',
        resolvedLocality: result.resolved_locality || '',
        withinManilaCity: result.within_manila_city === true,
        errorMessage,
      });

      if (!result.within_manila_city) {
        showError(errorMessage);
        return false;
      }

      return true;
    } catch (err) {
      console.error('Business jurisdiction validation failed:', err);
      showError(err?.message || 'Unable to validate the business address. Please enter a more specific Manila City address.');
      return false;
    } finally {
      setLoading(false);
    }
  };

  const goNext = async () => {
    setError(null);

    // Step validations
    if (step === 1) {
      if (!formData.business_name || !formData.business_address) {
        showError('Please provide a business name and address.');
        return;
      }

      if (businessNotInDb) {
        const withinJurisdiction = await validateManualBusinessJurisdiction();
        if (!withinJurisdiction) {
          return;
        }
      }
    }

    if (step === 2) {
      if (evidenceImages.length === 0) {
        showError('Please add at least one photo.');
        return;
      }
    }

    if (step === 3) {
      if ((selectedCategories || []).length === 0) {
        showError('Please select at least one violation category.');
        return;
      }

      const missingSubFor = (selectedCategories || []).find((catKey) => (selectedSubcats?.[catKey]?.length || 0) === 0);
      if (missingSubFor) {
        const catLabel = GUIDED_CATEGORIES.find((c) => c.key === missingSubFor)?.label || 'the selected category';
        showError(`Please select at least one specific violation under "${catLabel}".`);
        return;
      }

      if (descLen < 20) {
        showError('Description is too short (minimum 20 characters).');
        return;
      }
      if (descLen > 1000) {
        showError('Description is too long (maximum 1000 characters).');
        return;
      }
    }

    if (step === 4) {
      // last step
      return;
    }

    setStep((s) => Math.min(TOTAL_STEPS, s + 1));
  };

  // When arriving on the final step, clear any prior validation errors.
  // This avoids showing stale errors (e.g., confirm checkbox) before the user attempts submit.
  useEffect(() => {
    if (step !== 4) return;

    // Clear any stale validation errors on entry to Step 4.
    // Use rAF to ensure we run after paint/state flush, avoiding race conditions
    // without using timers that may interact with form submit.
    const raf = requestAnimationFrame(() => setError(null));
    return () => cancelAnimationFrame(raf);
  }, [step]);

  const goBack = () => {
    setError(null);
    setStep((s) => Math.max(1, s - 1));
  };

  const handleFinalSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    if (!confirmTruth) {
      setLoading(false);
      showError('Please confirm the statement before submitting.');
      return;
    }

    try {
      const selectedSubLabels = Object.entries(selectedSubcats || {}).flatMap(([catKey, subKeys]) => {
        const arr = GUIDED_SUBCATS[catKey] || [];
        const byKey = new Map(arr.map((s) => [s.key, s.label]));
        return (subKeys || []).map((k) => byKey.get(k)).filter(Boolean);
      });
      const violationTags = selectedSubLabels.map((label) => `Violation: ${label}`);
      const mergedTags = Array.from(new Set([...(formData.tags || []), ...violationTags]));

      const complaintPayload = {
        business_name: formData.business_name,
        business_address: formData.business_address,
        complaint_description: formData.complaint_description,
        reporter_email: formData.reporter_email,
        // store all images as URLs in image_urls
        image_urls: evidenceImages.filter(Boolean),
        tags: [...new Set([...mergedTags, 'Special Complaint'])],
        status: 'Submitted',
        email_verified: !!verifiedEmail,
      };

      const created = await submitComplaint(complaintPayload);

      // Call send-complaint-confirmation edge function (best-effort)
      try {
        await supabase.functions.invoke('send-complaint-confirmation', {
          body: {
            email: formData.reporter_email,
            complaintId: created?.id,
          },
        });
      } catch (emailErr) {
        console.error('Failed to send confirmation email:', emailErr);
        // ignore email errors here; submission is already successful
      }

      window.location.href = `/complaint-confirmation?id=${encodeURIComponent(created?.id ?? '')}`;
    } catch (err) {
      showError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  // If verification modal is open, show it on top of the landing page
  if (showVerificationModal) {
    return (
      <>
        <LandingPage onOpenVerificationModal={() => {}} />
        <div className="modal-overlay" onClick={handleVerificationModalOverlayClick} style={{ display: 'flex' }}>
          <div className="modal-content" style={{ position: 'relative', zIndex: 1001 }}>
            <div className="modal-header">
              <h2 className="modal-title">Email Verification</h2>
              <button className="modal-close-btn" onClick={handleCloseVerificationModal} aria-label="Close modal">
                <img
                  src="/X icon.png"
                  alt="Close"
                  style={{ width: 14, height: 14, filter: 'brightness(0) invert(1)' }}
                />
              </button>
            </div>
            <div className="modal-divider"></div>

            {modalRedirecting ? (
              <div className="modal-body success">
                <div className="success-icon">&#10003;</div>
                <h3>Great! We Found Your Verification</h3>
                <p className="success-email">Taking you to the special complaint form...</p>
                <p className="info-text">
                  We found a valid verification for <strong>{modalEmail}</strong>. You're all set to submit your complaint.
                </p>
              </div>
            ) : modalSubmitted && modalSuccess ? (
              <div className="modal-body success">
                <div className="success-icon">&#10003;</div>
                <h3>Verification Email Sent</h3>
                <p className="success-email">We've sent a verification link to <strong>{modalEmail}</strong></p>
                <p className="info-text">
                  Please check your email and click the verification link to proceed with your complaint submission. The link expires in 30 minutes.
                </p>
              </div>
            ) : (
              <div className="modal-body">
                <div
                  id="cf-turnstile-widget-special"
                  ref={turnstileRef}
                  className="cf-turnstile"
                ></div>

                <form onSubmit={handleVerificationSubmit} className="verification-form">
                  <div className="form-group">
                    <label htmlFor="modal-email-special">Email Address</label>
                    <input
                      id="modal-email-special"
                      type="email"
                      value={modalEmail}
                      onChange={(e) => setModalEmail(e.target.value)}
                      placeholder="your.email@example.com"
                      required
                      disabled={modalLoading}
                      className="form-input"
                    />
                  </div>

                  {modalError && <div className="error-message">{modalError}</div>}

                  <button
                    type="submit"
                    disabled={modalLoading || !modalEmail}
                    className="btn btn-primary btn-large"
                  >
                    {modalLoading ? (
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
      </>
    );
  }

  return (
    <>
      <Header />
      <div className="complaint-form-container">
      <div className="stepper-card">
          <Stepper
            steps={[
              'Business Search',
              'Evidence (Photos)',
              'Complaint Description',
              'Confirmation',
            ]}
            currentStep={step}
          />
        </div>
      <div className="complaint-form-card">
        <h1>Submit a Special Complaint</h1>
        <p>Please complete the steps below to file your complaint.</p>

        <form onSubmit={handleFinalSubmit} className="complaint-form">
          {step === 1 ? (
            <>
              <div className="form-group">
                <div className="check-row" style={{ marginTop: 10 }}>
                  <input
                    id="businessNotInDb"
                    type="checkbox"
                    checked={businessNotInDb}
                    onChange={(e) => {
                      const checked = e.target.checked;

                      if (checked) {
                        // Reset any previously selected business when switching to manual entry mode
                        clearSelectedBusiness();
                      }

                      setBusinessNotInDb(checked);
                      setError(null);
                      setShowBusinessList(false);
                      setBusinesses([]);
                      setSearchQuery('');

                      if (checked) {
                        setFormData((prev) => ({
                          ...prev,
                          business_pk: null,
                        }));
                      }
                    }}
                  />
                  <label htmlFor="businessNotInDb" style={{ margin: 0, fontWeight: 800, color: '#0f172a' }}>
                    Business not listed? (No Permit Violation)
                  </label>
                </div>

                {!formData.business_name ? (
                  <div className="inline-note">
                    {businessNotInDb ? 'Enter the business name below.' : 'Select from the list to auto-fill the address.'}
                  </div>
                ) : null}

                {!businessNotInDb && (!firstSearchDone || !formData.business_name) ? (
                  <>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <div style={{ position: 'relative', flex: 1 }}>
                        <input
                          id="business_search"
                          aria-label="Business Search"
                          type="text"
                          value={searchQuery}
                          onChange={(e) => handleBusinessSearch(e.target.value)}
                          placeholder={nearbyOnly ? 'Search nearby businesses…' : 'Search business name or address...'}
                          className="form-input"
                          autoComplete="off"
                        />
                        {searchQuery ? (
                          <button
                            type="button"
                            onClick={clearBusinessSearch}
                            aria-label="Clear search"
                            title="Clear"
                            className="btn"
                            style={{
                              position: 'absolute',
                              right: 10,
                              top: '50%',
                              transform: 'translateY(-50%)',
                              width: 28,
                              height: 28,
                              borderRadius: 999,
                              padding: 0,
                              lineHeight: '28px',
                              textAlign: 'center',
                              background: '#f1f5f9',
                              border: '1px solid #e2e8f0',
                              color: '#0f172a',
                              fontWeight: 900,
                            }}
                          >
                            ×
                          </button>
                        ) : null}
                      </div>

                      <button
                        type="button"
                        onClick={async () => {
                          const next = !nearbyOnly;
                          setNearbyOnly(next);
                          clearBusinessSearch();

                          if (next) {
                            await findNearbyBusinesses();
                            return;
                          }

                          setNearbyBusinessesCache([]);
                        }}
                        disabled={loading}
                        className={`btn ${nearbyOnly ? 'btn-primary' : 'btn-secondary'}`}
                        style={{ whiteSpace: 'nowrap' }}
                        aria-pressed={nearbyOnly ? 'true' : 'false'}
                        title={nearbyOnly ? 'Nearby filter is ON' : 'Nearby filter is OFF'}
                      >
                        📍 Nearby
                      </button>
                    </div>

                    {showBusinessList && businesses.length > 0 ? (
                      <div className="business-list">
                        {businesses.map((business) => (
                          <div
                            key={business.business_pk}
                            className="business-item"
                            onClick={() => selectBusiness(business, 'initial')}
                          >
                            <div className="business-name">{business.business_name}</div>
                            <div className="business-address">{business.business_address}</div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </>
                ) : null}

                {!businessNotInDb && firstSearchDone && formData.business_name ? (
                  <div className="form-group" style={{ marginTop: 8 }}>
                    <label htmlFor="business_name_search">Business Name</label>
                    <div style={{ position: 'relative' }}>
                      <input
                        id="business_name_search"
                        type="text"
                        value={nameSearchQuery}
                        onChange={(e) => handleNameSearch(e.target.value)}
                        className="form-input"
                        placeholder={formData.business_name ? formData.business_name : 'Search or change business name'}
                        autoComplete="off"
                      />
                      {nameSearchQuery ? (
                        <button
                          type="button"
                          onClick={clearNameSearch}
                          aria-label="Clear business name search"
                          title="Clear"
                          className="btn"
                          style={{
                            position: 'absolute',
                            right: 10,
                            top: '50%',
                            transform: 'translateY(-50%)',
                            width: 28,
                            height: 28,
                            borderRadius: 999,
                            padding: 0,
                            lineHeight: '28px',
                            textAlign: 'center',
                            background: '#f1f5f9',
                            border: '1px solid #e2e8f0',
                            color: '#0f172a',
                            fontWeight: 900,
                          }}
                        >
                          ×
                        </button>
                      ) : null}
                    </div>

                    {showBusinessList && businesses.length > 0 ? (
                      <div className="business-list">
                        {businesses.map((business) => (
                          <div
                            key={business.business_pk}
                            className="business-item"
                            onClick={() => selectBusiness(business, 'name')}
                          >
                            <div className="business-name">{business.business_name}</div>
                            <div className="business-address">{business.business_address}</div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>

              {businessNotInDb ? (
                <div className="form-group">
                  <label htmlFor="business_name_manual">Business Name</label>
                  <input
                    id="business_name_manual"
                    type="text"
                    value={formData.business_name}
                    onChange={(e) => {
                      setManualJurisdictionCheck(EMPTY_MANUAL_JURISDICTION);
                      setFormData((prev) => ({ ...prev, business_name: e.target.value }));
                    }}
                    placeholder="Enter business name"
                    className="form-input"
                    required
                  />
                </div>
              ) : null}

              {(businessNotInDb || (firstSearchDone && formData.business_name)) ? (
                <>
                  <div className="form-group">
                    <label htmlFor="business_address">Business Address</label>
                    <input
                      id="business_address"
                      type="text"
                      value={formData.business_address}
                      onChange={(e) => {
                        setManualJurisdictionCheck(EMPTY_MANUAL_JURISDICTION);
                        setFormData((prev) => ({ ...prev, business_address: e.target.value }));
                      }}
                      placeholder="Full business address"
                      className="form-input"
                      readOnly={!!formData.business_pk}
                      disabled={!!formData.business_pk}
                      aria-readonly={formData.business_pk ? 'true' : 'false'}
                      required
                    />
                    {null}
                  </div>

                  <div className="form-group">
                    <label htmlFor="reporter_email">Your Email</label>
                    <input
                      id="reporter_email"
                      type="email"
                      value={formData.reporter_email}
                      onChange={(e) =>
                        setFormData((prev) => ({ ...prev, reporter_email: e.target.value }))
                      }
                      className="form-input"
                      required
                      disabled={true}
                    />
                                  </div>
                </>
              ) : null}
            </>
          ) : null}

          {step === 2 ? (
            <>
              <div className="form-group">
                <div
                  className={`dropzone ${loading ? '' : ''}`}
                  onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('hover'); }}
                  onDragLeave={(e) => { e.preventDefault(); e.currentTarget.classList.remove('hover'); }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.currentTarget.classList.remove('hover');
                    if (loading) return;
                    const dtFiles = Array.from(e.dataTransfer.files || []);
                    if (dtFiles.length) {
                      const mockEvent = { target: { files: dtFiles } };
                      handleEvidenceFileUpload(mockEvent);
                    }
                  }}
                  role="button"
                  aria-label="Evidence Dropzone"
                  style={{ marginTop: 10 }}
                >
                  <div className="dropzone-content">
                    <div className="dropzone-icon"></div>
                    <div className="dropzone-title">Upload Image</div>
                    <div className="dropzone-subtitle">JPG, PNG • Drag and drop or click to select</div>
                    <button
                      type="button"
                      className="btn btn-secondary dropzone-button"
                      onClick={(e) => { e.stopPropagation(); additionalImageInputRef.current?.click(); }}
                      disabled={loading}
                    >
                      Upload Image
                    </button>
                  </div>
                  <input
                    ref={additionalImageInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handleEvidenceFileUpload}
                    disabled={loading}
                    className="file-input"
                  />
                </div>
                
                <div className="inline-note" style={{ marginTop: 10 }}>
                  Upload one or more photos from your device. You can add up to 5 photos.
                </div>

                <div style={{ marginTop: 8 }}><span className="small-pill">{evidenceImages.length} / 5 added</span></div>

                {evidenceImages.length > 0 ? (
                  <div
                    style={{
                      marginTop: 10,
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))',
                      gap: 10,
                    }}
                  >
                    {evidenceImages.map((url, index) => (
                      <div
                        key={`${url}-${index}`}
                        title={url.split('/').pop()}
                        style={{
                          position: 'relative',
                          borderRadius: 12,
                          overflow: 'visible',
                          border: '1px solid #e2e8f0',
                          background: '#fff',
                          aspectRatio: '1 / 1',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <img
                          src={url}
                          alt="Evidence"
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        />
                        <button
                          type="button"
                          onClick={() => removeEvidenceImage(index)}
                          aria-label="Remove image"
                          style={{
                            position: 'absolute',
                            top: -10,
                            right: -10,
                            background: '#0f172a',
                            border: '1.5px solid rgba(255,255,255,0.25)',
                            boxShadow: '0 1px 2px rgba(15,23,42,0.15)',
                            width: 20,
                            height: 20,
                            borderRadius: '50%',
                            boxSizing: 'border-box',
                            padding: 0,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            cursor: 'pointer',
                            lineHeight: 1,
                            zIndex: 1,
                            userSelect: 'none',
                          }}
                        >
                          <img
                            src="/X icon.png"
                            alt="Remove"
                            style={{
                              width: 10,
                              height: 10,
                              filter: 'brightness(0) invert(1)',
                            }}
                          />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </>
          ) : null}

          {step === 3 ? (
            <>
              <div className="form-group">
                <label style={{ marginBottom: 6, fontWeight: 800, color: '#0f172a' }}>Nature of Violation</label>

                <div className="guided-cat-list" role="list" aria-label="Nature of Violation categories">
                  {GUIDED_CATEGORIES.map((c) => {
                    const isSelected = selectedCategories.includes(c.key);
                    const isOpen = expandedGuided[c.key] === true;
                    const subs = GUIDED_SUBCATS[c.key] || [];

                    return (
                      <div key={c.key} className={`guided-cat-row ${isSelected ? 'is-selected' : ''}`} role="listitem">
                        <button
                          type="button"
                          className="guided-cat-row-btn"
                          aria-expanded={isOpen ? 'true' : 'false'}
                          onClick={() => {
                            setExpandedGuided((prev) => ({ ...(prev || {}), [c.key]: !isOpen }));
                          }}
                        >
                          <span className="guided-cat-row-left">
                            <input
                              className="guided-cat-row-checkbox"
                              type="checkbox"
                              checked={isSelected}
                              onChange={(e) => {
                                e.stopPropagation();
                                const checked = e.target.checked;
                                toggleCategory(c.key, checked);
                                setExpandedGuided((prev) => ({ ...(prev || {}), [c.key]: checked ? true : false }));
                              }}
                              aria-label={`Select ${c.label}`}
                            />
                            <span className="guided-cat-row-label">{c.label}</span>
                          </span>
                          <span className="guided-cat-row-chevron">⌄</span>
                        </button>

                        <div
                          className="guided-cat-menu"
                          style={{
                            maxHeight: isOpen ? 420 : 0,
                            opacity: isOpen ? 1 : 0,
                          }}
                        >
                          <div className="guided-cat-menu-inner">
                            {subs.length === 0 ? (
                              <div className="inline-note" style={{ marginTop: 0 }}>
                                No specific violations configured.
                              </div>
                            ) : (
                              subs.map((sc) => (
                                <label key={sc.key} className="guided-menu-item">
                                  <input
                                    type="checkbox"
                                    checked={(selectedSubcats[c.key] || []).includes(sc.key)}
                                    onChange={(e) => {
                                      const checked = e.target.checked;
                                      if (checked && !selectedCategories.includes(c.key)) {
                                        toggleCategory(c.key, true);
                                      }
                                      toggleSubcat(c.key, sc.key, checked);
                                      setExpandedGuided((prev) => ({ ...(prev || {}), [c.key]: true }));
                                    }}
                                  />
                                  <span>{sc.label}</span>
                                </label>
                              ))
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="inline-note" style={{ marginTop: 6 }}>
                  Tap a category to select it and show its specific violations.
                </div>
              </div>

              <div className="form-group">
                <textarea
                  id="complaint_description"
                  aria-label="Complaint Description"
                  value={formData.complaint_description}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, complaint_description: e.target.value }))
                  }
                  placeholder="Describe the violation in detail..."
                  className="form-textarea"
                  rows="7"
                  required
                  minLength={20}
                  maxLength={1000}
                />
                <div className="char-counter">
                  <span>Min 20 / Max 1000</span>
                  <span>
                    <strong>{descLen}</strong>/1000
                  </span>
                </div>
              </div>
            </>
          ) : null}

          {step === 4 ? (
            <>
              <div className="form-group">
                <label>Review Summary</label>
                <div className="review-box">
                  <div className="review-row">
                    <div className="review-label">Business</div>
                    <div className="review-value">{formData.business_name || '—'}</div>
                  </div>
                  <div className="review-row">
                    <div className="review-label">Address</div>
                    <div className="review-value">{formData.business_address || '—'}</div>
                  </div>
                  <div className="review-row">
                    <div className="review-label">Email</div>
                    <div className="review-value">{formData.reporter_email || '—'}</div>
                  </div>

                  <div className="review-row">
                    <div className="review-label">Evidence Photos</div>
                    <div className="review-value">{evidenceImages.length || 0}</div>
                  </div>

                  {evidenceImages.length > 0 ? (
                    <div className="review-image-grid">
                      {evidenceImages.map((url) => (
                        <img key={url} src={url} alt="Evidence" />
                      ))}
                    </div>
                  ) : null}

                  {(selectedCategories.length > 0 || Object.keys(selectedSubcats || {}).length > 0) ? (
                    <div className="review-row" style={{ alignItems: 'flex-start', borderTop: '1px dashed #e5e7eb', paddingTop: 10, marginTop: 10 }}>
                      <div className="review-label">Complaint Category</div>
                      <div className="review-value">
                        <ul style={{ margin: 0, paddingLeft: 18, listStyle: 'disc' }}>
                          {selectedCategories
                            .map((catKey) => {
                              const cat = GUIDED_CATEGORIES.find((c) => c.key === catKey);
                              if (!cat) return null;
                              const subs = selectedSubcats[catKey] || [];
                              const arr = GUIDED_SUBCATS[catKey] || [];
                              const byKey = new Map(arr.map((s) => [s.key, s.label]));
                              const subLabels = subs.map((k) => byKey.get(k)).filter(Boolean);
                              const displayLabel = String(cat.label || '').replace(/\s*&\s*/g, ' and ');
                              return (
                                <li key={catKey} style={{ margin: '4px 0' }}>
                                  <span style={{ fontWeight: 800 }}>{displayLabel}</span>
                                  {subLabels.length > 0 ? (
                                    <ul style={{ margin: '4px 0 0 18px', padding: 0, listStyle: 'circle' }}>
                                      {subLabels.map((label) => (
                                        <li key={label} style={{ margin: '2px 0' }}>{label}</li>
                                      ))}
                                    </ul>
                                  ) : null}
                                </li>
                              );
                            })
                            .filter(Boolean)}
                        </ul>
                      </div>
                    </div>
                  ) : null}

                  <div className="review-row" style={{ alignItems: 'flex-start' }}>
                    <div className="review-label">Description</div>
                    <div className="review-value" style={{ whiteSpace: 'pre-wrap' }}>
                      {formData.complaint_description || '—'}
                    </div>
                  </div>
                </div>
              </div>

              <div className="form-group">
                <label>Review & Confirm</label>
                <div className="check-row">
                  <input
                    id="confirmTruth"
                    type="checkbox"
                    checked={confirmTruth}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setConfirmTruth(checked);

                      // Clear any prior submit error once the user satisfies the requirement.
                      if (checked && error === 'Please confirm the statement before submitting.') {
                        setError(null);
                      }
                    }}
                  />
                  <label htmlFor="confirmTruth" style={{ margin: 0, fontWeight: 500, color: '#0f172a' }}>
                    I confirm that the details are true and inaccurate information may lead to the non-processing of the complaint.
                  </label>
                </div>
              </div>

              <div className="form-group">
                <div className="inline-note">
                  Submitting will create a complaint record and you will be redirected to the confirmation page with your complaint ID.
                </div>
              </div>
            </>
          ) : null}

          <ErrorToast message={error} triggerKey={errorToastKey} />

          <div className="form-nav">
            {step === 1 ? null : (
              <button type="button" className="btn btn-secondary" onClick={goBack} disabled={loading}>
                Back
              </button>
            )}

            {step < TOTAL_STEPS ? (
              <button type="button" className="btn btn-primary" onClick={goNext} disabled={loading}>
                Next
              </button>
            ) : (
              <button type="submit" className="btn btn-primary" disabled={loading}>
                {loading ? 'Submitting…' : 'Submit Complaint'}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
      <Footer />
    </>
  );
}


