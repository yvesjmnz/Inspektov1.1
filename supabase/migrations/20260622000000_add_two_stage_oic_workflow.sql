-- Director-declared OIC workflow.
-- 1. Director declares unavailable dates and may add an optional handwritten confirmation.
-- 2. Head Inspector assigns an OIC/signatory for that declared unavailable period.
-- 3. Director approves and activates the OIC when available.
-- 4. If the Director cannot approve, Head Inspector may approve as a special case
--    with Director signature confirmation or a justification.
-- Temporary OIC assignments affect new documents only and revert after expiry.

CREATE OR REPLACE FUNCTION public.current_profile_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$;

INSERT INTO storage.buckets (id, name, public)
VALUES ('signatory-signatures', 'signatory-signatures', false)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.document_signatures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signatory_name text NOT NULL CHECK (length(trim(signatory_name)) BETWEEN 2 AND 160),
  signatory_title text NOT NULL CHECK (length(trim(signatory_title)) BETWEEN 2 AND 160),
  signature_bucket text NOT NULL,
  signature_path text NOT NULL,
  assignment_type text NOT NULL DEFAULT 'permanent' CHECK (assignment_type IN ('permanent', 'temporary')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  active_from timestamp with time zone NOT NULL DEFAULT now(),
  active_until timestamp with time zone,
  archived_at timestamp with time zone,
  archived_by uuid REFERENCES public.profiles(id),
  source_request_id uuid,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_document_signatures_one_active
  ON public.document_signatures ((status))
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS public.director_unavailability_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unavailable_start timestamp with time zone NOT NULL,
  unavailable_end timestamp with time zone NOT NULL,
  reason text NOT NULL CHECK (length(trim(reason)) >= 5),
  confirmation_bucket text,
  confirmation_path text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'assigned', 'cancelled', 'expired')),
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CHECK (unavailable_end > unavailable_start)
);

CREATE INDEX IF NOT EXISTS idx_director_unavailability_status_dates
  ON public.director_unavailability_periods (status, unavailable_start, unavailable_end);

CREATE TABLE IF NOT EXISTS public.oic_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  change_type text NOT NULL CHECK (change_type = 'temporary'),
  proposed_signatory_name text NOT NULL CHECK (length(trim(proposed_signatory_name)) BETWEEN 2 AND 160),
  proposed_signatory_title text NOT NULL CHECK (length(trim(proposed_signatory_title)) BETWEEN 2 AND 160),
  proposed_signature_bucket text NOT NULL DEFAULT 'signatory-signatures',
  proposed_signature_path text NOT NULL,
  reason text NOT NULL CHECK (length(trim(reason)) >= 5),
  validity_start timestamp with time zone,
  validity_end timestamp with time zone,
  unavailability_period_id uuid REFERENCES public.director_unavailability_periods(id),
  director_unavailable boolean NOT NULL DEFAULT false,
  director_unavailable_justification text,
  director_confirmation_bucket text,
  director_confirmation_path text,
  director_reviewed_by uuid REFERENCES public.profiles(id),
  director_reviewed_at timestamp with time zone,
  director_comment text,
  final_reviewed_by uuid REFERENCES public.profiles(id),
  final_reviewed_at timestamp with time zone,
  final_comment text,
  replaced_signature_id uuid REFERENCES public.document_signatures(id),
  status text NOT NULL DEFAULT 'pending_director' CHECK (
    status IN ('pending_director', 'pending_head_inspector', 'approved', 'rejected')
  ),
  requested_by uuid NOT NULL REFERENCES public.profiles(id),
  requested_at timestamp with time zone NOT NULL DEFAULT now(),
  implemented_at timestamp with time zone,
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.oic_requests
  ADD COLUMN IF NOT EXISTS unavailability_period_id uuid REFERENCES public.director_unavailability_periods(id);

ALTER TABLE public.oic_requests
  ADD COLUMN IF NOT EXISTS director_unavailable boolean NOT NULL DEFAULT false;

ALTER TABLE public.oic_requests
  ADD COLUMN IF NOT EXISTS director_unavailable_justification text;

ALTER TABLE public.document_signatures
  DROP CONSTRAINT IF EXISTS document_signatures_source_request_id_fkey;

