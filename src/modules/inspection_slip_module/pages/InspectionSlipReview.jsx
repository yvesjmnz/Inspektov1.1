import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import DashboardSidebar from '../../../components/DashboardSidebar';
import '../../dashboard_module/pages/Dashboard.css';
import './InspectionSlipCreate.css';
import { generateInspectionSlipDocx } from '../lib/docx_template';

function getInspectionReportIdFromQuery() {
  const params = new URLSearchParams(window.location.search);
  return params.get('inspectionReportId') || params.get('reportId') || params.get('id');
}

function getMissionOrderIdFromQuery() {
  const params = new URLSearchParams(window.location.search);
  return params.get('missionOrderId') || params.get('moId') || null;
}

function getRoleFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const raw = String(params.get('role') || '').toLowerCase();
  if (raw === 'head_inspector' || raw === 'head inspector' || raw === 'head-inspector') return 'head_inspector';
  if (raw === 'director') return 'director';
  return 'director';
}

function formatStatus(status) {
  if (!status) return 'Unknown';
  return String(status)
    .replace(/_/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function statusBadgeStyle(status) {
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
}

function buildOfficeViewerUrl(docxUrl) {
  if (!docxUrl) return '';
  const src = encodeURIComponent(docxUrl);
  return `https://view.officeapps.live.com/op/embed.aspx?src=${src}`;
}

function appendUrlCacheBuster(url, cacheBuster) {
  if (!url) return '';
  const b = String(cacheBuster ?? '').trim();
  if (!b) return url;
  const joiner = url.includes('?') ? '&' : '?';
  return `${url}${joiner}v=${encodeURIComponent(b)}`;
}

export default function InspectionSlipReview() {
  const inspectionReportId = useMemo(() => getInspectionReportIdFromQuery(), []);
  const missionOrderIdFromQuery = useMemo(() => getMissionOrderIdFromQuery(), []);
  const role = useMemo(() => getRoleFromQuery(), []);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [generatingDocx, setGeneratingDocx] = useState(false);
  const [downloadingDocx, setDownloadingDocx] = useState(false);
  const [docxPreviewError, setDocxPreviewError] = useState(false);

  const [missionOrder, setMissionOrder] = useState(null);
  const [complaint, setComplaint] = useState(null);
  const [signedAttachmentUrl, setSignedAttachmentUrl] = useState('');
  const [signedAttachmentMeta, setSignedAttachmentMeta] = useState({
    uploadedAt: null,
    uploadedBy: null,
  });

  const [inspectionReport, setInspectionReport] = useState(null);

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

  const [ownerType] = useState('sole');
  const [lineOfBusinessList, setLineOfBusinessList] = useState(['']);
  const [checklist, setChecklist] = useState({
    business_permit: 'na',
    with_cctv: 'na',
    signage_2sqm: 'na',
  });
  const [cctvCount, setCctvCount] = useState('');
  const COMMENTS_MAX = 500;
  const [additionalComments, setAdditionalComments] = useState('');
  const [evidencePhotos, setEvidencePhotos] = useState([]);
  const [activePhotoUrl, setActivePhotoUrl] = useState('');
  const [hasInspectionData, setHasInspectionData] = useState(false);
  const [activeTab, setActiveTab] = useState('inspection_details');

  const [navCollapsed, setNavCollapsed] = useState(false);

  const mapUrl = useMemo(() => {
    const address = complaint?.business_address || '';
    if (!address) return null;
    return `https://www.google.com/maps?q=${encodeURIComponent(address)}&output=embed`;
  }, [complaint?.business_address]);

  useEffect(() => {
    const load = async () => {
      setError('');
      setToast('');
      setLoading(true);
      setInspectionReport(null);

      try {
        // Two entry modes:
        // 1) Completed / in-progress inspection: load by inspection report id.
        // 2) Pending inspection: load by mission order id only (no inspection data yet).
        if (!inspectionReportId && !missionOrderIdFromQuery) {
          setError(
            'Missing identifier. Open this page as /inspection-slip/review?id=<inspection_report_id> or /inspection-slip/review?missionOrderId=<mission_order_id>.'
          );
          return;
        }

        let missionOrderId = missionOrderIdFromQuery || null;

        if (inspectionReportId) {
          const { data: report, error: reportErr } = await supabase
            .from('inspection_reports')
            .select('*')
            .eq('id', inspectionReportId)
            .single();

          if (reportErr) throw reportErr;

          if (!report) {
            setError('Inspection report not found.');
            return;
          }

          missionOrderId = report.mission_order_id || missionOrderId;
          setHasInspectionData(true);
          setInspectionReport(report);

          // Hydrate from inspection report (mirror InspectionSlipCreate explicitReport logic)
          setAdditionalComments(report.inspection_comments || '');

          if (Array.isArray(report.lines_of_business) && report.lines_of_business.length) {
            setLineOfBusinessList(report.lines_of_business);
          }

          setBusinessDetails((prev) => ({
            ...prev,
            bin: report.bin ?? prev.bin,
            address: report.business_address ?? prev.address,
            estimatedAreaSqm:
              report.estimated_area_sqm != null ? String(report.estimated_area_sqm) : prev.estimatedAreaSqm,
            numberOfEmployees:
              report.no_of_employees != null ? String(report.no_of_employees) : prev.numberOfEmployees,
            landline: report.landline_no ?? prev.landline,
            cellphone: report.mobile_no ?? prev.cellphone,
            email: report.email_address ?? prev.email,
          }));

          if (report.business_name) {
            setOwnerDetails((prev) => ({ ...prev, businessName: report.business_name ?? prev.businessName }));
          }

          if (report.owner_name) {
            const ownerName = String(report.owner_name || '');
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

          setChecklist((p) => ({
            ...p,
            business_permit: String(report.business_permit_status || 'na'),
            with_cctv: String(report.cctv_status || 'na'),
            signage_2sqm: String(report.signage_status || 'na'),
          }));
          setCctvCount(report.cctv_count != null ? String(report.cctv_count) : '');

          if (Array.isArray(report.attachment_urls) && report.attachment_urls.length) {
            const mapped = [];
            for (const path of report.attachment_urls.filter(Boolean)) {
              // eslint-disable-next-line no-await-in-loop
              const { data: signed } = await supabase.storage.from('inspection').createSignedUrl(path, 60 * 60 * 24 * 7);
              mapped.push({ url: signed?.signedUrl || '', ts: report.completed_at || report.updated_at || null });
            }
            setEvidencePhotos(mapped.filter((x) => x.url));
          }
        } else {
          // No inspection report yet; this is a pending inspection view.
          setHasInspectionData(false);
          setInspectionReport(null);
        }

        if (missionOrderId) {
          const { data: mo, error: moErr } = await supabase
            .from('mission_orders')
            .select('*')
            .eq('id', missionOrderId)
            .single();

          if (moErr) throw moErr;
          setMissionOrder(mo);

          if (mo?.complaint_id) {
            const { data: c, error: cErr } = await supabase
              .from('complaints')
              .select('id, business_name, business_address, complaint_description, reporter_email, created_at, status')
              .eq('id', mo.complaint_id)
              .single();

            if (!cErr && c) {
              setComplaint(c);

              // If we don't have inspection data yet, at least seed basic business info for Summary.
              if (!hasInspectionData) {
                setOwnerDetails((prev) => ({
                  ...prev,
                  businessName: c.business_name || prev.businessName,
                }));
                setBusinessDetails((prev) => ({
                  ...prev,
                  address: c.business_address || prev.address,
                }));
              }
            }
          }

          setSignedAttachmentUrl(mo?.secretary_signed_attachment_url || '');
          setSignedAttachmentMeta({
            uploadedAt: mo?.secretary_signed_attachment_uploaded_at || null,
            uploadedBy: mo?.secretary_signed_attachment_uploaded_by || null,
          });
        }
      } catch (e) {
        setError(e?.message || 'Failed to load inspection slip.');
        setMissionOrder(null);
        setComplaint(null);
        setInspectionReport(null);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [inspectionReportId, missionOrderIdFromQuery, hasInspectionData]);

  const handleGenerateInspectionSlipDocx = async () => {
    if (!inspectionReportId) {
      setError('Missing inspection report identifier.');
      return;
    }

    setError('');
    setToast('');
    setGeneratingDocx(true);

    try {
      // Re-fetch to enforce: only after completion.
      const { data: freshReport, error: freshErr } = await supabase
        .from('inspection_reports')
        .select('*')
        .eq('id', inspectionReportId)
        .single();
      if (freshErr) throw freshErr;
      if (!freshReport) throw new Error('Inspection report not found.');

      const freshStatus = String(freshReport?.status || '').toLowerCase();
      if (freshStatus !== 'completed') {
        throw new Error('DOCX can only be generated after the inspection report is marked as completed.');
      }

      const INSPECTION_BUCKET = 'inspection';

      // Template (stored as `template_uis.docx` in the inspection bucket).
      const { data: tplSigned, error: tplErr } = await supabase.storage
        .from(INSPECTION_BUCKET)
        .createSignedUrl('Template/template_uis.docx', 60 * 60 * 24 * 7);

      if (tplErr) throw tplErr;
      if (!tplSigned?.signedUrl) throw new Error('Failed to create signed URL for inspection-slip template.');

      const templateUrl = tplSigned.signedUrl;

      // Mission order date (preferred) + time from the report timestamps.
      const missionOrderId = freshReport?.mission_order_id || missionOrder?.id || missionOrderIdFromQuery;

      let dateOfInspection = null;
      if (missionOrderId) {
        const { data: mo, error: moErr } = await supabase
          .from('mission_orders')
          .select('id, date_of_inspection')
          .eq('id', missionOrderId)
          .single();
        if (moErr) throw moErr;
        dateOfInspection = mo?.date_of_inspection || null;
      }

      if (!dateOfInspection) {
        dateOfInspection = freshReport?.started_at || freshReport?.completed_at || null;
      }

      const timeOfInspection = freshReport?.completed_at || freshReport?.started_at || null;

      // Inspector name(s): use mission_order_assignments if possible, fall back to report.inspector_id.
      let inspectorNames = '';

      if (missionOrderId) {
        const { data: assignedRows, error: assignedErr } = await supabase
          .from('mission_order_assignments')
          .select('inspector_id, assigned_at')
          .eq('mission_order_id', missionOrderId)
          .order('assigned_at', { ascending: true });
        if (assignedErr) throw assignedErr;

        const ids = Array.from(new Set((assignedRows || []).map((r) => r.inspector_id).filter(Boolean)));
        if (ids.length) {
          const { data: profiles, error: profilesErr } = await supabase
            .from('profiles')
            .select('id, full_name')
            .in('id', ids);
          if (profilesErr) throw profilesErr;

          const nameById = new Map((profiles || []).map((p) => [p.id, p.full_name]));
          inspectorNames = (assignedRows || [])
            .map((r) => nameById.get(r.inspector_id))
            .filter(Boolean)
            .filter((v, i, a) => a.indexOf(v) === i)
            .join(', ');
        }
      }

      if (!inspectorNames && freshReport?.inspector_id) {
        const { data: prof, error: profErr } = await supabase
          .from('profiles')
          .select('full_name')
          .eq('id', freshReport.inspector_id)
          .single();
        if (!profErr && prof?.full_name) inspectorNames = prof.full_name;
      }

      const ownerNameFromState = `${ownerDetails.lastName || ''}${ownerDetails.lastName && (ownerDetails.firstName || ownerDetails.middleName) ? ', ' : ''}${ownerDetails.firstName || ''}${ownerDetails.middleName ? ` ${ownerDetails.middleName}` : ''}`.trim();
      const owner_name = freshReport?.owner_name || ownerNameFromState || '';
      const business_name = freshReport?.business_name || ownerDetails?.businessName || '';

      // Signature placeholders (if template uses them).
      let inspector_signature_url = null;
      if (freshReport?.inspector_signature_url) {
        try {
          const raw = String(freshReport.inspector_signature_url || '').trim();
          // Some records store a full public URL; others store a storage path.
          // Support both so signatures render reliably.
          if (/^https?:\/\//i.test(raw)) {
            inspector_signature_url = raw;
          } else {
            const { data: sigSigned, error: sigErr } = await supabase.storage
              .from(INSPECTION_BUCKET)
              .createSignedUrl(raw, 60 * 60 * 24 * 7);
            if (sigErr) throw sigErr;
            inspector_signature_url = sigSigned?.signedUrl || null;
          }
        } catch {
          inspector_signature_url = null;
        }
      }

      let owner_signature_url = null;
      if (freshReport?.owner_signature_url) {
        try {
          const raw = String(freshReport.owner_signature_url || '').trim();
          if (/^https?:\/\//i.test(raw)) {
            owner_signature_url = raw;
          } else {
            const { data: sigSigned, error: sigErr } = await supabase.storage
              .from(INSPECTION_BUCKET)
              .createSignedUrl(raw, 60 * 60 * 24 * 7);
            if (sigErr) throw sigErr;
            owner_signature_url = sigSigned?.signedUrl || null;
          }
        } catch {
          owner_signature_url = null;
        }
      }

      const blob = await generateInspectionSlipDocx({
        templateUrl,

        owner_name,
        business_name: freshReport?.business_name || business_name,
        date_of_inspection: dateOfInspection,
        time_of_inspection: timeOfInspection,
        inspection_report_id: freshReport?.id,

        bin: freshReport?.bin,
        business_address: freshReport?.business_address,
        number_of_employees: freshReport?.no_of_employees ?? businessDetails.numberOfEmployees ?? null,
        landline_no: freshReport?.landline_no,
        email_address: freshReport?.email_address,

        inspector_names: inspectorNames,

        business_permit_status: freshReport?.business_permit_status,
        cctv_status: freshReport?.cctv_status,
        signage_status: freshReport?.signage_status,
        cctv_count: freshReport?.cctv_count,

        inspector_signature_url,
        owner_signature_url,
      });

      const objectPath = `inspection-reports/${freshReport.id}/INSPECTION-SLIP.docx`;

      // Persist the generated slip: overwrite so we can regenerate any number of times.
      const { error: uploadErr } = await supabase.storage
        .from(INSPECTION_BUCKET)
        .upload(objectPath, blob, {
          contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          upsert: true,
        });

      // If the file already exists (race), we can proceed to retrieve the URL.
      if (uploadErr) {
        const msg = String(uploadErr?.message || uploadErr || '').toLowerCase();
        const looksLikeAlreadyExists =
          msg.includes('already') || msg.includes('exists') || msg.includes('409') || msg.includes('conflict');
        if (!looksLikeAlreadyExists) throw uploadErr;
      }

      // Prefer public URL for Office viewer; fall back to signed URL if the bucket is private.
      let docxUrl = null;
      const { data: publicData } = supabase.storage.from(INSPECTION_BUCKET).getPublicUrl(objectPath);
      docxUrl = publicData?.publicUrl || null;

      if (!docxUrl) {
        const { data: signedObj, error: signedErr } = await supabase.storage
          .from(INSPECTION_BUCKET)
          .createSignedUrl(objectPath, 60 * 60 * 24 * 7);
        if (signedErr) throw signedErr;
        docxUrl = signedObj?.signedUrl || null;
      }

      if (!docxUrl) throw new Error('Failed to resolve generated inspection slip DOCX URL.');

      const nowIso = new Date().toISOString();
      const { data: userData, error: userErr } = await supabase.auth.getUser();
      if (userErr) throw userErr;
      const userId = userData?.user?.id;
      if (!userId) throw new Error('Not authenticated. Please login again.');

      const { error: updateErr } = await supabase
        .from('inspection_reports')
        .update({
          generated_docx_url: docxUrl,
          generated_docx_created_at: nowIso,
          generated_docx_created_by: userId,
          updated_at: nowIso,
        })
        .eq('id', freshReport.id);

      if (updateErr) {
        // If another request won the race, we can still refresh and show success.
        // eslint-disable-next-line no-console
        console.warn('DOCX persist update failed:', updateErr);
      }

      const { data: after, error: afterErr } = await supabase
        .from('inspection_reports')
        .select('*')
        .eq('id', freshReport.id)
        .single();
      if (afterErr) throw afterErr;

      setInspectionReport(after);
      setDocxPreviewError(false);
      setToast('Inspection slip DOCX generated/regenerated.');
    } catch (e) {
      setError(e?.message || 'Failed to generate inspection slip DOCX.');
    } finally {
      setGeneratingDocx(false);
    }
  };

  const inspectionStatusLower = String(inspectionReport?.status || '').toLowerCase();
  const isInspectionCompleted = hasInspectionData && inspectionStatusLower === 'completed';
  const hasGeneratedInspectionSlipDocx = !!inspectionReport?.generated_docx_url;
  const canGenerateInspectionSlipDocx =
    isInspectionCompleted;

  const officeViewerUrl = useMemo(() => {
    const baseUrl = inspectionReport?.generated_docx_url || '';
    const cacheBuster = inspectionReport?.generated_docx_created_at || inspectionReport?.updated_at || '';
    const versionedUrl = appendUrlCacheBuster(baseUrl, cacheBuster);
    return buildOfficeViewerUrl(versionedUrl);
  }, [inspectionReport?.generated_docx_url, inspectionReport?.generated_docx_created_at, inspectionReport?.updated_at]);

  const versionedGeneratedDocxUrl = useMemo(() => {
    const baseUrl = inspectionReport?.generated_docx_url || '';
    const cacheBuster = inspectionReport?.generated_docx_created_at || inspectionReport?.updated_at || '';
    return appendUrlCacheBuster(baseUrl, cacheBuster);
  }, [inspectionReport?.generated_docx_url, inspectionReport?.generated_docx_created_at, inspectionReport?.updated_at]);

  useEffect(() => {
    if (activeTab === 'summary' && !isInspectionCompleted) {
      setActiveTab('inspection_details');
    }
  }, [activeTab, isInspectionCompleted]);

  const backHref =
    role === 'head_inspector'
      ? '/dashboard/head-inspector#inspection-history'
      : '/dashboard/director?tab=inspection-history';

  const handleDownloadInspectionSlipDocx = async () => {
    if (!inspectionReport?.generated_docx_url) return;
    if (downloadingDocx) return;

    setError('');
    setToast('');
    setDownloadingDocx(true);

    try {
      const nowIso = new Date().toISOString();

      // Mark tracking as complete when the DOCX is downloaded.
      // Best-effort: complaint status constraints may vary, so failures shouldn't block the download.
      if (complaint?.id) {
        const { error: complaintErr } = await supabase
          .from('complaints')
          .update({ status: 'completed', updated_at: nowIso })
          .eq('id', complaint.id);
        if (complaintErr) console.warn('Failed to mark complaint complete:', complaintErr);
      }

      if (missionOrder?.id) {
        const { error: moErr } = await supabase
          .from('mission_orders')
          .update({ status: 'complete', updated_at: nowIso })
          .eq('id', missionOrder.id);
        if (moErr) console.warn('Failed to mark mission order complete:', moErr);
      }

      setToast('Inspection slip DOCX downloaded and tracking marked complete.');
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('Failed to update tracking completion on download:', e);
      setToast('Inspection slip downloaded.');
    } finally {
      setDownloadingDocx(false);
    }

    // Cache-bust to ensure regenerate shows the newest content.
    window.open(versionedGeneratedDocxUrl || inspectionReport?.generated_docx_url, '_blank', 'noreferrer');
  };

  return (
    <div className="dash-container">
      <main className="dash-main">
        <section className="dash-shell" style={{ paddingLeft: navCollapsed ? 72 : 240 }}>
          <DashboardSidebar
            role={role === 'head_inspector' ? 'head_inspector' : 'director'}
            onLogout={async () => {
              try {
                await supabase.auth.signOut({ scope: 'global' });
              } finally {
                try {
                  localStorage.clear();
                  sessionStorage.clear();
                } catch {
                  // ignore
                }
                window.location.replace('/login');
              }
            }}
            collapsed={navCollapsed}
            onCollapsedChange={setNavCollapsed}
          />

          <div className="dash-maincol">
            <div className="dash-card">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                  <div>
                    <a
                      href={backHref}
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
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                        style={{ display: 'block' }}
                      >
                        <path
                          d="M15 18L9 12L15 6"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                      Back
                    </a>
                  </div>

                  <span
                    aria-hidden="true"
                    style={{ width: 1, height: 36, background: '#e2e8f0', display: 'inline-block', marginTop: 2 }}
                  />

                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 1000, fontSize: 20, color: '#0f172a' }}>Inspection Slip</div>
                    <div style={{ color: '#475569', fontWeight: 800, marginTop: 6, fontSize: 14 }}>
                      Read-only overview of inspection details and summary.
                    </div>
                  </div>
                </div>
              </div>

              {error ? <div className="dash-alert dash-alert-error" style={{ marginTop: 12 }}>{error}</div> : null}
              {toast ? (
                <div className="dash-alert" style={{ marginTop: 12, color: '#166534', fontWeight: 900 }}>
                  {toast}
                </div>
              ) : null}

              {loading ? (
                <div style={{ marginTop: 16, color: '#475569', fontWeight: 700 }}>Loading inspection slip…</div>
              ) : !missionOrder && !inspectionReportId && !missionOrderIdFromQuery ? (
                <div style={{ marginTop: 16, color: '#475569', fontWeight: 700 }}>
                  No inspection slip data found.
                </div>
              ) : (
                <div style={{ display: 'grid', gap: 16, marginTop: 16 }}>
                  <div
                    style={{
                      display: 'flex',
                      gap: 8,
                      flexWrap: 'wrap',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <div className="is-seg" role="tablist" aria-label="Inspection slip review tabs">
                      <button
                        type="button"
                        role="tab"
                        aria-selected={activeTab === 'inspection_details'}
                        className={activeTab === 'inspection_details' ? 'active' : ''}
                        onClick={() => setActiveTab('inspection_details')}
                      >
                        Inspection Details
                      </button>
                      {isInspectionCompleted ? (
                        <button
                          type="button"
                          role="tab"
                          aria-selected={activeTab === 'summary'}
                          className={activeTab === 'summary' ? 'active' : ''}
                          onClick={() => setActiveTab('summary')}
                        >
                          Summary
                        </button>
                      ) : null}
                    </div>

                    <div style={{ color: '#64748b', fontWeight: 700, fontSize: 12 }}>
                      {isInspectionCompleted
                        ? 'Switch between the inspection details and summary overview.'
                        : 'Inspection summary becomes available once the report is completed.'}
                    </div>
                  </div>

                  {activeTab === 'inspection_details' ? (
                    <div className="is-card">
                      <div
                        className="is-section-head"
                        style={{
                          background: '#172b57',
                          color: '#ffffff',
                          margin: '-18px -18px 0',
                          padding: '18px 18px 22px',
                          borderRadius: '18px 18px 0 0',
                        }}
                      >
                        <div>
                          <p className="is-section-title" style={{ color: '#ffffff' }}>Inspection Details</p>
                          <p className="is-section-sub" style={{ color: 'rgba(255, 255, 255, 0.82)' }}>
                            Mission order and complaint context for this inspection.
                          </p>
                        </div>
                      </div>

                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'minmax(0, 1.15fr) minmax(320px, 0.85fr)',
                          gap: 16,
                          alignItems: 'start',
                          marginTop: 16,
                        }}
                      >
                        <div style={{ display: 'grid', gap: 16, minWidth: 0 }}>
                          <div className="is-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
                            <div className="is-field">
                              <label>Inspection Report ID</label>
                              <div style={{ fontWeight: 900, color: '#0f172a' }}>
                                {inspectionReportId ? `${String(inspectionReportId).slice(0, 8)}...` : '--'}
                              </div>
                            </div>

                            <div className="is-field">
                              <label>Mission Order ID</label>
                              <div style={{ fontWeight: 900, color: '#0f172a' }}>
                                {missionOrder?.id ? `${String(missionOrder.id).slice(0, 8)}...` : '--'}
                              </div>
                            </div>

                            <div className="is-field">
                              <label>Mission Order Status</label>
                              <div style={statusBadgeStyle(missionOrder?.status)}>{formatStatus(missionOrder?.status)}</div>
                            </div>

                            <div className="is-field" style={{ gridColumn: '1 / -1' }}>
                              <label>Title</label>
                              <div style={{ fontWeight: 900, color: '#0f172a' }}>{missionOrder?.title || '--'}</div>
                            </div>
                          </div>

                          <div
                            className="is-grid"
                            style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}
                          >
                            <div className="is-field">
                              <label>Business Name</label>
                              <div style={{ fontWeight: 800, color: '#0f172a' }}>
                                {complaint?.business_name || ownerDetails.businessName || '--'}
                              </div>
                            </div>
                            <div className="is-field" style={{ gridColumn: '1 / -1' }}>
                              <label>Business Address</label>
                              <div style={{ fontWeight: 800, color: '#0f172a' }}>
                                {complaint?.business_address || businessDetails.address || '--'}
                              </div>
                            </div>
                          </div>

                          <div className="is-card" style={{ marginTop: 0 }}>
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
                                  marginTop: 12,
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
                        </div>

                        <div style={{ minWidth: 0 }}>
                          <div className="is-card" style={{ marginTop: 0 }}>
                            <div className="is-section-head">
                              <div>
                                <p className="is-section-title">Signed Attachment</p>
                                <p className="is-section-sub">Uploaded by the Secretary.</p>
                              </div>
                            </div>

                            <div
                              style={{
                                marginTop: 12,
                                border: '1px solid #e2e8f0',
                                borderRadius: 12,
                                background: '#ffffff',
                                overflow: 'hidden',
                              }}
                            >
                              {!signedAttachmentUrl ? (
                                <div className="mo-meta" style={{ padding: 12 }}>
                                  No signed attachment uploaded.
                                </div>
                              ) : /\.pdf(\?|#|$)/i.test(String(signedAttachmentUrl)) ? (
                                <iframe
                                  title="Signed Attachment (PDF)"
                                  src={signedAttachmentUrl}
                                  style={{ width: '100%', height: 560, border: 0, display: 'block' }}
                                />
                              ) : (
                                <div style={{ padding: 12, background: '#0b1220' }}>
                                  <img
                                    src={signedAttachmentUrl}
                                    alt="Signed Attachment"
                                    style={{
                                      width: '100%',
                                      height: 'auto',
                                      maxHeight: 720,
                                      objectFit: 'contain',
                                      display: 'block',
                                      borderRadius: 10,
                                      background: '#0b1220',
                                    }}
                                  />
                                </div>
                              )}

                              {signedAttachmentUrl ? (
                                <div style={{ padding: 12, borderTop: '1px solid #e2e8f0', background: '#f8fafc' }}>
                                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                                    <a
                                      href={signedAttachmentUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="mo-link"
                                      style={{ fontWeight: 900 }}
                                    >
                                      Open in new tab
                                    </a>
                                    <span style={{ color: '#64748b', fontWeight: 700, fontSize: 12 }}>
                                      {signedAttachmentMeta.uploadedAt
                                        ? `Uploaded: ${new Date(signedAttachmentMeta.uploadedAt).toLocaleString()}`
                                        : ''}
                                    </span>
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {activeTab === 'summary' && isInspectionCompleted ? (
                    <div className="is-card">
                      <div
                        className="is-section-head"
                        style={{
                          background: '#172b57',
                          color: '#ffffff',
                          margin: '-18px -18px 0',
                          padding: '18px 18px 22px',
                          borderRadius: '18px 18px 0 0',
                        }}
                      >
                        <div>
                          <p className="is-section-title" style={{ color: '#ffffff' }}>Summary</p>
                          <p className="is-section-sub" style={{ color: 'rgba(255, 255, 255, 0.82)' }}>
                            Review key details below.
                          </p>
                        </div>
                      </div>

                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'minmax(0, 1.15fr) minmax(320px, 0.85fr)',
                          gap: 16,
                          alignItems: 'stretch',
                          marginTop: 16,
                        }}
                      >
                        <div
                          className="is-grid"
                          style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}
                        >
                          <div
                            style={{
                              gridColumn: '1 / -1',
                              display: 'grid',
                              gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                              gap: 16,
                              padding: 16,
                              border: '1px solid #dbe5f3',
                              borderRadius: 16,
                              background: '#fbfdff',
                              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.7)',
                            }}
                          >
                          <div className="is-field">
                            <label>Owner Type</label>
                            <div style={{ fontWeight: 800, color: '#0f172a' }}>
                              {ownerType === 'sole' ? 'Sole Proprietor' : 'Corporation'}
                            </div>
                          </div>

                          <div className="is-field">
                            <label>BIN #</label>
                            <div style={{ fontWeight: 800, color: '#0f172a' }}>{businessDetails.bin || '--'}</div>
                          </div>

                          <div className="is-field" style={{ gridColumn: '1 / -1' }}>
                            <label>Business Name</label>
                            <div style={{ fontWeight: 800, color: '#0f172a' }}>{ownerDetails.businessName || '--'}</div>
                          </div>

                          <div className="is-field" style={{ gridColumn: '1 / -1' }}>
                            <label>Business Address</label>
                            <div style={{ fontWeight: 800, color: '#0f172a' }}>{businessDetails.address || '--'}</div>
                          </div>

                          <div className="is-field" style={{ gridColumn: '1 / -1' }}>
                            <label>Owner Name</label>
                            <div style={{ fontWeight: 800, color: '#0f172a' }}>
                              {`${ownerDetails.lastName || ''}${
                                ownerDetails.lastName && (ownerDetails.firstName || ownerDetails.middleName) ? ', ' : ''
                              }${ownerDetails.firstName || ''}${
                                ownerDetails.middleName ? ` ${ownerDetails.middleName}` : ''
                              }`.trim() || '--'}
                            </div>
                          </div>

                          <div className="is-field" style={{ gridColumn: '1 / -1' }}>
                            <label>Line(s) of Business</label>
                            <div style={{ fontWeight: 700, color: '#0f172a', whiteSpace: 'pre-wrap' }}>
                              {lineOfBusinessList.filter(Boolean).length
                                ? lineOfBusinessList
                                    .filter(Boolean)
                                    .map((x) => `- ${x}`)
                                    .join('\n')
                                : '--'}
                            </div>
                          </div>

                          <div className="is-field">
                            <label>Estimated Area (SQM)</label>
                            <div style={{ fontWeight: 800, color: '#0f172a' }}>
                              {businessDetails.estimatedAreaSqm || '--'}
                            </div>
                          </div>

                          <div className="is-field">
                            <label>No. of Employees</label>
                            <div style={{ fontWeight: 800, color: '#0f172a' }}>
                              {businessDetails.numberOfEmployees || '--'}
                            </div>
                          </div>

                          <div className="is-field">
                            <label>Landline</label>
                            <div style={{ fontWeight: 800, color: '#0f172a' }}>{businessDetails.landline || '--'}</div>
                          </div>

                          <div className="is-field">
                            <label>Cellphone</label>
                            <div style={{ fontWeight: 800, color: '#0f172a' }}>{businessDetails.cellphone || '--'}</div>
                          </div>

                          <div className="is-field" style={{ gridColumn: '1 / -1' }}>
                            <label>Email</label>
                            <div style={{ fontWeight: 800, color: '#0f172a' }}>{businessDetails.email || '--'}</div>
                          </div>
                          </div>

                          <div className="is-field" style={{ gridColumn: '1 / -1', marginTop: 8 }}>
                            <div
                              style={{
                                border: '1px solid #dbe5f3',
                                borderRadius: 16,
                                background: '#ffffff',
                                padding: 16,
                              }}
                            >
                            <div className="is-section-head" style={{ marginBottom: 12 }}>
                              <div>
                                <p className="is-section-title">Compliance Checklist</p>
                                <p className="is-section-sub">Summary of the inspector's selections.</p>
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
                                          {cctvCount
                                            ? `${cctvCount} CCTV${String(cctvCount) === '1' ? '' : 's'}`
                                            : 'CCTV count not set'}
                                        </span>
                                      ) : null}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                            </div>
                          </div>

                          <div className="is-field" style={{ gridColumn: '1 / -1', marginTop: 8 }}>
                            <div
                              style={{
                                border: '1px solid #dbe5f3',
                                borderRadius: 16,
                                background: '#ffffff',
                                padding: 16,
                              }}
                            >
                            <div className="is-section-head" style={{ marginBottom: 12 }}>
                              <div>
                                <p className="is-section-title">Additional Observations</p>
                                <p className="is-section-sub">Inspector remarks / findings.</p>
                              </div>
                            </div>

                            <div className="is-field" style={{ marginTop: 4 }}>
                              <label>Remarks</label>
                              <div style={{ fontWeight: 800, color: '#0f172a', whiteSpace: 'pre-wrap' }}>
                                {additionalComments?.trim() ? additionalComments : '--'}
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
                                      key={p.url || idx}
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
                                <div style={{ fontWeight: 800, color: '#64748b' }}>--</div>
                              )}
                            </div>
                            </div>
                          </div>
                        </div>

                        <div style={{ minWidth: 0, height: '100%' }}>
                          <div className="is-card" style={{ marginTop: 0, height: '100%', display: 'flex', flexDirection: 'column' }}>
                            <div
                              className="is-section-head"
                              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}
                            >
                              <div>
                                <p className="is-section-title">Inspection Slip DOCX</p>
                                <p className="is-section-sub">Generate / regenerate after inspection completion.</p>
                              </div>

                              {hasGeneratedInspectionSlipDocx ? (
                                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end' }}>
                                  <span style={{ fontWeight: 900, color: '#166534' }}>Generated</span>
                                  <button
                                    type="button"
                                    className="mo-btn mo-btn-primary"
                                    onClick={handleDownloadInspectionSlipDocx}
                                    disabled={downloadingDocx}
                                    style={{ textDecoration: 'none' }}
                                  >
                                    {downloadingDocx ? 'Preparing...' : 'Download DOCX'}
                                  </button>
                                  {canGenerateInspectionSlipDocx ? (
                                    <button
                                      type="button"
                                      className="mo-btn mo-btn-primary"
                                      onClick={handleGenerateInspectionSlipDocx}
                                      disabled={generatingDocx}
                                    >
                                      {generatingDocx ? 'Generating...' : 'Regenerate DOCX'}
                                    </button>
                                  ) : null}
                                </div>
                              ) : canGenerateInspectionSlipDocx ? (
                                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end' }}>
                                  <button
                                    type="button"
                                    className="mo-btn mo-btn-primary"
                                    onClick={handleGenerateInspectionSlipDocx}
                                    disabled={generatingDocx}
                                  >
                                    {generatingDocx ? 'Generating...' : 'Generate DOCX'}
                                  </button>
                                </div>
                              ) : null}
                            </div>

                            {hasGeneratedInspectionSlipDocx ? (
                              <div style={{ display: 'grid', gap: 10, flex: 1, minHeight: 0, marginTop: 8 }}>
                                <div style={{ display: 'grid', gap: 10, flex: 1, minHeight: 760 }}>
                                  <iframe
                                    key={`inspection-slip-docx-${inspectionReport?.generated_docx_created_at || inspectionReport?.updated_at || officeViewerUrl}`}
                                    title="Inspection Slip DOCX Preview"
                                    src={officeViewerUrl}
                                    style={{
                                      width: '100%',
                                      height: '100%',
                                      border: '1px solid #e2e8f0',
                                      borderRadius: 14,
                                      background: '#fff',
                                    }}
                                    onError={() => setDocxPreviewError(true)}
                                  />

                                  {docxPreviewError ? (
                                    <div className="dash-alert dash-alert-error">Preview failed to load.</div>
                                  ) : null}
                                </div>
                              </div>
                            ) : canGenerateInspectionSlipDocx ? (
                              <div style={{ flex: 1, minHeight: 0 }} />
                            ) : (
                              <div
                                style={{
                                  marginTop: 8,
                                  padding: 16,
                                  borderRadius: 12,
                                  background: '#f8fafc',
                                  border: '1px dashed #cbd5e1',
                                  fontWeight: 700,
                                  color: '#475569',
                                }}
                              >
                                DOCX generation is available only after the inspection report is marked as <b>completed</b>.
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : null}

                </div>
              )}
            </div>
          </div>
        </section>
      </main>

      {activePhotoUrl ? (
        <div
          className="image-overlay"
          onClick={() => setActivePhotoUrl('')}
          role="dialog"
          aria-modal="true"
        >
          <div className="overlay-content" onClick={(e) => e.stopPropagation()}>
            <button className="overlay-close" onClick={() => setActivePhotoUrl('')} aria-label="Close">
              &times;
            </button>
            <img src={activePhotoUrl} alt="Evidence Preview" className="overlay-full-img" />
          </div>
        </div>
      ) : null}
    </div>
  );
}

