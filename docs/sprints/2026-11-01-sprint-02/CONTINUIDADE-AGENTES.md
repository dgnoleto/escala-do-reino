# Continuidade Multiagente — Sprint 2

> **Status em 14/11/2026:** checkpoint histórico de contingência da Sprint 2, preservado para rastreabilidade. Para o estado operacional corrente, consultar [`docs/ESTADO-ATUAL.md`](../../ESTADO-ATUAL.md), o [`ACOMPANHAMENTO.md` da Sprint 2](ACOMPANHAMENTO.md) e o [`ACOMPANHAMENTO.md` da Sprint 3](../2026-11-16-sprint-03/ACOMPANHAMENTO.md). As instruções e pendências datadas abaixo não prevalecem sobre decisões posteriores registradas nesses documentos e nas issues.

## 1. Objetivo

Este documento estabelece o checkpoint oficial de continuidade multiagente para a **Sprint 2** do projeto **Escala do Reino**, permitindo que Claude (como orquestrador secundário convocável) ou outro agente temporário (como Gemini) assuma tarefas delimitadas de especificação, orquestração ou análise sem:

- perder decisões previamente ratificadas pelo responsável humano;
- reabrir discussões técnicas ou evidências empíricas já aceitas;
- confundir revisão estática de código com validação em motor PostgreSQL real;
- presumir ou ampliar autorizações além dos limites expressamente concedidos;
- substituir permanentemente o **ChatGPT** como orquestrador canônico do projeto.

*Nota de governança:* Este documento é estritamente um **checkpoint de passagem e alinhamento de contexto**, e **não constitui autorização operacional prévia** para modificações de código, execução em banco de dados, mutações Git ou ações no GitHub.

---

## 2. Contexto Operacional Informado pelo Responsável

Conforme declaração datada do **responsável pelo produto em 02/11/2026**:
- O indicador de consumo do orquestrador canônico (ChatGPT) atingiu aproximadamente **50% do limite da janela móvel de cinco horas** e aproximadamente **6% do limite semanal** de sua conta.
- O reset semanal da capacidade foi informado como esperado para **04/11/2026**.
- Por contingência e gerenciamento de capacidade da sprint, o responsável poderá contratar **Claude** ou solicitar ao **Gemini** que dê continuidade temporária à orquestração e especificação das próximas etapas.
- O **ChatGPT** continua como membro canônico e orquestrador principal da equipe de IA, não sendo removido do projeto, e retomará a orquestração assim que estiver novamente disponível.

*Delimitação expressa de governança:*
- Esses percentuais constituem **contexto operacional transitório e estimativo informado pelo responsável** humano.
- Não representam métrica técnica do repositório, log auditável de infraestrutura ou garantia contratual de disponibilidade.
- Não devem ser utilizados para estimar esforço restante de entrega, velocidade ou prazos das issues da Sprint 2.

---

## 3. Identidade e Papéis durante a Contingência

A estrutura de papéis definida no [`AGENTS.md`](../../../AGENTS.md) permanece plenamente vigente durante o período de contingência:

1. **Responsável pelo Produto (Humano / Autoridade Final):**
   - Mantém exclusividade sobre todas as decisões de produto, regras de negócio, aprovações de gates e autorizações prévias delimitadas. Nenhuma ação mutável ocorre sem sua ordem expressa.
2. **ChatGPT (Orquestrador Canônico):**
   - Permanece como orquestrador canônico do projeto, temporariamente preservado em seu limite de uso.
3. **Claude (Orquestrador Secundário Convocável):**
   - Atua na orquestração secundária e análise de riscos estritamente quando convocado pelo responsável por contingência, capacidade ou adequação técnica fundamentada.
   - Cumpre as regras comuns: declarar identidade real, interface e modelo confirmado ou “não confirmado”; não se apresentar como outro agente; não herdar autorizações anteriores; não atuar como revisor independente do próprio trabalho; obter autorização específica para banco, Git mutável, publicação, issues e Project; e emitir passagem formal de volta ao ChatGPT ao encerrar a atuação.
