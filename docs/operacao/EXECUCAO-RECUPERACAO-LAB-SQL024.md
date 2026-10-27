# Manual de Execução e Conferência da Recuperação do Laboratório (SQL 024)

> **STATUS DO DOCUMENTO: CANDIDATOS CORRIGIDOS (CONTRATO 1.1) — NÃO EXECUTADO**  
> Este manual consolida o ferramental candidato e o protocolo operacional para execução das fases de backup lógico, restauração atômica e confronto canônico do banco de dados descartável `escala_rehearsal_024` em atendimento ao **Critério 4 da Issue #58**, incorporando as correções dos grupos **R1 a R7** apontadas na revisão técnica independente do Codex.  
> **Nenhuma etapa operacional foi executada nesta rodada.** Todos os scripts foram elaborados e submetidos exclusivamente à conferência estática de sintaxe no Windows PowerShell 5.1, aguardando nova apreciação técnica independente pelo Codex e deliberação do responsável pelo produto.

---

## 1. Visão Geral do Pacote Candidato (Contrato Versão 1.1)

O pacote é composto por quatro artefatos canônicos coesos e desacoplados, implementando fielmente o [Plano de Recuperação](PLANO-RECUPERACAO-LAB-SQL024.md) e as correções da revisão independente:

```
├── tools/
│   ├── recovery-sql024.ps1         # Executor determinístico com guardas R1, snapshot explícito R2, drenagem assíncrona R5 e compatibilidade PS 5.1 R6
│   └── compare-recovery-sql024.ps1 # Comparador canônico ordinal por identidades estáveis, completude de hashes R4 e contrato 1.1 R3
└── docs/
    ├── sql/
    │   └── 024_recovery_manifest.sql   # Catálogo estrutural dinâmico 1.1 (extensões, tipos, views, sequences, RLS unnest) e gerador de hashes com sql_nulls
    └── operacao/
        ├── PLANO-RECUPERACAO-LAB-SQL024.md     # Plano conceitual aprovado tecnicamente pelo Codex
        └── EXECUCAO-RECUPERACAO-LAB-SQL024.md  # Este manual operacional
```

---

## 2. Princípios de Governança e Inicialização Segura

1. **Modo Padrão Passivo (`-Phase Plan`):**  
   A invocação direta de `tools/recovery-sql024.ps1` sem parâmetros ou com `-Phase Plan` não estabelece conexões ao banco, não invoca o Docker, não cria diretórios de evidências no host e não modifica qualquer recurso. Apresenta exclusivamente o resumo de parâmetros, salvaguardas e instruções de execução.  
   *Nota de Governança:* A execução de qualquer candidato, inclusive em modo `Plan`, **não está autorizada nesta rodada** (estritamente preparação e conferência estática de código).
2. **Separação Rígida de Fases e Obrigatoriedade de Run ID (R1 / R5):**  
   Não há avanço automático ou encadeamento cego entre as fases. Fases posteriores (`CreateVerifyDb`, `RestoreVerify`, `CompareManifests`, `DropVerifyDb`, `CleanupContainerDumps`) exigem obrigatoriamente a passagem do parâmetro `-ExecutionRunId <ID>` e validam a existência de metadados íntegros da tentativa anterior antes de qualquer operação.
3. **Proteção e Procedência de Recursos (R1):**  
   - O banco principal local `postgres` é estritamente protegido; atua unicamente como conexão de manutenção de controle de cluster para emissão de comandos administrativos DDL no catálogo global.
   - O banco efêmero `escala_recovery_verify_024` tem seu OID registrado imediatamente na criação (`verify_db_metadata.json`). As fases de restauração e descarte conferem se o OID do banco no cluster corresponde estritamente ao OID registrado nesta execução, recusando operar sobre recursos de procedência desconhecida ou homônimos.
   - O piloto remoto Supabase (`jvpctgqudvjealzileib`), os demais laboratórios locais e os volumes de Storage permanecem inacessíveis e intocados.
