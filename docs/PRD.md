# PRD — Escala do Reino

**Organize os eventos e as equipes da sua igreja.**

**Piloto:** Ministério Shalom.

**Consolidação:** 30 de setembro de 2026.

**Situação:** protótipo web local em avaliação; ainda não é uma aplicação pronta para produção. Arquitetura, segurança e tecnologia do aplicativo Android/iOS não estão fechadas.

**Atualização de canais e regras de planejamento:** 2 de outubro de 2026.

O [documento de arquitetura do banco e das permissões](ARQUITETURA-BANCO.md) complementa este PRD, sem substituí-lo. As propostas técnicas e pendências nele identificadas não criam novos requisitos de produto por si só.

## 1. Recorte e precedência

O MVP é a primeira versão utilizável, focada no **culto**. Deve ajudar a responder: quem está agora, quem é o próximo e quem entra quando alguém falta.

**Decisão final de escopo:** líderes organizam e atualizam; membros apenas consultam. O líder registra ausências e substituições após combinar com as pessoas fora do aplicativo. **Não há exigência de aceite eletrônico do substituto no MVP.**

Esse recorte substitui o desenho anterior que exigia convites de participação, reservas provisórias, prazos e confirmações pelos membros. Convite de acesso à igreja é outro conceito e está incluído no MVP. Essas regras estão preservadas em [Evolução futura](EVOLUCAO-FUTURA.md), fora dos requisitos ativos desta versão. A possibilidade anteriormente discutida de o membro enviar link ou tom também não vale no MVP: os líderes preenchem, os membros consultam.

Neste documento, **decidido** identifica requisitos confirmados; **proposto** não equivale a aprovado; **pendente** indica detalhamento ainda necessário. A existência de telas no protótipo não comprova a implementação integral das regras descritas.

## 2. Problema e resultado esperado

As lideranças organizam equipes separadamente, por WhatsApp ou pessoalmente. Membros de várias equipes podem receber funções incompatíveis, e faltas exigem coordenação sem uma visão comum. Durante o culto, as pessoas precisam saber quem está atuando e quem vem depois.

O piloto deve permitir conduzir o culto, resolver ausências e manter os participantes informados sem perguntar continuamente quem é o próximo. A coordenação e o aceite de substituições continuam externos; não se promete eliminar WhatsApp.

## 3. Acesso, responsabilidades e permissões

Há um cadastro único de cada membro por igreja. Uma pessoa pode integrar várias equipes e ter várias funções habilitadas. A liderança habilita a aptidão; o membro não se habilita.

**Decidido:** ministério e equipe representam o mesmo grupo no piloto, com um único cadastro.

### 3.1 Entrada na igreja

**Decidido:** login com Google ou Apple, com acesso à igreja por convite associado a um membro previamente cadastrado. Fazer login, por si só, não libera dados da igreja. A pessoa não escolhe livremente igreja, equipe ou privilégios e não pode consultar dados de outra igreja sem autorização.

Uma pessoa convidada pode não ter função habilitada e ainda assim consultar o cronograma geral. Convite de acesso não é convite para participar de uma escala. **Somente admin pode enviar convites de acesso.** Associação, validade e procedimento de revogação ainda precisam de detalhamento.

### 3.2 Papéis e limites

| Papel | Responsabilidade |
| --- | --- |
| Administrador | Permissão independente para administrar a igreja e seus cadastros na web, enviar convites de acesso e designar/trocar lideranças. Não concede automaticamente controle do culto nem cadastros no mobile. |
| Líder da liturgia do evento | Define a sequência principal e coordena sua execução. No MVP, é também o único responsável pelo andamento: inicia, avança, devolve para pendente, cancela a atividade em execução, corrige horários e encerra o culto. Acompanha todos os bastidores do evento. |
| Líder de equipe/atividade | Organiza e escala sua própria equipe e habilita suas aptidões. Pode realocar pessoas enquanto sua atividade ainda não começou. Depois de iniciada, a substituição fica exclusivamente com o líder da liturgia. Consulta e gerencia os bastidores sob sua responsabilidade, sem controlar o andamento principal. |
| Membro | Consulta o cronograma macro e, quando escalado, os detalhes da própria participação. Não edita programação, música, tom, link ou cadastros, nem responde convites de participação no MVP. |

**A liderança da liturgia é designada por edição do evento:** o culto de domingo pode ter uma pessoa, o de quarta outra e o de sábado outra. No MVP, não existe um operador separado com permissão autônoma de andamento; o líder da liturgia acumula essa responsabilidade. Delegar o controle às demais lideranças fica para evolução futura.

O líder da liturgia não monta inicialmente as equipes dos outros líderes. Sua atuação excepcional durante uma atividade em execução permite registrar substituições combinadas externamente, respeitando aptidão e conflitos. Não exige que ele seja administrador global.

**Decidido:** somente admin pode designar e trocar lideranças. A permissão admin é independente e pode ser acumulada com liderança de atividade ou liturgia. São válidos os perfis somente admin, somente líder da liturgia, somente líder de atividade e suas combinações autorizadas. Não exigir liderança de liturgia para tornar um líder de atividade admin.

Ser admin não habilita conduzir um evento no qual a pessoa não foi designada líder da liturgia. **Pendente:** procedimento da transferência durante um culto já iniciado, preservando controle inequívoco por evento e evitando ações concorrentes da liderança anterior e da nova.

