-- Business marketed/common naming workflow.
-- Legal/corporate names stay in businesses.business_name. Approved marketed_name
-- is the public/search display name after Director approval.

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS marketed_name text,
  ADD COLUMN IF NOT EXISTS marketed_name_approved_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS marketed_name_approved_by uuid REFERENCES public.profiles(id);

CREATE TABLE IF NOT EXISTS public.business_name_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_pk integer NOT NULL REFERENCES public.businesses(business_pk) ON DELETE CASCADE,
  proposed_marketed_name text NOT NULL CHECK (length(trim(proposed_marketed_name)) BETWEEN 2 AND 160),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  requested_by uuid NOT NULL REFERENCES public.profiles(id),
  requested_at timestamp with time zone NOT NULL DEFAULT now(),
  reviewed_by uuid REFERENCES public.profiles(id),
  reviewed_at timestamp with time zone,
  director_comment text,
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_business_name_requests_one_pending
  ON public.business_name_requests (business_pk)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_business_name_requests_business_pk
  ON public.business_name_requests (business_pk);

CREATE INDEX IF NOT EXISTS idx_business_name_requests_status_requested
  ON public.business_name_requests (status, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_businesses_marketed_name_lower
  ON public.businesses (lower(marketed_name));

CREATE INDEX IF NOT EXISTS idx_businesses_business_name_lower
  ON public.businesses (lower(business_name));

CREATE OR REPLACE FUNCTION public.touch_business_name_request_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS business_name_requests_touch_updated_at ON public.business_name_requests;
CREATE TRIGGER business_name_requests_touch_updated_at
BEFORE UPDATE ON public.business_name_requests
FOR EACH ROW
EXECUTE FUNCTION public.touch_business_name_request_updated_at();

CREATE OR REPLACE FUNCTION public.current_profile_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.propose_business_marketed_name(
  p_business_pk integer,
  p_marketed_name text
)
RETURNS public.business_name_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_name text := nullif(trim(p_marketed_name), '');
  v_request public.business_name_requests;
BEGIN
  SELECT public.current_profile_role() INTO v_role;
  IF v_role <> 'head_inspector' THEN
    RAISE EXCEPTION 'Only Head Inspector can propose marketed names.';
  END IF;

  IF v_name IS NULL OR length(v_name) < 2 OR length(v_name) > 160 THEN
    RAISE EXCEPTION 'Marketed name must be between 2 and 160 characters.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.businesses WHERE business_pk = p_business_pk) THEN
    RAISE EXCEPTION 'Business not found.';
  END IF;

  INSERT INTO public.business_name_requests (
    business_pk,
    proposed_marketed_name,
    status,
    requested_by,
    requested_at
  )
  VALUES (
    p_business_pk,
    v_name,
    'pending',
    auth.uid(),
    now()
  )
  ON CONFLICT (business_pk) WHERE status = 'pending'
  DO UPDATE SET
    proposed_marketed_name = EXCLUDED.proposed_marketed_name,
    requested_by = auth.uid(),
    requested_at = now(),
    reviewed_by = null,
    reviewed_at = null,
    director_comment = null
  RETURNING * INTO v_request;

  RETURN v_request;
END;
$$;

CREATE OR REPLACE FUNCTION public.review_business_marketed_name_request(
  p_request_id uuid,
  p_decision text,
  p_director_comment text DEFAULT null
)
RETURNS public.business_name_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_decision text := lower(trim(p_decision));
  v_request public.business_name_requests;
BEGIN
  SELECT public.current_profile_role() INTO v_role;
  IF v_role <> 'director' THEN
    RAISE EXCEPTION 'Only Director can review marketed name requests.';
  END IF;

  IF v_decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Decision must be approved or rejected.';
  END IF;

  SELECT *
  INTO v_request
  FROM public.business_name_requests
  WHERE id = p_request_id
    AND status = 'pending'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pending request not found.';
  END IF;

  UPDATE public.business_name_requests
  SET
    status = v_decision,
    reviewed_by = auth.uid(),
    reviewed_at = now(),
    director_comment = nullif(trim(coalesce(p_director_comment, '')), '')
  WHERE id = p_request_id
  RETURNING * INTO v_request;

  IF v_decision = 'approved' THEN
    UPDATE public.businesses
    SET
      marketed_name = v_request.proposed_marketed_name,
      marketed_name_approved_at = now(),
      marketed_name_approved_by = auth.uid()
    WHERE business_pk = v_request.business_pk;
  END IF;

  RETURN v_request;
END;
$$;

ALTER TABLE public.business_name_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Head inspector and director can view naming requests" ON public.business_name_requests;
CREATE POLICY "Head inspector and director can view naming requests"
ON public.business_name_requests
FOR SELECT
USING (public.current_profile_role() IN ('head_inspector', 'director'));

DROP POLICY IF EXISTS "Head inspector can insert naming requests" ON public.business_name_requests;
CREATE POLICY "Head inspector can insert naming requests"
ON public.business_name_requests
FOR INSERT
WITH CHECK (public.current_profile_role() = 'head_inspector' AND requested_by = auth.uid());

DROP POLICY IF EXISTS "Head inspector can update own pending naming requests" ON public.business_name_requests;
CREATE POLICY "Head inspector can update own pending naming requests"
ON public.business_name_requests
FOR UPDATE
USING (public.current_profile_role() = 'head_inspector' AND status = 'pending')
WITH CHECK (public.current_profile_role() = 'head_inspector' AND status = 'pending');

GRANT EXECUTE ON FUNCTION public.propose_business_marketed_name(integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.review_business_marketed_name_request(uuid, text, text) TO authenticated;
