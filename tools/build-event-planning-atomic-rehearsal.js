/**
 * tools/build-event-planning-atomic-rehearsal.js
 *
 * Gerador determinístico de payload PostgreSQL para ensaio reversível da Issue #57.
 * Compõe em memória os candidatos aprovados (023a + 023b + 025) via expansão do
 * instalador atômico (docs/sql/025_atomic_event_planning_installer.sql), substituindo
 * a confirmação terminal indivisível (COMMIT) por reversão obrigatória (ROLLBACK).
 *
 * Princípios de Segurança e Governança (AGENTS.md):
 * 1. Execução puramente local e em memória: sem conexões de banco, sem Docker, sem Supabase, sem HTTP.
 * 2. Verificação estrita de integridade: hashes SHA-256 canônicos de todas as entradas são validados antes da composição.
 * 3. Envoltória transacional segura e ancorada: exatamente 1 BEGIN de topo, 0 COMMIT e 1 ROLLBACK terminal ancorado no marcador canônico.
 * 4. Preservação de fontes canônicas: os arquivos 023a, 023b e 025 nunca são modificados.
 * 5. CLI atomicamente fail-closed e parsing estrito: parsing fail-closed antes da geração de payload via parseCliArgs;
 *    recusa conflito mútuo entre --dry-run e --out, duplicações, argumentos desconhecidos ou opções inválidas;
 *    se --out for fornecido, utiliza criação exclusiva (flag 'wx') e converte EEXIST em erro descritivo imediato.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const CANONICAL_HASHES = Object.freeze({
  '023a': '279BF22D5CDED8366D77236684C777378BC488A3A296E6C94CEBB1038DEE237E',
  '023b': '634E21DC9D448529882721F3EE83B063BC56B8B442AA80716811A7B46FCD71B6',
  '025': '48A572FF2F1EBDD26099DEFE9EFFA6BDB24AF41E5BDC552EAC67903116E5D3BF',
  'installer': 'EA2A8DDC32CC9E3D541FD330261FFA12E7D2C3D84911C58DA2CFB012EE432210',
});

export const EXPECTED_COMPONENTS = Object.freeze([
  {
    key: '023a',
    fileName: '023a_event_planning_structural.sql',
    relativePath: 'docs/sql/023a_event_planning_structural.sql',
    expectedHash: CANONICAL_HASHES['023a'],
    order: 1,
  },
  {
    key: '023b',
    fileName: '023b_event_creation_security_hardening.sql',
    relativePath: 'docs/sql/023b_event_creation_security_hardening.sql',
    expectedHash: CANONICAL_HASHES['023b'],
    order: 2,
  },
  {
    key: '025',
    fileName: '025_event_planning_security_hardening.sql',
    relativePath: 'docs/sql/025_event_planning_security_hardening.sql',
    expectedHash: CANONICAL_HASHES['025'],
    order: 3,
  },
]);

export const DEFAULT_INSTALLER_RELATIVE_PATH = 'docs/sql/025_atomic_event_planning_installer.sql';

export const EXPECTED_RPCS = Object.freeze([
  'create_church_event_edition',
  'set_event_duration_policy',
  'reorder_event_items',
  'save_event_program_draft',
  'publish_event_program',
]);

export const REQUIRED_PLANNING_COLUMNS = Object.freeze([
  'duration_policy',
  'program_status',
  'program_version',
  'published_at',
  'published_by_member_id',
]);

export const FINAL_CONFIRMATION_MARKER = '-- Confirmação atômica indivisível de todo o pacote';

/**
 * Calcula o hash SHA-256 em hexadecimal maiúsculo sobre os bytes reais de uma string ou Buffer.
 * Não normaliza quebras de linha nem descarta caracteres.
 */
export function computeSha256(content) {
  const buf = typeof content === 'string' ? Buffer.from(content, 'utf8') : content;
  return crypto.createHash('sha256').update(buf).digest('hex').toUpperCase();
}

/**
 * Remove comentários de linha (--) e blocos de um script SQL.
 */
