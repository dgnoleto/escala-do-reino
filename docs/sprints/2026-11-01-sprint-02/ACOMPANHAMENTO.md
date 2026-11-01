# Sprint 2 — acompanhamento

Abertura documental preparada em **31/10/2026** para vigência a partir de **01/11/2026**, conforme decisão expressa do responsável pelo produto. Este documento concentra abertura, decisões de planning, acompanhamento e futuro encerramento da **Sprint 2**.

Estado atual do registro em **31/10/2026**: **6 issues selecionadas pelo responsável e transferidas pelo orquestrador para a `Sprint 2` no Project (`#28`, `#29`, `#30`, `#51`, `#57` e `#58`) — objetivo, capacidade, prioridades e ordem de execução permanecem pendentes de planejamento**. A associação à sprint não autoriza execução paralela de todas as frentes.

Atualização vigente em **01/11/2026**: o responsável definiu capacidade e ratificou o foco nas seis issues herdadas, com sequência de tratamento e sem inclusão de novas issues até sua conclusão. O planejamento deliberado está na seção 2.2; os registros de 31/10 abaixo permanecem como histórico datado. Estimativas do esforço restante por entrega ainda não foram produzidas.

## 1. Calendário e fonte

| Informação | Referência conferida |
|---|---|
| Project | [Plataforma do Reino](https://github.com/users/dgnoleto/projects/2) |
| Campo | Sprint, tipo Iteration |
| Iteração | Sprint 2 |
| Início | 01/11/2026 |
| Duração | 15 dias inclusivos (escolha expressa do responsável) |
| Término inclusivo | 15/11/2026 |
| Fuso da rotina | America/Sao_Paulo |
| Janela para alerta de planning seguinte | 14 e 15/11/2026, nas conversas pertinentes |
| Verificação de encerramento/transição | A partir de 16/11/2026, na primeira conversa pertinente |
| Referência do ciclo anterior | [Sprint 1 — Piloto (18 a 31/10/2026)](../2026-10-18-sprint-01-piloto/ACOMPANHAMENTO.md) |

Período cadastrado e conferido no GitHub Project pelo orquestrador, sob autorização expressa do responsável, em `31/10/2026` (`01 a 15/11/2026`, 15 dias inclusivos). As rotinas de alerta, capacidade e fechamento seguem o [guia de trabalho no GitHub](../../operacao/GUIA-TRABALHO-GITHUB.md) e os modelos de [planning](../../modelos/sprints/PLANNING.md) e [encerramento](../../modelos/sprints/ENCERRAMENTO.md).

## 2. Planejamento (Planning) e seleção de escopo

- **Retrato da abertura inicial em 31/10/2026 (preservado):** na abertura inicial deste documento em `31/10/2026`, o objetivo, a capacidade e o compromisso de issues encontravam-se pendentes de deliberação, figurando as seis pendências do corte de fechamento da Sprint 1 (`#58`, `#57`, `#28`, `#29`, `#30` e `#51`) como candidatas sem transferência automática.
- **Atualização datada em 31/10/2026 — Seleção e transferência das 6 issues para a Sprint 2:** por decisão expressa do responsável em `31/10/2026`, as seis pendências da Sprint 1 foram selecionadas para a **Sprint 2** e transferidas no GitHub Project pelo orquestrador (operação já executada e conferida no Project), mantendo seus status (`Em revisão`: [`#28`](https://github.com/dgnoleto/escala-do-reino/issues/28), [`#29`](https://github.com/dgnoleto/escala-do-reino/issues/29), [`#30`](https://github.com/dgnoleto/escala-do-reino/issues/30), [`#51`](https://github.com/dgnoleto/escala-do-reino/issues/51) e [`#57`](https://github.com/dgnoleto/escala-do-reino/issues/57); `Em andamento`: [`#58`](https://github.com/dgnoleto/escala-do-reino/issues/58)), corpos, critérios, títulos, comentários e estados preservados.
- **Controle de WIP:** a associação das seis issues à `Sprint 2` **não autoriza execução paralela de todas as frentes** (conforme [`AGENTS.md`, seção 1.7](../../../AGENTS.md#17-rastreabilidade-por-issue-e-paridade-contratual)).
- **O que permanece pendente de planejamento:**
  - **Objetivo detalhado da Sprint 2:** *pendente de definição pelo responsável*.
  - **Capacidade conhecida, prioridades e ordem de execução:** *pendentes de definição pelo responsável* (considerando dependências técnicas, implementação, testes, revisão independente e aceite).
- **Modo de acompanhamento do PO/PM:** visão Kanban geral do Project (a visualização não altera os campos individuais das issues).

### 2.1 Issues selecionadas e transferidas para a Sprint 2 (Conferidas no Project em 31/10/2026)

As seis issues abaixo — que compunham as pendências do corte de fechamento da [Sprint 1 — Piloto](../2026-10-18-sprint-01-piloto/ACOMPANHAMENTO.md) — estão **selecionadas e vinculadas à `Sprint 2`** no Project desde `31/10/2026`, preservando expressamente a paridade contratual, as auditorias estáticas e os ensaios já aceitos dos candidatos `023a / 023b / 025`:

| Issue na Sprint 2 | Status conferido no quadro (31/10/2026) | Estado técnico herdado e aceites preservados | Verificações ainda pendentes para conclusão | Alcance do bloqueio e condição de liberação | Situação na Sprint 2 (31/10/2026) |
|---|---|---|---|---|---|
| [#58](https://github.com/dgnoleto/escala-do-reino/issues/58) — [Infra][Gate 3 SQL 024] Reconciliar baseline e comprovar recuperação do laboratório | **Em andamento** (`bloqueado`) | Critério 4 (backup lógico e restauração no laboratório, ensaio `20261026-050840`) aceito em 26/10/2026; ensaio sequencial reversível (`023a + 023b + 025`) sob `ROLLBACK` em `escala_rehearsal_024` (S01–S10) aceito em 25/10/2026; R1/R6 documentalmente suficientes e R2–R5 atendidos editorialmente. | (a) Fechamento documental de R7 (exclusão de escritores/isolamento), (b) reconciliação integral de objetos/Storage/ACLs (Linha 2A parcial), (c) homologação de PowerShell 7.4+ quando exigida e (d) definição de instalação atômica segura sem estado intermediário vulnerável (Gate 3 em **NO-GO**). | **Impede:** ensaios mutantes de Gate 3 e instalações persistentes no laboratório compartilhado que dependam de R7/reconciliação. **Não impede:** deliberações documentais, ensaios isolados sob `ROLLBACK` em bancos descartáveis nem trabalho local desacoplado. **Liberação:** aprovação de R7 e escopo de reconciliação pelo responsável. | **Selecionada e transferida para a Sprint 2** *(prioridade e ordem de execução pendentes de planejamento)* |
| [#57](https://github.com/dgnoleto/escala-do-reino/issues/57) — [Segurança][SQL 025] Hardening de autorização, recibos e locks do planejamento | **Em revisão** (`bloqueado`) | Paridade contratual e auditoria estática do candidato local SQL 025 (1.152 linhas, SHA-256 `48A572FF...`) aprovadas pelo Codex em 24/10/2026; Abordagem 1 de replay ratificada pelo responsável e validada com `023a + 023b + 025` no ensaio monossessão sob `ROLLBACK` em 25/10/2026. | (a) **Instalação atômica segura** da cadeia `023a + 023b + 025` sem janela intermediária com a 5ª função do SQL 023 original (`create_church_event_edition`) vulnerável, (b) **verificação de concorrência/locks** em múltiplas sessões e (c) **integração HTTP/PostgREST e publicação** em commit/PR autorizado. | **Impede:** aplicação persistente de `023/025` em banco compartilhado/piloto e fechamento da `#57`. **Não impede:** preparação do pacote atômico nem ensaios de concorrência em banco descartável autorizado. **Liberação:** validação da instalação atômica (`023a + 023b + 025`), ensaios concorrentes e condições aplicáveis da `#58`. | **Selecionada e transferida para a Sprint 2** *(prioridade e ordem de execução pendentes de planejamento)* |
| [#28](https://github.com/dgnoleto/escala-do-reino/issues/28) — Criar uma edição de culto e designar sua liderança de liturgia | **Em revisão** | UI e contrato inicial no [PR #50](https://github.com/dgnoleto/escala-do-reino/pull/50); paridade contratual, auditoria estática e ensaio monossessão sob `ROLLBACK` (25/10/2026) aceitos para os candidatos `023a` e `023b` (Opção B e diretrizes D1–D7 ratificadas em 24/10/2026). | Com `023a/023b` já aprovados estaticamente e em ensaio monossessão, restam: (a) **instalação atômica segura** com `025`, (b) **verificação de concorrência**, (c) **integração HTTP/aplicação** e (d) refinamento da transferência de liderança durante culto iniciado. | **Impede:** instalação persistente da RPC no banco compartilhado/piloto e homologação final HTTP/UI de `#28`. **Não impede:** especificação do refinamento de transferência de liderança em culto iniciado ou testes locais de UI. **Liberação:** instalação atômica `023a + 023b + 025`, validação concorrente/HTTP e decisão sobre o refinamento funcional. | **Selecionada e transferida para a Sprint 2** *(prioridade e ordem de execução pendentes de planejamento)* |
| [#29](https://github.com/dgnoleto/escala-do-reino/issues/29) — Organizar a programação principal e os serviços paralelos | **Em revisão** | UI, ordenação contígua, antecedência de apoios paralelos, compartilhamento de duração no louvor e detecção de conflitos integrados no [PR #50](https://github.com/dgnoleto/escala-do-reino/pull/50); paridade, auditoria estática e ensaio sob `ROLLBACK` (`023a + 023b + 025`) aceitos. | (a) **Instalação atômica segura** da cadeia `023a + 023b + 025`, (b) **verificação de concorrência** sobre reordenação/programação, (c) **integração HTTP/aplicação** da persistência (`reorder_event_items` e itens) e (d) refinamento da representação de preparação prévia. | **Impede:** homologação final da persistência de programação em banco instalado. **Não impede:** refinamento de contrato/UI de preparação prévia ou testes locais. **Liberação:** instalação segura de `023a + 023b + 025` e validação HTTP/aplicação com edições criadas (`#28`). | **Selecionada e transferida para a Sprint 2** *(prioridade e ordem de execução pendentes de planejamento)* |
| [#30](https://github.com/dgnoleto/escala-do-reino/issues/30) — Conferir duração e publicar a programação conforme a política do evento | **Em revisão** | UI e apuração de durações/políticas `warn` e `block` integradas no [PR #50](https://github.com/dgnoleto/escala-do-reino/pull/50); paridade, auditoria estática e ensaio sob `ROLLBACK` (`023a + 023b + 025`) aceitos para `set_event_duration_policy`, `publish_event_program` e `save_event_program_draft`. | (a) **Instalação atômica segura** da cadeia `023a + 023b + 025`, (b) **verificação de concorrência** na publicação/rascunho, (c) **integração HTTP/aplicação** dessas RPCs e (d) refinamentos de autoridade/rascunhos no corpo da história. | **Impede:** homologação final da publicação e política de duração contra banco instalado. **Não impede:** definição dos refinamentos funcionais ou testes locais de cálculo. **Liberação:** instalação segura de `023a + 023b + 025` e validação integrada HTTP/aplicação após `#28` e `#29`. | **Selecionada e transferida para a Sprint 2** *(prioridade e ordem de execução pendentes de planejamento)* |
| [#51](https://github.com/dgnoleto/escala-do-reino/issues/51) — [Task técnica] Integrar cadastros e planejamento à navegação autenticada da igreja | **Em revisão** | Navegação integrada no [PR #56](https://github.com/dgnoleto/escala-do-reino/pull/56); subissues `#53`, `#54` e `#55` e histórias `#25`, `#26` e `#27` aceitas e encerradas. | Exclusivamente a **integração HTTP/aplicação da aba de planejamento (`#28–#30`)** contra o backend seguro instalado, sem simular persistência quando migrations faltarem. | **Impede:** homologação final da jornada autenticada de planejamento e fechamento integral da `#51`. **Não impede:** operação e manutenção das abas de cadastros já aceitas. **Liberação:** instalação segura de `023a + 023b + 025` e homologação integrada da aba de planejamento (`#28–#30`). | **Selecionada e transferida para a Sprint 2** *(prioridade e ordem de execução pendentes de planejamento)* |

### 2.2 Abertura e planejamento deliberados em 01/11/2026

**Fonte da decisão:** conversa de orquestração de 01/11/2026 entre o responsável pelo produto e ChatGPT (coordenação). O responsável informou sua disponibilidade, ratificou a sequência proposta e decidiu não incluir novas issues até concluir as seis herdadas. Este complemento sucede as pendências de planejamento registradas em 31/10, sem apagar os registros anteriores.

**Objetivo da sprint:** concluir as pendências herdadas de `#58`, `#57`, `#28`, `#29`, `#30` e `#51`, viabilizando a criação, organização e publicação do planejamento de cultos na jornada autenticada, com os critérios de segurança, integração, evidências e aceite de cada issue preservados.

**Escopo decidido:** somente as seis issues já vinculadas à Sprint 2. Novas issues do Backlog, inclusive a candidata `#32` discutida na planning, permanecem fora da sprint até a conclusão das seis herdadas. Após essa conclusão, eventual ampliação depende de capacidade restante e de nova seleção expressa do responsável; não há inclusão automática.

#### Capacidade informada e base de planejamento

Disponibilidade do responsável para acompanhamento, decisões, verificações e aceite; não é estimativa de esforço por issue nem garantia de conclusão. O dia 02/11 é a exceção expressamente informada à rotina de duas horas por dia útil.

| Dias do período inclusivo | Quantidade de dias | Disponibilidade por dia | Total |
|---|---:|---:|---:|
| 01 e 02/11 | 2 | 4 a 6 horas | 8 a 12 horas |
| 03 a 06/11 e 09 a 13/11 | 9 | 2 horas | 18 horas |
| 07, 08, 14 e 15/11 | 4 | 4 a 6 horas | 16 a 24 horas |
| **Total de 01 a 15/11** | **15** | | **42 a 54 horas** |

Usar 42 horas como referência conservadora do planejamento, sem depender das 12 horas adicionais possíveis. A distribuição por entrega, a margem de contingência e a viabilidade do esforço restante continuam a dimensionar, incluindo implementação, testes, revisão independente quando aplicável, homologação e aceite. Não foram atribuídas estimativas ou datas de conclusão fictícias às issues.

#### Prioridade e sequência ratificadas

1. **#58 — ambiente e recuperação:** resolver os bloqueios efetivos de R7/reconciliação e as demais pendências dos critérios vigentes. Distinguir o recorte que libera etapas dependentes do atendimento integral necessário ao encerramento da própria issue; preservar o backup/restore e o ensaio sequencial já aceitos.
2. **#57 — segurança do planejamento:** concluir instalação atômica segura, verificações concorrentes, integração e publicação pertinentes, conforme as dependências e autorizações aplicáveis. Preservar o candidato e os aceites anteriores; nenhum estado intermediário vulnerável pode ser confirmado.
3. **#28 — criação e liderança:** concluir o refinamento pendente e a validação integrada da criação de edições e das permissões de liderança, após as condições técnicas de liberação.
4. **#29 — programação:** concluir o refinamento da preparação prévia e a validação integrada da persistência, reordenação e serviços paralelos, apoiada em #28.
5. **#30 — duração e publicação:** concluir os refinamentos de autoridade/rascunhos e a validação integrada das políticas e da publicação, apoiada em #28 e #29.
6. **#51 — jornada autenticada:** concluir a conferência da navegação e da integração de planejamento #28–#30, reaproveitando suas evidências e as entregas de cadastros já aceitas.

A sequência define prioridade, respeitando as condições de liberação de cada operação; um bloqueio tem alcance delimitado e não invalida evidências ou trabalho independente já autorizado. Manter uma frente complexa por vez, salvo paralelismo expressamente autorizado conforme AGENTS.md. A conclusão das seis é o objetivo escolhido pelo responsável, não um aceite antecipado nem uma previsão técnica comprovada.

#### Critérios de acompanhamento e limites

- Reutilizar os critérios das issues e a matriz da seção 2.1; verificar somente pendências, deltas e consequências demonstradas, sem reabrir aceites por rotina.
- Distinguir revisão estática, mocks, ensaio PostgreSQL sob ROLLBACK, instalação persistente, HTTP/aplicação e aceite funcional. O fechamento de cada issue depende das evidências aplicáveis e da decisão do responsável.
- Registrar neste documento os acontecimentos relevantes, mudanças de capacidade, bloqueios com alcance concreto e decisões, com data e referência, sem relatórios paralelos por comando.
- Esta decisão autoriza a atualização documental da abertura. Não autoriza execução técnica, SQL, alterações de ambiente/dados, commit, push, PR, merge, deploy, fechamento de issues ou novas alterações no Project. As autorizações operacionais conservam seus escopos próprios.
- **Próximo passo de planejamento:** dimensionar apenas o esforço restante das seis issues, começando pelas pendências efetivas de #58, para orientar a execução na sequência ratificada. O dimensionamento não exige refazer auditorias ou ensaios já aceitos e não cria novo critério de aceite.

## 3. Andamento, alertas e decisões do ciclo

| Data | Evento | Situação/decisão | Referência |
|---|---|---|---|
| 31/10/2026 | Abertura documental da Sprint 2 | Período de `01 a 15/11/2026` (15 dias inclusivos) cadastrado e conferido no GitHub Project pelo orquestrador, sob autorização expressa do responsável, em `31/10/2026`. Documento principal criado com objetivo, capacidade e seleção de issues então pendentes de planning e as seis pendências da Sprint 1 listadas inicialmente como candidatas. | Decisão do responsável nesta conversa. |
| 31/10/2026 | Seleção e transferência das 6 pendências para a Sprint 2 | Por decisão expressa do responsável, as 6 issues pendentes do fechamento da Sprint 1 (`#28`, `#29`, `#30`, `#51`, `#57` e `#58`) foram selecionadas para a **Sprint 2** e transferidas/conferidas no Project pelo orquestrador, mantendo seus status (`5 Em revisão`, `1 Em andamento`), corpos, critérios, títulos, comentários e estados preservados. Objetivo, capacidade, prioridades e ordem de execução permanecem pendentes de planejamento; a associação à sprint não autoriza execução paralela de todas as frentes. | Decisão do responsável e conferência do orquestrador em `31/10/2026`. |
| 01/11/2026 | Abertura e planejamento deliberados | Responsável informou 42 a 54 horas de dedicação, com exceção de 4 a 6 horas em 02/11, e ratificou a sequência #58 → #57 → #28 → #29 → #30 → #51. Nenhuma nova issue será incluída antes de concluir as seis herdadas. Escopo e sequência definidos; esforço restante por entrega ainda a dimensionar. | Decisão do responsável nesta conversa; seção 2.2. |

*(Registrar nesta tabela os avisos da janela de 14–15/11/2026, a realização da planning, as decisões de escopo do responsável e as entregas concluídas ao longo do período.)*

## 4. Encerramento do ciclo — ainda não realizado

Estado: **encerramento ainda não realizado** (período vigente de `01/11/2026` a `15/11/2026`; verificação de encerramento a partir de `16/11/2026`).

Quando o ciclo terminar ou o responsável determinar sua consolidação, preencher nesta mesma seção (reaproveitando a estrutura do [modelo de encerramento](../../modelos/sprints/ENCERRAMENTO.md)):

- Resultado frente ao objetivo aprovado na planning;
- Entregas comprovadas (com critérios, PR/versão, método de validação e limites);
- Pendências remanescentes, motivos e grau de certeza;
- Aprendizados técnicos (causa confirmada vs. hipótese);
- Passagem de contexto para a sprint seguinte.
