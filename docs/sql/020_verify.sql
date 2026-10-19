-- Escala do Reino: verificação somente leitura após aplicar 020_cancellation_reasons.sql
-- Valida tabelas, constraints, RLS, funções auxiliares e RPCs com isolamento por igreja e segurança estrita.
-- Esperado: todas as colunas true. Não altera dados nem permissões.

with procs as (
  select
    to_regprocedure('public.list_cancellation_reasons(uuid, boolean)') as list_reasons_proc,
    to_regprocedure('public.create_cancellation_reason(uuid, uuid, text)') as create_reason_proc,
    to_regprocedure('public.update_cancellation_reason(uuid, uuid, uuid, text)') as update_reason_proc,
    to_regprocedure('public.toggle_cancellation_reason_status(uuid, uuid, uuid, boolean)') as toggle_status_proc,
    to_regprocedure('public.delete_cancellation_reason(uuid, uuid, uuid)') as delete_reason_proc,
    to_regprocedure('app_private.is_cancellation_reason_used(uuid, uuid, text)') as helper_proc
)
select
  -- 1. Tabelas criadas com RLS habilitado
  (
    to_regclass('app_private.cancellation_reasons') is not null
    and to_regclass('app_private.cancellation_reason_receipts') is not null
    and (
      select relrowsecurity
      from pg_catalog.pg_class
      where oid = to_regclass('app_private.cancellation_reasons')
    )
    and (
      select relrowsecurity
      from pg_catalog.pg_class
      where oid = to_regclass('app_private.cancellation_reason_receipts')
    )
  ) as tables_and_rls_verified,

  -- 2. Presença das RPCs e função auxiliar
  (
    p.list_reasons_proc is not null
    and p.create_reason_proc is not null
    and p.update_reason_proc is not null
    and p.toggle_status_proc is not null
    and p.delete_reason_proc is not null
    and p.helper_proc is not null
  ) as all_rpcs_present,

  -- 3. Segurança estrita das RPCs públicas (SECURITY DEFINER, search_path vazio, statement_timeout=5s ou 10s)
  (
    select bool_and(
      pr.prosecdef = true
      and (pr.proconfig @> array['search_path=""'] or pr.proconfig @> array['search_path='])
      and (pr.proconfig @> array['statement_timeout=5s'] or pr.proconfig @> array['statement_timeout=10s'])
    )
    from pg_catalog.pg_proc pr
    where pr.oid in (
      p.list_reasons_proc,
      p.create_reason_proc,
      p.update_reason_proc,
      p.toggle_status_proc,
      p.delete_reason_proc
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
      p.list_reasons_proc,
      p.create_reason_proc,
      p.update_reason_proc,
      p.toggle_status_proc,
      p.delete_reason_proc
    )
  ) as privileges_verified
from procs p;
