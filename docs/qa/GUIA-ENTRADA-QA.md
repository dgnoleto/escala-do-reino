# Escala do Reino — guia de entrada para QA

Preparado em 11/10/2026 e aprovado pelo responsável para esta primeira publicação. A rotina de atuação será combinada com a QA. Este guia não substitui o PRD nem cria regras de produto.

## 1. Como explicar o projeto

O Escala do Reino pretende ajudar a igreja a organizar as equipes e a programação dos cultos e, depois, acompanhar sua condução. Estamos construindo por etapas. A parte real disponível hoje concentra-se em identidade, criação de igreja, membros, convites e acesso autorizado. As telas de planejamento e condução preservadas no código ainda são um protótipo; sua existência não significa integração ou aprovação funcional dessas partes.

O responsável pelo produto decide as regras. Antigravity implementa no checkout de desenvolvimento mantido pelo responsável. Codex revisa e conduz os ensaios autorizados. A entrada da QA acrescentará revisão independente dos cenários, investigação de falhas e rastreabilidade entre regra, comportamento e evidência. Essa proposta de rotina deve ser combinada com ela; a IA pode apoiar a análise e o registro, e a conclusão precisa mostrar o que foi observado e o que permanece sem validação.

Três conceitos ajudam a entender os testes:

| Conceito | Significado |
|---|---|
| Conta | Identidade usada para entrar, gerenciada pelo Supabase Auth. |
| Membro | Cadastro de uma pessoa em determinada igreja; pode existir sem conta. |
| Vínculo de acesso | Autorização para uma conta acessar uma igreja e assumir o perfil concedido. |

Criar conta, cadastrar membro e conceder acesso são operações diferentes. Fazer login, sozinho, não dá acesso à igreja.

## 2. Repositório e acesso da QA

