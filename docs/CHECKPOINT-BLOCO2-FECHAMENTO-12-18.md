# Checkpoint 4 (Revisado) — Bloco 2: Implementação Integrada da Fonte Real (Incremento 015) e Jornada Operacional

- **Data/Hora:** 2026-10-16 19:55 BRT
- **Contexto:** Execução coordenada aprovada das issues #12 e #18 (`PROMPT-CORRECAO-ANTIGRAVITY.md`, `PARECER-CODEX.md` e `PROMPT-BLOCO2-ANTIGRAVITY.md`).
- **Branch Ativa:** `feat/issue-18-ciclo-vida-membros`
- **Base Git:** Commit `37f7433` (com alterações locais não commitadas no working tree)
- **Hash Canônico Preservado de 013:** `40709A4FE9FEB688D3BE92564B821DCAC4142F6A588E4ACA585D42FBDB964AF7`

---

## 1. Resolução Integral dos Achados de Revisão (B2-01 a B2-06)

### B2-01: Compatibilidade do Recibo de Comandos (`app_private.command_receipts`)
- **Migração em 015:** Aplicado `ALTER TABLE app_private.command_receipts ALTER COLUMN result_member_id DROP NOT NULL;` no script `015_liturgical_dependencies.sql`.
- **Semântica preservada:** As ações de membros continuam gravando `result_member_id`. As novas ações litúrgicas gravam `result_entity_id` com o UUID da entidade afetada (equipe, função, evento, alocação) e `result_member_id` nulo, eliminando o erro de violação NOT NULL (`23502`).
- **Verificação:** Script `015_verify_liturgical_dependencies.sql` atesta expressamente que `result_member_id` é anulável (`is_nullable = 'YES'`).

### B2-02: Entrega dos Caminhos Operacionais e Primeira Jornada de Produto
- **Implementação Completa dos 20 Endpoints RPC em 015:**
  - Equipes: `create_church_team`, `assign_team_leader` (com controle de versão otimista `p_expected_version`), `create_team_role`, `add_team_member`, `remove_team_member`.
  - Aptidões: `grant_member_qualification`, `revoke_member_qualification`.
  - Eventos e Liturgia: `create_church_event`, `assign_event_liturgy_leader`, `start_event_service`, `finish_event_service`, `cancel_church_event`.
  - Escalas: `assign_event_participant`, `replace_event_participant`.
  - Consultas: `list_church_teams`, `list_church_team_roles`, `list_team_members`, `list_member_qualifications`, `list_church_events`, `list_event_assignments`.
- **Primeira Jornada Funcional no Frontend:**
  - Componente `src/components/TeamsPage.jsx`: Listagem real de equipes (`list_church_teams`), cadastro de equipe por administrador, visualização de funções técnicas, integrantes da equipe, inclusão/remoção e transferência de liderança.
  - Integração em `src/components/ChurchHomePage.jsx`: Adicionado cartão de acesso e roteamento `currentView === 'teams'` consumindo o contexto autenticado real.
  - Retenção e recarga sem perda de estado via `savePendingLiturgicalCommand` e `loadPendingLiturgicalCommand`.

### B2-03: Contexto Elegível, Autorização Estrita, Replay e Locks
- **Contexto Ativo em todas as Mutações e Consultas:** Validação unificada de `church_access.status = 'active'`, `members.status = 'active'` e `churches.status = 'active'`.
- **Advisory Lock por Usuário e Comando:** `pg_advisory_xact_lock(hashtext(v_user_id::text), hashtext(p_command_id::text))` aplicado no início de todas as mutações.
- **Replay com Conferência Estrita:** Rejeita qualquer reaproveitamento de `command_id` se a igreja, ação ou hash de parâmetros (incluindo notas e motivos) divergirem (`23505`). Replay idêntico autorizado retorna o recibo existente sem reexecutar.
- **Revalidação sob Locks:** Autoridade do operador (ex: liderança da liturgia ou da equipe) é revalidada após adquirir o lock `FOR UPDATE` da entidade.

### B2-04: Concorrência de Alocação e Substituição, Aptidões e Fronteiras de Condução
- **Alocação (`assign_event_participant`):** Exige vínculo ativo na equipe (`team_memberships`), aptidão ativa homologada se função técnica for informada (`member_qualifications`), rejeita eventos encerrados e bloqueia conflitos de agenda (`P0025`).
- **Substituição (`replace_event_participant`):**
  - Trava a alocação original `FOR UPDATE` e ordena o bloqueio dos membros por ID asc (`LEAST / GREATEST`).
  - Executa UPDATE condicional estrito (`WHERE id = p_assignment_id AND status = 'active'`) e confere contagem de linhas afetadas (`GET DIAGNOSTICS`). Se 0, rejeita com `P0020` prevenindo concorrência de dupla substituição.
  - Fronteira de Condução: em etapas/cultos `in_progress`, a substituição emergencial é reservada com exclusividade ao Líder da Liturgia ou Administrador (`42501`).
- **Preservação de Estados Terminais:** `finish_event_service` e `cancel_church_event` rejeitam eventos já concluídos ou cancelados (`P0020`). Conclusão de culto finaliza etapas em andamento e cancela etapas pendentes de forma determinística (PRD M15).

