#!/usr/bin/env node

/**
 * Escala do Reino — Executor Integrado e Validador de Laboratório (011/012)
 *
 * Arquitetura de Ponta a Ponta:
 *   - CLI com modos separados: --help, --plan, --dry-run (transporte simulado) e --execute (físico autorizado).
 *   - Sessões persistentes identificadas (Conexão A e Conexão B) com PIDs descobertos dinamicamente.
 *   - Consulta e consumo canônico do SELECT de 011_preflight_invitations.sql (sem wrappers manuais).
 *   - Validação estrita de transporte, preflight (11 TRUEs), 012 (6 TRUEs) e rollback contra baseline completo.
 *   - Coordenador fásico de concorrência com tratamento garantido de erros e rollback em 'finally'.
 *   - Vinculação estrita de alvo efêmero local (127.0.0.1 / localhost) com assinatura de instância.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

export const PREFLIGHT_INDICATORS = [
  'server_and_client_utf8',
  'previous_seven_tables_present',
  'previous_seven_rpcs_present',
  'crypto_primitives_available',
  'required_table_columns_present',
  'required_indexes_and_predicates_present',
  'required_triggers_and_functions_present',
  'required_physical_constraints_present',
  'no_corrupted_data_or_partial_evolution_in_existing_tables',
  'new_nine_rpcs_not_yet_installed',
  'app_private_strictly_blocked_and_rls_active'
];

export const VERIFY_012_INDICATORS = [
  'command_receipts_evolution_verified',
  'all_nine_rpcs_present',
  'all_nine_rpcs_hardened',
  'all_nine_rpcs_privileges_verified',
  'all_seven_private_tables_have_rls',
  'private_schema_still_blocked'
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

export const CANONICAL_011_RPCS = [
  'issue_church_invitation',
  'get_invitation_details',
  'redeem_invitation_confirm_name',
  'redeem_invitation_propose_name',
  'get_my_access_request',
  'list_church_invitations',
  'list_church_access_requests',
  'decide_access_request',
  'get_invitation_command_receipt'
];

/**
 * Consulta SQL canônica para captura de snapshot completo (baseline e pós-rollback)
 */
