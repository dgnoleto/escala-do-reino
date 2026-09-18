# PRD — Escala do Reino

**Frase do produto:** Organize os eventos e as equipes da sua igreja.

**Piloto previsto:** Ministério Shalom.

**Versão:** consolidação atualizada em 18 de setembro de 2026.

**Situação:** definição do produto; sem implementação, arquitetura ou escolha de tecnologias.

## 1. Como ler este documento

- **Decidido:** requisito confirmado para orientar o produto.
- **Proposto:** caminho apresentado, ainda sujeito à confirmação.
- **Pendente:** pergunta sem decisão suficiente para implementação.

As seções de requisitos representam decisões, exceto onde houver indicação expressa de proposta ou pendência. MVP significa a primeira versão utilizável. Nenhuma descrição abaixo representa software já disponível.

## 2. Problema, objetivo e público

Hoje, lideranças independentes organizam escalas por WhatsApp ou pessoalmente. Membros que servem em mais de uma equipe podem receber responsabilidades incompatíveis. Quando alguém recusa ou falta, a busca por substitutos ocorre sem uma visão compartilhada de horários, aptidões e compromissos.

O objetivo é permitir que a igreja organize a programação dos eventos, distribua responsabilidades, antecipe conflitos e acompanhe o preenchimento das vagas até o aceite dos membros. O produto deve atender eventos genéricos, como culto, simpósio e retiro/chácara, sem limitar a estrutura a um único modelo de culto.

Equipes de exemplo: louvor, dança, teatro, transmissão, sonoplastia, portaria, crianças, cozinha e limpeza. A lista é ilustrativa, não um cadastro obrigatório ou fechado.

## 3. Pessoas e responsabilidades

| Papel | Responsabilidade e limite |
| --- | --- |
| Administrador da igreja | Acessa toda a igreja e suas funções administrativas na web. No app, continua restrito às operações previstas para esse canal. |
| Responsável pela programação | Ordena os períodos e delega atividades às lideranças; pode indicar diretamente uma pessoa, por exemplo para a leitura de abertura. As permissões detalhadas de alteração ainda precisam ser definidas. |
| Líder de equipe | Administra sua própria equipe e habilita as aptidões dos respectivos membros. Não administra ou habilita funções de outras equipes. Monta a escala de sua equipe na web e acompanha a operação e substituições de vagas existentes. |
| Membro | Informa disponibilidade, consulta seus convites e compromissos, aceita ou recusa convites, cancela participação e responde a substituições. Não habilita a própria aptidão. |

Há um cadastro único de cada membro por igreja. Uma pessoa pode pertencer a várias equipes e ter várias funções habilitadas. Isso não significa que possa acumulá-las em qualquer intervalo.

## 4. Separação entre web e app mobile

**Decidido: a web concentra administração e planejamento. O app é somente uma extensão operacional.**

| Ação | Web | App mobile |
| --- | --- | --- |
| Cadastrar, renomear, editar e excluir membros, funções, ministérios/equipes, tipos de evento, períodos, atividades e durações padrão | Sim, conforme permissão | Não |
| Alterar configurações e habilitar aptidões | Sim, conforme permissão | Não |
| Criar eventos, organizar/editar programação e montar escalas iniciais | Sim, conforme permissão | Não |
| Consultar programação e acompanhar situações da escala | Sim, conforme permissão | Sim, conforme permissão |
| Informar disponibilidade, responder convites e cancelar a própria participação | Superfície web dessas operações ainda a detalhar | Sim |
| Acionar substituição de uma vaga existente e acompanhar o resultado | Sim, liderança autorizada | Sim, liderança autorizada |
| Receber notificações e responder a substituições | Apresentação web ainda a detalhar | Sim |

As restrições do app valem inclusive para administradores. O app não é um segundo painel administrativo. Web e app usam os mesmos dados: respostas operacionais se refletem na web, e configurações feitas na web se refletem no app. Isso é requisito de consistência, sem definir tecnologia ou prometer operação offline.

**Pendente:** autenticação e formato do app, como PWA ou aplicativo nativo. Nenhuma alternativa foi escolhida.

## 5. Estrutura de eventos e programação

A igreja cadastra tipos de evento, períodos nomeáveis, atividades e durações padrão configuráveis. Música com 5 minutos, dança com 15 e teatro com 20 são apenas exemplos; não são regras globais.

A programação organiza os períodos e suas atividades. Atividades podem ocorrer simultaneamente. A possibilidade de duas atividades coexistirem é diferente da permissão para uma pessoa acumular funções nelas.

