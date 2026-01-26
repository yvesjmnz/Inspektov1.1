import { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, Marker, TileLayer } from 'react-leaflet';
import { submitComplaint, getBusinesses, uploadImage } from '../../../lib/complaints';
import './ComplaintForm.css';

export default function ComplaintForm({ verifiedEmail }) {
  const [step, setStep] = useState(1);

  const [formData, setFormData] = useState({
    business_name: '',
    business_address: '',
    complaint_description: '',
    reporter_email: verifiedEmail || '',
    tags: [],
    reporter_lat: null,
    reporter_lng: null,
  });

  const [businesses, setBusinesses] = useState([]);
  const [showBusinessList, setShowBusinessList] = useState(false);

  // Step C (mandatory): primary image capture
  const [primaryImageUrl, setPrimaryImageUrl] = useState('');

  // In-browser camera capture
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [cameraBusy, setCameraBusy] = useState(false);
  const [facingMode, setFacingMode] = useState('environment'); // 'user' | 'environment'
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  // Step E: additional image evidence
  const [additionalImages, setAdditionalImages] = useState([]);

  const [confirmTruth, setConfirmTruth] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

  const primaryImageInputRef = useRef(null);
  const additionalImageInputRef = useRef(null);

  const TOTAL_STEPS = 6;

  const stepTitle = useMemo(() => {
    switch (step) {
      case 1:
        return 'Business Search';
      case 2:
        return 'Confirm Location';
      case 3:
        return 'Capture Image (Required)';
      case 4:
        return 'Complaint Description';
      case 5:
        return 'Additional Image Evidence';
      case 6:
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
    setFormData((prev) => ({
      ...prev,
      business_name: business.business_name,
      business_address: business.business_address,
    }));
    setShowBusinessList(false);
    setSearchQuery('');
  };

  const handlePrimaryImageCapture = async (e) => {
    // legacy fallback (some browsers/devices may still use file input)
    const file = (e.target.files || [])[0];
    if (!file) return;

    setLoading(true);
    setError(null);

    try {
      const url = await uploadImage(file);
      setPrimaryImageUrl(url);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const stopCamera = () => {
    try {
      const s = streamRef.current;
      if (s) {
        s.getTracks().forEach((t) => t.stop());
      }
    } finally {
      streamRef.current = null;
    }
  };

  const startCamera = async (mode = facingMode) => {
    setCameraError('');

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('In-browser camera is not supported on this device/browser.');
      return;
    }

    setCameraBusy(true);
    try {
      stopCamera();

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: mode } },
        audio: false,
      });

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      setCameraOpen(true);
    } catch (e) {
      setCameraError(e?.message || 'Unable to access camera. Please allow camera permission.');
      setCameraOpen(false);
    } finally {
      setCameraBusy(false);
    }
  };

  const closeCamera = () => {
    stopCamera();
    setCameraOpen(false);
  };

  const switchCamera = async () => {
    const next = facingMode === 'environment' ? 'user' : 'environment';
    setFacingMode(next);
    await startCamera(next);
  };

  const captureFromCamera = async () => {
    setCameraError('');
    const video = videoRef.current;
    if (!video) return;

    try {
      setCameraBusy(true);

      const canvas = document.createElement('canvas');
      const w = video.videoWidth || 1280;
      const h = video.videoHeight || 720;
      canvas.width = w;
      canvas.height = h;

      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, w, h);

      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
      if (!blob) throw new Error('Failed to capture image.');

      const file = new File([blob], `capture-${Date.now()}.jpg`, { type: 'image/jpeg' });

      setLoading(true);
      setError(null);
      const url = await uploadImage(file);
      setPrimaryImageUrl(url);

      closeCamera();
    } catch (e) {
      setCameraError(e?.message || 'Failed to capture image.');
    } finally {
      setLoading(false);
      setCameraBusy(false);
    }
  };

  const handleAdditionalImagesUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    setLoading(true);
    setError(null);

    try {
      const uploaded = await Promise.all(files.map((file) => uploadImage(file)));
      setAdditionalImages((prev) => [...prev, ...uploaded]);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const removeAdditionalImage = (index) => {
    setAdditionalImages((prev) => prev.filter((_, i) => i !== index));
  };

  useEffect(() => {
    // Safety: when leaving step 3, stop camera to avoid keeping it open
    if (step !== 3) {
      setCameraError('');
      closeCamera();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const detectLocation = () => {
    setError(null);

    if (!navigator.geolocation) {
      setError('Geolocation is not supported by this browser/device.');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setFormData((prev) => ({
          ...prev,
          reporter_lat: pos.coords.latitude,
          reporter_lng: pos.coords.longitude,
        }));
      },
      (err) => {
        setError(err?.message || 'Unable to retrieve location.');
      },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  };

  const goNext = () => {
    setError(null);

    // Step validations
    if (step === 1) {
      if (!formData.business_name || !formData.business_address) {
        setError('Please select a business (and ensure address is filled).');
        return;
      }
    }

    if (step === 2) {
      if (formData.reporter_lat == null || formData.reporter_lng == null) {
        setError('Please confirm your device location before continuing.');
        return;
      }
    }

    if (step === 3) {
      if (!primaryImageUrl) {
        setError('Please capture an image using your device camera.');
        return;
      }
    }

    if (step === 4) {
      if (descLen < 20) {
        setError('Description is too short (minimum 20 characters).');
        return;
      }
      if (descLen > 1000) {
        setError('Description is too long (maximum 1000 characters).');
        return;
      }
    }

    if (step === 6) {
      // last step
      return;
    }

    setStep((s) => Math.min(TOTAL_STEPS, s + 1));
  };

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
        // store all images as URLs in image_urls; keep primary first
        image_urls: [primaryImageUrl, ...additionalImages].filter(Boolean),
        tags: formData.tags,
        status: 'Submitted',
        email_verified: !!verifiedEmail,
        reporter_lat: formData.reporter_lat,
        reporter_lng: formData.reporter_lng,
      };

      const created = await submitComplaint(complaintPayload);

      // Call edge function for emails (best-effort)
      try {
        await fetch('/functions/v1/request-email-verification', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: formData.reporter_email,
            complaint_id: created?.id,
            type: 'complaint_submitted',
          }),
        });
      } catch {
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
        <h1>Submit a Complaint</h1>
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
                />

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
                  <div className="inline-note">
                    Selected: <strong>{formData.business_name}</strong>
                  </div>
                ) : (
                  <div className="inline-note">Select from the list to auto-fill the address.</div>
                )}
              </div>

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
                  disabled={!!verifiedEmail}
                />
                <div className="inline-note">We will send updates to this email address.</div>
              </div>
            </>
          ) : null}

          {step === 2 ? (
            <>
              <div className="form-group">
                <label>Device Location</label>
                <div className="file-upload">
                  <button type="button" className="btn btn-secondary" onClick={detectLocation} disabled={loading}>
                    Use My Current Location
                  </button>
                  {formData.reporter_lat != null && formData.reporter_lng != null ? (
                    <span className="small-pill">✓ Location captured</span>
                  ) : (
                    <span className="small-pill">Not set</span>
                  )}
                </div>
                <div className="inline-note">
                  You must confirm your device location. Map preview requires Leaflet to be installed.
                </div>
              </div>

              <div className="form-group">
                <label>Map Preview</label>
                <div className="map-box">
                  {formData.reporter_lat != null && formData.reporter_lng != null ? (
                    <MapContainer
                      center={[formData.reporter_lat, formData.reporter_lng]}
                      zoom={18}
                      style={{ height: '100%', width: '100%' }}
                      scrollWheelZoom={false}
                    >
                      <TileLayer
                        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                      />
                      <Marker position={[formData.reporter_lat, formData.reporter_lng]} />
                    </MapContainer>
                  ) : (
                    <div style={{ padding: 12, color: '#0f172a', fontWeight: 800 }}>
                      Capture location to preview on map.
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : null}

          {step === 3 ? (
            <>
              <div className="form-group">
                <label>Capture Image (Required)</label>

                <div className="file-upload" style={{ flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={() => startCamera(facingMode)}
                    disabled={loading || cameraBusy}
                    className="btn btn-secondary"
                  >
                    {cameraBusy ? 'Opening…' : 'Open Camera'}
                  </button>

                  <button
                    type="button"
                    onClick={switchCamera}
                    disabled={loading || cameraBusy || !cameraOpen}
                    className="btn btn-secondary"
                  >
                    Switch Camera
                  </button>

                  <button
                    type="button"
                    onClick={closeCamera}
                    disabled={loading || cameraBusy || !cameraOpen}
                    className="btn btn-secondary"
                  >
                    Close
                  </button>

                  {primaryImageUrl ? (
                    <span className="small-pill">✓ Captured</span>
                  ) : (
                    <span className="small-pill">Required</span>
                  )}
                </div>

                {cameraError ? <div className="error-message">{cameraError}</div> : null}

                {cameraOpen ? (
                  <div style={{ marginTop: 12 }}>
                    <div className="camera-box">
                      <video ref={videoRef} playsInline muted className="camera-video" />
                    </div>

                    <div className="form-nav" style={{ marginTop: 12 }}>
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={captureFromCamera}
                        disabled={loading || cameraBusy}
                      >
                        {cameraBusy ? 'Capturing…' : 'Capture Photo'}
                      </button>
                    </div>
                  </div>
                ) : null}

                {/* Fallback file input for devices that block getUserMedia */}
                <div className="inline-note" style={{ marginTop: 10 }}>
                  If your browser blocks in-app camera, you can use the fallback file picker below.
                </div>
                <div className="file-upload" style={{ marginTop: 8 }}>
                  <input
                    ref={primaryImageInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={handlePrimaryImageCapture}
                    disabled={loading}
                    className="file-input"
                  />
                  <button
                    type="button"
                    onClick={() => primaryImageInputRef.current?.click()}
                    disabled={loading}
                    className="btn btn-secondary"
                  >
                    Choose from Device
                  </button>
                </div>

                {primaryImageUrl ? (
                  <div className="inline-note">
                    Stored: <strong>{primaryImageUrl.split('/').pop()}</strong>
                  </div>
                ) : null}
              </div>
            </>
          ) : null}

          {step === 4 ? (
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

          {step === 5 ? (
            <>
              <div className="form-group">
                <label>Additional Image Evidence (Optional)</label>
                <div className="file-upload">
                  <input
                    ref={additionalImageInputRef}
                    type="file"
                    multiple
                    accept="image/*"
                    onChange={handleAdditionalImagesUpload}
                    disabled={loading}
                    className="file-input"
                  />
                  <button
                    type="button"
                    onClick={() => additionalImageInputRef.current?.click()}
                    disabled={loading}
                    className="btn btn-secondary"
                  >
                    Add Images
                  </button>
                  <span className="small-pill">{additionalImages.length} added</span>
                </div>

                {additionalImages.length > 0 ? (
                  <div className="file-list">
                    {additionalImages.map((url, index) => (
                      <div key={url} className="file-item">
                        <span>{url.split('/').pop()}</span>
                        <button
                          type="button"
                          onClick={() => removeAdditionalImage(index)}
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

          {step === 6 ? (
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
                    <div className="review-label">Primary Photo</div>
                    <div className="review-value">
                      {primaryImageUrl ? (
                        <a href={primaryImageUrl} target="_blank" rel="noreferrer">View image</a>
                      ) : (
                        '—'
                      )}
                    </div>
                  </div>

                  {primaryImageUrl ? (
                    <div className="review-image-grid">
                      <img src={primaryImageUrl} alt="Primary evidence" />
                    </div>
                  ) : null}

                  {additionalImages.length > 0 ? (
                    <>
                      <div className="review-row">
                        <div className="review-label">Additional Images</div>
                        <div className="review-value">{additionalImages.length}</div>
                      </div>
                      <div className="review-image-grid">
                        {additionalImages.map((url) => (
                          <img key={url} src={url} alt="Additional evidence" />
                        ))}
                      </div>
                    </>
                  ) : (
                    <div className="review-row">
                      <div className="review-label">Additional Images</div>
                      <div className="review-value">0</div>
                    </div>
                  )}

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
                    onChange={(e) => setConfirmTruth(e.target.checked)}
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
