import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import DashboardSidebar from '../../../components/DashboardSidebar';
import '../../dashboard_module/pages/Dashboard.css';
import './InspectionSlipCreate.css';
import { generateInspectionSlipDocx } from '../lib/docx_template';
import { normalizeInspectionReportStatus, pickPreferredInspectionReport } from '../../../lib/inspectionReports';

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

function formatDateHuman(value) {
  if (!value) return '--';
  const s = String(value);
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00`) : new Date(s);
  if (Number.isNaN(d.getTime())) return '--';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

function formatPhotoTimestamp(value) {
  if (!value) return '--';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '--';

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

function fromDbStatus(value) {
  const s = String(value || '').toLowerCase();
  if (s.includes('non')) return 'non_compliant';
  if (s.includes('compliant')) return 'compliant';
  return 'na';
}

function formatChecklistStatus(value) {
  if (value === 'compliant') return 'Compliant';
  if (value === 'non_compliant') return 'Non-Compliant';
  return 'N/A';
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

function OverviewField({ label, children, fullWidth = false }) {
  return (
    <div
      className="is-field"
      style={{
        gridColumn: fullWidth ? '1 / -1' : undefined,
        border: '1px solid #dbe5f3',
        borderRadius: 16,
        background: '#fbfdff',
        padding: '16px 18px',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.7)',
      }}
    >
      <label>{label}</label>
      <div style={{ fontWeight: 900, color: '#0f172a', marginTop: 8, lineHeight: 1.5, wordBreak: 'break-word' }}>
        {children}
      </div>
    </div>
  );
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
  const [additionalComments, setAdditionalComments] = useState('');
  const [evidencePhotos, setEvidencePhotos] = useState([]);
  const [activePhotoUrl, setActivePhotoUrl] = useState('');
  const [hasInspectionData, setHasInspectionData] = useState(false);
  const [assignedInspectors, setAssignedInspectors] = useState([]);
  const [refreshTick, setRefreshTick] = useState(0);

  const [navCollapsed, setNavCollapsed] = useState(false);
  const signageSqm = inspectionReport?.signage_sqm != null ? String(inspectionReport.signage_sqm) : '';

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
      setHasInspectionData(false);
      setInspectionReport(null);
      setAssignedInspectors([]);
      setSignedAttachmentUrl('');
      setSignedAttachmentMeta({
        uploadedAt: null,
        uploadedBy: null,
      });
      setOwnerDetails({
        lastName: '',
        firstName: '',
        middleName: '',
        businessName: '',
      });
      setBusinessDetails({
        bin: '',
        address: '',
        estimatedAreaSqm: '',
        numberOfEmployees: '',
        landline: '',
        cellphone: '',
        email: '',
      });
      setLineOfBusinessList(['']);
      setChecklist({
        business_permit: 'na',
        with_cctv: 'na',
        signage_2sqm: 'na',
      });
      setCctvCount('');
      setAdditionalComments('');
      setEvidencePhotos([]);

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
        let loadedReportInspectorId = null;
        let resolvedHasInspectionData = false;

        const applyInspectionReportState = async (report) => {
          if (!report) return;

          missionOrderId = report.mission_order_id || missionOrderId;
          loadedReportInspectorId = report.inspector_id || null;
          resolvedHasInspectionData = true;

          setInspectionReport(report);
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
            business_permit: fromDbStatus(report.business_permit_status),
            with_cctv: fromDbStatus(report.cctv_status),
            signage_2sqm: fromDbStatus(report.signage_status),
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
        };

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

          await applyInspectionReportState(report);
        } else if (missionOrderId) {
          const { data: reportRows, error: reportErr } = await supabase
            .from('inspection_reports')
            .select('*')
            .eq('mission_order_id', missionOrderId)
            .order('updated_at', { ascending: false });

          if (reportErr) throw reportErr;

          const preferredReport = pickPreferredInspectionReport(reportRows || []);
          if (preferredReport) {
            await applyInspectionReportState(preferredReport);
          }
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
              .select('id, business_name, business_address, complaint_description, reporter_email, created_at, status, tags')
              .eq('id', mo.complaint_id)
              .single();

            if (!cErr && c) {
              setComplaint(c);

              // If we don't have inspection data yet, at least seed basic business info for Summary.
              if (!resolvedHasInspectionData) {
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

          const { data: assignmentRows, error: assignmentErr } = await supabase
            .from('mission_order_assignments')
            .select('inspector_id, assigned_at')
            .eq('mission_order_id', mo.id)
            .order('assigned_at', { ascending: true });

          if (assignmentErr) throw assignmentErr;

          const inspectorIds = Array.from(new Set((assignmentRows || []).map((row) => row.inspector_id).filter(Boolean)));
          let inspectorList = [];

          if (inspectorIds.length) {
            const { data: profiles, error: profilesErr } = await supabase
              .from('profiles')
              .select('id, full_name')
              .in('id', inspectorIds);

            if (profilesErr) throw profilesErr;

            const profileMap = new Map((profiles || []).map((profile) => [profile.id, profile.full_name]));
            inspectorList = (assignmentRows || [])
              .map((row) => profileMap.get(row.inspector_id))
              .filter(Boolean)
              .filter((value, index, arr) => arr.indexOf(value) === index);
          }

          const fallbackInspectorId = loadedReportInspectorId || null;
          if (!inspectorList.length && fallbackInspectorId) {
            const { data: profile, error: profileErr } = await supabase
              .from('profiles')
              .select('full_name')
              .eq('id', fallbackInspectorId)
              .single();

            if (profileErr) throw profileErr;
            if (profile?.full_name) inspectorList = [profile.full_name];
          }

          setAssignedInspectors(inspectorList);
        }
        setHasInspectionData(resolvedHasInspectionData);
      } catch (e) {
        setError(e?.message || 'Failed to load inspection slip.');
        setMissionOrder(null);
        setComplaint(null);
        setInspectionReport(null);
        setAssignedInspectors([]);
        setHasInspectionData(false);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [inspectionReportId, missionOrderIdFromQuery, refreshTick]);

  useEffect(() => {
    if (!inspectionReportId && !missionOrderIdFromQuery) return undefined;

    const filter = inspectionReportId
      ? `id=eq.${inspectionReportId}`
      : `mission_order_id=eq.${missionOrderIdFromQuery}`;

    const channel = supabase
      .channel(`inspection-slip-review:${inspectionReportId || missionOrderIdFromQuery}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inspection_reports', filter }, () => {
        setRefreshTick((value) => value + 1);
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [inspectionReportId, missionOrderIdFromQuery]);

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
        estimated_area_sqm: freshReport?.estimated_area_sqm ?? businessDetails.estimatedAreaSqm ?? null,
        number_of_employees: freshReport?.no_of_employees ?? businessDetails.numberOfEmployees ?? null,
        landline_no: freshReport?.landline_no,
        email_address: freshReport?.email_address,

        inspector_names: inspectorNames,

        business_permit_status: freshReport?.business_permit_status,
        cctv_status: freshReport?.cctv_status,
        signage_status: freshReport?.signage_status,
        cctv_count: freshReport?.cctv_count,
        signage_sqm: freshReport?.signage_sqm,

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
    } catch (e) {
      setError(e?.message || 'Failed to generate inspection slip DOCX.');
    } finally {
      setGeneratingDocx(false);
    }
  };

  const inspectionStatusValue = hasInspectionData ? normalizeInspectionReportStatus(inspectionReport) : 'pending inspection';
  const inspectionStatusLower = String(inspectionStatusValue || '').toLowerCase();
  const isInspectionCompleted = hasInspectionData && inspectionStatusLower === 'completed';
  const hasGeneratedInspectionSlipDocx = !!inspectionReport?.generated_docx_url;
  const canGenerateInspectionSlipDocx =
    isInspectionCompleted;
  const docxPrimaryButtonStyle = {
    background: 'linear-gradient(90deg, #1e3a8a 0%, #0b2249 100%)',
    color: '#ffffff',
    border: '1px solid rgba(255,255,255,0.14)',
    boxShadow: '0 12px 28px rgba(15, 23, 42, 0.18)',
    whiteSpace: 'nowrap',
    padding: '10px 12px',
    minWidth: 0,
    fontSize: 13,
  };
  const docxSecondaryButtonStyle = {
    background: '#ffffff',
    color: '#0b2249',
    border: '1px solid #c7d7f2',
    boxShadow: '0 8px 18px rgba(15, 23, 42, 0.08)',
    whiteSpace: 'nowrap',
    padding: '10px 12px',
    minWidth: 0,
    fontSize: 13,
  };

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

  const backHref = useMemo(() => {
    const inspectionSource = (() => {
      try {
        return sessionStorage.getItem('inspectionSource');
      } catch {
        return null;
      }
    })();

    if (role === 'head_inspector') {
      return inspectionSource === 'inspection-history'
        ? '/dashboard/head-inspector#inspection-history'
        : '/dashboard/head-inspector#inspection';
    }

    return inspectionSource === 'inspection-history'
      ? '/dashboard/director?tab=inspection-history'
      : '/dashboard/director?tab=inspection';
  }, [role]);

  const displayBusinessName = complaint?.business_name || ownerDetails.businessName || missionOrder?.business_name || '--';
  const displayBusinessAddress = complaint?.business_address || businessDetails.address || missionOrder?.business_address || '--';
  const complaintViolationGroups = useMemo(() => groupComplaintCategoriesFromTags(complaint?.tags || []), [complaint?.tags]);
  const inspectionStatusLabel = formatStatus(inspectionStatusValue);
  const signedAttachmentUploadedLabel = signedAttachmentMeta.uploadedAt
    ? `Uploaded ${new Date(signedAttachmentMeta.uploadedAt).toLocaleString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })}`
    : '';

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

    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('Failed to update tracking completion on download:', e);
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
                    <div style={{ fontWeight: 1000, fontSize: 20, color: '#0f172a' }}>Inspection Details</div>
                    <div style={{ color: '#475569', fontWeight: 800, marginTop: 6, fontSize: 14 }}>
                      Overview of inspection details and summary
                    </div>
                  </div>
                </div>
              </div>

              {error ? <div className="dash-alert dash-alert-error" style={{ marginTop: 12 }}>{error}</div> : null}
              {loading ? (
                <div style={{ marginTop: 16, color: '#475569', fontWeight: 700 }}>Loading inspection slip…</div>
              ) : !missionOrder && !inspectionReportId && !missionOrderIdFromQuery ? (
                <div style={{ marginTop: 16, color: '#475569', fontWeight: 700 }}>
                  No inspection slip data found.
                </div>
              ) : (
                <div style={{ display: 'grid', gap: 16, marginTop: 16 }}>
                  <div className="is-card">
                    <div
                      className="is-section-head"
                      style={{
                        background: 'linear-gradient(90deg, #1e3a8a 0%, #0b2249 100%)',
                        color: '#ffffff',
                        margin: '-18px -18px 0',
                        padding: '20px 22px 24px',
                        borderRadius: '18px 18px 0 0',
                        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08)',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'flex-start',
                          justifyContent: 'space-between',
                          gap: 16,
                          flexWrap: 'wrap',
                          width: '100%',
                        }}
                      >
                        <div style={{ minWidth: 0, flex: '1 1 520px' }}>
                          <div
                            style={{
                              fontSize: 18,
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

                        <div
                          style={{
                            alignSelf: 'flex-start',
                            marginLeft: 'auto',
                            display: 'flex',
                            justifyContent: 'flex-end',
                            flex: '0 0 auto',
                            whiteSpace: 'nowrap',
                          }}
                        >
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
                      </div>
                    </div>

                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'minmax(0, 1.15fr) minmax(320px, 0.85fr)',
                        gap: 16,
                        alignItems: 'stretch',
                        marginTop: 18,
                      }}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
                        <div
                          className="is-grid"
                          style={{
                            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                            gap: 14,
                          }}
                        >
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
                              '--'
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
                              '--'
                            )}
                          </OverviewField>
                        </div>

                        <div className="is-card" style={{ marginTop: 0, display: 'flex', flexDirection: 'column', flex: 1 }}>
                          <div className="is-section-head">
                            <div>
                              <p className="is-section-title">MAP PREVIEW</p>
                              <p className="is-section-sub">Approximate location of the reported business address.</p>
                            </div>
                          </div>

                          {!mapUrl ? (
                            <div className="mo-meta" style={{ flex: 1 }}>No address available for map preview.</div>
                          ) : (
                            <div
                              style={{
                                borderRadius: 12,
                                overflow: 'hidden',
                                border: '1px solid #e2e8f0',
                                background: '#fff',
                                marginTop: 12,
                                display: 'flex',
                                flex: 1,
                              }}
                            >
                              <iframe
                                title="Business Location"
                                src={mapUrl}
                                width="100%"
                                height="100%"
                                style={{ border: 0, display: 'block', flex: 1, minHeight: 460 }}
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
                              {signedAttachmentUploadedLabel ? (
                                <p className="is-section-sub" style={{ marginTop: 4 }}>
                                  {signedAttachmentUploadedLabel}
                                </p>
                              ) : null}
                            </div>
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
                                No signed attachment uploaded.
                              </div>
                            ) : /\.pdf(\?|#|$)/i.test(String(signedAttachmentUrl)) ? (
                              <iframe
                                title="Signed Attachment (PDF)"
                                src={signedAttachmentUrl}
                                style={{ width: '100%', height: '100%', minHeight: 460, border: 0, display: 'block', flex: 1 }}
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
                  </div>

                  {isInspectionCompleted ? (
                    <div className="is-card">
                      <div
                        className="is-section-head"
                        style={{
                          background: 'linear-gradient(90deg, #1e3a8a 0%, #0b2249 100%)',
                          color: '#ffffff',
                          margin: '-18px -18px 0',
                          padding: '20px 18px',
                          borderRadius: '18px 18px 0 0',
                          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08)',
                        }}
                      >
                        <div>
                          <p
                            className="is-section-title"
                            style={{
                              color: '#ffffff',
                              fontSize: 18,
                              fontWeight: 1000,
                              letterSpacing: '0.01em',
                              margin: 0,
                            }}
                          >
                            Inspection Summary
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
                            <div className="is-summary-subcard">
                            <div className="is-section-head" style={{ marginBottom: 12 }}>
                              <div>
                                <p className="is-section-title">Compliance Checklist</p>
                                <p className="is-section-sub">Summary of the inspector's selections.</p>
                              </div>
                            </div>

                            <div className="is-summary-list">
                              {[
                                { key: 'business_permit', label: 'Business Permit (Presented)' },
                                { key: 'with_cctv', label: 'With CCTV' },
                                { key: 'signage_2sqm', label: 'Signage' },
                              ].map((item) => {
                                const v = checklist[item.key];
                                const text = formatChecklistStatus(v);
                                const detailItems = [];

                                if (item.key === 'with_cctv' && v === 'compliant' && cctvCount) {
                                  detailItems.push(`${cctvCount} CCTV${String(cctvCount) === '1' ? '' : 's'}`);
                                }

                                if (item.key === 'signage_2sqm' && v === 'compliant' && signageSqm) {
                                  detailItems.push(`${signageSqm} sqm`);
                                }

                                return (
                                  <div key={item.key} className="is-summary-check-row">
                                    <div className="is-check-title">{item.label}</div>
                                    <div className="is-summary-check-values">
                                      <div className="is-summary-check-field">
                                        <span className="is-summary-check-label">Status</span>
                                        <span className={`is-summary-check-value is-summary-check-value--${v || 'na'}`}>{text}</span>
                                      </div>
                                      {detailItems.length ? (
                                        <div className="is-summary-check-field">
                                          <span className="is-summary-check-label">Details</span>
                                          <span className="is-summary-check-value">{detailItems.join(', ')}</span>
                                        </div>
                                      ) : null}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                            </div>
                          </div>

                          <div className="is-field" style={{ gridColumn: '1 / -1', marginTop: 8 }}>
                            <div className="is-summary-subcard">
                            <div className="is-section-head" style={{ marginBottom: 12 }}>
                              <div>
                                <p className="is-section-title">Additional Observations</p>
                                <p className="is-section-sub">Inspector remarks / findings.</p>
                              </div>
                            </div>

                            <div className="is-field" style={{ marginTop: 4 }}>
                              <label>Remarks</label>
                              <div className="is-summary-remarks">
                                {additionalComments?.trim() ? additionalComments : '--'}
                              </div>
                            </div>

                            <div className="is-field" style={{ marginTop: 12 }}>
                              <label>Photo Evidence</label>
                              {evidencePhotos.length ? (
                                <div className="is-summary-photo-grid" aria-label="Evidence photos summary">
                                  {evidencePhotos.map((p, idx) => (
                                    <div key={p.url || idx} className="is-summary-photo-card">
                                      <img
                                        src={p.url}
                                        alt={`Evidence ${idx + 1}`}
                                        className="is-summary-photo-image"
                                        onClick={() => setActivePhotoUrl(p.url)}
                                        title="Click to preview"
                                      />
                                      <div className="is-summary-photo-stamp" title={formatPhotoTimestamp(p.ts)}>
                                        {formatPhotoTimestamp(p.ts)}
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
                              <div style={{ minWidth: 0, flex: '1 1 auto' }}>
                                <p className="is-section-title">Inspection Slip DOCX</p>
                                <p className="is-section-sub">Generate / regenerate after inspection completion.</p>
                              </div>

                              {hasGeneratedInspectionSlipDocx ? (
                                <div style={{ display: 'flex', gap: 8, flexWrap: 'nowrap', alignItems: 'center', justifyContent: 'flex-end', marginLeft: 'auto', flex: '0 0 auto' }}>
                                  <button
                                    type="button"
                                    className="mo-btn"
                                    onClick={handleDownloadInspectionSlipDocx}
                                    disabled={downloadingDocx}
                                    style={{ ...docxSecondaryButtonStyle, textDecoration: 'none' }}
                                  >
                                    {downloadingDocx ? 'Preparing...' : 'Download'}
                                  </button>
                                  <button
                                    type="button"
                                    className="mo-btn mo-btn-primary"
                                    onClick={handleGenerateInspectionSlipDocx}
                                    disabled={generatingDocx}
                                    style={docxPrimaryButtonStyle}
                                  >
                                    {generatingDocx ? 'Generating...' : 'Regenerate'}
                                  </button>
                                </div>
                              ) : canGenerateInspectionSlipDocx ? (
                                <div style={{ display: 'flex', gap: 8, flexWrap: 'nowrap', alignItems: 'center', justifyContent: 'flex-end', marginLeft: 'auto', flex: '0 0 auto' }}>
                                  <button
                                    type="button"
                                    className="mo-btn mo-btn-primary"
                                    onClick={handleGenerateInspectionSlipDocx}
                                    disabled={generatingDocx}
                                    style={docxPrimaryButtonStyle}
                                  >
                                    {generatingDocx ? 'Generating...' : 'Generate'}
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