### 3.3 Localização e fuso da igreja

**Decidido:** cadastrar o fuso horário e o local da igreja pelo Google Maps. Os membros herdam o fuso da igreja consultada, sem preferência individual de alteração no MVP. Uma conta com acesso a igrejas diferentes usa o contexto da igreja consultada. A representação técnica do fuso e da localização está no documento de arquitetura.

## 4. Web e mobile

**Decidido em 02/10/2026:** o protótipo web está sendo avaliado agora. Uma versão própria para Android e iOS virá em etapa posterior; Flutter continua apenas uma possibilidade, sem escolha de tecnologia ou data. A tabela abaixo descreve os limites de cada canal **quando ambos existirem**, não uma obrigação de entregá-los juntos.

Enquanto a web for acessível pelo navegador do celular, ela deve preservar o uso básico: ler o cronograma e abrir os detalhes autorizados das atividades, sem rolagem horizontal ou controle essencial inacessível. O acabamento específico da experiência mobile será desenhado para o aplicativo posterior; não bloquear a evolução do protótipo web por ajustes visuais pequenos que não prejudiquem esse uso básico.

O **Guia de Validação do PRD** é ferramenta temporária do protótipo/piloto, não funcionalidade do produto. Seu acionador compacto ainda pode sobrepor parte de um cartão em tela estreita; registrar como ajuste visual conhecido, sem tratar isso como impeditivo do protótipo enquanto leitura e abertura da atividade funcionarem. Antes de disponibilizar o sistema para uso real pelos membros, retirar o guia da experiência deles. Ele não faz parte do aplicativo Android/iOS.

| Ação | Web | Mobile |
| --- | --- | --- |
| Cadastrar, editar, renomear e excluir tipos, modelos, atividades, durações padrão, membros, funções, equipes e motivos de cancelamento | Conforme permissão administrativa | Não, inclusive para administrador |
| Habilitar aptidões e alterar configurações | Liderança/administração no âmbito autorizado | Não |
| Criar evento, planejar programação, checklist e escala inicial, preencher oportunidades/músicas | Lideranças conforme responsabilidade | Não como cadastro de planejamento |
| Consultar cronograma e detalhes autorizados | Sim | Sim |
| Registrar ausência e substituir em escala existente | Conforme responsabilidade e estado da atividade | Conforme responsabilidade e estado da atividade |
| Iniciar/avançar, devolver para pendente, cancelar atividade em execução, corrigir horários e encerrar culto | Somente líder da liturgia desse evento | Somente líder da liturgia desse evento |

O aplicativo Android/iOS será uma extensão de consulta e execução, não um painel de administração. Os mesmos dados deverão sustentar os dois canais e as permissões valerão para qualquer forma de executar a ação, não apenas para a exibição de botões. A posição exata dos controles e o detalhamento operacional do checklist serão resolvidos no desenho, preservando esses limites.

## 5. Modelo de culto, atividades e escalas

O piloto utiliza um modelo de culto simples. A web administra tipos e modelos, sem exigir um motor genérico de regras ou operação completa de retiros.

- **Tipo:** categoria do evento.
- **Modelo:** estrutura reutilizável de planejamento.
- **Evento:** edição concreta com data e programação próprias.

Uma atividade pode abranger **o evento inteiro ou apenas parte dele**. Isso é independente de ser incluída por padrão no modelo. O modelo Culto pode incluir portaria, sonoplastia e transmissão automaticamente, mas não escala nem confirma pessoas: cada líder preenche sua equipe depois.

É possível ajustar a edição específica, por exemplo realizar um culto sem transmissão. A preparação antes do início conta no intervalo de ocupação e nos conflitos quando estiver configurada. Durações padrão são configuráveis; exemplos de 5, 15 ou 20 minutos não são valores universais.

### 5.1 Participação específica no MVP

Os líderes definem nominalmente quem exercerá cada responsabilidade. Não há confirmação eletrônica individual; o combinado ocorre fora do aplicativo.

**Participação aberta foi retirada do MVP em 30/09**, para evitar confundir pessoas aptas com pessoas efetivamente escaladas. O desenho anterior foi preservado em evolução futura. Ter uma função habilitada não significa estar escalado naquele evento nem garante presença.

### 5.2 Conflitos de escala

Durante todo o período de louvor, uma pessoa só pode exercer uma função entre cantar, tocar e dançar, mesmo em músicas distintas. Fora desse período, uma oportunidade posterior pode permitir outra função se não houver outra incompatibilidade.

Transmissão e sonoplastia ocupam todo o intervalo definido do serviço, incluindo preparação/testes configurados, mesmo atravessando períodos. Atividades simultâneas não significam permissão para uma pessoa acumular funções incompatíveis.

Verificar conflitos ao montar ou substituir na escala e após mudanças de horário ou duração. Mostrar os compromissos, intervalos e lideranças envolvidos. Não trocar pessoas silenciosamente nem tratar uma alocação incompatível como válida. Ao tentar escalar alguém para cantar no louvor quando já está na dança, bloquear essa alocação e explicar o impedimento. Oferecer a seleção de outra pessoa e listar os habilitados para cantar sem conflito conhecido na escala. A lista não garante disponibilidade real nem aceite; o líder combina externamente. Se não houver candidatos, não criar uma alocação incompatível automaticamente.