### B2-05: Validação Estrita de Recibos no Cliente e Contraprovas
- **Função `validateLiturgicalReceipt`:** Confere presença de dados, cardinalidade não-nula, `command_id`, `church_id` e `action`.
- **Resolução das Contraprovas:** Chamadas retornando `null`, `[]` ou recibos com `command_id`/`church_id`/`action` divergentes retornam compulsoriamente status `'UNCERTAIN'` (100% de aprovação na suíte `contraprovas-cliente.test.mjs`: 4/4 PASS).
- **Ciclo de Comandos Pendentes:** Implementados `savePendingLiturgicalCommand`, `loadPendingLiturgicalCommand` e `removePendingLiturgicalCommand`.

### B2-06: Ensaios Transacionais Autocontidos e Roteiro de Concorrência Física
- **`015_validate_liturgical_dependencies.sql`:** Script autocontido executado dentro de `BEGIN ... ROLLBACK;`. Instala temporariamente o candidato, comuta papéis autenticados (`SET LOCAL ROLE authenticated` com `request.jwt.claim.sub`) e exercita as RPCs reais, audit entries, recibos, aptidões, substituição e rejeição de dupla substituição. Zero resíduos no banco.
- **`015_verify_liturgical_dependencies.sql`:** 9 asserções booleanas estritas cobrindo as 7 tabelas operacionais, nulabilidade de `result_member_id`, constraints compostas, triggers, as 20 RPCs com assinaturas exatas, endurecimento e isolamento total de `app_private` (nenhum privilégio direto nas tabelas).
- **Roteiro Físico de Duas Sessões:** Preparados `docs/sql/concurrency/015_concurrency_session_a.sql`, `docs/sql/concurrency/015_concurrency_session_b.sql` e o guia `015_concurrency_rehearsal_guide.md` para execução sob autorização formal.

---

## 2. Acompanhamento pela Matriz de Aceite (`MATRIZ-ACEITE.md`)

| ID | Critério | Situação Real no Bloco 2 | Próximo Passo para Conclusão |
| :--- | :--- | :--- | :--- |
| **M18-01** | Contrato/desenho antes das partes dependentes | **Parcial avançado:** DDL, 20 RPCs, integridade composta, concorrência e tela implementados localmente. | Aguarda execução de ensaio físico e 016. |
| **M18-05** | Servidor valida elegibilidade, permissão, autoexclusão | **Pendente para exclusão efetiva:** Validações prontas em 015 para operações litúrgicas; ciclo efetivo de exclusão de membro aguarda 016. | Implementar 016 (`deactivate_church_member`). |
| **M18-06** | Último administrador protegido sob concorrência | **Pendente para exclusão efetiva:** Regras de 009 e 013 preservadas; teste físico com 016 pendente. | Ensaio físico coordenado em 2 sessões. |
| **M18-07** | Membro/acesso/auditoria/recibo atômicos | **Pendente para exclusão efetiva:** Recibos e auditoria de 015 atômicos; efeito em cascata da exclusão depende de 016. | Implementar 016. |
| **M18-10** | Concorrência sem ciclos/deadlocks | **Pendente para exclusão efetiva:** Eliminação do ciclo no desenho e ordenação de locks pronta; validação física entre alocação e exclusão aguarda 016. | Ensaio físico em 2 sessões após 016. |
| **M18-12** | Dependência futura/em andamento bloqueia; histórico preserva | **Parcial avançado:** Tabelas operacionais, alocações e consultas criadas em 015; integração da consulta de impedimentos no ciclo de membros aguarda 016. | Conectar consultas em 016. |
| **D12-01 a D12-04** | Revisão documental da issue #12 fiel e consistente | **Candidata pronta e preservada:** `docs/REVISAO-CANDIDATA-ISSUE12.md` com 12 seções exatas, pós-MVP preservado na Seção 9 e commit `1c8dbb0` intacto. | Integração e publicação final. |

---

## 3. Evidências de Testes e Limites de Execução Respeitados

- **Execuções de Teste Locais Realizadas com Sucesso:**
  - `test/liturgical-dependencies.test.js`: 30/30 testes (100% PASS)
  - `contraprovas-cliente.test.mjs`: 4/4 testes (100% PASS - 3 falhas anteriores corrigidas)
  - `test/member-lifecycle-cycle.test.js`: 49/49 testes (100% PASS)
  - `test/member-command-cycle.test.js`: 33/33 testes (100% PASS)
  - `test/supabase-client-config.test.js`: 25/25 testes (100% PASS)
  - **Total:** 141 testes automatizados passando com 0 falhas.
- **Build de Produção:** `npm.cmd run build` (Vite v6.4.3) executado com sucesso (0 erros).
- **Limites Estritamente Mantidos:**
  - Nenhum comando SQL executado contra instâncias de laboratório ou piloto.
  - Nenhum contêiner Docker alterado ou reiniciado.
  - Nenhuma dependência externa instalada.
  - Nenhum commit, push, PR, merge ou fechamento de issues realizado nesta etapa.
  - `P0021` preservado em `013_member_lifecycle.sql` (hash canônico `40709A4FE9FEB688D3BE92564B821DCAC4142F6A588E4ACA585D42FBDB964AF7` intacto).
