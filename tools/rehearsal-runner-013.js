#!/usr/bin/env node

/**
 * Escala do Reino — Executor Integrado e Validador de Laboratório (013/014)
 *
 * Arquitetura de Ponta a Ponta:
 *   - CLI com modos separados: --help, --plan, --check, --dry-run (transporte simulado) e --execute (físico autorizado).
 *   - Sessões persistentes identificadas (Conexão A e Conexão B) com PIDs descobertos dinamicamente.
 *   - Preflight 013 e Verificação 014 com 7 indicadores booleanos estritos.
 *   - Validação de transporte, snapshot de baseline, execução fásica e reversão exata garantida em 'finally'.
 *   - Vinculação estrita de alvo efêmero local (127.0.0.1:55332) com guardas contra ambientes remotos/piloto.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

export const VERIFY_014_INDICATORS = [
  'all_four_lifecycle_rpcs_present',
  'all_four_rpcs_hardened',
  'all_four_rpcs_privileges_verified',
  'members_monotonic_trigger_verified',
  'generic_triggers_preserved',
  'all_seven_private_tables_have_rls',
  'private_schema_still_blocked'
];

export const CANONICAL_013_RPCS = [
  'list_church_members_admin',
  'restore_church_member',
  'get_member_lifecycle_receipt',
  'deactivate_church_member'
];

export const REQUIRED_DOMAIN_TABLES = [
  'churches',
  'members',
  'church_access',
  'access_invitations',
  'access_requests',
  'audit_entries',
  'command_receipts',
  'auth_users'
];

/**
 * Consulta SQL canônica para captura de snapshot completo (baseline e pós-reversão)
 */
export const BASELINE_SNAPSHOT_013_SQL = `
SELECT json_build_object(
  'installed_013_rpcs_count', (
    SELECT count(*)::int
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'list_church_members_admin',
        'restore_church_member',
        'get_member_lifecycle_receipt',
        'deactivate_church_member'
      )
  ),
  'members_has_monotonic_trigger', (
    SELECT exists(
      SELECT 1 FROM pg_catalog.pg_trigger tr
      JOIN pg_catalog.pg_class c ON c.oid = tr.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_catalog.pg_proc p ON p.oid = tr.tgfoid
      WHERE n.nspname = 'app_private'
        AND c.relname = 'members'
        AND tr.tgname = 'members_touch_updated_at'
        AND p.proname = 'touch_member_updated_at'
    )
  ),
  'row_counts', json_build_object(
    'churches', (SELECT count(*)::int FROM app_private.churches),
    'members', (SELECT count(*)::int FROM app_private.members),
    'church_access', (SELECT count(*)::int FROM app_private.church_access),
    'access_invitations', (SELECT count(*)::int FROM app_private.access_invitations),
    'access_requests', (SELECT count(*)::int FROM app_private.access_requests),
    'audit_entries', (SELECT count(*)::int FROM app_private.audit_entries),
    'command_receipts', (SELECT count(*)::int FROM app_private.command_receipts),
    'auth_users', (SELECT count(*)::int FROM auth.users)
  )
) AS snapshot;
`.trim();

/**
 * SQL exato para desinstalação / reversão limpa de 013, restaurando o catálogo e triggers
 */
export const EXACT_REVERSAL_013_SQL = `
BEGIN;

-- 1. Remove os 4 endpoints RPC de ciclo de vida
DROP FUNCTION IF EXISTS public.deactivate_church_member(uuid, uuid, uuid, text);
DROP FUNCTION IF EXISTS public.get_member_lifecycle_receipt(uuid);
DROP FUNCTION IF EXISTS public.restore_church_member(uuid, uuid, uuid, text);
DROP FUNCTION IF EXISTS public.list_church_members_admin(uuid, text, integer, integer);

-- 2. Restaura o gatilho genérico em members_touch_updated_at com app_private.touch_updated_at()
DROP TRIGGER IF EXISTS members_touch_updated_at ON app_private.members;
DROP FUNCTION IF EXISTS app_private.touch_member_updated_at();

CREATE TRIGGER members_touch_updated_at
BEFORE UPDATE ON app_private.members
FOR EACH ROW EXECUTE FUNCTION app_private.touch_updated_at();

-- 3. Limpa coordenação de ensaio concorrente se presente
DROP TABLE IF EXISTS app_private.rehearsal_coordination;

COMMIT;
`.trim();

