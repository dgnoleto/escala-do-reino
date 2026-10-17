-- Somente leitura. Executar na base destinada ao ensaio, com 013 e 015 instalados.
do $preflight$
declare v_name text; v_role text;
begin
  if current_setting('server_encoding') <> 'UTF8' or current_setting('client_encoding') <> 'UTF8' then
    raise exception 'Banco e conexão precisam usar UTF8.';
  end if;
  foreach v_name in array array['churches','members','church_access','access_invitations','access_requests',
    'audit_entries','command_receipts','teams','team_memberships','team_roles','member_qualifications','events','event_items','assignments'] loop
    if to_regclass('app_private.' || v_name) is null then raise exception 'Tabela ausente: %',v_name; end if;
    if not exists(select 1 from pg_catalog.pg_class c where c.oid=to_regclass('app_private.' || v_name) and c.relrowsecurity) then
      raise exception 'RLS ausente: %',v_name;
    end if;
  end loop;
  if to_regprocedure('public.restore_church_member(uuid,uuid,uuid,text)') is null
     or to_regprocedure('public.assign_event_participant(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text)') is null
     or to_regprocedure('public.replace_event_participant(uuid,uuid,uuid,uuid,text,text)') is null
     or to_regprocedure('public.deactivate_church_member(uuid,uuid,uuid,text)') is null then
    raise exception 'Instalar e validar a cadeia 001–015 antes de 016.';
  end if;
  foreach v_name in array array[
    'public.deactivate_church_member(uuid,uuid,uuid,text)',
    'public.restore_church_member(uuid,uuid,uuid,text)',
    'public.create_church_member(uuid,uuid,text)',
    'public.issue_church_invitation(uuid,uuid,uuid,text)',
    'public.redeem_invitation_confirm_name(uuid,text,text)',
    'public.redeem_invitation_propose_name(uuid,text,text)',
    'public.decide_access_request(uuid,uuid,uuid,text)',
    'public.create_church_team(uuid,uuid,text,uuid)',
    'public.create_church_event(uuid,uuid,text,text,timestamptz,timestamptz,uuid)',
    'public.create_event_item(uuid,uuid,uuid,text,text,integer,integer,uuid,uuid)'] loop
    if to_regprocedure(v_name) is null then raise exception 'RPC anterior ausente: %',v_name; end if;
    if not has_function_privilege('authenticated',to_regprocedure(v_name),'EXECUTE')
       or has_function_privilege('anon',to_regprocedure(v_name),'EXECUTE')
       or has_function_privilege('service_role',to_regprocedure(v_name),'EXECUTE') then
      raise exception 'ACL anterior divergente: %',v_name;
    end if;
  end loop;
  if position('016: exclusão efetiva' in pg_get_functiondef('public.deactivate_church_member(uuid,uuid,uuid,text)'::regprocedure)) > 0 then
    raise exception '016 já presente. Não reaplicar sem revisão.';
  end if;
  if (select count(*) from pg_catalog.pg_trigger where not tgisinternal and tgenabled='O' and
      ((tgrelid='app_private.members'::regclass and tgname in ('members_touch_updated_at','members_protect_last_admin'))
       or (tgrelid='app_private.church_access'::regclass and tgname='church_access_protect_last_admin'))) <> 3 then
    raise exception 'Gatilhos canônicos de revisão/continuidade ausentes ou desabilitados.';
  end if;
  foreach v_role in array array['anon','authenticated','service_role'] loop
    if has_schema_privilege(v_role,'app_private','USAGE,CREATE') or exists (
      select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
      where n.nspname='app_private' and c.relkind='r' and
      has_table_privilege(v_role,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')) then
      raise exception 'Privilégio privado indevido: %',v_role;
    end if;
  end loop;
end;
$preflight$;
