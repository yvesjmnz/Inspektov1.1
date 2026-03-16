/**
 * Decision Support Utilities for Complaint Review
 * Provides metrics and recommendations to help directors make approval decisions
 */

/**
 * Interpret authenticity level into human-readable assessment
 */
export function getAuthenticityAssessment(level) {
  const u = Number(level);
  
  if (u >= 80) {
    return {
      label: 'Very High Credibility',
      color: '#22c55e',
      bgColor: '#dcfce7',
      borderColor: '#22c55e',
      icon: '✓',
      description: 'Strong evidence of violation',
    };
  }
  if (u >= 60) {
    return {
      label: 'High Credibility',
      color: '#10b981',
      bgColor: '#d1fae5',
      borderColor: '#10b981',
      icon: '✓',
      description: 'Likely violation',
    };
  }
  if (u >= 40) {
    return {
      label: 'Moderate Credibility',
      color: '#f59e0b',
      bgColor: '#fef3c7',
      borderColor: '#f59e0b',
      icon: '?',
      description: 'Requires further review',
    };
  }
  if (u >= 20) {
    return {
      label: 'Low Credibility',
      color: '#ef4444',
      bgColor: '#fee2e2',
      borderColor: '#ef4444',
      icon: '!',
      description: 'Questionable evidence',
    };
  }
  
  return {
    label: 'Very Low Credibility',
    color: '#dc2626',
    bgColor: '#fecaca',
    borderColor: '#dc2626',
    icon: '✕',
    description: 'Insufficient evidence',
  };
}

/**
 * Get location verification status
 */
export function getLocationVerificationStatus(tags) {
  if (!Array.isArray(tags)) return null;
  
  const tagsLower = tags.map(t => String(t || '').toLowerCase());
  
  if (tagsLower.includes('location verified')) {
    return {
      status: 'verified',
      label: 'Location Verified',
      color: '#22c55e',
      bgColor: '#dcfce7',
      borderColor: '#22c55e',
      icon: '✓',
      description: 'Reporter was on-site',
    };
  }
  
  if (tagsLower.includes('failed location verification')) {
    return {
      status: 'failed',
      label: 'Location Not Verified',
      color: '#ef4444',
      bgColor: '#fee2e2',
      borderColor: '#ef4444',
      icon: '!',
      description: 'Reporter was far from business',
    };
  }
  
  if (tagsLower.includes('verification unavailable')) {
    return {
      status: 'unavailable',
      label: 'Verification Unavailable',
      color: '#94a3b8',
      bgColor: '#f1f5f9',
      borderColor: '#cbd5e1',
      icon: '—',
      description: 'Could not verify location',
    };
  }
  
  return null;
}

/**
 * Assess evidence quality based on image count
 */
export function getEvidenceQuality(imageUrls) {
  const count = Array.isArray(imageUrls) ? imageUrls.length : 0;
  
  if (count === 0) {
    return {
      label: 'No Evidence',
      color: '#ef4444',
      bgColor: '#fee2e2',
      borderColor: '#ef4444',
      icon: '✕',
      description: 'No photos provided',
      count: 0,
    };
  }
  
  if (count === 1) {
    return {
      label: 'Minimal Evidence',
      color: '#f59e0b',
      bgColor: '#fef3c7',
      borderColor: '#f59e0b',
      icon: '!',
      description: 'Single photo provided',
      count: 1,
    };
  }
  
  if (count >= 2 && count <= 3) {
    return {
      label: 'Adequate Evidence',
      color: '#10b981',
      bgColor: '#d1fae5',
      borderColor: '#10b981',
      icon: '✓',
      description: `${count} photos provided`,
      count,
    };
  }
  
  return {
    label: 'Comprehensive Evidence',
    color: '#22c55e',
    bgColor: '#dcfce7',
    borderColor: '#22c55e',
    icon: '✓✓',
    description: `${count} photos provided`,
    count,
  };
}

/**
 * Calculate suggested action based on multiple factors
 * Returns: { action: 'approve' | 'decline' | 'review', confidence: 0-100, reasons: [] }
 */
