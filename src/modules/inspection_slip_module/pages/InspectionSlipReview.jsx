import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import DashboardSidebar from '../../../components/DashboardSidebar';
import '../../dashboard_module/pages/Dashboard.css';
import './InspectionSlipCreate.css';

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

export default function InspectionSlipReview() {
  const inspectionReportId = useMemo(() => getInspectionReportIdFromQuery(), []);
  const missionOrderIdFromQuery = useMemo(() => getMissionOrderIdFromQuery(), []);
  const role = useMemo(() => getRoleFromQuery(), []);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [missionOrder, setMissionOrder] = useState(null);
  const [complaint, setComplaint] = useState(null);
  const [signedAttachmentUrl, setSignedAttachmentUrl] = useState('');
  const [signedAttachmentMeta, setSignedAttachmentMeta] = useState({
    uploadedAt: null,
    uploadedBy: null,
  });

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

  const [navCollapsed, setNavCollapsed] = useState(false);

  const mapUrl = useMemo(() => {
    const address = complaint?.business_address || '';
    if (!address) return null;
    return `https://www.google.com/maps?q=${encodeURIComponent(address)}&output=embed`;
  }, [complaint?.business_address]);

  useEffect(() => {
    const load = async () => {
      setError('');
      setLoading(true);

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
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [inspectionReportId, missionOrderIdFromQuery, hasInspectionData]);

  const backHref =
    role === 'head_inspector'
      ? '/dashboard/head-inspector#inspection-history'
      : '/dashboard/director?tab=inspection-history';

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
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14 }}>
                <div>
                  <h2 className="dash-title" style={{ marginBottom: 4 }}>
                    Inspection Slip
                  </h2>
                  <p className="dash-subtitle">
                    Read-only overview of inspection details and summary.
                  </p>
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <a className="dash-btn" href={backHref} style={{ textDecoration: 'none' }}>
                    Back
                  </a>
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
                    <div className="is-section-head">
                      <div>
                        <p className="is-section-title">Inspection Details</p>
                        <p className="is-section-sub">
                          Mission order and complaint context for this inspection.
                        </p>
                      </div>
                    </div>

                    <div className="is-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
                      <div className="is-field">
                        <label>Inspection Report ID</label>
                        <div style={{ fontWeight: 900, color: '#0f172a' }}>
                          {inspectionReportId ? `${String(inspectionReportId).slice(0, 8)}…` : '—'}
                        </div>
                      </div>

                      <div className="is-field">
                        <label>Mission Order ID</label>
                        <div style={{ fontWeight: 900, color: '#0f172a' }}>
                          {missionOrder?.id ? `${String(missionOrder.id).slice(0, 8)}…` : '—'}
                        </div>
                      </div>

                      <div className="is-field">
                        <label>Mission Order Status</label>
                        <div style={statusBadgeStyle(missionOrder?.status)}>{formatStatus(missionOrder?.status)}</div>
                      </div>

                      <div className="is-field" style={{ gridColumn: '1 / -1' }}>
                        <label>Title</label>
                        <div style={{ fontWeight: 900, color: '#0f172a' }}>{missionOrder?.title || '—'}</div>
                      </div>
                    </div>

                    <div className="is-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', marginTop: 12 }}>
                      <div className="is-field">
                        <label>Business Name</label>
                        <div style={{ fontWeight: 800, color: '#0f172a' }}>
                          {complaint?.business_name || ownerDetails.businessName || '—'}
                        </div>
                      </div>
                      <div className="is-field" style={{ gridColumn: '1 / -1' }}>
                        <label>Business Address</label>
                        <div style={{ fontWeight: 800, color: '#0f172a' }}>
                          {complaint?.business_address || businessDetails.address || '—'}
                        </div>
                      </div>
                    </div>

                    <div className="mo-meta" style={{ marginTop: 12 }}>
                      Signed attachment uploaded by the Secretary.
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

                    <div className="is-card" style={{ marginTop: 16 }}>
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

                  <div className="is-card">
                    <div className="is-section-head">
                      <div>
                        <p className="is-section-title">Summary</p>
                        <p className="is-section-sub">
                          {hasInspectionData
                            ? 'Review key details below.'
                            : 'No inspection has been conducted yet for this mission order.'}
                        </p>
                      </div>
                    </div>

                    {hasInspectionData ? (
                      <div className="is-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
                        <div className="is-field">
                          <label>Owner Type</label>
                          <div style={{ fontWeight: 800, color: '#0f172a' }}>
                            {ownerType === 'sole' ? 'Sole Proprietor' : 'Corporation'}
                          </div>
                        </div>

                        <div className="is-field">
                          <label>BIN #</label>
                          <div style={{ fontWeight: 800, color: '#0f172a' }}>{businessDetails.bin || '—'}</div>
                        </div>

                        <div className="is-field" style={{ gridColumn: '1 / -1' }}>
                          <label>Business Name</label>
                          <div style={{ fontWeight: 800, color: '#0f172a' }}>{ownerDetails.businessName || '—'}</div>
                        </div>

                        <div className="is-field" style={{ gridColumn: '1 / -1' }}>
                          <label>Business Address</label>
                          <div style={{ fontWeight: 800, color: '#0f172a' }}>{businessDetails.address || '—'}</div>
                        </div>

                        <div className="is-field" style={{ gridColumn: '1 / -1' }}>
                          <label>Owner Name</label>
                          <div style={{ fontWeight: 800, color: '#0f172a' }}>
                            {`${ownerDetails.lastName || ''}${
                              ownerDetails.lastName && (ownerDetails.firstName || ownerDetails.middleName) ? ', ' : ''
                            }${ownerDetails.firstName || ''}${
                              ownerDetails.middleName ? ` ${ownerDetails.middleName}` : ''
                            }`.trim() || '—'}
                          </div>
                        </div>

                        <div className="is-field" style={{ gridColumn: '1 / -1' }}>
                          <label>Line(s) of Business</label>
                          <div style={{ fontWeight: 700, color: '#0f172a', whiteSpace: 'pre-wrap' }}>
                            {lineOfBusinessList.filter(Boolean).length
                              ? lineOfBusinessList
                                  .filter(Boolean)
                                  .map((x) => `• ${x}`)
                                  .join('\n')
                              : '—'}
                          </div>
                        </div>

                        <div className="is-field">
                          <label>Estimated Area (SQM)</label>
                          <div style={{ fontWeight: 800, color: '#0f172a' }}>
                            {businessDetails.estimatedAreaSqm || '—'}
                          </div>
                        </div>

                        <div className="is-field">
                          <label>No. of Employees</label>
                          <div style={{ fontWeight: 800, color: '#0f172a' }}>
                            {businessDetails.numberOfEmployees || '—'}
                          </div>
                        </div>

                        <div className="is-field">
                          <label>Landline</label>
                          <div style={{ fontWeight: 800, color: '#0f172a' }}>{businessDetails.landline || '—'}</div>
                        </div>

                        <div className="is-field">
                          <label>Cellphone</label>
                          <div style={{ fontWeight: 800, color: '#0f172a' }}>{businessDetails.cellphone || '—'}</div>
                        </div>

                        <div className="is-field" style={{ gridColumn: '1 / -1' }}>
                          <label>Email</label>
                          <div style={{ fontWeight: 800, color: '#0f172a' }}>{businessDetails.email || '—'}</div>
                        </div>
                      </div>
                    ) : (
                      <div style={{ marginTop: 12, padding: 16, borderRadius: 12, background: '#f8fafc', border: '1px dashed #cbd5e1', fontWeight: 700, color: '#475569' }}>
                        No inspection slip has been submitted yet. Once the assigned inspector completes the inspection,
                        the summary will appear here.
                      </div>
                    )}
                  </div>

                  {hasInspectionData && (
                    <>
                      <div className="is-card">
                        <div className="is-section-head">
                          <div>
                            <p className="is-section-title">Compliance Checklist</p>
                            <p className="is-section-sub">Summary of the inspector’s selections.</p>
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

                      <div className="is-card">
                        <div className="is-section-head">
                          <div>
                            <p className="is-section-title">Additional Observations</p>
                            <p className="is-section-sub">Inspector remarks / findings.</p>
                          </div>
                        </div>

                        <div className="is-field" style={{ marginTop: 4 }}>
                          <label>Remarks</label>
                          <div style={{ fontWeight: 800, color: '#0f172a', whiteSpace: 'pre-wrap' }}>
                            {additionalComments?.trim() ? additionalComments : '—'}
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
                            <div style={{ fontWeight: 800, color: '#64748b' }}>—</div>
                          )}
                        </div>
                      </div>
                    </>
                  )}
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

