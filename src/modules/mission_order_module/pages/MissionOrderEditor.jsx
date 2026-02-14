import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import '../../dashboard_module/pages/Dashboard.css';
import './MissionOrderEditor.css';

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function applyAutoFieldsToHtml(html, { inspectorNames, businessName, businessAddress }) {
  // Keep fields in sync without requiring original placeholders.
  let next = String(html ?? '');

  const inspectorSpan = `<span data-mo-auto="inspectors" contenteditable="false" data-mo-locked="true">${escapeHtml(
    inspectorNames || ''
  )}</span>`;
  const businessNameSpan = `<span data-mo-auto="business_name" contenteditable="false" data-mo-locked="true">${escapeHtml(
    businessName || ''
  )}</span>`;
  const businessAddressSpan = `<span data-mo-auto="business_address" contenteditable="false" data-mo-locked="true">${escapeHtml(
    businessAddress || ''
  )}</span>`;

  const hasInspectorMarker = /data-mo-auto="inspectors"/.test(next);
  const hasBusinessNameMarker = /data-mo-auto="business_name"/.test(next);
  const hasBusinessAddressMarker = /data-mo-auto="business_address"/.test(next);

  // Update existing markers
  next = next.replace(/<span\s+data-mo-auto="inspectors"[^>]*>[\s\S]*?<\/span>/g, inspectorSpan);
  next = next.replace(/<span\s+data-mo-auto="business_name"[^>]*>[\s\S]*?<\/span>/g, businessNameSpan);
  next = next.replace(/<span\s+data-mo-auto="business_address"[^>]*>[\s\S]*?<\/span>/g, businessAddressSpan);

  // If the TO line already contains the inspector auto-marker, remove any separate standalone paragraph for it.
  if (/\<strong\>\s*TO:\s*\<\/strong\>[\s\S]*data-mo-auto="inspectors"/i.test(next)) {
    next = next.replace(
      /<p[^>]*>\s*(?:<br\s*\/?>(\s*)?)*<span\s+data-mo-auto="inspectors"[^>]*>[\s\S]*?<\/span>\s*<\/p>\s*/gi,
      ''
    );
  }

  // Back-compat placeholders
  if (inspectorNames) next = next.replaceAll('[INSPECTOR NAME]', inspectorSpan);
  if (businessName) next = next.replaceAll('[BUSINESS NAME]', businessNameSpan);
  if (businessAddress) next = next.replaceAll('[ADDRESS]', businessAddressSpan);

  // Inject into TO line if missing
  if (!hasInspectorMarker) {
    const toLine = /(<p[^>]*>\s*<strong>\s*TO:\s*<\/strong>)([\s\S]*?)(<\/p>)/i;
    if (toLine.test(next)) {
      next = next.replace(toLine, `$1 FIELD INSPECTOR ${inspectorSpan}$3`);
    }
  }

  // Inject into SUBJECT line if missing
  if (!hasBusinessNameMarker || !hasBusinessAddressMarker) {
    const subjectLine = /(<p[^>]*>\s*<strong>\s*SUBJECT:\s*<\/strong>)([\s\S]*?)(<\/p>)/i;
    if (subjectLine.test(next)) {
      const subjectText = ` TO CONDUCT INSPECTION ON THE BUSINESS ESTABLISHMENT IDENTIFIED AS ${businessNameSpan} WITH ADDRESS AT ${businessAddressSpan}`;
      next = next.replace(subjectLine, `$1${subjectText}$3`);
    }
  }

  // Final fallback: prepend auto section
  const missingAny =
    !/data-mo-auto="inspectors"/.test(next) ||
    !/data-mo-auto="business_name"/.test(next) ||
    !/data-mo-auto="business_address"/.test(next);

  if (missingAny) {
    const autoBlock = [
      '<div data-mo-auto-block="true" contenteditable="false" data-mo-locked="true" style="border: 1px dashed #cbd5e1; padding: 10px; border-radius: 8px; margin-bottom: 12px;">',
      '<p style="margin:0;"><strong>Assigned Inspectors:</strong> ',
      inspectorSpan,
      '</p>',
      '<p style="margin:6px 0 0 0;"><strong>Business:</strong> ',
      businessNameSpan,
      ' — ',
      businessAddressSpan,
      '</p>',
      '</div>',
    ].join('');

    const firstDivOpen = /<div[^>]*>/i;
    if (firstDivOpen.test(next)) {
      next = next.replace(firstDivOpen, (m) => `${m}${autoBlock}`);
    } else {
      next = `${autoBlock}${next}`;
    }
  }

  return next;
}

function getMissionOrderIdFromQuery() {
  const params = new URLSearchParams(window.location.search);
  return params.get('id');
}

