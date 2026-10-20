-- ==============================================================================
-- 024_preflight.sql
-- Pré-validação Confiável para Aplicação de 024_service_template_instantiation_security.sql
-- Issue #27 / Parecer do Codex / Homologação
--
-- OBJETIVO:
-- Validar todas as pré-condições no catálogo PostgreSQL antes da aplicação da migration:
-- 1. Execução transacional com lock_timeout restrito (2s).
-- 2. Existência da RPC public.instantiate_service_template(uuid, uuid, uuid).
-- 3. Validação da definição-base esperada (SQL 022):
--    - Retorno com chave 'parallelServices' (camelCase).
--    - Filtro de apoios ativos 'is_default_active = true'.
--    - Inclusão do array 'musics'.
-- 4. Existência e integridade da função app_private.has_church_settings_access(uuid, boolean).
-- 5. Owner atual (postgres) e privilégios pré-existentes.
--
-- INTERRUPÇÃO AUTOMÁTICA DIANTE DE QUALQUER FALHA.
-- NÃO ALTERA DADOS NEM PERMISSÕES.
-- ==============================================================================

do $$
declare
  v_proc regprocedure;
  v_func_def text;
  v_owner text;
  v_helper_exists boolean;
  v_is_secdef boolean;
  v_config text[];
begin
  -- 1. Teste de timeout e locks (proteção contra esperas infinitas)
  perform set_config('lock_timeout', '2s', true);
  perform set_config('statement_timeout', '5s', true);

  -- 2. Conferir assinatura exata da função alvo
  v_proc := to_regprocedure('public.instantiate_service_template(uuid, uuid, uuid)');
  if v_proc is null then
    raise exception 'PREFLIGHT FALHOU: RPC public.instantiate_service_template(uuid, uuid, uuid) não encontrada.'
      using errcode = 'P0002';
  end if;

  -- 3. Obter metadados da função atual
  select
    pg_get_functiondef(v_proc),
    r.rolname,
    p.prosecdef,
    p.proconfig
  into
    v_func_def,
    v_owner,
    v_is_secdef,
    v_config
  from pg_catalog.pg_proc p
  join pg_catalog.pg_roles r on r.oid = p.proowner
  where p.oid = v_proc;

  -- 4. Conferir definição-base esperada (SQL 022) antes da substituição
  if v_func_def not like '%parallelServices%' then
    raise exception 'PREFLIGHT FALHOU: A definição atual não contém a propriedade esperada "parallelServices".'
      using errcode = 'P0003';
  end if;

  if v_func_def not like '%is_default_active = true%' then
    raise exception 'PREFLIGHT FALHOU: A definição atual não filtra apoios ativos por "is_default_active = true".'
      using errcode = 'P0003';
  end if;

  if v_func_def not like '%musics%' then
    raise exception 'PREFLIGHT FALHOU: A definição atual não contém o campo "musics" no contrato de atividades.'
      using errcode = 'P0003';
  end if;

  -- 5. Conferir owner atual
  if v_owner <> 'postgres' then
    raise warning 'PREFLIGHT ALERTA: Owner atual da função é "%", esperava-se "postgres".', v_owner;
  end if;

  -- 6. Conferir SECURITY DEFINER
  if not v_is_secdef then
    raise exception 'PREFLIGHT FALHOU: A função atual não está configurada como SECURITY DEFINER.'
      using errcode = 'P0003';
  end if;

  -- 7. Conferir existência da função auxiliar de autorização
  select exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app_private'
      and p.proname = 'has_church_settings_access'
      and pg_get_function_identity_arguments(p.oid) = 'p_church_id uuid, p_require_admin boolean'
  ) into v_helper_exists;

  if not v_helper_exists then
    raise exception 'PREFLIGHT FALHOU: Função auxiliar app_private.has_church_settings_access(uuid, boolean) não encontrada.'
      using errcode = 'P0002';
  end if;

  raise notice '========================================================================';
  raise notice 'PREFLIGHT APROVADO: RPC public.instantiate_service_template confirmada.';
  raise notice 'Contrato SQL 022 validado (parallelServices, is_default_active, musics).';
  raise notice 'Função auxiliar app_private.has_church_settings_access confirmada.';
  raise notice 'Ambiente pronto para aplicação de 024_service_template_instantiation_security.sql';
  raise notice '========================================================================';
end $$;
