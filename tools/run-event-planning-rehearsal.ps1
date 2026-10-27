<#
.SYNOPSIS
    Executor Determinístico do Ensaio Transacional R7 (Issues #28, #29, #30 e #58).
    Alvo Estrito: escala_rehearsal_024 sob transação única com ROLLBACK incondicional.
    Gate 3 / R7: Permanece NO-GO. Este script não aplica migrações permanentes.
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [string]$ContainerName = "supabase_db_escala-convites-http-lab",

    [Parameter(Mandatory = $false)]
    [string]$TargetDatabase = "escala_rehearsal_024",

    [Parameter(Mandatory = $false)]
    [string]$DbUser = "postgres",

    [Parameter(Mandatory = $false)]
    [string]$WorkspaceRoot = "D:\Github\escala-do-reino"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# 1. Configuração explícita de codificação do pipeline (UTF-8 sem BOM)
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = $utf8NoBom
[Console]::InputEncoding = $utf8NoBom
[Console]::OutputEncoding = $utf8NoBom

Write-Host "=== FASE 1: CARREGAMENTO PRÉVIO E VALIDAÇÃO CRIPTOGRÁFICA EM MEMÓRIA ===" -ForegroundColor Cyan

# 2. Definição estrita dos caminhos e hashes SHA-256 aprovados
$candidateDefinitions = [ordered]@{
    "docs/sql/023a_event_planning_structural.sql"          = "279BF22D5CDED8366D77236684C777378BC488A3A296E6C94CEBB1038DEE237E"
    "docs/sql/023b_event_creation_security_hardening.sql"    = "634E21DC9D448529882721F3EE83B063BC56B8B442AA80716811A7B46FCD71B6"
    "docs/sql/025_event_planning_security_hardening.sql"     = "48A572FF2F1EBDD26099DEFE9EFFA6BDB24AF41E5BDC552EAC67903116E5D3BF"
}

$rehearsalScriptPath  = Join-Path -Path $WorkspaceRoot -ChildPath "docs/sql/023_rehearsal_transactional_body.sql"
$inspectionScriptPath = Join-Path -Path $WorkspaceRoot -ChildPath "docs/sql/023_independent_inspection.sql"

# 3. Leitura e validação de todos os blocos antes da primeira conexão
if (-not (Test-Path -Path $rehearsalScriptPath -PathType Leaf)) {
    throw "INTERRUPÇÃO OBRIGATÓRIA: Roteiro de ensaio não encontrado em: $rehearsalScriptPath"
}
if (-not (Test-Path -Path $inspectionScriptPath -PathType Leaf)) {
    throw "INTERRUPÇÃO OBRIGATÓRIA: Roteiro de inspeção independente não encontrado em: $inspectionScriptPath"
}

$rehearsalRawBytes  = [System.IO.File]::ReadAllBytes($rehearsalScriptPath)
$inspectionRawBytes = [System.IO.File]::ReadAllBytes($inspectionScriptPath)

if ($rehearsalRawBytes.Length -eq 0 -or $inspectionRawBytes.Length -eq 0) {
    throw "INTERRUPÇÃO OBRIGATÓRIA: Roteiros auxiliares não podem ser vazios."
}

$rehearsalTemplateText = $utf8NoBom.GetString($rehearsalRawBytes)
$inspectionSqlText     = $utf8NoBom.GetString($inspectionRawBytes)

# 4. Leitura dos candidatos, conferência de hash e montagem dos mesmos bytes validados
$sha256 = [System.Security.Cryptography.SHA256]::Create()
$validatedCandidatesBuilder = [System.Text.StringBuilder]::new()

foreach ($relPath in $candidateDefinitions.Keys) {
    $expectedHash = $candidateDefinitions[$relPath]
    $fullPath = Join-Path -Path $WorkspaceRoot -ChildPath $relPath

    if (-not (Test-Path -Path $fullPath -PathType Leaf)) {
        throw "INTERRUPÇÃO OBRIGATÓRIA: Arquivo candidato ausente: $fullPath"
    }

    $fileBytes = [System.IO.File]::ReadAllBytes($fullPath)
    if ($fileBytes.Length -eq 0) {
        throw "INTERRUPÇÃO OBRIGATÓRIA: Arquivo candidato vazio: $fullPath"
    }

    $computedHashBytes = $sha256.ComputeHash($fileBytes)
    $computedHash = [System.BitConverter]::ToString($computedHashBytes).Replace("-", "").ToUpperInvariant()

    if ($computedHash -ne $expectedHash) {
        throw "INTERRUPÇÃO OBRIGATÓRIA: Hash divergente para $relPath. Esperado: $expectedHash; Obtido: $computedHash"
    }

    # Derivação direta a partir dos mesmos bytes validados
    $fileText = $utf8NoBom.GetString($fileBytes)
    [void]$validatedCandidatesBuilder.AppendLine("-- >>> CANDIDATO APROVADO: $relPath <<<")
    [void]$validatedCandidatesBuilder.AppendLine($fileText)
    [void]$validatedCandidatesBuilder.AppendLine("-- >>> FIM CANDIDATO: $relPath <<<`n")

    Write-Host "  [HASH OK] $relPath ($computedHash)" -ForegroundColor Green
}

$candidateStreamText = $validatedCandidatesBuilder.ToString()

# 5. Injeção determinística no roteiro de transação única
if (-not $rehearsalTemplateText.Contains("__CANDIDATES_INJECTION_POINT__")) {
    throw "INTERRUPÇÃO OBRIGATÓRIA: Ponto de injeção '__CANDIDATES_INJECTION_POINT__' ausente no roteiro de ensaio."
}
$fullTransactionalSql = $rehearsalTemplateText.Replace("__CANDIDATES_INJECTION_POINT__", $candidateStreamText)

Write-Host "  [OK] Todos os componentes carregados e validados estaticamente antes de qualquer conexão." -ForegroundColor Green

# 6. Execução da Transação Única de Ensaio (psql -X)
Write-Host "`n=== FASE 2: EXECUÇÃO DO ENSAIO TRANSACIONAL SOB ROLLBACK (psql -X) ===" -ForegroundColor Cyan

$psqlBaseArgs = @(
    "exec", "-i",
    "-e", "PGCLIENTENCODING=UTF8",
    $ContainerName,
    "psql",
    "-X",
    "-v", "ON_ERROR_STOP=1",
    "-U", $DbUser,
    "-d", $TargetDatabase
)

$procInfo = New-Object System.Diagnostics.ProcessStartInfo
$procInfo.FileName = "docker"
$procInfo.Arguments = ($psqlBaseArgs -join " ")
$procInfo.RedirectStandardInput  = $true
$procInfo.RedirectStandardOutput = $true
$procInfo.RedirectStandardError  = $true
$procInfo.UseShellExecute        = $false
$procInfo.StandardOutputEncoding = $utf8NoBom
$procInfo.StandardErrorEncoding  = $utf8NoBom

$process = [System.Diagnostics.Process]::Start($procInfo)

# Leitura assíncrona iniciada antes de transmitir o SQL para prevenir deadlock de buffer
$stdoutTask = $process.StandardOutput.ReadToEndAsync()
$stderrTask = $process.StandardError.ReadToEndAsync()

$rehearsalWriteError = $null
$rehearsalCloseError = $null
$stdinWriter = $null

try {
    $stdinWriter = [System.IO.StreamWriter]::new($process.StandardInput.BaseStream, $utf8NoBom)
    $stdinWriter.Write($fullTransactionalSql)
    $stdinWriter.Flush()
} catch {
    $rehearsalWriteError = $_
} finally {
    if ($null -ne $stdinWriter) {
        try {
            $stdinWriter.Close()
        } catch {
            $rehearsalCloseError = $_
        }
    } else {
        try {
            $process.StandardInput.Close()
        } catch {
            $rehearsalCloseError = $_
        }
    }
}

# Aguarda conclusão das leituras assíncronas e encerramento do processo
[System.Threading.Tasks.Task]::WaitAll(@($stdoutTask, $stderrTask))
$stdoutText = $stdoutTask.Result
$stderrText = $stderrTask.Result
$process.WaitForExit()
$rehearsalExitCode = $process.ExitCode

# Exibe saída completa capturada
if ($stdoutText) { Write-Host $stdoutText }
if ($stderrText) { Write-Host $stderrText -ForegroundColor Yellow }

# Falhas de transmissão ou fechamento de canal impedem avanço sem mascarar erros
if ($null -ne $rehearsalWriteError -and $null -ne $rehearsalCloseError) {
    throw "INTERRUPÇÃO: Falha na transmissão ($($rehearsalWriteError.Exception.Message)) e no fechamento do canal ($($rehearsalCloseError.Exception.Message)) do ensaio (ExitCode: $rehearsalExitCode)."
}
if ($null -ne $rehearsalWriteError) {
    throw "INTERRUPÇÃO: Falha na transmissão do SQL para o ensaio: $($rehearsalWriteError.Exception.Message) (ExitCode: $rehearsalExitCode)."
}
if ($null -ne $rehearsalCloseError) {
    throw "INTERRUPÇÃO: Falha no fechamento do canal de entrada do ensaio: $($rehearsalCloseError.Exception.Message) (ExitCode: $rehearsalExitCode)."
}

# 7. Avaliação multi-canal: código de saída e tokens em canal combinado (stdout + stderr)
if ($rehearsalExitCode -ne 0) {
    throw "INTERRUPÇÃO: Ensaio falhou no psql com código de saída $rehearsalExitCode."
}

# No PostgreSQL, mensagens de RAISE NOTICE trafegam prioritariamente pelo canal stderr do psql
$combinedLogs = "$stdoutText`n$stderrText"

$requiredTokens = @(
    "REHEARSAL_PREFLIGHT_TARGET_OK",
    "REHEARSAL_PREFLIGHT_ISOLATION_OK",
    "REHEARSAL_S01_OK",
    "REHEARSAL_S02_OK",
    "REHEARSAL_S03_OK",
    "REHEARSAL_S04_OK",
    "REHEARSAL_S05_OK",
    "REHEARSAL_S06_OK",
    "REHEARSAL_S07_OK",
    "REHEARSAL_S08_OK",
    "REHEARSAL_S09_OK",
    "REHEARSAL_S10_OK",
    "REHEARSAL_ROLLBACK_CONFIRMED",
    "POST_ROLLBACK_ADVISORY_LOCKS_ZERO",
    "POST_ROLLBACK_CATALOG_DELTA_ZERO",
    "POST_ROLLBACK_ROW_COUNTS_DELTA_ZERO",
    "POST_ROLLBACK_CONTENT_ATTRIBUTES_DELTA_ZERO"
)

foreach ($token in $requiredTokens) {
    if (-not $combinedLogs.Contains($token)) {
        throw "INTERRUPÇÃO OBRIGATÓRIA: Marcador '$token' ausente nos logs do ensaio."
    }
}
Write-Host "  [OK] Todos os cenários S01–S10 e verificações pós-ROLLBACK foram confirmados no log." -ForegroundColor Green

# 8. Execução da Inspeção Independente em Conexão Separada (psql -X)
Write-Host "`n=== FASE 3: EXECUÇÃO DA INSPEÇÃO INDEPENDENTE PÓS-ENSAIO (CONEXÃO SEPARADA) ===" -ForegroundColor Cyan

$inspProc = [System.Diagnostics.Process]::Start($procInfo)

# Leitura assíncrona iniciada antes de transmitir o SQL da inspeção independente
$inspStdoutTask = $inspProc.StandardOutput.ReadToEndAsync()
$inspStderrTask = $inspProc.StandardError.ReadToEndAsync()

$inspWriteError = $null
$inspCloseError = $null
$inspStdinWriter = $null

try {
    $inspStdinWriter = [System.IO.StreamWriter]::new($inspProc.StandardInput.BaseStream, $utf8NoBom)
    $inspStdinWriter.Write($inspectionSqlText)
    $inspStdinWriter.Flush()
} catch {
    $inspWriteError = $_
} finally {
    if ($null -ne $inspStdinWriter) {
        try {
            $inspStdinWriter.Close()
        } catch {
            $inspCloseError = $_
        }
    } else {
        try {
            $inspProc.StandardInput.Close()
        } catch {
            $inspCloseError = $_
        }
    }
}

# Aguarda conclusão das leituras assíncronas e encerramento do processo de inspeção
[System.Threading.Tasks.Task]::WaitAll(@($inspStdoutTask, $inspStderrTask))
$inspStdout = $inspStdoutTask.Result
$inspStderr = $inspStderrTask.Result
$inspProc.WaitForExit()
$inspExitCode = $inspProc.ExitCode

if ($inspStdout) { Write-Host $inspStdout }
if ($inspStderr) { Write-Host $inspStderr -ForegroundColor Yellow }

# Falhas de transmissão ou fechamento de canal na inspeção impedem sucesso
if ($null -ne $inspWriteError -and $null -ne $inspCloseError) {
    throw "INTERRUPÇÃO: Falha na transmissão ($($inspWriteError.Exception.Message)) e no fechamento do canal ($($inspCloseError.Exception.Message)) da inspeção (ExitCode: $inspExitCode)."
}
if ($null -ne $inspWriteError) {
    throw "INTERRUPÇÃO: Falha na transmissão do SQL para a inspeção independente: $($inspWriteError.Exception.Message) (ExitCode: $inspExitCode)."
}
if ($null -ne $inspCloseError) {
    throw "INTERRUPÇÃO: Falha no fechamento do canal de entrada da inspeção independente: $($inspCloseError.Exception.Message) (ExitCode: $inspExitCode)."
}

if ($inspExitCode -ne 0) {
    throw "INTERRUPÇÃO: Inspeção independente falhou com código de saída $inspExitCode."
}

$combinedInspLogs = "$inspStdout`n$inspStderr"
if (-not $combinedInspLogs.Contains("INDEPENDENT_INSPECTION_OK")) {
    throw "INTERRUPÇÃO OBRIGATÓRIA: Marcador 'INDEPENDENT_INSPECTION_OK' ausente na inspeção independente."
}

Write-Host "`n=== ENSAIO R7 CONCLUÍDO: VALIDAÇÕES DE CENÁRIOS E REVERSÃO SOB ROLLBACK CONFIRMADAS NO ESCOPO DELIMITADO ===" -ForegroundColor Green
