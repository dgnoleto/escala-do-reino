-- Escala do Reino: Incremento 015 — Fonte Real de Dependências Litúrgicas e Operacionais.
-- Cria as tabelas em app_private (teams, team_memberships, team_roles, member_qualifications,
-- events, event_items, assignments) com integridade relacional composta multi-tenant por church_id,
-- triggers monotônicos de updated_at, RLS e RPCs públicas de gestão com autorização estrita no servidor.
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

-- 1. Criação das Tabelas Operacionais com Integridade Composta em app_private

-- 1.1 Equipes / Ministérios
create table app_private.teams (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references app_private.churches(id) on delete restrict,
  name text not null,
  leader_member_id uuid,
  status text not null default 'active' check (status in ('active', 'inactive')),
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
  classification text not null default 'operational',
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint tr_name_clean check (name = btrim(name) and char_length(name) between 1 and 80),
  constraint tr_church_team_fkey
    foreign key (church_id, team_id)
    references app_private.teams(church_id, id) on delete restrict,
  constraint tr_church_team_id_unique unique (church_id, team_id, id),
  constraint tr_church_team_name_unique unique (church_id, team_id, name)
);

create trigger tr_touch_updated_at
  before update on app_private.team_roles
  for each row execute function app_private.touch_updated_at();

alter table app_private.team_roles enable row level security;

-- 1.4 Aptidões / Qualificações Homologadas dos Membros
create table app_private.member_qualifications (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null,
  member_id uuid not null,
  team_id uuid not null,
  team_role_id uuid not null,
  status text not null default 'active' check (status in ('active', 'inactive')),
  qualified_by_user_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint mq_church_member_fkey
    foreign key (church_id, member_id)
    references app_private.members(church_id, id) on delete restrict,
  constraint mq_church_team_role_fkey
    foreign key (church_id, team_id, team_role_id)
    references app_private.team_roles(church_id, team_id, id) on delete restrict,
  constraint mq_church_member_role_unique unique (church_id, member_id, team_role_id)
);

create index mq_church_member_active_idx
  on app_private.member_qualifications (church_id, member_id)
  where status = 'active';

create trigger mq_touch_updated_at
  before update on app_private.member_qualifications
  for each row execute function app_private.touch_updated_at();

alter table app_private.member_qualifications enable row level security;

-- 1.5 Eventos / Cultos
create table app_private.events (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references app_private.churches(id) on delete restrict,
  title text not null,
  event_type text not null default 'culto' check (event_type in ('culto', 'ensaio', 'reuniao', 'especial')),
  planned_start_at timestamptz not null,
  planned_end_at timestamptz not null,
  timezone text not null,
  liturgy_leader_member_id uuid,
  status text not null default 'scheduled' check (status in ('draft', 'scheduled', 'in_progress', 'completed', 'cancelled')),
  real_start_at timestamptz,
  real_end_at timestamptz,
  cancel_reason text,
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint events_title_clean check (title = btrim(title) and char_length(title) between 1 and 120),
  constraint events_time_window check (planned_end_at > planned_start_at),
  constraint events_church_id_id_unique unique (church_id, id),
  constraint events_church_liturgy_fkey
    foreign key (church_id, liturgy_leader_member_id)
    references app_private.members(church_id, id) on delete restrict
);

create index events_church_liturgy_active_idx
  on app_private.events (church_id, liturgy_leader_member_id)
  where status in ('draft', 'scheduled', 'in_progress') and liturgy_leader_member_id is not null;

create index events_church_status_planned_idx
  on app_private.events (church_id, status, planned_start_at);

create trigger events_touch_updated_at
  before update on app_private.events
  for each row execute function app_private.touch_updated_at();

alter table app_private.events enable row level security;

-- 1.6 Itens / Atividades do Evento
create table app_private.event_items (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null,
  event_id uuid not null,
  title text not null,
  sequence_order integer not null check (sequence_order >= 1),
  item_nature text not null default 'main' check (item_nature in ('main', 'parallel')),
  planned_duration_seconds integer not null default 300 check (planned_duration_seconds > 0),
  responsible_team_id uuid,
  nominal_responsible_member_id uuid,
  status text not null default 'pending' check (status in ('pending', 'in_progress', 'completed', 'cancelled')),
  real_start_at timestamptz,
  real_end_at timestamptz,
  cancel_reason text,
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint ei_title_clean check (title = btrim(title) and char_length(title) between 1 and 120),
  constraint ei_church_event_fkey
    foreign key (church_id, event_id)
    references app_private.events(church_id, id) on delete cascade,
  constraint ei_church_team_fkey
    foreign key (church_id, responsible_team_id)
    references app_private.teams(church_id, id) on delete restrict,
  constraint ei_church_nominal_resp_fkey
    foreign key (church_id, nominal_responsible_member_id)
    references app_private.members(church_id, id) on delete restrict,
  constraint ei_church_event_id_unique unique (church_id, event_id, id)
);

create index ei_church_nominal_active_idx
  on app_private.event_items (church_id, nominal_responsible_member_id)
  where status in ('pending', 'in_progress') and nominal_responsible_member_id is not null;

create trigger ei_touch_updated_at
  before update on app_private.event_items
  for each row execute function app_private.touch_updated_at();

