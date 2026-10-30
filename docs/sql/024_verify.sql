-- ==============================================================================
-- 024_verify.sql
-- Verificação Confiável após Aplicação de 024_service_template_instantiation_security.sql
-- Issue #27 / Parecer do Codex / Homologação
--
-- OBJETIVO:
-- 1. Executar bloco de asserção imperativo (DO block) que provoca FALHA EFETIVA
--    (RAISE EXCEPTION) diante de qualquer não-conformidade contratual ou de segurança.
-- 2. Executar consulta de diagnóstico que retorna colunas booleanas para ferramentas
--    automatizadas de validação.
--
-- CRITÉRIOS VERIFICADOS:
-- 1. proc_exists: RPC public.instantiate_service_template(uuid, uuid, uuid) presente.
-- 2. rpc_hardened: SECURITY DEFINER, search_path='' e statement_timeout=5s.
-- 3. access_check_verified: Chamada estrita a has_church_settings_access(p_church_id, false).
-- 4. contract_preserved: Preservação de 'parallelServices' (JSON camelCase, sem rejeitar
--    identificadores SQL como v_parallel_services), 'musics', 'responsibleMemberId',
--    'responsibleTeamId' e filtro de apoios ativos 'is_default_active = true'.
-- 5. owner_verified: Owner postgres.
-- 6. privileges_verified: EXECUTE concedido apenas a authenticated; revogado de anon, service_role e public.
--
-- ==============================================================================
-- PLANO DE ENSAIOS DE LABORATÓRIO (SUPABASE TESTBED):
-- Cenários autorizados para validação transacional (BEGIN ... ROLLBACK):
--
-- 1. Usuário anônimo / Chamada anônima (sem JWT ou auth.uid() nulo):
--    - Invocação da RPC sem autenticação válida.
--    - Esperado: Rejeição com erro 42501 (ACL PostgreSQL/PostgREST por falta de EXECUTE para a role anon)
--      ou SQLSTATE 28000 ('Não autenticado.') caso atinja o corpo da função.
--      (Não exigir exclusivamente 28000, pois a camada de ACL bloqueia antes da execução).
--
-- 2. Autenticado sem vínculo com a igreja:
--    - Usuário com auth.uid() válido, mas sem registro ativo em app_private.church_access para p_church_id.
--    - Esperado: has_church_settings_access retorna false -> Exceção 'Acesso negado à igreja especificada.' (SQLSTATE 42501).
--
-- 3. Administrador de outra igreja (cross-church):
--    - Usuário é admin da Igreja A, mas passa p_church_id da Igreja B (onde não possui membro ativo em app_private.members).
--    - Esperado: has_church_settings_access retorna false -> Exceção 'Acesso negado à igreja especificada.' (SQLSTATE 42501).
--
-- 4. Vínculo revogado ou inativo:
--    - Usuário cadastrado na igreja, mas com membership status <> 'active' em app_private.church_access ou app_private.members.
--    - Esperado: has_church_settings_access retorna false -> Exceção 'Acesso negado...' (SQLSTATE 42501).
--
-- 5. Membro básico elegível:
--    - Membro ativo em app_private.church_access sem papel de admin (is_admin = false).
--    - Esperado: has_church_settings_access(p_church_id, false) permite consulta se membro ativo -> Sucesso (200).
--
-- 6. Líder da liturgia não-administrador:
--    - Líder com vínculo ativo em app_private.church_access.
--    - Esperado: has_church_settings_access(p_church_id, false) retorna true -> Sucesso (200).
--
-- 7. Administrador autorizado da igreja:
--    - Administrador formalmente ativo em app_private.church_access (is_admin = true).
--    - Esperado: Sucesso (200) com payload fiel ao contrato SQL 022.
--
-- LIMITE DA RPC:
-- A RPC prepara uma cópia em memória (preview do modelo) e NÃO persiste itens em eventos.
-- A persistência permanente de itens de evento pertence ao escopo da Issue #29.
-- ==============================================================================

-- 1. BLOCO DE ASSERÇÃO IMPERATIVO: Interrompe a execução caso alguma condição falhe
do $$
declare
  v_proc regprocedure;
  v_func_def text;
  v_owner text;
  v_is_secdef boolean;
  v_config text[];
  v_has_access_check boolean;
  v_has_parallel_camel boolean;
  v_has_parallel_snake_key boolean;
  v_has_active_filter boolean;
  v_has_musics boolean;
  v_has_resp_member boolean;
  v_has_resp_team boolean;
  v_auth_has_exec boolean;
  v_anon_has_exec boolean;
  v_service_role_has_exec boolean;
  v_public_has_exec boolean;
