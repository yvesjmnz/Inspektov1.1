import { supabase } from '../supabase';
import { pickPreferredInspectionReport } from '../inspectionReports';

/**
 * Metrics Service - Calculates KPIs for Director and Head Inspector dashboards
 * 
 * Key Metrics:
 * - Complaint Processing Time (created_at to approved_at/declined_at)
 * - Mission Order Creation Time (complaint approved to MO created)
 * - Inspection Duration (started_at to completed_at)
 * - Recurring Complaints (same business)
 * - Complaint Resolution Rate
 * - Average Decision Time
 */

/**
 * Get Director-level metrics
 * Includes: all complaints, mission orders, inspections, recurring patterns
 */
export async function getDirectorMetrics(dateRange = null) {
  try {
    let complaintQuery = supabase
      .from('complaints')
      .select('id, business_name, business_pk, status, created_at, approved_at, declined_at, authenticity_level');

    let moQuery = supabase
      .from('mission_orders')
      .select('id, complaint_id, status, created_at, submitted_at, date_of_inspection, director_preapproved_at');

    let inspectionQuery = supabase
      .from('inspection_reports')
      .select('id, mission_order_id, status, started_at, completed_at, created_at');

    // Apply date range if provided
    if (dateRange?.start && dateRange?.end) {
      const start = new Date(dateRange.start);
      const end = new Date(dateRange.end);
      end.setDate(end.getDate() + 1); // Include full end day

      complaintQuery = complaintQuery
        .gte('created_at', start.toISOString())
        .lt('created_at', end.toISOString());

      moQuery = moQuery
        .gte('created_at', start.toISOString())
        .lt('created_at', end.toISOString());

      inspectionQuery = inspectionQuery
        .gte('created_at', start.toISOString())
        .lt('created_at', end.toISOString());
    }

    const [{ data: complaints, error: cErr }, { data: missionOrders, error: moErr }, { data: inspections, error: iErr }] = await Promise.all([
      complaintQuery,
      moQuery,
      inspectionQuery,
    ]);

    if (cErr || moErr || iErr) throw new Error('Failed to fetch metrics data');

    // Calculate metrics
    const metrics = {
      complaints: calculateComplaintMetrics(complaints || []),
      missionOrders: calculateMissionOrderMetrics(missionOrders || [], complaints || []),
      inspections: calculateInspectionMetrics(inspections || []),
      recurring: calculateRecurringComplaints(complaints || []),
      timeline: calculateProcessingTimeline(complaints || [], missionOrders || []),
      complaintToMOPreapproval: calculateComplaintToMOPreapprovalTime(complaints || [], missionOrders || []),
      realtimeTrend: calculateDirectorRealtimeTrend(complaints || [], missionOrders || [], inspections || []),
    };

    return metrics;
  } catch (error) {
    console.error('Error fetching director metrics:', error);
    throw error;
  }
}

/**
 * Get Head Inspector-level metrics
 * Includes: mission orders assigned, inspection times, completion rates
 */
