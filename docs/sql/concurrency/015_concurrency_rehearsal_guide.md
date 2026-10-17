# Concorrência 015: autoridade após espera e substituição única

Preparação local revisada em 17/10/2026. Nenhuma prova concorrente física foi executada nesta etapa. O aceite de cadastro simples da versão anterior permanece registrado; não é aprovação automática desta candidata.

## Alvo e isolamento

- Reutilizar o contêiner `supabase_db_escala-convites-http-lab`, ID `2eba8f402a8e42f5b9c6a895a38717f0e06605be7ad970f1cf622dd83bd8b8ff`, imagem `sha256:0450166354dc9c1d25f0322ac8b580774d4fb0184d2b087f6e4fe9499c66cf53`.
- Banco permanente existente: `postgres`, publicado em **127.0.0.1:55332**. A porta 54321 é API de outra pilha e não deve ser usada.
- As provas com COMMIT devem usar exclusivamente a base **descartável** `escala_rehearsal_015`, no mesmo contêiner, usuário `postgres`, por socket local/porta interna 5432. `postgres` nunca é destino de instalação comprometida do 015, fixtures concorrentes ou descarte.
- Criar um `run_id` único no formato `r015_` seguido de 16 hexadecimais; registrar no manifesto e no comentário da base: `escala-rehearsal-015:<run_id>`. Todas as sessões exigem esse marcador, usuário, banco, transporte e encoding por `015_concurrency_guard.sql`.
- A criação, restauração, COMMIT e descarte dessa base dependem de autorização específica. Não criar contêiner, modificar papéis globais, reiniciar serviços ou alterar o piloto.

## Provisionamento e pré-requisitos da prova física

O procedimento deve ser executado em etapas, com cada código de saída conferido:

1. Revalidar a identidade do contêiner. Registrar baseline lógico do banco permanente `postgres` e confirmar que `escala_rehearsal_015` não existe; não reutilizar nem sobrescrever uma base preexistente.
2. Produzir um dump **somente de schema**, sem dados, da estrutura nativa já aprovada no banco `postgres`, usando o `pg_dump` instalado no contêiner. Não capturar usuários, senhas ou tokens. Preservar definições, constraints, ACLs e owners disponíveis; não provisionar papéis globais. Não substituir Auth nativo por um simulador.
3. Criar `escala_rehearsal_015` e restaurar apenas esse schema; marcar a propriedade com o comentário de execução. Se houver erro de restauração ou pré-requisito ausente, parar, preservar o diagnóstico e descartar somente a base comprovadamente criada por esta execução. Não instalar dependências ou alterar o banco fonte para contornar falhas.
4. Conferir schema-base, ausência de identidades/igrejas e candidato, roles existentes e gatilhos administrativos. Rodar `015_preflight_liturgical_dependencies.sql`, depois o validador reversível corrigido `015_validate_liturgical_dependencies.sql`; exigir os resultados e ROLLBACK. Conferir baseline dessa base após o validador.
5. Somente com validação aprovada, instalar a candidata `015_liturgical_dependencies.sql` **nessa base descartável**, executar `015_verify_liturgical_dependencies.sql` e exigir todos os indicadores TRUE. Congelar hashes de todos os arquivos usados.
6. Para cada cenário abaixo, usar uma base novamente provisionada sem dados anteriores. O descarte/reprovisionamento é explícito e identificado; não limpar fixtures por DELETE, não desativar gatilhos e não reutilizar estado produzido por um controle positivo.

Os arquivos com `\ir` devem existir juntos no filesystem do cliente `psql`. Para execução por Docker, copiar o pacote congelado para uma pasta temporária identificada pelo run_id dentro do contêiner e invocar `psql -f` nessa pasta. Não encaminhar esses arquivos isolados pelo stdin sem expandir seus includes. A cópia deve preservar hashes; não copiar segredos ou dados da aplicação.

## O que muda na autoridade

O 015 possui 15 RPCs de mutação e sete consultas. O lock consultivo `(user_id, command_id)` serializa idempotência; não protege revogação administrativa.

Nas quatro operações afetadas, a consulta completa de acesso/Auth/igreja/membro e a decisão de papel agora ficam depois de todos os locks explícitos do caminho. `remove_team_member` também adquire, em ordem de ID, os locks das aptidões que será necessário desativar. Mantida a ordem dos recursos de negócio: membros → equipe → evento/item quando aplicável → vínculo → função/aptidão → alocação.

As quatro funções são explicitamente VOLATILE e recusam contextos que não sejam READ COMMITTED, com 42501 e indicação do contexto exigido. Assim, uma transação com snapshot fixo não pode contornar a revalidação. A decisão final antecede os efeitos de produto; não se promete cancelar uma operação por uma revogação que só ocorra depois dessa decisão. Não introduzir uma nova ordem members→church_access por locks de acesso que conflite com os escritores existentes.

A leitura atual continua antes do replay; um recibo anterior não concede acesso. As provas abaixo não cobrem todos os possíveis escritores de Auth, alterações globais, DDL ou a integração 016.

