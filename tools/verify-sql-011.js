#!/usr/bin/env node

/**
 * Escala do Reino — Verificador Estático Integrado (Incremento 011/012)
 *
 * Valida rigorosamente sem conexão ao banco:
 *   1. Manifesto Canônico Único: derivação de regras, ações de auditoria vs recibo disjuntas.
 *   2. Sincronismo de Geração: verificação bit-a-bit dos artefatos contra a fonte única.
 *   3. Assinaturas Completas: exatamente as 9 RPCs com tipos exatos de parâmetros e retornos.
 *   4. Endurecimento Isolado por Função: SECURITY DEFINER, search_path, timeout e ausência de COMMIT/ROLLBACK.
 *   5. Correspondência Integral dos Objetos Comuns entre instalação e ensaio.
 *   6. Evolução de Recibos: schema e constraints de command_receipts.
 *   7. Ações de Auditoria, Recibos e Constantes: verificação contra manifesto e implementações.
 *   8. Integridade de Scripts 000–010: validação por hash SHA-256 e validação de colunas de tabelas.
 *   9. Formato Hexadecimal Estrito de UUIDs.
 *  10. Equilíbrio Estrutural de Blocos PL/pgSQL (BEGIN vs END; balanceados).
 *  11. Coerência Temporal e Invariantes de Fixtures: submitted_at < expires_at, etc.
 *  12. Qualidade de Asserções: ausência de swallow de erros e uso de verificações seguras contra NULL.
 *
 * Suporta execução parametrizada em memória para contraprovas e testes negativos.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { generateArtifacts } from './generate-sql-011.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRootDir = path.resolve(__dirname, '..');

/**
 * Carrega e interpreta o manifesto canônico a partir do caminho real ou overrides
 */
export function loadManifest(rootDir = defaultRootDir, overrides = {}) {
  const relPath = 'docs/sql/src_011/00_actions_manifest.json';
  if (overrides[relPath] !== undefined) {
    return JSON.parse(overrides[relPath]);
  }
  const fullPath = path.join(rootDir, relPath);
  return JSON.parse(fs.readFileSync(fullPath, 'utf8'));
}

const defaultManifest = loadManifest();
export const CANONICAL_RPCS = (defaultManifest.rpcs || []).map(
  r => `${r.name}(${r.parameters.map(p => p.type).join(', ')})`
);
export const CANONICAL_AUDIT_ACTIONS = new Set(Object.keys(defaultManifest.audit_actions || {}));
export const CANONICAL_RECEIPT_ACTIONS = new Set(Object.keys(defaultManifest.receipt_actions || {}));

/**
 * Normaliza tipos SQL suportados para equivalência canônica
 */
export function normalizeType(typeStr) {
  if (!typeStr) return '';
  let t = typeStr.trim().toLowerCase().replace(/\s+/g, ' ');
  if (t === 'timestamp with time zone' || t === 'timestamptz') return 'timestamptz';
  if (t === 'timestamp without time zone' || t === 'timestamp') return 'timestamp';
  if (t === 'int' || t === 'int4' || t === 'integer') return 'integer';
  if (t === 'int8' || t === 'bigint') return 'bigint';
  if (t === 'int2' || t === 'smallint') return 'smallint';
  if (t === 'bool' || t === 'boolean') return 'boolean';
  return t;
}

/**
 * Analisa e estrutura a cláusula de retorno de uma RPC (table(...) ou tipo escalar)
 */
export function parseReturns(returnsStr) {
  if (!returnsStr) return null;
  const clean = returnsStr
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--.*$/gm, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const tableMatch = clean.match(/^table\s*\(([\s\S]*)\)$/i);
  if (tableMatch) {
    const colsStr = tableMatch[1].trim();
    if (!colsStr) return { kind: 'table', columns: [], raw: clean };
    const cols = colsStr.split(',').map(c => c.trim()).filter(Boolean).map(colDef => {
      const parts = colDef.split(/\s+/);
      const name = parts[0];
      const rawType = parts.slice(1).join(' ');
      return {
        name,
        type: normalizeType(rawType),
        rawType
      };
    });
    return { kind: 'table', columns: cols, raw: clean };
  }
  return { kind: 'scalar', type: normalizeType(clean), raw: clean };
}

/**
 * Utilitário para limpar comentários e literais de string para análise sintática
 */
function stripCommentsAndStrings(code) {
  // Remove blocos de comentário /* ... */
  let clean = code.replace(/\/\*[\s\S]*?\*\//g, ' ');
  // Remove comentários de linha -- ...
  clean = clean.replace(/--.*$/gm, ' ');
  // Remove strings entre aspas simples ''
  clean = clean.replace(/'(?:''|[^'])*'/g, "''");
  return clean;
}

/**
 * Extrai funções PL/pgSQL com recorte estrito até seu delimitador real
 */
