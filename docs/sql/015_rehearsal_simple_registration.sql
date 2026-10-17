-- ============================================================================
-- Escala do Reino — Primeiro Ensaio Físico Reversível: Cadastro Simples
-- Incremento: 015 (Fonte Real de Dependências Litúrgicas)
-- ============================================================================
-- Script Autocontido de Instalação Temporária do Candidato 015 e Ensaio Transacional
-- Executa na MESMA conexão e transação:
--   1. Guarda antecipada de ambiente e identificação do alvo autorizado
--   2. Instalação temporária do candidato exato (tabelas, triggers, 22 RPCs, grants)
--   3. Setup privilegiado de fixtures (usuários, igreja, membros, church_access)
--   4. Ciclo de cadastro executado estritamente como papel 'authenticated'
--   5. Asserções e inspeções de auditoria sob 'reset role' (papel privilegiado)
--   6. Encerramento incondicional com ROLLBACK
--   7. Conferência pós-ROLLBACK atestando zero resíduos estruturais e de dados
--
-- ATENÇÃO E GOVERNANÇA:
-- - Executar apenas em container Docker local autorizado ou laboratório local (127.0.0.1 / ::1).
-- - Alvo de autorização requerido: host, porta (ex: 54321 / 5432), banco ('postgres' ou base efêmera 'escala_rehearsal_tmp').
-- - Proibição absoluta contra piloto remoto ('jvpctgqudvjealzileib'), bases compartilhadas ou produção.
-- - Com ON_ERROR_STOP=on, qualquer erro interrompe a execução e o fechamento da conexão garante o ROLLBACK imediato no backend PostgreSQL. Em sessões interativas, a transação abortada rejeita comandos até a emissão explícita de ROLLBACK.
-- ============================================================================
\set ON_ERROR_STOP on

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- 0. Guarda Antecipada de Instância Local e Identificação do Alvo Autorizado
do $guard_target$
declare
  v_server_addr inet;
  v_db text := current_database();
begin
  if v_db ~* 'prod|pilot|jvpctgqudvjealzileib' then
    raise exception 'EXECUÇÃO ABORTADA: Tentativa de execução contra base remota/piloto/compartilhada: %', v_db;
  end if;

  v_server_addr := inet_server_addr();
  -- inet_server_addr é NULL para conexões unix domain socket locais
  if v_server_addr is not null and not (
    v_server_addr = '127.0.0.1'::inet
    or v_server_addr = '::1'::inet
  ) then
    raise exception 'EXECUÇÃO ABORTADA: Conexão física deve ser estritamente loopback local (inet_server_addr = %).', v_server_addr;
  end if;

  raise notice 'ALVO AUTORIZADO VALIDADO: Banco: %, Endereço: %, Porta: %', v_db, coalesce(v_server_addr::text, 'socket-local'), inet_server_port();
end
$guard_target$;

-- 1. Snapshot de Baseline Pré-Instalação (Conferência Antes/Depois)
create temporary table if not exists _rehearsal_baseline_snapshot (
  metric text primary key,
  int_value integer
) on commit drop;

insert into _rehearsal_baseline_snapshot (metric, int_value)
values
  ('teams_table_exists', (select count(*)::int from information_schema.tables where table_schema = 'app_private' and table_name = 'teams')),
  ('rehearsal_users_count', (select count(*)::int from auth.users where id in ('01500000-0000-4000-8000-000000000002'::uuid, '01500000-0000-4000-8000-000000000003'::uuid))),
  ('rehearsal_churches_count', (select count(*)::int from app_private.churches where id = '01500000-0000-4000-8000-000000000001'::uuid)),
  ('rehearsal_members_count', (select count(*)::int from app_private.members where church_id = '01500000-0000-4000-8000-000000000001'::uuid));

-- ============================================================================
-- 2. Instalação Temporária do Candidato Exato (DDL do Incremento 015 sem COMMIT)
-- ============================================================================
-- 0. Bloco de Pré-verificação Transacional Inline
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
     or to_regclass('app_private.audit_entries') is null
     or to_regclass('app_private.command_receipts') is null then
    raise exception 'Estrutura base dos incrementos 001–013 ausente. Parar e conferir.';
  end if;

  if to_regclass('app_private.teams') is not null
     or to_regclass('app_private.events') is not null
     or to_regclass('app_private.assignments') is not null then
    raise exception 'Tabelas do incremento 015 já existem em app_private. Parar e revisar.';
  end if;
end;
$preflight$;

-- 0.1 Evolução do Contrato de Recibos para Entidades Litúrgicas (B2-01)
-- Torna result_member_id opcional e adiciona result_entity_id e result_payload preservando a chave (user_id, command_id)
alter table app_private.command_receipts
  alter column result_member_id drop not null,
  add column if not exists result_entity_id uuid,
  add column if not exists result_payload jsonb;

-- 1. Criação das Tabelas Operacionais com Integridade Composta em app_private

-- 1.1 Equipes / Ministérios
create table app_private.teams (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references app_private.churches(id) on delete restrict,
  name text not null,
  leader_member_id uuid,
  status text not null default 'active' check (status in ('active', 'inactive')),
  version integer not null default 1,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint teams_church_name_clean check (name = btrim(name) and char_length(name) between 1 and 100),
  constraint teams_church_id_id_unique unique (church_id, id),
  constraint teams_church_id_name_unique unique (church_id, name),
  constraint teams_church_leader_fkey
    foreign key (church_id, leader_member_id)
    references app_private.members(church_id, id) on delete restrict
);

create index teams_church_leader_active_idx
  on app_private.teams (church_id, leader_member_id)
  where status = 'active' and leader_member_id is not null;

create trigger teams_touch_updated_at
  before update on app_private.teams
  for each row execute function app_private.touch_updated_at();

alter table app_private.teams enable row level security;

-- 1.2 Integrantes das Equipes
create table app_private.team_memberships (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null,
  team_id uuid not null,
  member_id uuid not null,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint tm_church_id_id_unique unique (church_id, id),
  constraint tm_church_team_fkey
    foreign key (church_id, team_id)
    references app_private.teams(church_id, id) on delete restrict,
  constraint tm_church_member_fkey
    foreign key (church_id, member_id)
    references app_private.members(church_id, id) on delete restrict,
  constraint tm_church_team_member_unique unique (church_id, team_id, member_id)
);

create index tm_church_member_active_idx
  on app_private.team_memberships (church_id, member_id)
  where status = 'active';

create trigger tm_touch_updated_at
  before update on app_private.team_memberships
  for each row execute function app_private.touch_updated_at();

alter table app_private.team_memberships enable row level security;

-- 1.3 Funções Técnicas da Equipe
create table app_private.team_roles (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null,
  team_id uuid not null,
  name text not null,
  description text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint tr_church_id_id_unique unique (church_id, id),
  constraint tr_name_clean check (name = btrim(name) and char_length(name) between 1 and 100),
  constraint tr_church_team_fkey
    foreign key (church_id, team_id)
    references app_private.teams(church_id, id) on delete restrict,
  constraint tr_church_team_role_unique unique (church_id, team_id, id),
  constraint tr_church_team_name_unique unique (church_id, team_id, name)
);

create index tr_church_team_active_idx
  on app_private.team_roles (church_id, team_id)
  where status = 'active';

create trigger tr_touch_updated_at
  before update on app_private.team_roles
  for each row execute function app_private.touch_updated_at();

alter table app_private.team_roles enable row level security;

-- 1.4 Aptidões / Qualificações Homologadas de Membros
create table app_private.member_qualifications (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null,
  member_id uuid not null,
  team_id uuid not null,
  team_role_id uuid not null,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint mq_church_id_id_unique unique (church_id, id),
  constraint mq_church_member_fkey
    foreign key (church_id, member_id)
    references app_private.members(church_id, id) on delete restrict,
  constraint mq_church_team_fkey
    foreign key (church_id, team_id)
    references app_private.teams(church_id, id) on delete restrict,
  constraint mq_church_role_fkey
    foreign key (church_id, team_id, team_role_id)
    references app_private.team_roles(church_id, team_id, id) on delete restrict,
  constraint mq_church_member_role_unique unique (church_id, member_id, team_role_id)
);

create index mq_church_member_active_idx
  on app_private.member_qualifications (church_id, member_id, team_role_id)
  where status = 'active';

create trigger mq_touch_updated_at
  before update on app_private.member_qualifications
  for each row execute function app_private.touch_updated_at();

alter table app_private.member_qualifications enable row level security;

-- 1.5 Eventos e Cultos (Com timezone herdado da igreja - B2-02)
create table app_private.events (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references app_private.churches(id) on delete restrict,
  title text not null,
  event_type text not null default 'culto',
  timezone text not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'in_progress', 'completed', 'cancelled')),
  planned_start_at timestamptz not null,
  planned_end_at timestamptz not null,
  actual_start_at timestamptz,
  actual_end_at timestamptz,
  liturgy_leader_member_id uuid,
  version integer not null default 1,
  cancel_reason text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint events_title_clean check (title = btrim(title) and char_length(title) between 1 and 200),
  constraint events_timezone_clean check (timezone = btrim(timezone) and char_length(timezone) between 1 and 80),
  constraint events_dates_order check (planned_end_at > planned_start_at),
  constraint events_church_id_id_unique unique (church_id, id),
  constraint events_church_liturgy_fkey
    foreign key (church_id, liturgy_leader_member_id)
    references app_private.members(church_id, id) on delete restrict
);

create index events_church_status_start_idx
  on app_private.events (church_id, status, planned_start_at);

create trigger events_touch_updated_at
  before update on app_private.events
  for each row execute function app_private.touch_updated_at();

alter table app_private.events enable row level security;

-- 1.6 Itens do Cronograma de Culto (Com chave única hierárquica - B2-02)
create table app_private.event_items (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null,
  event_id uuid not null,
  title text not null,
  item_nature text not null default 'liturgical' check (item_nature in ('liturgical', 'parallel_support')),
  sequence_order integer not null default 1,
  planned_duration_seconds integer not null default 300 check (planned_duration_seconds > 0),
  status text not null default 'pending' check (status in ('pending', 'in_progress', 'completed', 'cancelled')),
  designated_team_id uuid,
  nominal_leader_member_id uuid,
  actual_start_at timestamptz,
  actual_end_at timestamptz,
  cancel_reason text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint ei_church_id_id_unique unique (church_id, id),
  constraint ei_church_event_item_unique unique (church_id, event_id, id),
  constraint ei_church_event_fkey
    foreign key (church_id, event_id)
    references app_private.events(church_id, id) on delete restrict,
  constraint ei_church_team_fkey
    foreign key (church_id, designated_team_id)
    references app_private.teams(church_id, id) on delete restrict,
  constraint ei_church_leader_fkey
    foreign key (church_id, nominal_leader_member_id)
    references app_private.members(church_id, id) on delete restrict
);

create index ei_church_event_order_idx
  on app_private.event_items (church_id, event_id, sequence_order);

create trigger ei_touch_updated_at
  before update on app_private.event_items
  for each row execute function app_private.touch_updated_at();

alter table app_private.event_items enable row level security;

-- 1.7 Alocações e Escalas de Voluntários (Com FK hierárquica church_id/event_id/item_id - B2-02)
create table app_private.assignments (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null,
  event_id uuid not null,
  item_id uuid,
  team_id uuid not null,
  team_role_id uuid,
  member_id uuid not null,
  status text not null default 'active' check (status in ('active', 'replaced', 'cancelled')),
  replaced_assignment_id uuid,
  replacement_assignment_id uuid,
  notes text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint asg_church_id_id_unique unique (church_id, id),
  constraint asg_church_event_fkey
    foreign key (church_id, event_id)
    references app_private.events(church_id, id) on delete restrict,
  constraint asg_church_event_item_fkey
    foreign key (church_id, event_id, item_id)
    references app_private.event_items(church_id, event_id, id) on delete restrict,
  constraint asg_church_member_fkey
    foreign key (church_id, member_id)
    references app_private.members(church_id, id) on delete restrict,
  constraint asg_church_team_fkey
    foreign key (church_id, team_id)
    references app_private.teams(church_id, id) on delete restrict,
  constraint asg_church_team_role_fkey
    foreign key (church_id, team_id, team_role_id)
    references app_private.team_roles(church_id, team_id, id) on delete restrict,
  constraint asg_replaced_fkey
    foreign key (church_id, replaced_assignment_id)
    references app_private.assignments(church_id, id) on delete restrict,
  constraint asg_replacement_fkey
    foreign key (church_id, replacement_assignment_id)
    references app_private.assignments(church_id, id) on delete restrict
);

create index asg_church_event_active_idx
  on app_private.assignments (church_id, event_id, status)
  where status = 'active';

create index asg_church_member_active_idx
  on app_private.assignments (church_id, member_id, status)
  where status = 'active';

create trigger asg_touch_updated_at
  before update on app_private.assignments
  for each row execute function app_private.touch_updated_at();

alter table app_private.assignments enable row level security;


-- 2.1 create_church_team
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

