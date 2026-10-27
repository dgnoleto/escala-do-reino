<#
.SYNOPSIS
    Executor de Recuperação e Validação de Laboratório (Issue #58 - Critério 4).
    Alvo: Backup lógico de escala_rehearsal_024 e restauração verificável em escala_recovery_verify_024.
    Versão: 1.1 (Conforme Parecer Independente R1-R7 do Codex).
.DESCRIPTION
    Implementa as fases operacionais do Plano de Recuperação (docs/operacao/PLANO-RECUPERACAO-LAB-SQL024.md).
    
    MODO PADRÃO PASSIVO (Plan):
    A inicialização padrão apenas exibe o planejamento local e as salvaguardas, sem conectar ao banco,
    sem invocar Docker, sem criar diretórios de evidências no host e sem efetuar qualquer modificação.

    FASES OPERACIONAIS DISPONÍVEIS (-Phase):
    - Plan: Apresenta o planejamento, salvaguardas e parâmetros locais (padrão, passivo).
    - GuardOrigin: Audita guardas estritas da origem (OID, SysId, repouso operacional).
    - Backup: Extrai o backup lógico com snapshot exportado sincronizado, prova do artefato arquivado bidirecional e TOC.
    - CreateVerifyDb: Cria o banco efêmero isolado escala_recovery_verify_024 via conexão administrativa de controle.
    - RestoreVerify: Restaura a cópia reimportada do host no banco de validação via pg_restore transacional atômico.
    - CompareManifests: Extrai o manifesto do banco restaurado e executa a comparação canônica lado a lado.
    - DropVerifyDb: Remove o banco efêmero de validação após aprovação (exige -ExecutionRunId e -ConfirmDropVerifyDb).
    - CleanupContainerDumps: Limpa os dumps temporários do contêiner após homologação (exige -ExecutionRunId e -ConfirmCleanupContainer).

    DIRETRIZES DE GOVERNANÇA E SEGURANÇA:
    - Proteção absoluta de postgres, piloto e laboratórios preexistentes.
    - Validação de ambiente, cluster e identidade de alvos em todas as fases operacionais.
    - Preservação integral de logs e artefatos. Proibido apagar ou sobrescrever evidências em cenários de falha.
    - Dumps parciais decorrentes de encerramento da Sessão 1 são retidos e marcados como inválidos.
    - Não expõe linhas de negócio, dados de usuários ou credenciais (LGPD).
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [ValidateSet("Plan", "GuardOrigin", "Backup", "CreateVerifyDb", "RestoreVerify", "CompareManifests", "DropVerifyDb", "CleanupContainerDumps")]
    [string]$Phase = "Plan",

    [Parameter(Mandatory = $false)]
    [ValidatePattern('^[a-zA-Z0-9_\-]+$')]
    [string]$ContainerName = "supabase_db_escala-convites-http-lab",

    [Parameter(Mandatory = $false)]
    [ValidatePattern('^[a-zA-Z0-9_]+$')]
    [string]$OriginDatabase = "escala_rehearsal_024",

    [Parameter(Mandatory = $false)]
    [ValidatePattern('^[a-zA-Z0-9_]+$')]
    [string]$VerifyDatabase = "escala_recovery_verify_024",

    [Parameter(Mandatory = $false)]
    [ValidatePattern('^[a-zA-Z0-9_]+$')]
    [string]$AdminDatabase = "postgres",

    [Parameter(Mandatory = $false)]
    [ValidatePattern('^[a-zA-Z0-9_]+$')]
    [string]$DbUser = "postgres",

    [Parameter(Mandatory = $false)]
    [int]$ExpectedOriginOid = 198690,

    [Parameter(Mandatory = $false)]
    [string]$ExpectedSystemIdentifier = "7695064938894594085",

    [Parameter(Mandatory = $false)]
    [string]$WorkspaceRoot = "D:\Github\escala-do-reino",

    [Parameter(Mandatory = $false)]
    [ValidatePattern('^[a-zA-Z0-9_\-]*$')]
    [string]$ExecutionRunId = "",

    [Parameter(Mandatory = $false)]
    [switch]$ConfirmDropVerifyDb = $false,

    [Parameter(Mandatory = $false)]
    [switch]$ConfirmCleanupContainer = $false
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# R1/F4: Normalização e contenção estrita do WorkspaceRoot no diretório autorizado
$canonicalWorkspace = [System.IO.Path]::GetFullPath($WorkspaceRoot).TrimEnd('\', '/')
$authorizedWorkspace = [System.IO.Path]::GetFullPath("D:\Github\escala-do-reino").TrimEnd('\', '/')
if (-not (Test-Path -Path $canonicalWorkspace -PathType Container)) {
    throw "INTERRUPÇÃO OBRIGATÓRIA: WorkspaceRoot não encontrado: '$canonicalWorkspace'"
}
if (-not [string]::Equals($canonicalWorkspace, $authorizedWorkspace, [System.StringComparison]::OrdinalIgnoreCase) -and
    -not $canonicalWorkspace.StartsWith($authorizedWorkspace + "\", [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "INTERRUPÇÃO OBRIGATÓRIA: Violação de contenção: WorkspaceRoot ('$canonicalWorkspace') não está contido no repositório autorizado ('$authorizedWorkspace')."
}

# Configuração explícita de codificação UTF-8 sem BOM para saída de console
$utf8Encoding = [System.Text.Encoding]::UTF8
$OutputEncoding = $utf8Encoding
[Console]::InputEncoding = $utf8Encoding
[Console]::OutputEncoding = $utf8Encoding

# ------------------------------------------------------------------------------
# 0. FUNÇÕES AUXILIARES DE LOG E FORMATAÇÃO
# ------------------------------------------------------------------------------
function Write-Header {
    param([string]$Title)
    Write-Host ""
    Write-Host "================================================================================" -ForegroundColor White
    Write-Host " $Title" -ForegroundColor White
    Write-Host "================================================================================" -ForegroundColor White
}

function Write-InfoMsg {
    param([string]$Message)
    Write-Host "[INFO] $Message" -ForegroundColor Cyan
}

function Write-SuccessMsg {
    param([string]$Message)
    Write-Host "[PASS] $Message" -ForegroundColor Green
}

function Write-WarnMsg {
    param([string]$Message)
    Write-Host "[WARN] $Message" -ForegroundColor Yellow
}

function Write-ErrorAbort {
    param([string]$Message)
    Write-Host "[FATAL] $Message" -ForegroundColor Red
    throw "INTERRUPÇÃO OBRIGATÓRIA: $Message"
}

function Get-CurrentUtcIso {
    return [DateTime]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ")
}

# ------------------------------------------------------------------------------
# 1. RESOLUÇÃO DE IDENTIFICADORES E CAMINHOS DE EXECUÇÃO
# ------------------------------------------------------------------------------
$BaseScratchDir = Join-Path -Path $WorkspaceRoot -ChildPath "scratch\backups-lab"

if ($Phase -eq "Plan") {
    # Em modo Plan, usa ID ilustrativo sem criar diretórios nem exigir pré-condições
    $ResolvedRunId = if ([string]::IsNullOrEmpty($ExecutionRunId)) { "YYYYMMDD-HHMMSS" } else { $ExecutionRunId }
    $RunOutputDir = Join-Path -Path $BaseScratchDir -ChildPath "$ResolvedRunId-$OriginDatabase"
} elseif ($Phase -in @("GuardOrigin", "Backup")) {
    $ResolvedRunId = if ([string]::IsNullOrEmpty($ExecutionRunId)) { (Get-Date -Format "yyyyMMdd-HHmmss") } else { $ExecutionRunId }
    $RunOutputDir = Join-Path -Path $BaseScratchDir -ChildPath "$ResolvedRunId-$OriginDatabase"
    if ($Phase -eq "Backup") {
        # R1/F4: Proibir estritamente sobrescrita de tentativa ou qualquer evidência prévia
        if (Test-Path -Path $RunOutputDir) {
            $existingEntries = @(Get-ChildItem -Path $RunOutputDir -Force)
            if ($existingEntries.Count -gt 0) {
                Write-ErrorAbort "Sobrescrita proibida: o diretório de execução '$RunOutputDir' já existe e contém $($existingEntries.Count) artefatos prévios. Reuso de RunId é terminantemente proibido. Forneça um novo -ExecutionRunId."
            }
        }
    }
} else {
    # R1/R5: Fases subsequentes EXIGEM RunId explícito e diretório de tentativa válida prévia
    if ([string]::IsNullOrEmpty($ExecutionRunId)) {
        Write-ErrorAbort "A fase '$Phase' exige o parâmetro -ExecutionRunId correspondente à execução anterior."
    }
    $ResolvedRunId = $ExecutionRunId
    $RunOutputDir = Join-Path -Path $BaseScratchDir -ChildPath "$ResolvedRunId-$OriginDatabase"
    if (-not (Test-Path -Path $RunOutputDir -PathType Container)) {
        Write-ErrorAbort "Diretório da tentativa não encontrado em: $RunOutputDir"
    }
}


$HostDumpPath         = Join-Path -Path $RunOutputDir -ChildPath "$OriginDatabase.dump"
$HostSha256Path       = Join-Path -Path $RunOutputDir -ChildPath "$OriginDatabase.dump.sha256"
$HostTocPath          = Join-Path -Path $RunOutputDir -ChildPath "dump_toc.txt"
$OriginManifestPath   = Join-Path -Path $RunOutputDir -ChildPath "origin_manifest.json"
$RestoredManifestPath = Join-Path -Path $RunOutputDir -ChildPath "restored_manifest.json"
$ComparisonReportPath = Join-Path -Path $RunOutputDir -ChildPath "comparison_report.md"
$SessionMetadataPath  = Join-Path -Path $RunOutputDir -ChildPath "session_metadata.json"
$VerifyMetadataPath   = Join-Path -Path $RunOutputDir -ChildPath "verify_db_metadata.json"

$ContainerDumpPath    = "/tmp/${OriginDatabase}_${ResolvedRunId}.dump"
$ContainerRestorePath = "/tmp/restore_verify_${OriginDatabase}_${ResolvedRunId}.dump"

$ManifestSqlScript    = Join-Path -Path $WorkspaceRoot -ChildPath "docs\sql\024_recovery_manifest.sql"
$ComparatorScript     = Join-Path -Path $WorkspaceRoot -ChildPath "tools\compare-recovery-sql024.ps1"

# ------------------------------------------------------------------------------
# 2. FASE: PLAN (MODO PADRÃO PASSIVO E SEGURO)
# ------------------------------------------------------------------------------
if ($Phase -eq "Plan") {
    Write-Header "PLANEJAMENTO OPERACIONAL - RECUPERAÇÃO DO LABORATÓRIO (SQL 024)"
    Write-Host "Status: Inicialização Segura (Modo Passivo). Nenhuma operação executada." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "PARÂMETROS DE EXECUÇÃO CONFIGURADOS:" -ForegroundColor White
    Write-Host "  Contêiner Oficial:          $ContainerName"
    Write-Host "  Banco de Origem:            $OriginDatabase (OID: $ExpectedOriginOid, Cluster SysId: $ExpectedSystemIdentifier)"
    Write-Host "  Banco Efêmero de Validação: $VerifyDatabase"
    Write-Host "  Banco de Controle Admin:    $AdminDatabase"
    Write-Host "  Usuário PostgreSQL:         $DbUser"
    Write-Host "  Diretório Base no Host:     $BaseScratchDir"
    Write-Host "  Roteiro de Catálogo SQL:    $ManifestSqlScript"
    Write-Host "  Script Comparador:          $ComparatorScript"
    Write-Host ""
    Write-Host "SALVAGUARDAS TÉCNICAS E LIMITES DE GOVERNANÇA:" -ForegroundColor White
    Write-Host "  1. Isolamento: Proibido tocar no banco 'postgres' além de conexões administrativas de controle."
    Write-Host "  2. Piloto Remoto: Isolamento absoluto sem qualquer tráfego de rede ou autorização externa."
    Write-Host "  3. Consistência: Snapshot imutável mantido por sessão aberta e importado nas consultas."
    Write-Host "  4. Prova do Artefato: O restore utiliza estritamente o arquivo reimportado do host."
    Write-Host "  5. Não Exposição: Proibido logar dados pessoais, credenciais ou dumps (LGPD)."
    Write-Host "  6. Preservação: Dumps parciais e logs em caso de erro nunca são apagados."
    Write-Host ""
    Write-Host "FASES FUTURAS DISPONÍVEIS (EXIGEM AUTORIZAÇÃO EXPRESSA DO RESPONSÁVEL):" -ForegroundColor White
    Write-Host "  powershell -File tools/recovery-sql024.ps1 -Phase GuardOrigin"
    Write-Host "  powershell -File tools/recovery-sql024.ps1 -Phase Backup -ExecutionRunId <ID>"
    Write-Host "  powershell -File tools/recovery-sql024.ps1 -Phase CreateVerifyDb -ExecutionRunId <ID>"
    Write-Host "  powershell -File tools/recovery-sql024.ps1 -Phase RestoreVerify -ExecutionRunId <ID>"
    Write-Host "  powershell -File tools/recovery-sql024.ps1 -Phase CompareManifests -ExecutionRunId <ID>"
    Write-Host "  powershell -File tools/recovery-sql024.ps1 -Phase DropVerifyDb -ExecutionRunId <ID> -ConfirmDropVerifyDb"
    Write-Host "  powershell -File tools/recovery-sql024.ps1 -Phase CleanupContainerDumps -ExecutionRunId <ID> -ConfirmCleanupContainer"
    Write-Host ""
    Write-SuccessMsg "Planejamento exibido com sucesso. Nenhuma conexão aberta ou modificação realizada."
    exit 0
}

# ------------------------------------------------------------------------------
# 3. VERIFICAÇÃO DE DEPENDÊNCIAS DE ARQUIVOS LOCAIS
# ------------------------------------------------------------------------------
if (-not (Test-Path -Path $ManifestSqlScript -PathType Leaf)) {
    Write-ErrorAbort "Roteiro de manifesto SQL não encontrado: $ManifestSqlScript"
}

if (-not (Test-Path -Path $ComparatorScript -PathType Leaf)) {
    Write-ErrorAbort "Roteiro comparador PowerShell não encontrado: $ComparatorScript"
}

if ($Phase -eq "Backup") {
    if (-not (Test-Path -Path $RunOutputDir -PathType Container)) {
        New-Item -ItemType Directory -Path $RunOutputDir -Force | Out-Null
        Write-InfoMsg "Diretório de auditoria criado: $RunOutputDir"
    }
}

# ------------------------------------------------------------------------------
# 4. FUNÇÕES OPERACIONAIS SEGURAS (DRENAGEM ASSÍNCRONA SEM DEADLOCK - R5)
# ------------------------------------------------------------------------------
function Invoke-ProcessWithAsyncStreams {
    param(
        [string]$FileName,
        [string]$Arguments,
        [string]$InputContent = "",
        [int]$TimeoutMs = 120000
    )

    $psi = [System.Diagnostics.ProcessStartInfo]::new()
    $psi.FileName = $FileName
    $psi.Arguments = $Arguments
    $psi.RedirectStandardInput = [bool](-not [string]::IsNullOrEmpty($InputContent))
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true

    $proc = [System.Diagnostics.Process]::new()
    $proc.StartInfo = $psi

    if (-not $proc.Start()) {
        Write-ErrorAbort "Falha ao iniciar processo: $FileName $Arguments"
    }

    # R5: Drenagem assíncrona pura sem delegates de scriptblock do PowerShell no threadpool
    $stdoutTask = $proc.StandardOutput.ReadToEndAsync()
    $stderrTask = $proc.StandardError.ReadToEndAsync()

    if (-not [string]::IsNullOrEmpty($InputContent)) {
        $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
        $sw = [System.IO.StreamWriter]::new($proc.StandardInput.BaseStream, $utf8NoBom)
        $sw.Write($InputContent)
        $sw.Flush()
        $sw.Close()
    }

    $completed = $proc.WaitForExit($TimeoutMs)
    if (-not $completed) {
        try { $proc.Kill() } catch {}
        [void][System.Threading.Tasks.Task]::WaitAny(@($stdoutTask, $stderrTask), 2000)
        $partOut = if ($stdoutTask.IsCompleted) { $stdoutTask.Result.Trim() } else { "" }
        $partErr = if ($stderrTask.IsCompleted) { $stderrTask.Result.Trim() } else { "" }
        if (Test-Path -Path $RunOutputDir -PathType Container) {
            $timeoutLogPath = Join-Path -Path $RunOutputDir -ChildPath "process_timeout_dump.log"
            [System.IO.File]::WriteAllText($timeoutLogPath, "COMMAND: $FileName $Arguments`nTIMEOUT_MS: $TimeoutMs`nSTDOUT:`n$partOut`nSTDERR:`n$partErr", [System.Text.Encoding]::UTF8)
        }
        Write-ErrorAbort "Timeout de execução atingido ($TimeoutMs ms) para: $FileName $Arguments. Diagnóstico residual preservado. Saída: '$partOut' | Erros: '$partErr'"
    }
    [System.Threading.Tasks.Task]::WaitAll($stdoutTask, $stderrTask)

    return [pscustomobject]@{
        ExitCode = $proc.ExitCode
        StdOut   = $stdoutTask.Result.Trim()
        StdErr   = $stderrTask.Result.Trim()
    }
}

function Stop-RemoteContainerDumpProcess {
    param([string]$DumpTarget)
    Write-WarnMsg "Emitindo parada remota para processos vinculados a: $DumpTarget"

    if ([string]::IsNullOrWhiteSpace($DumpTarget)) {
        Write-WarnMsg "Parada remota abortada: DumpTarget ausente ou em branco."
        return [pscustomobject]@{
            ConfirmedStopped   = $false
            ObservationSuccess = $false
            Details            = "DumpTarget ausente ou em branco na solicitação de parada."
            StopMethod         = "ABORTED"
        }
    }
    
    $stopMethod = "SIGTERM"
    try {
        [void](Invoke-ProcessWithAsyncStreams -FileName "docker" -Arguments "exec $ContainerName pkill -f ""$DumpTarget""" -TimeoutMs 10000)
    } catch {
        Write-WarnMsg "Tentativa inicial de pkill falhou: $_"
    }
    
    # R5/F5: Script observador remoto enviado via STDIN para 'sh -s' (entrada interativa com 'docker exec -i').
    # A linha de comando do shell observador é estritamente 'sh -s', sem conter $DumpTarget em /proc/<pid>/cmdline,
    # garantindo que o próprio shell observador nunca seja correspondido pelo pgrep.
    # O retorno de pgrep é capturado imediatamente ($rc=$?):
    #   0 -> processo encontrado (PROCESS_RUNNING)
    #   1 -> nenhum processo correspondente (PROCESS_STOPPED)
    #   qualquer outro código (ex: 2 para erro de sintaxe, 127 para pgrep ausente) -> erro de observação.
    # Falha interna NUNCA emite PROCESS_STOPPED.
    $remoteScriptTemplate = @'
target='{0}'
pgrep -f "$target" >/dev/null 2>&1
rc=$?
if [ $rc -eq 0 ]; then
    echo "PROCESS_RUNNING"
elif [ $rc -eq 1 ]; then
    echo "PROCESS_STOPPED"
else
    echo "OBSERVATION_ERROR: pgrep exit code $rc"
fi
'@
    # Normaliza quebras de linha para LF puro (\n) para compatibilidade estrita POSIX em contêineres Linux (R6)
    $remoteScript = ($remoteScriptTemplate -f $DumpTarget).Replace("`r`n", "`n")

    $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    $stopped = $false
    $observationSuccess = $false
    $details = ""

    while ($stopwatch.ElapsedMilliseconds -lt 10000) {
        Start-Sleep -Milliseconds 500
        $res = $null
        try {
            $res = Invoke-ProcessWithAsyncStreams -FileName "docker" -Arguments "exec -i $ContainerName sh -s" -InputContent $remoteScript -TimeoutMs 5000
        } catch {
            $observationSuccess = $false
            $details = "Exceção ao invocar cliente Docker: $_"
            continue
        }

        if ($null -ne $res -and $res.ExitCode -eq 0) {
            $out = $res.StdOut.Trim()
            if ($out -eq "PROCESS_STOPPED") {
                $stopped = $true
                $observationSuccess = $true
                $details = "Comando remoto dentro do contêiner confirmou PROCESS_STOPPED com ExitCode 0."
                break
            } elseif ($out -eq "PROCESS_RUNNING") {
                $observationSuccess = $true
                $details = "Processo remoto ainda em execução (PROCESS_RUNNING)."
                # Escala para SIGKILL (-9)
                $stopMethod = "SIGKILL"
                try {
                    [void](Invoke-ProcessWithAsyncStreams -FileName "docker" -Arguments "exec $ContainerName pkill -9 -f ""$DumpTarget""" -TimeoutMs 5000)
                } catch {}
            } else {
                $observationSuccess = $false
                $details = "Saída inesperada do comando remoto: '$out' (StdErr: $($res.StdErr))"
            }
        } else {
            $observationSuccess = $false
            $ec = if ($null -ne $res) { $res.ExitCode } else { "null" }
            $err = if ($null -ne $res) { $res.StdErr } else { "sem retorno" }
            $details = "Falha do cliente Docker (ExitCode=$ec, Erro='$err'). Não comprova parada remota."
        }
    }

    if ($stopped -and $observationSuccess) {
        Write-SuccessMsg "Parada de processo remoto comprovada com sucesso no contêiner ($details)."
        return [pscustomobject]@{
            ConfirmedStopped   = $true
            ObservationSuccess = $true
            Details            = $details
            StopMethod         = $stopMethod
        }
    } elseif (-not $observationSuccess) {
        Write-WarnMsg "Falha de observação remota: $details"
        return [pscustomobject]@{
            ConfirmedStopped   = $false
            ObservationSuccess = $false
            Details            = $details
            StopMethod         = $stopMethod
        }
    } else {
        Write-WarnMsg "Atenção: Processo remoto '$DumpTarget' ainda ativo após timeout de parada ($details)."
        return [pscustomobject]@{
            ConfirmedStopped   = $false
            ObservationSuccess = $true
            Details            = $details
            StopMethod         = $stopMethod
        }
    }
}


function Invoke-PsqlQuery {
    param(
        [string]$TargetDb,
        [string]$SqlContent,
        [switch]$TupleOnly = $false,
        [int]$TimeoutMs = 60000
    )

    $tFlag = if ($TupleOnly) { "-t -A" } else { "" }
    # psql -X garante ausência de interferência de .psqlrc (R2)
    $args = "exec -i $ContainerName psql -X -q -U $DbUser -d $TargetDb -v ON_ERROR_STOP=1 $tFlag"
    $res = Invoke-ProcessWithAsyncStreams -FileName "docker" -Arguments $args -InputContent $SqlContent -TimeoutMs $TimeoutMs

    if ($res.ExitCode -ne 0) {
        Write-ErrorAbort "Falha na execução SQL em $TargetDb (ExitCode=$($res.ExitCode)): $($res.StdErr)"
    }
    return $res.StdOut
}

function Invoke-PsqlSnapshotQuery {
    param(
        [string]$TargetDb,
        [string]$SnapshotId,
        [string]$SqlContent,
        [switch]$TupleOnly = $false,
        [int]$TimeoutMs = 60000
    )

    # R2: Transação READ ONLY explícita importando o snapshot sincronizado e padronizando a sessão
    $wrappedSql = @"
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET TRANSACTION SNAPSHOT '$SnapshotId';
SET LOCAL TimeZone = 'UTC';
SET LOCAL datestyle = 'ISO, YMD';
SET LOCAL intervalstyle = 'iso_8601';
SET LOCAL extra_float_digits = 3;
SET LOCAL client_encoding = 'UTF8';
$SqlContent
COMMIT;
"@
    return Invoke-PsqlQuery -TargetDb $TargetDb -SqlContent $wrappedSql -TupleOnly:$TupleOnly -TimeoutMs $TimeoutMs
}

function Invoke-PsqlDestinationQuery {
    param(
        [string]$TargetDb,
        [string]$SqlContent,
        [switch]$TupleOnly = $false,
        [int]$TimeoutMs = 60000
    )

    # R2: Padronização idêntica de sessão na base de destino
    $wrappedSql = @"
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL TimeZone = 'UTC';
SET LOCAL datestyle = 'ISO, YMD';
SET LOCAL intervalstyle = 'iso_8601';
SET LOCAL extra_float_digits = 3;
SET LOCAL client_encoding = 'UTF8';
$SqlContent
COMMIT;
"@
    return Invoke-PsqlQuery -TargetDb $TargetDb -SqlContent $wrappedSql -TupleOnly:$TupleOnly -TimeoutMs $TimeoutMs
}

function Assert-ClusterEnvironment {
    # R1: Validar contêiner e cluster em todas as fases operacionais
    $stateRes = Invoke-ProcessWithAsyncStreams -FileName "docker" -Arguments "inspect --format ""{{.State.Running}}"" $ContainerName" -TimeoutMs 10000
    if ($stateRes.ExitCode -ne 0 -or $stateRes.StdOut -ne "true") {
        Write-ErrorAbort "Contêiner oficial '$ContainerName' não está em execução ou não foi encontrado."
    }

    $sysIdSql = "SELECT system_identifier::text FROM pg_control_system();"
    $actualSysId = Invoke-PsqlQuery -TargetDb $AdminDatabase -SqlContent $sysIdSql -TupleOnly

    if ($actualSysId -ne $ExpectedSystemIdentifier) {
        Write-ErrorAbort "Cluster System Identifier incorreto: esperado='$ExpectedSystemIdentifier', obtido='$actualSysId'"
    }
}

function Assert-OriginGuards {
    Assert-ClusterEnvironment

    Write-InfoMsg "Auditando guardas estritas de identidade do banco de origem '$OriginDatabase'..."
    $checkSql = "SELECT oid::text FROM pg_database WHERE datname = '$OriginDatabase';"
    $actualOid = Invoke-PsqlQuery -TargetDb $AdminDatabase -SqlContent $checkSql -TupleOnly

    if ([string]::IsNullOrEmpty($actualOid)) {
        Write-ErrorAbort "Banco de dados de origem '$OriginDatabase' não existe no cluster."
    }
    if ([int]$actualOid -ne $ExpectedOriginOid) {
        Write-ErrorAbort "Divergência crítica no OID do banco de origem: esperado=$ExpectedOriginOid, obtido=$actualOid"
    }

    Write-SuccessMsg "Guardas de identidade confirmadas (Nome=$OriginDatabase, OID=$actualOid, SysId=$ExpectedSystemIdentifier)."

    Write-InfoMsg "Auditando repouso operacional (zero conexões concorrentes)..."
    $activitySql = "SELECT count(*)::text FROM pg_stat_activity WHERE datname = '$OriginDatabase' AND pid <> pg_backend_pid();"
    $activeCount = [int](Invoke-PsqlQuery -TargetDb $OriginDatabase -SqlContent $activitySql -TupleOnly)

    if ($activeCount -gt 0) {
        Write-ErrorAbort "Violação de repouso operacional: detectadas $activeCount conexões concorrentes ativas em '$OriginDatabase'."
    }
    Write-SuccessMsg "Repouso operacional confirmado (0 conexões concorrentes)."

    # Telemetria auxiliar
    $telemetrySql = @"
SELECT
    pg_current_wal_lsn()::text || '|' ||
    coalesce(xact_commit::text, '0') || '|' ||
    coalesce(xact_rollback::text, '0')
FROM pg_stat_database
WHERE datname = '$OriginDatabase';
"@
    $telemetry = Invoke-PsqlQuery -TargetDb $OriginDatabase -SqlContent $telemetrySql -TupleOnly
    Write-InfoMsg "Telemetria auxiliar registrada: $telemetry (LSN|xact_commit|xact_rollback)"
}

# ------------------------------------------------------------------------------
# 5. EXECUÇÃO ESPECÍFICA DE CADA FASE OPERACIONAL
# ------------------------------------------------------------------------------

# --- FASE: GUARD ORIGIN ---
if ($Phase -eq "GuardOrigin") {
    Write-Header "FASE: CONFERÊNCIA DAS GUARDAS DA ORIGEM"
    Assert-OriginGuards
    Write-SuccessMsg "Auditoria de guardas concluída com êxito. Ambiente de origem aprovado para backup."
    exit 0
}

# --- FASE: BACKUP ---
if ($Phase -eq "Backup") {
    Write-Header "FASE: EXTRAÇÃO DE BACKUP LÓGICO E PROVA DO ARTEFATO"
    Assert-OriginGuards

    # F4: Captura OID do banco de origem para vínculo estrito de procedência
    $getOriginOidSql = "SELECT oid::text FROM pg_database WHERE datname = '$OriginDatabase';"
    $originOid = Invoke-PsqlQuery -TargetDb $AdminDatabase -SqlContent $getOriginOidSql -TupleOnly
    if ([string]::IsNullOrWhiteSpace($originOid)) {
        Write-ErrorAbort "Falha ao registrar OID do banco de origem '$OriginDatabase'."
    }

    Write-InfoMsg "Iniciando Sessão 1 (mantenedora de snapshot imutável)..."

    # Inicia processo psql interativo dedicado para a Sessão 1 com psql configurado
    $psiSession1 = [System.Diagnostics.ProcessStartInfo]::new()
    $psiSession1.FileName = "docker"
    $psiSession1.Arguments = "exec -i $ContainerName psql -X -q -t -A -U $DbUser -d $OriginDatabase -v ON_ERROR_STOP=1"
    $psiSession1.RedirectStandardInput = $true
    $psiSession1.RedirectStandardOutput = $true
    $psiSession1.RedirectStandardError = $true
    $psiSession1.UseShellExecute = $false
    $psiSession1.CreateNoWindow = $true

    $pSession1 = [System.Diagnostics.Process]::new()
    $pSession1.StartInfo = $psiSession1

    if (-not $pSession1.Start()) {
        Write-ErrorAbort "Falha ao iniciar Sessão 1 mantenedora de snapshot."
    }

    $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
    $sw1 = [System.IO.StreamWriter]::new($pSession1.StandardInput.BaseStream, $utf8NoBom)

    try {
        # 1. Abre transação REPEATABLE READ READ ONLY e exporta o snapshot
        $initSnapshotSql = @"
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT pg_export_snapshot();
"@
        $sw1.WriteLine($initSnapshotSql)
        $sw1.Flush()

        # Leitura assíncrona segura no .NET sem delegates de scriptblock do PowerShell
        $readTask = $pSession1.StandardOutput.ReadLineAsync()
        if (-not $readTask.Wait(15000)) {
            try { $pSession1.Kill() } catch {}
            Write-ErrorAbort "Falha ao obter identificador de snapshot exportado na Sessão 1 (Timeout 15s)."
        }
        $snapshotId = $readTask.Result.Trim()

        if (-not ($snapshotId -match '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{8}-[0-9]+$')) {
            try { $pSession1.Kill() } catch {}
            Write-ErrorAbort "Identificador de snapshot exportado inválido recebido da Sessão 1: '$snapshotId'"
        }
        Write-SuccessMsg "Sessão 1 ativa sob snapshot exportado imutável: '$snapshotId'"

        # 2. R2: Executa a extração do manifesto estrutural sob o MESMO snapshot via marcadores formais
        Write-InfoMsg "Extraindo catálogo estrutural sob o snapshot sincronizado via marcadores..."
        $manifestSqlCode = [System.IO.File]::ReadAllText($ManifestSqlScript, [System.Text.Encoding]::UTF8)
        
        if ($manifestSqlCode -match "(?s)-- BEGIN_SECTION_1_STRUCTURAL_MANIFEST\s*(.*?)\s*-- END_SECTION_1_STRUCTURAL_MANIFEST") {
            $section1Query = $matches[1].Trim()
        } else {
            Write-ErrorAbort "Marcadores formais da Seção 1 não encontrados em: $ManifestSqlScript"
        }

        if ($manifestSqlCode -match "(?s)-- BEGIN_SECTION_2_GENERATOR\s*(.*?)\s*-- END_SECTION_2_GENERATOR") {
            $section2Query = $matches[1].Trim()
        } else {
            Write-ErrorAbort "Marcadores formais da Seção 2 não encontrados em: $ManifestSqlScript"
        }

        $structuralJson = Invoke-PsqlSnapshotQuery -TargetDb $OriginDatabase -SnapshotId $snapshotId -SqlContent $section1Query -TupleOnly -TimeoutMs 90000

        # 3. R2: Executa o gerador da Seção 2 e decodifica o payload JSON diretamente
        Write-InfoMsg "Gerando consultas determinísticas de hash de tabelas e visões materializadas..."
        $hashQueriesRaw = Invoke-PsqlSnapshotQuery -TargetDb $OriginDatabase -SnapshotId $snapshotId -SqlContent $section2Query -TupleOnly -TimeoutMs 90000
        $dataHashes = @()

        if (-not [string]::IsNullOrWhiteSpace($hashQueriesRaw)) {
            $hashGenerators = @($hashQueriesRaw | ConvertFrom-Json | ForEach-Object { $_ })
            foreach ($gen in $hashGenerators) {
                if ($null -eq $gen.PSObject.Properties['schema_name'] -or [string]::IsNullOrWhiteSpace([string]$gen.schema_name) -or
                    $null -eq $gen.PSObject.Properties['table_name'] -or [string]::IsNullOrWhiteSpace([string]$gen.table_name) -or
                    $null -eq $gen.PSObject.Properties['table_hash_query'] -or [string]::IsNullOrWhiteSpace([string]$gen.table_hash_query)) {
                    Write-ErrorAbort "Gerador de hash inválido retornado na Seção 2: propriedades obrigatórias 'schema_name', 'table_name' ou 'table_hash_query' ausentes ou vazias."
                }
                $tSchema = [string]$gen.schema_name
                $tTable  = [string]$gen.table_name
                $qSql    = [string]$gen.table_hash_query

                # Executa a query da tabela sob o snapshot sincronizado; retorna JSON puro (R2)
                $tableJsonRaw = Invoke-PsqlSnapshotQuery -TargetDb $OriginDatabase -SnapshotId $snapshotId -SqlContent $qSql -TupleOnly -TimeoutMs 60000
                $tableObj = $tableJsonRaw | ConvertFrom-Json
                
                $dataHashes += [pscustomobject]@{
                    schema_name = [string]$tableObj.schema_name
                    table_name  = [string]$tableObj.table_name
                    row_count   = [int64]$tableObj.row_count
                    data_hash   = [string]$tableObj.data_hash
                }
            }
        }
        Write-SuccessMsg "Manifesto de dados gerado sob snapshot para $($dataHashes.Count) tabelas e visões materializadas."

        # R3/F4: Salva o manifesto canônico completo da origem sob contrato 1.1 vinculado ao RunId
        $manifestObj = [ordered]@{
            contract_version = "1.1"
            generated_at_utc = (Get-CurrentUtcIso)
            execution_run_id = $ResolvedRunId
            database_name    = $OriginDatabase
            snapshot_id      = $snapshotId
            structural       = ($structuralJson | ConvertFrom-Json)
            data_hashes      = $dataHashes
        }
        $manifestJsonText = ($manifestObj | ConvertTo-Json -Depth 10)
        [System.IO.File]::WriteAllText($OriginManifestPath, $manifestJsonText, [System.Text.Encoding]::UTF8)
        Write-SuccessMsg "Manifesto canônico da origem persistido em: $OriginManifestPath"

        # 4. Invocação de Sessão 2 (pg_dump sob o snapshot sincronizado)
        Write-InfoMsg "Invocando Sessão 2 (pg_dump sincronizado com snapshot '$snapshotId')..."
        
        $dumpArgs = "exec $ContainerName pg_dump -U $DbUser -d $OriginDatabase -F c --snapshot=`"$snapshotId`" -f `"$ContainerDumpPath`" --verbose"

        $psiDump = [System.Diagnostics.ProcessStartInfo]::new()
        $psiDump.FileName = "docker"
        $psiDump.Arguments = $dumpArgs
        $psiDump.RedirectStandardOutput = $true
        $psiDump.RedirectStandardError = $true
        $psiDump.UseShellExecute = $false
        $psiDump.CreateNoWindow = $true

        $pDump = [System.Diagnostics.Process]::new()
        $pDump.StartInfo = $psiDump

        if (-not $pDump.Start()) {
            Write-ErrorAbort "Falha ao iniciar processo pg_dump."
        }

        # Drenagem assíncrona pura do .NET
        $dumpOutTask = $pDump.StandardOutput.ReadToEndAsync()
        $dumpErrTask = $pDump.StandardError.ReadToEndAsync()

        # R5/F5: Monitoramento ativo com timeout de 300 segundos e tratamento seguro de interrupção
        $dumpStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
        $dumpTimeoutMs = 300000
        while (-not $pDump.HasExited) {
            Start-Sleep -Milliseconds 500
            if ($dumpStopwatch.ElapsedMilliseconds -gt $dumpTimeoutMs) {
                try { $pDump.Kill() } catch {}
                [void][System.Threading.Tasks.Task]::WaitAny(@($dumpOutTask, $dumpErrTask), 2000)
                $partOut = if ($dumpOutTask.IsCompleted) { $dumpOutTask.Result } else { "" }
                $partErr = if ($dumpErrTask.IsCompleted) { $dumpErrTask.Result } else { "" }
                $dumpLogPath = Join-Path -Path $RunOutputDir -ChildPath "pg_dump_execution.log"
                [System.IO.File]::WriteAllText($dumpLogPath, "STATUS: TIMEOUT_EXPIRED ($dumpTimeoutMs ms)`nSTDOUT:`n$partOut`nSTDERR:`n$partErr", [System.Text.Encoding]::UTF8)

                # Persiste metadados de falha imediatamente antes da tentativa de parada remota
                $metaTimeout = [ordered]@{
                    status              = "ABORTED_DUE_TO_TIMEOUT"
                    dump_valid          = $false
                    execution_run_id    = $ResolvedRunId
                    container_name      = $ContainerName
                    system_identifier   = $ExpectedSystemIdentifier
                    origin_database     = $OriginDatabase
                    origin_oid          = [int]$originOid
                    container_dump_path = $ContainerDumpPath
                    timestamp_utc       = (Get-CurrentUtcIso)
                }
                [System.IO.File]::WriteAllText($SessionMetadataPath, ($metaTimeout | ConvertTo-Json -Depth 5), [System.Text.Encoding]::UTF8)

                # F5 residual: Executa e consome formalmente a parada remota
                $stopRes = $null
                try {
                    $stopRes = Stop-RemoteContainerDumpProcess -DumpTarget $ContainerDumpPath
                } catch {
                    $stopRes = [pscustomobject]@{ ConfirmedStopped = $false; ObservationSuccess = $false; Details = "Exceção ao invocar parada remota: $_"; StopMethod = "ERROR" }
                    Write-WarnMsg "Aviso: Exceção ao tentar emitir parada remota: $_"
                }

                # Persiste o resultado da parada remota nos metadados e no log
                $metaTimeout["stop_attempt_confirmed"] = [bool]$stopRes.ConfirmedStopped
                $metaTimeout["stop_attempt_observation_success"] = [bool]$stopRes.ObservationSuccess
                $metaTimeout["stop_attempt_details"] = [string]$stopRes.Details
                $metaTimeout["stop_attempt_method"] = [string]$stopRes.StopMethod
                [System.IO.File]::WriteAllText($SessionMetadataPath, ($metaTimeout | ConvertTo-Json -Depth 5), [System.Text.Encoding]::UTF8)

                $stopLogText = "`n--- RESULTADO DA PARADA REMOTA ---`nConfirmedStopped: $($stopRes.ConfirmedStopped)`nObservationSuccess: $($stopRes.ObservationSuccess)`nDetails: $($stopRes.Details)`nMethod: $($stopRes.StopMethod)"
                [System.IO.File]::AppendAllText($dumpLogPath, $stopLogText, [System.Text.Encoding]::UTF8)

                Write-ErrorAbort "Timeout atingido durante a execução do pg_dump ($dumpTimeoutMs ms). Parada remota registrada (Confirmed=$($stopRes.ConfirmedStopped)). Log e metadados de invalidez preservados em: $dumpLogPath"
            }
            if ($pSession1.HasExited) {
                Write-WarnMsg "Sessão 1 caiu durante o pg_dump! Abortando extração local e remota..."
                try { $pDump.Kill() } catch {}
                [void][System.Threading.Tasks.Task]::WaitAny(@($dumpOutTask, $dumpErrTask), 2000)
                $partOut = if ($dumpOutTask.IsCompleted) { $dumpOutTask.Result } else { "" }
                $partErr = if ($dumpErrTask.IsCompleted) { $dumpErrTask.Result } else { "" }
                $dumpLogPath = Join-Path -Path $RunOutputDir -ChildPath "pg_dump_execution.log"
                [System.IO.File]::WriteAllText($dumpLogPath, "STATUS: ABORTED_DUE_TO_SESSION1_DROP`nSTDOUT:`n$partOut`nSTDERR:`n$partErr", [System.Text.Encoding]::UTF8)

                # R5: Registra formalmente a falha e retém o dump parcial como INVÁLIDO imediatamente
                $metaPartial = [ordered]@{
                    status              = "ABORTED_DUE_TO_SESSION1_DROP"
                    dump_valid          = $false
                    execution_run_id    = $ResolvedRunId
                    container_name      = $ContainerName
                    system_identifier   = $ExpectedSystemIdentifier
                    origin_database     = $OriginDatabase
                    origin_oid          = [int]$originOid
                    container_dump_path = $ContainerDumpPath
                    timestamp_utc       = (Get-CurrentUtcIso)
                }
                [System.IO.File]::WriteAllText($SessionMetadataPath, ($metaPartial | ConvertTo-Json -Depth 5), [System.Text.Encoding]::UTF8)

                # F5 residual: Executa e consome formalmente a parada remota
                $stopRes = $null
                try {
                    $stopRes = Stop-RemoteContainerDumpProcess -DumpTarget $ContainerDumpPath
                } catch {
                    $stopRes = [pscustomobject]@{ ConfirmedStopped = $false; ObservationSuccess = $false; Details = "Exceção ao invocar parada remota: $_"; StopMethod = "ERROR" }
                    Write-WarnMsg "Aviso: Exceção ao tentar emitir parada remota: $_"
                }

                # Persiste o resultado da parada remota nos metadados e no log
                $metaPartial["stop_attempt_confirmed"] = [bool]$stopRes.ConfirmedStopped
                $metaPartial["stop_attempt_observation_success"] = [bool]$stopRes.ObservationSuccess
                $metaPartial["stop_attempt_details"] = [string]$stopRes.Details
                $metaPartial["stop_attempt_method"] = [string]$stopRes.StopMethod
                [System.IO.File]::WriteAllText($SessionMetadataPath, ($metaPartial | ConvertTo-Json -Depth 5), [System.Text.Encoding]::UTF8)

                $stopLogText = "`n--- RESULTADO DA PARADA REMOTA ---`nConfirmedStopped: $($stopRes.ConfirmedStopped)`nObservationSuccess: $($stopRes.ObservationSuccess)`nDetails: $($stopRes.Details)`nMethod: $($stopRes.StopMethod)"
                [System.IO.File]::AppendAllText($dumpLogPath, $stopLogText, [System.Text.Encoding]::UTF8)

                Write-ErrorAbort "Dump parcial retido no contêiner ($ContainerDumpPath) marcado como INVÁLIDO. Parada remota registrada (Confirmed=$($stopRes.ConfirmedStopped)). Proibido utilizá-lo. Log preservado em $dumpLogPath."
            }
        }
        [System.Threading.Tasks.Task]::WaitAll($dumpOutTask, $dumpErrTask)

        $dumpLogPath = Join-Path -Path $RunOutputDir -ChildPath "pg_dump_execution.log"
        [System.IO.File]::WriteAllText($dumpLogPath, "$($dumpOutTask.Result)`n$($dumpErrTask.Result)", [System.Text.Encoding]::UTF8)

        if ($pDump.ExitCode -ne 0) {
            Write-ErrorAbort "pg_dump falhou com ExitCode=$($pDump.ExitCode). Log preservado em: $dumpLogPath"
        }
        Write-SuccessMsg "pg_dump concluído com êxito (ExitCode 0)."


        # 5. Encerra Sessão 1 de forma limpa (COMMIT)
        $sw1.WriteLine("COMMIT;")
        $sw1.Flush()
        $sw1.Close()
        $pSession1.WaitForExit(5000)
        Write-InfoMsg "Sessão 1 encerrada com COMMIT."

    } finally {
        if (-not $pSession1.HasExited) {
            try {
                $sw1.WriteLine("ROLLBACK;")
                $sw1.Flush()
                $sw1.Close()
                $pSession1.WaitForExit(2000)
            } catch {}
        }
    }

    # 6. Prova de Integridade e Trânsito Bidirecional (R5: checagem estrita de ExitCode)
    Write-InfoMsg "Conferindo integridade do dump no contêiner..."
    $statRes = Invoke-ProcessWithAsyncStreams -FileName "docker" -Arguments "exec $ContainerName stat -c ""%s"" $ContainerDumpPath" -TimeoutMs 10000
    if ($statRes.ExitCode -ne 0) { Write-ErrorAbort "Falha ao obter tamanho do dump no contêiner." }
    $containerSize = $statRes.StdOut.Trim()

    $shaRes = Invoke-ProcessWithAsyncStreams -FileName "docker" -Arguments "exec $ContainerName sha256sum $ContainerDumpPath" -TimeoutMs 30000
    if ($shaRes.ExitCode -ne 0) { Write-ErrorAbort "Falha ao obter SHA-256 do dump no contêiner." }
    $containerSha256 = $shaRes.StdOut.Split(' ')[0].Trim()
    Write-InfoMsg "Dump no Contêiner: Tamanho=$containerSize bytes, SHA-256=$containerSha256"

    Write-InfoMsg "Transferindo dump para o host via docker cp..."
    $cp1Res = Invoke-ProcessWithAsyncStreams -FileName "docker" -Arguments "cp ""${ContainerName}:${ContainerDumpPath}"" ""$HostDumpPath""" -TimeoutMs 60000
    if ($cp1Res.ExitCode -ne 0 -or -not (Test-Path -Path $HostDumpPath -PathType Leaf)) {
        Write-ErrorAbort "Falha na transferência do dump para o host via docker cp."
    }

    Write-InfoMsg "Validando cópia arquivada no host..."
    $hostSize = (Get-Item -Path $HostDumpPath).Length
    $hostSha256 = (Get-FileHash -Path $HostDumpPath -Algorithm SHA256).Hash.ToLower()

    if ($hostSize -ne [int64]$containerSize -or $hostSha256 -ne $containerSha256) {
        Write-ErrorAbort "Divergência crítica no trânsito contêiner -> host! Evidências preservadas em $RunOutputDir."
    }
    Write-SuccessMsg "Cópia no host validada: integridade de 100% comprovada."
    [System.IO.File]::WriteAllText($HostSha256Path, "$hostSha256  $OriginDatabase.dump`n", [System.Text.Encoding]::UTF8)

    # 7. Prova do Artefato Arquivado: Reimportação para novo caminho no contêiner
    Write-InfoMsg "Prova do Artefato: Reimportando cópia do host para '$ContainerRestorePath' no contêiner..."
    $cp2Res = Invoke-ProcessWithAsyncStreams -FileName "docker" -Arguments "cp ""$HostDumpPath"" ""${ContainerName}:${ContainerRestorePath}""" -TimeoutMs 60000
    if ($cp2Res.ExitCode -ne 0) {
        Write-ErrorAbort "Falha na reimportação host -> contêiner via docker cp."
    }

    $stat2Res = Invoke-ProcessWithAsyncStreams -FileName "docker" -Arguments "exec $ContainerName stat -c ""%s"" $ContainerRestorePath" -TimeoutMs 10000
    if ($stat2Res.ExitCode -ne 0) { Write-ErrorAbort "Falha ao obter tamanho do artefato reimportado." }
    $restoreTargetSize = $stat2Res.StdOut.Trim()

    $sha2Res = Invoke-ProcessWithAsyncStreams -FileName "docker" -Arguments "exec $ContainerName sha256sum $ContainerRestorePath" -TimeoutMs 30000
    if ($sha2Res.ExitCode -ne 0) { Write-ErrorAbort "Falha ao obter SHA-256 do artefato reimportado." }
    $restoreTargetSha256 = $sha2Res.StdOut.Split(' ')[0].Trim()

    if ($restoreTargetSize -ne [int64]$hostSize -or $restoreTargetSha256 -ne $hostSha256) {
        Write-ErrorAbort "Divergência crítica na reimportação host -> contêiner! Evidências preservadas."
    }
    Write-SuccessMsg "Artefato reimportado no contêiner verificado com sucesso."

    # 8. Inspeção de TOC via pg_restore --list
    Write-InfoMsg "Extraindo índice de objetos (TOC) a partir do artefato reimportado..."
    $tocRes = Invoke-ProcessWithAsyncStreams -FileName "docker" -Arguments "exec $ContainerName pg_restore --list `"$ContainerRestorePath`"" -TimeoutMs 30000
    if ($tocRes.ExitCode -ne 0) {
        Write-ErrorAbort "Falha na leitura do TOC com pg_restore: $($tocRes.StdErr)"
    }
    [System.IO.File]::WriteAllText($HostTocPath, $tocRes.StdOut, [System.Text.Encoding]::UTF8)
    Write-SuccessMsg "Índice TOC arquivado em: $HostTocPath"

    # Salva metadados de sessão sob contrato 1.1 e compatível com PS 5.1 (R6)
    $metaSuccess = [ordered]@{
        status                  = "BACKUP_COMPLETED_AND_VERIFIED"
        dump_valid              = $true
        execution_run_id        = $ResolvedRunId
        container_name          = $ContainerName
        system_identifier       = $ExpectedSystemIdentifier
        origin_database         = $OriginDatabase
        origin_oid              = [int]$originOid
        snapshot_id             = $snapshotId
        container_dump_path     = $ContainerDumpPath
        container_restore_path  = $ContainerRestorePath
        host_dump_path          = $HostDumpPath
        host_sha256             = $hostSha256
        dump_size_bytes         = $hostSize
        timestamp_utc           = (Get-CurrentUtcIso)
    }
    [System.IO.File]::WriteAllText($SessionMetadataPath, ($metaSuccess | ConvertTo-Json -Depth 5), [System.Text.Encoding]::UTF8)

    Write-SuccessMsg "Fase de Backup concluída com êxito absoluto. Artefatos e manifestos salvos."
    exit 0
}

# --- FASE: CREATE VERIFY DB ---
if ($Phase -eq "CreateVerifyDb") {
    Write-Header "FASE: CRIAÇÃO DO BANCO EFÊMERO DE VALIDAÇÃO"
    Assert-ClusterEnvironment

    Write-InfoMsg "Conferindo pré-condição: banco de destino '$VerifyDatabase' NÃO deve existir..."
    $checkDbSql = "SELECT 1 FROM pg_database WHERE datname = '$VerifyDatabase';"
    $exists = Invoke-PsqlQuery -TargetDb $AdminDatabase -SqlContent $checkDbSql -TupleOnly

    if ($exists -eq "1") {
        Write-ErrorAbort "Colisão de nome: banco '$VerifyDatabase' já existe no cluster. Execução interrompida."
    }

    Write-InfoMsg "Criando banco efêmero '$VerifyDatabase' via conexão administrativa a '$AdminDatabase'..."
    $createDbSql = "CREATE DATABASE $VerifyDatabase;"
    [void](Invoke-PsqlQuery -TargetDb $AdminDatabase -SqlContent $createDbSql)

    Write-InfoMsg "Capturando e registrando a nova identidade do banco criado..."
    $getOidSql = "SELECT oid::text FROM pg_database WHERE datname = '$VerifyDatabase';"
    $newOid = Invoke-PsqlQuery -TargetDb $AdminDatabase -SqlContent $getOidSql -TupleOnly

    if ([string]::IsNullOrEmpty($newOid)) {
        Write-ErrorAbort "Falha ao registrar OID do banco recém-criado '$VerifyDatabase'."
    }

    # R1/R4/R6: Registro imediato de identidade com SysId do cluster, contêiner e RunId
    $verifyMeta = [ordered]@{
        execution_run_id   = $ResolvedRunId
        container_name     = $ContainerName
        target_database    = $VerifyDatabase
        created_oid        = [int]$newOid
        system_identifier  = $ExpectedSystemIdentifier
        created_at_utc     = (Get-CurrentUtcIso)
    }
    [System.IO.File]::WriteAllText($VerifyMetadataPath, ($verifyMeta | ConvertTo-Json -Depth 5), [System.Text.Encoding]::UTF8)

    Write-SuccessMsg "Banco efêmero '$VerifyDatabase' criado com sucesso (OID=$newOid). Registro salvo em: $VerifyMetadataPath"
    exit 0
}

# --- FASE: RESTORE VERIFY ---
if ($Phase -eq "RestoreVerify") {
    Write-Header "FASE: RESTAURAÇÃO NO BANCO EFÊMERO DE VALIDAÇÃO"
    Assert-ClusterEnvironment

    # R1/R4: Guardas de procedência e validação estrita do dump pré-restauração
    if (-not (Test-Path -Path $SessionMetadataPath -PathType Leaf)) {
        Write-ErrorAbort "Metadados de sessão não encontrados em: $SessionMetadataPath"
    }
    $sessionMeta = [System.IO.File]::ReadAllText($SessionMetadataPath, [System.Text.Encoding]::UTF8) | ConvertFrom-Json

    # Validação estrita: ausente, vazio, tipo inválido ou divergente bloqueia a execução
    if ($null -eq $sessionMeta.PSObject.Properties['dump_valid'] -or -not ($sessionMeta.dump_valid -is [bool]) -or $sessionMeta.dump_valid -ne $true) {
        Write-ErrorAbort "Tentativa bloqueada: o campo 'dump_valid' nos metadados de sessão está ausente, não é do tipo booleano JSON ou está marcado como falso ($($sessionMeta.status))."
    }
    if ($null -eq $sessionMeta.PSObject.Properties['execution_run_id'] -or [string]::IsNullOrWhiteSpace([string]$sessionMeta.execution_run_id) -or [string]$sessionMeta.execution_run_id -ne $ResolvedRunId) {
        Write-ErrorAbort "Guarda de procedência violada: execution_run_id nos metadados de sessão ausente, vazio ou divergente da tentativa atual ($ResolvedRunId)."
    }
    if ($null -eq $sessionMeta.PSObject.Properties['container_name'] -or [string]::IsNullOrWhiteSpace([string]$sessionMeta.container_name) -or [string]$sessionMeta.container_name -ne $ContainerName) {
        Write-ErrorAbort "Guarda violada: container_name nos metadados de sessão ausente, vazio ou divergente ($($sessionMeta.container_name) vs $ContainerName)."
    }
    if ($null -eq $sessionMeta.PSObject.Properties['system_identifier'] -or [string]::IsNullOrWhiteSpace([string]$sessionMeta.system_identifier) -or [string]$sessionMeta.system_identifier -ne $ExpectedSystemIdentifier) {
        Write-ErrorAbort "Guarda violada: system_identifier nos metadados de sessão ausente, vazio ou divergente ($($sessionMeta.system_identifier) vs $ExpectedSystemIdentifier)."
    }
    if ($null -eq $sessionMeta.PSObject.Properties['origin_database'] -or [string]::IsNullOrWhiteSpace([string]$sessionMeta.origin_database) -or [string]$sessionMeta.origin_database -ne $OriginDatabase) {
        Write-ErrorAbort "Guarda violada: origin_database nos metadados de sessão ausente, vazio ou divergente ($($sessionMeta.origin_database) vs $OriginDatabase)."
    }
    if ($null -eq $sessionMeta.PSObject.Properties['origin_oid'] -or -not ($sessionMeta.origin_oid -is [int] -or $sessionMeta.origin_oid -is [long] -or ($sessionMeta.origin_oid -as [int64])) -or [int64]$sessionMeta.origin_oid -ne [int64]$ExpectedOriginOid) {
        Write-ErrorAbort "Guarda violada: origin_oid nos metadados de sessão ausente, de tipo inválido ou diverge do OID autorizado da origem ($($sessionMeta.origin_oid) vs $ExpectedOriginOid)."
    }
    if ($null -eq $sessionMeta.PSObject.Properties['container_restore_path'] -or [string]::IsNullOrWhiteSpace([string]$sessionMeta.container_restore_path) -or [string]$sessionMeta.container_restore_path -ne $ContainerRestorePath) {
        Write-ErrorAbort "Guarda violada: container_restore_path nos metadados de sessão ausente, vazio ou divergente ($($sessionMeta.container_restore_path) vs $ContainerRestorePath)."
    }

    if (-not (Test-Path -Path $VerifyMetadataPath -PathType Leaf)) {
        Write-ErrorAbort "Metadados de criação do banco efêmero não encontrados em: $VerifyMetadataPath"
    }
    $verifyMeta = [System.IO.File]::ReadAllText($VerifyMetadataPath, [System.Text.Encoding]::UTF8) | ConvertFrom-Json

    # Validação estrita de verifyMeta: ausente, vazio, tipo inválido ou divergente bloqueia
    if ($null -eq $verifyMeta.PSObject.Properties['execution_run_id'] -or [string]::IsNullOrWhiteSpace([string]$verifyMeta.execution_run_id) -or [string]$verifyMeta.execution_run_id -ne $ResolvedRunId) {
        Write-ErrorAbort "Guarda de procedência violada: execution_run_id nos metadados do banco efêmero ausente, vazio ou divergente da tentativa atual ($ResolvedRunId)."
    }
    if ($null -eq $verifyMeta.PSObject.Properties['container_name'] -or [string]::IsNullOrWhiteSpace([string]$verifyMeta.container_name) -or [string]$verifyMeta.container_name -ne $ContainerName) {
        Write-ErrorAbort "Guarda violada: container_name nos metadados do banco efêmero ausente, vazio ou divergente ($($verifyMeta.container_name) vs $ContainerName)."
    }
    if ($null -eq $verifyMeta.PSObject.Properties['system_identifier'] -or [string]::IsNullOrWhiteSpace([string]$verifyMeta.system_identifier) -or [string]$verifyMeta.system_identifier -ne $ExpectedSystemIdentifier) {
        Write-ErrorAbort "Guarda violada: system_identifier do banco efêmero ausente, vazio ou divergente do cluster esperado ($($verifyMeta.system_identifier) vs $ExpectedSystemIdentifier)."
    }
    if ($null -eq $verifyMeta.PSObject.Properties['target_database'] -or [string]::IsNullOrWhiteSpace([string]$verifyMeta.target_database) -or [string]$verifyMeta.target_database -ne $VerifyDatabase) {
        Write-ErrorAbort "Guarda violada: target_database nos metadados ausente, vazio ou divergente do banco esperado ($($verifyMeta.target_database) vs $VerifyDatabase)."
    }
    if ($null -eq $verifyMeta.PSObject.Properties['created_oid'] -or -not ($verifyMeta.created_oid -is [int] -or $verifyMeta.created_oid -is [long] -or ($verifyMeta.created_oid -as [int64])) -or [int64]$verifyMeta.created_oid -le 0) {
        Write-ErrorAbort "Guarda violada: created_oid nos metadados do banco efêmero ausente ou de tipo/valor inválido."
    }

    # R1: Conferir OID e destino no cluster
    $currentOidSql = "SELECT oid::text FROM pg_database WHERE datname = '$VerifyDatabase';"
    $currentOid = Invoke-PsqlQuery -TargetDb $AdminDatabase -SqlContent $currentOidSql -TupleOnly
    if ([string]::IsNullOrEmpty($currentOid) -or [int64]$currentOid -ne [int64]$verifyMeta.created_oid) {
        Write-ErrorAbort "Guarda violada: o OID atual do banco '$VerifyDatabase' ($currentOid) diverge do OID registrado na criação ($($verifyMeta.created_oid))."
    }

    # R1: Reconfirmar tamanho e hash do artefato no contêiner antes do restore
    Write-InfoMsg "Reconfirmando integridade do artefato '$ContainerRestorePath' no contêiner..."
    $checkShaRes = Invoke-ProcessWithAsyncStreams -FileName "docker" -Arguments "exec $ContainerName sha256sum $ContainerRestorePath" -TimeoutMs 30000
    if ($checkShaRes.ExitCode -ne 0) { Write-ErrorAbort "Artefato de restore não acessível no contêiner." }
    $currentRestoreSha = $checkShaRes.StdOut.Split(' ')[0].Trim()

    if ($null -eq $sessionMeta.PSObject.Properties['host_sha256'] -or [string]::IsNullOrWhiteSpace([string]$sessionMeta.host_sha256) -or $currentRestoreSha -ne [string]$sessionMeta.host_sha256) {
        Write-ErrorAbort "Divergência de hash antes do restore! Esperado='$($sessionMeta.host_sha256)', Obtido='$currentRestoreSha'"
    }
    Write-SuccessMsg "Integridade do artefato reconfirmada antes da restauração."

    Write-InfoMsg "Executando pg_restore transacional atômico no banco '$VerifyDatabase'..."
    Write-InfoMsg "Opções ativas: --exit-on-error, --single-transaction, --verbose"

    $restoreLogPath = Join-Path -Path $RunOutputDir -ChildPath "pg_restore_execution.log"
    $restoreArgs = "exec $ContainerName pg_restore -U $DbUser -d $VerifyDatabase --exit-on-error --single-transaction --verbose `"$ContainerRestorePath`""
    
    # R5/F5: Execução com captura concorrente assíncrona e preservação de log sob qualquer desfecho
    $restoreRes = $null
    try {
        $restoreRes = Invoke-ProcessWithAsyncStreams -FileName "docker" -Arguments $restoreArgs -TimeoutMs 180000
        [System.IO.File]::WriteAllText($restoreLogPath, "$($restoreRes.StdOut)`n$($restoreRes.StdErr)", [System.Text.Encoding]::UTF8)
    } catch {
        $timeoutLog = Join-Path -Path $RunOutputDir -ChildPath "process_timeout_dump.log"
        if (Test-Path -Path $timeoutLog -PathType Leaf) {
            Copy-Item -Path $timeoutLog -Destination $restoreLogPath -Force
        } else {
            [System.IO.File]::WriteAllText($restoreLogPath, "FALHA/EXCEÇÃO DURANTE PG_RESTORE:`n$($_.Exception.Message)", [System.Text.Encoding]::UTF8)
        }
        throw
    }

    if ($restoreRes.ExitCode -ne 0) {
        Write-ErrorAbort "pg_restore falhou com ExitCode=$($restoreRes.ExitCode). Rollback automático efetuado. Log preservado em: $restoreLogPath"
    }

    Write-SuccessMsg "Restauração atômica concluída com êxito absoluto (ExitCode 0). Log: $restoreLogPath"
    exit 0
}

# --- FASE: COMPARE MANIFESTS ---
if ($Phase -eq "CompareManifests") {
    Write-Header "FASE: EXTRAÇÃO DO MANIFESTO RESTAURADO E CONFRONTO LADO A LADO"
    Assert-ClusterEnvironment

    if (-not (Test-Path -Path $OriginManifestPath -PathType Leaf)) {
        Write-ErrorAbort "Manifesto de origem não encontrado: $OriginManifestPath"
    }
    $originManifestRaw = [System.IO.File]::ReadAllText($OriginManifestPath, [System.Text.Encoding]::UTF8)
    $originManifestObj = $originManifestRaw | ConvertFrom-Json
    if ($null -eq $originManifestObj.PSObject.Properties['contract_version'] -or [string]::IsNullOrWhiteSpace([string]$originManifestObj.contract_version) -or [string]$originManifestObj.contract_version -ne "1.1") {
        Write-ErrorAbort "Manifesto de origem inválido: contract_version ausente, vazio ou diverge de '1.1'."
    }
    if ($null -eq $originManifestObj.PSObject.Properties['execution_run_id'] -or [string]::IsNullOrWhiteSpace([string]$originManifestObj.execution_run_id) -or [string]$originManifestObj.execution_run_id -ne $ResolvedRunId) {
        Write-ErrorAbort "Manifesto de origem inválido: execution_run_id ausente, vazio ou diverge da tentativa atual ($ResolvedRunId)."
    }
    if ($null -eq $originManifestObj.PSObject.Properties['database_name'] -or [string]::IsNullOrWhiteSpace([string]$originManifestObj.database_name) -or [string]$originManifestObj.database_name -ne $OriginDatabase) {
        Write-ErrorAbort "Manifesto de origem inválido: database_name ausente, vazio ou diverge do banco de origem esperado ($OriginDatabase)."
    }

    if (-not (Test-Path -Path $VerifyMetadataPath -PathType Leaf)) {
        Write-ErrorAbort "Metadados de criação do banco efêmero não encontrados em: $VerifyMetadataPath. Comparação bloqueada."
    }
    $verifyMeta = [System.IO.File]::ReadAllText($VerifyMetadataPath, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
    if ($null -eq $verifyMeta.PSObject.Properties['execution_run_id'] -or [string]::IsNullOrWhiteSpace([string]$verifyMeta.execution_run_id) -or [string]$verifyMeta.execution_run_id -ne $ResolvedRunId) {
        Write-ErrorAbort "Metadados do banco efêmero inválidos: execution_run_id ausente, vazio ou diverge de $ResolvedRunId."
    }
    if ($null -eq $verifyMeta.PSObject.Properties['target_database'] -or [string]::IsNullOrWhiteSpace([string]$verifyMeta.target_database) -or [string]$verifyMeta.target_database -ne $VerifyDatabase) {
        Write-ErrorAbort "Metadados do banco efêmero inválidos: target_database ausente, vazio ou diverge de $VerifyDatabase."
    }
    if ($null -eq $verifyMeta.PSObject.Properties['container_name'] -or [string]::IsNullOrWhiteSpace([string]$verifyMeta.container_name) -or [string]$verifyMeta.container_name -ne $ContainerName) {
        Write-ErrorAbort "Metadados do banco efêmero inválidos: container_name ausente, vazio ou diverge de $ContainerName."
    }
    if ($null -eq $verifyMeta.PSObject.Properties['system_identifier'] -or [string]::IsNullOrWhiteSpace([string]$verifyMeta.system_identifier) -or [string]$verifyMeta.system_identifier -ne $ExpectedSystemIdentifier) {
        Write-ErrorAbort "Metadados do banco efêmero inválidos: system_identifier ausente, vazio ou diverge de $ExpectedSystemIdentifier."
    }
    if ($null -eq $verifyMeta.PSObject.Properties['created_oid'] -or -not ($verifyMeta.created_oid -is [int] -or $verifyMeta.created_oid -is [long] -or ($verifyMeta.created_oid -as [int64])) -or [int64]$verifyMeta.created_oid -le 0) {
        Write-ErrorAbort "Metadados do banco efêmero inválidos: created_oid ausente ou de tipo/valor inválido."
    }

    # R1/F4: Conferir OID do destino no cluster antes da extração para comparação
    $curVerifyOidSql = "SELECT oid::text FROM pg_database WHERE datname = '$VerifyDatabase';"
    $curVerifyOid = Invoke-PsqlQuery -TargetDb $AdminDatabase -SqlContent $curVerifyOidSql -TupleOnly
    if ([string]::IsNullOrEmpty($curVerifyOid) -or [int64]$curVerifyOid -ne [int64]$verifyMeta.created_oid) {
        Write-ErrorAbort "Guarda de procedência violada na comparação: OID atual do banco '$VerifyDatabase' ($curVerifyOid) diverge do OID registrado na criação ($($verifyMeta.created_oid))."
    }

    if (-not (Test-Path -Path $SessionMetadataPath -PathType Leaf)) {
        Write-ErrorAbort "Metadados de sessão não encontrados em: $SessionMetadataPath. Comparação bloqueada."
    }
    $sessionMeta = [System.IO.File]::ReadAllText($SessionMetadataPath, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
    if ($null -eq $sessionMeta.PSObject.Properties['execution_run_id'] -or [string]::IsNullOrWhiteSpace([string]$sessionMeta.execution_run_id) -or [string]$sessionMeta.execution_run_id -ne $ResolvedRunId) {
        Write-ErrorAbort "Metadados de sessão inválidos: execution_run_id ausente, vazio ou diverge de $ResolvedRunId."
    }
    if ($null -eq $sessionMeta.PSObject.Properties['dump_valid'] -or -not ($sessionMeta.dump_valid -is [bool]) -or $sessionMeta.dump_valid -ne $true) {
        Write-ErrorAbort "Metadados de sessão acusam dump_valid ausente, de tipo não-booleano JSON ou falso. Não é possível comparar manifestos de uma sessão sem dump válido comprovado."
    }
    if ($null -eq $sessionMeta.PSObject.Properties['container_name'] -or [string]::IsNullOrWhiteSpace([string]$sessionMeta.container_name) -or [string]$sessionMeta.container_name -ne $ContainerName) {
        Write-ErrorAbort "Metadados de sessão inválidos: container_name ausente, vazio ou diverge ($($sessionMeta.container_name) vs $ContainerName)."
    }
    if ($null -eq $sessionMeta.PSObject.Properties['system_identifier'] -or [string]::IsNullOrWhiteSpace([string]$sessionMeta.system_identifier) -or [string]$sessionMeta.system_identifier -ne $ExpectedSystemIdentifier) {
        Write-ErrorAbort "Metadados de sessão inválidos: system_identifier ausente, vazio ou diverge ($($sessionMeta.system_identifier) vs $ExpectedSystemIdentifier)."
    }
    if ($null -eq $sessionMeta.PSObject.Properties['origin_database'] -or [string]::IsNullOrWhiteSpace([string]$sessionMeta.origin_database) -or [string]$sessionMeta.origin_database -ne $OriginDatabase) {
        Write-ErrorAbort "Metadados de sessão inválidos: origin_database ausente, vazio ou diverge ($($sessionMeta.origin_database) vs $OriginDatabase)."
    }
    if ($null -eq $sessionMeta.PSObject.Properties['origin_oid'] -or -not ($sessionMeta.origin_oid -is [int] -or $sessionMeta.origin_oid -is [long] -or ($sessionMeta.origin_oid -as [int64])) -or [int64]$sessionMeta.origin_oid -ne [int64]$ExpectedOriginOid) {
        Write-ErrorAbort "Metadados de sessão inválidos: origin_oid ausente, de tipo inválido ou diverge do OID autorizado ($($sessionMeta.origin_oid) vs $ExpectedOriginOid)."
    }

    Write-InfoMsg "Extraindo catálogo estrutural do banco restaurado '$VerifyDatabase'..."
    $manifestSqlCode = [System.IO.File]::ReadAllText($ManifestSqlScript, [System.Text.Encoding]::UTF8)
    
    if ($manifestSqlCode -match "(?s)-- BEGIN_SECTION_1_STRUCTURAL_MANIFEST\s*(.*?)\s*-- END_SECTION_1_STRUCTURAL_MANIFEST") {
        $section1Query = $matches[1].Trim()
    } else {
        Write-ErrorAbort "Marcadores formais da Seção 1 não encontrados em: $ManifestSqlScript"
    }

    if ($manifestSqlCode -match "(?s)-- BEGIN_SECTION_2_GENERATOR\s*(.*?)\s*-- END_SECTION_2_GENERATOR") {
        $section2Query = $matches[1].Trim()
    } else {
        Write-ErrorAbort "Marcadores formais da Seção 2 não encontrados em: $ManifestSqlScript"
    }

    # R2/R3: Iniciar sessão de leitura consistente com snapshot no banco restaurado para perfeita simetria
    $psiDestSession = [System.Diagnostics.ProcessStartInfo]::new()
    $psiDestSession.FileName = "docker"
    $psiDestSession.Arguments = "exec -i $ContainerName psql -X -q -t -A -U $DbUser -d $VerifyDatabase -v ON_ERROR_STOP=1"
    $psiDestSession.RedirectStandardInput = $true
    $psiDestSession.RedirectStandardOutput = $true
    $psiDestSession.RedirectStandardError = $true
    $psiDestSession.UseShellExecute = $false
    $psiDestSession.CreateNoWindow = $true

    $pDestSession = [System.Diagnostics.Process]::new()
    $pDestSession.StartInfo = $psiDestSession
    if (-not $pDestSession.Start()) {
        Write-ErrorAbort "Falha ao iniciar sessão mantenedora de snapshot no banco restaurado."
    }

    $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
    $swDest = [System.IO.StreamWriter]::new($pDestSession.StandardInput.BaseStream, $utf8NoBom)

    try {
        $swDest.WriteLine("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;")
        $swDest.WriteLine("SELECT pg_export_snapshot();")
        $swDest.Flush()

        $destReadTask = $pDestSession.StandardOutput.ReadLineAsync()
        if (-not $destReadTask.Wait(15000)) {
            try { $pDestSession.Kill() } catch {}
            Write-ErrorAbort "Falha ao obter snapshot exportado do banco restaurado (Timeout 15s)."
        }
        $destSnapshotId = $destReadTask.Result.Trim()

        if (-not ($destSnapshotId -match '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{8}-[0-9]+$')) {
            try { $pDestSession.Kill() } catch {}
            Write-ErrorAbort "Identificador de snapshot exportado inválido recebido do destino: '$destSnapshotId'"
        }
        Write-SuccessMsg "Banco restaurado ativo sob snapshot imutável: '$destSnapshotId'"

        $restoredStructuralJson = Invoke-PsqlSnapshotQuery -TargetDb $VerifyDatabase -SnapshotId $destSnapshotId -SqlContent $section1Query -TupleOnly -TimeoutMs 90000

        Write-InfoMsg "Calculando hashes determinísticos de conteúdo de dados no banco restaurado via JSON..."
        $restHashQueriesRaw = Invoke-PsqlSnapshotQuery -TargetDb $VerifyDatabase -SnapshotId $destSnapshotId -SqlContent $section2Query -TupleOnly -TimeoutMs 90000
        $restDataHashes = @()

        if (-not [string]::IsNullOrWhiteSpace($restHashQueriesRaw)) {
            $destGenerators = @($restHashQueriesRaw | ConvertFrom-Json | ForEach-Object { $_ })
            foreach ($gen in $destGenerators) {
                if ($null -eq $gen.PSObject.Properties['schema_name'] -or [string]::IsNullOrWhiteSpace([string]$gen.schema_name) -or
                    $null -eq $gen.PSObject.Properties['table_name'] -or [string]::IsNullOrWhiteSpace([string]$gen.table_name) -or
                    $null -eq $gen.PSObject.Properties['table_hash_query'] -or [string]::IsNullOrWhiteSpace([string]$gen.table_hash_query)) {
                    Write-ErrorAbort "Gerador de hash inválido retornado na Seção 2 do banco restaurado: propriedades obrigatórias ausentes ou vazias."
                }
                $tSchema = [string]$gen.schema_name
                $tTable  = [string]$gen.table_name
                $qSql    = [string]$gen.table_hash_query

                $tableJsonRaw = Invoke-PsqlSnapshotQuery -TargetDb $VerifyDatabase -SnapshotId $destSnapshotId -SqlContent $qSql -TupleOnly -TimeoutMs 60000
                $tableObj = $tableJsonRaw | ConvertFrom-Json
                
                $restDataHashes += [pscustomobject]@{
                    schema_name = [string]$tableObj.schema_name
                    table_name  = [string]$tableObj.table_name
                    row_count   = [int64]$tableObj.row_count
                    data_hash   = [string]$tableObj.data_hash
                }
            }
        }

        $swDest.WriteLine("COMMIT;")
        $swDest.Flush()
        $swDest.Close()
        $pDestSession.WaitForExit(5000)
    } finally {
        if (-not $pDestSession.HasExited) {
            try {
                $swDest.WriteLine("ROLLBACK;")
                $swDest.Flush()
                $swDest.Close()
                $pDestSession.WaitForExit(2000)
            } catch {}
        }
    }

    # R3: Salva o manifesto restaurado sob contrato 1.1 vinculado ao RunId e snapshot
    $restoredManifestObj = [ordered]@{
        contract_version = "1.1"
        generated_at_utc = (Get-CurrentUtcIso)
        execution_run_id = $ResolvedRunId
        database_name    = $VerifyDatabase
        snapshot_id      = $destSnapshotId
        structural       = ($restoredStructuralJson | ConvertFrom-Json)
        data_hashes      = $restDataHashes
    }
    $restoredJsonText = ($restoredManifestObj | ConvertTo-Json -Depth 10)
    [System.IO.File]::WriteAllText($RestoredManifestPath, $restoredJsonText, [System.Text.Encoding]::UTF8)
    Write-SuccessMsg "Manifesto do banco restaurado persistido em: $RestoredManifestPath"

    Write-InfoMsg "Invocando o comparador canônico por identidades estáveis com vinculação de tentativa e bancos..."
    $compArgs = "-NoProfile -ExecutionPolicy Bypass -File `"$ComparatorScript`" -OriginManifestPath `"$OriginManifestPath`" -RestoredManifestPath `"$RestoredManifestPath`" -ReportOutputPath `"$ComparisonReportPath`" -ExpectedOriginDb `"$OriginDatabase`" -ExpectedRestoredDb `"$VerifyDatabase`" -ExpectedRunId `"$ResolvedRunId`" -Detailed"
    $compRes = Invoke-ProcessWithAsyncStreams -FileName "powershell" -Arguments $compArgs -TimeoutMs 60000

    Write-Host $compRes.StdOut
    if ($compRes.ExitCode -eq 0) {
        Write-SuccessMsg "Confronto concluído com APROVAÇÃO (PASS). Paridade de 100% comprovada!"
        exit 0
    } else {
        Write-ErrorAbort "Confronto detectou divergências ou erro (ExitCode=$($compRes.ExitCode)). Relatório em: $ComparisonReportPath"
    }
}

# --- FASE: DROP VERIFY DB ---
if ($Phase -eq "DropVerifyDb") {
    Write-Header "FASE: DESCARTE DO BANCO EFÊMERO DE VALIDAÇÃO"
    Assert-ClusterEnvironment

    if (-not $ConfirmDropVerifyDb) {
        Write-ErrorAbort "Operação interrompida: descarte exige a confirmação explícita '-ConfirmDropVerifyDb'."
    }

    if ($VerifyDatabase -ne "escala_recovery_verify_024") {
        Write-ErrorAbort "Guarda de descarte violada: o alvo para DROP deve ser estritamente 'escala_recovery_verify_024'."
    }

    # R1/R4: Validar procedência da base a ser descartada com checagem estrita de não-nulo e correspondência
    if (-not (Test-Path -Path $VerifyMetadataPath -PathType Leaf)) {
        Write-ErrorAbort "Metadados de criação do banco efêmero não encontrados em: $VerifyMetadataPath. Descarte bloqueado."
    }
    $verifyMeta = [System.IO.File]::ReadAllText($VerifyMetadataPath, [System.Text.Encoding]::UTF8) | ConvertFrom-Json

    if ($null -eq $verifyMeta.PSObject.Properties['execution_run_id'] -or [string]::IsNullOrWhiteSpace([string]$verifyMeta.execution_run_id) -or [string]$verifyMeta.execution_run_id -ne $ResolvedRunId) {
        Write-ErrorAbort "Guarda de procedência violada: execution_run_id nos metadados do banco efêmero ausente, vazio ou diverge da tentativa atual ($ResolvedRunId). Descarte bloqueado."
    }
    if ($null -eq $verifyMeta.PSObject.Properties['container_name'] -or [string]::IsNullOrWhiteSpace([string]$verifyMeta.container_name) -or [string]$verifyMeta.container_name -ne $ContainerName) {
        Write-ErrorAbort "Guarda violada: container_name nos metadados ($($verifyMeta.container_name)) ausente, vazio ou diverge do contêiner esperado ($ContainerName). Descarte bloqueado."
    }
    if ($null -eq $verifyMeta.PSObject.Properties['system_identifier'] -or [string]::IsNullOrWhiteSpace([string]$verifyMeta.system_identifier) -or [string]$verifyMeta.system_identifier -ne $ExpectedSystemIdentifier) {
        Write-ErrorAbort "Guarda violada: system_identifier do banco efêmero ($($verifyMeta.system_identifier)) ausente, vazio ou diverge do cluster esperado ($ExpectedSystemIdentifier). Descarte bloqueado."
    }
    if ($null -eq $verifyMeta.PSObject.Properties['target_database'] -or [string]::IsNullOrWhiteSpace([string]$verifyMeta.target_database) -or [string]$verifyMeta.target_database -ne $VerifyDatabase) {
        Write-ErrorAbort "Guarda violada: target_database nos metadados ($($verifyMeta.target_database)) ausente, vazio ou diverge do banco esperado ($VerifyDatabase). Descarte bloqueado."
    }
    if ($null -eq $verifyMeta.PSObject.Properties['created_oid'] -or -not ($verifyMeta.created_oid -is [int] -or $verifyMeta.created_oid -is [long] -or ($verifyMeta.created_oid -as [int64])) -or [int64]$verifyMeta.created_oid -le 0) {
        Write-ErrorAbort "Guarda violada: created_oid nos metadados do banco efêmero ausente ou de tipo/valor inválido. Descarte bloqueado."
    }

    $currentOidSql = "SELECT oid::text FROM pg_database WHERE datname = '$VerifyDatabase';"
    $currentOid = Invoke-PsqlQuery -TargetDb $AdminDatabase -SqlContent $currentOidSql -TupleOnly

    if ([string]::IsNullOrEmpty($currentOid)) {
        Write-WarnMsg "Banco '$VerifyDatabase' já não existe no cluster."
        exit 0
    }

    if ([int64]$currentOid -ne [int64]$verifyMeta.created_oid) {
        Write-ErrorAbort "Guarda de procedência violada: OID atual ($currentOid) diverge do OID criado nesta execução ($($verifyMeta.created_oid)). Descarte bloqueado."
    }

    Write-InfoMsg "Procedência confirmada. Encerrando sessões ativas exclusivas de '$VerifyDatabase'..."
    $terminateSql = "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$VerifyDatabase' AND pid <> pg_backend_pid();"
    [void](Invoke-PsqlQuery -TargetDb $AdminDatabase -SqlContent $terminateSql)

    Write-InfoMsg "Emitindo DROP DATABASE $VerifyDatabase via conexão administrativa..."
    $dropSql = "DROP DATABASE $VerifyDatabase;"
    [void](Invoke-PsqlQuery -TargetDb $AdminDatabase -SqlContent $dropSql)

    Write-SuccessMsg "Banco efêmero '$VerifyDatabase' (OID=$currentOid) descartado com sucesso."
    exit 0
}

# --- FASE: CLEANUP CONTAINER DUMPS ---
if ($Phase -eq "CleanupContainerDumps") {
    Write-Header "FASE: LIMPEZA DOS DUMPS TEMPORÁRIOS DO CONTÊINER"
    Assert-ClusterEnvironment

    if (-not $ConfirmCleanupContainer) {
        Write-ErrorAbort "Operação interrompida: limpeza exige a confirmação explícita '-ConfirmCleanupContainer'."
    }

    # R1/R4/R5: Validar procedência dos metadados de sessão antes de qualquer remoção com validação estrita
    if (-not (Test-Path -Path $SessionMetadataPath -PathType Leaf)) {
        Write-ErrorAbort "Metadados de sessão não encontrados em: $SessionMetadataPath. Limpeza no contêiner bloqueada."
    }
    $sessionMeta = [System.IO.File]::ReadAllText($SessionMetadataPath, [System.Text.Encoding]::UTF8) | ConvertFrom-Json

    if ($null -eq $sessionMeta.PSObject.Properties['dump_valid'] -or -not ($sessionMeta.dump_valid -is [bool]) -or $sessionMeta.dump_valid -ne $true) {
        Write-ErrorAbort "Guarda violada: dump_valid nos metadados de sessão ausente, de tipo não-booleano JSON ou falso. Limpeza bloqueada."
    }
    if ($null -eq $sessionMeta.PSObject.Properties['execution_run_id'] -or [string]::IsNullOrWhiteSpace([string]$sessionMeta.execution_run_id) -or [string]$sessionMeta.execution_run_id -ne $ResolvedRunId) {
        Write-ErrorAbort "Guarda violada: execution_run_id nos metadados de sessão ausente, vazio ou diverge da tentativa atual ($ResolvedRunId). Limpeza bloqueada."
    }
    if ($null -eq $sessionMeta.PSObject.Properties['container_name'] -or [string]::IsNullOrWhiteSpace([string]$sessionMeta.container_name) -or [string]$sessionMeta.container_name -ne $ContainerName) {
        Write-ErrorAbort "Guarda violada: container_name nos metadados de sessão ausente, vazio ou diverge do contêiner esperado ($ContainerName). Limpeza bloqueada."
    }
    if ($null -eq $sessionMeta.PSObject.Properties['system_identifier'] -or [string]::IsNullOrWhiteSpace([string]$sessionMeta.system_identifier) -or [string]$sessionMeta.system_identifier -ne $ExpectedSystemIdentifier) {
        Write-ErrorAbort "Guarda violada: system_identifier nos metadados de sessão ausente, vazio ou diverge do cluster esperado ($ExpectedSystemIdentifier). Limpeza bloqueada."
    }
    if ($null -eq $sessionMeta.PSObject.Properties['container_dump_path'] -or [string]::IsNullOrWhiteSpace([string]$sessionMeta.container_dump_path) -or
        $null -eq $sessionMeta.PSObject.Properties['container_restore_path'] -or [string]::IsNullOrWhiteSpace([string]$sessionMeta.container_restore_path)) {
        Write-ErrorAbort "Caminhos de dump inválidos ou ausentes nos metadados de sessão. Limpeza bloqueada."
    }
    if ([string]$sessionMeta.container_dump_path -ne $ContainerDumpPath -or [string]$sessionMeta.container_restore_path -ne $ContainerRestorePath) {
        Write-ErrorAbort "Guarda de segurança violada: caminhos de dump nos metadados não coincidem com os caminhos canônicos esperados para esta tentativa ($ContainerDumpPath e $ContainerRestorePath). Limpeza bloqueada."
    }
    if (-not ($sessionMeta.container_dump_path -like "/tmp/*") -or -not ($sessionMeta.container_restore_path -like "/tmp/*")) {
        Write-ErrorAbort "Guarda de contenção violada: caminhos de remoção no contêiner devem residir estritamente em '/tmp/'. Alvo rejeitado: '$($sessionMeta.container_dump_path)', '$($sessionMeta.container_restore_path)'"
    }

    Write-InfoMsg "Removendo dumps temporários do contêiner comprovados pela sessão: $($sessionMeta.container_dump_path) e $($sessionMeta.container_restore_path)"
    $rmRes = Invoke-ProcessWithAsyncStreams -FileName "docker" -Arguments "exec $ContainerName rm -f $($sessionMeta.container_dump_path) $($sessionMeta.container_restore_path)" -TimeoutMs 15000
    if ($rmRes.ExitCode -ne 0) {
        Write-ErrorAbort "Falha na remoção dos arquivos temporários no contêiner (ExitCode=$($rmRes.ExitCode)): $($rmRes.StdErr)"
    }

    Write-SuccessMsg "Arquivos temporários removidos do contêiner com sucesso. Os backups arquivados no host permanecem íntegros."
    exit 0
}

