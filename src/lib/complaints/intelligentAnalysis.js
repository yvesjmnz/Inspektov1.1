/**
 * Intelligent Complaint Analysis - Rule-Based System
 * 
 * No external APIs, no ML libraries needed.
 * Uses pattern matching and heuristics for analysis.
 * 
 * This is simpler, faster, and more explainable than ML.
 */

// ============ KEYWORD DICTIONARIES ============

const SEVERITY_KEYWORDS = {
  critical: ['injury', 'death', 'poison', 'contamination', 'fire', 'hazard', 'emergency', 'critical'],
  high: ['sick', 'illness', 'disease', 'unsafe', 'dangerous', 'violation', 'illegal', 'serious'],
  medium: ['complaint', 'issue', 'problem', 'concern', 'defect', 'broken', 'damaged'],
  low: ['minor', 'small', 'slight', 'tiny', 'little', 'minor issue'],
};

const CREDIBILITY_KEYWORDS = {
  positive: ['witnessed', 'saw', 'observed', 'documented', 'evidence', 'photo', 'video', 'proof', 'clear', 'obvious'],
  negative: ['heard', 'rumor', 'allegedly', 'supposedly', 'maybe', 'possibly', 'think', 'believe', 'probably'],
};

const BUSINESS_VIOLATION_KEYWORDS = {
  health: ['food', 'hygiene', 'sanitation', 'clean', 'pest', 'rodent', 'cockroach', 'mold', 'bacteria'],
  safety: ['fire', 'exit', 'emergency', 'hazard', 'unsafe', 'broken', 'electrical', 'structural'],
  labor: ['worker', 'employee', 'wage', 'hour', 'child', 'minor', 'exploitation'],
  environmental: ['waste', 'pollution', 'noise', 'smoke', 'chemical', 'spill'],
};

// ============ ANALYSIS FUNCTIONS ============

/**
 * Analyze text for severity level
 */
function analyzeSeverity(text) {
  if (!text) return { level: 'low', score: 20 };

  const lower = text.toLowerCase();
  let score = 0;

  // Check critical keywords
  if (SEVERITY_KEYWORDS.critical.some(kw => lower.includes(kw))) {
    return { level: 'critical', score: 100 };
  }

  // Check high keywords
  const highCount = SEVERITY_KEYWORDS.high.filter(kw => lower.includes(kw)).length;
  if (highCount >= 2) {
    return { level: 'high', score: 75 };
  }
  if (highCount >= 1) {
    score += 50;
  }

  // Check medium keywords
  const mediumCount = SEVERITY_KEYWORDS.medium.filter(kw => lower.includes(kw)).length;
  if (mediumCount >= 2) {
    score += 30;
  }

  // Check low keywords
  const lowCount = SEVERITY_KEYWORDS.low.filter(kw => lower.includes(kw)).length;
  if (lowCount >= 1) {
    score += 10;
  }

  if (score >= 75) return { level: 'high', score };
  if (score >= 40) return { level: 'medium', score };
  return { level: 'low', score };
}

/**
 * Analyze text for credibility indicators
 */
function analyzeCredibility(text) {
  if (!text) return { score: 0, indicators: [] };

  const lower = text.toLowerCase();
  let score = 0;
  const indicators = [];

  // Positive credibility indicators
  const positiveCount = CREDIBILITY_KEYWORDS.positive.filter(kw => lower.includes(kw)).length;
  if (positiveCount > 0) {
    score += positiveCount * 15;
    indicators.push(`${positiveCount} credibility indicators found`);
  }

  // Negative credibility indicators
  const negativeCount = CREDIBILITY_KEYWORDS.negative.filter(kw => lower.includes(kw)).length;
  if (negativeCount > 0) {
    score -= negativeCount * 10;
    indicators.push(`${negativeCount} uncertainty indicators found`);
  }

  // Text length (longer = more detailed = more credible)
  if (text.length > 200) {
    score += 15;
    indicators.push('Detailed description provided');
  } else if (text.length < 50) {
    score -= 10;
    indicators.push('Very brief description');
  }

  return { score: Math.max(0, Math.min(100, score)), indicators };
}

/**
 * Identify violation categories
 */
function identifyViolationCategories(text) {
  if (!text) return [];

  const lower = text.toLowerCase();
  const categories = [];

  if (Object.values(BUSINESS_VIOLATION_KEYWORDS.health).some(kw => lower.includes(kw))) {
    categories.push('Health & Sanitation');
  }
  if (Object.values(BUSINESS_VIOLATION_KEYWORDS.safety).some(kw => lower.includes(kw))) {
    categories.push('Safety');
  }
  if (Object.values(BUSINESS_VIOLATION_KEYWORDS.labor).some(kw => lower.includes(kw))) {
    categories.push('Labor Rights');
  }
  if (Object.values(BUSINESS_VIOLATION_KEYWORDS.environmental).some(kw => lower.includes(kw))) {
    categories.push('Environmental');
  }

  return categories.length > 0 ? categories : ['General Complaint'];
}

/**
 * Main analysis function - returns risk assessment
 */
export function analyzeComplaintIntelligently(complaint) {
  if (!complaint) {
    return {
      success: false,
      error: 'No complaint data',
    };
  }

  try {
    const description = complaint.complaint_description || '';
    const businessName = complaint.business_name || '';

    // Analyze severity
    const severity = analyzeSeverity(description);

    // Analyze credibility
    const credibility = analyzeCredibility(description);

    // Identify violation categories
    const categories = identifyViolationCategories(description);

    // Calculate risk level
    const riskScore = (severity.score * 0.5) + (credibility.score * 0.5);
    let riskLevel = 'Low';
    if (riskScore >= 70) riskLevel = 'High';
    else if (riskScore >= 40) riskLevel = 'Medium';

    // Generate key concerns
    const concerns = [];
    if (severity.level === 'critical' || severity.level === 'high') {
      concerns.push(`Severe violation reported: ${severity.level} severity`);
    }
    if (credibility.score < 30) {
      concerns.push('Limited credibility indicators in description');
    }
    if (categories.length > 0) {
      concerns.push(`Violation category: ${categories.join(', ')}`);
    }

    // Determine recommended action
    let recommendedAction = 'Review';
    if (riskScore >= 70 && credibility.score >= 50) {
      recommendedAction = 'Approve';
    } else if (riskScore < 30 || credibility.score < 20) {
      recommendedAction = 'Decline';
    }

    // Generate reasoning
    const reasoning = `Based on severity analysis (${severity.level}) and credibility indicators (${credibility.score}/100), this complaint appears to be ${riskLevel.toLowerCase()} risk.`;

    return {
      success: true,
      data: {
        riskLevel,
        keyConcerns: concerns.length > 0 ? concerns : ['Standard complaint review needed'],
        recommendedAction,
        reasoning,
        metadata: {
          severity: severity.level,
          credibilityScore: credibility.score,
          categories,
          analysisMethod: 'Rule-Based Pattern Matching',
        },
      },
    };
  } catch (error) {
    console.error('Analysis error:', error);
    return {
      success: false,
      error: error.message || 'Analysis failed',
    };
  }
}

/**
 * Check if intelligent analysis is available
 * (Always true - no external dependencies)
 */
export function isIntelligentAnalysisAvailable() {
  return true;
}
