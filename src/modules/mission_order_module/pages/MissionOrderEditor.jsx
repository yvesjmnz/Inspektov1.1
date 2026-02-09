import { useEffect, useMemo, useRef, useState } from 'react';
import Header from '../../../components/Header';
import Footer from '../../../components/Footer';
import { supabase } from '../../../lib/supabase';
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
  // Goal: keep these fields in sync without requiring the original placeholders to still exist.
  // Strategy:
  // 1) Always update existing auto-markers.
  // 2) If markers are missing, try to inject them into the canonical TO/SUBJECT lines.
  // 3) If those lines can't be found, append a small auto section at the top of the document.
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

  // 1) Update existing markers
  next = next.replace(/<span\s+data-mo-auto="inspectors"[^>]*>[\s\S]*?<\/span>/g, inspectorSpan);
  next = next.replace(/<span\s+data-mo-auto="business_name"[^>]*>[\s\S]*?<\/span>/g, businessNameSpan);
  next = next.replace(/<span\s+data-mo-auto="business_address"[^>]*>[\s\S]*?<\/span>/g, businessAddressSpan);

  // 2) Placeholder replacement (backward compatible)
  if (inspectorNames) next = next.replaceAll('[INSPECTOR NAME]', inspectorSpan);
  if (businessName) next = next.replaceAll('[BUSINESS NAME]', businessNameSpan);
  if (businessAddress) next = next.replaceAll('[ADDRESS]', businessAddressSpan);

  // 3) If still missing, inject into the TO line.
  // Matches: <p><strong>TO:</strong> ...</p> (any content)
  if (!hasInspectorMarker) {
    const toLine = /(<p[^>]*>\s*<strong>\s*TO:\s*<\/strong>)([\s\S]*?)(<\/p>)/i;
    if (toLine.test(next)) {
      next = next.replace(toLine, `$1 FIELD INSPECTOR ${inspectorSpan}$3`);
    }
  }

  // 4) If still missing, inject into SUBJECT line.
  if (!hasBusinessNameMarker || !hasBusinessAddressMarker) {
    const subjectLine = /(<p[^>]*>\s*<strong>\s*SUBJECT:\s*<\/strong>)([\s\S]*?)(<\/p>)/i;
    if (subjectLine.test(next)) {
      // Keep existing sentence but ensure it contains our auto-markers.
      const subjectText = ` TO CONDUCT INSPECTION ON THE BUSINESS ESTABLISHMENT IDENTIFIED AS ${businessNameSpan} WITH ADDRESS AT ${businessAddressSpan}`;
      next = next.replace(subjectLine, `$1${subjectText}$3`);
    }
  }

  // 5) Final fallback: prepend a small auto section so add/remove always works.
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

    // Insert right after the first opening <div ...> if present, otherwise prepend.
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

  // Track unsaved changes by comparing against the last saved/loaded snapshot.
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

  const assignedInspectorNames = useMemo(() => {
    return assignedInspectorIds
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

    // Update both DOM + state. This may move caret; acceptable since it occurs on assignment changes / initial load.
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
          .select('id, title, content, complaint_id, created_at, updated_at')
          .eq('id', missionOrderId)
          .single();

        if (error) throw error;
        if (!mounted) return;

        // Load business details from complaint (for auto-inserting into the document)
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

        // Load inspectors list for displaying names
        const { data: inspectorsData, error: inspectorsError } = await supabase
          .from('profiles')
          .select('id, full_name, role')
          .eq('role', 'inspector')
          .order('full_name', { ascending: true });

        if (inspectorsError) throw inspectorsError;
        if (!mounted) return;
        setInspectors(inspectorsData || []);

        // Load current assignments for this mission order
        const { data: assignedRows, error: assignedError } = await supabase
          .from('mission_order_assignments')
          .select('id, inspector_id, assigned_at')
          .eq('mission_order_id', missionOrderId)
          .order('assigned_at', { ascending: true });

        if (assignedError) throw assignedError;
        if (!mounted) return;

        const loadedAssignedInspectorIds = (assignedRows || []).map((r) => r.inspector_id);
        setAssignedInspectorIds(loadedAssignedInspectorIds);

        const loadedInspectorNames = loadedAssignedInspectorIds
          .map((id) => inspectorsData?.find((x) => x.id === id)?.full_name)
          .filter(Boolean)
          .join(', ');

        // While hydrating initial data, keep dirty tracking disabled.
        allowDirtyTrackingRef.current = false;
        setIsDirty(false);

        const loadedTitle = data?.title || `Mission Order ${String(data?.id || '').slice(0, 8)}…`;
        const loadedContent =
          data?.content ||
          [
            '<div style="font-family: serif; line-height: 1.5;">',
            '<p style="text-align:center; font-size: 18px;"><strong>MISSION ORDER</strong></p>',
            '<br/>',
            '<p><strong>TO:</strong> FIELD INSPECTOR [INSPECTOR NAME]</p>',
            '<p><strong>SUBJECT:</strong> TO CONDUCT INSPECTION ON THE BUSINESS ESTABLISHMENT IDENTIFIED AS [BUSINESS NAME] WITH ADDRESS AT [ADDRESS]</p>',
            '<p><strong>DATE OF INSPECTION: </strong>[INSERT DATE]</p>',
            '<p><strong>DATE OF ISSUANCE: </strong>[INSERT DATE]</p>',
            '<br/>',
            '<p style="text-align:justify;">In the interest of public service, you are hereby ordered to conduct inspection of the aforementioned establishment, for the following purposes:</p>',

            // Tabbed List using padding-left
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

            // Signature Table for side-by-side names
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
      } catch (e) {
        if (!mounted) return;
        setError(e?.message || 'Failed to load mission order.');
      } finally {
        if (mounted) {
          setLoading(false);
          // Enable dirty tracking after the initial render has had a chance to sync editorRef.innerHTML.
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

  // Keep the editable DOM in sync when content changes (initial load)
  useEffect(() => {
    if (!editorRef.current) return;
    if (editorRef.current.innerHTML !== content) {
      editorRef.current.innerHTML = content;
    }
  }, [content]);

  // Keep inspector names in sync in the document (add/remove should update immediately).
  useEffect(() => {
    if (!allowDirtyTrackingRef.current) return;
    syncAutoFieldsIntoEditor({ nextInspectorNames: assignedInspectorNames });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignedInspectorNames]);

  // If business details arrive after load, try to fill placeholders (if any remain).
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

    // Best effort: if placeholders exist, fill immediately.
    const nextNames = loadedIds
      .map((id) => inspectors.find((x) => x.id === id)?.full_name)
      .filter(Boolean)
      .join(', ');

    syncAutoFieldsIntoEditor({ nextInspectorNames: nextNames });
  };

  const addInspector = async () => {
    if (!missionOrderId) return;
    if (!selectedInspectorId) return;

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
        {
          mission_order_id: missionOrderId,
          inspector_id: inspectorId,
          assigned_by: userId,
        },
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

      // If nothing was deleted, surface it as an error (common with missing DELETE RLS).
      if (deletedRows && Array.isArray(deletedRows) && deletedRows.length === 0) {
        throw new Error(
          'Remove failed: the database did not delete any rows. This is usually caused by a missing DELETE row-level security policy for mission_order_assignments.'
        );
      }

      try {
        await loadAssignedInspectors();
      } catch (_e) {
        // ignore
      }

      setToast('Inspector removed.');
    } catch (e) {
      setError(e?.message || 'Failed to remove inspector.');
    } finally {
      setSyncingAssignments(false);
    }
  };

  // Best-effort sync: if assignments are changed elsewhere, update this view.
  useEffect(() => {
    if (!missionOrderId) return;
    const channel = supabase
      .channel(`mo-assignments-${missionOrderId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'mission_order_assignments',
          filter: `mission_order_id=eq.${missionOrderId}`,
        },
        () => {
          loadAssignedInspectors().catch(() => {});
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
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
      .update({
        title: title || null,
        content: html,
        last_edited_by: userId,
        updated_at: new Date().toISOString(),
      })
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
        .update({
          // DB constraint only allows: draft | issued | cancelled | completed
          // "issued" is used as "forwarded to Director / awaiting review".
          status: 'issued',
          submitted_by: userId,
          submitted_at: nowIso,
          updated_at: nowIso,
        })
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

  return (
    <div className="mo-container">
      <Header />
      <main className="mo-main">
        <section className="mo-card">
          <div className="mo-header">
            <div className="mo-title-wrap">
              <label className="mo-label" htmlFor="moTitle">
                Title
              </label>
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
                disabled={loading}
              />
              <div className="mo-meta">
                <span>MO ID: {missionOrderId ? `${missionOrderId.slice(0, 8)}…` : '—'}</span>
              </div>
            </div>

            <div className="mo-actions">
              <a
                className="mo-link"
                href="/dashboard/head-inspector"
                onClick={(e) => {
                  if (!isDirty) return;
                  e.preventDefault();
                  setToast('You have made changes. Please click Save before leaving.');
                }}
              >
                Back
              </a>
              <button className="mo-btn" type="button" onClick={handleSave} disabled={saving || loading}>
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button
                className="mo-btn mo-btn-primary"
                type="button"
                onClick={handleSubmitToDirector}
                disabled={loading || saving || submitting || assignedInspectorIds.length === 0}
                title={assignedInspectorIds.length === 0 ? 'Assign at least one inspector before submitting.' : 'Forward to Director for review.'}
              >
                {submitting ? 'Submitting…' : 'Submit to Director'}
              </button>
            </div>
          </div>

          {toast ? <div className="mo-alert mo-alert-success">{toast}</div> : null}
          {error ? <div className="mo-alert mo-alert-error">{error}</div> : null}

          <div className="mo-assignments" style={{ marginTop: 14 }}>
            <div className="mo-meta" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <span style={{ fontWeight: 800 }}>Assigned Inspectors:</span>
              {assignedInspectorIds.length === 0 ? (
                <span style={{ color: '#64748b' }}>None</span>
              ) : (
                assignedInspectorIds.map((id) => {
                  const ins = inspectors.find((x) => x.id === id);
                  const label = ins?.full_name || id;
                  return (
                    <button
                      key={id}
                      type="button"
                      className="mo-chip"
                      title="Click to remove"
                      onClick={() => removeInspector(id)}
                      disabled={syncingAssignments}
                    >
                      <span className="mo-chip-label">{label}</span>
                      <span aria-hidden="true" className="mo-chip-x">
                        ×
                      </span>
                    </button>
                  );
                })
              )}
            </div>

            <div style={{ marginTop: 10, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <select
                className="mo-select"
                value={selectedInspectorId}
                onChange={(e) => setSelectedInspectorId(e.target.value)}
                disabled={loading || syncingAssignments}
                style={{ padding: '8px 10px', borderRadius: 10, border: '1px solid #e2e8f0' }}
              >
                <option value="">Select inspector…</option>
                {inspectors.map((ins) => (
                  <option key={ins.id} value={ins.id}>
                    {ins.full_name || ins.id}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="mo-btn"
                onClick={addInspector}
                disabled={loading || syncingAssignments || !selectedInspectorId}
              >
                {syncingAssignments ? 'Updating…' : 'Add Inspector'}
              </button>
            </div>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: showComplaintSideBySide ? 'minmax(0, 3fr) minmax(0, 2fr)' : 'minmax(0, 1fr)',
              gap: showComplaintSideBySide ? 14 : 0,
              alignItems: 'start',
              marginTop: 20,
              transition: 'grid-template-columns 0.3s ease-in-out',
            }}
          >
            <div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
                <button
                  type="button"
                  className="mo-btn"
                  onClick={() => setShowComplaintSideBySide((v) => !v)}
                  disabled={loading}
                  title="Toggle complaint details"
                  style={{
                    background: 'transparent',
                    color: '#2563eb',
                    border: '1px solid #2563eb',
                  }}
                >
                  {showComplaintSideBySide ? 'Hide Complaint' : 'Show Complaint'}
                </button>
              </div>

              <div className="mo-editor-wrap" style={{ marginTop: 0 }}>
                <div
                  ref={editorRef}
                  className="mo-editor"
                  contentEditable={!loading}
                  suppressContentEditableWarning
              // Don't use dangerouslySetInnerHTML here; we manually sync innerHTML only when loading initial content.
              // Re-rendering innerHTML on each keystroke resets the caret to the beginning.
              onMouseDown={(e) => {
                // Prevent placing caret inside locked spans.
                const locked = e.target?.closest?.('[data-mo-locked="true"]');
                if (!locked) return;
                e.preventDefault();
              }}
              onKeyDown={(e) => {
                // Extra guard: in some browsers the event target can be the editor root,
                // so we detect whether the caret is currently inside a locked span.
                const sel = window.getSelection?.();
                const node = sel?.anchorNode;
                const el = node?.nodeType === 1 ? node : node?.parentElement;
                const locked = el?.closest?.('[data-mo-locked="true"]');
                if (!locked) return;

                // Block all text-modifying keys when inside locked area.
                // Allow navigation keys so the caret can move out.
                const allowed = new Set([
                  'ArrowLeft',
                  'ArrowRight',
                  'ArrowUp',
                  'ArrowDown',
                  'Home',
                  'End',
                  'PageUp',
                  'PageDown',
                  'Tab',
                  'Escape',
                ]);

                if (!allowed.has(e.key)) {
                  e.preventDefault();
                }
              }}
              onBeforeInput={(e) => {
                // Prevent edits inside locked auto-fields.
                // This avoids subtle DOM corruption when users attempt to type inside non-editable spans.
                const targetLocked = e.target?.closest?.('[data-mo-locked="true"]');

                const sel = window.getSelection?.();
                const node = sel?.anchorNode;
                const el = node?.nodeType === 1 ? node : node?.parentElement;
                const caretLocked = el?.closest?.('[data-mo-locked="true"]');

                if (targetLocked || caretLocked) {
                  e.preventDefault();
                }
              }}
              onPaste={(e) => {
                const sel = window.getSelection?.();
                const node = sel?.anchorNode;
                const el = node?.nodeType === 1 ? node : node?.parentElement;
                const locked = el?.closest?.('[data-mo-locked="true"]') || e.target?.closest?.('[data-mo-locked="true"]');
                if (locked) {
                  e.preventDefault();
                }
              }}
              onDrop={(e) => {
                const sel = window.getSelection?.();
                const node = sel?.anchorNode;
                const el = node?.nodeType === 1 ? node : node?.parentElement;
                const locked = el?.closest?.('[data-mo-locked="true"]') || e.target?.closest?.('[data-mo-locked="true"]');
                if (locked) {
                  e.preventDefault();
                }
              }}
              onInput={() => {
                const next = editorRef.current?.innerHTML ?? '';
                setContent(next);
                markDirty(title, next);
              }}
                />
              </div>
            </div>

            {showComplaintSideBySide ? (
              <aside
                style={{
                  background: '#fff',
                  border: '1px solid #e2e8f0',
                  borderRadius: 12,
                  padding: 12,
                }}
                aria-label="Complaint Details"
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
                  <div style={{ fontWeight: 900, color: '#0f172a' }}>Complaint Details</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    {complaint?.authenticity_level ? (
                      <span
                        style={{
                          padding: '4px 8px',
                          borderRadius: 999,
                          fontSize: 12,
                          fontWeight: 900,
                          border: '1px solid #e2e8f0',
                          background:
                            String(complaint.authenticity_level).toLowerCase() === 'urgent' ? '#fee2e2' : '#e0f2fe',
                          color: String(complaint.authenticity_level).toLowerCase() === 'urgent' ? '#991b1b' : '#075985',
                        }}
                        title="Urgency"
                      >
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
                      <div style={{ color: '#475569', fontWeight: 800, fontSize: 12 }}>
                        {complaint.business_address || '—'}
                      </div>
                    </div>

                    <div>
                      <div style={{ color: '#0f172a', fontWeight: 900, fontSize: 12 }}>Description</div>
                      <div style={{ whiteSpace: 'pre-wrap', color: '#0f172a', fontWeight: 700, fontSize: 13 }}>
                        {complaint.complaint_description || '—'}
                      </div>
                    </div>

                    <div style={{ display: 'grid', gap: 6 }}>
                      <div style={{ color: '#0f172a', fontWeight: 900, fontSize: 12 }}>Evidence</div>
                      {Array.isArray(complaint.image_urls) && complaint.image_urls.length > 0 ? (
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {complaint.image_urls.slice(0, 6).map((url) => (
                            <a
                              key={url}
                              href={url}
                              target="_blank"
                              rel="noreferrer"
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                height: 30,
                                padding: '0 10px',
                                borderRadius: 10,
                                border: '1px solid #bfdbfe',
                                background: '#eff6ff',
                                color: '#1d4ed8',
                                fontWeight: 900,
                                textDecoration: 'none',
                                fontSize: 12,
                              }}
                            >
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
                        {complaint.created_at ? new Date(complaint.created_at).toLocaleString() : '—'}
                      </div>
                    </div>
                  </div>
                ) : null}
              </aside>
            ) : null}
          </div>

          <div className="mo-note">
            Save your edits, assign inspectors, then click <strong>Submit to Director</strong> to forward the mission
            order for review.
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