4. **Agente Temporário (Gemini ou outro convocado pelo responsável):**
   - Atua na condução temporária e pontual das tarefas específicas atribuídas pelo responsável.
   - Cumpre as regras comuns: declarar identidade real, interface e modelo confirmado ou “não confirmado”; não se apresentar como outro agente; não herdar autorizações anteriores; não atuar como revisor independente do próprio trabalho; obter autorização específica para banco, Git mutável, publicação, issues e Project; e emitir passagem formal de volta ao ChatGPT ou ao responsável ao encerrar a atuação.
5. **Executores Complementares e Revisores Auxiliares (operando via Claude Code ou interfaces autorizadas):**
   - Podem atuar de modo complementar recorrente em tarefas de implementação, diagnóstico, scripts de teste ou revisão auxiliar sob escopo autorizado pelo responsável, não sendo obrigatória sua participação em todas as tarefas.
   - Podem ser propostos por limitação observada, especialização técnica ou divisão útil de trabalho, sem dispensar o Antigravity de sua função de executor principal integrador.
   - Pareceres ou análises emitidos constituem revisão auxiliar interna e não substituem a revisão técnica independente do Codex.
   - Cumprem rigorosamente as regras comuns: declarar identidade real, interface e modelo confirmado ou “não confirmado”; não se apresentar como outro agente; não herdar autorizações antigas; não atuar como revisor independente do próprio trabalho; obter autorização expressa para banco de dados, Git mutável, publicação, issues e Project; e emitir passagem formal com arquivos, hashes e evidências de volta ao Antigravity ao concluir a tarefa.
6. **Antigravity (Executor Principal de Implementação e Testes):**
   - Opera no checkout local para implementar código, executar testes locais autorizados e ensaios técnicos sob instrução formal.
7. **Codex (Revisor Técnico Independente):**
   - Realiza revisões técnicas adversariais e auditorias independentes quando convocado pelo responsável em sessão separada.

---

## 4. Leituras Obrigatórias para Qualquer Agente Temporário

Antes de propor qualquer plano, formular prompt operacional ou emitir parecer, o agente temporário **deve ler obrigatoriamente e diretamente os seguintes documentos, nesta ordem exata**:

1. [`AGENTS.md`](../../../AGENTS.md) — Guia de governança, papéis, verificação de identidade e travas operacionais.
2. [`docs/operacao/FLUXO-MULTIAGENTE.md`](../../operacao/FLUXO-MULTIAGENTE.md) — Procedimentos de Validação de Continuidade Contextual (VCC), gates e repasses.
3. [`docs/operacao/GUIA-TRABALHO-GITHUB.md`](../../operacao/GUIA-TRABALHO-GITHUB.md) — Rastreabilidade por issue, subissues e regras de Projects.
4. [`docs/ESTADO-ATUAL.md`](../../ESTADO-ATUAL.md) — Checkpoints consolidados, histórico de gates e status do projeto.
5. [`docs/sprints/README.md`](../README.md) — Organização, histórico e estrutura das sprints.
6. [`docs/sprints/2026-11-01-sprint-02/ACOMPANHAMENTO.md`](ACOMPANHAMENTO.md) — Abertura, planejamento deliberado e quadro de acompanhamento da Sprint 2.
7. Este [`docs/sprints/2026-11-01-sprint-02/CONTINUIDADE-AGENTES.md`](CONTINUIDADE-AGENTES.md) — Checkpoint de transição e alinhamento multiagente.

*Regra de integridade:* Resumos prévios, transcrições em chat ou inferências de conversas anteriores **não substituem** a leitura direta e literal dos arquivos acima.

---

## 5. Estado Git que Deve Ser Reconfirmado

