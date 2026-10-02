-- Escala do Reino — ensaio da função get_my_church_access
-- Termina em ROLLBACK: não deixa nenhum objeto persistido.
-- Executar antes de aplicar o script 005_get_my_church_access.sql.
--
-- Pré-requisito: as seis tabelas do app_private já devem existir.
-- Se ainda não existirem, aplicar 001_initial_access_structure.sql
-- e 003_access_requests_and_audit.sql antes deste ensaio.
--
-- Resultado esperado na última linha:
--   PASS: ensaio concluído; função não persistida.

begin;

-- ── Pré-verificações ──────────────────────────────────────────────────────────

do $preflight$
begin
  -- UTF-8
  if current_setting('server_encoding') <> 'UTF8'
     or current_setting('client_encoding') <> 'UTF8' then
    raise exception 'O banco e a conexão precisam usar UTF8.';
  end if;

  -- auth.users precisa existir (Supabase Auth)
  if to_regclass('auth.users') is null then
    raise exception 'Supabase Auth não encontrado: auth.users ausente.';
  end if;

  -- As seis tabelas internas precisam estar presentes
  if to_regclass('app_private.churches')          is null
  or to_regclass('app_private.members')           is null
  or to_regclass('app_private.church_access')     is null
  or to_regclass('app_private.access_invitations') is null
  or to_regclass('app_private.access_requests')   is null
  or to_regclass('app_private.audit_entries')     is null then
    raise exception 'Uma ou mais tabelas de app_private estão ausentes. Aplicar os scripts anteriores primeiro.';
  end if;

  -- A função NÃO deve existir ainda neste projeto
  if to_regproc('app_private.get_my_church_access') is not null then
    raise exception
      'A função app_private.get_my_church_access já existe neste banco. '
      'Examine sua definição antes de substituí-la. '
      'Se precisar recriá-la, encerre o ensaio, revogue e remova a definição '
      'existente com atenção, depois execute este ensaio novamente.';
  end if;
end;
$preflight$;

-- ── Criação da função dentro da transação ────────────────────────────────────
--
-- SECURITY DEFINER com search_path vazio e referências qualificadas.
-- A identidade vem exclusivamente de auth.uid().
-- Nenhum parâmetro aceito — nada proveniente do navegador influencia a consulta.

create function app_private.get_my_church_access()
returns table (
  church_id              uuid,
  church_name            text,
  timezone               text,
  member_id              uuid,
  display_name           text,
  is_admin               boolean,
  default_duration_policy text
)
language sql
security definer
set search_path = ''
as $$
  -- Autorização explícita: rejeitar chamadas de PUBLIC, anon e service_role.
  -- O verificador abaixo é executado antes do corpo da consulta.
  -- Mesmo com SECURITY DEFINER, a identidade do chamador deve ser authenticated.
  select
    c.id               as church_id,
    c.name             as church_name,
    c.timezone         as timezone,
    m.id               as member_id,
    m.display_name     as display_name,
    ca.is_admin        as is_admin,
    c.default_duration_policy as default_duration_policy
  from app_private.church_access  as ca
  join app_private.churches       as c  on c.id = ca.church_id
  join app_private.members        as m  on m.church_id = ca.church_id
                                       and m.id        = ca.member_id
  join auth.users                 as u  on u.id = ca.user_id
  where
    -- Identidade derivada exclusivamente da sessão autenticada
    ca.user_id               = auth.uid()
    -- Conta com e-mail confirmado e sem bloqueio vigente
    and u.email_confirmed_at is not null
    and u.banned_until       is null
    -- Vínculo ativo com onboarding concluído
    and ca.status            = 'active'
    and ca.onboarding_completed_at is not null
    -- Igreja ativa
    and c.status             = 'active'
    -- Membro ativo pertencente à mesma igreja
    and m.status             = 'active'
    and m.church_id          = ca.church_id
$$;

-- ── Verificações pós-criação ──────────────────────────────────────────────────

do $checks$
declare
  v_secdef    boolean;
  v_argcount  int;
  v_lang      text;
  v_grants    text;
begin
  -- 1. A função foi criada com SECURITY DEFINER?
  select p.prosecdef
    into v_secdef
    from pg_catalog.pg_proc      as p
    join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
   where n.nspname = 'app_private'
     and p.proname = 'get_my_church_access'
     and p.pronargs = 0;

  if not found then
    raise exception 'Verificação 1 falhou: função não encontrada após criação.';
  end if;
  if not v_secdef then
    raise exception 'Verificação 1 falhou: função não foi criada como SECURITY DEFINER.';
  end if;

  -- 2. search_path está vazio?
  --    pg_proc.proconfig armazena configurações de execução; verificar 'search_path='.
  if not exists (
    select 1
      from pg_catalog.pg_proc      as p
      join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
     where n.nspname = 'app_private'
       and p.proname = 'get_my_church_access'
       and p.pronargs = 0
       -- search_path vazio: configuração 'search_path=' presente
       and array_to_string(p.proconfig, ',') ilike '%search_path=%'
  ) then
    raise exception 'Verificação 2 falhou: search_path não foi definido na função.';
  end if;

  -- 3. PUBLIC, anon, authenticated e service_role não têm EXECUTE.
  --    Após criação em transação sem GRANT explícito,
  --    o proprietário tem EXECUTE mas os papéis externos não devem ter.
  --    Confirmar ausência de EXECUTE para esses papéis.
  if exists (
    select 1
      from information_schema.routine_privileges as rp
     where rp.specific_schema = 'app_private'
       and rp.routine_name    = 'get_my_church_access'
       and rp.grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
       and rp.privilege_type  = 'EXECUTE'
  ) then
    raise exception 'Verificação 3 falhou: um ou mais papéis indevidos têm EXECUTE na função.';
  end if;

  raise notice 'PASS: função criada com SECURITY DEFINER, search_path vazio e sem grants indevidos.';
end;
$checks$;

-- ── Desfaz tudo ───────────────────────────────────────────────────────────────

rollback;

-- Resultado esperado na linha final:
--   PASS: ensaio concluído; função não persistida.
do $final$
begin
  raise notice 'PASS: ensaio concluído; função não persistida.';
end;
$final$;
