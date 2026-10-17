-- Prova reversível: candidato integral na mesma transação. Exige base descartável vazia 001–015.
-- Não executar no piloto. Nenhum resultado offline é aceite SQL.
-- Incremento 016: integração da exclusão efetiva. Candidato local, sem autorização de instalação.
-- Preserva os instaladores 007/011/013/015; substituições explícitas no incremento novo.
-- Gate church_admin_continuity antes de locks de linha em ciclo de vida/cadastro/convites.
-- Responsáveis são bloqueados antes de teams/events/items; sem novos contêineres ou dependências.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
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

create or replace function public.deactivate_church_member(
  p_church_id uuid, p_command_id uuid, p_member_id uuid, p_expected_updated_at text
)
returns table (command_id uuid, action text, church_id uuid, result_member_id uuid, result_payload jsonb, created_at timestamptz)
language plpgsql volatile security definer set search_path = '' set statement_timeout = '5s'
as $function$
declare
  v_user_id uuid := (select auth.uid());
  v_params_hash bytea;
  v_receipt record;
  v_member record;
  v_row record;
  v_now timestamptz;
  v_revision timestamptz;
  v_payload jsonb;
  v_access_revoked boolean := false;
  v_invitation_count integer := 0;
  v_cancelled_count integer := 0;
  v_expired_count integer := 0;
begin
  -- 016: exclusão efetiva; a ausência da fonte nunca equivale a ausência de dependência.
  if v_user_id is null then raise exception 'Não autenticado.' using errcode = '28000'; end if;
  if p_church_id is null or p_command_id is null or p_member_id is null
     or p_expected_updated_at is null or btrim(p_expected_updated_at) = '' then
    raise exception 'Parâmetros obrigatórios ausentes.' using errcode = '22004';
  end if;
  -- 016: decisões após espera exigem snapshots novos por instrução.
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Esta operação exige READ COMMITTED.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_user_id::text),hashtext(p_command_id::text));
  if not exists (
    select 1 from app_private.church_access ca
    join auth.users u on u.id = ca.user_id
    join app_private.churches c on c.id = ca.church_id
    join app_private.members m on m.church_id = ca.church_id and m.id = ca.member_id
    where ca.church_id = p_church_id and ca.user_id = v_user_id
      and ca.is_admin = true and ca.status = 'active'
      and ca.onboarding_completed_at is not null
      and c.status = 'active' and m.status = 'active'
      and u.email_confirmed_at is not null and u.deleted_at is null
      and not coalesce(u.is_anonymous, false)
      and (u.banned_until is null or u.banned_until <= clock_timestamp())
  ) then
    raise exception 'Acesso administrativo não autorizado nesta igreja.' using errcode = '42501';
  end if;

  -- 016: antes de qualquer lock de linha, inclusive do operador.
  perform pg_catalog.pg_advisory_xact_lock(hashtext('church_admin_continuity'), hashtext(p_church_id::text));

  if not exists (
    select 1 from app_private.church_access ca
    join auth.users u on u.id = ca.user_id
    join app_private.churches c on c.id = ca.church_id
    join app_private.members m on m.church_id = ca.church_id and m.id = ca.member_id
    where ca.church_id = p_church_id and ca.user_id = v_user_id
      and ca.is_admin = true and ca.status = 'active'
      and ca.onboarding_completed_at is not null
      and c.status = 'active' and m.status = 'active'
      and u.email_confirmed_at is not null and u.deleted_at is null
      and not coalesce(u.is_anonymous, false)
      and (u.banned_until is null or u.banned_until <= clock_timestamp())
  ) then
    raise exception 'Acesso administrativo não autorizado nesta igreja.' using errcode = '42501';
  end if;

  v_params_hash := sha256(convert_to(jsonb_build_object('action','deactivate_member',
    'church_id',p_church_id::text,'member_id',p_member_id::text,
    'expected_updated_at',p_expected_updated_at)::text,'UTF8'));
  select cr.* into v_receipt from app_private.command_receipts cr
  where cr.user_id = v_user_id and cr.command_id = p_command_id;
  if v_receipt.command_id is not null then
    if v_receipt.action <> 'deactivate_member' or v_receipt.church_id <> p_church_id
       or v_receipt.params_hash <> v_params_hash then
      raise exception 'Comando reutilizado com parâmetros diferentes.' using errcode = '23505';
    end if;
    return query select v_receipt.command_id,v_receipt.action,v_receipt.church_id,
      v_receipt.result_member_id,v_receipt.result_payload,v_receipt.created_at;
    return;
  end if;
  -- A mesma ordem da restauração 013. Convites/decisões/criação compartilham o gate antes de linhas.
  perform 1 from app_private.church_access ca
  where ca.church_id=p_church_id and ca.member_id=p_member_id for update;
  select m.id,m.status,m.display_name,m.updated_at into v_member from app_private.members m
  where m.church_id=p_church_id and m.id=p_member_id for update;
  if v_member.id is null then raise exception 'Membro não encontrado nesta igreja.' using errcode='P0002'; end if;
  -- Cobertura da linha de acesso que poderia não existir antes da espera pelo membro.
  perform 1 from app_private.church_access ca
  where ca.church_id=p_church_id and ca.member_id=p_member_id for update;
  perform 1 from app_private.access_invitations ai
  where ai.church_id=p_church_id and ai.member_id=p_member_id order by ai.id for update;
  perform 1 from app_private.access_requests ar
  where ar.church_id=p_church_id and ar.member_id=p_member_id order by ar.id for update;
  if not exists (
    select 1 from app_private.church_access ca
    join auth.users u on u.id = ca.user_id
    join app_private.churches c on c.id = ca.church_id
    join app_private.members m on m.church_id = ca.church_id and m.id = ca.member_id
    where ca.church_id = p_church_id and ca.user_id = v_user_id
      and ca.is_admin = true and ca.status = 'active'
      and ca.onboarding_completed_at is not null
      and c.status = 'active' and m.status = 'active'
      and u.email_confirmed_at is not null and u.deleted_at is null
      and not coalesce(u.is_anonymous, false)
      and (u.banned_until is null or u.banned_until <= clock_timestamp())
  ) then
    raise exception 'Acesso administrativo não autorizado nesta igreja.' using errcode = '42501';
  end if;

  if exists(select 1 from app_private.church_access ca where ca.church_id=p_church_id
    and ca.member_id=p_member_id and ca.user_id=v_user_id) then
    raise exception 'Autoexclusão não permitida.' using errcode='P0016';
  end if;
  if v_member.status <> 'active' or
     to_char(v_member.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') <> p_expected_updated_at then
    raise exception 'O cadastro foi modificado. Atualize a listagem.' using errcode='P0019';
  end if;
  if exists(select 1 from app_private.church_access ca where ca.church_id=p_church_id
       and ca.member_id=p_member_id and ca.status='active' and ca.is_admin)
     and not exists (
       select 1 from app_private.church_access ca
       join app_private.members m on m.church_id=ca.church_id and m.id=ca.member_id
       join auth.users u on u.id=ca.user_id
       where ca.church_id=p_church_id and ca.member_id<>p_member_id and ca.status='active' and ca.is_admin
         and ca.onboarding_completed_at is not null and m.status='active'
         and u.email_confirmed_at is not null and u.deleted_at is null
         and not coalesce(u.is_anonymous,false)
         and (u.banned_until is null or u.banned_until<=clock_timestamp())) then
    raise exception 'Último administrador elegível não pode ser excluído.' using errcode='P0015';
  end if;
  if to_regclass('app_private.teams') is null or to_regclass('app_private.events') is null
     or to_regclass('app_private.event_items') is null or to_regclass('app_private.assignments') is null then
    raise exception 'Fonte de dependências indisponível.' using errcode='P0021';
  end if;
  -- Todos os escritores de novas dependências bloqueiam este membro antes de consultar seu estado.
  -- Não bloquear events/teams aqui: o membro é o guardião comum; encerramentos só liberam impedimentos.
  if exists(select 1 from app_private.teams t where t.church_id=p_church_id
    and t.leader_member_id=p_member_id and t.status='active') then
    raise exception 'Transfira previamente a liderança do ministério ativo.' using errcode='P0022';
  end if;
  v_now := clock_timestamp();
  if exists(select 1 from app_private.events e where e.church_id=p_church_id
    and e.status='scheduled' and e.planned_end_at<=v_now and (
      e.liturgy_leader_member_id=p_member_id
      or exists(select 1 from app_private.assignments a where a.church_id=e.church_id and a.event_id=e.id
        and a.member_id=p_member_id and a.status='active')
      or exists(select 1 from app_private.event_items i where i.church_id=e.church_id and i.event_id=e.id
        and i.nominal_leader_member_id=p_member_id and i.status in ('pending','in_progress')))) then
    raise exception 'Evento com horário expirado exige encerramento formal.' using errcode='P0025';
  end if;
  if exists(select 1 from app_private.events e where e.church_id=p_church_id
    and e.liturgy_leader_member_id=p_member_id and e.status in ('scheduled','in_progress')) then
    raise exception 'Reatribua a liderança da liturgia antes da exclusão.' using errcode='P0023';
  end if;
  if exists(select 1 from app_private.assignments a join app_private.events e
      on e.church_id=a.church_id and e.id=a.event_id
      where a.church_id=p_church_id and a.member_id=p_member_id and a.status='active'
        and e.status in ('scheduled','in_progress'))
    or exists(select 1 from app_private.event_items i join app_private.events e
      on e.church_id=i.church_id and e.id=i.event_id
      where i.church_id=p_church_id and i.nominal_leader_member_id=p_member_id
        and i.status in ('pending','in_progress') and e.status in ('scheduled','in_progress')) then
    raise exception 'Remova ou substitua a participação/responsabilidade ativa.' using errcode='P0024';
  end if;
  -- Todos os locks potencialmente esperados precedem a autoridade e o relógio finais.
  if not exists (
    select 1 from app_private.church_access ca
    join auth.users u on u.id = ca.user_id
    join app_private.churches c on c.id = ca.church_id
    join app_private.members m on m.church_id = ca.church_id and m.id = ca.member_id
    where ca.church_id = p_church_id and ca.user_id = v_user_id
      and ca.is_admin = true and ca.status = 'active'
      and ca.onboarding_completed_at is not null
      and c.status = 'active' and m.status = 'active'
      and u.email_confirmed_at is not null and u.deleted_at is null
      and not coalesce(u.is_anonymous, false)
      and (u.banned_until is null or u.banned_until <= clock_timestamp())
  ) then
    raise exception 'Acesso administrativo não autorizado nesta igreja.' using errcode = '42501';
  end if;

  v_now := clock_timestamp();
  for v_row in
    update app_private.church_access ca set status='revoked',revoked_at=v_now,revoked_by_user_id=v_user_id
    where ca.church_id=p_church_id and ca.member_id=p_member_id and ca.status='active'
    returning ca.id
  loop
    v_access_revoked := true;
    insert into app_private.audit_entries(church_id,action,actor_user_id,actor_source,target_type,target_id,details,occurred_at)
    values(p_church_id,'revoke_church_access',v_user_id,'application','church_access',v_row.id,
      jsonb_build_object('reason','member_deactivation','member_id',p_member_id,'command_id',p_command_id),v_now);
  end loop;
  for v_row in
    update app_private.access_invitations ai set revoked_at=v_now,revoked_by_user_id=v_user_id
    where ai.church_id=p_church_id and ai.member_id=p_member_id
      and ai.redeemed_at is null and ai.revoked_at is null and ai.expires_at>v_now returning ai.id
  loop
    v_invitation_count := v_invitation_count+1;
    insert into app_private.audit_entries(church_id,action,actor_user_id,actor_source,target_type,target_id,details,occurred_at)
    values(p_church_id,'revoke_access_invitation',v_user_id,'application','access_invitations',v_row.id,
      jsonb_build_object('reason','member_deactivation','command_id',p_command_id),v_now);
  end loop;
  for v_row in
    update app_private.access_requests ar
    set status=case when ar.expires_at>v_now then 'cancelled' else 'expired' end,
        decided_at=v_now,decided_by_user_id=case when ar.expires_at>v_now then v_user_id else null end
    where ar.church_id=p_church_id and ar.member_id=p_member_id and ar.status='pending'
    returning ar.id,ar.status
  loop
    if v_row.status='cancelled' then v_cancelled_count:=v_cancelled_count+1;
    else v_expired_count:=v_expired_count+1; end if;
    insert into app_private.audit_entries(church_id,action,actor_user_id,actor_source,target_type,target_id,details,occurred_at)
    values(p_church_id,case when v_row.status='cancelled' then 'cancel_access_request' else 'expire_access_request' end,
      v_user_id,'application','access_requests',v_row.id,
      jsonb_build_object('reason','member_deactivation','command_id',p_command_id),v_now);
  end loop;
  update app_private.members m set status='inactive'
  where m.church_id=p_church_id and m.id=p_member_id returning m.updated_at into v_revision;
  v_payload := jsonb_build_object('member_id',p_member_id::text,'display_name',v_member.display_name,
    'status','inactive','updated_at',to_char(v_revision at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'deactivated_at',v_now,'access_revoked',v_access_revoked,'invitations_revoked',v_invitation_count,
    'requests_cancelled',v_cancelled_count,'requests_expired',v_expired_count);
  insert into app_private.audit_entries(church_id,action,actor_user_id,actor_source,target_type,target_id,details,occurred_at)
  values(p_church_id,'deactivate_member',v_user_id,'application','member',p_member_id,
    v_payload || jsonb_build_object('previous_status','active','new_status','inactive','command_id',p_command_id),v_now);
  insert into app_private.command_receipts(church_id,user_id,command_id,action,params_hash,
    result_member_id,result_entity_id,result_payload,created_at)
  values(p_church_id,v_user_id,p_command_id,'deactivate_member',v_params_hash,p_member_id,p_member_id,v_payload,v_now);
  return query select p_command_id,'deactivate_member'::text,p_church_id,p_member_id,v_payload,v_now;
end;
$function$;


create or replace function public.restore_church_member(
  p_church_id uuid,
  p_command_id uuid,
  p_member_id uuid,
  p_expected_updated_at text
)
returns table (
  command_id uuid,
  action text,
  church_id uuid,
  result_member_id uuid,
  result_payload jsonb,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $function$
declare
  v_user_id uuid;
  v_params_canonical text;
  v_params_hash bytea;
  v_existing_receipt record;
  v_member record;
  v_current_updated_at_str text;
  v_has_active_access boolean;
  v_has_revoked_access boolean;
  v_new_updated_at timestamptz;
  v_new_updated_at_str text;
  v_new_payload jsonb;
  v_created_at timestamptz;
begin
  -- 016: decisões após espera exigem snapshots novos por instrução.
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Esta operação exige READ COMMITTED.' using errcode = '42501';
  end if;
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if p_church_id is null or p_command_id is null or p_member_id is null or p_expected_updated_at is null then
    raise exception 'Parâmetros obrigatórios ausentes.' using errcode = '22004';
  end if;

  if trim(p_expected_updated_at) = '' then
    raise exception 'Parâmetro de revisão obrigatório.' using errcode = '22004';
  end if;

  -- Serialização transacional por usuário e comando
  perform pg_advisory_xact_lock(hashtext(v_user_id::text), hashtext(p_command_id::text));

  -- 016: antes de qualquer lock de linha, inclusive do operador.
  perform pg_catalog.pg_advisory_xact_lock(hashtext('church_admin_continuity'), hashtext(p_church_id::text));

  -- Hash canônico estrito dos parâmetros
  v_params_canonical := jsonb_build_object(
    'action', 'restore_member',
    'church_id', p_church_id::text,
    'member_id', p_member_id::text,
    'expected_updated_at', p_expected_updated_at
  )::text;
  v_params_hash := sha256(convert_to(v_params_canonical, 'UTF8'));

  -- 1. Prioridade absoluta do recibo de comando (Replay seguro e idempotente)
  select cr.command_id, cr.action, cr.church_id, cr.params_hash, cr.result_member_id, cr.result_payload, cr.created_at
  into v_existing_receipt
  from app_private.command_receipts cr
  where cr.user_id = v_user_id and cr.command_id = p_command_id;

  if v_existing_receipt.command_id is not null then
    if v_existing_receipt.action <> 'restore_member'
       or v_existing_receipt.church_id <> p_church_id
       or v_existing_receipt.params_hash <> v_params_hash then
      raise exception 'Comando reutilizado com parâmetros diferentes.' using errcode = '23505';
    end if;

    -- Revalidação estrita da elegibilidade administrativa do operador antes do replay
    if not exists (
      select 1
      from app_private.church_access ca
      join auth.users u on u.id = ca.user_id
      join app_private.churches c on c.id = ca.church_id
      join app_private.members m on m.church_id = ca.church_id and m.id = ca.member_id
      where ca.church_id = p_church_id
        and ca.user_id = v_user_id
        and ca.is_admin = true
        and ca.status = 'active'
        and ca.onboarding_completed_at is not null
        and c.status = 'active'
        and m.status = 'active'
        and u.email_confirmed_at is not null
        and u.deleted_at is null
        and not coalesce(u.is_anonymous, false)
        and (u.banned_until is null or u.banned_until <= clock_timestamp())
    ) then
      raise exception 'Acesso administrativo não autorizado nesta igreja.' using errcode = '42501';
    end if;

    return query
    select
      v_existing_receipt.command_id,
      v_existing_receipt.action,
      v_existing_receipt.church_id,
      v_existing_receipt.result_member_id,
      v_existing_receipt.result_payload,
      v_existing_receipt.created_at;
    return;
  end if;

  -- 2. Primeira execução: validação completa do operador chamador
  if not exists (
    select 1
    from app_private.church_access ca
    join auth.users u on u.id = ca.user_id
    join app_private.churches c on c.id = ca.church_id
    join app_private.members m on m.church_id = ca.church_id and m.id = ca.member_id
    where ca.church_id = p_church_id
      and ca.user_id = v_user_id
      and ca.is_admin = true
      and ca.status = 'active'
      and ca.onboarding_completed_at is not null
      and c.status = 'active'
      and m.status = 'active'
      and u.email_confirmed_at is not null
      and u.deleted_at is null
      and not coalesce(u.is_anonymous, false)
      and (u.banned_until is null or u.banned_until <= clock_timestamp())
  ) then
    raise exception 'Acesso administrativo não autorizado nesta igreja.' using errcode = '42501';
  end if;

  -- 3. Bloqueio dos recursos em ordem canônica estrita (church_access antes de members)
  perform 1
  from app_private.church_access ca
  where ca.church_id = p_church_id and ca.member_id = p_member_id
  for update;

  select m.id, m.status, m.display_name, m.updated_at
  into v_member
  from app_private.members m
  where m.church_id = p_church_id and m.id = p_member_id
  for update;

  if v_member.id is null then
    raise exception 'Membro não encontrado nesta igreja.' using errcode = 'P0002';
  end if;

  -- Conversão de updated_at para string ISO opaca UTC integral
  v_current_updated_at_str := to_char(v_member.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"');

  -- Validação do estado atual do membro
  if v_member.status = 'active' then
    raise exception 'Membro já se encontra ativo.' using errcode = 'P0019';
  end if;

  if v_member.status <> 'inactive' then
    raise exception 'Situação do membro inválida para restauração.' using errcode = '22000';
  end if;

  -- Validação de concorrência otimista de revisão
  if v_current_updated_at_str <> p_expected_updated_at then
    raise exception 'O cadastro foi modificado por outro operador. Atualize a listagem e tente novamente.' using errcode = 'P0019';
  end if;

  -- 4. Consulta atual de acesso após espera de lock sobre church_access (inclusive se antes não havia linha)
  select exists (
    select 1
    from app_private.church_access ca
    where ca.church_id = p_church_id
      and ca.member_id = p_member_id
      and ca.status = 'active'
  ) into v_has_active_access;

  if v_has_active_access then
    raise exception 'Membro possui vínculo ativo legado nesta igreja. Restauração bloqueada.' using errcode = 'P0018';
  end if;

  -- Consulta se existe vínculo de acesso previamente revogado para preservar no resultado
  select exists (
    select 1
    from app_private.church_access ca
    where ca.church_id = p_church_id
      and ca.member_id = p_member_id
      and ca.status = 'revoked'
  ) into v_has_revoked_access;

  -- 5. Revalidação final do operador chamador completo no instante final
  if not exists (
    select 1
    from app_private.church_access ca
    join auth.users u on u.id = ca.user_id
    join app_private.churches c on c.id = ca.church_id
    join app_private.members m on m.church_id = ca.church_id and m.id = ca.member_id
    where ca.church_id = p_church_id
      and ca.user_id = v_user_id
      and ca.is_admin = true
      and ca.status = 'active'
      and ca.onboarding_completed_at is not null
      and c.status = 'active'
      and m.status = 'active'
      and u.email_confirmed_at is not null
      and u.deleted_at is null
      and not coalesce(u.is_anonymous, false)
      and (u.banned_until is null or u.banned_until <= clock_timestamp())
  ) then
    raise exception 'Acesso administrativo não autorizado nesta igreja.' using errcode = '42501';
  end if;

  -- 6. Transação única: atualização do membro, auditoria e recibo de comando
  -- NUNCA modifica church_access, auth ou papéis durante restauração!
  update app_private.members as m
  set status = 'active'
  where m.id = p_member_id and m.church_id = p_church_id
  returning m.updated_at into v_new_updated_at;

  v_new_updated_at_str := to_char(v_new_updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
  v_created_at := statement_timestamp();

  insert into app_private.audit_entries (
    church_id,
    action,
    actor_user_id,
    actor_source,
    maintenance_operator,
    target_type,
    target_id,
    details,
    occurred_at
  ) values (
    p_church_id,
    'restore_member',
    v_user_id,
    'application',
    null,
    'member',
    p_member_id,
    jsonb_build_object(
      'previous_status', 'inactive',
      'new_status', 'active',
      'command_id', p_command_id::text
    ),
    v_created_at
  );

  v_new_payload := jsonb_build_object(
    'member_id', p_member_id::text,
    'display_name', v_member.display_name,
    'status', 'active',
    'updated_at', v_new_updated_at_str,
    'has_revoked_access', v_has_revoked_access,
    'restored_at', v_created_at
  );

  insert into app_private.command_receipts (
    church_id,
    user_id,
    command_id,
    action,
    params_hash,
    result_member_id,
    result_entity_id,
    result_payload
  ) values (
    p_church_id,
    v_user_id,
    p_command_id,
    'restore_member',
    v_params_hash,
    p_member_id,
    p_member_id,
    v_new_payload
  );

  return query
  select
    p_command_id,
    'restore_member'::text,
    p_church_id,
    p_member_id,
    v_new_payload,
    v_created_at;
end;
$function$;

create or replace function public.create_church_member(
  p_church_id uuid,
  p_command_id uuid,
  p_display_name text
)
returns table (
  member_id uuid,
  display_name text,
  status text,
  created_at timestamptz,
  already_existed boolean
)
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $function$
declare
  v_user_id uuid;
  v_clean_name text;
  v_params_hash bytea;
  v_church_id uuid;
  v_access_id uuid;
  v_admin_member_id uuid;
  v_existing_hash bytea;
  v_existing_member_id uuid;
  v_new_member_id uuid;
  v_recent_commands integer;
begin
  -- 016: decisões após espera exigem snapshots novos por instrução.
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Esta operação exige READ COMMITTED.' using errcode = '42501';
  end if;
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if p_church_id is null then
    raise exception 'Identificador de igreja obrigatório.' using errcode = '22004';
  end if;

  if p_command_id is null then
    raise exception 'Identificador de comando obrigatório.' using errcode = '22004';
  end if;

  if p_display_name is null then
    raise exception 'Nome de exibição obrigatório.' using errcode = '22004';
  end if;

  -- Normalização em NFC e retirada de espaços externos
  v_clean_name := pg_catalog.btrim(pg_catalog.normalize(p_display_name, 'NFC'));
  if char_length(v_clean_name) < 1 or char_length(v_clean_name) > 120 then
    raise exception 'Nome deve ter entre 1 e 120 caracteres.' using errcode = '23514';
  end if;

  -- Resumo SHA-256 dos parâmetros para proteção contra repetição com dados divergentes
  v_params_hash := pg_catalog.sha256(convert_to(p_church_id::text || ':' || v_clean_name, 'UTF8'));

  -- 016: antes de qualquer lock de linha, inclusive do operador.
  perform pg_catalog.pg_advisory_xact_lock(hashtext('church_admin_continuity'), hashtext(p_church_id::text));

  -- Ordem consistente de bloqueio: 1) Igreja, 2) Vínculo de acesso com o administrador, 3) Quota do usuário
  select c.id into v_church_id
  from app_private.churches c
  where c.id = p_church_id and c.status = 'active'
  for share;

  if v_church_id is null then
    raise exception 'Igreja não encontrada ou inativa.' using errcode = 'P0002';
  end if;

  select ca.id, ca.member_id into v_access_id, v_admin_member_id
  from app_private.church_access ca
  join auth.users u on u.id = ca.user_id
  join app_private.members m on m.church_id = ca.church_id and m.id = ca.member_id
  where ca.church_id = p_church_id
    and ca.user_id = v_user_id
    and ca.is_admin = true
    and ca.status = 'active'
    and ca.onboarding_completed_at is not null
    and m.status = 'active'
    and u.email_confirmed_at is not null
    and u.deleted_at is null
    and not coalesce(u.is_anonymous, false)
    and (u.banned_until is null or u.banned_until <= statement_timestamp())
  for share;

  if v_access_id is null then
    raise exception 'Acesso administrativo não autorizado nesta igreja.' using errcode = '42501';
  end if;

  -- Serialização da decisão de criação e controle de quota entre chamadas do mesmo usuário
  perform pg_catalog.pg_advisory_xact_lock(hashtext('create_church_member_quota'), hashtext(v_user_id::text));

  -- 1) Verificação prioritária de recibo existente: preserva replay idempotente mesmo se quota estiver cheia
  select cr.params_hash, cr.result_member_id
  into v_existing_hash, v_existing_member_id
  from app_private.command_receipts cr
  where cr.user_id = v_user_id and cr.command_id = p_command_id;

  if v_existing_hash is not null then
    if v_existing_hash = v_params_hash then
      -- Idêntico: recupera o resultado original sem consumir nova quota ou duplicar registros
      return query
      select m.id as member_id, m.display_name, m.status, m.created_at, true as already_existed
      from app_private.members m
      where m.id = v_existing_member_id and m.church_id = p_church_id;
      return;
    else
      -- Mesmo command_id com parâmetros diferentes: rejeição estrita
      raise exception 'Comando já executado com parâmetros diferentes.' using errcode = '23505';
    end if;
  end if;

  -- 2) Limitação técnica de taxa compartilhada: máx 30 criações concluídas por minuto por usuário
  -- Nota: escolha técnica deste PR para proteger o banco; não protege contra chamadas abusivas que falham antes do commit
  select count(*) into v_recent_commands
  from app_private.command_receipts cr
  where cr.user_id = v_user_id
    and cr.created_at >= statement_timestamp() - interval '1 minute';

  if v_recent_commands >= 30 then
    raise exception 'Limite de requisições excedido. Aguarde antes de cadastrar novos membros.' using errcode = 'P0004';
  end if;

  -- Inserção atômica de membro, auditoria e recibo de comando na mesma transação
  v_new_member_id := gen_random_uuid();

  insert into app_private.members (
    id, church_id, display_name, status, created_by_user_id, created_at, updated_at
  ) values (
    v_new_member_id, p_church_id, v_clean_name, 'active', v_user_id,
    statement_timestamp(), statement_timestamp()
  );

  insert into app_private.audit_entries (
    church_id, action, actor_user_id, actor_source, maintenance_operator,
    target_type, target_id, details, occurred_at
  ) values (
    p_church_id, 'create_member', v_user_id, 'application', null,
    'member', v_new_member_id,
    jsonb_build_object(
      'command_id', p_command_id,
      'display_name', v_clean_name,
      'status', 'active'
    ),
    statement_timestamp()
  );

  insert into app_private.command_receipts (
    church_id, user_id, command_id, action, params_hash, result_member_id, created_at
  ) values (
    p_church_id, v_user_id, p_command_id, 'create_member', v_params_hash, v_new_member_id,
    statement_timestamp()
  );

  return query
  select v_new_member_id, v_clean_name, 'active'::text, statement_timestamp(), false as already_existed;
