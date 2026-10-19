-- Candidato 022: Modelos Reutilizáveis de Culto com Atividades e Apoios Padrão (Issue #27)
-- Cobre critérios CA01 a CA04 e refinamento normativo do PRD §4–5 e M28.
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
    raise exception 'Estrutura base de igrejas, acessos e auditoria obrigatória.';
  end if;

  if to_regclass('app_private.service_templates') is not null then
    raise exception 'Tabela app_private.service_templates já existente. Parar e conferir.';
  end if;

  if to_regclass('app_private.service_template_activities') is not null then
    raise exception 'Tabela app_private.service_template_activities já existente. Parar e conferir.';
  end if;

  if to_regclass('app_private.service_template_parallel_services') is not null then
    raise exception 'Tabela app_private.service_template_parallel_services já existente. Parar e conferir.';
  end if;
end;
$preflight$;

-- 1. Tabela de Modelos Reutilizáveis de Culto (CA01)
create table app_private.service_templates (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references app_private.churches(id) on delete restrict,
  event_type_id uuid references app_private.event_types(id) on delete set null,
  name text not null,
  description text,
  active boolean not null default true,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint st_name_clean check (name = btrim(name) and char_length(name) between 1 and 100),
  constraint st_desc_clean check (description is null or (description = btrim(description) and char_length(description) <= 255)),
  constraint st_church_id_id_unique unique (church_id, id),
  constraint st_church_id_name_unique unique (church_id, lower(name))
);

create index st_church_active_idx
  on app_private.service_templates (church_id, active, name);

create trigger st_touch_updated_at
  before update on app_private.service_templates
  for each row execute function app_private.touch_updated_at();

alter table app_private.service_templates enable row level security;
revoke all on app_private.service_templates from public, anon, authenticated, service_role;

-- 2. Atividades Principais do Modelo (CA01, CA03: sem escala nominal ou pessoas)
create table app_private.service_template_activities (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references app_private.churches(id) on delete restrict,
  template_id uuid not null references app_private.service_templates(id) on delete cascade,
  standard_activity_id uuid references app_private.standard_activities(id) on delete set null,
  title text not null,
  category text,
  planned_duration_minutes integer not null,
  display_order integer not null,
  notes text,
  requires_playback boolean not null default false,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint sta_title_clean check (title = btrim(title) and char_length(title) between 1 and 100),
  constraint sta_duration_range check (planned_duration_minutes between 1 and 720),
  constraint sta_order_pos check (display_order >= 1),
  constraint sta_cat_clean check (category is null or (category = btrim(category) and char_length(category) <= 50)),
  constraint sta_notes_clean check (notes is null or (notes = btrim(notes) and char_length(notes) <= 500))
);

create index sta_template_order_idx
  on app_private.service_template_activities (template_id, display_order);

create trigger sta_touch_updated_at
  before update on app_private.service_template_activities
  for each row execute function app_private.touch_updated_at();

alter table app_private.service_template_activities enable row level security;
revoke all on app_private.service_template_activities from public, anon, authenticated, service_role;

-- 3. Serviços Paralelos / Apoios Padrão do Modelo (CA01, CA03: sem voluntários)
create table app_private.service_template_parallel_services (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references app_private.churches(id) on delete restrict,
  template_id uuid not null references app_private.service_templates(id) on delete cascade,
  team_id text not null,
  service_name text not null,
  prep_required_minutes integer not null default 0,
  is_default_active boolean not null default true,
  display_order integer not null default 1,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint stps_team_clean check (team_id = btrim(team_id) and char_length(team_id) between 1 and 50),
  constraint stps_name_clean check (service_name = btrim(service_name) and char_length(service_name) between 1 and 100),
  constraint stps_prep_range check (prep_required_minutes between 0 and 180),
  constraint stps_order_pos check (display_order >= 1)
);

create index stps_template_order_idx
  on app_private.service_template_parallel_services (template_id, display_order);

create trigger stps_touch_updated_at
  before update on app_private.service_template_parallel_services
  for each row execute function app_private.touch_updated_at();

alter table app_private.service_template_parallel_services enable row level security;
revoke all on app_private.service_template_parallel_services from public, anon, authenticated, service_role;

-- 4. Tabela de Recibos para Idempotência (Modelos de Culto)
create table app_private.service_template_receipts (
  user_id uuid not null references auth.users(id) on delete restrict,
  command_id uuid not null,
  church_id uuid not null references app_private.churches(id) on delete restrict,
  action text not null,
  params jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default statement_timestamp(),
  primary key (user_id, command_id)
);

alter table app_private.service_template_receipts enable row level security;
revoke all on app_private.service_template_receipts from public, anon, authenticated, service_role;

-- 5. Função de Verificação de Uso Histórico antes de Exclusão (CA04)
create or replace function app_private.is_service_template_used(p_church_id uuid, p_template_id uuid, p_template_name text)
returns boolean
language plpgsql stable security definer set search_path = '' set statement_timeout = '5s'
as $function$
declare
  v_used boolean := false;
begin
  if to_regclass('app_private.events') is not null then
    select exists (
      select 1 from app_private.events e
      where e.church_id = p_church_id
        and (
          (e.metadata is not null and (e.metadata->>'template_id')::text = p_template_id::text)
          or lower(btrim(coalesce(e.title, ''))) = lower(btrim(p_template_name))
        )
    ) into v_used;
    if v_used then return true; end if;
  end if;

  if to_regclass('app_private.audit_entries') is not null then
    select exists (
      select 1 from app_private.audit_entries a
      where a.church_id = p_church_id
        and a.target_type = 'service_template'
        and a.target_id = p_template_id
        and a.action in ('instantiate_service_template', 'apply_service_template_to_event')
    ) into v_used;
    if v_used then return true; end if;
  end if;

  return false;
end;
$function$;
revoke all on function app_private.is_service_template_used(uuid, uuid, text) from public, anon, authenticated, service_role;

-- 6. RPC: Listar Modelos de Culto
create or replace function public.list_service_templates(
  p_church_id uuid,
  p_only_active boolean default false,
  p_event_type_id uuid default null
)
returns table(
  id uuid,
  event_type_id uuid,
  event_type_name text,
  name text,
  description text,
  active boolean,
  activities_count bigint,
  parallel_services_count bigint,
  total_duration_minutes bigint,
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
    st.id,
    st.event_type_id,
    et.name as event_type_name,
    st.name,
    st.description,
    st.active,
    count(distinct sta.id) as activities_count,
    count(distinct stps.id) as parallel_services_count,
    coalesce(sum(sta.planned_duration_minutes), 0)::bigint as total_duration_minutes,
    app_private.is_service_template_used(p_church_id, st.id, st.name) as used_in_history,
    st.created_at,
    st.updated_at
  from app_private.service_templates st
  left join app_private.event_types et on et.id = st.event_type_id
  left join app_private.service_template_activities sta on sta.template_id = st.id
  left join app_private.service_template_parallel_services stps on stps.template_id = st.id
  where st.church_id = p_church_id
    and (not p_only_active or st.active = true)
    and (p_event_type_id is null or st.event_type_id = p_event_type_id)
  group by st.id, st.event_type_id, et.name, st.name, st.description, st.active, st.created_at, st.updated_at
  order by st.active desc, st.name asc;
end;
$function$;

-- 7. RPC: Obter Detalhes Completos do Modelo
create or replace function public.get_service_template(
  p_template_id uuid
)
returns jsonb
language plpgsql stable security definer set search_path = '' set statement_timeout = '5s'
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_st app_private.service_templates%rowtype;
  v_et_name text;
  v_activities jsonb;
  v_parallel_services jsonb;
begin
  if v_uid is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  select * into v_st from app_private.service_templates where id = p_template_id;
  if not found then
    raise exception 'Modelo de culto não encontrado.' using errcode = 'P0002';
  end if;

  if not app_private.has_church_settings_access(v_st.church_id, false) then
    raise exception 'Acesso negado à igreja do modelo.' using errcode = '42501';
  end if;

  if v_st.event_type_id is not null then
    select name into v_et_name from app_private.event_types where id = v_st.event_type_id;
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', sta.id,
      'standard_activity_id', sta.standard_activity_id,
      'title', sta.title,
      'category', sta.category,
      'planned_duration_minutes', sta.planned_duration_minutes,
      'display_order', sta.display_order,
      'notes', sta.notes,
      'requires_playback', sta.requires_playback
    ) order by sta.display_order asc
  ), '[]'::jsonb)
  into v_activities
  from app_private.service_template_activities sta
  where sta.template_id = p_template_id;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', stps.id,
      'team_id', stps.team_id,
      'service_name', stps.service_name,
      'prep_required_minutes', stps.prep_required_minutes,
      'is_default_active', stps.is_default_active,
      'display_order', stps.display_order
    ) order by stps.display_order asc
  ), '[]'::jsonb)
  into v_parallel_services
  from app_private.service_template_parallel_services stps
  where stps.template_id = p_template_id;

  return jsonb_build_object(
    'id', v_st.id,
    'church_id', v_st.church_id,
    'event_type_id', v_st.event_type_id,
    'event_type_name', v_et_name,
    'name', v_st.name,
    'description', v_st.description,
    'active', v_st.active,
    'activities', v_activities,
    'parallel_services', v_parallel_services,
    'created_at', v_st.created_at,
    'updated_at', v_st.updated_at
  );