A resolução de conflitos já existentes após mudança da programação e a forma de negociação entre equipes ainda precisam de detalhamento; o motor amplo de regras configuráveis fica para evolução futura.

## 6. Planejamento de duração

**Decidido:** o evento tem data e hora previstas de início e fim, com fim posterior ao início, inclusive quando atravessa a meia-noite. A duração disponível deriva desses horários. Ao montar a programação, mostrar **tempo ocupado, disponível e excedido**.

Somar a sequência principal, sem contar novamente atividades paralelas ou componentes do mesmo bloco. Se canto, instrumentos e dança ocupam juntos um bloco de louvor de 20 minutos, contam 20, não 60. Transmissão simultânea não acrescenta sua duração à sequência.

**Decidido em 02/10:** a política de duração é opcionalmente configurável entre **alertar** e **bloquear a publicação**. No modo de alerta, o líder pode ignorar o excesso, salvar e publicar sem aprovação ou justificativa. No modo de bloqueio, pode salvar e reorganizar rascunhos, mas precisa ajustar a sequência principal à janela prevista antes de publicar. Uma revisão com excesso também não pode ser publicada como válida nesse modo. A política não remove permissões nem regras de conflito de pessoas.

A preparação dos serviços de apoio pode começar antes da janela principal: por exemplo, preparar câmeras 30 minutos antes do culto. Esse tempo participa dos conflitos das pessoas, sem aumentar a soma principal. Não exigir que todos os itens de apoio fiquem dentro do início/fim previstos do culto.

O limite atua no planejamento. A execução pode terminar antes ou ultrapassar o previsto por imprevistos, sem bloqueio ou encerramento automático. **Pendentes:** padrão inicial da política, autoridade para alterar a política de um evento existente e apresentação das revisões em rascunho.

Duração de atividade não é prazo de resposta a convite. Prazos de convite pertencem somente ao documento de evolução futura.

## 7. Condução, contagem de tempo e interrupções

### 7.1 Tela e controle manual

Mostrar etapa anterior quando houver, etapa atual destacada e próxima etapa com responsável e duração prevista. O louvor pode ser acompanhado como um único bloco, sem música atual.

Somente o líder da liturgia do evento controla o andamento no MVP. Nenhum vencimento de tempo, checklist pendente, cancelamento ou retorno para pendente provoca avanço automático. Quando não houver atividade principal em execução, mostrar esse estado e manter a próxima prevista visível.

Apoios paralelos continuam independentes: avançar, cancelar ou interromper a sequência principal não encerra transmissão, sonoplastia ou outros serviços contínuos.

### 7.2 Cronômetro regressivo por atividade

**Requisito do MVP:** as atividades têm duração prevista. Iniciar uma atividade da sequência principal manualmente inicia seu cronômetro regressivo. Uma atividade de cinco minutos começa em 05:00.

A contagem representa o tempo desde o início registrado, compartilhado entre as telas. Atualizar a página ou entrar depois não reinicia a duração. Ao chegar a zero, manter a atividade em execução e mostrar **Tempo excedido**, contando o excesso até seu encerramento manual.

**O culto não possui cronômetro próprio.** Sua duração prevista continua sendo informação de planejamento, não um contador de execução. Um bloco simultâneo de louvor de vinte minutos possui uma contagem de vinte minutos; não há três contagens somadas por canto, instrumentos e dança.

Corrigir o horário real de início recalcula a contagem aplicável, preservando a alteração no histórico. A duração da atividade é contada desde seu início real, nunca consumida pelo atraso anterior à sua execução. Serviços paralelos não têm cronômetro nem acionamento individual de início/fim no MVP: acompanham os marcos do culto, conforme a seção 7.7.

### 7.3 Cancelar atividade iniciada

O líder da liturgia seleciona **Cancelar atividade**, escolhe obrigatoriamente um motivo previamente cadastrado na web e confirma. Exemplos de motivos: falha técnica, falta de energia ou acidente. A lista é configurável; não exige relato pessoal detalhado, justificativa livre nem cadastro de motivo na tela operacional.

O cancelamento encerra a contagem e identifica a atividade como cancelada, preservando início, fim real, duração realizada, eventual excesso, motivo, responsável pela atividade e autor do registro. Não retoma a etapa anterior e não inicia a próxima. Editar ou retirar uma atividade futura não altera a contagem da atividade atual.

Se o ocorrido não puder ser registrado por falha de conexão, o líder registra depois o horário em que a atividade realmente parou. Guardar também o horário de registro e seu autor, para não atribuir o período sem conexão à execução da atividade.

### 7.4 Devolver para pendente

O líder da liturgia pode devolver uma atividade iniciada para pendente, inclusive para corrigir avanço acidental. Essa ação interrompe a contagem atual e preserva a tentativa como execução interrompida.

**Não retomar automaticamente a contagem da atividade anterior.** A proposta inicial de restaurar automaticamente essa contagem foi substituída por esta regra.

Ao iniciar novamente a atividade devolvida, começar pela **duração prevista inteira**. Preservar o tempo da tentativa anterior: três minutos executados antes do retorno e cinco depois continuam sendo duas execuções registradas, totalizando oito minutos realizados, não cinco.

Não há limite de dois minutos no MVP. Essa possibilidade foi mencionada como proposta futura, não como regra aprovada. Devolver para pendente não é uma função de pausa com retomada do saldo.

### 7.5 Intervalos entre atividades

Registrar, sem cronômetro visível, os momentos em que a sequência principal fica sem atividade em execução:

