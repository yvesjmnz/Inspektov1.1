import { useEffect, useMemo, useRef, useState } from 'react';
import Header from '../../../components/Header';
import Footer from '../../../components/Footer';
import { supabase } from '../../../lib/supabase';
import './MissionOrderEditor.css';

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

  const editorRef = useRef(null);

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

        setAssignedInspectorIds((assignedRows || []).map((r) => r.inspector_id));

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
            '</div>'
          ].join('');

        baselineRef.current = { title: loadedTitle, content: loadedContent };

        setTitle(loadedTitle);
        setContent(loadedContent);
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

  const loadAssignedInspectors = async () => {
    if (!missionOrderId) return;

    const { data: assignedRows, error: assignedError } = await supabase
      .from('mission_order_assignments')
      .select('id, inspector_id, assigned_at')
      .eq('mission_order_id', missionOrderId)
      .order('assigned_at', { ascending: true });

    if (assignedError) throw assignedError;
    setAssignedInspectorIds((assignedRows || []).map((r) => r.inspector_id));
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

      const { error: insertError } = await supabase
        .from('mission_order_assignments')
        .insert([
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
        { event: '*', schema: 'public', table: 'mission_order_assignments', filter: `mission_order_id=eq.${missionOrderId}` },
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

  const handleSave = async () => {
    if (!missionOrderId) return;

    setError('');
    setToast('');
    setSaving(true);

    try {
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
      setToast('Saved.');
    } catch (e) {
      setError(e?.message || 'Failed to save mission order.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mo-container">
      <Header />
      <main className="mo-main">
        <section className="mo-card">
          <div className="mo-header">
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
                      style={{
                        borderRadius: 999,
                        padding: '6px 10px',
                        fontWeight: 800,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 8,
                        border: '1px solid #e2e8f0',
                        background: '#f8fafc',
                        cursor: syncingAssignments ? 'not-allowed' : 'pointer',
                      }}
                    >
                      <span>{label}</span>
                      <span aria-hidden="true" style={{ fontWeight: 900 }}>×</span>
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

          <div className="mo-editor-wrap">
            <div
              ref={editorRef}
              className="mo-editor"
              contentEditable={!loading}
              suppressContentEditableWarning
              // Don't use dangerouslySetInnerHTML here; we manually sync innerHTML only when loading initial content.
              // Re-rendering innerHTML on each keystroke resets the caret to the beginning.
              onInput={() => {
                const next = editorRef.current?.innerHTML ?? '';
                setContent(next);
                markDirty(title, next);
              }}
            />
          </div>

          <div className="mo-note">
            This is a simple editable document stored in <code>mission_orders.content</code>.
            Next we can add a richer editor (TipTap/Quill) and a print/PDF layout.
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
