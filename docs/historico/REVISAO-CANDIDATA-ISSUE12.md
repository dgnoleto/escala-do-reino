# Revisão Candidata Fiel — Issue #12

- **Data da Avaliação:** 16/10/2026
- **Fonte Canônica Conferida:** `git show 1c8dbb0fbc40f056ec46f092b6ab4f009595a3c0:docs/EVOLUCAO-FUTURA.md` e diff isolado desse commit.
- **Branch Candidata:** `refs/heads/docs/ajuste-visao-e-evolucao`
- **Arquivo Alvo:** `docs/EVOLUCAO-FUTURA.md`
- **Alinhamento com a Matriz de Aceite:** Critérios `D12-01`, `D12-02`, `D12-03` e `D12-04`.
- **Ressalva de Governança:** Este documento não altera a branch documental nem certifica integração prévia ou teste de produto antes da validação do Bloco 2.

---

## 1. Conteúdo Real do Candidato (Commit `1c8dbb0`)

O commit isolado `1c8dbb0fbc40f056ec46f092b6ab4f009595a3c0` altera estritamente 1 arquivo (`docs/EVOLUCAO-FUTURA.md`), com 7 adições e 3 exclusões (10 linhas no total), restritas às **Seções 10 e 12**.

Ele contextualiza a observação histórica de "apenas Google ativo" em 03/10/2026, registra e-mail/senha e convites incorporados à `main` nos PRs #8 e #9, preserva a regra de senha definida pela própria pessoa e distingue expressamente conta Auth de acesso à igreja. Mantém os limites de primeiro acesso/SMTP do piloto e as evidências históricas de 13/10/2026.

### 1.1 Seções Reais do Documento `docs/EVOLUCAO-FUTURA.md`

A estrutura de seções do documento original foi estritamente verificada no repositório:

