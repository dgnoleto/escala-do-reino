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

### 3.1 Evolução de `app_private.events`

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

---

## 4. Contratos de RPCs Públicas

1. `public.create_church_event_edition(p_church_id, p_command_id, p_title, p_event_type, p_planned_start_at, p_planned_end_at, p_liturgy_leader_member_id, p_duration_policy)`
2. `public.assign_event_liturgy_leader(p_church_id, p_command_id, p_event_id, p_new_liturgy_leader_member_id, p_expected_version)`
3. `public.reorder_event_items(p_church_id, p_command_id, p_event_id, p_ordered_item_ids)`
4. `public.set_event_duration_policy(p_church_id, p_command_id, p_event_id, p_duration_policy)`
5. `public.save_event_program_draft(p_church_id, p_command_id, p_event_id)`
6. `public.publish_event_program(p_church_id, p_command_id, p_event_id)`
