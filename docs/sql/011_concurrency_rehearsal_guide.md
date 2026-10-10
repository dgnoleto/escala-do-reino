# Escala do Reino — Roteiro de Ensaios de Concorrência e Laboratório Reproduzível (011/012)

**Incremento:** Convites de Acesso, Aprovação de Nome e Ciclo de Recibos Idempotente  
**Documento Normativo de Operação:** `docs/sql/011_concurrency_rehearsal_guide.md`  
**Scripts Vinculados:**  
- Bootstrap de Infraestrutura Efêmera: [`docs/sql/bootstrap_lab_environment.sql`](bootstrap_lab_environment.sql)
- Conexão A (Terminal 1 / Bloqueador): [`docs/sql/concurrency/011_concurrency_session_a.sql`](concurrency/011_concurrency_session_a.sql)  
- Conexão B (Terminal 2 / Concorrente): [`docs/sql/concurrency/011_concurrency_session_b.sql`](concurrency/011_concurrency_session_b.sql)
- Executor e Validador Automatizado: [`tools/rehearsal-runner.js`](../../tools/rehearsal-runner.js)

---

## 1. Princípios, Diretrizes de Governança e Ambiente Operacional

> [!IMPORTANT]
> **Condição de Execução:**  
> A execução dos passos descritos neste roteiro contra qualquer banco de dados físico está **estritamente condicionada à autorização prévia e expressa do responsável**. Neste momento, a entrega é restrita à **integração do executor e validação com transporte simulado**. Nenhum comando contra PostgreSQL físico foi disparado ou deve ser disparado por inferência.

### Requisitos de Ambiente e Dependências Concretas (Windows / PowerShell)
- **Sistema Operacional:** Windows 10/11 x64 com Windows PowerShell 5.1 ou PowerShell 7+
- **Runtime:** Node.js v18.0.0+ (ES Modules nativos, sem dependências npm adicionais)
- **PostgreSQL Client / Server:** PostgreSQL 15+ (`psql` e `createdb`/`dropdb` disponíveis no `PATH`)

### Regras Estritas de Isolamento e Segurança
1. **Alvo Dedicado e Proibição de Ambientes Compartilhados:**  
   É terminantemente proibido executar este laboratório contra o piloto remoto Supabase (`jvpctgqudvjealzileib`), bases de homologação ou qualquer banco compartilhado. O alvo deve ser exclusivamente uma base local efêmera identificada (`escala_rehearsal_tmp` sob host e porta explícitos `127.0.0.1:5432` ou `localhost:5432`).
2. **Ambiente Explícito no Cliente psql:**  
   Todas as invocações de terminal devem desabilitar arquivos de inicialização pessoal e abortar imediatamente ao primeiro erro:  
   `psql -X -v ON_ERROR_STOP=1 -h $TargetHost -p $TargetPort -U $TargetUser -d $TargetDb`
3. **Identificação Inequívoca da Execução:**  
   Antes de qualquer mutação, identificar explicitamente: host, porta, database, usuário e identificador de execução (`run_id`). Todas as chamadas subsequentes reutilizam exatamente os mesmos parâmetros explícitos, sem depender de defaults do cliente ou variáveis de ambiente implícitas.
4. **Isolamento de Papéis:**  
   - Chamadas a RPCs de produto são executadas comutando para papel `authenticated` com JWT claims válidos (`request.jwt.claim.sub`).
   - Consultas administrativas, preparação de fixtures, inspeção de locks e barreiras são executadas pelo operador sob `reset role` (superusuário/postgres).
   - O esquema `app_private` nunca recebe grants para `anon` ou `authenticated`.

---

## 2. Bootstrap do Ambiente de Laboratório

O PostgreSQL padrão (`createdb`) não contém o esquema `auth`, a tabela `auth.users`, a função `auth.uid()`, a extensão `pgcrypto` nem os papéis padrão do Supabase (`anon`, `authenticated`, `service_role`).

### Caminho Principal: PostgreSQL Standalone com Bootstrap Completo (`bootstrap_lab_environment.sql`)
O procedimento normativo utiliza o arquivo canônico [`docs/sql/bootstrap_lab_environment.sql`](bootstrap_lab_environment.sql).

> [!NOTE]
> **Declaração de Escopo de Validação:**  
> Este bootstrap provisiona os esquemas, tabelas, extensões e funções necessários para atender a todos os pré-requisitos dos scripts 000–010 e do preflight 011 no banco de dados. Ele **simula os objetos do esquema auth no PostgreSQL, mas não valida o daemon HTTP/rede Supabase Auth (GoTrue)**.