export async function getHeadInspectorMetrics(dateRange = null) {
  try {
    let moQuery = supabase
      .from('mission_orders')
      .select('id, complaint_id, status, created_at, date_of_inspection, director_preapproved_at');

    let inspectionQuery = supabase
      .from('inspection_reports')
      .select('id, mission_order_id, status, started_at, completed_at, created_at, inspector_id');

    let assignmentQuery = supabase
      .from('mission_order_assignments')
      .select('id, mission_order_id, inspector_id, assigned_at');

    // Apply date range
    if (dateRange?.start && dateRange?.end) {
      const start = new Date(dateRange.start);
      const end = new Date(dateRange.end);
      end.setDate(end.getDate() + 1);

      moQuery = moQuery
        .gte('created_at', start.toISOString())
        .lt('created_at', end.toISOString());

      inspectionQuery = inspectionQuery
        .gte('created_at', start.toISOString())
        .lt('created_at', end.toISOString());

      assignmentQuery = assignmentQuery
        .gte('assigned_at', start.toISOString())
        .lt('assigned_at', end.toISOString());
    }

    let complaintQuery = supabase
      .from('complaints')
      .select('id, status, created_at, approved_at');

    if (dateRange?.start && dateRange?.end) {
      const start = new Date(dateRange.start);
      const end = new Date(dateRange.end);
      end.setDate(end.getDate() + 1);

      complaintQuery = complaintQuery
        .gte('created_at', start.toISOString())
        .lt('created_at', end.toISOString());
    }

    const [{ data: missionOrders, error: moErr }, { data: inspections, error: iErr }, { data: assignments, error: aErr }, { data: complaints, error: cErr }] = await Promise.all([
      moQuery,
      inspectionQuery,
      assignmentQuery,
      complaintQuery,
    ]);

    if (moErr || iErr || aErr || cErr) throw new Error('Failed to fetch head inspector metrics');

    // compute inspection KPI: durations, avg, compliance (<=42 minutes), per-inspector averages
    const inspectionDurations = (inspections || [])
      .filter(i => (i.completed_at) && (i.started_at || i.created_at))
      .map(i => {
        const start = i.started_at || i.created_at;
        const mins = (new Date(i.completed_at).getTime() - new Date(start).getTime()) / (1000 * 60);
        return { inspector_id: i.inspector_id, mission_order_id: i.mission_order_id, mins };
      });

    const overallAvgInspection = inspectionDurations.length > 0
      ? Number((inspectionDurations.reduce((a,b) => a + b.mins, 0) / inspectionDurations.length).toFixed(1))
      : null;
    const overallCompliance = inspectionDurations.length > 0
      ? Number(((inspectionDurations.filter(d => d.mins <= 42).length / inspectionDurations.length) * 100).toFixed(1))
      : null;

    // per-inspector averages
    const perInspectorMap = new Map();
    for (const d of inspectionDurations) {
      if (!d.inspector_id) continue;
      if (!perInspectorMap.has(d.inspector_id)) perInspectorMap.set(d.inspector_id, []);
      perInspectorMap.get(d.inspector_id).push(d.mins);
    }
    const perInspector = Array.from(perInspectorMap.entries()).map(([inspectorId, arr]) => ({
      inspectorId,
      avg_inspection_minutes: arr.length > 0 ? Number((arr.reduce((a,b)=>a+b,0)/arr.length).toFixed(1)) : null,
      inspections_count: arr.length,
      compliance_rate: arr.length > 0 ? Number(((arr.filter(x=>x<=42).length/arr.length)*100).toFixed(1)) : null,
    }));

    const metrics = {
      missionOrders: calculateMissionOrderMetrics(missionOrders || [], complaints || []),
      inspections: calculateInspectionMetrics(inspections || []),
      assignments: calculateAssignmentMetrics(assignments || []),
      performance: calculateInspectorPerformance(inspections || [], assignments || []),
      timeline: calculateInspectionTimeline(inspections || []),
      complaintToMOPreapproval: calculateComplaintToMOPreapprovalTime(complaints || [], missionOrders || []),
      inspectionKpi: {
        overallAvgInspection,
        overallCompliance,
        perInspector,
      },
    };

    return metrics;
  } catch (error) {
    console.error('Error fetching head inspector metrics:', error);
    throw error;
  }
}

/**
 * Calculate complaint-level metrics
 */
function calculateComplaintMetrics(complaints) {
  const normalizeStatus = (status) => String(status || '').toLowerCase().trim();
  const total = complaints.length;
  const approved = complaints.filter((c) => ['approved', 'completed'].includes(normalizeStatus(c.status))).length;
  const declined = complaints.filter((c) => ['declined', 'rejected', 'invalid'].includes(normalizeStatus(c.status))).length;
  const pending = complaints.filter((c) => ['submitted', 'pending', 'new'].includes(normalizeStatus(c.status))).length;

  // Average decision time (hours)
  const decisionTimes = complaints
    .filter(c => c.created_at && (c.approved_at || c.declined_at))
    .map(c => {
      const created = new Date(c.created_at).getTime();
      const decided = new Date(c.approved_at || c.declined_at).getTime();
      return (decided - created) / (1000 * 60 * 60); // Convert to hours
    });

  const avgDecisionTime = decisionTimes.length > 0
    ? Number((decisionTimes.reduce((a, b) => a + b, 0) / decisionTimes.length).toFixed(2))
    : null;

  // Approval rate
  const approvalRate = total > 0 ? Number(((approved / total) * 100).toFixed(1)) : 0;

  // High authenticity complaints (>50)
  const highAuthenticity = complaints.filter(c => (c.authenticity_level || 0) > 50).length;

  return {
    total,
    approved,
    declined,
    pending,
    avgDecisionTime,
    approvalRate,
    highAuthenticity,
    decisionTimes: decisionTimes.sort((a, b) => a - b), // For percentile calculations
  };
}

