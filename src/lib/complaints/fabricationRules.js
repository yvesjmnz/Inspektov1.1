/**
 * Fabrication-Related Authenticity Rules
 * Calls Supabase stored procedures
 * 
 * These rules check:
 * 1. Establishment history alignment
 * 2. Reporter credibility
 * 3. Reporter under review
 * 4. Post-clearance complaints
 */

import { supabase } from '../supabase';

/**
 * Check if complaint aligns with establishment history
 * @param {string} businessName - Business name
 * @param {string} complaintType - Type of violation
 * @returns {Promise<object>} { tag, has_history, violation_count, reason }
 */
export async function checkEstablishmentHistory(businessName, complaintType) {
  try {
    const { data, error } = await supabase.rpc('check_establishment_history', {
      p_business_name: businessName,
      p_complaint_type: complaintType,
    });

    if (error) throw error;

    return data || { tag: null, has_history: false, violation_count: 0 };
  } catch (error) {
    console.error('Error checking establishment history:', error);
    return { tag: null, has_history: false, violation_count: 0, reason: 'Error checking' };
  }
}

/**
 * Check if reporter has credible history
 * @param {string} reporterEmail - Email address
 * @returns {Promise<object>} { tag, is_credible, founded_count, reason }
 */
export async function checkReporterCredibility(reporterEmail) {
  try {
    const { data, error } = await supabase.rpc('check_reporter_credibility', {
      p_reporter_email: reporterEmail,
    });

    if (error) throw error;

    return data || { tag: null, is_credible: false, founded_count: 0 };
  } catch (error) {
    console.error('Error checking reporter credibility:', error);
    return { tag: null, is_credible: false, founded_count: 0, reason: 'Error checking' };
  }
}

/**
 * Check if reporter is under review (unfounded complaint history)
 * @param {string} reporterEmail - Email address
 * @returns {Promise<object>} { tag, is_under_review, unfounded_count, threshold, reason }
 */
export async function checkReporterUnderReview(reporterEmail) {
  try {
    const { data, error } = await supabase.rpc('check_reporter_under_review', {
      p_reporter_email: reporterEmail,
    });

    if (error) throw error;

    return data || { tag: null, is_under_review: false, unfounded_count: 0 };
  } catch (error) {
    console.error('Error checking reporter under review:', error);
    return { tag: null, is_under_review: false, unfounded_count: 0, reason: 'Error checking' };
  }
}

/**
 * Check for post-clearance complaints
 * @param {string} reporterEmail - Email address
 * @param {string} businessName - Business name
 * @param {string} complaintType - Type of violation
 * @returns {Promise<object>} { tag, is_post_clearance, is_pattern, recent_clearance_count, pattern_count, reason }
 */
export async function checkPostClearanceComplaint(reporterEmail, businessName, complaintType) {
  try {
    const { data, error } = await supabase.rpc('check_post_clearance_complaint', {
      p_reporter_email: reporterEmail,
      p_business_name: businessName,
      p_complaint_type: complaintType,
    });

    if (error) throw error;

    return data || { tag: null, is_post_clearance: false, is_pattern: false };
  } catch (error) {
    console.error('Error checking post-clearance complaint:', error);
    return { tag: null, is_post_clearance: false, is_pattern: false, reason: 'Error checking' };
  }
}

/**
 * Calculate all fabrication-related tags
 * @param {string} reporterEmail - Email address
 * @param {string} businessName - Business name
 * @param {string} complaintType - Type of violation
 * @returns {Promise<object>} { tags, tag_count, analysis }
 */
export async function calculateFabricationTags(reporterEmail, businessName, complaintType) {
  try {
    const { data, error } = await supabase.rpc('calculate_fabrication_tags', {
      p_reporter_email: reporterEmail,
      p_business_name: businessName,
      p_complaint_type: complaintType,
    });

    if (error) throw error;

    return data || { tags: [], tag_count: 0, analysis: {} };
  } catch (error) {
    console.error('Error calculating fabrication tags:', error);
    return { tags: [], tag_count: 0, analysis: {}, reason: 'Error calculating' };
  }
}

/**
 * Get just the tags array
 * @param {string} reporterEmail - Email address
 * @param {string} businessName - Business name
 * @param {string} complaintType - Type of violation
 * @returns {Promise<string[]>} Array of tags
 */
export async function getFabricationTags(reporterEmail, businessName, complaintType) {
  try {
    const { data, error } = await supabase.rpc('get_fabrication_tags', {
      p_reporter_email: reporterEmail,
      p_business_name: businessName,
      p_complaint_type: complaintType,
    });

    if (error) throw error;

    return data || [];
  } catch (error) {
    console.error('Error getting fabrication tags:', error);
    return [];
  }
}