#### Sequência Exata de Provisionamento do Laboratório no Windows / PowerShell:
```powershell
# 1. Identificar parâmetros explícitos do alvo
$TargetHost = "127.0.0.1"
$TargetPort = 5432
$TargetUser = "postgres"
$TargetDb   = "escala_rehearsal_tmp"
$RunId      = "rehearsal_$(Get-Date -Format 'yyyyMMdd_HHmmss')"

# 2. Criar a base efêmera dedicada local
createdb -h $TargetHost -p $TargetPort -U $TargetUser $TargetDb

# 3. Aplicar o bootstrap de dependências de infraestrutura
psql -X -v ON_ERROR_STOP=1 -h $TargetHost -p $TargetPort -U $TargetUser -d $TargetDb `
  -f docs/sql/bootstrap_lab_environment.sql
```

---

## 3. Sequência Canônica de Execução do Laboratório

A execução segue rigorosamente o ciclo seguro em oito fases:

```
[Fase 1] Provisionamento da Base Efêmera com 001–010
   ↓
[Fase 2] Preflight Somente-Leitura Integral (Exigência Estrita de 11 TRUEs)
   ↓
[Fase 3] Ensaio Transacional de Validação com ROLLBACK (Sem efeitos residuais)
   ↓
[Fase 4] Conferência de Ausência de Efeitos Residuais contra Baseline Completo
   ↓
[Fase 5] Aplicação Comprometida de 011_invitations_and_requests.sql
   ↓
[Fase 6] Verificação 012_verify_invitations.sql (6 TRUEs)
   ↓
[Fase 7] Ensaio de Concorrência Real com 2 Sessões Coordenadas (C1–C4)
   ↓
[Fase 8] Descarte Integral da Base Efêmera via dropdb com Guarda de Identidade
```

### Fase 1: Provisionamento de Pré-Requisitos (001–010)
Aplicar em sequência estrita os scripts canônicos de migração do produto com parâmetros explícitos:
```powershell
psql -X -v ON_ERROR_STOP=1 -h $TargetHost -p $TargetPort -U $TargetUser -d $TargetDb -f docs/sql/001_initial_access_structure.sql
psql -X -v ON_ERROR_STOP=1 -h $TargetHost -p $TargetPort -U $TargetUser -d $TargetDb -f docs/sql/003_access_requests_and_audit.sql
psql -X -v ON_ERROR_STOP=1 -h $TargetHost -p $TargetPort -U $TargetUser -d $TargetDb -f docs/sql/005_get_my_church_access.sql
psql -X -v ON_ERROR_STOP=1 -h $TargetHost -p $TargetPort -U $TargetUser -d $TargetDb -f docs/sql/007_member_management.sql
psql -X -v ON_ERROR_STOP=1 -h $TargetHost -p $TargetPort -U $TargetUser -d $TargetDb -f docs/sql/009_create_my_church.sql
```
*Atenção:* Nunca reaplicar estes scripts em uma base já provisionada.

### Fase 2: Preflight Somente-Leitura Integral Real
O preflight é executado consumindo diretamente o arquivo canônico [`docs/sql/011_preflight_invitations.sql`](011_preflight_invitations.sql).  
**Proibição de Cópias Manuais:** Não utilizar versões reduzidas inline. O preflight autêntico é lido integralmente pelo executor ou executado diretamente via psql.

O validador audita primeiro o sucesso do transporte (`exitCode === 0` e ausência de erro de processo) e exige **exatamente uma linha com os onze indicadores reais estritamente `TRUE`**:
1. `server_and_client_utf8`
2. `previous_seven_tables_present`
3. `previous_seven_rpcs_present`
4. `crypto_primitives_available`
5. `required_table_columns_present`
6. `required_indexes_and_predicates_present`
7. `required_triggers_and_functions_present`
8. `required_physical_constraints_present`
9. `no_corrupted_data_or_partial_evolution_in_existing_tables`
10. `new_nine_rpcs_not_yet_installed`
11. `app_private_strictly_blocked_and_rls_active`

#### Execução via CLI psql:
```powershell
psql -X -v ON_ERROR_STOP=1 -h $TargetHost -p $TargetPort -U $TargetUser -d $TargetDb `
  -f docs/sql/011_preflight_invitations.sql
```

#### Verificação de Integridade das Fontes Canônicas:
Para garantir que as fontes canônicas de 011 e 012 projetam todos os indicadores requeridos e rejeitar qualquer desatualização:
```powershell
node tools/rehearsal-runner.js --check
```

