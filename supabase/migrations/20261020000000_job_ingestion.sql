begin;

do $guard$
begin
  if obj_description('public.job_listings'::regclass, 'pg_class')
     is distinct from 'app:core_schema_v1' then
    raise exception 'Refusing to alter public.job_listings: ownership marker missing';
  end if;
end
$guard$;

alter table public.job_listings
  add column if not exists last_seen_at timestamptz not null default now(),
  add column if not exists source_url_verified_at timestamptz,
  add column if not exists source_url_status smallint
    check (source_url_status is null or source_url_status between 100 and 599),
  add column if not exists is_active boolean not null default true;

create index if not exists job_listings_active_fresh_idx
  on public.job_listings(is_active, posted_at desc);

comment on column public.job_listings.last_seen_at is
  'Last successful observation by an authorized source adapter';
comment on column public.job_listings.source_url_verified_at is
  'Time the source URL last returned a successful HTTP response';
comment on column public.job_listings.source_url_status is
  'Last successful HTTP status observed for the source URL';
comment on column public.job_listings.is_active is
  'False only after a complete source reconciliation proves the listing absent or expired';

commit;
