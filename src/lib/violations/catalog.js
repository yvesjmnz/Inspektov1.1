// Single source of truth: map subcategory labels to ordinance citations
// This is UI-agnostic and can be reused in dashboards, mission orders, etc.

// Each entry is { code_number, title }
export const ORDINANCE_BY_SUBCATEGORY = {
  // Business Permit & Licensing Issues
  'Operating Without a Valid Business Permit': [
    { code_number: 'Ord. 8331 Ch. 3 Sec. 118', title: 'Business Permit Requirement' },
  ],
  // Note: keep both spellings to be resilient to past typos in UI labels
  'Missing Commercial Space Clearance': [
    { code_number: 'Ord. 8328', title: 'Commercial Space Clearance' },
  ],
  'Missing Commerical Space Clearance': [
    { code_number: 'Ord. 8328', title: 'Commercial Space Clearance' },
  ],
  'Unregistered or Untaxed Employees': [
    { code_number: 'Ord. 8331 Ch. 2 Sec. 118', title: 'Occupational Inspection & Permits' },
    { code_number: 'Ord. 8331 Ch. 2 Sec. 98', title: 'Annual Occupation Tax' },
  ],

  // Alcohol & Tobacco Violations
  'Selling Alcohol Near Schools': [
    { code_number: 'Ord. 3532', title: 'Liquor Proximity Restriction' },
  ],
  'Selling Alcohol to Minors': [
    { code_number: 'Ord. 8520', title: 'Alcohol Sales to Minors' },
  ],
  'Selling Cigarettes to Minors': [
    { code_number: 'Ord. 7842', title: 'Tobacco Sales to Minors' },
  ],

  // Sanitation & Environmental Violations
  'Improper Waste Disposal or Segregation': [
    { code_number: 'Ord. 7876', title: 'Waste Segregation & Containers' },
  ],
  'Illegal Disposing of Cooking Oil': [
    { code_number: 'Ord. 8793', title: 'Used Cooking Oil Management' },
  ],
  'Unpaid Garbage Tax': [
    { code_number: 'Ord. 8331 Ch. 4 Sec. 114', title: 'Garbage Tax Compliance' },
  ],

  // Health, Hygiene, & Nutrition
  'Poor Food-Handler Hygiene': [
    { code_number: 'Ord. 8096', title: 'Food-Handler Protective Gear' },
  ],
  'Missing Menu Nutrition Labels': [
    { code_number: 'Ord. 8446', title: 'Menu Nutrition Labeling' },
  ],

  // Public Security Compliance
  'CCTV System Non-Compliance': [
    { code_number: 'Ord. 8392', title: 'CCTV Enrollment Program' },
  ],
};

export function getOrdinancesForSubcategory(label) {
  if (!label) return [];
  // Try direct match first
  const direct = ORDINANCE_BY_SUBCATEGORY[label];
  if (direct) return direct;

  // Fallback: normalize spacing/case to be defensive
  const norm = String(label).trim().toLowerCase().replace(/\s+/g, ' ');
  const entry = Object.entries(ORDINANCE_BY_SUBCATEGORY).find(
    ([k]) => k.trim().toLowerCase().replace(/\s+/g, ' ') === norm
  );
  return entry ? entry[1] : [];
}

export function listAllMappedSubcategories() {
  return Object.keys(ORDINANCE_BY_SUBCATEGORY);
}