ALTER TABLE public.document_signatures
  ADD CONSTRAINT document_signatures_source_request_id_fkey
  FOREIGN KEY (source_request_id) REFERENCES public.oic_requests(id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_oic_requests_one_open_per_requester
  ON public.oic_requests (requested_by)
  WHERE status IN ('pending_director', 'pending_head_inspector');

CREATE INDEX IF NOT EXISTS idx_oic_requests_status_requested
  ON public.oic_requests (status, requested_at DESC);

CREATE OR REPLACE FUNCTION public.touch_oic_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS document_signatures_touch_updated_at ON public.document_signatures;
CREATE TRIGGER document_signatures_touch_updated_at
BEFORE UPDATE ON public.document_signatures
FOR EACH ROW EXECUTE FUNCTION public.touch_oic_updated_at();

DROP TRIGGER IF EXISTS oic_requests_touch_updated_at ON public.oic_requests;
CREATE TRIGGER oic_requests_touch_updated_at
BEFORE UPDATE ON public.oic_requests
FOR EACH ROW EXECUTE FUNCTION public.touch_oic_updated_at();

DROP TRIGGER IF EXISTS director_unavailability_touch_updated_at ON public.director_unavailability_periods;
CREATE TRIGGER director_unavailability_touch_updated_at
BEFORE UPDATE ON public.director_unavailability_periods
FOR EACH ROW EXECUTE FUNCTION public.touch_oic_updated_at();

-- Preserve the Director signature restored in commit a393a2a as the initial
-- active/default signatory. This does not modify the Mission Order template.
INSERT INTO public.document_signatures (
  signatory_name,
  signatory_title,
  signature_bucket,
  signature_path,
  assignment_type,
  status,
  active_from
)
SELECT
  'LEVI C. FACUNDO',
  'Director',
  'e-signature bucket',
  '634074338_937186158874457_7418890435965105244_n-removebg-preview.png',
  'permanent',
  'active',
  now()
WHERE NOT EXISTS (
  SELECT 1 FROM public.document_signatures WHERE status = 'active'
);

CREATE OR REPLACE FUNCTION public.expire_temporary_document_signature()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_active public.document_signatures;
  v_request public.oic_requests;
BEGIN
  IF public.current_profile_role() NOT IN ('director', 'head_inspector') THEN
    RAISE EXCEPTION 'Not authorized to manage document signatures.';
  END IF;

  SELECT * INTO v_active
  FROM public.document_signatures
  WHERE status = 'active'
    AND assignment_type = 'temporary'
    AND active_until IS NOT NULL
    AND active_until <= now()
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN RETURN 0; END IF;

  SELECT * INTO v_request
  FROM public.oic_requests
  WHERE id = v_active.source_request_id;

  UPDATE public.document_signatures
  SET status = 'archived', archived_at = now(), archived_by = null
  WHERE id = v_active.id;

  IF v_request.replaced_signature_id IS NOT NULL THEN
    UPDATE public.document_signatures
    SET status = 'active', active_from = now(), active_until = null,
        archived_at = null, archived_by = null
    WHERE id = v_request.replaced_signature_id;
  END IF;

  IF v_request.unavailability_period_id IS NOT NULL THEN
    UPDATE public.director_unavailability_periods
    SET status = 'expired'
    WHERE id = v_request.unavailability_period_id
      AND status = 'assigned';
  END IF;

  RETURN 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.declare_director_unavailability(
  p_unavailable_start timestamp with time zone,
  p_unavailable_end timestamp with time zone,
  p_reason text,
  p_confirmation_bucket text DEFAULT null,
  p_confirmation_path text DEFAULT null
)
RETURNS public.director_unavailability_periods
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_period public.director_unavailability_periods;
BEGIN
  SELECT public.current_profile_role() INTO v_role;
  IF v_role <> 'director' THEN
    RAISE EXCEPTION 'Only Director can declare unavailable periods.';
  END IF;

  IF p_unavailable_start IS NULL OR p_unavailable_end IS NULL OR p_unavailable_end <= p_unavailable_start THEN
    RAISE EXCEPTION 'Unavailable period requires a valid start and end date.';
  END IF;

  IF length(trim(coalesce(p_reason, ''))) < 5 THEN
    RAISE EXCEPTION 'Reason must be at least 5 characters.';
  END IF;

  INSERT INTO public.director_unavailability_periods (
    unavailable_start,
    unavailable_end,
    reason,
    confirmation_bucket,
    confirmation_path,
    created_by
  ) VALUES (
    p_unavailable_start,
    p_unavailable_end,
    trim(p_reason),
    nullif(trim(coalesce(p_confirmation_bucket, '')), ''),
    nullif(trim(coalesce(p_confirmation_path, '')), ''),
    auth.uid()
  ) RETURNING * INTO v_period;

  RETURN v_period;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_active_document_signature()
RETURNS SETOF public.document_signatures
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.current_profile_role() NOT IN ('director', 'head_inspector') THEN
    RAISE EXCEPTION 'Not authorized to read the active document signature.';
  END IF;

  PERFORM public.expire_temporary_document_signature();
  RETURN QUERY
  SELECT * FROM public.document_signatures
  WHERE status = 'active'
  ORDER BY active_from DESC
  LIMIT 1;
END;
$$;

DROP FUNCTION IF EXISTS public.request_oic_assignment(
  text,
  text,
  text,
  text,
  text,
  text,
  timestamp with time zone,
  timestamp with time zone,
  boolean,
  text
);

DROP FUNCTION IF EXISTS public.request_oic_assignment(
  text,
  text,
  text,
  text,
  text,
  text,
  timestamp with time zone,
  timestamp with time zone,
  uuid
);

CREATE OR REPLACE FUNCTION public.request_oic_assignment(
  p_change_type text,
  p_signatory_name text,
  p_signatory_title text,
  p_signature_bucket text,
  p_signature_path text,
  p_reason text,
  p_validity_start timestamp with time zone DEFAULT null,
  p_validity_end timestamp with time zone DEFAULT null,
  p_unavailability_period_id uuid DEFAULT null,
  p_director_cannot_approve boolean DEFAULT false,
  p_special_justification text DEFAULT null
)
RETURNS public.oic_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_type text := lower(trim(p_change_type));
  v_justification text := nullif(trim(coalesce(p_special_justification, '')), '');
  v_active public.document_signatures;
  v_period public.director_unavailability_periods;
  v_start timestamp with time zone := p_validity_start;
  v_end timestamp with time zone := p_validity_end;
  v_request public.oic_requests;
BEGIN
  SELECT public.current_profile_role() INTO v_role;
  IF v_role <> 'head_inspector' THEN
    RAISE EXCEPTION 'Only Head Inspector can initiate an OIC/signatory request.';
  END IF;

  IF v_type <> 'temporary' THEN
    RAISE EXCEPTION 'Only temporary OIC assignment is supported.';
  END IF;

  IF length(trim(coalesce(p_signatory_name, ''))) < 2 OR length(trim(coalesce(p_signatory_title, ''))) < 2 THEN
    RAISE EXCEPTION 'Signatory name and title are required.';
  END IF;

  IF nullif(trim(coalesce(p_signature_path, '')), '') IS NULL THEN
    RAISE EXCEPTION 'The proposed signatory signature is required.';
  END IF;

  IF length(trim(coalesce(p_reason, ''))) < 5 THEN
    RAISE EXCEPTION 'Reason must be at least 5 characters.';
  END IF;

  IF p_unavailability_period_id IS NULL THEN
    RAISE EXCEPTION 'Temporary OIC assignment requires a Director-declared unavailable period.';
  END IF;

  SELECT * INTO v_period
  FROM public.director_unavailability_periods
  WHERE id = p_unavailability_period_id
    AND status = 'open'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Open Director unavailable period not found.';
  END IF;

  v_start := v_period.unavailable_start;
  v_end := v_period.unavailable_end;

  IF coalesce(p_director_cannot_approve, false) AND v_justification IS NULL THEN
    RAISE EXCEPTION 'Special Head Inspector approval requires a justification.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.oic_requests
    WHERE requested_by = auth.uid()
      AND status IN ('pending_director', 'pending_head_inspector')
  ) THEN
    RAISE EXCEPTION 'You already have an OIC/signatory request awaiting review.';
  END IF;

  PERFORM public.expire_temporary_document_signature();
  SELECT * INTO v_active FROM public.document_signatures WHERE status = 'active' LIMIT 1;

  INSERT INTO public.oic_requests (
    change_type, proposed_signatory_name, proposed_signatory_title,
    proposed_signature_bucket, proposed_signature_path, reason,
    validity_start, validity_end, unavailability_period_id,
    director_unavailable, director_unavailable_justification, replaced_signature_id,
    status, requested_by
  ) VALUES (
    v_type, trim(p_signatory_name), trim(p_signatory_title),
    coalesce(nullif(trim(p_signature_bucket), ''), 'signatory-signatures'),
    trim(p_signature_path), trim(p_reason),
    v_start,
    v_end,
    p_unavailability_period_id,
    coalesce(p_director_cannot_approve, false),
    CASE WHEN coalesce(p_director_cannot_approve, false) THEN v_justification ELSE null END,
    v_active.id,
    CASE WHEN coalesce(p_director_cannot_approve, false)
      THEN 'pending_head_inspector' ELSE 'pending_director' END,
    auth.uid()
  ) RETURNING * INTO v_request;

  IF p_unavailability_period_id IS NOT NULL THEN
    UPDATE public.director_unavailability_periods
    SET status = 'assigned'
    WHERE id = p_unavailability_period_id;
  END IF;

  RETURN v_request;