begin
  -- 1. Conferir existência da RPC
  v_proc := to_regprocedure('public.instantiate_service_template(uuid, uuid, uuid)');
  if v_proc is null then
    raise exception 'VERIFY FALHOU: RPC public.instantiate_service_template(uuid, uuid, uuid) não encontrada.'
      using errcode = 'P0002';
  end if;

  -- 2. Metadados e código da função
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

  -- 3. Validação de hardening (B4: proconfig is null / is not true)
  if v_is_secdef is not true then
    raise exception 'VERIFY FALHOU: RPC não está configurada como SECURITY DEFINER.'
      using errcode = 'P0003';
  end if;

  if v_config is null then
    raise exception 'VERIFY FALHOU: Configurações de segurança ausentes (proconfig é NULL).'
      using errcode = 'P0003';
  end if;

  if (v_config @> array['search_path=""'] or v_config @> array['search_path=']) is not true then
    raise exception 'VERIFY FALHOU: RPC não possui search_path vazio configurado.'
      using errcode = 'P0003';
  end if;

  if (v_config @> array['statement_timeout=5s']) is not true then
    raise exception 'VERIFY FALHOU: RPC não possui statement_timeout=5s configurado.'
      using errcode = 'P0003';
  end if;

  -- 4. Validação da verificação de autorização de vínculo
  v_has_access_check := (v_func_def like '%has_church_settings_access(p_church_id, false)%');
  if not v_has_access_check then
    raise exception 'VERIFY FALHOU: Chamada a has_church_settings_access(p_church_id, false) não encontrada no corpo da RPC.'
      using errcode = 'P0003';
  end if;

  -- 5. Validação precisa da preservação do contrato SQL 022 (B3: escape de _ e checagem integral)
  -- Verifica precisamente a chave JSON 'parallelServices' e não rejeita nomes internos como v_parallel_services
  v_has_parallel_camel := (v_func_def like '%''parallelServices''%');
  v_has_parallel_snake_key := (v_func_def like '%''parallel\_services''%' escape '\');
  v_has_active_filter := (v_func_def like '%where stps.template\_id = p\_template\_id and stps.is\_default\_active = true%' escape '\');
  v_has_musics := (v_func_def like '%musics%');
  v_has_resp_member := (v_func_def like '%responsibleMemberId%');
  v_has_resp_team := (v_func_def like '%responsibleTeamId%');

  if not v_has_parallel_camel then
    raise exception 'VERIFY FALHOU: Chave JSON camelCase "parallelServices" ausente no retorno da RPC.'
      using errcode = 'P0003';
  end if;

  if v_has_parallel_snake_key then
    raise exception 'VERIFY FALHOU: Chave JSON snake_case "parallel_services" incorretamente detectada no retorno da RPC.'
      using errcode = 'P0003';
  end if;

  if not v_has_active_filter then
    raise exception 'VERIFY FALHOU: Filtro de apoios ativos "is_default_active = true" ausente ou modificado na RPC.'
      using errcode = 'P0003';
  end if;

  if (v_func_def like '%v\_st.active is not true%' escape '\') is not true then
    raise exception 'VERIFY FALHOU: Guarda contra instanciação de modelo desativado (v_st.active is not true) ausente na RPC.'
      using errcode = 'P0003';
  end if;

  if (v_func_def like '%plannedDurationMinutes%') is not true then
    raise exception 'VERIFY FALHOU: Campo plannedDurationMinutes ausente ou renomeado no contrato da RPC.'
      using errcode = 'P0003';
  end if;

  if (v_func_def like '%roster%') is not true then
    raise exception 'VERIFY FALHOU: Campo roster ausente ou renomeado no contrato de atividades da RPC.'
      using errcode = 'P0003';
  end if;

  if not (v_has_musics and v_has_resp_member and v_has_resp_team) then
    raise exception 'VERIFY FALHOU: Campos contratuais de atividades (musics, responsibleMemberId, responsibleTeamId) incompletos.'
      using errcode = 'P0003';
  end if;

  if (v_func_def like '%leaderId%' and v_func_def like '%volunteers%') is not true then
    raise exception 'VERIFY FALHOU: Campos contratuais de serviços paralelos (leaderId, volunteers) incompletos.'
      using errcode = 'P0003';
  end if;

  -- 6. Validação de ownership
  if v_owner <> 'postgres' then
    raise exception 'VERIFY FALHOU: Owner da RPC é "%", esperava-se "postgres".', v_owner
      using errcode = 'P0003';
  end if;

  -- 7. Validação de privilégios
  v_auth_has_exec := has_function_privilege('authenticated', v_proc, 'EXECUTE');
  v_anon_has_exec := has_function_privilege('anon', v_proc, 'EXECUTE');
  v_service_role_has_exec := has_function_privilege('service_role', v_proc, 'EXECUTE');
  select exists (
    select 1 from lateral pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
    where a.grantee = 0 and a.privilege_type = 'EXECUTE'
  ) into v_public_has_exec
  from pg_catalog.pg_proc p where p.oid = v_proc;

  if not v_auth_has_exec then
    raise exception 'VERIFY FALHOU: Role authenticated não possui permissão de EXECUTE na RPC.'
      using errcode = '42501';
  end if;

  if v_anon_has_exec then
    raise exception 'VERIFY FALHOU: Role anon possui indevidamente permissão de EXECUTE na RPC.'
      using errcode = '42501';
  end if;

  if v_service_role_has_exec then
    raise exception 'VERIFY FALHOU: Role service_role possui indevidamente permissão de EXECUTE na RPC.'
      using errcode = '42501';
  end if;

  if v_public_has_exec then
    raise exception 'VERIFY FALHOU: Role public possui indevidamente permissão de EXECUTE na RPC.'
      using errcode = '42501';
  end if;
end $$;

-- 2. CONSULTA DE DIAGNÓSTICO (TODAS AS COLUNAS DEVEM RETORNAR TRUE)
with proc_meta as (
  select
    to_regprocedure('public.instantiate_service_template(uuid, uuid, uuid)') as proc_oid,
    pg_get_functiondef(to_regprocedure('public.instantiate_service_template(uuid, uuid, uuid)')) as func_def
)
select
  -- 1. RPC existe com assinatura exata
  (p.proc_oid is not null) as proc_exists,

  -- 2. Segurança estrita (SECURITY DEFINER, search_path vazio, statement_timeout=5s, proconfig não-nulo)
  (
    select coalesce(
      pr.prosecdef = true
      and pr.proconfig is not null
      and (pr.proconfig @> array['search_path=""'] or pr.proconfig @> array['search_path='])
      and pr.proconfig @> array['statement_timeout=5s'],
      false
    )
    from pg_catalog.pg_proc pr
    where pr.oid = p.proc_oid
  ) as rpc_hardened,

  -- 3. Verificação de vínculo church_id implementada
  (
    p.func_def is not null
    and p.func_def like '%has_church_settings_access(p_church_id, false)%'
  ) as access_check_verified,

  -- 4. Preservação integral do contrato original do SQL 022
  (
    p.func_def is not null
    and p.func_def like '%''parallelServices''%'
    and p.func_def not like '%''parallel\_services''%' escape '\'
    and p.func_def like '%where stps.template\_id = p\_template\_id and stps.is\_default\_active = true%' escape '\'
    and p.func_def like '%v\_st.active is not true%' escape '\'
    and p.func_def like '%plannedDurationMinutes%'
    and p.func_def like '%roster%'
    and p.func_def like '%musics%'
    and p.func_def like '%responsibleMemberId%'
    and p.func_def like '%responsibleTeamId%'
    and p.func_def like '%leaderId%'
    and p.func_def like '%volunteers%'
  ) as contract_preserved,

  -- 5. Owner postgres
  (
    select coalesce(r.rolname = 'postgres', false)
    from pg_catalog.pg_proc pr
    join pg_catalog.pg_roles r on r.oid = pr.proowner
    where pr.oid = p.proc_oid
  ) as owner_verified,

  -- 6. Privilégios: authenticated tem EXECUTE; anon, service_role e public revogados
  (
    select coalesce(
      has_function_privilege('authenticated', pr.oid, 'EXECUTE')
      and not has_function_privilege('anon', pr.oid, 'EXECUTE')
      and not has_function_privilege('service_role', pr.oid, 'EXECUTE')
      and not exists (
        select 1 from lateral pg_catalog.aclexplode(coalesce(pr.proacl, pg_catalog.acldefault('f', pr.proowner))) a
        where a.grantee = 0 and a.privilege_type = 'EXECUTE'
      ),
      false
    )
    from pg_catalog.pg_proc pr
    where pr.oid = p.proc_oid
  ) as privileges_verified
from proc_meta p;