export function stripSqlComments(sqlText) {
  let result = sqlText.replace(/\/\*[\s\S]*?\*\//g, '');
  result = result.replace(/--.*$/gm, '');
  return result;
}

/**
 * Mascara blocos dollar-quoted e comentários substituindo seus caracteres por espaços,
 * preservando estritamente os offsets numéricos e quebras de linha do script original.
 */
export function maskSqlPreservingOffsets(sqlText) {
  let masked = sqlText.replace(/\$([a-zA-Z0-9_]*)\$[\s\S]*?\$\1\$/g, m => ' '.repeat(m.length));
  masked = masked.replace(/\/\*[\s\S]*?\*\//g, m => ' '.repeat(m.length));
  masked = masked.replace(/--.*$/gm, m => ' '.repeat(m.length));
  return masked;
}

/**
 * Detecta comandos de controle transacional no nível do script (fora de blocos dollar-quoted).
 * Retorna os comandos com índice e comprimento exatos correspondentes ao texto original de entrada.
 */
export function findTopLevelTransactionCommands(sqlText) {
  const maskedSql = maskSqlPreservingOffsets(sqlText);

  const txMatches = [];
  const txRegex = /\b(BEGIN|COMMIT|ROLLBACK|START\s+TRANSACTION|END)\s*;/gi;
  let match;
  while ((match = txRegex.exec(maskedSql)) !== null) {
    txMatches.push({
      command: match[1].toUpperCase(),
      matchedText: match[0],
      index: match.index,
      length: match[0].length,
    });
  }
  return txMatches;
}

/**
 * Extrai a lista ordenada de inclusões (\ir ou \i) em um script SQL.
 */
export function extractIncludedDirectives(sqlText) {
  const lines = sqlText.split(/\r?\n/);
  const includes = [];
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('--')) continue;
    const match = trimmed.match(/^\\(ir|i)\s+([^\s;]+)/i);
    if (match) {
      includes.push({
        directive: match[1].toLowerCase(),
        fileName: path.basename(match[2]),
        rawPath: match[2],
        lineNumber: i + 1,
        fullLine: lines[i],
      });
    }
  }
  return includes;
}

/**
 * Extrai o corpo do bloco do $preflight_guard$.
 */
export function extractPreflightBlock(sqlText) {
  const match = sqlText.match(/do\s+\$preflight_guard\$([\s\S]*?)\$preflight_guard\$;/i);
  return match ? match[1] : null;
}

/**
 * Extrai o corpo do bloco de $post_install_verification$.
 */
export function extractPostInstallBlock(sqlText) {
  const match = sqlText.match(/do\s+\$post_install_verification\$([\s\S]*?)\$post_install_verification\$;/i);
  return match ? match[1] : null;
}

/**
 * Valida o alinhamento estrutural dos blocos de preflight e pós-instalação no código SQL.
 */
