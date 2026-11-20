-- ==============================================================================
-- 026_rollback.sql
-- Reversão Cirúrgica e Transacional do Incremento B2 v1.0 (Issues #29 e #30)
--
-- ESCOPO:
-- Restaura exatamente o baseline do banco ao estado anterior ao incremento 026:
-- 1. Verificação fail-closed: recusa se houver dados com prep_required_minutes <> 0.
-- 2. Remoção das 3 RPCs novas: get_event_program, update_event_item, remove_event_item.
-- 3. Restauração literal da assinatura e lógica original de create_event_item (9 parâmetros, SQL 016).
-- 4. Restauração literal de list_church_events ao formato canônico do SQL 015.
-- 5. Restauração literal das 4 RPCs de planejamento ao formato canônico do SQL 025.
-- 6. Remoção das constraints e da coluna prep_required_minutes em event_items.
-- 7. Restauração estrita de ACLs, owners e recarga do cache do PostgREST.
-- 8. Asserções pós-condição comprovando a restauração fiel do baseline.
-- ==============================================================================

\set ON_ERROR_STOP on

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- ------------------------------------------------------------------------------
-- 1. VERIFICAÇÃO FAIL-CLOSED CONTRA PERDA DE DADOS NÃO-ZERO
-- ------------------------------------------------------------------------------
do $guard$
declare
  v_non_zero_count integer;
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'app_private' and table_name = 'event_items' and column_name = 'prep_required_minutes'
  ) then
    select count(*) into v_non_zero_count
    from app_private.event_items
    where prep_required_minutes <> 0;

    if v_non_zero_count > 0 then
      raise exception 'ROLLBACK ABORTADO (FAIL-CLOSED): Existem % itens com prep_required_minutes diferente de zero. A remoção da coluna causaria perda irreversível de dados.', v_non_zero_count
        using errcode = '23514';
    end if;
  end if;
end;
$guard$;

-- ------------------------------------------------------------------------------
-- 2. REMOÇÃO DAS RPCS NOVAS DE B2
-- ------------------------------------------------------------------------------
drop function if exists public.get_event_program(uuid, uuid);
drop function if exists public.update_event_item(uuid, uuid, uuid, uuid, text, integer, integer, uuid, uuid, timestamptz);
drop function if exists public.remove_event_item(uuid, uuid, uuid, uuid, timestamptz);
drop function if exists public.create_event_item(uuid, uuid, uuid, text, text, integer, integer, uuid, uuid, integer);

-- ------------------------------------------------------------------------------
-- 3. RESTAURAÇÃO LITERAL DE public.create_event_item (SQL 016 LINHAS 2433–2672)
-- ------------------------------------------------------------------------------
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
  -- 016: decisões após espera exigem snapshots novos por instrução.
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Esta operação exige READ COMMITTED.' using errcode = '42501';
  end if;
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

  if p_nominal_leader_member_id is not null then
    perform 1 from app_private.members m
    where m.church_id=p_church_id and m.id=p_nominal_leader_member_id and m.status='active' for update;
    if not found then raise exception 'Responsável não encontrado ou inativo nesta igreja.' using errcode='P0020'; end if;
  end if;

  if p_designated_team_id is not null then
    perform 1 from app_private.teams t where t.church_id=p_church_id and t.id=p_designated_team_id for share;
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

-- ------------------------------------------------------------------------------
-- 4. RESTAURAÇÃO LITERAL DE public.list_church_events (SQL 015 LINHAS 3901–4008)
-- ------------------------------------------------------------------------------
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

-- ------------------------------------------------------------------------------
-- 5. RESTAURAÇÃO LITERAL DAS 4 RPCS DE PLANEJAMENTO (SQL 025)
-- ------------------------------------------------------------------------------

-- 5.1 reorder_event_items (SQL 025 linhas 80–361)
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
  v_preliminary_member_id uuid;
  v_caller_member_id uuid;
  v_is_admin boolean;
  v_event app_private.events%rowtype;
  v_item_id uuid;
  v_order integer := 1;
  v_created_at timestamptz;
  v_payload jsonb;
  v_existing_receipt app_private.event_planning_receipts%rowtype;
  v_params_hash jsonb;
  v_items_count integer;
  v_matching_items_count integer;
  c_action constant text := 'reorder_event_items';