alter table app_private.event_items enable row level security;

-- 1.7 Alocações Nominais (Escala)
create table app_private.assignments (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null,
  event_id uuid not null,
  item_id uuid,
  member_id uuid not null,
  team_id uuid not null,
  team_role_id uuid,
  status text not null default 'scheduled' check (status in ('scheduled', 'confirmed', 'absent', 'replaced', 'cancelled')),
  replaced_assignment_id uuid,
  notes text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint asg_church_event_fkey
    foreign key (church_id, event_id)
    references app_private.events(church_id, id) on delete cascade,
  constraint asg_church_event_item_fkey
    foreign key (church_id, event_id, item_id)
    references app_private.event_items(church_id, event_id, id) on delete cascade,
  constraint asg_church_member_fkey
    foreign key (church_id, member_id)
    references app_private.members(church_id, id) on delete restrict,
  constraint asg_church_team_fkey
    foreign key (church_id, team_id)
    references app_private.teams(church_id, id) on delete restrict,
  constraint asg_church_team_role_fkey
    foreign key (church_id, team_id, team_role_id)
    references app_private.team_roles(church_id, team_id, id) on delete restrict,
  constraint asg_church_id_id_unique unique (church_id, id),
  constraint asg_replaced_fkey
    foreign key (church_id, replaced_assignment_id)
    references app_private.assignments(church_id, id) on delete restrict
);

create index asg_church_member_active_idx
  on app_private.assignments (church_id, member_id, status)
  where status in ('scheduled', 'confirmed');

create trigger asg_touch_updated_at
  before update on app_private.assignments
  for each row execute function app_private.touch_updated_at();

alter table app_private.assignments enable row level security;

-- 2. Endpoints Públicos RPC (SECURITY DEFINER, search_path = '', timeout 5s)

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
  v_name_clean text;
  v_params_canonical text;
  v_params_hash bytea;
  v_existing_receipt record;
  v_team_id uuid;
  v_payload jsonb;
  v_created_at timestamptz;
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

  perform pg_advisory_xact_lock(hashtext(v_user_id::text), hashtext(p_command_id::text));

  v_params_canonical := jsonb_build_object(
    'action', 'create_church_team',
    'church_id', p_church_id::text,
    'name', v_name_clean,
    'leader_member_id', coalesce(p_leader_member_id::text, '')
  )::text;
  v_params_hash := sha256(convert_to(v_params_canonical, 'UTF8'));

  -- Prioridade do recibo (Idempotência)
  select cr.command_id, cr.action, cr.church_id, cr.params_hash, cr.result_entity_id, cr.result_payload, cr.created_at
  into v_existing_receipt
  from app_private.command_receipts cr
  where cr.user_id = v_user_id and cr.command_id = p_command_id;

  if v_existing_receipt.command_id is not null then
    if v_existing_receipt.action <> 'create_church_team' or v_existing_receipt.church_id <> p_church_id or v_existing_receipt.params_hash <> v_params_hash then
      raise exception 'Comando reutilizado com parâmetros diferentes.' using errcode = '23505';
    end if;
    return query select v_existing_receipt.command_id, v_existing_receipt.action, v_existing_receipt.church_id, v_existing_receipt.result_entity_id, v_existing_receipt.result_payload, v_existing_receipt.created_at;
    return;
  end if;

  -- Validação de Admin Operador
  if not exists (
    select 1 from app_private.church_access ca
    join auth.users u on u.id = ca.user_id
    join app_private.churches c on c.id = ca.church_id
    join app_private.members m on m.church_id = ca.church_id and m.id = ca.member_id
    where ca.church_id = p_church_id and ca.user_id = v_user_id and ca.is_admin = true and ca.status = 'active'
      and c.status = 'active' and m.status = 'active' and u.deleted_at is null
  ) then
    raise exception 'Acesso administrativo não autorizado nesta igreja.' using errcode = '42501';
  end if;

  -- Se líder indicado, valida lock FOR SHARE do membro alvo antes da mutação
  if p_leader_member_id is not null then
    if not exists (
      select 1 from app_private.members m
      where m.church_id = p_church_id and m.id = p_leader_member_id and m.status = 'active'
      for share
    ) then
      raise exception 'Líder indicado não encontrado ou inativo nesta igreja.' using errcode = 'P0002';
    end if;
  end if;

  v_team_id := gen_random_uuid();
  v_created_at := statement_timestamp();

  insert into app_private.teams (id, church_id, name, leader_member_id, status, created_at, updated_at)
  values (v_team_id, p_church_id, v_name_clean, p_leader_member_id, 'active', v_created_at, v_created_at);

  v_payload := jsonb_build_object(
    'team_id', v_team_id::text,
    'name', v_name_clean,
    'leader_member_id', coalesce(p_leader_member_id::text, null),
    'status', 'active'
  );

  insert into app_private.audit_entries (
    church_id, action, actor_user_id, actor_source, target_type, target_id, details, occurred_at
  ) values (
    p_church_id, 'create_team', v_user_id, 'application', 'team', v_team_id, v_payload, v_created_at
  );

  insert into app_private.command_receipts (
    church_id, user_id, command_id, action, params_hash, result_entity_id, result_payload
  ) values (
    p_church_id, v_user_id, p_command_id, 'create_church_team', v_params_hash, v_team_id, v_payload
  );

  return query select p_command_id, 'create_church_team'::text, p_church_id, v_team_id, v_payload, v_created_at;