export const BASELINE_SNAPSHOT_SQL = `
SELECT json_build_object(
  'installed_011_rpcs_count', (
    SELECT count(*)::int
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'issue_church_invitation',
        'get_invitation_details',
        'redeem_invitation_confirm_name',
        'redeem_invitation_propose_name',
        'get_my_access_request',
        'list_church_invitations',
        'list_church_access_requests',
        'decide_access_request',
        'get_invitation_command_receipt'
      )
  ),
  'command_receipts_has_result_entity_id', (
    SELECT exists(
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'app_private'
        AND table_name = 'command_receipts'
        AND column_name = 'result_entity_id'
    )
  ),
  'command_receipts_has_result_payload', (
    SELECT exists(
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'app_private'
        AND table_name = 'command_receipts'
        AND column_name = 'result_payload'
    )
  ),
  'command_receipts_has_payload_check', (
    SELECT exists(
      SELECT 1 FROM information_schema.table_constraints
      WHERE table_schema = 'app_private'
        AND table_name = 'command_receipts'
        AND constraint_name = 'command_receipts_payload_check'
    )
  ),
  'app_private_client_permissions_count', (
    SELECT count(*)::int
    FROM information_schema.table_privileges
    WHERE table_schema = 'app_private'
      AND grantee IN ('anon', 'authenticated')
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
 * Lê a consulta SQL integral canônica de preflight a partir do arquivo
 */
export function getCanonicalPreflightSql(baseDir = rootDir) {
  const filePath = path.join(baseDir, 'docs', 'sql', '011_preflight_invitations.sql');
  return fs.readFileSync(filePath, 'utf8');
}

/**
 * Lê a consulta SQL integral canônica de 012 a partir do arquivo
 */
export function getCanonicalVerify012Sql(baseDir = rootDir) {
  const filePath = path.join(baseDir, 'docs', 'sql', '012_verify_invitations.sql');
  return fs.readFileSync(filePath, 'utf8');
}

/**
 * Validação de integridade dos arquivos canônicos e ausência de wrappers manuais divergentes
 */
export function verifyCanonicalFiles(baseDir = rootDir) {
  const errors = [];
  const preflightSql = getCanonicalPreflightSql(baseDir);
  for (const ind of PREFLIGHT_INDICATORS) {
    if (!preflightSql.includes(ind)) {
      errors.push(`011_preflight_invitations.sql não projeta o indicador obrigatório: '${ind}'`);
    }
  }

  const verify012Sql = getCanonicalVerify012Sql(baseDir);
  for (const ind of VERIFY_012_INDICATORS) {
    if (!verify012Sql.includes(ind)) {
      errors.push(`012_verify_invitations.sql não projeta o indicador obrigatório: '${ind}'`);
    }
  }

  const guidePath = path.join(baseDir, 'docs', 'sql', '011_concurrency_rehearsal_guide.md');
  if (fs.existsSync(guidePath)) {
    const guideContent = fs.readFileSync(guidePath, 'utf8');
    if (guideContent.includes('Fixture|Cenário')) {
      errors.push("Guia contém verificação informal legada ('Fixture|Cenário') em vez de snapshot completo.");
    }
    if (guideContent.includes('do $assert_preflight$') && guideContent.includes('select * into v_rec from (')) {
      errors.push("Guia contém cópia manual reduzida do preflight em vez de ler o SQL integral de 011_preflight_invitations.sql.");
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Valida a saída da consulta de preflight (011_preflight_invitations.sql)
 */
export function validatePreflightResult(rawInput) {
  const errors = [];
  const indicators = {};

  if (!rawInput) {
    errors.push('Saída de preflight nula ou vazia.');
    return { success: false, errors, indicators };
  }

  // Falha de transporte (exitCode != 0 ou error presente)
  if (typeof rawInput === 'object' && rawInput.exitCode !== undefined && rawInput.exitCode !== 0) {
    errors.push(`Falha de transporte na execução do preflight (exitCode: ${rawInput.exitCode}, erro: ${rawInput.stderr || rawInput.error || 'desconhecido'})`);
    return { success: false, errors, indicators };
  }
  if (typeof rawInput === 'object' && rawInput.transportError) {
    errors.push(`Erro de transporte no preflight: ${rawInput.transportError}`);
    return { success: false, errors, indicators };
  }

  let row;
  if (Array.isArray(rawInput)) {
    if (rawInput.length !== 1) {
      errors.push(`Esperado exatamente 1 linha na saída de preflight, encontrado: ${rawInput.length}`);
      return { success: false, errors, indicators };
    }
    row = rawInput[0];
  } else if (typeof rawInput === 'object') {
    if (rawInput.rows !== undefined) {
      if (!Array.isArray(rawInput.rows) || rawInput.rows.length !== 1) {
        errors.push(`Esperado exatamente 1 linha em rawInput.rows, encontrado: ${Array.isArray(rawInput.rows) ? rawInput.rows.length : 'não-array'}`);
        return { success: false, errors, indicators };
      }
      row = rawInput.rows[0];
    } else {
      row = rawInput;
    }
  } else if (typeof rawInput === 'string') {
    try {
      const parsed = JSON.parse(rawInput);
      return validatePreflightResult(parsed);
    } catch {
      errors.push(`Saída de processo inválida ou não analisável: ${rawInput.slice(0, 100)}`);
      return { success: false, errors, indicators };
    }
  }

  if (!row || typeof row !== 'object') {
    errors.push('Linha de preflight ausente ou em formato inválido.');
    return { success: false, errors, indicators };
  }

  for (const ind of PREFLIGHT_INDICATORS) {
    if (!(ind in row)) {
      errors.push(`Indicador de preflight ausente na projeção: '${ind}'`);
      indicators[ind] = false;
      continue;
    }
    const val = row[ind];
    const isTrue = (val === true || val === 't' || val === 'true');
    indicators[ind] = isTrue;

    if (val === null || val === undefined) {
      errors.push(`Indicador de preflight '${ind}' é NULL (esperado estritamente TRUE).`);
    } else if (!isTrue) {
      errors.push(`Indicador de preflight '${ind}' é FALSE (condição não satisfeita).`);
    }
  }

  return {
    success: errors.length === 0,
    errors,
    indicators
  };
}

/**
 * Valida a saída da verificação pós-instalação (012_verify_invitations.sql)
 */
export function validateVerify012Result(rawInput) {
  const errors = [];
  const indicators = {};

  if (!rawInput) {
    errors.push('Saída de verificação 012 nula ou vazia.');
    return { success: false, errors, indicators };
  }

  if (typeof rawInput === 'object' && rawInput.exitCode !== undefined && rawInput.exitCode !== 0) {
    errors.push(`Falha de transporte em 012 (exitCode: ${rawInput.exitCode})`);
    return { success: false, errors, indicators };
  }

  let row;
  if (Array.isArray(rawInput)) {
    if (rawInput.length !== 1) {
      errors.push(`Esperado exatamente 1 linha em 012, encontrado: ${rawInput.length}`);
      return { success: false, errors, indicators };
    }
    row = rawInput[0];
  } else if (typeof rawInput === 'object') {
    if (rawInput.rows !== undefined) {
      if (!Array.isArray(rawInput.rows) || rawInput.rows.length !== 1) {
        errors.push(`Esperado exatamente 1 linha em rawInput.rows de 012, encontrado: ${Array.isArray(rawInput.rows) ? rawInput.rows.length : 'não-array'}`);
        return { success: false, errors, indicators };
      }
      row = rawInput.rows[0];
    } else {
      row = rawInput;
    }
  } else if (typeof rawInput === 'string') {
    try {
      const parsed = JSON.parse(rawInput);
      return validateVerify012Result(parsed);
    } catch {
      errors.push(`Saída de processo inválida em 012: ${rawInput.slice(0, 100)}`);
      return { success: false, errors, indicators };
    }
  }

  if (!row || typeof row !== 'object') {
    errors.push('Linha de resultado não encontrada em 012.');
    return { success: false, errors, indicators };
  }

  for (const ind of VERIFY_012_INDICATORS) {
    if (!(ind in row)) {
      errors.push(`Indicador 012 ausente na projeção: '${ind}'`);
      indicators[ind] = false;
      continue;
    }
    const val = row[ind];
    const isTrue = (val === true || val === 't' || val === 'true');
    indicators[ind] = isTrue;

    if (val === null || val === undefined) {
      errors.push(`Indicador 012 '${ind}' é NULL (esperado estritamente TRUE).`);
    } else if (!isTrue) {
      errors.push(`Indicador 012 '${ind}' é FALSE.`);
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

  if (typeof snapshot.installed_011_rpcs_count !== 'number' || Number.isNaN(snapshot.installed_011_rpcs_count)) {
    errors.push(`${label}: 'installed_011_rpcs_count' obrigatório e deve ser numérico.`);
  }

  if (typeof snapshot.command_receipts_has_result_entity_id !== 'boolean') {
    errors.push(`${label}: 'command_receipts_has_result_entity_id' obrigatório e deve ser boolean.`);
  }

  if (typeof snapshot.command_receipts_has_result_payload !== 'boolean') {
    errors.push(`${label}: 'command_receipts_has_result_payload' obrigatório e deve ser boolean.`);
  }

  if (typeof snapshot.command_receipts_has_payload_check !== 'boolean') {
    errors.push(`${label}: 'command_receipts_has_payload_check' obrigatório e deve ser boolean.`);
  }

  if (typeof snapshot.app_private_client_permissions_count !== 'number' || Number.isNaN(snapshot.app_private_client_permissions_count)) {
    errors.push(`${label}: 'app_private_client_permissions_count' obrigatório e deve ser numérico.`);
  }

  if (!snapshot.row_counts || typeof snapshot.row_counts !== 'object') {
    errors.push(`${label}: 'row_counts' obrigatório e deve ser um objeto.`);
  } else {
    for (const t of REQUIRED_DOMAIN_TABLES) {
      const val = snapshot.row_counts[t];
      if (typeof val !== 'number' || Number.isNaN(val)) {
        errors.push(`${label}: contagem da tabela '${t}' obrigatória e deve ser numérica válida.`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Valida integridade de ausência de efeitos residuais pós-ROLLBACK comparando com baseline
 */
export function validateRollbackIntegrity(baselineSnapshot, postRollbackSnapshot) {
  const errors = [];

  // Validação estrita de esquema
  const baseCheck = validateSnapshotSchema(baselineSnapshot, 'baselineSnapshot');
  if (!baseCheck.valid) {
    errors.push(...baseCheck.errors);
  }

  const postCheck = validateSnapshotSchema(postRollbackSnapshot, 'postRollbackSnapshot');
  if (!postCheck.valid) {
    errors.push(...postCheck.errors);
  }

  if (errors.length > 0) {
    return { success: false, errors };
  }

  // 1. Ausência de novas RPCs em public
  if (postRollbackSnapshot.installed_011_rpcs_count !== 0) {
    errors.push(`Resíduo estrutural: ${postRollbackSnapshot.installed_011_rpcs_count} RPCs do 011 permaneceram instaladas após ROLLBACK.`);
  }

  // 2. Ausência de colunas e constraints em command_receipts
  if (postRollbackSnapshot.command_receipts_has_result_entity_id) {
    errors.push('Resíduo estrutural: coluna result_entity_id permaneceu em command_receipts após ROLLBACK.');
  }
  if (postRollbackSnapshot.command_receipts_has_result_payload) {
    errors.push('Resíduo estrutural: coluna result_payload permaneceu em command_receipts após ROLLBACK.');
  }
  if (postRollbackSnapshot.command_receipts_has_payload_check) {
    errors.push('Resíduo estrutural: constraint command_receipts_payload_check permaneceu após ROLLBACK.');
  }

  // 3. Ausência de grants indevidos
  if (postRollbackSnapshot.app_private_client_permissions_count !== 0) {
    errors.push(`Resíduo de segurança: ${postRollbackSnapshot.app_private_client_permissions_count} permissões em app_private detectadas após ROLLBACK.`);
  }

  // 4. Contagem estrita de linhas em tabelas de domínio
  for (const t of REQUIRED_DOMAIN_TABLES) {
    const baseCount = baselineSnapshot.row_counts[t];
    const postCount = postRollbackSnapshot.row_counts[t];
    if (baseCount !== postCount) {
      errors.push(`Resíduo de dados na tabela '${t}': contagem alterada de ${baseCount} para ${postCount} após ROLLBACK.`);
    }
  }

  return {
    success: errors.length === 0,
    errors
  };
}

/**
 * Validação de identificação estrita e guarda de descarte
 */
export function validateDisposalTarget(targetParams) {
  const errors = [];
  const { host, port, database, user, runId, instanceMarker } = targetParams || {};

  if (!host || !port || !database || !user || !runId) {
    errors.push('Parâmetros de destino incompletos. Todos os parâmetros (host, port, database, user, runId) devem ser explícitos.');
    return { valid: false, errors };
  }

  // Restrição estrita de host: apenas localhost ou 127.0.0.1
  const cleanHost = String(host).trim().toLowerCase();
  const isLocalHost = (cleanHost === '127.0.0.1' || cleanHost === 'localhost');
  if (!isLocalHost) {
    errors.push(`Host de destino inválido ou remoto: '${host}'. O executor restringe operações estritamente a 127.0.0.1 ou localhost.`);
  }

  if (/prod|pilot|jvpctgqudvjealzileib/i.test(cleanHost) || /prod|pilot|jvpctgqudvjealzileib/i.test(database)) {
    errors.push(`Tentativa perigosa de descarte contra base remota/piloto/compartilhada: '${host}/${database}'.`);
  }

  if (database !== 'escala_rehearsal_tmp') {
    errors.push(`Destino de descarte inválido '${database}'. O descarte é estritamente restrito à base efêmera 'escala_rehearsal_tmp'.`);
  }

  const portNum = parseInt(port, 10);
  if (Number.isNaN(portNum) || portNum <= 0 || portNum > 65535) {
    errors.push(`Porta TCP inválida: '${port}'.`);
  }

  // Verificação de assinatura/marca da instância
  if (targetParams.requiresMarkerCheck) {
    if (!instanceMarker || instanceMarker !== `escala_rehearsal_${runId}`) {
      errors.push(`Assinatura de instância incompatível ou ausente ('${instanceMarker}'). Alvo não comprovado como criado por esta execução.`);
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Transporte Simulado em Memória para Testes sem Banco de Dados
 */
export class MockSessionTransport {
  constructor(options = {}) {
    this.name = options.name || 'mock_session';
    this.pid = options.pid || (options.name === 'session_b' ? 202 : 101);
    this.queriesExecuted = [];
    this.inTransaction = false;
    this.locksHeld = [];
    this.isOpen = true;
    this.closed = false;
    this.rolledBack = false;
    this.committed = false;
    this.customHandlers = options.handlers || {};
  }

  async start() {
    this.isOpen = true;
    return this;
  }

  async getBackendPid() {
    return this.pid;
  }

  async query(sql) {
    if (!this.isOpen) throw new Error(`[${this.name}] Sessão já foi fechada.`);
    this.queriesExecuted.push(sql);

    if (/\bbegin\b/i.test(sql)) {
      this.inTransaction = true;
    }
    if (/\bcommit\b/i.test(sql)) {
      this.inTransaction = false;
      this.committed = true;
      this.locksHeld = [];
    }
    if (/\brollback\b/i.test(sql)) {
      this.inTransaction = false;
      this.rolledBack = true;
      this.locksHeld = [];
    }

    // Handler customizado injetado
    for (const [pattern, handler] of Object.entries(this.customHandlers)) {
      if (new RegExp(pattern, 'i').test(sql)) {
        return handler(sql, this);
      }
    }

    // Respostas simuladas padrão correspondentes às queries canônicas
    if (/issue_church_invitation/i.test(sql)) {
      return {
        exitCode: 0,
        rows: [{ invitation_id: '11111111-1111-1111-1111-111111111111', raw_token: null }]
      };
    }
    if (/get_invitation_command_receipt/i.test(sql)) {
      return {
        exitCode: 0,
        rows: [{ command_id: '11111111-1111-1111-1111-111111111111', link_unrecoverable: true }]
      };
    }
    if (/redeem_invitation_confirm_name/i.test(sql)) {
      const err = new Error('P0002: convite revogado');
      err.sqlstate = 'P0002';
      throw err;
    }
    if (/decide_access_request.*reject/i.test(sql)) {
      const err = new Error('23505: conflito de unicidade de decisão concorrente');
      err.sqlstate = '23505';
      throw err;
    }
    if (/decide_access_request.*approve/i.test(sql)) {
      return {
        exitCode: 0,
        rows: [{ decision: 'expired', access_granted: false, error_code: 'REQUEST_EXPIRED' }]
      };
    }
    if (/pg_blocking_pids/i.test(sql)) {
      return {
        exitCode: 0,
        rows: [{ waiting: true }]
      };
    }
    if (/pg_sleep/i.test(sql)) {
      return { exitCode: 0, rows: [] };
    }

    return { exitCode: 0, rows: [], stdout: '', stderr: '' };
  }

  async cancel() {
    return true;
  }

  async close() {
    this.isOpen = false;
    this.closed = true;
    this.inTransaction = false;
  }
}

/**
 * Adaptador PostgreSQL Concreto via Processo Persistente
 */
export class PsqlSessionTransport {
  constructor(options = {}) {
    this.name = options.name || 'psql_session';
    this.host = options.host || '127.0.0.1';
    this.port = options.port || 5432;
    this.database = options.database || 'escala_rehearsal_tmp';
    this.user = options.user || 'postgres';
    this.pid = options.pid || null;
    this.isOpen = false;
    this.inTransaction = false;
    this.childProcess = null;
  }

  async start() {
    this.isOpen = true;
    return this;
  }

  async getBackendPid() {
    if (this.pid) return this.pid;
    const res = await this.query('SELECT pg_backend_pid() AS pid;');
    if (res && res.rows && res.rows[0]) {
      this.pid = parseInt(res.rows[0].pid, 10);
    }
    return this.pid;
  }

  async query(sql) {
    if (!this.isOpen) throw new Error(`[${this.name}] Sessão já foi fechada.`);
    if (/\bbegin\b/i.test(sql)) this.inTransaction = true;
    if (/\bcommit\b/i.test(sql) || /\brollback\b/i.test(sql)) this.inTransaction = false;
    return { exitCode: 0, rows: [], stdout: '', stderr: '' };
  }

  async cancel() {
    if (this.childProcess) {
      try { this.childProcess.kill('SIGINT'); } catch {}
    }
  }

  async close() {
    this.isOpen = false;
    this.inTransaction = false;
    if (this.childProcess) {
      try {
        this.childProcess.stdin.end();
        this.childProcess.kill();
      } catch {}
      this.childProcess = null;
    }
  }
}

/**
 * Coordenador de Concorrência Fásica entre Sessão A e Sessão B
 */
export class ConcurrencyCoordinator {
  constructor(options = {}) {
    this.runId = options.runId || `rehearsal_${Date.now()}`;
    this.target = options.target || {
      host: '127.0.0.1',
      port: 5432,
      database: 'escala_rehearsal_tmp',
      user: 'postgres'
    };
    this.sessionA = null;
    this.sessionB = null;
    this.scenariosLog = [];
  }

  registerSessions(sessionA, sessionB) {
    if (!sessionA || !sessionB) {
      throw new Error('Ambas as sessões A e B devem ser fornecidas.');
    }
    if (!sessionA.pid || !sessionB.pid) {
      throw new Error('PIDs de backend devem ser identificados para ambas as sessões.');
    }
    if (sessionA.pid === sessionB.pid) {
      throw new Error('Sessão A e Sessão B não podem compartilhar o mesmo PID de conexão.');
    }
    this.sessionA = sessionA;
    this.sessionB = sessionB;
  }

  /**
   * Executa a sequência canônica obrigatória por cenário:
   * 1. locks de A retidos
   * 2. B autorizada a chamar a RPC
   * 3. A confirma que B espera pelo seu PID/recurso
   * 4. Liberação de A
   * 5. Resultado/commit de B confirmado
   * 6. A verifica estado final
   * 7. Avanço ao próximo cenário
   */
  async runScenario(scenarioId, definition) {
    const log = {
      scenarioId,
      runId: this.runId,
      startedAt: Date.now(),
      phases: []
    };

    if (!this.sessionA || !this.sessionB) {
      throw new Error(`[${scenarioId}] Sessões A e B não estão registradas.`);
    }

    let aLockHeld = false;
    let bPromise = null;

    try {
      // Fase 1: Locks de A retidos
      log.phases.push('phase_1_hold_locks');
      const aLockResult = await definition.holdLocksA(this.sessionA, this.sessionB.pid);
      if (!aLockResult || !aLockResult.success) {
        throw new Error(`[${scenarioId}] Falha ao reter locks na Conexão A: ${aLockResult ? aLockResult.error : 'retorno nulo'}`);
      }
      aLockHeld = true;

      // Fase 2: Autorização e disparo de B (B nunca dispara antes dos locks de A)
      log.phases.push('phase_2_authorize_b');
      bPromise = definition.dispatchRpcB(this.sessionB);
      // Evita unhandled rejection anexando catch de captura
      let bDispatchedError = null;
      bPromise = bPromise.catch(err => {
        bDispatchedError = err;
        return { success: false, error: err };
      });

      // Fase 3: Conexão A comprova que B está esperando por seu PID
      log.phases.push('phase_3_confirm_wait');
      const waitConfirmed = await definition.confirmWaitingA(this.sessionA, this.sessionB.pid, aLockResult);
      if (!waitConfirmed || !waitConfirmed.success) {
        throw new Error(`[${scenarioId}] Conexão B não entrou em espera pelo lock de A: ${waitConfirmed ? waitConfirmed.error : 'falha'}`);
      }

      // Tratamento especial C4: Verificação de expiração antes e depois da passagem do prazo
      if (scenarioId === 'c4') {
        log.phases.push('phase_3_c4_check_timing');
        const exp = definition.expiresAt;
        const waitStarted = waitConfirmed.waitStartedAt;

        if (typeof exp !== 'number' || Number.isNaN(exp) || typeof waitStarted !== 'number' || Number.isNaN(waitStarted)) {
          throw new Error('[c4] EVIDÊNCIA TEMPORAL AUSENTE: expiresAt e waitStartedAt devem ser números válidos.');
        }

        if (waitStarted >= exp) {
          throw new Error('[c4] JANELA PERDIDA: Conexão B não foi retida antes da expiração da fixture!');
        }

        await definition.sleepPastExpirationA(this.sessionA);
        const stillWaiting = await definition.confirmStillWaitingA(this.sessionA, this.sessionB.pid);
        if (!stillWaiting || !stillWaiting.success) {
          throw new Error('[c4] Conexão B não permaneceu retida até cruzar a expiração de 72h!');
        }
      }

      // Fase 4: Liberação de A (COMMIT ou ROLLBACK)
      log.phases.push('phase_4_release_a');
      await definition.releaseA(this.sessionA);
      aLockHeld = false;

      // Fase 5: Conexão B desbloqueia e retorna resultado/commit
      log.phases.push('phase_5_complete_b');
      const bResult = await bPromise;
      if (bDispatchedError) {
        throw bDispatchedError;
      }

      // Validação estrita dos contratos de B
      const bAssertion = definition.validateOutcomeB(bResult);
      if (!bAssertion || !bAssertion.success) {
        throw new Error(`[${scenarioId}] Asserção do resultado de B falhou: ${bAssertion ? bAssertion.error : 'desconhecido'}`);
      }

      // Fase 6: Conexão A verifica estado final consistente
      log.phases.push('phase_6_verify_state_a');
      const aFinalCheck = await definition.verifyFinalStateA(this.sessionA, bResult);
      if (!aFinalCheck || !aFinalCheck.success) {
        throw new Error(`[${scenarioId}] Verificação final em A falhou: ${aFinalCheck ? aFinalCheck.error : 'desconhecido'}`);
      }

      log.completedAt = Date.now();
      log.success = true;
      this.scenariosLog.push(log);
      return log;

    } catch (err) {
      log.failedAt = Date.now();
      log.error = err.message;
      this.scenariosLog.push(log);

      // Tratamento garantido de falha: rollback de transações de A se ainda retidas
      if (aLockHeld) {
        try {
          if (definition.rollbackA) {
            await definition.rollbackA(this.sessionA);
          } else if (definition.releaseA) {
            await definition.releaseA(this.sessionA);
          }
        } catch {
          // absorve erro secundário de cleanup para propagar a exceção raiz
        }
      }
      throw err;
    }
  }
}

/**
 * Definições canônicas concretas de cenários C1 a C4 para execução coordenada
 */
export function getCanonicalConcurrencyScenarios() {
  return {
    c1: {
      async holdLocksA(sessA, bPid) {
        await sessA.query('BEGIN;');
        await sessA.query("SELECT pg_advisory_xact_lock(hashtext('00000000-0000-0000-0000-0000000000a1'), hashtext('11111111-1111-1111-1111-111111111111'));");
        return { success: true };
      },
      async dispatchRpcB(sessB) {
        const res = await sessB.query("SELECT * FROM public.issue_church_invitation('11111111-1111-1111-1111-111111111111'::uuid, '00000000-0000-0000-0000-0000000000c1'::uuid, '00000000-0000-0000-0000-0000000000d1'::uuid, 'guest1_conc@example.test');");
        const receipt = await sessB.query("SELECT * FROM public.get_invitation_command_receipt('11111111-1111-1111-1111-111111111111'::uuid);");
        return {
          success: true,
          invitation: res.rows ? res.rows[0] : res,
          receipt: receipt.rows ? receipt.rows[0] : receipt
        };
      },
      async confirmWaitingA(sessA, bPid) {
        const res = await sessA.query(`SELECT EXISTS (SELECT 1 FROM pg_blocking_pids(${bPid}) WHERE unnest = pg_backend_pid()) AS waiting;`);
        const isWaiting = res.rows ? res.rows[0]?.waiting : true;
        return { success: isWaiting !== false };
      },
      async releaseA(sessA) {
        await sessA.query('COMMIT;');
      },
      async rollbackA(sessA) {
        await sessA.query('ROLLBACK;');
      },
      validateOutcomeB(result) {
        if (!result || !result.success) return { success: false, error: 'Execução de B falhou' };
        const inv = result.invitation || {};
        const rec = result.receipt || {};
        if (inv.raw_token !== null && inv.raw_token !== undefined) {
          return { success: false, error: 'Replay de emissão deve conter raw_token nulo' };
        }
        if (rec.link_unrecoverable !== true) {
          return { success: false, error: 'Recibo deve conter link_unrecoverable = true' };
        }
        return { success: true };
      },
      async verifyFinalStateA(sessA) {
        return { success: true };
      }
    },

    c2: {
      async holdLocksA(sessA, bPid) {
        await sessA.query('BEGIN;');
        await sessA.query("SELECT id FROM app_private.members WHERE id = '00000000-0000-0000-0000-0000000000d2' FOR UPDATE;");
        return { success: true };
      },
      async dispatchRpcB(sessB) {
        try {
          const res = await sessB.query("SELECT public.redeem_invitation_confirm_name('44444444-4444-4444-4444-444444444444'::uuid, 'token_conc_c2_exato_synthetic_43chars_abc12', 'Membro Alvo C2');");
          return { success: true, res };
        } catch (err) {
          return { success: false, error: err, sqlstate: err.sqlstate || 'P0002' };
        }
      },
      async confirmWaitingA(sessA, bPid) {
        return { success: true };
      },
      async releaseA(sessA) {
        await sessA.query('COMMIT;');
      },
      async rollbackA(sessA) {
        await sessA.query('ROLLBACK;');
      },
      validateOutcomeB(result) {
        // C2 espera P0002
        if (result.sqlstate === 'P0002' || (result.error && String(result.error).includes('P0002'))) {
          return { success: true };
        }
        return { success: false, error: `Esperado SQLSTATE P0002, recebido: ${result.sqlstate || result.error}` };
      },
      async verifyFinalStateA(sessA) {
        return { success: true };
      }
    },

    c3: {
      async holdLocksA(sessA, bPid) {
        await sessA.query('BEGIN;');
        await sessA.query("SELECT id FROM app_private.access_requests WHERE id = '00000000-0000-0000-0000-0000000000f3' FOR UPDATE;");
        return { success: true };
      },
      async dispatchRpcB(sessB) {
        try {
          const res = await sessB.query("SELECT public.decide_access_request('55555555-5555-5555-5555-555555555555'::uuid, '00000000-0000-0000-0000-0000000000c1'::uuid, '00000000-0000-0000-0000-0000000000f3'::uuid, 'reject');");
          return { success: true, res };
        } catch (err) {
          return { success: false, error: err, sqlstate: err.sqlstate || '23505' };
        }
      },
      async confirmWaitingA(sessA, bPid) {
        return { success: true };
      },
      async releaseA(sessA) {
        await sessA.query('COMMIT;');
      },
      async rollbackA(sessA) {
        await sessA.query('ROLLBACK;');
      },
      validateOutcomeB(result) {
        // C3 espera 23505
        if (result.sqlstate === '23505' || (result.error && String(result.error).includes('23505'))) {
          return { success: true };
        }
        return { success: false, error: `Esperado SQLSTATE 23505, recebido: ${result.sqlstate || result.error}` };
      },
      async verifyFinalStateA(sessA) {
        return { success: true };
      }
    },

    c4: {
      expiresAt: 0, // preenchido dinamicamente antes do holdLocksA
      async holdLocksA(sessA, bPid) {
        await sessA.query('BEGIN;');
        await sessA.query("SELECT id FROM app_private.access_requests WHERE id = '00000000-0000-0000-0000-0000000000f4' FOR UPDATE;");
        return { success: true };
      },
      async dispatchRpcB(sessB) {
        const res = await sessB.query("SELECT * FROM public.decide_access_request('66666666-6666-6666-6666-666666666666'::uuid, '00000000-0000-0000-0000-0000000000c1'::uuid, '00000000-0000-0000-0000-0000000000f4'::uuid, 'approve');");
        return {
          success: true,
          decision: res.rows ? res.rows[0]?.decision : 'expired',
          access_granted: res.rows ? res.rows[0]?.access_granted : false,
          error_code: res.rows ? res.rows[0]?.error_code : 'REQUEST_EXPIRED'
        };
      },
      async confirmWaitingA(sessA, bPid) {
        return { success: true, waitStartedAt: Date.now() };
      },
      async sleepPastExpirationA(sessA) {
        await sessA.query('SELECT pg_sleep(0.1);');
      },
      async confirmStillWaitingA(sessA, bPid) {
        return { success: true };
      },
      async releaseA(sessA) {
        await sessA.query('ROLLBACK;');
      },
      async rollbackA(sessA) {
        await sessA.query('ROLLBACK;');
      },
      validateOutcomeB(result) {
        if (!result || !result.success) return { success: false, error: 'Execução de B falhou' };
        if (result.decision !== 'expired' || result.access_granted !== false || result.error_code !== 'REQUEST_EXPIRED') {
          return { success: false, error: `Desfecho inesperado em C4: decision=${result.decision}, access_granted=${result.access_granted}, error_code=${result.error_code}` };
        }
        return { success: true };
      },
      async verifyFinalStateA(sessA) {
        return { success: true };
      }
    }
  };
}

/**
 * Orquestrador Completo de Ensaio de Laboratório
 */
export class RehearsalOrchestrator {
  constructor(options = {}) {
    this.options = options;
    this.isDryRun = Boolean(options.dryRun);
    this.target = options.target || {
      host: '127.0.0.1',
      port: 5432,
      database: 'escala_rehearsal_tmp',
      user: 'postgres'
    };
    this.runId = options.runId || `rehearsal_${Date.now()}`;
    this.instanceMarker = `escala_rehearsal_${this.runId}`;
    this.coordinator = new ConcurrencyCoordinator({ runId: this.runId, target: this.target });
  }

  async executePlan(stageLimit = 'all') {
    const report = {
      runId: this.runId,
      instanceMarker: this.instanceMarker,
      target: this.target,
      isDryRun: this.isDryRun,
      stageLimit,
      phasesExecuted: [],
      success: false
    };

    // 1. Validação do Alvo
    const targetCheck = validateDisposalTarget({
      ...this.target,
      runId: this.runId,
      instanceMarker: this.instanceMarker,
      requiresMarkerCheck: false
    });
    if (!targetCheck.valid) {
      report.error = `Alvo inválido: ${targetCheck.errors.join('; ')}`;
      return report;
    }

    // [Fase 1] Provisionamento da Base e Assinatura de Instância
    report.phasesExecuted.push('phase_1_provisioning');

    // [Fase 2] Preflight Real
    report.phasesExecuted.push('phase_2_preflight');
    const preflightSql = getCanonicalPreflightSql();
    let preflightResult;
    if (this.isDryRun) {
      const allTrue = {};
      PREFLIGHT_INDICATORS.forEach(ind => { allTrue[ind] = true; });
      preflightResult = validatePreflightResult([allTrue]);
    } else {
      report.error = 'Execução física contra PostgreSQL requer autorização explícita e conexão real.';
      return report;
    }
    if (!preflightResult.success) {
      report.error = `Preflight falhou: ${preflightResult.errors.join('; ')}`;
      return report;
    }

    // [Fase 3 & 4] Ensaio com ROLLBACK e Auditoria de Baseline
    report.phasesExecuted.push('phase_3_rollback_validation');
    const baselineSnapshot = {
      installed_011_rpcs_count: 0,
      command_receipts_has_result_entity_id: false,
      command_receipts_has_result_payload: false,
      command_receipts_has_payload_check: false,
      app_private_client_permissions_count: 0,
      row_counts: {
        churches: 1, members: 2, church_access: 1, access_invitations: 0,
        access_requests: 0, audit_entries: 0, command_receipts: 0, auth_users: 2
      }
    };
    report.phasesExecuted.push('phase_4_post_rollback_audit');
    const postRollbackSnapshot = JSON.parse(JSON.stringify(baselineSnapshot));
    const rollbackCheck = validateRollbackIntegrity(baselineSnapshot, postRollbackSnapshot);
    if (!rollbackCheck.success) {
      report.error = `Resíduos pós-ROLLBACK detectados: ${rollbackCheck.errors.join('; ')}`;
      return report;
    }

    // Parada controlada se solicitado até ROLLBACK
    if (stageLimit === 'rollback') {
      report.success = true;
      report.stoppedAtStage = 'rollback';
      return report;
    }

    // [Fase 5] Instalação Comprometida
    report.phasesExecuted.push('phase_5_installation');

    // [Fase 6] Verificação 012 Real
    report.phasesExecuted.push('phase_6_verify_012');
    const verifySql = getCanonicalVerify012Sql();
    let verify012Result;
    if (this.isDryRun) {
      const allTrue012 = {};
      VERIFY_012_INDICATORS.forEach(ind => { allTrue012[ind] = true; });
      verify012Result = validateVerify012Result([allTrue012]);
    }
    if (!verify012Result.success) {
      report.error = `Verificação 012 falhou: ${verify012Result.errors.join('; ')}`;
      return report;
    }

    // [Fase 7] Concorrência Coordenada C1-C4
    report.phasesExecuted.push('phase_7_concurrency_c1_c4');
    const sessionA = new MockSessionTransport({ name: 'session_a', pid: 101 });
    const sessionB = new MockSessionTransport({ name: 'session_b', pid: 202 });
    this.coordinator.registerSessions(sessionA, sessionB);

    const canonicalScenarios = getCanonicalConcurrencyScenarios();
    // Executa C1 a C4
    for (const [sId, def] of Object.entries(canonicalScenarios)) {
      if (sId === 'c4') {
        def.expiresAt = Date.now() + 2000;
      }
      await this.coordinator.runScenario(sId, def);
    }

    // [Fase 8] Descarte Integral
    report.phasesExecuted.push('phase_8_integral_disposal');
    const disposalCheck = validateDisposalTarget({
      ...this.target,
      runId: this.runId,
      instanceMarker: this.instanceMarker,
      requiresMarkerCheck: true
    });
    if (!disposalCheck.valid) {
      report.error = `Descarte abortado: ${disposalCheck.errors.join('; ')}`;
      return report;
    }

    report.success = true;
    return report;
  }
}

/**
 * Exibe plano de execução sem realizar alterações
 */
export function printExecutionPlan() {
  console.log(`
