import { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, Marker, TileLayer, Polyline } from 'react-leaflet';
import L from 'leaflet';
import { submitComplaint, getBusinesses, uploadImage } from '../../../lib/complaints';
import { supabase } from '../../../lib/supabase';
import Header from '../../../components/Header.jsx';
import Stepper from '../../../components/Stepper.jsx';
import '../../../components/Stepper.css';
import './ComplaintForm.css';

export default function ComplaintForm({ verifiedEmail }) {
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

  // Step C (mandatory): primary image capture
  // Step 3: evidence images (required: at least 1)
  const [evidenceImages, setEvidenceImages] = useState([]);
  const [cameraPhotoUrls, setCameraPhotoUrls] = useState([]); // Track camera photos separately

  // In-browser camera capture
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [cameraBusy, setCameraBusy] = useState(false);
  const [facingMode, setFacingMode] = useState('environment'); // 'user' | 'environment'
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const cameraStartSeqRef = useRef(0);

  // (Step 5 was merged into Step 3)

  const [confirmTruth, setConfirmTruth] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [firstSearchDone, setFirstSearchDone] = useState(false);
  const [nameSearchQuery, setNameSearchQuery] = useState('');
  const [proximityVerified, setProximityVerified] = useState(false);
  const [proximityTag, setProximityTag] = useState(null);
  const [businessCoords, setBusinessCoords] = useState(null); // Store geocoded business location

  const withinRange = proximityTag === 'Location Verified';
  const outOfRange = proximityTag === 'Failed Location Verification';
  const [locationCheckAttempted, setLocationCheckAttempted] = useState(false);

  const primaryImageInputRef = useRef(null);
  const additionalImageInputRef = useRef(null);

  const TOTAL_STEPS = 5;

  const stepTitle = useMemo(() => {
    switch (step) {
      case 1:
        return 'Business Search';
      case 2:
        return 'Confirm Location';
      case 3:
        return 'Evidence (Photos)';
      case 4:
        return 'Complaint Description';
      case 5:
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

  const selectBusiness = (business, source = 'initial') => {
    setBusinessNotInDb(false);

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
      // source === 'name'
      setNameSearchQuery(business.business_name || '');
    }
  };

  const clearSelectedBusiness = () => {
    setError(null);
    setBusinesses([]);
    setShowBusinessList(false);
    setSearchQuery('');
    setNameSearchQuery('');
    setFirstSearchDone(false);
    setProximityTag(null);

    setFormData((prev) => {
      const nextTags = (prev.tags || []).filter(
        (t) => t !== 'Verification Unavailable' && t !== 'Failed Location Verification' && t !== 'Location Verified'
      );

      return {
        ...prev,
        business_pk: null,
        business_name: '',
        business_address: '',
        tags: nextTags,
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

  const handleNameSearch = async (query) => {
    setNameSearchQuery(query);
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

    // Cancellation / race protection: if the video element unmounts (step changes, camera closes)
    // while getUserMedia/play is in-flight, browsers can throw:
    // "The play() request was interrupted because the media was removed from the document"
    const seq = ++cameraStartSeqRef.current;

    setCameraBusy(true);
    try {
      stopCamera();

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: mode } },
        audio: false,
      });

      // If a newer start attempt happened, abandon this one and release the stream.
      if (seq !== cameraStartSeqRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      streamRef.current = stream;

      const videoEl = videoRef.current;
      if (!videoEl) return;

      // Ensure attributes are set both declaratively and imperatively for best compatibility.
      videoEl.muted = true;
      videoEl.playsInline = true;
      videoEl.autoplay = true;

      videoEl.srcObject = stream;

      // Wait until we have actual frame data before attempting play.
      if (videoEl.readyState < 2) {
        await new Promise((resolve) => {
          const onLoaded = () => {
            videoEl.removeEventListener('loadeddata', onLoaded);
            resolve();
          };
          videoEl.addEventListener('loadeddata', onLoaded);
        });
      }

      // Abort if camera was closed/unmounted while waiting.
      if (seq !== cameraStartSeqRef.current || !videoRef.current) return;

      try {
        await videoEl.play();
      } catch (playErr) {
        // If the element was removed, ignore; otherwise surface a helpful message.
        const msg = String(playErr?.message || playErr || '');
        if (!msg.includes('media was removed from the document')) {
          setCameraError('Unable to start camera preview. Please tap Open Camera again.');
          console.warn('video.play() failed:', playErr);
        }
      }

      if (seq === cameraStartSeqRef.current) {
        setCameraOpen(true);
      }
    } catch (e) {
      if (seq === cameraStartSeqRef.current) {
        setCameraError(e?.message || 'Unable to access camera. Please allow camera permission.');
        setCameraOpen(false);
      }
    } finally {
      if (seq === cameraStartSeqRef.current) {
        setCameraBusy(false);
      }
    }
  };

  const closeCamera = () => {
    // Invalidate any in-flight startCamera() so it won't call play() after unmount/close.
    cameraStartSeqRef.current += 1;

    stopCamera();

    // Detach stream from the element (helps some browsers release the camera cleanly)
    if (videoRef.current) {
      try {
        videoRef.current.srcObject = null;
      } catch {
        // ignore
      }
    }

    setCameraOpen(false);
  };

  // Start the camera reliably by ensuring the preview element is mounted first.
  // Some browsers require the <video> to exist before setting srcObject/playing,
  // otherwise the first attempt can produce a blank preview until retried.
  const openCameraFlow = async () => {
    setCameraError('');
    setCameraOpen(true);

    // Wait a tick so React mounts the <video> element.
    await new Promise((r) => setTimeout(r, 0));

    await startCamera(facingMode);
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

    // Check if we've reached the maximum photo limit
    if (evidenceImages.length >= MAX_PHOTOS) {
      setCameraError('You can only add up to 5 photos. Please remove an existing photo before adding another.');
      return;
    }

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
      setEvidenceImages((prev) => [...prev, url]);
      setCameraPhotoUrls((prev) => [...prev, url]); // Track camera photo separately

      // Keep camera open to allow multiple captures.
    } catch (e) {
      setCameraError(e?.message || 'Failed to capture image.');
    } finally {
      setLoading(false);
      setCameraBusy(false);
    }
  };

  // (additional images handled in Step 3 evidence)

  useEffect(() => {
    // Safety: when leaving step 3, stop camera to avoid keeping it open
    if (step !== 3) {
      setCameraError('');
      closeCamera();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  useEffect(() => {
    // Optional auto-start: once the user enters Step 3 and opens the camera,
    // ensure the stream is attached after the video element mounts.
    if (step !== 3) return;
    if (!cameraOpen) return;

    let cancelled = false;

    (async () => {
      // Wait a tick for mount/relayout.
      await new Promise((r) => setTimeout(r, 0));
      if (cancelled) return;

      // If there is no active stream yet, start it.
      if (!streamRef.current) {
        await startCamera(facingMode);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, cameraOpen]);

  // Sanitize address input: remove leading/trailing whitespace and limit length
  const sanitizeAddress = (input) => {
    if (typeof input !== 'string') return '';
    return input.trim().slice(0, 500);
  };

  // Normalize address for comparison (lowercase, trim extra spaces)
  const normalizeAddress = (addr) => {
    if (!addr) return '';
    return addr.toLowerCase().trim().replace(/\s+/g, ' ');
  };

  // Validate address format before API call
  const validateAddressInput = (address) => {
    if (!address) {
      return { valid: false, error: 'Address is required' };
    }

    const trimmed = address.trim();

    if (trimmed.length < 5) {
      return { valid: false, error: 'Address must be at least 5 characters' };
    }

    if (trimmed.length > 500) {
      return { valid: false, error: 'Address is too long (max 500 characters)' };
    }

    // Check for obviously invalid patterns (only special chars, no alphanumeric)
    if (!/[a-zA-Z0-9]/.test(trimmed)) {
      return { valid: false, error: 'Address must contain letters or numbers' };
    }

    return { valid: true, error: null };
  };

  // Check if manually entered address matches any business in database
  const checkAddressMatch = async (address) => {
    // Validate input first
    const validation = validateAddressInput(address);
    if (!validation.valid) {
      console.warn('Address validation failed:', validation.error);
      return null;
    }

    try {
      // Search for businesses with this address
      const results = await getBusinesses(address);
      
      if (results && results.length > 0) {
        const normalizedInput = normalizeAddress(address);
        
        // Find exact or close match
        const match = results.find((business) => {
          const normalizedDb = normalizeAddress(business.business_address);
          return normalizedDb === normalizedInput;
        });

        if (match) {
          return match;
        }
      }
    } catch (err) {
      // Log error for debugging but don't block form
      console.error('Error checking address match:', {
        address: address.substring(0, 50), // Log only first 50 chars for privacy
        error: err?.message || String(err),
        timestamp: new Date().toISOString(),
      });
      // Return null to allow form to continue (fail-open)
    }

    return null;
  };

  const verifyBusinessProximity = async (coords) => {
    const lat = coords?.lat ?? formData.reporter_lat;
    const lng = coords?.lng ?? formData.reporter_lng;

    if (lat == null || lng == null) {
      setError('Location not available.');
      return;
    }

    if (!formData.business_name) {
      setError('Select a business first.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Prepare request body: use business_pk if available, otherwise use user-provided address
      const requestBody = {
        reporter_lat: lat,
        reporter_lng: lng,
        threshold_meters: 200,
      };

      if (formData.business_pk) {
        requestBody.business_pk = formData.business_pk;
      } else if (businessNotInDb && formData.business_address) {
        // For no-permit submissions, pass the sanitized address
        requestBody.business_address = sanitizeAddress(formData.business_address);
      } else {
        setProximityTag('Verification Unavailable');
        setFormData((prev) => ({
          ...prev,
          tags: [...new Set([...(prev.tags || []), 'Verification Unavailable'])],
        }));
        setLoading(false);
        return;
      }

      const { data, error: invokeError } = await supabase.functions.invoke('verify-business-proximity', {
        body: requestBody,
      });

      // Fail-open: always allow continuation, but warn if far
      if (invokeError || !data?.ok) {
        setProximityTag('Verification Unavailable');
        setFormData((prev) => ({
          ...prev,
          tags: [...new Set([...prev.tags, 'Verification Unavailable'])],
        }));
        
        // Provide user feedback about verification failure
        if (invokeError) {
          setError(
            'Location verification encountered an error. You can still submit your complaint, ' +
            'but location verification will not be available.'
          );
        }
        return;
      }

      const tag = data.tag;
      setProximityTag(tag);
      
      // Store business coordinates for map display
      if (data.business_coords) {
        setBusinessCoords(data.business_coords);
      }

      setFormData((prev) => ({
        ...prev,
        tags: [...new Set([...prev.tags, tag])],
      }));

      // Warn if far, but don't block
      if (tag === 'Failed Location Verification') {
        setError(
          `You appear to be ${Math.round(data.distance_meters)}m away from the business. ` +
          `You can still submit, but being far away may affect how your complaint is reviewed.`
        );
      }
    } catch (err) {
      // Fail-open: allow continuation on error
      setProximityTag('Verification Unavailable');
      setFormData((prev) => ({
        ...prev,
        tags: [...new Set([...prev.tags, 'Verification Unavailable'])],
      }));
    } finally {
      setLoading(false);
    }
  };

  const requestDeviceLocation = () => {
    if (!('geolocation' in navigator)) {
      setError('Geolocation is not supported by this browser/device.');
      return Promise.resolve(null);
    }

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

          setError(message);
          setLoading(false);
          resolve(null);
        },
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
      );
    });
  };

  const detectLocation = async () => {
    setLocationCheckAttempted(true);
    const coords = await requestDeviceLocation();
    if (coords?.lat != null && coords?.lng != null) {
      await verifyBusinessProximity(coords);
    }
  };

  // Check if manually entered address matches a database business
  useEffect(() => {
    if (!businessNotInDb || !formData.business_address || formData.business_pk) {
      return;
    }

    let cancelled = false;

    (async () => {
      const match = await checkAddressMatch(formData.business_address);
      
      if (cancelled) return;

      if (match) {
        // Found a matching business in database - auto-link to it
        setFormData((prev) => ({
          ...prev,
          business_pk: match.business_pk,
          business_name: match.business_name,
          business_address: match.business_address,
        }));
        // Exit "Business not listed" mode since we found a match
        setBusinessNotInDb(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [businessNotInDb, formData.business_address, formData.business_pk]);

  useEffect(() => {
    // When Step 2 (Confirm Location) is shown, automatically re-check device location
    // and (best-effort) re-run proximity verification.
    if (step !== 2) return;

    let cancelled = false;

    (async () => {
      setLocationCheckAttempted(true);
      const coords = await requestDeviceLocation();
      if (cancelled) return;

      if (coords?.lat != null && coords?.lng != null) {
        await verifyBusinessProximity(coords);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, formData.business_pk]);

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
      if (formData.reporter_lat == null || formData.reporter_lng == null) {
        setError('Please confirm your device location before continuing.');
        return;
      }
    }

    if (step === 3) {
      if (evidenceImages.length === 0) {
        setError('Please add at least one photo.');
        return;
      }
    }

    if (step === 4) {
      const descLen = String(formData.complaint_description || '').length;
      if (descLen < 20) {
        setError('Description is too short (minimum 20 characters).');
        return;
      }
      if (descLen > 1000) {
        setError('Description is too long (maximum 1000 characters).');
        return;
      }
    }

    if (step === 5) {
      // last step
      return;
    }

    setStep((s) => Math.min(TOTAL_STEPS, s + 1));
  };

  // When arriving on the final step, clear any prior validation errors.
  // This avoids showing stale errors (e.g., confirm checkbox) before the user attempts submit.
  useEffect(() => {
    if (step !== 5) return;

    // Clear any stale validation errors on entry to Step 5.
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
        // store all images as URLs in image_urls; keep primary first
        image_urls: evidenceImages.filter(Boolean),
        tags: formData.tags,
        status: 'Submitted',
        email_verified: !!verifiedEmail,
        reporter_lat: formData.reporter_lat,
        reporter_lng: formData.reporter_lng,
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
    <>
      <Header />
      <div className="complaint-form-container">
            <div className="stepper-card">
              <Stepper
                steps={[
                  'Business Search',
                  'Confirm Location',
                  'Evidence (Photos)',
                  'Complaint Description',
                  'Confirmation',
                ]}
                currentStep={step}
              />
            </div>
            <div className="complaint-form-card">
        
        <h1>Submit a Complaint</h1>
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
                    Business not listed? (No Permit Violation)
                  </label>
                </div>

                {!formData.business_name ? (
                  <div className="inline-note">
                    {businessNotInDb ? 'Enter the business name below.' : 'Select from the list to auto-fill the address.'}
                  </div>
                ) : null}

                {!businessNotInDb && (!firstSearchDone || !formData.business_name) && (
                  <>
                    <input
                      id="business_search"
                      aria-label="Business Search"
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
                            onClick={() => selectBusiness(business, 'initial')}
                          >
                            <div className="business-name">{business.business_name}</div>
                            <div className="business-address">{business.business_address}</div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </>
                )}

                {!businessNotInDb && firstSearchDone && formData.business_name ? (
                  <div className="form-group" style={{ marginTop: 8 }}>
                    <label htmlFor="business_name_search">Business Name</label>
                    <input
                      id="business_name_search"
                      type="text"
                      value={nameSearchQuery || formData.business_name}
                      onChange={(e) => handleNameSearch(e.target.value)}
                      className="form-input"
                      placeholder="Search or change business name"
                      autoComplete="off"
                    />

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
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, business_name: e.target.value }))
                    }
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
                                  </div>
                </>
              ) : null}
            </>
          ) : null}

          {step === 2 ? (
            <>
              <div className="form-group">
                <label>Device Location</label>
                <div className="file-upload">
                  <button type="button" className={`btn btn-secondary ${loading ? 'btn-loading' : ''}`} onClick={detectLocation} disabled={loading}>
                    {loading ? (
                      <>
                        <span className="spinner" />
                        Checking…
                      </>
                    ) : (
                      'Check My Location'
                    )}
                  </button>
                  {formData.reporter_lat != null && formData.reporter_lng != null ? (
                    <span className="small-pill">✓ Location captured</span>
                  ) : (
                    <span className="small-pill">Not set</span>
                  )}
                </div>
                <div className="inline-note">
                  You must confirm your device location. If the pin on the map doesn't match where you are, click "Check My Location" again to update it.
                </div>
              </div>

              {businessCoords && formData.reporter_lat != null && formData.reporter_lng != null && (
                <div className="form-group">
                  <label>Location Comparison</label>
                  <div className="map-box">
                    <MapContainer
                      bounds={[
                        [formData.reporter_lat, formData.reporter_lng],
                        [businessCoords.lat, businessCoords.lng],
                      ]}
                      style={{ height: '100%', width: '100%' }}
                      scrollWheelZoom={false}
                    >
                      <TileLayer
                        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                      />
                      <Marker 
                        position={[formData.reporter_lat, formData.reporter_lng]} 
                        title="Your Location"
                        icon={L.icon({
                          iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png',
                          shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
                          iconSize: [25, 41],
                          iconAnchor: [12, 41],
                          popupAnchor: [1, -34],
                          shadowSize: [41, 41],
                        })}
                      />
                      <Marker 
                        position={[businessCoords.lat, businessCoords.lng]} 
                        title="Business Location"
                        icon={L.icon({
                          iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
                          shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
                          iconSize: [25, 41],
                          iconAnchor: [12, 41],
                          popupAnchor: [1, -34],
                          shadowSize: [41, 41],
                        })}
                      />
                      <Polyline 
                        positions={[
                          [formData.reporter_lat, formData.reporter_lng],
                          [businessCoords.lat, businessCoords.lng],
                        ]}
                        color="#666"
                        weight={2}
                        opacity={0.7}
                        dashArray="5, 5"
                      />
                    </MapContainer>
                  </div>
                  <div className="inline-note" style={{ marginTop: 8 }}>
                    <strong>Blue pin:</strong> Your location | <strong>Red pin:</strong> Business location | <strong>Dashed line:</strong> Distance between locations
                  </div>
                </div>
              )}
            </>
          ) : null}

          {step === 3 ? (
            <>
              <div className="form-group">

                {withinRange ? (
                  <div className="inline-note">
                    You are within 200m. For integrity, photo evidence must be captured using the in-app camera.
                  </div>
                ) : outOfRange ? (
                  <div className="inline-note">
                    You are not within 200m. Please upload existing photos from your device.
                  </div>
                ) : proximityTag === 'Verification Unavailable' ? (
                  <div className="inline-note">
                    Location verification is unavailable. You may use either method.
                  </div>
                ) : null}

                {/* Camera controls (allowed when within range or verification unavailable) */}
                {!outOfRange ? (
                  <>
                    <div className="file-upload" aria-label="Evidence (Camera Controls)" style={{ flexWrap: 'wrap', marginTop: 10 }}>
                      <button
                        type="button"
                        onClick={openCameraFlow}
                        disabled={loading || cameraBusy}
                        className="btn btn-secondary"
                      >
                        {cameraBusy ? 'Opening…' : (cameraOpen ? 'Camera Open' : 'Open Camera')}
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

                      <span className="small-pill">{evidenceImages.length} added</span>
                    </div>

                    {cameraError ? <div className="error-message">{cameraError}</div> : null}

                    {cameraOpen ? (
                      <div style={{ marginTop: 12 }}>
                        <div className="camera-box">
                          <video ref={videoRef} playsInline muted autoPlay className="camera-video" />
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
                  </>
                ) : null}

                {/* File upload (allowed when out of range, verification unavailable, or within range after camera capture) */}
                {outOfRange || cameraPhotoUrls.length > 0 ? (
                  <>
                    <div className="inline-note" style={{ marginTop: 14 }}>
                      Upload one or more photos.
                    </div>
                    <div className="file-upload" aria-label="Evidence (File Upload)" style={{ marginTop: 8 }}>
                      <input
                        ref={primaryImageInputRef}
                        type="file"
                        accept="image/*"
                        multiple
                        onChange={handleEvidenceFileUpload}
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
                  </>
                ) : withinRange && cameraPhotoUrls.length === 0 ? (
                  <div className="inline-note" style={{ marginTop: 14, color: '#666', fontStyle: 'italic' }}>
                    Capture at least one photo using the camera first to unlock device upload.
                  </div>
                ) : null}

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

          {step === 4 ? (
            <>
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

          
          {step === 5 ? (
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
    </>
  );
}
