-- Escala do Reino: ensaio transacional de validação do incremento de gestão de membros.
-- Executa em transação protegida e termina estritamente com ROLLBACK.
-- Nenhuma tabela, função, permissão ou dado de teste é persistido.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- 1. Criação temporária dos objetos na transação do ensaio
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

  v_clean_name := pg_catalog.btrim(pg_catalog.normalize(p_display_name, NFC));
  if char_length(v_clean_name) < 1 or char_length(v_clean_name) > 120 then
    raise exception 'Nome deve ter entre 1 e 120 caracteres.' using errcode = '23514';
  end if;

  v_params_hash := pg_catalog.sha256(convert_to(p_church_id::text || ':' || v_clean_name, 'UTF8'));

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

  select count(*) into v_recent_commands
  from app_private.command_receipts cr
  where cr.user_id = v_user_id
    and cr.created_at >= statement_timestamp() - interval '1 minute';

  if v_recent_commands >= 30 then
    raise exception 'Limite de requisições excedido. Aguarde antes de cadastrar novos membros.' using errcode = 'P0004';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(hashtext(v_user_id::text), hashtext(p_command_id::text));

  select cr.params_hash, cr.result_member_id
  into v_existing_hash, v_existing_member_id
  from app_private.command_receipts cr
  where cr.user_id = v_user_id and cr.command_id = p_command_id;

  if v_existing_hash is not null then
    if v_existing_hash = v_params_hash then
      return query
      select m.id as member_id, m.display_name, m.status, m.created_at, true as already_existed
      from app_private.members m
      where m.id = v_existing_member_id and m.church_id = p_church_id;
      return;
    else
      raise exception 'Comando já executado com parâmetros diferentes.' using errcode = '23505';
    end if;
  end if;

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

