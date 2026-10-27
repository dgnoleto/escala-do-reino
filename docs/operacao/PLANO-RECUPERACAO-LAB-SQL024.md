# Plano de Recuperação do Laboratório — Suporte ao SQL 024 (Critério 4 da Issue #58)

> **DOCUMENTO ESTRITAMENTE DE PLANEJAMENTO (NÃO EXECUTADO)**  
> Este documento especifica o procedimento de backup lógico e restauração verificável do banco de dados descartável de laboratório, em atendimento ao Critério 4 da matriz residual da [Issue #58](https://github.com/dgnoleto/escala-do-reino/issues/58).  
> **Status:** Plano elaborado — em revisão, não aprovado. Nenhuma etapa deste plano foi executada.

---

## 1. Objetivo e Alvos Operacionais

### 1.1 Objetivo do Procedimento
Estabelecer um protocolo técnico auditável, reprodutível e determinístico para a extração de backup lógico completo e posterior restauração verificável do banco de laboratório `escala_rehearsal_024`, assegurando que:
1. Qualquer intervenção durável no banco descartável (como a futura aplicação atômica do SQL 024) disponha de capacidade de restauração real e comprovada;
2. O procedimento de recuperação seja baseado em validação empírica de restauração, superando a dependência de `ROLLBACK` de sessão (inaplicável após `COMMIT`) e de medidas de contenção funcional por `REVOKE` (que mitigam riscos de execução de rotinas, mas não recuperam o estado anterior dos dados nem constituem procedimento de restore);
3. O ambiente de produção/piloto remoto, o banco principal local `postgres`, os demais laboratórios e os arquivos de evidências físicas permaneçam protegidos por medidas técnicas de contenção e mitigação de risco de isolamento.

### 1.2 Identificação e Guardas da Origem (Banco sob Proteção)
- **Contêiner Oficial:** `supabase_db_escala-convites-http-lab` (PostgreSQL 17.11 gerenciado pelo Supabase CLI local).
- **Banco de Origem Alvo:** `escala_rehearsal_024`.
- **Identificadores Históricos Registrados:**
  - `Database OID`: `198690`.
  - `Cluster System Identifier`: `7695064938894594085`.
- **Regra de Pré-Execução da Origem:** Antes de qualquer invocação de ferramentas de extração, uma consulta estrita somente-leitura deve confrontar o nome do banco, o OID e o identificador do cluster. Qualquer divergência encerra imediatamente o procedimento antes de qualquer leitura ou cópia.

### 1.3 Alvos Proibidos e Resolução de Conexões Administrativas
1. **Bancos e Ambientes Estritamente Protegidos contra Modificação:**
   - **Banco Principal Local `postgres`:** Permanece como banco de dados protegido. É terminantemente proibido executar DDL de aplicação, DML (`INSERT`, `UPDATE`, `DELETE`), `TRUNCATE`, `DROP TABLE` ou qualquer alteração em seus esquemas de domínio.
   - **Piloto Remoto Supabase (`jvpctgqudvjealzileib`):** Totalmente isolado do fluxo de laboratório.
   - **Outros Laboratórios Locais:** Ambientes como `EscalaReinoLab` ou contêineres legados de ensaios anteriores (`escala-convites-lab-011-20261009`).
   - **Volumes de Armazenamento Docker:** Volumes persistentes compartilhados não devem sofrer operações de recriação, formatação ou descarte.
2. **Clarificação da Conexão Administrativa de Controle:**
   - No PostgreSQL, comandos de gerenciamento de cluster (`CREATE DATABASE` e `DROP DATABASE`) não podem ser executados a partir da base que está sendo criada ou descartada; exigem conexão a um banco de manutenção existente no cluster (tipicamente `postgres` ou `template1`).
   - A conexão administrativa ao banco `postgres` utilizada como mero canal de controle para emitir `CREATE DATABASE escala_recovery_verify_024` ou `DROP DATABASE escala_recovery_verify_024` **não toca, não lê e não altera** nenhuma tabela ou esquema do banco `postgres`, operando exclusivamente no catálogo de bancos do cluster (`pg_database`).

### 1.4 Distinção entre Guardas da Origem e Guardas do Destino
- **Guardas da Origem:** Verificam a identidade do banco `escala_rehearsal_024` antes do backup (OID `198690`, cluster `7695064938894594085` e existência do catálogo de suporte).
- **Guardas do Destino:** Aplicadas ao ambiente de restauração, conferindo que o destino seja expressamente uma base descartável proposta para validação de restore (ex.: `escala_recovery_verify_024`), impedindo que o restore seja acidentalmente direcionado contra a origem ou contra o banco principal `postgres`.

---

## 2. Escopo e Limites Técnicos do Backup

### 2.1 Conteúdo Relacional e Ferramental Necessário
- **Ferramenta Canônica:** `pg_dump` oficial do PostgreSQL 17 (binário nativo contido no próprio contêiner oficial `supabase_db_escala-convites-http-lab`, garantindo paridade absoluta de catálogo e protocolo).
- **Formato Custom (`-F c` / `pg_dump -Fc`):**
  - Formato binário comprimido e estruturado com índice interno (`TOC - Table of Contents`), imune a corrupções de codificação textual em shells Windows e apto à inspeção antecipada via `pg_restore --list`.
- **Cobertura Lógica Completa do Banco:**
  - O backup deve cobrir **a totalidade do banco `escala_rehearsal_024`**, sem filtragem restritiva por esquemas via flag `--schema`.
  - São extraídos integralmente: esquemas relacionais (`public`, `app_private`, `auth`, `storage`, `extensions`), tabelas, sequências, visões, tipos customizados, rotinas/funções, constraints, regras de RLS, triggers e permissões concedidas.

### 2.2 Distinção em Três Esferas Operacionais
O backup lógico de banco de dados não cobre a totalidade da infraestrutura do laboratório, impondo a seguinte separação técnica:
1. **Conteúdo Relacional do Banco (100% coberto pelo `pg_dump`):** Tabelas, dados, funções, constraints, gatilhos e permissões existentes dentro do banco `escala_rehearsal_024`.
2. **Globais de Cluster (NÃO cobertos pelo dump de um banco individual):** Roles do cluster (`pg_roles`), heranças e associações (`pg_auth_members`), parâmetros de conexão e configurações globais do cluster. A restauração não pode depender de `pg_dumpall --globals-only` (pois alteraria o cluster compartilhado). As roles necessárias constituem **dependências pré-existentes do cluster**, devendo ser validadas antes do restore.
3. **Arquivos Físicos e Configurações Externas (NÃO cobertos pelo `pg_dump`):** Arquivos físicos de mídia em volumes Docker do Storage do Supabase (ex.: bucket `church-logos`), configurações de contêineres (`.env.local`), parâmetros do PostgREST (`PGRST_*`) e rotas do Kong. O `pg_dump` preserva unicamente os metadados relacionais das tabelas `storage.buckets` e `storage.objects`, não contendo os arquivos físicos em disco. Não se deve afirmar cobertura de Storage que o comando não fornece.

### 2.3 Preservação de Proprietários e Permissões (ACLs)
- **Não Uso de `--no-owner`:** A documentação oficial do PostgreSQL estabelece que o formato customizado arquiva por padrão a propriedade original dos objetos. O uso de `--no-owner` suprimiria os comandos de atribuição de proprietário, fazendo com que todos os objetos pertencessem ao usuário de conexão do restore (`postgres`).
  - As evidências de catálogo comprovam que o banco possui objetos com diferentes proprietários legítimos:
    - `auth.users` pertence a `supabase_auth_admin` (com privilégios para `dashboard_user` e `postgres`);
    - `auth.uid()` pertence a `supabase_auth_admin` (com ACL explícita para `PUBLIC`, `supabase_auth_admin` e `dashboard_user`);
    - Tabelas e rotinas de `app_private` pertencem a `postgres`.
  - Para garantir a fidelidade de recuperação, **proprietários e ACLs devem ser preservados**.
- **Não Uso de `--clean` na Extração:** A limpeza prévia de objetos é inadequada para um banco de destino recém-criado (vazio), evitando emissão de comandos desnecessários de `DROP` contra objetos inexistentes.
- **Privilégios da Role de Execução:** Conforme demonstrado em `roles_metadata.json`, a role `postgres` possui `is_superuser = false`, mas detém `bypass_rls = true`, `can_create_db = true` e `can_create_role = true`. Não se presumem privilégios de superusuário para `postgres`, tampouco criação ou alteração de roles por inferência.

### 2.4 Armazenamento Protegido e Segurança de Informações Sensíveis (LGPD)
- **Localização dos Artefatos:** Diretório local protegido e ignorado pelo Git:
  `scratch/backups-lab/YYYYMMDD-HHMMSS-escala_rehearsal_024/`.
- **Integridade Criptográfica:** Geração imediata de manifesto SHA-256 (`backup.dump.sha256`) logo após a conclusão da extração.
- **Proteção Anti-Exposição:**
  - Proibido qualquer commit, staging ou envio de arquivos de dump (`*.dump`) para o GitHub;
  - Proibida a transcrição de dados de contas de usuários (`auth.users`), hashes de senhas (`encrypted_password`) ou tokens JWT em relatórios ou logs de auditoria;
  - Relatórios registrarão apenas estatísticas de tabelas, contagens de registros e hashes de integridade.

---

## 3. Procedimento Operacional Proposto (Proposta Textual)

> **ATENÇÃO:** Os comandos abaixo são propostas técnicas para apreciação e revisão. Não devem ser executados nesta rodada.

### 3.1 Sequência Segura de Transporte, Prova do Artefato e Manipulação Binária
Para evitar a corrupção de arquivos binários associada a pipes e redirecionamentos no Windows PowerShell 5.1, o fluxo proposto utiliza exclusivamente manipulação de arquivos físicos no contêiner e transferência bidirecional via `docker cp`.

Para **comprovar que o artefato arquivado no host é íntegro e restaurável** (e não apenas o arquivo temporário originalmente gerado no contêiner), a inspeção de índice (`pg_restore --list`) e a futura restauração são executadas estritamente a partir de uma cópia transferida do host de volta para um caminho independente no contêiner:

```powershell
# ==============================================================================
# PROPOSTA DE FLUXO DE EXTRAÇÃO SEGURA E PROVA DO ARTEFATO (NÃO EXECUTAR)
# ==============================================================================

# 1. Definição de identificadores e pastas locais no host
$BackupTimestamp = (Get-Date -Format "yyyyMMdd-HHmmss")
$HostBackupDir = "D:\Github\escala-do-reino\scratch\backups-lab\$BackupTimestamp-escala_rehearsal_024"
New-Item -ItemType Directory -Path $HostBackupDir -Force | Out-Null

$ContainerDumpPath = "/tmp/escala_rehearsal_024_$BackupTimestamp.dump"
$HostDumpPath = Join-Path $HostBackupDir "escala_rehearsal_024.dump"
$HostSha256Path = Join-Path $HostBackupDir "escala_rehearsal_024.dump.sha256"
$HostTocPath = Join-Path $HostBackupDir "dump_toc.txt"
$HostLogPath = Join-Path $HostBackupDir "backup_execution.log"
$ContainerRestorePath = "/tmp/restore_verify_escala_rehearsal_024_$BackupTimestamp.dump"

# 2. Execução do pg_dump estritamente no contêiner sob o snapshot exportado sincronizado
# docker exec supabase_db_escala-convites-http-lab pg_dump -U postgres -d escala_rehearsal_024 -F c --snapshot="$SnapshotId" -f $ContainerDumpPath --verbose

# 3. Conferência de integridade na origem (tamanho e SHA-256 no contêiner)
# $ContainerSize = (docker exec supabase_db_escala-convites-http-lab stat -c "%s" $ContainerDumpPath).Trim()
# $ContainerSha256 = (docker exec supabase_db_escala-convites-http-lab sha256sum $ContainerDumpPath).Split(' ')[0].Trim()

# 4. Transferência do arquivo binário contêiner -> host via docker cp (sem conversão de texto)
# docker cp supabase_db_escala-convites-http-lab:$ContainerDumpPath $HostDumpPath

# 5. Prova do trânsito contêiner -> host: conferência no host e confronto estrito com a origem
# $HostSize = (Get-Item -Path $HostDumpPath).Length
# $HostSha256 = (Get-FileHash -Path $HostDumpPath -Algorithm SHA256).Hash.ToLower()
# if ($HostSize -ne [int64]$ContainerSize -or $HostSha256 -ne $ContainerSha256) {
#     Write-Error "Divergência de integridade detectada na cópia para o host! Operação abortada."
#     # Preservar ambos os arquivos para auditoria pericial. Proibido apagar evidências.
#     exit 1
# }
# Set-Content -Path $HostSha256Path -Value "$HostSha256  escala_rehearsal_024.dump"

# 6. Prova do artefato arquivado: transferência da cópia do host para novo caminho no contêiner
# docker cp $HostDumpPath supabase_db_escala-convites-http-lab:$ContainerRestorePath

# 7. Revalidação de integridade pós-transferência no contêiner contra o manifesto do host
# $RestoreTargetSize = (docker exec supabase_db_escala-convites-http-lab stat -c "%s" $ContainerRestorePath).Trim()
# $RestoreTargetSha256 = (docker exec supabase_db_escala-convites-http-lab sha256sum $ContainerRestorePath).Split(' ')[0].Trim()
# if ($RestoreTargetSize -ne [int64]$HostSize -or $RestoreTargetSha256 -ne $HostSha256) {
#     Write-Error "Divergência na transferência da cópia do host para o contêiner! Operação abortada."
#     # Preservar arquivos e evidências. Proibido apagar.
#     exit 1
# }

# 8. Inspeção do índice interno (TOC) executada ESTRITAMENTE a partir do artefato transferido
# docker exec supabase_db_escala-convites-http-lab pg_restore --list $ContainerRestorePath > $HostTocPath

# PROTOCOLO DE PRESERVAÇÃO INTEGRAL DE ARQUIVOS E EVIDÊNCIAS:
# - Diante de qualquer erro em qualquer etapa (cópia, divergência de hash, erro de sintaxe, código de saída != 0),
#   todos os arquivos ($HostBackupDir, $ContainerDumpPath e $ContainerRestorePath) são integralmente preservados.
# - É terminantemente proibido executar limpeza automática (rm -f) ou descarte de evidências em cenários de falha.
# - A limpeza de $ContainerDumpPath e $ContainerRestorePath no contêiner só é autorizada após a conclusão bem-sucedida
#   de todos os marcos de validação e aceite formal do responsável pelo produto.
```

### 3.2 Protocolo de Falhas e Controles Próprios do `pg_restore`
O controle de falhas na restauração utiliza as opções nativas do binário `pg_restore` oficial, e não opções do `psql`:
- **`--exit-on-error` (ou `-e`):** Interrompe o processo imediatamente ao encontrar qualquer erro de execução SQL.
- **`--single-transaction` (ou `-1`):** Envelopa a restauração completa em uma transação única atômica (`BEGIN ... COMMIT`). Havendo qualquer erro com `--exit-on-error`, o utilitário emite automaticamente um `ROLLBACK`, impedindo restaurações parciais no banco de destino.
- **Validação de Código de Saída:** O executor deve capturar `$LASTEXITCODE` e abortar se for diferente de zero.
- **Proibição de Repetição Automática:** Diante de qualquer erro de restauração, a tentativa é encerrada e registrada como **falha de restauração**, preservando logs e artefatos sem repetição automática cega.

---

## 4. Estratégia de Restauração e Alternativas de Ambiente

### 4.1 Princípio de Aproveitamento Seguro da Infraestrutura Existente
Nenhuma autorização existe para instanciar novos contêineres Docker, novos clusters de banco ou volumes paralelos. O ensaio de restauração deve utilizar o cluster local existente, mantendo medidas de contenção de risco de isolamento.

### 4.2 Avaliação das Alternativas para Ensaio de Restauração

| Alternativa | Mecanismo | Vantagens | Riscos / Impactos | Decisão Recomendada |
| :--- | :--- | :--- | :--- | :--- |
| **Opção 1: Sobrescrita Direta da Origem** | Restaurar diretamente sobre `escala_rehearsal_024` via `pg_restore`. | Não requer criação de novos bancos. | **Risco Crítico:** Destrói a base de origem caso ocorra falha de restauração, inviabilizando o laboratório atual. | **REJEITADA.** Viola o princípio de preservação de evidências. |
| **Opção 2: Banco Efêmero de Validação (Proposta Sujeita a Autorização)** | Criar temporariamente um banco descartável isolado no mesmo contêiner (ex.: `escala_recovery_verify_024`) exclusivamente para receber e auditar o restore. | Mantém o banco de origem `escala_rehearsal_024` e o banco `postgres` intactos. Permite confronto direto lado a lado entre origem e cópia restaurada. | Requer comando `CREATE DATABASE escala_recovery_verify_024` e posterior descarte após validação. | **PROPOSTA RECOMENDADA.** Sujeita à deliberação e autorização expressa do responsável. |
| **Opção 3: Novo Contêiner / Cluster Dedicado** | Criar um contêiner Docker paralelo para o teste. | Isolamento de processos. | Consumo de recursos no host, conflito potencial de portas e complexidade operacional desnecessária. | **REJEITADA.** Desproporcional para homologação local. |

### 4.3 Procedimento Proposto para a Restauração no Banco de Validação (Opção 2)
Caso a Opção 2 seja expressamente autorizada pelo responsável pelo produto:

```powershell
# ==============================================================================
# PROPOSTA DE RESTAURAÇÃO EM BANCO EFÊMERO DE TESTE (NÃO EXECUTAR)
# ==============================================================================

# 1. Guarda Pré-Criação: Conferir que o banco de destino NÃO existe previamente
# docker exec -i supabase_db_escala-convites-http-lab psql -U postgres -d postgres -c "SELECT 1 FROM pg_database WHERE datname = 'escala_recovery_verify_024';"
# Se retornar qualquer linha, abortar imediatamente.

# 2. Criação do banco descartável de destino via conexão administrativa de controle
# docker exec -i supabase_db_escala-convites-http-lab psql -U postgres -d postgres -c "CREATE DATABASE escala_recovery_verify_024;"

# 3. Guarda Pós-Criação: Registrar o OID atribuído ao banco de destino recém-criado
# docker exec -i supabase_db_escala-convites-http-lab psql -U postgres -d postgres -c "SELECT oid, datname FROM pg_database WHERE datname = 'escala_recovery_verify_024';"

# 4. Execução do pg_restore apontando para o arquivo físico REIMPORTADO DO HOST ($ContainerRestorePath)
# docker exec supabase_db_escala-convites-http-lab pg_restore -U postgres -d escala_recovery_verify_024 --exit-on-error --single-transaction --verbose $ContainerRestorePath

# 5. Execução do confronto analítico entre origem (escala_rehearsal_024) e destino restaurado

# 6. Limpeza autorizada dos arquivos temporários internos no contêiner SOMENTE após aprovação de todos os confrontos
# docker exec supabase_db_escala-convites-http-lab rm -f $ContainerDumpPath $ContainerRestorePath

# 7. Descarte estritamente delimitado do banco efêmero de validação (sujeito a autorização prévia)
# docker exec -i supabase_db_escala-convites-http-lab psql -U postgres -d postgres -c "DROP DATABASE escala_recovery_verify_024;"
# Nenhum recurso pré-existente pode ser descartado.
```

### 4.4 Tratamento de Falhas de Restauração
- Caso o processo do `pg_restore` aborte com erro, a transação única (`--single-transaction`) realiza o rollback automático no banco de destino.
- O evento é registrado formalmente como **falha de restauração**, preservando integralmente os logs, os artefatos locais no host (`$HostBackupDir`) e os arquivos temporários no contêiner (`$ContainerDumpPath` e `$ContainerRestorePath`) para análise de causa raiz pelo Codex. Nenhum arquivo é apagado em caso de erro.
- A base de origem `escala_rehearsal_024` e o banco principal `postgres` permanecem intactos, pois não atuaram como destino da carga.

---

## 5. Critérios Objetivos de Aceite da Recuperação

A comprovação formal de recuperação exige confronto determinístico e analítico entre o banco de origem e o banco restaurado, estendendo-se a **todo o escopo relacional incluído no backup**.

### 5.1 Garantia de Consistência Temporal (Linha de Base do Dump)
Para que o confronto analítico entre o banco de origem e o banco restaurado seja matematicamente determinístico, o manifesto de catálogo e o dump binário devem refletir rigorosamente o **mesmo estado de referência temporal (ponto no tempo MVCC)**.

#### 5.1.1 Mecanismo Escolhido: Snapshot Exportado (`pg_export_snapshot` e `pg_dump --snapshot`)
O mecanismo canônico adotado utiliza as primitivas de consistência nativas do PostgreSQL para sincronizar sessões independentes:
1. **Sessão 1 — Sessão Mantenedora e Geração do Manifesto (via `psql`):**
   - O executor abre conexão com `escala_rehearsal_024` e inicia uma transação somente-leitura com nível de isolamento `REPEATABLE READ`:
     ```sql
     BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
     SELECT pg_export_snapshot();
     ```
   - O comando retorna um identificador textual imutável de snapshot (ex.: `'00000004-00000002-1'`).
   - Sob **esta mesma transação** (mesma Sessão 1), são executadas todas as consultas do manifesto analítico de referência da origem:
     - Inventário dinâmico de todos os esquemas, tabelas, visões, funções, sequências e tipos;
     - Catálogo de proprietários nominais reais e ACLs decompostas por identidades estáveis;
     - Contagens e agregação determinística de hashes de dados de todas as tabelas (`to_jsonb`).
   - **Manutenção da Sessão Exportadora:** A Sessão 1 permanece aberta e conectada em estado de espera no shell orquestrador durante toda a extração do backup. No PostgreSQL, o snapshot exportado permanece ativo e preservado no cluster enquanto a transação que o exportou mantiver sua sessão aberta.
   - **Escopo e Limites do Snapshot MVCC:** O snapshot compartilhado garante consistência atômica estritamente para os dados relacionais e tabelas governados pelo modelo de visibilidade transacional MVCC no banco `escala_rehearsal_024`. Essa garantia não se estende a estados não transacionais (como contadores internos de sequências manipulados via `nextval`), catálogos globais compartilhados de cluster (`pg_roles`, `pg_database`), arquivos físicos de mídia em volumes Docker de Storage ou para o cluster PostgreSQL como um todo.
2. **Sessão 2 — Sessão de Extração do Backup Lógico (`pg_dump`):**
   - Invocada via `docker exec`, a ferramenta oficial conecta-se em sessão própria consumindo o identificador exportado:
     ```bash
     pg_dump -U postgres -d escala_rehearsal_024 -F c --snapshot="$SnapshotId" -f "$ContainerDumpPath" --verbose
     ```
   - O `pg_dump` importa o snapshot sincronizado (`SET TRANSACTION SNAPSHOT`), garantindo que tanto os metadados de catálogo quanto os dados de todas as tabelas reflitam exatamente a mesma visibilidade transacional das consultas executadas pela Sessão 1.
3. **Sincronização, Monitoramento Ativo e Encerramento Controlado:**
   - O script orquestrador monitora o código de término do `pg_dump`.
   - Se o `pg_dump` concluir com sucesso (`$LASTEXITCODE -eq 0`), a Sessão 1 é instruída a emitir `COMMIT;` e fechar sua conexão.
   - Se o `pg_dump` falhar, a Sessão 1 emite `ROLLBACK;` e o procedimento é imediatamente abortado.
   - **Monitoramento Ativo pelo Executor em Caso de Queda da Sessão:** Não se presume que uma eventual queda da Sessão 1 resultará em falha instantânea ou automática do processo `pg_dump`. O script executor deve monitorar ativamente a integridade da Sessão 1 (verificando o processo/PID da sessão mantenedora). Se for detectada interrupção ou encerramento anormal da Sessão 1 antes do término do dump, o executor deve intervir imediatamente, abortando apenas o processo de extração e registrando formalmente a ocorrência como falha de consistência. O dump parcial deve ser preservado, identificado como incompleto/inválido no manifesto e impedido de uso em restauração. Nenhum arquivo é apagado nessa situação; os logs e demais evidências seguem integralmente retidos conforme o protocolo definido.

#### 5.1.2 Demonstração de Repouso Operacional e Diagnósticos Auxiliares
Como salvaguarda de isolamento do laboratório, o repouso operacional é verificado e monitorado sem interferência no sistema:
- **Demonstração Primária Pré-Captura:** Imediatamente antes de abrir a Sessão 1, consulta-se `pg_stat_activity` para demonstrar que não há conexões ativas ou transações concorrentes na base:
  ```sql
  SELECT pid, usename, application_name, client_addr, state, backend_type, query
  FROM pg_stat_activity
  WHERE datname = 'escala_rehearsal_024' AND pid <> pg_backend_pid();
  ```
  O critério estrito exige **zero conexões concorrentes**.
- **Telemetria Diagnóstica Auxiliar (WAL e Contadores) e Seus Limites:**
  Como diagnóstico auxiliar complementar (e não como prova isolada de ausência de escrita concorrente), registra-se o LSN do cluster (`SELECT pg_current_wal_lsn();`) e os contadores de transações da base (`xact_commit`, `xact_rollback` em `pg_stat_database`) antes e após a captura.
  - **Limites Explícitos:**
    1. O WAL LSN avança com qualquer atividade transacional em qualquer banco de dados de todo o cluster (e não apenas de `escala_rehearsal_024`);
    2. As estatísticas de `pg_stat_database` são coletadas de forma assíncrona pelo processo de telemetria do PostgreSQL, sujeitas a defasagem temporal de propagação.
    Portanto, essas métricas não constituem prova formal de isolamento, atuando exclusivamente como telemetria auxiliar para detecção de anomalias operacionais grosseiras.
- **Não Alteração de Serviços ou Permissões por Inferência:** O repouso é auditado passivamente. É terminantemente proibido parar serviços Docker, derrubar daemons de banco ou revogar privilégios de roles (`REVOKE`/`GRANT`) para forçar repouso artificial por inferência.

---

### 5.2 Completude da Validação e Matriz de Comparação Lado a Lado

A validação de recuperação rejeita amostragens parciais, listas fixas e comparações superficiais de identificadores, abrangendo exaustivamente a integridade relacional, estrutural e de permissões de todo o banco.

#### 5.2.1 Derivação Dinâmica do Inventário do Escopo Real do Backup
O inventário de comparação não utiliza listas estáticas predeterminadas de esquemas ou tabelas. Ele é derivado dinamicamente no momento da extração a partir de todos os esquemas persistidos pertencentes ao banco cobertos pelo dump:
```sql
SELECT nspname FROM pg_namespace
WHERE nspname NOT LIKE 'pg_%' AND nspname <> 'information_schema'
ORDER BY nspname;
```
São cobertos dinamicamente todos os esquemas retornados (`public`, `app_private`, `auth`, `storage`, `extensions`, `graphql`, `realtime`, `vault`, etc.) e a totalidade de seus objetos relacionais: tabelas (`r`, `p`), visões (`v`, `m`), sequências (`S`), tipos customizados/enums (`pg_type`), funções e procedimentos (`pg_proc`), constraints (`pg_constraint`), índices (`pg_index`), triggers (`pg_trigger`), políticas RLS (`pg_policy`) e privilégios em nível de coluna (`pg_attribute.attacl`).

#### 5.2.2 Método Determinístico de Hash de Dados por Tabela (Cobertura de Todas as Colunas)
Para verificar a integridade lógica dos dados recuperados sem expor dados pessoais ou credenciais (LGPD), cada tabela do inventário é validada por método determinístico de agregação criptográfica:

1. **Parâmetros de Sessão Idênticos na Origem e no Destino:**
   A formatação de datas, carimbos de data/hora (`timestamptz`) e números de ponto flutuante em `to_jsonb` é sensível a parâmetros de sessão. Ambas as conexões de inspeção (na origem e no banco restaurado) devem obrigatoriamente padronizar as mesmas variáveis locais no início da sessão:
   ```sql
   SET LOCAL TimeZone = 'UTC';
   SET LOCAL datestyle = 'ISO, YMD';
   SET LOCAL intervalstyle = 'iso_8601';
   SET LOCAL extra_float_digits = 3;
   SET LOCAL client_encoding = 'UTF8';
   ```

2. **Cobertura de Todas as Colunas Persistidas:**
   A inspeção cobre todas as colunas regulares da tabela (`attnum > 0 AND NOT attisdropped`), ordenadas por sua posição física ordinal (`attnum`).

3. **Serialização Canônica via `to_jsonb(t.*)` e Tratamento de NULL:**
   - A tupla inteira `t` é serializada via função nativa `to_jsonb(t.*)` em formato JSON canônico estruturado chave-valor.
   - **Tratamento de NULL por Linha:** A representação JSON dos valores deve ser acompanhada de um vetor de indicadores de nulidade SQL calculado na mesma linha. Para cada coluna do inventário ordenado, gerar uma expressão `t.<coluna> IS NULL`; montar o vetor com `jsonb_build_array(...)`. O payload é `jsonb_build_object('values', to_jsonb(t), 'sql_nulls', jsonb_build_array(<indicadores_IS_NULL_por_coluna>))`. Os identificadores das colunas devem ser gerados a partir do catálogo com citação SQL apropriada, sem interpolação de nomes não tratados. O vetor integra o hash de cada linha; uma contagem global de nulos ou `attnotnull` não o substitui.
   - **Caso de Aceite da Distinção de NULL:** Considere duas linhas com IDs distintos: na origem, ID 1 tem NULL SQL e ID 2 tem `'null'::jsonb`; no destino, esses valores foram trocados. As contagens globais de nulos continuam iguais, mas o vetor de nulidade associado aos valores e ao ID deve produzir hashes de tabela diferentes. Este caso é uma especificação para futura validação, não um teste executado nesta rodada.

4. **Hash Criptográfico por Linha (`sha256` com Argumento `bytea`):**
   No PostgreSQL nativo, `sha256(bytea)` requer argumento do tipo `bytea` e retorna `bytea`. O texto do payload completo de valores e indicadores de nulidade SQL deve ser convertido explicitamente via `convert_to(..., 'UTF8')`, sendo o resultado do `sha256` codificado em hexadecimal via `encode(..., 'hex')`:
   `row_hash = encode(sha256(convert_to(payload_linha::text, 'UTF8')), 'hex')`

5. **Ordenação Determinística, Duplicidades, Tabelas sem Chave Primária e Agregação Final:**
   Para eliminar a dependência da ordem física de armazenamento no disco (`heap`) e assegurar determinismo mesmo em tabelas sem chave primária ou com PK composta, a agregação global da tabela ordena as linhas pelo próprio valor hexadecimal do `row_hash`. O texto resultante do `string_agg` é convertido explicitamente para `bytea` via `convert_to(..., 'UTF8')` antes de ser passado ao `sha256`:
   ```sql
   SELECT
       coalesce(
           encode(sha256(convert_to(string_agg(row_hash, E'\n' ORDER BY row_hash), 'UTF8')), 'hex'),
           encode(sha256(''::bytea), 'hex') -- Valor determinístico canônico para tabelas com 0 registros
       ) AS table_data_hash,
       count(*) AS total_rows
   FROM (
       SELECT encode(sha256(convert_to(payload_linha::text, 'UTF8')), 'hex') AS row_hash
       FROM (
           SELECT jsonb_build_object(
               'values', to_jsonb(t),
               'sql_nulls', jsonb_build_array(<indicadores_IS_NULL_por_coluna>)
           ) AS payload_linha
           FROM <schema>.<table> t
       ) linhas
   ) sub;
   ```
   - **Modelo SQL Gerado:** Os marcadores `<schema>`, `<table>` e `<indicadores_IS_NULL_por_coluna>` devem ser resolvidos pelo futuro executor a partir do mesmo inventário de colunas usado na comparação estrutural. O exemplo é um modelo documental; não é um comando pronto para execução.
   - **Tabelas sem PK:** Não há dependência de colunas específicas (`id`), operando uniformemente sobre qualquer tabela relacional.
   - **Linhas Idênticas (Duplicidades):** Linhas com conteúdo idêntico produzem hashes iguais; a cláusula `ORDER BY row_hash` mantém ambas consecutivas na agregação, produzindo resultado rigorosamente determinístico.
   - **Tabelas Vazias:** Caso `count(*) = 0`, a agregação resulta no hash canônico da cadeia vazia (`encode(sha256(''::bytea), 'hex')`).

6. **Natureza de Verificação Criptográfica de Integridade e Limites Formais:**
   A agregação criptográfica via SHA-256 constitui uma **verificação determinística de integridade dos dados restaurados**, proporcionando elevada certeza técnica de que os dados persistidos não apresentaram divergências lógicas de valores ou truncamento detectáveis por este método durante o ciclo de extração e restauração. Não confere garantia matemática absoluta contra colisões teóricas de funções de dispersão (hashes), tampouco constitui certificação ou atestado jurídico formal de conformidade com a LGPD ou outras normas legais (em estrito cumprimento à diretriz de governança da Seção 1.5 de AGENTS.md, segundo a qual parecer técnico de IA não certifica conformidade regulatória).

#### 5.2.3 Comparação de Proprietários Reais da Origem
A verificação de propriedade não presume que tabelas ou funções pertençam genericamente a `postgres`:
- Consulta a `pg_roles.rolname` associado a `pg_class.relowner`, `pg_proc.proowner`, `pg_namespace.nspowner` e `pg_type.typowner`.
- Critério estrito: Coincidência de **100% dos nomes nominais dos proprietários** entre o banco de origem e o banco restaurado para todos os objetos do catálogo (ex.: objetos de `auth` sob `supabase_auth_admin`, objetos sob `postgres` ou sob roles de extensões mantêm exatamente suas identidades nominais de origem).

#### 5.2.4 Comparação de ACLs Completas por Identidades Estáveis e `acldefault` Tipado
A comparação de privilégios rejeita formatações textuais brutas dependentes de OIDs internos do cluster, separando os tipos de objetos e aplicando a função `acldefault` com seu respectivo tipo:

1. **Tabelas e Visões (`relkind IN ('r', 'p', 'v', 'm')`):**
   Utiliza `acldefault('r', c.relowner)`:
   ```sql
   SELECT
       n.nspname AS schema_name,
       c.relname AS object_name,
       'table_or_view' AS object_type,
       NULL::text AS column_name,
       CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE r_grantee.rolname END AS grantee_name,
       r_grantor.rolname AS grantor_name,
       a.privilege_type,
       a.is_grantable
   FROM pg_class c
   JOIN pg_namespace n ON n.oid = c.relnamespace
   CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
   LEFT JOIN pg_roles r_grantee ON r_grantee.oid = a.grantee
   LEFT JOIN pg_roles r_grantor ON r_grantor.oid = a.grantor
   WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema'
     AND c.relkind IN ('r', 'p', 'v', 'm');
   ```

2. **Sequências (`relkind = 'S'`):**
   Separadas expressamente de tabelas e visões, utiliza `acldefault('s', c.relowner)`:
   ```sql
   SELECT
       n.nspname AS schema_name,
       c.relname AS object_name,
       'sequence' AS object_type,
       NULL::text AS column_name,
       CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE r_grantee.rolname END AS grantee_name,
       r_grantor.rolname AS grantor_name,
       a.privilege_type,
       a.is_grantable
   FROM pg_class c
   JOIN pg_namespace n ON n.oid = c.relnamespace
   CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('s', c.relowner))) a
   LEFT JOIN pg_roles r_grantee ON r_grantee.oid = a.grantee
   LEFT JOIN pg_roles r_grantor ON r_grantor.oid = a.grantor
   WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema'
     AND c.relkind = 'S';
   ```

3. **Rotinas e Funções (`pg_proc`):**
   Utiliza `acldefault('f', p.proowner)`:
   ```sql
   SELECT
       n.nspname AS schema_name,
       p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS object_name,
       'function' AS object_type,
       NULL::text AS column_name,
       CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE r_grantee.rolname END AS grantee_name,
       r_grantor.rolname AS grantor_name,
       a.privilege_type,
       a.is_grantable
   FROM pg_proc p
   JOIN pg_namespace n ON n.oid = p.pronamespace
   CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
   LEFT JOIN pg_roles r_grantee ON r_grantee.oid = a.grantee
   LEFT JOIN pg_roles r_grantor ON r_grantor.oid = a.grantor
   WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema';
   ```

4. **Esquemas / Namespaces (`pg_namespace`):**
   Utiliza `acldefault('n', n.nspowner)`:
   ```sql
   SELECT
       n.nspname AS schema_name,
       n.nspname AS object_name,
       'schema' AS object_type,
       NULL::text AS column_name,
       CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE r_grantee.rolname END AS grantee_name,
       r_grantor.rolname AS grantor_name,
       a.privilege_type,
       a.is_grantable
   FROM pg_namespace n
   CROSS JOIN LATERAL aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a
   LEFT JOIN pg_roles r_grantee ON r_grantee.oid = a.grantee
   LEFT JOIN pg_roles r_grantor ON r_grantor.oid = a.grantor
   WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema';
   ```

5. **Privilégios em Nível de Coluna (`pg_attribute.attacl`):**
   Comparação por identidade estável da coluna (`column_name`), tabela e papéis, utilizando `acldefault('c', c.relowner)` para colunas com concessões explícitas:
   ```sql
   SELECT
       n.nspname AS schema_name,
       c.relname AS object_name,
       'column' AS object_type,
       att.attname AS column_name,
       CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE r_grantee.rolname END AS grantee_name,
       r_grantor.rolname AS grantor_name,
       a.privilege_type,
       a.is_grantable
   FROM pg_attribute att
   JOIN pg_class c ON c.oid = att.attrelid
   JOIN pg_namespace n ON n.oid = c.relnamespace
   CROSS JOIN LATERAL aclexplode(coalesce(att.attacl, acldefault('c', c.relowner))) a
   LEFT JOIN pg_roles r_grantee ON r_grantee.oid = a.grantee
   LEFT JOIN pg_roles r_grantor ON r_grantor.oid = a.grantor
   WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema'
     AND att.attnum > 0 AND NOT att.attisdropped
     AND att.attacl IS NOT NULL;
   ```

- **Preservação de `PUBLIC`, Beneficiários e Concedentes:** Concessões a `PUBLIC` (`grantee = 0`) são expressamente identificadas e mapeadas, assim como as permissões concedidas a `authenticated`, `anon`, `postgres`, `dashboard_user`, `service_role` e demais roles.
- **Critério de Paridade por Confronto Bidirecional:** O confronto avalia a equivalência estrita de conjuntos via `EXCEPT` mútuo (origem EXCEPT destino = vazio; destino EXCEPT origem = vazio) preservando beneficiário, concedente, privilégio e a opção de concessão (`is_grantable`), com total independência dos OIDs numéricos do cluster.

#### 5.2.5 Matriz Sintética de Comparação Lado a Lado (Origem vs. Destino Restaurado)

| Vetor de Conformidade | Método de Verificação Automatizada | Critério Estrito de Aprovação |
| :--- | :--- | :--- |
| **1. Inventário Dinâmico de Esquemas e Tabelas** | Consulta a `pg_namespace`, `pg_attribute` e `pg_class` para todos os esquemas descobertos no escopo do backup. | 100% de coincidência em esquemas, tabelas, nomes de colunas, ordenação física ordinal (`attnum`), tipos de dados, nulabilidade e valores default. |
| **2. Constraints e Índices** | Consulta a `pg_catalog.pg_constraint` e `pg_index` em todos os esquemas descobertos. | 100% de coincidência de chaves primárias, chaves estrangeiras, regras de unicidade e expressões `CHECK`. |
| **3. Políticas e Status de RLS** | Consulta a `pg_catalog.pg_class.relrowsecurity` e `pg_policy` em todos os esquemas. | Habilitação idêntica de RLS em todas as tabelas; políticas ativas com as mesmas expressões (`qual`), comandos e roles associadas. |
| **4. Rotinas e Funções** | Confronto de `pg_proc` em todos os esquemas descobertos. | Coincidência exata de assinaturas, tipos de retorno, proprietários nominais reais (`rolname`), `prosecdef`, `proconfig` e definição canônica `pg_get_functiondef`. |
| **5. Privilégios e ACLs Estáveis** | Decomposição via `aclexplode()` e `acldefault` tipado (`'r'`, `'s'`, `'f'`, `'n'`, `'c'`) em tabelas, visões, sequências, funções, esquemas e colunas (`attacl`), mapeando para identidades nominais estáveis. | Confronto bidirecional via `EXCEPT` mútuo (origem EXCEPT destino = vazio; destino EXCEPT origem = vazio) preservando `PUBLIC`, beneficiários, concedentes, tipo de privilégio e opção `is_grantable`. |
| **6. Gatilhos (Triggers)** | Consulta a `pg_catalog.pg_trigger` (não internos) em todos os esquemas. | Mesmos gatilhos cadastrados, habilitados e vinculados às mesmas funções e eventos de disparo. |
| **7. Integridade Criptográfica de Conteúdo (Todas as Colunas)** | Agregação determinística por tabela de hashes `sha256` com argumentos `bytea` via `convert_to(..., 'UTF8')` sob sessões parametrizadas (Seção 5.2.2). | Coincidência exata de `table_data_hash` para todas as tabelas com colunas persistidas, operando como verificação criptográfica determinística de integridade de restauração. |
| **8. Contagens Relacionais** | Agrupamento de `COUNT(*)` por tabela para todo o inventário dinâmico. | Verificação complementar atestando paridade numérica exata de linhas em todas as tabelas existentes. |

### 5.3 Separação Formal dos Quatro Marcos de Recuperação
O ciclo operacional reconhece quatro marcos independentes e cumulativos:

```
[Marco 1: Planejamento Aprovado] ──► (Este documento formalizado e submetido à governança)
               │
               ▼
[Marco 2: Backup Gerado]        ──► (Arquivo .dump gerado, SHA-256 verificado, TOC validado)
               │
               ▼
[Marco 3: Restauração Executada] ──► (pg_restore finalizado com ExitCode 0 no destino)
               │
               ▼
[Marco 4: Recuperação Aceita]    ──► (Paridade de 100% comprovada na Matriz de Comparação 5.2)
```

> [!IMPORTANT]
> **Status Vigente:** Esta rodada atinge exclusivamente a elaboração documental do **Marco 1**. Os Marcos 2, 3 e 4 permanecem **NÃO EXECUTADOS** e dependem de decisões e autorizações expressas prévias.

---

## 6. Relação com as Próximas Etapas e Governança

### 6.1 Preservação das Demais Pendências da Issue #58
A formalização deste plano atende ao desenho técnico do Critério 4 da [Issue #58](https://github.com/dgnoleto/escala-do-reino/issues/58). Não encerra, não revoga e não dispensa as demais pendências:
- Reconciliação dos instaladores canônicos 017 a 020 (Critério 1);
- Verificação exaustiva de catálogo dos critérios R1 a R5 de planejamento (Critério 2A - Parcial);
- Comprovação integral de conformidade dos objetos de 021 e 022 (Critério 2B - Pendente);
- Compatibilidade ambiental de utilitários no Windows PowerShell 5.1 (Critério 6).

### 6.2 Sequenciamento Operacional Rumo ao Gate 3
1. **Etapa 1 (Esta Etapa):** Revisão e aprovação documental do Plano de Recuperação do Laboratório (Critério 4 da #58);
2. **Etapa 2 (Futura / Sujeita a Autorização):** Execução do backup e validação empírica de restore no banco efêmero `escala_recovery_verify_024` (Marcos 2 a 4), comprovando a capacidade real de recuperação do laboratório;
3. **Etapa 3 (Futura / Sujeita a Autorização):** Preparação atômica pré-HTTP no banco descartável `escala_rehearsal_024`:
   - Reconciliação da ACL de `app_private.has_church_settings_access(uuid, boolean)`;
   - Aplicação do hardening DDL de `public.instantiate_service_template(uuid, uuid, uuid)` do SQL 024;
   - Ambos sob a mesma transação controlada (`BEGIN ... COMMIT`) com asserções imperativas pré-commit e rollback automático diante de anomalias;
4. **Etapa 4 (Futura / Sujeita a Autorização):** Validação da Frente HTTP / PostgREST (Gate 3):
   - Iniciação do contêiner PostgREST temporário (porta 55355);
   - Execução dos testes H01 a H10 e quádruplo snapshot determinístico T0 a T3;
   - **Resolução Prévia do Teardown:** O trecho antigo de teardown documentado no roteiro consolidado que executava a restauração automática do código vulnerável do SQL 022 **não está autorizado**. O procedimento seguro de encerramento da frente HTTP deve ser definido e aprovado antes da execução dos testes de rede, respeitando a diretriz de não reinstalação de vulnerabilidades de vazamento entre igrejas (*cross-church leakage*).

---

## 7. Quadro Síntese de Autorizações e Decisões Pendentes

| Ação Futura Projetada | Objeto / Recurso Envolvido | Risco Mitigado | Decisão / Autorização Exigida |
| :--- | :--- | :--- | :--- |
| **Apreciação do Plano de Recuperação Revisado** | Documento `docs/operacao/PLANO-RECUPERACAO-LAB-SQL024.md` | Eliminação de fragilidades de consistência, validação incompleta e prova de artefato. | **Apreciação técnica do Codex e Aceite Formal do Responsável.** |
| **Aprovação da Opção 2 de Restauração** | Criação e descarte do banco efêmero `escala_recovery_verify_024` | Proteção da origem contra corrupção em caso de falha de restore. | **Decisão formal do responsável autorizando a Opção 2.** |
| **Geração do Backup Lógico (Marco 2)** | Banco `escala_rehearsal_024` no contêiner oficial sob snapshot exportado | Extração de snapshot imutável antes de qualquer alteração DDL. | **Autorização expressa para execução do `pg_dump` no laboratório.** |
| **Ensaio de Restauração e Confronto Analítico (Marcos 3 e 4)** | Banco efêmero `escala_recovery_verify_024` consumindo cópia transferida do host | Comprovação empírica de restauração do artefato arquivado sem tocar na origem. | **Autorização expressa para criação, restore e descarte do banco efêmero.** |
| **Preparação Atômica do SQL 024 (Fase A+B)** | ACL do helper e RPC `instantiate_service_template` | Eliminação da janela de exposição de segurança pré-HTTP. | **Autorização expressa para transação atômica DCL/DDL com COMMIT.** |
| **Abertura da Frente HTTP / Gate 3 (Fase C)** | PostgREST efêmero e tráfego de rede | Homologação final dos cenários H01–H10 e snapshots T0–T3. | **Autorização expressa para subida de contêiner e resolução prévia do teardown seguro.** |

---

## 8. Encerramento

O plano de recuperação e restauração verificável foi revisado e consolidado no presente documento, permanecendo sob o status de **Plano elaborado — em revisão, não aprovado**. Nenhuma execução foi realizada. O banco descartável, o contêiner de banco, o banco principal `postgres` e os arquivos congelados permanecem intactos.
