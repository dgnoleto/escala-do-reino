# Aceite do ciclo de vida efetivo — candidato 016

> **Checkpoint posterior de aplicação (17/10/2026):** O lote autorizado de aplicação de 17/10/2026 aprovou A01–A14 no laboratório existente: Auth nativo, convites manuais, exclusão/restauração sem retorno de acesso, paginação, troca de igreja/conta, recuperação por comando/recibo original e recusa 42501 após perda de autoridade. A integração delimitada E20/E21 foi complementada por P0022/P0023 reais, transferência explícita de liderança, encerramento pela liturgia designada e histórico preservado. Não representa entrega da jornada de cultos. A12 usa contraprovas controladas de transporte; retenção e recarga complementam a queda de conexão que provocou reenvio automático idempotente. A primeira tentativa permanece reprovada por isolamento de sessão: três linhas anteriores de Auth foram alteradas e três registros Auth adicionais foram criados por renovação automática de sessão antiga; registros anteriores de aplicação preservados. A causa foi corrigida somente na cópia do laboratório, com chave SDK própria. A retomada e o encerramento preservaram o baseline posterior de 214 registros, 42 funções, duas proteções e 86 entradas de segurança; isso não apaga a falha do baseline original de 211 registros. Interfaces/ponte encerradas e Auth novamente parado. Dados fictícios e histórico da prova foram retidos. Piloto e porta 3000 não foram alterados; revisão/integração final e encerramento de #12/#18 continuam pendentes.

> **Checkpoint posterior de instalação no laboratório (17/10/2026):** Após autorização específica, a cadeia 013/015/016 foi instalada com COMMIT único no banco postgres do laboratório HTTP existente. Ensaio prévio com ROLLBACK e comparação externa aprovados; 34 tabelas anteriores preservadas, sete tabelas novas vazias, 42 definições públicas coincidentes entre ensaio/aplicação/verificação e duas proteções administrativas habilitadas. A primeira tentativa parou antes do COMMIT por colisão de variável no wrapper de verificação; somente esse wrapper foi corrigido. Auth continuou parado; nenhuma conta ou fixture foi criada. HTTP, navegador, integração final e piloto permanecem fora deste aceite. Não reaplicar os instaladores sobre esse alvo. As instruções abaixo descrevem o ensaio descartável histórico e seu escopo original.

Checkpoint SQL anterior de 17/10/2026: primeira prova SQL reversível 016 aprovada em dez grupos (r016_d9387ecd40de8c64). ROLLBACK, comparação e descarte confirmados; fonte inalterado. Concorrência integrada aprovada em 42 disputas e vinte recusas de isolamento, somente em bases descartáveis do contêiner existente. HTTP/navegador ainda não haviam sido executados naquele checkpoint. Issues #12/#18 abertas. Base local inicial: 250880eddb7779a6725f3647b67cc95242e33aca.

