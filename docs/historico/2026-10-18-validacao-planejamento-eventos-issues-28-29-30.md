# Escala do Reino — Validação de Planejamento de Eventos, Liturgia e Publicação (Issues #28, #29 e #30)

**Data:** 18/10/2026  
**Referência:** [Issue #28](https://github.com/dgnoleto/escala-do-reino/issues/28) · [Issue #29](https://github.com/dgnoleto/escala-do-reino/issues/29) · [Issue #30](https://github.com/dgnoleto/escala-do-reino/issues/30) · [Pull Request #50](https://github.com/dgnoleto/escala-do-reino/pull/50)  
**Branch de trabalho:** `feat/issue-22-editar-nome-igreja`  
**Escopo Integrado:**
- **Issue #28:** Criação de edições de culto vinculadas à igreja com data/hora de início e término planejados (com suporte à virada de meia-noite), herdando o fuso horário oficial da igreja, com designação de liderança de liturgia exclusiva de administradores sem disparar a execução nem alocar voluntários automaticamente (CA01 a CA04).
- **Issue #29:** Organização da programação principal litúrgica definindo ordem e duração planejada (reordenação contígua para cima e para baixo), configuração de serviços paralelos de apoio com antecedência de preparação (`prepLeadMinutes` / `prepRequiredMinutes`), compartilhamento de duração entre componentes do mesmo bloco sem duplicação na sequência principal, exclusão de apoios paralelos da contagem da liturgia e detecção de conflito de escala considerando a preparação prévia (CA01 a CA04).
- **Issue #30:** Conferência de métricas de duração litúrgica (disponível, ocupada, saldo e excedente) e publicação da programação conforme a política do evento (`warn` permite publicação com aviso se houver excesso; `block` bloqueia publicação se houver excesso, permitindo salvar rascunho; registro da política e status da programação no evento sem alterar a execução real) (CA01 a CA04).

---

## 1. Resumo da Entrega e Critérios de Aceite

### Issue #28: Criar edição de culto e designar sua liderança de liturgia

| Critério | Descrição | Status | Evidência |
| :--- | :--- | :---: | :--- |
| **CA01** | O cadastro da edição registra a igreja, o tipo de evento, a data e a janela prevista de início e término, aceitando cultos que atravessem a meia-noite e herdando o fuso horário oficial da igreja | **PASS** | `test/event-planning.test.js` (Cenários CA01): validação em `calculateAvailableDurationMinutes` e `validateEventEdition` suportando virada de meia-noite (ex.: vigília das 22h às 04h = 360 min); herança direta de `church.timezone` ('America/Sao_Paulo'); modal `#modal-create-event` em `PlanningView.jsx` com campos de data/hora completos. |
| **CA02** | O administrador pode designar a liderança da liturgia para a edição | **PASS** | `test/event-planning.test.js` (Cenários CA02): designação exclusiva de administrador validada em `validateEventEdition`; membros sem privilégios administrativos têm a ação rejeitada com mensagem explicativa; aba de liturgia `#tab-admin-liturgy` em `AdminView.jsx` com seletor de evento `#select-admin-liturgy-event` e botão `#btn-save-admin-liturgy-designation`. |
| **CA03** | O sistema não aceita término anterior ou igual ao início, fuso inconsistente ou campos obrigatórios em branco | **PASS** | `test/event-planning.test.js` (Cenários CA03): rejeição estrita no cliente e no servidor de datas invertidas (`plannedEndAt <= plannedStartAt`), títulos vazios ou com mais de 200 caracteres, e políticas inválidas. |
| **CA04** | A criação da edição não inicia a execução do culto nem atribui voluntários automaticamente nas escalas | **PASS** | `test/event-planning.test.js` (Cenários CA04): `createEventEditionObject` inicializa status `'pronto'`/`'scheduled'`, `programStatus: 'draft'`, com todas as atividades contendo `responsibleMemberId: null` e `roster: []`, e apoios com `volunteers: []` e `leaderId: null`. Total isolamento entre diferentes edições. |

### Issue #29: Organizar a programação principal e os serviços paralelos

| Critério | Descrição | Status | Evidência |
| :--- | :--- | :---: | :--- |
| **CA01** | A programação principal permite ordenar as etapas litúrgicas e definir sua duração planejada | **PASS** | `test/event-planning.test.js` (Cenários CA01): funções `reorderEventActivities`, `moveActivityUp` e `moveActivityDown` garantindo reordenação contígua com preservação de integridade; botões de reordenação `#btn-move-up-[id]` e `#btn-move-down-[id]` renderizados nos cards de atividade de `PlanningView.jsx`. |
| **CA02** | Serviços paralelos podem ser configurados com antecedência de preparação sem inflar a duração da programação principal | **PASS** | `test/event-planning.test.js` (Cenários CA02 e CA03): cálculo de janela em `calculateParallelServiceWindow` com `prepRequiredMinutes` (ex.: início 30 min antes do culto); duração de atividades de apoio paralelo e serviços paralelos são ignoradas no somatório da sequência principal em `calculateProgramDurations`. |
| **CA03** | Componentes do mesmo bloco compartilham a duração sem duplicar a contagem | **PASS** | `test/event-planning.test.js` (Cenários CA03): cálculo litúrgico consolida blocos simultâneos (ex.: cânticos, dança, instrumentos) sem duplicidade, apurando duração líquida e saldo de tempo da liturgia. |
| **CA04** | A alocação de pessoas em serviços paralelos detecta sobreposição com outros compromissos considerando a preparação antecedente | **PASS** | `test/event-planning.test.js` (Cenários CA04): `checkScaleConflictWithParallelPrep` e integração no `checkAssignmentConflict` de `AppContext.jsx` detectam sobreposição física de horários durante a janela de preparação do voluntário escalado. |

### Issue #30: Conferir duração e publicar a programação conforme a política do evento

| Critério | Descrição | Status | Evidência |
| :--- | :--- | :---: | :--- |
| **CA01** | A tela de programação exibe a duração disponível, a soma planejada e o saldo resultante | **PASS** | `test/event-planning.test.js` (Cenários CA01): `calculateProgramDurations` calcula `availableMinutes`, `occupiedMinutes`, `overflowMinutes` e `remainingMinutes`; medidor visual na gauge box de `PlanningView.jsx` com badges contextuais de excesso/saldo. |
| **CA02** | Se a política do evento for "alerta", o sistema avisa sobre estouro de tempo mas permite publicar | **PASS** | `test/event-planning.test.js` (Cenários CA02): `validateProgramPublication` em modo `'warn'` retorna `canPublish: true` com mensagem explicativa de estouro; `publishEventProgram` publica com sucesso atualizando `programStatus: 'published'` e incrementando `programVersion`. |
| **CA03** | Se a política for "bloqueio", o sistema impede a publicação da programação que exceder a janela prevista, permitindo salvar rascunho | **PASS** | `test/event-planning.test.js` (Cenários CA03): em modo `'block'`, `validateProgramPublication` retorna `canPublish: false` com erro explicativo e `publishEventProgram` lança exceção impeditiva; `saveEventProgramDraft` continua plenamente funcional com `programStatus: 'draft'`. |
| **CA04** | A política adotada fica registrada no evento sem alterar a execução real nem conflitar com outras edições | **PASS** | `test/event-planning.test.js` (Cenários CA04): `updateEventDurationPolicy` persiste a política `'warn'` ou `'block'` exclusivamente no evento selecionado; permissão restrita a lideranças autorizadas; a execução litúrgica permanece intacta (`status: 'pronto'`). |

---

## 2. Modificações no Código de Produção

1. **Documento Normativo:**
   - [`docs/CADASTRO-PLANEJAMENTO-EVENTOS.md`](../CADASTRO-PLANEJAMENTO-EVENTOS.md): Contrato técnico unificado cobrindo regras de negócio, invariantes litúrgicas, modelos de dados, isolamento multi-tenant e critérios de aceite de #28, #29 e #30.

2. **Migração SQL e Ensaio Transacional:**
   - [`docs/sql/023_event_planning_and_durations.sql`](../sql/023_event_planning_and_durations.sql):
     - Tabelas `app_private.events`, `app_private.event_items` e `app_private.event_parallel_services` com constraints para datas, políticas de duração (`warn`, `block`) e status da programação (`draft`, `published`).
     - 5 RPCs transacionais sob `SECURITY DEFINER`:
       - `create_church_event_edition`: criação de edições com fuso da igreja e validação de virada de meia-noite.
       - `reorder_event_items`: reordenação em lote da sequência litúrgica.
       - `set_event_duration_policy`: alteração de política por administradores ou líderes de liturgia.
       - `publish_event_program`: validação de regras de bloqueio e publicação com recibo e auditoria.
       - `save_event_program_draft`: persistência de rascunhos em qualquer modo de política.
   - [`docs/sql/023_rehearsal_cases.sql`](../sql/023_rehearsal_cases.sql): 16 cenários de ensaio transacional (P01 a P16) sob `ROLLBACK` cobrindo sucesso, falhas canônicas, bloqueio estrito em `block`, permissão em `warn`, auditoria, recibos e isolamento multi-tenant.

3. **Serviço de Domínio Litúrgico (`src/utils/eventPlanningService.js`):**
   - Funções puras: `normalizeNfcText`, `calculateAvailableDurationMinutes`, `validateEventEdition`, `createEventEditionObject`, `reorderEventActivities`, `moveActivityUp`, `moveActivityDown`, `calculateProgramDurations`, `calculateParallelServiceWindow`, `checkScaleConflictWithParallelPrep`, `validateProgramPublication`, `publishEventProgram`, `saveEventProgramDraft`, `updateEventDurationPolicy`.

4. **Sementes de Dados (`src/data/initialData.js`):**
   - Enriquecimento de `INITIAL_EVENT` com `churchId`, timestamps completos com fuso (`plannedStartAt`, `plannedEndAt`), `timezone: 'America/Sao_Paulo'`, `durationPolicy: 'warn'`, `programStatus: 'published'`, `programVersion: 1`.

5. **Estado Global da Aplicação (`src/context/AppContext.jsx`):**
   - Estados: `events`, `currentEventId`, `event` (selecionado).
   - Ações: `selectEvent`, `createEventEdition`, `reorderActivities`, `moveActivityUpInEvent`, `moveActivityDownInEvent`, `setEventDurationPolicy`, `publishCurrentProgram`, `saveCurrentProgramDraft`.
   - Detecção de conflitos de escala aprimorada para levar em conta a janela de preparação antecedente dos serviços paralelos.

6. **Interface de Planejamento (`src/components/PlanningView.jsx`):**
   - Barra superior com seletor de edições `#select-current-event`, badges de fuso `#badge-event-timezone` e status `#badge-program-status`.
   - Botão `#btn-open-create-event-modal` e modal de criação com suporte a virada de meia-noite e herança de fuso.
   - Botões de reordenação de atividades `#btn-move-up-[id]` e `#btn-move-down-[id]`.
   - Medidor de duração atualizado com duração disponível, ocupada, saldo e seletor de política `#select-duration-policy`.
   - Botões de ação `#btn-save-program-draft` e `#btn-publish-program`, com faixas contextuais de alerta e bloqueio.

7. **Interface Administrativa Web (`src/components/AdminView.jsx`):**
   - Aba de liturgia `#tab-admin-liturgy` com seletor de evento `#select-admin-liturgy-event` e botão `#btn-save-admin-liturgy-designation` para designação pontual de líder por edição.

---

## 3. Validação Técnica Executada

1. **Suíte Dedicada de Planejamento de Eventos:**
   - Comando: `node --test test/event-planning.test.js`
   - Resultado: **21 testes passando** (5 suítes, 0 falhas, duração ~450ms).
   - Cobertura completa de CA01 a CA04 para Issue #28, Issue #29 e Issue #30.

2. **Suíte Geral de Testes do Projeto:**
   - Comando: `npm test`
   - Resultado: **444 testes passando** (62 suítes, 0 falhas, 0 cancelados, 0 pulados, duração ~7.4s).

3. **Build de Produção:**
   - Comando: `npm run build`
   - Resultado: **Vite build aprovado** (`dist/` gerado sem erros de compilação ou bundling em 4.90s).
