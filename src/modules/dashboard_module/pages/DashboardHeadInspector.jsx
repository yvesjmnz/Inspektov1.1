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
  if (['approved'].includes(s)) return 'status-badge status-success';
  if (['declined', 'rejected', 'invalid'].includes(s)) return 'status-badge status-danger';
  if (['submitted', 'pending', 'new'].includes(s)) return 'status-badge status-warning';
  if (['on hold', 'on_hold', 'hold'].includes(s)) return 'status-badge status-info';
  return 'status-badge';
}

export default function DashboardHeadInspector() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [complaints, setComplaints] = useState([]);
  const [search, setSearch] = useState('');

  const [creatingForId, setCreatingForId] = useState(null);
  const [toast, setToast] = useState('');

  const [inspectors, setInspectors] = useState([]);
  const [selectedInspectorByComplaintId, setSelectedInspectorByComplaintId] = useState({});
  const [assigningForComplaintId, setAssigningForComplaintId] = useState(null);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    window.location.href = '/login';
  };

  const loadInspectors = async () => {
    setError('');
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, role')
        .eq('role', 'inspector')
        .order('full_name', { ascending: true });

      if (error) throw error;
      setInspectors(data || []);
    } catch (e) {
      setError(e?.message || 'Failed to load inspectors.');
      setInspectors([]);
    }
  };

  const loadApprovedComplaints = async () => {
    setError('');
    setLoading(true);

    try {
      let query = supabase
        .from('complaints')
        .select('*')
        .in('status', ['approved', 'Approved'])
        .order('approved_at', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(200);

      const searchVal = search.trim();
      if (searchVal) {
        query = query.or(
          `business_name.ilike.%${searchVal}%,business_address.ilike.%${searchVal}%,reporter_email.ilike.%${searchVal}%`
        );
      }

      const { data, error } = await query;
      if (error) throw error;

      setComplaints(data || []);
    } catch (e) {
      setError(e?.message || 'Failed to load approved complaints.');
      setComplaints([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadApprovedComplaints();
    loadInspectors();
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
      const complaint = complaints.find((x) => x.id === complaintId);
      if (!complaint) throw new Error('Complaint not found in current list. Please refresh and try again.');

      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      const userId = userData?.user?.id;
      if (!userId) throw new Error('Not authenticated. Please login again.');

      // Prevent duplicates: if a mission order already exists for this complaint, do not create.
      const { data: existing, error: existingError } = await supabase
        .from('mission_orders')
        .select('id, status, created_at')
        .eq('complaint_id', complaintId)
        .order('created_at', { ascending: false })
        .limit(1);

      if (existingError) throw existingError;

      if (existing && existing.length > 0) {
        window.location.assign(`/mission-order?id=${existing[0].id}`);
        return;
      }

      const businessName = complaint.business_name || 'N/A';
      const businessAddress = complaint.business_address || 'N/A';
      const complaintDesc = escapeHtml(complaint.complaint_description || '');

      const title = `Mission Order - ${businessName}`;
      const content = `<h2 style="text-align:center;">MISSION ORDER</h2>
<p><strong>TO:</strong> FIELD INSPECTOR</p>
<p><strong>SUBJECT:</strong> To conduct inspection on the business establishment identified as <strong>${escapeHtml(
        businessName
      )}</strong>, with address at <strong>${escapeHtml(businessAddress)}</strong>.</p>
<hr />
<p><strong>COMPLAINT DETAILS</strong></p>
<p>${complaintDesc}</p>
<p><br/></p>
<p><strong>DATE OF INSPECTION:</strong> ____________________</p>
<p><strong>DATE OF ISSUANCE:</strong> ____________________</p>
<p><br/></p>
<p>In the interest of public service, you are hereby ordered to conduct inspection of the aforementioned establishment.</p>`;

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

  const assignInspector = async (complaintId) => {
    setError('');
    setToast('');

    const inspectorId = selectedInspectorByComplaintId[complaintId];
    if (!inspectorId) {
      setError('Please select an inspector first.');
      return;
    }

    setAssigningForComplaintId(complaintId);

    try {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      const userId = userData?.user?.id;
      if (!userId) throw new Error('Not authenticated. Please login again.');

      const missionOrderId = await getOrCreateMissionOrderId(complaintId);

      // Prevent duplicate assignment of the same inspector to the same mission order
      const { data: existing, error: existingError } = await supabase
        .from('mission_order_assignments')
        .select('id')
        .eq('mission_order_id', missionOrderId)
        .eq('inspector_id', inspectorId)
        .limit(1);

      if (existingError) throw existingError;
      if (existing && existing.length > 0) {
        setToast('This inspector is already assigned to this mission order.');
        return;
      }

      const { error: insertError } = await supabase
        .from('mission_order_assignments')
        .insert([
          {
            mission_order_id: missionOrderId,
            inspector_id: inspectorId,
            assigned_by: userId,
            // status default: 'assigned'
          },
        ]);

      if (insertError) throw insertError;

      const selected = inspectors.find((i) => i.id === inspectorId);
      setToast(`Assigned ${selected?.full_name || 'inspector'} to mission order.`);
    } catch (e) {
      setError(e?.message || 'Failed to assign inspector.');
    } finally {
      setAssigningForComplaintId(null);
    }
  };

  const filteredComplaints = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return complaints;

    // Also allow filtering by UUID fragments
    return complaints.filter((c) => String(c?.id ?? '').toLowerCase().includes(q));
  }, [complaints, search]);

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

          <div className="dash-toolbar">
            <input
              className="dash-input"
              type="text"
              placeholder="Search by business name/address, reporter email, or complaint ID..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
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
                  <th style={{ width: 160 }}>Status</th>
                  <th style={{ width: 200 }}>Approved</th>
                  <th style={{ width: 200 }}>Submitted</th>
                  <th style={{ width: 220 }}>Mission Order</th>
                  <th style={{ width: 260 }}>Assign Inspector</th>
                </tr>
              </thead>
              <tbody>
                {filteredComplaints.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', padding: 18, color: '#475569' }}>
                      {loading ? 'Loading…' : 'No approved complaints found.'}
                    </td>
                  </tr>
                ) : (
                  filteredComplaints.map((c) => (
                    <tr key={c.id}>
                      <td title={c.id}>{String(c.id).slice(0, 8)}…</td>
                      <td>
                        <div className="dash-cell-title">{c.business_name || '—'}</div>
                        <div className="dash-cell-sub">{c.business_address || ''}</div>
                        <div className="dash-cell-sub">{c.reporter_email || ''}</div>
                      </td>
                      <td>
                        <span className={statusBadgeClass(c.status)}>{formatStatus(c.status)}</span>
                      </td>
                      <td>{c.approved_at ? new Date(c.approved_at).toLocaleString() : '—'}</td>
                      <td>{c.created_at ? new Date(c.created_at).toLocaleString() : '—'}</td>
                      <td>
                        <button
                          type="button"
                          className="dash-btn"
                          onClick={() => createMissionOrder(c.id)}
                          disabled={creatingForId === c.id}
                        >
                          {creatingForId === c.id ? 'Creating…' : 'Create MO'}
                        </button>
                      </td>
                      <td>
                        <div className="dash-assign">
                          <select
                            className="dash-select"
                            value={selectedInspectorByComplaintId[c.id] || ''}
                            onChange={(e) =>
                              setSelectedInspectorByComplaintId((prev) => ({ ...prev, [c.id]: e.target.value }))
                            }
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
                            className="dash-btn"
                            onClick={() => assignInspector(c.id)}
                            disabled={assigningForComplaintId === c.id}
                          >
                            {assigningForComplaintId === c.id ? 'Assigning…' : 'Assign'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
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