end;
$function$;

-- 2.2 Designar / Transferir Liderança da Equipe (Admin)
create or replace function public.assign_team_leader(
  p_church_id uuid,
  p_command_id uuid,
  p_team_id uuid,
  p_new_leader_member_id uuid
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
  v_params_canonical text;
  v_params_hash bytea;
  v_existing_receipt record;
  v_team record;
  v_old_leader_id uuid;
  v_created_at timestamptz;
  v_payload jsonb;
begin
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if p_church_id is null or p_command_id is null or p_team_id is null or p_new_leader_member_id is null then
    raise exception 'Parâmetros obrigatórios ausentes.' using errcode = '22004';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_user_id::text), hashtext(p_command_id::text));

  v_params_canonical := jsonb_build_object(
    'action', 'assign_team_leader',
    'church_id', p_church_id::text,
    'team_id', p_team_id::text,
    'new_leader_member_id', p_new_leader_member_id::text
  )::text;
  v_params_hash := sha256(convert_to(v_params_canonical, 'UTF8'));

  select cr.command_id, cr.action, cr.church_id, cr.params_hash, cr.result_entity_id, cr.result_payload, cr.created_at
  into v_existing_receipt
  from app_private.command_receipts cr
  where cr.user_id = v_user_id and cr.command_id = p_command_id;

  if v_existing_receipt.command_id is not null then
    if v_existing_receipt.action <> 'assign_team_leader' or v_existing_receipt.church_id <> p_church_id or v_existing_receipt.params_hash <> v_params_hash then
      raise exception 'Comando reutilizado com parâmetros diferentes.' using errcode = '23505';
    end if;
    return query select v_existing_receipt.command_id, v_existing_receipt.action, v_existing_receipt.church_id, v_existing_receipt.result_entity_id, v_existing_receipt.result_payload, v_existing_receipt.created_at;
    return;
  end if;

  -- Validação Admin
  if not exists (
    select 1 from app_private.church_access ca
    join auth.users u on u.id = ca.user_id
    join app_private.churches c on c.id = ca.church_id
    join app_private.members m on m.church_id = ca.church_id and m.id = ca.member_id
    where ca.church_id = p_church_id and ca.user_id = v_user_id and ca.is_admin = true and ca.status = 'active'
      and c.status = 'active' and m.status = 'active' and u.deleted_at is null
  ) then
    raise exception 'Acesso administrativo não autorizado nesta igreja.' using errcode = '42501';
  end if;

  -- Ordem global de locks: members ANTES de teams!
  if not exists (
    select 1 from app_private.members m
    where m.church_id = p_church_id and m.id = p_new_leader_member_id and m.status = 'active'
    for share
  ) then
    raise exception 'Novo líder indicado não encontrado ou inativo nesta igreja.' using errcode = 'P0002';
  end if;

  select t.id, t.leader_member_id, t.name into v_team
  from app_private.teams t
  where t.church_id = p_church_id and t.id = p_team_id and t.status = 'active'
  for update;

  if v_team.id is null then
    raise exception 'Equipe ativa não encontrada.' using errcode = 'P0002';
  end if;

  v_old_leader_id := v_team.leader_member_id;
  v_created_at := statement_timestamp();

  update app_private.teams
  set leader_member_id = p_new_leader_member_id
  where id = p_team_id and church_id = p_church_id;

  v_payload := jsonb_build_object(
    'team_id', p_team_id::text,
    'previous_leader_member_id', coalesce(v_old_leader_id::text, null),
    'new_leader_member_id', p_new_leader_member_id::text
  );

  insert into app_private.audit_entries (
    church_id, action, actor_user_id, actor_source, target_type, target_id, details, occurred_at
  ) values (
    p_church_id, 'assign_team_leader', v_user_id, 'application', 'team', p_team_id, v_payload, v_created_at
  );

  insert into app_private.command_receipts (
    church_id, user_id, command_id, action, params_hash, result_entity_id, result_payload
  ) values (
    p_church_id, v_user_id, p_command_id, 'assign_team_leader', v_params_hash, p_team_id, v_payload
  );

  return query select p_command_id, 'assign_team_leader'::text, p_church_id, p_team_id, v_payload, v_created_at;
end;
$function$;

-- 2.3 Criar Culto / Evento (Admin OU Líder de Ministério Ativo)
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
  v_title_clean text;
  v_timezone text;
  v_is_admin boolean;
  v_is_team_leader boolean;
  v_params_canonical text;
  v_params_hash bytea;
  v_existing_receipt record;
  v_event_id uuid;
  v_created_at timestamptz;
  v_payload jsonb;