O responsável pela programação ordena os períodos e delega atividades e responsabilidades às lideranças, ou indica uma pessoa diretamente. A liderança do louvor organiza músicas, cantores e instrumentistas; a liderança da dança organiza dançarinos, inclusive no mesmo período em que ocorre o louvor.

A indicação direta de uma pessoa não deve ser confundida com presença confirmada: a vaga somente é considerada preenchida após o aceite. Aptidão, disponibilidade e ausência de conflito continuam sendo verificadas.

No MVP, a música é apenas uma informação da programação. Não há biblioteca de letras, cifras ou gestão avançada de repertório.

## 6. Aptidão, disponibilidade e ocupação

| Conceito | Significado |
| --- | --- |
| Aptidão | Função para a qual a liderança habilitou o membro. Não é autodeclaração. |
| Disponibilidade | Informação registrada pelo membro sobre quando pode participar. |
| Reserva provisória | Ocupação criada por um convite individual enviado e ainda sem resposta; impede convites incompatíveis. |
| Confirmação | Compromisso assumido após aceite válido. |

Estar apto não significa estar disponível. Estar disponível não significa estar confirmado. Uma reserva provisória já deve participar da verificação de conflitos.

### 6.1 Regra do piloto para o período de louvor

Durante **todo o período de louvor**, cada membro só pode exercer uma função entre cantar, tocar ou dançar, mesmo quando as funções seriam em músicas distintas.

Fora desse período, por exemplo em uma oportunidade posterior, pode exercer outra função se não houver conflito com as demais regras e intervalos. A restrição do louvor não ocupa automaticamente o evento inteiro.

### 6.2 Serviços que atravessam períodos

Transmissão e sonoplastia reservam o intervalo inteiro do serviço, incluindo preparação e testes antes do início, conforme o intervalo definido. Essa ocupação pode atravessar vários períodos e impedir funções incompatíveis em qualquer trecho ocupado.

**Pendente:** detalhamento da configuração de preparação, deslocamento e demais margens entre compromissos.

### 6.3 Regras configuráveis e negociação

A regra de acúmulo de funções por pessoa é configurável e separada da simultaneidade das atividades. Quando houver impedimento, deve ser visível a equipe, a liderança responsável e o intervalo, permitindo que as lideranças negociem.

O sistema não deve trocar responsáveis silenciosamente. A autorização e aprovação de negociações entre equipes ainda não foram detalhadas. Também está pendente como combinar regras quando uma atividade permite o acúmulo e outra proíbe.

## 7. Convites individuais e ciclo da vaga

1. A liderança ou o responsável autorizado escolhe uma pessoa para uma vaga existente.
2. Antes do envio, são verificadas aptidão, disponibilidade, reservas provisórias, confirmações e regras de incompatibilidade.
3. O envio válido cria imediatamente uma reserva provisória visível como **aguardando confirmação**, com equipe, líder e intervalo identificados.
4. Essa reserva bloqueia novos convites incompatíveis, mesmo antes da resposta.
5. No aceite, as condições são verificadas novamente. Só o aceite válido confirma a pessoa e preenche a vaga.
6. Recusa, expiração ou cancelamento do convite liberam a reserva. A vaga permanece pendente de preenchimento.
7. Cancelamento após aceite libera o compromisso e reabre a necessidade de substituição, inclusive depois do limite normal de resposta.

O estado do convite e o estado da vaga são distintos: uma vaga com convite pendente ainda não está preenchida. O encerramento de um convite não elimina a necessidade daquela função.

### 7.1 Prazo de resposta

**Decidido:** cada igreja configura a antecedência de encerramento das confirmações. O limite é o início do evento menos essa antecedência e vale para **ambos os modos**. “12 horas antes” é apenas um exemplo, não um valor fixo do produto.

- **Fixo:** a duração nominal continua sendo 24 horas, sem edição. O convite vence no primeiro momento entre envio + 24 horas e o limite de confirmação antes do evento. Portanto, o limite pode reduzir o tempo efetivamente disponível para responder.
- **Livre:** o convite vence no limite de confirmação configurado pela igreja.

A precedência do limite sobre as 24 horas está decidida. As necessidades de substituição após esse limite, inclusive durante o evento, são atendidas pelas opções da seção 8.2, cujo detalhamento operacional ainda contém pendências. Não interpretar o encerramento normal como impedimento para buscar uma substituição urgente.

## 8. Substituições

