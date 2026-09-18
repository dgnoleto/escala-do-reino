# PRD — Escala do Reino

**Organize os eventos e as equipes da sua igreja.**

**Piloto:** Ministério Shalom.

**Consolidação:** 18 de setembro de 2026.

**Situação:** documentação; sem código, arquitetura ou tecnologias escolhidas.

## 1. Recorte e precedência

O MVP é a primeira versão utilizável, focada no **culto**. Deve ajudar a responder: quem está agora, quem é o próximo e quem entra quando alguém falta.

**Decisão final de escopo:** líderes organizam e atualizam; membros apenas consultam. O líder registra ausências e substituições após combinar com as pessoas fora do aplicativo. **Não há exigência de aceite eletrônico do substituto no MVP.**

Esse recorte substitui o desenho anterior que exigia convites, reservas provisórias, prazos e confirmações pelos membros. Essas regras estão preservadas em [Evolução futura](EVOLUCAO-FUTURA.md), fora dos requisitos ativos desta versão. A possibilidade anteriormente discutida de o membro enviar link ou tom também não vale no MVP: os líderes preenchem, os membros consultam.

Neste documento, **decidido** identifica requisitos confirmados; **proposto** não equivale a aprovado; **pendente** indica detalhamento ainda necessário. Os comportamentos descritos não estão implementados.

## 2. Problema e resultado esperado

As lideranças organizam equipes separadamente, por WhatsApp ou pessoalmente. Membros de várias equipes podem receber funções incompatíveis, e faltas exigem coordenação sem uma visão comum. Durante o culto, as pessoas precisam saber quem está atuando e quem vem depois.

O piloto deve permitir conduzir o culto, resolver ausências e manter os participantes informados sem perguntar continuamente quem é o próximo. A coordenação e o aceite de substituições continuam externos; não se promete eliminar WhatsApp.

## 3. Responsabilidades e permissões

Há um cadastro único de cada membro por igreja. Uma pessoa pode integrar várias equipes e ter várias funções habilitadas. A liderança habilita a aptidão; o membro não se habilita.

| Papel | Responsabilidade |
| --- | --- |
| Administrador | Administra a igreja e seus cadastros na web. A condição de administrador não libera cadastros no mobile nem substitui a designação de responsável pelo andamento. |
| Líder de liturgia | Define a sequência principal: abertura e responsável, bloco de louvor e liderança, danças/oportunidades, dízimos/ofertas e pregação. Não escala integrantes das equipes dos outros líderes. |
| Líder de equipe | Preenche a escala de sua equipe: cantores, instrumentistas, dançarinos, transmissão, sonoplastia e demais funções pertinentes. Habilita aptidões apenas no seu âmbito; registra ausências e substituições sob sua responsabilidade. |
| Responsável pelo andamento do evento | Usuário específico designado para o evento, sem necessidade de ser administrador global. Somente ele inicia e avança manualmente as etapas principais. |
| Membro | Apenas consulta programação, escala e andamento. Não edita oportunidades, músicas, tom, links ou cadastros, nem envia aceite, recusa ou pedido de alteração no MVP. |

Ver o cronograma não concede permissão para editá-lo. Líderes e administradores que não forem o responsável designado também não iniciam nem avançam a sequência principal. O procedimento de designação e eventual troca desse responsável ainda precisa ser detalhado.

## 4. Web e mobile

| Ação | Web | Mobile |
| --- | --- | --- |
| Cadastrar, editar, renomear e excluir tipos, modelos, atividades, durações padrão, membros, funções e ministérios/equipes | Administração conforme permissões | Não, inclusive para administrador |
| Habilitar aptidões e alterar configurações | Liderança/administração no âmbito autorizado | Não |
| Criar evento e planejar programação e escala inicial | Lideranças conforme responsabilidade | Não |
| Cadastrar oportunidades e preencher detalhes/músicas | Líder autorizado | Não como cadastro de planejamento |
| Consultar programação, escala e andamento | Conforme acesso | Membros e lideranças |
| Registrar ausência e substituir em escala existente | Liderança autorizada | Liderança autorizada |
| Iniciar/avançar etapa principal | Somente responsável designado | Somente responsável designado |