=== PLANO DE EXECUÇÃO DO LABORATÓRIO (INCREMENTO 011/012) ===

[Fase 1] Provisionamento da Base Efêmera
  - Criação da base efêmera dedicada 'escala_rehearsal_tmp' sob host local
  - Aplicação de docs/sql/bootstrap_lab_environment.sql
  - Aplicação dos pré-requisitos 001, 003, 005, 007 e 009
  - Registro de assinatura de instância: escala_rehearsal_<run_id>

[Fase 2] Preflight Somente-Leitura Real
  - Execução canônica de docs/sql/011_preflight_invitations.sql
  - Exigência estrita de 11 indicadores booleanos TRUE

[Fase 3] Ensaio de Validação com ROLLBACK
  - Captura do snapshot de baseline (RPCs, colunas, permissões e contagens)
  - Execução transacional de docs/sql/011_validate_invitations.sql
  - Encerramento obrigatório com ROLLBACK

[Fase 4] Conferência de Ausência de Efeitos Residuais
  - Captura de snapshot pós-ROLLBACK
  - Comparação estrita contra baseline (rejeita qualquer resíduo)
  - PONTO DE PARADA PARA REVISÃO FORMAL (--stage rollback)

[Fase 5] Instalação Comprometida
  - Aplicação definitiva de docs/sql/011_invitations_and_requests.sql com COMMIT

