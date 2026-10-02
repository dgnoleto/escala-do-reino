-- Somente leitura após a criação permanente do incremento 003.
-- Esperado: seis linhas; RLS e duas verificações finais true;
-- privilégios de cada papel false.
select
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  (has_schema_privilege('anon', n.oid, 'USAGE,CREATE')
   or has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))
    as anon_has_privileges,
  (has_schema_privilege('authenticated', n.oid, 'USAGE,CREATE')
   or has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))
    as authenticated_has_privileges,
  (has_schema_privilege('service_role', n.oid, 'USAGE,CREATE')
   or has_table_privilege('service_role', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))
    as service_role_has_privileges,
  exists (
    select 1 from pg_catalog.pg_index i
    where i.indexrelid = to_regclass('app_private.access_invitations_one_open_per_member')
      and i.indisunique and i.indisvalid and i.indpred is not null
  ) as one_open_invitation_index_present,
  exists (
    select 1 from pg_catalog.pg_constraint k
    where k.conrelid = to_regclass('app_private.access_requests')
      and k.conname = 'requests_consumed_invitation_fk' and k.contype = 'f' and k.convalidated
  ) as consumed_invitation_fk_present
from pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'app_private' and c.relkind = 'r'
order by c.relname;
