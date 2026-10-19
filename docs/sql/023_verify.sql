-- Escala do Reino: verificação somente leitura após aplicar 023_event_planning_and_durations.sql
-- Valida colunas estendidas em events, tabela de recibos, RLS e 5 RPCs com isolamento e segurança estrita.
-- Esperado: todas as colunas true. Não altera dados nem permissões.

with procs as (
  select
    to_regprocedure('public.create_church_event_edition(uuid, uuid, text, text, timestamptz, timestamptz, uuid, text)') as create_edition_proc,
    to_regprocedure('public.reorder_event_items(uuid, uuid, uuid, uuid[])') as reorder_items_proc,
    to_regprocedure('public.set_event_duration_policy(uuid, uuid, uuid, text)') as set_policy_proc,
    to_regprocedure('public.publish_event_program(uuid, uuid, uuid)') as publish_proc,
    to_regprocedure('public.save_event_program_draft(uuid, uuid, uuid)') as save_draft_proc
)
select
  -- 1. Colunas estendidas em app_private.events
  (
    exists (
      select 1 from information_schema.columns
      where table_schema = 'app_private' and table_name = 'events' and column_name = 'duration_policy'
    )
    and exists (
      select 1 from information_schema.columns
      where table_schema = 'app_private' and table_name = 'events' and column_name = 'program_status'
    )
    and exists (
      select 1 from information_schema.columns
      where table_schema = 'app_private' and table_name = 'events' and column_name = 'program_version'
    )
    and exists (
      select 1 from information_schema.columns
      where table_schema = 'app_private' and table_name = 'events' and column_name = 'published_at'
    )
    and exists (
      select 1 from information_schema.columns
      where table_schema = 'app_private' and table_name = 'events' and column_name = 'published_by_member_id'
    )
  ) as events_columns_verified,

  -- 2. Tabela de recibos com RLS habilitado
  (
    to_regclass('app_private.event_planning_receipts') is not null
    and (
      select relrowsecurity
      from pg_catalog.pg_class
      where oid = to_regclass('app_private.event_planning_receipts')
    )
  ) as receipts_table_and_rls_verified,

  -- 3. Presença das 5 RPCs públicas
  (
    p.create_edition_proc is not null
    and p.reorder_items_proc is not null
    and p.set_policy_proc is not null
    and p.publish_proc is not null
    and p.save_draft_proc is not null
  ) as all_rpcs_present,

  -- 4. Segurança estrita das 5 RPCs públicas (SECURITY DEFINER, search_path vazio, statement_timeout=5s)
  (
    select bool_and(
      pr.prosecdef = true
      and (pr.proconfig @> array['search_path=""'] or pr.proconfig @> array['search_path='])
      and pr.proconfig @> array['statement_timeout=5s']
    )
    from pg_catalog.pg_proc pr
    where pr.oid in (
      p.create_edition_proc, p.reorder_items_proc, p.set_policy_proc,
      p.publish_proc, p.save_draft_proc
    )
  ) as rpcs_hardened,

  -- 5. Privilégios: apenas authenticated tem EXECUTE; anon, service_role e public revogados
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
      p.create_edition_proc, p.reorder_items_proc, p.set_policy_proc,
      p.publish_proc, p.save_draft_proc
    )
  ) as privileges_verified
from procs p;