> **Rastreabilidade do aceite de aplicação:** [resultado e ressalvas na #18](https://github.com/dgnoleto/escala-do-reino/issues/18#issuecomment-6241397089) e [revisão documental na #12](https://github.com/dgnoleto/escala-do-reino/issues/12#issuecomment-6241400431). A tentativa original continua `FAIL_SESSION_ISOLATION_RECOVERED`; o PASS posterior sobre 214 registros não comprova preservação integral do baseline original de 211. SMTP real, provedores externos, timeout HTTP sob carga e resposta incerta da criação de membro não receberam novo aceite neste lote. Os roteiros 013 e a matriz antiga são históricos; não autorizam separar E20/E21 nem reinstalar fixtures.

## Primeira prova reversível executada — procedimento preservado

Usar apenas o contêiner já existente supabase_db_escala-convites-http-lab, identidade fixada no pacote anterior (banco publicado 55332), sem iniciar ou criar serviços. O banco fonte postgres é somente leitura para baseline e cópia de schema nativo. Criar uma base descartável própria, vazia e marcada, no mesmo contêiner; restaurar o schema preservando os owners nativos com supabase_admin somente nessa base; aplicar os pré-requisitos 013/015 apenas nela. Não copiar dados ou contas do banco fonte.

Conferir ausência prévia do alvo e registrar OID, owner e marca da execução. Comparar o baseline do fonte antes/depois e manter habilitados os dois gatilhos de continuidade. Nenhuma limpeza de objetos de outra execução. Encerrar somente sessões próprias antes de descartar a base por identidade positiva, sem FORCE.

Executar 016_preflight_member_lifecycle_effective.sql, registrar baseline da base de prova e executar 016_validate_member_lifecycle_effective.sql com erro fatal interrompendo o cliente. O validador contém o instalador integral dentro da mesma transação das fixtures e encerra com ROLLBACK. Comparar dados e definições/ACLs após o retorno e após qualquer erro. Não instalar 016 permanentemente nessa primeira prova.

As fixtures/as chamadas RPC usam identidades fictícias, o papel authenticated e os predicados reais das funções; observações privadas são feitas pelo dono da base, sem grants ao cliente. As falhas de auditoria e recibo são injetadas por triggers adicionais temporários, sem desabilitar as proteções existentes. Senhas/tokens reais não são utilizados.

## Critérios cobertos pelo validador executado

- Exclusão efetiva de membro com acesso, convite aberto válido, solicitações válida/expirada e tentativas históricas; preservação da conta Auth e de outra igreja.
- Mesma chave/revisão devolve o recibo original; chave divergente recusa; estado/revisão obsoletos recusam; replay após restauração não inativa novamente.
- Acesso previamente revogado preserva todos os campos; restauração não reabre convites, solicitações ou acesso; legado inativo com acesso ativo mantém P0018.
- Recusas de não administrador, conta sem sessão, outra igreja, autoexclusão e revisão divergente. Recibo não concede autorização atual.
- E20: liderança ativa de ministério, liturgia, escala, responsabilidade nominal e evento com horário expirado sem encerramento formal bloqueiam. Condução/encerramento pela liturgia designada.
- E21: evento encerrado, escala e referências nominais permanecem íntegros após exclusão dos membros; nenhum histórico apagado.
- Criações recusam responsável inativo; ausência da fonte continua P0021. Outro administrador pode ser inativado com sucessor, e o gatilho impede remover o último elegível.
- Falha na auditoria e falha no recibo revertem membro/acesso/convites/solicitações/auditorias/recibos integralmente.

## Aceites adicionais obrigatórios antes do fechamento

O lote concorrente autorizado foi executado: 42 disputas com ambos os vencedores, esperas observadas por pg_blocking_pids, PIDs distintos e conferência final de dados/recibos/auditorias; vinte recusas de isolamento. Inclui controles positivos e revogação/inelegibilidade durante espera. Dez casos aprovados foram preservados e os 32 restantes executados após corrigir a ordem de parâmetros de uma chamada do teste, sem alterar o SQL de produto. Bases próprias e temporários removidos; fonte comparado nas duas execuções. Naquele checkpoint, o próximo aceite obrigatório era HTTP e jornada real; o checkpoint posterior no início deste documento registra a execução.

Roteiro histórico da etapa seguinte, agora executada no lote A01–A14: prova HTTP de COMMIT com resposta perdida e reconciliação; jornada no navegador com recarga/filtros/paginação, troca de conta/igreja, exclusão e restauração sem acesso. Identificar frontend/backend reais antes do teste, preservar a porta 3000 e o piloto. Instalação permanente, commit/push/PR/merge/deploy e encerramento continuam autorizações distintas.

## Retomada e continuidade

Preservar os instaladores 007/011/013/015 e os aceites não afetados. As substituições estão integralmente em 016. A preservação do hash canônico de 013 é conferida antes de aplicar a cópia local. Se uma prova falhar, corrigir o defeito demonstrado e repetir apenas as provas afetadas e a regressão pertinente. Não abrir outro ciclo de plataforma de ensaio como requisito do produto.
