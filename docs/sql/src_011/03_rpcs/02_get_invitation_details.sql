-- 3. Endpoint: get_invitation_details (Consulta Autorizada Estrita)
create function public.get_invitation_details(
  p_raw_token text
)
returns table (
  invitation_id uuid,
  church_id uuid,
  church_name text,
  member_id uuid,
  member_display_name text,
  expires_at timestamptz,
  is_valid boolean
)
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '5s'
as $function$
declare
  v_user_id uuid;
  v_user_email text;
  v_email_confirmed boolean;
  v_not_deleted boolean;
  v_not_banned boolean;
  v_not_anon boolean;
  v_token_digest bytea;
  v_invitation_id uuid;
  v_church_id uuid;
  v_church_name text;
  v_member_id uuid;
  v_member_display_name text;
  v_expires_at timestamptz;
  v_recipient_email text;
  v_redeemed_at timestamptz;
  v_revoked_at timestamptz;
  v_church_status text;
  v_member_status text;
begin
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  select
    u.email,
    (u.email_confirmed_at is not null),
    (u.deleted_at is null),
    (u.banned_until is null or u.banned_until <= clock_timestamp()),
    not coalesce(u.is_anonymous, false)
  into v_user_email, v_email_confirmed, v_not_deleted, v_not_banned, v_not_anon
  from auth.users u
  where u.id = v_user_id;

  -- Resposta estritamente genérica caso a conta Auth seja inelegível
  if not coalesce(v_email_confirmed, false)
     or not coalesce(v_not_deleted, false)
     or not coalesce(v_not_banned, false)
     or not coalesce(v_not_anon, false) then
    return query select null::uuid, null::uuid, null::text, null::uuid, null::text, null::timestamptz, false;
    return;
  end if;

  -- Token deve possuir formato Base64URL exato
  if p_raw_token is null or char_length(p_raw_token) not between 43 and 44
     or p_raw_token !~ '^[A-Za-z0-9_-]+$' then
    return query select null::uuid, null::uuid, null::text, null::uuid, null::text, null::timestamptz, false;
    return;
  end if;

  v_token_digest := pg_catalog.sha256(pg_catalog.convert_to(p_raw_token, 'UTF8'));

  select
    ai.id, ai.church_id, c.name, ai.member_id, m.display_name, ai.expires_at,
    ai.recipient_email, ai.redeemed_at, ai.revoked_at, c.status, m.status
  into
    v_invitation_id, v_church_id, v_church_name, v_member_id, v_member_display_name, v_expires_at,
    v_recipient_email, v_redeemed_at, v_revoked_at, v_church_status, v_member_status
  from app_private.access_invitations ai
  join app_private.churches c on c.id = ai.church_id
  join app_private.members m on m.church_id = ai.church_id and m.id = ai.member_id
  where ai.token_digest = v_token_digest;

  -- Proteção contra enumeração e correspondência exata de e-mail confirmado
  if v_invitation_id is not null
     and v_redeemed_at is null
     and v_revoked_at is null
     and clock_timestamp() < v_expires_at
     and v_church_status = 'active'
     and v_member_status = 'active'
     and pg_catalog.lower(pg_catalog.btrim(v_user_email)) = pg_catalog.lower(pg_catalog.btrim(v_recipient_email))
  then
    return query
    select v_invitation_id, v_church_id, v_church_name, v_member_id, v_member_display_name, v_expires_at, true;
  else
    return query
    select null::uuid, null::uuid, null::text, null::uuid, null::text, null::timestamptz, false;
  end if;
end;
$function$;