- Começa após término normal, cancelamento ou retorno para pendente da atividade atual.
- Termina quando outra atividade é iniciada manualmente, inclusive a mesma atividade reiniciada.
- Se uma ação manual termina uma etapa e inicia outra no mesmo momento, o intervalo é zero.
- Não contar a espera anterior à primeira atividade.
- Não considerar serviços paralelos encerrados ou ociosos por causa desse intervalo.
- Usar os horários reais informados nas correções posteriores e recalcular os intervalos afetados, mantendo o histórico.

Chamar o dado de **intervalo entre atividades**. Não concluir automaticamente que houve desperdício, falha ou culpa. Os registros entram no MVP; relatórios e análises ficam para depois.

### 7.6 Encerrar culto

O líder da liturgia encerra o culto manualmente, mesmo se o horário previsto já tiver passado. Encerrar também qualquer intervalo aberto. Se ainda houver atividade em andamento, a ação deve explicitar seu encerramento e distinguir conclusão de cancelamento, respeitando a exigência de motivo quando houver cancelamento.

O término previsto não encerra automaticamente o culto. A marcação do fim não cria cronômetro do evento.

### 7.7 Serviços paralelos no MVP

**Decidido:** serviços paralelos como transmissão e sonoplastia começam, para fins de execução na aplicação, junto do início real do culto e terminam junto do encerramento real. Não possuem horários de início/fim próprios para operar nem controles ou contadores individuais. O tempo é derivado dos marcos do culto.

Avançar, cancelar ou devolver uma atividade principal para pendente não encerra esses serviços. Ao corrigir os marcos reais do culto, atualizar as referências derivadas dos apoios.

Essa simplificação da execução é distinta da preparação antes do culto, já prevista no planejamento e nos conflitos. **Pendente:** confirmar como a preparação configurada será representada em conjunto com o vínculo automático dos serviços ao culto, sem introduzir controle operacional individual.

### 7.8 Horário previsto, horário real e momento do registro

**Decidido:** o líder da liturgia do evento pode corrigir horários reais de início e fim. Recalcular duração realizada, contagem restante/excesso e intervalos afetados. Preservar previsão original, valores anteriores, momento da correção e autor. Corrigir uma marcação de execução não muda silenciosamente o planejamento.

Distinguir três informações:

| Informação | Significado |
| --- | --- |
| Horário previsto | O que foi planejado para acontecer. |
| Horário real | Quando a atividade efetivamente começou ou terminou, inclusive quando informado depois. |
| Momento do registro | Quando a ação foi registrada na aplicação. |

**Exemplo de atraso real:** culto previsto para 19h, com abertura realmente iniciada às 19h15. Guardar previsão de 19h e início real de 19h15. Se a abertura dura cinco minutos, começa com 05:00 a partir das 19h15 e tem referência de término às 19h20. Os quinze minutos anteriores são atraso de início, não excesso da abertura nem intervalo entre atividades.

**Exemplo de registro tardio:** abertura começou às 19h15, mas foi acionada no aplicativo às 19h18. A liturgia corrige o início para 19h15; nessa situação, uma duração prevista de cinco minutos deixa dois minutos restantes às 19h18. O momento do registro/correção permanece preservado.

**Exemplo de parada sem conexão:** atividade parou às 19h20 e foi registrada às 19h25. Usar 19h20 para duração real e intervalos, mantendo 19h25 como momento do registro.

Não aceitar fim anterior ao início ou duração negativa; explicar os horários incompatíveis e solicitar sua correção. Horários e autoria não são prova de culpa de quem era responsável pela atividade.

## 8. Ausência, substituição e retirada de atividade

O líder combina a substituição fora do aplicativo e registra a pessoa apta na responsabilidade existente, respeitando permissões e conflitos. **Não exigir aceite eletrônico do substituto.** A mudança não é prova de presença física.

Antes de a atividade começar, o líder da própria equipe pode realocar seus integrantes. Durante sua execução, apenas o líder da liturgia pode registrar a substituição. Para serviços paralelos, essa restrição passa a valer com o início real do culto, pois acompanham seus marcos sem acionamento individual.

Mudanças pertinentes aparecem para os usuários autorizados e geram avisos dentro da aplicação. Preservar o histórico. Não há chamado automatizado, reserva provisória ou exigência de check-in.

Ao retirar uma atividade futura da programação, oferecer substituir por outra ou retirar sem substituição, recalculando a previsão do término. Não garantir que o culto terminará antes: etapas posteriores podem exceder suas durações. Retirar atividade futura não é cancelar a execução atual.

**Pendente:** detalhar o fluxo por canal de substituição por outra atividade, sem transformar o mobile em cadastro de atividades novas. A exclusão/desativação de membros, funções ou equipes vinculados a eventos é uma questão diferente; a proposta de desativar preservando histórico ainda requer confirmação.

## 9. Oportunidades, músicas e sonoplastia

O líder cadastra a oportunidade e preenche seus detalhes na web. O membro apenas consulta.

### 9.1 Ficha simples de música

Informações para louvor, oportunidade e dança:

- Nome da música.
- Cantor/intérprete de referência, sem confundir com compositor.
- Tom escolhido, independente do tom do vídeo; opcional para dança.
- URL do YouTube com miniatura.
- Observação curta.

