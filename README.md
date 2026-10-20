# Escala do Reino

**Organize os eventos e as equipes da sua igreja.**

Projeto em definição, com piloto previsto no **Ministério Shalom**, focado em organizar e conduzir o culto: quem está agora, quem vem depois e quem entra quando alguém falta.

## Etapa atual

Documentação de produto consolidada em **30/09/2026**, com regras atualizadas em **02/10/2026** e novas decisões de produto aprovadas pelo responsável em **03/10/2026**: criação de nova igreja ("Criar minha igreja") com concessão atômica do primeiro administrador, administração ativa em no máximo uma igreja por conta Auth, proteção de continuidade do último administrador, reutilização de conta entre igrejas com seleção explícita de contexto e exclusão lógica recuperável.

Estado de implementação registrado historicamente em **03/10/2026** e atualizado em **11/10/2026** (após integração dos PRs #8 e #9): a aplicação web contempla autenticação (Google e e-mail/senha com fluxo orientado de primeiro acesso por convite), consulta autorizada do próprio vínculo com tela inicial de dados reais, tela de gestão de membros (listagem paginada e cadastro com apenas o nome, com idempotência e auditoria), fluxo completo de **Criar minha igreja** (verificação de elegibilidade, modal de criação com sugestão editável de nome, fuso IANA, endereço, mapa e política warn/block, criação atômica no servidor, limite físico de 1 administração ativa por conta e salvaguarda do último administrador), e o fluxo completo de **convites de acesso à igreja** (emissão pelo admin com e-mail do destinatário, compartilhamento manual de link com validade de 72h, primeiro acesso com senha definida pela pessoa, orientação de confirmação de e-mail e retomada protegida, resgate com confirmação de nome ou proposta de outro nome, reemissão cancelando proposta pendente e rejeição administrativa encerrando a tentativa). O planejamento e a condução do culto permanecem como **protótipo preservado no código**, sem integração com o banco e sem exposição no fluxo atual. A aplicação ainda não está pronta para produção. A arquitetura, a segurança e a tecnologia do aplicativo Android/iOS permanecem em definição.

- [Índice da documentação — organização por regras, QA e histórico](docs/README.md).
- [Estado atual — versão de referência e entregas conhecidas](docs/ESTADO-ATUAL.md).
- [Guia de entrada para QA — roteiro e testes de acesso](docs/qa/GUIA-ENTRADA-QA.md).
- [Mapa de ambientes e laboratórios](docs/ambientes/LABORATORIOS.md).
- [PRD — escopo do MVP, regras e critérios de aceite](docs/PRD.md).
- [Arquitetura do banco e das permissões — modelo lógico, segurança e pendências](docs/arquitetura/ARQUITETURA-BANCO.md).
- [Schema inicial — campos e restrições de igreja, membros e acesso](docs/arquitetura/SCHEMA-ACESSO.md).
- [Aprovação de nome e auditoria — segundo incremento de schema aplicado e verificado](docs/arquitetura/SCHEMA-APROVACAO-AUDITORIA.md).
- [Consulta autorizada do próprio acesso — contrato, scripts e limites de validação](docs/acesso/CONSULTA-ACESSO.md).
- [Cadastro e listagem de membros na web — contratos, auditoria e idempotência](docs/produto/CADASTRO-MEMBROS.md).
- [Criação de igreja e salvaguardas de administração — contratos, RPCs, scripts 009/010 e testes](docs/produto/CRIACAO-IGREJA.md).
- [Contratos de convites de acesso e aprovação de nome — especificação e interface entregue nos PRs #8 e #9](docs/acesso/CONTRATO-CONVITES-ACESSO.md).
- [Evolução futura — decisões preservadas e propostas adiadas](docs/produto/EVOLUCAO-FUTURA.md).

O MVP é focado no culto. Convites de participação, reservas, prazos e aceite eletrônico continuam futuros. O convite para **acessar a igreja**, com login Google ou e-mail/senha e vínculo a um membro cadastrado, faz parte da primeira versão. O convite vale 72 horas e é de uso único. Não haverá CPF. O Supabase Auth gerencia as senhas; a aplicação oferece recuperação por e-mail sem permitir ao admin definir a senha alheia. Os logins Apple e Microsoft (referido como Windows na discussão do projeto) foram descartados do escopo atual pelo responsável, em razão dos custos de configuração avaliados nesta etapa. Não há compromisso de implementá-los posteriormente.

## Como funcionará o piloto

**Incremento de 18/10/2026:** acesso **Dados da Igreja**, exclusivo de administradores, para manutenção de endereço, Google Maps e logo. Backend 017 instalado no **EscalaReinoLab** e, após autorização específica e ensaio com ROLLBACK, no **piloto**, preservando dados e funções anteriores. Tela local conferida com a sessão existente do administrador. HTTP/Storage reais e cinco casos concorrentes aprovados no laboratório; a seleção automática de arquivo no Chrome ficou limitada pela permissão da extensão. Frontend ainda sem publicação desta entrega. [Contrato e limites](docs/produto/CADASTRO-IGREJA.md).

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

Historicamente, o laboratório local não contava com OAuth do Google habilitado e a tela inicial de produto ainda não possuía e-mail/senha antes do incremento de convites. Com os PRs #8 e #9, a interface de produto passou a suportar fluxo orientado de primeiro acesso por convite com definição de senha, entrada por e-mail/senha ("Já tenho conta") e botão Google. Para fins de testes e suporte ao desenvolvimento local em ambiente controlado sem alterar rotas ou botões de produto:
- Está disponível a ferramenta separada `tools/local-auth-test.html` (com módulo `tools/local-auth-test.js`), acessível exclusivamente via navegador durante `npm run dev` em:
  `http://127.0.0.1:3000/tools/local-auth-test.html` (ou `http://localhost:3000/tools/local-auth-test.html`).
- **Guardas estritas:** A ferramenta exige runtime em modo DEV, página em loopback, backend Supabase em HTTP loopback na porta 54321 e chave pública configurada. Na falha de qualquer guarda, nenhuma chamada Auth é executada.
- **Sessão real, sem concessão automática:** A ferramenta utiliza a instância centralizada de `src/lib/supabaseClient.js`, permitindo cadastrar (`signUp`) e autenticar (`signInWithPassword`) contas de teste fictícias com e-mail do domínio `@example.com` e senha digitada pelo operador. A sessão é gravada no `localStorage` compartilhado da mesma origem. A concessão do primeiro administrador e a criação da igreja permanecem exclusivas do fluxo de produto (modal e RPC atômica).
- **Sem alteração de produto:** A ferramenta não está na pasta `public/`, não é importada pelo aplicativo de produto e não é incluída na pasta `dist/` durante `npm run build`.
- **Ressalva importante:** A autenticação manual por este utilitário local viabiliza testes técnicos isolados no laboratório; ela **não** valida o botão Google OAuth do piloto nem substitui a validação de entrega real de e-mails via SMTP no ambiente de produção.


## Login e acesso à igreja

O fluxo de autenticação usa o [Supabase Auth com OAuth do Google](https://supabase.com/docs/guides/auth/social-login/auth-google).

**Pré-requisitos no painel do Supabase:**
- Google configurado em Authentication → Providers.
- `http://localhost:3000` adicionado em Authentication → URL Configuration → Site URL e Redirect URLs.

**Comportamento atual:**

- Inicialização: recupera a sessão salva antes de decidir qual tela mostrar.
- Sem sessão: exibe a tela de login com opção de entrada com Google e, na abertura de links de convite ou acesso existente, escolha orientada entre "Primeiro acesso — Criar conta" (definindo senha própria) e "Já tenho conta — Entrar" (e-mail e senha cadastrados), além de recuperação de senha e orientações claras para confirmação de e-mail e retomada do convite.
- Sessão válida: consulta `public.get_my_church_access()`, sem parâmetros de identidade.
- Vínculo elegível: exibe nome cadastrado do membro, igreja e perfil retornados pelo banco.
- Administrador: exibe ação para acessar a tela de **Gestão de Membros** da igreja, emissão de convites e moderação de solicitações de nome.
- Sem vínculo elegível: exibe "Acesso à igreja ainda não liberado", com identificação da própria conta e botão "Sair", orientando o usuário a reabrir o link de convite caso esteja em processo de adesão.
- Falha na consulta: exibe erro com "Tentar novamente" e "Sair"; não confunde falha com ausência de vínculo.
- Recarga: recupera a sessão e consulta o vínculo novamente, sem montar as telas fictícias do protótipo.
- Revalidação em segundo plano: ao retomar foco na aba ou reconectar à internet, revalida silenciosamente o acesso e atualiza a interface caso haja revogação.

Login sozinho não concede acesso. A consulta exige conta confirmada e elegível, onboarding concluído e vínculo, igreja e membro ativos. O perfil administrativo deriva do vínculo no banco, nunca de e-mail fixo ou metadados editáveis do navegador.

**Decisões aprovadas de criação de igreja, administração e contexto:**
- **Criação de nova igreja:** Uma conta autenticada, com e-mail confirmado e sem administração ativa de outra igreja, poderá escolher "Criar minha igreja". A conclusão criará atomicamente a igreja, o cadastro de membro do criador, seu vínculo administrativo (`is_admin = true`) e a respectiva auditoria. Criar uma nova igreja não concede acesso a igrejas existentes, e o login isolado continua sem liberar dados. A concessão do primeiro administrador decorre dessa operação controlada no servidor, sem autoconcessão pública de privilégios. Regras de fuso IANA, localização Maps e política de duração (`warn`/`block`) continuam preservadas. Contratos, RPCs (`check_church_creation_eligibility`, `create_my_church`, `get_create_church_receipt`), scripts SQL (`009_create_my_church.sql` e validações) e componentes de interface entregues no código (detalhes em [docs/produto/CRIACAO-IGREJA.md](docs/produto/CRIACAO-IGREJA.md)).
- **Administração em uma única igreja por conta:** Uma conta Auth pode possuir administração ativa em no máximo uma igreja por vez. Ao deixar essa administração, poderá assumir outra. A regra é garantida no motor do banco de dados pelo índice parcial exclusivo `church_access_single_active_admin_idx`. Não há criação de papel de "proprietário"; uma igreja pode ter vários administradores, desde que cada conta respeite o limite.
- **Continuidade administrativa (proteção do último administrador):** O último administrador de uma igreja só poderá deixar a administração após outro administrador elegível assumir. O sucessor também deve respeitar o limite de uma igreja administrada por conta. Nenhuma operação de aplicação (como revogação, rebaixamento ou desativação) pode contornar essa trava, protegida pelos gatilhos `protect_last_active_admin` em `church_access` e `protect_last_active_admin_member` em `members`. O tratamento excepcional de bloqueio/exclusão externa da conta Auth e recuperação por manutenção permanece pendente, sem fluxo automático inventado.
- **Reutilização da conta e seleção de igreja:** A mesma conta poderá ser administradora na igreja A e possuir acesso básico à igreja B por convite (sem concessão automática de administração ou liderança em B). Uma conta com múltiplos vínculos autorizados deverá escolher explicitamente a igreja consultada; consultas, dados e permissões usam esse contexto. Trocar de igreja invalida consultas antigas e impede mistura de dados. O fluxo exige escolha explícita via `SelectChurchPage` (`select_church`), sem fallback silencioso para o primeiro vínculo.
- **Aviso sobre implantação no banco e integração (registro histórico de 06/10/2026, PR #7):** Em 06/10/2026, mediante autorização expressa do responsável, o script permanente `009_create_my_church.sql` foi instalado com sucesso no banco de dados do piloto (projeto `jvpctgqudvjealzileib`) e verificado pelo `010_verify_create_my_church.sql` com sete indicadores verdadeiros. O ensaio `009_validate_create_my_church.sql`, que cria contas sintéticas em `auth.users`, permanece restrito ao ambiente isolado de laboratório e não foi executado no piloto. O código da aplicação web foi incorporado à branch `main` pelo merge `d372a58d600d9d7789b3aec25431542301e5c423` (PR #7, head `018e3508bb12378d3fa6d4714218e7dc87874fc8`), com a branch `feat/create-my-church` preservada. Naquela data, registrou-se que a publicação externa do frontend em ambiente de produção permanecia pendente e que os fluxos subsequentes (convites com e-mail e exclusão lógica) ficariam para seus respectivos incrementos. Posteriormente, o fluxo de convites de acesso com e-mail e primeiro acesso foi implementado e integrado à `main` via PRs #8 e #9 (10/10 e 11/10/2026), restando a exclusão lógica para a etapa seguinte.

Google e e-mail/senha são os métodos previstos no PRD. A interface web para entrada com e-mail/senha, criação de conta com senha definida pelo usuário no primeiro acesso por convite, orientação de confirmação de e-mail e retomada protegida do convite foi entregue e verificada nos PRs #8 e #9 (detalhes em [docs/acesso/CONTRATO-CONVITES-ACESSO.md](docs/acesso/CONTRATO-CONVITES-ACESSO.md) e [docs/ESTADO-ATUAL.md](docs/ESTADO-ATUAL.md)). O envio por SMTP próprio e a validação de entrega real de e-mails de confirmação/recuperação no piloto permanecem pendentes antes do uso real com membros.

## Estado do banco e evidências

Conforme as evidências e os resultados informados pelo responsável pelo projeto:
1. O banco contempla atualmente **sete tabelas internas** no schema `app_private`: `churches`, `members`, `church_access`, `access_invitations`, `access_requests`, `audit_entries` e `command_receipts`. A estrutura física possui RLS habilitada e privilégios diretos revogados para `anon`, `authenticated` e `service_role`. `app_private` permanece fora da Data API, e a exposição automática de tabelas encontra-se desabilitada.
2. A Data API expõe **sete funções RPC** do produto em `public` com permissão de execução concedida ao papel `authenticated`: as quatro anteriores (`get_my_church_access`, `list_church_members`, `create_church_member` e `get_create_member_receipt`) e as três novas instaladas pelo incremento 009 em 06/10/2026 (`check_church_creation_eligibility`, `create_my_church` e `get_create_church_receipt`).
3. A igreja do piloto (Ministério Shalom) e o primeiro membro com vínculo administrativo ativo, onboarding concluído e auditoria de inicialização foram cadastrados historicamente por procedimento privado de manutenção. Esse procedimento manual do piloto fica expressamente diferenciado do fluxo de criação de igreja ("Criar minha igreja"), cujos objetos e RPCs foram instalados no banco do piloto em 06/10/2026.
4. O responsável informou a conclusão com sucesso das instalações de membros (scripts 007 e 008) e, em 06/10/2026, do pré-voo (`009_preflight_create_my_church.sql`), da instalação autorizada de `009_create_my_church.sql` com COMMIT e PASS, e da verificação `010_verify_create_my_church.sql` com todas as sete asserções verdadeiras no projeto do piloto.

Esses registros constituem evidências informadas pelo responsável, sem alegar nova inspeção direta do Supabase neste incremento. A limitação compartilhada de requisições foi implementada na rota RPC no banco; proteções em camada de borda permanecem pendentes.

**Não repetir os scripts de criação de tabelas, o bootstrap histórico ou as instalações já concluídas (001 a 010).** Os scripts em `docs/sql/` são de aplicação manual; merge de código não instala objetos no banco.

## Gestão de membros, criação de igreja e testes

O incremento de **cadastro real de membros na web** e o fluxo de **Criar minha igreja** foram implementados na aplicação:
- O cadastro básico de membro coleta **apenas o nome** (`display_name`), sem CPF. O e-mail do destinatário será informado posteriormente, no fluxo de emissão do convite. **Não há campo de e-mail no formulário atual de cadastro.**
- O fluxo "Criar minha igreja" implementa validação NFC, fuso IANA, endereço, mapa estrito, política warn/block, idempotência por comando, retenção de comando em voo, reconciliação por recibo e transição segura para a igreja criada com identificador textual direto.
- **Evidências de validação automatizada e histórico de laboratório/piloto:**
  - **Referência histórica do PR #7 (03/10/2026):** os seis arquivos de teste totalizavam 116 testes automatizados em 23 suítes (100% aprovados), cobrindo ciclo de membros, criação de igreja, URL do Supabase e guardas do utilitário local.
  - **Referência final consolidada no fechamento do PR #9 (11/10/2026):** a suíte expandiu para **187 testes automatizados em 25 suítes** (100% aprovados, 0 falhas), incorporando testes de componentes reais de convite (`test/invitation-components-real.test.js`), ciclo de comandos de convite, primeiro acesso, contraprovas de sessão e proteções contra corridas e vazamentos em mesma aba (documentado em [docs/ESTADO-ATUAL.md](docs/ESTADO-ATUAL.md)).
  - O build de produção Vite compila com sucesso (`npm run build`), sem incluir a ferramenta de teste local em `dist/` (aviso de bundle acima de 500 kB permanece para otimização futura).
  - Esses testes comprovam o comportamento do cliente web, contratos dos serviços e a montagem/transição real de telas no React.
  - O responsável confirmou no navegador o funcionamento do cadastro e da listagem, a preservação dos quatro membros na tela durante a falta de conexão e a retirada do aviso após a reconexão.
  - **Validações já executadas em laboratório local:**
    - **04/10/2026 (ensaio 009, instalação e verificação 010):** no container PostgreSQL 17.11 local (`supabase_db_EscalaReinoLab`), execução integral do ensaio `009_validate_create_my_church.sql` com `ON_ERROR_STOP`, concluído com `ROLLBACK` explícito e resultado PASS, seguido de conferências pós-rollback comprovando ausência de dados residuais e preservação das verificações 006 e 008. Mediante autorização, instalação autorizada exclusiva no laboratório de `009_create_my_church.sql` com `COMMIT`, seguida da verificação `010_verify_create_my_church.sql` em nova conexão com 7 asserções verdadeiras (registros locais de revisão: `outputs/validacao-sql-local-009-4f830c9/RESULTADO-ENSAIO-009.md` e `RESULTADO-INSTALACAO-009.md`).
    - **04/10/2026 (concorrência local):** quatro cenários coordenados com duas conexões físicas em `READ COMMITTED` (mais observador somente leitura) no laboratório: (1) comandos distintos da mesma conta resultando em uma única criação e rejeição da segunda com 42501; (2) replay simultâneo do mesmo comando sem duplicação; (3) duas saídas administrativas concorrentes com confirmação da primeira e bloqueio da segunda com 23514 pela salvaguarda do último administrador; (4) saída administrativa concorrente com desativação de membro bloqueada com 23514. Preservada a limitação do terceiro cenário: o resultado esperado foi conferido em mensagens e no estado do banco, mas a coleta inicial não registrou PASS automático completo pelo executor original em razão da entrega de stdout/stderr. Esse conjunto testa os escalonamentos executados, sem constituir prova de toda concorrência ou de todos os níveis de isolamento (registro local de revisão: `outputs/concorrencia-local-009/RESULTADO-RODADA.md`).
    - **05/10/2026 (ensaio controlado de recuperação, commit `b566185`):** ensaio controlado em laboratório local isolado (EscalaReinoLab), comprovando que o bloqueio antes do envio não grava registros e retém o comando, e que a perda da confirmação após resposta real de sucesso do backend permite recuperação íntegra via recibo (o serviço JavaScript `checkChurchReceipt` consulta a RPC `public.get_create_church_receipt(p_command_id uuid)`), reutilizando o mesmo `command_id` e sem duplicar igreja, membro, vínculo ou auditoria (conferido em leituras independentes somente leitura do PostgreSQL; registro local de revisão: `outputs/teste-recuperacao-pr7-2026-10-05/RESULTADO-ENSAIO.md`).
  - **Validações executadas no banco e no aplicativo do piloto (06/10/2026):**
    - **Instalação e verificação no piloto (06/10/2026):** no projeto Supabase do piloto (`jvpctgqudvjealzileib`), pré-voo `009_preflight_create_my_church.sql` concluído com 12 indicadores true (registro local: `outputs/preflight-piloto-pr7-2026-10-06/RESULTADO.md`); instalação permanente autorizada de `009_create_my_church.sql` com COMMIT e mensagem PASS após confirmação (SHA256: `D0E735E4694FD1022AB778E51505ADAD5BC91FB524B2DA6B805023F101E08AEC`); e verificação `010_verify_create_my_church.sql` por leitura em solicitação separada com 7 indicadores true (SHA256: `63751AFB50504EC30E93EBAE198F2941CE78EF737F304F0428F55A7CA36EE91F`; registro local: `outputs/instalacao-piloto-pr7-2026-10-06/RESULTADO-INSTALACAO.md`).
    - **Conferência manual no aplicativo com conta existente do piloto (06/10/2026):** o responsável acessou a aplicação web local apontada para o backend do piloto e confirmou: exibição correta da igreja Ministério Shalom, perfil Administrador, quatro membros cadastrados ativos, botão Atualizar da lista mantendo os dados, e logout/novo login recuperando integralmente o acesso e os registros. Ação "Criar minha igreja" não é exibida para a conta que já administra uma igreja e aviso do limite de 1 administração por conta visível conforme PRD. Na navegação atual, recarga do navegador (F5) na tela de membros retorna à tela inicial da igreja com o botão de acesso a membros preservado (a subview é mantida em memória; registro local: `outputs/teste-aplicativo-piloto-2026-10-06/RESULTADO.md`). Identificado como teste manual informado pelo responsável, não como automação de navegador ou auditoria completa de OAuth/SMTP/identidades.
  - **Validações pendentes no piloto ou não cobertas:**
    - Criação positiva de nova igreja no piloto com conta elegível (a validação positiva de criação atômica e recuperação via recibo permanece demonstrada no ensaio controlado em laboratório local; a conta existente do piloto já administra uma igreja e exercitou a consulta e as salvaguardas);
    - Desconexão física da rede;
    - Cancelamento operacional por timeout via API HTTP;
    - Google OAuth e fluxo de entrega/confirmação real de e-mails do piloto;
    - O PR #7 foi incorporado à `main` (merge `d372a58`), mas a publicação externa do frontend em ambiente de produção permanece pendente;
    - Conformidade integral dos 64 cenários M01–M64 do PRD. As regressões de seleção de contexto em componentes de produção (`test/church-components-real.test.js`) demonstram o descarte de requisições defasadas e transição de telas, mas não comprovam todos os fluxos reais de múltiplos vínculos sob tráfego HTTP.

**Decisão sobre exclusão lógica:**
Remoções de cadastros na aplicação devem ser lógicas e recuperáveis, preservando identificadores, integridade referencial e histórico de auditoria. O fluxo de produto não deve apagar fisicamente membros da base. A recuperação exige autorização administrativa e registro de auditoria, e restaurar um membro não restaura automaticamente seu acesso revogado. A remoção lógica não pode contornar a proteção do último administrador. A representação física (avaliando sua relação com o `status` `'active'`/`'inactive'` já existente para evitar redundâncias como `deleted_at`), autorização, efeitos sobre vínculos e escalas, e o fluxo administrativo de recuperação ficam para incremento posterior. Não foram adicionados `deleted_at` ou comandos de exclusão neste momento, e a limpeza de fixtures dos ensaios SQL permanece intocada.

Membro, conta Auth e vínculo de acesso são entidades distintas: o cadastro básico de membro não cria usuário Auth, não concede acesso e não gera convite automaticamente. A emissão de convite pelo administrador e o respectivo resgate pelo convidado constituem um fluxo separado, entregue e verificado nos PRs #8 e #9. A aprovação de proposta de nome pelo administrador no resgate é um comportamento específico desse fluxo de entrada já entregue, não uma funcionalidade de edição geral de cadastros. Edição geral de cadastro, exclusão lógica, equipes e planejamento do culto continuam para incrementos próprios.

**Sequência de trabalho oficial aprovada pelo responsável:**
1. **Documentação e alinhamento de requisitos:** Consolidação das regras e critérios de aceite.
2. **Criação de igreja e administração (entregue no código, scripts e testes, integrado via PR #7):** Fluxo "Criar minha igreja", criação atômica, limite de 1 igreja administrada por conta Auth e continuidade do último administrador (entregues em `src/`, scripts `docs/sql/009_*.sql` e `010_*.sql`, com documentação em `docs/produto/CRIACAO-IGREJA.md`, incorporados à branch `main` no merge `d372a58`).
3. **Convites e seleção de igreja (entregue no código, scripts e testes, integrado via PRs #8 e #9):** Emissão de convites informando e-mail do destinatário, compartilhamento manual do link de 72 horas pelo administrador, primeiro acesso com senha definida pelo usuário, resgate seguro com confirmação de nome ou proposta de outro nome (com reemissão cancelando proposta pendente e rejeição encerrando a tentativa), orientação de confirmação e retomada protegida, seleção explícita de igreja e isolamento estrito de contexto (entregues em `src/`, suíte de 187 testes/25 suítes, scripts `docs/sql/011_*.sql` e `012_*.sql`, incorporados à branch `main` nos merges `04be37e` e `84bf20f`; documentação em [docs/acesso/CONTRATO-CONVITES-ACESSO.md](docs/acesso/CONTRATO-CONVITES-ACESSO.md) e [docs/ESTADO-ATUAL.md](docs/ESTADO-ATUAL.md)).
4. **Exclusão lógica e recuperação:** Remoção lógica recuperável, preservação de integridade, restauro auditado e salvaguarda do último administrador.

O `AppContext` e os perfis simulados continuam preservados para avaliação futura, sem montagem no fluxo real. A existência dessas telas não comprova conformidade integral com o PRD nem autoriza reutilizar suas regras de permissão.

