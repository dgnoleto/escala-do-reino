-- Escala do Reino: fluxo "Criar minha igreja", limite de administração única e proteção do último administrador.
-- Cria o índice parcial único, os gatilhos de proteção e expõe os endpoints em public.
-- app_private continua fora da Data API e sem acesso direto para clientes.
-- Apenas executar após ensaio 009_validate_create_my_church.sql com PASS.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

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
     or to_regprocedure('public.get_create_member_receipt(uuid, uuid)') is null then
    raise exception 'Estrutura anterior ausente. Parar e conferir; não repetir scripts já aplicados.';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_indexes
    where schemaname = 'app_private'
      and tablename = 'church_access'
      and indexname = 'church_access_single_active_admin_idx'
  ) then
    raise exception 'Índice de administração única já existe. Parar e revisar.';
  end if;

  -- Diagnóstico de integridade prévia: não pode haver administrações ativas duplicadas por usuário
  if exists (
    select ca.user_id
    from app_private.church_access ca
    where ca.is_admin = true and ca.status = 'active'
    group by ca.user_id
    having count(*) > 1
  ) then
    raise exception 'Existem usuários com mais de uma administração ativa em church_access. Corrija os dados antes de criar o índice.';
  end if;

  if exists (
    select 1 from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('check_church_creation_eligibility', 'create_my_church', 'get_create_church_receipt')
  ) then
    raise exception 'Um ou mais endpoints de criação de igreja já existem em public. Parar e revisar.';
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
      raise exception 'Permissões internas inesperadas para %. Parar e revisar.', v_role;
    end if;
  end loop;
end;
$preflight$;

-- 1. Restrição no banco: no máximo uma administração ativa (is_admin = true e status = 'active') por conta Auth.
-- Nota: uma igreja pode ter múltiplos administradores ativos simultâneos. A restrição é exclusivamente sobre user_id.
create unique index church_access_single_active_admin_idx
  on app_private.church_access (user_id)
  where (is_admin = true and status = 'active');

-- 2. Gatilhos de salvaguarda da continuidade administrativa (proteção do último administrador no banco)
-- Estratégia de serialização: bloqueio consultivo transacional na igreja (church_admin_continuity)
-- Garante verificação do sucessor elegível (onboarding concluído, membro ativo, conta auth válida).
create function app_private.protect_last_active_admin()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_church_id uuid;
  v_has_eligible_successor boolean;
begin
  if OLD.is_admin = true and OLD.status = 'active' then
    if TG_OP = 'DELETE'
       or NEW.is_admin is not true
       or NEW.status <> 'active'
       or NEW.church_id <> OLD.church_id
       or NEW.user_id <> OLD.user_id
       or NEW.member_id <> OLD.member_id then

      v_church_id := OLD.church_id;

      -- Serializa alterações administrativas nesta igreja
      perform pg_catalog.pg_advisory_xact_lock(hashtext('church_admin_continuity'), hashtext(v_church_id::text));

      -- Confere se existe pelo menos um outro administrador ativo e elegível para a igreja
      select exists (
        select 1
        from app_private.church_access ca
        join app_private.members m on m.id = ca.member_id and m.church_id = ca.church_id
        join auth.users u on u.id = ca.user_id
        where ca.church_id = v_church_id
          and ca.id <> OLD.id
          and ca.is_admin = true
          and ca.status = 'active'
          and ca.onboarding_completed_at is not null
          and m.status = 'active'
          and u.deleted_at is null
          and u.email_confirmed_at is not null
          and not coalesce(u.is_anonymous, false)
          and (u.banned_until is null or u.banned_until <= statement_timestamp())
      ) into v_has_eligible_successor;

      if not v_has_eligible_successor then
        raise exception 'Operação não permitida: a igreja não pode ficar sem administrador ativo elegível.'
          using errcode = '23514';
      end if;
    end if;
  end if;

  if TG_OP = 'DELETE' then
    return OLD;
  end if;
  return NEW;
end;
$function$;

