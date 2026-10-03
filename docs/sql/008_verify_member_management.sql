-- Escala do Reino: verificação somente leitura após aplicar 007_member_management.sql.
-- Esperado: todas as colunas true. Não altera dados nem permissões.
with procs as (
  select
    to_regprocedure('public.list_church_members(uuid, integer, integer)') as list_proc,
    to_regprocedure('public.create_church_member(uuid, uuid, text)') as create_proc,
    to_regprocedure('public.get_create_member_receipt(uuid, uuid)') as receipt_proc
)
select
  to_regclass('app_private.command_receipts') is not null as command_receipts_table_exists,

  coalesce((
    select c.relrowsecurity
    from pg_catalog.pg_class c
    where c.oid = to_regclass('app_private.command_receipts')
  ), false) as command_receipts_has_rls,

  not exists (
    select 1
    from unnest(array['anon', 'authenticated', 'service_role']) r(role_name)
    where has_table_privilege(
      r.role_name,
      'app_private.command_receipts',
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
    )
  ) as command_receipts_no_direct_access,

  -- Verificação do endpoint list_church_members
  p.list_proc is not null
    and (select prosecdef from pg_catalog.pg_proc where oid = p.list_proc)
    and (select proconfig @> array['search_path=""'] or proconfig @> array['search_path='] from pg_catalog.pg_proc where oid = p.list_proc)
    and has_function_privilege('authenticated', p.list_proc, 'EXECUTE')
    and not has_function_privilege('anon', p.list_proc, 'EXECUTE')
    and not has_function_privilege('service_role', p.list_proc, 'EXECUTE')
    and not exists (
      select 1 from pg_catalog.pg_proc pr, lateral pg_catalog.aclexplode(coalesce(pr.proacl, pg_catalog.acldefault('f', pr.proowner))) a
      where pr.oid = p.list_proc and a.grantee = 0 and a.privilege_type = 'EXECUTE'
    ) as list_church_members_secure,

  -- Verificação do endpoint create_church_member
  p.create_proc is not null
    and (select prosecdef from pg_catalog.pg_proc where oid = p.create_proc)
    and (select proconfig @> array['search_path=""'] or proconfig @> array['search_path='] from pg_catalog.pg_proc where oid = p.create_proc)
    and has_function_privilege('authenticated', p.create_proc, 'EXECUTE')
    and not has_function_privilege('anon', p.create_proc, 'EXECUTE')
    and not has_function_privilege('service_role', p.create_proc, 'EXECUTE')
    and not exists (
      select 1 from pg_catalog.pg_proc pr, lateral pg_catalog.aclexplode(coalesce(pr.proacl, pg_catalog.acldefault('f', pr.proowner))) a
      where pr.oid = p.create_proc and a.grantee = 0 and a.privilege_type = 'EXECUTE'
    ) as create_church_member_secure,

  -- Verificação do endpoint get_create_member_receipt
  p.receipt_proc is not null
    and (select prosecdef from pg_catalog.pg_proc where oid = p.receipt_proc)
    and (select proconfig @> array['search_path=""'] or proconfig @> array['search_path='] from pg_catalog.pg_proc where oid = p.receipt_proc)
    and has_function_privilege('authenticated', p.receipt_proc, 'EXECUTE')
    and not has_function_privilege('anon', p.receipt_proc, 'EXECUTE')
    and not has_function_privilege('service_role', p.receipt_proc, 'EXECUTE')
    and not exists (
      select 1 from pg_catalog.pg_proc pr, lateral pg_catalog.aclexplode(coalesce(pr.proacl, pg_catalog.acldefault('f', pr.proowner))) a
      where pr.oid = p.receipt_proc and a.grantee = 0 and a.privilege_type = 'EXECUTE'
    ) as get_create_member_receipt_secure,

  -- Todas as 7 tabelas de app_private continuam com RLS
  (
    select count(*) = 7 and bool_and(c.relrowsecurity)
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'app_private' and c.relkind = 'r'
      and c.relname in (
        'churches', 'members', 'church_access', 'access_invitations',
        'access_requests', 'audit_entries', 'command_receipts'
      )
  ) as all_seven_private_tables_have_rls,

  -- Schema app_private continua inacessível para clientes
  not exists (
    select 1
    from unnest(array['anon', 'authenticated', 'service_role']) r(role_name)
    where has_schema_privilege(r.role_name, 'app_private', 'USAGE,CREATE')
       or exists (
         select 1 from pg_catalog.pg_class c
         join pg_catalog.pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'app_private' and c.relkind = 'r'
           and has_table_privilege(r.role_name, c.oid,
             'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
       )
  ) as private_schema_still_blocked

from procs p;
