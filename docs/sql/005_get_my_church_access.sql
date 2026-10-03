-- Escala do Reino: consulta autorizada pelo endpoint public.get_my_church_access().
-- app_private continua fora da Data API e sem acesso direto para clientes.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $preflight$
declare v_role text;
begin
  if current_setting('server_encoding') <> 'UTF8'
     or current_setting('client_encoding') <> 'UTF8' then
    raise exception 'Banco e conexao precisam usar UTF8.';
  end if;
  if to_regclass('auth.users') is null
     or to_regclass('app_private.churches') is null
     or to_regclass('app_private.members') is null
     or to_regclass('app_private.church_access') is null
     or to_regclass('app_private.access_invitations') is null
     or to_regclass('app_private.access_requests') is null
     or to_regclass('app_private.audit_entries') is null then
    raise exception 'Estrutura anterior ausente. Parar e conferir; nao repetir scripts ja aplicados.';
  end if;
  if exists (
    select 1 from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'get_my_church_access'
  ) then
    raise exception 'Ja existe public.get_my_church_access. Parar e revisar a definicao.';
  end if;
  foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
    if has_schema_privilege(v_role, 'app_private', 'USAGE,CREATE')
       or exists (
         select 1 from pg_catalog.pg_class c
         join pg_catalog.pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'app_private' and c.relkind = 'r'
           and has_table_privilege(v_role, c.oid,
             'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
       ) then
      raise exception 'Permissoes internas inesperadas para %. Parar e revisar.', v_role;
    end if;
  end loop;
end;
$preflight$;

create function public.get_my_church_access()
returns table (
  church_id uuid, church_name text, timezone text, member_id uuid,
  display_name text, is_admin boolean, default_duration_policy text
)
language sql
stable
security definer
set search_path = ''
as $function$
  select c.id, c.name, c.timezone, m.id, m.display_name,
         ca.is_admin, c.default_duration_policy
  from app_private.church_access ca
  join app_private.churches c on c.id = ca.church_id
  join app_private.members m on m.church_id = ca.church_id and m.id = ca.member_id
  join auth.users u on u.id = ca.user_id
  where ca.user_id = (select auth.uid())
    and u.email_confirmed_at is not null
    and u.deleted_at is null
    and not coalesce(u.is_anonymous, false)
    and (u.banned_until is null or u.banned_until <= statement_timestamp())
    and ca.status = 'active'
    and ca.onboarding_completed_at is not null
    and c.status = 'active'
    and m.status = 'active'
  order by c.id
$function$;

-- Revogar explicitamente os privilegios padrao de public antes do COMMIT.
revoke all on function public.get_my_church_access()
  from public, anon, authenticated, service_role;
grant execute on function public.get_my_church_access() to authenticated;

do $verify$
declare v_function oid := to_regprocedure('public.get_my_church_access()');
begin
  if not exists (
    select 1 from pg_catalog.pg_proc p
    where p.oid = v_function and p.prosecdef and p.pronargs = 0
      and (p.proconfig @> array['search_path=""']
           or p.proconfig @> array['search_path='])
  ) then
    raise exception 'Funcao sem configuracao de seguranca esperada.';
  end if;
  if not has_function_privilege('authenticated', v_function, 'EXECUTE')
     or has_function_privilege('anon', v_function, 'EXECUTE')
     or has_function_privilege('service_role', v_function, 'EXECUTE')
     or exists (
       select 1 from pg_catalog.pg_proc p,
         lateral pg_catalog.aclexplode(
           coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
         ) a
       where p.oid = v_function and a.grantee = 0
         and a.privilege_type = 'EXECUTE'
     ) then
    raise exception 'Permissoes de execucao diferentes do contrato.';
  end if;
end;
$verify$;

-- Pede ao PostgREST para reconhecer a nova funcao ao confirmar a transacao.
notify pgrst, 'reload schema';
commit;

select 'PASS: consulta pública autorizada criada; tabelas internas permanecem fechadas.'
  as validation_result;
