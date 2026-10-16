# Revisão Documental Candidata da Issue #12

- **Data de Avaliação:** 16/10/2026
- **Referência Canônica do Commit:** `1c8dbb0fbc40f056ec46f092b6ab4f009595a3c0`
- **Branch Candidata:** `refs/heads/docs/ajuste-visao-e-evolucao`
- **Arquivo Alvo:** `docs/EVOLUCAO-FUTURA.md`
- **Alinhamento com a Matriz de Aceite:** Critérios `D12-01`, `D12-02`, `D12-03` e `D12-04` de `MATRIZ-ACEITE.md`.

---

## 1. Contexto e Avaliação do Commit `1c8dbb0`

A issue #12 tem como objetivo corrigir declarações de implementação desatualizadas no documento `docs/EVOLUCAO-FUTURA.md`, preservando rigorosamente as decisões tomadas, os registros históricos e o catálogo integral de propostas pós-MVP.

A inspeção detalhada do commit `1c8dbb0fbc40f056ec46f092b6ab4f009595a3c0` confirma que:
1. Ele altera **estritamente 1 arquivo** (`docs/EVOLUCAO-FUTURA.md`), com 7 adições e 3 exclusões (10 linhas afetadas no total).
2. O commit encontra-se isolado na branch `docs/ajuste-visao-e-evolucao`, sem commits espúrios, sem mistura de código funcional e sem conflito com a árvore `main`.
3. Nenhuma regra de produto, proposta futura ou distinção arquitetural foi suprimida.

---

## 2. Diferenciação entre Referências Históricas e Texto Atual

### 2.1 Seção 10: Provedores de Login (Critério D12-01)
- **Decisão Vigente:** Apple e Microsoft foram definitivamente descartados nesta etapa pelo responsável devido aos custos de configuração avaliados. O MVP mantém Google e e-mail/senha gerenciados via Supabase Auth.
- **Registro Histórico de 03/10/2026:** naquele momento da documentação inicial, apenas Google estava ativo na interface visual. Essa nota descreve a foto histórica daquele dia e não a interface incorporada posteriormente.
- **Andamento Conferido em 13/10/2026:** os PRs [#8](https://github.com/dgnoleto/escala-do-reino/pull/8) e [#9](https://github.com/dgnoleto/escala-do-reino/pull/9) entregaram o fluxo web de convites e primeiro acesso com autenticação por e-mail/senha nativa, com senha definida pelo próprio usuário, orientação de confirmação e retomada protegida. Google permanece suportado. Criar uma conta Auth não concede privilégio ou vínculo à igreja. Os limites de validação no piloto real (SMTP para membros reais) continuam explicitamente ressalvados.

### 2.2 Seção 12: Sequência de Governança e Etapas do MVP (Critério D12-02)
- **Etapa 2 (Criação de igreja e administração):** entregue no código e scripts 009/010, integrada à `main` no merge `d372a58` (PR #7).
- **Etapa 3 (Convites e seleção de contexto):** entregue no código e scripts 011/012, integrada à `main` nos merges `04be37e` e `84bf20f` (PRs #8 e #9, referência funcional `ba852599a5b816cfab9d44161129eb87bec1ca99`).
- **Etapa 4 (Exclusão lógica e recuperação — Issue #18):**
  - **Estado no commit 1c8dbb0 (13/10/2026):** registrava que a etapa 4 permanecia sem implementação como o próximo incremento oficial da governança.
  - **Estado Atual da Execução Coordenada (16/10/2026):** a issue #18 permanece aberta até a implementação completa da fonte real de dependências litúrgicas e validação dos ensaios de concorrência e exclusão lógica efetiva (E20/E21).

---

## 3. Preservação Integral das Ideias e Módulos Futuros (Critério D12-03)

Todas as seções de evolução pós-MVP permanecem 100% intactas no documento, mantendo o status de **propostas futuras não comprometidas e sem prioridade fixada**:
- **Seção 1:** Módulo de Treinamento, Cursos e Voluntariado (trilhas, capacitação, pré-requisitos litúrgicos).
- **Seção 2:** Seminários, Conferências e Simpósios (inscrições, lotes, credenciamento por QR Code, cronograma intensivo).
- **Seção 3:** Módulo Financeiro e Arrecadação (dízimos, ofertas, prestação de contas pastoral).
- **Seção 4:** Comunicação, Avisos e Notificações Push (mensagens direcionadas por equipe, avisos gerais).
- **Seção 5:** Gestão de Células e Pequenos Grupos (anfitriões, relatórios de reunião, multiplicação).
- **Seção 6:** Secretaria e Membresia Avançada (dados batismais, histórico civil, transferências por carta).
- **Seção 7:** Aplicativo Mobile Dedicado (Android e iOS nativos).
- **Seção 8:** Gestão de Patrimônio e Equipamentos (inventário de som, instrumentos, controle de empréstimos).
- **Seção 9:** Multi-Câmpus e Redes de Igrejas (sede e congregações, visão consolidada pastoral).
- **Seção 13:** Painéis de Indicadores e Relatórios Gerenciais (frequência de voluntários, tempo médio de culto).

Nenhum desses módulos é antecipado, descartado ou considerado em andamento por esta revisão documental.

---

## 4. Projeção da Atualização Final da Seção 12 no Fechamento da #18

Para que a documentação reflita a verdade do sistema ao final do plano conjunto, a Seção 12 receberá a seguinte redação final quando o incremento efetivo da issue #18 for testado, aprovado e integrado:

```markdown
4. **Exclusão lógica e recuperação (entregues no código, scripts e testes, integrados via PR #18):** implementação de exclusão lógica idempotente via `deactivate_church_member` e restauração via `restore_church_member` na coluna `status` ('active'/'inactive') da tabela `app_private.members`. O fluxo realiza verificação transacional de dependências operacionais reais (liderança de equipes ativas, liderança de liturgia em eventos futuros ou em andamento e alocações nominais em escalas ativas); invalida convites abertos e encerra solicitações pendentes; revoga acesso administrativo/membro estritamente na igreja em questão sem apagar conta Auth ou afetar outras igrejas; protege a continuidade do último administrador ativo; grava auditoria atômica em `app_private.audit_entries` e recibo em `app_private.command_receipts`. A restauração reativa apenas o cadastro do membro sem conceder automaticamente login, administração ou liderança anterior. Códigos SQL 013 a 016 e suíte de testes de concorrência e interface verificados no ambiente de aceite.
```

> [!IMPORTANT]
> **Condição de Publicação:** Este texto acima NÃO será aplicado agora. Ele constitui a redação projetada para a conclusão definitiva do plano conjunto. Neste momento do Primeiro Bloco, a issue #18 permanece aberta e o commit `1c8dbb0` permanece como candidato formal.
