-- Escala do Reino: ensaio transacional de validação do incremento "Criar minha igreja".
-- Executa em transação protegida e termina estritamente com ROLLBACK.
-- Nenhuma tabela, função, permissão ou dado de teste é persistido.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- 1. Criação temporária dos objetos na transação do ensaio
create unique index church_access_single_active_admin_idx
  on app_private.church_access (user_id)
  where (is_admin = true and status = 'active');

create function app_private.protect_last_active_admin()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if OLD.is_admin = true and OLD.status = 'active' then
    if TG_OP = 'DELETE' or NEW.is_admin <> true or NEW.status <> 'active' or NEW.church_id <> OLD.church_id then
      if not exists (
        select 1 from app_private.church_access ca
        where ca.church_id = OLD.church_id
          and ca.id <> OLD.id
          and ca.is_admin = true
          and ca.status = 'active'
      ) then
        raise exception 'Operação não permitida: a igreja não pode ficar sem administrador ativo.'
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
begin
  if OLD.status = 'active' and (TG_OP = 'DELETE' or NEW.status <> 'active') then
    if exists (
      select 1 from app_private.church_access ca
      where ca.church_id = OLD.church_id
        and ca.member_id = OLD.id
        and ca.is_admin = true
        and ca.status = 'active'
    ) then
      if not exists (
        select 1 from app_private.church_access ca2
        where ca2.church_id = OLD.church_id
          and ca2.member_id <> OLD.id
          and ca2.is_admin = true
          and ca2.status = 'active'
      ) then
        raise exception 'Operação não permitida: não é possível desativar ou remover o membro que é o último administrador ativo da igreja.'
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
  active_admin_church_name text
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
    return query select false, 'user_not_found'::text, null::text;
    return;
  end if;

  if not v_email_confirmed then
    return query select false, 'email_not_confirmed'::text, null::text;
    return;
  end if;

  if not v_not_banned then
    return query select false, 'account_blocked'::text, null::text;
    return;
  end if;

  if not v_not_anonymous then
    return query select false, 'anonymous_not_allowed'::text, null::text;
    return;
  end if;

  if not v_not_deleted then
    return query select false, 'account_deleted'::text, null::text;
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
    return query select false, 'already_admin'::text, v_admin_church_name;
    return;
  end if;

  return query select true, 'eligible'::text, null::text;
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
  v_params_hash bytea;
  v_existing_hash bytea;
  v_existing_church_id uuid;
  v_existing_member_id uuid;
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

  if p_default_duration_policy not in ('warn', 'block') then
    raise exception 'Política de duração deve ser warn ou block.' using errcode = '23514';
  end if;

  v_params_hash := pg_catalog.sha256(convert_to(
    v_clean_name || ':' ||
    v_clean_creator_name || ':' ||
    v_clean_timezone || ':' ||
    coalesce(v_clean_address, '') || ':' ||
    coalesce(v_clean_maps_url, '') || ':' ||
    p_default_duration_policy,
    'UTF8'
  ));

  perform pg_catalog.pg_advisory_xact_lock(hashtext('create_my_church'), hashtext(v_user_id::text));

  select cr.params_hash, cr.church_id, cr.result_member_id
  into v_existing_hash, v_existing_church_id, v_existing_member_id
  from app_private.command_receipts cr
  where cr.user_id = v_user_id and cr.command_id = p_command_id;

  if v_existing_hash is not null then
    if v_existing_hash = v_params_hash then
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
    else
      raise exception 'Comando já executado com parâmetros diferentes.' using errcode = '23505';
    end if;
  end if;

  select
    u.email_confirmed_at is not null,
    u.deleted_at is null,
    not coalesce(u.is_anonymous, false),
    (u.banned_until is null or u.banned_until <= statement_timestamp())
  into v_email_confirmed, v_not_deleted, v_not_anonymous, v_not_banned
  from auth.users u
  where u.id = v_user_id;

  if v_email_confirmed is null or not v_email_confirmed or not v_not_deleted or not v_not_anonymous or not v_not_banned then
    raise exception 'Conta inelegível para criar igreja.' using errcode = '42501';
  end if;

  if exists (
    select 1 from app_private.church_access ca
    where ca.user_id = v_user_id
      and ca.is_admin = true
      and ca.status = 'active'
  ) then
    raise exception 'Conta já possui administração ativa em outra igreja.' using errcode = '42501';
  end if;

  select count(*) into v_recent_creations
  from app_private.command_receipts cr
  where cr.user_id = v_user_id
    and cr.action = 'create_church'
    and cr.created_at >= statement_timestamp() - interval '1 hour';

  if v_recent_creations >= 5 then
    raise exception 'Limite de requisições excedido. Aguarde antes de criar uma nova igreja.' using errcode = 'P0004';
  end if;

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
begin
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if p_command_id is null then
    raise exception 'Identificador de comando obrigatório.' using errcode = '22004';
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

