-- Escala do Reino: Incremento 015 — Fonte Real de Dependências Litúrgicas e Operacionais.
-- Cria as tabelas em app_private (teams, team_memberships, team_roles, member_qualifications,
-- events, event_items, assignments) com integridade relacional composta multi-tenant por church_id,
-- triggers monotônicos de updated_at, RLS e RPCs públicas de gestão com autorização estrita no servidor.
-- Evolui app_private.command_receipts tornando result_member_id opcional para acomodar entidades litúrgicas (B2-01).
-- Executar apenas com autorização explícita do responsável após ensaio 015_validate_liturgical_dependencies.sql com PASS.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

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
-- Torna result_member_id opcional para comandos cujo resultado principal é equipe, evento ou alocação
alter table app_private.command_receipts
  alter column result_member_id drop not null;

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

-- 1.5 Eventos e Cultos
create table app_private.events (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references app_private.churches(id) on delete restrict,
  title text not null,
  event_type text not null default 'culto',
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

-- 1.6 Itens do Cronograma de Culto
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

-- 1.7 Alocações e Escalas de Voluntários
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
  constraint asg_church_item_fkey
    foreign key (church_id, item_id)
    references app_private.event_items(church_id, id) on delete restrict,
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
    references app_private.assignments(church_id, id) on delete restrict
);

create index asg_church_member_active_idx
  on app_private.assignments (church_id, member_id, status)
  where status = 'active';

create trigger asg_touch_updated_at
  before update on app_private.assignments
  for each row execute function app_private.touch_updated_at();

alter table app_private.assignments enable row level security;


-- =============================================================================
-- 2. Endpoints Públicos RPC (SECURITY DEFINER, search_path = '', timeout 5s)
-- =============================================================================

-- 2.1 Criar Equipe / Ministério (Admin)
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
  v_params_canonical text;
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

  -- B2-03: Autorização vigente sob contexto real de igreja/membro/acesso
  select ca.member_id, ca.is_admin
  into v_caller_member_id, v_is_admin
  from app_private.church_access ca
  join app_private.members m on m.id = ca.member_id and m.church_id = ca.church_id
  join app_private.churches c on c.id = ca.church_id
  where ca.user_id = v_user_id
    and ca.church_id = p_church_id
    and ca.status = 'active'
    and m.status = 'active'
    and c.status = 'active';

  if v_caller_member_id is null or not coalesce(v_is_admin, false) then
    raise exception 'Apenas administradores ativos podem criar equipes.' using errcode = '42501';
  end if;

  -- Lock de idempotência por usuário e comando
  perform pg_advisory_xact_lock(hashtext(v_user_id::text), hashtext(p_command_id::text));

  v_params_canonical := c_action || ':' || p_church_id::text || ':' || v_name_clean || ':' || coalesce(p_leader_member_id::text, 'null');
  v_params_hash := extensions.digest(v_params_canonical, 'sha256');

  -- B2-03: Validação estrita de replay com conferência completa de ação, igreja e hash
  select cr.command_id, cr.action, cr.church_id, cr.result_entity_id, cr.result_payload, cr.created_at, cr.parameters_hash
  into v_existing_receipt
  from app_private.command_receipts cr
  where cr.command_id = p_command_id;

  if found then
    if v_existing_receipt.church_id <> p_church_id
       or v_existing_receipt.action <> c_action
       or v_existing_receipt.parameters_hash <> v_params_hash then
      raise exception 'Comando já executado com parâmetros divergentes ou em outro contexto.' using errcode = '23505';
    end if;

    return query select
      v_existing_receipt.command_id,
      v_existing_receipt.action,
      v_existing_receipt.church_id,
      v_existing_receipt.result_entity_id,
      v_existing_receipt.result_payload,
      v_existing_receipt.created_at;
    return;
  end if;

  -- Validar líder inicial se fornecido
  if p_leader_member_id is not null then
    if not exists (
      select 1 from app_private.members m
      where m.church_id = p_church_id and m.id = p_leader_member_id and m.status = 'active'
    ) then
      raise exception 'Líder informado não é membro ativo desta igreja.' using errcode = 'P0002';
    end if;
  end if;

  insert into app_private.teams (church_id, name, leader_member_id, status, version)
  values (p_church_id, v_name_clean, p_leader_member_id, 'active', 1)
  returning id, app_private.teams.created_at into v_team_id, v_created_at;

  if p_leader_member_id is not null then
    insert into app_private.team_memberships (church_id, team_id, member_id, status)
    values (p_church_id, v_team_id, p_leader_member_id, 'active')
    on conflict (church_id, team_id, member_id) do nothing;
  end if;

  v_payload := jsonb_build_object(
    'team_id', v_team_id,
    'name', v_name_clean,
    'leader_member_id', p_leader_member_id,
    'status', 'active',
    'version', 1
  );

  insert into app_private.audit_entries (church_id, operator_user_id, action, entity_type, entity_id, payload)
  values (p_church_id, v_user_id, c_action, 'team', v_team_id, v_payload);

  -- B2-01: Recibo canônico compatível com result_member_id nulo para entidades litúrgicas
  insert into app_private.command_receipts (command_id, church_id, action, result_entity_id, result_payload, parameters_hash)
  values (p_command_id, p_church_id, c_action, v_team_id, v_payload, v_params_hash);

  return query select p_command_id, c_action, p_church_id, v_team_id, v_payload, v_created_at;
end;
$function$;

-- 2.2 Designar / Transferir Liderança da Equipe (Admin, com controle de versão otimista)
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
  v_params_canonical text;
  v_params_hash bytea;
  v_existing_receipt record;
  v_payload jsonb;
  v_new_version integer;
  c_action constant text := 'assign_team_leader';
begin
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if p_church_id is null or p_command_id is null or p_team_id is null or p_new_leader_member_id is null then
    raise exception 'Parâmetros obrigatórios ausentes.' using errcode = '22004';
  end if;

  -- B2-03: Autorização vigente
  select ca.member_id, ca.is_admin
  into v_caller_member_id, v_is_admin
  from app_private.church_access ca
  join app_private.members m on m.id = ca.member_id and m.church_id = ca.church_id
  join app_private.churches c on c.id = ca.church_id
  where ca.user_id = v_user_id
    and ca.church_id = p_church_id
    and ca.status = 'active'
    and m.status = 'active'
    and c.status = 'active';

  if v_caller_member_id is null or not coalesce(v_is_admin, false) then
    raise exception 'Apenas administradores ativos podem transferir liderança de equipe.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_user_id::text), hashtext(p_command_id::text));

  v_params_canonical := c_action || ':' || p_church_id::text || ':' || p_team_id::text || ':' || p_new_leader_member_id::text || ':' || coalesce(p_expected_version::text, 'null');
  v_params_hash := extensions.digest(v_params_canonical, 'sha256');

  select cr.command_id, cr.action, cr.church_id, cr.result_entity_id, cr.result_payload, cr.created_at, cr.parameters_hash
  into v_existing_receipt
  from app_private.command_receipts cr
  where cr.command_id = p_command_id;

  if found then
    if v_existing_receipt.church_id <> p_church_id
       or v_existing_receipt.action <> c_action
       or v_existing_receipt.parameters_hash <> v_params_hash then
      raise exception 'Comando já executado com parâmetros divergentes ou em outro contexto.' using errcode = '23505';
    end if;

    return query select
      v_existing_receipt.command_id,
      v_existing_receipt.action,
      v_existing_receipt.church_id,
      v_existing_receipt.result_entity_id,
      v_existing_receipt.result_payload,
      v_existing_receipt.created_at;
    return;
  end if;

  -- Lock hierárquico: members FOR SHARE antes de teams FOR UPDATE
  perform 1 from app_private.members m
  where m.church_id = p_church_id and m.id = p_new_leader_member_id and m.status = 'active'
  for share;

  if not found then
    raise exception 'Novo líder não é membro ativo desta igreja.' using errcode = 'P0002';
  end if;

  select * into v_team
  from app_private.teams t
  where t.church_id = p_church_id and t.id = p_team_id and t.status = 'active'
  for update;

  if not found then
    raise exception 'Equipe não encontrada ou inativa.' using errcode = 'P0002';
  end if;

  if p_expected_version is not null and v_team.version <> p_expected_version then
    raise exception 'Versão esperada da equipe divergente da atual (conflito de concorrência).' using errcode = 'P0019';
  end if;

  v_new_version := v_team.version + 1;

  update app_private.teams
  set leader_member_id = p_new_leader_member_id,
      version = v_new_version
  where id = p_team_id and church_id = p_church_id;

  insert into app_private.team_memberships (church_id, team_id, member_id, status)
  values (p_church_id, p_team_id, p_new_leader_member_id, 'active')
  on conflict (church_id, team_id, member_id) do update
  set status = 'active';

  v_payload := jsonb_build_object(
    'team_id', p_team_id,
    'previous_leader_member_id', v_team.leader_member_id,
    'new_leader_member_id', p_new_leader_member_id,
    'version', v_new_version
  );

  insert into app_private.audit_entries (church_id, operator_user_id, action, entity_type, entity_id, payload)
  values (p_church_id, v_user_id, c_action, 'team', p_team_id, v_payload);

  insert into app_private.command_receipts (command_id, church_id, action, result_entity_id, result_payload, parameters_hash)
  values (p_command_id, p_church_id, c_action, p_team_id, v_payload, v_params_hash);

  return query select p_command_id, c_action, p_church_id, p_team_id, v_payload, clock_timestamp();
end;
$function$;

