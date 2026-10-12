# Plataforma do Reino — acessos e confidencialidade na preparação de QA

Guia preparado e aprovado para publicação em 11/10/2026. Complementa a [preparação Windows 11](GUIA-SETUP-QA-WINDOWS11.md) e a [entrada de QA](GUIA-ENTRADA-QA.md). Não concede acesso, não cria tokens e não substitui decisões do responsável sobre o tratamento de dados.

## 1. Separar os acessos

| Acesso | Finalidade | Como obter |
|---|---|---|
| Repositório GitHub | Ler código/docs e acompanhar issues. | Inclusão já informada pelo PM; confirmar aceite e conta correta. |
| Project Plataforma do Reino | Ver o kanban privado. | Confirmar visibilidade própria com o PM. |
| Supabase Dashboard | Investigar o ambiente remoto combinado. | Solicitar ao PM finalidade e permissão; ele concede quando necessário. |
| Conta do aplicativo | Exercitar um papel e cenário de teste. | Preparação autorizada de conta fictícia no laboratório adequado. |
| Docker/CLI local | Executar serviços na máquina da QA. | Instalação local; não depende de ingresso no painel remoto. |

GitHub, Supabase Dashboard, Auth do aplicativo e Windows têm credenciais próprias. Não compartilhar contas ou reutilizar o token de outra pessoa.

## 2. GitHub: começar com autenticação gerenciada