O mobile é uma extensão de consulta e execução, não um painel de administração. As mudanças operacionais devem refletir nos mesmos dados consultados na web, e o planejamento web deve refletir no mobile.

## 5. Modelo de culto, atividades e escalas

O piloto utiliza um modelo de culto simples. A web administra tipos e modelos, sem exigir um motor genérico de regras ou operação completa de retiros.

- **Tipo:** categoria do evento.
- **Modelo:** estrutura reutilizável de planejamento.
- **Evento:** edição concreta com data e programação próprias.

Uma atividade pode abranger **o evento inteiro ou apenas parte dele**. Isso é independente de ser incluída por padrão no modelo. O modelo Culto pode incluir portaria, sonoplastia e transmissão automaticamente, mas não escala nem confirma pessoas: cada líder preenche sua equipe depois.

É possível ajustar a edição específica, por exemplo realizar um culto sem transmissão. A preparação antes do início conta no intervalo de ocupação e nos conflitos quando estiver configurada. Durações padrão são configuráveis; exemplos de 5, 15 ou 20 minutos não são valores universais.

### 5.1 Participação aberta e específica

| Forma | Regra no MVP |
| --- | --- |
| Aberta | Abrange todos os membros aptos da equipe convidados a participar, sem fluxo eletrônico de aceitar/recusar, reserva individual, vaga obrigatória para cada integrante ou substituição obrigatória por cada ausência. |
| Específica | Os líderes definem nominalmente quem exercerá cada responsabilidade. A indicação é registrada na escala, sem confirmação eletrônica individual. |

Na participação aberta, “convidados” descreve o público chamado a participar, não uma funcionalidade de convites automatizados. Essa forma não garante presença nem elimina conflito de alguém que já exerce função incompatível. A apresentação exata dessa incompatibilidade em uma atividade aberta ainda precisa ser detalhada; não se deve transformar todos os integrantes em presenças confirmadas.

### 5.2 Conflitos de escala

Durante todo o período de louvor, uma pessoa só pode exercer uma função entre cantar, tocar e dançar, mesmo em músicas distintas. Fora desse período, uma oportunidade posterior pode permitir outra função se não houver outra incompatibilidade.

Transmissão e sonoplastia ocupam todo o intervalo definido do serviço, incluindo preparação/testes configurados, mesmo atravessando períodos. Atividades simultâneas não significam permissão para uma pessoa acumular funções incompatíveis.

Verificar conflitos ao montar ou substituir na escala e após mudanças de horário ou duração. Mostrar os compromissos, intervalos e lideranças envolvidos. Não trocar pessoas silenciosamente nem tratar uma alocação incompatível como válida. O tratamento de conflitos já existentes e a forma de negociação entre equipes precisam de detalhamento; o motor amplo de regras configuráveis fica para evolução futura.

## 6. Planejamento de duração

O evento tem uma duração prevista. Ao montar a programação, mostrar **tempo ocupado, disponível e excedido**.

Somar a sequência principal, sem contar novamente atividades paralelas ou componentes do mesmo bloco. Se canto, instrumentos e dança ocupam juntos um bloco de louvor de 20 minutos, contam 20, não 60. Transmissão simultânea não acrescenta sua duração à sequência.

**Decidido:** excesso de duração gera apenas alerta que o líder pode ignorar. Não bloqueia salvar ou publicar, não exige aprovação e não exige justificativa. Esse alerta não remove as permissões nem as regras de conflito de pessoas.

Duração de atividade não é prazo de resposta a convite. Prazos de convite pertencem somente ao documento de evolução futura.

## 7. Condução do culto

