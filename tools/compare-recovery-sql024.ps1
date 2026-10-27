<#
.SYNOPSIS
    Comparador Canônico de Manifestos de Recuperação (Issue #58 - Critério 4).
    Alvo: Comparação determinística entre o manifesto canônico da origem (escala_rehearsal_024)
    e o manifesto do banco restaurado (escala_recovery_verify_024).
    Versão do Contrato: 1.1 (Conforme Parecer Independente R1-R7 do Codex).
.DESCRIPTION
    Confronta 100% dos vetores estruturais, de permissões e de dados entre a origem e o destino:
    1. Esquemas e proprietários
    2. Extensões instaladas
    3. Tipos customizados e enums
    4. Tabelas e visões (tipo, proprietário, persistência, opções, RLS e definição de views)
    5. Colunas (posição ordinal, tipo, nulabilidade, defaults e identidades)
    6. Sequências (tipo, limites, incremento, ciclo, estado last_value/is_called e proprietário)
    7. Funções e rotinas (assinaturas, retorno, prokind, volatilidade, security definer, config, definição e proprietário)
    8. Constraints (tipo, deferrability e definição canônica)
    9. Índices (unicidade, primary, exclusion e definição canônica)
    10. Políticas de RLS (comando, permissiva, roles unnest com PUBLIC, using e with_check)
    11. Gatilhos / Triggers (status de habilitação e definição)
    12. Privilégios e ACLs tipadas (decompostas por aclexplode e identidades nominais estáveis)
    13. Integridade criptográfica de dados por tabela (hashes SHA-256 e contagens de linhas)

    DIRETRIZES TÉCNICAS E DE GOVERNANÇA:
    - Baseado exclusivamente em identidades estáveis (nomes e assinaturas nominais).
    - Comparação ordinal sensível a maiúsculas/minúsculas ([System.StringComparison]::Ordinal).
    - Deteção e rejeição estrita de chaves duplicadas no catálogo.
    - Validação de completude: tabelas no inventário relacional devem constar em data_hashes.
    - Não exige igualdade de OIDs numéricos do cluster (OIDs são específicos de instância).
    - Não oculta objetos ausentes, diferenças ou tipos não tratados.
    - Não expõe dados pessoais, contas de usuários ou segredos em logs ou relatórios (LGPD).
    - Códigos de saída estritos:
        0: Aprovado (PASS - Paridade absoluta de 100%)
        1: Divergência detectada (FAIL - Discrepâncias estruturais ou de dados)
        2: Erro de execução (arquivos ausentes, formato JSON inválido ou erro interno)
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$OriginManifestPath,

    [Parameter(Mandatory = $true, Position = 1)]
    [string]$RestoredManifestPath,

    [Parameter(Mandatory = $false)]
    [string]$ReportOutputPath = "",

    [Parameter(Mandatory = $false)]
    [switch]$Detailed = $false,

    [Parameter(Mandatory = $false)]
    [string]$ExpectedOriginDb = "",

    [Parameter(Mandatory = $false)]
    [string]$ExpectedRestoredDb = "",

    [Parameter(Mandatory = $false)]
    [string]$ExpectedRunId = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# Configuração de codificação de saída
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = $utf8NoBom
[Console]::InputEncoding = $utf8NoBom
[Console]::OutputEncoding = $utf8NoBom

function Write-LogInfo {
    param([string]$Message)
    Write-Host "[INFO] $Message" -ForegroundColor Cyan
}

function Write-LogSuccess {
    param([string]$Message)
    Write-Host "[PASS] $Message" -ForegroundColor Green
}

function Write-LogWarning {
    param([string]$Message)
    Write-Host "[WARN] $Message" -ForegroundColor Yellow
}

function Write-LogErrorMsg {
    param([string]$Message)
    Write-Host "[FAIL] $Message" -ForegroundColor Red
}

# ------------------------------------------------------------------------------
# 1. VALIDAÇÃO DE PRÉ-CONDIÇÕES E CARREGAMENTO DOS MANIFESTOS
# ------------------------------------------------------------------------------
if (-not (Test-Path -Path $OriginManifestPath -PathType Leaf)) {
    Write-LogErrorMsg "Arquivo de manifesto de origem não encontrado: $OriginManifestPath"
    exit 2
}

if (-not (Test-Path -Path $RestoredManifestPath -PathType Leaf)) {
    Write-LogErrorMsg "Arquivo de manifesto restaurado não encontrado: $RestoredManifestPath"
    exit 2
}

try {
    $originRawText = [System.IO.File]::ReadAllText($OriginManifestPath, [System.Text.Encoding]::UTF8)
    $originManifest = $originRawText | ConvertFrom-Json
} catch {
    Write-LogErrorMsg "Falha ao decodificar JSON do manifesto de origem ($OriginManifestPath): $_"
    exit 2
}

try {
    $restoredRawText = [System.IO.File]::ReadAllText($RestoredManifestPath, [System.Text.Encoding]::UTF8)
    $restoredManifest = $restoredRawText | ConvertFrom-Json
} catch {
    Write-LogErrorMsg "Falha ao decodificar JSON do manifesto restaurado ($RestoredManifestPath): $_"
    exit 2
}

# Resolução estrutural
$originStructural = if ($null -ne $originManifest.structural) { $originManifest.structural } else { $originManifest }
$restoredStructural = if ($null -ne $restoredManifest.structural) { $restoredManifest.structural } else { $restoredManifest }

$originDataHashes = @(if ($null -ne $originManifest.PSObject.Properties['data_hashes']) { $originManifest.data_hashes })
$restoredDataHashes = @(if ($null -ne $restoredManifest.PSObject.Properties['data_hashes']) { $restoredManifest.data_hashes })

# R4: Validação estrita do contrato e versão
$origVersion = if ($null -ne $originManifest.PSObject.Properties['contract_version']) { [string]$originManifest.contract_version } elseif ($null -ne $originManifest.PSObject.Properties['manifest_version']) { [string]$originManifest.manifest_version } else { "" }
$restVersion = if ($null -ne $restoredManifest.PSObject.Properties['contract_version']) { [string]$restoredManifest.contract_version } elseif ($null -ne $restoredManifest.PSObject.Properties['manifest_version']) { [string]$restoredManifest.manifest_version } else { "" }

if ($origVersion -ne "1.1" -or $restVersion -ne "1.1") {
    Write-LogErrorMsg "Versão do contrato incompatível: origem='$origVersion', restaurado='$restVersion'. Esperado: '1.1'."
    exit 2
}

# F4 residual: Vínculo estrito e obrigatório de identidades dos bancos e execução de ponta a ponta
if ($null -eq $originManifest.PSObject.Properties['database_name'] -or [string]::IsNullOrWhiteSpace([string]$originManifest.database_name)) {
    Write-LogErrorMsg "Manifesto de origem inválido: propriedade 'database_name' ausente ou vazia."
    exit 2
}
$origDbName = [string]$originManifest.database_name

if ($null -eq $restoredManifest.PSObject.Properties['database_name'] -or [string]::IsNullOrWhiteSpace([string]$restoredManifest.database_name)) {
    Write-LogErrorMsg "Manifesto restaurado inválido: propriedade 'database_name' ausente ou vazia."
    exit 2
}
$restDbName = [string]$restoredManifest.database_name

if (-not [string]::IsNullOrEmpty($ExpectedOriginDb) -and $origDbName -ne $ExpectedOriginDb) {
    Write-LogErrorMsg "Guarda de procedência violada: database_name da origem ('$origDbName') diverge do esperado ('$ExpectedOriginDb')."
    exit 2
}
if (-not [string]::IsNullOrEmpty($ExpectedRestoredDb) -and $restDbName -ne $ExpectedRestoredDb) {
    Write-LogErrorMsg "Guarda de procedência violada: database_name do restaurado ('$restDbName') diverge do esperado ('$ExpectedRestoredDb')."
    exit 2
}

# Validação obrigatória de execution_run_id nos dois manifestos (ausência bloqueia)
if ($null -eq $originManifest.PSObject.Properties['execution_run_id'] -or [string]::IsNullOrWhiteSpace([string]$originManifest.execution_run_id)) {
    Write-LogErrorMsg "Manifesto de origem inválido: propriedade 'execution_run_id' ausente ou vazia."
    exit 2
}
$origRunId = [string]$originManifest.execution_run_id

if ($null -eq $restoredManifest.PSObject.Properties['execution_run_id'] -or [string]::IsNullOrWhiteSpace([string]$restoredManifest.execution_run_id)) {
    Write-LogErrorMsg "Manifesto restaurado inválido: propriedade 'execution_run_id' ausente ou vazia."
    exit 2
}
$restRunId = [string]$restoredManifest.execution_run_id

if ($origRunId -ne $restRunId) {
    Write-LogErrorMsg "Guarda de procedência violada: execution_run_id da origem ('$origRunId') diverge do restaurado ('$restRunId')."
    exit 2
}

if (-not [string]::IsNullOrEmpty($ExpectedRunId)) {
    if ($origRunId -ne $ExpectedRunId) {
        Write-LogErrorMsg "Guarda de procedência violada: execution_run_id da origem ('$origRunId') diverge da tentativa esperada ('$ExpectedRunId')."
        exit 2
    }
    if ($restRunId -ne $ExpectedRunId) {
        Write-LogErrorMsg "Guarda de procedência violada: execution_run_id do restaurado ('$restRunId') diverge da tentativa esperada ('$ExpectedRunId')."
        exit 2
    }
}

$requiredCategories = @("schemas", "extensions", "custom_types", "tables_and_views", "columns", "sequences", "functions", "constraints", "indexes", "policies", "triggers")
foreach ($cat in $requiredCategories) {
    if ($null -eq $originStructural.PSObject.Properties[$cat]) {
        Write-LogErrorMsg "Manifesto de origem incompleto: categoria obrigatória '$cat' ausente do catálogo."
        exit 2
    }
    if ($null -eq $restoredStructural.PSObject.Properties[$cat]) {
        Write-LogErrorMsg "Manifesto restaurado incompleto: categoria obrigatória '$cat' ausente do catálogo."
        exit 2
    }
}

# ------------------------------------------------------------------------------
# 2. FUNÇÕES AUXILIARES DE COMPARAÇÃO DETERMINÍSTICA ORDINAL
# ------------------------------------------------------------------------------
function Normalize-TextDefinition {
    param([string]$Text)
    if ([string]::IsNullOrEmpty($Text)) { return "" }
    return ($Text -replace "\r\n", "`n").Trim()
}

function Test-StringOrdinalEqual {
    param([string]$Str1, [string]$Str2)
    return [string]::Equals($Str1, $Str2, [System.StringComparison]::Ordinal)
}

function Serialize-AclItem {
    param($Acl)
    $grantee = if ($null -ne $Acl.grantee) { [string]$Acl.grantee } else { "" }
    $privilege = if ($null -ne $Acl.privilege_type) { [string]$Acl.privilege_type } else { "" }
    $grantor = if ($null -ne $Acl.grantor) { [string]$Acl.grantor } else { "" }
    $grantable = if ($null -ne $Acl.is_grantable) { [string]$Acl.is_grantable } else { "" }
    return "$grantee|$privilege|$grantor|$grantable"
}

function Compare-AclLists {
    param($OriginAcls, $RestoredAcls)
    $origList = @()
    if ($null -ne $OriginAcls) {
        foreach ($a in $OriginAcls) { $origList += (Serialize-AclItem $a) }
    }
    $origList = @($origList | Sort-Object)

    $restList = @()
    if ($null -ne $RestoredAcls) {
        foreach ($a in $RestoredAcls) { $restList += (Serialize-AclItem $a) }
    }
    $restList = @($restList | Sort-Object)

    $diffs = @()
    foreach ($item in $origList) {
        $found = $false
        foreach ($r in $restList) {
            if (Test-StringOrdinalEqual $item $r) { $found = $true; break }
        }
        if (-not $found) {
            $diffs += "ACL ausente no restaurado: $item"
        }
    }
    foreach ($item in $restList) {
        $found = $false
        foreach ($o in $origList) {
            if (Test-StringOrdinalEqual $item $o) { $found = $true; break }
        }
        if (-not $found) {
            $diffs += "ACL inesperada no restaurado: $item"
        }
    }

    return ,$diffs
}

function Compare-StringArrays {
    param($Arr1, $Arr2, [string]$PropName, [switch]$Ordered)
    $a1 = @(if ($null -ne $Arr1) { $Arr1 })
    $a2 = @(if ($null -ne $Arr2) { $Arr2 })

    $s1 = @(if ($Ordered) { $a1 | ForEach-Object { [string]$_ } } else { $a1 | ForEach-Object { [string]$_ } | Sort-Object })
    $s2 = @(if ($Ordered) { $a2 | ForEach-Object { [string]$_ } } else { $a2 | ForEach-Object { [string]$_ } | Sort-Object })

    $diffs = @()
    if ($s1.Count -ne $s2.Count) {
        $diffs += "$PropName possui contagem diferente: origem=$($s1.Count), restaurado=$($s2.Count)"
        return ,$diffs
    }

    for ($i = 0; $i -lt $s1.Count; $i++) {
        if (-not (Test-StringOrdinalEqual $s1[$i] $s2[$i])) {
            $diffs += "$PropName diverge na posição ${i}: '$($s1[$i])' vs '$($s2[$i])'"
        }
    }
    return ,$diffs
}

# ------------------------------------------------------------------------------
# 3. MOTOR DE COMPARAÇÃO POR VETOR DO CATÁLOGO (R4: ESCOPO E ORDINALIDADE)
# ------------------------------------------------------------------------------
$script:discrepancyReport = [ordered]@{}
$script:vectorSummaries = [System.Collections.Generic.List[PSCustomObject]]::new()

function Compare-Category {
    param(
        [string]$VectorName,
        $OriginItems,
        $RestoredItems,
        [scriptblock]$KeySelector,
        [scriptblock]$PropertyComparator
    )

    $origItems = @(if ($null -ne $OriginItems) { $OriginItems })
    $restItems = @(if ($null -ne $RestoredItems) { $RestoredItems })

    # R4: Dicionários ordinais com sensibilidade a caixa estrita
    $origDict = [System.Collections.Generic.Dictionary[string, object]]::new([System.StringComparer]::Ordinal)
    foreach ($item in $origItems) {
        $key = & $KeySelector $item
        if ($origDict.ContainsKey($key)) {
            Write-LogErrorMsg "Chave duplicada detectada na origem ($VectorName): '$key'"
            exit 2
        }
        $origDict.Add($key, $item)
    }

    $restDict = [System.Collections.Generic.Dictionary[string, object]]::new([System.StringComparer]::Ordinal)
    foreach ($item in $restItems) {
        $key = & $KeySelector $item
        if ($restDict.ContainsKey($key)) {
            Write-LogErrorMsg "Chave duplicada detectada no destino ($VectorName): '$key'"
            exit 2
        }
        $restDict.Add($key, $item)
    }

    $missingKeys = @()
    foreach ($k in $origDict.Keys) {
        if (-not $restDict.ContainsKey($k)) {
            $missingKeys += $k
        }
    }
    $missingKeys = @($missingKeys | Sort-Object)

    $unexpectedKeys = @()
    foreach ($k in $restDict.Keys) {
        if (-not $origDict.ContainsKey($k)) {
            $unexpectedKeys += $k
        }
    }
    $unexpectedKeys = @($unexpectedKeys | Sort-Object)

    $propertyMismatches = @()
    $commonKeys = @($origDict.Keys | Where-Object { $restDict.ContainsKey($_) } | Sort-Object)
    foreach ($k in $commonKeys) {
        $origObj = $origDict[$k]
        $restObj = $restDict[$k]
        $propDiffs = & $PropertyComparator $origObj $restObj
        if ($null -ne $propDiffs -and $propDiffs.Count -gt 0) {
            foreach ($pd in $propDiffs) {
                $propertyMismatches += "[$k] $pd"
            }
        }
    }

    $totalDiscrepancies = $missingKeys.Count + $unexpectedKeys.Count + $propertyMismatches.Count
    $status = if ($totalDiscrepancies -eq 0) { "PASS" } else { "FAIL" }

    $summaryObj = [pscustomobject]@{
        Vector = $VectorName
        OriginCount = $origItems.Count
        RestoredCount = $restItems.Count
        MissingInRestored = $missingKeys.Count
        UnexpectedInRestored = $unexpectedKeys.Count
        PropertyMismatches = $propertyMismatches.Count
        Status = $status
    }
    $script:vectorSummaries.Add($summaryObj) | Out-Null

    if ($totalDiscrepancies -gt 0) {
        $script:discrepancyReport[$VectorName] = [ordered]@{
            MissingInRestored = $missingKeys
            UnexpectedInRestored = $unexpectedKeys
            PropertyMismatches = $propertyMismatches
        }
    }
}

# --- VETOR 1: ESQUEMAS (SCHEMAS) ---
Compare-Category -VectorName "1. Esquemas e Proprietários" `
    -OriginItems $originStructural.schemas `
    -RestoredItems $restoredStructural.schemas `
    -KeySelector { param($i) [string]$i.schema_name } `
    -PropertyComparator {
        param($o, $r)
        $diffs = @()
        if (-not (Test-StringOrdinalEqual $o.owner_name $r.owner_name)) {
            $diffs += "owner_name diverge: origem='$($o.owner_name)', restaurado='$($r.owner_name)'"
        }
        $aclDiffs = Compare-AclLists $o.schema_acls $r.schema_acls
        foreach ($ad in $aclDiffs) { $diffs += $ad }
        return ,$diffs
    }

# --- VETOR 2: EXTENSÕES (EXTENSIONS) ---
$origExts = if ($null -ne $originStructural.extensions) { $originStructural.extensions } else { @() }
$restExts = if ($null -ne $restoredStructural.extensions) { $restoredStructural.extensions } else { @() }
Compare-Category -VectorName "2. Extensões" `
    -OriginItems $origExts `
    -RestoredItems $restExts `
    -KeySelector { param($i) [string]$i.extension_name } `
    -PropertyComparator {
        param($o, $r)
        $diffs = @()
        if (-not (Test-StringOrdinalEqual $o.schema_name $r.schema_name)) { $diffs += "schema_name diverge: '$($o.schema_name)' vs '$($r.schema_name)'" }
        if (-not (Test-StringOrdinalEqual $o.version $r.version)) { $diffs += "version diverge: '$($o.version)' vs '$($r.version)'" }
        if ([bool]$o.is_relocatable -ne [bool]$r.is_relocatable) { $diffs += "is_relocatable diverge: '$($o.is_relocatable)' vs '$($r.is_relocatable)'" }
        return ,$diffs
    }

# --- VETOR 3: TIPOS CUSTOMIZADOS E ENUMS (CUSTOM_TYPES) ---
$origTypes = if ($null -ne $originStructural.custom_types) { $originStructural.custom_types } else { @() }
$restTypes = if ($null -ne $restoredStructural.custom_types) { $restoredStructural.custom_types } else { @() }
Compare-Category -VectorName "3. Tipos Customizados e Enums" `
    -OriginItems $origTypes `
    -RestoredItems $restTypes `
    -KeySelector { param($i) "$($i.schema_name).$($i.type_name)" } `
    -PropertyComparator {
        param($o, $r)
        $diffs = @()
        if (-not (Test-StringOrdinalEqual $o.type_kind $r.type_kind)) { $diffs += "type_kind diverge: '$($o.type_kind)' vs '$($r.type_kind)'" }
        if (-not (Test-StringOrdinalEqual $o.owner_name $r.owner_name)) { $diffs += "owner_name diverge: '$($o.owner_name)' vs '$($r.owner_name)'" }
        $enumDiffs = Compare-StringArrays $o.enum_labels $r.enum_labels "enum_labels" -Ordered
        foreach ($ed in $enumDiffs) { $diffs += $ed }
        
        # R4/F6: Comparação estruturada profunda de type_definition
        $jsonOrigDef = if ($null -ne $o.PSObject.Properties['type_definition'] -and $null -ne $o.type_definition) {
            ($o.type_definition | ConvertTo-Json -Compress -Depth 10)
        } else { "{}" }
        $jsonRestDef = if ($null -ne $r.PSObject.Properties['type_definition'] -and $null -ne $r.type_definition) {
            ($r.type_definition | ConvertTo-Json -Compress -Depth 10)
        } else { "{}" }
        if (-not (Test-StringOrdinalEqual $jsonOrigDef $jsonRestDef)) {
            $diffs += "type_definition estruturado diverge: origem='$jsonOrigDef' vs restaurado='$jsonRestDef'"
        }

        $aclDiffs = Compare-AclLists $o.type_acls $r.type_acls
        foreach ($ad in $aclDiffs) { $diffs += $ad }
        return ,$diffs
    }

# --- VETOR 4: TABELAS E VISÕES (TABLES AND VIEWS) ---
Compare-Category -VectorName "4. Tabelas e Visões" `
    -OriginItems $originStructural.tables_and_views `
    -RestoredItems $restoredStructural.tables_and_views `
    -KeySelector { param($i) "$($i.schema_name).$($i.object_name)" } `
    -PropertyComparator {
        param($o, $r)
        $diffs = @()
        if (-not (Test-StringOrdinalEqual $o.relkind $r.relkind)) { $diffs += "relkind diverge: '$($o.relkind)' vs '$($r.relkind)'" }
        if (-not (Test-StringOrdinalEqual $o.owner_name $r.owner_name)) { $diffs += "owner_name diverge: '$($o.owner_name)' vs '$($r.owner_name)'" }
        if ([bool]$o.rls_enabled -ne [bool]$r.rls_enabled) { $diffs += "rls_enabled diverge: '$($o.rls_enabled)' vs '$($r.rls_enabled)'" }
        if ([bool]$o.rls_forced -ne [bool]$r.rls_forced) { $diffs += "rls_forced diverge: '$($o.rls_forced)' vs '$($r.rls_forced)'" }
        if (-not (Test-StringOrdinalEqual $o.persistence $r.persistence)) { $diffs += "persistence diverge: '$($o.persistence)' vs '$($r.persistence)'" }
        $optDiffs = Compare-StringArrays $o.options $r.options "options"
        foreach ($od in $optDiffs) { $diffs += $od }
        
        $normOrigView = Normalize-TextDefinition $o.view_definition
        $normRestView = Normalize-TextDefinition $r.view_definition
        if (-not (Test-StringOrdinalEqual $normOrigView $normRestView)) {
            $diffs += "view_definition diverge: origem='$normOrigView' vs restaurado='$normRestView'"
        }

        $aclDiffs = Compare-AclLists $o.obj_acls $r.obj_acls
        foreach ($ad in $aclDiffs) { $diffs += $ad }
        return ,$diffs
    }

# --- VETOR 5: COLUNAS (COLUMNS) ---
Compare-Category -VectorName "5. Colunas e Tipos" `
    -OriginItems $originStructural.columns `
    -RestoredItems $restoredStructural.columns `
    -KeySelector { param($i) "$($i.schema_name).$($i.table_name).$($i.column_name)" } `
    -PropertyComparator {
        param($o, $r)
        $diffs = @()
        if ([int]$o.ordinal_position -ne [int]$r.ordinal_position) { $diffs += "ordinal_position diverge: '$($o.ordinal_position)' vs '$($r.ordinal_position)'" }
        if (-not (Test-StringOrdinalEqual $o.data_type $r.data_type)) { $diffs += "data_type diverge: '$($o.data_type)' vs '$($r.data_type)'" }
        if ([bool]$o.is_not_null -ne [bool]$r.is_not_null) { $diffs += "is_not_null diverge: '$($o.is_not_null)' vs '$($r.is_not_null)'" }
        
        $normOrigDef = Normalize-TextDefinition $o.default_expression
        $normRestDef = Normalize-TextDefinition $r.default_expression
        if (-not (Test-StringOrdinalEqual $normOrigDef $normRestDef)) { $diffs += "default_expression diverge: '$normOrigDef' vs '$normRestDef'" }
        
        $idO = if ($null -ne $o.PSObject.Properties['identity_type'] -and $null -ne $o.identity_type) { [string]$o.identity_type } else { "" }
        $idR = if ($null -ne $r.PSObject.Properties['identity_type'] -and $null -ne $r.identity_type) { [string]$r.identity_type } else { "" }
        if (-not (Test-StringOrdinalEqual $idO $idR)) { $diffs += "identity_type diverge: '$idO' vs '$idR'" }

        $genO = if ($null -ne $o.PSObject.Properties['generated_type'] -and $null -ne $o.generated_type) { [string]$o.generated_type } else { "" }
        $genR = if ($null -ne $r.PSObject.Properties['generated_type'] -and $null -ne $r.generated_type) { [string]$r.generated_type } else { "" }
        if (-not (Test-StringOrdinalEqual $genO $genR)) { $diffs += "generated_type diverge: '$genO' vs '$genR'" }
        
        $aclDiffs = Compare-AclLists $o.column_acls $r.column_acls
        foreach ($ad in $aclDiffs) { $diffs += $ad }
        return ,$diffs
    }

# --- VETOR 6: SEQUÊNCIAS (SEQUENCES) ---
Compare-Category -VectorName "6. Sequências" `
    -OriginItems $originStructural.sequences `
    -RestoredItems $restoredStructural.sequences `
    -KeySelector { param($i) "$($i.schema_name).$($i.sequence_name)" } `
    -PropertyComparator {
        param($o, $r)
        $diffs = @()
        if (-not (Test-StringOrdinalEqual $o.data_type $r.data_type)) { $diffs += "data_type diverge: '$($o.data_type)' vs '$($r.data_type)'" }
        if ([int64]$o.start_value -ne [int64]$r.start_value) { $diffs += "start_value diverge: '$($o.start_value)' vs '$($r.start_value)'" }
        if ([int64]$o.min_value -ne [int64]$r.min_value) { $diffs += "min_value diverge: '$($o.min_value)' vs '$($r.min_value)'" }
        if ([int64]$o.max_value -ne [int64]$r.max_value) { $diffs += "max_value diverge: '$($o.max_value)' vs '$($r.max_value)'" }
        if ([int64]$o.increment_by -ne [int64]$r.increment_by) { $diffs += "increment_by diverge: '$($o.increment_by)' vs '$($r.increment_by)'" }
        if ([bool]$o.is_cycled -ne [bool]$r.is_cycled) { $diffs += "is_cycled diverge: '$($o.is_cycled)' vs '$($r.is_cycled)'" }
        if (-not (Test-StringOrdinalEqual $o.owner_name $r.owner_name)) { $diffs += "owner_name diverge: '$($o.owner_name)' vs '$($r.owner_name)'" }
        
        # R4/F2: cache_size
        if ($null -ne $o.PSObject.Properties['cache_size'] -and $null -ne $r.PSObject.Properties['cache_size']) {
            if ([int64]$o.cache_size -ne [int64]$r.cache_size) { $diffs += "cache_size diverge: '$($o.cache_size)' vs '$($r.cache_size)'" }
        }

        # R4/F2: Estado dinâmico de sequência (last_value do PG 17)
        # Conforme PG 17, pg_sequences.last_value pode ser NULL por falta de uso ou falta de permissão de leitura.
        # Portanto, campo ausente ou NULL em qualquer um dos lados não comprova equivalência de estado e bloqueia PASS integral.
        $hasLvO = ($null -ne $o.PSObject.Properties['last_value'] -and $null -ne $o.last_value)
        $hasLvR = ($null -ne $r.PSObject.Properties['last_value'] -and $null -ne $r.last_value)

        if (-not $hasLvO -or -not $hasLvR) {
            $diffs += "Estado dinâmico não comprovado para sequência '$($o.schema_name).$($o.sequence_name)': last_value é NULL ou ausente no catálogo pg_sequences (origem: $(if ($hasLvO) { $o.last_value } else { 'NULL/ausente' }), destino: $(if ($hasLvR) { $r.last_value } else { 'NULL/ausente' })). Cobertura incompleta de sequências impede PASS integral."
        } else {
            if ([int64]$o.last_value -ne [int64]$r.last_value) {
                $diffs += "last_value diverge: '$($o.last_value)' vs '$($r.last_value)'"
            }
        }

        $aclDiffs = Compare-AclLists $o.seq_acls $r.seq_acls
        foreach ($ad in $aclDiffs) { $diffs += $ad }
        return ,$diffs
    }

# --- VETOR 7: FUNÇÕES E PROCEDIMENTOS (FUNCTIONS) ---
Compare-Category -VectorName "7. Funções e Procedimentos" `
    -OriginItems $originStructural.functions `
    -RestoredItems $restoredStructural.functions `
    -KeySelector { param($i) "$($i.schema_name).$($i.function_name)($($i.identity_arguments))" } `
    -PropertyComparator {
        param($o, $r)
        $diffs = @()
        if (-not (Test-StringOrdinalEqual $o.result_type $r.result_type)) { $diffs += "result_type diverge: '$($o.result_type)' vs '$($r.result_type)'" }
        if (-not (Test-StringOrdinalEqual $o.prokind $r.prokind)) { $diffs += "prokind diverge: '$($o.prokind)' vs '$($r.prokind)'" }
        if (-not (Test-StringOrdinalEqual $o.volatility $r.volatility)) { $diffs += "volatility diverge: '$($o.volatility)' vs '$($r.volatility)'" }
        if ([bool]$o.is_security_definer -ne [bool]$r.is_security_definer) { $diffs += "is_security_definer diverge: '$($o.is_security_definer)' vs '$($r.is_security_definer)'" }
        if ([bool]$o.is_leakproof -ne [bool]$r.is_leakproof) { $diffs += "is_leakproof diverge: '$($o.is_leakproof)' vs '$($r.is_leakproof)'" }
        if (-not (Test-StringOrdinalEqual $o.parallel_safety $r.parallel_safety)) { $diffs += "parallel_safety diverge: '$($o.parallel_safety)' vs '$($r.parallel_safety)'" }
        if ([float]$o.execution_cost -ne [float]$r.execution_cost) { $diffs += "execution_cost diverge: '$($o.execution_cost)' vs '$($r.execution_cost)'" }
        if (-not (Test-StringOrdinalEqual $o.owner_name $r.owner_name)) { $diffs += "owner_name diverge: '$($o.owner_name)' vs '$($r.owner_name)'" }

        # R4/F6: Validação de cobertura e bloqueio conservador de funções agregadas
        if ($o.prokind -eq 'a' -or $r.prokind -eq 'a') {
            if ($o.prokind -ne $r.prokind) {
                $diffs += "prokind agregado diverge: '$($o.prokind)' vs '$($r.prokind)'"
            }
            if ([string]::IsNullOrWhiteSpace($o.function_definition) -or [string]::IsNullOrWhiteSpace($r.function_definition)) {
                $diffs += "Definição de função agregada ausente ou vazia."
            }
            # F6 residual: como o catálogo DDL não cobre a totalidade dos atributos do PG17 (aggkind, aggnumdirectargs, aggfinalmodify, aggmfinalmodify pendentes),
            # adota-se a alternativa mínima de registrar divergência formal impedindo PASS integral para qualquer agregado.
            $diffs += "Bloqueio conservador de agregados: cobertura estrutural parcial de catálogo (aggkind/directargs/finalmodify pendentes); presença da função agregada impede PASS integral."
        }
        
        $cfgDiffs = Compare-StringArrays $o.configuration_settings $r.configuration_settings "configuration_settings"
        foreach ($cd in $cfgDiffs) { $diffs += $cd }

        $normOrigDef = Normalize-TextDefinition $o.function_definition
        $normRestDef = Normalize-TextDefinition $r.function_definition
        if (-not (Test-StringOrdinalEqual $normOrigDef $normRestDef)) {
            $diffs += "function_definition diverge (tamanho origem=$($normOrigDef.Length), tamanho restaurado=$($normRestDef.Length))"
        }
        
        $aclDiffs = Compare-AclLists $o.func_acls $r.func_acls
        foreach ($ad in $aclDiffs) { $diffs += $ad }
        return ,$diffs
    }


# --- VETOR 8: CONSTRAINTS ---
Compare-Category -VectorName "8. Constraints" `
    -OriginItems $originStructural.constraints `
    -RestoredItems $restoredStructural.constraints `
    -KeySelector { param($i) "$($i.schema_name).$($i.table_name).$($i.constraint_name)" } `
    -PropertyComparator {
        param($o, $r)
        $diffs = @()
        if (-not (Test-StringOrdinalEqual $o.constraint_type $r.constraint_type)) { $diffs += "constraint_type diverge: '$($o.constraint_type)' vs '$($r.constraint_type)'" }
        if ([bool]$o.is_deferrable -ne [bool]$r.is_deferrable) { $diffs += "is_deferrable diverge: '$($o.is_deferrable)' vs '$($r.is_deferrable)'" }
        if ([bool]$o.is_deferred -ne [bool]$r.is_deferred) { $diffs += "is_deferred diverge: '$($o.is_deferred)' vs '$($r.is_deferred)'" }
        
        $normOrigDef = Normalize-TextDefinition $o.constraint_definition
        $normRestDef = Normalize-TextDefinition $r.constraint_definition
        if (-not (Test-StringOrdinalEqual $normOrigDef $normRestDef)) { $diffs += "constraint_definition diverge: '$normOrigDef' vs '$normRestDef'" }
        return ,$diffs
    }

# --- VETOR 9: ÍNDICES (INDEXES) ---
Compare-Category -VectorName "9. Índices" `
    -OriginItems $originStructural.indexes `
    -RestoredItems $restoredStructural.indexes `
    -KeySelector { param($i) "$($i.schema_name).$($i.table_name).$($i.index_name)" } `
    -PropertyComparator {
        param($o, $r)
        $diffs = @()
        if ([bool]$o.is_unique -ne [bool]$r.is_unique) { $diffs += "is_unique diverge: '$($o.is_unique)' vs '$($r.is_unique)'" }
        if ([bool]$o.is_primary -ne [bool]$r.is_primary) { $diffs += "is_primary diverge: '$($o.is_primary)' vs '$($r.is_primary)'" }
        if ([bool]$o.is_exclusion -ne [bool]$r.is_exclusion) { $diffs += "is_exclusion diverge: '$($o.is_exclusion)' vs '$($r.is_exclusion)'" }
        
        $normOrigDef = Normalize-TextDefinition $o.index_definition
        $normRestDef = Normalize-TextDefinition $r.index_definition
        if (-not (Test-StringOrdinalEqual $normOrigDef $normRestDef)) { $diffs += "index_definition diverge: '$normOrigDef' vs '$normRestDef'" }
        return ,$diffs
    }

# --- VETOR 10: POLÍTICAS RLS (POLICIES) ---
Compare-Category -VectorName "10. Políticas RLS" `
    -OriginItems $originStructural.policies `
    -RestoredItems $restoredStructural.policies `
    -KeySelector { param($i) "$($i.schema_name).$($i.table_name).$($i.policy_name)" } `
    -PropertyComparator {
        param($o, $r)
        $diffs = @()
        if (-not (Test-StringOrdinalEqual $o.command_type $r.command_type)) { $diffs += "command_type diverge: '$($o.command_type)' vs '$($r.command_type)'" }
        if ([bool]$o.policy_permissive -ne [bool]$r.policy_permissive) { $diffs += "policy_permissive diverge: '$($o.policy_permissive)' vs '$($r.policy_permissive)'" }
        
        $roleDiffs = Compare-StringArrays $o.policy_roles $r.policy_roles "policy_roles"
        foreach ($rd in $roleDiffs) { $diffs += $rd }

        $normOrigUsing = Normalize-TextDefinition $o.using_expression
        $normRestUsing = Normalize-TextDefinition $r.using_expression
        if (-not (Test-StringOrdinalEqual $normOrigUsing $normRestUsing)) { $diffs += "using_expression diverge: '$normOrigUsing' vs '$normRestUsing'" }
        
        $normOrigCheck = Normalize-TextDefinition $o.with_check_expression
        $normRestCheck = Normalize-TextDefinition $r.with_check_expression
        if (-not (Test-StringOrdinalEqual $normOrigCheck $normRestCheck)) { $diffs += "with_check_expression diverge: '$normOrigCheck' vs '$normRestCheck'" }
        return ,$diffs
    }

# --- VETOR 11: GATILHOS (TRIGGERS) ---
Compare-Category -VectorName "11. Gatilhos / Triggers" `
    -OriginItems $originStructural.triggers `
    -RestoredItems $restoredStructural.triggers `
    -KeySelector { param($i) "$($i.schema_name).$($i.table_name).$($i.trigger_name)" } `
    -PropertyComparator {
        param($o, $r)
        $diffs = @()
        if (-not (Test-StringOrdinalEqual $o.is_enabled $r.is_enabled)) { $diffs += "is_enabled diverge: '$($o.is_enabled)' vs '$($r.is_enabled)'" }
        
        $normOrigDef = Normalize-TextDefinition $o.trigger_definition
        $normRestDef = Normalize-TextDefinition $r.trigger_definition
        if (-not (Test-StringOrdinalEqual $normOrigDef $normRestDef)) { $diffs += "trigger_definition diverge: '$normOrigDef' vs '$normRestDef'" }
        return ,$diffs
    }

# --- VETOR 12: INTEGRIDADE CRIPTOGRÁFICA DE DADOS (TABLE DATA HASHES) ---
Compare-Category -VectorName "12. Conteúdo e Hashes de Tabelas" `
    -OriginItems $originDataHashes `
    -RestoredItems $restoredDataHashes `
    -KeySelector { param($i) "$($i.schema_name).$($i.table_name)" } `
    -PropertyComparator {
        param($o, $r)
        $diffs = @()
        if ([int64]$o.row_count -ne [int64]$r.row_count) {
            $diffs += "row_count diverge: origem=$($o.row_count), restaurado=$($r.row_count)"
        }
        if (-not (Test-StringOrdinalEqual ([string]$o.data_hash).ToLower() ([string]$r.data_hash).ToLower())) {
            $diffs += "data_hash SHA-256 diverge: origem='$($o.data_hash)', restaurado='$($r.data_hash)'"
        }
        return ,$diffs
    }

# ------------------------------------------------------------------------------
# 3.1 VALIDAÇÃO DE COMPLETUDE: TABELAS VS. HASHES DE DADOS (R4: BIJEÇÃO ESTRITA)
# ------------------------------------------------------------------------------
$dataHashCompletenessDiffs = @()
$expectedPersistentTables = @($originStructural.tables_and_views | Where-Object { $_.relkind -in @('r', 'p', 'm') })

$expectedTableDict = [System.Collections.Generic.Dictionary[string, bool]]::new([System.StringComparer]::Ordinal)
foreach ($pt in $expectedPersistentTables) {
    $tKey = "$($pt.schema_name).$($pt.object_name)"
    if (-not $expectedTableDict.ContainsKey($tKey)) {
        $expectedTableDict.Add($tKey, $true)
    }
}

$originHashDict = [System.Collections.Generic.Dictionary[string, bool]]::new([System.StringComparer]::Ordinal)
foreach ($dh in $originDataHashes) {
    $hKey = "$($dh.schema_name).$($dh.table_name)"
    if (-not $originHashDict.ContainsKey($hKey)) {
        $originHashDict.Add($hKey, $true)
    }
}

$restoredHashDict = [System.Collections.Generic.Dictionary[string, bool]]::new([System.StringComparer]::Ordinal)
foreach ($dh in $restoredDataHashes) {
    $hKey = "$($dh.schema_name).$($dh.table_name)"
    if (-not $restoredHashDict.ContainsKey($hKey)) {
        $restoredHashDict.Add($hKey, $true)
    }
}

# Direção 1: Toda tabela/visão materializada persistida esperada deve ter hash na origem e no restaurado
foreach ($tKey in $expectedTableDict.Keys) {
    if (-not $originHashDict.ContainsKey($tKey)) {
        $dataHashCompletenessDiffs += "Tabela/visão materializada '$tKey' presente no inventário estrutural mas ausente dos hashes de dados da origem!"
    }
    if (-not $restoredHashDict.ContainsKey($tKey)) {
        $dataHashCompletenessDiffs += "Tabela/visão materializada '$tKey' presente no inventário estrutural mas ausente dos hashes de dados do banco restaurado!"
    }
}

# Direção 2 (Bijeção Estrita): Todo hash na origem deve corresponder a objeto persistido esperado
foreach ($hKey in $originHashDict.Keys) {
    if (-not $expectedTableDict.ContainsKey($hKey)) {
        $dataHashCompletenessDiffs += "Hash de dados na origem refere-se a objeto '$hKey' não inventariado como tabela ou visão materializada persistida (órfão)!"
    }
}

# Direção 3 (Bijeção Estrita): Todo hash no restaurado deve corresponder a objeto persistido esperado
foreach ($hKey in $restoredHashDict.Keys) {
    if (-not $expectedTableDict.ContainsKey($hKey)) {
        $dataHashCompletenessDiffs += "Hash de dados no restaurado refere-se a objeto '$hKey' não inventariado como tabela ou visão materializada persistida (órfão)!"
    }
}

if ($dataHashCompletenessDiffs.Count -gt 0) {
    $script:discrepancyReport["13. Completude dos Hashes vs. Tabelas"] = [ordered]@{
        MissingInRestored = @()
        UnexpectedInRestored = @()
        PropertyMismatches = $dataHashCompletenessDiffs
    }
    $script:vectorSummaries.Add([pscustomobject]@{
        Vector = "13. Completude dos Hashes"
        OriginCount = $expectedPersistentTables.Count
        RestoredCount = $originDataHashes.Count
        MissingInRestored = $dataHashCompletenessDiffs.Count
        UnexpectedInRestored = 0
        PropertyMismatches = $dataHashCompletenessDiffs.Count
        Status = "FAIL"
    }) | Out-Null
}

# ------------------------------------------------------------------------------
# 4. GERAÇÃO DE SAÍDA E RELATÓRIO DETERMINÍSTICO
# ------------------------------------------------------------------------------
$totalFailedVectors = @($script:vectorSummaries | Where-Object { $_.Status -eq "FAIL" }).Count
$overallVerdict = if ($totalFailedVectors -eq 0) { "APROVADO (PASS)" } else { "REJEITADO (FAIL)" }
$verdictColor = if ($totalFailedVectors -eq 0) { "Green" } else { "Red" }

Write-Host ""
Write-Host "================================================================================" -ForegroundColor White
Write-Host " RELATÓRIO DE CONFRONTO CANÔNICO DE RECUPERAÇÃO (ISSUE #58 - CRITÉRIO 4)        " -ForegroundColor White
Write-Host "================================================================================" -ForegroundColor White
Write-Host " Origem:    $OriginManifestPath"
Write-Host " Destino:   $RestoredManifestPath"
Write-Host " Veredito:  $overallVerdict" -ForegroundColor $verdictColor
Write-Host "--------------------------------------------------------------------------------"

$script:vectorSummaries | Format-Table -Property Vector, OriginCount, RestoredCount, MissingInRestored, UnexpectedInRestored, PropertyMismatches, Status -AutoSize

if ($totalFailedVectors -gt 0) {
    Write-Host ""
    Write-LogErrorMsg "DISCREPÂNCIAS DETECTADAS NO CONFRONTO LADO A LADO:"
    foreach ($vName in $script:discrepancyReport.Keys) {
        $rep = $script:discrepancyReport[$vName]
        Write-Host "--- $vName ---" -ForegroundColor Yellow
        if ($rep.MissingInRestored.Count -gt 0) {
            Write-Host "  Ausentes no Restaurado ($($rep.MissingInRestored.Count)):" -ForegroundColor Red
            foreach ($m in $rep.MissingInRestored) { Write-Host "    - $m" }
        }
        if ($rep.UnexpectedInRestored.Count -gt 0) {
            Write-Host "  Inesperados no Restaurado ($($rep.UnexpectedInRestored.Count)):" -ForegroundColor Red
            foreach ($u in $rep.UnexpectedInRestored) { Write-Host "    - $u" }
        }
        if ($rep.PropertyMismatches.Count -gt 0) {
            Write-Host "  Divergências de Propriedades/Definições ($($rep.PropertyMismatches.Count)):" -ForegroundColor Red
            foreach ($p in $rep.PropertyMismatches) { Write-Host "    - $p" }
        }
    }
} else {
    Write-LogSuccess "Paridade absoluta de 100% comprovada em todos os vetores de catálogo e dados!"
}

# Emissão de arquivo de relatório caso solicitado (compatível com PS 5.1)
if (-not [string]::IsNullOrEmpty($ReportOutputPath)) {
    $sb = [System.Text.StringBuilder]::new()
    [void]$sb.AppendLine("# Relatório de Validação de Recuperação (Issue #58 - Critério 4)")
    [void]$sb.AppendLine("")
    $nowUtc = [DateTime]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ")
    [void]$sb.AppendLine("- **Data da Avaliação (UTC):** $nowUtc")
    [void]$sb.AppendLine(("- **Manifesto de Origem:** ``{0}``" -f $OriginManifestPath))
    [void]$sb.AppendLine(("- **Manifesto Restaurado:** ``{0}``" -f $RestoredManifestPath))
    [void]$sb.AppendLine(("- **Veredito Global:** **{0}**" -f $overallVerdict))
    [void]$sb.AppendLine("")
    [void]$sb.AppendLine("## Quadro Resumo por Vetor de Catálogo e Integridade de Dados")
    [void]$sb.AppendLine("")
    [void]$sb.AppendLine("| Vetor de Conformidade | Qtd Origem | Qtd Restaurado | Ausentes | Inesperados | Divergências | Status |")
    [void]$sb.AppendLine("| :--- | :---: | :---: | :---: | :---: | :---: | :---: |")
    foreach ($vs in $script:vectorSummaries) {
        [void]$sb.AppendLine(("| {0} | {1} | {2} | {3} | {4} | {5} | **{6}** |" -f $vs.Vector, $vs.OriginCount, $vs.RestoredCount, $vs.MissingInRestored, $vs.UnexpectedInRestored, $vs.PropertyMismatches, $vs.Status))
    }
    [void]$sb.AppendLine("")

    if ($totalFailedVectors -gt 0) {
        [void]$sb.AppendLine("## Detalhamento das Discrepâncias Detectadas")
        [void]$sb.AppendLine("")
        foreach ($vName in $script:discrepancyReport.Keys) {
            $rep = $script:discrepancyReport[$vName]
            [void]$sb.AppendLine(("### {0}" -f $vName))
            if ($rep.MissingInRestored.Count -gt 0) {
                [void]$sb.AppendLine(("#### Ausentes no Restaurado ({0})" -f $rep.MissingInRestored.Count))
                foreach ($m in $rep.MissingInRestored) { [void]$sb.AppendLine(("- ``{0}``" -f $m)) }
            }
            if ($rep.UnexpectedInRestored.Count -gt 0) {
                [void]$sb.AppendLine(("#### Inesperados no Restaurado ({0})" -f $rep.UnexpectedInRestored.Count))
                foreach ($u in $rep.UnexpectedInRestored) { [void]$sb.AppendLine(("- ``{0}``" -f $u)) }
            }
            if ($rep.PropertyMismatches.Count -gt 0) {
                [void]$sb.AppendLine(("#### Divergências de Propriedades ({0})" -f $rep.PropertyMismatches.Count))
                foreach ($p in $rep.PropertyMismatches) { [void]$sb.AppendLine(("- {0}" -f $p)) }
            }
            [void]$sb.AppendLine("")
        }
    } else {
        [void]$sb.AppendLine("## Conclusão da Análise Comparativa")
        [void]$sb.AppendLine("Todos os vetores de conformidade estrutural, extensões, tipos/enums, visões, sequências, rotinas, constraints, índices, políticas RLS, triggers e integridade criptográfica de dados por tabela (hashes SHA-256 e contagens de linhas) apresentaram correspondência exata de 100%. Nenhuma divergência foi identificada entre o banco de origem sob snapshot e a base restaurada.")
    }

    $reportDir = [System.IO.Path]::GetDirectoryName($ReportOutputPath)
    if (-not [string]::IsNullOrEmpty($reportDir) -and -not (Test-Path -Path $reportDir -PathType Container)) {
        [System.IO.Directory]::CreateDirectory($reportDir) | Out-Null
    }
    [System.IO.File]::WriteAllText($ReportOutputPath, $sb.ToString(), [System.Text.Encoding]::UTF8)
    Write-LogInfo "Relatório escrito com sucesso em: $ReportOutputPath"
}

# Encerramento estrito de código de saída
if ($totalFailedVectors -eq 0) {
    exit 0
} else {
    exit 1
}
