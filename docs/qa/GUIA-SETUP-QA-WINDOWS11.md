# Plataforma do Reino — preparação de QA no Windows 11

Versão preparada e aprovada para publicação em 11/10/2026. Público: QA trabalhando em seu próprio computador, com **Antigravity IDE** (o editor utilizado pelo PM) e uma IA de apoio a escolher. A validação da preparação na máquina da QA permanece pendente; aprovação documental não significa instalação ou ensaio executado.

O responsável informou que a QA já foi incluída no repositório. Ela deve confirmar que aceitou o convite e consegue abrir o repositório com sua própria conta; não é necessário repetir o convite por padrão.

## 1. O que este guia prepara

1. Git e clone privado autenticado.
2. Node.js e dependências da aplicação.
3. Docker Desktop com WSL 2.
4. Supabase CLI em pasta de ferramentas separada.
5. Antigravity IDE, identificação do instalador correto e regras iniciais de uso.
6. Solicitação de acesso Supabase e configuração de ambiente, quando necessárias.
7. Conferência de variáveis e prontidão antes de QA.

Leia também [acessos e confidencialidade](ACESSOS-E-CONFIDENCIALIDADE-QA.md), [entrada de QA](GUIA-ENTRADA-QA.md) e [mapa dos laboratórios](../ambientes/LABORATORIOS.md). Localhost é o computador que executa o navegador; ele não aponta para o computador do PM.

**Limite atual:** a main examinada (`40c53126b9d1a1923537bd8dc1fe83ef2757d05b`) tem scripts em docs/sql, mas não tem supabase/config.toml, pacote versionado de inicialização do laboratório ou fixtures portáveis selecionadas. Instalar as ferramentas não reproduz, sozinho, o laboratório HTTP existente. A primeira preparação do banco fica pendente do procedimento revisado e autorizado; não resolver isso copiando o banco do piloto ou adivinhando a ordem dos scripts.

## 2. Conferir o computador antes de instalar

- Em Configurações → Sistema → Sobre, identificar edição/build do Windows, arquitetura x64 ou ARM64 e memória RAM. Registrar esses dados sem nome pessoal do dispositivo.
- No Gerenciador de Tarefas → Desempenho → CPU, verificar virtualização.
- Conferir espaço livre para imagens/volumes e se Docker, Git, Node ou WSL já existem.
- Usar a própria conta Windows, bloqueio de tela e armazenamento local protegido; combinar com o PM se há sincronização automática de pastas.