begin
  -- 1. Delimitação de isolamento transacional suportado (Achado A4)
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Esta operação exige READ COMMITTED.' using errcode = '42501';
  end if;

  -- 2. Autenticação obrigatória
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  -- 3. Parâmetros obrigatórios e integridade estrutural
  if p_church_id is null or p_command_id is null or p_event_id is null or p_ordered_item_ids is null then
    raise exception 'Parâmetros obrigatórios ausentes.' using errcode = '22004';
  end if;

  -- Validação estrita de NULL em elementos do array (imune a armadilhas de comparação do SQL)
  if array_position(p_ordered_item_ids, null) is not null then
    raise exception 'Lista de itens ordenada não pode conter valores nulos.' using errcode = '22023';
  end if;

  -- 4. Checagem preliminar não-autoritativa (fail-fast contra chamadores ilegítimos)
  select ca.member_id, coalesce(ca.is_admin, false)
  into v_preliminary_member_id, v_is_admin
  from app_private.church_access ca
  join auth.users u on u.id = ca.user_id
  join app_private.churches c on c.id = ca.church_id
  join app_private.members m on m.id = ca.member_id and m.church_id = ca.church_id
  where ca.church_id = p_church_id
    and ca.user_id = v_user_id
    and ca.status = 'active'
    and ca.onboarding_completed_at is not null
    and c.status = 'active'
    and m.status = 'active'
    and u.email_confirmed_at is not null
    and u.deleted_at is null
    and not coalesce(u.is_anonymous, false)
    and (u.banned_until is null or u.banned_until <= clock_timestamp());

  if v_preliminary_member_id is null then
    raise exception 'Usuário sem vínculo ativo com a igreja.' using errcode = '42501';
  end if;

  -- 5. Parâmetros canônicos para idempotência
  v_params_hash := jsonb_build_object(
    'event_id', p_event_id,
    'ordered_item_ids', to_jsonb(p_ordered_item_ids)
  );

  -- 6. Ordem demonstrável de locks — 1º: Comando de Idempotência
  perform pg_catalog.pg_advisory_xact_lock(hashtext(v_user_id::text), hashtext(p_command_id::text));

  -- 7. Validação de divergência de recibo existente
  select r.* into v_existing_receipt
  from app_private.event_planning_receipts r
  where r.user_id = v_user_id and r.command_id = p_command_id;

  if found then
    if v_existing_receipt.church_id <> p_church_id
       or v_existing_receipt.action <> c_action
       or v_existing_receipt.params <> v_params_hash then
      raise exception 'Comando já utilizado com outros parâmetros.' using errcode = '23505';
    end if;
    -- Abordagem 1 (Segurança Estrita, Achado A3): Replay NÃO retorna aqui.
    -- Segue adiante para confirmar autoridade atual sobre o evento antes de devolver o resultado.
  end if;

  -- 8. Ordem demonstrável de locks — 2º: Estado da Igreja (protege status ativo contra alteração concorrente)
  perform 1
  from app_private.churches c
  where c.id = p_church_id and c.status = 'active'
  for share;

  if not found then
    raise exception 'Igreja inativa ou inexistente.' using errcode = '42501';
  end if;

  -- 9. Ordem demonstrável de locks — 3º: Vínculo de Acesso do Chamador (Achados B1/B2)
  -- Bloqueia a linha de church_access do chamador antes de members, em estrita compatibilidade
  -- com o protocolo canônico do SQL 016 (deactivate_church_member e public.restore_church_member).
  select ca.member_id, coalesce(ca.is_admin, false)
  into v_caller_member_id, v_is_admin
  from app_private.church_access ca
  where ca.church_id = p_church_id
    and ca.user_id = v_user_id
    and ca.status = 'active'
    and ca.onboarding_completed_at is not null
  for share;

  if v_caller_member_id is null then
    raise exception 'Vínculo de acesso inativo ou revogado nesta igreja.' using errcode = '42501';
  end if;

  if v_caller_member_id <> v_preliminary_member_id then
    raise exception 'Inconsistência cadastral no vínculo de acesso do chamador.' using errcode = '42501';
  end if;

  -- 10. Ordem demonstrável de locks — 4º: Membro do Chamador (Achados B1/B2)
  -- Bloqueia o membro correspondente obtido do acesso bloqueado antes de events, em estrita
  -- compatibilidade com SQL 016 create_event_item e SQL 015 assign_event_participant.
  perform 1
  from app_private.members m
  where m.church_id = p_church_id
    and m.id = v_caller_member_id
    and m.status = 'active'
  for share;

  if not found then
    raise exception 'Membro inativo ou inexistente nesta igreja.' using errcode = '42501';
  end if;

  -- 11. Ordem demonstrável de locks — 5º: Conta Auth do Chamador
  -- Bloqueia a conta auth para validação de banimento, exclusão e confirmação de e-mail.
  perform 1
  from auth.users u
  where u.id = v_user_id
    and u.email_confirmed_at is not null
    and u.deleted_at is null
    and not coalesce(u.is_anonymous, false)
    and (u.banned_until is null or u.banned_until <= clock_timestamp())
  for share;

  if not found then
    raise exception 'Conta de usuário inativa, não confirmada ou suspensa.' using errcode = '42501';
  end if;

  -- 12. Ordem demonstrável de locks — 6º: Evento Alvo (serialização de mutações no evento)
  select * into v_event
  from app_private.events e
  where e.church_id = p_church_id and e.id = p_event_id
  for update;

  if not found then
    raise exception 'Evento não encontrado.' using errcode = 'P0002';
  end if;

  -- 13. Revalidação definitiva de autoridade e elegibilidade após esperas por locks (Achado A2, B1)
  -- Reavalia church_access, members, churches e auth.users protegendo contra mutações concorrentes durante a espera
  select ca.member_id, coalesce(ca.is_admin, false)
  into v_caller_member_id, v_is_admin
  from app_private.church_access ca
  join app_private.members m on m.id = ca.member_id and m.church_id = ca.church_id
  join auth.users u on u.id = ca.user_id
  join app_private.churches c on c.id = ca.church_id
  where ca.church_id = p_church_id
    and ca.user_id = v_user_id
    and ca.status = 'active'
    and ca.onboarding_completed_at is not null
    and c.status = 'active'
    and m.status = 'active'
    and u.email_confirmed_at is not null
    and u.deleted_at is null
    and not coalesce(u.is_anonymous, false)
    and (u.banned_until is null or u.banned_until <= clock_timestamp());

  if v_caller_member_id is null then
    raise exception 'Acesso revogado durante a espera pelo evento.' using errcode = '42501';
  end if;

  -- Autorização estrita sobre o evento: admin elegível OU líder da liturgia deste evento (NULL nunca concede permissão)
  if not (
    coalesce(v_is_admin, false) = true
    or (
      v_event.liturgy_leader_member_id is not null
      and v_caller_member_id is not null
      and v_event.liturgy_leader_member_id = v_caller_member_id
    )
  ) then
    raise exception 'Permissão insuficiente para reordenar este evento.' using errcode = '42501';
  end if;

  -- 14. Retorno de Replay sob Abordagem 1 - Segurança Estrita (Achado A3)
  -- Somente retorna o recibo histórico APÓS confirmar a autoridade atual sobre o evento
  if v_existing_receipt.command_id is not null then
    return query select
      p_command_id,
      c_action,
      p_church_id,
      (v_existing_receipt.result->>'event_id')::uuid,
      v_existing_receipt.result,
      v_existing_receipt.created_at;
    return;
  end if;

  -- 15. Validação de integridade e pertencimento dos itens informados (aceita subconjuntos válidos e array vazio)
  v_items_count := coalesce(cardinality(p_ordered_item_ids), 0);

  if v_items_count > 0 then
    select count(distinct ei.id) into v_matching_items_count
    from app_private.event_items ei
    where ei.church_id = p_church_id
      and ei.event_id = p_event_id
      and ei.id = any(p_ordered_item_ids);

    if v_matching_items_count <> v_items_count then
      raise exception 'Um ou mais itens não pertencem a este evento ou foram informados em duplicidade.' using errcode = '22023';
    end if;

    -- Execução atômica da reordenação dos itens informados
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
  else
    v_created_at := clock_timestamp();
  end if;

  update app_private.events e
  set updated_at = v_created_at
  where e.church_id = p_church_id and e.id = p_event_id;

  -- Preserva preferencialmente o payload original do SQL 023 (array_length)
  v_payload := jsonb_build_object(
    'event_id', p_event_id,
    'total_items_reordered', array_length(p_ordered_item_ids, 1)
  );

  -- 16. Persistência de recibo e auditoria
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

-- 5.2 set_event_duration_policy (SQL 025 linhas 366–615)
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
  v_preliminary_member_id uuid;
  v_caller_member_id uuid;
  v_is_admin boolean;
  v_event app_private.events%rowtype;
  v_policy_clean text;
  v_created_at timestamptz;
  v_payload jsonb;
  v_existing_receipt app_private.event_planning_receipts%rowtype;
  v_params_hash jsonb;
  c_action constant text := 'set_event_duration_policy';
