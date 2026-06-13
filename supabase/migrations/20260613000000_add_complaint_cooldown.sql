BEGIN;

CREATE OR REPLACE FUNCTION public.normalize_complaint_establishment_text(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT regexp_replace(lower(btrim(coalesce(p_value, ''))), '\s+', ' ', 'g');
$$;

CREATE OR REPLACE FUNCTION public.get_complaint_cooldown_status(
  p_business_pk integer,
  p_business_name text,
  p_business_address text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text := public.normalize_complaint_establishment_text(p_business_name);
  v_address text := public.normalize_complaint_establishment_text(p_business_address);
  v_active_mission_order_id uuid;
  v_report record;
  v_completed_at timestamptz;
  v_has_violations boolean := false;
  v_cooldown_days integer;
  v_eligible_at timestamptz;
  v_days_remaining integer := 0;
  v_message text;
BEGIN
  IF p_business_pk IS NULL AND (v_name = '' OR v_address = '') THEN
    RETURN jsonb_build_object(
      'blocked', false,
      'phase', null,
      'message', null,
      'cooldown_days', null,
      'days_remaining', 0,
      'eligible_at', null,
      'inspection_completed_at', null,
      'has_violations', null,
      'mission_order_id', null,
      'inspection_report_id', null
    );
  END IF;

  SELECT mo.id
  INTO v_active_mission_order_id
  FROM public.mission_orders mo
  JOIN public.complaints c ON c.id = mo.complaint_id
  WHERE lower(coalesce(mo.status, '')) NOT IN ('cancelled', 'canceled')
    AND (
      (p_business_pk IS NOT NULL AND c.business_pk = p_business_pk)
      OR (
        p_business_pk IS NULL
        AND public.normalize_complaint_establishment_text(c.business_name) = v_name
        AND public.normalize_complaint_establishment_text(c.business_address) = v_address
      )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.inspection_reports ir
      WHERE ir.mission_order_id = mo.id
        AND lower(coalesce(ir.status, '')) IN ('completed', 'complete')
        AND coalesce(ir.completed_at, ir.updated_at) IS NOT NULL
    )
  ORDER BY coalesce(mo.updated_at, mo.created_at) DESC, mo.created_at DESC
  LIMIT 1;

  IF v_active_mission_order_id IS NOT NULL THEN
    v_message := 'A mission order or inspection is already in progress for this establishment. Complaints cannot be filed until the inspection is completed.';

    RETURN jsonb_build_object(
      'blocked', true,
      'phase', 'mission_order_to_inspection',
      'message', v_message,
      'cooldown_days', null,
      'days_remaining', null,
      'eligible_at', null,
      'inspection_completed_at', null,
      'has_violations', null,
      'mission_order_id', v_active_mission_order_id,
      'inspection_report_id', null
    );
  END IF;

  SELECT
    ir.id AS inspection_report_id,
    mo.id AS mission_order_id,
    coalesce(ir.completed_at, ir.updated_at) AS completed_at,
    (
      lower(coalesce(ir.business_permit_status, '')) LIKE '%non%'
      OR lower(coalesce(ir.cctv_status, '')) LIKE '%non%'
      OR lower(coalesce(ir.signage_status, '')) LIKE '%non%'
      OR coalesce(ir.inspection_comments, '') ~* ':\s*Violation Confirmed'
      OR coalesce(ir.inspection_comments, '') ~* '^\s*\[(Partial Compliance|Non-Compliance)\]'
      OR coalesce(ir.inspection_comments, '') ~* '^\s*Compliance Status:\s*(Partial Compliance|Non-Compliance)'
    ) AS has_violations
  INTO v_report
  FROM public.inspection_reports ir
  JOIN public.mission_orders mo ON mo.id = ir.mission_order_id
  JOIN public.complaints c ON c.id = mo.complaint_id
  WHERE lower(coalesce(mo.status, '')) NOT IN ('cancelled', 'canceled')
    AND lower(coalesce(ir.status, '')) IN ('completed', 'complete')
    AND coalesce(ir.completed_at, ir.updated_at) IS NOT NULL
    AND (
      (p_business_pk IS NOT NULL AND c.business_pk = p_business_pk)
      OR (
        p_business_pk IS NULL
        AND public.normalize_complaint_establishment_text(c.business_name) = v_name
        AND public.normalize_complaint_establishment_text(c.business_address) = v_address
      )
    )
  ORDER BY coalesce(ir.completed_at, ir.updated_at) DESC, ir.created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'blocked', false,
      'phase', null,
      'message', null,
      'cooldown_days', null,
      'days_remaining', 0,
      'eligible_at', null,
      'inspection_completed_at', null,
      'has_violations', null,
      'mission_order_id', null,
      'inspection_report_id', null
    );
  END IF;

  v_completed_at := v_report.completed_at;
  v_has_violations := coalesce(v_report.has_violations, false);
  v_cooldown_days := CASE WHEN v_has_violations THEN 30 ELSE 14 END;
  v_eligible_at := v_completed_at + make_interval(days => v_cooldown_days);

  IF now() >= v_eligible_at THEN
    RETURN jsonb_build_object(
      'blocked', false,
      'phase', 'cooldown_complete',
      'message', null,
      'cooldown_days', v_cooldown_days,
      'days_remaining', 0,
      'eligible_at', v_eligible_at,
      'inspection_completed_at', v_completed_at,
      'has_violations', v_has_violations,
      'mission_order_id', v_report.mission_order_id,
      'inspection_report_id', v_report.inspection_report_id
    );
  END IF;

  v_days_remaining := greatest(1, ceil(extract(epoch from (v_eligible_at - now())) / 86400.0)::integer);
  v_message := format(
    'An inspection was recently completed on %s. Complaints may be filed after %s (%s day%s remaining).',
    to_char(v_completed_at AT TIME ZONE 'Asia/Manila', 'FMMonth FMDD, YYYY'),
    to_char(v_eligible_at AT TIME ZONE 'Asia/Manila', 'FMMonth FMDD, YYYY'),
    v_days_remaining,
    CASE WHEN v_days_remaining = 1 THEN '' ELSE 's' END
  );

  RETURN jsonb_build_object(
    'blocked', true,
    'phase', CASE WHEN v_has_violations THEN 'inspection_with_violations_cooldown' ELSE 'inspection_without_violations_cooldown' END,
    'message', v_message,
    'cooldown_days', v_cooldown_days,
    'days_remaining', v_days_remaining,
    'eligible_at', v_eligible_at,
    'inspection_completed_at', v_completed_at,
    'has_violations', v_has_violations,
    'mission_order_id', v_report.mission_order_id,
    'inspection_report_id', v_report.inspection_report_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_complaint_cooldown()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status jsonb;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM unnest(coalesce(NEW.tags, '{}'::text[])) AS tag(value)
    WHERE lower(btrim(tag.value)) = 'special complaint'
  ) THEN
    RETURN NEW;
  END IF;

  v_status := public.get_complaint_cooldown_status(
    NEW.business_pk,
    NEW.business_name,
    NEW.business_address
  );

  IF coalesce((v_status->>'blocked')::boolean, false) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = coalesce(v_status->>'message', 'Complaints cannot be filed for this establishment at this time.');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS complaints_enforce_cooldown ON public.complaints;

CREATE TRIGGER complaints_enforce_cooldown
BEFORE INSERT ON public.complaints
FOR EACH ROW
EXECUTE FUNCTION public.enforce_complaint_cooldown();

REVOKE ALL ON FUNCTION public.get_complaint_cooldown_status(integer, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_complaint_cooldown_status(integer, text, text) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.get_complaint_cooldown_status(integer, text, text)
IS 'Returns complaint filing cooldown status for an establishment based on mission orders and completed inspection reports.';

COMMIT;