Docker documenta WSL 2.1.5 ou posterior, virtualização e 8 GB de RAM entre seus requisitos. Conferir a versão do Windows suportada e o instalador da arquitetura correta na [página oficial](https://docs.docker.com/desktop/setup/install/windows-install/). Requisitos podem mudar; não inferir compatibilidade somente pela expressão “Windows 11”.

## 3. Instalar Git e Node.js

Obter [Git for Windows](https://git-scm.com/install/windows) pelo site oficial e manter o Git Credential Manager (GCM) na instalação. Instalar uma versão LTS suportada do [Node.js](https://nodejs.org/en/download) compatível com o projeto e a CLI. Registrar a versão efetivamente escolhida; a CLI via npm exige Node 20 ou posterior, mas não escolher automaticamente uma versão antiga sem suporte.

Fechar e reabrir o PowerShell após a instalação. Conferências, sem credenciais:

```powershell
git --version
node --version
npm.cmd --version
```

Cada comando deve responder com uma versão. Se o programa não for reconhecido, conferir instalação e reabrir terminal antes de reinstalar. Usamos npm.cmd no Windows para evitar que a execução do wrapper npm.ps1 dependa de mudar a política do PowerShell.

## 4. Autenticar e clonar com sua própria conta

Primeiro abrir [o repositório](https://github.com/dgnoleto/escala-do-reino) no navegador e confirmar a conta da QA. Para o clone HTTPS, o GCM pode abrir o navegador e guardar a autenticação no gerenciador de credenciais do Windows, sem PAT criado manualmente. A pessoa conclui login, MFA e eventuais permissões diretamente no destino. [Orientação oficial](https://docs.github.com/en/get-started/git-basics/caching-your-github-credentials-in-git?platform=windows).

Exemplo de diretório local fora da pasta do PM e fora da pasta de ferramentas. Se já existir um clone nessa pasta, identificar seu estado antes de executar; não apagar ou sobrescrever.

```powershell
$qaRoot = Join-Path $env:USERPROFILE 'Projects\PlataformaDoReino'
New-Item -ItemType Directory -Path $qaRoot -Force
Set-Location -LiteralPath $qaRoot
git clone https://github.com/dgnoleto/escala-do-reino.git
Set-Location -LiteralPath (Join-Path $qaRoot 'escala-do-reino')
git status --short
git branch --show-current
git rev-parse HEAD
```

O clone deve terminar sem erro de acesso. Nunca colocar token na URL de clone. Se a autenticação selecionar outra conta, corrigir a conta/credencial no GCM com a pessoa antes de criar um PAT ou alterar acesso.

GitHub no navegador e Git autenticado no computador são coisas relacionadas, mas uma sessão do navegador não prova que o clone já funciona. Nome/e-mail de autoria de commit também não substituem autenticação; configurar autoria somente se houver trabalho de edição autorizado.

## 5. Preparar dependências da aplicação

Na raiz do clone, usar o lockfile existente:

```powershell
npm.cmd ci
git status --short
```

Esta instalação inicial na nova máquina é diferente de reinstalar o laboratório preservado no computador do PM. Não usar npm update ou trocar dependências para “fazer funcionar”. Em erro, registrar mensagem sanitizada, versão e etapa. Instalação de dependências não valida o fluxo de negócio.

## 6. Instalar e conferir WSL 2 e Docker

No PowerShell, conferir primeiro:

```powershell
wsl --version
wsl --status
```

Se WSL não estiver instalado, seguir a [instalação da Microsoft](https://learn.microsoft.com/en-us/windows/wsl/install). No Windows 11, quando apropriado, a preparação pode usar PowerShell como administrador:

```powershell
wsl --install --no-distribution
wsl --update
```

Reiniciar se o instalador solicitar e conferir a versão novamente. Não instalar outra distribuição Linux ou outro Docker Engine por tentativa; Docker Desktop não exige uma distribuição de usuário específica. [Comandos WSL](https://learn.microsoft.com/en-us/windows/wsl/basic-commands), [Docker com WSL 2](https://docs.docker.com/desktop/features/wsl/).

Baixar Docker Desktop pelo [site oficial](https://docs.docker.com/desktop/setup/install/windows-install/), escolher x64/ARM conforme a máquina e seguir o instalador. A pessoa lê e aceita os termos aplicáveis; a preparação não presume elegibilidade a licença gratuita.

Abrir Docker Desktop e conferir o mecanismo WSL 2 e o uso de contêineres Linux. Algumas versões ativam WSL 2 sem exibir o seletor. Conferir:

```powershell
docker version
docker ps
```

docker version deve mostrar cliente e servidor; somente cliente não prova que o engine está ativo. docker ps deve responder, mesmo sem contêineres na máquina nova. Não é necessário criar o contêiner de demonstração welcome-to-docker para preparar o projeto.

## 7. Instalar a Supabase CLI separada do código

A referência do laboratório existente registra CLI 2.119.0; a [release oficial](https://github.com/supabase/cli/releases/tag/v2.119.0) foi localizada. É referência histórica de compatibilidade, não prova de execução na máquina da QA. Confirmar essa versão na preparação; se a arquitetura não for atendida ou houver falha nova, registrar e avaliar a mudança.

Rota proposta com npm, numa pasta separada do clone, para não modificar package.json/package-lock.json do produto:

```powershell
$qaTools = Join-Path $env:USERPROFILE 'Projects\PlataformaDoReino\FerramentasQA'
New-Item -ItemType Directory -Path $qaTools -Force
Set-Location -LiteralPath $qaTools
npm.cmd init -y
npm.cmd install --save-dev --save-exact supabase@2.119.0
npm.cmd exec -- supabase --version
```

Usar esse bloco na preparação inicial de uma pasta nova; se já houver instalação, conferir a versão e reutilizar. O comando final deve registrar 2.119.0. Não presumir que um comando supabase global existirá: nesta rota ele está instalado nessa pasta.

Depois, a equipe deve indicar no procedimento do laboratório como chamar esse executável a partir do diretório de configuração escolhido. Não rodar start dentro de FerramentasQA nem init no clone por conveniência. A [CLI oficial](https://supabase.com/docs/guides/local-development/cli/getting-started?platform=npm&queryGroups=platform) diferencia instalação da ferramenta e diretório configurado do projeto.

Usar a CLI local não exige login no Supabase remoto. Login/link, db pull/push, reset, dump e comandos de deploy não fazem parte desta instalação inicial.

## 8. Distinguir os produtos e instalar o Antigravity IDE

A página de download reúne produtos com nomes semelhantes. O responsável confirmou que usa **Antigravity IDE**; este é o alvo da preparação da QA.

| Produto | Para que serve | Escolha nesta preparação |
|---|---|---|
| Antigravity / Antigravity 2.0 | Aplicativo independente para lançar e acompanhar agentes, sem depender de um IDE. | Não é o editor escolhido para esta preparação. |
| **Antigravity IDE (Standalone)** | Ambiente de desenvolvimento com editor de arquivos e agentes integrados ao workspace, terminal e navegador. IDE significa ambiente integrado de desenvolvimento. | **Instalar este aplicativo.** |
| Antigravity CLI | Interface de agentes pelo terminal, com instalação própria. | Não é necessária neste roteiro. Não confundir com a Supabase CLI da seção 7. |

Fontes: [Antigravity 2.0](https://www.antigravity.google/docs/overview), [Antigravity IDE](https://www.antigravity.google/docs/ide/overview/) e [download oficial](https://antigravity.google/download). São produtos/superfícies diferentes; não inferir que instalar um disponibiliza automaticamente o outro.

1. Na página oficial, localizar a seção **Antigravity IDE (Standalone)**, em vez de usar automaticamente o primeiro download de Antigravity 2.0.
2. Nessa seção, selecionar Windows x64 ou ARM64 conforme a máquina; conferir nome do produto e instalador antes de executar.
3. Instalar e abrir **Antigravity IDE**. A pessoa realiza o login e aceita os termos diretamente.
4. Confirmar a interface com editor, explorador de arquivos e terminal. Se aparecer apenas a central de agentes, conferir qual aplicativo foi aberto antes de repetir a instalação. Não apagar configurações ou outros aplicativos para resolver a dúvida.

Abrir somente a pasta do clone como workspace. No Windows, revisar a política de execução de terminal: começar com Request Review, conferir eventuais permissões previamente liberadas e evitar habilitar acesso amplo a arquivos fora do workspace. Os nomes das opções podem mudar; consultar as [configurações do Antigravity IDE](https://www.antigravity.google/docs/settings?tab=ide).

Essa configuração ajuda a revisar ações; não transforma instruções em garantia absoluta de isolamento. Uma IA com acesso à pasta pode alcançar arquivos locais. Conferir também os controles efetivos da versão instalada e as políticas de dados do serviço utilizado.

A outra IA de apoio pode ser escolhida depois. O método de QA continua o mesmo: documento de referência, versão, ambiente, reprodução, esperado, observado, evidência e limite. Para conectar GitHub em ChatGPT, Claude Code ou Cursor, consultar a seção 7 do [guia de acessos](ACESSOS-E-CONFIDENCIALIDADE-QA.md); a conexão não substitui o clone e a preparação do laboratório local.

## 9. Solicitar acesso e obter configuração do ambiente

O acesso GitHub já informado não concede painel Supabase, Project privado, contas do aplicativo ou senha do banco. Pedir ao PM acesso ao Project se ele não aparecer para a conta da QA; não torná-lo público como atalho.

Para acesso Supabase, enviar ao PM finalidade, projeto/ambiente e conta utilizada, sem senha ou token. O [guia de acessos](ACESSOS-E-CONFIDENCIALIDADE-QA.md) contém o modelo e as decisões de permissão.

Antes de executar a aplicação, combinar o backend. A rota inicial recomendada é laboratório com dados fictícios; acesso ao piloto é um escopo separado. Não copiar .env.local, contêineres, volumes, sessões ou credenciais do computador do PM.

## 10. Variáveis locais e proteção no Git

Na raiz do clone, se ainda não houver configuração:

```powershell
Copy-Item -LiteralPath '.env.example' -Destination '.env.local'
git check-ignore -v .env.local
git ls-files -- .env.local
git status --short
```

Copy-Item deve ser usado apenas na criação inicial; não sobrescrever uma configuração já existente. check-ignore deve indicar a regra que ignora .env.local; ls-files não deve listar esse arquivo. Se ele estiver rastreado, parar e tratar com o PM, sem publicar ou tentar apagar o histórico sozinho.

A pessoa configura localmente somente:

- VITE_SUPABASE_URL: endpoint do backend combinado.
- VITE_SUPABASE_PUBLISHABLE_KEY: chave pública correspondente ao mesmo backend.

O modelo tem placeholders. Não iniciar testes com configuração incompleta. Não copiar chave secreta, service_role, senha de banco ou token GitHub para variáveis VITE_.

O .gitignore vigente ignora .env, .env.* e arquivos *.local, mas mantém .env.example. Ele evita inclusão automática de arquivos novos ignorados; não remove arquivos já rastreados, não revoga um segredo vazado e não bloqueia leitura por outras ferramentas. Nunca forçar git add de .env.local. [Arquivos ignorados](https://docs.github.com/en/get-started/git-basics/ignoring-files).

Variáveis VITE_ entram no código entregue ao navegador. A chave publicável é uma credencial de cliente, não senha de administrador; autorização depende também das regras do backend. [Vite](https://vite.dev/guide/env-and-mode). Ver o guia de confidencialidade para tokens e evidências.

## 11. Primeira execução — somente após preparar o backend

O PM/equipe deve fornecer o procedimento revisado para o laboratório da QA: configuração, comandos, versões, portas, dados fictícios e verificação. Um supabase start genérico cria serviços locais, mas não garante o esquema, Auth, e-mails e cenários do Escala do Reino. Não iniciar uma bateria de QA enquanto esse alvo estiver indefinido.

Depois da preparação autorizada, na raiz do clone:

```powershell
npm.cmd run dev -- --host 127.0.0.1 --port 3000 --strictPort
```

Abrir a URL anunciada no terminal. strictPort evita mudar silenciosamente de porta. Se 3000 estiver ocupada, identificar o processo e combinar outra porta; não encerrá-lo por tentativa.

Conferir frontend, backend e versão antes de cadastrar/entrar. Se houver ajustes de confirmação/redirect de Auth, eles precisam corresponder às origens locais da QA, conforme o procedimento. Não enviar formulário para o piloto por engano.

## 12. Uso diário, preservação e registro

- Abrir Docker Desktop e conferir os serviços do laboratório da QA pelo procedimento combinado.
- Confirmar branch/commit e alterações locais antes de atualizar o clone; não aplicar reset/pull que apague ou misture trabalho.
- Iniciar a interface e escolher a issue/casos autorizados.
- Registrar resultado com o [roteiro de QA](ROTEIRO-QA-E-REGISTRO.md).
- Parar a interface com Ctrl+C. Para o banco/contêineres, usar o procedimento que preserva volumes e dados.
- Não usar reset, prune, remoção de volumes ou stop com flags de exclusão para corrigir falhas.
- Não repetir instalação ou renovar fixture/convite consumido sem necessidade nova e escopo autorizado.

## 13. Onde investigar uma falha de preparação

| Sintoma | Primeira conferência |
|---|---|
| Repository not found / 403 | Conta autenticada e convite aceito; não trocar automaticamente por token mais amplo. |
| git/node/npm não reconhecido | Instalação e terminal reaberto; evitar reinstalação imediata. |
| Docker só mostra cliente | Docker Desktop/engine/WSL; não é falha do aplicativo. |
| Porta ocupada / acesso negado ao publicar porta | Identificar processo ou faixa reservada; não mudar várias portas sem registrar. |
| Backend remoto inesperado | Suspender envio de formulários e conferir configuração com o PM. |
| SMTP/confirmar e-mail não funciona | Configuração do laboratório, caixa local e redirects; não concluir falha do produto só pelo setup. |
| RPC/esquema ausente | Verificar preparação do banco; instalar Docker não instala o contrato do aplicativo. |

Registro mínimo: etapa, resultado esperado/observado, comando sem valores secretos, versões, horário e mensagem sanitizada. Não anexar .env, saída completa do status Supabase com chaves, dump, cookie, HAR ou link de confirmação.

Prontidão para QA: clone acessível; ferramentas reconhecidas; Docker engine ativo; CLI identificada; workspace e limites de IA conferidos; backend preparado e identificado; .env.local não rastreado; caso, conta fictícia e escopo combinados. Ferramentas instaladas com banco pendente significam **preparação parcial**, não laboratório aprovado.
