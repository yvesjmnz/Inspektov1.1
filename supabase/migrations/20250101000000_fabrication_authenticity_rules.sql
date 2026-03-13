-- ============================================================================
-- FABRICATION-RELATED AUTHENTICITY RULES
-- Supabase Stored Procedures
-- ============================================================================

-- ============================================================================
-- RULE 1: Establishment History Alignment
-- Checks if complaint aligns with establishment's violation history
-- ============================================================================

CREATE OR REPLACE FUNCTION check_establishment_history(
  p_business_name TEXT,
  p_complaint_type TEXT
)
RETURNS JSON AS $$
DECLARE
  v_violation_count INTEGER;
  v_result JSON;
BEGIN
  -- Check for violations of the same type in last 3 months
  SELECT COUNT(*)
  INTO v_violation_count
  FROM inspection_slips
  WHERE business_name = p_business_name
    AND created_at >= NOW() - INTERVAL '3 months'
    AND violations ILIKE '%' || p_complaint_type || '%';

  -- Return result
  v_result := json_build_object(
    'tag', CASE WHEN v_violation_count >= 1 THEN 'Consistent With History' ELSE NULL END,
    'has_history', v_violation_count >= 1,
    'violation_count', v_violation_count,
    'reason', CASE 
      WHEN v_violation_count >= 1 THEN 'Found ' || v_violation_count || ' similar violations in last 3 months'
      ELSE 'No similar violations in establishment history'
    END
  );

  RETURN v_result;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================================
-- RULE 2: Reporter Credibility Based on Founded Complaints
-- Checks if reporter has history of founded complaints
-- ============================================================================

CREATE OR REPLACE FUNCTION check_reporter_credibility(
  p_reporter_email TEXT
)
RETURNS JSON AS $$
DECLARE
  v_founded_count INTEGER;
  v_result JSON;
BEGIN
  -- Count approved complaints from this reporter in last 3 months
  -- (approved = founded/valid complaint)
  SELECT COUNT(*)
  INTO v_founded_count
  FROM complaints
  WHERE reporter_email = p_reporter_email
    AND status = 'approved'
    AND created_at >= NOW() - INTERVAL '3 months';

  -- Return result
  v_result := json_build_object(
    'tag', CASE WHEN v_founded_count >= 1 THEN 'Credible Reporter' ELSE NULL END,
    'is_credible', v_founded_count >= 1,
    'founded_count', v_founded_count,
    'reason', CASE 
      WHEN v_founded_count >= 1 THEN 'Reporter has ' || v_founded_count || ' founded complaints in last 3 months'
      ELSE 'Reporter has no founded complaints in history'
    END
  );

  RETURN v_result;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================================
-- RULE 3: Reporter Under Review (Unfounded Complaint History)
-- Checks if reporter has pattern of unfounded complaints
-- ============================================================================

CREATE OR REPLACE FUNCTION check_reporter_under_review(
  p_reporter_email TEXT
)
RETURNS JSON AS $$
DECLARE
  v_unfounded_count INTEGER;
  v_is_under_review BOOLEAN;
  v_result JSON;
  v_threshold INTEGER := 3;
BEGIN
  -- Count declined complaints from this reporter in last 3 months
  -- (declined = unfounded/invalid complaint)
  SELECT COUNT(*)
  INTO v_unfounded_count
  FROM complaints
  WHERE reporter_email = p_reporter_email
    AND status = 'declined'
    AND created_at >= NOW() - INTERVAL '3 months';

  -- Reporter is under review if 3+ unfounded complaints
  v_is_under_review := v_unfounded_count >= v_threshold;

  -- Return result
  v_result := json_build_object(
    'tag', CASE WHEN v_is_under_review THEN 'Reporter Under Review' ELSE NULL END,
    'is_under_review', v_is_under_review,
    'unfounded_count', v_unfounded_count,
    'threshold', v_threshold,
    'reason', CASE 
      WHEN v_is_under_review THEN 'Reporter has ' || v_unfounded_count || ' unfounded complaints (threshold: ' || v_threshold || ')'
      ELSE 'Reporter has ' || v_unfounded_count || ' unfounded complaints (threshold: ' || v_threshold || ')'
    END
  );

  RETURN v_result;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================================
-- RULE 4: Post-Clearance Complaints
-- Checks if reporter files same complaint after establishment was cleared
-- ============================================================================

CREATE OR REPLACE FUNCTION check_post_clearance_complaint(
  p_reporter_email TEXT,
  p_business_name TEXT,
  p_complaint_type TEXT
)
RETURNS JSON AS $$
DECLARE
  v_recent_clearance_count INTEGER;
  v_post_clearance_pattern_count INTEGER;
  v_is_post_clearance BOOLEAN;
  v_is_pattern BOOLEAN;
  v_pattern_threshold INTEGER := 3;
  v_result JSON;
