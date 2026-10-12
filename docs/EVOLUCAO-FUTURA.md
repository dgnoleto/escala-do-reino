# Evolução futura — Escala do Reino

**Consolidação:** 30/09/2026, com atualizações de governança em 03/10/2026 e esclarecimentos de visão, backlog e apoio humano em 12/10/2026.

As **seções 1 a 9** deste documento descrevem visões e desenhos de produto que estão **fora do escopo do MVP**. O [PRD](PRD.md) define o recorte ativo do MVP: líderes operam, membros consultam, substituições são combinadas fora do aplicativo. As seções 10 a 12 consolidam o descarte definitivo de provedores, a decisão de exclusão lógica recuperável (etapa 4 do MVP) e a sequência oficial de governança acordada com o responsável.

**Decidido para evolução** preserva uma regra já expressa, sem prometer entrega. **Proposto** requer confirmação. **Pendente** requer detalhamento. Não há datas de lançamento ou tecnologia escolhida.

### Ordem de execução e leitura por pessoas ou IAs

**Esclarecimento do responsável em 12/10/2026:** o MVP permanece o recorte do módulo **Escala do Reino** já definido no PRD e nos contratos. As propostas adicionais do ecossistema e as melhorias fora desse recorte permanecem em backlog; seu desenvolvimento só poderá começar depois da conclusão do escopo acordado para o Escala do Reino, mediante priorização e autorização específicas. Não iniciar módulos em paralelo por inferência a partir desta visão.

Registrar e esclarecer essas ideias documentalmente antes da conclusão é permitido; isso não inicia implementação, integração ou preparação técnica de módulos futuros.

Essa condição não adia requisitos já integrantes do MVP, como a etapa acordada de exclusão lógica/recuperação. Concluir o módulo exige conferir seus critérios acordados, evidências e limites; não equivale apenas a concluir convites, instalar ferramentas ou incorporar um PR. Melhorias futuras não são automaticamente acrescentadas aos critérios de conclusão do módulo.

A [Visão do Ecossistema](VISAO-ECOSSISTEMA.md) explica a direção estratégica; este documento preserva ideias e decisões futuras. Os nomes, a organização e os limites dos demais módulos são provisórios. Os seis pilares não representam seis produtos fechados ou uma ordem aprovada de implementação.