-- 2.3 Criar Função Técnica na Equipe (Admin ou Líder da Equipe)
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
  v_role_id uuid;
  v_params_canonical text;
  v_params_hash bytea;
  v_existing_receipt record;
  v_payload jsonb;
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
    raise exception 'Nome da função técnica deve ter entre 1 e 100 caracteres.' using errcode = '22000';
  end if;

  select ca.member_id, ca.is_admin
  into v_caller_member_id, v_is_admin
  from app_private.church_access ca
  join app_private.members m on m.id = ca.member_id and m.church_id = ca.church_id
  join app_private.churches c on c.id = ca.church_id
  where ca.user_id = v_user_id
    and ca.church_id = p_church_id
    and ca.status = 'active'
    and m.status = 'active'
    and c.status = 'active';

  if v_caller_member_id is null then
    raise exception 'Acesso não autorizado nesta igreja.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_user_id::text), hashtext(p_command_id::text));

  v_params_canonical := c_action || ':' || p_church_id::text || ':' || p_team_id::text || ':' || v_name_clean;
  v_params_hash := extensions.digest(v_params_canonical, 'sha256');

  select cr.command_id, cr.action, cr.church_id, cr.result_entity_id, cr.result_payload, cr.created_at, cr.parameters_hash
  into v_existing_receipt
  from app_private.command_receipts cr
  where cr.command_id = p_command_id;

  if found then
    if v_existing_receipt.church_id <> p_church_id
       or v_existing_receipt.action <> c_action
       or v_existing_receipt.parameters_hash <> v_params_hash then
      raise exception 'Comando já executado com parâmetros divergentes ou em outro contexto.' using errcode = '23505';
    end if;

    return query select
      v_existing_receipt.command_id,
      v_existing_receipt.action,
      v_existing_receipt.church_id,
      v_existing_receipt.result_entity_id,
      v_existing_receipt.result_payload,
      v_existing_receipt.created_at;
    return;
  end if;

  select * into v_team
  from app_private.teams t
  where t.church_id = p_church_id and t.id = p_team_id and t.status = 'active'
  for share;

  if not found then
    raise exception 'Equipe não encontrada ou inativa.' using errcode = 'P0002';
  end if;

  if not v_is_admin and v_team.leader_member_id <> v_caller_member_id then
    raise exception 'Apenas o administrador ou o líder desta equipe podem criar funções técnicas.' using errcode = '42501';
  end if;

  insert into app_private.team_roles (church_id, team_id, name, description, status)
  values (p_church_id, p_team_id, v_name_clean, btrim(p_description), 'active')
  returning id into v_role_id;

  v_payload := jsonb_build_object(
    'team_role_id', v_role_id,
    'team_id', p_team_id,
    'name', v_name_clean,
    'status', 'active'
  );

  insert into app_private.audit_entries (church_id, operator_user_id, action, entity_type, entity_id, payload)
  values (p_church_id, v_user_id, c_action, 'team_role', v_role_id, v_payload);

  insert into app_private.command_receipts (command_id, church_id, action, result_entity_id, result_payload, parameters_hash)
  values (p_command_id, p_church_id, c_action, v_role_id, v_payload, v_params_hash);

  return query select p_command_id, c_action, p_church_id, v_role_id, v_payload, clock_timestamp();
end;
$function$;

-- 2.4 Adicionar Integrante à Equipe (Admin ou Líder da Equipe)
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
  v_params_canonical text;
  v_params_hash bytea;
  v_existing_receipt record;
  v_payload jsonb;
  c_action constant text := 'add_team_member';
begin
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if p_church_id is null or p_command_id is null or p_team_id is null or p_member_id is null then
    raise exception 'Parâmetros obrigatórios ausentes.' using errcode = '22004';
  end if;

  select ca.member_id, ca.is_admin
  into v_caller_member_id, v_is_admin
  from app_private.church_access ca
  join app_private.members m on m.id = ca.member_id and m.church_id = ca.church_id
  join app_private.churches c on c.id = ca.church_id
  where ca.user_id = v_user_id
    and ca.church_id = p_church_id
    and ca.status = 'active'
    and m.status = 'active'
    and c.status = 'active';

  if v_caller_member_id is null then
    raise exception 'Acesso não autorizado nesta igreja.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_user_id::text), hashtext(p_command_id::text));

  v_params_canonical := c_action || ':' || p_church_id::text || ':' || p_team_id::text || ':' || p_member_id::text;
  v_params_hash := extensions.digest(v_params_canonical, 'sha256');

  select cr.command_id, cr.action, cr.church_id, cr.result_entity_id, cr.result_payload, cr.created_at, cr.parameters_hash
  into v_existing_receipt
  from app_private.command_receipts cr
  where cr.command_id = p_command_id;

  if found then
    if v_existing_receipt.church_id <> p_church_id
       or v_existing_receipt.action <> c_action
       or v_existing_receipt.parameters_hash <> v_params_hash then
      raise exception 'Comando já executado com parâmetros divergentes ou em outro contexto.' using errcode = '23505';
    end if;

    return query select
      v_existing_receipt.command_id,
      v_existing_receipt.action,
      v_existing_receipt.church_id,
      v_existing_receipt.result_entity_id,
      v_existing_receipt.result_payload,
      v_existing_receipt.created_at;
    return;
  end if;

  -- Lock hierárquico: members FOR SHARE -> teams FOR SHARE
  perform 1 from app_private.members m
  where m.church_id = p_church_id and m.id = p_member_id and m.status = 'active'
  for share;

  if not found then
    raise exception 'Membro não encontrado ou inativo nesta igreja.' using errcode = 'P0002';
  end if;

  select * into v_team
  from app_private.teams t
  where t.church_id = p_church_id and t.id = p_team_id and t.status = 'active'
  for share;

  if not found then
    raise exception 'Equipe não encontrada ou inativa.' using errcode = 'P0002';
  end if;

  if not v_is_admin and v_team.leader_member_id <> v_caller_member_id then
    raise exception 'Apenas o administrador ou o líder desta equipe podem incluir integrantes.' using errcode = '42501';
  end if;

  insert into app_private.team_memberships (church_id, team_id, member_id, status)
  values (p_church_id, p_team_id, p_member_id, 'active')
  on conflict (church_id, team_id, member_id) do update
  set status = 'active'
  returning id into v_membership_id;

  v_payload := jsonb_build_object(
    'membership_id', v_membership_id,
    'team_id', p_team_id,
    'member_id', p_member_id,
    'status', 'active'
  );

  insert into app_private.audit_entries (church_id, operator_user_id, action, entity_type, entity_id, payload)
  values (p_church_id, v_user_id, c_action, 'team_membership', v_membership_id, v_payload);

  insert into app_private.command_receipts (command_id, church_id, action, result_entity_id, result_payload, parameters_hash)
  values (p_command_id, p_church_id, c_action, v_membership_id, v_payload, v_params_hash);

  return query select p_command_id, c_action, p_church_id, v_membership_id, v_payload, clock_timestamp();
end;
$function$;

-- 2.5 Remover Integrante da Equipe (Admin ou Líder da Equipe)
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
  v_params_canonical text;
  v_params_hash bytea;
  v_existing_receipt record;
  v_payload jsonb;
  c_action constant text := 'remove_team_member';
begin
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if p_church_id is null or p_command_id is null or p_team_id is null or p_member_id is null then
    raise exception 'Parâmetros obrigatórios ausentes.' using errcode = '22004';
  end if;

  select ca.member_id, ca.is_admin
  into v_caller_member_id, v_is_admin
  from app_private.church_access ca
  join app_private.members m on m.id = ca.member_id and m.church_id = ca.church_id
  join app_private.churches c on c.id = ca.church_id
  where ca.user_id = v_user_id
    and ca.church_id = p_church_id
    and ca.status = 'active'
    and m.status = 'active'
    and c.status = 'active';

  if v_caller_member_id is null then
    raise exception 'Acesso não autorizado nesta igreja.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_user_id::text), hashtext(p_command_id::text));

  v_params_canonical := c_action || ':' || p_church_id::text || ':' || p_team_id::text || ':' || p_member_id::text;
  v_params_hash := extensions.digest(v_params_canonical, 'sha256');

  select cr.command_id, cr.action, cr.church_id, cr.result_entity_id, cr.result_payload, cr.created_at, cr.parameters_hash
  into v_existing_receipt
  from app_private.command_receipts cr
  where cr.command_id = p_command_id;

  if found then
    if v_existing_receipt.church_id <> p_church_id
       or v_existing_receipt.action <> c_action
       or v_existing_receipt.parameters_hash <> v_params_hash then
      raise exception 'Comando já executado com parâmetros divergentes ou em outro contexto.' using errcode = '23505';
    end if;

    return query select
      v_existing_receipt.command_id,
      v_existing_receipt.action,
      v_existing_receipt.church_id,
      v_existing_receipt.result_entity_id,
      v_existing_receipt.result_payload,
      v_existing_receipt.created_at;
    return;
  end if;

  select * into v_team
  from app_private.teams t
  where t.church_id = p_church_id and t.id = p_team_id and t.status = 'active'
  for share;

  if not found then
    raise exception 'Equipe não encontrada ou inativa.' using errcode = 'P0002';
  end if;

  if not v_is_admin and v_team.leader_member_id <> v_caller_member_id then
    raise exception 'Apenas o administrador ou o líder desta equipe podem remover integrantes.' using errcode = '42501';
  end if;

  if v_team.leader_member_id = p_member_id then
    raise exception 'Não é permitido desvincular o líder ativo da equipe antes de transferir a liderança.' using errcode = 'P0022';
  end if;

  select tm.id into v_membership_id
  from app_private.team_memberships tm
  where tm.church_id = p_church_id and tm.team_id = p_team_id and tm.member_id = p_member_id and tm.status = 'active'
  for update;

  if not found then
    raise exception 'Membro não integra ativamente esta equipe.' using errcode = 'P0002';
  end if;

  update app_private.team_memberships
  set status = 'inactive'
  where id = v_membership_id and church_id = p_church_id;

  v_payload := jsonb_build_object(
    'membership_id', v_membership_id,
    'team_id', p_team_id,
    'member_id', p_member_id,
    'status', 'inactive'
  );

  insert into app_private.audit_entries (church_id, operator_user_id, action, entity_type, entity_id, payload)
  values (p_church_id, v_user_id, c_action, 'team_membership', v_membership_id, v_payload);

  insert into app_private.command_receipts (command_id, church_id, action, result_entity_id, result_payload, parameters_hash)
  values (p_command_id, p_church_id, c_action, v_membership_id, v_payload, v_params_hash);

  return query select p_command_id, c_action, p_church_id, v_membership_id, v_payload, clock_timestamp();