begin
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if p_church_id is null or p_command_id is null or p_title is null or p_planned_start_at is null or p_planned_end_at is null then
    raise exception 'Parâmetros obrigatórios ausentes.' using errcode = '22004';
  end if;

  if p_planned_end_at <= p_planned_start_at then
    raise exception 'Horário de término deve ser posterior ao horário de início.' using errcode = '22000';
  end if;

  v_title_clean := btrim(normalize(p_title, NFC));
  if char_length(v_title_clean) < 1 or char_length(v_title_clean) > 120 then
    raise exception 'Título do evento deve ter entre 1 e 120 caracteres.' using errcode = '22000';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_user_id::text), hashtext(p_command_id::text));

  v_params_canonical := jsonb_build_object(
    'action', 'create_church_event',
    'church_id', p_church_id::text,
    'title', v_title_clean,
    'event_type', coalesce(p_event_type, 'culto'),
    'start_at', p_planned_start_at,
    'end_at', p_planned_end_at,
    'liturgy_leader', coalesce(p_liturgy_leader_member_id::text, '')
  )::text;
  v_params_hash := sha256(convert_to(v_params_canonical, 'UTF8'));

  select cr.command_id, cr.action, cr.church_id, cr.params_hash, cr.result_entity_id, cr.result_payload, cr.created_at
  into v_existing_receipt
  from app_private.command_receipts cr
  where cr.user_id = v_user_id and cr.command_id = p_command_id;

  if v_existing_receipt.command_id is not null then
    if v_existing_receipt.action <> 'create_church_event' or v_existing_receipt.church_id <> p_church_id or v_existing_receipt.params_hash <> v_params_hash then
      raise exception 'Comando reutilizado com parâmetros diferentes.' using errcode = '23505';
    end if;
    return query select v_existing_receipt.command_id, v_existing_receipt.action, v_existing_receipt.church_id, v_existing_receipt.result_entity_id, v_existing_receipt.result_payload, v_existing_receipt.created_at;
    return;
  end if;

  -- Consulta fuso da igreja
  select c.timezone into v_timezone
  from app_private.churches c
  where c.id = p_church_id and c.status = 'active';

  if v_timezone is null then
    raise exception 'Igreja ativa não encontrada.' using errcode = 'P0002';
  end if;

  -- Autorização: Admin OU Líder de Ministério Ativo (Decisão de 16/10/2026)
  select coalesce(ca.is_admin, false) into v_is_admin
  from app_private.church_access ca
  where ca.church_id = p_church_id and ca.user_id = v_user_id and ca.status = 'active';

  select exists (
    select 1 from app_private.teams t
    join app_private.church_access ca on ca.member_id = t.leader_member_id
    where t.church_id = p_church_id and ca.user_id = v_user_id and ca.status = 'active' and t.status = 'active'
  ) into v_is_team_leader;

  if not (coalesce(v_is_admin, false) or coalesce(v_is_team_leader, false)) then
    raise exception 'Criação de evento requer perfil de Administrador ou Líder de Ministério ativo.' using errcode = '42501';
  end if;

  -- Se não for Admin (for apenas líder de equipe), designação de liturgia é PROIBIDA!
  if not coalesce(v_is_admin, false) and p_liturgy_leader_member_id is not null then
    raise exception 'Apenas administradores podem designar a liderança da liturgia.' using errcode = '42501';
  end if;

  -- Se liturgia foi indicada por admin, valida membro FOR SHARE antes de criar evento
  if p_liturgy_leader_member_id is not null then
    if not exists (
      select 1 from app_private.members m
      where m.church_id = p_church_id and m.id = p_liturgy_leader_member_id and m.status = 'active'
      for share
    ) then
      raise exception 'Líder da liturgia indicado não encontrado ou inativo nesta igreja.' using errcode = 'P0002';
    end if;
  end if;

  v_event_id := gen_random_uuid();
  v_created_at := statement_timestamp();

  insert into app_private.events (
    id, church_id, title, event_type, planned_start_at, planned_end_at, timezone,
    liturgy_leader_member_id, status, version, created_at, updated_at
  ) values (
    v_event_id, p_church_id, v_title_clean, coalesce(p_event_type, 'culto'), p_planned_start_at, p_planned_end_at,
    v_timezone, p_liturgy_leader_member_id, 'scheduled', 1, v_created_at, v_created_at
  );

  v_payload := jsonb_build_object(
    'event_id', v_event_id::text,
    'title', v_title_clean,
    'event_type', coalesce(p_event_type, 'culto'),
    'planned_start_at', p_planned_start_at,
    'planned_end_at', p_planned_end_at,
    'liturgy_leader_member_id', coalesce(p_liturgy_leader_member_id::text, null),
    'status', 'scheduled'
  );

  insert into app_private.audit_entries (
    church_id, action, actor_user_id, actor_source, target_type, target_id, details, occurred_at
  ) values (
    p_church_id, 'create_event', v_user_id, 'application', 'event', v_event_id, v_payload, v_created_at
  );

  insert into app_private.command_receipts (
    church_id, user_id, command_id, action, params_hash, result_entity_id, result_payload
  ) values (
    p_church_id, v_user_id, p_command_id, 'create_church_event', v_params_hash, v_event_id, v_payload
  );

  return query select p_command_id, 'create_church_event'::text, p_church_id, v_event_id, v_payload, v_created_at;
end;
$function$;

