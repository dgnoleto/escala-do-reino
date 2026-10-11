# Escala do Reino — conferência de localhost:3000

Conferência em 11/10/2026, após leitura do resumo de retomada do PR #9. Registro histórico: processo, portas, sessão e destino do backend podem mudar. Esta versão foi preparada para publicação com referências portáveis.

## Resultado

O servidor da porta 3000 entrega os arquivos relevantes da versão final revisada do PR #9. A interface atualizada de primeiro acesso por convite foi observada no navegador, sem criar ou autenticar conta e sem resgatar convite real.

## Processo, versão e ambiente

- Processo Node/Vite PID 8488, escutando em ::1:3000. O executável do Vite pertence ao node_modules do checkout de desenvolvimento do repositório.
- HEAD local: ba852599a5b816cfab9d44161129eb87bec1ca99, branch docs/access-invitations-contract.
- Árvore local: bbc4804395314f39609aa655dc0e496d5bbfdda8, igual à árvore revisada e à do merge registrado no resumo de passagem.
- O destino Supabase injetado no módulo servido é o piloto: https://jvpctgqudvjealzileib.supabase.co.
- Seis arquivos confrontados por conteúdo com o commit revisado: main.jsx, App.jsx, LoginPage.jsx, AuthContext.jsx, AccessPendingPage.jsx e supabaseClient.js.
- Nos cinco arquivos JSX, o conteúdo original recuperado dos source maps corresponde diretamente aos blobs revisados, normalizando CRLF para LF. No cliente Supabase, o Vite injeta import.meta.env e reescreve o import da dependência para /node_modules/.vite/deps. Removidas somente essas duas transformações específicas, o conteúdo também coincide integralmente. O relatório registra ambas.
- Esta é uma comparação dos seis arquivos relevantes. Não é certificação de limpeza global do checkout, nem nova conferência da main remota.

## Verificação visual restrita

1. A aba existente do Chrome estava em Ministério Shalom / Administrador. Foi apenas lida; não houve logout, reload nem mudança de rota nessa aba.
2. Uma aba temporária no navegador integrado abriu a entrada normal de localhost:3000 e exibiu login sem sessão. Esse navegador mantém contexto separado do Chrome.
3. Um identificador sintético fora do formato exigido foi ignorado. Em seguida, um identificador sintético com 43 caracteres Base64URL foi usado somente para ativar a apresentação da entrada por convite; não corresponde a convite emitido.
4. A navegação de hash na mesma aba já montada selecionou automaticamente “É meu primeiro acesso — Criar conta”. A URL foi limpa pela aplicação.
5. A tela mostrou e-mail convidado, criação e confirmação de senha, orientação para usar o e-mail destinatário e aviso de que criar conta não cria nova igreja nem outro membro. O botão de cadastro permaneceu desabilitado, com campos vazios.
6. Selecionar “Já tenho conta — Entrar” mostrou login e recuperação de senha. Nenhum formulário foi preenchido ou enviado.
7. A aba temporária foi fechada. A aba original continuou em Ministério Shalom / Administrador.

## Limites e preservação

- Esta verificação confirma a versão servida e a apresentação inicial atualizada. Não reproduz cadastro, confirmação por e-mail, retomada autenticada, revisão de nome ou resgate real no piloto.
- Não foram consultadas credenciais ou storage do navegador. Valores de chaves, senhas, sessões e convites reais não foram exibidos nem gravados nas evidências.
- Não houve edição do checkout de desenvolvimento, commit, push, merge, deploy, SQL, criação de conta, envio de e-mail, alteração de membro ou consumo de convite. O laboratório e seus serviços, fixtures e evidências não foram alterados.
- Não há divergência encontrada nesses arquivos que justifique pull, troca de branch, instalação ou reinício para disponibilizar a jornada revisada.
- Para eventual ensaio completo adicional, usar o laboratório existente. Cadastro/resgate no piloto permanece fora desta conferência e depende de escopo autorizado.

## Evidências selecionadas

- [Relatório sanitizado de comparação de fontes](../evidencias/2026-10-11-localhost-3000.json): versão, origem Supabase, processo e hashes dos seis arquivos, com transformações Vite registradas. Não contém código com valores de configuração nem caminhos pessoais.
- [Tela de primeiro acesso com identificador sintético](../evidencias/2026-10-11-primeiro-acesso-sintetico.jpg): cadastro selecionado automaticamente.
- [Tela da alternativa de conta existente](../evidencias/2026-10-11-ja-tenho-conta-sintetico.jpg): escolha por login disponível.

As telas não contêm credenciais, destinatários reais ou convites emitidos. Os registros de DOM, a confirmação da sessão administrativa preservada e o helper de auditoria foram retidos no acervo local controlado; não integram este pacote. Não executar preparadores antigos com base neste relatório histórico.

## Relação com o projeto

- [PR #9](https://github.com/dgnoleto/escala-do-reino/pull/9): entrega revisada.
- [Issue #10](https://github.com/dgnoleto/escala-do-reino/issues/10): atualização e organização da documentação.
- [Estado atual](../ESTADO-ATUAL.md) e [guia de QA](../qa/GUIA-ENTRADA-QA.md).