end;
$function$;

create or replace function public.issue_church_invitation(
  p_command_id uuid,
  p_church_id uuid,
  p_member_id uuid,
  p_recipient_email text
)
returns table (
  invitation_id uuid,
  church_id uuid,
  member_id uuid,
  recipient_email text,
  raw_token text,
  expires_at timestamptz,
  issued_at timestamptz,
  previous_invitation_revoked boolean,
  previous_request_cancelled boolean
)
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $function$
declare
  v_user_id uuid;
  v_clean_email text;
  v_params_json jsonb;
  v_params_hash bytea;
  v_existing_action text;
  v_existing_hash bytea;
  v_existing_payload jsonb;
  v_church_id uuid;
  v_access_id uuid;
  v_target_member_id uuid;
  v_prev_invitation_id uuid;
  v_prev_request_id uuid;
  v_prev_request_expires timestamptz;
  v_crypto_ns text;
  v_raw_bytes bytea;
  v_raw_token text;
  v_token_digest bytea;
  v_now timestamptz;
  v_expires_at timestamptz;
  v_new_invitation_id uuid;
  v_result_payload jsonb;
  v_prev_inv_revoked boolean := false;
  v_prev_req_cancelled boolean := false;
begin
  -- 016: decisões após espera exigem snapshots novos por instrução.
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Esta operação exige READ COMMITTED.' using errcode = '42501';
  end if;
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if p_command_id is null or p_church_id is null or p_member_id is null or p_recipient_email is null then
    raise exception 'Parâmetros obrigatórios incompletos.' using errcode = '22004';
  end if;

  v_clean_email := pg_catalog.lower(pg_catalog.btrim(p_recipient_email));
  if char_length(v_clean_email) < 3 or char_length(v_clean_email) > 254
     or v_clean_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Endereço de e-mail inválido.' using errcode = '23514';
  end if;

  v_params_json := jsonb_build_object(
    'v', 2,
    'action', 'issue_invitation',
    'church_id', p_church_id,
    'member_id', p_member_id,
    'recipient_email', v_clean_email
  );
  v_params_hash := pg_catalog.sha256(pg_catalog.convert_to(v_params_json::text, 'UTF8'));

  -- Serialização transacional do comando por (auth.uid(), command_id) antes de bloqueios de domínio
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(v_user_id::text), pg_catalog.hashtext(p_command_id::text));

  -- 016: antes de qualquer lock de linha, inclusive do operador.
  perform pg_catalog.pg_advisory_xact_lock(hashtext('church_admin_continuity'), hashtext(p_church_id::text));


  -- Reconsulta de recibo existente
  select cr.action, cr.params_hash, cr.result_payload
  into v_existing_action, v_existing_hash, v_existing_payload
  from app_private.command_receipts cr
  where cr.user_id = v_user_id and cr.command_id = p_command_id;

  if v_existing_hash is not null then
    if v_existing_action <> 'issue_invitation' or v_existing_hash <> v_params_hash then
      raise exception 'Comando já executado com parâmetros diferentes.' using errcode = '23505';
    end if;

    -- Revalidação estrita da autorização administrativa atual antes do replay
    if not exists (
      select 1
      from app_private.church_access ca
      join auth.users u on u.id = ca.user_id
      join app_private.churches c on c.id = ca.church_id
      join app_private.members m on m.church_id = ca.church_id and m.id = ca.member_id
      where ca.church_id = p_church_id
        and ca.user_id = v_user_id
        and ca.is_admin = true
        and ca.status = 'active'
        and ca.onboarding_completed_at is not null
        and c.status = 'active'
        and m.status = 'active'
        and u.email_confirmed_at is not null
        and u.deleted_at is null
        and not coalesce(u.is_anonymous, false)
        and (u.banned_until is null or u.banned_until <= clock_timestamp())
    ) then
      raise exception 'Acesso administrativo não autorizado nesta igreja.' using errcode = '42501';
    end if;

    -- Replay de emissão: raw_token não recuperável por segurança
    return query
    select
      (v_existing_payload->>'invitation_id')::uuid,
      (v_existing_payload->>'church_id')::uuid,
      (v_existing_payload->>'member_id')::uuid,
      (v_existing_payload->>'recipient_email')::text,
      null::text,
      (v_existing_payload->>'expires_at')::timestamptz,
      (v_existing_payload->>'issued_at')::timestamptz,
      coalesce((v_existing_payload->>'previous_invitation_revoked')::boolean, false),
      coalesce((v_existing_payload->>'previous_request_cancelled')::boolean, false);
    return;
  end if;

  -- Bloqueios de domínio na ordem canônica:
  -- 1) Igreja SHARE
  select c.id into v_church_id
  from app_private.churches c
  where c.id = p_church_id and c.status = 'active'
  for share;

  if v_church_id is null then
    raise exception 'Igreja não encontrada ou inativa.' using errcode = 'P0002';
  end if;

  -- 2) Operador SHARE
  select ca.id into v_access_id
  from app_private.church_access ca
  join auth.users u on u.id = ca.user_id
  join app_private.members m on m.church_id = ca.church_id and m.id = ca.member_id
  where ca.church_id = p_church_id
    and ca.user_id = v_user_id
    and ca.is_admin = true
    and ca.status = 'active'
    and ca.onboarding_completed_at is not null
    and m.status = 'active'
    and u.email_confirmed_at is not null
    and u.deleted_at is null
    and not coalesce(u.is_anonymous, false)
    and (u.banned_until is null or u.banned_until <= clock_timestamp())
  for share;

  if v_access_id is null then
    raise exception 'Acesso administrativo não autorizado nesta igreja.' using errcode = '42501';
  end if;

  -- 3) Membro Alvo FOR UPDATE
  select m.id into v_target_member_id
  from app_private.members m
  where m.church_id = p_church_id and m.id = p_member_id and m.status = 'active'
  for update;

  if v_target_member_id is null then
    raise exception 'Membro não encontrado ou inativo.' using errcode = 'P0002';
  end if;

  -- Revalida ausência de vínculo ativo para o membro
  if exists (
    select 1 from app_private.church_access ca
    where ca.church_id = p_church_id and ca.member_id = p_member_id and ca.status = 'active'
  ) then
    raise exception 'Membro já possui acesso ativo na igreja.' using errcode = '23505';
  end if;

  -- Proibição de bypass de revogação
  if exists (
    select 1 from app_private.church_access ca
    where ca.church_id = p_church_id and ca.member_id = p_member_id and ca.status = 'revoked'
  ) then
    raise exception 'Membro possui vínculo anterior revogado. Convite não pode reativar vínculo revogado.' using errcode = '42501';
  end if;

  -- 4) Finalização de convite aberto anterior
  select ai.id into v_prev_invitation_id
  from app_private.access_invitations ai
  where ai.church_id = p_church_id and ai.member_id = p_member_id
    and ai.redeemed_at is null and ai.revoked_at is null
  for update;

  if v_prev_invitation_id is not null then
    update app_private.access_invitations
    set revoked_at = clock_timestamp(),
        revoked_by_user_id = v_user_id
    where id = v_prev_invitation_id;

    v_prev_inv_revoked := true;

    insert into app_private.audit_entries (
      church_id, action, actor_user_id, actor_source, maintenance_operator,
      target_type, target_id, details, occurred_at
    ) values (
      p_church_id, 'revoke_access_invitation', v_user_id, 'application', null,
      'access_invitations', v_prev_invitation_id,
      jsonb_build_object('reason', 'reissued_by_admin', 'member_id', p_member_id),
      clock_timestamp()
    );
  end if;

  -- 5) Se houver solicitação de alteração de nome pendente para este membro
  select ar.id, ar.expires_at into v_prev_request_id, v_prev_request_expires
  from app_private.access_requests ar
  where ar.church_id = p_church_id and ar.member_id = p_member_id and ar.status = 'pending'
  for update;

  if v_prev_request_id is not null then
    v_now := clock_timestamp();
    if v_now < v_prev_request_expires then
      update app_private.access_requests
      set status = 'cancelled',
          decided_at = v_now,
          decided_by_user_id = v_user_id
      where id = v_prev_request_id;

      v_prev_req_cancelled := true;

      insert into app_private.audit_entries (
        church_id, action, actor_user_id, actor_source, maintenance_operator,
        target_type, target_id, details, occurred_at
      ) values (
        p_church_id, 'cancel_access_request', v_user_id, 'application', null,
        'access_requests', v_prev_request_id,
        jsonb_build_object('reason', 'cancelled_due_to_invitation_reissue', 'member_id', p_member_id),
        v_now
      );
    else
      update app_private.access_requests
      set status = 'expired',
          decided_at = v_now,
          decided_by_user_id = null
      where id = v_prev_request_id;

      insert into app_private.audit_entries (
        church_id, action, actor_user_id, actor_source, maintenance_operator,
        target_type, target_id, details, occurred_at
      ) values (
        p_church_id, 'expire_access_request', v_user_id, 'application', null,
        'access_requests', v_prev_request_id,
        jsonb_build_object('reason', 'expired_without_decision', 'member_id', p_member_id),
        v_now
      );
    end if;
  end if;

  -- Geração CSPRNG estrita de 32 bytes (256 bits) sem fallbacks fracos
  select n.nspname into v_crypto_ns
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  left join pg_catalog.pg_depend d on d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e'
  left join pg_catalog.pg_extension ext on ext.oid = d.refobjid
  where p.proname = 'gen_random_bytes'
    and n.nspname in ('extensions', 'public', 'pg_catalog')
    and p.pronargs = 1
    and p.proargtypes[0] = 'integer'::regtype
    and p.prorettype = 'bytea'::regtype
    and (n.nspname = 'pg_catalog' or ext.extname = 'pgcrypto')
  order by case when n.nspname = 'extensions' then 1 when n.nspname = 'public' then 2 else 3 end
  limit 1;

  if v_crypto_ns is null then
    raise exception 'Função gen_random_bytes(integer) não disponível no ambiente.' using errcode = '0A000';
  end if;

  execute format('select %I.gen_random_bytes(32)', v_crypto_ns) into v_raw_bytes;

  if v_raw_bytes is null or octet_length(v_raw_bytes) <> 32 then
    raise exception 'Falha na geração de entropia criptográfica.' using errcode = 'XX000';
  end if;

  v_raw_token := pg_catalog.rtrim(
    pg_catalog.replace(
      pg_catalog.replace(
        pg_catalog.replace(
          pg_catalog.encode(v_raw_bytes, 'base64'),
          '+', '-'
        ),
        '/', '_'
      ),
      E'\n', ''
    ),
    '='
  );

  v_token_digest := pg_catalog.sha256(pg_catalog.convert_to(v_raw_token, 'UTF8'));

  -- Captura do relógio no instante exato pós-bloqueios para cumprimento da restrição física de 72h
  v_now := clock_timestamp();
  v_expires_at := v_now + interval '72 hours';
  v_new_invitation_id := gen_random_uuid();

  insert into app_private.access_invitations (
    id, church_id, member_id, recipient_email, token_digest,
    issued_by_user_id, issued_at, expires_at
  ) values (
    v_new_invitation_id, p_church_id, p_member_id, v_clean_email, v_token_digest,
    v_user_id, v_now, v_expires_at
  );

  insert into app_private.audit_entries (
    church_id, action, actor_user_id, actor_source, maintenance_operator,
    target_type, target_id, details, occurred_at
  ) values (
    p_church_id, 'issue_access_invitation', v_user_id, 'application', null,
    'access_invitations', v_new_invitation_id,
    jsonb_build_object(
      'member_id', p_member_id,
      'expires_at', v_expires_at,
      'reissue', (v_prev_inv_revoked or v_prev_req_cancelled)
    ),
    v_now
  );

  v_result_payload := jsonb_build_object(
    'invitation_id', v_new_invitation_id,
    'church_id', p_church_id,
    'member_id', p_member_id,
    'recipient_email', v_clean_email,
    'expires_at', v_expires_at,
    'issued_at', v_now,
    'previous_invitation_revoked', v_prev_inv_revoked,
    'previous_request_cancelled', v_prev_req_cancelled,
    'link_unrecoverable', true
  );

  insert into app_private.command_receipts (
    church_id, user_id, command_id, action, params_hash,
    result_member_id, result_entity_id, result_payload, created_at
  ) values (
    p_church_id, v_user_id, p_command_id, 'issue_invitation', v_params_hash,
    p_member_id, v_new_invitation_id, v_result_payload, v_now
  );

  return query
  select
    v_new_invitation_id,
    p_church_id,
    p_member_id,
    v_clean_email,
    v_raw_token,
    v_expires_at,
    v_now,
    v_prev_inv_revoked,
    v_prev_req_cancelled;
