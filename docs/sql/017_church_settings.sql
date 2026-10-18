-- Candidato: cadastro da igreja exclusivo de administradores, com logo em Storage privado.
-- NÃO executar no piloto sem revisão, ensaio com ROLLBACK e autorização específica.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $preflight$
begin
  if to_regclass('app_private.churches') is null
    or to_regclass('app_private.audit_entries') is null
    or to_regclass('storage.objects') is null or to_regclass('storage.buckets') is null then
    raise exception 'Estrutura de acesso, auditoria e Storage obrigatória.';
  end if;
  if to_regprocedure('public.get_church_settings(uuid)') is not null
    or exists(select 1 from storage.buckets where id = 'church-logos') then
    raise exception 'Incremento ou bucket já existente. Parar e conferir, sem sobrescrever.';
  end if;
end;
$preflight$;

alter table app_private.churches
  add column logo_path text,
  add column profile_revision integer not null default 0 check (profile_revision >= 0),
  add constraint churches_logo_path_valid check (logo_path is null or (
    split_part(logo_path, '/', 1) = id::text
    and logo_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(png|jpg|webp)$'
  ));

-- Recibos próprios não modificam o contrato de command_receipts dos incrementos anteriores.
create table app_private.church_settings_receipts (
  user_id uuid not null references auth.users(id) on delete restrict,
  command_id uuid not null,
  church_id uuid not null references app_private.churches(id) on delete restrict,
  params jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default statement_timestamp(),
  primary key (user_id, command_id)
);
alter table app_private.church_settings_receipts enable row level security;
revoke all on app_private.church_settings_receipts from public, anon, authenticated, service_role;

-- Identidade e permissão são sempre derivadas no servidor. O cliente não informa usuário/papel.
create function app_private.has_church_settings_access(p_church_id uuid, p_require_admin boolean)
returns boolean language sql stable security definer set search_path = ''
as $function$
  select exists (
    select 1 from app_private.church_access ca
    join app_private.churches c on c.id = ca.church_id
    join app_private.members m on m.id = ca.member_id and m.church_id = ca.church_id
    join auth.users u on u.id = ca.user_id
    where ca.church_id = p_church_id and ca.user_id = (select auth.uid())
      and ca.status = 'active' and ca.onboarding_completed_at is not null
      and (not p_require_admin or ca.is_admin)
      and c.status = 'active' and m.status = 'active'
      and u.email_confirmed_at is not null and u.deleted_at is null
      and not coalesce(u.is_anonymous, false)
      and (u.banned_until is null or u.banned_until <= statement_timestamp())
  );
$function$;
revoke all on function app_private.has_church_settings_access(uuid, boolean) from public, anon, authenticated, service_role;

create function public.get_church_settings(p_church_id uuid)
returns table(church_id uuid, name text, timezone text, address text, google_maps_url text,
  logo_path text, profile_revision integer)
language plpgsql stable security definer set search_path = '' set statement_timeout = '5s'
as $function$
begin
  if not app_private.has_church_settings_access(p_church_id, true) then
    raise exception 'Cadastro exclusivo de administradores ativos desta igreja.' using errcode = '42501';
  end if;
  return query select c.id, c.name, c.timezone, c.address, c.google_maps_url, c.logo_path, c.profile_revision
    from app_private.churches c where c.id = p_church_id;
end;
$function$;

create function public.update_church_settings(
  p_church_id uuid, p_command_id uuid, p_expected_revision integer,
  p_address text, p_google_maps_url text, p_logo_path text
)
returns table(church_id uuid, command_id uuid, profile_revision integer)
language plpgsql security definer set search_path = '' set statement_timeout = '10s'
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_address text := nullif(btrim(p_address), '');
  v_maps text := nullif(btrim(p_google_maps_url), '');
  v_params jsonb;
  v_receipt app_private.church_settings_receipts%rowtype;
  v_church app_private.churches%rowtype;
  v_revision integer;
