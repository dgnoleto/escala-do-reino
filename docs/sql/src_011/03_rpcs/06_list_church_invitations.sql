-- 7. Endpoint: list_church_invitations (Listagem Administrativa com Paginação)
create function public.list_church_invitations(
  p_church_id uuid,
  p_status_filter text default null,
  p_limit integer default 20,
  p_offset integer default 0
)
returns table (
  invitation_id uuid,
  member_id uuid,
  member_display_name text,
  recipient_email text,
  issued_at timestamptz,
  expires_at timestamptz,
  status text,
  redeemed_at timestamptz,
  revoked_at timestamptz,
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
  v_limit integer;
  v_offset integer;
begin
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if p_church_id is null then
    raise exception 'Identificador de igreja obrigatório.' using errcode = '22004';
  end if;

  -- Autorização administrativa rigorosa
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

  v_limit := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_offset := greatest(coalesce(p_offset, 0), 0);

  return query
  with computed_invitations as (
    select
      ai.id as inv_id,
      ai.member_id as m_id,
      m.display_name as m_name,
      ai.recipient_email as rec_email,
      ai.issued_at as iss_at,
      ai.expires_at as exp_at,
      case
        when ai.redeemed_at is not null then 'redeemed'
        when ai.revoked_at is not null then 'revoked'
        when clock_timestamp() >= ai.expires_at then 'expired'
        else 'open'
      end as eff_status,
      ai.redeemed_at as red_at,
      ai.revoked_at as rev_at
    from app_private.access_invitations ai
    join app_private.members m on m.church_id = ai.church_id and m.id = ai.member_id
    where ai.church_id = p_church_id
  )
  select
    ci.inv_id,
    ci.m_id,
    ci.m_name,
    ci.rec_email,
    ci.iss_at,
    ci.exp_at,
    ci.eff_status as status,
    ci.red_at,
    ci.rev_at,
    count(*) over() as total_count
  from computed_invitations ci
  where p_status_filter is null or p_status_filter = 'all' or ci.eff_status = p_status_filter
  order by ci.iss_at desc, ci.inv_id desc
  limit v_limit
  offset v_offset;
end;
$function$;