begin
  -- 1. Delimitação de isolamento transacional suportado (Achado A4)
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Esta operação exige READ COMMITTED.' using errcode = '42501';
  end if;

  -- 2. Autenticação obrigatória
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  -- 3. Parâmetros obrigatórios e sanitização da política
  if p_church_id is null or p_command_id is null or p_event_id is null or p_duration_policy is null then
    raise exception 'Parâmetros obrigatórios ausentes.' using errcode = '22004';
  end if;

  v_policy_clean := lower(btrim(p_duration_policy));
  if v_policy_clean not in ('warn', 'block') then
    raise exception 'Política de duração inválida. Opções: warn ou block.' using errcode = '22000';
  end if;

  -- 4. Checagem preliminar não-autoritativa (fail-fast contra chamadores ilegítimos)
  select ca.member_id, coalesce(ca.is_admin, false)
  into v_preliminary_member_id, v_is_admin
  from app_private.church_access ca
  join auth.users u on u.id = ca.user_id
  join app_private.churches c on c.id = ca.church_id
  join app_private.members m on m.id = ca.member_id and m.church_id = ca.church_id
  where ca.church_id = p_church_id
    and ca.user_id = v_user_id
    and ca.status = 'active'
    and ca.onboarding_completed_at is not null
    and c.status = 'active'
    and m.status = 'active'
    and u.email_confirmed_at is not null
    and u.deleted_at is null
    and not coalesce(u.is_anonymous, false)
    and (u.banned_until is null or u.banned_until <= clock_timestamp());

  if v_preliminary_member_id is null then
    raise exception 'Usuário sem vínculo ativo com a igreja.' using errcode = '42501';
  end if;

  -- 5. Parâmetros canônicos para idempotência
  v_params_hash := jsonb_build_object(
    'event_id', p_event_id,
    'duration_policy', v_policy_clean
  );

  -- 6. Ordem demonstrável de locks — 1º: Comando de Idempotência
  perform pg_catalog.pg_advisory_xact_lock(hashtext(v_user_id::text), hashtext(p_command_id::text));

  -- 7. Validação de divergência de recibo existente
  select r.* into v_existing_receipt
  from app_private.event_planning_receipts r
  where r.user_id = v_user_id and r.command_id = p_command_id;

  if found then
    if v_existing_receipt.church_id <> p_church_id
       or v_existing_receipt.action <> c_action
       or v_existing_receipt.params <> v_params_hash then
      raise exception 'Comando já utilizado com outros parâmetros.' using errcode = '23505';
    end if;
    -- Abordagem 1 (Segurança Estrita, Achado A3): Replay aguarda confirmação de autoridade atual sobre o evento.
  end if;

  -- 8. Ordem demonstrável de locks — 2º: Estado da Igreja (protege status ativo contra alteração concorrente)
  perform 1
  from app_private.churches c
  where c.id = p_church_id and c.status = 'active'
  for share;

  if not found then
    raise exception 'Igreja inativa ou inexistente.' using errcode = '42501';
  end if;

  -- 9. Ordem demonstrável de locks — 3º: Vínculo de Acesso do Chamador (Achados B1/B2)
  -- Bloqueia a linha de church_access do chamador antes de members, em estrita compatibilidade
  -- com o protocolo canônico do SQL 016 (deactivate_church_member e public.restore_church_member).
  select ca.member_id, coalesce(ca.is_admin, false)
  into v_caller_member_id, v_is_admin
  from app_private.church_access ca
  where ca.church_id = p_church_id
    and ca.user_id = v_user_id
    and ca.status = 'active'
    and ca.onboarding_completed_at is not null
  for share;

  if v_caller_member_id is null then
    raise exception 'Vínculo de acesso inativo ou revogado nesta igreja.' using errcode = '42501';
  end if;

  if v_caller_member_id <> v_preliminary_member_id then
    raise exception 'Inconsistência cadastral no vínculo de acesso do chamador.' using errcode = '42501';
  end if;

  -- 10. Ordem demonstrável de locks — 4º: Membro do Chamador (Achados B1/B2)
  -- Bloqueia o membro correspondente obtido do acesso bloqueado antes de events, em estrita
  -- compatibilidade com SQL 016 create_event_item e SQL 015 assign_event_participant.
  perform 1
  from app_private.members m
  where m.church_id = p_church_id
    and m.id = v_caller_member_id
    and m.status = 'active'
  for share;

  if not found then
    raise exception 'Membro inativo ou inexistente nesta igreja.' using errcode = '42501';
  end if;

  -- 11. Ordem demonstrável de locks — 5º: Conta Auth do Chamador
  -- Bloqueia a conta auth para validação de banimento, exclusão e confirmação de e-mail.
  perform 1
  from auth.users u
  where u.id = v_user_id
    and u.email_confirmed_at is not null
    and u.deleted_at is null
    and not coalesce(u.is_anonymous, false)
    and (u.banned_until is null or u.banned_until <= clock_timestamp())
  for share;

  if not found then
    raise exception 'Conta de usuário inativa, não confirmada ou suspensa.' using errcode = '42501';
  end if;

  -- 12. Ordem demonstrável de locks — 6º: Evento Alvo (serialização de mutações no evento)
  select * into v_event
  from app_private.events e
  where e.church_id = p_church_id and e.id = p_event_id
  for update;

  if not found then
    raise exception 'Evento não encontrado.' using errcode = 'P0002';
  end if;

  -- 13. Revalidação definitiva de autoridade e elegibilidade após esperas por locks (Achado A2, B1)
  -- Reavalia church_access, members, churches e auth.users protegendo contra mutações concorrentes durante a espera
  select ca.member_id, coalesce(ca.is_admin, false)
  into v_caller_member_id, v_is_admin
  from app_private.church_access ca
  join app_private.members m on m.id = ca.member_id and m.church_id = ca.church_id
  join auth.users u on u.id = ca.user_id
  join app_private.churches c on c.id = ca.church_id
  where ca.church_id = p_church_id
    and ca.user_id = v_user_id
    and ca.status = 'active'
    and ca.onboarding_completed_at is not null
    and c.status = 'active'
    and m.status = 'active'
    and u.email_confirmed_at is not null
    and u.deleted_at is null
    and not coalesce(u.is_anonymous, false)
    and (u.banned_until is null or u.banned_until <= clock_timestamp())
  for share of ca, m, u;

  if v_caller_member_id is null then
    raise exception 'Acesso revogado durante a espera pelo evento.' using errcode = '42501';
  end if;

  -- Autorização estrita sobre o evento: admin elegível OU líder da liturgia deste evento (NULL nunca concede permissão)
  if not (
    coalesce(v_is_admin, false) = true
    or (
      v_event.liturgy_leader_member_id is not null
      and v_caller_member_id is not null
      and v_event.liturgy_leader_member_id = v_caller_member_id
    )
  ) then
    raise exception 'Permissão insuficiente para alterar a política de duração.' using errcode = '42501';
  end if;

  -- 14. Retorno de Replay sob Abordagem 1 - Segurança Estrita (Achado A3)
  if v_existing_receipt.command_id is not null then
    return query select
      p_command_id,
      c_action,
      p_church_id,
      (v_existing_receipt.result->>'event_id')::uuid,
      v_existing_receipt.result,
      v_existing_receipt.created_at;
    return;
  end if;

  -- 15. Execução da mutação
  v_created_at := clock_timestamp();

  update app_private.events e
  set duration_policy = v_policy_clean,
      updated_at = v_created_at
  where e.church_id = p_church_id and e.id = p_event_id;

  v_payload := jsonb_build_object(
    'event_id', p_event_id,
    'duration_policy', v_policy_clean
  );

  -- 16. Persistência de recibo e auditoria
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

-- 5.3 publish_event_program (SQL 025 linhas 620–887)
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
  v_preliminary_member_id uuid;
  v_caller_member_id uuid;
  v_is_admin boolean;
  v_event app_private.events%rowtype;
  v_total_occupied_seconds integer;
  v_available_seconds integer;
  v_overflow_seconds integer;
  v_created_at timestamptz;
  v_payload jsonb;
  v_existing_receipt app_private.event_planning_receipts%rowtype;
  v_params_hash jsonb;
  c_action constant text := 'publish_event_program';
