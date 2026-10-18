# Escala do Reino — Validação de Tipos de Evento e Atividades com Durações Padrão (Issue #25)

**Data:** 18/10/2026  
**Referência:** [Issue #25](https://github.com/dgnoleto/escala-do-reino/issues/25) · [Pull Request #50](https://github.com/dgnoleto/escala-do-reino/pull/50)  
**Branch de trabalho:** `feat/issue-22-editar-nome-igreja`  
**Escopo:** Manutenção web de tipos de evento e atividades com durações padrão configuráveis por administrador autorizado, isolamento por igreja, integridade referencial sem reescrita silenciosa de cultos históricos ou planejados, bloqueio de exclusão física sob dependências existentes e ausência de controles administrativos no aplicativo móvel.

---

## 1. Resumo da Entrega e Critérios de Aceite

| Critério | Descrição | Status | Evidência |
| :--- | :--- | :---: | :--- |
| **CA01** | Administrador autorizado cadastra e edita tipos e atividades da própria igreja com validação no servidor | **PASS** | `test/event-types-activities.test.js` (Cenários 1.1–1.3, 2.1–2.2): criação e edição de tipos de evento e atividades padrão na aplicação web; validação rigorosa de campos mínimos (1 a 100 caracteres, NFC/trim, unicidade por igreja); bloqueio de membros sem permissão (`42501`); componente `AdminView.jsx` com abas dedicadas `#tab-admin-event-types` e `#tab-admin-activities`. |
| **CA02** | Duração padrão configurável livremente; exemplos de 5, 15 ou 20 minutos não são impostos a todas as atividades | **PASS** | `test/event-types-activities.test.js` (Cenários 1.3, 3.1): permite configurar durações inteiras arbitrárias entre 1 e 720 minutos (exemplos testados: 3, 7, 12, 18, 45, 55, 90, 180 min); rejeição de durações inválidas (<= 0 ou > 720 min); campo numérico dedicado no formulário de atividade padrão. |
| **CA03** | Alterar ou retirar um cadastro preserva referências e histórico existentes, sem reescrever silenciosamente cultos planejados ou realizados | **PASS** | `test/event-types-activities.test.js` (Cenários 1.4, 4.1, 4.2): mutações em tipos ou atividades padrão não reescrevem as atividades ou durações dos eventos já cadastrados; desativação preserva o histórico; exclusão física de tipo ou atividade referenciado em eventos é estritamente bloqueada no banco (erro `23503`) e na aplicação (`canDeleteEventType` e `canDeleteStandardActivity`), orientando o administrador a desativar; exclusão física permitida exclusivamente para cadastros sem dependências. |
| **CA04** | Membros sem permissão não alteram cadastros; não criar controles administrativos próprios do aplicativo Android/iOS | **PASS** | `test/event-types-activities.test.js` (Cenários 2.2, 5.2): `AdminView.jsx` bloqueia acesso a não-administradores exibindo o cartão protetivo de acesso negado sem controles; `PlanningView.jsx` expõe seletor `#select-standard-activity-template` que consome as atividades padrão para preencher a ordem litúrgica preservando a independência da edição concreta. |

---

## 2. Modificações no Código de Produção

1. **Serviço de Domínio (`src/utils/eventTypeActivityService.js`):**
   - `normalizeNfcText(value)`: normalização Unicode NFC e remoção de espaços nas extremidades (`trim`).
   - `validateEventType(name, description, existingTypes, currentId)`: validação de tamanho (1 a 100 caracteres para nome, até 255 para descrição) e detecção de duplicidade por igreja.
   - `validateStandardActivity(name, durationMinutes, category, description, existingActivities, currentId)`: validação de tamanho (1 a 100 caracteres), duração configurável livremente entre 1 e 720 minutos (CA02), categoria e duplicidade.
   - `isEventTypeUsed(type, events)` e `isStandardActivityUsed(activity, activities)`: verificação de uso em eventos passados ou planejados.
   - `canDeleteEventType(type, events)` e `canDeleteStandardActivity(activity, activities)`: guarda contra exclusão física quando houver referências no histórico, instruindo a desativação protetiva.
   - `toEventTypeObject` e `toStandardActivityObject`: adaptadores normalizados de entidades.
   - `eventTypeActivityErrorMessage(error)`: mapeamento amigável de erros SQL (`42501`, `23505`, `23503`, `23514`).

2. **Dados Iniciais (`src/data/initialData.js`):**
   - `INITIAL_EVENT_TYPES`: categorias iniciais da igreja (Celebração Geral, Culto de Doutrina e Oração, Ensaio Geral, Culto de Jovens).
   - `INITIAL_STANDARD_ACTIVITIES`: sementes configuráveis de atividades com durações padrão variadas (5, 7, 8, 10, 25, 45 min) alinhadas às 7 atividades do culto inicial do piloto.

3. **Estado Global da Aplicação (`src/context/AppContext.jsx`):**
   - Estados reativos `eventTypes` e `standardActivities`.
   - Métodos administrativos: `addEventType`, `updateEventType`, `toggleEventTypeStatus`, `deleteEventType`, `addStandardActivity`, `updateStandardActivity`, `toggleStandardActivityStatus`, `deleteStandardActivity`.
   - Todas as operações validam permissão administrativa ativa, geram registros de auditoria com nomes/durações anterior e novo e preservam a integridade dos cultos planejados/realizados.

4. **Interface Administrativa Web (`src/components/AdminView.jsx`):**
   - Duas novas sub-abas administrativas:
     - `event_types` (`#tab-admin-event-types`): cadastro de tipos de evento com contador (100 caracteres), edição inline, ativação/desativação e exclusão protegida.
     - `activities` (`#tab-admin-activities`): cadastro de atividades padrão com duração livre (1 a 720 min), seletor de categoria litúrgica, edição inline, ativação/desativação e exclusão com guarda de histórico.

5. **Interface de Planejamento de Culto (`src/components/PlanningView.jsx`):**
   - Seletor `#select-standard-activity-template` no modal de nova etapa litúrgica, permitindo carregar nome, categoria e duração padrão a partir do cadastro, mantendo a edição do culto livremente ajustável sem alterar o cadastro padrão nem outros eventos (CA02/CA03).

6. **Especificação de Contrato e Migração SQL:**
   - Contrato normativo: `docs/CADASTRO-TIPOS-ATIVIDADES.md`.
   - Candidato de migração: `docs/sql/021_event_types_and_activities.sql` contendo tabelas `app_private.event_types`, `app_private.standard_activities`, recibos de comando `app_private.event_type_activity_receipts`, índices e 10 RPCs públicas de consulta e mutação.
   - Ensaio transacional: `docs/sql/021_rehearsal_cases.sql` cobrindo 20 casos de teste sob `ROLLBACK` (T01 a T20).

---

## 3. Validação Técnica Executada

1. **Suíte Dedicada de Tipos e Atividades:**
   - Comando: `node --test test/event-types-activities.test.js`
   - Resultado: **13 testes passando** (6 suítes, 0 falhas, duração ~130ms).
2. **Suíte Global de Testes do Projeto:**
   - Comando: `npm test`
   - Resultado: **410 testes passando** (54 suítes, 0 falhas, duração ~7.2s).
3. **Build de Produção:**
   - Comando: `npm run build`
   - Resultado: **Vite build concluído com sucesso** (`dist/` gerado sem erros de compilação ou sintaxe).
