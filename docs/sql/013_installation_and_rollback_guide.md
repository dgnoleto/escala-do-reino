# Escala do Reino — Guia de Instalação, Verificação (014) e Reversão Exata do Incremento 013

**Incremento:** 013 / 014 — Ciclo de Vida de Membros (Listagem Administrativa com Filtros, Restauração Elegível, Recibos Idempotentes e Trava Litúrgica P0021)
**Documento Normativo:** `docs/sql/013_installation_and_rollback_guide.md`
**Referência Metodológica:** `docs/sql/013_concurrency_rehearsal_guide.md` e `docs/CADASTRO-MEMBROS.md`

---

## 1. Contexto Arquitetural e Obrigatoriedade de COMMIT

Nos ensaios sequenciais unitários (como `013_validate_member_lifecycle.sql`), todas as mutações e criações ocorrem dentro de uma única transação que se encerra com `ROLLBACK`.

Contudo, para ensaios de **concorrência física entre conexões reais simultâneas** (Terminal 1 / Conexão A e Terminal 2 / Conexão B):
1. **Isolamento de Transação:** Sob o nível de isolamento padrão `READ COMMITTED` do PostgreSQL, objetos criados (funções RPC) e linhas inseridas (fixtures) dentro de uma transação aberta na Conexão A permanecem **invisíveis** para a Conexão B até que ocorra um `COMMIT`.
2. **Disponibilidade das RPCs:** Para que a Conexão B possa invocar `public.restore_church_member`, os endpoints do incremento 013 precisam estar formalmente comitados no catálogo do banco de dados.
3. **Disponibilidade das Fixtures:** Os membros e vínculos sintéticos precisam estar comitados para que ambas as sessões possam enxergá-los e disputar locks físicos (`FOR UPDATE` e `pg_advisory_xact_lock`).

Por esse motivo, a instalação de 013 e a preparação das fixtures efêmeras requerem `COMMIT`, acompanhados de um **protocolo rigoroso de reversão exata** para garantir que o banco retorne ao baseline inicial sem necessidade de descarte ou reset do banco.

---

## 2. Captura do Baseline Inicial (Pré-Instalação)

Antes de aplicar qualquer modificação durável no laboratório local (porta 55332 / container `supabase_db_escala-convites-http-lab`), o operador/executor deve capturar o snapshot canônico do catálogo, dos dados e dos resumos criptográficos determinísticos de conteúdo das tabelas:

