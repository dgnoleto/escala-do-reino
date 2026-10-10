-- 9. Endpoint: decide_access_request (Aprovação ou Rejeição Administrativa de Nome)
create function public.decide_access_request(
  p_command_id uuid,
  p_church_id uuid,
  p_request_id uuid,
  p_decision text
)
returns table (
  request_id uuid,
  member_id uuid,
  final_display_name text,
  decision text,
  access_granted boolean,
  decided_at timestamptz,
  error_code text
)
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $function$
declare
  v_user_id uuid;
  v_params_json jsonb;
  v_params_hash bytea;
  v_existing_action text;
  v_existing_hash bytea;
  v_existing_payload jsonb;
  v_church_id uuid;
  v_access_id uuid;
  v_target_member_id uuid;
  v_current_display_name text;
  v_req_id uuid;
  v_original_name text;
  v_proposed_name text;
  v_requester_user_id uuid;
  v_req_expires_at timestamptz;
  v_req_status text;
  v_invitation_id uuid;
  v_inv_id uuid;
  v_inv_recipient_email text;
  v_inv_redeemed_at timestamptz;
  v_inv_redeemed_by uuid;
  v_inv_revoked_at timestamptz;
  v_requester_email text;
  v_now timestamptz;
  v_new_access_id uuid;
  v_result_payload jsonb;
