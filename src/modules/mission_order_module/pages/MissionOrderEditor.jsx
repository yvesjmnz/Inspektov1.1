import { useEffect, useMemo, useRef, useState } from 'react';
import { saveAs } from 'file-saver';
import DashboardSidebar from '../../../components/DashboardSidebar';
import { supabase } from '../../../lib/supabase';
import { buildMissionOrderDocxFileName, generateMissionOrderDocx } from '../lib/docx_template';
import '../../dashboard_module/pages/Dashboard.css';
import './MissionOrderEditor.css';

function getMissionOrderIdFromQuery() {
  const params = new URLSearchParams(window.location.search);
  return params.get('id');
}

function getTabFromQuery() {
  const hash = window.location.hash.slice(1);
  if (hash) return hash;
  const params = new URLSearchParams(window.location.search);
  return params.get('tab') || 'todo';
}

function formatDateInputValue(value) {
  if (!value) return '';
  const s = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '';
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function formatDateHuman(yyyyMmDd) {
  if (!yyyyMmDd) return '—';
  const s = String(yyyyMmDd);
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00`) : new Date(s);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

function statusLabel(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'draft') return 'Draft';
  if (s === 'issued') return 'Submitted to Director';
  if (s === 'for inspection' || s === 'for_inspection') return 'Pre-Approved';
  if (s === 'awaiting_signature') return 'Awaiting Signature';
  if (s === 'cancelled' || s === 'canceled') return 'Rejected';
  return status || '—';
}

const TEMPLATE_NAME = 'MISSION-ORDER-TEMPLATE';

function KeyTile({ label, value, sub }) {
  return (
    <div
      style={{
        border: '1px solid #e2e8f0',
        borderRadius: 14,
        padding: 14,
        background: '#fff',
        boxShadow: '0 4px 10px rgba(2,6,23,0.06)',
        minHeight: 82,
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: 0.4, color: '#64748b', textTransform: 'uppercase' }}>
        {label}
      </div>
      <div style={{ marginTop: 8, fontSize: 18, fontWeight: 900, color: '#0f172a', lineHeight: 1.2 }}>
        {value || '—'}
      </div>
      {sub ? <div style={{ marginTop: 6, fontSize: 13, fontWeight: 700, color: '#475569' }}>{sub}</div> : null}
    </div>
  );
}

function Panel({ title, right, children }) {
  return (
    <section
      style={{
        border: '1px solid #e2e8f0',
        borderRadius: 16,
        background: '#fff',
        boxShadow: '0 6px 18px rgba(2,6,23,0.06)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '14px 16px',
          borderBottom: '1px solid #e2e8f0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          background: 'linear-gradient(180deg, #f8fafc 0%, #ffffff 100%)',
        }}
      >
        <div style={{ fontWeight: 900, color: '#0f172a', fontSize: 15 }}>{title}</div>
        {right ? <div>{right}</div> : null}
      </div>
      <div style={{ padding: 16 }}>{children}</div>
    </section>
  );
}

function buildOfficeViewerUrl(docxUrl) {
  if (!docxUrl) return '';
  const src = encodeURIComponent(docxUrl);
  return `https://view.officeapps.live.com/op/embed.aspx?src=${src}`;
}

export default function MissionOrderEditor() {
  const missionOrderId = useMemo(() => getMissionOrderIdFromQuery(), []);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [generatingDocx, setGeneratingDocx] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  // Debounce DOCX regeneration to avoid generating on every single add/remove click.
  const autoRegenTimerRef = useRef(null);

  const [missionOrder, setMissionOrder] = useState(null);
  const [complaint, setComplaint] = useState(null);

  const [inspectors, setInspectors] = useState([]);
  const [assignedInspectorIds, setAssignedInspectorIds] = useState([]);
  const [selectedInspectorId, setSelectedInspectorId] = useState('');

  const [ordinances, setOrdinances] = useState([]);
  const [assignedOrdinanceIds, setAssignedOrdinanceIds] = useState([]);
  const [selectedOrdinanceId, setSelectedOrdinanceId] = useState('');

  const [dateOfInspection, setDateOfInspection] = useState('');

  
  const [docxPreviewOpen, setDocxPreviewOpen] = useState(false);
  const [docxPreviewError, setDocxPreviewError] = useState(false);

  // Store the tab from URL query parameter
  const [sourceTab, setSourceTab] = useState(() => getTabFromQuery());

  // Sidebar persistence shared across dashboard + these pages
  const [navCollapsed, setNavCollapsed] = useState(() => {
    try {
      return localStorage.getItem('dash:navCollapsed') === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('dash:navCollapsed', navCollapsed ? '1' : '0');
    } catch {
      // ignore
    }
  }, [navCollapsed]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 2800);
    return () => clearTimeout(t);
  }, [toast]);

  const status = String(missionOrder?.status || '');
  const isApproved = String(status).toLowerCase() === 'for inspection' || String(status).toLowerCase() === 'for_inspection';
  const isSubmitted = String(status).toLowerCase() === 'issued';
  const isAwaitingSignature = String(status).toLowerCase() === 'awaiting_signature';
  const isReadOnly = isApproved || isSubmitted || isAwaitingSignature;

  const handleLogout = async () => {
    setError('');
    try {
      await supabase.auth.signOut({ scope: 'global' });
    } catch (e) {
      setError(e?.message || 'Logout failed. Clearing local session…');
    } finally {
      try {
        localStorage.clear();
        sessionStorage.clear();
      } catch {
        // ignore
      }
      window.location.replace('/login');
    }
  };

  const load = async () => {
    if (!missionOrderId) {
      setError('Missing mission order id. Open this page as /mission-order?id=<uuid>');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const { data: mo, error: moError } = await supabase
        .from('mission_orders')
        .select('id, complaint_id, status, director_comment, director_signature_url, date_of_inspection, date_of_issuance, template_name, generated_docx_url, created_at, updated_at')
        .eq('id', missionOrderId)
        .single();
      if (moError) throw moError;

      setMissionOrder(mo);
      setDateOfInspection(formatDateInputValue(mo?.date_of_inspection));

      if (mo?.complaint_id) {
        const { data: c, error: cError } = await supabase
          .from('complaints')
          .select('id, business_name, business_address, complaint_description, reporter_email, created_at, status')
          .eq('id', mo.complaint_id)
          .single();
        if (cError) throw cError;
        setComplaint(c);
      } else {
        setComplaint(null);
      }

      const { data: inspectorsData, error: inspectorsError } = await supabase
        .from('profiles')
        .select('id, full_name, role')
        .eq('role', 'inspector')
        .order('full_name', { ascending: true });
      if (inspectorsError) throw inspectorsError;
      setInspectors(inspectorsData || []);

      const { data: assignedRows, error: assignedError } = await supabase
        .from('mission_order_assignments')
        .select('inspector_id, assigned_at')
        .eq('mission_order_id', missionOrderId)
        .order('assigned_at', { ascending: true });
      if (assignedError) throw assignedError;
      setAssignedInspectorIds(Array.from(new Set((assignedRows || []).map((r) => r.inspector_id).filter(Boolean))));

      const { data: ordinancesData, error: ordError } = await supabase
        .from('ordinances')
        .select('id, code_number, title, description, created_at')
        .order('code_number', { ascending: true });
      if (ordError) throw ordError;
      setOrdinances(ordinancesData || []);

      const { data: assignedOrdRows, error: assignedOrdError } = await supabase
        .from('mission_order_ordinances')
        .select('ordinance_id, created_at')
        .eq('mission_order_id', missionOrderId)
        .order('created_at', { ascending: true });
      if (assignedOrdError) throw assignedOrdError;
      setAssignedOrdinanceIds(Array.from(new Set((assignedOrdRows || []).map((r) => r.ordinance_id).filter(Boolean))));

      // Keep the local list of ordinances in sync even if ordinances were created while this page is open.
      // (Needed for DOCX + chips labeling.)
      setOrdinances((prev) => {
        const next = ordinancesData || [];
        const prevLen = (prev || []).length;
        return prevLen === next.length ? prev : next;
      });

      // If doc exists, default open the preview panel (reduces clicks)
      if (mo?.generated_docx_url) {
        setDocxPreviewOpen(true);
      }
    } catch (e) {
      setError(e?.message || 'Failed to load mission order.');
      setMissionOrder(null);
      setComplaint(null);
      setInspectors([]);
      setAssignedInspectorIds([]);
      setOrdinances([]);
      setAssignedOrdinanceIds([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missionOrderId]);

  const assignedInspectorNames = useMemo(() => {
    const uniqueIds = Array.from(new Set(assignedInspectorIds.filter(Boolean)));
    return uniqueIds
      .map((id) => inspectors.find((x) => x.id === id)?.full_name)
      .filter(Boolean)
      .join(', ');
  }, [assignedInspectorIds, inspectors]);

  const assignedOrdinanceLabels = useMemo(() => {
    const uniqueIds = Array.from(new Set(assignedOrdinanceIds.filter(Boolean)));
    return uniqueIds
      .map((id) => {
        const o = ordinances.find((x) => x.id === id);
        if (!o) return null;
        const code = o.code_number ? String(o.code_number).trim() : '';
        const title = o.title ? String(o.title).trim() : '';
        return code && title ? `${code} — ${title}` : code || title || id;
      })
      .filter(Boolean)
      .join(', ');
  }, [assignedOrdinanceIds, ordinances]);

  const canSave = !loading && !!missionOrderId && !isReadOnly;
  const canSubmit = canSave && assignedInspectorIds.length > 0 && !!dateOfInspection;
  const isDraft = String(status).toLowerCase() === 'draft';
  // Allow generating an UNSIGNED doc even after submit (issued), so the director can see the latest draft output.
  // Director approval will overwrite it with the SIGNED template automatically.
  const canGenerateDocx = !loading && !!missionOrderId && (isDraft || isSubmitted || isApproved || isAwaitingSignature);

  const saveMissionOrder = async () => {
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError) throw userError;
    const userId = userData?.user?.id;
    if (!userId) throw new Error('Not authenticated. Please login again.');

    const patch = {
      date_of_inspection: dateOfInspection || null,
      template_name: TEMPLATE_NAME,
      updated_at: new Date().toISOString(),
      last_edited_by: userId,
    };

    const { error: updateError } = await supabase.from('mission_orders').update(patch).eq('id', missionOrderId);
    if (updateError) throw updateError;

    setMissionOrder((prev) => ({ ...(prev || {}), ...patch }));
  };

  const handleSave = async () => {
    setError('');
    setToast('');
    setSaving(true);
    try {
      await saveMissionOrder();
      setToast('Saved');
    } catch (e) {
      setError(e?.message || 'Failed to save mission order.');
    } finally {
      setSaving(false);
    }
  };

  const handleSubmitToDirector = async () => {
    setError('');
    setToast('');
    setSubmitting(true);

    try {
      await saveMissionOrder();

      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      const userId = userData?.user?.id;
      if (!userId) throw new Error('Not authenticated. Please login again.');

      const nowIso = new Date().toISOString();
      const { error: submitError } = await supabase
        .from('mission_orders')
        .update({ status: 'issued', submitted_by: userId, submitted_at: nowIso, updated_at: nowIso })
        .eq('id', missionOrderId);
      if (submitError) throw submitError;

      setMissionOrder((prev) => ({
        ...(prev || {}),
        status: 'issued',
        submitted_by: userId,
        submitted_at: nowIso,
        updated_at: nowIso,
      }));
      setToast('Submitted');
    } catch (e) {
      setError(e?.message || 'Failed to submit to Director.');
    } finally {
      setSubmitting(false);
    }
  };

  const addInspector = async () => {
    if (!missionOrderId || !selectedInspectorId) return;

    setError('');
    setToast('');

    try {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      const userId = userData?.user?.id;
      if (!userId) throw new Error('Not authenticated. Please login again.');

      const inspectorId = selectedInspectorId;
      const { data: existing, error: existingError } = await supabase
        .from('mission_order_assignments')
        .select('id')
        .eq('mission_order_id', missionOrderId)
        .eq('inspector_id', inspectorId)
        .limit(1);
      if (existingError) throw existingError;
      if (existing && existing.length > 0) {
        setToast('Already added');
        return;
      }

      const { error: insertError } = await supabase
        .from('mission_order_assignments')
        .insert([{ mission_order_id: missionOrderId, inspector_id: inspectorId, assigned_by: userId }]);
      if (insertError) throw insertError;

      setAssignedInspectorIds((prev) => Array.from(new Set([...prev, inspectorId])));
      setSelectedInspectorId('');
      setToast('Inspector added');

      // Keep DOCX in sync if a doc already exists
      maybeAutoRegenerateDocx();
    } catch (e) {
      setError(e?.message || 'Failed to add inspector.');
    }
  };

  const removeInspector = async (inspectorId) => {
    if (!missionOrderId) return;

    setError('');
    setToast('');

    try {
      const { error: delError } = await supabase
        .from('mission_order_assignments')
        .delete()
        .eq('mission_order_id', missionOrderId)
        .eq('inspector_id', inspectorId);
      if (delError) throw delError;

      setAssignedInspectorIds((prev) => prev.filter((id) => id !== inspectorId));
      setToast('Removed');

      // Keep DOCX in sync if a doc already exists
      maybeAutoRegenerateDocx();
    } catch (e) {
      setError(e?.message || 'Failed to remove inspector.');
    }
  };

  const addOrdinance = async () => {
    if (!missionOrderId || !selectedOrdinanceId) return;

    setError('');
    setToast('');

    try {
      const ordinanceId = selectedOrdinanceId;

      const { data: existing, error: existingError } = await supabase
        .from('mission_order_ordinances')
        .select('id')
        .eq('mission_order_id', missionOrderId)
        .eq('ordinance_id', ordinanceId)
        .limit(1);
      if (existingError) throw existingError;
      if (existing && existing.length > 0) {
        setToast('Already added');
        return;
      }

      const { error: insertError } = await supabase
        .from('mission_order_ordinances')
        .insert([{ mission_order_id: missionOrderId, ordinance_id: ordinanceId }]);
      if (insertError) throw insertError;

      setAssignedOrdinanceIds((prev) => Array.from(new Set([...prev, ordinanceId])));
      setSelectedOrdinanceId('');
      setToast('Ordinance added');

      // Keep DOCX in sync if a doc already exists
      maybeAutoRegenerateDocx();
    } catch (e) {
      setError(e?.message || 'Failed to add ordinance.');
    }
  };

  const removeOrdinance = async (ordinanceId) => {
    if (!missionOrderId) return;

    setError('');
    setToast('');

    try {
      const { error: delError } = await supabase
        .from('mission_order_ordinances')
        .delete()
        .eq('mission_order_id', missionOrderId)
        .eq('ordinance_id', ordinanceId);
      if (delError) throw delError;

      setAssignedOrdinanceIds((prev) => prev.filter((id) => id !== ordinanceId));
      setToast('Removed');

      // Keep DOCX in sync if a doc already exists
      maybeAutoRegenerateDocx();
    } catch (e) {
      setError(e?.message || 'Failed to remove ordinance.');
    }
  };

  const handleGenerateDocx = async (opts = {}) => {
    const silent = !!opts.silent;

    if (!canGenerateDocx) return;

    setError('');
    if (!silent) setToast('');
    setGeneratingDocx(true);

    try {
      // First, save the current date of inspection if it's not saved yet
      if (isDraft && dateOfInspection && !missionOrder?.date_of_inspection) {
        await saveMissionOrder();
      }

      const { data: fresh, error: freshErr } = await supabase
        .from('mission_orders')
        .select('id, complaint_id, status, director_signature_url, date_of_inspection, date_of_issuance')
        .eq('id', missionOrderId)
        .single();
      if (freshErr) throw freshErr;

      const freshStatus = String(fresh?.status || '').toLowerCase();
      const isCurrentlyDraft = freshStatus === 'draft';
      const isCurrentlyApproved = freshStatus === 'for inspection' || freshStatus === 'for_inspection';
      const isCurrentlyAwaitingSignature = freshStatus === 'awaiting_signature';

      if (!isCurrentlyDraft && !isCurrentlyApproved && !isCurrentlyAwaitingSignature) {
        throw new Error('DOCX can only be generated during draft or after approval.');
      }
      
      // Use the local state if available, otherwise use the database value
      const inspectionDate = dateOfInspection || fresh?.date_of_inspection;
      if (!inspectionDate) throw new Error('Missing date of inspection.');
      if (isCurrentlyApproved && !fresh?.date_of_issuance) throw new Error('Missing date of issuance (auto-set on approval).');

      const { data: c, error: cErr } = await supabase
        .from('complaints')
        .select('id, business_name, business_address, complaint_description')
        .eq('id', fresh.complaint_id)
        .single();
      if (cErr) throw cErr;

      let directorSignatureUrl = fresh?.director_signature_url || null;
      try {
        const u = String(directorSignatureUrl || '');
        if (u && u.includes('/storage/v1/object/') && u.includes('/private/')) {
          const m2 = u.match(/\/storage\/v1\/object\/private\/([^/]+)\/(.+)$/i);
          if (m2) {
            const bucket = m2[1];
            const path = decodeURIComponent(m2[2]);
            const { data: signed } = await supabase.storage.from(bucket).createSignedUrl(path, 60);
            if (signed?.signedUrl) directorSignatureUrl = signed.signedUrl;
          }
        }
      } catch {
        // ignore
      }

      // Template selection:
      // - Draft / Issued: UNSIGNED template
      // - Approved / Awaiting Signature: SIGNED template
      const templatePath = isCurrentlyDraft || freshStatus === 'issued'
        ? 'templates/MISSION-ORDER-TEMPLATE-UNSIGNED.docx'
        : 'templates/MISSION-ORDER-TEMPLATE.docx';

      const { data: signedTemplate, error: signTplErr } = await supabase.storage
        .from('mission-orders')
        .createSignedUrl(templatePath, 60);
      if (signTplErr) throw signTplErr;
      if (!signedTemplate?.signedUrl) throw new Error('Failed to create signed URL for mission order template.');

      // Re-fetch inspector assignments to avoid stale React state (auto-regenerate runs right after setState).
      const { data: assignedRows, error: assignedError } = await supabase
        .from('mission_order_assignments')
        .select('inspector_id, assigned_at')
        .eq('mission_order_id', missionOrderId)
        .order('assigned_at', { ascending: true });
      if (assignedError) throw assignedError;

      const assignedInspectorIdsFresh = Array.from(new Set((assignedRows || []).map((r) => r.inspector_id).filter(Boolean)));

      // If inspector profiles aren't loaded yet (or missing), fetch names directly.
      const missingInspectorIds = assignedInspectorIdsFresh.filter((id) => !inspectors.find((x) => x.id === id));
      const { data: inspectorProfilesFresh, error: inspectorProfilesErr } = missingInspectorIds.length
        ? await supabase
            .from('profiles')
            .select('id, full_name')
            .in('id', missingInspectorIds)
        : { data: [], error: null };
      if (inspectorProfilesErr) throw inspectorProfilesErr;

      const inspectorNameById = new Map([
        ...(inspectors || []).map((p) => [p.id, p.full_name]),
        ...(inspectorProfilesFresh || []).map((p) => [p.id, p.full_name]),
      ]);

      const assignedInspectorNamesFresh = assignedInspectorIdsFresh
        .map((id) => inspectorNameById.get(id))
        .filter(Boolean)
        .join(', ');

      // Fetch assigned ordinances for this mission order and format them for the template.
      const { data: assignedOrdRows, error: assignedOrdError } = await supabase
        .from('mission_order_ordinances')
        .select('ordinance_id, created_at')
        .eq('mission_order_id', missionOrderId)
        .order('created_at', { ascending: true });
      if (assignedOrdError) throw assignedOrdError;

      const assignedOrdIds = Array.from(new Set((assignedOrdRows || []).map((r) => r.ordinance_id).filter(Boolean)));
      const ordById = new Map((ordinances || []).map((o) => [o.id, o]));

      // If some ordinance IDs aren't in state (rare), fetch them.
      const missingOrdIds = assignedOrdIds.filter((id) => !ordById.has(id));
      const { data: missingOrds, error: missingOrdsErr } = missingOrdIds.length
        ? await supabase
            .from('ordinances')
            .select('id, code_number, title, description')
            .in('id', missingOrdIds)
        : { data: [], error: null };
      if (missingOrdsErr) throw missingOrdsErr;

      (missingOrds || []).forEach((o) => ordById.set(o.id, o));

      const ordinancesText = assignedOrdIds
        .map((id) => {
          const o = ordById.get(id);
          if (!o) return null;
          const code = o.code_number ? String(o.code_number).trim() : '';
          const title = o.title ? String(o.title).trim() : '';
          const desc = o.description ? String(o.description).trim() : '';

          // Format like: "Ordinance No. 3532 (Title) - Description"
          const head = code ? `Ordinance No. ${code}` : 'Ordinance';
          const mid = title ? ` (${title})` : '';
          const tail = desc ? ` - ${desc}` : '';
          return `${head}${mid}${tail}`;
        })
        .filter(Boolean)
        .join('\n');

      const complaintDetailsForDocx = ordinancesText
        ? `CITY ORDINANCES VIOLATED:\n${ordinancesText}`
        : (c?.complaint_description || '—');

      const blob = await generateMissionOrderDocx({
        templateUrl: signedTemplate.signedUrl,
        inspectors: assignedInspectorNamesFresh || '—',
        date_of_inspection: fresh.date_of_inspection,
        date_of_issuance: fresh.date_of_issuance,
        business_name: c?.business_name,
        business_address: c?.business_address,
        complaint_details: complaintDetailsForDocx,
        director_signature_url: directorSignatureUrl,
      });

      const { data: userData, error: userErr } = await supabase.auth.getUser();
      if (userErr) throw userErr;
      const userId = userData?.user?.id;
      if (!userId) throw new Error('Not authenticated. Please login again.');

      const nowIso = new Date().toISOString();

      // Stable object path per mission order.
      // This enables Director approval to overwrite the UNSIGNED doc with the SIGNED one.
      const fileName = buildMissionOrderDocxFileName({ business_name: c?.business_name, mission_order_id: fresh.id });

      const bucket = 'mission-orders';
      const objectPath = `${fresh.id}/MISSION-ORDER.docx`;

      const { error: uploadErr } = await supabase.storage
        .from(bucket)
        .upload(objectPath, blob, {
          contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          upsert: true,
        });
      if (uploadErr) throw uploadErr;

      const { data: publicData } = supabase.storage.from(bucket).getPublicUrl(objectPath);
      const baseUrl = publicData?.publicUrl;
      if (!baseUrl) throw new Error('Failed to get public URL for uploaded DOCX.');

      // Cache-bust the *document URL* itself so Office viewer refetches after overwrites.
      const publicUrl = `${baseUrl}?v=${encodeURIComponent(nowIso)}`;

      const patch = {
        generated_docx_url: publicUrl,
        generated_docx_created_at: nowIso,
        generated_docx_created_by: userId,
        updated_at: nowIso,
      };

      const { error: updateErr } = await supabase.from('mission_orders').update(patch).eq('id', fresh.id);
      if (updateErr) throw updateErr;

      setMissionOrder((prev) => ({ ...(prev || {}), ...patch }));

      // show preview automatically for newly generated doc
      setDocxPreviewOpen(true);
      setDocxPreviewError(false);

      if (!silent) {
        const wasUnsigned = isCurrentlyDraft || freshStatus === 'issued';
        setToast(wasUnsigned ? 'Unsigned DOCX ready' : 'Signed DOCX ready');
      }
    } catch (e) {
      // When auto-regenerating, don’t block the user with errors unless they explicitly clicked.
      if (!silent) setError(e?.message || 'Failed to generate DOCX.');
      if (!silent) setToast('');
    } finally {
      setGeneratingDocx(false);
    }
  };

  const maybeAutoRegenerateDocx = () => {
    // Only regenerate if a document already exists AND regeneration is allowed in this state.
    if (!missionOrder?.generated_docx_url) return;
    if (!canGenerateDocx) return;

    // If a regeneration is currently running, let it finish.
    if (generatingDocx) return;

    // Debounce: if multiple edits happen quickly, only regenerate once.
    if (autoRegenTimerRef.current) {
      clearTimeout(autoRegenTimerRef.current);
      autoRegenTimerRef.current = null;
    }

    setToast('Updating document…');

    autoRegenTimerRef.current = setTimeout(async () => {
      autoRegenTimerRef.current = null;
      try {
        await handleGenerateDocx({ silent: true });
        setToast('Document updated');
      } catch {
        setToast('Auto-update failed');
      }
    }, 1500);
  };

  const handleDownloadDocx = async () => {
    setError('');
    setToast('');

    try {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      const userId = userData?.user?.id;
      if (!userId) throw new Error('Not authenticated. Please login again.');

      const nowIso = new Date().toISOString();
      const { error: updateErr } = await supabase
        .from('mission_orders')
        .update({ status: 'awaiting_signature', updated_at: nowIso })
        .eq('id', missionOrderId);
      if (updateErr) throw updateErr;

      setMissionOrder((prev) => ({
        ...(prev || {}),
        status: 'awaiting_signature',
        updated_at: nowIso,
      }));

      setToast('Status updated to Awaiting Signature');
      
      // Open the document in a new tab
      if (missionOrder?.generated_docx_url) {
        window.open(missionOrder.generated_docx_url, '_blank');
      }
    } catch (e) {
      setError(e?.message || 'Failed to update status.');
    }
  };

  const officeViewerUrl = useMemo(() => buildOfficeViewerUrl(missionOrder?.generated_docx_url), [missionOrder?.generated_docx_url]);

  return (
    <div className="dash-container" style={{ fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif' }}>
      <main className="dash-main">
        <section className="dash-shell" style={{ paddingLeft: navCollapsed ? 72 : 240 }}>
          <DashboardSidebar
            role="head_inspector"
            onLogout={handleLogout}
            collapsed={navCollapsed}
            onCollapsedChange={setNavCollapsed}
          />

          <div className="dash-maincol">
            <div className="dash-card" style={{ padding: 18 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontWeight: 1000, fontSize: 20, color: '#0f172a' }}>Mission Order</div>
                  <div style={{ color: '#475569', fontWeight: 800, marginTop: 6, fontSize: 14 }}>
                    {complaint?.business_name || '—'}
                  </div>
                  <div style={{ marginTop: 10, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                    <span className="status-badge status-info">{statusLabel(missionOrder?.status)}</span>
                    <span style={{ color: '#64748b', fontWeight: 800, fontSize: 12 }}>Template: {missionOrder?.template_name || TEMPLATE_NAME}</span>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                  <button
                    type="button"
                    onClick={() => {
                      window.location.assign(`/dashboard/head-inspector#${sourceTab}`);
                    }}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '8px 12px',
                      background: 'transparent',
                      border: '1px solid #cbd5e1',
                      borderRadius: 8,
                      color: '#0f172a',
                      fontWeight: 700,
                      fontSize: 14,
                      textDecoration: 'none',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = '#f1f5f9';
                      e.currentTarget.style.borderColor = '#94a3b8';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'transparent';
                      e.currentTarget.style.borderColor = '#cbd5e1';
                    }}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ display: 'block' }}>
                      <path d="M15 18L9 12L15 6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    Back
                  </button>

                  {!isApproved && !isSubmitted && !isAwaitingSignature ? (
                    <>
                      <button className="dash-btn" type="button" onClick={handleSave} disabled={!canSave || saving}>
                        {saving ? 'Saving…' : 'Save'}
                      </button>
                      <button
                        className="dash-btn"
                        type="button"
                        onClick={handleSubmitToDirector}
                        disabled={!canSubmit || submitting}
                        style={{ background: '#0b2249', color: '#fff', border: '1px solid #0b2249' }}
                        title={assignedInspectorIds.length === 0 ? 'Assign at least one inspector.' : !dateOfInspection ? 'Set the date of inspection.' : 'Submit to Director'}
                      >
                        {submitting ? 'Submitting…' : 'Submit'}
                      </button>
                    </>
                  ) : (
                    <div style={{ fontWeight: 900, color: '#0f172a' }}>{isApproved ? 'Approved' : isAwaitingSignature ? 'Awaiting Signature' : 'Submitted'}</div>
                  )}
                </div>
              </div>

              {toast ? <div className="dash-alert dash-alert-success" style={{ marginTop: 14 }}>{toast}</div> : null}
              {error ? <div className="dash-alert dash-alert-error" style={{ marginTop: 14 }}>{error}</div> : null}

              {/* Status Ribbon */}
              <div
                style={{
                  marginTop: 12,
                  display: 'flex',
                  gap: 18,
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  padding: '8px 12px',
                  border: '1px solid #e2e8f0',
                  borderRadius: 12,
                  background: '#f8fafc',
                }}
              >
                {/* Inspectors */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 180 }}>
                  <span aria-hidden="true" style={{ color: '#0b2249' }}>
                    {/* User icon */}
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M12 12c2.761 0 5-2.686 5-6s-2.239-5-5-5-5 2.686-5 6 2.239 5 5 5Zm0 2c-4.418 0-8 2.239-8 5v1h16v-1c0-2.761-3.582-5-8-5Z" fill="#0b2249"/>
                    </svg>
                  </span>
                  <span style={{ color: '#475569', fontWeight: 900, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4 }}>Inspectors:</span>
                  <span style={{ color: '#0f172a', fontWeight: 900, fontSize: 14 }}>{assignedInspectorNames || '—'}</span>
                </div>

                {/* Ordinances */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 180 }}>
                  <span aria-hidden="true" style={{ color: '#0b2249' }}>
                    {/* Document icon */}
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M7 2h7l5 5v15a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm7 1.5V8h4.5L14 3.5ZM8 12h8a1 1 0 1 0 0-2H8a1 1 0 1 0 0 2Zm0 4h8a1 1 0 1 0 0-2H8a1 1 0 1 0 0 2Z" fill="#0b2249"/>
                    </svg>
                  </span>
                  <span style={{ color: '#475569', fontWeight: 900, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4 }}>Ordinances:</span>
                  <span style={{ color: '#0f172a', fontWeight: 900, fontSize: 14 }}>{assignedOrdinanceLabels || '—'}</span>
                </div>

                {/* Inspection Date */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 180 }}>
                  <span aria-hidden="true" style={{ color: '#0b2249' }}>
                    {/* Calendar icon */}
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M7 2a1 1 0 0 1 1 1v1h8V3a1 1 0 1 1 2 0v1h1a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h1V3a1 1 0 1 1 2 0v1Zm13 7H4v10a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9ZM5 7h14V6H5v1Z" fill="#0b2249"/>
                    </svg>
                  </span>
                  <span style={{ color: '#475569', fontWeight: 900, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4 }}>Inspection:</span>
                  <span style={{ color: '#0f172a', fontWeight: 900, fontSize: 14 }}>{dateOfInspection ? formatDateHuman(dateOfInspection) : '—'}</span>
                </div>

                {/* Issuance Date */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 180 }}>
                  <span aria-hidden="true" style={{ color: '#0b2249' }}>
                    {/* Calendar icon (reuse) */}
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M7 2a1 1 0 0 1 1 1v1h8V3a1 1 0 1 1 2 0v1h1a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h1V3a1 1 0 1 1 2 0v1Zm13 7H4v10a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9ZM5 7h14V6H5v1Z" fill="#0b2249"/>
                    </svg>
                  </span>
                  <span style={{ color: '#475569', fontWeight: 900, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4 }}>Issuance:</span>
                  <span style={{ color: '#0f172a', fontWeight: 900, fontSize: 14 }}>{missionOrder?.date_of_issuance ? formatDateHuman(missionOrder.date_of_issuance) : 'Auto'}</span>
                </div>
              </div>

              <Panel title="Mission Order Details" right={isReadOnly ? <span style={{ fontWeight: 900, fontSize: 12, color: '#64748b' }}>Read-only</span> : null}>
                <div style={{ display: 'grid', gap: 16 }}>
                  {/* 1) Inspectors (editable) */}
                  <div>
                    <div style={{ fontWeight: 900, fontSize: 13, color: '#0f172a' }}>Inspectors</div>
                    {!isReadOnly ? (
                      <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, alignItems: 'center' }}>
                        <select
                          className="mo-select"
                          value={selectedInspectorId}
                          onChange={(e) => setSelectedInspectorId(e.target.value)}
                          disabled={loading}
                          style={{ padding: '10px 12px', borderRadius: 14, border: '1px solid #e2e8f0', height: 46, fontWeight: 900, fontSize: 15 }}
                        >
                          <option value="">Select inspector…</option>
                          {inspectors.map((ins) => (
                            <option key={ins.id} value={ins.id}>
                              {ins.full_name || ins.id}
                            </option>
                          ))}
                        </select>
                        <button type="button" className="dash-btn" onClick={addInspector} disabled={loading || !selectedInspectorId}>
                          Add
                        </button>
                      </div>
                    ) : null}

                    {assignedInspectorIds.length > 0 ? (
                      <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {assignedInspectorIds.map((id) => {
                          const ins = inspectors.find((x) => x.id === id);
                          const label = ins?.full_name || id;
                          return (
                            <button
                              key={id}
                              type="button"
                              className="mo-chip"
                              title={isReadOnly ? '' : 'Click to remove'}
                              onClick={() => (isReadOnly ? null : removeInspector(id))}
                              disabled={isReadOnly}
                              style={{ fontSize: 14, fontWeight: 1000 }}
                            >
                              <span className="mo-chip-label">{label}</span>
                              {!isReadOnly ? <span aria-hidden="true" className="mo-chip-x">×</span> : null}
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <div style={{ marginTop: 10, color: '#64748b', fontWeight: 800 }}>No inspectors assigned yet.</div>
                    )}
                  </div>

                  {/* 2) City ordinances violated (editable) */}
                  <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 12 }}>
                    <div style={{ fontWeight: 900, fontSize: 13, color: '#0f172a' }}>City Ordinances Violated</div>
                    {!isReadOnly ? (
                      <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, alignItems: 'center' }}>
                        <select
                          className="mo-select"
                          value={selectedOrdinanceId}
                          onChange={(e) => setSelectedOrdinanceId(e.target.value)}
                          disabled={loading}
                          style={{ padding: '10px 12px', borderRadius: 14, border: '1px solid #e2e8f0', height: 46, fontWeight: 900, fontSize: 15 }}
                        >
                          <option value="">Select ordinance…</option>
                          {ordinances.map((o) => {
                            const code = o.code_number ? String(o.code_number).trim() : '';
                            const title = o.title ? String(o.title).trim() : '';
                            const label = code && title ? `${code} — ${title}` : code || title || o.id;
                            return (
                              <option key={o.id} value={o.id}>
                                {label}
                              </option>
                            );
                          })}
                        </select>
                        <button type="button" className="dash-btn" onClick={addOrdinance} disabled={loading || !selectedOrdinanceId}>
                          Add
                        </button>
                      </div>
                    ) : null}

                    {assignedOrdinanceIds.length > 0 ? (
                      <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {assignedOrdinanceIds.map((id) => {
                          const o = ordinances.find((x) => x.id === id);
                          const code = o?.code_number ? String(o.code_number).trim() : '';
                          const title = o?.title ? String(o.title).trim() : '';
                          const label = o ? (code && title ? `${code} — ${title}` : code || title || id) : id;
                          const tip = !isReadOnly && o?.description ? o.description : (isReadOnly ? '' : 'Click to remove');
                          return (
                            <button
                              key={id}
                              type="button"
                              className="mo-chip"
                              title={tip}
                              onClick={() => (isReadOnly ? null : removeOrdinance(id))}
                              disabled={isReadOnly}
                              style={{ fontSize: 14, fontWeight: 1000 }}
                            >
                              <span className="mo-chip-label">{label}</span>
                              {!isReadOnly ? <span aria-hidden="true" className="mo-chip-x">×</span> : null}
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <div style={{ marginTop: 10, color: '#64748b', fontWeight: 800 }}>No ordinances added yet.</div>
                    )}
                  </div>

                  {/* 2) Business name (read-only) */}
                  <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 12 }}>
                    <div style={{ fontSize: 12, fontWeight: 900, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4 }}>Business</div>
                    <div style={{ fontSize: 18, fontWeight: 1000, color: '#0f172a', marginTop: 6 }}>{complaint?.business_name || '—'}</div>
                  </div>

                  {/* 3) Business address (read-only) */}
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 800, color: '#475569', marginTop: 0 }}>{complaint?.business_address || '—'}</div>
                  </div>

                  {/* 4) Complaint details (read-only) */}
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 900, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4 }}>Complaint Details</div>
                    <div style={{ marginTop: 8, whiteSpace: 'pre-wrap', fontSize: 15, fontWeight: 800, color: '#0f172a', lineHeight: 1.65 }}>
                      {complaint?.complaint_description || '—'}
                    </div>
                    {complaint?.id ? (
                      <div style={{ marginTop: 12 }}>
                        <a className="dash-btn" href={`/complaints/view?id=${complaint.id}`} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
                          Open Full Complaint
                        </a>
                      </div>
                    ) : null}
                  </div>

                  {/* 5) Date of inspection (editable) */}
                  <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 12 }}>
                    <label className="mo-label" htmlFor="dateInspection" style={{ fontSize: 13 }}>Date of Inspection</label>
                    <input
                      id="dateInspection"
                      type="date"
                      value={dateOfInspection}
                      onChange={(e) => setDateOfInspection(e.target.value)}
                      disabled={loading || isReadOnly}
                      className="mo-title"
                      style={{ fontSize: 16, fontWeight: 900, height: 46, borderRadius: 14 }}
                    />
                  </div>

                  {/* 6) Date of issuance (read-only) */}
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 900, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 12 }}>Date of Issuance</div>
                    <div style={{ marginTop: 6, fontSize: 15, fontWeight: 900, color: '#0f172a' }}>
                      {missionOrder?.date_of_issuance ? formatDateHuman(missionOrder.date_of_issuance) : 'Auto'}
                    </div>
                  </div>
                </div>
              </Panel>

              {/* Unified DOCX actions inside the Preview panel header */}
              <div style={{ marginTop: 14, display: 'grid', gap: 14 }}>
                <Panel
                  title="Document Preview"
                  right={
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="dash-btn"
                        onClick={handleGenerateDocx}
                        disabled={!canGenerateDocx || generatingDocx}
                        style={{ background: '#0b2249', color: '#fff', border: '1px solid #0b2249' }}
                        title={
                          isDraft
                            ? 'Generate a previewable DOCX during draft.'
                            : (isApproved || isAwaitingSignature)
                            ? 'Regenerate the approved DOCX.'
                            : 'Available during draft or after approval.'
                        }
                      >
                        {generatingDocx ? 'Generating…' : missionOrder?.generated_docx_url ? 'Regenerate DOCX' : 'Generate DOCX'}
                      </button>

                      {missionOrder?.generated_docx_url && (isApproved || isAwaitingSignature) ? (
                        <button
                          type="button"
                          className="dash-btn"
                          onClick={handleDownloadDocx}
                          style={{ textDecoration: 'none' }}
                        >
                          Download
                        </button>
                      ) : null}

                      {missionOrder?.generated_docx_url ? (
                        <button
                          type="button"
                          className="dash-btn"
                          onClick={() => {
                            setDocxPreviewOpen((v) => !v);
                            setDocxPreviewError(false);
                          }}
                          style={{ background: '#fff', border: '1px solid #e2e8f0', color: '#0b2249' }}
                        >
                          {docxPreviewOpen ? 'Hide Preview' : 'Show Preview'}
                        </button>
                      ) : null}
                    </div>
                  }
                >
                  {!missionOrder?.generated_docx_url ? (
                    <div style={{ color: '#64748b', fontWeight: 800 }}>
                      No generated document yet. {isDraft ? '(Preview only during draft)' : (!isApproved && !isAwaitingSignature ? '(Available after Director approval)' : '')}
                    </div>
                  ) : docxPreviewOpen ? (
                    <div style={{ display: 'grid', gap: 10 }}>
                      {docxPreviewError ? (
                        <div className="dash-alert dash-alert-error">
                          Preview failed to load.
                        </div>
                      ) : null}

                      <iframe
                        key={officeViewerUrl}
                        title="DOCX Preview"
                        src={officeViewerUrl}
                        style={{ width: '100%', height: 560, border: '1px solid #e2e8f0', borderRadius: 14, background: '#fff' }}
                        onError={() => setDocxPreviewError(true)}
                      />

                      {isApproved ? (
                        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                          <a className="dash-btn" href={missionOrder.generated_docx_url} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
                            Open in new tab
                          </a>
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div style={{ color: '#64748b', fontWeight: 800 }}>Preview hidden.</div>
                  )}
                </Panel>
              </div>

              {loading ? <div style={{ marginTop: 12, color: '#64748b', fontWeight: 800 }}>Loading…</div> : null}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