-- 2.2 assign_team_leader
create or replace function public.assign_team_leader(
  p_church_id uuid,
  p_command_id uuid,
  p_team_id uuid,
  p_new_leader_member_id uuid,
  p_expected_version integer default null
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
  v_team record;
  v_params_hash bytea;
  v_existing_receipt record;
  v_payload jsonb;
  v_created_at timestamptz;
  c_action constant text := 'assign_team_leader';
begin
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if p_church_id is null or p_command_id is null or p_team_id is null or p_new_leader_member_id is null then
    raise exception 'Parâmetros obrigatórios ausentes.' using errcode = '22004';
  end if;

  -- Advisory lock imediato para estabilizar o contexto do comando
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

  -- B2-03: Designar/trocar lideranças é exclusivo ao administrador
  if v_caller_member_id is null or not coalesce(v_is_admin, false) then
    raise exception 'Apenas administradores podem designar ou alterar a liderança da equipe.' using errcode = '42501';
  end if;

  v_params_hash := pg_catalog.sha256(convert_to(jsonb_build_object(
    'action', c_action,
    'church_id', p_church_id,
    'team_id', p_team_id,
    'new_leader_member_id', p_new_leader_member_id,
    'expected_version', p_expected_version
  )::text, 'UTF8'));

  select cr.command_id, cr.action, cr.church_id, cr.result_entity_id, cr.result_payload, cr.created_at, cr.params_hash
  into v_existing_receipt
  from app_private.command_receipts cr
  where cr.user_id = v_user_id
    and cr.command_id = p_command_id;

  if v_existing_receipt.command_id is not null then
    if not coalesce(v_is_admin, false) then
      raise exception 'Apenas administradores podem designar ou alterar a liderança da equipe.' using errcode = '42501';
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

  -- Bloqueio canônico do novo membro antes da equipe
  perform 1 from app_private.members m
  where m.church_id = p_church_id and m.id = p_new_leader_member_id and m.status = 'active'
  for update;

  if not found then
    raise exception 'Novo líder não encontrado ou inativo nesta igreja.' using errcode = 'P0020';
  end if;

  -- Bloqueio canônico da equipe
  select t.id, t.leader_member_id, t.version, t.status
  into v_team
  from app_private.teams t
  where t.church_id = p_church_id and t.id = p_team_id
  for update;

  if v_team.id is null or v_team.status <> 'active' then
    raise exception 'Equipe não encontrada ou inativa.' using errcode = 'P0020';
  end if;

  if p_expected_version is not null and v_team.version <> p_expected_version then
    raise exception 'Versão esperada divergente da versão atual da equipe.' using errcode = 'P0020';
  end if;

  -- B2-03/B2-04: Revalidação estrita da autoridade do operador após espera por locks de linhas
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
    raise exception 'Apenas administradores ativos podem alterar a liderança da equipe.' using errcode = '42501';
  end if;

  insert into app_private.team_memberships as tm (church_id, team_id, member_id, status)
  values (p_church_id, p_team_id, p_new_leader_member_id, 'active')
  on conflict on constraint tm_church_team_member_unique do update set status = 'active', updated_at = clock_timestamp();

  update app_private.teams as t
  set leader_member_id = p_new_leader_member_id,
      version = t.version + 1,
      updated_at = clock_timestamp()
  where t.church_id = p_church_id and t.id = p_team_id
  returning t.updated_at into v_created_at;

  v_payload := jsonb_build_object(
    'team_id', p_team_id,
    'previous_leader_member_id', v_team.leader_member_id,
    'new_leader_member_id', p_new_leader_member_id,
    'version', v_team.version + 1
  );

  insert into app_private.audit_entries (
    church_id, action, actor_user_id, actor_source, maintenance_operator,
    target_type, target_id, details, occurred_at
  ) values (
    p_church_id, c_action, v_user_id, 'application', null,
    'team', p_team_id, v_payload, v_created_at
  );

  insert into app_private.command_receipts (
    church_id, user_id, command_id, action, params_hash,
    result_member_id, result_entity_id, result_payload, created_at
  ) values (
    p_church_id, v_user_id, p_command_id, c_action, v_params_hash,
    null, p_team_id, v_payload, v_created_at
  );

  return query
  select p_command_id, c_action, p_church_id, p_team_id, v_payload, v_created_at;
end;
$function$;

-- 2.3 create_team_role
create or replace function public.create_team_role(
  p_church_id uuid,
  p_command_id uuid,
  p_team_id uuid,
  p_name text,
  p_description text default null
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
  v_team record;
  v_name_clean text;
  v_desc_clean text;
  v_params_hash bytea;
  v_existing_receipt record;
  v_role_id uuid;
  v_payload jsonb;
  v_created_at timestamptz;
  c_action constant text := 'create_team_role';
begin
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if p_church_id is null or p_command_id is null or p_team_id is null or p_name is null then
    raise exception 'Parâmetros obrigatórios ausentes.' using errcode = '22004';
  end if;

  v_name_clean := btrim(normalize(p_name, NFC));
  if char_length(v_name_clean) < 1 or char_length(v_name_clean) > 100 then
    raise exception 'Nome de função deve ter entre 1 e 100 caracteres.' using errcode = '22000';
  end if;

  if p_description is not null then
    v_desc_clean := btrim(normalize(p_description, NFC));
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
    'team_id', p_team_id,
    'name', v_name_clean,
    'description', v_desc_clean
  )::text, 'UTF8'));

  select cr.command_id, cr.action, cr.church_id, cr.result_entity_id, cr.result_payload, cr.created_at, cr.params_hash
  into v_existing_receipt
  from app_private.command_receipts cr
  where cr.user_id = v_user_id
    and cr.command_id = p_command_id;

  if v_existing_receipt.command_id is not null then
    -- Revalida autoridade do chamador no replay
    if not coalesce(v_is_admin, false) and not exists (
      select 1 from app_private.teams as t
      where t.church_id = p_church_id and t.id = p_team_id and t.leader_member_id = v_caller_member_id and t.status = 'active'
    ) then
      raise exception 'Apenas o líder desta equipe ou administrador pode criar funções técnicas.' using errcode = '42501';
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

  select t.id, t.leader_member_id, t.status
  into v_team
  from app_private.teams as t
  where t.church_id = p_church_id and t.id = p_team_id
  for share;

  if v_team.id is null or v_team.status <> 'active' then
    raise exception 'Equipe não encontrada ou inativa.' using errcode = 'P0020';
  end if;

  -- B2-03/B2-04: Revalidação estrita da autoridade do operador após espera por lock
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

  -- B2-03: Checagem segura de liderança
  if not coalesce(v_is_admin, false) and (v_team.leader_member_id is null or v_team.leader_member_id <> v_caller_member_id) then
    raise exception 'Apenas o líder desta equipe ou administrador pode criar funções técnicas.' using errcode = '42501';
  end if;

  if exists (
    select 1 from app_private.team_roles as tr
    where tr.church_id = p_church_id and tr.team_id = p_team_id and tr.name = v_name_clean
  ) then
    raise exception 'Função técnica com este nome já existe nesta equipe.' using errcode = '23505';
  end if;

  insert into app_private.team_roles as tr (church_id, team_id, name, description, status)
  values (p_church_id, p_team_id, v_name_clean, v_desc_clean, 'active')
  returning tr.id, tr.created_at into v_role_id, v_created_at;

  v_payload := jsonb_build_object(
    'role_id', v_role_id,
    'team_id', p_team_id,
    'name', v_name_clean,
    'description', v_desc_clean,
    'status', 'active'
  );

  insert into app_private.audit_entries (
    church_id, action, actor_user_id, actor_source, maintenance_operator,
    target_type, target_id, details, occurred_at
  ) values (
    p_church_id, c_action, v_user_id, 'application', null,
    'team_role', v_role_id, v_payload, v_created_at
  );

  insert into app_private.command_receipts (
    church_id, user_id, command_id, action, params_hash,
    result_member_id, result_entity_id, result_payload, created_at
  ) values (
    p_church_id, v_user_id, p_command_id, c_action, v_params_hash,
    null, v_role_id, v_payload, v_created_at
  );

  return query
  select p_command_id, c_action, p_church_id, v_role_id, v_payload, v_created_at;
end;
$function$;

-- 2.4 add_team_member
create or replace function public.add_team_member(
  p_church_id uuid,
  p_command_id uuid,
  p_team_id uuid,
  p_member_id uuid
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
  v_team record;
  v_membership_id uuid;
  v_params_hash bytea;
  v_existing_receipt record;
  v_payload jsonb;
  v_created_at timestamptz;
  c_action constant text := 'add_team_member';
begin
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if p_church_id is null or p_command_id is null or p_team_id is null or p_member_id is null then
    raise exception 'Parâmetros obrigatórios ausentes.' using errcode = '22004';
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
    'team_id', p_team_id,
    'member_id', p_member_id
  )::text, 'UTF8'));

  select cr.command_id, cr.action, cr.church_id, cr.result_entity_id, cr.result_payload, cr.created_at, cr.params_hash
  into v_existing_receipt
  from app_private.command_receipts cr
  where cr.user_id = v_user_id
    and cr.command_id = p_command_id;

  if v_existing_receipt.command_id is not null then
    if not coalesce(v_is_admin, false) and not exists (
      select 1 from app_private.teams as t
      where t.church_id = p_church_id and t.id = p_team_id and t.leader_member_id = v_caller_member_id and t.status = 'active'
    ) then
      raise exception 'Apenas o líder desta equipe ou administrador pode adicionar membros.' using errcode = '42501';
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

  -- Bloqueio canônico do membro antes da equipe
  perform 1 from app_private.members as m
  where m.church_id = p_church_id and m.id = p_member_id and m.status = 'active'
  for update;

  if not found then
    raise exception 'Membro não encontrado ou inativo nesta igreja.' using errcode = 'P0020';
  end if;

  select t.id, t.leader_member_id, t.status
  into v_team
  from app_private.teams as t
  where t.church_id = p_church_id and t.id = p_team_id
  for share;

  if v_team.id is null or v_team.status <> 'active' then
    raise exception 'Equipe não encontrada ou inativa.' using errcode = 'P0020';
  end if;

  -- B2-03/B2-04: Revalidação estrita da autoridade do operador após espera por locks de linhas
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

  -- B2-03: Checagem segura de liderança
  if not coalesce(v_is_admin, false) and (v_team.leader_member_id is null or v_team.leader_member_id <> v_caller_member_id) then
    raise exception 'Apenas o líder desta equipe ou administrador pode adicionar membros.' using errcode = '42501';
  end if;

  insert into app_private.team_memberships as tm (church_id, team_id, member_id, status)
  values (p_church_id, p_team_id, p_member_id, 'active')
  on conflict on constraint tm_church_team_member_unique do update
  set status = 'active', updated_at = clock_timestamp()
  returning tm.id, tm.updated_at into v_membership_id, v_created_at;

  v_payload := jsonb_build_object(
    'membership_id', v_membership_id,
    'team_id', p_team_id,
    'member_id', p_member_id,
    'status', 'active'
  );

  insert into app_private.audit_entries (
    church_id, action, actor_user_id, actor_source, maintenance_operator,
    target_type, target_id, details, occurred_at
  ) values (
    p_church_id, c_action, v_user_id, 'application', null,
    'team_membership', v_membership_id, v_payload, v_created_at
  );

  insert into app_private.command_receipts (
    church_id, user_id, command_id, action, params_hash,
    result_member_id, result_entity_id, result_payload, created_at
  ) values (
    p_church_id, v_user_id, p_command_id, c_action, v_params_hash,
    null, v_membership_id, v_payload, v_created_at
  );

  return query
  select p_command_id, c_action, p_church_id, v_membership_id, v_payload, v_created_at;
end;
$function$;

-- 2.5 remove_team_member
create or replace function public.remove_team_member(
  p_church_id uuid,
  p_command_id uuid,
  p_team_id uuid,
  p_member_id uuid
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
volatile
security definer
set search_path = ''
set statement_timeout = '5s'
as $function$
declare
  v_user_id uuid;
  v_caller_member_id uuid;
  v_is_admin boolean;
  v_team record;
  v_membership record;
  v_params_hash bytea;
  v_existing_receipt record;
  v_payload jsonb;
  v_created_at timestamptz;
  c_action constant text := 'remove_team_member';
begin
  -- A revalidação exige visibilidade de commits ocorridos durante a espera.
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Contexto transacional não autorizado: utilize READ COMMITTED.' using errcode = '42501';
  end if;

  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if p_church_id is null or p_command_id is null or p_team_id is null or p_member_id is null then
    raise exception 'Parâmetros obrigatórios ausentes.' using errcode = '22004';
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
    'team_id', p_team_id,
    'member_id', p_member_id
  )::text, 'UTF8'));

  select cr.command_id, cr.action, cr.church_id, cr.result_entity_id, cr.result_payload, cr.created_at, cr.params_hash
  into v_existing_receipt
  from app_private.command_receipts cr
  where cr.user_id = v_user_id
    and cr.command_id = p_command_id;

  if v_existing_receipt.command_id is not null then
    if not coalesce(v_is_admin, false) and not exists (
      select 1 from app_private.teams as t
      where t.church_id = p_church_id and t.id = p_team_id and t.leader_member_id = v_caller_member_id and t.status = 'active'
    ) then
      raise exception 'Apenas o líder desta equipe ou administrador pode remover membros.' using errcode = '42501';
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

  -- Bloqueio canônico do membro antes da equipe
  perform 1 from app_private.members as m
  where m.church_id = p_church_id and m.id = p_member_id
  for update;

  select t.id, t.leader_member_id, t.status
  into v_team
  from app_private.teams as t
  where t.church_id = p_church_id and t.id = p_team_id
  for share;

  if v_team.id is null or v_team.status <> 'active' then
    raise exception 'Equipe não encontrada ou inativa.' using errcode = 'P0020';
  end if;

  select tm.id, tm.status
  into v_membership
  from app_private.team_memberships as tm
  where tm.church_id = p_church_id and tm.team_id = p_team_id and tm.member_id = p_member_id
  for update;

  if v_membership.id is null or v_membership.status <> 'active' then
    raise exception 'Membro não integra ativamente esta equipe.' using errcode = 'P0020';
  end if;

  -- A remoção também desativa aptidões; adquirir esses locks antes da decisão final.
  perform 1
  from app_private.member_qualifications as mq
  where mq.church_id = p_church_id and mq.team_id = p_team_id and mq.member_id = p_member_id and mq.status = 'active'
  order by mq.id
  for update;

  -- B2-03: Decisão final de autoridade após TODOS os locks explícitos deste caminho.
  -- Em READ COMMITTED, esta consulta VOLATILE vê revogações comitadas durante a espera.
  -- A autorização antecede os efeitos; replay continua validando o contexto atual no preâmbulo.
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

  -- B2-03: Checagem segura com NULL
  if not coalesce(v_is_admin, false) and (v_team.leader_member_id is null or v_team.leader_member_id <> v_caller_member_id) then
    raise exception 'Apenas o líder desta equipe ou administrador pode remover membros.' using errcode = '42501';
  end if;

  if v_team.leader_member_id is not null and v_team.leader_member_id = p_member_id then
    raise exception 'Membro lidera a equipe; transfira a liderança antes de removê-lo.' using errcode = 'P0020';
  end if;

  -- Verifica se membro possui alocações ativas em cultos futuros ou em andamento
  if exists (
    select 1
    from app_private.assignments as a
    join app_private.events as e on e.id = a.event_id and e.church_id = a.church_id
    where a.church_id = p_church_id
      and a.team_id = p_team_id
      and a.member_id = p_member_id
      and a.status = 'active'
      and e.status in ('scheduled', 'in_progress')
  ) then
    raise exception 'Membro possui escalas ativas nesta equipe; substitua ou cancele as escalas antes de removê-lo.' using errcode = 'P0020';
  end if;

  update app_private.team_memberships as tm
  set status = 'inactive', updated_at = clock_timestamp()
  where tm.id = v_membership.id
  returning tm.updated_at into v_created_at;

  update app_private.member_qualifications as mq
  set status = 'inactive', updated_at = clock_timestamp()
  where mq.church_id = p_church_id and mq.team_id = p_team_id and mq.member_id = p_member_id and mq.status = 'active';

  v_payload := jsonb_build_object(
    'membership_id', v_membership.id,
    'team_id', p_team_id,
    'member_id', p_member_id,
    'status', 'inactive'
  );

  insert into app_private.audit_entries (
    church_id, action, actor_user_id, actor_source, maintenance_operator,
    target_type, target_id, details, occurred_at
  ) values (
    p_church_id, c_action, v_user_id, 'application', null,
    'team_membership', v_membership.id, v_payload, v_created_at
  );

  insert into app_private.command_receipts (
    church_id, user_id, command_id, action, params_hash,
    result_member_id, result_entity_id, result_payload, created_at
  ) values (
    p_church_id, v_user_id, p_command_id, c_action, v_params_hash,
    null, v_membership.id, v_payload, v_created_at
  );

  return query
  select p_command_id, c_action, p_church_id, v_membership.id, v_payload, v_created_at;
