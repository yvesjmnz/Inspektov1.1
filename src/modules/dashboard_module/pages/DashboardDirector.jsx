import { useEffect, useMemo, useState } from 'react';
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

export default function DashboardDirector() {
  const [tab, setTab] = useState('queue'); // queue | mission-orders | history
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [complaints, setComplaints] = useState([]);
  const [missionOrders, setMissionOrders] = useState([]);
  const [search, setSearch] = useState('');
  const [auditComplaint, setAuditComplaint] = useState(null);
  // Full complaint popup state
  const [fullViewId, setFullViewId] = useState(null);
  const [fullViewLoading, setFullViewLoading] = useState(false);
  const [fullViewError, setFullViewError] = useState('');
  const [fullComplaint, setFullComplaint] = useState(null);
  const [fullPreviewImage, setFullPreviewImage] = useState(null);

  const [previewImage, setPreviewImage] = useState(null);
  const closePreview = () => setPreviewImage(null);
  const [navCollapsed, setNavCollapsed] = useState(false);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    window.location.href = '/login';
  };

  const loadComplaints = async () => {
    setError('');
    setLoading(true);

    try {
      let query = supabase
        .from('complaints')
        .select('id, status, created_at, authenticity_level, business_name, business_address, reporter_email, complaint_description, image_urls, approved_by, approved_at, declined_by, declined_at')
        .order('created_at', { ascending: false })
        .limit(200);

      if (tab === 'queue') {
        // Director queue: items that need review
        query = query.in('status', ['Submitted', 'Pending', 'New', 'submitted', 'pending', 'new']);
      } else {
        // History: approved/declined/rejected
        query = query.in('status', [
          'Approved',
          'Declined',
          'Rejected',
          'approved',
          'declined',
          'rejected',
        ]);
      }

      const searchVal = search.trim();
      if (searchVal) {
        // Basic search across common columns. If a column doesn't exist, Supabase will error.
        // Keep it conservative to the known ones from ComplaintForm: business_name, business_address, reporter_email.
        query = query.or(
          `business_name.ilike.%${searchVal}%,business_address.ilike.%${searchVal}%,reporter_email.ilike.%${searchVal}%`
        );
      }

      const { data, error } = await query;
      if (error) throw error;

      setComplaints(data || []);
    } catch (e) {
      setError(e?.message || 'Failed to load complaints.');
      setComplaints([]);
    } finally {
      setLoading(false);
    }
  };

  const loadMissionOrders = async () => {
    setError('');
    setLoading(true);

    try {
      // Mission orders awaiting Director review use status = 'issued'
      let query = supabase
        .from('mission_orders')
        .select('id, title, status, submitted_at, complaint_id')
        .order('submitted_at', { ascending: false })
        .limit(200);

      if (tab === 'mission-orders') {
        query = query.eq('status', 'issued');
      }

      const searchVal = search.trim();
      if (searchVal) {
        query = query.or(`title.ilike.%${searchVal}%,id::text.ilike.%${searchVal}%,complaint_id::text.ilike.%${searchVal}%`);
      }

      const { data, error } = await query;
      if (error) throw error;

      setMissionOrders(data || []);
    } catch (e) {
      setError(e?.message || 'Failed to load mission orders.');
      setMissionOrders([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (tab === 'mission-orders') {
      loadMissionOrders();
    } else {
      loadComplaints();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const filteredComplaints = useMemo(() => {
    // Additional client-side filtering by ID (since server-side OR is limited to text columns).
    const q = search.trim().toLowerCase();
    if (!q) return complaints;

    return complaints.filter((c) => {
      const idStr = String(c?.id ?? '').toLowerCase();
      return idStr.includes(q);
    });
  }, [complaints, search]);

  const filteredMissionOrders = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return missionOrders;

    return missionOrders.filter((mo) => {
      const idStr = String(mo?.id ?? '').toLowerCase();
      const titleStr = String(mo?.title ?? '').toLowerCase();
      const complaintStr = String(mo?.complaint_id ?? '').toLowerCase();
      return idStr.includes(q) || titleStr.includes(q) || complaintStr.includes(q);
    });
  }, [missionOrders, search]);

  // Group complaints by day for Review Queue
  const complaintsByDay = useMemo(() => {
    if (tab !== 'queue') return { groups: {}, sortedKeys: [] };
    const groups = {};
    for (const c of filteredComplaints) {
      const d = c.created_at ? new Date(c.created_at) : null;
      const key = d ? new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString().slice(0, 10) : 'unknown';
      if (!groups[key]) groups[key] = { label: d ? d.toLocaleDateString() : 'Unknown Date', items: [] };
      groups[key].items.push(c);
    }
    const sortedKeys = Object.keys(groups).sort((a, b) => (a < b ? 1 : -1)); // desc by date key YYYY-MM-DD
    return { groups, sortedKeys };
  }, [filteredComplaints, tab]);

  // Utilities: export and print
  const toCsvValue = (v) => {
    if (v === null || v === undefined) return '""';
    const s = String(v).replace(/"/g, '""');
    return `"${s}"`;
  };
  const downloadCsv = (filename, rows) => {
    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };
  const exportComplaintsToCSV = (list) => {
    const header = [
      'id',
      'business_name',
      'business_address',
      'reporter_email',
      'status',
      'authenticity_level',
      'created_at',
      'approved_at',
      'approved_by',
      'declined_at',
      'declined_by',
      'complaint_description',
    ];
    const rows = [header.map(toCsvValue).join(',')];
    for (const c of list) {
      const approverLabel = c.approved_by ? String(c.approved_by) : '';
      const declinerLabel = c.declined_by ? String(c.declined_by) : '';
      const row = [
        c.id,
        c.business_name || '',
        c.business_address || '',
        c.reporter_email || '',
        c.status || '',
        c.authenticity_level ?? '',
        c.created_at || '',
        c.approved_at || '',
        approverLabel || '',
        c.declined_at || '',
        declinerLabel || '',
        c.complaint_description || '',
      ];
      rows.push(row.map(toCsvValue).join(','));
    }
    const ts = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
    downloadCsv(`complaints-${tab}-${ts}.csv`, rows);
  };
  const exportMissionOrdersToCSV = (list) => {
    const header = ['id', 'title', 'complaint_id', 'status', 'submitted_at'];
    const rows = [header.map(toCsvValue).join(',')];
    for (const m of list) {
      const row = [m.id, m.title || '', m.complaint_id || '', m.status || '', m.submitted_at || ''];
      rows.push(row.map(toCsvValue).join(','));
    }
    const ts = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
    downloadCsv(`mission-orders-${ts}.csv`, rows);
  };
  const handleExport = () => {
    if (tab === 'mission-orders') {
      exportMissionOrdersToCSV(filteredMissionOrders);
    } else {
      exportComplaintsToCSV(filteredComplaints);
    }
  };

  // Load full complaint for popup
  const openFullComplaint = async (id) => {
    setFullViewId(id);
    setFullViewLoading(true);
    setFullViewError('');
    setFullComplaint(null);
    try {
      const { data, error } = await supabase
        .from('complaints')
        .select('*')
        .eq('id', id)
        .single();
      if (error) throw error;
      setFullComplaint(data);
    } catch (e) {
      setFullViewError(e?.message || 'Failed to load complaint');
    } finally {
      setFullViewLoading(false);
    }
  };
  const closeFullComplaint = () => {
    setFullViewId(null);
    setFullComplaint(null);
    setFullViewError('');
    setFullPreviewImage(null);
  };
  
  // Summary KPIs (client-side only)
  const summary = useMemo(() => {
    if (tab === 'mission-orders') {
      const total = filteredMissionOrders.length;
      const issued = filteredMissionOrders.filter((x) => String(x.status || '').toLowerCase() === 'issued').length;
      const completed = filteredMissionOrders.filter((x) => String(x.status || '').toLowerCase() === 'completed').length;
      const cancelled = filteredMissionOrders.filter((x) => String(x.status || '').toLowerCase() === 'cancelled').length;
      return { total, issued, completed, cancelled };
    }
    const total = filteredComplaints.length;
    const sLower = (s) => String(s || '').toLowerCase();
    const approved = filteredComplaints.filter((c) => sLower(c.status) === 'approved').length;
    const declined = filteredComplaints.filter((c) => sLower(c.status) === 'declined').length;
    const pending = filteredComplaints.filter((c) => ['submitted', 'pending', 'new'].includes(sLower(c.status))).length;

    // Average decision time in hours (from created_at to approved_at/declined_at if present)
    const decisionDurations = filteredComplaints
      .map((c) => {
        const created = c.created_at ? new Date(c.created_at).getTime() : null;
        const decidedAt = sLower(c.status) === 'approved' ? c.approved_at : sLower(c.status) === 'declined' ? c.declined_at : null;
        const decided = decidedAt ? new Date(decidedAt).getTime() : null;
        if (!created || !decided) return null;
        return (decided - created) / 36e5; // hours
      })
      .filter((x) => typeof x === 'number');
    const avgDecisionHours = decisionDurations.length > 0 ? Number((decisionDurations.reduce((a, b) => a + b, 0) / decisionDurations.length).toFixed(1)) : null;

    return { total, approved, declined, pending, avgDecisionHours };
  }, [tab, filteredComplaints, filteredMissionOrders]);

  const updateComplaintStatus = async (complaintId, newStatus) => {
    setError('');
    setLoading(true);

    try {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;

      const user = userData?.user;
      if (!user) {
        throw new Error('You must be logged in to perform this action.');
      }

      const status = String(newStatus).toLowerCase();
      const nowIso = new Date().toISOString();

      /**
       * complaints table audit columns:
       * - approved_by uuid
       * - approved_at timestamptz
       * - declined_by uuid
       * - declined_at timestamptz
       * - updated_at timestamptz (default now())
       */
      const patch = { status };

      if (status === 'approved') {
        patch.approved_by = user.id;
        patch.approved_at = nowIso;
        // clear decline columns if previously declined
        patch.declined_by = null;
        patch.declined_at = null;
      } else if (status === 'declined') {
        patch.declined_by = user.id;
        patch.declined_at = nowIso;
        // clear approve columns if previously approved
        patch.approved_by = null;
        patch.approved_at = null;
      }

      // Explicitly touch updated_at to guarantee it changes on update.
      patch.updated_at = nowIso;

      const { error } = await supabase
        .from('complaints')
        .update(patch)
        .eq('id', complaintId);

      if (error) throw error;

      // Optimistic update
      setComplaints((prev) =>
        prev.map((c) => (c.id === complaintId ? { ...c, ...patch } : c))
      );

      // If in queue, remove items that are no longer in review state
      if (tab === 'queue') {
        setComplaints((prev) =>
          prev.filter((c) => {
            if (c.id !== complaintId) return true;
            return ['submitted', 'pending', 'new'].includes(String(status));
          })
        );
      }
    } catch (e) {
      setError(e?.message || 'Failed to update status.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="dash-container">
            <main className="dash-main">
        <section className="dash-shell" style={{ paddingLeft: navCollapsed ? 72 : 240 }}>
          <aside className="dash-side" title="Menu" style={{ width: navCollapsed ? 72 : 240, display: 'flex', flexDirection: 'column' }}>
            <div className="dash-side-brand" title="Menu">
              <div className="hamburger" aria-hidden="true">
                <div className="hamburger-bar"></div>
                <div className="hamburger-bar"></div>
                <div className="hamburger-bar"></div>
              </div>
            </div>
            <ul className="dash-nav" style={{ flex: 1 }}>
              <li>
                <button type="button" className={`dash-nav-item ${tab === 'queue' ? 'active' : ''}`} onClick={() => setTab('queue')}>
                  <span className="dash-nav-label" style={{ display: navCollapsed ? 'none' : 'inline' }}>Review Queue</span>
                </button>
              </li>
              <li>
                <button type="button" className={`dash-nav-item ${tab === 'mission-orders' ? 'active' : ''}`} onClick={() => setTab('mission-orders')}>
                  <span className="dash-nav-label" style={{ display: navCollapsed ? 'none' : 'inline' }}>Review Mission Orders</span>
                </button>
              </li>
              <li>
                <button type="button" className={`dash-nav-item ${tab === 'history' ? 'active' : ''}`} onClick={() => setTab('history')}>
                  <span className="dash-nav-label" style={{ display: navCollapsed ? 'none' : 'inline' }}>Complaint History</span>
                </button>
              </li>
              <li>
                <a className="dash-nav-item" href="/">
                  <span className="dash-nav-label" style={{ display: navCollapsed ? 'none' : 'inline' }}>Back to Home</span>
                </a>
              </li>
                          </ul>
            <button
              type="button"
              onClick={handleLogout}
              style={{
                marginTop: 'auto',
                border: 'none',
                background: 'transparent',
                color: '#ef4444',
                fontWeight: 800,
                textAlign: 'left',
                padding: '10px 12px',
                borderRadius: 10,
                cursor: 'pointer',
              }}
            >
              <span className="dash-nav-label" style={{ display: navCollapsed ? 'none' : 'inline' }}>Logout</span>
            </button>
          </aside>
          <div className="dash-maincol">
            <div className="dash-card">
          <div className="dash-header">
            <div>
              <h2 className="dash-title">Director Dashboard</h2>
              <p className="dash-subtitle">Complaint oversight: review submissions and track decision history.</p>
            </div>
            <div className="dash-actions"></div>
          </div>

          {tab === 'queue' ? (
            <div className="dash-topbar">
              <button
                type="button"
                className="dash-menu-btn"
                onClick={() => setNavCollapsed((v) => !v)}
                aria-label="Toggle menu"
                title="Toggle menu"
              >
                <span className="dash-menu-label">{navCollapsed ? 'Expand >' : '< Collapse'}</span>
              </button>
            </div>
          ) : null}

          <div className="dash-toolbar">
            <input
              className="dash-input"
              type="text"
              placeholder="Search by business name/address, reporter email, or ID..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button className="dash-btn" type="button" onClick={() => (tab === 'mission-orders' ? loadMissionOrders() : loadComplaints())} disabled={loading}>
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
            <button
              className="dash-btn"
              type="button"
              onClick={handleExport}
              disabled={loading || (tab === 'mission-orders' ? filteredMissionOrders.length === 0 : filteredComplaints.length === 0)}
            >
              Export CSV
            </button>
                      </div>

          {error ? <div className="dash-alert dash-alert-error">{error}</div> : null}
          <div style={{ margin: '10px 0', color: '#475569', fontSize: 12 }}>
            {tab === 'mission-orders' ? (
              <span>
                Orders: {summary.total} • Issued: {summary.issued} • Completed: {summary.completed} • Cancelled: {summary.cancelled} • Avg Inspection Duration: —
              </span>
            ) : (
              <span>
                Complaints: {summary.total} • Approved: {summary.approved} • Declined: {summary.declined} • Pending: {summary.pending}
                {summary.avgDecisionHours ? ` • Avg decision time: ${summary.avgDecisionHours}h` : ''}
              </span>
            )}
          </div>

          {tab === 'mission-orders' ? (
            <div className="dash-table-wrap">
              <table className="dash-table">
                <thead>
                  <tr>
                    <th style={{ width: 120 }}>MO ID</th>
                    <th>Title</th>
                    <th style={{ width: 180 }}>Status</th>
                    <th style={{ width: 220 }}>Submitted</th>
                    <th style={{ width: 220 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredMissionOrders.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ textAlign: 'center', padding: 18, color: '#475569' }}>
                        {loading ? 'Loading…' : 'No mission orders found.'}
                      </td>
                    </tr>
                  ) : (
                    filteredMissionOrders.map((mo) => (
                      <tr key={mo.id}>
                        <td title={mo.id}>{String(mo.id).slice(0, 8)}…</td>
                        <td>
                          <div className="dash-cell-title">{mo.title || 'Mission Order'}</div>
                          <div className="dash-cell-sub">Complaint: {mo.complaint_id ? String(mo.complaint_id).slice(0, 8) + '…' : '—'}</div>
                        </td>
                        <td>
                          <span className={statusBadgeClass(mo.status)}>{formatStatus(mo.status)}</span>
                        </td>
                        <td>{mo.submitted_at ? new Date(mo.submitted_at).toLocaleString() : '—'}</td>
                        <td>
                          <div className="dash-row-actions">
                            <a className="dash-btn" href={`/mission-order/review?id=${mo.id}`}>
                              Review MO
                            </a>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="dash-table-wrap">
              <table className="dash-table">
                <thead>
                  {tab === 'queue' ? (
                    <tr>
                      <th style={{ width: 90 }}>ID</th>
                      <th>Business</th>
                      <th style={{ width: 160 }}>Urgency</th>
                      <th style={{ width: 200 }}>Submitted</th>
                      <th style={{ width: 220 }}>Actions</th>
                    </tr>
                  ) : (
                    <tr>
                      <th style={{ width: 90 }}>ID</th>
                      <th>Business</th>
                      <th style={{ width: 240 }}>Status</th>
                      {tab === 'history' ? <th style={{ width: 280 }}>Decision</th> : null}
                      <th style={{ width: 180 }}>Authenticity Level</th>
                      <th style={{ width: 200 }}>Submitted</th>
                      <th style={{ width: 280 }}>Evidence</th>
                    </tr>
                  )}
                </thead>
                <tbody>
                  {filteredComplaints.length === 0 ? (
                    <tr>
                      <td colSpan={7} style={{ textAlign: 'center', padding: 18, color: '#475569' }}>
                        {loading ? 'Loading…' : 'No records found.'}
                      </td>
                    </tr>
                  ) : (
                    tab === 'queue'
                      ? (
                        complaintsByDay.sortedKeys.flatMap((dayKey) => {
                          const rows = [];
                          const label = complaintsByDay.groups[dayKey]?.label || dayKey;
                          rows.push(
                            <tr key={`day-${dayKey}`}>
                              <td colSpan={5} style={{ fontWeight: 800, color: '#0f172a', background: '#f8fafc' }}>{label}</td>
                            </tr>
                          );
                          complaintsByDay.groups[dayKey].items.forEach((c) => {
                            rows.push(
                              <tr key={c.id} onClick={() => openFullComplaint(c.id)} style={{ cursor: 'pointer' }}>
                                <td>{c.id}</td>
                                <td>
                                  <div className="dash-cell-title">{c.business_name || '—'}</div>
                                  <div className="dash-cell-sub">{c.business_address || ''}</div>
                                </td>
                                <td>
                                  <span className="status-badge status-warning">{c?.authenticity_level ?? '—'}</span>
                                </td>
                                <td>{c.created_at ? new Date(c.created_at).toLocaleString() : '—'}</td>
                                <td>
                                  <div className="dash-row-actions">
                                    <button
                                      type="button"
                                      className="dash-btn dash-btn-success dash-btn-icon"
                                      onClick={(e) => { e.stopPropagation(); updateComplaintStatus(c.id, 'approved'); }}
                                      disabled={loading}
                                      aria-label="Approve"
                                      title="Approve"
                                    >
                                      ✓
                                    </button>
                                    <button
                                      type="button"
                                      className="dash-btn dash-btn-danger dash-btn-icon"
                                      onClick={(e) => { e.stopPropagation(); updateComplaintStatus(c.id, 'declined'); }}
                                      disabled={loading}
                                      aria-label="Decline"
                                      title="Decline"
                                    >
                                      ✕
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          });
                          return rows;
                        })
                      ) : (
                        filteredComplaints.map((c) => (
                          <tr key={c.id}>
                            <td>{c.id}</td>
                            <td>
                              <div className="dash-cell-title">{c.business_name || '—'}</div>
                              <div className="dash-cell-sub">{c.business_address || ''}</div>
                              <div className="dash-cell-sub">{c.reporter_email || ''}</div>
                            </td>
                            <td>
                              <span className={statusBadgeClass(c.status)}>{formatStatus(c.status)}</span>
                            </td>
                            {tab === 'history' ? (
                              <td>
                                <div className="dash-cell-sub">
                                  {(() => {
                                    const s = String(c.status || '').toLowerCase();
                                    if (s === 'approved') {
                                      const label = c.approved_by ? String(c.approved_by).slice(0, 8) + '…' : '—';
                                      return `Approved by ${label} on ${c.approved_at ? new Date(c.approved_at).toLocaleString() : '—'}`;
                                    }
                                    if (s === 'declined') {
                                      const label = c.declined_by ? String(c.declined_by).slice(0, 8) + '…' : '—';
                                      return `Declined by ${label} on ${c.declined_at ? new Date(c.declined_at).toLocaleString() : '—'}`;
                                    }
                                    return '—';
                                  })()}
                                </div>
                                <div style={{ marginTop: 6 }}>
                                  <button className="dash-link" type="button" onClick={() => setAuditComplaint(c)}>View audit</button>
                                </div>
                              </td>
                            ) : null}
                            <td>{c?.authenticity_level ?? '—'}</td>
                            <td>{c.created_at ? new Date(c.created_at).toLocaleString() : '—'}</td>
                            <td>
                              <div style={{ display: 'grid', gap: 8 }}>
                                {c?.complaint_description ? (
                                  <div style={{ color: '#0f172a', whiteSpace: 'pre-wrap' }}>
                                    {String(c.complaint_description).slice(0, 220)}
                                    {String(c.complaint_description).length > 220 ? '…' : ''}
                                  </div>
                                ) : (
                                  <div style={{ color: '#64748b', fontWeight: 700 }}>No description</div>
                                )}

                                {Array.isArray(c?.image_urls) && c.image_urls.length > 0 ? (
                                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                    {c.image_urls.slice(0, 3).map((url) => (
                                      <img
                                        key={url}
                                        src={url}
                                        alt="Evidence"
                                        onClick={() => setPreviewImage(url)}
                                        style={{
                                          width: 68,
                                          height: 46,
                                          objectFit: 'cover',
                                          borderRadius: 10,
                                          border: '1px solid #e2e8f0',
                                          cursor: 'pointer',
                                        }}
                                        loading="lazy"
                                      />
                                    ))}
                                    {c.image_urls.length > 3 ? (
                                      <span style={{ color: '#64748b', fontWeight: 800, alignSelf: 'center' }}>
                                        +{c.image_urls.length - 3} more
                                      </span>
                                    ) : null}
                                  </div>
                                ) : (
                                  <div style={{ color: '#64748b', fontWeight: 700 }}>No images</div>
                                )}
                              </div>
                            </td>
                            {tab === 'queue' ? (
                              <td>
                                <div className="dash-row-actions">
                                  <button
                                    type="button"
                                    className="dash-btn dash-btn-success dash-btn-icon"
                                    onClick={() => updateComplaintStatus(c.id, 'approved')}
                                    disabled={loading}
                                    aria-label="Approve"
                                    title="Approve"
                                  >
                                    ✓
                                  </button>
                                  <button
                                    type="button"
                                    className="dash-btn dash-btn-danger dash-btn-icon"
                                    onClick={() => updateComplaintStatus(c.id, 'declined')}
                                    disabled={loading}
                                    aria-label="Decline"
                                    title="Decline"
                                  >
                                    ✕
                                  </button>
                                </div>
                              </td>
                            ) : null}
                          </tr>
                        ))
                      )
                  )}
                </tbody>
              </table>
            </div>
          )}

          <div className="dash-note">
            Note: Inspection monitoring, audit trails, reports, exports, and printing will be implemented next.
          </div>
            </div>
          </div>
        </section>
      </main>
      {/* Image Preview Overlay */}
      {previewImage ? (
        <div
          className="image-overlay"
          onClick={closePreview}
          role="dialog"
          aria-modal="true"
        >
          <div className="overlay-content" onClick={(e) => e.stopPropagation()}>
            <button className="overlay-close" onClick={closePreview} aria-label="Close">&times;</button>
            <img src={previewImage} alt="Evidence Preview" className="overlay-full-img" />
          </div>
        </div>
      ) : null}

      {/* Audit Overlay */}
      {auditComplaint ? (
        <div
          className="image-overlay"
          onClick={() => setAuditComplaint(null)}
          role="dialog"
          aria-modal="true"
        >
          <div className="overlay-content" onClick={(e) => e.stopPropagation()} style={{ padding: 0 }}>
            <div style={{ background: '#ffffff', borderRadius: 12, padding: 16, boxShadow: '0 12px 28px rgba(0,0,0,0.25)', maxWidth: 560, width: '100%', position: 'relative' }}>
              <button className="overlay-close" onClick={() => setAuditComplaint(null)} aria-label="Close">&times;</button>
              <h3 style={{ marginTop: 0, marginBottom: 10 }}>Complaint Audit</h3>
              {auditComplaint ? (
                <div style={{ fontSize: 14, color: '#0f172a', display: 'grid', gap: 8 }}>
                  <div><strong>ID:</strong> {auditComplaint.id}</div>
                  <div><strong>Business:</strong> {auditComplaint.business_name || '—'}</div>
                  <div><strong>Status:</strong> {formatStatus(auditComplaint.status)}</div>
                  <div><strong>Submitted:</strong> {auditComplaint.created_at ? new Date(auditComplaint.created_at).toLocaleString() : '—'}</div>
                  <div><strong>Inspection Duration:</strong> — (pending inspections module)</div>
                  {(() => {
                    const s = String(auditComplaint.status || '').toLowerCase();
                    const created = auditComplaint.created_at ? new Date(auditComplaint.created_at) : null;
                    if (s === 'approved') {
                      const decided = auditComplaint.approved_at ? new Date(auditComplaint.approved_at) : null;
                      const dur = created && decided ? ((decided.getTime() - created.getTime()) / 36e5).toFixed(1) : null;
                      return (
                        <div>
                          <div><strong>Approved:</strong> {auditComplaint.approved_at ? decided.toLocaleString() : '—'} by {auditComplaint.approved_by ? String(auditComplaint.approved_by).slice(0, 8) + '…' : '—'}</div>
                          {dur ? <div><strong>Decision time:</strong> {dur} hours</div> : null}
                        </div>
                      );
                    }
                    if (s === 'declined') {
                      const decided = auditComplaint.declined_at ? new Date(auditComplaint.declined_at) : null;
                      const dur = created && decided ? ((decided.getTime() - created.getTime()) / 36e5).toFixed(1) : null;
                      return (
                        <div>
                          <div><strong>Declined:</strong> {auditComplaint.declined_at ? decided.toLocaleString() : '—'} by {auditComplaint.declined_by ? String(auditComplaint.declined_by).slice(0, 8) + '…' : '—'}</div>
                          {dur ? <div><strong>Decision time:</strong> {dur} hours</div> : null}
                        </div>
                      );
                    }
                    return null;
                  })()}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {/* Full Complaint Sidebar (fixed, no popup) */}
      {fullViewId ? (
        <div style={{
          position: 'fixed',
          top: 0,
          right: 0,
          height: '100vh',
          width: 'min(900px, 92vw)',
          background: '#ffffff',
          borderLeft: '1px solid #e2e8f0',
          boxShadow: '-12px 0 28px rgba(0,0,0,0.25)',
          display: 'flex',
          flexDirection: 'column',
          zIndex: 50
        }}>
          <button className="overlay-close" onClick={closeFullComplaint} aria-label="Close">&times;</button>
          <div style={{ padding: 16, borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h3 style={{ margin: 0 }}>Complaint Review</h3>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="dash-btn" type="button" onClick={() => window.print()}>Print</button>
            </div>
          </div>
          <div style={{ padding: 16, overflowY: 'auto' }}>
            {fullViewLoading ? <div className="dash-alert">Loading…</div> : null}
            {fullViewError ? <div className="dash-alert dash-alert-error">{fullViewError}</div> : null}

            {fullComplaint ? (
              <div style={{ display: 'grid', gap: 12 }}>
                {/* Summary */}
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  <div style={{ minWidth: 280 }}>
                    <div style={{ fontSize: 18, fontWeight: 800, color: '#0f172a' }}>{fullComplaint.business_name || '—'}</div>
                    <div style={{ color: '#475569', fontWeight: 700 }}>{fullComplaint.business_address || '—'}</div>
                  </div>
                  <div style={{ display: 'grid', gap: 6, justifyItems: 'end' }}>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      <span className="status-badge status-warning" title="Urgency">{fullComplaint?.authenticity_level ?? '—'}</span>
                      <span className="status-badge" title="Status">{formatStatus(fullComplaint.status)}</span>
                    </div>
                    <div style={{ color: '#64748b', fontWeight: 700 }}><strong style={{ color: '#0f172a' }}>ID:</strong> {fullComplaint.id}</div>
                    <div style={{ color: '#64748b', fontWeight: 700 }}><strong style={{ color: '#0f172a' }}>Submitted:</strong> {fullComplaint.created_at ? new Date(fullComplaint.created_at).toLocaleString() : '—'}</div>
                    <div style={{ color: '#64748b', fontWeight: 700 }}><strong style={{ color: '#0f172a' }}>Updated:</strong> {fullComplaint.updated_at ? new Date(fullComplaint.updated_at).toLocaleString() : '—'}</div>
                  </div>
                </div>

                <div style={{ height: 1, background: '#f1f5f9' }} />

                {/* Description */}
                <div>
                  <div style={{ fontWeight: 800, marginBottom: 6, color: '#0f172a' }}>Description</div>
                  <div style={{ whiteSpace: 'pre-wrap', color: '#0f172a' }}>{fullComplaint.complaint_description || '—'}</div>
                </div>

                {/* Evidence */}
                <div>
                  <div style={{ fontWeight: 800, marginBottom: 6, color: '#0f172a' }}>Evidence</div>
                  {Array.isArray(fullComplaint.image_urls) && fullComplaint.image_urls.length > 0 ? (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {fullComplaint.image_urls.map((url) => (
                        <img
                          key={url}
                          src={url}
                          alt="Evidence"
                          onClick={() => setFullPreviewImage(url)}
                          style={{
                            width: 160,
                            height: 110,
                            objectFit: 'cover',
                            borderRadius: 10,
                            border: '1px solid #e2e8f0',
                            cursor: 'pointer',
                          }}
                          loading="lazy"
                        />
                      ))}
                    </div>
                  ) : (
                    <div style={{ color: '#64748b', fontWeight: 700 }}>No images</div>
                  )}
                </div>

                {/* Details */}
                <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(2, minmax(240px, 1fr))' }}>
                  <div style={{ color: '#64748b', fontWeight: 700 }}>Reporter Email</div>
                  <div style={{ fontWeight: 700, color: '#0f172a' }}>{fullComplaint.reporter_email || '—'}</div>
                </div>

                {/* Audit */}
                <div>
                  <div style={{ fontWeight: 800, marginBottom: 6, color: '#0f172a' }}>Audit</div>
                  <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(2, minmax(240px, 1fr))' }}>
                    <div style={{ color: '#64748b', fontWeight: 700 }}>Approved By</div>
                    <div style={{ fontWeight: 700, color: '#0f172a' }}>{fullComplaint.approved_by || '—'}</div>
                    <div style={{ color: '#64748b', fontWeight: 700 }}>Approved At</div>
                    <div style={{ fontWeight: 700, color: '#0f172a' }}>{fullComplaint.approved_at ? new Date(fullComplaint.approved_at).toLocaleString() : '—'}</div>
                    <div style={{ color: '#64748b', fontWeight: 700 }}>Declined By</div>
                    <div style={{ fontWeight: 700, color: '#0f172a' }}>{fullComplaint.declined_by || '—'}</div>
                    <div style={{ color: '#64748b', fontWeight: 700 }}>Declined At</div>
                    <div style={{ fontWeight: 700, color: '#0f172a' }}>{fullComplaint.declined_at ? new Date(fullComplaint.declined_at).toLocaleString() : '—'}</div>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Full Complaint Image Preview */}
      {fullPreviewImage ? (
        <div
          className="image-overlay"
          onClick={() => setFullPreviewImage(null)}
          role="dialog"
          aria-modal="true"
        >
          <div className="overlay-content" onClick={(e) => e.stopPropagation()}>
            <button className="overlay-close" onClick={() => setFullPreviewImage(null)} aria-label="Close">&times;</button>
            <img src={fullPreviewImage} alt="Evidence Preview" className="overlay-full-img" />
          </div>
        </div>
      ) : null}

      </div>
  );
}
