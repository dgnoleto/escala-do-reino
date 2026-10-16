# Escala do Reino — Roteiro de Planejamento de Concorrência e Laboratório Reproduzível (013/014)

**Incremento:** Ciclo de Vida de Membros (Listagem Administrativa com Filtros, Restauração Elegível, Recibo Idempotente e Trava Litúrgica P0021)
**Documento Normativo de Planejamento:** `docs/sql/013_concurrency_rehearsal_guide.md`
**Referência Metodológica:** `docs/sql/011_concurrency_rehearsal_guide.md` e `docs/CADASTRO-MEMBROS.md`
**Scripts e Guias Vinculados:**
- Conexão A (Terminal 1 / Bloqueador): [`docs/sql/concurrency/013_concurrency_session_a.sql`](concurrency/013_concurrency_session_a.sql)
- Conexão B (Terminal 2 / Concorrente): [`docs/sql/concurrency/013_concurrency_session_b.sql`](concurrency/013_concurrency_session_b.sql)
- Guia de Instalação e Reversão Exata: [`docs/sql/013_installation_and_rollback_guide.md`](013_installation_and_rollback_guide.md)
- Executor e Validador Automatizado: [`tools/rehearsal-runner-013.js`](../../tools/rehearsal-runner-013.js)
- Roteiro de Navegador com Backend Local: [`docs/ROTEIRO-NAVEGADOR-LOCAL-013.md`](../ROTEIRO-NAVEGADOR-LOCAL-013.md)
- Matriz dos Seis Pontos e Aceite: [`docs/FECHAMENTO-ISSUE18-MATRIZ.md`](../FECHAMENTO-ISSUE18-MATRIZ.md)

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

### Parâmetros de Isolamento e Alvo Autorizado
- **Container Autorizado:** Vinculação estrita ao container existente `supabase_db_escala-convites-http-lab` (porta `55332`, host `127.0.0.1`, database `postgres`). Sem criação de containers, sem fallback remoto e sem alvos arbitrários.
- **Guarda de Alvo no SQL:** Bloqueio preventivo que valida `current_database() = 'postgres'` e exige conexão por loopback local (`127.0.0.1`, `::1`), rede interna do Docker (`172.%`) ou socket unix local, abortando se executado contra IPs de internet ou bancos remotos. Exige codificação UTF-8.
- **Nível de Isolamento:** `READ COMMITTED` padrão do PostgreSQL em ambas as sessões.
- **Identificadores das Conexões:** Conexão A (Terminal 1 — Sessão Bloqueadora / Mutadora) e Conexão B (Terminal 2 — Sessão Concorrente / Disputante).
- **Mecanismo de Barreira e Checkpoint:** Uso de `pg_blocking_pids(pg_backend_pid())` e advisory locks transacionais (`pg_advisory_xact_lock`), com verificação física de bloqueio em loops com timeout controlado e `\set ON_ERROR_STOP on`.

---

## 3. Matriz dos Cenários Concorrentes Planejados

