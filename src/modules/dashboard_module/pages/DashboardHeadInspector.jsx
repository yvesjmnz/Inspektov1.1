import { useEffect, useMemo, useState } from 'react';
import Header from '../../../components/Header';
import Footer from '../../../components/Footer';
import { supabase } from '../../../lib/supabase';
import './Dashboard.css';

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

  // Mission order status color coding (source of truth: DB check constraint)
  // draft -> neutral/info
  // issued -> warning (queued for Director)
  // for inspection -> success (approved and actionable)
  // cancelled -> danger
  if (s === 'for inspection' || s === 'for_inspection') return 'status-badge status-success';
  if (s === 'issued') return 'status-badge status-warning';
  if (s === 'cancelled' || s === 'canceled') return 'status-badge status-danger';
  if (s === 'draft') return 'status-badge status-info';

  // No mission order yet
  if (!s) return 'status-badge status-info';

  return 'status-badge';
}

export default function DashboardHeadInspector() {
  const [tab, setTab] = useState('todo'); // todo | issued | for-inspection | revisions
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [complaints, setComplaints] = useState([]);
  const [search, setSearch] = useState('');

  const [creatingForId, setCreatingForId] = useState(null);
  const [toast, setToast] = useState('');

  const handleLogout = async () => {
    setError('');
    try {
      // Clear any persisted auth state and force a clean login.
      const { error: signOutError } = await supabase.auth.signOut({ scope: 'global' });
      if (signOutError) throw signOutError;
    } catch (e) {
      // Even if remote sign-out fails, still clear local state and navigate away.
      setError(e?.message || 'Logout failed. Clearing local session…');
    } finally {
      try {
        // Extra safety: remove any cached session artifacts.
        // (Supabase stores these under project-specific keys; clearing all is simplest in this SPA.)
        localStorage.clear();
        sessionStorage.clear();
      } catch {
        // ignore
      }
      window.location.replace('/login');
    }
  };

  
  const loadApprovedComplaints = async () => {
    setError('');
    setLoading(true);

    try {
      // Industry standard: drive this dashboard from Director-approved complaints,
      // regardless of whether a mission order already exists yet.
      // Then attach the latest mission order per complaint (if any).
      const { data: complaintRows, error: complaintError } = await supabase
        .from('complaints')
        .select('id, business_name, business_address, reporter_email, status, approved_at, created_at')
        .in('status', ['approved', 'Approved']);

      if (complaintError) throw complaintError;

      const complaintIds = Array.from(new Set((complaintRows || []).map((c) => c.id).filter(Boolean)));

      const { data: missionOrders, error: moError } = complaintIds.length
        ? await supabase
            .from('mission_orders')
            .select('id, complaint_id, status, created_at')
            .in('complaint_id', complaintIds)
            .order('created_at', { ascending: false })
            .limit(500)
        : { data: [], error: null };

      if (moError) throw moError;

      // Keep the latest MO per complaint.
      const latestMoByComplaintId = new Map();
      (missionOrders || []).forEach((mo) => {
        if (!mo?.complaint_id) return;
        if (!latestMoByComplaintId.has(mo.complaint_id)) {
          latestMoByComplaintId.set(mo.complaint_id, mo);
        }
      });

      const complaintById = new Map((complaintRows || []).map((c) => [c.id, c]));

      // Load inspector assignments (FK-only) and resolve inspector display names.
      // Expected columns in mission_order_assignments: mission_order_id, inspector_id (or user_id)
      const missionOrderIds = Array.from(new Set((Array.from(latestMoByComplaintId.values()) || []).map((m) => m.id).filter(Boolean)));

      const { data: assignmentRows, error: assignmentError } = missionOrderIds.length
        ? await supabase
            .from('mission_order_assignments')
            .select('mission_order_id, inspector_id')
            .in('mission_order_id', missionOrderIds)
        : { data: [], error: null };

      if (assignmentError) throw assignmentError;

      const inspectorIds = Array.from(
        new Set((assignmentRows || []).map((a) => a?.inspector_id).filter(Boolean))
      );

      // Resolve inspector names from profiles.
      // Schema shows profiles has full_name (computed) + first/middle/last (no email column).
      const { data: profileRows, error: profileError } = inspectorIds.length
        ? await supabase
            .from('profiles')
            .select('id, full_name, first_name, middle_name, last_name')
            .in('id', inspectorIds)
        : { data: [], error: null };

      if (profileError) throw profileError;

      const profileById = new Map((profileRows || []).map((p) => [p.id, p]));

      const inspectorNamesByMissionOrderId = new Map();
      (assignmentRows || []).forEach((a) => {
        if (!a?.mission_order_id || !a?.inspector_id) return;
        const p = profileById.get(a.inspector_id);
        const displayName =
          p?.full_name ||
          [p?.first_name, p?.middle_name, p?.last_name].filter(Boolean).join(' ') ||
          String(a.inspector_id).slice(0, 8);
        const arr = inspectorNamesByMissionOrderId.get(a.mission_order_id) || [];
        arr.push(displayName);
        inspectorNamesByMissionOrderId.set(a.mission_order_id, arr);
      });

      // Merge into the shape the table expects.
      const merged = (complaintRows || []).map((c) => {
        const mo = latestMoByComplaintId.get(c.id) || null;
        return {
          complaint_id: c.id,
          business_name: c.business_name,
          business_address: c.business_address,
          reporter_email: c.reporter_email,
          approved_at: c.approved_at,
          created_at: c.created_at,
          mission_order_id: mo?.id || null,
          mission_order_status: mo?.status || null,
          mission_order_created_at: mo?.created_at || null,
          inspector_names: mo?.id ? inspectorNamesByMissionOrderId.get(mo.id) || [] : [],
        };
      });

      const searchVal = search.trim().toLowerCase();
      const filtered = !searchVal
        ? merged
        : merged.filter((r) => {
            const hay = [r.business_name, r.business_address, r.reporter_email, r.complaint_id, r.mission_order_id]
              .filter(Boolean)
              .join(' ')
              .toLowerCase();
            return hay.includes(searchVal);
          });

      setComplaints(filtered);
    } catch (e) {
      setError(e?.message || 'Failed to load mission orders.');
      setComplaints([]);
    } finally {
      setLoading(false);
    }
  };

  
  useEffect(() => {
    loadApprovedComplaints();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const getOrCreateMissionOrderId = async (complaintId) => {
    // 1) Try to find existing mission order for this complaint
    const { data: existing, error: existingError } = await supabase
      .from('mission_orders')
      .select('id, status, created_at')
      .eq('complaint_id', complaintId)
      .order('created_at', { ascending: false })
      .limit(1);

    if (existingError) throw existingError;
    if (existing && existing.length > 0) return existing[0].id;

    // 2) Create a new draft mission order
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError) throw userError;
    const userId = userData?.user?.id;
    if (!userId) throw new Error('Not authenticated. Please login again.');

    const { data: created, error: createError } = await supabase
      .from('mission_orders')
      .insert([
        {
          complaint_id: complaintId,
          created_by: userId,
        },
      ])
      .select('id')
      .single();

    if (createError) throw createError;
    return created.id;
  };

  const escapeHtml = (str) =>
    String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');

  const createMissionOrder = async (complaintId) => {
    setError('');
    setToast('');
    setCreatingForId(complaintId);

    try {
      // Using the view, rows are keyed by complaint_id (not id)
      const row = complaints.find((x) => x.complaint_id === complaintId);
      if (!row) throw new Error('Complaint not found in current list. Please refresh and try again.');

      // If there is already a mission order, just open it.
      if (row.mission_order_id) {
        window.location.assign(`/mission-order?id=${row.mission_order_id}`);
        return;
      }

      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      const userId = userData?.user?.id;
      if (!userId) throw new Error('Not authenticated. Please login again.');

      // Fetch the complaint details from the source table to build MO content.
      const { data: complaint, error: complaintError } = await supabase
        .from('complaints')
        .select('id, business_name, business_address, complaint_description')
        .eq('id', complaintId)
        .single();

      if (complaintError) throw complaintError;

      const businessName = complaint?.business_name || row.business_name || 'N/A';
      const businessAddress = complaint?.business_address || row.business_address || 'N/A';
      const complaintDesc = escapeHtml(complaint?.complaint_description || '');

      const title = `Mission Order - ${businessName}`;

      // Keep the creation template aligned with the editor's default template.
      // Use placeholders so MissionOrderEditor can auto-inject locked spans for inspectors/business fields.
      const content = [
        '<div style="font-family: \"Times New Roman\", Times, serif; line-height: 1.25; font-size: 12px; color: #000;">',
        '<p style="text-align:center; font-weight: 800; letter-spacing: 0.5px; margin: 0 0 10px 0;">MISSION ORDER</p>',
        '<p style="margin: 0 0 14px 0;"><strong>TO:</strong>&nbsp; FIELD INSPECTOR [INSPECTOR NAME]</p>',
        '<p style="margin: 0 0 12px 0;"><strong>SUBJECT:</strong>&nbsp; TO CONDUCT INSPECTION ON THE BUSINESS ESTABLISHMENT IDENTIFIED AS [BUSINESS NAME], WITH ADDRESS AT [ADDRESS].</p>',
        '<p style="margin: 0 0 12px 0; text-align: justify;">',
        'THE CONDUCT OF THIS INSPECTION IS DEEMED NECESSARY IN VIEW OF THE LETTER-COMPLAINT RECEIVED VIA E-MAIL DATED [INSERT DATE] FROM A CONCERNED CITIZEN REGARDING THE OPERATION OF THE ABOVE-MENTIONED BUSINESS ESTABLISHMENT. COMPLAINT DETAILS: ',
        complaintDesc || '',
        '</p>',
        '<table style="width: 100%; border-collapse: collapse; margin: 8px 0 14px 0;">',
        '<tr>',
        '<td style="width: 50%; vertical-align: top; padding: 4px 0;"><strong>DATE OF INSPECTION:</strong></td>',
        '<td style="width: 50%; vertical-align: top; padding: 4px 0; text-align: left;">[INSERT DATE]</td>',
        '</tr>',
        '<tr>',
        '<td style="width: 50%; vertical-align: top; padding: 4px 0;"><strong>DATE OF ISSUANCE:</strong></td>',
        '<td style="width: 50%; vertical-align: top; padding: 4px 0; text-align: left;">[INSERT DATE]</td>',
        '</tr>',
        '</table>',
        '<p style="margin: 0 0 10px 0; text-align: justify;">In the interest of public service, you are hereby ordered to conduct inspection of the aforementioned establishment, for the following purposes:</p>',
        '<p style="margin: 0 0 8px 0; padding-left: 34px; text-indent: -22px;"><strong>a)</strong>&nbsp; To verify the existence and authenticity of the Business Permits and other applicable permits, certificates, and other necessary documents, the completeness of the requirements therein.</p>',
        '<p style="margin: 0 0 8px 0; padding-left: 34px; text-indent: -22px;"><strong>b)</strong>&nbsp; To check actual business operation of the subject establishment.</p>',
        '<p style="margin: 0 0 12px 0; padding-left: 34px; text-indent: -22px;"><strong>c)</strong>&nbsp; To check compliance of said establishment with existing laws, ordinances, regulations relative to health &amp; sanitation, fire safety, engineering &amp; electrical installation standards.</p>',
        '<p style="margin: 0 0 12px 0; text-align: justify;">You are hereby directed to identify yourself by showing proper identification and act with due courtesy and politeness in the implementation of this Order. All inspectors shall wear their ID\'s in such manner as the public will be informed of their true identity.</p>',
        '<p style="margin: 0 0 12px 0; text-align: justify;"><strong>You should also inform the owner or representative of the establishment being inspected that they may verify the authenticity of this Mission Order, or ask questions, or lodge complaints, thru our telephone number (02) 8527-0871 or email at permits@manila.gov.ph</strong></p>',
        '<p style="margin: 0 0 18px 0; text-align: justify;">This Order is in effect until [INSERT DATE] and any Order inconsistent herewith is hereby revoked and/or amended accordingly.</p>',
        '<table style="width: 100%; border: none; border-collapse: collapse;">',
        '<tr>',
        '<td style="width: 50%; vertical-align: top;">',
        '<p style="margin: 0 0 26px 0;">Recommending approval:</p>',
        '<p style="margin: 0; font-weight: 800;">LEVI C. FACUNDO</p>',
        '<p style="margin: 0;">Director</p>',
        '</td>',
        '<td style="width: 50%; vertical-align: top;">',
        '<p style="margin: 0 0 26px 0;">Approved by:</p>',
        '<p style="margin: 0; font-weight: 800;">MANUEL M. ZARCAL</p>',
        '<p style="margin: 0;">Secretary to the Mayor</p>',
        '</td>',
        '</tr>',
        '</table>',
        '</div>',
      ].join('');

      const { data, error } = await supabase
        .from('mission_orders')
        .insert([
          {
            complaint_id: complaintId,
            created_by: userId,
            title,
            content,
            // status defaults to 'draft' in DB
          },
        ])
        .select('id, status, created_at')
        .single();

      if (error) throw error;

      // Use assign to force navigation even if other listeners or state updates exist.
      window.location.assign(`/mission-order?id=${data.id}`);
    } catch (e) {
      setError(e?.message || 'Failed to create mission order.');
    } finally {
      setCreatingForId(null);
    }
  };

  
  const filteredComplaints = useMemo(() => {
    // 1) Apply tab filter (workflow states)
    const normalize = (s) => String(s || '').toLowerCase();

    const byTab = (complaints || []).filter((c) => {
      const s = normalize(c.mission_order_status);
      if (tab === 'todo') return !s || s === 'draft';
      if (tab === 'issued') return s === 'issued';
      if (tab === 'for-inspection') return s === 'for inspection' || s === 'for_inspection';
      if (tab === 'revisions') return s === 'cancelled' || s === 'canceled';
      return true;
    });

    // 2) Apply search filter
    const q = search.trim().toLowerCase();
    if (!q) return byTab;

    return byTab.filter((c) => {
      const hay = [c.business_name, c.business_address, c.reporter_email, c.complaint_id, c.mission_order_id]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [complaints, search, tab]);

  // Group approved complaints by day for easier review.
  const complaintsByDay = useMemo(() => {
    const groups = {};

    for (const c of filteredComplaints) {
      // Bucket rows by the most relevant timestamp for the current view.
      // - for inspection: group by approval timestamp (inspection-ready)
      // - issued/revisions/todo: group by MO created_at when present, else complaint approval/created
      const dtRaw =
        tab === 'for-inspection'
          ? (c.approved_at || c.created_at)
          : (c.mission_order_created_at || c.approved_at || c.created_at);

      const dt = dtRaw ? new Date(dtRaw) : null;
      const key = dt ? new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()).toISOString().slice(0, 10) : 'unknown';
      if (!groups[key]) {
        groups[key] = {
          label: dt ? dt.toLocaleDateString() : 'Unknown Date',
          items: [],
        };
      }
      groups[key].items.push(c);
    }

    // Newest day first.
    const sortedKeys = Object.keys(groups).sort((a, b) => (a < b ? 1 : -1));
    return { groups, sortedKeys };
  }, [filteredComplaints]);

  return (
    <div className="dash-container">
      <Header />
      <main className="dash-main">
        <section className="dash-card">
          <div className="dash-header">
            <div>
              <h2 className="dash-title">Head Inspector Dashboard</h2>
              <p className="dash-subtitle">Step 1: Review Director-approved complaints eligible for mission orders.</p>
            </div>
            <div className="dash-actions">
              <a className="dash-link" href="/">Back to Home</a>
              <button className="dash-logout" type="button" onClick={handleLogout}>
                Logout
              </button>
            </div>
          </div>

          <div className="dash-toolbar" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="dash-btn"
                onClick={() => setTab('todo')}
                disabled={loading}
                style={{
                  background: tab === 'todo' ? '#0f172a' : '#fff',
                  color: tab === 'todo' ? '#fff' : '#0f172a',
                  border: '1px solid #0f172a',
                }}
              >
                To Do
              </button>
              <button
                type="button"
                className="dash-btn"
                onClick={() => setTab('issued')}
                disabled={loading}
                style={{
                  background: tab === 'issued' ? '#0f172a' : '#fff',
                  color: tab === 'issued' ? '#fff' : '#0f172a',
                  border: '1px solid #0f172a',
                }}
              >
                Issued
              </button>
              <button
                type="button"
                className="dash-btn"
                onClick={() => setTab('for-inspection')}
                disabled={loading}
                style={{
                  background: tab === 'for-inspection' ? '#0f172a' : '#fff',
                  color: tab === 'for-inspection' ? '#fff' : '#0f172a',
                  border: '1px solid #0f172a',
                }}
              >
                For Inspection
              </button>
              <button
                type="button"
                className="dash-btn"
                onClick={() => setTab('revisions')}
                disabled={loading}
                style={{
                  background: tab === 'revisions' ? '#0f172a' : '#fff',
                  color: tab === 'revisions' ? '#fff' : '#0f172a',
                  border: '1px solid #0f172a',
                }}
              >
                For Revisions
              </button>
            </div>

            <input
              className="dash-input"
              type="text"
              placeholder="Search by business name/address, reporter email, complaint ID, or MO ID..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ flex: 1, minWidth: 260 }}
            />
            <button className="dash-btn" type="button" onClick={loadApprovedComplaints} disabled={loading}>
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>

          {toast ? <div className="dash-alert dash-alert-success">{toast}</div> : null}
          {error ? <div className="dash-alert dash-alert-error">{error}</div> : null}

          <div className="dash-table-wrap">
            <table className="dash-table">
              <thead>
                <tr>
                  <th style={{ width: 90 }}>ID</th>
                  <th>Business</th>
                  <th style={{ width: 160 }}>Mission Order</th>
                  <th style={{ width: 200 }}>Approved</th>
                  <th style={{ width: 200 }}>Submitted</th>
                  <th style={{ width: 220 }}>Mission Order</th>
                  <th style={{ width: 260 }}>Inspectors Assigned</th>
                </tr>
              </thead>
              <tbody>
                {filteredComplaints.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', padding: 18, color: '#475569' }}>
                      {loading ? 'Loading…' : 'No records found for this tab.'}
                    </td>
                  </tr>
                ) : (
                  complaintsByDay.sortedKeys.flatMap((dayKey) => {
                    const rows = [];
                    const label = complaintsByDay.groups[dayKey]?.label || dayKey;

                    // Day header row
                    rows.push(
                      <tr key={`day-${dayKey}`}>
                        <td colSpan={7} style={{ fontWeight: 800, color: '#0f172a', background: '#f8fafc' }}>
                          {label}
                        </td>
                      </tr>
                    );

                    complaintsByDay.groups[dayKey].items.forEach((c) => {
                      rows.push(
                        <tr key={c.complaint_id}>
                          <td title={c.complaint_id}>{String(c.complaint_id).slice(0, 8)}…</td>
                          <td>
                            <div className="dash-cell-title">{c.business_name || '—'}</div>
                            <div className="dash-cell-sub">{c.business_address || ''}</div>
                            <div className="dash-cell-sub">{c.reporter_email || ''}</div>
                          </td>
                          <td>
                            <span className={statusBadgeClass(c.mission_order_status)}>
                              {c.mission_order_status ? formatStatus(c.mission_order_status) : 'No MO'}
                            </span>
                          </td>
                          <td>{c.approved_at ? new Date(c.approved_at).toLocaleString() : '—'}</td>
                          <td>{c.created_at ? new Date(c.created_at).toLocaleString() : '—'}</td>
                          <td>
                            <button
                              type="button"
                              className="dash-btn"
                              onClick={() => createMissionOrder(c.complaint_id)}
                              disabled={creatingForId === c.complaint_id}
                            >
                              {creatingForId === c.complaint_id ? 'Creating…' : c.mission_order_id ? 'Open MO' : 'Create MO'}
                            </button>
                          </td>
                          <td>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, minHeight: 30, alignItems: 'center' }}>
                              {(c.inspector_names || []).length === 0 ? (
                                <span style={{ color: '#64748b', fontWeight: 700 }}>—</span>
                              ) : (
                                (c.inspector_names || []).map((name, idx) => (
                                  <span
                                    key={`${c.complaint_id}-${idx}`}
                                    style={{
                                      padding: '6px 10px',
                                      borderRadius: 999,
                                      fontWeight: 800,
                                      border: '1px solid #e2e8f0',
                                      background: '#f8fafc',
                                    }}
                                  >
                                    {name}
                                  </span>
                                ))
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    });

                    return rows;
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="dash-note">
            Step 2: “Create MO” will create a draft record in <code>mission_orders</code> for the selected complaint.
            Duplicate mission orders for the same complaint are prevented.
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
