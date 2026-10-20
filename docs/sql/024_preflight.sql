-- ==============================================================================
-- 024_preflight.sql
-- Pré-validação Confiável para Aplicação de 024_service_template_instantiation_security.sql
-- Issue #27 / Parecer do Codex / Homologação
--
-- OBJETIVO:
-- Validar todas as pré-condições no catálogo PostgreSQL antes da aplicação da migration:
-- 1. Execução transacional com lock_timeout restrito (2s) e statement_timeout (5s).
-- 2. Conferir assinatura exata e tipo de retorno (jsonb) da RPC public.instantiate_service_template(uuid, uuid, uuid).
-- 3. Conferir assinatura exata e tipo de retorno (boolean) da função auxiliar app_private.has_church_settings_access(uuid, boolean).
-- 4. Conferir owner esperado ('postgres') — QUALQUER DIVERGÊNCIA INTERROMPE COM EXCEÇÃO (sem warnings tolerantes).
-- 5. Conferir configurações de segurança (SECURITY DEFINER, search_path vazio e timeouts).
-- 6. Conferir ACLs e concessões existentes (authenticated habilitado; anon, service_role e public revogados).
-- 7. Conferir definição-base esperada (compatibilidade canônica com SQL 022):
--    - Retorno com chave JSON 'parallelServices' (camelCase).
--    - Filtro de apoios ativos 'is_default_active = true'.
--    - Atividades com 'musics', 'responsibleMemberId' e 'responsibleTeamId'.
--
-- INTERRUPÇÃO AUTOMÁTICA DIANTE DE QUALQUER FALHA (RAISE EXCEPTION).
-- NÃO ALTERA DADOS NEM PERMISSÕES.
--
-- ==============================================================================
-- DOCUMENTAÇÃO DOS CENÁRIOS DE ACESSO E CONTRATO DE AUTORIZAÇÃO:
-- 1. Chamada anônima (sem JWT):
--    - Invocação da RPC sem autenticação válida.
--    - Rejeição esperada: 42501 via ACL PostgreSQL/PostgREST (falta de privilégio EXECUTE
--      para anon) ou SQLSTATE 28000 ('Não autenticado.') caso atinja o corpo da função.
--      Não exigir exclusivamente 28000, pois a camada de ACL intercepta antes da função.
--
-- 2. Autenticado sem vínculo com a igreja:
--    - Usuário com auth.uid() válido, mas sem registro ativo em app_private.church_access.
--    - Rejeição esperada: Exceção 'Acesso negado à igreja especificada.' (SQLSTATE 42501).
--
-- 3. Usuário de outra igreja (cross-church):
--    - Administrador ou membro da Igreja A invocando RPC com p_church_id da Igreja B.
--    - Como não possui registro ativo em app_private.church_access / app_private.members para a Igreja B,
--      a função has_church_settings_access(p_church_id, false) retorna false.
--    - Rejeição esperada: Exceção 'Acesso negado à igreja especificada.' (SQLSTATE 42501).
--
-- 4. Membro básico elegível ou líder de liturgia:
--    - Usuário ativo com registro em app_private.church_access (is_admin pode ser false).
--    - Como a RPC passa p_require_admin = false, a consulta tem sucesso (200) com o modelo instanciado.
--
-- 5. Administrador autorizado da igreja:
--    - Administrador formalmente ativo em app_private.church_access (is_admin = true).
--    - Sucesso (200) com contrato integralmente preservado.
-- ==============================================================================

do $$
declare
  v_proc regprocedure;
  v_helper regprocedure;
  v_func_def text;
  v_owner text;
  v_is_secdef boolean;
  v_config text[];
  v_proc_rettype text;
  v_helper_rettype text;
  v_auth_has_exec boolean;
  v_anon_has_exec boolean;
  v_service_role_has_exec boolean;
  v_public_has_exec boolean;
