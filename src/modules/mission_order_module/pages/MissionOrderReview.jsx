import { useEffect, useMemo, useState } from 'react';
import DashboardSidebar from '../../../components/DashboardSidebar';
import { supabase } from '../../../lib/supabase';
import { notifyHeadInspectorMissionOrderApproved, notifyHeadInspectorMissionOrderRejected, notifyInspectorsMissionOrderAssigned } from '../../../lib/notifications/notificationTriggers';
import '../../dashboard_module/pages/Dashboard.css';
import '../pages/MissionOrderEditor.css';

function getMissionOrderIdFromQuery() {
  const params = new URLSearchParams(window.location.search);
  return params.get('id');
}

function formatDateHuman(yyyyMmDd) {
  if (!yyyyMmDd) return '—';
  const s = String(yyyyMmDd);
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00`) : new Date(s);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

function formatStatus(status) {
  if (!status) return 'Unknown';
  return String(status)
    .replace(/_/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function statusBadgeClass(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'for inspection' || s === 'for_inspection') return 'status-badge status-success';
  if (s === 'issued') return 'status-badge status-warning';
  if (s === 'rejected') return 'status-badge status-danger';
  if (s === 'cancelled' || s === 'canceled') return 'status-badge status-danger';
  if (s === 'draft') return 'status-badge status-info';
  if (!s) return 'status-badge status-info';
  return 'status-badge';
}

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

export default function MissionOrderReview() {
  const missionOrderId = useMemo(() => getMissionOrderIdFromQuery(), []);

  const [loading, setLoading] = useState(false);
  const [savingDecision, setSavingDecision] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  const [missionOrder, setMissionOrder] = useState(null);
  const [inspectors, setInspectors] = useState([]);
  const [assignedInspectorIds, setAssignedInspectorIds] = useState([]);

  const [complaint, setComplaint] = useState(null);
  const [complaintLoading, setComplaintLoading] = useState(false);
  const [complaintError, setComplaintError] = useState('');

  const [directorComment, setDirectorComment] = useState('');
  const [complaintExpanded, setComplaintExpanded] = useState(false);

  const [docxPreviewOpen, setDocxPreviewOpen] = useState(false);
  const [docxPreviewError, setDocxPreviewError] = useState(false);

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
    setError('');
    setLoading(true);

    try {
      if (!missionOrderId) {
        setError('Missing mission order id. Open this page as /mission-order/review?id=<uuid>');
        return;
      }

      const { data: mo, error: moError } = await supabase
        .from('mission_orders')
        .select('id, complaint_id, status, director_comment, director_signature_url, date_of_inspection, date_of_issuance, template_name, generated_docx_url, created_at, updated_at, submitted_at, director_preapproved_at')
        .eq('id', missionOrderId)
        .single();
      if (moError) throw moError;

      // NOTE: Director may not have permission (RLS) to list all inspector profiles.
      // We only need names for the assigned inspectors, so we fetch assignments first and then
      // resolve only those inspector profiles.
      const { data: assignedRows, error: assignedError } = await supabase
        .from('mission_order_assignments')
        .select('inspector_id, assigned_at')
        .eq('mission_order_id', missionOrderId)
        .order('assigned_at', { ascending: true });
      if (assignedError) throw assignedError;
      const assignedIds = Array.from(new Set((assignedRows || []).map((r) => r.inspector_id).filter(Boolean)));

      const { data: inspectorsData, error: inspectorsError } = assignedIds.length
        ? await supabase
            .from('profiles')
            .select('id, full_name, first_name, middle_name, last_name')
            .in('id', assignedIds)
        : { data: [], error: null };
      if (inspectorsError) {
        // If RLS blocks profiles, fall back to showing IDs.
        console.warn('Unable to load inspector profiles for director view:', inspectorsError);
      }

      setMissionOrder(mo);
      setInspectors(inspectorsData || []);
      setAssignedInspectorIds(assignedIds);
      setDirectorComment(mo?.director_comment || '');

      if (mo?.complaint_id) {
        setComplaintLoading(true);
        setComplaintError('');
        try {
          const { data: complaintData, error: complaintLoadError } = await supabase
            .from('complaints')
            .select('*')
            .eq('id', mo.complaint_id)
            .single();
          if (complaintLoadError) throw complaintLoadError;
          setComplaint(complaintData);
        } catch (ce) {
          setComplaint(null);
          setComplaintError(ce?.message || 'Failed to load complaint details.');
        } finally {
          setComplaintLoading(false);
        }
      } else {
        setComplaint(null);
      }

      if (mo?.generated_docx_url) {
        setDocxPreviewOpen(true);
      }
    } catch (e) {
      setError(e?.message || 'Failed to load mission order.');
      setMissionOrder(null);
      setInspectors([]);
      setAssignedInspectorIds([]);
      setComplaint(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missionOrderId]);

  useEffect(() => {
    if (!missionOrderId) return;

    const channel = supabase
      .channel(`mo-review-${missionOrderId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'mission_orders', filter: `id=eq.${missionOrderId}` },
        () => load()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'mission_order_assignments', filter: `mission_order_id=eq.${missionOrderId}` },
        () => load()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missionOrderId]);

  const assignedInspectorNames = useMemo(() => {
    if (!assignedInspectorIds.length) return '';

    const byId = new Map((inspectors || []).map((p) => {
      const name =
        p?.full_name ||
        [p?.first_name, p?.middle_name, p?.last_name].filter(Boolean).join(' ') ||
        '';
      return [p?.id, name];
    }));

    return assignedInspectorIds
      .map((id) => byId.get(id) || String(id).slice(0, 8) + '…')
      .filter(Boolean)
      .join(', ');
  }, [assignedInspectorIds, inspectors]);

  const isReviewable = useMemo(() => {
    const s = String(missionOrder?.status || '').toLowerCase();
    return s === 'issued';
  }, [missionOrder?.status]);

  const updateMissionOrderDecision = async (nextStatus) => {
    if (!missionOrderId) return;

    setError('');
    setToast('');
    setSavingDecision(true);

    try {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      const userId = userData?.user?.id;
      if (!userId) throw new Error('Not authenticated. Please login again.');

      const nowIso = new Date().toISOString();
      const patch = {
        status: nextStatus,
        director_comment: directorComment || null,
        reviewed_at: nowIso,
        reviewed_by: userId,
        updated_at: nowIso,
        ...(nextStatus === 'for inspection' ? { date_of_issuance: nowIso.slice(0, 10), director_preapproved_at: nowIso } : {}),
      };

      if (nextStatus === 'rejected' && !String(directorComment || '').trim()) {
        throw new Error('Rejection requires a director comment.');
      }

      const { error: updateError } = await supabase.from('mission_orders').update(patch).eq('id', missionOrderId);
      if (updateError) throw updateError;

      // Automatic replacement: on approval, generate SIGNED DOCX and overwrite the previously generated UNSIGNED doc.
      if (nextStatus === 'for inspection') {
        const { data: fresh, error: freshErr } = await supabase
          .from('mission_orders')
          .select('id, complaint_id, status, director_signature_url, date_of_inspection, date_of_issuance')
          .eq('id', missionOrderId)
          .single();
        if (freshErr) throw freshErr;

        const { data: c, error: cErr } = await supabase
          .from('complaints')
          .select('id, business_name, business_address, complaint_description')
          .eq('id', fresh.complaint_id)
          .single();
        if (cErr) throw cErr;

        // Always render the City Ordinances Violated section in the generated document.
        // Source of truth: mission_order_ordinances for this mission order.
        const { data: assignedOrdRows, error: assignedOrdError } = await supabase
          .from('mission_order_ordinances')
          .select('ordinance_id, created_at')
          .eq('mission_order_id', missionOrderId)
          .order('created_at', { ascending: true });
        if (assignedOrdError) throw assignedOrdError;

        const assignedOrdIds = Array.from(new Set((assignedOrdRows || []).map((r) => r.ordinance_id).filter(Boolean)));

        const { data: ordRows, error: ordErr } = assignedOrdIds.length
          ? await supabase
              .from('ordinances')
              .select('id, code_number, title, description')
              .in('id', assignedOrdIds)
          : { data: [], error: null };
        if (ordErr) throw ordErr;

        const ordById = new Map((ordRows || []).map((o) => [o.id, o]));

        const ordinancesText = assignedOrdIds
          .map((id) => {
            const o = ordById.get(id);
            if (!o) return null;
            const code = o.code_number ? String(o.code_number).trim() : '';
            const title = o.title ? String(o.title).trim() : '';
            const desc = o.description ? String(o.description).trim() : '';

            const head = code ? `Ordinance No. ${code}` : 'Ordinance';
            const mid = title ? ` (${title})` : '';
            const tail = desc ? ` - ${desc}` : '';
            return `${head}${mid}${tail}`;
          })
          .filter(Boolean)
          .join('\n');

        const complaintDetailsForDocx = `CITY ORDINANCES VIOLATED:\n${ordinancesText || '—'}`;

        // If signature url points to private storage, attempt to sign. Best-effort.
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

        // Signed template
        const templatePath = 'templates/MISSION-ORDER-TEMPLATE.docx';
        const { data: signedTemplate, error: signTplErr } = await supabase.storage
          .from('mission-orders')
          .createSignedUrl(templatePath, 60);
        if (signTplErr) throw signTplErr;
        if (!signedTemplate?.signedUrl) throw new Error('Failed to create signed URL for mission order template.');

        // Lazy import so we don’t pay docx bundle cost unless approving.
        const { generateMissionOrderDocx } = await import('../lib/docx_template');

        const blob = await generateMissionOrderDocx({
          templateUrl: signedTemplate.signedUrl,
          inspectors: assignedInspectorNames || '—',
          date_of_complaint: complaint?.created_at,
          date_of_inspection: fresh.date_of_inspection,
          date_of_issuance: fresh.date_of_issuance,
          business_name: c?.business_name,
          business_address: c?.business_address,
          complaint_details: complaintDetailsForDocx,
          director_signature_url: directorSignatureUrl,
        });

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
        const publicUrl = publicData?.publicUrl;
        if (!publicUrl) throw new Error('Failed to get public URL for uploaded DOCX.');

        const nowIso2 = new Date().toISOString();
        const { error: patchDocErr } = await supabase
          .from('mission_orders')
          .update({
            generated_docx_url: publicUrl,
            generated_docx_created_at: nowIso2,
            generated_docx_created_by: userId,
            updated_at: nowIso2,
          })
          .eq('id', fresh.id);
        if (patchDocErr) throw patchDocErr;
      }

      setMissionOrder((prev) => ({ ...(prev || {}), ...patch }));
      
      // Notify Head Inspector and Inspectors of approval or rejection
      try {
        const businessName = complaint?.business_name || 'Unknown Business';
        if (nextStatus === 'for inspection') {
          // Notify head inspector of approval
          await notifyHeadInspectorMissionOrderApproved(missionOrderId, businessName);
          
          // Notify assigned inspectors when mission order is approved
          if (assignedInspectorIds.length > 0) {
            await notifyInspectorsMissionOrderAssigned(
              missionOrderId,
              assignedInspectorIds,
              businessName
            );
          }
        } else if (nextStatus === 'rejected') {
          await notifyHeadInspectorMissionOrderRejected(missionOrderId, businessName, directorComment);
        }
      } catch (notifErr) {
        console.error('Failed to send notification:', notifErr);
        // Don't fail the decision if notification fails
      }
      
      setToast(nextStatus === 'for inspection' ? 'Approved' : 'Rejected');
      await load();
    } catch (e) {
      setError(e?.message || 'Failed to update mission order.');
    } finally {
      setSavingDecision(false);
    }
  };

  const handleApprove = async () => {
    if (!isReviewable) {
      setToast('Not reviewable');
      return;
    }
    await updateMissionOrderDecision('for inspection');
  };

  const handleReject = async () => {
    if (!isReviewable) {
      setToast('Not reviewable');
      return;
    }
    await updateMissionOrderDecision('rejected');
  };

  const officeViewerUrl = useMemo(() => {
    const u = buildOfficeViewerUrl(missionOrder?.generated_docx_url);
    if (!u) return '';

    // Cache-bust: Office viewer + browser can keep showing the old doc when the storage object is overwritten.
    // We append a version derived from generated_docx_created_at/updated_at so the iframe reloads.
    const sep = u.includes('?') ? '&' : '?';
    const v = encodeURIComponent(String(missionOrder?.generated_docx_created_at || missionOrder?.updated_at || Date.now()));
    return `${u}${sep}v=${v}`;
  }, [missionOrder?.generated_docx_url, missionOrder?.generated_docx_created_at, missionOrder?.updated_at]);

  return (
    <div className="dash-container" style={{ fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif' }}>
      <main className="dash-main">
        <section className="dash-shell" style={{ paddingLeft: navCollapsed ? 72 : 240 }}>
          <DashboardSidebar
            role="director"
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
                    <span className={statusBadgeClass(missionOrder?.status)}>{formatStatus(missionOrder?.status)}</span>
                    <span style={{ color: '#64748b', fontWeight: 800, fontSize: 12 }}>
                      Template: {missionOrder?.template_name || 'MISSION-ORDER-TEMPLATE'}
                    </span>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                  <a className="dash-btn" href="/dashboard/director?tab=mission-orders" style={{ textDecoration: 'none' }}>Back</a>

                  {isReviewable ? (
                    <>
                      <button
                        type="button"
                        className="dash-btn"
                        onClick={handleApprove}
                        disabled={loading || savingDecision || !missionOrder}
                        style={{ background: '#16a34a', color: '#fff', border: '1px solid #16a34a' }}
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        className="dash-btn"
                        onClick={handleReject}
                        disabled={loading || savingDecision || !missionOrder}
                        style={{ background: '#dc2626', color: '#fff', border: '1px solid #dc2626' }}
                      >
                        Reject
                      </button>
                    </>
                  ) : (
                    <span style={{ fontWeight: 900, color: '#64748b' }}>Read-only</span>
                  )}
                </div>
              </div>

              {toast ? <div className="dash-alert dash-alert-success" style={{ marginTop: 14 }}>{toast}</div> : null}
              {error ? <div className="dash-alert dash-alert-error" style={{ marginTop: 14 }}>{error}</div> : null}

              <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
                <KeyTile label="Inspectors" value={assignedInspectorNames || '—'} sub={assignedInspectorIds.length ? `${assignedInspectorIds.length} assigned` : 'None assigned'} />
                <KeyTile label="Inspection Date" value={formatDateHuman(missionOrder?.date_of_inspection)} sub="From Head Inspector" />
                <KeyTile label="Issuance Date" value={missionOrder?.date_of_issuance ? formatDateHuman(missionOrder.date_of_issuance) : 'Auto'} sub={missionOrder?.date_of_issuance ? 'Already set' : 'Set on approval'} />
              </div>

              <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 14, alignItems: 'start' }}>
                {isReviewable ? (
                  <Panel title="Director Comment" right={<span style={{ fontWeight: 900, fontSize: 12, color: '#64748b' }}>Required if rejecting</span>}>
                    <textarea
                      className="mo-title"
                      value={directorComment}
                      onChange={(e) => setDirectorComment(e.target.value)}
                      rows={5}
                      disabled={loading}
                      style={{ fontSize: 16, fontWeight: 800, height: 'auto', minHeight: 120, borderRadius: 14 }}
                      placeholder="Add instruction or reason…"
                    />
                  </Panel>
                ) : null}

                <Panel
                  title="Business & Complaint"
                  right={
                    complaint?.id ? (
                      <button
                        type="button"
                        className="dash-btn"
                        onClick={() => setComplaintExpanded((v) => !v)}
                        style={{
                          background: '#08204a',
                          color: '#fff',
                          borderRadius: 999,
                          padding: '0 18px',
                          minWidth: 96,
                          height: 40,
                          fontWeight: 900,
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          border: 'none'
                        }}
                      >
                        {complaintExpanded ? 'Hide Details' : 'Show Details'}
                      </button>
                    ) : null
                  }
                >
                  {complaintLoading ? <div style={{ color: '#64748b', fontWeight: 800 }}>Loading complaint…</div> : null}
                  {complaintError ? <div className="dash-alert dash-alert-error">{complaintError}</div> : null}

                  <div style={{ display: 'grid', gap: 10 }}>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 900, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4 }}>Business</div>
                      <div style={{ fontSize: 18, fontWeight: 1000, color: '#0f172a', marginTop: 6 }}>{complaint?.business_name || '—'}</div>
                      <div style={{ fontSize: 14, fontWeight: 800, color: '#475569', marginTop: 6 }}>{complaint?.business_address || '—'}</div>
                    </div>

                    {complaintExpanded ? (
                      <div style={{ marginTop: 10 }}>
                        <div style={{ fontSize: 12, fontWeight: 900, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4 }}>Complaint Details</div>
                        <div style={{ marginTop: 8, whiteSpace: 'pre-wrap', fontSize: 15, fontWeight: 800, color: '#0f172a', lineHeight: 1.65 }}>
                          {complaint?.complaint_description || '—'}
                        </div>
                        {complaint?.id ? (
                          <div style={{ marginTop: 12 }}>
                            <a
                              className="dash-btn"
                              href={`/complaints/view?id=${complaint.id}`}
                              target="_blank"
                              rel="noreferrer"
                              style={{
                                textDecoration: 'none',
                                background: '#08204a',
                                color: '#fff',
                                borderRadius: 999,
                                padding: '0 18px',
                                minWidth: 96,
                                height: 40,
                                fontWeight: 900,
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                              }}
                            >
                              Open Full Complaint
                            </a>
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <div style={{ marginTop: 10, color: '#64748b', fontWeight: 800 }}>Details hidden to reduce clutter.</div>
                    )}
                  </div>
                </Panel>
              </div>

              <div style={{ marginTop: 14 }}>
                <Panel
                  title="Generated Mission Order (DOCX Preview)"
                  right={
                    missionOrder?.generated_docx_url ? (
                      <button
                        type="button"
                        className="dash-btn"
                        onClick={() => {
                          setDocxPreviewOpen((v) => !v);
                          setDocxPreviewError(false);
                        }}
                        style={{
                          background: '#08204a',
                          color: '#fff',
                          borderRadius: 999,
                          padding: '0 18px',
                          minWidth: 96,
                          height: 40,
                          fontWeight: 900,
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          border: 'none'
                        }}
                      >
                        {docxPreviewOpen ? 'Hide Preview' : 'Show Preview'}
                      </button>
                    ) : null
                  }
                >
                  {!missionOrder?.generated_docx_url ? (
                    <div style={{ color: '#64748b', fontWeight: 800 }}>No generated document yet.</div>
                  ) : docxPreviewOpen ? (
                    <div style={{ display: 'grid', gap: 10 }}>
                      {docxPreviewError ? (
                        <div className="dash-alert dash-alert-error">Preview failed to load. Use download instead.</div>
                      ) : null}

                      <iframe
                        key={officeViewerUrl}
                        title="DOCX Preview"
                        src={officeViewerUrl}
                        style={{ width: '100%', height: 560, border: '1px solid #e2e8f0', borderRadius: 14, background: '#fff' }}
                        onError={() => setDocxPreviewError(true)}
                      />

                      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                        <a className="dash-btn" href={missionOrder.generated_docx_url} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
                          Open in new tab
                        </a>
                      </div>
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