4. **Preservação Irrestrita de Evidências (R5):**  
   Diante de qualquer falha (código de saída diferente de zero, divergência de hash, encerramento anormal da Sessão 1 ou erro de restauração), todos os artefatos locais (`scratch/backups-lab/<run-id>/`), logs e arquivos no contêiner são integralmente preservados para perícia técnica. Dumps parciais são marcados como inválidos em `session_metadata.json` e impedidos de restauração. É terminantemente proibido executar limpeza automática (`rm -f`) em cenários de erro.

---

## 3. Especificação das Fases Operacionais

```
+-----------------------------------------------------------------------------------+
| Fase 0: Plan (Modo Padrão Passivo - Nenhuma Ação Externa)                         |
+-----------------------------------------------------------------------------------+
                                          │
                                          ▼ (Autorização Expressa)
+-----------------------------------------------------------------------------------+
| Fase 1: GuardOrigin (Auditoria de OID 198690, Cluster SysId e Repouso Operacional) |
+-----------------------------------------------------------------------------------+
                                          │
                                          ▼ (Autorização Expressa)
+-----------------------------------------------------------------------------------+
| Fase 2: Backup                                                                    |
|  - Sessão 1: Transação REPEATABLE READ READ ONLY e pg_export_snapshot()           |
|  - Extração do Manifesto sob o MESMO snapshot (catálogo + dados com sql_nulls)   |
|  - Sessão 2: pg_dump -Fc sincronizado (--snapshot)                               |
|  - Monitoramento de PID da Sessão 1 (se cair: pkill remoto no contêiner e retenção|
|    do dump parcial marcado como inválido em session_metadata.json)               |
|  - Transferência bidirecional contêiner -> host -> contêiner (SHA-256 e stat)     |
|  - Inspeção do índice interno TOC (pg_restore --list)                             |
+-----------------------------------------------------------------------------------+
                                          │
                                          ▼ (Autorização Expressa)
+-----------------------------------------------------------------------------------+
| Fase 3: CreateVerifyDb (Criação de escala_recovery_verify_024 e Registro de OID)  |
+-----------------------------------------------------------------------------------+
                                          │
                                          ▼ (Autorização Expressa)
+-----------------------------------------------------------------------------------+
| Fase 4: RestoreVerify                                                             |
|  - Validação de dump_valid e reconfirmação de hash antes do restore              |
|  - Validação de OID criado no cluster vs. verify_db_metadata.json                |
|  - pg_restore atômico (--single-transaction --exit-on-error) com drenagem async  |
+-----------------------------------------------------------------------------------+
                                          │
                                          ▼ (Autorização Expressa)
+-----------------------------------------------------------------------------------+
| Fase 5: CompareManifests                                                          |
|  - Extração do manifesto restaurado sob sessão padronizada idêntica               |
|  - Comparação ordinal via compare-*.ps1 (12 vetores + completude de hashes)      |
+-----------------------------------------------------------------------------------+
                                          │
                                          ▼ (Autorização Expressa e Aprovação do PO)
+-----------------------------------------------------------------------------------+
| Fase 6: DropVerifyDb (Conferência de procedência por OID e Descarte Seguro)      |
+-----------------------------------------------------------------------------------+
                                          │
                                          ▼ (Autorização Expressa e Homologação Final)
+-----------------------------------------------------------------------------------+
| Fase 7: CleanupContainerDumps (Limpeza no Contêiner via -ConfirmCleanupContainer) |
+-----------------------------------------------------------------------------------+
```

---

## 4. Pré-Condições Técnicas Obrigatórias

Antes de qualquer execução operacional futura, as seguintes condições devem estar satisfeitas:
1. **Ambiente Host:** Windows PowerShell 5.1 no diretório raiz `D:\Github\escala-do-reino`.
2. **Contêiner Oficial Ativo:** `supabase_db_escala-convites-http-lab` em execução (`State.Running = true`).
3. **Guardas de Identidade da Origem:**
   - Nome: `escala_rehearsal_024`;
   - OID Histórico: `198690`;
   - Cluster System Identifier: `7695064938894594085`.
4. **Repouso Operacional Comprovado:** Consulta passiva a `pg_stat_activity` retornando exatamente 0 conexões concorrentes ativas em `escala_rehearsal_024`.
5. **Espaço em Disco:** Disponibilidade de espaço no volume local `scratch/` e em `/tmp` do contêiner.

