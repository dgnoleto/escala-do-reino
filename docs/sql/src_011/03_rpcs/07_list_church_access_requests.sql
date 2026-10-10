-- 8. Endpoint: list_church_access_requests (Listagem Administrativa com Paginação)
create function public.list_church_access_requests(
  p_church_id uuid,
  p_status_filter text default 'pending',
  p_limit integer default 20,
  p_offset integer default 0
)
returns table (
  request_id uuid,
  member_id uuid,
  current_display_name text,
  original_display_name text,
  proposed_display_name text,
  requester_email text,
  submitted_at timestamptz,
  expires_at timestamptz,
  status text,
  decided_at timestamptz,
  decided_by_name text,
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
  with computed_requests as (
    select
      ar.id as req_id,
      ar.member_id as m_id,
      m.display_name as cur_name,
      ar.original_display_name as orig_name,
      ar.proposed_display_name as prop_name,
      coalesce(u.email, '')::text as req_email,
      ar.submitted_at as sub_at,
      ar.expires_at as exp_at,
      case
        when ar.status = 'pending' and clock_timestamp() >= ar.expires_at then 'expired'
        else ar.status
      end as eff_status,
      ar.decided_at as dec_at,
      dm.display_name as dec_name
    from app_private.access_requests ar
    join app_private.members m on m.church_id = ar.church_id and m.id = ar.member_id
    join auth.users u on u.id = ar.requester_user_id
    left join app_private.church_access dca on dca.church_id = ar.church_id and dca.user_id = ar.decided_by_user_id
    left join app_private.members dm on dm.church_id = ar.church_id and dm.id = dca.member_id
    where ar.church_id = p_church_id
  )
  select
    cr.req_id,
    cr.m_id,
    cr.cur_name,
    cr.orig_name,
    cr.prop_name,
    cr.req_email,
    cr.sub_at,
    cr.exp_at,
    cr.eff_status as status,
    cr.dec_at,
    cr.dec_name as decided_by_name,
    count(*) over() as total_count
  from computed_requests cr
  where p_status_filter is null or p_status_filter = 'all' or cr.eff_status = p_status_filter
  order by cr.sub_at desc, cr.req_id desc
  limit v_limit
  offset v_offset;
end;
$function$;