export default function MissionOrderEditor() {
  const missionOrderId = useMemo(() => getMissionOrderIdFromQuery(), []);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');

  const [missionOrderStatus, setMissionOrderStatus] = useState('');
  const [directorComment, setDirectorComment] = useState('');
  const [reviewedAt, setReviewedAt] = useState(null);
  const [createdAt, setCreatedAt] = useState(null);
  const isApproved = String(missionOrderStatus || '').toLowerCase() === 'for inspection';
  const isReadOnly = isApproved;

  // Sidebar nav state (reused from dashboard)
  const [navCollapsed, setNavCollapsed] = useState(false);
  const readTabFromHash = () => {
    const h = (window.location.hash || '').replace(/^#/, '').trim().toLowerCase();
    if (h === 'issued' || h === 'for-inspection' || h === 'revisions' || h === 'todo') return h;
    return 'todo';
  };
  const [activeTabFromHash, setActiveTabFromHash] = useState(readTabFromHash());
  useEffect(() => {
    const onHash = () => setActiveTabFromHash(readTabFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const handleLogout = async () => {
    setError('');
    try {
      const { error: signOutError } = await supabase.auth.signOut({ scope: 'global' });
      if (signOutError) throw signOutError;
    } catch (e) {
      setError(e?.message || 'Logout failed. Clearing local session…');
    } finally {
      try {
        localStorage.clear();
        sessionStorage.clear();
      } catch {}
      window.location.replace('/login');
    }
  };

  const [isDirty, setIsDirty] = useState(false);
  const allowDirtyTrackingRef = useRef(false);
  const baselineRef = useRef({ title: '', content: '' });

  const [inspectors, setInspectors] = useState([]);
  const [assignedInspectorIds, setAssignedInspectorIds] = useState([]);
  const [selectedInspectorId, setSelectedInspectorId] = useState('');
  const [syncingAssignments, setSyncingAssignments] = useState(false);

  const [businessName, setBusinessName] = useState('');
  const [businessAddress, setBusinessAddress] = useState('');

  const [showComplaintSideBySide, setShowComplaintSideBySide] = useState(false);
  const [complaint, setComplaint] = useState(null);
  const [complaintLoading, setComplaintLoading] = useState(false);
  const [complaintError, setComplaintError] = useState('');

  const [submitting, setSubmitting] = useState(false);

  const editorRef = useRef(null);

  const [fmt, setFmt] = useState({ bold: false, italic: false, underline: false });
  const refreshFormatState = () => {
    try {
      const sel = window.getSelection?.();
      const node = sel?.anchorNode;
      const el = node?.nodeType === 1 ? node : node?.parentElement;
      const inEditor = !!(editorRef.current && el && editorRef.current.contains(el));
      if (!inEditor) {
        setFmt({ bold: false, italic: false, underline: false });
        return;
      }
      setFmt({
        bold: document.queryCommandState('bold'),
        italic: document.queryCommandState('italic'),
        underline: document.queryCommandState('underline'),
      });
    } catch {
      setFmt({ bold: false, italic: false, underline: false });
    }
  };

  useEffect(() => {
    const h = () => refreshFormatState();
    document.addEventListener('selectionchange', h);
    return () => document.removeEventListener('selectionchange', h);
  }, []);

  const applyCommand = (command, value = null) => {
    if (loading || isApproved) return;
    try {
      editorRef.current?.focus();
      document.execCommand(command, false, value);
      const next = editorRef.current?.innerHTML ?? '';
      setContent(next);
      markDirty(title, next);
    } catch {}
  };

  const assignedInspectorNames = useMemo(() => {
    const uniqueIds = Array.from(new Set(assignedInspectorIds.filter(Boolean)));
    return uniqueIds
      .map((id) => inspectors.find((x) => x.id === id)?.full_name)
      .filter(Boolean)
      .join(', ');
  }, [assignedInspectorIds, inspectors]);

  const syncAutoFieldsIntoEditor = ({ nextBusinessName, nextBusinessAddress, nextInspectorNames } = {}) => {
    if (!editorRef.current) return;
    const html = editorRef.current.innerHTML ?? '';
    const updated = applyAutoFieldsToHtml(html, {
      inspectorNames: nextInspectorNames ?? assignedInspectorNames,
      businessName: nextBusinessName ?? businessName,
      businessAddress: nextBusinessAddress ?? businessAddress,
    });
    if (updated === html) return;
    editorRef.current.innerHTML = updated;
    setContent(updated);
    markDirty(title, updated);
  };

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      if (!missionOrderId) {
        setError('Missing mission order id. Open this page as /mission-order?id=<uuid>');
        return;
      }
      setError('');
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from('mission_orders')
          .select('id, title, content, complaint_id, status, director_comment, reviewed_at, reviewed_by, created_at, updated_at')
          .eq('id', missionOrderId)
          .single();
        if (error) throw error;
        if (!mounted) return;

        setCreatedAt(data?.created_at ? new Date(data.created_at) : null);

        // Load business details
        const complaintId = data?.complaint_id;
        let loadedBusinessName = '';
        let loadedBusinessAddress = '';
        if (complaintId) {
          try {
            setComplaintError('');
            setComplaintLoading(true);
            const { data: complaintData, error: complaintLoadError } = await supabase
              .from('complaints')
              .select('*')
              .eq('id', complaintId)
              .single();
            if (complaintLoadError) throw complaintLoadError;
            if (!mounted) return;
            setComplaint(complaintData);
            loadedBusinessName = complaintData?.business_name || '';
            loadedBusinessAddress = complaintData?.business_address || '';
          } catch (ce) {
            if (!mounted) return;
            setComplaint(null);
            setComplaintError(ce?.message || 'Failed to load complaint details.');
          } finally {
            if (mounted) setComplaintLoading(false);
          }
        } else {
          setComplaint(null);
        }
        setBusinessName(loadedBusinessName);
        setBusinessAddress(loadedBusinessAddress);

        setMissionOrderStatus(data?.status || '');
        setDirectorComment(data?.director_comment || '');
        setReviewedAt(data?.reviewed_at ? new Date(data.reviewed_at) : null);

        // Inspectors list
        const { data: inspectorsData, error: inspectorsError } = await supabase
          .from('profiles')
          .select('id, full_name, role')
          .eq('role', 'inspector')
          .order('full_name', { ascending: true });
        if (inspectorsError) throw inspectorsError;
        if (!mounted) return;
        setInspectors(inspectorsData || []);

        // Assignments
        const { data: assignedRows, error: assignedError } = await supabase
          .from('mission_order_assignments')
          .select('id, inspector_id, assigned_at')
          .eq('mission_order_id', missionOrderId)
          .order('assigned_at', { ascending: true });
        if (assignedError) throw assignedError;
        if (!mounted) return;
        const loadedAssignedInspectorIds = Array.from(
          new Set((assignedRows || []).map((r) => r.inspector_id).filter(Boolean))
        );
        setAssignedInspectorIds(loadedAssignedInspectorIds);

        const loadedInspectorNames = loadedAssignedInspectorIds
          .map((id) => inspectorsData?.find((x) => x.id === id)?.full_name)
          .filter(Boolean)
          .join(', ');

        // Hydrate content
        allowDirtyTrackingRef.current = false;
        setIsDirty(false);

        const loadedTitle = data?.title || `Mission Order ${String(data?.id || '').slice(0, 8)}…`;
        const loadedContent =
          data?.content ||
          [
            '<div style="font-family: "Times New Roman", Times, serif; line-height: 1.25; font-size: 12px; color: #000;">',
            '<p style="text-align:center; font-size: 18px;"><strong>MISSION ORDER</strong></p>',
            '<br/>',
            '<p><strong>TO:</strong> FIELD INSPECTOR [INSPECTOR NAME]</p>',
            '<p><strong>SUBJECT:</strong> TO CONDUCT INSPECTION ON THE BUSINESS ESTABLISHMENT IDENTIFIED AS [BUSINESS NAME] WITH ADDRESS AT [ADDRESS]</p>',
            '<p><strong>DATE OF INSPECTION: </strong>[INSERT DATE]</p>',
            '<p><strong>DATE OF ISSUANCE: </strong>[INSERT DATE]</p>',
            '<br/>',
            '<p style="text-align:justify;">In the interest of public service, you are hereby ordered to conduct inspection of the aforementioned establishment, for the following purposes:</p>',
            '<p style="text-align:justify; padding-left: 40px;">a) To verify the existence and authenticity of the Business Permits and other applicable permits, certificates, and other necessary documents, the completeness of the requirements therein.</p>',
            '<p style="text-align:justify; padding-left: 40px;">b) To check actual business operation of the subject establishment.</p>',
            '<p style="text-align:justify; padding-left: 40px;">c) To check compliance of said establishment with existing laws, ordinance, regulations relative to health & sanitation, fire safety, engineering & electrical installation standards.</p>',
            '<br/>',
            '<p style="text-align:justify;">You are hereby directed to identify yourself by showing proper identification and act with due courtesy and politeness in the implementation of this Order. All inspectors shall wear their IDs in such manner as the public will be informed of their true identity.</p>',
            '<br/>',
            '<p style="text-align:justify;"><strong>You should also inform the owner or representative of the establishment being inspected that they may verify the authenticity of this Mission Order, or ask questions, or lodge complaints, thru our telephone number (02) 8527-0871 or email at permits@manila.gov.ph</strong></p>',
            '<br/>',
            '<p style="text-align:justify;">This Order is in effect until [INSERT DATE] and any Order inconsistent herewith is hereby revoked and/or amended accordingly.</p>',
            '<br/><br/>',
            '<table style="width: 100%; border: none; border-collapse: collapse;">',
            '<tr>',
            '<td style="width: 50%; vertical-align: top;">',
            '<p style="margin: 0;">Recommending approval:</p>',
            '<br/><br/>',
            '<p style="margin: 0;"><strong>LEVI FACUNDO</strong></p>',
            '<p style="margin: 0;">Director</p>',
            '</td>',
            '<td style="width: 50%; vertical-align: top;">',
            '<p style="margin: 0;">Approved by:</p>',
            '<br/><br/>',
            '<p style="margin: 0;"><strong>MANUEL M. ZARCAL</strong></p>',
            '<p style="margin: 0;">Secretary to the Mayor</p>',
            '</td>',
            '</tr>',
            '</table>',
            '</div>',
          ].join('');

        const hydratedContent = applyAutoFieldsToHtml(loadedContent, {
          inspectorNames: loadedInspectorNames,
          businessName: loadedBusinessName,
          businessAddress: loadedBusinessAddress,
        });

        baselineRef.current = { title: loadedTitle, content: hydratedContent };
        setTitle(loadedTitle);
        setContent(hydratedContent);

        if (editorRef.current) editorRef.current.innerHTML = hydratedContent;
      } catch (e) {
        if (!mounted) return;
        setError(e?.message || 'Failed to load mission order.');
      } finally {
        if (mounted) {
          setLoading(false);
          setTimeout(() => {
            allowDirtyTrackingRef.current = true;
          }, 0);
        }
      }
    };
    load();
    return () => {
      mounted = false;
    };
  }, [missionOrderId]);

  const computeDirty = (nextTitle, nextContent) => {
    const base = baselineRef.current;
    return base.title !== nextTitle || base.content !== nextContent;
  };

  const markDirty = (nextTitle, nextContent) => {
    if (!allowDirtyTrackingRef.current) return;
    setIsDirty(computeDirty(nextTitle, nextContent));
  };

  useEffect(() => {
    if (!editorRef.current || loading) return;
    const next = String(content ?? '');
    if (next && editorRef.current.innerHTML !== next) editorRef.current.innerHTML = next;
  }, [content, loading]);

  // Also refresh toolbar toggle states when content updates
  useEffect(() => { refreshFormatState(); }, [content]);

  useEffect(() => {
    if (!allowDirtyTrackingRef.current) return;
    syncAutoFieldsIntoEditor({ nextInspectorNames: assignedInspectorNames });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignedInspectorNames]);

  useEffect(() => {
    if (!allowDirtyTrackingRef.current) return;
    if (!businessName && !businessAddress) return;
    syncAutoFieldsIntoEditor({ nextBusinessName: businessName, nextBusinessAddress: businessAddress });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessName, businessAddress]);

  const loadAssignedInspectors = async () => {
    if (!missionOrderId) return;
    const { data: assignedRows, error: assignedError } = await supabase
      .from('mission_order_assignments')
      .select('id, inspector_id, assigned_at')
      .eq('mission_order_id', missionOrderId)
      .order('assigned_at', { ascending: true });
    if (assignedError) throw assignedError;
    const loadedIds = (assignedRows || []).map((r) => r.inspector_id);
    setAssignedInspectorIds(loadedIds);
    const nextNames = loadedIds
      .map((id) => inspectors.find((x) => x.id === id)?.full_name)
      .filter(Boolean)
      .join(', ');
    syncAutoFieldsIntoEditor({ nextInspectorNames: nextNames });
  };

  const addInspector = async () => {
    if (!missionOrderId || !selectedInspectorId) return;
    setError('');
    setToast('');
    setSyncingAssignments(true);
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
        setToast('Inspector already assigned.');
        return;
      }
      const { error: insertError } = await supabase.from('mission_order_assignments').insert([
        { mission_order_id: missionOrderId, inspector_id: inspectorId, assigned_by: userId },
      ]);
      if (insertError) throw insertError;
      setSelectedInspectorId('');
      await loadAssignedInspectors();
      setToast('Inspector added.');
    } catch (e) {
      setError(e?.message || 'Failed to add inspector.');
    } finally {
      setSyncingAssignments(false);
    }
  };

  const removeInspector = async (inspectorId) => {
    if (!missionOrderId) return;
    setError('');
    setToast('');
    setSyncingAssignments(true);
    try {
      const { data: deletedRows, error: delError } = await supabase
        .from('mission_order_assignments')
        .delete()
        .eq('mission_order_id', missionOrderId)
        .eq('inspector_id', inspectorId)
        .select('id');
      if (delError) throw delError;
      setAssignedInspectorIds((prev) => prev.filter((id) => id !== inspectorId));
      if (deletedRows && Array.isArray(deletedRows) && deletedRows.length === 0) {
        throw new Error('Remove failed: no rows deleted (check RLS).');
      }
      try { await loadAssignedInspectors(); } catch {}
      setToast('Inspector removed.');
    } catch (e) {
      setError(e?.message || 'Failed to remove inspector.');
    } finally {
      setSyncingAssignments(false);
    }
  };

  useEffect(() => {
    if (!missionOrderId) return;
    const channel = supabase
      .channel(`mo-assignments-${missionOrderId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'mission_order_assignments', filter: `mission_order_id=eq.${missionOrderId}` },
        () => {
          loadAssignedInspectors().catch(() => {});
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missionOrderId]);

  const saveMissionOrder = async () => {
    if (!missionOrderId) return;
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError) throw userError;
    const userId = userData?.user?.id;
    if (!userId) throw new Error('Not authenticated. Please login again.');
    const html = editorRef.current?.innerHTML ?? '';
    const { error } = await supabase
      .from('mission_orders')
      .update({ title: title || null, content: html, last_edited_by: userId, updated_at: new Date().toISOString() })
      .eq('id', missionOrderId);
    if (error) throw error;
    baselineRef.current = { title: title || '', content: html };
    setIsDirty(false);
  };

  const handleSave = async () => {
    if (!missionOrderId) return;
    setError('');
    setToast('');
    setSaving(true);
    try {
      await saveMissionOrder();
      setToast('Saved.');
    } catch (e) {
      setError(e?.message || 'Failed to save mission order.');
    } finally {
      setSaving(false);
    }
  };

  const handleSubmitToDirector = async () => {
    if (!missionOrderId) return;
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
      baselineRef.current = { title: title || '', content: editorRef.current?.innerHTML ?? '' };
      setIsDirty(false);
      setToast('Submitted to Director for review.');
    } catch (e) {
      setError(e?.message || 'Failed to submit to Director.');
    } finally {
      setSubmitting(false);
    }
  };

  const createdAtDisplay = useMemo(() => (createdAt ? createdAt.toLocaleDateString() : '—'), [createdAt]);

  return (
    <div className="dash-container">
      <main className="dash-main">
        <section className="dash-shell" style={{ paddingLeft: navCollapsed ? 72 : 240 }}>
          {/* Sidebar */}
          <aside
            className="dash-side"
            title="Menu"
            style={{ width: navCollapsed ? 72 : 240, display: 'flex', flexDirection: 'column', cursor: 'pointer' }}
            onClick={(e) => {
              const t = e.target;
              if (t && typeof t.closest === 'function' && t.closest('.dash-nav-item')) return;
              setNavCollapsed((v) => !v);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                const t = e.target;
                if (t && typeof t.closest === 'function' && t.closest('.dash-nav-item')) return;
                e.preventDefault();
                setNavCollapsed((v) => !v);
              }
            }}
          >
            <div className="dash-side-brand" title="Menu">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 8 }}>
                <img src="/logo.png" alt="City Hall Logo" style={{ width: 44, height: 44, objectFit: 'contain', borderRadius: '50%' }} />
              </div>
              <div className="hamburger" aria-hidden="true">
                <div className="hamburger-bar"></div>
                <div className="hamburger-bar"></div>
                <div className="hamburger-bar"></div>
              </div>
            </div>
            <ul className="dash-nav" style={{ flex: 1 }}>
              <li className="dash-nav-section">
                <span className="dash-nav-section-label" style={{ display: navCollapsed ? 'none' : 'inline' }}>Mission Orders</span>
              </li>
              <li>
                <a href="/dashboard/head-inspector#todo" className={`dash-nav-item ${activeTabFromHash === 'todo' ? 'active' : ''}`} style={{ textDecoration: 'none' }}>
                  <span className="dash-nav-ico" aria-hidden="true" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                    <img src="/ui_icons/menu.png" alt="" style={{ width: 22, height: 22, objectFit: 'contain', display: 'block', filter: 'brightness(0) saturate(100%) invert(62%) sepia(94%) saturate(1456%) hue-rotate(7deg) brightness(88%) contrast(108%)' }} />
                  </span>
                  <span className="dash-nav-label" style={{ display: navCollapsed ? 'none' : 'inline' }}>To Do</span>
                </a>
              </li>
              <li>
                <a href="/dashboard/head-inspector#issued" className={`dash-nav-item ${activeTabFromHash === 'issued' ? 'active' : ''}`} style={{ textDecoration: 'none' }}>
                  <span className="dash-nav-ico" aria-hidden="true" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                    <img src="/ui_icons/mo.png" alt="" style={{ width: 22, height: 22, objectFit: 'contain', display: 'block', filter: 'brightness(0) saturate(100%) invert(62%) sepia(94%) saturate(1456%) hue-rotate(7deg) brightness(88%) contrast(108%)' }} />
                  </span>
                  <span className="dash-nav-label" style={{ display: navCollapsed ? 'none' : 'inline' }}>Issued</span>
                </a>
              </li>
              <li>
                <a href="/dashboard/head-inspector#for-inspection" className={`dash-nav-item ${activeTabFromHash === 'for-inspection' ? 'active' : ''}`} style={{ textDecoration: 'none' }}>
                  <span className="dash-nav-ico" aria-hidden="true" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                    <img src="/ui_icons/queue.png" alt="" style={{ width: 24, height: 24, objectFit: 'contain', display: 'block', filter: 'brightness(0) saturate(100%) invert(62%) sepia(94%) saturate(1456%) hue-rotate(7deg) brightness(88%) contrast(108%)' }} />
                  </span>
                  <span className="dash-nav-label" style={{ display: navCollapsed ? 'none' : 'inline' }}>For Inspection</span>
                </a>
              </li>
              <li>
                <a href="/dashboard/head-inspector#revisions" className={`dash-nav-item ${activeTabFromHash === 'revisions' ? 'active' : ''}`} style={{ textDecoration: 'none' }}>
                  <span className="dash-nav-ico" aria-hidden="true" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                    <img src="/ui_icons/history.png" alt="" style={{ width: 22, height: 22, objectFit: 'contain', display: 'block', filter: 'brightness(0) saturate(100%) invert(62%) sepia(94%) saturate(1456%) hue-rotate(7deg) brightness(88%) contrast(108%)' }} />
                  </span>
                  <span className="dash-nav-label" style={{ display: navCollapsed ? 'none' : 'inline' }}>For Revisions</span>
                </a>
              </li>
            </ul>
            <button
              type="button"
              className="dash-nav-item"
              onClick={handleLogout}
              style={{
                marginTop: 'auto', border: 'none', background: 'transparent', color: '#ef4444', fontWeight: 800, textAlign: 'left',
                padding: '10px 12px', borderRadius: 10, cursor: 'pointer', display: 'grid', gridTemplateColumns: '24px 1fr', alignItems: 'center', gap: 10,
              }}
            >
              <span className="dash-nav-ico" aria-hidden="true" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                <img src="/ui_icons/logout.png" alt="" style={{ width: 22, height: 22, objectFit: 'contain', display: 'block', filter: 'brightness(0) saturate(100%) invert(21%) sepia(97%) saturate(4396%) hue-rotate(346deg) brightness(95%) contrast(101%)' }} />
              </span>
              <span className="dash-nav-label" style={{ display: navCollapsed ? 'none' : 'inline' }}>Logout</span>
            </button>
          </aside>

          {/* Content */}
          <div className="dash-maincol">
            <div className="mo-main">
              <section className="mo-card" style={{ position: 'relative' }}>
                {/* 2-column layout: left preview, right editor panel */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'minmax(0, 9fr) 1px minmax(0, 7fr)',
                    gap: 0,
                    alignItems: 'stretch',
                    marginTop: 0,
                  }}
                >
                  {/* Left: Preview */}
                  <div style={{ paddingRight: 40 }}>
                    {/* Preview header */}
                    
                    {/* Gray workspace with equal padding, paper centered */}
                    <div className="mo-editor-wrap" style={{ marginTop: 0, padding: 40, boxSizing: 'border-box', display: 'flex', justifyContent: 'center' }}>
                      <div
                        ref={editorRef}
                        className="mo-editor"
                        contentEditable={!loading && !isReadOnly}
                        suppressContentEditableWarning
                        onMouseDown={(e) => {
                          const locked = e.target?.closest?.('[data-mo-locked="true"]');
                          if (!locked) return;
                          e.preventDefault();
                        }}
                        onKeyDown={(e) => {
                          const sel = window.getSelection?.();
                          const node = sel?.anchorNode;
                          const el = node?.nodeType === 1 ? node : node?.parentElement;
                          const locked = el?.closest?.('[data-mo-locked="true"]');
                          if (!locked) return;
                          const allowed = new Set(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown','Tab','Escape']);
                          if (!allowed.has(e.key)) e.preventDefault();
                        }}
                        onBeforeInput={(e) => {
                          const targetLocked = e.target?.closest?.('[data-mo-locked="true"]');
                          const sel = window.getSelection?.();
                          const node = sel?.anchorNode;
                          const el = node?.nodeType === 1 ? node : node?.parentElement;
                          const caretLocked = el?.closest?.('[data-mo-locked="true"]');
                          if (targetLocked || caretLocked) e.preventDefault();
                        }}
                        onPaste={(e) => {
                          const sel = window.getSelection?.();
                          const node = sel?.anchorNode;
                          const el = node?.nodeType === 1 ? node : node?.parentElement;
                          const locked = el?.closest?.('[data-mo-locked="true"]') || e.target?.closest?.('[data-mo-locked="true"]');
                          if (locked) e.preventDefault();
                        }}
                        onDrop={(e) => {
                          const sel = window.getSelection?.();
                          const node = sel?.anchorNode;
                          const el = node?.nodeType === 1 ? node : node?.parentElement;
                          const locked = el?.closest?.('[data-mo-locked="true"]') || e.target?.closest?.('[data-mo-locked="true"]');
                          if (locked) e.preventDefault();
                        }}
                        onInput={() => {
                          const next = editorRef.current?.innerHTML ?? '';
                          setContent(next);
                          markDirty(title, next);
                          refreshFormatState();
                        }}
                      />
                    </div>
                  </div>

                  <div style={{ background: '#e2e8f0', width: 1, alignSelf: 'stretch', marginTop: -28, marginBottom: -28 }} />

                  {/* Right: Editor panel */}
                  <div style={{ paddingLeft: 18 }}>
                    {/* Compact toolbar aligned with paper */}
                    {!isApproved ? (
                      <div style={{ display: 'flex', justifyContent: 'center', marginTop: -28, marginBottom: 12, borderBottom: '1px solid #e2e8f0', paddingBottom: 8, marginLeft: -18, marginRight: -28, paddingLeft: 18, paddingRight: 28 }}>
                        <div
                          style={{
                            width: '100%',
                            maxWidth: 800,
                            display: 'flex',
                            gap: 8,
                            flexWrap: 'wrap',
                            alignItems: 'center',
                            padding: '8px 0',
                            border: 'none',
                            borderRadius: 0,
                            background: 'transparent',
                          }}
                          aria-label="Formatting toolbar"
                        >
                          <label style={{ fontWeight: 800, fontSize: 12, color: '#334155' }}>
                            Font
                            <select className="mo-toolbar-select" onChange={(e) => applyCommand('fontName', e.target.value)} disabled={loading} defaultValue="Times New Roman" style={{ marginLeft: 8, padding: '6px 8px', borderRadius: 10, border: '1px solid #e2e8f0' }}>
                              <option value="Times New Roman">Times New Roman</option>
                              <option value="Arial">Arial</option>
                              <option value="Calibri">Calibri</option>
                              <option value="Georgia">Georgia</option>
                              <option value="Garamond">Garamond</option>
                            </select>
                          </label>
                          <label style={{ fontWeight: 800, fontSize: 12, color: '#334155' }}>
                            Size
                            <select className="mo-toolbar-select" onChange={(e) => applyCommand('fontSize', e.target.value)} disabled={loading} defaultValue="3" style={{ marginLeft: 8, padding: '6px 8px', borderRadius: 10, border: '1px solid #e2e8f0' }} title="Font size (browser scale)">
                              <option value="1">10px</option>
                              <option value="2">12px</option>
                              <option value="3">14px</option>
                              <option value="4">16px</option>
                              <option value="5">18px</option>
                              <option value="6">24px</option>
                              <option value="7">32px</option>
                            </select>
                          </label>
                          <div style={{ width: 1, height: 28, background: '#e2e8f0', margin: '0 4px' }} />
                          <button type="button" className="mo-format-btn mo-btn-iconish mo-btn--sm" aria-pressed={fmt.bold} onClick={() => applyCommand('bold')} disabled={loading} title="Bold"><strong>B</strong></button>
                          <button type="button" className="mo-format-btn mo-btn-iconish mo-btn--sm" aria-pressed={fmt.italic} onClick={() => applyCommand('italic')} disabled={loading} title="Italic"><em>I</em></button>
                          <button type="button" className="mo-format-btn mo-btn-iconish mo-btn--sm" aria-pressed={fmt.underline} onClick={() => applyCommand('underline')} disabled={loading} title="Underline"><span style={{ textDecoration: 'underline' }}>U</span></button>
                          <div style={{ width: 1, height: 28, background: '#e2e8f0', margin: '0 4px' }} />
                          <button type="button" className="mo-btn mo-btn--sm" onClick={() => applyCommand('insertUnorderedList')} disabled={loading} title="Bulleted list">• List</button>
                          <button type="button" className="mo-btn mo-btn--sm" onClick={() => applyCommand('insertOrderedList')} disabled={loading} title="Numbered list">1. List</button>
                        </div>
                      </div>
                    ) : null}

                    {/* Title + meta */}
                    <div className="mo-title-wrap">
                      <label className="mo-label" htmlFor="moTitle">Title</label>
                      <input
                        id="moTitle"
                        className="mo-title"
                        type="text"
                        value={title}
                        onChange={(e) => {
                          const next = e.target.value;
                          setTitle(next);
                          markDirty(next, editorRef.current?.innerHTML ?? content);
                        }}
                        placeholder="Mission Order Title"
                        disabled={loading || isReadOnly}
                      />
                      {/* Meta row */}
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12, marginTop: 10 }}>
                        <div>
                          <div className="mo-label" style={{ marginBottom: 6, color: '#64748b' }}>MO ID</div>
                          <div style={{ height: 40, borderRadius: 10, border: '1px solid #e2e8f0', background: '#f8fafc', display: 'flex', alignItems: 'center', padding: '0 12px', color: '#334155', fontWeight: 800, fontSize: 13 }}>
                            {missionOrderId ? missionOrderId : '—'}
                          </div>
                        </div>
                                              </div>
                    </div>

                    {/* Assigned Inspectors */}
                    <div style={{ marginTop: 14 }}>
                      <div style={{ fontWeight: 900, color: '#0f172a' }}>Assigned Inspectors</div>
                      <div className="mo-meta" style={{ marginTop: 4 }}>
                        {assignedInspectorIds.length === 0 ? 'No inspectors assigned yet.' : null}
                      </div>
                      <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, alignItems: 'center' }}>
                        <select
                          className="mo-select"
                          value={selectedInspectorId}
                          onChange={(e) => setSelectedInspectorId(e.target.value)}
                          disabled={loading || syncingAssignments}
                          style={{ padding: '8px 10px', borderRadius: 10, border: '1px solid #e2e8f0' }}
                        >
                          <option value="">Select inspector…</option>
                          {inspectors.map((ins) => (
                            <option key={ins.id} value={ins.id}>{ins.full_name || ins.id}</option>
                          ))}
                        </select>
                        <button type="button" className="mo-btn" onClick={addInspector} disabled={loading || syncingAssignments || !selectedInspectorId}>
                          {syncingAssignments ? 'Updating…' : 'Add'}
                        </button>
                      </div>

                      {/* Assigned chips */}
                      {assignedInspectorIds.length > 0 ? (
                        <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          {assignedInspectorIds.map((id) => {
                            const ins = inspectors.find((x) => x.id === id);
                            const label = ins?.full_name || id;
                            return (
                              <button key={id} type="button" className="mo-chip" title="Click to remove" onClick={() => removeInspector(id)} disabled={syncingAssignments}>
                                <span className="mo-chip-label">{label}</span>
                                <span aria-hidden="true" className="mo-chip-x">×</span>
                              </button>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>

                    {/* Show complaint link */}
                    <div style={{ marginTop: 14 }}>
                      <button
                        type="button"
                        className="mo-link"
                        onClick={() => setShowComplaintSideBySide((v) => !v)}
                        disabled={loading}
                        title="Toggle complaint details"
                        style={{ border: 'none', background: 'transparent', padding: 0 }}
                      >
                        {showComplaintSideBySide ? 'Hide Complaint Details' : 'Show Complaint Details'}
                      </button>
                    </div>

                    {/* Complaint panel */}
                    {showComplaintSideBySide ? (
                      <aside style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 12, marginTop: 10 }} aria-label="Complaint Details">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
                          <div style={{ fontWeight: 900, color: '#0f172a' }}>Complaint Details</div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                            {complaint?.authenticity_level ? (
                              <span style={{ padding: '4px 8px', borderRadius: 999, fontSize: 12, fontWeight: 900, border: '1px solid #e2e8f0', background: String(complaint.authenticity_level).toLowerCase() === 'urgent' ? '#fee2e2' : '#e0f2fe', color: String(complaint.authenticity_level).toLowerCase() === 'urgent' ? '#991b1b' : '#075985' }} title="Urgency">
                                {complaint.authenticity_level}
                              </span>
                            ) : null}
                            <div style={{ color: '#64748b', fontWeight: 800, fontSize: 12 }}>
                              {complaint?.id ? `ID: ${complaint.id}` : ''}
                            </div>
                          </div>
                        </div>
                        <div style={{ height: 1, background: '#f1f5f9', margin: '10px 0' }} />
                        {complaintLoading ? <div className="mo-meta">Loading complaint…</div> : null}
                        {complaintError ? <div className="mo-alert mo-alert-error">{complaintError}</div> : null}
                        {!complaint && !complaintLoading ? (
                          <div className="mo-meta">No complaint record found.</div>
                        ) : complaint ? (
                          <div style={{ display: 'grid', gap: 10 }}>
                            <div>
                              <div style={{ color: '#0f172a', fontWeight: 900, fontSize: 12 }}>Business</div>
                              <div style={{ fontWeight: 900, color: '#0f172a' }}>{complaint.business_name || '—'}</div>
                              <div style={{ color: '#475569', fontWeight: 800, fontSize: 12 }}>{complaint.business_address || '—'}</div>
                            </div>
                            <div>
                              <div style={{ color: '#0f172a', fontWeight: 900, fontSize: 12 }}>Description</div>
                              <div style={{ whiteSpace: 'pre-wrap', color: '#0f172a', fontWeight: 700, fontSize: 13 }}>{complaint.complaint_description || '—'}</div>
                            </div>
                            <div style={{ display: 'grid', gap: 6 }}>
                              <div style={{ color: '#0f172a', fontWeight: 900, fontSize: 12 }}>Evidence</div>
                              {Array.isArray(complaint.image_urls) && complaint.image_urls.length > 0 ? (
                                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                  {complaint.image_urls.slice(0, 6).map((url) => (
                                    <a key={url} href={url} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', height: 30, padding: '0 10px', borderRadius: 10, border: '1px solid #bfdbfe', background: '#eff6ff', color: '#1d4ed8', fontWeight: 900, textDecoration: 'none', fontSize: 12 }}>
                                      View
                                    </a>
                                  ))}
                                </div>
                              ) : (
                                <div className="mo-meta">No images</div>
                              )}
                            </div>
                            <div style={{ display: 'grid', gap: 6 }}>
                              <div style={{ color: '#0f172a', fontWeight: 900, fontSize: 12 }}>Submitted</div>
                              <div style={{ color: '#0f172a', fontWeight: 800, fontSize: 12 }}>
                                {complaint?.created_at ? new Date(complaint.created_at).toLocaleString() : '—'}
                              </div>
                            </div>
                          </div>
                        ) : null}
                      </aside>
                    ) : null}

                    {/* Feedback */}
                    {toast ? <div className="mo-alert mo-alert-success" style={{ marginTop: 12 }}>{toast}</div> : null}
                    {error ? <div className="mo-alert mo-alert-error" style={{ marginTop: 12 }}>{error}</div> : null}
                    {String(missionOrderStatus || '').toLowerCase() === 'cancelled' && directorComment ? (
                      <div className="mo-alert" style={{ marginTop: 12, border: '1px solid #fecaca', background: '#fef2f2', color: '#7f1d1d' }}>
                        <div style={{ fontWeight: 900, marginBottom: 6 }}>Director Revisions Required</div>
                        <div style={{ whiteSpace: 'pre-wrap', fontWeight: 700 }}>{directorComment}</div>
                        {reviewedAt ? (
                          <div style={{ marginTop: 8, color: '#991b1b', fontWeight: 800, fontSize: 12 }}>Reviewed at {reviewedAt.toLocaleString()}</div>
                        ) : null}
                      </div>
                    ) : null}

                    {/* Bottom actions */}
                    <div style={{ marginTop: 22, paddingTop: 10, borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <a
                        className="mo-link"
                        href="/dashboard/head-inspector"
                        onClick={(e) => {
                          if (!isDirty) return;
                          e.preventDefault();
                          setToast('You have made changes. Please click Save before leaving.');
                        }}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                      >
                        <span style={{ fontSize: 16 }}>←</span> Back
                      </a>
                      <div style={{ display: 'flex', gap: 10 }}>
                        {isApproved ? (
                          <button className="mo-btn" type="button" onClick={() => window.print()} disabled={loading} title="Print this approved mission order." style={{ background: 'transparent', border: '1px solid #0f172a', color: '#0f172a' }}>
                            Print
                          </button>
                        ) : (
                          <>
                            <button className="mo-btn" type="button" onClick={handleSave} disabled={saving || loading} title="Save changes">
                              {saving ? 'Saving…' : 'Save'}
                            </button>
                            <button className="mo-btn mo-btn-primary" type="button" onClick={handleSubmitToDirector} disabled={loading || saving || submitting || assignedInspectorIds.length === 0} title={assignedInspectorIds.length === 0 ? 'Assign at least one inspector before submitting.' : 'Forward to Director for review.'}>
                              {submitting ? 'Submitting…' : 'Submit to Director'}
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="mo-note" style={{ marginTop: 10 }}>
                      {isApproved ? (
                        <>This mission order is <strong>approved</strong> and locked (read-only). You can print it.</>
                      ) : (
                        <>Save your edits, assign inspectors, then click <strong>Submit to Director</strong> to forward the mission order for review.</>
                      )}
                    </div>
                  </div>
                </div>
              </section>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