END;
$$;

CREATE OR REPLACE FUNCTION public.director_review_oic_request(
  p_request_id uuid,
  p_decision text,
  p_comment text DEFAULT null,
  p_confirmation_bucket text DEFAULT null,
  p_confirmation_path text DEFAULT null
)
RETURNS public.oic_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_decision text := lower(trim(p_decision));
  v_request public.oic_requests;
BEGIN
  SELECT public.current_profile_role() INTO v_role;
  IF v_role <> 'director' THEN
    RAISE EXCEPTION 'Only Director can perform the first OIC request review.';
  END IF;
  IF v_decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Decision must be approved or rejected.';
  END IF;

  SELECT * INTO v_request FROM public.oic_requests
  WHERE id = p_request_id AND status = 'pending_director'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pending Director review not found.'; END IF;

  UPDATE public.oic_requests
  SET status = CASE WHEN v_decision = 'approved' THEN 'approved' ELSE 'rejected' END,
      director_confirmation_bucket = nullif(trim(coalesce(p_confirmation_bucket, '')), ''),
      director_confirmation_path = nullif(trim(coalesce(p_confirmation_path, '')), ''),
      director_reviewed_by = auth.uid(), director_reviewed_at = now(),
      director_comment = nullif(trim(coalesce(p_comment, '')), '')
  WHERE id = p_request_id
  RETURNING * INTO v_request;

  IF v_decision = 'approved' THEN
    UPDATE public.document_signatures
    SET status = 'archived', archived_at = now(), archived_by = auth.uid()
    WHERE status = 'active';

    INSERT INTO public.document_signatures (
      signatory_name, signatory_title, signature_bucket, signature_path,
      assignment_type, status, active_from, active_until,
      source_request_id, created_by
    ) VALUES (
      v_request.proposed_signatory_name, v_request.proposed_signatory_title,
      v_request.proposed_signature_bucket, v_request.proposed_signature_path,
      'temporary', 'active', coalesce(v_request.validity_start, now()),
      v_request.validity_end, v_request.id, v_request.requested_by
    );

    UPDATE public.oic_requests SET implemented_at = now()
    WHERE id = p_request_id RETURNING * INTO v_request;
  ELSIF v_request.unavailability_period_id IS NOT NULL THEN
    UPDATE public.director_unavailability_periods
    SET status = 'open'
    WHERE id = v_request.unavailability_period_id
      AND status = 'assigned';
  END IF;

  RETURN v_request;
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_oic_request(
  p_request_id uuid,
  p_decision text,
  p_comment text DEFAULT null
)
RETURNS public.oic_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_decision text := lower(trim(p_decision));
  v_request public.oic_requests;