Se a miniatura não estiver disponível, nome e link continuam utilizáveis. Não há player embutido, upload de arquivos, biblioteca, letras ou cifras. O link é uma referência; não pressupõe integração além disso. Teatro não está incluído neste exemplo de ficha musical.

### 9.2 Apoio da sonoplastia

A oportunidade que precisa de playback gera aviso para **toda a equipe de sonoplastia**, sem confirmação exigida, para o apoio no horário pertinente.

Quem canta providencia arquivo, tom e versão fora do sistema. O aplicativo não controla a entrega. A liderança pode retirar a oportunidade ainda não iniciada conforme sua responsabilidade; durante a execução, o cancelamento é exclusivo do líder da liturgia e exige motivo cadastrado. A realocação gera os avisos pertinentes dentro da aplicação.

A orientação operacional de providenciar material 30 minutos antes do culto não se converte em cancelamento automático: o sistema não sabe se houve entrega.

### 9.3 Checklist simples de preparação

**Decidido para o MVP:** representar necessidades de preparação por um checklist de itens definidos pelas lideranças no planejamento do culto. Exemplo: playback preparado.

A atividade entra na programação mesmo com itens pendentes e aparece para as lideranças como **Preparação pendente**. Quando se torna a próxima da sequência, destacar essa pendência para a liturgia. O líder da liturgia pode mantê-la, substituí-la ou cancelá-la manualmente conforme seu estado.

Não bloquear inclusão ou início por checklist incompleto, não substituir pessoas automaticamente e não usar gatilho de “50% do tempo”. Uma pendência de preparação não é necessariamente uma falha da pessoa escalada.

Checklist não concede acesso e não constitui um motor automático de dependências entre equipes. Não exigir aceite dos membros.

**Decidido:** checklist é operado pelas lideranças de liturgia e de atividade, não por membros comuns. O líder de atividade marca somente o checklist sob sua responsabilidade. Haverá itens simples e itens que exigem validação de duas lideranças; no item conjunto, uma única confirmação não conclui a preparação.

Exemplo: entrega e verificação da música do louvor ou dança pela sonoplastia. A proposta de detalhamento é registrar separadamente quem confirma a entrega e quem confirma o recebimento/verificação.

**Proposto, a confirmar:** a liturgia acompanha todos os itens, mas não confirma em nome dos dois líderes exigidos; pode seguir com a atividade pendente, conforme a regra geral já aprovada. **Pendentes:** indicação dos dois validadores, significado de cada confirmação, desmarcação/correções, alcance da marcação pela liturgia e operação por canal. Não tratar essa proposta de detalhe como aprovada.

## 10. Consulta, avisos, conexão e histórico

### 10.1 Cronograma, escala e bastidores

**Decisão final:** usar a separação natural entre cronograma, escala e bastidores. Não há configuração de atividade pública/privada ou de visibilidade seletiva.

| Informação | Quem consulta |
| --- | --- |
| Cronograma macro | Todos com acesso autorizado à igreja, mesmo sem função cadastrada ou sem estar escalado: títulos das etapas, ordem, durações previstas, atual, próxima e cronômetro da atividade em execução. |
| Detalhes da própria escala | A pessoa escalada consulta função, horário, música, tom e orientações pertinentes à sua participação. Aptidão cadastrada, sozinha, não libera detalhes de outras escalas. |
| Bastidores | Líderes das equipes/atividades consultam preparação e gestão sob sua responsabilidade; o líder da liturgia consulta os bastidores de todo o evento. Inclui checklist, ausências, substituições, motivos de cancelamento e histórico pertinente. |

“Todos” não significa acesso aberto na internet. As permissões administrativas de manutenção continuam restritas ao respectivo papel. Detalhar dados pessoais mínimos, acesso administrativo ao histórico e revogação, sem expor cadastro completo ou detalhes pessoais desnecessários no cronograma.

Membros apenas consultam; ver não concede edição. A interface mobile prioriza imagens, ícones, cartões e miniaturas, com pouco texto. Rótulos curtos explicam ações e estados, sem depender apenas de cores.

### 10.2 Avisos internos

**Notificações somente dentro da aplicação no MVP.** Avisar alterações pertinentes de programação, ausência e substituição, respeitando destinatários e nível de acesso. O aviso operacional para sonoplastia alcança toda a equipe e não exige confirmação.

Não incluir compartilhamento com WhatsApp, e-mail, Instagram ou outros aplicativos nesta versão, nem prometer envio externo automático. O compartilhamento é evolução futura. Combinados externos entre pessoas continuam ocorrendo por conta delas.

### 10.3 Conexão e informação desatualizada

O piloto pressupõe internet. Ao perder conexão ou deixar de conseguir atualizar os dados, a tela fica **somente para consulta da última informação disponível**. Conteúdo continua legível; controles indisponíveis podem ficar opacos. Mostrar ícone, mensagem textual e horário da última atualização.

O cronômetro local pode continuar como referência baseada no último início recebido, explicitamente desatualizada: outra pessoa/aparelho pode ter alterado o estado. Não permitir edição offline ou tratá-la como execução confirmada e atual.

Quando a atualização voltar, buscar primeiro o estado atual. Se necessário, o líder da liturgia corrige horários reais de início/fim/cancelamento, preservando horário do registro, autor e valores anteriores. Não presumir que toda falha de um aparelho interrompeu o culto.