begin
  -- 1. Delimitação de isolamento transacional suportado (Achado A4)
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Esta operação exige READ COMMITTED.' using errcode = '42501';
  end if;

  -- 2. Autenticação obrigatória
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  -- 3. Parâmetros obrigatórios
  if p_church_id is null or p_command_id is null or p_event_id is null then
    raise exception 'Parâmetros obrigatórios ausentes.' using errcode = '22004';
  end if;

  -- 4. Checagem preliminar não-autoritativa (fail-fast contra chamadores ilegítimos)
  select ca.member_id, coalesce(ca.is_admin, false)
  into v_preliminary_member_id, v_is_admin
  from app_private.church_access ca
  join auth.users u on u.id = ca.user_id
  join app_private.churches c on c.id = ca.church_id
  join app_private.members m on m.id = ca.member_id and m.church_id = ca.church_id
  where ca.church_id = p_church_id
    and ca.user_id = v_user_id
    and ca.status = 'active'
    and ca.onboarding_completed_at is not null
    and c.status = 'active'
    and m.status = 'active'
    and u.email_confirmed_at is not null
    and u.deleted_at is null
    and not coalesce(u.is_anonymous, false)
    and (u.banned_until is null or u.banned_until <= clock_timestamp());

  if v_preliminary_member_id is null then
    raise exception 'Usuário sem vínculo ativo com a igreja.' using errcode = '42501';
  end if;

  -- 5. Parâmetros canônicos para idempotência
  v_params_hash := jsonb_build_object('event_id', p_event_id);

  -- 6. Ordem demonstrável de locks — 1º: Comando de Idempotência
  perform pg_catalog.pg_advisory_xact_lock(hashtext(v_user_id::text), hashtext(p_command_id::text));

  -- 7. Validação de divergência de recibo existente
  select r.* into v_existing_receipt
  from app_private.event_planning_receipts r
  where r.user_id = v_user_id and r.command_id = p_command_id;

  if found then
    if v_existing_receipt.church_id <> p_church_id
       or v_existing_receipt.action <> c_action
       or v_existing_receipt.params <> v_params_hash then
      raise exception 'Comando já utilizado com outros parâmetros.' using errcode = '23505';
    end if;
    -- Abordagem 1 (Segurança Estrita, Achado A3): Replay aguarda confirmação de autoridade atual sobre o evento.
  end if;

  -- 8. Ordem demonstrável de locks — 2º: Estado da Igreja (protege status ativo contra alteração concorrente)
  perform 1
  from app_private.churches c
  where c.id = p_church_id and c.status = 'active'
  for share;

  if not found then
    raise exception 'Igreja inativa ou inexistente.' using errcode = '42501';
  end if;

  -- 9. Ordem demonstrável de locks — 3º: Vínculo de Acesso do Chamador (Achados B1/B2)
  -- Bloqueia a linha de church_access do chamador antes de members, em estrita compatibilidade
  -- com o protocolo canônico do SQL 016 (deactivate_church_member e public.restore_church_member).
  select ca.member_id, coalesce(ca.is_admin, false)
  into v_caller_member_id, v_is_admin
  from app_private.church_access ca
  where ca.church_id = p_church_id
    and ca.user_id = v_user_id
    and ca.status = 'active'
    and ca.onboarding_completed_at is not null
  for share;

  if v_caller_member_id is null then
    raise exception 'Vínculo de acesso inativo ou revogado nesta igreja.' using errcode = '42501';
  end if;

  if v_caller_member_id <> v_preliminary_member_id then
    raise exception 'Inconsistência cadastral no vínculo de acesso do chamador.' using errcode = '42501';
  end if;

  -- 10. Ordem demonstrável de locks — 4º: Membro do Chamador (Achados B1/B2)
  -- Bloqueia o membro correspondente obtido do acesso bloqueado antes de events, em estrita
  -- compatibilidade com SQL 016 create_event_item e SQL 015 assign_event_participant.
  perform 1
  from app_private.members m
  where m.church_id = p_church_id
    and m.id = v_caller_member_id
    and m.status = 'active'
  for share;

  if not found then
    raise exception 'Membro inativo ou inexistente nesta igreja.' using errcode = '42501';
  end if;

  -- 11. Ordem demonstrável de locks — 5º: Conta Auth do Chamador
  -- Bloqueia a conta auth para validação de banimento, exclusão e confirmação de e-mail.
  perform 1
  from auth.users u
  where u.id = v_user_id
    and u.email_confirmed_at is not null
    and u.deleted_at is null
    and not coalesce(u.is_anonymous, false)
    and (u.banned_until is null or u.banned_until <= clock_timestamp())
  for share;

  if not found then
    raise exception 'Conta de usuário inativa, não confirmada ou suspensa.' using errcode = '42501';
  end if;

  -- 12. Ordem demonstrável de locks — 6º: Evento Alvo (serialização de mutações no evento)
  select * into v_event
  from app_private.events e
  where e.church_id = p_church_id and e.id = p_event_id
  for update;

  if not found then
    raise exception 'Evento não encontrado.' using errcode = 'P0002';
  end if;

  -- 13. Revalidação definitiva de autoridade e elegibilidade após esperas por locks (Achado A2, B1)
  -- Reavalia church_access, members, churches e auth.users protegendo contra mutações concorrentes durante a espera
  select ca.member_id, coalesce(ca.is_admin, false)
  into v_caller_member_id, v_is_admin
  from app_private.church_access ca
  join app_private.members m on m.id = ca.member_id and m.church_id = ca.church_id
  join auth.users u on u.id = ca.user_id
  join app_private.churches c on c.id = ca.church_id
  where ca.church_id = p_church_id
    and ca.user_id = v_user_id
    and ca.status = 'active'
    and ca.onboarding_completed_at is not null
    and c.status = 'active'
    and m.status = 'active'
    and u.email_confirmed_at is not null
    and u.deleted_at is null
    and not coalesce(u.is_anonymous, false)
    and (u.banned_until is null or u.banned_until <= clock_timestamp());

  if v_caller_member_id is null then
    raise exception 'Acesso revogado durante a espera pelo evento.' using errcode = '42501';
  end if;

  -- Autorização estrita sobre o evento: admin elegível OU líder da liturgia deste evento (NULL nunca concede permissão)
  if not (
    coalesce(v_is_admin, false) = true
    or (
      v_event.liturgy_leader_member_id is not null
      and v_caller_member_id is not null
      and v_event.liturgy_leader_member_id = v_caller_member_id
    )
  ) then
    raise exception 'Permissão insuficiente para publicar a programação deste evento.' using errcode = '42501';
  end if;

  -- 14. Retorno de Replay sob Abordagem 1 - Segurança Estrita (Achado A3)
  if v_existing_receipt.command_id is not null then
    return query select
      p_command_id,
      c_action,
      p_church_id,
      (v_existing_receipt.result->>'event_id')::uuid,
      v_existing_receipt.result,
      v_existing_receipt.created_at;
    return;
  end if;

  -- 15. Apuração de duração e verificação da política de bloqueio
  v_available_seconds := extract(epoch from (v_event.planned_end_at - v_event.planned_start_at))::integer;

  select coalesce(sum(ei.planned_duration_seconds), 0)
  into v_total_occupied_seconds
  from app_private.event_items ei
  where ei.church_id = p_church_id
    and ei.event_id = p_event_id
    and ei.item_nature = 'liturgical'
    and ei.status <> 'cancelled';

  v_overflow_seconds := greatest(0, v_total_occupied_seconds - v_available_seconds);

  if v_event.duration_policy = 'block' and v_overflow_seconds > 0 then
    raise exception 'A programação excede o limite planejado em % segundos. No modo de bloqueio, ajuste a duração antes de publicar.',
      v_overflow_seconds using errcode = '22000';
  end if;

  -- 16. Execução da publicação com incremento seguro de versão sob row-lock
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

  -- 17. Persistência de recibo e auditoria
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

-- 5.4 save_event_program_draft (SQL 025 linhas 892–1130)
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
  v_preliminary_member_id uuid;
  v_caller_member_id uuid;
  v_is_admin boolean;
  v_event app_private.events%rowtype;
  v_created_at timestamptz;
  v_payload jsonb;
  v_existing_receipt app_private.event_planning_receipts%rowtype;
  v_params_hash jsonb;
  c_action constant text := 'save_event_program_draft';
