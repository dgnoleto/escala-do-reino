# Cadastro de Edições de Culto, Programação Litúrgica e Políticas de Duração

Documento normativo e contratual da frente integrada de cadastro e planejamento de eventos (Issues #28, #29 e #30).
Alinhado ao [PRD do Escala do Reino](PRD.md) (§3.2, §5, §6 e §7.7; M05–M06, M24–M26, M28, M39–M40, M47–M50).

---

## 1. Contexto e Conceituação de Domínio

Esta entrega conclui a frente integrada de planejamento e governança litúrgica da aplicação web:

1. **Edição Concreta de Culto (Issue #28):**
   - Criação web de evento com datas e horários previstos de início e término completos.
   - Herança mandatória do fuso horário da igreja (`timezone`).
   - Duração disponível derivada da janela prevista entre início e fim, suportando eventos que cruzam a meia-noite (PRD §6, M48).
   - Designação da liderança da liturgia exclusiva pelo administrador da igreja (`isAdmin`); controlar um evento não concede controle de outro e ser administrador não concede condução automática (PRD §3.2, M05/M40).
   - A criação não inicia a execução do culto (status `scheduled` / `pronto`) nem escala voluntários automaticamente (`roster: []`).

2. **Organização da Programação e Serviços Paralelos (Issue #29):**
   - Reordenação sequencial de atividades na edição concreta sem alterar outras edições nem o modelo de origem.
   - Componentes simultâneos no mesmo bloco de louvor (canto, instrumentos e dança) compartilham a duração do bloco, contando apenas uma vez na sequência principal (PRD §6, M25).
   - Serviços paralelos e apoios técnicos (portaria, sonoplastia, transmissão) não somam novamente na sequência principal do culto (PRD §6, M28).
   - A preparação de serviços de apoio pode começar antes da janela do culto (ex.: preparação 30 min antes do início) e integra o intervalo de ocupação utilizado na verificação de conflitos de escala (PRD §6 e §7.7, M50).
   - Alterações preservam histórico e referências, sinalizando conflitos de escala resultantes sem substituição automática de pessoas por inferência.

3. **Conferência de Duração e Políticas de Publicação (Issue #30):**
   - Exibição de tempo disponível, tempo ocupado pela sequência principal e tempo excedido.
   - **Modo Alerta (`warn`):** Padrão do piloto. Permite salvar e publicar a programação mesmo com excesso de duração, exibindo aviso informativo ignorável sem exigir aprovação ou justificativa obrigatória (PRD §6, M26).
   - **Modo Bloqueio (`block`):** Permite salvar rascunhos da programação a qualquer momento, mas impede terminantemente a publicação da programação ou de revisões enquanto a duração estiver excedida até o devido ajuste (PRD §6, M49).
   - A política de duração e o status da programação (`draft` vs `published`) ficam registrados no evento, preservam a checagem de conflitos e não interferem nem encerram automaticamente o culto durante a execução real.

---

## 2. Critérios de Aceite Consolidados

### Issue #28: Criar uma edição de culto e designar sua liderança de liturgia
- **CA01 — Pertencimento à igreja e datas completas com cruzar de meia-noite:** O evento pertence à igreja selecionada e registra início e fim previstos com datas completas (`timestamptz`); o fim deve ser estritamente posterior ao início, inclusive quando atravessa a meia-noite (ex.: início 23:00 de um dia e término 01:30 do dia seguinte = 150 min).
- **CA02 — Fuso da igreja e duração disponível derivada:** Os horários utilizam o fuso da igreja consultada (`timezone`) e a duração disponível deriva diretamente da janela prevista (`planned_end_at - planned_start_at`).
- **CA03 — Designação exclusiva da liturgia pelo administrador:** Somente administradores da igreja podem designar e alterar a liderança da liturgia da edição; controlar uma edição não concede controle sobre outras e privilégio de administrador não concede condução automática.
- **CA04 — Sem execução nem alocação prematura:** Criar a edição do evento gera status planejado (`scheduled` / `pronto`), sem iniciar o cronômetro do culto nem escalar voluntários automaticamente.

### Issue #29: Organizar a programação principal e os serviços paralelos
- **CA01 — Reordenação e ajuste soberano da edição:** A programação permite ordenar atividades (mover para cima/baixo na sequência) e ajustar a edição específica sem alterar modelos nem outras edições.
- **CA02 — Duração compartilhada no louvor e apoios desvinculados:** Canto, instrumentos e dança no mesmo bloco de louvor compartilham a duração do bloco; serviços de apoio paralelos não somam novamente na sequência principal.
- **CA03 — Preparação antecedente de apoios e ocupação em conflitos:** A preparação de serviços paralelos pode anteceder o início previsto do culto e integra o intervalo de ocupação do voluntário para detecção de conflitos de escala.
- **CA04 — Preservação de integridade e sinalização de conflitos:** Alterações na programação preservam referências e histórico, acusando conflitos de escala sem substituição silenciosa de integrantes.

### Issue #30: Conferir duração e publicar conforme a política do evento
- **CA01 — Apresentação métrica de duração:** Exibir duração disponível, ocupada e excedida sem duplicar blocos simultâneos ou apoios.
- **CA02 — Publicação em modo Alerta (`warn`):** Permite salvar rascunho e publicar normalmente apesar do excesso de tempo, com alerta informativo ignorável.
- **CA03 — Publicação em modo Bloqueio (`block`):** Permite salvar rascunho a qualquer momento, mas rejeita publicar a programação ou revisões excedentes até o ajuste.
- **CA04 — Registro no evento e não bloqueio da execução real:** A política é gravada no evento, preserva conflitos de escala e não encerra nem bloqueia automaticamente o culto em execução.

---

## 3. Estruturas de Dados e Modelo Relacional

### 3.1 Estrutura e Evolução das Tabelas Canônicas

O esquema relacional auditado do módulo de eventos contempla contagens estritas de colunas e relacionamentos canônicos:

- **`app_private.events` (20 colunas canônicas):** tabela principal de eventos da igreja. Contém a chave estrangeira `published_by_member_id` com ação referencial `ON DELETE SET NULL` (`confdeltype = 'n'`) apontando para `app_private.members(id)`.
- **`app_private.event_items` (15 colunas pré-026 / 16 colunas pós-026):** itens da programação litúrgica e técnica. O incremento 026 adiciona estritamente a coluna `prep_required_minutes` (tipo `integer`, não nulo, default `0`). A coluna `sequence_order` não possui restrição de unicidade (`UNIQUE`), sendo a continuidade sequencial garantida pelas RPCs procedurais sob bloqueio exclusivo do evento.
- **`app_private.assignments` (13 colunas canônicas):** alocações de voluntários em itens ou no evento.
- **`app_private.event_planning_receipts` (7 colunas canônicas):** registros de recibos transacionais para garantia de idempotência estrita por `command_id`.

#### 3.1.1 Colunas de `app_private.events`

| Campo | Tipo | Descrição e Invariante |
|---|---|---|
| `id` | `uuid` | Chave primária do evento. |
| `church_id` | `uuid` | FK para `app_private.churches(id)` (isolamento multi-tenant). |
| `title` | `text` | Título da edição (1 a 200 caracteres, normalizado NFC). |
| `event_type` | `text` | Categoria/tipo do evento. |
| `timezone` | `text` | Fuso horário herdado da igreja. |
| `planned_start_at` | `timestamptz` | Data e hora completas de início previsto. |
| `planned_end_at` | `timestamptz` | Data e hora completas de término previsto (`planned_end_at > planned_start_at`). |
| `liturgy_leader_member_id` | `uuid` | FK para `app_private.members` (designação exclusiva de admin). |
| `duration_policy` | `text` | Política de duração: `'warn'` ou `'block'` (default `'warn'`). |
| `program_status` | `text` | Status da programação: `'draft'` ou `'published'` (default `'draft'`). |
| `program_version` | `integer` | Versão sequencial da programação litúrgica (default 1). |
| `published_at` | `timestamptz` | Carimbo de publicação da programação. |
| `published_by_member_id` | `uuid` | Membro autor da publicação da programação. |
| `status` | `text` | Status de execução: `'scheduled'`, `'in_progress'`, `'completed'`, `'cancelled'`. |

### 3.2 Tabela de Recibos de Planejamento (`app_private.event_planning_receipts`)

Garante idempotência transacional por `command_id` para todas as mutações de planejamento e publicação de programação.

### 3.3 Evolução de `app_private.event_items` (Incremento 026 / B2 v1.0)

| Campo | Tipo | Descrição e Invariante |
|---|---|---|
| `prep_required_minutes` | `integer` | Tempo de preparação antecedente em minutos (`0..180`, default 0). |
| *Constraint `ei_prep_minutes_range`* | `CHECK` | `prep_required_minutes >= 0 and prep_required_minutes <= 180`. |
| *Constraint `ei_liturgical_prep_zero`* | `CHECK` | Itens litúrgicos exigem `prep_required_minutes = 0` (`item_nature <> 'liturgical' or prep_required_minutes = 0`). |
| *Constraint `ei_sequence_order_positive`* | `CHECK` | `sequence_order >= 1`. |
| *Invariante de Sequência* | N/A | Ausência semântica e física de índice ou constraint `UNIQUE` em `(event_id, item_nature, sequence_order)` para evitar contenções e conflitos em reordenações. A contiguidade `1..n` é gerida pelas RPCs de mutação sob `SELECT ... FOR UPDATE` no evento pai. |

---

## 4. Contratos de RPCs Públicas (Consolidado com Incremento 026)

### 4.1 Criação de Edição e Liderança (Issue #28)
1. `public.create_church_event_edition(p_church_id, p_command_id, p_title, p_event_type, p_planned_start_at, p_planned_end_at, p_liturgy_leader_member_id, p_duration_policy)`
2. `public.assign_event_liturgy_leader(p_church_id, p_command_id, p_event_id, p_new_liturgy_leader_member_id, p_expected_version)`

### 4.2 Leitura e Listagem de Programação (Issue #29, B2 v1.0)
3. `public.get_event_program(p_church_id uuid, p_event_id uuid)`
   - Leitura estável (`STABLE`), sem recibo e sem auditoria.
   - Devolve `table (event jsonb, items jsonb)`.
   - Exclusivo para administradores e dirigente de liturgia do evento.
   - Itens ordenados deterministamente por natureza (`liturgical` primeiro), `sequence_order`, `created_at` e `id`.
4. `public.list_church_events(p_church_id uuid, p_status_filter text, p_limit integer, p_offset integer)`
   - Estendido no Incremento 026 para retornar: `program_status`, `duration_policy`, `program_version`, `published_at` e `items_count`.

### 4.3 Mutações de Etapas do Cronograma (Issue #29, B2 v1.0)
5. `public.create_event_item(p_church_id, p_command_id, p_event_id, p_title, p_item_nature, p_sequence_order, p_planned_duration_seconds, p_designated_team_id, p_nominal_leader_member_id, p_prep_required_minutes)`
   - Evoluído com argumento `p_prep_required_minutes` (default 0).
   - Serialização com lock exclusivo no evento (`FOR UPDATE`).
   - Mutações restritas a evento `scheduled` e programa `draft`.
   - Autoridade restrita a administrador elegível e dirigente de liturgia do evento (líder de equipe não possui autoridade estrutural).
   - Valida posição entre `1` e `n + 1`, deslocando itens subsequentes da mesma natureza.
6. `public.update_event_item(p_church_id, p_command_id, p_event_id, p_item_id, p_title, p_planned_duration_seconds, p_prep_required_minutes, p_designated_team_id, p_nominal_leader_member_id, p_expected_updated_at)`
   - Altera estrita e exatamente os 5 campos autorizados do item:
     1. título (`title`);
     2. duração planejada em segundos (`planned_duration_seconds`);
     3. tempo de preparação em minutos (`prep_required_minutes`);
     4. equipe designada (`designated_team_id`);
     5. responsável nominal (`nominal_leader_member_id`).
   - Concorrência otimista via `p_expected_updated_at` (conflito retorna `40001`).
   - Captura com `RETURNING updated_at` o timestamp persistido pelo trigger `touch_updated_at` e o devolve no payload/recibo, devendo o cliente capturar este token para uso no próximo `p_expected_updated_at`.
   - Replay idempotente devolve o recibo persistido mesmo se o item tiver sido removido posteriormente; reenvio de mesmo comando com parâmetros divergentes rejeitado com `23505`.
   - Recibo em `event_planning_receipts` e auditoria com snapshot antes/depois.
7. `public.remove_event_item(p_church_id, p_command_id, p_event_id, p_item_id, p_expected_updated_at)`
   - Remoção física estrita no planejamento (evento `scheduled`, programa `draft`, item `pending`).
   - Bloqueio estrito se houver qualquer linha em `app_private.assignments` vinculada ao item (`assignments.item_id = p_item_id`), independentemente do status da alocação (`P0020`).
   - Replay idempotente devolve o recibo persistido mesmo após a exclusão física do item; reenvio de mesmo comando com parâmetros divergentes rejeitado com `23505`.
   - Renumeração contígua dos itens restantes da mesma natureza para `1..n`.

### 4.4 Governança de Programação e Políticas (Issues #29 e #30)
8. `public.reorder_event_items(p_church_id, p_command_id, p_event_id, p_ordered_item_ids)`
   - Restrito a evento `scheduled` e programa `draft`.
   - Exige lista completa e não vazia de todos os itens de uma única natureza, todos no status `pending`.
9. `public.set_event_duration_policy(p_church_id, p_command_id, p_event_id, p_duration_policy)`
   - Restrito a evento `scheduled` e programa `draft`.
10. `public.publish_event_program(p_church_id, p_command_id, p_event_id)`
    - Restrito a evento `scheduled` e programa `draft`.
    - Incrementa `program_version` estritamente na publicação.
    - Publicações repetidas diretas são rejeitadas (exige transição explícita para rascunho antes de nova publicação).
11. `public.save_event_program_draft(p_church_id, p_command_id, p_event_id)`
    - Transição estrita de `published` para `draft`.
    - Preserva metadados da última publicação (`published_at`, `published_by_member_id` e `program_version`).
    - Nenhuma mutação converte automaticamente para rascunho sem esta chamada explícita.

---

## 5. Garantias Operacionais e Governança Técnica (Incremento 026 / B2 v1.0)

### 5.1 Preflight e Verificação Fail-Closed
- **Validação Estrutural Rígida:** Os scripts de pré-condição (`026_event_program_editing.sql`) e pós-condição (`026_verify.sql` e `026_rollback.sql`) são executados com `\set ON_ERROR_STOP on` em blocos procedurais PL/pgSQL anônimos.
- **Contagem Estrita de Colunas:** Verificação exata da contagem de colunas das tabelas do domínio (`events = 20`, `event_items = 15/16`, `assignments = 13`, `event_planning_receipts = 7`).
- **Verificação de Chaves e Integridade:** Validação explícita da integridade referencial de `published_by_member_id` com `confdeltype = 'n'` (`ON DELETE SET NULL`) para `app_private.members`.
- **Ausência de Unicidade em Sequência:** Validação explícita de ausência de restrição ou índice `UNIQUE` cobrindo `sequence_order` nas tabelas do domínio.
- **Allowlist Direta de Privilégios:** Inspeção via `aclexplode(proacl)` garantindo concessão exclusiva de `EXECUTE` para a role `authenticated` e ausência terminante de privilégios para `anon`, `public` (grantee 0) e `service_role`.

### 5.2 Fórmula de Normalização e Fingerprint Canônico (F2)
- Para evitar falsos positivos decorrentes de quebras de linha (`CRLF` vs `LF`) e espaços/tabs nas extremidades da definição de funções em bancos PostgreSQL sob diferentes plataformas, adota-se a fórmula canônica:
  ```sql
  encode(
    pg_catalog.sha256(
      convert_to(
        btrim(
          replace(p.prosrc, E'\r\n', E'\n'),
          E' \t\r\n'
        ),
        'UTF8'
      )
    ),
    'hex'
  )
  ```
- A implementação usa `pg_catalog.sha256` (PostgreSQL 11+), sem dependência da extensão `pgcrypto`.
- Essa normalização garante que pequenas variações nas bordas não invalidem o preflight, mantendo 100% de rigidez na detecção de qualquer alteração interna no corpo das funções.

### 5.3 Idempotência Estrita e Desacoplamento de Concorrência Otimista (F1)
- O protocolo de mutação de itens de programação implementa concorrência otimista via token temporal `expected_updated_at` (retornando `40001` em caso de conflito concorrente).
- Em reenvios idempotentes (mesmo `church_id` e `command_id`), a RPC retorna com sucesso o recibo original persistido caso os parâmetros sejam idênticos, mesmo se o item já tiver sido fisicamente removido posteriormente.
- Se o mesmo `command_id` for reenviado com qualquer parâmetro divergente, a requisição é terminantemente rejeitada com código `23505` (`unique_violation`), precedendo qualquer checagem de concorrência.
- O teste de ensaio de replay pós-exclusão (Caso 8) desacopla expressamente as variáveis `v_update_expected_at_original`, `v_update_persisted_at` e `v_remove_expected_at`, assegurando a perfeita identidade de parâmetros da chamada original.

### 5.4 Procedimento Determinístico de Delta Zero em 7 Momentos (F10)
- O roteiro de ensaio (`026_rehearsal_cases.sql`) estabelece uma metodologia matemática de comprovação de reversibilidade perfeita (Delta Zero):
  1. `M0`: Catálogo e dados antes de qualquer intervenção.
  2. `M1`: Catálogo e dados após execução do instalador `026_event_program_editing.sql`.
  3. `M2`: Catálogo e dados após execução de todas as baterias de ensaio (Casos 1 a 15).
  4. `M3`: Catálogo e dados após limpeza de dados de ensaio.
  5. `M4`: Catálogo e dados após execução do script de rollback `026_rollback.sql`.
  6. `M5`: Catálogo e dados após reinstalação (reaplicação de `026_event_program_editing.sql`).
  7. `M6`: Catálogo e dados após segundo rollback definitivo.
- Critério de aprovação: `M0 == M4 == M6` em catálogo de objetos do domínio e dados canônicos, comprovando ausência de qualquer resíduo, vazamento ou alteração estrutural não revertida.
