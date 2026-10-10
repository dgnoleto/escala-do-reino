#!/usr/bin/env node

/**
 * Escala do Reino — Gerador e Sincronizador de Artefatos SQL (Incremento 011/012)
 *
 * Constrói de forma determinística os scripts autocontidos:
 *   1. docs/sql/011_invitations_and_requests.sql (instalação permanente: BEGIN / COMMIT)
 *   2. docs/sql/011_validate_invitations.sql     (ensaio transacional: BEGIN / ROLLBACK)
 *
 * Ambos utilizam exatamente as mesmas fontes canônicas em docs/sql/src_011/.
 *
 * Uso:
 *   node tools/generate-sql-011.js         (gera/atualiza os arquivos)
 *   node tools/generate-sql-011.js --check (modo de verificação estrita: sai 0 se sincronizado, 1 se divergente)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const SRC_DIR = path.join(rootDir, 'docs', 'sql', 'src_011');
const TARGET_INSTALL = path.join(rootDir, 'docs', 'sql', '011_invitations_and_requests.sql');
const TARGET_VALIDATE = path.join(rootDir, 'docs', 'sql', '011_validate_invitations.sql');

function getFileContent(filePath, srcDir, overrides) {
  const rel = path.relative(srcDir, filePath).replace(/\\/g, '/');
  if (overrides[rel] !== undefined) {
    return overrides[rel].replace(/\r\n/g, '\n').trim();
  }
  if (overrides[filePath] !== undefined) {
    return overrides[filePath].replace(/\r\n/g, '\n').trim();
  }
  const content = fs.readFileSync(filePath, 'utf8');
  return content.replace(/\r\n/g, '\n').trim();
}

export function generateArtifacts(options = {}) {
  const srcDir = options.srcDir || SRC_DIR;
  const overrides = options.overrides || {};

  const preflightGuard = getFileContent(path.join(srcDir, '01_preflight_guard.sql'), srcDir, overrides);
  const evolveReceipts = getFileContent(path.join(srcDir, '02_evolve_receipts.sql'), srcDir, overrides);

  const rpcFiles = [
    '01_issue_church_invitation.sql',
    '02_get_invitation_details.sql',
    '03_redeem_invitation_confirm_name.sql',
    '04_redeem_invitation_propose_name.sql',
    '05_get_my_access_request.sql',
    '06_list_church_invitations.sql',
    '07_list_church_access_requests.sql',
    '08_decide_access_request.sql',
    '09_get_invitation_command_receipt.sql'
  ];

  const rpcsContent = rpcFiles.map(file => {
    return getFileContent(path.join(srcDir, '03_rpcs', file), srcDir, overrides);
  }).join('\n\n');

  const grantsContent = getFileContent(path.join(srcDir, '04_grants_and_security.sql'), srcDir, overrides);

  const testFiles = [
    '01_fixtures_helpers.sql',
    '02_scenarios_01_to_10.sql',
    '03_scenarios_11_to_20.sql',
    '04_scenarios_21_to_25.sql'
  ];

  const testsContent = testFiles.map(file => {
    return getFileContent(path.join(srcDir, '05_tests', file), srcDir, overrides);
  }).join('\n\n');

  // Cabeçalho de instalação permanente (BEGIN/COMMIT)
  const installHeader = `-- ============================================================================
-- ARQUIVO GERADO AUTOMATICAMENTE A PARTIR DE docs/sql/src_011/
-- NÃO EDITE ESTE ARQUIVO DIRETAMENTE. EDITE OS ARQUIVOS FONTE EM src_011/
-- E REEXECUTE: node tools/generate-sql-011.js
-- ============================================================================
-- Escala do Reino: convites de acesso, aprovação de nome e ciclo de recibos idempotente.
-- Instalação transacional das 9 RPCs e evolução compatível de app_private.command_receipts.
-- app_private continua fora da Data API e sem acesso direto para clientes.
-- Apenas executar permanentemente após aprovação formal do responsável e ensaio com PASS.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';`;

  const installSql = `${installHeader}

${preflightGuard}

${evolveReceipts}

${rpcsContent}

${grantsContent}

commit;
`;

  // Cabeçalho de ensaio de laboratório (BEGIN/ROLLBACK)
  const validateHeader = `-- ============================================================================
-- ARQUIVO GERADO AUTOMATICAMENTE A PARTIR DE docs/sql/src_011/
-- NÃO EDITE ESTE ARQUIVO DIRETAMENTE. EDITE OS ARQUIVOS FONTE EM src_011/
-- E REEXECUTE: node tools/generate-sql-011.js
-- ============================================================================
-- Escala do Reino: ensaio transacional de validação do incremento de convites e propostas de nome.
-- Executa em transação protegida e termina estritamente com ROLLBACK.
-- Nenhuma tabela, função, permissão ou dado de teste é persistido.
--
-- ATENÇÃO — AMBIENTE DE EXECUÇÃO E DEPENDÊNCIAS DE FIXTURES:
-- Este script foi projetado para execução estrita em ambiente isolado dedicado para testes
-- (PostgreSQL local ou ambiente efêmero de staging/CI) com esquemas auth e app_private disponíveis.
-- O ensaio cria registros estritamente sintéticos e não utiliza identificadores ou e-mails do piloto.
-- NÃO COPIE OU EXECUTE ESTE ENSAIO NO AMBIENTE DE PILOTO/PRODUÇÃO sem expressa autorização.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';`;

  const validateSql = `${validateHeader}

${preflightGuard}

${evolveReceipts}

${rpcsContent}

${grantsContent}

${testsContent}

-- Finaliza estritamente com ROLLBACK. Nenhum dado ou objeto de teste é persistido.
rollback;
`;

  return { installSql, validateSql };
}

function run() {
  const isCheckMode = process.argv.includes('--check') || process.argv.includes('--verify');
  const { installSql, validateSql } = generateArtifacts();

  if (isCheckMode) {
    let hasError = false;

    if (!fs.existsSync(TARGET_INSTALL)) {
      console.error(`[FAIL] Arquivo ausente: ${TARGET_INSTALL}`);
      hasError = true;
    } else {
      const currentInstall = fs.readFileSync(TARGET_INSTALL, 'utf8').replace(/\r\n/g, '\n');
      if (currentInstall !== installSql) {
        console.error(`[FAIL] 011_invitations_and_requests.sql está desatualizado em relação a src_011/.`);
        hasError = true;
      }
    }

    if (!fs.existsSync(TARGET_VALIDATE)) {
      console.error(`[FAIL] Arquivo ausente: ${TARGET_VALIDATE}`);
      hasError = true;
    } else {
      const currentValidate = fs.readFileSync(TARGET_VALIDATE, 'utf8').replace(/\r\n/g, '\n');
      if (currentValidate !== validateSql) {
        console.error(`[FAIL] 011_validate_invitations.sql está desatualizado em relação a src_011/.`);
        hasError = true;
      }
    }

    if (hasError) {
      console.error('Execute "node tools/generate-sql-011.js" para atualizar os artefatos gerados.');
      process.exit(1);
    } else {
      console.log('[OK] Artefatos SQL gerados correspondem exatamente à fonte única em src_011/ (100% sincronizado).');
      process.exit(0);
    }
  } else {
    fs.writeFileSync(TARGET_INSTALL, installSql, 'utf8');
    fs.writeFileSync(TARGET_VALIDATE, validateSql, 'utf8');
    console.log('[OK] Artefatos gerados com sucesso a partir de docs/sql/src_011/:');
    console.log(`  - ${TARGET_INSTALL}`);
    console.log(`  - ${TARGET_VALIDATE}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run();
}
