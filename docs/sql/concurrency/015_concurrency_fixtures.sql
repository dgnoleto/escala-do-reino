-- Fixtures compartilhadas: banco vazio, criado e marcado para esta execução.
\set ON_ERROR_STOP on
\ir 015_concurrency_guard.sql
begin;
do $collision$
begin
  if exists(select 1 from auth.users) or exists(select 1 from app_private.churches)
     or exists(select 1 from app_private.audit_entries) or exists(select 1 from app_private.command_receipts) then
    raise exception 'Base de prova deve começar sem identidades, igrejas, auditoria ou recibos; não limpar por DML.';
  end if;
end
$collision$;
do $setup_fixtures$
declare
  v_church_id uuid := '01500000-0000-4000-8000-000000000001'::uuid;
  v_admin_user_id uuid := '01500000-0000-4000-8000-000000000002'::uuid;
  v_leader_user_id uuid := '01500000-0000-4000-8000-000000000003'::uuid;
  v_vol1_user_id uuid := '01500000-0000-4000-8000-000000000004'::uuid;
  v_vol2_user_id uuid := '01500000-0000-4000-8000-000000000005'::uuid;
  v_vol3_user_id uuid := '01500000-0000-4000-8000-000000000006'::uuid;

  v_admin_member_id uuid := '01500000-0000-4000-8000-000000000012'::uuid;
  v_leader_member_id uuid := '01500000-0000-4000-8000-000000000013'::uuid;
  v_vol1_member_id uuid := '01500000-0000-4000-8000-000000000014'::uuid;
  v_vol2_member_id uuid := '01500000-0000-4000-8000-000000000015'::uuid;
  v_vol3_member_id uuid := '01500000-0000-4000-8000-000000000016'::uuid;

  v_team_id uuid := '01500000-0000-4000-8000-000000000020'::uuid;
  v_role_id uuid := '01500000-0000-4000-8000-000000000021'::uuid;
  v_event_id uuid := '01500000-0000-4000-8000-000000000030'::uuid;
  v_item_id uuid := '01500000-0000-4000-8000-000000000031'::uuid;
  v_asg_id uuid := '01500000-0000-4000-8000-000000000040'::uuid;
begin
  -- Inserir igreja
  insert into app_private.churches (id, name, timezone, default_duration_policy, status)
  values (v_church_id, 'Igreja Concorrência 015', 'America/Sao_Paulo', 'warn', 'active');

  -- Inserir usuários auth
  insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    (v_admin_user_id, 'admin_015@rehearsal.test', clock_timestamp(), '{"provider":"email"}'::jsonb, '{}'::jsonb, clock_timestamp(), clock_timestamp()),
    (v_leader_user_id, 'leader_015@rehearsal.test', clock_timestamp(), '{"provider":"email"}'::jsonb, '{}'::jsonb, clock_timestamp(), clock_timestamp()),
    (v_vol1_user_id, 'vol1_015@rehearsal.test', clock_timestamp(), '{"provider":"email"}'::jsonb, '{}'::jsonb, clock_timestamp(), clock_timestamp()),
    (v_vol2_user_id, 'vol2_015@rehearsal.test', clock_timestamp(), '{"provider":"email"}'::jsonb, '{}'::jsonb, clock_timestamp(), clock_timestamp()),
    (v_vol3_user_id, 'vol3_015@rehearsal.test', clock_timestamp(), '{"provider":"email"}'::jsonb, '{}'::jsonb, clock_timestamp(), clock_timestamp());

  -- Inserir membros
  insert into app_private.members (id, church_id, display_name, status, created_by_user_id)
  values
    (v_admin_member_id, v_church_id, 'Pr Marcos (Admin 015)', 'active', v_admin_user_id),
    (v_leader_member_id, v_church_id, 'Líder Louvor (015)', 'active', v_admin_user_id),
    (v_vol1_member_id, v_church_id, 'Voluntário Titular 1', 'active', v_admin_user_id),
    (v_vol2_member_id, v_church_id, 'Voluntário Substituto A', 'active', v_admin_user_id),
    (v_vol3_member_id, v_church_id, 'Voluntário Substituto B', 'active', v_admin_user_id);

  -- Inserir church_access
  insert into app_private.church_access (church_id, user_id, member_id, is_admin, status, onboarding_completed_at, granted_by_user_id)
  values
    (v_church_id, v_admin_user_id, v_admin_member_id, true, 'active', clock_timestamp(), v_admin_user_id),
    (v_church_id, v_leader_user_id, v_leader_member_id, false, 'active', clock_timestamp(), v_admin_user_id),
    (v_church_id, v_vol1_user_id, v_vol1_member_id, false, 'active', clock_timestamp(), v_admin_user_id),
    (v_church_id, v_vol2_user_id, v_vol2_member_id, false, 'active', clock_timestamp(), v_admin_user_id),
    (v_church_id, v_vol3_user_id, v_vol3_member_id, false, 'active', clock_timestamp(), v_admin_user_id);

  -- Inserir equipe e função técnica
  insert into app_private.teams (id, church_id, name, leader_member_id, status, version)
  values (v_team_id, v_church_id, 'Louvor Concorrência 015', v_leader_member_id, 'active', 1);

  insert into app_private.team_roles (id, church_id, team_id, name, description, status)
  values (v_role_id, v_church_id, v_team_id, 'Vocal Solo', 'Canto', 'active');

  -- Inserir memberships
  insert into app_private.team_memberships (church_id, team_id, member_id, status)
  values
    (v_church_id, v_team_id, v_leader_member_id, 'active'),
    (v_church_id, v_team_id, v_vol1_member_id, 'active'),
    (v_church_id, v_team_id, v_vol2_member_id, 'active'),
    (v_church_id, v_team_id, v_vol3_member_id, 'active');

  -- Homologar aptidões de todos os voluntários para a função técnica
  insert into app_private.member_qualifications (church_id, member_id, team_id, team_role_id, status)
  values
    (v_church_id, v_vol1_member_id, v_team_id, v_role_id, 'active'),
    (v_church_id, v_vol2_member_id, v_team_id, v_role_id, 'active'),
    (v_church_id, v_vol3_member_id, v_team_id, v_role_id, 'active');

  -- Inserir evento com timezone herdado e item pendente
  insert into app_private.events (id, church_id, title, event_type, timezone, status, planned_start_at, planned_end_at, liturgy_leader_member_id, version)
  values (v_event_id, v_church_id, 'Culto Concorrência 015', 'culto', 'America/Sao_Paulo', 'scheduled', clock_timestamp() + interval '1 day', clock_timestamp() + interval '1 day 2 hours', v_admin_member_id, 1);

  insert into app_private.event_items (id, church_id, event_id, title, sequence_order, planned_duration_seconds, status, designated_team_id)
  values (v_item_id, v_church_id, v_event_id, 'Momento de Louvor', 1, 900, 'pending', v_team_id);

  -- Inserir alocação ativa inicial do Voluntário 1
  insert into app_private.assignments (id, church_id, event_id, item_id, team_id, team_role_id, member_id, status)
  values (v_asg_id, v_church_id, v_event_id, v_item_id, v_team_id, v_role_id, v_vol1_member_id, 'active');
end
$setup_fixtures$;
commit;