create trigger church_access_protect_last_admin
before update or delete on app_private.church_access
for each row execute function app_private.protect_last_active_admin();

create function app_private.protect_last_active_admin_member()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_church_id uuid;
  v_is_active_admin boolean;
  v_has_eligible_successor boolean;
begin
  if OLD.status = 'active' and (TG_OP = 'DELETE' or NEW.status <> 'active' or NEW.church_id <> OLD.church_id) then
    v_church_id := OLD.church_id;

    -- Verifica se este membro pertence a um administrador ativo
    select exists (
      select 1
      from app_private.church_access ca
      where ca.church_id = v_church_id
        and ca.member_id = OLD.id
        and ca.is_admin = true
        and ca.status = 'active'
    ) into v_is_active_admin;

    if v_is_active_admin then
      -- Serializa alterações administrativas nesta igreja
      perform pg_catalog.pg_advisory_xact_lock(hashtext('church_admin_continuity'), hashtext(v_church_id::text));

      -- Confere se existe outro membro que seja administrador ativo e elegível
      select exists (
        select 1
        from app_private.church_access ca
        join app_private.members m on m.id = ca.member_id and m.church_id = ca.church_id
        join auth.users u on u.id = ca.user_id
        where ca.church_id = v_church_id
          and ca.member_id <> OLD.id
          and ca.is_admin = true
          and ca.status = 'active'
          and ca.onboarding_completed_at is not null
          and m.status = 'active'
          and u.deleted_at is null
          and u.email_confirmed_at is not null
          and not coalesce(u.is_anonymous, false)
          and (u.banned_until is null or u.banned_until <= statement_timestamp())
      ) into v_has_eligible_successor;

      if not v_has_eligible_successor then
        raise exception 'Operação não permitida: não é possível desativar ou remover o membro do último administrador ativo elegível da igreja.'
          using errcode = '23514';
      end if;
    end if;
  end if;

  if TG_OP = 'DELETE' then
    return OLD;
  end if;
  return NEW;
end;
$function$;

create trigger members_protect_last_admin
before update or delete on app_private.members
for each row execute function app_private.protect_last_active_admin_member();

