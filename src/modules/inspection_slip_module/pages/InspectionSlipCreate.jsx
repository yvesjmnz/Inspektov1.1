import { useEffect, useMemo, useRef, useState } from 'react';
import Header from '../../../components/Header';
import Footer from '../../../components/Footer';
import { supabase } from '../../../lib/supabase';

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

  const [autoFillMessage, setAutoFillMessage] = useState('');

  const [lineOfBusiness, setLineOfBusiness] = useState('');

  const [checklist, setChecklist] = useState({
    business_permit: false,
    with_cctv: false,
    signage_2sqm: false,
  });

  const inspectorCanvasRef = useRef(null);
  const ownerCanvasRef = useRef(null);
  const inspectorDrawing = useRef(false);
  const ownerDrawing = useRef(false);
  const inspectorLastPos = useRef({ x: 0, y: 0 });
  const ownerLastPos = useRef({ x: 0, y: 0 });
  const [inspectorSignature, setInspectorSignature] = useState('');
  const [ownerSignature, setOwnerSignature] = useState('');

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
    const e = event.touches && event.touches.length ? event.touches[0] : event;
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  };

  const handleSignatureStart = (who, event) => {
    event.preventDefault();
    const { canvas, ctx, drawingRef, lastPosRef } = getCanvasContextAndState(who);
    if (!canvas || !ctx) return;
    const pos = getEventPos(event, canvas);
    drawingRef.current = true;
    lastPosRef.current = pos;
  };

  const handleSignatureMove = (who, event) => {
    const { canvas, ctx, drawingRef, lastPosRef } = getCanvasContextAndState(who);
    if (!canvas || !ctx || !drawingRef.current) return;
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

  const handleSignatureEnd = (who) => {
    const { canvas, drawingRef } = getCanvasContextAndState(who);
    if (!canvas) return;
    drawingRef.current = false;
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

  const handleUseBusiness = (b) => {
    if (!b) return;
    setOwnerDetails((prev) => ({
      ...prev,
      businessName: b.business_name || prev.businessName,
    }));
    setBusinessDetails((prev) => ({
      ...prev,
      bin: b.epermit_no || b.permit_number || prev.bin,
      address:
        b.address ||
        b.business_address ||
        b.full_address ||
        b.business_address1 ||
        prev.address,
    }));
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
    <div className="mo-container">
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
                <div className="mo-meta" style={{ marginBottom: 4 }}>
                  {autoFillMessage}
                </div>
              ) : null}
              <div>
                <div className="mo-label">[SECTION 1 REQUIRED] Business Owner Details</div>
                <div
                  style={{
                    marginTop: 10,
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                    gap: 10,
                  }}
                >
                  <div>
                    <div className="mo-meta" style={{ marginBottom: 4 }}>
                      Last Name
                    </div>
                    <input
                      value={ownerDetails.lastName}
                      onChange={(e) =>
                        setOwnerDetails((prev) => ({ ...prev, lastName: e.target.value }))
                      }
                      placeholder="Enter last name"
                      style={{
                        width: '100%',
                        height: 40,
                        borderRadius: 10,
                        border: '1px solid #cbd5e1',
                        padding: '0 12px',
                        fontWeight: 700,
                      }}
                    />
                  </div>
                  <div>
                    <div className="mo-meta" style={{ marginBottom: 4 }}>
                      First Name
                    </div>
                    <input
                      value={ownerDetails.firstName}
                      onChange={(e) =>
                        setOwnerDetails((prev) => ({ ...prev, firstName: e.target.value }))
                      }
                      placeholder="Enter first name"
                      style={{
                        width: '100%',
                        height: 40,
                        borderRadius: 10,
                        border: '1px solid #cbd5e1',
                        padding: '0 12px',
                        fontWeight: 700,
                      }}
                    />
                  </div>
                  <div>
                    <div className="mo-meta" style={{ marginBottom: 4 }}>
                      Middle Name
                    </div>
                    <input
                      value={ownerDetails.middleName}
                      onChange={(e) =>
                        setOwnerDetails((prev) => ({ ...prev, middleName: e.target.value }))
                      }
                      placeholder="Enter middle name"
                      style={{
                        width: '100%',
                        height: 40,
                        borderRadius: 10,
                        border: '1px solid #cbd5e1',
                        padding: '0 12px',
                        fontWeight: 700,
                      }}
                    />
                  </div>
                  <div>
                    <div className="mo-meta" style={{ marginBottom: 4 }}>
                      Business Name
                    </div>
                    <input
                      value={ownerDetails.businessName}
                      onChange={(e) =>
                        setOwnerDetails((prev) => ({ ...prev, businessName: e.target.value }))
                      }
                      placeholder="Enter business name"
                      style={{
                        width: '100%',
                        height: 40,
                        borderRadius: 10,
                        border: '1px solid #cbd5e1',
                        padding: '0 12px',
                        fontWeight: 700,
                      }}
                    />
                  </div>
                </div>
              </div>

              <div>
                <div className="mo-label">[SECTION 2 REQUIRED] Business Details</div>
                <div
                  style={{
                    marginTop: 10,
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                    gap: 10,
                  }}
                >
                  <div>
                    <div className="mo-meta" style={{ marginBottom: 4 }}>
                      BIN #
                    </div>
                    <input
                      value={businessDetails.bin}
                      onChange={(e) =>
                        setBusinessDetails((prev) => ({ ...prev, bin: e.target.value }))
                      }
                      placeholder="Enter BIN #"
                      style={{
                        width: '100%',
                        height: 40,
                        borderRadius: 10,
                        border: '1px solid #cbd5e1',
                        padding: '0 12px',
                        fontWeight: 700,
                      }}
                    />
                  </div>
                  <div>
                    <div className="mo-meta" style={{ marginBottom: 4 }}>
                      Address
                    </div>
                    <input
                      value={businessDetails.address}
                      onChange={(e) =>
                        setBusinessDetails((prev) => ({ ...prev, address: e.target.value }))
                      }
                      placeholder="Address (autofilled when selecting a business, editable)"
                      style={{
                        width: '100%',
                        height: 40,
                        borderRadius: 10,
                        border: '1px solid #cbd5e1',
                        padding: '0 12px',
                        fontWeight: 700,
                      }}
                    />
                  </div>
                  <div>
                    <div className="mo-meta" style={{ marginBottom: 4 }}>
                      Estimated Area (in SQM)
                    </div>
                    <input
                      type="number"
                      min="0"
                      value={businessDetails.estimatedAreaSqm}
                      onChange={(e) =>
                        setBusinessDetails((prev) => ({
                          ...prev,
                          estimatedAreaSqm: e.target.value,
                        }))
                      }
                      placeholder="Enter estimated area"
                      style={{
                        width: '100%',
                        height: 40,
                        borderRadius: 10,
                        border: '1px solid #cbd5e1',
                        padding: '0 12px',
                        fontWeight: 700,
                      }}
                    />
                  </div>
                  <div>
                    <div className="mo-meta" style={{ marginBottom: 4 }}>
                      No. of Employees
                    </div>
                    <input
                      type="number"
                      min="0"
                      value={businessDetails.numberOfEmployees}
                      onChange={(e) =>
                        setBusinessDetails((prev) => ({
                          ...prev,
                          numberOfEmployees: e.target.value,
                        }))
                      }
                      placeholder="Enter number of employees"
                      style={{
                        width: '100%',
                        height: 40,
                        borderRadius: 10,
                        border: '1px solid #cbd5e1',
                        padding: '0 12px',
                        fontWeight: 700,
                      }}
                    />
                  </div>
                  <div>
                    <div className="mo-meta" style={{ marginBottom: 4 }}>
                      Landline #
                    </div>
                    <input
                      value={businessDetails.landline}
                      onChange={(e) =>
                        setBusinessDetails((prev) => ({ ...prev, landline: e.target.value }))
                      }
                      placeholder="Enter landline #"
                      style={{
                        width: '100%',
                        height: 40,
                        borderRadius: 10,
                        border: '1px solid #cbd5e1',
                        padding: '0 12px',
                        fontWeight: 700,
                      }}
                    />
                  </div>
                  <div>
                    <div className="mo-meta" style={{ marginBottom: 4 }}>
                      Cellphone #
                    </div>
                    <input
                      value={businessDetails.cellphone}
                      onChange={(e) =>
                        setBusinessDetails((prev) => ({ ...prev, cellphone: e.target.value }))
                      }
                      placeholder="Enter cellphone #"
                      style={{
                        width: '100%',
                        height: 40,
                        borderRadius: 10,
                        border: '1px solid #cbd5e1',
                        padding: '0 12px',
                        fontWeight: 700,
                      }}
                    />
                  </div>
                  <div>
                    <div className="mo-meta" style={{ marginBottom: 4 }}>
                      Email Address
                    </div>
                    <input
                      type="email"
                      value={businessDetails.email}
                      onChange={(e) =>
                        setBusinessDetails((prev) => ({ ...prev, email: e.target.value }))
                      }
                      placeholder="Enter email address"
                      style={{
                        width: '100%',
                        height: 40,
                        borderRadius: 10,
                        border: '1px solid #cbd5e1',
                        padding: '0 12px',
                        fontWeight: 700,
                      }}
                    />
                  </div>
                </div>
              </div>

              <div>
                <div className="mo-label">Step 3: Validate Business Permit</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                  <input
                    value={businessSearch}
                    onChange={(e) => setBusinessSearch(e.target.value)}
                    placeholder="Enter permit number or business name"
                    disabled={checkingBusiness}
                    style={{
                      flex: '1 1 260px',
                      height: 40,
                      borderRadius: 10,
                      border: '1px solid #cbd5e1',
                      padding: '0 12px',
                      fontWeight: 700,
                    }}
                  />
                  <button
                    type="button"
                    className="mo-btn mo-btn-primary"
                    onClick={handleCheckBusiness}
                    disabled={checkingBusiness}
                  >
                    {checkingBusiness ? 'Checking…' : 'Check'}
                  </button>
                </div>

                {businessResult ? (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ color: '#0f172a', fontWeight: 900, marginBottom: 6 }}>
                      Matches ({businessResult.matches.length})
                    </div>
                    {businessResult.matches.length === 0 ? (
                      <div className="mo-meta">No matches.</div>
                    ) : (
                      <div style={{ display: 'grid', gap: 8 }}>
                        {businessResult.matches.map((b) => (
                          <div
                            key={b.id || `${b.business_name}-${b.permit_number}`}
                            style={{
                              border: '1px solid #e2e8f0',
                              borderRadius: 12,
                              padding: 10,
                              background: '#fff',
                              cursor: 'pointer',
                            }}
                            onClick={() => handleUseBusiness(b)}
                          >
                            <div style={{ fontWeight: 900, color: '#0f172a' }}>{b.business_name || '—'}</div>
                            <div style={{ color: '#475569', fontWeight: 800, fontSize: 12 }}>
                              Permit: {b.epermit_no || '—'}
                            </div>
                            {b.address || b.business_address || b.full_address ? (
                              <div style={{ color: '#475569', fontWeight: 800, fontSize: 12 }}>
                                Address: {b.address || b.business_address || b.full_address}
                              </div>
                            ) : null}
                            {b.permit_status ? (
                              <div style={{ color: '#475569', fontWeight: 800, fontSize: 12 }}>
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

              <div>
                <div className="mo-label">Step 4: Line of Business</div>
                <input
                  value={lineOfBusiness}
                  onChange={(e) => setLineOfBusiness(e.target.value)}
                  placeholder="Enter line of business (used to generate checklist next)"
                  style={{
                    width: '100%',
                    height: 40,
                    borderRadius: 10,
                    border: '1px solid #cbd5e1',
                    padding: '0 12px',
                    fontWeight: 700,
                    marginTop: 8,
                  }}
                />
              </div>

              <div>
                <div className="mo-label">Step 5: Compliance Checklist</div>
                <div className="mo-meta" style={{ marginTop: 6 }}>
                  Mark items as compliant/non-compliant during the inspection.
                </div>

                <div style={{ marginTop: 10, display: 'grid', gap: 10 }}>
                  <label
                    style={{
                      display: 'flex',
                      gap: 10,
                      alignItems: 'center',
                      border: '1px solid #e2e8f0',
                      borderRadius: 12,
                      padding: 10,
                      background: '#fff',
                      fontWeight: 900,
                      color: '#0f172a',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={Boolean(checklist.business_permit)}
                      onChange={(e) => setChecklist((p) => ({ ...p, business_permit: e.target.checked }))}
                    />
                    Business Permit (Presented)
                  </label>

                  <label
                    style={{
                      display: 'flex',
                      gap: 10,
                      alignItems: 'center',
                      border: '1px solid #e2e8f0',
                      borderRadius: 12,
                      padding: 10,
                      background: '#fff',
                      fontWeight: 900,
                      color: '#0f172a',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={Boolean(checklist.with_cctv)}
                      onChange={(e) => setChecklist((p) => ({ ...p, with_cctv: e.target.checked }))}
                    />
                    With CCTV
                  </label>

                  <label
                    style={{
                      display: 'flex',
                      gap: 10,
                      alignItems: 'center',
                      border: '1px solid #e2e8f0',
                      borderRadius: 12,
                      padding: 10,
                      background: '#fff',
                      fontWeight: 900,
                      color: '#0f172a',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={Boolean(checklist.signage_2sqm)}
                      onChange={(e) => setChecklist((p) => ({ ...p, signage_2sqm: e.target.checked }))}
                    />
                    2sqm Signage (Compliant)
                  </label>
                </div>
              </div>

              <div>
                <div className="mo-label">Signatures</div>
                <div
                  style={{
                    marginTop: 10,
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                    gap: 10,
                  }}
                >
                  <div>
                    <div className="mo-meta" style={{ marginBottom: 4 }}>
                      Inspector Signature
                    </div>
                    <div
                      style={{
                        border: '1px solid #cbd5e1',
                        borderRadius: 10,
                        background: '#ffffff',
                        padding: 4,
                      }}
                    >
                      <canvas
                        ref={inspectorCanvasRef}
                        width={400}
                        height={120}
                        style={{ width: '100%', height: 120, display: 'block' }}
                        onMouseDown={(e) => handleSignatureStart('inspector', e)}
                        onMouseMove={(e) => handleSignatureMove('inspector', e)}
                        onMouseUp={() => handleSignatureEnd('inspector')}
                        onMouseLeave={() => handleSignatureEnd('inspector')}
                        onTouchStart={(e) => handleSignatureStart('inspector', e)}
                        onTouchMove={(e) => handleSignatureMove('inspector', e)}
                        onTouchEnd={() => handleSignatureEnd('inspector')}
                      />
                      <button
                        type="button"
                        className="mo-btn mo-btn-secondary"
                        onClick={() => handleSignatureClear('inspector')}
                        style={{ marginTop: 6 }}
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                  <div>
                    <div className="mo-meta" style={{ marginBottom: 4 }}>
                      Business Owner Signature
                    </div>
                    <div
                      style={{
                        border: '1px solid #cbd5e1',
                        borderRadius: 10,
                        background: '#ffffff',
                        padding: 4,
                      }}
                    >
                      <canvas
                        ref={ownerCanvasRef}
                        width={400}
                        height={120}
                        style={{ width: '100%', height: 120, display: 'block' }}
                        onMouseDown={(e) => handleSignatureStart('owner', e)}
                        onMouseMove={(e) => handleSignatureMove('owner', e)}
                        onMouseUp={() => handleSignatureEnd('owner')}
                        onMouseLeave={() => handleSignatureEnd('owner')}
                        onTouchStart={(e) => handleSignatureStart('owner', e)}
                        onTouchMove={(e) => handleSignatureMove('owner', e)}
                        onTouchEnd={() => handleSignatureEnd('owner')}
                      />
                      <button
                        type="button"
                        className="mo-btn mo-btn-secondary"
                        onClick={() => handleSignatureClear('owner')}
                        style={{ marginTop: 6 }}
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