A tela deve mostrar de forma simples:

- Etapa anterior, quando houver.
- Etapa atual destacada.
- Próxima etapa, com responsável e tempo previsto.

Somente o responsável designado inicia e avança manualmente a etapa principal. O vencimento do tempo previsto nunca avança sozinho: mostrar o tempo excedido e aguardar a ação humana. A execução real pode ultrapassar o previsto.

O louvor pode aparecer apenas como bloco, sem identificar música atual. Apoios paralelos aparecem relacionados à programação; avançar a sequência principal não encerra automaticamente transmissão, sonoplastia ou outro serviço contínuo.

**Pendentes:** como corrigir avanço acidental, como registrar/corrigir marcações de tempo e como lidar com troca do responsável durante o evento. Não inventar avanço automático, desfazer ou aprovação enquanto esses fluxos não forem validados.

## 8. Ausência e substituição manual

1. O líder identifica e registra a ausência de uma pessoa escalada em sua equipe.
2. Combina com um substituto fora do aplicativo.
3. Registra a substituição na responsabilidade existente, respeitando aptidão, permissões e conflitos.
4. A escala compartilhada passa a mostrar a mudança; o histórico registra o ocorrido e as pessoas pertinentes são avisadas.

O substituto **não precisa aceitar pelo aplicativo**. A mudança registrada não é prova de presença física. Também não existe, no MVP, chamado automático individual/coletivo ou reserva provisória.

Se Alberto passa mal na portaria durante o culto, a liderança pode combinar com uma pessoa apta e atualizar a escala naquele momento. Na participação aberta, a ausência de um integrante não cria automaticamente uma vaga para substituição.

## 9. Oportunidades, músicas e sonoplastia

O líder cadastra a oportunidade e preenche seus detalhes na web. O membro apenas consulta.

### 9.1 Ficha simples de música

Informações para louvor, oportunidade e dança:

- Nome da música.
- Cantor/intérprete de referência, sem confundir com compositor.
- Tom escolhido, independente do tom do vídeo; opcional para dança.
- URL do YouTube com miniatura.
- **Proposta:** observação curta, ainda a validar.

Se a miniatura não estiver disponível, nome e link continuam utilizáveis. Não há player embutido, upload de arquivos, biblioteca, letras ou cifras. O link é uma referência; não pressupõe integração além disso. Teatro não está incluído neste exemplo de ficha musical.

### 9.2 Apoio da sonoplastia

A oportunidade que precisa de playback gera aviso para **toda a equipe de sonoplastia**, sem confirmação exigida, para o apoio no horário pertinente.

Quem canta providencia arquivo, tom e versão fora do sistema. O aplicativo não controla a entrega. O líder pode cancelar manualmente a oportunidade sem material e realocar a programação, avisando os envolvidos.

A orientação operacional de providenciar material 30 minutos antes do culto não se converte em cancelamento automático: o sistema não sabe se houve entrega.

### 9.3 Dependências entre equipes

A visão desejada é de relações configuráveis, não uma regra fixa embutida apenas para determinados ministérios. Exemplo: música e instrumentos organizados liberam repertório/escala para a dança; a dança pode preparar rascunho antes e finalizar depois.

Confirmar a organização de uma equipe não significa colher aceite de um membro. **O motor amplo de dependências está fora do MVP.** O mínimo de informação ou estado a compartilhar entre equipes no piloto ainda está pendente; não se promete liberação automática complexa.

## 10. Consulta, avisos e confiabilidade

Os participantes do culto consultam um cronograma compartilhado. Visibilidade seletiva por equipe ou usuário fica para evolução futura.

O mobile deve priorizar imagens/fotos, ícones, cartões e miniaturas, com pouco texto. Ações precisam de rótulos curtos e os estados não podem depender apenas de cor.

Avisar alterações pertinentes de programação, ausência e substituição, respeitando os destinatários envolvidos. O aviso da sonoplastia alcança toda a equipe. Canal e entrega de notificações continuam pendentes; não pressupor push, e-mail ou integração WhatsApp.

