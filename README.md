# Escala do Reino

**Organize os eventos e as equipes da sua igreja.**

Projeto em definição, com piloto previsto no **Ministério Shalom**, focado em organizar e conduzir o culto: quem está agora, quem vem depois e quem entra quando alguém falta.

## Etapa atual

Documentação de produto consolidada em **30/09/2026**, com regras atualizadas em **02/10/2026** e novas decisões de produto aprovadas pelo responsável em **03/10/2026**: criação de nova igreja ("Criar minha igreja") com concessão atômica do primeiro administrador, administração ativa em no máximo uma igreja por conta Auth, proteção de continuidade do último administrador, reutilização de conta entre igrejas com seleção explícita de contexto e exclusão lógica recuperável.

Estado de implementação registrado neste README em **03/10/2026**: a web tem login Google, consulta autorizada do próprio vínculo com tela inicial de dados reais, tela de gestão de membros (listagem paginada e cadastro com apenas o nome, com idempotência e auditoria) e fluxo completo de **Criar minha igreja** (verificação de elegibilidade, modal de criação com sugestão editável de nome, fuso IANA, endereço, mapa e política warn/block, criação atômica no servidor, limite físico de 1 administração ativa por conta e salvaguarda do último administrador). O planejamento e a condução do culto permanecem como **protótipo preservado no código**, sem integração com o banco e sem exposição no fluxo atual. A aplicação ainda não está pronta para produção. A arquitetura, a segurança e a tecnologia do aplicativo Android/iOS permanecem em definição.

- [PRD — escopo do MVP, regras e critérios de aceite](docs/PRD.md).
- [Arquitetura do banco e das permissões — modelo lógico, segurança e pendências](docs/ARQUITETURA-BANCO.md).
- [Schema inicial — campos e restrições de igreja, membros e acesso](docs/SCHEMA-ACESSO.md).
- [Aprovação de nome e auditoria — segundo incremento de schema aplicado e verificado](docs/SCHEMA-APROVACAO-AUDITORIA.md).
- [Consulta autorizada do próprio acesso — contrato, scripts e limites de validação](docs/CONSULTA-ACESSO.md).
- [Cadastro e listagem de membros na web — contratos, auditoria e idempotência](docs/CADASTRO-MEMBROS.md).
- [Criação de igreja e salvaguardas de administração — contratos, RPCs, scripts 009/010 e testes](docs/CRIACAO-IGREJA.md).
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

Copie o modelo de variáveis de ambiente e preencha com os valores do seu ambiente:

```bash
cp .env.example .env.local
```

| Variável | Descrição / Onde encontrar |
| --- | --- |
| `VITE_SUPABASE_URL` | URL do backend Supabase (`https://<projeto>.supabase.co` para projeto remoto ou `http://127.0.0.1:54321` para laboratório local) |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Chave pública anônima (`anon`/`publishable key`), mantida localmente |

> `.env.local` está no `.gitignore` e nunca deve ser versionado. Não use chaves `service_role`, credenciais ou segredos em variáveis `VITE_*`. Apenas a chave publicável é utilizada pelo cliente web.

### Ambiente de Desenvolvimento Local (Laboratório Supabase)

Para testar contra o Supabase local (`http://127.0.0.1:54321`) e o aplicativo web (`http://127.0.0.1:3000`):
- O cliente Supabase (`src/lib/supabaseClient.js`) aceita URL HTTP exclusivamente quando `import.meta.env.DEV` for `true`, com análise exata de hostname (`localhost`, `127.0.0.1` ou `::1`) e sem credenciais embutidas. Em produção, a exigência de HTTPS estrito permanece inalterada.
- URLs remotas via HTTP, IPs de rede local e falsos hosts (ex: `localhost.evil.com`) são categoricamente rejeitados.

Para iniciar o servidor de desenvolvimento na porta 3000:

```bash
npm run dev
```

### Ferramenta Separada de Autenticação Local para Testes

O laboratório local não possui OAuth do Google habilitado e a tela de login de produto ainda não implementou e-mail/senha. Para permitir a obtenção de sessão Supabase Auth real durante o desenvolvimento sem alterar rotas, telas ou botões de produto:
- Está disponível a ferramenta separada `tools/local-auth-test.html` (com módulo `tools/local-auth-test.js`), acessível exclusivamente via navegador durante `npm run dev` em:
  `http://127.0.0.1:3000/tools/local-auth-test.html` (ou `http://localhost:3000/tools/local-auth-test.html`).