```sql
SELECT json_build_object(
  'installed_013_rpcs_count', (
    SELECT count(*)::int
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'list_church_members_admin',
        'restore_church_member',
        'get_member_lifecycle_receipt',
        'deactivate_church_member'
      )
  ),
  'members_trigger_function', (
    SELECT p.proname::text
    FROM pg_catalog.pg_trigger tr
    JOIN pg_catalog.pg_class c ON c.oid = tr.tgrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_catalog.pg_proc p ON p.oid = tr.tgfoid
    WHERE n.nspname = 'app_private'
      AND c.relname = 'members'
      AND tr.tgname = 'members_touch_updated_at'
  ),
  'members_has_monotonic_trigger', (
    SELECT exists(
      SELECT 1 FROM pg_catalog.pg_trigger tr
      JOIN pg_catalog.pg_class c ON c.oid = tr.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_catalog.pg_proc p ON p.oid = tr.tgfoid
      WHERE n.nspname = 'app_private'
        AND c.relname = 'members'
        AND tr.tgname = 'members_touch_updated_at'
        AND p.proname = 'touch_member_updated_at'
    )
  ),
  'catalogue_fingerprints', json_build_object(
    'triggers', (
      SELECT md5(coalesce(string_agg(
        concat_ws('|', n.nspname, c.relname, tr.tgname, p.proname, tr.tgenabled, tr.tgtype::text),
        ';' order by n.nspname, c.relname, tr.tgname
      ), 'empty'))
      FROM pg_catalog.pg_trigger tr
      JOIN pg_catalog.pg_class c ON c.oid = tr.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_catalog.pg_proc p ON p.oid = tr.tgfoid
      WHERE n.nspname in ('public', 'app_private')
        AND not tr.tgisinternal
    ),
    'app_private_functions', (
      SELECT md5(coalesce(string_agg(
        concat_ws('|', p.proname, p.prosecdef, pg_get_functiondef(p.oid)),
        ';' order by p.proname
      ), 'none'))
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'app_private'
    ),
    'schema_acls', (
      SELECT md5(coalesce(string_agg(
        concat_ws('|', n.nspname, coalesce(array_to_string(n.nspacl, ','), 'default')),
        ';' order by n.nspname
      ), 'none'))
      FROM pg_catalog.pg_namespace n
      WHERE n.nspname in ('public', 'app_private')
    ),
    'table_acls', (
      SELECT md5(coalesce(string_agg(
        concat_ws('|', n.nspname, c.relname, coalesce(array_to_string(c.relacl, ','), 'default')),
        ';' order by n.nspname, c.relname
      ), 'none'))
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname in ('public', 'app_private')
        AND c.relkind in ('r', 'v')
    ),
    'function_acls', (
      SELECT md5(coalesce(string_agg(
        concat_ws('|', n.nspname, p.proname, coalesce(array_to_string(p.proacl, ','), 'default')),
        ';' order by n.nspname, p.proname, p.oid
      ), 'none'))
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname in ('public', 'app_private')
    ),
    'rls_policies', (
      SELECT md5(coalesce(string_agg(
        concat_ws('|',
          n.nspname,
          c.relname,
          c.relrowsecurity,
          coalesce(pol.polname, 'none'),
          coalesce(pol.polcmd::text, 'none'),
          coalesce(pol.polpermissive::text, 'none'),
          coalesce(pol.polroles::text, 'none'),
          coalesce(pg_get_expr(pol.polqual, pol.polrelid), 'none'),
          coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), 'none')
        ),
        ';' order by n.nspname, c.relname, coalesce(pol.polname, '')
      ), 'none'))
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_catalog.pg_policy pol ON pol.polrelid = c.oid
      WHERE n.nspname in ('public', 'app_private')
        AND c.relkind = 'r'
    ),
    'has_coordination_table', (to_regclass('app_private.rehearsal_coordination') is not null)
  ),
  'row_counts', json_build_object(
    'churches', (SELECT count(*)::int FROM app_private.churches),
    'members', (SELECT count(*)::int FROM app_private.members),
    'church_access', (SELECT count(*)::int FROM app_private.church_access),
    'access_invitations', (SELECT count(*)::int FROM app_private.access_invitations),
    'access_requests', (SELECT count(*)::int FROM app_private.access_requests),
    'audit_entries', (SELECT count(*)::int FROM app_private.audit_entries),
    'command_receipts', (SELECT count(*)::int FROM app_private.command_receipts),
    'auth_users', (SELECT count(*)::int FROM auth.users)
  ),
  'content_hashes', json_build_object(
    'churches', (SELECT md5(coalesce(string_agg(row_to_json(t)::text, '' order by t.id), 'empty')) FROM (SELECT * FROM app_private.churches) t),
    'members', (SELECT md5(coalesce(string_agg(row_to_json(t)::text, '' order by t.id), 'empty')) FROM (SELECT * FROM app_private.members) t),
    'church_access', (SELECT md5(coalesce(string_agg(row_to_json(t)::text, '' order by t.id), 'empty')) FROM (SELECT * FROM app_private.church_access) t),
    'access_invitations', (SELECT md5(coalesce(string_agg(row_to_json(t)::text, '' order by t.id), 'empty')) FROM (SELECT * FROM app_private.access_invitations) t),
    'access_requests', (SELECT md5(coalesce(string_agg(row_to_json(t)::text, '' order by t.id), 'empty')) FROM (SELECT * FROM app_private.access_requests) t),
    'audit_entries', (SELECT md5(coalesce(string_agg(row_to_json(t)::text, '' order by t.id), 'empty')) FROM (SELECT * FROM app_private.audit_entries) t),
    'command_receipts', (SELECT md5(coalesce(string_agg(row_to_json(t)::text, '' order by t.id), 'empty')) FROM (SELECT * FROM app_private.command_receipts) t),
    'auth_users', (SELECT md5(coalesce(string_agg(concat_ws('|', id, email, email_confirmed_at, banned_until, deleted_at, is_anonymous, role, created_at, updated_at), '' order by id), 'empty')) FROM auth.users)
  ),
  'residual_fixtures_count', (
    SELECT (
      (SELECT count(*)::int FROM auth.users WHERE id IN ('01300000-0000-4000-8000-0000000000a1', '01300000-0000-4000-8000-0000000000a2', '01300000-0000-4000-8000-0000000000b2', '01300000-0000-4000-8000-0000000000b3')) +
      (SELECT count(*)::int FROM app_private.churches WHERE id = '01300000-0000-4000-8000-0000000000c1') +
      (SELECT count(*)::int FROM app_private.members WHERE church_id = '01300000-0000-4000-8000-0000000000c1') +
      (SELECT count(*)::int FROM app_private.church_access WHERE id in ('01300000-0000-4000-8000-00000000ac11', '01300000-0000-4000-8000-00000000ac12', '01300000-0000-4000-8000-00000000ac22', '01300000-0000-4000-8000-00000000ac33') or church_id = '01300000-0000-4000-8000-0000000000c1') +
      (SELECT count(*)::int FROM app_private.command_receipts WHERE command_id = '01300000-0000-4000-8000-000000000cc3')
    )
  )
) AS baseline;
```

