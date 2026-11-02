-- ==============================================================================
-- 025_atomic_event_planning_installer.sql
-- Instalador Atômico Unificado: Cadeia de Planejamento de Eventos (023a + 023b + 025)
--
-- Rastreabilidade: Issues #28, #29, #30 e #57
-- Decisões do Responsável:
--   - https://github.com/dgnoleto/escala-do-reino/issues/57
--   - https://github.com/dgnoleto/escala-do-reino/issues/58#issuecomment-6386407831
-- Auditoria Independente: Pareceres Técnicos Codex para 023a, 023b e 025
--
-- ESCOPO E COMPOSIÇÃO DESTE INVÓLUCRO ATÔMICO:
-- Compõe em transação ÚNICA e indivisível (BEGIN ... COMMIT) os três candidatos
-- aprovados e congelados criptograficamente, garantindo que em nenhum momento
-- qualquer estado intermediário desprotegido ou função vulnerável do SQL 023
-- original seja confirmado ou exposto a sessões concorrentes:
--
--   1. 023a_event_planning_structural.sql
--      - Evolução da tabela app_private.events (5 colunas de planejamento)
--      - Criação da tabela app_private.event_planning_receipts com RLS e owner postgres
--      - SHA-256: 279BF22D5CDED8366D77236684C777378BC488A3A296E6C94CEBB1038DEE237E
--
--   2. 023b_event_creation_security_hardening.sql
--      - RPC public.create_church_event_edition com regra Opção B (Issue #28)
--      - Assinatura estrita de 8 parâmetros e 6 campos de retorno
--      - Hardening D1–D7, advisory locks e replay sob Abordagem 1
--      - SHA-256: 634E21DC9D448529882721F3EE83B063BC56B8B442AA80716811A7B46FCD71B6
--
--   3. 025_event_planning_security_hardening.sql
--      - 4 RPCs de planejamento: reorder_event_items, set_event_duration_policy,
--        publish_event_program e save_event_program_draft
--      - Hardening A1–A4, B1/B2, exigência de READ COMMITTED e ordem explícita de locks
--      - Notificação final de recarga de schema para PostgREST
--      - SHA-256: 48A572FF2F1EBDD26099DEFE9EFFA6BDB24AF41E5BDC552EAC67903116E5D3BF
--
-- ------------------------------------------------------------------------------
-- DELIMITAÇÃO EXPLÍCITA DE ESCOPO E COBERTURA DE VERIFICAÇÃO:
--
-- 1. O que este wrapper verifica in-transaction antes do COMMIT:
--    - Baseline limpo rigoroso: exige SIMULTANEAMENTE a ausência prévia das cinco RPCs-alvo,
--      a ausência da tabela app_private.event_planning_receipts e a ausência das cinco
--      colunas de planejamento em app_private.events;
--    - Presença das 5 colunas estendidas em app_private.events pós-execução de 023a;
--    - Presença da tabela app_private.event_planning_receipts com relrowsecurity = true;
--    - Presença no catálogo pg_proc das 5 RPCs com assinaturas canônicas;
--    - Metadados de catálogo: prosecdef = true, proowner = 'postgres' e proconfig
--      contendo search_path="" e statement_timeout=5s;
--    - Conjunto completo de ACLs diretas em catálogo:
--        * ACL direta (aclexplode): exige concessão direta de EXECUTE a authenticated
--          (com is_grantable = false), permite o owner da função (postgres) e rejeita
--          qualquer outro grantee explícito (inclusive PUBLIC e roles extraordinárias);
--        * Privilégio efetivo das roles conhecidas (has_function_privilege): confirmação
--          de EXECUTE para authenticated e ausência estrita para anon e service_role;
--        * Resolução fail-closed dos OIDs de roles obrigatórias (postgres, authenticated,
--          anon, service_role).
--
-- 2. Ressalva sobre privilégios herdados e default privileges:
--    - A inspeção estática de proacl e has_function_privilege confere as ACLs diretas
--      e o privilégio efetivo das roles conhecidas, mas não esgota grants herdados
--      por associações dinâmicas de membership ou default privileges futuros, os quais
--      permanecem sujeitos ao ensaio dinâmico autorizado em ambiente PostgreSQL.
--
-- 3. O que já é verificado internamente pelos candidatos incluídos:
--    - 023a: Pré-requisitos de tabelas base 001–015 e pós-condição DDL das colunas e recibos;
--    - 023b: Asserção de catálogo de existência e ownership do postgres para create_church_event_edition;
--    - 025: Comandos DCL explícitos (revogações/concessões), alteração de ownership e notify pgrst.
--
-- 4. O que SOMENTE um ensaio dinâmico PostgreSQL poderá comprovar (fora do escopo deste wrapper):
--    - Execução das regras de negócio (Opção B, políticas de duração warn/block, janelas litúrgicas);
--    - Comportamento de advisory locks, concorrência e serialização física multissessão;
--    - Idempotência real via JSONB em app_private.event_planning_receipts;
--    - Rejeição de replays após perda de autoridade ou inativação ministerial;
--    - Efeito efetivo de statement_timeout e lock_timeout sob contenção;
--    - Reversibilidade por ROLLBACK e restauração determinística;
--    - Integração de rede/HTTP com PostgREST e recarga real do schema cache.
--    DECLARAÇÃO EXPLÍCITA DE LIMITES ESTÁTICOS:
--    A inspeção textual, expressões regulares e testes em Node.js não comprovam:
--      a) parsing ou compilação pelo PostgreSQL;
--      b) validade semântica PL/pgSQL em runtime;
--      c) execução dinâmica do wrapper.
--
-- CONTRATO OPERACIONAL DE EXECUÇÃO E CONTROLE TRANSACIONAL:
-- - O wrapper é destinado a execução em uma sessão psql nova, não interativa e exclusiva.
-- - Inicia obrigatoriamente com `\set ON_ERROR_STOP on` para impedir o avanço até o COMMIT caso ocorra erro.
-- - Executa `BEGIN;` com lock_timeout='5s' e statement_timeout='30s'.
-- - Preflight estritamente fail-closed para primeira instalação limpa: se qualquer uma das
--   5 RPCs, a tabela de recibos ou qualquer uma das 5 colunas de eventos já existir no catálogo,
--   a execução é abortada imediatamente.
-- - Inclui deterministicamente os três artefatos canônicos via `\ir` (include relative).
-- - Executa asserções in-transaction pós-instalação de catálogo, ownership e RLS.
-- - Encerra estritamente com `COMMIT;` apenas após 100% de sucesso de todas as etapas.
-- - Em execução não interativa por `psql -f` em sessão exclusiva (modo contratual a validar no futuro
--   ensaio autorizado, sem inferência de que já tenha sido exercitado), o encerramento da conexão após
--   erro reverte a transação não confirmada no backend.
-- - Se alguém utilizar `\i` em sessão interativa persistente — modo não recomendado —, a transação
--   pode permanecer abortada e exige `ROLLBACK` explícito na sessão.
-- - Em qualquer desses casos, nenhum estado parcial recebe `COMMIT`.
-- ==============================================================================