end;
$function$;

-- 2.6 Homologar Aptidão / Qualificação de Membro (Admin ou Líder da Equipe)
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
  v_params_canonical text;
  v_params_hash bytea;
  v_existing_receipt record;
  v_payload jsonb;
  c_action constant text := 'grant_member_qualification';
begin
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if p_church_id is null or p_command_id is null or p_member_id is null or p_team_id is null or p_team_role_id is null then
    raise exception 'Parâmetros obrigatórios ausentes.' using errcode = '22004';
  end if;

  select ca.member_id, ca.is_admin
  into v_caller_member_id, v_is_admin
  from app_private.church_access ca
  join app_private.members m on m.id = ca.member_id and m.church_id = ca.church_id
  join app_private.churches c on c.id = ca.church_id
  where ca.user_id = v_user_id
    and ca.church_id = p_church_id
    and ca.status = 'active'
    and m.status = 'active'
    and c.status = 'active';

  if v_caller_member_id is null then
    raise exception 'Acesso não autorizado nesta igreja.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_user_id::text), hashtext(p_command_id::text));

  v_params_canonical := c_action || ':' || p_church_id::text || ':' || p_member_id::text || ':' || p_team_id::text || ':' || p_team_role_id::text;
  v_params_hash := extensions.digest(v_params_canonical, 'sha256');

  select cr.command_id, cr.action, cr.church_id, cr.result_entity_id, cr.result_payload, cr.created_at, cr.parameters_hash
  into v_existing_receipt
  from app_private.command_receipts cr
  where cr.command_id = p_command_id;

  if found then
    if v_existing_receipt.church_id <> p_church_id
       or v_existing_receipt.action <> c_action
       or v_existing_receipt.parameters_hash <> v_params_hash then
      raise exception 'Comando já executado com parâmetros divergentes ou em outro contexto.' using errcode = '23505';
    end if;

    return query select
      v_existing_receipt.command_id,
      v_existing_receipt.action,
      v_existing_receipt.church_id,
      v_existing_receipt.result_entity_id,
      v_existing_receipt.result_payload,
      v_existing_receipt.created_at;
    return;
  end if;

  -- Lock hierárquico: members -> teams -> team_memberships -> team_roles
  perform 1 from app_private.members m
  where m.church_id = p_church_id and m.id = p_member_id and m.status = 'active'
  for share;

  if not found then
    raise exception 'Membro não encontrado ou inativo.' using errcode = 'P0002';
  end if;

  select * into v_team
  from app_private.teams t
  where t.church_id = p_church_id and t.id = p_team_id and t.status = 'active'
  for share;

  if not found then
    raise exception 'Equipe não encontrada ou inativa.' using errcode = 'P0002';
  end if;

  if not v_is_admin and v_team.leader_member_id <> v_caller_member_id then
    raise exception 'Apenas o administrador ou o líder desta equipe podem homologar aptidões.' using errcode = '42501';
  end if;

  if not exists (
    select 1 from app_private.team_memberships tm
    where tm.church_id = p_church_id and tm.team_id = p_team_id and tm.member_id = p_member_id and tm.status = 'active'
  ) then
    raise exception 'Membro deve ser integrante ativo da equipe para receber aptidão.' using errcode = 'P0020';
  end if;

  if not exists (
    select 1 from app_private.team_roles tr
    where tr.church_id = p_church_id and tr.team_id = p_team_id and tr.id = p_team_role_id and tr.status = 'active'
  ) then
    raise exception 'Função técnica não encontrada ou inativa nesta equipe.' using errcode = 'P0002';
  end if;

  insert into app_private.member_qualifications (church_id, member_id, team_id, team_role_id, status)
  values (p_church_id, p_member_id, p_team_id, p_team_role_id, 'active')
  on conflict (church_id, member_id, team_role_id) do update
  set status = 'active'
  returning id into v_qual_id;

  v_payload := jsonb_build_object(
    'qualification_id', v_qual_id,
    'member_id', p_member_id,
    'team_id', p_team_id,
    'team_role_id', p_team_role_id,
    'status', 'active'
  );

  insert into app_private.audit_entries (church_id, operator_user_id, action, entity_type, entity_id, payload)
  values (p_church_id, v_user_id, c_action, 'member_qualification', v_qual_id, v_payload);

  insert into app_private.command_receipts (command_id, church_id, action, result_entity_id, result_payload, parameters_hash)
  values (p_command_id, p_church_id, c_action, v_qual_id, v_payload, v_params_hash);

  return query select p_command_id, c_action, p_church_id, v_qual_id, v_payload, clock_timestamp();
end;
$function$;

-- 2.7 Revogar Aptidão / Qualificação de Membro (Admin ou Líder da Equipe)
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
  v_params_canonical text;
  v_params_hash bytea;
  v_existing_receipt record;
  v_payload jsonb;
  c_action constant text := 'revoke_member_qualification';
begin
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if p_church_id is null or p_command_id is null or p_member_id is null or p_team_id is null or p_team_role_id is null then
    raise exception 'Parâmetros obrigatórios ausentes.' using errcode = '22004';
  end if;

  select ca.member_id, ca.is_admin
  into v_caller_member_id, v_is_admin
  from app_private.church_access ca
  join app_private.members m on m.id = ca.member_id and m.church_id = ca.church_id
  join app_private.churches c on c.id = ca.church_id
  where ca.user_id = v_user_id
    and ca.church_id = p_church_id
    and ca.status = 'active'
    and m.status = 'active'
    and c.status = 'active';

  if v_caller_member_id is null then
    raise exception 'Acesso não autorizado nesta igreja.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_user_id::text), hashtext(p_command_id::text));

  v_params_canonical := c_action || ':' || p_church_id::text || ':' || p_member_id::text || ':' || p_team_id::text || ':' || p_team_role_id::text;
  v_params_hash := extensions.digest(v_params_canonical, 'sha256');

  select cr.command_id, cr.action, cr.church_id, cr.result_entity_id, cr.result_payload, cr.created_at, cr.parameters_hash
  into v_existing_receipt
  from app_private.command_receipts cr
  where cr.command_id = p_command_id;

  if found then
    if v_existing_receipt.church_id <> p_church_id
       or v_existing_receipt.action <> c_action
       or v_existing_receipt.parameters_hash <> v_params_hash then
      raise exception 'Comando já executado com parâmetros divergentes ou em outro contexto.' using errcode = '23505';
    end if;

    return query select
      v_existing_receipt.command_id,
      v_existing_receipt.action,
      v_existing_receipt.church_id,
      v_existing_receipt.result_entity_id,
      v_existing_receipt.result_payload,
      v_existing_receipt.created_at;
    return;
  end if;

  select * into v_team
  from app_private.teams t
  where t.church_id = p_church_id and t.id = p_team_id and t.status = 'active'
  for share;

  if not found then
    raise exception 'Equipe não encontrada ou inativa.' using errcode = 'P0002';
  end if;

  if not v_is_admin and v_team.leader_member_id <> v_caller_member_id then
    raise exception 'Apenas o administrador ou o líder desta equipe podem revogar aptidões.' using errcode = '42501';
  end if;

  select mq.id into v_qual_id
  from app_private.member_qualifications mq
  where mq.church_id = p_church_id and mq.member_id = p_member_id and mq.team_role_id = p_team_role_id and mq.status = 'active'
  for update;

  if not found then
    raise exception 'Membro não possui esta qualificação ativa.' using errcode = 'P0002';
  end if;

  update app_private.member_qualifications
  set status = 'inactive'
  where id = v_qual_id and church_id = p_church_id;

  v_payload := jsonb_build_object(
    'qualification_id', v_qual_id,
    'member_id', p_member_id,
    'team_id', p_team_id,
    'team_role_id', p_team_role_id,
    'status', 'inactive'
  );

  insert into app_private.audit_entries (church_id, operator_user_id, action, entity_type, entity_id, payload)
  values (p_church_id, v_user_id, c_action, 'member_qualification', v_qual_id, v_payload);

  insert into app_private.command_receipts (command_id, church_id, action, result_entity_id, result_payload, parameters_hash)
  values (p_command_id, p_church_id, c_action, v_qual_id, v_payload, v_params_hash);

  return query select p_command_id, c_action, p_church_id, v_qual_id, v_payload, clock_timestamp();
end;
$function$;