begin
  -- 1. Delimitação de isolamento transacional suportado (Achado A4)
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Esta operação exige READ COMMITTED.' using errcode = '42501';
  end if;

  -- 2. Autenticação obrigatória
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  -- 3. Parâmetros obrigatórios
  if p_church_id is null or p_command_id is null or p_event_id is null then
    raise exception 'Parâmetros obrigatórios ausentes.' using errcode = '22004';
  end if;

  -- 4. Checagem preliminar não-autoritativa (fail-fast contra chamadores ilegítimos)
  select ca.member_id, coalesce(ca.is_admin, false)
  into v_preliminary_member_id, v_is_admin
  from app_private.church_access ca
  join auth.users u on u.id = ca.user_id
  join app_private.churches c on c.id = ca.church_id
  join app_private.members m on m.id = ca.member_id and m.church_id = ca.church_id
  where ca.church_id = p_church_id
    and ca.user_id = v_user_id
    and ca.status = 'active'
    and ca.onboarding_completed_at is not null
    and c.status = 'active'
    and m.status = 'active'
    and u.email_confirmed_at is not null
    and u.deleted_at is null
    and not coalesce(u.is_anonymous, false)
    and (u.banned_until is null or u.banned_until <= clock_timestamp());

  if v_preliminary_member_id is null then
    raise exception 'Usuário sem vínculo ativo com a igreja.' using errcode = '42501';
  end if;

  -- 5. Parâmetros canônicos para idempotência
  v_params_hash := jsonb_build_object('event_id', p_event_id);

  -- 6. Ordem demonstrável de locks — 1º: Comando de Idempotência
  perform pg_catalog.pg_advisory_xact_lock(hashtext(v_user_id::text), hashtext(p_command_id::text));

  -- 7. Validação de divergência de recibo existente
  select r.* into v_existing_receipt
  from app_private.event_planning_receipts r
  where r.user_id = v_user_id and r.command_id = p_command_id;

  if found then
    if v_existing_receipt.church_id <> p_church_id
       or v_existing_receipt.action <> c_action
       or v_existing_receipt.params <> v_params_hash then
      raise exception 'Comando já utilizado com outros parâmetros.' using errcode = '23505';
    end if;
    -- Abordagem 1 (Segurança Estrita, Achado A3): Replay aguarda confirmação de autoridade atual sobre o evento.
  end if;

  -- 8. Ordem demonstrável de locks — 2º: Estado da Igreja (protege status ativo contra alteração concorrente)
  perform 1
  from app_private.churches c
  where c.id = p_church_id and c.status = 'active'
  for share;

  if not found then
    raise exception 'Igreja inativa ou inexistente.' using errcode = '42501';
  end if;

  -- 9. Ordem demonstrável de locks — 3º: Vínculo de Acesso do Chamador (Achados B1/B2)
  -- Bloqueia a linha de church_access do chamador antes de members, em estrita compatibilidade
  -- com o protocolo canônico do SQL 016 (deactivate_church_member e public.restore_church_member).
  select ca.member_id, coalesce(ca.is_admin, false)
  into v_caller_member_id, v_is_admin
  from app_private.church_access ca
  where ca.church_id = p_church_id
    and ca.user_id = v_user_id
    and ca.status = 'active'
    and ca.onboarding_completed_at is not null
  for share;

  if v_caller_member_id is null then
    raise exception 'Vínculo de acesso inativo ou revogado nesta igreja.' using errcode = '42501';
  end if;

  if v_caller_member_id <> v_preliminary_member_id then
    raise exception 'Inconsistência cadastral no vínculo de acesso do chamador.' using errcode = '42501';
  end if;

  -- 10. Ordem demonstrável de locks — 4º: Membro do Chamador (Achados B1/B2)
  -- Bloqueia o membro correspondente obtido do acesso bloqueado antes de events, em estrita
  -- compatibilidade com SQL 016 create_event_item e SQL 015 assign_event_participant.
  perform 1
  from app_private.members m
  where m.church_id = p_church_id
    and m.id = v_caller_member_id
    and m.status = 'active'
  for share;

  if not found then
    raise exception 'Membro inativo ou inexistente nesta igreja.' using errcode = '42501';
  end if;

  -- 11. Ordem demonstrável de locks — 5º: Conta Auth do Chamador
  -- Bloqueia a conta auth para validação de banimento, exclusão e confirmação de e-mail.
  perform 1
  from auth.users u
  where u.id = v_user_id
    and u.email_confirmed_at is not null
    and u.deleted_at is null
    and not coalesce(u.is_anonymous, false)
    and (u.banned_until is null or u.banned_until <= clock_timestamp())
  for share;

  if not found then
    raise exception 'Conta de usuário inativa, não confirmada ou suspensa.' using errcode = '42501';
  end if;

  -- 12. Ordem demonstrável de locks — 6º: Evento Alvo (serialização de mutações no evento)
  select * into v_event
  from app_private.events e
  where e.church_id = p_church_id and e.id = p_event_id
  for update;

  if not found then
    raise exception 'Evento não encontrado.' using errcode = 'P0002';
  end if;

  -- 13. Revalidação definitiva de autoridade e elegibilidade após esperas por locks (Achado A2, B1)
  -- Reavalia church_access, members, churches e auth.users protegendo contra mutações concorrentes durante a espera
  select ca.member_id, coalesce(ca.is_admin, false)
  into v_caller_member_id, v_is_admin
  from app_private.church_access ca
  join app_private.members m on m.id = ca.member_id and m.church_id = ca.church_id
  join auth.users u on u.id = ca.user_id
  join app_private.churches c on c.id = ca.church_id
  where ca.church_id = p_church_id
    and ca.user_id = v_user_id
    and ca.status = 'active'
    and ca.onboarding_completed_at is not null
    and c.status = 'active'
    and m.status = 'active'
    and u.email_confirmed_at is not null
    and u.deleted_at is null
    and not coalesce(u.is_anonymous, false)
    and (u.banned_until is null or u.banned_until <= clock_timestamp());

  if v_caller_member_id is null then
    raise exception 'Acesso revogado durante a espera pelo evento.' using errcode = '42501';
  end if;

  -- Autorização estrita sobre o evento: admin elegível OU líder da liturgia deste evento (NULL nunca concede permissão)
  if not (
    coalesce(v_is_admin, false) = true
    or (
      v_event.liturgy_leader_member_id is not null
      and v_caller_member_id is not null
      and v_event.liturgy_leader_member_id = v_caller_member_id
    )
  ) then
    raise exception 'Permissão insuficiente para salvar rascunho deste evento.' using errcode = '42501';
  end if;

  -- 14. Retorno de Replay sob Abordagem 1 - Segurança Estrita (Achado A3)
  if v_existing_receipt.command_id is not null then
    return query select
      p_command_id,
      c_action,
      p_church_id,
      (v_existing_receipt.result->>'event_id')::uuid,
      v_existing_receipt.result,
      v_existing_receipt.created_at;
    return;
  end if;

  -- 15. Execução da reversão/manutenção para rascunho
  v_created_at := clock_timestamp();

  update app_private.events e
  set program_status = 'draft',
      updated_at = v_created_at
  where e.church_id = p_church_id and e.id = p_event_id;

  v_payload := jsonb_build_object(
    'event_id', p_event_id,
    'program_status', 'draft'
  );

  -- 16. Persistência de recibo e auditoria
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

-- ------------------------------------------------------------------------------
-- 6. REMOÇÃO DE CONSTRAINTS E COLUNA EM app_private.event_items
-- ------------------------------------------------------------------------------
alter table app_private.event_items
  drop constraint if exists ei_prep_minutes_range,
  drop constraint if exists ei_liturgical_prep_zero,
  drop constraint if exists ei_sequence_order_positive,
  drop column if exists prep_required_minutes;

-- ------------------------------------------------------------------------------
-- 7. RESTAURAÇÃO DE ACLS E OWNERSHIP
-- ------------------------------------------------------------------------------
revoke all on function public.create_event_item(uuid, uuid, uuid, text, text, integer, integer, uuid, uuid) from public, anon, service_role;
grant execute on function public.create_event_item(uuid, uuid, uuid, text, text, integer, integer, uuid, uuid) to authenticated;
alter function public.create_event_item(uuid, uuid, uuid, text, text, integer, integer, uuid, uuid) owner to postgres;

revoke all on function public.list_church_events(uuid, text, integer, integer) from public, anon, service_role;
grant execute on function public.list_church_events(uuid, text, integer, integer) to authenticated;
alter function public.list_church_events(uuid, text, integer, integer) owner to postgres;

revoke all on function public.reorder_event_items(uuid, uuid, uuid, uuid[]) from public, anon, service_role;
grant execute on function public.reorder_event_items(uuid, uuid, uuid, uuid[]) to authenticated;
alter function public.reorder_event_items(uuid, uuid, uuid, uuid[]) owner to postgres;

revoke all on function public.set_event_duration_policy(uuid, uuid, uuid, text) from public, anon, service_role;
grant execute on function public.set_event_duration_policy(uuid, uuid, uuid, text) to authenticated;
alter function public.set_event_duration_policy(uuid, uuid, uuid, text) owner to postgres;

revoke all on function public.publish_event_program(uuid, uuid, uuid) from public, anon, service_role;
grant execute on function public.publish_event_program(uuid, uuid, uuid) to authenticated;
alter function public.publish_event_program(uuid, uuid, uuid) owner to postgres;

revoke all on function public.save_event_program_draft(uuid, uuid, uuid) from public, anon, service_role;
grant execute on function public.save_event_program_draft(uuid, uuid, uuid) to authenticated;
alter function public.save_event_program_draft(uuid, uuid, uuid) owner to postgres;

notify pgrst, 'reload schema';

-- ------------------------------------------------------------------------------
-- ------------------------------------------------------------------------------
-- ------------------------------------------------------------------------------
-- 8. ASSERÇÕES PÓS-CONDIÇÃO RIGOROSAS DE ROLLBACK (C14, C15, F2-F7, F9)
-- ------------------------------------------------------------------------------
do $post_rollback_assertions$
declare
  v_count integer;
  v_rec record;
  v_hash text;
