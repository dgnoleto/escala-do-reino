# Escala do Reino — Roteiro de Planejamento de Concorrência e Laboratório Reproduzível (013/014)

**Incremento:** Ciclo de Vida de Membros (Listagem Administrativa com Filtros, Restauração Elegível, Recibo Idempotente e Trava Litúrgica P0021)  
**Documento Normativo de Planejamento:** `docs/sql/013_concurrency_rehearsal_guide.md`  
**Referência Metodológica:** `docs/sql/011_concurrency_rehearsal_guide.md` e `docs/CADASTRO-MEMBROS.md`

---

## 1. Diretrizes de Governança, Limites e Condição de Execução

> [!IMPORTANT]
> **Status deste Documento:**  
> Este roteiro constitui **planejamento de desenho e especificação metodológica**. Nenhuma execução contra banco físico (piloto Supabase, homologação ou laboratório local efêmero) está autorizada nesta etapa. Não criar fixtures no banco nem executar comandos SQL. A aplicação e os ensaios permanecem estritamente condicionados à aprovação prévia e expressa do responsável.

### Objetivos do Planejamento Concorrente
1. **Separação Arquitetural:** O ensaio sequencial de integridade transacional reside em `013_validate_member_lifecycle.sql` (executado em transação única com `ROLLBACK`). As disputas de concorrência física entre transações simultâneas são planejadas separadamente neste roteiro, com modelo de duas conexões em `READ COMMITTED` e coordenação por checkpoints.
2. **Distinção Metodológica Fundamental:** Não confundir a recusa ordinária de concessão de acesso a membros inativos (regra funcional de integridade introduzida em 011, que rejeita emissão de convite quando `m.status <> 'active'`) com disputas concorrentes físicas comprovadas em tempo real.
3. **Invariância de Vínculos Revogados:** Provar que a restauração de cadastro de membro ativa exclusivamente `app_private.members`, mantendo qualquer registro prévio em `app_private.church_access` com `status = 'revoked'` rigorosamente inalterado.

---

## 2. Topologia do Laboratório e Protocolo de Coordenação (Duas Conexões)

### Parâmetros de Isolamento
- **Nível de Isolamento:** `READ COMMITTED` padrão do PostgreSQL em ambas as sessões.
- **Identificadores das Conexões:** Conexão A (Terminal 1 — Sessão Bloqueadora / Mutadora) e Conexão B (Terminal 2 — Sessão Concorrente / Disputante).
- **Mecanismo de Barreira e Checkpoint:** Uso de `pg_blocking_pids(pg_backend_pid())` e advisory locks transacionais (`pg_advisory_xact_lock`), sem depender de tabelas não comitadas como canais de sinalização.

---

## 3. Matriz dos Cenários Concorrentes Planejados

