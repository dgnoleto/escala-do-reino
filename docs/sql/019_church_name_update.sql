-- Candidato 019: Permitir ao administrador corrigir o nome da igreja (Issue #22)
-- Cobre critérios CA01 a CA07.
-- NÃO executar no piloto sem revisão, ensaio com ROLLBACK e autorização específica.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $preflight$
begin
  if to_regclass('app_private.churches') is null
    or to_regclass('app_private.church_access') is null
    or to_regclass('app_private.members') is null
    or to_regclass('app_private.audit_entries') is null
    or to_regclass('app_private.church_settings_receipts') is null
    or to_regprocedure('public.get_church_settings(uuid)') is null then
    raise exception 'Estrutura base de cadastro da igreja, auditoria e recibos (017) obrigatória.';
  end if;
end;
$preflight$;

-- 1. Endpoint principal com 7 parâmetros (incluindo p_name)
create or replace function public.update_church_settings(
  p_church_id uuid,
  p_command_id uuid,
  p_expected_revision integer,
  p_name text,
  p_address text,
  p_google_maps_url text,
  p_logo_path text
)
returns table(church_id uuid, command_id uuid, profile_revision integer)
language plpgsql
security definer
set search_path = ''
set statement_timeout = '10s'
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_clean_name text;
  v_address text := nullif(btrim(p_address), '');
  v_maps text := nullif(btrim(p_google_maps_url), '');
  v_params jsonb;
  v_receipt app_private.church_settings_receipts%rowtype;
  v_church app_private.churches%rowtype;
  v_revision integer;
begin
  if v_uid is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if p_church_id is null or p_command_id is null or p_expected_revision is null or p_expected_revision < 0 or p_name is null then
    raise exception 'Parâmetros inválidos.' using errcode = '22023';
  end if;

  -- Ordem compatível com os escritores de acesso/ciclo de vida: comando -> continuidade -> igreja -> autoridade.
  perform pg_catalog.pg_advisory_xact_lock(hashtext(v_uid::text), hashtext(p_command_id::text));
  perform pg_catalog.pg_advisory_xact_lock(hashtext('church_admin_continuity'), hashtext(p_church_id::text));
  select c.* into v_church from app_private.churches c where c.id = p_church_id for update;
  if not found then
    raise exception 'Igreja não encontrada.' using errcode = '42501';
  end if;

  -- Bloqueia as fontes de autoridade e revalida após eventuais esperas.
  perform 1 from app_private.church_access ca
    join app_private.members m on m.id = ca.member_id and m.church_id = ca.church_id
    join auth.users u on u.id = ca.user_id
    where ca.church_id = p_church_id and ca.user_id = v_uid for share of ca, m, u;

  if not app_private.has_church_settings_access(p_church_id, true) then
    raise exception 'Cadastro exclusivo de administradores ativos desta igreja.' using errcode = '42501';
  end if;

  -- CA02: Validação e normalização de nome em NFC (1 a 160 caracteres)
  v_clean_name := pg_catalog.btrim(pg_catalog.normalize(p_name, 'NFC'));
  if char_length(v_clean_name) < 1 or char_length(v_clean_name) > 160 then
    raise exception 'Nome da igreja deve ter entre 1 e 160 caracteres.' using errcode = '23514';
  end if;

  if char_length(v_address) > 500 or char_length(v_maps) > 1024
    or (v_maps is not null and v_maps !~* '^https://(maps\.app\.goo\.gl/[^[:space:]]+|goo\.gl/maps/[^[:space:]]+|((www\.)?google\.(com(\.[a-z]{2})?|[a-z]{2})/maps([/?#][^[:space:]]*)?|maps\.google\.(com(\.[a-z]{2})?|[a-z]{2})/[^[:space:]]*))$') then
    raise exception 'Endereço ou localização inválidos.' using errcode = '22023';
  end if;

  if p_logo_path is not null and (
    split_part(p_logo_path, '/', 1) <> p_church_id::text
    or p_logo_path !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(png|jpg|webp)$'
  ) then
    raise exception 'Logo de outra igreja ou caminho inválido.' using errcode = '22023';
  end if;

  v_params := jsonb_build_object(
    'church_id', p_church_id,
    'expected_revision', p_expected_revision,
    'name', v_clean_name,
    'address', v_address,
    'google_maps_url', v_maps,
    'logo_path', p_logo_path
  );

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
    if not found then
      raise exception 'Logo não encontrada no armazenamento privado.' using errcode = '22023';
    end if;
  end if;

  v_revision := v_church.profile_revision + 1;

  -- CA05: Atualiza o nome preservando integridade, membros, identificador e demais dados
  update app_private.churches c
    set name = v_clean_name,
        address = v_address,
        google_maps_url = v_maps,
        logo_path = p_logo_path,
        profile_revision = v_revision
    where c.id = p_church_id;

  -- CA07: Registro de auditoria contendo igreja, responsável, data/hora e nomes anterior e novo
  insert into app_private.audit_entries(church_id, action, actor_user_id, actor_source, target_type, target_id, details)
    values(
      p_church_id,
      'update_church_settings',
      v_uid,
      'application',
      'church',
      p_church_id,
      jsonb_build_object(
        'command_id', p_command_id,
        'profile_revision', v_revision,
        'previous_revision', v_church.profile_revision,
        'previous_name', v_church.name,
        'new_name', v_clean_name,
        'changed_fields', jsonb_build_object(
          'name', v_church.name is distinct from v_clean_name,
          'address', v_church.address is distinct from v_address,
          'google_maps_url', v_church.google_maps_url is distinct from v_maps,
          'logo_path', v_church.logo_path is distinct from p_logo_path
        )
      )
    );

  -- CA07 / CA06: Recibo para garantia de idempotência e recuperação de resposta
  insert into app_private.church_settings_receipts(user_id, command_id, church_id, params, result)
    values(
      v_uid,
      p_command_id,
      p_church_id,
      v_params,
      jsonb_build_object(
        'profile_revision', v_revision,
        'before', jsonb_build_object(
          'name', v_church.name,
          'address', v_church.address,
          'google_maps_url', v_church.google_maps_url,
          'logo_path', v_church.logo_path
        )
      )
    );

  return query select p_church_id, p_command_id, v_revision;
end;
$function$;

-- 2. Sobrecarga retrocompatível de 6 parâmetros (mantém o nome atual da igreja)
create or replace function public.update_church_settings(
  p_church_id uuid,
  p_command_id uuid,
  p_expected_revision integer,
  p_address text,
  p_google_maps_url text,
  p_logo_path text
)
returns table(church_id uuid, command_id uuid, profile_revision integer)
language plpgsql
security definer
set search_path = ''
set statement_timeout = '10s'
as $function$
declare
  v_current_name text;
begin
  select c.name into v_current_name from app_private.churches c where c.id = p_church_id;
  if v_current_name is null then
    raise exception 'Igreja não encontrada ou sem nome.' using errcode = '42501';
  end if;

  return query select * from public.update_church_settings(
    p_church_id,
    p_command_id,
    p_expected_revision,
    v_current_name,
    p_address,
    p_google_maps_url,
    p_logo_path
  );
end;
$function$;

-- Privilégios e proprietário
revoke all on function public.update_church_settings(uuid, uuid, integer, text, text, text, text) from public, anon, service_role;
grant execute on function public.update_church_settings(uuid, uuid, integer, text, text, text, text) to authenticated;
alter function public.update_church_settings(uuid, uuid, integer, text, text, text, text) owner to postgres;

revoke all on function public.update_church_settings(uuid, uuid, integer, text, text, text) from public, anon, service_role;
grant execute on function public.update_church_settings(uuid, uuid, integer, text, text, text) to authenticated;
alter function public.update_church_settings(uuid, uuid, integer, text, text, text) owner to postgres;

notify pgrst, 'reload schema';
commit;
