import { useEffect, useMemo, useRef, useState } from 'react';
import { saveAs } from 'file-saver';
import DashboardSidebar from '../../../components/DashboardSidebar';
import { supabase } from '../../../lib/supabase';
import { notifyDirectorMissionOrderSubmitted, notifyInspectorsMissionOrderAssigned } from '../../../lib/notifications/notificationTriggers';
import { buildMissionOrderDocxFileName, generateMissionOrderDocx } from '../lib/docx_template';
import { groupSubcategories, getOrdinancesForSubcategory } from '../../../lib/violations/catalog';
import '../../dashboard_module/pages/Dashboard.css';
import './MissionOrderEditor.css';

// Helper to extract selected subcategory labels from complaint tags
function listSelectedSubcategories(tags) {
  if (!Array.isArray(tags) || tags.length === 0) return [];
  return tags
    .map((t) => String(t || ''))
    .filter((t) => /^Violation:\s*/i.test(t))
    .map((t) => t.replace(/^Violation:\s*/i, '').trim());
}

// Helper to group violation subcategories from complaint tags for display
function groupComplaintCategoriesFromTags(tags) {
  const selectedSubs = listSelectedSubcategories(tags);
  if (selectedSubs.length === 0) return [];
  return groupSubcategories(selectedSubs);
}

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
  if (s === 'complete' || s === 'completed') return 'Complete';
  if (s === 'cancelled' || s === 'canceled') return 'Rejected';
  return status || '—';
}

function statusBadgeClass(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'for inspection' || s === 'for_inspection') return 'status-badge status-success';
  if (s === 'complete' || s === 'completed') return 'status-badge status-success';
  if (s === 'awaiting_signature') return 'status-badge status-purple';
  if (s === 'issued') return 'status-badge status-info';
  if (s === 'cancelled' || s === 'canceled') return 'status-badge status-danger';
  if (s === 'draft') return 'status-badge status-info';
  if (!s) return 'status-badge status-info';
  return 'status-badge';
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

