export function normalizeInspectionReportStatus(report) {
  const s = String(report?.status || '').toLowerCase().trim();
  if (s === 'completed' || s === 'complete') return 'completed';
  if ((s === 'in progress' || s === 'in_progress') && report?.started_at) return 'in progress';
  return 'pending inspection';
}

export function pickPreferredInspectionReport(reports) {
  let best = null;

  const priorityFor = (report) => {
    const status = normalizeInspectionReportStatus(report);
    if (status === 'completed') return 3;
    if (status === 'in progress') return 2;
    if (status === 'pending inspection') return 1;
    return 0;
  };

  const timeFor = (report) =>
    new Date(report?.completed_at || report?.updated_at || report?.created_at || 0).getTime();

  for (const report of reports || []) {
    if (!report?.id) continue;
    if (!best) {
      best = report;
      continue;
    }

    const currentPriority = priorityFor(report);
    const bestPriority = priorityFor(best);

    if (currentPriority > bestPriority) {
      best = report;
      continue;
    }

    if (currentPriority < bestPriority) {
      continue;
    }

    if (timeFor(report) > timeFor(best)) {
      best = report;
    }
  }

  return best;
}