### Fase 3: Ensaio de Validação em Bloco com ROLLBACK
Antes de iniciar o ensaio, capturar o snapshot completo de baseline do catálogo e das 8 tabelas de domínio. Em seguida, executar o script de ensaio transacional:
```powershell
psql -X -v ON_ERROR_STOP=1 -h $TargetHost -p $TargetPort -U $TargetUser -d $TargetDb `
  -f docs/sql/011_validate_invitations.sql
```
O script executa os 25 cenários determinísticos e termina obrigatoriamente com `ROLLBACK`.

### Fase 4: Conferência de Ausência de Efeitos Residuais contra Baseline Completo
Validar que o ROLLBACK desfez 100% das mutações comparando o snapshot pós-rollback contra o snapshot de baseline completo.  
A comparação auditada pelo executor exige correspondência exata:
- `installed_011_rpcs_count === 0`
- `command_receipts_has_result_entity_id === false`
- `command_receipts_has_result_payload === false`
- `command_receipts_has_payload_check === false`
- `app_private_client_permissions_count === 0`
- Contagens idênticas em todas as 8 tabelas: `churches`, `members`, `church_access`, `access_invitations`, `access_requests`, `audit_entries`, `command_receipts` e `auth.users`.

#### Consulta Canônica de Snapshot (Executada pelo Executor):
```sql
SELECT json_build_object(
  'installed_011_rpcs_count', (
    SELECT count(*)::int
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'issue_church_invitation', 'get_invitation_details',
        'redeem_invitation_confirm_name', 'redeem_invitation_propose_name',
        'get_my_access_request', 'list_church_invitations',
        'list_church_access_requests', 'decide_access_request',
        'get_invitation_command_receipt'
      )
  ),
  'command_receipts_has_result_entity_id', (
    SELECT exists(
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'app_private'
        AND table_name = 'command_receipts'
        AND column_name = 'result_entity_id'
    )
  ),
  'command_receipts_has_result_payload', (
    SELECT exists(
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'app_private'
        AND table_name = 'command_receipts'
        AND column_name = 'result_payload'
    )
  ),
  'command_receipts_has_payload_check', (
    SELECT exists(
      SELECT 1 FROM information_schema.table_constraints
      WHERE table_schema = 'app_private'
        AND table_name = 'command_receipts'
        AND constraint_name = 'command_receipts_payload_check'
    )
  ),
  'app_private_client_permissions_count', (
    SELECT count(*)::int
    FROM information_schema.table_privileges
    WHERE table_schema = 'app_private'
      AND grantee IN ('anon', 'authenticated')
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
  )
) AS snapshot;
```

> [!IMPORTANT]
> **Ponto de Parada Obrigatório para Revisão Formal:**  
> A execução autorizada do laboratório para na Fase 4 (`--stage rollback`) para auditoria da ausência de efeitos residuais antes de qualquer aplicação com COMMIT.

### Fase 5 e 6: Instalação Comprometida e Verificação 012
Somente após aprovação formal da Fase 4, aplicar a instalação comprometida e validar os 6 indicadores reais de `012_verify_invitations.sql`:
```powershell
psql -X -v ON_ERROR_STOP=1 -h $TargetHost -p $TargetPort -U $TargetUser -d $TargetDb `
  -f docs/sql/011_invitations_and_requests.sql

psql -X -v ON_ERROR_STOP=1 -h $TargetHost -p $TargetPort -U $TargetUser -d $TargetDb `
  -f docs/sql/012_verify_invitations.sql