Se uma ação de início foi enviada, mas sua confirmação não chegou, mostrar que o resultado ainda não está confirmado. Ao recuperar a conexão, consultar o estado salvo antes de tentar novamente, sem criar segunda execução por engano. Tela antiga em outro aparelho deve se atualizar e informar mudança de estado antes de uma ação incompatível.

**Pendente técnico/funcional:** critério de detecção de desatualização, primeira carga sem dados e implementação da recuperação de resposta perdida, preservando o comportamento acima e sem inventar fila de edição offline.

### 10.4 Ações repetidas e telas simultâneas

Mesmo com um único líder da liturgia, toque duplo, demora ou dois aparelhos não podem avançar duas etapas nem aplicar a mesma ação duas vezes. Uma tela desatualizada não deve sobrescrever silenciosamente um estado mais recente.

Indicar processamento da ação e atualizar o estado antes de aceitar operações incompatíveis. Essa proteção é requisito de confiabilidade do MVP, não delegação do controle a outros líderes; a implementação será definida na arquitetura.

### 10.5 Histórico por um ano

**Decidido:** manter histórico de cadastros, alterações e ações de usuários por **um ano**, substituindo a proposta de três meses. Registrar autor, momento, ação e, nas alterações, valores anteriores e novos pertinentes.

Para execução, preservar duração prevista, início/fim reais, tempo realizado, excesso, execuções interrompidas, cancelamentos/motivos, intervalos e respectivas correções. Distinguir responsável pela atividade de quem registrou/corrigiu a ação. Esses registros não são prova automática de culpa ou presença.

Correção não apaga a tentativa anterior. Detalhes da retenção e expiração dos registros, proteção de dados pessoais e escopo de eventos de acesso/login ainda precisam ser definidos. Retenção do histórico não significa apagar automaticamente cadastros ou eventos após um ano.

Cópias de segurança e restauração são assunto separado, a definir na arquitetura. Não há garantia de volume em GB nem conclusão sobre custos nesta etapa. Não exigir justificativa para ignorar alerta de duração.

## 11. Escopo e exclusões

**No MVP:** acesso por convite com Google/Apple; modelo de culto simples; cadastros e planejamento web; aptidões/permissões; escala nominal por líderes; conflitos com sugestões de candidatos habilitados; início/fim previstos e política de duração com alerta ou bloqueio opcional da publicação, preservando rascunhos; cronograma macro, detalhes da própria escala e bastidores; checklist simples; controle manual exclusivo do líder da liturgia por evento; cronômetro regressivo por atividade com excesso; cancelamento por motivo cadastrado; retorno para pendente com reinício integral; registro de intervalos; encerramento manual do culto; ausência/substituição manual; ficha musical simples com observação; avisos internos; histórico de um ano; consulta desatualizada e correção posterior; proteção contra ações duplicadas.

**Fora do MVP:** participação aberta; disponibilidade autodeclarada; convites de participação, prazos, reservas e confirmação/recusa; pedidos de mudança; chamados automatizados; check-in; compartilhamento externo; dashboards; delegação do andamento aos líderes de atividades; operação completa de retiros/turnos; motor amplo de regras/dependências; edição offline.

Também não estão incluídos chat geral, incidentes amplos sem relação com escala/ausência, módulos de cursos online, simpósios pagos ou gestão financeira, letras/cifras/repertório avançado, upload/player ou geração automática de escala inteira. A possibilidade de modularização está registrada em evolução futura. Dízimos e ofertas são atividades da programação.

## 12. Cenários de aceite do MVP

Critérios de comportamento esperado, não testes de software já executados. Os cenários específicos do aplicativo Android/iOS, como M12, M34 e M38, pertencem à etapa posterior e não bloqueiam a validação do protótipo web. Os identificadores desta consolidação substituem a lista anterior.

