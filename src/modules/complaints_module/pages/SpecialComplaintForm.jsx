import { useEffect, useMemo, useRef, useState } from 'react';
import { submitComplaint, getBusinesses, uploadImage } from '../../../lib/complaints';
import { supabase } from '../../../lib/supabase';
import './ComplaintForm.css';

export default function SpecialComplaintForm({ verifiedEmail }) {
  const [step, setStep] = useState(1);

  const [formData, setFormData] = useState({
    business_pk: null,
    business_name: '',
    business_address: '',
    complaint_description: '',
    reporter_email: verifiedEmail || '',
    tags: [],
  });

  const [businessNotInDb, setBusinessNotInDb] = useState(false);

  const [businesses, setBusinesses] = useState([]);
  const [showBusinessList, setShowBusinessList] = useState(false);

  // Step 2: evidence images (required: at least 1, max 5)
  const [evidenceImages, setEvidenceImages] = useState([]);

  const [confirmTruth, setConfirmTruth] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

  const additionalImageInputRef = useRef(null);

  const TOTAL_STEPS = 4;

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

  const handleBusinessSearch = async (query) => {
    setSearchQuery(query);
    setError(null);

    if (query.length > 2) {
      try {
        const results = await getBusinesses(query);
        setBusinesses(results);
        setShowBusinessList(true);
      } catch (err) {
        setError(err.message);
      }
    } else {
      setBusinesses([]);
      setShowBusinessList(false);
    }
  };

  const selectBusiness = (business) => {
    setBusinessNotInDb(false);

    setFormData((prev) => ({
      ...prev,
      business_pk: business.business_pk,
      business_name: business.business_name,
      business_address: business.business_address,
    }));
    setShowBusinessList(false);
    setSearchQuery('');
  };

  const clearSelectedBusiness = () => {
    setError(null);
    setBusinesses([]);
    setShowBusinessList(false);
    setSearchQuery('');

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
      setError('You can only add up to 5 photos. Please remove an existing photo before adding another.');
      return;
    }

    // Validate file formats
    for (const file of files) {
      const validationError = validatePhotoFile(file);
      if (validationError) {
        setError(validationError);
        return;
      }
    }

    setLoading(true);

    try {
      const uploaded = await Promise.all(files.map((file) => uploadImage(file)));
      setEvidenceImages((prev) => [...prev, ...uploaded]);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const removeEvidenceImage = (index) => {
    setEvidenceImages((prev) => prev.filter((_, i) => i !== index));
  };

  const goNext = () => {
    setError(null);

    // Step validations
    if (step === 1) {
      if (!formData.business_name || !formData.business_address) {
        setError('Please provide a business name and address.');
        return;
      }
    }

    if (step === 2) {
      if (evidenceImages.length === 0) {
        setError('Please add at least one photo.');
        return;
      }
    }

    if (step === 3) {
      if (descLen < 20) {
        setError('Description is too short (minimum 20 characters).');
        return;
      }
      if (descLen > 1000) {
        setError('Description is too long (maximum 1000 characters).');
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
      setError('Please confirm the statement before submitting.');
      return;
    }

    try {
      const complaintPayload = {
        business_name: formData.business_name,
        business_address: formData.business_address,
        complaint_description: formData.complaint_description,
        reporter_email: formData.reporter_email,
        // store all images as URLs in image_urls
        image_urls: evidenceImages.filter(Boolean),
        tags: formData.tags,
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
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="complaint-form-container">
      <div className="complaint-form-card">
        <h1>Submit a Special Complaint</h1>
        <p>Please complete the steps below to file your complaint.</p>

        <div className="complaint-steps">
          <div className="complaint-progress" aria-label="Progress">
            <div className="complaint-progress-bar" style={{ width: `${progressPct}%` }} />
          </div>
          <div className="complaint-step-meta">
            <span>Step {step} of {TOTAL_STEPS}</span>
            <span>{progressPct}%</span>
          </div>
          <div className="complaint-step-title">{stepTitle}</div>
        </div>

        <form onSubmit={handleFinalSubmit} className="complaint-form">
          {step === 1 ? (
            <>
              <div className="form-group">
                <label htmlFor="business_search">Business Search</label>
                <input
                  id="business_search"
                  type="text"
                  value={searchQuery}
                  onChange={(e) => handleBusinessSearch(e.target.value)}
                  placeholder="Search business name or address..."
                  className="form-input"
                  autoComplete="off"
                  disabled={businessNotInDb}
                />

                <div className="check-row" style={{ marginTop: 10 }}>
                  <input
                    id="businessNotInDb"
                    type="checkbox"
                    checked={businessNotInDb}
                    onChange={(e) => {
                      const checked = e.target.checked;

                      // Toggling into "Business not listed" should reset any previously selected business
                      // so the user starts with a clean slate.
                      if (checked) {
                        clearSelectedBusiness();
                      }

                      setBusinessNotInDb(checked);
                      setError(null);
                      setShowBusinessList(false);
                      setBusinesses([]);
                      setSearchQuery('');

                      // Ensure we don't submit a stale business_pk in "not in DB" mode.
                      if (checked) {
                        setFormData((prev) => ({
                          ...prev,
                          business_pk: null,
                        }));
                      }
                    }}
                  />
                  <label htmlFor="businessNotInDb" style={{ margin: 0, fontWeight: 800, color: '#0f172a' }}>
                    Business not listed (No-Permit violation)
                  </label>
                </div>

                {showBusinessList && businesses.length > 0 ? (
                  <div className="business-list">
                    {businesses.map((business) => (
                      <div
                        key={business.business_pk}
                        className="business-item"
                        onClick={() => selectBusiness(business)}
                      >
                        <div className="business-name">{business.business_name}</div>
                        <div className="business-address">{business.business_address}</div>
                      </div>
                    ))}
                  </div>
                ) : null}

                {formData.business_name ? (
                  <div className="inline-note" style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                    <div>
                      {businessNotInDb ? (
                        <>Manual entry: <strong>{formData.business_name}</strong></>
                      ) : (
                        <>Selected: <strong>{formData.business_name}</strong></>
                      )}
                    </div>

                    {!businessNotInDb ? (
                      <button type="button" className="btn btn-secondary" onClick={clearSelectedBusiness}>
                        Remove selection
                      </button>
                    ) : null}
                  </div>
                ) : (
                  <div className="inline-note">
                    {businessNotInDb ? 'Enter the business name below.' : 'Select from the list to auto-fill the address.'}
                  </div>
                )}
              </div>

              {businessNotInDb ? (
                <div className="form-group">
                  <label htmlFor="business_name_manual">Business Name</label>
                  <input
                    id="business_name_manual"
                    type="text"
                    value={formData.business_name}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, business_name: e.target.value }))
                    }
                    placeholder="Enter business name"
                    className="form-input"
                    required
                  />
                </div>
              ) : null}

              <div className="form-group">
                <label htmlFor="business_address">Business Address</label>
                <input
                  id="business_address"
                  type="text"
                  value={formData.business_address}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, business_address: e.target.value }))
                  }
                  placeholder="Full business address"
                  className="form-input"
                  required
                />
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
                <div className="inline-note">We will send updates to this email address.</div>
              </div>
            </>
          ) : null}

          {step === 2 ? (
            <>
              <div className="form-group">
                <label>Evidence Photos</label>

                <div className="inline-note" style={{ marginTop: 10 }}>
                  Upload one or more photos from your device. You can add up to 5 photos.
                </div>

                <div className="file-upload" style={{ marginTop: 10 }}>
                  <input
                    ref={additionalImageInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handleEvidenceFileUpload}
                    disabled={loading}
                    className="file-input"
                  />
                  <button
                    type="button"
                    onClick={() => additionalImageInputRef.current?.click()}
                    disabled={loading}
                    className="btn btn-secondary"
                  >
                    Choose from Device
                  </button>
                  <span className="small-pill">{evidenceImages.length} / 5 added</span>
                </div>

                {evidenceImages.length > 0 ? (
                  <div className="file-list" style={{ marginTop: 10 }}>
                    {evidenceImages.map((url, index) => (
                      <div key={`${url}-${index}`} className="file-item">
                        <span>{url.split('/').pop()}</span>
                        <button
                          type="button"
                          onClick={() => removeEvidenceImage(index)}
                          className="btn-remove"
                        >
                          Remove
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
                <label htmlFor="complaint_description">Complaint Description</label>
                <textarea
                  id="complaint_description"
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
                  <label htmlFor="confirmTruth" style={{ margin: 0, fontWeight: 800, color: '#0f172a' }}>
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

          {error ? <div className="error-message">{error}</div> : null}

          <div className="form-nav">
            <button type="button" className="btn btn-secondary" onClick={goBack} disabled={loading || step === 1}>
              Back
            </button>

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
  );
}
