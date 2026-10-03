# Escala do Reino

**Organize os eventos e as equipes da sua igreja.**

Projeto em definição, com piloto previsto no **Ministério Shalom**, focado em organizar e conduzir o culto: quem está agora, quem vem depois e quem entra quando alguém falta.

## Etapa atual

Documentação de produto consolidada em **30/09/2026**, com regras atualizadas em **02/10/2026**. Estado de implementação registrado neste README em **03/10/2026**: a web tem login Google e consulta autorizada do próprio vínculo, com tela inicial de dados reais. O planejamento e a condução do culto permanecem como **protótipo preservado no código**, sem integração com o banco e sem exposição no fluxo atual. A aplicação ainda não está pronta para produção. A arquitetura, a segurança e a tecnologia do aplicativo Android/iOS permanecem em definição.

- [PRD — escopo do MVP, regras e critérios de aceite](docs/PRD.md).
- [Arquitetura do banco e das permissões — modelo lógico, segurança e pendências](docs/ARQUITETURA-BANCO.md).
- [Schema inicial — campos e restrições de igreja, membros e acesso](docs/SCHEMA-ACESSO.md).
- [Aprovação de nome e auditoria — segundo incremento de schema aplicado e verificado](docs/SCHEMA-APROVACAO-AUDITORIA.md).
- [Consulta autorizada do próprio acesso — contrato, scripts e limites de validação](docs/CONSULTA-ACESSO.md).
- [Evolução futura — decisões preservadas e propostas adiadas](docs/EVOLUCAO-FUTURA.md).

O MVP é focado no culto. Convites de participação, reservas, prazos e aceite eletrônico continuam futuros. O convite para **acessar a igreja**, com login Google ou e-mail/senha e vínculo a um membro cadastrado, faz parte da primeira versão. O convite vale 72 horas e é de uso único. Não haverá CPF. O Supabase Auth gerencia as senhas; a aplicação oferece recuperação por e-mail sem permitir ao admin definir a senha alheia. Os logins Apple e Microsoft (referido como Windows na discussão do projeto) foram descartados do escopo atual pelo responsável, em razão dos custos de configuração avaliados nesta etapa. Não há compromisso de implementá-los posteriormente.

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

## Configuração local

Clone o repositório e instale as dependências:

```bash
npm install
```

Copie o modelo de variáveis de ambiente e preencha com os valores do seu projeto Supabase:

```bash
cp .env.example .env.local
```

| Variável | Onde encontrar |
| --- | --- |
| `VITE_SUPABASE_URL` | Supabase → Project Settings → API → Project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase → Project Settings → API → anon/public key |

> `.env.local` está no `.gitignore` e nunca deve ser versionado. Não use chaves `service_role` ou secretos OAuth no cliente web.

Para iniciar o servidor de desenvolvimento na porta 3000:

```bash
npm run dev
```

## Login e acesso à igreja

O fluxo de autenticação usa o [Supabase Auth com OAuth do Google](https://supabase.com/docs/guides/auth/social-login/auth-google).

**Pré-requisitos no painel do Supabase:**
- Google configurado em Authentication → Providers.
- `http://localhost:3000` adicionado em Authentication → URL Configuration → Site URL e Redirect URLs.

**Comportamento atual:**

- Inicialização: recupera a sessão salva antes de decidir qual tela mostrar.
- Sem sessão: exibe a tela de login, atualmente apenas com Google.
- Sessão válida: consulta `public.get_my_church_access()`, sem parâmetros de identidade.
- Vínculo elegível: exibe nome cadastrado do membro, igreja e perfil retornados pelo banco.
- Sem vínculo elegível: exibe "Acesso à igreja ainda não liberado", com identificação da própria conta e botão "Sair".
- Falha na consulta: exibe erro com "Tentar novamente" e "Sair"; não confunde falha com ausência de vínculo.
- Recarga: recupera a sessão e consulta o vínculo novamente, sem montar as telas fictícias do protótipo.

Login sozinho não concede acesso. A consulta exige conta confirmada e elegível, onboarding concluído e vínculo, igreja e membro ativos. O perfil administrativo deriva do vínculo no banco, nunca de e-mail fixo ou metadados editáveis do navegador. Neste incremento, quando há mais de uma igreja autorizada, a tela apresenta somente o primeiro vínculo retornado; a seleção de contexto ainda não foi implementada.

Google e e-mail/senha continuam sendo os métodos previstos no PRD. A interface de e-mail/senha, confirmação e recuperação ainda precisa ser implementada e testada; SMTP próprio permanece pendente antes do piloto com membros.

## Estado do banco e evidências

Conforme as evidências e os resultados informados pelo responsável nas etapas anteriores, existem seis tabelas internas em `app_private`: `churches`, `members`, `church_access`, `access_invitations`, `access_requests` e `audit_entries`. A estrutura foi criada com RLS e privilégios diretos bloqueados para `anon`, `authenticated` e `service_role`. `app_private` permanece fora da Data API; a exposição automática de novas tabelas foi desligada conforme relato do responsável.

A igreja do piloto e o primeiro membro com vínculo administrativo ativo, onboarding concluído e auditoria de inicialização já foram cadastrados. A consulta `public.get_my_church_access()` foi instalada permanentemente após ensaio com `ROLLBACK` e resultado PASS informado pelo responsável. A captura da aplicação mostrou nome, igreja e perfil reais; o botão Sair voltou ao login.

Esses registros não equivalem a uma nova inspeção do Supabase. A evidência completa de todas as colunas da verificação 006 não foi apresentada. Testes HTTP, segunda conta real sem vínculo, troca de conta e concorrência não estão integralmente comprovados. A limitação compartilhada de requisições permanece pendente.

**Não repetir os scripts de criação das tabelas, o bootstrap ou a instalação da consulta já realizada.** Alguns documentos vinculados ainda descrevem autenticação e inicialização como pendentes; são registros de progresso desatualizados, sem alteração das regras do PRD. Os scripts em `docs/sql` são de aplicação manual; merge de código não instala objetos no banco.

## Próximo incremento

O próximo recorte é o **cadastro real de membros na web**, com criação e listagem por administrador autorizado na própria igreja. Ainda não está implementado. O cadastro não cria conta Auth, concede acesso, emite convite ou atribui liderança. Nomes não são únicos e não haverá CPF.

Autorização no servidor, validação de entrada, consultas parametrizadas, auditoria transacional e proteção contra repetição de comandos devem acompanhar essa entrega. Edição de nome, exclusão, desativação, reativação, convites, equipes e planejamento ficam para incrementos próprios, respeitando as pendências do PRD.

O `AppContext` e os perfis simulados continuam preservados para avaliação futura, sem montagem no fluxo real. A existência dessas telas não comprova conformidade integral com o PRD nem autoriza reutilizar suas regras de permissão.