---

## 5. Roteiro de Comandos para Execuções Futuras

> **IMPORTANTE:** Os comandos abaixo são propostas estruturadas para execução futura, condicionadas a autorizações formais. Não executar sem autorização expressa do responsável pelo produto.

### 5.1 Apresentação do Planejamento (Passivo)
```powershell
# Exibição do plano e salvaguardas locais (sujeito a autorização de execução)
powershell -NoProfile -ExecutionPolicy Bypass -File tools/recovery-sql024.ps1 -Phase Plan
```

### 5.2 Fase 1: Conferência das Guardas da Origem
```powershell
# Audita OID, SysId e repouso operacional de escala_rehearsal_024
powershell -NoProfile -ExecutionPolicy Bypass -File tools/recovery-sql024.ps1 -Phase GuardOrigin
```

### 5.3 Fase 2: Extração de Backup e Prova do Artefato
```powershell
# Extrai o backup sob snapshot exportado e executa a prova bidirecional do artefato
$RunId = (Get-Date -Format "yyyyMMdd-HHmmss")
powershell -NoProfile -ExecutionPolicy Bypass -File tools/recovery-sql024.ps1 -Phase Backup -ExecutionRunId $RunId
```
*Saídas geradas em `scratch/backups-lab/$RunId-escala_rehearsal_024/`:*
- `escala_rehearsal_024.dump` (dump binário custom);
- `escala_rehearsal_024.dump.sha256` (hash SHA-256 verificado);
- `dump_toc.txt` (índice interno inspecionado via `pg_restore --list`);
- `origin_manifest.json` (catálogo estrutural 1.1 e hashes com `sql_nulls`);
- `session_metadata.json` (identificador do snapshot, status `dump_valid` e telemetria).

### 5.4 Fase 3: Criação do Banco Efêmero de Validação
```powershell
# Confere ausência de colisão, cria escala_recovery_verify_024 e registra OID
powershell -NoProfile -ExecutionPolicy Bypass -File tools/recovery-sql024.ps1 -Phase CreateVerifyDb -ExecutionRunId $RunId
```
*Saída gerada:*
- `verify_db_metadata.json` (registro formal de `created_oid`, banco e timestamp UTC).

### 5.5 Fase 4: Restauração Atômica no Banco de Teste
```powershell
# Valida procedência, reconfirma hash e restaura o artefato reimportado no banco efêmero
powershell -NoProfile -ExecutionPolicy Bypass -File tools/recovery-sql024.ps1 -Phase RestoreVerify -ExecutionRunId $RunId
```

### 5.6 Fase 5: Extração do Manifesto Restaurado e Comparação Canônica
```powershell
# Extrai o catálogo do banco restaurado e executa a comparação determinística
powershell -NoProfile -ExecutionPolicy Bypass -File tools/recovery-sql024.ps1 -Phase CompareManifests -ExecutionRunId $RunId
```
*Saídas geradas:*
- `restored_manifest.json` (catálogo e hashes do banco restaurado sob contrato 1.1);
- `comparison_report.md` (relatório analítico ordinal de paridade dos 12 vetores + completude).

### 5.7 Fase 6: Descarte Controlado do Banco Efêmero
```powershell
# Confere OID registrado em verify_db_metadata.json e descarta escala_recovery_verify_024
powershell -NoProfile -ExecutionPolicy Bypass -File tools/recovery-sql024.ps1 -Phase DropVerifyDb -ExecutionRunId $RunId -ConfirmDropVerifyDb
```

### 5.8 Fase 7: Limpeza dos Dumps Internos no Contêiner
```powershell
# Remove os arquivos /tmp/*.dump do contêiner conferindo código de saída (exige flags explícitas)
powershell -NoProfile -ExecutionPolicy Bypass -File tools/recovery-sql024.ps1 -Phase CleanupContainerDumps -ExecutionRunId $RunId -ConfirmCleanupContainer
```

---

## 6. Critérios de Parada e Protocolos de Falha

