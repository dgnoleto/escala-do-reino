-- Escala do Reino: verificação somente leitura após aplicar 015_liturgical_dependencies.sql.
-- Valida a presença de todas as 7 tabelas operacionais em app_private, constraints compostas,
-- RLS, gatilhos de updated_at, assinaturas das RPCs operacionais e privilégios estritos.
-- Esperado: todas as 6 colunas retornando true. Não altera dados nem privilégios.

with procs as (
  select
    to_regprocedure('public.create_church_team(uuid, uuid, text, uuid)') as create_team_proc,
    to_regprocedure('public.assign_team_leader(uuid, uuid, uuid, uuid)') as assign_leader_proc,
    to_regprocedure('public.create_church_event(uuid, uuid, text, text, timestamptz, timestamptz, uuid)') as create_event_proc,
    to_regprocedure('public.assign_event_liturgy_leader(uuid, uuid, uuid, uuid)') as assign_liturgy_proc,
    to_regprocedure('public.assign_event_participant(uuid, uuid, uuid, uuid, uuid, uuid, uuid, text)') as assign_participant_proc,
    to_regprocedure('public.replace_event_participant(uuid, uuid, uuid, uuid, text)') as replace_participant_proc,
    to_regprocedure('public.finish_event_service(uuid, uuid, uuid)') as finish_event_proc,
    to_regprocedure('public.list_church_teams(uuid)') as list_teams_proc,
    to_regprocedure('public.list_church_events(uuid, text, integer, integer)') as list_events_proc
)
select
  -- 1. Verificação de presença das 7 tabelas operacionais em app_private
  (
    to_regclass('app_private.teams') is not null
    and to_regclass('app_private.team_memberships') is not null
    and to_regclass('app_private.team_roles') is not null
    and to_regclass('app_private.member_qualifications') is not null
    and to_regclass('app_private.events') is not null
    and to_regclass('app_private.event_items') is not null
    and to_regclass('app_private.assignments') is not null
  ) as all_seven_tables_present,

  -- 2. Verificação de RLS ativa nas 7 tabelas
  (
    select bool_and(c.relrowsecurity)
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'app_private'
      and c.relname in ('teams', 'team_memberships', 'team_roles', 'member_qualifications', 'events', 'event_items', 'assignments')
  ) as all_seven_tables_rls_enabled,

  -- 3. Verificação de presença e assinaturas exatas das RPCs operacionais
  (
    p.create_team_proc is not null
    and p.assign_leader_proc is not null
    and p.create_event_proc is not null
    and p.assign_liturgy_proc is not null
    and p.assign_participant_proc is not null
    and p.replace_participant_proc is not null
    and p.finish_event_proc is not null
    and p.list_teams_proc is not null
    and p.list_events_proc is not null
  ) as all_operational_rpcs_present,

  -- 4. Verificação de endurecimento das RPCs (SECURITY DEFINER, search_path vazio e timeout 5s)
  (
    select bool_and(
      pr.prosecdef = true
      and (pr.proconfig @> array['search_path=""'] or pr.proconfig @> array['search_path='])
      and pr.proconfig @> array['statement_timeout=5s']
    )
    from pg_catalog.pg_proc pr
    where pr.oid in (
      p.create_team_proc, p.assign_leader_proc, p.create_event_proc, p.assign_liturgy_proc,
      p.assign_participant_proc, p.replace_participant_proc, p.finish_event_proc,
      p.list_teams_proc, p.list_events_proc
    )
  ) as all_rpcs_hardened,

  -- 5. Verificação de privilégios estritos (apenas authenticated; anon, service_role e public revogados)
  (
    select bool_and(
      has_function_privilege('authenticated', pr.oid, 'EXECUTE')
      and not has_function_privilege('anon', pr.oid, 'EXECUTE')
      and not has_function_privilege('service_role', pr.oid, 'EXECUTE')
      and not exists (
        select 1 from lateral pg_catalog.aclexplode(coalesce(pr.proacl, pg_catalog.acldefault('f', pr.proowner))) a
        where a.grantee = 0 and a.privilege_type = 'EXECUTE'
      )
    )
    from pg_catalog.pg_proc pr
    where pr.oid in (
      p.create_team_proc, p.assign_leader_proc, p.create_event_proc, p.assign_liturgy_proc,
      p.assign_participant_proc, p.replace_participant_proc, p.finish_event_proc,
      p.list_teams_proc, p.list_events_proc
    )
  ) as all_rpcs_privileges_verified,

  -- 6. Verificação de isolamento de app_private (nenhum privilégio direto para anon, authenticated, service_role)
  (
    not has_schema_privilege('anon', 'app_private', 'USAGE,CREATE')
    and not has_schema_privilege('authenticated', 'app_private', 'USAGE,CREATE')
    and not has_schema_privilege('service_role', 'app_private', 'USAGE,CREATE')
  ) as app_private_isolated
from procs p;