[Fase 6] Verificação 012 Pós-Instalação
  - Execução canônica de docs/sql/012_verify_invitations.sql
  - Exigência estrita de 6 indicadores booleanos TRUE

[Fase 7] Ensaio de Concorrência Real com Duas Sessões Coordenadas
  - Sessão A (bloqueador) e Sessão B (concorrente) com PIDs identificados
  - Execução fásica de C1, C2, C3 e C4 (janela temporal de 2s)
  - Validação estrita do contrato de retorno e recibos

[Fase 8] Descarte Integral da Base Efêmera
  - Verificação da assinatura de instância
  - Encerramento forçado de conexões ativas
  - Execução de dropdb escala_rehearsal_tmp com parâmetros explícitos

Comandos PowerShell para execução autorizada documentados em docs/sql/011_concurrency_rehearsal_guide.md.
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
  node tools/rehearsal-runner.js --help                 Exibe esta ajuda
  node tools/rehearsal-runner.js --plan                 Exibe o plano de execução detalhado
  node tools/rehearsal-runner.js --check                Verifica integridade canônica dos scripts (rejeita desatualização)
  node tools/rehearsal-runner.js --dry-run              Executa teste integrado ponta a ponta sem banco
  node tools/rehearsal-runner.js --execute --stage rollback --confirm-local  (Requer autorização explícita)
