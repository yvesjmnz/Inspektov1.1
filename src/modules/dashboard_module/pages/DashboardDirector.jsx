import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import NotificationBell from '../../../components/NotificationBell';
import { notifyHeadInspectorComplaintApproved } from '../../../lib/notifications/notificationTriggers';
import { cancelInspection as cancelInspectionApi } from '../../../lib/api';
import DirectorReports from './DirectorReports';
import MissionOrderHistory from '../components/MissionOrderHistory';
import './Dashboard.css';

// Complaint category grouping (Director view) from tags like "Violation: <Sub>"
const GUIDED_CATEGORY_LABELS = [
  'Business Permit & Licensing Issues',
  'Alcohol & Tobacco Violations',
  'Sanitation & Environmental Violations',
  'Health, Hygiene, & Nutrition',
  'Public Security Compliance',
];
const GUIDED_SUBCAT_BY_CATEGORY = new Map([
  ['Business Permit & Licensing Issues', [
    'Operating Without a Valid Business Permit',
    'Missing Commerical Space Clearance',
    'Unregistered or Untaxed Employees',
  ]],
  ['Alcohol & Tobacco Violations', [
    'Selling Alcohol Near Schools',
    'Selling Alcohol to Minors',
    'Selling Cigarettes to Minors',
  ]],
  ['Sanitation & Environmental Violations', [
    'Improper Waste Disposal or Segregation',
    'Illegal Disposing of Cooking Oil',
    'Unpaid Garbage Tax',
  ]],
  ['Health, Hygiene, & Nutrition', [
    'Poor Food-Handler Hygiene',
    'Missing Menu Nutrition Labels',
  ]],
  ['Public Security Compliance', [
    'CCTV System Non-Compliance',
  ]],
]);
function groupComplaintCategoriesFromTags(tags) {
  const result = [];
  if (!Array.isArray(tags) || tags.length === 0) return result;
  const selectedSubs = tags
    .map((t) => String(t || ''))
    .filter((t) => /^Violation:\\s*/i.test(t))
    .map((t) => t.replace(/^Violation:\\s*/i, '').trim());
  if (selectedSubs.length === 0) return result;
  const subToCat = new Map();
  for (const cat of GUIDED_CATEGORY_LABELS) {
    const subs = GUIDED_SUBCAT_BY_CATEGORY.get(cat) || [];
    subs.forEach((s) => subToCat.set(s, cat));
  }
  const byCat = new Map();
  for (const sub of selectedSubs) {
    const cat = subToCat.get(sub);
    if (!cat) continue;
    if (!byCat.has(cat)) byCat.set(cat, new Set());
    byCat.get(cat).add(sub);
  }
  for (const [cat, setSubs] of byCat) {
    result.push({ category: cat, subs: Array.from(setSubs) });
  }
  return result;
}

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
  if (['approved', 'completed'].includes(s)) return 'status-badge status-success';
  if (['declined', 'rejected', 'invalid'].includes(s)) return 'status-badge status-danger';
  if (['submitted', 'pending', 'new'].includes(s)) return 'status-badge status-warning';
  if (['on hold', 'on_hold', 'hold'].includes(s)) return 'status-badge status-info';
  return 'status-badge';
}