**Fotografia Esperada no Baseline do Laboratório:**
- `installed_013_rpcs_count`: 0
- `members_trigger_function`: `'touch_updated_at'` (gatilho genérico original)
- `members_has_monotonic_trigger`: false
- `catalogue_fingerprints.has_coordination_table`: false
- `row_counts`: 7 membros ativos, 0 inativos, 4 contas Auth, 2 igrejas, 6 vínculos, 8 convites, 4 solicitações, 24 auditorias e 22 recibos.
- `residual_fixtures_count`: 0

---

## 3. Instalação e Verificação 014 Pré-Corrida

### 3.1 Aplicação do Script 013 com COMMIT
Sob autorização formal, o script `docs/sql/013_member_lifecycle.sql` é executado na base local:
- Substitui o gatilho `members_touch_updated_at` para utilizar a função monotônica estrita `app_private.touch_member_updated_at()`, preservando o gatilho genérico em `churches` e `church_access`.
- Cria as 4 funções RPC em `public` (`list_church_members_admin`, `restore_church_member`, `get_member_lifecycle_receipt`, `deactivate_church_member`).
- Aplica endurecimento de privilégios (`revoke all` de public, anon e service_role; `grant execute` apenas para `authenticated`).
- Comita as alterações com `COMMIT;`.

### 3.2 Verificação Imediata com 014
Executa a consulta canônica `docs/sql/014_verify_member_lifecycle.sql`.
**Critério de Aceite Estrito:** Todas as 7 colunas booleanas devem retornar `true`:
1. `all_four_lifecycle_rpcs_present = true`
2. `all_four_rpcs_hardened = true`
3. `all_four_rpcs_privileges_verified = true`
4. `members_monotonic_trigger_verified = true`
5. `generic_triggers_preserved = true`
6. `all_seven_private_tables_have_rls = true`
7. `private_schema_still_blocked = true`

Se qualquer coluna retornar `false`, a execução concorrente NÃO deve prosseguir.

---

## 4. Execução dos Ensaios Concorrentes e Limpeza Cirúrgica de Fixtures

1. A Conexão A executa a pré-checagem de colisão e insere as fixtures com UUIDs estritamente válidos no namespace `01300000-...` (sem `ON CONFLICT DO NOTHING`) e comita.
2. Executam-se as rodadas coordenadas:
   - **C1.A:** Conflito de revisão otimista $T_0 \to T_1$ (captura `P0019`).
   - **E17 / C1.B.1:** Concessão concorrente sem linha prévia em `church_access` (captura `P0018`).
   - **E17 / C1.B.2:** Concessão concorrente na variante com linha `revoked` (captura `P0018`).
   - **C2:** Perda de autorização administrativa durante a espera (captura `42501`).
   - **C3:** Replay simultâneo sob advisory lock transacional (mesmo recibo com 6 colunas reais, 1 única auditoria).