Repositório: [dgnoleto/escala-do-reino](https://github.com/dgnoleto/escala-do-reino). Sua visibilidade foi consultada em 11/10/2026 e é **privada**. A branch padrão é main.

O responsável precisará combinar e conceder o acesso da conta GitHub da QA. Nenhum convite de colaboração foi enviado nesta preparação. Ter acesso ao GitHub não concede acesso automático ao Supabase, ao piloto ou às contas de teste.

Se a QA trabalhar no computador atual do responsável, utilizar o checkout existente após identificar seu estado. Se trabalhar em outro computador, será necessário definir seu ambiente antes de executar: localhost aponta para o computador em que o navegador está aberto, e os contêineres daqui não acompanham automaticamente um clone do repositório. Não copiar credenciais, sessões ou banco do piloto como atalho.


No repositório privado pertencente a uma conta pessoal, colaboradores recebem leitura e escrita; não há papel de colaborador somente leitura. Se forem necessárias permissões mais específicas, avaliar uma organização. Essa decisão não está executada por este guia. [Permissões de conta pessoal](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/repository-access-and-collaboration/permission-levels-for-a-personal-account-repository).

Antes da primeira execução, registrar a versão do código, identificar a URL da interface e confirmar para qual backend ela aponta. A URL localhost, isoladamente, não prova que o banco é de teste.

## 3. Ordem de leitura

Os links abaixo são relativos ao repositório e acompanham a versão consultada. Registrar o commit lido ao usar estes documentos como base de uma rodada de QA.

| Ordem | Documento | Para que serve |
|---|---|---|
| 1 | [PRD](../PRD.md) | Problema, escopo, permissões, regras aprovadas e critérios M01–M64. |
| 2 | [Contrato de convites](../CONTRATO-CONVITES-ACESSO.md) | Regras de convites, estados, nome, recuperação e casos técnicos. Ler especialmente 2.1, 9 e 11. |
| 3 | [Cadastro de membros](../CADASTRO-MEMBROS.md) | Cadastro somente com nome, listagem, comandos e limites. |
| 4 | [Criação de igreja](../CRIACAO-IGREJA.md) | Elegibilidade, administração e proteção do último administrador. |
| 5 | [Consulta de acesso](../CONSULTA-ACESSO.md) e [Acesso e auditoria](../ACESSO-E-AUDITORIA.md) | Autorização e rastreabilidade. Conferir afirmações históricas contra o estado atualizado. |
| 6 | [Arquitetura do banco](../ARQUITETURA-BANCO.md) | Modelo e propostas técnicas; uma proposta não se torna regra aprovada por constar aqui. |
| 7 | [Evolução futura](../EVOLUCAO-FUTURA.md) | Assuntos adiados e limites do escopo atual. |

Consultar [schema de acesso](../SCHEMA-ACESSO.md), [schema de aprovação e auditoria](../SCHEMA-APROVACAO-AUDITORIA.md) e docs/sql somente quando o cenário exigir investigação técnica.

**Lacuna identificada na preparação de 11/10/2026:** o README ainda afirma que a interface e-mail/senha não foi implementada e que convites estão em preparação. O PRD também contém um parágrafo histórico de implementação com convites em preparação. O início do contrato de convites descreve sua origem como entrega documental, enquanto a seção 11 já descreve a interface integrada. As regras aprovadas continuam sendo referência; as declarações de andamento foram encaminhadas para atualização na [issue #10](https://github.com/dgnoleto/escala-do-reino/issues/10). Consultar seu andamento e o estado atual antes de tratar este registro histórico como uma pendência ainda aberta. Divergências não autorizam a IA a escolher ou criar uma nova regra: registrar a dúvida e validar com o responsável.

## 4. Estado de referência em 11/10/2026

| Item | Evidência e limite |
|---|---|
| PR #9 | Incorporado à main, conforme resumo de passagem conferido no encerramento anterior. Merge registrado: 84bf20fc4cda383ef7acdf033afbfb6bcb43e3a2. |
| Versão final revisada | ba852599a5b816cfab9d44161129eb87bec1ca99; árvore bbc4804395314f39609aa655dc0e496d5bbfdda8. |
| Checkout de desenvolvimento | Na conferência deste dia estava em docs/access-invitations-contract, no commit final revisado. Sua árvore é igual à do merge; não houve troca de branch. Isso não certifica limpeza global do checkout. |
| Interface em localhost:3000 | Seis arquivos relevantes servidos foram comparados com a revisão final. Entrada por convite sintético selecionou cadastro automaticamente na mesma aba; opção de login também observada. |
| Suíte final e build | O resumo de passagem registra 187 testes/25 suítes, quatro contraprovas de sessão e build aprovados. Não foram executados novamente nesta preparação. |
| Primeiro acesso completo em laboratório | Executado na revisão 40f87e, com escolha inicial manual de cadastro. Conta fictícia confirmada, convite retomado e nome confirmado, com acesso básico. O ajuste final ba852599 foi verificado separadamente na interface. |
| Piloto e publicação | Na conferência de 11/10/2026, a porta 3000 usava o backend do piloto. A validação visual sintética não prova cadastro/confirmação/resgate reais no piloto. Não há deploy do novo frontend demonstrado por esta entrega. |

Não transformar evidência parcial em aprovação geral do produto. Critério de aceite do PRD, caso planejado, teste automatizado e cenário real executado são registros diferentes.

## 5. Ambientes e serviços

| Ambiente | Papel | Tratamento |
|---|---|---|
| Piloto Supabase jvpctgqudvjealzileib | Backend da igreja piloto, Ministério Shalom. localhost:3000 apontava para ele na última conferência. | Não usar como destino automático de fixtures, novas contas ou ensaios. SQL exige autorização específica. |
| escala-convites-http-lab | Laboratório com Auth, banco, API e caixa de e-mail locais reais. Guarda dados e evidências dos ensaios recentes. | Referência para eventual continuação de QA de convites neste computador, depois de identificar serviços e contexto atual. |
| EscalaReinoLab | Supabase local anterior, preservado. | Não presumir que contém os mesmos dados ou a mesma versão do laboratório de convites. |
| escala-convites-lab-011-20261009 | Contêiner PostgreSQL de ensaios SQL anteriores; estava parado na consulta. | Não iniciar ou reutilizar automaticamente como substituto do laboratório HTTP. |

Referências locais do laboratório HTTP, sujeitas a reconferência: interface revisada em 3004, ponte de ensaio em 55341, gateway em 55331, banco em 55332 e Mailpit em 55334. A caixa local captura mensagens de teste; ela não demonstra entrega de e-mail a destinatários reais pelo piloto.

O Docker reúne vários programas separados, chamados contêineres. Banco, login, API e caixa de e-mail são serviços distintos agrupados por ambiente. Os dados persistentes exigem preservação; nomes parecidos não tornam ambientes equivalentes. Não iniciar contêineres antigos com sufixos binding-original/redirect-original junto aos atuais: foram retidos como evidência e podem compartilhar recursos.

Os serviços, contas, convites consumidos e prazos existentes devem ser mantidos. A fixture primeiro-acesso-c13fe48587@escala-lab.test já tem conta confirmada, acesso básico e convite consumido; não recriar ou renovar sua preparação por conveniência.

## 6. Regras centrais para QA

1. Cadastro básico de membro coleta apenas nome; não adicionar CPF ou e-mail a esse formulário.
2. O administrador informa o e-mail ao emitir convite para membro existente. Compartilha o link manualmente. E-mail Auth de confirmação/recuperação é outro fluxo.
3. O convite exige o e-mail confirmado correspondente, vale as 72 horas originais no servidor e é de uso único.
4. Primeiro acesso por convite oferece criação de conta com senha escolhida pela própria pessoa; quem já tem conta pode entrar ou recuperar a senha.
5. Criar conta não cria igreja, outro membro ou vínculo automaticamente. Confirmar o nome pelo convite concede acesso básico.
6. Propor outro nome mantém cadastro e acesso inalterados até aprovação; proposta e decisão respeitam o prazo original.
7. Reemissão cancela a solicitação antiga pendente e mantém o histórico. Rejeição encerra a tentativa; nova entrada exige novo convite.
8. Uma conta pode administrar no máximo uma igreja e ser membro de outra. Esse limite é por conta, não uma prova de identidade da pessoa entre e-mails.
9. A troca de igreja e de sessão deve impedir que respostas antigas restaurem dados ou privilégios anteriores.
10. Exclusão lógica e restauração são um incremento futuro; não exigir esses fluxos como se já estivessem entregues.

## 7. Rotina proposta e primeira sessão

Começar por leitura do guia e do PRD, escolhendo com o responsável um fluxo pequeno. Confirmar ambiente, versão e conta/papel. Consultar a evidência existente antes de repetir preparação ou execução. Se houver falha ou mudança nova, executar a reprodução mínima autorizada e registrar resultado esperado, observado e evidências. Uma hipótese de causa precisa ser distinguida da causa comprovada.

Usar o arquivo ROTEIRO-QA-E-REGISTRO.md desta pasta como proposta inicial. Não há nova bateria obrigatória definida nem testes executados por esses documentos.

Novos commits, push, merge, deploy e SQL no piloto dependem de autorização específica. Antigravity continua responsável pelas edições no checkout de desenvolvimento. Senhas são inseridas pela pessoa diretamente no destino; não devem ser pedidas ou copiadas para conversas, relatórios ou repositório. Não exportar tokens de sessão ou convites reais como evidência.

## 8. Texto inicial para uma IA que apoiar a QA

> Você está apoiando QA do Escala do Reino. Comece pelo guia de entrada e pelo PRD do repositório, registre a versão examinada e consulte somente os detalhes necessários. Separe regra aprovada, proposta futura, implementação e evidência de teste. Antes de executar, identifique a interface e o backend; localhost pode apontar para o piloto. Preserve laboratórios, contas, dados, convites e evidências. Não repita instalações, fixtures ou testes amplos sem falha ou mudança nova. Para cada achado, cite a regra, descreva reprodução mínima, esperado, observado e limite da evidência. Não peça nem registre senhas, tokens ou sessões. Antigravity edita o checkout de desenvolvimento; revisão e ensaios seguem o escopo combinado com o responsável. Novos commits, push, merge, deploy e SQL no piloto exigem autorização específica. Em divergência de requisitos, registre a dúvida para decisão do responsável, sem inventar comportamento.

## 9. Como continuar a partir dos documentos

Começar pelo [estado atual](../ESTADO-ATUAL.md), consultar as [issues abertas](https://github.com/dgnoleto/escala-do-reino/issues) e selecionar o documento de regra correspondente. O [mapa dos laboratórios](../ambientes/LABORATORIOS.md) ajuda a identificar o alvo de cada ensaio.

O [relatório da porta 3000](../historico/2026-10-11-verificacao-localhost-3000.md) e o [registro histórico da preparação de QA](../historico/2026-10-11-preparacao-qa.md) preservam o alcance da conferência feita neste dia. Sua data importa: uma pendência histórica pode ter sido resolvida depois. O [índice de documentação](../README.md) explica o processo de seleção de materiais por PR.

Os registros originais extensos permanecem no acervo local controlado do responsável. Este conjunto inclui versões portáveis e evidências selecionadas. Configurações, credenciais, scripts operacionais e a pasta inteira do laboratório não integram esta publicação.