- **Guardas estritas:** A ferramenta exige runtime em modo DEV, página em loopback, backend Supabase em HTTP loopback na porta 54321 e chave pública configurada. Na falha de qualquer guarda, nenhuma chamada Auth é executada.
- **Sessão real, sem concessão automática:** A ferramenta utiliza a instância centralizada de `src/lib/supabaseClient.js`, permitindo cadastrar (`signUp`) e autenticar (`signInWithPassword`) contas de teste fictícias com e-mail do domínio `@example.com` e senha digitada pelo operador. A sessão é gravada no `localStorage` compartilhado da mesma origem. A concessão do primeiro administrador e a criação da igreja permanecem exclusivas do fluxo de produto (modal e RPC atômica).
- **Sem alteração de produto:** A ferramenta não está na pasta `public/`, não é importada pelo aplicativo de produto e não é incluída na pasta `dist/` durante `npm run build`.
- **Ressalva importante:** A autenticação manual por este utilitário local viabiliza os testes de interface do laboratório; ela **não** valida o botão Google OAuth do piloto nem conclui a implementação do fluxo e-mail/senha de produto previsto no PRD 3.1.


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
- Administrador: exibe ação para acessar a tela de **Gestão de Membros** da igreja.
- Sem vínculo elegível: exibe "Acesso à igreja ainda não liberado", com identificação da própria conta e botão "Sair".
- Falha na consulta: exibe erro com "Tentar novamente" e "Sair"; não confunde falha com ausência de vínculo.
- Recarga: recupera a sessão e consulta o vínculo novamente, sem montar as telas fictícias do protótipo.
- Revalidação em segundo plano: ao retomar foco na aba ou reconectar à internet, revalida silenciosamente o acesso e atualiza a interface caso haja revogação.

Login sozinho não concede acesso. A consulta exige conta confirmada e elegível, onboarding concluído e vínculo, igreja e membro ativos. O perfil administrativo deriva do vínculo no banco, nunca de e-mail fixo ou metadados editáveis do navegador.

**Decisões aprovadas de criação de igreja, administração e contexto:**
- **Criação de nova igreja:** Uma conta autenticada, com e-mail confirmado e sem administração ativa de outra igreja, poderá escolher "Criar minha igreja". A conclusão criará atomicamente a igreja, o cadastro de membro do criador, seu vínculo administrativo (`is_admin = true`) e a respectiva auditoria. Criar uma nova igreja não concede acesso a igrejas existentes, e o login isolado continua sem liberar dados. A concessão do primeiro administrador decorre dessa operação controlada no servidor, sem autoconcessão pública de privilégios. Regras de fuso IANA, localização Maps e política de duração (`warn`/`block`) continuam preservadas. Contratos, RPCs (`check_church_creation_eligibility`, `create_my_church`, `get_create_church_receipt`), scripts SQL (`009_create_my_church.sql` e validações) e componentes de interface entregues no código (detalhes em [docs/CRIACAO-IGREJA.md](docs/CRIACAO-IGREJA.md)).
- **Administração em uma única igreja por conta:** Uma conta Auth pode possuir administração ativa em no máximo uma igreja por vez. Ao deixar essa administração, poderá assumir outra. A regra é garantida no motor do banco de dados pelo índice parcial exclusivo `church_access_single_active_admin_idx`. Não há criação de papel de "proprietário"; uma igreja pode ter vários administradores, desde que cada conta respeite o limite.
- **Continuidade administrativa (proteção do último administrador):** O último administrador de uma igreja só poderá deixar a administração após outro administrador elegível assumir. O sucessor também deve respeitar o limite de uma igreja administrada por conta. Nenhuma operação de aplicação (como revogação, rebaixamento ou desativação) pode contornar essa trava, protegida pelos gatilhos `protect_last_active_admin` em `church_access` e `protect_last_active_admin_member` em `members`. O tratamento excepcional de bloqueio/exclusão externa da conta Auth e recuperação por manutenção permanece pendente, sem fluxo automático inventado.
- **Reutilização da conta e seleção de igreja:** A mesma conta poderá ser administradora na igreja A e possuir acesso básico à igreja B por convite (sem concessão automática de administração ou liderança em B). Uma conta com múltiplos vínculos autorizados deverá escolher explicitamente a igreja consultada; consultas, dados e permissões usam esse contexto. Trocar de igreja invalida consultas antigas e impede mistura de dados. O fluxo exige escolha explícita via `SelectChurchPage` (`select_church`), sem fallback silencioso para o primeiro vínculo.
- **Aviso sobre implantação no banco:** Os scripts `009` e `010` foram preparados e revisados no repositório, mas NÃO foram executados no Supabase do piloto. O ensaio `009` cria contas sintéticas em `auth.users` e requer ambiente isolado dedicado com autorização prévia do responsável. A entrega atual cobre o código do cliente, contratos, correções dos scripts SQL e testes automatizados. Os fluxos subsequentes (convites com e-mail e exclusão lógica) permanecem para seus respectivos incrementos.

