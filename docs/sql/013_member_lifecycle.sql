-- Escala do Reino: ciclo de vida de membros — listagem administrativa com filtros,
-- restauração elegível sem concessão de acesso, recibo de ciclo de vida e
-- endpoint autorizado de exclusão protegido por indisponibilidade litúrgica (P0021).
-- Inclui gatilho monotônico exclusivo de members (preservando touch_updated_at genérico).
-- Apenas executar após aprovação formal do responsável e ensaio 013_validate_member_lifecycle.sql com PASS.

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
     or to_regprocedure('public.get_create_member_receipt(uuid, uuid)') is null
     or to_regprocedure('public.issue_church_invitation(uuid, uuid, uuid, text)') is null
     or to_regprocedure('public.get_invitation_command_receipt(uuid)') is null then
    raise exception 'Estrutura dos incrementos anteriores (001–012) ausente. Parar e conferir.';
  end if;

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

-- 1. Gatilho monotônico estrito exclusivo para a tabela app_private.members
-- Preserva app_private.touch_updated_at() genérico em churches e church_access intacto.
drop trigger if exists members_touch_updated_at on app_private.members;

create or replace function app_private.touch_member_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  new.updated_at := greatest(clock_timestamp(), old.updated_at + interval '1 microsecond');
  return new;
end;
$function$;

create trigger members_touch_updated_at
before update on app_private.members
for each row execute function app_private.touch_member_updated_at();

-- 2. Endpoint: list_church_members_admin (Listagem Administrativa com Filtros e Contagem Total)
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

  -- Contagem total com base no filtro selecionado
  select count(*)
  into v_total
  from app_private.members m
  where m.church_id = p_church_id
    and (
      v_status = 'all'
      or (v_status = 'active' and m.status = 'active')
      or (v_status = 'inactive' and m.status = 'inactive')
    );

  -- Itens paginados formatados em JSONB com updated_at em precisão integral UTC (microssegundos)
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
      )
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

  return query
  select v_items as items, v_total as total_count;
end;
$function$;

-- 3. Endpoint: restore_church_member (Restauração Elegível Idempotente sem Devolver Acesso)
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
  update app_private.members
  set status = 'active'
  where id = p_member_id and church_id = p_church_id
  returning updated_at into v_new_updated_at;

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

-- 4. Endpoint: get_member_lifecycle_receipt (Consulta Idempotente de Recibo de Ciclo de Vida)
create or replace function public.get_member_lifecycle_receipt(
  p_command_id uuid
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
stable
security definer
set search_path = ''
set statement_timeout = '5s'
as $function$
declare
  v_user_id uuid;
  v_cmd_id uuid;
  v_action text;
  v_church_id uuid;
  v_member_id uuid;
  v_payload jsonb;
  v_created_at timestamptz;
begin
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if p_command_id is null then
    raise exception 'Identificador de comando obrigatório.' using errcode = '22004';
  end if;

  -- Revalidação estrita da elegibilidade da conta chamadora
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

  select cr.command_id, cr.action, cr.church_id, cr.result_member_id, cr.result_payload, cr.created_at
  into v_cmd_id, v_action, v_church_id, v_member_id, v_payload, v_created_at
  from app_private.command_receipts cr
  where cr.user_id = v_user_id and cr.command_id = p_command_id;

  if v_cmd_id is null then
    raise exception 'Recibo de comando não encontrado.' using errcode = 'P0002';
  end if;

  if v_action not in ('restore_member', 'deactivate_member') then
    raise exception 'Ação de comando não reconhecida para ciclo de vida de membros.' using errcode = '42501';
  end if;

  -- Revalidação estrita de autorização administrativa atual na igreja do recibo
  if not exists (
    select 1
    from app_private.church_access ca
    join auth.users u on u.id = ca.user_id
    join app_private.churches c on c.id = ca.church_id
    join app_private.members m on m.church_id = ca.church_id and m.id = ca.member_id
    where ca.church_id = v_church_id
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
    raise exception 'Acesso não autorizado ao recibo administrativo.' using errcode = '42501';
  end if;

  return query
  select
    v_cmd_id,
    v_action,
    v_church_id,
    v_member_id,
    v_payload,
    v_created_at;
end;
$function$;

-- 5. Endpoint: deactivate_church_member (Exclusão com Autorização Prévia e Indisponibilidade P0021)
create or replace function public.deactivate_church_member(
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
  v_member_exists boolean;
begin
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

  -- Hash canônico dos parâmetros
  v_params_canonical := jsonb_build_object(
    'action', 'deactivate_member',
    'church_id', p_church_id::text,
    'member_id', p_member_id::text,
    'expected_updated_at', p_expected_updated_at
  )::text;
  v_params_hash := sha256(convert_to(v_params_canonical, 'UTF8'));

  -- 1. Prioridade do recibo existente (Replay seguro histórico)
  select cr.command_id, cr.action, cr.church_id, cr.params_hash, cr.result_member_id, cr.result_payload, cr.created_at
  into v_existing_receipt
  from app_private.command_receipts cr
  where cr.user_id = v_user_id and cr.command_id = p_command_id;

  if v_existing_receipt.command_id is not null then
    if v_existing_receipt.action <> 'deactivate_member'
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

    -- Replay autorizado não reaplica efeitos
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

  -- 2. Primeira execução: AUTORIZAR COMPLETAMENTE ANTES DE P0021!
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

  -- 3. Validação de existência do membro nesta igreja
  select exists (
    select 1 from app_private.members m
    where m.church_id = p_church_id and m.id = p_member_id
  ) into v_member_exists;

  if not v_member_exists then
    raise exception 'Membro não encontrado nesta igreja.' using errcode = 'P0002';
  end if;

  -- 4. Operador plenamente autorizado: informa indisponibilidade por ausência do módulo de escalas (P0021).
  -- Nenhuma mutação é realizada. Nenhum recibo é gravado para a tentativa bloqueada por dependência.
  -- O corpo futuro de exclusão efetiva permanece exclusivamente no acervo de desenho.
  raise exception 'Exclusão indisponível: módulo de escalas e validação de dependências litúrgicas ainda não integrados ao banco de dados.'
    using errcode = 'P0021';
end;
$function$;

-- 6. Endurecimento de Segurança e Privilégios Mínimos
revoke all on function public.list_church_members_admin(uuid, text, integer, integer) from public, anon, service_role;
grant execute on function public.list_church_members_admin(uuid, text, integer, integer) to authenticated;

revoke all on function public.restore_church_member(uuid, uuid, uuid, text) from public, anon, service_role;
grant execute on function public.restore_church_member(uuid, uuid, uuid, text) to authenticated;

revoke all on function public.get_member_lifecycle_receipt(uuid) from public, anon, service_role;
grant execute on function public.get_member_lifecycle_receipt(uuid) to authenticated;

revoke all on function public.deactivate_church_member(uuid, uuid, uuid, text) from public, anon, service_role;
grant execute on function public.deactivate_church_member(uuid, uuid, uuid, text) to authenticated;

commit;
