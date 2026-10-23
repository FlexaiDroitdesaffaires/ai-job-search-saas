begin;
create extension if not exists pgtap with schema extensions;
select plan(40);

select has_table('public', 'applications', 'applications existe');
select has_table('public', 'pilot_rate_limits', 'compteurs distribués existent');
select has_table('public', 'pilot_retention_config', 'configuration de conservation existe');
select ok((select relrowsecurity from pg_class where oid = 'public.pilot_rate_limits'::regclass), 'RLS compteurs active');
select ok((select relrowsecurity from pg_class where oid = 'public.pilot_retention_config'::regclass), 'RLS conservation active');
select ok(to_regprocedure('public.consume_pilot_rate_limit(text,text)') is not null, 'consommation atomique existe');
select ok(not has_function_privilege('authenticated', 'public.consume_pilot_rate_limit(text,text)', 'execute'), 'client ne consomme pas directement les quotas');
select has_table('public', 'application_submissions', 'journal de soumission existe');
select ok((select relrowsecurity from pg_class where oid = 'public.applications'::regclass), 'RLS applications active');
select ok((select relrowsecurity from pg_class where oid = 'public.application_submissions'::regclass), 'RLS soumissions active');
select ok(exists(select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'resumes_owner_insert'), 'politique stockage CV présente');
select has_table('public', 'application_submission_events', 'historique worker existe');
select ok((select relrowsecurity from pg_class where oid = 'public.application_submission_events'::regclass), 'RLS historique worker active');
select ok(to_regprocedure('public.enqueue_application_submission(uuid,uuid,text,text,text,text,smallint)') is not null, 'enqueue durable existe');
select ok(to_regprocedure('public.claim_application_submission(text,integer)') is not null, 'claim atomique existe');
select ok(to_regprocedure('public.finish_application_submission_attempt(uuid,text,text,text,text,jsonb,text,integer,boolean)') is not null, 'finalisation contrôlée existe');
select ok(to_regprocedure('public.finish_application_reconciliation(uuid,text,text,text,text,jsonb,text,integer,integer)') is not null, 'réconciliation durable existe');

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'one@example.test', '', now(), '{}', '{"full_name":"User One"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'two@example.test', '', now(), '{}', '{"full_name":"User Two"}', now(), now());

set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

select lives_ok($$
  insert into public.career_experiences (user_id, title, company)
  values ('11111111-1111-1111-1111-111111111111', 'Engineer', 'Example One')
$$, 'utilisateur 1 écrit ses données');

select is(
  (select count(*)::integer from public.profiles where id = '22222222-2222-2222-2222-222222222222'),
  0, 'utilisateur 1 ne lit pas le profil utilisateur 2');

select throws_ok($$
  insert into public.resumes (user_id, title, storage_path)
  values ('22222222-2222-2222-2222-222222222222', 'CV interdit', '22222222-2222-2222-2222-222222222222/cv.pdf')
$$, '42501', 'new row violates row-level security policy for table "resumes"',
  'isolation des métadonnées CV');

select lives_ok($$
  insert into storage.objects (bucket_id, name, owner_id)
  values ('resumes', '11111111-1111-1111-1111-111111111111/allowed.pdf', '11111111-1111-1111-1111-111111111111')
$$, 'utilisateur écrit dans son dossier CV');

select throws_ok($$
  insert into storage.objects (bucket_id, name, owner_id)
  values ('resumes', '22222222-2222-2222-2222-222222222222/forbidden.pdf', '11111111-1111-1111-1111-111111111111')
$$, '42501', 'new row violates row-level security policy for table "objects"',
  'utilisateur ne peut pas écrire dans le dossier CV tiers');

select throws_ok($$
  insert into public.applications (user_id, company, job_title, status)
  values ('11111111-1111-1111-1111-111111111111', 'False Claim', 'Role', 'applied')
$$, '42501', 'submission fields are server-managed',
  'applied direct sans preuve refusé');

select lives_ok($$
  insert into public.applications (id, user_id, company, job_title)
  values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', '11111111-1111-1111-1111-111111111111', 'Manual Co', 'Manual Role')
$$, 'candidature manuelle brouillon créée');

select lives_ok($$
  select public.record_manual_submission('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', now(), 'Confirmation test')
$$, 'confirmation manuelle explicite acceptée');

select is(
  (select status || ':' || prep_state || ':' || submission_method from public.applications where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'),
  'applied:submitted:manual', 'soumission manuelle cohérente');

select lives_ok($$
  insert into public.applications (id, user_id, company, job_title)
  values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2', '11111111-1111-1111-1111-111111111111', 'Adapter Co', 'Adapter Role')
$$, 'candidature adaptateur brouillon créée');

select throws_ok($$
  update public.applications set prep_state = 'approved'
  where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2'
$$, '42501', 'application approval must use approve_application_dossier',
  'approbation directe sans dossier refusée');

reset role;
set local role service_role;
update public.applications set prep_state = 'approved'
where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
create temporary table submission_result as
select public.start_application_submission(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2', 'idem-adapter-0001', 'test-adapter',
  repeat('a', 64)) as result;
select pass('premier claim adaptateur accepté');

select is(
  (public.start_application_submission(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2', 'idem-adapter-0001', 'test-adapter', repeat('a', 64)
  )->>'submission_id'),
  (select result->>'submission_id' from submission_result),
  'retry avec même clé retourne la même soumission');

select throws_ok($$
  select public.start_application_submission(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2', 'idem-adapter-0002', 'test-adapter', repeat('a', 64))
$$, 'P0001', 'application must be approved before submission',
  'claim concurrent différent refusé');

select lives_ok($$
  select public.confirm_application_submission(
    (select (result->>'submission_id')::uuid from submission_result),
    'provider-receipt-1', '{"receipt_url":"https://example.test/receipt/1"}'::jsonb)
$$, 'confirmation adaptateur acceptée');

select is(
  (select status || ':' || prep_state || ':' || submission_method from public.applications where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2'),
  'applied:submitted:adapter', 'soumission adaptateur cohérente');

select lives_ok($$
  select public.grant_credits('11111111-1111-1111-1111-111111111111', 10, 'admin_adjustment', 'test', 'grant-idem-0001')
$$, 'crédit accordé');

select is(
  (public.grant_credits('11111111-1111-1111-1111-111111111111', 10, 'admin_adjustment', 'test', 'grant-idem-0001')->>'replayed')::boolean,
  true, 'grant idempotent rejoué');

select lives_ok($$
  select public.spend_credits('11111111-1111-1111-1111-111111111111', 3, 'ai_application', 'test-app', 'spend-idem-0001')
$$, 'dépense atomique acceptée');

select throws_ok($$
  select public.spend_credits('11111111-1111-1111-1111-111111111111', 100, 'ai_application', 'test-app', 'spend-idem-0002')
$$, 'P0001', 'insufficient credits', 'solde insuffisant refusé');

set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select throws_ok($$
  update public.application_submissions set state = 'failed'
$$, '42501', 'permission denied for table application_submissions',
  'client ne modifie pas le journal serveur');

select throws_ok($$
  select * from public.app_resource_ownership
$$, '42501', 'permission denied for table app_resource_ownership',
  'registre de propriété invisible au client');

select is(
  (select count(*)::integer from public.application_submissions where user_id = '22222222-2222-2222-2222-222222222222'),
  0, 'RLS masque les soumissions des autres utilisateurs');

reset role;
select * from finish();
rollback;
