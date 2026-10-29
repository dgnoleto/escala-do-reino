-- Candidato 021: Cadastro e Manutenção de Tipos de Evento e Atividades com Durações Padrão (Issue #25)
-- Cobre critérios CA01 a CA04 e refinamento normativo.
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
    or to_regprocedure('app_private.has_church_settings_access(uuid, boolean)') is null then
    raise exception 'Estrutura base de igrejas, acessos e auditoria (001-020) obrigatória.';
  end if;

  if to_regclass('app_private.event_types') is not null then
    raise exception 'Tabela app_private.event_types já existente. Parar e conferir.';
  end if;

  if to_regclass('app_private.standard_activities') is not null then
    raise exception 'Tabela app_private.standard_activities já existente. Parar e conferir.';
  end if;
end;
$preflight$;

-- 1. Tabela de Tipos de Evento com isolamento por igreja
create table app_private.event_types (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references app_private.churches(id) on delete restrict,
  name text not null,
  description text,
  active boolean not null default true,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint et_name_clean check (name = btrim(name) and char_length(name) between 1 and 100),
  constraint et_desc_clean check (description is null or (description = btrim(description) and char_length(description) <= 255)),
  constraint et_church_id_id_unique unique (church_id, id)
);

create unique index et_church_id_name_unique
  on app_private.event_types (church_id, lower(name));

create index et_church_active_idx
  on app_private.event_types (church_id, active, name);

create trigger et_touch_updated_at
  before update on app_private.event_types
  for each row execute function app_private.touch_updated_at();

alter table app_private.event_types enable row level security;
revoke all on app_private.event_types from public, anon, authenticated, service_role;

-- 2. Tabela de Atividades Padrão com Durações Padrão Configuráveis (CA02)
create table app_private.standard_activities (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references app_private.churches(id) on delete restrict,
  name text not null,
  default_duration_minutes integer not null,
  category text,
  description text,
  active boolean not null default true,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint sa_name_clean check (name = btrim(name) and char_length(name) between 1 and 100),
  constraint sa_duration_range check (default_duration_minutes between 1 and 720),
  constraint sa_cat_clean check (category is null or (category = btrim(category) and char_length(category) <= 50)),
  constraint sa_desc_clean check (description is null or (description = btrim(description) and char_length(description) <= 255)),
  constraint sa_church_id_id_unique unique (church_id, id)
);

create unique index sa_church_id_name_unique
  on app_private.standard_activities (church_id, lower(name));

create index sa_church_active_idx
  on app_private.standard_activities (church_id, active, name);

create trigger sa_touch_updated_at
  before update on app_private.standard_activities
  for each row execute function app_private.touch_updated_at();

alter table app_private.standard_activities enable row level security;
revoke all on app_private.standard_activities from public, anon, authenticated, service_role;

-- 3. Tabela de Recibos de Comandos para Idempotência (Tipos e Atividades)
create table app_private.event_type_activity_receipts (
  user_id uuid not null references auth.users(id) on delete restrict,
  command_id uuid not null,
  church_id uuid not null references app_private.churches(id) on delete restrict,
  action text not null,
  params jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default statement_timestamp(),
  primary key (user_id, command_id)
);

alter table app_private.event_type_activity_receipts enable row level security;
revoke all on app_private.event_type_activity_receipts from public, anon, authenticated, service_role;

-- 4. Funções auxiliares para verificar referências históricas demonstradas (CA03)
create or replace function app_private.is_event_type_used(p_church_id uuid, p_type_id uuid, p_type_name text)
returns boolean
language plpgsql stable security definer set search_path = '' set statement_timeout = '5s'
as $function$
declare
  v_used boolean := false;
  v_current_name text;
begin
  -- 1. Referência estável direta por UUID (ex.: modelos de culto de 022, se instalados)
  if to_regclass('app_private.service_templates') is not null then
    execute 'select exists (
      select 1 from app_private.service_templates st
      where st.church_id = $1 and st.event_type_id = $2
    )' into v_used using p_church_id, p_type_id;
    if v_used then return true; end if;
  end if;

  -- 2. Obter nome atual do cadastro
  select et.name
  into v_current_name
  from app_private.event_types et
  where et.id = p_type_id and et.church_id = p_church_id;

  if v_current_name is null then
    v_current_name := p_type_name;
  end if;

  -- 3. Verificação de eventos históricos (cobre nome atual e nomes anteriores demonstrados em auditoria)
  if to_regclass('app_private.events') is not null then
    if to_regclass('app_private.audit_entries') is not null then
      select exists (
        select 1
        from app_private.events e
        join (
          select lower(btrim(coalesce(v_current_name, p_type_name))) as name_clean
          union
          select lower(btrim(a.details->>'name'))
          from app_private.audit_entries a
          where a.church_id = p_church_id
            and a.target_type = 'event_type'
            and a.target_id = p_type_id
            and a.action in ('create_event_type', 'update_event_type', 'deactivate_event_type', 'activate_event_type')
            and a.details->>'name' is not null
            and btrim(a.details->>'name') <> ''
          union
          select lower(btrim(a.details->>'previous_name'))
          from app_private.audit_entries a
          where a.church_id = p_church_id
            and a.target_type = 'event_type'
            and a.target_id = p_type_id
            and a.action = 'update_event_type'
            and a.details->>'previous_name' is not null
            and btrim(a.details->>'previous_name') <> ''
          union
          select lower(btrim(a.details->>'new_name'))
          from app_private.audit_entries a
          where a.church_id = p_church_id
            and a.target_type = 'event_type'
            and a.target_id = p_type_id
            and a.action = 'update_event_type'
            and a.details->>'new_name' is not null
            and btrim(a.details->>'new_name') <> ''
        ) n on (
          lower(btrim(e.event_type)) = n.name_clean
          or lower(btrim(e.title)) = n.name_clean
        )
        where e.church_id = p_church_id
      ) into v_used;
      if v_used then return true; end if;
    else
      select exists (
        select 1 from app_private.events e
        where e.church_id = p_church_id
          and (
            lower(btrim(e.event_type)) = lower(btrim(coalesce(v_current_name, p_type_name)))
            or lower(btrim(e.title)) = lower(btrim(coalesce(v_current_name, p_type_name)))
          )
      ) into v_used;
      if v_used then return true; end if;
    end if;
  end if;

  return false;