export function validateInstallerStructuralBlocks(sqlText) {
  // 1. Extração e validação do bloco $preflight_guard$
  const preflightSql = extractPreflightBlock(sqlText);
  if (!preflightSql) {
    throw new Error('Script não contém o bloco obrigatório "$preflight_guard$" devidamente delimitado.');
  }

  // Validação das 5 RPCs no preflight
  for (const rpc of EXPECTED_RPCS) {
    const rpcRegex = new RegExp(`['"]${rpc}['"]`, 'i');
    if (!rpcRegex.test(preflightSql)) {
      throw new Error(`Guarda de preflight não confere a RPC obrigatória "${rpc}".`);
    }
  }

  // Validação da tabela de recibos no preflight
  if (!preflightSql.includes('event_planning_receipts')) {
    throw new Error('Guarda de preflight não cobre a tabela de recibos "event_planning_receipts".');
  }

  // Validação das 5 colunas no preflight
  for (const col of REQUIRED_PLANNING_COLUMNS) {
    const colRegex = new RegExp(`['"]${col}['"]`, 'i');
    if (!colRegex.test(preflightSql)) {
      throw new Error(`Guarda de preflight não cobre a coluna obrigatória "${col}".`);
    }
  }

  // 2. Extração e validação do bloco $post_install_verification$
  const postInstallSql = extractPostInstallBlock(sqlText);
  if (!postInstallSql) {
    throw new Error('Script não contém o bloco obrigatório "$post_install_verification$" devidamente delimitado.');
  }

  // Validação das 5 colunas na pós-instalação
  for (const col of REQUIRED_PLANNING_COLUMNS) {
    const colRegex = new RegExp(`['"]${col}['"]`, 'i');
    if (!colRegex.test(postInstallSql)) {
      throw new Error(`Pós-instalação não cobre a coluna obrigatória "${col}".`);
    }
  }

  // Validação de RLS na tabela de recibos
  if (!postInstallSql.includes('event_planning_receipts') || !postInstallSql.includes('relrowsecurity = true')) {
    throw new Error('Pós-instalação não confere RLS habilitado (relrowsecurity = true) na tabela "event_planning_receipts".');
  }

  // Validação das 5 RPCs na pós-instalação
  for (const rpc of EXPECTED_RPCS) {
    const rpcRegex = new RegExp(`['"]${rpc}[( '"]`, 'i');
    if (!rpcRegex.test(postInstallSql)) {
      throw new Error(`Pós-instalação não confere a RPC obrigatória "${rpc}".`);
    }
  }

  // Validação de aclexplode e has_function_privilege
  if (!postInstallSql.includes('aclexplode')) {
    throw new Error('Pós-instalação não contém a auditoria direta via "aclexplode".');
  }
  if (!postInstallSql.includes('has_function_privilege')) {
    throw new Error('Pós-instalação não confere privilégio efetivo via "has_function_privilege".');
  }

  // Validação das roles conhecidas
  for (const role of ['postgres', 'authenticated', 'anon', 'service_role']) {
    const roleRegex = new RegExp(`['"]${role}['"]`, 'i');
    if (!roleRegex.test(postInstallSql)) {
      throw new Error(`Pós-instalação não resolve ou confere a role obrigatória "${role}".`);
    }
  }

  return true;
}

/**
 * Validação rigorosa e determinística do payload final de ensaio gerado em memória.
 * Função diretamente exercitável pela suíte de testes sem executar CLI nem persistir arquivos.
 *
 * @param {string} payload
 * @returns {boolean} Retorna true se estritamente válido, ou lança Error descritivo.
 */
