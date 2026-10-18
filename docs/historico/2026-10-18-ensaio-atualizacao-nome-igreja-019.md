# Ensaio SQL 019 — atualização do nome da igreja

Data: 18/10/2026. Autorização do responsável: executar o ensaio SQL do candidato 019 sob ROLLBACK em base descartável isolada dentro do contêiner local existente. Nenhum contêiner foi criado, iniciado ou reiniciado. Nenhuma instalação permanente foi feita nos bancos existentes ou no piloto.

## Alvo e preparação

- Contêiner reutilizado: `supabase_db_EscalaReinoLab`, PostgreSQL 17.11.
- Base descartável da execução: `escala_name019_2ae7c4d43ea1`, criada com proprietário `postgres` e removida imediatamente ao terminar.
- Estrutura de base: clone exclusivo de schema do banco `postgres` de `supabase_db_EscalaReinoLab` (que possui o incremento 017 instalado e validado). Nenhum dado, conta ou arquivo físico foi copiado.
- Verificação de virgindade da base: 0 usuários em `auth.users`, 0 igrejas em `app_private.churches`, 0 objetos em `storage.objects`.
- Execução do instalador e dos testes: papel `postgres`, com casos de cliente executados sob `authenticated` simulando tokens dos usuários das fixtures temporárias.
- Candidato exato: `docs/sql/019_church_name_update.sql`, SHA256 `b238e9bfeb8ebdf3c146962159ca531f53f6814b341add5f21a6477e03c152fa`.
- Artefato de ensaio: `node_modules/.cache/church-name-update-rehearsal.sql`, SHA256 `2ad22d4f233dcdae8883b1fac70541efeb77d2e264db7a8adb66b00b6bab7f5e`.

O instalador foi inserido na transação sem seu `COMMIT`; os testes foram seguidos de `ROLLBACK` e verificação de resíduos por conexão independente.

## Resultados dos Casos de Ensaio (N01–N13)

A execução concluiu com código de saída 0 e emissão da confirmação: `NOTICE: N01–N13 aprovados com sucesso.`

| Caso | Cenário validado | Resultado observado |
|---|---|---|
| **N01** (CA01) | Membro comum da mesma igreja tenta atualizar nome | Recusado com `42501` |
| **N02** (CA01) | Administrador de outra igreja tenta atualizar nome da igreja alheia | Recusado com `42501` |
| **N03** (CA02) | Nome vazio ou contendo apenas espaços em branco | Rejeitado com `23514` |
| **N04** (CA02) | Nome excedendo o limite de 160 caracteres | Rejeitado com `23514` |
| **N05** (CA02, CA03, CA05, CA07) | Atualização com trim e normalização Unicode NFC | Gravado com sucesso, `profile_revision` incrementado para 1 |
| **N06** (CA07) | Auditoria de alteração de nome | Registrado `previous_name`, `new_name`, ator e timestamps em `audit_entries` |
| **N07** (CA06, CA07) | Replay idempotente do mesmo comando | Retorna recibo original sem incrementar revisão e sem duplicar auditoria/recibo |
| **N08** (CA06) | Reuso do mesmo `command_id` com parâmetros divergentes | Rejeitado com `23505` |
| **N09** (CA06) | Conflito de concorrência (`expected_revision` desatualizada) | Rejeitado com `40001` |
| **N10** (Compatibilidade) | Sobrecarga de 6 parâmetros | Preserva o nome atual e atualiza os demais campos (`profile_revision` = 2) |
| **N11** (CA01) | Perda de administração durante o ciclo | Bloqueia escrita e bloqueia replay subsequente com `42501` |
| **N12** (Transição 017→019) | Replay de recibo legado gerado no 017 (sem chave `name`) | Reconhecido sem `23505`; divergência real de dados rejeitada |
| **N13** (Concorrência 6 params) | Replay de comando de 6 parâmetros após renomeação posterior | Reconhecido com a revisão original sem `23505` e preservando o nome posterior |

## ROLLBACK e Preservação

1. **Contraprova pós-ROLLBACK:** Consulta independente na base descartável confirmou ausência de resíduos:
   - 0 usuários de teste (`name019_%`).
   - 0 igrejas com nome de teste.
   - 0 recibos gerados no ensaio.
2. **Remoção da Base:** A base efêmera `escala_name019_2ae7c4d43ea1` foi dropada via `drop database`, e o inventário de bancos de dados anterior foi verificado idêntico.
3. **Comparação de Baseline Before/After:** Snapshot de contagens e hashes de todas as tabelas em `app_private`, `auth` e `storage` do banco de origem `supabase_db_EscalaReinoLab` resultou em 100% de coincidência (`sources_preserved: true`).

Registros de execução retidos em `node_modules/.cache/name019-2ae7c4d43ea1/report.json`.