begin
  -- 8.1 Ausência estrita da coluna e constraints do 026; event_items volta a exatamente 15 colunas
  select count(*) into v_count from information_schema.columns
  where table_schema = 'app_private' and table_name = 'event_items';
  if v_count <> 15 then
    raise exception 'ROLLBACK FALHOU [8.1.1]: app_private.event_items possui % colunas (esperado exatamente 15 pós-rollback).', v_count
      using errcode = '42P07';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'app_private' and table_name = 'event_items' and column_name = 'prep_required_minutes'
  ) or exists (
    select 1 from pg_constraint
    where conrelid = 'app_private.event_items'::regclass
      and conname in ('ei_prep_minutes_range', 'ei_liturgical_prep_zero', 'ei_sequence_order_positive')
  ) then
    raise exception 'ROLLBACK FALHOU [8.1.2]: Coluna ou constraints do incremento 026 ainda presentes em app_private.event_items.'
      using errcode = 'P0002';
  end if;

  -- 8.2 Ausência das 4 RPCs novas/evoluídas do 026 e do overload de 10 parâmetros de create_event_item
  if to_regprocedure('public.get_event_program(uuid,uuid)') is not null
    or to_regprocedure('public.update_event_item(uuid,uuid,uuid,uuid,text,integer,integer,uuid,uuid,timestamptz)') is not null
    or to_regprocedure('public.remove_event_item(uuid,uuid,uuid,uuid,timestamptz)') is not null
    or to_regprocedure('public.create_event_item(uuid,uuid,uuid,text,text,integer,integer,uuid,uuid,integer)') is not null then
    raise exception 'ROLLBACK FALHOU [8.2]: RPCs novas do incremento 026 ainda presentes no catálogo.'
      using errcode = '42710';
  end if;

  -- 8.3 Ausência semântica de unicidade incompatível cobrindo sequence_order (F5)
  select count(*) into v_count
  from pg_index i
  join pg_class c on c.oid = i.indrelid
  join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid and a.attnum = any(i.indkey)
  where n.nspname = 'app_private'
    and c.relname = 'event_items'
    and i.indisunique = true
    and a.attname = 'sequence_order';
  if v_count > 0 then
    raise exception 'ROLLBACK FALHOU [8.3]: Detectada restrição/índice único incompatível sobre sequence_order em app_private.event_items.'
      using errcode = '42P07';
  end if;

  -- 8.4 Matriz canônica de constraints e FKs (G3) pós-rollback: idêntica à do baseline pré-026
  select count(*) into v_count
  from (
    values
      ('app_private.events', 'events_pkey', 'p', 'PRIMARY KEY (id)', '', '', ''),
      ('app_private.events', 'events_church_id_id_unique', 'u', 'UNIQUE (church_id, id)', '', '', ''),
      ('app_private.events', 'events_church_id_fkey', 'f', 'FOREIGN KEY (church_id) REFERENCES app_private.churches(id) ON DELETE RESTRICT', 'a', 'r', 's'),
      ('app_private.events', 'events_church_liturgy_fkey', 'f', 'FOREIGN KEY (church_id, liturgy_leader_member_id) REFERENCES app_private.members(church_id, id) ON DELETE RESTRICT', 'a', 'r', 's'),
      ('app_private.events', 'events_published_by_member_id_fkey', 'f', 'FOREIGN KEY (published_by_member_id) REFERENCES app_private.members(id) ON DELETE SET NULL', 'a', 'n', 's'),
      ('app_private.events', 'events_status_check', 'c', 'CHECK ((status = ANY (ARRAY[''scheduled''::text, ''in_progress''::text, ''completed''::text, ''cancelled''::text])))', '', '', ''),
      ('app_private.events', 'events_title_clean', 'c', 'CHECK (((title = btrim(title)) AND ((char_length(title) >= 1) AND (char_length(title) <= 200))))', '', '', ''),
      ('app_private.events', 'events_timezone_clean', 'c', 'CHECK (((timezone = btrim(timezone)) AND ((char_length(timezone) >= 1) AND (char_length(timezone) <= 80))))', '', '', ''),
      ('app_private.events', 'events_dates_order', 'c', 'CHECK ((planned_end_at > planned_start_at))', '', '', ''),
      ('app_private.events', 'events_duration_policy_check', 'c', 'CHECK ((duration_policy = ANY (ARRAY[''warn''::text, ''block''::text])))', '', '', ''),
      ('app_private.events', 'events_program_status_check', 'c', 'CHECK ((program_status = ANY (ARRAY[''draft''::text, ''published''::text])))', '', '', ''),
      ('app_private.event_items', 'event_items_pkey', 'p', 'PRIMARY KEY (id)', '', '', ''),
      ('app_private.event_items', 'ei_church_id_id_unique', 'u', 'UNIQUE (church_id, id)', '', '', ''),
      ('app_private.event_items', 'ei_church_event_item_unique', 'u', 'UNIQUE (church_id, event_id, id)', '', '', ''),
      ('app_private.event_items', 'ei_church_event_fkey', 'f', 'FOREIGN KEY (church_id, event_id) REFERENCES app_private.events(church_id, id) ON DELETE RESTRICT', 'a', 'r', 's'),
      ('app_private.event_items', 'ei_church_team_fkey', 'f', 'FOREIGN KEY (church_id, designated_team_id) REFERENCES app_private.teams(church_id, id) ON DELETE RESTRICT', 'a', 'r', 's'),
      ('app_private.event_items', 'ei_church_leader_fkey', 'f', 'FOREIGN KEY (church_id, nominal_leader_member_id) REFERENCES app_private.members(church_id, id) ON DELETE RESTRICT', 'a', 'r', 's'),
      ('app_private.event_items', 'event_items_item_nature_check', 'c', 'CHECK ((item_nature = ANY (ARRAY[''liturgical''::text, ''parallel_support''::text])))', '', '', ''),
      ('app_private.event_items', 'event_items_status_check', 'c', 'CHECK ((status = ANY (ARRAY[''pending''::text, ''in_progress''::text, ''completed''::text, ''cancelled''::text])))', '', '', ''),
      ('app_private.event_items', 'event_items_planned_duration_seconds_check', 'c', 'CHECK ((planned_duration_seconds > 0))', '', '', ''),
      ('app_private.assignments', 'assignments_pkey', 'p', 'PRIMARY KEY (id)', '', '', ''),
      ('app_private.assignments', 'asg_church_id_id_unique', 'u', 'UNIQUE (church_id, id)', '', '', ''),
      ('app_private.assignments', 'asg_church_event_fkey', 'f', 'FOREIGN KEY (church_id, event_id) REFERENCES app_private.events(church_id, id) ON DELETE RESTRICT', 'a', 'r', 's'),
      ('app_private.assignments', 'asg_church_event_item_fkey', 'f', 'FOREIGN KEY (church_id, event_id, item_id) REFERENCES app_private.event_items(church_id, event_id, id) ON DELETE RESTRICT', 'a', 'r', 's'),
      ('app_private.assignments', 'asg_church_member_fkey', 'f', 'FOREIGN KEY (church_id, member_id) REFERENCES app_private.members(church_id, id) ON DELETE RESTRICT', 'a', 'r', 's'),
      ('app_private.assignments', 'asg_church_team_fkey', 'f', 'FOREIGN KEY (church_id, team_id) REFERENCES app_private.teams(church_id, id) ON DELETE RESTRICT', 'a', 'r', 's'),
      ('app_private.assignments', 'asg_church_team_role_fkey', 'f', 'FOREIGN KEY (church_id, team_id, team_role_id) REFERENCES app_private.team_roles(church_id, team_id, id) ON DELETE RESTRICT', 'a', 'r', 's'),
      ('app_private.assignments', 'asg_replaced_fkey', 'f', 'FOREIGN KEY (church_id, replaced_assignment_id) REFERENCES app_private.assignments(church_id, id) ON DELETE RESTRICT', 'a', 'r', 's'),
      ('app_private.assignments', 'asg_replacement_fkey', 'f', 'FOREIGN KEY (church_id, replacement_assignment_id) REFERENCES app_private.assignments(church_id, id) ON DELETE RESTRICT', 'a', 'r', 's'),
      ('app_private.assignments', 'assignments_status_check', 'c', 'CHECK ((status = ANY (ARRAY[''active''::text, ''replaced''::text, ''cancelled''::text])))', '', '', ''),
      ('app_private.event_planning_receipts', 'event_planning_receipts_pkey', 'p', 'PRIMARY KEY (user_id, command_id)', '', '', ''),
      ('app_private.event_planning_receipts', 'event_planning_receipts_user_id_fkey', 'f', 'FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE RESTRICT', 'a', 'r', 's'),
      ('app_private.event_planning_receipts', 'event_planning_receipts_church_id_fkey', 'f', 'FOREIGN KEY (church_id) REFERENCES app_private.churches(id) ON DELETE RESTRICT', 'a', 'r', 's')
  ) as e(tbl, cname, ctype, cdef, upd, del, mtch)
  full join (
    select n.nspname || '.' || c.relname as tbl, k.conname::text as cname, k.contype::text as ctype,
           regexp_replace(pg_get_constraintdef(k.oid), '\s+', ' ', 'g') as cdef,
           case when k.contype = 'f' then k.confupdtype::text else '' end as upd,
           case when k.contype = 'f' then k.confdeltype::text else '' end as del,
           case when k.contype = 'f' then k.confmatchtype::text else '' end as mtch,
           k.convalidated as valid, k.condeferrable as dfr, k.condeferred as dfd
    from pg_constraint k
    join pg_class c on c.oid = k.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    where k.conrelid in (
            'app_private.events'::regclass, 'app_private.event_items'::regclass,
            'app_private.assignments'::regclass, 'app_private.event_planning_receipts'::regclass)
      and k.contype <> 'n'
  ) as r on r.tbl = e.tbl and r.cname = e.cname
  where e.cname is null or r.cname is null
     or r.ctype <> e.ctype or r.cdef <> e.cdef
     or r.upd <> e.upd or r.del <> e.del or r.mtch <> e.mtch
     or r.valid is not true or r.dfr is not false or r.dfd is not false;
  if v_count > 0 then
    raise exception 'ROLLBACK FALHOU [8.4]: Matriz de constraints/FKs diverge do baseline pré-026 (% divergências).', v_count
      using errcode = '42P07';
  end if;

  -- 8.5 Matriz canônica de índices (G4) pós-rollback
  select count(*) into v_count
  from (
    values
      ('app_private.events', 'events_pkey', 'CREATE UNIQUE INDEX events_pkey ON app_private.events USING btree (id)'),
      ('app_private.events', 'events_church_id_id_unique', 'CREATE UNIQUE INDEX events_church_id_id_unique ON app_private.events USING btree (church_id, id)'),
      ('app_private.events', 'events_church_status_start_idx', 'CREATE INDEX events_church_status_start_idx ON app_private.events USING btree (church_id, status, planned_start_at)'),
      ('app_private.event_items', 'event_items_pkey', 'CREATE UNIQUE INDEX event_items_pkey ON app_private.event_items USING btree (id)'),
      ('app_private.event_items', 'ei_church_id_id_unique', 'CREATE UNIQUE INDEX ei_church_id_id_unique ON app_private.event_items USING btree (church_id, id)'),
      ('app_private.event_items', 'ei_church_event_item_unique', 'CREATE UNIQUE INDEX ei_church_event_item_unique ON app_private.event_items USING btree (church_id, event_id, id)'),
      ('app_private.event_items', 'ei_church_event_order_idx', 'CREATE INDEX ei_church_event_order_idx ON app_private.event_items USING btree (church_id, event_id, sequence_order)'),
      ('app_private.assignments', 'assignments_pkey', 'CREATE UNIQUE INDEX assignments_pkey ON app_private.assignments USING btree (id)'),
      ('app_private.assignments', 'asg_church_id_id_unique', 'CREATE UNIQUE INDEX asg_church_id_id_unique ON app_private.assignments USING btree (church_id, id)'),
      ('app_private.assignments', 'asg_church_event_active_idx', 'CREATE INDEX asg_church_event_active_idx ON app_private.assignments USING btree (church_id, event_id, status) WHERE (status = ''active''::text)'),
      ('app_private.assignments', 'asg_church_member_active_idx', 'CREATE INDEX asg_church_member_active_idx ON app_private.assignments USING btree (church_id, member_id, status) WHERE (status = ''active''::text)'),
      ('app_private.event_planning_receipts', 'event_planning_receipts_pkey', 'CREATE UNIQUE INDEX event_planning_receipts_pkey ON app_private.event_planning_receipts USING btree (user_id, command_id)')
  ) as e(tbl, iname, idef)
  full join (
    select n.nspname || '.' || t.relname as tbl, i.relname::text as iname,
           regexp_replace(pg_get_indexdef(x.indexrelid), '\s+', ' ', 'g') as idef,
           (x.indisvalid and x.indisready and x.indislive) as ok
    from pg_index x
    join pg_class i on i.oid = x.indexrelid
    join pg_class t on t.oid = x.indrelid
    join pg_namespace n on n.oid = t.relnamespace
    where x.indrelid in (
            'app_private.events'::regclass, 'app_private.event_items'::regclass,
            'app_private.assignments'::regclass, 'app_private.event_planning_receipts'::regclass)
  ) as r on r.tbl = e.tbl and r.iname = e.iname
  where e.iname is null or r.iname is null or r.idef <> e.idef or r.ok is not true;
  if v_count > 0 then
    raise exception 'ROLLBACK FALHOU [8.5]: Matriz de índices diverge do baseline pré-026 (% divergências).', v_count
      using errcode = '42P07';
  end if;

  -- 8.6 Matriz canônica de triggers (G4) pós-rollback
  select count(*) into v_count
  from (
    values
      ('app_private.events', 'events_touch_updated_at', 'CREATE TRIGGER events_touch_updated_at BEFORE UPDATE ON app_private.events FOR EACH ROW EXECUTE FUNCTION app_private.touch_updated_at()'),
      ('app_private.event_items', 'ei_touch_updated_at', 'CREATE TRIGGER ei_touch_updated_at BEFORE UPDATE ON app_private.event_items FOR EACH ROW EXECUTE FUNCTION app_private.touch_updated_at()'),
      ('app_private.assignments', 'asg_touch_updated_at', 'CREATE TRIGGER asg_touch_updated_at BEFORE UPDATE ON app_private.assignments FOR EACH ROW EXECUTE FUNCTION app_private.touch_updated_at()')
  ) as e(tbl, tname, tdef)
  full join (
    select n.nspname || '.' || c.relname as tbl, t.tgname::text as tname,
           regexp_replace(pg_get_triggerdef(t.oid), '\s+', ' ', 'g') as tdef,
           (t.tgenabled = 'O') as ok
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where not t.tgisinternal
      and t.tgrelid in (
            'app_private.events'::regclass, 'app_private.event_items'::regclass,
            'app_private.assignments'::regclass, 'app_private.event_planning_receipts'::regclass)
  ) as r on r.tbl = e.tbl and r.tname = e.tname
  where e.tname is null or r.tname is null or r.tdef <> e.tdef or r.ok is not true;
  if v_count > 0 then
    raise exception 'ROLLBACK FALHOU [8.6]: Matriz de triggers diverge do baseline pré-026 (% divergências).', v_count
      using errcode = '42P07';
  end if;

  -- 8.7 Matriz de metadados completos (G6/G7) das 6 RPCs restauradas do baseline pré-026
  select count(*) into v_count
  from (
    values
      ('create_event_item', 'public.create_event_item(uuid,uuid,uuid,text,text,integer,integer,uuid,uuid)', 9, 5,
       'p_church_id uuid, p_command_id uuid, p_event_id uuid, p_title text, p_item_nature text DEFAULT ''liturgical''::text, p_sequence_order integer DEFAULT 1, p_planned_duration_seconds integer DEFAULT 300, p_designated_team_id uuid DEFAULT NULL::uuid, p_nominal_leader_member_id uuid DEFAULT NULL::uuid',
       'TABLE(command_id uuid, action text, church_id uuid, result_entity_id uuid, result_payload jsonb, created_at timestamp with time zone)',
       'v', 'i:p_church_id:uuid,i:p_command_id:uuid,i:p_event_id:uuid,i:p_title:text,i:p_item_nature:text,i:p_sequence_order:integer,i:p_planned_duration_seconds:integer,i:p_designated_team_id:uuid,i:p_nominal_leader_member_id:uuid,t:command_id:uuid,t:action:text,t:church_id:uuid,t:result_entity_id:uuid,t:result_payload:jsonb,t:created_at:timestamp with time zone'),
      ('list_church_events', 'public.list_church_events(uuid,text,integer,integer)', 4, 3,
       'p_church_id uuid, p_status_filter text DEFAULT ''all''::text, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0',
       'TABLE(events jsonb, total_count bigint)',
       's', 'i:p_church_id:uuid,i:p_status_filter:text,i:p_limit:integer,i:p_offset:integer,t:events:jsonb,t:total_count:bigint'),
      ('reorder_event_items', 'public.reorder_event_items(uuid,uuid,uuid,uuid[])', 4, 0,
       'p_church_id uuid, p_command_id uuid, p_event_id uuid, p_ordered_item_ids uuid[]',
       'TABLE(command_id uuid, action text, church_id uuid, result_entity_id uuid, result_payload jsonb, created_at timestamp with time zone)',
       'v', 'i:p_church_id:uuid,i:p_command_id:uuid,i:p_event_id:uuid,i:p_ordered_item_ids:uuid[],t:command_id:uuid,t:action:text,t:church_id:uuid,t:result_entity_id:uuid,t:result_payload:jsonb,t:created_at:timestamp with time zone'),
      ('set_event_duration_policy', 'public.set_event_duration_policy(uuid,uuid,uuid,text)', 4, 0,
       'p_church_id uuid, p_command_id uuid, p_event_id uuid, p_duration_policy text',
       'TABLE(command_id uuid, action text, church_id uuid, result_entity_id uuid, result_payload jsonb, created_at timestamp with time zone)',
       'v', 'i:p_church_id:uuid,i:p_command_id:uuid,i:p_event_id:uuid,i:p_duration_policy:text,t:command_id:uuid,t:action:text,t:church_id:uuid,t:result_entity_id:uuid,t:result_payload:jsonb,t:created_at:timestamp with time zone'),
      ('publish_event_program', 'public.publish_event_program(uuid,uuid,uuid)', 3, 0,
       'p_church_id uuid, p_command_id uuid, p_event_id uuid',
       'TABLE(command_id uuid, action text, church_id uuid, result_entity_id uuid, result_payload jsonb, created_at timestamp with time zone)',
       'v', 'i:p_church_id:uuid,i:p_command_id:uuid,i:p_event_id:uuid,t:command_id:uuid,t:action:text,t:church_id:uuid,t:result_entity_id:uuid,t:result_payload:jsonb,t:created_at:timestamp with time zone'),
      ('save_event_program_draft', 'public.save_event_program_draft(uuid,uuid,uuid)', 3, 0,
       'p_church_id uuid, p_command_id uuid, p_event_id uuid',
       'TABLE(command_id uuid, action text, church_id uuid, result_entity_id uuid, result_payload jsonb, created_at timestamp with time zone)',
       'v', 'i:p_church_id:uuid,i:p_command_id:uuid,i:p_event_id:uuid,t:command_id:uuid,t:action:text,t:church_id:uuid,t:result_entity_id:uuid,t:result_payload:jsonb,t:created_at:timestamp with time zone')
  ) as t(p_name, p_sig, p_nargs, p_ndef, p_args, p_result, p_vol, p_canon)
  left join pg_proc p on p.oid = to_regprocedure(t.p_sig)
  left join pg_language l on l.oid = p.prolang
  where p.oid is null
     or (select count(*) from pg_proc x where x.proname = t.p_name and x.pronamespace = 'public'::regnamespace) <> 1
     or p.pronargs <> t.p_nargs
     or p.pronargdefaults <> t.p_ndef
     or pg_get_function_arguments(p.oid) <> t.p_args
     or pg_get_function_result(p.oid) <> t.p_result
     or p.proretset is not true
     or l.lanname is distinct from 'plpgsql'
     or p.provolatile::text <> t.p_vol
     or p.prokind::text <> 'f'
     or p.prosecdef is not true
     or coalesce((
          select string_agg(
                   coalesce(p.proargmodes[x.k]::text, 'i') || ':' || coalesce(p.proargnames[x.k], '') || ':' || format_type(x.typ, null),
                   ',' order by x.k)
          from unnest(coalesce(p.proallargtypes, p.proargtypes::oid[])) with ordinality as x(typ, k)
        ), '') is distinct from t.p_canon
     or coalesce(cardinality(p.proconfig), 0) <> 2
     or coalesce(p.proconfig @> array['statement_timeout=5s'], false) is not true
     or coalesce(p.proconfig @> array['search_path=""'] or p.proconfig @> array['search_path='], false) is not true
     or p.proowner <> (select oid from pg_roles where rolname = 'postgres');
  if v_count > 0 then
    raise exception 'ROLLBACK FALHOU [8.7]: Metadados das 6 RPCs restauradas divergem do baseline (% divergências).', v_count
      using errcode = '42883';
  end if;

  -- 8.8 ACL uniforme (G5) e fingerprint canônico (F2) das 6 RPCs restauradas
  for v_rec in
    select * from (
      values
        ('create_event_item', 'public.create_event_item(uuid,uuid,uuid,text,text,integer,integer,uuid,uuid)',
         '63bf49c5e106cb9b15424417967b1b0b7986766ddb690c2c1ab0ace279db73b4'),
        ('list_church_events', 'public.list_church_events(uuid,text,integer,integer)',
         'fa36797053c2d1aebbf0da75ee359cd0eedcdbc89b23cee6d8e96074e235e734'),
        ('reorder_event_items', 'public.reorder_event_items(uuid,uuid,uuid,uuid[])',
         'a0327eace61492b88d7e58e454abbf9ad79e375035828a0d89fcbd39f61da7c4'),
        ('set_event_duration_policy', 'public.set_event_duration_policy(uuid,uuid,uuid,text)',
         '0aaa502846b032dece64e494cc7a0e98cefa73a1a864da5b77122890d6b95892'),
        ('publish_event_program', 'public.publish_event_program(uuid,uuid,uuid)',
         '54fdbb6e779ba0922edcf41adb5dc269f11c48e88d2f0f34727b0e08d5a23407'),
        ('save_event_program_draft', 'public.save_event_program_draft(uuid,uuid,uuid)',
         '401eefea3c2383292b9af888daec5e3764680b1d8a2141543e2da8d5a7676ea6')
    ) as t(p_name, p_sig, p_expected_hash)
  loop
    if exists (
      select 1 from pg_proc p
      where p.oid = to_regprocedure(v_rec.p_sig)
        and (
          p.proacl is null
          or cardinality(p.proacl) = 0
          or p.proowner <> (select oid from pg_roles where rolname = 'postgres')
          or not exists (
            select 1 from aclexplode(p.proacl) ae
            where ae.grantee = (select oid from pg_roles where rolname = 'authenticated')
              and ae.privilege_type = 'EXECUTE'
              and ae.is_grantable = false
              and ae.grantor = p.proowner
          )
          or exists (
            select 1 from aclexplode(p.proacl) ae
            where ae.grantee not in ((select oid from pg_roles where rolname = 'authenticated'), p.proowner)
               or ae.privilege_type <> 'EXECUTE'
               or (ae.grantee = p.proowner and ae.grantor <> p.proowner)
               or (ae.grantee = (select oid from pg_roles where rolname = 'authenticated') and ae.is_grantable)
               or (ae.grantee = (select oid from pg_roles where rolname = 'authenticated') and ae.grantor <> p.proowner)
          )
        )
    ) then
      raise exception 'ROLLBACK FALHOU [8.8.1]: ACL de % viola a política uniforme de allowlist direta pós-rollback.', v_rec.p_name
        using errcode = '42501';
    end if;

    select encode(pg_catalog.sha256(convert_to(btrim(replace(p.prosrc, E'\r\n', E'\n'), E' \t\r\n'), 'UTF8')), 'hex')
    into v_hash
    from pg_proc p
    where p.oid = to_regprocedure(v_rec.p_sig);

    if v_hash <> v_rec.p_expected_hash then
      raise exception 'ROLLBACK FALHOU [8.8.2]: Fingerprint de % (%) diverge do hash esperado (%).',
        v_rec.p_name, v_hash, v_rec.p_expected_hash
        using errcode = '42883';
    end if;
  end loop;

  raise notice '026_rollback: Pós-condições rigorosas de baseline pré-026 foram 100%% APROVADAS.';
end;
$post_rollback_assertions$;

commit;
