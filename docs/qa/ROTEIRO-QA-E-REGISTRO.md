# Escala do Reino — roteiro inicial de QA e registro de achados

Roteiro inicial preparado em 11/10/2026 e aprovado pelo responsável como documentação; seleção e execução dos casos serão combinadas com a QA. Não representa execução, aprovação de cenários ou autorização para criar dados no piloto. A seleção dos casos deve considerar mudanças, risco e evidência existente.

## Preparação de uma rodada

Registrar commit/branch, URL da interface, backend, data, navegador, papel das contas fictícias, precondições e autorização da execução. Conferir o guia de entrada. Não presumir que a conta já confirmada e o convite consumido do laboratório possam repetir uma jornada de primeiro acesso.

Os Mxx pertencem ao PRD. Os QAxx abaixo são identificadores deste roteiro; não substituem nem renumeram o PRD. Confirmar os detalhes no contrato de convites antes da rodada.

| Caso proposto | Referência | Resultado esperado | Evidência mínima / condição |
|---|---|---|---|
| QA01 — Login sem vínculo | M01 | Autenticar não libera dados de igreja nem privilégios escolhidos pelo usuário. | Tela observada e contexto da conta; não confundir acesso existente com login isolado. |
| QA02 — Convite chega à tela já aberta sem sessão | Contrato §11.1 / ajuste final PR #9 | Seleciona primeiro acesso automaticamente, mostra criação e confirmação de senha; escolha posterior por login continua disponível. | Tela antes/depois e versão; identificador sintético só comprova apresentação, não validade ou resgate real. Já observado em 11/10. |
| QA03 — Cadastro e confirmação em outra aba | Contrato §11.1 / PR #9 | Pessoa define senha no destino, confirma e-mail e retoma convite; cadastro isolado não libera igreja. | Ensaio no laboratório, se nova execução for necessária e autorizada. Separar etapa visual, Auth e resgate. Não registrar senha/link de confirmação. |
| QA04 — Conta divergente | Contrato §11.1 | Bloqueia consulta/resgate sem revelar igreja, membro ou destinatário; convite não é consumido. | Mensagem neutra e, quando autorizada, leitura independente do estado. |
| QA05 — Confirmação de nome cadastrado | PRD §3.1 / contrato §2.1 | Concede vínculo básico com membro existente, sem duplicação ou privilégio administrativo. | Tela de membro e verificação independente autorizada de vínculo, recibo e auditoria. |
| QA06 — Proposta de outro nome | M52 / contrato §2.1 | Solicitação pendente, nome original preservado e sem acesso antecipado. | Tela e estado autorizado antes/depois, sem acessar dados de outra igreja. |
| QA07 — Reemissão/rejeição | PRD §3.1 / contrato §2.1 | Reemissão cancela pendência antiga e mantém histórico; rejeição encerra tentativa; nova entrada exige novo convite. | Cenários separados, dados identificados e prazos originais preservados. |
| QA08 — Expiração | PRD §3.1 / contrato §§2.1 e 4 | Apresentação ou aprovação no vencimento/depois não concede acesso nem estende prazo. | Instantes do servidor e caso de limite; não alterar datas de fixtures preservadas para facilitar teste. Preparação dedicada depende de escopo. |
| QA09 — Administração em A e acesso básico em B | M60–M61 | Privilégios de A não acompanham a conta para B; seleção explícita e ausência de dados antigos. | Igreja/papel visíveis e cenário de troca; HTTP real e transporte controlado têm alcances diferentes. |
| QA10 — Resposta antiga após logout/login | Correção de sessão PR #9 | Consulta anterior não restaura identidade ou acesso superados. | Reprodução dirigida ao mecanismo alterado. As contraprovas existentes usam transporte controlado e não provam toda corrida HTTP. |
| QA11 — Cadastro básico de membro | M62 | Coleta somente nome, sem CPF e sem e-mail no formulário; não cria conta ou acesso. | Campos e resultado do cadastro no laboratório, se execução for necessária. |
| QA12 — Confirmação perdida após sucesso | Contrato §5 / recuperação | Recupera resultado do mesmo comando por recibo, sem duplicar registros; emissão não recupera token bruto perdido nem reemite silenciosamente. | Exige ensaio controlado autorizado. Usar evidência de sucesso real no servidor e recuperação; mensagem de UI isolada não comprova. |

Critérios de outros incrementos, como M55–M59 de criação/administração, podem integrar uma rodada quando houver mudança relacionada. M63–M64 de exclusão/restauração continuam futuros. Planejamento, condução e mobile não devem ser declarados aprovados pelos casos desta tabela.

## Modelo de achado

```text
Título:
Tipo: defeito / dúvida de requisito / divergência documental / melhoria proposta
Impacto e prioridade sugerida:
Ambiente e backend:
Commit/branch:
Data, navegador e conta/papel fictício:
Regra ou critério: documento, seção/ID e versão lida
Precondições:
Passos mínimos:
Resultado esperado:
Resultado observado:
Frequência de reprodução:
Evidência sanitizada:
Hipótese de causa, se houver:
O que a evidência permite concluir:
O que ainda precisa ser validado:
Dados alterados e estado deixado ao final:
```

Anexar telas que permitam entender o resultado, sem senha, token de sessão, link completo de convite/recuperação ou dados reais desnecessários. Separar hipótese de causa comprovada. Uma falha de consulta não deve ser registrada como prova de inexistência de dados.

## Modelo de resultado da rodada

```text
Objetivo e mudança que motivou a rodada:
Ambiente/backend e commit:
Casos selecionados e motivo:
Resultado por caso: aprovado / reprovado / bloqueado / não executado
Evidência por caso:
Achados e dúvidas:
Limitações:
Contas, dados e serviços preservados:
Próximo passo exato:
```

Bloqueado significa que a execução não conseguiu demonstrar o resultado. Não executado não equivale a aprovado. Quantidade de testes automatizados não deve ser apresentada como cobertura integral do PRD.