end;
$function$;

-- 2.6 grant_member_qualification
create or replace function public.grant_member_qualification(
  p_church_id uuid,
  p_command_id uuid,
  p_member_id uuid,
  p_team_id uuid,
  p_team_role_id uuid
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
  v_team record;
  v_qual_id uuid;
  v_params_hash bytea;
  v_existing_receipt record;
  v_payload jsonb;
  v_created_at timestamptz;
  c_action constant text := 'grant_member_qualification';
begin
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if p_church_id is null or p_command_id is null or p_member_id is null or p_team_id is null or p_team_role_id is null then
    raise exception 'Parâmetros obrigatórios ausentes.' using errcode = '22004';
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
    'member_id', p_member_id,
    'team_id', p_team_id,
    'team_role_id', p_team_role_id
  )::text, 'UTF8'));

  select cr.command_id, cr.action, cr.church_id, cr.result_entity_id, cr.result_payload, cr.created_at, cr.params_hash
  into v_existing_receipt
  from app_private.command_receipts cr
  where cr.user_id = v_user_id
    and cr.command_id = p_command_id;

  if v_existing_receipt.command_id is not null then
    if not coalesce(v_is_admin, false) and not exists (
      select 1 from app_private.teams as t
      where t.church_id = p_church_id and t.id = p_team_id and t.leader_member_id = v_caller_member_id and t.status = 'active'
    ) then
      raise exception 'Apenas o líder desta equipe ou administrador pode homologar aptidões.' using errcode = '42501';
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

  -- Bloqueio canônico do membro antes da equipe
  perform 1 from app_private.members as m
  where m.church_id = p_church_id and m.id = p_member_id and m.status = 'active'
  for update;

  if not found then
    raise exception 'Membro não encontrado ou inativo nesta igreja.' using errcode = 'P0020';
  end if;

  select t.id, t.leader_member_id, t.status
  into v_team
  from app_private.teams as t
  where t.church_id = p_church_id and t.id = p_team_id
  for share;

  if v_team.id is null or v_team.status <> 'active' then
    raise exception 'Equipe não encontrada ou inativa.' using errcode = 'P0020';
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

  -- B2-03: Checagem segura de liderança
  if not coalesce(v_is_admin, false) and (v_team.leader_member_id is null or v_team.leader_member_id <> v_caller_member_id) then
    raise exception 'Apenas o líder desta equipe ou administrador pode homologar aptidões.' using errcode = '42501';
  end if;

  if not exists (
    select 1 from app_private.team_roles as tr
    where tr.church_id = p_church_id and tr.team_id = p_team_id and tr.id = p_team_role_id and tr.status = 'active'
  ) then
    raise exception 'Função técnica não encontrada ou inativa nesta equipe.' using errcode = 'P0020';
  end if;

  if not exists (
    select 1 from app_private.team_memberships as tm
    where tm.church_id = p_church_id and tm.team_id = p_team_id and tm.member_id = p_member_id and tm.status = 'active'
  ) then
    raise exception 'Membro deve integrar ativamente a equipe para receber homologação de aptidão.' using errcode = 'P0020';
  end if;

  insert into app_private.member_qualifications as mq (church_id, member_id, team_id, team_role_id, status)
  values (p_church_id, p_member_id, p_team_id, p_team_role_id, 'active')
  on conflict on constraint mq_church_member_role_unique do update
  set status = 'active', updated_at = clock_timestamp()
  returning mq.id, mq.updated_at into v_qual_id, v_created_at;

  v_payload := jsonb_build_object(
    'qualification_id', v_qual_id,
    'member_id', p_member_id,
    'team_id', p_team_id,
    'team_role_id', p_team_role_id,
    'status', 'active'
  );

  insert into app_private.audit_entries (
    church_id, action, actor_user_id, actor_source, maintenance_operator,
    target_type, target_id, details, occurred_at
  ) values (
    p_church_id, c_action, v_user_id, 'application', null,
    'member_qualification', v_qual_id, v_payload, v_created_at
  );

  insert into app_private.command_receipts (
    church_id, user_id, command_id, action, params_hash,
    result_member_id, result_entity_id, result_payload, created_at
  ) values (
    p_church_id, v_user_id, p_command_id, c_action, v_params_hash,
    null, v_qual_id, v_payload, v_created_at
  );

  return query
  select p_command_id, c_action, p_church_id, v_qual_id, v_payload, v_created_at;
end;
$function$;

-- 2.7 revoke_member_qualification
create or replace function public.revoke_member_qualification(
  p_church_id uuid,
  p_command_id uuid,
  p_member_id uuid,
  p_team_id uuid,
  p_team_role_id uuid
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
volatile
security definer
set search_path = ''
set statement_timeout = '5s'
as $function$
declare
  v_user_id uuid;
  v_caller_member_id uuid;
  v_is_admin boolean;
  v_team record;
  v_qual record;
  v_params_hash bytea;
  v_existing_receipt record;
  v_payload jsonb;
  v_created_at timestamptz;
  c_action constant text := 'revoke_member_qualification';
begin
  -- A revalidação exige visibilidade de commits ocorridos durante a espera.
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Contexto transacional não autorizado: utilize READ COMMITTED.' using errcode = '42501';
  end if;

  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if p_church_id is null or p_command_id is null or p_member_id is null or p_team_id is null or p_team_role_id is null then
    raise exception 'Parâmetros obrigatórios ausentes.' using errcode = '22004';
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
    'member_id', p_member_id,
    'team_id', p_team_id,
    'team_role_id', p_team_role_id
  )::text, 'UTF8'));

  select cr.command_id, cr.action, cr.church_id, cr.result_entity_id, cr.result_payload, cr.created_at, cr.params_hash
  into v_existing_receipt
  from app_private.command_receipts cr
  where cr.user_id = v_user_id
    and cr.command_id = p_command_id;

  if v_existing_receipt.command_id is not null then
    if not coalesce(v_is_admin, false) and not exists (
      select 1 from app_private.teams as t
      where t.church_id = p_church_id and t.id = p_team_id and t.leader_member_id = v_caller_member_id and t.status = 'active'
    ) then
      raise exception 'Apenas o líder desta equipe ou administrador pode revogar aptidões.' using errcode = '42501';
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

  -- Bloqueio canônico do membro antes da equipe
  perform 1 from app_private.members as m
  where m.church_id = p_church_id and m.id = p_member_id
  for update;

  select t.id, t.leader_member_id, t.status
  into v_team
  from app_private.teams as t
  where t.church_id = p_church_id and t.id = p_team_id
  for share;

  if v_team.id is null or v_team.status <> 'active' then
    raise exception 'Equipe não encontrada ou inativa.' using errcode = 'P0020';
  end if;

  select mq.id, mq.status
  into v_qual
  from app_private.member_qualifications as mq
  where mq.church_id = p_church_id and mq.team_id = p_team_id and mq.team_role_id = p_team_role_id and mq.member_id = p_member_id
  for update;

  if v_qual.id is null or v_qual.status <> 'active' then
    raise exception 'Aptidão não encontrada ou já inativa para este membro nesta equipe.' using errcode = 'P0020';
  end if;

  -- B2-03: Decisão final de autoridade após TODOS os locks explícitos deste caminho.
  -- Em READ COMMITTED, esta consulta VOLATILE vê revogações comitadas durante a espera.
  -- A autorização antecede os efeitos; replay continua validando o contexto atual no preâmbulo.
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

  -- B2-03: Checagem segura de liderança
  if not coalesce(v_is_admin, false) and (v_team.leader_member_id is null or v_team.leader_member_id <> v_caller_member_id) then
    raise exception 'Apenas o líder desta equipe ou administrador pode revogar aptidões.' using errcode = '42501';
  end if;

  -- Verifica se membro possui alocações ativas com esta função técnica
  if exists (
    select 1
    from app_private.assignments as a
    join app_private.events as e on e.id = a.event_id and e.church_id = a.church_id
    where a.church_id = p_church_id
      and a.team_id = p_team_id
      and a.team_role_id = p_team_role_id
      and a.member_id = p_member_id
      and a.status = 'active'
      and e.status in ('scheduled', 'in_progress')
  ) then
    raise exception 'Membro possui escalas ativas com esta função; substitua ou cancele as escalas antes de revogar a aptidão.' using errcode = 'P0020';
  end if;

  update app_private.member_qualifications as mq
  set status = 'inactive', updated_at = clock_timestamp()
  where mq.id = v_qual.id
  returning mq.updated_at into v_created_at;

  v_payload := jsonb_build_object(
    'qualification_id', v_qual.id,
    'member_id', p_member_id,
    'team_id', p_team_id,
    'team_role_id', p_team_role_id,
    'status', 'inactive'
  );

  insert into app_private.audit_entries (
    church_id, action, actor_user_id, actor_source, maintenance_operator,
    target_type, target_id, details, occurred_at
  ) values (
    p_church_id, c_action, v_user_id, 'application', null,
    'member_qualification', v_qual.id, v_payload, v_created_at
  );

  insert into app_private.command_receipts (
    church_id, user_id, command_id, action, params_hash,
    result_member_id, result_entity_id, result_payload, created_at
  ) values (
    p_church_id, v_user_id, p_command_id, c_action, v_params_hash,
    null, v_qual.id, v_payload, v_created_at
  );

  return query
  select p_command_id, c_action, p_church_id, v_qual.id, v_payload, v_created_at;
end;
$function$;


-- 2.8 create_church_event
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