BEGIN
  -- Check for "No violation" inspections in last 30 days
  SELECT COUNT(*)
  INTO v_recent_clearance_count
  FROM inspection_slips
  WHERE business_name = p_business_name
    AND status = 'no_violation'
    AND created_at >= NOW() - INTERVAL '30 days';

  v_is_post_clearance := v_recent_clearance_count >= 1;

  -- Check for pattern: same reporter filing same complaint type
  -- for same business after clearance (3+ times in 60 days)
  SELECT COUNT(*)
  INTO v_post_clearance_pattern_count
  FROM complaints
  WHERE reporter_email = p_reporter_email
    AND business_name = p_business_name
    AND complaint_description ILIKE '%' || p_complaint_type || '%'
    AND created_at >= NOW() - INTERVAL '60 days';

  v_is_pattern := v_post_clearance_pattern_count >= v_pattern_threshold;

  -- Return result
  v_result := json_build_object(
    'tag', CASE WHEN v_is_pattern THEN 'Post-Clearance Complaint' ELSE NULL END,
    'is_post_clearance', v_is_post_clearance,
    'is_pattern', v_is_pattern,
    'recent_clearance_count', v_recent_clearance_count,
    'pattern_count', v_post_clearance_pattern_count,
    'pattern_threshold', v_pattern_threshold,
    'reason', CASE 
      WHEN v_is_pattern THEN 'Reporter filed ' || v_post_clearance_pattern_count || ' similar complaints after clearance (threshold: ' || v_pattern_threshold || ')'
      WHEN v_is_post_clearance THEN 'Recent clearance on file (30 days)'
      ELSE 'No recent clearance'
    END
  );

  RETURN v_result;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================================
-- MAIN PROCEDURE: Calculate All Fabrication-Related Tags
-- Combines all 4 rules into single result
-- ============================================================================

CREATE OR REPLACE FUNCTION calculate_fabrication_tags(
  p_reporter_email TEXT,
  p_business_name TEXT,
  p_complaint_type TEXT
)
RETURNS JSON AS $$
DECLARE
  v_history_result JSON;
  v_credibility_result JSON;
  v_under_review_result JSON;
  v_post_clearance_result JSON;
  v_tags TEXT[] := ARRAY[]::TEXT[];
  v_analysis JSON;
  v_result JSON;
BEGIN
  -- Execute all 4 rules
  v_history_result := check_establishment_history(p_business_name, p_complaint_type);
  v_credibility_result := check_reporter_credibility(p_reporter_email);
  v_under_review_result := check_reporter_under_review(p_reporter_email);
  v_post_clearance_result := check_post_clearance_complaint(p_reporter_email, p_business_name, p_complaint_type);

  -- Collect tags
  IF v_history_result->>'tag' IS NOT NULL THEN
    v_tags := array_append(v_tags, v_history_result->>'tag');
  END IF;

  IF v_credibility_result->>'tag' IS NOT NULL THEN
    v_tags := array_append(v_tags, v_credibility_result->>'tag');
  END IF;

  IF v_under_review_result->>'tag' IS NOT NULL THEN
    v_tags := array_append(v_tags, v_under_review_result->>'tag');
  END IF;

  IF v_post_clearance_result->>'tag' IS NOT NULL THEN
    v_tags := array_append(v_tags, v_post_clearance_result->>'tag');
  END IF;

  -- Build analysis object
  v_analysis := json_build_object(
    'establishment_history', v_history_result,
    'reporter_credibility', v_credibility_result,
    'reporter_under_review', v_under_review_result,
    'post_clearance', v_post_clearance_result
  );

  -- Build final result
  v_result := json_build_object(
    'tags', v_tags,
    'tag_count', array_length(v_tags, 1),
    'analysis', v_analysis
  );

  RETURN v_result;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================================
-- HELPER: Get All Fabrication Tags as Array
-- Simpler interface if you just need the tags
-- ============================================================================

CREATE OR REPLACE FUNCTION get_fabrication_tags(
  p_reporter_email TEXT,
  p_business_name TEXT,
  p_complaint_type TEXT
)
RETURNS TEXT[] AS $$
DECLARE
  v_result JSON;
BEGIN
  v_result := calculate_fabrication_tags(p_reporter_email, p_business_name, p_complaint_type);
  RETURN (v_result->>'tags')::TEXT[];
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================================
-- EXAMPLE USAGE
-- ============================================================================

/*
-- Get all fabrication tags with analysis
SELECT calculate_fabrication_tags(
  'reporter@example.com',
  'ABC Restaurant',
  'health'
);

-- Get just the tags
SELECT get_fabrication_tags(
  'reporter@example.com',
  'ABC Restaurant',
  'health'
);

-- Get individual rule results
SELECT check_establishment_history('ABC Restaurant', 'health');
SELECT check_reporter_credibility('reporter@example.com');
SELECT check_reporter_under_review('reporter@example.com');
SELECT check_post_clearance_complaint('reporter@example.com', 'ABC Restaurant', 'health');
*/