| ID | Cenário | Bloqueador (Conexão A) | Bloqueado / Concorrente (Conexão B) | Checkpoint / Barreira e Desfecho Esperado |
| :--- | :--- | :--- | :--- | :--- |
| **C1.A** | **Disputa Concorrente de Revisão $T_0 \to T_1$** | Conexão A adquire lock em `members FOR UPDATE` do membro inativo sob revisão $T_0$. Atualiza dados cadastrais sem alterar `status = 'inactive'`, avança `updated_at` para $T_1$ via gatilho monotônico e comita. | Conexão B dispara `restore_church_member` com revisão $T_0$. Aguarda na fila de lock de linha de `members` de A. | Conexão B acorda pós-commit de A, lê o membro ainda inativo, mas constata $T_1 \ne T_0$ (`p_expected_updated_at`), e aborta com `P0019`. Isola estritamente a revisão sem acionar a recusa de membro já active. |
| **C1.B.1** | **E17 Aprovado: Sem Linha Prévia em `church_access`** | Conexão A retém lock de linha em `members FOR UPDATE` do membro inativo. Após B realizar lookup sem acesso e bloquear na fila de `members`, A cria o vínculo `status = 'active'` de manutenção de teste (sem alterar `members`), e comita. | Conexão B dispara `restore_church_member` para o membro $M$. Realiza lookup sem acesso e bloqueia aguardando a liberação do lock de linha em `members` mantido por A. | Conexão B acorda pós-espera real em `members`, valida membro `inactive` e revisão $T_0$, e na consulta real `EXISTS` pós-lock em `church_access` detecta o vínculo ativo recém-comitado, abortando com `P0018`. |
| **C1.B.2** | **E17 Aprovado: Com Linha `revoked` Existente em `church_access`** | Conexão A retém primeiro o acesso do alvo (`church_access FOR UPDATE`) e depois o membro (`members FOR UPDATE`), na ordem canônica da RPC. Com B bloqueado na linha de `church_access`, A altera o acesso para `status = 'active'` de manutenção de teste (sem alterar `members`), e comita. | Conexão B dispara `restore_church_member` para o membro $M$. Bloqueia na linha de `church_access` retida por A antes de obter o membro. | Conexão B acorda pós-commit de A, obtém acesso e membro, revalida autorizações e recusa com `P0018`. Comprova-se ausência de mutação de membro, auditoria e recibo de B. |
| **C2** | **Perda de Autorização Administrativa Durante a Espera** | Conexão A (admin titular preservado) retém lock de linha no membro alvo. Enquanto B aguarda na fila, Conexão A revoga o privilégio administrativo do operador de B em `church_access` com metadados completos (`status = 'revoked'`, `revoked_by_user_id`, `revoked_at`) e comita. | Conexão B dispara `restore_church_member` como admin 2 e entra em espera de lock de A. | Conexão B acorda após o commit de A. A revalidação final de elegibilidade do operador (passo 5 da RPC, antes da mutação) detecta perda de privilégio e aborta com `42501`. |
| **C3** | **Replay Simultâneo do Mesmo Comando** | Conexão A obtém `pg_advisory_xact_lock`, captura revisão $T_0$ sob papel de manutenção, comuta para `authenticated` e chama a RPC gerando o recibo em `command_receipts`, e comita. | Conexão B dispara `restore_church_member` com o mesmo `p_command_id` e revisão $T_0$. Bloqueia no advisory lock. | Conexão B fica retida no advisory lock transacional de A. Ao acordar pós-commit, consulta o recibo comitado e retorna replay idêntico. Todos os campos são comparados, confirmando efeito único (1 auditoria, 1 recibo). |
| **C4** | **Falha Forçada em Auditoria com Rollback Atômico** | Conexão A dispara restauração simulando falha em `audit_entries` (via gatilho temporário de erro com código `XX000`). | Conexão B observa atomicidade após o rollback de A. | A transação inteira de A sofre rollback. Conexão B comprova que o membro permaneceu `inactive`, nenhuma linha de auditoria subsiste e nenhum recibo foi gerado. |
| **C5** | **Invariância de Acesso Revogado em `church_access`** | Conexão A restaura membro inativo cujo vínculo em `church_access` possui `status = 'revoked'`. | Conexão B (observadora) consulta o membro e o vínculo após o commit de A. | O membro passa a `status = 'active'`. O registro correspondente em `church_access` permanece estritamente com `status = 'revoked'`. O recibo retorna `has_revoked_access = true`. Nenhum login ou acesso à igreja é concedido. |

---

## 4. Detalhamento Operacional dos Checkpoints

### 4.1 Cenário C1.A (Disputa Concorrente de Revisão $T_0 \to T_1$)
1. **Ponto de Partida:** Membro alvo $M$ possui `status = 'inactive'` e revisão atual $T_0 = \text{2026-10-14T18:00:00.000000Z}$.
2. **Terminal 1 (Conexão A):** Sinaliza prontidão (`holding_c1a`), inicia transação e retém lock de linha no membro alvo com `SELECT id FROM app_private.members WHERE id = '$M_ID' FOR UPDATE;`.
3. **Terminal 2 (Conexão B):** Aguarda prontidão de A, lê revisão $T_0$ antes de comutar papel, comuta para `authenticated` e dispara `restore_church_member`. Bloqueia na linha de `members` retida por A.
4. **Coordenador / Terminal 1:** Verifica via `SELECT pg_blocking_pids($B_PID);` que B está retido por A com timeout controlado.
5. **Terminal 1 (Conexão A):** Atualiza dados cadastrais sem alterar `status = 'inactive'`, avança `updated_at` para $T_1$ via gatilho monotônico e executa `COMMIT;`.
6. **Terminal 2 (Conexão B):** Desbloqueia imediatamente pós-commit de A, lê o membro atualizado ($T_1 \ne T_0$) e aborta com SQLSTATE `P0019`.

### 4.2 Cenários C1.B (E17 Aprovado — Concessão Concorrente de Acesso Ativo Durante a Espera)

#### 4.2.1 Cenário C1.B.1 (Ausência Total de Linha Prévia em `church_access`)
1. **Ponto de Partida:** Membro alvo $M$ (`01300000-0000-4000-8000-0000000000d2`) inativo, sem linha prévia em `church_access`.
2. **Terminal 1 (Conexão A):** Retém lock de linha em `members FOR UPDATE`.
3. **Terminal 2 (Conexão B):** Dispara `restore_church_member`. Não encontra linha em `church_access` e bloqueia aguardando a linha de `members` de A.
4. **Terminal 1 (Conexão A):** Com B comprovadamente bloqueado, insere vínculo ativo em `church_access` para o usuário `01300000-0000-4000-8000-0000000000b2` e executa `COMMIT;`.
5. **Terminal 2 (Conexão B):** Desbloqueia pós-commit de A, obtém a linha de `members`, e na consulta `EXISTS` em `church_access` detecta o vínculo ativo recém-comitado, abortando com SQLSTATE `P0018`.