end;
$function$;

create or replace function public.redeem_invitation_confirm_name(
  p_command_id uuid,
  p_raw_token text,
  p_expected_display_name text
)
returns table (
  church_id uuid,
  church_name text,
  member_id uuid,
  display_name text,
  access_granted boolean,
  onboarding_completed_at timestamptz
)
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $function$
declare
  v_user_id uuid;
  v_user_email text;
  v_clean_expected_name text;
  v_token_digest bytea;
  v_params_json jsonb;
  v_params_hash bytea;
  v_existing_action text;
  v_existing_hash bytea;
  v_existing_payload jsonb;
  v_invitation_id uuid;
  v_church_id uuid;
  v_church_name text;
  v_member_id uuid;
  v_recipient_email text;
  v_expires_at timestamptz;
  v_issuer_id uuid;
  v_redeemed_at timestamptz;
  v_revoked_at timestamptz;
  v_locked_church_id uuid;
  v_locked_member_id uuid;
  v_current_display_name text;
  v_locked_inv_id uuid;
  v_locked_expires_at timestamptz;
  v_now timestamptz;
  v_new_access_id uuid;
  v_result_payload jsonb;
begin
  -- 016: decisões após espera exigem snapshots novos por instrução.
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Esta operação exige READ COMMITTED.' using errcode = '42501';
  end if;
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if p_command_id is null or p_raw_token is null or p_expected_display_name is null then
    raise exception 'Parâmetros obrigatórios incompletos.' using errcode = '22004';
  end if;

  if char_length(p_raw_token) not between 43 and 44 or p_raw_token !~ '^[A-Za-z0-9_-]+$' then
    raise exception 'Token de convite em formato inválido.' using errcode = '23514';
  end if;

  v_clean_expected_name := pg_catalog.btrim(pg_catalog.normalize(p_expected_display_name, 'NFC'));
  v_token_digest := pg_catalog.sha256(pg_catalog.convert_to(p_raw_token, 'UTF8'));

  v_params_json := jsonb_build_object(
    'v', 2,
    'action', 'redeem_confirm_name',
    'token_digest', pg_catalog.encode(v_token_digest, 'hex'),
    'expected_display_name', v_clean_expected_name
  );
  v_params_hash := pg_catalog.sha256(pg_catalog.convert_to(v_params_json::text, 'UTF8'));

  -- Serialização transacional do comando por (auth.uid(), command_id) antes de bloqueios de domínio
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(v_user_id::text), pg_catalog.hashtext(p_command_id::text));

  -- Reconsulta de recibo existente
  select cr.action, cr.params_hash, cr.result_payload
  into v_existing_action, v_existing_hash, v_existing_payload
  from app_private.command_receipts cr
  where cr.user_id = v_user_id and cr.command_id = p_command_id;

  if v_existing_hash is not null then
    if v_existing_action <> 'redeem_confirm_name' or v_existing_hash <> v_params_hash then
      raise exception 'Comando já executado com parâmetros diferentes.' using errcode = '23505';
    end if;

    -- Revalidação estrita da conta atual antes da entrega do replay
    if not exists (
      select 1 from auth.users u
      where u.id = v_user_id
        and u.email_confirmed_at is not null
        and u.deleted_at is null
        and not coalesce(u.is_anonymous, false)
        and (u.banned_until is null or u.banned_until <= clock_timestamp())
    ) then
      raise exception 'Conta inelegível ou e-mail não confirmado.' using errcode = '42501';
    end if;

    return query
    select
      (v_existing_payload->>'church_id')::uuid,
      (v_existing_payload->>'church_name')::text,
      (v_existing_payload->>'member_id')::uuid,
      (v_existing_payload->>'display_name')::text,
      coalesce((v_existing_payload->>'access_granted')::boolean, true),
      (v_existing_payload->>'onboarding_completed_at')::timestamptz;
    return;
  end if;

  -- Localização prévia do convite pelo digest para ordenação canônica de bloqueios
  select ai.id, ai.church_id, ai.member_id, ai.recipient_email, ai.expires_at,
         ai.issued_by_user_id, ai.redeemed_at, ai.revoked_at
  into v_invitation_id, v_church_id, v_member_id, v_recipient_email, v_expires_at,
       v_issuer_id, v_redeemed_at, v_revoked_at
  from app_private.access_invitations ai
  where ai.token_digest = v_token_digest;

  if v_invitation_id is null or v_revoked_at is not null or v_redeemed_at is not null
     or clock_timestamp() >= v_expires_at then
    raise exception 'Convite inválido, revogado ou expirado.' using errcode = 'P0002';
  end if;

  -- 016: antes de qualquer lock de linha, inclusive do operador.
  perform pg_catalog.pg_advisory_xact_lock(hashtext('church_admin_continuity'), hashtext(v_church_id::text));

  -- Bloqueios de domínio na ordem canônica:
  -- 1) Igreja SHARE
  select c.id, c.name into v_locked_church_id, v_church_name
  from app_private.churches c
  where c.id = v_church_id and c.status = 'active'
  for share;

  if v_locked_church_id is null then
    raise exception 'Igreja inativa ou não encontrada.' using errcode = 'P0002';
  end if;

  -- 2) Membro Alvo UPDATE
  select m.id, m.display_name into v_locked_member_id, v_current_display_name
  from app_private.members m
  where m.church_id = v_church_id and m.id = v_member_id and m.status = 'active'
  for update;

  if v_locked_member_id is null then
    raise exception 'Membro inativo ou não encontrado.' using errcode = 'P0002';
  end if;

  -- 3) Convite UPDATE
  select ai.id, ai.expires_at, ai.recipient_email into v_locked_inv_id, v_locked_expires_at, v_recipient_email
  from app_private.access_invitations ai
  where ai.id = v_invitation_id and ai.redeemed_at is null and ai.revoked_at is null
  for update;

  if v_locked_inv_id is null then
    raise exception 'Convite não está mais aberto.' using errcode = 'P0002';
  end if;

  -- Revalidações estritas no instante pós-bloqueio no relógio atual
  v_now := clock_timestamp();
  if v_now >= v_locked_expires_at then
    raise exception 'Convite expirado.' using errcode = 'P0004';
  end if;

  -- Releitura da conta Auth no instante final pós-locks
  select u.email into v_user_email
  from auth.users u
  where u.id = v_user_id
    and u.email_confirmed_at is not null
    and u.deleted_at is null
    and not coalesce(u.is_anonymous, false)
    and (u.banned_until is null or u.banned_until <= v_now);

  if v_user_email is null then
    raise exception 'Conta inelegível ou e-mail não confirmado.' using errcode = '42501';
  end if;

  if pg_catalog.lower(pg_catalog.btrim(v_user_email)) <> pg_catalog.lower(pg_catalog.btrim(v_recipient_email)) then
    raise exception 'Convite não associado a esta conta.' using errcode = '42501';
  end if;

  if exists (
    select 1 from app_private.church_access ca
    where ca.church_id = v_church_id and ca.user_id = v_user_id and ca.status = 'active'
  ) then
    raise exception 'Usuário já possui acesso ativo nesta igreja.' using errcode = '23505';
  end if;

  if exists (
    select 1 from app_private.church_access ca
    where ca.church_id = v_church_id and ca.member_id = v_member_id and ca.status = 'active'
  ) then
    raise exception 'Membro já vinculado a outro acesso ativo.' using errcode = '23505';
  end if;

  -- Proibição de bypass de revogação
  if exists (
    select 1 from app_private.church_access ca
    where ca.church_id = v_church_id and (ca.user_id = v_user_id or ca.member_id = v_member_id)
      and ca.status = 'revoked'
  ) then
    raise exception 'Vínculo anterior revogado detectado. Resgate não pode reativar acesso revogado.' using errcode = '42501';
  end if;

  if v_current_display_name <> v_clean_expected_name then
    raise exception 'Nome do membro foi alterado antes da confirmação.' using errcode = 'P0005';
  end if;

  -- Consumo atômico do convite
  update app_private.access_invitations
  set redeemed_at = v_now,
      redeemed_by_user_id = v_user_id
  where id = v_invitation_id;

  v_new_access_id := gen_random_uuid();

  insert into app_private.church_access (
    id, church_id, user_id, member_id, status, is_admin,
    onboarding_completed_at, granted_by_user_id, granted_at, created_at, updated_at
  ) values (
    v_new_access_id, v_church_id, v_user_id, v_member_id, 'active', false,
    v_now, v_issuer_id, v_now, v_now, v_now
  );

  insert into app_private.audit_entries (
    church_id, action, actor_user_id, actor_source, maintenance_operator,
    target_type, target_id, details, occurred_at
  ) values (
    v_church_id, 'redeem_invitation_confirm_name', v_user_id, 'application', null,
    'church_access', v_new_access_id,
    jsonb_build_object('invitation_id', v_invitation_id, 'member_id', v_member_id),
    v_now
  );

  v_result_payload := jsonb_build_object(
    'church_id', v_church_id,
    'church_name', v_church_name,
    'member_id', v_member_id,
    'display_name', v_current_display_name,
    'access_granted', true,
    'onboarding_completed_at', v_now
  );

  insert into app_private.command_receipts (
    church_id, user_id, command_id, action, params_hash,
    result_member_id, result_entity_id, result_payload, created_at
  ) values (
    v_church_id, v_user_id, p_command_id, 'redeem_confirm_name', v_params_hash,
    v_member_id, v_new_access_id, v_result_payload, v_now
  );

  return query
  select v_church_id, v_church_name, v_member_id, v_current_display_name, true, v_now;
