import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import NotificationBell from '../../../components/NotificationBell';
import { notifyInspectorsMissionOrderAssigned } from '../../../lib/notifications/notificationTriggers';
import './Dashboard.css';

function formatStatus(status) {
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

function statusBadgeClass(status) {
  const s = String(status || '').toLowerCase().trim();

  // inspection_reports status color coding
  if (s === 'pending inspection' || s === 'pending_inspection' || s === 'pending') return 'status-badge status-warning';
  if (s === 'in progress' || s === 'in_progress') return 'status-badge status-info';
  if (s === 'completed') return 'status-badge status-success';

  // Mission order status color coding (source of truth: DB check constraint)
  // draft -> neutral/info
  // issued -> warning (queued for Director)
  // for inspection -> success (approved and actionable)
  // awaiting_signature -> accent
  // complete -> success
  // cancelled -> danger
  if (s === 'for inspection' || s === 'for_inspection') return 'status-badge status-success';
  if (s === 'issued') return 'status-badge status-warning';
  if (s === 'awaiting_signature') return 'status-badge status-accent';
  if (s === 'complete') return 'status-badge status-success';
  if (s === 'cancelled' || s === 'canceled') return 'status-badge status-danger';
  if (s === 'draft') return 'status-badge status-info';

  // No status yet
  if (!s) return 'status-badge status-info';

  return 'status-badge';
}

function getInitialTab() {
  const hash = window.location.hash.slice(1);
  const validTabs = ['todo', 'results', 'inspection', 'inspection-history', 'for-inspection', 'revisions'];
  return validTabs.includes(hash) ? hash : 'todo';
}

export default function DashboardHeadInspector() {
  const [tab, setTab] = useState(getInitialTab); // todo | results | for-inspection | revisions
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [navCollapsed, setNavCollapsed] = useState(false);

  const [complaints, setComplaints] = useState([]);
  const [search, setSearch] = useState('');

  // Date range picker state (same UX as Director)
  const [datePopoverOpen, setDatePopoverOpen] = useState(false);
  const [viewMonth, setViewMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [pendingRange, setPendingRange] = useState({ start: null, end: null });
  const [appliedRange, setAppliedRange] = useState({ start: null, end: null });
  const [datePreset, setDatePreset] = useState('last-week');

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
  const calendarGrid = (base) => {
    const first = new Date(base.getFullYear(), base.getMonth(), 1);
    const day = first.getDay();
    const offset = (day + 6) % 7;
    const gridStart = addDays(first, -offset);
    const days = [];
    for (let i = 0; i < 42; i++) days.push(addDays(gridStart, i));
    return days;
  };
  const setCurrentWeekPending = () => {
    const t = startOfDayLocal(new Date());
    const weekday = t.getDay();
    const start = addDays(t, -weekday);
    const end = addDays(start, 6);
    setPendingRange({ start, end });
    setDatePreset('custom');
    setViewMonth(new Date(t.getFullYear(), t.getMonth(), 1));
  };
  const applyPresetRange = (p) => {
    setDatePreset(p);
    const t = startOfDayLocal(new Date());
    if (p === 'custom') {
      setPendingRange({ start: null, end: null });
      setViewMonth(new Date(t.getFullYear(), t.getMonth(), 1));
      return;
    }
    if (p === 'last-week') {
      const weekday = t.getDay();
      const thisWeekStartSun = addDays(t, -weekday);
      const lastWeekStartSun = addDays(thisWeekStartSun, -7);
      const lastWeekEndSat = addDays(lastWeekStartSun, 6);
      setPendingRange({ start: lastWeekStartSun, end: lastWeekEndSat });
      setViewMonth(new Date(lastWeekEndSat.getFullYear(), lastWeekEndSat.getMonth(), 1));
      return;
    }
    if (p === 'last-month') {
      const firstOfLastMonth = new Date(t.getFullYear(), t.getMonth() - 1, 1);
      const lastOfLastMonth = new Date(t.getFullYear(), t.getMonth(), 0);
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

  const pageMeta = useMemo(() => {
    const meta = {
      todo: {
        title: '(Drafts) Mission Order',
        subtitle: 'Review Director-approved complaints that still need a mission order draft.',
      },
      results: {
        title: '(Director Approval) Mission Order',
        subtitle: 'Track mission orders issued and approved or rejected by the Director.',
      },
      inspection: {
        title: 'Inspections',
        subtitle: 'Track ongoing inspections.',
      },
      'inspection-history': {
        title: 'Inspection History',
        subtitle: 'History for all completed inspections (from inspection reports).',
      },
      'for-inspection': {
        title: '(Secretary Approval) Mission Order',
        subtitle: 'Mission orders pre-approved and ready for submission to the secretary.',
      },
      revisions: {
        title: 'Mission Order History',
        subtitle: 'History for all of the Mission-Orders Accomplished.',
      },
    };

    return meta[tab] || {
      title: 'Head Inspector Dashboard',
      subtitle: 'Manage mission orders workflow for Director-approved complaints.',
    };
  }, [tab]);

  const [creatingForId, setCreatingForId] = useState(null);
  const [toast, setToast] = useState('');
  const [expandedComplaintId, setExpandedComplaintId] = useState(null);
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
      // Clear any persisted auth state and force a clean login.
      const { error: signOutError } = await supabase.auth.signOut({ scope: 'global' });
      if (signOutError) throw signOutError;
    } catch (e) {
      // Even if remote sign-out fails, still clear local state and navigate away.
      setError(e?.message || 'Logout failed. Clearing local session…');
    } finally {
      try {
        // Extra safety: remove any cached session artifacts.
        // (Supabase stores these under project-specific keys; clearing all is simplest in this SPA.)
        localStorage.clear();
        sessionStorage.clear();
      } catch {
        // ignore
      }
      window.location.replace('/login');
    }
  };

  const loadApprovedComplaints = async () => {
    setError('');
    setLoading(true);

    try {
      // Industry standard: drive this dashboard from Director-approved complaints,
      // regardless of whether a mission order already exists yet.
      // Then attach the latest mission order per complaint (if any).
      let complaintQuery = supabase
        .from('complaints')
        .select('id, business_name, business_address, reporter_email, status, approved_at, created_at')
        .in('status', ['approved', 'Approved']);

      // Apply date range to the most relevant timestamp for this dashboard (approval date is primary)
      if (appliedRange?.start && appliedRange?.end) {
        const start = new Date(appliedRange.start.getFullYear(), appliedRange.start.getMonth(), appliedRange.start.getDate());
        const endExclusive = new Date(appliedRange.end.getFullYear(), appliedRange.end.getMonth(), appliedRange.end.getDate() + 1);
        complaintQuery = complaintQuery.gte('approved_at', start.toISOString()).lt('approved_at', endExclusive.toISOString());
      }

      const { data: complaintRows, error: complaintError } = await complaintQuery;

      if (complaintError) throw complaintError;

      const complaintIds = Array.from(new Set((complaintRows || []).map((c) => c.id).filter(Boolean)));

      const { data: missionOrders, error: moError } = complaintIds.length
        ? await supabase
            .from('mission_orders')
            .select('id, complaint_id, status, created_at, date_of_inspection, updated_at, secretary_signed_at, director_preapproved_at')
            .in('complaint_id', complaintIds)
            .order('created_at', { ascending: false })
            .limit(500)
        : { data: [], error: null };

      if (moError) throw moError;

      // Keep the latest MO per complaint.
      const latestMoByComplaintId = new Map();
      (missionOrders || []).forEach((mo) => {
        if (!mo?.complaint_id) return;
        if (!latestMoByComplaintId.has(mo.complaint_id)) {
          latestMoByComplaintId.set(mo.complaint_id, mo);
        }
      });

      const complaintById = new Map((complaintRows || []).map((c) => [c.id, c]));

      // Load inspector assignments (FK-only) and resolve inspector display names.
      // Expected columns in mission_order_assignments: mission_order_id, inspector_id (or user_id)
      const missionOrderIds = Array.from(new Set((Array.from(latestMoByComplaintId.values()) || []).map((m) => m.id).filter(Boolean)));

      const { data: assignmentRows, error: assignmentError } = missionOrderIds.length
        ? await supabase
            .from('mission_order_assignments')
            .select('mission_order_id, inspector_id')
            .in('mission_order_id', missionOrderIds)
        : { data: [], error: null };

      if (assignmentError) throw assignmentError;

      // Load latest inspection report status per mission order (for Inspection tab UI).
      // There may be multiple reports per MO (multiple inspectors / retries). We choose a single
      // representative status using priority: in progress > pending inspection > completed.
      const { data: reportRows, error: reportErr } = missionOrderIds.length
        ? await supabase
            .from('inspection_reports')
            .select('mission_order_id, status, updated_at, created_at, completed_at')
            .in('mission_order_id', missionOrderIds)
            .order('updated_at', { ascending: false })
            .limit(2000)
        : { data: [], error: null };

      if (reportErr) throw reportErr;

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
        // Keep the highest priority status across reports for this MO.
        if (inspectionPriority(r?.status) > inspectionPriority(cur)) {
          inspectionStatusByMissionOrderId.set(moId, r?.status || null);
        }
      }

      const inspectorIds = Array.from(
        new Set((assignmentRows || []).map((a) => a?.inspector_id).filter(Boolean))
      );

      // Resolve inspector names from profiles.
      // Schema shows profiles has full_name (computed) + first/middle/last (no email column).
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
        const p = profileById.get(a.inspector_id);
        const displayName =
          p?.full_name ||
          [p?.first_name, p?.middle_name, p?.last_name].filter(Boolean).join(' ') ||
          String(a.inspector_id).slice(0, 8);
        const arr = inspectorNamesByMissionOrderId.get(a.mission_order_id) || [];
        arr.push(displayName);
        inspectorNamesByMissionOrderId.set(a.mission_order_id, arr);
      });

      // Merge into the shape the table expects.
      const merged = (complaintRows || []).map((c) => {
        const mo = latestMoByComplaintId.get(c.id) || null;
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
          inspector_names: mo?.id ? inspectorNamesByMissionOrderId.get(mo.id) || [] : [],
        };
      });

      const searchVal = search.trim().toLowerCase();
      const filtered = !searchVal
        ? merged
        : merged.filter((r) => {
            const hay = [r.business_name, r.business_address, r.reporter_email, r.complaint_id, r.mission_order_id]
              .filter(Boolean)
              .join(' ')
              .toLowerCase();
            return hay.includes(searchVal);
          });

      setComplaints(filtered);
    } catch (e) {
      setError(e?.message || 'Failed to load mission orders.');
      setComplaints([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadApprovedComplaints();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reload when applied date range changes
  useEffect(() => {
    loadApprovedComplaints();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appliedRange.start, appliedRange.end]);

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

  const archiveMissionOrder = async (missionOrderId, file) => {
    setError('');
    setToast('');

    if (!missionOrderId) {
      setError('No Mission Order found for this record.');
      return;
    }

    if (!file) {
      setError('Please upload a PDF or PNG before archiving.');
      return;
    }

    const isAllowed =
      file.type === 'application/pdf' ||
      file.type === 'image/png' ||
      // Some browsers may leave file.type empty; fall back to extension check.
      /\.(pdf|png)$/i.test(file.name || '');

    if (!isAllowed) {
      setError('Invalid file type. Please upload a PDF or PNG.');
      return;
    }

    // 10MB guardrail (adjust if needed)
    if (file.size > 10 * 1024 * 1024) {
      setError('File is too large. Maximum allowed size is 10MB.');
      return;
    }

    try {
      setLoading(true);
      const nowIso = new Date().toISOString();

      // 1) Upload attachment to Supabase Storage
      // Bucket name: 'mission-orders' (must exist in Supabase Storage)
      // Path: mission-orders/<missionOrderId>/secretary-signed/<timestamp>_<filename>
      const safeName = String(file.name || 'attachment')
        .replace(/[^a-zA-Z0-9._-]/g, '_')
        .slice(0, 120);

      const storagePath = `mission-orders/${missionOrderId}/secretary-signed/${Date.now()}_${safeName}`;

      const { error: uploadErr } = await supabase.storage
        .from('mission-orders')
        .upload(storagePath, file, { upsert: true, contentType: file.type || undefined });

      if (uploadErr) throw uploadErr;

      const { data: publicUrlData } = supabase.storage.from('mission-orders').getPublicUrl(storagePath);
      const attachmentUrl = publicUrlData?.publicUrl || null;

      // 2) Patch mission order as archived/complete + store attachment URL
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData?.user?.id || null;

      const patch = {
        status: 'complete',
        updated_at: nowIso,
        secretary_signed_at: nowIso,
        secretary_signed_attachment_url: attachmentUrl,
        secretary_signed_attachment_uploaded_at: nowIso,
        secretary_signed_attachment_uploaded_by: userId,
      };

      const { error: updateError } = await supabase
        .from('mission_orders')
        .update(patch)
        .eq('id', missionOrderId);

      if (updateError) throw updateError;

      // Optimistic local update so it disappears from Awaiting Signature and appears in History.
      setComplaints((prev) =>
        (prev || []).map((r) =>
          r.mission_order_id === missionOrderId
            ? {
                ...r,
                mission_order_status: 'complete',
                mission_order_updated_at: nowIso,
                secretary_signed_at: nowIso,
              }
            : r
        )
      );

      setToast('Mission order archived (attachment uploaded).');
    } catch (e) {
      setError(e?.message || 'Failed to archive mission order.');
    } finally {
      setLoading(false);
    }
  };

  const createMissionOrder = async (complaintId, currentTab = 'todo') => {
    setError('');
    setToast('');
    setCreatingForId(complaintId);

    try {
      // Using the view, rows are keyed by complaint_id (not id)
      const row = complaints.find((x) => x.complaint_id === complaintId);
      if (!row) throw new Error('Complaint not found in current list. Please refresh and try again.');

      // If there is already a mission order, just open it.
      if (row.mission_order_id) {
        window.location.assign(`/mission-order?id=${row.mission_order_id}#${currentTab || 'todo'}`);
        return;
      }

      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      const userId = userData?.user?.id;
      if (!userId) throw new Error('Not authenticated. Please login again.');

      // Fetch the complaint details from the source table to build MO content.
      const { data: complaint, error: complaintError } = await supabase
        .from('complaints')
        .select('id, business_name, business_address, complaint_description')
        .eq('id', complaintId)
        .single();

      if (complaintError) throw complaintError;

      const businessName = complaint?.business_name || row.business_name || 'N/A';
      const businessAddress = complaint?.business_address || row.business_address || 'N/A';
      const complaintDesc = escapeHtml(complaint?.complaint_description || '');

      const title = `Mission Order - ${businessName}`;

      // Keep the creation template aligned with the editor's default template.
      // Use placeholders so MissionOrderEditor can auto-inject locked spans for inspectors/business fields.
      const complaintSubmittedDate = (() => {
        const dtRaw = row?.created_at || complaint?.created_at;
        const dt = dtRaw ? new Date(dtRaw) : null;
        if (!dt || Number.isNaN(dt.getTime())) return '[INSERT DATE]';
        return dt.toLocaleDateString(undefined, { day: '2-digit', month: 'long', year: 'numeric' }).toUpperCase();
      })();

      const content = [
        '<div style="font-family: \"Times New Roman\", Times, serif; line-height: 1.25; font-size: 12px; color: #000;">',
        '<p style="text-align:center; font-weight: 800; letter-spacing: 0.5px; margin: 0 0 10px 0;">MISSION ORDER</p>',
        '<p style="margin: 0 0 14px 0;"><strong>TO:</strong>&nbsp; FIELD INSPECTOR [INSPECTOR NAME]</p>',
        '<p style="margin: 0 0 12px 0;"><strong>SUBJECT:</strong>&nbsp; TO CONDUCT INSPECTION ON THE BUSINESS ESTABLISHMENT IDENTIFIED AS [BUSINESS NAME], WITH ADDRESS AT [ADDRESS].</p>',
        '<p style="margin: 0 0 12px 0; text-align: justify;">',
        `THE CONDUCT OF THIS INSPECTION IS DEEMED NECESSARY IN VIEW OF THE LETTER-COMPLAINT RECEIVED VIA INSPEKTO COMPLAINT MANAGEMENT SYSTEM DATED ${complaintSubmittedDate} FROM A CONCERNED CITIZEN REGARDING THE OPERATION OF THE ABOVE-MENTIONED BUSINESS ESTABLISHMENT. COMPLAINT DETAILS: `,
        complaintDesc || '',
        '</p>',
        '<table style="width: 100%; border-collapse: collapse; margin: 8px 0 14px 0;">',
        '<tr>',
        '<td style="width: 50%; vertical-align: top; padding: 4px 0;"><strong>DATE OF INSPECTION:</strong></td>',
        '<td style="width: 50%; vertical-align: top; padding: 4px 0; text-align: left;">[INSERT DATE]</td>',
        '</tr>',
        '<tr>',
        '<td style="width: 50%; vertical-align: top; padding: 4px 0;"><strong>DATE OF ISSUANCE:</strong></td>',
        '<td style="width: 50%; vertical-align: top; padding: 4px 0; text-align: left;">[INSERT DATE]</td>',
        '</tr>',
        '</table>',
        '<p style="margin: 0 0 10px 0; text-align: justify;">In the interest of public service, you are hereby ordered to conduct inspection of the aforementioned establishment, for the following purposes:</p>',
        '<p style="margin: 0 0 8px 0; padding-left: 34px; text-indent: -22px;"><strong>a)</strong>&nbsp; To verify the existence and authenticity of the Business Permits and other applicable permits, certificates, and other necessary documents, the completeness of the requirements therein.</p>',
        '<p style="margin: 0 0 8px 0; padding-left: 34px; text-indent: -22px;"><strong>b)</strong>&nbsp; To check actual business operation of the subject establishment.</p>',
        '<p style="margin: 0 0 12px 0; padding-left: 34px; text-indent: -22px;"><strong>c)</strong>&nbsp; To check compliance of said establishment with existing laws, ordinances, regulations relative to health &amp; sanitation, fire safety, engineering &amp; electrical installation standards.</p>',
        '<p style="margin: 0 0 12px 0; text-align: justify;">You are hereby directed to identify yourself by showing proper identification and act with due courtesy and politeness in the implementation of this Order. All inspectors shall wear their ID\'s in such manner as the public will be informed of their true identity.</p>',
        '<p style="margin: 0 0 12px 0; text-align: justify;"><strong>You should also inform the owner or representative of the establishment being inspected that they may verify the authenticity of this Mission Order, or ask questions, or lodge complaints, thru our telephone number (02) 8527-0871 or email at permits@manila.gov.ph</strong></p>',
        '<p style="margin: 0 0 18px 0; text-align: justify;">This Order is in effect until [INSERT DATE] and any Order inconsistent herewith is hereby revoked and/or amended accordingly.</p>',
        '<table style="width: 100%; border: none; border-collapse: collapse;">',
        '<tr>',
        '<td style="width: 50%; vertical-align: top;">',
        '<p style="margin: 0 0 26px 0;">Recommending approval:</p>',
        '<p style="margin: 0; font-weight: 800;">LEVI C. FACUNDO</p>',
        '<p style="margin: 0;">Director</p>',
        '</td>',
        '<td style="width: 50%; vertical-align: top;">',
        '<p style="margin: 0 0 26px 0;">Approved by:</p>',
        '<p style="margin: 0; font-weight: 800;">MANUEL M. ZARCAL</p>',
        '<p style="margin: 0;">Secretary to the Mayor</p>',
        '</td>',
        '</tr>',
        '</table>',
        '</div>',
      ].join('');

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

  const filteredComplaints = useMemo(() => {
    // 1) Apply tab filter (workflow states)
    const normalize = (s) => String(s || '').toLowerCase();

    const byTab = (complaints || []).filter((c) => {
      const s = normalize(c.mission_order_status);
      if (tab === 'todo') return !s || s === 'draft';
      if (tab === 'results') return s === 'issued' || s === 'rejected';
      if (tab === 'inspection') return (c.secretary_signed_at) || s === 'cancelled' || s === 'canceled';
      if (tab === 'for-inspection') return s === 'awaiting_signature';
      // Mission Order History: only completed/accomplished mission orders
      if (tab === 'revisions') return s === 'complete';
      // inspection-history is driven by a separate query
      if (tab === 'inspection-history') return false;
      return true;
    });

    // 2) Apply search filter
    const q = search.trim().toLowerCase();
    if (!q) return byTab;

    return byTab.filter((c) => {
      const hay = [c.business_name, c.business_address, c.reporter_email, c.complaint_id, c.mission_order_id]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [complaints, search, tab]);

  // Group approved complaints by day for easier review.
  const complaintsByDay = useMemo(() => {
    const groups = {};

    for (const c of filteredComplaints) {
      // Bucket rows by the most relevant timestamp for the current view.
      // - for inspection (Secretary Approval): group by mission_order_created_at (Pre-Approval date)
      // - issued/revisions/todo: group by MO created_at when present, else complaint approval/created
      const dtRaw =
        tab === 'for-inspection'
          ? (c.mission_order_created_at || c.approved_at || c.created_at)
          : (c.mission_order_created_at || c.approved_at || c.created_at);

      const dt = dtRaw ? new Date(dtRaw) : null;
      // Create key from local date components to avoid timezone issues
      const key = dt ? `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}` : 'unknown';
      if (!groups[key]) {
        groups[key] = {
          label: dt ? dt.toLocaleDateString() : 'Unknown Date',
          items: [],
        };
      }
      groups[key].items.push(c);
    }

    // Newest day first.
    const sortedKeys = Object.keys(groups).sort((a, b) => (a < b ? 1 : -1));
    return { groups, sortedKeys };
  }, [filteredComplaints, tab]);

  const [inspectionHistory, setInspectionHistory] = useState([]);

  const formatTimestampNoMs = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';

    // UI requirement: no milliseconds.
    // Use locale date + time with seconds (matches existing history view) without fractional seconds.
    return d.toLocaleString(undefined, {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const loadInspectionHistory = async () => {
    setError('');
    setLoading(true);

    try {
      // 1) Load completed inspection reports
      const { data: reportRows, error: reportErr } = await supabase
        .from('inspection_reports')
        .select('id, mission_order_id, status, completed_at, updated_at, created_at')
        .eq('status', 'completed')
        .order('completed_at', { ascending: false })
        .limit(1000);

      if (reportErr) throw reportErr;

      const missionOrderIds = Array.from(new Set((reportRows || []).map((r) => r?.mission_order_id).filter(Boolean)));

      // 2) Load mission orders to resolve complaint_id and inspection date
      const { data: moRows, error: moErr } = missionOrderIds.length
        ? await supabase
            .from('mission_orders')
            .select('id, complaint_id, date_of_inspection')
            .in('id', missionOrderIds)
        : { data: [], error: null };

      if (moErr) throw moErr;

      const moById = new Map((moRows || []).map((m) => [m.id, m]));

      const complaintIds = Array.from(new Set((moRows || []).map((m) => m?.complaint_id).filter(Boolean)));

      // 3) Load complaints for business info
      const { data: complaintRows, error: cErr } = complaintIds.length
        ? await supabase
            .from('complaints')
            .select('id, business_name, business_address')
            .in('id', complaintIds)
        : { data: [], error: null };

      if (cErr) throw cErr;

      const complaintById = new Map((complaintRows || []).map((c) => [c.id, c]));

      // 4) Load inspector assignments + names (to match Inspections tab pills)
      const { data: assignmentRows, error: assignmentErr } = missionOrderIds.length
        ? await supabase
            .from('mission_order_assignments')
            .select('mission_order_id, inspector_id')
            .in('mission_order_id', missionOrderIds)
        : { data: [], error: null };

      if (assignmentErr) throw assignmentErr;

      const inspectorIds = Array.from(new Set((assignmentRows || []).map((a) => a?.inspector_id).filter(Boolean)));

      const { data: profileRows, error: profileErr } = inspectorIds.length
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
          inspection_report_id: r.id,
          mission_order_id: r.mission_order_id,
          inspection_status: r.status,
          inspection_date: mo?.date_of_inspection || null,
          inspection_completed_at: r.completed_at,
          business_name: c.business_name,
          business_address: c.business_address,
          inspector_names: r?.mission_order_id ? inspectorNamesByMissionOrderId.get(r.mission_order_id) || [] : [],
        };
      });

      setInspectionHistory(merged);
    } catch (e) {
      setError(e?.message || 'Failed to load inspection history.');
      setInspectionHistory([]);
    } finally {
      setLoading(false);
    }
  };

  // Load inspection history when opening the tab
  useEffect(() => {
    if (tab !== 'inspection-history') return;
    loadInspectionHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const filteredInspectionHistory = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return inspectionHistory;

    return (inspectionHistory || []).filter((r) => {
      const hay = [r.business_name, r.business_address, r.complaint_id, r.mission_order_id, r.inspection_report_id]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [inspectionHistory, search]);

  const inspectionHistoryByDay = useMemo(() => {
    if (tab !== 'inspection-history') return { groups: {}, sortedKeys: [] };

    const groups = {};
    for (const r of filteredInspectionHistory) {
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
  }, [filteredInspectionHistory, tab]);

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
                <span className="dash-nav-section-label" style={{ display: navCollapsed ? 'none' : 'inline' }}>Mission Orders</span>
              </li>
              <li>
                <button type="button" className={`dash-nav-item ${tab === 'todo' ? 'active' : ''}`} onClick={() => setTab('todo')}>
                  <span className="dash-nav-ico" aria-hidden="true" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                    <img src="/ui_icons/menu.png" alt="" style={{ width: 22, height: 22, objectFit: 'contain', display: 'block', filter: 'brightness(0) saturate(100%) invert(62%) sepia(94%) saturate(1456%) hue-rotate(7deg) brightness(88%) contrast(108%)' }} />
                  </span>
                  <span className="dash-nav-label" style={{ display: navCollapsed ? 'none' : 'inline' }}>Draft</span>
                </button>
              </li>
              <li>
                <button type="button" className={`dash-nav-item ${tab === 'results' ? 'active' : ''}`} onClick={() => setTab('results')}>
                  <span className="dash-nav-ico" aria-hidden="true" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                    <img src="/ui_icons/mo.png" alt="" style={{ width: 22, height: 22, objectFit: 'contain', display: 'block', filter: 'brightness(0) saturate(100%) invert(62%) sepia(94%) saturate(1456%) hue-rotate(7deg) brightness(88%) contrast(108%)' }} />
                  </span>
                  <span className="dash-nav-label" style={{ display: navCollapsed ? 'none' : 'inline' }}>Director Approval</span>
                </button>
              </li>
              <li>
                <button type="button" className={`dash-nav-item ${tab === 'for-inspection' ? 'active' : ''}`} onClick={() => setTab('for-inspection')}>
                  <span className="dash-nav-ico" aria-hidden="true" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                    <img src="/ui_icons/queue.png" alt="" style={{ width: 24, height: 24, objectFit: 'contain', display: 'block', filter: 'brightness(0) saturate(100%) invert(62%) sepia(94%) saturate(1456%) hue-rotate(7deg) brightness(88%) contrast(108%)' }} />
                  </span>
                  <span className="dash-nav-label" style={{ display: navCollapsed ? 'none' : 'inline' }}>Secretary Approval</span>
                </button>
              </li>
              <li>
                <button type="button" className={`dash-nav-item ${tab === 'revisions' ? 'active' : ''}`} onClick={() => setTab('revisions')}>
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

              
              {toast ? <div className="dash-alert dash-alert-success">{toast}</div> : null}
              {error ? <div className="dash-alert dash-alert-error">{error}</div> : null}

              {tab === 'todo' ? (
                <div style={{ display: 'grid', gap: 20 }}>
                  {filteredComplaints.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: 32, color: '#475569', background: '#f8fafc', borderRadius: 12, border: '1px solid #e2e8f0' }}>
                      {loading ? 'Loading…' : 'No records found for this tab.'}
                    </div>
                  ) : (
                    complaintsByDay.sortedKeys.map((dayKey) => {
                      const dayGroup = complaintsByDay.groups[dayKey];
                      const label = dayGroup?.label || dayKey;
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
                              {new Date(dayKey).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}
                            </h3>
                            <div style={{ fontSize: 13, fontWeight: 600, color: '#F2B705', marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
                              <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#F2B705', flexShrink: 0 }}></div>
                              <span>{count} Pending Mission Order{count !== 1 ? 's' : ''}</span>
                            </div>
                          </div>

                          {/* Table for this day */}
                          <div style={{ overflowX: 'auto' }}>
                            <table className="dash-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                              <thead>
                                <tr style={{ background: '#ffffff', borderBottom: '1px solid #e2e8f0' }}>
                                  <th style={{ width: 40, padding: '12px', textAlign: 'center', fontWeight: 800, fontSize: 12, color: '#64748b' }}></th>
                                  <th style={{ width: 150, padding: '12px', textAlign: 'left', fontWeight: 800, fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>MO Status</th>
                                  <th style={{ padding: '12px', textAlign: 'left', fontWeight: 800, fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Business & Address</th>
                                </tr>
                              </thead>
                              <tbody>
                                {dayGroup.items.map((c) => (
                                  <React.Fragment key={c.complaint_id}>
                                    <tr
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
                                            setExpandedComplaintId(expandedComplaintId === c.complaint_id ? null : c.complaint_id);
                                          }}
                                          style={{
                                            background: 'none',
                                            border: 'none',
                                            outline: 'none',
                                            cursor: 'pointer',
                                            padding: 0,
                                            color: '#64748b',
                                            transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                                            transform: expandedComplaintId === c.complaint_id ? 'rotate(180deg)' : 'rotate(0deg)',
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            width: 24,
                                            height: 24,
                                          }}
                                        >
                                          <svg width="20" height="20" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">
                                            <path d="M80 160L256 320L432 160" stroke="currentColor" strokeWidth="40" strokeLinecap="round" strokeLinejoin="round"/>
                                          </svg>
                                        </button>
                                      </td>
                                      <td onClick={() => createMissionOrder(c.complaint_id, 'todo')}>
                                        <span className={statusBadgeClass(c.mission_order_status)}>
                                          {c.mission_order_status ? formatStatus(c.mission_order_status) : 'No MO'}
                                        </span>
                                      </td>
                                      <td onClick={() => createMissionOrder(c.complaint_id, 'todo')}>
                                        <div className="dash-cell-title">{c.business_name || '—'}</div>
                                        <div className="dash-cell-sub">{c.business_address || ''}</div>
                                      </td>
                                    </tr>
                                    {expandedComplaintId === c.complaint_id && (
                                      <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', animation: 'slideDown 0.3s cubic-bezier(0.4, 0, 0.2, 1)' }}>
                                        <td colSpan="3" style={{ padding: '16px 24px' }}>
                                          {/* Progress Timeline */}
                                          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                                            {/* Box 1: Submitted */}
                                            <div style={{
                                              background: '#ffffff',
                                              border: '1px solid #e2e8f0',
                                              borderRadius: 8,
                                              padding: '14px 16px',
                                              display: 'flex',
                                              flexDirection: 'column',
                                              gap: 6,
                                            }}>
                                              <div style={{ fontSize: 14, fontWeight: 800, color: '#1e293b', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
                                                {c.created_at ? new Date(c.created_at).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }) + ' ' + new Date(c.created_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : ''}
                                              </div>
                                              <div style={{ fontSize: 13, color: '#64748b', lineHeight: 1.5, fontFamily: 'system-ui, -apple-system, sans-serif' }}>
                                                Complaint Submitted by <span style={{ fontWeight: 700 }}>{c.reporter_email || 'No email provided'}</span>
                                              </div>
                                            </div>

                                            {/* Box 2: Approved */}
                                            <div style={{
                                              background: '#ffffff',
                                              border: '1px solid #e2e8f0',
                                              borderRadius: 8,
                                              padding: '14px 16px',
                                              display: 'flex',
                                              flexDirection: 'column',
                                              gap: 6,
                                            }}>
                                              <div style={{ fontSize: 14, fontWeight: 800, color: '#1e293b', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
                                                {c.approved_at ? new Date(c.approved_at).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }) + ' ' + new Date(c.approved_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : ''}
                                              </div>
                                              <div style={{ fontSize: 13, color: '#64748b', lineHeight: 1.5, fontFamily: 'system-ui, -apple-system, sans-serif' }}>
                                                Complaint Approved
                                              </div>
                                            </div>

                                            {/* Box 3: Mission Order Created */}
                                            {c.mission_order_created_at && (
                                              <div style={{
                                                background: '#ffffff',
                                                border: '1px solid #e2e8f0',
                                                borderRadius: 8,
                                                padding: '14px 16px',
                                                display: 'flex',
                                                flexDirection: 'column',
                                                gap: 6,
                                              }}>
                                                <div style={{ fontSize: 14, fontWeight: 800, color: '#1e293b', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
                                                  {new Date(c.mission_order_created_at).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }) + ' ' + new Date(c.mission_order_created_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                                                </div>
                                                <div style={{ fontSize: 13, color: '#64748b', lineHeight: 1.5, fontFamily: 'system-ui, -apple-system, sans-serif' }}>
                                                  Mission Order Created
                                                </div>
                                              </div>
                                            )}
                                          </div>
                                        </td>
                                      </tr>
                                    )}
                                  </React.Fragment>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              ) : tab === 'results' ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                  {/* Rejected Section */}
                  <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 14, boxShadow: '0 4px 12px rgba(2,6,23,0.08)', overflow: 'hidden' }}>
                    <div style={{ padding: '18px 24px', background: '#0b2249', borderBottom: 'none' }}>
                      <h3 style={{ margin: 0, fontSize: 18, fontWeight: 900, color: '#ffffff' }}>Rejected</h3>
                      <div style={{ fontSize: 13, fontWeight: 600, marginTop: 6, color: '#ef4444' }}>
                        {complaints.filter((c) => {
                          const s = String(c.mission_order_status || '').toLowerCase();
                          return s === 'rejected';
                        }).length} items
                      </div>
                    </div>
                    <div style={{ overflowX: 'auto', maxHeight: '600px', overflowY: 'auto' }}>
                      <table className="dash-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr style={{ background: '#ffffff', borderBottom: '1px solid #e2e8f0', position: 'sticky', top: 0 }}>
                            <th style={{ width: 40, padding: '12px', textAlign: 'center', fontWeight: 800, fontSize: 12, color: '#64748b' }}></th>
                            <th style={{ width: 150, padding: '12px', textAlign: 'left', fontWeight: 800, fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>MO Status</th>
                            <th style={{ padding: '12px', textAlign: 'left', fontWeight: 800, fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Business & Address</th>
                            <th style={{ width: 160, padding: '12px', textAlign: 'left', fontWeight: 800, fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Inspection Date</th>
                            <th style={{ width: 140, padding: '12px', textAlign: 'left', fontWeight: 800, fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Inspectors</th>
                          </tr>
                        </thead>
                        <tbody>
                          {complaints.filter((c) => {
                            const s = String(c.mission_order_status || '').toLowerCase();
                            return s === 'rejected';
                          }).length === 0 ? (
                            <tr>
                              <td colSpan="5" style={{ textAlign: 'center', padding: 32, color: '#475569' }}>
                                No rejected items
                              </td>
                            </tr>
                          ) : (
                            complaints.filter((c) => {
                              const s = String(c.mission_order_status || '').toLowerCase();
                              return s === 'rejected';
                            }).map((c) => (
                              <React.Fragment key={`rejected-${c.complaint_id}`}>
                                <tr
                                  style={{
                                    cursor: 'pointer',
                                    borderBottom: '1px solid #e2e8f0',
                                    transition: 'background-color 0.2s ease',
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
                                        setExpandedComplaintId(expandedComplaintId === c.complaint_id ? null : c.complaint_id);
                                      }}
                                      style={{
                                        background: 'none',
                                        border: 'none',
                                        outline: 'none',
                                        cursor: 'pointer',
                                        padding: 0,
                                        color: '#64748b',
                                        transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                                        transform: expandedComplaintId === c.complaint_id ? 'rotate(180deg)' : 'rotate(0deg)',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        width: 24,
                                        height: 24,
                                      }}
                                    >
                                      <svg width="20" height="20" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">
                                        <path d="M80 160L256 320L432 160" stroke="currentColor" strokeWidth="40" strokeLinecap="round" strokeLinejoin="round"/>
                                      </svg>
                                    </button>
                                  </td>
                                  <td onClick={() => createMissionOrder(c.complaint_id, 'results')}>
                                    <span className={statusBadgeClass(c.mission_order_status)}>
                                      {c.mission_order_status ? formatStatus(c.mission_order_status) : 'No MO'}
                                    </span>
                                  </td>
                                  <td onClick={() => createMissionOrder(c.complaint_id, 'results')}>
                                    <div className="dash-cell-title">{c.business_name || '—'}</div>
                                    <div className="dash-cell-sub">{c.business_address || ''}</div>
                                  </td>
                                  <td style={{ padding: '12px', fontSize: 14, color: '#1e293b' }}>
                                    {c.date_of_inspection ? new Date(c.date_of_inspection).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }) : '—'}
                                  </td>
                                  <td>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, minHeight: 30, alignItems: 'center', fontSize: 12 }}>
                                      {(c.inspector_names || []).length === 0 ? (
                                        <span style={{ color: '#64748b', fontWeight: 700 }}>—</span>
                                      ) : (
                                        (c.inspector_names || []).map((name, idx) => (
                                          <span
                                            key={`${c.complaint_id}-${idx}`}
                                            style={{ padding: '4px 8px', borderRadius: 999, fontWeight: 700, border: '1px solid #e2e8f0', background: '#f8fafc', fontSize: 11 }}
                                          >
                                            {name}
                                          </span>
                                        ))
                                      )}
                                    </div>
                                  </td>
                                </tr>
                                {expandedComplaintId === c.complaint_id && (
                                  <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', animation: 'slideDown 0.3s cubic-bezier(0.4, 0, 0.2, 1)' }}>
                                    <td colSpan="5" style={{ padding: '16px 24px' }}>
                                      {/* Progress Timeline */}
                                      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                                        {/* Box 1: Submitted */}
                                        <div style={{
                                          background: '#ffffff',
                                          border: '1px solid #e2e8f0',
                                          borderRadius: 8,
                                          padding: '14px 16px',
                                          display: 'flex',
                                          flexDirection: 'column',
                                          gap: 6,
                                        }}>
                                          <div style={{ fontSize: 14, fontWeight: 800, color: '#1e293b', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
                                            {c.created_at ? new Date(c.created_at).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }) + ' ' + new Date(c.created_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : ''}
                                          </div>
                                          <div style={{ fontSize: 13, color: '#64748b', lineHeight: 1.5, fontFamily: 'system-ui, -apple-system, sans-serif' }}>
                                            Complaint Submitted by <span style={{ fontWeight: 700 }}>{c.reporter_email || 'No email provided'}</span>
                                          </div>
                                        </div>

                                        {/* Box 2: Approved */}
                                        <div style={{
                                          background: '#ffffff',
                                          border: '1px solid #e2e8f0',
                                          borderRadius: 8,
                                          padding: '14px 16px',
                                          display: 'flex',
                                          flexDirection: 'column',
                                          gap: 6,
                                        }}>
                                          <div style={{ fontSize: 14, fontWeight: 800, color: '#1e293b', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
                                            {c.approved_at ? new Date(c.approved_at).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }) + ' ' + new Date(c.approved_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : ''}
                                          </div>
                                          <div style={{ fontSize: 13, color: '#64748b', lineHeight: 1.5, fontFamily: 'system-ui, -apple-system, sans-serif' }}>
                                            Complaint Approved
                                          </div>
                                        </div>

                                        {/* Box 3: Mission Order Created */}
                                        {c.mission_order_created_at && (
                                          <div style={{
                                            background: '#ffffff',
                                            border: '1px solid #e2e8f0',
                                            borderRadius: 8,
                                            padding: '14px 16px',
                                            display: 'flex',
                                            flexDirection: 'column',
                                            gap: 6,
                                          }}>
                                            <div style={{ fontSize: 14, fontWeight: 800, color: '#1e293b', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
                                              {new Date(c.mission_order_created_at).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }) + ' ' + new Date(c.mission_order_created_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                                            </div>
                                            <div style={{ fontSize: 13, color: '#64748b', lineHeight: 1.5, fontFamily: 'system-ui, -apple-system, sans-serif' }}>
                                              Mission Order Created
                                            </div>
                                          </div>
                                        )}
                                      </div>
                                    </td>
                                  </tr>
                                )}
                              </React.Fragment>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Pre-Approved Section */}
                  <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 14, boxShadow: '0 4px 12px rgba(2,6,23,0.08)', overflow: 'hidden' }}>
                    <div style={{ padding: '18px 24px', background: '#0b2249', borderBottom: 'none' }}>
                      <h3 style={{ margin: 0, fontSize: 18, fontWeight: 900, color: '#ffffff' }}>Pre-Approved</h3>
                      <div style={{ fontSize: 13, fontWeight: 600, marginTop: 6, color: '#10b981' }}>
                        {complaints.filter((c) => {
                          const s = String(c.mission_order_status || '').toLowerCase();
                          return s === 'issued' || s === 'for inspection' || s === 'for_inspection';
                        }).length} items
                      </div>
                    </div>
                    <div style={{ overflowX: 'auto', maxHeight: '600px', overflowY: 'auto' }}>
                      <table className="dash-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr style={{ background: '#ffffff', borderBottom: '1px solid #e2e8f0', position: 'sticky', top: 0 }}>
                            <th style={{ width: 40, padding: '12px', textAlign: 'center', fontWeight: 800, fontSize: 12, color: '#64748b' }}></th>
                            <th style={{ width: 150, padding: '12px', textAlign: 'left', fontWeight: 800, fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>MO Status</th>
                            <th style={{ padding: '12px', textAlign: 'left', fontWeight: 800, fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Business & Address</th>
                            <th style={{ width: 160, padding: '12px', textAlign: 'left', fontWeight: 800, fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Inspection Date</th>
                            <th style={{ width: 140, padding: '12px', textAlign: 'left', fontWeight: 800, fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Inspectors</th>
                          </tr>
                        </thead>
                        <tbody>
                          {complaints.filter((c) => {
                            const s = String(c.mission_order_status || '').toLowerCase();
                            return s === 'issued' || s === 'for inspection' || s === 'for_inspection';
                          }).length === 0 ? (
                            <tr>
                              <td colSpan="5" style={{ textAlign: 'center', padding: 32, color: '#475569' }}>
                                No pre-approved items
                              </td>
                            </tr>
                          ) : (
                            complaints.filter((c) => {
                              const s = String(c.mission_order_status || '').toLowerCase();
                              return s === 'issued' || s === 'for inspection' || s === 'for_inspection';
                            }).map((c) => (
                              <React.Fragment key={`preapproved-${c.complaint_id}`}>
                                <tr
                                  style={{
                                    cursor: 'pointer',
                                    borderBottom: '1px solid #e2e8f0',
                                    transition: 'background-color 0.2s ease',
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
                                        setExpandedComplaintId(expandedComplaintId === c.complaint_id ? null : c.complaint_id);
                                      }}
                                      style={{
                                        background: 'none',
                                        border: 'none',
                                        outline: 'none',
                                        cursor: 'pointer',
                                        padding: 0,
                                        color: '#64748b',
                                        transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                                        transform: expandedComplaintId === c.complaint_id ? 'rotate(180deg)' : 'rotate(0deg)',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        width: 24,
                                        height: 24,
                                      }}
                                    >
                                      <svg width="20" height="20" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">
                                        <path d="M80 160L256 320L432 160" stroke="currentColor" strokeWidth="40" strokeLinecap="round" strokeLinejoin="round"/>
                                      </svg>
                                    </button>
                                  </td>
                                  <td onClick={() => createMissionOrder(c.complaint_id, 'results')}>
                                    <span className={statusBadgeClass(c.mission_order_status)}>
                                      {c.mission_order_status ? formatStatus(c.mission_order_status) : 'No MO'}
                                    </span>
                                  </td>
                                  <td onClick={() => createMissionOrder(c.complaint_id, 'results')}>
                                    <div className="dash-cell-title">{c.business_name || '—'}</div>
                                    <div className="dash-cell-sub">{c.business_address || ''}</div>
                                  </td>
                                  <td style={{ padding: '12px', fontSize: 14, color: '#1e293b' }}>
                                    {c.date_of_inspection ? new Date(c.date_of_inspection).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }) : '—'}
                                  </td>
                                  <td>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, minHeight: 30, alignItems: 'center', fontSize: 12 }}>
                                      {(c.inspector_names || []).length === 0 ? (
                                        <span style={{ color: '#64748b', fontWeight: 700 }}>—</span>
                                      ) : (
                                        (c.inspector_names || []).map((name, idx) => (
                                          <span
                                            key={`${c.complaint_id}-${idx}`}
                                            style={{ padding: '4px 8px', borderRadius: 999, fontWeight: 700, border: '1px solid #e2e8f0', background: '#f8fafc', fontSize: 11 }}
                                          >
                                            {name}
                                          </span>
                                        ))
                                      )}
                                    </div>
                                  </td>
                                </tr>
                                {expandedComplaintId === c.complaint_id && (
                                  <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', animation: 'slideDown 0.3s cubic-bezier(0.4, 0, 0.2, 1)' }}>
                                    <td colSpan="5" style={{ padding: '16px 24px' }}>
                                      {/* Progress Timeline */}
                                      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                                        {/* Box 1: Submitted */}
                                        <div style={{
                                          background: '#ffffff',
                                          border: '1px solid #e2e8f0',
                                          borderRadius: 8,
                                          padding: '14px 16px',
                                          display: 'flex',
                                          flexDirection: 'column',
                                          gap: 6,
                                        }}>
                                          <div style={{ fontSize: 14, fontWeight: 800, color: '#1e293b', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
                                            {c.created_at ? new Date(c.created_at).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }) + ' ' + new Date(c.created_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : ''}
                                          </div>
                                          <div style={{ fontSize: 13, color: '#64748b', lineHeight: 1.5, fontFamily: 'system-ui, -apple-system, sans-serif' }}>
                                            Complaint Submitted by <span style={{ fontWeight: 700 }}>{c.reporter_email || 'No email provided'}</span>
                                          </div>
                                        </div>

                                        {/* Box 2: Approved */}
                                        <div style={{
                                          background: '#ffffff',
                                          border: '1px solid #e2e8f0',
                                          borderRadius: 8,
                                          padding: '14px 16px',
                                          display: 'flex',
                                          flexDirection: 'column',
                                          gap: 6,
                                        }}>
                                          <div style={{ fontSize: 14, fontWeight: 800, color: '#1e293b', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
                                            {c.approved_at ? new Date(c.approved_at).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }) + ' ' + new Date(c.approved_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : ''}
                                          </div>
                                          <div style={{ fontSize: 13, color: '#64748b', lineHeight: 1.5, fontFamily: 'system-ui, -apple-system, sans-serif' }}>
                                            Complaint Approved
                                          </div>
                                        </div>

                                        {/* Box 3: Mission Order Created */}
                                        {c.mission_order_created_at && (
                                          <div style={{
                                            background: '#ffffff',
                                            border: '1px solid #e2e8f0',
                                            borderRadius: 8,
                                            padding: '14px 16px',
                                            display: 'flex',
                                            flexDirection: 'column',
                                            gap: 6,
                                          }}>
                                            <div style={{ fontSize: 14, fontWeight: 800, color: '#1e293b', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
                                              {new Date(c.mission_order_created_at).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }) + ' ' + new Date(c.mission_order_created_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                                            </div>
                                            <div style={{ fontSize: 13, color: '#64748b', lineHeight: 1.5, fontFamily: 'system-ui, -apple-system, sans-serif' }}>
                                              Mission Order Created
                                            </div>
                                          </div>
                                        )}
                                      </div>
                                    </td>
                                  </tr>
                                )}
                              </React.Fragment>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              ) : tab === 'inspection' ? (
                <div style={{ display: 'grid', gap: 20 }}>
                  {(() => {
                    const normalize = (v) => String(v || '').toLowerCase().trim();
                    const pending = (filteredComplaints || [])
                      .filter((c) => normalize(c.inspection_status) === 'pending inspection')
                      .sort((a, b) => {
                        const tA = a.date_of_inspection ? new Date(a.date_of_inspection).getTime() : 0;
                        const tB = b.date_of_inspection ? new Date(b.date_of_inspection).getTime() : 0;
                        return tA - tB;
                      });

                    const inProgress = (filteredComplaints || [])
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
                                    key={`insp-${title}-${c.complaint_id}`}
                                    style={{ borderBottom: '1px solid #e2e8f0', cursor: c.mission_order_id ? 'pointer' : 'default' }}
                                    title={c.mission_order_id ? 'View mission order' : 'No mission order available'}
                                    onClick={() => {
                                      if (c.mission_order_id) {
                                        window.location.assign(`/mission-order/review?id=${c.mission_order_id}`);
                                      }
                                    }}
                                  >
                                    <td style={{ padding: '12px' }}>
                                      <span
                                        className={statusBadgeClass(c.inspection_status)}
                                        style={{ whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center' }}
                                      >
                                        {formatStatus(c.inspection_status)}
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
                                            <span key={`${c.complaint_id}-${idx}`} style={{ padding: '4px 8px', borderRadius: 999, fontWeight: 700, border: '1px solid #e2e8f0', background: '#f8fafc', fontSize: 11 }}>
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
                inspectionHistoryByDay.sortedKeys.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: 32, color: '#475569', background: '#f8fafc', borderRadius: 12, border: '1px solid #e2e8f0' }}>
                    {loading ? 'Loading…' : 'No inspection history found.'}
                  </div>
                ) : (
                  <div style={{ display: 'grid', gap: 20 }}>
                    {inspectionHistoryByDay.sortedKeys.map((dayKey) => {
                      const dayGroup = inspectionHistoryByDay.groups[dayKey];
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
                          <div style={{ padding: '18px 24px', background: '#0b2249', borderBottom: 'none' }}>
                            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 900, color: '#ffffff' }}>
                              {label}{dayKey !== 'unknown' ? `, ${new Date(dayKey).getFullYear()}` : ''}
                            </h3>
                            <div style={{ fontSize: 13, fontWeight: 600, color: '#22c55e', marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
                              <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#22c55e', flexShrink: 0 }}></div>
                              <span>{itemCount} Completed Inspection{itemCount === 1 ? '' : 's'}</span>
                            </div>
                          </div>

                          <div style={{ overflowX: 'auto' }}>
                            <table className="dash-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                              <thead>
                                <tr style={{ background: '#ffffff', borderBottom: '1px solid #e2e8f0' }}>
                                  <th style={{ width: 170, padding: '12px', textAlign: 'left', fontWeight: 800, fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Inspection Status</th>
                                  <th style={{ padding: '12px', textAlign: 'left', fontWeight: 800, fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Business & Address</th>
                                  <th style={{ width: 210, padding: '12px', textAlign: 'left', fontWeight: 800, fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Inspection Date</th>
                                  <th style={{ width: 210, padding: '12px', textAlign: 'left', fontWeight: 800, fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Completed Date</th>
                                  <th style={{ width: 220, padding: '12px', textAlign: 'left', fontWeight: 800, fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Inspectors</th>
                                </tr>
                              </thead>
                              <tbody>
                                {dayGroup.items.map((r) => (
                                  <tr
                                    key={`insp-hist-${r.inspection_report_id}`}
                                    style={{ borderBottom: '1px solid #e2e8f0', cursor: r.mission_order_id ? 'pointer' : 'default' }}
                                    title={r.mission_order_id ? 'View mission order' : ''}
                                    onClick={() => {
                                      if (r.mission_order_id) {
                                        window.location.assign(`/mission-order/review?id=${r.mission_order_id}`);
                                      }
                                    }}
                                  >
                                    <td style={{ padding: '12px' }}>
                                      <span
                                        className={statusBadgeClass(r.inspection_status)}
                                        style={{ whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center' }}
                                      >
                                        {formatStatus(r.inspection_status)}
                                      </span>
                                    </td>
                                    <td style={{ padding: '12px' }}>
                                      <div className="dash-cell-title">{r.business_name || '—'}</div>
                                      <div className="dash-cell-sub">{r.business_address || ''}</div>
                                    </td>
                                    <td style={{ padding: '12px', fontSize: 14, color: '#1e293b' }}>
                                      {r.inspection_date ? new Date(r.inspection_date).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }) : '—'}
                                    </td>
                                    <td style={{ padding: '12px', fontSize: 14, color: '#1e293b' }}>
                                      {r.inspection_completed_at ? new Date(r.inspection_completed_at).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }) : '—'}
                                    </td>
                                    <td style={{ padding: '12px' }}>
                                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                        {(r.inspector_names || []).length === 0 ? (
                                          <span style={{ color: '#64748b', fontWeight: 700 }}>—</span>
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
                    })}
                  </div>
                )
              ) : tab === 'for-inspection' ? (
                <div style={{ display: 'grid', gap: 20 }}>
                  {filteredComplaints.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: 32, color: '#475569', background: '#f8fafc', borderRadius: 12, border: '1px solid #e2e8f0' }}>
                      {loading ? 'Loading…' : 'No records found for this tab.'}
                    </div>
                  ) : (
                    complaintsByDay.sortedKeys.map((dayKey) => {
                      const dayGroup = complaintsByDay.groups[dayKey];
                      const label = dayGroup?.label || dayKey;
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
                              {new Date(dayKey).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}
                            </h3>
                            <div style={{ fontSize: 13, fontWeight: 600, color: '#F2B705', marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
                              <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#F2B705', flexShrink: 0 }}></div>
                              <span>{count} Pending Signature{count !== 1 ? 's' : ''}</span>
                            </div>
                          </div>

                          {/* Table for this day */}
                          <div style={{ overflowX: 'auto' }}>
                            <table className="dash-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                              <thead>
                                <tr style={{ background: '#ffffff', borderBottom: '1px solid #e2e8f0' }}>
                                  <th style={{ width: 40, padding: '12px', textAlign: 'center', fontWeight: 800, fontSize: 12, color: '#64748b' }}></th>
                                  <th style={{ width: 150, padding: '12px', textAlign: 'left', fontWeight: 800, fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>MO Status</th>
                                  <th style={{ padding: '12px', textAlign: 'left', fontWeight: 800, fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Business & Address</th>
                                  <th style={{ width: 160, padding: '12px', textAlign: 'left', fontWeight: 800, fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Inspection Date</th>
                                  <th style={{ width: 140, padding: '12px', textAlign: 'left', fontWeight: 800, fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Inspectors</th>
                                  <th style={{ width: 120, padding: '12px', textAlign: 'left', fontWeight: 800, fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Signed?</th>
                                </tr>
                              </thead>
                              <tbody>
                                {dayGroup.items.map((c) => (
                                  <React.Fragment key={c.complaint_id}>
                                    <tr
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
                                            setExpandedComplaintId(expandedComplaintId === c.complaint_id ? null : c.complaint_id);
                                          }}
                                          style={{
                                            background: 'none',
                                            border: 'none',
                                            outline: 'none',
                                            cursor: 'pointer',
                                            padding: 0,
                                            color: '#64748b',
                                            transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                                            transform: expandedComplaintId === c.complaint_id ? 'rotate(180deg)' : 'rotate(0deg)',
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            width: 24,
                                            height: 24,
                                          }}
                                        >
                                          <svg width="20" height="20" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">
                                            <path d="M80 160L256 320L432 160" stroke="currentColor" strokeWidth="40" strokeLinecap="round" strokeLinejoin="round"/>
                                          </svg>
                                        </button>
                                      </td>
                                      <td onClick={() => createMissionOrder(c.complaint_id, 'for-inspection')}>
                                        <span style={{
                                          display: 'inline-block',
                                          padding: '6px 10px',
                                          borderRadius: 999,
                                          background: '#f3e8ff',
                                          color: '#7c3aed',
                                          border: '1px solid #d8b4fe',
                                          fontWeight: 800,
                                          fontSize: 12,
                                          textTransform: 'capitalize',
                                          whiteSpace: 'nowrap'
                                        }}>
                                          {c.mission_order_status ? formatStatus(c.mission_order_status) : 'No MO'}
                                        </span>
                                      </td>
                                      <td onClick={() => createMissionOrder(c.complaint_id, 'for-inspection')}>
                                        <div className="dash-cell-title">{c.business_name || '—'}</div>
                                        <div className="dash-cell-sub">{c.business_address || ''}</div>
                                      </td>
                                      <td style={{ padding: '12px', fontSize: 14, color: '#1e293b' }}>
                                        {c.date_of_inspection ? new Date(c.date_of_inspection).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }) : '—'}
                                      </td>
                                      <td>
                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, minHeight: 30, alignItems: 'center', fontSize: 12 }}>
                                          {(c.inspector_names || []).length === 0 ? (
                                            <span style={{ color: '#64748b', fontWeight: 700 }}>—</span>
                                          ) : (
                                            (c.inspector_names || []).map((name, idx) => (
                                              <span
                                                key={`${c.complaint_id}-${idx}`}
                                                style={{ padding: '4px 8px', borderRadius: 999, fontWeight: 700, border: '1px solid #e2e8f0', background: '#f8fafc', fontSize: 11 }}
                                              >
                                                {name}
                                              </span>
                                            ))
                                          )}
                                        </div>
                                      </td>
                                      <td>
                                        <label
                                          title="Upload signed attachment (PDF/PNG) and archive"
                                          style={{
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            width: 40,
                                            height: 32,
                                            borderRadius: 8,
                                            border: 'none',
                                            background: '#10b981',
                                            cursor: loading ? 'not-allowed' : 'pointer',
                                            transition: 'background-color 0.2s ease, transform 0.15s ease',
                                            opacity: loading ? 0.75 : 1,
                                          }}
                                          onMouseEnter={(e) => {
                                            e.currentTarget.style.background = '#059669';
                                            e.currentTarget.style.transform = 'translateY(-1px)';
                                          }}
                                          onMouseLeave={(e) => {
                                            e.currentTarget.style.background = '#10b981';
                                            e.currentTarget.style.transform = 'translateY(0)';
                                          }}
                                          onClick={(e) => {
                                            // Prevent row expansion/click
                                            e.stopPropagation();
                                            if (loading) {
                                              e.preventDefault();
                                            }
                                          }}
                                        >
                                          {/* Simple upload icon (inline SVG) */}
                                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                                            <path d="M12 3V15" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
                                            <path d="M7 8L12 3L17 8" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                            <path d="M4 14V20H20V14" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                          </svg>
                                          <input
                                            type="file"
                                            accept="application/pdf,image/png,.pdf,.png"
                                            style={{ display: 'none' }}
                                            disabled={loading}
                                            onChange={(e) => {
                                              const file = e.target.files && e.target.files[0];
                                              // Reset input so selecting the same file again triggers onChange
                                              e.target.value = '';
                                              if (!file) return;
                                              archiveMissionOrder(c.mission_order_id, file);
                                            }}
                                          />
                                        </label>
                                      </td>
                                    </tr>
                                    {expandedComplaintId === c.complaint_id && (
                                      <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', animation: 'slideDown 0.3s cubic-bezier(0.4, 0, 0.2, 1)' }}>
                                        <td colSpan="6" style={{ padding: '16px 24px' }}>
                                          {/* Progress Timeline */}
                                          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                                            {/* Box 1: Submitted */}
                                            <div style={{
                                              background: '#ffffff',
                                              border: '1px solid #e2e8f0',
                                              borderRadius: 8,
                                              padding: '14px 16px',
                                              display: 'flex',
                                              flexDirection: 'column',
                                              gap: 6,
                                            }}>
                                              <div style={{ fontSize: 14, fontWeight: 800, color: '#1e293b', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
                                                {c.created_at ? new Date(c.created_at).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }) + ' ' + new Date(c.created_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : ''}
                                              </div>
                                              <div style={{ fontSize: 13, color: '#64748b', lineHeight: 1.5, fontFamily: 'system-ui, -apple-system, sans-serif' }}>
                                                Complaint Submitted by <span style={{ fontWeight: 700 }}>{c.reporter_email || 'No email provided'}</span>
                                              </div>
                                            </div>

                                            {/* Box 2: Approved */}
                                            <div style={{
                                              background: '#ffffff',
                                              border: '1px solid #e2e8f0',
                                              borderRadius: 8,
                                              padding: '14px 16px',
                                              display: 'flex',
                                              flexDirection: 'column',
                                              gap: 6,
                                            }}>
                                              <div style={{ fontSize: 14, fontWeight: 800, color: '#1e293b', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
                                                {c.approved_at ? new Date(c.approved_at).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }) + ' ' + new Date(c.approved_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : ''}
                                              </div>
                                              <div style={{ fontSize: 13, color: '#64748b', lineHeight: 1.5, fontFamily: 'system-ui, -apple-system, sans-serif' }}>
                                                Complaint Approved
                                              </div>
                                            </div>

                                            {/* Box 3: Mission Order Created */}
                                            <div style={{
                                              background: '#ffffff',
                                              border: '1px solid #e2e8f0',
                                              borderRadius: 8,
                                              padding: '14px 16px',
                                              display: 'flex',
                                              flexDirection: 'column',
                                              gap: 6,
                                            }}>
                                              <div style={{ fontSize: 14, fontWeight: 800, color: '#1e293b', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
                                                {c.mission_order_created_at ? new Date(c.mission_order_created_at).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }) + ' ' + new Date(c.mission_order_created_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : ''}
                                              </div>
                                              <div style={{ fontSize: 13, color: '#64748b', lineHeight: 1.5, fontFamily: 'system-ui, -apple-system, sans-serif' }}>
                                                Mission Order Created
                                              </div>
                                            </div>
                                          </div>
                                        </td>
                                      </tr>
                                    )}
                                  </React.Fragment>
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
                      {loading ? 'Loading…' : 'No records found for this tab.'}
                    </div>
                  ) : (
                    complaintsByDay.sortedKeys.map((dayKey) => {
                      const dayGroup = complaintsByDay.groups[dayKey];
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
                              {new Date(dayKey).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}
                            </h3>
                            <div style={{ fontSize: 13, fontWeight: 600, color: '#10b981', marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
                              <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#10b981', flexShrink: 0 }}></div>
                              <span>{count} Completed Mission Order{count !== 1 ? 's' : ''}</span>
                            </div>
                          </div>

                          {/* Table for this day */}
                          <div style={{ overflowX: 'auto' }}>
                            <table className="dash-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                              <thead>
                                <tr style={{ background: '#ffffff', borderBottom: '1px solid #e2e8f0' }}>
                                  <th style={{ width: 40, padding: '12px', textAlign: 'center', fontWeight: 800, fontSize: 12, color: '#64748b' }}></th>
                                  <th style={{ width: 150, padding: '12px', textAlign: 'left', fontWeight: 800, fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>MO Status</th>
                                  <th style={{ padding: '12px', textAlign: 'left', fontWeight: 800, fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Business & Address</th>
                                  <th style={{ width: 160, padding: '12px', textAlign: 'left', fontWeight: 800, fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Inspection Date</th>
                                  <th style={{ width: 140, padding: '12px', textAlign: 'left', fontWeight: 800, fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Inspectors</th>
                                </tr>
                              </thead>
                              <tbody>
                                {dayGroup.items.map((c) => (
                                  <React.Fragment key={`history-${c.complaint_id}`}>
                                    <tr
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
                                            setExpandedComplaintId(expandedComplaintId === c.complaint_id ? null : c.complaint_id);
                                          }}
                                          style={{
                                            background: 'none',
                                            border: 'none',
                                            outline: 'none',
                                            cursor: 'pointer',
                                            padding: 0,
                                            color: '#64748b',
                                            transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                                            transform: expandedComplaintId === c.complaint_id ? 'rotate(180deg)' : 'rotate(0deg)',
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            width: 24,
                                            height: 24,
                                          }}
                                        >
                                          <svg width="20" height="20" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">
                                            <path d="M80 160L256 320L432 160" stroke="currentColor" strokeWidth="40" strokeLinecap="round" strokeLinejoin="round"/>
                                          </svg>
                                        </button>
                                      </td>
                                      <td onClick={() => createMissionOrder(c.complaint_id, 'revisions')}>
                                        <span className={statusBadgeClass(c.mission_order_status)}>
                                          {c.mission_order_status ? formatStatus(c.mission_order_status) : 'No MO'}
                                        </span>
                                      </td>
                                      <td onClick={() => createMissionOrder(c.complaint_id, 'revisions')}>
                                        <div className="dash-cell-title">{c.business_name || '—'}</div>
                                        <div className="dash-cell-sub">{c.business_address || ''}</div>
                                      </td>
                                      <td style={{ padding: '12px', fontSize: 14, color: '#1e293b' }}>
                                        {c.date_of_inspection ? new Date(c.date_of_inspection).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }) : '—'}
                                      </td>
                                      <td>
                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, minHeight: 30, alignItems: 'center', fontSize: 12 }}>
                                          {(c.inspector_names || []).length === 0 ? (
                                            <span style={{ color: '#64748b', fontWeight: 700 }}>—</span>
                                          ) : (
                                            (c.inspector_names || []).map((name, idx) => (
                                              <span
                                                key={`${c.complaint_id}-${idx}`}
                                                style={{ padding: '4px 8px', borderRadius: 999, fontWeight: 700, border: '1px solid #e2e8f0', background: '#f8fafc', fontSize: 11 }}
                                              >
                                                {name}
                                              </span>
                                            ))
                                          )}
                                        </div>
                                      </td>
                                    </tr>
                                    {expandedComplaintId === c.complaint_id && (
                                      <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', animation: 'slideDown 0.3s cubic-bezier(0.4, 0, 0.2, 1)' }}>
                                        <td colSpan="5" style={{ padding: '16px 24px' }}>
                                          {/* Progress Timeline */}
                                          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                                            {/* Box 1: Submitted */}
                                            <div style={{
                                              background: '#ffffff',
                                              border: '1px solid #e2e8f0',
                                              borderRadius: 8,
                                              padding: '14px 16px',
                                              display: 'flex',
                                              flexDirection: 'column',
                                              gap: 6,
                                            }}>
                                              <div style={{ fontSize: 14, fontWeight: 800, color: '#1e293b', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
                                                {c.created_at ? new Date(c.created_at).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }) + ' ' + new Date(c.created_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : ''}
                                              </div>
                                              <div style={{ fontSize: 13, color: '#64748b', lineHeight: 1.5, fontFamily: 'system-ui, -apple-system, sans-serif' }}>
                                                Complaint Submitted by <span style={{ fontWeight: 700 }}>{c.reporter_email || 'No email provided'}</span>
                                              </div>
                                            </div>

                                            {/* Box 2: Approved */}
                                            <div style={{
                                              background: '#ffffff',
                                              border: '1px solid #e2e8f0',
                                              borderRadius: 8,
                                              padding: '14px 16px',
                                              display: 'flex',
                                              flexDirection: 'column',
                                              gap: 6,
                                            }}>
                                              <div style={{ fontSize: 14, fontWeight: 800, color: '#1e293b', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
                                                {c.approved_at ? new Date(c.approved_at).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }) + ' ' + new Date(c.approved_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : ''}
                                              </div>
                                              <div style={{ fontSize: 13, color: '#64748b', lineHeight: 1.5, fontFamily: 'system-ui, -apple-system, sans-serif' }}>
                                                Complaint Approved
                                              </div>
                                            </div>

                                            {/* Box 3: Mission Order Created */}
                                            {c.mission_order_created_at && (
                                              <div style={{
                                                background: '#ffffff',
                                                border: '1px solid #e2e8f0',
                                                borderRadius: 8,
                                                padding: '14px 16px',
                                                display: 'flex',
                                                flexDirection: 'column',
                                                gap: 6,
                                              }}>
                                                <div style={{ fontSize: 14, fontWeight: 800, color: '#1e293b', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
                                                  {new Date(c.mission_order_created_at).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }) + ' ' + new Date(c.mission_order_created_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                                                </div>
                                                <div style={{ fontSize: 13, color: '#64748b', lineHeight: 1.5, fontFamily: 'system-ui, -apple-system, sans-serif' }}>
                                                  Mission Order Created
                                                </div>
                                              </div>
                                            )}

                                            {/* Box 4: Pre-Approved by Director */}
                                            {c.director_preapproved_at && (
                                              <div style={{
                                                background: '#ffffff',
                                                border: '1px solid #e2e8f0',
                                                borderRadius: 8,
                                                padding: '14px 16px',
                                                display: 'flex',
                                                flexDirection: 'column',
                                                gap: 6,
                                              }}>
                                                <div style={{ fontSize: 14, fontWeight: 800, color: '#1e293b', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
                                                  {new Date(c.director_preapproved_at).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }) + ' ' + new Date(c.director_preapproved_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                                                </div>
                                                <div style={{ fontSize: 13, color: '#64748b', lineHeight: 1.5, fontFamily: 'system-ui, -apple-system, sans-serif' }}>
                                                  Mission Order Pre-Approved by Director
                                                </div>
                                              </div>
                                            )}

                                            {/* Box 5: Signed by Secretary */}
                                            <div style={{
                                              background: '#ffffff',
                                              border: '1px solid #e2e8f0',
                                              borderRadius: 8,
                                              padding: '14px 16px',
                                              display: 'flex',
                                              flexDirection: 'column',
                                              gap: 6,
                                            }}>
                                              <div style={{ fontSize: 14, fontWeight: 800, color: '#1e293b', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
                                                {(() => {
                                                  // Prefer explicit signed timestamp if present in the row; fallback to MO created_at.
                                                  const dtRaw = c.secretary_signed_at || c.mission_order_updated_at || c.mission_order_created_at;
                                                  const dt = dtRaw ? new Date(dtRaw) : null;
                                                  if (!dt || Number.isNaN(dt.getTime())) return 'Signed by Secretary';
                                                  return `${dt.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })} ${dt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
                                                })()}
                                              </div>
                                              <div style={{ fontSize: 13, color: '#64748b', lineHeight: 1.5, fontFamily: 'system-ui, -apple-system, sans-serif' }}>
                                                Mission Order Signed by Secretary
                                              </div>
                                            </div>
                                          </div>
                                        </td>
                                      </tr>
                                    )}
                                  </React.Fragment>
                                ))}
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
    </div>
  );
}