/**
 * Calculate mission order metrics
 */
function calculateMissionOrderMetrics(missionOrders, complaints) {
  const total = missionOrders.length;
  const byStatus = {
    draft: missionOrders.filter(m => String(m.status || '').toLowerCase() === 'draft').length,
    issued: missionOrders.filter(m => String(m.status || '').toLowerCase() === 'issued').length,
    forInspection: missionOrders.filter(m => ['for inspection', 'for_inspection'].includes(String(m.status || '').toLowerCase())).length,
    complete: missionOrders.filter(m => String(m.status || '').toLowerCase() === 'complete').length,
    cancelled: missionOrders.filter(m => String(m.status || '').toLowerCase() === 'cancelled').length,
  };

  // Time from complaint approval to MO creation (hours)
  const complaintMap = new Map(complaints.map(c => [c.id, c]));
  const creationTimes = missionOrders
    .filter(m => m.complaint_id && m.created_at)
    .map(m => {
      const complaint = complaintMap.get(m.complaint_id);
      if (!complaint?.approved_at) return null;
      const approved = new Date(complaint.approved_at).getTime();
      const created = new Date(m.created_at).getTime();
      const timeDiff = (created - approved) / (1000 * 60 * 60); // hours
      // Filter out invalid records where MO was created before approval
      return timeDiff >= 0 ? timeDiff : null;
    })
    .filter(t => t !== null);

  const avgCreationTime = creationTimes.length > 0
    ? Number((creationTimes.reduce((a, b) => a + b, 0) / creationTimes.length).toFixed(2))
    : null;

  // Scheduled inspections (have date_of_inspection)
  const scheduled = missionOrders.filter(m => m.date_of_inspection).length;

  return {
    total,
    byStatus,
    avgCreationTime,
    scheduled,
    creationTimes: creationTimes.sort((a, b) => a - b),
  };
}

/**
 * Calculate inspection metrics
 */
function calculateInspectionMetrics(inspections) {
  const normalizedInspections = dedupeInspectionsByMissionOrder(inspections);
  const total = normalizedInspections.length;
  const byStatus = {
    pending: normalizedInspections.filter(i => ['pending inspection', 'pending_inspection', 'pending'].includes(String(i.status || '').toLowerCase())).length,
    inProgress: normalizedInspections.filter(i => ['in progress', 'in_progress'].includes(String(i.status || '').toLowerCase())).length,
    completed: normalizedInspections.filter(i => String(i.status || '').toLowerCase() === 'completed').length,
  };

  // Inspection duration (minutes) - from started_at to completed_at
  const durations = normalizedInspections
    .filter(i => i.started_at && i.completed_at)
    .map(i => {
      const started = new Date(i.started_at).getTime();
      const completed = new Date(i.completed_at).getTime();
      return (completed - started) / (1000 * 60); // minutes
    });

  const avgDuration = durations.length > 0
    ? Number((durations.reduce((a, b) => a + b, 0) / durations.length).toFixed(1))
    : null;

  // Legacy 5-10 minute compliance for existing shared reports
  const withinTarget = durations.filter(d => d >= 5 && d <= 10).length;
  const targetCompliance = durations.length > 0
    ? Number(((withinTarget / durations.length) * 100).toFixed(1))
    : null;

  const withinDirectorGoal = durations.filter(d => d <= 42).length;
  const directorGoalCompliance = durations.length > 0
    ? Number(((withinDirectorGoal / durations.length) * 100).toFixed(1))
    : null;

  // Completion rate
  const completionRate = total > 0
    ? Number(((byStatus.completed / total) * 100).toFixed(1))
    : 0;

  return {
    total,
    byStatus,
    avgDuration,
    targetCompliance,
    directorGoalCompliance,
    completionRate,
    durations: durations.sort((a, b) => a - b),
  };
}

/**
 * Calculate recurring complaints (same business)
 */