| Evento de Falha | Ponto de Controle | Ação Automática do Executor | Tratamento de Evidências |
| :--- | :--- | :--- | :--- |
| **Divergência de Identidade** | Fase `GuardOrigin` / Pré-Backup | Aborta imediatamente antes de qualquer leitura ou cópia. | Nenhuma evidência gerada; cluster intocado. |
| **Violação de Repouso** | Fase `GuardOrigin` / Pré-Backup | Aborta se `activeCount > 0` em `pg_stat_activity`. | Registra conexões detectadas em log; aborta. |
| **Queda da Sessão 1 (Snapshot)** | Durante o `pg_dump` | Interrompe o processo local e emite `pkill` remoto no contêiner. | **Retém o dump parcial**, registra `dump_valid = false` e `status = ABORTED_DUE_TO_SESSION1_DROP` em `session_metadata.json`. Impede restauração. Não apaga arquivos. |
| **Divergência no Trânsito Contêiner -> Host** | Pós-transferência host | Compara tamanho e SHA-256; aborta se divergir. | Preserva o arquivo no contêiner e a cópia no host para perícia. Não sobrescreve. |
| **Divergência na Reimportação Host -> Contêiner** | Pós-transferência contêiner | Compara tamanho e SHA-256 com o manifesto do host; aborta se divergir. | Preserva todos os arquivos físicos. |
| **Invalidação Pré-Restore** | Fase `RestoreVerify` | Aborta se `dump_valid != true` ou se hash atual divergir. | Operação não iniciada; banco de teste permanece vazio. |
| **Divergência de OID de Destino** | Fase `RestoreVerify` / `DropVerifyDb` | Aborta se OID atual do banco divergir de `created_oid`. | Bloqueia restauração ou descarte sobre bancos homônimos não criados nesta execução. |
| **Falha no `pg_restore`** | Restauração no Verify DB | `--single-transaction` emite rollback automático; `$LASTEXITCODE != 0`. | Registra erro formalmente em `pg_restore_execution.log`. Preserva dumps e banco para auditoria. |
| **Divergência no Confronto Canônico** | `compare-recovery-sql024.ps1` | Encerra com ExitCode 1. Emite detalhamento das diferenças. | Gera `comparison_report.md` com as divergências apontadas. Banco de teste permanece ativo para inspeção. |

---

## 8. Detalhamento Técnico das Correções (Rodadas Anteriores e Quinta Rodada)

### 8.1 Correções Reconhecidas e Aceitas (F1, F2 e F3 Preservados)
1. **F1 (Consumo do Gerador de Hash no Contrato Canônico):**
   - Preservado o consumo de `$gen.table_hash_query` com checagem estrita de propriedades em `tools/recovery-sql024.ps1`.
2. **F2 (Cobertura de Sequências e Rejeição de Falso PASS por Ausência):**
   - Preservada a extração de `cache_size` no SQL (`pg_sequences.seqcache`) e no comparador, bem como a emissão de divergência bloqueando o PASS caso `last_value` seja ausente ou NULL em qualquer lado.
3. **F3 (Preservação de Arrays Vazios em Expressões Condicionais):**
   - Preservada a sintaxe canônica `@(if (...) { ... })` e a discriminação de chaves ausentes em `tools/compare-recovery-sql024.ps1`.

### 8.2 Resolução dos Resíduos da Quinta Rodada (Achados F4, F5 e F6)
Em atendimento estrito à 5ª rodada de revisão independente do Codex (`REVISAO-CANDIDATOS-RECUPERACAO-SQL024-QUINTA-RODADA.md`):

