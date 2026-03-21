import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import NotificationBell from '../../../components/NotificationBell';
import { notifyHeadInspectorComplaintApproved } from '../../../lib/notifications/notificationTriggers';
import { cancelInspection as cancelInspectionApi } from '../../../lib/api';
import DirectorReports from './DirectorReports';
import MissionOrderHistory from '../components/MissionOrderHistory';
import HistorySearchBar from '../components/HistorySearchBar';
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

const COMPLAINT_HISTORY_FILTER_OPTIONS = [
  { key: 'businessName', label: 'Business Name' },
  { key: 'address', label: 'Address' },
  { key: 'reporterEmail', label: 'Reporter Email' },
];

const MISSION_ORDER_HISTORY_FILTER_OPTIONS = [
  { key: 'businessName', label: 'Business Name' },
  { key: 'address', label: 'Address' },
  { key: 'inspectorName', label: 'Inspectors' },
];
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

function resolveInspectionWorkflowStatus(report) {
  const s = String(report?.status || '').toLowerCase().trim();
  if (s === 'completed' || s === 'complete') return 'completed';
  if ((s === 'in progress' || s === 'in_progress') && report?.started_at) return 'in progress';
  return 'pending inspection';
}

function renderInspectorPills(inspectorNames, keyPrefix) {
  const names = Array.isArray(inspectorNames) ? inspectorNames.filter(Boolean) : [];
  const visibleNames = names.slice(0, 2);
  const hiddenNames = names.slice(2);

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, minHeight: 30, alignItems: 'center', fontSize: 12 }}>
      {names.length === 0 ? (
        <span style={{ color: '#64748b', fontWeight: 700 }}>—</span>
      ) : (
        <>
          {visibleNames.map((name, idx) => (
            <span key={`${keyPrefix}-${idx}`} style={{ padding: '4px 8px', borderRadius: 999, fontWeight: 700, border: '1px solid #e2e8f0', background: '#f8fafc', fontSize: 11 }}>
              {name}
            </span>
          ))}
          {hiddenNames.length > 0 ? (
            <span
              title={hiddenNames.join(', ')}
              style={{ padding: '4px 8px', borderRadius: 999, fontWeight: 800, border: '1px solid #cbd5e1', background: '#e2e8f0', color: '#334155', fontSize: 11 }}
            >
              +{hiddenNames.length}
            </span>
          ) : null}
        </>
      )}
    </div>
  );
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
  if (u > 50) {
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
  if (u < 50) {
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
  const [auditComplaint, setAuditComplaint] = useState(null);
  const [complaintHistorySearch, setComplaintHistorySearch] = useState('');
  const [missionOrderHistorySearch, setMissionOrderHistorySearch] = useState('');
  const [complaintHistoryFilters, setComplaintHistoryFilters] = useState({
    businessName: '',
    address: '',
    reporterEmail: '',
  });
  const [missionOrderHistoryFilters, setMissionOrderHistoryFilters] = useState({
    businessName: '',
    address: '',
    inspectorName: '',
  });
  const [complaintHistoryAppliedRange, setComplaintHistoryAppliedRange] = useState({ start: null, end: null });
  const [missionOrderHistoryAppliedRange, setMissionOrderHistoryAppliedRange] = useState({ start: null, end: null });
  const activeHistorySearch = tab === 'mission-orders-history' ? missionOrderHistorySearch : complaintHistorySearch;
  const activeHistoryFilters = tab === 'mission-orders-history' ? missionOrderHistoryFilters : complaintHistoryFilters;
  const activeHistoryAppliedRange = tab === 'mission-orders-history' ? missionOrderHistoryAppliedRange : complaintHistoryAppliedRange;
  // Full complaint sidebar state (for history tab audit view)
  const [fullViewId, setFullViewId] = useState(null);
  const [fullViewLoading, setFullViewLoading] = useState(false);
  const [fullViewError, setFullViewError] = useState('');
  const [fullComplaint, setFullComplaint] = useState(null);
  const [fullPreviewImage, setFullPreviewImage] = useState(null);
  const [evidenceIndex, setEvidenceIndex] = useState(0);
  const startOfDayLocal = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
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
  const requestSeqRef = useRef(0);
  const latestRequestRef = useRef({ id: 0, kind: '', tab: '' });

  const beginRequest = (kind, tabName) => {
    const id = ++requestSeqRef.current;
    latestRequestRef.current = { id, kind, tab: tabName };
    setError('');
    setLoading(true);
    return { id, kind, tab: tabName };
  };

  const isActiveRequest = (request) => (
    latestRequestRef.current.id === request.id
    && latestRequestRef.current.kind === request.kind
    && latestRequestRef.current.tab === request.tab
  );

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
    const request = beginRequest('complaints', tab);

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
        if (complaintHistoryAppliedRange?.start && complaintHistoryAppliedRange?.end) {
          const start = new Date(complaintHistoryAppliedRange.start.getFullYear(), complaintHistoryAppliedRange.start.getMonth(), complaintHistoryAppliedRange.start.getDate());
          const endExclusive = new Date(complaintHistoryAppliedRange.end.getFullYear(), complaintHistoryAppliedRange.end.getMonth(), complaintHistoryAppliedRange.end.getDate() + 1);
          query = query.gte('created_at', start.toISOString()).lt('created_at', endExclusive.toISOString());
        }
      } else {
        // General or other: no status filter (fetch recent mix for KPIs)
      }

      // Apply field filters (only one can be active at a time)
      if (tab === 'history') {
        const searchVal = complaintHistorySearch.trim();
        if (complaintHistoryFilters.businessName && searchVal) {
          query = query.ilike('business_name', `%${searchVal}%`);
        } else if (complaintHistoryFilters.address && searchVal) {
          query = query.ilike('business_address', `%${searchVal}%`);
        } else if (complaintHistoryFilters.reporterEmail && searchVal) {
          query = query.ilike('reporter_email', `%${searchVal}%`);
        }

        // Date filtering is handled by the calendar date range picker (complaintHistoryAppliedRange)
      }

      const searchVal = tab === 'history' ? complaintHistorySearch.trim() : '';
      if (searchVal) {
        // Basic search across common columns. If a column doesn't exist, Supabase will error.
        // Keep it conservative to the known ones from ComplaintForm: business_name, business_address, reporter_email.
        query = query.or(
          `business_name.ilike.%${searchVal}%,business_address.ilike.%${searchVal}%,reporter_email.ilike.%${searchVal}%`
        );
      }

      const { data, error } = await query;
      if (error) throw error;

      if (!isActiveRequest(request)) return;
      setComplaints(data || []);
    } catch (e) {
      if (!isActiveRequest(request)) return;
      setError(e?.message || 'Failed to load complaints.');
      setComplaints([]);
    } finally {
      if (isActiveRequest(request)) {
        setLoading(false);
      }
    }
  };

  const loadMissionOrders = async () => {
  const request = beginRequest('mission-orders', tab);

  const normalizeStatus = (v) => String(v || '').toLowerCase().trim();
  const inspectionPriority = (v) => {
    const s = normalizeStatus(v);
    if (s === 'in progress' || s === 'in_progress') return 3;
    if (s === 'pending inspection' || s === 'pending_inspection' || s === 'pending') return 2;
    if (s === 'completed' || s === 'complete') return 1;
    return 0;
  };

  try {
    // =========================
    // INSPECTION (ongoing)
    // =========================
    if (tab === 'inspection') {
      // Director should show ongoing inspections for Director-approved complaints.
      // This mirrors DashboardHeadInspector's logic, but writes to missionOrders state
      // because the Director UI uses filteredMissionOrders for rendering.
      const complaintQuery = supabase
        .from('complaints')
        .select('id, business_name, business_address, reporter_email, status, approved_at, created_at')
        .in('status', ['approved', 'Approved']);

      const appliedComplaintQuery = (() => {
        if (!missionOrderHistoryAppliedRange?.start || !missionOrderHistoryAppliedRange?.end) return complaintQuery;
        const start = new Date(missionOrderHistoryAppliedRange.start);
        start.setHours(0, 0, 0, 0);
        const end = new Date(missionOrderHistoryAppliedRange.end);
        end.setHours(23, 59, 59, 999);
        return complaintQuery.gte('approved_at', start.toISOString()).lte('approved_at', end.toISOString());
      })();

      const { data: complaintRows, error: complaintErr } = await appliedComplaintQuery;
      if (complaintErr) throw complaintErr;

      const complaintIds = Array.from(new Set((complaintRows || []).map((c) => c.id).filter(Boolean)));

      const { data: mos = [], error: moErr } = complaintIds.length
        ? await supabase
            .from('mission_orders')
            .select('id, complaint_id, title, status, submitted_at, created_at, updated_at, date_of_inspection')
            .in('complaint_id', complaintIds)
            .order('created_at', { ascending: false })
            .limit(500)
        : { data: [], error: null };

      if (moErr) throw moErr;

      // Keep latest MO per complaint.
      const latestMoByComplaintId = new Map();
      (mos || []).forEach((mo) => {
        if (!mo?.complaint_id) return;
        if (!latestMoByComplaintId.has(mo.complaint_id)) latestMoByComplaintId.set(mo.complaint_id, mo);
      });

      const missionOrderIds = Array.from(
        new Set(Array.from(latestMoByComplaintId.values()).map((m) => m.id).filter(Boolean))
      );

      // Load latest inspection report status per mission order (for Inspection tab UI).
      const { data: reportRows = [], error: reportErr } = missionOrderIds.length
        ? await supabase
            .from('inspection_reports')
            .select('mission_order_id, inspector_id, status, started_at, updated_at, created_at, completed_at')
            .in('mission_order_id', missionOrderIds)
            .order('updated_at', { ascending: false })
            .limit(2000)
        : { data: [], error: null };

      if (reportErr) throw reportErr;

      // Inspector assignments + names.
      const { data: assignmentRows = [], error: assignmentErr } = missionOrderIds.length
        ? await supabase
            .from('mission_order_assignments')
            .select('mission_order_id, inspector_id')
            .in('mission_order_id', missionOrderIds)
        : { data: [], error: null };
      if (assignmentErr) throw assignmentErr;

      const inspectionStatusByMissionOrderId = new Map();
      const validAssignmentKeys = new Set(
        (assignmentRows || [])
          .filter((a) => a?.mission_order_id && a?.inspector_id)
          .map((a) => `${a.mission_order_id}:${a.inspector_id}`)
      );
      for (const r of reportRows || []) {
        const moId = r?.mission_order_id;
        const inspectorId = r?.inspector_id;
        if (!moId || !inspectorId) continue;
        if (!validAssignmentKeys.has(`${moId}:${inspectorId}`)) continue;
        const resolvedStatus = resolveInspectionWorkflowStatus(r);
        const cur = inspectionStatusByMissionOrderId.get(moId);
        if (!cur) {
          inspectionStatusByMissionOrderId.set(moId, resolvedStatus);
          continue;
        }
        if (inspectionPriority(resolvedStatus) > inspectionPriority(cur)) {
          inspectionStatusByMissionOrderId.set(moId, resolvedStatus);
        }
      }

      const inspectorIds = Array.from(new Set((assignmentRows || []).map((a) => a?.inspector_id).filter(Boolean)));

      const { data: profileRows = [], error: profileErr } = inspectorIds.length
        ? await supabase
            .from('profiles')
            .select('id, full_name, first_name, middle_name, last_name')
            .in('id', inspectorIds)
        : { data: [], error: null };
      if (profileErr) throw profileErr;

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

      const merged = (complaintRows || []).map((c) => {
        const mo = latestMoByComplaintId.get(c.id) || null;
        if (!mo) return null;
        const inspectionStatus =
          inspectionStatusByMissionOrderId.get(mo.id) ||
          ((String(mo.status || '').toLowerCase() === 'for inspection' || String(mo.status || '').toLowerCase() === 'for_inspection')
            ? 'pending inspection'
            : null);
        return {
          // Fields needed by Director filtering/search helpers
          id: mo.id,
          title: mo.title,
          complaint_id: c.id,

          // Fields needed by Director inspection tab renderer
          mission_order_id: mo.id,
          status: mo.status,
          business_name: c.business_name,
          business_address: c.business_address,
          inspection_status: inspectionStatus,
          date_of_inspection: mo.date_of_inspection || null,
          inspector_names: inspectorNamesByMissionOrderId.get(mo.id) || [],
          // Kept for completeness
          mission_order_status: mo.status,
          submitted_at: mo.submitted_at || null,
          created_at: mo.created_at || null,
        };
      });

      if (!isActiveRequest(request)) return;
      setMissionOrders((merged || []).filter(Boolean));
      return;
    }

    // =========================
    // INSPECTION HISTORY (completed)
    // =========================
    if (tab === 'inspection-history') {
      let reportQuery = supabase
        .from('inspection_reports')
        .select('id, mission_order_id, status, completed_at')
        .eq('status', 'completed')
        .order('completed_at', { ascending: false })
        .limit(1000);

      if (missionOrderHistoryAppliedRange?.start && missionOrderHistoryAppliedRange?.end) {
        const start = new Date(missionOrderHistoryAppliedRange.start);
        start.setHours(0, 0, 0, 0);
        const endExclusive = new Date(missionOrderHistoryAppliedRange.end);
        endExclusive.setHours(23, 59, 59, 999);
        // Use inclusive end here because timestamps are exact; the UI is date-based.
        reportQuery = reportQuery.gte('completed_at', start.toISOString()).lte('completed_at', endExclusive.toISOString());
      }

      const { data: reportRows, error: reportErr } = await reportQuery;
      if (reportErr) throw reportErr;

      const missionOrderIds = Array.from(new Set((reportRows || []).map((r) => r?.mission_order_id).filter(Boolean)));

      const { data: moRows = [], error: moErr } = missionOrderIds.length
        ? await supabase
            .from('mission_orders')
            .select('id, complaint_id, title, date_of_inspection')
            .in('id', missionOrderIds)
        : { data: [], error: null };
      if (moErr) throw moErr;

      const moById = new Map((moRows || []).map((m) => [m.id, m]));

      const complaintIds = Array.from(new Set((moRows || []).map((m) => m?.complaint_id).filter(Boolean)));
      const { data: complaintRows = [], error: cErr } = complaintIds.length
        ? await supabase
            .from('complaints')
            .select('id, business_name, business_address')
            .in('id', complaintIds)
        : { data: [], error: null };
      if (cErr) throw cErr;

      const complaintById = new Map((complaintRows || []).map((c) => [c.id, c]));

      const { data: assignmentRows = [], error: assignmentErr } = missionOrderIds.length
        ? await supabase
            .from('mission_order_assignments')
            .select('mission_order_id, inspector_id')
            .in('mission_order_id', missionOrderIds)
        : { data: [], error: null };
      if (assignmentErr) throw assignmentErr;

      const inspectorIds = Array.from(new Set((assignmentRows || []).map((a) => a?.inspector_id).filter(Boolean)));

      const { data: profileRows = [], error: profileErr } = inspectorIds.length
        ? await supabase
            .from('profiles')
            .select('id, full_name, first_name, middle_name, last_name')
            .in('id', inspectorIds)
        : { data: [], error: null };
      if (profileErr) throw profileErr;

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

      const merged = (reportRows || []).map((r) => {
        const mo = moById.get(r.mission_order_id) || {};
        const c = complaintById.get(mo.complaint_id) || {};
        return {
          // Director renderer expects:
          // - inspection.id used for key + URL param
          // - inspection.status for badge
          // - inspection.completed_at and date_of_inspection
          // - inspection.inspector_names array
          id: r.id,
          status: r.status,
          mission_order_id: r.mission_order_id,
          inspection_report_id: r.id,
          business_name: c.business_name,
          business_address: c.business_address,
          date_of_inspection: mo?.date_of_inspection || null,
          completed_at: r.completed_at,
          inspector_names: inspectorNamesByMissionOrderId.get(r.mission_order_id) || [],

          // Used by Director search/filter helpers
          complaint_id: mo?.complaint_id || null,
          title: mo?.title || null,
        };
      });

      if (!isActiveRequest(request)) return;
      setMissionOrders(merged);
      return;
    }

    if (tab === 'mission-orders') {
      const complaintQuery = supabase
        .from('complaints')
        .select('id, business_name, business_address, reporter_email, approved_at, created_at')
        .in('status', ['approved', 'Approved']);

      if (missionOrderHistoryAppliedRange?.start && missionOrderHistoryAppliedRange?.end) {
        const start = new Date(missionOrderHistoryAppliedRange.start);
        start.setHours(0, 0, 0, 0);
        const end = new Date(missionOrderHistoryAppliedRange.end);
        end.setHours(23, 59, 59, 999);
        complaintQuery.gte('approved_at', start.toISOString()).lte('approved_at', end.toISOString());
      }

      const { data: complaints = [], error: complaintErr } = await complaintQuery;
      if (complaintErr) throw complaintErr;

      const complaintIds = [...new Set(complaints.map((c) => c.id).filter(Boolean))];

      const { data: mos = [], error: moErr } = complaintIds.length
        ? await supabase
            .from('mission_orders')
            .select('id, complaint_id, title, status, submitted_at, created_at, updated_at, date_of_inspection')
            .in('complaint_id', complaintIds)
            .order('created_at', { ascending: false })
        : { data: [], error: null };

      if (moErr) throw moErr;

      const latestMO = new Map();
      mos.forEach((mo) => {
        if (!mo?.complaint_id) return;
        if (!latestMO.has(mo.complaint_id)) {
          latestMO.set(mo.complaint_id, mo);
        }
      });

      const moIds = [...latestMO.values()].map((m) => m.id).filter(Boolean);

      const { data: assignments = [], error: assignmentErr } = moIds.length
        ? await supabase
            .from('mission_order_assignments')
            .select('mission_order_id, inspector_id')
            .in('mission_order_id', moIds)
        : { data: [], error: null };

      if (assignmentErr) throw assignmentErr;

      const inspectorIds = [...new Set(assignments.map((a) => a?.inspector_id).filter(Boolean))];

      const { data: profiles = [], error: profileErr } = inspectorIds.length
        ? await supabase
            .from('profiles')
            .select('id, full_name, first_name, middle_name, last_name')
            .in('id', inspectorIds)
        : { data: [], error: null };

      if (profileErr) throw profileErr;

      const profileMap = new Map(profiles.map((p) => [p.id, p]));

      const inspectorMap = new Map();
      assignments.forEach((a) => {
        const p = profileMap.get(a.inspector_id) || {};
        const name =
          p.full_name ||
          [p.first_name, p.middle_name, p.last_name].filter(Boolean).join(' ') ||
          String(a.inspector_id).slice(0, 8);

        if (!inspectorMap.has(a.mission_order_id)) {
          inspectorMap.set(a.mission_order_id, []);
        }
        inspectorMap.get(a.mission_order_id).push(name);
      });

      const merged = complaints
        .map((c) => {
          const mo = latestMO.get(c.id);
          if (!mo) return null;
          return {
            id: mo.id,
            title: mo.title || null,
            status: mo.status || null,
            complaint_id: c.id,
            business_name: c.business_name,
            business_address: c.business_address,
            reporter_email: c.reporter_email,
            approved_at: c.approved_at,
            created_at: c.created_at,
            submitted_at: mo.submitted_at || null,
            mission_order_id: mo.id,
            mission_order_status: mo.status || null,
            mission_order_created_at: mo.created_at || null,
            mission_order_updated_at: mo.updated_at || null,
            date_of_inspection: mo.date_of_inspection || null,
            inspector_names: inspectorMap.get(mo.id) || [],
          };
        })
        .filter(Boolean)
        .filter((mo) => normalizeStatus(mo.mission_order_status || mo.status) === 'issued');

      if (!isActiveRequest(request)) return;
      setMissionOrders(merged);
      return;
    }

    let query = supabase
      .from('mission_orders')
      .select('id, title, status, submitted_at, complaint_id')
      .order('submitted_at', { ascending: false })
      .limit(200);

    // =========================
    // MISSION ORDERS HISTORY
    // =========================
    if (tab === 'mission-orders-history') {
      const complaintQuery = supabase
        .from('complaints')
        .select('id, business_name, business_address, reporter_email, approved_at, created_at')
        .in('status', ['approved', 'Approved']);

      if (missionOrderHistoryAppliedRange?.start && missionOrderHistoryAppliedRange?.end) {
        const start = new Date(missionOrderHistoryAppliedRange.start);
        start.setHours(0, 0, 0, 0);
        const end = new Date(missionOrderHistoryAppliedRange.end);
        end.setHours(23, 59, 59, 999);
        complaintQuery.gte('approved_at', start.toISOString()).lte('approved_at', end.toISOString());
      }

      const { data: complaints, error } = await complaintQuery;
      if (error) throw error;

      const complaintIds = [...new Set(complaints.map(c => c.id).filter(Boolean))];

      const { data: mos = [], error: moErr } = complaintIds.length
        ? await supabase
            .from('mission_orders')
            .select('id, complaint_id, title, status, created_at, updated_at, date_of_inspection, director_preapproved_at, secretary_signed_at')
            .in('complaint_id', complaintIds)
            .order('created_at', { ascending: false })
        : { data: [] };

      if (moErr) throw moErr;

      // Latest MO per complaint
      const latestMO = new Map();
      mos.forEach(mo => {
        if (!latestMO.has(mo.complaint_id)) {
          latestMO.set(mo.complaint_id, mo);
        }
      });

      const moIds = [...latestMO.values()].map(m => m.id);

      const [{ data: assignments = [] }, { data: reports = [] }] = await Promise.all([
        moIds.length
          ? supabase.from('mission_order_assignments').select('mission_order_id, inspector_id').in('mission_order_id', moIds)
          : { data: [] },
        moIds.length
          ? supabase.from('inspection_reports').select('mission_order_id, inspector_id, status, started_at').in('mission_order_id', moIds)
          : { data: [] }
      ]);

      // Inspection status (highest priority)
      const validAssignmentKeys = new Set(
        (assignments || [])
          .filter(a => a?.mission_order_id && a?.inspector_id)
          .map(a => `${a.mission_order_id}:${a.inspector_id}`)
      );
      const inspectionMap = new Map();
      reports.forEach(r => {
        if (!r?.mission_order_id || !r?.inspector_id) return;
        if (!validAssignmentKeys.has(`${r.mission_order_id}:${r.inspector_id}`)) return;
        const resolvedStatus = resolveInspectionWorkflowStatus(r);
        const cur = inspectionMap.get(r.mission_order_id);
        if (!cur || inspectionPriority(resolvedStatus) > inspectionPriority(cur)) {
          inspectionMap.set(r.mission_order_id, resolvedStatus);
        }
      });

      // Inspector names
      const inspectorIds = [...new Set(assignments.map(a => a.inspector_id).filter(Boolean))];

      const { data: profiles = [] } = inspectorIds.length
        ? await supabase
            .from('profiles')
            .select('id, full_name, first_name, middle_name, last_name')
            .in('id', inspectorIds)
        : { data: [] };

      const profileMap = new Map(profiles.map(p => [p.id, p]));

      const inspectorMap = new Map();
      assignments.forEach(a => {
        const p = profileMap.get(a.inspector_id) || {};
        const name =
          p.full_name ||
          [p.first_name, p.middle_name, p.last_name].filter(Boolean).join(' ') ||
          String(a.inspector_id).slice(0, 8);

        if (!inspectorMap.has(a.mission_order_id)) {
          inspectorMap.set(a.mission_order_id, []);
        }
        inspectorMap.get(a.mission_order_id).push(name);
      });

      const merged = complaints.map(c => {
        const mo = latestMO.get(c.id);
        const inspectionStatus =
          mo
            ? inspectionMap.get(mo.id) ||
              ((String(mo?.status || '').toLowerCase() === 'for inspection' || String(mo?.status || '').toLowerCase() === 'for_inspection')
                ? 'pending inspection'
                : null)
            : null;
        return {
          complaint_id: c.id,
          business_name: c.business_name,
          business_address: c.business_address,
          reporter_email: c.reporter_email,
          approved_at: c.approved_at,
          created_at: c.created_at,
          mission_order_id: mo?.id || null,
          mission_order_status: mo?.status || null,
          inspection_status: inspectionStatus,
          mission_order_created_at: mo?.created_at || null,
          mission_order_updated_at: mo?.updated_at || null,
          director_preapproved_at: mo?.director_preapproved_at || null,
          secretary_signed_at: mo?.secretary_signed_at || null,
          date_of_inspection: mo?.date_of_inspection || null,
          inspector_names: mo ? inspectorMap.get(mo.id) || [] : [],
          title: mo?.title || null,
        };
      });

      const filtered = merged
        .filter(r => normalizeStatus(r.mission_order_status) === 'complete')
        .filter(r => {
          if (!missionOrderHistorySearch) return true;
          const hay = `${r.business_name} ${r.business_address} ${r.reporter_email} ${r.complaint_id}`.toLowerCase();
          return hay.includes(missionOrderHistorySearch.toLowerCase());
        });

      if (!isActiveRequest(request)) return;
      setMissionOrders(filtered);
      return;
    }

    // =========================
    // DEFAULT QUERY
    // =========================
    if (missionOrderHistorySearch) {
      const s = missionOrderHistorySearch.trim();
      query = query.or(`title.ilike.%${s}%,id::text.ilike.%${s}%,complaint_id::text.ilike.%${s}%`);
    }

    const { data, error } = await query;
    if (error) throw error;

    if (!isActiveRequest(request)) return;
    setMissionOrders(data || []);

  } catch (e) {
    if (!isActiveRequest(request)) return;
    setError(e?.message || 'Failed to load mission orders.');
    setMissionOrders([]);
  } finally {
    if (isActiveRequest(request)) {
      setLoading(false);
    }
  }
};

  useEffect(() => {
    if (tab === 'mission-orders' || tab === 'mission-orders-history' || tab === 'inspection' || tab === 'inspection-history') {
      loadMissionOrders();
    } else {
      loadComplaints();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, complaintHistoryAppliedRange.start, complaintHistoryAppliedRange.end, missionOrderHistoryAppliedRange.start, missionOrderHistoryAppliedRange.end]);

  useEffect(() => {
    const channel = supabase
      .channel('director-inspection-reports')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inspection_reports' }, () => {
        if (tab === 'inspection' || tab === 'inspection-history') {
          loadMissionOrders();
        }
      })
      .subscribe();

    return () => {
      try {
        supabase.removeChannel(channel);
      } catch {
        // ignore
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // Reload history when applied date range changes or filters change
  useEffect(() => {
    if (tab === 'history') {
      loadComplaints();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [complaintHistoryAppliedRange.start, complaintHistoryAppliedRange.end, complaintHistoryFilters.businessName, complaintHistoryFilters.address, complaintHistoryFilters.reporterEmail, complaintHistorySearch, tab]);

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
    const hasFieldFilter = complaintHistoryFilters.businessName || complaintHistoryFilters.address || complaintHistoryFilters.reporterEmail;
    if (hasFieldFilter) {
      return complaints;
    }

    // Broad client-side filtering across common fields when no specific field filter is active.
    const q = complaintHistorySearch.trim().toLowerCase();
    if (!q) return complaints;

    return complaints.filter((c) => {
      const nameStr = String(c?.business_name ?? '').toLowerCase();
      const addrStr = String(c?.business_address ?? '').toLowerCase();
      const emailStr = String(c?.reporter_email ?? '').toLowerCase();
      return (
        nameStr.includes(q) ||
        addrStr.includes(q) ||
        emailStr.includes(q)
      );
    });
  }, [complaints, complaintHistorySearch, complaintHistoryFilters]);

  const filteredMissionOrders = useMemo(() => {
    if (tab !== 'mission-orders-history') return missionOrders;

    const q = missionOrderHistorySearch.trim().toLowerCase();
    const hasMissionOrderFieldFilter = missionOrderHistoryFilters.businessName || missionOrderHistoryFilters.address || missionOrderHistoryFilters.inspectorName;

    if (!q) return missionOrders;

    return missionOrders.filter((mo) => {
      const idStr = String(mo?.id ?? '').toLowerCase();
      const titleStr = String(mo?.title ?? '').toLowerCase();
      const complaintStr = String(mo?.complaint_id ?? '').toLowerCase();
      const businessNameStr = String(mo?.business_name ?? '').toLowerCase();
      const addressStr = String(mo?.business_address ?? '').toLowerCase();
      const inspectorStr = (mo?.inspector_names || []).join(' ').toLowerCase();

      if (hasMissionOrderFieldFilter) {
        if (missionOrderHistoryFilters.businessName) return businessNameStr.includes(q);
        if (missionOrderHistoryFilters.address) return addressStr.includes(q);
        if (missionOrderHistoryFilters.inspectorName) return inspectorStr.includes(q);
      }

      return idStr.includes(q) || titleStr.includes(q) || complaintStr.includes(q) || businessNameStr.includes(q) || addressStr.includes(q) || inspectorStr.includes(q);
    });
  }, [missionOrders, missionOrderHistorySearch, tab, missionOrderHistoryFilters.businessName, missionOrderHistoryFilters.address, missionOrderHistoryFilters.inspectorName]);

  const reviewMissionOrdersHeaderLabel = useMemo(() => {
    const firstIssuedAt = filteredMissionOrders?.[0]?.submitted_at || filteredMissionOrders?.[0]?.mission_order_created_at || filteredMissionOrders?.[0]?.created_at || null;
    if (!firstIssuedAt) return 'Issued Mission Orders';
    const d = new Date(firstIssuedAt);
    if (Number.isNaN(d.getTime())) return 'Issued Mission Orders';
    return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
  }, [filteredMissionOrders]);

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
    const rangeStart = complaintHistoryAppliedRange?.start ? startOfDayLocal(complaintHistoryAppliedRange.start) : null;
    const rangeEnd = complaintHistoryAppliedRange?.end ? startOfDayLocal(complaintHistoryAppliedRange.end) : null;

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
    const timeframeLabel = complaintHistoryAppliedRange?.start && complaintHistoryAppliedRange?.end
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
  }, [complaints, missionOrders, complaintHistoryAppliedRange.start, complaintHistoryAppliedRange.end]);

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
            <HistorySearchBar
              placeholder={tab === 'mission-orders-history' ? 'Search mission orders...' : 'Search complaints...'}
              searchValue={activeHistorySearch}
              onSearchChange={tab === 'mission-orders-history' ? setMissionOrderHistorySearch : setComplaintHistorySearch}
              filters={activeHistoryFilters}
              onFiltersChange={tab === 'mission-orders-history' ? setMissionOrderHistoryFilters : setComplaintHistoryFilters}
              filterOptions={tab === 'mission-orders-history' ? MISSION_ORDER_HISTORY_FILTER_OPTIONS : COMPLAINT_HISTORY_FILTER_OPTIONS}
              appliedRange={activeHistoryAppliedRange}
              onAppliedRangeChange={tab === 'mission-orders-history' ? setMissionOrderHistoryAppliedRange : setComplaintHistoryAppliedRange}
            />
          )}
          {error ? <div className="dash-alert dash-alert-error">{error}</div> : null}

          {tab === 'mission-orders-history' ? (
            <MissionOrderHistory
              missionOrdersByDay={missionOrdersByDay}
              expandedComplaintId={expandedComplaintId}
              setExpandedComplaintId={setExpandedComplaintId}
              onRowClick={(mo) => {
                try {
                  sessionStorage.setItem('missionOrderSource', 'history');
                } catch {
                  // ignore
                }
                window.location.assign(`/mission-order?id=${encodeURIComponent(mo.mission_order_id || mo.id || mo.mission_order_id)}`);
              }}
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
                    <h3 style={{ margin: 0, fontSize: 18, fontWeight: 900, color: '#ffffff' }}>{reviewMissionOrdersHeaderLabel}</h3>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#E5E7EB', marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#F2B705', flexShrink: 0 }}></div>
                      <span style={{ color: '#F2B705' }}>{filteredMissionOrders.length} Issued Mission Order{filteredMissionOrders.length !== 1 ? 's' : ''}</span>
                    </div>
                  </div>

                  {/* Table */}
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
                        {filteredMissionOrders.map((mo) => (
                          <Fragment key={mo.id}>
                            <tr
                              onClick={() => {
                                try {
                                  sessionStorage.setItem('missionOrderSource', 'review');
                                } catch {
                                  // ignore
                                }
                                window.location.assign(`/mission-order?id=${encodeURIComponent(mo.mission_order_id || mo.id)}`);
                              }}
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
                              <td style={{ padding: '12px', textAlign: 'center' }}>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setExpandedComplaintId(expandedComplaintId === mo.complaint_id ? null : mo.complaint_id);
                                  }}
                                  style={{ background: 'none', border: 'none', outline: 'none', cursor: 'pointer', padding: 0, color: '#64748b', transition: 'transform 0.3s', transform: expandedComplaintId === mo.complaint_id ? 'rotate(180deg)' : 'rotate(0deg)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24 }}
                                >
                                  <svg width="20" height="20" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M80 160L256 320L432 160" stroke="currentColor" strokeWidth="40" strokeLinecap="round" strokeLinejoin="round"/></svg>
                                </button>
                              </td>
                              <td>
                                <span className={statusBadgeClassHI(mo.mission_order_status || mo.status)}>{formatStatusHI(mo.mission_order_status || mo.status)}</span>
                              </td>
                              <td>
                                <div className="dash-cell-title">{mo.business_name || mo.title || 'Mission Order'}</div>
                                <div className="dash-cell-sub">{mo.business_address || (mo.complaint_id ? ('Complaint: ' + (String(mo.complaint_id).slice(0, 8) + '�')) : '')}</div>
                              </td>
                              <td style={{ padding: '12px', fontSize: 14, color: '#1e293b' }}>
                                {mo.date_of_inspection ? new Date(mo.date_of_inspection).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }) : '�'}
                              </td>
                              <td>{renderInspectorPills(mo.inspector_names, mo.complaint_id || mo.mission_order_id || 'review-mo')}</td>
                            </tr>

                            {expandedComplaintId === mo.complaint_id && (
                              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', animation: 'slideDown 0.3s cubic-bezier(0.4, 0, 0.2, 1)' }}>
                                <td colSpan="5" style={{ padding: '16px 24px' }}>
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                                    {[
                                      mo.created_at ? { ts: mo.created_at, title: 'Complaint Submitted', email: mo.reporter_email || null } : null,
                                      mo.approved_at ? { ts: mo.approved_at, title: 'Complaint Approved' } : null,
                                      mo.mission_order_created_at ? { ts: mo.mission_order_created_at, title: 'Mission Order Created' } : null,
                                    ].filter(Boolean).map((ev, idx) => (
                                      <div key={`review-timeline-${mo.complaint_id}-${idx}`} style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 8, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                                        <div style={{ fontSize: 14, fontWeight: 800, color: '#1e293b' }}>
                                          {new Date(ev.ts).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })} {new Date(ev.ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                                        </div>
                                        <div style={{ fontSize: 13, color: '#64748b', lineHeight: 1.5 }}>
                                          {ev.title}{ev.email ? ' by ' : ''}{ev.email ? <span style={{ fontWeight: 700 }}>{ev.email}</span> : null}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
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
                                        try {
                                          sessionStorage.setItem('inspectionSource', 'inspection');
                                        } catch {
                                          // ignore
                                        }
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
                                    try {
                                      sessionStorage.setItem('inspectionSource', 'inspection-history');
                                    } catch {
                                      // ignore
                                    }
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
                                  sessionStorage.setItem('missionOrderSource', 'history');
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
                                if (u > 50) return '#22c55e'; // green
                                if (u === 50) return '#eab308'; // yellow
                                if (u < 50) return '#ef4444'; // red
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