\set ON_ERROR_STOP on

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- ------------------------------------------------------------------------------
-- ETAPA 1: PREFLIGHT FAIL-CLOSED DE BASELINE LIMPO E PRÉ-REQUISITOS FUNDAMENTAIS
-- ------------------------------------------------------------------------------
do $preflight_guard$
begin
  -- 1.1 Pré-requisitos fundamentais de banco (Incrementos 001–015)
  if to_regclass('app_private.churches') is null
    or to_regclass('app_private.church_access') is null
    or to_regclass('app_private.members') is null
    or to_regclass('app_private.events') is null
    or to_regclass('app_private.event_items') is null
    or to_regclass('app_private.audit_entries') is null then
    raise exception 'PREFLIGHT FALHOU: Estrutura base de igrejas, membros, eventos e auditoria obrigatória.'
      using errcode = 'P0002';
  end if;

  -- 1.2 Bloqueio fail-closed de primeira instalação limpa: RPCs de planejamento
  -- Se qualquer uma das cinco RPCs de planejamento já existir no catálogo, aborta imediatamente.
  if exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'create_church_event_edition',
        'set_event_duration_policy',
        'reorder_event_items',
        'save_event_program_draft',
        'publish_event_program'
      )
  ) then
    raise exception 'PREFLIGHT BLOQUEADO (FAIL-CLOSED): RPC de planejamento pré-existente detectada em public. Este instalador exige baseline limpo sem objetos do 023/025 prévios.'
      using errcode = '42710';
  end if;

  -- 1.3 Bloqueio fail-closed de primeira instalação limpa: tabela de recibos
  if to_regclass('app_private.event_planning_receipts') is not null then
    raise exception 'PREFLIGHT BLOQUEADO (FAIL-CLOSED): Tabela app_private.event_planning_receipts já existente. Este instalador exige baseline limpo.'
      using errcode = '42P07';
  end if;

  -- 1.4 Bloqueio fail-closed de primeira instalação limpa: colunas de planejamento em app_private.events
  -- A existência de uma única coluna de planejamento já impede a instalação, sem tentar reparar ou aceitar.
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'app_private'
      and table_name = 'events'
      and column_name in (
        'duration_policy',
        'program_status',
        'program_version',
        'published_at',
        'published_by_member_id'
      )
  ) then
    raise exception 'PREFLIGHT BLOQUEADO (FAIL-CLOSED): Coluna de planejamento pré-existente detectada em app_private.events. Este instalador exige baseline limpo sem colunas prévias.'
      using errcode = '42701';
  end if;