-- 2.9 assign_event_liturgy_leader
create or replace function public.assign_event_liturgy_leader(
  p_church_id uuid,
  p_command_id uuid,
  p_event_id uuid,
  p_new_liturgy_leader_member_id uuid,
  p_expected_version integer default null
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
  v_params_hash bytea;
  v_existing_receipt record;
  v_payload jsonb;
  v_created_at timestamptz;
  c_action constant text := 'assign_event_liturgy_leader';
begin
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if p_church_id is null or p_command_id is null or p_event_id is null or p_new_liturgy_leader_member_id is null then
    raise exception 'Parâmetros obrigatórios ausentes.' using errcode = '22004';
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

  -- Designação litúrgica exclusiva de administradores
  if v_caller_member_id is null or not coalesce(v_is_admin, false) then
    raise exception 'Apenas administradores ativos podem designar a liderança da liturgia.' using errcode = '42501';
  end if;

  v_params_hash := pg_catalog.sha256(convert_to(jsonb_build_object(
    'action', c_action,
    'church_id', p_church_id,
    'event_id', p_event_id,
    'new_liturgy_leader_member_id', p_new_liturgy_leader_member_id,
    'expected_version', p_expected_version
  )::text, 'UTF8'));

  select cr.command_id, cr.action, cr.church_id, cr.result_entity_id, cr.result_payload, cr.created_at, cr.params_hash
  into v_existing_receipt
  from app_private.command_receipts cr
  where cr.user_id = v_user_id
    and cr.command_id = p_command_id;

  if v_existing_receipt.command_id is not null then
    if not coalesce(v_is_admin, false) then
      raise exception 'Apenas administradores ativos podem designar a liderança da liturgia.' using errcode = '42501';
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

  -- Bloqueio canônico do novo líder de liturgia
  perform 1 from app_private.members as m
  where m.church_id = p_church_id and m.id = p_new_liturgy_leader_member_id and m.status = 'active'
  for share;

  if not found then
    raise exception 'Novo líder de liturgia não encontrado ou inativo nesta igreja.' using errcode = 'P0020';
  end if;

  -- Bloqueio do evento
  select e.id, e.liturgy_leader_member_id, e.version, e.status
  into v_event
  from app_private.events as e
  where e.church_id = p_church_id and e.id = p_event_id
  for update;

  if v_event.id is null then
    raise exception 'Evento não encontrado nesta igreja.' using errcode = 'P0020';
  end if;

  if v_event.status in ('completed', 'cancelled') then
    raise exception 'Não é possível alterar a liturgia de um evento finalizado ou cancelado.' using errcode = 'P0020';
  end if;

  if p_expected_version is not null and v_event.version <> p_expected_version then
    raise exception 'Versão esperada divergente da versão atual do evento.' using errcode = 'P0020';
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

  if v_caller_member_id is null or not coalesce(v_is_admin, false) then
    raise exception 'Apenas administradores ativos podem designar a liderança da liturgia.' using errcode = '42501';
  end if;

  update app_private.events as e
  set liturgy_leader_member_id = p_new_liturgy_leader_member_id,
      version = e.version + 1,
      updated_at = clock_timestamp()
  where e.church_id = p_church_id and e.id = p_event_id
  returning e.updated_at into v_created_at;

  v_payload := jsonb_build_object(
    'event_id', p_event_id,
    'previous_liturgy_leader_member_id', v_event.liturgy_leader_member_id,
    'new_liturgy_leader_member_id', p_new_liturgy_leader_member_id,
    'version', v_event.version + 1
  );

  insert into app_private.audit_entries (
    church_id, action, actor_user_id, actor_source, maintenance_operator,
    target_type, target_id, details, occurred_at
  ) values (
    p_church_id, c_action, v_user_id, 'application', null,
    'event', p_event_id, v_payload, v_created_at
  );

  insert into app_private.command_receipts (
    church_id, user_id, command_id, action, params_hash,
    result_member_id, result_entity_id, result_payload, created_at
  ) values (
    p_church_id, v_user_id, p_command_id, c_action, v_params_hash,
    null, p_event_id, v_payload, v_created_at
  );

  return query
  select p_command_id, c_action, p_church_id, p_event_id, v_payload, v_created_at;
end;
$function$;

-- 2.10 start_event_service (Restrito estritamente à liderança de liturgia designada - B2-03)
create or replace function public.start_event_service(
  p_church_id uuid,
  p_command_id uuid,
  p_event_id uuid,
  p_expected_version integer default null
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
  v_params_hash bytea;
  v_existing_receipt record;
  v_payload jsonb;
  v_created_at timestamptz;
  c_action constant text := 'start_event_service';
begin
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if p_church_id is null or p_command_id is null or p_event_id is null then
    raise exception 'Parâmetros obrigatórios ausentes.' using errcode = '22004';
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
    'expected_version', p_expected_version
  )::text, 'UTF8'));

  select cr.command_id, cr.action, cr.church_id, cr.result_entity_id, cr.result_payload, cr.created_at, cr.params_hash
  into v_existing_receipt
  from app_private.command_receipts cr
  where cr.user_id = v_user_id
    and cr.command_id = p_command_id;

  if v_existing_receipt.command_id is not null then
    if not exists (
      select 1 from app_private.events as e
      where e.church_id = p_church_id and e.id = p_event_id and e.liturgy_leader_member_id = v_caller_member_id
    ) then
      raise exception 'Apenas o líder de liturgia designado pode iniciar o culto.' using errcode = '42501';
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

  select e.id, e.liturgy_leader_member_id, e.status, e.version
  into v_event
  from app_private.events as e
  where e.church_id = p_church_id and e.id = p_event_id
  for update;

  if v_event.id is null then
    raise exception 'Evento não encontrado nesta igreja.' using errcode = 'P0020';
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

  -- B2-03: Condução exclusiva da liturgia designada (PRD 101-111/184)
  if v_event.liturgy_leader_member_id is null or v_event.liturgy_leader_member_id <> v_caller_member_id then
    raise exception 'Apenas o líder de liturgia designado pode iniciar o culto.' using errcode = '42501';
  end if;

  if v_event.status <> 'scheduled' then
    raise exception 'Apenas eventos em estado agendado podem ser iniciados.' using errcode = 'P0020';
  end if;

  if p_expected_version is not null and v_event.version <> p_expected_version then
    raise exception 'Versão esperada divergente da versão atual do evento.' using errcode = 'P0020';
  end if;

  update app_private.events as e
  set status = 'in_progress',
      actual_start_at = clock_timestamp(),
      version = e.version + 1,
      updated_at = clock_timestamp()
  where e.church_id = p_church_id and e.id = p_event_id
  returning e.updated_at into v_created_at;

  v_payload := jsonb_build_object(
    'event_id', p_event_id,
    'status', 'in_progress',
    'actual_start_at', v_created_at,
    'version', v_event.version + 1
  );

  insert into app_private.audit_entries (
    church_id, action, actor_user_id, actor_source, maintenance_operator,
    target_type, target_id, details, occurred_at
  ) values (
    p_church_id, c_action, v_user_id, 'application', null,
    'event', p_event_id, v_payload, v_created_at
  );

  insert into app_private.command_receipts (
    church_id, user_id, command_id, action, params_hash,
    result_member_id, result_entity_id, result_payload, created_at
  ) values (
    p_church_id, v_user_id, p_command_id, c_action, v_params_hash,
    null, p_event_id, v_payload, v_created_at
  );

  return query
  select p_command_id, c_action, p_church_id, p_event_id, v_payload, v_created_at;
end;
$function$;

-- 2.11 finish_event_service (Restrito estritamente à liderança de liturgia designada - B2-03)
create or replace function public.finish_event_service(
  p_church_id uuid,
  p_command_id uuid,
  p_event_id uuid,
  p_expected_version integer default null
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
  v_params_hash bytea;
  v_existing_receipt record;
  v_payload jsonb;
  v_created_at timestamptz;
  c_action constant text := 'finish_event_service';
begin
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if p_church_id is null or p_command_id is null or p_event_id is null then
    raise exception 'Parâmetros obrigatórios ausentes.' using errcode = '22004';
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
    'expected_version', p_expected_version
  )::text, 'UTF8'));

  select cr.command_id, cr.action, cr.church_id, cr.result_entity_id, cr.result_payload, cr.created_at, cr.params_hash
  into v_existing_receipt
  from app_private.command_receipts cr
  where cr.user_id = v_user_id
    and cr.command_id = p_command_id;

  if v_existing_receipt.command_id is not null then
    if not exists (
      select 1 from app_private.events as e
      where e.church_id = p_church_id and e.id = p_event_id and e.liturgy_leader_member_id = v_caller_member_id
    ) then
      raise exception 'Apenas o líder de liturgia designado pode finalizar o culto.' using errcode = '42501';
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

  select e.id, e.liturgy_leader_member_id, e.status, e.version
  into v_event
  from app_private.events as e
  where e.church_id = p_church_id and e.id = p_event_id
  for update;

  if v_event.id is null then
    raise exception 'Evento não encontrado nesta igreja.' using errcode = 'P0020';
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

  -- B2-03: Condução exclusiva da liturgia designada (PRD 101-111/184)
  if v_event.liturgy_leader_member_id is null or v_event.liturgy_leader_member_id <> v_caller_member_id then
    raise exception 'Apenas o líder de liturgia designado pode finalizar o culto.' using errcode = '42501';
  end if;

  if v_event.status <> 'in_progress' then
    raise exception 'Apenas eventos em andamento podem ser finalizados.' using errcode = 'P0020';
  end if;

  if p_expected_version is not null and v_event.version <> p_expected_version then
    raise exception 'Versão esperada divergente da versão atual do evento.' using errcode = 'P0020';
  end if;

  update app_private.events as e
  set status = 'completed',
      actual_end_at = clock_timestamp(),
      version = e.version + 1,
      updated_at = clock_timestamp()
  where e.church_id = p_church_id and e.id = p_event_id
  returning e.updated_at into v_created_at;

  update app_private.event_items as ei
  set status = 'completed', actual_end_at = coalesce(ei.actual_end_at, clock_timestamp()), updated_at = clock_timestamp()
  where ei.church_id = p_church_id and ei.event_id = p_event_id and ei.status in ('pending', 'in_progress');

  v_payload := jsonb_build_object(
    'event_id', p_event_id,
    'status', 'completed',
    'actual_end_at', v_created_at,
    'version', v_event.version + 1
  );

  insert into app_private.audit_entries (
    church_id, action, actor_user_id, actor_source, maintenance_operator,
    target_type, target_id, details, occurred_at
  ) values (
    p_church_id, c_action, v_user_id, 'application', null,
    'event', p_event_id, v_payload, v_created_at
  );

  insert into app_private.command_receipts (
    church_id, user_id, command_id, action, params_hash,
    result_member_id, result_entity_id, result_payload, created_at
  ) values (
    p_church_id, v_user_id, p_command_id, c_action, v_params_hash,
    null, p_event_id, v_payload, v_created_at
  );

  return query
  select p_command_id, c_action, p_church_id, p_event_id, v_payload, v_created_at;
end;
$function$;

-- 2.12 cancel_church_event
create or replace function public.cancel_church_event(
  p_church_id uuid,
  p_command_id uuid,
  p_event_id uuid,
  p_cancel_reason text,
  p_expected_version integer default null
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
  v_reason_clean text;
  v_params_hash bytea;
  v_existing_receipt record;
  v_payload jsonb;
  v_created_at timestamptz;
  c_action constant text := 'cancel_church_event';
begin
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if p_church_id is null or p_command_id is null or p_event_id is null or p_cancel_reason is null then
    raise exception 'Parâmetros obrigatórios ausentes.' using errcode = '22004';
  end if;

  v_reason_clean := btrim(normalize(p_cancel_reason, NFC));
  if char_length(v_reason_clean) < 1 then
    raise exception 'Motivo de cancelamento obrigatório.' using errcode = '22000';
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
    'cancel_reason', v_reason_clean,
    'expected_version', p_expected_version
  )::text, 'UTF8'));

  select cr.command_id, cr.action, cr.church_id, cr.result_entity_id, cr.result_payload, cr.created_at, cr.params_hash
  into v_existing_receipt
  from app_private.command_receipts cr
  where cr.user_id = v_user_id
    and cr.command_id = p_command_id;

  if v_existing_receipt.command_id is not null then
    if not coalesce(v_is_admin, false) and not exists (
      select 1 from app_private.events as e
      where e.church_id = p_church_id and e.id = p_event_id and e.liturgy_leader_member_id = v_caller_member_id
    ) then
      raise exception 'Apenas o líder de liturgia designado ou administrador pode cancelar o evento.' using errcode = '42501';
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

  select e.id, e.liturgy_leader_member_id, e.status, e.version
  into v_event
  from app_private.events as e
  where e.church_id = p_church_id and e.id = p_event_id
  for update;

  if v_event.id is null then
    raise exception 'Evento não encontrado nesta igreja.' using errcode = 'P0020';
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

  -- B2-03: Checagem segura de autoridade (Admin ou Líder de Liturgia designado)
  if not coalesce(v_is_admin, false) and (v_event.liturgy_leader_member_id is null or v_event.liturgy_leader_member_id <> v_caller_member_id) then
    raise exception 'Apenas o líder de liturgia designado ou administrador pode cancelar o evento.' using errcode = '42501';
  end if;

  if v_event.status in ('completed', 'cancelled') then
    raise exception 'Evento já finalizado ou previamente cancelado.' using errcode = 'P0020';
  end if;

  if p_expected_version is not null and v_event.version <> p_expected_version then
    raise exception 'Versão esperada divergente da versão atual do evento.' using errcode = 'P0020';
  end if;

  update app_private.events as e
  set status = 'cancelled',
      cancel_reason = v_reason_clean,
      version = e.version + 1,
      updated_at = clock_timestamp()
  where e.church_id = p_church_id and e.id = p_event_id
  returning e.updated_at into v_created_at;

  update app_private.event_items as ei
  set status = 'cancelled', cancel_reason = v_reason_clean, updated_at = clock_timestamp()
  where ei.church_id = p_church_id and ei.event_id = p_event_id and ei.status in ('pending', 'in_progress');

  update app_private.assignments as a
  set status = 'cancelled', updated_at = clock_timestamp()
  where a.church_id = p_church_id and a.event_id = p_event_id and a.status = 'active';

  v_payload := jsonb_build_object(
    'event_id', p_event_id,
    'status', 'cancelled',
    'cancel_reason', v_reason_clean,
    'version', v_event.version + 1
  );

  insert into app_private.audit_entries (
    church_id, action, actor_user_id, actor_source, maintenance_operator,
    target_type, target_id, details, occurred_at
  ) values (
    p_church_id, c_action, v_user_id, 'application', null,
    'event', p_event_id, v_payload, v_created_at
  );

  insert into app_private.command_receipts (
    church_id, user_id, command_id, action, params_hash,
    result_member_id, result_entity_id, result_payload, created_at
  ) values (
    p_church_id, v_user_id, p_command_id, c_action, v_params_hash,
    null, p_event_id, v_payload, v_created_at
  );

  return query
  select p_command_id, c_action, p_church_id, p_event_id, v_payload, v_created_at;
end;
$function$;


-- 2.13 create_event_item (Fonte real de itens de culto e responsabilidade nominal - B2-02)
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

