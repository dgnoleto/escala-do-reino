-- Somente leitura apos aplicar 005_get_my_church_access.sql.
-- Esperado: todas as colunas true. Nao altera dados nem permissoes.
with endpoint as (
  select to_regprocedure('public.get_my_church_access()') as oid
)
select
  e.oid is not null as function_exists,
  coalesce((select p.prosecdef and p.pronargs = 0
            from pg_catalog.pg_proc p where p.oid = e.oid), false)
    as security_definer_without_parameters,
  coalesce((select p.proconfig @> array['search_path=""']
                   or p.proconfig @> array['search_path=']
            from pg_catalog.pg_proc p where p.oid = e.oid), false)
    as empty_search_path,
  coalesce(has_function_privilege('authenticated', e.oid, 'EXECUTE'), false)
    as authenticated_has_execute,
  coalesce(not has_function_privilege('anon', e.oid, 'EXECUTE'), false)
    as anon_has_no_execute,
  coalesce(not has_function_privilege('service_role', e.oid, 'EXECUTE'), false)
    as service_role_has_no_execute,
  e.oid is not null and not exists (
    select 1 from pg_catalog.pg_proc p,
      lateral pg_catalog.aclexplode(
        coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
      ) a
    where p.oid = e.oid and a.grantee = 0 and a.privilege_type = 'EXECUTE'
  ) as public_has_no_execute,
  not exists (
    select 1 from unnest(array['anon', 'authenticated', 'service_role']) r(role_name)
    where has_schema_privilege(r.role_name, 'app_private', 'USAGE,CREATE')
      or exists (
        select 1 from pg_catalog.pg_class c
        join pg_catalog.pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'app_private' and c.relkind = 'r'
          and has_table_privilege(r.role_name, c.oid,
            'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      )
  ) as private_access_still_blocked,
  (select count(*) = 6 and bool_and(c.relrowsecurity)
   from pg_catalog.pg_class c
   join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'app_private' and c.relkind = 'r'
     and c.relname in ('churches', 'members', 'church_access',
       'access_invitations', 'access_requests', 'audit_entries'))
    as original_tables_have_rls
from endpoint e;
