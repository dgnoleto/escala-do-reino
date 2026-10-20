# Escala do Reino — Validação de Modelos Reutilizáveis de Culto (Issue #27)

**Data:** 18/10/2026  
**Referência:** [Issue #27](https://github.com/dgnoleto/escala-do-reino/issues/27) · [Pull Request #50](https://github.com/dgnoleto/escala-do-reino/pull/50)  
**Branch de trabalho:** `feat/issue-22-editar-nome-igreja`  
**Escopo:** Implementação de modelos reutilizáveis de culto com atividades principais e serviços paralelos/apoios padrão (portaria, sonoplastia, transmissão), preservação da independência das edições (ajuste pontual sem alterar o modelo ou outros eventos), proibição estrita de escala automática de pessoas e preservação do histórico litúrgico.

---

## 1. Resumo da Entrega e Critérios de Aceite

| Critério | Descrição | Status | Evidência |
| :--- | :--- | :---: | :--- |
| **CA01** | O modelo organiza atividades principais e serviços paralelos, permitindo incluir apoios como portaria ou transmissão por padrão | **PASS** | `test/service-templates.test.js` (Cenários 1.2, 1.3, 2.1, 2.2): cadastro de modelos reutilizáveis na Web por administrador autorizado; estruturação de etapas litúrgicas com durações padrão configuráveis (1 a 720 min); inclusão configurável de serviços de apoio padrão (portaria, sonoplastia e transmissão com tempo prévio de preparação de 0 a 180 min); aba dedicada `#tab-admin-templates` em `AdminView.jsx`. |
| **CA02** | Usar o modelo cria uma edição ajustável: retirar transmissão daquela edição não altera o modelo nem outros eventos | **PASS** | `test/service-templates.test.js` (Cenários 1.4, 2.6): instanciação via cópia profunda (*deep clone*) com identificadores próprios; ao retirar a transmissão daquela edição específica (`removeParallelServiceFromEvent` ou `#btn-remove-parallel-service-midia`), o modelo original e outros eventos permanecem 100% inalterados com a transmissão cadastrada por padrão. |
| **CA03** | O modelo não escala, confirma ou reserva pessoas automaticamente | **PASS** | `test/service-templates.test.js` (Cenários 1.5, 2.5): ao carregar ou instanciar o modelo no planejamento de um culto, todas as atividades possuem `roster: []` e `responsibleMemberId: null`; todos os apoios possuem `volunteers: []` e `leaderId: null`; preenchimento nominal estrito posterior pelas lideranças de cada equipe. |
| **CA04** | Alterações no modelo preservam os eventos e o histórico já existentes | **PASS** | `test/service-templates.test.js` (Cenários 1.6, 2.7): modificar etapas ou tempos de um modelo existente não reescreve os dados dos cultos já planejados ou realizados no passado; desativação lógica preserva referências históricas; exclusão física de modelo referenciado em eventos é estritamente bloqueada na aplicação (`canDeleteServiceTemplate`) e no banco (código `23503`), orientando a desativação protetiva. |

---

## 2. Modificações no Código de Produção

1. **Documento Normativo:**
   - [`docs/produto/CADASTRO-MODELOS-CULTO.md`](../produto/CADASTRO-MODELOS-CULTO.md): Contrato técnico de domínio definindo ciclo de vida, invariantes litúrgicas, regras de isolamento e critérios CA01–CA04.

2. **Migração SQL e Ensaio Transacional:**
   - [`docs/sql/022_service_templates.sql`](../sql/022_service_templates.sql):
     - Tabelas `app_private.service_templates`, `app_private.service_template_activities`, `app_private.service_template_parallel_services` e `app_private.service_template_receipts` isoladas por `church_id`.
     - Constraints de integridade: nomes em Unicode NFC, descrições, durações (1–720 min), tempos de preparação (0–180 min).
     - 7 RPCs transacionais seguras: `list_service_templates`, `get_service_template`, `create_service_template`, `update_service_template`, `toggle_service_template_status`, `delete_service_template`, `instantiate_service_template`.
   - [`docs/sql/022_rehearsal_cases.sql`](../sql/022_rehearsal_cases.sql): 20 casos de ensaio (S01 a S20) executados sob `ROLLBACK` validando segurança, idempotência, isolamento e bloqueio de exclusão em uso.

3. **Serviço de Domínio (`src/utils/serviceTemplateService.js`):**
   - Funções puras: `validateServiceTemplate`, `instantiateTemplateForEvent`, `removeParallelServiceFromEvent`, `addParallelServiceToEvent`, `isTemplateUsedInEvents`, `canDeleteServiceTemplate`, `toServiceTemplateObject`.

4. **Sementes de Dados (`src/data/initialData.js`):**
   - `INITIAL_SERVICE_TEMPLATES`: modelos pré-configurados para a congregação ("Culto de Celebração de Domingo (Padrão Completo)" e "Culto de Doutrina e Oração (Sem Transmissão)").

5. **Estado e Auditoria (`src/context/AppContext.jsx`):**
   - Estado reativo `serviceTemplates`.
   - Ações administrativas: `addServiceTemplate`, `updateServiceTemplate`, `toggleServiceTemplateStatus`, `deleteServiceTemplate`, `applyServiceTemplateToEvent`, `removeParallelServiceFromCurrentEvent`.
   - Trilha de auditoria em conformidade com o PRD §10.5.

6. **Interface Administrativa Web (`src/components/AdminView.jsx`):**
   - Nova aba `#tab-admin-templates`: construtor de modelos com etapas litúrgicas, apoios padrão com tempos de preparação, avisos de regras litúrgicas, contadores de caracteres e listagem com edição, ativação/desativação e exclusão protegida.

7. **Interface de Planejamento (`src/components/PlanningView.jsx`):**
   - Seletor `#select-service-template` e botão `#btn-apply-service-template` para aplicar modelos ao culto atual.
   - Seção `#section-parallel-services` exibindo os apoios do culto com botão `#btn-remove-parallel-service-[teamId]` para retirar um apoio (ex: transmissão) exclusivamente daquela edição.

---

## 3. Validação Técnica Executada

1. **Suíte Dedicada de Modelos de Culto:**
   - Comando: `node --test test/service-templates.test.js`
   - Resultado: **13 testes passando** (2 suítes, 0 falhas, duração ~170ms).

2. **Suíte Geral de Testes do Projeto:**
   - Comando: `npm test`
   - Resultado: **423 testes passando** (57 suítes, 0 falhas, 0 pendências, duração ~8.3s).

3. **Build de Produção:**
   - Comando: `npm run build`
   - Resultado: **Vite build aprovado** (`dist/` gerado sem erros de compilação ou bundling).