function calculateRecurringComplaints(complaints) {
  const byBusiness = new Map();

  complaints.forEach(c => {
    const key = c.business_pk || c.business_name;
    if (!key) return;

    if (!byBusiness.has(key)) {
      byBusiness.set(key, {
        businessName: c.business_name,
        businessPk: c.business_pk,
        count: 0,
        complaints: [],
      });
    }

    const entry = byBusiness.get(key);
    entry.count += 1;
    entry.complaints.push({
      id: c.id,
      status: c.status,
      createdAt: c.created_at,
    });
  });

  // Filter to only recurring (2+)
  const recurring = Array.from(byBusiness.values())
    .filter(e => e.count >= 2)
    .sort((a, b) => b.count - a.count);

  return {
    total: recurring.length,
    topOffenders: recurring.slice(0, 10),
    allRecurring: recurring,
  };
}

/**
 * Calculate assignment metrics
 */
function calculateAssignmentMetrics(assignments) {
  const total = assignments.length;

  // Group by inspector
  const byInspector = new Map();
  assignments.forEach(a => {
    if (!a.inspector_id) return;
    if (!byInspector.has(a.inspector_id)) {
      byInspector.set(a.inspector_id, {
        inspectorId: a.inspector_id,
        count: 0,
        assignments: [],
      });
    }
    const entry = byInspector.get(a.inspector_id);
    entry.count += 1;
    entry.assignments.push(a);
  });

  const byInspectorArray = Array.from(byInspector.values())
    .sort((a, b) => b.count - a.count);

  return {
    total,
    byInspector: byInspectorArray,
    avgPerInspector: total > 0 ? Number((total / byInspector.size).toFixed(1)) : 0,
  };
}

/**
 * Calculate inspector performance
 */
function calculateInspectorPerformance(inspections, assignments) {
  // Build a set of inspectors from assignments first (to include inspectors with zero inspections)
  const inspectorsSet = new Set();
  (assignments || []).forEach(a => {
    if (a.inspector_id) inspectorsSet.add(a.inspector_id);
  });

  // Also include any inspectors present on inspection records
  (inspections || []).forEach(i => {
    if (i.inspector_id) inspectorsSet.add(i.inspector_id);
  });

  const byInspector = new Map();
  // initialize inspector entries
  inspectorsSet.forEach(id => {
    byInspector.set(id, {
      inspectorId: id,
      total: 0,
      completed: 0,
      inProgress: 0,
      pending: 0,
      avgDuration: null,
      durations: [],
    });
  });

  // If there are no inspectors from assignments or inspections, return empty array
  if (byInspector.size === 0) return [];

  // Aggregate inspection stats; if an inspection has no assignment mapping, still attribute to its inspector_id
  inspections.forEach(i => {
    const inspectorIds = i.inspector_id ? [i.inspector_id] : [];
    inspectorIds.forEach(inspectorId => {
      if (!byInspector.has(inspectorId)) {
        byInspector.set(inspectorId, {
          inspectorId,
          total: 0,
          completed: 0,
          inProgress: 0,
          pending: 0,
          avgDuration: null,
          durations: [],
        });
      }

      const entry = byInspector.get(inspectorId);
      entry.total += 1;

      const status = String(i.status || '').toLowerCase();
      if (status === 'completed') entry.completed += 1;
      else if (['in progress', 'in_progress'].includes(status)) entry.inProgress += 1;
      else entry.pending += 1;

      if ((i.started_at || i.created_at) && i.completed_at) {
        const start = i.started_at || i.created_at;
        const duration = (new Date(i.completed_at).getTime() - new Date(start).getTime()) / (1000 * 60);
        if (Number.isFinite(duration) && duration >= 0) entry.durations.push(duration);
      }
    });
  });

  // Calculate averages and ensure inspectors with zero inspections are present
  const performance = Array.from(byInspector.values()).map(p => ({
    ...p,
    completionRate: p.total > 0 ? Number(((p.completed / p.total) * 100).toFixed(1)) : 0,
    avgDuration: p.durations.length > 0
      ? Number((p.durations.reduce((a, b) => a + b, 0) / p.durations.length).toFixed(1))
      : null,
  }));

  // Sort: show inspectors with most completed inspections first, then by inspectorId
  return performance.sort((a, b) => {
    if (b.completed !== a.completed) return b.completed - a.completed;
    return String(a.inspectorId).localeCompare(String(b.inspectorId));
  });
}

/**
 * Calculate end-to-end time from complaint submission to mission order pre-approval
 * This is the complete workflow: complaint created → approved → MO created
 */
