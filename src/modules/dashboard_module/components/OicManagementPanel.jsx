import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../../lib/supabase';

const SIGNATURE_BUCKET = 'signatory-signatures';

const CARD_STYLE = {
  border: '1px solid #e2e8f0',
  borderRadius: 12,
  background: '#ffffff',
  boxShadow: '0 4px 14px rgba(15, 23, 42, 0.05)',
};

const CONTROL_STYLE = {
  border: '1px solid #cbd5e1',
  borderRadius: 10,
};

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

function toLocalInput(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function profileName(profile, fallback = '-') {
  return profile?.full_name
    || [profile?.first_name, profile?.middle_name, profile?.last_name].filter(Boolean).join(' ')
    || fallback;
}

function initials(value) {
  return String(value || '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('') || 'OIC';
}

function statusLabel(status) {
  const labels = {
    open: 'Open',
    assigned: 'OIC Assigned',
    cancelled: 'Cancelled',
    expired: 'Expired',
    pending_director: 'Director Approval',
    pending_head_inspector: 'Special Approval',
    approved: 'Active / Approved',
    rejected: 'Rejected',
  };
  return labels[status] || String(status || 'pending').replace(/_/g, ' ');
}

function StatusPill({ status }) {
  const tone = status === 'approved'
    ? { bg: '#dcfce7', fg: '#166534', border: '#bbf7d0' }
    : status === 'rejected'
      ? { bg: '#fee2e2', fg: '#991b1b', border: '#fecaca' }
      : { bg: '#fef3c7', fg: '#854d0e', border: '#fde68a' };

  return (
    <span style={{ display: 'inline-flex', width: 'fit-content', padding: '4px 10px', borderRadius: 999, border: `1px solid ${tone.border}`, background: tone.bg, color: tone.fg, fontSize: 12, fontWeight: 900 }}>
      {statusLabel(status)}
    </span>
  );
}

function PeriodStatusPill({ status }) {
  const tones = {
    open: { label: 'No OIC Assigned Yet', bg: '#dbeafe', fg: '#1d4ed8', border: '#bfdbfe' },
    assigned: { label: 'OIC Assigned', bg: '#dcfce7', fg: '#166534', border: '#bbf7d0' },
    expired: { label: 'Expired', bg: '#f1f5f9', fg: '#64748b', border: '#e2e8f0' },
    cancelled: { label: 'Cancelled', bg: '#fee2e2', fg: '#991b1b', border: '#fecaca' },
  };
  const tone = tones[status] || { label: statusLabel(status), bg: '#f8fafc', fg: '#475569', border: '#e2e8f0' };
  return <span style={{ display: 'inline-flex', width: 'fit-content', padding: '4px 9px', borderRadius: 999, border: `1px solid ${tone.border}`, background: tone.bg, color: tone.fg, fontSize: 10, fontWeight: 900, textTransform: 'uppercase' }}>{tone.label}</span>;
}

function FieldLabel({ children }) {
  return <span style={{ color: '#475569', fontSize: 11, fontWeight: 900, textTransform: 'uppercase' }}>{children}</span>;
}

function SignatureCanvas({ value, onChange, footerAction = null }) {
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(rect.width * ratio));
    canvas.height = Math.max(1, Math.round(rect.height * ratio));
    const context = canvas.getContext('2d');
    context.scale(ratio, ratio);
    context.lineWidth = 2.4;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.strokeStyle = '#0f172a';

    if (value) {
      const image = new Image();
      image.onload = () => context.drawImage(image, 0, 0, rect.width, rect.height);
      image.src = value;
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const point = (event) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const begin = (event) => {
    event.preventDefault();
    drawingRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    const context = canvasRef.current.getContext('2d');
    const next = point(event);
    context.beginPath();
    context.moveTo(next.x, next.y);
  };

  const move = (event) => {
    if (!drawingRef.current) return;
    event.preventDefault();
    const context = canvasRef.current.getContext('2d');
    const next = point(event);
    context.lineTo(next.x, next.y);
    context.stroke();
  };

  const end = () => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    onChange(canvasRef.current.toDataURL('image/png'));
  };

  const clear = () => {
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');
    context.clearRect(0, 0, canvas.width, canvas.height);
    onChange('');
  };

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <canvas
        ref={canvasRef}
        aria-label="Optional Director signature canvas"
        onPointerDown={begin}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        style={{ width: '100%', height: 150, border: '1px solid #94a3b8', borderRadius: 10, background: '#ffffff', touchAction: 'none', cursor: 'crosshair' }}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ color: '#64748b', fontSize: 12, fontWeight: 700 }}>Optional: draw the Director confirmation signature.</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-secondary" onClick={clear} style={{ minHeight: 40 }}>Clear</button>
          {footerAction}
        </div>
      </div>
    </div>
  );
}

async function dataUrlToBlob(dataUrl) {
  const response = await fetch(dataUrl);
  return response.blob();
}

