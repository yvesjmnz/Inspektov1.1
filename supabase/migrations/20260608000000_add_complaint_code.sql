CREATE SEQUENCE IF NOT EXISTS public.complaint_code_seq;

ALTER TABLE public.complaints
ADD COLUMN IF NOT EXISTS complaint_code text;

CREATE OR REPLACE FUNCTION public.assign_complaint_code()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.complaint_code IS NULL OR btrim(NEW.complaint_code) = '' THEN
    NEW.complaint_code := 'CMP-' || lpad(nextval('public.complaint_code_seq')::text, 6, '0');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS complaints_assign_complaint_code ON public.complaints;

CREATE TRIGGER complaints_assign_complaint_code
BEFORE INSERT ON public.complaints
FOR EACH ROW
EXECUTE FUNCTION public.assign_complaint_code();

ALTER TABLE public.complaints
ALTER COLUMN complaint_code
SET DEFAULT 'CMP-' || lpad(nextval('public.complaint_code_seq')::text, 6, '0');

UPDATE public.complaints
SET complaint_code = 'CMP-' || lpad(nextval('public.complaint_code_seq')::text, 6, '0')
WHERE complaint_code IS NULL OR btrim(complaint_code) = '';

DO $$
DECLARE
  max_suffix bigint;
BEGIN
  SELECT COALESCE(MAX((regexp_match(complaint_code, '^CMP-([0-9]+)$'))[1]::bigint), 0)
  INTO max_suffix
  FROM public.complaints
  WHERE complaint_code ~ '^CMP-[0-9]+$';

  IF max_suffix > 0 THEN
    PERFORM setval('public.complaint_code_seq', max_suffix, true);
  ELSE
    PERFORM setval('public.complaint_code_seq', 1, false);
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS complaints_complaint_code_key
ON public.complaints (complaint_code);

ALTER TABLE public.complaints
ALTER COLUMN complaint_code
SET NOT NULL;