| ID | Cenário | Bloqueador (Conexão A) | Bloqueado / Concorrente (Conexão B) | Checkpoint / Barreira e Desfecho Esperado |
| :--- | :--- | :--- | :--- | :--- |
| **C1.A** | **Disputa Concorrente de Revisão $T_0 \to T_1$** | Conexão A adquire lock em `members FOR UPDATE` do membro inativo sob revisão $T_0$. Atualiza dados cadastrais sem alterar `status = 'inactive'`, avança `updated_at` para $T_1$ via gatilho monotônico e comita. | Conexão B dispara `restore_church_member` com revisão $T_0$. Aguarda na fila de lock de linha de `members` de A. | Conexão B acorda pós-commit de A, lê o membro ainda inativo, mas constata $T_1 \ne T_0$ (`p_expected_updated_at`), e aborta com `P0019`. Isola estritamente a revisão sem acionar a recusa de membro já active. |
| **C1.B.1** | **E17 Aprovado: Sem Linha Prévia em `church_access`** | Conexão A retém lock de linha em `members FOR UPDATE` do membro inativo. Após B realizar lookup sem acesso e bloquear na fila de `members`, A cria o vínculo `status = 'active'` de manutenção de teste (sem alterar `members`), e comita. | Conexão B dispara `restore_church_member` para o membro $M$. Realiza lookup sem acesso e bloqueia aguardando a liberação do lock de linha em `members` mantido por A. | Conexão B acorda pós-espera real em `members`, valida membro `inactive` e revisão $T_0$, e na consulta real `EXISTS` pós-lock em `church_access` detecta o vínculo ativo recém-comitado, abortando com `P0018`. |
| **C1.B.2** | **E17 Aprovado: Com Linha `revoked` Existente em `church_access`** | Conexão A retém primeiro o acesso do alvo (`church_access FOR UPDATE`) e depois o membro (`members FOR UPDATE`), na ordem canônica da RPC. Com B bloqueado na linha de `church_access`, A altera o acesso para `status = 'active'` de manutenção de teste (sem alterar `members`), e comita. | Conexão B dispara `restore_church_member` para o membro $M$. Bloqueia na linha de `church_access` retida por A antes de obter o membro. | Conexão B acorda pós-commit de A, obtém acesso e membro, revalida autorizações e recusa com `P0018`. Comprova-se ausência de mutação de membro, auditoria e recibo de B. |
| **C2** | **Perda de Autorização Administrativa Durante a Espera** | Conexão A (admin titular preservado) retém lock de linha no membro alvo. Enquanto B aguarda na fila, Conexão A revoga o privilégio administrativo do operador de B em `church_access` com metadados completos (`status = 'revoked'`, `revoked_by_user_id`, `revoked_at`) e comita. | Conexão B dispara `restore_church_member` como admin 2 e entra em espera de lock de A. | Conexão B acorda após o commit de A. A revalidação final de elegibilidade do operador (passo 5 da RPC, antes da mutação) detecta perda de privilégio e aborta com `42501`. |
| **C3** | **Replay Simultâneo do Mesmo Comando** | Conexão A obtém `pg_advisory_xact_lock(hashtext(v_user_id), hashtext(p_command_id))`, executa efetivamente a chamada RPC `restore_church_member`, gerando o recibo em `command_receipts`, e comita. | Conexão B dispara `restore_church_member` com o mesmo `p_command_id` e parâmetros idênticos. | Conexão B fica retida no advisory lock transacional de A. Ao acordar pós-commit, consulta o recibo efetivamente gerado por A e retorna replay seguro idêntico sem reexecutar mutação nem duplicar auditoria. |
| **C4** | **Falha Forçada em Auditoria com Rollback Atômico** | Conexão A dispara restauração simulando falha em `audit_entries` (via gatilho temporário de erro com código `XX000`). | Conexão B observa atomicidade após o rollback de A. | A transação inteira de A sofre rollback. Conexão B comprova que o membro permaneceu `inactive`, nenhuma linha de auditoria subsiste e nenhum recibo foi gerado. |
| **C5** | **Invariância de Acesso Revogado em `church_access`** | Conexão A restaura membro inativo cujo vínculo em `church_access` possui `status = 'revoked'`. | Conexão B (observadora) consulta o membro e o vínculo após o commit de A. | O membro passa a `status = 'active'`. O registro correspondente em `church_access` permanece estritamente com `status = 'revoked'`. O recibo retorna `has_revoked_access = true`. Nenhum login ou acesso à igreja é concedido. |

---

## 4. Detalhamento Operacional dos Checkpoints

### 4.1 Cenário C1.A (Disputa Concorrente de Revisão $T_0 \to T_1$)
1. **Ponto de Partida:** Membro alvo $M$ possui `status = 'inactive'` e revisão atual $T_0 = \text{2026-10-14T18:00:00.000000Z}$.
2. **Terminal 1 (Conexão A):**
   ```sql
   BEGIN;
   -- Simula início de transação concorrente retendo lock de linha no membro alvo
   SELECT id FROM app_private.members WHERE id = '$M_ID' FOR UPDATE;
   ```
3. **Terminal 2 (Conexão B):**
   ```sql
   -- Dispara chamada RPC com a revisão original T0
   SELECT * FROM public.restore_church_member('$CHURCH_ID', '$CMD_B', '$M_ID', '$T0');
   -- Sessão B bloqueia no SELECT ... FROM app_private.members FOR UPDATE aguardando a linha de A
   ```
