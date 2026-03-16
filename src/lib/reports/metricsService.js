import { supabase } from '../supabase';

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
      .select('id, complaint_id, status, created_at, submitted_at, date_of_inspection');

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

    const metrics = {
      missionOrders: calculateMissionOrderMetrics(missionOrders || [], complaints || []),
      inspections: calculateInspectionMetrics(inspections || []),
      assignments: calculateAssignmentMetrics(assignments || []),
      performance: calculateInspectorPerformance(inspections || [], assignments || []),
      timeline: calculateInspectionTimeline(inspections || []),
      complaintToMOPreapproval: calculateComplaintToMOPreapprovalTime(complaints || [], missionOrders || []),
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
  const total = complaints.length;
  const approved = complaints.filter(c => String(c.status || '').toLowerCase() === 'approved').length;
  const declined = complaints.filter(c => String(c.status || '').toLowerCase() === 'declined').length;
  const pending = complaints.filter(c => ['submitted', 'pending', 'new'].includes(String(c.status || '').toLowerCase())).length;

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
  const total = inspections.length;
  const byStatus = {
    pending: inspections.filter(i => ['pending inspection', 'pending_inspection', 'pending'].includes(String(i.status || '').toLowerCase())).length,
    inProgress: inspections.filter(i => ['in progress', 'in_progress'].includes(String(i.status || '').toLowerCase())).length,
    completed: inspections.filter(i => String(i.status || '').toLowerCase() === 'completed').length,
  };

  // Inspection duration (minutes) - from started_at to completed_at
  const durations = inspections
    .filter(i => i.started_at && i.completed_at)
    .map(i => {
      const started = new Date(i.started_at).getTime();
      const completed = new Date(i.completed_at).getTime();
      return (completed - started) / (1000 * 60); // minutes
    });

  const avgDuration = durations.length > 0
    ? Number((durations.reduce((a, b) => a + b, 0) / durations.length).toFixed(1))
    : null;

  // Compliance with 5-10 min target
  const withinTarget = durations.filter(d => d >= 5 && d <= 10).length;
  const targetCompliance = durations.length > 0
    ? Number(((withinTarget / durations.length) * 100).toFixed(1))
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
  const assignmentMap = new Map();
  assignments.forEach(a => {
    if (!assignmentMap.has(a.mission_order_id)) {
      assignmentMap.set(a.mission_order_id, []);
    }
    assignmentMap.get(a.mission_order_id).push(a.inspector_id);
  });

  const byInspector = new Map();

  inspections.forEach(i => {
    const inspectorIds = assignmentMap.get(i.mission_order_id) || [];
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

      if (i.started_at && i.completed_at) {
        const duration = (new Date(i.completed_at).getTime() - new Date(i.started_at).getTime()) / (1000 * 60);
        entry.durations.push(duration);
      }
    });
  });

  // Calculate averages
  const performance = Array.from(byInspector.values()).map(p => ({
    ...p,
    completionRate: p.total > 0 ? Number(((p.completed / p.total) * 100).toFixed(1)) : 0,
    avgDuration: p.durations.length > 0
      ? Number((p.durations.reduce((a, b) => a + b, 0) / p.durations.length).toFixed(1))
      : null,
  }));

  return performance.sort((a, b) => b.completed - a.completed);
}

/**
 * Calculate end-to-end time from complaint submission to mission order pre-approval
 * This is the complete workflow: complaint created → approved → MO created
 */
function calculateComplaintToMOPreapprovalTime(complaints, missionOrders) {
  const moMap = new Map(missionOrders.map(m => [m.complaint_id, m]));

  const timelines = complaints
    .filter(c => c.created_at && c.approved_at)
    .map(c => {
      const mo = moMap.get(c.id);
      if (!mo?.created_at) return null; // Only include if MO exists

      const created = new Date(c.created_at).getTime();
      const moCreated = new Date(mo.created_at).getTime();
      return (moCreated - created) / (1000 * 60 * 60); // hours
    })
    .filter(t => t !== null);

  const avgTime = timelines.length > 0
    ? Number((timelines.reduce((a, b) => a + b, 0) / timelines.length).toFixed(2))
    : null;

  const withinTarget = timelines.filter(t => t <= 3).length; // 2-3 hour target
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
  const completed = inspections.filter(i => i.started_at && i.completed_at);

  const durations = completed.map(i => {
    const started = new Date(i.started_at).getTime();
    const completed = new Date(i.completed_at).getTime();
    return (completed - started) / (1000 * 60); // minutes
  });

  const avgDuration = durations.length > 0
    ? Number((durations.reduce((a, b) => a + b, 0) / durations.length).toFixed(1))
    : null;

  const withinTarget = durations.filter(d => d >= 5 && d <= 10).length;
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