-- 2.14 assign_event_participant (Ordem Canônica Estrita de Locks e Fronteira de Realocação - B2-03/B2-04)
create or replace function public.assign_event_participant(
  p_church_id uuid,
  p_command_id uuid,
  p_event_id uuid,
  p_team_id uuid,
  p_member_id uuid,
  p_item_id uuid default null,
  p_team_role_id uuid default null,
  p_notes text default null
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
volatile
security definer
set search_path = ''
set statement_timeout = '5s'
as $function$
declare
  v_user_id uuid;
  v_caller_member_id uuid;
  v_is_admin boolean;
  v_member record;
  v_team record;
  v_event record;
  v_item record;
  v_notes_clean text;
  v_params_hash bytea;
  v_existing_receipt record;
  v_asg_id uuid;
  v_payload jsonb;
  v_created_at timestamptz;
  c_action constant text := 'assign_event_participant';
begin
  -- A revalidação exige visibilidade de commits ocorridos durante a espera.
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Contexto transacional não autorizado: utilize READ COMMITTED.' using errcode = '42501';
  end if;

  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if p_church_id is null or p_command_id is null or p_event_id is null or p_team_id is null or p_member_id is null then
    raise exception 'Parâmetros obrigatórios ausentes.' using errcode = '22004';
  end if;

  if p_notes is not null then
    v_notes_clean := btrim(normalize(p_notes, NFC));
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
    'team_id', p_team_id,
    'member_id', p_member_id,
    'item_id', p_item_id,
    'team_role_id', p_team_role_id,
    'notes', v_notes_clean
  )::text, 'UTF8'));

  select cr.command_id, cr.action, cr.church_id, cr.result_entity_id, cr.result_payload, cr.created_at, cr.params_hash
  into v_existing_receipt
  from app_private.command_receipts cr
  where cr.user_id = v_user_id
    and cr.command_id = p_command_id;

  if v_existing_receipt.command_id is not null then
    if not coalesce(v_is_admin, false) and not exists (
      select 1 from app_private.teams as t
      where t.church_id = p_church_id and t.id = p_team_id and t.leader_member_id = v_caller_member_id
    ) and not exists (
      select 1 from app_private.events as e
      where e.church_id = p_church_id and e.id = p_event_id and e.liturgy_leader_member_id = v_caller_member_id
    ) then
      raise exception 'Apenas o líder desta equipe, o líder de liturgia ou administrador podem alocar participantes.' using errcode = '42501';
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

  -- Ordem canônica rigorosa de aquisição de locks (B2-04):
  -- members (FOR UPDATE) -> teams (FOR SHARE) -> events (FOR SHARE) -> event_items (FOR SHARE) -> team_memberships -> member_qualifications

  -- 1) Bloqueia o membro candidato FOR UPDATE para serializar concorrentes com o mesmo membro
  select m.id, m.status
  into v_member
  from app_private.members as m
  where m.church_id = p_church_id and m.id = p_member_id
  for update;

  if v_member.id is null or v_member.status <> 'active' then
    raise exception 'Membro não encontrado ou inativo nesta igreja.' using errcode = 'P0020';
  end if;

  -- 2) Bloqueia a equipe
  select t.id, t.leader_member_id, t.status
  into v_team
  from app_private.teams as t
  where t.church_id = p_church_id and t.id = p_team_id
  for share;

  if v_team.id is null or v_team.status <> 'active' then
    raise exception 'Equipe não encontrada ou inativa nesta igreja.' using errcode = 'P0020';
  end if;

  -- 3) Bloqueia o evento
  select e.id, e.status, e.planned_start_at, e.planned_end_at, e.liturgy_leader_member_id
  into v_event
  from app_private.events as e
  where e.church_id = p_church_id and e.id = p_event_id
  for share;

  if v_event.id is null then
    raise exception 'Evento não encontrado nesta igreja.' using errcode = 'P0020';
  end if;

  if v_event.status not in ('scheduled', 'in_progress') then
    raise exception 'Não é possível alocar participantes em eventos finalizados ou cancelados.' using errcode = 'P0020';
  end if;

  -- 4) Bloqueia o item do cronograma se aplicável
  if p_item_id is not null then
    select ei.id, ei.status, ei.item_nature, ei.sequence_order
    into v_item
    from app_private.event_items as ei
    where ei.church_id = p_church_id and ei.event_id = p_event_id and ei.id = p_item_id
    for share;

    if v_item.id is null or v_item.status not in ('pending', 'in_progress') then
      raise exception 'Item do cronograma não pertence a este evento ou já foi finalizado/cancelado.' using errcode = 'P0020';
    end if;
  end if;

  -- 6) Bloqueia e verifica vínculo ativo na equipe
  if not exists (
    select 1
    from app_private.team_memberships as tm
    where tm.church_id = p_church_id and tm.team_id = p_team_id and tm.member_id = p_member_id and tm.status = 'active'
    for share
  ) then
    raise exception 'Membro não integra ativamente esta equipe.' using errcode = 'P0020';
  end if;

  -- 7) Bloqueia e verifica função e aptidão homologada
  if p_team_role_id is not null then
    if not exists (
      select 1
      from app_private.team_roles as tr
      where tr.church_id = p_church_id and tr.team_id = p_team_id and tr.id = p_team_role_id and tr.status = 'active'
      for share
    ) then
      raise exception 'Função técnica não pertence a esta equipe ou está inativa.' using errcode = 'P0020';
    end if;

    if not exists (
      select 1
      from app_private.member_qualifications as mq
      where mq.church_id = p_church_id and mq.team_id = p_team_id and mq.team_role_id = p_team_role_id
        and mq.member_id = p_member_id and mq.status = 'active'
      for share
    ) then
      raise exception 'Membro não possui aptidão ativa homologada para esta função.' using errcode = 'P0020';
    end if;
  end if;

  -- B2-03: Decisão final de autoridade após TODOS os locks explícitos deste caminho.
  -- Em READ COMMITTED, esta consulta VOLATILE vê revogações comitadas durante a espera.
  -- A autorização antecede os efeitos; replay continua validando o contexto atual no preâmbulo.
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

  -- 5) Fronteira de permissão (B2-03):
  -- Para atividades principais de itens litúrgicos: líder da equipe realoca enquanto o item não começou (status = 'pending').
  -- Após o início do item (in_progress), somente o líder de liturgia designado pode alterar.
  -- Para apoios paralelos ou alocações gerais do culto (sem item específico): usa-se o início real do culto.
  if p_item_id is not null and v_item.item_nature = 'liturgical' then
    if v_item.status = 'pending' then
      if not coalesce(v_is_admin, false) and (v_team.leader_member_id is null or v_team.leader_member_id <> v_caller_member_id) then
        raise exception 'Apenas o líder desta equipe ou administrador pode alocar participantes antes do início do item.' using errcode = '42501';
      end if;
    elsif v_item.status = 'in_progress' then
      if v_event.liturgy_leader_member_id is null or v_event.liturgy_leader_member_id <> v_caller_member_id then
        raise exception 'Durante a execução deste item litúrgico, apenas o líder de liturgia designado pode realizar alocações.' using errcode = '42501';
      end if;
    else
      raise exception 'Item do cronograma não permite alterações no estado atual.' using errcode = 'P0020';
    end if;
  else
    if v_event.status = 'scheduled' then
      if not coalesce(v_is_admin, false) and (v_team.leader_member_id is null or v_team.leader_member_id <> v_caller_member_id) then
        raise exception 'Apenas o líder desta equipe ou administrador pode alocar voluntários antes do culto.' using errcode = '42501';
      end if;
    elsif v_event.status = 'in_progress' then
      if v_event.liturgy_leader_member_id is null or v_event.liturgy_leader_member_id <> v_caller_member_id then
        raise exception 'Durante a execução do culto, apenas o líder de liturgia designado pode realizar alocações.' using errcode = '42501';
      end if;
    else
      raise exception 'Evento não permite alterações no estado atual.' using errcode = 'P0020';
    end if;
  end if;

  -- 8) Checagens de conflito (B2-04 / PRD 160):
  -- Conflito no mesmo evento: mesmo escopo OU item simultâneo diferente (mesma sequência ou ambos em andamento)
  if exists (
    select 1
    from app_private.assignments as a
    left join app_private.event_items as ei on ei.id = a.item_id and ei.church_id = a.church_id and ei.event_id = a.event_id
    where a.church_id = p_church_id
      and a.event_id = p_event_id
      and a.member_id = p_member_id
      and a.status = 'active'
      and (
        (a.item_id is not distinct from p_item_id)
        or (
          p_item_id is not null
          and a.item_id is not null
          and a.item_id <> p_item_id
          and (
            ei.sequence_order = v_item.sequence_order
            or (ei.status = 'in_progress' and v_item.status = 'in_progress')
          )
        )
      )
  ) then
    raise exception 'Membro já possui alocação ativa neste escopo ou em item simultâneo.' using errcode = 'P0020';
  end if;

  -- Conflito com outro evento sobreposto no mesmo horário (PRD 160)
  if exists (
    select 1
    from app_private.assignments as a2
    join app_private.events as e2 on e2.id = a2.event_id and e2.church_id = a2.church_id
    where a2.church_id = p_church_id
      and a2.member_id = p_member_id
      and a2.status = 'active'
      and e2.status in ('scheduled', 'in_progress')
      and e2.id <> p_event_id
      and (e2.planned_start_at < v_event.planned_end_at and e2.planned_end_at > v_event.planned_start_at)
  ) then
    raise exception 'Membro possui conflito de escala com outro evento sobreposto.' using errcode = 'P0020';
  end if;

  -- Inserção qualificada
  insert into app_private.assignments as a (
    church_id, event_id, item_id, team_id, team_role_id, member_id, status, notes
  ) values (
    p_church_id, p_event_id, p_item_id, p_team_id, p_team_role_id, p_member_id, 'active', v_notes_clean
  )
  returning a.id, a.created_at into v_asg_id, v_created_at;

  v_payload := jsonb_build_object(
    'assignment_id', v_asg_id,
    'event_id', p_event_id,
    'item_id', p_item_id,
    'team_id', p_team_id,
    'team_role_id', p_team_role_id,
    'member_id', p_member_id,
    'status', 'active',
    'notes', v_notes_clean
  );

  insert into app_private.audit_entries (
    church_id, action, actor_user_id, actor_source, maintenance_operator,
    target_type, target_id, details, occurred_at
  ) values (
    p_church_id, c_action, v_user_id, 'application', null,
    'assignment', v_asg_id, v_payload, v_created_at
  );

  insert into app_private.command_receipts (
    church_id, user_id, command_id, action, params_hash,
    result_member_id, result_entity_id, result_payload, created_at
  ) values (
    p_church_id, v_user_id, p_command_id, c_action, v_params_hash,
    null, v_asg_id, v_payload, v_created_at
  );

  return query
  select p_command_id, c_action, p_church_id, v_asg_id, v_payload, v_created_at;
end;
$function$;

