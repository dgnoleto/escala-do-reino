-- Candidato 020: Cadastro e Manutenção de Motivos de Cancelamento de Atividades (Issue #26)
-- Cobre critérios CA01 a CA04.
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
    raise exception 'Estrutura base de igrejas, acessos e auditoria (001-019) obrigatória.';
  end if;

  if to_regclass('app_private.cancellation_reasons') is not null then
    raise exception 'Tabela app_private.cancellation_reasons já existente. Parar e conferir.';
  end if;
end;
$preflight$;

-- 1. Tabela de Motivos de Cancelamento com isolamento por igreja
create table app_private.cancellation_reasons (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references app_private.churches(id) on delete restrict,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint cr_name_clean check (name = btrim(name) and char_length(name) between 1 and 120),
  constraint cr_church_id_id_unique unique (church_id, id),
  constraint cr_church_id_name_unique unique (church_id, lower(name))
);

create index cr_church_active_idx
  on app_private.cancellation_reasons (church_id, active, name);

create trigger cr_touch_updated_at
  before update on app_private.cancellation_reasons
  for each row execute function app_private.touch_updated_at();

alter table app_private.cancellation_reasons enable row level security;
revoke all on app_private.cancellation_reasons from public, anon, authenticated, service_role;

-- 2. Tabela de Recibos de Comandos para Idempotência
create table app_private.cancellation_reason_receipts (
  user_id uuid not null references auth.users(id) on delete restrict,
  command_id uuid not null,
  church_id uuid not null references app_private.churches(id) on delete restrict,
  action text not null,
  params jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default statement_timestamp(),
  primary key (user_id, command_id)
);

alter table app_private.cancellation_reason_receipts enable row level security;
revoke all on app_private.cancellation_reason_receipts from public, anon, authenticated, service_role;

-- 3. Função auxiliar para verificar se um motivo foi utilizado em cancelamentos históricos
create or replace function app_private.is_cancellation_reason_used(p_church_id uuid, p_reason_id uuid, p_reason_name text)
returns boolean
language plpgsql stable security definer set search_path = '' set statement_timeout = '5s'
as $function$
declare
  v_used boolean := false;
begin
  -- Verifica itens de cronograma cancelados em eventos da igreja
  if to_regclass('app_private.event_items') is not null then
    select exists (
      select 1 from app_private.event_items ei
      where ei.church_id = p_church_id
        and (ei.status = 'cancelled' or ei.cancel_reason is not null)
        and (lower(btrim(ei.cancel_reason)) = lower(btrim(p_reason_name)))
    ) into v_used;
    if v_used then return true; end if;
  end if;

  -- Verifica eventos cancelados
  if to_regclass('app_private.events') is not null then
    select exists (
      select 1 from app_private.events e
      where e.church_id = p_church_id
        and (e.status = 'cancelled' or e.cancel_reason is not null)
        and (lower(btrim(e.cancel_reason)) = lower(btrim(p_reason_name)))
    ) into v_used;
    if v_used then return true; end if;
  end if;

  -- Verifica registros históricos de cancelamento na auditoria
  if to_regclass('app_private.audit_entries') is not null then
    select exists (
      select 1 from app_private.audit_entries a
      where a.church_id = p_church_id
        and a.target_type in ('activity_cancellation', 'cancellation_reason')
        and (
          a.target_id = p_reason_id
          or (a.details->>'cancellation_reason_id')::uuid = p_reason_id
          or lower(btrim(coalesce(a.details->>'reason', ''))) = lower(btrim(p_reason_name))
        )
    ) into v_used;
    if v_used then return true; end if;
  end if;

  return false;
end;
$function$;
revoke all on function app_private.is_cancellation_reason_used(uuid, uuid, text) from public, anon, authenticated, service_role;

-- 4. RPC: Consulta de motivos de cancelamento
create or replace function public.list_cancellation_reasons(
  p_church_id uuid,
  p_only_active boolean default false
)
returns table(
  id uuid,
  name text,
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
    raise exception 'Acesso não autorizado aos dados desta igreja.' using errcode = '42501';
  end if;

  return query
  select
    cr.id,
    cr.name,
    cr.active,
    app_private.is_cancellation_reason_used(cr.church_id, cr.id, cr.name) as used_in_history,
    cr.created_at,
    cr.updated_at
  from app_private.cancellation_reasons cr
  where cr.church_id = p_church_id
    and (not p_only_active or cr.active = true)
  order by cr.active desc, cr.name asc;
end;
$function$;

-- 5. RPC: Cadastrar novo motivo de cancelamento (Exclusivo Administrador Web - CA01)
create or replace function public.create_cancellation_reason(
  p_church_id uuid,
  p_command_id uuid,
  p_name text
)
returns table(id uuid, name text, active boolean, command_id uuid)
language plpgsql security definer set search_path = '' set statement_timeout = '10s'
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_clean_name text;
  v_receipt app_private.cancellation_reason_receipts%rowtype;
  v_new_id uuid;
  v_reason app_private.cancellation_reasons%rowtype;
begin
  if v_uid is null then raise exception 'Não autenticado.' using errcode = '28000'; end if;
  if p_church_id is null or p_command_id is null or p_name is null then
    raise exception 'Parâmetros inválidos.' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(hashtext(v_uid::text), hashtext(p_command_id::text));

  select * into v_receipt
  from app_private.cancellation_reason_receipts
  where user_id = v_uid and command_id = p_command_id;

  if found then
    return query select
      (v_receipt.result->>'id')::uuid,
      v_receipt.result->>'name',
      (v_receipt.result->>'active')::boolean,
      v_receipt.command_id;
    return;
  end if;

  if not app_private.has_church_settings_access(p_church_id, true) then
    raise exception 'Apenas administradores ativos podem cadastrar motivos de cancelamento.' using errcode = '42501';
  end if;

  v_clean_name := pg_catalog.btrim(pg_catalog.normalize(p_name, 'NFC'));
  if char_length(v_clean_name) < 1 or char_length(v_clean_name) > 120 then
    raise exception 'Descrição do motivo deve ter entre 1 e 120 caracteres.' using errcode = '23514';
  end if;

  if exists (
    select 1 from app_private.cancellation_reasons
    where church_id = p_church_id and lower(name) = lower(v_clean_name)
  ) then
    raise exception 'Já existe um motivo de cancelamento cadastrado com este nome nesta igreja.' using errcode = '23505';
  end if;

  insert into app_private.cancellation_reasons (church_id, name, active)
  values (p_church_id, v_clean_name, true)
  returning * into v_reason;

  -- Auditoria
  insert into app_private.audit_entries (
    church_id, action, actor_user_id, actor_source, target_type, target_id, details
  ) values (
    p_church_id, 'create_cancellation_reason', v_uid, 'application',
    'cancellation_reason', v_reason.id,
    jsonb_build_object('name', v_clean_name, 'active', true)
  );

  -- Recibo
  insert into app_private.cancellation_reason_receipts (
    user_id, command_id, church_id, action, params, result
  ) values (
    v_uid, p_command_id, p_church_id, 'create_cancellation_reason',
    jsonb_build_object('church_id', p_church_id, 'name', v_clean_name),
    jsonb_build_object('id', v_reason.id, 'name', v_reason.name, 'active', v_reason.active)
  );

  return query select v_reason.id, v_reason.name, v_reason.active, p_command_id;
end;
$function$;

-- 6. RPC: Alterar descrição do motivo de cancelamento (CA01 & CA03)
create or replace function public.update_cancellation_reason(
  p_church_id uuid,
  p_command_id uuid,
  p_reason_id uuid,
  p_new_name text
)
returns table(id uuid, name text, active boolean, command_id uuid)
language plpgsql security definer set search_path = '' set statement_timeout = '10s'
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_clean_name text;
  v_prev_name text;
  v_receipt app_private.cancellation_reason_receipts%rowtype;
  v_reason app_private.cancellation_reasons%rowtype;
begin
  if v_uid is null then raise exception 'Não autenticado.' using errcode = '28000'; end if;
  if p_church_id is null or p_command_id is null or p_reason_id is null or p_new_name is null then
    raise exception 'Parâmetros inválidos.' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(hashtext(v_uid::text), hashtext(p_command_id::text));

  select * into v_receipt
  from app_private.cancellation_reason_receipts
  where user_id = v_uid and command_id = p_command_id;

  if found then
    return query select
      (v_receipt.result->>'id')::uuid,
      v_receipt.result->>'name',
      (v_receipt.result->>'active')::boolean,
      v_receipt.command_id;
    return;
  end if;

  if not app_private.has_church_settings_access(p_church_id, true) then
    raise exception 'Apenas administradores ativos podem alterar motivos de cancelamento.' using errcode = '42501';
  end if;

  v_clean_name := pg_catalog.btrim(pg_catalog.normalize(p_new_name, 'NFC'));
  if char_length(v_clean_name) < 1 or char_length(v_clean_name) > 120 then
    raise exception 'Descrição do motivo deve ter entre 1 e 120 caracteres.' using errcode = '23514';
  end if;

  select * into v_reason
  from app_private.cancellation_reasons
  where id = p_reason_id and church_id = p_church_id
  for update;

  if not found then
    raise exception 'Motivo de cancelamento não encontrado nesta igreja.' using errcode = 'P0002';
  end if;

  if exists (
    select 1 from app_private.cancellation_reasons
    where church_id = p_church_id and lower(name) = lower(v_clean_name) and id <> p_reason_id
  ) then
    raise exception 'Já existe um motivo de cancelamento cadastrado com este nome nesta igreja.' using errcode = '23505';
  end if;

  v_prev_name := v_reason.name;

  update app_private.cancellation_reasons
  set name = v_clean_name
  where id = p_reason_id and church_id = p_church_id
  returning * into v_reason;

  -- Auditoria
  insert into app_private.audit_entries (
    church_id, action, actor_user_id, actor_source, target_type, target_id, details
  ) values (
    p_church_id, 'update_cancellation_reason', v_uid, 'application',
    'cancellation_reason', v_reason.id,
    jsonb_build_object('previous_name', v_prev_name, 'new_name', v_clean_name)
  );

  -- Recibo
  insert into app_private.cancellation_reason_receipts (
    user_id, command_id, church_id, action, params, result
  ) values (
    v_uid, p_command_id, p_church_id, 'update_cancellation_reason',
    jsonb_build_object('reason_id', p_reason_id, 'name', v_clean_name),
    jsonb_build_object('id', v_reason.id, 'name', v_reason.name, 'active', v_reason.active)
  );

  return query select v_reason.id, v_reason.name, v_reason.active, p_command_id;
end;
$function$;

-- 7. RPC: Ativar ou desativar motivo de cancelamento (CA03)
create or replace function public.toggle_cancellation_reason_status(
  p_church_id uuid,
  p_command_id uuid,
  p_reason_id uuid,
  p_active boolean
)
returns table(id uuid, name text, active boolean, command_id uuid)
language plpgsql security definer set search_path = '' set statement_timeout = '10s'
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_receipt app_private.cancellation_reason_receipts%rowtype;
  v_reason app_private.cancellation_reasons%rowtype;
begin
  if v_uid is null then raise exception 'Não autenticado.' using errcode = '28000'; end if;
  if p_church_id is null or p_command_id is null or p_reason_id is null or p_active is null then
    raise exception 'Parâmetros inválidos.' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(hashtext(v_uid::text), hashtext(p_command_id::text));

  select * into v_receipt
  from app_private.cancellation_reason_receipts
  where user_id = v_uid and command_id = p_command_id;

  if found then
    return query select
      (v_receipt.result->>'id')::uuid,
      v_receipt.result->>'name',
      (v_receipt.result->>'active')::boolean,
      v_receipt.command_id;
    return;
  end if;

  if not app_private.has_church_settings_access(p_church_id, true) then
    raise exception 'Apenas administradores ativos podem alterar o status de motivos.' using errcode = '42501';
  end if;

  select * into v_reason
  from app_private.cancellation_reasons
  where id = p_reason_id and church_id = p_church_id
  for update;

  if not found then
    raise exception 'Motivo de cancelamento não encontrado nesta igreja.' using errcode = 'P0002';
  end if;

  update app_private.cancellation_reasons
  set active = p_active
  where id = p_reason_id and church_id = p_church_id
  returning * into v_reason;

  -- Auditoria
  insert into app_private.audit_entries (
    church_id, action, actor_user_id, actor_source, target_type, target_id, details
  ) values (
    p_church_id,
    case when p_active then 'activate_cancellation_reason' else 'deactivate_cancellation_reason' end,
    v_uid, 'application',
    'cancellation_reason', v_reason.id,
    jsonb_build_object('name', v_reason.name, 'active', p_active)
  );

  -- Recibo
  insert into app_private.cancellation_reason_receipts (
    user_id, command_id, church_id, action, params, result
  ) values (
    v_uid, p_command_id, p_church_id, 'toggle_cancellation_reason_status',
    jsonb_build_object('reason_id', p_reason_id, 'active', p_active),
    jsonb_build_object('id', v_reason.id, 'name', v_reason.name, 'active', v_reason.active)
  );

  return query select v_reason.id, v_reason.name, v_reason.active, p_command_id;
end;
$function$;

-- 8. RPC: Excluir motivo de cancelamento (com proteção contra exclusão de motivos em histórico - CA03)
create or replace function public.delete_cancellation_reason(
  p_church_id uuid,
  p_command_id uuid,
  p_reason_id uuid
)
returns table(id uuid, command_id uuid, deleted boolean)
language plpgsql security definer set search_path = '' set statement_timeout = '10s'
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_receipt app_private.cancellation_reason_receipts%rowtype;
  v_reason app_private.cancellation_reasons%rowtype;
  v_used boolean;
begin
  if v_uid is null then raise exception 'Não autenticado.' using errcode = '28000'; end if;
  if p_church_id is null or p_command_id is null or p_reason_id is null then
    raise exception 'Parâmetros inválidos.' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(hashtext(v_uid::text), hashtext(p_command_id::text));

  select * into v_receipt
  from app_private.cancellation_reason_receipts
  where user_id = v_uid and command_id = p_command_id;

  if found then
    return query select
      (v_receipt.result->>'id')::uuid,
      v_receipt.command_id,
      (v_receipt.result->>'deleted')::boolean;
    return;
  end if;

  if not app_private.has_church_settings_access(p_church_id, true) then
    raise exception 'Apenas administradores ativos podem excluir motivos de cancelamento.' using errcode = '42501';
  end if;

  select * into v_reason
  from app_private.cancellation_reasons
  where id = p_reason_id and church_id = p_church_id
  for update;

  if not found then
    raise exception 'Motivo de cancelamento não encontrado nesta igreja.' using errcode = 'P0002';
  end if;

  -- CA03: Bloqueio estrito se o motivo já foi referenciado em cancelamentos históricos
  v_used := app_private.is_cancellation_reason_used(p_church_id, p_reason_id, v_reason.name);
  if v_used then
    raise exception 'Este motivo já foi utilizado em cancelamentos históricos e não pode ser excluído; você pode desativá-lo para que não seja mais selecionado.'
      using errcode = '23503';
  end if;

  delete from app_private.cancellation_reasons
  where id = p_reason_id and church_id = p_church_id;

  -- Auditoria
  insert into app_private.audit_entries (
    church_id, action, actor_user_id, actor_source, target_type, target_id, details
  ) values (
    p_church_id, 'delete_cancellation_reason', v_uid, 'application',
    'cancellation_reason', p_reason_id,
    jsonb_build_object('name', v_reason.name)
  );

  -- Recibo
  insert into app_private.cancellation_reason_receipts (
    user_id, command_id, church_id, action, params, result
  ) values (
    v_uid, p_command_id, p_church_id, 'delete_cancellation_reason',
    jsonb_build_object('reason_id', p_reason_id),
    jsonb_build_object('id', p_reason_id, 'deleted', true)
  );

  return query select p_reason_id, p_command_id, true;
end;
$function$;

-- Privilégios e proprietário
revoke all on function public.list_cancellation_reasons(uuid, boolean) from public, anon, service_role;
grant execute on function public.list_cancellation_reasons(uuid, boolean) to authenticated;
alter function public.list_cancellation_reasons(uuid, boolean) owner to postgres;

revoke all on function public.create_cancellation_reason(uuid, uuid, text) from public, anon, service_role;
grant execute on function public.create_cancellation_reason(uuid, uuid, text) to authenticated;
alter function public.create_cancellation_reason(uuid, uuid, text) owner to postgres;

revoke all on function public.update_cancellation_reason(uuid, uuid, uuid, text) from public, anon, service_role;
grant execute on function public.update_cancellation_reason(uuid, uuid, uuid, text) to authenticated;
alter function public.update_cancellation_reason(uuid, uuid, uuid, text) owner to postgres;

revoke all on function public.toggle_cancellation_reason_status(uuid, uuid, uuid, boolean) from public, anon, service_role;
grant execute on function public.toggle_cancellation_reason_status(uuid, uuid, uuid, boolean) to authenticated;
alter function public.toggle_cancellation_reason_status(uuid, uuid, uuid, boolean) owner to postgres;

revoke all on function public.delete_cancellation_reason(uuid, uuid, uuid) from public, anon, service_role;
grant execute on function public.delete_cancellation_reason(uuid, uuid, uuid) to authenticated;
alter function public.delete_cancellation_reason(uuid, uuid, uuid) owner to postgres;

notify pgrst, 'reload schema';

commit;
