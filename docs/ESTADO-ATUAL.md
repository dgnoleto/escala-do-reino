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
- [Issue #18](https://github.com/dgnoleto/escala-do-reino/issues/18): **integração efetiva 016 candidata local com primeira prova SQL reversível aprovada; concorrência integrada, HTTP e jornada ainda pendentes.** A cadeia 013/014/015 passou no laboratório descartável em 17/10, incluindo 19 cenários concorrentes da fonte e oito recusas de isolamento. O candidato 016 integra exclusão lógica, acesso da igreja, convites, solicitações, auditoria e recibo; alinha bloqueios dos escritores e preserva o instalador 013 canônico. A execução r016_d9387ecd40de8c64 aprovou dez grupos, incluindo dependências/histórico E20/E21, transferência prévia de liderança, restauração sem acesso, replay e atomicidade. ROLLBACK conferido nas 41 tabelas medidas da base descartável e em nove categorias de metadados; fonte preservado nas 34 tabelas medidas, dois gatilhos administrativos habilitados e descarte concluído. Ainda exige corridas de exclusão/continuidade/convites, HTTP e navegação real. E20/E21 e a issue permanecem abertos. [Histórico publicado](https://github.com/dgnoleto/escala-do-reino/issues/18#issuecomment-6232919231); [roteiro 016](sql/016_rehearsal_guide.md).
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