begin
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if p_command_id is null or p_church_id is null or p_request_id is null or p_decision is null then
    raise exception 'Parâmetros obrigatórios incompletos.' using errcode = '22004';
  end if;

  if p_decision not in ('approve', 'reject') then
    raise exception 'Decisão deve ser approve ou reject.' using errcode = '23514';
  end if;

  v_params_json := jsonb_build_object(
    'v', 2,
    'action', 'decide_access_request',
    'church_id', p_church_id,
    'request_id', p_request_id,
    'decision', p_decision
  );
  v_params_hash := pg_catalog.sha256(pg_catalog.convert_to(v_params_json::text, 'UTF8'));

  -- Serialização transacional do comando por (auth.uid(), command_id) antes de bloqueios de domínio
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(v_user_id::text), pg_catalog.hashtext(p_command_id::text));

  -- Reconsulta de recibo existente
  select cr.action, cr.params_hash, cr.result_payload
  into v_existing_action, v_existing_hash, v_existing_payload
  from app_private.command_receipts cr
  where cr.user_id = v_user_id and cr.command_id = p_command_id;

  if v_existing_hash is not null then
    if v_existing_action <> 'decide_access_request' or v_existing_hash <> v_params_hash then
      raise exception 'Comando já executado com parâmetros diferentes.' using errcode = '23505';
    end if;

    -- Revalida autorização administrativa atual antes da entrega do replay
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
        and (u.banned_until is null or u.banned_until <= clock_timestamp())
    ) then
      raise exception 'Acesso administrativo não autorizado nesta igreja.' using errcode = '42501';
    end if;

    return query
    select
      (v_existing_payload->>'request_id')::uuid,
      (v_existing_payload->>'member_id')::uuid,
      (v_existing_payload->>'final_display_name')::text,
      (v_existing_payload->>'decision')::text,
      coalesce((v_existing_payload->>'access_granted')::boolean, false),
      (v_existing_payload->>'decided_at')::timestamptz,
      (v_existing_payload->>'error_code')::text;
    return;
  end if;

  -- Localização prévia da solicitação para identificar member_id e invitation_id
  select ar.member_id, ar.invitation_id
  into v_target_member_id, v_invitation_id
  from app_private.access_requests ar
  where ar.id = p_request_id and ar.church_id = p_church_id;

  if v_target_member_id is null or v_invitation_id is null then
    raise exception 'Solicitação não encontrada nesta igreja.' using errcode = 'P0002';
  end if;

  -- Bloqueios de domínio na ordem canônica estrita:
  -- 1) Igreja SHARE
  select c.id into v_church_id
  from app_private.churches c
  where c.id = p_church_id and c.status = 'active'
  for share;

  if v_church_id is null then
    raise exception 'Igreja não encontrada ou inativa.' using errcode = 'P0002';
  end if;

  -- 2) Operador SHARE
  select ca.id into v_access_id
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
    and (u.banned_until is null or u.banned_until <= clock_timestamp())
  for share;

  if v_access_id is null then
    raise exception 'Acesso administrativo não autorizado nesta igreja.' using errcode = '42501';
  end if;

  -- 3) Membro Alvo UPDATE
  select m.id, m.display_name into v_target_member_id, v_current_display_name
  from app_private.members m
  where m.church_id = p_church_id and m.id = v_target_member_id and m.status = 'active'
  for update;

  if v_target_member_id is null then
    raise exception 'Membro inativo ou não encontrado.' using errcode = 'P0002';
  end if;

  -- 4) Convite Original Consumido UPDATE (adquirido e revalidado antes da solicitação)
  select ai.id, ai.recipient_email, ai.redeemed_at, ai.redeemed_by_user_id, ai.revoked_at
  into v_inv_id, v_inv_recipient_email, v_inv_redeemed_at, v_inv_redeemed_by, v_inv_revoked_at
  from app_private.access_invitations ai
  where ai.id = v_invitation_id and ai.church_id = p_church_id and ai.member_id = v_target_member_id
  for update;

  if v_inv_id is null then
    raise exception 'Convite original associado não encontrado.' using errcode = 'P0002';
  end if;

  -- 5) Solicitação UPDATE
  select ar.id, ar.original_display_name, ar.proposed_display_name, ar.requester_user_id,
         ar.expires_at, ar.status
  into v_req_id, v_original_name, v_proposed_name, v_requester_user_id,
       v_req_expires_at, v_req_status
  from app_private.access_requests ar
  where ar.id = p_request_id and ar.church_id = p_church_id
  for update;

  if v_req_status <> 'pending' then
    raise exception 'Solicitação já foi decidida anteriormente.' using errcode = '23505';
  end if;

  v_now := clock_timestamp();

  -- Validação de expiração no instante pós-bloqueio: retorno estruturado com finalização persistida
  if v_now >= v_req_expires_at then
    update app_private.access_requests
    set status = 'expired',
        decided_at = v_now,
        decided_by_user_id = null
    where id = p_request_id;

    insert into app_private.audit_entries (
      church_id, action, actor_user_id, actor_source, maintenance_operator,
      target_type, target_id, details, occurred_at
    ) values (
      p_church_id, 'expire_access_request', v_user_id, 'application', null,
      'access_requests', p_request_id,
      jsonb_build_object('member_id', v_target_member_id, 'reason', 'expired_without_decision'),
      v_now
    );

    v_result_payload := jsonb_build_object(
      'request_id', p_request_id,
      'member_id', v_target_member_id,
      'final_display_name', v_current_display_name,
      'decision', 'expired',
      'access_granted', false,
      'decided_at', v_now,
      'error_code', 'REQUEST_EXPIRED'
    );

    insert into app_private.command_receipts (
      church_id, user_id, command_id, action, params_hash,
      result_member_id, result_entity_id, result_payload, created_at
    ) values (
      p_church_id, v_user_id, p_command_id, 'decide_access_request', v_params_hash,
      v_target_member_id, p_request_id, v_result_payload, v_now
    );

    return query
    select p_request_id, v_target_member_id, v_current_display_name, 'expired'::text, false, v_now, 'REQUEST_EXPIRED'::text;
    return;
  end if;

  -- Ramo APROVAÇÃO
  if p_decision = 'approve' then
    -- Revalida convite original: consumido pelo solicitante e não revogado
    if v_inv_redeemed_at is null or v_inv_redeemed_by <> v_requester_user_id or v_inv_revoked_at is not null then
      raise exception 'Convite original não está em estado consumido válido para aprovação.' using errcode = 'P0002';
    end if;

    -- Comparação obrigatória do nome original: impede sobrescrita silenciosa em modificação concorrente
    if v_current_display_name <> v_original_name then
      raise exception 'Cadastro do membro foi modificado concorrentemente durante a análise da solicitação.' using errcode = 'P0005';
    end if;

    -- Revalida conta do solicitante no instante final pós-locks
    select u.email into v_requester_email
    from auth.users u
    where u.id = v_requester_user_id
      and u.email_confirmed_at is not null
      and u.deleted_at is null
      and not coalesce(u.is_anonymous, false)
      and (u.banned_until is null or u.banned_until <= v_now);

    if v_requester_email is null then
      raise exception 'Conta do solicitante inelegível ou e-mail não confirmado.' using errcode = '42501';
    end if;

    -- Correspondência estrita de e-mail atual do solicitante com recipient_email do convite original
    if pg_catalog.lower(pg_catalog.btrim(v_requester_email)) <> pg_catalog.lower(pg_catalog.btrim(v_inv_recipient_email)) then
      raise exception 'E-mail atual do solicitante não corresponde mais ao convite original.' using errcode = '42501';
    end if;

    -- Revalida ausência de vínculo ativo
    if exists (
      select 1 from app_private.church_access ca
      where ca.church_id = p_church_id and ca.user_id = v_requester_user_id and ca.status = 'active'
    ) then
      raise exception 'Solicitante já possui acesso ativo nesta igreja.' using errcode = '23505';
    end if;

    if exists (
      select 1 from app_private.church_access ca
      where ca.church_id = p_church_id and ca.member_id = v_target_member_id and ca.status = 'active'
    ) then
      raise exception 'Membro já vinculado a outro acesso ativo.' using errcode = '23505';
    end if;

    -- Proibição de bypass de revogação
    if exists (
      select 1 from app_private.church_access ca
      where ca.church_id = p_church_id
        and (ca.user_id = v_requester_user_id or ca.member_id = v_target_member_id)
        and ca.status = 'revoked'
    ) then
      raise exception 'Vínculo anterior revogado detectado. Aprovação não pode reativar acesso revogado.' using errcode = '42501';
    end if;

    -- Atualização do cadastro do membro com o nome proposto aprovado
    update app_private.members
    set display_name = v_proposed_name,
        updated_at = v_now
    where id = v_target_member_id;

    v_new_access_id := gen_random_uuid();

    insert into app_private.church_access (
      id, church_id, user_id, member_id, status, is_admin,
      onboarding_completed_at, granted_by_user_id, granted_at, created_at, updated_at
    ) values (
      v_new_access_id, p_church_id, v_requester_user_id, v_target_member_id, 'active', false,
      v_now, v_user_id, v_now, v_now, v_now
    );

    update app_private.access_requests
    set status = 'approved',
        decided_at = v_now,
        decided_by_user_id = v_user_id
    where id = p_request_id;

    insert into app_private.audit_entries (
      church_id, action, actor_user_id, actor_source, maintenance_operator,
      target_type, target_id, details, occurred_at
    ) values (
      p_church_id, 'approve_access_request', v_user_id, 'application', null,
      'access_requests', p_request_id,
      jsonb_build_object('member_id', v_target_member_id, 'access_id', v_new_access_id),
      v_now
    );

    v_result_payload := jsonb_build_object(
      'request_id', p_request_id,
      'member_id', v_target_member_id,
      'final_display_name', v_proposed_name,
      'decision', 'approved',
      'access_granted', true,
      'decided_at', v_now,
      'error_code', null
    );

    insert into app_private.command_receipts (
      church_id, user_id, command_id, action, params_hash,
      result_member_id, result_entity_id, result_payload, created_at
    ) values (
      p_church_id, v_user_id, p_command_id, 'decide_access_request', v_params_hash,
      v_target_member_id, p_request_id, v_result_payload, v_now
    );

    return query
    select p_request_id, v_target_member_id, v_proposed_name, 'approved'::text, true, v_now, null::text;
    return;
  end if;

  -- Ramo REJEIÇÃO
  -- A rejeição encerra definitivamente a tentativa sem alterar membro e sem conceder acesso
  update app_private.access_requests
  set status = 'rejected',
      decided_at = v_now,
      decided_by_user_id = v_user_id
  where id = p_request_id;

  insert into app_private.audit_entries (
    church_id, action, actor_user_id, actor_source, maintenance_operator,
    target_type, target_id, details, occurred_at
  ) values (
    p_church_id, 'reject_access_request', v_user_id, 'application', null,
    'access_requests', p_request_id,
    jsonb_build_object('member_id', v_target_member_id),
    v_now
  );

  v_result_payload := jsonb_build_object(
    'request_id', p_request_id,
    'member_id', v_target_member_id,
    'final_display_name', v_current_display_name,
    'decision', 'rejected',
    'access_granted', false,
    'decided_at', v_now,
    'error_code', null
  );

  insert into app_private.command_receipts (
    church_id, user_id, command_id, action, params_hash,
    result_member_id, result_entity_id, result_payload, created_at
  ) values (
    p_church_id, v_user_id, p_command_id, 'decide_access_request', v_params_hash,
    v_target_member_id, p_request_id, v_result_payload, v_now
  );

  return query
  select p_request_id, v_target_member_id, v_current_display_name, 'rejected'::text, false, v_now, null::text;
end;
$function$;