function calculateComplaintToMOPreapprovalTime(complaints, missionOrders) {
  const moMap = new Map();
  missionOrders.forEach((missionOrder) => {
    if (!missionOrder?.complaint_id) return;
    const existing = moMap.get(missionOrder.complaint_id);
    const existingTs = existing?.director_preapproved_at || existing?.created_at || null;
    const currentTs = missionOrder.director_preapproved_at || missionOrder.created_at || null;

    if (!existing || (currentTs && (!existingTs || new Date(currentTs).getTime() < new Date(existingTs).getTime()))) {
      moMap.set(missionOrder.complaint_id, missionOrder);
    }
  });

  const timelines = complaints
    .filter(c => c.created_at)
    .map(c => {
      const mo = moMap.get(c.id);
      const preApprovedAt = mo?.director_preapproved_at;
      if (!preApprovedAt) return null;

      const created = new Date(c.created_at).getTime();
      const moPreApproved = new Date(preApprovedAt).getTime();
      const diffHours = (moPreApproved - created) / (1000 * 60 * 60);
      return diffHours >= 0 ? diffHours : null;
    })
    .filter(t => t !== null);

  const avgTime = timelines.length > 0
    ? Number((timelines.reduce((a, b) => a + b, 0) / timelines.length).toFixed(2))
    : null;

  const withinTarget = timelines.filter(t => t <= 1).length;
  const targetCompliance = timelines.length > 0
    ? Number(((withinTarget / timelines.length) * 100).toFixed(1))
    : null;

  return {
    avgTime,
    targetCompliance,
    totalProcessed: timelines.length,
    durations: timelines.sort((a, b) => a - b),
  };
}

/**
 * Calculate processing timeline (complaint to inspection)
 */
function calculateProcessingTimeline(complaints, missionOrders) {
  const moMap = new Map(missionOrders.map(m => [m.complaint_id, m]));

  const timelines = complaints
    .filter(c => c.created_at && c.approved_at)
    .map(c => {
      const mo = moMap.get(c.id);
      const created = new Date(c.created_at).getTime();
      const approved = new Date(c.approved_at).getTime();
      const moCreated = mo?.created_at ? new Date(mo.created_at).getTime() : null;

      return {
        complaintId: c.id,
        complaintToApproval: (approved - created) / (1000 * 60 * 60), // hours
        approvalToMO: moCreated ? (moCreated - approved) / (1000 * 60 * 60) : null,
        complaintToMO: moCreated ? (moCreated - created) / (1000 * 60 * 60) : null,
      };
    });

  const avgComplaintToApproval = timelines.length > 0
    ? Number((timelines.reduce((a, b) => a + b.complaintToApproval, 0) / timelines.length).toFixed(2))
    : null;

  const withMO = timelines.filter(t => t.approvalToMO !== null);
  const avgApprovalToMO = withMO.length > 0
    ? Number((withMO.reduce((a, b) => a + b.approvalToMO, 0) / withMO.length).toFixed(2))
    : null;

  const avgComplaintToMO = withMO.length > 0
    ? Number((withMO.reduce((a, b) => a + b.complaintToMO, 0) / withMO.length).toFixed(2))
    : null;

  return {
    avgComplaintToApproval,
    avgApprovalToMO,
    avgComplaintToMO,
    targetMet: avgComplaintToMO ? avgComplaintToMO <= 3 : null, // 2-3 hours target
  };
}

/**
 * Calculate inspection timeline
 */
function calculateInspectionTimeline(inspections) {
  const normalizedInspections = dedupeInspectionsByMissionOrder(inspections);
  const completed = normalizedInspections.filter(i => i.started_at && i.completed_at);

  const durations = completed.map(i => {
    const started = new Date(i.started_at).getTime();
    const completed = new Date(i.completed_at).getTime();
    return (completed - started) / (1000 * 60); // minutes
  });

  const avgDuration = durations.length > 0
    ? Number((durations.reduce((a, b) => a + b, 0) / durations.length).toFixed(1))
    : null;

  const withinTarget = durations.filter(d => d <= 42).length;
  const targetCompliance = durations.length > 0
    ? Number(((withinTarget / durations.length) * 100).toFixed(1))
    : null;

  return {
    avgDuration,
    targetCompliance,
    totalCompleted: completed.length,
    durations: durations.sort((a, b) => a - b),
  };
}