1. **F4 Residual (Contrato de Identidade e Procedência Estrita de Ponta a Ponta):**
   - Em `tools/compare-recovery-sql024.ps1`: `execution_run_id` e `database_name` tornaram-se obrigatórios em **ambos** os manifestos (origem e restaurado). A ausência, vacuidade ou divergência entre eles bloqueia a comparação imediatamente (ExitCode 2). Quando `-ExpectedRunId`, `-ExpectedOriginDb` ou `-ExpectedRestoredDb` são informados, a validação exige coincidência estrita com os manifestos.
   - Em `tools/recovery-sql024.ps1`:
     - O campo `dump_valid` exige tipo booleano JSON estrito (`-is [bool] -and $dump_valid -eq $true`), evitando que strings como `"false"` sejam falsamente aceitas pelo PowerShell em conversões implícitas.
     - Na fase `RestoreVerify`: além dos nomes e caminhos, o `origin_oid` gravado na sessão é confrontado estritamente contra o OID autorizado da origem (`198690`), com validação de tipo numérico.
     - Na fase `CompareManifests`: a procedência é validada integralmente antes da extração de dados. O `created_oid` do banco efêmero é consultado e conferido contra o catálogo `pg_database` do cluster; toda a identidade da sessão (`origin_oid`, `origin_database`, `container_name`, `system_identifier`) e o `dump_valid` booleano são validados contra os parâmetros autorizados.
     - Em `DropVerifyDb` e `CleanupContainerDumps`: `created_oid` e `dump_valid` exigem tipos estritos (numérico > 0 e booleano JSON), impedindo avanço com metadados truncados ou corrompidos.
2. **F5 Residual (Diferenciação entre Docker e Comando Remoto; Script via STDIN e Registro Fiel da Parada):**
   - **Transporte Seguro via STDIN (`sh -s`):** O transporte anterior via `sh -c` (com aspas simples/interpolação na linha de comando) foi substituído pelo envio do script de observação via `StandardInput` para `docker exec -i $ContainerName sh -s`, com normalização de quebras de linha para LF puro (`\n`).
   - **Isolamento do Shell Observador:** A linha de comando do shell observador no sistema operacional do contêiner é estritamente `sh -s`, sem conter o `$DumpTarget` em seus argumentos (`/proc/<pid>/cmdline`), garantindo que o próprio shell observador nunca seja correspondido pelo `pgrep`.
   - **Captura Imediata do Retorno de `pgrep`:** O código de saída do `pgrep` é capturado imediatamente (`rc=$?`):
     - `rc == 0`: Processo encontrado $\rightarrow$ emite `PROCESS_RUNNING`;
     - `rc == 1`: Nenhum processo correspondente $\rightarrow$ emite `PROCESS_STOPPED`;
     - Qualquer outro código (`rc >= 2` ou `127` para comando ausente) $\rightarrow$ emite `OBSERVATION_ERROR: pgrep exit code $rc`.
     - Falha interna ou ausência de ferramenta **nunca** emite `PROCESS_STOPPED`.
   - **Preservação de Logs, Invalidez e Metadados:** Nos pontos de contingência da fase `Backup` (timeout de 300s ou queda da Sessão 1), a gravação prévia de `pg_dump_execution.log` e de `session_metadata.json` (`dump_valid = false`) permanece intacta antes da tentativa de parada remota; o resultado retornado por `Stop-RemoteContainerDumpProcess` é formalmente consumido e registrado nos metadados (`stop_attempt_confirmed`, `stop_attempt_observation_success`, `stop_attempt_details`, `stop_attempt_method`) e anexado ao log antes da interrupção com erro (`exit 1`), mantendo o bloqueio determinístico das fases dependentes.

#### Tabela de Análise Estática dos 6 Cenários de Parada Remota (F5)