begin
  -- 1. Teste de timeout e locks (proteção contra esperas infinitas)
  perform set_config('lock_timeout', '2s', true);
  perform set_config('statement_timeout', '5s', true);

  -- 2. Conferir assinatura exata da RPC alvo
  v_proc := to_regprocedure('public.instantiate_service_template(uuid, uuid, uuid)');
  if v_proc is null then
    raise exception 'PREFLIGHT FALHOU: RPC public.instantiate_service_template(uuid, uuid, uuid) não encontrada.'
      using errcode = 'P0002';
  end if;

  -- 3. Obter metadados da RPC alvo
  select
    pg_get_functiondef(v_proc),
    r.rolname,
    p.prosecdef,
    p.proconfig,
    format_type(p.prorettype, null)
  into
    v_func_def,
    v_owner,
    v_is_secdef,
    v_config,
    v_proc_rettype
  from pg_catalog.pg_proc p
  join pg_catalog.pg_roles r on r.oid = p.proowner
  where p.oid = v_proc;

  -- 4. Conferir tipo de retorno da RPC (espera-se jsonb)
  if v_proc_rettype <> 'jsonb' then
    raise exception 'PREFLIGHT FALHOU: Tipo de retorno da RPC é "%", esperava-se "jsonb".', v_proc_rettype
      using errcode = 'P0003';
  end if;

  -- 5. Conferir owner atual (espera-se postgres) - Interrompe imediatamente se divergir
  if v_owner <> 'postgres' then
    raise exception 'PREFLIGHT FALHOU: Owner atual da RPC é "%", esperava-se estritamente "postgres".', v_owner
      using errcode = 'P0003';
  end if;

  -- 6. Conferir SECURITY DEFINER e configurações de segurança (B4: hardening estrito com proconfig is null / is not true)
  if v_is_secdef is not true then
    raise exception 'PREFLIGHT FALHOU: A RPC atual não está configurada como SECURITY DEFINER.'
      using errcode = 'P0003';
  end if;

  if v_config is null then
    raise exception 'PREFLIGHT FALHOU: Configurações de segurança ausentes (proconfig é NULL).'
      using errcode = 'P0003';
  end if;

  if (v_config @> array['search_path=""'] or v_config @> array['search_path=']) is not true then
    raise exception 'PREFLIGHT FALHOU: A RPC atual não possui search_path vazio configurado.'
      using errcode = 'P0003';
  end if;

  if (v_config @> array['statement_timeout=5s']) is not true then
    raise exception 'PREFLIGHT FALHOU: A RPC atual não possui statement_timeout=5s configurado.'
      using errcode = 'P0003';
  end if;

  -- 7. Conferir existência e tipo da função auxiliar de autorização
  v_helper := to_regprocedure('app_private.has_church_settings_access(uuid, boolean)');
  if v_helper is null then
    raise exception 'PREFLIGHT FALHOU: Função auxiliar app_private.has_church_settings_access(uuid, boolean) não encontrada.'
      using errcode = 'P0002';
  end if;

  select format_type(p.prorettype, null) into v_helper_rettype
  from pg_catalog.pg_proc p where p.oid = v_helper;

  if v_helper_rettype <> 'boolean' then
    raise exception 'PREFLIGHT FALHOU: Tipo de retorno da função auxiliar é "%", esperava-se "boolean".', v_helper_rettype
      using errcode = 'P0003';
  end if;

  -- 8. Conferir definição-base esperada (SQL 022) antes da substituição (B3: escape de _ e checagem integral)
  if (v_func_def like '%''parallelServices''%') is not true then
    raise exception 'PREFLIGHT FALHOU: A definição atual não contém a propriedade JSON camelCase "parallelServices".'
      using errcode = 'P0003';
  end if;

  if v_func_def like '%''parallel\_services''%' escape '\' then
    raise exception 'PREFLIGHT FALHOU: A definição atual contém incorretamente a chave JSON "parallel_services".'
      using errcode = 'P0003';
  end if;

  if (v_func_def like '%is\_default\_active = true%' escape '\') is not true then
    raise exception 'PREFLIGHT FALHOU: A definição atual não filtra apoios ativos por "is_default_active = true".'
      using errcode = 'P0003';
  end if;

  if (v_func_def like '%plannedDurationMinutes%') is not true then
    raise exception 'PREFLIGHT FALHOU: A definição atual não contém o campo "plannedDurationMinutes" no contrato de atividades.'
      using errcode = 'P0003';
  end if;

  if (v_func_def like '%roster%') is not true then
    raise exception 'PREFLIGHT FALHOU: A definição atual não contém o campo "roster" no contrato de atividades.'
      using errcode = 'P0003';
  end if;

  if (v_func_def like '%musics%') is not true then
    raise exception 'PREFLIGHT FALHOU: A definição atual não contém o campo "musics" no contrato de atividades.'
      using errcode = 'P0003';
  end if;

  if (v_func_def like '%responsibleMemberId%' and v_func_def like '%responsibleTeamId%') is not true then
    raise exception 'PREFLIGHT FALHOU: A definição atual não contém os campos de responsabilidade esperados.'
      using errcode = 'P0003';
  end if;

  if (v_func_def like '%leaderId%' and v_func_def like '%volunteers%') is not true then
    raise exception 'PREFLIGHT FALHOU: A definição atual não contém os campos de liderança e voluntários esperados em apoios.'
      using errcode = 'P0003';
  end if;

  -- 9. Conferir privilégios e ACLs existentes
  v_auth_has_exec := has_function_privilege('authenticated', v_proc, 'EXECUTE');
  v_anon_has_exec := has_function_privilege('anon', v_proc, 'EXECUTE');
  v_service_role_has_exec := has_function_privilege('service_role', v_proc, 'EXECUTE');
  select exists (
    select 1 from lateral pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
    where a.grantee = 0 and a.privilege_type = 'EXECUTE'
  ) into v_public_has_exec
  from pg_catalog.pg_proc p where p.oid = v_proc;

  if not v_auth_has_exec then
    raise exception 'PREFLIGHT FALHOU: Role authenticated não possui permissão de EXECUTE na RPC base.'
      using errcode = '42501';
  end if;

  if v_anon_has_exec then
    raise exception 'PREFLIGHT FALHOU: Role anon possui indevidamente permissão de EXECUTE na RPC base.'
      using errcode = '42501';
  end if;

  if v_service_role_has_exec then
    raise exception 'PREFLIGHT FALHOU: Role service_role possui indevidamente permissão de EXECUTE na RPC base.'
      using errcode = '42501';
  end if;

  if v_public_has_exec then
    raise exception 'PREFLIGHT FALHOU: Role public possui indevidamente permissão de EXECUTE na RPC base.'
      using errcode = '42501';
  end if;

  raise notice '========================================================================';
  raise notice 'PREFLIGHT APROVADO: RPC public.instantiate_service_template confirmada.';
  raise notice 'Tipo de retorno (jsonb), owner (postgres) e privilégios auditados.';
  raise notice 'Contrato SQL 022 validado (parallelServices, is_default_active, musics).';
  raise notice 'Função auxiliar app_private.has_church_settings_access confirmada.';
  raise notice 'Ambiente pronto para aplicação de 024_service_template_instantiation_security.sql';
  raise notice '========================================================================';
end $$;