O PRD e os contratos definem requisitos aprovados, o [Estado atual](ESTADO-ATUAL.md) e as evidências delimitam implementação/validação, e o [Guia de trabalho no GitHub](GUIA-TRABALHO-GITHUB.md) define o processo de acompanhamento. Descrições de andamento nas seções 10–12 devem ser lidas com suas referências históricas e conferidas contra essas fontes atuais; sua atualização é acompanhada separadamente pela [issue #12](https://github.com/dgnoleto/escala-do-reino/issues/12).

### Apoio à liderança e elaboração manual de métricas

Nas propostas futuras de frequência, ausência, participação e engajamento, pessoas autorizadas informarão os registros e a aplicação servirá para guardá-los e permitir pesquisas. O líder considera contexto e qualidade dos registros e elabora manualmente suas próprias métricas e interpretações.

A aplicação não cria presença ou ausência por inferência, não presume ausência quando falta um registro e não gera por iniciativa própria pontuações de engajamento/fidelidade, diagnósticos emocionais ou espirituais, recomendações de consagração ou alertas pastorais por limiares presumidos. Consultar dados não substitui diálogo nem avaliação humana. Três faltas é exemplo de pesquisa possível pelo líder, não regra fixa nem gatilho automático aprovado.

Esse limite se refere à avaliação pastoral de pessoas; não cancela requisitos operacionais do PRD, cálculos de cronômetro ou desenhos futuros de convites já preservados. Qualquer nova automação depende de proposta, regras, avaliação e autorização próprias. Em divergência documental, registrar a dúvida e consultar o responsável antes de implementar.

## 1. Disponibilidade, convites de participação e confirmação

Os convites desta seção são para servir em uma escala. Não se confundem com o convite de acesso à igreja, que já pertence ao MVP.

### Regras preservadas para evolução

- Aptidão, disponibilidade, reserva provisória e confirmação são conceitos distintos. A liderança habilita aptidão; o membro poderá registrar disponibilidade numa evolução.
- Convite individual enviado cria reserva provisória visível como **aguardando confirmação**, com equipe, líder e intervalo. Bloqueia convites incompatíveis.
- Verificar aptidão, disponibilidade, reservas, compromissos e regras no envio e no aceite, e reavaliar conflitos após mudanças da programação.
- Aceite válido confirma e preenche a vaga. Recusa, expiração ou cancelamento do convite liberam a reserva e mantêm a vaga pendente.
- Cancelamento após aceite libera compromisso e permite substituição, inclusive depois do limite normal.
- Não alterar responsáveis silenciosamente. Mostrar a liderança responsável para negociação.
- O fluxo futuro de indicação direta também dependerá de aceite; isso **não se aplica ao preenchimento manual da escala do MVP**.
- Pedidos de mudança e a participação operacional do membro permanecem adiados; seu detalhamento não está aprovado.

A regra piloto de exclusividade cantar/tocar/dançar por todo o período de louvor, a possibilidade de outra função em oportunidade posterior sem conflito e os intervalos contínuos de transmissão/sonoplastia continuam relevantes. O motor genérico de regras de acúmulo fica futuro, separado da simultaneidade de atividades.

### Prazos já decididos em 18/09

A antecedência de encerramento é configurável por igreja. O limite é o início do evento menos essa antecedência e se aplica aos **dois modos**:

| Modo | Vencimento |
| --- | --- |
| Fixo | Primeiro momento entre envio + 24 horas e o limite antes do evento. A duração nominal de 24 horas não é editável, mas o limite pode truncá-la. |
| Livre | No limite de confirmação configurado pela igreja. |

“12 horas antes” foi apenas exemplo, não um valor obrigatório. Duração de atividade não se confunde com prazo de confirmação.

### Substituição futura com chamados

A substituição atenderá recusa, expiração sem resposta e cancelamento após aceite. Vaga só se preenche com aceite válido **neste desenho futuro**.

Os modos de destinatários são exclusivos, nunca simultâneos para a mesma vaga:

1. Líder escolhe uma pessoa individualmente.
2. Chamado automático a **todos os aptos e disponíveis da igreja** para a função, excluindo reservas/compromissos incompatíveis. Não há lista manual de reservas.

**Proposto, a confirmar:** herdar o modo padrão da igreja e permitir sobrescrita no evento.

**Fluxo coletivo proposto:** não reservar o horário de todos os destinatários; revalidar no aceite; primeira aceitação válida ocupa; fechar para os demais. Impedir dupla ocupação concorrente é requisito obrigatório da evolução.

**Decidido para evolução:** oferecer substituição com prazo configurado e chamado imediato, inclusive com evento em andamento. Isso não altera a exclusividade de destinatários individual/grupo. Necessidade surgindo 3 horas ou 1 hora e 30 minutos antes é exemplo do momento do imprevisto, não duração de resposta aprovada.

**Proposto, ainda não respondido:** padrão de prazo da igreja com possibilidade de ajuste pelo líder por chamado.

**Pendentes:** quem configura prazos, ajuste por chamado, relação com limite normal, significado operacional e vencimento exato do chamado imediato, transição entre modos sem sobreposição e tratamento de convites perto/depois do limite. “Imediato” não equivale a expiração inventada.

### Outras pendências e avisos desse fluxo

Detalhar representação da disponibilidade e sua ausência/alteração, autorização de negociações, combinação de regras divergentes, hierarquia de configurações e reconfirmação após mudanças relevantes. Notificar convites, responsabilidades, recusas/cancelamentos/expirações, substituições, preenchimento e mudanças pertinentes. Na evolução desses convites, canais externos ainda não foram escolhidos; não pressupor WhatsApp. A decisão atual do MVP é de notificações somente internas.

Cenários futuros: convite pendente de dança bloqueia cantor no mesmo louvor; expiração libera; cancelamento tardio permite substituição; duas aceitações simultâneas não ocupam a mesma vaga duas vezes; prazo fixo é truncado pelo limite quando necessário. Esses não são critérios de aceite ativos do MVP.

## 2. Check-in de presença no local

**Ideia guardada, expressamente fora do MVP:** check-in no evento/igreja para a liderança identificar membros aptos já presentes quando busca substituto urgente.

Exemplo: Alberto está na portaria e passa mal; João também é habilitado e fez check-in. O líder pode identificá-lo e acioná-lo.

Check-in não é aptidão, disponibilidade, aceite ou escala automática e não elimina conflito. Método, atualização e validade da presença ficam abertos. Não presumir GPS, rastreamento, raio de distância ou presença permanente.

## 3. Participação aberta

**Adiada em 30/09:** forma de participação em que todos os aptos da equipe são convidados a participar, sem confirmação eletrônica individual, reserva por integrante ou vaga obrigatória para substituir cada ausência.

Esse desenho não garante presença nem elimina conflito de alguém com função incompatível. Sua representação exigiria distinguir aptidão, participação potencial e escala efetiva. No MVP, somente a escala com nomes definidos pelos líderes está ativa.

## 4. Dashboards e aprendizado

**Evolução futura, após a conclusão do Escala do Reino:** líderes e pessoas autorizadas poderão consultar registros de previsto/realizado, excedentes, antecipações, interrupções, cancelamentos e motivos. Filtros mensais/trimestrais e formas de visualização, inclusive dashboards, ainda dependem de desenho. Um eventual resumo compartilhável exige definição de conteúdo e permissões; a integração entre módulos não concede acesso geral aos registros.

O histórico básico e os registros de execução pertencem ao MVP, com retenção de **um ano**, para viabilizar aprendizado posterior. Recolher feedback após 2–3 meses de uso não é data prometida de lançamento e não amplia automaticamente o prazo de retenção para registros dos módulos futuros.

O líder poderá pesquisar esses registros e elaborar manualmente suas análises e métricas. A aplicação oferece informação para consulta; não atribui automaticamente falha, culpa, engajamento, fidelidade ou condição emocional/espiritual a alguém.

Ao analisar execuções interrompidas, reinícios, excesso e intervalos entre atividades, considerar todos os registros pertinentes, e não apenas a última tentativa: uma execução interrompida seguida de reinício preserva o tempo de ambas. Distinguir correção de toque errado de interrupção real. Um intervalo da sequência principal não presume ociosidade das equipes de apoio.

Ao interpretar dados:

- Separar atraso real de início, atraso no registro e excesso de duração. Culto previsto para 19h e abertura iniciada às 19h15 tem atraso inicial, não quinze minutos de excesso da abertura. Se a abertura começou às 19h15 e só foi registrada às 19h18, a correção preserva esses dois momentos e a previsão original.
- Não atribuir automaticamente falha técnica à pessoa.
- Considerar quantidade de participações, contexto e precisão das marcações humanas. Falta de registro não comprova falta da pessoa.
- Não criar ranking punitivo ou usar os dados como classificação automática de pessoas.
- O líder define e interpreta manualmente os indicadores que considerar úteis; consultas de ausência/participação não são gatilhos pastorais aprovados.

Indicadores antigos de taxa de resposta dentro do prazo e tempo até novo aceite pertencem à evolução de convites, não ao MVP. Não há metas numéricas aprovadas.

## 5. Outros eventos, modelos e turnos

Visão além do piloto: simpósios, retiros/chácara e outras equipes/serviços, como intercessão, cozinha, obreiros, crianças, limpeza e teatro. Não exigir operação completa desses contextos no piloto de culto.

Distinguir tipo, modelo reutilizável e edição do evento. Sugestões de participantes a partir do modelo foram aprovadas como ideia, sem confirmação automática.

Atividades paralelas, como turnos de intercessão de 30 minutos, cozinha e obreiros, não dependem do avanço da sequência principal. Trinta minutos é exemplo de turno, não duração universal.

**Escolha por atividade**, em evolução, entre dois modos de troca:

| Modo | Regra futura |
| --- | --- |
| Por horário | Mostrar o próximo **previsto**, sem presumir que assumiu. |
| Confirmação ao assumir | Registrar a assunção real; não confundir com aceite antecipado de convite. |

Se não houver confirmação ao assumir após tolerância configurável, avisar **primeiro o líder**. Não substituir automaticamente. Os detalhes de tolerância, destinatários posteriores e correções ainda precisam de definição.

## 6. Dependências e regras amplas

Relações devem ser configuráveis, não codificadas apenas como dependência fixa entre ministérios. Exemplo: organização de músicas e instrumentos libera repertório/escala para dança, que pode preparar rascunho antes e finalizar depois.

Confirmação de organização é diferente de aceite do membro. Motor amplo de dependências e combinação de regras de acúmulo estão adiados. O MVP usa checklist simples de preparação: atividade permanece na programação e a pendência é destacada quando ela vira a próxima, sem bloquear início ou conceder permissões.

## 7. Delegação, compartilhamento e limite para retorno

**Ideia futura:** o líder da liturgia inicia a primeira atividade e líderes das demais passam a poder iniciar ou devolver suas atividades, conforme regras a detalhar. No MVP, todo controle de andamento permanece exclusivamente com o líder da liturgia daquela edição do evento.

**Proposta futura, sem aprovação como regra:** permitir retorno para pendente somente até dois minutos após o início e, depois, apenas cancelar. Não aplicar esse limite no MVP nem confundi-lo com pausa/retomada. Atualmente, reiniciar atividade pendente usa a duração prevista inteira e preserva a execução interrompida.

**Compartilhamento externo futuro:** permitir compartilhar avisos com outros aplicativos. Canais, formato, conteúdo e permissões ainda precisam ser definidos. Não presumir integração, envio automático ou suporte a redes específicas. No MVP, notificações são apenas internas.

## 8. Limites e ideias não aprovadas

Offline é futuro; piloto pressupõe internet. Integrações não especificadas não são compromissos. Chat geral, incidentes amplos, finanças, biblioteca de letras/cifras, player, upload e geração automática de escala inteira não têm entrega aprovada.

A hipótese anterior de membro preencher música/link/tom foi substituída pela decisão de membros apenas consultarem no MVP. Não deve ser tratada como permissão aprovada nem reativada automaticamente numa evolução. Eventual reconsideração exige nova decisão.

## 9. Modularização e novos módulos

**Ideia futura registrada em 02/10/2026, complementada pelos esclarecimentos do responsável em 12/10/2026:** avaliar a evolução por módulos, com a **Plataforma do Reino** como ecossistema e o **Escala do Reino** como módulo inicial. As propostas adicionais só poderão entrar em desenvolvimento após a conclusão do escopo acordado para o Escala do Reino e a decisão específica de prioridade e execução.

A [Visão do Ecossistema](VISAO-ECOSSISTEMA.md) organiza necessidades em pilares conceituais. Os nomes, agrupamentos e limites dos demais módulos ainda não estão confirmados. Possibilidades preservadas no backlog:

- Cursos online disponibilizados pela igreja, educação cristã e inclusão digital.
- Simpósios pagos, retiros, eventos e suas necessidades financeiras.
- Gestão financeira da igreja, com recortes a definir.
- Células, discipulado e consultas de frequência, ausência e participação para apoio à liderança.
- Patrimônio, fornecedores e manutenção preventiva.
- Outras melhorias futuras identificadas no manifesto, sem incorporá-las ao MVP por referência.

Nas propostas de acompanhamento pastoral, a aplicação guarda registros informados e permite consultas; o líder elabora manualmente métricas e interpretações. Não há pontuação de fidelidade, diagnóstico, recomendação automática de consagração ou alerta pastoral por número de faltas aprovado por este backlog.

Em cursos online, poderá fazer sentido permitir ao participante escolher um fuso para visualizar os horários; essa preferência não existe no MVP de escala, em que o membro herda o fuso da igreja.

Não há compromisso de entrega, prioridade, prazo ou arquitetura técnica aprovada para esses módulos. Pagamentos, integrações, permissões e estrutura de dados serão definidos quando cada frente for avaliada. A conclusão do Escala do Reino atende uma condição para a execução futura; não inicia automaticamente os demais módulos nem dispensa a decisão de prioridade e autorização.

## 10. Provedores de login (descarte definitivo de Apple e Microsoft)

**Decisão do responsável em 03/10/2026:** Apple e Microsoft foram descartados nesta etapa do projeto pelo responsável em razão dos custos de configuração avaliados e **não** constituem entrega futura comprometida, sem qualquer compromisso de implementação posterior. O MVP mantém previstos Google e e-mail/senha gerenciados pelo Supabase Auth (estando apenas Google ativo na interface neste momento).

## 11. Exclusão lógica e recuperação de cadastros (Etapa 4 do MVP)

**Decisão do responsável em 03/10/2026:**
- **Decidido:** Exclusões de cadastros da aplicação devem ser lógicas e recuperáveis, preservando identificadores (`member_id`), referências e integridade histórica (escalas, ministérios, auditoria). O fluxo de produto não deve apagar fisicamente registros para removê-los da operação. Membro, conta Auth e vínculo de acesso são entidades distintas; exclusões lógicas de membros não excluem contas Auth nem implicam restauração automática de acesso. A recuperação de cadastros excluídos logicamente exige autorização explícita e auditoria. A exclusão de um membro vinculado à administração não pode contornar a proteção do último administrador da igreja. Esta decisão não substitui a política separada de retenção de histórico e registros técnicos, nem afeta a limpeza transacional de fixtures dos ensaios SQL.
- **Pendente para a etapa 4 da sequência de governança:** Definição da representação física no banco de dados, autorização operacional, efeitos da exclusão em vínculos, convites e escalas, adaptação de consultas e especificação do procedimento de recuperação. Deve-se avaliar nessa etapa a relação direta com a coluna de status `active`/`inactive` já existente na tabela `app_private.members`, evitando criar dois mecanismos concorrentes ou redundantes (como `deleted_at` ou status adicionais, que não foram introduzidos neste incremento).

## 12. Sequência de governança e próximos incrementos

A sequência oficial de desenvolvimento aprovada pelo responsável é rigorosamente:

1. **Documentação e alinhamento de requisitos:** consolidação das regras de criação de igreja, administração única por conta, continuidade administrativa, convites, seleção de contexto e exclusão lógica em todos os documentos técnicos e funcionais do projeto.
2. **Criação de igreja e administração (entregue no código, scripts e testes, integrado via PR #7):** implementação do fluxo "Criar minha igreja" controlado no servidor (criação atômica de igreja, membro do criador, vínculo de admin e auditoria), imposição sistêmica de no máximo 1 igreja administrada por conta Auth (índice parcial `church_access_single_active_admin_idx`) e regra de continuidade administrativa (gatilhos `protect_last_active_admin` e `protect_last_active_admin_member`). Objetos 009/010 instalados no piloto e código integrado à main no merge `d372a58`.
3. **Convites e seleção de contexto de igreja (etapa em preparação de contratos):** fluxo de emissão de convite com e-mail informado no momento do envio, compartilhamento manual do link pelo administrador no primeiro incremento, resgate com mesmo e-mail confirmado, confirmação de nome existente ou proposta de outro nome (com reemissão cancelando proposta pendente e rejeição encerrando tentativa), suporte a múltiplos vínculos por conta Auth, seletor de igreja ativa com isolamento estrito de permissões/dados e invalidação automática de cache na troca de contexto.
4. **Exclusão lógica e recuperação:** avaliação técnica entre `active`/`inactive` e `deleted_at`, implementação de remoção lógica preservando chaves e integridade, fluxo auditado de recuperação e validação de que remoções não contornam a trava do último administrador.

A etapa 2 encontra-se concluída e integrada à main; a etapa 3 constitui o incremento atual em preparação de contratos; a etapa 4 aguarda seu incremento próprio.

