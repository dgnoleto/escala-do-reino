# Escala do Reino — Fluxo Operacional Multiagente

Versão vigente: **1.1** — consolidada em **31/10/2026**, sucessora do [baseline de 31/10/2026](versoes/README.md) integrado no PR #64. Primeira numeração formal deste documento; o baseline anterior não declarava versão numérica e não recebe numeração retroativa. Entrada normativa: [AGENTS.md](../../AGENTS.md).

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

### Regra transversal: issue como trilha oficial

- **Antes de começar:** ler a issue/subissue vinculada, seu status, sprint, dependências, escopo, critérios e decisões. Se uma tarefa grande puder ser entregue em partes verificáveis, propor subissues antes de programar. Ausência de issue adequada é pendência de planejamento, não autorização para abrir uma nova por conta própria ou executar trabalho não vinculado.
- **Durante a execução:** Antigravity comenta na issue ao completar um incremento significativo ou encontrar bloqueio, informando código/artefato, testes efetivos, evidências e limites. Codex registra sua própria auditoria, achados, severidade, decisão e escopo examinado, sem atribuir aprovação a outro agente. ChatGPT registra especificações e decisões do responsável quando tiver acesso e autorização para atualizar a issue.
- **Na passagem de etapa:** atualizar status e sprint do **Project** quando autorizado e disponível; texto na issue não substitui campos do board. Distinguir trabalho local de commit/PR remoto e nunca inventar sincronização, execução, aprovação ou conclusão.
- **Ao concluir:** issue, comentários, referências de commits/PRs e documentos selecionados devem permitir que alguém retome o contexto sem consultar conversas com LLMs. Se faltar acesso ao GitHub, fornecer comentário pronto e informar a pendência.
- **WIP complexo:** trabalhar preferencialmente em uma frente crítica de cada vez. Paralelismo exige dependências compatíveis, risco controlado e aprovação do responsável; estar na mesma sprint não obriga execução simultânea.
- **Antes da implementação e da auditoria:** aplicar o gate de paridade contratual de [AGENTS.md, seção 1.7](../../AGENTS.md#17-rastreabilidade-por-issue-e-paridade-contratual). Exigir especificação/delta e matriz por fonte de verdade; não avançar com divergência ou não verificação crítica. Registrar a paridade separadamente de auditoria, execução, homologação e autorização de publicação.

### Etapa 1: Definição Clara da Tarefa e Escopo
- O responsável ou o ChatGPT define a meta pontual, os limites operacionais, arquivos autorizados e critérios de aceitação.
- O escopo deve ser delimitado: tarefas focais produzem resultados mais rápidos, fáceis de auditar e livres de contaminação de contexto.
- Na passagem existente, explicitar o resultado que encerra a tarefa, a verificação mínima e os limites, conforme [AGENTS.md, seção 1.3](../../AGENTS.md#13-decisão-autorização-e-contenção-de-escopo). Se surgir ferramental adicional, confrontá-lo com esse resultado antes de ampliar a implementação.

### Etapa 2: Implementação pelo Agente Executor (Antigravity)
- O Antigravity executa a alteração no checkout local, aderindo aos contratos de domínio prévios.
- O executor preserva arquivos não relacionados e respeita as convenções de código (Unicode NFC, imutabilidade, isolamento de inquilino por `church_id`).

### Etapa 3: Testes e Coleta de Evidências
- Execução das suítes automatizadas locais (`npm test`, suítes unitárias, ensaios SQL sob rollback, build de produção).
- Selecionar verificações conforme a mudança, o risco e a autorização. Alterações somente documentais não exigem suíte de aplicação, build ou ensaio de banco por rotina.
- Planejar cedo a verificação local necessária e executá-la dentro da autorização de implementação/correção descrita em AGENTS.md, seção 1.3; restrições expressas e autorizações de ambientes reais continuam prevalecendo.
- Coleta de evidências objetivas e reprodutíveis: saídas de terminal com código de saída, contagens de registros, diffs e fingerprints determinísticos.

### Etapa 4: Revisão Independente (Codex)
- Convocação **obrigatória** em mudanças críticas de segurança, autorização multi-tenant (`church_id`), funções RPC com `SECURITY DEFINER` ou parâmetros sensíveis, concorrência e integridade estrutural de dados no banco.
- Convocação **proporcional ao risco** nas demais entregas, não sendo obrigatória para todo e qualquer fechamento formal de gate (alterações puramente documentais ou cosméticas de interface estão isentas).
- O revisor atua de forma adversarial: valida diffs, busca vulnerabilidades, testa premissas de concorrência e avalia a completude das evidências.
- Consolidar os bloqueios encontrados no parecer da rodada. Em novo achado tardio, informar sua origem (alteração recente ou omissão anterior) e o aceite afetado, conforme AGENTS.md, seção 1.4.
- Classifica os apontamentos em: **Bloqueios** (impedem o gate), **Ressalvas** (não impedem o avanço, mas exigem registro formal) e **Melhorias Futuras** (escopo de novas issues).
- O responsável pelo produto detém a prerrogativa de solicitar revisões adicionais do Codex para qualquer entrega ou inspeção técnica quando julgar necessário.

### Etapa 5: Correções Exclusivamente dos Bloqueios
- Diante de parecer com bloqueios, o Antigravity realiza intervenções cirúrgicas **apenas** nos pontos apontados pelo Codex.
- Evita-se reescrever código ou refatorar componentes que já foram aprovados em etapas anteriores.
- Acompanhar no checkpoint existente as rodadas do mesmo defeito. Ao atingir o gatilho de AGENTS.md, seção 1.4, aplicar o diagnóstico de repetição da seção 5.2 antes de outro repasse equivalente.

### Etapa 6: Aceite do Gate pelo Responsável
- O responsável pelo produto analisa o parecer técnico do Codex (quando aplicável), as evidências colhidas e as eventuais ressalvas declaradas.
- Decide formalmente pelo aceite do gate, emitindo autorização explícita para o avanço da etapa.

### Etapa 7: Registro de Checkpoint e Homologação
- Registro documental formal do resultado em `docs/historico/` ou atualização de `docs/ESTADO-ATUAL.md`.
- Consolidação de commits locais atômicos com mensagens padronizadas.
- A consolidação em commit depende de autorização específica; o aceite técnico ou documental não autoriza publicação, SQL ou deploy.

> **Estrutura de Gates e Frentes Técnicas:** Os marcos do projeto preservam sua identidade sequencial (ex.: Gate 0 para inspeção do laboratório, Gate 1 para preparação do banco descartável, Gate 2 para ensaios SQL sob rollback). Frentes de integração subsequentes (como validações de rede HTTP/PostgREST) são tratadas como etapas autônomas sujeitas a autorização específica, enquanto o descarte e encerramento de ambientes de laboratório constituem uma etapa posterior e independente.

---

## 2. Regras de Eficiência Operacional

Para maximizar a produtividade e a robustez sem redundâncias:

1. **Revisão proporcional ao risco e nem todo agente em toda tarefa:** Alterações puramente documentais, pequenos ajustes de estilo ou correções tipográficas podem ser finalizadas diretamente pelo Antigravity sob aprovação do responsável, sem acionar o ciclo completo de auditoria do Codex. A revisão independente concentra-se onde há risco real (segurança, banco, concorrência, integridade).
2. **Não reabrir escopos já aprovados:** Se uma frente foi validada e aprovada pelo Codex em rodada anterior, o revisor deve focar estritamente nas alterações recentes ou nos bloqueios remanescentes, sem reiniciar auditoria do zero em código estável.
3. **Não reabrir gates sem evidência nova:** Decisões de arquitetura e gates formalmente homologados pelo responsável em etapas anteriores não devem ser rediscutidos sem um fato técnico novo, falha comprovada ou regressão observada em testes.
4. **Relatórios incrementais:** Usar o checkpoint existente para registrar sucintamente o delta, o resultado concluído, o impedimento concreto remanescente e a necessidade da próxima ação. Não criar um novo Markdown de revisão por rotina nem reproduzir todo o histórico a cada interação; preservar as evidências originais e criar documento adicional somente quando necessário ao resultado ou solicitado pelo responsável.
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

Antes de executar o roteiro de retomada, conferir a identidade do destinatário do prompt conforme [AGENTS.md, seção 1.1](../../AGENTS.md#11-verificação-obrigatória-da-identidade-do-agente-destinatário). Destinatário diferente ou identidade exigida não confirmada bloqueia inclusive os comandos de inspeção desse roteiro.

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

> **Acesso e leitura dirigida:** Confirmar as ferramentas e os acessos efetivamente disponíveis na sessão, sem presumir acesso local, GitHub ou Project. Se faltar acesso, pedir somente o material necessário. Usar estado atual, issue e passagem de contexto, aprofundando nos contratos e no código afetado; não reler todo o repositório por rotina. Economia de contexto não justifica omitir uma regra ou evidência necessária.

---

## 4. Verificações obrigatórias em prompts e repasses

Aplica as decisões do responsável de **24/10/2026**, registradas nas [seções 1.1 e 1.2 de AGENTS.md](../../AGENTS.md#11-verificação-obrigatória-da-identidade-do-agente-destinatário). As verificações valem em todas as etapas do ciclo, inclusive correções, revisão e retomada.

### 4.1 Identidade antes da execução

Quem preparar um prompt deve declarar seu destinatário e incluir a trava abaixo. Quem o receber deve conferir sua identidade antes de executar qualquer etapa. Se for outro agente ou outro LLM exigido, responder apenas com o aviso de bloqueio, identificando o esperado e o confirmado; não executar parcialmente nem encaminhar a tarefa por conta própria. Identidade ou destinatário incerto exige esclarecimento antes de avançar.

### 4.2 VCC antes de avançar

1. Comparar o retorno recebido com o objetivo/issue vigente, a última etapa comprovada, o resultado solicitado, os limites autorizados e as decisões existentes. Conferir versão e ambiente quando pertinentes; separar relatório de evidência e hipótese de fato confirmado.
2. Se o retorno estiver vazio, vago, fora de contexto ou contradisser a continuidade, suspender o passo dependente. Informar: **contexto esperado; trecho recebido ou ausência de conteúdo; divergência; impacto; esclarecimento necessário**. Perguntar como esse conteúdo sustenta a próxima etapa, sem inventar a conexão nem reenviar sucessivamente prompts que conservem a dúvida.
3. Se a divergência propuser mudança material de escopo, barrar essa mudança e encaminhá-la ao responsável para decisão expressa. Preservar o último estado confirmado e os gates aceitos; uma divergência documental isolada não comprova regressão nem autoriza reabrir gate.
4. Após o esclarecimento, registrar a base confirmada para a retomada. Havendo mudança material, registrar quem autorizou, data, objetivo e novos limites antes da execução. O registro deve permanecer no escopo documental autorizado; alterações em issues, Project ou publicações continuam sujeitas às permissões próprias.

### 4.3 Bloco obrigatório para novos prompts operacionais

Preencher os campos antes do envio; não inferir o destinatário a partir da ferramenta em que o prompt foi aberto.

```text
Agente destinatário e papel:
LLM/modelo exigido (quando aplicável; caso contrário, declarar sem exigência específica):
Objetivo/issue e resultado esperado:
Última etapa confirmada e evidências de referência:
Escopo autorizado, arquivos e limites de execução:
Versão/ambiente (quando aplicável):

Trava de identidade: confira sua identidade real antes de executar qualquer etapa.
Se você não for o agente ou LLM indicado, não execute este prompt, nem parcialmente.
Avise a divergência e solicite o encaminhamento correto. Se não puder confirmar
a identidade exigida ou o destinatário, pare e peça esclarecimento.

VCC: valide a relação entre o retorno recebido e a continuidade acima.
Não encaixe respostas vazias, vagas ou fora de contexto. Sinalize a divergência
e questione sua relação com o próximo passo antes de avançar na etapa dependente.
Barre mudanças materiais de escopo até autorização expressa do responsável.
```

## 5. Decisão, diagnóstico e proteção da qualidade

Aplica as decisões de **25/10/2026** descritas nas seções 1.3 a 1.6 de [AGENTS.md](../../AGENTS.md). Preserva as verificações obrigatórias de identidade e VCC, que devem ser feitas antes do avanço dependente.

### 5.1 Escolha da ação e controle de escopo

1. Identificar se a conversa está explorando uma ideia, decidindo uma opção ou executando trabalho autorizado.
2. Confrontar a proposta com objetivo, PRD/contratos, critérios da issue, versão, ambiente e autorização.
3. **Seguir** quando houver compatibilidade e autorização; **propor** quando houver ampliação ou mudança; **interromper a ação afetada** quando faltar uma condição necessária. A divergência de identidade continua bloqueando a tarefa inteira conforme seção 4.1.
4. Antes de acrescentar funcionalidade, biblioteca, serviço ou refatoração, explicar o problema atual, a necessidade para a entrega, a alternativa menor e o custo de manutenção. Registrar ideias dispensáveis no destino adequado, quando autorizado, sem incorporá-las silenciosamente.
5. Preservar a autonomia para o trabalho já autorizado e as restrições para ações novas. Uma hipótese técnica ou a opinião de outra IA não concede permissão.

### 5.2 Investigação da causa raiz

Apresentar, de forma proporcional ao defeito:

| Elemento | Evidência esperada |
|---|---|
| Sintoma | Observado versus esperado, versão e condição de reprodução. |
| Hipótese | Explicação candidata e o que a confirmaria ou refutaria. |
| Causa demonstrada | Evidência no handler, contrato, estado ou serviço que controla o comportamento. |
| Correção | Como trata a causa, com menor escopo suficiente e preservação das regras. |
| Verificação | Cenários relevantes, inclusive recusa/isolamento quando aplicáveis, e limites do resultado. |

Se a causa não estiver demonstrada, propor a menor investigação necessária, sem afirmar uma conclusão. Não converter automaticamente um defeito em reforma de arquitetura. Contenção temporária deve declarar o risco residual, a causa ainda pendente e a forma de acompanhar a solução definitiva.

Quando houver repetição de correções, registrar no checkpoint existente: por que a abordagem anterior falhou, a evidência que diferencia as hipóteses e a menor verificação seguinte. Se a abordagem ou a verificação implicar nova permissão ou ampliação material, apresentar somente essa decisão ao responsável.

### 5.3 Contraponto e classificação dos riscos

O agente deve explicitar a afirmação que contesta, seu fundamento, a consequência e a alternativa. Buscar prova, não consenso por quantidade de IAs. Reconhecer quando uma objeção foi resolvida; registrar desacordo consciente ou incerteza remanescente sem fabricar convergência.

| Achado | Encaminhamento |
|---|---|
| Falha confirmada em critério obrigatório | Bloquear somente o aceite/operação afetada; indicar evidência, correção proposta, autorização necessária e condição de liberação. |
| Suspeita fundamentada de impacto relevante | Propor verificação delimitada; suspender a operação se sua execução puder causar dano. |
| Melhoria sem falha nos critérios vigentes | Avaliar custo/benefício e sugerir evolução futura, sem impedir a entrega por padrão. |

Gatilhos de análise: mudança de autorização ou isolamento por igreja; credenciais e registros de erro; integrações/MCP e permissões; dados reais em testes; coleta, exposição e retenção de dados pessoais; consultas sem limite; crescimento de arquivos, logs e custo de processamento. Esses gatilhos orientam a análise da mudança, sem convocar auditoria geral a cada tarefa.

Antes de aplicar correção de segurança descoberta, explicar motivo, efeito e verificação proposta. Respeitar a autorização delimitada, aguardando decisão apenas para a parte que ela não cobre. Ocultar controles no cliente não substitui autorização no servidor; não remover travas para liberar uma funcionalidade.

Na privacidade, examinar finalidade, minimização, acesso, exposição e retenção efetivos. A LGPD inclui convicção religiosa e filiação a organização religiosa entre as categorias sensíveis; avaliar a vinculação identificável a igrejas sem presumir que todo registro do sistema tenha a mesma classificação. Separar diagnóstico técnico de dúvida jurídica concreta. Não inventar base legal, certificação de conformidade ou política de expiração. Preservar o PRD: retenção de histórico não significa apagar cadastros/eventos por inferência.

Na volumetria, declarar referência de uso, quantidade de registros/arquivos, concorrência, crescimento e período de retenção quando pertinentes. Usar medições ou hipóteses identificadas; não pressupor milhões de usuários nem prometer volume em GB. Propor mudança estrutural somente diante de necessidade demonstrada e decisão de escopo.

Referências de consulta, cuja aplicabilidade deve ser verificada na análise concreta: [perguntas frequentes da ANPD](https://www.gov.br/anpd/pt-br/acesso-a-informacao/perguntas-frequentes) e [guia de segurança da informação](https://www.gov.br/anpd/pt-br/centrais-de-conteudo/materiais-educativos-e-publicacoes/guia-orientativo-sobre-seguranca-da-informacao-para-agentes-de-tratamento-de-pequeno-porte).

### 5.4 Critérios de saída e cenários de conferência

Encerrar a tarefa quando seus critérios vigentes estiverem satisfeitos e as evidências necessárias registradas. Separar bloqueios, ressalvas e melhorias futuras; evidência nova relevante é necessária para reabrir gate aprovado. Prazo curto permite propor ajuste de escopo, nunca omissão de validação obrigatória.

| Cenário | Resposta esperada |
|---|---|
| Pedido contrário a decisão aprovada | Explicitar a contradição e confirmar a mudança antes da ação dependente. |
| Risco crítico perto do fim da sprint | Propor tratamento e troca de escopo ao PO/PM, sem reduzir segurança ou adiar automaticamente. |
| Solução apenas esconde o erro | Exigir relação verificável com a causa ou declarar contenção temporária. |
| Melhoria opcional durante implementação | Propor Backlog; não aumentar o compromisso silenciosamente. |
| Duas IAs discordam | Comparar evidências e regras; encaminhar a decisão de produto ao responsável. |
| Ferramenta não atualiza Project | Informar item, campo e valor pendentes, sem declarar a atualização concluída. |
| Sprint termina com item incompleto | Registrar motivo e próximo passo; não marcar como entregue nem transferir automaticamente. |
| Critérios atendidos com melhorias futuras | Concluir a entrega e manter evolução separada, sem auditoria infinita. |
| Mesma falha persiste após duas rodadas de correção | Aplicar o diagnóstico de repetição da seção 5.2; não emitir outro repasse equivalente sem rever a causa e a verificação. |
| Uma frente está bloqueada | Delimitar a entrega afetada e conferir itens em revisão ou frentes independentes autorizadas, sem trocar prioridades do responsável por inferência. |

### 5.5 Evolução e preservação de documentos normativos

Procedimento principal da decisão de **31/10/2026**, descrita em [AGENTS.md, seção 1.8](../../AGENTS.md#18-evolução-controlada-e-preservação-de-documentos-normativos), com a [issue #59](https://github.com/dgnoleto/escala-do-reino/issues/59) como referência histórica e seu aceite preservado:

1. **Identificar a referência vigente:** cada documento mantém uma única versão vigente, com identificação e data claras. Quando não houver número anterior declarado, identificar o baseline datado e a primeira versão formal adotada, sem inventar histórico ou numeração retroativa.
2. **Apresentar o delta antes da alteração normativa relevante:** mostrar antes/depois, motivo, impactos e riscos; identificar decisões, regras de segurança, permissões e limites afetados. É proibido apagar, substituir ou enfraquecer silenciosamente essas disposições. Obter autorização expressa do responsável e revisão independente quando exigida pelos critérios existentes de [AGENTS.md, seção 3](../../AGENTS.md#3-critérios-para-convocação-de-revisão-independente).
3. **Preservar a referência anterior após a aprovação da mudança:** arquivar sua íntegra em [docs/operacao/versoes/](versoes/README.md) antes de substituir o conteúdo vigente, inclusive quando o responsável confirmar a alteração após alertas de risco ou impacto. Reutilizar a cópia existente quando ela já corresponder ao baseline; não duplicar nem sobrescrever arquivos históricos.
4. **Conferir e identificar o acervo:** manter os bytes originais, calcular SHA-256 e registrar no índice origem, versão/baseline, data de preservação, sucessora e decisão autorizadora. Explicar o diretório de origem necessário para interpretar os links relativos, sem editar as cópias para ajustá-los à pasta de arquivo. O acervo é histórico, sem efeito autorizativo concorrente.
5. **Atualizar a referência principal e seus links:** aplicar somente o delta aprovado, conferir a preservação das regras não afetadas e distinguir alteração local de publicação. Concentrar o procedimento nesta seção; os demais guias apontam para ela.
6. **Distinguir correção editorial:** ajustes sem mudança de sentido são rastreados pelo Git, sem cópia integral obrigatória a cada ajuste. Essa dispensa não permite disfarçar mudança normativa como edição de texto.

## 6. Ciclos e passagem de contexto entre conversas

O procedimento de sprint, os alertas e o tratamento de limitações do Project têm como referência principal o [guia de trabalho no GitHub](GUIA-TRABALHO-GITHUB.md). Usar os [modelos](../modelos/README.md) e o [índice de sprints](../sprints/README.md), evitando copiar regras em relatórios.

- Orquestração: uma conversa delimitada por sprint/ciclo, para prioridades, dependências e decisões. Execução: conversas delimitadas por issue ou resultado, podendo continuar até um ponto seguro.
- Ao se aproximar do término, avisar sobre a planning conforme a janela definida, sem interromper a tarefa autorizada ou iniciar a reunião no chat de execução.
- A partir do dia seguinte ao término, verificar o encerramento. Preparar resumo confiável antes de recomendar nova conversa, preferencialmente Work; não criar, arquivar ou encerrar automaticamente.
- A passagem informa objetivo, entregas comprovadas, limites, pendências/motivos, decisões, versão/ambiente relevantes e próximo passo, com uma lista curta de leituras. Publicação e alteração de issues/Project dependem da autorização própria.
- O resumo é um ponto de entrada, não uma prova substituta. Conferir o estado relevante antes de executar e aprofundar somente nas evidências e arquivos necessários. Abrir outro chat não garante economia de tokens por si só.
