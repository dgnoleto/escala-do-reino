# Escala do Reino — Fluxo Operacional Multiagente

Este documento descreve o ciclo de trabalho recomendado para a colaboração entre o **responsável pelo produto**, **ChatGPT**, **Antigravity** e **Codex**, detalhando as etapas de desenvolvimento, critérios de eficiência e o protocolo para retomada segura de contexto.

---

## 1. Ciclo Operacional Recomendado (7 Etapas)

O fluxo de trabalho do projeto segue um modelo baseado em gates de qualidade progressivos, garantindo que nenhum incremento seja integrado sem validação técnica e documental:

```
[1. Definição do Escopo]
         |
         v
[2. Implementação (Antigravity)]
         |
         v
[3. Testes & Evidências]
         |
         v
[4. Revisão Independente (Codex)] ---> (Identificou bloqueios?)
         |                                    |
         | Não (Aprovado / Ressalvas)         v Sim (Rejeitado)
         |                             [5. Correções Cirúrgicas]
         v                                    |
[6. Aceite do Gate (Responsável)] <-----------+
         |
         v
[7. Registro de Checkpoint]
```

### Etapa 1: Definição Clara da Tarefa e Escopo
- O responsável ou o ChatGPT define a meta pontual, os limites operacionais, arquivos autorizados e critérios de aceitação.
- O escopo deve ser delimitado: tarefas focais produzem resultados mais rápidos, fáceis de auditar e livres de contaminação de contexto.

### Etapa 2: Implementação pelo Agente Executor (Antigravity)
- O Antigravity executa a alteração no checkout local, aderindo aos contratos de domínio prévios.
- O executor preserva arquivos não relacionados e respeita as convenções de código (Unicode NFC, imutabilidade, isolamento de inquilino por `church_id`).

### Etapa 3: Testes e Coleta de Evidências
- Execução das suítes automatizadas locais (`npm test`, suítes unitárias, ensaios SQL sob rollback, build de produção).
- Coleta de evidências objetivas e reprodutíveis: saídas de terminal com código de saída, contagens de registros, diffs e fingerprints determinísticos.

### Etapa 4: Revisão Independente (Codex)
- Convocação **obrigatória** em mudanças críticas de segurança, autorização multi-tenant (`church_id`), funções RPC com `SECURITY DEFINER` ou parâmetros sensíveis, concorrência e integridade estrutural de dados no banco.
- Convocação **proporcional ao risco** nas demais entregas, não sendo obrigatória para todo e qualquer fechamento formal de gate (alterações puramente documentais ou cosméticas de interface estão isentas).
- O revisor atua de forma adversarial: valida diffs, busca vulnerabilidades, testa premissas de concorrência e avalia a completude das evidências.
- Classifica os apontamentos em: **Bloqueios** (impedem o gate), **Ressalvas** (não impedem o avanço, mas exigem registro formal) e **Melhorias Futuras** (escopo de novas issues).
- O responsável pelo produto detém a prerrogativa de solicitar revisões adicionais do Codex para qualquer entrega ou inspeção técnica quando julgar necessário.

### Etapa 5: Correções Exclusivamente dos Bloqueios
- Diante de parecer com bloqueios, o Antigravity realiza intervenções cirúrgicas **apenas** nos pontos apontados pelo Codex.
- Evita-se reescrever código ou refatorar componentes que já foram aprovados em etapas anteriores.

### Etapa 6: Aceite do Gate pelo Responsável
- O responsável pelo produto analisa o parecer técnico do Codex (quando aplicável), as evidências colhidas e as eventuais ressalvas declaradas.
- Decide formalmente pelo aceite do gate, emitindo autorização explícita para o avanço da etapa.

### Etapa 7: Registro de Checkpoint e Homologação
- Registro documental formal do resultado em `docs/historico/` ou atualização de `docs/ESTADO-ATUAL.md`.
- Consolidação de commits locais atômicos com mensagens padronizadas.

> **Estrutura de Gates e Frentes Técnicas:** Os marcos do projeto preservam sua identidade sequencial (ex.: Gate 0 para inspeção do laboratório, Gate 1 para preparação do banco descartável, Gate 2 para ensaios SQL sob rollback). Frentes de integração subsequentes (como validações de rede HTTP/PostgREST) são tratadas como etapas autônomas sujeitas a autorização específica, enquanto o descarte e encerramento de ambientes de laboratório constituem uma etapa posterior e independente.

