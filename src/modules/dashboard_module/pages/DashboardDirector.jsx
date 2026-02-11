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
  const [tab, setTab] = useState('general'); // general | queue | mission-orders | history
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const pageMeta = useMemo(() => {
    const meta = {
      general: {
        title: 'Director Dashboard',
        subtitle: 'Complaint oversight: today\'s activity, pending reviews, and recent trends.',
      },
      queue: {
        title: 'Review Queue',
        subtitle: 'Review new submissions and make approval/decline decisions.',
      },
      history: {
        title: 'Complaint History',
        subtitle: 'Browse past decisions and view audit details.',
      },
      'mission-orders': {
        title: 'Review Mission Orders',
        subtitle: 'Review and action mission orders issued for director approval.',
      },
    };

    return meta[tab] || meta.general;
  }, [tab]);

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
  const [evidenceIndex, setEvidenceIndex] = useState(0);
  // Complaint History date filters
  const [historyYear, setHistoryYear] = useState('all');
  const [historyMonth, setHistoryMonth] = useState('all');
  const [historyDay, setHistoryDay] = useState('all');
  // Resolved labels for audit drawer (emails or names)
  const [auditApproverLabel, setAuditApproverLabel] = useState('');
  const [auditDeclinerLabel, setAuditDeclinerLabel] = useState('');

  // Decline comment (required for declines)
  const [declineComment, setDeclineComment] = useState('');
  const [declineCommentError, setDeclineCommentError] = useState('');

  const [previewImage, setPreviewImage] = useState(null);
  const closePreview = () => setPreviewImage(null);
  const [navCollapsed, setNavCollapsed] = useState(false);
  const currentYear = new Date().getFullYear();

  const handleLogout = async () => {
    setError('');
    try {
      // Use global sign-out to revoke refresh tokens across tabs/devices.
      const { error: signOutError } = await supabase.auth.signOut({ scope: 'global' });
      if (signOutError) throw signOutError;
    } catch (e) {
      // Even if remote sign-out fails, clear local state and navigate away.
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
      } else if (tab === 'history') {
        // History: approved/declined/rejected
        query = query.in('status', [
          'Approved',
          'Declined',
          'Rejected',
          'approved',
          'declined',
          'rejected',
        ]);
        // Apply created_at date range for Complaint History if filters are set
        try {
          const y = historyYear !== 'all' ? Number(historyYear) : null;
          const m = historyMonth !== 'all' ? Number(historyMonth) : null; // 1-12
          const d = historyDay !== 'all' ? Number(historyDay) : null; // 1-31
          let start = null;
          let end = null;
          if (y && !m && !d) {
            start = new Date(y, 0, 1);
            end = new Date(y + 1, 0, 1);
          } else if (y && m && !d) {
            start = new Date(y, m - 1, 1);
            end = new Date(y, m, 1);
          } else if (y && m && d) {
            start = new Date(y, m - 1, d);
            end = new Date(y, m - 1, d + 1);
          }
          if (start && end) {
            query = query.gte('created_at', start.toISOString()).lt('created_at', end.toISOString());
          }
        } catch (_) {
          // ignore invalid date ranges
        }
      } else {
        // General or other: no status filter (fetch recent mix for KPIs)
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
    } else if (tab === 'general') {
      // Load both datasets for the overview
      loadComplaints();
      loadMissionOrders();
    } else {
      loadComplaints();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // Reload history when any date filter changes
  useEffect(() => {
    if (tab === 'history') {
      loadComplaints();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyYear, historyMonth, historyDay]);

  // Resolve approver/decliner labels (email/name) for audit drawer
  useEffect(() => {
    const fallbackShort = (id) => (id ? String(id).slice(0, 8) + '…' : '—');
    const displayNameFromProfile = (p, fallbackId) =>
      p?.full_name || [p?.first_name, p?.middle_name, p?.last_name].filter(Boolean).join(' ') || fallbackShort(fallbackId);

    const resolveLabels = async () => {
      try {
        const tasks = [];
        if (auditComplaint?.approved_by) {
          tasks.push(
            supabase
              .from('profiles')
              .select('id, full_name, first_name, middle_name, last_name')
              .eq('id', auditComplaint.approved_by)
              .single()
              .then(({ data }) => setAuditApproverLabel(displayNameFromProfile(data, auditComplaint.approved_by)))
              .catch(() => setAuditApproverLabel(fallbackShort(auditComplaint.approved_by)))
          );
        } else {
          setAuditApproverLabel('—');
        }
        if (auditComplaint?.declined_by) {
          tasks.push(
            supabase
              .from('profiles')
              .select('id, full_name, first_name, middle_name, last_name')
              .eq('id', auditComplaint.declined_by)
              .single()
              .then(({ data }) => setAuditDeclinerLabel(displayNameFromProfile(data, auditComplaint.declined_by)))
              .catch(() => setAuditDeclinerLabel(fallbackShort(auditComplaint.declined_by)))
          );
        } else {
          setAuditDeclinerLabel('—');
        }
        await Promise.all(tasks);
      } catch (_) {
        setAuditApproverLabel(auditComplaint?.approved_by ? fallbackShort(auditComplaint.approved_by) : '—');
        setAuditDeclinerLabel(auditComplaint?.declined_by ? fallbackShort(auditComplaint.declined_by) : '—');
      }
    };
    if (auditComplaint) {
      setAuditApproverLabel('');
      setAuditDeclinerLabel('');
      resolveLabels();
    } else {
      setAuditApproverLabel('');
      setAuditDeclinerLabel('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auditComplaint]);

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
    // Group by day for both queue and history tabs
    if (tab === 'mission-orders') return { groups: {}, sortedKeys: [] };
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

  const handleRefresh = () => {
    if (tab === 'mission-orders') {
      loadMissionOrders();
    } else if (tab === 'general') {
      loadComplaints();
      loadMissionOrders();
    } else {
      loadComplaints();
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
      setEvidenceIndex(0);
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
    setEvidenceIndex(0);
  };
  
  // Summary KPIs (client-side only)
  const summary = useMemo(() => {
    if (tab === 'mission-orders') {
      const total = filteredMissionOrders.length;
      const issued = filteredMissionOrders.filter((x) => String(x.status || '').toLowerCase() === 'issued').length;
      const forInspection = filteredMissionOrders.filter((x) => String(x.status || '').toLowerCase() === 'for inspection').length;
      const cancelled = filteredMissionOrders.filter((x) => String(x.status || '').toLowerCase() === 'cancelled').length;
      return { total, issued, forInspection, cancelled };
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

  const generalSummary = useMemo(() => {
    const today = new Date();
    const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
    const sLower = (s) => String(s || '').toLowerCase();
    const inReview = ['submitted', 'pending', 'new'];

    const isToday = (iso) => {
      if (!iso) return false;
      const t = new Date(iso).getTime();
      return t >= startOfDay.getTime() && t < endOfDay.getTime();
    };

    const newToday = (complaints || []).filter(c => inReview.includes(sLower(c.status)) && isToday(c.created_at)).length;
    const pendingReview = (complaints || []).filter(c => inReview.includes(sLower(c.status))).length;
    const approvedToday = (complaints || []).filter(c => sLower(c.status) === 'approved' && isToday(c.approved_at)).length;
    const declinedToday = (complaints || []).filter(c => sLower(c.status) === 'declined' && isToday(c.declined_at)).length;

    const moIssued = (missionOrders || []).filter(m => sLower(m.status) === 'issued').length;

    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
      const next = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i + 1);
      const cnt = (complaints || []).filter(c => {
        const t = c.created_at ? new Date(c.created_at).getTime() : null;
        return t && t >= d.getTime() && t < next.getTime();
      }).length;
      days.push({ label: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), count: cnt });
    }
    const max = days.reduce((m, x) => Math.max(m, x.count), 0) || 1;

    return { newToday, pendingReview, approvedToday, declinedToday, moIssued, days, max };
  }, [complaints, missionOrders]);

  const updateComplaintStatus = async (complaintId, newStatus) => {
    setError('');
    setDeclineCommentError('');
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

      // Enforce required rationale for declines (industry-standard: capture reason for adverse decision)
      if (status === 'declined') {
        const comment = declineComment.trim();
        if (!comment) {
          setDeclineCommentError('Comment is required to decline a complaint.');
          throw new Error('Comment is required to decline a complaint.');
        }
      }

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
        // clear any previous decline comment
        patch.decline_comment = null;
      } else if (status === 'declined') {
        patch.declined_by = user.id;
        patch.declined_at = nowIso;
        // clear approve columns if previously approved
        patch.approved_by = null;
        patch.approved_at = null;
        // store decline rationale
        patch.decline_comment = declineComment.trim();
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
      // Keep the open full complaint view in sync
      if (fullViewId === complaintId) {
        setFullComplaint((prev) => (prev ? { ...prev, ...patch } : prev));
      }

      if (status === 'declined') {
        setDeclineComment('');
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
                <img src="/logo.png" alt="City Hall Logo" style={{ width: 44, height: 44, objectFit: 'contain', borderRadius: '50%' }} />
              </div>
              <div className="hamburger" aria-hidden="true">
                <div className="hamburger-bar"></div>
                <div className="hamburger-bar"></div>
                <div className="hamburger-bar"></div>
              </div>
            </div>
            <ul className="dash-nav" style={{ flex: 1 }}>
              <li>
                <button type="button" className={`dash-nav-item ${tab === 'general' ? 'active' : ''}`} onClick={() => setTab('general')}>
                  <span className="dash-nav-ico" aria-hidden="true" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                    <img src="/ui_icons/menu.png" alt="" style={{ width: 22, height: 22, objectFit: 'contain', display: 'block', filter: 'brightness(0) saturate(100%) invert(62%) sepia(94%) saturate(1456%) hue-rotate(7deg) brightness(88%) contrast(108%)' }} />
                  </span>
                  <span className="dash-nav-label" style={{ display: navCollapsed ? 'none' : 'inline' }}>Dashboard</span>
                </button>
              </li>
              <li className="dash-nav-section">
                <span className="dash-nav-section-label" style={{ display: navCollapsed ? 'none' : 'inline' }}>Complaints</span>
              </li>
              <li>
                <button type="button" className={`dash-nav-item ${tab === 'queue' ? 'active' : ''}`} onClick={() => setTab('queue')}>
                  <span className="dash-nav-ico" aria-hidden="true" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                    <img src="/ui_icons/queue.png" alt="" style={{ width: 26, height: 26, objectFit: 'contain', display: 'block', filter: 'brightness(0) saturate(100%) invert(62%) sepia(94%) saturate(1456%) hue-rotate(7deg) brightness(88%) contrast(108%)' }} />
                  </span>
                  <span className="dash-nav-label" style={{ display: navCollapsed ? 'none' : 'inline' }}>Review Queue</span>
                </button>
              </li>
              <li>
                <button type="button" className={`dash-nav-item ${tab === 'history' ? 'active' : ''}`} onClick={() => setTab('history')}>
                  <span className="dash-nav-ico" aria-hidden="true" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                    <img src="/ui_icons/history.png" alt="" style={{ width: 22, height: 22, objectFit: 'contain', display: 'block', filter: 'brightness(0) saturate(100%) invert(62%) sepia(94%) saturate(1456%) hue-rotate(7deg) brightness(88%) contrast(108%)' }} />
                  </span>
                  <span className="dash-nav-label" style={{ display: navCollapsed ? 'none' : 'inline' }}>Complaint History</span>
                </button>
              </li>
              <li className="dash-nav-section">
                <span className="dash-nav-section-label" style={{ display: navCollapsed ? 'none' : 'inline' }}>Mission Orders</span>
              </li>
              <li>
                <button type="button" className={`dash-nav-item ${tab === 'mission-orders' ? 'active' : ''}`} onClick={() => setTab('mission-orders')}>
                  <span className="dash-nav-ico" aria-hidden="true" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                    <img src="/ui_icons/mo.png" alt="" style={{ width: 22, height: 22, objectFit: 'contain', display: 'block', filter: 'brightness(0) saturate(100%) invert(62%) sepia(94%) saturate(1456%) hue-rotate(7deg) brightness(88%) contrast(108%)' }} />
                  </span>
                  <span className="dash-nav-label" style={{ display: navCollapsed ? 'none' : 'inline' }}>Review Mission Orders</span>
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
              <span className="dash-nav-ico" aria-hidden="true" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                <img src="/ui_icons/logout.png" alt="" style={{ width: 22, height: 22, objectFit: 'contain', display: 'block', filter: 'brightness(0) saturate(100%) invert(21%) sepia(97%) saturate(4396%) hue-rotate(346deg) brightness(95%) contrast(101%)' }} />
              </span>
              <span className="dash-nav-label" style={{ display: navCollapsed ? 'none' : 'inline' }}>Logout</span>
            </button>
          </aside>
          <div className="dash-maincol">
            <div className="dash-card">
          <div className="dash-header">
            <div>
              <h2 className="dash-title">{pageMeta.title}</h2>
              <p className="dash-subtitle">{pageMeta.subtitle}</p>
            </div>
            <div className="dash-actions"></div>
          </div>

          {null}

          <div className="dash-toolbar">
          {tab === 'history' ? (
          <>
          <select className="dash-select" value={historyYear} onChange={(e) => setHistoryYear(e.target.value)}>
          <option value="all">All Years</option>
          {Array.from({ length: 6 }, (_, i) => currentYear - i).map((y) => (
          <option key={y} value={String(y)}>{y}</option>
          ))}
          </select>
          <select className="dash-select" value={historyMonth} onChange={(e) => setHistoryMonth(e.target.value)}>
          <option value="all">All Months</option>
          <option value="1">Jan</option>
          <option value="2">Feb</option>
          <option value="3">Mar</option>
          <option value="4">Apr</option>
          <option value="5">May</option>
          <option value="6">Jun</option>
          <option value="7">Jul</option>
          <option value="8">Aug</option>
          <option value="9">Sep</option>
          <option value="10">Oct</option>
          <option value="11">Nov</option>
          <option value="12">Dec</option>
          </select>
          <select className="dash-select" value={historyDay} onChange={(e) => setHistoryDay(e.target.value)}>
          <option value="all">All Days</option>
          {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
          <option key={d} value={String(d)}>{d}</option>
          ))}
          </select>
          </>
          ) : null}
          <input
          className="dash-input"
          type="text"
          placeholder="Search by business name/address, reporter email, or ID..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          />
          <button className="dash-btn" type="button" onClick={handleRefresh} disabled={loading}>
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
                Orders: {summary.total} • Issued: {summary.issued} • For Inspection: {summary.forInspection} • Cancelled: {summary.cancelled} • Avg Inspection Duration: —
              </span>
            ) : (
              <span>
                Complaints: {summary.total} • Approved: {summary.approved} • Declined: {summary.declined} • Pending: {summary.pending}
                {summary.avgDecisionHours ? ` • Avg decision time: ${summary.avgDecisionHours}h` : ''}
              </span>
            )}
          </div>

          {tab === 'general' ? (
            <div className="dash-grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
              <div className="dash-tile">
                <h3>Today's New Complaints</h3>
                <div style={{ fontSize: 28, fontWeight: 900, color: '#0f172a' }}>{generalSummary.newToday}</div>
                <div className="dash-cell-sub">Submitted/Pending/New created today</div>
              </div>
              <div className="dash-tile">
                <h3>Pending Review</h3>
                <div style={{ fontSize: 28, fontWeight: 900, color: '#0f172a' }}>{generalSummary.pendingReview}</div>
                <div className="dash-cell-sub">In Review Queue</div>
              </div>
              <div className="dash-tile">
                <h3>Approved Today</h3>
                <div style={{ fontSize: 28, fontWeight: 900, color: '#0f172a' }}>{generalSummary.approvedToday}</div>
                <div className="dash-cell-sub">Decisions made today</div>
              </div>
              <div className="dash-tile">
                <h3>Declined Today</h3>
                <div style={{ fontSize: 28, fontWeight: 900, color: '#0f172a' }}>{generalSummary.declinedToday}</div>
                <div className="dash-cell-sub">Decisions made today</div>
              </div>
              <div className="dash-tile">
                <h3>Issued Mission Orders</h3>
                <div style={{ fontSize: 28, fontWeight: 900, color: '#0f172a' }}>{generalSummary.moIssued}</div>
                <div className="dash-cell-sub">Awaiting Director review</div>
              </div>
              <div className="dash-tile" style={{ gridColumn: 'span 3' }}>
                <h3 style={{ marginBottom: 10 }}>Complaints Submitted – Last 7 Days</h3>
                <div style={{ display: 'grid', gap: 8 }}>
                  {generalSummary.days.map((d) => (
                    <div key={d.label} style={{ display: 'grid', gridTemplateColumns: '110px 1fr 40px', alignItems: 'center', gap: 10 }}>
                      <div className="dash-cell-sub" style={{ fontWeight: 800 }}>{d.label}</div>
                      <div style={{ background: '#e2e8f0', borderRadius: 999, height: 12, position: 'relative' }}>
                        <div style={{ position: 'absolute', top: 0, left: 0, height: '100%', width: `${Math.round((d.count / (generalSummary.max || 1)) * 100)}%`, background: '#2563eb', borderRadius: 999 }}></div>
                      </div>
                      <div style={{ fontWeight: 900, color: '#0f172a', textAlign: 'right' }}>{d.count}</div>
                    </div>
                  ))}
                </div>
              </div>
                          </div>
          ) : tab === 'mission-orders' ? (
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
                              <td colSpan={4} style={{ fontWeight: 800, color: '#0f172a', background: '#f8fafc' }}>{label}</td>
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
                                                              </tr>
                            );
                          });
                          return rows;
                        })
                      ) : (
                        complaintsByDay.sortedKeys.flatMap((dayKey) => {
                          const rows = [];
                          const label = complaintsByDay.groups[dayKey]?.label || dayKey;
                          rows.push(
                            <tr key={`dayh-${dayKey}`}>
                              <td colSpan={7} style={{ fontWeight: 800, color: '#0f172a', background: '#f8fafc' }}>{label}</td>
                            </tr>
                          );
                          complaintsByDay.groups[dayKey].items.forEach((c) => {
                            rows.push(
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
                                      const label = c.approved_by ? String(c.approved_by).slice(0, 8) + '…' : '��';
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
                            );
                          });
                          return rows;
                        })
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

      {/* Audit Drawer (right-side, same pattern as full complaint) */}
      {auditComplaint ? (
        <div style={{
          position: 'fixed',
          top: 0,
          right: 0,
          height: '100vh',
          width: 'min(680px, 92vw)',
          background: '#ffffff',
          borderLeft: '1px solid #e2e8f0',
          boxShadow: '-12px 0 28px rgba(0,0,0,0.25)',
          display: 'flex',
          flexDirection: 'column',
          zIndex: 60
        }}>
          <button
            className="overlay-close"
            onClick={() => setAuditComplaint(null)}
            aria-label="Close"
            style={{ position: 'absolute', top: 8, right: 8, color: '#ef4444', background: 'transparent', border: 'none', padding: 0, fontSize: 28, lineHeight: 1, cursor: 'pointer' }}
          >
            &times;
          </button>
          <div style={{ padding: 16, borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h3 style={{ margin: 0 }}>Complaint Audit</h3>
          </div>
          <div style={{ padding: 16, overflowY: 'auto', background: '#f8fafc', display: 'grid', gap: 16 }}>
            {/* Summary Card */}
            <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 16, boxShadow: '0 2px 10px rgba(2,6,23,0.06)', padding: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ fontSize: 18, fontWeight: 900, color: '#0f172a' }}>{auditComplaint.business_name || '—'}</div>
                <span className={statusBadgeClass(auditComplaint.status)}>{formatStatus(auditComplaint.status)}</span>
              </div>
              <div style={{ color: '#334155', marginTop: 8, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <span aria-hidden>📍</span>
                <span style={{ fontWeight: 700 }}>{auditComplaint.business_address || '—'}</span>
              </div>
              <div style={{ height: 1, background: '#dbeafe', margin: '12px 0' }} />
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(220px, 1fr))', gap: 12 }}>
                <div>
                  <div style={{ color: '#64748b', fontWeight: 800, fontSize: 12 }}>ID</div>
                  <div style={{ color: '#0f172a', fontWeight: 800 }}>{auditComplaint.id}</div>
                </div>
                <div>
                  <div style={{ color: '#64748b', fontWeight: 800, fontSize: 12 }}>Submitted</div>
                  <div style={{ color: '#0f172a', fontWeight: 800 }}>{auditComplaint.created_at ? new Date(auditComplaint.created_at).toLocaleString() : '—'}</div>
                </div>
              </div>
            </div>

            {/* Decision Card */}
            <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 16, boxShadow: '0 2px 10px rgba(2,6,23,0.06)', padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <div style={{ fontWeight: 900, color: '#0f172a' }}>Decision</div>
              </div>
              {(() => {
                const s = String(auditComplaint.status || '').toLowerCase();
                const created = auditComplaint.created_at ? new Date(auditComplaint.created_at) : null;
                if (s === 'approved') {
                  const decided = auditComplaint.approved_at ? new Date(auditComplaint.approved_at) : null;
                  const dur = created && decided ? ((decided.getTime() - created.getTime()) / 36e5).toFixed(1) : null;
                  return (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(220px, 1fr))', gap: 12 }}>
                      <div>
                        <div style={{ color: '#64748b', fontWeight: 800, fontSize: 12 }}>Approved By</div>
                        <div style={{ fontWeight: 800, color: '#0f172a' }}>{auditApproverLabel || (auditComplaint.approved_by ? String(auditComplaint.approved_by).slice(0,8) + '…' : '—')}</div>
                      </div>
                      <div>
                        <div style={{ color: '#64748b', fontWeight: 800, fontSize: 12 }}>Approved At</div>
                        <div style={{ fontWeight: 800, color: '#0f172a' }}>{auditComplaint.approved_at ? decided.toLocaleString() : '—'}</div>
                      </div>
                      {dur ? (
                        <div>
                          <div style={{ color: '#64748b', fontWeight: 800, fontSize: 12 }}>Decision Time</div>
                          <div style={{ fontWeight: 800, color: '#0f172a' }}>{dur} hours</div>
                        </div>
                      ) : null}
                    </div>
                  );
                }
                if (s === 'declined') {
                  const decided = auditComplaint.declined_at ? new Date(auditComplaint.declined_at) : null;
                  const dur = created && decided ? ((decided.getTime() - created.getTime()) / 36e5).toFixed(1) : null;
                  return (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(220px, 1fr))', gap: 12 }}>
                      <div>
                        <div style={{ color: '#64748b', fontWeight: 800, fontSize: 12 }}>Declined By</div>
                        <div style={{ fontWeight: 800, color: '#0f172a' }}>{auditDeclinerLabel || (auditComplaint.declined_by ? String(auditComplaint.declined_by).slice(0,8) + '…' : '—')}</div>
                      </div>
                      <div>
                        <div style={{ color: '#64748b', fontWeight: 800, fontSize: 12 }}>Declined At</div>
                        <div style={{ fontWeight: 800, color: '#0f172a' }}>{auditComplaint.declined_at ? decided.toLocaleString() : '—'}</div>
                      </div>
                      {dur ? (
                        <div>
                          <div style={{ color: '#64748b', fontWeight: 800, fontSize: 12 }}>Decision Time</div>
                          <div style={{ fontWeight: 800, color: '#0f172a' }}>{dur} hours</div>
                        </div>
                      ) : null}
                    </div>
                  );
                }
                return <div style={{ color: '#64748b', fontWeight: 700 }}>No decision recorded</div>;
              })()}
            </div>

            {/* Reporter Card */}
            <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 16, boxShadow: '0 2px 10px rgba(2,6,23,0.06)', padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <span aria-hidden>👤</span>
                <div style={{ fontWeight: 900, color: '#0f172a' }}>Reporter</div>
              </div>
              <div style={{ background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 12, padding: 12, display: 'grid', gap: 6 }}>
                <div style={{ color: '#64748b', fontWeight: 800, fontSize: 12 }}>Email</div>
                <div style={{ fontWeight: 800, color: '#0f172a' }}>{auditComplaint.reporter_email || '—'}</div>
              </div>
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
          <button
            className="overlay-close"
            onClick={closeFullComplaint}
            aria-label="Close"
            style={{
              position: 'absolute',
              top: 8,
              right: 8,
              color: '#ef4444',
              background: 'transparent',
              border: 'none',
              padding: 0,
              fontSize: 28,
              lineHeight: 1,
              cursor: 'pointer'
            }}
          >
            &times;
          </button>
          <div style={{ padding: 16, borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h3 style={{ margin: 0 }}>Complaint Review</h3>
            <div style={{ display: 'flex', gap: 8 }}></div>
          </div>
          <div style={{ padding: 16, overflowY: 'auto', background: '#f8fafc' }}>
            {fullViewLoading ? <div className="dash-alert">Loading…</div> : null}
            {fullViewError ? <div className="dash-alert dash-alert-error">{fullViewError}</div> : null}

            {fullComplaint ? (
              <div style={{ display: 'grid', gap: 16 }}>
                {/* Top chip and header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ background: '#e0e7ff', color: '#1e3a8a', fontWeight: 800, border: '1px solid #c7d2fe', padding: '6px 10px', borderRadius: 999, fontSize: 12 }}>ID: {String(fullComplaint.id || '').slice(0, 8)}…</span>
                </div>

                {/* Primary Info Card */}
                <div style={{ background: '#eef2ff', border: '1px solid #e2e8f0', borderRadius: 16, boxShadow: '0 2px 10px rgba(2,6,23,0.06)', padding: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                    <div style={{ fontSize: 18, fontWeight: 900, color: '#0f172a' }}>{fullComplaint.business_name || '—'}</div>
                    <span className="status-badge" title="Status" style={{ background: '#e2e8f0' }}>{formatStatus(fullComplaint.status)}</span>
                  </div>
                  <div style={{ color: '#334155', marginTop: 8, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    <span aria-hidden>📍</span>
                    <span style={{ fontWeight: 700 }}>{fullComplaint.business_address || '—'}</span>
                  </div>
                  <div style={{ height: 1, background: '#dbeafe', margin: '12px 0' }} />
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(220px, 1fr))', gap: 12 }}>
                    <div>
                      <div style={{ color: '#64748b', fontWeight: 800, fontSize: 12 }}>Submitted</div>
                      <div style={{ color: '#0f172a', fontWeight: 800 }}>{fullComplaint.created_at ? new Date(fullComplaint.created_at).toLocaleString() : '—'}</div>
                    </div>
                    <div>
                      <div style={{ color: '#64748b', fontWeight: 800, fontSize: 12 }}>Updated</div>
                      <div style={{ color: '#0f172a', fontWeight: 800 }}>{fullComplaint.updated_at ? new Date(fullComplaint.updated_at).toLocaleString() : '—'}</div>
                    </div>
                  </div>
                </div>

                {/* Description Card */}
                <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 16, boxShadow: '0 2px 10px rgba(2,6,23,0.06)', padding: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                    <span aria-hidden>📝</span>
                    <div style={{ fontWeight: 900, color: '#0f172a' }}>Description</div>
                  </div>
                  <div style={{ color: '#0f172a', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{fullComplaint.complaint_description || '—'}</div>
                </div>

                {/* Evidence Card */}
                <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 16, boxShadow: '0 2px 10px rgba(2,6,23,0.06)', padding: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                    <span aria-hidden>🖼️</span>
                    <div style={{ fontWeight: 900, color: '#0f172a' }}>Evidence</div>
                  </div>
                  {Array.isArray(fullComplaint.image_urls) && fullComplaint.image_urls.length > 0 ? (
                    <div style={{ display: 'grid', gap: 12 }}>
                      {/* Hero image */}
                      <div style={{ position: 'relative' }}>
                        <img
                          src={fullComplaint.image_urls[evidenceIndex]}
                          alt="Evidence hero"
                          onClick={() => setFullPreviewImage(fullComplaint.image_urls[evidenceIndex])}
                          style={{ width: '100%', height: 340, objectFit: 'cover', borderRadius: 16, border: '1px solid #e2e8f0', cursor: 'pointer' }}
                          loading="lazy"
                        />
                        {fullComplaint.image_urls.length > 1 ? (
                          <>
                            <button
                              type="button"
                              aria-label="Previous image"
                              onClick={(e) => { e.stopPropagation(); const n = fullComplaint.image_urls.length; setEvidenceIndex((i) => (i - 1 + n) % n); }}
                              style={{ position: 'absolute', top: '50%', left: 14, transform: 'translateY(-50%)', background: 'rgba(15,23,42,0.85)', color: '#fff', border: 'none', borderRadius: 999, width: 44, height: 44, aspectRatio: '1 / 1', display: 'grid', placeItems: 'center', cursor: 'pointer', boxShadow: '0 2px 10px rgba(0,0,0,0.25)', padding: 0, lineHeight: 0, boxSizing: 'border-box' }}
                            >
                              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style={{ display: 'block' }}>
                                <path d="M14 6L8 12L14 18" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            </button>
                            <button
                              type="button"
                              aria-label="Next image"
                              onClick={(e) => { e.stopPropagation(); const n = fullComplaint.image_urls.length; setEvidenceIndex((i) => (i + 1) % n); }}
                              style={{ position: 'absolute', top: '50%', right: 14, transform: 'translateY(-50%)', background: 'rgba(15,23,42,0.85)', color: '#fff', border: 'none', borderRadius: 999, width: 44, height: 44, aspectRatio: '1 / 1', display: 'grid', placeItems: 'center', cursor: 'pointer', boxShadow: '0 2px 10px rgba(0,0,0,0.25)', padding: 0, lineHeight: 0, boxSizing: 'border-box' }}
                            >
                              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style={{ display: 'block' }}>
                                <path d="M10 6L16 12L10 18" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            </button>
                          </>
                        ) : null}
                        <div style={{ position: 'absolute', right: 10, bottom: 10, background: 'rgba(15,23,42,0.7)', color: '#fff', fontWeight: 800, padding: '4px 8px', borderRadius: 999, fontSize: 12 }}>
                          {evidenceIndex + 1} / {fullComplaint.image_urls.length}
                        </div>
                      </div>
                      {/* Thumbnails */}
                      {fullComplaint.image_urls.length > 1 ? (
                        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                          {fullComplaint.image_urls.map((url, idx) => (
                            <img
                              key={url}
                              src={url}
                              alt={`Evidence ${idx + 1}`}
                              onClick={() => setEvidenceIndex(idx)}
                              style={{
                                width: 110,
                                height: 78,
                                objectFit: 'cover',
                                borderRadius: 12,
                                border: idx === evidenceIndex ? '2px solid #2563eb' : '1px solid #e2e8f0',
                                boxShadow: idx === evidenceIndex ? '0 0 0 3px rgba(37,99,235,0.15)' : 'none',
                                cursor: 'pointer'
                              }}
                              loading="lazy"
                            />
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div style={{ color: '#64748b', fontWeight: 700 }}>No images</div>
                  )}
                </div>

                {/* Reporter Card */}
                <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 16, boxShadow: '0 2px 10px rgba(2,6,23,0.06)', padding: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                    <span aria-hidden>👤</span>
                    <div style={{ fontWeight: 900, color: '#0f172a' }}>Reporter</div>
                  </div>
                  <div style={{ background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 12, padding: 12, display: 'grid', gap: 6 }}>
                    <div style={{ color: '#64748b', fontWeight: 800, fontSize: 12 }}>Email</div>
                    <div style={{ fontWeight: 800, color: '#0f172a' }}>{fullComplaint.reporter_email || '—'}</div>
                  </div>
                </div>

                {/* Audit Card */}
                <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 16, boxShadow: '0 2px 10px rgba(2,6,23,0.06)', padding: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                    <span aria-hidden>•</span>
                    <div style={{ fontWeight: 900, color: '#0f172a' }}>Audit Trail</div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(220px, 1fr))', gap: 16 }}>
                    <div>
                      <div style={{ color: '#64748b', fontWeight: 800, fontSize: 12 }}>Approved By</div>
                      <div style={{ fontWeight: 800, color: '#0f172a' }}>{fullComplaint.approved_by || '—'}</div>
                    </div>
                    <div>
                      <div style={{ color: '#64748b', fontWeight: 800, fontSize: 12 }}>Approved At</div>
                      <div style={{ fontWeight: 800, color: '#0f172a' }}>{fullComplaint.approved_at ? new Date(fullComplaint.approved_at).toLocaleString() : '—'}</div>
                    </div>
                    <div>
                      <div style={{ color: '#64748b', fontWeight: 800, fontSize: 12 }}>Declined By</div>
                      <div style={{ fontWeight: 800, color: '#0f172a' }}>{fullComplaint.declined_by || '—'}</div>
                    </div>
                    <div>
                      <div style={{ color: '#64748b', fontWeight: 800, fontSize: 12 }}>Declined At</div>
                      <div style={{ fontWeight: 800, color: '#0f172a' }}>{fullComplaint.declined_at ? new Date(fullComplaint.declined_at).toLocaleString() : '—'}</div>
                    </div>
                  </div>
                </div>

                {/* Sticky Action Bar */}
                <div style={{ position: 'sticky', bottom: 0, background: '#ffffff', borderTop: '1px solid #e2e8f0', padding: 12, display: 'grid', gap: 10, boxShadow: '0 -2px 8px rgba(2,6,23,0.06)', borderBottomLeftRadius: 12, borderBottomRightRadius: 12 }}>
                  <div style={{ display: 'grid', gap: 6 }}>
                    <label htmlFor="decline-comment" style={{ color: '#0f172a', fontWeight: 900, fontSize: 12 }}>
                      Decline comment <span style={{ color: '#ef4444' }}>*</span>
                    </label>
                    <textarea
                      id="decline-comment"
                      className="dash-input"
                      value={declineComment}
                      onChange={(e) => {
                        setDeclineComment(e.target.value);
                        if (declineCommentError) setDeclineCommentError('');
                      }}
                      rows={3}
                      placeholder="Required if declining. Provide a brief, specific reason (e.g., insufficient evidence, duplicate report, outside jurisdiction)."
                      style={{ resize: 'vertical', minHeight: 70 }}
                    />
                    {declineCommentError ? (
                      <div className="dash-alert dash-alert-error" style={{ margin: 0 }}>
                        {declineCommentError}
                      </div>
                    ) : null}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                  <button
                    className="dash-btn dash-btn-success"
                    type="button"
                    onClick={() => updateComplaintStatus(fullComplaint.id, 'approved')}
                    disabled={loading || !fullComplaint}
                    aria-label="Approve"
                    title="Approve"
                    style={{ borderRadius: 999, padding: '0 16px' }}
                  >
                    Approve
                  </button>
                  <button
                    className="dash-btn dash-btn-danger"
                    type="button"
                    onClick={() => updateComplaintStatus(fullComplaint.id, 'declined')}
                    disabled={loading || !fullComplaint}
                    aria-label="Decline"
                    title="Decline"
                    style={{ borderRadius: 999, padding: '0 16px' }}
                  >
                    Decline
                  </button>
                  <button className="dash-btn" type="button" onClick={() => window.print()} style={{ borderRadius: 999, padding: '0 16px' }}>Print</button>
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
