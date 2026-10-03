-- Escala do Reino: pré-verificação somente leitura para o incremento de gestão de membros.
-- Esperado: todos os campos true antes de prosseguir com o ensaio 007.
-- Não altera dados, tabelas ou permissões.
select
  current_setting('server_encoding') = 'UTF8' as server_is_utf8,
  current_setting('client_encoding') = 'UTF8' as client_is_utf8,
  (
    to_regclass('app_private.churches') is not null
    and to_regclass('app_private.members') is not null
    and to_regclass('app_private.church_access') is not null
    and to_regclass('app_private.access_invitations') is not null
    and to_regclass('app_private.access_requests') is not null
    and to_regclass('app_private.audit_entries') is not null
  ) as previous_six_tables_present,
  to_regprocedure('public.get_my_church_access()') is not null as get_my_church_access_present,
  to_regclass('app_private.command_receipts') is null as command_receipts_table_available,
  to_regprocedure('public.list_church_members(uuid, integer, integer)') is null as list_members_rpc_available,
  to_regprocedure('public.create_church_member(uuid, uuid, text)') is null as create_member_rpc_available,
  to_regprocedure('public.get_create_member_receipt(uuid, uuid)') is null as get_receipt_rpc_available,
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
  ) as app_private_strictly_blocked;
