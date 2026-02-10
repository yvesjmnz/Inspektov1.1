import { useEffect, useMemo, useState } from 'react';
import Header from '../../../components/Header';
import Footer from '../../../components/Footer';
import { supabase } from '../../../lib/supabase';
import './Dashboard.css';

function formatStatus(status) {
  if (!status) return 'Unknown';
  const s = String(status || '').toLowerCase();
  // MO status rename: completed -> for inspection
  if (s === 'completed' || s === 'for_inspection' || s === 'for inspection') return 'For Inspection';

  return String(status)
    .replace(/_/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function statusBadgeClass(status) {
  const s = String(status || '').toLowerCase();
  if (['completed', 'approved'].includes(s)) return 'status-badge status-success';
  if (['cancelled', 'declined', 'rejected', 'invalid'].includes(s)) return 'status-badge status-danger';
  if (['issued', 'submitted', 'pending', 'new'].includes(s)) return 'status-badge status-warning';
  if (['on hold', 'on_hold', 'hold'].includes(s)) return 'status-badge status-info';
  return 'status-badge';
}

export default function DashboardInspector() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  const [userLabel, setUserLabel] = useState('');
  const [assigned, setAssigned] = useState([]);

  const handleLogout = async () => {
    setError('');
    try {
      await supabase.auth.signOut({ scope: 'global' });
    } catch (e) {
      setError(e?.message || 'Logout failed. Clearing local session…');
    } finally {
      try {
        localStorage.clear();
        sessionStorage.clear();
      } catch {
        // ignore
      }
      window.location.replace('/login');
    }
  };

  const loadAssigned = async () => {
    setLoading(true);
    setError('');

    try {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      const user = userData?.user || null;
      const userId = user?.id;
      if (!userId) throw new Error('Not authenticated. Please login again.');

      // Friendly "Welcome" label: prefer the inspector's name from profiles.
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('full_name, first_name, middle_name, last_name')
        .eq('id', userId)
        .single();

      // If RLS blocks profiles, or the name fields are empty, fall back to auth metadata.
      const meta = user?.user_metadata || {};
      const appMeta = user?.app_metadata || {};

      const profileName =
        profile?.full_name ||
        [profile?.first_name, profile?.middle_name, profile?.last_name].filter(Boolean).join(' ');

      const fallbackName = meta.full_name || meta.name || meta.first_name || appMeta.full_name || String(userId).slice(0, 8);

      // Ignore profileError here (dashboard should still load); just use fallbacks.
      void profileError;

      setUserLabel(String(profileName || fallbackName));

      // 1) Find mission orders assigned to me.
      const { data: assignmentRows, error: assignmentError } = await supabase
        .from('mission_order_assignments')
        .select('mission_order_id, assigned_at')
        .eq('inspector_id', userId)
        .order('assigned_at', { ascending: false })
        .limit(200);

      if (assignmentError) throw assignmentError;

      const missionOrderIds = Array.from(new Set((assignmentRows || []).map((a) => a?.mission_order_id).filter(Boolean)));
      if (missionOrderIds.length === 0) {
        setAssigned([]);
        return;
      }

      // 2) Load mission orders (only those that are "for inspection")
      // DB values can be inconsistent across environments; include common variants.
      const { data: moRows, error: moError } = await supabase
        .from('mission_orders')
        .select('id, title, status, complaint_id, created_at, submitted_at, updated_at')
        .in('id', missionOrderIds)
        .in('status', ['for inspection', 'for_inspection', 'For Inspection']);

      if (moError) throw moError;

      // Keep the same order as assignments, but drop any mission orders not matching the status filter.
      const filteredMissionOrderIds = new Set((moRows || []).map((m) => m?.id).filter(Boolean));
      const visibleMissionOrderIds = missionOrderIds.filter((id) => filteredMissionOrderIds.has(id));

      if (visibleMissionOrderIds.length === 0) {
        setAssigned([]);
        return;
      }

      const moById = new Map((moRows || []).map((m) => [m.id, m]));

      // 3) Load complaints for business info
      const complaintIds = Array.from(new Set((moRows || []).map((m) => m?.complaint_id).filter(Boolean)));

      const { data: complaintRows, error: complaintError } = complaintIds.length
        ? await supabase
            .from('complaints')
            .select('id, business_name, business_address, status, created_at')
            .in('id', complaintIds)
        : { data: [], error: null };

      if (complaintError) throw complaintError;

      const complaintById = new Map((complaintRows || []).map((c) => [c.id, c]));

      // 4) Merge into a friendly list
      const assignedAtByMissionOrderId = new Map((assignmentRows || []).map((a) => [a.mission_order_id, a.assigned_at]));

      const merged = visibleMissionOrderIds
        .map((id) => {
          const mo = moById.get(id) || {};
          const c = complaintById.get(mo.complaint_id) || {};
          return {
            mission_order_id: id,
            mission_order_title: mo.title,
            mission_order_status: mo.status,
            mission_order_submitted_at: mo.submitted_at,
            mission_order_updated_at: mo.updated_at,
            assigned_at: assignedAtByMissionOrderId.get(id),
            complaint_id: mo.complaint_id,
            business_name: c.business_name,
            business_address: c.business_address,
            complaint_status: c.status,
            complaint_created_at: c.created_at,
          };
        })
        .sort((a, b) => {
          const atA = a.assigned_at ? new Date(a.assigned_at).getTime() : 0;
          const atB = b.assigned_at ? new Date(b.assigned_at).getTime() : 0;
          return atB - atA;
        });

      setAssigned(merged);
    } catch (e) {
      setError(e?.message || 'Failed to load assigned inspections.');
      setAssigned([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAssigned();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Realtime: if assignments change for this inspector, refresh list.
  useEffect(() => {
    let channel;

    (async () => {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData?.user?.id;
      if (!userId) return;

      channel = supabase
        .channel(`inspector-assignments-${userId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'mission_order_assignments', filter: `inspector_id=eq.${userId}` },
          () => loadAssigned()
        )
        .subscribe();
    })();

    return () => {
      if (!channel) return;
      try {
        supabase.removeChannel(channel);
      } catch {
        // ignore
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredAssigned = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return assigned;

    return assigned.filter((r) => {
      const hay = [r.business_name, r.business_address, r.complaint_id, r.mission_order_id, r.mission_order_title]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [assigned, search]);

  return (
    <div className="dash-container">
      <Header />
      <main className="dash-main">
        <section className="dash-card">
          <div className="dash-header">
            <div>
              <h2 className="dash-title">Inspector Dashboard</h2>
              <p className="dash-subtitle">{userLabel ? `Welcome ${userLabel}!` : 'Welcome!'} View your assigned inspections and open full inspection details.</p>
            </div>
            <div className="dash-actions">
              <a className="dash-link" href="/">Back to Home</a>
              <button className="dash-logout" type="button" onClick={handleLogout} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <img src="/ui_icons/logout.png" alt="" style={{ width: 18, height: 18, display: 'block', filter: 'brightness(0) invert(1)' }} />
                Logout
              </button>
            </div>
          </div>

          <div className="dash-toolbar">
            <input
              className="dash-input"
              type="text"
              placeholder="Search by business name/address, complaint ID, or mission order ID..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button className="dash-btn" type="button" onClick={loadAssigned} disabled={loading}>
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>

          {error ? <div className="dash-alert dash-alert-error">{error}</div> : null}

          <div className="dash-table-wrap">
            <table className="dash-table">
              <thead>
                <tr>
                  <th style={{ width: 110 }}>MO ID</th>
                  <th>Business</th>
                  <th style={{ width: 160 }}>MO Status</th>
                  <th style={{ width: 200 }}>Assigned</th>
                  <th style={{ width: 200 }}>Updated</th>
                  <th style={{ width: 180 }}>Details</th>
                </tr>
              </thead>
              <tbody>
                {filteredAssigned.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', padding: 18, color: '#475569' }}>
                      {loading ? 'Loading…' : 'No assigned inspections found.'}
                    </td>
                  </tr>
                ) : (
                  filteredAssigned.map((r) => (
                    <tr key={r.mission_order_id}>
                      <td title={r.mission_order_id}>{String(r.mission_order_id).slice(0, 8)}…</td>
                      <td>
                        <div className="dash-cell-title">{r.business_name || '—'}</div>
                        <div className="dash-cell-sub">{r.business_address || ''}</div>
                        <div className="dash-cell-sub">Complaint: {r.complaint_id ? String(r.complaint_id).slice(0, 8) + '…' : '—'}</div>
                      </td>
                      <td>
                        <span className={statusBadgeClass(r.mission_order_status)}>{formatStatus(r.mission_order_status)}</span>
                      </td>
                      <td>{r.assigned_at ? new Date(r.assigned_at).toLocaleString() : '—'}</td>
                      <td>{r.mission_order_updated_at ? new Date(r.mission_order_updated_at).toLocaleString() : '—'}</td>
                      <td>
                        <a className="dash-link" href={`/dashboard/inspector/inspection?id=${r.mission_order_id}`}>
                          Open
                        </a>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="dash-note">
            “Open” shows the mission order (read-only), business details, and a map preview based on the business address.
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
