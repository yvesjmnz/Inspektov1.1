import { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, Marker, TileLayer } from 'react-leaflet';
import L from 'leaflet';
import Header from '../../../components/Header';
import Footer from '../../../components/Footer';
import { supabase } from '../../../lib/supabase';
import './InspectionSlipCreate.css';

function getMissionOrderIdFromQuery() {
const params = new URLSearchParams(window.location.search);
return params.get('missionOrderId') || params.get('id');
}

function getInspectionReportIdFromQuery() {
const params = new URLSearchParams(window.location.search);
return params.get('inspectionReportId') || params.get('reportId') || params.get('id');
}

export default function InspectionSlipCreate() {
  const missionOrderId = useMemo(() => getMissionOrderIdFromQuery(), []);
  const inspectionReportIdFromQuery = useMemo(() => getInspectionReportIdFromQuery(), []);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  const [missionOrder, setMissionOrder] = useState(null);
  const [complaint, setComplaint] = useState(null);

  const [inspectionReportId, setInspectionReportId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false);
  const [completionKnown, setCompletionKnown] = useState(false);

  const [businessSearch, setBusinessSearch] = useState('');
  const [businessResult, setBusinessResult] = useState(null);
  const [checkingBusiness, setCheckingBusiness] = useState(false);

  const [ownerDetails, setOwnerDetails] = useState({
    lastName: '',
    firstName: '',
    middleName: '',
    businessName: '',
  });

  const [businessDetails, setBusinessDetails] = useState({
    bin: '',
    address: '',
    estimatedAreaSqm: '',
    numberOfEmployees: '',
    landline: '',
    cellphone: '',
    email: '',
  });

  // Inspector device location (captured via browser geolocation)
  const [inspectorLocation, setInspectorLocation] = useState({
    lat: null,
    lng: null,
    accuracy: null,
    capturedAt: null,
  });
  const [locationError, setLocationError] = useState('');
  const [locationBusy, setLocationBusy] = useState(false);

  // Owner type affects autofill behavior for owner name fields
  const [ownerType, setOwnerType] = useState('sole'); // 'sole' | 'corp'

  const [autoFillMessage, setAutoFillMessage] = useState('');

  // Tabs: order required by UX
  const [activeTab, setActiveTab] = useState('inspection_details'); // 'inspection_details' | 'inspection' | 'summary'

  // Businesses can have multiple line(s) of business. We store it as an editable list.
  const [lineOfBusinessList, setLineOfBusinessList] = useState(['']);

  // Checklist with tri-state: compliant | non_compliant | na
  const [checklist, setChecklist] = useState({
    business_permit: 'na',
    with_cctv: 'na',
    signage_2sqm: 'na',
  });

  // Only used when "With CCTV" is marked Compliant.
  const [cctvCount, setCctvCount] = useState('');

  const COMMENTS_MAX = 500;
  const [additionalComments, setAdditionalComments] = useState('');

  const quickTags = useMemo(
    () => ['Major Violation', 'Minor Observation', 'Follow-up Required', 'Clean Record'],
    []
  );

  const applyQuickTag = (tag) => {
    const t = `[${tag}]`;
    setAdditionalComments((prev) => {
      const cur = String(prev || '');
      if (!cur.trim()) return `${t} `;
      if (cur.includes(t)) return cur; // avoid duplicates
      return `${t} ${cur}`;
    });
  };

  // Camera capture for evidence photos (Inspection Slip)
  const [evidencePhotos, setEvidencePhotos] = useState([]);
  const [activePhotoUrl, setActivePhotoUrl] = useState('');
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [cameraBusy, setCameraBusy] = useState(false);
  const [facingMode, setFacingMode] = useState('environment'); // 'user' | 'environment'
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const cameraStartSeqRef = useRef(0);

  const stopCamera = () => {
    try {
      const s = streamRef.current;
      if (s) s.getTracks().forEach((t) => t.stop());
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

    const seq = ++cameraStartSeqRef.current;
    setCameraBusy(true);

    try {
      stopCamera();

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: mode } },
        audio: false,
      });

      if (seq !== cameraStartSeqRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      streamRef.current = stream;

      const videoEl = videoRef.current;
      if (!videoEl) return;

      videoEl.muted = true;
      videoEl.playsInline = true;
      videoEl.autoplay = true;
      videoEl.srcObject = stream;

      if (videoEl.readyState < 2) {
        await new Promise((resolve) => {
          const onLoaded = () => {
            videoEl.removeEventListener('loadeddata', onLoaded);
            resolve();
          };
          videoEl.addEventListener('loadeddata', onLoaded);
        });
      }

      if (seq !== cameraStartSeqRef.current || !videoRef.current) return;

      try {
        await videoEl.play();
      } catch (playErr) {
        const msg = String(playErr?.message || playErr || '');
        if (!msg.includes('media was removed from the document')) {
          setCameraError('Unable to start camera preview. Please tap Open Camera again.');
          console.warn('video.play() failed:', playErr);
        }
      }

      if (seq === cameraStartSeqRef.current) setCameraOpen(true);
    } catch (e) {
      if (seq === cameraStartSeqRef.current) {
        setCameraError(e?.message || 'Unable to access camera. Please allow camera permission.');
        setCameraOpen(false);
      }
    } finally {
      if (seq === cameraStartSeqRef.current) setCameraBusy(false);
    }
  };

  const closeCamera = () => {
    cameraStartSeqRef.current += 1;
    stopCamera();

    if (videoRef.current) {
      try {
        videoRef.current.srcObject = null;
      } catch {
        // ignore
      }
    }

    setCameraOpen(false);
  };

  const openCameraFlow = async () => {
    setCameraError('');
    setCameraOpen(true);
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

    try {
      setCameraBusy(true);

      const canvas = document.createElement('canvas');
      const w = video.videoWidth || 1280;
      const h = video.videoHeight || 720;
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, w, h);

      // Burn timestamp into the image (bottom-left)
      const ts = Date.now();
      const tsText = new Date(ts).toLocaleString();
      const pad = Math.max(12, Math.round(Math.min(w, h) * 0.018));
      const fontSize = Math.max(18, Math.round(Math.min(w, h) * 0.03));

      ctx.font = `900 ${fontSize}px system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif`;
      ctx.textBaseline = 'bottom';

      // Background pill
      const textMetrics = ctx.measureText(tsText);
      const textW = Math.ceil(textMetrics.width);
      const boxH = Math.round(fontSize * 1.25);
      const boxW = textW + pad * 2;
      const x = pad;
      const y = h - pad;
      const r = Math.round(boxH / 2);

      ctx.fillStyle = 'rgba(15,23,42,0.70)';
      ctx.beginPath();
      ctx.moveTo(x + r, y - boxH);
      ctx.arcTo(x + boxW, y - boxH, x + boxW, y, r);
      ctx.arcTo(x + boxW, y, x, y, r);
      ctx.arcTo(x, y, x, y - boxH, r);
      ctx.arcTo(x, y - boxH, x + boxW, y - boxH, r);
      ctx.closePath();
      ctx.fill();

      // Timestamp text
      ctx.fillStyle = '#ffffff';
      ctx.fillText(tsText, x + pad, y - Math.round(pad * 0.25));

      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
      if (!blob) throw new Error('Failed to capture image.');

      const url = URL.createObjectURL(blob);
      setEvidencePhotos((prev) => [...prev, { url, blob, ts }]);
    } catch (e) {
      setCameraError(e?.message || 'Failed to capture image.');
    } finally {
      setCameraBusy(false);
    }
  };

  const removeEvidencePhoto = (index) => {
    setEvidencePhotos((prev) => {
      const victim = prev[index];
      if (victim?.url) {
        try {
          URL.revokeObjectURL(victim.url);
        } catch {
          // ignore
        }
      }
      return prev.filter((_, i) => i !== index);
    });
  };

  useEffect(() => {
    // Cleanup camera + blob urls on unmount
    return () => {
      try {
        closeCamera();
      } catch {
        // ignore
      }

      try {
        evidencePhotos.forEach((p) => {
          if (p?.url) URL.revokeObjectURL(p.url);
        });
      } catch {
        // ignore
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const inspectorCanvasRef = useRef(null);
  const ownerCanvasRef = useRef(null);

  // Track drawing state + last point for each canvas.
  const inspectorDrawing = useRef(false);
  const ownerDrawing = useRef(false);
  const inspectorLastPos = useRef({ x: 0, y: 0 });
  const ownerLastPos = useRef({ x: 0, y: 0 });

  // Pointer id tracking helps avoid stray moves when a different finger touches the screen.
  const inspectorPointerIdRef = useRef(null);
  const ownerPointerIdRef = useRef(null);

  const [inspectorSignature, setInspectorSignature] = useState('');
  const [ownerSignature, setOwnerSignature] = useState('');

  const configureCanvas = (canvas) => {
    if (!canvas) return;

    // Fix cursor/ink mismatch on desktop by matching the canvas internal pixel size
    // to its rendered size, then scaling by devicePixelRatio.
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    const nextWidth = Math.max(1, Math.round(rect.width * dpr));
    const nextHeight = Math.max(1, Math.round(rect.height * dpr));

    // Only resize when needed (resizing clears the canvas).
    if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
      canvas.width = nextWidth;
      canvas.height = nextHeight;
    }

    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // draw using CSS pixel coordinates
    }

    // Prevent touch gestures (scroll/pinch) from interfering with signing on mobile.
    canvas.style.touchAction = 'none';
  };

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!missionOrderId) return;

    const loadMissionOrder = async () => {
      setLoading(true);
      setError('');
      try {
        const { data: userData, error: userError } = await supabase.auth.getUser();
        if (userError) throw userError;
        const userId = userData?.user?.id;
        if (!userId) throw new Error('Not authenticated. Please login again.');

        const { data: mo, error: moError } = await supabase
          .from('mission_orders')
          .select('id, title, content, status, complaint_id, created_at, updated_at, submitted_at')
          .eq('id', missionOrderId)
          .single();

        if (moError) throw moError;

        // Rule 2: A slip can only be created by opening an active mission order
        // where the inspector is listed as an assignee.
        const { data: assignRows, error: assignError } = await supabase
          .from('mission_order_assignments')
          .select('inspector_id')
          .eq('mission_order_id', missionOrderId)
          .eq('inspector_id', userId)
          .limit(1);

        if (assignError) throw assignError;
        if (!assignRows || assignRows.length === 0) {
          throw new Error('You are not assigned to this mission order.');
        }

        // Basic active status gate (keep aligned with existing workflow)
        // Allow inspections while MO is actionable (for inspection), and allow opening/viewing
        // even after Head Inspector archives it as complete.
        const s = String(mo?.status || '').toLowerCase();
        if (s !== 'for inspection' && s !== 'for_inspection' && s !== 'complete') {
          throw new Error('This mission order is not active for inspection.');
        }

        setMissionOrder(mo);

        // If the URL explicitly references a specific inspection report (e.g., from history),
        // ALWAYS load that exact report and NEVER create a new draft row.
        if (inspectionReportIdFromQuery) {
          const { data: explicitReport, error: explicitErr } = await supabase
            .from('inspection_reports')
            .select('*')
            .eq('id', inspectionReportIdFromQuery)
            .single();

          if (explicitErr) throw explicitErr;

          setInspectionReportId(explicitReport.id);

          // Hydrate fields from the explicit report
          setAdditionalComments(explicitReport.inspection_comments || '');

          if (Array.isArray(explicitReport.lines_of_business) && explicitReport.lines_of_business.length) {
            setLineOfBusinessList(explicitReport.lines_of_business);
          }

          setBusinessDetails((prev) => ({
            ...prev,
            bin: explicitReport.bin ?? prev.bin,
            address: explicitReport.business_address ?? prev.address,
            estimatedAreaSqm:
              explicitReport.estimated_area_sqm != null
                ? String(explicitReport.estimated_area_sqm)
                : prev.estimatedAreaSqm,
            numberOfEmployees:
              explicitReport.no_of_employees != null
                ? String(explicitReport.no_of_employees)
                : prev.numberOfEmployees,
            landline: explicitReport.landline_no ?? prev.landline,
            cellphone: explicitReport.mobile_no ?? prev.cellphone,
            email: explicitReport.email_address ?? prev.email,
          }));

          if (explicitReport.business_name) {
            setOwnerDetails((prev) => ({ ...prev, businessName: explicitReport.business_name ?? prev.businessName }));
          }

          // Evidence urls (persisted)
          if (Array.isArray(explicitReport.attachment_urls) && explicitReport.attachment_urls.length) {
            const mapped = [];
            for (const path of explicitReport.attachment_urls.filter(Boolean)) {
              // eslint-disable-next-line no-await-in-loop
              const { data: signed } = await supabase.storage.from('inspection').createSignedUrl(path, 60 * 60 * 24 * 7);
              mapped.push({ url: signed?.signedUrl || '', blob: null, ts: Date.now(), storagePath: path });
            }
            setEvidencePhotos(mapped.filter((x) => x.url));
          }

          if (explicitReport.inspector_signature_url) {
            const { data: signed } = await supabase.storage
              .from('inspection')
              .createSignedUrl(explicitReport.inspector_signature_url, 60 * 60 * 24 * 7);
            if (signed?.signedUrl) setInspectorSignature(signed.signedUrl);
          }
          if (explicitReport.owner_signature_url) {
            const { data: signed } = await supabase.storage
              .from('inspection')
              .createSignedUrl(explicitReport.owner_signature_url, 60 * 60 * 24 * 7);
            if (signed?.signedUrl) setOwnerSignature(signed.signedUrl);
          }

          // Checklist
          setChecklist((p) => ({
            ...p,
            business_permit: fromDbStatus(explicitReport.business_permit_status) || p.business_permit,
            with_cctv: fromDbStatus(explicitReport.cctv_status) || p.with_cctv,
            signage_2sqm: fromDbStatus(explicitReport.signage_status) || p.signage_2sqm,
          }));
          setCctvCount(explicitReport.cctv_count != null ? String(explicitReport.cctv_count) : '');

          if (explicitReport.owner_name) {
            const ownerName = String(explicitReport.owner_name || '');
            if (ownerName) {
              const [lastPart, rest] = ownerName.split(',').map((s) => s.trim());
              const restParts = (rest || '').split(' ').filter(Boolean);
              setOwnerDetails((prev) => ({
                ...prev,
                lastName: lastPart || prev.lastName,
                firstName: restParts[0] || prev.firstName,
                middleName: restParts.slice(1).join(' ') || prev.middleName,
              }));
            }
          }

          // Completed reports are view-only
          if (explicitReport.status && String(explicitReport.status).toLowerCase() === 'completed') {
            setIsCompleted(true);
            setActiveTab('summary');
          } else {
            setIsCompleted(false);
          }
          setCompletionKnown(true);

          // Do not proceed to draft creation logic
          return;
        }

        // Create or load inspection report draft for this mission order + inspector.
        // IMPORTANT: always reuse an existing non-completed draft if it exists.
        // This prevents duplicates where a new row is created on submit instead of updating the draft.
        const { data: existingReport, error: reportErr } = await supabase
          .from('inspection_reports')
          .select('*')
          .eq('mission_order_id', missionOrderId)
          .eq('inspector_id', userId)
          .neq('status', 'completed')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        // If there are multiple non-completed drafts (legacy bug), keep the latest one and
        // clean up the older ones to avoid confusion and future duplicate updates.
        const { data: allDrafts, error: allDraftsErr } = await supabase
          .from('inspection_reports')
          .select('id, created_at')
          .eq('mission_order_id', missionOrderId)
          .eq('inspector_id', userId)
          .neq('status', 'completed')
          .order('created_at', { ascending: false });

        if (allDraftsErr) throw allDraftsErr;

        const draftIds = (allDrafts || []).map((r) => r.id).filter(Boolean);
        if (draftIds.length > 1) {
          const keepId = draftIds[0];
          const deleteIds = draftIds.slice(1);
          // Best-effort cleanup; don't fail loading if delete is blocked by RLS.
          await supabase.from('inspection_reports').delete().in('id', deleteIds);
          if (existingReport?.id && existingReport.id !== keepId) {
            // Ensure we continue with the kept draft if the query returned a different one.
            // (Shouldn't happen due to ordering, but kept for safety.)
            // eslint-disable-next-line no-param-reassign
            existingReport.id = keepId;
          }
        }

        if (reportErr) throw reportErr;

        if (existingReport?.id) {
          // Safety: guarantee we are always pointing at the most recent non-completed draft.
          // This avoids creating a second row later during save/submit flows.
          if (allDrafts?.length) {
            const latestId = allDrafts[0]?.id;
            if (latestId && latestId !== existingReport.id) {
              setInspectionReportId(latestId);
            }
          }
          setInspectionReportId(existingReport.id);

          // Hydrate fields from draft
          setAdditionalComments(existingReport.inspection_comments || '');

          if (Array.isArray(existingReport.lines_of_business) && existingReport.lines_of_business.length) {
            setLineOfBusinessList(existingReport.lines_of_business);
          }

          setBusinessDetails((prev) => ({
            ...prev,
            bin: existingReport.bin ?? prev.bin,
            address: existingReport.business_address ?? prev.address,
            estimatedAreaSqm:
              existingReport.estimated_area_sqm != null ? String(existingReport.estimated_area_sqm) : prev.estimatedAreaSqm,
            numberOfEmployees:
              existingReport.no_of_employees != null ? String(existingReport.no_of_employees) : prev.numberOfEmployees,
            landline: existingReport.landline_no ?? prev.landline,
            cellphone: existingReport.mobile_no ?? prev.cellphone,
            email: existingReport.email_address ?? prev.email,
          }));

          if (existingReport.business_name) {
            setOwnerDetails((prev) => ({ ...prev, businessName: existingReport.business_name ?? prev.businessName }));
          }

          // Evidence urls (persisted)
          if (Array.isArray(existingReport.attachment_urls) && existingReport.attachment_urls.length) {
            // Convert stored paths into signed urls for preview
            const mapped = [];
            for (const path of existingReport.attachment_urls.filter(Boolean)) {
              // eslint-disable-next-line no-await-in-loop
              const { data: signed } = await supabase.storage.from('inspection').createSignedUrl(path, 60 * 60 * 24 * 7);
              mapped.push({ url: signed?.signedUrl || '', blob: null, ts: Date.now(), storagePath: path });
            }
            setEvidencePhotos(mapped.filter((x) => x.url));
          }

          if (existingReport.inspector_signature_url) {
            const { data: signed } = await supabase.storage
              .from('inspection')
              .createSignedUrl(existingReport.inspector_signature_url, 60 * 60 * 24 * 7);
            if (signed?.signedUrl) setInspectorSignature(signed.signedUrl);
          }
          if (existingReport.owner_signature_url) {
            const { data: signed } = await supabase.storage
              .from('inspection')
              .createSignedUrl(existingReport.owner_signature_url, 60 * 60 * 24 * 7);
            if (signed?.signedUrl) setOwnerSignature(signed.signedUrl);
          }

          // Checklist
          setChecklist((p) => ({
            ...p,
            business_permit: fromDbStatus(existingReport.business_permit_status) || p.business_permit,
            with_cctv: fromDbStatus(existingReport.cctv_status) || p.with_cctv,
            signage_2sqm: fromDbStatus(existingReport.signage_status) || p.signage_2sqm,
          }));
          setCctvCount(existingReport.cctv_count != null ? String(existingReport.cctv_count) : '');

          if (existingReport.owner_name) {
            const ownerName = String(existingReport.owner_name || '');
            if (ownerName) {
              // best-effort split "Last, First Middle" style
              const [lastPart, rest] = ownerName.split(',').map((s) => s.trim());
              const restParts = (rest || '').split(' ').filter(Boolean);
              setOwnerDetails((prev) => ({
                ...prev,
                lastName: lastPart || prev.lastName,
                firstName: restParts[0] || prev.firstName,
                middleName: restParts.slice(1).join(' ') || prev.middleName,
              }));
            }
          }

          if (existingReport.status && String(existingReport.status).toLowerCase() === 'completed') {
            setIsCompleted(true);
            setToast(
              'This inspection report is already completed. Editing is disabled, but you can still view details and summary.'
            );
            setActiveTab('summary');
          } else {
            setIsCompleted(false);
          }
          setCompletionKnown(true);
        } else {
          const { data: createdReport, error: createErr } = await supabase
            .from('inspection_reports')
            .insert([
              {
                mission_order_id: missionOrderId,
                inspector_id: userId,
                // When an inspector opens the slip, they are starting the inspection.
                status: 'in progress',
                started_at: new Date().toISOString(),
              },
            ])
            .select('id')
            .single();

          if (createErr) throw createErr;
          setInspectionReportId(createdReport.id);
          setIsCompleted(false);
          setCompletionKnown(true);
        }

        // Load linked complaint (if any).
        if (mo?.complaint_id) {
          const { data: c, error: complaintError } = await supabase
            .from('complaints')
            .select(
              [
                'id',
                'business_name',
                'business_address',
                'complaint_description',
                'reporter_email',
                'created_at',
                'status',
              ].join(', ')
            )
            .eq('id', mo.complaint_id)
            .single();

          if (!complaintError && c) {
            setComplaint(c);

            // Auto-detect complained business from linked complaint (if any).
            const name = (c.business_name || '').trim();
            const addr = (c.business_address || '').trim();

            if (name || addr) {
              const orClauses = [];
              if (name) orClauses.push(`business_name.ilike.%${name}%`);
              if (addr) orClauses.push(`business_address.ilike.%${addr}%`);

              if (orClauses.length > 0) {
                const { data: bizMatches, error: bizError } = await supabase
                  .from('businesses')
                  .select('*')
                  .or(orClauses.join(','))
                  .limit(5);

                if (!bizError && bizMatches && bizMatches.length > 0) {
                  setBusinessResult({ matches: bizMatches });
                  setBusinessSearch(name || addr || '');
                  // Use the first match to pre-fill fields; inspector can override.
                  // eslint-disable-next-line no-use-before-define
                  handleUseBusiness(bizMatches[0]);
                  setAutoFillMessage(
                    'Autofilled from registered business based on the complained business. Click a result card to change.'
                  );
                } else {
                  setAutoFillMessage(
                    'No registered business found for this complaint. Please fill in the details manually or search by BIN / business name.'
                  );
                }
              }
            } else {
              setAutoFillMessage(
                'No registered business found for this complaint. Please fill in the details manually or search by BIN / business name.'
              );
            }
          }
        } else {
          setComplaint(null);
          setAutoFillMessage('');
        }
      } catch (e) {
        setMissionOrder(null);
        setComplaint(null);
        setInspectionReportId(null);
        setError(e?.message || 'Failed to load mission order.');
      } finally {
        setLoading(false);
      }
    };

    loadMissionOrder();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missionOrderId]);

  const getCanvasContextAndState = (who) => {
    const canvasRef = who === 'inspector' ? inspectorCanvasRef : ownerCanvasRef;
    const drawingRef = who === 'inspector' ? inspectorDrawing : ownerDrawing;
    const lastPosRef = who === 'inspector' ? inspectorLastPos : ownerLastPos;
    const canvas = canvasRef.current;
    if (!canvas) return {};
    const ctx = canvas.getContext('2d');
    return { canvas, ctx, drawingRef, lastPosRef };
  };

  const getEventPos = (event, canvas) => {
    const rect = canvas.getBoundingClientRect();

    // Normalize coordinates across mouse/touch/pointer events.
    const point =
      event?.touches && event.touches.length
        ? event.touches[0]
        : event?.changedTouches && event.changedTouches.length
          ? event.changedTouches[0]
          : event;

    return {
      x: (point?.clientX ?? 0) - rect.left,
      y: (point?.clientY ?? 0) - rect.top,
    };
  };

  const handleSignatureStart = (who, event) => {
    if (isCompleted) return;

    event.preventDefault();

    const { canvas, ctx, drawingRef, lastPosRef } = getCanvasContextAndState(who);
    if (!canvas || !ctx) return;

    configureCanvas(canvas);

    const pointerIdRef = who === 'inspector' ? inspectorPointerIdRef : ownerPointerIdRef;

    if (event?.pointerId != null) {
      pointerIdRef.current = event.pointerId;
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch {
        // Ignore capture errors (older browsers).
      }
    }

    const pos = getEventPos(event, canvas);
    drawingRef.current = true;
    lastPosRef.current = pos;
  };

  const handleSignatureMove = (who, event) => {
    if (isCompleted) return;

    const { canvas, ctx, drawingRef, lastPosRef } = getCanvasContextAndState(who);
    if (!canvas || !ctx || !drawingRef.current) return;

    const pointerIdRef = who === 'inspector' ? inspectorPointerIdRef : ownerPointerIdRef;
    if (event?.pointerId != null && pointerIdRef.current != null && event.pointerId !== pointerIdRef.current) {
      return;
    }

    event.preventDefault();

    const pos = getEventPos(event, canvas);
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(lastPosRef.current.x, lastPosRef.current.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    lastPosRef.current = pos;
  };

  const handleSignatureEnd = (who, event) => {
    if (isCompleted) return;

    const { canvas, drawingRef } = getCanvasContextAndState(who);
    if (!canvas) return;

    const pointerIdRef = who === 'inspector' ? inspectorPointerIdRef : ownerPointerIdRef;
    if (event?.pointerId != null && pointerIdRef.current != null && event.pointerId !== pointerIdRef.current) {
      return;
    }

    drawingRef.current = false;
    pointerIdRef.current = null;

    const dataUrl = canvas.toDataURL('image/png');
    if (who === 'inspector') {
      setInspectorSignature(dataUrl);
    } else {
      setOwnerSignature(dataUrl);
    }
  };

  const handleSignatureClear = (who) => {
    if (isCompleted) return;

    const { canvas, ctx } = getCanvasContextAndState(who);
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (who === 'inspector') {
      setInspectorSignature('');
    } else {
      setOwnerSignature('');
    }
  };

  const paintSignatureToCanvas = async (who, src) => {
    const { canvas, ctx } = getCanvasContextAndState(who);
    if (!canvas || !ctx || !src) return;

    try {
      configureCanvas(canvas);

      const img = new Image();
      // Signed URLs can be cross-origin; setting crossOrigin improves compatibility
      // (works when CORS headers allow it).
      img.crossOrigin = 'anonymous';

      await new Promise((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Failed to load signature image.'));
        img.src = src;
      });

      // Clear + draw scaled to fit
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const w = rect.width * dpr;
      const h = rect.height * dpr;

      const scale = Math.min(w / img.width, h / img.height);
      const drawW = img.width * scale;
      const drawH = img.height * scale;
      const x = (w - drawW) / 2;
      const y = (h - drawH) / 2;

      ctx.drawImage(img, x, y, drawW, drawH);
    } catch {
      // If painting fails, at least keep the stored URL state; canvas will remain blank.
    }
  };

  const handleUseBusiness = async (b) => {
    if (!b) return;

    // Always fill business name
    setOwnerDetails((prev) => ({
      ...prev,
      businessName: b.business_name || prev.businessName,
    }));

    // Only autofill owner personal name fields + additional business info for Sole Proprietor
    const isSole = ownerType === 'sole';

    if (isSole) {
      const lastName = b.owner_last_name || b.last_name || b.lastname || '';
      const firstName = b.owner_first_name || b.first_name || b.firstname || '';
      const middleName = b.owner_middle_name || b.middle_name || b.middlename || '';

      setOwnerDetails((prev) => ({
        ...prev,
        lastName: lastName || prev.lastName,
        firstName: firstName || prev.firstName,
        middleName: middleName || prev.middleName,
      }));
    }

    const bin = b.epermit_no || b.permit_number || '';

    setBusinessDetails((prev) => ({
      ...prev,
      bin: bin || prev.bin,
      address:
        b.address ||
        b.business_address ||
        b.full_address ||
        b.business_address1 ||
        prev.address,
    }));

    // Pull multi-line LOB + total_employees from businesses_additional based on BIN.
    if (isSole) {
      try {
        const businessBin = String(b?.bin || '').trim();
        if (!businessBin) return;

        const { data: addRows, error: addErr } = await supabase
          .from('businesses_additional')
          .select('line_of_business, total_employees')
          .eq('bin', businessBin);

        if (addErr) throw addErr;
        if (!addRows || addRows.length === 0) return;

        const lobs = addRows
          .flatMap((r) => {
            const v = r?.line_of_business ?? '';
            if (typeof v === 'string') {
              return v
                .split(/\r?\n|\s*;\s*|\s*,\s*/g)
                .map((s) => s.trim())
                .filter(Boolean);
            }
            return [];
          })
          .filter((val, idx, arr) => arr.indexOf(val) === idx);

        if (lobs.length > 0) {
          setLineOfBusinessList(lobs);
        }

        const maxEmployees = addRows
          .map((r) => Number(r?.total_employees || 0))
          .filter((n) => Number.isFinite(n) && n > 0)
          .reduce((m, n) => (n > m ? n : m), 0);

        if (maxEmployees > 0) {
          setBusinessDetails((prev) => ({
            ...prev,
            numberOfEmployees: String(maxEmployees),
          }));
        }
      } catch {
        // Silent fail
      }
    }
  };

  const formatStatus = (status) => {
    if (!status) return 'Unknown';
    const s = String(status || '').toLowerCase();
    if (s === 'completed' || s === 'for_inspection' || s === 'for inspection') return 'For Inspection';
    return String(status)
      .replace(/_/g, ' ')
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  };

  const statusBadgeStyle = (status) => {
    const s = String(status || '').toLowerCase();
    let bg = '#e2e8f0';
    let fg = '#0f172a';
    if (['completed', 'approved'].includes(s)) {
      bg = '#dcfce7';
      fg = '#166534';
    } else if (['cancelled', 'declined', 'rejected', 'invalid'].includes(s)) {
      bg = '#fee2e2';
      fg = '#991b1b';
    } else if (['issued', 'submitted', 'pending', 'new'].includes(s)) {
      bg = '#fef9c3';
      fg = '#854d0e';
    } else if (['on hold', 'on_hold', 'hold'].includes(s)) {
      bg = '#dbeafe';
      fg = '#1e40af';
    }

    return {
      display: 'inline-flex',
      alignItems: 'center',
      padding: '3px 10px',
      borderRadius: 999,
      background: bg,
      color: fg,
      fontWeight: 900,
      fontSize: 12,
      border: '1px solid rgba(15, 23, 42, 0.08)',
    };
  };

  const mapUrl = useMemo(() => {
    const address = complaint?.business_address || '';
    if (!address) return null;
    return `https://www.google.com/maps?q=${encodeURIComponent(address)}&output=embed`;
  }, [complaint?.business_address]);

  const INSPECTION_BUCKET = 'inspection';

  const requestInspectorLocation = () => {
    if (!('geolocation' in navigator)) {
      setLocationError('Geolocation is not supported by this browser/device.');
      return Promise.resolve(null);
    }

    setLocationError('');
    setLocationBusy(true);

    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;
          const accuracy = pos.coords.accuracy;
          const capturedAt = new Date().toISOString();

          setInspectorLocation({ lat, lng, accuracy, capturedAt });
          setLocationBusy(false);
          resolve({ lat, lng, accuracy, capturedAt });
        },
        (err) => {
          const message =
            err.code === err.PERMISSION_DENIED
              ? 'Location permission was denied. Please enable it in your browser settings.'
              : err.code === err.POSITION_UNAVAILABLE
                ? 'Location is unavailable. Please try again.'
                : 'Location request timed out. Please try again.';

          setLocationError(message);
          setLocationBusy(false);
          resolve(null);
        },
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
      );
    });
  };

  const inspectorLeafletIcon = useMemo(
    () =>
      L.icon({
        iconUrl:
          'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png',
        shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
        iconSize: [25, 41],
        iconAnchor: [12, 41],
        popupAnchor: [1, -34],
        shadowSize: [41, 41],
      }),
    []
  );

  const uploadToInspectionBucket = async ({ path, file, contentType }) => {
    const { error: upErr } = await supabase.storage
      .from(INSPECTION_BUCKET)
      .upload(path, file, {
        contentType,
        upsert: true,
      });
    if (upErr) throw upErr;

    // Private bucket: store the storage path, and generate a signed URL for immediate preview.
    const { data: signed, error: signedErr } = await supabase.storage
      .from(INSPECTION_BUCKET)
      .createSignedUrl(path, 60 * 60 * 24 * 7); // 7 days
    if (signedErr) throw signedErr;

    return { path, signedUrl: signed?.signedUrl || '' };
  };

  const dataUrlToBlob = async (dataUrl) => {
    const res = await fetch(dataUrl);
    return await res.blob();
  };

  const toOwnerNameString = () => {
    const ln = (ownerDetails.lastName || '').trim();
    const fn = (ownerDetails.firstName || '').trim();
    const mn = (ownerDetails.middleName || '').trim();
    const rest = [fn, mn].filter(Boolean).join(' ');
    return `${ln}${ln && rest ? ', ' : ''}${rest}`.trim();
  };

  const toDbStatus = (v) => {
    // DB defaults show "N/A"; map our values to match
    if (v === 'compliant') return 'Compliant';
    if (v === 'non_compliant') return 'Non-Compliant';
    return 'N/A';
  };

  const fromDbStatus = (v) => {
    const s = String(v || '').toLowerCase();
    if (s.includes('non')) return 'non_compliant';
    if (s.includes('compliant')) return 'compliant';
    return 'na';
  };

  // When loading an existing report (completed view), we store signed URLs in state.
  // We also need to paint them onto the canvases because the UI uses <canvas>.
  useEffect(() => {
    if (!completionKnown) return;
    if (inspectorSignature && !inspectorSignature.startsWith('data:image')) {
      paintSignatureToCanvas('inspector', inspectorSignature);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completionKnown, inspectorSignature]);

  useEffect(() => {
    if (!completionKnown) return;
    if (ownerSignature && !ownerSignature.startsWith('data:image')) {
      paintSignatureToCanvas('owner', ownerSignature);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completionKnown, ownerSignature]);

  const handleSaveReport = async () => {
    if (isCompleted) {
      setError('This inspection report is already completed and can no longer be edited.');
      return;
    }
    if (!inspectionReportId) {
      setError('Inspection report is not initialized yet. Please wait and try again.');
      return;
    }

    setSaving(true);
    setError('');

    try {
      // Upload any new evidence blobs (captured locally)
      const nextEvidence = [];
      for (const p of evidencePhotos) {
        if (p?.blob && p?.url && p.url.startsWith('blob:')) {
          const file = new File([p.blob], `evidence-${p.ts || Date.now()}.jpg`, { type: 'image/jpeg' });
          const storagePath = `inspection-reports/${inspectionReportId}/evidence/${file.name}`;
          const { path, signedUrl } = await uploadToInspectionBucket({
            path: storagePath,
            file,
            contentType: file.type,
          });
          nextEvidence.push({ url: signedUrl, blob: null, ts: p.ts || Date.now(), storagePath: path });
        } else {
          nextEvidence.push(p);
        }
      }
      setEvidencePhotos(nextEvidence);

      // Upload signatures if they are still data URLs
      let inspectorSigPath = null;
      let ownerSigPath = null;

      if (inspectorSignature && inspectorSignature.startsWith('data:image')) {
        const blob = await dataUrlToBlob(inspectorSignature);
        const file = new File([blob], `inspector-signature.png`, { type: blob.type || 'image/png' });
        const storagePath = `inspection-reports/${inspectionReportId}/signatures/${file.name}`;
        const { path, signedUrl } = await uploadToInspectionBucket({ path: storagePath, file, contentType: file.type });
        inspectorSigPath = path;
        setInspectorSignature(signedUrl);
      }

      if (ownerSignature && ownerSignature.startsWith('data:image')) {
        const blob = await dataUrlToBlob(ownerSignature);
        const file = new File([blob], `owner-signature.png`, { type: blob.type || 'image/png' });
        const storagePath = `inspection-reports/${inspectionReportId}/signatures/${file.name}`;
        const { path, signedUrl } = await uploadToInspectionBucket({ path: storagePath, file, contentType: file.type });
        ownerSigPath = path;
        setOwnerSignature(signedUrl);
      }

      const attachmentUrlsForDb = nextEvidence
        .map((x) => x?.storagePath)
        .filter(Boolean);

      const payload = {
        bin: businessDetails.bin || null,
        business_name: ownerDetails.businessName || null,
        owner_name: toOwnerNameString() || null,
        business_address: businessDetails.address || null,

        // Inspector device location
        inspector_lat: inspectorLocation.lat,
        inspector_lng: inspectorLocation.lng,
        inspector_location_accuracy_m: inspectorLocation.accuracy,
        inspector_location_captured_at: inspectorLocation.capturedAt,

        business_permit_status: toDbStatus(checklist.business_permit),
        cctv_status: toDbStatus(checklist.with_cctv),
        signage_status: toDbStatus(checklist.signage_2sqm),
        cctv_count: cctvCount ? Number(cctvCount) : 0,

        inspection_comments: additionalComments || null,
        lines_of_business: lineOfBusinessList.filter(Boolean),
        no_of_employees: businessDetails.numberOfEmployees ? Number(businessDetails.numberOfEmployees) : null,
        estimated_area_sqm: businessDetails.estimatedAreaSqm ? Number(businessDetails.estimatedAreaSqm) : null,
        mobile_no: businessDetails.cellphone || null,
        landline_no: businessDetails.landline || null,
        email_address: businessDetails.email || null,
        attachment_urls: attachmentUrlsForDb.length ? attachmentUrlsForDb : null,

        // Save signature storage paths into their dedicated columns
        inspector_signature_url: inspectorSigPath,
        owner_signature_url: ownerSigPath,
      };

      const { error: upErr } = await supabase
        .from('inspection_reports')
        .update(payload)
        .eq('id', inspectionReportId);

      if (upErr) throw upErr;

      setToast('Inspection report saved.');
    } catch (e) {
      setError(e?.message || 'Failed to save inspection report.');
    } finally {
      setSaving(false);
    }
  };

  const handleSubmitReport = async () => {
    if (isCompleted) {
      setError('This inspection report is already completed and can no longer be submitted.');
      return;
    }
    if (!inspectionReportId) {
      setError('Inspection report is not initialized yet. Please wait and try again.');
      return;
    }

    // Basic required-field validation (client-side stopper)
    const missing = [];

    // Business / owner details
    if (!String(ownerDetails.businessName || '').trim()) missing.push('Business Name');
    if (!String(businessDetails.bin || '').trim()) missing.push('BIN #');
    if (!String(businessDetails.address || '').trim()) missing.push('Business Address');

    // Owner name is required for Sole Proprietor
    if (ownerType === 'sole') {
      if (!String(ownerDetails.lastName || '').trim()) missing.push('Owner Last Name');
      if (!String(ownerDetails.firstName || '').trim()) missing.push('Owner First Name');
    }

    // At least one line of business
    if (!lineOfBusinessList.some((x) => String(x || '').trim())) missing.push('Line of Business');

    // Estimated area (sqm) required and must be > 0
    {
      const n = Number(String(businessDetails.estimatedAreaSqm || '').trim());
      if (!Number.isFinite(n) || n <= 0) missing.push('Estimated Area (SQM)');
    }

    // Inspector device location required
    if (inspectorLocation.lat == null || inspectorLocation.lng == null) missing.push('Inspector Device Location');

    // Photo evidence required (at least 1)
    if (!Array.isArray(evidencePhotos) || evidencePhotos.length === 0) missing.push('Photo Evidence');

    // Checklist items must be answered (not N/A)
    if (checklist.business_permit === 'na') missing.push('Business Permit (Presented) status');
    if (checklist.with_cctv === 'na') missing.push('With CCTV status');
    if (checklist.signage_2sqm === 'na') missing.push('2sqm Signage status');

    // CCTV count required when compliant
    if (checklist.with_cctv === 'compliant') {
      const n = Number(String(cctvCount || '').trim());
      if (!Number.isFinite(n) || n <= 0) missing.push('No. of CCTVs');
    }

    // Signatures required
    if (!inspectorSignature) missing.push('Inspector Signature');
    if (!ownerSignature) missing.push('Business Owner Signature');

    if (missing.length) {
      setError(`Cannot submit. Please complete the required fields: ${missing.join(', ')}`);
      setActiveTab('inspection');
      return;
    }

    setSaving(true);
    setError('');

    try {
      // Save first to ensure uploads happen
      await handleSaveReport();

      const { error: subErr } = await supabase
        .from('inspection_reports')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
        })
        .eq('id', inspectionReportId);

      if (subErr) throw subErr;

      setToast('Inspection report marked as Completed.');
      setIsCompleted(true);
      setCompletionKnown(true);
      setActiveTab('summary');
    } catch (e) {
      setError(e?.message || 'Failed to submit inspection report.');
    } finally {
      setSaving(false);
    }
  };

  const handleCheckBusiness = async () => {
    if (!businessSearch.trim()) {
      setError('Enter business permit number / business name to validate.');
      return;
    }

    setError('');
    setBusinessResult(null);
    setCheckingBusiness(true);

    try {
      const q = businessSearch.trim();
      const { data, error: qError } = await supabase
        .from('businesses')
        .select('*')
        .or(`epermit_no.ilike.%${q}%,business_name.ilike.%${q}%`)
        .limit(5);

      if (qError) throw qError;

      setBusinessResult({ matches: data || [] });
      if (!data || data.length === 0) setToast('No matching business permit found.');
    } catch (e) {
      setError(e?.message || 'Failed to validate business permit.');
    } finally {
      setCheckingBusiness(false);
    }
  };

  return (
    <div className="mo-container is-root">
      {activePhotoUrl ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Photo preview"
          onClick={() => setActivePhotoUrl('')}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setActivePhotoUrl('');
          }}
          tabIndex={-1}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(2,6,23,0.72)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 18,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 'min(980px, 100%)',
              maxHeight: 'calc(100vh - 36px)',
              background: '#0b1220',
              borderRadius: 14,
              border: '1px solid rgba(226,232,240,0.25)',
              overflow: 'hidden',
              boxShadow: '0 20px 55px rgba(0,0,0,0.45)',
              position: 'relative',
            }}
          >
            <button
              type="button"
              onClick={() => setActivePhotoUrl('')}
              aria-label="Close preview"
              title="Close"
              style={{
                position: 'absolute',
                top: 10,
                right: 10,
                width: 40,
                height: 40,
                borderRadius: 999,
                border: '1px solid rgba(255,255,255,0.35)',
                background: 'rgba(15,23,42,0.55)',
                color: '#fff',
                fontWeight: 900,
                fontSize: 18,
                lineHeight: '38px',
                textAlign: 'center',
                cursor: 'pointer',
              }}
            >
              ×
            </button>

            <div style={{ padding: 12 }}>
              <img
                src={activePhotoUrl}
                alt="Evidence preview"
                style={{
                  width: '100%',
                  height: 'auto',
                  maxHeight: 'calc(100vh - 120px)',
                  objectFit: 'contain',
                  borderRadius: 10,
                  display: 'block',
                  background: '#0b1220',
                }}
              />
            </div>
          </div>
        </div>
      ) : null}

      <Header />
      <main className="mo-main">
        <section className="mo-card">
          <div className="mo-header">
            <div className="mo-title-wrap">
              <div className="mo-label">Inspection Slip</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ fontWeight: 900, fontSize: 16, color: '#0f172a' }}>Create (Draft)</div>
                <div style={{ color: '#64748b', fontWeight: 800, fontSize: 12 }}>
                  Mission Order: {missionOrder?.title || (missionOrderId ? missionOrderId : '—')}
                </div>
              </div>
            </div>

            <div className="mo-actions">
              <a className="mo-link" href="/dashboard/inspector">
                Back
              </a>
              <button
                type="button"
                className="mo-btn mo-btn-secondary"
                onClick={() => window.print()}
                style={{ marginLeft: 8 }}
              >
                Print
              </button>
              {completionKnown && !isCompleted ? (
                <>
                  <button
                    type="button"
                    className="mo-btn mo-btn-secondary"
                    onClick={handleSaveReport}
                    disabled={saving || loading || !inspectionReportId}
                    style={{ marginLeft: 8 }}
                    title="Save draft"
                  >
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    type="button"
                    className="mo-btn mo-btn-primary"
                    onClick={handleSubmitReport}
                    disabled={saving || loading || !inspectionReportId}
                    style={{ marginLeft: 8 }}
                    title="Submit as Completed"
                  >
                    {saving ? 'Submitting…' : 'Submit'}
                  </button>
                </>
              ) : null}
            </div>
          </div>

          {toast ? <div className="mo-alert mo-alert-success">{toast}</div> : null}
          {error ? <div className="mo-alert mo-alert-error">{error}</div> : null}

          {!missionOrderId ? (
            <div className="mo-meta">Open this page as /inspection-slip/create?missionOrderId=&lt;uuid&gt;</div>
          ) : loading ? (
            <div className="mo-meta">Loading…</div>
          ) : !missionOrder ? (
            <div className="mo-meta">Cannot create inspection slip.</div>
          ) : (
            <div style={{ display: 'grid', gap: 14, marginTop: 14 }}>
              <div
                style={{
                  display: 'flex',
                  gap: 8,
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <div className="is-seg" role="tablist" aria-label="Inspection slip tabs">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeTab === 'inspection_details'}
                    className={activeTab === 'inspection_details' ? 'active' : ''}
                    onClick={() => setActiveTab('inspection_details')}
                  >
                    Inspection Details
                  </button>
                  {!isCompleted ? (
                    <button
                      type="button"
                      role="tab"
                      aria-selected={activeTab === 'inspection'}
                      className={activeTab === 'inspection' ? 'active' : ''}
                      onClick={() => setActiveTab('inspection')}
                    >
                      Inspection
                    </button>
                  ) : null}
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeTab === 'summary'}
                    className={activeTab === 'summary' ? 'active' : ''}
                    onClick={() => setActiveTab('summary')}
                  >
                    Summary
                  </button>
                </div>

                <div style={{ color: '#64748b', fontWeight: 700, fontSize: 12 }}>
                  You can switch tabs anytime—your inputs are preserved.
                </div>
              </div>

              {autoFillMessage ? (
                <div
                  className={
                    autoFillMessage.toLowerCase().includes('no registered business found')
                      ? 'is-alert'
                      : 'mo-meta'
                  }
                  style={{ marginBottom: 4 }}
                >
                  {autoFillMessage}
                </div>
              ) : null}

              {activeTab === 'inspection_details' ? (
                <>
                  <div className="is-card">
                    <div className="is-section-head">
                      <div>
                        <p className="is-section-title">Inspection Details</p>
                        <p className="is-section-sub">Mission order + complaint details for your assigned inspection.</p>
                      </div>
                    </div>

                    <div className="is-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
                      <div className="is-field">
                        <label>Mission Order ID</label>
                        <div style={{ fontWeight: 900, color: '#0f172a' }}>
                          {missionOrderId ? `${String(missionOrderId).slice(0, 8)}…` : '—'}
                        </div>
                      </div>

                      <div className="is-field">
                        <label>Status</label>
                        <div style={statusBadgeStyle(missionOrder?.status)}>{formatStatus(missionOrder?.status)}</div>
                      </div>

                      <div className="is-field" style={{ gridColumn: '1 / -1' }}>
                        <label>Title</label>
                        <div style={{ fontWeight: 900, color: '#0f172a' }}>{missionOrder?.title || '—'}</div>
                      </div>

                      <div className="is-field">
                        <label>Submitted</label>
                        <div style={{ fontWeight: 800, color: '#0f172a' }}>
                          {missionOrder?.submitted_at ? new Date(missionOrder.submitted_at).toLocaleString() : '—'}
                        </div>
                      </div>

                      <div className="is-field">
                        <label>Updated</label>
                        <div style={{ fontWeight: 800, color: '#0f172a' }}>
                          {missionOrder?.updated_at ? new Date(missionOrder.updated_at).toLocaleString() : '—'}
                        </div>
                      </div>
                    </div>

                    <div className="mo-meta" style={{ marginTop: 12 }}>
                      Mission order preview is read-only for inspectors.
                    </div>

                    <div
                      className="mo-editor-wrap"
                      aria-label="Mission Order Preview"
                      style={{ marginTop: 12, background: '#fff' }}
                    >
                      <div
                        className="mo-editor-preview"
                        dangerouslySetInnerHTML={{
                          __html: missionOrder?.content || '<p style="color:#64748b;">No content.</p>',
                        }}
                      />
                    </div>
                  </div>

                  <div className="is-card">
                    <div className="is-section-head">
                      <div>
                        <p className="is-section-title">Business / Complaint Details</p>
                        <p className="is-section-sub">Details pulled from the linked complaint (if any).</p>
                      </div>
                    </div>

                    <div className="is-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
                      <div className="is-field" style={{ gridColumn: '1 / -1' }}>
                        <label>Business Name</label>
                        <div style={{ fontWeight: 900, color: '#0f172a' }}>{complaint?.business_name || '—'}</div>
                      </div>

                      <div className="is-field" style={{ gridColumn: '1 / -1' }}>
                        <label>Address</label>
                        <div style={{ fontWeight: 800, color: '#0f172a' }}>{complaint?.business_address || '—'}</div>
                      </div>

                      <div className="is-field">
                        <label>Reporter Email</label>
                        <div style={{ fontWeight: 800, color: '#0f172a' }}>{complaint?.reporter_email || '—'}</div>
                      </div>

                      <div className="is-field">
                        <label>Complaint Status</label>
                        <div style={statusBadgeStyle(complaint?.status)}>{formatStatus(complaint?.status)}</div>
                      </div>

                      <div className="is-field">
                        <label>Submitted</label>
                        <div style={{ fontWeight: 800, color: '#0f172a' }}>
                          {complaint?.created_at ? new Date(complaint.created_at).toLocaleString() : '—'}
                        </div>
                      </div>

                      <div className="is-field">
                        <label>Complaint ID</label>
                        <div style={{ fontWeight: 800, color: '#0f172a' }}>
                          {complaint?.id ? `${String(complaint.id).slice(0, 8)}…` : '—'}
                        </div>
                      </div>
                    </div>

                    <div className="is-field" style={{ marginTop: 12 }}>
                      <label>Complaint Description</label>
                      <div
                        style={{
                          border: '1px solid #e2e8f0',
                          borderRadius: 10,
                          padding: 12,
                          background: '#f8fafc',
                          whiteSpace: 'pre-wrap',
                          color: '#0f172a',
                          fontWeight: 700,
                        }}
                      >
                        {complaint?.complaint_description || '—'}
                      </div>
                    </div>
                  </div>

                  <div className="is-card">
                    <div className="is-section-head">
                      <div>
                        <p className="is-section-title">Map Preview</p>
                        <p className="is-section-sub">Uses the complaint business address.</p>
                      </div>
                    </div>

                    {!mapUrl ? (
                      <div className="mo-meta">No address available for map preview.</div>
                    ) : (
                      <div
                        style={{
                          borderRadius: 12,
                          overflow: 'hidden',
                          border: '1px solid #e2e8f0',
                          background: '#fff',
                        }}
                      >
                        <iframe
                          title="Business Location"
                          src={mapUrl}
                          width="100%"
                          height="320"
                          style={{ border: 0 }}
                          loading="lazy"
                          referrerPolicy="no-referrer-when-downgrade"
                        />
                      </div>
                    )}
                  </div>
                </>
              ) : activeTab === 'inspection' && !isCompleted ? (
                <>
                  <div className="is-card">
                    <div className="is-section-head">
                      <div>
                        <p className="is-section-title">Step 1: Inspector Device Location</p>
                        <p className="is-section-sub">
                          Capture your current location to verify you are on-site during the inspection.
                        </p>
                      </div>
                    </div>

                    <div className="is-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
                      <div className="is-field" style={{ gridColumn: '1 / -1' }}>
                        <label>Device Location</label>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                          <button
                            type="button"
                            className="mo-btn mo-btn-primary is-btn-primary"
                            onClick={requestInspectorLocation}
                            disabled={locationBusy || isCompleted}
                            title="Capture current device location"
                          >
                            {locationBusy ? 'Capturing…' : 'Capture Location'}
                          </button>

                          {inspectorLocation.lat != null && inspectorLocation.lng != null ? (
                            <span className="small-pill">✓ Location captured</span>
                          ) : (
                            <span className="small-pill">Not set</span>
                          )}
                        </div>

                        {locationError ? (
                          <div className="mo-alert mo-alert-error" style={{ marginTop: 10 }}>
                            {locationError}
                          </div>
                        ) : null}

                        <div className="mo-meta" style={{ marginTop: 10 }}>
                          {inspectorLocation.lat != null && inspectorLocation.lng != null ? (
                            <>
                              Accuracy: {inspectorLocation.accuracy != null ? `±${Math.round(inspectorLocation.accuracy)}m` : '—'}
                              {inspectorLocation.capturedAt ? ` | Captured: ${new Date(inspectorLocation.capturedAt).toLocaleString()}` : ''}
                            </>
                          ) : (
                            <>Capture your location and verify it on the map. This will be saved with the inspection slip.</>
                          )}
                        </div>

                        {inspectorLocation.lat != null && inspectorLocation.lng != null ? (
                          <div
                            className="map-box"
                            style={{
                              height: 320,
                              width: '100%',
                              border: '1px solid #e2e8f0',
                              borderRadius: 12,
                              overflow: 'hidden',
                              background: '#fff',
                              marginTop: 10,
                            }}
                          >
                            <MapContainer
                              center={[inspectorLocation.lat, inspectorLocation.lng]}
                              zoom={18}
                              style={{ height: '100%', width: '100%' }}
                              scrollWheelZoom={false}
                            >
                              <TileLayer
                                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                              />
                              <Marker
                                position={[inspectorLocation.lat, inspectorLocation.lng]}
                                title="Inspector Location"
                                icon={inspectorLeafletIcon}
                              />
                            </MapContainer>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  <div className="is-card">
                    <div className="is-section-head">
                      <div>
                        <p className="is-section-title">Step 2: Validate Business Permit</p>
                        <p className="is-section-sub">Select owner type, then search a registered business to autofill.</p>
                      </div>
                    </div>

                    <div className="is-check-row" style={{ marginBottom: 12 }}>
                      <div className="is-check-title">Owner Type</div>
                      <div className="is-seg" role="group" aria-label="Owner type">
                        <button
                          type="button"
                          className={ownerType === 'sole' ? 'active' : ''}
                          onClick={() => setOwnerType('sole')}
                          aria-pressed={ownerType === 'sole'}
                          title="Sole Proprietor will autofill owner name fields when available"
                        >
                          Sole Proprietor
                        </button>
                        <button
                          type="button"
                          className={ownerType === 'corp' ? 'active' : ''}
                          onClick={() => setOwnerType('corp')}
                          aria-pressed={ownerType === 'corp'}
                          title="Corporation will not autofill owner name fields"
                        >
                          Corporation
                        </button>
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <input
                        className="is-input"
                        value={businessSearch}
                        onChange={(e) => setBusinessSearch(e.target.value)}
                        placeholder="Enter permit number or business name"
                        disabled={checkingBusiness}
                        style={{ flex: '1 1 260px' }}
                      />
                      <button
                        type="button"
                        className="mo-btn mo-btn-primary is-btn-primary"
                        onClick={handleCheckBusiness}
                        disabled={checkingBusiness}
                      >
                        {checkingBusiness ? 'Checking…' : 'Check'}
                      </button>
                    </div>

                    {businessResult ? (
                      <div style={{ marginTop: 12 }}>
                        <div style={{ color: '#0f172a', fontWeight: 900, marginBottom: 8 }}>
                          Matches ({businessResult.matches.length})
                        </div>
                        {businessResult.matches.length === 0 ? (
                          <div className="mo-meta">No matches.</div>
                        ) : (
                          <div style={{ display: 'grid', gap: 10 }}>
                            {businessResult.matches.map((b) => (
                              <div
                                key={b.id || `${b.business_name}-${b.permit_number}`}
                                className="is-match-card"
                                onClick={() => handleUseBusiness(b)}
                              >
                                <div style={{ fontWeight: 800, color: '#0f172a' }}>{b.business_name || '—'}</div>
                                <div style={{ color: '#475569', fontWeight: 600, fontSize: 12 }}>
                                  Permit: {b.epermit_no || '—'}
                                </div>
                                {b.address || b.business_address || b.full_address ? (
                                  <div style={{ color: '#475569', fontWeight: 600, fontSize: 12 }}>
                                    Address: {b.address || b.business_address || b.full_address}
                                  </div>
                                ) : null}
                                {b.permit_status ? (
                                  <div style={{ color: '#475569', fontWeight: 600, fontSize: 12 }}>
                                    Status: {b.permit_status}
                                  </div>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : null}
                  </div>

                  <div className="is-card">
                    <div className="is-section-head">
                      <div>
                        <p className="is-section-title">Step 2: Line of Business</p>
                        <p className="is-section-sub">
                          Can be multiple lines. Autofilled for Sole Proprietor when available; editable anytime.
                        </p>
                      </div>
                      <div>
                        <button
                          type="button"
                          className="mo-btn mo-btn-secondary"
                          onClick={() => setLineOfBusinessList((p) => [...p, ''])}
                          title="Add another line of business"
                        >
                          + Add Line
                        </button>
                      </div>
                    </div>

                    <div style={{ display: 'grid', gap: 10 }}>
                      {lineOfBusinessList.map((lob, idx) => (
                        <div key={idx} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <input
                            className="is-input"
                            value={lob}
                            onChange={(e) =>
                              setLineOfBusinessList((prev) => {
                                const next = [...prev];
                                next[idx] = e.target.value;
                                return next;
                              })
                            }
                            placeholder={`Line of business #${idx + 1}`}
                            style={{ flex: '1 1 auto' }}
                          />
                          {lineOfBusinessList.length > 1 ? (
                            <button
                              type="button"
                              className="mo-btn mo-btn-secondary"
                              onClick={() => setLineOfBusinessList((prev) => prev.filter((_, i) => i !== idx))}
                              title="Remove this line"
                            >
                              Remove
                            </button>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="is-card">
                    <div className="is-section-head">
                      <div>
                        <p className="is-section-title">Step 3: Business Owner Details</p>
                        <p className="is-section-sub">Owner identity and business name.</p>
                      </div>
                    </div>

                    <div
                      className="is-grid"
                      style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}
                    >
                      <div className="is-field">
                        <label>Last Name</label>
                        <input
                          className="is-input"
                          value={ownerDetails.lastName}
                          onChange={(e) => setOwnerDetails((prev) => ({ ...prev, lastName: e.target.value }))}
                          placeholder="Enter last name"
                        />
                      </div>

                      <div className="is-field">
                        <label>First Name</label>
                        <input
                          className="is-input"
                          value={ownerDetails.firstName}
                          onChange={(e) => setOwnerDetails((prev) => ({ ...prev, firstName: e.target.value }))}
                          placeholder="Enter first name"
                        />
                      </div>

                      <div className="is-field">
                        <label>Middle Name</label>
                        <input
                          className="is-input"
                          value={ownerDetails.middleName}
                          onChange={(e) => setOwnerDetails((prev) => ({ ...prev, middleName: e.target.value }))}
                          placeholder="Enter middle name"
                        />
                      </div>

                      <div className="is-field" style={{ gridColumn: '1 / -1' }}>
                        <label>Business Name</label>
                        <input
                          className="is-input"
                          value={ownerDetails.businessName}
                          onChange={(e) =>
                            setOwnerDetails((prev) => ({ ...prev, businessName: e.target.value }))
                          }
                          placeholder="Enter business name"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="is-card">
                    <div className="is-section-head">
                      <div>
                        <p className="is-section-title">Step 4: Business Details</p>
                        <p className="is-section-sub">Key information needed for validation and inspection.</p>
                      </div>
                    </div>

                    <div
                      className="is-grid"
                      style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}
                    >
                      <div className="is-field">
                        <label>BIN #</label>
                        <input
                          className="is-input"
                          value={businessDetails.bin}
                          onChange={(e) => setBusinessDetails((prev) => ({ ...prev, bin: e.target.value }))}
                          placeholder="Enter BIN #"
                        />
                      </div>

                      <div className="is-field" style={{ gridColumn: '1 / -1' }}>
                        <label>Address</label>
                        <input
                          className="is-input"
                          value={businessDetails.address}
                          onChange={(e) =>
                            setBusinessDetails((prev) => ({ ...prev, address: e.target.value }))
                          }
                          placeholder="Address (autofilled when selecting a business, editable)"
                        />
                      </div>

                      <div className="is-field">
                        <label>Estimated Area (SQM)</label>
                        <input
                          className="is-input"
                          type="number"
                          min="0"
                          value={businessDetails.estimatedAreaSqm}
                          onChange={(e) =>
                            setBusinessDetails((prev) => ({ ...prev, estimatedAreaSqm: e.target.value }))
                          }
                          placeholder="Enter estimated area"
                        />
                      </div>

                      <div className="is-field">
                        <label>No. of Employees</label>
                        <input
                          className="is-input"
                          type="number"
                          min="0"
                          value={businessDetails.numberOfEmployees}
                          onChange={(e) =>
                            setBusinessDetails((prev) => ({ ...prev, numberOfEmployees: e.target.value }))
                          }
                          placeholder="Enter number of employees"
                        />
                      </div>

                      <div className="is-field">
                        <label>Landline #</label>
                        <input
                          className="is-input"
                          value={businessDetails.landline}
                          onChange={(e) =>
                            setBusinessDetails((prev) => ({ ...prev, landline: e.target.value }))
                          }
                          placeholder="Enter landline #"
                        />
                      </div>

                      <div className="is-field">
                        <label>Cellphone #</label>
                        <input
                          className="is-input"
                          value={businessDetails.cellphone}
                          onChange={(e) =>
                            setBusinessDetails((prev) => ({ ...prev, cellphone: e.target.value }))
                          }
                          placeholder="Enter cellphone #"
                        />
                      </div>

                      <div className="is-field">
                        <label>Email Address</label>
                        <input
                          className="is-input"
                          type="email"
                          value={businessDetails.email}
                          onChange={(e) => setBusinessDetails((prev) => ({ ...prev, email: e.target.value }))}
                          placeholder="Enter email address"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="is-card">
                    <div className="is-section-head">
                      <div>
                        <p className="is-section-title">Step 5: Compliance Checklist</p>
                        <p className="is-section-sub">Use Compliant / Non-Compliant / N/A per item.</p>
                      </div>
                    </div>

                    <div style={{ display: 'grid', gap: 10 }}>
                      {[
                        { key: 'business_permit', label: 'Business Permit (Presented)' },
                        { key: 'with_cctv', label: 'With CCTV' },
                        { key: 'signage_2sqm', label: '2sqm Signage' },
                      ].map((item) => (
                        <div key={item.key} className="is-check-row" style={{ alignItems: 'flex-start' }}>
                          <div className="is-check-title" style={{ paddingTop: 6 }}>
                            {item.label}
                          </div>
                          <div style={{ display: 'grid', gap: 8, justifyItems: 'start' }}>
                            <div className="is-seg" role="group" aria-label={`${item.label} status`}>
                              {[
                                { v: 'compliant', t: 'Compliant' },
                                { v: 'non_compliant', t: 'Non-Compliant' },
                                { v: 'na', t: 'N/A' },
                              ].map((opt) => (
                                <button
                                  key={opt.v}
                                  type="button"
                                  className={checklist[item.key] === opt.v ? 'active' : ''}
                                  onClick={() => {
                                    setChecklist((p) => ({ ...p, [item.key]: opt.v }));
                                    if (item.key === 'with_cctv' && opt.v !== 'compliant') {
                                      setCctvCount('');
                                    }
                                  }}
                                  aria-pressed={checklist[item.key] === opt.v}
                                >
                                  {opt.t}
                                </button>
                              ))}
                            </div>

                            {item.key === 'with_cctv' && checklist.with_cctv === 'compliant' ? (
                              <div className="is-field" style={{ margin: 0, width: 220 }}>
                                <label style={{ fontSize: 12 }}>No. of CCTVs</label>
                                <input
                                  className="is-input"
                                  type="text"
                                  inputMode="numeric"
                                  pattern="[0-9]*"
                                  value={cctvCount}
                                  onChange={(e) => {
                                    // Keep only digits (prevents "e", "+", "-", "." from being stored)
                                    const next = String(e.target.value || '').replace(/\D+/g, '');
                                    setCctvCount(next);
                                  }}
                                  onKeyDown={(e) => {
                                    // Block common non-integer characters that browsers allow in number inputs
                                    if (['e', 'E', '+', '-', '.'].includes(e.key)) {
                                      e.preventDefault();
                                    }
                                  }}
                                  placeholder="Enter count"
                                />
                              </div>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="is-card">
                    <div className="is-section-head">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <svg
                          width="18"
                          height="18"
                          viewBox="0 0 24 24"
                          fill="none"
                          xmlns="http://www.w3.org/2000/svg"
                          aria-hidden="true"
                        >
                          <path
                            d="M12 20h9"
                            stroke="#7c3aed"
                            strokeWidth="2"
                            strokeLinecap="round"
                          />
                          <path
                            d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z"
                            stroke="#7c3aed"
                            strokeWidth="2"
                            strokeLinejoin="round"
                          />
                        </svg>
                        <div>
                          <p className="is-section-title">Step 6: Additional Observations</p>
                          <p className="is-section-sub">Optional notes, findings, or recommendations.</p>
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        {!cameraOpen ? (
                          <button
                            type="button"
                            className="mo-btn mo-btn-secondary"
                            onClick={openCameraFlow}
                            disabled={cameraBusy}
                            title="Open Camera"
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
                          >
                            <img src="/ui_icons/camera.png" alt="Camera" style={{ width: 16, height: 16 }} />
                            {cameraBusy ? 'Opening…' : 'Open Camera'}
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="mo-btn mo-btn-secondary"
                            onClick={closeCamera}
                            disabled={cameraBusy}
                            title="Close Camera"
                          >
                            Close Camera
                          </button>
                        )}
                        <div style={{ alignSelf: 'center', fontSize: 12, fontWeight: 800, color: '#64748b' }}>
                          {evidencePhotos.length} photo{evidencePhotos.length === 1 ? '' : 's'}
                        </div>
                      </div>
                    </div>

                    {cameraError ? (
                      <div className="mo-alert mo-alert-error" style={{ marginBottom: 10 }}>
                        {cameraError}
                      </div>
                    ) : null}

                    {cameraOpen ? (
                      <div
                        style={{
                          border: '1px solid #e2e8f0',
                          borderRadius: 12,
                          overflow: 'hidden',
                          background: '#0b1220',
                          position: 'relative',
                          marginBottom: 10,
                        }}
                      >
                        <video ref={videoRef} playsInline muted autoPlay style={{ width: '100%', height: 260, objectFit: 'cover' }} />

                        <div
                          style={{
                            position: 'absolute',
                            left: 12,
                            right: 12,
                            bottom: 12,
                            display: 'grid',
                            gridTemplateColumns: '1fr auto 1fr',
                            alignItems: 'center',
                            columnGap: 12,
                          }}
                        >
                          <div style={{ justifySelf: 'start' }}>
                            <button
                              type="button"
                              onClick={switchCamera}
                              disabled={cameraBusy}
                              className="mo-btn mo-btn-secondary"
                              style={{ width: 40, height: 40, borderRadius: 999, padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                              aria-label="Switch Camera"
                              title="Switch Camera"
                            >
                              <img src="/ui_icons/switch-camera.png" alt="Switch" style={{ width: 18, height: 18 }} />
                            </button>
                          </div>

                          <div style={{ justifySelf: 'center' }}>
                            <button
                              type="button"
                              onClick={captureFromCamera}
                              disabled={cameraBusy}
                              className="mo-btn mo-btn-primary"
                              style={{ width: 62, height: 62, borderRadius: 999, padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 10px 24px rgba(0,0,0,0.35)' }}
                              aria-label="Capture Photo"
                              title="Capture Photo"
                            >
                              <img src="/ui_icons/camera.png" alt="Capture" style={{ width: 26, height: 26, filter: 'invert(1) brightness(2) contrast(100%)' }} />
                            </button>
                          </div>

                          <div />
                        </div>
                      </div>
                    ) : null}

                    {evidencePhotos.length ? (
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))',
                          gap: 10,
                          marginBottom: 10,
                        }}
                        aria-label="Evidence photos"
                      >
                        {evidencePhotos.map((p, idx) => (
                          <div
                            key={p.ts || idx}
                            style={{
                              position: 'relative',
                              borderRadius: 12,
                              overflow: 'hidden',
                              border: '1px solid #e2e8f0',
                              background: '#fff',
                              aspectRatio: '1 / 1',
                            }}
                          >
                            <img
                              src={p.url}
                              alt={`Evidence ${idx + 1}`}
                              style={{ width: '100%', height: '100%', objectFit: 'cover', cursor: 'zoom-in' }}
                              onClick={() => setActivePhotoUrl(p.url)}
                              title="Click to preview"
                            />

                            <div
                              style={{
                                position: 'absolute',
                                left: 6,
                                right: 6,
                                bottom: 6,
                                padding: '3px 6px',
                                borderRadius: 8,
                                background: 'rgba(15,23,42,0.65)',
                                color: '#fff',
                                fontSize: 10,
                                fontWeight: 800,
                                lineHeight: '12px',
                                textAlign: 'center',
                              }}
                              title={p.ts ? new Date(p.ts).toLocaleString() : ''}
                            >
                              {p.ts ? new Date(p.ts).toLocaleString() : ''}
                            </div>

                            <button
                              type="button"
                              onClick={() => removeEvidencePhoto(idx)}
                              aria-label="Remove evidence photo"
                              title="Remove"
                              style={{
                                position: 'absolute',
                                top: 6,
                                right: 6,
                                width: 24,
                                height: 24,
                                borderRadius: 999,
                                border: '1px solid rgba(255,255,255,0.7)',
                                background: 'rgba(15,23,42,0.55)',
                                color: '#fff',
                                fontWeight: 900,
                                lineHeight: '22px',
                                textAlign: 'center',
                                cursor: 'pointer',
                              }}
                            >
                              ×
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : null}

                    <div style={{ display: 'grid', gap: 10 }}>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }} aria-label="Quick tags">
                        {quickTags.map((t) => (
                          <button
                            key={t}
                            type="button"
                            className="mo-btn mo-btn-secondary mo-btn--sm"
                            onClick={() => applyQuickTag(t)}
                            title={`Insert ${t}`}
                            style={{
                              borderRadius: 999,
                              padding: '4px 8px',
                              fontWeight: 800,
                              fontSize: 11,
                              lineHeight: '14px',
                            }}
                          >
                            [{t}]
                          </button>
                        ))}
                      </div>

                      <div
                        style={{
                          position: 'relative',
                          border: '1px solid #e2e8f0',
                          borderRadius: 12,
                          background: '#f8fafc',
                          padding: 12,
                        }}
                      >
                        <textarea
                          value={additionalComments}
                          onChange={(e) => {
                            const next = String(e.target.value || '').slice(0, COMMENTS_MAX);
                            setAdditionalComments(next);
                          }}
                          rows={5}
                          placeholder="Type any specific findings or recommendations here…"
                          style={{
                            width: '100%',
                            border: '1px solid #cbd5e1',
                            borderRadius: 10,
                            padding: 12,
                            background: '#fff',
                            color: '#0f172a',
                            fontWeight: 700,
                            outline: 'none',
                            resize: 'vertical',
                          }}
                        />

                        <div
                          style={{
                            position: 'absolute',
                            right: 18,
                            bottom: 16,
                            fontSize: 12,
                            fontWeight: 800,
                            color: '#94a3b8',
                            pointerEvents: 'none',
                            background: 'rgba(248,250,252,0.9)',
                            padding: '2px 6px',
                            borderRadius: 999,
                          }}
                        >
                          {String(additionalComments || '').length} / {COMMENTS_MAX}
                        </div>
                      </div>
                    </div>
                  </div>

                                  </>
              ) : (
                <>
                  <div className="is-card">
                    <div className="is-section-head">
                      <div>
                        <p className="is-section-title">Summary</p>
                        <p className="is-section-sub">Review key details below.</p>
                      </div>
                    </div>

                    <div className="is-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
                      <div className="is-field">
                        <label>Owner Type</label>
                        <div style={{ fontWeight: 800, color: '#0f172a' }}>
                          {ownerType === 'sole' ? 'Sole Proprietor' : 'Corporation'}
                        </div>
                      </div>

                      <div className="is-field">
                        <label>BIN #</label>
                        <div style={{ fontWeight: 800, color: '#0f172a' }}>{businessDetails.bin || '—'}</div>
                      </div>

                      <div className="is-field" style={{ gridColumn: '1 / -1' }}>
                        <label>Business Name</label>
                        <div style={{ fontWeight: 800, color: '#0f172a' }}>{ownerDetails.businessName || '—'}</div>
                      </div>

                      <div className="is-field" style={{ gridColumn: '1 / -1' }}>
                        <label>Business Address</label>
                        <div style={{ fontWeight: 800, color: '#0f172a' }}>{businessDetails.address || '—'}</div>
                      </div>

                      <div className="is-field" style={{ gridColumn: '1 / -1' }}>
                        <label>Owner Name</label>
                        <div style={{ fontWeight: 800, color: '#0f172a' }}>
                          {`${ownerDetails.lastName || ''}${
                            ownerDetails.lastName && (ownerDetails.firstName || ownerDetails.middleName) ? ', ' : ''
                          }${ownerDetails.firstName || ''}${ownerDetails.middleName ? ` ${ownerDetails.middleName}` : ''}`.trim() ||
                            '—'}
                        </div>
                      </div>

                      <div className="is-field" style={{ gridColumn: '1 / -1' }}>
                        <label>Line(s) of Business</label>
                        <div style={{ fontWeight: 700, color: '#0f172a', whiteSpace: 'pre-wrap' }}>
                          {lineOfBusinessList.filter(Boolean).length
                            ? lineOfBusinessList
                                .filter(Boolean)
                                .map((x) => `• ${x}`)
                                .join('\n')
                            : '—'}
                        </div>
                      </div>

                      <div className="is-field">
                        <label>Estimated Area (SQM)</label>
                        <div style={{ fontWeight: 800, color: '#0f172a' }}>{businessDetails.estimatedAreaSqm || '—'}</div>
                      </div>

                      <div className="is-field">
                        <label>No. of Employees</label>
                        <div style={{ fontWeight: 800, color: '#0f172a' }}>{businessDetails.numberOfEmployees || '—'}</div>
                      </div>

                      <div className="is-field">
                        <label>Landline</label>
                        <div style={{ fontWeight: 800, color: '#0f172a' }}>{businessDetails.landline || '—'}</div>
                      </div>

                      <div className="is-field">
                        <label>Cellphone</label>
                        <div style={{ fontWeight: 800, color: '#0f172a' }}>{businessDetails.cellphone || '—'}</div>
                      </div>

                      <div className="is-field" style={{ gridColumn: '1 / -1' }}>
                        <label>Email</label>
                        <div style={{ fontWeight: 800, color: '#0f172a' }}>{businessDetails.email || '—'}</div>
                      </div>
                    </div>
                  </div>

                  <div className="is-card">
                    <div className="is-section-head">
                      <div>
                        <p className="is-section-title">Compliance Checklist</p>
                        <p className="is-section-sub">Summary of the inspector’s selections.</p>
                      </div>
                    </div>

                    <div style={{ display: 'grid', gap: 10 }}>
                      {[
                        { key: 'business_permit', label: 'Business Permit (Presented)' },
                        { key: 'with_cctv', label: 'With CCTV' },
                        { key: 'signage_2sqm', label: '2sqm Signage' },
                      ].map((item) => {
                        const v = checklist[item.key];
                        const text =
                          v === 'compliant'
                            ? 'Compliant'
                            : v === 'non_compliant'
                              ? 'Non-Compliant'
                              : 'N/A';

                        return (
                          <div key={item.key} className="is-check-row">
                            <div className="is-check-title">{item.label}</div>
                            <div style={{ fontWeight: 900, color: '#0f172a' }}>
                              {text}
                              {item.key === 'with_cctv' && v === 'compliant' ? (
                                <span style={{ marginLeft: 8, fontWeight: 900, color: '#0f172a' }}>
                                  ({cctvCount ? `${cctvCount} CCTV${String(cctvCount) === '1' ? '' : 's'}` : 'CCTV count not set'})
                                </span>
                              ) : null}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="is-card">
                    <div className="is-section-head">
                      <div>
                        <p className="is-section-title">Additional Observations</p>
                        <p className="is-section-sub">Inspector remarks / findings.</p>
                      </div>
                    </div>

                    <div className="is-field" style={{ marginTop: 4 }}>
                      <label>Remarks</label>
                      <div style={{ fontWeight: 800, color: '#0f172a', whiteSpace: 'pre-wrap' }}>
                        {additionalComments?.trim() ? additionalComments : '—'}
                      </div>
                      <div style={{ marginTop: 6, fontSize: 12, fontWeight: 800, color: '#94a3b8' }}>
                        {String(additionalComments || '').length} / {COMMENTS_MAX}
                      </div>
                    </div>

                    <div className="is-field" style={{ marginTop: 12 }}>
                      <label>Photo Evidence</label>
                      {evidencePhotos.length ? (
                        <div
                          style={{
                            marginTop: 8,
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))',
                            gap: 10,
                          }}
                          aria-label="Evidence photos summary"
                        >
                          {evidencePhotos.map((p, idx) => (
                            <div
                              key={p.ts || idx}
                              style={{
                                borderRadius: 12,
                                overflow: 'hidden',
                                border: '1px solid #e2e8f0',
                                background: '#fff',
                                aspectRatio: '1 / 1',
                                position: 'relative',
                              }}
                            >
                              <img
                                src={p.url}
                                alt={`Evidence ${idx + 1}`}
                                style={{ width: '100%', height: '100%', objectFit: 'cover', cursor: 'zoom-in' }}
                                onClick={() => setActivePhotoUrl(p.url)}
                                title="Click to preview"
                              />
                              <div
                                style={{
                                  position: 'absolute',
                                  left: 6,
                                  right: 6,
                                  bottom: 6,
                                  padding: '3px 6px',
                                  borderRadius: 8,
                                  background: 'rgba(15,23,42,0.65)',
                                  color: '#fff',
                                  fontSize: 10,
                                  fontWeight: 800,
                                  lineHeight: '12px',
                                  textAlign: 'center',
                                }}
                                title={p.ts ? new Date(p.ts).toLocaleString() : ''}
                              >
                                {p.ts ? new Date(p.ts).toLocaleString() : ''}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div style={{ fontWeight: 800, color: '#64748b' }}>—</div>
                      )}
                    </div>
                  </div>

                  <div className="is-card">
                    <div className="is-section-head">
                      <div>
                        <p className="is-section-title">Signatures</p>
                        <p className="is-section-sub">Capture signatures after the inspection if needed.</p>
                      </div>
                    </div>

                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                        gap: 12,
                      }}
                    >
                      <div className="is-field">
                        <label>Inspector Signature</label>
                        <div className="is-sign-wrap">
                          <canvas
                            ref={inspectorCanvasRef}
                            width={400}
                            height={120}
                            style={{
                              width: '100%',
                              height: 120,
                              display: 'block',
                              background: 'transparent',
                              touchAction: 'none',
                            }}
                            onPointerDown={(e) => handleSignatureStart('inspector', e)}
                            onPointerMove={(e) => handleSignatureMove('inspector', e)}
                            onPointerUp={(e) => handleSignatureEnd('inspector', e)}
                            onPointerCancel={(e) => handleSignatureEnd('inspector', e)}
                            onPointerLeave={(e) => handleSignatureEnd('inspector', e)}
                          />
                          {!inspectorSignature ? <div className="is-sign-hint">Sign here</div> : null}
                          {!isCompleted ? (
                            <button
                              type="button"
                              className="mo-btn mo-btn--sm mo-btn-secondary is-sign-clear"
                              onClick={() => handleSignatureClear('inspector')}
                              title="Clear signature"
                            >
                              Clear
                            </button>
                          ) : null}
                        </div>
                      </div>

                      <div className="is-field">
                        <label>Business Owner Signature</label>
                        <div className="is-sign-wrap">
                          <canvas
                            ref={ownerCanvasRef}
                            width={400}
                            height={120}
                            style={{
                              width: '100%',
                              height: 120,
                              display: 'block',
                              background: 'transparent',
                              touchAction: 'none',
                            }}
                            onPointerDown={(e) => handleSignatureStart('owner', e)}
                            onPointerMove={(e) => handleSignatureMove('owner', e)}
                            onPointerUp={(e) => handleSignatureEnd('owner', e)}
                            onPointerCancel={(e) => handleSignatureEnd('owner', e)}
                            onPointerLeave={(e) => handleSignatureEnd('owner', e)}
                          />
                          {!ownerSignature ? <div className="is-sign-hint">Sign here</div> : null}
                          {!isCompleted ? (
                            <button
                              type="button"
                              className="mo-btn mo-btn--sm mo-btn-secondary is-sign-clear"
                              onClick={() => handleSignatureClear('owner')}
                              title="Clear signature"
                            >
                              Clear
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </section>
      </main>
      <Footer />
    </div>
  );
}
