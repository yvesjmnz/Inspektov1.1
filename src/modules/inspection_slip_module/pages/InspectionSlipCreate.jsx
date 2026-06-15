import { useEffect, useMemo, useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';
import { MapContainer, Marker, TileLayer } from 'react-leaflet';
import L from 'leaflet';
import Header from '../../../components/Header';
import Footer from '../../../components/Footer';
import XIconButton from '../../../components/XIconButton.jsx';
import { normalizeInspectionReportStatus, pickPreferredInspectionReport } from '../../../lib/inspectionReports';
import {
  enqueueInspectionSync,
  getOfflineBusinessAdditional,
  getInspectionDraft,
  getPendingInspectionSyncCount,
  saveOfflineBusinessRecords,
  saveInspectionDraft,
  searchOfflineBusinesses,
  syncPendingInspectionReports,
} from '../../../lib/offlineInspectionSync';
import { supabase } from '../../../lib/supabase';
import { getOrdinancesForSubcategory } from '../../../lib/violations/catalog';
import './InspectionSlipCreate.css';

function getMissionOrderIdFromQuery() {
const params = new URLSearchParams(window.location.search);
return params.get('missionOrderId') || params.get('id');
}

function getInspectionReportIdFromQuery() {
const params = new URLSearchParams(window.location.search);
return params.get('inspectionReportId') || params.get('reportId') || params.get('id');
}

function formatDateHuman(value) {
  if (!value) return '—';
  const s = String(value);
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00`) : new Date(s);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

function formatPhotoTimestamp(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  const datePart = d.toLocaleDateString(undefined, {
    month: 'numeric',
    day: 'numeric',
    year: 'numeric',
  });
  const timePart = d.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
  return `${datePart}, ${timePart}`;
}

const GUIDED_CATEGORY_LABELS = [
  'Business Permit & Licensing Issues',
  'Alcohol & Tobacco Violations',
  'Sanitation & Environmental Violations',
  'Health, Hygiene, & Nutrition',
  'Public Security Compliance',
];

const GUIDED_SUBCAT_BY_CATEGORY = new Map([
  ['Business Permit & Licensing Issues', [
    'Operating Without a Valid Business Permit',
    'Missing Commerical Space Clearance',
    'Unregistered or Untaxed Employees',
  ]],
  ['Alcohol & Tobacco Violations', [
    'Selling Alcohol Near Schools',
    'Selling Alcohol to Minors',
    'Selling Cigarettes to Minors',
  ]],
  ['Sanitation & Environmental Violations', [
    'Improper Waste Disposal or Segregation',
    'Illegal Disposing of Cooking Oil',
    'Unpaid Garbage Tax',
  ]],
  ['Health, Hygiene, & Nutrition', [
    'Poor Food-Handler Hygiene',
    'Missing Menu Nutrition Labels',
  ]],
  ['Public Security Compliance', [
    'CCTV System Non-Compliance',
  ]],
]);

const COMPLIANCE_OPTIONS = ['Full Compliance', 'Partial Compliance', 'Non-Compliance'];
const ORDINANCE_BLOCK_HEADING = 'City Ordinances Violated:';
const VIOLATION_FINDING_OPTIONS = [
  { key: 'confirmed', label: 'Confirmed', text: 'Violation Confirmed' },
  { key: 'no_violation', label: 'No Violation Found', text: 'No Violation Found' },
];

const BUSINESS_BIN_KEYS = ['bin', 'permit_bin', 'business_bin'];
const BUSINESS_ADDRESS_KEYS = ['address', 'business_address', 'full_address', 'business_address1'];
const BUSINESS_ESTIMATED_AREA_KEYS = [
  'estimated_area_sqm',
  'estimated_area',
  'business_area_sqm',
  'floor_area_sqm',
  'area_sqm',
  'sqm',
  'business_area',
  'floor_area',
  'area',
];
const BUSINESS_LANDLINE_KEYS = [
  'landline_no',
  'landline_number',
  'landline',
  'telephone_no',
  'telephone',
  'tel_no',
  'phone_no',
  'phone',
];
const BUSINESS_MOBILE_KEYS = [
  'mobile_number',
  'mobile_no',
  'mobile',
  'cellphone_no',
  'cellphone',
  'contact_no',
  'contact_number',
];
const BUSINESS_EMAIL_KEYS = ['email', 'email_address', 'business_email'];
const BUSINESS_EMPLOYEE_COUNT_KEYS = [
  'no_of_employees',
  'employee_no',
  'number_of_employees',
  'employee_count',
  'employees',
  'total_employees',
];

function parseInspectionComments(value) {
  const raw = String(value || '');
  const legacyMatch = raw.match(
    /^Compliance Status:\s*(Full Compliance|Partial Compliance|Non-Compliance)\s*(?:\r?\n){1,2}([\s\S]*)$/i
  );

  if (legacyMatch) {
    const complianceStatus =
      COMPLIANCE_OPTIONS.find((option) => option.toLowerCase() === String(legacyMatch[1] || '').toLowerCase()) || '';
    const remarksBody = String(legacyMatch[2] || '').trimStart();
    const remarks = complianceStatus
      ? `${formatComplianceTag(complianceStatus)}${remarksBody ? ` ${remarksBody}` : ''}`
      : remarksBody;

    return {
      complianceStatus,
      remarks,
    };
  }

  const tagMatch = raw.match(/^\[(Full Compliance|Partial Compliance|Non-Compliance)\]\s*/i);
  if (!tagMatch) {
    return {
      complianceStatus: '',
      remarks: raw,
    };
  }

  return {
    complianceStatus: COMPLIANCE_OPTIONS.find((option) => option.toLowerCase() === String(tagMatch[1] || '').toLowerCase()) || '',
    remarks: raw,
  };
}

function buildInspectionComments(_complianceStatus, remarks) {
  const note = String(remarks || '').trim();
  return note || null;
}

function formatComplianceTag(status) {
  return `[${String(status || '').trim()}]`;
}

function stripComplianceTag(remarks) {
  return String(remarks || '')
    .replace(/^Compliance Status:\s*(Full Compliance|Partial Compliance|Non-Compliance)\s*(?:\r?\n){0,2}/i, '')
    .replace(/^\[(Full Compliance|Partial Compliance|Non-Compliance)\]\s*/i, '');
}

function upsertComplianceTag(status, remarks) {
  const tag = formatComplianceTag(status);
  const withoutExistingTag = stripComplianceTag(remarks);
  const body = withoutExistingTag.trimStart();
  return `${tag}${body ? `\n${body}` : '\n'}`;
}

function formatOrdinanceLabel(ordinance) {
  const code = String(ordinance?.code_number || '').trim();
  const title = String(ordinance?.title || '').trim();
  if (code && title) return `Ordinance No. ${code} (${title})`;
  if (code) return `Ordinance No. ${code}`;
  return title;
}

function formatViolationFindingLine(ordinanceLabel, status) {
  const statusText = VIOLATION_FINDING_OPTIONS.find((option) => option.key === status)?.text;
  if (!ordinanceLabel || !statusText) return '';
  return `${ordinanceLabel} : ${statusText}`;
}

function getViolationFindingStatus(remarks, ordinanceLabel) {
  if (!ordinanceLabel) return '';

  const body = stripComplianceTag(remarks).replace(/\r/g, '');
  const lines = body
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  for (const option of VIOLATION_FINDING_OPTIONS) {
    if (lines.includes(formatViolationFindingLine(ordinanceLabel, option.key))) {
      return option.key;
    }
  }

  return '';
}

function rebuildRemarksWithViolationFindings(remarks, ordinanceLabels, findingsByLabel) {
  const parsed = parseInspectionComments(remarks);
  const body = stripComplianceTag(remarks).replace(/\r/g, '');
  const managedPrefixes = new Set((ordinanceLabels || []).filter(Boolean).map((label) => `${label} : `));

  const freeformLines = body
    .split('\n')
    .filter((line) => {
      const trimmed = String(line || '').trim();
      if (!trimmed) return false;
      if (trimmed.toLowerCase() === ORDINANCE_BLOCK_HEADING.toLowerCase()) return false;
      return !Array.from(managedPrefixes).some((prefix) => trimmed.startsWith(prefix));
    });

  const managedLines = (ordinanceLabels || [])
    .map((label) => formatViolationFindingLine(label, findingsByLabel?.[label]))
    .filter(Boolean);

  const freeformBlock = freeformLines.join('\n').trim();
  const ordinanceBlock = managedLines.length ? `${ORDINANCE_BLOCK_HEADING}\n${managedLines.join('\n')}` : '';
  const nextBody = freeformBlock
    ? [freeformBlock, ordinanceBlock].filter(Boolean).join('\n\n').trim()
    : ordinanceBlock;

  if (!parsed.complianceStatus) return nextBody;
  if (!nextBody) return `${formatComplianceTag(parsed.complianceStatus)}\n\n`;
  if (!freeformBlock && ordinanceBlock) {
    return `${formatComplianceTag(parsed.complianceStatus)}\n\n\n${ordinanceBlock}`;
  }
  return `${formatComplianceTag(parsed.complianceStatus)}\n\n${nextBody}`;
}

function hasFreeformCommentText(remarks, ordinanceLabels) {
  const body = stripComplianceTag(remarks).replace(/\r/g, '');
  const managedPrefixes = new Set((ordinanceLabels || []).filter(Boolean).map((label) => `${label} : `));

  return body
    .split('\n')
    .some((line) => {
      const trimmed = String(line || '').trim();
      if (!trimmed) return false;
      if (trimmed.toLowerCase() === ORDINANCE_BLOCK_HEADING.toLowerCase()) return false;
      return !Array.from(managedPrefixes).some((prefix) => trimmed.startsWith(prefix));
    });
}

function getCommentInsertionIndex(text) {
  const value = String(text || '');
  const headingIndex = value.indexOf(ORDINANCE_BLOCK_HEADING);
  if (headingIndex === -1) return value.length;
  return Math.max(0, headingIndex - 2);
}

function deriveComplianceStatusFromChecklist(checklist) {
  const values = [
    checklist?.business_permit,
    checklist?.with_cctv,
    checklist?.signage_2sqm,
  ];
  const compliantCount = values.filter((value) => value === 'compliant').length;
  const nonCompliantCount = values.filter((value) => value === 'non_compliant').length;
  const answeredCount = values.filter(Boolean).length;

  if (checklist?.business_permit === 'non_compliant') return 'Non-Compliance';
  if (compliantCount === 3) return 'Full Compliance';
  if (nonCompliantCount === 3) return 'Non-Compliance';
  if (answeredCount === 3 && nonCompliantCount >= 1) return 'Partial Compliance';
  return '';
}

function groupComplaintCategoriesFromTags(tags) {
  const result = [];
  if (!Array.isArray(tags) || tags.length === 0) return result;

  const selectedSubs = tags
    .map((t) => String(t || ''))
    .filter((t) => /^Violation:\s*/i.test(t))
    .map((t) => t.replace(/^Violation:\s*/i, '').trim());

  if (selectedSubs.length === 0) return result;

  const subToCat = new Map();
  for (const cat of GUIDED_CATEGORY_LABELS) {
    const subs = GUIDED_SUBCAT_BY_CATEGORY.get(cat) || [];
    subs.forEach((sub) => subToCat.set(sub, cat));
  }

  const byCat = new Map();
  for (const sub of selectedSubs) {
    const cat = subToCat.get(sub);
    if (!cat) continue;
    if (!byCat.has(cat)) byCat.set(cat, new Set());
    byCat.get(cat).add(sub);
  }

  for (const [category, subs] of byCat) {
    result.push({ category, subs: Array.from(subs) });
  }

  return result;
}

function pickInspectionStarterReport(reports) {
  const startedReports = (reports || []).filter((report) => {
    if (!report?.id) return false;
    if (report?.started_at) return true;
    const status = normalizeInspectionReportStatus(report);
    return status === 'in progress' || status === 'completed';
  });

  if (!startedReports.length) {
    return null;
  }

  return [...startedReports].sort((a, b) => {
    const aStarted = new Date(a?.started_at || a?.created_at || 0).getTime();
    const bStarted = new Date(b?.started_at || b?.created_at || 0).getTime();
    if (aStarted !== bStarted) return aStarted - bStarted;

    const aTouched = new Date(a?.updated_at || a?.completed_at || a?.created_at || 0).getTime();
    const bTouched = new Date(b?.updated_at || b?.completed_at || b?.created_at || 0).getTime();
    return bTouched - aTouched;
  })[0];
}

function pickFirstBusinessValue(source, keys) {
  for (const key of keys) {
    const value = source?.[key];
    if (value == null) continue;
    const normalized = String(value).trim();
    if (normalized) return normalized;
  }
  return '';
}

function hasBusinessDetailValue(value) {
  return String(value ?? '').trim() !== '';
}

function fillBlankBusinessDetail(currentValue, fallbackValue) {
  if (hasBusinessDetailValue(currentValue)) return currentValue;
  if (fallbackValue == null) return currentValue;
  const normalized = String(fallbackValue).trim();
  return normalized || currentValue;
}

function formatBusinessDetailValue(value) {
  if (value == null) return '';
  return String(value).trim();
}

function isSameBusinessRecord(a, b) {
  if (!a || !b) return false;
  const aPk = a.business_pk != null ? String(a.business_pk) : '';
  const bPk = b.business_pk != null ? String(b.business_pk) : '';
  if (aPk && bPk) return aPk === bPk;

  const aBin = pickFirstBusinessValue(a, BUSINESS_BIN_KEYS).toLowerCase();
  const bBin = pickFirstBusinessValue(b, BUSINESS_BIN_KEYS).toLowerCase();
  if (aBin && bBin) return aBin === bBin;

  const aName = String(a.business_name || '').trim().toLowerCase();
  const bName = String(b.business_name || '').trim().toLowerCase();
  const aAddress = pickFirstBusinessValue(a, BUSINESS_ADDRESS_KEYS).toLowerCase();
  const bAddress = pickFirstBusinessValue(b, BUSINESS_ADDRESS_KEYS).toLowerCase();
  return !!aName && !!bName && aName === bName && aAddress === bAddress;
}

function OverviewField({ label, children, fullWidth = false }) {
  return (
    <div
      className="is-field"
      style={{
        gridColumn: fullWidth ? '1 / -1' : undefined,
        border: '1px solid #dbe5f3',
        borderRadius: 16,
        background: '#fbfdff',
        padding: '14px 16px',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.7)',
      }}
    >
      <label>{label}</label>
      <div style={{ fontWeight: 900, color: '#0f172a', marginTop: 8, lineHeight: 1.45, wordBreak: 'break-word' }}>
        {children}
      </div>
    </div>
  );
}

export default function InspectionSlipCreate() {
  const missionOrderId = useMemo(() => getMissionOrderIdFromQuery(), []);
  const inspectionReportIdFromQuery = useMemo(() => getInspectionReportIdFromQuery(), []);
  const backHref = useMemo(() => {
    const inspectionSource = (() => {
      try {
        return sessionStorage.getItem('inspectionSource');
      } catch {
        return null;
      }
    })();

    return inspectionSource === 'inspection-history'
      ? '/dashboard/inspector?tab=history'
      : '/dashboard/inspector?tab=assigned';
  }, []);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  const getCachedSessionUser = async () => {
    const { data } = await supabase.auth.getSession();
    return data?.session?.user || null;
  };

  const [missionOrder, setMissionOrder] = useState(null);
  const [complaint, setComplaint] = useState(null);
  const [signedAttachmentUrl, setSignedAttachmentUrl] = useState('');
  const [signedAttachmentContentType, setSignedAttachmentContentType] = useState('');
  const [_signedAttachmentMeta, setSignedAttachmentMeta] = useState({
    uploadedAt: null,
    uploadedBy: null,
  });
  const signedAttachmentBlobRef = useRef(null);
  const [assignedInspectors, setAssignedInspectors] = useState([]);

  const [inspectionReportId, setInspectionReportId] = useState(null);
  const [inspectionOwnerId, setInspectionOwnerId] = useState(null);
  const [inspectionOwnerName, setInspectionOwnerName] = useState('');
  const [currentInspectorId, setCurrentInspectorId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false);
  const [completionKnown, setCompletionKnown] = useState(false);
  const [inspectionStarted, setInspectionStarted] = useState(false);
  const [isOnline, setIsOnline] = useState(() => navigator.onLine !== false);
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [syncingOffline, setSyncingOffline] = useState(false);
  const [offlineDraftLoaded, setOfflineDraftLoaded] = useState(false);

  const [businessSearch, setBusinessSearch] = useState('');
  const [businessResult, setBusinessResult] = useState(null);
  const [checkingBusiness, setCheckingBusiness] = useState(false);
  const [selectedBusiness, setSelectedBusiness] = useState(null);

  const [ownerDetails, setOwnerDetails] = useState({
    fullName: '',
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
  const [summaryUnlocked, setSummaryUnlocked] = useState(false);

  // Businesses can have multiple line(s) of business. We store it as an editable list.
  const [lineOfBusinessList, setLineOfBusinessList] = useState(['']);

  // Checklist with explicit selection: compliant | non_compliant
  const [checklist, setChecklist] = useState({
    business_permit: '',
    with_cctv: '',
    signage_2sqm: '',
  });

  // Only used when "With CCTV" is marked Compliant.
  const [cctvCount, setCctvCount] = useState('');

  // Only used when "Business Signage" is marked Compliant.
  const [signage_sqm, setSignageSqm] = useState('');

  const [complianceStatus, setComplianceStatus] = useState('');
  const [additionalComments, setAdditionalComments] = useState('');

  // Camera capture for evidence photos (Inspection Slip)
  const [evidencePhotos, setEvidencePhotos] = useState([]);
  const [activePhotoUrl, setActivePhotoUrl] = useState('');
  const [showSoftCopyFullView, setShowSoftCopyFullView] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [cameraBusy, setCameraBusy] = useState(false);
  const [facingMode, setFacingMode] = useState('environment'); // 'user' | 'environment'
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const cameraStartSeqRef = useRef(0);
  const commentsTextareaRef = useRef(null);

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
      const tsText = formatPhotoTimestamp(ts);
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
  const [inspectorSignaturePath, setInspectorSignaturePath] = useState(null);
  const [ownerSignaturePath, setOwnerSignaturePath] = useState(null);
  const offlineInspectorSignatureBlobRef = useRef(null);
  const offlineOwnerSignatureBlobRef = useRef(null);

  const refreshPendingSyncCount = async () => {
    try {
      setPendingSyncCount(await getPendingInspectionSyncCount());
    } catch {
      setPendingSyncCount(0);
    }
  };

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      void runOfflineSync();
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    void refreshPendingSyncCount();
    if (navigator.onLine !== false) void runOfflineSync();

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runOfflineSync = async () => {
    if (syncingOffline || navigator.onLine === false) return;
    setSyncingOffline(true);
    try {
      const result = await syncPendingInspectionReports();
      await refreshPendingSyncCount();
      if (result.synced > 0) {
        setToast(`${result.synced} offline inspection update${result.synced === 1 ? '' : 's'} synced.`);
      }
      if (result.failed > 0) {
        setError(`${result.failed} offline inspection update${result.failed === 1 ? '' : 's'} could not sync yet.`);
      }
    } catch (e) {
      setError(e?.message || 'Offline inspection sync failed.');
    } finally {
      setSyncingOffline(false);
    }
  };

  const configureCanvas = (canvas) => {
    if (!canvas) return;

    // Fix cursor/ink mismatch on desktop by matching the canvas internal pixel size
    // to its rendered size, then scaling by devicePixelRatio.
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    const nextWidth = Math.max(1, Math.round(rect.width * dpr));
    const nextHeight = Math.max(1, Math.round(rect.height * dpr));
    const currentCssWidth = Math.max(1, Math.round(canvas.width / dpr));
    const currentCssHeight = Math.max(1, Math.round(canvas.height / dpr));

    // Only resize when needed (resizing clears the canvas).
    if (
      canvas.width !== nextWidth ||
      canvas.height !== nextHeight ||
      currentCssWidth !== Math.max(1, Math.round(rect.width)) ||
      currentCssHeight !== Math.max(1, Math.round(rect.height))
    ) {
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
    void requestInspectorLocation();
  }, []);

  useEffect(() => {
    if (!missionOrderId) return;

    const loadMissionOrder = async () => {
      setLoading(true);
      setError('');
      try {
        if (navigator.onLine === false) {
          const draft = await getInspectionDraft(missionOrderId);
          if (draft) {
            applyOfflineDraft(draft);
            setToast('Offline mode: showing the inspection slip prepared on this device.');
            return;
          }
          throw new Error('This inspection slip was not prepared for offline use on this device.');
        }

        const loadComplaintRecord = async (complaintId, options = {}) => {
          if (!complaintId) {
            setComplaint(null);
            return null;
          }

          const shouldHydrateComplaintDirectly = !!options.shouldHydrateComplaintDirectly;

          const { data: c, error: complaintError } = await supabase
            .from('complaints')
            .select('*')
            .eq('id', complaintId)
            .single();

          if (complaintError || !c) return null;

          setComplaint(c);

          const complaintBusinessName = String(c.business_name || '').trim();
          const complaintBusinessAddress = String(c.business_address || '').trim();

          setOwnerDetails((prev) =>
            shouldHydrateComplaintDirectly
              ? {
                  ...prev,
                  businessName: complaintBusinessName || prev.businessName,
                }
              : {
                  ...prev,
                  businessName: prev.businessName || complaintBusinessName,
                }
          );

          setBusinessDetails((prev) =>
            shouldHydrateComplaintDirectly
              ? {
                  ...prev,
                  address: complaintBusinessAddress || prev.address,
                }
              : {
                  ...prev,
                  address: prev.address || complaintBusinessAddress,
                }
          );

          return c;
        };

        const user = await getCachedSessionUser();
        const userId = user?.id;
        if (!userId) throw new Error('Not authenticated. Please login again.');
        setCurrentInspectorId(userId);

        const { data: mo, error: moError } = await supabase
          .from('mission_orders')
          .select(
            'id, title, content, status, complaint_id, created_at, updated_at, submitted_at, date_of_issuance, date_of_inspection, secretary_signed_attachment_url, secretary_signed_attachment_uploaded_at, secretary_signed_attachment_uploaded_by'
          )
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
        setSignedAttachmentUrl(mo?.secretary_signed_attachment_url || '');
        setSignedAttachmentContentType('');
        setSignedAttachmentMeta({
          uploadedAt: mo?.secretary_signed_attachment_uploaded_at || null,
          uploadedBy: mo?.secretary_signed_attachment_uploaded_by || null,
        });

        const { data: allAssignmentRows, error: allAssignmentError } = await supabase
          .from('mission_order_assignments')
          .select('inspector_id, assigned_at')
          .eq('mission_order_id', missionOrderId)
          .order('assigned_at', { ascending: true });

        if (allAssignmentError) throw allAssignmentError;

        const inspectorIds = Array.from(new Set((allAssignmentRows || []).map((row) => row.inspector_id).filter(Boolean)));
        let inspectorNameById = new Map();
        if (inspectorIds.length) {
          const { data: profiles, error: profilesError } = await supabase
            .from('profiles')
            .select('id, full_name')
            .in('id', inspectorIds);

          if (profilesError) throw profilesError;

          inspectorNameById = new Map((profiles || []).map((profile) => [profile.id, profile.full_name]));
          setAssignedInspectors(
            (allAssignmentRows || [])
              .map((row) => inspectorNameById.get(row.inspector_id))
              .filter(Boolean)
              .filter((value, index, arr) => arr.indexOf(value) === index)
          );
        } else {
          setAssignedInspectors([]);
        }

        // If the URL explicitly references a specific inspection report (e.g., from history),
        // ALWAYS load that exact report and NEVER create a new draft row.
        if (inspectionReportIdFromQuery) {
          const { data: explicitReport, error: explicitErr } = await supabase
            .from('inspection_reports')
            .select('*')
            .eq('id', inspectionReportIdFromQuery)
            .eq('mission_order_id', missionOrderId)
            .single();

          if (explicitErr) throw explicitErr;

          setInspectionReportId(explicitReport.id);

          // Hydrate fields from the explicit report
          {
            const parsedComments = parseInspectionComments(explicitReport.inspection_comments);
            setComplianceStatus(parsedComments.complianceStatus);
            setAdditionalComments(parsedComments.remarks);
          }

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
              const { data: signed } = await supabase.storage.from('inspection').createSignedUrl(path, 60 * 60 * 24 * 7);
              mapped.push({ url: signed?.signedUrl || '', blob: null, ts: Date.now(), storagePath: path });
            }
            setEvidencePhotos(mapped.filter((x) => x.url));
          }

          if (explicitReport.inspector_signature_url) {
            setInspectorSignaturePath(explicitReport.inspector_signature_url);
            const { data: signed } = await supabase.storage
              .from('inspection')
              .createSignedUrl(explicitReport.inspector_signature_url, 60 * 60 * 24 * 7);
            if (signed?.signedUrl) setInspectorSignature(signed.signedUrl);
          } else {
            setInspectorSignaturePath(null);
          }
          if (explicitReport.owner_signature_url) {
            setOwnerSignaturePath(explicitReport.owner_signature_url);
            const { data: signed } = await supabase.storage
              .from('inspection')
              .createSignedUrl(explicitReport.owner_signature_url, 60 * 60 * 24 * 7);
            if (signed?.signedUrl) setOwnerSignature(signed.signedUrl);
          } else {
            setOwnerSignaturePath(null);
          }

          // Checklist
          setChecklist((p) => ({
            ...p,
            business_permit: fromDbStatus(explicitReport.business_permit_status) || p.business_permit,
            with_cctv: fromDbStatus(explicitReport.cctv_status) || p.with_cctv,
            signage_2sqm: fromDbStatus(explicitReport.signage_status) || p.signage_2sqm,
          }));
          setCctvCount(explicitReport.cctv_count != null ? String(explicitReport.cctv_count) : '');
          setSignageSqm(explicitReport.signage_sqm != null ? String(explicitReport.signage_sqm) : '');

          if (explicitReport.owner_name) {
            const ownerName = String(explicitReport.owner_name || '').trim();
            if (ownerName) {
              setOwnerDetails((prev) => ({
                ...prev,
                fullName: ownerName,
              }));
            }
          }

          const explicitWorkflowStatus = normalizeInspectionReportStatus(explicitReport);
          const explicitStarted =
            explicitWorkflowStatus === 'in progress' || explicitWorkflowStatus === 'completed' || !!explicitReport.started_at;

          setInspectionOwnerId(explicitStarted ? (explicitReport.inspector_id || null) : null);
          setInspectionOwnerName(explicitStarted ? (inspectorNameById.get(explicitReport.inspector_id) || '') : '');

          // Completed reports are view-only
          if (explicitWorkflowStatus === 'completed') {
            setIsCompleted(true);
            setSummaryUnlocked(true);
            setActiveTab('inspection_details');
          } else {
            setIsCompleted(false);
          }
          setCompletionKnown(explicitWorkflowStatus !== 'pending inspection');
          setInspectionStarted(explicitWorkflowStatus === 'in progress' || explicitWorkflowStatus === 'completed');

          await loadComplaintRecord(mo?.complaint_id, {
            shouldHydrateComplaintDirectly: false,
          });

          // Do not proceed to draft creation logic
          return;
        }

        // Load the single report that currently owns this mission order, if any.
        const { data: missionOrderReports, error: reportErr } = await supabase
          .from('inspection_reports')
          .select('*')
          .eq('mission_order_id', missionOrderId)
          .order('updated_at', { ascending: false })
          .limit(50);

        if (reportErr) throw reportErr;

        const existingReport = pickPreferredInspectionReport(missionOrderReports || []);
        const starterReport = pickInspectionStarterReport(missionOrderReports || []);

        if (existingReport?.id) {
          setInspectionReportId(existingReport.id);
          setInspectionOwnerId(starterReport?.inspector_id || null);
          setInspectionOwnerName(inspectorNameById.get(starterReport?.inspector_id) || '');

          // Hydrate fields from draft
          {
            const parsedComments = parseInspectionComments(existingReport.inspection_comments);
            setComplianceStatus(parsedComments.complianceStatus);
            setAdditionalComments(parsedComments.remarks);
          }

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
              const { data: signed } = await supabase.storage.from('inspection').createSignedUrl(path, 60 * 60 * 24 * 7);
              mapped.push({ url: signed?.signedUrl || '', blob: null, ts: Date.now(), storagePath: path });
            }
            setEvidencePhotos(mapped.filter((x) => x.url));
          }

          if (existingReport.inspector_signature_url) {
            setInspectorSignaturePath(existingReport.inspector_signature_url);
            const { data: signed } = await supabase.storage
              .from('inspection')
              .createSignedUrl(existingReport.inspector_signature_url, 60 * 60 * 24 * 7);
            if (signed?.signedUrl) setInspectorSignature(signed.signedUrl);
          } else {
            setInspectorSignaturePath(null);
          }
          if (existingReport.owner_signature_url) {
            setOwnerSignaturePath(existingReport.owner_signature_url);
            const { data: signed } = await supabase.storage
              .from('inspection')
              .createSignedUrl(existingReport.owner_signature_url, 60 * 60 * 24 * 7);
            if (signed?.signedUrl) setOwnerSignature(signed.signedUrl);
          } else {
            setOwnerSignaturePath(null);
          }

          // Checklist
          setChecklist((p) => ({
            ...p,
            business_permit: fromDbStatus(existingReport.business_permit_status) || p.business_permit,
            with_cctv: fromDbStatus(existingReport.cctv_status) || p.with_cctv,
            signage_2sqm: fromDbStatus(existingReport.signage_status) || p.signage_2sqm,
          }));
          setCctvCount(existingReport.cctv_count != null ? String(existingReport.cctv_count) : '');
          setSignageSqm(existingReport.signage_sqm != null ? String(existingReport.signage_sqm) : '');

          if (existingReport.owner_name) {
            const ownerName = String(existingReport.owner_name || '').trim();
            if (ownerName) {
              setOwnerDetails((prev) => ({
                ...prev,
                fullName: ownerName,
              }));
            }
          }

          const existingWorkflowStatus = normalizeInspectionReportStatus(existingReport);

          if (existingWorkflowStatus === 'completed') {
            setIsCompleted(true);
            setSummaryUnlocked(true);
            setToast(
              'This inspection report is already completed. Editing is disabled, but you can still view the details.'
            );
            setActiveTab('inspection_details');
          } else {
            setIsCompleted(false);
          }
          setCompletionKnown(existingWorkflowStatus !== 'pending inspection');
          setInspectionStarted(existingWorkflowStatus === 'in progress' || existingWorkflowStatus === 'completed');
        } else {
          setInspectionReportId(null);
          setInspectionOwnerId(null);
          setInspectionOwnerName('');
          setInspectorSignaturePath(null);
          setOwnerSignaturePath(null);
          setIsCompleted(false);
          setCompletionKnown(false);
          setInspectionStarted(false);
        }

        // Load linked complaint (if any).
        if (mo?.complaint_id) {
          const shouldHydrateComplaintDirectly = !existingReport?.id && !String(businessSearch || '').trim();
          const c = await loadComplaintRecord(mo.complaint_id, {
            shouldHydrateComplaintDirectly,
          });

          if (c) {
            // Auto-detect complained business from linked complaint (if any).
            const name = String(c.business_name || '').trim();
            const addr = String(c.business_address || '').trim();

            if (!existingReport?.id && (name || addr || c.business_pk)) {
              let bizMatches = [];
              let bizError = null;

              if (c.business_pk) {
                const exactResult = await supabase
                  .from('businesses')
                  .select('*')
                  .eq('business_pk', c.business_pk)
                  .limit(1);
                bizMatches = exactResult.data || [];
                bizError = exactResult.error;
              }

              if (!bizError && bizMatches.length === 0 && (name || addr)) {
                const orClauses = [];
                if (name) orClauses.push(`business_name.ilike.%${name}%`);
                if (addr) orClauses.push(`business_address.ilike.%${addr}%`);

                if (orClauses.length > 0) {
                  const fuzzyResult = await supabase
                    .from('businesses')
                    .select('*')
                    .or(orClauses.join(','))
                    .limit(5);
                  bizMatches = fuzzyResult.data || [];
                  bizError = fuzzyResult.error;
                }
              }

              if (!bizError && bizMatches && bizMatches.length > 0) {
                setBusinessResult({ matches: bizMatches });
                setBusinessSearch(name || addr || '');
                // Use the first match to pre-fill fields; inspector can override.
                handleUseBusiness(bizMatches[0]);
                setAutoFillMessage(
                  'Autofilled from registered business based on the complained business. Click a result card to change.'
                );
              } else {
                setAutoFillMessage('');
              }
            } else {
              setAutoFillMessage('');
            }
          }
        } else {
          setComplaint(null);
          setAutoFillMessage('');
        }
      } catch (e) {
        let restored = false;
        try {
          const draft = await getInspectionDraft(missionOrderId);
          if (draft) {
            applyOfflineDraft(draft);
            if (navigator.onLine === false) {
              setError('');
              setToast('Offline mode: showing the inspection slip prepared on this device.');
            } else {
              setError(e?.message || 'Showing the locally prepared inspection slip.');
            }
            restored = true;
          }
        } catch {
          // If local restore also fails, fall through to the normal error state.
        }

        if (!restored) {
          setMissionOrder(null);
          setComplaint(null);
          setInspectionReportId(null);
          setInspectionOwnerId(null);
          setInspectionOwnerName('');
          setError(e?.message || 'Failed to load mission order.');
        }
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
      offlineInspectorSignatureBlobRef.current = null;
      setInspectorSignaturePath(null);
      setInspectorSignature(dataUrl);
    } else {
      offlineOwnerSignatureBlobRef.current = null;
      setOwnerSignaturePath(null);
      setOwnerSignature(dataUrl);
    }
  };

  const handleSignatureClear = (who) => {
    if (isCompleted) return;

    const { canvas, ctx } = getCanvasContextAndState(who);
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (who === 'inspector') {
      offlineInspectorSignatureBlobRef.current = null;
      setInspectorSignaturePath(null);
      setInspectorSignature('');
    } else {
      offlineOwnerSignatureBlobRef.current = null;
      setOwnerSignaturePath(null);
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

  const handleUseBusiness = async (b, nextOwnerType = ownerType) => {
    if (!b) return;
    const keepCurrentBusinessSpecificValues = isSameBusinessRecord(selectedBusiness, b);
    setSelectedBusiness(b);
    setBusinessResult(null);

    // Always fill business name
    setOwnerDetails((prev) => ({
      ...prev,
      businessName: b.business_name || prev.businessName,
    }));

    // Only autofill owner name for Sole Proprietorship
    // For Corporation, leave the owner name field empty for manual entry
    const isSole = nextOwnerType === 'sole';

    if (isSole) {
      // Autofill owner name only for Sole Proprietor
      // Source priority:
      // 1) businesses.owner_name (if present)
      // 2) composed from legacy name parts (if present)
      const directOwnerName = String(b?.owner_name || '').trim();
      const lastName = b.owner_last_name || b.last_name || b.lastname || '';
      const firstName = b.owner_first_name || b.first_name || b.firstname || '';
      const middleName = b.owner_middle_name || b.middle_name || b.middlename || '';
      const composed = [firstName, middleName, lastName].map((s) => String(s || '').trim()).filter(Boolean).join(' ');

      setOwnerDetails((prev) => ({
        ...prev,
        fullName: directOwnerName || composed || prev.fullName,
        // keep legacy fields populated when available (harmless, helps backward compatibility)
        lastName: lastName || prev.lastName,
        firstName: firstName || prev.firstName,
        middleName: middleName || prev.middleName,
      }));
    } else {
      setOwnerDetails((prev) => ({
        ...prev,
        fullName: '',
        lastName: '',
        firstName: '',
        middleName: '',
      }));
    }
    // For Corporation, keep the owner name blank and still autofill the rest.

    const bin = pickFirstBusinessValue(b, BUSINESS_BIN_KEYS);
    const estimatedAreaSqm = pickFirstBusinessValue(b, BUSINESS_ESTIMATED_AREA_KEYS);
    const landline = pickFirstBusinessValue(b, BUSINESS_LANDLINE_KEYS);
    const cellphone = pickFirstBusinessValue(b, BUSINESS_MOBILE_KEYS);
    const email = pickFirstBusinessValue(b, BUSINESS_EMAIL_KEYS);
    const numberOfEmployees = pickFirstBusinessValue(b, BUSINESS_EMPLOYEE_COUNT_KEYS);
    const address = pickFirstBusinessValue(b, BUSINESS_ADDRESS_KEYS);

    setBusinessDetails((prev) => ({
      ...prev,
      bin: bin || (keepCurrentBusinessSpecificValues ? prev.bin : ''),
      address: address || (keepCurrentBusinessSpecificValues ? prev.address : ''),
      estimatedAreaSqm: estimatedAreaSqm || (keepCurrentBusinessSpecificValues ? prev.estimatedAreaSqm : ''),
      numberOfEmployees: numberOfEmployees || (keepCurrentBusinessSpecificValues ? prev.numberOfEmployees : ''),
      landline: landline || (keepCurrentBusinessSpecificValues ? prev.landline : ''),
      cellphone: cellphone || (keepCurrentBusinessSpecificValues ? prev.cellphone : ''),
      email: email || (keepCurrentBusinessSpecificValues ? prev.email : ''),
    }));

    // Pull multi-line LOB + total_employees from businesses_additional based on BIN.
    // LOB should be autofilled for BOTH Sole Proprietor and Corporation.
    try {
      const businessBin = String(b?.bin || bin || '').trim();
      const businessName = String(b?.business_name || '').trim();
      let addRows = [];
      let addErr = null;

      if (navigator.onLine === false) {
        addRows = await getOfflineBusinessAdditional({ bin: businessBin, businessName });
      } else if (businessBin || businessName) {
        const additionalQuery = supabase
          .from('businesses_additional')
          .select('line_of_business, total_employees, owner_name, bin, business_name');

        if (businessBin) {
          const result = await additionalQuery.eq('bin', businessBin);
          addRows = result.data || [];
          addErr = result.error;
        } else {
          const result = await additionalQuery.eq('business_name', businessName);
          addRows = result.data || [];
          addErr = result.error;
        }

        if (!addErr && addRows?.length) {
          await saveOfflineBusinessRecords({ businesses: [b], additional: addRows });
        }
      }

      if (addErr) throw addErr;
      if (!addRows || addRows.length === 0) {
        if (!keepCurrentBusinessSpecificValues) setLineOfBusinessList(['']);
      } else {
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
        } else if (!keepCurrentBusinessSpecificValues) {
          setLineOfBusinessList(['']);
        }

        // If businesses_additional has an owner_name, use it as a fallback only for Sole Proprietor.
        if (isSole) {
          const additionalOwnerName = addRows
            .map((r) => String(r?.owner_name || '').trim())
            .find(Boolean);

          if (additionalOwnerName) {
            setOwnerDetails((prev) => ({
              ...prev,
              fullName: prev.fullName || additionalOwnerName,
            }));
          }
        }

        const maxEmployees = addRows
          .map((r) => Number(r?.total_employees || 0))
          .filter((n) => Number.isFinite(n) && n > 0)
          .reduce((m, n) => (n > m ? n : m), 0);

        if (maxEmployees > 0) {
          setBusinessDetails((prev) => ({
            ...prev,
            numberOfEmployees: keepCurrentBusinessSpecificValues
              ? prev.numberOfEmployees || String(maxEmployees)
              : String(maxEmployees),
          }));
        }
      }
    } catch {
      // Silent fail
    }

    try {
      if (navigator.onLine === false) return;

      let previousQuery = supabase
        .from('inspection_reports')
        .select(
          'mission_order_id, estimated_area_sqm, no_of_employees, landline_no, mobile_no, email_address, updated_at, completed_at'
        )
        .eq('status', 'completed')
        .order('completed_at', { ascending: false, nullsFirst: false })
        .order('updated_at', { ascending: false })
        .limit(1);

      if (missionOrderId) {
        previousQuery = previousQuery.neq('mission_order_id', missionOrderId);
      }

      if (bin) {
        previousQuery = previousQuery.eq('bin', bin);
      } else if (b.business_name) {
        previousQuery = previousQuery.eq('business_name', b.business_name);
      } else {
        return;
      }

      const { data: previousReports, error: previousErr } = await previousQuery;
      if (previousErr) throw previousErr;

      const previousReport = previousReports?.[0];
      if (!previousReport) return;

      setBusinessDetails((prev) => ({
        ...prev,
        estimatedAreaSqm: keepCurrentBusinessSpecificValues
          ? fillBlankBusinessDetail(prev.estimatedAreaSqm, previousReport.estimated_area_sqm)
          : formatBusinessDetailValue(previousReport.estimated_area_sqm),
        numberOfEmployees: keepCurrentBusinessSpecificValues
          ? fillBlankBusinessDetail(prev.numberOfEmployees, previousReport.no_of_employees)
          : formatBusinessDetailValue(previousReport.no_of_employees),
        landline: keepCurrentBusinessSpecificValues
          ? fillBlankBusinessDetail(prev.landline, previousReport.landline_no)
          : formatBusinessDetailValue(previousReport.landline_no),
        cellphone: keepCurrentBusinessSpecificValues
          ? fillBlankBusinessDetail(prev.cellphone, previousReport.mobile_no)
          : formatBusinessDetailValue(previousReport.mobile_no),
        email: keepCurrentBusinessSpecificValues
          ? fillBlankBusinessDetail(prev.email, previousReport.email_address)
          : formatBusinessDetailValue(previousReport.email_address),
      }));
    } catch {
      // Previous inspection reuse is best-effort; registered business autofill remains usable.
    }
  };

  const handleSelectOwnerType = (nextOwnerType) => {
    setOwnerType(nextOwnerType);

    if (nextOwnerType === 'corp') {
      setOwnerDetails((prev) => ({
        ...prev,
        fullName: '',
        lastName: '',
        firstName: '',
        middleName: '',
      }));
    }

    if (selectedBusiness) {
      void handleUseBusiness(selectedBusiness, nextOwnerType);
    }
  };

  useEffect(() => {
    const nextStatus = deriveComplianceStatusFromChecklist(checklist);
    setComplianceStatus((prev) => (prev === nextStatus ? prev : nextStatus));
    setAdditionalComments((prev) => {
      const nextComments = nextStatus ? upsertComplianceTag(nextStatus, prev) : stripComplianceTag(prev);
      return nextComments === prev ? prev : nextComments;
    });
  }, [checklist, complianceStatus, additionalComments]);

  const statusBadgeStyle = (status) => {
    const s = String(status || '').toLowerCase();
    let bg = '#e2e8f0';
    let fg = '#0f172a';
    if (['completed', 'complete', 'approved'].includes(s)) {
      bg = '#dcfce7';
      fg = '#166534';
    } else if (['cancelled', 'declined', 'rejected', 'invalid'].includes(s)) {
      bg = '#fee2e2';
      fg = '#991b1b';
    } else if (['issued', 'submitted', 'pending', 'new', 'pending inspection', 'pending_inspection'].includes(s)) {
      bg = '#fef9c3';
      fg = '#854d0e';
    } else if (['on hold', 'on_hold', 'hold', 'in progress', 'in_progress'].includes(s)) {
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

  const previewAddress = useMemo(() => String(complaint?.business_address || '').trim(), [complaint?.business_address]);

  const mapUrl = useMemo(() => {
    const address = previewAddress;
    if (!address) return null;
    return `https://maps.google.com/maps?q=${encodeURIComponent(address)}&t=&z=15&ie=UTF8&iwloc=&output=embed`;
  }, [previewAddress]);

  const displayBusinessName = complaint?.business_name || ownerDetails.businessName || '—';
  const displayBusinessAddress = previewAddress || businessDetails.address || '—';
  const complaintViolationGroups = useMemo(() => groupComplaintCategoriesFromTags(complaint?.tags || []), [complaint?.tags]);
  const inspectionViolationFindings = useMemo(() => {
    const items = [];
    const seen = new Set();

    for (const group of complaintViolationGroups) {
      for (const sub of group?.subs || []) {
        for (const ordinance of getOrdinancesForSubcategory(sub)) {
          const ordinanceLabel = formatOrdinanceLabel(ordinance);
          if (!ordinanceLabel) continue;
          const key = `${ordinance?.code_number || ordinanceLabel}|${sub}`;
          if (seen.has(key)) continue;
          seen.add(key);
          items.push({
            key,
            ordinanceLabel,
            subcategory: sub,
            category: group.category,
          });
        }
      }
    }

    return items;
  }, [complaintViolationGroups]);
  const inspectionStatusValue = isCompleted ? 'completed' : inspectionStarted ? 'in progress' : 'pending inspection';
  const inspectionStatusLabel = isCompleted ? 'Completed' : inspectionStarted ? 'In Progress' : 'Pending Inspection';
  const inspectionLocked =
    !isCompleted &&
    inspectionStarted &&
    !!inspectionReportId &&
    !!currentInspectorId &&
    !!inspectionOwnerId &&
    inspectionOwnerId !== currentInspectorId;
  const inspectionLockMessage = inspectionLocked
    ? `This mission order already has an inspection slip started by ${inspectionOwnerName || 'another assigned inspector'}. Only one inspection slip is allowed per mission order.`
    : '';
  const signedAttachmentIsPdf =
    String(signedAttachmentContentType || '').toLowerCase().includes('pdf') ||
    /\.pdf(\?|#|$)/i.test(String(signedAttachmentUrl || ''));
  const applyViolationFinding = (ordinanceLabel, nextStatus) => {
    const ordinanceLabels = inspectionViolationFindings.map((item) => item.ordinanceLabel);
    const shouldRestoreCommentCursor = !hasFreeformCommentText(additionalComments, ordinanceLabels);
    const currentStatuses = Object.fromEntries(
      ordinanceLabels.map((label) => [label, getViolationFindingStatus(additionalComments, label)])
    );

    currentStatuses[ordinanceLabel] = currentStatuses[ordinanceLabel] === nextStatus ? '' : nextStatus;

    const nextComments = rebuildRemarksWithViolationFindings(additionalComments, ordinanceLabels, currentStatuses);
    setAdditionalComments(nextComments);

    if (shouldRestoreCommentCursor) {
      requestAnimationFrame(() => {
        const textarea = commentsTextareaRef.current;
        if (!textarea) return;
        const insertionIndex = getCommentInsertionIndex(nextComments);
        textarea.focus();
        textarea.setSelectionRange(insertionIndex, insertionIndex);
      });
    }
  };

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
          const lat = parseFloat(pos.coords.latitude);
          const lng = parseFloat(pos.coords.longitude);
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

  const blobToObjectUrl = (blob) => {
    if (!blob) return '';
    try {
      return URL.createObjectURL(blob);
    } catch {
      return '';
    }
  };

  const normalizeEvidenceForDraft = (photos) =>
    (photos || []).map((photo) => ({
      blob: photo?.blob || null,
      url: photo?.url || '',
      ts: photo?.ts || Date.now(),
      storagePath: photo?.storagePath || null,
      contentType: photo?.blob?.type || 'image/jpeg',
    }));

  const createReportPayload = ({ attachmentUrls = null, inspectorSigPath = null, ownerSigPath = null } = {}) => ({
    bin: businessDetails.bin || null,
    business_name: ownerDetails.businessName || null,
    owner_name: toOwnerNameString() || null,
    business_address: businessDetails.address || null,

    inspector_lat: inspectorLocation.lat,
    inspector_lng: inspectorLocation.lng,
    inspector_location_accuracy_m: inspectorLocation.accuracy,
    inspector_location_captured_at: inspectorLocation.capturedAt,

    business_permit_status: toDbStatus(checklist.business_permit),
    cctv_status: toDbStatus(checklist.with_cctv),
    signage_status: toDbStatus(checklist.signage_2sqm),
    cctv_count: cctvCount ? Number(cctvCount) : 0,
    signage_sqm: signage_sqm ? Number(signage_sqm) : 0,

    inspection_comments: buildInspectionComments(complianceStatus, additionalComments),
    lines_of_business: lineOfBusinessList.filter(Boolean),
    no_of_employees: businessDetails.numberOfEmployees ? Number(businessDetails.numberOfEmployees) : null,
    estimated_area_sqm: businessDetails.estimatedAreaSqm ? Number(businessDetails.estimatedAreaSqm) : null,
    mobile_no: businessDetails.cellphone || null,
    landline_no: businessDetails.landline || null,
    email_address: businessDetails.email || null,
    attachment_urls: attachmentUrls,
    inspector_signature_url: inspectorSigPath || inspectorSignaturePath || null,
    owner_signature_url: ownerSigPath || ownerSignaturePath || null,
  });

  const buildOfflineDraft = async ({ syncStatus = 'draft', completedAt = null } = {}) => {
    let inspectorSignatureBlob = offlineInspectorSignatureBlobRef.current || null;
    let ownerSignatureBlob = offlineOwnerSignatureBlobRef.current || null;
    let signedAttachmentBlob = signedAttachmentBlobRef.current || null;

    if (inspectorSignature && inspectorSignature.startsWith('data:image')) {
      inspectorSignatureBlob = await dataUrlToBlob(inspectorSignature);
    }
    if (ownerSignature && ownerSignature.startsWith('data:image')) {
      ownerSignatureBlob = await dataUrlToBlob(ownerSignature);
    }
    if (!signedAttachmentBlob && signedAttachmentUrl && signedAttachmentUrl.startsWith('blob:')) {
      try {
        signedAttachmentBlob = await (await fetch(signedAttachmentUrl)).blob();
      } catch {
        signedAttachmentBlob = null;
      }
    }

    return {
      missionOrderId,
      inspectionReportId,
      inspectorId: currentInspectorId,
      complaintId: missionOrder?.complaint_id || complaint?.id || null,
      completedAt,
      syncStatus,
      formState: {
        ownerDetails,
        businessDetails,
        inspectorLocation,
        ownerType,
        lineOfBusinessList,
        checklist,
        cctvCount,
        signage_sqm,
        complianceStatus,
        additionalComments,
        inspectorSignature: inspectorSignatureBlob ? '' : inspectorSignature,
        ownerSignature: ownerSignatureBlob ? '' : ownerSignature,
        inspectorSignaturePath,
        ownerSignaturePath,
      },
      evidencePhotos: normalizeEvidenceForDraft(evidencePhotos),
      inspectorSignatureBlob,
      inspectorSignatureContentType: inspectorSignatureBlob?.type || 'image/png',
      ownerSignatureBlob,
      ownerSignatureContentType: ownerSignatureBlob?.type || 'image/png',
      inspectorSignaturePath,
      ownerSignaturePath,
      reportPayload: createReportPayload(),
      missionOrderSnapshot: missionOrder,
      complaintSnapshot: complaint,
      assignedInspectorsSnapshot: assignedInspectors,
      signedAttachmentBlob,
      signedAttachmentContentType: signedAttachmentBlob?.type || signedAttachmentContentType || '',
      signedAttachmentUrl: signedAttachmentBlob ? '' : signedAttachmentUrl,
      signedAttachmentMeta: _signedAttachmentMeta,
    };
  };

  const applyOfflineDraft = (draft) => {
    const state = draft?.formState || {};
    if (draft?.inspectorId) setCurrentInspectorId(draft.inspectorId);
    const reportSnapshot = draft?.inspectionReportSnapshot || null;

    if (Array.isArray(draft?.assignedInspectorsSnapshot)) {
      setAssignedInspectors(draft.assignedInspectorsSnapshot);
    }

    if (draft?.signedAttachmentBlob) {
      signedAttachmentBlobRef.current = draft.signedAttachmentBlob;
      setSignedAttachmentContentType(draft.signedAttachmentContentType || draft.signedAttachmentBlob.type || '');
      setSignedAttachmentUrl(blobToObjectUrl(draft.signedAttachmentBlob));
    } else if (draft?.signedAttachmentUrl) {
      setSignedAttachmentContentType(draft.signedAttachmentContentType || '');
      setSignedAttachmentUrl(draft.signedAttachmentUrl);
    }

    if (draft?.signedAttachmentMeta) {
      setSignedAttachmentMeta({
        uploadedAt: draft.signedAttachmentMeta.uploadedAt || null,
        uploadedBy: draft.signedAttachmentMeta.uploadedBy || null,
      });
    } else if (draft?.missionOrderSnapshot) {
      setSignedAttachmentMeta({
        uploadedAt: draft.missionOrderSnapshot.secretary_signed_attachment_uploaded_at || null,
        uploadedBy: draft.missionOrderSnapshot.secretary_signed_attachment_uploaded_by || null,
      });
    }

    if (state.ownerDetails) setOwnerDetails(state.ownerDetails);
    if (state.businessDetails) setBusinessDetails(state.businessDetails);
    if (state.inspectorLocation) setInspectorLocation(state.inspectorLocation);
    if (state.ownerType) setOwnerType(state.ownerType);
    if (Array.isArray(state.lineOfBusinessList)) setLineOfBusinessList(state.lineOfBusinessList.length ? state.lineOfBusinessList : ['']);
    if (state.checklist) setChecklist(state.checklist);
    setCctvCount(state.cctvCount || '');
    setSignageSqm(state.signage_sqm || '');
    setComplianceStatus(state.complianceStatus || '');
    setAdditionalComments(state.additionalComments || '');
    setInspectorSignaturePath(state.inspectorSignaturePath || draft.inspectorSignaturePath || null);
    setOwnerSignaturePath(state.ownerSignaturePath || draft.ownerSignaturePath || null);

    const restoredEvidence = (draft.evidencePhotos || []).map((photo) => ({
      ...photo,
      url: photo?.blob ? blobToObjectUrl(photo.blob) : photo?.url || '',
    }));
    if (restoredEvidence.length) setEvidencePhotos(restoredEvidence);

    if (draft.inspectorSignatureBlob) {
      offlineInspectorSignatureBlobRef.current = draft.inspectorSignatureBlob;
      setInspectorSignature(blobToObjectUrl(draft.inspectorSignatureBlob));
    } else if (state.inspectorSignature) {
      setInspectorSignature(state.inspectorSignature);
    }

    if (draft.ownerSignatureBlob) {
      offlineOwnerSignatureBlobRef.current = draft.ownerSignatureBlob;
      setOwnerSignature(blobToObjectUrl(draft.ownerSignatureBlob));
    } else if (state.ownerSignature) {
      setOwnerSignature(state.ownerSignature);
    }

    if (draft.inspectionReportId) setInspectionReportId(draft.inspectionReportId);
    if (draft.missionOrderSnapshot && !missionOrder) setMissionOrder(draft.missionOrderSnapshot);
    if (draft.complaintSnapshot && !complaint) setComplaint(draft.complaintSnapshot);

    let nextInspectionStarted = false;
    let nextCompletionKnown = false;
    let nextIsCompleted = false;

    if (reportSnapshot?.id) {
      setInspectionReportId(reportSnapshot.id);
      setInspectionOwnerId(reportSnapshot.inspector_id || null);

      const parsedComments = parseInspectionComments(reportSnapshot.inspection_comments);
      setComplianceStatus(parsedComments.complianceStatus);
      setAdditionalComments(parsedComments.remarks);

      if (Array.isArray(reportSnapshot.lines_of_business) && reportSnapshot.lines_of_business.length) {
        setLineOfBusinessList(reportSnapshot.lines_of_business);
      }

      setBusinessDetails((prev) => ({
        ...prev,
        bin: reportSnapshot.bin ?? prev.bin,
        address: reportSnapshot.business_address ?? prev.address,
        estimatedAreaSqm:
          reportSnapshot.estimated_area_sqm != null ? String(reportSnapshot.estimated_area_sqm) : prev.estimatedAreaSqm,
        numberOfEmployees:
          reportSnapshot.no_of_employees != null ? String(reportSnapshot.no_of_employees) : prev.numberOfEmployees,
        landline: reportSnapshot.landline_no ?? prev.landline,
        cellphone: reportSnapshot.mobile_no ?? prev.cellphone,
        email: reportSnapshot.email_address ?? prev.email,
      }));

      if (reportSnapshot.business_name || reportSnapshot.owner_name) {
        setOwnerDetails((prev) => ({
          ...prev,
          businessName: reportSnapshot.business_name ?? prev.businessName,
          fullName: reportSnapshot.owner_name ?? prev.fullName,
        }));
      }

      setChecklist((prev) => ({
        ...prev,
        business_permit: fromDbStatus(reportSnapshot.business_permit_status) || prev.business_permit,
        with_cctv: fromDbStatus(reportSnapshot.cctv_status) || prev.with_cctv,
        signage_2sqm: fromDbStatus(reportSnapshot.signage_status) || prev.signage_2sqm,
      }));
      setCctvCount(reportSnapshot.cctv_count != null ? String(reportSnapshot.cctv_count) : '');
      setSignageSqm(reportSnapshot.signage_sqm != null ? String(reportSnapshot.signage_sqm) : '');
      setInspectorSignaturePath(reportSnapshot.inspector_signature_url || null);
      setOwnerSignaturePath(reportSnapshot.owner_signature_url || null);

      const workflowStatus = normalizeInspectionReportStatus(reportSnapshot);
      nextIsCompleted = workflowStatus === 'completed';
      nextInspectionStarted = workflowStatus === 'in progress' || workflowStatus === 'completed' || !!reportSnapshot.started_at;
      nextCompletionKnown = workflowStatus !== 'pending inspection';
      if (draft.syncStatus === 'prepared') {
        nextIsCompleted = false;
        nextInspectionStarted = false;
        nextCompletionKnown = false;
      }
      setIsCompleted(nextIsCompleted);
      setInspectionStarted(nextInspectionStarted);
      setCompletionKnown(nextCompletionKnown);
      if (workflowStatus === 'completed') {
        setSummaryUnlocked(true);
      }
    }

    if (draft.syncStatus === 'ready_to_sync' || draft.syncStatus === 'completed') {
      setIsCompleted(true);
      setSummaryUnlocked(true);
      setInspectionStarted(true);
      setCompletionKnown(true);
    } else if (!reportSnapshot?.id) {
      setIsCompleted(false);
      setInspectionStarted(false);
      setCompletionKnown(false);
    } else {
      setIsCompleted(nextIsCompleted);
      setInspectionStarted(nextInspectionStarted);
      setCompletionKnown(nextCompletionKnown);
    }
    setOfflineDraftLoaded(true);
    setToast('Offline inspection draft restored.');
  };

  useEffect(() => {
    if (!missionOrderId || offlineDraftLoaded) return;
    let cancelled = false;

    (async () => {
      try {
        const draft = await getInspectionDraft(missionOrderId);
        if (!cancelled && draft) applyOfflineDraft(draft);
      } catch {
        // Local draft restore is best-effort; online loading still works without it.
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missionOrderId, offlineDraftLoaded]);

  const toOwnerNameString = () => {
    // Prefer the new single-field full name.
    const full = String(ownerDetails.fullName || '').trim();
    if (full) return full;

    // Backward compatibility (older drafts / state)
    const ln = (ownerDetails.lastName || '').trim();
    const fn = (ownerDetails.firstName || '').trim();
    const mn = (ownerDetails.middleName || '').trim();
    const rest = [fn, mn].filter(Boolean).join(' ');
    return `${ln}${ln && rest ? ', ' : ''}${rest}`.trim();
  };

  const toDbStatus = (v) => {
    if (v === 'compliant') return 'Compliant';
    if (v === 'non_compliant') return 'Non-Compliant';
    return null;
  };

  const fromDbStatus = (v) => {
    const s = String(v || '').toLowerCase();
    if (s.includes('non')) return 'non_compliant';
    if (s.includes('compliant')) return 'compliant';
    return '';
  };

  // When loading an existing report (completed view), we store signed URLs in state.
  // We also need to paint them onto the canvases because the UI uses <canvas>.
  useEffect(() => {
    if (!completionKnown) return;
    if (activeTab !== 'summary') return;
    if (inspectorSignature && !inspectorSignature.startsWith('data:image')) {
      paintSignatureToCanvas('inspector', inspectorSignature);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completionKnown, inspectorSignature, activeTab]);

  useEffect(() => {
    if (!completionKnown) return;
    if (activeTab !== 'summary') return;
    if (ownerSignature && !ownerSignature.startsWith('data:image')) {
      paintSignatureToCanvas('owner', ownerSignature);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completionKnown, ownerSignature, activeTab]);

  const handleSaveReport = async () => {
    if (isCompleted) {
      setError('This inspection report is already completed and can no longer be edited.');
      return;
    }
    if (inspectionLocked) {
      setError(inspectionLockMessage);
      return;
    }
    if (!inspectionReportId) {
      setError('Inspection report is not initialized yet. Please wait and try again.');
      return;
    }
    if (!missionOrderId) {
      setError('Missing mission order. Please reopen the inspection slip.');
      return;
    }

    if (navigator.onLine === false) {
      setSaving(true);
      setError('');
      try {
        const draft = await buildOfflineDraft({ syncStatus: 'draft' });
        await saveInspectionDraft(draft);
        if (inspectionReportId) {
          await enqueueInspectionSync({ action: 'save', draft });
        }
        await refreshPendingSyncCount();
        setToast(inspectionReportId ? 'Offline draft saved and queued to sync.' : 'Offline draft saved on this device.');
      } catch (e) {
        setError(e?.message || 'Failed to save offline draft.');
      } finally {
        setSaving(false);
      }
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
          nextEvidence.push({ url: signedUrl, blob: p.blob, ts: p.ts || Date.now(), storagePath: path });
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
        setInspectorSignaturePath(path);
        setInspectorSignature(signedUrl);
      }

      if (ownerSignature && ownerSignature.startsWith('data:image')) {
        const blob = await dataUrlToBlob(ownerSignature);
        const file = new File([blob], `owner-signature.png`, { type: blob.type || 'image/png' });
        const storagePath = `inspection-reports/${inspectionReportId}/signatures/${file.name}`;
        const { path, signedUrl } = await uploadToInspectionBucket({ path: storagePath, file, contentType: file.type });
        ownerSigPath = path;
        setOwnerSignaturePath(path);
        setOwnerSignature(signedUrl);
      }

      const attachmentUrlsForDb = nextEvidence
        .map((x) => x?.storagePath)
        .filter(Boolean);

      const payload = createReportPayload({
        attachmentUrls: attachmentUrlsForDb.length ? attachmentUrlsForDb : null,
        inspectorSigPath,
        ownerSigPath,
      });

      const { error: upErr } = await supabase
        .from('inspection_reports')
        .update(payload)
        .eq('mission_order_id', missionOrderId);

      if (upErr) throw upErr;

      setToast('Inspection report saved.');
    } catch (e) {
      if (navigator.onLine === false) {
        try {
          const draft = await buildOfflineDraft({ syncStatus: 'draft' });
          await saveInspectionDraft(draft);
          if (inspectionReportId) {
            await enqueueInspectionSync({ action: 'save', draft });
          }
          await refreshPendingSyncCount();
          setToast(inspectionReportId ? 'Connection dropped. Offline draft queued to sync.' : 'Connection dropped. Offline draft saved on this device.');
        } catch (draftError) {
          setError(draftError?.message || e?.message || 'Failed to save inspection report.');
        }
      } else {
        setError(e?.message || 'Failed to save inspection report.');
      }
    } finally {
      setSaving(false);
    }
  };

  const markInspectionCompleteInDashboardCache = (completedAt) => {
    try {
      const cached = JSON.parse(localStorage.getItem('inspekto.inspectorDashboardCache') || 'null');
      if (!cached) return;

      const assignedRows = Array.isArray(cached.assigned) ? cached.assigned : [];
      const historyRows = Array.isArray(cached.history) ? cached.history : [];
      const existing =
        assignedRows.find((row) => row?.mission_order_id === missionOrderId) ||
        historyRows.find((row) => row?.mission_order_id === missionOrderId) ||
        null;

      const completedRow = {
        ...(existing || {}),
        mission_order_id: missionOrderId,
        mission_order_title: existing?.mission_order_title || missionOrder?.title || null,
        mission_order_updated_at: completedAt,
        date_of_inspection: existing?.date_of_inspection || missionOrder?.date_of_inspection || null,
        complaint_id: existing?.complaint_id || missionOrder?.complaint_id || complaint?.id || null,
        business_name: ownerDetails.businessName || complaint?.business_name || existing?.business_name || '',
        business_address: businessDetails.address || complaint?.business_address || existing?.business_address || '',
        complaint_status: 'completed',
        inspection_report_id: inspectionReportId,
        inspection_status: 'completed',
        inspection_completed_at: completedAt,
        inspection_owner_id: currentInspectorId || existing?.inspection_owner_id || null,
        inspection_owned_by_current_user: true,
        offline_prepared: true,
        offline_sync_pending: true,
      };

      const nextAssigned = assignedRows.filter((row) => row?.mission_order_id !== missionOrderId);
      const nextHistory = [
        completedRow,
        ...historyRows.filter((row) => row?.mission_order_id !== missionOrderId),
      ];

      localStorage.setItem(
        'inspekto.inspectorDashboardCache',
        JSON.stringify({
          ...cached,
          assigned: nextAssigned,
          history: nextHistory,
          savedAt: new Date().toISOString(),
        })
      );
    } catch {
      // Dashboard cache updates are best-effort.
    }
  };

  const handleSubmitReport = async () => {
    if (isCompleted) {
      setError('This inspection report is already completed and can no longer be submitted.');
      return;
    }
    if (inspectionLocked) {
      setError(inspectionLockMessage);
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
      if (!String(ownerDetails.fullName || '').trim()) missing.push('Owner Full Name');
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

    if (!String(complianceStatus || '').trim()) missing.push('Compliance Status');

    // Checklist items must be answered
    if (!checklist.business_permit) missing.push('Business Permit (Presented) status');
    if (!checklist.with_cctv) missing.push('With CCTV status');
    if (!checklist.signage_2sqm) missing.push('Business Signage status');

    // CCTV count required when compliant
    if (checklist.with_cctv === 'compliant') {
      const n = Number(String(cctvCount || '').trim());
      if (!Number.isFinite(n) || n <= 0) missing.push('No. of CCTVs');
    }

    // Signage area required when compliant
    if (checklist.signage_2sqm === 'compliant') {
      const n = Number(String(signage_sqm || '').trim());
      if (!Number.isFinite(n) || n <= 0) missing.push('Signage Area (sqm)');
    }

    // Signatures required
    if (!inspectorSignature) missing.push('Inspector Signature');
    if (!ownerSignature) missing.push('Business Owner Signature');

    const detailsTabMissing =
      !String(ownerDetails.businessName || '').trim() ||
      !String(businessDetails.address || '').trim();

    const inspectionTabMissing =
      inspectorLocation.lat == null ||
      inspectorLocation.lng == null ||
      !Array.isArray(evidencePhotos) ||
      evidencePhotos.length === 0 ||
      !checklist.business_permit ||
      !checklist.with_cctv ||
      !checklist.signage_2sqm ||
      !inspectorSignature ||
      !ownerSignature ||
      (checklist.with_cctv === 'compliant' && (!Number.isFinite(Number(String(cctvCount || '').trim())) || Number(String(cctvCount || '').trim()) <= 0)) ||
      (checklist.signage_2sqm === 'compliant' &&
        (!Number.isFinite(Number(String(signage_sqm || '').trim())) || Number(String(signage_sqm || '').trim()) <= 0));

    if (missing.length) {
      setError(`Cannot submit. Please complete the required fields: ${missing.join(', ')}`);
      if (detailsTabMissing) {
        setActiveTab('inspection_details');
      } else if (inspectionTabMissing) {
        setActiveTab('inspection');
      }
      return;
    }

    if (navigator.onLine === false) {
      setSaving(true);
      setError('');
      try {
        const completedAt = new Date().toISOString();
        const draft = await buildOfflineDraft({ syncStatus: 'ready_to_sync', completedAt });
        await enqueueInspectionSync({ action: 'submit', draft });
        await refreshPendingSyncCount();
        setToast('Inspection report queued. It will sync when this tablet is online.');
        setIsCompleted(true);
        setCompletionKnown(true);
        setInspectionStarted(true);
        setActiveTab('inspection_details');
        markInspectionCompleteInDashboardCache(completedAt);
        try {
          sessionStorage.setItem('inspectionSource', 'inspection-history');
        } catch {
          // ignore
        }
        window.location.assign('/dashboard/inspector?tab=history');
      } catch (e) {
        setError(e?.message || 'Failed to queue inspection report for offline sync.');
      } finally {
        setSaving(false);
      }
      return;
    }

    setSaving(true);
    setError('');

    try {
      // Save first to ensure uploads happen
      await handleSaveReport();

      const completedAt = new Date().toISOString();

      const { error: subErr } = await supabase
        .from('inspection_reports')
        .update({
          status: 'completed',
          completed_at: completedAt,
          updated_at: completedAt,
        })
        .eq('mission_order_id', missionOrderId);

      if (subErr) throw subErr;

      const complaintId = missionOrder?.complaint_id || complaint?.id || null;
      if (complaintId) {
        const { error: complaintUpdateErr } = await supabase
          .from('complaints')
          .update({
            status: 'completed',
            updated_at: completedAt,
          })
          .eq('id', complaintId);

        if (complaintUpdateErr) throw complaintUpdateErr;

        setComplaint((prev) => (prev?.id === complaintId ? { ...prev, status: 'completed', updated_at: completedAt } : prev));
      }

      const { error: missionOrderUpdateErr } = await supabase
        .from('mission_orders')
        .update({
          status: 'complete',
          updated_at: completedAt,
        })
        .eq('id', missionOrderId);

      if (missionOrderUpdateErr) throw missionOrderUpdateErr;

      setMissionOrder((prev) => (prev ? { ...prev, status: 'complete', updated_at: completedAt } : prev));

      setToast('Inspection report submitted and complaint tracking marked complete.');
      setIsCompleted(true);
      setCompletionKnown(true);
      setInspectionStarted(true);
      setActiveTab('inspection_details');
      window.location.assign('/dashboard/inspector?tab=history');
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
      if (navigator.onLine === false) {
        const matches = await searchOfflineBusinesses(q, 5);
        setBusinessResult({ matches });
        if (matches.length === 0) {
          setToast('No prepared offline business match found on this device.');
        } else {
          setToast('Showing prepared offline business matches.');
        }
        return;
      }

      const matches = [];
      const seenBusinessKeys = new Set();
      const addMatches = (rows) => {
        for (const item of rows || []) {
          const key = String(item?.business_pk || item?.bin || item?.epermit_no || `${item?.business_name || ''}|${item?.business_address || ''}`);
          if (seenBusinessKeys.has(key)) continue;
          seenBusinessKeys.add(key);
          matches.push(item);
        }
      };

      for (const column of ['bin', 'epermit_no', 'business_name']) {
        const { data: rows, error: qError } = await supabase
          .from('businesses')
          .select('*')
          .ilike(column, `%${q}%`)
          .limit(5);

        if (qError) throw qError;
        addMatches(rows);
        if (matches.length >= 5) break;
      }

      const data = matches.slice(0, 5);
      setBusinessResult({ matches: data });
      if (data?.length) {
        const bins = Array.from(new Set(data.map((item) => item?.bin).filter(Boolean)));
        const names = Array.from(new Set(data.map((item) => item?.business_name).filter(Boolean)));
        let additional = [];

        if (bins.length) {
          const { data: addRows, error: addErr } = await supabase
            .from('businesses_additional')
            .select('*')
            .in('bin', bins);
          if (!addErr) additional = addRows || [];
        }

        if (additional.length === 0 && names.length) {
          const { data: addRows, error: addErr } = await supabase
            .from('businesses_additional')
            .select('*')
            .in('business_name', names);
          if (!addErr) additional = addRows || [];
        }

        await saveOfflineBusinessRecords({ businesses: data, additional });
      }
      if (!data || data.length === 0) setToast('No matching business permit found.');
    } catch (e) {
      setError(e?.message || 'Failed to validate business permit.');
    } finally {
      setCheckingBusiness(false);
    }
  };

  const handleStartInspection = async () => {
    if (isCompleted) {
      setActiveTab('inspection_details');
      return;
    }

    if (inspectionLocked) {
      setError(inspectionLockMessage);
      setActiveTab('inspection_details');
      return;
    }

    if (inspectionStarted && inspectionReportId) {
      setActiveTab('inspection');
      return;
    }

    if (!missionOrderId) {
      setError('Missing mission order. Please reopen the inspection slip.');
      return;
    }

    if (navigator.onLine === false) {
      try {
        const draft = await getInspectionDraft(missionOrderId);
        if (!draft) {
          setError('This inspection slip was not prepared for offline use on this device.');
          return;
        }
        applyOfflineDraft(draft);
        setCompletionKnown(true);
        setInspectionStarted(true);
        setActiveTab('inspection');
        setToast('Offline inspection started. Updates will be saved on this device.');
      } catch (e) {
        setError(e?.message || 'Failed to start this offline inspection.');
      }
      return;
    }

    setError('');
    setSaving(true);

    try {
      let inspectorId = currentInspectorId;
      if (!inspectorId) {
        const user = await getCachedSessionUser();
        inspectorId = user?.id || null;
        if (inspectorId) setCurrentInspectorId(inspectorId);
      }

      if (!inspectorId) {
        throw new Error('Not authenticated. Please login again.');
      }

      const { data: assignmentRows, error: assignmentErr } = await supabase
        .from('mission_order_assignments')
        .select('mission_order_id')
        .eq('mission_order_id', missionOrderId)
        .eq('inspector_id', inspectorId)
        .limit(1);

      if (assignmentErr) throw assignmentErr;
      if (!assignmentRows || assignmentRows.length === 0) {
        throw new Error('You are not assigned to this mission order.');
      }

      const { data: claimedReport, error: claimErr } = await supabase.rpc('claim_mission_order_inspection_report', {
        p_mission_order_id: missionOrderId,
      });

      if (claimErr) throw claimErr;

      setInspectionReportId(claimedReport?.id || null);
      setInspectionOwnerId(inspectorId);
      setInspectionOwnerName((prev) => prev || 'You');
      setCompletionKnown(true);
      setInspectionStarted(true);
      setActiveTab('inspection');
    } catch (e) {
      setError(e?.message || 'Failed to start inspection.');
    } finally {
      setSaving(false);
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
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
              }}
            >
              <img
                src="/X icon.png"
                alt="Close"
                style={{
                  width: 14,
                  height: 14,
                  filter: 'brightness(0) invert(1)',
                }}
              />
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

      {showSoftCopyFullView && signedAttachmentUrl ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Soft-copy mission order full view"
          onClick={() => setShowSoftCopyFullView(false)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setShowSoftCopyFullView(false);
          }}
          tabIndex={-1}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(2,6,23,0.78)',
            zIndex: 9998,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 18,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 'min(1100px, 100%)',
              height: 'min(92vh, 100%)',
              background: '#2f2f2f',
              borderRadius: 16,
              boxShadow: '0 18px 46px rgba(0,0,0,0.35)',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                padding: '14px 16px',
                borderBottom: '1px solid rgba(255,255,255,0.12)',
                background: 'linear-gradient(90deg, #1e3a8a 0%, #0b2249 100%)',
              }}
          >
            <div>
              <div style={{ fontWeight: 900, color: '#ffffff' }}>Soft-Copy Mission Order</div>
            </div>
            <button
              type="button"
              className="mo-btn mo-btn-secondary"
              onClick={() => setShowSoftCopyFullView(false)}
              style={{
                background: 'rgba(255,255,255,0.14)',
                color: '#ffffff',
                border: '1px solid rgba(255,255,255,0.24)',
                boxShadow: 'none',
              }}
            >
              Close
            </button>
            </div>

            <div style={{ flex: 1, background: signedAttachmentIsPdf ? '#2f2f2f' : '#0b1220' }}>
              {signedAttachmentIsPdf ? (
                <iframe
                  title="Soft-Copy Mission Order Full View"
                  src={signedAttachmentUrl}
                  style={{ width: '100%', height: '100%', border: 0, display: 'block' }}
                />
              ) : (
                <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
                  <img
                    src={signedAttachmentUrl}
                    alt="Soft-Copy Mission Order Full View"
                    style={{
                      maxWidth: '100%',
                      maxHeight: '100%',
                      objectFit: 'contain',
                      display: 'block',
                      borderRadius: 10,
                      background: '#0b1220',
                    }}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      <Header />
      <main className="mo-main">
        <section className="mo-card is-portrait-shell">
          <div className="mo-header">
            <div className="mo-title-wrap">
              <div className="mo-label">Inspection Slip</div>
            </div>

            <div className="mo-actions">
              <a className="mo-link" href={backHref}>
                Back
              </a>
            </div>
          </div>

          {toast ? <div className="mo-alert mo-alert-success">{toast}</div> : null}
          {error ? <div className="mo-alert mo-alert-error">{error}</div> : null}
          {inspectionLockMessage ? <div className="mo-alert mo-alert-error">{inspectionLockMessage}</div> : null}
          {(!isOnline || pendingSyncCount > 0 || syncingOffline) ? (
            <div className={`is-offline-banner ${isOnline ? 'is-online' : 'is-offline'}`}>
              <div>
                <div className="is-offline-title">
                  {isOnline ? (syncingOffline ? 'Syncing offline inspections' : 'Offline updates pending') : 'Offline mode'}
                </div>
                <div className="is-offline-copy">
                  {isOnline
                    ? pendingSyncCount > 0
                      ? `${pendingSyncCount} inspection update${pendingSyncCount === 1 ? '' : 's'} waiting to sync.`
                      : 'Checking queued inspection updates.'
                    : 'This tablet can save inspection work locally. Queued updates sync when connection returns.'}
                </div>
              </div>
              {isOnline && pendingSyncCount > 0 ? (
                <button
                  type="button"
                  className="mo-btn mo-btn-secondary"
                  onClick={runOfflineSync}
                  disabled={syncingOffline}
                >
                  {syncingOffline ? 'Syncing...' : 'Sync now'}
                </button>
              ) : null}
            </div>
          ) : null}

          {!missionOrderId ? (
            <div className="mo-meta">Open this page as /inspection-slip/create?missionOrderId=&lt;uuid&gt;</div>
          ) : loading ? (
            <div className="mo-meta">Loading…</div>
          ) : !missionOrder ? (
            <div className="mo-meta">Cannot create inspection slip.</div>
          ) : (
            <div style={{ display: 'grid', gap: 14, marginTop: 14 }}>
              {inspectionStarted || isCompleted ? (
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
                    {!isCompleted && !inspectionLocked ? (
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
                    {summaryUnlocked ? (
                      <button
                        type="button"
                        role="tab"
                        aria-selected={activeTab === 'summary'}
                        className={activeTab === 'summary' ? 'active' : ''}
                        onClick={() => setActiveTab('summary')}
                      >
                        Inspection Summary
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}

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
                    <div
                      className="is-section-head"
                      style={{
                        background: 'linear-gradient(90deg, #1e3a8a 0%, #0b2249 100%)',
                        color: '#ffffff',
                        margin: '-16px -16px 0',
                        padding: '18px 18px 20px',
                        borderRadius: '14px 14px 0 0',
                        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08)',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'flex-start',
                          justifyContent: 'space-between',
                          gap: 14,
                          flexWrap: 'wrap',
                          width: '100%',
                        }}
                      >
                        <div style={{ minWidth: 0, flex: '1 1 320px' }}>
                          <div
                            style={{
                              fontSize: 17,
                              lineHeight: 1.18,
                              fontWeight: 900,
                              color: '#ffffff',
                              textTransform: 'uppercase',
                              wordBreak: 'break-word',
                              letterSpacing: '0.01em',
                            }}
                          >
                            {displayBusinessName}
                          </div>
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 8,
                              marginTop: 8,
                              color: 'rgba(255,255,255,0.96)',
                              fontWeight: 800,
                              fontSize: 12,
                              lineHeight: 1.4,
                            }}
                          >
                            <span aria-hidden="true" style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center' }}>
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path
                                  d="M12 21s7-4.35 7-11a7 7 0 1 0-14 0c0 6.65 7 11 7 11Z"
                                  fill="rgba(255,255,255,0.92)"
                                />
                                <circle cx="12" cy="10" r="2.7" fill="#1f3b7a" />
                              </svg>
                            </span>
                            <span>{displayBusinessAddress}</span>
                          </div>
                        </div>

                        {inspectionStarted || isCompleted ? (
                          <div style={{ marginLeft: 'auto', display: 'flex', justifyContent: 'flex-end', whiteSpace: 'nowrap' }}>
                            <span
                              style={{
                                ...statusBadgeStyle(inspectionStatusValue),
                                padding: '6px 12px',
                                fontSize: 12,
                                fontWeight: 900,
                                border: '1px solid rgba(255,255,255,0.18)',
                                boxShadow: '0 6px 18px rgba(15,23,42,0.14)',
                              }}
                            >
                              {inspectionStatusLabel}
                            </span>
                          </div>
                        ) : null}
                      </div>
                    </div>

                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr',
                        gap: 14,
                        alignItems: 'stretch',
                        marginTop: 16,
                      }}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
                        <div className="is-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
                          <OverviewField label="Assigned Inspectors" fullWidth>
                            {assignedInspectors.length ? (
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                {assignedInspectors.map((name) => (
                                  <span
                                    key={name}
                                    style={{
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      minHeight: 34,
                                      padding: '6px 12px',
                                      borderRadius: 999,
                                      border: '1px solid #dbe5f3',
                                      background: '#ffffff',
                                      color: '#0f172a',
                                      fontWeight: 900,
                                      fontSize: 13,
                                      boxShadow: '0 2px 8px rgba(15, 23, 42, 0.05)',
                                    }}
                                  >
                                    {name}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              '—'
                            )}
                          </OverviewField>

                          <OverviewField label="Complaint Date">
                            {formatDateHuman(complaint?.created_at)}
                          </OverviewField>

                          <OverviewField label="Issuance Date">
                            {formatDateHuman(missionOrder?.date_of_issuance)}
                          </OverviewField>

                          <OverviewField label="Inspection Date">
                            {formatDateHuman(missionOrder?.date_of_inspection)}
                          </OverviewField>

                          <OverviewField label="City Ordinances Violated" fullWidth>
                            {complaintViolationGroups.length ? (
                              <div style={{ display: 'grid', gap: 10 }}>
                                {complaintViolationGroups.map((group) => (
                                  <div
                                    key={group.category}
                                    style={{
                                      border: '1px solid #dbe5f3',
                                      borderRadius: 12,
                                      background: '#ffffff',
                                      padding: 12,
                                      boxShadow: '0 2px 8px rgba(15, 23, 42, 0.05)',
                                    }}
                                  >
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                      <span style={{ color: '#0f172a', fontWeight: 900, fontSize: 12 }}>
                                        {group.category}
                                      </span>
                                      <span
                                        style={{
                                          display: 'inline-flex',
                                          alignItems: 'center',
                                          justifyContent: 'center',
                                          minWidth: 20,
                                          height: 20,
                                          padding: '0 6px',
                                          borderRadius: 999,
                                          background: '#e2e8f0',
                                          color: '#334155',
                                          fontSize: 11,
                                          fontWeight: 1000,
                                        }}
                                      >
                                        {Array.isArray(group.subs) ? group.subs.length : 0}
                                      </span>
                                    </div>

                                    {Array.isArray(group.subs) && group.subs.length ? (
                                      <div style={{ display: 'grid', gap: 6, marginTop: 10 }}>
                                        {group.subs.map((sub) => (
                                          <div
                                            key={`${group.category}-${sub}`}
                                            style={{
                                              display: 'flex',
                                              alignItems: 'flex-start',
                                              gap: 8,
                                              color: '#334155',
                                              fontSize: 12,
                                              lineHeight: 1.45,
                                              fontWeight: 700,
                                            }}
                                          >
                                            <span
                                              aria-hidden="true"
                                              style={{
                                                width: 6,
                                                height: 6,
                                                borderRadius: '50%',
                                                background: '#64748b',
                                                marginTop: 6,
                                                flexShrink: 0,
                                              }}
                                            />
                                            <span>{sub}</span>
                                          </div>
                                        ))}
                                      </div>
                                    ) : null}
                                  </div>
                                ))}
                              </div>
                            ) : (
                              '—'
                            )}
                          </OverviewField>
                        </div>

                        <div className="is-card" style={{ marginTop: 0, display: 'flex', flexDirection: 'column' }}>
                          <div className="is-section-head">
                            <div>
                              <p className="is-section-title">MAP PREVIEW</p>
                              <p className="is-section-sub">Approximate location of the reported business address</p>
                            </div>
                          </div>

                          {!isOnline ? (
                            <div className="mo-meta" style={{ marginTop: 12 }}>
                              Map preview is unavailable offline. Address: {displayBusinessAddress}
                            </div>
                          ) : !mapUrl ? (
                            <div className="mo-meta">No address available for map preview.</div>
                          ) : (
                            <div
                              style={{
                                borderRadius: 12,
                                overflow: 'hidden',
                                border: '1px solid #e2e8f0',
                                background: '#fff',
                                display: 'flex',
                                marginTop: 12,
                              }}
                            >
                              <iframe
                                title="Business Location"
                                src={mapUrl}
                                width="100%"
                                height="100%"
                                style={{ border: 0, display: 'block', flex: 1, minHeight: 380 }}
                                loading="lazy"
                                referrerPolicy="no-referrer-when-downgrade"
                              />
                            </div>
                          )}
                        </div>
                      </div>

                      <div style={{ minWidth: 0, display: 'flex' }}>
                        <div className="is-card" style={{ marginTop: 0, display: 'flex', flexDirection: 'column', flex: 1 }}>
                          <div className="is-section-head">
                            <div>
                              <p className="is-section-title">SOFT-COPY MISSION ORDER</p>
                            </div>
                            {signedAttachmentUrl ? (
                              <button
                                type="button"
                                className="mo-btn mo-btn-secondary"
                                onClick={() => setShowSoftCopyFullView(true)}
                                style={{
                                  whiteSpace: 'nowrap',
                                  background: 'linear-gradient(90deg, #1e3a8a 0%, #0b2249 100%)',
                                  color: '#ffffff',
                                  border: 'none',
                                  boxShadow: '0 8px 18px rgba(15,23,42,0.12)',
                                  fontWeight: 900,
                                }}
                              >
                                Full View
                              </button>
                            ) : null}
                          </div>

                          <div
                            style={{
                              marginTop: 12,
                              border: '1px solid #e2e8f0',
                              borderRadius: 12,
                              background: '#ffffff',
                              overflow: 'hidden',
                              display: 'flex',
                              flexDirection: 'column',
                              flex: 1,
                            }}
                          >
                            {!signedAttachmentUrl ? (
                              <div className="mo-meta" style={{ padding: 12, flex: 1 }}>
                                No signed attachment uploaded yet.
                              </div>
                            ) : signedAttachmentIsPdf ? (
                              <iframe
                                title="Signed Attachment (PDF)"
                                src={signedAttachmentUrl}
                                style={{ width: '100%', height: '100%', minHeight: 380, border: 0, display: 'block', flex: 1 }}
                              />
                            ) : (
                              <div style={{ padding: 12, background: '#0b1220', flex: 1, display: 'flex', alignItems: 'center' }}>
                                <img
                                  src={signedAttachmentUrl}
                                  alt="Signed Attachment"
                                  style={{
                                    width: '100%',
                                    height: '100%',
                                    maxHeight: '100%',
                                    objectFit: 'contain',
                                    display: 'block',
                                    borderRadius: 10,
                                    background: '#0b1220',
                                  }}
                                />
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    {!isCompleted && !inspectionStarted ? (
                      <div style={{ marginTop: 16, display: 'flex', justifyContent: 'center' }}>
                        <button
                          type="button"
                          className="mo-btn mo-btn-primary"
                          onClick={handleStartInspection}
                          disabled={saving || loading}
                          style={{
                            width: 'min(100%, 280px)',
                            minHeight: 52,
                            borderRadius: 14,
                            background: 'linear-gradient(90deg, #1e3a8a 0%, #0b2249 100%)',
                            color: '#ffffff',
                            border: 'none',
                            fontWeight: 1000,
                            fontSize: 15,
                            justifyContent: 'center',
                            boxShadow: '0 10px 24px rgba(15,23,42,0.16)',
                          }}
                        >
                          {saving ? 'Starting…' : 'Start Inspection'}
                        </button>
                      </div>
                    ) : null}
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
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                          <button
                            type="button"
                            className="mo-btn mo-btn-primary"
                            onClick={requestInspectorLocation}
                            disabled={locationBusy || isCompleted}
                            title="Capture current device location"
                            style={{
                              minHeight: 46,
                              borderRadius: 12,
                              background: 'linear-gradient(90deg, #1e3a8a 0%, #0b2249 100%)',
                              color: '#ffffff',
                              border: 'none',
                              fontWeight: 900,
                              boxShadow: '0 8px 18px rgba(15,23,42,0.12)',
                            }}
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

                        {inspectorLocation.lat != null && inspectorLocation.lng != null && !isOnline ? (
                          <div className="mo-meta" style={{ marginTop: 10 }}>
                            Map tiles are unavailable offline. Captured coordinates: {inspectorLocation.lat}, {inspectorLocation.lng}
                          </div>
                        ) : inspectorLocation.lat != null && inspectorLocation.lng != null ? (
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
                            <div style={{ position: 'relative', zIndex: 1, height: '100%', width: '100%' }}>
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
                          onClick={() => handleSelectOwnerType('sole')}
                          aria-pressed={ownerType === 'sole'}
                          title="Sole Proprietor will autofill owner name fields when available"
                        >
                          Sole Proprietor
                        </button>
                        <button
                          type="button"
                          className={ownerType === 'corp' ? 'active' : ''}
                          onClick={() => handleSelectOwnerType('corp')}
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
                            className="mo-btn mo-btn-primary"
                        onClick={handleCheckBusiness}
                        disabled={checkingBusiness}
                        style={{
                          minHeight: 46,
                          borderRadius: 12,
                          background: 'linear-gradient(90deg, #1e3a8a 0%, #0b2249 100%)',
                          color: '#ffffff',
                          border: 'none',
                          fontWeight: 900,
                          boxShadow: '0 8px 18px rgba(15,23,42,0.12)',
                        }}
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
                          Can be multiple lines. Autofilled when available; editable anytime.
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
                      <div className="is-field" style={{ gridColumn: '1 / -1' }}>
                        <label>Owner Full Name</label>
                        <input
                          className="is-input"
                          value={ownerDetails.fullName}
                          onChange={(e) => setOwnerDetails((prev) => ({ ...prev, fullName: e.target.value }))}
                          placeholder="Enter full name"
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
                          onChange={(e) => {
                            setBusinessDetails((prev) => ({ ...prev, address: e.target.value }));
                          }}
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
                        <p className="is-section-sub">Use Compliant or Non-Compliant per item.</p>
                      </div>
                    </div>

                    <div style={{ display: 'grid', gap: 10 }}>
                      {[
                        { key: 'business_permit', label: 'Business Permit (Presented)' },
                        { key: 'with_cctv', label: 'With CCTV' },
                        { key: 'signage_2sqm', label: 'Business Signage' },
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
                                    if (item.key === 'signage_2sqm' && opt.v !== 'compliant') {
                                      setSignageSqm('');
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

                            {item.key === 'signage_2sqm' && checklist.signage_2sqm === 'compliant' ? (
                              <div className="is-field" style={{ margin: 0, width: 220 }}>
                                <label style={{ fontSize: 12 }}>Signage Area (sqm)</label>
                                <input
                                  className="is-input"
                                  type="text"
                                  inputMode="decimal"
                                  value={signage_sqm}
                                  onChange={(e) => {
                                    // Allow positive numbers and decimals
                                    const next = String(e.target.value || '').replace(/[^0-9.]/g, '');
                                    // Prevent multiple decimal points
                                    const parts = next.split('.');
                                    if (parts.length > 2) {
                                      return;
                                    }
                                    setSignageSqm(next);
                                  }}
                                  onKeyDown={(e) => {
                                    // Block common non-numeric characters
                                    if (['e', 'E', '+', '-'].includes(e.key)) {
                                      e.preventDefault();
                                    }
                                  }}
                                  placeholder="Enter area in sqm"
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
                      <div>
                        <div>
                          <p className="is-section-title">Step 6: Additional Observations</p>
                          <p className="is-section-sub">Choose the inspection result, then add any optional notes or recommendations.</p>
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        {!cameraOpen ? (
                          <button
                            type="button"
                            className="mo-btn mo-btn-primary"
                            onClick={openCameraFlow}
                            disabled={cameraBusy}
                            title="Open Camera"
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 8,
                              minHeight: 46,
                              borderRadius: 12,
                              background: 'linear-gradient(90deg, #1e3a8a 0%, #0b2249 100%)',
                              color: '#ffffff',
                              border: 'none',
                              fontWeight: 900,
                              boxShadow: '0 8px 18px rgba(15,23,42,0.12)',
                            }}
                          >
                            <img
                              src="/ui_icons/camera.png"
                              alt="Camera"
                              style={{
                                width: 18,
                                height: 18,
                                display: 'block',
                                filter: 'brightness(0) invert(1)',
                                flexShrink: 0,
                              }}
                            />
                            {cameraBusy ? 'Opening…' : 'Open Camera'}
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="mo-btn mo-btn-primary"
                            onClick={closeCamera}
                            disabled={cameraBusy}
                            title="Close Camera"
                            style={{
                              minHeight: 46,
                              borderRadius: 12,
                              background: 'linear-gradient(90deg, #1e3a8a 0%, #0b2249 100%)',
                              color: '#ffffff',
                              border: 'none',
                              fontWeight: 900,
                              boxShadow: '0 8px 18px rgba(15,23,42,0.12)',
                            }}
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
                          borderRadius: 12,
                          overflow: 'hidden',
                          background: '#0b1220',
                          position: 'relative',
                          marginBottom: 10,
                        }}
                      >
                        <div className="is-camera-shell">
                          <div className="is-camera-preview">
                            <video ref={videoRef} playsInline muted autoPlay className="is-camera-video" />

                            <button
                              type="button"
                              onClick={captureFromCamera}
                              disabled={cameraBusy}
                              className="is-camera-shutter"
                              aria-label="Capture photo"
                            >
                              <img
                                src="/ui_icons/camera.png"
                                alt="Capture"
                                style={{ width: 18, height: 18, display: 'block', filter: 'invert(1) brightness(2) contrast(100%)' }}
                              />
                            </button>
                          </div>
                        </div>

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
                              style={{
                                width: 40,
                                height: 40,
                                borderRadius: 999,
                                padding: 0,
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                background: '#2563eb',
                                border: 'none',
                                boxShadow: '0 6px 16px rgba(0,0,0,0.22)',
                              }}
                              aria-label="Capture Photo"
                            >
                              <img
                                src="/ui_icons/camera.png"
                                alt="Capture"
                                style={{ width: 18, height: 18, display: 'block', filter: 'invert(1) brightness(2) contrast(100%)' }}
                              />
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
                              title={p.ts ? formatPhotoTimestamp(p.ts) : ''}
                            >
                              {p.ts ? formatPhotoTimestamp(p.ts) : ''}
                            </div>

                            <XIconButton
                              size="sm"
                              label="Remove evidence photo"
                              title="Remove"
                              onClick={() => removeEvidencePhoto(idx)}
                              style={{
                                position: 'absolute',
                                top: 6,
                                right: 6,
                                zIndex: 2,
                              }}
                            />
                          </div>
                        ))}
                      </div>
                    ) : null}

                      <div style={{ display: 'grid', gap: 10 }}>
                        <div style={{ display: 'grid', gap: 8 }}>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }} role="group" aria-label="Compliance status">
                          {COMPLIANCE_OPTIONS.map((option) => (
                          <button
                            key={option}
                            type="button"
                            className={complianceStatus === option ? 'mo-btn mo-btn-primary mo-btn--sm' : 'mo-btn mo-btn-secondary mo-btn--sm'}
                            onClick={() => {
                              setComplianceStatus(option);
                              setAdditionalComments((prev) => upsertComplianceTag(option, prev));
                            }}
                            aria-pressed={complianceStatus === option}
                            title={`Set compliance status to ${option}`}
                            style={{
                              borderRadius: 999,
                              padding: '8px 14px',
                              fontWeight: 800,
                              fontSize: 12,
                              lineHeight: '16px',
                            }}
                          >
                            {option}
                          </button>
                        ))}
                        </div>
                      </div>

                      {inspectionViolationFindings.length ? (
                        <div className="is-violation-findings-card">
                          <div className="is-violation-findings-head">
                            <div className="is-violation-findings-title">Reported Violations</div>
                          </div>

                          <div className="is-violation-findings-list">
                            {inspectionViolationFindings.map((item) => {
                              const selectedStatus = getViolationFindingStatus(additionalComments, item.ordinanceLabel);

                              return (
                                <div key={item.key} className="is-violation-findings-row">
                                  <div className="is-violation-findings-copy">
                                    <div className="is-violation-findings-name">{item.ordinanceLabel}</div>
                                    <div className="is-violation-findings-meta">{item.subcategory}</div>
                                  </div>

                                  <div className="is-violation-findings-actions" role="group" aria-label={`Violation finding for ${item.ordinanceLabel}`}>
                                    {VIOLATION_FINDING_OPTIONS.map((option) => (
                                      <button
                                        key={option.key}
                                        type="button"
                                        className={selectedStatus === option.key ? 'mo-btn mo-btn-primary mo-btn--sm' : 'mo-btn mo-btn-secondary mo-btn--sm'}
                                        onClick={() => applyViolationFinding(item.ordinanceLabel, option.key)}
                                        aria-pressed={selectedStatus === option.key}
                                        style={{
                                          borderRadius: 999,
                                          padding: '8px 14px',
                                          fontWeight: 800,
                                          fontSize: 12,
                                          lineHeight: '16px',
                                          whiteSpace: 'nowrap',
                                        }}
                                      >
                                        {option.label}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ) : null}

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
                          ref={commentsTextareaRef}
                          value={additionalComments}
                          onChange={(e) => setAdditionalComments(String(e.target.value || ''))}
                          rows={7}
                          placeholder="Type any specific findings or recommendations here…"
                          style={{
                            width: '100%',
                            border: '1px solid #cbd5e1',
                            borderRadius: 10,
                            padding: 12,
                            background: '#fff',
                            color: '#0f172a',
                            fontFamily: 'inherit',
                            fontSize: 14,
                            fontWeight: 400,
                            lineHeight: 1.6,
                            outline: 'none',
                            resize: 'vertical',
                            minHeight: 168,
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
                          {String(additionalComments || '').length} characters
                        </div>
                      </div>
                    </div>
                  </div>

                  {!summaryUnlocked ? (
                    <div style={{ display: 'flex', justifyContent: 'center', marginTop: 2 }}>
                      <button
                        type="button"
                        className="mo-btn mo-btn-primary"
                        onClick={() => {
                          setSummaryUnlocked(true);
                          setActiveTab('summary');
                        }}
                        style={{
                          width: 'min(100%, 280px)',
                          minHeight: 52,
                          borderRadius: 14,
                          background: 'linear-gradient(90deg, #1e3a8a 0%, #0b2249 100%)',
                          color: '#ffffff',
                          border: 'none',
                          fontWeight: 1000,
                          fontSize: 15,
                          justifyContent: 'center',
                          boxShadow: '0 10px 24px rgba(15,23,42,0.16)',
                        }}
                      >
                        View Summary
                      </button>
                    </div>
                  ) : null}

                                  </>
              ) : activeTab === 'summary' ? (
                <>
                  <div className="is-card">
                    <div className="is-section-head">
                      <div>
                        <p className="is-section-title">Inspection Summary</p>
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
                          {toOwnerNameString() || '--'}
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
                      </div>
                    </div>

                    <div style={{ display: 'grid', gap: 10 }}>
                      {[
                        { key: 'business_permit', label: 'Business Permit (Presented)' },
                        { key: 'with_cctv', label: 'With CCTV' },
                        { key: 'signage_2sqm', label: 'Business Signage' },
                      ].map((item) => {
                        const v = checklist[item.key];
                        const text =
                          v === 'compliant'
                            ? 'Compliant'
                            : v === 'non_compliant'
                              ? 'Non-Compliant'
                              : 'Not selected';

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
                              {item.key === 'signage_2sqm' && v === 'compliant' ? (
                                <span style={{ marginLeft: 8, fontWeight: 900, color: '#0f172a' }}>
                                  ({signage_sqm ? `${signage_sqm} sqm` : 'Signage area not set'})
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
                      </div>
                    </div>

                    <div className="is-field" style={{ marginTop: 4 }}>
                      <label>Compliance Status</label>
                      <div style={{ fontWeight: 800, color: '#0f172a' }}>
                        {complianceStatus || '—'}
                      </div>
                    </div>

                    <div className="is-field" style={{ marginTop: 12 }}>
                      <label>Remarks</label>
                      <div style={{ fontWeight: 800, color: '#0f172a', whiteSpace: 'pre-wrap' }}>
                        {additionalComments?.trim() ? additionalComments : '—'}
                      </div>
                      <div style={{ marginTop: 6, fontSize: 12, fontWeight: 800, color: '#94a3b8' }}>
                        {String(additionalComments || '').length} characters
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
                                title={p.ts ? formatPhotoTimestamp(p.ts) : ''}
                              >
                                {p.ts ? formatPhotoTimestamp(p.ts) : ''}
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

                  {completionKnown && !isCompleted ? (
                    <div style={{ display: 'flex', justifyContent: 'center', marginTop: 6 }}>
                      <button
                        type="button"
                        className="mo-btn mo-btn-primary"
                        onClick={handleSubmitReport}
                        disabled={saving || loading || !inspectionReportId || inspectionLocked}
                        title="Submit as Completed"
                        style={{
                          width: 'min(100%, 320px)',
                          minHeight: 56,
                          borderRadius: 16,
                          background: 'linear-gradient(90deg, #1e3a8a 0%, #0b2249 100%)',
                          color: '#ffffff',
                          border: 'none',
                          fontWeight: 1000,
                          fontSize: 16,
                          justifyContent: 'center',
                          boxShadow: '0 12px 28px rgba(15,23,42,0.18)',
                        }}
                      >
                        {saving ? 'Submitting…' : 'Submit Inspection'}
                      </button>
                    </div>
                  ) : null}

                </>
              ) : null}
            </div>
          )}
        </section>
      </main>
      <Footer />
    </div>
  );
}
