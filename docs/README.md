# Documentação — Escala do Reino

Este índice organiza regras, orientação operacional, arquitetura e histórico. Começar pelo [estado atual](ESTADO-ATUAL.md), pelo [PRD](PRD.md) e pelo [fluxo operacional multiagente](operacao/FLUXO-MULTIAGENTE.md).

---

## 1. Documentos Centrais (Raiz de `docs/`)

- [Estado Atual](ESTADO-ATUAL.md): versão de referência, branches, status de testes e entregas recentes.
- [PRD](PRD.md): escopo geral, regras de negócio e critérios de aceitação do MVP.
- [Cadastro e Planejamento de Eventos](CADASTRO-PLANEJAMENTO-EVENTOS.md): contrato normativo das Issues #28, #29 e #30 (edições de culto, programação e durações).
- [Roteiro de Navegador Local (013)](ROTEIRO-NAVEGADOR-LOCAL-013.md): roteiro técnico de ensaio em navegador local com fixtures.
- [Matriz de Fechamento da Issue #18](FECHAMENTO-ISSUE18-MATRIZ.md): matriz normativa dos seis pontos de fechamento do ciclo de vida de membros.
- [Governança Multiagente (Raiz)](../AGENTS.md): papéis, autoridade final e regras de governança conjunta.

---

## 2. Produto e Funcionalidades (`docs/produto/`)

- [Cadastro Administrativo da Igreja](produto/CADASTRO-IGREJA.md): endereço, link do Maps, logo privada e edição de nome da igreja (017 e 019).
- [Cadastro de Membros](produto/CADASTRO-MEMBROS.md): cadastro, listagem administrativa paginada e proteção contra duplicação.
- [Modelos Reutilizáveis de Culto](produto/CADASTRO-MODELOS-CULTO.md): modelos de liturgia com atividades e apoios padrão (Issue #27).
- [Tipos de Evento e Atividades Padrão](produto/CADASTRO-TIPOS-ATIVIDADES.md): tipos e atividades com durações padrão configuráveis (Issue #25).
- [Motivos de Cancelamento de Atividades](produto/CADASTRO-MOTIVOS-CANCELAMENTO.md): motivos ativos mantidos na web sem justificativa livre (Issue #26).
- [Criação de Igreja](produto/CRIACAO-IGREJA.md): fluxo "Criar minha igreja", criação atômica e limite de 1 administração ativa.
- [Evolução Futura](produto/EVOLUCAO-FUTURA.md): backlog estratégico e decisões preservadas da governança.
- [Visão do Ecossistema](produto/VISAO-ECOSSISTEMA.md): manifesto estratégico e visão da Plataforma do Reino.

---

## 3. Arquitetura e Modelagem Técnica (`docs/arquitetura/`)

- [Arquitetura do Banco e Permissões](arquitetura/ARQUITETURA-BANCO.md): modelo relacional, schemas `public` e `app_private`, isolamento multi-tenant e RLS.
- [Schema Inicial de Igreja e Acesso](arquitetura/SCHEMA-ACESSO.md): campos, constraints e modelo de acesso.
- [Schema de Aprovação e Auditoria](arquitetura/SCHEMA-APROVACAO-AUDITORIA.md): aprovação de nomes e tabela de recibos e auditoria de comandos.
- [Fonte Real e Dependências Litúrgicas](arquitetura/CONTRATO-FONTE-REAL-DEPENDENCIAS-LITURGICAS.md): contrato técnico de concorrência e dependências litúrgicas do ciclo de vida.

---

## 4. Acesso, Convites e Permissões (`docs/acesso/`)

- [Acesso e Auditoria](acesso/ACESSO-E-AUDITORIA.md): fluxo detalhado de autenticação, concessão e trilha de auditoria.
- [Consulta do Próprio Acesso](acesso/CONSULTA-ACESSO.md): contrato da RPC `get_my_church_access()`.
- [Contrato de Convites de Acesso](acesso/CONTRATO-CONVITES-ACESSO.md): emissão, estados, primeiro acesso com senha própria, resgate e seleção de igreja.

---

## 5. Operação e Governança (`docs/operacao/`)

- [Fluxo Operacional Multiagente](operacao/FLUXO-MULTIAGENTE.md): ciclo em 7 etapas, critérios de revisão independente e protocolo de retomada.
- [Guia de Trabalho no GitHub](operacao/GUIA-TRABALHO-GITHUB.md): fluxo de branches, issues, projetos Kanban e pull requests.

---

## 6. QA e Testes (`docs/qa/`)

- [Guia de Entrada de QA](qa/GUIA-ENTRADA-QA.md): roteiro inicial de onboarding para garantia da qualidade.
- [Setup de QA no Windows 11](qa/GUIA-SETUP-QA-WINDOWS11.md): preparação de ambiente local de teste.
- [Acessos e Confidencialidade de QA](qa/ACESSOS-E-CONFIDENCIALIDADE-QA.md): autenticação, variáveis e cuidados de segurança.
- [Roteiro de QA e Registro de Achados](qa/ROTEIRO-QA-E-REGISTRO.md): metodologia para reporte padronizado de problemas.

---

## 7. Ambientes e Laboratórios (`docs/ambientes/`)

- [Mapa de Ambientes e Laboratórios](ambientes/LABORATORIOS.md): topologia de bancos locais, contêineres e piloto Supabase.

---

## 8. Histórico e Relatórios de Homologação (`docs/historico/`)

- [Homologação Gate 2 SQL 024 — 20/10/2026](historico/2026-10-20-ensaio-seguranca-instanciacao-024.md).
- [Validação Planejamento de Eventos (#28-#30) — 18/10/2026](historico/2026-10-18-validacao-planejamento-eventos-issues-28-29-30.md).
- [Validação Modelos de Culto (#27) — 18/10/2026](historico/2026-10-18-validacao-modelos-culto-issue27.md).
- [Validação Tipos e Atividades (#25) — 18/10/2026](historico/2026-10-18-validacao-tipos-atividades-issue25.md).
- [Validação Motivos de Cancelamento (#26) — 18/10/2026](historico/2026-10-18-validacao-motivos-cancelamento-issue26.md).
- [Validação Confirmação e Recuperação (#24) — 18/10/2026](historico/2026-10-18-validacao-confirmacao-recuperacao-issue24.md).
- [Instalação/Validação 017 no Laboratório — 18/10/2026](historico/2026-10-18-instalacao-e-validacao-cadastro-igreja-017.md).
- [Aplicação 017 no Piloto — 18/10/2026](historico/2026-10-18-aplicacao-cadastro-igreja-017-piloto.md).
- [Ensaio SQL 017 — 18/10/2026](historico/2026-10-18-ensaio-cadastro-igreja-017.md).
- [Checkpoint Bloco 1 (#12/#18) — 16/10/2026](historico/CHECKPOINT-BLOCO1-FECHAMENTO-12-18.md).
- [Checkpoint Bloco 2 (#12/#18) — 16/10/2026](historico/CHECKPOINT-BLOCO2-FECHAMENTO-12-18.md).
- [Revisão Candidata Issue #12 — 16/10/2026](historico/REVISAO-CANDIDATA-ISSUE12.md).
- [Preparação de Entrada de QA — 11/10/2026](historico/2026-10-11-preparacao-qa.md).
- [Verificação da Porta 3000 — 11/10/2026](historico/2026-10-11-verificacao-localhost-3000.md).

---

## 9. Scripts e Roteiros SQL (`docs/sql/`)

- Scripts de migração, preflights, ensaios transacionais, verificações e rollbacks de 001 a 024.
