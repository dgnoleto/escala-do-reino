-- 6. Endpoint: get_my_access_request (Consulta da Própria Solicitação)
create function public.get_my_access_request(
  p_church_id uuid
)
returns table (
  request_id uuid,
  church_id uuid,
  church_name text,
  member_id uuid,
  original_display_name text,
  proposed_display_name text,
  status text,
  expires_at timestamptz,
  submitted_at timestamptz,
  decided_at timestamptz,
  is_expired boolean
)
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '5s'
as $function$
declare
  v_user_id uuid;
begin
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if p_church_id is null then
    raise exception 'Identificador de igreja obrigatório.' using errcode = '22004';
  end if;

  -- Revalida conta elegível do solicitante (sem exigir vínculo prévio de church_access)
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
    ar.id,
    ar.church_id,
    c.name as church_name,
    ar.member_id,
    ar.original_display_name,
    ar.proposed_display_name,
    case
      when ar.status = 'pending' and clock_timestamp() >= ar.expires_at then 'expired'
      else ar.status
    end as status,
    ar.expires_at,
    ar.submitted_at,
    ar.decided_at,
    (ar.status = 'expired' or (ar.status = 'pending' and clock_timestamp() >= ar.expires_at)) as is_expired
  from app_private.access_requests ar
  join app_private.churches c on c.id = ar.church_id
  where ar.church_id = p_church_id
    and ar.requester_user_id = v_user_id
  order by ar.submitted_at desc, ar.id desc
  limit 1;
end;
$function$;