O último estado verificado no checkout local original em 02/11/2026 é:
- **Branch:** `fix/issue-26-motivos-sem-evento`
- **HEAD:** `8f2c7efb99d363891b6837b993abaeab431cc583`
- **Índice Git:** Rigorosamente limpo (sem arquivos em stage).
- **Working Tree:** Contém alterações locais e arquivos não rastreados preexistentes (incluindo documentos de governança, sprints anteriores e preparações técnicas locais).

*Advertência:* Nenhuma dessas referências deve ser presumida válida no futuro sem conferência explícita via `git branch`, `git rev-parse HEAD` e `git status --short`.

### Situação dos Artefatos da Issue #57 e da Governança (Atualização em 06/11/2026)

Os artefatos relevantes dividem-se em dois grupos com estados distintos de publicação:

1. **Artefatos da Issue #57 (publicados no PR #68, ainda não mesclados à `main`):**
   - Os oito arquivos da entrega da #57 estão commitados na branch remota `fix/issue-57-instalador-atomico` (commit `493848a1c058ca21a4dc250c745cd06470444cc9`) e publicados no [PR #68](https://github.com/dgnoleto/escala-do-reino/pull/68) (aberto contra `main`, sem merge):
     1. `docs/historico/2026-11-02-ensaio-atomico-reversivel-issue-57.md` (exclusivamente o relatório do ensaio reversível T0–T2)
     2. `docs/sql/023a_event_planning_structural.sql`
     3. `docs/sql/023b_event_creation_security_hardening.sql`
     4. `docs/sql/025_event_planning_security_hardening.sql`
     5. `docs/sql/025_atomic_event_planning_installer.sql` (instalador atômico template com preflight, DDLs e pós-condições)
     6. `tools/build-event-planning-atomic-rehearsal.js` (gerador determinístico do payload de ensaio reversível)
     7. `test/event-planning-atomic-install.test.js` (suíte estática do instalador atômico)
     8. `test/event-planning-atomic-rehearsal.test.js` (suíte estática do gerador de ensaio)
   - Os ensaios concorrentes não fazem parte desses oito arquivos: seus registros constam nos comentários de 02/11/2026 na [Issue #57](https://github.com/dgnoleto/escala-do-reino/issues/57), enquanto as evidências brutas concorrentes em `scratch/concurrency-057/` e o banco efêmero `escala_concurrency_057` permanecem locais e preservados no ambiente de laboratório.

2. **Documentação da Governança 1.3 (consolidada localmente, sem push ou PR):**
   - Consolidada localmente no worktree isolado (`docs/governanca-1.3-local-vigente`) no commit `58c01e4493a81217e0935b90e4d411b43a805002` (`58c01e4`), incluindo `AGENTS.md`, `docs/operacao/FLUXO-MULTIAGENTE.md`, versões 1.2 preservadas em `docs/operacao/versoes/` e os checkpoints documentais (`ESTADO-ATUAL.md`, `ACOMPANHAMENTO.md` e `CONTINUIDADE-AGENTES.md`).
   - Ainda **sem push e sem Pull Request** remoto.

*Nota:* As modificações da governança e as entregas técnicas da Issue #57 mantêm trilhas separadas e não devem ser misturadas sem autorização expressa.

---

## 6. Estado Confirmado da Issue #58

- A [Issue #58](https://github.com/dgnoleto/escala-do-reino/issues/58) permanece **pausada por decisão expressa do responsável** e **não pode ser retomada automaticamente**.
- O ensaio reversível do lote SQL 020 (executado anteriormente) não concluiu R7 nem encerrou a issue.
- A reconciliação integral de objetos e tabelas do módulo de **Storage** permanece como fator bloqueante para a conclusão de #58: o esquema `storage` existe no laboratório, mas as tabelas `storage.buckets` e `storage.objects` não estavam presentes na captura de catálogo relevante, sendo requeridas pelas migrações SQL 017 e 019.
- A retomada de #58 depende de decisão e especificação específica do responsável sobre o tratamento de Storage e o fechamento documental de R7.
- O **Gate 3 global e o pacote R7 integral permanecem formalmente em NO-GO**.

---

## 7. Estado Confirmado da Issue #57

- A preparação estática da cadeia SQL 023a + 023b + 025 (instalador atômico e gerador determinístico) foi concluída e aprovada em testes Node.js.
- O ensaio atômico mecânico reversível T0–T2 foi executado em motor PostgreSQL 17.11 real no banco descartável `escala_rehearsal_024` do laboratório local.
- **Decisão humana expressa do responsável sobre T0–T2:** **`APROVADO COM RESSALVAS`** em 02/11/2026.
- **Publicação remota em PR aberto:** os oito arquivos da frente (`docs/historico/2026-11-02-ensaio-atomico-reversivel-issue-57.md`, `docs/sql/023a_event_planning_structural.sql`, `docs/sql/023b_event_creation_security_hardening.sql`, `docs/sql/025_event_planning_security_hardening.sql`, `docs/sql/025_atomic_event_planning_installer.sql`, `tools/build-event-planning-atomic-rehearsal.js`, `test/event-planning-atomic-install.test.js` e `test/event-planning-atomic-rehearsal.test.js`) estão commitados na branch remota `fix/issue-57-instalador-atomico` (commit `493848a1c058ca21a4dc250c745cd06470444cc9`) e publicados no [PR #68](https://github.com/dgnoleto/escala-do-reino/pull/68), que permanece **aberto contra `main`, sem merge**. O arquivo `docs/historico/2026-11-02-ensaio-atomico-reversivel-issue-57.md` é exclusivamente o relatório do ensaio reversível T0–T2. Quando uma tarefa específica da Issue #57 exigir esses artefatos, deve-se consultar o PR #68 e as evidências brutas fornecidas separadamente.
- **Ensaios de concorrência concluídos e reconhecidos como estado válido:** os ensaios concorrentes `C01–C07`, `F1–F5`, `F1′` e `F2′` foram registrados nos comentários de 02/11/2026 na [Issue #57](https://github.com/dgnoleto/escala-do-reino/issues/57) com declaração final de **`ENSAIO DE CONCORRÊNCIA CONCLUÍDO`**. Em **06/11/2026**, o responsável pelo produto confirmou expressamente que o estado remoto no PR #68 e os ensaios concorrentes registrados em 02/11 representam estado válido do projeto (impedindo sua repetição automática, mas sem substituir a revisão técnica independente nem equivaler a aceite final da concorrência ou da #57). As evidências brutas permanecem locais em `scratch/concurrency-057/` e o banco efêmero `escala_concurrency_057` permanece preservado, não podendo ser descartados automaticamente.
- **Estado das revisões técnicas:** a revisão concorrente de 02/11 foi realizada pelo Claude com **independência reduzida**. A **revisão técnica independente do Codex** sobre o PR #68 e sobre as evidências concorrentes permanece **pendente**.
- **Consultas no piloto vs. verificação R4:** a leitura de `pg_roles.rolconfig` no piloto confirmou os timeouts dos papéis. Entretanto, a **verificação R4** sobre a existência das cinco RPCs, cinco colunas e `app_private.event_planning_receipts` no catálogo de objetos do piloto continua distinta e **ainda pendente** (não deve ser declarada concluída).
- Nenhum SQL foi instalado permanentemente no piloto, não houve integração HTTP/PostgREST, o PR #68 não foi mesclado e não houve aceite final da entrega.
- A [Issue #57](https://github.com/dgnoleto/escala-do-reino/issues/57) permanece **aberta**.

### Alcance com aceite humano — T0–T2:
- Processamento mecânico do payload autocontido de 86.423 bytes em transação única no PostgreSQL 17.11;
- Verificação e aprovação das guardas de preflight fail-closed contra baseline limpo;
- Satisfação integral das asserções imperativas de catálogo pós-instalação no bloco `DO`;
- Reversão obrigatória com comando terminal `ROLLBACK;` observado no transcript de 37 linhas;
- Delta zero comprovado no conjunto de catálogos e metadados monitorados entre T0 e T2.

### Evidências concorrentes reconhecidas como estado válido — pendentes de revisão independente:
- Ensaios de concorrência (`C01–C07`, `F1–F5`, `F1′` e `F2′`) registrados nos comentários de 02/11/2026 na Issue #57 (com evidências brutas locais em `scratch/concurrency-057/` e banco efêmero preservado `escala_concurrency_057`);
- Timeouts dos papéis no piloto confirmados via leitura de `pg_roles.rolconfig`;
- O responsável pelo produto confirmou em 06/11/2026 a validade do estado e das evidências registradas, o que **impede repetição automática** dos ensaios concorrentes;
- Essa confirmação de validade **não equivale a revisão técnica independente** e **não equivale a aceite final** da concorrência ou da Issue #57, permanecendo **pendente a revisão técnica independente do Codex**.

### Ressalvas Registradas:
- Em T0–T2: código de saída real do processo `docker exec`/`psql` no sistema operacional indeterminado devido à expansão de `%ERRORLEVEL%` no wrapper do shell;
- Em T0–T2: o transcript de 37 linhas é completo, sem erros textuais e termina em `ROLLBACK;`;
- Em T0–T2: os relatórios de T0 e T2 diferem exclusivamente nas duas linhas voláteis de timestamp e identificação temporal da sessão;
- Em T0–T2: o snapshot monitorado não comprova integridade global de objetos fora do escopo medido;
- Em T0–T2: as cinco RPCs de planejamento não foram chamadas funcionalmente naquela rodada mecânica inicial (sendo exercitadas posteriormente nos ensaios concorrentes `C01–C07`, `F1–F5`, `F1′` e `F2′`);
- Em T0–T2: não houve comprovação de isolamento temporal contínuo contra escritores externos durante todo o ensaio;
- Em T0–T2: os caminhos utilizados em `/tmp` no contêiner não continham identificador temporal exclusivo (embora com integridade criptográfica conferida antes da execução);
- Em T0–T2: não é recomendada a repetição do ensaio apenas para capturar um código de saída de shell;
- Na concorrência de 02/11: revisão realizada pelo Claude com independência reduzida, permanecendo pendente a revisão técnica independente pelo Codex sobre o PR #68 e as evidências concorrentes.

### O que NÃO foi comprovado nem autorizado:
- Nenhuma revisão técnica independente do Codex concluída sobre o PR #68 e as evidências concorrentes;
- Nenhuma conclusão da verificação R4 sobre existência das cinco RPCs, cinco colunas e `app_private.event_planning_receipts` no piloto;
- Nenhuma instalação persistente no piloto;
- Nenhuma validação na camada HTTP/PostgREST ou verificação de recarga via `NOTIFY pgrst`;
- Nenhuma interação ou política de Storage;
- Nenhuma autorização para descarte automático do banco efêmero `escala_concurrency_057` ou das evidências locais em `scratch/concurrency-057/`;
- Nenhum merge do PR #68, homologação funcional de ponta a ponta ou aceite final da Issue #57.

---

## 8. Artefatos Temporários e de Laboratório Preservados

Os artefatos brutos das execuções continuam integralmente preservados para auditoria:
- **Ensaio T0–T2 no Host:** `C:\Users\user\AppData\Local\Temp\escala-rehearsal-57-2026-11-02T09-26-58-948Z\`
  - `025_atomic_event_planning_rehearsal.sql` (86.423 bytes, SHA-256 `91DC01E71CE562F6AB4B32BB59D80884EC580789EEB1C298AA2A0BE25C2C9C2F`)
  - `t0_snapshot.sql` (7.535 bytes, SHA-256 `AC7C5C2320572615A93EB7C96ADB832FE65B8D55B8F0C85D11E82CA4E5C0C8F2`)
  - `t0_output.txt` (157.358 bytes, SHA-256 `063CC55E03EB2BDB89E57D3CB89A614D94B9DF294D4E56B9F81C2E498C6E40C0`)
  - `t1_output.txt` (329 bytes, SHA-256 `180DB707FB7138D12A8CD3C64825FEA3C48EFD21A4826D6D5AED3C47F5025FE6`)
  - `t2_output.txt` (157.358 bytes, SHA-256 `31F9C8C0195E4C2DBC8003B44DADF30CE625F04370E65F6CEDBE89AEF4A185D4`)
- **Ensaio T0–T2 no Contêiner (`supabase_db_escala-convites-http-lab`):**
  - `/tmp/025_atomic_event_planning_rehearsal.sql`
  - `/tmp/t0_snapshot.sql`
- **Ensaios de Concorrência (Locais e Banco Efêmero):**
  - Evidências brutas locais em `scratch/concurrency-057/`
  - Banco efêmero `escala_concurrency_057` preservado no laboratório

*Regras de preservação:*
- Nenhuma limpeza ou descarte foi autorizado pelo responsável;
- É proibido apagar, mover, sobrescrever ou descartar automaticamente qualquer um desses arquivos ou o banco `escala_concurrency_057`;
- Sua existência e integridade devem ser checadas antes de qualquer nova etapa física;
- Arquivos temporários externos não substituem o relatório histórico versionado no PR #68.

---

## 9. Sequência Ratificada da Sprint 2

A ordem oficial de prioridades da Sprint 2, deliberada pelo responsável na planning de 01/11/2026, é estritamente:

1. **#58** — Ambiente e recuperação do laboratório *(pausada)*
2. **#57** — Segurança e hardening do planejamento de eventos *(frente ativa atual)*
3. **#28** — Criação de edições e designação de liderança de liturgia
4. **#29** — Programação principal, apoios paralelos e persistência
5. **#30** — Políticas de duração e publicação de rascunhos
6. **#51** — Integração da jornada autenticada e navegação

*Diretrizes de acompanhamento:*
- O fato de a #58 estar pausada para desbloqueio da #57 **não altera** a sequência canônica nem antecipa issues posteriores.
- Nenhuma issue do Backlog (incluindo a candidata #32) pode ser adicionada à sprint até a conclusão formal das seis herdadas.
- Deve-se manter **uma única frente complexa por vez**.
- É proibido iniciar paralelamente implementações ou ensaios para #28, #29, #30 ou #51 sem autorização expressa e conclusão das dependências prévias.

---

## 10. Próxima Decisão Pendente

Até o presente momento (06/11/2026), **NÃO FORAM AUTORIZADAS** as seguintes operações:
- Push ou abertura de Pull Request do commit local `58c01e4` da governança 1.3;
- Merge do PR #68 da Issue #57;
- Alteração de corpo, comentários ou labels da Issue #57, ou atualização de campos no GitHub Project;
- Limpeza ou descarte dos artefatos temporários, de `scratch/concurrency-057/` ou do banco efêmero `escala_concurrency_057`;
- Instalação permanente de migrações no piloto;
- Configuração ou validação de HTTP/PostgREST;
- Aceite final ou encerramento da Issue #57;
- Retomada da Issue #58.

**Procedimento para o agente que assumir a próxima etapa:**
O agente deve submeter ao responsável pelo produto uma proposta estruturada para a próxima intervenção na Issue #57, discriminando:
1. O **fato comprovado** que encerrou a etapa anterior (PR #68 aberto no commit `493848a`, T0–T2 aprovado com ressalvas, ensaios concorrentes registrados como concluídos e confirmados pelo responsável em 06/11/2026 como estado válido, e timeouts dos papéis conferidos no piloto);
2. A **pendência técnica** imediata a tratar (revisão técnica independente do Codex sobre o PR #68 e evidências concorrentes, verificação R4 do catálogo de objetos do piloto e demais etapas subsequentes);
3. O **menor próximo passo seguro e proporcional**;
4. A **autorização expressa específica** requerida para executar esse passo.

*Nota:* O agente não deve decidir unilateralmente entre acionar revisão, executar verificação no piloto, instalar migrações ou avançar para integração HTTP. A decisão pertence exclusivamente ao responsável humano.

---

## 11. Protocolo para Assumir Temporariamente

Qualquer agente convocado para atuar temporariamente deve cumprir o seguinte checklist antes de qualquer ação:

- [ ] **Passo 1:** Declarar formalmente em quatro campos independentes: agente, papel atribuído, interface operacional e modelo confirmado ou “não confirmado” (o nome de uma ferramenta, terminal ou interface como Claude Code ou Antigravity IDE não comprova a identidade do agente ou do modelo em execução).
- [ ] **Passo 2:** Confirmar a leitura integral e direta dos sete documentos obrigatórios listados na Seção 4.
- [ ] **Passo 3:** Executar inspeção do estado Git (`branch`, `HEAD`, `git status --short`, índice) e conferir os hashes dos arquivos relevantes.
- [ ] **Passo 4:** Realizar a Validação de Continuidade Contextual (VCC), confrontando a instrução recebida com o último estado comprovado e os limites deste documento.
- [ ] **Passo 5:** Confirmar se possui autorização expressa para o escopo delimitado da instrução.
- [ ] **Passo 6:** Preservar integralmente arquivos preexistentes e modificações de governança não relacionadas.
- [ ] **Passo 7:** Não tratar relatórios ou textos de chat como provas substitutas do código e estado real do repositório.
- [ ] **Passo 8:** Manter distinção rigorosa entre testes estáticos de compilação, ensaios em banco descartável com rollback, instalação com commit, testes de integração HTTP e homologação final.
- [ ] **Passo 9:** Diante de qualquer alteração externa imprevista no checkout, interromper imediatamente e relatar a divergência.
- [ ] **Passo 10:** Ao concluir a intervenção, devolver ao responsável um relatório estruturado de evidências e limites.

---

## 12. Protocolo de Passagem de Volta ao ChatGPT

Ao término da atuação temporária, ou quando o responsável determinar o retorno do ChatGPT à orquestração, o agente temporário deverá emitir um **Relatório Formal de Passagem de Contexto** contendo:

1. **Identidade, Papel, Interface e Modelo:** Declaração explícita em quatro campos independentes (agente, papel atribuído, interface operacional e modelo confirmado ou “não confirmado”).
2. **Objetivo Executado:** Descrição exata da tarefa autorizada pelo responsável.
3. **Base Operacional:** Branch, HEAD e estado do índice utilizados.
4. **Arquivos Afetados:** Lista exata de arquivos criados, modificados ou inspecionados com seus respectivos hashes SHA-256 físicos.
5. **Evidências Técnicas:** Comandos executados, transcripts brutos de saída, códigos de retorno e dados observados.
6. **Limitações e Ressalvas:** O que a evidência obtida comprova e o que permanece formalmente não comprovado.
7. **Decisões do Responsável:** Qualquer deliberação ou acolhimento humano ocorrido durante o período.
8. **Pendências Remanescentes:** Próximo passo imediato para dar continuidade ao objetivo da Sprint 2.
9. **Estado de GitHub e Ferramentas:** Registro de que não houve publicações não autorizadas ou confirmação do que foi formalmente publicado se autorizado.
10. **Artefatos Físicos e Temporários:** Localização e integridade dos artefatos retidos no ambiente.

*Princípio fundamental:* Nenhuma conclusão ou parecer do agente temporário substitui a decisão final do responsável humano nem dispensa a conferência de continuidade pelo ChatGPT ao reassumir a orquestração.
