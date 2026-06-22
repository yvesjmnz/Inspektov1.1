export const COMPLAINT_GROUP_WINDOW_DAYS = 7;
export const COMPLAINT_GROUP_WINDOW_MS = COMPLAINT_GROUP_WINDOW_DAYS * 24 * 60 * 60 * 1000;

export function normalizeComplaintGroupValue(value) {
  return String(value || '').toLowerCase().trim().replace(/\s+/g, ' ');
}

export function getComplaintBusinessGroupKey(complaint) {
  if (complaint?.business_pk !== null && complaint?.business_pk !== undefined) {
    return `pk:${complaint.business_pk}`;
  }
  return `text:${normalizeComplaintGroupValue(complaint?.business_name)}|${normalizeComplaintGroupValue(complaint?.business_address)}`;
}

export function getComplaintCreatedTime(complaint) {
  const time = complaint?.created_at ? new Date(complaint.created_at).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}

export function getSameEstablishmentComplaintGroup(anchorComplaint, rows, options = {}) {
  if (!anchorComplaint) {
    return {
      complaints: [],
      uniqueReporterEmails: [],
      uniqueReporterCount: 0,
      eligibleForInspectionGroup: false,
    };
  }

  const windowMs = options.windowMs || COMPLAINT_GROUP_WINDOW_MS;
  const includeFuture = options.includeFuture === true;
  const anchorTime = getComplaintCreatedTime(anchorComplaint) || Date.now();
  const businessKey = getComplaintBusinessGroupKey(anchorComplaint);

  const complaints = (Array.isArray(rows) ? rows : [])
    .filter((row) => {
      const time = getComplaintCreatedTime(row);
      const isWithinWindow = includeFuture
        ? Math.abs(time - anchorTime) <= windowMs
        : time <= anchorTime && time > anchorTime - windowMs;
      return (
        getComplaintBusinessGroupKey(row) === businessKey &&
        isWithinWindow
      );
    })
    .sort((a, b) => getComplaintCreatedTime(b) - getComplaintCreatedTime(a));

  const reporterMap = new Map();
  complaints.forEach((row) => {
    const normalizedEmail = normalizeComplaintGroupValue(row?.reporter_email);
    if (!normalizedEmail) return;
    if (!reporterMap.has(normalizedEmail)) {
      reporterMap.set(normalizedEmail, row?.reporter_email || normalizedEmail);
    }
  });

  const uniqueReporterEmails = Array.from(reporterMap.values());

  return {
    complaints,
    uniqueReporterEmails,
    uniqueReporterCount: uniqueReporterEmails.length,
    eligibleForInspectionGroup: uniqueReporterEmails.length >= 3,
  };
}

export function getComplaintGroupIds(anchorComplaint, rows, options = {}) {
  return getSameEstablishmentComplaintGroup(anchorComplaint, rows, options)
    .complaints
    .map((row) => row?.id)
    .filter(Boolean);
}

export function isMissingMissionOrderComplaintsTable(error) {
  const message = String(error?.message || error?.details || '').toLowerCase();
  return (
    error?.code === 'PGRST205' ||
    error?.code === '42P01' ||
    (message.includes('mission_order_complaints') && message.includes('schema cache')) ||
    (message.includes('mission_order_complaints') && message.includes('does not exist'))
  );
}