-- 2.4 Designar Líder da Liturgia do Culto (Exclusivo Admin)
create or replace function public.assign_event_liturgy_leader(
  p_church_id uuid,
  p_command_id uuid,
  p_event_id uuid,
  p_new_liturgy_leader_id uuid
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
  v_params_canonical text;
  v_params_hash bytea;
  v_existing_receipt record;
  v_event record;
  v_created_at timestamptz;
  v_payload jsonb;
begin
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if p_church_id is null or p_command_id is null or p_event_id is null or p_new_liturgy_leader_id is null then
    raise exception 'Parâmetros obrigatórios ausentes.' using errcode = '22004';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_user_id::text), hashtext(p_command_id::text));

  v_params_canonical := jsonb_build_object(
    'action', 'assign_event_liturgy_leader',
    'church_id', p_church_id::text,
    'event_id', p_event_id::text,
    'new_liturgy_leader_id', p_new_liturgy_leader_id::text
  )::text;
  v_params_hash := sha256(convert_to(v_params_canonical, 'UTF8'));

  select cr.command_id, cr.action, cr.church_id, cr.params_hash, cr.result_entity_id, cr.result_payload, cr.created_at
  into v_existing_receipt
  from app_private.command_receipts cr
  where cr.user_id = v_user_id and cr.command_id = p_command_id;

  if v_existing_receipt.command_id is not null then
    return query select v_existing_receipt.command_id, v_existing_receipt.action, v_existing_receipt.church_id, v_existing_receipt.result_entity_id, v_existing_receipt.result_payload, v_existing_receipt.created_at;
    return;
  end if;

  -- Validação Admin
  if not exists (
    select 1 from app_private.church_access ca
    where ca.church_id = p_church_id and ca.user_id = v_user_id and ca.is_admin = true and ca.status = 'active'
  ) then
    raise exception 'Apenas administradores podem designar a liderança da liturgia.' using errcode = '42501';
  end if;

  -- Ordem global de locks: members ANTES de events!
  if not exists (
    select 1 from app_private.members m
    where m.church_id = p_church_id and m.id = p_new_liturgy_leader_id and m.status = 'active'
    for share
  ) then
    raise exception 'Líder da liturgia indicado não encontrado ou inativo.' using errcode = 'P0002';
  end if;

  select e.id, e.status, e.version into v_event
  from app_private.events e
  where e.church_id = p_church_id and e.id = p_event_id
  for update;

  if v_event.id is null then
    raise exception 'Evento não encontrado.' using errcode = 'P0002';
  end if;

  if v_event.status in ('completed', 'cancelled') then
    raise exception 'Não é permitido alterar liturgia de evento concluído ou cancelado.' using errcode = '22000';
  end if;

  v_created_at := statement_timestamp();

  update app_private.events
  set liturgy_leader_member_id = p_new_liturgy_leader_id,
      version = version + 1
  where id = p_event_id and church_id = p_church_id;

  v_payload := jsonb_build_object(
    'event_id', p_event_id::text,
    'liturgy_leader_member_id', p_new_liturgy_leader_id::text,
    'version', v_event.version + 1
  );

  insert into app_private.audit_entries (
    church_id, action, actor_user_id, actor_source, target_type, target_id, details, occurred_at
  ) values (
    p_church_id, 'assign_liturgy_leader', v_user_id, 'application', 'event', p_event_id, v_payload, v_created_at
  );

  insert into app_private.command_receipts (
    church_id, user_id, command_id, action, params_hash, result_entity_id, result_payload
  ) values (
    p_church_id, v_user_id, p_command_id, 'assign_event_liturgy_leader', v_params_hash, p_event_id, v_payload
  );

  return query select p_command_id, 'assign_event_liturgy_leader'::text, p_church_id, p_event_id, v_payload, v_created_at;
end;
$function$;

-- 2.5 Alocar Participante / Escalar Voluntário (Líder da Equipe)
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
  v_params_canonical text;
  v_params_hash bytea;
  v_existing_receipt record;
  v_is_team_leader boolean;
  v_event record;
  v_assignment_id uuid;
  v_created_at timestamptz;
  v_payload jsonb;