// Head Inspector-style status formatting (use these for the Mission Order History view so labels and colors match)
function formatStatusHI(status) {
  if (!status) return 'Unknown';
  const s = String(status).toLowerCase().trim();

  // inspection_reports statuses
  if (s === 'pending inspection' || s === 'pending_inspection' || s === 'pending') return 'Pending Inspection';
  if (s === 'in progress' || s === 'in_progress') return 'In Progress';
  if (s === 'completed') return 'Completed';

  // mission_orders statuses
  if (s === 'cancelled' || s === 'canceled') return 'Cancelled';
  if (s === 'for inspection' || s === 'for_inspection') return 'Pre-Approved';

  return String(status)
    .replace(/_/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function statusBadgeClassHI(status) {
  const s = String(status || '').toLowerCase().trim();

  // inspection_reports status color coding
  if (s === 'pending inspection' || s === 'pending_inspection' || s === 'pending') return 'status-badge status-warning';
  if (s === 'in progress' || s === 'in_progress') return 'status-badge status-info';
  if (s === 'completed') return 'status-badge status-success';

  // Mission order status color coding
  if (s === 'for inspection' || s === 'for_inspection') return 'status-badge status-success';
  if (s === 'issued') return 'status-badge status-warning';
  if (s === 'awaiting_signature') return 'status-badge status-accent';
  if (s === 'complete') return 'status-badge status-success';
  if (s === 'cancelled' || s === 'canceled') return 'status-badge status-danger';
  if (s === 'draft') return 'status-badge status-info';

  if (!s) return 'status-badge status-info';
  return 'status-badge';
}

function getUrgencyText(authenticityLevel) {
  const u = Number(authenticityLevel);
  if (u < 50) {
    return 'Monitoring and Records';
  }
  if (u === 50) {
    return 'Scheduled Inspection';
  }
  if (u > 50) {
    return 'Immediate Inspection';
  }
  return '—';
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
  // Example: "18 March 2026 | 04:36 PM"
  const datePart = date.toLocaleDateString(undefined, {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
  const timePart = date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${datePart} | ${timePart}`;
}

export default function DashboardDirector() {
  // Initialize tab from URL query parameter, default to 'queue'
  // Note: Director view no longer supports the 'general' (dashboard) tab.
  const getInitialTab = () => {
    const params = new URLSearchParams(window.location.search);
    const tabParam = params.get('tab');
    if (tabParam && ['queue', 'mission-orders', 'inspection', 'mission-orders-history', 'inspection-history', 'history', 'reports'].includes(tabParam)) {
      return tabParam;
    }
    return 'queue';
  };

  const [tab, setTab] = useState(getInitialTab); // queue | mission-orders | mission-orders-history | inspection | inspection-history | history | reports
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
        title: 'Review Pending Mission Orders',
        subtitle: 'Review and action mission orders awaiting director approval.',
      },
      'mission-orders-history': {
        title: 'Mission Order History',
        subtitle: 'Browse completed mission orders and track their status.',
      },
      inspection: {
        title: 'Inspections',
        subtitle: 'Track ongoing inspections.',
      },
      'inspection-history': {
        title: 'Inspection History',
        subtitle: 'History for all completed inspections (from inspection reports).',
      },
      reports: {
        title: 'Performance Report',
        subtitle: 'Comprehensive metrics and analytics for decision-making.',
      },
    };

    return meta[tab] || meta.general;
  }, [tab]);

  const [complaints, setComplaints] = useState([]);
  const [missionOrders, setMissionOrders] = useState([]);
  const [search, setSearch] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [auditComplaint, setAuditComplaint] = useState(null);
  // Advanced filters for history tab
  const [filterOpen, setFilterOpen] = useState(false);
  const [filters, setFilters] = useState({
    businessName: '',
    address: '',
    reporterEmail: '',
    complaintId: '',
    dateMonth: null,
    dateDay: null,
  });
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
    if (!start || !end) return 'All time';
    const fmt = (dt) => dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const fmtYear = (dt) => dt.getFullYear();
    const startYear = fmtYear(start);
    const endYear = fmtYear(end);
    const startStr = fmt(start);
    const endStr = fmt(end);
    // If same year, only show year once at the end
    if (startYear === endYear) {
      return `${startStr} – ${endStr}, ${startYear}`;
    }
    // Different years, show both
    return `${startStr}, ${startYear} – ${endStr}, ${endYear}`;
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
  const [currentUserId, setCurrentUserId] = useState(null);
  const [expandedComplaintId, setExpandedComplaintId] = useState(null);

  // Get current user on mount
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
        .select('id, status, created_at, authenticity_level, business_name, business_address, reporter_email, complaint_description, image_urls, approved_by, approved_at, declined_by, declined_at, tags')
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

      // Apply field filters (only one can be active at a time)
      if (tab === 'history') {
        const searchVal = search.trim();
        if (filters.businessName && searchVal) {
          query = query.ilike('business_name', `%${searchVal}%`);
        } else if (filters.address && searchVal) {
          query = query.ilike('business_address', `%${searchVal}%`);
        } else if (filters.reporterEmail && searchVal) {
          query = query.ilike('reporter_email', `%${searchVal}%`);
        } else if (filters.complaintId && searchVal) {
          query = query.ilike('id', `%${searchVal}%`);
        }

        // Date filtering is handled by the calendar date range picker (appliedRange)
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
      } else if (tab === 'mission-orders-history') {
        // Use merged complaint-level dataset (same as Head Inspector) for Director history
        try {
          let complaintQuery = supabase
            .from('complaints')
            .select('id, business_name, business_address, reporter_email, status, approved_at, created_at')
            .in('status', ['approved', 'Approved']);

          // Apply date range to approved_at (same as Head Inspector)
          if (appliedRange?.start && appliedRange?.end) {
            const start = new Date(appliedRange.start.getFullYear(), appliedRange.start.getMonth(), appliedRange.start.getDate());
            const endExclusive = new Date(appliedRange.end.getFullYear(), appliedRange.end.getMonth(), appliedRange.end.getDate() + 1);
            complaintQuery = complaintQuery.gte('approved_at', start.toISOString()).lt('approved_at', endExclusive.toISOString());
          }

          const { data: complaintRows, error: complaintError } = await complaintQuery;
          if (complaintError) throw complaintError;

          const complaintIds = Array.from(new Set((complaintRows || []).map((c) => c.id).filter(Boolean)));

          const { data: missionOrderRows, error: moError } = complaintIds.length
            ? await supabase
                .from('mission_orders')
                .select('id, complaint_id, status, created_at, submitted_at, date_of_inspection, updated_at, secretary_signed_at, director_preapproved_at, title')
                .in('complaint_id', complaintIds)
                .order('created_at', { ascending: false })
                .limit(500)
            : { data: [], error: null };

          if (moError) throw moError;

          // Keep the latest MO per complaint
          const latestMoByComplaintId = new Map();
          (missionOrderRows || []).forEach((mo) => {
            if (!mo?.complaint_id) return;
            if (!latestMoByComplaintId.has(mo.complaint_id)) {
              latestMoByComplaintId.set(mo.complaint_id, mo);
            }
          });

          const missionOrderIds = Array.from(new Set((Array.from(latestMoByComplaintId.values()) || []).map((m) => m.id).filter(Boolean)));

          const { data: assignmentRows, error: assignmentError } = missionOrderIds.length
            ? await supabase
                .from('mission_order_assignments')
                .select('mission_order_id, inspector_id')
                .in('mission_order_id', missionOrderIds)
            : { data: [], error: null };

          if (assignmentError) throw assignmentError;

          const { data: reportRows, error: reportErr } = missionOrderIds.length
            ? await supabase
                .from('inspection_reports')
                .select('mission_order_id, status, updated_at, created_at, completed_at')
                .in('mission_order_id', missionOrderIds)
                .order('updated_at', { ascending: false })
                .limit(2000)
            : { data: [], error: null };

          if (reportErr) throw reportErr;

          // Fetch revision counts for mission orders so Director can see #revisions like Head Inspector
          const { data: revisionRows, error: revisionErr } = missionOrderIds.length
            ? await supabase
                .from('mission_order_revisions')
                .select('mission_order_id')
                .in('mission_order_id', missionOrderIds)
            : { data: [], error: null };

          if (revisionErr) {
            // non-fatal: continue without revisions
            console.warn('Failed to load mission order revisions', revisionErr);
          }

          const revisionCountByMoId = new Map();
          (revisionRows || []).forEach((r) => {
            if (!r?.mission_order_id) return;
            revisionCountByMoId.set(r.mission_order_id, (revisionCountByMoId.get(r.mission_order_id) || 0) + 1);
          });

          const normalizeInspectionStatus = (v) => String(v || '').toLowerCase().trim();
          const inspectionPriority = (v) => {
            const s = normalizeInspectionStatus(v);
            if (s === 'in progress' || s === 'in_progress') return 3;
            if (s === 'pending inspection' || s === 'pending_inspection' || s === 'pending') return 2;
            if (s === 'completed' || s === 'complete') return 1;
            return 0;
          };

          const inspectionStatusByMissionOrderId = new Map();
          for (const r of reportRows || []) {
            const moId = r?.mission_order_id;
            if (!moId) continue;
            const cur = inspectionStatusByMissionOrderId.get(moId);
            if (!cur) {
              inspectionStatusByMissionOrderId.set(moId, r?.status || null);
              continue;
            }
            if (inspectionPriority(r?.status) > inspectionPriority(cur)) {
              inspectionStatusByMissionOrderId.set(moId, r?.status || null);
            }
          }

          const inspectorIds = Array.from(new Set((assignmentRows || []).map((a) => a?.inspector_id).filter(Boolean)));

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
            const p = profileById.get(a.inspector_id) || {};
            const displayName =
              p?.full_name || [p?.first_name, p?.middle_name, p?.last_name].filter(Boolean).join(' ') || String(a.inspector_id).slice(0, 8);
            const arr = inspectorNamesByMissionOrderId.get(a.mission_order_id) || [];
            arr.push(displayName);
            inspectorNamesByMissionOrderId.set(a.mission_order_id, arr);
          });

          const merged = (complaintRows || []).map((c) => {
            const mo = latestMoByComplaintId.get(c.id) || null;
            const revCount = mo?.id ? (revisionCountByMoId.get(mo.id) || 0) : 0;
            return {
              complaint_id: c.id,
              business_name: c.business_name,
              business_address: c.business_address,
              reporter_email: c.reporter_email,
              approved_at: c.approved_at,
              created_at: c.created_at,
              mission_order_id: mo?.id || null,
              mission_order_status: mo?.status || null,
              inspection_status: mo?.id ? inspectionStatusByMissionOrderId.get(mo.id) || null : null,
              mission_order_created_at: mo?.created_at || null,
              date_of_inspection: mo?.date_of_inspection || null,
              mission_order_updated_at: mo?.updated_at || null,
              secretary_signed_at: mo?.secretary_signed_at || null,
              director_preapproved_at: mo?.director_preapproved_at || null,
              title: mo?.title || null,
              inspector_names: mo?.id ? inspectorNamesByMissionOrderId.get(mo.id) || [] : [],
              revision_count: revCount,
            };
          });

          // Only include completed mission orders for the History view (match Head Inspector 'revisions' tab)
          const statusFiltered = (tab === 'mission-orders-history')
            ? (merged || []).filter((r) => String(r.mission_order_status || '').toLowerCase() === 'complete')
            : merged;

          const searchVal = search.trim().toLowerCase();
          const filtered = !searchVal
            ? statusFiltered
            : statusFiltered.filter((r) => {
                const hay = [r.business_name, r.business_address, r.reporter_email, r.complaint_id, r.mission_order_id]
                  .filter(Boolean)
                  .join(' ')
                  .toLowerCase();
                return hay.includes(searchVal);
              });

          setMissionOrders(filtered);
          // allow finally to unset loading
          return;
        } catch (e) {
          setError(e?.message || 'Failed to load mission orders.');
          setMissionOrders([]);
          return;
        }
      } else if (tab === 'inspection') {
        // Director Inspection tab: show all pending and in-progress inspections.
        // Use a broader selection: include mission orders that are explicitly 'for inspection'
        // OR mission orders referenced by inspection_reports in pending/in progress.
        try {
          // 1) Load mission orders with status 'for inspection' (pre-approved)
          const { data: moForInspectionRows, error: moForErr } = await supabase
            .from('mission_orders')
            .select('id, complaint_id, status, date_of_inspection, title, created_at')
            .in('status', ['for inspection', 'for_inspection'])
            .order('created_at', { ascending: false })
            .limit(500);

          if (moForErr) throw moForErr;

          // 2) Load inspection reports that are pending or in-progress so we can include MOs with active reports
          const { data: reportRows, error: reportErr } = await supabase
            .from('inspection_reports')
            .select('mission_order_id, status')
            .in('status', ['pending inspection', 'pending_inspection', 'pending', 'in progress', 'in_progress'])
            .limit(2000);

          if (reportErr) throw reportErr;

          const reportMoIds = Array.from(new Set((reportRows || []).map((r) => r?.mission_order_id).filter(Boolean)));

          // 3) Combine mission order ids (from for-inspection rows + those referenced in active reports)
          const moIdsSet = new Set((moForInspectionRows || []).map((m) => m.id).filter(Boolean));
          reportMoIds.forEach((id) => moIdsSet.add(id));

          const missionOrderIds = Array.from(moIdsSet);

          // 4) Fetch mission orders for these ids (to get complaint_id and date info)
          const { data: moRows, error: moErr } = missionOrderIds.length
            ? await supabase
                .from('mission_orders')
                .select('id, complaint_id, status, date_of_inspection, title, created_at')
                .in('id', missionOrderIds)
            : { data: [], error: null };

          if (moErr) throw moErr;

          const complaintIds = Array.from(new Set((moRows || []).map((m) => m?.complaint_id).filter(Boolean)));

          // Fetch complaint info (business name/address)
          const complaintMap = new Map();
          if (complaintIds.length) {
            const { data: complaintRows, error: complaintErr } = await supabase
              .from('complaints')
              .select('id, business_name, business_address')
              .in('id', complaintIds);
            if (complaintErr) console.warn('Failed to load complaints', complaintErr);
            (complaintRows || []).forEach((c) => complaintMap.set(c?.id, c));
          }

          // Load assignments -> profiles for inspector display names
          const inspectorNamesByMoId = new Map();
          if (missionOrderIds.length) {
            const { data: assignmentRows, error: assignmentErr } = await supabase
              .from('mission_order_assignments')
              .select('mission_order_id, inspector_id')
              .in('mission_order_id', missionOrderIds);
            if (assignmentErr) console.warn('Failed to load assignments', assignmentErr);
            else if ((assignmentRows || []).length) {
              const inspectorIds = Array.from(new Set((assignmentRows || []).map((a) => a?.inspector_id).filter(Boolean)));
              let profileById = new Map();
              if (inspectorIds.length) {
                const { data: profileRows, error: profileErr } = await supabase
                  .from('profiles')
                  .select('id, full_name, first_name, middle_name, last_name')
                  .in('id', inspectorIds);
                if (profileErr) console.warn('Failed to load profiles', profileErr);
                else profileById = new Map((profileRows || []).map((p) => [p.id, p]));
              }
              (assignmentRows || []).forEach((a) => {
                if (!a?.mission_order_id || !a?.inspector_id) return;
                const p = profileById.get(a.inspector_id) || {};
                const displayName = p?.full_name || [p?.first_name, p?.middle_name, p?.last_name].filter(Boolean).join(' ') || String(a.inspector_id).slice(0, 8);
                const arr = inspectorNamesByMoId.get(a.mission_order_id) || [];
                arr.push(displayName);
                inspectorNamesByMoId.set(a.mission_order_id, arr);
              });
            }
          }

          // Load inspection reports for these mission orders to compute inspection status (choose highest priority)
          const inspectionStatusByMoId = new Map();
          if (missionOrderIds.length) {
            const { data: allReports, error: allReportsErr } = await supabase
              .from('inspection_reports')
              .select('mission_order_id, status, updated_at, created_at, completed_at')
              .in('mission_order_id', missionOrderIds)
              .order('updated_at', { ascending: false })
              .limit(2000);

            if (allReportsErr) console.warn('Failed to load inspection reports', allReportsErr);
            else {
              const normalizeInspectionStatus = (v) => String(v || '').toLowerCase().trim();
              const inspectionPriority = (v) => {
                const s = normalizeInspectionStatus(v);
                if (s === 'in progress' || s === 'in_progress') return 3;
                if (s === 'pending inspection' || s === 'pending_inspection' || s === 'pending') return 2;
                if (s === 'completed' || s === 'complete') return 1;
                return 0;
              };
              for (const r of allReports || []) {
                const moId = r?.mission_order_id;
                if (!moId) continue;
                const cur = inspectionStatusByMoId.get(moId);
                if (!cur) {
                  inspectionStatusByMoId.set(moId, r?.status || 'pending inspection');
                  continue;
                }
                if (inspectionPriority(r?.status) > inspectionPriority(cur)) {
                  inspectionStatusByMoId.set(moId, r?.status || 'pending inspection');
                }
              }
            }
          }

          // Merge all data
          const merged = (moRows || []).map((mo) => ({
            ...mo,
            mission_order_id: mo.id,
            business_name: complaintMap.get(mo.complaint_id)?.business_name || '—',
            business_address: complaintMap.get(mo.complaint_id)?.business_address || '',
            inspection_status: inspectionStatusByMoId.get(mo.id) || 'pending inspection',
            inspector_names: inspectorNamesByMoId.get(mo.id) || [],
          }));

          setMissionOrders(merged);
          setLoading(false);
          return;
        } catch (e) {
          console.warn('Failed to load director inspection rows', e);
          setMissionOrders([]);
          setLoading(false);
          return;
        }
      } else if (tab === 'inspection-history') {
        // Inspection History: show completed inspections via inspection_reports
        // We need to join with inspection_reports to get completed inspections
        query = supabase
          .from('inspection_reports')
          .select('id, mission_order_id, status, completed_at, business_name')
          .eq('status', 'completed')
          .order('completed_at', { ascending: false })
          .limit(200);

        // Apply completed_at date range for Inspection History using the calendar date range picker
        if (appliedRange?.start && appliedRange?.end) {
          const start = new Date(appliedRange.start.getFullYear(), appliedRange.start.getMonth(), appliedRange.start.getDate());
          const endExclusive = new Date(appliedRange.end.getFullYear(), appliedRange.end.getMonth(), appliedRange.end.getDate() + 1);
          query = query.gte('completed_at', start.toISOString()).lt('completed_at', endExclusive.toISOString());
        }

        const searchVal = search.trim();
        if (searchVal) {
          query = query.or(`business_name.ilike.%${searchVal}%,id::text.ilike.%${searchVal}%,mission_order_id::text.ilike.%${searchVal}%`);
        }

        const { data: inspRows, error: inspErr } = await query;
        if (inspErr) throw inspErr;

        // Merge mission order inspection dates so Director view can display the scheduled inspection date
        const missionOrderIds = Array.from(new Set((inspRows || []).map((r) => r.mission_order_id).filter(Boolean)));
        let moMap = new Map();
        let complaintMap = new Map();

        if (missionOrderIds.length) {
          const { data: moRows, error: moErr } = await supabase
            .from('mission_orders')
            .select('id, date_of_inspection, complaint_id')
            .in('id', missionOrderIds);

          if (moErr) {
            console.warn('Failed to load mission orders for inspection dates', moErr);
          } else {
            moMap = new Map((moRows || []).map((m) => [m.id, m]));

            const complaintIds = Array.from(new Set((moRows || []).map((m) => m.complaint_id).filter(Boolean)));
            if (complaintIds.length) {
              const { data: complaintRows, error: complaintErr } = await supabase
                .from('complaints')
                .select('id, business_name, business_address')
                .in('id', complaintIds);

              if (complaintErr) {
                console.warn('Failed to load complaints for inspection rows', complaintErr);
              } else {
                complaintMap = new Map((complaintRows || []).map((c) => [c.id, c]));
              }
            }
          }
        }

        // Also load assignment -> profile so we can show inspector display names for Director view
        const inspectorNamesByMoId = new Map();
        if (missionOrderIds.length) {
          try {
            const { data: assignmentRows, error: assignmentErr } = await supabase
              .from('mission_order_assignments')
              .select('mission_order_id, inspector_id')
              .in('mission_order_id', missionOrderIds);

            if (assignmentErr) {
              console.warn('Failed to load mission_order_assignments for inspection rows', assignmentErr);
            } else if ((assignmentRows || []).length) {
              const inspectorIds = Array.from(new Set((assignmentRows || []).map((a) => a.inspector_id).filter(Boolean)));
              let profileById = new Map();
              if (inspectorIds.length) {
                try {
                  const { data: profileRows, error: profileErr } = await supabase
                    .from('profiles')
                    .select('id, full_name, first_name, middle_name, last_name')
                    .in('id', inspectorIds);
                  if (profileErr) {
                    console.warn('Failed to load profiles for inspectors', profileErr);
                  } else {
                    profileById = new Map((profileRows || []).map((p) => [p.id, p]));
                  }
                } catch (pe) {
                  console.warn('Failed to fetch inspector profiles', pe);
                }
              }

              (assignmentRows || []).forEach((a) => {
                if (!a?.mission_order_id || !a?.inspector_id) return;
                const p = profileById.get(a.inspector_id) || {};
                const displayName = p?.full_name || [p?.first_name, p?.middle_name, p?.last_name].filter(Boolean).join(' ') || String(a.inspector_id).slice(0, 8);
                const arr = inspectorNamesByMoId.get(a.mission_order_id) || [];
                arr.push(displayName);
                inspectorNamesByMoId.set(a.mission_order_id, arr);
              });
            }
          } catch (e) {
            console.warn('Failed to load inspector assignments/profiles', e);
          }
        }

        const merged = (inspRows || []).map((r) => {
          const mo = moMap.get(r.mission_order_id) || {};
          const complaint = mo?.complaint_id ? complaintMap.get(mo.complaint_id) : null;
          return {
            ...r,
            date_of_inspection: mo.date_of_inspection || null,
            business_name: (complaint && complaint.business_name) || r.business_name || '—',
            business_address: (complaint && complaint.business_address) || '',
            inspector_names: inspectorNamesByMoId.get(r.mission_order_id) || [],
          };
        });

        setMissionOrders(merged);
        setLoading(false);
        return;
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
    if (tab === 'mission-orders' || tab === 'mission-orders-history' || tab === 'inspection' || tab === 'inspection-history') {
      loadMissionOrders();
    } else {
      loadComplaints();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, appliedRange.start, appliedRange.end]);

  // Reload history when applied date range changes or filters change
  useEffect(() => {
    if (tab === 'history') {
      loadComplaints();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appliedRange.start, appliedRange.end, filters.businessName, filters.address, filters.reporterEmail, filters.complaintId, search]);

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
    // If a field filter is active, don't apply client-side filtering (backend already filtered)
    const hasFieldFilter = filters.businessName || filters.address || filters.reporterEmail || filters.complaintId;
    if (hasFieldFilter) {
      return complaints;
    }

    // Broad client-side filtering across common fields when no specific field filter is active.
    const q = search.trim().toLowerCase();
    if (!q) return complaints;

    return complaints.filter((c) => {
      const idStr = String(c?.id ?? '').toLowerCase();
      const nameStr = String(c?.business_name ?? '').toLowerCase();
      const addrStr = String(c?.business_address ?? '').toLowerCase();
      const emailStr = String(c?.reporter_email ?? '').toLowerCase();
      return (
        idStr.includes(q) ||
        nameStr.includes(q) ||
        addrStr.includes(q) ||
        emailStr.includes(q)
      );
    });
  }, [complaints, search, filters]);

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
    if (tab === 'mission-orders' || tab === 'mission-orders-history') return { groups: {}, sortedKeys: [] };
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

  // Group mission orders by day for Mission Order History (match Head Inspector behavior)
  const missionOrdersByDay = useMemo(() => {
    if (tab !== 'mission-orders-history') return { groups: {}, sortedKeys: [] };
    const groups = {};

    for (const mo of filteredMissionOrders) {
      // Bucket rows by the most relevant timestamp for the current view.
      // Prefer mission order creation date, then complaint approval, then complaint created.
      const dtRaw = mo.mission_order_created_at || mo.approved_at || mo.created_at || null;
      const dt = dtRaw ? new Date(dtRaw) : null;
      const key = dt ? `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}` : 'unknown';

      if (!groups[key]) {
        const label = dt ? dt.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }) : 'Unknown Date';
        groups[key] = { label, items: [] };
      }
      groups[key].items.push(mo);
    }

    // Sort items within each day by mission_order_created_at (newest first), fallback to submitted_at
    for (const key in groups) {
      groups[key].items.sort((a, b) => {
        const timeA = a.mission_order_created_at ? new Date(a.mission_order_created_at).getTime() : a.submitted_at ? new Date(a.submitted_at).getTime() : 0;
        const timeB = b.mission_order_created_at ? new Date(b.mission_order_created_at).getTime() : b.submitted_at ? new Date(b.submitted_at).getTime() : 0;
        return timeB - timeA;
      });
    }

    const sortedKeys = Object.keys(groups).sort((a, b) => (a < b ? 1 : -1));
    return { groups, sortedKeys };
  }, [filteredMissionOrders, tab]);

  // Group inspections by completed date for Inspection History
  const inspectionsByDay = useMemo(() => {
    if (tab !== 'inspection-history') return { groups: {}, sortedKeys: [] };
    const groups = {};

    for (const inspection of filteredMissionOrders) {
      const d = inspection.completed_at ? new Date(inspection.completed_at) : null;
      const key = d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : 'unknown';

      if (!groups[key]) {
        const label = d ? d.toLocaleDateString(undefined, { month: 'long', day: 'numeric' }) : 'Unknown Date';
        groups[key] = { label, items: [] };
      }
      groups[key].items.push(inspection);
    }

    // Sort items within each day by completed_at (newest first)
    for (const key in groups) {
      groups[key].items.sort((a, b) => {
        const timeA = a.completed_at ? new Date(a.completed_at).getTime() : 0;
        const timeB = b.completed_at ? new Date(b.completed_at).getTime() : 0;
        return timeB - timeA;
      });
    }

    const sortedKeys = Object.keys(groups).sort((a, b) => (a < b ? 1 : -1));
    return { groups, sortedKeys };
  }, [filteredMissionOrders, tab]);

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
        .select('id, status, created_at, updated_at, authenticity_level, business_name, business_address, reporter_email, complaint_description, image_urls, approved_by, approved_at, declined_by, declined_at, tags')
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

    const newToday = (complaints || []).filter((c) => inReview.includes(sLower(c.status)) && isToday(c.created_at)).length;
    const pendingReview = (complaints || []).filter((c) => inReview.includes(sLower(c.status))).length;
    const approvedToday = (complaints || []).filter((c) => sLower(c.status) === 'approved' && isToday(c.approved_at)).length;
    const declinedToday = (complaints || []).filter((c) => sLower(c.status) === 'declined' && isToday(c.declined_at)).length;

    const moIssued = (missionOrders || []).filter((m) => sLower(m.status) === 'issued').length;

    // Complaints submitted bar chart (date range)
    const rangeStart = appliedRange?.start ? startOfDayLocal(appliedRange.start) : null;
    const rangeEnd = appliedRange?.end ? startOfDayLocal(appliedRange.end) : null;

    // Default to last 7 days if no range selected
    const defaultStart = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6);
    const defaultEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate());

    const start = rangeStart || defaultStart;
    const end = rangeEnd || defaultEnd;

    // Ensure start <= end
    const startSafe = start <= end ? start : end;
    const endSafe = start <= end ? end : start;

    const dayCount = Math.floor((startOfDayLocal(endSafe).getTime() - startOfDayLocal(startSafe).getTime()) / 86400000) + 1;

    // Decide grouping
    // - <= 14 days: by date
    // - 15–60 days: by week
    // - > 60 days: by month
    const groupMode = dayCount <= 14 ? 'day' : dayCount <= 60 ? 'week' : 'month';

    // Helpers for grouping
    const ymdKey = (d) => d.toISOString().slice(0, 10);
    const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const monthLabel = (d) => d.toLocaleDateString(undefined, { month: 'long' });

    // Monday-based week start
    const startOfWeekMon = (d) => {
      const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      const dow = x.getDay(); // 0 Sun..6 Sat
      const offset = (dow + 6) % 7; // 0 for Mon
      return new Date(x.getFullYear(), x.getMonth(), x.getDate() - offset);
    };

    const groups = new Map();

    // Pre-create buckets so we show empty periods too
    if (groupMode === 'day') {
      for (let d = new Date(startSafe.getFullYear(), startSafe.getMonth(), startSafe.getDate()); d <= endSafe; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
        const key = ymdKey(d);
        groups.set(key, {
          key,
          label: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
          count: 0,
        });
      }
    } else if (groupMode === 'week') {
      let ws = startOfWeekMon(startSafe);
      const endDay = new Date(endSafe.getFullYear(), endSafe.getMonth(), endSafe.getDate());
      while (ws <= endDay) {
        const we = new Date(ws.getFullYear(), ws.getMonth(), ws.getDate() + 6);
        const key = `${ymdKey(ws)}_W`;
        const label = `${ws.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${we.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
        groups.set(key, { key, label, count: 0, rangeStart: ws, rangeEnd: we });
        ws = new Date(ws.getFullYear(), ws.getMonth(), ws.getDate() + 7);
      }
    } else {
      // month
      let m = new Date(startSafe.getFullYear(), startSafe.getMonth(), 1);
      const endMonth = new Date(endSafe.getFullYear(), endSafe.getMonth(), 1);
      while (m <= endMonth) {
        const key = monthKey(m);
        groups.set(key, { key, label: monthLabel(m), count: 0, monthIndex: m.getMonth(), year: m.getFullYear() });
        m = new Date(m.getFullYear(), m.getMonth() + 1, 1);
      }
    }

    // Aggregate complaints into buckets
    (complaints || []).forEach((c) => {
      const t = c.created_at ? new Date(c.created_at) : null;
      if (!t) return;
      const td = startOfDayLocal(t);
      if (td < startSafe || td > endSafe) return;

      if (groupMode === 'day') {
        const key = ymdKey(td);
        const g = groups.get(key);
        if (g) g.count += 1;
      } else if (groupMode === 'week') {
        const ws = startOfWeekMon(td);
        const key = `${ymdKey(ws)}_W`;
        const g = groups.get(key);
        if (g) g.count += 1;
      } else {
        const key = monthKey(td);
        const g = groups.get(key);
        if (g) g.count += 1;
      }
    });

    const rows = Array.from(groups.values());

    // Sort chronologically
    if (groupMode === 'day') {
      rows.sort((a, b) => (a.key < b.key ? -1 : 1));
    } else if (groupMode === 'week') {
      rows.sort((a, b) => (a.key < b.key ? -1 : 1));
    } else {
      rows.sort((a, b) => {
        const ay = a.year ?? 0;
        const by = b.year ?? 0;
        if (ay !== by) return ay - by;
        return (a.monthIndex ?? 0) - (b.monthIndex ?? 0);
      });
    }

    const max = rows.reduce((m, x) => Math.max(m, x.count), 0) || 1;

    // Title timeframe
    const fmt = (dt) => dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    const timeframeLabel = appliedRange?.start && appliedRange?.end
      ? `Custom (${fmt(startSafe)} — ${fmt(endSafe)})`
      : 'Last 7 Days';

    return {
      newToday,
      pendingReview,
      approvedToday,
      declinedToday,
      moIssued,
      days: rows,
      max,
      rangeStart: startSafe,
      rangeEnd: endSafe,
      groupMode,
      timeframeLabel,
    };
  }, [complaints, missionOrders, appliedRange.start, appliedRange.end]);

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

        // Notify Head Inspector when complaint is approved
        try {
          const { data: complaint } = await supabase
            .from('complaints')
            .select('business_name')
            .eq('id', complaintId)
            .single();

          await notifyHeadInspectorComplaintApproved(
            complaintId,
            complaint?.business_name || 'Unknown Business'
          );
        } catch (notifErr) {
          console.error('Failed to send notification:', notifErr);
          // Don't fail the approval if notification fails
        }
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
              <li>
                <button type="button" className={`dash-nav-item ${tab === 'mission-orders-history' ? 'active' : ''}`} onClick={() => setTab('mission-orders-history')}>
                  <span className="dash-nav-ico" aria-hidden="true" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                    <img src="/ui_icons/history.png" alt="" style={{ width: 22, height: 22, objectFit: 'contain', display: 'block', filter: 'brightness(0) saturate(100%) invert(62%) sepia(94%) saturate(1456%) hue-rotate(7deg) brightness(88%) contrast(108%)' }} />
                  </span>
                  <span className="dash-nav-label" style={{ display: navCollapsed ? 'none' : 'inline' }}>Mission Order History</span>
                </button>
              </li>

              <li className="dash-nav-section">
                <span className="dash-nav-section-label" style={{ display: navCollapsed ? 'none' : 'inline' }}>Inspection</span>
              </li>
              <li>
                <button type="button" className={`dash-nav-item ${tab === 'inspection' ? 'active' : ''}`} onClick={() => setTab('inspection')}>
                  <span className="dash-nav-ico" aria-hidden="true" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                    <img src="/ui_icons/inspection.png" alt="" style={{ width: 22, height: 22, objectFit: 'contain', display: 'block', filter: 'brightness(0) saturate(100%) invert(62%) sepia(94%) saturate(1456%) hue-rotate(7deg) brightness(88%) contrast(108%)' }} />
                  </span>
                  <span className="dash-nav-label" style={{ display: navCollapsed ? 'none' : 'inline' }}>Inspections</span>
                </button>
              </li>
              <li>
                <button type="button" className={`dash-nav-item ${tab === 'inspection-history' ? 'active' : ''}`} onClick={() => setTab('inspection-history')}>
                  <span className="dash-nav-ico" aria-hidden="true" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                    <img src="/ui_icons/history.png" alt="" style={{ width: 22, height: 22, objectFit: 'contain', display: 'block', filter: 'brightness(0) saturate(100%) invert(62%) sepia(94%) saturate(1456%) hue-rotate(7deg) brightness(88%) contrast(108%)' }} />
                  </span>
                  <span className="dash-nav-label" style={{ display: navCollapsed ? 'none' : 'inline' }}>Inspection History</span>
                </button>
              </li>

              <li className="dash-nav-section">
                <span className="dash-nav-section-label" style={{ display: navCollapsed ? 'none' : 'inline' }}>Reports</span>
              </li>
              <li>
                <button type="button" className={`dash-nav-item ${tab === 'reports' ? 'active' : ''}`} onClick={() => setTab('reports')}>
                  <span className="dash-nav-ico" aria-hidden="true" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                    <img src="/ui_icons/document.png" alt="" style={{ width: 22, height: 22, objectFit: 'contain', display: 'block', filter: 'brightness(0) saturate(100%) invert(62%) sepia(94%) saturate(1456%) hue-rotate(7deg) brightness(88%) contrast(108%)' }} />
                  </span>
                  <span className="dash-nav-label" style={{ display: navCollapsed ? 'none' : 'inline' }}>Performance Report</span>
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
            <div className="dash-actions">
              <NotificationBell userId={currentUserId} />
            </div>
          </div>

          {(tab === 'history' || tab === 'mission-orders-history') && (
            <div style={{ marginBottom: 20, display: 'grid', gap: 12 }}>
              {/* Search Bar */}
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <div style={{ flex: 1, position: 'relative' }}>
                  <input
                    type="text"
                    placeholder={tab === 'mission-orders-history' ? 'Search mission orders...' : 'Search complaints...'}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '12px 16px',
                      background: '#ffffff',
                      color: '#0f172a',
                      border: '2px solid #cbd5e1',
                      borderRadius: 10,
                      fontSize: 14,
                      fontWeight: 500,
                      outline: 'none',
                      transition: 'all 0.2s ease',
                      boxShadow: '0 2px 4px rgba(0, 0, 0, 0.04)'
                    }}
                    onFocus={(e) => {
                      e.target.style.borderColor = '#2563eb';
                      e.target.style.boxShadow = '0 0 0 3px rgba(37, 99, 235, 0.1), 0 2px 8px rgba(0, 0, 0, 0.08)';
                      setSearchFocused(true);
                    }}
                    onBlur={(e) => {
                      e.target.style.borderColor = '#cbd5e1';
                      e.target.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.04)';
                      setSearchFocused(false);
                    }}
                  />
                </div>
              </div>

              {/* Advanced Filters Panel - Shows when search is focused */}
              {tab === 'history' && searchFocused && (
                <div 
                  onMouseDown={(e) => e.preventDefault()}
                  style={{
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    borderRadius: 12,
                    padding: 16,
                    display: 'grid',
                    gap: 16,
                    animation: 'fadeIn 0.2s ease-in-out'
                  }}>
                  <style>{`
                    @keyframes fadeIn {
                      from {
                        opacity: 0;
                        transform: translateY(-8px);
                      }
                      to {
                        opacity: 1;
                        transform: translateY(0);
                      }
                    }
                  `}</style>

                  {/* Field Filters Section - Pill Style */}
                  <div>
                    <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 12px 0', fontWeight: 600 }}>Narrow down your search</p>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', position: 'relative' }}>
                      {/* Business Name Pill */}
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          if (filters.businessName !== '') {
                            setFilters({ businessName: '', address: '', reporterEmail: '', complaintId: '', dateMonth: null, dateDay: null });
                          } else {
                            setFilters({ businessName: 'active', address: '', reporterEmail: '', complaintId: '', dateMonth: null, dateDay: null });
                          }
                        }}
                        style={{
                          padding: '6px 14px',
                          background: filters.businessName !== '' ? '#2563eb' : '#ffffff',
                          color: filters.businessName !== '' ? '#ffffff' : '#0f172a',
                          border: `1px solid ${filters.businessName !== '' ? '#2563eb' : '#cbd5e1'}`,
                          borderRadius: 999,
                          cursor: 'pointer',
                          fontWeight: 600,
                          fontSize: 13,
                          transition: 'all 0.2s ease',
                          whiteSpace: 'nowrap'
                        }}
                        onMouseEnter={(e) => {
                          if (filters.businessName === '') {
                            e.currentTarget.style.borderColor = '#2563eb';
                            e.currentTarget.style.color = '#2563eb';
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (filters.businessName === '') {
                            e.currentTarget.style.borderColor = '#cbd5e1';
                            e.currentTarget.style.color = '#0f172a';
                          }
                        }}
                      >
                        Business Name
                      </button>

                      {/* Address Pill */}
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          if (filters.address !== '') {
                            setFilters({ businessName: '', address: '', reporterEmail: '', complaintId: '', dateMonth: null, dateDay: null });
                          } else {
                            setFilters({ businessName: '', address: 'active', reporterEmail: '', complaintId: '', dateMonth: null, dateDay: null });
                          }
                        }}
                        style={{
                          padding: '6px 14px',
                          background: filters.address !== '' ? '#2563eb' : '#ffffff',
                          color: filters.address !== '' ? '#ffffff' : '#0f172a',
                          border: `1px solid ${filters.address !== '' ? '#2563eb' : '#cbd5e1'}`,
                          borderRadius: 999,
                          cursor: 'pointer',
                          fontWeight: 600,
                          fontSize: 13,
                          transition: 'all 0.2s ease',
                          whiteSpace: 'nowrap'
                        }}
                        onMouseEnter={(e) => {
                          if (filters.address === '') {
                            e.currentTarget.style.borderColor = '#2563eb';
                            e.currentTarget.style.color = '#2563eb';
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (filters.address === '') {
                            e.currentTarget.style.borderColor = '#cbd5e1';
                            e.currentTarget.style.color = '#0f172a';
                          }
                        }}
                      >
                        Address
                      </button>

                      {/* Reporter Email Pill */}
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          if (filters.reporterEmail !== '') {
                            setFilters({ businessName: '', address: '', reporterEmail: '', complaintId: '', dateMonth: null, dateDay: null });
                          } else {
                            setFilters({ businessName: '', address: '', reporterEmail: 'active', complaintId: '', dateMonth: null, dateDay: null });
                          }
                        }}
                        style={{
                          padding: '6px 14px',
                          background: filters.reporterEmail !== '' ? '#2563eb' : '#ffffff',
                          color: filters.reporterEmail !== '' ? '#ffffff' : '#0f172a',
                          border: `1px solid ${filters.reporterEmail !== '' ? '#2563eb' : '#cbd5e1'}`,
                          borderRadius: 999,
                          cursor: 'pointer',
                          fontWeight: 600,
                          fontSize: 13,
                          transition: 'all 0.2s ease',
                          whiteSpace: 'nowrap'
                        }}
                        onMouseEnter={(e) => {
                          if (filters.reporterEmail === '') {
                            e.currentTarget.style.borderColor = '#2563eb';
                            e.currentTarget.style.color = '#2563eb';
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (filters.reporterEmail === '') {
                            e.currentTarget.style.borderColor = '#cbd5e1';
                            e.currentTarget.style.color = '#0f172a';
                          }
                        }}
                      >
                        Reporter Email
                      </button>

                      {/* Complaint ID Pill */}
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          if (filters.complaintId !== '') {
                            setFilters({ businessName: '', address: '', reporterEmail: '', complaintId: '', dateMonth: null, dateDay: null });
                          } else {
                            setFilters({ businessName: '', address: '', reporterEmail: '', complaintId: 'active', dateMonth: null, dateDay: null });
                          }
                        }}
                        style={{
                          padding: '6px 14px',
                          background: filters.complaintId !== '' ? '#2563eb' : '#ffffff',
                          color: filters.complaintId !== '' ? '#ffffff' : '#0f172a',
                          border: `1px solid ${filters.complaintId !== '' ? '#2563eb' : '#cbd5e1'}`,
                          borderRadius: 999,
                          cursor: 'pointer',
                          fontWeight: 600,
                          fontSize: 13,
                          transition: 'all 0.2s ease',
                          whiteSpace: 'nowrap'
                        }}
                        onMouseEnter={(e) => {
                          if (filters.complaintId === '') {
                            e.currentTarget.style.borderColor = '#2563eb';
                            e.currentTarget.style.color = '#2563eb';
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (filters.complaintId === '') {
                            e.currentTarget.style.borderColor = '#cbd5e1';
                            e.currentTarget.style.color = '#0f172a';
                          }
                        }}
                      >
                        Complaint ID
                      </button>

                      {/* Date Filter Pill with Popup */}
                      <div className="date-filter" style={{ position: 'relative' }}>
                        <button
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
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
                          style={{
                            padding: '6px 14px',
                            background: datePopoverOpen || (appliedRange.start && appliedRange.end) ? '#2563eb' : '#ffffff',
                            color: datePopoverOpen || (appliedRange.start && appliedRange.end) ? '#ffffff' : '#0f172a',
                            border: `1px solid ${datePopoverOpen || (appliedRange.start && appliedRange.end) ? '#2563eb' : '#cbd5e1'}`,
                            borderRadius: 999,
                            cursor: 'pointer',
                            fontWeight: 600,
                            fontSize: 13,
                            transition: 'all 0.2s ease',
                            whiteSpace: 'nowrap'
                          }}
                          onMouseEnter={(e) => {
                            if (!datePopoverOpen && (!appliedRange.start || !appliedRange.end)) {
                              e.currentTarget.style.borderColor = '#2563eb';
                              e.currentTarget.style.color = '#2563eb';
                            }
                          }}
                          onMouseLeave={(e) => {
                            if (!datePopoverOpen && (!appliedRange.start || !appliedRange.end)) {
                              e.currentTarget.style.borderColor = '#cbd5e1';
                              e.currentTarget.style.color = '#0f172a';
                            }
                          }}
                        >
                          Date
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
                                {pendingRange.start && pendingRange.end ? formatRangeLabel(pendingRange.start, pendingRange.end) : 'Select a start and end date'}
                              </div>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>

                                  </div>
              )}
            </div>
          )}

          {error ? <div className="dash-alert dash-alert-error">{error}</div> : null}

          {tab === 'mission-orders-history' ? (
            <MissionOrderHistory
              missionOrdersByDay={missionOrdersByDay}
              expandedComplaintId={expandedComplaintId}
              setExpandedComplaintId={setExpandedComplaintId}
              onRowClick={(mo) => window.location.assign(`/mission-order?id=${encodeURIComponent(mo.mission_order_id || mo.id || mo.mission_order_id)}`)}
              formatStatus={formatStatusHI}
              statusBadgeClass={statusBadgeClassHI}
            />
          ) : tab === 'reports' ? (
            <DirectorReports />
          ) : tab === 'mission-orders-history' ? (
            <div style={{ display: 'grid', gap: 20 }}>
              {missionOrdersByDay.sortedKeys.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 32, color: '#475569', background: '#f8fafc', borderRadius: 12, border: '1px solid #e2e8f0' }}>
                  {loading ? 'Loading…' : 'No mission orders found.'}
                </div>
              ) : (
                missionOrdersByDay.sortedKeys.map((dayKey) => {
                  const dayGroup = missionOrdersByDay.groups[dayKey];
                  const count = dayGroup?.items?.length || 0;
                  if (count === 0) return null;

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
                      onMouseEnter={(e) => { e.currentTarget.style.boxShadow = '0 8px 20px rgba(2,6,23,0.12)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.boxShadow = '0 4px 12px rgba(2,6,23,0.08)'; }}
                    >
                      <div style={{ padding: '18px 24px', background: '#0b2249', borderBottom: 'none' }}>
                        <h3 style={{ margin: 0, fontSize: 18, fontWeight: 900, color: '#ffffff' }}>
                          {new Date(dayKey).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}
                        </h3>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#F2B705', marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#F2B705', flexShrink: 0 }}></div>
                          <span>{count} Mission Order{count !== 1 ? 's' : ''}</span>
                        </div>
                      </div>

                      <div style={{ overflowX: 'auto' }}>
                        <table className="dash-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                          <thead>
                            <tr style={{ background: '#ffffff', borderBottom: '1px solid #e2e8f0' }}>
                              <th style={{ width: 40, padding: '12px', textAlign: 'center', fontWeight: 800, fontSize: 12, color: '#64748b' }}></th>
                              <th style={{ width: 150, padding: '12px', textAlign: 'left', fontWeight: 800, fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>MO Status</th>
                              <th style={{ padding: '12px', textAlign: 'left', fontWeight: 800, fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Mission Order</th>
                              <th style={{ width: 160, padding: '12px', textAlign: 'left', fontWeight: 800, fontSize: 12, color: '#64748b', textTransform: 'uppercase' }}>Inspection Date</th>
                              <th style={{ width: 140, padding: '12px', textAlign: 'left', fontWeight: 800, fontSize: 12, color: '#64748b', textTransform: 'uppercase' }}>Inspectors</th>
                            </tr>
                          </thead>
                          <tbody>
                            {dayGroup.items.map((mo) => (
                              <>
                                <tr
                                  key={mo.id}
                                  onClick={() => { window.location.assign(`/mission-order?id=${encodeURIComponent(mo.id)}`); }}
                                  style={{ cursor: 'pointer', borderBottom: '1px solid #e2e8f0', transition: 'background-color 0.2s ease', position: 'relative' }}
                                  onMouseEnter={(e) => { e.currentTarget.style.background = '#f8fafc'; }}
                                  onMouseLeave={(e) => { e.currentTarget.style.background = '#ffffff'; }}
                                >
                                  <td style={{ padding: '12px', textAlign: 'center' }}>
                                    <button type="button" onClick={(e) => { e.stopPropagation(); setExpandedComplaintId(expandedComplaintId === mo.complaint_id ? null : mo.complaint_id); }} style={{ background: 'none', border: 'none', outline: 'none', cursor: 'pointer', padding: 0, color: '#64748b', transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)', transform: expandedComplaintId === mo.complaint_id ? 'rotate(180deg)' : 'rotate(0deg)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24 }}>
                                      <svg width="20" height="20" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M80 160L256 320L432 160" stroke="currentColor" strokeWidth="40" strokeLinecap="round" strokeLinejoin="round"/></svg>
                                    </button>
                                  </td>
                                  <td>
                                    <span className={statusBadgeClass(mo.mission_order_status || mo.status)}>{formatStatus(mo.mission_order_status || mo.status)}</span>
                                  </td>
                                  <td>
                                    <div className="dash-cell-title">{mo.business_name || mo.title || 'Mission Order'}</div>
                                    <div className="dash-cell-sub">{mo.business_address || (mo.complaint_id ? ('Complaint: ' + (String(mo.complaint_id).slice(0, 8) + '…')) : '')}</div>
                                  </td>
                                  <td style={{ padding: '12px', fontSize: 14, color: '#1e293b' }}>
                                    {mo.date_of_inspection ? new Date(mo.date_of_inspection).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }) : '—'}
                                  </td>
                                  <td>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, minHeight: 30, alignItems: 'center', fontSize: 12 }}>
                                      {(mo.inspector_names || []).length === 0 ? (
                                        <span style={{ color: '#64748b', fontWeight: 700 }}>—</span>
                                      ) : (
                                        (mo.inspector_names || []).map((name, idx) => (
                                          <span key={`${mo.complaint_id}-${idx}`} style={{ padding: '4px 8px', borderRadius: 999, fontWeight: 700, border: '1px solid #e2e8f0', background: '#f8fafc', fontSize: 11 }}>
                                            {name}
                                          </span>
                                        ))
                                      )}
                                    </div>
                                  </td>
                                </tr>

                                {expandedComplaintId === mo.complaint_id && (
                                  <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', animation: 'slideDown 0.3s cubic-bezier(0.4, 0, 0.2, 1)' }}>
                                    <td colSpan="3" style={{ padding: '16px 24px' }}>
                                      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                                        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 8, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                                          <div style={{ fontSize: 14, fontWeight: 800, color: '#1e293b' }}>{mo.submitted_at ? new Date(mo.submitted_at).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }) + ' ' + new Date(mo.submitted_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : ''}</div>
                                          <div style={{ fontSize: 13, color: '#64748b', lineHeight: 1.5 }}>Mission Order Submitted</div>
                                        </div>

                                        {mo.created_at && (
                                          <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 8, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                                            <div style={{ fontSize: 14, fontWeight: 800, color: '#1e293b' }}>{new Date(mo.created_at).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }) + ' ' + new Date(mo.created_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</div>
                                            <div style={{ fontSize: 13, color: '#64748b', lineHeight: 1.5 }}>Mission Order Created</div>
                                          </div>
                                        )}
                                      </div>
                                    </td>
                                  </tr>
                                )}
                              </>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          ) : tab === 'mission-orders' ? (
            <div style={{ display: 'grid', gap: 20 }}>
              {filteredMissionOrders.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 32, color: '#475569', background: '#f8fafc', borderRadius: 12, border: '1px solid #e2e8f0' }}>
                  {loading ? 'Loading…' : 'No mission orders found.'}
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
                    <h3 style={{ margin: 0, fontSize: 18, fontWeight: 900, color: '#ffffff' }}>Review Pending Mission Orders</h3>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#E5E7EB', marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#F2B705', flexShrink: 0 }}></div>
                      <span>{filteredMissionOrders.length} {filteredMissionOrders.length === 1 ? 'Record' : 'Records'}</span>
                    </div>
                  </div>

                  {/* Table */}
                  <div style={{ overflowX: 'auto' }}>
                    <table className="dash-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ background: '#ffffff', borderBottom: '1px solid #e2e8f0' }}>
                          <th style={{ width: 120 }}>MO ID</th>
                          <th>Title</th>
                          <th style={{ width: 180 }}>Status</th>
                          <th style={{ width: 220 }}>Submitted</th>
                          <th style={{ width: 220 }}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredMissionOrders.map((mo) => (
                          <tr
                            key={mo.id}
                            style={{
                              cursor: 'pointer',
                              borderBottom: '1px solid #e2e8f0',
                              transition: 'background-color 0.2s ease',
                              position: 'relative',
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.background = '#f8fafc';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.background = '#ffffff';
                            }}
                          >
                            <td style={{ padding: '12px' }} title={mo.id}>{String(mo.id).slice(0, 8)}…</td>
                            <td style={{ padding: '12px' }}>
                              <div className="dash-cell-title">{mo.title || 'Mission Order'}</div>
                              <div className="dash-cell-sub">Complaint: {mo.complaint_id ? String(mo.complaint_id).slice(0, 8) + '…' : '—'}</div>
                            </td>
                            <td style={{ padding: '12px' }}>
                              <span className={statusBadgeClass(mo.status)}>{formatStatus(mo.status)}</span>
                            </td>
                            <td style={{ padding: '12px' }}>{formatDateNoSeconds(mo.submitted_at)}</td>
                            <td style={{ padding: '12px' }}>
                              <div className="dash-row-actions">
                                <a
                                  className="dash-btn"
                                  href={`/mission-order?id=${mo.id}`}
                                  onClick={() => {
                                    try {
                                      sessionStorage.setItem('missionOrderSource', 'review');
                                    } catch {
                                      // ignore
                                    }
                                  }}
                                >
                                  Open MO
                                </a>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          ) : tab === 'inspection' ? (
            <div style={{ display: 'grid', gap: 20 }}>
                  {(() => {
                    const normalize = (v) => String(v || '').toLowerCase().trim();
                    const pending = (filteredMissionOrders || [])
                      .filter((c) => normalize(c.inspection_status) === 'pending inspection')
                      .sort((a, b) => {
                        const tA = a.date_of_inspection ? new Date(a.date_of_inspection).getTime() : 0;
                        const tB = b.date_of_inspection ? new Date(b.date_of_inspection).getTime() : 0;
                        return tA - tB;
                      });

                    const inProgress = (filteredMissionOrders || [])
                      .filter((c) => normalize(c.inspection_status) === 'in progress')
                      .sort((a, b) => {
                        const tA = a.date_of_inspection ? new Date(a.date_of_inspection).getTime() : 0;
                        const tB = b.date_of_inspection ? new Date(b.date_of_inspection).getTime() : 0;
                        return tA - tB;
                      });

                    const Table = ({ title, rows, dotColor, countLabelSingular, countLabelPlural }) => (
                      <div
                        style={{
                          background: '#ffffff',
                          border: '1px solid #e2e8f0',
                          borderRadius: 14,
                          boxShadow: '0 4px 12px rgba(2,6,23,0.08)',
                          overflow: 'hidden',
                        }}
                      >
                        <div style={{ padding: '18px 24px', background: '#0b2249', borderBottom: 'none' }}>
                          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 900, color: '#ffffff' }}>{title}</h3>
                          <div style={{ fontSize: 13, fontWeight: 600, color: dotColor, marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{ width: 12, height: 12, borderRadius: '50%', background: dotColor, flexShrink: 0 }}></div>
                            <span>{rows.length} {rows.length === 1 ? countLabelSingular : countLabelPlural}</span>
                          </div>
                        </div>
                        <div style={{ overflowX: 'auto' }}>
                          <table className="dash-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                              <tr style={{ background: '#ffffff', borderBottom: '1px solid #e2e8f0' }}>
                                <th style={{ width: 160, padding: '12px', textAlign: 'left', fontWeight: 800, fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>INSPECTION STATUS</th>
                                <th style={{ padding: '12px', textAlign: 'left', fontWeight: 800, fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>BUSINESS & ADDRESS</th>
                                <th style={{ width: 200, padding: '12px', textAlign: 'left', fontWeight: 800, fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>INSPECTION DATE</th>
                                <th style={{ width: 200, padding: '12px', textAlign: 'left', fontWeight: 800, fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>INSPECTORS</th>
                              </tr>
                            </thead>
                            <tbody>
                              {rows.length === 0 ? (
                                <tr>
                                  <td colSpan="4" style={{ textAlign: 'center', padding: 24, color: '#475569' }}>
                                    {loading ? 'Loading…' : 'No records found.'}
                                  </td>
                                </tr>
                              ) : (
                                rows.map((c) => (
                                  <tr
                                    key={`insp-${title}-${c.mission_order_id || c.complaint_id}`}
                                    style={{ borderBottom: '1px solid #e2e8f0', cursor: c.mission_order_id ? 'pointer' : 'default' }}
                                    title={c.mission_order_id ? 'View inspection details' : 'No mission order available'}
                                    onClick={() => {
                                      if (c.mission_order_id) {
                                        window.location.assign(`/inspection-slip/review?missionOrderId=${c.mission_order_id}&role=director`);
                                      }
                                    }}
                                  >
                                    <td style={{ padding: '12px' }}>
                                      <span
                                        className={statusBadgeClassHI(c.inspection_status)}
                                        style={{ whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center' }}
                                      >
                                        {formatStatusHI(c.inspection_status)}
                                      </span>
                                    </td>
                                    <td style={{ padding: '12px' }}>
                                      <div className="dash-cell-title">{c.business_name || '—'}</div>
                                      <div className="dash-cell-sub">{c.business_address || ''}</div>
                                    </td>
                                    <td style={{ padding: '12px', fontSize: 14, color: '#1e293b' }}>
                                      {c.date_of_inspection ? new Date(c.date_of_inspection).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }) : '—'}
                                    </td>
                                    <td style={{ padding: '12px' }}>
                                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                        {(c.inspector_names || []).length === 0 ? (
                                          <span style={{ color: '#64748b', fontWeight: 700 }}>—</span>
                                        ) : (
                                          (c.inspector_names || []).map((name, idx) => (
                                            <span key={`${c.mission_order_id || c.complaint_id}-${idx}`} style={{ padding: '4px 8px', borderRadius: 999, fontWeight: 700, border: '1px solid #e2e8f0', background: '#f8fafc', fontSize: 11 }}>
                                              {name}
                                            </span>
                                          ))
                                        )}
                                      </div>
                                    </td>
                                  </tr>
                                ))
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    );

                    return (
                      <>
                        <Table
                          title="Pending Inspection"
                          rows={pending}
                          dotColor="#F2B705"
                          countLabelSingular="Pending Inspection"
                          countLabelPlural="Pending Inspections"
                        />
                        <Table
                          title="In Progress"
                          rows={inProgress}
                          dotColor="#60a5fa"
                          countLabelSingular="Ongoing Inspection"
                          countLabelPlural="Ongoing Inspections"
                        />
                      </>
                    );
                  })()}
                </div>
          ) : tab === 'inspection-history' ? (
            <div style={{ display: 'grid', gap: 20 }}>
              {filteredMissionOrders.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 32, color: '#475569', background: '#f8fafc', borderRadius: 12, border: '1px solid #e2e8f0' }}>
                  {loading ? 'Loading…' : 'No completed inspections found.'}
                </div>
              ) : (
                inspectionsByDay.sortedKeys.map((dayKey) => {
                  const dayGroup = inspectionsByDay.groups[dayKey];
                  const label = dayGroup?.label || dayKey;
                  const itemCount = dayGroup?.items?.length || 0;

                  if (itemCount === 0) return null;

                  return (
                    <div
                      key={`insp-hist-day-${dayKey}`}
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
                          <span>{itemCount} Completed Inspection{itemCount === 1 ? '' : 's'}</span>
                        </div>
                      </div>

                      {/* Table for this day */}
                      <div style={{ overflowX: 'auto' }}>
                        <table className="dash-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                          <thead>
                            <tr style={{ background: '#ffffff', borderBottom: '1px solid #e2e8f0' }}>
                              <th style={{ width: 160, padding: '12px', textAlign: 'left', fontWeight: 800, fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Inspection Status</th>
                              <th style={{ padding: '12px', textAlign: 'left', fontWeight: 800, fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Business & Address</th>
                              <th style={{ width: 200, padding: '12px', textAlign: 'left', fontWeight: 800, fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Inspection Date</th>
                              <th style={{ width: 210, padding: '12px', textAlign: 'left', fontWeight: 800, fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Completed Date</th>
                              <th style={{ width: 200, padding: '12px', textAlign: 'left', fontWeight: 800, fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Inspectors</th>
                            </tr>
                          </thead>
                          <tbody>
                            {dayGroup.items.map((inspection) => (
                              <tr
                                key={inspection.id}
                                style={{
                                  cursor: 'pointer',
                                  borderBottom: '1px solid #e2e8f0',
                                  transition: 'background-color 0.2s ease',
                                  position: 'relative',
                                }}
                                onClick={() => {
                                  if (inspection.id) {
                                    window.location.assign(`/inspection-slip/review?id=${inspection.id}&role=director`);
                                  }
                                }}
                                onMouseEnter={(e) => {
                                  e.currentTarget.style.background = '#f8fafc';
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.background = '#ffffff';
                                }}
                              >
                                <td style={{ padding: '12px' }}>
                                  <span className={statusBadgeClass(inspection.status)}>{formatStatus(inspection.status)}</span>
                                </td>
                                <td style={{ padding: '12px' }}>
                                  <div className="dash-cell-title">{inspection.business_name || '—'}</div>
                                  <div className="dash-cell-sub">{inspection.business_address || ''}</div>
                                </td>
                                <td style={{ padding: '12px', fontSize: 14, color: '#1e293b' }}>{inspection.date_of_inspection ? new Date(inspection.date_of_inspection).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }) : (inspection.completed_at ? new Date(inspection.completed_at).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }) : '—')}</td>
                                <td style={{ padding: '12px', fontSize: 14, color: '#1e293b' }}>{inspection.completed_at ? new Date(inspection.completed_at).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }) : (inspection.completed_at ? new Date(inspection.completed_at).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }) : '—')}</td>
                                <td style={{ padding: '12px' }}>
                                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, minHeight: 30, alignItems: 'center', fontSize: 12 }}>
                                    {(inspection.inspector_names || []).length === 0 ? (
                                      <span style={{ color: '#64748b', fontWeight: 700 }}>—</span>
                                    ) : (
                                      (inspection.inspector_names || []).map((name, idx) => (
                                        <span
                                          key={`${inspection.mission_order_id || inspection.inspection_report_id}-${idx}`}
                                          style={{ padding: '4px 8px', borderRadius: 999, fontWeight: 700, border: '1px solid #e2e8f0', background: '#f8fafc', fontSize: 11 }}
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
              )}
            </div>
          ) : tab === 'mission-orders-history' ? (
            <div style={{ display: 'grid', gap: 20 }}>
              {filteredMissionOrders.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 32, color: '#475569', background: '#f8fafc', borderRadius: 12, border: '1px solid #e2e8f0' }}>
                  {loading ? 'Loading…' : 'No records found.'}
                </div>
              ) : (
                missionOrdersByDay.sortedKeys.map((dayKey) => {
                  const dayGroup = missionOrdersByDay.groups[dayKey];
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
                        {/* Statistics for mission order history */}
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#E5E7EB', marginTop: 6, display: 'flex', alignItems: 'center', gap: 12 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span>Total</span>
                            <span>{itemCount}</span>
                          </div>
                          <span>|</span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#22c55e' }}>
                            <span>Complete</span>
                            <span>{dayGroup.items.filter(mo => String(mo.status || '').toLowerCase() === 'complete').length}</span>
                          </div>
                        </div>
                      </div>

                      {/* Table for this day */}
                      <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                            <tr style={{ background: '#ffffff', borderBottom: '1px solid #e2e8f0' }}>
                              <th style={{ width: 120, padding: '12px', textAlign: 'left', fontWeight: 800, fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>MO ID</th>
                              <th style={{ padding: '12px', textAlign: 'left', fontWeight: 800, fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Title</th>
                              <th style={{ width: 180, padding: '12px', textAlign: 'left', fontWeight: 800, fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Status</th>
                              <th style={{ width: 220, padding: '12px', textAlign: 'left', fontWeight: 800, fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Submitted</th>
                              <th style={{ width: 220, padding: '12px', textAlign: 'left', fontWeight: 800, fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                            {dayGroup.items.map((mo) => (
                              <tr
                                key={mo.id}
                                style={{
                                  cursor: 'pointer',
                                  borderBottom: '1px solid #e2e8f0',
                                  transition: 'background-color 0.2s ease',
                                  position: 'relative',
                                }}
                                onMouseEnter={(e) => {
                                  e.currentTarget.style.background = '#f8fafc';
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.background = '#ffffff';
                                }}
                              >
                                <td style={{ padding: '12px' }} title={mo.id}>{String(mo.id).slice(0, 8)}…</td>
                                <td style={{ padding: '12px' }}>
                          <div className="dash-cell-title">{mo.title || 'Mission Order'}</div>
                          <div className="dash-cell-sub">Complaint: {mo.complaint_id ? String(mo.complaint_id).slice(0, 8) + '…' : '—'}</div>
                        </td>
                                <td style={{ padding: '12px' }}>
                          <span className={statusBadgeClass(mo.status)}>{formatStatus(mo.status)}</span>
                        </td>
                                <td style={{ padding: '12px', color: '#0f172a', fontSize: 13 }}>{formatDateNoSeconds(mo.submitted_at)}</td>
                                <td style={{ padding: '12px' }}>
                          <div className="dash-row-actions">
                            <a
                              className="dash-btn"
                              href={`/mission-order?id=${mo.id}`}
                              onClick={() => {
                                try {
                                  sessionStorage.setItem('missionOrderSource', 'review');
                                } catch {
                                  // ignore
                                }
                              }}
                            >
                              Open MO
                            </a>
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
              )}
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
                        {tab === 'history' ? (
                          // Statistics for history tab
                          <div style={{ fontSize: 13, fontWeight: 600, color: '#E5E7EB', marginTop: 6, display: 'flex', alignItems: 'center', gap: 12 }}>
                            {/* Total */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span>Total</span>
                              <span>{pendingCount}</span>
                            </div>
                            <span>|</span>
                            {/* Approved */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#22c55e' }}>
                              <span>Approved</span>
                              <span>{dayGroup.items.filter(c => String(c.status || '').toLowerCase() === 'approved').length}</span>
                            </div>
                            <span>|</span>
                            {/* Declined */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#ef4444' }}>
                              <span>Declined</span>
                              <span>{dayGroup.items.filter(c => String(c.status || '').toLowerCase() === 'declined').length}</span>
                            </div>
                          </div>
                        ) : (
                          // Pending count for queue tab
                          <div style={{ fontSize: 13, fontWeight: 600, color: '#F2B705', marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#F2B705', flexShrink: 0 }}></div>
                            <span>{pendingCount} Pending {pendingCount === 1 ? 'Complaint' : 'Complaints'}</span>
                          </div>
                        )}
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
                                  <th style={{ width: 180, padding: '12px', textAlign: 'left', fontWeight: 800, fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Complaint Status</th>
                                  <th style={{ padding: '12px', textAlign: 'left', fontWeight: 800, fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Business & Address</th>
                                  <th style={{ width: 220, padding: '12px', textAlign: 'left', fontWeight: 800, fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Reporter Email</th>
                                  <th style={{ width: 200, padding: '12px', textAlign: 'left', fontWeight: 800, fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Submitted</th>
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
                                  onClick={() => window.location.assign(`/complaint/review?id=${c.id}&source=${tab}`)}
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
                                        <span className="status-badge" style={{ ...urgencyStyle.badge, fontWeight: 800, fontSize: 12, padding: '6px 10px', borderRadius: 999, display: 'inline-block', whiteSpace: 'nowrap', border: '1px solid rgba(0,0,0,0.08)' }}>{getUrgencyText(c?.authenticity_level)}</span>
                                      </td>
                                      <td style={{ padding: '12px' }}>
                                        <div className="dash-cell-title">{c.business_name || '—'}</div>
                                        <div className="dash-cell-sub">{c.business_address || ''}</div>
                                      </td>
                                      <td style={{ padding: '12px', color: '#0f172a', fontSize: 13 }}>{formatDateNoSeconds(c.created_at)}</td>
                                    </>
                                  ) : tab === 'history' ? (
                                    <>
                                      <td style={{ padding: '12px' }}>
                                        <span className={statusBadgeClass(c.status)}>{formatStatus(c.status)}</span>
                                      </td>
                                      <td style={{ padding: '12px' }}>
                                        <div className="dash-cell-title">{c.business_name || '—'}</div>
                                        <div className="dash-cell-sub">{c.business_address || ''}</div>
                                      </td>
                                      <td style={{ padding: '12px', color: '#0f172a', fontSize: 13 }}>{c.reporter_email || '—'}</td>
                                      <td style={{ padding: '12px', color: '#0f172a', fontSize: 13 }}>{formatDateNoSeconds(c.created_at)}</td>
                                    </>
                                  ) : null}
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

                {/* Complaint Category (from tags) */}
                <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 16, boxShadow: '0 2px 10px rgba(2,6,23,0.06)', padding: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                    <span aria-hidden>📚</span>
                    <div style={{ fontWeight: 900, color: '#0f172a' }}>Complaint Category</div>
                  </div>
                  {(() => {
                    const groups = groupComplaintCategoriesFromTags(fullComplaint?.tags || []);
                    return groups.length > 0 ? (
                      <ul style={{ margin: 0, paddingLeft: 18, listStyle: 'disc' }}>
                        {groups.map((g) => (
                          <li key={g.category} style={{ margin: '4px 0' }}>
                            <span style={{ fontWeight: 800 }}>{String(g.category).replace(/\s*&\s*/g, ' and ')}</span>
                            {Array.isArray(g.subs) && g.subs.length > 0 ? (
                              <ul style={{ margin: '4px 0 0 18px', padding: 0, listStyle: 'circle' }}>
                                {g.subs.map((s) => (
                                  <li key={s} style={{ margin: '2px 0' }}>{s}</li>
                                ))}
                              </ul>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <div style={{ color: '#64748b', fontWeight: 600 }}>—</div>
                    );
                  })()}
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
