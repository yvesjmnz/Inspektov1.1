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

function getUrgencyStyle(urgency) {
  const u = Number(urgency);
  if (u === 100) {
    return {
      badge: { background: '#dcfce7', border: '1px solid #22c55e', color: '#166534' },
      hover: { borderLeft: '4px solid #22c55e' }
    };
  }
  if (u === 50) {
    return {
      badge: { background: '#fef3c7', border: '1px solid #eab308', color: '#854d0e' },
      hover: { borderLeft: '4px solid #eab308' }
    };
  }
  if (u === 25) {
    return {
      badge: { background: '#fee2e2', border: '1px solid #ef4444', color: '#991b1b' },
      hover: { borderLeft: '4px solid #ef4444' }
    };
  }
  return {
    badge: { background: '#e2e8f0', border: '1px solid #cbd5e1', color: '#334155' },
    hover: { borderLeft: '4px solid #cbd5e1' }
  };
}

function formatDateNoSeconds(isoString) {
  if (!isoString) return '—';
  const date = new Date(isoString);
  return date.toLocaleString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
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
        title: 'Review Complaints',
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
  // Full complaint sidebar state (for history tab audit view)
  const [fullViewId, setFullViewId] = useState(null);
  const [fullViewLoading, setFullViewLoading] = useState(false);
  const [fullViewError, setFullViewError] = useState('');
  const [fullComplaint, setFullComplaint] = useState(null);
  const [fullPreviewImage, setFullPreviewImage] = useState(null);
  const [evidenceIndex, setEvidenceIndex] = useState(0);
  // Date range filter (history tab)
  const [datePopoverOpen, setDatePopoverOpen] = useState(false);
  const [viewMonth, setViewMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [pendingRange, setPendingRange] = useState({ start: null, end: null }); // inclusive
  const [appliedRange, setAppliedRange] = useState({ start: null, end: null }); // inclusive
  const [datePreset, setDatePreset] = useState('last-week'); // 'last-week' | 'last-month' | 'last-year' | 'custom'

  // Date helpers
  const startOfDayLocal = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const addMonths = (d, n) => new Date(d.getFullYear(), d.getMonth() + n, 1);
  const isSameDay = (a, b) => !!a && !!b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const isBetween = (x, a, b) => {
    if (!a || !b) return false;
    const t = startOfDayLocal(x).getTime();
    const s = startOfDayLocal(a).getTime();
    const e = startOfDayLocal(b).getTime();
    return t >= s && t <= e;
  };

  // Prepare current week (Sunday–Saturday) as pending selection without applying
  const setCurrentWeekPending = () => {
    const t = startOfDayLocal(new Date());
    const weekday = t.getDay(); // 0=Sun..6=Sat
    const start = addDays(t, -weekday);
    const end = addDays(start, 6);
    setPendingRange({ start, end });
    setDatePreset('custom'); // avoid highlighting any preset by default
    setViewMonth(new Date(t.getFullYear(), t.getMonth(), 1));
  };

  const calendarGrid = (base) => {
    const first = new Date(base.getFullYear(), base.getMonth(), 1);
    const day = first.getDay(); // 0 Sun - 6 Sat
    const offset = (day + 6) % 7; // Monday-first
    const gridStart = addDays(first, -offset);
    const days = [];
    for (let i = 0; i < 42; i++) days.push(addDays(gridStart, i));
    return days;
  };

  const applyPresetRange = (p) => {
    setDatePreset(p);
    const today = new Date();
    const t = startOfDayLocal(today);

    if (p === 'custom') {
      setPendingRange({ start: null, end: null });
      setViewMonth(new Date(t.getFullYear(), t.getMonth(), 1));
      return;
    }

    if (p === 'last-week') {
      // Week alignment: Sunday–Saturday (matches example Feb 1–7 when today is Feb 14, 2026)
      const weekday = t.getDay(); // 0=Sun..6=Sat
      const thisWeekStartSun = addDays(t, -weekday);
      const lastWeekStartSun = addDays(thisWeekStartSun, -7);
      const lastWeekEndSat = addDays(lastWeekStartSun, 6);
      setPendingRange({ start: lastWeekStartSun, end: lastWeekEndSat });
      setViewMonth(new Date(lastWeekEndSat.getFullYear(), lastWeekEndSat.getMonth(), 1));
      return;
    }

    if (p === 'last-month') {
      const firstOfThisMonth = new Date(t.getFullYear(), t.getMonth(), 1);
      const firstOfLastMonth = new Date(t.getFullYear(), t.getMonth() - 1, 1);
      const lastOfLastMonth = new Date(t.getFullYear(), t.getMonth(), 0); // day 0 of this month
      setPendingRange({ start: firstOfLastMonth, end: lastOfLastMonth });
      setViewMonth(new Date(firstOfLastMonth.getFullYear(), firstOfLastMonth.getMonth(), 1));
      return;
    }

    if (p === 'last-year') {
      const prevYear = t.getFullYear() - 1;
      const start = new Date(prevYear, 0, 1);
      const end = new Date(prevYear, 11, 31);
      setPendingRange({ start, end });
      setViewMonth(new Date(prevYear, 0, 1));
      return;
    }
  };

  const onDayClick = (d) => {
    setDatePreset('custom');
    const day = startOfDayLocal(d);
    setPendingRange((r) => {
      if (!r.start || (r.start && r.end)) return { start: day, end: null };
      if (day < r.start) return { start: day, end: r.start };
      return { start: r.start, end: day };
    });
  };

  const onApplyDateRange = () => {
    if (pendingRange.start && pendingRange.end) {
      setAppliedRange({ start: startOfDayLocal(pendingRange.start), end: startOfDayLocal(pendingRange.end) });
      setDatePopoverOpen(false);
    }
  };

  const formatRangeLabel = (start, end) => {
    if (!start || !end) return 'Date: All time';
    const fmt = (dt) => dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    return `Date: ${fmt(start)} — ${fmt(end)}`;
  };

  const rangeLabel = useMemo(() => formatRangeLabel(appliedRange.start, appliedRange.end), [appliedRange]);
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
        // Apply created_at date range for Complaint History if filters are set via range picker (explicit Apply)
        if (appliedRange?.start && appliedRange?.end) {
          const start = new Date(appliedRange.start.getFullYear(), appliedRange.start.getMonth(), appliedRange.start.getDate());
          const endExclusive = new Date(appliedRange.end.getFullYear(), appliedRange.end.getMonth(), appliedRange.end.getDate() + 1);
          query = query.gte('created_at', start.toISOString()).lt('created_at', endExclusive.toISOString());
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

  // Reload history when applied date range changes
  useEffect(() => {
    if (tab === 'history') {
      loadComplaints();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appliedRange.start, appliedRange.end]);

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

  // Group complaints by day for Review Complaints
  const complaintsByDay = useMemo(() => {
    // Group by day for both queue and history tabs
    if (tab === 'mission-orders') return { groups: {}, sortedKeys: [] };
    const groups = {};
    for (const c of filteredComplaints) {
      const d = c.created_at ? new Date(c.created_at) : null;
      const key = d ? new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString().slice(0, 10) : 'unknown';
      if (!groups[key]) {
        // Format as "MMMM D" (e.g., "February 17")
        const label = d ? d.toLocaleDateString(undefined, { month: 'long', day: 'numeric' }) : 'Unknown Date';
        groups[key] = { label, items: [] };
      }
      groups[key].items.push(c);
    }
    // Sort items within each day by created_at descending (newest first)
    for (const key in groups) {
      groups[key].items.sort((a, b) => {
        const timeA = a.created_at ? new Date(a.created_at).getTime() : 0;
        const timeB = b.created_at ? new Date(b.created_at).getTime() : 0;
        return timeB - timeA;
      });
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
                  <span className="dash-nav-label" style={{ display: navCollapsed ? 'none' : 'inline' }}>Review Complaints</span>
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

          {tab === 'history' ? (
            <div className="date-filter">
              <button
                type="button"
                className="dash-select date-filter-btn"
                onClick={() => {
                  if (!datePopoverOpen) {
                    if (appliedRange.start && appliedRange.end) {
                      setPendingRange({ start: appliedRange.start, end: appliedRange.end });
                      setDatePreset('custom');
                      setViewMonth(new Date(appliedRange.end.getFullYear(), appliedRange.end.getMonth(), 1));
                    } else {
                      setCurrentWeekPending();
                    }
                  }
                  setDatePopoverOpen((v) => !v);
                }}
                aria-haspopup="dialog"
                aria-expanded={datePopoverOpen}
              >
                {rangeLabel}
              </button>
              {datePopoverOpen ? (
                <div className="date-popover" role="dialog" aria-modal="true">
                  <div className="date-presets">
                    <button type="button" className={datePreset === 'last-week' ? 'active' : ''} onClick={() => applyPresetRange('last-week')}>Last Week</button>
                    <button type="button" className={datePreset === 'last-month' ? 'active' : ''} onClick={() => applyPresetRange('last-month')}>Last Month</button>
                    <button type="button" className={datePreset === 'last-year' ? 'active' : ''} onClick={() => applyPresetRange('last-year')}>Last Year</button>
                    <button type="button" className={datePreset === 'custom' ? 'active' : ''} onClick={() => applyPresetRange('custom')}>Custom</button>
                    <div className="date-apply">
                      <button type="button" className="dash-btn" style={{ width: '100%' }} onClick={onApplyDateRange} disabled={!pendingRange.start || !pendingRange.end}>Apply</button>
                    </div>
                  </div>
                  <div className="cal-wrap">
                    <div className="cal-header">
                      <div style={{ fontWeight: 900 }}>{viewMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</div>
                      <div className="cal-nav">
                        <button type="button" aria-label="Previous month" onClick={() => setViewMonth(addMonths(viewMonth, -1))}>‹</button>
                        <button type="button" aria-label="Next month" onClick={() => setViewMonth(addMonths(viewMonth, 1))}>›</button>
                      </div>
                    </div>
                    <div className="cal-grid">
                      {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map((d) => (
                        <div key={`h-${d}`} className="cal-dow">{d}</div>
                      ))}
                      {calendarGrid(viewMonth).map((d) => {
                        const inMonth = d.getMonth() === viewMonth.getMonth();
                        const isStart = pendingRange.start && isSameDay(d, pendingRange.start);
                        const isEnd = pendingRange.end && isSameDay(d, pendingRange.end);
                        const inSel = pendingRange.start && pendingRange.end && isBetween(d, pendingRange.start, pendingRange.end);
                        const cls = ['cal-day', inMonth ? '' : 'muted', inSel ? 'in-range' : '', isStart ? 'start' : '', isEnd ? 'end' : ''].filter(Boolean).join(' ');
                        return (
                          <div key={d.toISOString()} className={cls} onClick={() => onDayClick(d)}>{d.getDate()}</div>
                        );
                      })}
                    </div>
                    <div className="range-summary">
                      {pendingRange.start && pendingRange.end ? formatRangeLabel(pendingRange.start, pendingRange.end).replace('Date: ', '') : 'Select a start and end date'}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {error ? <div className="dash-alert dash-alert-error">{error}</div> : null}

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
                <div className="dash-cell-sub">In Review Complaints</div>
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
                        <td>{formatDateNoSeconds(mo.submitted_at)}</td>
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
            <div style={{ display: 'grid', gap: 20 }}>
              {filteredComplaints.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 32, color: '#475569', background: '#f8fafc', borderRadius: 12, border: '1px solid #e2e8f0' }}>
                  {loading ? 'Loading…' : 'No records found.'}
                </div>
              ) : (
                complaintsByDay.sortedKeys.map((dayKey) => {
                  const dayGroup = complaintsByDay.groups[dayKey];
                  const label = dayGroup?.label || dayKey;
                  const pendingCount = dayGroup?.items?.length || 0;
                  
                  // Only render day block if there are items
                  if (pendingCount === 0) return null;
                  
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
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#F2B705', marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#F2B705', flexShrink: 0 }}></div>
                          <span>{pendingCount} Pending {pendingCount === 1 ? 'Complaint' : 'Complaints'}</span>
                        </div>
                      </div>

                      {/* Table for this day */}
                      <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                          <thead>
                            <tr style={{ background: '#ffffff', borderBottom: '1px solid #e2e8f0' }}>
                              {tab === 'queue' ? (
                                <>
                                  <th style={{ width: 160, padding: '12px', textAlign: 'left', fontWeight: 800, fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Urgency</th>
                                  <th style={{ padding: '12px', textAlign: 'left', fontWeight: 800, fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Business & Address</th>
                                  <th style={{ width: 200, padding: '12px', textAlign: 'left', fontWeight: 800, fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Submitted</th>
                                </>
                              ) : (
                                <>
                                  <th style={{ width: 90, padding: '12px', textAlign: 'left', fontWeight: 800, fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>ID</th>
                                  <th style={{ padding: '12px', textAlign: 'left', fontWeight: 800, fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Business & Address</th>
                                  <th style={{ width: 240, padding: '12px', textAlign: 'left', fontWeight: 800, fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Status</th>
                                  {tab === 'history' ? <th style={{ width: 280, padding: '12px', textAlign: 'left', fontWeight: 800, fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Decision</th> : null}
                                  <th style={{ width: 180, padding: '12px', textAlign: 'left', fontWeight: 800, fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Authenticity Level</th>
                                  <th style={{ width: 200, padding: '12px', textAlign: 'left', fontWeight: 800, fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Submitted</th>
                                  <th style={{ width: 280, padding: '12px', textAlign: 'left', fontWeight: 800, fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Evidence</th>
                                </>
                              )}
                            </tr>
                          </thead>
                          <tbody>
                            {dayGroup.items.map((c) => {
                              const urgencyStyle = tab === 'queue' ? getUrgencyStyle(c?.authenticity_level) : null;
                              const urgencyColor = tab === 'queue' ? (() => {
                                const u = Number(c?.authenticity_level);
                                if (u === 100) return '#22c55e'; // green
                                if (u === 50) return '#eab308'; // yellow
                                if (u === 25) return '#ef4444'; // red
                                return '#cbd5e1'; // gray
                              })() : null;
                              return (
                                <tr
                                  key={c.id}
                                  onClick={() => window.location.assign(`/complaint/review?id=${c.id}`)}
                                  style={{
                                    cursor: 'pointer',
                                    borderBottom: '1px solid #e2e8f0',
                                    transition: 'background-color 0.2s ease, box-shadow 0.2s ease, border-left 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
                                    position: 'relative',
                                    borderLeft: tab === 'queue' ? '4px solid transparent' : 'none',
                                  }}
                                  onMouseEnter={(e) => {
                                    e.currentTarget.style.background = '#f8fafc';
                                    if (tab === 'queue') {
                                      e.currentTarget.style.borderLeft = `4px solid ${urgencyColor}`;
                                    }
                                    if (urgencyStyle) {
                                      e.currentTarget.style.boxShadow = urgencyStyle.hover.boxShadow;
                                    }
                                  }}
                                  onMouseLeave={(e) => {
                                    e.currentTarget.style.background = '#ffffff';
                                    e.currentTarget.style.borderLeft = tab === 'queue' ? '4px solid transparent' : 'none';
                                    e.currentTarget.style.boxShadow = 'none';
                                  }}
                                >
                                  {tab === 'queue' ? (
                                    <>
                                      <td style={{ padding: '12px' }}>
                                        <span className="status-badge" style={{ ...urgencyStyle.badge, fontWeight: 700, fontSize: 13, padding: '6px 12px', borderRadius: 6, display: 'inline-block' }}>{c?.authenticity_level ?? '—'}</span>
                                      </td>
                                      <td style={{ padding: '12px' }}>
                                        <div className="dash-cell-title">{c.business_name || '—'}</div>
                                        <div className="dash-cell-sub">{c.business_address || ''}</div>
                                      </td>
                                      <td style={{ padding: '12px', color: '#0f172a', fontSize: 13 }}>{formatDateNoSeconds(c.created_at)}</td>
                                    </>
                                  ) : (
                                    <>
                                      <td style={{ padding: '12px', color: '#0f172a', fontWeight: 700 }}>{c.id}</td>
                                      <td style={{ padding: '12px' }}>
                                        <div className="dash-cell-title">{c.business_name || '—'}</div>
                                        <div className="dash-cell-sub">{c.business_address || ''}</div>
                                        <div className="dash-cell-sub">{c.reporter_email || ''}</div>
                                      </td>
                                      <td style={{ padding: '12px' }}>
                                        <span className={statusBadgeClass(c.status)}>{formatStatus(c.status)}</span>
                                      </td>
                                      {tab === 'history' ? (
                                        <td style={{ padding: '12px' }}>
                                          <div className="dash-cell-sub">
                                            {(() => {
                                              const s = String(c.status || '').toLowerCase();
                                              if (s === 'approved') {
                                                const approverLabel = c.approved_by ? String(c.approved_by).slice(0, 8) + '…' : '—';
                                                return `Approved by ${approverLabel} on ${c.approved_at ? new Date(c.approved_at).toLocaleString() : '—'}`;
                                              }
                                              if (s === 'declined') {
                                                const declinerLabel = c.declined_by ? String(c.declined_by).slice(0, 8) + '…' : '—';
                                                return `Declined by ${declinerLabel} on ${c.declined_at ? new Date(c.declined_at).toLocaleString() : '—'}`;
                                              }
                                              return '—';
                                            })()}
                                          </div>
                                          <div style={{ marginTop: 6 }}>
                                            <button className="dash-link" type="button" onClick={() => setAuditComplaint(c)}>View audit</button>
                                          </div>
                                        </td>
                                      ) : null}
                                      <td style={{ padding: '12px', color: '#0f172a', fontSize: 13 }}>{c?.authenticity_level ?? '—'}</td>
                                      <td style={{ padding: '12px', color: '#0f172a', fontSize: 13 }}>{formatDateNoSeconds(c.created_at)}</td>
                                      <td style={{ padding: '12px' }}>
                                        <div style={{ display: 'grid', gap: 8 }}>
                                          {c?.complaint_description ? (
                                            <div style={{ color: '#0f172a', whiteSpace: 'pre-wrap', fontSize: 13 }}>
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
                                    </>
                                  )}
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })
              )}
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