export function getSuggestedAction(complaint) {
  if (!complaint) {
    return {
      action: 'review',
      confidence: 0,
      reasons: ['No complaint data'],
    };
  }

  const reasons = [];
  let approveScore = 0;
  let declineScore = 0;

  // Factor 1: Authenticity Level (0-100)
  const authenticity = Number(complaint.authenticity_level || 0);
  if (authenticity >= 70) {
    approveScore += 40;
    reasons.push('High authenticity score');
  } else if (authenticity >= 50) {
    approveScore += 20;
    reasons.push('Moderate authenticity score');
  } else if (authenticity >= 30) {
    declineScore += 20;
    reasons.push('Low authenticity score');
  } else {
    declineScore += 40;
    reasons.push('Very low authenticity score');
  }

  // Factor 2: Location Verification
  const locationStatus = getLocationVerificationStatus(complaint.tags);
  if (locationStatus?.status === 'verified') {
    approveScore += 30;
    reasons.push('Reporter verified on-site');
  } else if (locationStatus?.status === 'failed') {
    declineScore += 25;
    reasons.push('Reporter not on-site');
  }

  // Factor 3: Evidence Quality
  const evidenceQuality = getEvidenceQuality(complaint.image_urls);
  if (evidenceQuality.count >= 3) {
    approveScore += 20;
    reasons.push('Comprehensive evidence provided');
  } else if (evidenceQuality.count === 0) {
    declineScore += 30;
    reasons.push('No evidence provided');
  }

  // Factor 4: Description Length (proxy for detail)
  const descLength = String(complaint.complaint_description || '').length;
  if (descLength >= 100) {
    approveScore += 10;
    reasons.push('Detailed description');
  } else if (descLength < 30) {
    declineScore += 15;
    reasons.push('Insufficient description');
  }

  // Determine action
  let action = 'review';
  let confidence = 0;

  if (approveScore > declineScore + 20) {
    action = 'approve';
    confidence = Math.min(100, approveScore);
  } else if (declineScore > approveScore + 20) {
    action = 'decline';
    confidence = Math.min(100, declineScore);
  } else {
    action = 'review';
    confidence = Math.max(approveScore, declineScore);
  }

  return {
    action,
    confidence,
    reasons,
    scores: { approve: approveScore, decline: declineScore },
  };
}

/**
 * Format confidence as percentage
 */
export function formatConfidence(confidence) {
  return `${Math.round(confidence)}%`;
}

/**
 * Get action badge styling
 */
export function getActionBadgeStyle(action) {
  switch (action) {
    case 'approve':
      return {
        background: '#dcfce7',
        border: '1px solid #22c55e',
        color: '#166534',
        icon: '✓',
      };
    case 'decline':
      return {
        background: '#fee2e2',
        border: '1px solid #ef4444',
        color: '#991b1b',
        icon: '✕',
      };
    default:
      return {
        background: '#fef3c7',
        border: '1px solid #f59e0b',
        color: '#854d0e',
        icon: '?',
      };
  }
}

/**
 * Common decline reason templates
 */
export const DECLINE_TEMPLATES = [
  {
    id: 'insufficient-evidence',
    label: 'Insufficient Evidence',
    text: 'Complaint lacks sufficient evidence or documentation to warrant investigation.',
  },
  {
    id: 'outside-jurisdiction',
    label: 'Outside Jurisdiction',
    text: 'The reported violation falls outside the jurisdiction of this office.',
  },
  {
    id: 'duplicate-complaint',
    label: 'Duplicate Complaint',
    text: 'A similar complaint for this establishment has already been filed and is under investigation.',
  },
  {
    id: 'unverifiable-claim',
    label: 'Unverifiable Claim',
    text: 'The complaint contains claims that cannot be verified or substantiated.',
  },
  {
    id: 'reporter-location',
    label: 'Reporter Not On-Site',
    text: 'Reporter was not at the location during the alleged violation, affecting credibility.',
  },
  {
    id: 'incomplete-information',
    label: 'Incomplete Information',
    text: 'Complaint is missing critical information needed for investigation.',
  },
];

/**
 * Format date for display
 */
export function formatComplaintDate(isoDate) {
  if (!isoDate) return '—';
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Calculate days ago
 */
export function daysAgo(isoDate) {
  if (!isoDate) return null;
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}