revoke all on function public.list_church_members(uuid, integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.list_church_members(uuid, integer, integer) to authenticated;

revoke all on function public.create_church_member(uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.create_church_member(uuid, uuid, text) to authenticated;

revoke all on function public.get_create_member_receipt(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_create_member_receipt(uuid, uuid) to authenticated;

-- 2. Execução dos testes funcionais com fixtures locais temporárias
do $tests$
declare
  v_operator text := current_user;
  v_admin_user uuid;
  v_church_a uuid;
  v_church_b uuid;
  v_admin_member_a uuid;
  v_admin_access_a uuid;
  v_cmd1 uuid := gen_random_uuid();
  v_cmd2 uuid := gen_random_uuid();
  v_cmd3 uuid := gen_random_uuid();
  v_created_id uuid;
  v_replay_id uuid;
  v_already_existed boolean;
  v_audit_count integer;
  v_receipt_count integer;
  v_member_count integer;
  v_list_count integer;
  v_total_reported bigint;
  v_role text;
  v_receipt_member_id uuid;
  v_sql_inj_name text := 'Robert''); DROP TABLE app_private.members;--';
  v_accented_name text := 'Conceição d''Ávila';
  v_unrelated_user uuid;
begin
  -- Localizar conta confirmada existente no Auth para os testes
  select u.id into v_admin_user
  from auth.users u
  where u.email_confirmed_at is not null and u.deleted_at is null
    and not coalesce(u.is_anonymous, false)
    and (u.banned_until is null or u.banned_until <= statement_timestamp())
  order by u.id limit 1;

  if v_admin_user is null then
    raise exception 'O ensaio exige uma conta Auth confirmada para simular o administrador.';
  end if;

  -- Criar fixtures para a Igreja A e Igreja B
  insert into app_private.churches (name, timezone, default_duration_policy)
    values ('Igreja Ensaio A', 'America/Sao_Paulo', 'warn') returning id into v_church_a;

  insert into app_private.churches (name, timezone, default_duration_policy)
    values ('Igreja Ensaio B', 'America/Sao_Paulo', 'warn') returning id into v_church_b;

  insert into app_private.members (church_id, display_name, created_by_user_id)
    values (v_church_a, 'Admin Pastor A', v_admin_user) returning id into v_admin_member_a;

  insert into app_private.church_access (
    church_id, member_id, user_id, is_admin, onboarding_completed_at, granted_by_user_id
  ) values (
    v_church_a, v_admin_member_a, v_admin_user, true, statement_timestamp(), v_admin_user
  ) returning id into v_admin_access_a;

  -- Configurar claims do JWT simulando sessão autenticada do administrador
  perform set_config('request.jwt.claim.sub', v_admin_user::text, true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', v_admin_user::text, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  -- [Teste 1] Admin autorizado cria membro com acentuação e apóstrofo
  select member_id, already_existed into v_created_id, v_already_existed
  from public.create_church_member(v_church_a, v_cmd1, v_accented_name);

  if v_created_id is null or v_already_existed <> false then
    raise exception '[Teste 1 FALHA] Criação de membro não retornou ID válido ou indicou existência prévia incorreta.';
  end if;

  -- Conferir inserção na tabela membros
  select count(*) into v_member_count
  from app_private.members
  where id = v_created_id and church_id = v_church_a and display_name = v_accented_name;

  if v_member_count <> 1 then
    raise exception '[Teste 1 FALHA] Membro acentuado não encontrado na tabela app_private.members.';
  end if;

  -- Conferir registro na auditoria
  select count(*) into v_audit_count
  from app_private.audit_entries
  where church_id = v_church_a
    and action = 'create_member'
    and target_type = 'member'
    and target_id = v_created_id
    and actor_user_id = v_admin_user;

  if v_audit_count <> 1 then
    raise exception '[Teste 1 FALHA] Registro de auditoria transacional ausente ou incorreto.';
  end if;

  -- Conferir registro no recibo de comando
  select count(*) into v_receipt_count
  from app_private.command_receipts
  where church_id = v_church_a
    and user_id = v_admin_user
    and command_id = v_cmd1
    and result_member_id = v_created_id;

  if v_receipt_count <> 1 then
    raise exception '[Teste 1 FALHA] Recibo de comando ausente.';
  end if;

  -- [Teste 2] Replay com o mesmo command_id e mesmos parâmetros: recuperação idempotente
  select member_id, already_existed into v_replay_id, v_already_existed
  from public.create_church_member(v_church_a, v_cmd1, v_accented_name);

  if v_replay_id <> v_created_id or v_already_existed <> true then
    raise exception '[Teste 2 FALHA] Replay idempotente não retornou o membro original ou já existente.';
  end if;

  -- Verificar que NÃO duplicou membro ou auditoria
  select count(*) into v_member_count
  from app_private.members where id = v_created_id;
  if v_member_count <> 1 then
    raise exception '[Teste 2 FALHA] Replay gerou duplicação na tabela members.';
  end if;

  select count(*) into v_audit_count
  from app_private.audit_entries where target_id = v_created_id;
  if v_audit_count <> 1 then
    raise exception '[Teste 2 FALHA] Replay gerou duplicação na auditoria.';
  end if;

  -- [Teste 3] Replay com o mesmo command_id e parâmetros diferentes: rejeição estrita
  begin
    perform public.create_church_member(v_church_a, v_cmd1, 'Outro Nome Qualquer');
    raise exception '[Teste 3 FALHA] Reutilização de command_id com parâmetro diferente não foi rejeitada.';
  exception when unique_violation or sqlstate '23505' then
    -- Sucesso: erro esperado
    null;
  end;

  -- [Teste 4] Homônimos permitidos com command_ids distintos
  select member_id, already_existed into v_replay_id, v_already_existed
  from public.create_church_member(v_church_a, v_cmd2, v_accented_name);

  if v_replay_id = v_created_id or v_already_existed <> false then
    raise exception '[Teste 4 FALHA] Criação de membro homônimo com novo comando deveria gerar novo registro independente.';
  end if;

  -- [Teste 5] Texto semelhante a SQL tratado como dado puro
  select member_id into v_replay_id
  from public.create_church_member(v_church_a, v_cmd3, v_sql_inj_name);

  if not exists (
    select 1 from app_private.members where id = v_replay_id and display_name = v_sql_inj_name
  ) then
    raise exception '[Teste 5 FALHA] Texto com sintaxe SQL não foi gravado integralmente como dado.';
  end if;

  -- [Teste 6] Validação de limites de nome (vazio ou espaço em branco)
  begin
    perform public.create_church_member(v_church_a, gen_random_uuid(), '   ');
    raise exception '[Teste 6 FALHA] Nome contendo apenas espaços deveria ser rejeitado.';
  exception when check_violation or sqlstate '23514' then
    null;
  end;

  -- [Teste 7] Consulta do recibo após resposta incerta (get_create_member_receipt)
  select member_id into v_receipt_member_id
  from public.get_create_member_receipt(v_church_a, v_cmd1);

  if v_receipt_member_id <> v_created_id then
    raise exception '[Teste 7 FALHA] get_create_member_receipt não retornou o membro original confirmado.';
  end if;

  -- Comando desconhecido retorna 0 linhas
  if exists (
    select 1 from public.get_create_member_receipt(v_church_a, gen_random_uuid())
  ) then
    raise exception '[Teste 7 FALHA] get_create_member_receipt deveria retornar vazio para comando não executado.';
  end if;

  -- [Teste 8] Listagem paginada de membros da igreja
  select count(*), max(total_count) into v_list_count, v_total_reported
  from public.list_church_members(v_church_a, 10, 0);

  -- Temos 1 admin inicial + 3 criados no ensaio = 4 membros
  if v_list_count <> 4 or v_total_reported <> 4 then
    raise exception '[Teste 8 FALHA] list_church_members não retornou os 4 membros esperados ou total_count divergiu (obteve %, total %).', v_list_count, v_total_reported;
  end if;

  -- [Teste 9] Não permissão em outra igreja (Admin A tentando criar na Igreja B)
  begin
    perform public.create_church_member(v_church_b, gen_random_uuid(), 'Tentativa Ilegal');
    raise exception '[Teste 9 FALHA] Admin da Igreja A conseguiu criar membro na Igreja B.';
  exception when insufficient_privilege or sqlstate '42501' then
    null;
  end;

  begin
    perform public.list_church_members(v_church_b, 10, 0);
    raise exception '[Teste 9 FALHA] Admin da Igreja A conseguiu listar membros da Igreja B.';
  exception when insufficient_privilege or sqlstate '42501' then
    null;
  end;

  -- [Teste 10] Usuário sem admin tentando listar ou criar
  update app_private.church_access set is_admin = false where id = v_admin_access_a;

  begin
    perform public.create_church_member(v_church_a, gen_random_uuid(), 'Tentativa Não Admin');
    raise exception '[Teste 10 FALHA] Usuário sem permissão admin conseguiu criar membro.';
  exception when insufficient_privilege or sqlstate '42501' then
    null;
  end;

  begin
    perform public.list_church_members(v_church_a, 10, 0);
    raise exception '[Teste 10 FALHA] Usuário sem permissão admin conseguiu listar membros.';
  exception when insufficient_privilege or sqlstate '42501' then
    null;
  end;

  -- Restaurar operador de manutenção para testar privilégios diretos e anon
  perform set_config('role', v_operator, true);

  -- [Teste 11] anon e service_role não podem executar os endpoints
  foreach v_role in array array['anon', 'service_role'] loop
    perform set_config('role', v_role, true);
    begin
      perform 1 from public.list_church_members(v_church_a, 10, 0);
      raise exception '[Teste 11 FALHA] Papel % conseguiu executar list_church_members.', v_role;
    exception when insufficient_privilege then
      null;
    end;

    begin
      perform 1 from public.create_church_member(v_church_a, gen_random_uuid(), 'Teste Anon');
      raise exception '[Teste 11 FALHA] Papel % conseguiu executar create_church_member.', v_role;
    exception when insufficient_privilege then
      null;
    end;

    begin
      perform 1 from public.get_create_member_receipt(v_church_a, gen_random_uuid());
      raise exception '[Teste 11 FALHA] Papel % conseguiu executar get_create_member_receipt.', v_role;
    exception when insufficient_privilege then
      null;
    end;

    -- app_private.command_receipts permanece bloqueada para acesso direto
    begin
      perform 1 from app_private.command_receipts;
      raise exception '[Teste 11 FALHA] Papel % tem acesso direto a app_private.command_receipts.', v_role;
    exception when insufficient_privilege then
      null;
    end;

    perform set_config('role', v_operator, true);
  end loop;

end;
$tests$;

rollback;

-- Verificação de encerramento do ensaio
select case
  when to_regclass('app_private.command_receipts') is null
   and to_regprocedure('public.list_church_members(uuid, integer, integer)') is null
   and to_regprocedure('public.create_church_member(uuid, uuid, text)') is null
   and to_regprocedure('public.get_create_member_receipt(uuid, uuid)') is null
  then 'PASS: ensaio concluído; nenhuma alteração persistida.'
  else 'FAIL: objetos do ensaio ainda presentes após rollback; parar e revisar.'
end as validation_result;
