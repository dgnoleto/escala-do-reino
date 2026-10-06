-- Escala do Reino: ensaio transacional de validação do incremento "Criar minha igreja".
-- Executa em transação protegida e termina estritamente com ROLLBACK.
-- Nenhuma tabela, função, permissão ou dado de teste é persistido.
--
-- ATENÇÃO — AMBIENTE DE EXECUÇÃO E DEPENDÊNCIAS DE FIXTURES:
-- Este script foi projetado para execução estrita em ambiente isolado dedicado para testes
-- (PostgreSQL local ou ambiente efêmero de staging/CI) com esquemas auth e app_private disponíveis.
-- O ensaio cria registros sintéticos em auth.users e altera confirmações de e-mail para fins de validação.
-- NÃO COPIE OU EXECUTE ESTE ENSAIO NO AMBIENTE DE PILOTO/PRODUÇÃO sem definir a estratégia de contas
-- de teste e sem expressa autorização. Não execute SQL remoto.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- 1. Criação dos objetos na transação do ensaio (fiel à implantação permanente de 009_create_my_church.sql)
create unique index church_access_single_active_admin_idx
  on app_private.church_access (user_id)
  where (is_admin = true and status = 'active');

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

-- Revoga de public, anon, service_role e concede exclusivamente a authenticated
revoke all on function public.check_church_creation_eligibility() from public, anon, authenticated, service_role;
grant execute on function public.check_church_creation_eligibility() to authenticated;

