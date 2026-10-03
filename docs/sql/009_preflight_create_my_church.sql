-- Escala do Reino: pré-verificação somente leitura para o incremento "Criar minha igreja".
-- Esperado: todos os campos true antes de prosseguir com o ensaio 009.
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
    and to_regclass('app_private.command_receipts') is not null
  ) as previous_seven_tables_present,
  (
    to_regprocedure('public.get_my_church_access()') is not null
    and to_regprocedure('public.list_church_members(uuid, integer, integer)') is not null
    and to_regprocedure('public.create_church_member(uuid, uuid, text)') is not null
    and to_regprocedure('public.get_create_member_receipt(uuid, uuid)') is not null
  ) as previous_four_rpcs_present,
  -- Conferência das colunas específicas de que o incremento depende
  (
    exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name = 'email_confirmed_at')
    and exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name = 'deleted_at')
    and exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name = 'banned_until')
    and exists (select 1 from information_schema.columns where table_schema = 'app_private' and table_name = 'churches' and column_name = 'timezone')
    and exists (select 1 from information_schema.columns where table_schema = 'app_private' and table_name = 'churches' and column_name = 'google_maps_url')
    and exists (select 1 from information_schema.columns where table_schema = 'app_private' and table_name = 'churches' and column_name = 'default_duration_policy')
    and exists (select 1 from information_schema.columns where table_schema = 'app_private' and table_name = 'church_access' and column_name = 'is_admin')
    and exists (select 1 from information_schema.columns where table_schema = 'app_private' and table_name = 'church_access' and column_name = 'onboarding_completed_at')
    and exists (select 1 from information_schema.columns where table_schema = 'app_private' and table_name = 'command_receipts' and column_name = 'action')
  ) as required_columns_present,
  -- Diagnóstico prévio: nenhuma conta pode possuir administrações ativas duplicadas antes do índice
  not exists (
    select ca.user_id
    from app_private.church_access ca
    where ca.is_admin = true and ca.status = 'active'
    group by ca.user_id
    having count(*) > 1
  ) as no_duplicate_active_administrations,
  (
    select count(*) = 0
    from pg_catalog.pg_indexes
    where schemaname = 'app_private'
      and tablename = 'church_access'
      and indexname = 'church_access_single_active_admin_idx'
  ) as single_admin_index_available,
  to_regprocedure('public.check_church_creation_eligibility()') is null as check_eligibility_rpc_available,
  to_regprocedure('public.create_my_church(uuid, text, text, text, text, text, text)') is null as create_church_rpc_available,
  to_regprocedure('public.get_create_church_receipt(uuid)') is null as get_receipt_rpc_available,
  not exists (
    select 1 from pg_catalog.pg_trigger
    where tgname in ('church_access_protect_last_admin', 'members_protect_last_admin')
  ) as protection_triggers_available,
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