Para clonar por HTTPS no Windows, priorizar Git Credential Manager, incluído no Git for Windows. A pessoa entra no navegador com a conta dela e o gerenciador conserva a autenticação no armazenamento de credenciais do sistema. Não é necessário criar um PAT manual apenas para seguir esse caminho. [GitHub/GCM](https://docs.github.com/en/get-started/git-basics/caching-your-github-credentials-in-git?platform=windows).

Senha/MFA são inseridos pela pessoa no destino. Não pedir que uma IA receba o código ou veja a senha. Nunca usar uma URL de clone contendo token, um arquivo tokens.txt no clone ou credenciais no corpo de uma issue.

## 3. Quando uma ferramenta exigir token GitHub

PAT significa Personal Access Token: credencial que atua com as permissões da conta e os limites do token. Não é programa a instalar nem concede acesso que a conta não possui.

Confirmar primeiro a necessidade e o método aceito pela ferramenta. Fine-grained permite limitar recursos, mas o GitHub documenta limitações para colaboradores de repositório e Projects pessoais; não presumir que basta selecionar este repositório na conta da QA. O repositório atual pertence à conta pessoal do PM. [Tipos e limites](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens).

Se um PAT for realmente necessário:

1. A própria QA abre GitHub → Settings → Developer settings → Personal access tokens.
2. Escolhe um tipo compatível, finalidade e expiração acordadas.
3. Habilita somente permissões necessárias. Se houver necessidade de PAT classic para repositório privado, o escopo repo é amplo; avaliar com o PM, sem acrescentar admin, delete_repo ou workflow por padrão.
4. A pessoa gera e guarda o valor diretamente no gerenciador de segredos/credenciais aprovado; não o envia à IA.
5. Configura o campo de autenticação da ferramenta que exige o token. Não gravar o valor no repositório, em script, em comando literal/histórico do terminal ou em .env.local da aplicação.
6. Registrar apenas finalidade, permissões e validade; revogar pela conta da QA se expirar a necessidade ou houver exposição.

O acesso ao Project por API pode exigir permissões diferentes do clone; não ampliar token só para experimentar. GitHub pelo navegador continua disponível conforme o acesso concedido. Consultar a mesma documentação antes da criação.

## 4. Solicitar ao PM acesso Supabase

Modelo de solicitação privada, sem segredo:

```text
Preciso de acesso ao ambiente:
Conta/e-mail que usarei no Supabase:
Finalidade de QA:
O que preciso visualizar/fazer:
Issue/cenário relacionado:
Prazo ou período de revisão do acesso:
Posso realizar a atividade no laboratório local?:
```

O PM confere o plano e a necessidade no Dashboard, em Organization settings → Team, escolhe papel/escopo disponível e envia o convite para a conta dela. A QA aceita com sua própria conta e confirma o ambiente permitido.

O Supabase documenta Read-Only e papéis limitados a projeto nos planos Team/Enterprise. Developer não equivale a leitura somente. Mesmo Read-Only pode alcançar informações sensíveis; não tratar o nome do papel como garantia de confidencialidade. Se o plano não permite o limite necessário, combinar laboratório ou evidência selecionada antes de conceder um papel amplo. [Access Control](https://supabase.com/docs/guides/platform/access-control).

A concessão no painel não autoriza executar SQL, baixar dados ou alterar Auth/piloto. Token de gestão Supabase, senha do banco e chave de servidor são credenciais diferentes; não solicitá-los para rodar o laboratório local. Login/link remoto da CLI fica fora do setup inicial.

## 5. Variáveis e segredos: separar modelo de configuração real

- .env.example: modelo versionado, com nomes e placeholders.
- .env.local: configuração específica da máquina, ignorada pelo Git.
- Autenticação GitHub: GCM ou gerenciador de credenciais; não é uma variável VITE_.
- Senhas, sessões Auth, chaves de servidor, token de gestão e links completos de convite/recuperação: material protegido, fora dos documentos/evidências compartilhados.

Não “transformar” um segredo em seguro trocando nome, codificando em Base64 ou colocando em arquivo ignorado. .gitignore controla o rastreamento de arquivos novos; não impede leitura local por IA, armazenamento em logs, publicação forçada ou exposição no navegador.

Variáveis VITE_ são entregues ao cliente. Usar somente URL e chave publicável previstas no projeto; nenhuma senha ou chave privilegiada nesse prefixo. [Vite](https://vite.dev/guide/env-and-mode), [Git/GitHub](https://docs.github.com/en/get-started/git-basics/ignoring-files).

Se um segredo já tiver sido publicado, suspender seu uso e acionar o PM para revogação/rotação e tratamento do histórico. Apenas apagar a linha no próximo commit não invalida a credencial nem remove cópias antigas.

## 6. Dados de igreja e LGPD

A LGPD inclui convicção religiosa e filiação a organização de caráter religioso entre dados pessoais sensíveis. Por isso, a associação entre pessoa e igreja pode demandar cuidado adicional. O princípio da necessidade exige limitar dados ao que atende à finalidade. [LGPD, arts. 5º e 6º](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm).

Na preparação e QA, propor dados fictícios desde a origem. Não copiar cadastros, e-mails ou dumps do piloto para a máquina da QA como atalho. Remover somente nome de um dump não garante anonimização.

Manter acesso individual e finalidade registrada. Proteger o computador e o armazenamento; revisar sincronização/compartilhamento automático de pastas. Para tratar dados reais, o responsável precisa definir finalidade, base aplicável, permissões e retenção; este guia não certifica conformidade integral com a LGPD.

Referência para aprofundar controles e orientação de pessoas: [materiais da ANPD sobre segurança da informação](https://www.gov.br/anpd/pt-br/centrais-de-conteudo/materiais-educativos-e-publicacoes/anonimizado___guia_orientat-_seg_da_inf_p_atpp.pdf).

## 7. Antigravity IDE e conexão GitHub na IA de apoio

**Antigravity IDE** será usado na máquina da QA, como no trabalho do PM. Ele é o editor com arquivos e terminal; Antigravity 2.0 e Antigravity CLI são superfícies diferentes, explicadas na seção 8 do [guia de setup](GUIA-SETUP-QA-WINDOWS11.md). A segunda IA ainda não foi definida; não presumir que trocar de produto preserva contas, contexto, permissões ou políticas de dados.

### 7.1 O que a conexão com GitHub facilita

Quando oferecida pela ferramenta/conta, a conexão permite consultar código, documentos, issues ou PRs conforme as ações e recursos autorizados. Confirmar quais operações estão disponíveis; acesso de leitura não demonstra permissão ou capacidade de escrever.

| Experiência | Como pode acessar o projeto | O que conferir |
|---|---|---|
| ChatGPT com integração GitHub disponível | Um app/plugin conectado pode fornecer acesso aos recursos e ações permitidos. | A integração presente na conta, o repositório autorizado e as ações expostas. Não prometer ajustes/publicação só porque a conexão foi feita. [OpenAI](https://learn.chatgpt.com/docs/use-chatgpt). |
| Claude Code | Em sessão Local, pode trabalhar sobre os arquivos do clone. A experiência desktop também documenta conectores como GitHub para sessões compatíveis. | Distinguir Local de Cloud/SSH, arquivos locais de recursos do conector e autenticação Git de acesso à conta Anthropic. [Claude Code](https://code.claude.com/docs/pt/desktop). |
| Cursor | O trabalho local usa o workspace escolhido; Cloud Agents usam conexão com o provedor do repositório e um ambiente próprio. | Distinguir local de cloud. Cloud Agents podem trabalhar em branch e enviar alterações conforme permissões; não acioná-los só para conferir leitura. [Cursor Agent](https://cursor.com/docs/agent/overview), [Cloud Agents](https://cursor.com/docs/cloud-agent). |

Na experiência OpenAI, tarefas de código em um ambiente Codex Cloud são outro caminho, com repositório e preparação próprios; não são consequência automática de conectar um app GitHub em um chat. [Codex Cloud](https://learn.chatgpt.com/docs/cloud).

**Conexão remota, clone local e publicação são etapas separadas.** O conector pode consultar a versão publicada no GitHub, enquanto o clone contém o commit e eventuais mudanças locais da máquina da QA. Informar branch/commit em cada análise. Um agente cloud não recebe automaticamente o Docker, o localhost ou a configuração do computador dela.

### 7.2 Roteiro de conexão quando a ferramenta for escolhida

1. Confirmar a experiência (chat, editor local ou agente cloud), a conta da QA e se a integração GitHub está disponível nela. Seguir a documentação oficial dessa experiência; menus/planos podem mudar.
2. Abrir o fluxo oficial de conexão da ferramenta e autenticar a própria conta GitHub no navegador. Não colar PAT no chat para “vincular”.
3. Ler as permissões solicitadas e limitar o acesso ao repositório necessário quando a integração permitir. Se ela exigir aprovação/instalação pelo proprietário ou não oferecer o recurso na conta da QA, acionar o PM; não ampliar acesso ou tornar o repositório público para contornar.
4. Começar por uma consulta conhecida, como docs/PRD.md, registrando repositório, branch e commit quando a ferramenta os informar. Se não informar a versão, registrar essa limitação.
5. Conferir separadamente as ações disponíveis para issues, arquivos e PRs. No clone local, conferir Git/GCM; login na IA e conexão por app não configuram necessariamente o Git do Windows.
6. Alterações no clone, criação de issue, commit, push, PR e merge seguem a distribuição de responsabilidades e o escopo autorizado. Não experimentar uma escrita para testar o conector sem autorização.

Não é necessário instalar ou conectar todas as ferramentas agora. O setup inicial usa Antigravity IDE, clone/GCM e laboratório combinado; a IA de apoio será configurada quando escolhida. A conexão de um serviço não autoriza outra IA a usar suas credenciais.

### 7.3 Cuidados mantidos para todas as ferramentas

- Abrir somente o workspace necessário e começar por leitura.
- Revisar políticas de execução/permissão da versão instalada; no Windows, Request Review exige revisão dos comandos, salvo permissões previamente liberadas. [Antigravity IDE](https://www.antigravity.google/docs/settings?tab=ide).
- Não carregar .env real, gerenciador de credenciais, cookies, dumps, links de confirmação ou saída com chaves no chat.
- Não conectar a IA ao piloto ou conceder acesso amplo ao computador só para concluir o setup.
- Conferir políticas de dados e conta da ferramenta antes de enviar código privado ou informação pessoal. Preferir documentos/evidências selecionados e dados fictícios.
- Uma regra de prompt ou arquivo ignorado é orientação, não uma barreira técnica absoluta.

Prompt inicial independente de fornecedor:

> Você apoia QA da Plataforma do Reino, começando pelo módulo Escala do Reino. Leia os guias e a issue selecionada, registre o commit e identifique a interface/backend. Estou usando meu próprio computador; os laboratórios do PM não existem aqui automaticamente. Comece por leitura e diagnóstico. Não peça, leia, copie ou publique senhas, tokens, sessões, dumps ou links reais. Explique ações de instalação e execute somente o escopo autorizado, preservando dados e serviços. Antes de teste, confirme que o ambiente fictício foi preparado. Não copie dados do piloto nem faça login/link remoto por conveniência. Antigravity IDE apoia o trabalho local; alterações de produto e publicações seguem a distribuição de responsabilidades e autorização do PM. Novos commits, push, merge, deploy e SQL no piloto exigem autorização específica. Registre esperado, observado, evidência e limites; em erro de setup, investigue a causa mínima sem repetir instalações/fixtures amplamente.

## 8. Evidências e incidentes

Uma evidência deve mostrar o comportamento necessário, com versão, ambiente e alcance. Remover ou substituir informações desnecessárias antes de compartilhar; não assumir que repositório privado dispensa confidencialidade.

Não anexar .env, banco, cookie, token, saída completa da CLI com chaves, link Auth ou HAR bruto. A pessoa inspeciona a captura antes do envio. Registros fictícios podem entrar após seleção; identificar claramente que são fictícios.

Em exposição suspeita: interromper o compartilhamento, avisar o PM pelo canal combinado e registrar somente fatos sem repetir o segredo. O responsável conduz a resposta, a revogação e eventual avaliação de obrigações legais; não apagar evidência/histórico indiscriminadamente.

A revisão de acessos e a destinação de materiais ao fim do trabalho são combinadas com o PM. Preservação de fixtures e evidências autorizadas não permite manter indefinidamente dados reais desnecessários; as duas situações devem ser tratadas separadamente.