end;
$function$;

create or replace function public.redeem_invitation_propose_name(
  p_command_id uuid,
  p_raw_token text,
  p_proposed_display_name text
)
returns table (
  request_id uuid,
  church_id uuid,
  member_id uuid,
  original_display_name text,
  proposed_display_name text,
  status text,
  expires_at timestamptz,
  submitted_at timestamptz
)
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $function$
declare
  v_user_id uuid;
  v_user_email text;
  v_clean_proposed_name text;
  v_token_digest bytea;
  v_params_json jsonb;
  v_params_hash bytea;
  v_existing_action text;
  v_existing_hash bytea;
  v_existing_payload jsonb;
  v_invitation_id uuid;
  v_church_id uuid;
  v_member_id uuid;
  v_recipient_email text;
  v_expires_at timestamptz;
  v_redeemed_at timestamptz;
  v_revoked_at timestamptz;
  v_locked_church_id uuid;
  v_locked_member_id uuid;
  v_current_display_name text;
  v_locked_inv_id uuid;
  v_locked_expires_at timestamptz;
  v_now timestamptz;
  v_new_request_id uuid;
  v_result_payload jsonb;
begin
  -- 016: decisões após espera exigem snapshots novos por instrução.
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Esta operação exige READ COMMITTED.' using errcode = '42501';
  end if;
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if p_command_id is null or p_raw_token is null or p_proposed_display_name is null then
    raise exception 'Parâmetros obrigatórios incompletos.' using errcode = '22004';
  end if;

  if char_length(p_raw_token) not between 43 and 44 or p_raw_token !~ '^[A-Za-z0-9_-]+$' then
    raise exception 'Token de convite em formato inválido.' using errcode = '23514';
  end if;

  v_clean_proposed_name := pg_catalog.btrim(pg_catalog.normalize(p_proposed_display_name, 'NFC'));
  if char_length(v_clean_proposed_name) < 1 or char_length(v_clean_proposed_name) > 120 then
    raise exception 'Nome proposto deve ter entre 1 e 120 caracteres.' using errcode = '23514';
  end if;

  v_token_digest := pg_catalog.sha256(pg_catalog.convert_to(p_raw_token, 'UTF8'));

  v_params_json := jsonb_build_object(
    'v', 2,
    'action', 'redeem_propose_name',
    'token_digest', pg_catalog.encode(v_token_digest, 'hex'),
    'proposed_display_name', v_clean_proposed_name
  );
  v_params_hash := pg_catalog.sha256(pg_catalog.convert_to(v_params_json::text, 'UTF8'));

  -- Serialização transacional do comando por (auth.uid(), command_id) antes de bloqueios de domínio
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(v_user_id::text), pg_catalog.hashtext(p_command_id::text));

  -- Reconsulta de recibo existente
  select cr.action, cr.params_hash, cr.result_payload
  into v_existing_action, v_existing_hash, v_existing_payload
  from app_private.command_receipts cr
  where cr.user_id = v_user_id and cr.command_id = p_command_id;

  if v_existing_hash is not null then
    if v_existing_action <> 'redeem_propose_name' or v_existing_hash <> v_params_hash then
      raise exception 'Comando já executado com parâmetros diferentes.' using errcode = '23505';
    end if;

    -- Revalidação estrita da conta atual antes da entrega do replay
    if not exists (
      select 1 from auth.users u
      where u.id = v_user_id
        and u.email_confirmed_at is not null
        and u.deleted_at is null
        and not coalesce(u.is_anonymous, false)
        and (u.banned_until is null or u.banned_until <= clock_timestamp())
    ) then
      raise exception 'Conta inelegível ou e-mail não confirmado.' using errcode = '42501';
    end if;

    return query
    select
      (v_existing_payload->>'request_id')::uuid,
      (v_existing_payload->>'church_id')::uuid,
      (v_existing_payload->>'member_id')::uuid,
      (v_existing_payload->>'original_display_name')::text,
      (v_existing_payload->>'proposed_display_name')::text,
      (v_existing_payload->>'status')::text,
      (v_existing_payload->>'expires_at')::timestamptz,
      (v_existing_payload->>'submitted_at')::timestamptz;
    return;
  end if;

  -- Localização prévia do convite pelo digest
  select ai.id, ai.church_id, ai.member_id, ai.recipient_email, ai.expires_at,
         ai.redeemed_at, ai.revoked_at
  into v_invitation_id, v_church_id, v_member_id, v_recipient_email, v_expires_at,
       v_redeemed_at, v_revoked_at
  from app_private.access_invitations ai
  where ai.token_digest = v_token_digest;

  if v_invitation_id is null or v_revoked_at is not null or v_redeemed_at is not null
     or clock_timestamp() >= v_expires_at then
    raise exception 'Convite inválido, revogado ou expirado.' using errcode = 'P0002';
  end if;

  -- 016: antes de qualquer lock de linha, inclusive do operador.
  perform pg_catalog.pg_advisory_xact_lock(hashtext('church_admin_continuity'), hashtext(v_church_id::text));

  -- Bloqueios de domínio na ordem canônica:
  -- 1) Igreja SHARE
  select c.id into v_locked_church_id
  from app_private.churches c
  where c.id = v_church_id and c.status = 'active'
  for share;

  if v_locked_church_id is null then
    raise exception 'Igreja inativa ou não encontrada.' using errcode = 'P0002';
  end if;

  -- 2) Membro Alvo UPDATE
  select m.id, m.display_name into v_locked_member_id, v_current_display_name
  from app_private.members m
  where m.church_id = v_church_id and m.id = v_member_id and m.status = 'active'
  for update;

  if v_locked_member_id is null then
    raise exception 'Membro inativo ou não encontrado.' using errcode = 'P0002';
  end if;

  -- 3) Convite UPDATE
  select ai.id, ai.expires_at, ai.recipient_email into v_locked_inv_id, v_locked_expires_at, v_recipient_email
  from app_private.access_invitations ai
  where ai.id = v_invitation_id and ai.redeemed_at is null and ai.revoked_at is null
  for update;

  if v_locked_inv_id is null then
    raise exception 'Convite não está mais aberto.' using errcode = 'P0002';
  end if;

  -- Revalidações estritas no instante pós-bloqueio no relógio atual
  v_now := clock_timestamp();
  if v_now >= v_locked_expires_at then
    raise exception 'Convite expirado.' using errcode = 'P0004';
  end if;

  -- Releitura da conta Auth no instante final pós-locks
  select u.email into v_user_email
  from auth.users u
  where u.id = v_user_id
    and u.email_confirmed_at is not null
    and u.deleted_at is null
    and not coalesce(u.is_anonymous, false)
    and (u.banned_until is null or u.banned_until <= v_now);

  if v_user_email is null then
    raise exception 'Conta inelegível ou e-mail não confirmado.' using errcode = '42501';
  end if;

  if pg_catalog.lower(pg_catalog.btrim(v_user_email)) <> pg_catalog.lower(pg_catalog.btrim(v_recipient_email)) then
    raise exception 'Convite não associado a esta conta.' using errcode = '42501';
  end if;

  if exists (
    select 1 from app_private.church_access ca
    where ca.church_id = v_church_id and ca.user_id = v_user_id and ca.status = 'active'
  ) then
    raise exception 'Usuário já possui acesso ativo nesta igreja.' using errcode = '23505';
  end if;

  if exists (
    select 1 from app_private.church_access ca
    where ca.church_id = v_church_id and ca.member_id = v_member_id and ca.status = 'active'
  ) then
    raise exception 'Membro já vinculado a outro acesso ativo.' using errcode = '23505';
  end if;

  -- Proibição de bypass de revogação
  if exists (
    select 1 from app_private.church_access ca
    where ca.church_id = v_church_id and (ca.user_id = v_user_id or ca.member_id = v_member_id)
      and ca.status = 'revoked'
  ) then
    raise exception 'Vínculo anterior revogado detectado. Proposta de acesso não permitida.' using errcode = '42501';
  end if;

  if v_clean_proposed_name = v_current_display_name then
    raise exception 'Nome proposto deve ser diferente do nome atualmente cadastrado.' using errcode = '23514';
  end if;

  -- Consumo do convite primeiro (para satisfazer a FK requests_consumed_invitation_fk)
  update app_private.access_invitations
  set redeemed_at = v_now,
      redeemed_by_user_id = v_user_id
  where id = v_invitation_id;

  v_new_request_id := gen_random_uuid();

  insert into app_private.access_requests (
    id, church_id, member_id, invitation_id, requester_user_id,
    original_display_name, proposed_display_name, submitted_at, expires_at,
    status, created_at, updated_at
  ) values (
    v_new_request_id, v_church_id, v_member_id, v_invitation_id, v_user_id,
    v_current_display_name, v_clean_proposed_name, v_now, v_locked_expires_at,
    'pending', v_now, v_now
  );

  insert into app_private.audit_entries (
    church_id, action, actor_user_id, actor_source, maintenance_operator,
    target_type, target_id, details, occurred_at
  ) values (
    v_church_id, 'redeem_invitation_propose_name', v_user_id, 'application', null,
    'access_requests', v_new_request_id,
    jsonb_build_object('invitation_id', v_invitation_id, 'member_id', v_member_id),
    v_now
  );

  v_result_payload := jsonb_build_object(
    'request_id', v_new_request_id,
    'church_id', v_church_id,
    'member_id', v_member_id,
    'original_display_name', v_current_display_name,
    'proposed_display_name', v_clean_proposed_name,
    'status', 'pending',
    'expires_at', v_locked_expires_at,
    'submitted_at', v_now
  );

  insert into app_private.command_receipts (
    church_id, user_id, command_id, action, params_hash,
    result_member_id, result_entity_id, result_payload, created_at
  ) values (
    v_church_id, v_user_id, p_command_id, 'redeem_propose_name', v_params_hash,
    v_member_id, v_new_request_id, v_result_payload, v_now
  );

  return query
  select v_new_request_id, v_church_id, v_member_id, v_current_display_name, v_clean_proposed_name,
         'pending'::text, v_locked_expires_at, v_now;
end;
$function$;

create or replace function public.decide_access_request(
  p_command_id uuid,
  p_church_id uuid,
  p_request_id uuid,
  p_decision text
)
returns table (
  request_id uuid,
  member_id uuid,
  final_display_name text,
  decision text,
  access_granted boolean,
  decided_at timestamptz,
  error_code text
)
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $function$
declare
  v_user_id uuid;
  v_params_json jsonb;
  v_params_hash bytea;
  v_existing_action text;
  v_existing_hash bytea;
  v_existing_payload jsonb;
  v_church_id uuid;
  v_access_id uuid;
  v_target_member_id uuid;
  v_current_display_name text;
  v_req_id uuid;
  v_original_name text;
  v_proposed_name text;
  v_requester_user_id uuid;
  v_req_expires_at timestamptz;
  v_req_status text;
  v_invitation_id uuid;
  v_inv_id uuid;
  v_inv_recipient_email text;
  v_inv_redeemed_at timestamptz;
  v_inv_redeemed_by uuid;
  v_inv_revoked_at timestamptz;
  v_requester_email text;
  v_now timestamptz;
  v_new_access_id uuid;
  v_result_payload jsonb;