-- 3. Endpoint para consulta de elegibilidade do usuário autenticado para criar igreja
create function public.check_church_creation_eligibility()
returns table (
  eligible boolean,
  reason text,
  active_admin_church_name text,
  active_admin_church_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '5s'
as $function$
declare
  v_user_id uuid;
  v_email_confirmed boolean;
  v_not_deleted boolean;
  v_not_anonymous boolean;
  v_not_banned boolean;
  v_admin_church_id uuid;
  v_admin_church_name text;
begin
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  select
    u.email_confirmed_at is not null,
    u.deleted_at is null,
    not coalesce(u.is_anonymous, false),
    (u.banned_until is null or u.banned_until <= statement_timestamp())
  into v_email_confirmed, v_not_deleted, v_not_anonymous, v_not_banned
  from auth.users u
  where u.id = v_user_id;

  if v_email_confirmed is null then
    return query select false, 'user_not_found'::text, null::text, null::uuid;
    return;
  end if;

  if not v_email_confirmed then
    return query select false, 'email_not_confirmed'::text, null::text, null::uuid;
    return;
  end if;

  if not v_not_banned then
    return query select false, 'account_blocked'::text, null::text, null::uuid;
    return;
  end if;

  if not v_not_anonymous then
    return query select false, 'anonymous_not_allowed'::text, null::text, null::uuid;
    return;
  end if;

  if not v_not_deleted then
    return query select false, 'account_deleted'::text, null::text, null::uuid;
    return;
  end if;

  -- Consulta se já possui administração ativa em alguma igreja
  select ca.church_id, c.name
  into v_admin_church_id, v_admin_church_name
  from app_private.church_access ca
  join app_private.churches c on c.id = ca.church_id
  where ca.user_id = v_user_id
    and ca.is_admin = true
    and ca.status = 'active'
  limit 1;

  if v_admin_church_id is not null then
    return query select false, 'already_admin'::text, v_admin_church_name, v_admin_church_id;
    return;
  end if;

  return query select true, 'eligible'::text, null::text, null::uuid;
end;
$function$;

-- 4. Endpoint atômico para criação de igreja com idempotência, auditoria e salvaguardas
create function public.create_my_church(
  p_command_id uuid,
  p_name text,
  p_creator_name text,
  p_timezone text,
  p_address text default null,
  p_google_maps_url text default null,
  p_default_duration_policy text default 'warn'
)
returns table (
  church_id uuid,
  church_name text,
  member_id uuid,
  display_name text,
  timezone text,
  default_duration_policy text,
  is_admin boolean,
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
  v_clean_creator_name text;
  v_clean_timezone text;
  v_clean_address text;
  v_clean_maps_url text;
  v_params_json jsonb;
  v_params_hash bytea;
  v_existing_hash bytea;
  v_existing_church_id uuid;
  v_existing_member_id uuid;
  v_existing_action text;
  v_email_confirmed boolean;
  v_not_deleted boolean;
  v_not_anonymous boolean;
  v_not_banned boolean;
  v_new_church_id uuid;
  v_new_member_id uuid;
  v_recent_creations integer;
begin
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if p_command_id is null then
    raise exception 'Identificador de comando obrigatório.' using errcode = '22004';
  end if;

  if p_name is null then
    raise exception 'Nome da igreja obrigatório.' using errcode = '22004';
  end if;

  if p_creator_name is null then
    raise exception 'Nome do criador obrigatório.' using errcode = '22004';
  end if;

  if p_timezone is null then
    raise exception 'Fuso horário obrigatório.' using errcode = '22004';
  end if;

  if p_default_duration_policy is null then
    raise exception 'Política de duração obrigatória.' using errcode = '22004';
  end if;

  -- Normalização em NFC e sanitização de limites
  v_clean_name := pg_catalog.btrim(pg_catalog.normalize(p_name, 'NFC'));
  if char_length(v_clean_name) < 1 or char_length(v_clean_name) > 160 then
    raise exception 'Nome da igreja deve ter entre 1 e 160 caracteres.' using errcode = '23514';
  end if;

  v_clean_creator_name := pg_catalog.btrim(pg_catalog.normalize(p_creator_name, 'NFC'));
  if char_length(v_clean_creator_name) < 1 or char_length(v_clean_creator_name) > 120 then
    raise exception 'Nome do criador deve ter entre 1 e 120 caracteres.' using errcode = '23514';
  end if;

  v_clean_timezone := pg_catalog.btrim(p_timezone);
  if not exists (
    select 1 from pg_catalog.pg_timezone_names as t where t.name = v_clean_timezone
  ) then
    raise exception 'Identificador de fuso horário inválido.' using errcode = '23514';
  end if;

  v_clean_address := case when p_address is not null then pg_catalog.btrim(p_address) else null end;
  if v_clean_address = '' then
    v_clean_address := null;
  end if;
  if v_clean_address is not null and char_length(v_clean_address) > 500 then
    raise exception 'Endereço deve ter no máximo 500 caracteres.' using errcode = '23514';
  end if;

  v_clean_maps_url := case when p_google_maps_url is not null then pg_catalog.btrim(p_google_maps_url) else null end;
  if v_clean_maps_url = '' then
    v_clean_maps_url := null;
  end if;
  if v_clean_maps_url is not null and not (
    v_clean_maps_url ~* '^https://(maps\.app\.goo\.gl/|goo\.gl/maps/|(www\.)?google\.(com(\.[a-z]{2})?|[a-z]{2})/maps|maps\.google\.(com(\.[a-z]{2})?|[a-z]{2})/)'
  ) then
    raise exception 'Link do Google Maps deve ser uma URL válida de compartilhamento do Google Maps.' using errcode = '23514';
  end if;

  if p_default_duration_policy not in ('warn', 'block') then
    raise exception 'Política de duração deve ser warn ou block.' using errcode = '23514';
  end if;

  -- Resumo criptográfico estruturado e determinístico dos parâmetros incluindo a ação
  v_params_json := jsonb_build_object(
    'action', 'create_church',
    'name', v_clean_name,
    'creator_name', v_clean_creator_name,
    'timezone', v_clean_timezone,
    'address', v_clean_address,
    'google_maps_url', v_clean_maps_url,
    'default_duration_policy', p_default_duration_policy
  );
  v_params_hash := pg_catalog.sha256(convert_to(v_params_json::text, 'UTF8'));

  -- Bloqueio consultivo transacional serializa criações concorrentes da mesma conta
  perform pg_catalog.pg_advisory_xact_lock(hashtext('create_my_church_quota'), hashtext(v_user_id::text));

  -- Verificação de status da conta em auth.users
  select
    u.email_confirmed_at is not null,
    u.deleted_at is null,
    not coalesce(u.is_anonymous, false),
    (u.banned_until is null or u.banned_until <= statement_timestamp())
  into v_email_confirmed, v_not_deleted, v_not_anonymous, v_not_banned
  from auth.users u
  where u.id = v_user_id;

  -- 1) Verificação prioritária de recibo existente: recupera resultado original
  select cr.params_hash, cr.church_id, cr.result_member_id, cr.action
  into v_existing_hash, v_existing_church_id, v_existing_member_id, v_existing_action
  from app_private.command_receipts cr
  where cr.user_id = v_user_id and cr.command_id = p_command_id;

  if v_existing_hash is not null then
    if v_existing_action <> 'create_church' then
      raise exception 'Identificador de comando já utilizado para outra operação.' using errcode = '23505';
    end if;

    if v_existing_hash <> v_params_hash then
      raise exception 'Comando já executado com parâmetros diferentes.' using errcode = '23505';
    end if;

    -- Revalida autorização da conta: conta bloqueada/inelegível não obtém confirmação de acesso
    if v_email_confirmed is null or not v_email_confirmed or not v_not_deleted or not v_not_anonymous or not v_not_banned then
      raise exception 'Conta inelegível ou bloqueada.' using errcode = '42501';
    end if;

    -- Revalida o acesso atual à igreja criada: não restaura nem devolve admin se revogado ou inativo
    if not exists (
      select 1
      from app_private.churches c
      join app_private.members m on m.id = v_existing_member_id and m.church_id = c.id
      join app_private.church_access ca on ca.church_id = c.id and ca.user_id = v_user_id and ca.member_id = m.id
      where c.id = v_existing_church_id
        and c.status = 'active'
        and m.status = 'active'
        and ca.status = 'active'
        and ca.is_admin = true
    ) then
      raise exception 'Acesso administrativo à igreja criada não é mais válido ou foi revogado.' using errcode = '42501';
    end if;

    return query
    select
      c.id as church_id,
      c.name as church_name,
      m.id as member_id,
      m.display_name,
      c.timezone,
      c.default_duration_policy,
      true as is_admin,
      true as already_existed
    from app_private.churches c
    join app_private.members m on m.id = v_existing_member_id and m.church_id = c.id
    where c.id = v_existing_church_id;
    return;
  end if;

  -- 2) Revalidação estrita de elegibilidade da conta para nova criação
  if v_email_confirmed is null or not v_email_confirmed or not v_not_deleted or not v_not_anonymous or not v_not_banned then
    raise exception 'Conta inelegível para criar igreja.' using errcode = '42501';
  end if;

  -- Validação do limite de 1 administração ativa por conta Auth
  if exists (
    select 1 from app_private.church_access ca
    where ca.user_id = v_user_id
      and ca.is_admin = true
      and ca.status = 'active'
  ) then
    raise exception 'Conta já possui administração ativa em outra igreja.' using errcode = '42501';
  end if;

  -- Limite técnico de taxa compartilhada para criação de igrejas (10 por dia)
  select count(*) into v_recent_creations
  from app_private.command_receipts cr
  where cr.user_id = v_user_id
    and cr.action = 'create_church'
    and cr.created_at >= statement_timestamp() - interval '24 hours';

  if v_recent_creations >= 10 then
    raise exception 'Limite de requisições excedido. Aguarde antes de criar uma nova igreja.' using errcode = 'P0004';
  end if;

  -- 3) Criação atômica em transação única
  v_new_church_id := gen_random_uuid();
  v_new_member_id := gen_random_uuid();

  insert into app_private.churches (
    id, name, timezone, address, google_maps_url, default_duration_policy, status,
    created_at, updated_at
  ) values (
    v_new_church_id, v_clean_name, v_clean_timezone, v_clean_address, v_clean_maps_url,
    p_default_duration_policy, 'active', statement_timestamp(), statement_timestamp()
  );

  insert into app_private.members (
    id, church_id, display_name, status, created_by_user_id,
    created_at, updated_at
  ) values (
    v_new_member_id, v_new_church_id, v_clean_creator_name, 'active', v_user_id,
    statement_timestamp(), statement_timestamp()
  );

  insert into app_private.church_access (
    id, church_id, user_id, member_id, status, is_admin,
    onboarding_completed_at, granted_by_user_id, granted_at,
    created_at, updated_at
  ) values (
    gen_random_uuid(), v_new_church_id, v_user_id, v_new_member_id, 'active', true,
    statement_timestamp(), v_user_id, statement_timestamp(),
    statement_timestamp(), statement_timestamp()
  );

  insert into app_private.audit_entries (
    church_id, action, actor_user_id, actor_source, maintenance_operator,
    target_type, target_id, details, occurred_at
  ) values (
    v_new_church_id, 'create_church', v_user_id, 'application', null,
    'church', v_new_church_id,
    jsonb_build_object(
      'command_id', p_command_id,
      'church_name', v_clean_name,
      'creator_member_id', v_new_member_id,
      'creator_display_name', v_clean_creator_name,
      'timezone', v_clean_timezone,
      'default_duration_policy', p_default_duration_policy
    ),
    statement_timestamp()
  );

  insert into app_private.command_receipts (
    church_id, user_id, command_id, action, params_hash, result_member_id, created_at
  ) values (
    v_new_church_id, v_user_id, p_command_id, 'create_church', v_params_hash, v_new_member_id,
    statement_timestamp()
  );

  return query
  select
    v_new_church_id,
    v_clean_name,
    v_new_member_id,
    v_clean_creator_name,
    v_clean_timezone,
    p_default_duration_policy,
    true as is_admin,
    false as already_existed;