BEGIN
  SELECT public.current_profile_role() INTO v_role;
  IF v_role <> 'head_inspector' THEN
    RAISE EXCEPTION 'Only Head Inspector can finalize an OIC/signatory request.';
  END IF;
  IF v_decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Decision must be approved or rejected.';
  END IF;

  SELECT * INTO v_request FROM public.oic_requests
  WHERE id = p_request_id AND status = 'pending_head_inspector'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pending final review not found.'; END IF;

  IF NOT v_request.director_unavailable THEN
    RAISE EXCEPTION 'Head Inspector approval is only allowed when the Director cannot approve.';
  END IF;

  UPDATE public.oic_requests
  SET status = v_decision, final_reviewed_by = auth.uid(),
      final_reviewed_at = now(), final_comment = nullif(trim(coalesce(p_comment, '')), '')
  WHERE id = p_request_id
  RETURNING * INTO v_request;

  IF v_decision = 'approved' THEN
    UPDATE public.document_signatures
    SET status = 'archived', archived_at = now(), archived_by = auth.uid()
    WHERE status = 'active';

    INSERT INTO public.document_signatures (
      signatory_name, signatory_title, signature_bucket, signature_path,
      assignment_type, status, active_from, active_until,
      source_request_id, created_by
    ) VALUES (
      v_request.proposed_signatory_name, v_request.proposed_signatory_title,
      v_request.proposed_signature_bucket, v_request.proposed_signature_path,
      'temporary', 'active', coalesce(v_request.validity_start, now()),
      v_request.validity_end, v_request.id, v_request.requested_by
    );

    UPDATE public.oic_requests SET implemented_at = now()
    WHERE id = p_request_id RETURNING * INTO v_request;
  ELSIF v_request.unavailability_period_id IS NOT NULL THEN
    UPDATE public.director_unavailability_periods
    SET status = 'open'
    WHERE id = v_request.unavailability_period_id
      AND status = 'assigned';
  END IF;

  RETURN v_request;
