-- 10. Endpoint: get_invitation_command_receipt (Consulta Idempotente de Recibo)
create function public.get_invitation_command_receipt(
  p_command_id uuid
)
returns table (
  command_id uuid,
  action text,
  church_id uuid,
  result_member_id uuid,
  result_entity_id uuid,
  result_payload jsonb,
  created_at timestamptz,
  link_unrecoverable boolean
)
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '5s'
as $function$
declare
  v_user_id uuid;
  v_cmd_id uuid;
  v_action text;
  v_church_id uuid;
  v_member_id uuid;
  v_entity_id uuid;
  v_payload jsonb;
  v_created_at timestamptz;
begin
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if p_command_id is null then
    raise exception 'Identificador de comando obrigatório.' using errcode = '22004';
  end if;

  -- Revalidação estrita da elegibilidade da conta chamadora em TODOS os caminhos
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

  select cr.command_id, cr.action, cr.church_id, cr.result_member_id,
         cr.result_entity_id, cr.result_payload, cr.created_at
  into v_cmd_id, v_action, v_church_id, v_member_id, v_entity_id, v_payload, v_created_at
  from app_private.command_receipts cr
  where cr.user_id = v_user_id and cr.command_id = p_command_id;

  if v_cmd_id is null then
    raise exception 'Recibo de comando não encontrado.' using errcode = 'P0002';
  end if;

  -- Nega ações não reconhecidas pelo subsistema de convites
  if v_action not in ('issue_invitation', 'decide_access_request', 'redeem_confirm_name', 'redeem_propose_name') then
    raise exception 'Ação de comando não reconhecida para convites.' using errcode = '42501';
  end if;

  -- Matriz de autorização da consulta de recibo:
  -- Comandos administrativos exigem autorização administrativa atual
  if v_action in ('issue_invitation', 'decide_access_request') then
    if not exists (
      select 1
      from app_private.church_access ca
      join auth.users u on u.id = ca.user_id
      join app_private.churches c on c.id = ca.church_id
      join app_private.members m on m.church_id = ca.church_id and m.id = ca.member_id
      where ca.church_id = v_church_id
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
      raise exception 'Acesso não autorizado ao recibo administrativo.' using errcode = '42501';
    end if;
  end if;
  -- Para ações de destinatário (redeem_confirm_name, redeem_propose_name),
  -- a elegibilidade da conta chamadora autora já foi validada acima;
  -- o convidado pode consultar seu próprio recibo sem necessitar de church_access.

  return query
  select
    v_cmd_id,
    v_action,
    v_church_id,
    v_member_id,
    v_entity_id,
    v_payload,
    v_created_at,
    (v_action = 'issue_invitation') as link_unrecoverable;
end;
$function$;