export function validateRehearsalPayload(payload) {
  if (typeof payload !== 'string' || payload.length === 0) {
    throw new Error('Payload de ensaio inválido: deve ser uma string não vazia.');
  }

  // 1. Controle transacional
  const txCmds = findTopLevelTransactionCommands(payload);
  const begins = txCmds.filter(t => t.command === 'BEGIN' || t.command.startsWith('START'));
  const commits = txCmds.filter(t => t.command === 'COMMIT' || t.command === 'END');
  const rollbacks = txCmds.filter(t => t.command === 'ROLLBACK');

  if (begins.length !== 1) {
    throw new Error(`Payload final deve conter exatamente 1 BEGIN de topo. Encontrados: ${begins.length}`);
  }
  if (commits.length !== 0) {
    throw new Error(`Payload final não pode conter nenhum COMMIT. Encontrados: ${commits.length}`);
  }
  if (rollbacks.length !== 1) {
    throw new Error(`Payload final deve conter exatamente 1 ROLLBACK de topo. Encontrados: ${rollbacks.length}`);
  }

  // O ROLLBACK deve ser terminal (sem SQL executável após ele)
  const rollbackEntry = rollbacks[0];
  const afterRollback = payload.substring(rollbackEntry.index + rollbackEntry.length);
  const cleanAfterRollback = stripSqlComments(afterRollback).trim();
  if (cleanAfterRollback.length > 0) {
    throw new Error('Payload final possui comandos SQL após o comando terminal ROLLBACK.');
  }

  // 2. Ausência de diretivas pendentes
  const remainingIncludes = extractIncludedDirectives(payload);
  if (remainingIncludes.length > 0) {
    throw new Error(`Payload final contém ${remainingIncludes.length} diretiva(s) de inclusão não expandida(s).`);
  }

  // 3. Presença das 5 RPCs públicas e suas assinaturas
  for (const rpc of EXPECTED_RPCS) {
    const rpcDefRegex = new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${rpc}`, 'i');
    if (!rpcDefRegex.test(payload)) {
      throw new Error(`Payload final não contém a definição da RPC obrigatória "public.${rpc}".`);
    }
  }

  // 4. Presença estrutural dos blocos de preflight e pós-instalação
  validateInstallerStructuralBlocks(payload);

  return true;
}

/**
 * Constrói o payload PostgreSQL para o ensaio reversível a partir do instalador atômico.
 * Executa todas as asserções de integridade, ancoragem, ordem e transação antes e depois da expansão.
 *
 * @param {Object} options
 * @param {string} [options.workspaceRoot] - Diretório raiz do repositório
 * @param {string} [options.installerPath] - Caminho do instalador atômico
 * @param {string} [options.installerContentOverride] - Conteúdo alternativo do instalador (para testes)
 * @param {Object} [options.candidateContentOverrides] - Conteúdo alternativo dos candidatos (para testes)
 * @param {boolean} [options.skipHashVerification=false] - Se true, não valida hashes contra constantes canônicas
 * @returns {Object} { payload, sha256, lineCount, byteLength, components, generatedAt }
 */
export function buildRehearsalPayload(options = {}) {
  const workspaceRoot = options.workspaceRoot ? path.resolve(options.workspaceRoot) : process.cwd();
  const installerPath = options.installerPath
    ? path.resolve(workspaceRoot, options.installerPath)
    : path.resolve(workspaceRoot, DEFAULT_INSTALLER_RELATIVE_PATH);

  // 1. Obtenção do conteúdo do instalador
  let installerContent;
  if (typeof options.installerContentOverride === 'string') {
    installerContent = options.installerContentOverride;
  } else {
    if (!fs.existsSync(installerPath)) {
      throw new Error(`Instalador atômico não encontrado no caminho: ${installerPath}`);
    }
    installerContent = fs.readFileSync(installerPath, 'utf8');
  }

  // 2. Validação de hash do instalador (se não ignorada)
  const installerHash = computeSha256(installerContent);
  if (!options.skipHashVerification && installerHash !== CANONICAL_HASHES.installer) {
    throw new Error(
      `Divergência de hash SHA-256 no instalador atômico.\n` +
      `Esperado: ${CANONICAL_HASHES.installer}\n` +
      `Obtido:   ${installerHash}`
    );
  }

  // 3. Validação dos candidatos aprovados
  const candidateComponents = [];
  const candidateContents = new Map();

  for (const comp of EXPECTED_COMPONENTS) {
    let content;
    const fullPath = path.resolve(workspaceRoot, comp.relativePath);

    if (options.candidateContentOverrides && options.candidateContentOverrides[comp.fileName]) {
      content = options.candidateContentOverrides[comp.fileName];
    } else {
      if (!fs.existsSync(fullPath)) {
        throw new Error(`Candidato aprovado não encontrado: ${fullPath}`);
      }
      content = fs.readFileSync(fullPath, 'utf8');
    }

    const hash = computeSha256(content);
    if (!options.skipHashVerification && hash !== comp.expectedHash) {
      throw new Error(
        `Divergência de hash SHA-256 no candidato "${comp.fileName}".\n` +
        `Esperado: ${comp.expectedHash}\n` +
        `Obtido:   ${hash}`
      );
    }

    // Asserção: nenhum candidato pode ter comandos transacionais de topo
    const txCmds = findTopLevelTransactionCommands(content);
    if (txCmds.length > 0) {
      throw new Error(
        `Candidato "${comp.fileName}" contém ${txCmds.length} comando(s) transacional(is) de topo proibido(s): ` +
        txCmds.map(t => t.command).join(', ')
      );
    }

    candidateContents.set(comp.fileName, {
      ...comp,
      content,
      actualHash: hash,
    });

    candidateComponents.push({
      fileName: comp.fileName,
      relativePath: comp.relativePath,
      sha256: hash,
      order: comp.order,
      verified: true,
    });
  }

  // 4. Validação das inclusões (\ir / \i) no template do instalador
  const included = extractIncludedDirectives(installerContent);
  if (included.length !== EXPECTED_COMPONENTS.length) {
    throw new Error(
      `Instalador deve conter exatamente ${EXPECTED_COMPONENTS.length} inclusões '\\ir'. Encontradas: ${included.length}`
    );
  }

  for (let i = 0; i < EXPECTED_COMPONENTS.length; i++) {
    const expected = EXPECTED_COMPONENTS[i];
    const actual = included[i];
    if (actual.directive !== 'ir') {
      throw new Error(
        `Inclusão na linha ${actual.lineNumber} usa diretiva '\\${actual.directive}'. Exigido estritamente '\\ir'.`
      );
    }
    if (actual.fileName !== expected.fileName) {
      throw new Error(
        `Ordem ou arquivo de inclusão incorreto na posição ${i + 1}.\n` +
        `Esperado: ${expected.fileName}\n` +
        `Encontrado: ${actual.fileName}`
      );
    }
  }

  // 5. Validação estrutural do instalador: preflight fail-closed e pós-condições
  validateInstallerStructuralBlocks(installerContent);

  // 6. Ancoragem e validação transacional do template do instalador
  // a) Confirmação do marcador canônico único
  const markerRegex = new RegExp(FINAL_CONFIRMATION_MARKER, 'g');
  const markerMatches = installerContent.match(markerRegex) || [];
  if (markerMatches.length !== 1) {
    throw new Error(
      `Instalador deve conter exatamente 1 ocorrência do marcador final "${FINAL_CONFIRMATION_MARKER}". Encontradas: ${markerMatches.length}`
    );
  }
  const markerIndex = installerContent.indexOf(FINAL_CONFIRMATION_MARKER);

  // b) Confirmação de que o bloco $post_install_verification$ está fechado antes do marcador
  const postInstallEndTag = '$post_install_verification$;';
  const postInstallEndIndex = installerContent.lastIndexOf(postInstallEndTag, markerIndex);
  if (postInstallEndIndex === -1) {
    throw new Error(`Bloco $post_install_verification$ não está fechado antes do marcador "${FINAL_CONFIRMATION_MARKER}".`);
  }
  const betweenPostAndMarker = installerContent.substring(postInstallEndIndex + postInstallEndTag.length, markerIndex);
  if (stripSqlComments(betweenPostAndMarker).trim().length > 0) {
    throw new Error('Existem instruções SQL executáveis entre o fechamento de $post_install_verification$ e o marcador final.');
  }

  // c) Confirmação dos comandos de transação no instalador
  const templateTx = findTopLevelTransactionCommands(installerContent);
  const templateBegins = templateTx.filter(t => t.command === 'BEGIN' || t.command.startsWith('START'));
  const templateCommits = templateTx.filter(t => t.command === 'COMMIT' || t.command === 'END');
  const templateRollbacks = templateTx.filter(t => t.command === 'ROLLBACK');

  if (templateBegins.length !== 1) {
    throw new Error(`Instalador deve conter exatamente 1 BEGIN de topo. Encontrados: ${templateBegins.length}`);
  }
  if (templateCommits.length !== 1) {
    throw new Error(`Instalador deve conter exatamente 1 COMMIT de topo. Encontrados: ${templateCommits.length}`);
  }
  if (templateRollbacks.length !== 0) {
    throw new Error(`Instalador template não pode conter comandos ROLLBACK de topo. Encontrados: ${templateRollbacks.length}`);
  }

  // d) Confirmação de que o único COMMIT executável aparece depois do marcador
  const commitEntry = templateCommits[0];
  if (commitEntry.index < markerIndex) {
    throw new Error('O comando COMMIT do instalador não aparece após o marcador de confirmação atômica.');
  }

  // e) Confirmação de que o COMMIT é terminal (apenas espaços e comentários após ele)
  const afterCommit = installerContent.substring(commitEntry.index + commitEntry.length);
  if (stripSqlComments(afterCommit).trim().length > 0) {
    throw new Error('O comando COMMIT do instalador não é terminal; existem instruções SQL após sua execução.');
  }

  // 7. Expansão das diretivas \ir em memória
  const lines = installerContent.split(/\r?\n/);
  const expandedLines = [];

  for (const line of lines) {
    const trimmed = line.trim();
    const match = trimmed.startsWith('--') ? null : trimmed.match(/^\\ir\s+([^\s;]+)/i);

    if (match) {
      const targetFileName = path.basename(match[1]);
      const compData = candidateContents.get(targetFileName);
      if (!compData) {
        throw new Error(`Referência não resolvida para inclusão: ${targetFileName}`);
      }

      expandedLines.push(`-- >>> [ENSAIO ATÔMICO] INÍCIO COMPONENTE EXPANDIDO: ${compData.fileName}`);
      expandedLines.push(`-- >>> SHA-256 CANÔNICO CONFERIDO: ${compData.actualHash}`);
      expandedLines.push(compData.content);
      expandedLines.push(`-- <<< [ENSAIO ATÔMICO] FIM COMPONENTE EXPANDIDO: ${compData.fileName}`);
    } else {
      expandedLines.push(line);
    }
  }

  let expandedSql = expandedLines.join('\n');

  // 8. Ancoragem e substituição transacional ancorada pós-expansão
  const expMarkerMatches = expandedSql.match(markerRegex) || [];
  if (expMarkerMatches.length !== 1) {
    throw new Error(
      `Falha na integridade pós-expansão: esperado exatamente 1 marcador "${FINAL_CONFIRMATION_MARKER}". Encontrados: ${expMarkerMatches.length}`
    );
  }
  const expMarkerIndex = expandedSql.indexOf(FINAL_CONFIRMATION_MARKER);

  const expPostInstallEndIndex = expandedSql.lastIndexOf(postInstallEndTag, expMarkerIndex);
  if (expPostInstallEndIndex === -1) {
    throw new Error(`Falha na integridade pós-expansão: bloco $post_install_verification$ não encontrado antes do marcador.`);
  }
  const expBetweenPostAndMarker = expandedSql.substring(expPostInstallEndIndex + postInstallEndTag.length, expMarkerIndex);
  if (stripSqlComments(expBetweenPostAndMarker).trim().length > 0) {
    throw new Error('Falha na integridade pós-expansão: instruções SQL detectadas entre $post_install_verification$ e o marcador.');
  }

  const expandedTx = findTopLevelTransactionCommands(expandedSql);
  const expandedCommits = expandedTx.filter(t => t.command === 'COMMIT' || t.command === 'END');
  if (expandedCommits.length !== 1) {
    throw new Error(
      `Falha na integridade pós-expansão: esperado exatamente 1 COMMIT para substituição. Encontrados: ${expandedCommits.length}`
    );
  }

  const expCommitEntry = expandedCommits[0];
  if (expCommitEntry.index < expMarkerIndex) {
    throw new Error('Falha na integridade pós-expansão: COMMIT não está localizado após o marcador.');
  }

  const afterExpCommit = expandedSql.substring(expCommitEntry.index + expCommitEntry.length);
  if (stripSqlComments(afterExpCommit).trim().length > 0) {
    throw new Error('Falha na integridade pós-expansão: COMMIT a ser substituído não é terminal.');
  }

  // Substitui estritamente esse COMMIT por ROLLBACK ancorado com o cabeçalho de ensaio
  const beforeExpCommit = expandedSql.substring(0, expCommitEntry.index);
  const rehearsalFooter = [
    '-- ==============================================================================',
    '-- ENSAIO REVERSÍVEL AUTORIZADO (ISSUE #57): REVERSÃO INTEGRAL OBRIGATÓRIA',
    '-- Em conformidade com o protocolo de ensaio atômico, a transação indivisível é',
    '-- encerrada com ROLLBACK, garantindo 100% de reversibilidade e estado zero permanente.',
    '-- ==============================================================================',
    'rollback;',
    '',
  ].join('\n');

  const payload = beforeExpCommit + rehearsalFooter + afterExpCommit;

  // 9. Asserções rigorosas pós-geração sobre o payload final via função reutilizável
  validateRehearsalPayload(payload);

  const payloadHash = computeSha256(payload);
  const payloadLines = payload.split(/\r?\n/).length;
  const payloadBytes = Buffer.byteLength(payload, 'utf8');

  return {
    payload,
    sha256: payloadHash,
    lineCount: payloadLines,
    byteLength: payloadBytes,
    components: candidateComponents,
    installerHash,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Realiza o parsing determinístico e fail-closed dos argumentos de linha de comando da CLI.
 * Executado estritamente antes de qualquer geração de payload ou operação no sistema de arquivos.
 *
 * Regras do Contrato:
 * 1. Chamada sem argumentos ou apenas com --dry-run opera em modo dry-run (retorna mode: 'dry-run').
 * 2. Opção --help / -h só é válida se fornecida isoladamente.
 * 3. Opção --out requer exatamente um caminho não vazio que não comece com '-'.
 * 4. Conflito mútuo entre --dry-run e --out é estritamente rejeitado, independente da ordem.
 * 5. Duplicações de opções (--dry-run, --out) são rejeitadas.
 * 6. Qualquer argumento posicional ou opção desconhecida é rejeitada.
 *
 * @param {string[]} [argv=[]] Array de argumentos da linha de comando
 * @returns {{ mode: 'dry-run' | 'out' | 'help', dryRun: boolean, outPath: string | null }}
 * @throws {Error} Lança erro descritivo em caso de violação de contrato.
 */
export function parseCliArgs(argv = []) {
  if (!Array.isArray(argv)) {
    throw new Error('Argumentos da CLI devem ser fornecidos como um array de strings.');
  }

  // 1. Caso padrão: chamada sem argumentos opera em dry-run
  if (argv.length === 0) {
    return { mode: 'dry-run', dryRun: true, outPath: null };
  }

  let hasHelp = false;
  let hasDryRun = false;
  let outPath = null;
  let outCount = 0;
  let dryRunCount = 0;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '--help' || arg === '-h') {
      hasHelp = true;
    } else if (arg === '--dry-run') {
      hasDryRun = true;
      dryRunCount++;
    } else if (arg === '--out') {
      outCount++;
      const nextArg = argv[i + 1];
      if (nextArg === undefined) {
        throw new Error('Opção "--out" requer um caminho de destino.');
      }
      if (typeof nextArg !== 'string' || nextArg.trim().length === 0) {
        throw new Error('Opção "--out" requer um caminho de destino não vazio.');
      }
      if (nextArg.startsWith('-')) {
        throw new Error(`Caminho inválido para "--out": "${nextArg}". Valores iniciados por "-" não são permitidos.`);
      }
      outPath = nextArg;
      i++; // consome o valor de outPath
    } else {
      throw new Error(`Argumento ou opção desconhecida: "${arg}".`);
    }
  }

  // 2. Validação de --help / -h (deve ser estritamente isolada)
  if (hasHelp) {
    if (argv.length > 1) {
      throw new Error('Opção de ajuda (--help / -h) não pode ser combinada com outros argumentos.');
    }
    return { mode: 'help', dryRun: true, outPath: null };
  }

  // 3. Validação de duplicações
  if (dryRunCount > 1) {
    throw new Error('Opção "--dry-run" duplicada.');
  }
  if (outCount > 1) {
    throw new Error('Opção "--out" duplicada.');
  }

  // 4. Validação de conflito mútuo estrito entre --dry-run e --out (ordem independente)
  if (hasDryRun && outPath !== null) {
    throw new Error('Conflito de opções: "--dry-run" e "--out" são mutuamente exclusivas e não podem ser combinadas.');
  }

  if (outPath !== null) {
    return { mode: 'out', dryRun: false, outPath };
  }

  if (hasDryRun) {
    return { mode: 'dry-run', dryRun: true, outPath: null };
  }

  return { mode: 'dry-run', dryRun: true, outPath: null };
}

/**
 * Ponto de entrada CLI (execução via linha de comando).
 * Opera em modo dry-run por padrão. Se invocado com --out, utiliza criação exclusiva
 * atômica (flag 'wx') para impedir qualquer sobrescrita (fail-closed em EEXIST).
 * O parsing de argumentos é estritamente fail-closed e validado antes da geração do payload.
 */
export function runCli(argv = process.argv.slice(2)) {
  let parsed;
  try {
    parsed = parseCliArgs(argv);
  } catch (parseErr) {
    console.error('ERRO NA LINHA DE COMANDO:');
    console.error(parseErr.message);
    return 1;
  }

  if (parsed.mode === 'help') {
    console.log(`
Gerador de Payload de Ensaio Reversível — Issue #57
Uso: node tools/build-event-planning-atomic-rehearsal.js [opções]

Opções:
  --dry-run       Modo explícito sem persistência (padrão se nenhuma opção for passada).
  --out <caminho> Grava o payload gerado no arquivo especificado via criação exclusiva atômica (flag 'wx').
                  ATENÇÃO: Operação fail-closed — recusa sobrescrever se o arquivo de destino já existir (EEXIST).
                  Não pode ser combinado com --dry-run.
  --help, -h      Exibe esta mensagem de ajuda (deve ser usada isoladamente).
`);
    return 0;
  }

  try {
    const result = buildRehearsalPayload();

    console.log('================================================================');
    console.log('ENSAIO REVERSÍVEL — ISSUE #57: GERAÇÃO DETERMINÍSTICA CONCLUÍDA');
    console.log('================================================================');
    console.log(`Hash do Instalador Template : ${result.installerHash}`);
    console.log('Componentes Verificados:');
    for (const c of result.components) {
      console.log(`  [OK] ${c.fileName} (Ordem: ${c.order}, SHA-256: ${c.sha256})`);
    }
    console.log('----------------------------------------------------------------');
    console.log(`Payload Rehearsal SHA-256   : ${result.sha256}`);
    console.log(`Linhas do Payload           : ${result.lineCount}`);
    console.log(`Tamanho em Bytes            : ${result.byteLength}`);
    console.log('Controle Transacional       : 1 BEGIN | 0 COMMIT | 1 ROLLBACK (terminal)');
    console.log('----------------------------------------------------------------');

    if (parsed.mode === 'out') {
      const destPath = path.resolve(process.cwd(), parsed.outPath);
      try {
        fs.writeFileSync(destPath, result.payload, { encoding: 'utf8', flag: 'wx' });
        console.log(`Arquivo gravado com sucesso em: ${destPath}`);
      } catch (writeErr) {
        if (writeErr.code === 'EEXIST') {
          throw new Error(
            `Destino já existe: "${destPath}". Operação atômica exclusiva recusada (EEXIST) para prevenção contra sobrescrita acidental.`
          );
        }
        throw writeErr;
      }
    } else {
      console.log('Modo Dry-Run ativo: nenhum arquivo persistido no disco.');
    }
    console.log('================================================================');
    return 0;
  } catch (err) {
    console.error('ERRO NA GERAÇÃO DO PAYLOAD DE ENSAIO:');
    console.error(err.message);
    return 1;
  }
}

// Execução se chamado diretamente
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const exitCode = runCli(process.argv.slice(2));
  process.exit(exitCode);
}