end;
$function$;
revoke all on function app_private.is_event_type_used(uuid, uuid, text) from public, anon, authenticated, service_role;

create or replace function app_private.is_standard_activity_used(p_church_id uuid, p_activity_id uuid, p_activity_name text)
returns boolean
language plpgsql stable security definer set search_path = '' set statement_timeout = '5s'
as $function$
declare
  v_used boolean := false;
  v_current_name text;
begin
  -- 1. Referência estável direta por UUID (ex.: atividades de modelos de culto de 022, se instaladas)
  if to_regclass('app_private.service_template_activities') is not null then
    execute 'select exists (
      select 1 from app_private.service_template_activities sta
      where sta.church_id = $1 and sta.standard_activity_id = $2
    )' into v_used using p_church_id, p_activity_id;
    if v_used then return true; end if;
  end if;

  -- 2. Obter nome atual do cadastro
  select sa.name
  into v_current_name
  from app_private.standard_activities sa
  where sa.id = p_activity_id and sa.church_id = p_church_id;

  if v_current_name is null then
    v_current_name := p_activity_name;
  end if;

  -- 3. Verificação de itens de cronograma históricos (cobre nome atual e nomes anteriores demonstrados em auditoria)
  if to_regclass('app_private.event_items') is not null then
    if to_regclass('app_private.audit_entries') is not null then
      select exists (
        select 1
        from app_private.event_items ei
        join (
          select lower(btrim(coalesce(v_current_name, p_activity_name))) as name_clean
          union
          select lower(btrim(a.details->>'name'))
          from app_private.audit_entries a
          where a.church_id = p_church_id
            and a.target_type = 'standard_activity'
            and a.target_id = p_activity_id
            and a.action in ('create_standard_activity', 'update_standard_activity', 'deactivate_standard_activity', 'activate_standard_activity')
            and a.details->>'name' is not null
            and btrim(a.details->>'name') <> ''
          union
          select lower(btrim(a.details->>'previous_name'))
          from app_private.audit_entries a
          where a.church_id = p_church_id
            and a.target_type = 'standard_activity'
            and a.target_id = p_activity_id
            and a.action = 'update_standard_activity'
            and a.details->>'previous_name' is not null
            and btrim(a.details->>'previous_name') <> ''
          union
          select lower(btrim(a.details->>'new_name'))
          from app_private.audit_entries a
          where a.church_id = p_church_id
            and a.target_type = 'standard_activity'
            and a.target_id = p_activity_id
            and a.action = 'update_standard_activity'
            and a.details->>'new_name' is not null
            and btrim(a.details->>'new_name') <> ''
        ) n on lower(btrim(ei.title)) = n.name_clean
        where ei.church_id = p_church_id
      ) into v_used;
      if v_used then return true; end if;
    else
      select exists (
        select 1 from app_private.event_items ei
        where ei.church_id = p_church_id
          and lower(btrim(ei.title)) = lower(btrim(coalesce(v_current_name, p_activity_name)))
      ) into v_used;
      if v_used then return true; end if;
    end if;
  end if;

  return false;
