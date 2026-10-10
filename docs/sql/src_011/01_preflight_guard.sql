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
     or to_regprocedure('public.check_church_creation_eligibility()') is null
     or to_regprocedure('public.create_my_church(uuid, text, text, text, text, text, text)') is null
     or to_regprocedure('public.get_create_church_receipt(uuid)') is null then
    raise exception 'Estrutura dos incrementos anteriores (001–010) ausente. Parar e conferir.';
  end if;

  -- Exige função gen_random_bytes(integer) com retorno bytea em schema confiável e pertencente à extensão confiável pgcrypto ou catálogo nativo
  if not exists (
    select 1 from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    left join pg_catalog.pg_depend d on d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e'
    left join pg_catalog.pg_extension ext on ext.oid = d.refobjid
    where p.proname = 'gen_random_bytes'
      and n.nspname in ('extensions', 'public', 'pg_catalog')
      and p.pronargs = 1
      and p.proargtypes[0] = 'integer'::regtype
      and p.prorettype = 'bytea'::regtype
      and (n.nspname = 'pg_catalog' or ext.extname = 'pgcrypto')
  ) then
    raise exception 'Função gen_random_bytes(integer) com retorno bytea não encontrada em schema/extensão confiável (pgcrypto/pg_catalog). Parar e conferir.';
  end if;

  -- Detecta previamente colunas ou constraint em command_receipts com configurações incompatíveis
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'app_private' and table_name = 'command_receipts'
      and (
        (column_name = 'result_entity_id' and (data_type <> 'uuid' or is_nullable <> 'YES' or column_default is not null))
        or (column_name = 'result_payload' and (data_type <> 'jsonb' or is_nullable <> 'YES' or column_default is not null))
      )
  ) or exists (
    select 1 from pg_catalog.pg_constraint con
    join pg_catalog.pg_class c on c.oid = con.conrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'app_private' and c.relname = 'command_receipts'
      and con.conname = 'command_receipts_payload_check'
      and (
        pg_catalog.pg_get_constraintdef(con.oid) !~* 'result_payload\s+is\s+null'
        or pg_catalog.pg_get_constraintdef(con.oid) !~* 'jsonb_typeof\s*\(\s*result_payload\s*\)\s*=\s*''object'''
        or pg_catalog.pg_get_constraintdef(con.oid) !~* 'octet_length\s*\(\s*\(?\s*result_payload\s*\)?::text\s*\)\s*<=\s*4096'
      )
  ) then
    raise exception 'Tabela app_private.command_receipts possui colunas ou constraint de resultado incompatíveis. Parar e revisar.';
  end if;

  if exists (
    select 1 from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'issue_church_invitation',
        'get_invitation_details',
        'redeem_invitation_confirm_name',
        'redeem_invitation_propose_name',
        'get_my_access_request',
        'list_church_invitations',
        'list_church_access_requests',
        'decide_access_request',
        'get_invitation_command_receipt'
      )
  ) then
    raise exception 'Um ou mais endpoints de convites já existem em public. Parar e revisar.';
  end if;

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
end;
$preflight$;