begin
  -- 016: decisões após espera exigem snapshots novos por instrução.
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Esta operação exige READ COMMITTED.' using errcode = '42501';
  end if;
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if p_command_id is null or p_church_id is null or p_request_id is null or p_decision is null then
    raise exception 'Parâmetros obrigatórios incompletos.' using errcode = '22004';
  end if;

  if p_decision not in ('approve', 'reject') then
    raise exception 'Decisão deve ser approve ou reject.' using errcode = '23514';
  end if;

  v_params_json := jsonb_build_object(
    'v', 2,
    'action', 'decide_access_request',
    'church_id', p_church_id,
    'request_id', p_request_id,
    'decision', p_decision
  );
  v_params_hash := pg_catalog.sha256(pg_catalog.convert_to(v_params_json::text, 'UTF8'));

  -- Serialização transacional do comando por (auth.uid(), command_id) antes de bloqueios de domínio
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(v_user_id::text), pg_catalog.hashtext(p_command_id::text));

  -- 016: antes de qualquer lock de linha, inclusive do operador.
  perform pg_catalog.pg_advisory_xact_lock(hashtext('church_admin_continuity'), hashtext(p_church_id::text));


  -- Reconsulta de recibo existente
  select cr.action, cr.params_hash, cr.result_payload
  into v_existing_action, v_existing_hash, v_existing_payload
  from app_private.command_receipts cr
  where cr.user_id = v_user_id and cr.command_id = p_command_id;

  if v_existing_hash is not null then
    if v_existing_action <> 'decide_access_request' or v_existing_hash <> v_params_hash then
      raise exception 'Comando já executado com parâmetros diferentes.' using errcode = '23505';
    end if;

    -- Revalida autorização administrativa atual antes da entrega do replay
    if not exists (
      select 1
      from app_private.church_access ca
      join auth.users u on u.id = ca.user_id
      join app_private.churches c on c.id = ca.church_id
      join app_private.members m on m.church_id = ca.church_id and m.id = ca.member_id
      where ca.church_id = p_church_id
        and ca.user_id = v_user_id
        and ca.is_admin = true
        and ca.status = 'active'
        and ca.onboarding_completed_at is not null
        and c.status = 'active'
        and m.status = 'active'
        and u.email_confirmed_at is not null
        and u.deleted_at is null
        and not coalesce(u.is_anonymous, false)
        and (u.banned_until is null or u.banned_until <= clock_timestamp())
    ) then
      raise exception 'Acesso administrativo não autorizado nesta igreja.' using errcode = '42501';
    end if;

    return query
    select
      (v_existing_payload->>'request_id')::uuid,
      (v_existing_payload->>'member_id')::uuid,
      (v_existing_payload->>'final_display_name')::text,
      (v_existing_payload->>'decision')::text,
      coalesce((v_existing_payload->>'access_granted')::boolean, false),
      (v_existing_payload->>'decided_at')::timestamptz,
      (v_existing_payload->>'error_code')::text;
    return;
  end if;

  -- Localização prévia da solicitação para identificar member_id e invitation_id
  select ar.member_id, ar.invitation_id
  into v_target_member_id, v_invitation_id
  from app_private.access_requests ar
  where ar.id = p_request_id and ar.church_id = p_church_id;

  if v_target_member_id is null or v_invitation_id is null then
    raise exception 'Solicitação não encontrada nesta igreja.' using errcode = 'P0002';
  end if;

  -- Bloqueios de domínio na ordem canônica estrita:
  -- 1) Igreja SHARE
  select c.id into v_church_id
  from app_private.churches c
  where c.id = p_church_id and c.status = 'active'
  for share;

  if v_church_id is null then
    raise exception 'Igreja não encontrada ou inativa.' using errcode = 'P0002';
  end if;

  -- 2) Operador SHARE
  select ca.id into v_access_id
  from app_private.church_access ca
  join auth.users u on u.id = ca.user_id
  join app_private.members m on m.church_id = ca.church_id and m.id = ca.member_id
  where ca.church_id = p_church_id
    and ca.user_id = v_user_id
    and ca.is_admin = true
    and ca.status = 'active'
    and ca.onboarding_completed_at is not null
    and m.status = 'active'
    and u.email_confirmed_at is not null
    and u.deleted_at is null
    and not coalesce(u.is_anonymous, false)
    and (u.banned_until is null or u.banned_until <= clock_timestamp())
  for share;

  if v_access_id is null then
    raise exception 'Acesso administrativo não autorizado nesta igreja.' using errcode = '42501';
  end if;

  -- 3) Membro Alvo UPDATE
  select m.id, m.display_name into v_target_member_id, v_current_display_name
  from app_private.members m
  where m.church_id = p_church_id and m.id = v_target_member_id and m.status = 'active'
  for update;

  if v_target_member_id is null then
    raise exception 'Membro inativo ou não encontrado.' using errcode = 'P0002';
  end if;

  -- 4) Convite Original Consumido UPDATE (adquirido e revalidado antes da solicitação)
  select ai.id, ai.recipient_email, ai.redeemed_at, ai.redeemed_by_user_id, ai.revoked_at
  into v_inv_id, v_inv_recipient_email, v_inv_redeemed_at, v_inv_redeemed_by, v_inv_revoked_at
  from app_private.access_invitations ai
  where ai.id = v_invitation_id and ai.church_id = p_church_id and ai.member_id = v_target_member_id
  for update;

  if v_inv_id is null then
    raise exception 'Convite original associado não encontrado.' using errcode = 'P0002';
  end if;

  -- 5) Solicitação UPDATE
  select ar.id, ar.original_display_name, ar.proposed_display_name, ar.requester_user_id,
         ar.expires_at, ar.status
  into v_req_id, v_original_name, v_proposed_name, v_requester_user_id,
       v_req_expires_at, v_req_status
  from app_private.access_requests ar
  where ar.id = p_request_id and ar.church_id = p_church_id
  for update;

  if v_req_status <> 'pending' then
    raise exception 'Solicitação já foi decidida anteriormente.' using errcode = '23505';
  end if;

  v_now := clock_timestamp();

  -- Validação de expiração no instante pós-bloqueio: retorno estruturado com finalização persistida
  if v_now >= v_req_expires_at then
    update app_private.access_requests
    set status = 'expired',
        decided_at = v_now,
        decided_by_user_id = null
    where id = p_request_id;

    insert into app_private.audit_entries (
      church_id, action, actor_user_id, actor_source, maintenance_operator,
      target_type, target_id, details, occurred_at
    ) values (
      p_church_id, 'expire_access_request', v_user_id, 'application', null,
      'access_requests', p_request_id,
      jsonb_build_object('member_id', v_target_member_id, 'reason', 'expired_without_decision'),
      v_now
    );

    v_result_payload := jsonb_build_object(
      'request_id', p_request_id,
      'member_id', v_target_member_id,
      'final_display_name', v_current_display_name,
      'decision', 'expired',
      'access_granted', false,
      'decided_at', v_now,
      'error_code', 'REQUEST_EXPIRED'
    );

    insert into app_private.command_receipts (
      church_id, user_id, command_id, action, params_hash,
      result_member_id, result_entity_id, result_payload, created_at
    ) values (
      p_church_id, v_user_id, p_command_id, 'decide_access_request', v_params_hash,
      v_target_member_id, p_request_id, v_result_payload, v_now
    );

    return query
    select p_request_id, v_target_member_id, v_current_display_name, 'expired'::text, false, v_now, 'REQUEST_EXPIRED'::text;
    return;
  end if;

  -- Ramo APROVAÇÃO
  if p_decision = 'approve' then
    -- Revalida convite original: consumido pelo solicitante e não revogado
    if v_inv_redeemed_at is null or v_inv_redeemed_by <> v_requester_user_id or v_inv_revoked_at is not null then
      raise exception 'Convite original não está em estado consumido válido para aprovação.' using errcode = 'P0002';
    end if;

    -- Comparação obrigatória do nome original: impede sobrescrita silenciosa em modificação concorrente
    if v_current_display_name <> v_original_name then
      raise exception 'Cadastro do membro foi modificado concorrentemente durante a análise da solicitação.' using errcode = 'P0005';
    end if;

    -- Revalida conta do solicitante no instante final pós-locks
    select u.email into v_requester_email
    from auth.users u
    where u.id = v_requester_user_id
      and u.email_confirmed_at is not null
      and u.deleted_at is null
      and not coalesce(u.is_anonymous, false)
      and (u.banned_until is null or u.banned_until <= v_now);

    if v_requester_email is null then
      raise exception 'Conta do solicitante inelegível ou e-mail não confirmado.' using errcode = '42501';
    end if;

    -- Correspondência estrita de e-mail atual do solicitante com recipient_email do convite original
    if pg_catalog.lower(pg_catalog.btrim(v_requester_email)) <> pg_catalog.lower(pg_catalog.btrim(v_inv_recipient_email)) then
      raise exception 'E-mail atual do solicitante não corresponde mais ao convite original.' using errcode = '42501';
    end if;

    -- Revalida ausência de vínculo ativo
    if exists (
      select 1 from app_private.church_access ca
      where ca.church_id = p_church_id and ca.user_id = v_requester_user_id and ca.status = 'active'
    ) then
      raise exception 'Solicitante já possui acesso ativo nesta igreja.' using errcode = '23505';
    end if;

    if exists (
      select 1 from app_private.church_access ca
      where ca.church_id = p_church_id and ca.member_id = v_target_member_id and ca.status = 'active'
    ) then
      raise exception 'Membro já vinculado a outro acesso ativo.' using errcode = '23505';
    end if;

    -- Proibição de bypass de revogação
    if exists (
      select 1 from app_private.church_access ca
      where ca.church_id = p_church_id
        and (ca.user_id = v_requester_user_id or ca.member_id = v_target_member_id)
        and ca.status = 'revoked'
    ) then
      raise exception 'Vínculo anterior revogado detectado. Aprovação não pode reativar acesso revogado.' using errcode = '42501';
    end if;

    -- Atualização do cadastro do membro com o nome proposto aprovado
    update app_private.members
    set display_name = v_proposed_name,
        updated_at = v_now
    where id = v_target_member_id;

    v_new_access_id := gen_random_uuid();

    insert into app_private.church_access (
      id, church_id, user_id, member_id, status, is_admin,
      onboarding_completed_at, granted_by_user_id, granted_at, created_at, updated_at
    ) values (
      v_new_access_id, p_church_id, v_requester_user_id, v_target_member_id, 'active', false,
      v_now, v_user_id, v_now, v_now, v_now
    );

    update app_private.access_requests
    set status = 'approved',
        decided_at = v_now,
        decided_by_user_id = v_user_id
    where id = p_request_id;

    insert into app_private.audit_entries (
      church_id, action, actor_user_id, actor_source, maintenance_operator,
      target_type, target_id, details, occurred_at
    ) values (
      p_church_id, 'approve_access_request', v_user_id, 'application', null,
      'access_requests', p_request_id,
      jsonb_build_object('member_id', v_target_member_id, 'access_id', v_new_access_id),
      v_now
    );

    v_result_payload := jsonb_build_object(
      'request_id', p_request_id,
      'member_id', v_target_member_id,
      'final_display_name', v_proposed_name,
      'decision', 'approved',
      'access_granted', true,
      'decided_at', v_now,
      'error_code', null
    );

    insert into app_private.command_receipts (
      church_id, user_id, command_id, action, params_hash,
      result_member_id, result_entity_id, result_payload, created_at
    ) values (
      p_church_id, v_user_id, p_command_id, 'decide_access_request', v_params_hash,
      v_target_member_id, p_request_id, v_result_payload, v_now
    );

    return query
    select p_request_id, v_target_member_id, v_proposed_name, 'approved'::text, true, v_now, null::text;
    return;
  end if;

  -- Ramo REJEIÇÃO
  -- A rejeição encerra definitivamente a tentativa sem alterar membro e sem conceder acesso
  update app_private.access_requests
  set status = 'rejected',
      decided_at = v_now,
      decided_by_user_id = v_user_id
  where id = p_request_id;

  insert into app_private.audit_entries (
    church_id, action, actor_user_id, actor_source, maintenance_operator,
    target_type, target_id, details, occurred_at
  ) values (
    p_church_id, 'reject_access_request', v_user_id, 'application', null,
    'access_requests', p_request_id,
    jsonb_build_object('member_id', v_target_member_id),
    v_now
  );

  v_result_payload := jsonb_build_object(
    'request_id', p_request_id,
    'member_id', v_target_member_id,
    'final_display_name', v_current_display_name,
    'decision', 'rejected',
    'access_granted', false,
    'decided_at', v_now,
    'error_code', null
  );

  insert into app_private.command_receipts (
    church_id, user_id, command_id, action, params_hash,
    result_member_id, result_entity_id, result_payload, created_at
  ) values (
    p_church_id, v_user_id, p_command_id, 'decide_access_request', v_params_hash,
    v_target_member_id, p_request_id, v_result_payload, v_now
  );

  return query
  select p_request_id, v_target_member_id, v_current_display_name, 'rejected'::text, false, v_now, null::text;
end;
$function$;