-- 2.8 Criar Culto / Evento (Admin OU Líder de Ministério Ativo)
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
  v_is_team_leader boolean;
  v_title_clean text;
  v_event_type_clean text;
  v_params_canonical text;
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

  if p_church_id is null or p_command_id is null or p_title is null
     or p_planned_start_at is null or p_planned_end_at is null then
    raise exception 'Parâmetros obrigatórios ausentes.' using errcode = '22004';
  end if;

  if p_planned_end_at <= p_planned_start_at then
    raise exception 'Término previsto deve ser posterior ao início previsto.' using errcode = '22000';
  end if;

  v_title_clean := btrim(normalize(p_title, NFC));
  if char_length(v_title_clean) < 1 or char_length(v_title_clean) > 200 then
    raise exception 'Título do evento deve ter entre 1 e 200 caracteres.' using errcode = '22000';
  end if;

  v_event_type_clean := lower(btrim(coalesce(p_event_type, 'culto')));

  -- B2-03: Contexto elegível ativo
  select ca.member_id, ca.is_admin
  into v_caller_member_id, v_is_admin
  from app_private.church_access ca
  join app_private.members m on m.id = ca.member_id and m.church_id = ca.church_id
  join app_private.churches c on c.id = ca.church_id
  where ca.user_id = v_user_id
    and ca.church_id = p_church_id
    and ca.status = 'active'
    and m.status = 'active'
    and c.status = 'active';

  if v_caller_member_id is null then
    raise exception 'Acesso não autorizado nesta igreja.' using errcode = '42501';
  end if;

  -- Verifica se é líder ativo de ao menos uma equipe
  select exists (
    select 1 from app_private.teams t
    where t.church_id = p_church_id and t.leader_member_id = v_caller_member_id and t.status = 'active'
  ) into v_is_team_leader;

  if not v_is_admin and not v_is_team_leader then
    raise exception 'Apenas administradores ou líderes de ministério podem criar eventos.' using errcode = '42501';
  end if;

  -- Decisão confirmada: se o criador for Líder de Ministério (não-admin), NÃO pode designar liturgia
  if not v_is_admin and p_liturgy_leader_member_id is not null then
    raise exception 'Líderes de ministério não têm permissão para designar a liderança da liturgia.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_user_id::text), hashtext(p_command_id::text));

  v_params_canonical := c_action || ':' || p_church_id::text || ':' || v_title_clean || ':' ||
                        v_event_type_clean || ':' ||
                        to_char(p_planned_start_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') || ':' ||
                        to_char(p_planned_end_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') || ':' ||
                        coalesce(p_liturgy_leader_member_id::text, 'null');
  v_params_hash := extensions.digest(v_params_canonical, 'sha256');

  select cr.command_id, cr.action, cr.church_id, cr.result_entity_id, cr.result_payload, cr.created_at, cr.parameters_hash
  into v_existing_receipt
  from app_private.command_receipts cr
  where cr.command_id = p_command_id;

  if found then
    if v_existing_receipt.church_id <> p_church_id
       or v_existing_receipt.action <> c_action
       or v_existing_receipt.parameters_hash <> v_params_hash then
      raise exception 'Comando já executado com parâmetros divergentes ou em outro contexto.' using errcode = '23505';
    end if;

    return query select
      v_existing_receipt.command_id,
      v_existing_receipt.action,
      v_existing_receipt.church_id,
      v_existing_receipt.result_entity_id,
      v_existing_receipt.result_payload,
      v_existing_receipt.created_at;
    return;
  end if;

  -- Se admin informou líder da liturgia, validar que é membro ativo
  if p_liturgy_leader_member_id is not null then
    if not exists (
      select 1 from app_private.members m
      where m.church_id = p_church_id and m.id = p_liturgy_leader_member_id and m.status = 'active'
    ) then
      raise exception 'Líder da liturgia informado não é membro ativo desta igreja.' using errcode = 'P0002';
    end if;
  end if;

  insert into app_private.events (
    church_id, title, event_type, status, planned_start_at, planned_end_at, liturgy_leader_member_id, version
  )
  values (
    p_church_id, v_title_clean, v_event_type_clean, 'scheduled', p_planned_start_at, p_planned_end_at, p_liturgy_leader_member_id, 1
  )
  returning id, app_private.events.created_at into v_event_id, v_created_at;

  v_payload := jsonb_build_object(
    'event_id', v_event_id,
    'title', v_title_clean,
    'event_type', v_event_type_clean,
    'planned_start_at', p_planned_start_at,
    'planned_end_at', p_planned_end_at,
    'liturgy_leader_member_id', p_liturgy_leader_member_id,
    'status', 'scheduled',
    'version', 1
  );

  insert into app_private.audit_entries (church_id, operator_user_id, action, entity_type, entity_id, payload)
  values (p_church_id, v_user_id, c_action, 'event', v_event_id, v_payload);

  insert into app_private.command_receipts (command_id, church_id, action, result_entity_id, result_payload, parameters_hash)
  values (p_command_id, p_church_id, c_action, v_event_id, v_payload, v_params_hash);

  return query select p_command_id, c_action, p_church_id, v_event_id, v_payload, v_created_at;
end;
$function$;

-- 2.9 Designar / Trocar Líder da Liturgia do Evento (Exclusivo Administrador)
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
  v_params_canonical text;
  v_params_hash bytea;
  v_existing_receipt record;
  v_payload jsonb;
  v_new_version integer;
  c_action constant text := 'assign_event_liturgy_leader';
begin
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if p_church_id is null or p_command_id is null or p_event_id is null or p_new_liturgy_leader_member_id is null then
    raise exception 'Parâmetros obrigatórios ausentes.' using errcode = '22004';
  end if;

  -- B2-03: Exclusivo Administrador ativo
  select ca.member_id, ca.is_admin
  into v_caller_member_id, v_is_admin
  from app_private.church_access ca
  join app_private.members m on m.id = ca.member_id and m.church_id = ca.church_id
  join app_private.churches c on c.id = ca.church_id
  where ca.user_id = v_user_id
    and ca.church_id = p_church_id
    and ca.status = 'active'
    and m.status = 'active'
    and c.status = 'active';

  if v_caller_member_id is null or not coalesce(v_is_admin, false) then
    raise exception 'Apenas administradores ativos podem designar a liderança da liturgia.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_user_id::text), hashtext(p_command_id::text));

  v_params_canonical := c_action || ':' || p_church_id::text || ':' || p_event_id::text || ':' || p_new_liturgy_leader_member_id::text || ':' || coalesce(p_expected_version::text, 'null');
  v_params_hash := extensions.digest(v_params_canonical, 'sha256');

  select cr.command_id, cr.action, cr.church_id, cr.result_entity_id, cr.result_payload, cr.created_at, cr.parameters_hash
  into v_existing_receipt
  from app_private.command_receipts cr
  where cr.command_id = p_command_id;

  if found then
    if v_existing_receipt.church_id <> p_church_id
       or v_existing_receipt.action <> c_action
       or v_existing_receipt.parameters_hash <> v_params_hash then
      raise exception 'Comando já executado com parâmetros divergentes ou em outro contexto.' using errcode = '23505';
    end if;

    return query select
      v_existing_receipt.command_id,
      v_existing_receipt.action,
      v_existing_receipt.church_id,
      v_existing_receipt.result_entity_id,
      v_existing_receipt.result_payload,
      v_existing_receipt.created_at;
    return;
  end if;

  -- Lock hierárquico: members FOR SHARE antes de events FOR UPDATE
  perform 1 from app_private.members m
  where m.church_id = p_church_id and m.id = p_new_liturgy_leader_member_id and m.status = 'active'
  for share;

  if not found then
    raise exception 'Novo líder da liturgia não é membro ativo desta igreja.' using errcode = 'P0002';
  end if;

  select * into v_event
  from app_private.events e
  where e.church_id = p_church_id and e.id = p_event_id
  for update;

  if not found then
    raise exception 'Evento não encontrado.' using errcode = 'P0002';
  end if;

  if v_event.status in ('completed', 'cancelled') then
    raise exception 'Não é permitido alterar liturgia de evento já concluído ou cancelado.' using errcode = 'P0020';
  end if;

  if p_expected_version is not null and v_event.version <> p_expected_version then
    raise exception 'Versão esperada do evento divergente da atual (conflito de concorrência).' using errcode = 'P0019';
  end if;

  v_new_version := v_event.version + 1;

  update app_private.events
  set liturgy_leader_member_id = p_new_liturgy_leader_member_id,
      version = v_new_version
  where id = p_event_id and church_id = p_church_id;

  v_payload := jsonb_build_object(
    'event_id', p_event_id,
    'previous_liturgy_leader_id', v_event.liturgy_leader_member_id,
    'new_liturgy_leader_id', p_new_liturgy_leader_member_id,
    'version', v_new_version
  );

  insert into app_private.audit_entries (church_id, operator_user_id, action, entity_type, entity_id, payload)
  values (p_church_id, v_user_id, c_action, 'event', p_event_id, v_payload);

  insert into app_private.command_receipts (command_id, church_id, action, result_entity_id, result_payload, parameters_hash)
  values (p_command_id, p_church_id, c_action, p_event_id, v_payload, v_params_hash);

  return query select p_command_id, c_action, p_church_id, p_event_id, v_payload, clock_timestamp();
end;
$function$;

-- 2.10 Iniciar Execução do Culto / Evento (Exclusivo Líder da Liturgia ou Admin)
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
  v_params_canonical text;
  v_params_hash bytea;
  v_existing_receipt record;
  v_payload jsonb;
  v_new_version integer;
  c_action constant text := 'start_event_service';
begin
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if p_church_id is null or p_command_id is null or p_event_id is null then
    raise exception 'Parâmetros obrigatórios ausentes.' using errcode = '22004';
  end if;

  select ca.member_id, ca.is_admin
  into v_caller_member_id, v_is_admin
  from app_private.church_access ca
  join app_private.members m on m.id = ca.member_id and m.church_id = ca.church_id
  join app_private.churches c on c.id = ca.church_id
  where ca.user_id = v_user_id
    and ca.church_id = p_church_id
    and ca.status = 'active'
    and m.status = 'active'
    and c.status = 'active';

  if v_caller_member_id is null then
    raise exception 'Acesso não autorizado nesta igreja.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_user_id::text), hashtext(p_command_id::text));

  v_params_canonical := c_action || ':' || p_church_id::text || ':' || p_event_id::text || ':' || coalesce(p_expected_version::text, 'null');
  v_params_hash := extensions.digest(v_params_canonical, 'sha256');

  select cr.command_id, cr.action, cr.church_id, cr.result_entity_id, cr.result_payload, cr.created_at, cr.parameters_hash
  into v_existing_receipt
  from app_private.command_receipts cr
  where cr.command_id = p_command_id;

  if found then
    if v_existing_receipt.church_id <> p_church_id
       or v_existing_receipt.action <> c_action
       or v_existing_receipt.parameters_hash <> v_params_hash then
      raise exception 'Comando já executado com parâmetros divergentes ou em outro contexto.' using errcode = '23505';
    end if;

    return query select
      v_existing_receipt.command_id,
      v_existing_receipt.action,
      v_existing_receipt.church_id,
      v_existing_receipt.result_entity_id,
      v_existing_receipt.result_payload,
      v_existing_receipt.created_at;
    return;
  end if;

  -- Lock no evento para atualização segura
  select * into v_event
  from app_private.events e
  where e.church_id = p_church_id and e.id = p_event_id
  for update;

  if not found then
    raise exception 'Evento não encontrado.' using errcode = 'P0002';
  end if;

  -- B2-03: Revalidação estrita de autoridade sob o lock
  if not v_is_admin and v_event.liturgy_leader_member_id <> v_caller_member_id then
    raise exception 'Apenas o líder designado da liturgia deste evento pode iniciar a execução do culto.' using errcode = '42501';
  end if;

  if v_event.status <> 'scheduled' then
    raise exception 'Apenas eventos agendados podem ser iniciados (status atual: %).' , v_event.status using errcode = 'P0020';
  end if;

  if p_expected_version is not null and v_event.version <> p_expected_version then
    raise exception 'Versão esperada do evento divergente da atual.' using errcode = 'P0019';
  end if;

  v_new_version := v_event.version + 1;

  update app_private.events
  set status = 'in_progress',
      actual_start_at = clock_timestamp(),
      version = v_new_version
  where id = p_event_id and church_id = p_church_id;

  v_payload := jsonb_build_object(
    'event_id', p_event_id,
    'status', 'in_progress',
    'actual_start_at', clock_timestamp(),
    'version', v_new_version
  );

  insert into app_private.audit_entries (church_id, operator_user_id, action, entity_type, entity_id, payload)
  values (p_church_id, v_user_id, c_action, 'event', p_event_id, v_payload);

  insert into app_private.command_receipts (command_id, church_id, action, result_entity_id, result_payload, parameters_hash)
  values (p_command_id, p_church_id, c_action, p_event_id, v_payload, v_params_hash);

  return query select p_command_id, c_action, p_church_id, p_event_id, v_payload, clock_timestamp();
end;
$function$;

-- 2.11 Encerrar Culto / Evento (Exclusivo Líder da Liturgia ou Admin)
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
  v_params_canonical text;
  v_params_hash bytea;
  v_existing_receipt record;
  v_payload jsonb;
  v_new_version integer;
  c_action constant text := 'finish_event_service';
begin
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if p_church_id is null or p_command_id is null or p_event_id is null then
    raise exception 'Parâmetros obrigatórios ausentes.' using errcode = '22004';
  end if;

  select ca.member_id, ca.is_admin
  into v_caller_member_id, v_is_admin
  from app_private.church_access ca
  join app_private.members m on m.id = ca.member_id and m.church_id = ca.church_id
  join app_private.churches c on c.id = ca.church_id
  where ca.user_id = v_user_id
    and ca.church_id = p_church_id
    and ca.status = 'active'
    and m.status = 'active'
    and c.status = 'active';

  if v_caller_member_id is null then
    raise exception 'Acesso não autorizado nesta igreja.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_user_id::text), hashtext(p_command_id::text));

  v_params_canonical := c_action || ':' || p_church_id::text || ':' || p_event_id::text || ':' || coalesce(p_expected_version::text, 'null');
  v_params_hash := extensions.digest(v_params_canonical, 'sha256');

  select cr.command_id, cr.action, cr.church_id, cr.result_entity_id, cr.result_payload, cr.created_at, cr.parameters_hash
  into v_existing_receipt
  from app_private.command_receipts cr
  where cr.command_id = p_command_id;

  if found then
    if v_existing_receipt.church_id <> p_church_id
       or v_existing_receipt.action <> c_action
       or v_existing_receipt.parameters_hash <> v_params_hash then
      raise exception 'Comando já executado com parâmetros divergentes ou em outro contexto.' using errcode = '23505';
    end if;

    return query select
      v_existing_receipt.command_id,
      v_existing_receipt.action,
      v_existing_receipt.church_id,
      v_existing_receipt.result_entity_id,
      v_existing_receipt.result_payload,
      v_existing_receipt.created_at;
    return;
  end if;

  select * into v_event
  from app_private.events e
  where e.church_id = p_church_id and e.id = p_event_id
  for update;

  if not found then
    raise exception 'Evento não encontrado.' using errcode = 'P0002';
  end if;

  -- B2-03: Revalidação estrita de autoridade sob o lock do evento
  if not v_is_admin and v_event.liturgy_leader_member_id <> v_caller_member_id then
    raise exception 'Apenas o líder da liturgia deste evento ou administradores podem encerrar o culto.' using errcode = '42501';
  end if;

  -- B2-04: Preservação de estados terminais (não converter cancelado em concluído)
  if v_event.status in ('completed', 'cancelled') then
    raise exception 'Evento já se encontra encerrado em estado terminal (%).' , v_event.status using errcode = 'P0020';
  end if;

  if p_expected_version is not null and v_event.version <> p_expected_version then
    raise exception 'Versão esperada do evento divergente da atual.' using errcode = 'P0019';
  end if;

  v_new_version := v_event.version + 1;

  update app_private.events
  set status = 'completed',
      actual_end_at = clock_timestamp(),
      version = v_new_version
  where id = p_event_id and church_id = p_church_id;

  -- B2-04: Transição explícita dos itens conforme PRD M15
  update app_private.event_items
  set status = 'completed',
      actual_end_at = clock_timestamp()
  where church_id = p_church_id and event_id = p_event_id and status = 'in_progress';

  update app_private.event_items
  set status = 'cancelled',
      cancel_reason = 'Culto encerrado antes do início da atividade'
  where church_id = p_church_id and event_id = p_event_id and status = 'pending';

  v_payload := jsonb_build_object(
    'event_id', p_event_id,
    'status', 'completed',
    'actual_end_at', clock_timestamp(),
    'version', v_new_version
  );

  insert into app_private.audit_entries (church_id, operator_user_id, action, entity_type, entity_id, payload)
  values (p_church_id, v_user_id, c_action, 'event', p_event_id, v_payload);

  insert into app_private.command_receipts (command_id, church_id, action, result_entity_id, result_payload, parameters_hash)
  values (p_command_id, p_church_id, c_action, p_event_id, v_payload, v_params_hash);

  return query select p_command_id, c_action, p_church_id, p_event_id, v_payload, clock_timestamp();
end;
$function$;

-- 2.12 Cancelar Culto / Evento (Admin ou Líder da Liturgia com motivo obrigatório)
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
  v_params_canonical text;
  v_params_hash bytea;
  v_existing_receipt record;
  v_payload jsonb;
  v_new_version integer;
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
  if char_length(v_reason_clean) < 3 or char_length(v_reason_clean) > 500 then
    raise exception 'Motivo do cancelamento deve ter entre 3 e 500 caracteres.' using errcode = '22000';
  end if;

  select ca.member_id, ca.is_admin
  into v_caller_member_id, v_is_admin
  from app_private.church_access ca
  join app_private.members m on m.id = ca.member_id and m.church_id = ca.church_id
  join app_private.churches c on c.id = ca.church_id
  where ca.user_id = v_user_id
    and ca.church_id = p_church_id
    and ca.status = 'active'
    and m.status = 'active'
    and c.status = 'active';

  if v_caller_member_id is null then
    raise exception 'Acesso não autorizado nesta igreja.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_user_id::text), hashtext(p_command_id::text));

  v_params_canonical := c_action || ':' || p_church_id::text || ':' || p_event_id::text || ':' || v_reason_clean || ':' || coalesce(p_expected_version::text, 'null');
  v_params_hash := extensions.digest(v_params_canonical, 'sha256');

  select cr.command_id, cr.action, cr.church_id, cr.result_entity_id, cr.result_payload, cr.created_at, cr.parameters_hash
  into v_existing_receipt
  from app_private.command_receipts cr
  where cr.command_id = p_command_id;

  if found then
    if v_existing_receipt.church_id <> p_church_id
       or v_existing_receipt.action <> c_action
       or v_existing_receipt.parameters_hash <> v_params_hash then
      raise exception 'Comando já executado com parâmetros divergentes ou em outro contexto.' using errcode = '23505';
    end if;

    return query select
      v_existing_receipt.command_id,
      v_existing_receipt.action,
      v_existing_receipt.church_id,
      v_existing_receipt.result_entity_id,
      v_existing_receipt.result_payload,
      v_existing_receipt.created_at;
    return;
  end if;

  select * into v_event
  from app_private.events e
  where e.church_id = p_church_id and e.id = p_event_id
  for update;

  if not found then
    raise exception 'Evento não encontrado.' using errcode = 'P0002';
  end if;

  if not v_is_admin and v_event.liturgy_leader_member_id <> v_caller_member_id then
    raise exception 'Apenas o líder da liturgia deste evento ou administradores podem cancelar o culto.' using errcode = '42501';
  end if;

  if v_event.status in ('completed', 'cancelled') then
    raise exception 'Evento já se encontra encerrado em estado terminal (%).' , v_event.status using errcode = 'P0020';
  end if;

  if p_expected_version is not null and v_event.version <> p_expected_version then
    raise exception 'Versão esperada do evento divergente da atual.' using errcode = 'P0019';
  end if;

  v_new_version := v_event.version + 1;

  update app_private.events
  set status = 'cancelled',
      cancel_reason = v_reason_clean,
      actual_end_at = clock_timestamp(),
      version = v_new_version
  where id = p_event_id and church_id = p_church_id;

  update app_private.event_items
  set status = 'cancelled',
      cancel_reason = v_reason_clean
  where church_id = p_church_id and event_id = p_event_id and status in ('pending', 'in_progress');

  v_payload := jsonb_build_object(
    'event_id', p_event_id,
    'status', 'cancelled',
    'cancel_reason', v_reason_clean,
    'version', v_new_version
  );

  insert into app_private.audit_entries (church_id, operator_user_id, action, entity_type, entity_id, payload)
  values (p_church_id, v_user_id, c_action, 'event', p_event_id, v_payload);

  insert into app_private.command_receipts (command_id, church_id, action, result_entity_id, result_payload, parameters_hash)
  values (p_command_id, p_church_id, c_action, p_event_id, v_payload, v_params_hash);

  return query select p_command_id, c_action, p_church_id, p_event_id, v_payload, clock_timestamp();
end;
$function$;

-- 2.13 Alocar Voluntário em Evento/Item (Líder da Equipe ou Liturgia/Admin)
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
security definer
set search_path = ''
set statement_timeout = '5s'
as $function$
declare
  v_user_id uuid;
  v_caller_member_id uuid;
  v_is_admin boolean;
  v_team record;
  v_event record;
  v_item record;
  v_asg_id uuid;
  v_params_canonical text;
  v_params_hash bytea;
  v_existing_receipt record;
  v_payload jsonb;
  c_action constant text := 'assign_event_participant';
begin
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if p_church_id is null or p_command_id is null or p_event_id is null or p_team_id is null or p_member_id is null then
    raise exception 'Parâmetros obrigatórios ausentes.' using errcode = '22004';
  end if;

  -- B2-03: Contexto elegível ativo
  select ca.member_id, ca.is_admin
  into v_caller_member_id, v_is_admin
  from app_private.church_access ca
  join app_private.members m on m.id = ca.member_id and m.church_id = ca.church_id
  join app_private.churches c on c.id = ca.church_id
  where ca.user_id = v_user_id
    and ca.church_id = p_church_id
    and ca.status = 'active'
    and m.status = 'active'
    and c.status = 'active';

  if v_caller_member_id is null then
    raise exception 'Acesso não autorizado nesta igreja.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_user_id::text), hashtext(p_command_id::text));

  -- B2-03: Hash completo incluindo notas
  v_params_canonical := c_action || ':' || p_church_id::text || ':' || p_event_id::text || ':' ||
                        p_team_id::text || ':' || p_member_id::text || ':' ||
                        coalesce(p_item_id::text, 'null') || ':' ||
                        coalesce(p_team_role_id::text, 'null') || ':' ||
                        coalesce(p_notes, 'null');
  v_params_hash := extensions.digest(v_params_canonical, 'sha256');

  select cr.command_id, cr.action, cr.church_id, cr.result_entity_id, cr.result_payload, cr.created_at, cr.parameters_hash
  into v_existing_receipt
  from app_private.command_receipts cr
  where cr.command_id = p_command_id;

  if found then
    if v_existing_receipt.church_id <> p_church_id
       or v_existing_receipt.action <> c_action
       or v_existing_receipt.parameters_hash <> v_params_hash then
      raise exception 'Comando já executado com parâmetros divergentes ou em outro contexto.' using errcode = '23505';
    end if;

    return query select
      v_existing_receipt.command_id,
      v_existing_receipt.action,
      v_existing_receipt.church_id,
      v_existing_receipt.result_entity_id,
      v_existing_receipt.result_payload,
      v_existing_receipt.created_at;
    return;
  end if;

  -- B2-04: Ordem global de locks:
  -- members (FOR SHARE) -> teams (FOR SHARE) -> team_memberships (FOR SHARE) -> team_roles (FOR SHARE) -> events (FOR UPDATE) -> event_items (FOR UPDATE)
  perform 1 from app_private.members m
  where m.church_id = p_church_id and m.id = p_member_id and m.status = 'active'
  for share;

  if not found then
    raise exception 'Voluntário não é membro ativo desta igreja.' using errcode = 'P0002';
  end if;

  select * into v_team
  from app_private.teams t
  where t.church_id = p_church_id and t.id = p_team_id and t.status = 'active'
  for share;

  if not found then
    raise exception 'Equipe não encontrada ou inativa.' using errcode = 'P0002';
  end if;

  -- B2-04: Exigência estrita de vínculo ativo na equipe
  if not exists (
    select 1 from app_private.team_memberships tm
    where tm.church_id = p_church_id and tm.team_id = p_team_id and tm.member_id = p_member_id and tm.status = 'active'
  ) then
    raise exception 'Membro não é integrante ativo da equipe indicada.' using errcode = 'P0020';
  end if;

  -- Se função técnica foi fornecida, exigir que seja ativa e que o membro tenha aptidão ativa homologada
  if p_team_role_id is not null then
    if not exists (
      select 1 from app_private.team_roles tr
      where tr.church_id = p_church_id and tr.team_id = p_team_id and tr.id = p_team_role_id and tr.status = 'active'
    ) then
      raise exception 'Função técnica não existe ou não está ativa nesta equipe.' using errcode = 'P0002';
    end if;

    if not exists (
      select 1 from app_private.member_qualifications mq
      where mq.church_id = p_church_id and mq.member_id = p_member_id and mq.team_role_id = p_team_role_id and mq.status = 'active'
    ) then
      raise exception 'Membro não possui aptidão ativa homologada para a função.' using errcode = 'P0020';
    end if;
  end if;

  select * into v_event
  from app_private.events e
  where e.church_id = p_church_id and e.id = p_event_id
  for update;

  if not found then
    raise exception 'Evento não encontrado.' using errcode = 'P0002';
  end if;

  if v_event.status in ('completed', 'cancelled') then
    raise exception 'Não é permitido alocar voluntário em evento encerrado ou cancelado.' using errcode = 'P0020';
  end if;

  -- Se item específico foi informado, travar item e validar fronteira de condução
  if p_item_id is not null then
    select * into v_item
    from app_private.event_items ei
    where ei.church_id = p_church_id and ei.event_id = p_event_id and ei.id = p_item_id
    for update;

    if not found then
      raise exception 'Etapa de culto não encontrada neste evento.' using errcode = 'P0002';
    end if;

    if v_item.status in ('completed', 'cancelled') then
      raise exception 'Não é permitido alocar voluntário em etapa já concluída ou cancelada.' using errcode = 'P0020';
    end if;

    if v_item.designated_team_id is not null and v_item.designated_team_id <> p_team_id then
      raise exception 'Equipe informada não corresponde à equipe designada para esta etapa.' using errcode = 'P0020';
    end if;

    -- Fronteira de condução: se a etapa já iniciou (in_progress), somente a liturgia do evento (ou admin) pode alocar
    if v_item.status = 'in_progress' then
      if not v_is_admin and v_event.liturgy_leader_member_id <> v_caller_member_id then
        raise exception 'Atividade em andamento: alocação e substituição são exclusivas do líder da liturgia.' using errcode = '42501';
      end if;
    else
      -- Se ainda pending: permitido a admin, liturgia do evento ou líder da equipe
      if not v_is_admin and v_event.liturgy_leader_member_id <> v_caller_member_id and v_team.leader_member_id <> v_caller_member_id then
        raise exception 'Apenas o líder da equipe, o líder da liturgia ou administradores podem alocar voluntários nesta etapa.' using errcode = '42501';
      end if;
    end if;
  else
    -- Sem item (escala geral do evento): se evento está em andamento, exige liturgia ou admin
    if v_event.status = 'in_progress' then
      if not v_is_admin and v_event.liturgy_leader_member_id <> v_caller_member_id then
        raise exception 'Culto em andamento: alocação é exclusiva do líder da liturgia.' using errcode = '42501';
      end if;
    else
      if not v_is_admin and v_event.liturgy_leader_member_id <> v_caller_member_id and v_team.leader_member_id <> v_caller_member_id then
        raise exception 'Apenas o líder da equipe, o líder da liturgia ou administradores podem alocar voluntários no evento.' using errcode = '42501';
      end if;
    end if;
  end if;

  -- B2-04: Checagem estrita de conflito de agenda (membro já alocado ativamente na mesma etapa/evento)
  if exists (
    select 1 from app_private.assignments a
    where a.church_id = p_church_id
      and a.event_id = p_event_id
      and a.member_id = p_member_id
      and a.status = 'active'
      and (
        (p_item_id is null and a.item_id is null)
        or (p_item_id is not null and a.item_id = p_item_id)
      )
  ) then
    raise exception 'Membro já possui alocação ativa nesta atividade do evento (conflito de escala).' using errcode = 'P0025';
  end if;

  insert into app_private.assignments (
    church_id, event_id, item_id, team_id, team_role_id, member_id, status, notes
  )
  values (
    p_church_id, p_event_id, p_item_id, p_team_id, p_team_role_id, p_member_id, 'active', btrim(p_notes)
  )
  returning id into v_asg_id;

  v_payload := jsonb_build_object(
    'assignment_id', v_asg_id,
    'event_id', p_event_id,
    'item_id', p_item_id,
    'team_id', p_team_id,
    'team_role_id', p_team_role_id,
    'member_id', p_member_id,
    'status', 'active'
  );

  insert into app_private.audit_entries (church_id, operator_user_id, action, entity_type, entity_id, payload)
  values (p_church_id, v_user_id, c_action, 'assignment', v_asg_id, v_payload);

  insert into app_private.command_receipts (command_id, church_id, action, result_entity_id, result_payload, parameters_hash)
  values (p_command_id, p_church_id, c_action, v_asg_id, v_payload, v_params_hash);

  return query select p_command_id, c_action, p_church_id, v_asg_id, v_payload, clock_timestamp();
end;
$function$;

-- 2.14 Substituir Voluntário Escalado (Líder da Equipe antes do início / Liturgia em execução)
create or replace function public.replace_event_participant(
  p_church_id uuid,
  p_command_id uuid,
  p_assignment_id uuid,
  p_replacement_member_id uuid,
  p_reason text default null,
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
security definer
set search_path = ''
set statement_timeout = '5s'
as $function$
declare
  v_user_id uuid;
  v_caller_member_id uuid;
  v_is_admin boolean;
  v_orig_asg record;
  v_event record;
  v_item record;
  v_team record;
  v_first_member uuid;
  v_second_member uuid;
  v_new_asg_id uuid;
  v_rows_updated integer;
  v_params_canonical text;
  v_params_hash bytea;
  v_existing_receipt record;
  v_payload jsonb;
  c_action constant text := 'replace_event_participant';
begin
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if p_church_id is null or p_command_id is null or p_assignment_id is null or p_replacement_member_id is null then
    raise exception 'Parâmetros obrigatórios ausentes.' using errcode = '22004';
  end if;

  -- B2-03: Contexto elegível ativo
  select ca.member_id, ca.is_admin
  into v_caller_member_id, v_is_admin
  from app_private.church_access ca
  join app_private.members m on m.id = ca.member_id and m.church_id = ca.church_id
  join app_private.churches c on c.id = ca.church_id
  where ca.user_id = v_user_id
    and ca.church_id = p_church_id
    and ca.status = 'active'
    and m.status = 'active'
    and c.status = 'active';

  if v_caller_member_id is null then
    raise exception 'Acesso não autorizado nesta igreja.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_user_id::text), hashtext(p_command_id::text));

  v_params_canonical := c_action || ':' || p_church_id::text || ':' || p_assignment_id::text || ':' ||
                        p_replacement_member_id::text || ':' ||
                        coalesce(p_reason, 'null') || ':' ||
                        coalesce(p_notes, 'null');
  v_params_hash := extensions.digest(v_params_canonical, 'sha256');

  select cr.command_id, cr.action, cr.church_id, cr.result_entity_id, cr.result_payload, cr.created_at, cr.parameters_hash
  into v_existing_receipt
  from app_private.command_receipts cr
  where cr.command_id = p_command_id;

  if found then
    if v_existing_receipt.church_id <> p_church_id
       or v_existing_receipt.action <> c_action
       or v_existing_receipt.parameters_hash <> v_params_hash then
      raise exception 'Comando já executado com parâmetros divergentes ou em outro contexto.' using errcode = '23505';
    end if;

    return query select
      v_existing_receipt.command_id,
      v_existing_receipt.action,
      v_existing_receipt.church_id,
      v_existing_receipt.result_entity_id,
      v_existing_receipt.result_payload,
      v_existing_receipt.created_at;
    return;
  end if;

  -- B2-04: Trava preliminar da alocação original para obter os membros envolvidos
  select * into v_orig_asg
  from app_private.assignments a
  where a.church_id = p_church_id and a.id = p_assignment_id
  for update;

  if not found then
    raise exception 'Alocação original não encontrada.' using errcode = 'P0002';
  end if;

  if v_orig_asg.status <> 'active' then
    raise exception 'Alocação original não está ativa ou já foi substituída/cancelada.' using errcode = 'P0020';
  end if;

  if v_orig_asg.member_id = p_replacement_member_id then
    raise exception 'O membro substituto deve ser diferente do participante atual.' using errcode = '22000';
  end if;

  -- B2-04: Ordem global de locks: members ordenados por ID asc FOR SHARE
  v_first_member := least(v_orig_asg.member_id, p_replacement_member_id);
  v_second_member := greatest(v_orig_asg.member_id, p_replacement_member_id);

  perform 1 from app_private.members m
  where m.church_id = p_church_id and m.id in (v_first_member, v_second_member) and m.status = 'active'
  order by m.id asc
  for share;

  -- Validar que o substituto é membro ativo
  if not exists (
    select 1 from app_private.members m
    where m.church_id = p_church_id and m.id = p_replacement_member_id and m.status = 'active'
  ) then
    raise exception 'Membro substituto não é membro ativo desta igreja.' using errcode = 'P0002';
  end if;

  -- Equipe da alocação
  select * into v_team
  from app_private.teams t
  where t.church_id = p_church_id and t.id = v_orig_asg.team_id and t.status = 'active'
  for share;

  if not found then
    raise exception 'Equipe da alocação não encontrada ou inativa.' using errcode = 'P0002';
  end if;

  -- B2-04: Substituto DEVE ser integrante ativo da equipe da alocação
  if not exists (
    select 1 from app_private.team_memberships tm
    where tm.church_id = p_church_id and tm.team_id = v_orig_asg.team_id and tm.member_id = p_replacement_member_id and tm.status = 'active'
  ) then
    raise exception 'Membro substituto não é integrante ativo da equipe necessária.' using errcode = 'P0020';
  end if;

  -- Se a alocação possui função técnica, substituto DEVE possuir aptidão ativa homologada
  if v_orig_asg.team_role_id is not null then
    if not exists (
      select 1 from app_private.member_qualifications mq
      where mq.church_id = p_church_id and mq.member_id = p_replacement_member_id and mq.team_role_id = v_orig_asg.team_role_id and mq.status = 'active'
    ) then
      raise exception 'Membro substituto não possui aptidão ativa homologada para a função.' using errcode = 'P0020';
    end if;
  end if;

  -- Lock no evento para atualização
  select * into v_event
  from app_private.events e
  where e.church_id = p_church_id and e.id = v_orig_asg.event_id
  for update;

  if not found or v_event.status in ('completed', 'cancelled') then
    raise exception 'Evento já se encontra encerrado ou cancelado.' using errcode = 'P0020';
  end if;

  -- B2-04: Fronteira temporal e autoridade de substituição
  if v_orig_asg.item_id is not null then
    select * into v_item
    from app_private.event_items ei
    where ei.church_id = p_church_id and ei.event_id = v_orig_asg.event_id and ei.id = v_orig_asg.item_id
    for update;

    if not found or v_item.status in ('completed', 'cancelled') then
      raise exception 'Etapa de culto já concluída ou cancelada.' using errcode = 'P0020';
    end if;

    if v_item.status = 'in_progress' then
      -- Em execução: exclusivo do líder da liturgia ou admin (PRD 7)
      if not v_is_admin and v_event.liturgy_leader_member_id <> v_caller_member_id then
        raise exception 'Atividade em andamento: substituição emergencial é exclusiva do líder da liturgia.' using errcode = '42501';
      end if;
    else
      -- Pending: permitido a admin, líder da liturgia ou líder da equipe
      if not v_is_admin and v_event.liturgy_leader_member_id <> v_caller_member_id and v_team.leader_member_id <> v_caller_member_id then
        raise exception 'Apenas o líder da equipe, o líder da liturgia ou administradores podem substituir voluntários nesta etapa.' using errcode = '42501';
      end if;
    end if;
  else
    -- Alocação geral de evento
    if v_event.status = 'in_progress' then
      if not v_is_admin and v_event.liturgy_leader_member_id <> v_caller_member_id then
        raise exception 'Culto em andamento: substituição é exclusiva do líder da liturgia.' using errcode = '42501';
      end if;
    else
      if not v_is_admin and v_event.liturgy_leader_member_id <> v_caller_member_id and v_team.leader_member_id <> v_caller_member_id then
        raise exception 'Apenas o líder da equipe, o líder da liturgia ou administradores podem substituir voluntários no evento.' using errcode = '42501';
      end if;
    end if;
  end if;

  -- B2-04: Checagem estrita de conflito de agenda do substituto
  if exists (
    select 1 from app_private.assignments a
    where a.church_id = p_church_id
      and a.event_id = v_orig_asg.event_id
      and a.member_id = p_replacement_member_id
      and a.status = 'active'
      and (
        (v_orig_asg.item_id is null and a.item_id is null)
        or (v_orig_asg.item_id is not null and a.item_id = v_orig_asg.item_id)
      )
  ) then
    raise exception 'Membro substituto já possui alocação ativa nesta atividade do evento (conflito de escala).' using errcode = 'P0025';
  end if;

  -- Gerar novo identificador de alocação
  v_new_asg_id := gen_random_uuid();

  -- B2-04: UPDATE condicional com verificação atômica de linhas afetadas (previne dupla substituição concorrente)
  update app_private.assignments
  set status = 'replaced',
      replacement_assignment_id = v_new_asg_id,
      notes = coalesce(notes, '') || ' [Substituído por motivo: ' || coalesce(p_reason, 'não informado') || ']'
  where id = p_assignment_id
    and church_id = p_church_id
    and status = 'active';

  get diagnostics v_rows_updated = row_count;
  if v_rows_updated <> 1 then
    raise exception 'Alocação original foi substituída concorrentemente ou alterada.' using errcode = 'P0020';
  end if;

  -- Inserir nova alocação ativa com referência à substituída
  insert into app_private.assignments (
    id, church_id, event_id, item_id, team_id, team_role_id, member_id, status, replaced_assignment_id, notes
  )
  values (
    v_new_asg_id, p_church_id, v_orig_asg.event_id, v_orig_asg.item_id, v_orig_asg.team_id,
    v_orig_asg.team_role_id, p_replacement_member_id, 'active', p_assignment_id, btrim(p_notes)
  );

  v_payload := jsonb_build_object(
    'assignment_id', v_new_asg_id,
    'original_assignment_id', p_assignment_id,
    'event_id', v_orig_asg.event_id,
    'item_id', v_orig_asg.item_id,
    'team_id', v_orig_asg.team_id,
    'team_role_id', v_orig_asg.team_role_id,
    'previous_member_id', v_orig_asg.member_id,
    'replacement_member_id', p_replacement_member_id,
    'reason', p_reason,
    'status', 'active'
  );

  insert into app_private.audit_entries (church_id, operator_user_id, action, entity_type, entity_id, payload)
  values (p_church_id, v_user_id, c_action, 'assignment', v_new_asg_id, v_payload);

  insert into app_private.command_receipts (command_id, church_id, action, result_entity_id, result_payload, parameters_hash)
  values (p_command_id, p_church_id, c_action, v_new_asg_id, v_payload, v_params_hash);

  return query select p_command_id, c_action, p_church_id, v_new_asg_id, v_payload, clock_timestamp();
end;
$function$;


-- =============================================================================
-- 3. Funções de Consulta / Leitura (STABLE, SECURITY DEFINER)
-- =============================================================================

-- 3.1 Listagem de Equipes da Igreja
create or replace function public.list_church_teams(p_church_id uuid)
returns table (teams jsonb)
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '5s'
as $function$
declare
  v_user_id uuid;
  v_items jsonb;
begin
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if not exists (
    select 1 from app_private.church_access ca
    where ca.church_id = p_church_id and ca.user_id = v_user_id and ca.status = 'active'
  ) then
    raise exception 'Acesso não autorizado nesta igreja.' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(item_json), '[]'::jsonb)
  into v_items
  from (
    select jsonb_build_object(
      'team_id', t.id,
      'name', t.name,
      'status', t.status,
      'version', t.version,
      'leader_member_id', t.leader_member_id,
      'leader_name', m.display_name,
      'member_count', (select count(*) from app_private.team_memberships tm where tm.church_id = p_church_id and tm.team_id = t.id and tm.status = 'active')
    ) as item_json
    from app_private.teams t
    left join app_private.members m on m.church_id = t.church_id and m.id = t.leader_member_id
    where t.church_id = p_church_id and t.status = 'active'
    order by lower(t.name) asc, t.id asc
  ) sub;

  return query select v_items;
end;
$function$;

-- 3.2 Listagem de Funções Técnicas de uma Equipe
create or replace function public.list_church_team_roles(p_church_id uuid, p_team_id uuid)
returns table (roles jsonb)
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '5s'
as $function$
declare
  v_user_id uuid;
  v_items jsonb;
begin
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if not exists (
    select 1 from app_private.church_access ca
    where ca.church_id = p_church_id and ca.user_id = v_user_id and ca.status = 'active'
  ) then
    raise exception 'Acesso não autorizado nesta igreja.' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(item_json), '[]'::jsonb)
  into v_items
  from (
    select jsonb_build_object(
      'team_role_id', tr.id,
      'team_id', tr.team_id,
      'name', tr.name,
      'description', tr.description,
      'status', tr.status
    ) as item_json
    from app_private.team_roles tr
    where tr.church_id = p_church_id and tr.team_id = p_team_id and tr.status = 'active'
    order by lower(tr.name) asc, tr.id asc
  ) sub;

  return query select v_items;
end;
$function$;

-- 3.3 Listagem de Integrantes de uma Equipe
create or replace function public.list_team_members(p_church_id uuid, p_team_id uuid)
returns table (members jsonb)
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '5s'
as $function$
declare
  v_user_id uuid;
  v_items jsonb;
begin
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if not exists (
    select 1 from app_private.church_access ca
    where ca.church_id = p_church_id and ca.user_id = v_user_id and ca.status = 'active'
  ) then
    raise exception 'Acesso não autorizado nesta igreja.' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(item_json), '[]'::jsonb)
  into v_items
  from (
    select jsonb_build_object(
      'membership_id', tm.id,
      'team_id', tm.team_id,
      'member_id', tm.member_id,
      'display_name', m.display_name,
      'status', tm.status,
      'is_team_leader', (t.leader_member_id = tm.member_id)
    ) as item_json
    from app_private.team_memberships tm
    join app_private.members m on m.church_id = tm.church_id and m.id = tm.member_id
    join app_private.teams t on t.church_id = tm.church_id and t.id = tm.team_id
    where tm.church_id = p_church_id and tm.team_id = p_team_id and tm.status = 'active'
    order by lower(m.display_name) asc, tm.id asc
  ) sub;

  return query select v_items;