```

---

## 4. Ensaios de Concorrência Real com Duas Conexões (C1–C4)

### Protocolo de Coordenação por Fases (Sem Sinais Não-Comitados)
Para impedir que a Conexão B se adiante, emita RPCs antes de A reter os locks ou avance prematuramente entre cenários:
1. **Identidade Inequívoca:** Toda a execução é registrada com `run_id`, `scenario_id` e PIDs explícitos descobertos dinamicamente pelo transporte (`SELECT pg_backend_pid();`).
2. **Sequência Canônica por Cenário:**
   `Sessões Prontas → Locks de A Retidos → B Autorizada a Chamar a RPC → A Confirma que B Espera por seu PID → Liberação de A → Resultado de B Confirmado → A Verifica Estado Final → Avanço ao Próximo Cenário`.
3. **Persistência Fora da Transação:** Não utilizar escrita em tabela dentro de transações que sofrerão ROLLBACK como sinal para outra conexão. A coordenação e detecção de status são efetuadas pelo coordenador do processo cliente via `pg_blocking_pids`.
4. **Contrato de Retorno C1:** No replay de `issue_church_invitation`, o retorno da RPC contém `raw_token = null` e o mesmo `invitation_id`. O indicador `link_unrecoverable = true` pertence a `get_invitation_command_receipt(p_command_id)`, que é consultado formalmente para essa validação.
5. **Coordenação Temporal C4:** Fixture criada com 2 segundos de margem. Conexão A retém os locks e comprova ativamente que Conexão B entrou na fila bloqueada pelo seu PID **antes de cruzar a expiração** (`waitStartedAt < expiresAt`). Conexão A dorme dinamicamente até ultrapassar o prazo mantendo B retida, e libera via `ROLLBACK`. Conexão B desbloqueia pós-prazo, detecta expiração pós-lock, persiste `status = 'expired'` e retorna estruturado `REQUEST_EXPIRED`.

### Matriz dos Cenários de Concorrência

| ID | Cenário | Bloqueador (Conexão A) | Bloqueado (Conexão B) | Barreira Ativa e Desfecho Esperado |
| :--- | :--- | :--- | :--- | :--- |
| **C1** | Emissão duplicada concorrente (`TC-INV-RACE-03`) | Advisory lock transacional sobre `(user_id, command_id)` | `issue_church_invitation` com mesmo comando | A comprova que `b_pid` está bloqueado por `pg_backend_pid()`. A comita. B desbloqueia e retorna replay idempotente (`raw_token = null`). Recibo consultado confirma `link_unrecoverable = true`. |
| **C2** | Reemissão vs. Resgate Concorrente (`TC-INV-RACE-01`) | `members FOR UPDATE` | `redeem_invitation_confirm_name` | A comprova bloqueio de B. A reemite e comita. B desbloqueia, constata convite revogado e aborta com `P0002`. |
| **C3** | Duas Decisões Concorrentes (`TC-INV-RACE-02`) | Ordem canônica até `access_requests FOR UPDATE` | `decide_access_request` ('reject') | A comprova bloqueio de B. A aprova e comita. B desbloqueia, constata `status <> 'pending'` e aborta com `23505`. |
| **C4** | Decisão com Expiração Temporal na Fila (`TC-INV-RACE-05`) | Locks canônicos em church, member e request | `decide_access_request` ('approve') | A comprova que B está bloqueado ANTES do vencimento. A aguarda dinamicamente além do prazo mantendo B retido. A executa `ROLLBACK`. B desbloqueia pós-prazo, persiste `status = 'expired'` e retorna `error_code = 'REQUEST_EXPIRED'` sem lançar exceção. |

---

## 5. Procedimento de Limpeza e Descarte Seguro

> [!CAUTION]
> **Proibição Estrita de Limpeza Parcial por DML:**  
> O cleanup por DML (deletando membros ou usuários de teste) é expressamente proibido, pois as FKs com `ON DELETE RESTRICT` introduzidas em 001 (ex.: `church_access` vinculado em C3) e os gatilhos de proteção administrativa (009) impedem exclusões parciais sem violar restrições físicas de integridade.

### Método Normativo Exclusivo: Descarte Integral da Base Efêmera
Ao término de todas as evidências, fechar as conexões ativas e descartar integralmente a base de dados com parâmetros explícitos:

```powershell
# 1. Terminar conexões ativas com a base efêmera (conectado à base administrativa postgres)
psql -X -v ON_ERROR_STOP=1 -h $TargetHost -p $TargetPort -U $TargetUser -d postgres -c `
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$TargetDb' AND pid <> pg_backend_pid();"

# 2. Descartar completamente a base efêmera dedicada
dropdb -h $TargetHost -p $TargetPort -U $TargetUser $TargetDb
```

---

## 6. CLI do Executor Integrado (`tools/rehearsal-runner.js`)

O arquivo [`tools/rehearsal-runner.js`](../../tools/rehearsal-runner.js) provê o ponto de entrada normativo:

```powershell
# 1. Ajuda e opções
node tools/rehearsal-runner.js --help

# 2. Exibição do plano completo de execução (sem alterações)
node tools/rehearsal-runner.js --plan

# 3. Verificação de integridade canônica dos scripts 011/012 (rejeita desatualização)
node tools/rehearsal-runner.js --check

# 4. Ensaio integrado de ponta a ponta sem banco (transporte simulado)
node tools/rehearsal-runner.js --dry-run

# 5. Ensaio integrado limitado à fase de ROLLBACK
node tools/rehearsal-runner.js --dry-run --stage rollback

# 6. Execução física contra PostgreSQL (estritamente condicionada à autorização)
node tools/rehearsal-runner.js --execute --stage rollback --confirm-local
```
