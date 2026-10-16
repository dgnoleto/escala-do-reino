# Checkpoint 3 — Bloco 1: Contrato Integrado Corrigido e Revisão Fiel da #12

- **Data/Hora:** 2026-10-16 19:08 BRT
- **Contexto:** Execução coordenada aprovada das issues #12 e #18 (`PROMPT-CORRECAO-CONTRATO.md` e `PARECER-CODEX.md`).
- **Branch Ativa:** `feat/issue-18-ciclo-vida-membros`
- **HEAD da Branch Conferido:** `80f16fabb23fd7a9cbf87d912aac18b99f7cecb3`
- **Commit Candidato Isolado da #12:** `1c8dbb0fbc40f056ec46f092b6ab4f009595a3c0` (preservado sem alteração)
- **Hash Canônico Preservado de 013:** `40709A4FE9FEB688D3BE92564B821DCAC4142F6A588E4ACA585D42FBDB964AF7`

---

## 1. Status das Entregas do Bloco 1 (Versão Integrada Corrigida)

| Item | Descrição da Entrega Corrigida | Arquivo de Entrega | Situação Atual |
| :--- | :--- | :--- | :--- |
| **B1.1** | **Integridade Relacional Multi-Tenant:** Chaves únicas e FKs compostas por `church_id`, amarrando `(church_id, id)` em todas as tabelas operacionais, consistência `item->evento` e `função->equipe`, além de inclusão explícita de `member_qualifications`. Ações `ON DELETE RESTRICT` preservando histórico. | `docs/CONTRATO-FONTE-REAL-DEPENDENCIAS-LITURGICAS.md` (Seção 2) | Entregue em desenho corrigido |
| **B1.2** | **Plano de Bloqueios Compatível (Sem Ciclos):** Alinhamento estrito com a ordem de 013 (`church_access` antes de `members`), integração de `church_admin_continuity`, operador em `FOR SHARE`, ordenação determinística de múltiplas linhas (`ORDER BY id ASC`), revalidação pós-espera e tabela de bloqueios por operação (007/009/011/013/015/016). | `docs/CONTRATO-FONTE-REAL-DEPENDENCIAS-LITURGICAS.md` (Seção 5) | Entregue em desenho corrigido |
| **B1.3** | **Ciclo Operacional Completo e Decisão Confirmada:** Registro formal da decisão de 16/10/2026 (quem lidera ministério ativo só pode ser excluído após transferir liderança). Tabela completa de dependências $\rightarrow$ comandos $\rightarrow$ consultas $\rightarrow$ locks $\rightarrow$ predicados. Fronteira de substituição pelo início da atividade. | `docs/CONTRATO-FONTE-REAL-DEPENDENCIAS-LITURGICAS.md` (Seções 1, 3 e 4) | Entregue em desenho corrigido |
| **B1.4** | **Revisão Documental Fiel da Issue #12:** Baseada na estrutura real de 12 seções de `docs/EVOLUCAO-FUTURA.md` (eliminada menção indevida à seção 13 e organização fictícia de módulos). Distinção de histórico vs texto atual, preservação integral de propostas futuras e minuta de fechamento condicionada a comprovação física. | `docs/REVISAO-CANDIDATA-ISSUE12.md` | Entregue em revisão fiel |

---

## 2. Acompanhamento pela Matriz de Aceite (`MATRIZ-ACEITE.md`)

| ID | Critério Preservado | Situação Inicial | Situação Atual (Após Parecer Codex e Ajustes) |
| :--- | :--- | :--- | :--- |
| **D12-01** | Seção 10 distingue histórico Google e interface e-mail/senha | Preparado em `1c8dbb0` | **Revisado e conferido no commit isolado**; integração final na main pendente. |
| **D12-02** | Seção 12 reflete convites entregues e estado da etapa 4 | Preparado (13/10) | **Histórico conferido**; redação final da etapa 4 condicionada à implementação física comprovada. |
| **D12-03** | Ideias futuras das seções 1 a 9 preservadas | Preservadas em `1c8dbb0` | **Preservação confirmada na estrutura real de 12 seções**, sem criar novas categorias. |
| **D12-04** | Links e consistência documental | Pendente | **Pendente de revisão de links e diff final** na janela de integração. |
| **M18-01** | Contrato/desenho antes das partes dependentes | Parcial | **Contrato integrado corrigido entregue** (em revisão de alinhamento para início do SQL). |
| **M18-05** | Servidor valida elegibilidade, permissão, autoexclusão | Parcial | **Desenhado com revalidação pós-espera de locks e recusas canônicas.** |
| **M18-06** | Último administrador protegido sob concorrência | Parcial | **Integrado ao lock `church_admin_continuity` e gatilhos de 009.** |
| **M18-07** | Mutação atômica com auditoria e recibo | Parcial | **Mapeado para incremento 016 com garantia de reversão total.** |
| **M18-10** | Concorrência sem ciclos/deadlocks | Parcial | **Ordem compatível com 013 desenhada; validação física virá nos ensaios do Bloco 3.** |
| **M18-12** | Dependência futura/em andamento bloqueia; histórico preserva | Pendente de fonte real | **Desenhado com chave composta, regra de ministério de 16/10/2026 e combinação de estados.** |

---

## 3. Limites Mantidos

- Zero comandos SQL executados contra laboratório ou piloto.
- Contêineres inalterados.
- Hash de `013_member_lifecycle.sql` e arquivos em `sources/` estritamente preservados.
- Testes unitários do ciclo de vida em `test/member-lifecycle-cycle.test.js` mantidos 100% verdes (49/49).
