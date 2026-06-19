create extension if not exists pgcrypto;

insert into storage.buckets (id, name, public)
values
  ('aspan-documents', 'aspan-documents', false),
  ('aspan-proposals', 'aspan-proposals', false)
on conflict (id) do nothing;

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  client_name text not null,
  industry text,
  country text,
  city text,
  business_description text,
  created_at timestamptz not null default now()
);

create table if not exists public.proposal_runs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) on delete set null,
  status text not null default 'draft',
  bill_json jsonb,
  client_json jsonb,
  calc_json jsonb,
  warnings jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  proposal_run_id uuid references public.proposal_runs(id) on delete cascade,
  kind text not null,
  file_name text not null,
  storage_bucket text not null,
  storage_path text not null,
  extraction_json jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.proposal_outputs (
  id uuid primary key default gen_random_uuid(),
  proposal_run_id uuid references public.proposal_runs(id) on delete cascade,
  storage_bucket text not null,
  storage_path text not null,
  file_name text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_proposal_runs_client_id on public.proposal_runs(client_id);
create index if not exists idx_documents_run_id on public.documents(proposal_run_id);
create index if not exists idx_outputs_run_id on public.proposal_outputs(proposal_run_id);

alter table public.clients enable row level security;
alter table public.proposal_runs enable row level security;
alter table public.documents enable row level security;
alter table public.proposal_outputs enable row level security;

comment on table public.clients is 'Client records created when a reviewed proposal is generated.';
comment on table public.proposal_runs is 'One proposal workspace run, including reviewed extraction and calculation snapshots.';
comment on table public.documents is 'Uploaded source documents stored in Supabase Storage.';
comment on table public.proposal_outputs is 'Generated PowerPoint outputs stored in Supabase Storage.';
