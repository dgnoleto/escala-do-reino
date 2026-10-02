-- Somente leitura: verificar após aplicar 001_initial_access_structure.sql.
-- Esperado: quatro linhas; rls_enabled = true; acesso de cada papel = false.
select
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  (
    has_schema_privilege('anon', n.oid, 'USAGE')
    or has_table_privilege('anon', c.oid, 'SELECT')
    or has_table_privilege('anon', c.oid, 'INSERT')
    or has_table_privilege('anon', c.oid, 'UPDATE')
    or has_table_privilege('anon', c.oid, 'DELETE')
  ) as anon_has_privileges,
  (
    has_schema_privilege('authenticated', n.oid, 'USAGE')
    or has_table_privilege('authenticated', c.oid, 'SELECT')
    or has_table_privilege('authenticated', c.oid, 'INSERT')
    or has_table_privilege('authenticated', c.oid, 'UPDATE')
    or has_table_privilege('authenticated', c.oid, 'DELETE')
  ) as authenticated_has_privileges,
  (
    has_schema_privilege('service_role', n.oid, 'USAGE')
    or has_table_privilege('service_role', c.oid, 'SELECT')
    or has_table_privilege('service_role', c.oid, 'INSERT')
    or has_table_privilege('service_role', c.oid, 'UPDATE')
    or has_table_privilege('service_role', c.oid, 'DELETE')
  ) as service_role_has_privileges
from pg_catalog.pg_class as c
join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
where n.nspname = 'app_private' and c.relkind = 'r'
order by c.relname;
