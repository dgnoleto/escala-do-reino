# Sprints — acompanhamento e encerramento

Esta pasta guarda registros por período. As regras vigentes estão no [guia de trabalho no GitHub](../operacao/GUIA-TRABALHO-GITHUB.md); os modelos vazios ficam em [docs/modelos/sprints/](../modelos/README.md).

## Organização

Usar uma pasta por sprint no formato `AAAA-MM-DD-identificador-nome/`, com a data de início. Criar somente os registros necessários:

- `ACOMPANHAMENTO.md`: referência temporal e registro de alertas, planning e pendências operacionais.
- `PLANNING.md`: copiar o modelo quando a planning for preparada/realizada, identificando proposta e decisão do PO/PM.
- `ENCERRAMENTO.md`: copiar o modelo ao consolidar o resultado, identificando rascunho, revisão e aceite.

Não criar um encerramento aprovado antecipadamente nem usar o calendário como prova de entrega. Não copiar todos os comentários/commits; referenciar as fontes. Atualizações posteriores do retrato histórico devem ficar identificadas.

## Índice

| Sprint | Período inclusivo | Registro | Situação deste acervo |
|---|---|---|---|
| Sprint 1 — Piloto | 18 a 31/10/2026 | [Acompanhamento](2026-10-18-sprint-01-piloto/ACOMPANHAMENTO.md) | Aberto; sem encerramento ou aceite declarado nesta rodada. |

Snapshot conferido em **25/10/2026**: campo Sprint/Iteration do [Project Plataforma do Reino](https://github.com/users/dgnoleto/projects/2), início `2026-10-18` e duração de 14 dias. Não havia outra iteração na configuração consultada. Consultar novamente antes de assumir calendário ou compromisso futuro; este índice não é sincronizado automaticamente com o Project.

## Rotina de continuidade

O orquestrador consulta os registros antes de repetir alertas. Os dois últimos dias corridos, no fuso America/Sao_Paulo, formam a janela de planning. A partir do dia seguinte ao término, verificar encerramento e preparar passagem antes de recomendar nova conversa. Preservar trabalho em andamento até ponto seguro.

O PO/PM usa o Kanban geral; não é necessário mudar sua visualização. Campo Sprint, Status e Estado da issue são independentes. Quando faltar acesso ao Project, informar a ação manual exata ao responsável.