| Cenário Analisado | Comportamento do Transporte / Comando Remoto | Retorno de pgrep / Script | Saída do Script Remoto | ExitCode Docker | Avaliação no PowerShell 5.1 | Desfecho (`ConfirmedStopped` / `ObservationSuccess`) |
| :--- | :--- | :--- | :--- | :---: | :--- | :--- |
| **1. Processo Ativo** | Docker executa `sh -s` com sucesso; `pgrep` localiza o processo alvo no contêiner. | `$rc = 0` | `PROCESS_RUNNING` | 0 | `ExitCode == 0`, saída reconhecida; `$observationSuccess = $true`. Escala para SIGKILL (-9). | `ConfirmedStopped = false`<br>`ObservationSuccess = true` |
| **2. Processo Ausente** | Docker executa `sh -s` com sucesso; `pgrep` não encontra nenhum processo correspondente. | `$rc = 1` | `PROCESS_STOPPED` | 0 | `ExitCode == 0`, saída inequívoca; `$stopped = $true`, `$observationSuccess = $true`. Interrompe o loop. | `ConfirmedStopped = true`<br>`ObservationSuccess = true` |
| **3. Erro de pgrep** | `pgrep` falha internamente (sintaxe, flags inválidas ou falta de memória). | `$rc = 2` (ou código fatal > 1) | `OBSERVATION_ERROR: pgrep exit code 2` | 0 | `ExitCode == 0`, mas saída cai no ramo inesperado; `$observationSuccess = $false`. NUNCA emite `PROCESS_STOPPED`. | `ConfirmedStopped = false`<br>`ObservationSuccess = false` |
| **4. pgrep Indisponível** | Binário `pgrep` ausente no contêiner (`command not found`). Shell retorna 127. | `$rc = 127` | `OBSERVATION_ERROR: pgrep exit code 127` | 0 | `ExitCode == 0`, mas saída cai no ramo inesperado; `$observationSuccess = $false`. NUNCA emite `PROCESS_STOPPED`. | `ConfirmedStopped = false`<br>`ObservationSuccess = false` |
| **5. Falha do Docker** | Docker daemon inacessível, contêiner parado ou erro de criação de exec (`ExitCode != 0` ou exceção). | Não executado remotamente | Nula / Erro CLI Docker | != 0 (ex: 1, 125) ou exceção | `ExitCode != 0` ou `catch`; ramo de falha do Docker; `$observationSuccess = $false`. Erro do Docker não comprova parada. | `ConfirmedStopped = false`<br>`ObservationSuccess = false` |
| **6. Resposta Inválida** | Execução retorna com sucesso, mas saída em branco, truncada ou com mensagem anômala. | Retorno arbitrário | Saída diferente de `PROCESS_STOPPED` e `PROCESS_RUNNING` | 0 | `ExitCode == 0`, mas saída não coincide com as sentinelas autorizadas; `$observationSuccess = $false`. | `ConfirmedStopped = false`<br>`ObservationSuccess = false` |

3. **F6 Residual (Alternativa Mínima para Funções Agregadas diante de Cobertura Parcial):**
   - Reconhece-se documentalmente que o catálogo DDL de `docs/sql/024_recovery_manifest.sql` possui cobertura **parcial** de atributos de agregados do PostgreSQL 17 (atributos avançados como `aggkind`, `aggnumdirectargs`, `aggfinalmodify` e `aggmfinalmodify` permanecem não mapeados). Não se declara cobertura total.
   - Em `tools/compare-recovery-sql024.ps1` (Vetor 7): adotada a alternativa mínima recomendada. Caso qualquer função agregada (`prokind = 'a'`) seja encontrada na origem ou no destino, o comparador emite divergência formal explícita alertando sobre a cobertura parcial de catálogo, bloqueando conservadoramente o PASS integral.

---

## 9. Matriz de Status dos Grupos R1–R7 e Limites de Aceite

> [!WARNING]
> Conforme apontamento independente da 3ª, 4ª e 5ª rodadas do Codex, a ausência de erros sintáticos ou correções estáticas em código não constitui resolução operacional nem autoriza declaração de aceite pleno. Todos os grupos R1 a R7 permanecem classificados como **Parciais** até sua validação operacional em laboratório real autorizado.

