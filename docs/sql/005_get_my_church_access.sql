-- Escala do Reino — criação permanente de get_my_church_access
-- Executar somente após o ensaio 005_validate_get_my_church_access.sql
-- terminar com: PASS: ensaio concluído; função não persistida.
--
-- Esta versão termina em COMMIT.
-- Executar uma única vez. Se a função já existir, parar e revisar.

begin;

-- ── Pré-verificações ──────────────────────────────────────────────────────────

do $preflight$
begin
  if current_setting('server_encoding') <> 'UTF8'
     or current_setting('client_encoding') <> 'UTF8' then
    raise exception 'O banco e a conexão precisam usar UTF8.';
  end if;

  if to_regclass('auth.users') is null then
    raise exception 'Supabase Auth não encontrado: auth.users ausente.';
  end if;

  if to_regclass('app_private.churches')          is null
  or to_regclass('app_private.members')           is null
  or to_regclass('app_private.church_access')     is null
  or to_regclass('app_private.access_invitations') is null
  or to_regclass('app_private.access_requests')   is null
  or to_regclass('app_private.audit_entries')     is null then
    raise exception 'Uma ou mais tabelas de app_private estão ausentes. Aplicar os scripts anteriores primeiro.';
  end if;

  if to_regproc('app_private.get_my_church_access') is not null then
    raise exception
      'A função app_private.get_my_church_access já existe neste banco. '
      'Examine a definição atual antes de substituí-la. '
      'Para recriar, remova a função existente com cuidado e execute este script novamente.';
  end if;
end;
$preflight$;

-- ── Função principal ──────────────────────────────────────────────────────────
--
-- Sem parâmetros: a identidade vem exclusivamente de auth.uid().
-- SECURITY DEFINER com search_path vazio e referências qualificadas.
-- Rejeita PUBLIC, anon e service_role na ausência de GRANT para esses papéis.
-- Concede EXECUTE somente para authenticated.

create function app_private.get_my_church_access()
returns table (
  church_id               uuid,
  church_name             text,
  timezone                text,
  member_id               uuid,
  display_name            text,
  is_admin                boolean,
  default_duration_policy text
)
language sql
security definer
set search_path = ''
as $$
  select
    c.id                      as church_id,
    c.name                    as church_name,
    c.timezone                as timezone,
    m.id                      as member_id,
    m.display_name            as display_name,
    ca.is_admin               as is_admin,
    c.default_duration_policy as default_duration_policy
  from app_private.church_access  as ca
  join app_private.churches       as c  on c.id = ca.church_id
  join app_private.members        as m  on m.church_id = ca.church_id
                                       and m.id        = ca.member_id
  join auth.users                 as u  on u.id = ca.user_id
  where
    ca.user_id               = auth.uid()
    and u.email_confirmed_at is not null
    and u.banned_until       is null
    and ca.status            = 'active'
    and ca.onboarding_completed_at is not null
    and c.status             = 'active'
    and m.status             = 'active'
    and m.church_id          = ca.church_id
$$;

-- Conceder EXECUTE somente para authenticated.
-- PUBLIC, anon e service_role NÃO recebem EXECUTE.
grant execute on function app_private.get_my_church_access()
  to authenticated;

-- ── Verificação pós-criação ───────────────────────────────────────────────────

do $verify$
declare
  v_secdef boolean;
begin
  select p.prosecdef
    into v_secdef
    from pg_catalog.pg_proc      as p
    join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
   where n.nspname = 'app_private'
     and p.proname = 'get_my_church_access'
     and p.pronargs = 0;

  if not found then
    raise exception 'Verificação falhou: função não encontrada após criação.';
  end if;
  if not v_secdef then
    raise exception 'Verificação falhou: função não criada como SECURITY DEFINER.';
  end if;

  -- anon e service_role não devem ter EXECUTE
  if exists (
    select 1
      from information_schema.routine_privileges as rp
     where rp.specific_schema = 'app_private'
       and rp.routine_name    = 'get_my_church_access'
       and rp.grantee in ('PUBLIC', 'anon', 'service_role')
       and rp.privilege_type  = 'EXECUTE'
  ) then
    raise exception 'Verificação falhou: papel indevido tem EXECUTE na função.';
  end if;

  raise notice 'PASS: função criada com SECURITY DEFINER e grants corretos.';
end;
$verify$;

commit;