end;
$function$;

-- 8. RPC: Criar Modelo de Culto (CA01, CA03)
create or replace function public.create_service_template(
  p_command_id uuid,
  p_church_id uuid,
  p_event_type_id uuid,
  p_name text,
  p_description text default null,
  p_activities jsonb default '[]'::jsonb,
  p_parallel_services jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql security definer set search_path = '' set statement_timeout = '10s'
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_clean_name text;
  v_clean_desc text;
  v_template_id uuid;
  v_receipt app_private.service_template_receipts%rowtype;
  v_result jsonb;
  v_act jsonb;
  v_serv jsonb;
  v_order int := 1;
begin
  if v_uid is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if p_command_id is null then
    raise exception 'command_id obrigatório.' using errcode = '22023';
  end if;

  select * into v_receipt from app_private.service_template_receipts
  where user_id = v_uid and command_id = p_command_id;
  if found then
    return v_receipt.result;
  end if;

  if not app_private.has_church_settings_access(p_church_id, true) then
    raise exception 'Permissão insuficiente. Apenas administradores podem cadastrar modelos de culto.' using errcode = '42501';
  end if;

  v_clean_name := normalize(btrim(coalesce(p_name, '')), nfc);
  if char_length(v_clean_name) < 1 or char_length(v_clean_name) > 100 then
    raise exception 'Nome do modelo deve ter entre 1 e 100 caracteres.' using errcode = '22023';
  end if;

  if p_description is not null then
    v_clean_desc := normalize(btrim(p_description), nfc);
    if char_length(v_clean_desc) > 255 then
      raise exception 'Descrição não pode exceder 255 caracteres.' using errcode = '22023';
    end if;
    if v_clean_desc = '' then
      v_clean_desc := null;
    end if;
  end if;

  if exists (
    select 1 from app_private.service_templates
    where church_id = p_church_id and lower(name) = lower(v_clean_name)
  ) then
    raise exception 'Já existe um modelo de culto com este nome nesta congregação.' using errcode = '23505';
  end if;

  insert into app_private.service_templates (church_id, event_type_id, name, description, active)
  values (p_church_id, p_event_type_id, v_clean_name, v_clean_desc, true)
  returning id into v_template_id;

  -- Inserir Atividades Principais (sem pessoas, CA03)
  if p_activities is not null and jsonb_typeof(p_activities) = 'array' then
    v_order := 1;
    for v_act in select * from jsonb_array_elements(p_activities)
    loop
      insert into app_private.service_template_activities (
        church_id,
        template_id,
        standard_activity_id,
        title,
        category,
        planned_duration_minutes,
        display_order,
        notes,
        requires_playback
      ) values (
        p_church_id,
        v_template_id,
        (v_act->>'standard_activity_id')::uuid,
        normalize(btrim(coalesce(v_act->>'title', 'Etapa')), nfc),
        normalize(btrim(coalesce(v_act->>'category', 'Liturgia')), nfc),
        greatest(1, least(720, coalesce((v_act->>'planned_duration_minutes')::int, 10))),
        coalesce((v_act->>'display_order')::int, v_order),
        case when v_act->>'notes' is not null then normalize(btrim(v_act->>'notes'), nfc) else null end,
        coalesce((v_act->>'requires_playback')::boolean, false)
      );
      v_order := v_order + 1;
    end loop;
  end if;

  -- Inserir Serviços Paralelos Padrão (sem pessoas, CA03)
  if p_parallel_services is not null and jsonb_typeof(p_parallel_services) = 'array' then
    v_order := 1;
    for v_serv in select * from jsonb_array_elements(p_parallel_services)
    loop
      insert into app_private.service_template_parallel_services (
        church_id,
        template_id,
        team_id,
        service_name,
        prep_required_minutes,
        is_default_active,
        display_order
      ) values (
        p_church_id,
        v_template_id,
        normalize(btrim(coalesce(v_serv->>'team_id', 'apoio')), nfc),
        normalize(btrim(coalesce(v_serv->>'service_name', 'Serviço de Apoio')), nfc),
        greatest(0, least(180, coalesce((v_serv->>'prep_required_minutes')::int, 0))),
        coalesce((v_serv->>'is_default_active')::boolean, true),
        coalesce((v_serv->>'display_order')::int, v_order)
      );
      v_order := v_order + 1;
    end loop;
  end if;

  -- Auditoria
  insert into app_private.audit_entries (church_id, action, actor_user_id, actor_source, target_type, target_id, details)
  values (
    p_church_id,
    'create_service_template',
    v_uid,
    'application',
    'service_template',
    v_template_id,
    jsonb_build_object(
      'template_id', v_template_id,
      'name', v_clean_name,
      'event_type_id', p_event_type_id
    )
  );

  v_result := jsonb_build_object('success', true, 'template_id', v_template_id, 'name', v_clean_name);

  insert into app_private.service_template_receipts (user_id, command_id, church_id, action, params, result)
  values (
    v_uid,
    p_command_id,
    p_church_id,
    'create_service_template',
    jsonb_build_object('name', v_clean_name, 'event_type_id', p_event_type_id),
    v_result
  );

  return v_result;
end;
$function$;

-- 9. RPC: Atualizar Modelo de Culto (CA04: imutabilidade de eventos já criados)
create or replace function public.update_service_template(
  p_command_id uuid,
  p_template_id uuid,
  p_event_type_id uuid,
  p_name text,
  p_description text default null,
  p_activities jsonb default null,
  p_parallel_services jsonb default null
)
returns jsonb
language plpgsql security definer set search_path = '' set statement_timeout = '10s'
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_st app_private.service_templates%rowtype;
  v_clean_name text;
  v_clean_desc text;
  v_receipt app_private.service_template_receipts%rowtype;
  v_result jsonb;
  v_act jsonb;
  v_serv jsonb;
  v_order int;
begin
  if v_uid is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if p_command_id is null then
    raise exception 'command_id obrigatório.' using errcode = '22023';
  end if;

  select * into v_receipt from app_private.service_template_receipts
  where user_id = v_uid and command_id = p_command_id;
  if found then
    return v_receipt.result;
  end if;

  select * into v_st from app_private.service_templates where id = p_template_id;
  if not found then
    raise exception 'Modelo de culto não encontrado.' using errcode = 'P0002';
  end if;

  if not app_private.has_church_settings_access(v_st.church_id, true) then
    raise exception 'Permissão insuficiente. Apenas administradores podem atualizar modelos de culto.' using errcode = '42501';
  end if;

  v_clean_name := normalize(btrim(coalesce(p_name, '')), nfc);
  if char_length(v_clean_name) < 1 or char_length(v_clean_name) > 100 then
    raise exception 'Nome do modelo deve ter entre 1 e 100 caracteres.' using errcode = '22023';
  end if;

  if p_description is not null then
    v_clean_desc := normalize(btrim(p_description), nfc);
    if char_length(v_clean_desc) > 255 then
      raise exception 'Descrição não pode exceder 255 caracteres.' using errcode = '22023';
    end if;
    if v_clean_desc = '' then
      v_clean_desc := null;
    end if;
  end if;

  if exists (
    select 1 from app_private.service_templates
    where church_id = v_st.church_id and lower(name) = lower(v_clean_name) and id <> p_template_id
  ) then
    raise exception 'Já existe outro modelo de culto com este nome nesta congregação.' using errcode = '23505';
  end if;

  update app_private.service_templates
  set
    event_type_id = p_event_type_id,
    name = v_clean_name,
    description = v_clean_desc,
    updated_at = clock_timestamp()
  where id = p_template_id;

  -- Se fornecidas novas atividades, substituir atividades do modelo
  if p_activities is not null and jsonb_typeof(p_activities) = 'array' then
    delete from app_private.service_template_activities where template_id = p_template_id;
    v_order := 1;
    for v_act in select * from jsonb_array_elements(p_activities)
    loop
      insert into app_private.service_template_activities (
        church_id,
        template_id,
        standard_activity_id,
        title,
        category,
        planned_duration_minutes,
        display_order,
        notes,
        requires_playback
      ) values (
        v_st.church_id,
        p_template_id,
        (v_act->>'standard_activity_id')::uuid,
        normalize(btrim(coalesce(v_act->>'title', 'Etapa')), nfc),
        normalize(btrim(coalesce(v_act->>'category', 'Liturgia')), nfc),
        greatest(1, least(720, coalesce((v_act->>'planned_duration_minutes')::int, 10))),
        coalesce((v_act->>'display_order')::int, v_order),
        case when v_act->>'notes' is not null then normalize(btrim(v_act->>'notes'), nfc) else null end,
        coalesce((v_act->>'requires_playback')::boolean, false)
      );
      v_order := v_order + 1;
    end loop;
  end if;

  -- Se fornecidos novos serviços paralelos, substituir
  if p_parallel_services is not null and jsonb_typeof(p_parallel_services) = 'array' then
    delete from app_private.service_template_parallel_services where template_id = p_template_id;
    v_order := 1;
    for v_serv in select * from jsonb_array_elements(p_parallel_services)
    loop
      insert into app_private.service_template_parallel_services (
        church_id,
        template_id,
        team_id,
        service_name,
        prep_required_minutes,
        is_default_active,
        display_order
      ) values (
        v_st.church_id,
        p_template_id,
        normalize(btrim(coalesce(v_serv->>'team_id', 'apoio')), nfc),
        normalize(btrim(coalesce(v_serv->>'service_name', 'Serviço de Apoio')), nfc),
        greatest(0, least(180, coalesce((v_serv->>'prep_required_minutes')::int, 0))),
        coalesce((v_serv->>'is_default_active')::boolean, true),
        coalesce((v_serv->>'display_order')::int, v_order)
      );
      v_order := v_order + 1;
    end loop;
  end if;

  -- Auditoria
  insert into app_private.audit_entries (church_id, action, actor_user_id, actor_source, target_type, target_id, details)
  values (
    v_st.church_id,
    'update_service_template',
    v_uid,
    'application',
    'service_template',
    p_template_id,
    jsonb_build_object(
      'template_id', p_template_id,
      'previous_name', v_st.name,
      'new_name', v_clean_name,
      'previous_event_type_id', v_st.event_type_id,
      'new_event_type_id', p_event_type_id
    )
  );

  v_result := jsonb_build_object('success', true, 'template_id', p_template_id, 'name', v_clean_name);

  insert into app_private.service_template_receipts (user_id, command_id, church_id, action, params, result)
  values (
    v_uid,
    p_command_id,
    v_st.church_id,
    'update_service_template',
    jsonb_build_object('template_id', p_template_id, 'name', v_clean_name),
    v_result
  );

  return v_result;
end;
$function$;

-- 10. RPC: Alternar Status Ativo / Inativo do Modelo
create or replace function public.toggle_service_template_status(
  p_command_id uuid,
  p_template_id uuid,
  p_active boolean
)
returns jsonb
language plpgsql security definer set search_path = '' set statement_timeout = '5s'
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_st app_private.service_templates%rowtype;
  v_receipt app_private.service_template_receipts%rowtype;
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if p_command_id is null then
    raise exception 'command_id obrigatório.' using errcode = '22023';
  end if;

  select * into v_receipt from app_private.service_template_receipts
  where user_id = v_uid and command_id = p_command_id;
  if found then
    return v_receipt.result;
  end if;

  select * into v_st from app_private.service_templates where id = p_template_id;
  if not found then
    raise exception 'Modelo de culto não encontrado.' using errcode = 'P0002';
  end if;

  if not app_private.has_church_settings_access(v_st.church_id, true) then
    raise exception 'Permissão insuficiente. Apenas administradores podem alterar status do modelo.' using errcode = '42501';
  end if;

  update app_private.service_templates
  set active = p_active, updated_at = clock_timestamp()
  where id = p_template_id;

  insert into app_private.audit_entries (church_id, action, actor_user_id, actor_source, target_type, target_id, details)
  values (
    v_st.church_id,
    case when p_active then 'reactivate_service_template' else 'deactivate_service_template' end,
    v_uid,
    'application',
    'service_template',
    p_template_id,
    jsonb_build_object('template_id', p_template_id, 'name', v_st.name, 'active', p_active)
  );

  v_result := jsonb_build_object('success', true, 'template_id', p_template_id, 'active', p_active);

  insert into app_private.service_template_receipts (user_id, command_id, church_id, action, params, result)
  values (
    v_uid,
    p_command_id,
    v_st.church_id,
    'toggle_service_template_status',
    jsonb_build_object('template_id', p_template_id, 'active', p_active),
    v_result
  );

  return v_result;
end;
$function$;

-- 11. RPC: Excluir Modelo de Culto com Proteção Histórica (CA04)
create or replace function public.delete_service_template(
  p_command_id uuid,
  p_template_id uuid
)
returns jsonb
language plpgsql security definer set search_path = '' set statement_timeout = '5s'
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_st app_private.service_templates%rowtype;
  v_receipt app_private.service_template_receipts%rowtype;
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if p_command_id is null then
    raise exception 'command_id obrigatório.' using errcode = '22023';
  end if;

  select * into v_receipt from app_private.service_template_receipts
  where user_id = v_uid and command_id = p_command_id;
  if found then
    return v_receipt.result;
  end if;

  select * into v_st from app_private.service_templates where id = p_template_id;
  if not found then
    raise exception 'Modelo de culto não encontrado.' using errcode = 'P0002';
  end if;

  if not app_private.has_church_settings_access(v_st.church_id, true) then
    raise exception 'Permissão insuficiente. Apenas administradores podem excluir modelos de culto.' using errcode = '42501';
  end if;

  if app_private.is_service_template_used(v_st.church_id, p_template_id, v_st.name) then
    raise exception 'Este modelo já foi utilizado em cultos anteriores e não pode ser excluído fisicamente. Recomenda-se desativá-lo.'
      using errcode = '23503';
  end if;

  delete from app_private.service_templates where id = p_template_id;

  insert into app_private.audit_entries (church_id, action, actor_user_id, actor_source, target_type, target_id, details)
  values (
    v_st.church_id,
    'delete_service_template',
    v_uid,
    'application',
    'service_template',
    p_template_id,
    jsonb_build_object('template_id', p_template_id, 'name', v_st.name)
  );

  v_result := jsonb_build_object('success', true, 'template_id', p_template_id, 'deleted', true);

  insert into app_private.service_template_receipts (user_id, command_id, church_id, action, params, result)
  values (
    v_uid,
    p_command_id,
    v_st.church_id,
    'delete_service_template',
    jsonb_build_object('template_id', p_template_id),
    v_result
  );

  return v_result;
end;
$function$;

-- 12. RPC: Instanciar Modelo para Evento/Edição (CA02, CA03: Cópia profunda sem pessoas)
create or replace function public.instantiate_service_template(
  p_command_id uuid,
  p_church_id uuid,
  p_template_id uuid
)
returns jsonb
language plpgsql stable security definer set search_path = '' set statement_timeout = '5s'
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_st app_private.service_templates%rowtype;
  v_activities jsonb;
  v_parallel_services jsonb;
begin
  if v_uid is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  select * into v_st from app_private.service_templates where id = p_template_id and church_id = p_church_id;
  if not found then
    raise exception 'Modelo de culto não encontrado na igreja especificada.' using errcode = 'P0002';
  end if;

  -- Atividades como cópia independente e sem alocação nominal de pessoas (CA03)
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', 'act-' || gen_random_uuid(),
      'title', sta.title,
      'category', sta.category,
      'plannedDurationMinutes', sta.planned_duration_minutes,
      'status', 'pendente',
      'responsibleMemberId', null,
      'responsibleTeamId', null,
      'notes', sta.notes,
      'requiresPlayback', sta.requires_playback,
      'musics', '[]'::jsonb,
      'roster', '[]'::jsonb
    ) order by sta.display_order asc
  ), '[]'::jsonb)
  into v_activities
  from app_private.service_template_activities sta
  where sta.template_id = p_template_id;

  -- Serviços paralelos como cópia independente e sem voluntários escalados (CA03)
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', 'serv-' || gen_random_uuid(),
      'name', stps.service_name,
      'teamId', stps.team_id,
      'leaderId', null,
      'volunteers', '[]'::jsonb,
      'status', 'Aguardando culto',
      'prepRequiredMinutes', stps.prep_required_minutes
    ) order by stps.display_order asc
  ), '[]'::jsonb)
  into v_parallel_services
  from app_private.service_template_parallel_services stps
  where stps.template_id = p_template_id and stps.is_default_active = true;

  return jsonb_build_object(
    'success', true,
    'template_id', v_st.id,
    'template_name', v_st.name,
    'event_type_id', v_st.event_type_id,
    'activities', v_activities,
    'parallelServices', v_parallel_services
  );
