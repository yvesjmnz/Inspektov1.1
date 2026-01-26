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
  const [tab, setTab] = useState('queue'); // queue | history
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [complaints, setComplaints] = useState([]);
  const [search, setSearch] = useState('');

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
        .select('*')
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

  useEffect(() => {
    loadComplaints();
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

          <div className="dash-table-wrap">
            <table className="dash-table">
              <thead>
                <tr>
                  <th style={{ width: 90 }}>ID</th>
                  <th>Business</th>
                  <th style={{ width: 240 }}>Status</th>
                  <th style={{ width: 180 }}>Authenticity Level</th>
                  <th style={{ width: 200 }}>Submitted</th>
                  <th style={{ width: 220 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredComplaints.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', padding: 18, color: '#475569' }}>
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
                        {tab === 'queue' ? (
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
                        ) : (
                          <span style={{ color: '#64748b', fontWeight: 700 }}>—</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="dash-note">
            Note: Inspection monitoring, audit trails, reports, exports, and printing will be implemented next.
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
