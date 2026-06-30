-- Short-lived form access granted only after an email verification token is consumed.

create table if not exists public.complaint_access_tokens (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  token_hash text not null unique,
  form_type text not null default 'complaint'
    check (form_type in ('complaint', 'special-complaint')),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.complaint_access_tokens enable row level security;
revoke all on public.complaint_access_tokens from anon, authenticated;

-- Verification-token state is server-only. The former client-side lookup by
-- email could reveal whether a pending token existed and was not proof that
-- the requester owned that email.
revoke select on public.email_verification_tokens from anon, authenticated;

-- Public complaint inserts must pass through the submit-complaint Edge Function,
-- which validates and consumes a complaint access token using the service role.
revoke insert on public.complaints from anon, authenticated;