Referências técnicas: [locks de linha e ordem de aquisição](https://www.postgresql.org/docs/17/explicit-locking.html), [isolamento de transações](https://www.postgresql.org/docs/17/transaction-iso.html), [snapshots em funções VOLATILE](https://www.postgresql.org/docs/17/xfunc-volatility.html).

## Prova de autoridade durante a espera

Fixtures comuns: `015_concurrency_fixtures.sql`, executado uma vez como operador privilegiado, com `-v run_id=<id>`. Esse script exige base vazia e registra autoria e concedente nos membros/acessos fictícios. O administrador permanece elegível; o operador das RPCs é o líder não administrador.

| checkpoint | Operação | Lock retido pela sessão C |
|---|---|---|
| assign_membership | Alocar | Vínculo do voluntário 3 |
| assign_role | Alocar | Função da equipe |
| assign_qualification | Alocar | Aptidão do voluntário 3 |
| replace_membership | Substituir | Vínculo do voluntário 2 |
| replace_qualification | Substituir | Aptidão do voluntário 2 |
| replace_assignment | Substituir | Alocação original |
| remove_membership | Remover integrante | Vínculo do voluntário 3 |
| remove_qualification | Remover integrante | Aptidão do voluntário 3 |
| revoke_qualification | Revogar aptidão | Aptidão do voluntário 3 |

Para cada checkpoint, realizar duas provas em bases limpas: negativo (`revoke=on`, `expect=deny`) e controle (`revoke=off`, `expect=allow`). Iniciar C e, após a mensagem LOCK TARDIO RETIDO, iniciar A em até 30 segundos. Manter sessões independentes e registrar os dois códigos de saída e logs.

Invocações no contêiner, com valores reais registrados no manifesto (exemplo para um checkpoint):

```text
docker exec -i <container-id-confirmado> psql -X -w -v ON_ERROR_STOP=1 -U postgres -d escala_rehearsal_015 -v run_id=<id> -f <pasta-do-pacote>/015_concurrency_fixtures.sql
docker exec -i <container-id-confirmado> psql -X -w -v ON_ERROR_STOP=1 -U postgres -d escala_rehearsal_015 -v run_id=<id> -v checkpoint=replace_assignment -v revoke=on -f <pasta-do-pacote>/015_authority_wait_session_c.sql
docker exec -i <container-id-confirmado> psql -X -w -v ON_ERROR_STOP=1 -U postgres -d escala_rehearsal_015 -v run_id=<id> -v checkpoint=replace_assignment -v expect=deny -f <pasta-do-pacote>/015_authority_wait_session_a.sql
```

C retém o lock, limpa o snapshot de observação, exige um único PID de A no mesmo banco e comprova a espera de linha/transação por `pg_blocking_pids`. Só depois revoga o acesso com **status, revoked_at e revoked_by_user_id**, em COMMIT que libera o lock. A deve retomar e recusar com 42501; timeout, deadlock ou sucesso indevido são FAIL. No controle sem revogação, a chamada deve concluir e produzir exatamente um recibo e uma auditoria.

O PASS exige ambos os logs: `WAIT_OBSERVED` na sessão C e `PASS_AUTHORITY_WAIT` na A, códigos 0 e inspeções de acesso, recibos, auditoria, vínculos, aptidões e alocações. Um 42501 isolado não comprova que a chamada chegou ao lock tardio. Também executar `015_authority_isolation.sql` para exigir recusa das quatro operações em REPEATABLE READ e SERIALIZABLE, sem efeitos persistidos.

## Dupla substituição A/B

Em outra base limpa e com candidato aprovado, iniciar `015_concurrency_session_a.sql` e depois `015_concurrency_session_b.sql`, ambos com o mesmo `-v run_id=<id>` e `psql -X -w -v ON_ERROR_STOP=1` no banco descartável. A monta as fixtures comuns, substitui e, após RESET ROLE, exige observar B bloqueada diretamente por ela no mesmo banco antes de COMMIT. B precisa receber P0020 com menção à alocação já substituída.

Exigir os dois códigos 0, barreira real, original `replaced`, exatamente um substituto ativo, ponteiros recíprocos, um recibo da vencedora, nenhum da perdedora, uma auditoria de substituição e gatilhos habilitados. As comparações finais são seguras para NULL. Não aceitar execução sequencial como prova concorrente.

## Encerramento seguro

O descarte nunca recebe um banco arbitrário. A identidade externa deve coincidir com o manifesto e o nome deve ser exatamente `escala_rehearsal_015`; comentário e owner devem corresponder à base criada nesta execução. Na divergência, parar sem descartar. Não fornecer `dropdb postgres`, variável livre de nome nem encerramento indiscriminado de sessões.

Encerrar e comprovar o fim apenas dos clientes desta execução. Conectado à base administrativa `postgres`, revalidar o marcador e descartar somente `escala_rehearsal_015`, sem FORCE. Se restarem sessões ou falhar a exclusão, relatar a base remanescente e a causa; não ampliar a limpeza. Remover apenas a pasta temporária criada para o run_id depois de salvar os logs.

Ao final, confirmar ausência da base descartável e comparar o baseline lógico do banco permanente. Registrar resultados por cenário e limites. Instalação permanente, HTTP/navegador, integração 016, E20/E21, GitHub e fechamento das issues permanecem fora deste ensaio.
