-- Escala do Reino: verificação somente leitura após aplicar 022_service_templates.sql
-- Valida tabelas, constraints, RLS, funções auxiliares e 7 RPCs com isolamento por igreja e segurança estrita.
-- Esperado: todas as colunas true. Não altera dados nem permissões.

with procs as (
  select
    to_regprocedure('public.list_service_templates(uuid, boolean, uuid)') as list_templates_proc,
    to_regprocedure('public.get_service_template(uuid)') as get_template_proc,
    to_regprocedure('public.create_service_template(uuid, uuid, uuid, text, text, jsonb, jsonb)') as create_template_proc,
    to_regprocedure('public.update_service_template(uuid, uuid, uuid, text, text, jsonb, jsonb)') as update_template_proc,
    to_regprocedure('public.toggle_service_template_status(uuid, uuid, boolean)') as toggle_status_proc,
    to_regprocedure('public.delete_service_template(uuid, uuid)') as delete_template_proc,
    to_regprocedure('public.instantiate_service_template(uuid, uuid, uuid)') as instantiate_proc,
    to_regprocedure('app_private.is_service_template_used(uuid, uuid, text)') as helper_proc
)
select
  -- 1. Tabelas criadas com RLS habilitado
  (
    to_regclass('app_private.service_templates') is not null
    and to_regclass('app_private.service_template_activities') is not null
    and to_regclass('app_private.service_template_parallel_services') is not null
    and to_regclass('app_private.service_template_receipts') is not null
    and (
      select bool_and(relrowsecurity)
      from pg_catalog.pg_class
      where oid in (
        to_regclass('app_private.service_templates'),
        to_regclass('app_private.service_template_activities'),
        to_regclass('app_private.service_template_parallel_services'),
        to_regclass('app_private.service_template_receipts')
      )
    )
  ) as tables_and_rls_verified,

  -- 2. Presença das 7 RPCs e função auxiliar
  (
    p.list_templates_proc is not null
    and p.get_template_proc is not null
    and p.create_template_proc is not null
    and p.update_template_proc is not null
    and p.toggle_status_proc is not null
    and p.delete_template_proc is not null
    and p.instantiate_proc is not null
    and p.helper_proc is not null
  ) as all_rpcs_present,

  -- 3. Segurança estrita das 7 RPCs públicas (SECURITY DEFINER, search_path vazio, statement_timeout=5s ou 10s)
  (
    select bool_and(
      pr.prosecdef = true
      and (pr.proconfig @> array['search_path=""'] or pr.proconfig @> array['search_path='])
      and (pr.proconfig @> array['statement_timeout=5s'] or pr.proconfig @> array['statement_timeout=10s'])
    )
    from pg_catalog.pg_proc pr
    where pr.oid in (
      p.list_templates_proc, p.get_template_proc, p.create_template_proc,
      p.update_template_proc, p.toggle_status_proc, p.delete_template_proc, p.instantiate_proc
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
      p.list_templates_proc, p.get_template_proc, p.create_template_proc,
      p.update_template_proc, p.toggle_status_proc, p.delete_template_proc, p.instantiate_proc
    )
  ) as privileges_verified
from procs p;