end;
$function$;

-- 3.4 Listagem de Aptidões / Qualificações de um Membro
create or replace function public.list_member_qualifications(p_church_id uuid, p_member_id uuid)
returns table (qualifications jsonb)
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '5s'
as $function$
declare
  v_user_id uuid;
  v_items jsonb;
begin
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if not exists (
    select 1 from app_private.church_access ca
    where ca.church_id = p_church_id and ca.user_id = v_user_id and ca.status = 'active'
  ) then
    raise exception 'Acesso não autorizado nesta igreja.' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(item_json), '[]'::jsonb)
  into v_items
  from (
    select jsonb_build_object(
      'qualification_id', mq.id,
      'member_id', mq.member_id,
      'team_id', mq.team_id,
      'team_name', t.name,
      'team_role_id', mq.team_role_id,
      'role_name', tr.name,
      'status', mq.status
    ) as item_json
    from app_private.member_qualifications mq
    join app_private.teams t on t.church_id = mq.church_id and t.id = mq.team_id
    join app_private.team_roles tr on tr.church_id = mq.church_id and tr.id = mq.team_role_id
    where mq.church_id = p_church_id and mq.member_id = p_member_id and mq.status = 'active'
    order by lower(t.name) asc, lower(tr.name) asc
  ) sub;

  return query select v_items;