end;
$preflight_guard$;

-- ------------------------------------------------------------------------------
-- ETAPA 2: COMPOSIÇÃO DOS CANDIDATOS APROVADOS (PRESERVANDO FONTES CANÔNICAS)
-- ------------------------------------------------------------------------------

-- 2.1 Candidato Estrutural DDL: Colunas em events, Receipts Table, RLS e Asserções
\ir 023a_event_planning_structural.sql

-- 2.2 Candidato RPC Seguro: Criação de Edições com Opção B e Hardening D1–D7
\ir 023b_event_creation_security_hardening.sql

-- 2.3 Candidato RPC Seguro: Reordenação, Políticas de Duração, Rascunho e Publicação
\ir 025_event_planning_security_hardening.sql

-- ------------------------------------------------------------------------------
-- ETAPA 3: ASSERÇÕES IN-TRANSACTION PÓS-INSTALAÇÃO DE CATÁLOGO (ANTES DO COMMIT)
-- ------------------------------------------------------------------------------
do $post_install_verification$
declare
  v_missing_rpcs text[];
  v_unhardened_rpcs text[];
  v_invalid_owners text[];
  v_invalid_privileges text[];
  v_proc_oid oid;
  v_proc_name text;
  v_auth_role_oid oid;
  v_owner_role_oid oid;
  v_anon_role_oid oid;
  v_service_role_oid oid;
  v_expected_rpcs text[] := array[
    'create_church_event_edition(uuid,uuid,text,text,timestamp with time zone,timestamp with time zone,uuid,text)',
    'reorder_event_items(uuid,uuid,uuid,uuid[])',
    'set_event_duration_policy(uuid,uuid,uuid,text)',
    'publish_event_program(uuid,uuid,uuid)',
    'save_event_program_draft(uuid,uuid,uuid)'
  ];
