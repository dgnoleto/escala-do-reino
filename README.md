# Escala do Reino

**Organize os eventos e as equipes da sua igreja.**

Projeto em definição, com piloto previsto no **Ministério Shalom**, focado em organizar e conduzir o culto: quem está agora, quem vem depois e quem entra quando alguém falta.

## Etapa atual

Documentação consolidada em **30/09/2026** e atualizada em **02/10/2026**. Há um **protótipo web local em avaliação**, ainda não pronto para produção. A arquitetura, a segurança e a tecnologia do aplicativo Android/iOS permanecem em definição.

- [PRD — escopo do MVP, regras e critérios de aceite](docs/PRD.md).
- [Arquitetura do banco e das permissões — modelo lógico, segurança e pendências](docs/ARQUITETURA-BANCO.md).
- [Schema inicial — campos e restrições de igreja, membros e acesso](docs/SCHEMA-ACESSO.md).
- [Evolução futura — decisões preservadas e propostas adiadas](docs/EVOLUCAO-FUTURA.md).

O MVP é focado no culto. Convites de participação, reservas, prazos e aceite eletrônico continuam futuros. O convite para **acessar a igreja**, com login Google ou e-mail/senha e vínculo a um membro cadastrado, faz parte da primeira versão. O convite vale 72 horas e é de uso único. Não haverá CPF. O Supabase Auth gerencia as senhas; a aplicação oferece recuperação por e-mail sem permitir ao admin definir a senha alheia. Apple e Microsoft ficam para evolução posterior.

## Como funcionará o piloto

Líderes planejam a programação e as escalas com nomes definidos. Os membros apenas consultam: todos com acesso autorizado à igreja veem o cronograma macro; quem está escalado vê também os detalhes da própria participação. Líderes acompanham os bastidores sob sua responsabilidade, e a liturgia acompanha todo o evento.

Cada edição de culto tem seu **líder da liturgia**, que também controla exclusivamente o andamento no MVP. Pode ser uma pessoa no domingo e outra na quarta-feira. Somente admin convida usuários e designa/troca lideranças. Admin é uma permissão independente, acumulável com liderança de atividade ou liturgia, sem conceder automaticamente controle do culto.

As atividades têm cronômetro regressivo e, ao passar de zero, indicação de tempo excedido. **O culto não tem cronômetro próprio.** Nenhuma contagem avança a programação automaticamente. Serviços paralelos acompanham o início e o encerramento reais do culto, sem acionamento ou cronômetro individual.

O líder da liturgia pode cancelar uma atividade iniciada com motivo previamente cadastrado ou devolvê-la para pendente. Nenhuma dessas ações retoma a anterior ou inicia a próxima. Reiniciar uma atividade pendente usa a duração prevista inteira e preserva a execução interrompida. Intervalos entre atividades são registrados sem contador visível, para relatórios futuros.

Substituições são combinadas fora do aplicativo e registradas sem aceite eletrônico. Antes do início, cada líder pode realocar sua equipe; durante a atividade, a substituição fica com a liturgia. O checklist de preparação informa pendências sem bloquear a programação e pode exigir confirmação de duas lideranças. Líderes de atividade marcam apenas seu próprio âmbito; os detalhes de validação conjunta estão identificados no PRD.

| Canal | Finalidade prevista |
| --- | --- |
| Web | Canal em prototipação agora: cadastros, configurações, modelos, eventos, programação e planejamento das escalas, conforme permissões. |
| Aplicativo Android/iOS | Etapa posterior: consulta e operação autorizada de eventos existentes, sem cadastros administrativos. Tecnologia e data ainda não escolhidas. |

A web também pode ser aberta no navegador do celular. Nela, o uso básico deve continuar legível e permitir abrir atividades; o acabamento específico para mobile será trabalhado na etapa do aplicativo Android/iOS. O Guia de Validação do PRD é temporário do piloto: seu pequeno acionador sobreposto no celular não bloqueia a evolução do protótipo, mas o guia deve sair da experiência dos membros antes do uso real.

O piloto pressupõe internet. Sem conexão ou atualização, permanece apenas consulta da última informação, com aviso visível. A liturgia pode corrigir horários reais, inclusive após a recuperação, recalculando tempos e preservando o histórico. Horário planejado, horário real e momento do registro são distintos: começar quinze minutos atrasado não consome a duração da primeira atividade. Notificações são somente internas; compartilhamento externo é futuro. O histórico será mantido por um ano.

## Próximas etapas

1. Fechar os detalhes remanescentes de acesso, designação da liturgia, checklist e tratamento de cadastros, registrados no PRD.
2. Definir arquitetura e proteção dos dados.
3. Continuar a validar e ajustar o protótipo web em incrementos pequenos.
4. Desenhar o aplicativo Android/iOS em etapa posterior, com base nas regras e no aprendizado do piloto.

Flutter é apenas candidato sugerido, não uma decisão. As regras de produto estão separadas das propostas e pendências; não há cronograma de lançamento nem automação de retomada. Telas do protótipo não equivalem a funcionalidades prontas para produção.
