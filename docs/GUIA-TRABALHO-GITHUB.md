# Plataforma do Reino — guia de trabalho no GitHub

Preparado em 11/10/2026 para consolidar a organização do Project aprovada pelo responsável e a diretriz de seleção documental por PR. Este guia foi aprovado para publicação pelo responsável em 11/10/2026. Ele descreve o processo de trabalho; regras de produto continuam no PRD e nos contratos aprovados.

## 1. Onde cada informação fica

| Local | Uso |
|---|---|
| [Plataforma do Reino](https://github.com/users/dgnoleto/projects/2) | Acompanhar etapas, responsáveis e prioridades dos módulos em um Project principal. |
| [Issues do repositório](https://github.com/dgnoleto/escala-do-reino/issues) | Registrar tarefas, defeitos, dúvidas, critérios, decisões relacionadas e resultados. |
| Pull requests (PRs) | Propor e revisar alterações de código ou documentação, mostrando o que será incorporado. |
| [PRD](PRD.md) e contratos | Consultar requisitos e regras aprovados. Uma issue não os altera por inferência. |
| [Estado atual](ESTADO-ATUAL.md) | Saber o que foi entregue, o que está pendente e quais limites de validação existem. |
| [Histórico](historico/2026-10-11-preparacao-qa.md) e evidências selecionadas | Preservar o que foi observado em uma data, versão e ambiente. |
| [Evolução futura](EVOLUCAO-FUTURA.md) | Guardar ideias e decisões futuras, distinguindo decidido, proposto e pendente. |

O repositório atual continua chamado escala-do-reino. O Project principal se chama Plataforma do Reino; seu primeiro módulo é Escala do Reino. A organização de outros módulos não implica implementação ou compromisso de entrega.

O README do Project é um resumo operacional com links. Este guia, depois de incorporado, será a referência versionada do processo. Mudanças relevantes no processo devem atualizar o guia e o resumo do Project, preservando o vínculo com a decisão do responsável. Os dois não se sincronizam automaticamente.

## 2. Responsabilidades

| Participante | Responsabilidade |
|---|---|
| PM/responsável pelo produto | Decidir escopo, regras, prioridades e documentos que devem ser publicados; conceder as autorizações específicas. |
| Antigravity | Implementar as alterações autorizadas no checkout de desenvolvimento, preservando trabalho paralelo; preparar commit, push e PR quando autorizados. |
| Codex | Conferir requisitos, diff, versão e evidências; conduzir ensaios dentro do escopo autorizado e registrar limites. |
| QA | Selecionar cenários conforme mudança e risco, registrar resultados e achados, confirmar correções e lacunas de cobertura; rotina combinada com o responsável. |
| IA de apoio | Ler documentos e estado atual, citar evidências e executar somente o trabalho autorizado; explicitar dúvidas e hipóteses. |

Novos commits, push, merge, deploy e SQL no piloto continuam exigindo autorização específica. Estar em um quadro, ter prioridade ou ter um PR aberto não substitui essa autorização. Acesso ao GitHub, ao Project, ao ambiente e às contas de teste deve ser combinado separadamente.

## 3. Quando abrir uma issue

Abrir uma issue quando existir algo acompanhável: um defeito reproduzível, uma manutenção documental, uma dúvida que exige decisão ou uma melhoria que será analisada. Consultar issues abertas e encerradas para evitar duplicação.

Uma ideia de módulo futuro pode continuar em Evolução futura até existir uma pergunta de discovery ou trabalho definido. Registrar uma ideia não a torna requisito aprovado. Relatórios e resumos úteis ficam nos documentos selecionados; não abrir uma issue somente para guardar uma cópia completa de cada relatório.

Usar títulos que descrevam o problema ou resultado. Exemplo: “Atualizar referências de implementação no documento de evolução futura”. Evitar títulos como “Ajustes gerais”.

### Modelo mínimo de issue

```text
Problema ou necessidade:
Objetivo:
Escopo e limites:
Regra/documento de referência, quando aplicável:
Critérios de conclusão verificáveis:
Ambiente e versão, quando houver execução:
Evidências ou referências existentes:
Dependências, dúvidas e próximo passo:
```

Para defeitos, usar o [modelo de achado de QA](qa/ROTEIRO-QA-E-REGISTRO.md), que inclui reprodução, esperado, observado, impacto, evidência e limites. Distinguir hipótese de causa de causa comprovada.

Para dúvidas de produto, registrar a pergunta e as alternativas. Após decisão, registrar responsável, data e conclusão; atualizar os documentos normativos afetados dentro do incremento autorizado. A IA não escolhe uma regra nova para resolver uma divergência sozinha.

## 4. Labels, prioridade e responsável

Labels identificam dimensões diferentes; a etapa de execução fica no campo Status.

| Label/campo | Significado |
|---|---|
| módulo:escala | Trabalho específico do módulo Escala do Reino. |
| compartilhado | Base comum ou trabalho transversal; pode acompanhar as labels dos módulos afetados. |
| bug | Comportamento observado diverge do requisito aprovado. |
| documentation | Guia, contrato, estado, evidência ou declaração documental exige trabalho. |
| enhancement | Melhoria proposta, ainda sujeita a análise e decisão de escopo. |
| question | Informação ou decisão precisa ser esclarecida. |
| bloqueado | Impedimento para avançar; registrar motivo, dependência e condição de desbloqueio. |
| Prioridade: Alta, Média ou Baixa | Ordem de trabalho definida pelo responsável conforme impacto; pode ficar vazia até a decisão. |
| Assignee/responsável | Pessoa com conta GitHub responsável pelo acompanhamento/execução. Não inventar uma conta para representar um agente. |

Exemplos: módulo:escala + bug; módulo:escala + documentation; compartilhado + question. Labels de novos módulos entram conforme surgir trabalho definido. Datas e estimativas não são obrigatórias nem devem ser inventadas para preencher o quadro.

## 5. Etapas e visões do Project

| Status | Condição |
|---|---|
| Backlog | Necessidade registrada, em análise ou aguardando priorização. |
| Pronto para iniciar | Escopo, resultado esperado e execução combinados com o responsável. |
| Em andamento | Trabalho em execução no escopo autorizado. |
| Em revisão | Alteração ou documentação sendo conferida; achados podem devolver a tarefa à execução. |
| Em QA | Casos selecionados sendo validados com versão, ambiente, resultados e limites registrados. |
| Concluído | Critérios atendidos, evidências registradas e integração conferida quando necessária. |

Nem toda tarefa passa por uma rodada funcional. Uma manutenção documental pode ser concluída por revisão de conteúdo, links e evidências; registrar esse método em vez de declarar QA funcional inexistente.

Bloqueio conserva a etapa e acrescenta a label bloqueado. Ao resolver, registrar como a condição foi atendida, retirar a label e retomar o fluxo. Se o escopo mudar, revisar critérios e obter a decisão necessária antes de executar trabalho adicional.

Visões configuradas em 11/10/2026:

- **Kanban:** quadro geral por Status. Usar o filtro `label:"módulo:escala"` para consultar um módulo.
- **QA:** tabela filtrada por `is:issue status:"Em QA"`.
- **Histórico:** tabela filtrada por `is:issue is:closed`, com labels e data de fechamento.

São visões do mesmo conjunto de itens. Histórico inclui somente itens acompanhados pelo Project; não é importação automática de todas as entregas anteriores do repositório. Consultar também a lista de issues e PRs.

### Automações e seus limites

- Issues abertas novas ou atualizadas do repositório padrão entram no Project pelo filtro `is:issue is:open`.
- Novos itens começam em Backlog; sub-issues de itens acompanhados também são incluídas.
- Etapas de revisão, QA e conclusão são ajustadas explicitamente.
- Estão desativadas as automações de concluir por merge, concluir por fechamento de issue, mudar etapa por vínculo com PR e fechar issue por movimentação do cartão.

Essas escolhas não desativam os mecanismos próprios do GitHub para fechar issues vinculadas a PRs. Conferir a seção seguinte.

## 6. Como relacionar issue e PR sem antecipar a conclusão

No fluxo inicial, usar uma referência comum como `Refs #12` na descrição do PR e registrar o link do PR na issue. Isso oferece navegação e rastreabilidade sem usar uma palavra-chave de fechamento.

`Closes`, `Fixes` e `Resolves` podem fechar a issue automaticamente quando a alteração é incorporada à branch padrão. Vínculos manuais pela área **Development** também podem produzir fechamento no merge. Uma referência comum não é a mesma coisa que um vínculo de fechamento. [Documentação oficial do GitHub](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue).

Se a issue ainda exige conferência após o merge ou QA adicional, preservar a referência comum e o encerramento explícito. Se houver decisão específica de usar fechamento automático em uma entrega já validada, registrar essa escolha e conferir o resultado; não inferir conclusão somente pelo merge.

Um PR pode atender parte de uma issue. Nesse caso, registrar quais critérios foram atendidos e o que falta, mantendo o acompanhamento aberto. Separar em novas issues somente quando o trabalho ganhar escopo próprio, preservando as referências e a decisão sobre a divisão.

## 7. Rotina de uma entrega

1. **Antes de executar:** ler estado atual, issue e documento de regra pertinente; identificar versão, ambiente/backend, escopo, evidência existente e autorização.
2. **Durante o trabalho:** registrar decisões, achados e evidências úteis, sem repetir preparação ou testes amplos por conveniência.
3. **Perto do PR:** levantar os documentos afetados e os relatórios úteis; apresentar a seleção ao PM.
4. **Ao preparar o PR autorizado:** incluir as atualizações e os documentos selecionados, descrever problema, resultado, verificação e limites; referenciar a issue.
5. **Na revisão:** conferir o head remoto, diff, regras e evidências; verificar que os documentos descrevem o que foi demonstrado.
6. **Na QA, quando aplicável:** escolher os casos relevantes, registrar versão/ambiente e resultado por caso; um cenário não executado não equivale a aprovado.
7. **Na integração autorizada:** conferir o merge e a versão resultante, sem tratar integração como deploy, migração ou validação geral do produto.
8. **No encerramento:** conferir os critérios da issue, registrar resultado e limites, atualizar o estado do cartão e encerrar a issue conforme o escopo combinado.

A mesma pessoa pode acumular papéis; cada conclusão deve mostrar seu método. Antigravity relatar sucesso não substitui a revisão independente do conteúdo remoto publicado.

## 8. Documentação conforme os PRs evoluem

Produzir os registros durante o trabalho. A seleção final perto do PR permite saber o que realmente ajuda a compreender, revisar e continuar a entrega. O PM decide o material a publicar.

### Levantamento para seleção

```text
Documento/arquivo:
Finalidade: regra vigente / estado atual / guia / histórico / evidência
Decisão: atualizar / adicionar / manter no acervo local / não necessário
Mudança ou evidência que justifica:
Versão, data e ambiente, quando aplicáveis:
Revisão de dados sensíveis e portabilidade:
Motivo da seleção ou exclusão:
Responsável pela decisão:
```

### O que atualizar ou adicionar

| Material | Quando mexer |
|---|---|
| README principal e índice docs/README.md | Entrada de leitura, links ou descrição de implementação mudarem. |
| PRD e contratos | Regra aprovada ou contrato mudar; alterações de andamento devem preservar requisitos. |
| ESTADO-ATUAL.md | Entrega, pendência, versão de referência ou limite conhecido mudar de forma relevante. |
| Guias de QA e de ambientes | A forma de acessar, executar ou registrar trabalho mudar. |
| Relatório histórico datado | Houver ensaio, decisão ou verificação que ajude a revisar/continuar e mereça preservação. |
| Evidência selecionada | For necessária para entender o resultado e puder ser compartilhada com segurança. |
| Este guia e README do Project | O processo de issues, PRs, documentação ou configuração de acompanhamento mudar. |

- **Regra vigente:** manter uma referência principal; não criar cópias concorrentes do mesmo PRD.
- **Estado atual:** refletir o presente e apontar evidências; identificar quando um SHA é referência histórica anterior ao próprio PR documental.
- **Histórico:** preservar a observação da data original. Uma correção factual deve ficar identificada e ligada à evidência que a motivou; uma evolução posterior deve ser contextualizada sem apagar o que ocorreu.
- **Evidência:** distinguir teste automatizado, revisão documental, interface sintética e ensaio real. Registrar versão, backend, método, resultado e alcance.
- **Acervo local:** manter configurações, sessões, dumps e registros operacionais não selecionados em local controlado. Uma descrição ou relatório sanitizado pode entrar quando aprovado; a pasta inteira do laboratório não entra automaticamente.

Atualizar os documentos no PR da entrega ou em um PR documental relacionado, conforme o escopo autorizado. Para uma alteração pequena, uma explicação de que não há documentação adicional relevante pode bastar; não produzir relatório somente para cumprir quantidade.

Na descrição do PR, incluir “Documentação incluída/atualizada” e “Registros mantidos no acervo local”, com motivo. Registrar lacunas por issue quando houver trabalho acompanhável.

### Conferência proporcional ao material

Verificar conteúdo, links, codificação, referências e sensíveis. Capturas precisam de inspeção visual. Ao comparar um pacote com o commit publicado, distinguir igualdade byte a byte de conteúdo igual após normalização de quebras de linha. Hash bruto diferente não deve ser declarado coincidente com o manifesto original.

Não executar a suíte inteira, build, instalação ou ensaio de banco somente porque foram alterados textos. Selecionar verificações funcionais quando houver mudança relacionada, falha nova ou preocupação concreta, respeitando as autorizações.

## 9. Critérios para concluir e preservar o histórico

Antes de mover para Concluído e fechar como completed:

- Conferir critérios da issue e documentos afetados.
- Registrar PR, head/merge e ambiente relevantes.
- Informar verificações e seus resultados, incluindo bloqueados/não executados.
- Conferir a versão incorporada quando houve merge.
- Registrar limites e pendências que seguem em acompanhamento.
- Manter links para documentos e evidências selecionadas.

Para duplicidade, desistência ou trabalho não planejado, encerrar com o motivo apropriado e referências úteis, sem declarar entrega aprovada nem inventar execução. A conclusão de uma issue não prova conformidade integral do PRD ou aprovação de todos os cenários de QA.

Exemplos de referência: [issue #10](https://github.com/dgnoleto/escala-do-reino/issues/10) encerrada após o [PR #11](https://github.com/dgnoleto/escala-do-reino/pull/11) e conferência dos documentos na main; [issue #12](https://github.com/dgnoleto/escala-do-reino/issues/12) registrou uma manutenção documental em Backlog. Consultar o estado atual dessas issues, sem presumir que o exemplo preserve seu status para sempre.

## 10. Cuidados e continuidade

Não publicar senhas, tokens, sessões, links reais de convite/recuperação, configurações reais ou dados pessoais desnecessários. Preferir referências portáveis e dados fictícios. Senhas são inseridas pela pessoa diretamente no destino; não pedir ou copiar valores para a conversa.

Antes de teste, identificar a interface e seu backend. Localhost pode apontar para o piloto. Preservar contas, dados, prazos, serviços e evidências existentes; [consultar o mapa de ambientes](ambientes/LABORATORIOS.md).

Para continuar com uma IA, começar pelo [índice documental](README.md), este guia, estado atual e issue selecionada. Consultar os demais detalhes somente quando necessários. Ao passar o trabalho, informar versão, resultado comprovado, limites, pendências e próximo passo exato.

Fontes técnicas de referência: [Projects](https://docs.github.com/en/issues/planning-and-tracking-with-projects/learning-about-projects/about-projects) e [vínculos entre PR e issue](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue). As opções do GitHub podem mudar; reconferir a configuração antes de alterá-la.
