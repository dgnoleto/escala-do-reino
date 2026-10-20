# Escala do Reino — Validação de Motivos de Cancelamento de Atividades (Issue #26)

**Data:** 18/10/2026
**Referência:** [Issue #26](https://github.com/dgnoleto/escala-do-reino/issues/26) · [Pull Request #50](https://github.com/dgnoleto/escala-do-reino/pull/50)
**Branch de trabalho:** `feat/issue-22-editar-nome-igreja`
**Escopo:** Manutenção de motivos de cancelamento de atividades na web por administrador autorizado, consumo litúrgico estrito de motivos ativos no console operacional/móvel, preservação da interpretação e histórico de atividades canceladas e ausência de justificativa aberta.

---

## 1. Resumo da Entrega e Critérios de Aceite

| Critério | Descrição | Status | Evidência |
| :--- | :--- | :---: | :--- |
| **CA01** | Lista de motivos mantida na web por administrador; exemplos não são forçados como opções fixas | **PASS** | `test/cancellation-reasons.test.js` (Cenários 1.1–1.3, 2.1–2.4): criação de motivos customizados, edição de nome, desativação, exclusão de motivos sem histórico e bloqueio de usuários não-administradores. Componente `AdminView.jsx` com aba dedicada e contador em tempo real de caracteres (1 a 120, NFC). |
| **CA02** | Cancelamento litúrgico consome apenas motivos ativos; sem cadastro administrativo na tela móvel (M12). Bloqueia cancelamento com alerta explícito se não houver motivos ativos | **PASS** | `test/cancellation-reasons.test.js` (Cenários 1.5, 3.1, 3.2): `LiveConsole.jsx` filtra exclusivamente motivos ativos (`active === true`); bloqueia o cancelamento com `#cancel-reason-empty-alert` se a lista for vazia; ausência de inputs administrativos ou botões de criação rápida na tela litúrgica. |
| **CA03** | Alterar ou desativar motivo preserva interpretação e referências históricas; exclusão física bloqueada para motivos já utilizados | **PASS** | `test/cancellation-reasons.test.js` (Cenários 1.4, 4.1, 4.2): `AppContext.jsx` registra `cancellationReason` (snapshot textual) e `cancellationReasonId` (referência); `canDeleteCancellationReason` e `deleteCancelReason` bloqueiam exclusão física de motivos referenciados em atividades passadas; ensaio transacional `020_rehearsal_cases.sql` (R10 a R15) valida integridade e erro `23503` no banco. |
| **CA04** | Sem relato pessoal detalhado ou justificativa livre no cancelamento operacional | **PASS** | `test/cancellation-reasons.test.js` (Cenários 3.1 e 4.1): modal de cancelamento em `LiveConsole.jsx` restrito estritamente à seleção do motivo e botões de ação ("Voltar" e "Confirmar Cancelamento"), sem campo textarea ou input de texto livre. |

---

## 2. Modificações no Código de Produção

1. **Serviço de Domínio (`src/utils/cancellationReasonService.js`):**
   - `normalizeNfcReason(name)`: trim e normalização em Unicode NFC.
   - `validateCancellationReason(name, existingReasons, currentReasonId)`: validação de obrigatoriedade, tamanho (1 a 120 caracteres) e detecção de duplicidade (case-insensitive e acentuação normalizada na mesma igreja).
   - `isReasonUsedInActivities(reasonId, reasonName, activities)`: verificação de uso histórico por ID e snapshot textual.
   - `canDeleteCancellationReason(reason, activities)`: regra de guarda impedindo a exclusão física caso o motivo tenha sido utilizado no histórico.
   - `getActiveReasons(reasons)`: filtro de motivos ativos para consumo no console operacional.
   - `toReasonObject(raw)`: conversor retrocompatível com suporte a objetos e strings legadas.

2. **Dados Iniciais (`src/data/initialData.js`):**
   - Migração de `INITIAL_CANCEL_REASONS` para coleção estruturada de objetos contendo `id`, `name`, `active: true` e `createdAt`.

3. **Estado Global da Aplicação (`src/context/AppContext.jsx`):**
   - Suporte a `initialUserId` para injeção de perfis em testes automatizados.
   - Gerenciamento de motivos: `addCancelReason`, `updateCancelReason`, `toggleCancelReasonStatus`, `deleteCancelReason` com verificação estrita de autorização de administrador ativo e barreira de proteção de uso em histórico.
   - Operação `cancelActivity(activityIndex, reason, reasonId)`: registro atômico do snapshot textual e do identificador de referência na atividade cancelada e nos registros de auditoria.

4. **Interface Administrativa Web (`src/components/AdminView.jsx`):**
   - Nova aba de administração de **Motivos de Cancelamento** (`#admin-tab-cancel-reasons`).
   - Formulário de novo motivo (`#form-new-cancel-reason`, `#input-new-cancel-reason`, `#btn-add-cancel-reason`) com contador de caracteres (120) e mensagens de validação em tempo real.
   - Lista administrativa com badge de status (Ativo / Inativo), botões de edição inline (`#btn-edit-cancel-reason-*`), ativação/desativação (`#btn-toggle-cancel-reason-*`) e exclusão física (`#btn-delete-cancel-reason-*`) bloqueada e desabilitada se o motivo possuir histórico.

5. **Console Operacional de Culto (`src/components/LiveConsole.jsx`):**
   - Modal de cancelamento litúrgico (`#modal-cancel-activity`) alimentado exclusivamente por motivos ativos (`getActiveReasons`).
   - Alerta de bloqueio (`#cancel-reason-empty-alert`) com desabilitação do botão de confirmação (`#btn-confirm-cancel`) caso não haja motivos ativos cadastrados na igreja.
   - Ausência absoluta de campos de texto livre ou criação administrativa na interface móvel de culto.

6. **Especificação de Contrato e Migração SQL:**
   - Contrato normativo: `docs/produto/CADASTRO-MOTIVOS-CANCELAMENTO.md` especificando modelo relacional, permissões, RPCs públicas e regras de concorrência.
   - Candidato de migração: `docs/sql/020_cancellation_reasons.sql` implementando tabela `app_private.cancellation_reasons`, recibos de comando e RPCs (`list_cancellation_reasons`, `create_cancellation_reason`, `update_cancellation_reason`, `toggle_cancellation_reason_status`, `delete_cancellation_reason`).
   - Ensaio transacional: `docs/sql/020_rehearsal_cases.sql` com 15 casos transacionais sob `ROLLBACK` (R01 a R15).

---

## 3. Validação Técnica Executada

1. **Suíte Dedicada de Motivos de Cancelamento:**
   - Comando: `node --test test/cancellation-reasons.test.js`
   - Resultado: **14 testes passando** (5 suítes, 0 falhas, duração ~75ms).
2. **Suíte Global de Testes do Projeto:**
   - Comando: `npm test`
   - Resultado: **397 testes passando** (48 suítes, 0 falhas, duração ~7.2s).
3. **Build de Produção:**
   - Comando: `npm run build`
   - Resultado: **Vite build concluído com sucesso** (`dist/` gerado sem erros de compilação ou sintaxe).
