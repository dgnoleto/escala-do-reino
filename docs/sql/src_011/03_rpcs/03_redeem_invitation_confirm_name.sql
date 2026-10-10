-- 4. Endpoint: redeem_invitation_confirm_name (Resgate Confirmando Nome Cadastrado)
create function public.redeem_invitation_confirm_name(
  p_command_id uuid,
  p_raw_token text,
  p_expected_display_name text
)
returns table (
  church_id uuid,
  church_name text,
  member_id uuid,
  display_name text,
  access_granted boolean,
  onboarding_completed_at timestamptz
)
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $function$
declare
  v_user_id uuid;
  v_user_email text;
  v_clean_expected_name text;
  v_token_digest bytea;
  v_params_json jsonb;
  v_params_hash bytea;
  v_existing_action text;
  v_existing_hash bytea;
  v_existing_payload jsonb;
  v_invitation_id uuid;
  v_church_id uuid;
  v_church_name text;
  v_member_id uuid;
  v_recipient_email text;
  v_expires_at timestamptz;
  v_issuer_id uuid;
  v_redeemed_at timestamptz;
  v_revoked_at timestamptz;
  v_locked_church_id uuid;
  v_locked_member_id uuid;
  v_current_display_name text;
  v_locked_inv_id uuid;
  v_locked_expires_at timestamptz;
  v_now timestamptz;
  v_new_access_id uuid;
  v_result_payload jsonb;
