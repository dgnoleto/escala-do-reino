# Sprint 3 — acompanhamento

Documento principal da **Sprint 3**, criado em **14/11/2026** por autorização expressa do responsável pelo produto, a partir da planning realizada no mesmo dia. Reúne abertura, planning, andamento e futuro encerramento. Registrado por Claude (orquestrador secundário convocado), via Claude Code.

## 1. Calendário e fonte

| Informação | Referência |
|---|---|
| Project | [Plataforma do Reino](https://github.com/users/dgnoleto/projects/2) |
| Campo | Sprint, tipo Iteration |
| Iteração | Sprint 3 — cadastrada no Project em 14/11/2026 (ver seção 2.5) |
| Início | 16/11/2026 |
| Duração decidida na planning (14/11) | 15 dias inclusivos; revista para 14 dias em 22/11/2026 |
| Configuração conferida no Project | 14 dias, de 16 a 29/11/2026 — ratificada pelo responsável em 22/11/2026 |
| Término inclusivo | 29/11/2026 (decisão do responsável em 22/11/2026; a planning de 14/11 previa 30/11) |
| Fuso da rotina | America/Sao_Paulo |
| Janela para alerta de planning seguinte | 28 e 29/11/2026 (derivada do término de 29/11) |
| Verificação de encerramento/transição | A partir de 30/11/2026 (derivada do término de 29/11) |
| Ciclo anterior | [Sprint 2 (01 a 15/11/2026)](../2026-11-01-sprint-02/ACOMPANHAMENTO.md) |

## 2. Planning — realizada em 14/11/2026

**Fonte:** conversa de orquestração de 14/11/2026 entre o responsável pelo produto e Claude (orquestrador secundário convocado). Decisões expressas do responsável; o registro original está na seção 3 do acompanhamento da Sprint 2.

### 2.1 Objetivo

Fazer o planejamento de cultos funcionar de ponta a ponta na aplicação real, contra o piloto: criar uma edição de culto, organizar e gravar suas etapas, conferir a duração e publicar — com os dados persistindo e reaparecendo ao recarregar.

### 2.2 Capacidade informada

Disponibilidade do responsável para decisões, repasses, verificações e aceite; não é estimativa por issue nem garantia de conclusão.

| Dias | Quantidade | Disponibilidade por dia | Total |
|---|---:|---:|---:|
| Úteis: 16 a 20/11, 23 a 27/11 e 30/11 | 11 | 2 horas | 22 horas |
| Fim de semana: 21, 22, 28 e 29/11 | 4 | 4 a 6 horas | 16 a 24 horas |
| **Total de 16 a 30/11** | **15** | | **38 a 46 horas** |

Referência conservadora: 38 horas.

### 2.3 Escopo e compromisso

| Issue | Papel na sprint | O que falta (estado em 14/11) | Revisão do Codex |
|---|---|---|---|
| [#28](https://github.com/dgnoleto/escala-do-reino/issues/28) — criar edição de culto | **Compromisso** | Tela: ler corretamente o retorno de `list_church_events`; enviar o início com fuso; enviar o tipo de evento escolhido (causa não investigada). Refinamento de transferência de liderança em culto iniciado segue pendente no corpo da história. | Proporcional (só tela), salvo mudança em RPC |
| [#29](https://github.com/dgnoleto/escala-do-reino/issues/29) — programação e serviços paralelos | **Compromisso** | Tela: gravar etapas com `create_event_item`. Banco: ler etapas de um evento, editar e remover etapa. Exercitar `reorder_event_items` com etapas reais (ressalva do aceite da #57). | Obrigatória no pacote de banco |
| [#30](https://github.com/dgnoleto/escala-do-reino/issues/30) — duração e publicação | **Compromisso** | Banco: devolver `program_status`, `duration_policy` e `program_version` na leitura. Validar a apuração de duração com etapas gravadas e horário correto. | Obrigatória no pacote de banco |
| [#51](https://github.com/dgnoleto/escala-do-reino/issues/51) — navegação autenticada | **Compromisso** | Homologar a aba de Planejamento integrada, reaproveitando as evidências de #28 a #30. | Proporcional |
| [#31](https://github.com/dgnoleto/escala-do-reino/issues/31) e [#44](https://github.com/dgnoleto/escala-do-reino/issues/44) — escala nominal | **Extensão** | **Fora da Sprint 3 por decisão do responsável em 22/11/2026; sem sprint até a próxima planning** (antes: entravam somente se o planejamento fechasse antes de 30/11). RPCs do script 015 presentes no piloto; aderência às regras atuais de aptidão e conflito não verificada. | Se as RPCs mudarem |
| [#58](https://github.com/dgnoleto/escala-do-reino/issues/58) — laboratório | **Apoio** | Critérios reduzidos em 14/11 ao necessário para backup/restauração verificável, banco de ensaio equivalente ao piloto nos objetos do B2, preflight impeditivo e evidências versionadas mediante autorização. | — |

**Divisão do bloco de planejamento:**

- **B1 — tela, sem SQL novo:** quatro correções (retorno de `list_church_events`, início com fuso, tipo de evento, chamada de `create_event_item`), com testes locais e validação pela tela real.
- **B2 — pacote SQL único do planejamento:** leitura das etapas de um evento, devolução do estado do programa e edição/remoção de etapa. Uma especificação, um ensaio em banco descartável, uma revisão do Codex, uma instalação.
- **Fora da 1.0, com contenção declarada:** aplicar modelo de culto de forma atômica (o modelo é aplicado etapa a etapa) e remover evento em rascunho (o rascunho indesejado é cancelado).

**Escopo da versão 1.0:** adiadas para a 1.1 as issues #32, #33, #41, #45, #46 e #48 (label `escopo:mvp` substituída por `escopo:1.1` em 14/11, com comentário em cada uma).

### 2.4 Regras de condução decididas

- **Paralelismo:** a planning autorizou paralelismo somente entre B1 e B2 em worktrees fisicamente isoladas. Em decisão posterior de 14/11, o responsável determinou que a pasta oficial permaneça atualizada e que pastas paralelas sejam usadas apenas quando extremamente necessário; a condução padrão volta a ser serial no checkout oficial, sem invalidar worktrees já criadas que precisem ser preservadas e conferidas.
- **Orquestração:** Claude, por convocação, desde 20/11/2026 às 20:52 (passagem do Codex), em caráter temporário até o responsável informar o retorno do Codex (previsto para 26/11/2026), quando haverá handoff completo; a passagem ao orquestrador canônico segue a determinação do responsável. A convocação não concede permissões operacionais.
- **Executor principal:** Antigravity. **Revisão técnica independente:** Codex.
- **Limites:** a planning não autoriza SQL, banco, piloto, commit, push, PR, merge ou deploy. Cada execução depende de prompt e autorização próprios.

### 2.5 Aplicação no GitHub e conferência (14/11/2026)

| Item | Decisão autorizada | Resultado conferido | Pendência |
|---|---|---|---|
| Label `escopo:1.1` | Criar | Criada | — |
| #32, #33, #41, #45, #46, #48 | Sair do recorte da 1.0 | `escopo:mvp` removida, `escopo:1.1` aplicada e comentário de decisão publicado nas seis; issues abertas, status `Backlog` preservado | — |
| Iteração `Sprint 3` no Project | Criar (16/11, 15 dias) | Criada manualmente pelo responsável e conferida pelo orquestrador com início em 16/11 e duração de 14 dias | Ajustar a duração para 15 dias se for mantida a decisão da planning. |
| #28, #29, #30, #51, #58 → Sprint 3 | Transferir | Transferidas e conferidas: #28, #29, #30 e #51 em `Em revisão`; #58 em `Em andamento` | — |
| #57 no Project | — | Issue fechada em 14/11; status no Project ainda `Em revisão` | Mover para `Concluído` (decisão do responsável). |

### 2.6 Riscos e pontos sem decisão

- **Ritmo dos pacotes de banco:** a #57 levou três semanas; o plano supõe cerca de uma semana para o B2. É a premissa mais frágil.
- **Tela distante do banco:** a validação de 13/11 encontrou três defeitos numa única passada. Validar pela tela real no início de cada bloco, antes de estimar.
- **Previsão da 1.0 (hipótese, não compromisso):** em torno de 13/12/2026.
- **Sem decisão:** SMTP dedicado para convites; quem será cadastrado na fase real (vínculo de pessoa a igreja é dado de natureza religiosa — LGPD); rotina de backup do piloto antes de cada migration.
- **Higiene:** separação documental autorizada em 14/11, sem commit ou publicação; arquivo de credenciais informado na pasta do Antigravity e dump do piloto com dados pessoais em `scratch/` permanecem fora do Git e sem autorização de exclusão.

## 3. Andamento, alertas e decisões do ciclo

| Data | Evento | Situação/decisão | Referência |
|---|---|---|---|
| 14/11/2026 | Planning e abertura documental | Decisões da seção 2 tomadas pelo responsável; documento criado; seis issues adiadas para a 1.1 no GitHub. Iteração no Project pendente de criação manual. | Decisões expressas do responsável em 14/11/2026. |
| 14/11/2026 | Iteração no Project e transferência das issues (atualiza a seção 2.5) | O responsável criou a iteração `Sprint 3` no Project. Conferido pelo orquestrador: início em 16/11/2026, **duração de 14 dias (até 29/11), e não os 15 decididos na planning** — ajuste da duração pendente com o responsável. Transferidas e conferidas no campo Sprint: `#28`, `#29`, `#30`, `#51` (status `Em revisão`) e `#58` (`Em andamento`), status preservados. `#57` permanece em `Sprint 2` com status `Em revisão`, embora fechada. | Autorização do responsável em 14/11/2026. |
| 14/11/2026 | #58 — critérios reduzidos | Corpo da issue alterado por autorização do responsável, após antes/depois: bloco datado no topo, lista de critérios (de nove para quatro) e parágrafo de status; as 34 linhas de histórico anteriores foram mantidas sem alteração. Lista anterior e destino de cada critério preservados em comentário. | [Comentário na #58](https://github.com/dgnoleto/escala-do-reino/issues/58#issuecomment-6875283162). |
| 14/11/2026 | B1 enviado; B2 em especificação | B1 (correções de tela das #28 e #29) enviado a um executor complementar via Claude Code, em worktree isolada `D:\Github\escala-do-reino-b1`, a partir da `main` (`74ab8b8`), sem autorização de commit. Após relatar o incidente da suíte, o executor retomou sob contenção, mas foi interrompido por limite da API antes de entregar código conferível. A worktree preserva três arquivos modificados e um novo, ainda sem revisão; **nenhuma alteração do B1 foi integrada à pasta oficial**. B2: proposta de contrato redigida pelo orquestrador; D2, D3 e D4 foram decididas, enquanto D1 permaneceu ambígua. Nenhum SQL do B2 foi escrito ou executado. | Autorizações, retorno do executor e conferência Git em 14/11/2026. |
| 14/11/2026 | **Incidente:** `npm test` aplicou e reverteu SQL no banco `postgres` do laboratório local | **Sintoma:** ao rodar `npm test` na worktree do B1 (linha de base, antes de qualquer edição), a suíte executou `tools/test-deploy-rollback-lifecycle.js`. **Causa confirmada** (leitura do script na `main` e da saída bruta): o script `test` do `package.json` é `node --test`, sem pasta, e descobre esse arquivo (presente na `main` desde `28134fd`, de 19/10/2026); ele executa `docker exec … psql -U postgres -d postgres` no contêiner `supabase_db_escala-convites-http-lab`, **sem confirmação e sem transação com `ROLLBACK`**: recria o helper `app_private.has_church_settings_access`, aplica 020, 021, 022 e 023, verifica e depois executa os scripts de reversão (que removem tabelas, colunas de `events` e RPCs desses incrementos). A saída registra aplicação, verificação e reversão concluídas; 602 testes, 0 falhas. **Alcance:** somente o contêiner local; o script não tem caminho para o piloto. **Não confirmado:** o estado do banco `postgres` do laboratório antes e depois — se os incrementos 020 a 023 não estavam instalados nele, o efeito líquido é nulo exceto pelo helper recriado; se estavam, foram removidos com seus dados. Não houve conexão ao laboratório para conferir (sem autorização). **Hipótese a verificar:** o mesmo efeito ocorreu em toda execução anterior de `npm test` completo com o contêiner ligado, desde 19/10. **Origem do erro:** o prompt do B1, redigido pelo orquestrador, autorizou `npm test` sem verificar o que a suíte descobre; contraria AGENTS.md §4.1 e §4.2. O executor parou antes de alterar código e relatou. **Contenção:** B1 retomado com proibição de `npm test`, de `tools/`, de `docker` e de `psql`; verificação restrita a arquivos de `test/`. **Pendente de decisão do responsável:** conferência somente leitura do laboratório; correção do script `test` e do arquivo em `tools/` (frente própria); registro na issue. Bancos `escala_rehearsal_*` não são alvo do script. | Entrega do executor complementar e saída bruta em `scratch/incidente-20261114-npm-test-laboratorio/baseline-test.txt` (SHA-256 `61578CCE…102FD009`, fora do Git). Registrado por Claude (orquestrador secundário convocado). |
| 14/11/2026 | Incidente — conferência do laboratório, issue e decisões do responsável | Por autorização do responsável: (1) conferência somente leitura do banco `postgres` do contêiner `supabase_db_escala-convites-http-lab` (transação `READ ONLY` encerrada em `ROLLBACK`): presentes apenas as 14 tabelas e as funções da cadeia 013/015/016; ausentes tabelas, colunas e funções de 017 a 023; presente o helper `has_church_settings_access`, do incremento 017, como resíduo do script de teste; 1 evento em `events`. O estado coincide com o que a documentação descreve para esse banco, o que é **compatível com efeito líquido nulo, mas não o comprova** — não há retrato imediatamente anterior. (2) Aberta a [issue #69](https://github.com/dgnoleto/escala-do-reino/issues/69) para restringir `npm test` a `test/` e travar o ensaio de deploy/rollback; ainda não vinculada à sprint no Project. (3) Incidente registrado nas issues #58 e #29. **Decisões do contrato do B2:** D2, D3 e D4 aprovadas conforme a proposta; D1 (edição depois de publicado) com resposta ambígua, pendente de esclarecimento. **Diretriz do responsável sobre pastas:** a pasta oficial `D:\Github\escala-do-reino` deve estar sempre atualizada; pastas paralelas só em caso extremamente necessário — a entrega do B1, feita em worktree, será levada à pasta oficial depois de conferida. | Decisões expressas do responsável em 14/11/2026; evidência em `scratch/incidente-20261114-npm-test-laboratorio/`. |
| 15/11/2026 | Governança multiagente 1.4 publicada | Troca experimental de funções entre Codex e Claude Code na Sprint 3 (AGENTS §2.8) e registro das conexões MCP do Antigravity. A avaliação da troca será feita pelo responsável ao encerrar a Sprint 3, por frente revisada. | PRs #73 (merge `10e054f`) e #74 (merge `531d88e`). |
| 16/11/2026 | Sprint 2 encerrada documentalmente; B1 integrado | Registro de encerramento da Sprint 2 na `main`. **B1** (tela real de #28 e #29) integrado pelo PR #75, com parecer técnico independente do Codex "Aprovado", suíte focal 111/111, build aprovado. O merge não comprova piloto, RLS, rede, navegador nem aceite humano. | PR #76 (merge `0cd2542`); PR #75 (merge `6e12ada`, commit aprovado `5a26c7b`); comentários de 16/11 nas #28 e #29. |
| 17/11/2026 | #28 aceita e encerrada | Homologação funcional conduzida pelo Codex na aplicação autenticada contra o piloto, caminho administrativo, edição sintética `[HOMOLOGACAO-28-20261117-A]`. Decisão do responsável: aceita e encerrada. | Comentário de 17/11 na #28. |
| 20/11/2026 | B2 integrado; SQL 026 aplicado ao piloto; passagem de orquestração | PR #77 integrou o pacote B2/026 (instalador, verificador, rollback e roteiro de ensaio; ensaio local tentativa 11 com saída 0). Às 20:52, o Codex passou a orquestração ao Claude (claude.ai), temporário até o responsável informar o retorno do Codex. Às 22:12 o 026 foi aplicado ao piloto (COMMIT) com backup prévio, e o verificador `026_verify.sql` passou os 8 gates. As saídas brutas existem só na sessão do executor. Rollback não executado; 026 não registrado no histórico de migrations. | PR #77 (merge `a5aec3a`, commit `3714509`); comentários de 20/11 nas #29 e #30; registro de 20/11 no Project do Claude. Sem revisão independente posterior. |
| 21/11/2026 | Programação persistente integrada; #30 avaliada e encerrada | PR #78 integrou a programação persistente e idempotente (#29 #30 #51), suíte focal 48/48. Homologação funcional da #30 no piloto: CA01 a CA03 provados na tela e no servidor, CA04 parcial. O responsável encerrou a #30 com ressalvas aceitas (conflitos de pessoas dependem da #31; culto em execução não testado; risco N-4 mantido). | PR #78 (merge `86cfc46`, commit `0e7884d`); comentários de 21/11 nas #30 e #51. Validação interna do orquestrador, não revisão independente. |
| 21/11/2026 | Decisão: CA03 e CA04 da #29 entram agora | Recorte mínimo (a) para o CA04. A preparação é só `prep_required_minutes` (0 a 180) do apoio; a ocupação é derivada, não gravada. | Comentários de 21/11 na #29. |
| 22/11/2026 | #29 encerrada; testes de contrato corrigidos | PR #79 (conflitos de escala com preparação) integrado e **#29 encerrada** pelo responsável. Ressalvas: conteúdo real de `assignments` e "preserva histórico" não provados; corpo da issue mantém CA03 e CA04 como `[ ]`. PR #83 corrigiu fixtures e `await` de testes após o #78 (#80); o CI de testes segue pendente no #80. | PR #79 (merge `d880e22`); PR #83 (merge `94a7912`); comentário de 22/11 na #29. |
| 22/11/2026 | Defeitos de planejamento encontrados e corrigidos em PR | #81 (UUID no lugar do nome do responsável) e #82 (lista de equipes do RPC mal desembrulhada, causa raiz maior que a chave duplicada do React). PR #84 com 5 testes novos (suíte 718, 0 falhas), validado no app real com equipe e líder reais, **mesclado pelo responsável em 22/11/2026 sem revisão independente**. Efeitos para revisão do Codex: mudança de permissão `isTeamLeader` e pré-seleção da primeira equipe real no Apoio Paralelo. #81 e #82 seguem abertas. | PR #84 (branch `fix/issue-81-82-planning-nome-responsavel-key`, `b91336c`; merge `570ec9b`); comentários nas #81 e #82. |
| 22/11/2026 | Revalidação do #51 no app real | Três perfis (admin, líder de equipe, dirigente da liturgia). CA01 a CA03 "Atendido com ressalva"; CA04 adiado (precisa de segunda igreja); CA05, CA07 e CA08 parciais; CA06 não atendido. O ciclo do CA03 foi provado no servidor: leitura recusada antes da designação, leitura e escrita permitidas com ela, leitura recusada depois da reversão. A designação foi gravada e revertida pela RPC real, deixando 2 recibos e 2 auditorias na edição de homologação. | Comentário de 22/11 na #51. Validação interna do orquestrador, não revisão independente. |
| 22/11/2026 | Issues novas abertas | #85 (opção "Criar minha igreja" para convidado, cenários a definir), #86 (deriva entre banco e repositório em duas funções), #87 (leitura da programação negada a líder de equipe e membro), #88 (não-admin não vê nomes de membros), #89 (designação da liturgia só grava local), #90 (convites da Administração só locais) e #91 (piloto sem o endurecimento de 29/10 do 021). #88, #89, #90 e #91 estão na Sprint 3; #85 a #87 ainda não conferidos. | Issues #85 a #91. |
| 22/11/2026 | #58: leitura do catálogo do piloto e critérios reescritos | Leitura somente leitura: 81 de 87 funções idênticas ao repositório, 6 divergentes (2 no #86, 4 na #91). O responsável concordou em reescrever o critério de baseline como comparação piloto ↔ repositório e adiar o banco de ensaio do contêiner para depois do #69. `bloqueado` mantido. **Decisão do responsável: não instalar a correção do 021 agora**; aguardar o ensaio e a volta do Codex em 26/11. | Comentários de 22/11 nas #58, #86 e #88; corpo da #58 atualizado. |
| 22/11/2026 | Pendências de decisão e de condução | Data de término da Sprint 3: o responsável escolheu **29/11/2026** (Project com 14 dias); este documento ainda registra 30/11 nas seções 1 e 4. Corte do #31 e #44 pendente. Ajuste de datas e do bloco "Orquestração" da seção 2.4 não foi feito. Retorno do Codex informado para 26/11/2026; no retorno, handoff completo exigido. | Decisões expressas do responsável em 22/11/2026. |
| 22/11/2026 | Decisões de término, corte e escopo da Sprint 3 | **Término:** 29/11/2026 (14 dias, conforme o Project); ratifica a iteração e substitui o 30/11 da planning. **#31 e #44:** fora da Sprint 3, sem sprint até a próxima planning (decisão tomada com relutância; risco aceito: escala nominal não entregue nesta sprint, e a #30 foi encerrada com ressalva dependente da #31). A iteração `Sprint 4` não existe no Project e não será criada agora. **#69:** incluída na Sprint 3 (esforço não estimado), pré-requisito do ensaio do #91 e do banco de ensaio da #58. Esta linha resolve a pendência da linha anterior. A planning de 14/11 (15 dias, capacidade em horas) permanece como registro histórico. | Decisões expressas do responsável em 22/11/2026; comentários nas #69 (7082221031), #31 (7082221228 e 7082331404) e #44 (7082221445 e 7082331584). |
| 26/11/2026 | Mudança de papéis de orquestração e revisão | Por decisão expressa do responsável: Claude passa a orquestrador principal, sem retorno automático; Codex, tratado como o mesmo ator que o ChatGPT, fica revisor técnico independente por convocação (obrigatório nos itens do AGENTS.md, seção 3, item 1, sem travar o restante); seção 2.8 revogada antes do fim da Sprint 3. AGENTS.md e FLUXO-MULTIAGENTE.md passam à v1.5, com as v1.4 preservadas em docs/operacao/versoes/. A revisão focal do Codex em 26/11 achou um defeito P2 na #89 (recuperação de designação incerta) depois da validação interna; corrigido no PR #98: dado para a avaliação do desenho de papéis. | Decisões do responsável de 26/11/2026; documento de continuidade claude/2026-11-26-continuidade-orquestrador-principal.md do Projeto. |

## 4. Encerramento do ciclo — ainda não realizado

Período: 16/11/2026 a 29/11/2026 (14 dias), conforme decisão do responsável em 22/11/2026, que ratifica a configuração do Project. A verificação de encerramento começa em 30/11/2026. Preencher nesta seção, conforme o [modelo de encerramento](../../modelos/sprints/ENCERRAMENTO.md): resultado frente ao objetivo, entregas comprovadas, pendências, aprendizados e passagem de contexto.
