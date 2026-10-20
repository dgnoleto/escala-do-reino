-- ==============================================================================
-- 024_verify.sql
-- Verificação Confiável após Aplicação de 024_service_template_instantiation_security.sql
-- Issue #27 / Parecer do Codex / Homologação
--
-- OBJETIVO:
-- Consulta somente leitura que valida a integridade completa da RPC após a migração:
-- 1. proc_exists: RPC public.instantiate_service_template(uuid, uuid, uuid) presente.
-- 2. rpc_hardened: SECURITY DEFINER, search_path='' e statement_timeout=5s.
-- 3. access_check_verified: Chamada estrita a has_church_settings_access(p_church_id, false).
-- 4. contract_preserved: Preservação de 'parallelServices', 'musics', 'responsibleMemberId',
--    'responsibleTeamId' e filtro de apoios ativos 'is_default_active = true'.
-- 5. owner_verified: Owner postgres.
-- 6. privileges_verified: EXECUTE concedido apenas a authenticated; revogado de anon, service_role e public.
--
-- RESULTADO ESPERADO: TODAS AS COLUNAS DEVEM RETORNAR TRUE.
--
-- ==============================================================================
-- PLANO DE ENSAIOS DE LABORATÓRIO (SUPABASE TESTBED):
-- Cenários autorizados para validação transacional (BEGIN ... ROLLBACK):
--
-- 1. Usuário anônimo (auth.uid() is null):
--    - Executar RPC sem JWT de autenticação.
--    - Esperado: Exceção 'Não autenticado.' (SQLSTATE 28000).
--
-- 2. Autenticado sem vínculo com a igreja:
--    - Usuário com auth.uid() válido, mas sem registro na tabela app_private.church_members para p_church_id.
--    - Esperado: Exceção 'Acesso negado à igreja especificada.' (SQLSTATE 42501).
--
-- 3. Administrador de outra igreja:
--    - Usuário é admin da Igreja A, mas passa p_church_id da Igreja B (onde não possui membro ativo).
--    - Esperado: Exceção 'Acesso negado à igreja especificada.' (SQLSTATE 42501).
--
-- 4. Vínculo revogado ou entidade inativa:
--    - Usuário cadastrado na igreja, mas com membership status <> 'active' ou soft-deleted.
--    - Esperado: has_church_settings_access retorna false -> Exceção 'Acesso negado...' (SQLSTATE 42501).
--
-- 5. Membro básico elegível:
--    - Membro ativo sem papel de admin.
--    - Esperado: has_church_settings_access(p_church_id, false) permite consulta se membro ativo -> Sucesso (200).
--
-- 6. Líder não administrador:
--    - Líder da liturgia com papel de membro/líder.
--    - Esperado: has_church_settings_access(p_church_id, false) retorna true -> Sucesso (200).
--
-- 7. Administrador autorizado da igreja:
--    - Administrador formalmente ativo da igreja do modelo.
--    - Esperado: Sucesso (200) com payload fiel ao contrato SQL 022.
--
-- LIMITE DA RPC:
-- A RPC prepara uma cópia em memória (preview do modelo) e NÃO persiste itens em eventos.
-- A persistência permanente de itens de evento pertence ao escopo da Issue #29.
-- ==============================================================================

with proc_meta as (
  select
    to_regprocedure('public.instantiate_service_template(uuid, uuid, uuid)') as proc_oid,
    pg_get_functiondef(to_regprocedure('public.instantiate_service_template(uuid, uuid, uuid)')) as func_def
)
select
  -- 1. RPC existe com assinatura exata
  (p.proc_oid is not null) as proc_exists,

  -- 2. Segurança estrita (SECURITY DEFINER, search_path vazio, statement_timeout=5s)
  (
    select pr.prosecdef = true
      and (pr.proconfig @> array['search_path=""'] or pr.proconfig @> array['search_path='])
      and pr.proconfig @> array['statement_timeout=5s']
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
    and p.func_def like '%parallelServices%'
    and p.func_def not like '%parallel_services%'
    and p.func_def like '%where stps.template_id = p_template_id and stps.is_default_active = true%'
    and p.func_def like '%musics%'
    and p.func_def like '%responsibleMemberId%'
    and p.func_def like '%responsibleTeamId%'
  ) as contract_preserved,

  -- 5. Owner postgres
  (
    select r.rolname = 'postgres'
    from pg_catalog.pg_proc pr
    join pg_catalog.pg_roles r on r.oid = pr.proowner
    where pr.oid = p.proc_oid
  ) as owner_verified,

  -- 6. Privilégios: authenticated tem EXECUTE; anon, service_role e public revogados
  (
    select has_function_privilege('authenticated', pr.oid, 'EXECUTE')
      and not has_function_privilege('anon', pr.oid, 'EXECUTE')
      and not has_function_privilege('service_role', pr.oid, 'EXECUTE')
      and not exists (
        select 1 from lateral pg_catalog.aclexplode(coalesce(pr.proacl, pg_catalog.acldefault('f', pr.proowner))) a
        where a.grantee = 0 and a.privilege_type = 'EXECUTE'
      )
    from pg_catalog.pg_proc pr
    where pr.oid = p.proc_oid
  ) as privileges_verified
from proc_meta p;
