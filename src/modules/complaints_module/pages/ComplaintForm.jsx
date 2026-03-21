import { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, Marker, TileLayer, Polyline } from 'react-leaflet';
import L from 'leaflet';
import { submitComplaint, getBusinesses, uploadImage, resolveBusinessJurisdiction } from '../../../lib/complaints';
import { supabase } from '../../../lib/supabase';
import { getNearbyBusinesses, formatDistance } from '../../../lib/complaints/nearbyBusinesses';
import Header from '../../../components/Header.jsx';
import Footer from '../../../components/Footer.jsx';
import Stepper from '../../../components/Stepper.jsx';
import XIconButton from '../../../components/XIconButton.jsx';
import ErrorToast from '../../../components/ErrorToast.jsx';
import NoteToast from '../../../components/NoteToast.jsx';
import '../../../components/Stepper.css';
import './ComplaintForm.css';

const EMPTY_MANUAL_JURISDICTION = {
  checkedAddress: '',
  resolvedAddress: '',
  resolvedLocality: '',
  withinManilaCity: null,
  errorMessage: '',
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
  const [nearbyOnly, setNearbyOnly] = useState(false);
  const [nearbyBusinessesCache, setNearbyBusinessesCache] = useState([]);

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
  const [errorToastKey, setErrorToastKey] = useState(0);
  const [note, setNote] = useState(null);
  const [noteToastKey, setNoteToastKey] = useState(0);

  const showError = (msg) => {
    const m = String(msg || '').trim();
    if (!m) return;
    setError(m);
    setErrorToastKey((k) => k + 1);
  };

  const showNote = (msg) => {
    const m = String(msg || '').trim();
    if (!m) return;
    setNote(m);
    setNoteToastKey((k) => k + 1);
  };

  const [searchQuery, setSearchQuery] = useState('');
  const [firstSearchDone, setFirstSearchDone] = useState(false);
  const [nameSearchQuery, setNameSearchQuery] = useState('');
  const [proximityVerified, setProximityVerified] = useState(false);
  const [proximityTag, setProximityTag] = useState(null);
  const [businessCoords, setBusinessCoords] = useState(null); // Store geocoded business location
  const [manualJurisdictionCheck, setManualJurisdictionCheck] = useState(EMPTY_MANUAL_JURISDICTION);

  const OUTSIDE_JURISDICTION_MESSAGE =
    'This business address is outside the supported inspection area for Manila City.';

  const withinRange = proximityTag === 'Location Verified';
  const outOfRange = proximityTag === 'Failed Location Verification';
  const [locationCheckAttempted, setLocationCheckAttempted] = useState(false);

  // Step 3 rule:
  // - If user is within 200m, they must capture at least one photo using the in-app camera first.
  // - After at least one camera capture, they may upload additional photos from device.
  const hasCameraEvidence = (cameraPhotoUrls || []).length > 0;
  // Upload UI should always be available; integrity is enforced on Next.
  const canUploadAdditionalPhotos = true;

  const primaryImageInputRef = useRef(null);
  const additionalImageInputRef = useRef(null);

  // Prevent stale async search results from repopulating suggestions after the user clears/backspaces.
  // NOTE: handled with query refs (no seq gating) to keep UI responsive.
  const businessSearchQueryRef = useRef('');
  const nameSearchQueryRef = useRef('');

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

  // Guided Filing (Step 4) configuration and state
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

  const [selectedCategories, setSelectedCategories] = useState([]);
  const [expandedGuided, setExpandedGuided] = useState({});
  const [selectedSubcats, setSelectedSubcats] = useState({});

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

    // Update visible input immediately.
    setSearchQuery(q);
    setError(null);

    // Track latest query so slow responses can be ignored.
    businessSearchQueryRef.current = q;

    // If query is too short/empty, clear suggestions immediately.
    if (q.length <= 2) {
      setBusinesses([]);
      setShowBusinessList(false);
      return;
    }

    // Nearby-only mode: filter locally from the nearby cache (no network search).
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

    // Normal mode: query full DB.
    try {
      const results = await getBusinesses(q);

      // Ignore stale responses.
      if (businessSearchQueryRef.current !== q) return;

      setBusinesses(results);
      setShowBusinessList(true);
    } catch (err) {
      if (businessSearchQueryRef.current !== q) return;
      showError(err?.message || String(err));
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
    // Clearing the name search should also clear the selected business,
    // otherwise the address will remain populated and confuse the user.
    clearSelectedBusiness();
    setError(null);
    setNameSearchQuery('');
    setBusinesses([]);
    setShowBusinessList(false);
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
    setManualJurisdictionCheck(EMPTY_MANUAL_JURISDICTION);

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
    const q = String(query || '');

    // If the user edits the business name after selecting one from the DB,
    // clear the selected business details so address/pk aren't kept (or re-used)
    // while the user is typing/backspacing.
    if (formData.business_pk) {
      setFormData((prev) => ({
        ...prev,
        business_pk: null,
        business_name: '',
        business_address: '',
      }));

      // Also clear any stale suggestions from the previously selected business.
      setBusinesses([]);
      setShowBusinessList(false);
    }

    // Update visible input immediately.
    setNameSearchQuery(q);
    setError(null);

    // Track latest query so slow responses can be ignored.
    nameSearchQueryRef.current = q;

    if (q.length <= 2) {
      setBusinesses([]);
      setShowBusinessList(false);
      return;
    }

    try {
      const results = await getBusinesses(q);
      if (nameSearchQueryRef.current !== q) return;
      setBusinesses(results);
      setShowBusinessList(true);
    } catch (err) {
      if (nameSearchQueryRef.current !== q) return;
      showError(err?.message || String(err));
    }
  };

  const handleEvidenceFileUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    setError(null);

    // Check if adding these files would exceed the limit
    const totalPhotos = evidenceImages.length + files.length;
    if (totalPhotos > MAX_PHOTOS) {
      showError('Maximum of 5 photos allowed');
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
    setEvidenceImages((prev) => {
      const victim = prev[index];

      // Keep camera evidence tracking in sync so users can't delete the camera photo
      // and still unlock uploads while within 200m.
      if (victim) {
        setCameraPhotoUrls((cams) => (cams || []).filter((u) => u !== victim));
      }

      return prev.filter((_, i) => i !== index);
    });
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

  const validateManualBusinessJurisdiction = async () => {
    if (!businessNotInDb || formData.business_pk) return true;

    const address = sanitizeAddress(formData.business_address);
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

  const verifyBusinessProximity = async (coords) => {
    const lat = coords?.lat ?? formData.reporter_lat;
    const lng = coords?.lng ?? formData.reporter_lng;

    if (lat == null || lng == null) {
      showError('Location not available.');
      return;
    }

    if (!formData.business_name) {
      showError('Select a business first.');
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
          showError(
            'Location verification encountered an error. You can still submit your complaint, ' +
            'but location verification will not be available.'
          );
        }
        return;
      }

      if (data.business_coords) {
        setBusinessCoords(data.business_coords);
      }

      if (data.within_manila_city === false) {
        const outsideMessage = buildOutsideJurisdictionMessage(OUTSIDE_JURISDICTION_MESSAGE, data);
        setProximityTag('Verification Unavailable');
        setFormData((prev) => ({
          ...prev,
          tags: [...new Set([...(prev.tags || []), 'Verification Unavailable'])],
        }));
        showError(outsideMessage);
        return;
      }

      const tag = data.tag;
      setProximityTag(tag);

      setFormData((prev) => {
        // Remove old location verification tags to avoid conflicts on retry
        const filteredTags = (prev.tags || []).filter(
          (t) => t !== 'Location Verified' && t !== 'Failed Location Verification' && t !== 'Verification Unavailable'
        );
        return {
          ...prev,
          tags: [...new Set([...filteredTags, tag])],
        };
      });

      // Warn if far, but don't block
      if (tag === 'Failed Location Verification') {
        showNote(`You appear to be ${Math.round(data.distance_meters)}m away from the business.`);
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
      showError('Geolocation is not supported by this browser/device.');
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

          showError(message);
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

  const findNearbyBusinesses = async () => {
    setError(null);
    setLoading(true);

    try {
      // Get user's current location
      const coords = await requestDeviceLocation();
      if (coords?.lat == null || coords?.lng == null) {
        showError('Unable to get your location. Please enable location services.');
        setLoading(false);
        return;
      }

      // Find nearby businesses (200m radius)
      const nearby = await getNearbyBusinesses(coords.lat, coords.lng, 200);

      if (nearby.length === 0) {
        showError('No businesses found within 200m of your location.');
        setLoading(false);
        return;
      }

      // Cache and display nearby businesses
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
        setManualJurisdictionCheck(EMPTY_MANUAL_JURISDICTION);
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
      if (formData.reporter_lat == null || formData.reporter_lng == null) {
        showError('Please confirm your device location before continuing.');
        return;
      }
    }

    if (step === 3) {
      if (evidenceImages.length === 0) {
        showError('Please add at least one photo.');
        return;
      }

      // Integrity rule: when within 200m, at least one remaining photo must be captured in-app.
      if (withinRange && (cameraPhotoUrls || []).length === 0) {
        showError('Capture at least one in-app photo');
        return;
      }
    }

    if (step === 4) {
      const descText = String(formData.complaint_description || '').trim();

      // Require: at least 1 selected category
      if ((selectedCategories || []).length === 0) {
        showError('Please specify at least one violation.');
        return;
      }

      // Rule: for EACH selected Nature of Violation, at least 1 specific violation under it must be checked.
      const missingSubFor = (selectedCategories || []).find((catKey) => (selectedSubcats?.[catKey]?.length || 0) === 0);
      if (missingSubFor) {
        const catLabel = GUIDED_CATEGORIES.find((c) => c.key === missingSubFor)?.label || 'the selected category';
        showError(`Please select at least one specific violation under: ${catLabel}.`);
        return;
      }

      // Require min 20 characters
      if (descText.length < 20) {
        showError('Description is too short (minimum 20 characters).');
        return;
      }

      if (descText.length > 1000) {
        showError('Description is too long (maximum 1000 characters).');
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
      showError('Please confirm the statement before submitting.');
      return;
    }

    try {
      // Derive Violation tags from selected sub-categories
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
        // store all images as URLs in image_urls; keep primary first
        image_urls: evidenceImages.filter(Boolean),
        tags: mergedTags,
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
      showError(err?.message || String(err));
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

                          // Always clear the current input/suggestions when toggling modes
                          // so the user starts fresh.
                          clearBusinessSearch();

                          // Turning ON: fetch nearby list (and show it)
                          if (next) {
                            await findNearbyBusinesses();
                            return;
                          }

                          // Turning OFF: clear nearby cache
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

                    {null}

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
                <label>Device Location</label>
                <div className="file-upload">
                  <button
                    type="button"
                    className={`btn btn-secondary ${loading ? 'btn-loading' : ''}`}
                    onClick={detectLocation}
                    disabled={loading}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 8,
                      lineHeight: 1,
                    }}
                  >
                    {loading ? (
                      <>
                        <span className="spinner" style={{ margin: 0, flex: '0 0 auto' }} />
                        <span style={{ display: 'inline-block', transform: 'translateY(0.5px)' }}>Checking…</span>
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
                    You are within 200m, so at least one photo must be taken using the in-app camera.
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
                      {!cameraOpen ? (
                        <>
                          <button
                            type="button"
                            onClick={openCameraFlow}
                            disabled={loading || cameraBusy}
                            className="btn btn-secondary"
                          >
                            {cameraBusy ? 'Opening…' : 'Open Camera'}
                          </button>
                          <span className="small-pill">{evidenceImages.length} added</span>
                        </>
                      ) : (
                        <>
                          <span className="small-pill">{evidenceImages.length} added</span>
                        </>
                      )}
                    </div>

                    {cameraError ? <div className="error-message">{cameraError}</div> : null}

                    {cameraOpen ? (
                      <div style={{ marginTop: 12 }}>
                        <div className="camera-box" style={{ position: 'relative' }}>
                          <video ref={videoRef} playsInline muted autoPlay className="camera-video" />
                          <div
                            style={{
                              position: 'absolute',
                              left: 12,
                              right: 12,
                              bottom: 12,
                              display: 'grid',
                              gridTemplateColumns: '1fr auto 1fr',
                              alignItems: 'center',
                              columnGap: 16,
                              background: 'transparent',
                              padding: '0 12px',
                              borderRadius: 12
                            }}
                          >
                            <div style={{ justifySelf: 'end' }}>
                              <button
                                type="button"
                                onClick={switchCamera}
                                disabled={loading || cameraBusy}
                                className="btn btn-secondary"
                                style={{ width: 40, height: 40, borderRadius: '999px', padding: 0, display: 'inline-flex' }}
                                aria-label="Switch Camera"
                                title="Switch Camera"
                                >
                                <img src="/ui_icons/switch-camera.png" alt="Switch" style={{ width: 18, height: 18, filter: 'invert(1) brightness(2) contrast(100%)' }} />
                                </button>
                            </div>
                            <div style={{ justifySelf: 'center' }}>
                              <button
                                type="button"
                                onClick={captureFromCamera}
                                disabled={loading || cameraBusy}
                                className="btn btn-primary"
                                style={{ width: 64, height: 64, borderRadius: '999px', padding: 0, boxShadow: '0 6px 16px rgba(0,0,0,0.25)', display: 'inline-flex' }}
                                aria-label="Capture Photo"
                                title="Capture Photo"
                              >
                                <img src="/ui_icons/camera.png" alt="Capture" style={{ width: 26, height: 26, filter: 'invert(1) brightness(2) contrast(100%)' }} />
                              </button>
                            </div>
                            <div />
                          </div>
                          <XIconButton
                            label="Close Camera"
                            onClick={closeCamera}
                            disabled={loading || cameraBusy}
                            style={{
                              position: 'absolute',
                              top: 10,
                              right: 10,
                            }}
                          />
                        </div>
                      </div>
                    ) : null}
                  </>
                ) : null}

                {/* File upload (always available; integrity is enforced on Next when within 200m) */}
                {canUploadAdditionalPhotos ? (
                  <>
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
                    <div style={{ marginTop: 8 }}><span className="small-pill">{evidenceImages.length} / 5 added</span></div>
                  </>
                ) : null}

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
                        <XIconButton
                          size="sm"
                          label="Remove image"
                          onClick={() => removeEvidenceImage(index)}
                          style={{
                            position: 'absolute',
                            top: -8,
                            right: -8,
                            zIndex: 1,
                            userSelect: 'none',
                          }}
                        />
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </>
          ) : null}

          {step === 4 ? (
            <>
              {/* Guided Filing: Nature of Violation (pill buttons with dropdown checklist inside) */}
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
                            // Only open/close the dropdown. Do NOT auto-check the category.
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
                                // if user checks it, open; if unchecks it, close
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
                                      // If user selects a specific violation, ensure its parent category is selected too.
                                      if (checked && !selectedCategories.includes(c.key)) {
                                        toggleCategory(c.key, true);
                                      }
                                      toggleSubcat(c.key, sc.key, checked);
                                      // Keep the dropdown open while interacting.
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

              {/* Move Complaint Description textarea to bottom */}
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

                  <div className="review-row" style={{ borderBottom: 'none' }}>
                    <div className="review-label">Evidence Photos</div>
                    <div className="review-value">
                      {evidenceImages.length || 0}
                      {evidenceImages.length > 0 ? (
                        <div className="review-image-grid" style={{ marginTop: 6 }}>
                          {evidenceImages.map((url) => (
                            <img key={url} src={url} alt="Evidence" />
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>

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
                      // Prevent any implicit form submission behavior that some browsers/extensions
                      // can trigger when interacting with controls inside a <form>.
                      e.preventDefault();
                      e.stopPropagation();

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
            </>
          ) : null}

          <ErrorToast message={error} triggerKey={errorToastKey} />
          <NoteToast message={note} triggerKey={noteToastKey} />

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