**Internet é pressuposto do piloto.** Indicar conexão e informação desatualizada é requisito. O comportamento exato durante falha de conexão, tentativas de atualização e retorno da conexão ainda precisa de definição; não prometer edição offline ou sincronização automática já resolvida.

Manter histórico básico das mudanças para entender o que ocorreu e apoiar futuros indicadores. O histórico deve permitir identificar a alteração, seu momento e o responsável pelo registro; os campos e a política de correção/retenção precisam ser definidos antes de implementar essa parte. Não exigir justificativa para ignorar alerta de duração.

## 11. Escopo e exclusões

**No MVP:** modelo de culto simples; cadastros e planejamento web; aptidões e permissões; participação aberta/específica; escala por líderes; conflitos; previsão de duração com alerta ignorável; consulta compartilhada; andamento principal manual por responsável designado; ausência e substituição manual; ficha musical simples; avisos pertinentes; histórico básico; indicação de conexão/informação desatualizada.

**Fora do MVP, preservado em evolução futura:** disponibilidade autodeclarada, convites, prazos, reservas provisórias, confirmação/recusa pelo membro, pedidos de mudança, chamados automatizados, check-in, visibilidade seletiva, dashboards, operação completa de retiros e turnos, motor amplo de regras/dependências e offline.

Também não estão incluídos chat geral, comunicação ampla de incidentes sem relação com escala/ausência, gestão financeira, letras/cifras/repertório avançado, upload/player e geração automática da escala inteira. Dízimos e ofertas são somente atividades da programação.

## 12. Cenários de aceite do MVP

São critérios para implementação futura, não testes já executados. Não substituem as decisões pendentes.

| ID | Situação | Resultado esperado |
| --- | --- | --- |
| M01 | Membro consulta oportunidade e música. | Vê os dados, mas não edita nome, tom, link ou programação. |
| M02 | Líder combina substituição de pessoa ausente fora do app. | Registra o substituto apto sem aceite eletrônico, respeitando conflitos e permissões; mudança aparece na escala e no histórico. |
| M03 | Membro participa de várias equipes e já está como dançarino no louvor. | Não é tratado como alocação válida cantar ou tocar nesse mesmo período, mesmo em outra música. |
| M04 | A mesma pessoa recebe responsabilidade numa oportunidade depois do louvor. | Pode ser escalada se não houver outra incompatibilidade. |
| M05 | Transmissão inclui preparação e atravessa blocos. | Seu intervalo completo entra na verificação de conflitos e não termina ao avançar o bloco principal. |
| M06 | Duração de uma etapa é alterada e surge conflito. | Compromissos e lideranças envolvidos são sinalizados; ninguém é trocado silenciosamente. |
| M07 | A programação ultrapassa a duração prevista do culto. | Mostra excedente e alerta; líder pode salvar/publicar sem aprovação ou justificativa adicional. |
| M08 | Canto, instrumentos e dança compõem os mesmos 20 minutos de louvor; transmissão ocorre em paralelo. | O bloco conta 20 minutos na sequência, não 60, e transmissão não é somada de novo. |
| M09 | O tempo da etapa atual termina. | Mostra tempo excedido; etapa não avança automaticamente. |
| M10 | Responsável designado inicia/avança o culto. | Atualiza anterior, atual e próxima; demais usuários acompanham. |
| M11 | Outro líder ou administrador tenta avançar sem ser responsável designado. | Não pode iniciar/avançar a etapa principal. |
| M12 | Modelo inclui transmissão por padrão. | Cria a atividade prevista sem escalar ou confirmar pessoas; uma edição pode ser ajustada para não ter transmissão. |
| M13 | Um integrante deixa de comparecer a participação aberta. | Não surge reserva, confirmação ou vaga/substituição obrigatória por integrante; presença não é presumida. |
| M14 | Integrante de participação aberta já tem função incompatível. | A forma aberta não elimina o conflito nem presume presença confirmada. |
| M15 | Líder tenta habilitar função fora de sua equipe ou membro tenta habilitar-se. | Operação não é permitida por esse papel. |
| M16 | Administrador usa mobile. | Não pode fazer cadastros administrativos ou criar evento/escala inicial por esse canal. |
| M17 | Miniatura YouTube falha. | Nome e link continuam disponíveis, sem depender de player. |
| M18 | Oportunidade requer playback. | Toda a equipe de sonoplastia é avisada, sem aceite obrigatório. |
| M19 | Material não foi entregue no prazo operacional. | Sistema não cancela sozinho; líder pode cancelar manualmente e realocar, registrando e comunicando a mudança. |
| M20 | Conexão falha ou informação fica desatualizada. | Estado é indicado; comportamento das ações nessa condição depende da decisão pendente. |
| M21 | Alguém passa mal na portaria durante o culto. | Líder pode registrar ausência e substituição combinada externamente; não há chamado automatizado ou requisito de check-in. |
| M22 | Participante visualiza estado pelo mobile. | Tem rótulo/indicação compreensível além da cor, com atual e próximo claros. |

