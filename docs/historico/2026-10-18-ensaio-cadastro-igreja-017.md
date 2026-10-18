# Ensaio SQL 017 — cadastro da igreja

Data: 18/10/2026. Autorização do responsável: utilizar um contêiner Docker já existente para o ensaio local com ROLLBACK. Nenhum contêiner foi criado, iniciado ou reiniciado. Nenhuma instalação permanente foi feita nos bancos existentes ou no piloto.

## Alvo e preparação

- Contêiner reutilizado: `supabase_db_escala-convites-http-lab`, PostgreSQL 17.11.
- Base descartável da execução final: `escala_settings017_2ebec94ab5d3`, criada com proprietário `postgres` e removida ao terminar.
- Estrutura da aplicação/Auth: cópia somente de schema do banco `postgres` do mesmo contêiner.
- Estrutura nativa do Storage: cópia somente de schema de `supabase_db_EscalaReinoLab`, pois o laboratório HTTP não tinha suas tabelas. Proprietários, privilégios, funções e gatilhos nativos foram preservados na cópia. Não foram copiados registros nem arquivos de nenhum dos ambientes.
- Execução do instalador e dos testes: papel `postgres`, com casos de cliente executados como `authenticated` e `anon`.
- Instalador exato: `docs/sql/017_church_settings.sql`, SHA256 `06e1843dbcd72dd230a4237879635fcc74fd8cdff1a7d0a3136c40617db80a08`.
- Artefato de ensaio final: SHA256 `22b190f9f4209432396304a23627d6236c842338b9d4ff3e61ef77b2616cce0f`.

O instalador foi inserido na transação sem seu `COMMIT`; os testes foram seguidos de `ROLLBACK` e de verificação por uma conexão independente.

## Resultados

Os blocos S01–S14 e S15–S22 concluíram com PASS e saída zero do `psql`:

| Cobertura | Resultado observado |
|---|---|
| Cadastro administrativo | Admin consulta e atualiza; membro e admin de outra igreja recebem 42501. |
| Idempotência | Reenvio do mesmo comando retorna revisão original sem duplicar auditoria ou recibo. |
| Edição desatualizada | Nova alteração com revisão vencida recebe 40001. Esse caso é sequencial, sem duas sessões concorrentes. |
| Perda de administração | Consulta e replay são recusados após retirada da administração, preservando outro admin elegível. |
| Validações do servidor | Host falso, referência a outra igreja, objeto inexistente e MIME recusado são rejeitados. |
| Storage/RLS | Inserção de metadados autorizada para admin da própria igreja e recusada para membro, anônimo e admin de outra igreja. |
| Políticas permissivas antigas | Uma política de teste com `USING(true)` e `WITH CHECK(true)` não abriu o bucket protegido. |
| Consulta de logo | Membro lê somente o objeto atualmente referenciado da própria igreja; não lê logos antigas ou de outra igreja. Anônimo não lê. |
| Preservação de outros buckets | A guarda não alterou a política permissiva de teste de um bucket diferente. |
| Imutabilidade e remoção | Cliente não sobrescreve/apaga os metadados dos objetos; remover a referência preserva o objeto e bloqueia nova leitura dele pelo membro. |
| Grants e proprietários | Tabela/helper privados sem acesso direto de cliente; funções novas pertencem a `postgres`. |

Há uma tentativa intermediária reprovada por preparação da base: o banco descartável havia sido criado com proprietário `supabase_admin`, fazendo `public` pertencer efetivamente a essa conta e impedindo criação de função pelo papel `postgres`. A preparação passou a conservar o proprietário `postgres` do banco de origem. A tentativa reprovada encerrou a conexão, removeu sua base e confirmou os dois bancos de origem preservados; a execução final acima aprovou o candidato. Não foram adicionados privilégios aos papéis existentes.

## ROLLBACK e preservação

A conexão independente confirmou zero usuários, igrejas e buckets na base descartável, ausência do recibo/função novos e ausência das políticas `church_logos%`. A base foi então removida e o inventário original de bancos foi conferido.

Os snapshots antes/depois compararam contagens e hashes do conteúdo de **todas** as tabelas de `app_private`, `auth` e `storage` disponíveis em cada origem, além do hash do dump completo de schema, incluindo funções, proprietários, políticas, gatilhos e privilégios. Os dois bancos de origem coincidiram integralmente. O dump foi normalizado apenas para remover os marcadores aleatórios `\restrict`/`\unrestrict` do `pg_dump`.

| Origem | Tabelas medidas | Linhas medidas | Antes/depois |
|---|---:|---:|---|
| `supabase_db_escala-convites-http-lab` | 41 | 442 | Coincidentes |
| `supabase_db_EscalaReinoLab` | 44 | 210 | Coincidentes |

Registros operacionais permanecem no acervo local ignorado pelo Git: `node_modules/.cache/settings017-2ebec94ab5d3/`, com relatório, snapshots, schemas somente estruturais, artefato SQL, saída e mensagens. Os relatórios não imprimem linhas de usuários, senhas ou tokens. A publicação desse acervo não está autorizada.

## Limites e próximo passo

Esta prova valida SQL e políticas RLS contra os schemas nativos disponíveis; as inserções em `storage.objects` representam somente metadados. Não houve upload/assinatura/download de arquivos físicos pelo serviço Storage, jornada de navegador, teste HTTP ou concorrência entre conexões.

O frontend local continua apontando para o Supabase do piloto; `.env.local` não foi alterado. A instalação permanente em laboratório, concorrência e validação funcional com arquivo real são os próximos passos, mediante autorização própria. Nenhuma aplicação no piloto foi realizada neste trabalho.
