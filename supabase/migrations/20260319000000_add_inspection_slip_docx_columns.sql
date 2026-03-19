-- Add columns to persist "inspection slip" DOCX generation
BEGIN;

ALTER TABLE public.inspection_reports
  ADD COLUMN IF NOT EXISTS generated_docx_url TEXT,
  ADD COLUMN IF NOT EXISTS generated_docx_created_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS generated_docx_created_by UUID;

COMMENT ON COLUMN public.inspection_reports.generated_docx_url IS 'Storage/public URL to the generated inspection slip DOCX.';
COMMENT ON COLUMN public.inspection_reports.generated_docx_created_at IS 'When the inspection slip DOCX was generated.';
COMMENT ON COLUMN public.inspection_reports.generated_docx_created_by IS 'User who generated the inspection slip DOCX.';

CREATE INDEX IF NOT EXISTS idx_inspection_reports_generated_docx_url ON public.inspection_reports (generated_docx_url);

COMMIT;