begin
  if v_uid is null then raise exception 'Não autenticado.' using errcode = '28000'; end if;
  if p_church_id is null or p_command_id is null or p_expected_revision is null or p_expected_revision < 0 then
    raise exception 'Parâmetros inválidos.' using errcode = '22023';
  end if;
  -- Ordem compatível com os escritores de acesso/ciclo de vida: comando -> continuidade -> igreja -> autoridade.
  perform pg_catalog.pg_advisory_xact_lock(hashtext(v_uid::text), hashtext(p_command_id::text));
  perform pg_catalog.pg_advisory_xact_lock(hashtext('church_admin_continuity'), hashtext(p_church_id::text));
  select c.* into v_church from app_private.churches c where c.id = p_church_id for update;
  -- Bloqueia as fontes de autoridade e revalida após eventuais esperas.
  perform 1 from app_private.church_access ca
    join app_private.members m on m.id = ca.member_id and m.church_id = ca.church_id
    join auth.users u on u.id = ca.user_id
    where ca.church_id = p_church_id and ca.user_id = v_uid for share of ca, m, u;
  if not app_private.has_church_settings_access(p_church_id, true) then
    raise exception 'Cadastro exclusivo de administradores ativos desta igreja.' using errcode = '42501';
  end if;

  if char_length(v_address) > 500 or char_length(v_maps) > 1024
    or (v_maps is not null and v_maps !~* '^https://(maps\.app\.goo\.gl/[^[:space:]]+|goo\.gl/maps/[^[:space:]]+|((www\.)?google\.(com(\.[a-z]{2})?|[a-z]{2})/maps([/?#][^[:space:]]*)?|maps\.google\.(com(\.[a-z]{2})?|[a-z]{2})/[^[:space:]]*))$') then
    raise exception 'Endereço ou localização inválidos.' using errcode = '22023';
  end if;
  if p_logo_path is not null and (
    split_part(p_logo_path, '/', 1) <> p_church_id::text
    or p_logo_path !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(png|jpg|webp)$'
  ) then raise exception 'Logo de outra igreja ou caminho inválido.' using errcode = '22023'; end if;

  v_params := jsonb_build_object('church_id', p_church_id, 'expected_revision', p_expected_revision,
    'address', v_address, 'google_maps_url', v_maps, 'logo_path', p_logo_path);
  select r.* into v_receipt from app_private.church_settings_receipts r
    where r.user_id = v_uid and r.command_id = p_command_id;
  if found then
    if v_receipt.church_id <> p_church_id or v_receipt.params <> v_params then
      raise exception 'Comando já utilizado com outros dados.' using errcode = '23505';
    end if;
    return query select p_church_id, p_command_id, (v_receipt.result->>'profile_revision')::integer;
    return;
  end if;
  if v_church.profile_revision <> p_expected_revision then
    raise exception 'Cadastro alterado por outra edição. Recarregue.' using errcode = '40001';
  end if;
  if p_logo_path is not null then
    -- Impede remoção concorrente do objeto entre validação e gravação da referência.
    perform 1 from storage.objects o where o.bucket_id = 'church-logos' and o.name = p_logo_path
      and o.metadata->>'mimetype' in ('image/png','image/jpeg','image/webp') for share;
    if not found then raise exception 'Logo não encontrada no armazenamento privado.' using errcode = '22023'; end if;
  end if;
  v_revision := v_church.profile_revision + 1;
  update app_private.churches c set address = v_address, google_maps_url = v_maps,
    logo_path = p_logo_path, profile_revision = v_revision where c.id = p_church_id;
  insert into app_private.audit_entries(church_id, action, actor_user_id, actor_source, target_type, target_id, details)
    values(p_church_id, 'update_church_settings', v_uid, 'application', 'church', p_church_id,
      jsonb_build_object('command_id', p_command_id, 'profile_revision', v_revision,
        'previous_revision', v_church.profile_revision,
        'changed_fields', jsonb_build_object('address', v_church.address is distinct from v_address,
          'google_maps_url', v_church.google_maps_url is distinct from v_maps,
          'logo_path', v_church.logo_path is distinct from p_logo_path)));
  insert into app_private.church_settings_receipts(user_id, command_id, church_id, params, result)
    values(v_uid, p_command_id, p_church_id, v_params, jsonb_build_object('profile_revision', v_revision,
      'before', jsonb_build_object('address', v_church.address, 'google_maps_url', v_church.google_maps_url, 'logo_path', v_church.logo_path)));
  return query select p_church_id, p_command_id, v_revision;
