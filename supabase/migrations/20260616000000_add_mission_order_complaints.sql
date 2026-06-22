-- Link multiple complaints to a single mission order without changing the
-- existing mission_orders.complaint_id primary complaint relationship.

create table if not exists public.mission_order_complaints (
  mission_order_id uuid not null references public.mission_orders(id) on delete cascade,
  complaint_id uuid not null references public.complaints(id) on delete cascade,
  is_primary boolean not null default false,
  linked_at timestamp with time zone not null default now(),
  linked_by uuid references auth.users(id),
  primary key (mission_order_id, complaint_id)
);

create index if not exists idx_mission_order_complaints_complaint_id
  on public.mission_order_complaints (complaint_id);

create index if not exists idx_mission_order_complaints_mission_order_id
  on public.mission_order_complaints (mission_order_id);