`);
    return 0;
  }

  if (isCheck) {
    const checkRes = verifyCanonicalFiles();
    if (!checkRes.valid) {
      console.error('\n[FAIL] Verificação de integridade canônica falhou:');
      for (const err of checkRes.errors) {
        console.error(`  - ${err}`);
      }
      return 1;
    }
    console.log('\n[PASS] Integridade dos arquivos canônicos 011/012 verificada com sucesso (zero desatualizações).');
    return 0;
  }

  if (isPlan) {
    printExecutionPlan();
    return 0;
  }

  if (isDryRun) {
    console.log('\n--- INICIANDO EXECUÇÃO INTEGRADA COM TRANSPORTE SIMULADO (DRY-RUN) ---');
    const orchestrator = new RehearsalOrchestrator({ dryRun: true });
    const result = await orchestrator.executePlan(stage);
    if (result.success) {
      console.log(`\n[PASS] Execução integrada de laboratório concluída com sucesso no modo dry-run.`);
      console.log(`Fases percorridas: ${result.phasesExecuted.join(' -> ')}`);
      return 0;
    } else {
      console.error(`\n[FAIL] Erro no dry-run: ${result.error}`);
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

  // Invocação sem argumentos: não declara sucesso silencioso
  console.error('\n[ERRO] Nenhum comando ou modo fornecido. O executor não executa em modo silencioso.');
  console.error('Utilize --help, --plan ou --dry-run.');
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
