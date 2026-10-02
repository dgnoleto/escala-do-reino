-- Escala do Reino: estrutura inicial fechada, sem dados nem API de acesso.
-- Rascunho para validar em PostgreSQL/Supabase antes da aplicação real.
-- Executar uma única vez. Se app_private já existir, parar e revisar.
-- Não cria contas, igreja, admin, senha, emissão/resgate de convite ou auditoria.
begin;

do $preflight$
begin
  if current_setting('server_encoding') <> 'UTF8'
     or current_setting('client_encoding') <> 'UTF8' then
    raise exception 'O banco e a conexão precisam usar UTF8.';
  end if;
  if to_regclass('auth.users') is null then
    raise exception 'Supabase Auth não encontrado: auth.users ausente.';
  end if;
end;
$preflight$;

create schema app_private;
revoke all on schema app_private from public, anon, authenticated, service_role;
alter default privileges in schema app_private
  revoke all on tables from public, anon, authenticated, service_role;
alter default privileges in schema app_private
  revoke execute on functions from public, anon, authenticated, service_role;

create table app_private.churches (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  timezone text not null,
  address text,
  google_maps_url text,
  -- Exigir escolha explícita; o padrão de produto ainda não foi confirmado.
  default_duration_policy text not null
    check (default_duration_policy in ('warn', 'block')),
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint churches_name_valid check (
    name = btrim(name) and char_length(name) between 1 and 160
  ),
  constraint churches_address_length check (char_length(address) <= 500)
);

create table app_private.members (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references app_private.churches(id) on delete restrict,
  display_name text not null,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_by_user_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint members_church_id_id_unique unique (church_id, id),
  constraint members_display_name_valid check (
    display_name = btrim(display_name) and char_length(display_name) between 1 and 120
  )
);

create table app_private.church_access (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references app_private.churches(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  member_id uuid not null,
  status text not null default 'active' check (status in ('active', 'revoked')),
  is_admin boolean not null default false,
  onboarding_completed_at timestamptz,
  granted_by_user_id uuid not null references auth.users(id) on delete restrict,
  granted_at timestamptz not null default statement_timestamp(),
  revoked_by_user_id uuid references auth.users(id) on delete restrict,
  revoked_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint church_access_member_fk foreign key (church_id, member_id)
    references app_private.members(church_id, id) on delete restrict,
  constraint church_access_user_unique unique (church_id, user_id),
  constraint church_access_member_unique unique (church_id, member_id),
  constraint church_access_onboarding_required check (
    status <> 'active' or onboarding_completed_at is not null
  ),
  constraint church_access_revocation_state check (
    (status = 'active' and revoked_at is null and revoked_by_user_id is null)
    or (status = 'revoked' and revoked_at is not null and revoked_by_user_id is not null)
  ),
  constraint church_access_revocation_time check (revoked_at >= granted_at)
);

create table app_private.access_invitations (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references app_private.churches(id) on delete restrict,
  member_id uuid not null,
  recipient_email text not null,
  token_digest bytea not null unique check (octet_length(token_digest) = 32),
  issued_by_user_id uuid not null references auth.users(id) on delete restrict,
  issued_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz not null,
  redeemed_by_user_id uuid references auth.users(id) on delete restrict,
  redeemed_at timestamptz,
  revoked_by_user_id uuid references auth.users(id) on delete restrict,
  revoked_at timestamptz,
  constraint access_invitations_member_fk foreign key (church_id, member_id)
    references app_private.members(church_id, id) on delete restrict,
  constraint access_invitations_recipient_valid check (
    recipient_email = btrim(recipient_email)
    and char_length(recipient_email) between 3 and 254
  ),
  -- 72 horas decorridas, inclusive quando há mudança de horário local.
  constraint access_invitations_expiration check (
    expires_at = issued_at + interval '72 hours'
  ),
  constraint access_invitations_redemption_pair check (
    (redeemed_at is null and redeemed_by_user_id is null)
    or (redeemed_at is not null and redeemed_by_user_id is not null)
  ),
  constraint access_invitations_revocation_pair check (
    (revoked_at is null and revoked_by_user_id is null)
    or (revoked_at is not null and revoked_by_user_id is not null)
  ),
  constraint access_invitations_terminal_state check (
    not (redeemed_at is not null and revoked_at is not null)
  ),
  constraint access_invitations_redemption_time check (
    redeemed_at >= issued_at and redeemed_at < expires_at
  ),
  constraint access_invitations_revocation_time check (revoked_at >= issued_at)
);

-- Não há SQL dinâmico. O fuso precisa existir no catálogo do PostgreSQL.
create function app_private.validate_church_timezone()
returns trigger language plpgsql security invoker set search_path = '' as $function$
begin
  if not exists (
    select 1 from pg_catalog.pg_timezone_names as t where t.name = new.timezone
  ) then
    raise exception 'Identificador de fuso horário inválido.' using errcode = '23514';
  end if;
  return new;
end;
$function$;

create trigger churches_validate_timezone
before insert or update of timezone on app_private.churches
for each row execute function app_private.validate_church_timezone();

create function app_private.touch_updated_at()
returns trigger language plpgsql security invoker set search_path = '' as $function$
begin
  new.updated_at := statement_timestamp();
  return new;
end;
$function$;

create trigger churches_touch_updated_at before update on app_private.churches
for each row execute function app_private.touch_updated_at();
create trigger members_touch_updated_at before update on app_private.members
for each row execute function app_private.touch_updated_at();
create trigger church_access_touch_updated_at before update on app_private.church_access
for each row execute function app_private.touch_updated_at();

create index members_church_status_idx on app_private.members(church_id, status);
create index members_author_idx on app_private.members(created_by_user_id);
create index church_access_user_idx on app_private.church_access(user_id);
create index church_access_grantor_idx on app_private.church_access(granted_by_user_id);
create index church_access_revoker_idx on app_private.church_access(revoked_by_user_id)
  where revoked_by_user_id is not null;
create index invitations_church_member_idx on app_private.access_invitations(church_id, member_id);
create index invitations_recipient_idx on app_private.access_invitations(recipient_email);
create index invitations_expires_idx on app_private.access_invitations(expires_at);
create index invitations_issuer_idx on app_private.access_invitations(issued_by_user_id);
create index invitations_redeemer_idx on app_private.access_invitations(redeemed_by_user_id)
  where redeemed_by_user_id is not null;
create index invitations_revoker_idx on app_private.access_invitations(revoked_by_user_id)
  where revoked_by_user_id is not null;

alter table app_private.churches enable row level security;
alter table app_private.members enable row level security;
alter table app_private.church_access enable row level security;
alter table app_private.access_invitations enable row level security;

-- Fechado por padrão, inclusive para service_role. Não há políticas de liberação.
-- O dono das tabelas ainda pode administrar a estrutura pelo SQL Editor.
revoke all on all tables in schema app_private from public, anon, authenticated, service_role;
revoke execute on all functions in schema app_private from public, anon, authenticated, service_role;

commit;

-- O código da aplicação deverá normalizar nomes em NFC e validar links Maps,
-- destinatários, autoria, estados da igreja/membro e transições autorizadas.
-- CHECKs/FKs não implementam isolamento de leitura, limites de requisição,
-- resgate atômico, cancelamento concorrente, reativação ou auditoria.
-- Não expor app_private na Data API nem conceder grants para contornar bloqueios.