end;
$function$;

-- Somente a identidade visual pode ser consultada por membros. Não expõe o cadastro administrativo.
create function public.get_church_logo(p_church_id uuid)
returns table(logo_path text) language plpgsql stable security definer set search_path = ''
as $function$
begin
  if not app_private.has_church_settings_access(p_church_id, false) then
    raise exception 'Sem acesso a esta igreja.' using errcode = '42501';
  end if;
  return query select c.logo_path from app_private.churches c where c.id = p_church_id;
end;
$function$;

-- Storage precisa de um helper público de autorização, sem dados cadastrais no retorno.
create function public.can_access_church_logo(p_name text, p_write boolean)
returns boolean language plpgsql stable security definer set search_path = ''
as $function$
declare v_church_id uuid;
begin
  if p_write is null or p_name is null or p_name !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(png|jpg|webp)$' then return false; end if;
  begin v_church_id := split_part(p_name, '/', 1)::uuid;
  exception when invalid_text_representation then return false; end;
  return app_private.has_church_settings_access(v_church_id, p_write)
    and (p_write or exists(select 1 from app_private.churches c where c.id = v_church_id and c.logo_path = p_name)
      or app_private.has_church_settings_access(v_church_id, true));
end;
$function$;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
  values('church-logos', 'church-logos', false, 2097152, array['image/png','image/jpeg','image/webp']);
-- Arquivos imutáveis: não há UPDATE nem DELETE pelo cliente. Trocar/remover a logo altera apenas a referência.
create policy church_logos_read on storage.objects for select to authenticated
  using(bucket_id = 'church-logos' and public.can_access_church_logo(name, false));
create policy church_logos_insert on storage.objects for insert to authenticated
  with check(bucket_id = 'church-logos' and public.can_access_church_logo(name, true));
-- Políticas permissivas preexistentes de outros buckets não podem abrir este bucket.
create policy church_logos_read_guard on storage.objects as restrictive for select to anon, authenticated
  using(bucket_id <> 'church-logos' or public.can_access_church_logo(name, false));
create policy church_logos_insert_guard on storage.objects as restrictive for insert to anon, authenticated
  with check(bucket_id <> 'church-logos' or public.can_access_church_logo(name, true));
create policy church_logos_update_guard on storage.objects as restrictive for update to anon, authenticated
  using(bucket_id <> 'church-logos') with check(bucket_id <> 'church-logos');
create policy church_logos_delete_guard on storage.objects as restrictive for delete to anon, authenticated
  using(bucket_id <> 'church-logos');

revoke all on function public.get_church_settings(uuid) from public, anon, authenticated, service_role;
revoke all on function public.update_church_settings(uuid, uuid, integer, text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.get_church_logo(uuid) from public, anon, authenticated, service_role;
revoke all on function public.can_access_church_logo(text, boolean) from public, anon, authenticated, service_role;
grant execute on function public.get_church_settings(uuid) to authenticated;
grant execute on function public.update_church_settings(uuid, uuid, integer, text, text, text) to authenticated;
grant execute on function public.get_church_logo(uuid) to authenticated;
grant execute on function public.can_access_church_logo(text, boolean) to authenticated;
-- O helper booleano permite que as políticas restritivas neguem também políticas anônimas preexistentes.
grant execute on function public.can_access_church_logo(text, boolean) to anon;
-- Preserva o mesmo proprietário dos comandos anteriores; o executor de manutenção não vira o definer.
alter table app_private.church_settings_receipts owner to postgres;
alter function app_private.has_church_settings_access(uuid, boolean) owner to postgres;
alter function public.get_church_settings(uuid) owner to postgres;
alter function public.update_church_settings(uuid, uuid, integer, text, text, text) owner to postgres;
alter function public.get_church_logo(uuid) owner to postgres;
alter function public.can_access_church_logo(text, boolean) owner to postgres;
notify pgrst, 'reload schema';
commit;
