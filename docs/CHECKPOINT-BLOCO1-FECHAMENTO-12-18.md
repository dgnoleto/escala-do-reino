# Checkpoint 2 — Bloco 1 Concluído: Contrato e Desenho da Fonte Real e Revisão da #12

- **Data/Hora:** 2026-10-16 18:54 BRT
- **Contexto:** Execução coordenada aprovada das issues #12 e #18 (`PROMPT-EXECUCAO-ANTIGRAVITY.md`).
- **Branch Ativa:** `feat/issue-18-ciclo-vida-membros`
- **HEAD da Branch:** `52e047dd1d7bacc4a2849051381e3dc311feef62`
- **Commit Candidato da #12:** `1c8dbb0fbc40f056ec46f092b6ab4f009595a3c0` (preservado sem alteração)
- **Hash Canônico Preservado de 013:** `40709A4FE9FEB688D3BE92564B821DCAC4142F6A588E4ACA585D42FBDB964AF7`

---

## 1. Status das Entregas do Bloco 1

| Item do Bloco | Descrição do Roteiro | Arquivo de Entrega | Critérios Atendidos na Matriz |
| :--- | :--- | :--- | :--- |
| **B1.1** | Modelo lógico e físico da fonte real de dependências por church_id/member_id | `docs/CONTRATO-FONTE-REAL-DEPENDENCIAS-LITURGICAS.md` (Seção 1 e 2) | `M18-01`, `M18-12` |
| **B1.2** | Matriz de operações e permissões estritas (Admin vs Equipe vs Liturgia) | `docs/CONTRATO-FONTE-REAL-DEPENDENCIAS-LITURGICAS.md` (Seção 3) | `M18-01`, `M18-05` |
| **B1.3** | Regras de estados, tempo e tratamento de informação inconclusiva | `docs/CONTRATO-FONTE-REAL-DEPENDENCIAS-LITURGICAS.md` (Seção 4) | `M18-12` |
| **B1.4** | Ordem global de bloqueios e prevenção de corridas/deadlocks | `docs/CONTRATO-FONTE-REAL-DEPENDENCIAS-LITURGICAS.md` (Seção 5) | `M18-06`, `M18-07`, `M18-10` |
| **B1.5** | Sequência de incrementos SQL versionados (015/016) e plano do cliente web | `docs/CONTRATO-FONTE-REAL-DEPENDENCIAS-LITURGICAS.md` (Seção 6) | `M18-01`, `M18-02`, `M18-08` |
| **B1.6** | Revisão documental candidata da issue #12 sobre o commit `1c8dbb0` | `docs/REVISAO-CANDIDATA-ISSUE12.md` | `D12-01`, `D12-02`, `D12-03`, `D12-04` |

---

## 2. Matriz de Rastreabilidade de Aceite

| ID Matriz | Critério | Situação Anterior | Situação após Bloco 1 |
| :--- | :--- | :--- | :--- |
| `D12-01` | Seção 10 distingue histórico Google e interface e-mail/senha | Preparado no commit `1c8dbb0` | **Revisado e confirmado** em `docs/REVISAO-CANDIDATA-ISSUE12.md` |
| `D12-02` | Seção 12 reflete convites entregues e estado da etapa 4 | Preparado com referência de 13/10 | **Revisado com texto projetado** para fechamento final conjunto |
| `D12-03` | Propostas futuras (1 a 9, 13) 100% preservadas | Preservadas no commit `1c8dbb0` | **Confirmada preservação integral** sem qualquer remoção |
| `D12-04` | Links e consistência documental | Pendente | **Alinhamento e referências cruzadas estabelecidas** |
| `M18-01` | Contrato/desenho antes das partes dependentes | Parcial | **Entregue integralmente** em `docs/CONTRATO-FONTE-REAL-DEPENDENCIAS-LITURGICAS.md` |
| `M18-12` | Dependência futura/em andamento bloqueia; encerrado preserva | Pendente de fonte real | **Desenhado com estados conclusivos, tempo e ordem canônica** |

---

## 3. Próximo Passo do Plano Conjunto

Avançar para o **Bloco 2**: Implementação incremental da fonte real e do ciclo efetivo (`015_liturgical_dependencies.sql` e `016_member_lifecycle_effective.sql`), testes pertinentes e build, mantendo a integridade do checkout e os limites estritos (sem execução em banco até autorização expressa).