3. **Procedimento Excepcional de Manutenção para Desmontagem:**
   Como a proteção de continuidade do último administrador (`church_access_protect_last_admin` e `members_protect_last_admin`) impede a exclusão ordinária do último administrador da igreja sintética, a limpeza utiliza um procedimento de manutenção explícito:
   - **Atenção ao escopo:** `ALTER TABLE ... DISABLE TRIGGER` afeta a tabela inteira (requer `ACCESS EXCLUSIVE` lock no PostgreSQL), e não apenas as linhas da fixture. Por isso, é obrigatório definir `SET LOCAL lock_timeout = '5s'`, verificar previamente o estado ativo dos gatilhos (`tgenabled = 'O'`), executar em transação curtíssima e comprovar a reativação imediata.
   - Deleta estritamente os identificadores declarados no manifesto de execução (incluindo `...ac22` gerado em C1.B.1).
   - Elimina a tabela efêmera de coordenação (`DROP TABLE IF EXISTS app_private.rehearsal_coordination`).
   - Reativa os gatilhos e valida documentalmente que retornaram ao estado ativo (`tgenabled = 'O'`).

---

## 5. Protocolo de Reversão Exata do Catálogo (Desinstalação de 013)

Caso seja necessário desfazer a instalação de 013 para retornar a base ao estado anterior aos ensaios, **NÃO se deve executar reset de banco (`supabase db reset` ou `dropdb`)**, pois isso destruiria as contas e evidências acumuladas dos incrementos 001–012.

Em vez disso, executa-se o script de **reversão cirúrgica de objetos**:

```sql
-- ============================================================================
-- SCRIPT DE REVERSÃO EXATA E RESTAURAÇÃO DO CATÁLOGO ANTERIOR A 013
-- ============================================================================
BEGIN;

-- 1. Remove os 4 endpoints RPC adicionados pelo incremento 013
DROP FUNCTION IF EXISTS public.deactivate_church_member(uuid, uuid, uuid, text);
DROP FUNCTION IF EXISTS public.get_member_lifecycle_receipt(uuid);
DROP FUNCTION IF EXISTS public.restore_church_member(uuid, uuid, uuid, text);
DROP FUNCTION IF EXISTS public.list_church_members_admin(uuid, text, integer, integer);

-- 2. Restaura o gatilho genérico em members_touch_updated_at (como em 001)
DROP TRIGGER IF EXISTS members_touch_updated_at ON app_private.members;
DROP FUNCTION IF EXISTS app_private.touch_member_updated_at();

CREATE TRIGGER members_touch_updated_at
BEFORE UPDATE ON app_private.members
FOR EACH ROW EXECUTE FUNCTION app_private.touch_updated_at();

-- 3. Eliminação definitiva da tabela de coordenação efêmera
DROP TABLE IF EXISTS app_private.rehearsal_coordination;

COMMIT;
```

---

## 6. Conferência Pós-Reversão contra o Baseline

Após a reversão exata, executa-se novamente a consulta de snapshot da Seção 2 e compara-se com o baseline capturado na Seção 2:

```
[Baseline Inicial]               [Pós-Reversão Exata]             [Resultado]
installed_013_rpcs_count: 0    = installed_013_rpcs_count: 0    -> IDENTICO
members_trigger_function: touch = members_trigger_function: touch -> IDENTICO
members_has_monotonic: false   = members_has_monotonic: false   -> IDENTICO
catalogue_fingerprints         = catalogue_fingerprints         -> IDENTICO (triggers, functions, RLS)
has_coordination_table: false  = has_coordination_table: false  -> IDENTICO (tabela eliminada)
members: 7                     = members: 7                     -> IDENTICO
auth_users: 4                  = auth_users: 4                  -> IDENTICO
churches: 2                    = churches: 2                    -> IDENTICO
church_access: 6               = church_access: 6               -> IDENTICO
access_invitations: 8          = access_invitations: 8          -> IDENTICO
access_requests: 4             = access_requests: 4             -> IDENTICO
audit_entries: 24              = audit_entries: 24              -> IDENTICO
command_receipts: 22           = command_receipts: 22           -> IDENTICO
content_hashes: [8 tabelas]    = content_hashes: [8 tabelas]    -> IDENTICO (inclui dados Auth)
residual_fixtures_count: 0     = residual_fixtures_count: 0     -> ZERO RESIDUOS
```

Qualquer divergência acusada pela comparação de snapshots constitui impedimento e bloqueia novas operações até saneamento.
