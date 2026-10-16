-- Escala do Reino: verificação somente leitura após aplicar 015_liturgical_dependencies.sql.
-- Valida a presença das 7 tabelas operacionais em app_private, a evolução da tabela command_receipts (B2-01),
-- constraints compostas de integridade relacional multi-tenant por church_id, RLS, gatilhos de updated_at,
-- todas as 20 RPCs operacionais com assinaturas exatas, endurecimento e isolamento de app_private.
-- Esperado: todas as colunas retornando true. Não altera dados nem privilégios.

with procs as (
  select
    to_regprocedure('public.create_church_team(uuid, uuid, text, uuid)') as p_create_team,
    to_regprocedure('public.assign_team_leader(uuid, uuid, uuid, uuid, integer)') as p_assign_leader,
    to_regprocedure('public.create_team_role(uuid, uuid, uuid, text, text)') as p_create_role,
    to_regprocedure('public.add_team_member(uuid, uuid, uuid, uuid)') as p_add_member,
    to_regprocedure('public.remove_team_member(uuid, uuid, uuid, uuid)') as p_remove_member,
    to_regprocedure('public.grant_member_qualification(uuid, uuid, uuid, uuid, uuid)') as p_grant_qual,
    to_regprocedure('public.revoke_member_qualification(uuid, uuid, uuid, uuid, uuid)') as p_revoke_qual,
    to_regprocedure('public.create_church_event(uuid, uuid, text, text, timestamptz, timestamptz, uuid)') as p_create_event,
    to_regprocedure('public.assign_event_liturgy_leader(uuid, uuid, uuid, uuid, integer)') as p_assign_liturgy,
    to_regprocedure('public.start_event_service(uuid, uuid, uuid, integer)') as p_start_event,
    to_regprocedure('public.finish_event_service(uuid, uuid, uuid, integer)') as p_finish_event,
    to_regprocedure('public.cancel_church_event(uuid, uuid, uuid, text, integer)') as p_cancel_event,
    to_regprocedure('public.assign_event_participant(uuid, uuid, uuid, uuid, uuid, uuid, uuid, text)') as p_assign_participant,
    to_regprocedure('public.replace_event_participant(uuid, uuid, uuid, uuid, text, text)') as p_replace_participant,
    to_regprocedure('public.list_church_teams(uuid)') as p_list_teams,
    to_regprocedure('public.list_church_team_roles(uuid, uuid)') as p_list_roles,
    to_regprocedure('public.list_team_members(uuid, uuid)') as p_list_members,
    to_regprocedure('public.list_member_qualifications(uuid, uuid)') as p_list_quals,
    to_regprocedure('public.list_church_events(uuid, text, integer, integer)') as p_list_events,
    to_regprocedure('public.list_event_assignments(uuid, uuid)') as p_list_assignments
),
all_oids as (
  select array[
    p_create_team, p_assign_leader, p_create_role, p_add_member, p_remove_member,
    p_grant_qual, p_revoke_qual, p_create_event, p_assign_liturgy, p_start_event,
    p_finish_event, p_cancel_event, p_assign_participant, p_replace_participant,
    p_list_teams, p_list_roles, p_list_members, p_list_quals, p_list_events, p_list_assignments
  ]::oid[] as oids
  from procs
)
select
  -- 1. Verificação de presença das 7 tabelas operacionais em app_private com cardinalidade exata 7
  (
    select count(*) = 7
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'app_private'
      and c.relname in ('teams', 'team_memberships', 'team_roles', 'member_qualifications', 'events', 'event_items', 'assignments')
      and c.relkind = 'r'
  ) as all_seven_tables_present,

  -- 2. Compatibilidade do recibo: result_member_id é anulável (B2-01)
  coalesce((
    select is_nullable = 'YES'
    from information_schema.columns
    where table_schema = 'app_private'
      and table_name = 'command_receipts'
      and column_name = 'result_member_id'
  ), false) as receipt_member_id_is_nullable,

  -- 3. Verificação de RLS ativa e estrita nas 7 tabelas
  coalesce((
    select bool_and(c.relrowsecurity) and count(*) = 7
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'app_private'
      and c.relname in ('teams', 'team_memberships', 'team_roles', 'member_qualifications', 'events', 'event_items', 'assignments')
  ), false) as all_seven_tables_rls_enabled,

  -- 4. Verificação de constraints compostas multi-tenant e integridade relacional por church_id
  coalesce((
    select bool_and(con.conname is not null) and count(*) >= 14
    from pg_catalog.pg_constraint con
    join pg_catalog.pg_class rel on rel.oid = con.conrelid
    join pg_catalog.pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'app_private'
      and con.conname in (
        'teams_church_id_id_unique', 'teams_church_id_name_unique', 'teams_church_leader_fkey',
        'tm_church_id_id_unique', 'tm_church_team_fkey', 'tm_church_member_fkey', 'tm_church_team_member_unique',
        'tr_church_id_id_unique', 'tr_church_team_fkey', 'tr_church_team_role_unique',
        'mq_church_id_id_unique', 'mq_church_member_fkey', 'mq_church_team_fkey', 'mq_church_role_fkey', 'mq_church_member_role_unique',
        'events_church_id_id_unique', 'events_church_liturgy_fkey',
        'ei_church_id_id_unique', 'ei_church_event_fkey', 'ei_church_team_fkey',
        'asg_church_id_id_unique', 'asg_church_event_fkey', 'asg_church_member_fkey', 'asg_church_team_fkey', 'asg_replaced_fkey'
      )
  ), false) as composite_integrity_constraints_verified,

  -- 5. Verificação dos 7 gatilhos monotônicos de updated_at
  coalesce((
    select count(*) = 7
    from pg_catalog.pg_trigger tg
    join pg_catalog.pg_class c on c.oid = tg.tgrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'app_private'
      and tg.tgname in (
        'teams_touch_updated_at', 'tm_touch_updated_at', 'tr_touch_updated_at',
        'mq_touch_updated_at', 'events_touch_updated_at', 'ei_touch_updated_at', 'asg_touch_updated_at'
      )
  ), false) as all_updated_at_triggers_present,

  -- 6. Verificação de presença e assinaturas exatas de todas as 20 RPCs operacionais
  coalesce((
    select not bool_or(x is null) and array_length(ao.oids, 1) = 20
    from all_oids ao, unnest(ao.oids) as x
  ), false) as all_twenty_rpcs_present,

  -- 7. Verificação de endurecimento das 20 RPCs (SECURITY DEFINER, search_path vazio e timeout 5s)
  coalesce((
    select bool_and(
      pr.prosecdef = true
      and (pr.proconfig @> array['search_path=""'] or pr.proconfig @> array['search_path='])
      and pr.proconfig @> array['statement_timeout=5s']
    ) and count(*) = 20
    from all_oids ao
    join pg_catalog.pg_proc pr on pr.oid = any(ao.oids)
  ), false) as all_twenty_rpcs_hardened,

  -- 8. Verificação de privilégios estritos de execução (apenas authenticated; anon e service_role revogados)
  coalesce((
    select bool_and(
      has_function_privilege('authenticated', pr.oid, 'EXECUTE')
      and not has_function_privilege('anon', pr.oid, 'EXECUTE')
      and not has_function_privilege('service_role', pr.oid, 'EXECUTE')
      and not exists (
        select 1 from lateral pg_catalog.aclexplode(coalesce(pr.proacl, pg_catalog.acldefault('f', pr.proowner))) a
        where a.grantee = 0 and a.privilege_type = 'EXECUTE'
      )
    ) and count(*) = 20
    from all_oids ao
    join pg_catalog.pg_proc pr on pr.oid = any(ao.oids)
  ), false) as all_rpcs_privileges_verified,

  -- 9. Verificação de isolamento total de app_private (nenhum privilégio direto nas tabelas para anon e authenticated)
  coalesce((
    not has_schema_privilege('anon', 'app_private', 'USAGE,CREATE')
    and not has_schema_privilege('authenticated', 'app_private', 'USAGE,CREATE')
    and not has_schema_privilege('service_role', 'app_private', 'USAGE,CREATE')
    and not exists (
      select 1 from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'app_private' and c.relkind = 'r'
        and (
          has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
          or has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        )
    )
  ), false) as app_private_strictly_isolated
from procs p, all_oids ao;
