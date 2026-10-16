import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  PsqlCommandTransport,
  RehearsalOrchestrator013,
  createInitialJournal,
  writeJournal
} from '../tools/rehearsal-runner-013.js';

test('1. Sessão própria identificada corretamente pode ser encerrada e tem término confirmado', async () => {
  const runId = 'run_propria_1';
  const transport = new PsqlCommandTransport({ timeoutMs: 500, runId });
  const appName = `rehearsal_013_${runId}_session_a`;
  const backendStart = '2026-10-16 10:00:00+00';
  transport.recordSession({
    id: 'session_a_013',
    pid: 12345,
    backend_start: backendStart,
    application_name: appName
  });

  const commands = [];
  transport._runProcess = async (args = []) => {
    const cmd = args.join(' ');
    commands.push(cmd);
    // 1: checkSql
    if (commands.length === 1) {
      return { stdout: `12345|${appName}|${backendStart}`, stderr: '', code: 0 };
    }
    // 2: specific termSql
    if (commands.length === 2) {
      return { stdout: 't', stderr: '', code: 0 };
    }
    // 3: recheck
    if (commands.length === 3) {
      return { stdout: '', stderr: '', code: 0 };
    }
    return { stdout: '', stderr: '', code: 0 };
  };

  const res = await transport.confirmBackendSessionsClosed();
  assert.equal(res.confirmed, true);
  assert.equal(commands.length, 3);
  // Confere que pg_terminate_backend foi emitido com filtros estritos de PID, appName e backend_start
  const termCmd = commands[1];
  assert.ok(termCmd.includes('pg_terminate_backend(12345)'), 'Deve invocar pg_terminate_backend no PID 12345');
  assert.ok(termCmd.includes(`application_name = '${appName}'`), 'Deve restringir por application_name exato da execução');
  assert.ok(termCmd.includes(`backend_start = '${backendStart}'`), 'Deve restringir por backend_start exato');
});

test('2. Sessão de outra execução, inclusive com mesmo prefixo/papel, permanece intocada', async () => {
  const runId = 'run_propria_2';
  const transport = new PsqlCommandTransport({ timeoutMs: 500, runId });
  const foreignAppName = 'rehearsal_013_run_outra_execucao_session_a';
  const foreignBackendStart = '2026-10-16 09:30:00+00';

  const commands = [];
  transport._runProcess = async (args = []) => {
    const cmd = args.join(' ');
    commands.push(cmd);
    // Simula pg_stat_activity retornando sessão de outra execução
    if (commands.length === 1) {
      return { stdout: `98765|${foreignAppName}|${foreignBackendStart}`, stderr: '', code: 0 };
    }
    return { stdout: '', stderr: '', code: 0 };
  };

  const res = await transport.confirmBackendSessionsClosed();
  // Jamais deve ter executado terminate_backend contra a sessão estrangeira
  assert.equal(commands.some(c => c.includes('pg_terminate_backend')), false,
    'Sessão de outra execução jamais pode sofrer pg_terminate_backend');
  assert.equal(res.confirmed, false,
    'Presença de sessão não pertencente a esta execução impede confirmação e bloqueia limpeza');
});

test('3. PID igual com backend_start/identidade divergente permanece intocado', async () => {
  const runId = 'run_propria_3';
  const transport = new PsqlCommandTransport({ timeoutMs: 500, runId });
  const appName = `rehearsal_013_${runId}_session_a`;
  const originalBackendStart = '2026-10-16 10:00:00+00';
  const recycledBackendStart = '2026-10-16 10:05:00+00'; // Divergente! PID foi reciclado pelo SO/PostgreSQL

  transport.recordSession({
    id: 'session_a_013',
    pid: 54321,
    backend_start: originalBackendStart,
    application_name: appName
  });

  const commands = [];
  transport._runProcess = async (args = []) => {
    const cmd = args.join(' ');
    commands.push(cmd);
    if (commands.length === 1) {
      return { stdout: `54321|${appName}|${recycledBackendStart}`, stderr: '', code: 0 };
    }
    return { stdout: '', stderr: '', code: 0 };
  };

  const res = await transport.confirmBackendSessionsClosed();
  assert.equal(commands.some(c => c.includes('pg_terminate_backend')), false,
    'PID reutilizado com backend_start divergente JAMAIS pode ser terminado');
  assert.equal(res.confirmed, false,
    'Suspeita de reciclagem de PID deve retornar confirmed=false');
  assert.ok(res.error.includes('reciclado') || res.error.includes('divergente'));
});