4. **Coordenador:** Verifica via `SELECT pg_blocking_pids($B_PID);` que B está retido por A.
5. **Terminal 1 (Conexão A):**
   ```sql
   -- Conexão A atualiza dados cadastrais sem alterar o status inativo do membro,
   -- avançando a revisão updated_at para T1 via gatilho monotônico
   UPDATE app_private.members
   SET display_name = 'Nome Atualizado Concorrente'
   WHERE id = '$M_ID';
   COMMIT;
   ```
6. **Terminal 2 (Conexão B):**
   - Desbloqueia imediatamente pós-commit de A.
   - Lê a linha atualizada do membro: constata que `status` permanece `'inactive'`.
   - Passa pela checagem de status, mas na validação de concorrência otimista detecta `v_current_updated_at_str` ($T_1$) $\ne$ `p_expected_updated_at` ($T_0$).
   - Aborta imediatamente com SQLSTATE `P0019`:
     *"O cadastro foi modificado por outro operador. Atualize a listagem e tente novamente."*
   - *Nota de Isolamento:* Esse desenho isola rigorosamente o conflito de revisão otimista, sem confundi-lo com a recusa anterior por membro já `active`.

### 4.2 Cenários C1.B (E17 Aprovado — Concessão Concorrente de Acesso Ativo Durante a Espera)

> [!NOTE]
> **Nota de Governança e Metodologia:**
> A criação ou reativação de um registro em `church_access` com `status = 'active'` para um membro inativo constitui estritamente **manutenção de teste em dados e ambiente especificamente autorizados posteriormente**, simulando o estado legado de inconsistência para comprovar a corrida concorrente. O ensaio verifica a eficácia da guarda de acesso; não libera retorno de acesso no produto nem altera as regras ordinárias de convites de 011 (que vedam expressamente emissão de convite para membros com `status <> 'active'`). O SQL de produção em `013_member_lifecycle.sql` não é invertido para adaptar o teste; o teste reflete fielmente a ordem canônica da RPC (bloqueio de `church_access` antes de `members`).

#### 4.2.1 Cenário C1.B.1 (Ausência Total de Linha Prévia em `church_access`)

1. **Ponto de Partida:**
   - Membro alvo $M$ possui `status = 'inactive'` e revisão atual $T_0$.
   - Não existe qualquer linha em `app_private.church_access` para `$M_ID` nesta igreja.
2. **Terminal 1 (Conexão A - Administrador):**
   ```sql
   BEGIN;
   -- Conexão A retém lock de linha no membro alvo em members
   SELECT id FROM app_private.members
   WHERE church_id = '$CHURCH_ID' AND id = '$M_ID'
   FOR UPDATE;
   ```
3. **Terminal 2 (Conexão B - Administrador 2):**
   ```sql
   -- Dispara chamada RPC restore_church_member para o membro M sob revisão T0
   SELECT * FROM public.restore_church_member('$CHURCH_ID', '$CMD_B', '$M_ID', '$T0');
   ```
   *Comportamento da RPC em B:* O passo 3 executa `perform 1 from app_private.church_access ... for update` (não encontra nenhuma linha, logo não retém lock em acesso). Em seguida, tenta `select ... from app_private.members ... for update` e entra em espera bloqueado na linha de `members` retida por A.
4. **Coordenador:**
   - Comprova que B está retido por A via `SELECT pg_blocking_pids($B_PID);`.
   - B aguarda comprovadamente a liberação do lock de linha de `members`.
5. **Terminal 1 (Conexão A) — Mutação de Teste durante a Espera Comprovada:**
   Enquanto B aguarda retido pelo lock de `members`:
   ```sql
   -- Insere vínculo de acesso ativo simulando estado legado por manutenção autorizada
   INSERT INTO app_private.church_access (
     church_id, user_id, member_id, is_admin, status,
     onboarding_completed_at, granted_by_user_id, granted_at, created_at, updated_at
   ) VALUES (
     '$CHURCH_ID', '$USER_M_ID', '$M_ID', false, 'active',
     statement_timestamp(), '$ADMIN_A_ID', statement_timestamp(), statement_timestamp(), statement_timestamp()
   );
   -- Não altera a tabela members (preserva status = 'inactive' e revisão T0)
   COMMIT;
   ```