| Grupo | Descrição do Apontamento | Status Técnico | Evidência Estática Realizada (5ª/6ª Rodada) | Pendência Residual / Condição de Aceite |
| :--- | :--- | :---: | :--- | :--- |
| **R1** | **Isolamento, Alvos e Não Regressão** | **Parcial** | Guardas estritas de procedência: validação de tipo booleano estrito para `dump_valid`; conferência de `origin_oid` em `RestoreVerify` e `CompareManifests`; conferência de `created_oid` contra o cluster antes de comparar e descartar. | Validação operacional em execução real no laboratório; confirmação de integridade física. |
| **R2** | **Extração, Marcadores e Transporte JSON** | **Parcial** | Delimitadores formais no SQL, array JSON indivisível e consumo corrigido via `table_hash_query`. | Prova de extração sob snapshot concorrente real no contêiner oficial. |
| **R3** | **Contrato 1.1 e Simetria de Sessão** | **Parcial** | Preservação estrita de `contract_version == '1.1'`, `execution_run_id` obrigatório e coincidente em ambos os manifestos, snapshot vinculado. | Verificação da simetria de leitura sob snapshot concorrente no banco restaurado. |
| **R4** | **Confronto Ordinal, Enums e Bijeção** | **Parcial** | Bloqueio conservador de PASS integral para funções agregadas diante de cobertura de catálogo parcial; validação estrita de `-ExpectedOriginDb`, `-ExpectedRestoredDb` e `-ExpectedRunId` nos manifestos. | Execução de ponta a ponta do comparador com manifestos reais gerados pelo cluster. |
| **R5** | **Drenagem Assíncrona, Timeout e Procedência** | **Parcial** | `Stop-RemoteContainerDumpProcess` com script via STDIN para `sh -s`, linha de comando imune a autofiltro, captura imediata de `$rc=$?` de `pgrep`, sentinelas internas (`PROCESS_STOPPED` / `PROCESS_RUNNING`), distinção de falha do Docker e persistência formal de parada. | Ensaio operacional controlado de contingência e injeção de falhas (timeout / queda de sessão). |
| **R6** | **Compatibilidade PS 5.1 e UTF-8 BOM** | **Parcial** | Scripts salvos com UTF-8 BOM, validação AST pelo `Parser::ParseFile` do PowerShell 5.1 sem erros sintáticos. | Validação dinâmica em execução no ambiente Windows PowerShell 5.1 hospedeiro. |
| **R7** | **Catálogo PostgreSQL 17 e Gate 3** | **Parcial / NO-GO** | **Estático (SQL):** Catálogo de agregados documentado como parcial (sem alegação de totalidade); bloqueio conservador de PASS no comparador.<br>**Operacional:** **Não comprovado** (execução não autorizada).<br>**Gate 3:** Permanece **NO-GO**. | Execução real da extração sobre catálogo completo do PostgreSQL 17. Liberação de migrações e do Gate 3 depende de decisão formal do PO. |

---

## 10. Quadro Síntese de Governança e Matriz de Autorizações

| Fase Operacional | Pré-Requisito de Governança | Decisão Exigida | Agente Revisor / Decisor |
| :--- | :--- | :--- | :--- |
| **Apreciação dos Candidatos Corrigidos** | Elaboração documental (Esta Rodada) | Aprovação técnica dos scripts candidatos (F1–F6 / R1–R7). | Codex (Revisão Independente) |
| **Autorização de Execução (Backup)** | Aprovação dos candidatos | Autorização para conexão e extração do backup. | Responsável pelo Produto |
| **Autorização de Validação (Restore)** | Sucesso da Fase 2 e prova do artefato | Autorização para `CREATE DATABASE escala_recovery_verify_024` e restore atômico. | Responsável pelo Produto |
| **Aceite Formal da Recuperação** | Paridade absoluta de 100% no relatório da Fase 5 | Aceite formal do Critério 4 da Issue #58. | Responsável pelo Produto |
| **Descarte e Limpeza Final** | Aceite formal da recuperação | Autorização para `DROP DATABASE` e remoção de dumps temporários. | Responsável pelo Produto |

> [!IMPORTANT]
> **Status dos Gates de Governança:**  
> - **Critério 4 da Issue #58:** Candidatos corrigidos estaticamente (F1–F6) e documentados; **Ainda não comprovado operacionalmente** (aguardando apreciação técnica independente do Codex e autorização do Responsável pelo Produto).  
> - **Linha 2A da Issue #58:** Permanece **Parcial**.  
> - **Gate 3 / R7 Integral:** Permanece em **NO-GO**. A preparação e correção estática deste ferramental é estritamente preventiva para mitigar riscos de persistência, não constituindo liberação de migrações nem aplicação do SQL 024.
> - **Proibição Estrita de Execução:** É terminantemente vedada a execução ou importação dos candidatos, inclusive sob `-Phase Plan`, bem como a realização de testes funcionais, SQL, comandos Docker ou manipulação de recursos reais.