begin
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if p_church_id is null or p_command_id is null or p_event_id is null or p_team_id is null or p_member_id is null then
    raise exception 'Parâmetros obrigatórios ausentes.' using errcode = '22004';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_user_id::text), hashtext(p_command_id::text));

  v_params_canonical := jsonb_build_object(
    'action', 'assign_event_participant',
    'church_id', p_church_id::text,
    'event_id', p_event_id::text,
    'team_id', p_team_id::text,
    'member_id', p_member_id::text,
    'item_id', coalesce(p_item_id::text, ''),
    'team_role_id', coalesce(p_team_role_id::text, '')
  )::text;
  v_params_hash := sha256(convert_to(v_params_canonical, 'UTF8'));

  select cr.command_id, cr.action, cr.church_id, cr.params_hash, cr.result_entity_id, cr.result_payload, cr.created_at
  into v_existing_receipt
  from app_private.command_receipts cr
  where cr.user_id = v_user_id and cr.command_id = p_command_id;

  if v_existing_receipt.command_id is not null then
    return query select v_existing_receipt.command_id, v_existing_receipt.action, v_existing_receipt.church_id, v_existing_receipt.result_entity_id, v_existing_receipt.result_payload, v_existing_receipt.created_at;
    return;
  end if;

  -- Autorização: Usuário autenticado deve ser o líder da equipe p_team_id
  select exists (
    select 1 from app_private.teams t
    join app_private.church_access ca on ca.member_id = t.leader_member_id
    where t.church_id = p_church_id and t.id = p_team_id and ca.user_id = v_user_id and ca.status = 'active' and t.status = 'active'
  ) into v_is_team_leader;

  if not v_is_team_leader then
    raise exception 'Apenas o líder responsável por esta equipe pode realizar alocações.' using errcode = '42501';
  end if;

  -- ORDEM GLOBAL DE LOCKS: members ANTES de events!
  if not exists (
    select 1 from app_private.members m
    where m.church_id = p_church_id and m.id = p_member_id and m.status = 'active'
    for share
  ) then
    raise exception 'Membro inativo ou não encontrado. Alocação recusada.' using errcode = 'P0002';
  end if;

  -- Valida aptidão ativa do membro na função (se especificada)
  if p_team_role_id is not null then
    if not exists (
      select 1 from app_private.member_qualifications mq
      where mq.church_id = p_church_id and mq.member_id = p_member_id and mq.team_id = p_team_id and mq.team_role_id = p_team_role_id and mq.status = 'active'
    ) then
      raise exception 'Membro não possui aptidão ativa homologada para esta função na equipe.' using errcode = 'P0020';
    end if;
  end if;

  -- Agora bloqueia o evento
  select e.id, e.status into v_event
  from app_private.events e
  where e.church_id = p_church_id and e.id = p_event_id
  for update;

  if v_event.id is null then
    raise exception 'Evento não encontrado.' using errcode = 'P0002';
  end if;

  if v_event.status in ('completed', 'cancelled') then
    raise exception 'Não é permitido alocar voluntários em evento já encerrado ou cancelado.' using errcode = '22000';
  end if;

  -- Se informado item_id, valida que pertence ao evento
  if p_item_id is not null then
    if not exists (
      select 1 from app_private.event_items ei
      where ei.church_id = p_church_id and ei.event_id = p_event_id and ei.id = p_item_id and ei.status in ('pending', 'in_progress')
      for update
    ) then
      raise exception 'Atividade/Item não encontrado ou já concluído neste evento.' using errcode = 'P0002';
    end if;
  end if;

  v_assignment_id := gen_random_uuid();
  v_created_at := statement_timestamp();

  insert into app_private.assignments (
    id, church_id, event_id, item_id, member_id, team_id, team_role_id, status, notes, created_at, updated_at
  ) values (
    v_assignment_id, p_church_id, p_event_id, p_item_id, p_member_id, p_team_id, p_team_role_id, 'scheduled', p_notes, v_created_at, v_created_at
  );

  v_payload := jsonb_build_object(
    'assignment_id', v_assignment_id::text,
    'event_id', p_event_id::text,
    'item_id', coalesce(p_item_id::text, null),
    'member_id', p_member_id::text,
    'team_id', p_team_id::text,
    'team_role_id', coalesce(p_team_role_id::text, null),
    'status', 'scheduled'
  );

  insert into app_private.audit_entries (
    church_id, action, actor_user_id, actor_source, target_type, target_id, details, occurred_at
  ) values (
    p_church_id, 'assign_participant', v_user_id, 'application', 'assignment', v_assignment_id, v_payload, v_created_at
  );

  insert into app_private.command_receipts (
    church_id, user_id, command_id, action, params_hash, result_entity_id, result_payload
  ) values (
    p_church_id, v_user_id, p_command_id, 'assign_event_participant', v_params_hash, v_assignment_id, v_payload
  );

  return query select p_command_id, 'assign_event_participant'::text, p_church_id, v_assignment_id, v_payload, v_created_at;
end;
$function$;