---

## 2. Regras de Eficiência Operacional

Para maximizar a produtividade e a robustez sem redundâncias:

1. **Revisão proporcional ao risco e nem todo agente em toda tarefa:** Alterações puramente documentais, pequenos ajustes de estilo ou correções tipográficas podem ser finalizadas diretamente pelo Antigravity sob aprovação do responsável, sem acionar o ciclo completo de auditoria do Codex. A revisão independente concentra-se onde há risco real (segurança, banco, concorrência, integridade).
2. **Não reabrir escopos já aprovados:** Se uma frente foi validada e aprovada pelo Codex em rodada anterior, o revisor deve focar estritamente nas alterações recentes ou nos bloqueios remanescentes, sem reiniciar auditoria do zero em código estável.
3. **Não reabrir gates sem evidência nova:** Decisões de arquitetura e gates formalmente homologados pelo responsável em etapas anteriores não devem ser rediscutidos sem um fato técnico novo, falha comprovada ou regressão observada em testes.
4. **Relatórios incrementais:** Preferir relatórios sucintos, focados no delta executado e nos resultados imediatos, evitando reproduzir integralmente todo o histórico do projeto em cada interação.
5. **Separar bloqueios de melhorias futuras:** Diferenciar com rigor o que impede a entrega atual do que constitui sugestão de evolução para o backlog futuro.
6. **Prompts focalizados:** Prompts longos e generalistas tendem a diluir a atenção dos modelos; instruções diretas e bem delimitadas produzem código mais seguro.
7. **Distinção estrita das classes de teste:**
   - *Testes simulados/unidade:* Validação lógica em memória com mocks (ex.: vitest/node:test).
   - *Ensaios em motor real:* Execução contra instância real do PostgreSQL sob `ROLLBACK` (valida constraints, SQLSTATEs e DDL).
   - *Testes de borda HTTP:* Validação contra PostgREST/Kong com cabeçalhos de rede reais e JWTs.
   - *Homologação ponta a ponta:* Jornadas no navegador com sessões ativas e interface visual.
   - Nenhuma classe de teste substitui a outra: cada uma comprova um nível diferente da arquitetura.

---

## 3. Protocolo de Retomada de Contexto

Quando um agente iniciar uma nova sessão ou houver interrupção prolongada no desenvolvimento, o procedimento obrigatório de retomada é:

```
Passo 1: Ler AGENTS.md (Governança e limites)
   |
Passo 2: Ler docs/operacao/FLUXO-MULTIAGENTE.md (Processo de trabalho)
   |
Passo 3: Ler docs/ESTADO-ATUAL.md (Último checkpoint e pendências)
   |
Passo 4: Conferir ambiente real no Git (git status, branch, últimos commits)
   |
Passo 5: Identificar o último gate aprovado e o próximo passo imediato
   |
Passo 6: Apresentar resumo objetivo ao responsável ANTES de propor execução
```

### Roteiro Prático de Inspeção Inicial:

1. **Consultar Documentos Centrais:**
   - Ler [`AGENTS.md`](../../AGENTS.md) para relembrar limites de autorização e papéis.
   - Ler [`docs/ESTADO-ATUAL.md`](../ESTADO-ATUAL.md) para identificar exatamente onde o projeto parou.
2. **Inspecionar o Repositório Local (Somente-Leitura):**
   ```bash
   git branch --show-current
   git status --short
   git log -n 5 --oneline
   ```
3. **Identificar a Situação dos Ambientes:**
   - Verificar se há bases descartáveis ativas ou ensaios pendentes consultando [`docs/ambientes/LABORATORIOS.md`](../ambientes/LABORATORIOS.md).
4. **Distinguir Trabalho Autorizado de Trabalho Futuro:**
   - Não assumir que uma atividade sugerida no backlog já possui autorização para ser executada.
5. **Alinhamento Inicial:**
   - O agente deve abrir a conversa apresentando um diagnóstico objetivo de 1 parágrafo com: branch atual, último commit, último gate concluído e a próxima atividade que aguarda autorização.

> **Nota sobre o ChatGPT:** Como novas sessões de chat do ChatGPT não possuem acesso nativo direto ao filesystem da máquina do operador, o responsável deve transmitir o conteúdo de `ESTADO-ATUAL.md` e do último relatório de homologação relevante para restabelecer o contexto orquestrador.
