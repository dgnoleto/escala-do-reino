# Preparação da entrada de QA — registro histórico de 11/10/2026

Este documento preserva as pendências identificadas antes da primeira publicação dos guias. Os documentos foram aprovados pelo responsável posteriormente no mesmo dia. Consultar a [issue #10](https://github.com/dgnoleto/escala-do-reino/issues/10) e o [estado atual](../ESTADO-ATUAL.md) para saber quais itens ainda estão abertos. Publicar este relatório não conclui automaticamente a atualização de todos os documentos.

## O que já existe

PRD, contrato de convites, cadastro de membros, criação de igreja, consulta de acesso, arquitetura, schema, auditoria e evolução futura já estão versionados em docs/. O pacote aprovado adiciona um [guia de entrada](../qa/GUIA-ENTRADA-QA.md) e um [roteiro/registro de QA](../qa/ROTEIRO-QA-E-REGISTRO.md).

## Ajustes concretos identificados

1. README: atualizar declarações de ausência de e-mail/senha e de convites em preparação, contagens históricas de testes e estado de instalação/validação. Manter históricos identificados por data em vez de substituir evidências antigas como se nunca tivessem existido.
2. PRD: atualizar o parágrafo de estado de implementação que ainda descreve convites em preparação. Preservar regras e distinguir escopo futuro de funcionalidade entregue.
3. Contrato de convites: contextualizar o cabeçalho e as seções iniciais como origem documental histórica, diante da implementação descrita na seção 11; alinhar datas e estado atual sem reaprovar silenciosamente propostas antigas.
4. Documentação operacional: incluir mapa de ambientes, explicar que localhost:3000 atualmente aponta para o piloto e identificar o laboratório HTTP existente. Portas, caminhos absolutos e configurações específicas desta máquina não devem ser apresentados como setup universal.
5. Evidências: selecionar registros sanitizados e portáveis para a QA, com commit, ambiente, resultado e limite. Evitar depender de chats e caminhos locais inacessíveis em outro computador. Não publicar toda a pasta de laboratório.
6. Entrada da QA: definir conta GitHub e conceder acesso ao repositório privado mediante ação autorizada; combinar computador/ambiente de trabalho e permissões necessárias. Nenhum acesso foi concedido nesta preparação.

## Encaminhamento definido na preparação

O responsável aprovou os guias e autorizou a primeira publicação documental. Antigravity incorpora o material no incremento documental e Codex revisa sua consistência com PRD e evidências. A rotina de QA ainda será combinada. Merge, deploy, SQL no piloto e incrementos posteriores mantêm suas autorizações próprias. Antes de qualquer nova execução de QA, identificar o alvo e verificar a necessidade da rodada.

