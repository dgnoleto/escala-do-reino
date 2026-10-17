# Estado atual — Escala do Reino

Atualização do checkpoint local: 17/10/2026. As versões de main e provas históricas abaixo conservam a data de sua conferência original. Este documento resume o estado conhecido e deve ser atualizado a cada entrega relevante. Relatórios históricos preservam os fatos de sua própria data; consultar também as issues abertas.

## Versão de referência

- Main remota conferida nesta preparação: `84bf20fc4cda383ef7acdf033afbfb6bcb43e3a2`, merge do [PR #9](https://github.com/dgnoleto/escala-do-reino/pull/9).
- Commit final revisado do PR #9: `ba852599a5b816cfab9d44161129eb87bec1ca99`.
- Árvore de código comum: `bbc4804395314f39609aa655dc0e496d5bbfdda8`.
- O [PR #8](https://github.com/dgnoleto/escala-do-reino/pull/8) havia incorporado o incremento de convites anteriormente. Estes identificadores são referência funcional anterior ao PR documental que contém este arquivo, não alegação de que main permanecerá nesse SHA.

## Entrega e validação conhecidas

| Tema | Evidência | Limite |
|---|---|---|
| Identidade, criação de igreja, membros e convites | Fluxos reais de acesso integrados, com regras documentadas no PRD e contratos. | Não representam toda a implementação de planejamento, condução ou mobile. |
| Primeiro acesso por convite | Cadastro com senha definida pela pessoa, alternativa de login, orientação de confirmação de e-mail e retomada do convite. | Criar conta não concede acesso automaticamente nem cria igreja ou outro membro. |
| Proteção de sessão e convite na mesma aba | Ajustes finais revisados no PR #9. | Contraprovas de sessão têm transporte controlado; não demonstram todas as corridas HTTP reais. |
| Suíte final e build | O fechamento do PR #9 registra 187 testes/25 suítes, quatro contraprovas de sessão e build aprovados. | Não foram reexecutados nesta preparação documental; aviso de bundle acima de 500 kB permanece. |
| Primeiro acesso real em laboratório | Cadastro, e-mail no Mailpit, retomada, confirmação de nome e acesso básico observados em `40f87e`, com seleção inicial manual. | A correção final `ba852599` foi verificada separadamente na interface, sem novo resgate. |
| Porta 3000 | Seis arquivos relevantes e interface inicial comparados/observados em 11/10. | Backend era o piloto; o identificador sintético não valida cadastro ou resgate real nele. |

Não há deploy do novo frontend demonstrado por esta entrega. PR #9 não altera SQL e não exige nova migração. O resumo de passagem registra a aplicação autorizada de 011 ao piloto em 10/10; esta preparação não reconsultou o banco nem executou SQL. Entrega de confirmação/recuperação por e-mail no piloto permanece sem validação demonstrada aqui.

## Organização documental e trabalho pendente

- [Issue #10](https://github.com/dgnoleto/escala-do-reino/issues/10): alinhar declarações de andamento no README, PRD e contrato, organizar guia de QA, mapa de ambientes e evidências portáveis.
- [Issue #18](https://github.com/dgnoleto/escala-do-reino/issues/18): **integração efetiva 016 com provas SQL, HTTP e jornada local aprovadas; revisão e integração final pendentes.** A cadeia 013/014/015 passou no laboratório descartável em 17/10, incluindo 19 cenários concorrentes da fonte e oito recusas de isolamento. O candidato 016 integra exclusão lógica, acesso da igreja, convites, solicitações, auditoria e recibo; alinha bloqueios dos escritores e preserva o instalador 013 canônico. A execução r016_d9387ecd40de8c64 aprovou dez grupos, incluindo dependências/histórico E20/E21, transferência prévia de liderança, restauração sem acesso, replay e atomicidade. ROLLBACK conferido nas 41 tabelas medidas da base descartável e em nove categorias de metadados; fonte preservado nas 34 tabelas medidas, dois gatilhos administrativos habilitados e descarte concluído. O lote integrado concluiu 42 disputas e vinte recusas de isolamento, com esperas reais entre PIDs distintos, incluindo ambas as ordens de dependências, convites/decisões, restauração, comando/revisão, exclusões cruzadas de administradores e perda de autorização durante espera. Dez casos foram preservados da execução r016_0a52e5f1511bf6fa e 32 concluídos em r016_5551a386b6e0cb98 após corrigir somente a chamada de teste de alocação. Fonte inalterado nas duas execuções e descarte confirmado. Até esse checkpoint concorrente, 016 havia sido confirmado somente nas bases descartáveis. **Checkpoint histórico de instalação, anterior à prova de aplicação:** após autorização específica, a cadeia 013/015/016 foi instalada com COMMIT único no banco postgres do laboratório HTTP existente. Ensaio prévio com ROLLBACK e comparação externa aprovados; 34 tabelas anteriores preservadas, sete tabelas novas vazias, 42 definições públicas coincidentes entre ensaio/aplicação/verificação e duas proteções administrativas habilitadas. A primeira tentativa parou antes do COMMIT por colisão de variável no wrapper de verificação; somente esse wrapper foi corrigido. Nesse checkpoint de instalação, Auth continuou parado e nenhuma conta ou fixture foi criada; HTTP e navegador ainda não haviam sido exercitados. O checkpoint posterior abaixo registra seu aceite, inclusive o complemento delimitado de E20/E21. Revisão e integração final continuam pendentes; a issue permanece aberta, sem liberação no piloto. [Histórico publicado](https://github.com/dgnoleto/escala-do-reino/issues/18#issuecomment-6232919231); [roteiro 016](sql/016_rehearsal_guide.md).

  **Checkpoint posterior de aplicação:** O lote autorizado de aplicação de 17/10/2026 aprovou A01–A14 no laboratório existente: Auth nativo, convites manuais, exclusão/restauração sem retorno de acesso, paginação, troca de igreja/conta, recuperação por comando/recibo original e recusa 42501 após perda de autoridade. A integração delimitada E20/E21 foi complementada por P0022/P0023 reais, transferência explícita de liderança, encerramento pela liturgia designada e histórico preservado. Não representa entrega da jornada de cultos. A12 usa contraprovas controladas de transporte; retenção e recarga complementam a queda de conexão que provocou reenvio automático idempotente.

  A primeira tentativa permanece reprovada por isolamento de sessão: três linhas anteriores de Auth foram alteradas e três registros Auth adicionais foram criados por renovação automática de sessão antiga; registros anteriores de aplicação preservados. A causa foi corrigida somente na cópia do laboratório, com chave SDK própria. A retomada e o encerramento preservaram o baseline posterior de 214 registros, 42 funções, duas proteções e 86 entradas de segurança; isso não apaga a falha do baseline original de 211 registros. Interfaces/ponte encerradas e Auth novamente parado. Dados fictícios e histórico da prova foram retidos. Piloto e porta 3000 não foram alterados; revisão/integração final e encerramento de #12/#18 continuam pendentes.
- Os guias iniciais foram aprovados pelo responsável para publicação. Essa aprovação não significa execução ou aprovação dos 12 cenários propostos, concessão de acesso à QA ou conclusão de toda a issue.
- Confirmar os critérios da issue no PR documental; se algum ficar pendente, manter seu acompanhamento explícito. Não fechar automaticamente apenas porque arquivos foram adicionados.
- Para a entrada da QA, combinar acesso GitHub e computador/ambiente de trabalho. O repositório é privado e não houve concessão de acesso nesta preparação.
- Exclusão lógica/recuperação permanecem na etapa 4. Ambientes sem integração efetiva continuam bloqueados por P0021; o candidato 016 mantém a recusa quando falta a fonte real. Restauração não devolve acesso. Não inferir CPF, envio automático de convites ou novos privilégios.

## Próximo passo de leitura

1. [Guia de entrada para QA](qa/GUIA-ENTRADA-QA.md).
2. [PRD](PRD.md) e [contrato de convites](CONTRATO-CONVITES-ACESSO.md), conforme o fluxo.
3. [Mapa de ambientes](ambientes/LABORATORIOS.md) antes de qualquer execução.
4. [Issues abertas](https://github.com/dgnoleto/escala-do-reino/issues?q=is%3Aissue%20is%3Aopen) para selecionar trabalho aprovado.
5. [Relatório da porta 3000](historico/2026-10-11-verificacao-localhost-3000.md) e [registro de preparação de QA](historico/2026-10-11-preparacao-qa.md) como evidências históricas.

Antigravity implementa no checkout de desenvolvimento; Codex revisa e conduz os ensaios autorizados. Preservar dados, contas, serviços e evidências existentes. O estado descrito não autoriza novas mutações, SQL, publicação ou deploy fora do escopo combinado.
