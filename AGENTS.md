# Escala do Reino — Guia de Governança e Papéis Multiagente

Este documento define os princípios de governança, divisão de responsabilidades e regras de cooperação entre os agentes e o responsável pelo produto no projeto **Escala do Reino**.

---

## 1. Princípio Fundamental de Governança

A autoridade final sobre o produto, escopo, regras de negócio e ações de impacto é exclusivamente do **responsável pelo produto**. Nenhuma inteligência artificial ou ferramenta automatizada toma decisões de negócio, altera regras estabelecidas, publica código, aplica migrações permanentes em banco de dados ou descarta recursos por inferência própria.

Qualquer ação que modifique o estado persistente do projeto (commits, push, criação de PRs, merges, deploys, aplicação definitiva de migrations ou descarte de bancos de dados) exige **autorização expressa** do responsável.

---

## 2. Matriz de Papéis e Responsabilidades

```
                 +-----------------------------------------+
                 |        Responsável pelo Produto         |
                 |      (Autoridade Final e Decisão)       |
                 +--------------------+--------------------+
                                      |
                +---------------------+---------------------+
                |                                           |
                v                                           v
   +--------------------------+               +--------------------------+
   |         ChatGPT          |               |          Codex           |
   | (Especificação de Escopo,|               |    (Revisão Técnica      |
   |  Orquestração e Riscos)  |               |      Independente)       |
   +------------+-------------+               +-------------+------------+
                |                                           ^
                | Orienta tarefas                           | Revisa diffs e
                v                                           | transcripts
   +--------------------------------------------------------+---+
   |                        Antigravity                         |
   |        (Executor Principal de Implementação e Testes)      |
   +------------------------------------------------------------+
```

### 2.1 Responsável pelo Produto (Humano / Autoridade Final)
- Define a visão, o PRD, as prioridades das issues e os critérios de aceitação.
- Avalia e acolhe os pareceres técnicos e recomendações.
- Concede autorização prévia e delimitada para cada intervenção no código, no banco ou no repositório.
- Arbitra eventuais divergências de especificação ou de arquitetura.

### 2.2 ChatGPT (Especificação, Orquestração e Análise de Riscos)
- Atua no planejamento de alto nível, refinamento de requisitos e desenho de contratos técnicos.
- Elabora especificações estruturadas, matrizes de casos de ensaio e prompts operacionais para os executores.
- Realiza análise crítica de riscos antes de operações delicadas (ex.: concorrência, migrações de banco, ciclo de vida de dados).
- Não presume acesso direto ou automático ao repositório local; opera com base no contexto transmitido pelo responsável ou em conexões explicitamente autorizadas.

### 2.3 Antigravity (Executor Principal de Implementação e Testes)
- Opera no ambiente local de desenvolvimento (IDE / CLI do repositório).
- Implementa código de frontend (React/Vite) e banco de dados (scripts SQL, DDLs, RPCs).
- Executa as suítes de testes automatizados (`npm test`, testes focais, build de produção).
- Conduz os ensaios técnicos autorizados e extrai evidências objetivas e determinísticas.
- Prepara o empacotamento de commits e documentação, sem publicá-los sem autorização.

### 2.4 Codex (Revisor Técnico Independente)
- Realiza auditoria e revisão técnica independente de diffs, implementações e transcripts de execução.
- Inspeciona o código com olhar adversarial para identificar falhas de isolamento, vulnerabilidades de segurança, furos de concorrência e quebra de contratos.
- Emite parecer formal objetivo: **Aprovado**, **Aceito com Ressalvas** ou **Rejeitado**.
- **Independência Operacional:** O fato de o Codex ser acionado dentro do terminal ou da infraestrutura do Antigravity não altera, atenua ou compromete sua prerrogativa de revisão técnica estritamente independente.

---

## 3. Critérios para Convocação de Revisão Independente

A revisão técnica independente pelo Codex não é obrigatória para todo e qualquer fechamento formal de gate, sendo calibrada proporcionalmente ao risco e ao impacto das alterações para manter a eficiência operacional sem comprometer a segurança do produto:

1. **Revisão Obrigatória:** mudanças críticas de segurança, isolamento e autorização multi-tenant (`church_id`), funções RPC com `SECURITY DEFINER` ou parâmetros sensíveis, operações concorrentes de escrita (locks, idempotência, recibos transacionais) e integridade estrutural de dados no banco.
2. **Revisão Proporcional ao Risco:** em outras entregas de frontend ou lógica de negócio, a necessidade de revisão técnica é avaliada pelo risco e pela complexidade do componente modificado.
3. **Isenção de Revisão Automática:** alterações puramente documentais, ajustes cosméticos de CSS, refinamentos visuais de interface ou correções triviais de redação não exigem a convocação do Codex.
4. **Estabilidade de Gates Aprovados:** marcos e gates aprovados formalmente pelo responsável não devem ser reabertos sem um fato técnico novo, evidência concreta de falha ou regressão comprovada em testes.
5. **Prerrogativa do Responsável:** o responsável pelo produto pode, a seu critério exclusivo, solicitar revisões adicionais ou convocar o Codex para qualquer entrega ou inspeção técnica que julgar necessária.

---

## 4. Preservação de Ambientes, Dados e Evidências

1. **Preservação do Banco Principal:** O banco `postgres` local e o projeto piloto remoto são somente-leitura durante ensaios de novos incrementos. Qualquer teste destrutivo ou provisório deve utilizar bancos descartáveis dedicados (`escala_rehearsal_*`).
2. **Transações Reversíveis com Rollback:** Ensaios de migrações e de RPCs devem ser executados em transações controladas encerradas obrigatoriamente em `ROLLBACK;`, salvo quando a instalação definitiva for formalmente autorizada.
3. **Imutabilidade das Evidências:** Diffs, saídas de console e transcripts nunca devem ser adulterados. Se um ensaio for aprovado com ressalvas, as ressalvas devem ser textualmente registradas no histórico.
4. **Proteção de Informações Sensíveis:** Nenhum segredo, credencial real, chave privada, JWT funcional, senha ou dado pessoal pode ser incluído em commits, documentos ou logs de teste.

---

## 5. Restrições Operacionais

- **Git:** Proibido o uso de `git add .` ou `git add -A` sem conferência explícita arquivo por arquivo. Proibido `git push`, criação de PR, `merge`, `rebase` ou comandos destrutivos (`git reset --hard`, `git clean -fd`) sem ordem do responsável.
- **Banco de Dados:** Proibido disparar `DROP DATABASE`, `TRUNCATE` ou `DELETE` irrestritos no banco principal de laboratório ou no piloto remoto.
- **Isolamento de Escopo:** Não misturar alterações de frentes ou issues distintas no mesmo commit. Cada commit deve ser coeso, auto-contido e passar na suíte de testes.

---

## 6. Referências Documentais do Projeto

- **Metodologia e Ciclo Operacional:** [`docs/operacao/FLUXO-MULTIAGENTE.md`](docs/operacao/FLUXO-MULTIAGENTE.md)
- **Estado Atual e Checkpoints de Entrega:** [`docs/ESTADO-ATUAL.md`](docs/ESTADO-ATUAL.md)
- **Topologia de Ambientes e Bancos:** [`docs/ambientes/LABORATORIOS.md`](docs/ambientes/LABORATORIOS.md)
- **Processo de Trabalho e Issues no GitHub:** [`docs/operacao/GUIA-TRABALHO-GITHUB.md`](docs/operacao/GUIA-TRABALHO-GITHUB.md)
- **Requisitos e Contratos de Domínio:** [`docs/PRD.md`](docs/PRD.md)
