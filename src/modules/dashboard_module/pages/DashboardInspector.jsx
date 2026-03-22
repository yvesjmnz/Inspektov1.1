import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { normalizeInspectionReportStatus, pickPreferredInspectionReport } from '../../../lib/inspectionReports';
import NotificationBell from '../../../components/NotificationBell';
import MiniRefreshButton from '../components/MiniRefreshButton';
import './Dashboard.css';

function formatStatus(status) {
  if (!status) return 'Unknown';

  const raw = String(status || '').trim();
  const s = raw.toLowerCase();

  // Inspector dashboard is driven purely by inspection_reports.status.
  // Accepted workflow states (in order): Pending Inspection -> In Progress -> Complete
  if (s === 'pending inspection' || s === 'pending_inspection' || s === 'pending') return 'Pending Inspection';
  if (s === 'in progress' || s === 'in_progress') return 'In Progress';
  if (s === 'completed' || s === 'complete') return 'Complete';

  // Fallback formatting
  return raw
    .replace(/_/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function statusBadgeClass(status) {
  const s = String(status || '').toLowerCase();

  // Color coding for inspection report statuses
  if (s === 'pending inspection' || s === 'pending_inspection' || s === 'pending') return 'status-badge status-warning';
  if (s === 'in progress' || s === 'in_progress') return 'status-badge status-info';
  if (s === 'completed' || s === 'complete') return 'status-badge status-success';

  return 'status-badge';
}

export default function DashboardInspector() {
  const getInitialTab = () => {
    const params = new URLSearchParams(window.location.search);
    const tabParam = params.get('tab');
    if (tabParam && ['assigned', 'history'].includes(tabParam)) return tabParam;
    return 'assigned';
  };

  const [tab, setTab] = useState(getInitialTab); // assigned | history
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [userLabel, setUserLabel] = useState('');
  const [assigned, setAssigned] = useState([]);
  const [history, setHistory] = useState([]);
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [currentUserId, setCurrentUserId] = useState(null);

  // Get current user ID for notifications
  useEffect(() => {
    const getCurrentUser = async () => {
      const { data: userData } = await supabase.auth.getUser();
      if (userData?.user?.id) {
        setCurrentUserId(userData.user.id);
      }
    };
    getCurrentUser();
  }, []);

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
        setHistory([]);
        return;
      }

      // 2) Load mission orders for my assignments.
      // IMPORTANT: Do NOT gate this dashboard by mission_orders.status anymore.
      // The inspector dashboard is driven by inspection_reports.status only.
      const { data: moRows, error: moError } = await supabase
        .from('mission_orders')
        .select('id, title, complaint_id, created_at, submitted_at, updated_at, date_of_inspection')
        .in('id', missionOrderIds);

      if (moError) throw moError;

      // Keep the same order as assignments.
      const visibleMissionOrderIds = missionOrderIds;

      if (visibleMissionOrderIds.length === 0) {
        setAssigned([]);
        setHistory([]);
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

      const { data: allAssignmentRows, error: allAssignmentError } = await supabase
        .from('mission_order_assignments')
        .select('mission_order_id, inspector_id, assigned_at')
        .in('mission_order_id', visibleMissionOrderIds)
        .order('assigned_at', { ascending: true });

      if (allAssignmentError) throw allAssignmentError;

      const assignedInspectorIds = Array.from(
        new Set((allAssignmentRows || []).map((row) => row?.inspector_id).filter(Boolean))
      );

      const { data: assignedInspectorProfiles, error: assignedInspectorProfilesError } = assignedInspectorIds.length
        ? await supabase
            .from('profiles')
            .select('id, full_name')
            .in('id', assignedInspectorIds)
        : { data: [], error: null };

      if (assignedInspectorProfilesError) throw assignedInspectorProfilesError;

      const inspectorNameById = new Map(
        (assignedInspectorProfiles || []).map((profile) => [profile.id, profile.full_name])
      );
      const inspectorNamesByMissionOrderId = new Map();
      for (const row of allAssignmentRows || []) {
        const currentMissionOrderId = row?.mission_order_id;
        const inspectorName = inspectorNameById.get(row?.inspector_id);
        if (!currentMissionOrderId || !inspectorName) continue;
        if (!inspectorNamesByMissionOrderId.has(currentMissionOrderId)) {
          inspectorNamesByMissionOrderId.set(currentMissionOrderId, []);
        }
        const names = inspectorNamesByMissionOrderId.get(currentMissionOrderId);
        if (!names.includes(inspectorName)) names.push(inspectorName);
      }

      // Helpers must be defined BEFORE we use them.
      const statusLower = (s) => String(s || '').toLowerCase().trim();

      // Inspection status is only based on inspection_reports.status
      const isCompletedStatus = (s) => {
        const v = statusLower(s);
        return v === 'complete' || v === 'completed';
      };

      // 4) Load inspection report status per mission order, to split Pending vs History.
      // NOTE: There can be multiple reports per mission order (drafts, re-submits). We must choose deterministically.
      const { data: reportRows, error: reportErr } = await supabase
        .from('inspection_reports')
        .select('id, mission_order_id, inspector_id, status, started_at, completed_at, updated_at, created_at')
        .in('mission_order_id', visibleMissionOrderIds)
        .order('updated_at', { ascending: false })
        .limit(500);

      if (reportErr) throw reportErr;

      // Choose the best report per MO: prefer completed; otherwise prefer the most recently touched.
      const reportByMissionOrderId = new Map();
      for (const r of reportRows || []) {
        if (!r?.mission_order_id) continue;
        const key = r.mission_order_id;
        const prev = reportByMissionOrderId.get(key);
        const preferred = pickPreferredInspectionReport([prev, r].filter(Boolean));
        if (preferred) {
          reportByMissionOrderId.set(key, {
            ...preferred,
            resolvedStatus: normalizeInspectionReportStatus(preferred),
          });
        }
      }

      // 5) Merge into a friendly list
      const assignedAtByMissionOrderId = new Map((assignmentRows || []).map((a) => [a.mission_order_id, a.assigned_at]));

      const mergedAll = visibleMissionOrderIds
        .map((id) => {
          const mo = moById.get(id) || {};
          const c = complaintById.get(mo.complaint_id) || {};
          const rep = reportByMissionOrderId.get(id) || {};
          return {
            mission_order_id: id,
            mission_order_title: mo.title,
            mission_order_submitted_at: mo.submitted_at,
            mission_order_updated_at: mo.updated_at,
            date_of_inspection: mo.date_of_inspection,
            assigned_at: assignedAtByMissionOrderId.get(id),
            complaint_id: mo.complaint_id,
            business_name: c.business_name,
            business_address: c.business_address,
            complaint_status: c.status,
            complaint_created_at: c.created_at,
            inspection_report_id: rep.id || null,
            inspection_status: rep.resolvedStatus || 'pending inspection',
            inspection_completed_at: rep.completed_at || null,
            inspector_names: inspectorNamesByMissionOrderId.get(id) || [],
            inspection_owner_id: rep.inspector_id || null,
            inspection_owned_by_current_user: !!rep.inspector_id && rep.inspector_id === userId,
          };
        })
        .sort((a, b) => {
          const tA = a.date_of_inspection ? new Date(a.date_of_inspection).getTime() : 0;
          const tB = b.date_of_inspection ? new Date(b.date_of_inspection).getTime() : 0;
          if (tA && tB) return tA - tB;
          if (tA && !tB) return -1;
          if (!tA && tB) return 1;
          const atA = a.assigned_at ? new Date(a.assigned_at).getTime() : 0;
          const atB = b.assigned_at ? new Date(b.assigned_at).getTime() : 0;
          return atB - atA;
        });

      // Assigned tab should show actionable inspections, including ones not yet started.
      const pendingList = mergedAll.filter(
        (r) => !isCompletedStatus(r.inspection_status)
      );
      const historyList = mergedAll
        .filter((r) => r.inspection_report_id && isCompletedStatus(r.inspection_status))
        .sort((a, b) => {
          const tA = a.inspection_completed_at ? new Date(a.inspection_completed_at).getTime() : 0;
          const tB = b.inspection_completed_at ? new Date(b.inspection_completed_at).getTime() : 0;
          return tB - tA;
        });

      setAssigned(pendingList);
      setHistory(historyList);

      // Auto switch away from Assigned tab if it becomes empty but there is history.
      // This helps UX after submitting an inspection.
      if (tab === 'assigned' && pendingList.length === 0 && historyList.length > 0) {
        setTab('history');
      }
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
    let reportChannel;

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

      reportChannel = supabase
        .channel(`inspector-inspection-reports-global-${userId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'inspection_reports' },
          () => loadAssigned()
        )
        .subscribe();
    })();

    return () => {
      if (channel) {
        try {
          supabase.removeChannel(channel);
        } catch {
          // ignore
        }
      }
      if (reportChannel) {
        try {
          supabase.removeChannel(reportChannel);
        } catch {
          // ignore
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredAssigned = useMemo(() => assigned, [assigned]);

  const filteredHistory = useMemo(() => history, [history]);

  // Group inspection history by day (like Director dashboard)
  const historyByDay = useMemo(() => {
    if (tab !== 'history') return { groups: {}, sortedKeys: [] };

    const groups = {};
    for (const r of filteredHistory) {
      const d = r.inspection_completed_at ? new Date(r.inspection_completed_at) : null;
      const key = d ? new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString().slice(0, 10) : 'unknown';
      if (!groups[key]) {
        const label = d ? d.toLocaleDateString(undefined, { month: 'long', day: 'numeric' }) : 'Unknown Date';
        groups[key] = { label, items: [] };
      }
      groups[key].items.push(r);
    }

    // Sort items within each day by completed_at desc
    for (const key in groups) {
      groups[key].items.sort((a, b) => {
        const timeA = a.inspection_completed_at ? new Date(a.inspection_completed_at).getTime() : 0;
        const timeB = b.inspection_completed_at ? new Date(b.inspection_completed_at).getTime() : 0;
        return timeB - timeA;
      });
    }

    const sortedKeys = Object.keys(groups).sort((a, b) => (a < b ? 1 : -1));
    return { groups, sortedKeys };
  }, [filteredHistory, tab]);

  const handleRefresh = () => {
    loadAssigned();
  };

  return (
    <div className="dash-container">
      <main className="dash-main">
        <section className="dash-shell" style={{ paddingLeft: navCollapsed ? 72 : 240 }}>
          <aside
            className="dash-side"
            title="Menu"
            style={{ width: navCollapsed ? 72 : 240, display: 'flex', flexDirection: 'column', cursor: 'pointer' }}
            onClick={(e) => {
              const t = e.target;
              if (t && typeof t.closest === 'function' && t.closest('.dash-nav-item')) return;
              setNavCollapsed((v) => !v);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                const t = e.target;
                if (t && typeof t.closest === 'function' && t.closest('.dash-nav-item')) return;
                e.preventDefault();
                setNavCollapsed((v) => !v);
              }
            }}
          >
            <div className="dash-side-brand" title="Menu">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 8 }}>
                <img
                  src="/logo.png"
                  alt="City Hall Logo"
                  style={{ width: 44, height: 44, objectFit: 'contain', borderRadius: '50%' }}
                />
              </div>
              <div className="hamburger" aria-hidden="true">
                <div className="hamburger-bar"></div>
                <div className="hamburger-bar"></div>
                <div className="hamburger-bar"></div>
              </div>
            </div>
            <ul className="dash-nav" style={{ flex: 1 }}>
              <li className="dash-nav-section">
                <span className="dash-nav-section-label" style={{ display: navCollapsed ? 'none' : 'inline' }}>Inspection</span>
              </li>
              <li>
                <button
                  type="button"
                  className={`dash-nav-item ${tab === 'assigned' ? 'active' : ''}`}
                  onClick={() => {
                    try {
                      sessionStorage.setItem('inspectionSource', 'inspection');
                    } catch {
                      // ignore
                    }
                    setTab('assigned');
                  }}
                >
                  <span
                    className="dash-nav-ico"
                    aria-hidden="true"
                    style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                  >
                    <img
                      src="/ui_icons/inspection.png"
                      alt=""
                      style={{
                        width: 22,
                        height: 22,
                        objectFit: 'contain',
                        display: 'block',
                        filter:
                          'brightness(0) saturate(100%) invert(62%) sepia(94%) saturate(1456%) hue-rotate(7deg) brightness(88%) contrast(108%)',
                      }}
                    />
                  </span>
                  <span className="dash-nav-label" style={{ display: navCollapsed ? 'none' : 'inline' }}>
                    Inspections
                  </span>
                </button>
              </li>
              <li>
                <button
                  type="button"
                  className={`dash-nav-item ${tab === 'history' ? 'active' : ''}`}
                  onClick={() => {
                    try {
                      sessionStorage.setItem('inspectionSource', 'inspection-history');
                    } catch {
                      // ignore
                    }
                    setTab('history');
                  }}
                >
                  <span
                    className="dash-nav-ico"
                    aria-hidden="true"
                    style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                  >
                    <img
                      src="/ui_icons/history.png"
                      alt=""
                      style={{
                        width: 22,
                        height: 22,
                        objectFit: 'contain',
                        display: 'block',
                        filter:
                          'brightness(0) saturate(100%) invert(62%) sepia(94%) saturate(1456%) hue-rotate(7deg) brightness(88%) contrast(108%)',
                      }}
                    />
                  </span>
                  <span className="dash-nav-label" style={{ display: navCollapsed ? 'none' : 'inline' }}>
                    Inspection History
                  </span>
                </button>
              </li>
            </ul>
            <button
              type="button"
              className="dash-nav-item"
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
                display: 'grid',
                gridTemplateColumns: '24px 1fr',
                alignItems: 'center',
                gap: 10,
              }}
            >
              <span
                className="dash-nav-ico"
                aria-hidden="true"
                style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <img
                  src="/ui_icons/logout.png"
                  alt=""
                  style={{
                    width: 22,
                    height: 22,
                    objectFit: 'contain',
                    display: 'block',
                    filter:
                      'brightness(0) saturate(100%) invert(21%) sepia(97%) saturate(4396%) hue-rotate(346deg) brightness(95%) contrast(101%)',
                  }}
                />
              </span>
              <span className="dash-nav-label" style={{ display: navCollapsed ? 'none' : 'inline' }}>
                Logout
              </span>
            </button>
          </aside>
          <div className="dash-maincol">
            <div className="dash-card">
              <div className="dash-header">
                <div>
                  <div className="dash-title-row">
                    <h2 className="dash-title">Inspector Dashboard</h2>
                    <MiniRefreshButton
                      onClick={handleRefresh}
                      disabled={loading}
                      ariaLabel={tab === 'history' ? 'Refresh inspection history' : 'Refresh assigned inspections'}
                      title={tab === 'history' ? 'Refresh inspection history' : 'Refresh assigned inspections'}
                    />
                  </div>
                  <p className="dash-subtitle">
                    {userLabel ? `Welcome ${userLabel}!` : 'Welcome!'} View your assigned inspections and open full
                    inspection details.
                  </p>
                </div>
                <div className="dash-actions">
                  <NotificationBell userId={currentUserId} />
                </div>
              </div>

              {error ? <div className="dash-alert dash-alert-error">{error}</div> : null}

              <div style={{ display: 'grid', gap: 20 }}>
                {tab === 'assigned' ? (
                  filteredAssigned.length === 0 ? (
                    <div
                      style={{
                        textAlign: 'center',
                        padding: 32,
                        color: '#475569',
                        background: '#f8fafc',
                        borderRadius: 12,
                        border: '1px solid #e2e8f0',
                      }}
                    >
                      {loading ? 'Loading…' : 'No assigned inspections found.'}
                    </div>
                  ) : (
                    <div
                      style={{
                        background: '#ffffff',
                        border: '1px solid #e2e8f0',
                        borderRadius: 14,
                        boxShadow: '0 4px 12px rgba(2,6,23,0.08)',
                        overflow: 'hidden',
                        transition: 'box-shadow 0.2s ease',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.boxShadow = '0 8px 20px rgba(2,6,23,0.12)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.boxShadow = '0 4px 12px rgba(2,6,23,0.08)';
                      }}
                    >
                      {/* Header */}
                      <div style={{ padding: '18px 24px', background: '#0b2249', borderBottom: 'none' }}>
                        <h3 style={{ margin: 0, fontSize: 18, fontWeight: 900, color: '#ffffff' }}>Assigned Inspections</h3>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#F2B705', marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#F2B705', flexShrink: 0 }}></div>
                          <span>{filteredAssigned.length} {filteredAssigned.length === 1 ? 'Inspection' : 'Inspections'}</span>
                        </div>
                      </div>

                      {/* Table */}
                      <div style={{ overflowX: 'auto' }}>
                        <table className="dash-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                          <thead>
                            <tr style={{ background: '#ffffff', borderBottom: '1px solid #e2e8f0' }}>
                              <th style={{ width: 170, padding: '12px', textAlign: 'left', fontWeight: 800, fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>INSPECTION STATUS</th>
                              <th style={{ padding: '12px', textAlign: 'left', fontWeight: 800, fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>BUSINESS & ADDRESS</th>
                              <th style={{ width: 200, padding: '12px', textAlign: 'left', fontWeight: 800, fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>INSPECTION DATE</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filteredAssigned.map((r) => {
                              const today = new Date();
                              const insp = r.date_of_inspection ? new Date(r.date_of_inspection) : null;
                              const isToday =
                                !!insp &&
                                insp.getFullYear() === today.getFullYear() &&
                                insp.getMonth() === today.getMonth() &&
                                insp.getDate() === today.getDate();

                              const href =
                                r.inspection_report_id && r.inspection_owned_by_current_user
                                  ? `/inspection-slip/create?id=${r.inspection_report_id}&missionOrderId=${r.mission_order_id}`
                                  : `/inspection-slip/create?missionOrderId=${r.mission_order_id}`;

                              const statusLower = String(r.inspection_status || '').toLowerCase();
                              const isInProgress = statusLower === 'in progress' || statusLower === 'in_progress';

                              // Determine if this inspection should be treated as "missed"
                              let isMissed = false;
                              if (insp) {
                                const startOfToday = new Date(
                                  today.getFullYear(),
                                  today.getMonth(),
                                  today.getDate()
                                ).getTime();
                                const inspDay = new Date(
                                  insp.getFullYear(),
                                  insp.getMonth(),
                                  insp.getDate()
                                ).getTime();
                                const isPast = inspDay < startOfToday;
                                const isCompleted = statusLower === 'completed' || statusLower === 'complete';
                                if (isPast && !isInProgress && !isCompleted) {
                                  isMissed = true;
                                }
                              }

                              // Row should be clickable only on the scheduled inspection date,
                              // or when an inspection is already in progress.
                              const isRowEnabled = isInProgress || isToday;

                              return (
                                <tr
                                  key={r.mission_order_id}
                                  style={{
                                    cursor: isRowEnabled ? 'pointer' : 'not-allowed',
                                    borderBottom: '1px solid #e2e8f0',
                                    transition: 'background-color 0.2s ease, opacity 0.2s ease',
                                    position: 'relative',
                                    opacity: isRowEnabled ? 1 : 0.45,
                                    filter: isRowEnabled ? 'none' : 'grayscale(0.35)',
                                  }}
                                  title={
                                    isRowEnabled
                                      ? 'Open inspection'
                                      : isMissed
                                        ? 'This inspection has passed its scheduled date and is marked as missed.'
                                        : 'This inspection will be available on its scheduled inspection date.'
                                  }
                                  onClick={() => {
                                    if (!isRowEnabled) return;
                                    try {
                                      sessionStorage.setItem('inspectionSource', 'inspection');
                                    } catch {
                                      // ignore
                                    }
                                    window.location.assign(href);
                                  }}
                                  onMouseEnter={(e) => {
                                    if (!isRowEnabled) return;
                                    e.currentTarget.style.background = '#f8fafc';
                                  }}
                                  onMouseLeave={(e) => {
                                    e.currentTarget.style.background = '#ffffff';
                                  }}
                                >
                                  <td style={{ padding: '12px' }}>
                                    {isMissed ? (
                                      <span
                                        className="status-badge status-danger"
                                        style={{ whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center' }}
                                      >
                                        Missed Inspection
                                      </span>
                                    ) : (
                                      <span
                                        className={statusBadgeClass(r.inspection_status)}
                                        style={{ whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center' }}
                                      >
                                        {formatStatus(r.inspection_status)}
                                      </span>
                                    )}
                                  </td>
                                  <td style={{ padding: '12px' }}>
                                    <div className="dash-cell-title">{r.business_name || '—'}</div>
                                    <div className="dash-cell-sub">{r.business_address || ''}</div>
                                  </td>
                                  <td style={{ padding: '12px', fontSize: 14, color: '#1e293b' }}>
                                    {r.date_of_inspection ? new Date(r.date_of_inspection).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }) : '—'}
                                  </td>
                                                                  </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )
                ) : tab === 'history' ? (
                  historyByDay.sortedKeys.length === 0 ? (
                    <div
                      style={{
                        textAlign: 'center',
                        padding: 32,
                        color: '#475569',
                        background: '#f8fafc',
                        borderRadius: 12,
                        border: '1px solid #e2e8f0',
                      }}
                    >
                      {loading ? 'Loading…' : 'No inspection history found.'}
                    </div>
                  ) : (
                    historyByDay.sortedKeys.map((dayKey) => {
                      const dayGroup = historyByDay.groups[dayKey];
                      const label = dayGroup?.label || dayKey;
                      const itemCount = dayGroup?.items?.length || 0;
                      if (itemCount === 0) return null;

                      return (
                        <div
                          key={`day-card-${dayKey}`}
                          style={{
                            background: '#ffffff',
                            border: '1px solid #e2e8f0',
                            borderRadius: 14,
                            boxShadow: '0 4px 12px rgba(2,6,23,0.08)',
                            overflow: 'hidden',
                            transition: 'box-shadow 0.2s ease',
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.boxShadow = '0 8px 20px rgba(2,6,23,0.12)';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.boxShadow = '0 4px 12px rgba(2,6,23,0.08)';
                          }}
                        >
                          {/* Day Header */}
                          <div style={{ padding: '18px 24px', background: '#0b2249', borderBottom: 'none' }}>
                            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 900, color: '#ffffff' }}>
                              {label}{dayKey !== 'unknown' ? `, ${new Date(dayKey).getFullYear()}` : ''}
                            </h3>
                            <div style={{ fontSize: 13, fontWeight: 600, color: '#22c55e', marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
                              <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#22c55e', flexShrink: 0 }}></div>
                              <span>
                                {itemCount} Completed Inspection{itemCount === 1 ? '' : 's'}
                              </span>
                            </div>
                          </div>

                          {/* Table for this day */}
                          <div style={{ overflowX: 'auto' }}>
                            <table className="dash-table" style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                              <thead>
                                <tr style={{ background: '#ffffff', borderBottom: '1px solid #e2e8f0' }}>
                                  <th style={{ width: 170, padding: '12px', textAlign: 'left', fontWeight: 800, fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>INSPECTION STATUS</th>
                                  <th style={{ width: '100%', padding: '12px', textAlign: 'left', fontWeight: 800, fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>BUSINESS & ADDRESS</th>
                                  <th style={{ width: 210, padding: '12px', textAlign: 'left', fontWeight: 800, fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>INSPECTION DATE</th>
                                  <th style={{ width: 220, padding: '12px', textAlign: 'left', fontWeight: 800, fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>INSPECTORS</th>
                                </tr>
                              </thead>
                              <tbody>
                                {dayGroup.items.map((r) => (
                                  <tr
                                    key={`hist-${r.mission_order_id}`}
                                    style={{
                                      borderBottom: '1px solid #e2e8f0',
                                      cursor: 'pointer',
                                      transition: 'background-color 0.2s ease',
                                    }}
                                    title="View inspection summary"
                                    onClick={() => {
                                      try {
                                        sessionStorage.setItem('inspectionSource', 'inspection-history');
                                      } catch {
                                        // ignore
                                      }
                                      window.location.assign(
                                        r.inspection_report_id
                                          ? `/inspection-slip/create?id=${r.inspection_report_id}&missionOrderId=${r.mission_order_id}`
                                          : `/inspection-slip/create?missionOrderId=${r.mission_order_id}`
                                      );
                                    }}
                                    onMouseEnter={(e) => {
                                      e.currentTarget.style.background = '#f8fafc';
                                    }}
                                    onMouseLeave={(e) => {
                                      e.currentTarget.style.background = '#ffffff';
                                    }}
                                  >
                                    <td style={{ padding: '12px' }}>
                                      <span className={statusBadgeClass(r.inspection_status)} style={{ whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center' }}>
                                        {formatStatus(r.inspection_status)}
                                      </span>
                                    </td>
                                    <td style={{ padding: '12px' }}>
                                      <div className="dash-cell-title">{r.business_name || '—'}</div>
                                      <div className="dash-cell-sub">{r.business_address || ''}</div>
                                    </td>
                                    <td style={{ padding: '12px', fontSize: 14, color: '#1e293b' }}>
                                      {r.date_of_inspection ? new Date(r.date_of_inspection).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }) : '—'}
                                    </td>
                                    <td style={{ padding: '12px' }}>
                                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8, minHeight: 30, fontSize: 12 }}>
                                        {(r.inspector_names || []).length === 0 ? (
                                          <span style={{ color: '#64748b', fontWeight: 700 }}>â€”</span>
                                        ) : (
                                          (r.inspector_names || []).map((name, idx) => (
                                            <span
                                              key={`${r.mission_order_id || r.inspection_report_id}-${idx}`}
                                              style={{ padding: '4px 8px', borderRadius: 999, fontWeight: 700, border: '1px solid #e2e8f0', background: '#f8fafc', fontSize: 11 }}
                                              onClick={(e) => e.stopPropagation()}
                                            >
                                              {name}
                                            </span>
                                          ))
                                        )}
                                      </div>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      );
                    })
                  )
                ) : null}
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}



