import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20261019000000_core_schema.sql"),
  "utf8",
)

describe("core migration PostgreSQL compatibility smoke test", () => {
  const db = new PGlite()

  beforeAll(async () => {
    await db.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin bypassrls;
      create schema auth;
      create schema storage;
      grant usage on schema public, auth, storage to anon, authenticated, service_role;

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
    await db.exec(migration)
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
    expect(result.rows[0]?.count).toBe(25)
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
})