begin
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if p_command_id is null or p_raw_token is null or p_expected_display_name is null then
    raise exception 'Parâmetros obrigatórios incompletos.' using errcode = '22004';
  end if;

  if char_length(p_raw_token) not between 43 and 44 or p_raw_token !~ '^[A-Za-z0-9_-]+$' then
    raise exception 'Token de convite em formato inválido.' using errcode = '23514';
  end if;

  v_clean_expected_name := pg_catalog.btrim(pg_catalog.normalize(p_expected_display_name, 'NFC'));
  v_token_digest := pg_catalog.sha256(pg_catalog.convert_to(p_raw_token, 'UTF8'));

  v_params_json := jsonb_build_object(
    'v', 2,
    'action', 'redeem_confirm_name',
    'token_digest', pg_catalog.encode(v_token_digest, 'hex'),
    'expected_display_name', v_clean_expected_name
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
    if v_existing_action <> 'redeem_confirm_name' or v_existing_hash <> v_params_hash then
      raise exception 'Comando já executado com parâmetros diferentes.' using errcode = '23505';
    end if;

    -- Revalidação estrita da conta atual antes da entrega do replay
    if not exists (
      select 1 from auth.users u
      where u.id = v_user_id
        and u.email_confirmed_at is not null
        and u.deleted_at is null
        and not coalesce(u.is_anonymous, false)
        and (u.banned_until is null or u.banned_until <= clock_timestamp())
    ) then
      raise exception 'Conta inelegível ou e-mail não confirmado.' using errcode = '42501';
    end if;

    return query
    select
      (v_existing_payload->>'church_id')::uuid,
      (v_existing_payload->>'church_name')::text,
      (v_existing_payload->>'member_id')::uuid,
      (v_existing_payload->>'display_name')::text,
      coalesce((v_existing_payload->>'access_granted')::boolean, true),
      (v_existing_payload->>'onboarding_completed_at')::timestamptz;
    return;
  end if;

  -- Localização prévia do convite pelo digest para ordenação canônica de bloqueios
  select ai.id, ai.church_id, ai.member_id, ai.recipient_email, ai.expires_at,
         ai.issued_by_user_id, ai.redeemed_at, ai.revoked_at
  into v_invitation_id, v_church_id, v_member_id, v_recipient_email, v_expires_at,
       v_issuer_id, v_redeemed_at, v_revoked_at
  from app_private.access_invitations ai
  where ai.token_digest = v_token_digest;

  if v_invitation_id is null or v_revoked_at is not null or v_redeemed_at is not null
     or clock_timestamp() >= v_expires_at then
    raise exception 'Convite inválido, revogado ou expirado.' using errcode = 'P0002';
  end if;

  -- Bloqueios de domínio na ordem canônica:
  -- 1) Igreja SHARE
  select c.id, c.name into v_locked_church_id, v_church_name
  from app_private.churches c
  where c.id = v_church_id and c.status = 'active'
  for share;

  if v_locked_church_id is null then
    raise exception 'Igreja inativa ou não encontrada.' using errcode = 'P0002';
  end if;

  -- 2) Membro Alvo UPDATE
  select m.id, m.display_name into v_locked_member_id, v_current_display_name
  from app_private.members m
  where m.church_id = v_church_id and m.id = v_member_id and m.status = 'active'
  for update;

  if v_locked_member_id is null then
    raise exception 'Membro inativo ou não encontrado.' using errcode = 'P0002';
  end if;

  -- 3) Convite UPDATE
  select ai.id, ai.expires_at, ai.recipient_email into v_locked_inv_id, v_locked_expires_at, v_recipient_email
  from app_private.access_invitations ai
  where ai.id = v_invitation_id and ai.redeemed_at is null and ai.revoked_at is null
  for update;

  if v_locked_inv_id is null then
    raise exception 'Convite não está mais aberto.' using errcode = 'P0002';
  end if;

  -- Revalidações estritas no instante pós-bloqueio no relógio atual
  v_now := clock_timestamp();
  if v_now >= v_locked_expires_at then
    raise exception 'Convite expirado.' using errcode = 'P0004';
  end if;

  -- Releitura da conta Auth no instante final pós-locks
  select u.email into v_user_email
  from auth.users u
  where u.id = v_user_id
    and u.email_confirmed_at is not null
    and u.deleted_at is null
    and not coalesce(u.is_anonymous, false)
    and (u.banned_until is null or u.banned_until <= v_now);

  if v_user_email is null then
    raise exception 'Conta inelegível ou e-mail não confirmado.' using errcode = '42501';
  end if;

  if pg_catalog.lower(pg_catalog.btrim(v_user_email)) <> pg_catalog.lower(pg_catalog.btrim(v_recipient_email)) then
    raise exception 'Convite não associado a esta conta.' using errcode = '42501';
  end if;

  if exists (
    select 1 from app_private.church_access ca
    where ca.church_id = v_church_id and ca.user_id = v_user_id and ca.status = 'active'
  ) then
    raise exception 'Usuário já possui acesso ativo nesta igreja.' using errcode = '23505';
  end if;

  if exists (
    select 1 from app_private.church_access ca
    where ca.church_id = v_church_id and ca.member_id = v_member_id and ca.status = 'active'
  ) then
    raise exception 'Membro já vinculado a outro acesso ativo.' using errcode = '23505';
  end if;

  -- Proibição de bypass de revogação
  if exists (
    select 1 from app_private.church_access ca
    where ca.church_id = v_church_id and (ca.user_id = v_user_id or ca.member_id = v_member_id)
      and ca.status = 'revoked'
  ) then
    raise exception 'Vínculo anterior revogado detectado. Resgate não pode reativar acesso revogado.' using errcode = '42501';
  end if;

  if v_current_display_name <> v_clean_expected_name then
    raise exception 'Nome do membro foi alterado antes da confirmação.' using errcode = 'P0005';
  end if;

  -- Consumo atômico do convite
  update app_private.access_invitations
  set redeemed_at = v_now,
      redeemed_by_user_id = v_user_id
  where id = v_invitation_id;

  v_new_access_id := gen_random_uuid();

  insert into app_private.church_access (
    id, church_id, user_id, member_id, status, is_admin,
    onboarding_completed_at, granted_by_user_id, granted_at, created_at, updated_at
  ) values (
    v_new_access_id, v_church_id, v_user_id, v_member_id, 'active', false,
    v_now, v_issuer_id, v_now, v_now, v_now
  );

  insert into app_private.audit_entries (
    church_id, action, actor_user_id, actor_source, maintenance_operator,
    target_type, target_id, details, occurred_at
  ) values (
    v_church_id, 'redeem_invitation_confirm_name', v_user_id, 'application', null,
    'church_access', v_new_access_id,
    jsonb_build_object('invitation_id', v_invitation_id, 'member_id', v_member_id),
    v_now
  );

  v_result_payload := jsonb_build_object(
    'church_id', v_church_id,
    'church_name', v_church_name,
    'member_id', v_member_id,
    'display_name', v_current_display_name,
    'access_granted', true,
    'onboarding_completed_at', v_now
  );

  insert into app_private.command_receipts (
    church_id, user_id, command_id, action, params_hash,
    result_member_id, result_entity_id, result_payload, created_at
  ) values (
    v_church_id, v_user_id, p_command_id, 'redeem_confirm_name', v_params_hash,
    v_member_id, v_new_access_id, v_result_payload, v_now
  );

  return query
  select v_church_id, v_church_name, v_member_id, v_current_display_name, true, v_now;
end;
$function$;