test('4. Falta de identidade comprovável não emite término; situação inconclusiva retorna confirmed=false', async () => {
  // Transporte sem runId (ou com journal antigo sem identidade comprovável)
  const transport = new PsqlCommandTransport({ timeoutMs: 500, runId: null });

  const commands = [];
  transport._runProcess = async (args = []) => {
    const cmd = args.join(' ');
    commands.push(cmd);
    if (commands.length === 1) {
      return { stdout: '4123|rehearsal_013_session_a|2026-10-16 10:00:00+00', stderr: '', code: 0 };
    }
    return { stdout: '', stderr: '', code: 0 };
  };

  const res = await transport.confirmBackendSessionsClosed();
  assert.equal(commands.some(c => c.includes('pg_terminate_backend')), false,
    'Sem runId comprovável, término de sessão com nome genérico/compartilhado é proibido');
  assert.equal(res.confirmed, false);
  assert.ok(res.error.includes('identidade comprovável') || res.error.includes('não autorizado'));
});

test('5. Reinício do orquestrador carrega a mesma identidade do journal', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rehearsal-restart-test-'));
  const journalPath = path.join(tempDir, '.rehearsal-013-journal.json');

  try {
    const initialRunId = 'run_durable_restart_test_999';
    const initialJournal = createInitialJournal({ runId: initialRunId });
    initialJournal.recordedSessions = [
      {
        id: 'session_a_013',
        pid: 7777,
        backend_start: '2026-10-16 11:00:00+00',
        application_name: `rehearsal_013_${initialRunId}_session_a`
      }
    ];
    writeJournal(journalPath, initialJournal);

    // Instância 1: lê do journal existente
    const transport1 = new PsqlCommandTransport();
    const orch1 = new RehearsalOrchestrator013({
      dryRun: false,
      journalPath,
      transport: transport1
    });

    assert.equal(orch1.runId, initialRunId);
    assert.equal(transport1.runId, initialRunId);
    assert.equal(transport1.recordedSessions.length, 1);
    assert.equal(transport1.recordedSessions[0].pid, 7777);

    // Instância 2 (simula retomada em outro processo do mesmo ensaio):
    const transport2 = new PsqlCommandTransport();
    const orch2 = new RehearsalOrchestrator013({
      dryRun: false,
      journalPath,
      transport: transport2
    });

    assert.equal(orch2.runId, initialRunId);
    assert.equal(transport2.runId, initialRunId);
    assert.equal(transport2.recordedSessions.length, 1);
    assert.equal(transport2.recordedSessions[0].pid, 7777);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('6. Indisponibilidade da consulta ou backend próprio ainda ativo retorna confirmed=false e mantém zero mutações de limpeza', async () => {
  // Cenário 6.A: Indisponibilidade na consulta ao PostgreSQL
  {
    const executedMutations = [];
    const transport = {
      runId: 'run_test_6a',
      confirmBackendSessionsClosed: async () => ({
        confirmed: false,
        error: 'Erro de conexão/timeout com pg_stat_activity'
      }),
      executeSql: async (sql) => {
        executedMutations.push(sql);
        return { success: true };
      }
    };

    const orchestrator = new RehearsalOrchestrator013({
      dryRun: false,
      transport,
      journal: {
        formatVersion: '1.0',
        runId: 'run_test_6a',
        target: { container: 'supabase_db_escala-convites-http-lab', port: 55332, database: 'postgres', user: 'postgres' },
        installer: { file: '013_member_lifecycle.sql', sha256: '40709A4FE9FEB688D3BE92564B821DCAC4142F6A588E4ACA585D42FBDB964AF7' },
        provenOwnership: { baselineCaptured: true, installed013: true, fixturesCreated: true }
      }
    });

    const res = await orchestrator.performRecovery();
    assert.equal(res.success, false);
    assert.equal(res.attempted, false);
    assert.equal(res.fixtureCleanupExecuted, false);
    assert.equal(res.reversalExecuted, false);
    assert.equal(executedMutations.length, 0, 'Zero mutações de limpeza permitidas quando consulta de sessões está indisponível');
  }

  // Cenário 6.B: Backend próprio ainda ativo após tentativa de término
  {
    const executedMutations = [];
    const transport = {
      runId: 'run_test_6b',
      confirmBackendSessionsClosed: async () => ({
        confirmed: false,
        error: 'Sessões backend no PostgreSQL ainda ativas após tentativa de término: 12345'
      }),
      executeSql: async (sql) => {
        executedMutations.push(sql);
        return { success: true };
      }
    };

    const orchestrator = new RehearsalOrchestrator013({
      dryRun: false,
      transport,
      journal: {
        formatVersion: '1.0',
        runId: 'run_test_6b',
        target: { container: 'supabase_db_escala-convites-http-lab', port: 55332, database: 'postgres', user: 'postgres' },
        installer: { file: '013_member_lifecycle.sql', sha256: '40709A4FE9FEB688D3BE92564B821DCAC4142F6A588E4ACA585D42FBDB964AF7' },
        provenOwnership: { baselineCaptured: true, installed013: true, fixturesCreated: true }
      }
    });

    const res = await orchestrator.performRecovery();
    assert.equal(res.success, false);
    assert.equal(res.attempted, false);
    assert.equal(res.fixtureCleanupExecuted, false);
    assert.equal(res.reversalExecuted, false);
    assert.equal(executedMutations.length, 0, 'Zero mutações de limpeza permitidas quando backend próprio continua ativo');
  }
});