| ID | Situação | Resultado esperado |
| --- | --- | --- |
| M01 | Pessoa faz login Google/Apple sem convite vinculado à igreja. | Login não libera dados da igreja ou escolha autônoma de permissões. |
| M02 | Pessoa autorizada não tem função cadastrada nem está escalada. | Consulta o cronograma macro, sem bastidores ou detalhes de outras escalas. |
| M03 | Pessoa escalada consulta sua participação. | Vê função, horário e música/tom/orientações pertinentes, sem poder editar. |
| M04 | Líder de equipe consulta bastidores. | Vê o âmbito sob sua responsabilidade; a liturgia vê todo o evento, conforme papéis. |
| M05 | Líder da liturgia de domingo não é o de quarta. | Cada evento aplica sua própria designação; controlar um não concede controle do outro. |
| M06 | Líder de equipe ou administrador que não é a liturgia tenta iniciar/avançar/devolver a atual para pendente. | Ação não permitida. |
| M07 | Atividade de cinco minutos é iniciada. | Contagem começa em 05:00; outra tela usa o mesmo início e atualizar a página não reinicia. |
| M08 | Tempo previsto chega a zero. | Exibe tempo excedido, mantém etapa atual e não inicia outra. Não existe cronômetro do culto. |
| M09 | Liturgia devolve atividade atual para pendente. | Contagem para, tentativa fica interrompida, abre intervalo; anterior não retoma e próxima não inicia. |
| M10 | Atividade pendente é iniciada novamente. | Começa com duração prevista inteira, preservando o tempo da tentativa anterior. |
| M11 | Liturgia cancela atividade em execução. | Escolhe motivo cadastrado; encerra contagem e preserva tempos/motivo/autoria, sem iniciar outra. |
| M12 | Tenta cadastrar motivo durante cancelamento mobile. | Cadastro administrativo não está disponível; motivos são previamente mantidos na web. |
| M13 | Atividade termina e nenhuma outra inicia. | Registra intervalo sem contador visível; encerra quando uma atividade inicia. Antes da primeira não há intervalo. |
| M14 | Uma ação manual conclui a atual e inicia a próxima no mesmo instante. | Intervalo é zero, sem avanço duplicado. |
| M15 | Culto é encerrado pela liturgia. | Fecha intervalo aberto; explicita conclusão/cancelamento da atividade ainda em execução. Horário previsto não encerra sozinho. |
| M16 | Falta de energia/internet impede registrar parada às 19h30; conexão retorna às 19h35. | Consulta apenas durante falha; depois permite registrar parada real e guarda também momento/autor do registro, recalculando tempos. |
| M17 | Internet aparenta funcionar, mas dados não atualizam. | Indica informação desatualizada e última atualização; bloqueia alterações como na perda de conexão. |
| M18 | Conexão retorna após mudança feita em outro aparelho. | Busca estado atual antes de permitir correções; não sobrescreve silenciosamente. |
| M19 | Toque repetido ou dois aparelhos tentam a mesma transição. | Não executa avanço duplo; estado mais recente é respeitado. |
| M20 | Líder realoca pessoa da própria equipe antes do início. | Pode registrar substituto apto sem conflito, após combinado externo e sem aceite eletrônico. |
| M21 | Equipe tenta substituir durante sua atividade em execução. | Apenas liturgia registra a substituição; vale também para serviço paralelo já iniciado. |
| M22 | Tentam escalar para cantar alguém já escalado na dança do mesmo louvor. | Bloqueia e explica; oferece habilitados para cantar sem conflito, sem afirmar disponibilidade real ou aceite. |
| M23 | Mesma pessoa participa em oportunidade posterior sem incompatibilidade. | Alocação permitida; exclusividade do louvor não ocupa automaticamente todo o culto. |
| M24 | Transmissão/sonoplastia inclui preparação e atravessa etapas. | Intervalo completo participa dos conflitos; avanço/interrupção principal não encerra o serviço. |
| M25 | Canto, instrumentos e dança compartilham bloco de 20 minutos com transmissão paralela. | Planejamento soma 20 minutos pelo bloco, sem duplicar componentes/apoios. |
| M26 | Duração planejada ultrapassa a previsão do culto no modo de alerta. | Alerta ignorável, sem bloquear salvar/publicar ou exigir justificativa/aprovação. |
| M27 | Mudança de horário cria conflito em escala existente. | Sinaliza compromissos/lideranças; não troca pessoas nem resolve sozinho. |
| M28 | Modelo inclui transmissão por padrão. | Inclui atividade sem escalar pessoas automaticamente; edição pode ser ajustada para culto sem transmissão. |
| M29 | Atividade tem checklist pendente e torna-se a próxima. | Mantém na programação, destaca preparação pendente para liturgia, sem bloqueio, troca automática ou gatilho de 50%. |
| M30 | Miniatura musical não carrega. | Nome/link continuam; tom escolhido é independente do vídeo; observação curta disponível. |
| M31 | Oportunidade requer playback. | Avisa toda a sonoplastia dentro da aplicação, sem aceite exigido; entrega de material é externa. |
| M32 | Material não foi entregue. | Não cancela automaticamente; retirada/cancelamento segue estado, permissão e motivo quando iniciado. |
| M33 | Retiram atividade futura sem substituí-la. | Recalcula previsão, não garante término antecipado e não altera contador atual. |
| M34 | Administrador usa mobile. | Sem cadastro administrativo, motivos novos ou criação de evento/escala inicial. |
| M35 | Membro tenta habilitar aptidão ou líder habilita fora da sua equipe. | Operação impedida. |
| M36 | Alteração/correção é registrada. | Histórico guarda autor, momento, valores pertinentes e execuções anteriores; retenção de um ano. |
| M37 | Usuário quer compartilhar aviso externo. | MVP contém apenas notificações internas, sem recurso de compartilhamento externo. |
| M38 | Estado aparece no mobile. | Texto/ícone explicam além da cor; conteúdo de consulta permanece legível mesmo desatualizado. |
| M39 | Líder de atividade recebe permissão admin sem ser líder da liturgia. | Pode exercer administração e liderança da atividade, sem ganhar controle do culto. |
| M40 | Usuário sem admin tenta convidar ou designar/trocar liderança. | Operação impedida; ser líder da liturgia ou de atividade não basta. |
| M41 | Abertura prevista às 19h começa realmente às 19h15 e dura cinco minutos. | Preserva previsão; contagem usa 19h15–19h20. Espera inicial não vira excesso nem intervalo entre atividades. |
| M42 | Abertura começou às 19h15, mas foi registrada às 19h18. | Liturgia pode corrigir para 19h15; duração de cinco minutos deixa dois restantes às 19h18, com valores anteriores/autoria preservados. |
| M43 | Correção informa fim anterior ao início. | Não aceita duração negativa; explica inconsistência e pede correção. |
| M44 | Início foi enviado, mas a confirmação se perdeu. | Mostra resultado não confirmado e consulta estado salvo ao recuperar; não cria nova execução por repetição. |
| M45 | Culto inicia, atravessa intervalos e depois encerra. | Serviços paralelos acompanham início/fim reais do culto, sem botões, horários operacionais ou contadores próprios. |
| M46 | Item de checklist exige dois líderes e somente um confirmou. | Permanece pendente; não bloqueia a atividade. Membro comum ou líder de outra atividade não marca fora de sua responsabilidade. |
| M47 | Membro consulta uma igreja autorizada. | Horários usam o fuso da igreja consultada, sem preferência individual de alteração. |
| M48 | Cadastro de evento informa início e fim previstos. | Calcula duração disponível; aceita cruzar meia-noite com datas completas e rejeita fim anterior ou igual ao início. |
| M49 | Programação excede a janela do evento no modo de bloqueio. | Permite salvar rascunho, mas rejeita publicar a programação ou revisão até ajustar; não encerra nem bloqueia automaticamente a execução real. |
| M50 | Equipe prepara câmeras 30 minutos antes do culto. | Permite a preparação anterior e considera seu intervalo nos conflitos, sem incluí-lo na soma dos blocos principais. |