-- 2.6 Substituir Voluntário Escalado (Líder da Equipe pré-atividade vs Liturgia em execução)
create or replace function public.replace_event_participant(
  p_church_id uuid,
  p_command_id uuid,
  p_assignment_id uuid,
  p_replacement_member_id uuid,
  p_reason text
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
  v_params_canonical text;
  v_params_hash bytea;
  v_existing_receipt record;
  v_asg record;
  v_item_status text;
  v_event_status text;
  v_is_team_leader boolean;
  v_is_liturgy_leader boolean;
  v_new_assignment_id uuid;
  v_created_at timestamptz;
  v_payload jsonb;
begin
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if p_church_id is null or p_command_id is null or p_assignment_id is null or p_replacement_member_id is null then
    raise exception 'Parâmetros obrigatórios ausentes.' using errcode = '22004';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_user_id::text), hashtext(p_command_id::text));

  v_params_canonical := jsonb_build_object(
    'action', 'replace_event_participant',
    'church_id', p_church_id::text,
    'assignment_id', p_assignment_id::text,
    'replacement_member_id', p_replacement_member_id::text,
    'reason', coalesce(p_reason, '')
  )::text;
  v_params_hash := sha256(convert_to(v_params_canonical, 'UTF8'));

  select cr.command_id, cr.action, cr.church_id, cr.params_hash, cr.result_entity_id, cr.result_payload, cr.created_at
  into v_existing_receipt
  from app_private.command_receipts cr
  where cr.user_id = v_user_id and cr.command_id = p_command_id;

  if v_existing_receipt.command_id is not null then
    return query select v_existing_receipt.command_id, v_existing_receipt.action, v_existing_receipt.church_id, v_existing_receipt.result_entity_id, v_existing_receipt.result_payload, v_existing_receipt.created_at;
    return;
  end if;

  -- 1. Ordem de locks: membros envolvidos primeiro (ordenados por ID ASC)
  -- Identifica o membro atual
  select a.id, a.event_id, a.item_id, a.member_id, a.team_id, a.team_role_id, a.status
  into v_asg
  from app_private.assignments a
  where a.church_id = p_church_id and a.id = p_assignment_id;

  if v_asg.id is null or v_asg.status not in ('scheduled', 'confirmed') then
    raise exception 'Alocação ativa não encontrada para substituição.' using errcode = 'P0002';
  end if;

  -- Bloqueio determinístico ordenado dos dois membros
  perform 1 from app_private.members m
  where m.church_id = p_church_id and m.id in (v_asg.member_id, p_replacement_member_id)
  order by m.id asc
  for share;

  -- Valida substituto ativo
  if not exists (
    select 1 from app_private.members m
    where m.church_id = p_church_id and m.id = p_replacement_member_id and m.status = 'active'
  ) then
    raise exception 'Membro substituto inativo ou não encontrado.' using errcode = 'P0002';
  end if;

  -- 2. Bloqueio e inspeção do evento e item
  select e.status into v_event_status from app_private.events e where e.id = v_asg.event_id for update;

  if v_asg.item_id is not null then
    select ei.status into v_item_status from app_private.event_items ei where ei.id = v_asg.item_id for update;
  else
    v_item_status := v_event_status;
  end if;

  -- 3. Fronteira Temporal de Autorização
  select exists (
    select 1 from app_private.teams t
    join app_private.church_access ca on ca.member_id = t.leader_member_id
    where t.church_id = p_church_id and t.id = v_asg.team_id and ca.user_id = v_user_id and ca.status = 'active' and t.status = 'active'
  ) into v_is_team_leader;

  select exists (
    select 1 from app_private.events e
    join app_private.church_access ca on ca.member_id = e.liturgy_leader_member_id
    where e.church_id = p_church_id and e.id = v_asg.event_id and ca.user_id = v_user_id and ca.status = 'active'
  ) into v_is_liturgy_leader;

  if v_item_status = 'pending' then
    if not v_is_team_leader then
      raise exception 'Substituição antes do início da atividade requer liderança da respectiva equipe.' using errcode = '42501';
    end if;
  elsif v_item_status = 'in_progress' then
    if not v_is_liturgy_leader then
      raise exception 'Substituição durante execução física da atividade é prerrogativa exclusiva do Líder da Liturgia.' using errcode = '42501';
    end if;
  else
    raise exception 'Não é permitido substituir voluntário em atividade já concluída ou cancelada.' using errcode = '22000';
  end if;

  v_new_assignment_id := gen_random_uuid();
  v_created_at := statement_timestamp();

  -- Atualiza anterior como substituído
  update app_private.assignments
  set status = 'replaced', updated_at = v_created_at
  where id = p_assignment_id and church_id = p_church_id;

  -- Insere nova alocação vinculada
  insert into app_private.assignments (
    id, church_id, event_id, item_id, member_id, team_id, team_role_id, status, replaced_assignment_id, notes, created_at, updated_at
  ) values (
    v_new_assignment_id, p_church_id, v_asg.event_id, v_asg.item_id, p_replacement_member_id, v_asg.team_id, v_asg.team_role_id, 'scheduled', p_assignment_id, p_reason, v_created_at, v_created_at
  );

  v_payload := jsonb_build_object(
    'original_assignment_id', p_assignment_id::text,
    'replaced_member_id', v_asg.member_id::text,
    'replacement_assignment_id', v_new_assignment_id::text,
    'replacement_member_id', p_replacement_member_id::text,
    'reason', p_reason
  );

  insert into app_private.audit_entries (
    church_id, action, actor_user_id, actor_source, target_type, target_id, details, occurred_at
  ) values (
    p_church_id, 'replace_participant', v_user_id, 'application', 'assignment', v_new_assignment_id, v_payload, v_created_at
  );

  insert into app_private.command_receipts (
    church_id, user_id, command_id, action, params_hash, result_entity_id, result_payload
  ) values (
    p_church_id, v_user_id, p_command_id, 'replace_event_participant', v_params_hash, v_new_assignment_id, v_payload
  );

  return query select p_command_id, 'replace_event_participant'::text, p_church_id, v_new_assignment_id, v_payload, v_created_at;
end;
$function$;

