# Checkpoint 4 — Bloco 2: Implementação da Fonte Real (Incremento 015) e Estratégia de Concorrência

- **Data/Hora:** 2026-10-16 19:30 BRT
- **Contexto:** Execução coordenada aprovada das issues #12 e #18 (`PROMPT-BLOCO2-ANTIGRAVITY.md` e `DECISAO-REVISAO.md`).
- **Branch Ativa:** `feat/issue-18-ciclo-vida-membros`
- **HEAD da Branch:** `80f16fabb23fd7a9cbf87d912aac18b99f7cecb3`
- **Hash Canônico Preservado de 013:** `40709A4FE9FEB688D3BE92564B821DCAC4142F6A588E4ACA585D42FBDB964AF7`

---

## 1. Entregas Locais Realizadas no Bloco 2

### 1.1 Eliminação do Ciclo de Deadlock e Estratégia Comum de Concorrência
- **Resolução do Ciclo:** Fixada a regra em que toda operação que envolva membros e eventos bloqueia `members` **antes** de `events` (em `deactivate_church_member`, `assign_event_participant`, `replace_event_participant`). Isso torna impossível o entrelaçamento onde A segura membro e espera evento enquanto B segura evento e espera membro.
- **Ordenação Multi-Row:** Todas as operações que bloqueiam múltiplas linhas da mesma tabela utilizam obrigatoriamente `ORDER BY id ASC`.
- **Separação de Advisory Locks:** Distinção explícita entre `create_my_church_quota` (criação de igreja), `church_admin_continuity` (continuidade administrativa) e `(user_id, command_id)` (idempotência).

### 1.2 Incremento SQL 015 Versionado em `docs/sql/`
- **`015_preflight_liturgical_dependencies.sql`:** Pré-verificação somente leitura (UTF8, 001–013 ativos, ausência prévia das novas tabelas e RPCs, isolamento de schemas).
- **`015_liturgical_dependencies.sql`:**
  - Tabelas operacionais em `app_private`: `teams`, `team_memberships`, `team_roles`, `member_qualifications`, `events`, `event_items`, `assignments`.
  - Integridade relacional composta multi-tenant por `church_id` em todas as chaves estrangeiras.
  - Gatilhos `touch_updated_at` ativos e `RLS` habilitada nas 7 tabelas.
  - RPCs canônicas implementadas: `create_church_team`, `assign_team_leader`, `create_church_event`, `assign_event_liturgy_leader`, `assign_event_participant`, `replace_event_participant`, `finish_event_service`, `list_church_teams`, `list_church_events`.
  - Autorização estrita: Admin ou Líder de Ministério Ativo criam eventos (líder de ministério proibido de designar liturgia); Líder de Equipe aloca na sua equipe; Liturgia conduz o culto e substituições emergenciais.
- **`015_validate_liturgical_dependencies.sql`:** Ensaio transacional completo com `ROLLBACK`, comprovando recusa de chaves estrangeiras entre igrejas distintas, validação de aptidão e regras de liturgia sem persistência residual.
- **`015_verify_liturgical_dependencies.sql`:** Verificação pós-instalação projetando 6 asserções booleanas estritas.

### 1.3 Módulo Cliente e Atualização de Erros
- **`src/utils/liturgicalCommandService.js`:** Despacho das RPCs de equipes, eventos e alocações, classificação de erros litúrgicos (`isDefinitiveLiturgicalError`), consultas reais de produto.
- **`src/utils/memberCommandService.js`:** Adicionados `P0015`, `P0016`, `P0020`, `P0022`, `P0023`, `P0024`, `P0025` em `isDefinitiveServerError` e mensagens informativas em `dispatchMemberDeactivation`.
- **`test/liturgical-dependencies.test.js`:** Suíte com 20 testes cobrindo todo o ciclo do 015 e tratamento de erros (100% PASS).
- **Build de Produção:** `npm run build` executado com sucesso (Vite v6.4.3: 0 erros).

---

## 2. Acompanhamento pela Matriz de Aceite (`MATRIZ-ACEITE.md`)

| ID | Critério | Situação Atual no Bloco 2 | Próximo Passo para Conclusão |
| :--- | :--- | :--- | :--- |
| **M18-01** | Contrato/desenho antes das partes dependentes | **Atendido no Bloco 2:** DDL, RPCs e concorrência implementados no 015 local. | Validar no ensaio físico |
| **M18-05** | Servidor valida elegibilidade, permissão, autoexclusão | **Atendido no código:** RPCs 015 e erros mapeados com recusa no servidor. | Ensaio em duas conexões |
| **M18-06** | Último administrador protegido sob concorrência | **Atendido no código:** Advisory lock e gatilhos de 009 integrados. | Ensaio físico de corrida |
| **M18-07** | Membro/acesso/auditoria/recibo atômicos | **Atendido no 015:** Inserções atômicas com audit entries e receipts. | Incremento 016 |
| **M18-10** | Concorrência sem ciclos/deadlocks | **Atendido no desenho/código:** Ordem `members -> events` elimina o ciclo. | Ensaio físico coordenado |
| **M18-12** | Dependência futura/em andamento bloqueia; histórico preserva | **Atendido na fonte real 015:** Tabelas, FKs compostas e predicados implementados. | Incremento 016 e validação |
| **D12-01 a D12-04** | Revisão documental da issue #12 fiel e consistente | **Preparado e fiel:** Commit `1c8dbb0` conferido e minuta de fechamento pronta. | Integração na main |

---

## 3. Limites de Execução Respeitados

- Zero comandos SQL executados contra laboratório ou piloto.
- Contêineres Docker e ambientes mantidos inalterados.
- Nenhuma dependência externa instalada.
- Sem commit/push/PR/merge.
- Testes locais existentes preservados:
  - `test/liturgical-dependencies.test.js`: 20/20 PASS
  - `test/member-lifecycle-cycle.test.js`: 49/49 PASS
  - `test/member-command-cycle.test.js`: 33/33 PASS
  - `test/supabase-client-config.test.js`: 25/25 PASS