export default function OicManagementPanel({ mode = 'head_inspector' }) {
  const isDirector = mode === 'director';
  const [activeSignature, setActiveSignature] = useState(null);
  const [activePreview, setActivePreview] = useState('');
  const [unavailablePeriods, setUnavailablePeriods] = useState([]);
  const [requests, setRequests] = useState([]);
  const [profiles, setProfiles] = useState(new Map());
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [comments, setComments] = useState({});
  const [historySearch, setHistorySearch] = useState('');
  const [historyStatus, setHistoryStatus] = useState('all');
  const [historyPage, setHistoryPage] = useState(1);
  const [selectedHistoryRequest, setSelectedHistoryRequest] = useState(null);
  const [periodSearch, setPeriodSearch] = useState('');
  const [periodStatus, setPeriodStatus] = useState('all');
  const [periodPage, setPeriodPage] = useState(1);
  const [directorPeriodSignature, setDirectorPeriodSignature] = useState('');
  const [periodForm, setPeriodForm] = useState({
    start: toLocalInput(),
    end: '',
    reason: '',
  });
  const [form, setForm] = useState({
    changeType: 'temporary',
    unavailabilityPeriodId: '',
    name: '',
    title: 'Officer-in-Charge',
    reason: '',
    directorCannotApprove: false,
    specialJustification: '',
    file: null,
  });

  const directorQueue = useMemo(() => requests.filter((row) => row.status === 'pending_director'), [requests]);
  const finalQueue = useMemo(() => requests.filter((row) => row.status === 'pending_head_inspector'), [requests]);
  const openPeriods = useMemo(() => unavailablePeriods.filter((row) => row.status === 'open' && new Date(row.unavailable_end) > new Date()), [unavailablePeriods]);
  const periodMap = useMemo(() => new Map(unavailablePeriods.map((period) => [period.id, period])), [unavailablePeriods]);

  const loadSignedUrl = async (bucket, path, seconds = 600) => {
    if (!bucket || !path) return '';
    if (/^https?:\/\//i.test(path)) return path;
    const { data, error: signedError } = await supabase.storage.from(bucket).createSignedUrl(path, seconds);
    if (signedError) return '';
    return data?.signedUrl || '';
  };

  const loadData = async () => {
    setLoading(true);
    setError('');
    try {
      await supabase.rpc('expire_temporary_document_signature');
      const [{ data: activeRows, error: activeError }, { data: requestRows, error: requestError }, { data: periodRows, error: periodError }] = await Promise.all([
        supabase.rpc('get_active_document_signature'),
        supabase.from('oic_requests').select('*').order('requested_at', { ascending: false }).limit(100),
        supabase.from('director_unavailability_periods').select('*').order('unavailable_start', { ascending: false }).limit(100),
      ]);
      if (activeError) throw activeError;
      if (requestError) throw requestError;
      if (periodError) throw periodError;

      const active = Array.isArray(activeRows) ? activeRows[0] : activeRows;
      setActiveSignature(active || null);
      setActivePreview(active ? await loadSignedUrl(active.signature_bucket, active.signature_path) : '');
      setRequests(requestRows || []);
      setUnavailablePeriods(periodRows || []);

      const ids = Array.from(new Set([
        ...(requestRows || []).flatMap((row) => [row.requested_by, row.director_reviewed_by, row.final_reviewed_by]),
        ...(periodRows || []).map((row) => row.created_by),
      ].filter(Boolean)));
      if (ids.length) {
        const { data: profileRows, error: profileError } = await supabase
          .from('profiles')
          .select('id, full_name, first_name, middle_name, last_name')
          .in('id', ids);
        if (profileError) throw profileError;
        setProfiles(new Map((profileRows || []).map((profile) => [profile.id, profile])));
      } else {
        setProfiles(new Map());
      }
    } catch (err) {
      setError(err?.message || 'Failed to load OIC workflow. Confirm the migration has been applied.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const uploadFile = async ({ file, folder, fallbackName }) => {
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError) throw userError;
    const userId = userData?.user?.id;
    if (!userId) throw new Error('Not authenticated.');
    const extension = String(file?.type || '').includes('jpeg') ? 'jpg' : 'png';
    const path = `${folder}/${userId}/${Date.now()}-${fallbackName}.${extension}`;
    const { error: uploadError } = await supabase.storage.from(SIGNATURE_BUCKET).upload(path, file, {
      contentType: file.type || 'image/png', cacheControl: '0', upsert: false,
    });
    if (uploadError) throw uploadError;
    return path;
  };

  const declareUnavailablePeriod = async () => {
    if (!periodForm.start || !periodForm.end || periodForm.reason.trim().length < 5) {
      setError('Complete the unavailable start, end, and reason fields.');
      return;
    }

    setBusy('declare-period');
    setError('');
    setToast('');
    try {
      let confirmationPath = null;
      if (directorPeriodSignature) {
        const blob = await dataUrlToBlob(directorPeriodSignature);
        confirmationPath = await uploadFile({ file: blob, folder: 'availability-confirmations', fallbackName: 'director-unavailable-confirmation' });
      }

      const { error: rpcError } = await supabase.rpc('declare_director_unavailability', {
        p_unavailable_start: new Date(periodForm.start).toISOString(),
        p_unavailable_end: new Date(periodForm.end).toISOString(),
        p_reason: periodForm.reason.trim(),
        p_confirmation_bucket: confirmationPath ? SIGNATURE_BUCKET : null,
        p_confirmation_path: confirmationPath,
      });
      if (rpcError) throw rpcError;
      setToast('Unavailable period recorded for Head Inspector OIC assignment.');
      setPeriodForm({ start: toLocalInput(), end: '', reason: '' });
      setDirectorPeriodSignature('');
      await loadData();
    } catch (err) {
      setError(err?.message || 'Failed to declare unavailable period.');
    } finally {
      setBusy('');
    }
  };

  const submitRequest = async () => {
    if (!form.file || !form.name.trim() || !form.title.trim() || form.reason.trim().length < 5) {
      setError('Complete the signatory, signature file, and reason fields.');
      return;
    }
    if (form.changeType === 'temporary' && !form.unavailabilityPeriodId) {
      setError('Select a Director-declared unavailable period for temporary OIC assignment.');
      return;
    }
    if (form.directorCannotApprove && form.specialJustification.trim().length < 5) {
      setError('Provide a justification when using Head Inspector special approval.');
      return;
    }

    setBusy('submit');
    setError('');
    setToast('');
    try {
      const signaturePath = await uploadFile({ file: form.file, folder: 'proposed', fallbackName: 'oic-signature' });
      const { error: rpcError } = await supabase.rpc('request_oic_assignment', {
        p_change_type: form.changeType,
        p_signatory_name: form.name.trim(),
        p_signatory_title: form.title.trim(),
        p_signature_bucket: SIGNATURE_BUCKET,
        p_signature_path: signaturePath,
        p_reason: form.reason.trim(),
        p_validity_start: null,
        p_validity_end: null,
        p_unavailability_period_id: form.changeType === 'temporary' ? form.unavailabilityPeriodId : null,
        p_director_cannot_approve: form.directorCannotApprove,
        p_special_justification: form.directorCannotApprove ? form.specialJustification.trim() : null,
      });
      if (rpcError) throw rpcError;
      setToast(form.directorCannotApprove
        ? 'OIC request sent for Head Inspector special approval.'
        : 'OIC request sent to the Director for approval.');
      setForm({ changeType: 'temporary', unavailabilityPeriodId: '', name: '', title: 'Officer-in-Charge', reason: '', directorCannotApprove: false, specialJustification: '', file: null });
      await loadData();
    } catch (err) {
      setError(err?.message || 'Failed to submit OIC request.');
    } finally {
      setBusy('');
    }
  };

  const directorReview = async (request, decision) => {
    setBusy(`${decision}-${request.id}`);
    setError('');
    setToast('');
    try {
      const { error: rpcError } = await supabase.rpc('director_review_oic_request', {
        p_request_id: request.id,
        p_decision: decision,
        p_comment: comments[request.id] || null,
        p_confirmation_bucket: null,
        p_confirmation_path: null,
      });
      if (rpcError) throw rpcError;
      setToast(decision === 'approved' ? 'OIC assignment activated for new documents.' : 'OIC request rejected.');
      await loadData();
    } catch (err) {
      setError(err?.message || 'Failed to review OIC request.');
    } finally {
      setBusy('');
    }
  };

  const finalReview = async (request, decision) => {
    setBusy(`${decision}-${request.id}`);
    setError('');
    setToast('');
    try {
      const { error: rpcError } = await supabase.rpc('finalize_oic_request', {
        p_request_id: request.id,
        p_decision: decision,
        p_comment: comments[request.id] || null,
      });
      if (rpcError) throw rpcError;
      setToast(decision === 'approved' ? 'Special OIC approval activated for new documents.' : 'OIC request rejected.');
      await loadData();
    } catch (err) {
      setError(err?.message || 'Failed to finalize OIC request.');
    } finally {
      setBusy('');
    }
  };

  const RequestDetails = ({ request }) => (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div>
          <div style={{ color: '#64748b', fontSize: 11, fontWeight: 900, textTransform: 'uppercase' }}>{request.change_type} assignment</div>
          <div style={{ color: '#0f172a', fontSize: 20, fontWeight: 1000 }}>{request.proposed_signatory_name}</div>
          <div style={{ color: '#475569', fontWeight: 800 }}>{request.proposed_signatory_title}</div>
        </div>
        <StatusPill status={request.status} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
        <div style={{ padding: 11, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10 }}><FieldLabel>Requested By</FieldLabel><div style={{ marginTop: 5, fontWeight: 900 }}>{profileName(profiles.get(request.requested_by), String(request.requested_by || '').slice(0, 8))}</div></div>
        <div style={{ padding: 11, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10 }}><FieldLabel>Requested At</FieldLabel><div style={{ marginTop: 5, fontWeight: 900 }}>{formatDate(request.requested_at)}</div></div>
        <div style={{ padding: 11, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10 }}><FieldLabel>Validity</FieldLabel><div style={{ marginTop: 5, fontWeight: 900 }}>{request.validity_start && request.validity_end ? `${formatDate(request.validity_start)} to ${formatDate(request.validity_end)}` : '-'}</div></div>
      </div>
      <div style={{ padding: 12, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, color: '#334155', lineHeight: 1.5 }}>
        <div><strong>Reason:</strong> {request.reason}</div>
        {request.unavailability_period_id ? <div style={{ marginTop: 6, color: '#991b1b' }}><strong>Director declared unavailable:</strong> {formatDate(periodMap.get(request.unavailability_period_id)?.unavailable_start)} to {formatDate(periodMap.get(request.unavailability_period_id)?.unavailable_end)}. {periodMap.get(request.unavailability_period_id)?.reason}</div> : null}
        {request.director_unavailable ? <div style={{ marginTop: 6, color: '#854d0e' }}><strong>Special approval justification:</strong> {request.director_unavailable_justification}</div> : null}
        {request.director_reviewed_at ? <div style={{ marginTop: 6 }}><strong>Director approval:</strong> {formatDate(request.director_reviewed_at)}{request.director_confirmation_path ? ' (signed)' : ' (no signature applied)'}</div> : null}
      </div>
    </div>
  );

  const queue = isDirector ? directorQueue : finalQueue;
  const historyPageSize = 5;
  const filteredHistory = useMemo(() => {
    const query = historySearch.trim().toLowerCase();
    return requests.filter((request) => {
      const requester = profileName(profiles.get(request.requested_by), '');
      const matchesSearch = !query || [
        request.proposed_signatory_name,
        request.proposed_signatory_title,
        requester,
        request.id,
      ].some((value) => String(value || '').toLowerCase().includes(query));
      const matchesStatus = historyStatus === 'all' || request.status === historyStatus;
      return matchesSearch && matchesStatus;
    });
  }, [historySearch, historyStatus, profiles, requests]);
  const historyPageCount = Math.max(1, Math.ceil(filteredHistory.length / historyPageSize));
  const safeHistoryPage = Math.min(historyPage, historyPageCount);
  const visibleHistory = filteredHistory.slice((safeHistoryPage - 1) * historyPageSize, safeHistoryPage * historyPageSize);
  const periodPageSize = 5;
  const filteredPeriods = useMemo(() => {
    const query = periodSearch.trim().toLowerCase();
    return unavailablePeriods.filter((period) => {
      const declarer = profileName(profiles.get(period.created_by), '');
      const matchesSearch = !query || [period.reason, declarer, period.id].some((value) => String(value || '').toLowerCase().includes(query));
      const matchesStatus = periodStatus === 'all' || period.status === periodStatus;
      return matchesSearch && matchesStatus;
    });
  }, [periodSearch, periodStatus, profiles, unavailablePeriods]);
  const periodPageCount = Math.max(1, Math.ceil(filteredPeriods.length / periodPageSize));
  const safePeriodPage = Math.min(periodPage, periodPageCount);
  const visiblePeriods = filteredPeriods.slice((safePeriodPage - 1) * periodPageSize, safePeriodPage * periodPageSize);

  const DirectorApprovalCard = ({ request }) => {
    const period = periodMap.get(request.unavailability_period_id);

    return (
      <article style={{ ...CARD_STYLE, overflow: 'hidden' }}>
        <div className="oic-approval-summary" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', columnGap: 0, rowGap: 18, padding: 18, alignItems: 'start' }}>
          <div style={{ display: 'flex', gap: 14, alignItems: 'center', minWidth: 0, gridColumn: 1, gridRow: 1, padding: '4px 24px 0 4px' }}>
            <div aria-hidden="true" style={{ width: 50, height: 50, flex: '0 0 50px', borderRadius: '50%', display: 'grid', placeItems: 'center', background: '#e8efff', color: '#2254d8', fontSize: 17, fontWeight: 900 }}>
              {initials(request.proposed_signatory_name)}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ color: '#0f172a', fontSize: 17, fontWeight: 900, lineHeight: 1.25 }}>{request.proposed_signatory_name}</div>
              <div style={{ marginTop: 3, color: '#64748b', fontSize: 13, fontWeight: 700 }}>{request.proposed_signatory_title}</div>
              <div style={{ marginTop: 8, color: '#475569', fontSize: 12, fontWeight: 700 }}>
                {request.validity_start && request.validity_end ? `${formatDate(request.validity_start)} – ${formatDate(request.validity_end)}` : 'Validity not specified'}
              </div>
            </div>
          </div>

          <div style={{ minWidth: 0, gridColumn: 1, gridRow: 2, padding: '0 24px 4px 4px' }}>
            <FieldLabel>Assignment Reason</FieldLabel>
            <p style={{ margin: '7px 0 0', color: '#334155', fontSize: 14, lineHeight: 1.55, fontWeight: 600 }}>{request.reason}</p>
            {period ? (
              <div style={{ marginTop: 9, color: '#64748b', fontSize: 12, lineHeight: 1.45 }}>
                Director unavailable: {formatDate(period.unavailable_start)} – {formatDate(period.unavailable_end)}
              </div>
            ) : null}
          </div>

          <div className="oic-approval-actions" style={{ display: 'grid', gap: 10, alignSelf: 'stretch', gridColumn: 2, gridRow: '1 / span 2', padding: '4px 0 4px 24px', borderLeft: '1px solid #e2e8f0' }}>
            <label style={{ display: 'grid', gap: 7 }}>
              <FieldLabel>Director's Remarks</FieldLabel>
              <textarea rows={2} value={comments[request.id] || ''} onChange={(event) => setComments((current) => ({ ...current, [request.id]: event.target.value }))} placeholder="Enter notes..." style={{ ...CONTROL_STYLE, minHeight: 58, padding: 10, resize: 'vertical', background: '#ffffff' }} />
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 9 }}>
              <button type="button" className="btn btn-primary" disabled={Boolean(busy)} onClick={() => directorReview(request, 'approved')} style={{ minHeight: 38, width: '100%' }}>Approve</button>
              <button type="button" className="btn btn-secondary" disabled={Boolean(busy)} onClick={() => directorReview(request, 'rejected')} style={{ minHeight: 38, width: '100%' }}>Reject</button>
            </div>
          </div>
        </div>
      </article>
    );
  };

  const HeadInspectorApprovalCard = ({ request }) => (
    <article style={{ ...CARD_STYLE, overflow: 'hidden' }}>
      <div className="oic-approval-summary" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', padding: 18, alignItems: 'stretch' }}>
        <div className="oic-approval-overview" style={{ minWidth: 0, padding: '4px 24px 4px 4px' }}>
          <div className="oic-approval-identity" style={{ display: 'flex', gap: 14, alignItems: 'center', minWidth: 0 }}>
            <div aria-hidden="true" style={{ width: 48, height: 48, flex: '0 0 48px', borderRadius: '50%', display: 'grid', placeItems: 'center', background: '#e8efff', color: '#2254d8', fontSize: 16, fontWeight: 900 }}>
              {initials(request.proposed_signatory_name)}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ color: '#0f172a', fontSize: 17, fontWeight: 900, lineHeight: 1.25 }}>{request.proposed_signatory_name}</div>
              <div style={{ marginTop: 3, color: '#64748b', fontSize: 13, fontWeight: 700 }}>{request.proposed_signatory_title}</div>
              <div style={{ marginTop: 8, color: '#64748b', fontSize: 12, fontWeight: 700 }}>
                {request.validity_start && request.validity_end ? `${formatDate(request.validity_start)} to ${formatDate(request.validity_end)}` : 'Validity not specified'}
              </div>
            </div>
          </div>

          <div className="oic-approval-reason" style={{ minWidth: 0, marginTop: 18 }}>
            <FieldLabel>Assignment Reason</FieldLabel>
            <p style={{ margin: '7px 0 0', color: '#334155', fontSize: 14, lineHeight: 1.5, fontWeight: 600 }}>{request.reason}</p>
          </div>
        </div>

        <div className="oic-approval-actions" style={{ display: 'grid', gap: 10, alignSelf: 'stretch', padding: '4px 0 4px 24px', borderLeft: '1px solid #e2e8f0' }}>
          <label style={{ display: 'grid', gap: 7 }}>
            <FieldLabel>Head Inspector's Remarks</FieldLabel>
            <textarea
              rows={2}
              value={comments[request.id] || ''}
              onChange={(event) => setComments((current) => ({ ...current, [request.id]: event.target.value }))}
              placeholder="Enter notes..."
              style={{ ...CONTROL_STYLE, minHeight: 58, padding: 10, resize: 'vertical', background: '#ffffff' }}
            />
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 9 }}>
            <button type="button" className="btn btn-primary" disabled={Boolean(busy)} onClick={() => finalReview(request, 'approved')} style={{ minHeight: 38, width: '100%' }}>Approve</button>
            <button type="button" className="btn btn-secondary" disabled={Boolean(busy)} onClick={() => finalReview(request, 'rejected')} style={{ minHeight: 38, width: '100%' }}>Reject</button>
          </div>
        </div>
      </div>
    </article>
  );

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {toast ? <div className="dash-alert dash-alert-success">{toast}</div> : null}
      {error ? <div className="dash-alert dash-alert-error">{error}</div> : null}

      <section style={{ ...CARD_STYLE, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(220px, 320px)', gap: 16, padding: 16, alignItems: 'center' }}>
          <div>
            <FieldLabel>Active Signatory For New Documents</FieldLabel>
            <div style={{ marginTop: 5, color: '#020617', fontSize: 22, fontWeight: 1000 }}>{activeSignature?.signatory_name || 'Not configured'}</div>
            <div style={{ color: '#475569', fontWeight: 800 }}>{activeSignature?.signatory_title || '-'}</div>
            {activeSignature?.active_until ? <div style={{ marginTop: 8, color: '#854d0e', fontSize: 12, fontWeight: 800 }}>Until {formatDate(activeSignature.active_until)}</div> : null}
          </div>
          <div style={{ minHeight: 100, border: '1px dashed #cbd5e1', borderRadius: 10, background: '#f8fafc', display: 'grid', placeItems: 'center', padding: 10 }}>
            {activePreview ? <img src={activePreview} alt="Active document signature" style={{ maxWidth: '100%', maxHeight: 90, objectFit: 'contain' }} /> : <span style={{ color: '#64748b', fontWeight: 800 }}>No preview</span>}
          </div>
        </div>
      </section>

      {isDirector ? (
        <section style={{ ...CARD_STYLE, padding: 18, display: 'grid', gap: 15 }}>
          <div><h3 style={{ margin: 0, color: '#0f172a', fontSize: 18 }}>Declare Unavailable Period</h3><p style={{ margin: '5px 0 0', color: '#64748b', fontSize: 13, fontWeight: 700 }}>These dates become selectable by the Head Inspector when assigning a temporary OIC.</p></div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 13 }}>
            <label style={{ display: 'grid', gap: 7 }}><FieldLabel>Start Date</FieldLabel><input type="datetime-local" value={periodForm.start} onChange={(e) => setPeriodForm((p) => ({ ...p, start: e.target.value }))} style={{ ...CONTROL_STYLE, minHeight: 42, padding: '0 10px' }} /></label>
            <label style={{ display: 'grid', gap: 7 }}><FieldLabel>End Date</FieldLabel><input type="datetime-local" value={periodForm.end} onChange={(e) => setPeriodForm((p) => ({ ...p, end: e.target.value }))} style={{ ...CONTROL_STYLE, minHeight: 42, padding: '0 10px' }} /></label>
          </div>
          <label style={{ display: 'grid', gap: 7 }}><FieldLabel>Reason</FieldLabel><textarea rows={3} value={periodForm.reason} onChange={(e) => setPeriodForm((p) => ({ ...p, reason: e.target.value }))} style={{ ...CONTROL_STYLE, padding: 11, resize: 'vertical', fontWeight: 700 }} /></label>
          <SignatureCanvas
            value={directorPeriodSignature}
            onChange={setDirectorPeriodSignature}
            footerAction={<button type="button" className="btn btn-primary" onClick={declareUnavailablePeriod} disabled={Boolean(busy)} style={{ minHeight: 40, minWidth: 190 }}>{busy === 'declare-period' ? 'Saving...' : 'Save Unavailable Period'}</button>}
          />
        </section>
      ) : null}

      {!isDirector ? (
        <section style={{ ...CARD_STYLE, padding: 18, display: 'grid', gap: 15 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}><div><h3 style={{ margin: 0, color: '#0f172a', fontSize: 18 }}>Prepare Temporary OIC Assignment</h3><p style={{ margin: '5px 0 0', color: '#64748b', fontSize: 13, fontWeight: 700 }}>Temporary OIC assignments must be tied to a Director-declared unavailable period.</p></div><span style={{ padding: '5px 9px', borderRadius: 999, background: '#e8efff', color: '#2254d8', fontSize: 10, fontWeight: 900, textTransform: 'uppercase' }}>Temporary OIC</span></div>
          <label style={{ display: 'grid', gap: 7 }}><FieldLabel>Select Open Unavailable Period</FieldLabel><select value={form.unavailabilityPeriodId} onChange={(e) => setForm((p) => ({ ...p, unavailabilityPeriodId: e.target.value }))} style={{ ...CONTROL_STYLE, minHeight: 42, padding: '0 10px', fontWeight: 800 }}><option value="">Choose a Director-declared absence...</option>{openPeriods.map((period) => <option key={period.id} value={period.id}>{formatDate(period.unavailable_start)} to {formatDate(period.unavailable_end)} - {period.reason}</option>)}</select>{!openPeriods.length ? <span style={{ color: '#991b1b', fontSize: 12, fontWeight: 800 }}>No open Director-declared unavailable periods yet.</span> : null}</label>
          <div className="oic-assignment-name-grid">
            <label style={{ display: 'grid', gap: 7 }}><FieldLabel>OIC Name</FieldLabel><input value={form.name} placeholder="Enter OIC name..." onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} style={{ ...CONTROL_STYLE, minHeight: 42, padding: '0 10px', fontWeight: 800 }} /></label>
            <label style={{ display: 'grid', gap: 7 }}><FieldLabel>OIC Title</FieldLabel><input value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} style={{ ...CONTROL_STYLE, minHeight: 42, padding: '0 10px', fontWeight: 800 }} /></label>
          </div>
          <label className="oic-signature-upload">
            <FieldLabel>OIC Signature Image</FieldLabel>
            <span className="oic-signature-dropzone"><strong>{form.file ? form.file.name : 'Click to upload the OIC digital signature'}</strong><small>PNG, JPG, or WEBP</small></span>
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setForm((p) => ({ ...p, file: e.target.files?.[0] || null }))} />
          </label>
          <label style={{ display: 'grid', gap: 7 }}><FieldLabel>Assignment Reason</FieldLabel><textarea rows={3} value={form.reason} placeholder="Describe the purpose and scope of this delegation..." onChange={(e) => setForm((p) => ({ ...p, reason: e.target.value }))} style={{ ...CONTROL_STYLE, padding: 11, resize: 'vertical', fontWeight: 700 }} /></label>
          <div style={{ padding: 13, background: '#f8fafc', border: '1px solid #dbe3ef', borderRadius: 10, display: 'grid', gap: 9 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 9, color: '#0f172a', fontWeight: 900 }}>
              <input type="checkbox" checked={form.directorCannotApprove} onChange={(e) => setForm((p) => ({ ...p, directorCannotApprove: e.target.checked }))} />
              Director cannot approve this OIC request; use Head Inspector special approval.
            </label>
            <div style={{ color: '#64748b', fontSize: 12, fontWeight: 700 }}>{form.directorCannotApprove ? 'This request will stay with Head Inspector for special approval.' : 'This request will be routed to Director for final approval and activation.'}</div>
            {form.directorCannotApprove ? <label style={{ display: 'grid', gap: 7 }}><FieldLabel>Special Approval Justification</FieldLabel><textarea rows={3} value={form.specialJustification} onChange={(e) => setForm((p) => ({ ...p, specialJustification: e.target.value }))} style={{ ...CONTROL_STYLE, padding: 11, resize: 'vertical' }} /></label> : null}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button type="button" className="btn btn-primary" onClick={submitRequest} disabled={Boolean(busy)} style={{ minHeight: 40, minWidth: 190 }}>{busy === 'submit' ? 'Submitting...' : 'Submit OIC Assignment'}</button></div>
        </section>
      ) : null}

      <section style={{ display: 'grid', gap: 12, padding: isDirector ? 16 : 0, border: isDirector ? '1px solid #e2e8f0' : 'none', borderRadius: isDirector ? 14 : 0, background: isDirector ? '#f8fafc' : 'transparent' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0, color: '#0f172a', fontSize: 18 }}>{isDirector ? 'Approval Inbox' : 'Pending Head Inspector Special Approval'}</h3>
            {isDirector && directorQueue.length ? <span style={{ padding: '4px 9px', borderRadius: 999, background: '#e8efff', color: '#2254d8', fontSize: 11, fontWeight: 900, textTransform: 'uppercase' }}>{directorQueue.length} pending</span> : null}
          </div>
          <button type="button" className="btn btn-secondary" onClick={loadData} disabled={loading}>Refresh</button>
        </div>
        {loading && !queue.length ? <div style={{ padding: 28, textAlign: 'center', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12 }}>Loading...</div> : !queue.length ? <div style={{ padding: 28, textAlign: 'center', color: '#64748b', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12 }}>No pending requests.</div> : queue.map((request) => (
          isDirector ? <DirectorApprovalCard key={request.id} request={request} /> : <HeadInspectorApprovalCard key={request.id} request={request} />
        ))}
      </section>

      <section style={{ ...CARD_STYLE, padding: 16, display: 'grid', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <h3 style={{ margin: 0, color: '#0f172a', fontSize: 18 }}>Director Unavailable Periods</h3>
          <span style={{ padding: '4px 8px', borderRadius: 999, background: '#f1f5f9', color: '#64748b', fontSize: 10, fontWeight: 900, textTransform: 'uppercase' }}>{unavailablePeriods.length} total</span>
        </div>
        <div className="oic-history-toolbar">
          <input type="search" value={periodSearch} onChange={(event) => { setPeriodSearch(event.target.value); setPeriodPage(1); }} placeholder="Search periods by reason, declarer, or ID..." aria-label="Search Director unavailable periods" style={{ ...CONTROL_STYLE, minHeight: 40, padding: '0 12px', width: '100%' }} />
          <select value={periodStatus} onChange={(event) => { setPeriodStatus(event.target.value); setPeriodPage(1); }} aria-label="Filter unavailable periods by status" style={{ ...CONTROL_STYLE, minHeight: 40, padding: '0 10px', background: '#ffffff', fontWeight: 700 }}>
            <option value="all">All statuses</option><option value="open">No OIC assigned yet</option><option value="assigned">OIC assigned</option><option value="expired">Expired</option><option value="cancelled">Cancelled</option>
          </select>
        </div>
        <div className="oic-history-table-wrap">
          <table className="oic-history-table oic-period-table">
            <thead><tr><th>Date Range</th><th>Reason</th><th>Declared By</th><th>Status</th></tr></thead>
            <tbody>
              {!visiblePeriods.length ? <tr><td colSpan={4} className="oic-history-empty">No matching unavailable periods.</td></tr> : visiblePeriods.map((period) => (
                <tr key={`period-row-${period.id}`}>
                  <td><strong>{formatDate(period.unavailable_start)}</strong><span>to {formatDate(period.unavailable_end)}</span></td>
                  <td><strong>{period.reason}</strong></td>
                  <td><strong>{profileName(profiles.get(period.created_by), String(period.created_by || '').slice(0, 8))}</strong><span>Director</span></td>
                  <td><PeriodStatusPill status={period.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="oic-history-pagination">
          <span>Showing {filteredPeriods.length ? ((safePeriodPage - 1) * periodPageSize) + 1 : 0}–{Math.min(safePeriodPage * periodPageSize, filteredPeriods.length)} of {filteredPeriods.length} periods</span>
          <div><button type="button" disabled={safePeriodPage <= 1} onClick={() => setPeriodPage((page) => Math.max(1, page - 1))}>Prev</button><span>Page {safePeriodPage} of {periodPageCount}</span><button type="button" disabled={safePeriodPage >= periodPageCount} onClick={() => setPeriodPage((page) => Math.min(periodPageCount, page + 1))}>Next</button></div>
        </div>
      </section>

      <section style={{ ...CARD_STYLE, padding: 16, display: 'grid', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <h3 style={{ margin: 0, color: '#0f172a', fontSize: 18 }}>Request History</h3>
          <span style={{ padding: '4px 8px', borderRadius: 999, background: '#f1f5f9', color: '#64748b', fontSize: 10, fontWeight: 900, textTransform: 'uppercase' }}>{requests.length} records</span>
        </div>

        <div className="oic-history-toolbar">
          <input
            type="search"
            value={historySearch}
            onChange={(event) => { setHistorySearch(event.target.value); setHistoryPage(1); }}
            placeholder="Search by name, requester, or ID..."
            aria-label="Search OIC request history"
            style={{ ...CONTROL_STYLE, minHeight: 40, padding: '0 12px', width: '100%' }}
          />
          <select value={historyStatus} onChange={(event) => { setHistoryStatus(event.target.value); setHistoryPage(1); }} aria-label="Filter request history by status" style={{ ...CONTROL_STYLE, minHeight: 40, padding: '0 10px', background: '#ffffff', fontWeight: 700 }}>
            <option value="all">All statuses</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="pending_director">Director approval</option>
            <option value="pending_head_inspector">Special approval</option>
          </select>
        </div>

        <div className="oic-history-table-wrap">
          <table className="oic-history-table">
            <thead><tr><th>Candidate</th><th>Requested By</th><th>Validity Period</th><th>Status</th><th>Details</th></tr></thead>
            <tbody>
              {!visibleHistory.length ? <tr><td colSpan={5} className="oic-history-empty">No matching requests.</td></tr> : visibleHistory.map((request) => (
                <tr key={`history-row-${request.id}`}>
                  <td><strong>{request.proposed_signatory_name}</strong><span>{request.proposed_signatory_title}</span></td>
                  <td><strong>{profileName(profiles.get(request.requested_by), String(request.requested_by || '').slice(0, 8))}</strong><span>Requester</span></td>
                  <td><strong>{formatDate(request.validity_start)}</strong><span>to {formatDate(request.validity_end)}</span></td>
                  <td><StatusPill status={request.status} /></td>
                  <td><button type="button" className="oic-history-details" onClick={() => setSelectedHistoryRequest(request)}>View Details</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="oic-history-pagination">
          <span>Showing {filteredHistory.length ? ((safeHistoryPage - 1) * historyPageSize) + 1 : 0}–{Math.min(safeHistoryPage * historyPageSize, filteredHistory.length)} of {filteredHistory.length} records</span>
          <div>
            <button type="button" disabled={safeHistoryPage <= 1} onClick={() => setHistoryPage((page) => Math.max(1, page - 1))}>Prev</button>
            <span>Page {safeHistoryPage} of {historyPageCount}</span>
            <button type="button" disabled={safeHistoryPage >= historyPageCount} onClick={() => setHistoryPage((page) => Math.min(historyPageCount, page + 1))}>Next</button>
          </div>
        </div>
      </section>

      {selectedHistoryRequest ? (
        <div className="oic-history-drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedHistoryRequest(null); }}>
          <aside className="oic-history-drawer" role="dialog" aria-modal="true" aria-labelledby="oic-history-drawer-title">
            <div className="oic-history-drawer-header">
              <div className="oic-history-drawer-title"><span aria-hidden="true">▣</span><h3 id="oic-history-drawer-title">Request Details</h3></div>
              <button type="button" aria-label="Close request details" onClick={() => setSelectedHistoryRequest(null)}>×</button>
            </div>
            <div className="oic-history-drawer-body">
              <div className="oic-drawer-person">
                <div>{initials(selectedHistoryRequest.proposed_signatory_name)}</div>
                <span><strong>{selectedHistoryRequest.proposed_signatory_name}</strong><small>{selectedHistoryRequest.proposed_signatory_title}</small></span>
                <StatusPill status={selectedHistoryRequest.status} />
              </div>
              <div className="oic-drawer-grid">
                <div><FieldLabel>Assignment Type</FieldLabel><strong>{selectedHistoryRequest.change_type === 'temporary' ? 'Temporary OIC' : statusLabel(selectedHistoryRequest.change_type)}</strong></div>
                <div><FieldLabel>Requested By</FieldLabel><strong>{profileName(profiles.get(selectedHistoryRequest.requested_by), '-')}</strong></div>
              </div>
              <div>
                <FieldLabel>Date Range</FieldLabel>
                <div className="oic-drawer-dates">
                  <div><small>From</small><strong>{formatDate(selectedHistoryRequest.validity_start)}</strong></div>
                  <span aria-hidden="true">→</span>
                  <div><small>To</small><strong>{formatDate(selectedHistoryRequest.validity_end)}</strong></div>
                </div>
              </div>
              <div className="oic-drawer-section"><FieldLabel>Assignment Reason</FieldLabel><p>{selectedHistoryRequest.reason}</p></div>
              {selectedHistoryRequest.director_unavailable_justification ? <div className="oic-drawer-section"><FieldLabel>Special Approval Justification</FieldLabel><p>{selectedHistoryRequest.director_unavailable_justification}</p></div> : null}
              {selectedHistoryRequest.director_comment || selectedHistoryRequest.final_comment ? <div className="oic-drawer-section oic-drawer-remarks"><FieldLabel>Approval Remarks</FieldLabel><p>{selectedHistoryRequest.director_comment || selectedHistoryRequest.final_comment}</p></div> : null}
              <div className="oic-drawer-section">
                <FieldLabel>Audit Trail</FieldLabel>
                <div className="oic-audit-item"><span /> <p><strong>Requested</strong><small>{formatDate(selectedHistoryRequest.requested_at)}</small></p></div>
                {selectedHistoryRequest.director_reviewed_at ? <div className="oic-audit-item"><span /> <p><strong>Director reviewed</strong><small>{formatDate(selectedHistoryRequest.director_reviewed_at)}</small></p></div> : null}
                {selectedHistoryRequest.final_reviewed_at ? <div className="oic-audit-item"><span /> <p><strong>Head Inspector reviewed</strong><small>{formatDate(selectedHistoryRequest.final_reviewed_at)}</small></p></div> : null}
                {selectedHistoryRequest.implemented_at ? <div className="oic-audit-item"><span /> <p><strong>Assignment activated</strong><small>{formatDate(selectedHistoryRequest.implemented_at)}</small></p></div> : null}
              </div>
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