Google e e-mail/senha continuam sendo os métodos previstos no PRD. A interface de e-mail/senha, confirmação e recuperação ainda precisa ser implementada e testada; SMTP próprio permanece pendente antes do piloto com membros.

## Estado do banco e evidências

Conforme as evidências e os resultados informados pelo responsável pelo projeto:
1. O banco contempla atualmente **sete tabelas internas** no schema `app_private`: `churches`, `members`, `church_access`, `access_invitations`, `access_requests`, `audit_entries` e `command_receipts`. A estrutura física possui RLS habilitada e privilégios diretos revogados para `anon`, `authenticated` e `service_role`. `app_private` permanece fora da Data API, e a exposição automática de tabelas encontra-se desabilitada.
2. A Data API expõe exclusivamente **quatro funções RPC** em `public` com permissão de execução concedida ao papel `authenticated`: `get_my_church_access`, `list_church_members`, `create_church_member` e `get_create_member_receipt`.
3. A igreja do piloto (Ministério Shalom) e o primeiro membro com vínculo administrativo ativo, onboarding concluído e auditoria de inicialização foram cadastrados historicamente por procedimento privado de manutenção. Esse procedimento manual do piloto fica expressamente diferenciado do fluxo de criação de igreja ("Criar minha igreja"), cujo código e scripts estão entregues no PR #7, aguardando ensaio operacional autorizado em ambiente isolado antes de qualquer aplicação permanente.
4. O responsável informou a conclusão com sucesso do pré-voo (`007_preflight_member_management.sql`), do ensaio transacional com ROLLBACK (`007_validate_member_management.sql`) com resultado PASS, da instalação permanente autorizada do script `007_member_management.sql` e da verificação `008_verify_member_management.sql` com todas as asserções verdadeiras.

Esses registros constituem evidências informadas pelo responsável, sem alegar nova inspeção direta do Supabase neste incremento. A limitação compartilhada de requisições foi implementada na rota RPC no banco; proteções em camada de borda permanecem pendentes.

**Não repetir os scripts de criação de tabelas, o bootstrap histórico ou as instalações já concluídas (001 a 008).** Os scripts em `docs/sql/` são de aplicação manual; merge de código não instala objetos no banco.

## Gestão de membros, criação de igreja e testes