end;
$function$;

-- 5. Endpoint para consulta de recibo de criação de igreja após resposta incerta
create function public.get_create_church_receipt(
  p_command_id uuid
)
returns table (
  church_id uuid,
  church_name text,
  member_id uuid,
  display_name text,
  timezone text,
  default_duration_policy text,
  is_admin boolean
)
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '5s'
as $function$
declare
  v_user_id uuid;
  v_email_confirmed boolean;
  v_not_deleted boolean;
  v_not_anonymous boolean;
  v_not_banned boolean;
  v_receipt_action text;
  v_receipt_church_id uuid;
  v_receipt_member_id uuid;
begin
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if p_command_id is null then
    raise exception 'Identificador de comando obrigatório.' using errcode = '22004';
  end if;

  -- Revalida status da conta em auth.users
  select
    u.email_confirmed_at is not null,
    u.deleted_at is null,
    not coalesce(u.is_anonymous, false),
    (u.banned_until is null or u.banned_until <= statement_timestamp())
  into v_email_confirmed, v_not_deleted, v_not_anonymous, v_not_banned
  from auth.users u
  where u.id = v_user_id;

  if v_email_confirmed is null or not v_email_confirmed or not v_not_deleted or not v_not_anonymous or not v_not_banned then
    raise exception 'Conta inelegível ou bloqueada.' using errcode = '42501';
  end if;

  -- Busca o recibo para conferência da ação
  select cr.action, cr.church_id, cr.result_member_id
  into v_receipt_action, v_receipt_church_id, v_receipt_member_id
  from app_private.command_receipts cr
  where cr.user_id = v_user_id and cr.command_id = p_command_id;

  if v_receipt_action is null then
    -- Recibo ainda não gravado
    return;
  end if;

  if v_receipt_action <> 'create_church' then
    raise exception 'Identificador de comando pertence a outra ação.' using errcode = '23505';
  end if;

  -- Revalidação estrita da autorização e do vínculo atual:
  -- Se o acesso foi revogado, rebaixado, ou o membro/igreja inativado, encerra com 42501
  if not exists (
    select 1
    from app_private.churches c
    join app_private.members m on m.id = v_receipt_member_id and m.church_id = c.id
    join app_private.church_access ca on ca.church_id = c.id and ca.user_id = v_user_id and ca.member_id = m.id
    where c.id = v_receipt_church_id
      and c.status = 'active'
      and m.status = 'active'
      and ca.status = 'active'
      and ca.is_admin = true
  ) then
    raise exception 'Vínculo de acesso não está mais ativo ou privilégio administrativo revogado.' using errcode = '42501';
  end if;

  return query
  select
    c.id as church_id,
    c.name as church_name,
    m.id as member_id,
    m.display_name,
    c.timezone,
    c.default_duration_policy,
    ca.is_admin
  from app_private.command_receipts cr
  join app_private.churches c on c.id = cr.church_id
  join app_private.members m on m.id = cr.result_member_id and m.church_id = cr.church_id
  join app_private.church_access ca on ca.church_id = c.id and ca.user_id = v_user_id and ca.member_id = m.id
  where cr.user_id = v_user_id
    and cr.command_id = p_command_id
    and cr.action = 'create_church';
