import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../../lib/supabase';

const SIGNATURE_BUCKET = 'signatory-signatures';

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

function FieldLabel({ children }) {
  return <span style={{ color: '#475569', fontSize: 11, fontWeight: 900, textTransform: 'uppercase' }}>{children}</span>;
}

function SignatureCanvas({ value, onChange }) {
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
        style={{ width: '100%', height: 150, border: '1px solid #94a3b8', borderRadius: 4, background: '#ffffff', touchAction: 'none', cursor: 'crosshair' }}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ color: '#64748b', fontSize: 12, fontWeight: 700 }}>Optional: draw the Director confirmation signature.</span>
        <button type="button" className="btn btn-secondary" onClick={clear} style={{ minHeight: 32 }}>Clear</button>
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
  const [directorSignatures, setDirectorSignatures] = useState({});
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
      let confirmationPath = null;
      const dataUrl = directorSignatures[request.id];
      if (decision === 'approved' && dataUrl) {
        const blob = await dataUrlToBlob(dataUrl);
        confirmationPath = await uploadFile({ file: blob, folder: `confirmations/${request.id}`, fallbackName: 'director-confirmation' });
      }
      const { error: rpcError } = await supabase.rpc('director_review_oic_request', {
        p_request_id: request.id,
        p_decision: decision,
        p_comment: comments[request.id] || null,
        p_confirmation_bucket: confirmationPath ? SIGNATURE_BUCKET : null,
        p_confirmation_path: confirmationPath,
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
        <div style={{ padding: 11, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 4 }}><FieldLabel>Requested By</FieldLabel><div style={{ marginTop: 5, fontWeight: 900 }}>{profileName(profiles.get(request.requested_by), String(request.requested_by || '').slice(0, 8))}</div></div>
        <div style={{ padding: 11, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 4 }}><FieldLabel>Requested At</FieldLabel><div style={{ marginTop: 5, fontWeight: 900 }}>{formatDate(request.requested_at)}</div></div>
        <div style={{ padding: 11, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 4 }}><FieldLabel>Validity</FieldLabel><div style={{ marginTop: 5, fontWeight: 900 }}>{request.validity_start && request.validity_end ? `${formatDate(request.validity_start)} to ${formatDate(request.validity_end)}` : '-'}</div></div>
      </div>
      <div style={{ padding: 12, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 4, color: '#334155', lineHeight: 1.5 }}>
        <div><strong>Reason:</strong> {request.reason}</div>
        {request.unavailability_period_id ? <div style={{ marginTop: 6, color: '#991b1b' }}><strong>Director declared unavailable:</strong> {formatDate(periodMap.get(request.unavailability_period_id)?.unavailable_start)} to {formatDate(periodMap.get(request.unavailability_period_id)?.unavailable_end)}. {periodMap.get(request.unavailability_period_id)?.reason}</div> : null}
        {request.director_unavailable ? <div style={{ marginTop: 6, color: '#854d0e' }}><strong>Special approval justification:</strong> {request.director_unavailable_justification}</div> : null}
        {request.director_reviewed_at ? <div style={{ marginTop: 6 }}><strong>Director approval:</strong> {formatDate(request.director_reviewed_at)}{request.director_confirmation_path ? ' (signed)' : ' (no signature applied)'}</div> : null}
      </div>
    </div>
  );

  const queue = isDirector ? directorQueue : finalQueue;

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {toast ? <div className="dash-alert dash-alert-success">{toast}</div> : null}
      {error ? <div className="dash-alert dash-alert-error">{error}</div> : null}

      <section style={{ border: '1px solid #dbe3ef', borderRadius: 6, background: '#ffffff', overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(220px, 320px)', gap: 16, padding: 16, alignItems: 'center' }}>
          <div>
            <FieldLabel>Active Signatory For New Documents</FieldLabel>
            <div style={{ marginTop: 5, color: '#020617', fontSize: 22, fontWeight: 1000 }}>{activeSignature?.signatory_name || 'Not configured'}</div>
            <div style={{ color: '#475569', fontWeight: 800 }}>{activeSignature?.signatory_title || '-'}</div>
            {activeSignature?.active_until ? <div style={{ marginTop: 8, color: '#854d0e', fontSize: 12, fontWeight: 800 }}>Until {formatDate(activeSignature.active_until)}</div> : null}
          </div>
          <div style={{ minHeight: 100, border: '1px dashed #cbd5e1', borderRadius: 4, background: '#f8fafc', display: 'grid', placeItems: 'center', padding: 10 }}>
            {activePreview ? <img src={activePreview} alt="Active document signature" style={{ maxWidth: '100%', maxHeight: 90, objectFit: 'contain' }} /> : <span style={{ color: '#64748b', fontWeight: 800 }}>No preview</span>}
          </div>
        </div>
      </section>

      {isDirector ? (
        <section style={{ border: '1px solid #dbe3ef', borderRadius: 6, background: '#ffffff', padding: 18, display: 'grid', gap: 15 }}>
          <div><h3 style={{ margin: 0, color: '#0f172a', fontSize: 18 }}>Declare Unavailable Period</h3><p style={{ margin: '5px 0 0', color: '#64748b', fontSize: 13, fontWeight: 700 }}>These dates become selectable by the Head Inspector when assigning a temporary OIC.</p></div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 13 }}>
            <label style={{ display: 'grid', gap: 7 }}><FieldLabel>Unavailable Start</FieldLabel><input type="datetime-local" value={periodForm.start} onChange={(e) => setPeriodForm((p) => ({ ...p, start: e.target.value }))} style={{ minHeight: 42, border: '1px solid #cbd5e1', borderRadius: 4, padding: '0 10px' }} /></label>
            <label style={{ display: 'grid', gap: 7 }}><FieldLabel>Unavailable End</FieldLabel><input type="datetime-local" value={periodForm.end} onChange={(e) => setPeriodForm((p) => ({ ...p, end: e.target.value }))} style={{ minHeight: 42, border: '1px solid #cbd5e1', borderRadius: 4, padding: '0 10px' }} /></label>
          </div>
          <label style={{ display: 'grid', gap: 7 }}><FieldLabel>Reason</FieldLabel><textarea rows={3} value={periodForm.reason} onChange={(e) => setPeriodForm((p) => ({ ...p, reason: e.target.value }))} style={{ border: '1px solid #cbd5e1', borderRadius: 4, padding: 11, resize: 'vertical', fontWeight: 700 }} /></label>
          <SignatureCanvas value={directorPeriodSignature} onChange={setDirectorPeriodSignature} />
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button type="button" className="btn btn-primary" onClick={declareUnavailablePeriod} disabled={Boolean(busy)} style={{ minHeight: 40, minWidth: 190 }}>{busy === 'declare-period' ? 'Saving...' : 'Save Unavailable Period'}</button></div>
        </section>
      ) : null}

      {!isDirector ? (
        <section style={{ border: '1px solid #dbe3ef', borderRadius: 6, background: '#ffffff', padding: 18, display: 'grid', gap: 15 }}>
          <div><h3 style={{ margin: 0, color: '#0f172a', fontSize: 18 }}>Prepare Temporary OIC Assignment</h3><p style={{ margin: '5px 0 0', color: '#64748b', fontSize: 13, fontWeight: 700 }}>Temporary OIC assignments must be tied to a Director-declared unavailable period.</p></div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 13 }}>
            <div style={{ display: 'grid', gap: 7 }}><FieldLabel>Change Type</FieldLabel><div style={{ minHeight: 42, border: '1px solid #cbd5e1', borderRadius: 4, padding: '10px', fontWeight: 900, background: '#f8fafc' }}>Temporary OIC</div></div>
            <label style={{ display: 'grid', gap: 7 }}><FieldLabel>New Signatory Signature</FieldLabel><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setForm((p) => ({ ...p, file: e.target.files?.[0] || null }))} style={{ minHeight: 42, border: '1px solid #cbd5e1', borderRadius: 4, padding: 8 }} /></label>
            <label style={{ display: 'grid', gap: 7 }}><FieldLabel>Signatory Name</FieldLabel><input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} style={{ minHeight: 42, border: '1px solid #cbd5e1', borderRadius: 4, padding: '0 10px', fontWeight: 800 }} /></label>
            <label style={{ display: 'grid', gap: 7 }}><FieldLabel>Signatory Title</FieldLabel><input value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} style={{ minHeight: 42, border: '1px solid #cbd5e1', borderRadius: 4, padding: '0 10px', fontWeight: 800 }} /></label>
          </div>
          <label style={{ display: 'grid', gap: 7 }}><FieldLabel>Director-Declared Unavailable Period</FieldLabel><select value={form.unavailabilityPeriodId} onChange={(e) => setForm((p) => ({ ...p, unavailabilityPeriodId: e.target.value }))} style={{ minHeight: 42, border: '1px solid #cbd5e1', borderRadius: 4, padding: '0 10px', fontWeight: 800 }}><option value="">Select unavailable period</option>{openPeriods.map((period) => <option key={period.id} value={period.id}>{formatDate(period.unavailable_start)} to {formatDate(period.unavailable_end)} - {period.reason}</option>)}</select>{!openPeriods.length ? <span style={{ color: '#991b1b', fontSize: 12, fontWeight: 800 }}>No open Director-declared unavailable periods yet.</span> : null}</label>
          <label style={{ display: 'grid', gap: 7 }}><FieldLabel>Reason</FieldLabel><textarea rows={3} value={form.reason} onChange={(e) => setForm((p) => ({ ...p, reason: e.target.value }))} style={{ border: '1px solid #cbd5e1', borderRadius: 4, padding: 11, resize: 'vertical', fontWeight: 700 }} /></label>
          <div style={{ padding: 13, background: '#f8fafc', border: '1px solid #dbe3ef', borderRadius: 4, display: 'grid', gap: 9 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 9, color: '#0f172a', fontWeight: 900 }}>
              <input type="checkbox" checked={form.directorCannotApprove} onChange={(e) => setForm((p) => ({ ...p, directorCannotApprove: e.target.checked }))} />
              Director cannot approve this OIC request; use Head Inspector special approval.
            </label>
            <div style={{ color: '#64748b', fontSize: 12, fontWeight: 700 }}>{form.directorCannotApprove ? 'This request will stay with Head Inspector for special approval.' : 'This request will be routed to Director for final approval and activation.'}</div>
            {form.directorCannotApprove ? <label style={{ display: 'grid', gap: 7 }}><FieldLabel>Special Approval Justification</FieldLabel><textarea rows={3} value={form.specialJustification} onChange={(e) => setForm((p) => ({ ...p, specialJustification: e.target.value }))} style={{ border: '1px solid #cbd5e1', borderRadius: 4, padding: 11, resize: 'vertical' }} /></label> : null}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button type="button" className="btn btn-primary" onClick={submitRequest} disabled={Boolean(busy)} style={{ minHeight: 40, minWidth: 170 }}>{busy === 'submit' ? 'Submitting...' : 'Submit Request'}</button></div>
        </section>
      ) : null}

      <section style={{ display: 'grid', gap: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}><h3 style={{ margin: 0, color: '#0f172a', fontSize: 18 }}>{isDirector ? 'Pending Director Approval' : 'Pending Head Inspector Special Approval'}</h3><button type="button" className="btn btn-secondary" onClick={loadData} disabled={loading}>Refresh</button></div>
        {loading && !queue.length ? <div style={{ padding: 28, textAlign: 'center', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6 }}>Loading...</div> : !queue.length ? <div style={{ padding: 28, textAlign: 'center', color: '#64748b', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6 }}>No pending requests.</div> : queue.map((request) => (
          <article key={request.id} style={{ border: '1px solid #cbd5e1', borderRadius: 6, background: '#ffffff', padding: 16, display: 'grid', gap: 14 }}>
            <RequestDetails request={request} />
            {isDirector ? <SignatureCanvas value={directorSignatures[request.id] || ''} onChange={(value) => setDirectorSignatures((p) => ({ ...p, [request.id]: value }))} /> : null}
            <label style={{ display: 'grid', gap: 7 }}><FieldLabel>{isDirector ? 'Director Approval Notes' : 'Special Approval Notes'}</FieldLabel><textarea rows={3} value={comments[request.id] || ''} onChange={(e) => setComments((p) => ({ ...p, [request.id]: e.target.value }))} style={{ border: '1px solid #cbd5e1', borderRadius: 4, padding: 11, resize: 'vertical' }} /></label>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, flexWrap: 'wrap' }}><button type="button" className="btn btn-secondary" disabled={Boolean(busy)} onClick={() => (isDirector ? directorReview(request, 'rejected') : finalReview(request, 'rejected'))}>Reject</button><button type="button" className="btn btn-primary" disabled={Boolean(busy)} onClick={() => (isDirector ? directorReview(request, 'approved') : finalReview(request, 'approved'))}>Approve and Activate</button></div>
          </article>
        ))}
      </section>

      <section style={{ display: 'grid', gap: 10 }}><h3 style={{ margin: 0, color: '#0f172a', fontSize: 18 }}>Director Unavailable Periods</h3>{!unavailablePeriods.length ? <div style={{ padding: 24, color: '#64748b', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6 }}>No unavailable periods yet.</div> : unavailablePeriods.map((period) => <article key={`period-${period.id}`} style={{ border: '1px solid #e2e8f0', borderRadius: 6, background: '#ffffff', padding: 14, display: 'grid', gap: 8 }}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}><div><div style={{ fontWeight: 1000, color: '#0f172a' }}>{formatDate(period.unavailable_start)} to {formatDate(period.unavailable_end)}</div><div style={{ color: '#475569', fontWeight: 700 }}>{period.reason}</div><div style={{ color: '#64748b', fontSize: 12, fontWeight: 800 }}>Declared by {profileName(profiles.get(period.created_by), String(period.created_by || '').slice(0, 8))}</div></div><StatusPill status={period.status} /></div></article>)}</section>

      <section style={{ display: 'grid', gap: 10 }}><h3 style={{ margin: 0, color: '#0f172a', fontSize: 18 }}>Request History</h3>{!requests.length ? <div style={{ padding: 24, color: '#64748b', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6 }}>No OIC requests yet.</div> : requests.map((request) => <article key={`history-${request.id}`} style={{ border: '1px solid #e2e8f0', borderRadius: 6, background: '#ffffff', padding: 14 }}><RequestDetails request={request} /></article>)}</section>
    </div>
  );
}