end;
$function$;

-- 3.5 Listagem de Eventos (Cronograma Macro do Produto)
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

  if not exists (
    select 1 from app_private.church_access ca
    where ca.church_id = p_church_id and ca.user_id = v_user_id and ca.status = 'active'
  ) then
    raise exception 'Acesso não autorizado nesta igreja.' using errcode = '42501';
  end if;

  v_status := lower(coalesce(trim(p_status_filter), 'all'));
  v_limit := greatest(1, least(coalesce(p_limit, 20), 100));
  v_offset := greatest(0, coalesce(p_offset, 0));

  select count(*) into v_total
  from app_private.events e
  where e.church_id = p_church_id
    and (v_status = 'all' or e.status = v_status);

  select coalesce(jsonb_agg(item_json), '[]'::jsonb)
  into v_items
  from (
    select jsonb_build_object(
      'event_id', e.id,
      'title', e.title,
      'event_type', e.event_type,
      'planned_start_at', e.planned_start_at,
      'planned_end_at', e.planned_end_at,
      'actual_start_at', e.actual_start_at,
      'actual_end_at', e.actual_end_at,
      'status', e.status,
      'version', e.version,
      'liturgy_leader_member_id', e.liturgy_leader_member_id,
      'liturgy_leader_name', m.display_name
    ) as item_json
    from app_private.events e
    left join app_private.members m on m.church_id = e.church_id and m.id = e.liturgy_leader_member_id
    where e.church_id = p_church_id
      and (v_status = 'all' or e.status = v_status)
    order by e.planned_start_at desc, e.id asc
    limit v_limit
    offset v_offset
  ) sub;

  return query select v_items, v_total;
