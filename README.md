# Escala do Reino

**Organize os eventos e as equipes da sua igreja.**

Projeto de um gestor de horários, programação e escalas para eventos de igrejas. O piloto previsto é o **Ministério Shalom**.

## Etapa atual

Este repositório contém a documentação inicial do produto. **Não há aplicação implementada, stack escolhida ou arquitetura definida.** As regras confirmadas, propostas e pendências estão identificadas no [PRD — documento de requisitos do produto](docs/PRD.md).

## Problema e proposta

Líderes montam escalas separadamente, por WhatsApp ou pessoalmente. Quando um membro participa de várias equipes, pode receber funções incompatíveis no mesmo horário. Recusas e faltas exigem buscar substitutos sem uma visão comum da programação.

O Escala do Reino pretende reunir programação, disponibilidade, convites, confirmações e substituições, mantendo visíveis os responsáveis e os conflitos. Abrange eventos como cultos, simpósios e retiros, com equipes como louvor, dança, teatro, transmissão, sonoplastia, portaria, crianças, cozinha e limpeza.

## Canais previstos

| Canal | Finalidade |
| --- | --- |
| Web | Administração e planejamento: cadastros, configurações, eventos, programação e montagem das escalas. |
| App mobile | Operação: consulta, disponibilidade, respostas aos convites, cancelamento de participação, notificações e substituições de vagas existentes. |

O app não terá cadastros administrativos nem criação de eventos ou escalas iniciais, inclusive para administradores. Ambos os canais trabalharão sobre os mesmos dados e respeitarão as permissões. O formato tecnológico do app permanece aberto.

## Como o projeto deve avançar

1. Validar regras de negócio, fluxos e programação dos eventos, resolvendo as pendências que afetarem cada etapa.
2. Definir a arquitetura com base nessas regras.
3. Desenhar a aplicação e seus fluxos de uso.
4. Desenvolver com apoio de IA em incrementos pequenos e verificáveis, usando os cenários do PRD como critérios de aceite.

As propostas registradas não devem ser tratadas como decisões aprovadas. Exemplos de horários e durações não são padrões universais. O PRD descreve comportamento esperado, e não funcionalidades já entregues.