## 13. Avaliação do piloto

Critério principal: conseguir conduzir o culto, resolver ausências e manter participantes informados sem perguntar continuamente quem vem depois.

Observar conflitos antecipados, responsabilidades específicas ainda descobertas, tempo para registrar/resolver substituições, clareza de atual/próximo e dificuldades de uso. Não há metas numéricas aprovadas. Taxa de resposta a convite não é métrica ativa do MVP.

Recolher feedback após 2–3 meses de uso do piloto é a orientação acordada, não compromisso de data de lançamento. Coordenação externa continuará existindo; não medir sucesso como eliminação obrigatória do WhatsApp. Dashboards e cuidados para interpretação dos dados estão em evolução futura.

## 14. Pendências remanescentes

As regras já fechadas não dependem de rediscussão para serem documentadas. Os pontos abaixo permanecem abertos para as etapas que dependem deles.

| Tema | O que falta fechar |
| --- | --- |
| Convite de acesso | Emissão é exclusiva de admin. Detalhar revogação, associação segura ao membro existente, convite enviado à pessoa errada, validade e contas Google/Apple da mesma pessoa. |
| Liderança por evento | Designação/troca é exclusiva de admin. Detalhar a transferência durante evento iniciado, sem dois controles concorrentes. |
| Checklist | Lideranças operam e cada líder de atividade marca apenas seu âmbito; itens conjuntos exigem duas validações. Detalhar validadores, alcance da liturgia, desmarcação, correções e canal; não reintroduzir bloqueio. |
| Cadastros vinculados | Confirmar desativação em vez de exclusão para membros/funções/equipes já utilizados, preservando referências. Retirar atividade da programação já tem regra própria. |
| Mudanças e conflitos | Resolução quando alteração cria conflito já existente, comunicação/negociação entre líderes e cálculo da programação restante após correções de horários. |
| Política de duração e publicação | Definir padrão inicial, autoridade para alterar política de evento existente e consulta/edição das revisões em rascunho. Alerta ou bloqueio opcional da publicação, rascunhos permitidos e execução sem encerramento automático já estão decididos. |
| Serviços paralelos | Início/fim acompanham o culto, sem controle individual. Confirmar representação da preparação prévia planejada nos conflitos, sem cronometrá-la ou criar turnos. |
| Edição em execução | Fluxo de substituição por outra atividade e reordenação por canal, respeitando ausência de cadastros novos no mobile. |
| Conexão e correções | Detecção de desatualização, primeira carga sem dados e detalhamento da recuperação de resposta perdida. Correção pela liturgia com histórico, recálculo e rejeição de horários impossíveis já está decidida; detalhar casos de sobreposição entre registros corrigidos. |
| Histórico e privacidade | Detalhes dos registros de acesso/login, campos mínimos, política de expiração de um ano e acesso administrativo aos dados, sem apagar cadastro/evento por inferência. |
| Segurança operacional | Plano de cópia/restauração e verificação das permissões de igreja/evento; resolver na arquitetura antes da implementação dependente. |
| Mobile e arquitetura | Tecnologia ainda não escolhida. Flutter é apenas candidato sugerido; avaliar arquitetura, segurança e desenho após regras. |

**Retiradas ou substituições de escopo em 30/09:** participação aberta sai do MVP; visibilidade seletiva por atividade foi descartada, sem backlog de público/privado; o responsável separado pelo andamento foi substituído pelo líder da liturgia de cada evento; notificações externas/compartilhamento ficam futuros; retenção anterior de três meses passa a um ano; retorno não retoma cronômetro anterior.

## 15. Governança e sequência de trabalho

O responsável pelo projeto não programa e quer apoio de IA com crítica fundamentada. Apontar conflitos de requisitos, permissões, segurança, confiabilidade, arquitetura e design; não tratar resposta ambígua como decisão nem transformar sugestão em escopo.

Validar regras primeiro, depois arquitetura, depois desenho da aplicação e só então implementação incremental verificável. Resolver pendências antes de implementar as partes dependentes, sem criar aprovações para rotinas desnecessárias.

Este PRD preserva os requisitos de produto. O desenho técnico está no [documento de arquitetura do banco e das permissões](ARQUITETURA-BANCO.md), com decisões confirmadas, propostas e pendências identificadas. A existência desses documentos não comprova implementação, implantação ou automação de retomada.