function dedupeInspectionsByMissionOrder(inspections) {
  const byMissionOrderId = new Map();

  for (const inspection of inspections || []) {
    if (!inspection?.mission_order_id) continue;
    const existing = byMissionOrderId.get(inspection.mission_order_id);
    const preferred = pickPreferredInspectionReport([existing, inspection].filter(Boolean));
    if (preferred) {
      byMissionOrderId.set(inspection.mission_order_id, preferred);
    }
  }

  return Array.from(byMissionOrderId.values());
}

function calculateDirectorRealtimeTrend(complaints, missionOrders, inspections) {
  const today = new Date();
  const days = [];

  for (let offset = 6; offset >= 0; offset -= 1) {
    const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() - offset);
    const key = day.toISOString().slice(0, 10);
    days.push({
      key,
      label: day.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      complaints: 0,
      missionOrders: 0,
      inspections: 0,
      complaintResolutionSamples: [],
      inspectionResolutionSamples: [],
    });
  }

  const byKey = new Map(days.map((day) => [day.key, day]));

  complaints.forEach((complaint) => {
    if (!complaint?.created_at) return;
    const key = new Date(complaint.created_at).toISOString().slice(0, 10);
    const bucket = byKey.get(key);
    if (bucket) bucket.complaints += 1;
  });

  missionOrders.forEach((missionOrder) => {
    const stamp = missionOrder?.director_preapproved_at || missionOrder?.created_at;
    if (!stamp) return;
    const key = new Date(stamp).toISOString().slice(0, 10);
    const bucket = byKey.get(key);
    if (bucket) bucket.missionOrders += 1;
  });

  inspections.forEach((inspection) => {
    const stamp = inspection?.completed_at || inspection?.started_at || inspection?.created_at;
    if (!stamp) return;
    const key = new Date(stamp).toISOString().slice(0, 10);
    const bucket = byKey.get(key);
    if (bucket) bucket.inspections += 1;
  });

  const complaintMap = new Map(complaints.map((complaint) => [complaint.id, complaint]));
  const missionOrderByComplaint = new Map();
  missionOrders.forEach((missionOrder) => {
    if (!missionOrder?.complaint_id) return;
    const existing = missionOrderByComplaint.get(missionOrder.complaint_id);
    const existingTs = existing?.director_preapproved_at || null;
    const currentTs = missionOrder.director_preapproved_at || null;
    if (!currentTs) return;
    if (!existingTs || new Date(currentTs).getTime() < new Date(existingTs).getTime()) {
      missionOrderByComplaint.set(missionOrder.complaint_id, missionOrder);
    }
  });

  missionOrderByComplaint.forEach((missionOrder, complaintId) => {
    const complaint = complaintMap.get(complaintId);
    if (!complaint?.created_at || !missionOrder?.director_preapproved_at) return;

    const resolutionHours = (new Date(missionOrder.director_preapproved_at).getTime() - new Date(complaint.created_at).getTime()) / (1000 * 60 * 60);
    if (!Number.isFinite(resolutionHours) || resolutionHours < 0) return;

    const key = new Date(missionOrder.director_preapproved_at).toISOString().slice(0, 10);
    const bucket = byKey.get(key);
    if (bucket) bucket.complaintResolutionSamples.push(resolutionHours);
  });

  inspections.forEach((inspection) => {
    if (!inspection?.started_at || !inspection?.completed_at) return;
    const resolutionMinutes = (new Date(inspection.completed_at).getTime() - new Date(inspection.started_at).getTime()) / (1000 * 60);
    if (!Number.isFinite(resolutionMinutes) || resolutionMinutes < 0) return;

    const key = new Date(inspection.completed_at).toISOString().slice(0, 10);
    const bucket = byKey.get(key);
    if (bucket) bucket.inspectionResolutionSamples.push(resolutionMinutes);
  });

  return days.map((day) => ({
    key: day.key,
    label: day.label,
    complaints: day.complaints,
    missionOrders: day.missionOrders,
    inspections: day.inspections,
    avgComplaintResolutionHours: day.complaintResolutionSamples.length > 0
      ? Number((day.complaintResolutionSamples.reduce((sum, value) => sum + value, 0) / day.complaintResolutionSamples.length).toFixed(2))
      : null,
    avgInspectionResolutionMinutes: day.inspectionResolutionSamples.length > 0
      ? Number((day.inspectionResolutionSamples.reduce((sum, value) => sum + value, 0) / day.inspectionResolutionSamples.length).toFixed(1))
      : null,
  }));
}
