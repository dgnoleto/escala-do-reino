# Sprint 3 — acompanhamento

Documento principal da **Sprint 3**, criado em **14/11/2026** por autorização expressa do responsável pelo produto, a partir da planning realizada no mesmo dia. Reúne abertura, planning, andamento e futuro encerramento. Registrado por Claude (orquestrador secundário convocado), via Claude Code.

## 1. Calendário e fonte

| Informação | Referência |
|---|---|
| Project | [Plataforma do Reino](https://github.com/users/dgnoleto/projects/2) |
| Campo | Sprint, tipo Iteration |
| Iteração | Sprint 3 — cadastrada no Project em 14/11/2026 (ver seção 2.5) |
| Início | 16/11/2026 |
| Duração decidida na planning | 15 dias inclusivos |
| Configuração conferida no Project | 14 dias, de 16 a 29/11/2026 — divergência pendente de ajuste |
| Término inclusivo decidido | 30/11/2026 |
| Fuso da rotina | America/Sao_Paulo |
| Janela para alerta de planning seguinte | 29 e 30/11/2026 |
| Verificação de encerramento/transição | A partir de 01/12/2026 |
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
| [#31](https://github.com/dgnoleto/escala-do-reino/issues/31) e [#44](https://github.com/dgnoleto/escala-do-reino/issues/44) — escala nominal | **Extensão** | Entram somente se o planejamento fechar antes de 30/11. RPCs do script 015 presentes no piloto; aderência às regras atuais de aptidão e conflito não verificada. | Se as RPCs mudarem |
| [#58](https://github.com/dgnoleto/escala-do-reino/issues/58) — laboratório | **Apoio** | Critérios reduzidos em 14/11 ao necessário para backup/restauração verificável, banco de ensaio equivalente ao piloto nos objetos do B2, preflight impeditivo e evidências versionadas mediante autorização. | — |

**Divisão do bloco de planejamento:**

- **B1 — tela, sem SQL novo:** quatro correções (retorno de `list_church_events`, início com fuso, tipo de evento, chamada de `create_event_item`), com testes locais e validação pela tela real.
- **B2 — pacote SQL único do planejamento:** leitura das etapas de um evento, devolução do estado do programa e edição/remoção de etapa. Uma especificação, um ensaio em banco descartável, uma revisão do Codex, uma instalação.
- **Fora da 1.0, com contenção declarada:** aplicar modelo de culto de forma atômica (o modelo é aplicado etapa a etapa) e remover evento em rascunho (o rascunho indesejado é cancelado).

**Escopo da versão 1.0:** adiadas para a 1.1 as issues #32, #33, #41, #45, #46 e #48 (label `escopo:mvp` substituída por `escopo:1.1` em 14/11, com comentário em cada uma).

### 2.4 Regras de condução decididas

- **Paralelismo:** a planning autorizou paralelismo somente entre B1 e B2 em worktrees fisicamente isoladas. Em decisão posterior de 14/11, o responsável determinou que a pasta oficial permaneça atualizada e que pastas paralelas sejam usadas apenas quando extremamente necessário; a condução padrão volta a ser serial no checkout oficial, sem invalidar worktrees já criadas que precisem ser preservadas e conferidas.
- **Orquestração:** Claude, por convocação, até 30/11/2026, com passagem formal ao ChatGPT (orquestrador canônico) ao fim da sprint ou quando o responsável determinar. A convocação não concede permissões operacionais.
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

## 4. Encerramento do ciclo — ainda não realizado

Período decidido na planning: 16/11/2026 a 30/11/2026. A iteração do Project foi conferida com 14 dias, até 29/11, e permanece pendente de ajuste ou ratificação. Pela decisão vigente de 15 dias, a verificação de encerramento começa em 01/12/2026. Preencher nesta seção, conforme o [modelo de encerramento](../../modelos/sprints/ENCERRAMENTO.md): resultado frente ao objetivo, entregas comprovadas, pendências, aprendizados e passagem de contexto.