-- 2.7 Concluir Culto / Evento (Líder da Liturgia)
create or replace function public.finish_event_service(
  p_church_id uuid,
  p_command_id uuid,
  p_event_id uuid
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
  v_params_canonical text;
  v_params_hash bytea;
  v_existing_receipt record;
  v_event record;
  v_created_at timestamptz;
  v_payload jsonb;
begin
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if p_church_id is null or p_command_id is null or p_event_id is null then
    raise exception 'Parâmetros obrigatórios ausentes.' using errcode = '22004';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_user_id::text), hashtext(p_command_id::text));

  v_params_canonical := jsonb_build_object(
    'action', 'finish_event_service',
    'church_id', p_church_id::text,
    'event_id', p_event_id::text
  )::text;
  v_params_hash := sha256(convert_to(v_params_canonical, 'UTF8'));

  select cr.command_id, cr.action, cr.church_id, cr.params_hash, cr.result_entity_id, cr.result_payload, cr.created_at
  into v_existing_receipt
  from app_private.command_receipts cr
  where cr.user_id = v_user_id and cr.command_id = p_command_id;

  if v_existing_receipt.command_id is not null then
    return query select v_existing_receipt.command_id, v_existing_receipt.action, v_existing_receipt.church_id, v_existing_receipt.result_entity_id, v_existing_receipt.result_payload, v_existing_receipt.created_at;
    return;
  end if;

  -- Validação: Usuário deve ser o líder da liturgia do evento
  if not exists (
    select 1 from app_private.events e
    join app_private.church_access ca on ca.member_id = e.liturgy_leader_member_id
    where e.church_id = p_church_id and e.id = p_event_id and ca.user_id = v_user_id and ca.status = 'active'
  ) then
    raise exception 'Apenas o Líder da Liturgia designado para este evento pode encerrá-lo.' using errcode = '42501';
  end if;

  select e.id, e.status, e.version into v_event
  from app_private.events e
  where e.church_id = p_church_id and e.id = p_event_id
  for update;

  if v_event.id is null then
    raise exception 'Evento não encontrado.' using errcode = 'P0002';
  end if;

  if v_event.status = 'completed' then
    raise exception 'Evento já se encontra encerrado.' using errcode = 'P0019';
  end if;

  v_created_at := statement_timestamp();

  update app_private.events
  set status = 'completed',
      real_end_at = v_created_at,
      version = version + 1
  where id = p_event_id and church_id = p_church_id;

  -- Conclui atividades abertas associadas
  update app_private.event_items
  set status = 'completed', real_end_at = coalesce(real_end_at, v_created_at)
  where church_id = p_church_id and event_id = p_event_id and status in ('pending', 'in_progress');

  v_payload := jsonb_build_object(
    'event_id', p_event_id::text,
    'status', 'completed',
    'real_end_at', v_created_at
  );

  insert into app_private.audit_entries (
    church_id, action, actor_user_id, actor_source, target_type, target_id, details, occurred_at
  ) values (
    p_church_id, 'finish_event', v_user_id, 'application', 'event', p_event_id, v_payload, v_created_at
  );

  insert into app_private.command_receipts (
    church_id, user_id, command_id, action, params_hash, result_entity_id, result_payload
  ) values (
    p_church_id, v_user_id, p_command_id, 'finish_event_service', v_params_hash, p_event_id, v_payload
  );

  return query select p_command_id, 'finish_event_service'::text, p_church_id, p_event_id, v_payload, v_created_at;
end;
$function$;

-- 2.8 Listagem de Equipes (Consulta de Produto)
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

-- 2.9 Listagem de Eventos (Cronograma Macro do Produto)
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
      'status', e.status,
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

-- 3. Endurecimento de Permissões
revoke all on function public.create_church_team(uuid, uuid, text, uuid) from public, anon, service_role;
grant execute on function public.create_church_team(uuid, uuid, text, uuid) to authenticated;

revoke all on function public.assign_team_leader(uuid, uuid, uuid, uuid) from public, anon, service_role;
grant execute on function public.assign_team_leader(uuid, uuid, uuid, uuid) to authenticated;

revoke all on function public.create_church_event(uuid, uuid, text, text, timestamptz, timestamptz, uuid) from public, anon, service_role;
grant execute on function public.create_church_event(uuid, uuid, text, text, timestamptz, timestamptz, uuid) to authenticated;

revoke all on function public.assign_event_liturgy_leader(uuid, uuid, uuid, uuid) from public, anon, service_role;
grant execute on function public.assign_event_liturgy_leader(uuid, uuid, uuid, uuid) to authenticated;

revoke all on function public.assign_event_participant(uuid, uuid, uuid, uuid, uuid, uuid, uuid, text) from public, anon, service_role;
grant execute on function public.assign_event_participant(uuid, uuid, uuid, uuid, uuid, uuid, uuid, text) to authenticated;

revoke all on function public.replace_event_participant(uuid, uuid, uuid, uuid, text) from public, anon, service_role;
grant execute on function public.replace_event_participant(uuid, uuid, uuid, uuid, text) to authenticated;

revoke all on function public.finish_event_service(uuid, uuid, uuid) from public, anon, service_role;
grant execute on function public.finish_event_service(uuid, uuid, uuid) to authenticated;

revoke all on function public.list_church_teams(uuid) from public, anon, service_role;
grant execute on function public.list_church_teams(uuid) to authenticated;

revoke all on function public.list_church_events(uuid, text, integer, integer) from public, anon, service_role;
grant execute on function public.list_church_events(uuid, text, integer, integer) to authenticated;

commit;
