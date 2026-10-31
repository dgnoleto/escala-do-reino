# Sprints — acompanhamento e encerramento

Esta pasta guarda registros por período. As regras vigentes estão no [guia de trabalho no GitHub](../operacao/GUIA-TRABALHO-GITHUB.md); os modelos vazios ficam em [docs/modelos/sprints/](../modelos/README.md).

## Organização

Usar uma pasta por sprint no formato `AAAA-MM-DD-identificador-nome/`, com a data de início. Conforme decisão do responsável em **31/10/2026**, manter **um documento principal por sprint** (`ACOMPANHAMENTO.md`), reunindo abertura, planejamento/andamento e encerramento no mesmo arquivo, sem criar relatórios paralelos. Os arquivos em [docs/modelos/sprints/](../modelos/README.md) (`PLANNING.md` e `ENCERRAMENTO.md`) permanecem como referência estrutural para as respectivas seções:

- `ACOMPANHAMENTO.md`: registro principal da sprint, contendo calendário, abertura/planning, andamento/alertas e consolidação de encerramento.

Não criar um encerramento aprovado antecipadamente nem usar o calendário como prova de entrega. Não copiar todos os comentários/commits; referenciar as fontes. Atualizações posteriores do retrato histórico devem ficar identificadas.

## Índice

| Sprint | Período inclusivo | Registro principal | Situação deste acervo |
|---|---|---|---|
| Sprint 1 — Piloto | 18 a 31/10/2026 (14 dias) | [Acompanhamento e encerramento](2026-10-18-sprint-01-piloto/ACOMPANHAMENTO.md) | Registro inicial em 25/10/2026 preservado; consolidação de encerramento do ciclo adicionada em 31/10/2026, preservando o corte de fechamento da `Sprint 1 — Piloto` (20 issues naquele corte: 14 em `Concluído` — `#12`, `#18`, `#20`, `#21`, `#22`, `#23`, `#24`, `#25`, `#26`, `#27`, `#53`, `#54`, `#55` e `#59`; 5 em `Em revisão` — `#28`, `#29`, `#30`, `#51` e `#57`; 1 em `Em andamento` — `#58`) e a decisão posterior em `31/10/2026` de transferir as 6 pendências para a `Sprint 2`. |
| Sprint 2 | 01 a 15/11/2026 (15 dias) | [Acompanhamento](2026-11-01-sprint-02/ACOMPANHAMENTO.md) | Abertura documental preparada em 31/10/2026 (preservada como registro datado); período cadastrado e conferido no GitHub Project pelo orquestrador, sob autorização expressa do responsável, em 31/10/2026 (`01 a 15/11/2026`, 15 dias inclusivos). Em 31/10/2026, as 6 pendências da Sprint 1 (`#28`, `#29`, `#30`, `#51`, `#57` e `#58`) foram selecionadas pelo responsável e transferidas pelo orquestrador para a `Sprint 2` mantendo seus status (`5 Em revisão`, `1 Em andamento`); objetivo, capacidade, prioridades e ordem de execução permanecem pendentes de planejamento (a associação à sprint não autoriza execução paralela de todas as frentes). |

- **Snapshot conferido em 25/10/2026:** campo Sprint/Iteration do [Project Plataforma do Reino](https://github.com/users/dgnoleto/projects/2), início `2026-10-18` e duração de 14 dias. Não havia outra iteração na configuração consultada naquela data.
- **Complemento conferido em 31/10/2026:** no corte de fechamento da `Sprint 1 — Piloto`, o filtro `sprint:"Sprint 1 — Piloto"` foi conferido pelo orquestrador com 20 issues vinculadas (`14 Concluído`, `5 Em revisão` e `1 Em andamento`) e o ciclo de trabalho da `Sprint 1 — Piloto` foi encerrado em `31/10/2026` por decisão do responsável; `Sprint 2` cadastrada e conferida no GitHub Project pelo orquestrador, sob autorização expressa do responsável, em `31/10/2026` para `01 a 15/11/2026` (15 dias inclusivos). Em decisão subsequente de `31/10/2026`, o responsável selecionou as 6 pendências (`#28`, `#29`, `#30`, `#51`, `#57` e `#58`) para a `Sprint 2` e o orquestrador realizou e conferiu sua transferência no Project mantendo seus status (`Em revisão`: `#28`, `#29`, `#30`, `#51` e `#57`; `Em andamento`: `#58`), corpos, critérios, títulos, comentários e estados; objetivo, capacidade, prioridades e ordem de execução permanecem pendentes de planejamento.

Consultar novamente antes de assumir calendário ou compromisso futuro; este índice não é sincronizado automaticamente com o Project.

## Rotina de continuidade

O orquestrador consulta os registros antes de repetir alertas. Os dois últimos dias corridos, no fuso America/Sao_Paulo, formam a janela de planning. A partir do dia seguinte ao término, verificar encerramento e preparar passagem antes de recomendar nova conversa. Preservar trabalho em andamento até ponto seguro.

O PO/PM usa o Kanban geral; não é necessário mudar sua visualização. Campo Sprint, Status e Estado da issue são independentes. Quando faltar acesso ao Project, informar a ação manual exata ao responsável.