A substituição deve atender recusa, expiração sem resposta e cancelamento após aceite, incluindo cancelamentos tardios. A vaga só fica preenchida quando houver aceite válido.

**Decidido:** os modos são exclusivos para a vaga; nunca devem operar simultaneamente:

| Modo | Funcionamento |
| --- | --- |
| Escolha individual | A liderança escolhe uma pessoa. O convite segue as regras de reserva provisória e confirmação. |
| Chamado automático | O chamado alcança todos os membros aptos e disponíveis da igreja para aquela função, excluindo pessoas com reservas ou compromissos incompatíveis. Não existe uma lista manual de reservas. |

**Decidido:** a escolha do modo deve existir no contexto de igreja/evento. **Proposto, a confirmar:** a igreja define um padrão que o evento pode sobrescrever. Essa hierarquia não está aprovada como regra final.

### 8.1 Fluxo proposto para o chamado coletivo

Foi apresentado e usado como referência de fluxo, mas deve continuar identificado como **proposta** até validação:

1. Abrir um chamado para todos os elegíveis, sem reservar o horário de todos eles.
2. Revalidar aptidão, disponibilidade e compromissos de quem tentar aceitar.
3. A primeira aceitação válida ocupa a vaga.
4. Encerrar o chamado para os demais e informar o preenchimento.
5. Impedir dupla ocupação quando duas respostas chegarem ao mesmo tempo.

A prevenção de dupla ocupação é um requisito obrigatório. O chamado coletivo não deve ser confundido com vários convites individuais que reservam todos os destinatários.

**Pendente:** regras operacionais de troca de modo durante uma busca em andamento, sem violar a exclusividade dos modos.

### 8.2 Prazo e acionamento das substituições

**Decidido:** a substituição precisa oferecer uma opção **com prazo configurado** e uma opção de **chamado imediato**, inclusive quando o evento já estiver em andamento. Por exemplo, uma pessoa escalada para a portaria pode passar mal e precisar ser substituída durante o serviço.

Essas opções tratam do prazo e da urgência. Não alteram os modos exclusivos de destinatários: escolha individual ou chamado automático ao grupo de elegíveis. Não autorizam usar ambos os modos de destinatários simultaneamente.

Uma necessidade pode surgir 3 horas ou 1 hora e 30 minutos antes do evento. Esses horários são exemplos de quando o imprevisto acontece, não durações definidas para responder ao chamado.

**Proposto, ainda sem confirmação:** a igreja estabelecer um prazo padrão para substituição e o líder poder ajustá-lo em cada chamado.

**Pendente:** quem configura o prazo de substituição, se haverá padrão e ajuste por chamado, como esse prazo se relaciona com o encerramento normal das confirmações e qual é o significado operacional e o vencimento exato do chamado imediato. “Imediato” não define, por si só, um tempo de expiração nem dispensa aceite e verificação de conflitos.

## 9. Mudanças na programação e conflitos

Os conflitos devem ser verificados no envio do convite, no aceite e após mudanças relevantes na programação. Alterações de duração ou horários podem produzir novos conflitos em reservas e confirmações existentes.

Quando isso ocorrer, o conflito deve ser sinalizado com os compromissos e lideranças envolvidos. Não substituir pessoas ou alterar responsáveis silenciosamente.

**Pendente:** quem pode alterar cada parte da programação, quais mudanças exigem reconfirmação e como tratar uma confirmação que passa a conflitar após uma alteração. A sinalização de conflito não equivale a uma resolução automática.

## 10. Visões compartilhadas e notificações

A visão compartilhada deve mostrar programação, confirmados, convites pendentes, vagas descobertas, conflitos e substituições, respeitando as permissões. Cada membro deve conseguir consultar seus convites e compromissos.

Notificações previstas:

- Convites recebidos e responsabilidades delegadas às lideranças.
- Recusas, cancelamentos e expirações que exigem atuação.
- Necessidade e abertura de substituições.
- Preenchimento de vagas e encerramento de chamados.
- Mudanças relevantes na programação ou no compromisso.

**Pendente:** canais e regras de entrega, como push, e-mail ou WhatsApp. A utilização atual do WhatsApp pelas lideranças não significa que exista uma integração prevista ou contratada.

Ausências durante o evento estão cobertas pelo fluxo de cancelamento e substituição. Avisos de outros incidentes gerais precisam ser especificados antes de entrar no escopo.

## 11. Escopo da primeira versão