#### 4.2.2 Cenário C1.B.2 (Com Linha `revoked` Existente em `church_access`)
1. **Ordem Canônica Estrita:** A Conexão A bloqueia primeiro o acesso (`church_access FOR UPDATE`), depois o membro (`members FOR UPDATE`), reproduzindo fielmente a ordem canônica da RPC para prevenir deadlocks.
2. **Terminal 2 (Conexão B):** Dispara `restore_church_member`. Bloqueia na linha de `church_access` retida por A antes de alcançar `members`.
3. **Terminal 1 (Conexão A):** Altera o vínculo para `status = 'active'`, limpando metadados de revogação, e executa `COMMIT;`.
4. **Terminal 2 (Conexão B):** Desbloqueia, revalida autorizações e recusa com SQLSTATE `P0018`.

### 4.3 Cenário C2 (Autorização Perdida na Fila)
1. **Terminal 1 (Conexão A):** Retém lock em `members FOR UPDATE`.
2. **Terminal 2 (Conexão B):** Dispara `restore_church_member` autenticado como Admin B (`01300000-0000-4000-8000-0000000000a2`). Bloqueia em `members`.
3. **Terminal 1 (Conexão A):** Revoga o vínculo de acesso de Admin B com metadados completos de revogação e executa `COMMIT;`.
4. **Terminal 2 (Conexão B):** Desbloqueia pós-commit de A. O passo 5 da RPC avalia a elegibilidade atual do chamador, detecta `status = 'revoked'` e aborta com `42501`.

### 4.4 Cenário C3 (Replay Simultâneo com Advisory Lock)
1. **Captura sob Papel de Manutenção e Sincronização por Advisory Gate:** A revisão $T_0$ de `app_private.members` é obtida sob papel de manutenção **antes** de qualquer comutação para `authenticated`, comitada e disponibilizada. A sincronização de avanço entre A e B é garantida por session-level advisory gates (`gate_c1a`, `gate_c1b1`, `gate_c1b2`, `gate_c2`, `gate_c3`), impedindo que B chame a RPC antes de A adquirir o lock.
2. **Terminal 1 (Conexão A):** Adquire o advisory lock transacional `pg_advisory_xact_lock(hashtext(user_id), hashtext(command_id))`.
3. **Terminal 2 (Conexão B):** Dispara chamada com o mesmo `command_id` e revisão $T_0$. Bloqueia no advisory lock.
4. **Terminal 1 (Conexão A):** Comuta para `authenticated`, executa `restore_church_member` passando $T_0$, reseta o papel e executa `COMMIT;`.
5. **Terminal 2 (Conexão B):** Desbloqueia pós-commit de A, localiza o recibo já gravado por A e retorna replay idêntico.
6. **Comparação Estrita de Campos Reais:** Todos os 6 campos retornados pela RPC (`command_id`, `action`, `church_id`, `result_member_id`, `result_payload`, `created_at`) e os atributos do payload (`status = 'active'`, `restored_at`, `updated_at`) são conferidos entre A e B de forma estrita, sem inventar campos fictícios (`applied_at` ou `is_replay`). Comprova-se efeito único no banco: 1 única mutação em `members`, 1 única entrada em `audit_entries`, 1 único recibo em `command_receipts`.

---

## 5. Diretrizes de Ambiente, Preservação do Laboratório e Limpeza

1. **Preservação Estrita do Laboratório e Piloto:**
   É terminantemente vedada qualquer alteração, exclusão destrutiva ou descarte que afete contas de laboratório, instâncias de teste, evidências coletadas, pilotos Supabase ou ambientes de homologação existentes.
2. **Procedimento Excepcional de Manutenção para Desmontagem das Fixtures:**
   Como a proteção de continuidade do último administrador (`church_access_protect_last_admin` e `members_protect_last_admin`) bloqueia a exclusão ordinária do último administrador da igreja sintética, a limpeza utiliza um procedimento de manutenção formal:
   - **Atenção ao escopo:** `ALTER TABLE ... DISABLE TRIGGER` afeta a tabela inteira (`ACCESS EXCLUSIVE` lock). É mandatório aplicar `SET LOCAL lock_timeout = '5s'`, verificar previamente os gatilhos (`tgenabled = 'O'`), executar em transação ultra-curta e comprovar a reativação.
   - Deleta estritamente os identificadores declarados no manifesto de execução (incluindo `...ac22`).
   - Elimina a tabela efêmera de coordenação (`DROP TABLE IF EXISTS app_private.rehearsal_coordination`).
   - Reativa os gatilhos e valida documentalmente que retornaram ao estado ativo (`tgenabled = 'O'`).
3. **Execução Futura Sob Autorização Expressa:**
   Qualquer ensaio físico concorrente permanece expressamente condicionado à autorização prévia e formal do responsável técnico, com identificação explícita do ambiente de destino.