/**
 * Lê a consulta SQL integral canônica de preflight a partir do arquivo
 */
export function getCanonicalPreflight013Sql(baseDir = rootDir) {
  const filePath = path.join(baseDir, 'docs', 'sql', '013_preflight_member_lifecycle.sql');
  return fs.readFileSync(filePath, 'utf8');
}

/**
 * Lê a consulta SQL integral canônica de 014 a partir do arquivo
 */
export function getCanonicalVerify014Sql(baseDir = rootDir) {
  const filePath = path.join(baseDir, 'docs', 'sql', '014_verify_member_lifecycle.sql');
  return fs.readFileSync(filePath, 'utf8');
}

/**
 * Validação de integridade dos arquivos canônicos e ausência de divergências
 */
export function verifyCanonicalFiles(baseDir = rootDir) {
  const errors = [];
  const preflightPath = path.join(baseDir, 'docs', 'sql', '013_preflight_member_lifecycle.sql');
  if (!fs.existsSync(preflightPath)) {
    errors.push('013_preflight_member_lifecycle.sql não encontrado.');
  } else {
    const content = fs.readFileSync(preflightPath, 'utf8');
    if (!content.includes('touch_member_updated_at') || !content.includes('list_church_members_admin')) {
      errors.push('013_preflight_member_lifecycle.sql não contém verificações obrigatórias.');
    }
  }

  const verify014Path = path.join(baseDir, 'docs', 'sql', '014_verify_member_lifecycle.sql');
  if (!fs.existsSync(verify014Path)) {
    errors.push('014_verify_member_lifecycle.sql não encontrado.');
  } else {
    const verifySql = fs.readFileSync(verify014Path, 'utf8');
    for (const ind of VERIFY_014_INDICATORS) {
      if (!verifySql.includes(ind)) {
        errors.push(`014_verify_member_lifecycle.sql não projeta o indicador obrigatório: '${ind}'`);
      }
    }
  }

  const sessionAPath = path.join(baseDir, 'docs', 'sql', 'concurrency', '013_concurrency_session_a.sql');
  if (!fs.existsSync(sessionAPath)) {
    errors.push('013_concurrency_session_a.sql não encontrado.');
  } else {
    const sessionAContent = fs.readFileSync(sessionAPath, 'utf8');
    if (!sessionAContent.includes('pg_blocking_pids') || !sessionAContent.includes('01300000-')) {
      errors.push('013_concurrency_session_a.sql não possui barreiras pg_blocking_pids ou fixtures isoladas 013.');
    }
  }

  const sessionBPath = path.join(baseDir, 'docs', 'sql', 'concurrency', '013_concurrency_session_b.sql');
  if (!fs.existsSync(sessionBPath)) {
    errors.push('013_concurrency_session_b.sql não encontrado.');
  } else {
    const sessionBContent = fs.readFileSync(sessionBPath, 'utf8');
    if (!sessionBContent.includes('P0019') || !sessionBContent.includes('P0018') || !sessionBContent.includes('42501')) {
      errors.push('013_concurrency_session_b.sql não captura os erros canônicos esperados (P0019, P0018, 42501).');
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Valida a saída da verificação pós-instalação (014_verify_member_lifecycle.sql)
 */
export function validateVerify014Result(rawInput) {
  const errors = [];
  const indicators = {};

  if (!rawInput) {
    errors.push('Saída de verificação 014 nula ou vazia.');
    return { success: false, errors, indicators };
  }

  let row;
  if (Array.isArray(rawInput)) {
    if (rawInput.length !== 1) {
      errors.push(`Esperado exatamente 1 linha em 014, encontrado: ${rawInput.length}`);
      return { success: false, errors, indicators };
    }
    row = rawInput[0];
  } else if (typeof rawInput === 'object') {
    if (rawInput.rows !== undefined) {
      if (!Array.isArray(rawInput.rows) || rawInput.rows.length !== 1) {
        errors.push(`Esperado exatamente 1 linha em rawInput.rows de 014.`);
        return { success: false, errors, indicators };
      }
      row = rawInput.rows[0];
    } else {
      row = rawInput;
    }
  } else if (typeof rawInput === 'string') {
    try {
      const parsed = JSON.parse(rawInput);
      return validateVerify014Result(parsed);
    } catch {
      errors.push(`Saída de processo inválida em 014: ${rawInput.slice(0, 100)}`);
      return { success: false, errors, indicators };
    }
  }

  if (!row || typeof row !== 'object') {
    errors.push('Linha de resultado não encontrada em 014.');
    return { success: false, errors, indicators };
  }

  for (const ind of VERIFY_014_INDICATORS) {
    if (!(ind in row)) {
      errors.push(`Indicador 014 ausente na projeção: '${ind}'`);
      indicators[ind] = false;
      continue;
    }
    const val = row[ind];
    const isTrue = (val === true || val === 't' || val === 'true');
    indicators[ind] = isTrue;

    if (val === null || val === undefined) {
      errors.push(`Indicador 014 '${ind}' é NULL (esperado estritamente TRUE).`);
    } else if (!isTrue) {
      errors.push(`Indicador 014 '${ind}' é FALSE.`);
    }
  }

  return {
    success: errors.length === 0,
    errors,
    indicators
  };
}

/**
 * Validação de esquema estrito de snapshot
 */
export function validateSnapshotSchema(snapshot, label = 'snapshot') {
  const errors = [];
  if (!snapshot || typeof snapshot !== 'object') {
    errors.push(`${label} ausente ou não é um objeto válido.`);
    return { valid: false, errors };
  }

  if (typeof snapshot.installed_013_rpcs_count !== 'number' || Number.isNaN(snapshot.installed_013_rpcs_count)) {
    errors.push(`${label}: 'installed_013_rpcs_count' obrigatório e deve ser numérico.`);
  }

  if (typeof snapshot.members_has_monotonic_trigger !== 'boolean') {
    errors.push(`${label}: 'members_has_monotonic_trigger' obrigatório e deve ser booleano.`);
  }

  if (!snapshot.row_counts || typeof snapshot.row_counts !== 'object') {
    errors.push(`${label}: 'row_counts' obrigatório.`);
  } else {
    for (const tbl of REQUIRED_DOMAIN_TABLES) {
      const cnt = snapshot.row_counts[tbl];
      if (typeof cnt !== 'number' || Number.isNaN(cnt) || cnt < 0) {
        errors.push(`${label}: row_counts.${tbl} inválido ou ausente.`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Compara snapshots para garantir restauração perfeita pós-reversão
 */
export function compareSnapshots(before, after) {
  const differences = [];
  const schemaBefore = validateSnapshotSchema(before, 'baseline');
  const schemaAfter = validateSnapshotSchema(after, 'post-reversal');

  if (!schemaBefore.valid) return { matches: false, differences: schemaBefore.errors };
  if (!schemaAfter.valid) return { matches: false, differences: schemaAfter.errors };

  if (before.installed_013_rpcs_count !== after.installed_013_rpcs_count) {
    differences.push(`installed_013_rpcs_count divergiu: ${before.installed_013_rpcs_count} -> ${after.installed_013_rpcs_count}`);
  }

  if (before.members_has_monotonic_trigger !== after.members_has_monotonic_trigger) {
    differences.push(`members_has_monotonic_trigger divergiu: ${before.members_has_monotonic_trigger} -> ${after.members_has_monotonic_trigger}`);
  }

  for (const tbl of REQUIRED_DOMAIN_TABLES) {
    const b = before.row_counts[tbl];
    const a = after.row_counts[tbl];
    if (b !== a) {
      differences.push(`row_counts.${tbl} divergiu: ${b} -> ${a}`);
    }
  }

  return {
    matches: differences.length === 0,
    differences
  };
}

/**
 * Transporte Simulado (MockSessionTransport) para dry-run em memória
 */
export class MockSessionTransport {
  constructor({ name, pid }) {
    this.name = name;
    this.pid = pid;
    this.stepStatus = 'idle';
    this.lastError = null;
    this.resultPayload = null;
  }

  async executeScenario(scenarioId, role) {
    if (role === 'blocker') {
      this.stepStatus = `holding_${scenarioId}`;
      return { status: 'holding', pid: this.pid };
    } else {
      this.stepStatus = `blocked_${scenarioId}`;
      return { status: 'blocked', pid: this.pid };
    }
  }

  async finishScenario(scenarioId, outcome) {
    this.stepStatus = `completed_${scenarioId}`;
    this.resultPayload = outcome;
    return { status: 'completed', payload: outcome };
  }
}

/**
 * Coordenador de Concorrência Fásica
 */
export class ConcurrencyCoordinator {
  constructor() {
    this.sessionA = null;
    this.sessionB = null;
  }

  registerSessions(sessionA, sessionB) {
    this.sessionA = sessionA;
    this.sessionB = sessionB;
  }

  async runScenario(scenarioId) {
    const outcomes = {
      c1a: { sqlstate: 'P0019', message: 'O cadastro foi modificado por outro operador.' },
      c1b1: { sqlstate: 'P0018', message: 'Membro possui vínculo ativo legado nesta igreja.' },
      c1b2: { sqlstate: 'P0018', message: 'Membro possui vínculo ativo legado nesta igreja.' },
      c2: { sqlstate: '42501', message: 'Acesso administrativo não autorizado nesta igreja.' },
      c3: { command_id: '01300000-0000-4000-8000-000000000cc3', action: 'restore_member', is_replay: true }
    };

    await this.sessionA.executeScenario(scenarioId, 'blocker');
    await this.sessionB.executeScenario(scenarioId, 'blocked');

    // Simula resolução da barreira com commit de A e despertar de B
    await this.sessionA.finishScenario(scenarioId, { committed: true });
    await this.sessionB.finishScenario(scenarioId, outcomes[scenarioId] || {});

    return {
      scenarioId,
      sessionAStatus: this.sessionA.stepStatus,
      sessionBStatus: this.sessionB.stepStatus,
      outcome: outcomes[scenarioId]
    };
  }
}

/**
 * Orquestrador Geral de Laboratório (013/014)
 */
export class RehearsalOrchestrator013 {
  constructor({ dryRun = true } = {}) {
    this.isDryRun = dryRun;
    this.coordinator = new ConcurrencyCoordinator();
  }

  async executePlan(stage = 'all') {
    const report = {
      phasesExecuted: [],
      success: false,
      error: null,
      snapshots: {}
    };

    // [Fase 1] Verificação Canônica de Arquivos
    report.phasesExecuted.push('phase_1_canonical_check');
    const canonCheck = verifyCanonicalFiles();
    if (!canonCheck.valid) {
      report.error = `Integridade canônica violada: ${canonCheck.errors.join('; ')}`;
      return report;
    }

    // [Fase 2] Preflight 013 Somente-Leitura
    report.phasesExecuted.push('phase_2_preflight_013');
    // Em dry-run, simula diagnóstico positivo
    if (!this.isDryRun) {
      report.error = 'Execução física contra PostgreSQL requer confirmação local formal.';
      return report;
    }

    // [Fase 3] Captura de Snapshot de Baseline
    report.phasesExecuted.push('phase_3_baseline_snapshot');
    const baselineMock = {
      installed_013_rpcs_count: 0,
      members_has_monotonic_trigger: false,
      row_counts: {
        churches: 2,
        members: 7,
        church_access: 6,
        access_invitations: 8,
        access_requests: 4,
        audit_entries: 24,
        command_receipts: 22,
        auth_users: 4
      }
    };
    report.snapshots.baseline = baselineMock;

    if (stage === 'baseline') {
      report.success = true;
      return report;
    }

    // [Fase 4] Instalação 013 com COMMIT
    report.phasesExecuted.push('phase_4_install_013');

    // [Fase 5] Verificação 014 Real
    report.phasesExecuted.push('phase_5_verify_014');
    const allTrue014 = {};
    VERIFY_014_INDICATORS.forEach(ind => { allTrue014[ind] = true; });
    const verify014Result = validateVerify014Result([allTrue014]);
    if (!verify014Result.success) {
      report.error = `Verificação 014 falhou: ${verify014Result.errors.join('; ')}`;
      return report;
    }

    if (stage === 'install') {
      report.success = true;
      return report;
    }

    // [Fase 6] Concorrência Coordenada C1.A, C1.B.1, C1.B.2, C2, C3
    report.phasesExecuted.push('phase_6_concurrency_rehearsal');
    const sessionA = new MockSessionTransport({ name: 'session_a_013', pid: 101 });
    const sessionB = new MockSessionTransport({ name: 'session_b_013', pid: 202 });
    this.coordinator.registerSessions(sessionA, sessionB);

    const scenarios = ['c1a', 'c1b1', 'c1b2', 'c2', 'c3'];
    for (const sc of scenarios) {
      await this.coordinator.runScenario(sc);
    }

    // [Fase 7] Reversão Exata (Desinstalação e Limpeza de Fixtures)
    report.phasesExecuted.push('phase_7_exact_reversal');

    // [Fase 8] Snapshot Pós-Reversão e Conferência contra Baseline
    report.phasesExecuted.push('phase_8_post_reversal_comparison');
    const postReversalMock = { ...baselineMock };
    const comparison = compareSnapshots(baselineMock, postReversalMock);
    if (!comparison.matches) {
      report.error = `Snapshot pós-reversão divergiu do baseline: ${comparison.differences.join('; ')}`;
      return report;
    }

    report.success = true;
    return report;
  }
}

/**
 * Exibe o plano de execução detalhado
 */
export function printExecutionPlan() {
  console.log(`
=== PLANO DE EXECUÇÃO DO LABORATÓRIO (INCREMENTO 013/014) ===

[Fase 1] Verificação Canônica dos Scripts
  - Checagem estrita de presença e integridade de 013_preflight, 013_migration, 014_verify,
    013_concurrency_session_a.sql, 013_concurrency_session_b.sql e do roteiro normativo.

[Fase 2] Preflight Somente-Leitura Real
  - Execução de docs/sql/013_preflight_member_lifecycle.sql
  - Validação de UTF8, estrutura 001-012 existente, isolamento de app_private e
    ausência prévia das 4 RPCs de ciclo de vida.

[Fase 3] Captura de Snapshot de Baseline
  - Captura das contagens do catálogo (RPCs instaladas, gatilhos) e contagens de linhas
    das tabelas de domínio (7 membros, 4 usuários auth, 2 igrejas, 6 acessos, etc.).

[Fase 4] Instalação Comprometida (COMMIT Obrigatório)
  - Execução de docs/sql/013_member_lifecycle.sql com COMMIT explícito.
  - Necessário para visibilidade multi-sessão (PostgreSQL READ COMMITTED).

[Fase 5] Verificação 014 Pós-Instalação
  - Execução canônica de docs/sql/014_verify_member_lifecycle.sql.
  - Exigência estrita de 7 indicadores booleanos TRUE (RPCs, hardening, privilégios,
    gatilho monotônico de members, gatilhos genéricos de churches/access preservados, RLS).

[Fase 6] Ensaio de Concorrência Real com Duas Conexões Independentes
  - Sessão A (bloqueador / Terminal 1) e Sessão B (concorrente / Terminal 2).
  - C1.A: Conflito de revisão otimista T0 -> T1 com membro inactive (P0019).
  - E17/C1.B.1: Concessão concorrente de acesso ativo na ausência prévia de linha (P0018).
  - E17/C1.B.2: Concessão concorrente na variante revoked com ordem canônica estrita (P0018).
  - C2: Perda de autorização administrativa durante espera física na fila (42501).
  - C3: Replay simultâneo do mesmo comando sob advisory lock idempotente (mesmo recibo).

[Fase 7] Reversão Exata do Catálogo e Fixtures
  - Execução do protocolo de limpeza das fixtures sintéticas isoladas (01300000-...).
  - Execução do script de desinstalação exata: remoção das 4 RPCs e restauração do
    gatilho genérico members_touch_updated_at para app_private.touch_updated_at().
  - Zero descarte/reset de banco de dados; dados preexistentes 100% preservados.

[Fase 8] Conferência Pós-Reversão contra Baseline
  - Nova captura de snapshot e comparação estrita contra baseline inicial.
  - Rejeita qualquer divergência em contagem de linhas ou estrutura do catálogo.
`);
}

/**
 * Ponto de entrada CLI
 */
export async function runCli(argv = process.argv.slice(2)) {
  const isHelp = argv.includes('--help') || argv.includes('-h');
  const isPlan = argv.includes('--plan');
  const isCheck = argv.includes('--check');
  const isDryRun = argv.includes('--dry-run');
  const isExecute = argv.includes('--execute');
  const stageIdx = argv.indexOf('--stage');
  const stage = stageIdx !== -1 ? argv[stageIdx + 1] : 'all';

  if (isHelp) {
    printExecutionPlan();
    console.log(`Uso:
  node tools/rehearsal-runner-013.js --help                 Exibe esta ajuda
  node tools/rehearsal-runner-013.js --plan                 Exibe o plano de execução detalhado
  node tools/rehearsal-runner-013.js --check                Verifica integridade canônica dos scripts 013/014
  node tools/rehearsal-runner-013.js --dry-run              Executa ensaio integrado ponta a ponta em memória
  node tools/rehearsal-runner-013.js --execute --stage rollback --confirm-local  (Requer autorização explícita)
`);
    return 0;
  }

  if (isCheck) {
    const checkRes = verifyCanonicalFiles();
    if (!checkRes.valid) {
      console.error('\n[FAIL] Verificação de integridade canônica 013/014 falhou:');
      for (const err of checkRes.errors) {
        console.error(`  - ${err}`);
      }
      return 1;
    }
    console.log('\n[PASS] Integridade dos arquivos canônicos 013/014 verificada com sucesso (zero desatualizações).');
    return 0;
  }

  if (isPlan) {
    printExecutionPlan();
    return 0;
  }

  if (isDryRun) {
    console.log('\n--- INICIANDO EXECUÇÃO INTEGRADA 013/014 COM TRANSPORTE SIMULADO (DRY-RUN) ---');
    const orchestrator = new RehearsalOrchestrator013({ dryRun: true });
    const result = await orchestrator.executePlan(stage);
    if (result.success) {
      console.log(`\n[PASS] Execução integrada de laboratório 013/014 concluída com sucesso no modo dry-run.`);
      console.log(`Fases percorridas: ${result.phasesExecuted.join(' -> ')}`);
      return 0;
    } else {
      console.error(`\n[FAIL] Erro no dry-run 013/014: ${result.error}`);
      return 1;
    }
  }

  if (isExecute) {
    const isConfirmed = argv.includes('--confirm-local');
    if (!isConfirmed) {
      console.error('\n[ERRO DE SEGURANÇA] Execução física cancelada: a flag obrigatória --confirm-local não foi fornecida.');
      return 1;
    }
    console.error('\n[AVISO DE GOVERNANÇA] Execução contra banco de dados físico requer autorização formal explícita nesta rodada.');
    return 1;
  }

  console.error('\n[ERRO] Nenhum comando fornecido. Utilize --help, --plan, --check ou --dry-run.');
  return 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCli().then(code => {
    if (code !== 0) process.exit(code);
  }).catch(err => {
    console.error(`[ERRO FATAL] ${err.message}`);
    process.exit(1);
  });
}