6. **Terminal 2 (Conexão B):**
   - Desbloqueia após o commit de A e obtém o lock de linha em `members`.
   - Valida que `status` do membro permanece `'inactive'` e `updated_at` permanece $T_0$.
   - Passa sem erro pelas checagens de status e concorrência de revisão.
   - Executa a consulta real do passo 4 de `013_member_lifecycle.sql`:
     ```sql
     select exists (
       select 1
       from app_private.church_access ca
       where ca.church_id = p_church_id
         and ca.member_id = p_member_id
         and ca.status = 'active'
     ) into v_has_active_access;
     ```
   - Como o commit de A precedeu essa checagem, a consulta pós-lock em `church_access` enxerga a linha comitada.
   - Constata `v_has_active_access = true` e aborta com SQLSTATE `P0018`:
     *"Membro possui vínculo ativo legado nesta igreja. Restauração bloqueada."*
7. **Protocolo de Reversão:**
   - Em base autorizada: remover a linha criada em `church_access`, preservando o histórico e os dados originais do laboratório.

#### 4.2.2 Cenário C1.B.2 (Com Linha `revoked` Existente em `church_access`)

> [!WARNING]
> **Prevenção de Deadlock de Teste:**
> A RPC `restore_church_member` adquire locks na ordem canônica estrita: `church_access` antes de `members`. Se a Conexão A retivesse `members` primeiro e depois tentasse alterar `church_access` enquanto B bloqueasse em `church_access`, ocorreria deadlock entre as duas sessões. Para evitar interdependência circular, a Conexão A bloqueia os recursos exatamente na mesma ordem da aplicação.

1. **Captura e Isolamento:**
   - Em ambiente e dados fictícios especificamente autorizados posteriormente, capturar acesso `revoked` completo, membro `inactive`/revisão $T_0$ e identidades dos administradores elegíveis.
   - Alvo e operadores são rigorosamente distintos (`$M_ID` $\ne$ `$ADMIN_A_ID` $\ne$ `$ADMIN_B_ID`).
2. **Terminal 1 (Conexão A - Administrador):**
   A inicia a transação e retém primeiro o acesso do alvo, depois o membro, na mesma ordem da RPC:
   ```sql
   BEGIN;
   SELECT id FROM app_private.church_access
   WHERE church_id = '$CHURCH_ID' AND member_id = '$M_ID'
   FOR UPDATE;

   SELECT id FROM app_private.members
   WHERE church_id = '$CHURCH_ID' AND id = '$M_ID'
   FOR UPDATE;
   ```
3. **Terminal 2 (Conexão B - Administrador 2):**
   ```sql
   -- Dispara restore_church_member com os parâmetros originais
   SELECT * FROM public.restore_church_member('$CHURCH_ID', '$CMD_B', '$M_ID', '$T0');
   ```
   *Comprovação de Barreira:* Coordenador comprova via `SELECT pg_blocking_pids($B_PID);` que B está retido por A **especificamente na linha de `church_access`**, antes de obter o membro.
4. **Terminal 1 (Conexão A) — Mutação de Teste durante a Espera:**
   A altera a linha de acesso por manutenção de teste autorizada, com os campos válidos exigidos, sem alterar status/revisão do membro:
   ```sql
   UPDATE app_private.church_access
   SET status = 'active',
       onboarding_completed_at = statement_timestamp(),
       granted_by_user_id = '$ADMIN_A_ID',
       granted_at = statement_timestamp(),
       revoked_at = null,
       revoked_by_user_id = null,
       updated_at = statement_timestamp()
   WHERE church_id = '$CHURCH_ID' AND member_id = '$M_ID';
   -- Preserva app_private.members inalterada (status = 'inactive', revisão T0)
   COMMIT;
   ```
5. **Terminal 2 (Conexão B):**
   - B desbloqueia após o commit de A, obtém a linha de acesso e depois a linha de membro.
   - Revalida autorização administrativa do operador B e precondições de `members`.
   - Na consulta de guarda de acesso pós-lock (passo 4 da RPC), detecta `status = 'active'` recém-comitado e recusa a operação com SQLSTATE `P0018`:
     *"Membro possui vínculo ativo legado nesta igreja. Restauração bloqueada."*
   - Comprovar que não houve mutação em `app_private.members`, nenhuma auditoria de restauração foi inserida em `audit_entries` e nenhum recibo de B foi gerado em `command_receipts`.
