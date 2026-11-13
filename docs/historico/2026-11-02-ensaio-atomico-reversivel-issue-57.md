# Relatório Histórico — Ensaio Atômico Reversível da Cadeia SQL 023a + 023b + 025 (Issue #57)

## 1. Identificação e Governança

- **Data de execução e registro:** 02/11/2026.
- **Issue vinculada:** [#57 — [Segurança][SQL 025] Hardening de autorização, recibos e locks do planejamento](https://github.com/dgnoleto/escala-do-reino/issues/57).
- **Responsável final pelo produto (Humano):** Autoridade final e acolhimento formal da decisão.
- **Executor técnico:** Antigravity (execução local do ensaio T0–T2 e consolidação documental).
- **Orquestração e VCC:** ChatGPT.
- **Revisão técnica independente:** Codex.
- **Decisão humana expressa:** `APROVADO COM RESSALVAS` (acolhida em 02/11/2026).

---

## 2. Ambiente Observado

O ensaio foi conduzido no laboratório local pré-existente sob as seguintes coordenadas físicas observadas em 02/11/2026:
- **Contêiner Docker:** `supabase_db_escala-convites-http-lab`.
- **Container ID observado:** `2eba8f402a8e`.
- **Banco de dados descartável alvo:** `escala_rehearsal_024` (banco de dados isolado; a base `postgres` não recebeu conexões nem modificações).
- **Versão do PostgreSQL:** `PostgreSQL 17.11 on x86_64-pc-linux-gnu, compiled by gcc (GCC) 15.2.0, 64-bit`.
- **Papel e usuário da sessão:** `postgres` (`current_user = postgres`, `session_user = postgres`).
- **Database OID:** `198690`.
- **System Identifier:** `7695064938894594085`.

*Nota de governança:* Estes dados refletem exclusivamente o ambiente físico verificado no momento do ensaio histórico e não constituem garantia de estado idêntico para execuções futuras.

---

## 3. Artefatos Canônicos e Hashes de Entrada

Os arquivos do repositório utilizados na cadeia de preparação atômica apresentaram os seguintes tamanhos e hashes SHA-256 calculados sobre seus bytes brutos:

- `docs/sql/023a_event_planning_structural.sql`:
  - Tamanho: 5.196 bytes
  - SHA-256: `279BF22D5CDED8366D77236684C777378BC488A3A296E6C94CEBB1038DEE237E`
- `docs/sql/023b_event_creation_security_hardening.sql`:
  - Tamanho: 16.299 bytes
  - SHA-256: `634E21DC9D448529882721F3EE83B063BC56B8B442AA80716811A7B46FCD71B6`
- `docs/sql/025_event_planning_security_hardening.sql`:
  - Tamanho: 45.437 bytes
  - SHA-256: `48A572FF2F1EBDD26099DEFE9EFFA6BDB24AF41E5BDC552EAC67903116E5D3BF`
- `docs/sql/025_atomic_event_planning_installer.sql`:
  - Tamanho: 18.341 bytes
  - SHA-256: `EA2A8DDC32CC9E3D541FD330261FFA12E7D2C3D84911C58DA2CFB012EE432210`
- `tools/build-event-planning-atomic-rehearsal.js`:
  - Tamanho: 29.648 bytes
  - SHA-256: `11FA6FE962C9DF152BCF4F04FAD0D9C0AC5C8BB7BFC2F33BF4A4A54C68A18FFD`
- `test/event-planning-atomic-rehearsal.test.js`:
  - Tamanho: 27.333 bytes
  - SHA-256: `AD98A309DFD865FECB75610C68FA6CBE86DD1F1BF79ACDFB517A2B846D242A94`
- `test/event-planning-atomic-install.test.js`:
  - Tamanho: 22.936 bytes
  - SHA-256: `3EADC651A129D04B9C6B551046EC1FECC3F8E15E9F46BB2F3498C7117DD8E09B`

---

## 4. Payload Executado

O payload determinístico autocontido de ensaio reversível gerado pela ferramenta `tools/build-event-planning-atomic-rehearsal.js` apresentou:
- **Tamanho:** 86.423 bytes (2.034 linhas).
- **SHA-256:** `91DC01E71CE562F6AB4B32BB59D80884EC580789EEB1C298AA2A0BE25C2C9C2F`.
- **Controle Transacional:** Exatamente 1 `BEGIN`, 0 `COMMIT` e 1 `ROLLBACK` terminal.
- **Ordem de expansão in-memory:** `023a` → `023b` → `025`, substituindo integralmente os comandos `\ir` e sem deixar nenhuma diretiva `\ir` ou `\i` residual.

---

## 5. Rotinas e Nomes Canônicos das RPCs

O payload congelado sob SHA-256 `91DC01E7...` contém e gerencia exatamente as cinco seguintes RPCs de domínio:
1. `public.create_church_event_edition`
2. `public.reorder_event_items`
3. `public.set_event_duration_policy`
4. `public.publish_event_program`
5. `public.save_event_program_draft`

*Retificação formal:* Nomes divergentes presentes no relato preliminar inicial (`create_event_secure`, `update_event_planning_schedule`, `update_event_program_overview`, `publish_event_program_version`, `archive_event_program_version`) decorreram exclusivamente de erros de transcrição manual do redator e não existiam no payload executado nem foram emitidos pelo banco de dados. O transcript comprova somente o retorno das command tags genéricas (`CREATE FUNCTION`, `ALTER FUNCTION`, `REVOKE`, `GRANT`).

---

## 6. Etapa T0 — Baseline Inicial e Snapshot

Antes de qualquer execução do payload, a consulta preliminar ao banco `escala_rehearsal_024` comprovou:
- **Ausência de RPCs:** Todas as cinco rotinas de planejamento ausentes (`rpc1_exists = f`, `rpc2_exists = f`, `rpc3_exists = f`, `rpc4_exists = f`, `rpc5_exists = f`).
- **Ausência de recibos:** Tabela `app_private.event_planning_receipts` ausente (`receipts_table_exists = f`).
- **Ausência de colunas:** Nenhuma das cinco colunas de planejamento existia em `app_private.events` (`planning_columns_exist = f`).
- **Sessões ativas em `pg_stat_activity`:** Apenas a própria sessão do comando `psql` foi observada na amostragem pontual.
- **Snapshots e contagens:** Registrados integralmente no arquivo de saída `t0_output.txt` no recorte monitorado.

*Nota de contenção:* A inspeção de sessões representa uma leitura pontual no início de T0 e não constitui prova de isolamento contínuo contra escritores externos durante todo o intervalo da rodada.

---

## 7. Etapa T1 — Execução do Payload e Esclarecimento Operacional

### Esclarecimento sobre as tentativas de execução

1. **Primeira tentativa (falha local de parsing do shell no host):**
   - Comando executado via PowerShell gerou interrupção sintática imediata:
     ```text
     ParserError: AmpersandNotAllowed
     ```
   - Esta falha decorreu estritamente da interpretação de tokens pelo shell Windows PowerShell no host antes de criar qualquer subprocesso.
   - O utilitário `docker` **não** foi iniciado, o `psql` **não** abriu conexão e **nenhum byte** do payload foi transmitido ao PostgreSQL.
2. **Envio efetivo único:**
   - O payload foi submetido via `cmd /c` executando `docker exec -i supabase_db_escala-convites-http-lab psql -X -v ON_ERROR_STOP=1 -U postgres -d escala_rehearsal_024 -f /tmp/025_atomic_event_planning_rehearsal.sql`.
   - Houve exatamente **um único envio efetivo** ao PostgreSQL.

### Transcript de Execução T1 (`t1_output.txt`)

- **Tamanho:** 329 bytes (37 linhas).
- **SHA-256:** `180DB707FB7138D12A8CD3C64825FEA3C48EFD21A4826D6D5AED3C47F5025FE6`.
- **Conteúdo das command tags:**
  - Inicia com `BEGIN`.
  - Executa as configurações de lock e preflight fail-closed (`DO`).
  - Aplica as mutações estruturais (`ALTER TABLE`, `CREATE TABLE`).
  - Aplica hardening e cria as cinco funções (`CREATE FUNCTION`, `ALTER FUNCTION`, `REVOKE`, `GRANT`).
  - Executa notificação de reload (`NOTIFY`).
  - Alcança e satisfaz o bloco imperativo de pós-condições (`DO`).
  - Não apresenta nenhuma mensagem textual de erro ou aborto.
  - Encerra rigorosamente com `ROLLBACK`.

### Código de saída

- **Registro formal:** O código de saída real do processo `docker exec`/`psql` ficou indeterminado. Na cadeia utilizada, `%ERRORLEVEL%` foi expandido pelo `cmd.exe` antes de ficar vinculado ao término do `docker exec`/`psql`; o comando `echo` executado ao final também impediu que o código externo da cadeia servisse como prova do retorno do processo de banco. Portanto, o texto `EXIT_CODE: 0` não comprova o código de saída do `psql`.
- A aceitação técnica decorre do transcript completo de 37 linhas, da execução bem-sucedida do bloco `DO` de pós-condições de catálogo, da presença da tag terminal `ROLLBACK` e da paridade documental comprovada em T2, e **não** de qualquer valor numérico impresso de exit code.

---

## 8. Etapa T2 — Comparação de Catálogos e Paridade Proporcional

O snapshot de saída após o rollback (`t2_output.txt`) foi confrontado com o snapshot inicial (`t0_output.txt`):
- `t0_output.txt`: 157.358 bytes, 1.020 linhas, SHA-256 `063CC55E03EB2BDB89E57D3CB89A614D94B9DF294D4E56B9F81C2E498C6E40C0`.
- `t2_output.txt`: 157.358 bytes, 1.020 linhas, SHA-256 `31F9C8C0195E4C2DBC8003B44DADF30CE625F04370E65F6CEDBE89AEF4A185D4`.

A comparação direta caractere a caractere identificou que **exatamente duas linhas** diferem entre os arquivos:
1. **Linha 9:** Coluna `server_timestamp` na consulta de identificação temporal.
2. **Linha 19:** Colunas `pid`, `backend_start` e `xact_start` na consulta pontual de `pg_stat_activity`.

As outras 1.018 linhas dos arquivos brutos são rigorosamente idênticas.

**Conclusão de Paridade Proporcional:**
> Delta zero no conjunto de catálogos, metadados, contagens e fingerprint monitorados; os arquivos brutos diferem somente nas duas linhas voláteis de identidade temporal das sessões T0 e T2.

---

## 9. Snapshot Auxiliar de Leitura

O arquivo auxiliar de consulta de catálogo preservado no diretório de ensaio apresenta:
- **Nome:** `t0_snapshot.sql`
- **Tamanho:** 7.535 bytes
- **Formatação de linha:** 217 caracteres LF, zero caracteres CR, terminando com LF.
- **SHA-256:** `AC7C5C2320572615A93EB7C96ADB832FE65B8D55B8F0C85D11E82CA4E5C0C8F2`.

*Nota sobre histórico de conferência:* O hash `090424E7...62BACB6` (7.534 bytes) registrado no inventário preliminar correspondia ao mesmo conteúdo sem o caractere LF terminal. A diferença de um byte no final do script SQL de leitura não alterou a semântica de nenhuma consulta executada; as menções preliminares a 196 linhas e formatação CRLF decorreram de erro na rotina de contagem do relato inicial.

---

## 10. Desvios Operacionais Registrados

Durante a condução do ensaio, foram constatados os seguintes desvios operacionais de procedimento:
1. **Captura de exit code inválida:** Avaliação de `%ERRORLEVEL%` no mesmo comando em lote do `cmd.exe`, deixando o código numérico real de retorno indeterminado nos registros brutos.
2. **Inventário preliminar impreciso do snapshot:** Descrição inicial de contagem de linhas e hash de `t0_snapshot.sql` gerada antes da estabilização da quebra de linha terminal do arquivo auxiliar.
3. **Caminhos não exclusivos no contêiner:** Transferência dos artefatos para `/tmp/t0_snapshot.sql` e `/tmp/025_atomic_event_planning_rehearsal.sql` sem incluir sufixo temporal exclusivo nos nomes dentro do contêiner.

*Avaliação de risco e resolução:* O hash SHA-256 do payload no contêiner foi conferido antes da execução e coincidiu byte a byte com o hash autorizado (`91dc01e7...c2f`), não havendo evidência de colisão ou sobreposição indevida. O desvio de caminho reduz a proteção defensiva contra concorrência interna em `/tmp` e deve ser evitado em ensaios futuros. Não haverá repetição retrospectiva do ensaio apenas para sanar esses registros documentais.

---

## 11. Inventário de Artefatos Temporários Preservados

Os arquivos brutos continuam preservados nos caminhos abaixo e **nenhuma limpeza foi autorizada**:

- **Diretório no Host:**
  `C:\Users\user\AppData\Local\Temp\escala-rehearsal-57-2026-11-02T09-26-58-948Z`
  - `025_atomic_event_planning_rehearsal.sql` (86.423 bytes, SHA-256 `91DC01E71CE562F6AB4B32BB59D80884EC580789EEB1C298AA2A0BE25C2C9C2F`)
  - `t0_snapshot.sql` (7.535 bytes, SHA-256 `AC7C5C2320572615A93EB7C96ADB832FE65B8D55B8F0C85D11E82CA4E5C0C8F2`)
  - `t0_output.txt` (157.358 bytes, SHA-256 `063CC55E03EB2BDB89E57D3CB89A614D94B9DF294D4E56B9F81C2E498C6E40C0`)
  - `t1_output.txt` (329 bytes, SHA-256 `180DB707FB7138D12A8CD3C64825FEA3C48EFD21A4826D6D5AED3C47F5025FE6`)
  - `t2_output.txt` (157.358 bytes, SHA-256 `31F9C8C0195E4C2DBC8003B44DADF30CE625F04370E65F6CEDBE89AEF4A185D4`)
- **Arquivos no Contêiner (`supabase_db_escala-convites-http-lab`):**
  - `/tmp/025_atomic_event_planning_rehearsal.sql`
  - `/tmp/t0_snapshot.sql`

*Nota de governança:* Nenhum artefato foi copiado para dentro do repositório Git. O diretório temporário externo não constitui arquivo histórico permanente do repositório; seu eventual descarte ou retenção futura permanece condicionado a decisão expressa do responsável.

---

## 12. Deliberação Humana e Decisão Formal

- **Decisão:** `APROVADO COM RESSALVAS`
- **Alcance estrito da decisão:** A aprovação aplica-se exclusivamente ao processamento mecânico do pacote atômico em PostgreSQL 17.11, à validação das guardas de preflight e pós-condições imperativas em catálogo durante a transação, ao `ROLLBACK` observado no transcript e à ausência de delta residual no conjunto de catálogos monitorado.

---

## 13. Limites e Não Autorizações

Declara-se expressamente que este ensaio técnico monossessão delimitado **NÃO autorizou nem comprovou**:
- Código de saída real igual a zero no sistema operacional;
- Integridade global de tabelas e catálogos fora do conjunto monitorado;
- Execução funcional ou regras de negócio das cinco RPCs nesta rodada (os 10 cenários funcionais S01–S10 não foram reexecutados);
- Isolamento temporal contínuo contra escritores externos;
- Concorrência de múltiplas sessões ou disputa de locks em runtime;
- Instalação persistente de migrations no laboratório permanente ou no piloto (nenhum `COMMIT`);
- Validação HTTP, camada PostgREST ou recarga efetiva por `NOTIFY pgrst`;
- Armazenamento ou políticas de Storage;
- Homologação de ponta a ponta ou aceite de produto;
- Encerramento formal da [Issue #57](https://github.com/dgnoleto/escala-do-reino/issues/57);
- Liberação do Gate 3 global ou do pacote R7 da [Issue #58](https://github.com/dgnoleto/escala-do-reino/issues/58) (ambos permanecem formalmente em **NO-GO**).

---

## 14. Próximos Passos Recomendados

1. Não repetir o ensaio T0–T2 com o único propósito de recuperar o exit code do shell, uma vez que o encerramento do transcript com `ROLLBACK` e a paridade de T2 fornecem evidência técnica suficiente da reversão transacional.
2. Tratar instalação permanente, validação de concorrência multi-sessão, integração HTTP/PostgREST e publicação em branch/PR como frentes de trabalho estritamente separadas, cada qual dependente de plano próprio e autorização prévia e expressa do responsável pelo produto.
3. Manter a [Issue #58](https://github.com/dgnoleto/escala-do-reino/issues/58) pausada até definição expressa de sua retomada.