function Panel({ title, right, subtitle, children }) {
  return (
    <section
      style={{
        border: '1px solid #e2e8f0',
        borderRadius: 16,
        background: '#fff',
        boxShadow: '0 6px 18px rgba(2,6,23,0.06)',
        overflow: 'visible',
      }}
    >
      <div
        style={{
          padding: '14px 16px',
          borderBottom: '1px solid #e2e8f0',
          display: 'grid',
          gap: 6,
          background: 'linear-gradient(180deg, #f8fafc 0%, #ffffff 100%)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ fontWeight: 900, color: '#0f172a', fontSize: 15, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>{title}</span>
          </div>
          {right ? <div>{right}</div> : null}
        </div>

        {subtitle ? <div>{subtitle}</div> : null}
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
  const [business, setBusiness] = useState(null);

  const [inspectors, setInspectors] = useState([]);
  const [assignedInspectorIds, setAssignedInspectorIds] = useState([]);
  const [selectedInspectorId, setSelectedInspectorId] = useState('');
  const [inspectorQuery, setInspectorQuery] = useState('');
  const [inspectorDropdownOpen, setInspectorDropdownOpen] = useState(false);
  const inspectorInputRef = useRef(null);
  const inspectorDropdownRef = useRef(null);
  const [smartInspectorRows, setSmartInspectorRows] = useState([]);
  const [smartInspectorsLoading, setSmartInspectorsLoading] = useState(false);
  const smartInspectorsSeqRef = useRef(0);

  // Fallback workload stats when RPC isn't available/complete.
  // Map<inspector_id, active_pending_count>
  const [inspectorActiveWorkloadById, setInspectorActiveWorkloadById] = useState(() => new Map());
  const workloadSeqRef = useRef(0);

  const [ordinances, setOrdinances] = useState([]);
  const [assignedOrdinanceIds, setAssignedOrdinanceIds] = useState([]);
  const [selectedOrdinanceId, setSelectedOrdinanceId] = useState('');
  const [ordinanceQuery, setOrdinanceQuery] = useState('');
  const [ordinanceDropdownOpen, setOrdinanceDropdownOpen] = useState(false);
  const ordinanceInputRef = useRef(null);
  const ordinanceDropdownRef = useRef(null);

  const [dateOfInspection, setDateOfInspection] = useState('');

  const [evidencePreviewUrl, setEvidencePreviewUrl] = useState('');

  
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
  const statusLower = String(status).toLowerCase();
  const isApproved = statusLower === 'for inspection' || statusLower === 'for_inspection';
  const isSubmitted = statusLower === 'issued';
  const isAwaitingSignature = statusLower === 'awaiting_signature';
  const isComplete = statusLower === 'complete' || statusLower === 'completed';

  // Editing is only allowed while the mission order is still being prepared (draft/submitted).
  // After director pre-approval, awaiting signature, or completion, the MO must be read-only.
  const isReadOnly = isApproved || isAwaitingSignature || isComplete;

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

      let complaintForAutoPopulate = null;

      if (mo?.complaint_id) {
        const { data: c, error: cError } = await supabase
          .from('complaints')
          .select('id, business_pk, business_name, business_address, complaint_description, reporter_email, created_at, status, tags, image_urls')
          .eq('id', mo.complaint_id)
          .single();
        if (cError) throw cError;
        complaintForAutoPopulate = c;
        setComplaint(c);
        setEvidencePreviewUrl('');

        // Load registered business details (used by smart inspector recommendations).
        if (c?.business_pk) {
          const { data: biz, error: bizErr } = await supabase
            .from('businesses')
            .select('business_pk, business_name, brgy_no')
            .eq('business_pk', c.business_pk)
            .single();
          if (!bizErr) setBusiness(biz);
          else setBusiness(null);
        } else {
          setBusiness(null);
        }
      } else {
        complaintForAutoPopulate = null;
        setComplaint(null);
        setBusiness(null);
        setEvidencePreviewUrl('');
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

      // Auto-populate ordinances from complaint violation tags (only for draft status with no assigned ordinances)
      const isCurrentlyDraft = String(mo?.status || '').toLowerCase() === 'draft';
      const hasNoAssignedOrdinances = (assignedOrdRows || []).length === 0;

      const complaintTags = complaintForAutoPopulate?.tags;

      if (isCurrentlyDraft && hasNoAssignedOrdinances && Array.isArray(complaintTags) && ordinancesData) {
        const selectedSubs = listSelectedSubcategories(complaintTags);
        if (selectedSubs.length > 0) {
          const ordinancesToAdd = [];

          for (const sub of selectedSubs) {
            const ordinanceData = getOrdinancesForSubcategory(sub);
            for (const ord of ordinanceData) {
              // Find the ordinance record by code_number
              const ordinanceRecord = ordinancesData.find((o) => o.code_number === ord.code_number);
              if (ordinanceRecord && !ordinancesToAdd.includes(ordinanceRecord.id)) {
                ordinancesToAdd.push(ordinanceRecord.id);
              }
            }
          }

          // Insert the ordinances if any were found
          if (ordinancesToAdd.length > 0) {
            const inserts = ordinancesToAdd.map((ordinanceId) => ({
              mission_order_id: missionOrderId,
              ordinance_id: ordinanceId,
            }));

            const { error: insertError } = await supabase.from('mission_order_ordinances').insert(inserts);

            if (!insertError) {
              setAssignedOrdinanceIds(ordinancesToAdd);
              setToast(`${ordinancesToAdd.length} ordinance(s) auto-populated from complaint`);
            }
          }
        }
      }

      // If doc exists, default open the preview panel (reduces clicks)
      if (mo?.generated_docx_url) {
        setDocxPreviewOpen(true);
      }
    } catch (e) {
      setError(e?.message || 'Failed to load mission order.');
      setMissionOrder(null);
      setComplaint(null);
      setBusiness(null);
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

  // Smart inspector recommendations: recompute when business/barangay changes.
  useEffect(() => {
    const businessPk = complaint?.business_pk ? Number(complaint.business_pk) : null;
    const brgyNo = business?.brgy_no ? String(business.brgy_no) : null;

    // If we don't have primary filters, don’t show stale recommendations.
    if (!businessPk && !brgyNo) {
      setSmartInspectorRows([]);
      return;
    }

    const seq = ++smartInspectorsSeqRef.current;
    setSmartInspectorsLoading(true);

    (async () => {
      try {
        const { data, error } = await supabase.rpc('get_inspector_smart_recommendations', {
          p_business_pk: businessPk,
          p_brgy_no: brgyNo,
          p_exclude_mission_order_id: missionOrderId,
        });
        if (seq !== smartInspectorsSeqRef.current) return;
        if (error) throw error;
        setSmartInspectorRows(Array.isArray(data) ? data : []);
      } catch (e) {
        if (seq !== smartInspectorsSeqRef.current) return;
        // Don’t hard-fail the editor if recommendations aren’t available yet (e.g., migration not applied).
        setSmartInspectorRows([]);
        console.warn('Smart inspector recommendations unavailable:', e);
      } finally {
        if (seq === smartInspectorsSeqRef.current) setSmartInspectorsLoading(false);
      }
    })();
  }, [complaint?.business_pk, business?.brgy_no, missionOrderId]);

  // Fallback workload stats: keeps "active workload" accurate even when RPC isn't present.
  useEffect(() => {
    const seq = ++workloadSeqRef.current;

    (async () => {
      try {
        const { data: assignments, error: aErr } = await supabase
          .from('mission_order_assignments')
          .select('inspector_id, mission_order_id');
        if (aErr) throw aErr;

        const moIds = Array.from(new Set((assignments || []).map((r) => r.mission_order_id).filter(Boolean)));
        const { data: mos, error: moErr } = moIds.length
          ? await supabase
              .from('mission_orders')
              .select('id, status')
              .in('id', moIds)
          : { data: [], error: null };
        if (moErr) throw moErr;

        const isActiveStatus = (s) => {
          const v = String(s || '').toLowerCase();
          // Treat only truly "in-progress" mission orders as active.
          // Exclude states that should not contribute to inspector workload balancing.
          return !['complete', 'completed', 'cancelled', 'canceled', 'draft', 'issued', 'awaiting_signature'].includes(v);
        };

        const inactive = new Set(
          (mos || [])
            .filter((mo) => !isActiveStatus(mo.status))
            .map((mo) => mo.id)
        );

        // Count DISTINCT mission orders per inspector (avoid double counting if duplicates exist).
        const moSetByInspector = new Map();
        for (const row of assignments || []) {
          const inspectorId = row?.inspector_id;
          const moId = row?.mission_order_id;
          if (!inspectorId || !moId) continue;
          if (inactive.has(moId)) continue;
          if (!moSetByInspector.has(inspectorId)) moSetByInspector.set(inspectorId, new Set());
          moSetByInspector.get(inspectorId).add(moId);
        }

        const counts = new Map(Array.from(moSetByInspector.entries()).map(([inspectorId, s]) => [inspectorId, s.size]));

        if (seq !== workloadSeqRef.current) return;
        setInspectorActiveWorkloadById(counts);
      } catch (e) {
        if (seq !== workloadSeqRef.current) return;
        console.warn('Fallback workload stats unavailable:', e);
        setInspectorActiveWorkloadById(new Map());
      }
    })();
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
        return code || id;
      })
      .filter(Boolean);
  }, [assignedOrdinanceIds, ordinances]);

  const canSave = !loading && !!missionOrderId && !isReadOnly;
  const canSubmit = canSave && assignedInspectorIds.length > 0 && !!dateOfInspection;
  const isDraft = statusLower === 'draft';
  // Allow generating an UNSIGNED doc even after submit (issued), so the director can see the latest draft output.
  // Director approval will overwrite it with the SIGNED template automatically.
  const canGenerateDocx = !loading && !!missionOrderId && !isReadOnly && (isDraft || isSubmitted);

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

      // Notify Director when mission order is submitted
      try {
        await notifyDirectorMissionOrderSubmitted(
          missionOrderId,
          missionOrder?.complaint_id,
          complaint?.business_name || 'Unknown Business'
        );
      } catch (notifErr) {
        console.error('Failed to send notification:', notifErr);
        // Don't fail the submission if notification fails
      }

      setToast('Submitted');
    } catch (e) {
      setError(e?.message || 'Failed to submit to Director.');
    } finally {
      setSubmitting(false);
    }
  };

  const addInspector = async () => {
    const inspectorId = selectedInspectorId;
    if (!missionOrderId || !inspectorId) return;

    setError('');
    setToast('');

    try {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      const userId = userData?.user?.id;
      if (!userId) throw new Error('Not authenticated. Please login again.');

      const { data: existing, error: existingError } = await supabase
        .from('mission_order_assignments')
        .select('id')
        .eq('mission_order_id', missionOrderId)
        .eq('inspector_id', inspectorId)
        .limit(1);
      if (existingError) throw existingError;
      if (existing && existing.length > 0) {
        setToast('Already added');
        setSelectedInspectorId('');
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

  // Auto-add inspector on selection (no need to click the Add button)
  useEffect(() => {
    if (!selectedInspectorId) return;
    if (loading) return;

    // Avoid re-adding if it's already assigned; still clear selection to reduce friction.
    if (assignedInspectorIds.includes(selectedInspectorId)) {
      setSelectedInspectorId('');
      setInspectorQuery('');
      return;
    }

    // Fire and forget; addInspector handles its own error/toast states.
    void addInspector();

    // Clear query and keep focus for rapid multi-add.
    setInspectorQuery('');
    setInspectorDropdownOpen(true);
    queueMicrotask(() => inspectorInputRef.current?.focus());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedInspectorId]);

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

  // Close dropdowns on outside click / Escape
  useEffect(() => {
    const onDocMouseDown = (e) => {
      const t = e.target;

      const inInspectorInput = inspectorInputRef.current && inspectorInputRef.current.contains(t);
      const inInspectorDropdown = inspectorDropdownRef.current && inspectorDropdownRef.current.contains(t);
      if (!inInspectorInput && !inInspectorDropdown) setInspectorDropdownOpen(false);

      const inOrdInput = ordinanceInputRef.current && ordinanceInputRef.current.contains(t);
      const inOrdDropdown = ordinanceDropdownRef.current && ordinanceDropdownRef.current.contains(t);
      if (!inOrdInput && !inOrdDropdown) setOrdinanceDropdownOpen(false);
    };

    const onDocKeyDown = (e) => {
      if (e.key === 'Escape') {
        setInspectorDropdownOpen(false);
        setOrdinanceDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onDocKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keydown', onDocKeyDown);
    };
  }, []);

  const addOrdinance = async () => {
    const ordinanceId = selectedOrdinanceId;
    if (!missionOrderId || !ordinanceId) return;

    setError('');
    setToast('');

    try {
      const { data: existing, error: existingError } = await supabase
        .from('mission_order_ordinances')
        .select('id')
        .eq('mission_order_id', missionOrderId)
        .eq('ordinance_id', ordinanceId)
        .limit(1);
      if (existingError) throw existingError;
      if (existing && existing.length > 0) {
        setToast('Already added');
        setSelectedOrdinanceId('');
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

  // Auto-add ordinance on selection (no need to click the Add button)
  useEffect(() => {
    if (!selectedOrdinanceId) return;
    if (loading) return;

    if (assignedOrdinanceIds.includes(selectedOrdinanceId)) {
      setSelectedOrdinanceId('');
      return;
    }

    void addOrdinance();

    // Clear query and keep focus for rapid multi-add.
    setOrdinanceQuery('');
    setOrdinanceDropdownOpen(true);
    queueMicrotask(() => ordinanceInputRef.current?.focus());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedOrdinanceId]);

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
        date_of_complaint: complaint?.created_at,
        date_of_inspection: inspectionDate,
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

  const maybeAutoRegenerateDocx = ({ ensureSaved } = {}) => {
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
        // Keep DB state in sync so the doc generation (which re-reads from DB) uses the new inspection date.
        if (ensureSaved) {
          await saveMissionOrder();
        }

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

  // Auto-regenerate docx when the inspection date changes (same behavior as inspectors/ordinances).
  useEffect(() => {
    if (loading) return;
    if (isReadOnly) return;
    if (!missionOrder?.generated_docx_url) return;

    // Only regenerate if the date is set (optional: remove this guard if you want clearing date to also regenerate)
    if (!dateOfInspection) return;

    // Ensure date is saved before regeneration so the template reads the latest value.
    maybeAutoRegenerateDocx({ ensureSaved: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateOfInspection]);

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
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'nowrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', flex: '0 0 auto' }}>
                    <button
                      type="button"
                      onClick={() => {
                        window.location.assign(`/dashboard/head-inspector#${sourceTab}`);
                      }}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '6px 10px',
                        background: 'transparent',
                        border: 'none',
                        borderRadius: 8,
                        color: '#334155',
                        fontWeight: 800,
                        fontSize: 14,
                        textDecoration: 'none',
                        cursor: 'pointer',
                        transition: 'background 0.2s ease, color 0.2s ease',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = '#f1f5f9';
                        e.currentTarget.style.color = '#0f172a';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'transparent';
                        e.currentTarget.style.color = '#334155';
                      }}
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ display: 'block' }}>
                        <path d="M15 18L9 12L15 6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      Back
                    </button>
                  </div>

                  <span aria-hidden="true" style={{ width: 1, height: 36, background: '#e2e8f0', display: 'inline-block', marginTop: 2 }} />

                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 1000, fontSize: 20, color: '#0f172a' }}>Mission Order</div>
                    <div style={{ color: '#475569', fontWeight: 800, marginTop: 6, fontSize: 14 }}>
                      {complaint?.business_name || '—'}
                    </div>
                    {null}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                  {!isApproved && !isSubmitted && !isAwaitingSignature && !isComplete ? (
                    <>
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
                  ) : null}
                </div>
              </div>

              {toast ? <div className="dash-alert dash-alert-success" style={{ marginTop: 14 }}>{toast}</div> : null}
              {error ? <div className="dash-alert dash-alert-error" style={{ marginTop: 14 }}>{error}</div> : null}

              {/* Status Ribbon */}
              <div
                id="mo-status-ribbon"
                style={{
                  marginTop: 12,
                  marginBottom: 14,
                  display: 'grid',
                  gridTemplateColumns: '1fr',
                  gap: 12,
                  padding: '14px 16px',
                  border: '1px solid #0b2249',
                  borderRadius: 14,
                  background: 'linear-gradient(90deg, #1e3a8a 0%, #0b2249 100%)',
                  color: '#fff',
                  boxShadow: '0 8px 16px rgba(2,6,23,0.25)',
                }}
              >
                {/* make all ribbon icons white */}
                <style>{`
#mo-status-ribbon span[aria-hidden="true"] { color: #fff !important; opacity: 0.95; }
#mo-status-ribbon span[aria-hidden="true"] svg path { fill: #fff !important; stroke: #fff !important; }
`}</style>

                {/* Row 1: labels only */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
                    gap: 18,
                    rowGap: 0,
                    marginBottom: -4,
                    alignItems: 'center',
                    width: '100%',
                  }}
                >
                  {/* MO Status */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  <span aria-hidden="true" style={{ color: '#0b2249' }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M7 2h7l5 5v15a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm7 1.5V8h4.5L14 3.5Z" fill="#0b2249"/>
                      <path d="M8 12h8a1 1 0 1 0 0-2H8a1 1 0 1 0 0 2Zm0 4h8a1 1 0 1 0 0-2H8a1 1 0 1 0 0 2Z" fill="#0b2249"/>
                    </svg>
                  </span>
                  <span style={{ color: 'rgba(255,255,255,0.8)', fontWeight: 900, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4 }}>MO Status</span>
                </div>
                {/* Inspectors */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  <span aria-hidden="true" style={{ color: '#0b2249' }}>
                    {/* User icon */}
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M12 12c2.761 0 5-2.686 5-6s-2.239-5-5-5-5 2.686-5 6 2.239 5 5 5Zm0 2c-4.418 0-8 2.239-8 5v1h16v-1c0-2.761-3.582-5-8-5Z" fill="#0b2249"/>
                    </svg>
                  </span>
                  <span style={{ color: 'rgba(255,255,255,0.8)', fontWeight: 900, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4 }}>Inspectors</span>
                </div>

                {/* Inspection Date */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  <span aria-hidden="true" style={{ color: '#0b2249' }}>
                    {/* Calendar icon */}
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M7 2a1 1 0 0 1 1 1v1h8V3a1 1 0 1 1 2 0v1h1a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h1V3a1 1 0 1 1 2 0v1Zm13 7H4v10a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9ZM5 7h14V6H5v1Z" fill="#0b2249"/>
                    </svg>
                  </span>
                  <span style={{ color: 'rgba(255,255,255,0.8)', fontWeight: 900, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4 }}>Inspection Date</span>
                </div>

                {/* Issuance Date */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  <span aria-hidden="true" style={{ color: '#0b2249' }}>
                    {/* Calendar icon (reuse) */}
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M7 2a1 1 0 0 1 1 1v1h8V3a1 1 0 1 1 2 0v1h1a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h1V3a1 1 0 1 1 2 0v1Zm13 7H4v10a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9ZM5 7h14V6H5v1Z" fill="#0b2249"/>
                    </svg>
                  </span>
                  <span style={{ color: 'rgba(255,255,255,0.8)', fontWeight: 900, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4 }}>Issuance Date</span>
                </div>
                </div>

                {/* Row 2: values */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
                    gap: 18,
                    rowGap: 0,
                    marginTop: -6,
                    alignItems: 'center',
                    width: '100%',
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <span className={statusBadgeClass(missionOrder?.status)} style={{ fontWeight: 900 }}>
                      {statusLabel(missionOrder?.status)}
                    </span>
                  </div>
                  <div style={{ minWidth: 0, color: '#fff', fontWeight: 900, fontSize: 14 }}>{assignedInspectorNames || '—'}</div>
                  <div style={{ minWidth: 0, color: '#fff', fontWeight: 900, fontSize: 14 }}>{dateOfInspection ? formatDateHuman(dateOfInspection) : '—'}</div>
                  <div style={{ minWidth: 0, color: '#fff', fontWeight: 900, fontSize: 14 }}>{missionOrder?.date_of_issuance ? formatDateHuman(missionOrder.date_of_issuance) : 'N/A'}</div>
                </div>

                {/* Row 3: ordinances */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span aria-hidden="true" style={{ color: '#fff', opacity: 0.95, paddingTop: 1 }}>
                    {/* Document icon */}
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M7 2h7l5 5v15a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm7 1.5V8h4.5L14 3.5ZM8 12h8a1 1 0 1 0 0-2H8a1 1 0 1 0 0 2Zm0 4h8a1 1 0 1 0 0-2H8a1 1 0 1 0 0 2Z" fill="#0b2249"/>
                    </svg>
                  </span>
                  <span style={{ color: 'rgba(255,255,255,0.8)', fontWeight: 900, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4 }}>Ordinances:</span>
                  {Array.isArray(assignedOrdinanceLabels) && assignedOrdinanceLabels.length > 0 ? (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {assignedOrdinanceLabels.map((code) => (
                        <span
                          key={code}
                          style={{
                            background: 'rgba(255,255,255,0.12)',
                            border: '1px solid rgba(255,255,255,0.16)',
                            color: '#fff',
                            fontWeight: 900,
                            fontSize: 13,
                            padding: '4px 8px',
                            borderRadius: 999,
                            lineHeight: 1.2,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {code}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span style={{ color: '#fff', fontWeight: 900, fontSize: 14 }}>—</span>
                  )}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 18, alignItems: 'start' }}>
                <div style={{ display: 'grid', gap: 14, alignSelf: 'start' }}>
                <Panel title="Mission Order Details">
                  <div style={{ display: 'grid', gap: 16 }}>
                  {/* 1) Inspectors (editable) */}
                  <div>
                    <div style={{ fontWeight: 900, fontSize: 13, color: '#0f172a' }}>Inspectors</div>

                    <div
                      className="mo-multi-select"
                      style={{ marginTop: 10, position: 'relative' }}
                      role="combobox"
                      aria-expanded={inspectorDropdownOpen}
                      aria-haspopup="listbox"
                      onMouseDown={(e) => {
                        // Keep focus on the input when clicking within the container.
                        if (e.target === e.currentTarget) {
                          e.preventDefault();
                          inspectorInputRef.current?.focus();
                        }
                      }}
                    >
                      {/* Pills */}
                      {assignedInspectorIds.map((id) => {
                        const ins = inspectors.find((x) => x.id === id);
                        const label = ins?.full_name || id;
                        return (
                          <span key={id} className="mo-pill">
                            <span className="mo-pill-label">{label}</span>
                            {!isReadOnly ? (
                              <button
                                type="button"
                                className="mo-pill-x"
                                aria-label={`Remove ${label}`}
                                onClick={() => removeInspector(id)}
                                disabled={loading}
                              >
                                ×
                              </button>
                            ) : null}
                          </span>
                        );
                      })}

                      {/* Inline search input */}
                      {!isReadOnly ? (
                        <input
                          ref={inspectorInputRef}
                          className="mo-multi-select-input"
                          value={inspectorQuery}
                          onChange={(e) => {
                            setInspectorQuery(e.target.value);
                            setInspectorDropdownOpen(true);
                          }}
                          onFocus={() => setInspectorDropdownOpen(true)}
                          onKeyDown={(e) => {
                            if (e.key === 'Backspace' && !inspectorQuery && assignedInspectorIds.length > 0) {
                              // Quick remove last pill
                              const lastId = assignedInspectorIds[assignedInspectorIds.length - 1];
                              void removeInspector(lastId);
                            }
                          }}
                          disabled={loading}
                          placeholder={assignedInspectorIds.length ? 'Add more…' : 'Search inspectors…'}
                          aria-label="Search inspectors"
                        />
                      ) : null}

                      {/* Dropdown */}
                      {(() => {
                        if (isReadOnly || !inspectorDropdownOpen) return null;

                        const availableInspectors = inspectors.filter((ins) => !assignedInspectorIds.includes(ins.id));
                        // If all inspectors are already selected, don’t show an empty dropdown.
                        if (availableInspectors.length === 0) return null;

                        const q = inspectorQuery.trim().toLowerCase();
                        const smartById = new Map((smartInspectorRows || []).map((r) => [r.inspector_id, r]));

                        const enrichedInspectorsRaw = availableInspectors
                          .map((ins) => {
                            const smart = smartById.get(ins.id) || null;
                            const isBlocked = !!smart?.rule1_blocked;
                            const rank = typeof smart?.recommended_rank === 'number' ? smart.recommended_rank : null;
                            const isTop = !!smart?.is_top_recommended;
                            const reason = smart?.rule1_reason || '';
                            const activePending = typeof smart?.active_pending_count === 'number'
                              ? smart.active_pending_count
                              : (typeof inspectorActiveWorkloadById?.get?.(ins.id) === 'number' ? inspectorActiveWorkloadById.get(ins.id) : null);
                            const idleDays = typeof smart?.idle_days === 'number' ? smart.idle_days : null;
                            return { ...ins, smart, isBlocked, rank, isTop, reason, activePending, idleDays };
                          })
                          .filter((ins) => {
                            if (!q) return true;
                            return String(ins.full_name || '').toLowerCase().includes(q);
                          });

                        // Fallback ranking (client-side) if RPC didn't return ranks.
                        // Uses the same idea: (1) lowest active workload, (2) highest idle time, (3) name.
                        const needsClientRanking = enrichedInspectorsRaw.some((x) => !x.isBlocked && typeof x.rank !== 'number');

                        const enrichedInspectors = (needsClientRanking
                          ? (() => {
                              const eligible = enrichedInspectorsRaw
                                .filter((x) => !x.isBlocked)
                                .slice()
                                .sort((a, b) => {
                                  // Least active first (load balancing)
                                  const aActive = typeof a.activePending === 'number' ? a.activePending : Number.POSITIVE_INFINITY;
                                  const bActive = typeof b.activePending === 'number' ? b.activePending : Number.POSITIVE_INFINITY;
                                  if (aActive !== bActive) return aActive - bActive;

                                  // If tie, prefer MORE idle (hasn't completed recently)
                                  const aIdle = typeof a.idleDays === 'number' ? a.idleDays : -1;
                                  const bIdle = typeof b.idleDays === 'number' ? b.idleDays : -1;
                                  if (aIdle !== bIdle) return bIdle - aIdle;

                                  return String(a.full_name || '').localeCompare(String(b.full_name || ''));
                                })
                                .map((x, idx) => ({
                                  ...x,
                                  rank: typeof x.rank === 'number' ? x.rank : idx + 1,
                                  isTop: !!x.isTop || (typeof x.rank !== 'number' && idx === 0),
                                }));

                              const blocked = enrichedInspectorsRaw
                                .filter((x) => x.isBlocked)
                                .slice()
                                .sort((a, b) => String(a.full_name || '').localeCompare(String(b.full_name || '')));

                              return [...eligible, ...blocked];
                            })()
                          : enrichedInspectorsRaw.slice().sort((a, b) => {
                              // Prefer smart ordering when available; otherwise fallback to name sort.
                              const ar = a.rank;
                              const br = b.rank;
                              if (typeof ar === 'number' && typeof br === 'number') return ar - br;
                              if (typeof ar === 'number') return -1;
                              if (typeof br === 'number') return 1;
                              return String(a.full_name || '').localeCompare(String(b.full_name || ''));
                            }));

                        return (
                          <div ref={inspectorDropdownRef} className="mo-multi-select-dropdown" role="listbox">
                            {smartInspectorsLoading ? (
                              <div className="mo-multi-select-empty">Updating recommendations…</div>
                            ) : null}

                            {enrichedInspectors.slice(0, 12).map((ins) => {
                              const label = ins.full_name || ins.id;
                              const tip = ins.isBlocked
                                ? (ins.reason || 'Rotation limit reached this month for this Business or Barangay.')
                                : ins.isTop
                                  ? 'Top Recommended based on workload + idle time.'
                                  : '';

                              const metaParts = [];
                              if (typeof ins.activePending === 'number') metaParts.push(`${ins.activePending} active`);
                              if (typeof ins.idleDays === 'number') metaParts.push(`${ins.idleDays}d idle`);
                              const meta = metaParts.join(' • ');

                              const isRecommended = !ins.isBlocked && typeof ins.rank === 'number' && ins.rank <= 3;

                              return (
                                <button
                                  key={ins.id}
                                  type="button"
                                  className={[
                                    'mo-multi-select-option',
                                    ins.isBlocked ? 'mo-multi-select-option--disabled' : '',
                                    ins.isTop ? 'mo-multi-select-option--top' : '',
                                  ]
                                    .filter(Boolean)
                                    .join(' ')}
                                  onMouseDown={(e) => e.preventDefault()}
                                  onClick={() => (ins.isBlocked ? null : setSelectedInspectorId(ins.id))}
                                  disabled={ins.isBlocked}
                                  title={tip}
                                >
                                  <div className="mo-multi-select-option-row">
                                    <div className="mo-multi-select-option-name">
                                      {label}
                                      {ins.isTop ? <span className="mo-multi-select-badge">Most Recommended</span> : null}
                                      {!ins.isTop && isRecommended ? <span className="mo-multi-select-badge">Recommended</span> : null}
                                      {ins.isBlocked ? <span className="mo-multi-select-badge mo-multi-select-badge--muted">Rotation limit</span> : null}
                                    </div>
                                    {meta ? <div className="mo-multi-select-option-meta">{meta}</div> : null}
                                  </div>
                                </button>
                              );
                            })}

                            {enrichedInspectors.length === 0 ? (
                              <div className="mo-multi-select-empty">No matches.</div>
                            ) : null}
                          </div>
                        );
                      })()}
                    </div>

                    {assignedInspectorIds.length === 0 ? (
                      <div style={{ marginTop: 10, color: '#64748b', fontWeight: 800 }}>No inspectors assigned yet.</div>
                    ) : null}
                  </div>
                  
                                    
                  {/* 2) City ordinances violated (editable) */}
                  <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 12 }}>
                    <div style={{ fontWeight: 900, fontSize: 13, color: '#0f172a' }}>City Ordinances Violated</div>

                    {/* Pills stacked vertically, search on a new line */}
                    <div
                      className="mo-multi-select mo-multi-select--stacked"
                      style={{ marginTop: 10, position: 'relative' }}
                      role="combobox"
                      aria-expanded={ordinanceDropdownOpen}
                      aria-haspopup="listbox"
                      onMouseDown={(e) => {
                        if (e.target === e.currentTarget) {
                          e.preventDefault();
                          ordinanceInputRef.current?.focus();
                        }
                      }}
                    >
                      {assignedOrdinanceIds.map((id) => {
                        const o = ordinances.find((x) => x.id === id);
                        const code = o?.code_number ? String(o.code_number).trim() : '';
                        const title = o?.title ? String(o.title).trim() : '';
                        const label = o ? (code && title ? `${code} - ${title}` : code || title || id) : id;
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

                      {!isReadOnly ? (
                        <div className="mo-multi-select-row">
                          <input
                            ref={ordinanceInputRef}
                            className="mo-multi-select-input"
                            value={ordinanceQuery}
                            onChange={(e) => {
                              setOrdinanceQuery(e.target.value);
                              setOrdinanceDropdownOpen(true);
                            }}
                            onFocus={() => setOrdinanceDropdownOpen(true)}
                            onKeyDown={(e) => {
                              if (e.key === 'Backspace' && !ordinanceQuery && assignedOrdinanceIds.length > 0) {
                                const lastId = assignedOrdinanceIds[assignedOrdinanceIds.length - 1];
                                void removeOrdinance(lastId);
                              }
                            }}
                            disabled={loading}
                            placeholder={assignedOrdinanceIds.length ? 'Add more…' : 'Search ordinances…'}
                            aria-label="Search ordinances"
                          />

                          {(() => {
                            if (isReadOnly || !ordinanceDropdownOpen) return null;

                            const availableOrdinances = ordinances.filter((o) => !assignedOrdinanceIds.includes(o.id));
                            if (availableOrdinances.length === 0) return null;

                            const q = ordinanceQuery.trim().toLowerCase();
                            const filteredOrdinances = availableOrdinances.filter((o) => {
                              if (!q) return true;
                              const code = o.code_number ? String(o.code_number) : '';
                              const title = o.title ? String(o.title) : '';
                              return (
                                code.toLowerCase().includes(q) ||
                                title.toLowerCase().includes(q) ||
                                `${code} - ${title}`.toLowerCase().includes(q)
                              );
                            });

                            return (
                              <div ref={ordinanceDropdownRef} className="mo-multi-select-dropdown" role="listbox">
                                {filteredOrdinances.slice(0, 10).map((o) => {
                                  const code = o.code_number ? String(o.code_number).trim() : '';
                                  const title = o.title ? String(o.title).trim() : '';
                                  const label = code && title ? `${code} - ${title}` : code || title || o.id;
                                  return (
                                    <button
                                      key={o.id}
                                      type="button"
                                      className="mo-multi-select-option"
                                      onMouseDown={(e) => e.preventDefault()}
                                      onClick={() => setSelectedOrdinanceId(o.id)}
                                    >
                                      {label}
                                    </button>
                                  );
                                })}

                                {filteredOrdinances.length === 0 ? (
                                  <div className="mo-multi-select-empty">No matches.</div>
                                ) : null}
                              </div>
                            );
                          })()}
                        </div>
                      ) : null}
                    </div>

                    {assignedOrdinanceIds.length === 0 ? (
                      <div style={{ marginTop: 10, color: '#64748b', fontWeight: 800 }}>No ordinances added yet.</div>
                    ) : null}
                  </div>

                  {/* Dates side-by-side */}
                  <div className="mo-row-2" style={{ borderTop: '1px solid #e2e8f0', paddingTop: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                    <div>
                      <label className="mo-label" htmlFor="dateInspection" style={{ fontSize: 13 }}>Date of Inspection</label>
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => {
                          // Open the native date picker while keeping a human-readable display.
                          const el = document.getElementById('dateInspectionHidden');
                          if (el?.showPicker) el.showPicker();
                          else el?.focus();
                          el?.click?.();
                        }}
                        onKeyDown={(e) => {
                          if (e.key !== 'Enter' && e.key !== ' ') return;
                          e.preventDefault();
                          const el = document.getElementById('dateInspectionHidden');
                          if (el?.showPicker) el.showPicker();
                          else el?.focus();
                          el?.click?.();
                        }}
                        style={{
                          height: 46,
                          borderRadius: 14,
                          background: '#f8fafc',
                          border: '1px solid #e2e8f0',
                          padding: '0 12px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          cursor: 'pointer',
                          userSelect: 'none',
                        }}
                      >
                        <span aria-hidden="true" style={{ color: '#64748b', display: 'inline-flex', alignItems: 'center' }}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M7 2a1 1 0 0 1 1 1v1h8V3a1 1 0 1 1 2 0v1h1a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h1V3a1 1 0 1 1 2 0v1Zm13 7H4v10a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9ZM5 7h14V6H5v1Z" fill="currentColor"/>
                          </svg>
                        </span>

                        <span style={{ flex: 1, minWidth: 0, fontSize: 16, fontWeight: 900, color: '#0f172a' }}>
                          {dateOfInspection ? formatDateHuman(dateOfInspection) : 'Select date'}
                        </span>

                        {/* Hidden native date input (keeps same functionality and value format in state) */}
                        <input
                          id="dateInspectionHidden"
                          type="date"
                          value={dateOfInspection}
                          onChange={(e) => setDateOfInspection(e.target.value)}
                          disabled={loading || isReadOnly}
                          style={{
                            position: 'absolute',
                            opacity: 0,
                            pointerEvents: 'none',
                            width: 1,
                            height: 1,
                          }}
                        />

                                              </div>
                    </div>
                    <div>
                      <label className="mo-label" htmlFor="dateIssuance" style={{ fontSize: 13 }}>Date of Issuance</label>
                      <input
                        id="dateIssuance"
                        className="mo-input-readonly"
                        value={missionOrder?.date_of_issuance ? formatDateHuman(missionOrder.date_of_issuance) : 'N/A'}
                        readOnly
                        style={{ width: '100%', height: 46, borderRadius: 14, border: '1px solid #e2e8f0', background: '#fff', padding: '0 12px', fontWeight: 700, color: '#94a3b8', fontSize: 16 }}
                      />
                    </div>
                  </div>
                </div>
                </Panel>

                {/* Unified DOCX actions inside the Preview panel header */}
                <Panel
                  title="Document Preview"
                  right={
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                      {!isComplete ? (
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
                      ) : null}

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
                    </div>
                  }
                >
                  {!missionOrder?.generated_docx_url ? (
                    <div style={{ color: '#64748b', fontWeight: 800 }}>
                      No generated document yet. {isDraft ? '(Preview only during draft)' : (!isApproved && !isAwaitingSignature ? '(Available after Director approval)' : '')}
                    </div>
                  ) : (
                    <div style={{ display: 'grid', gap: 10 }}>
                      <iframe
                        key={officeViewerUrl}
                        title="DOCX Preview"
                        src={officeViewerUrl}
                        style={{ width: '100%', height: 560, border: '1px solid #e2e8f0', borderRadius: 14, background: '#fff' }}
                        onError={() => setDocxPreviewError(true)}
                      />

                      {docxPreviewError ? (
                        <div className="dash-alert dash-alert-error">
                          Preview failed to load.
                        </div>
                      ) : null}

                                          </div>
                  )}
                </Panel>
                </div>

                <div style={{ display: 'grid', gap: 14, position: 'sticky', top: 14, alignSelf: 'start' }}>
                  <Panel
                    title="Business Complaint Reference"
                    subtitle={
                      <div style={{ display: 'grid', gap: 4 }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '96px 1fr', columnGap: 8, alignItems: 'baseline' }}>
                          <span style={{ fontSize: 10, fontWeight: 900, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 }}>Date | Time</span>
                          <span style={{ fontSize: 11, fontWeight: 800, color: '#334155' }}>
                            {complaint?.created_at
                              ? `${new Date(complaint.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })} | ${new Date(complaint.created_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`
                              : '—'}
                          </span>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '96px 1fr', columnGap: 8, alignItems: 'baseline' }}>
                          <span style={{ fontSize: 10, fontWeight: 900, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 }}>Email</span>
                          <span style={{ fontSize: 11, fontWeight: 800, color: '#334155', wordBreak: 'break-word' }}>
                            {complaint?.reporter_email || '—'}
                          </span>
                        </div>
                      </div>
                    }
                    right={
                      complaint?.id ? (
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              await navigator.clipboard.writeText(String(complaint.id));
                              setToast('Complaint ID copied');
                            } catch {
                              setToast('Failed to copy');
                            }
                          }}
                          title="Copy complaint ID"
                          aria-label="Copy complaint ID"
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 6,
                            padding: '4px 8px',
                            borderRadius: 8,
                            border: '1px solid #cbd5e1',
                            background: '#fff',
                            color: '#0f172a',
                            fontWeight: 900,
                            fontSize: 12,
                            cursor: 'pointer',
                            lineHeight: 1,
                            outline: 'none',
                          }}
                        >
                          <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace' }}>
                            {String(complaint.id).slice(0, 8)}…
                          </span>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ display: 'block' }}>
                            <path d="M16 1H6a2 2 0 0 0-2 2v12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                            <path d="M8 5h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        </button>
                      ) : null
                    }
                  >
                    <div style={{ display: 'grid', gap: 18 }}>
                      <div style={{ paddingBottom: 6 }}>
                        <div style={{ fontSize: 11, fontWeight: 900, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.6 }}>Business Name</div>
                        <div style={{ marginTop: 6, fontWeight: 900, color: '#0f172a', fontSize: 14 }}>
                          {complaint?.business_name || '—'}
                        </div>
                      </div>

                      <div style={{ paddingBottom: 6 }}>
                        <div style={{ fontSize: 11, fontWeight: 900, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.6 }}>Business Address</div>
                        <div style={{ marginTop: 6, fontWeight: 800, color: '#334155', fontSize: 13, lineHeight: 1.4 }}>
                          {complaint?.business_address || '—'}
                        </div>
                      </div>

                      <div style={{ paddingBottom: 6 }}>
                        <div style={{ fontSize: 11, fontWeight: 900, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.6 }}>Complaint Category</div>
                        {(() => {
                          const groups = groupComplaintCategoriesFromTags(complaint?.tags || []);
                          if (!groups.length) {
                            return <div style={{ marginTop: 6, fontWeight: 800, color: '#334155', fontSize: 13, lineHeight: 1.4 }}>—</div>;
                          }

                          return (
                            <ul style={{ marginTop: 8, marginBottom: 0, paddingLeft: 18, color: '#334155' }}>
                              {groups.map((g) => {
                                const category = g?.category || '—';
                                const subs = Array.isArray(g?.subs) ? g.subs.filter(Boolean) : [];
                                return (
                                  <li key={category} style={{ margin: '4px 0' }}>
                                    <div style={{ fontWeight: 900, fontSize: 13, lineHeight: 1.4 }}>{category}</div>
                                    {subs.length ? (
                                      <ul style={{ marginTop: 4, marginBottom: 0, paddingLeft: 18 }}>
                                        {subs.map((s) => (
                                          <li key={`${category}-${s}`} style={{ fontWeight: 600, fontSize: 13, lineHeight: 1.5, margin: '2px 0' }}>
                                            {s}
                                          </li>
                                        ))}
                                      </ul>
                                    ) : null}
                                  </li>
                                );
                              })}
                            </ul>
                          );
                        })()}
                      </div>

                      
                      
                      <div style={{ paddingTop: 6 }}>
                        <div style={{ fontSize: 11, fontWeight: 900, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.6 }}>Complaint Details</div>
                        <div style={{ marginTop: 10, fontWeight: 500, color: '#334155', fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                          {complaint?.complaint_description || '—'}
                        </div>
                      </div>

                      <div>
                        <div style={{ fontSize: 11, fontWeight: 900, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.6 }}>
                          Evidences{Array.isArray(complaint?.image_urls) && complaint.image_urls.length ? ` (${complaint.image_urls.length} photos)` : ''}
                        </div>
                        {Array.isArray(complaint?.image_urls) && complaint.image_urls.length > 0 ? (
                          <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                            {complaint.image_urls.filter(Boolean).map((url, idx) => (
                              <img
                                key={`${url}-${idx}`}
                                src={url}
                                alt={`Evidence ${idx + 1}`}
                                style={{ width: '100%', height: 110, objectFit: 'cover', borderRadius: 12, border: '1px solid #e2e8f0', cursor: 'zoom-in' }}
                                onClick={() => setEvidencePreviewUrl(url)}
                                title="Click to preview"
                              />
                            ))}
                          </div>
                        ) : (
                          <div style={{ marginTop: 8, fontWeight: 700, color: '#94a3b8', fontSize: 13 }}>—</div>
                        )}
                      </div>

                                          </div>

                  {evidencePreviewUrl ? (
                    <div
                      role="dialog"
                      aria-modal="true"
                      aria-label="Evidence photo preview"
                      onClick={() => setEvidencePreviewUrl('')}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') setEvidencePreviewUrl('');
                      }}
                      tabIndex={-1}
                      style={{
                        position: 'fixed',
                        inset: 0,
                        background: 'rgba(2,6,23,0.70)',
                        display: 'grid',
                        placeItems: 'center',
                        zIndex: 9999,
                        padding: 18,
                      }}
                    >
                      <div
                        style={{
                          width: 'min(980px, 96vw)',
                          maxHeight: '88vh',
                          background: '#0b1220',
                          borderRadius: 16,
                          border: '1px solid rgba(255,255,255,0.12)',
                          boxShadow: '0 30px 80px rgba(0,0,0,0.45)',
                          overflow: 'hidden',
                          position: 'relative',
                        }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          onClick={() => setEvidencePreviewUrl('')}
                          aria-label="Close preview"
                          style={{
                            position: 'absolute',
                            top: 12,
                            right: 12,
                            width: 44,
                            height: 44,
                            border: 'none',
                            outline: 'none',
                            boxShadow: 'none',
                            background: 'transparent',
                            color: '#fff',
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 26,
                            fontWeight: 900,
                            lineHeight: 1,
                            padding: 0,
                          }}
                        >
                          ×
                        </button>
                        <img
                          src={evidencePreviewUrl}
                          alt="Evidence preview"
                          style={{ width: '100%', height: '100%', maxHeight: '88vh', objectFit: 'contain', display: 'block' }}
                        />
                      </div>
                    </div>
                  ) : null}

                  </Panel>
                </div>
              </div>

              {loading ? <div style={{ marginTop: 12, color: '#64748b', fontWeight: 800 }}>Loading…</div> : null}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