create or replace function public.create_church_team(
  p_church_id uuid,
  p_command_id uuid,
  p_name text,
  p_leader_member_id uuid default null
)
returns table (
  command_id uuid,
  action text,
  church_id uuid,
  result_entity_id uuid,
  result_payload jsonb,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $function$
declare
  v_user_id uuid;
  v_caller_member_id uuid;
  v_is_admin boolean;
  v_name_clean text;
  v_params_hash bytea;
  v_existing_receipt record;
  v_team_id uuid;
  v_payload jsonb;
  v_created_at timestamptz;
  c_action constant text := 'create_church_team';
begin
  -- 016: decisões após espera exigem snapshots novos por instrução.
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Esta operação exige READ COMMITTED.' using errcode = '42501';
  end if;
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if p_church_id is null or p_command_id is null or p_name is null then
    raise exception 'Parâmetros obrigatórios ausentes.' using errcode = '22004';
  end if;

  v_name_clean := btrim(normalize(p_name, NFC));
  if char_length(v_name_clean) < 1 or char_length(v_name_clean) > 100 then
    raise exception 'Nome de equipe deve ter entre 1 e 100 caracteres.' using errcode = '22000';
  end if;

  -- Advisory lock imediato para estabilizar o contexto do comando
  perform pg_advisory_xact_lock(hashtext(v_user_id::text), hashtext(p_command_id::text));

  -- B2-03: Autorização vigente sob contexto real de igreja/membro/acesso com predicados Auth completos
  select ca.member_id, ca.is_admin
  into v_caller_member_id, v_is_admin
  from app_private.church_access ca
  join auth.users u on u.id = ca.user_id
  join app_private.churches c on c.id = ca.church_id
  join app_private.members m on m.id = ca.member_id and m.church_id = ca.church_id
  where ca.user_id = v_user_id
    and ca.church_id = p_church_id
    and ca.status = 'active'
    and ca.onboarding_completed_at is not null
    and c.status = 'active'
    and m.status = 'active'
    and u.email_confirmed_at is not null
    and u.deleted_at is null
    and not coalesce(u.is_anonymous, false)
    and (u.banned_until is null or u.banned_until <= clock_timestamp());

  if v_caller_member_id is null or not coalesce(v_is_admin, false) then
    raise exception 'Apenas administradores ativos podem criar equipes.' using errcode = '42501';
  end if;

  v_params_hash := pg_catalog.sha256(convert_to(jsonb_build_object(
    'action', c_action,
    'church_id', p_church_id,
    'name', v_name_clean,
    'leader_member_id', p_leader_member_id
  )::text, 'UTF8'));

  select cr.command_id, cr.action, cr.church_id, cr.result_entity_id, cr.result_payload, cr.created_at, cr.params_hash
  into v_existing_receipt
  from app_private.command_receipts cr
  where cr.user_id = v_user_id
    and cr.command_id = p_command_id;

  if v_existing_receipt.command_id is not null then
    if not coalesce(v_is_admin, false) then
      raise exception 'Apenas administradores ativos podem criar equipes.' using errcode = '42501';
    end if;
    if v_existing_receipt.action <> c_action or v_existing_receipt.church_id <> p_church_id then
      raise exception 'Identificador de comando já utilizado para outra operação.' using errcode = 'P0020';
    end if;
    if v_existing_receipt.params_hash <> v_params_hash then
      raise exception 'Comando já executado com parâmetros divergentes.' using errcode = 'P0020';
    end if;
    return query
    select v_existing_receipt.command_id, v_existing_receipt.action, v_existing_receipt.church_id,
           v_existing_receipt.result_entity_id, v_existing_receipt.result_payload, v_existing_receipt.created_at;
    return;
  end if;

  if p_leader_member_id is not null then
    perform 1 from app_private.members m
    where m.church_id=p_church_id and m.id=p_leader_member_id and m.status='active' for update;
    if not found then raise exception 'Responsável não encontrado ou inativo nesta igreja.' using errcode='P0020'; end if;
  end if;

  select ca.member_id, ca.is_admin
  into v_caller_member_id, v_is_admin
  from app_private.church_access ca
  join auth.users u on u.id = ca.user_id
  join app_private.churches c on c.id = ca.church_id
  join app_private.members m on m.id = ca.member_id and m.church_id = ca.church_id
  where ca.user_id = v_user_id
    and ca.church_id = p_church_id
    and ca.status = 'active'
    and ca.onboarding_completed_at is not null
    and c.status = 'active'
    and m.status = 'active'
    and u.email_confirmed_at is not null
    and u.deleted_at is null
    and not coalesce(u.is_anonymous, false)
    and (u.banned_until is null or u.banned_until <= clock_timestamp());
  if v_caller_member_id is null or not coalesce(v_is_admin,false) then
    raise exception 'Apenas administradores ativos podem criar equipes.' using errcode='42501';
  end if;

  if p_leader_member_id is not null then
    if not exists (
      select 1 from app_private.members m
      where m.church_id = p_church_id and m.id = p_leader_member_id and m.status = 'active'
    ) then
      raise exception 'Líder indicado não encontrado ou inativo nesta igreja.' using errcode = 'P0020';
    end if;
  end if;

  if exists (
    select 1 from app_private.teams t
    where t.church_id = p_church_id and t.name = v_name_clean
  ) then
    raise exception 'Já existe equipe com este nome nesta igreja.' using errcode = '23505';
  end if;

  insert into app_private.teams as t (church_id, name, leader_member_id, status)
  values (p_church_id, v_name_clean, p_leader_member_id, 'active')
  returning t.id, t.created_at into v_team_id, v_created_at;

  if p_leader_member_id is not null then
    insert into app_private.team_memberships as tm (church_id, team_id, member_id, status)
    values (p_church_id, v_team_id, p_leader_member_id, 'active')
    on conflict on constraint tm_church_team_member_unique do update set status = 'active', updated_at = clock_timestamp();
  end if;

  v_payload := jsonb_build_object(
    'team_id', v_team_id,
    'name', v_name_clean,
    'leader_member_id', p_leader_member_id,
    'status', 'active'
  );

  insert into app_private.audit_entries (
    church_id, action, actor_user_id, actor_source, maintenance_operator,
    target_type, target_id, details, occurred_at
  ) values (
    p_church_id, c_action, v_user_id, 'application', null,
    'team', v_team_id, v_payload, v_created_at
  );

  insert into app_private.command_receipts (
    church_id, user_id, command_id, action, params_hash,
    result_member_id, result_entity_id, result_payload, created_at
  ) values (
    p_church_id, v_user_id, p_command_id, c_action, v_params_hash,
    null, v_team_id, v_payload, v_created_at
  );

  return query
  select p_command_id, c_action, p_church_id, v_team_id, v_payload, v_created_at;
end;
$function$;

create or replace function public.create_church_event(
  p_church_id uuid,
  p_command_id uuid,
  p_title text,
  p_event_type text,
  p_planned_start_at timestamptz,
  p_planned_end_at timestamptz,
  p_liturgy_leader_member_id uuid default null
)
returns table (
  command_id uuid,
  action text,
  church_id uuid,
  result_entity_id uuid,
  result_payload jsonb,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $function$
declare
  v_user_id uuid;
  v_caller_member_id uuid;
  v_is_admin boolean;
  v_is_ministry_leader boolean;
  v_timezone text;
  v_title_clean text;
  v_type_clean text;
  v_params_hash bytea;
  v_existing_receipt record;
  v_event_id uuid;
  v_payload jsonb;
  v_created_at timestamptz;
  c_action constant text := 'create_church_event';
begin
  -- 016: decisões após espera exigem snapshots novos por instrução.
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Esta operação exige READ COMMITTED.' using errcode = '42501';
  end if;
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if p_church_id is null or p_command_id is null or p_title is null or p_planned_start_at is null or p_planned_end_at is null then
    raise exception 'Parâmetros obrigatórios ausentes.' using errcode = '22004';
  end if;

  v_title_clean := btrim(normalize(p_title, NFC));
  if char_length(v_title_clean) < 1 or char_length(v_title_clean) > 200 then
    raise exception 'Título do evento deve ter entre 1 e 200 caracteres.' using errcode = '22000';
  end if;

  v_type_clean := lower(btrim(coalesce(p_event_type, 'culto')));

  if p_planned_end_at <= p_planned_start_at then
    raise exception 'Data/hora de término planejada deve ser posterior ao início.' using errcode = '22000';
  end if;

  -- Advisory lock imediato antes de ler autoridade ou recibo
  perform pg_advisory_xact_lock(hashtext(v_user_id::text), hashtext(p_command_id::text));

  select ca.member_id, ca.is_admin
  into v_caller_member_id, v_is_admin
  from app_private.church_access ca
  join auth.users u on u.id = ca.user_id
  join app_private.churches c on c.id = ca.church_id
  join app_private.members m on m.id = ca.member_id and m.church_id = ca.church_id
  where ca.user_id = v_user_id
    and ca.church_id = p_church_id
    and ca.status = 'active'
    and ca.onboarding_completed_at is not null
    and c.status = 'active'
    and m.status = 'active'
    and u.email_confirmed_at is not null
    and u.deleted_at is null
    and not coalesce(u.is_anonymous, false)
    and (u.banned_until is null or u.banned_until <= clock_timestamp());

  if v_caller_member_id is null then
    raise exception 'Acesso não autorizado nesta igreja.' using errcode = '42501';
  end if;

  -- B2-03: Restauração da permissão aprovada: Admin OU líder ministerial ativo pode criar eventos
  v_is_ministry_leader := exists (
    select 1 from app_private.teams as t
    where t.church_id = p_church_id and t.leader_member_id = v_caller_member_id and t.status = 'active'
  );

  if not coalesce(v_is_admin, false) and not v_is_ministry_leader then
    raise exception 'Apenas administradores ou líderes de ministério ativos podem criar eventos.' using errcode = '42501';
  end if;

  -- Designação de dirigente de liturgia permanece exclusiva de administradores
  if p_liturgy_leader_member_id is not null and not coalesce(v_is_admin, false) then
    raise exception 'Apenas administradores podem designar dirigente de culto.' using errcode = '42501';
  end if;

  select c.timezone
  into v_timezone
  from app_private.churches as c
  where c.id = p_church_id;

  if v_timezone is null then
    raise exception 'Igreja não encontrada ou sem fuso horário configurado.' using errcode = '22000';
  end if;

  v_params_hash := pg_catalog.sha256(convert_to(jsonb_build_object(
    'action', c_action,
    'church_id', p_church_id,
    'title', v_title_clean,
    'event_type', v_type_clean,
    'planned_start_at', to_jsonb(p_planned_start_at),
    'planned_end_at', to_jsonb(p_planned_end_at),
    'liturgy_leader_member_id', p_liturgy_leader_member_id
  )::text, 'UTF8'));

  select cr.command_id, cr.action, cr.church_id, cr.result_entity_id, cr.result_payload, cr.created_at, cr.params_hash
  into v_existing_receipt
  from app_private.command_receipts cr
  where cr.user_id = v_user_id
    and cr.command_id = p_command_id;

  if v_existing_receipt.command_id is not null then
    -- Revalidação de autoridade no replay
    if not coalesce(v_is_admin, false) and not exists (
      select 1 from app_private.teams as t
      where t.church_id = p_church_id and t.leader_member_id = v_caller_member_id and t.status = 'active'
    ) then
      raise exception 'Apenas administradores ou líderes de ministério ativos podem criar eventos.' using errcode = '42501';
    end if;
    if v_existing_receipt.action <> c_action or v_existing_receipt.church_id <> p_church_id then
      raise exception 'Identificador de comando já utilizado para outra operação.' using errcode = 'P0020';
    end if;
    if v_existing_receipt.params_hash <> v_params_hash then
      raise exception 'Comando já executado com parâmetros divergentes.' using errcode = 'P0020';
    end if;
    return query
    select v_existing_receipt.command_id, v_existing_receipt.action, v_existing_receipt.church_id,
           v_existing_receipt.result_entity_id, v_existing_receipt.result_payload, v_existing_receipt.created_at;
    return;
  end if;

  if p_liturgy_leader_member_id is not null then
    perform 1 from app_private.members m
    where m.church_id=p_church_id and m.id=p_liturgy_leader_member_id and m.status='active' for update;
    if not found then raise exception 'Responsável não encontrado ou inativo nesta igreja.' using errcode='P0020'; end if;
  end if;

  select ca.member_id, ca.is_admin
  into v_caller_member_id, v_is_admin
  from app_private.church_access ca
  join auth.users u on u.id = ca.user_id
  join app_private.churches c on c.id = ca.church_id
  join app_private.members m on m.id = ca.member_id and m.church_id = ca.church_id
  where ca.user_id = v_user_id
    and ca.church_id = p_church_id
    and ca.status = 'active'
    and ca.onboarding_completed_at is not null
    and c.status = 'active'
    and m.status = 'active'
    and u.email_confirmed_at is not null
    and u.deleted_at is null
    and not coalesce(u.is_anonymous, false)
    and (u.banned_until is null or u.banned_until <= clock_timestamp());
  if v_caller_member_id is null or (not coalesce(v_is_admin,false) and not exists (
    select 1 from app_private.teams t where t.church_id=p_church_id and t.status='active' and t.leader_member_id=v_caller_member_id))
    or (p_liturgy_leader_member_id is not null and not coalesce(v_is_admin,false)) then
    raise exception 'Autoridade atual insuficiente para criar/designar o evento.' using errcode='42501';
  end if;

  if p_liturgy_leader_member_id is not null then
    if not exists (
      select 1 from app_private.members as m
      where m.church_id = p_church_id and m.id = p_liturgy_leader_member_id and m.status = 'active'
    ) then
      raise exception 'Líder de liturgia indicado não encontrado ou inativo nesta igreja.' using errcode = 'P0020';
    end if;
  end if;

  insert into app_private.events as e (
    church_id, title, event_type, timezone, status,
    planned_start_at, planned_end_at, liturgy_leader_member_id
  ) values (
    p_church_id, v_title_clean, v_type_clean, v_timezone, 'scheduled',
    p_planned_start_at, p_planned_end_at, p_liturgy_leader_member_id
  )
  returning e.id, e.created_at into v_event_id, v_created_at;

  v_payload := jsonb_build_object(
    'event_id', v_event_id,
    'title', v_title_clean,
    'event_type', v_type_clean,
    'timezone', v_timezone,
    'status', 'scheduled',
    'planned_start_at', p_planned_start_at,
    'planned_end_at', p_planned_end_at,
    'liturgy_leader_member_id', p_liturgy_leader_member_id
  );

  insert into app_private.audit_entries (
    church_id, action, actor_user_id, actor_source, maintenance_operator,
    target_type, target_id, details, occurred_at
  ) values (
    p_church_id, c_action, v_user_id, 'application', null,
    'event', v_event_id, v_payload, v_created_at
  );

  insert into app_private.command_receipts (
    church_id, user_id, command_id, action, params_hash,
    result_member_id, result_entity_id, result_payload, created_at
  ) values (
    p_church_id, v_user_id, p_command_id, c_action, v_params_hash,
    null, v_event_id, v_payload, v_created_at
  );

  return query
  select p_command_id, c_action, p_church_id, v_event_id, v_payload, v_created_at;
end;
$function$;

create or replace function public.create_event_item(
  p_church_id uuid,
  p_command_id uuid,
  p_event_id uuid,
  p_title text,
  p_item_nature text default 'liturgical',
  p_sequence_order integer default 1,
  p_planned_duration_seconds integer default 300,
  p_designated_team_id uuid default null,
  p_nominal_leader_member_id uuid default null
)
returns table (
  command_id uuid,
  action text,
  church_id uuid,
  result_entity_id uuid,
  result_payload jsonb,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $function$
declare
  v_user_id uuid;
  v_caller_member_id uuid;
  v_is_admin boolean;
  v_event record;
  v_team record;
  v_title_clean text;
  v_nature_clean text;
  v_params_hash bytea;
  v_existing_receipt record;
  v_item_id uuid;
  v_payload jsonb;
  v_created_at timestamptz;
  c_action constant text := 'create_event_item';
begin
  -- 016: decisões após espera exigem snapshots novos por instrução.
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Esta operação exige READ COMMITTED.' using errcode = '42501';
  end if;
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if p_church_id is null or p_command_id is null or p_event_id is null or p_title is null then
    raise exception 'Parâmetros obrigatórios ausentes.' using errcode = '22004';
  end if;

  v_title_clean := btrim(normalize(p_title, NFC));
  if char_length(v_title_clean) < 1 or char_length(v_title_clean) > 200 then
    raise exception 'Título do item deve ter entre 1 e 200 caracteres.' using errcode = '22000';
  end if;

  v_nature_clean := lower(coalesce(p_item_nature, 'liturgical'));
  if v_nature_clean not in ('liturgical', 'parallel_support') then
    raise exception 'Natureza do item deve ser liturgical ou parallel_support.' using errcode = '22000';
  end if;

  if coalesce(p_planned_duration_seconds, 0) <= 0 then
    raise exception 'Duração planejada em segundos deve ser maior que zero.' using errcode = '22000';
  end if;

  -- Advisory lock imediato antes de ler autoridade ou recibo
  perform pg_advisory_xact_lock(hashtext(v_user_id::text), hashtext(p_command_id::text));

  select ca.member_id, ca.is_admin
  into v_caller_member_id, v_is_admin
  from app_private.church_access ca
  join auth.users u on u.id = ca.user_id
  join app_private.churches c on c.id = ca.church_id
  join app_private.members m on m.id = ca.member_id and m.church_id = ca.church_id
  where ca.user_id = v_user_id
    and ca.church_id = p_church_id
    and ca.status = 'active'
    and ca.onboarding_completed_at is not null
    and c.status = 'active'
    and m.status = 'active'
    and u.email_confirmed_at is not null
    and u.deleted_at is null
    and not coalesce(u.is_anonymous, false)
    and (u.banned_until is null or u.banned_until <= clock_timestamp());

  if v_caller_member_id is null then
    raise exception 'Acesso não autorizado nesta igreja.' using errcode = '42501';
  end if;

  v_params_hash := pg_catalog.sha256(convert_to(jsonb_build_object(
    'action', c_action,
    'church_id', p_church_id,
    'event_id', p_event_id,
    'title', v_title_clean,
    'item_nature', v_nature_clean,
    'sequence_order', p_sequence_order,
    'planned_duration_seconds', p_planned_duration_seconds,
    'designated_team_id', p_designated_team_id,
    'nominal_leader_member_id', p_nominal_leader_member_id
  )::text, 'UTF8'));

  select cr.command_id, cr.action, cr.church_id, cr.result_entity_id, cr.result_payload, cr.created_at, cr.params_hash
  into v_existing_receipt
  from app_private.command_receipts cr
  where cr.user_id = v_user_id
    and cr.command_id = p_command_id;

  if v_existing_receipt.command_id is not null then
    if v_existing_receipt.action <> c_action or v_existing_receipt.church_id <> p_church_id then
      raise exception 'Identificador de comando já utilizado para outra operação.' using errcode = 'P0020';
    end if;
    if v_existing_receipt.params_hash <> v_params_hash then
      raise exception 'Comando já executado com parâmetros divergentes.' using errcode = 'P0020';
    end if;
    return query
    select v_existing_receipt.command_id, v_existing_receipt.action, v_existing_receipt.church_id,
           v_existing_receipt.result_entity_id, v_existing_receipt.result_payload, v_existing_receipt.created_at;
    return;
  end if;

  if p_nominal_leader_member_id is not null then
    perform 1 from app_private.members m
    where m.church_id=p_church_id and m.id=p_nominal_leader_member_id and m.status='active' for update;
    if not found then raise exception 'Responsável não encontrado ou inativo nesta igreja.' using errcode='P0020'; end if;
  end if;

  if p_designated_team_id is not null then
    perform 1 from app_private.teams t where t.church_id=p_church_id and t.id=p_designated_team_id for share;
  end if;
  select e.id, e.liturgy_leader_member_id, e.status
  into v_event
  from app_private.events as e
  where e.church_id = p_church_id and e.id = p_event_id
  for share;

  if v_event.id is null then
    raise exception 'Evento não encontrado nesta igreja.' using errcode = 'P0020';
  end if;

  if v_event.status in ('completed', 'cancelled') then
    raise exception 'Não é possível adicionar itens a eventos finalizados ou cancelados.' using errcode = 'P0020';
  end if;

  -- B2-03/B2-04: Revalidação estrita da autoridade do operador após espera por locks
  select ca.member_id, ca.is_admin
  into v_caller_member_id, v_is_admin
  from app_private.church_access ca
  join auth.users u on u.id = ca.user_id
  join app_private.churches c on c.id = ca.church_id
  join app_private.members m on m.id = ca.member_id and m.church_id = ca.church_id
  where ca.user_id = v_user_id
    and ca.church_id = p_church_id
    and ca.status = 'active'
    and ca.onboarding_completed_at is not null
    and c.status = 'active'
    and m.status = 'active'
    and u.email_confirmed_at is not null
    and u.deleted_at is null
    and not coalesce(u.is_anonymous, false)
    and (u.banned_until is null or u.banned_until <= clock_timestamp());

  if v_caller_member_id is null then
    raise exception 'Acesso não autorizado nesta igreja.' using errcode = '42501';
  end if;

  -- Checagem de autoridade (Admin, Líder de liturgia do evento ou líder da equipe designada)
  if not coalesce(v_is_admin, false)
     and (v_event.liturgy_leader_member_id is null or v_event.liturgy_leader_member_id <> v_caller_member_id) then
    if p_designated_team_id is not null then
      select t.id, t.leader_member_id into v_team
      from app_private.teams as t
      where t.church_id = p_church_id and t.id = p_designated_team_id;
      if v_team.leader_member_id is null or v_team.leader_member_id <> v_caller_member_id then
        raise exception 'Apenas o líder de liturgia, líder da equipe designada ou administrador pode criar itens de cronograma.' using errcode = '42501';
      end if;
    else
      raise exception 'Apenas o líder de liturgia ou administrador pode criar itens de cronograma.' using errcode = '42501';
    end if;
  end if;

  if p_designated_team_id is not null then
    if not exists (
      select 1 from app_private.teams as t
      where t.church_id = p_church_id and t.id = p_designated_team_id and t.status = 'active'
    ) then
      raise exception 'Equipe designada não encontrada ou inativa nesta igreja.' using errcode = 'P0020';
    end if;
  end if;

  if p_nominal_leader_member_id is not null then
    if not exists (
      select 1 from app_private.members as m
      where m.church_id = p_church_id and m.id = p_nominal_leader_member_id and m.status = 'active'
    ) then
      raise exception 'Responsável nominal não encontrado ou inativo nesta igreja.' using errcode = 'P0020';
    end if;
  end if;

  insert into app_private.event_items as ei (
    church_id, event_id, title, item_nature, sequence_order,
    planned_duration_seconds, designated_team_id, nominal_leader_member_id, status
  ) values (
    p_church_id, p_event_id, v_title_clean, v_nature_clean, coalesce(p_sequence_order, 1),
    p_planned_duration_seconds, p_designated_team_id, p_nominal_leader_member_id, 'pending'
  )
  returning ei.id, ei.created_at into v_item_id, v_created_at;

  v_payload := jsonb_build_object(
    'item_id', v_item_id,
    'event_id', p_event_id,
    'title', v_title_clean,
    'item_nature', v_nature_clean,
    'sequence_order', p_sequence_order,
    'planned_duration_seconds', p_planned_duration_seconds,
    'designated_team_id', p_designated_team_id,
    'nominal_leader_member_id', p_nominal_leader_member_id,
    'status', 'pending'
  );

  insert into app_private.audit_entries (
    church_id, action, actor_user_id, actor_source, maintenance_operator,
    target_type, target_id, details, occurred_at
  ) values (
    p_church_id, c_action, v_user_id, 'application', null,
    'event_item', v_item_id, v_payload, v_created_at
  );

  insert into app_private.command_receipts (
    church_id, user_id, command_id, action, params_hash,
    result_member_id, result_entity_id, result_payload, created_at
  ) values (
    p_church_id, v_user_id, p_command_id, c_action, v_params_hash,
    null, v_item_id, v_payload, v_created_at
  );

  return query
  select p_command_id, c_action, p_church_id, v_item_id, v_payload, v_created_at;
end;
$function$;
-- CREATE OR REPLACE preserva ACLs anteriores. Nenhuma nova RPC nem concessão privada.

-- Somente base de prova vazia: sem fixture em piloto e sem limpeza por DML.
do $guard$ begin
 if exists(select 1 from auth.users) or exists(select 1 from app_private.churches)
 or exists(select 1 from app_private.command_receipts) or exists(select 1 from app_private.audit_entries) then
   raise exception 'O ensaio 016 exige uma base descartável vazia, preparada e identificada pelo executor.';
 end if;
end $guard$;
create function pg_temp.id(n integer) returns uuid language sql immutable as
$$ select ('01600000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid $$;
create function pg_temp.revision(n integer) returns text language sql as
$$ select to_char(m.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') from app_private.members m where m.id=pg_temp.id(n) $$;
create function pg_temp.as_authenticated(q text, expected text default '00000') returns jsonb
language plpgsql security invoker as $$
declare payload jsonb; code text:='00000'; msg text;
begin
 begin
   set local role authenticated;
   execute q into payload;
   reset role;
 exception when others then
   get stacked diagnostics code=returned_sqlstate,msg=message_text;
   reset role;
 end;
 if code<>expected then raise exception 'FALHA: esperado %, recebido %: %',expected,code,msg; end if;
 return payload;
end $$;
create function pg_temp.deactivate(n integer, cmd integer, expected text default '00000', revision text default null) returns jsonb
language plpgsql security invoker as $$
begin
 return pg_temp.as_authenticated(format('select to_jsonb(r) from public.deactivate_church_member(%L,%L,%L,%L) r',
   pg_temp.id(1000),pg_temp.id(cmd),pg_temp.id(n),coalesce(revision,pg_temp.revision(n))),expected);
end $$;
create function pg_temp.restore(n integer, cmd integer, expected text default '00000') returns jsonb
language plpgsql security invoker as $$
begin
 return pg_temp.as_authenticated(format('select to_jsonb(r) from public.restore_church_member(%L,%L,%L,%L) r',
   pg_temp.id(1000),pg_temp.id(cmd),pg_temp.id(n),pg_temp.revision(n)),expected);
end $$;
insert into app_private.churches(id,name,timezone,default_duration_policy,status) values
 (pg_temp.id(1000),'Igreja Prova 016','America/Sao_Paulo','warn','active'),
 (pg_temp.id(2000),'Outra Igreja Prova 016','America/Sao_Paulo','warn','active');
insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select pg_temp.id(n),'prova016_'||n||'@rehearsal.test',clock_timestamp(),'{"provider":"email"}'::jsonb,'{}'::jsonb,clock_timestamp(),clock_timestamp()
from generate_series(1,8) n;
insert into app_private.members(id,church_id,display_name,status,created_by_user_id)
select pg_temp.id(n),pg_temp.id(1000),'Membro 016 '||n,'active',pg_temp.id(1) from generate_series(11,20) n;
insert into app_private.members(id,church_id,display_name,status,created_by_user_id) values
 (pg_temp.id(21),pg_temp.id(2000),'Administrador outra igreja','active',pg_temp.id(4)),
 (pg_temp.id(23),pg_temp.id(2000),'Mesmo Auth outra igreja','active',pg_temp.id(4));
insert into app_private.church_access(church_id,user_id,member_id,is_admin,status,onboarding_completed_at,granted_by_user_id) values
 (pg_temp.id(1000),pg_temp.id(1),pg_temp.id(11),true,'active',clock_timestamp(),pg_temp.id(1)),
 (pg_temp.id(1000),pg_temp.id(2),pg_temp.id(12),true,'active',clock_timestamp(),pg_temp.id(1)),
 (pg_temp.id(1000),pg_temp.id(3),pg_temp.id(13),false,'active',clock_timestamp(),pg_temp.id(1)),
 (pg_temp.id(2000),pg_temp.id(4),pg_temp.id(21),true,'active',clock_timestamp(),pg_temp.id(4)),
 (pg_temp.id(2000),pg_temp.id(3),pg_temp.id(23),false,'active',clock_timestamp(),pg_temp.id(4));
insert into app_private.church_access(church_id,user_id,member_id,is_admin,status,onboarding_completed_at,granted_by_user_id,granted_at,revoked_at,revoked_by_user_id)
values(pg_temp.id(1000),pg_temp.id(5),pg_temp.id(15),false,'revoked',clock_timestamp()-interval '1 day',pg_temp.id(1),clock_timestamp()-interval '1 day',clock_timestamp()-interval '1 hour',pg_temp.id(2));
-- Seis tentativas do mesmo membro: aberta válida, consumidas, revogada e expirada.
insert into app_private.access_invitations(id,church_id,member_id,recipient_email,token_digest,issued_by_user_id,
 issued_at,expires_at,redeemed_at,redeemed_by_user_id,revoked_at,revoked_by_user_id)
select pg_temp.id(n),pg_temp.id(1000),case when n=105 then pg_temp.id(20) else pg_temp.id(13) end,'prova016_3@rehearsal.test',sha256(convert_to('fixture-'||n,'UTF8')),pg_temp.id(1),
 t,t+interval '72 hours',case when n in (101,102,103) then t+interval '1 hour' end,
 case when n in (101,102,103) then pg_temp.id(3) end,
 case when n=104 then t+interval '2 hours' end,case when n=104 then pg_temp.id(2) end
from generate_series(100,105) n cross join lateral
 (select clock_timestamp()-case when n in (102,105) then interval '4 days' else interval '3 hours' end as t) times;
insert into app_private.access_requests(id,church_id,member_id,invitation_id,requester_user_id,original_display_name,
 proposed_display_name,submitted_at,expires_at,status,decided_at,decided_by_user_id)
select pg_temp.id(right(id::text,12)::int+100),church_id,member_id,id,pg_temp.id(3),'Membro 016 13','Nome proposto 016',
 issued_at+interval '1 hour',expires_at,case when id=pg_temp.id(103) then 'rejected' else 'pending' end,
 case when id=pg_temp.id(103) then issued_at+interval '2 hours' end,case when id=pg_temp.id(103) then pg_temp.id(2) end
from app_private.access_invitations where id in (pg_temp.id(101),pg_temp.id(102),pg_temp.id(103));

do $test$
declare
 before_auth text; before_other text; before_consumed text; before_closed text; before_revoked text;
 before_history text; before_attempts text; before_access text; original_revision text;
 receipt jsonb; replay jsonb; payload jsonb; target integer; mode text; code text;
begin
 perform set_config('request.jwt.claim.sub',pg_temp.id(1)::text,true);
 select md5(string_agg(to_jsonb(u)::text,'' order by u.id)) into before_auth from auth.users u;
 select md5(string_agg(to_jsonb(c)::text,'' order by c.id)) into before_other from app_private.church_access c where church_id=pg_temp.id(2000);
 select md5(string_agg(to_jsonb(i)::text,'' order by i.id)) into before_consumed from app_private.access_invitations i where redeemed_at is not null;
 select md5(string_agg(to_jsonb(i)::text,'' order by i.id)) into before_closed from app_private.access_invitations i where id in (pg_temp.id(104),pg_temp.id(105));
 select to_jsonb(r)::text into before_revoked from app_private.church_access r where member_id=pg_temp.id(15);
 original_revision:=pg_temp.revision(13);
 receipt:=pg_temp.deactivate(13,301);
 if receipt->'result_payload'->>'status'<>'inactive' or receipt->'result_payload'->>'updated_at'=original_revision
 or (select status from app_private.members where id=pg_temp.id(13))<>'inactive'
 or not exists(select 1 from app_private.church_access where member_id=pg_temp.id(13) and status='revoked' and revoked_by_user_id=pg_temp.id(1)) then
   raise exception 'Exclusão/revisão/revogação não confirmada'; end if;
 if (receipt->'result_payload'->>'invitations_revoked')::int<>1
 or (receipt->'result_payload'->>'requests_cancelled')::int<>1
 or (receipt->'result_payload'->>'requests_expired')::int<>1 then raise exception 'Contagem de tentativas divergente'; end if;
 if not exists(select 1 from app_private.access_requests where id=pg_temp.id(201) and status='cancelled' and decided_by_user_id=pg_temp.id(1))
 or not exists(select 1 from app_private.access_requests where id=pg_temp.id(202) and status='expired' and decided_by_user_id is null)
 or not exists(select 1 from app_private.access_requests where id=pg_temp.id(203) and status='rejected' and decided_by_user_id=pg_temp.id(2)) then
   raise exception 'Temporalidade/histórico das solicitações divergente'; end if;
 if (select md5(string_agg(to_jsonb(u)::text,'' order by u.id)) from auth.users u)<>before_auth
 or (select md5(string_agg(to_jsonb(c)::text,'' order by c.id)) from app_private.church_access c where church_id=pg_temp.id(2000))<>before_other
 or (select md5(string_agg(to_jsonb(i)::text,'' order by i.id)) from app_private.access_invitations i where redeemed_at is not null)<>before_consumed
 or (select md5(string_agg(to_jsonb(i)::text,'' order by i.id)) from app_private.access_invitations i where id in (pg_temp.id(104),pg_temp.id(105)))<>before_closed then
   raise exception 'Auth/outra igreja/tentativas históricas foram alterados'; end if;
 replay:=pg_temp.deactivate(13,301,'00000',original_revision);
 if replay<>receipt then raise exception 'Replay divergente'; end if;
 perform pg_temp.deactivate(13,301,'23505','revisão divergente');
 perform pg_temp.deactivate(13,302,'P0019');
 perform pg_temp.restore(13,303);
 replay:=pg_temp.deactivate(13,301,'00000',original_revision);
 if replay<>receipt or (select status from app_private.members where id=pg_temp.id(13))<>'active'
 or (select status from app_private.church_access where member_id=pg_temp.id(13))<>'revoked'
 or (select revoked_at is null from app_private.access_invitations where id=pg_temp.id(100))
 or (select count(*) from app_private.audit_entries where action='deactivate_member' and target_id=pg_temp.id(13))<>1
 then raise exception 'Replay reaplicou exclusão após restauração ou duplicou auditoria'; end if;
 raise notice 'PASS016|ciclo_integrado_temporalidade_outra_igreja_replay';
 perform pg_temp.deactivate(15,304); perform pg_temp.restore(15,305);
 if (select to_jsonb(r)::text from app_private.church_access r where member_id=pg_temp.id(15))<>before_revoked then
   raise exception 'Revogação anterior reescrita'; end if;
 -- Um convite expirado ainda ocupa a posição de convite aberto; por isso usa outro membro.
 receipt:=pg_temp.deactivate(20,351);
 if (receipt->'result_payload'->>'invitations_revoked')::int<>0
 or (select md5(string_agg(to_jsonb(i)::text,'' order by i.id)) from app_private.access_invitations i where id in (pg_temp.id(104),pg_temp.id(105)))<>before_closed then
   raise exception 'Convite expirado/fechado reescrito pela exclusão'; end if;
 perform pg_temp.restore(20,352);
 raise notice 'PASS016|revogacao_anterior_intacta';
 -- Recusas de autorização/contexto/revisão sem efeitos ou recibos.
 perform pg_temp.deactivate(11,306,'P0016');
 perform pg_temp.deactivate(14,307,'P0019','2020-01-01T00:00:00.000000Z');
 perform pg_temp.deactivate(23,308,'P0002');
 perform set_config('request.jwt.claim.sub',pg_temp.id(3)::text,true);
 perform pg_temp.deactivate(14,309,'42501');
 perform pg_temp.deactivate(13,301,'42501',original_revision);
 perform set_config('request.jwt.claim.sub','',true);
 perform pg_temp.deactivate(14,310,'28000');
 perform set_config('request.jwt.claim.sub',pg_temp.id(1)::text,true);
 -- Um inativo legado com acesso ainda ativo continua sem saneamento silencioso.
 update app_private.members set status='inactive' where id=pg_temp.id(12);
 perform pg_temp.restore(12,311,'P0018');
 update app_private.members set status='active' where id=pg_temp.id(12);
 raise notice 'PASS016|autorizacao_autoexclusao_contexto_revisao_legado';
 -- Membro 16 lidera equipe ativa; 17 lidera liturgia; 18 tem escala; 19 é responsável nominal.
 insert into app_private.teams(id,church_id,name,leader_member_id) values(pg_temp.id(400),pg_temp.id(1000),'Equipe prova 016',pg_temp.id(16));
 insert into app_private.events(id,church_id,title,timezone,status,planned_start_at,planned_end_at,liturgy_leader_member_id)
 values(pg_temp.id(500),pg_temp.id(1000),'Evento prova 016','America/Sao_Paulo','scheduled',clock_timestamp()+interval '1 day',clock_timestamp()+interval '2 days',pg_temp.id(17));
 insert into app_private.event_items(id,church_id,event_id,title,nominal_leader_member_id) values
 (pg_temp.id(501),pg_temp.id(1000),pg_temp.id(500),'Item prova 016',pg_temp.id(19));
 insert into app_private.assignments(id,church_id,event_id,team_id,member_id) values
 (pg_temp.id(502),pg_temp.id(1000),pg_temp.id(500),pg_temp.id(400),pg_temp.id(18));
 perform pg_temp.deactivate(16,312,'P0022');
 -- Transferência é um comando prévio explícito; restauração não recupera a liderança antiga.
 perform pg_temp.as_authenticated(format('select to_jsonb(r) from public.assign_team_leader(%L,%L,%L,%L,1) r',
   pg_temp.id(1000),pg_temp.id(353),pg_temp.id(400),pg_temp.id(11)));
 perform pg_temp.deactivate(16,354);perform pg_temp.restore(16,355);
 if (select leader_member_id from app_private.teams where id=pg_temp.id(400))<>pg_temp.id(11) then
   raise exception 'Restauração modificou liderança transferida'; end if;
 perform pg_temp.deactivate(17,313,'P0023');
 perform pg_temp.deactivate(18,314,'P0024');
 perform pg_temp.deactivate(19,315,'P0024');
 update app_private.events set planned_start_at=clock_timestamp()-interval '2 days',planned_end_at=clock_timestamp()-interval '1 day' where id=pg_temp.id(500);
 perform pg_temp.deactivate(18,316,'P0025');
 update app_private.events set status='in_progress' where id=pg_temp.id(500);
 perform pg_temp.deactivate(18,317,'P0024');
 raise notice 'PASS016|E20_dependencias_reais_futuras_em_andamento_expiradas';
 -- Encerramento real pela liturgia, antes da exclusão; escalas e referências não são apagadas.
 insert into app_private.church_access(church_id,user_id,member_id,is_admin,status,onboarding_completed_at,granted_by_user_id)
 values(pg_temp.id(1000),pg_temp.id(7),pg_temp.id(17),false,'active',clock_timestamp(),pg_temp.id(1));
 perform set_config('request.jwt.claim.sub',pg_temp.id(7)::text,true);
 perform pg_temp.as_authenticated(format('select to_jsonb(r) from public.finish_event_service(%L,%L,%L,1) r',pg_temp.id(1000),pg_temp.id(318),pg_temp.id(500)));
 perform set_config('request.jwt.claim.sub',pg_temp.id(1)::text,true);
 select to_jsonb(e)::text into before_history from app_private.events e where id=pg_temp.id(500);
 select to_jsonb(a)::text into before_access from app_private.assignments a where id=pg_temp.id(502);
 perform pg_temp.deactivate(17,319); perform pg_temp.deactivate(18,320); perform pg_temp.deactivate(19,321);
 if (select to_jsonb(e)::text from app_private.events e where id=pg_temp.id(500))<>before_history
 or (select to_jsonb(a)::text from app_private.assignments a where id=pg_temp.id(502))<>before_access
 or not exists(select 1 from app_private.event_items where id=pg_temp.id(501) and nominal_leader_member_id=pg_temp.id(19)) then
   raise exception 'Histórico encerrado foi alterado'; end if;
 raise notice 'PASS016|E21_historico_encerrado_preservado';
 -- Responsável inativo recusado em cada criação que antes só lia status sem bloquear.
 perform pg_temp.as_authenticated(format('select to_jsonb(r) from public.create_church_team(%L,%L,%L,%L) r',pg_temp.id(1000),pg_temp.id(322),'Equipe indevida',pg_temp.id(18)),'P0020');
 perform pg_temp.as_authenticated(format('select to_jsonb(r) from public.create_church_event(%L,%L,%L,%L,%L,%L,%L) r',pg_temp.id(1000),pg_temp.id(323),'Evento indevido','culto',clock_timestamp()+interval '1 day',clock_timestamp()+interval '2 days',pg_temp.id(18)),'P0020');
 perform pg_temp.as_authenticated(format('select to_jsonb(r) from public.create_event_item(%L,%L,%L,%L,%L,1,300,null,%L) r',pg_temp.id(1000),pg_temp.id(324),pg_temp.id(500),'Item indevido','liturgical',pg_temp.id(18)),'P0020');
 raise notice 'PASS016|escritores_recusam_responsavel_inativo';
 -- A inexistência da fonte precisa continuar bloqueando, mesmo após a integração.
 alter table app_private.assignments rename to assignments_016_temporarily_unavailable;
 perform pg_temp.deactivate(14,325,'P0021');
 alter table app_private.assignments_016_temporarily_unavailable rename to assignments;
 -- Cada contraprova desfaz também a própria alteração de fixture.
 foreach mode in array array['unconfirmed','anonymous','banned','deleted','member_inactive','church_inactive','not_admin'] loop
  begin
   case mode
    when 'unconfirmed' then update auth.users set email_confirmed_at=null where id=pg_temp.id(1);
    when 'anonymous' then update auth.users set is_anonymous=true where id=pg_temp.id(1);
    when 'banned' then update auth.users set banned_until=clock_timestamp()+interval '1 day' where id=pg_temp.id(1);
    when 'deleted' then update auth.users set deleted_at=clock_timestamp() where id=pg_temp.id(1);
    when 'member_inactive' then update app_private.members set status='inactive' where id=pg_temp.id(11);
    when 'church_inactive' then update app_private.churches set status='inactive' where id=pg_temp.id(1000);
    when 'not_admin' then update app_private.church_access set is_admin=false where church_id=pg_temp.id(1000) and user_id=pg_temp.id(1);
   end case;
   perform pg_temp.deactivate(14,350,'42501');
   perform pg_temp.as_authenticated(format('select to_jsonb(r) from public.get_member_lifecycle_receipt(%L) r',pg_temp.id(301)),'42501');
   raise exception 'Desfazer contraprova' using errcode='P0098';
  exception when sqlstate 'P0098' then null;
  end;
 end loop;
 raise notice 'PASS016|predicados_Auth_membro_igreja_admin_recibo';
 -- O operador pode desativar outro administrador quando há sucessor elegível, nunca a si.
 perform pg_temp.deactivate(12,326);
 begin
   update app_private.church_access set status='revoked',revoked_at=clock_timestamp(),revoked_by_user_id=pg_temp.id(1)
   where church_id=pg_temp.id(1000) and user_id=pg_temp.id(1);
   raise exception 'A trava do último administrador deveria recusar';
 exception when check_violation then null;
 end;
 if (select count(*) from app_private.church_access where church_id=pg_temp.id(1000) and is_admin and status='active')<>1 then
   raise exception 'Continuidade administrativa violada'; end if;
 raise notice 'PASS016|fonte_ausente_continuidade_administrativa';
end $test$;
-- Falhas injetadas por triggers exclusivamente no ensaio, sem desabilitar os gatilhos reais.
create function pg_temp.fail_lifecycle_write() returns trigger language plpgsql as $$
begin raise exception 'Falha injetada de atomicidade 016' using errcode='P0099'; end $$;
do $atomic$
declare table_name text; before_member text; before_access text; before_attempts text; before_requests text; before_audit text; before_receipts text;
begin
 perform set_config('request.jwt.claim.sub',pg_temp.id(1)::text,true);
 insert into app_private.church_access(church_id,user_id,member_id,is_admin,status,onboarding_completed_at,granted_by_user_id)
 values(pg_temp.id(1000),pg_temp.id(6),pg_temp.id(14),false,'active',clock_timestamp(),pg_temp.id(1));
 insert into app_private.access_invitations(id,church_id,member_id,recipient_email,token_digest,issued_by_user_id,issued_at,expires_at,redeemed_at,redeemed_by_user_id)
 select pg_temp.id(n),pg_temp.id(1000),pg_temp.id(14),'prova016_6@rehearsal.test',sha256(convert_to('fixture-'||n,'UTF8')),pg_temp.id(1),
 t,t+interval '72 hours',case when n=107 then t+interval '1 hour' end,case when n=107 then pg_temp.id(6) end
 from generate_series(106,107) n cross join lateral (select clock_timestamp()-interval '3 hours' as t) times;
 insert into app_private.access_requests(id,church_id,member_id,invitation_id,requester_user_id,original_display_name,proposed_display_name,submitted_at,expires_at)
 select pg_temp.id(207),church_id,member_id,id,pg_temp.id(6),'Membro 016 14','Outro nome',issued_at+interval '1 hour',expires_at
 from app_private.access_invitations where id=pg_temp.id(107);
 foreach table_name in array array['audit_entries','command_receipts'] loop
  select md5(string_agg(to_jsonb(m)::text,'' order by m.id)) into before_member from app_private.members m;
  select md5(string_agg(to_jsonb(c)::text,'' order by c.id)) into before_access from app_private.church_access c;
  select md5(string_agg(to_jsonb(i)::text,'' order by i.id)) into before_attempts from app_private.access_invitations i;
  select md5(string_agg(to_jsonb(r)::text,'' order by r.id)) into before_requests from app_private.access_requests r;
  select md5(coalesce(string_agg(to_jsonb(a)::text,'' order by a.id),'')) into before_audit from app_private.audit_entries a;
  select md5(coalesce(string_agg(to_jsonb(r)::text,'' order by r.id),'')) into before_receipts from app_private.command_receipts r;
  execute format('create trigger fail_016 before insert on app_private.%I for each row execute function pg_temp.fail_lifecycle_write()',table_name);
  perform pg_temp.deactivate(14,330,'P0099');
  execute format('drop trigger fail_016 on app_private.%I',table_name);
  if (select md5(string_agg(to_jsonb(m)::text,'' order by m.id)) from app_private.members m)<>before_member
  or (select md5(string_agg(to_jsonb(c)::text,'' order by c.id)) from app_private.church_access c)<>before_access
  or (select md5(string_agg(to_jsonb(i)::text,'' order by i.id)) from app_private.access_invitations i)<>before_attempts
  or (select md5(string_agg(to_jsonb(r)::text,'' order by r.id)) from app_private.access_requests r)<>before_requests
  or (select md5(coalesce(string_agg(to_jsonb(a)::text,'' order by a.id),'')) from app_private.audit_entries a)<>before_audit
  or (select md5(coalesce(string_agg(to_jsonb(r)::text,'' order by r.id),'')) from app_private.command_receipts r)<>before_receipts then
   raise exception 'Falha de % deixou efeitos parciais',table_name; end if;
  raise notice 'PASS016|atomicidade_%',table_name;
 end loop;
end $atomic$;

rollback;
