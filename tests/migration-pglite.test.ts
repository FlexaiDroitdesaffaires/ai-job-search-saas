import { readFileSync, readdirSync } from "node:fs"
import { resolve } from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const migrationDirectory = resolve(process.cwd(), "supabase/migrations")
const migrations = readdirSync(migrationDirectory)
  .filter((file) => file.endsWith(".sql"))
  .sort()
  .map((file) => readFileSync(resolve(migrationDirectory, file), "utf8"))

describe("core migration PostgreSQL compatibility smoke test", () => {
  const db = new PGlite()

  beforeAll(async () => {
    await db.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin bypassrls;
      create schema auth;
      create schema storage;
      create schema extensions;
      grant usage on schema public, auth, storage, extensions to anon, authenticated, service_role;

      create function extensions.digest(data bytea, algorithm text) returns bytea
      language sql immutable set search_path = '' as $$
        select decode(repeat('00', 32), 'hex')
      $$;

      create table auth.users (
        id uuid primary key,
        email text,
        raw_user_meta_data jsonb not null default '{}'::jsonb
      );
      grant select on auth.users to authenticated, service_role;

      create table storage.buckets (
        id text primary key,
        name text not null,
        public boolean not null default false,
        file_size_limit bigint,
        allowed_mime_types text[]
      );
      create table storage.objects (
        id uuid primary key default gen_random_uuid(),
        bucket_id text not null,
        name text not null,
        owner_id text
      );
      alter table storage.objects enable row level security;
      grant select, insert, update, delete on storage.objects to authenticated;

      create function auth.uid() returns uuid language sql stable set search_path = '' as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      create function storage.foldername(name text) returns text[] language sql immutable set search_path = '' as $$
        select string_to_array(name, '/')
      $$;
      grant execute on function auth.uid() to anon, authenticated, service_role;
      grant execute on function storage.foldername(text) to anon, authenticated, service_role;

      alter default privileges for role postgres in schema public
        grant all on tables to anon, authenticated, service_role;
      alter default privileges for role postgres in schema public
        grant usage, select on sequences to anon, authenticated, service_role;
    `)
    for (const migration of migrations) await db.exec(migration)
    await db.exec(`
      insert into auth.users (id, email, raw_user_meta_data) values
        ('11111111-1111-1111-1111-111111111111', 'one@example.test', '{"full_name":"One"}'),
        ('22222222-2222-2222-2222-222222222222', 'two@example.test', '{"full_name":"Two"}');
    `)
  }, 30_000)

  afterAll(async () => db.close())

  it("applique la migration complète", async () => {
    const result = await db.query<{ count: number }>(
      "select count(*)::integer as count from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and obj_description(c.oid, 'pg_class')='app:core_schema_v1'",
    )
    expect(result.rows[0]?.count).toBe(27)
  })

  it("ajoute les marqueurs de fraîcheur des offres", async () => {
    const result = await db.query<{ column_name: string }>(`
      select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'job_listings'
        and column_name in ('last_seen_at', 'source_url_verified_at', 'source_url_status', 'is_active')
      order by column_name
    `)
    expect(result.rows.map((row) => row.column_name)).toEqual([
      "is_active", "last_seen_at", "source_url_status", "source_url_verified_at",
    ])
  })

  it("réserve l'ingestion au serveur et expose les offres aux utilisateurs", async () => {
    await db.exec(`
      set role service_role;
      insert into public.job_listings (
        provider, external_id, title, company, source_url, posted_at, dedupe_key,
        source_url_verified_at, source_url_status, is_active
      ) values (
        'fixture', 'job-1', 'Engineer', 'Example', 'https://example.test/jobs/1', now(),
        repeat('a', 64), now(), 200, true
      );
      reset role;
      set role authenticated;
      set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
    `)
    const visible = await db.query<{ external_id: string }>(
      "select external_id from public.job_listings where provider='fixture'",
    )
    expect(visible.rows).toEqual([{ external_id: "job-1" }])
    await expect(db.exec(`
      insert into public.job_listings (provider, external_id, title, company, dedupe_key)
      values ('fixture', 'forbidden', 'Engineer', 'Example', repeat('b', 64))
    `)).rejects.toThrow()
    await db.exec("reset role")
  })

  it("isole deux utilisateurs avec RLS", async () => {
    await db.exec("set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';")
    const result = await db.query<{ id: string }>("select id from public.profiles order by id")
    await db.exec("reset role")
    expect(result.rows.map((row) => row.id)).toEqual(["11111111-1111-1111-1111-111111111111"])
  })

  it("isole les objets CV par dossier utilisateur", async () => {
    await db.exec("set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';")
    await expect(db.exec(`
      insert into storage.objects (bucket_id, name, owner_id)
      values ('resumes', '11111111-1111-1111-1111-111111111111/allowed.pdf', '11111111-1111-1111-1111-111111111111')
    `)).resolves.toBeDefined()
    await expect(db.exec(`
      insert into storage.objects (bucket_id, name, owner_id)
      values ('resumes', '22222222-2222-2222-2222-222222222222/forbidden.pdf', '11111111-1111-1111-1111-111111111111')
    `)).rejects.toThrow()
    await db.exec("reset role")
  })

  it("refuse applied sans preuve et accepte la confirmation manuelle explicite", async () => {
    await db.exec("set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';")
    await expect(db.exec(`
      insert into public.applications (user_id, company, job_title, status)
      values ('11111111-1111-1111-1111-111111111111', 'Bad', 'Claim', 'applied')
    `)).rejects.toThrow()
    await db.exec(`
      insert into public.applications (id, user_id, company, job_title)
      values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', '11111111-1111-1111-1111-111111111111', 'Manual', 'Role');
      select public.record_manual_submission('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', now(), 'test');
    `)
    const result = await db.query<{ status: string; prep_state: string }>(
      "select status, prep_state from public.applications where id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'",
    )
    await db.exec("reset role")
    expect(result.rows[0]).toMatchObject({ status: "applied", prep_state: "submitted" })
  })

  it("rejoue une clé de soumission sans créer de doublon", async () => {
    await db.exec(`
      set role authenticated;
      set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
      insert into public.applications (id, user_id, company, job_title)
      values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2', '11111111-1111-1111-1111-111111111111', 'Adapter', 'Role');
      reset role;
      set role service_role;
      update public.applications set prep_state='approved' where id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
      reset role;
      set role service_role;
    `)
    const first = await db.query<{ result: { submission_id: string } }>(`
      select public.start_application_submission(
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2', 'adapter-idem-001', 'fixture', repeat('a', 64)) as result
    `)
    const replay = await db.query<{ result: { submission_id: string; replayed: boolean } }>(`
      select public.start_application_submission(
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2', 'adapter-idem-001', 'fixture', repeat('a', 64)) as result
    `)
    expect(replay.rows[0]?.result.submission_id).toBe(first.rows[0]?.result.submission_id)
    expect(replay.rows[0]?.result.replayed).toBe(true)
    await db.query(`
      select public.confirm_application_submission(
        '${first.rows[0]?.result.submission_id}', 'fixture-receipt-1', '{"receipt":"confirmed"}'::jsonb)
    `)
    const application = await db.query<{ status: string; prep_state: string }>(
      "select status, prep_state from public.applications where id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2'",
    )
    await db.exec("reset role")
    expect(application.rows[0]).toMatchObject({ status: "applied", prep_state: "submitted" })
  })

  it("sérialise les crédits et rejoue sans doubler", async () => {
    await db.exec("set role service_role")
    await db.query("select public.grant_credits('11111111-1111-1111-1111-111111111111', 10, 'admin_adjustment', 'test', 'grant-idem-001')")
    const replay = await db.query<{ result: { balance: number; replayed: boolean } }>(`
      select public.grant_credits(
        '11111111-1111-1111-1111-111111111111', 10, 'admin_adjustment', 'test', 'grant-idem-001') as result
    `)
    await db.query(`
      select public.spend_credits(
        '11111111-1111-1111-1111-111111111111', 3, 'ai_application', 'fixture', 'spend-idem-001')
    `)
    await expect(db.query(`
      select public.spend_credits(
        '11111111-1111-1111-1111-111111111111', 100, 'ai_application', 'fixture', 'spend-idem-002')
    `)).rejects.toThrow()
    const balance = await db.query<{ balance: number }>(
      "select balance from public.credit_accounts where user_id='11111111-1111-1111-1111-111111111111'",
    )
    await db.exec("reset role")
    expect(replay.rows[0]?.result).toMatchObject({ balance: 10, replayed: true })
    expect(balance.rows[0]?.balance).toBe(7)
  })

  it("interdit au client les écritures réservées au serveur", async () => {
    await db.exec("set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';")
    await expect(db.exec("update public.application_submissions set state='failed'"))
      .rejects.toThrow()
    await expect(db.query("select * from public.app_resource_ownership"))
      .rejects.toThrow()
    await db.exec("reset role")
  })

  it("persiste atomiquement les refus et acceptations sans faux envoi", async () => {
    await db.exec(`
      set role service_role;
      insert into public.job_listings (
        id, provider, external_id, title, company, location, source_url, dedupe_key,
        source_url_verified_at, source_url_status, is_active, is_demo
      ) values
        ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1', 'fixture', 'swipe-skip', 'Skip role', 'Example', 'Remote', 'https://example.test/skip', repeat('c', 64), now(), 200, true, false),
        ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', 'fixture', 'swipe-save', 'Save role', 'Example', 'Remote', 'https://example.test/save', repeat('d', 64), now(), 200, true, false);
      reset role;
      set role authenticated;
      set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
    `)
    const refusal = await db.query<{ result: { decision: string; application_id: string | null } }>(
      "select public.decide_job('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1', 'skipped') as result",
    )
    expect(refusal.rows[0]?.result).toMatchObject({ decision: "skipped", application_id: null })
    expect((await db.query<{ count: number }>("select count(*)::integer as count from public.applications where job_id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1'")).rows[0]?.count).toBe(0)

    const accepted = await db.query<{ result: { application_id: string; application_status: string; preparation_state: string } }>(
      "select public.decide_job('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', 'saved') as result",
    )
    const replay = await db.query<{ result: { application_id: string; replayed: boolean } }>(
      "select public.decide_job('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', 'saved') as result",
    )
    expect(accepted.rows[0]?.result).toMatchObject({ application_status: "saved", preparation_state: "draft" })
    expect(replay.rows[0]?.result).toMatchObject({ application_id: accepted.rows[0]?.result.application_id, replayed: true })
    expect((await db.query<{ count: number }>("select count(*)::integer as count from public.applications where job_id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2'")).rows[0]?.count).toBe(1)
    await expect(db.query("select public.decide_job('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', 'skipped')"))
      .rejects.toThrow(/immutable/)
    await db.exec("reset role")
  })
})
