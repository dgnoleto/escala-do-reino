# Ambientes e laboratórios — Escala do Reino

Inventário de referência em 11/10/2026. Antes de executar qualquer ensaio, confirmar o ambiente e o backend efetivos. As referências de portas são específicas do computador atual e não constituem um instalador para outra máquina.

## Ambientes distintos

| Ambiente | Finalidade | Estado observado e limites |
|---|---|---|
| Piloto Supabase `jvpctgqudvjealzileib` | Backend da igreja piloto, Ministério Shalom. | A interface em localhost:3000 apontava para ele na conferência de 11/10. Não utilizar automaticamente para testes ou fixtures. |
| `escala-convites-http-lab` | Laboratório recente com Auth, API, banco e caixa de e-mail locais reais, usado nos ensaios pelo navegador. | Cinco serviços ativos na consulta Docker deste dia. Contas, igrejas, membros, convites e evidências existentes devem ser preservados. |
| `EscalaReinoLab` | Ambiente Supabase local anterior. | Preservado; não equivale ao laboratório HTTP de convites. Alguns serviços estavam parados ou reiniciando. |
| `escala-convites-lab-011-20261009` | Contêiner PostgreSQL de ensaios SQL anteriores. | Estava parado; não é o conjunto de Auth/API usado na jornada real de convites. |

O laboratório adicional foi montado para ensaiar convites com dados fictícios próprios, preservando o ambiente anterior. Docker não exige dois laboratórios: essa separação foi uma escolha de isolamento dos ensaios.

## Como ler o Docker

Um contêiner executa um serviço separado. Um grupo pode reunir banco, autenticação, API, gateway e caixa de e-mail. A linha com seta no Docker Desktop representa um agrupamento; expandi-la mostra seus serviços. Dados persistentes precisam ser preservados, e nomes semelhantes não provam equivalência entre ambientes.

Contêineres do laboratório HTTP com sufixos `binding-original` e `redirect-original` foram retidos parados após ajustes de preparação. Não iniciá-los junto aos serviços atuais: podem compartilhar recursos, inclusive o volume do banco. Nenhuma limpeza ou consolidação dos laboratórios foi feita por este documento.

## Referências operacionais do laboratório HTTP

| Referência | Papel |
|---|---|
| Porta 3004 | Interface isolada com a revisão final conferida anteriormente. |
| Porta 55341 | Ponte de ensaio que encaminha chamadas reais ao gateway. |
| Porta 55331 | Gateway Supabase local. |
| Porta 55332 | Banco local. |
| Porta 55334 | Mailpit, caixa local das mensagens Auth de teste. |

As origens e serviços precisam ser reconferidos, sem ler ou exportar credenciais. O Mailpit demonstra entrega local de teste; não comprova entrega de e-mail a membros reais no piloto.

## Preservação e continuidade

- Confirmar backend, versão da interface e contexto da conta antes do teste. `localhost` pode servir frontend conectado a banco remoto.
- A fixture de primeiro acesso já confirmada e seu convite consumido não devem ser renovados, apagados ou recriados. O guia de QA registra o identificador fictício para reconhecimento.
- Não repetir instaladores, preparadores ou ensaios amplos sem mudança ou falha nova. Um relatório histórico não autoriza reinstalação.
- SQL no piloto, deploy e novas operações de publicação exigem escopo autorizado. Senhas são inseridas pelo operador no destino, sem comunicação à IA.
- Se a QA usar outro computador, combinar primeiro seu ambiente. Clonar o repositório não transfere estes contêineres, volumes, contas ou sessões. Configuração e eventual backup protegido são assuntos separados; não publicar dumps ou credenciais neste acervo.

## Referências

- [Guia de entrada para QA](../qa/GUIA-ENTRADA-QA.md).
- [Estado atual](../ESTADO-ATUAL.md).
- [Conferência da porta 3000](../historico/2026-10-11-verificacao-localhost-3000.md).
- [Issue #10](https://github.com/dgnoleto/escala-do-reino/issues/10).

O relatório extenso de criação do laboratório HTTP, datado de 10/10, permanece no acervo local controlado. Ele registra falhas e pendências daquele momento, algumas resolvidas depois. Sua publicação futura exige seleção e confronto com as evidências posteriores; este inventário não o substitui como evidência de todos os ensaios.
