-- 2. Endpoint: issue_church_invitation (Emissão e Reemissão Administrativa)
create function public.issue_church_invitation(
  p_command_id uuid,
  p_church_id uuid,
  p_member_id uuid,
  p_recipient_email text
)
returns table (
  invitation_id uuid,
  church_id uuid,
  member_id uuid,
  recipient_email text,
  raw_token text,
  expires_at timestamptz,
  issued_at timestamptz,
  previous_invitation_revoked boolean,
  previous_request_cancelled boolean
)
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $function$
declare
  v_user_id uuid;
  v_clean_email text;
  v_params_json jsonb;
  v_params_hash bytea;
  v_existing_action text;
  v_existing_hash bytea;
  v_existing_payload jsonb;
  v_church_id uuid;
  v_access_id uuid;
  v_target_member_id uuid;
  v_prev_invitation_id uuid;
  v_prev_request_id uuid;
  v_prev_request_expires timestamptz;
  v_crypto_ns text;
  v_raw_bytes bytea;
  v_raw_token text;
  v_token_digest bytea;
  v_now timestamptz;
  v_expires_at timestamptz;
  v_new_invitation_id uuid;
  v_result_payload jsonb;
  v_prev_inv_revoked boolean := false;
  v_prev_req_cancelled boolean := false;
