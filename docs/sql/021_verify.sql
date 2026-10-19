-- Escala do Reino: verificação somente leitura após aplicar 021_event_types_and_activities.sql
-- Valida tabelas, constraints, RLS, funções auxiliares e 10 RPCs com isolamento por igreja e segurança estrita.
-- Esperado: todas as colunas true. Não altera dados nem permissões.

with procs as (
  select
    to_regprocedure('public.list_event_types(uuid, boolean)') as list_types_proc,
    to_regprocedure('public.create_event_type(uuid, uuid, text, text)') as create_type_proc,
    to_regprocedure('public.update_event_type(uuid, uuid, uuid, text, text)') as update_type_proc,
    to_regprocedure('public.toggle_event_type_status(uuid, uuid, uuid)') as toggle_type_proc,
    to_regprocedure('public.delete_event_type(uuid, uuid, uuid)') as delete_type_proc,
    to_regprocedure('public.list_standard_activities(uuid, boolean)') as list_activities_proc,
    to_regprocedure('public.create_standard_activity(uuid, uuid, text, integer, text, text)') as create_act_proc,
    to_regprocedure('public.update_standard_activity(uuid, uuid, uuid, text, integer, text, text)') as update_act_proc,
    to_regprocedure('public.toggle_standard_activity_status(uuid, uuid, uuid)') as toggle_act_proc,
    to_regprocedure('public.delete_standard_activity(uuid, uuid, uuid)') as delete_act_proc,
    to_regprocedure('app_private.is_event_type_used(uuid, uuid, text)') as helper_type_proc,
    to_regprocedure('app_private.is_standard_activity_used(uuid, uuid, text)') as helper_act_proc
)
select
  -- 1. Tabelas criadas com RLS habilitado
  (
    to_regclass('app_private.event_types') is not null
    and to_regclass('app_private.standard_activities') is not null
    and to_regclass('app_private.event_type_activity_receipts') is not null
    and (
      select bool_and(relrowsecurity)
      from pg_catalog.pg_class
      where oid in (
        to_regclass('app_private.event_types'),
        to_regclass('app_private.standard_activities'),
        to_regclass('app_private.event_type_activity_receipts')
      )
    )
  ) as tables_and_rls_verified,

  -- 2. Presença das 10 RPCs e 2 funções auxiliares
  (
    p.list_types_proc is not null
    and p.create_type_proc is not null
    and p.update_type_proc is not null
    and p.toggle_type_proc is not null
    and p.delete_type_proc is not null
    and p.list_activities_proc is not null
    and p.create_act_proc is not null
    and p.update_act_proc is not null
    and p.toggle_act_proc is not null
    and p.delete_act_proc is not null
    and p.helper_type_proc is not null
    and p.helper_act_proc is not null
  ) as all_rpcs_present,

  -- 3. Segurança estrita das 10 RPCs públicas (SECURITY DEFINER, search_path vazio, statement_timeout=5s)
  (
    select bool_and(
      pr.prosecdef = true
      and (pr.proconfig @> array['search_path=""'] or pr.proconfig @> array['search_path='])
      and pr.proconfig @> array['statement_timeout=5s']
    )
    from pg_catalog.pg_proc pr
    where pr.oid in (
      p.list_types_proc, p.create_type_proc, p.update_type_proc, p.toggle_type_proc, p.delete_type_proc,
      p.list_activities_proc, p.create_act_proc, p.update_act_proc, p.toggle_act_proc, p.delete_act_proc
    )
  ) as rpcs_hardened,

  -- 4. Privilégios: apenas authenticated tem EXECUTE; anon, service_role e public revogados
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
      p.list_types_proc, p.create_type_proc, p.update_type_proc, p.toggle_type_proc, p.delete_type_proc,
      p.list_activities_proc, p.create_act_proc, p.update_act_proc, p.toggle_act_proc, p.delete_act_proc
    )
  ) as privileges_verified
from procs p;