**Incluído como requisito:** cadastros e configurações na web; organização de eventos e programação; escalas por equipe; habilitação de aptidões; disponibilidade; convites individuais com reserva; confirmações; detecção de conflitos; substituições; acompanhamento compartilhado e notificações. Pontos marcados como propostos ou pendentes ainda precisam de validação antes de implementação.

**Fora do MVP:**

- Chat geral e comunicação ampla sobre incidentes sem ligação com ausência ou escala.
- Gestão financeira; dízimos e ofertas podem aparecer apenas como atividades da programação.
- Biblioteca de letras/cifras e repertório avançado.
- Geração automática de toda a escala.
- Integrações e operação offline não especificadas.
- Check-in de presença no local do evento/igreja, registrado como evolução futura na seção 16.

## 12. Cenários verificáveis de aceite

Os cenários são critérios para a implementação futura, não testes já executados.

| ID | Situação | Resultado esperado |
| --- | --- | --- |
| C01 | Membro recebe convite individual pendente para dançar no louvor e outra liderança tenta convidá-lo para cantar no mesmo período. | O segundo convite é bloqueado; a reserva e a liderança responsável são mostradas. |
| C02 | As funções de dançar e cantar ocorreriam em músicas diferentes dentro do mesmo período de louvor. | A restrição continua valendo por todo o período. |
| C03 | O mesmo membro é indicado para outra função em uma oportunidade posterior ao louvor, sem outras incompatibilidades. | O convite é permitido, condicionado às demais verificações. |
| C04 | Um serviço de transmissão inclui preparação antes do evento e atravessa vários períodos. | Convites incompatíveis são bloqueados em todo o intervalo, inclusive preparação. O mesmo vale para sonoplastia. |
| C05 | Um convite individual expira sem resposta. | A reserva é liberada e a vaga continua pendente, permitindo substituição. |
| C06 | Membro recusa o convite ou a liderança cancela o convite pendente. | A reserva é liberada; a vaga não é considerada preenchida. |
| C07 | Um membro confirmado cancela depois do limite normal de resposta. | A substituição pode ser acionada, com opção de prazo configurado ou chamado imediato. O detalhamento do prazo e do vencimento imediato continua pendente. |
| C08 | Duas pessoas tentam aceitar a mesma vaga de chamado coletivo ao mesmo tempo. | Só uma aceitação válida preenche a vaga; as demais recebem o encerramento. O mecanismo sem reserva coletiva depende da validação da proposta. |
| C09 | Uma pessoa elegível ao receber o chamado passa a ter compromisso incompatível antes de aceitar. | O aceite é revalidado e não preenche a vaga se houver incompatibilidade. |
| C10 | Uma duração da programação muda e cria sobreposição com compromisso existente. | O novo conflito é sinalizado, sem troca silenciosa de responsáveis. |
| C11 | Líder tenta habilitar uma função ou administrar membro em outra equipe. | A operação é impedida fora de sua equipe. |
| C12 | Membro tenta habilitar sua própria aptidão. | A operação é impedida; a liderança habilita a aptidão. |
| C13 | Administrador ou líder usa o app mobile. | Não encontra nem consegue executar cadastro administrativo, renomeação, edição/exclusão administrativa, criação de evento ou montagem inicial de escala. |
| C14 | Líder usa o app para acionar substituição de vaga existente sob sua responsabilidade. | A operação é permitida conforme o modo aplicável e as permissões. |
| C15 | Um aceite válido ocorre no app. | A web reflete a confirmação e o preenchimento da vaga. |
| C16 | Configuração é alterada na web. | O app passa a observar a configuração aplicável, respeitando as regras ainda pendentes sobre mudanças em compromissos existentes. |
| C17 | Uma vaga já está em busca individual e alguém tenta manter também um chamado automático ativo. | Os dois modos não operam simultaneamente para essa vaga. |
| C18 | Música, dança ou teatro recebem duração padrão configurada pela igreja. | A programação usa a configuração aplicável; 5, 15 e 20 minutos não são valores globais obrigatórios. |
| C19 | Um convite no modo fixo é enviado quando faltam mais de 24 horas para o limite de confirmação. | Vence em envio + 24 horas. |
| C20 | Um convite no modo fixo é enviado quando faltam menos de 24 horas para o limite de confirmação. | Vence no limite, mesmo sem completar 24 horas; a duração nominal do modo permanece não editável. |
| C21 | Um convite usa o modo livre. | Vence no limite calculado a partir da antecedência configurada pela igreja. |
| C22 | A igreja configura uma antecedência diferente de 12 horas. | O limite configurado é aplicado aos dois modos; 12 horas não é um padrão obrigatório. |
| C23 | Durante o evento, uma pessoa escalada para a portaria passa mal e precisa ser substituída. | A liderança pode acionar substituição imediata da vaga existente, respeitando aptidão, disponibilidade, conflitos, aceite e o modo exclusivo de destinatários. O vencimento exato depende da definição pendente. |