6. **Protocolo de Reversão:**
   - Restaurar o estado de manutenção com plano aprovado, preservando o registro completo, histórico e dados existentes (reverter `status = 'revoked'` com os metadados originais de revogação `revoked_by_user_id` e `revoked_at`).
   - Note-se que eventual `ROLLBACK` de B não desfaz o `COMMIT` já consolidado de A.
   - Nenhuma execução é autorizada agora.

### 4.3 Cenário C2 (Autorização Perdida na Fila)
1. **Ponto de Partida:** Operador A é administrador titular elegível; Operador B é administrador auxiliar. O vínculo de A permanece ativo e inalterado.
2. **Terminal 1 (Conexão A):**
   ```sql
   BEGIN;
   SELECT id FROM app_private.members WHERE id = '$M_ID' FOR UPDATE;
   ```
3. **Terminal 2 (Conexão B - Operador Admin B):**
   ```sql
   SELECT * FROM public.restore_church_member('$CHURCH_ID', '$CMD_B', '$M_ID', '$T0');
   -- Bloqueia aguardando members FOR UPDATE de A
   ```
4. **Terminal 1 (Conexão A):**
   ```sql
   -- Revoga o vínculo de acesso do Operador B com metadados exigidos pelo esquema 001
   UPDATE app_private.church_access
   SET status = 'revoked',
       revoked_by_user_id = '$ADMIN_A_ID',
       revoked_at = statement_timestamp(),
       updated_at = statement_timestamp()
   WHERE church_id = '$CHURCH_ID' AND user_id = '$USER_B_ID';
   COMMIT;
   ```
5. **Terminal 2 (Conexão B):**
   - Desbloqueia após o commit de A.
   - Passo 5 da RPC avalia elegibilidade atual de Admin B.
   - Detecta `status = 'revoked'` e aborta com `42501`: *"Acesso administrativo não autorizado nesta igreja."*

### 4.4 Cenário C3 (Replay Simultâneo com Advisory Lock)
1. **Terminal 1 (Conexão A):**
   ```sql
   BEGIN;
   -- Adquire advisory lock transacional pelo par (user_id, command_id)
   SELECT pg_advisory_xact_lock(hashtext('$USER_ID'), hashtext('$CMD_REPLAY'));
   ```
2. **Terminal 2 (Conexão B):**
   ```sql
   SELECT * FROM public.restore_church_member('$CHURCH_ID', '$CMD_REPLAY', '$M_ID', '$T0');
   -- Bloqueia aguardando advisory lock de A
   ```
3. **Terminal 1 (Conexão A):**
   ```sql
   -- Conexão A executa efetivamente a restauração para gravar recibo real em command_receipts
   SELECT * FROM public.restore_church_member('$CHURCH_ID', '$CMD_REPLAY', '$M_ID', '$T0');
   COMMIT;
   ```
4. **Terminal 2 (Conexão B):**
   - Desbloqueia após o commit de A.
   - Consulta prioritária em `app_private.command_receipts` localiza o recibo gerado por A.
   - Valida correspondência de `params_hash` e revalida elegibilidade administrativa.
   - Retorna os dados do recibo existente com sucesso idêntico, sem duplicar linhas em `members` ou `audit_entries`.

---

## 5. Diretrizes de Ambiente, Preservação do Laboratório e Limpeza

1. **Preservação Estrita do Laboratório e Piloto:**  
   É terminantemente vedada qualquer alteração, exclusão destrutiva ou descarte que afete contas de laboratório, instâncias de teste, evidências coletadas, pilotos Supabase ou ambientes de homologação existentes.
2. **Execução Futura Sob Autorização Expressa:**  
   Qualquer ensaio físico concorrente permanece expressamente condicionado à autorização prévia e formal do responsável técnico, com identificação explícita do ambiente de destino.
3. **Mecanismo de Descarte Exclusivo e Opcional:**  
   A instrução `dropdb` NÃO constitui regra geral ou obrigatória do projeto. O descarte integral de banco de dados é estritamente uma opção aplicável apenas a uma **base nova, isolada e descartável especificamente autorizada para essa finalidade**. Em ambientes existentes de homologação ou laboratório compartilhado, utilizam-se transações controladas com `ROLLBACK` ou scripts de reversão idempotentes devidamente aprovados.
