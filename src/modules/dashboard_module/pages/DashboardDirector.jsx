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

export default function DashboardDirector() {
  const [tab, setTab] = useState('queue'); // queue | mission-orders | history
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [complaints, setComplaints] = useState([]);
  const [missionOrders, setMissionOrders] = useState([]);
  const [search, setSearch] = useState('');

  const [previewImage, setPreviewImage] = useState(null);
  const closePreview = () => setPreviewImage(null);

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
        .select('id, status, created_at, authenticity_level, business_name, business_address, reporter_email, complaint_description, image_urls')
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
      <Header />
      <main className="dash-main">
        <section className="dash-card">
          <div className="dash-header">
            <div>
              <h2 className="dash-title">Director Dashboard</h2>
              <p className="dash-subtitle">Complaint oversight: review submissions and track decision history.</p>
            </div>
            <div className="dash-actions">
              <a className="dash-link" href="/">Back to Home</a>
              <button className="dash-logout" type="button" onClick={handleLogout}>
                Logout
              </button>
            </div>
          </div>

          <div className="dash-tabs">
            <button
              type="button"
              className={`dash-tab ${tab === 'queue' ? 'dash-tab-active' : ''}`}
              onClick={() => setTab('queue')}
            >
              Review Queue
            </button>
            <button
              type="button"
              className={`dash-tab ${tab === 'mission-orders' ? 'dash-tab-active' : ''}`}
              onClick={() => setTab('mission-orders')}
            >
              Review Mission Orders
            </button>
            <button
              type="button"
              className={`dash-tab ${tab === 'history' ? 'dash-tab-active' : ''}`}
              onClick={() => setTab('history')}
            >
              Complaint History
            </button>
          </div>

          <div className="dash-toolbar">
            <input
              className="dash-input"
              type="text"
              placeholder="Search by business name/address, reporter email, or ID..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button className="dash-btn" type="button" onClick={loadComplaints} disabled={loading}>
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>

          {error ? <div className="dash-alert dash-alert-error">{error}</div> : null}

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
                  <tr>
                    <th style={{ width: 90 }}>ID</th>
                    <th>Business</th>
                    <th style={{ width: 240 }}>Status</th>
                    <th style={{ width: 180 }}>Authenticity Level</th>
                    <th style={{ width: 200 }}>Submitted</th>
                    <th style={{ width: 280 }}>Evidence</th>
                    {tab === 'queue' ? <th style={{ width: 220 }}>Actions</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {filteredComplaints.length === 0 ? (
                    <tr>
                      <td colSpan={tab === 'queue' ? 7 : 6} style={{ textAlign: 'center', padding: 18, color: '#475569' }}>
                        {loading ? 'Loading…' : 'No records found.'}
                      </td>
                    </tr>
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
                  )}
                </tbody>
              </table>
            </div>
          )}

          <div className="dash-note">
            Note: Inspection monitoring, audit trails, reports, exports, and printing will be implemented next.
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

      <Footer />
    </div>
  );
}
