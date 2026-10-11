# Documentação — Escala do Reino

Este índice organiza regras, orientação operacional e histórico. Começar pelo [estado atual](ESTADO-ATUAL.md) e pelo [guia de entrada de QA](qa/GUIA-ENTRADA-QA.md).

## Regras e contratos

- [PRD](PRD.md): escopo, decisões aprovadas e critérios de aceite.
- [Contrato de convites](CONTRATO-CONVITES-ACESSO.md): acesso, nome, estados, recibos e rastreabilidade.
- [Cadastro de membros](CADASTRO-MEMBROS.md), [criação de igreja](CRIACAO-IGREJA.md) e [consulta de acesso](CONSULTA-ACESSO.md).
- [Acesso e auditoria](ACESSO-E-AUDITORIA.md), [arquitetura](ARQUITETURA-BANCO.md), [schema de acesso](SCHEMA-ACESSO.md) e [schema de aprovação/auditoria](SCHEMA-APROVACAO-AUDITORIA.md).
- [Evolução futura](EVOLUCAO-FUTURA.md): assuntos adiados; não transformá-los em requisitos do incremento atual.

## QA e ambientes

- [Guia de entrada de QA](qa/GUIA-ENTRADA-QA.md).
- [Roteiro inicial e registro de achados/resultados](qa/ROTEIRO-QA-E-REGISTRO.md).
- [Mapa de ambientes e laboratórios](ambientes/LABORATORIOS.md).
- [Issues](https://github.com/dgnoleto/escala-do-reino/issues): tarefas, problemas e dúvidas acompanháveis, com referências aos documentos.

## Histórico e evidências selecionadas

- [Preparação da entrada de QA — 11/10/2026](historico/2026-10-11-preparacao-qa.md).
- [Conferência de localhost:3000 — 11/10/2026](historico/2026-10-11-verificacao-localhost-3000.md), com comparação sanitizada e telas de entrada sintética.

Histórico registra o que foi observado naquela data. Uma pendência histórica não deve ser presumida aberta depois; consultar estado atual, issue e PR correspondente.

## Seleção da documentação por PR

Diretriz aprovada pelo responsável em 11/10/2026:

1. Produzir registros úteis durante o trabalho, preservando versão, ambiente, método, resultado e limites.
2. Perto de cada PR, levantar com o responsável os documentos importantes para entender a entrega, revisar ou continuar o projeto. O responsável seleciona o material a publicar.
3. Separar atualização da documentação vigente de novos relatórios históricos. Evitar cópias concorrentes do estado atual.
4. Revisar credenciais, tokens/sessões, links reais de convite/recuperação, dados pessoais, capturas e caminhos específicos da máquina. Usar referências portáveis e exemplos fictícios quando aplicável.
5. Incluir documentos selecionados no PR da entrega ou em PR documental relacionado, conforme o escopo autorizado. Antigravity implementa; Codex revisa coerência e evidências. Registrar na descrição do PR o que foi incluído e o que permaneceu no acervo local controlado, com motivo.
6. Ligar issue, PR e documentos; registrar lacunas em vez de declarar validação não realizada. Não fechar a issue antes de conferir seus critérios.

Senhas, tokens, sessões, dumps, configurações reais e pastas completas de laboratório não compõem automaticamente a documentação compartilhável. Relatórios podem entrar após seleção e revisão; backup operacional e restauração do ambiente são assuntos separados.

O repositório é o destino dos entregáveis documentais aprovados para compartilhar. As pastas locais são área de preparação e acervo operacional. A publicação de documentos não autoriza reinstalar serviços, reaplicar SQL ou reconstruir fixtures.