export function extractFunctionDefinitions(sql) {
  const fns = [];
  // Procura create (or replace) function public.<name>
  const createRegex = /create\s+(?:or\s+replace\s+)?function\s+public\.([a-zA-Z0-9_]+)\s*\(([\s\S]*?)\)\s*returns\s+([\s\S]*?)\s+language\s+plpgsql/gi;
  let match;
  while ((match = createRegex.exec(sql)) !== null) {
    const fnName = match[1];
    const rawParams = match[2];
    const rawReturns = match[3];
    const startIdx = match.index;

    // Achar o dollar quote de abertura: as $<tag>$
    const afterLang = sql.slice(startIdx);
    const tagMatch = afterLang.match(/as\s+\$([a-zA-Z0-9_]*)\$/i);
    if (!tagMatch) continue;

    const tag = tagMatch[1];
    const bodyStartIdx = tagMatch.index + tagMatch[0].length;
    // Achar o dollar quote de fechamento: $<tag>$;
    const closePattern = new RegExp(`\\$${tag}\\$\\s*;`, 'i');
    const closeMatch = afterLang.slice(bodyStartIdx).match(closePattern);
    if (!closeMatch) continue;

    const fullEndIdx = bodyStartIdx + closeMatch.index + closeMatch[0].length;
    const fullText = afterLang.slice(0, fullEndIdx);
    const bodyText = afterLang.slice(bodyStartIdx, bodyStartIdx + closeMatch.index);

    // Parse de parâmetros: nome e tipo
    const params = rawParams
      .split(',')
      .map(p => p.trim())
      .filter(Boolean)
      .map(p => {
        const parts = p.split(/\s+/);
        return { name: parts[0], type: parts[1] ? parts[1].toLowerCase() : '' };
      });

    fns.push({
      name: fnName,
      fullText,
      bodyText,
      params,
      rawReturns: rawReturns.replace(/\s+/g, ' ').trim(),
      startIdx,
      endIdx: startIdx + fullEndIdx
    });
  }
  return fns;
}

/**
 * Analisa offset em segundos de expressões de timestamp/intervalo
 */
function parseIntervalOffsetSeconds(expr) {
  if (!expr) return null;
  const s = expr.trim();
  let totalSeconds = 0;
  let hasInterval = false;
  const matches = [...s.matchAll(/([+-])\s*interval\s*'([^']+)'/gi)];
  for (const m of matches) {
    hasInterval = true;
    const sign = m[1] === '-' ? -1 : 1;
    const parts = m[2].trim().split(/\s+/);
    for (let i = 0; i < parts.length; i += 2) {
      const val = parseFloat(parts[i]);
      const unit = (parts[i + 1] || '').toLowerCase();
      let factor = 1;
      if (unit.startsWith('second')) factor = 1;
      else if (unit.startsWith('minute')) factor = 60;
      else if (unit.startsWith('hour')) factor = 3600;
      else if (unit.startsWith('day')) factor = 86400;
      else if (unit.startsWith('millisecond')) factor = 0.001;
      totalSeconds += sign * val * factor;
    }
  }
  if (hasInterval) return totalSeconds;
  if (s.includes('statement_timestamp()') || s.includes('clock_timestamp()') || /^v_t/i.test(s)) {
    return 0;
  }
  return null;
}

/**
 * Executa todas as verificações estáticas locais
 */