begin
  -- 3.0 Resolução fail-closed dos OIDs das roles obrigatórias do cluster
  select oid into v_auth_role_oid from pg_catalog.pg_roles where rolname = 'authenticated';
  if v_auth_role_oid is null then
    raise exception 'VERIFICAÇÃO PÓS-INSTALAÇÃO FALHOU: Role obrigatória "authenticated" não encontrada.'
      using errcode = '42704';
  end if;

  select oid into v_owner_role_oid from pg_catalog.pg_roles where rolname = 'postgres';
  if v_owner_role_oid is null then
    raise exception 'VERIFICAÇÃO PÓS-INSTALAÇÃO FALHOU: Role obrigatória "postgres" não encontrada.'
      using errcode = '42704';
  end if;

  select oid into v_anon_role_oid from pg_catalog.pg_roles where rolname = 'anon';
  if v_anon_role_oid is null then
    raise exception 'VERIFICAÇÃO PÓS-INSTALAÇÃO FALHOU: Role obrigatória "anon" não encontrada.'
      using errcode = '42704';
  end if;

  select oid into v_service_role_oid from pg_catalog.pg_roles where rolname = 'service_role';
  if v_service_role_oid is null then
    raise exception 'VERIFICAÇÃO PÓS-INSTALAÇÃO FALHOU: Role obrigatória "service_role" não encontrada.'
      using errcode = '42704';
  end if;

  -- 3.1 Conferência estrutural pós-instalação de colunas de planejamento em app_private.events
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'app_private' and table_name = 'events' and column_name = 'duration_policy'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'app_private' and table_name = 'events' and column_name = 'program_status'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'app_private' and table_name = 'events' and column_name = 'program_version'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'app_private' and table_name = 'events' and column_name = 'published_at'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'app_private' and table_name = 'events' and column_name = 'published_by_member_id'
  ) then
    raise exception 'VERIFICAÇÃO PÓS-INSTALAÇÃO FALHOU: Colunas de planejamento ausentes em app_private.events.'
      using errcode = 'P0002';
  end if;

  -- 3.2 Conferência da tabela de recibos de idempotência e RLS
  if to_regclass('app_private.event_planning_receipts') is null then
    raise exception 'VERIFICAÇÃO PÓS-INSTALAÇÃO FALHOU: Tabela app_private.event_planning_receipts ausente.'
      using errcode = 'P0002';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_class
    where oid = to_regclass('app_private.event_planning_receipts')
      and relrowsecurity = true
  ) then
    raise exception 'VERIFICAÇÃO PÓS-INSTALAÇÃO FALHOU: RLS não habilitado em app_private.event_planning_receipts.'
      using errcode = '42501';
  end if;

  -- 3.3 Conferência de presença e metadados de catálogo das 5 RPCs públicas
  foreach v_proc_name in array v_expected_rpcs
  loop
    v_proc_oid := to_regprocedure('public.' || v_proc_name);
    if v_proc_oid is null then
      v_missing_rpcs := array_append(v_missing_rpcs, v_proc_name);
    else
      -- 3.4 Hardening em catálogo: SECURITY DEFINER, search_path="" e statement_timeout=5s
      if not exists (
        select 1 from pg_catalog.pg_proc pr
        where pr.oid = v_proc_oid
          and pr.prosecdef = true
          and (pr.proconfig @> array['search_path=""'] or pr.proconfig @> array['search_path='])
          and pr.proconfig @> array['statement_timeout=5s']
      ) then
        v_unhardened_rpcs := array_append(v_unhardened_rpcs, v_proc_name);
      end if;

      -- 3.5 Ownership em catálogo: estritamente o role postgres
      if not exists (
        select 1 from pg_catalog.pg_proc pr
        where pr.oid = v_proc_oid
          and pr.proowner = v_owner_role_oid
      ) then
        v_invalid_owners := array_append(v_invalid_owners, v_proc_name);
      end if;

      -- 3.6 Auditoria estrita do conjunto completo de ACLs diretas da RPC:
      -- a) Exige concessão direta de EXECUTE a authenticated (com is_grantable = false);
      -- b) Rejeita qualquer outro grantee explícito com EXECUTE fora do allowlist (owner e authenticated);
      -- c) Rejeita expressamente PUBLIC (grantee = 0) para EXECUTE;
      -- d) Confere privilégio efetivo das roles conhecidas (authenticated com EXECUTE, anon e service_role sem EXECUTE).
      if not (
        -- Concessão direta a authenticated presente e sem grant option:
        exists (
          select 1
          from pg_catalog.pg_proc pr,
               lateral pg_catalog.aclexplode(coalesce(pr.proacl, pg_catalog.acldefault('f', pr.proowner))) a
          where pr.oid = v_proc_oid
            and a.grantee = v_auth_role_oid
            and a.privilege_type = 'EXECUTE'
            and a.is_grantable = false
        )
        -- Nenhum outro grantee explícito para EXECUTE além de authenticated e do próprio owner:
        and not exists (
          select 1
          from pg_catalog.pg_proc pr,
               lateral pg_catalog.aclexplode(coalesce(pr.proacl, pg_catalog.acldefault('f', pr.proowner))) a
          where pr.oid = v_proc_oid
            and a.privilege_type = 'EXECUTE'
            and a.grantee not in (v_auth_role_oid, pr.proowner)
        )
        -- Rejeição expressa de PUBLIC (grantee = 0):
        and not exists (
          select 1
          from pg_catalog.pg_proc pr,
               lateral pg_catalog.aclexplode(coalesce(pr.proacl, pg_catalog.acldefault('f', pr.proowner))) a
          where pr.oid = v_proc_oid
            and a.grantee = 0
            and a.privilege_type = 'EXECUTE'
        )
        -- Privilégios efetivos das roles conhecidas:
        and has_function_privilege(v_auth_role_oid, v_proc_oid, 'EXECUTE')
        and not has_function_privilege(v_anon_role_oid, v_proc_oid, 'EXECUTE')
        and not has_function_privilege(v_service_role_oid, v_proc_oid, 'EXECUTE')
      ) then
        v_invalid_privileges := array_append(v_invalid_privileges, v_proc_name);
      end if;
    end if;
  end loop;

  if array_length(v_missing_rpcs, 1) > 0 then
    raise exception 'VERIFICAÇÃO PÓS-INSTALAÇÃO FALHOU: RPCs ausentes no catálogo: %', array_to_string(v_missing_rpcs, ', ')
      using errcode = 'P0002';
  end if;

  if array_length(v_unhardened_rpcs, 1) > 0 then
    raise exception 'VERIFICAÇÃO PÓS-INSTALAÇÃO FALHOU: RPCs com metadados de catálogo incompletos (secdef/search_path/timeout): %', array_to_string(v_unhardened_rpcs, ', ')
      using errcode = '42501';
  end if;

  if array_length(v_invalid_owners, 1) > 0 then
    raise exception 'VERIFICAÇÃO PÓS-INSTALAÇÃO FALHOU: RPCs com proprietário inválido no catálogo (esperado postgres): %', array_to_string(v_invalid_owners, ', ')
      using errcode = '42501';
  end if;

  if array_length(v_invalid_privileges, 1) > 0 then
    raise exception 'VERIFICAÇÃO PÓS-INSTALAÇÃO FALHOU: RPCs com ACLs inválidas no catálogo: %', array_to_string(v_invalid_privileges, ', ')
      using errcode = '42501';
  end if;
end;
$post_install_verification$;

-- Confirmação atômica indivisível de todo o pacote
commit;