end;
$function$;

-- 13. Permissões de Execução e Ownership
revoke all on function public.list_service_templates(uuid, boolean, uuid) from public, anon;
grant execute on function public.list_service_templates(uuid, boolean, uuid) to authenticated;

revoke all on function public.get_service_template(uuid) from public, anon;
grant execute on function public.get_service_template(uuid) to authenticated;

revoke all on function public.create_service_template(uuid, uuid, uuid, text, text, jsonb, jsonb) from public, anon;
grant execute on function public.create_service_template(uuid, uuid, uuid, text, text, jsonb, jsonb) to authenticated;

revoke all on function public.update_service_template(uuid, uuid, uuid, text, text, jsonb, jsonb) from public, anon;
grant execute on function public.update_service_template(uuid, uuid, uuid, text, text, jsonb, jsonb) to authenticated;

revoke all on function public.toggle_service_template_status(uuid, uuid, boolean) from public, anon;
grant execute on function public.toggle_service_template_status(uuid, uuid, boolean) to authenticated;

revoke all on function public.delete_service_template(uuid, uuid) from public, anon;
grant execute on function public.delete_service_template(uuid, uuid) to authenticated;

revoke all on function public.instantiate_service_template(uuid, uuid, uuid) from public, anon;
grant execute on function public.instantiate_service_template(uuid, uuid, uuid) to authenticated;

alter function public.list_service_templates(uuid, boolean, uuid) owner to postgres;
alter function public.get_service_template(uuid) owner to postgres;
alter function public.create_service_template(uuid, uuid, uuid, text, text, jsonb, jsonb) owner to postgres;
alter function public.update_service_template(uuid, uuid, uuid, text, text, jsonb, jsonb) owner to postgres;
alter function public.toggle_service_template_status(uuid, uuid, boolean) owner to postgres;
alter function public.delete_service_template(uuid, uuid) owner to postgres;
alter function public.instantiate_service_template(uuid, uuid, uuid) owner to postgres;

notify pgrst, 'reload schema';

commit;
