-- Expand the existing employment_type vocabulary without rewriting existing rows.
-- Legacy schedule-oriented values remain accepted for compatibility, but new
-- French sources use explicit contract families.

alter table public.job_preferences
  drop constraint if exists job_preferences_employment_types_check;

alter table public.job_preferences
  add constraint job_preferences_employment_types_check check (
    employment_types <@ array[
      'permanent','fixed_term','freelance','temporary','apprenticeship','internship','seasonal','occasional',
      'full_time','part_time','contract'
    ]
  );

alter table public.job_listings
  drop constraint if exists job_listings_employment_type_check;

alter table public.job_listings
  add constraint job_listings_employment_type_check check (
    employment_type is null or employment_type in (
      'permanent','fixed_term','freelance','temporary','apprenticeship','internship','seasonal','occasional',
      'full_time','part_time','contract'
    )
  );

create index if not exists job_listings_active_employment_type_idx
  on public.job_listings (employment_type) where is_active and not is_demo;

create index if not exists job_listings_active_work_mode_idx
  on public.job_listings (work_mode) where is_active and not is_demo;