end;
$function$;

-- 3.6 Listagem de Alocações de um Evento
create or replace function public.list_event_assignments(p_church_id uuid, p_event_id uuid)
returns table (assignments jsonb)
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '5s'
as $function$
declare
  v_user_id uuid;
  v_items jsonb;
begin
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if not exists (
    select 1 from app_private.church_access ca
    where ca.church_id = p_church_id and ca.user_id = v_user_id and ca.status = 'active'
  ) then
    raise exception 'Acesso não autorizado nesta igreja.' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(item_json), '[]'::jsonb)
  into v_items
  from (
    select jsonb_build_object(
      'assignment_id', a.id,
      'event_id', a.event_id,
      'item_id', a.item_id,
      'team_id', a.team_id,
      'team_name', t.name,
      'team_role_id', a.team_role_id,
      'role_name', tr.name,
      'member_id', a.member_id,
      'member_name', m.display_name,
      'status', a.status,
      'replaced_assignment_id', a.replaced_assignment_id,
      'replacement_assignment_id', a.replacement_assignment_id,
      'notes', a.notes
    ) as item_json
    from app_private.assignments a
    join app_private.teams t on t.church_id = a.church_id and t.id = a.team_id
    join app_private.members m on m.church_id = a.church_id and m.id = a.member_id
    left join app_private.team_roles tr on tr.church_id = a.church_id and tr.id = a.team_role_id
    where a.church_id = p_church_id and a.event_id = p_event_id
    order by a.created_at asc, a.id asc
  ) sub;

  return query select v_items;