end;
$function$;

-- Revogar explicitamente privilégios padrão e conceder somente a authenticated
revoke all on function public.check_church_creation_eligibility()
  from public, anon, authenticated, service_role;
grant execute on function public.check_church_creation_eligibility() to authenticated;

revoke all on function public.create_my_church(uuid, text, text, text, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.create_my_church(uuid, text, text, text, text, text, text) to authenticated;

revoke all on function public.get_create_church_receipt(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_create_church_receipt(uuid) to authenticated;

-- Verificação das novas funções e permissões antes do commit
do $verify$
declare
  v_proc_eligibility oid := to_regprocedure('public.check_church_creation_eligibility()');
  v_proc_create oid := to_regprocedure('public.create_my_church(uuid, text, text, text, text, text, text)');
  v_proc_receipt oid := to_regprocedure('public.get_create_church_receipt(uuid)');
  v_proc oid;
begin
  foreach v_proc in array array[v_proc_eligibility, v_proc_create, v_proc_receipt] loop
    if v_proc is null then
      raise exception 'Função esperada não foi registrada.';
    end if;

    if not exists (
      select 1 from pg_catalog.pg_proc p
      where p.oid = v_proc and p.prosecdef
        and (p.proconfig @> array['search_path=""']
             or p.proconfig @> array['search_path='])
        and p.proconfig @> array['statement_timeout=5s']
    ) then
      raise exception 'Função % sem configuração de segurança esperada.', v_proc;
    end if;

    if not has_function_privilege('authenticated', v_proc, 'EXECUTE')
       or has_function_privilege('anon', v_proc, 'EXECUTE')
       or has_function_privilege('service_role', v_proc, 'EXECUTE')
       or exists (
         select 1 from pg_catalog.pg_proc p,
           lateral pg_catalog.aclexplode(
             coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
           ) a
         where p.oid = v_proc and a.grantee = 0
           and a.privilege_type = 'EXECUTE'
       ) then
      raise exception 'Permissões de execução incorretas para %.', v_proc;
    end if;
  end loop;
end;
$verify$;

notify pgrst, 'reload schema';
commit;

select 'PASS: incremento criar minha igreja aplicado com sucesso; administração única e salvaguarda ativas.'
  as validation_result;
