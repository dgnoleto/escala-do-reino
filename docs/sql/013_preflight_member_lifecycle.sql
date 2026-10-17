-- Escala do Reino: pré-validação somente leitura antes de aplicar 013_member_lifecycle.sql.
-- Valida codificação UTF8, integridade dos incrementos anteriores (001–012),
-- ausência prévia dos novos endpoints de ciclo de vida em public e isolamento de app_private.
-- Esperado: sucesso com diagnóstico positivo. Não altera dados nem privilégios.

do $preflight$
declare
  v_role text;
begin
  if current_setting('server_encoding') <> 'UTF8'
     or current_setting('client_encoding') <> 'UTF8' then
    raise exception 'Banco e conexão precisam usar UTF8.';
  end if;

  if to_regclass('auth.users') is null
     or to_regclass('app_private.churches') is null
     or to_regclass('app_private.members') is null
     or to_regclass('app_private.church_access') is null
     or to_regclass('app_private.access_invitations') is null
     or to_regclass('app_private.access_requests') is null
     or to_regclass('app_private.audit_entries') is null
     or to_regclass('app_private.command_receipts') is null
     or to_regprocedure('public.get_my_church_access()') is null
     or to_regprocedure('public.list_church_members(uuid, integer, integer)') is null
     or to_regprocedure('public.create_church_member(uuid, uuid, text)') is null
     or to_regprocedure('public.get_create_member_receipt(uuid, uuid)') is null
     or to_regprocedure('public.issue_church_invitation(uuid, uuid, uuid, text)') is null
     or to_regprocedure('public.get_invitation_command_receipt(uuid)') is null then
    raise exception 'Estrutura dos incrementos anteriores (001–012) ausente. Parar e conferir.';
  end if;

  -- Verifica que a tabela members possui a coluna updated_at existente para receber o gatilho monotônico
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'app_private'
      and table_name = 'members'
      and column_name = 'updated_at'
      and data_type = 'timestamp with time zone'
  ) then
    raise exception 'Coluna app_private.members.updated_at ausente ou de tipo divergente. Parar e conferir.';
  end if;

  -- Verifica colunas e tipos de app_private.audit_entries utilizados na auditoria de ciclo de vida (schema 003)
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'app_private' and table_name = 'audit_entries' and column_name = 'actor_user_id' and data_type = 'uuid'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'app_private' and table_name = 'audit_entries' and column_name = 'actor_source' and data_type = 'text'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'app_private' and table_name = 'audit_entries' and column_name = 'details' and data_type = 'jsonb'
  ) then
    raise exception 'Colunas ou tipos requeridos em app_private.audit_entries ausentes ou divergentes. Parar e conferir.';
  end if;

  -- Verifica colunas e tipos de app_private.command_receipts utilizados no recibo idempotente estruturado (evolução 011)
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'app_private' and table_name = 'command_receipts' and column_name = 'result_payload' and data_type = 'jsonb'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'app_private' and table_name = 'command_receipts' and column_name = 'result_member_id' and data_type = 'uuid'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'app_private' and table_name = 'command_receipts' and column_name = 'params_hash' and data_type = 'bytea'
  ) then
    raise exception 'Colunas ou tipos requeridos em app_private.command_receipts ausentes ou divergentes. Parar e conferir.';
  end if;

  -- Verifica colunas e tipos de app_private.church_access utilizados na checagem de elegibilidade e guarda de revogação
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'app_private' and table_name = 'church_access' and column_name = 'revoked_at' and data_type = 'timestamp with time zone'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'app_private' and table_name = 'church_access' and column_name = 'revoked_by_user_id' and data_type = 'uuid'
  ) then
    raise exception 'Colunas de revogação em app_private.church_access ausentes ou divergentes. Parar e conferir.';
  end if;

  -- Garante que nenhum dos novos endpoints da #18 exista previamente em public
  if exists (
    select 1 from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'list_church_members_admin',
        'restore_church_member',
        'get_member_lifecycle_receipt',
        'deactivate_church_member'
      )
  ) then
    raise exception 'Um ou mais endpoints de ciclo de vida já existem em public. Parar e revisar.';
  end if;

  -- Garante que a função touch_member_updated_at não existe previamente
  if to_regprocedure('app_private.touch_member_updated_at()') is not null then
    raise exception 'Função app_private.touch_member_updated_at() já existe. Parar e revisar.';
  end if;

  -- Verifica privilégios de isolamento estrito de app_private
  foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
    if has_schema_privilege(v_role, 'app_private', 'USAGE,CREATE')
       or exists (
         select 1 from pg_catalog.pg_class c
         join pg_catalog.pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'app_private' and c.relkind = 'r'
           and has_table_privilege(v_role, c.oid,
             'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
       ) then
      raise exception 'Permissões internas inesperadas em app_private para %. Parar e revisar.', v_role;
    end if;
  end loop;

  raise notice '013_preflight_member_lifecycle: estrutura prévia e isolamento validados com sucesso.';
end;
$preflight$;