begin
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if p_command_id is null or p_church_id is null or p_member_id is null or p_recipient_email is null then
    raise exception 'Parâmetros obrigatórios incompletos.' using errcode = '22004';
  end if;

  v_clean_email := pg_catalog.lower(pg_catalog.btrim(p_recipient_email));
  if char_length(v_clean_email) < 3 or char_length(v_clean_email) > 254
     or v_clean_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Endereço de e-mail inválido.' using errcode = '23514';
  end if;

  v_params_json := jsonb_build_object(
    'v', 2,
    'action', 'issue_invitation',
    'church_id', p_church_id,
    'member_id', p_member_id,
    'recipient_email', v_clean_email
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
    if v_existing_action <> 'issue_invitation' or v_existing_hash <> v_params_hash then
      raise exception 'Comando já executado com parâmetros diferentes.' using errcode = '23505';
    end if;

    -- Revalidação estrita da autorização administrativa atual antes do replay
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

    -- Replay de emissão: raw_token não recuperável por segurança
    return query
    select
      (v_existing_payload->>'invitation_id')::uuid,
      (v_existing_payload->>'church_id')::uuid,
      (v_existing_payload->>'member_id')::uuid,
      (v_existing_payload->>'recipient_email')::text,
      null::text,
      (v_existing_payload->>'expires_at')::timestamptz,
      (v_existing_payload->>'issued_at')::timestamptz,
      coalesce((v_existing_payload->>'previous_invitation_revoked')::boolean, false),
      coalesce((v_existing_payload->>'previous_request_cancelled')::boolean, false);
    return;
  end if;

  -- Bloqueios de domínio na ordem canônica:
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

  -- 3) Membro Alvo FOR UPDATE
  select m.id into v_target_member_id
  from app_private.members m
  where m.church_id = p_church_id and m.id = p_member_id and m.status = 'active'
  for update;

  if v_target_member_id is null then
    raise exception 'Membro não encontrado ou inativo.' using errcode = 'P0002';
  end if;

  -- Revalida ausência de vínculo ativo para o membro
  if exists (
    select 1 from app_private.church_access ca
    where ca.church_id = p_church_id and ca.member_id = p_member_id and ca.status = 'active'
  ) then
    raise exception 'Membro já possui acesso ativo na igreja.' using errcode = '23505';
  end if;

  -- Proibição de bypass de revogação
  if exists (
    select 1 from app_private.church_access ca
    where ca.church_id = p_church_id and ca.member_id = p_member_id and ca.status = 'revoked'
  ) then
    raise exception 'Membro possui vínculo anterior revogado. Convite não pode reativar vínculo revogado.' using errcode = '42501';
  end if;

  -- 4) Finalização de convite aberto anterior
  select ai.id into v_prev_invitation_id
  from app_private.access_invitations ai
  where ai.church_id = p_church_id and ai.member_id = p_member_id
    and ai.redeemed_at is null and ai.revoked_at is null
  for update;

  if v_prev_invitation_id is not null then
    update app_private.access_invitations
    set revoked_at = clock_timestamp(),
        revoked_by_user_id = v_user_id
    where id = v_prev_invitation_id;

    v_prev_inv_revoked := true;

    insert into app_private.audit_entries (
      church_id, action, actor_user_id, actor_source, maintenance_operator,
      target_type, target_id, details, occurred_at
    ) values (
      p_church_id, 'revoke_access_invitation', v_user_id, 'application', null,
      'access_invitations', v_prev_invitation_id,
      jsonb_build_object('reason', 'reissued_by_admin', 'member_id', p_member_id),
      clock_timestamp()
    );
  end if;

  -- 5) Se houver solicitação de alteração de nome pendente para este membro
  select ar.id, ar.expires_at into v_prev_request_id, v_prev_request_expires
  from app_private.access_requests ar
  where ar.church_id = p_church_id and ar.member_id = p_member_id and ar.status = 'pending'
  for update;

  if v_prev_request_id is not null then
    v_now := clock_timestamp();
    if v_now < v_prev_request_expires then
      update app_private.access_requests
      set status = 'cancelled',
          decided_at = v_now,
          decided_by_user_id = v_user_id
      where id = v_prev_request_id;

      v_prev_req_cancelled := true;

      insert into app_private.audit_entries (
        church_id, action, actor_user_id, actor_source, maintenance_operator,
        target_type, target_id, details, occurred_at
      ) values (
        p_church_id, 'cancel_access_request', v_user_id, 'application', null,
        'access_requests', v_prev_request_id,
        jsonb_build_object('reason', 'cancelled_due_to_invitation_reissue', 'member_id', p_member_id),
        v_now
      );
    else
      update app_private.access_requests
      set status = 'expired',
          decided_at = v_now,
          decided_by_user_id = null
      where id = v_prev_request_id;

      insert into app_private.audit_entries (
        church_id, action, actor_user_id, actor_source, maintenance_operator,
        target_type, target_id, details, occurred_at
      ) values (
        p_church_id, 'expire_access_request', v_user_id, 'application', null,
        'access_requests', v_prev_request_id,
        jsonb_build_object('reason', 'expired_without_decision', 'member_id', p_member_id),
        v_now
      );
    end if;
  end if;

  -- Geração CSPRNG estrita de 32 bytes (256 bits) sem fallbacks fracos
  select n.nspname into v_crypto_ns
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  left join pg_catalog.pg_depend d on d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e'
  left join pg_catalog.pg_extension ext on ext.oid = d.refobjid
  where p.proname = 'gen_random_bytes'
    and n.nspname in ('extensions', 'public', 'pg_catalog')
    and p.pronargs = 1
    and p.proargtypes[0] = 'integer'::regtype
    and p.prorettype = 'bytea'::regtype
    and (n.nspname = 'pg_catalog' or ext.extname = 'pgcrypto')
  order by case when n.nspname = 'extensions' then 1 when n.nspname = 'public' then 2 else 3 end
  limit 1;

  if v_crypto_ns is null then
    raise exception 'Função gen_random_bytes(integer) não disponível no ambiente.' using errcode = '0A000';
  end if;

  execute format('select %I.gen_random_bytes(32)', v_crypto_ns) into v_raw_bytes;

  if v_raw_bytes is null or octet_length(v_raw_bytes) <> 32 then
    raise exception 'Falha na geração de entropia criptográfica.' using errcode = 'XX000';
  end if;

  v_raw_token := pg_catalog.rtrim(
    pg_catalog.replace(
      pg_catalog.replace(
        pg_catalog.replace(
          pg_catalog.encode(v_raw_bytes, 'base64'),
          '+', '-'
        ),
        '/', '_'
      ),
      E'\n', ''
    ),
    '='
  );

  v_token_digest := pg_catalog.sha256(pg_catalog.convert_to(v_raw_token, 'UTF8'));

  -- Captura do relógio no instante exato pós-bloqueios para cumprimento da restrição física de 72h
  v_now := clock_timestamp();
  v_expires_at := v_now + interval '72 hours';
  v_new_invitation_id := gen_random_uuid();

  insert into app_private.access_invitations (
    id, church_id, member_id, recipient_email, token_digest,
    issued_by_user_id, issued_at, expires_at
  ) values (
    v_new_invitation_id, p_church_id, p_member_id, v_clean_email, v_token_digest,
    v_user_id, v_now, v_expires_at
  );

  insert into app_private.audit_entries (
    church_id, action, actor_user_id, actor_source, maintenance_operator,
    target_type, target_id, details, occurred_at
  ) values (
    p_church_id, 'issue_access_invitation', v_user_id, 'application', null,
    'access_invitations', v_new_invitation_id,
    jsonb_build_object(
      'member_id', p_member_id,
      'expires_at', v_expires_at,
      'reissue', (v_prev_inv_revoked or v_prev_req_cancelled)
    ),
    v_now
  );

  v_result_payload := jsonb_build_object(
    'invitation_id', v_new_invitation_id,
    'church_id', p_church_id,
    'member_id', p_member_id,
    'recipient_email', v_clean_email,
    'expires_at', v_expires_at,
    'issued_at', v_now,
    'previous_invitation_revoked', v_prev_inv_revoked,
    'previous_request_cancelled', v_prev_req_cancelled,
    'link_unrecoverable', true
  );

  insert into app_private.command_receipts (
    church_id, user_id, command_id, action, params_hash,
    result_member_id, result_entity_id, result_payload, created_at
  ) values (
    p_church_id, v_user_id, p_command_id, 'issue_invitation', v_params_hash,
    p_member_id, v_new_invitation_id, v_result_payload, v_now
  );

  return query
  select
    v_new_invitation_id,
    p_church_id,
    p_member_id,
    v_clean_email,
    v_raw_token,
    v_expires_at,
    v_now,
    v_prev_inv_revoked,
    v_prev_req_cancelled;
end;
$function$;
