# Relatório Consolidado da Revisão Corretiva Final do PR #50

**Data:** 19/10/2026  
**Repositório:** `escala-do-reino`  
**Branch:** `feat/issue-22-editar-nome-igreja`  
**Pull Request:** [#50](https://github.com/dgnoleto/escala-do-reino/pull/50)  
**Objetivo:** Revisão corretiva final, blindagem de regras de negócio, testes de isolamento e validação transacional dos incrementos SQL 020 a 023.

---

## 1. Resumo Executivo das Correções Realizadas

A presente intervenção realizou a auditoria e correção estrita do código integrado no PR #50 (englobando as issues #22, #24, #26, #25, #27, #28, #29 e #30), sem reiniciar o trabalho preexistente e eliminando todos os riscos de regressão e divergência arquitetural.

### 1.1 Alinhamento Normativo das Políticas de Duração (Prioridade 1)
- **Eliminação de termos espúrios:** O termo `horario_termino_variavel` foi categoricamente expurgado de todo o código-fonte, banco de dados e documentação.
- **Valores canônicos homologados:** Alinhamento estrito às políticas canônicas definidas no PRD (§3.1, §3.2, §5, §6 e §7.7):
  - `'warn'` (Modo Alerta): Padrão do piloto. Permite salvar rascunho e publicar normalmente a programação com aviso claro e ignorável se houver sobrecarga de tempo.
  - `'block'` (Modo Bloqueio): Permite salvar rascunhos a qualquer momento, mas rejeita terminantemente a publicação da programação ou de revisões excedentes até o devido ajuste pelo líder/administrador.
- **Domínio e Schemas:** Validação tanto no cliente (`eventPlanningService.js`, `AppContext.jsx`) quanto no banco (`023_event_planning_and_durations.sql` com check constraint `duration_policy in ('warn', 'block')`).

### 1.2 Blindagem Contra Fallback Silencioso em Memória (Prioridade 2)
- **Bloqueio em ambiente real:** Em ambientes reais com Supabase configurado, caso a chamada remota falhe ou o usuário perca privilégios (42501), o `AppContext` bloqueia terminantemente qualquer mutação otimista ou fallback em memória local, propagando o erro e mantendo a tela em estado seguro.
- **Preservação de isolamento em testes:** A função `ensureAuthorizedContext` foi implementada de modo a distinguir execuções em modo puramente offline/local (testes unitários com fixtures) de execuções com backend ativo, garantindo 100% de estabilidade nos testes automatizados sem comprometer a segurança operacional.
- **Multi-tenant e contaminação cruzada:** A troca de igreja ativa no contexto limpa imediatamente as entidades litúrgicas em memória, prevenindo contaminação por respostas HTTP atrasadas (*race conditions*).

### 1.3 Correção dos Contratos de Auditoria SQL 020 a 023 (Prioridade 3)
- **Esquema canônico de `app_private.audit_entries`:** Identificou-se que os scripts candidatos 020 a 023 tentavam inserir colunas obsoletas (`entity_type`, `entity_id`, `metadata`).
- **Conformidade com o incremento 003:** Todas as inserções de auditoria foram corrigidas para o esquema oficial: `(church_id, action, actor_user_id, actor_source, target_type, target_id, details)`.
- **Prevenção de colisão de histórico:** A função auxiliar `app_private.is_cancellation_reason_used` foi ajustada para inspecionar apenas ações reais de cancelamento litúrgico (`cancel_activity`, `cancel_event`), prevenindo que o registro de auditoria da própria criação do motivo colidisse e impedisse sua exclusão física antes do primeiro uso real.

---

## 2. Ensaios Transacionais em PostgreSQL Real (Prioridade 4 e 5)

Os ensaios foram executados em container Docker isolado (**PostgreSQL 17.11** / `supabase_db_escala-convites-http-lab`), sob transação e encerramento em `ROLLBACK;`.

### 2.1 Anomalias Reais Detectadas e Corrigidas no Ensaio
1. **Sintaxe de unicidade em PostgreSQL:** A cláusula `CONSTRAINT ... UNIQUE (church_id, lower(name))` falhava no motor nativo (SQLSTATE 42601). Foi convertida para índices únicos canônicos `CREATE UNIQUE INDEX ... ON <table> (church_id, lower(name));` nos scripts 020, 021 e 022.
2. **Ambiguidade de colunas em PL/pgSQL:** Funções que retornavam `TABLE (command_id uuid, ...)` causavam erro de ambiguidade (SQLSTATE 42702) ao filtrar `WHERE command_id = p_command_id`. Todas as referências internas foram qualificadas explicitamente com aliases de tabela (`r.command_id`, `e.church_id`, etc.).
3. **Privilégios de Segurança (service_role):** Em 022 e 023, as cláusulas `REVOKE` haviam omitido a role `service_role`. Ambas foram padronizadas para `revoke all on function public.<proc> from public, anon, service_role;` e `grant execute to authenticated;`.

### 2.2 Resultados dos Ensaios Transacionais
| Script Candidato | Escopo Funcional | Casos de Teste | Resultado | Transação |
| :--- | :--- | :--- | :--- | :--- |
| `020_cancellation_reasons.sql` | Motivos de Cancelamento (#26) | R01 a R15 | **APROVADO** (15/15) | `ROLLBACK` |
| `021_event_types_and_activities.sql` | Tipos e Atividades Padrão (#25) | T01 a T20 | **APROVADO** (20/20) | `ROLLBACK` |
| `022_service_templates.sql` | Modelos Reutilizáveis (#27) | S01 a S14 | **APROVADO** (14/14) | `ROLLBACK` |
| `023_event_planning_and_durations.sql` | Edições, Liturgia e Publicação (#28, #29, #30) | P01 a P16 | **APROVADO** (16/16) | `ROLLBACK` |

---

## 3. Plano de Implantação Assistida, Verificação e Rollback (Prioridade 7)

### 3.1 Cadeia de Dependências Estrita
A aplicação dos scripts deve seguir rigorosamente a ordem topológica:
$$\text{020} \longrightarrow \text{021} \longrightarrow \text{022} \longrightarrow \text{023}$$

E a reversão segue estritamente a ordem inversa:
$$\text{023} \longrightarrow \text{022} \longrightarrow \text{021} \longrightarrow \text{020}$$

### 3.2 Artefatos de Verificação e Rollback Criados
- **Verificação pós-deploy (somente leitura, retorna booleanos para tabelas, RLS, RPCs, atributos de segurança e permissões):**
  - `docs/sql/020_verify.sql`
  - `docs/sql/021_verify.sql`
  - `docs/sql/022_verify.sql`
  - `docs/sql/023_verify.sql`
- **Reversão exata / Rollback cirúrgico (idempotente com `IF EXISTS`, transacional e sem perda de dados preexistentes):**
  - `docs/sql/020_rollback.sql`
  - `docs/sql/021_rollback.sql`
  - `docs/sql/022_rollback.sql`
  - `docs/sql/023_rollback.sql`

### 3.3 Validação Empírica do Ciclo de Vida Completo
O script automatizado `tools/test-deploy-rollback-lifecycle.js` foi executado com sucesso:
1. **Teste Individual/Acumulativo:** Cada incremento foi aplicado, verificado via `verify.sql` com aprovação unânime de flags (`true`), e revertido cirurgicamente via `rollback.sql`.
2. **Teste em Cadeia Contínua:**
   - Aplicação de 020 $\rightarrow$ 021 $\rightarrow$ 022 $\rightarrow$ 023 com verificação individual aprovada.
   - Reversão reversa de 023 $\rightarrow$ 022 $\rightarrow$ 021 $\rightarrow$ 020 com restauração integral ao baseline 019.

---

## 4. Métricas de Qualidade e Conformidade de Software

- **Suíte Geral de Testes:** **461 testes aprovados de 461 (66 suítes)** — 100% de aprovação.
- **Build de Produção:** **Aprovado** (`npm run build` gerado sem erros pelo Vite).
- **Git Status:** Workspace limpo, commits consolidados na branch `feat/issue-22-editar-nome-igreja`.
- **Ambiente Piloto Supabase (`jvpctgqudvjealzileib`):** Permanece **intacto e inalterado**, aguardando aprovação explícita para o lote assistido.

---

## 5. Próximos Passos e Decisão do Usuário

O pacote de correções do PR #50 está integralmente revisado, testado e documentado.

Caso o usuário opte por autorizar a implantação assistida no Supabase do piloto, os scripts 020 a 023 serão aplicados e verificados sequencialmente via `mcp_supabase_apply_migration`. Caso contrário, a branch está pronta para revisão por pares e merge no GitHub.