end;
$function$;
revoke all on function app_private.is_standard_activity_used(uuid, uuid, text) from public, anon, authenticated, service_role;

-- 5. RPCs: Tipos de Evento

-- Consulta
create or replace function public.list_event_types(
  p_church_id uuid,
  p_only_active boolean default false
)
returns table(
  id uuid,
  name text,
  description text,
  active boolean,
  used_in_history boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql stable security definer set search_path = '' set statement_timeout = '5s'
as $function$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if not app_private.has_church_settings_access(p_church_id, false) then
    raise exception 'Acesso negado à igreja especificada.' using errcode = '42501';
  end if;

  return query
  select
    et.id,
    et.name,
    et.description,
    et.active,
    app_private.is_event_type_used(p_church_id, et.id, et.name) as used_in_history,
    et.created_at,
    et.updated_at
  from app_private.event_types et
  where et.church_id = p_church_id
    and (not p_only_active or et.active = true)
  order by et.active desc, et.name asc;
end;
$function$;

-- Cadastro
create or replace function public.create_event_type(
  p_command_id uuid,
  p_church_id uuid,
  p_name text,
  p_description text default null
)
returns jsonb
language plpgsql security definer set search_path = '' set statement_timeout = '5s'
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_clean_name text;
  v_clean_desc text;
  v_new_id uuid;
  v_receipt app_private.event_type_activity_receipts%rowtype;
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if p_command_id is null then
    raise exception 'command_id obrigatório.' using errcode = '22023';
  end if;

  select * into v_receipt from app_private.event_type_activity_receipts
  where user_id = v_uid and command_id = p_command_id;
  if found then
    return v_receipt.result;
  end if;

  if not app_private.has_church_settings_access(p_church_id, true) then
    raise exception 'Permissão insuficiente. Apenas administradores podem cadastrar tipos de evento.' using errcode = '42501';
  end if;

  v_clean_name := normalize(btrim(coalesce(p_name, '')), NFC);
  if char_length(v_clean_name) < 1 or char_length(v_clean_name) > 100 then
    raise exception 'Nome do tipo de evento deve ter entre 1 e 100 caracteres.' using errcode = '23514';
  end if;

  v_clean_desc := null;
  if p_description is not null and btrim(p_description) <> '' then
    v_clean_desc := normalize(btrim(p_description), NFC);
    if char_length(v_clean_desc) > 255 then
      raise exception 'Descrição deve ter no máximo 255 caracteres.' using errcode = '23514';
    end if;
  end if;

  insert into app_private.event_types (church_id, name, description, active)
  values (p_church_id, v_clean_name, v_clean_desc, true)
  returning id into v_new_id;

  insert into app_private.audit_entries (church_id, action, actor_user_id, actor_source, target_type, target_id, details)
  values (
    p_church_id,
    'create_event_type',
    v_uid,
    'application',
    'event_type',
    v_new_id,
    jsonb_build_object('event_type_id', v_new_id, 'name', v_clean_name, 'description', v_clean_desc)
  );

  v_result := jsonb_build_object(
    'status', 'ok',
    'id', v_new_id,
    'name', v_clean_name,
    'description', v_clean_desc,
    'active', true
  );

  insert into app_private.event_type_activity_receipts (user_id, command_id, church_id, action, params, result)
  values (
    v_uid,
    p_command_id,
    p_church_id,
    'create_event_type',
    jsonb_build_object('name', v_clean_name, 'description', v_clean_desc),
    v_result
  );

  return v_result;
end;
$function$;

-- Edição
create or replace function public.update_event_type(
  p_command_id uuid,
  p_church_id uuid,
  p_type_id uuid,
  p_name text,
  p_description text default null
)
returns jsonb
language plpgsql security definer set search_path = '' set statement_timeout = '5s'
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_clean_name text;
  v_clean_desc text;
  v_old_name text;
  v_old_desc text;
  v_receipt app_private.event_type_activity_receipts%rowtype;
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if p_command_id is null or p_type_id is null then
    raise exception 'command_id e type_id obrigatórios.' using errcode = '22023';
  end if;

  select * into v_receipt from app_private.event_type_activity_receipts
  where user_id = v_uid and command_id = p_command_id;
  if found then
    return v_receipt.result;
  end if;

  if not app_private.has_church_settings_access(p_church_id, true) then
    raise exception 'Permissão insuficiente. Apenas administradores podem alterar tipos de evento.' using errcode = '42501';
  end if;

  v_clean_name := normalize(btrim(coalesce(p_name, '')), NFC);
  if char_length(v_clean_name) < 1 or char_length(v_clean_name) > 100 then
    raise exception 'Nome do tipo de evento deve ter entre 1 e 100 caracteres.' using errcode = '23514';
  end if;

  v_clean_desc := null;
  if p_description is not null and btrim(p_description) <> '' then
    v_clean_desc := normalize(btrim(p_description), NFC);
    if char_length(v_clean_desc) > 255 then
      raise exception 'Descrição deve ter no máximo 255 caracteres.' using errcode = '23514';
    end if;
  end if;

  select name, description into v_old_name, v_old_desc
  from app_private.event_types
  where id = p_type_id and church_id = p_church_id;

  if not found then
    raise exception 'Tipo de evento não encontrado.' using errcode = 'P0002';
  end if;

  update app_private.event_types
  set name = v_clean_name,
      description = v_clean_desc
  where id = p_type_id and church_id = p_church_id;

  insert into app_private.audit_entries (church_id, action, actor_user_id, actor_source, target_type, target_id, details)
  values (
    p_church_id,
    'update_event_type',
    v_uid,
    'application',
    'event_type',
    p_type_id,
    jsonb_build_object(
      'event_type_id', p_type_id,
      'previous_name', v_old_name,
      'new_name', v_clean_name,
      'previous_description', v_old_desc,
      'new_description', v_clean_desc
    )
  );

  v_result := jsonb_build_object(
    'status', 'ok',
    'id', p_type_id,
    'name', v_clean_name,
    'description', v_clean_desc
  );

  insert into app_private.event_type_activity_receipts (user_id, command_id, church_id, action, params, result)
  values (
    v_uid,
    p_command_id,
    p_church_id,
    'update_event_type',
    jsonb_build_object('type_id', p_type_id, 'name', v_clean_name, 'description', v_clean_desc),
    v_result
  );

  return v_result;
end;
$function$;

-- Inativação / Reativação
create or replace function public.toggle_event_type_status(
  p_command_id uuid,
  p_church_id uuid,
  p_type_id uuid
)
returns jsonb
language plpgsql security definer set search_path = '' set statement_timeout = '5s'
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_current_active boolean;
  v_name text;
  v_receipt app_private.event_type_activity_receipts%rowtype;
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if p_command_id is null or p_type_id is null then
    raise exception 'command_id e type_id obrigatórios.' using errcode = '22023';
  end if;

  select * into v_receipt from app_private.event_type_activity_receipts
  where user_id = v_uid and command_id = p_command_id;
  if found then
    return v_receipt.result;
  end if;

  if not app_private.has_church_settings_access(p_church_id, true) then
    raise exception 'Permissão insuficiente. Apenas administradores podem alterar o status de tipos de evento.' using errcode = '42501';
  end if;

  select active, name into v_current_active, v_name
  from app_private.event_types
  where id = p_type_id and church_id = p_church_id;

  if not found then
    raise exception 'Tipo de evento não encontrado.' using errcode = 'P0002';
  end if;

  update app_private.event_types
  set active = not v_current_active
  where id = p_type_id and church_id = p_church_id;

  insert into app_private.audit_entries (church_id, action, actor_user_id, actor_source, target_type, target_id, details)
  values (
    p_church_id,
    case when not v_current_active then 'activate_event_type' else 'deactivate_event_type' end,
    v_uid,
    'application',
    'event_type',
    p_type_id,
    jsonb_build_object('event_type_id', p_type_id, 'name', v_name, 'active', not v_current_active)
  );

  v_result := jsonb_build_object(
    'status', 'ok',
    'id', p_type_id,
    'name', v_name,
    'active', not v_current_active
  );

  insert into app_private.event_type_activity_receipts (user_id, command_id, church_id, action, params, result)
  values (
    v_uid,
    p_command_id,
    p_church_id,
    'toggle_event_type_status',
    jsonb_build_object('type_id', p_type_id, 'active', not v_current_active),
    v_result
  );

  return v_result;
end;
$function$;

-- Exclusão física (com guarda de integridade histórica)
create or replace function public.delete_event_type(
  p_command_id uuid,
  p_church_id uuid,
  p_type_id uuid
)
returns jsonb
language plpgsql security definer set search_path = '' set statement_timeout = '5s'
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_name text;
  v_receipt app_private.event_type_activity_receipts%rowtype;
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if p_command_id is null or p_type_id is null then
    raise exception 'command_id e type_id obrigatórios.' using errcode = '22023';
  end if;

  if not app_private.has_church_settings_access(p_church_id, true) then
    raise exception 'Permissão insuficiente. Apenas administradores podem excluir tipos de evento.' using errcode = '42501';
  end if;

  select * into v_receipt from app_private.event_type_activity_receipts
  where user_id = v_uid and command_id = p_command_id;
  if found then
    -- Aceita replay somente se corresponder à mesma igreja, ação e alvo, com parâmetros compatíveis
    -- e resultado coerente de exclusão concluída. Recibos de criação, edição, outra igreja ou outro
    -- alvo não podem produzir sucesso de exclusão.
    if v_receipt.church_id = p_church_id
       and v_receipt.action = 'delete_event_type'
       and (v_receipt.params->>'type_id')::uuid = p_type_id
       and v_receipt.result->>'status' = 'ok'
       and (v_receipt.result->>'deleted')::boolean is true
    then
      return v_receipt.result;
    end if;

    raise exception 'Conflito de command_id: identificador já utilizado para outra operação.' using errcode = '23505';
  end if;

  select name into v_name
  from app_private.event_types
  where id = p_type_id and church_id = p_church_id;

  if not found then
    raise exception 'Tipo de evento não encontrado.' using errcode = 'P0002';
  end if;

  if app_private.is_event_type_used(p_church_id, p_type_id, v_name) then
    raise exception 'Este tipo de evento já foi utilizado em cultos históricos e não pode ser excluído fisicamente. Desative-o para que não seja mais selecionado em novos planejamentos.' using errcode = '23503';
  end if;

  -- Contenção explícita no servidor: enquanto os dados existentes não permitirem
  -- comprovar desuso global, a exclusão física fica contida no servidor; a desativação permanece disponível.
  raise exception 'Não é possível comprovar ausência de uso histórico para exclusão física deste tipo de evento. Desative-o para que não seja mais selecionado em novos planejamentos.' using errcode = '23503';
end;
$function$;

-- 6. RPCs: Atividades Padrão

-- Consulta
create or replace function public.list_standard_activities(
  p_church_id uuid,
  p_only_active boolean default false
)
returns table(
  id uuid,
  name text,
  default_duration_minutes integer,
  category text,
  description text,
  active boolean,
  used_in_history boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql stable security definer set search_path = '' set statement_timeout = '5s'
as $function$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if not app_private.has_church_settings_access(p_church_id, false) then
    raise exception 'Acesso negado à igreja especificada.' using errcode = '42501';
  end if;

  return query
  select
    sa.id,
    sa.name,
    sa.default_duration_minutes,
    sa.category,
    sa.description,
    sa.active,
    app_private.is_standard_activity_used(p_church_id, sa.id, sa.name) as used_in_history,
    sa.created_at,
    sa.updated_at
  from app_private.standard_activities sa
  where sa.church_id = p_church_id
    and (not p_only_active or sa.active = true)
  order by sa.active desc, sa.name asc;
end;
$function$;

-- Cadastro
create or replace function public.create_standard_activity(
  p_command_id uuid,
  p_church_id uuid,
  p_name text,
  p_default_duration_minutes integer,
  p_category text default null,
  p_description text default null
)
returns jsonb
language plpgsql security definer set search_path = '' set statement_timeout = '5s'
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_clean_name text;
  v_clean_cat text;
  v_clean_desc text;
  v_new_id uuid;
  v_receipt app_private.event_type_activity_receipts%rowtype;
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if p_command_id is null then
    raise exception 'command_id obrigatório.' using errcode = '22023';
  end if;

  select * into v_receipt from app_private.event_type_activity_receipts
  where user_id = v_uid and command_id = p_command_id;
  if found then
    return v_receipt.result;
  end if;

  if not app_private.has_church_settings_access(p_church_id, true) then
    raise exception 'Permissão insuficiente. Apenas administradores podem cadastrar atividades padrão.' using errcode = '42501';
  end if;

  v_clean_name := normalize(btrim(coalesce(p_name, '')), NFC);
  if char_length(v_clean_name) < 1 or char_length(v_clean_name) > 100 then
    raise exception 'Nome da atividade padrão deve ter entre 1 e 100 caracteres.' using errcode = '23514';
  end if;

  if p_default_duration_minutes is null or p_default_duration_minutes < 1 or p_default_duration_minutes > 720 then
    raise exception 'Duração padrão deve ser um número inteiro entre 1 e 720 minutos.' using errcode = '23514';
  end if;

  v_clean_cat := null;
  if p_category is not null and btrim(p_category) <> '' then
    v_clean_cat := normalize(btrim(p_category), NFC);
    if char_length(v_clean_cat) > 50 then
      raise exception 'Categoria deve ter no máximo 50 caracteres.' using errcode = '23514';
    end if;
  end if;

  v_clean_desc := null;
  if p_description is not null and btrim(p_description) <> '' then
    v_clean_desc := normalize(btrim(p_description), NFC);
    if char_length(v_clean_desc) > 255 then
      raise exception 'Descrição deve ter no máximo 255 caracteres.' using errcode = '23514';
    end if;
  end if;

  insert into app_private.standard_activities (
    church_id,
    name,
    default_duration_minutes,
    category,
    description,
    active
  )
  values (
    p_church_id,
    v_clean_name,
    p_default_duration_minutes,
    v_clean_cat,
    v_clean_desc,
    true
  )
  returning id into v_new_id;

  insert into app_private.audit_entries (church_id, action, actor_user_id, actor_source, target_type, target_id, details)
  values (
    p_church_id,
    'create_standard_activity',
    v_uid,
    'application',
    'standard_activity',
    v_new_id,
    jsonb_build_object(
      'activity_id', v_new_id,
      'name', v_clean_name,
      'default_duration_minutes', p_default_duration_minutes,
      'category', v_clean_cat,
      'description', v_clean_desc
    )
  );

  v_result := jsonb_build_object(
    'status', 'ok',
    'id', v_new_id,
    'name', v_clean_name,
    'default_duration_minutes', p_default_duration_minutes,
    'category', v_clean_cat,
    'description', v_clean_desc,
    'active', true
  );

  insert into app_private.event_type_activity_receipts (user_id, command_id, church_id, action, params, result)
  values (
    v_uid,
    p_command_id,
    p_church_id,
    'create_standard_activity',
    jsonb_build_object(
      'name', v_clean_name,
      'default_duration_minutes', p_default_duration_minutes,
      'category', v_clean_cat,
      'description', v_clean_desc
    ),
    v_result
  );

  return v_result;
end;
$function$;

-- Edição
create or replace function public.update_standard_activity(
  p_command_id uuid,
  p_church_id uuid,
  p_activity_id uuid,
  p_name text,
  p_default_duration_minutes integer,
  p_category text default null,
  p_description text default null
)
returns jsonb
language plpgsql security definer set search_path = '' set statement_timeout = '5s'
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_clean_name text;
  v_clean_cat text;
  v_clean_desc text;
  v_old_name text;
  v_old_duration integer;
  v_old_cat text;
  v_old_desc text;
  v_receipt app_private.event_type_activity_receipts%rowtype;
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if p_command_id is null or p_activity_id is null then
    raise exception 'command_id e activity_id obrigatórios.' using errcode = '22023';
  end if;

  select * into v_receipt from app_private.event_type_activity_receipts
  where user_id = v_uid and command_id = p_command_id;
  if found then
    return v_receipt.result;
  end if;

  if not app_private.has_church_settings_access(p_church_id, true) then
    raise exception 'Permissão insuficiente. Apenas administradores podem alterar atividades padrão.' using errcode = '42501';
  end if;

  v_clean_name := normalize(btrim(coalesce(p_name, '')), NFC);
  if char_length(v_clean_name) < 1 or char_length(v_clean_name) > 100 then
    raise exception 'Nome da atividade padrão deve ter entre 1 e 100 caracteres.' using errcode = '23514';
  end if;

  if p_default_duration_minutes is null or p_default_duration_minutes < 1 or p_default_duration_minutes > 720 then
    raise exception 'Duração padrão deve ser um número inteiro entre 1 e 720 minutos.' using errcode = '23514';
  end if;

  v_clean_cat := null;
  if p_category is not null and btrim(p_category) <> '' then
    v_clean_cat := normalize(btrim(p_category), NFC);
    if char_length(v_clean_cat) > 50 then
      raise exception 'Categoria deve ter no máximo 50 caracteres.' using errcode = '23514';
    end if;
  end if;

  v_clean_desc := null;
  if p_description is not null and btrim(p_description) <> '' then
    v_clean_desc := normalize(btrim(p_description), NFC);
    if char_length(v_clean_desc) > 255 then
      raise exception 'Descrição deve ter no máximo 255 caracteres.' using errcode = '23514';
    end if;
  end if;

  select name, default_duration_minutes, category, description
  into v_old_name, v_old_duration, v_old_cat, v_old_desc
  from app_private.standard_activities
  where id = p_activity_id and church_id = p_church_id;

  if not found then
    raise exception 'Atividade padrão não encontrada.' using errcode = 'P0002';
  end if;

  update app_private.standard_activities
  set name = v_clean_name,
      default_duration_minutes = p_default_duration_minutes,
      category = v_clean_cat,
      description = v_clean_desc
  where id = p_activity_id and church_id = p_church_id;

  insert into app_private.audit_entries (church_id, action, actor_user_id, actor_source, target_type, target_id, details)
  values (
    p_church_id,
    'update_standard_activity',
    v_uid,
    'application',
    'standard_activity',
    p_activity_id,
    jsonb_build_object(
      'activity_id', p_activity_id,
      'previous_name', v_old_name,
      'new_name', v_clean_name,
      'previous_default_duration_minutes', v_old_duration,
      'new_default_duration_minutes', p_default_duration_minutes,
      'previous_category', v_old_cat,
      'new_category', v_clean_cat,
      'previous_description', v_old_desc,
      'new_description', v_clean_desc
    )
  );

  v_result := jsonb_build_object(
    'status', 'ok',
    'id', p_activity_id,
    'name', v_clean_name,
    'default_duration_minutes', p_default_duration_minutes,
    'category', v_clean_cat,
    'description', v_clean_desc
  );

  insert into app_private.event_type_activity_receipts (user_id, command_id, church_id, action, params, result)
  values (
    v_uid,
    p_command_id,
    p_church_id,
    'update_standard_activity',
    jsonb_build_object(
      'activity_id', p_activity_id,
      'name', v_clean_name,
      'default_duration_minutes', p_default_duration_minutes,
      'category', v_clean_cat,
      'description', v_clean_desc
    ),
    v_result
  );

  return v_result;
end;
$function$;

-- Inativação / Reativação
create or replace function public.toggle_standard_activity_status(
  p_command_id uuid,
  p_church_id uuid,
  p_activity_id uuid
)
returns jsonb
language plpgsql security definer set search_path = '' set statement_timeout = '5s'
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_current_active boolean;
  v_name text;
  v_receipt app_private.event_type_activity_receipts%rowtype;
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if p_command_id is null or p_activity_id is null then
    raise exception 'command_id e activity_id obrigatórios.' using errcode = '22023';
  end if;

  select * into v_receipt from app_private.event_type_activity_receipts
  where user_id = v_uid and command_id = p_command_id;
  if found then
    return v_receipt.result;
  end if;

  if not app_private.has_church_settings_access(p_church_id, true) then
    raise exception 'Permissão insuficiente. Apenas administradores podem alterar o status de atividades padrão.' using errcode = '42501';
  end if;

  select active, name into v_current_active, v_name
  from app_private.standard_activities
  where id = p_activity_id and church_id = p_church_id;

  if not found then
    raise exception 'Atividade padrão não encontrada.' using errcode = 'P0002';
  end if;

  update app_private.standard_activities
  set active = not v_current_active
  where id = p_activity_id and church_id = p_church_id;

  insert into app_private.audit_entries (church_id, action, actor_user_id, actor_source, target_type, target_id, details)
  values (
    p_church_id,
    case when not v_current_active then 'activate_standard_activity' else 'deactivate_standard_activity' end,
    v_uid,
    'application',
    'standard_activity',
    p_activity_id,
    jsonb_build_object('activity_id', p_activity_id, 'name', v_name, 'active', not v_current_active)
  );

  v_result := jsonb_build_object(
    'status', 'ok',
    'id', p_activity_id,
    'name', v_name,
    'active', not v_current_active
  );

  insert into app_private.event_type_activity_receipts (user_id, command_id, church_id, action, params, result)
  values (
    v_uid,
    p_command_id,
    p_church_id,
    'toggle_standard_activity_status',
    jsonb_build_object('activity_id', p_activity_id, 'active', not v_current_active),
    v_result
  );

  return v_result;
end;
$function$;

-- Exclusão física (com guarda de integridade histórica)
create or replace function public.delete_standard_activity(
  p_command_id uuid,
  p_church_id uuid,
  p_activity_id uuid
)
returns jsonb
language plpgsql security definer set search_path = '' set statement_timeout = '5s'
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_name text;
  v_receipt app_private.event_type_activity_receipts%rowtype;
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if p_command_id is null or p_activity_id is null then
    raise exception 'command_id e activity_id obrigatórios.' using errcode = '22023';
  end if;

  if not app_private.has_church_settings_access(p_church_id, true) then
    raise exception 'Permissão insuficiente. Apenas administradores podem excluir atividades padrão.' using errcode = '42501';
  end if;

  select * into v_receipt from app_private.event_type_activity_receipts
  where user_id = v_uid and command_id = p_command_id;
  if found then
    -- Aceita replay somente se corresponder à mesma igreja, ação e alvo, com parâmetros compatíveis
    -- e resultado coerente de exclusão concluída. Recibos de criação, edição, outra igreja ou outro
    -- alvo não podem produzir sucesso de exclusão.
    if v_receipt.church_id = p_church_id
       and v_receipt.action = 'delete_standard_activity'
       and (v_receipt.params->>'activity_id')::uuid = p_activity_id
       and v_receipt.result->>'status' = 'ok'
       and (v_receipt.result->>'deleted')::boolean is true
    then
      return v_receipt.result;
    end if;

    raise exception 'Conflito de command_id: identificador já utilizado para outra operação.' using errcode = '23505';
  end if;

  select name into v_name
  from app_private.standard_activities
  where id = p_activity_id and church_id = p_church_id;

  if not found then
    raise exception 'Atividade padrão não encontrada.' using errcode = 'P0002';
  end if;

  if app_private.is_standard_activity_used(p_church_id, p_activity_id, v_name) then
    raise exception 'Esta atividade padrão já foi utilizada em cultos históricos e não pode ser excluída fisicamente. Desative-a para que não seja mais selecionada em novos planejamentos.' using errcode = '23503';
  end if;

  -- Contenção explícita no servidor: enquanto os dados existentes não permitirem
  -- comprovar desuso global, a exclusão física fica contida no servidor; a desativação permanece disponível.
  raise exception 'Não é possível comprovar ausência de uso histórico para exclusão física desta atividade padrão. Desative-a para que não seja mais selecionada em novos planejamentos.' using errcode = '23503';
end;
$function$;

-- 7. Privilégios e proprietário
revoke all on function public.list_event_types(uuid, boolean) from public, anon, service_role;
grant execute on function public.list_event_types(uuid, boolean) to authenticated;
alter function public.list_event_types(uuid, boolean) owner to postgres;

revoke all on function public.create_event_type(uuid, uuid, text, text) from public, anon, service_role;
grant execute on function public.create_event_type(uuid, uuid, text, text) to authenticated;
alter function public.create_event_type(uuid, uuid, text, text) owner to postgres;

revoke all on function public.update_event_type(uuid, uuid, uuid, text, text) from public, anon, service_role;
grant execute on function public.update_event_type(uuid, uuid, uuid, text, text) to authenticated;
alter function public.update_event_type(uuid, uuid, uuid, text, text) owner to postgres;

revoke all on function public.toggle_event_type_status(uuid, uuid, uuid) from public, anon, service_role;
grant execute on function public.toggle_event_type_status(uuid, uuid, uuid) to authenticated;
alter function public.toggle_event_type_status(uuid, uuid, uuid) owner to postgres;

revoke all on function public.delete_event_type(uuid, uuid, uuid) from public, anon, service_role;
grant execute on function public.delete_event_type(uuid, uuid, uuid) to authenticated;
alter function public.delete_event_type(uuid, uuid, uuid) owner to postgres;

revoke all on function public.list_standard_activities(uuid, boolean) from public, anon, service_role;
grant execute on function public.list_standard_activities(uuid, boolean) to authenticated;
alter function public.list_standard_activities(uuid, boolean) owner to postgres;

revoke all on function public.create_standard_activity(uuid, uuid, text, integer, text, text) from public, anon, service_role;
grant execute on function public.create_standard_activity(uuid, uuid, text, integer, text, text) to authenticated;
alter function public.create_standard_activity(uuid, uuid, text, integer, text, text) owner to postgres;

revoke all on function public.update_standard_activity(uuid, uuid, uuid, text, integer, text, text) from public, anon, service_role;
grant execute on function public.update_standard_activity(uuid, uuid, uuid, text, integer, text, text) to authenticated;
alter function public.update_standard_activity(uuid, uuid, uuid, text, integer, text, text) owner to postgres;

revoke all on function public.toggle_standard_activity_status(uuid, uuid, uuid) from public, anon, service_role;
grant execute on function public.toggle_standard_activity_status(uuid, uuid, uuid) to authenticated;
alter function public.toggle_standard_activity_status(uuid, uuid, uuid) owner to postgres;

revoke all on function public.delete_standard_activity(uuid, uuid, uuid) from public, anon, service_role;
grant execute on function public.delete_standard_activity(uuid, uuid, uuid) to authenticated;
alter function public.delete_standard_activity(uuid, uuid, uuid) owner to postgres;

notify pgrst, 'reload schema';

commit;
