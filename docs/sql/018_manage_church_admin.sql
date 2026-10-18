-- Candidato 018: Gestão de permissões administrativas sem deixar a igreja sem administrador (Issue #23)
-- Cobre critérios CA01, CA02, CA03 e CA04.
-- NÃO executar no piloto sem revisão, ensaio com ROLLBACK e autorização específica.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $preflight$
begin
  if to_regclass('app_private.churches') is null
    or to_regclass('app_private.church_access') is null
    or to_regclass('app_private.members') is null
    or to_regclass('app_private.audit_entries') is null
    or to_regprocedure('app_private.protect_last_active_admin()') is null then
    raise exception 'Estrutura base de acesso, membros, auditoria e salvaguarda de último admin obrigatória.';
  end if;
  if to_regprocedure('public.manage_church_admin(uuid, uuid, text, uuid)') is not null then
    raise exception 'Função public.manage_church_admin já existente. Parar e conferir, sem sobrescrever.';
  end if;
end;
$preflight$;

-- Recibos próprios para idempotência de comandos de permissão administrativa
create table if not exists app_private.member_permission_receipts (
  user_id uuid not null references auth.users(id) on delete restrict,
  command_id uuid not null,
  church_id uuid not null references app_private.churches(id) on delete restrict,
  params jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default statement_timestamp(),
  primary key (user_id, command_id)
);
alter table app_private.member_permission_receipts enable row level security;
revoke all on app_private.member_permission_receipts from public, anon, authenticated, service_role;

-- Evolução compatível de list_church_members_admin para incluir status is_admin e is_current_user
create or replace function public.list_church_members_admin(
  p_church_id uuid,
  p_status_filter text default 'all',
  p_limit integer default 20,
  p_offset integer default 0
)
returns table (
  items jsonb,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '5s'
as $function$
declare
  v_user_id uuid;
  v_limit integer;
  v_offset integer;
  v_status text;
  v_total bigint;
  v_items jsonb;
begin
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if p_church_id is null then
    raise exception 'Identificador de igreja obrigatório.' using errcode = '22004';
  end if;

  -- Validação estrita de autorização administrativa nesta igreja
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

  v_status := lower(coalesce(trim(p_status_filter), 'all'));
  if v_status not in ('all', 'active', 'inactive') then
    v_status := 'all';
  end if;

  v_limit := greatest(1, least(coalesce(p_limit, 20), 100));
  v_offset := greatest(0, coalesce(p_offset, 0));

  select count(*)
  into v_total
  from app_private.members m
  where m.church_id = p_church_id
    and (
      v_status = 'all'
      or (v_status = 'active' and m.status = 'active')
      or (v_status = 'inactive' and m.status = 'inactive')
    );

  select coalesce(jsonb_agg(item_json), '[]'::jsonb)
  into v_items
  from (
    select jsonb_build_object(
      'member_id', m.id,
      'display_name', m.display_name,
      'status', m.status,
      'created_at', m.created_at,
      'updated_at', to_char(m.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'has_active_access', exists (
        select 1 from app_private.church_access ca
        where ca.church_id = p_church_id
          and ca.member_id = m.id
          and ca.status = 'active'
      ),
      'has_church_access', exists (
        select 1 from app_private.church_access ca
        where ca.church_id = p_church_id
          and ca.member_id = m.id
      ),
      'has_revoked_access', exists (
        select 1 from app_private.church_access ca
        where ca.church_id = p_church_id
          and ca.member_id = m.id
          and ca.status = 'revoked'
      ),
      'is_admin', coalesce((
        select ca.is_admin
        from app_private.church_access ca
        where ca.church_id = p_church_id
          and ca.member_id = m.id
          and ca.status = 'active'
      ), false),
      'is_current_user', coalesce((
        select ca.user_id = v_user_id
        from app_private.church_access ca
        where ca.church_id = p_church_id
          and ca.member_id = m.id
          and ca.status = 'active'
      ), false)
    ) as item_json
    from app_private.members m
    where m.church_id = p_church_id
      and (
        v_status = 'all'
        or (v_status = 'active' and m.status = 'active')
        or (v_status = 'inactive' and m.status = 'inactive')
      )
    order by lower(m.display_name) asc, m.id asc
    limit v_limit
    offset v_offset
  ) sub;

  return query select v_items, v_total;
end;
$function$;

revoke all on function public.list_church_members_admin(uuid, text, integer, integer) from public, anon, service_role;
grant execute on function public.list_church_members_admin(uuid, text, integer, integer) to authenticated;

-- Endpoint RPC: public.manage_church_admin
create or replace function public.manage_church_admin(
  p_church_id uuid,
  p_target_member_id uuid,
  p_action text,
  p_command_id uuid
)
returns table (
  church_id uuid,
  command_id uuid,
  member_id uuid,
  is_admin boolean
)
language plpgsql
security definer
set search_path = ''
set statement_timeout = '10s'
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_caller_access app_private.church_access%rowtype;
  v_target_access app_private.church_access%rowtype;
  v_target_user auth.users%rowtype;
  v_target_member app_private.members%rowtype;
  v_params jsonb;
  v_receipt app_private.member_permission_receipts%rowtype;
  v_action text;
  v_new_is_admin boolean;
begin
  if v_uid is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if p_church_id is null or p_target_member_id is null or p_command_id is null or p_action is null then
    raise exception 'Parâmetros obrigatórios ausentes.' using errcode = '22023';
  end if;

  v_action := lower(trim(p_action));
  if v_action not in ('grant', 'revoke') then
    raise exception 'Ação inválida. Utilize grant ou revoke.' using errcode = '22023';
  end if;

  v_new_is_admin := (v_action = 'grant');

  -- Ordem compatível com escritores de acesso: comando -> continuidade -> igreja -> autoridade
  perform pg_catalog.pg_advisory_xact_lock(hashtext(v_uid::text), hashtext(p_command_id::text));
  perform pg_catalog.pg_advisory_xact_lock(hashtext('church_admin_continuity'), hashtext(p_church_id::text));

  -- 1. Validação de Idempotência
  v_params := jsonb_build_object(
    'church_id', p_church_id,
    'target_member_id', p_target_member_id,
    'action', v_action
  );

  select r.* into v_receipt
  from app_private.member_permission_receipts r
  where r.user_id = v_uid and r.command_id = p_command_id;

  if found then
    if v_receipt.church_id <> p_church_id or v_receipt.params <> v_params then
      raise exception 'Comando já utilizado com outros parâmetros.' using errcode = '23505';
    end if;
    return query select
      p_church_id,
      p_command_id,
      p_target_member_id,
      (v_receipt.result->>'is_admin')::boolean;
    return;
  end if;

  -- 2. Validação da Autoridade do Operador Convocador
  select ca.* into v_caller_access
  from app_private.church_access ca
  join app_private.churches c on c.id = ca.church_id
  join app_private.members m on m.id = ca.member_id and m.church_id = ca.church_id
  join auth.users u on u.id = ca.user_id
  where ca.church_id = p_church_id and ca.user_id = v_uid
    and ca.status = 'active' and ca.onboarding_completed_at is not null
    and ca.is_admin = true
    and c.status = 'active' and m.status = 'active'
    and u.email_confirmed_at is not null and u.deleted_at is null
    and not coalesce(u.is_anonymous, false)
    and (u.banned_until is null or u.banned_until <= clock_timestamp())
  for share of ca, m, u;

  if not found then
    raise exception 'Operação exclusiva de administradores ativos desta igreja.' using errcode = '42501';
  end if;

  -- 3. Localização e Bloqueio do Membro Alvo
  select m.* into v_target_member
  from app_private.members m
  where m.id = p_target_member_id and m.church_id = p_church_id
  for share of m;

  if not found or v_target_member.status <> 'active' then
    raise exception 'Membro alvo inexistente ou inativo nesta igreja.' using errcode = '22023';
  end if;

  -- 4. Localização e Bloqueio do Vínculo de Acesso do Alvo
  select ca.* into v_target_access
  from app_private.church_access ca
  where ca.member_id = p_target_member_id and ca.church_id = p_church_id
  for update of ca;

  if not found or v_target_access.status <> 'active' or v_target_access.onboarding_completed_at is null then
    raise exception 'Membro alvo não possui vínculo de acesso ativo e concluído nesta igreja.' using errcode = '22023';
  end if;

  -- Validação da Conta Auth do Alvo
  select u.* into v_target_user
  from auth.users u
  where u.id = v_target_access.user_id;

  if not found or v_target_user.deleted_at is not null
     or v_target_user.email_confirmed_at is null
     or coalesce(v_target_user.is_anonymous, false)
     or (v_target_user.banned_until is not null and v_target_user.banned_until > clock_timestamp()) then
    raise exception 'A conta do membro alvo não está ativa ou confirmada.' using errcode = '22023';
  end if;

  -- 5. Execução Conforme a Ação
  if v_action = 'grant' then
    if v_target_access.is_admin = true then
      -- Idempotência funcional (já é admin)
      insert into app_private.member_permission_receipts (user_id, command_id, church_id, params, result)
      values (v_uid, p_command_id, p_church_id, v_params, jsonb_build_object('is_admin', true, 'member_id', p_target_member_id));

      return query select p_church_id, p_command_id, p_target_member_id, true;
      return;
    end if;

    -- CA01: Uma conta não pode administrar ativamente duas igrejas
    if exists (
      select 1
      from app_private.church_access ca2
      where ca2.user_id = v_target_access.user_id
        and ca2.is_admin = true
        and ca2.status = 'active'
        and ca2.church_id <> p_church_id
    ) then
      raise exception 'Este membro já possui administração ativa em outra igreja.' using errcode = '23514';
    end if;

    update app_private.church_access
    set is_admin = true
    where id = v_target_access.id;

    insert into app_private.audit_entries (
      church_id, action, actor_user_id, actor_source, target_type, target_id, details
    ) values (
      p_church_id,
      'grant_church_admin',
      v_uid,
      'application',
      'church_access',
      v_target_access.id,
      jsonb_build_object(
        'command_id', p_command_id,
        'target_member_id', p_target_member_id,
        'target_user_id', v_target_access.user_id,
        'is_self_action', (v_uid = v_target_access.user_id)
      )
    );

  elsif v_action = 'revoke' then
    if v_target_access.is_admin is not true then
      -- Idempotência funcional (já não é admin)
      insert into app_private.member_permission_receipts (user_id, command_id, church_id, params, result)
      values (v_uid, p_command_id, p_church_id, v_params, jsonb_build_object('is_admin', false, 'member_id', p_target_member_id));

      return query select p_church_id, p_command_id, p_target_member_id, false;
      return;
    end if;

    -- CA02: A retirada é recusada se deixar a igreja sem outro administrador plenamente elegível
    -- O gatilho app_private.protect_last_active_admin() protege tanto revogação de terceiros quanto saída voluntária
    update app_private.church_access
    set is_admin = false
    where id = v_target_access.id;

    insert into app_private.audit_entries (
      church_id, action, actor_user_id, actor_source, target_type, target_id, details
    ) values (
      p_church_id,
      'revoke_church_admin',
      v_uid,
      'application',
      'church_access',
      v_target_access.id,
      jsonb_build_object(
        'command_id', p_command_id,
        'target_member_id', p_target_member_id,
        'target_user_id', v_target_access.user_id,
        'is_self_action', (v_uid = v_target_access.user_id)
      )
    );
  end if;

  -- 6. Gravação do Recibo de Comando
  insert into app_private.member_permission_receipts (
    user_id, command_id, church_id, params, result
  ) values (
    v_uid,
    p_command_id,
    p_church_id,
    v_params,
    jsonb_build_object('is_admin', v_new_is_admin, 'member_id', p_target_member_id)
  );

  return query select p_church_id, p_command_id, p_target_member_id, v_new_is_admin;
end;
$function$;

revoke all on function public.manage_church_admin(uuid, uuid, text, uuid) from public, anon, service_role;
grant execute on function public.manage_church_admin(uuid, uuid, text, uuid) to authenticated;

commit;
