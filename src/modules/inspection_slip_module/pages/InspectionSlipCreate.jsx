import { useEffect, useMemo, useRef, useState } from 'react';
import Header from '../../../components/Header';
import Footer from '../../../components/Footer';
import { supabase } from '../../../lib/supabase';
import './InspectionSlipCreate.css';

function getMissionOrderIdFromQuery() {
  const params = new URLSearchParams(window.location.search);
  return params.get('missionOrderId') || params.get('id');
}

export default function InspectionSlipCreate() {
  const missionOrderId = useMemo(() => getMissionOrderIdFromQuery(), []);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  const [missionOrder, setMissionOrder] = useState(null);
  const [businessSearch, setBusinessSearch] = useState('');
  const [businessResult, setBusinessResult] = useState(null);
  const [checkingBusiness, setCheckingBusiness] = useState(false);

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

  // Owner type affects autofill behavior for owner name fields
  const [ownerType, setOwnerType] = useState('sole'); // 'sole' | 'corp'

  const [autoFillMessage, setAutoFillMessage] = useState('');

  // Businesses can have multiple line(s) of business. We store it as an editable list.
  const [lineOfBusinessList, setLineOfBusinessList] = useState(['']);

  // Checklist with tri-state: compliant | non_compliant | na
  const [checklist, setChecklist] = useState({
    business_permit: 'na',
    with_cctv: 'na',
    signage_2sqm: 'na',
  });

  const inspectorCanvasRef = useRef(null);
  const ownerCanvasRef = useRef(null);

  // Track drawing state + last point for each canvas.
  const inspectorDrawing = useRef(false);
  const ownerDrawing = useRef(false);
  const inspectorLastPos = useRef({ x: 0, y: 0 });
  const ownerLastPos = useRef({ x: 0, y: 0 });

  // Pointer id tracking helps avoid stray moves when a different finger touches the screen.
  const inspectorPointerIdRef = useRef(null);
  const ownerPointerIdRef = useRef(null);

  const [inspectorSignature, setInspectorSignature] = useState('');
  const [ownerSignature, setOwnerSignature] = useState('');

  const configureCanvas = (canvas) => {
    if (!canvas) return;

    // Fix cursor/ink mismatch on desktop by matching the canvas internal pixel size
    // to its rendered size, then scaling by devicePixelRatio.
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    const nextWidth = Math.max(1, Math.round(rect.width * dpr));
    const nextHeight = Math.max(1, Math.round(rect.height * dpr));

    // Only resize when needed (resizing clears the canvas).
    if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
      canvas.width = nextWidth;
      canvas.height = nextHeight;
    }

    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // draw using CSS pixel coordinates
    }

    // Prevent touch gestures (scroll/pinch) from interfering with signing on mobile.
    canvas.style.touchAction = 'none';
  };

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!missionOrderId) return;

    const loadMissionOrder = async () => {
      setLoading(true);
      setError('');
      try {
        const { data: userData, error: userError } = await supabase.auth.getUser();
        if (userError) throw userError;
        const userId = userData?.user?.id;
        if (!userId) throw new Error('Not authenticated. Please login again.');

        const { data: mo, error: moError } = await supabase
          .from('mission_orders')
          .select('id, title, status, complaint_id, created_at')
          .eq('id', missionOrderId)
          .single();

        if (moError) throw moError;

        // Rule 2: A slip can only be created by opening an active mission order
        // where the inspector is listed as an assignee.
        const { data: assignRows, error: assignError } = await supabase
          .from('mission_order_assignments')
          .select('inspector_id')
          .eq('mission_order_id', missionOrderId)
          .eq('inspector_id', userId)
          .limit(1);

        if (assignError) throw assignError;
        if (!assignRows || assignRows.length === 0) {
          throw new Error('You are not assigned to this mission order.');
        }

        // Basic active status gate (keep aligned with existing workflow)
        const s = String(mo?.status || '').toLowerCase();
        if (s !== 'for inspection') {
          throw new Error('This mission order is not active for inspection.');
        }

        setMissionOrder(mo);

        // Auto-detect complained business from linked complaint (if any).
        if (mo?.complaint_id) {
          const { data: complaint, error: complaintError } = await supabase
            .from('complaints')
            .select('id, business_name, business_address')
            .eq('id', mo.complaint_id)
            .single();

          if (!complaintError && complaint) {
            const name = (complaint.business_name || '').trim();
            const addr = (complaint.business_address || '').trim();

            if (name || addr) {
              const orClauses = [];
              if (name) orClauses.push(`business_name.ilike.%${name}%`);
              if (addr) orClauses.push(`business_address.ilike.%${addr}%`);

              if (orClauses.length > 0) {
                const { data: bizMatches, error: bizError } = await supabase
                  .from('businesses')
                  .select('*')
                  .or(orClauses.join(','))
                  .limit(5);

                if (!bizError && bizMatches && bizMatches.length > 0) {
                  setBusinessResult({ matches: bizMatches });
                  setBusinessSearch(name || addr || '');
                  // Use the first match to pre-fill fields; inspector can override.
                  handleUseBusiness(bizMatches[0]);
                  setAutoFillMessage(
                    'Autofilled from registered business based on the complained business. Click a result card to change.'
                  );
                } else {
                  setAutoFillMessage(
                    'No registered business found for this complaint. Please fill in the details manually or search by BIN / business name.'
                  );
                }
              }
            } else {
              setAutoFillMessage(
                'No registered business found for this complaint. Please fill in the details manually or search by BIN / business name.'
              );
            }
          }
        } else {
          setAutoFillMessage('');
        }
      } catch (e) {
        setMissionOrder(null);
        setError(e?.message || 'Failed to load mission order.');
      } finally {
        setLoading(false);
      }
    };

    loadMissionOrder();
  }, [missionOrderId]);

  const getCanvasContextAndState = (who) => {
    const canvasRef = who === 'inspector' ? inspectorCanvasRef : ownerCanvasRef;
    const drawingRef = who === 'inspector' ? inspectorDrawing : ownerDrawing;
    const lastPosRef = who === 'inspector' ? inspectorLastPos : ownerLastPos;
    const canvas = canvasRef.current;
    if (!canvas) return {};
    const ctx = canvas.getContext('2d');
    return { canvas, ctx, drawingRef, lastPosRef };
  };

  const getEventPos = (event, canvas) => {
    const rect = canvas.getBoundingClientRect();

    // Normalize coordinates across mouse/touch/pointer events.
    const point =
      event?.touches && event.touches.length
        ? event.touches[0]
        : event?.changedTouches && event.changedTouches.length
          ? event.changedTouches[0]
          : event;

    return {
      x: (point?.clientX ?? 0) - rect.left,
      y: (point?.clientY ?? 0) - rect.top,
    };
  };

  const handleSignatureStart = (who, event) => {
    // Prevent page scroll while signing (mobile) and stop browser gestures.
    event.preventDefault();

    const { canvas, ctx, drawingRef, lastPosRef } = getCanvasContextAndState(who);
    if (!canvas || !ctx) return;

    configureCanvas(canvas);

    const pointerIdRef = who === 'inspector' ? inspectorPointerIdRef : ownerPointerIdRef;

    // Capture pointer so moves continue even if leaving the canvas bounds.
    if (event?.pointerId != null) {
      pointerIdRef.current = event.pointerId;
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch {
        // Ignore capture errors (older browsers).
      }
    }

    const pos = getEventPos(event, canvas);
    drawingRef.current = true;
    lastPosRef.current = pos;
  };

  const handleSignatureMove = (who, event) => {
    const { canvas, ctx, drawingRef, lastPosRef } = getCanvasContextAndState(who);
    if (!canvas || !ctx || !drawingRef.current) return;

    const pointerIdRef = who === 'inspector' ? inspectorPointerIdRef : ownerPointerIdRef;
    if (event?.pointerId != null && pointerIdRef.current != null && event.pointerId !== pointerIdRef.current) {
      return;
    }

    event.preventDefault();

    const pos = getEventPos(event, canvas);
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(lastPosRef.current.x, lastPosRef.current.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    lastPosRef.current = pos;
  };

  const handleSignatureEnd = (who, event) => {
    const { canvas, drawingRef } = getCanvasContextAndState(who);
    if (!canvas) return;

    const pointerIdRef = who === 'inspector' ? inspectorPointerIdRef : ownerPointerIdRef;
    if (event?.pointerId != null && pointerIdRef.current != null && event.pointerId !== pointerIdRef.current) {
      return;
    }

    drawingRef.current = false;
    pointerIdRef.current = null;

    const dataUrl = canvas.toDataURL('image/png');
    if (who === 'inspector') {
      setInspectorSignature(dataUrl);
    } else {
      setOwnerSignature(dataUrl);
    }
  };

  const handleSignatureClear = (who) => {
    const { canvas, ctx } = getCanvasContextAndState(who);
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (who === 'inspector') {
      setInspectorSignature('');
    } else {
      setOwnerSignature('');
    }
  };

  const handleUseBusiness = async (b) => {
    if (!b) return;

    // Always fill business name
    setOwnerDetails((prev) => ({
      ...prev,
      businessName: b.business_name || prev.businessName,
    }));

    // Only autofill owner personal name fields + additional business info for Sole Proprietor
    const isSole = ownerType === 'sole';

    if (isSole) {
      const lastName = b.owner_last_name || b.last_name || b.lastname || '';
      const firstName = b.owner_first_name || b.first_name || b.firstname || '';
      const middleName = b.owner_middle_name || b.middle_name || b.middlename || '';

      setOwnerDetails((prev) => ({
        ...prev,
        lastName: lastName || prev.lastName,
        firstName: firstName || prev.firstName,
        middleName: middleName || prev.middleName,
      }));
    }

    const bin = b.epermit_no || b.permit_number || '';

    setBusinessDetails((prev) => ({
      ...prev,
      bin: bin || prev.bin,
      address:
        b.address ||
        b.business_address ||
        b.full_address ||
        b.business_address1 ||
        prev.address,
    }));

    // Pull multi-line LOB + total_employees from businesses_additional based on BIN.
    // Your schema shows:
    // - businesses.bin (text)
    // - businesses_additional.bin (text, NOT NULL)
    // - businesses_additional.line_of_business (text)
    // - businesses_additional.total_employees (bigint)
    // Auto-populate only when Sole Proprietor; still editable anytime.
    if (isSole) {
      try {
        const businessBin = String(b?.bin || '').trim();
        if (!businessBin) return;

        const { data: addRows, error: addErr } = await supabase
          .from('businesses_additional')
          .select('line_of_business, total_employees')
          .eq('bin', businessBin);

        if (addErr) throw addErr;
        if (!addRows || addRows.length === 0) return;

        // LOB can be multiple rows OR stored as a delimited string.
        const lobs = addRows
          .flatMap((r) => {
            const v = r?.line_of_business ?? '';
            if (typeof v === 'string') {
              return v
                .split(/\r?\n|\s*;\s*|\s*,\s*/g)
                .map((s) => s.trim())
                .filter(Boolean);
            }
            return [];
          })
          .filter((val, idx, arr) => arr.indexOf(val) === idx);

        if (lobs.length > 0) {
          setLineOfBusinessList(lobs);
        }

        // total_employees appears per-row; prefer MAX to avoid overcounting.
        const maxEmployees = addRows
          .map((r) => Number(r?.total_employees || 0))
          .filter((n) => Number.isFinite(n) && n > 0)
          .reduce((m, n) => (n > m ? n : m), 0);

        if (maxEmployees > 0) {
          setBusinessDetails((prev) => ({
            ...prev,
            numberOfEmployees: String(maxEmployees),
          }));
        }
      } catch {
        // Silent fail: do not block slip creation if businesses_additional is missing/not linked.
      }
    }
  };

  const handleCheckBusiness = async () => {
    if (!businessSearch.trim()) {
      setError('Enter business permit number / business name to validate.');
      return;
    }

    setError('');
    setBusinessResult(null);
    setCheckingBusiness(true);

    try {
      // Spec 1.3.5: validate business permit exists and is valid.
      // We do a best-effort query based on the existing "businesses" table
      // referenced elsewhere in the codebase.
      const q = businessSearch.trim();
      const { data, error: qError } = await supabase
        .from('businesses')
        .select('*')
        .or(`epermit_no.ilike.%${q}%,business_name.ilike.%${q}%`)
        .limit(5);

      if (qError) throw qError;

      setBusinessResult({ matches: data || [] });
      if (!data || data.length === 0) setToast('No matching business permit found.');
    } catch (e) {
      setError(e?.message || 'Failed to validate business permit.');
    } finally {
      setCheckingBusiness(false);
    }
  };

  return (
    <div className="mo-container is-root">
      <Header />
      <main className="mo-main">
        <section className="mo-card">
          <div className="mo-header">
            <div className="mo-title-wrap">
              <div className="mo-label">Inspection Slip</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ fontWeight: 900, fontSize: 16, color: '#0f172a' }}>Create (Draft)</div>
                <div style={{ color: '#64748b', fontWeight: 800, fontSize: 12 }}>
                  Mission Order: {missionOrder?.title || (missionOrderId ? missionOrderId : '—')}
                </div>
              </div>
            </div>

            <div className="mo-actions">
              <a className="mo-link" href="/dashboard/inspector">
                Back
              </a>
              <button
                type="button"
                className="mo-btn mo-btn-secondary"
                onClick={() => window.print()}
                style={{ marginLeft: 8 }}
              >
                Print
              </button>
            </div>
          </div>

          {toast ? <div className="mo-alert mo-alert-success">{toast}</div> : null}
          {error ? <div className="mo-alert mo-alert-error">{error}</div> : null}

          {!missionOrderId ? (
            <div className="mo-meta">Open this page as /inspection-slip/create?missionOrderId=&lt;uuid&gt;</div>
          ) : loading ? (
            <div className="mo-meta">Loading…</div>
          ) : !missionOrder ? (
            <div className="mo-meta">Cannot create inspection slip.</div>
          ) : (
            <div style={{ display: 'grid', gap: 14, marginTop: 14 }}>
              {autoFillMessage ? (
                <div className={autoFillMessage.toLowerCase().includes('no registered business found') ? 'is-alert' : 'mo-meta'} style={{ marginBottom: 4 }}>
                  {autoFillMessage}
                </div>
              ) : null}

              <div className="is-card">
                <div className="is-section-head">
                  <div>
                    <p className="is-section-title">Step 1: Validate Business Permit</p>
                    <p className="is-section-sub">Select owner type, then search a registered business to autofill.</p>
                  </div>
                </div>

                <div className="is-check-row" style={{ marginBottom: 12 }}>
                  <div className="is-check-title">Owner Type</div>
                  <div className="is-seg" role="group" aria-label="Owner type">
                    <button
                      type="button"
                      className={ownerType === 'sole' ? 'active' : ''}
                      onClick={() => setOwnerType('sole')}
                      aria-pressed={ownerType === 'sole'}
                      title="Sole Proprietor will autofill owner name fields when available"
                    >
                      Sole Proprietor
                    </button>
                    <button
                      type="button"
                      className={ownerType === 'corp' ? 'active' : ''}
                      onClick={() => setOwnerType('corp')}
                      aria-pressed={ownerType === 'corp'}
                      title="Corporation will not autofill owner name fields"
                    >
                      Corporation
                    </button>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <input
                    className="is-input"
                    value={businessSearch}
                    onChange={(e) => setBusinessSearch(e.target.value)}
                    placeholder="Enter permit number or business name"
                    disabled={checkingBusiness}
                    style={{ flex: '1 1 260px' }}
                  />
                  <button
                    type="button"
                    className="mo-btn mo-btn-primary is-btn-primary"
                    onClick={handleCheckBusiness}
                    disabled={checkingBusiness}
                  >
                    {checkingBusiness ? 'Checking…' : 'Check'}
                  </button>
                </div>

                {businessResult ? (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ color: '#0f172a', fontWeight: 900, marginBottom: 8 }}>
                      Matches ({businessResult.matches.length})
                    </div>
                    {businessResult.matches.length === 0 ? (
                      <div className="mo-meta">No matches.</div>
                    ) : (
                      <div style={{ display: 'grid', gap: 10 }}>
                        {businessResult.matches.map((b) => (
                          <div
                            key={b.id || `${b.business_name}-${b.permit_number}`}
                            className="is-match-card"
                            onClick={() => handleUseBusiness(b)}
                          >
                            <div style={{ fontWeight: 800, color: '#0f172a' }}>{b.business_name || '—'}</div>
                            <div style={{ color: '#475569', fontWeight: 600, fontSize: 12 }}>
                              Permit: {b.epermit_no || '—'}
                            </div>
                            {b.address || b.business_address || b.full_address ? (
                              <div style={{ color: '#475569', fontWeight: 600, fontSize: 12 }}>
                                Address: {b.address || b.business_address || b.full_address}
                              </div>
                            ) : null}
                            {b.permit_status ? (
                              <div style={{ color: '#475569', fontWeight: 600, fontSize: 12 }}>
                                Status: {b.permit_status}
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : null}
              </div>

              <div className="is-card">
                <div className="is-section-head">
                  <div>
                    <p className="is-section-title">Step 2: Line of Business</p>
                    <p className="is-section-sub">Can be multiple lines. Autofilled for Sole Proprietor when available; editable anytime.</p>
                  </div>
                  <div>
                    <button
                      type="button"
                      className="mo-btn mo-btn-secondary"
                      onClick={() => setLineOfBusinessList((p) => [...p, ''])}
                      title="Add another line of business"
                    >
                      + Add Line
                    </button>
                  </div>
                </div>

                <div style={{ display: 'grid', gap: 10 }}>
                  {lineOfBusinessList.map((lob, idx) => (
                    <div key={idx} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <input
                        className="is-input"
                        value={lob}
                        onChange={(e) =>
                          setLineOfBusinessList((prev) => {
                            const next = [...prev];
                            next[idx] = e.target.value;
                            return next;
                          })
                        }
                        placeholder={`Line of business #${idx + 1}`}
                        style={{ flex: '1 1 auto' }}
                      />
                      {lineOfBusinessList.length > 1 ? (
                        <button
                          type="button"
                          className="mo-btn mo-btn-secondary"
                          onClick={() =>
                            setLineOfBusinessList((prev) => prev.filter((_, i) => i !== idx))
                          }
                          title="Remove this line"
                        >
                          Remove
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>

              <div className="is-card">
                <div className="is-section-head">
                  <div>
                    <p className="is-section-title">Step 3: Business Owner Details</p>
                    <p className="is-section-sub">Owner identity and business name.</p>
                  </div>
                </div>

                <div className="is-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
                  <div className="is-field">
                    <label>Last Name</label>
                    <input
                      className="is-input"
                      value={ownerDetails.lastName}
                      onChange={(e) => setOwnerDetails((prev) => ({ ...prev, lastName: e.target.value }))}
                      placeholder="Enter last name"
                    />
                  </div>

                  <div className="is-field">
                    <label>First Name</label>
                    <input
                      className="is-input"
                      value={ownerDetails.firstName}
                      onChange={(e) => setOwnerDetails((prev) => ({ ...prev, firstName: e.target.value }))}
                      placeholder="Enter first name"
                    />
                  </div>

                  <div className="is-field">
                    <label>Middle Name</label>
                    <input
                      className="is-input"
                      value={ownerDetails.middleName}
                      onChange={(e) => setOwnerDetails((prev) => ({ ...prev, middleName: e.target.value }))}
                      placeholder="Enter middle name"
                    />
                  </div>

                  <div className="is-field" style={{ gridColumn: '1 / -1' }}>
                    <label>Business Name</label>
                    <input
                      className="is-input"
                      value={ownerDetails.businessName}
                      onChange={(e) => setOwnerDetails((prev) => ({ ...prev, businessName: e.target.value }))}
                      placeholder="Enter business name"
                    />
                  </div>
                </div>
              </div>

              <div className="is-card">
                <div className="is-section-head">
                  <div>
                    <p className="is-section-title">Step 4: Business Details</p>
                    <p className="is-section-sub">Key information needed for validation and inspection.</p>
                  </div>
                </div>

                <div className="is-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
                  <div className="is-field">
                    <label>BIN #</label>
                    <input
                      className="is-input"
                      value={businessDetails.bin}
                      onChange={(e) => setBusinessDetails((prev) => ({ ...prev, bin: e.target.value }))}
                      placeholder="Enter BIN #"
                    />
                  </div>

                  <div className="is-field" style={{ gridColumn: '1 / -1' }}>
                    <label>Address</label>
                    <input
                      className="is-input"
                      value={businessDetails.address}
                      onChange={(e) => setBusinessDetails((prev) => ({ ...prev, address: e.target.value }))}
                      placeholder="Address (autofilled when selecting a business, editable)"
                    />
                  </div>

                  <div className="is-field">
                    <label>Estimated Area (SQM)</label>
                    <input
                      className="is-input"
                      type="number"
                      min="0"
                      value={businessDetails.estimatedAreaSqm}
                      onChange={(e) => setBusinessDetails((prev) => ({ ...prev, estimatedAreaSqm: e.target.value }))}
                      placeholder="Enter estimated area"
                    />
                  </div>

                  <div className="is-field">
                    <label>No. of Employees</label>
                    <input
                      className="is-input"
                      type="number"
                      min="0"
                      value={businessDetails.numberOfEmployees}
                      onChange={(e) => setBusinessDetails((prev) => ({ ...prev, numberOfEmployees: e.target.value }))}
                      placeholder="Enter number of employees"
                    />
                  </div>

                  <div className="is-field">
                    <label>Landline #</label>
                    <input
                      className="is-input"
                      value={businessDetails.landline}
                      onChange={(e) => setBusinessDetails((prev) => ({ ...prev, landline: e.target.value }))}
                      placeholder="Enter landline #"
                    />
                  </div>

                  <div className="is-field">
                    <label>Cellphone #</label>
                    <input
                      className="is-input"
                      value={businessDetails.cellphone}
                      onChange={(e) => setBusinessDetails((prev) => ({ ...prev, cellphone: e.target.value }))}
                      placeholder="Enter cellphone #"
                    />
                  </div>

                  <div className="is-field">
                    <label>Email Address</label>
                    <input
                      className="is-input"
                      type="email"
                      value={businessDetails.email}
                      onChange={(e) => setBusinessDetails((prev) => ({ ...prev, email: e.target.value }))}
                      placeholder="Enter email address"
                    />
                  </div>
                </div>
              </div>

              <div className="is-card">
                <div className="is-section-head">
                  <div>
                    <p className="is-section-title">Step 5: Compliance Checklist</p>
                    <p className="is-section-sub">Use Compliant / Non-Compliant / N/A per item.</p>
                  </div>
                </div>

                <div style={{ display: 'grid', gap: 10 }}>
                  {[
                    { key: 'business_permit', label: 'Business Permit (Presented)' },
                    { key: 'with_cctv', label: 'With CCTV' },
                    { key: 'signage_2sqm', label: '2sqm Signage' },
                  ].map((item) => (
                    <div key={item.key} className="is-check-row">
                      <div className="is-check-title">{item.label}</div>
                      <div className="is-seg" role="group" aria-label={`${item.label} status`}>
                        {[
                          { v: 'compliant', t: 'Compliant' },
                          { v: 'non_compliant', t: 'Non-Compliant' },
                          { v: 'na', t: 'N/A' },
                        ].map((opt) => (
                          <button
                            key={opt.v}
                            type="button"
                            className={checklist[item.key] === opt.v ? 'active' : ''}
                            onClick={() => setChecklist((p) => ({ ...p, [item.key]: opt.v }))}
                            aria-pressed={checklist[item.key] === opt.v}
                          >
                            {opt.t}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="is-card">
                <div className="is-section-head">
                  <div>
                    <p className="is-section-title">Signatures</p>
                    <p className="is-section-sub">Sign inside the box. Use Clear only if needed.</p>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
                  <div className="is-field">
                    <label>Inspector Signature</label>
                    <div className="is-sign-wrap">
                      <canvas
                        ref={inspectorCanvasRef}
                        width={400}
                        height={120}
                        style={{ width: '100%', height: 120, display: 'block', background: 'transparent', touchAction: 'none' }}
                        onPointerDown={(e) => handleSignatureStart('inspector', e)}
                        onPointerMove={(e) => handleSignatureMove('inspector', e)}
                        onPointerUp={(e) => handleSignatureEnd('inspector', e)}
                        onPointerCancel={(e) => handleSignatureEnd('inspector', e)}
                        onPointerLeave={(e) => handleSignatureEnd('inspector', e)}
                      />
                      {!inspectorSignature ? <div className="is-sign-hint">Sign here</div> : null}
                      <button
                        type="button"
                        className="mo-btn mo-btn--sm mo-btn-secondary is-sign-clear"
                        onClick={() => handleSignatureClear('inspector')}
                        title="Clear signature"
                      >
                        Clear
                      </button>
                    </div>
                  </div>

                  <div className="is-field">
                    <label>Business Owner Signature</label>
                    <div className="is-sign-wrap">
                      <canvas
                        ref={ownerCanvasRef}
                        width={400}
                        height={120}
                        style={{ width: '100%', height: 120, display: 'block', background: 'transparent', touchAction: 'none' }}
                        onPointerDown={(e) => handleSignatureStart('owner', e)}
                        onPointerMove={(e) => handleSignatureMove('owner', e)}
                        onPointerUp={(e) => handleSignatureEnd('owner', e)}
                        onPointerCancel={(e) => handleSignatureEnd('owner', e)}
                        onPointerLeave={(e) => handleSignatureEnd('owner', e)}
                      />
                      {!ownerSignature ? <div className="is-sign-hint">Sign here</div> : null}
                      <button
                        type="button"
                        className="mo-btn mo-btn--sm mo-btn-secondary is-sign-clear"
                        onClick={() => handleSignatureClear('owner')}
                        title="Clear signature"
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>
      </main>
      <Footer />
    </div>
  );
}