-- 2.15 replace_event_participant (Ordem Canônica Estrita de Locks e UPDATE Condicional - B2-04)
create or replace function public.replace_event_participant(
  p_church_id uuid,
  p_command_id uuid,
  p_assignment_id uuid,
  p_replacement_member_id uuid,
  p_reason text,
  p_notes text default null
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
volatile
security definer
set search_path = ''
set statement_timeout = '5s'
as $function$
declare
  v_user_id uuid;
  v_caller_member_id uuid;
  v_is_admin boolean;
  v_orig_member_id uuid;
  v_team_id uuid;
  v_event_id uuid;
  v_item_id uuid;
  v_role_id uuid;
  v_orig_status text;
  v_event record;
  v_team record;
  v_item record;
  v_current_asg_status text;
  v_rows_updated integer;
  v_reason_clean text;
  v_notes_clean text;
  v_params_hash bytea;
  v_existing_receipt record;
  v_new_asg_id uuid;
  v_payload jsonb;
  v_created_at timestamptz;
  c_action constant text := 'replace_event_participant';
begin
  -- A revalidação exige visibilidade de commits ocorridos durante a espera.
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Contexto transacional não autorizado: utilize READ COMMITTED.' using errcode = '42501';
  end if;

  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if p_church_id is null or p_command_id is null or p_assignment_id is null or p_replacement_member_id is null or p_reason is null then
    raise exception 'Parâmetros obrigatórios ausentes.' using errcode = '22004';
  end if;

  v_reason_clean := btrim(normalize(p_reason, NFC));
  if char_length(v_reason_clean) < 1 then
    raise exception 'Motivo de substituição obrigatório.' using errcode = '22000';
  end if;

  if p_notes is not null then
    v_notes_clean := btrim(normalize(p_notes, NFC));
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
    'assignment_id', p_assignment_id,
    'replacement_member_id', p_replacement_member_id,
    'reason', v_reason_clean,
    'notes', v_notes_clean
  )::text, 'UTF8'));

  select cr.command_id, cr.action, cr.church_id, cr.result_entity_id, cr.result_payload, cr.created_at, cr.params_hash
  into v_existing_receipt
  from app_private.command_receipts cr
  where cr.user_id = v_user_id
    and cr.command_id = p_command_id;

  if v_existing_receipt.command_id is not null then
    if not coalesce(v_is_admin, false) and not exists (
      select 1 from app_private.assignments as a
      join app_private.teams as t on t.id = a.team_id and t.church_id = a.church_id
      join app_private.events as e on e.id = a.event_id and e.church_id = a.church_id
      where a.id = p_assignment_id and a.church_id = p_church_id
        and (t.leader_member_id = v_caller_member_id or e.liturgy_leader_member_id = v_caller_member_id)
    ) then
      raise exception 'Apenas o líder desta equipe, o líder de liturgia ou administrador podem substituir participantes.' using errcode = '42501';
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

  -- 1) Descoberta sem locks (B2-04)
  select a.member_id, a.team_id, a.event_id, a.item_id, a.team_role_id, a.status
  into v_orig_member_id, v_team_id, v_event_id, v_item_id, v_role_id, v_orig_status
  from app_private.assignments as a
  where a.id = p_assignment_id and a.church_id = p_church_id;

  if v_orig_member_id is null then
    raise exception 'Alocação não encontrada nesta igreja.' using errcode = 'P0020';
  end if;

  if v_orig_status <> 'active' then
    raise exception 'Alocação já substituída ou inativa.' using errcode = 'P0020';
  end if;

  if v_orig_member_id = p_replacement_member_id then
    raise exception 'Membro substituto deve ser diferente do membro original.' using errcode = '22000';
  end if;

  -- 2) Ordem canônica rigorosa de aquisição de locks entre tabelas (B2-04):
  -- members (ordenados por id FOR UPDATE) -> teams -> events -> event_items -> team_memberships -> member_qualifications -> assignments

  -- Nível 1: Bloqueia members envolvidos em ordem ascendente de UUID FOR UPDATE
  perform 1
  from app_private.members as m
  where m.church_id = p_church_id
    and m.id in (v_orig_member_id, p_replacement_member_id)
  order by m.id asc
  for update;

  if not exists (
    select 1 from app_private.members as m
    where m.church_id = p_church_id and m.id = p_replacement_member_id and m.status = 'active'
  ) then
    raise exception 'Membro substituto não encontrado ou inativo nesta igreja.' using errcode = 'P0020';
  end if;

  -- Nível 2: Bloqueia team
  select t.id, t.leader_member_id, t.status
  into v_team
  from app_private.teams as t
  where t.church_id = p_church_id and t.id = v_team_id
  for share;

  if v_team.id is null or v_team.status <> 'active' then
    raise exception 'Equipe da alocação não encontrada ou inativa.' using errcode = 'P0020';
  end if;

  -- Nível 3: Bloqueia event
  select e.id, e.status, e.planned_start_at, e.planned_end_at, e.liturgy_leader_member_id
  into v_event
  from app_private.events as e
  where e.church_id = p_church_id and e.id = v_event_id
  for update;

  if v_event.id is null or v_event.status not in ('scheduled', 'in_progress') then
    raise exception 'Evento não permite alterações no estado atual.' using errcode = 'P0020';
  end if;

  -- Nível 4: Bloqueia event_item se aplicável
  if v_item_id is not null then
    select ei.id, ei.status, ei.item_nature, ei.sequence_order
    into v_item
    from app_private.event_items as ei
    where ei.church_id = p_church_id and ei.event_id = v_event_id and ei.id = v_item_id
    for update;

    if v_item.id is null or v_item.status not in ('pending', 'in_progress') then
      raise exception 'Item do cronograma não permite alterações no estado atual.' using errcode = 'P0020';
    end if;
  end if;

  -- Nível 5: Bloqueia vínculo de equipe do substituto
  if not exists (
    select 1
    from app_private.team_memberships as tm
    where tm.church_id = p_church_id
      and tm.team_id = v_team_id
      and tm.member_id = p_replacement_member_id
      and tm.status = 'active'
    for share
  ) then
    raise exception 'Membro substituto não integra ativamente esta equipe.' using errcode = 'P0020';
  end if;

  -- Nível 6: Bloqueia aptidão do substituto se função especificada
  if v_role_id is not null then
    if not exists (
      select 1
      from app_private.member_qualifications as mq
      where mq.church_id = p_church_id
        and mq.team_id = v_team_id
        and mq.team_role_id = v_role_id
        and mq.member_id = p_replacement_member_id
        and mq.status = 'active'
      for share
    ) then
      raise exception 'Membro substituto não possui aptidão ativa homologada para esta função.' using errcode = 'P0020';
    end if;
  end if;

  -- Nível 7: Bloqueia alocação original para atualização
  select a.status
  into v_current_asg_status
  from app_private.assignments as a
  where a.church_id = p_church_id and a.id = p_assignment_id
  for update;

  if v_current_asg_status <> 'active' then
    raise exception 'Alocação já substituída ou inativa por outra transação.' using errcode = 'P0020';
  end if;

  -- B2-03: Decisão final de autoridade após TODOS os locks explícitos deste caminho.
  -- Em READ COMMITTED, esta consulta VOLATILE vê revogações comitadas durante a espera.
  -- A autorização antecede os efeitos; replay continua validando o contexto atual no preâmbulo.
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

  -- Fronteira de permissão (B2-03):
  -- Para atividades principais de itens litúrgicos: líder da equipe realoca enquanto o item não começou (status = 'pending').
  -- Após o início do item (in_progress), somente o líder de liturgia designado pode alterar.
  -- Para apoios paralelos ou alocações gerais do culto (sem item específico): usa-se o início real do culto.
  if v_item_id is not null and v_item.item_nature = 'liturgical' then
    if v_item.status = 'pending' then
      if not coalesce(v_is_admin, false) and (v_team.leader_member_id is null or v_team.leader_member_id <> v_caller_member_id) then
        raise exception 'Apenas o líder desta equipe ou administrador pode substituir participantes antes do início do item.' using errcode = '42501';
      end if;
    elsif v_item.status = 'in_progress' then
      if v_event.liturgy_leader_member_id is null or v_event.liturgy_leader_member_id <> v_caller_member_id then
        raise exception 'Durante a execução deste item litúrgico, apenas o líder de liturgia designado pode realizar substituições.' using errcode = '42501';
      end if;
    else
      raise exception 'Item do cronograma não permite alterações no estado atual.' using errcode = 'P0020';
    end if;
  else
    if v_event.status = 'scheduled' then
      if not coalesce(v_is_admin, false) and (v_team.leader_member_id is null or v_team.leader_member_id <> v_caller_member_id) then
        raise exception 'Apenas o líder desta equipe ou administrador pode substituir participantes antes do culto.' using errcode = '42501';
      end if;
    elsif v_event.status = 'in_progress' then
      if v_event.liturgy_leader_member_id is null or v_event.liturgy_leader_member_id <> v_caller_member_id then
        raise exception 'Durante a execução do culto, apenas o líder de liturgia designado pode realizar substituições.' using errcode = '42501';
      end if;
    else
      raise exception 'Evento não permite alterações no estado atual.' using errcode = 'P0020';
    end if;
  end if;

  -- Checagens de conflito para o membro substituto (B2-04 / PRD 160):
  if exists (
    select 1
    from app_private.assignments as a
    left join app_private.event_items as ei on ei.id = a.item_id and ei.church_id = a.church_id and ei.event_id = a.event_id
    where a.church_id = p_church_id
      and a.event_id = v_event_id
      and a.member_id = p_replacement_member_id
      and a.status = 'active'
      and (
        (a.item_id is not distinct from v_item_id)
        or (
          v_item_id is not null
          and a.item_id is not null
          and a.item_id <> v_item_id
          and (
            ei.sequence_order = v_item.sequence_order
            or (ei.status = 'in_progress' and v_item.status = 'in_progress')
          )
        )
      )
  ) then
    raise exception 'Membro substituto já possui alocação ativa neste escopo ou em item simultâneo.' using errcode = 'P0020';
  end if;

  if exists (
    select 1
    from app_private.assignments as a2
    join app_private.events as e2 on e2.id = a2.event_id and e2.church_id = a2.church_id
    where a2.church_id = p_church_id
      and a2.member_id = p_replacement_member_id
      and a2.status = 'active'
      and e2.status in ('scheduled', 'in_progress')
      and e2.id <> v_event_id
      and (e2.planned_start_at < v_event.planned_end_at and e2.planned_end_at > v_event.planned_start_at)
  ) then
    raise exception 'Membro substituto possui conflito de escala com outro evento sobreposto.' using errcode = 'P0020';
  end if;

  -- Cria a nova alocação substituta com RETURNING qualificado
  insert into app_private.assignments as a (
    church_id, event_id, item_id, team_id, team_role_id, member_id, status,
    replaced_assignment_id, notes
  ) values (
    p_church_id, v_event_id, v_item_id, v_team_id, v_role_id, p_replacement_member_id, 'active',
    p_assignment_id, v_notes_clean
  )
  returning a.id, a.created_at into v_new_asg_id, v_created_at;

  -- Atualização atômica condicional com verificação de afetação estrita de 1 linha (B2-04)
  update app_private.assignments as a
  set status = 'replaced',
      replacement_assignment_id = v_new_asg_id,
      updated_at = clock_timestamp()
  where a.id = p_assignment_id
    and a.status = 'active';

  get diagnostics v_rows_updated = row_count;
  if v_rows_updated <> 1 then
    raise exception 'Conflito de concorrência: alocação já substituída por outra transação.' using errcode = 'P0020';
  end if;

  v_payload := jsonb_build_object(
    'original_assignment_id', p_assignment_id,
    'replacement_assignment_id', v_new_asg_id,
    'replacement_member_id', p_replacement_member_id,
    'reason', v_reason_clean,
    'notes', v_notes_clean,
    'status', 'replaced'
  );

  insert into app_private.audit_entries (
    church_id, action, actor_user_id, actor_source, maintenance_operator,
    target_type, target_id, details, occurred_at
  ) values (
    p_church_id, c_action, v_user_id, 'application', null,
    'assignment', p_assignment_id, v_payload, v_created_at
  );

  insert into app_private.command_receipts (
    church_id, user_id, command_id, action, params_hash,
    result_member_id, result_entity_id, result_payload, created_at
  ) values (
    p_church_id, v_user_id, p_command_id, c_action, v_params_hash,
    null, v_new_asg_id, v_payload, v_created_at
  );

  return query
  select p_command_id, c_action, p_church_id, v_new_asg_id, v_payload, v_created_at;
end;
$function$;


-- 2.16 list_church_members_for_team (Consulta mínima de membros para líderes de equipe - B2-02/B2-03)
create or replace function public.list_church_members_for_team(
  p_church_id uuid
)
returns table (
  members jsonb
)
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '5s'
as $function$
declare
  v_user_id uuid;
  v_caller_member_id uuid;
  v_is_admin boolean;
  v_items jsonb;
begin
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if p_church_id is null then
    raise exception 'Identificador de igreja obrigatório.' using errcode = '22004';
  end if;

  -- Validação estrita de membro ativo da igreja com conta confirmada
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

  -- Consulta mínima específica para líderes de equipe ou admin (PRD / B2-02 / B2-03)
  if not coalesce(v_is_admin, false) and not exists (
    select 1 from app_private.teams as t
    where t.church_id = p_church_id and t.leader_member_id = v_caller_member_id and t.status = 'active'
  ) then
    raise exception 'Apenas administradores ou líderes de equipe ativos podem consultar esta listagem.' using errcode = '42501';
  end if;

  -- Retorna lista mínima (member_id, display_name) para composição de equipes sem expor dados restritos
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'member_id', m.id,
        'display_name', m.display_name
      ) order by m.display_name asc
    ),
    '[]'::jsonb
  )
  into v_items
  from app_private.members as m
  where m.church_id = p_church_id
    and m.status = 'active';

  return query select v_items;
end;
$function$;

-- 2.17 list_church_teams (Preserva id, team_id e contagem de integrantes - B2-02/B2-05)
create or replace function public.list_church_teams(
  p_church_id uuid
)
returns table (
  teams jsonb
)
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '5s'
as $function$
declare
  v_user_id uuid;
  v_caller_member_id uuid;
  v_is_admin boolean;
  v_items jsonb;
begin
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if p_church_id is null then
    raise exception 'Identificador de igreja obrigatório.' using errcode = '22004';
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

  if v_caller_member_id is null then
    raise exception 'Acesso não autorizado nesta igreja.' using errcode = '42501';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', t.id,
        'team_id', t.id,
        'church_id', t.church_id,
        'name', t.name,
        'leader_member_id', t.leader_member_id,
        'leader_name', m.display_name,
        'status', t.status,
        'version', t.version,
        'member_count', coalesce(mc.cnt, 0),
        'created_at', t.created_at,
        'updated_at', t.updated_at
      ) order by t.name asc
    ),
    '[]'::jsonb
  )
  into v_items
  from app_private.teams as t
  left join app_private.members as m on m.id = t.leader_member_id and m.church_id = t.church_id
  left join (
    select tm.team_id, count(*)::integer as cnt
    from app_private.team_memberships as tm
    where tm.church_id = p_church_id and tm.status = 'active'
    group by tm.team_id
  ) as mc on mc.team_id = t.id
  where t.church_id = p_church_id
    and t.status = 'active';

  return query select v_items;
end;
$function$;

-- 2.18 list_church_team_roles (Preserva id, team_role_id e role_id - B2-02/B2-05)
create or replace function public.list_church_team_roles(
  p_church_id uuid,
  p_team_id uuid
)
returns table (
  roles jsonb
)
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '5s'
as $function$
declare
  v_user_id uuid;
  v_caller_member_id uuid;
  v_is_admin boolean;
  v_items jsonb;
begin
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if p_church_id is null or p_team_id is null then
    raise exception 'Parâmetros obrigatórios ausentes.' using errcode = '22004';
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

  if v_caller_member_id is null then
    raise exception 'Acesso não autorizado nesta igreja.' using errcode = '42501';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', tr.id,
        'team_role_id', tr.id,
        'role_id', tr.id,
        'church_id', tr.church_id,
        'team_id', tr.team_id,
        'name', tr.name,
        'description', tr.description,
        'status', tr.status,
        'created_at', tr.created_at,
        'updated_at', tr.updated_at
      ) order by tr.name asc
    ),
    '[]'::jsonb
  )
  into v_items
  from app_private.team_roles as tr
  where tr.church_id = p_church_id
    and tr.team_id = p_team_id
    and tr.status = 'active';

  return query select v_items;
end;
$function$;

-- 2.19 list_team_members (Preserva id, membership_id e member_id - B2-02/B2-05)
create or replace function public.list_team_members(
  p_church_id uuid,
  p_team_id uuid
)
returns table (
  members jsonb
)
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '5s'
as $function$
declare
  v_user_id uuid;
  v_caller_member_id uuid;
  v_is_admin boolean;
  v_items jsonb;