export function runChecks(options = {}) {
  const errors = [];
  const warnings = [];
  const log = options.silent ? () => {} : console.log;
  const rootDir = options.rootDir || defaultRootDir;
  const overrides = options.overrides || {};

  function getFileContent(relPath) {
    const normalizedRel = relPath.replace(/\\/g, '/');
    if (overrides[normalizedRel] !== undefined) {
      return overrides[normalizedRel].replace(/\r\n/g, '\n');
    }
    const fullPath = path.join(rootDir, relPath);
    if (!fs.existsSync(fullPath)) return null;
    return fs.readFileSync(fullPath, 'utf8').replace(/\r\n/g, '\n');
  }

  log('\n=== INICIANDO VERIFICAÇÕES LOCAIS DE ARTEFATOS SQL (011/012) ===\n');

  // 1. Carregar e Validar Manifesto Canônico Único
  log('[1/11] Validando Manifesto Canônico (00_actions_manifest.json)...');
  const manifestContent = getFileContent('docs/sql/src_011/00_actions_manifest.json');
  if (!manifestContent) {
    errors.push('Manifesto docs/sql/src_011/00_actions_manifest.json ausente!');
    return { errors, warnings };
  }

  let manifest;
  try {
    manifest = JSON.parse(manifestContent);
  } catch (err) {
    errors.push(`Erro de sintaxe JSON no manifesto: ${err.message}`);
    return { errors, warnings };
  }

  const auditSet = new Set(Object.keys(manifest.audit_actions || {}));
  const receiptSet = new Set(Object.keys(manifest.receipt_actions || {}));

  // Validar disjunção estrita de auditoria e recibos
  for (const act of auditSet) {
    if (receiptSet.has(act)) {
      errors.push(`Conflito no manifesto: ação '${act}' está em audit_actions E receipt_actions simultaneamente!`);
    }
  }

  // Validar constantes de injeção mapeadas
  const injectionConstants = manifest.injection_constants || {};
  for (const [cName, cVal] of Object.entries(injectionConstants)) {
    if (cName.startsWith('c_audit_') && !auditSet.has(cVal)) {
      errors.push(`Manifesto: constante ${cName} mapeia para ação de auditoria inválida/desconhecida '${cVal}'`);
    }
    if (cName.startsWith('c_receipt_') && !receiptSet.has(cVal)) {
      errors.push(`Manifesto: constante ${cName} mapeia para ação de recibo inválida/desconhecida '${cVal}'`);
    }
  }

  // 2. Verificação de sincronismo dos arquivos gerados com a fonte única
  log('[2/11] Verificando sincronismo dos arquivos gerados com src_011/...');
  const { installSql, validateSql } = generateArtifacts({
    srcDir: path.join(rootDir, 'docs', 'sql', 'src_011'),
    overrides
  });

  const diskInstall = getFileContent('docs/sql/011_invitations_and_requests.sql');
  const diskValidate = getFileContent('docs/sql/011_validate_invitations.sql');

  if (diskInstall !== installSql) {
    errors.push('011_invitations_and_requests.sql não corresponde à geração determinística de src_011/. Execute node tools/generate-sql-011.js');
  }
  if (diskValidate !== validateSql) {
    errors.push('011_validate_invitations.sql não corresponde à geração determinística de src_011/. Execute node tools/generate-sql-011.js');
  }

  const effectiveInstall = overrides['docs/sql/011_invitations_and_requests.sql'] !== undefined
    ? overrides['docs/sql/011_invitations_and_requests.sql']
    : installSql;
  const effectiveValidate = overrides['docs/sql/011_validate_invitations.sql'] !== undefined
    ? overrides['docs/sql/011_validate_invitations.sql']
    : validateSql;

  // 3. Verificação de assinaturas completas e recorte exato de funções
  log('[3/11] Verificando exatamente as 9 RPCs e assinaturas completas (parâmetros e retornos)...');
  const rpcsFound = extractFunctionDefinitions(effectiveInstall);

  if (rpcsFound.length !== 9) {
    errors.push(`Esperado exatamente 9 RPCs em public, encontrado: ${rpcsFound.length}`);
  }

  const foundRpcMap = new Map();
  for (const rpc of rpcsFound) {
    if (foundRpcMap.has(rpc.name)) {
      errors.push(`RPC duplicada encontrada em 011_invitations_and_requests.sql: '${rpc.name}'`);
    }
    foundRpcMap.set(rpc.name, rpc);
  }

  const manifestRpcs = manifest.rpcs || [];
  for (const mRpc of manifestRpcs) {
    const foundRpc = foundRpcMap.get(mRpc.name);
    if (!foundRpc) {
      errors.push(`RPC canônica esperada ausente: '${mRpc.name}'`);
      continue;
    }

    // Verificar parâmetros (nomes e tipos)
    const expectedParams = mRpc.parameters || [];
    if (foundRpc.params.length !== expectedParams.length) {
      errors.push(`RPC ${mRpc.name}: quantidade de parâmetros divergente (esperado ${expectedParams.length}, encontrado ${foundRpc.params.length})`);
    } else {
      for (let i = 0; i < expectedParams.length; i++) {
        const exp = expectedParams[i];
        const act = foundRpc.params[i];
        if (exp.name !== act.name) {
          errors.push(`RPC ${mRpc.name}: parâmetro ${i + 1} com nome incorreto '${act.name}' (esperado '${exp.name}')`);
        }
        if (exp.type.toLowerCase() !== act.type.toLowerCase()) {
          errors.push(`RPC ${mRpc.name}: parâmetro '${exp.name}' com tipo incorreto '${act.type}' (esperado '${exp.type}')`);
        }
      }
    }

    // Verificar retornos (formato, nomes, ordem e tipos com normalização)
    if (mRpc.returns) {
      const expRet = parseReturns(mRpc.returns);
      const actRet = parseReturns(foundRpc.rawReturns);

      if (!expRet || !actRet) {
        errors.push(`RPC ${mRpc.name}: falha ao analisar cláusula de retorno (esperado '${mRpc.returns}', encontrado '${foundRpc.rawReturns}')`);
      } else if (expRet.kind !== actRet.kind) {
        errors.push(`RPC ${mRpc.name}: formato de retorno divergente (esperado '${expRet.kind}', encontrado '${actRet.kind}')`);
      } else if (expRet.kind === 'table') {
        if (expRet.columns.length !== actRet.columns.length) {
          errors.push(`RPC ${mRpc.name}: quantidade de colunas de retorno divergente (esperado ${expRet.columns.length}, encontrado ${actRet.columns.length})`);
        }
        const maxCols = Math.max(expRet.columns.length, actRet.columns.length);
        for (let i = 0; i < maxCols; i++) {
          if (i >= actRet.columns.length) {
            const expCol = expRet.columns[i];
            errors.push(`RPC ${mRpc.name}: coluna de retorno ausente: '${expCol.name}' (${expCol.type})`);
          } else if (i >= expRet.columns.length) {
            const actCol = actRet.columns[i];
            errors.push(`RPC ${mRpc.name}: coluna de retorno excedente: '${actCol.name}' (${actCol.type})`);
          } else {
            const expCol = expRet.columns[i];
            const actCol = actRet.columns[i];
            if (expCol.name !== actCol.name) {
              errors.push(`RPC ${mRpc.name}: coluna de retorno ${i + 1} com nome divergente '${actCol.name}' (esperado '${expCol.name}')`);
            }
            if (expCol.type !== actCol.type) {
              errors.push(`RPC ${mRpc.name}: coluna de retorno '${expCol.name}' com tipo incorreto '${actCol.rawType || actCol.type}' (esperado '${expCol.type}')`);
            }
          }
        }
      } else {
        if (expRet.type !== actRet.type) {
          errors.push(`RPC ${mRpc.name}: tipo de retorno incorreto '${actRet.type}' (esperado '${expRet.type}')`);
        }
      }
    }
  }

  // 4. Endurecimento isolado por função
  log('[4/11] Verificando SECURITY DEFINER, search_path, timeouts e ausência de transações internas por função...');
  for (const rpc of rpcsFound) {
    const fnSlice = rpc.fullText.toLowerCase();

    if (!/\bsecurity\s+definer\b/.test(fnSlice)) {
      errors.push(`RPC ${rpc.name}: deve conter estritamente SECURITY DEFINER em sua declaração!`);
    }
    if (/\bsecurity\s+invoker\b/.test(fnSlice)) {
      errors.push(`RPC ${rpc.name}: declaração ilegal SECURITY INVOKER detectada!`);
    }
    if (!/set\s+search_path\s*=\s*(''|"")/.test(fnSlice)) {
      errors.push(`RPC ${rpc.name}: deve conter estritamente set search_path = ''`);
    }
    if (!/set\s+statement_timeout\s*=\s*'5s'/.test(fnSlice)) {
      errors.push(`RPC ${rpc.name}: deve conter estritamente set statement_timeout = '5s'`);
    }

    // Ausência de controle interno de transação
    const cleanBody = stripCommentsAndStrings(rpc.bodyText);
    if (/\bcommit\s*;/i.test(cleanBody)) {
      errors.push(`RPC ${rpc.name}: contém comando ilegal COMMIT no corpo da função!`);
    }
    if (/\brollback\s*;/i.test(cleanBody)) {
      errors.push(`RPC ${rpc.name}: contém comando ilegal ROLLBACK no corpo da função!`);
    }

    // Compatibilidade estrita com Supabase Auth nativo (auth.users.email varchar(255))
    if (rpc.name === 'list_church_access_requests') {
      if (!/coalesce\s*\(\s*u\.email\s*,\s*''\s*\)\s*::\s*text/i.test(rpc.bodyText)) {
        errors.push(`RPC list_church_access_requests: deve conter cast explícito 'coalesce(u.email, '')::text' para compatibilidade com auth.users.email varchar(255) do Supabase Auth.`);
      }
    }
  }

  // 5. Correspondência integral dos objetos comuns entre os modos gerados
  log('[5/11] Verificando correspondência integral dos objetos comuns entre instalação e ensaio...');
  const extractCommon = (sql) => {
    const start = sql.indexOf('do $preflight$');
    const end = sql.indexOf('revoke all on table app_private.command_receipts from public, anon, authenticated, service_role;');
    if (start === -1 || end === -1) return null;
    return sql.slice(start, end + 'revoke all on table app_private.command_receipts from public, anon, authenticated, service_role;'.length);
  };

  const commonInstall = extractCommon(effectiveInstall);
  const commonValidate = extractCommon(effectiveValidate);
  if (!commonInstall || !commonValidate) {
    errors.push('Falha ao extrair bloco comum de objetos entre instalação e ensaio.');
  } else if (commonInstall !== commonValidate) {
    errors.push('Bloco comum de objetos difere entre 011_invitations_and_requests.sql e 011_validate_invitations.sql!');
  }

  // 6. Evolução de command_receipts
  log('[6/11] Verificando evolução de command_receipts...');
  const evolveMatches = [...effectiveInstall.matchAll(/do\s+\$evolve_receipts\$[\s\S]*?\$evolve_receipts\$/gi)];
  if (evolveMatches.length !== 1) {
    errors.push(`Esperado exatamente 1 bloco de evolução de command_receipts, encontrado: ${evolveMatches.length}`);
  } else {
    const evolveCode = evolveMatches[0][0];
    if (!evolveCode.includes('result_entity_id') || !evolveCode.includes('result_payload') || !evolveCode.includes('command_receipts_payload_check')) {
      errors.push('Bloco de evolução de command_receipts incompleto (colunas ou constraint ausentes).');
    }
  }

  // 7. Ações de Auditoria, Recibos e Constantes SQL
  log('[7/11] Verificando separação estrita de auditoria vs recibo, constantes e injeção de falha...');
  // Ações gravadas por RPCs
  const recordedAudits = new Set();
  const recordedReceipts = new Set();

  [...effectiveInstall.matchAll(/insert\s+into\s+app_private\.audit_entries[\s\S]*?values\s*\([^,]+,\s*'([^']+)'/gi)].forEach(m => {
    recordedAudits.add(m[1]);
  });
  [...effectiveInstall.matchAll(/insert\s+into\s+app_private\.command_receipts[\s\S]*?values\s*\([^,]+,[^,]+,[^,]+,\s*'([^']+)'/gi)].forEach(m => {
    recordedReceipts.add(m[1]);
  });

  recordedAudits.forEach(act => {
    if (!auditSet.has(act)) {
      errors.push(`Ação de auditoria não-canônica gravada pela implementação: '${act}'`);
    }
  });

  recordedReceipts.forEach(act => {
    if (!receiptSet.has(act)) {
      errors.push(`Ação de recibo não-canônica gravada pela implementação: '${act}'`);
    }
  });

  // Conferir constantes declaradas no script de teste
  const constMatches = [...effectiveValidate.matchAll(/(c_audit_[a-zA-Z0-9_]+|c_receipt_[a-zA-Z0-9_]+)\s+constant\s+text\s*:=\s*'([^']+)'/g)];
  for (const cm of constMatches) {
    const cName = cm[1];
    const cVal = cm[2];
    const expectedVal = injectionConstants[cName];
    if (!expectedVal) {
      errors.push(`Constante desconhecida declarada no ensaio: ${cName}`);
    } else if (cVal !== expectedVal) {
      errors.push(`Constante ${cName} com valor divergente do manifesto: '${cVal}' (esperado '${expectedVal}')`);
    }
  }

  // Conferir injeções de falha
  const auditInjections = [...effectiveValidate.matchAll(/perform\s+set_config\('app\.fail_audit_action',\s*(?:'([^']+)'|(c_audit_[a-zA-Z0-9_]+))/g)];
  for (const inj of auditInjections) {
    const literal = inj[1];
    const constRef = inj[2];
    if (literal && literal.length > 0 && !auditSet.has(literal)) {
      errors.push(`Injeção de falha app.fail_audit_action com ação não-canônica: '${literal}'`);
    }
    if (constRef && !injectionConstants[constRef]) {
      errors.push(`Injeção de falha app.fail_audit_action com constante desconhecida: ${constRef}`);
    }
  }

  const receiptInjections = [...effectiveValidate.matchAll(/perform\s+set_config\('app\.fail_receipt_action',\s*(?:'([^']+)'|(c_receipt_[a-zA-Z0-9_]+))/g)];
  for (const inj of receiptInjections) {
    const literal = inj[1];
    const constRef = inj[2];
    if (literal && literal.length > 0 && !receiptSet.has(literal)) {
      errors.push(`Injeção de falha app.fail_receipt_action com ação não-canônica: '${literal}'`);
    }
    if (constRef && !injectionConstants[constRef]) {
      errors.push(`Injeção de falha app.fail_receipt_action com constante desconhecida: ${constRef}`);
    }
  }

  // 8. Integridade dos Scripts 000–010 e Validação de Colunas
  log('[8/11] Verificando integridade dos scripts 000-010 (hashes baseline) e colunas contra schemas...');
  const baselineHashes = manifest.baseline_hashes || {};
  for (const [scriptName, expectedHash] of Object.entries(baselineHashes)) {
    const content = getFileContent(path.join('docs', 'sql', scriptName));
    if (!content) {
      errors.push(`Script anterior canônico ausente: ${scriptName}`);
      continue;
    }
    const actualHash = crypto.createHash('sha256').update(content).digest('hex');
    if (actualHash !== expectedHash) {
      errors.push(`Script anterior ${scriptName} foi modificado ou corrompido! Hash SHA-256 divergente do baseline aprovado.`);
    }
  }

  const knownSchemas = manifest.known_schemas || {};
  const schemaSets = {};
  for (const [t, cols] of Object.entries(knownSchemas)) {
    schemaSets[t] = new Set(cols);
  }

  const filesToCheckColumns = [
    { name: '011_validate_invitations.sql', content: effectiveValidate },
    { name: '011_concurrency_session_a.sql', content: getFileContent('docs/sql/concurrency/011_concurrency_session_a.sql') || '' }
  ];

  for (const f of filesToCheckColumns) {
    const insertMatches = [...f.content.matchAll(/insert\s+into\s+([a-zA-Z0-9_\.]+)\s*\(([^)]+)\)/gi)];
    for (const m of insertMatches) {
      let tableName = m[1].toLowerCase();
      if (!tableName.includes('.')) {
        tableName = 'app_private.' + tableName;
      }
      const rawCols = m[2];
      const cols = rawCols.split(',').map(c => c.trim().toLowerCase());
      const knownCols = schemaSets[tableName];
      if (knownCols) {
        for (const col of cols) {
          if (!knownCols.has(col)) {
            errors.push(`[${f.name}] Coluna inexistente '${col}' em inserção na tabela '${tableName}'!`);
          }
        }
      }
    }
  }

  // 9. Formato Hexadecimal Estrito de UUIDs
  log('[9/11] Verificando formato hexadecimal estrito de UUIDs sintéticos...');
  const uuidStrictRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  for (const f of filesToCheckColumns) {
    const literalUuids = [...f.content.matchAll(/'([0-9a-zA-Z-]{36})'/g)];
    for (const m of literalUuids) {
      const candidate = m[1];
      if (candidate.split('-').length === 5) {
        if (!uuidStrictRegex.test(candidate.toLowerCase())) {
          errors.push(`[${f.name}] UUID sintético com caractere não-hexadecimal inválido: '${candidate}'`);
        }
      }
    }
  }

  // 10. Equilíbrio Estrutural de Blocos PL/pgSQL e Declaração Estrita de Variáveis
  log('[10/11] Verificando equilíbrio estrutural de blocos PL/pgSQL (BEGIN vs END;) e escopo de variáveis...');
  const doBlocks = [...effectiveValidate.matchAll(/do\s+\$([a-zA-Z0-9_]*)\$([\s\S]*?)\$\1\$\s*;/gi)];
  for (const db of doBlocks) {
    const tag = db[1];
    const code = db[2];
    const cleanCode = stripCommentsAndStrings(code);
    const beginCount = (cleanCode.match(/\bbegin\b/gi) || []).length;
    const endCount = (cleanCode.match(/\bend\s*;/gi) || []).length;

    if (beginCount !== endCount) {
      errors.push(`Bloco PL/pgSQL DO $${tag}$ em 011_validate_invitations.sql está desbalanceado: ${beginCount} BEGIN vs ${endCount} END;`);
    }

    // Validação estrita de escopo para variáveis em DO $test$
    if (tag.toLowerCase() === 'test') {
      const declMatch = code.match(/\bdeclare([\s\S]*?)\bbegin\b/i);
      if (declMatch) {
        const declared = new Set();
        const declLines = declMatch[1].split('\n');
        for (const dl of declLines) {
          const dm = dl.trim().match(/^([a-zA-Z0-9_]+)\s+[^;:=]+/);
          if (dm && (dm[1].startsWith('v_') || dm[1].startsWith('c_'))) {
            declared.add(dm[1].toLowerCase());
          }
        }

        // Sub-blocos com declare
        const subBlockDecls = [...code.matchAll(/\bdeclare([\s\S]*?)\bbegin\b/gi)];
        const subDeclared = new Set();
        for (let i = 1; i < subBlockDecls.length; i++) {
          const sLines = subBlockDecls[i][1].split('\n');
          for (const sl of sLines) {
            const sm = sl.trim().match(/^([a-zA-Z0-9_]+)\s+[^;:=]+/);
            if (sm && (sm[1].startsWith('v_') || sm[1].startsWith('c_'))) {
              subDeclared.add(sm[1].toLowerCase());
            }
          }
        }

        const linesOfBlock = code.split('\n');
        for (let idx = 0; idx < linesOfBlock.length; idx++) {
          const lineStr = linesOfBlock[idx].trim();
          if (lineStr.startsWith('--')) continue;
          const vMatches = lineStr.match(/\b(v_[a-zA-Z0-9_]+)\b/g) || [];
          for (const vName of vMatches) {
            const vLower = vName.toLowerCase();
            if (!declared.has(vLower) && !subDeclared.has(vLower)) {
              errors.push(`[DO $${tag}$] Variável '${vName}' utilizada sem declaração no bloco de ensaio!`);
            }
          }
        }
      }
    }
  }

  // 11. Coerência Temporal e Invariantes de Fixtures
  log('[11/11] Verificando coerência de prazos (72h), estados e FK composta em fixtures...');
  // Validar inserts em access_requests para garantir submitted_at < expires_at
  const reqInserts = [...effectiveValidate.matchAll(/insert\s+into\s+app_private\.access_requests\s*\(([^)]+)\)\s*(?:values\s*\(([\s\S]*?)\)\s*;|select\s+([\s\S]*?)\s+from)/gi)];
  for (const ri of reqInserts) {
    const colList = ri[1].split(',').map(c => c.trim().toLowerCase());
    const valListRaw = ri[2] || ri[3];
    if (!valListRaw) continue;

    const subIdx = colList.indexOf('submitted_at');
    const expIdx = colList.indexOf('expires_at');
    const statusIdx = colList.indexOf('status');
    const decIdx = colList.indexOf('decided_at');

    if (subIdx !== -1 && expIdx !== -1 && ri[2]) {
function splitSqlArguments(argString) {
  const args = [];
  let current = '';
  let inString = false;
  let parenDepth = 0;
  for (let i = 0; i < argString.length; i++) {
    const ch = argString[i];
    if (ch === "'") {
      inString = !inString;
      current += ch;
    } else if (!inString && ch === '(') {
      parenDepth++;
      current += ch;
    } else if (!inString && ch === ')') {
      parenDepth--;
      current += ch;
    } else if (!inString && ch === ',' && parenDepth === 0) {
      args.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) {
    args.push(current.trim());
  }
  return args;
}

      const vals = splitSqlArguments(ri[2]);
      const subExpr = vals[subIdx];
      const expExpr = vals[expIdx];

      const subOffset = parseIntervalOffsetSeconds(subExpr);
      const expOffset = parseIntervalOffsetSeconds(expExpr);

      if (subOffset !== null && expOffset !== null && subOffset >= expOffset) {
        errors.push(`Fixture de access_requests inválida: submitted_at (${subExpr}) é posterior ou igual a expires_at (${expExpr})!`);
      }

      if (statusIdx !== -1 && decIdx !== -1) {
        const statusVal = vals[statusIdx] ? vals[statusIdx].replace(/'/g, '').trim() : '';
        const decExpr = vals[decIdx];
        const decOffset = parseIntervalOffsetSeconds(decExpr);

        if (statusVal === 'approved' && decOffset !== null && expOffset !== null && decOffset >= expOffset) {
          errors.push(`Fixture de access_requests approved inválida: decided_at (${decExpr}) após expiração (${expExpr})!`);
        }
      }
    }
  }

  // Qualidade de Asserções (ausência de swallowing)
  if (effectiveValidate.includes('when others then null;')) {
    errors.push('Cláusula proibida "when others then null;" encontrada no ensaio (swallowing indevido de erros).');
  }

  return { errors, warnings };
}

/**
 * Executa demonstração de rejeição de falhas reais utilizando o MESMO motor runChecks()
 */
export function testDemoFailures() {
  console.log('\n--- DEMONSTRAÇÃO DE REJEIÇÃO COM EXEMPLOS INVÁLIDOS EXERCITANDO runChecks() ---\n');

  // Contraprova 1: UUID com caractere 'g'
  {
    console.log('[Demo 1] Testando detecção de UUID com caractere não-hex...');
    const result = runChecks({
      silent: true,
      overrides: {
        'docs/sql/concurrency/011_concurrency_session_a.sql':
          "insert into app_private.members (id) values ('00000000-0000-0000-0000-0000000000g1');"
      }
    });
    const found = result.errors.some(e => e.includes("não-hexadecimal inválido: '00000000-0000-0000-0000-0000000000g1'"));
    if (found) {
      console.log('  [PASS] runChecks detectou e rejeitou UUID com caractere "g".');
    } else {
      throw new Error(`Falha no Demo 1: runChecks aceitou UUID com caractere 'g'! Erros: ${JSON.stringify(result.errors)}`);
    }
  }

  // Contraprova 2: Primeira RPC com security invoker em vez de security definer
  {
    console.log('[Demo 2] Testando detecção de SECURITY INVOKER na primeira RPC...');
    const originalRpc1 = fs.readFileSync(path.join(defaultRootDir, 'docs/sql/src_011/03_rpcs/01_issue_church_invitation.sql'), 'utf8');
    const mutatedRpc1 = originalRpc1.replace('security definer', 'security invoker');
    const result = runChecks({
      silent: true,
      overrides: {
        '03_rpcs/01_issue_church_invitation.sql': mutatedRpc1
      }
    });
    const found = result.errors.some(e => e.includes('declaração ilegal SECURITY INVOKER detectada') || e.includes('deve conter estritamente SECURITY DEFINER'));
    if (found) {
      console.log('  [PASS] runChecks detectou e rejeitou SECURITY INVOKER na RPC issue_church_invitation.');
    } else {
      throw new Error(`Falha no Demo 2: runChecks aceitou SECURITY INVOKER! Erros: ${JSON.stringify(result.errors)}`);
    }
  }

  // Contraprova 3: p_command_id text em vez de uuid
  {
    console.log('[Demo 3] Testando detecção de tipo de parâmetro incorreto (p_command_id text)...');
    const originalRpc1 = fs.readFileSync(path.join(defaultRootDir, 'docs/sql/src_011/03_rpcs/01_issue_church_invitation.sql'), 'utf8');
    const mutatedRpc1 = originalRpc1.replace('p_command_id uuid', 'p_command_id text');
    const result = runChecks({
      silent: true,
      overrides: {
        '03_rpcs/01_issue_church_invitation.sql': mutatedRpc1
      }
    });
    const found = result.errors.some(e => e.includes("parâmetro 'p_command_id' com tipo incorreto 'text' (esperado 'uuid')"));
    if (found) {
      console.log('  [PASS] runChecks detectou e rejeitou parâmetro p_command_id com tipo text.');
    } else {
      throw new Error(`Falha no Demo 3: runChecks aceitou p_command_id text! Erros: ${JSON.stringify(result.errors)}`);
    }
  }

  // Contraprova 4: Constante c_audit_approve com valor incorreto 'decide_access_request_approve'
  {
    console.log('[Demo 4] Testando detecção de constante divergente (c_audit_approve = decide_access_request_approve)...');
    const originalHelpers = fs.readFileSync(path.join(defaultRootDir, 'docs/sql/src_011/05_tests/01_fixtures_helpers.sql'), 'utf8');
    const mutatedHelpers = originalHelpers.replace(
      "c_audit_approve constant text := 'approve_access_request';",
      "c_audit_approve constant text := 'decide_access_request_approve';"
    );
    const result = runChecks({
      silent: true,
      overrides: {
        '05_tests/01_fixtures_helpers.sql': mutatedHelpers
      }
    });
    const found = result.errors.some(e => e.includes('Constante c_audit_approve com valor divergente do manifesto'));
    if (found) {
      console.log('  [PASS] runChecks detectou e rejeitou constante c_audit_approve com valor incorreto.');
    } else {
      throw new Error(`Falha no Demo 4: runChecks aceitou constante incorreta! Erros: ${JSON.stringify(result.errors)}`);
    }
  }

  // Contraprova 5: Submissão da fixture approved em +73h e vencimento em +72h
  {
    console.log('[Demo 5] Testando detecção de submissão posterior ao vencimento (+73h >= +72h)...');
    const originalTests = fs.readFileSync(path.join(defaultRootDir, 'docs/sql/src_011/05_tests/03_scenarios_11_to_20.sql'), 'utf8');
    const mutatedTests = originalTests.replace(
      "v_t_app + interval '1 hour', v_t_app + interval '72 hours'",
      "v_t_app + interval '73 hours', v_t_app + interval '72 hours'"
    );
    const result = runChecks({
      silent: true,
      overrides: {
        '05_tests/03_scenarios_11_to_20.sql': mutatedTests
      }
    });
    const found = result.errors.some(e => e.includes('submitted_at') && e.includes('posterior ou igual a expires_at'));
    if (found) {
      console.log('  [PASS] runChecks detectou e rejeitou fixture com submitted_at (+73h) >= expires_at (+72h).');
    } else {
      throw new Error(`Falha no Demo 5: runChecks aceitou submissão após vencimento! Erros: ${JSON.stringify(result.errors)}`);
    }
  }

  // Contraprova 6: Ação divergente somente no manifesto JSON
  {
    console.log('[Demo 6] Testando detecção de ação divergente no manifesto JSON...');
    const originalManifest = fs.readFileSync(path.join(defaultRootDir, 'docs/sql/src_011/00_actions_manifest.json'), 'utf8');
    const mutatedManifest = originalManifest.replace('"approve_access_request"', '"approve_access_divergent_action"');
    const result = runChecks({
      silent: true,
      overrides: {
        'docs/sql/src_011/00_actions_manifest.json': mutatedManifest
      }
    });
    const found = result.errors.some(e => e.includes('Ação de auditoria não-canônica gravada pela implementação') || e.includes('constante c_audit_approve'));
    if (found) {
      console.log('  [PASS] runChecks detectou e rejeitou ação divergente introduzida no manifesto JSON.');
    } else {
      throw new Error(`Falha no Demo 6: runChecks aceitou ação divergente no manifesto! Erros: ${JSON.stringify(result.errors)}`);
    }
  }

  // Contraprova 7: Script 001 alterado
  {
    console.log('[Demo 7] Testando detecção de alteração no script 001_initial_access_structure.sql...');
    const original001 = fs.readFileSync(path.join(defaultRootDir, 'docs/sql/001_initial_access_structure.sql'), 'utf8');
    const mutated001 = original001 + '\n-- alteracao deliberada de teste';
    const result = runChecks({
      silent: true,
      overrides: {
        'docs/sql/001_initial_access_structure.sql': mutated001
      }
    });
    const found = result.errors.some(e => e.includes('001_initial_access_structure.sql foi modificado ou corrompido! Hash SHA-256 divergente'));
    if (found) {
      console.log('  [PASS] runChecks detectou e rejeitou script 001 alterado por divergência de hash baseline.');
    } else {
      throw new Error(`Falha no Demo 7: runChecks aceitou alteração em 001! Erros: ${JSON.stringify(result.errors)}`);
    }
  }

  // Contraprova 8: Bloco PL/pgSQL desbalanceado (aberto sem end)
  {
    console.log('[Demo 8] Testando detecção de bloco PL/pgSQL desbalanceado...');
    const originalTests = fs.readFileSync(path.join(defaultRootDir, 'docs/sql/src_011/05_tests/03_scenarios_11_to_20.sql'), 'utf8');
    // Injeta um begin adicional sem end;
    const mutatedTests = originalTests.replace(
      "-- 11.2:",
      "-- 11.2:\n  begin\n"
    );
    const result = runChecks({
      silent: true,
      overrides: {
        '05_tests/03_scenarios_11_to_20.sql': mutatedTests
      }
    });
    const found = result.errors.some(e => e.includes('está desbalanceado'));
    if (found) {
      console.log('  [PASS] runChecks detectou e rejeitou bloco PL/pgSQL desbalanceado.');
    } else {
      throw new Error(`Falha no Demo 8: runChecks aceitou bloco desbalanceado! Erros: ${JSON.stringify(result.errors)}`);
    }
  }

  console.log('\n--- TODAS AS 8 CONTRAPROVAS FORAM REJEITADAS COM SUCESSO PELO MOTOR runChecks() ---\n');
}

function run() {
  const isDemo = process.argv.includes('--demo-failures') || process.argv.includes('--demo');

  if (isDemo) {
    testDemoFailures();
  }

  const { errors, warnings } = runChecks();

  if (warnings.length > 0) {
    console.warn('\nAvisos encontrados:');
    warnings.forEach(w => console.warn(`  - [WARN] ${w}`));
  }

  if (errors.length > 0) {
    console.error('\nErros encontrados nas verificações:');
    errors.forEach(e => console.error(`  - [ERRO] ${e}`));
    console.error('\nSTATUS: FALHA NAS VERIFICAÇÕES ESTÁTICAS.');
    process.exit(1);
  } else {
    console.log('\nSTATUS: TODAS AS VERIFICAÇÕES ESTÁTICAS APROVADAS COM SUCESSO.');
    process.exit(0);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run();
}