## 13. Como avaliar o piloto

Não há metas numéricas aprovadas. A coleta e a definição precisa de cada indicador deverão ser combinadas no planejamento do piloto:

| Indicador | O que observar |
| --- | --- |
| Conflitos antecipados | Conflitos identificados antes de comprometer a execução do evento. |
| Vagas abertas no início | Quantas responsabilidades continuam sem pessoa confirmada quando o evento começa. |
| Tempo de substituição | Tempo entre a abertura da necessidade e um novo aceite válido. |
| Resposta dentro do prazo | Proporção de convites respondidos dentro do prazo aplicável. |
| Coordenação externa | Necessidade de WhatsApp ou conversas paralelas para resolver a escala. |
| Clareza para os membros | Se as pessoas entendem quando, onde na programação e em qual função deverão servir. |

## 14. Decisões a resolver antes das etapas dependentes

| Tema | Questão em aberto |
| --- | --- |
| Prazo de substituição | Quem configura? Haverá padrão da igreja e ajuste pelo líder por chamado? Como se relaciona com o limite normal de confirmação? A proposta de ajuste por chamado ainda não foi confirmada. |
| Chamado imediato | Qual é seu funcionamento operacional e seu vencimento exato, inclusive durante o evento? |
| Hierarquia de configuração | O evento pode sobrescrever o padrão da igreja? Quais configurações seguem essa hierarquia? |
| Chamado coletivo | Confirmar o fluxo sem reserva coletiva, com revalidação e primeira aceitação válida. |
| Troca de modo | Como encerrar uma busca antes de adotar o outro modo de substituição? |
| Acúmulo | Como combinar regras divergentes entre atividades e delimitar seu alcance? |
| Negociações | Quem propõe, autoriza e aprova mudanças de pessoas entre equipes? |
| Programação | Quem altera cada parte e quais mudanças exigem reconfirmação? Como tratar conflitos novos? |
| Intervalos | Como representar preparação, testes, deslocamento e margens entre compromissos? |
| Disponibilidade | Como registrar seus intervalos e tratar ausência de informação ou mudança após um compromisso? |
| Exclusão administrativa | Como tratar cadastros vinculados a eventos e compromissos existentes ao editar ou excluir? |
| Acesso e comunicação | Como será a autenticação, a apresentação das operações na web e a entrega de notificações? |
| Formato mobile | Qual formato atenderá às operações do app sem ampliar seu escopo administrativo? |

As últimas questões de detalhamento não impõem soluções: registram lacunas necessárias para evitar decisões silenciosas na implementação.

## 15. Sequência de trabalho

Primeiro, validar regras de negócio, fluxos e programação dos eventos. Depois, definir arquitetura e desenhar a aplicação. Somente então iniciar código em incrementos verificáveis, com apoio de IA, respeitando o fato de que o responsável pelo projeto não programa.

Cada incremento deve ter um comportamento concreto para demonstrar, critérios de aceite e registro do que foi ou não verificado. Questões em aberto devem ser resolvidas antes de implementar a parte que depende delas. Este PRD não escolhe stack, banco de dados, provedor, integração, formato mobile ou solução de arquitetura.

## 16. Evolução futura — fora do MVP

### Check-in de presença para apoiar substituições urgentes

**Ideia registrada em 18/09/2026 para avaliação futura, explicitamente fora do MVP:** permitir check-in de presença no local do evento ou na igreja, ajudando a liderança a identificar membros aptos que já estejam presentes ao buscar um substituto urgente.

**Exemplo:** Alberto está escalado para a portaria e passa mal. João também é habilitado para a portaria e fez check-in no local. A liderança pode identificá-lo como uma pessoa presente e acioná-lo para a substituição.

O check-in seria uma informação de apoio à busca. Não equivale a aptidão, disponibilidade, aceite ou atribuição automática e não substitui as regras de conflitos e confirmação.

**Detalhes futuros em aberto:** método de check-in, como a presença será atualizada e por quanto tempo será considerada válida. Não há decisão sobre GPS, rastreamento, raio de distância ou qualquer mecanismo específico. Um check-in não presume presença permanente, nem autoriza geração automática de escala.