begin
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if p_church_id is null or p_team_id is null then
    raise exception 'Parâmetros obrigatórios ausentes.' using errcode = '22004';
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

  if v_caller_member_id is null then
    raise exception 'Acesso não autorizado nesta igreja.' using errcode = '42501';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', tm.id,
        'membership_id', tm.id,
        'church_id', tm.church_id,
        'team_id', tm.team_id,
        'member_id', tm.member_id,
        'display_name', m.display_name,
        'status', tm.status,
        'created_at', tm.created_at,
        'updated_at', tm.updated_at
      ) order by m.display_name asc
    ),
    '[]'::jsonb
  )
  into v_items
  from app_private.team_memberships as tm
  join app_private.members as m on m.id = tm.member_id and m.church_id = tm.church_id
  where tm.church_id = p_church_id
    and tm.team_id = p_team_id
    and tm.status = 'active'
    and m.status = 'active';

  return query select v_items;
end;
$function$;

-- 2.20 list_member_qualifications (Preserva id, qualification_id, team_role_id e role_id - B2-02/B2-05)
create or replace function public.list_member_qualifications(
  p_church_id uuid,
  p_member_id uuid
)
returns table (
  qualifications jsonb
)
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '5s'
as $function$
declare
  v_user_id uuid;
  v_caller_member_id uuid;
  v_is_admin boolean;
  v_items jsonb;
begin
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if p_church_id is null or p_member_id is null then
    raise exception 'Parâmetros obrigatórios ausentes.' using errcode = '22004';
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

  if v_caller_member_id is null then
    raise exception 'Acesso não autorizado nesta igreja.' using errcode = '42501';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', mq.id,
        'qualification_id', mq.id,
        'church_id', mq.church_id,
        'member_id', mq.member_id,
        'team_id', mq.team_id,
        'team_name', t.name,
        'team_role_id', mq.team_role_id,
        'role_id', mq.team_role_id,
        'role_name', tr.name,
        'status', mq.status,
        'created_at', mq.created_at,
        'updated_at', mq.updated_at
      ) order by t.name asc, tr.name asc
    ),
    '[]'::jsonb
  )
  into v_items
  from app_private.member_qualifications as mq
  join app_private.teams as t on t.id = mq.team_id and t.church_id = mq.church_id
  join app_private.team_roles as tr on tr.id = mq.team_role_id and tr.church_id = mq.church_id
  where mq.church_id = p_church_id
    and mq.member_id = p_member_id
    and mq.status = 'active'
    and t.status = 'active'
    and tr.status = 'active';

  return query select v_items;
end;
$function$;

-- 2.21 list_church_events
create or replace function public.list_church_events(
  p_church_id uuid,
  p_status_filter text default 'all',
  p_limit integer default 20,
  p_offset integer default 0
)
returns table (
  events jsonb,
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
  v_caller_member_id uuid;
  v_is_admin boolean;
  v_status text;
  v_limit integer;
  v_offset integer;
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

  v_status := lower(coalesce(btrim(p_status_filter), 'all'));
  if v_status not in ('all', 'scheduled', 'in_progress', 'completed', 'cancelled') then
    raise exception 'Filtro de status inválido.' using errcode = '22000';
  end if;

  v_limit := greatest(1, least(coalesce(p_limit, 20), 100));
  v_offset := greatest(0, coalesce(p_offset, 0));

  select count(*)
  into v_total
  from app_private.events as e
  where e.church_id = p_church_id
    and (v_status = 'all' or e.status = v_status);

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', e.id,
        'church_id', e.church_id,
        'title', e.title,
        'event_type', e.event_type,
        'timezone', e.timezone,
        'status', e.status,
        'planned_start_at', e.planned_start_at,
        'planned_end_at', e.planned_end_at,
        'actual_start_at', e.actual_start_at,
        'actual_end_at', e.actual_end_at,
        'liturgy_leader_member_id', e.liturgy_leader_member_id,
        'liturgy_leader_name', m.display_name,
        'version', e.version,
        'cancel_reason', e.cancel_reason,
        'created_at', e.created_at,
        'updated_at', e.updated_at
      ) order by e.planned_start_at desc
    ),
    '[]'::jsonb
  )
  into v_items
  from (
    select e.*
    from app_private.events as e
    where e.church_id = p_church_id
      and (v_status = 'all' or e.status = v_status)
    order by e.planned_start_at desc
    limit v_limit
    offset v_offset
  ) as e
  left join app_private.members as m on m.id = e.liturgy_leader_member_id and m.church_id = e.church_id;

  return query select v_items, v_total;
end;
$function$;

-- 2.22 list_event_assignments (Com filtro de bastidores e privacidade PRD 10 - B2-03)
create or replace function public.list_event_assignments(
  p_church_id uuid,
  p_event_id uuid
)
returns table (
  assignments jsonb
)
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '5s'
as $function$
declare
  v_user_id uuid;
  v_caller_member_id uuid;
  v_is_admin boolean;
  v_liturgy_leader_id uuid;
  v_items jsonb;
begin
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if p_church_id is null or p_event_id is null then
    raise exception 'Parâmetros obrigatórios ausentes.' using errcode = '22004';
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

  if v_caller_member_id is null then
    raise exception 'Acesso não autorizado nesta igreja.' using errcode = '42501';
  end if;

  select e.liturgy_leader_member_id
  into v_liturgy_leader_id
  from app_private.events as e
  where e.church_id = p_church_id and e.id = p_event_id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', a.id,
        'church_id', a.church_id,
        'event_id', a.event_id,
        'item_id', a.item_id,
        'team_id', a.team_id,
        'team_role_id', a.team_role_id,
        'member_id', a.member_id,
        'status', a.status,
        'member_name', m.display_name,
        'team_name', t.name,
        'role_name', tr.name,
        'item_title', ei.title,
        -- Filtro de bastidores: notas visíveis estritamente à liturgia, líder da equipe ou o próprio membro (PRD 10 / B2-03)
        'notes', case
          when (v_liturgy_leader_id is not null and v_liturgy_leader_id = v_caller_member_id)
               or (t.leader_member_id is not null and t.leader_member_id = v_caller_member_id)
               or a.member_id = v_caller_member_id
          then a.notes
          else null
        end,
        -- Histórico de substituição visível estritamente à liturgia ou líder da equipe
        'replaced_assignment_id', case
          when (v_liturgy_leader_id is not null and v_liturgy_leader_id = v_caller_member_id)
               or (t.leader_member_id is not null and t.leader_member_id = v_caller_member_id)
          then a.replaced_assignment_id
          else null
        end,
        'replacement_assignment_id', case
          when (v_liturgy_leader_id is not null and v_liturgy_leader_id = v_caller_member_id)
               or (t.leader_member_id is not null and t.leader_member_id = v_caller_member_id)
          then a.replacement_assignment_id
          else null
        end,
        'created_at', a.created_at,
        'updated_at', a.updated_at
      ) order by ei.sequence_order nulls last, a.created_at asc
    ),
    '[]'::jsonb
  )
  into v_items
  from app_private.assignments as a
  join app_private.members as m on m.id = a.member_id and m.church_id = a.church_id
  join app_private.teams as t on t.id = a.team_id and t.church_id = a.church_id
  left join app_private.team_roles as tr on tr.id = a.team_role_id and tr.church_id = a.church_id
  left join app_private.event_items as ei on ei.id = a.item_id and ei.church_id = a.church_id and ei.event_id = a.event_id
  where a.church_id = p_church_id
    and a.event_id = p_event_id;

  return query select v_items;
end;
$function$;

-- =============================================================================
-- 3. Endurecimento Estrito e Concessão de Privilégios (Todas as 22 RPCs)
-- =============================================================================

-- Revoga execução pública e anônima em todas as 22 RPCs operacionais
revoke all on function public.create_church_team(uuid, uuid, text, uuid) from public, anon, service_role;
revoke all on function public.assign_team_leader(uuid, uuid, uuid, uuid, integer) from public, anon, service_role;
revoke all on function public.create_team_role(uuid, uuid, uuid, text, text) from public, anon, service_role;
revoke all on function public.add_team_member(uuid, uuid, uuid, uuid) from public, anon, service_role;
revoke all on function public.remove_team_member(uuid, uuid, uuid, uuid) from public, anon, service_role;
revoke all on function public.grant_member_qualification(uuid, uuid, uuid, uuid, uuid) from public, anon, service_role;
revoke all on function public.revoke_member_qualification(uuid, uuid, uuid, uuid, uuid) from public, anon, service_role;
revoke all on function public.create_church_event(uuid, uuid, text, text, timestamptz, timestamptz, uuid) from public, anon, service_role;
revoke all on function public.assign_event_liturgy_leader(uuid, uuid, uuid, uuid, integer) from public, anon, service_role;
revoke all on function public.start_event_service(uuid, uuid, uuid, integer) from public, anon, service_role;
revoke all on function public.finish_event_service(uuid, uuid, uuid, integer) from public, anon, service_role;
revoke all on function public.cancel_church_event(uuid, uuid, uuid, text, integer) from public, anon, service_role;
revoke all on function public.create_event_item(uuid, uuid, uuid, text, text, integer, integer, uuid, uuid) from public, anon, service_role;
revoke all on function public.assign_event_participant(uuid, uuid, uuid, uuid, uuid, uuid, uuid, text) from public, anon, service_role;
revoke all on function public.replace_event_participant(uuid, uuid, uuid, uuid, text, text) from public, anon, service_role;
revoke all on function public.list_church_members_for_team(uuid) from public, anon, service_role;
revoke all on function public.list_church_teams(uuid) from public, anon, service_role;
revoke all on function public.list_church_team_roles(uuid, uuid) from public, anon, service_role;
revoke all on function public.list_team_members(uuid, uuid) from public, anon, service_role;
revoke all on function public.list_member_qualifications(uuid, uuid) from public, anon, service_role;
revoke all on function public.list_church_events(uuid, text, integer, integer) from public, anon, service_role;
revoke all on function public.list_event_assignments(uuid, uuid) from public, anon, service_role;

-- Concede execução exclusiva à role autenticada
grant execute on function public.create_church_team(uuid, uuid, text, uuid) to authenticated;
grant execute on function public.assign_team_leader(uuid, uuid, uuid, uuid, integer) to authenticated;
grant execute on function public.create_team_role(uuid, uuid, uuid, text, text) to authenticated;
grant execute on function public.add_team_member(uuid, uuid, uuid, uuid) to authenticated;
grant execute on function public.remove_team_member(uuid, uuid, uuid, uuid) to authenticated;
grant execute on function public.grant_member_qualification(uuid, uuid, uuid, uuid, uuid) to authenticated;
grant execute on function public.revoke_member_qualification(uuid, uuid, uuid, uuid, uuid) to authenticated;
grant execute on function public.create_church_event(uuid, uuid, text, text, timestamptz, timestamptz, uuid) to authenticated;
grant execute on function public.assign_event_liturgy_leader(uuid, uuid, uuid, uuid, integer) to authenticated;
grant execute on function public.start_event_service(uuid, uuid, uuid, integer) to authenticated;
grant execute on function public.finish_event_service(uuid, uuid, uuid, integer) to authenticated;
grant execute on function public.cancel_church_event(uuid, uuid, uuid, text, integer) to authenticated;
grant execute on function public.create_event_item(uuid, uuid, uuid, text, text, integer, integer, uuid, uuid) to authenticated;
grant execute on function public.assign_event_participant(uuid, uuid, uuid, uuid, uuid, uuid, uuid, text) to authenticated;
grant execute on function public.replace_event_participant(uuid, uuid, uuid, uuid, text, text) to authenticated;
grant execute on function public.list_church_members_for_team(uuid) to authenticated;
grant execute on function public.list_church_teams(uuid) to authenticated;
grant execute on function public.list_church_team_roles(uuid, uuid) to authenticated;
grant execute on function public.list_team_members(uuid, uuid) to authenticated;
grant execute on function public.list_member_qualifications(uuid, uuid) to authenticated;
grant execute on function public.list_church_events(uuid, text, integer, integer) to authenticated;
grant execute on function public.list_event_assignments(uuid, uuid) to authenticated;

-- ============================================================================
-- 3. Bloco Privilegiado de Preparação das Fixtures
-- ============================================================================
do $privileged_setup$
declare
  v_church_id uuid := '01500000-0000-4000-8000-000000000001'::uuid;
  v_admin_user_id uuid := '01500000-0000-4000-8000-000000000002'::uuid;
  v_vol_user_id uuid := '01500000-0000-4000-8000-000000000003'::uuid;

  v_admin_member_id uuid := '01500000-0000-4000-8000-000000000012'::uuid;
  v_vol_member_id uuid := '01500000-0000-4000-8000-000000000013'::uuid;
begin
  -- Insere usuários no schema auth
  insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    (v_admin_user_id, 'admin_rehearsal@teste.local', clock_timestamp(), '{"provider":"email"}'::jsonb, '{}'::jsonb, clock_timestamp(), clock_timestamp()),
    (v_vol_user_id, 'vol_rehearsal@teste.local', clock_timestamp(), '{"provider":"email"}'::jsonb, '{}'::jsonb, clock_timestamp(), clock_timestamp())
  on conflict (id) do nothing;

  -- Insere igreja de ensaio
  insert into app_private.churches (id, name, timezone, default_duration_policy, status)
  values (v_church_id, 'Igreja Ensaio Cadastro 015', 'America/Sao_Paulo', 'warn', 'active')
  on conflict (id) do nothing;

  -- Insere membros
  insert into app_private.members (id, church_id, display_name, status, created_by_user_id)
  values
    (v_admin_member_id, v_church_id, 'Pastor Administrador', 'active', v_admin_user_id),
    (v_vol_member_id, v_church_id, 'Músico Tecladista', 'active', v_admin_user_id)
  on conflict (id) do nothing;

  -- Insere church_access com onboarding completo e status ativo
  insert into app_private.church_access (church_id, user_id, member_id, is_admin, status, onboarding_completed_at, granted_by_user_id)
  values
    (v_church_id, v_admin_user_id, v_admin_member_id, true, 'active', clock_timestamp(), v_admin_user_id),
    (v_church_id, v_vol_user_id, v_vol_member_id, false, 'active', clock_timestamp(), v_admin_user_id)
  on conflict (church_id, user_id) do nothing;

  raise notice 'SETUP PRIVILEGIADO CONCLUÍDO: Fixtures sintetizadas com isolamento estrito.';