end;
$function$;


-- =============================================================================
-- 4. Endurecimento Estrito de Permissões
-- =============================================================================

-- Revogar permissões públicas/anônimas
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

revoke all on function public.assign_event_participant(uuid, uuid, uuid, uuid, uuid, uuid, uuid, text) from public, anon, service_role;
revoke all on function public.replace_event_participant(uuid, uuid, uuid, uuid, text, text) from public, anon, service_role;

revoke all on function public.list_church_teams(uuid) from public, anon, service_role;
revoke all on function public.list_church_team_roles(uuid, uuid) from public, anon, service_role;
revoke all on function public.list_team_members(uuid, uuid) from public, anon, service_role;
revoke all on function public.list_member_qualifications(uuid, uuid) from public, anon, service_role;
revoke all on function public.list_church_events(uuid, text, integer, integer) from public, anon, service_role;
revoke all on function public.list_event_assignments(uuid, uuid) from public, anon, service_role;

-- Conceder exclusivamente ao papel authenticated
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

grant execute on function public.assign_event_participant(uuid, uuid, uuid, uuid, uuid, uuid, uuid, text) to authenticated;
grant execute on function public.replace_event_participant(uuid, uuid, uuid, uuid, text, text) to authenticated;

grant execute on function public.list_church_teams(uuid) to authenticated;
grant execute on function public.list_church_team_roles(uuid, uuid) to authenticated;
grant execute on function public.list_team_members(uuid, uuid) to authenticated;
grant execute on function public.list_member_qualifications(uuid, uuid) to authenticated;
grant execute on function public.list_church_events(uuid, text, integer, integer) to authenticated;
grant execute on function public.list_event_assignments(uuid, uuid) to authenticated;

commit;