O incremento de **cadastro real de membros na web** e o fluxo de **Criar minha igreja** foram implementados na aplicação:
- O cadastro básico de membro coleta **apenas o nome** (`display_name`), sem CPF. O e-mail do destinatário será informado posteriormente, no fluxo de emissão do convite. **Não há campo de e-mail no formulário atual de cadastro.**
- O fluxo "Criar minha igreja" implementa validação NFC, fuso IANA, endereço, mapa estrito, política warn/block, idempotência por comando, retenção de comando em voo, reconciliação por recibo e transição segura para a igreja criada com identificador textual direto.
- **Evidências de validação automatizada:**
  - Os seis arquivos versionados em `test/` totalizam **116 testes automatizados** distribuídos em **23 suítes** (100% aprovados, 0 falhas): ciclo de comandos de membros (33 testes, 6 suítes), criação de igreja, geração explícita de sessão e isolamento (35 testes, 8 suítes), componentes reais de produção com React Test Renderer 18.3.1 (7 testes, 1 suíte, incluindo três regressões de contexto M61/PRD), validação estrita da URL do Supabase e chave pública (25 testes, 5 suítes), guardas de segurança da ferramenta de autenticação local (10 testes, 1 suíte) e renderização segura DOM do utilitário local (6 testes, 2 suítes).
  - O comando geral `npm.cmd test` executa `node --test` e registra **117 resultados em 23 suítes** porque o test runner nativo também descobre o arquivo `tools/local-auth-test.js` (terminado em `test.js`), reportando-o como resultado adicional sem falhas. A execução explícita dos arquivos de teste via `node --test (Get-ChildItem test/*.test.js)` reporta exatamente 116 testes em 23 suítes.
  - O build de produção Vite compila com sucesso (`npm.cmd run build`), sem incluir a ferramenta de teste local em `dist/`.
  - Esses testes comprovam o comportamento do cliente web, contratos dos serviços e a montagem/transição real de telas no React; não comprovam a execução física de todos os cenários no banco nem concorrência entre conexões no Supabase, que continuam dependentes de validação operacional autorizada.
  - O responsável confirmou no navegador o funcionamento do cadastro e da listagem, a preservação dos quatro membros na tela durante a falta de conexão e a retirada do aviso após a reconexão.
  - Em 05/10/2026 (commit `b566185`), o Codex concluiu ensaio controlado em laboratório local isolado (EscalaReinoLab), comprovando que o bloqueio antes do envio não grava registros e retém o comando, e que a perda da confirmação após resposta real de sucesso do backend permite recuperação íntegra via recibo (`check_church_receipt`), reutilizando o mesmo `command_id` e sem duplicar igreja, membro, vínculo ou auditoria (conferido em transações somente leitura do PostgreSQL).
  - A desconexão física da rede, o Google OAuth, a entrega/confirmação de e-mail do piloto, a concorrência real entre conexões simultâneas disputando o bloqueio consultivo no banco e o cancelamento operacional por timeout via API HTTP continuam pendentes de validação operacional.

**Decisão sobre exclusão lógica:**
Remoções de cadastros na aplicação devem ser lógicas e recuperáveis, preservando identificadores, integridade referencial e histórico de auditoria. O fluxo de produto não deve apagar fisicamente membros da base. A recuperação exige autorização administrativa e registro de auditoria, e restaurar um membro não restaura automaticamente seu acesso revogado. A remoção lógica não pode contornar a proteção do último administrador. A representação física (avaliando sua relação com o `status` `'active'`/`'inactive'` já existente para evitar redundâncias como `deleted_at`), autorização, efeitos sobre vínculos e escalas, e o fluxo administrativo de recuperação ficam para incremento posterior. Não foram adicionados `deleted_at` ou comandos de exclusão neste momento, e a limpeza de fixtures dos ensaios SQL permanece intocada.

Membro, conta Auth e vínculo de acesso são entidades distintas: o cadastro de membro não cria usuário Auth, não concede acesso e não gera convite. Edição de nome, exclusão lógica, convites de acesso, equipes e planejamento do culto permanecem para incrementos próprios.

**Sequência de trabalho oficial aprovada pelo responsável:**
1. **Documentação e alinhamento de requisitos:** Consolidação das regras e critérios de aceite.
2. **Criação de igreja e administração (entregue no código, scripts e testes):** Fluxo "Criar minha igreja", criação atômica, limite de 1 igreja administrada por conta Auth e continuidade do último administrador (entregues em `src/`, scripts `docs/sql/009_*.sql` e `010_*.sql`, com documentação em `docs/CRIACAO-IGREJA.md`).
3. **Convites e seleção de igreja:** Emissão de convites informando e-mail do destinatário, resgate seguro, seleção explícita de igreja e isolamento estrito de contexto.
4. **Exclusão lógica e recuperação:** Remoção lógica recuperável, preservação de integridade, restauro auditado e salvaguarda do último administrador.

O `AppContext` e os perfis simulados continuam preservados para avaliação futura, sem montagem no fluxo real. A existência dessas telas não comprova conformidade integral com o PRD nem autoriza reutilizar suas regras de permissão.

