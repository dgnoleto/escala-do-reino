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

-- Ensaio sob os papeis efetivos, usando somente fixtures novas que serao desfeitas.
-- Nenhuma conta Auth ou registro real existente e alterado.
lock table app_private.churches, app_private.members, app_private.church_access
  in share row exclusive mode;

do $tests$
declare
  v_operator text := current_user;
  v_user uuid;
  v_church uuid;
  v_unlinked uuid;
  v_member uuid;
  v_access uuid;
  v_phase int;
  v_count int;
  v_admin boolean;
  v_role text;
  v_unrelated uuid;
begin
  select u.id into v_user
  from auth.users u
  where u.email_confirmed_at is not null and u.deleted_at is null
    and not coalesce(u.is_anonymous, false)
    and (u.banned_until is null or u.banned_until <= statement_timestamp())
  order by u.id limit 1;
  if v_user is null then
    raise exception 'Ensaio exige uma conta confirmada elegivel ja existente.';
  end if;

  insert into app_private.churches (name, timezone, default_duration_policy)
    values ('SQL test linked', 'America/Sao_Paulo', 'warn') returning id into v_church;
  insert into app_private.churches (name, timezone, default_duration_policy)
    values ('SQL test unlinked', 'America/Sao_Paulo', 'warn') returning id into v_unlinked;
  insert into app_private.members (church_id, display_name, created_by_user_id)
    values (v_church, normalize('João da Conceição', NFC), v_user) returning id into v_member;
  insert into app_private.church_access
    (church_id, member_id, user_id, is_admin, onboarding_completed_at, granted_by_user_id)
    values (v_church, v_member, v_user, false, statement_timestamp(), v_user)
    returning id into v_access;

  perform set_config('request.jwt.claim.sub', v_user::text, true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', v_user::text, 'role', 'authenticated',
      'user_metadata', jsonb_build_object('is_admin', true))::text, true);

  for v_phase in 0..3 loop
    if v_phase = 1 then
      update app_private.church_access
        set status = 'revoked', revoked_by_user_id = v_user, revoked_at = clock_timestamp()
        where id = v_access;
    elsif v_phase = 2 then
      update app_private.church_access
        set status = 'active', revoked_by_user_id = null, revoked_at = null where id = v_access;
      update app_private.members set status = 'inactive' where id = v_member;
    elsif v_phase = 3 then
      update app_private.members set status = 'active' where id = v_member;
      update app_private.churches set status = 'inactive' where id = v_church;
    end if;

    perform set_config('role', 'authenticated', true);
    if current_user <> 'authenticated' then
      raise exception 'O teste nao esta executando como authenticated.';
    end if;

    select count(*), bool_or(a.is_admin) into v_count, v_admin
      from public.get_my_church_access() a where a.church_id = v_church;
    if v_phase = 0 then
      if v_count <> 1 or v_admin is distinct from false then
        raise exception 'Vinculo proprio basico nao reconhecido ou metadata concedeu admin.';
      end if;
      if not exists (
        select 1 from public.get_my_church_access() a
        where a.church_id = v_church and a.member_id = v_member
          and a.display_name = normalize('João da Conceição', NFC)
      ) then
        raise exception 'Nome UTF8 ou membro divergente.';
      end if;
    elsif v_count <> 0 then
      raise exception 'Vinculo revogado ou cadastro inativo liberou acesso; fase %.', v_phase;
    end if;
    if exists (select 1 from public.get_my_church_access() a where a.church_id = v_unlinked) then
      raise exception 'Igreja sem vinculo foi exposta.';
    end if;
    perform set_config('role', v_operator, true);
  end loop;

  -- UID sem conta: simula identidade sem acesso, nao cria conta Auth artificial.
  -- Uma segunda conta REAL confirmada sem vinculo ainda deve ser testada via login.
  loop
    v_unrelated := gen_random_uuid();
    exit when not exists (select 1 from auth.users where id = v_unrelated);
  end loop;
  perform set_config('request.jwt.claim.sub', v_unrelated::text, true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', v_unrelated::text, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  if exists (select 1 from public.get_my_church_access()) then
    raise exception 'UID sem conta recebeu dados.';
  end if;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '{"role":"authenticated"}', true);
  if exists (select 1 from public.get_my_church_access()) then
    raise exception 'Identidade ausente recebeu dados.';
  end if;
  perform set_config('role', v_operator, true);

  foreach v_role in array array['anon', 'service_role'] loop
    perform set_config('role', v_role, true);
    begin
      perform 1 from public.get_my_church_access();
      raise exception 'Papel % conseguiu executar a consulta.', v_role;
    exception when insufficient_privilege then
      null;
    end;
    perform set_config('role', v_operator, true);
  end loop;
end;
$tests$;

rollback;

select case
  when to_regprocedure('public.get_my_church_access()') is null
  then 'PASS: ensaio concluído; função e dados de teste não persistidos.'
  else 'FAIL: função presente após ensaio; parar e revisar.'
end as validation_result;
