-- Candidato 023: Planejamento Litúrgico de Eventos, Reordenação e Políticas de Duração (Issues #28, #29 e #30)
-- Cobre critérios CA01 a CA04 de #28, CA01 a CA04 de #29 e CA01 a CA04 de #30.
-- Alinhado ao PRD §3.2, §5, §6 e §7.7 (Cenários M05, M06, M24–M26, M28, M39–M40, M47–M50).
-- NÃO executar no piloto sem revisão, ensaio com ROLLBACK e autorização específica do responsável.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $preflight$
begin
  if to_regclass('app_private.churches') is null
    or to_regclass('app_private.church_access') is null
    or to_regclass('app_private.members') is null
    or to_regclass('app_private.events') is null
    or to_regclass('app_private.event_items') is null
    or to_regclass('app_private.audit_entries') is null then
    raise exception 'Estrutura base de igrejas, eventos e auditoria obrigatória (Incrementos 001–015).';
  end if;

  if to_regclass('app_private.event_planning_receipts') is not null then
    raise exception 'Tabela app_private.event_planning_receipts já existente. Parar e conferir.';
  end if;
end;
$preflight$;

-- 1. Evolução da Tabela de Eventos com Políticas de Duração e Publicação
alter table app_private.events
  add column if not exists duration_policy text not null default 'warn' check (duration_policy in ('warn', 'block')),
  add column if not exists program_status text not null default 'draft' check (program_status in ('draft', 'published')),
  add column if not exists program_version integer not null default 1,
  add column if not exists published_at timestamptz,
  add column if not exists published_by_member_id uuid references app_private.members(id) on delete set null;

-- 2. Tabela de Recibos para Idempotência (Planejamento e Publicação de Eventos)
create table app_private.event_planning_receipts (
  user_id uuid not null references auth.users(id) on delete restrict,
  command_id uuid not null,
  church_id uuid not null references app_private.churches(id) on delete restrict,
  action text not null,
  params jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default statement_timestamp(),
  primary key (user_id, command_id)
);

alter table app_private.event_planning_receipts enable row level security;
revoke all on app_private.event_planning_receipts from public, anon, authenticated, service_role;

-- 3. RPC: Criar Edição Concreta de Culto (Issue #28: CA01 a CA04)
create or replace function public.create_church_event_edition(
  p_church_id uuid,
  p_command_id uuid,
  p_title text,
  p_event_type text,
  p_planned_start_at timestamptz,
  p_planned_end_at timestamptz,
  p_liturgy_leader_member_id uuid default null,
  p_duration_policy text default 'warn'
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
  v_timezone text;
  v_title_clean text;
  v_type_clean text;
  v_policy_clean text;
  v_existing_receipt record;
  v_event_id uuid;
  v_payload jsonb;
  v_created_at timestamptz;
  v_params_hash jsonb;
  c_action constant text := 'create_church_event_edition';
begin
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if p_church_id is null or p_command_id is null or p_title is null
     or p_planned_start_at is null or p_planned_end_at is null then
    raise exception 'Parâmetros obrigatórios ausentes.' using errcode = '22004';
  end if;

  v_title_clean := btrim(normalize(p_title, NFC));
  if char_length(v_title_clean) < 1 or char_length(v_title_clean) > 200 then
    raise exception 'Título do evento deve ter entre 1 e 200 caracteres.' using errcode = '22000';
  end if;

  v_type_clean := btrim(normalize(coalesce(p_event_type, 'Culto'), NFC));
  v_policy_clean := lower(btrim(coalesce(p_duration_policy, 'warn')));
  if v_policy_clean not in ('warn', 'block') then
    raise exception 'Política de duração inválida. Opções: warn ou block.' using errcode = '22000';
  end if;

  -- CA01 de #28: fim deve ser posterior ao início (inclusive cruzar meia-noite)
  if p_planned_end_at <= p_planned_start_at then
    raise exception 'Data/hora de término planejada deve ser posterior ao início.' using errcode = '22000';
  end if;

  -- Advisory lock imediato antes de ler autoridade ou recibo
  perform pg_advisory_xact_lock(hashtext(v_user_id::text), hashtext(p_command_id::text));

  -- Checagem de membro e autoridade da igreja
  select ca.member_id, ca.is_admin, coalesce(c.timezone, 'America/Sao_Paulo')
  into v_caller_member_id, v_is_admin, v_timezone
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
    and not coalesce(u.is_anonymous, false);

  if v_caller_member_id is null then
    raise exception 'Usuário sem vínculo ativo com a igreja.' using errcode = '42501';
  end if;

  -- CA03 de #28: Somente administrador designa a liderança da liturgia
  if p_liturgy_leader_member_id is not null and not v_is_admin then
    raise exception 'Somente administradores podem designar a liderança da liturgia.' using errcode = '42501';
  end if;

  if p_liturgy_leader_member_id is not null then
    if not exists (
      select 1 from app_private.members m
      where m.church_id = p_church_id
        and m.id = p_liturgy_leader_member_id
        and m.status = 'active'
    ) then
      raise exception 'Membro designado como líder da liturgia não existe ou está inativo.' using errcode = '23503';
    end if;
  end if;

  v_params_hash := jsonb_build_object(
    'title', v_title_clean,
    'planned_start_at', p_planned_start_at,
    'planned_end_at', p_planned_end_at,
    'liturgy_leader_member_id', p_liturgy_leader_member_id,
    'duration_policy', v_policy_clean
  );

  -- Idempotência por recibo
  select r.result, r.created_at into v_existing_receipt
  from app_private.event_planning_receipts r
  where r.user_id = v_user_id and r.command_id = p_command_id;

  if v_existing_receipt is not null then
    return query select
      p_command_id,
      c_action,
      p_church_id,
      (v_existing_receipt.result->>'event_id')::uuid,
      v_existing_receipt.result,
      v_existing_receipt.created_at;
    return;
  end if;

  -- CA04 de #28: Criação com status scheduled / pronto, sem execução nem integrantes
  v_event_id := gen_random_uuid();
  v_created_at := clock_timestamp();

  insert into app_private.events (
    id,
    church_id,
    title,
    event_type,
    timezone,
    status,
    planned_start_at,
    planned_end_at,
    liturgy_leader_member_id,
    duration_policy,
    program_status,
    program_version,
    created_at,
    updated_at
  ) values (
    v_event_id,
    p_church_id,
    v_title_clean,
    v_type_clean,
    v_timezone,
    'scheduled',
    p_planned_start_at,
    p_planned_end_at,
    p_liturgy_leader_member_id,
    v_policy_clean,
    'draft',
    1,
    v_created_at,
    v_created_at
  );

  v_payload := jsonb_build_object(
    'event_id', v_event_id,
    'title', v_title_clean,
    'timezone', v_timezone,
    'planned_start_at', p_planned_start_at,
    'planned_end_at', p_planned_end_at,
    'duration_policy', v_policy_clean,
    'program_status', 'draft',
    'status', 'scheduled'
  );

  insert into app_private.event_planning_receipts (
    user_id, command_id, church_id, action, params, result, created_at
  ) values (
    v_user_id, p_command_id, p_church_id, c_action, v_params_hash, v_payload, v_created_at
  );

  insert into app_private.audit_entries (
    church_id, action, actor_user_id, actor_source, target_type, target_id, details
  ) values (
    p_church_id, c_action, v_user_id, 'application', 'events', v_event_id, v_payload
  );

  return query select
    p_command_id,
    c_action,
    p_church_id,
    v_event_id,
    v_payload,
    v_created_at;
end;
$function$;

-- 4. RPC: Reordenar Atividades da Edição (Issue #29: CA01)
create or replace function public.reorder_event_items(
  p_church_id uuid,
  p_command_id uuid,
  p_event_id uuid,
  p_ordered_item_ids uuid[]
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
  v_item_id uuid;
  v_order integer := 1;
  v_created_at timestamptz;
  v_payload jsonb;
  v_existing_receipt record;
  v_params_hash jsonb;
  c_action constant text := 'reorder_event_items';
begin
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if p_church_id is null or p_command_id is null or p_event_id is null or p_ordered_item_ids is null then
    raise exception 'Parâmetros obrigatórios ausentes.' using errcode = '22004';
  end if;

  v_params_hash := jsonb_build_object(
    'event_id', p_event_id,
    'ordered_item_ids', p_ordered_item_ids
  );

  -- Idempotência por recibo
  select r.result, r.created_at into v_existing_receipt
  from app_private.event_planning_receipts r
  where r.user_id = v_user_id and r.command_id = p_command_id;

  if v_existing_receipt is not null then
    return query select
      p_command_id,
      c_action,
      p_church_id,
      (v_existing_receipt.result->>'event_id')::uuid,
      v_existing_receipt.result,
      v_existing_receipt.created_at;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtext(v_user_id::text), hashtext(p_command_id::text));

  select ca.member_id, ca.is_admin
  into v_caller_member_id, v_is_admin
  from app_private.church_access ca
  where ca.user_id = v_user_id and ca.church_id = p_church_id and ca.status = 'active';

  if v_caller_member_id is null then
    raise exception 'Usuário sem vínculo ativo com a igreja.' using errcode = '42501';
  end if;

  select * into v_event
  from app_private.events e
  where e.church_id = p_church_id and e.id = p_event_id;

  if v_event is null then
    raise exception 'Evento não encontrado.' using errcode = 'P0002';
  end if;

  -- Autorizado se admin ou líder da liturgia deste evento
  if not v_is_admin and v_event.liturgy_leader_member_id <> v_caller_member_id then
    raise exception 'Permissão insuficiente para reordenar este evento.' using errcode = '42501';
  end if;

  v_created_at := clock_timestamp();

  foreach v_item_id in array p_ordered_item_ids
  loop
    update app_private.event_items ei
    set sequence_order = v_order,
        updated_at = v_created_at
    where ei.church_id = p_church_id
      and ei.event_id = p_event_id
      and ei.id = v_item_id;
    v_order := v_order + 1;
  end loop;

  v_payload := jsonb_build_object(
    'event_id', p_event_id,
    'total_items_reordered', array_length(p_ordered_item_ids, 1)
  );

  insert into app_private.event_planning_receipts (
    user_id, command_id, church_id, action, params, result, created_at
  ) values (
    v_user_id, p_command_id, p_church_id, c_action, v_params_hash, v_payload, v_created_at
  );

  insert into app_private.audit_entries (
    church_id, action, actor_user_id, actor_source, target_type, target_id, details
  ) values (
    p_church_id, c_action, v_user_id, 'application', 'events', p_event_id, v_payload
  );

  return query select
    p_command_id,
    c_action,
    p_church_id,
    p_event_id,
    v_payload,
    v_created_at;
end;
$function$;

-- 5. RPC: Configurar Política de Duração do Evento (Issue #30: CA04)
create or replace function public.set_event_duration_policy(
  p_church_id uuid,
  p_command_id uuid,
  p_event_id uuid,
  p_duration_policy text
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
  v_policy_clean text;
  v_created_at timestamptz;
  v_payload jsonb;
  v_existing_receipt record;
  v_params_hash jsonb;
  c_action constant text := 'set_event_duration_policy';
begin
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  v_policy_clean := lower(btrim(coalesce(p_duration_policy, '')));
  if v_policy_clean not in ('warn', 'block') then
    raise exception 'Política de duração inválida. Opções: warn ou block.' using errcode = '22000';
  end if;

  v_params_hash := jsonb_build_object(
    'event_id', p_event_id,
    'duration_policy', v_policy_clean
  );

  -- Idempotência por recibo
  select r.result, r.created_at into v_existing_receipt
  from app_private.event_planning_receipts r
  where r.user_id = v_user_id and r.command_id = p_command_id;

  if v_existing_receipt is not null then
    return query select
      p_command_id,
      c_action,
      p_church_id,
      (v_existing_receipt.result->>'event_id')::uuid,
      v_existing_receipt.result,
      v_existing_receipt.created_at;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtext(v_user_id::text), hashtext(p_command_id::text));

  select ca.member_id, ca.is_admin
  into v_caller_member_id, v_is_admin
  from app_private.church_access ca
  where ca.user_id = v_user_id and ca.church_id = p_church_id and ca.status = 'active';

  select * into v_event
  from app_private.events e
  where e.church_id = p_church_id and e.id = p_event_id;

  if v_event is null then
    raise exception 'Evento não encontrado.' using errcode = 'P0002';
  end if;

  -- Somente administradores ou o líder da liturgia do evento podem alterar a política
  if not v_is_admin and v_event.liturgy_leader_member_id <> v_caller_member_id then
    raise exception 'Permissão insuficiente para alterar a política de duração.' using errcode = '42501';
  end if;

  v_created_at := clock_timestamp();

  update app_private.events e
  set duration_policy = v_policy_clean,
      updated_at = v_created_at
  where e.church_id = p_church_id and e.id = p_event_id;

  v_payload := jsonb_build_object(
    'event_id', p_event_id,
    'duration_policy', v_policy_clean
  );

  insert into app_private.event_planning_receipts (
    user_id, command_id, church_id, action, params, result, created_at
  ) values (
    v_user_id, p_command_id, p_church_id, c_action, v_params_hash, v_payload, v_created_at
  );

  insert into app_private.audit_entries (
    church_id, action, actor_user_id, actor_source, target_type, target_id, details
  ) values (
    p_church_id, c_action, v_user_id, 'application', 'events', p_event_id, v_payload
  );

  return query select
    p_command_id,
    c_action,
    p_church_id,
    p_event_id,
    v_payload,
    v_created_at;
end;
$function$;

-- 6. RPC: Publicar a Programação Litúrgica (Issue #30: CA01 a CA04)
create or replace function public.publish_event_program(
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
  v_caller_member_id uuid;
  v_is_admin boolean;
  v_event record;
  v_total_occupied_seconds integer;
  v_available_seconds integer;
  v_overflow_seconds integer;
  v_created_at timestamptz;
  v_payload jsonb;
  v_existing_receipt record;
  v_params_hash jsonb;
  c_action constant text := 'publish_event_program';
begin
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  v_params_hash := jsonb_build_object('event_id', p_event_id);

  -- Idempotência por recibo
  select r.result, r.created_at into v_existing_receipt
  from app_private.event_planning_receipts r
  where r.user_id = v_user_id and r.command_id = p_command_id;

  if v_existing_receipt is not null then
    return query select
      p_command_id,
      c_action,
      p_church_id,
      (v_existing_receipt.result->>'event_id')::uuid,
      v_existing_receipt.result,
      v_existing_receipt.created_at;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtext(v_user_id::text), hashtext(p_command_id::text));

  select ca.member_id, ca.is_admin
  into v_caller_member_id, v_is_admin
  from app_private.church_access ca
  where ca.user_id = v_user_id and ca.church_id = p_church_id and ca.status = 'active';

  select * into v_event
  from app_private.events e
  where e.church_id = p_church_id and e.id = p_event_id;

  if v_event is null then
    raise exception 'Evento não encontrado.' using errcode = 'P0002';
  end if;

  if not v_is_admin and v_event.liturgy_leader_member_id <> v_caller_member_id then
    raise exception 'Permissão insuficiente para publicar a programação deste evento.' using errcode = '42501';
  end if;

  -- Cálculo de duração disponível e ocupada na sequência principal (CA01 e CA02 de #29, CA01 de #30)
  v_available_seconds := extract(epoch from (v_event.planned_end_at - v_event.planned_start_at))::integer;

  select coalesce(sum(ei.planned_duration_seconds), 0)
  into v_total_occupied_seconds
  from app_private.event_items ei
  where ei.church_id = p_church_id
    and ei.event_id = p_event_id
    and ei.item_nature = 'liturgical'
    and ei.status <> 'cancelled';

  v_overflow_seconds := greatest(0, v_total_occupied_seconds - v_available_seconds);

  -- CA03 de #30: Em modo block, rejeitar publicação se houver excesso
  if v_event.duration_policy = 'block' and v_overflow_seconds > 0 then
    raise exception 'A programação excede o limite planejado em % segundos. No modo de bloqueio, ajuste a duração antes de publicar.',
      v_overflow_seconds using errcode = '22000';
  end if;

  v_created_at := clock_timestamp();

  update app_private.events e
  set program_status = 'published',
      published_at = v_created_at,
      published_by_member_id = v_caller_member_id,
      program_version = program_version + 1,
      updated_at = v_created_at
  where e.church_id = p_church_id and e.id = p_event_id;

  v_payload := jsonb_build_object(
    'event_id', p_event_id,
    'program_status', 'published',
    'duration_policy', v_event.duration_policy,
    'available_seconds', v_available_seconds,
    'occupied_seconds', v_total_occupied_seconds,
    'overflow_seconds', v_overflow_seconds,
    'published_at', v_created_at
  );

  insert into app_private.event_planning_receipts (
    user_id, command_id, church_id, action, params, result, created_at
  ) values (
    v_user_id, p_command_id, p_church_id, c_action, v_params_hash, v_payload, v_created_at
  );

  insert into app_private.audit_entries (
    church_id, action, actor_user_id, actor_source, target_type, target_id, details
  ) values (
    p_church_id, c_action, v_user_id, 'application', 'events', p_event_id, v_payload
  );

  return query select
    p_command_id,
    c_action,
    p_church_id,
    p_event_id,
    v_payload,
    v_created_at;
end;
$function$;

-- 7. RPC: Salvar Rascunho da Programação (Issue #30: CA02 e CA03)
create or replace function public.save_event_program_draft(
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
  v_caller_member_id uuid;
  v_is_admin boolean;
  v_event record;
  v_created_at timestamptz;
  v_payload jsonb;
  v_existing_receipt record;
  v_params_hash jsonb;
  c_action constant text := 'save_event_program_draft';
begin
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  v_params_hash := jsonb_build_object('event_id', p_event_id);

  -- Idempotência por recibo
  select r.result, r.created_at into v_existing_receipt
  from app_private.event_planning_receipts r
  where r.user_id = v_user_id and r.command_id = p_command_id;

  if v_existing_receipt is not null then
    return query select
      p_command_id,
      c_action,
      p_church_id,
      (v_existing_receipt.result->>'event_id')::uuid,
      v_existing_receipt.result,
      v_existing_receipt.created_at;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtext(v_user_id::text), hashtext(p_command_id::text));

  select ca.member_id, ca.is_admin
  into v_caller_member_id, v_is_admin
  from app_private.church_access ca
  where ca.user_id = v_user_id and ca.church_id = p_church_id and ca.status = 'active';

  select * into v_event
  from app_private.events e
  where e.church_id = p_church_id and e.id = p_event_id;

  if v_event is null then
    raise exception 'Evento não encontrado.' using errcode = 'P0002';
  end if;

  if not v_is_admin and v_event.liturgy_leader_member_id <> v_caller_member_id then
    raise exception 'Permissão insuficiente para salvar rascunho deste evento.' using errcode = '42501';
  end if;

  v_created_at := clock_timestamp();

  update app_private.events e
  set program_status = 'draft',
      updated_at = v_created_at
  where e.church_id = p_church_id and e.id = p_event_id;

  v_payload := jsonb_build_object(
    'event_id', p_event_id,
    'program_status', 'draft'
  );

  insert into app_private.event_planning_receipts (
    user_id, command_id, church_id, action, params, result, created_at
  ) values (
    v_user_id, p_command_id, p_church_id, c_action, v_params_hash, v_payload, v_created_at
  );

  insert into app_private.audit_entries (
    church_id, action, actor_user_id, actor_source, target_type, target_id, details
  ) values (
    p_church_id, c_action, v_user_id, 'application', 'events', p_event_id, v_payload
  );

  return query select
    p_command_id,
    c_action,
    p_church_id,
    p_event_id,
    v_payload,
    v_created_at;
end;
$function$;

-- 8. Permissões de Execução e Ownership
revoke all on function public.create_church_event_edition(uuid, uuid, text, text, timestamptz, timestamptz, uuid, text) from public, anon;
grant execute on function public.create_church_event_edition(uuid, uuid, text, text, timestamptz, timestamptz, uuid, text) to authenticated;

revoke all on function public.reorder_event_items(uuid, uuid, uuid, uuid[]) from public, anon;
grant execute on function public.reorder_event_items(uuid, uuid, uuid, uuid[]) to authenticated;

revoke all on function public.set_event_duration_policy(uuid, uuid, uuid, text) from public, anon;
grant execute on function public.set_event_duration_policy(uuid, uuid, uuid, text) to authenticated;

revoke all on function public.publish_event_program(uuid, uuid, uuid) from public, anon;
grant execute on function public.publish_event_program(uuid, uuid, uuid) to authenticated;

revoke all on function public.save_event_program_draft(uuid, uuid, uuid) from public, anon;
grant execute on function public.save_event_program_draft(uuid, uuid, uuid) to authenticated;

alter function public.create_church_event_edition(uuid, uuid, text, text, timestamptz, timestamptz, uuid, text) owner to postgres;
alter function public.reorder_event_items(uuid, uuid, uuid, uuid[]) owner to postgres;
alter function public.set_event_duration_policy(uuid, uuid, uuid, text) owner to postgres;
alter function public.publish_event_program(uuid, uuid, uuid) owner to postgres;
alter function public.save_event_program_draft(uuid, uuid, uuid) owner to postgres;

notify pgrst, 'reload schema';

commit;
