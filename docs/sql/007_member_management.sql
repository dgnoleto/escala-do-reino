-- Escala do Reino: cadastro e listagem de membros por administrador autorizado.
-- Cria app_private.command_receipts para idempotência e expõe endpoints em public.
-- app_private continua fora da Data API e sem acesso direto para clientes.
-- Apenas executar após ensaio 007_validate_member_management.sql com PASS.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $preflight$
declare v_role text;
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
     or to_regprocedure('public.get_my_church_access()') is null then
    raise exception 'Estrutura anterior ausente. Parar e conferir; não repetir scripts já aplicados.';
  end if;

  if to_regclass('app_private.command_receipts') is not null then
    raise exception 'app_private.command_receipts já existe. Parar e revisar.';
  end if;

  if exists (
    select 1 from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('list_church_members', 'create_church_member', 'get_create_member_receipt')
  ) then
    raise exception 'Um ou mais endpoints de membros já existem em public. Parar e revisar.';
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

-- Tabela interna para garantir idempotência, recuperação de resposta e proteção contra reexecução
create table app_private.command_receipts (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references app_private.churches(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  command_id uuid not null,
  action text not null,
  params_hash bytea not null check (octet_length(params_hash) = 32),
  result_member_id uuid not null references app_private.members(id) on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  constraint command_receipts_user_command_unique unique (user_id, command_id),
  constraint command_receipts_action_valid check (
    action = btrim(action) and char_length(action) between 1 and 80
  )
);

create index command_receipts_church_user_idx
  on app_private.command_receipts(church_id, user_id, command_id);
create index command_receipts_user_time_idx
  on app_private.command_receipts(user_id, created_at desc);

alter table app_private.command_receipts enable row level security;
revoke all on table app_private.command_receipts from public, anon, authenticated, service_role;

-- 1. Endpoint para listagem paginada de membros da igreja autorizada
create function public.list_church_members(
  p_church_id uuid,
  p_limit integer default 20,
  p_offset integer default 0
)
returns table (
  member_id uuid,
  display_name text,
  status text,
  created_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid;
  v_limit integer;
  v_offset integer;
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
      and (u.banned_until is null or u.banned_until <= statement_timestamp())
  ) then
    raise exception 'Acesso administrativo não autorizado nesta igreja.' using errcode = '42501';
  end if;

  v_limit := greatest(1, least(coalesce(p_limit, 20), 100));
  v_offset := greatest(0, coalesce(p_offset, 0));

  return query
  select
    m.id as member_id,
    m.display_name,
    m.status,
    m.created_at,
    count(*) over() as total_count
  from app_private.members m
  where m.church_id = p_church_id
  order by lower(m.display_name) asc, m.id asc
  limit v_limit
  offset v_offset;
end;
$function$;

-- 2. Endpoint para criação de membro com apenas o nome, auditoria e idempotência
create function public.create_church_member(
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
  v_clean_name := pg_catalog.btrim(pg_catalog.normalize(p_display_name, NFC));
  if char_length(v_clean_name) < 1 or char_length(v_clean_name) > 120 then
    raise exception 'Nome deve ter entre 1 e 120 caracteres.' using errcode = '23514';
  end if;

  -- Resumo SHA-256 dos parâmetros para proteção contra repetição com dados divergentes
  v_params_hash := pg_catalog.sha256(convert_to(p_church_id::text || ':' || v_clean_name, 'UTF8'));

  -- Ordem consistente de bloqueio: 1) Igreja, 2) Vínculo de acesso com o administrador
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

  -- Limitação compartilhada de taxa na rota efetiva: máx 30 criações por minuto por usuário
  select count(*) into v_recent_commands
  from app_private.command_receipts cr
  where cr.user_id = v_user_id
    and cr.created_at >= statement_timestamp() - interval '1 minute';

  if v_recent_commands >= 30 then
    raise exception 'Limite de requisições excedido. Aguarde antes de cadastrar novos membros.' using errcode = 'P0004';
  end if;

  -- Serialização de comandos concorrentes do mesmo usuário com o mesmo command_id
  perform pg_catalog.pg_advisory_xact_lock(hashtext(v_user_id::text), hashtext(p_command_id::text));

  -- Verificação de recibo existente para o mesmo comando
  select cr.params_hash, cr.result_member_id
  into v_existing_hash, v_existing_member_id
  from app_private.command_receipts cr
  where cr.user_id = v_user_id and cr.command_id = p_command_id;

  if v_existing_hash is not null then
    if v_existing_hash = v_params_hash then
      -- Idêntico: recupera o resultado original sem duplicar registros
      return query
      select m.id as member_id, m.display_name, m.status, m.created_at, true as already_existed
      from app_private.members m
      where m.id = v_existing_member_id and m.church_id = p_church_id;
      return;
    else
      -- Mesmo comando_id com parâmetros diferentes: rejeição estrita
      raise exception 'Comando já executado com parâmetros diferentes.' using errcode = '23505';
    end if;
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

-- 3. Endpoint para consulta do resultado de comando após resposta incerta
create function public.get_create_member_receipt(
  p_church_id uuid,
  p_command_id uuid
)
returns table (
  member_id uuid,
  display_name text,
  status text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid;
begin
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if p_church_id is null or p_command_id is null then
    raise exception 'Parâmetros obrigatórios ausentes.' using errcode = '22004';
  end if;

  -- Revalida autorização administrativa antes de devolver o resultado
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
      and (u.banned_until is null or u.banned_until <= statement_timestamp())
  ) then
    raise exception 'Acesso administrativo não autorizado nesta igreja.' using errcode = '42501';
  end if;

  return query
  select m.id as member_id, m.display_name, m.status, m.created_at
  from app_private.command_receipts cr
  join app_private.members m on m.id = cr.result_member_id and m.church_id = cr.church_id
  where cr.church_id = p_church_id
    and cr.user_id = v_user_id
    and cr.command_id = p_command_id
    and cr.action = 'create_member';
end;
$function$;

-- Revogar explicitamente todos os privilégios padrão e conceder somente a authenticated
revoke all on function public.list_church_members(uuid, integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.list_church_members(uuid, integer, integer) to authenticated;

revoke all on function public.create_church_member(uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.create_church_member(uuid, uuid, text) to authenticated;

revoke all on function public.get_create_member_receipt(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_create_member_receipt(uuid, uuid) to authenticated;

-- Verificação das funções antes do commit
do $verify$
declare
  v_proc_list oid := to_regprocedure('public.list_church_members(uuid, integer, integer)');
  v_proc_create oid := to_regprocedure('public.create_church_member(uuid, uuid, text)');
  v_proc_receipt oid := to_regprocedure('public.get_create_member_receipt(uuid, uuid)');
  v_proc oid;
begin
  foreach v_proc in array array[v_proc_list, v_proc_create, v_proc_receipt] loop
    if v_proc is null then
      raise exception 'Função esperada não foi registrada.';
    end if;

    if not exists (
      select 1 from pg_catalog.pg_proc p
      where p.oid = v_proc and p.prosecdef
        and (p.proconfig @> array['search_path=""']
             or p.proconfig @> array['search_path='])
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

select 'PASS: incremento de membros aplicado com sucesso; tabelas internas permanecem fechadas.'
  as validation_result;
