import { useEffect, useMemo, useState } from 'react';
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

  const [lineOfBusiness, setLineOfBusiness] = useState('');

  const [checklist, setChecklist] = useState({
    business_permit: false,
    with_cctv: false,
    signage_2sqm: false,
  });

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
      } catch (e) {
        setMissionOrder(null);
        setError(e?.message || 'Failed to load mission order.');
      } finally {
        setLoading(false);
      }
    };

    loadMissionOrder();
  }, [missionOrderId]);

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
              <div>
                <div className="mo-label">Step 1: Validate Business Permit</div>
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
                            }}
                          >
                            <div style={{ fontWeight: 900, color: '#0f172a' }}>{b.business_name || '—'}</div>
                            <div style={{ color: '#475569', fontWeight: 800, fontSize: 12 }}>
                              Permit: {b.epermit_no || '—'}
                            </div>
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
                <div className="mo-label">Step 2: Line of Business</div>
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
                <div className="mo-label">Step 3: Compliance Checklist</div>
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
            </div>
          )}
        </section>
      </main>
      <Footer />
    </div>
  );
}
