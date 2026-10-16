-- Escala do Reino: pré-validação somente leitura antes de aplicar 015_liturgical_dependencies.sql.
-- Valida codificação UTF8, integridade dos incrementos anteriores (001–013),
-- ausência prévia das novas tabelas e RPCs operacionais e isolamento de app_private.
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
     or to_regprocedure('public.list_church_members_admin(uuid, text, integer, integer)') is null
     or to_regprocedure('public.restore_church_member(uuid, uuid, uuid, text)') is null
     or to_regprocedure('public.get_member_lifecycle_receipt(uuid)') is null
     or to_regprocedure('public.deactivate_church_member(uuid, uuid, uuid, text)') is null then
    raise exception 'Estrutura dos incrementos anteriores (001–013) ausente. Parar e conferir.';
  end if;

  -- Verifica que a constraint composta members_church_id_id_unique existe (instalada em 001)
  if not exists (
    select 1 from pg_catalog.pg_constraint con
    join pg_catalog.pg_class rel on rel.oid = con.conrelid
    join pg_catalog.pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'app_private'
      and rel.relname = 'members'
      and con.conname = 'members_church_id_id_unique'
  ) then
    raise exception 'Constraint app_private.members_church_id_id_unique ausente. Parar e conferir.';
  end if;

  -- Verifica que as novas tabelas operacionais do incremento 015 ainda não existem
  if to_regclass('app_private.teams') is not null
     or to_regclass('app_private.team_memberships') is not null
     or to_regclass('app_private.team_roles') is not null
     or to_regclass('app_private.member_qualifications') is not null
     or to_regclass('app_private.events') is not null
     or to_regclass('app_private.event_items') is not null
     or to_regclass('app_private.assignments') is not null then
    raise exception 'Uma ou mais tabelas operacionais do incremento 015 já existem em app_private. Parar e revisar.';
  end if;

  -- Verifica que as novas RPCs operacionais ainda não existem em public
  if exists (
    select 1 from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'create_church_team',
        'assign_team_leader',
        'add_team_member',
        'remove_team_member',
        'create_team_role',
        'grant_member_qualification',
        'revoke_member_qualification',
        'create_church_event',
        'assign_event_liturgy_leader',
        'assign_event_participant',
        'replace_event_participant',
        'finish_event_service',
        'list_church_teams',
        'list_church_events'
      )
  ) then
    raise exception 'Um ou mais endpoints operacionais do incremento 015 já existem em public. Parar e revisar.';
  end if;

  -- Verifica isolamento estrito de app_private
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

  raise notice 'PASS: Pré-validação do incremento 015 concluída com sucesso. Ambiente pronto para instalação.';
end;
$preflight$;