| Seção | Título Real | Status da Preservação |
| :---: | :--- | :--- |
| **1** | Disponibilidade, convites de participação e confirmação | Preservada integralmente (ideia futura sem prioridade) |
| **2** | Check-in de presença no local | Preservada integralmente (ideia futura sem prioridade) |
| **3** | Participação aberta | Preservada integralmente (ideia futura sem prioridade) |
| **4** | Dashboards e aprendizado | Preservada integralmente (ideia futura sem prioridade) |
| **5** | Outros eventos, modelos e turnos | Preservada integralmente (ideia futura sem prioridade) |
| **6** | Dependências e regras amplas | Preservada integralmente (ideia futura sem prioridade) |
| **7** | Delegação, compartilhamento e limite para retorno | Preservada integralmente (ideia futura sem prioridade) |
| **8** | Limites e ideias não aprovadas | Preservada integralmente (ideias descartadas e limites do produto) |
| **9** | Modularização e novos módulos | Preservada integralmente (contém Cursos, Simpósios, Financeiro, Células e Patrimônio) |
| **10** | Provedores de login (descarte definitivo de Apple e Microsoft) | Atualizada no commit 1c8dbb0 (contexto e-mail/senha entregue no PR #8/#9) |
| **11** | Exclusão lógica e recuperação de cadastros (Etapa 4 do MVP) | Preservada integralmente (decisão de 03/10/2026 e diretrizes da Etapa 4) |
| **12** | Sequência de governança e próximos incrementos | Atualizada no commit 1c8dbb0 (registra entrega das etapas 2 e 3 e etapa 4 pendente) |

> [!NOTE]
> **Não existe Seção 13 no candidato.** As ideias de cursos, simpósios, financeiro, células e patrimônio estão todas agrupadas dentro da **Seção 9**, mantendo a condição de possibilidades futuras sem compromisso de entrega, prioridade, prazo ou arquitetura técnica contratada. Nenhuma ideia futura foi transformada em módulo contratado ou excluída.

---

## 2. Diferenciação Fiel entre Referências Históricas e Texto Atual

### 2.1 Seção 10: Autenticação (Critério D12-01)
- **Decisão Vigente:** Apple e Microsoft foram definitivamente descartados em 03/10/2026. O MVP mantém Google e e-mail/senha via Supabase Auth.
- **Registro Histórico de 03/10/2026:** Naquele momento inicial, apenas Google estava ativo na interface visual; essa nota reflete o histórico daquele dia e não a interface atual.
- **Andamento Conferido em 13/10/2026:** Os PRs [#8](https://github.com/dgnoleto/escala-do-reino/pull/8) e [#9](https://github.com/dgnoleto/escala-do-reino/pull/9) incorporaram o fluxo web de convites e primeiro acesso, incluindo e-mail/senha com senha definida pela própria pessoa, orientação de confirmação e retomada protegida do convite. Google permanece disponível. Criar uma conta Auth não concede acesso à igreja. Ressalva-se que a entrega no código não comprova validação integral de SMTP no piloto real para membros reais.

### 2.2 Seção 12: Sequência de Governança (Critério D12-02)
- As etapas 2 e 3 foram integradas à `main` (PRs #7, #8 e #9).
- A etapa 4 (exclusão lógica e recuperação) permanece em implementação na issue #18, com listagem administrativa e restauração elegível entregues no incremento 013, e exclusão efetiva bloqueada no servidor via `P0021` até a conclusão e validação da fonte real de dependências litúrgicas (E20/E21).

---

## 3. Redação Candidata para Acompanhamento no Estado Atual

Para acompanhamento do estado vigente da governança, a nota datada aplicável é:

> **Atualização de acompanhamento em 16/10/2026:** A etapa 4 está em implementação parcial na issue #18. O incremento 013 contém listagem administrativa com filtros, restauração elegível sem concessão de acesso e consulta de recibos; a exclusão efetiva permanece bloqueada no servidor por `P0021` enquanto sua fonte real de dependências não estiver implementada e validada. O plano conjunto mantém a #18 aberta até concluir E20/E21 e as evidências de banco e navegador. Esta atualização não comprova implantação no piloto nem integração do código final.

---

## 4. Redação de Fechamento Condicionada à Entrega Real

Somente após a implementação, validação em ensaios autorizados e revisão final da issue #18, o texto da Seção 12 será atualizado para refletir o encerramento da Etapa 4, utilizando referências concretas (SHAs de commit, número real do PR de fechamento e scripts de migração):

```markdown
4. **Exclusão lógica e recuperação (entregues no código, scripts e testes, integrados via PR #[NUMERO_REAL]):** implementação de exclusão lógica transacional via `deactivate_church_member` e restauração via `restore_church_member` na coluna `status` ('active'/'inactive') da tabela `app_private.members`. O fluxo realiza verificação transacional de dependências operacionais reais (liderança de ministérios ativos, liderança de liturgia em eventos futuros ou em andamento e alocações nominais em escalas ativas); invalida convites abertos e cancela solicitações pendentes não expiradas (preservando o estado temporal de solicitações já expiradas); revoga acesso administrativo/membro estritamente na igreja em questão sem apagar conta Auth ou afetar outras igrejas; protege a continuidade do último administrador ativo; grava auditoria atômica em `app_private.audit_entries` e recibo em `app_private.command_receipts`. A restauração reativa apenas o cadastro do membro sem conceder automaticamente login, administração ou liderança anterior. Códigos SQL [FAIXA_FINAL_SCRIPTS] e suíte de testes de concorrência e interface verificados no ambiente de aceite.
```

> [!IMPORTANT]
> **Rastreabilidade:** Esta redação de fechamento condicionada permanece com marcadores (`[NUMERO_REAL]`, `[FAIXA_FINAL_SCRIPTS]`) e NÃO será aplicada agora, garantindo fidelidade absoluta ao princípio de que documentação não atesta implementações antes da sua comprovação física.
