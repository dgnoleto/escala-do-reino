# Aceite do ciclo de vida efetivo — candidato 016

> **Checkpoint posterior de instalação no laboratório (17/10/2026):** Após autorização específica, a cadeia 013/015/016 foi instalada com COMMIT único no banco postgres do laboratório HTTP existente. Ensaio prévio com ROLLBACK e comparação externa aprovados; 34 tabelas anteriores preservadas, sete tabelas novas vazias, 42 definições públicas coincidentes entre ensaio/aplicação/verificação e duas proteções administrativas habilitadas. A primeira tentativa parou antes do COMMIT por colisão de variável no wrapper de verificação; somente esse wrapper foi corrigido. Auth continuou parado; nenhuma conta ou fixture foi criada. HTTP, navegador, integração final e piloto permanecem fora deste aceite. Não reaplicar os instaladores sobre esse alvo. As instruções abaixo descrevem o ensaio descartável histórico e seu escopo original.

Estado em 17/10/2026: primeira prova SQL reversível 016 aprovada em dez grupos (r016_d9387ecd40de8c64). ROLLBACK, comparação e descarte confirmados; fonte inalterado. Concorrência integrada aprovada em 42 disputas e vinte recusas de isolamento, somente em bases descartáveis do contêiner existente. HTTP/navegador ainda não executados para 016. Issues #12/#18 abertas. Base local inicial: 250880eddb7779a6725f3647b67cc95242e33aca.

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

O lote concorrente autorizado foi executado: 42 disputas com ambos os vencedores, esperas observadas por pg_blocking_pids, PIDs distintos e conferência final de dados/recibos/auditorias; vinte recusas de isolamento. Inclui controles positivos e revogação/inelegibilidade durante espera. Dez casos aprovados foram preservados e os 32 restantes executados após corrigir a ordem de parâmetros de uma chamada do teste, sem alterar o SQL de produto. Bases próprias e temporários removidos; fonte comparado nas duas execuções. O próximo aceite obrigatório é HTTP e jornada real.

Depois, prova HTTP de COMMIT com resposta perdida e reconciliação; jornada no navegador com recarga/filtros/paginação, troca de conta/igreja, exclusão e restauração sem acesso. Identificar frontend/backend reais antes do teste, preservar a porta 3000 e o piloto. Instalação permanente, commit/push/PR/merge/deploy e encerramento continuam autorizações distintas.

## Retomada e continuidade

Preservar os instaladores 007/011/013/015 e os aceites não afetados. As substituições estão integralmente em 016. A preservação do hash canônico de 013 é conferida antes de aplicar a cópia local. Se uma prova falhar, corrigir o defeito demonstrado e repetir apenas as provas afetadas e a regressão pertinente. Não abrir outro ciclo de plataforma de ensaio como requisito do produto.