revoke all on function public.check_church_creation_eligibility() from public, anon, authenticated, service_role;
grant execute on function public.check_church_creation_eligibility() to authenticated;

revoke all on function public.create_my_church(uuid, text, text, text, text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.create_my_church(uuid, text, text, text, text, text, text) to authenticated;

revoke all on function public.get_create_church_receipt(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_create_church_receipt(uuid) to authenticated;

-- 2. Execução dos testes do ensaio
do $test_suite$
declare
  v_test_user_a uuid;
  v_test_user_b uuid;
  v_test_user_c uuid;
  v_command_id uuid := gen_random_uuid();
  v_created_church_id uuid;
  v_created_member_id uuid;
  v_is_eligible boolean;
  v_reason text;
  v_already_existed boolean;
  v_receipt_found boolean;
  v_caught_error boolean;
begin
  -- Busca ou cria usuários para o ensaio
  select id into v_test_user_a
  from auth.users
  where email_confirmed_at is not null
    and deleted_at is null
    and not coalesce(is_anonymous, false)
    and (banned_until is null or banned_until <= statement_timestamp())
    and id not in (select user_id from app_private.church_access where is_admin = true and status = 'active')
  limit 1;

  if v_test_user_a is null then
    -- Se todos os usuários existentes forem admin, cria fixture temporária no auth.users
    v_test_user_a := gen_random_uuid();
    insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
    values (v_test_user_a, 'test_create_a_' || v_test_user_a::text || '@example.com', statement_timestamp(), '{"full_name":"Test User A"}'::jsonb);
  end if;

  -- Usuário B: email não confirmado
  v_test_user_b := gen_random_uuid();
  insert into auth.users (id, email, email_confirmed_at)
  values (v_test_user_b, 'test_create_b_' || v_test_user_b::text || '@example.com', null);

  -- Simula sessão do usuário B (email não confirmado)
  perform set_config('request.jwt.claim.sub', v_test_user_b::text, true);
  select eligible, reason into v_is_eligible, v_reason from public.check_church_creation_eligibility();
  if v_is_eligible or v_reason <> 'email_not_confirmed' then
    raise exception 'Falha no teste: usuário sem email confirmado deveria ser inelegível (recebeu %)', v_reason;
  end if;

  -- Simula sessão do usuário A (elegível)
  perform set_config('request.jwt.claim.sub', v_test_user_a::text, true);
  select eligible, reason into v_is_eligible, v_reason from public.check_church_creation_eligibility();
  if not v_is_eligible or v_reason <> 'eligible' then
    raise exception 'Falha no teste: usuário A deveria ser elegível (recebeu %)', v_reason;
  end if;

  -- Teste de criação atômica com normalização NFC e campos válidos
  select church_id, member_id, already_existed
  into v_created_church_id, v_created_member_id, v_already_existed
  from public.create_my_church(
    v_command_id,
    '  Igreja Batista Esperança  ',
    '  Pastor João d''Ávila  ',
    'America/Sao_Paulo',
    'Rua das Palmeiras, 100',
    'https://maps.google.com/?q=test',
    'warn'
  );

  if v_already_existed or v_created_church_id is null or v_created_member_id is null then
    raise exception 'Falha no teste: criação da igreja deveria retornar novos IDs e already_existed = false';
  end if;

  -- Verifica integridade no banco: igreja, membro, church_access, auditoria e recibo
  if not exists (
    select 1 from app_private.churches
    where id = v_created_church_id
      and name = 'Igreja Batista Esperança'
      and timezone = 'America/Sao_Paulo'
      and default_duration_policy = 'warn'
      and status = 'active'
  ) then
    raise exception 'Falha no teste: dados da igreja não persistidos corretamente';
  end if;

  if not exists (
    select 1 from app_private.members
    where id = v_created_member_id
      and church_id = v_created_church_id
      and display_name = 'Pastor João d''Ávila'
      and status = 'active'
  ) then
    raise exception 'Falha no teste: membro do criador não persistido corretamente';
  end if;

  if not exists (
    select 1 from app_private.church_access
    where church_id = v_created_church_id
      and user_id = v_test_user_a
      and member_id = v_created_member_id
      and is_admin = true
      and status = 'active'
      and onboarding_completed_at is not null
  ) then
    raise exception 'Falha no teste: vínculo administrativo não persistido corretamente';
  end if;

  if not exists (
    select 1 from app_private.audit_entries
    where church_id = v_created_church_id
      and action = 'create_church'
      and actor_user_id = v_test_user_a
      and actor_source = 'application'
  ) then
    raise exception 'Falha no teste: auditoria da criação não foi registrada';
  end if;

  if not exists (
    select 1 from app_private.command_receipts
    where church_id = v_created_church_id
      and user_id = v_test_user_a
      and command_id = v_command_id
      and action = 'create_church'
  ) then
    raise exception 'Falha no teste: recibo do comando não foi registrado';
  end if;

  -- Teste de idempotência com replay idêntico
  select already_existed into v_already_existed
  from public.create_my_church(
    v_command_id,
    'Igreja Batista Esperança',
    'Pastor João d''Ávila',
    'America/Sao_Paulo',
    'Rua das Palmeiras, 100',
    'https://maps.google.com/?q=test',
    'warn'
  );

  if not v_already_existed then
    raise exception 'Falha no teste: replay idempotente deveria retornar already_existed = true';
  end if;

  -- Teste de rejeição de mesmo command_id com parâmetros divergentes
  v_caught_error := false;
  begin
    perform public.create_my_church(
      v_command_id,
      'Outro Nome de Igreja',
      'Pastor João d''Ávila',
      'America/Sao_Paulo',
      null, null, 'warn'
    );
  rescue
    when sqlstate '23505' then
      v_caught_error := true;
  end;
  if not v_caught_error then
    raise exception 'Falha no teste: mesmo command_id com parâmetros diferentes deveria falhar com 23505';
  end if;

  -- Teste de consulta de recibo get_create_church_receipt
  if not exists (
    select 1 from public.get_create_church_receipt(v_command_id)
    where church_id = v_created_church_id and is_admin = true
  ) then
    raise exception 'Falha no teste: get_create_church_receipt não retornou a igreja criada';
  end if;

  -- Teste de inelegibilidade após assumir administração de uma igreja
  select eligible, reason into v_is_eligible, v_reason from public.check_church_creation_eligibility();
  if v_is_eligible or v_reason <> 'already_admin' then
    raise exception 'Falha no teste: usuário agora administra igreja e deveria ser inelegível (already_admin)';
  end if;

  -- Tentativa de criar segunda igreja como administrador ativo deve falhar
  v_caught_error := false;
  begin
    perform public.create_my_church(
      gen_random_uuid(),
      'Segunda Igreja Proibida',
      'Pastor João',
      'America/Sao_Paulo',
      null, null, 'warn'
    );
  rescue
    when sqlstate '42501' then
      v_caught_error := true;
  end;
  if not v_caught_error then
    raise exception 'Falha no teste: criação de segunda igreja administrada deveria falhar com 42501';
  end if;

  -- Teste de proteção do último administrador no banco:
  -- Tentativa de revogar o último admin da igreja criada deve ser bloqueada pelo gatilho
  v_caught_error := false;
  begin
    update app_private.church_access
    set is_admin = false
    where church_id = v_created_church_id and user_id = v_test_user_a;
  rescue
    when sqlstate '23514' then
      v_caught_error := true;
  end;
  if not v_caught_error then
    raise exception 'Falha no teste: revogar último admin ativo deveria ser bloqueado por gatilho com 23514';
  end if;

  -- Tentativa de desativar o membro que é o último admin ativo deve ser bloqueada
  v_caught_error := false;
  begin
    update app_private.members
    set status = 'inactive'
    where id = v_created_member_id and church_id = v_created_church_id;
  rescue
    when sqlstate '23514' then
      v_caught_error := true;
  end;
  if not v_caught_error then
    raise exception 'Falha no teste: desativar membro do último admin deveria ser bloqueado com 23514';
  end if;

  -- Adicionando um segundo admin à mesma igreja permite desativar/revogar o primeiro
  v_test_user_c := gen_random_uuid();
  insert into auth.users (id, email, email_confirmed_at)
  values (v_test_user_c, 'test_create_c_' || v_test_user_c::text || '@example.com', statement_timestamp());

  insert into app_private.members (id, church_id, display_name, status, created_by_user_id)
  values (gen_random_uuid(), v_created_church_id, 'Segundo Admin', 'active', v_test_user_a);

  insert into app_private.church_access (church_id, user_id, member_id, status, is_admin, onboarding_completed_at, granted_by_user_id)
  values (v_created_church_id, v_test_user_c, (select id from app_private.members where display_name = 'Segundo Admin' and church_id = v_created_church_id), 'active', true, statement_timestamp(), v_test_user_a);

  -- Agora revogar o primeiro admin é permitido porque há um segundo ativo
  update app_private.church_access
  set is_admin = false, status = 'revoked', revoked_at = statement_timestamp(), revoked_by_user_id = v_test_user_c
  where church_id = v_created_church_id and user_id = v_test_user_a;

  -- Mas revogar o segundo (que agora é o último remanescente) volta a ser bloqueado!
  v_caught_error := false;
  begin
    update app_private.church_access
    set is_admin = false
    where church_id = v_created_church_id and user_id = v_test_user_c;
  rescue
    when sqlstate '23514' then
      v_caught_error := true;
  end;
  if not v_caught_error then
    raise exception 'Falha no teste: revogar o segundo admin quando ele se torna o último deve ser bloqueado com 23514';
  end if;

end;
$test_suite$;

rollback;

select 'PASS: ensaio concluído; nenhuma alteração persistida.' as validation_result;