END;
$$;

ALTER TABLE public.document_signatures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.director_unavailability_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oic_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Director and Head Inspector can view document signatures" ON public.document_signatures;
CREATE POLICY "Director and Head Inspector can view document signatures"
ON public.document_signatures FOR SELECT
USING (public.current_profile_role() IN ('director', 'head_inspector'));

DROP POLICY IF EXISTS "Director and Head Inspector can view Director unavailable periods" ON public.director_unavailability_periods;
CREATE POLICY "Director and Head Inspector can view Director unavailable periods"
ON public.director_unavailability_periods FOR SELECT
USING (public.current_profile_role() IN ('director', 'head_inspector'));

DROP POLICY IF EXISTS "Director and Head Inspector can view OIC requests" ON public.oic_requests;
CREATE POLICY "Director and Head Inspector can view OIC requests"
ON public.oic_requests FOR SELECT
USING (public.current_profile_role() IN ('director', 'head_inspector'));

DROP POLICY IF EXISTS "Head Inspector can upload OIC signatures" ON storage.objects;
CREATE POLICY "Head Inspector can upload OIC signatures"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'signatory-signatures' AND public.current_profile_role() = 'head_inspector');

DROP POLICY IF EXISTS "Director can upload optional OIC confirmations" ON storage.objects;
CREATE POLICY "Director can upload optional OIC confirmations"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'signatory-signatures' AND public.current_profile_role() = 'director');

DROP POLICY IF EXISTS "Director and Head Inspector can read OIC signatures" ON storage.objects;
CREATE POLICY "Director and Head Inspector can read OIC signatures"
ON storage.objects FOR SELECT
USING (bucket_id = 'signatory-signatures' AND public.current_profile_role() IN ('director', 'head_inspector'));

GRANT EXECUTE ON FUNCTION public.expire_temporary_document_signature() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_active_document_signature() TO authenticated;
GRANT EXECUTE ON FUNCTION public.declare_director_unavailability(timestamp with time zone, timestamp with time zone, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_oic_assignment(text, text, text, text, text, text, timestamp with time zone, timestamp with time zone, uuid, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.director_review_oic_request(uuid, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_oic_request(uuid, text, text) TO authenticated;