revoke all on function public.create_my_church(uuid, text, text, text, text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.create_my_church(uuid, text, text, text, text, text, text) to authenticated;

revoke all on function public.get_create_church_receipt(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_create_church_receipt(uuid) to authenticated;

-- 2. Bloco de testes transacionais com alternância de papéis e asserções estritas
do $test_suite$
declare
  v_operator text := current_user;
  v_test_user_a uuid := gen_random_uuid();
  v_test_user_b uuid := gen_random_uuid();
  v_test_user_c uuid := gen_random_uuid();
  v_command_id uuid := gen_random_uuid();
  v_other_action_cmd uuid := gen_random_uuid();
  v_created_church_id uuid;
  v_created_member_id uuid;
  v_is_eligible boolean;
  v_reason text;
  v_caught_error boolean;
  v_role text;
  v_table text;
  v_bad_url text;
  v_bad_urls text[];
  v_err_msg text;
  v_err_state text;
begin
  -- Asserção inicial: ensaio precisa iniciar sob papel com privilégios de operador
  if current_user = 'authenticated' or current_user = 'anon' then
    raise exception 'Ensaio deve ser iniciado com permissões administrativas de operador.';
  end if;

  -- [Cenário 0.1] Negativas de permissões diretas em app_private para anon, authenticated e service_role
  foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
    if has_schema_privilege(v_role, 'app_private', 'USAGE,CREATE') then
      raise exception 'Falha no teste: % não deve possuir USAGE ou CREATE em app_private', v_role;
    end if;

    foreach v_table in array array['churches', 'members', 'church_access', 'audit_entries', 'command_receipts', 'access_invitations', 'access_requests'] loop
      if has_table_privilege(v_role, 'app_private.' || v_table, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then
        raise exception 'Falha no teste: % não deve possuir privilégios em app_private.%', v_role, v_table;
      end if;
    end loop;
  end loop;

  -- [Cenário 0.2] Negativa de execução das RPCs públicas para anon e service_role
  foreach v_role in array array['anon', 'service_role'] loop
    execute 'set local role ' || quote_ident(v_role);
    if current_user <> v_role then
      raise exception 'Falha ao alternar papel para %', v_role;
    end if;

    begin
      perform public.check_church_creation_eligibility();
      raise exception 'Falha no teste: % não deve executar check_church_creation_eligibility', v_role;
    exception when insufficient_privilege then
      null;
    end;

    begin
      perform public.create_my_church(gen_random_uuid(), 'Igreja', 'Pastor', 'America/Sao_Paulo', null, null, 'warn');
      raise exception 'Falha no teste: % não deve executar create_my_church', v_role;
    exception when insufficient_privilege then
      null;
    end;

    begin
      perform public.get_create_church_receipt(gen_random_uuid());
      raise exception 'Falha no teste: % não deve executar get_create_church_receipt', v_role;
    exception when insufficient_privilege then
      null;
    end;

    execute 'reset role';
    if current_user <> v_operator then
      raise exception 'Falha ao retornar ao operador a partir de %', v_role;
    end if;
  end loop;

  -- Fixtures sintéticas criadas estritamente como operador
  insert into auth.users (id, email, email_confirmed_at)
  values
    (v_test_user_a, 'test_create_a_' || v_test_user_a::text || '@example.com', statement_timestamp()),
    (v_test_user_b, 'test_create_b_' || v_test_user_b::text || '@example.com', statement_timestamp()),
    (v_test_user_c, 'test_create_c_' || v_test_user_c::text || '@example.com', statement_timestamp());

  -- Alterna para authenticated com claims de Usuário A
  perform set_config('request.jwt.claim.sub', v_test_user_a::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_test_user_a::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  if current_user <> 'authenticated' then
    raise exception 'Falha: current_user deveria ser authenticated para chamadas de RPC';
  end if;

  -- [Cenário 1] Usuário sem igreja administrada é elegível
  select eligible, reason into v_is_eligible, v_reason from public.check_church_creation_eligibility();
  if not v_is_eligible or v_reason <> 'eligible' then
    raise exception 'Falha no teste: usuário A deveria ser elegível para criar igreja';
  end if;

  -- [Cenário 2] Criação atômica da igreja via RPC pública
  select church_id, member_id into v_created_church_id, v_created_member_id
  from public.create_my_church(
    v_command_id,
    'Comunidade:Esperança',
    'Pastor João',
    'America/Sao_Paulo',
    'Rua das Palmeiras, 100',
    'https://maps.app.goo.gl/exemplo123',
    'warn'
  );

  if v_created_church_id is null or v_created_member_id is null then
    raise exception 'Falha no teste: criação não retornou church_id ou member_id válidos';
  end if;

  -- Retorna ao operador para inspecionar que as tabelas privadas foram populadas corretamente
  execute 'reset role';
  if current_user <> v_operator then
    raise exception 'Falha ao retornar ao operador para inspeção de app_private';
  end if;

  if not exists (select 1 from app_private.churches where id = v_created_church_id)
     or not exists (select 1 from app_private.members where id = v_created_member_id)
     or not exists (select 1 from app_private.church_access where church_id = v_created_church_id and user_id = v_test_user_a and is_admin = true)
     or not exists (select 1 from app_private.command_receipts where church_id = v_created_church_id and command_id = v_command_id and action = 'create_church')
     or not exists (select 1 from app_private.audit_entries where target_id = v_created_church_id and action = 'create_church') then
    raise exception 'Falha no teste: registros não encontrados em app_private na inspeção do operador';
  end if;

  -- Retorna para authenticated
  execute 'set local role authenticated';
  if current_user <> 'authenticated' then
    raise exception 'Falha: current_user deveria ser authenticated';
  end if;

  -- [Cenário 3] Replay legítimo imediato (mesmo command_id e mesmos parâmetros)
  if not exists (
    select 1 from public.create_my_church(
      v_command_id,
      'Comunidade:Esperança',
      'Pastor João',
      'America/Sao_Paulo',
      'Rua das Palmeiras, 100',
      'https://maps.app.goo.gl/exemplo123',
      'warn'
    )
    where church_id = v_created_church_id
      and member_id = v_created_member_id
      and already_existed = true
  ) then
    raise exception 'Falha no teste: replay com mesmos parâmetros deveria retornar already_existed = true';
  end if;

  -- [Cenário 4] Rejeição de colisão ambígua de parâmetros com delimitação ':'
  v_caught_error := false;
  begin
    perform public.create_my_church(
      v_command_id,
      'Comunidade',
      'Esperança:Pastor João',
      'America/Sao_Paulo',
      'Rua das Palmeiras, 100',
      'https://maps.app.goo.gl/exemplo123',
      'warn'
    );
  exception
    when sqlstate '23505' then
      v_caught_error := true;
  end;
  if not v_caught_error then
    raise exception 'Falha no teste: parâmetros com texto colidindo em dois pontos devem ser distinguidos pelo hash JSONB (23505)';
  end if;

  -- [Cenário 5] Rejeição de reuso de command_id em ação diferente
  execute 'reset role';
  insert into app_private.command_receipts (church_id, user_id, command_id, action, params_hash, result_member_id, created_at)
  values (
    v_created_church_id,
    v_test_user_a,
    v_other_action_cmd,
    'create_member',
    pg_catalog.sha256(pg_catalog.convert_to('fixture-other-action', 'UTF8')),
    v_created_member_id,
    statement_timestamp()
  );
  execute 'set local role authenticated';

  v_caught_error := false;
  begin
    perform public.create_my_church(
      v_other_action_cmd,
      'Nova Igreja',
      'Pastor João',
      'America/Sao_Paulo',
      null, null, 'warn'
    );
  exception
    when sqlstate '23505' then
      v_caught_error := true;
  end;
  if not v_caught_error then
    raise exception 'Falha no teste: command_id previamente usado para create_member deve ser rejeitado com 23505 em create_my_church';
  end if;

  -- [Cenário 6] Consulta de recibo legítimo get_create_church_receipt
  if not exists (
    select 1 from public.get_create_church_receipt(v_command_id)
    where church_id = v_created_church_id and is_admin = true
  ) then
    raise exception 'Falha no teste: get_create_church_receipt não retornou a igreja criada';
  end if;

  -- [Cenário 7] Usuário A agora é inelegível para criar nova igreja (já é admin)
  select eligible, reason into v_is_eligible, v_reason from public.check_church_creation_eligibility();
  if v_is_eligible or v_reason <> 'already_admin' then
    raise exception 'Falha no teste: usuário A deveria ser inelegível (already_admin)';
  end if;

  -- Tentativa de criar segunda igreja como admin ativo deve falhar com 42501
  v_caught_error := false;
  begin
    perform public.create_my_church(
      gen_random_uuid(),
      'Segunda Igreja Proibida',
      'Pastor João',
      'America/Sao_Paulo',
      null, null, 'warn'
    );
  exception
    when sqlstate '42501' then
      v_caught_error := true;
  end;
  if not v_caught_error then
    raise exception 'Falha no teste: criação de segunda igreja administrada deve falhar com 42501';
  end if;

  -- Retorna ao operador para setup dos cenários de múltiplos administradores e regras de continuidade
  execute 'reset role';
  if current_user <> v_operator then
    raise exception 'Falha ao retornar ao operador';
  end if;

  -- [Cenário 8] Regra de Administração: Uma igreja pode ter múltiplos administradores ativos!
  insert into app_private.members (id, church_id, display_name, status, created_by_user_id)
  values (gen_random_uuid(), v_created_church_id, 'Segundo Admin B', 'active', v_test_user_a);

  insert into app_private.church_access (id, church_id, user_id, member_id, status, is_admin, onboarding_completed_at, granted_by_user_id)
  values (gen_random_uuid(), v_created_church_id, v_test_user_b, (select id from app_private.members where display_name = 'Segundo Admin B' and church_id = v_created_church_id), 'active', true, statement_timestamp(), v_test_user_a);

  -- [Cenário 9] Bloqueio físico de admin em duas igrejas distintas pelo índice de unicidade
  declare
    v_other_church_id uuid := gen_random_uuid();
    v_other_member_id uuid := gen_random_uuid();
  begin
    insert into app_private.churches (id, name, timezone, default_duration_policy, status)
    values (v_other_church_id, 'Outra Igreja X', 'America/Sao_Paulo', 'warn', 'active');

    insert into app_private.members (id, church_id, display_name, status, created_by_user_id)
    values (v_other_member_id, v_other_church_id, 'Membro X', 'active', v_test_user_a);

    v_caught_error := false;
    begin
      insert into app_private.church_access (id, church_id, user_id, member_id, status, is_admin, onboarding_completed_at, granted_by_user_id)
      values (gen_random_uuid(), v_other_church_id, v_test_user_a, v_other_member_id, 'active', true, statement_timestamp(), v_test_user_a);
    exception
      when sqlstate '23505' then
        v_caught_error := true;
    end;
    if not v_caught_error then
      raise exception 'Falha no teste: church_access_single_active_admin_idx deve bloquear segunda administração ativa para Usuário A';
    end if;
  end;

  -- [Cenário 10] Continuidade: Usuário A pode deixar a administração de v_created_church_id pois Usuário B é admin elegível
  update app_private.church_access
  set is_admin = false, status = 'revoked', revoked_at = statement_timestamp(), revoked_by_user_id = v_test_user_b
  where church_id = v_created_church_id and user_id = v_test_user_a;

  -- [Cenário 11] Replay e Recibo após revogação de acesso
  execute 'set local role authenticated';
  v_caught_error := false;
  begin
    perform public.create_my_church(
      v_command_id,
      'Comunidade:Esperança',
      'Pastor João',
      'America/Sao_Paulo',
      'Rua das Palmeiras, 100',
      'https://maps.app.goo.gl/exemplo123',
      'warn'
    );
  exception
    when sqlstate '42501' then
      v_caught_error := true;
  end;
  if not v_caught_error then
    raise exception 'Falha no teste: replay após revogação de acesso deve falhar com 42501';
  end if;

  v_caught_error := false;
  begin
    perform public.get_create_church_receipt(v_command_id);
  exception
    when sqlstate '42501' then
      v_caught_error := true;
  end;
  if not v_caught_error then
    raise exception 'Falha no teste: get_create_church_receipt após revogação de acesso deve falhar com 42501';
  end if;

  -- Volta ao operador para testar os gatilhos de continuidade
  execute 'reset role';

  -- [Cenário 12] Proteção do último administrador: Usuário B é agora o único admin de v_created_church_id
  v_caught_error := false;
  begin
    update app_private.church_access
    set is_admin = false
    where church_id = v_created_church_id and user_id = v_test_user_b;
  exception
    when sqlstate '23514' then
      v_caught_error := true;
  end;
  if not v_caught_error then
    raise exception 'Falha no teste: remoção/revogação do último admin elegível deve ser bloqueada com 23514';
  end if;

  -- Tentativa de desativar o membro de Usuário B deve ser bloqueada pelo gatilho em members com 23514
  v_caught_error := false;
  begin
    update app_private.members
    set status = 'inactive'
    where id = (select member_id from app_private.church_access where church_id = v_created_church_id and user_id = v_test_user_b);
  exception
    when sqlstate '23514' then
      v_caught_error := true;
  end;
  if not v_caught_error then
    raise exception 'Falha no teste: desativação do membro do último admin elegível deve ser bloqueada com 23514';
  end if;

  -- [Cenário 13] Sucessor inelegível não autoriza saída do último admin válido
  update auth.users set email_confirmed_at = null where id = v_test_user_c;

  insert into app_private.members (id, church_id, display_name, status, created_by_user_id)
  values (gen_random_uuid(), v_created_church_id, 'Admin C Inelegível', 'active', v_test_user_b);

  insert into app_private.church_access (id, church_id, user_id, member_id, status, is_admin, onboarding_completed_at, granted_by_user_id)
  values (gen_random_uuid(), v_created_church_id, v_test_user_c, (select id from app_private.members where display_name = 'Admin C Inelegível' and church_id = v_created_church_id), 'active', true, statement_timestamp(), v_test_user_b);

  v_caught_error := false;
  begin
    update app_private.church_access
    set is_admin = false
    where church_id = v_created_church_id and user_id = v_test_user_b;
  exception
    when others then
      get stacked diagnostics
        v_err_state = returned_sqlstate,
        v_err_msg = message_text;
      if v_err_state = '23514' and v_err_msg like '%não pode ficar sem administrador ativo elegível%' then
        v_caught_error := true;
      end if;
  end;
  if not v_caught_error then
    raise exception 'Falha no teste: sucessor com conta inelegível não pode permitir a saída do único admin válido';
  end if;

  -- Confere que o vínculo original do admin continua preservado
  if not exists (
    select 1 from app_private.church_access
    where church_id = v_created_church_id
      and user_id = v_test_user_b
      and is_admin = true
      and status = 'active'
  ) then
    raise exception 'Falha no teste: vínculo original do último admin deveria ter sido preservado';
  end if;

  -- [Cenário 14] Validação estrita de URLs do Google Maps no servidor
  -- 14.1 URLs válidas aceitas: uma conta sintética nova por URL válida
  declare
    v_url_user uuid;
    v_url_command_id uuid;
    v_valid_url text;
    v_valid_urls text[] := array[
      'https://maps.app.goo.gl/exemplo123',
      'https://goo.gl/maps/exemplo456',
      'https://www.google.com/maps/place/Igreja',
      'https://google.com.br/maps/place/Igreja'
    ];
    v_url_church_id uuid;
    v_url_member_id uuid;
  begin
    foreach v_valid_url in array v_valid_urls loop
      -- Garante papel de operador antes de preparar a fixture
      execute 'reset role';
      if current_user <> v_operator then
        raise exception 'Falha ao garantir operador antes da fixture de URL';
      end if;

      v_url_user := gen_random_uuid();
      v_url_command_id := gen_random_uuid();

      insert into auth.users (id, email, email_confirmed_at)
      values (v_url_user, 'test_create_url_' || v_url_user::text || '@example.com', statement_timestamp());

      perform set_config('request.jwt.claim.sub', v_url_user::text, true);
      perform set_config('request.jwt.claims', json_build_object('sub', v_url_user::text, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      if current_user <> 'authenticated' then
        raise exception 'Falha ao alternar papel para authenticated no teste de URL válida';
      end if;

      select church_id, member_id into v_url_church_id, v_url_member_id
      from public.create_my_church(
        v_url_command_id,
        'Igreja Maps Válido ' || substr(v_valid_url, 9, 8),
        'Pastor Maps',
        'America/Sao_Paulo',
        null,
        v_valid_url,
        'warn'
      );

      if v_url_church_id is null or v_url_member_id is null then
        raise exception 'Falha: criação de igreja com URL válida % não retornou IDs', v_valid_url;
      end if;

      -- Retorna ao operador para confirmar registros relacionados e preparar próxima fixture
      execute 'reset role';
      if current_user <> v_operator then
        raise exception 'Falha ao retornar ao operador para conferência de URL';
      end if;

      if not exists (select 1 from app_private.churches where id = v_url_church_id and google_maps_url = v_valid_url)
         or not exists (select 1 from app_private.members where id = v_url_member_id and church_id = v_url_church_id)
         or not exists (select 1 from app_private.church_access where church_id = v_url_church_id and user_id = v_url_user and is_admin = true and status = 'active')
         or not exists (select 1 from app_private.command_receipts where church_id = v_url_church_id and command_id = v_url_command_id and action = 'create_church')
         or not exists (select 1 from app_private.audit_entries where church_id = v_url_church_id and target_id = v_url_church_id and action = 'create_church') then
        raise exception 'Falha: registros relacionados para URL % não foram encontrados em app_private', v_valid_url;
      end if;
    end loop;
    execute 'reset role';
  end;

  -- 14.2 URLs inválidas e subdomínios falsos rejeitados com 23514
  v_bad_urls := array[
    'https://site-malicioso.com/phishing',
    'https://google.exemplo.com/maps',
    'https://fakegoogle.com/maps',
    'https://maps.google.attacker.com/xyz',
    'http://maps.google.com/insecure',
    'https://evil.com/google.com/maps'
  ];
  declare
    v_test_user_maps_fail uuid := gen_random_uuid();
  begin
    insert into auth.users (id, email, email_confirmed_at)
    values (v_test_user_maps_fail, 'test_create_mf_' || v_test_user_maps_fail::text || '@example.com', statement_timestamp());

    perform set_config('request.jwt.claim.sub', v_test_user_maps_fail::text, true);
    perform set_config('request.jwt.claims', json_build_object('sub', v_test_user_maps_fail::text, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';

    foreach v_bad_url in array v_bad_urls loop
      v_caught_error := false;
      begin
        perform public.create_my_church(
          gen_random_uuid(),
          'Igreja URL Inválida',
          'Pastor',
          'America/Sao_Paulo',
          null,
          v_bad_url,
          'warn'
        );
      exception
        when sqlstate '23514' then
          v_caught_error := true;
      end;
      if not v_caught_error then
        raise exception 'Falha no teste: URL % deveria ser rejeitada com 23514', v_bad_url;
      end if;
    end loop;
    execute 'reset role';
  end;

  -- [Cenário 15] Atomicidade por falha controlada na auditoria e ausência de gravações parciais
  -- Operador cria trigger temporário em app_private.audit_entries que simula erro de inserção
  execute 'reset role';
  if current_user <> v_operator then
    raise exception 'Falha ao garantir operador antes do teste de atomicidade';
  end if;

  create function app_private.fail_audit_trigger()
  returns trigger language plpgsql as $$
  begin
    if NEW.action = 'create_church' and NEW.details->>'church_name' = 'Igreja Falha Auditoria' then
      raise exception 'Simulação controlada de falha na auditoria: [AUDIT_SIMULATED_FAILURE]' using errcode = 'P0001';
    end if;
    return NEW;
  end;
  $$;

  create trigger trg_fail_audit_test
  before insert on app_private.audit_entries
  for each row execute function app_private.fail_audit_trigger();

  declare
    v_test_user_e uuid := gen_random_uuid();
    v_cmd_audit_fail uuid := gen_random_uuid();
  begin
    insert into auth.users (id, email, email_confirmed_at)
    values (v_test_user_e, 'test_create_e_' || v_test_user_e::text || '@example.com', statement_timestamp());

    perform set_config('request.jwt.claim.sub', v_test_user_e::text, true);
    perform set_config('request.jwt.claims', json_build_object('sub', v_test_user_e::text, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    if current_user <> 'authenticated' then
      raise exception 'Falha ao alternar papel para authenticated no cenário 15';
    end if;

    v_caught_error := false;
    begin
      perform public.create_my_church(
        v_cmd_audit_fail,
        'Igreja Falha Auditoria',
        'Pastor Teste',
        'America/Sao_Paulo',
        null, null, 'warn'
      );
    exception
      when others then
        get stacked diagnostics
          v_err_state = returned_sqlstate,
          v_err_msg = message_text;
        if v_err_state = 'P0001' and v_err_msg like '%[AUDIT_SIMULATED_FAILURE]%' then
          v_caught_error := true;
        end if;
    end;
    if not v_caught_error then
      raise exception 'Falha no teste: falha controlada de auditoria deveria abortar a criação com [AUDIT_SIMULATED_FAILURE]';
    end if;

    -- Volta ao operador para inspecionar que NENHUM registro parcial foi salvo
    execute 'reset role';
    if current_user <> v_operator then
      raise exception 'Falha ao garantir operador após teste de atomicidade';
    end if;

    drop trigger trg_fail_audit_test on app_private.audit_entries;
    drop function app_private.fail_audit_trigger();

    if exists (select 1 from app_private.churches where name = 'Igreja Falha Auditoria') then
      raise exception 'Falha no teste de atomicidade: igreja foi gravada parcialmente após falha de auditoria';
    end if;
    if exists (select 1 from app_private.command_receipts where command_id = v_cmd_audit_fail) then
      raise exception 'Falha no teste de atomicidade: recibo foi gravado parcialmente após falha de auditoria';
    end if;
    if exists (select 1 from app_private.members where display_name = 'Pastor Teste' and created_by_user_id = v_test_user_e) then
      raise exception 'Falha no teste de atomicidade: membro foi gravado parcialmente após falha de auditoria';
    end if;
    if exists (select 1 from app_private.church_access where user_id = v_test_user_e) then
      raise exception 'Falha no teste de atomicidade: acesso foi gravado parcialmente após falha de auditoria';
    end if;
    if exists (select 1 from app_private.audit_entries where actor_user_id = v_test_user_e or details->>'command_id' = v_cmd_audit_fail::text) then
      raise exception 'Falha no teste de atomicidade: auditoria foi gravada parcialmente após falha de auditoria';
    end if;
  end;

end;
$test_suite$;

rollback;

select 'PASS: ensaio concluído; nenhuma alteração persistida.' as validation_result;