end
$privileged_setup$;

-- ============================================================================
-- 4. Bloco de Execução Exclusivo como Authenticated (Chamadas às RPCs Públicas)
-- ============================================================================
-- Troca de contexto estrita para a role authenticated
set local role authenticated;
select set_config('request.jwt.claim.sub', '01500000-0000-4000-8000-000000000002', true);

-- Variáveis de comando e resultado compartilhadas na sessão
do $rehearsal_authenticated_flow$
declare
  v_church_id uuid := '01500000-0000-4000-8000-000000000001'::uuid;
  v_admin_user_id uuid := '01500000-0000-4000-8000-000000000002'::uuid;
  v_vol_member_id uuid := '01500000-0000-4000-8000-000000000013'::uuid;
  v_admin_member_id uuid := '01500000-0000-4000-8000-000000000012'::uuid;

  v_cmd_team uuid := '01500000-0000-4000-8000-0000000000c1'::uuid;
  v_cmd_role uuid := '01500000-0000-4000-8000-0000000000c2'::uuid;
  v_cmd_member uuid := '01500000-0000-4000-8000-0000000000c3'::uuid;
  v_cmd_qual uuid := '01500000-0000-4000-8000-0000000000c4'::uuid;

  v_team_res record;
  v_role_res record;
  v_member_res record;
  v_qual_res record;
  v_replay_res record;

  v_teams_list jsonb;
  v_roles_list jsonb;
  v_members_list jsonb;
  v_quals_list jsonb;

  v_threw boolean;
  v_errcode text;
  v_errmsg text;
begin
  -- ETAPA 1: Criação de Equipe (create_church_team)
  -- A criação vincula o líder automaticamente em team_memberships (1 integrante inicial)
  select * into v_team_res
  from public.create_church_team(v_church_id, v_cmd_team, 'Ministério de Louvor', v_admin_member_id);

  if v_team_res.result_entity_id is null or v_team_res.action <> 'create_church_team' then
    raise exception 'FALHA: Criação de equipe não retornou recibo válido.';
  end if;

  -- ETAPA 2: Criação de Função Técnica (create_team_role)
  select * into v_role_res
  from public.create_team_role(v_church_id, v_cmd_role, v_team_res.result_entity_id, 'Teclado', 'Instrumentista harmônico');

  if v_role_res.result_entity_id is null or v_role_res.action <> 'create_team_role' then
    raise exception 'FALHA: Criação de função técnica não retornou recibo válido.';
  end if;

  if (v_role_res.result_payload->>'role_id') is null
     or (v_role_res.result_payload->>'team_id') is null
     or (v_role_res.result_payload->>'role_id')::uuid <> v_role_res.result_entity_id then
    raise exception 'FALHA DE CONTRATO: Payload deve conter role_id como entidade principal e team_id como referência.';
  end if;

  -- ETAPA 3: Inclusão de Integrante na Equipe (add_team_member)
  -- Adiciona o segundo membro (voluntário tecladista). Equipe agora tem 2 integrantes ativos.
  select * into v_member_res
  from public.add_team_member(v_church_id, v_cmd_member, v_team_res.result_entity_id, v_vol_member_id);

  if v_member_res.result_entity_id is null or v_member_res.action <> 'add_team_member' then
    raise exception 'FALHA: Inclusão de membro na equipe não retornou recibo válido.';
  end if;

  if (v_member_res.result_payload->>'membership_id') is null
     or (v_member_res.result_payload->>'team_id') is null
     or (v_member_res.result_payload->>'membership_id')::uuid <> v_member_res.result_entity_id then
    raise exception 'FALHA DE CONTRATO: Payload deve conter membership_id como entidade principal e team_id como referência.';
  end if;

  -- ETAPA 4: Homologação de Aptidão Técnica (grant_member_qualification)
  select * into v_qual_res
  from public.grant_member_qualification(v_church_id, v_cmd_qual, v_vol_member_id, v_team_res.result_entity_id, v_role_res.result_entity_id);

  if v_qual_res.result_entity_id is null or v_qual_res.action <> 'grant_member_qualification' then
    raise exception 'FALHA: Concessão de aptidão não retornou recibo válido.';
  end if;

  if (v_qual_res.result_payload->>'qualification_id') is null
     or (v_qual_res.result_payload->>'team_id') is null
     or (v_qual_res.result_payload->>'team_role_id') is null
     or (v_qual_res.result_payload->>'qualification_id')::uuid <> v_qual_res.result_entity_id then
    raise exception 'FALHA DE CONTRATO: Payload deve conter qualification_id como entidade principal.';
  end if;

  -- ETAPA 5: Consulta, Recarga e Reconciliação (Contratos SQL -> Serviço -> Tela)
  -- Contagem coerente com a fixture: 1 líder integrado na criação + 1 integrante adicionado = 2 membros ativos!
  select teams into v_teams_list from public.list_church_teams(v_church_id);
  if (v_teams_list->0->>'id') is null
     or (v_teams_list->0->>'team_id') is null
     or (v_teams_list->0->>'member_count')::integer <> 2 then
    raise exception 'FALHA DE CONTRATO: list_church_teams deve conter id, team_id e member_count = 2 (encontrado %).', (v_teams_list->0->>'member_count');
  end if;

  select roles into v_roles_list from public.list_church_team_roles(v_church_id, v_team_res.result_entity_id);
  if (v_roles_list->0->>'id') is null
     or (v_roles_list->0->>'team_role_id') is null
     or (v_roles_list->0->>'role_id') is null then
    raise exception 'FALHA DE CONTRATO: list_church_team_roles deve conter id, team_role_id e role_id.';
  end if;

  select members into v_members_list from public.list_team_members(v_church_id, v_team_res.result_entity_id);
  if (v_members_list->0->>'id') is null
     or (v_members_list->0->>'membership_id') is null
     or (v_members_list->0->>'member_id') is null then
    raise exception 'FALHA DE CONTRATO: list_team_members deve conter id, membership_id e member_id.';
  end if;

  select qualifications into v_quals_list from public.list_member_qualifications(v_church_id, v_vol_member_id);
  if (v_quals_list->0->>'id') is null
     or (v_quals_list->0->>'qualification_id') is null
     or (v_quals_list->0->>'team_role_id') is null then
    raise exception 'FALHA DE CONTRATO: list_member_qualifications deve conter id e qualification_id.';
  end if;

  -- ETAPA 6: Repetição Idempotente (Replay) com Mesmo Identificador de Comando
  select * into v_replay_res
  from public.create_church_team(v_church_id, v_cmd_team, 'Ministério de Louvor', v_admin_member_id);

  if v_replay_res.command_id <> v_cmd_team
     or v_replay_res.result_entity_id <> v_team_res.result_entity_id
     or v_replay_res.created_at <> v_team_res.created_at then
    raise exception 'FALHA DE REPLAY: Reexecução não retornou o recibo original idêntico.';
  end if;

  -- ETAPA 7: Conflito de Parâmetros Divergentes com Mesmo command_id
  v_threw := false;
  begin
    perform public.create_church_team(v_church_id, v_cmd_team, 'Ministério com Parâmetro Divergente', v_admin_member_id);
  exception when others then
    v_threw := true;
    v_errcode := SQLSTATE;
    v_errmsg := SQLERRM;
  end;

  if not v_threw or v_errcode <> 'P0020' or v_errmsg !~* 'divergente' then
    raise exception 'FALHA DE CONFLITO: Esperava exceção P0020 com menção a parâmetros divergentes, recebido % (%)', v_errcode, v_errmsg;
  end if;

  raise notice 'FLUXO AUTHENTICATED CONCLUÍDO COM SUCESSO: Cadastro, Recibo, Contratos, Replay e Conflito P0020 validados via RPC.';
end
$rehearsal_authenticated_flow$;

-- ============================================================================
-- 5. Comutação de Papel e Inspeção Privilegiada (Auditoria e Recibos em app_private)
-- ============================================================================
-- Retorna para papel privilegiado (postgres / superuser) para observar tabelas privadas
reset role;

do $privileged_inspection$
declare
  v_church_id uuid := '01500000-0000-4000-8000-000000000001'::uuid;
  v_admin_user_id uuid := '01500000-0000-4000-8000-000000000002'::uuid;

  v_cmd_team uuid := '01500000-0000-4000-8000-0000000000c1'::uuid;
  v_cmd_role uuid := '01500000-0000-4000-8000-0000000000c2'::uuid;
  v_cmd_member uuid := '01500000-0000-4000-8000-0000000000c3'::uuid;
  v_cmd_qual uuid := '01500000-0000-4000-8000-0000000000c4'::uuid;

  v_receipt_count integer;
  v_audit_count integer;
  v_team_count integer;
  v_membership_count integer;
  v_qual_count integer;
begin
  -- 1. Verifica persistência dos recibos de comando em app_private.command_receipts
  select count(*) into v_receipt_count
  from app_private.command_receipts
  where user_id = v_admin_user_id and command_id in (v_cmd_team, v_cmd_role, v_cmd_member, v_cmd_qual);

  if v_receipt_count <> 4 then
    raise exception 'FALHA DE AUDITORIA: Esperava 4 recibos gravados em app_private.command_receipts, encontrado %.', v_receipt_count;
  end if;

  -- 2. Verifica persistência de auditoria em app_private.audit_entries
  select count(*) into v_audit_count
  from app_private.audit_entries
  where church_id = v_church_id and actor_user_id = v_admin_user_id
    and action in ('create_church_team', 'create_team_role', 'add_team_member', 'grant_member_qualification');

  if v_audit_count <> 4 then
    raise exception 'FALHA DE AUDITORIA: Esperava 4 registros de auditoria em app_private.audit_entries, encontrado %.', v_audit_count;
  end if;

  -- 3. Verifica integridade relacional e contagem de entidades criadas
  select count(*) into v_team_count
  from app_private.teams
  where church_id = v_church_id;

  if v_team_count <> 1 then
    raise exception 'FALHA DE AUDITORIA: Esperava 1 equipe criada (replay não pode duplicar), encontrado %.', v_team_count;
  end if;

  select count(*) into v_membership_count
  from app_private.team_memberships
  where church_id = v_church_id and status = 'active';

  if v_membership_count <> 2 then
    raise exception 'FALHA DE AUDITORIA: Esperava exatamente 2 vínculos de membros ativos na equipe (líder + voluntário), encontrado %.', v_membership_count;
  end if;

  select count(*) into v_qual_count
  from app_private.member_qualifications
  where church_id = v_church_id and status = 'active';

  if v_qual_count <> 1 then
    raise exception 'FALHA DE AUDITORIA: Esperava 1 homologação de aptidão ativa, encontrado %.', v_qual_count;
  end if;

  raise notice 'INSPEÇÃO PRIVILEGIADA CONCLUÍDA: Recibos (4/4), Auditoria (4/4), Equipes (1), Membros (2/2) e Aptidões (1/1) validados.';
end
$privileged_inspection$;

-- ============================================================================
-- 6. Reversão Total Incondicional (Zero Resíduos no Banco de Dados)
-- ============================================================================
rollback;

-- ============================================================================
-- 7. Conferência Pós-ROLLBACK (Executada Fora da Transação para Provar Reversão)
-- ============================================================================
do $post_rollback_audit$
declare
  v_teams_exists boolean;
  v_users_count integer;
  v_churches_count integer;
  v_receipts_count integer;
  v_audit_count integer;
begin
  -- Verifica que tabelas do candidato 015 não foram persistidas
  select exists (
    select 1 from information_schema.tables where table_schema = 'app_private' and table_name = 'teams'
  ) into v_teams_exists;

  if v_teams_exists then
    raise exception 'FALHA PÓS-ROLLBACK CRÍTICA: Tabela app_private.teams ainda existe no catálogo!';
  end if;

  -- Verifica que fixtures foram revertidas
  select count(*) into v_users_count
  from auth.users
  where id in ('01500000-0000-4000-8000-000000000002'::uuid, '01500000-0000-4000-8000-000000000003'::uuid);

  if v_users_count <> 0 then
    raise exception 'FALHA PÓS-ROLLBACK: Resíduos de usuários auth (encontrados %)!', v_users_count;
  end if;

  select count(*) into v_churches_count
  from app_private.churches
  where id = '01500000-0000-4000-8000-000000000001'::uuid;

  if v_churches_count <> 0 then
    raise exception 'FALHA PÓS-ROLLBACK: Resíduos de igreja de teste (encontrados %)!', v_churches_count;
  end if;

  select count(*) into v_receipts_count
  from app_private.command_receipts
  where church_id = '01500000-0000-4000-8000-000000000001'::uuid;

  if v_receipts_count <> 0 then
    raise exception 'FALHA PÓS-ROLLBACK: Resíduos de recibos de comando encontrados!';
  end if;

  select count(*) into v_audit_count
  from app_private.audit_entries
  where church_id = '01500000-0000-4000-8000-000000000001'::uuid;

  if v_audit_count <> 0 then
    raise exception 'FALHA PÓS-ROLLBACK: Resíduos de auditoria encontrados!';
  end if;

  raise notice '======================================================================';
  raise notice 'PASS: Ensaio de cadastro simples revertido com sucesso. Zero resíduos no banco.';
  raise notice 'Baseline pré-ensaio e pós-rollback conferidos: integridade absoluta preservada.';
  raise notice '======================================================================';
end
$post_rollback_audit$;
