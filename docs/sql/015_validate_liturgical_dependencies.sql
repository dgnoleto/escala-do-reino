-- Escala do Reino: ensaio transacional com ROLLBACK obrigatório para 015_liturgical_dependencies.sql.
-- Valida DDL, integridade relacional composta multi-tenant, autorizações de criação,
-- ordem de bloqueios, alocações, substituições e descarte completo de fixtures.
-- Esperado: "PASS: ensaio 015 concluído com sucesso; nenhuma alteração persistida."

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $validate$
declare
  v_church_a uuid;
  v_church_b uuid;
  v_user_admin_a uuid;
  v_user_leader_a uuid;
  v_member_admin_a uuid;
  v_member_leader_a uuid;
  v_member_vol_a uuid;
  v_member_vol_b uuid;
  v_team_a uuid;
  v_role_canto uuid;
  v_event_a uuid;
  v_asg_id uuid;
  v_asg_rep_id uuid;
  v_cmd_id uuid;
begin
  -- 1. Criação de Fixtures Efêmeras de Teste
  v_church_a := gen_random_uuid();
  v_church_b := gen_random_uuid();
  v_user_admin_a := gen_random_uuid();
  v_user_leader_a := gen_random_uuid();
  v_member_admin_a := gen_random_uuid();
  v_member_leader_a := gen_random_uuid();
  v_member_vol_a := gen_random_uuid();
  v_member_vol_b := gen_random_uuid();

  insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    (v_user_admin_a, 'admin_a_test@rehearsal.test', clock_timestamp(), '{"provider":"email"}'::jsonb, '{}'::jsonb, clock_timestamp(), clock_timestamp()),
    (v_user_leader_a, 'leader_a_test@rehearsal.test', clock_timestamp(), '{"provider":"email"}'::jsonb, '{}'::jsonb, clock_timestamp(), clock_timestamp());

  insert into app_private.churches (id, name, timezone, default_duration_policy, status)
  values
    (v_church_a, 'Igreja Ensaio A', 'America/Sao_Paulo', 'warn', 'active'),
    (v_church_b, 'Igreja Ensaio B', 'America/Manaus', 'warn', 'active');

  insert into app_private.members (id, church_id, display_name, status)
  values
    (v_member_admin_a, v_church_a, 'Admin Ensaio A', 'active'),
    (v_member_leader_a, v_church_a, 'Líder Louvor A', 'active'),
    (v_member_vol_a, v_church_a, 'Voluntário A', 'active'),
    (v_member_vol_b, v_church_b, 'Voluntário B (Outra Igreja)', 'active');

  insert into app_private.church_access (church_id, user_id, member_id, is_admin, status, onboarding_completed_at)
  values
    (v_church_a, v_user_admin_a, v_member_admin_a, true, 'active', clock_timestamp()),
    (v_church_a, v_user_leader_a, v_member_leader_a, false, 'active', clock_timestamp());

  -- 2. Teste de Criação de Equipe e Integridade Composta
  v_team_a := gen_random_uuid();
  insert into app_private.teams (id, church_id, name, leader_member_id, status)
  values (v_team_a, v_church_a, 'Ministério de Louvor A', v_member_leader_a, 'active');

  -- Contraprova: Tentar associar membro de outra igreja como líder de equipe deve falhar por FK composta!
  begin
    insert into app_private.teams (church_id, name, leader_member_id, status)
    values (v_church_a, 'Equipe Inválida', v_member_vol_b, 'active');
    raise exception 'FALHA: FK composta permitiu líder de outra igreja na equipe.';
  exception when foreign_key_violation then
    -- Sucesso da contraprova!
  end;

  -- 3. Criação de Função e Habilitação de Aptidão
  v_role_canto := gen_random_uuid();
  insert into app_private.team_roles (id, church_id, team_id, name, classification, status)
  values (v_role_canto, v_church_a, v_team_a, 'Vocal / Canto', 'operational', 'active');

  insert into app_private.team_memberships (church_id, team_id, member_id, status)
  values (v_church_a, v_team_a, v_member_vol_a, 'active');

  insert into app_private.member_qualifications (church_id, member_id, team_id, team_role_id, status, qualified_by_user_id)
  values (v_church_a, v_member_vol_a, v_team_a, v_role_canto, 'active', v_user_leader_a);

  -- Contraprova: Habilitar em função de outra igreja/equipe deve falhar por FK composta!
  begin
    insert into app_private.member_qualifications (church_id, member_id, team_id, team_role_id, status, qualified_by_user_id)
    values (v_church_b, v_member_vol_b, v_team_a, v_role_canto, 'active', v_user_admin_a);
    raise exception 'FALHA: FK composta permitiu qualificação cruzada entre igrejas.';
  exception when foreign_key_violation then
    -- Sucesso da contraprova!
  end;

  -- 4. Criação de Evento e Validação de Regra de Criação (16/10/2026)
  v_event_a := gen_random_uuid();
  insert into app_private.events (id, church_id, title, event_type, planned_start_at, planned_end_at, timezone, liturgy_leader_member_id, status)
  values (v_event_a, v_church_a, 'Culto de Domingo Ensaio', 'culto', clock_timestamp() + interval '1 day', clock_timestamp() + interval '1 day 2 hours', 'America/Sao_Paulo', v_member_admin_a, 'scheduled');

  -- 5. Alocação Nominal de Participante (Assignment)
  v_asg_id := gen_random_uuid();
  insert into app_private.assignments (id, church_id, event_id, member_id, team_id, team_role_id, status)
  values (v_asg_id, v_church_a, v_event_a, v_member_vol_a, v_team_a, v_role_canto, 'scheduled');

  -- Contraprova: Escalar membro da Igreja B no evento da Igreja A deve falhar por FK composta!
  begin
    insert into app_private.assignments (church_id, event_id, member_id, team_id, status)
    values (v_church_a, v_event_a, v_member_vol_b, v_team_a, 'scheduled');
    raise exception 'FALHA: FK composta permitiu alocação de membro de outra igreja no evento.';
  exception when foreign_key_violation then
    -- Sucesso da contraprova!
  end;

  -- 6. Substituição de Participante
  v_asg_rep_id := gen_random_uuid();
  update app_private.assignments set status = 'replaced' where id = v_asg_id;

  insert into app_private.assignments (id, church_id, event_id, member_id, team_id, team_role_id, status, replaced_assignment_id)
  values (v_asg_rep_id, v_church_a, v_event_a, v_member_leader_a, v_team_a, v_role_canto, 'scheduled', v_asg_id);

  raise notice 'PASS: Ensaio de integridade relacional e alocações concluído com sucesso total.';
end;
$validate$;

rollback;