## 13. Avaliação do piloto

Critério principal: conseguir conduzir o culto, resolver ausências e manter participantes informados sem perguntar continuamente quem vem depois.

Observar conflitos antecipados, responsabilidades específicas ainda descobertas, tempo para registrar/resolver substituições, clareza de atual/próximo e dificuldades de uso. Não há metas numéricas aprovadas. Taxa de resposta a convite não é métrica ativa do MVP.

Recolher feedback após 2–3 meses de uso do piloto é a orientação acordada, não compromisso de data de lançamento. Coordenação externa continuará existindo; não medir sucesso como eliminação obrigatória do WhatsApp. Dashboards e cuidados para interpretação dos dados estão em evolução futura.

## 14. Pendências para a próxima sessão

| Tema | O que ainda precisa ser definido |
| --- | --- |
| Andamento | Correção de avanço acidental, marcações humanas e designação/troca do responsável. |
| Conexão | Comportamento exato sem conexão, indicação de atualização e recuperação, sem prometer offline. |
| Dependências mínimas | O que compartilhar sobre organização/rascunho no piloto sem construir motor amplo. |
| Participação aberta | Representação dos elegíveis e de pessoas com função incompatível sem criar confirmação ou vaga por integrante. |
| Conflitos e mudanças | Tratamento de conflito já existente, negociação entre líderes e atualização da programação sem mudar responsáveis silenciosamente. |
| Alterações operacionais | Limites da edição/cancelamento/realocação em evento em andamento e sua apresentação por canal, preservando ausência de cadastros mobile. |
| Intervalos e cadastros | Detalhes de preparação/deslocamento e tratamento de exclusão de cadastros vinculados. |
| Histórico | Campos, correções e retenção dos registros básicos. |
| Música | Validar observação curta; sem ampliar biblioteca ou edição para membros. |
| Acesso e avisos | Autenticação, canais de notificação e forma de entrega. |
| Mobile | Formato tecnológico e desenho da experiência, ainda não escolhidos. |

## 15. Governança e sequência de trabalho

O responsável pelo projeto não programa e quer apoio de IA com crítica fundamentada. Apontar conflitos de requisitos, permissões, segurança, confiabilidade, arquitetura e design; não tratar resposta ambígua como decisão nem transformar sugestão em escopo.

Validar regras primeiro, depois arquitetura, depois desenho da aplicação e só então implementação incremental verificável. Resolver pendências antes de implementar as partes dependentes, sem criar aprovações para rotinas desnecessárias.

Esta consolidação encerra a etapa atual de documentação para retomada na próxima sessão. Não define stack, banco, provedor, implantação ou automação de retomada.
