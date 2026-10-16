import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import {
  verifyCanonicalFiles,
  isValidUuid,
  validateFixtureManifest,
  validateSnapshotSchema,
  compareSnapshots,
  validateVerify014Result,
  validateMemberLifecycleReceipt,
  createSimulatedBaselineSnapshot,
  createSimulatedPostReversalSnapshot,
  RehearsalOrchestrator013,
  MockSessionTransport,
  ConcurrencyCoordinator,
  PsqlCommandTransport,
  runCli,
  CANONICAL_013_INSTALLER_SHA256,
  REHEARSAL_013_FIXTURE_MANIFEST,
  EXACT_FIXTURE_CLEANUP_013_SQL,
  EXACT_REVERSAL_013_SQL,
  BASELINE_SNAPSHOT_013_SQL,
  DEFAULT_JOURNAL_PATH,
  createInitialJournal,
  writeJournal,
  readJournal,
  validateJournal,
  calculateManifestFingerprint,
  REQUIRED_DOMAIN_TABLES,
  VERIFY_014_INDICATORS
} from '../tools/rehearsal-runner-013.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

test('1. Pacote canônico atual passa integralmente na verificação', () => {
  const result = verifyCanonicalFiles(rootDir);
  assert.equal(result.valid, true, `Erros encontrados: ${result.errors.join('; ')}`);
  assert.equal(result.errors.length, 0);
});

test('2. Pacote sem instalador 013 deve falhar estritamente', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rehearsal-test-missing-installer-'));
  try {
    const sqlDir = path.join(tempDir, 'docs', 'sql');
    fs.mkdirSync(sqlDir, { recursive: true });

    const result = verifyCanonicalFiles(tempDir);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('013_member_lifecycle.sql não encontrado no pacote.')));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('3. Instalador 013 com hash SHA-256 alterado deve falhar', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rehearsal-test-bad-hash-'));
  try {
    const sqlDir = path.join(tempDir, 'docs', 'sql');
    fs.mkdirSync(sqlDir, { recursive: true });
    fs.writeFileSync(path.join(sqlDir, '013_member_lifecycle.sql'), '-- SQL MODIFICADO INDEVIDAMENTE');

    const result = verifyCanonicalFiles(tempDir);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('divergiu do hash canônico aprovado')));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('4. Validação de UUIDs: identificadores inválidos com caracteres não hexadecimais devem falhar', () => {
  assert.equal(isValidUuid('01300000-0000-4000-8000-0000000000u2'), false);
  assert.equal(isValidUuid('01300000-0000-4000-8000-0000000000u3'), false);
  assert.equal(isValidUuid('not-a-uuid'), false);
  assert.equal(isValidUuid(''), false);
  assert.equal(isValidUuid(null), false);

  assert.equal(isValidUuid('01300000-0000-4000-8000-0000000000b2'), true);
  assert.equal(isValidUuid('01300000-0000-4000-8000-0000000000b3'), true);
  assert.equal(isValidUuid('01300000-0000-4000-8000-0000000000a1'), true);
  assert.equal(isValidUuid('01300000-0000-4000-8000-000000000cc3'), true);

  const badManifest = {
    authUsers: ['01300000-0000-4000-8000-0000000000u2'],
    churches: [],
    members: [],
    churchAccess: [],
    commandReceipts: []
  };
  const manifestRes = validateFixtureManifest(badManifest);
  assert.equal(manifestRes.valid, false);
  assert.ok(manifestRes.errors.some(e => e.includes('01300000-0000-4000-8000-0000000000u2')));

  const canonManifestRes = validateFixtureManifest(REHEARSAL_013_FIXTURE_MANIFEST);
  assert.equal(canonManifestRes.valid, true, canonManifestRes.errors.join('; '));
});

test('5. Alteração de fingerprint de conteúdo mantendo contagem de linhas DEVE falhar na comparação de snapshots', () => {
  const baseline = createSimulatedBaselineSnapshot();
  const validSchema = validateSnapshotSchema(baseline);
  assert.equal(validSchema.valid, true, validSchema.errors.join('; '));

  // Simula cópia onde contagens permanecem idênticas, mas dados foram adulterados
  const alteredContent = JSON.parse(JSON.stringify(baseline));
  alteredContent.content_hashes.members = 'm9999999999999999999999999999999';

  const comparison = compareSnapshots(baseline, alteredContent);
  assert.equal(comparison.matches, false, 'Comparador aceitou indevidamente snapshot com hash de conteúdo divergente!');
  assert.ok(comparison.differences.some(d => d.includes('content_hashes.members divergiu')));
});

test('6. Divergência em contagem de linhas ou catálogo também deve falhar na comparação', () => {
  const baseline = createSimulatedBaselineSnapshot();

  const alteredCount = JSON.parse(JSON.stringify(baseline));
  alteredCount.row_counts.members = 8; // sobrou um membro residual!

  const compCount = compareSnapshots(baseline, alteredCount);
  assert.equal(compCount.matches, false);
  assert.ok(compCount.differences.some(d => d.includes('row_counts.members divergiu')));

  const alteredTrigger = JSON.parse(JSON.stringify(baseline));
  alteredTrigger.members_trigger_function = 'touch_member_updated_at'; // não desinstalou o gatilho!

  const compTrigger = compareSnapshots(baseline, alteredTrigger);
  assert.equal(compTrigger.matches, false);
  assert.ok(compTrigger.differences.some(d => d.includes('members_trigger_function divergiu')));
});

test('7. Verificação prévia de colisão no script de concorrência A', () => {
  const sessionAPath = path.join(rootDir, 'docs', 'sql', 'concurrency', '013_concurrency_session_a.sql');
  const sessionAContent = fs.readFileSync(sessionAPath, 'utf8');

  assert.ok(sessionAContent.includes('do $precheck_collision$'));
  assert.ok(sessionAContent.includes('23505'));
  assert.equal(sessionAContent.toLowerCase().includes('on conflict (id) do nothing'), false,
    '013_concurrency_session_a.sql ainda contém ON CONFLICT (id) DO NOTHING!');
});

test('8. Erros e etapas inválidas nunca podem produzir PASS', async () => {
  const orchestrator = new RehearsalOrchestrator013({ dryRun: true });

  const invalidStageResult = await orchestrator.executePlan('etapa_inexistente');
  assert.equal(invalidStageResult.success, false);
  assert.ok(invalidStageResult.error.includes('Etapa inválida'));

  const cliStageCode = await runCli(['--stage', 'etapa_inexistente']);
  assert.equal(cliStageCode, 1);

  const cliUnknownCode = await runCli(['--opcao-desconhecida']);
  assert.equal(cliUnknownCode, 1);

  const cliExecCode = await runCli(['--execute']);
  assert.equal(cliExecCode, 1);
});

test('9. Validação de 014 rejeita estritamente indicadores FALSE ou NULL', () => {
  const withFalse = {};
  VERIFY_014_INDICATORS.forEach(ind => { withFalse[ind] = true; });
  withFalse['private_schema_still_blocked'] = false;
  const resFalse = validateVerify014Result([withFalse]);
  assert.equal(resFalse.success, false);
  assert.ok(resFalse.errors.some(e => e.includes('FALSE')));

  const withNull = {};
  VERIFY_014_INDICATORS.forEach(ind => { withNull[ind] = true; });
  withNull['all_four_rpcs_hardened'] = null;
  const resNull = validateVerify014Result([withNull]);
  assert.equal(resNull.success, false);
  assert.ok(resNull.errors.some(e => e.includes('NULL')));

  const allTrue = {};
  VERIFY_014_INDICATORS.forEach(ind => { allTrue[ind] = true; });
  const resTrue = validateVerify014Result([allTrue]);
  assert.equal(resTrue.success, true);
  assert.equal(resTrue.errors.length, 0);
});

test('10. Roteiro de navegador local usa VITE_SUPABASE_PUBLISHABLE_KEY e reflete UI real', () => {
  const roteiroPath = path.join(rootDir, 'docs', 'ROTEIRO-NAVEGADOR-LOCAL-013.md');
  const roteiro = fs.readFileSync(roteiroPath, 'utf8');

  assert.ok(roteiro.includes('VITE_SUPABASE_PUBLISHABLE_KEY'),
    'Roteiro deve referenciar VITE_SUPABASE_PUBLISHABLE_KEY.');
  assert.equal(roteiro.includes('$env:VITE_SUPABASE_ANON_KEY ='), false,
    'Roteiro não deve atribuir VITE_SUPABASE_ANON_KEY no comando do PowerShell.');
  assert.ok(roteiro.includes('pageSize = 10') || roteiro.includes('pageSize=10'),
    'Roteiro deve explicitar o pageSize=10 de MembersPage.jsx.');
  assert.ok(roteiro.includes('11'),
    'Roteiro deve especificar 11 inativos para testar paginação real com reposicionamento.');
});

test('11. R1: Modo físico e rollback sem transporte não podem ter sucesso', async () => {
  // Inicialização de modo físico sem transporte deve falhar no construtor
  assert.throws(() => {
    new RehearsalOrchestrator013({ dryRun: false, transport: null });
  }, (err) => {
    return err.message.includes('transporte');
  });

  // RehearsalOrchestrator com isDryRun: false mas transport ausente recusa rollback e cleanup
  const orchestrator = new RehearsalOrchestrator013({ dryRun: true });
  orchestrator.isDryRun = false;
  orchestrator.transport = null;

  const rollbackRes = await orchestrator.rollback();
  assert.equal(rollbackRes.success, false);
  assert.ok(rollbackRes.error.includes('transporte'));

  const cleanupRes = await orchestrator.cleanup();
  assert.equal(cleanupRes.success, false);
  assert.ok(cleanupRes.error.includes('transporte'));
});

test('12. R1: Falha de limpeza/rollback com transporte injetado produz erro estrito e recusa PASS', async () => {
  const failingTransport = {
    executeSql: async (sql) => {
      if (sql.includes('church_access_protect_last_admin') || sql.includes('alter table') || sql.includes('delete from')) {
        throw new Error('SIMULATED_DATABASE_TIMEOUT: Lock timeout 5s expired during trigger disable');
      }
      return { success: true, output: '' };
    },
    executeFile: async (filePath) => {
      return { success: true, output: '' };
    },
    captureSnapshot: async () => {
      return createSimulatedBaselineSnapshot();
    },
    executeCleanupAndReversal: async () => {
      throw new Error('SIMULATED_DATABASE_TIMEOUT: Lock timeout 5s expired during trigger disable');
    },
    close: async () => ({ confirmed: true })
  };

  const orchestrator = new RehearsalOrchestrator013({ dryRun: false, transport: failingTransport });
  const cleanupRes = await orchestrator.cleanup();
  assert.equal(cleanupRes.success, false);
  assert.ok(cleanupRes.error.includes('SIMULATED_DATABASE_TIMEOUT'));

  const planRes = await orchestrator.runRehearsalPlan();
  assert.equal(planRes.success, false);
  assert.equal(planRes.cleanupSuccess, false);
  assert.ok(planRes.cleanupError.includes('SIMULATED_DATABASE_TIMEOUT'));
});

test('13. R2: Variação de agendamento impede Sessão B de chamar RPC antes de A obter o lock', async () => {
  const sessionA = new MockSessionTransport({ name: 'session_a', pid: 1001 });
  const sessionB = new MockSessionTransport({ name: 'session_b', pid: 1002 });
  const coordinator = new ConcurrencyCoordinator();
  coordinator.registerSessions(sessionA, sessionB);

  // Tentativa de despachar B antes de A ter adquirido o lock da linha deve lançar erro
  await assert.rejects(async () => {
    await coordinator.dispatchSessionBDirectly('c1a');
  }, (err) => {
    return err.message.includes('VIOLAÇÃO DE ORDENAÇÃO') && err.message.includes('bloqueio do recurso');
  });

  // O mesmo para c1b1, c1b2, c2 e c3
  await assert.rejects(async () => { await coordinator.dispatchSessionBDirectly('c1b1'); }, /VIOLAÇÃO DE ORDENAÇÃO/);
  await assert.rejects(async () => { await coordinator.dispatchSessionBDirectly('c1b2'); }, /VIOLAÇÃO DE ORDENAÇÃO/);
  await assert.rejects(async () => { await coordinator.dispatchSessionBDirectly('c2'); }, /VIOLAÇÃO DE ORDENAÇÃO/);
  await assert.rejects(async () => { await coordinator.dispatchSessionBDirectly('c3'); }, /VIOLAÇÃO DE ORDENAÇÃO/);
});

test('14. R3: Validador de recibo aceita contrato real de 6 colunas e rejeita campos inventados (applied_at / is_replay)', () => {
  const validRealReceipt = {
    command_id: '01300000-0000-4000-8000-000000000cc3',
    action: 'restore_member',
    church_id: '01300000-0000-4000-8000-0000000000c1',
    result_member_id: '01300000-0000-4000-8000-0000000000d5',
    result_payload: {
      status: 'active',
      restored_at: '2026-10-16T14:00:00.000Z',
      updated_at: '2026-10-16T14:00:00.000Z'
    },
    created_at: '2026-10-16T14:00:00.000Z'
  };

  const valSuccess = validateMemberLifecycleReceipt(validRealReceipt, {
    expectedCommandId: '01300000-0000-4000-8000-000000000cc3',
    expectedChurchId: '01300000-0000-4000-8000-0000000000c1',
    expectedMemberId: '01300000-0000-4000-8000-0000000000d5'
  });
  assert.equal(valSuccess.valid, true, valSuccess.errors.join('; '));

  // Rejeita applied_at inventado
  const badAppliedAt = {
    ...validRealReceipt,
    result_payload: { ...validRealReceipt.result_payload, applied_at: '2026-10-16T14:00:00.000Z' }
  };
  const valAppliedAt = validateMemberLifecycleReceipt(badAppliedAt);
  assert.equal(valAppliedAt.valid, false);
  assert.ok(valAppliedAt.errors.some(e => e.includes('applied_at')));

  // Rejeita is_replay inventado
  const badIsReplay = { ...validRealReceipt, is_replay: true };
  const valIsReplay = validateMemberLifecycleReceipt(badIsReplay);
  assert.equal(valIsReplay.valid, false);
  assert.ok(valIsReplay.errors.some(e => e.includes('is_replay')));

  // Rejeita falta de colunas reais obrigatórias
  const missingCol = { ...validRealReceipt };
  delete missingCol.created_at;
  const valMissing = validateMemberLifecycleReceipt(missingCol);
  assert.equal(valMissing.valid, false);
  assert.ok(valMissing.errors.some(e => e.includes('created_at')));

  // Rejeita divergência em church_id
  const wrongChurch = { ...validRealReceipt, church_id: '01300000-0000-4000-8000-0000000000c2' };
  const valChurch = validateMemberLifecycleReceipt(wrongChurch, {
    expectedChurchId: '01300000-0000-4000-8000-0000000000c1'
  });
  assert.equal(valChurch.valid, false);
  assert.ok(valChurch.errors.some(e => e.includes('diverge do esperado')));
});

test('15. R4: Manifesto e script de limpeza contêm o vínculo ...ac22 e dropam a tabela de coordenação', () => {
  const ac22 = '01300000-0000-4000-8000-00000000ac22';

  assert.ok(REHEARSAL_013_FIXTURE_MANIFEST.churchAccess.includes(ac22),
    'Manifesto de fixtures da 013 deve conter o acesso ...ac22');

  assert.ok(EXACT_FIXTURE_CLEANUP_013_SQL.includes(ac22),
    'Script de limpeza exata deve deletar ...ac22');

  assert.ok(EXACT_FIXTURE_CLEANUP_013_SQL.includes("SET LOCAL lock_timeout = '5s'"),
    'Script de limpeza deve estabelecer lock_timeout curto para proteção de triggers');

  assert.ok(EXACT_FIXTURE_CLEANUP_013_SQL.includes('DROP TABLE IF EXISTS app_private.rehearsal_coordination'),
    'Script de limpeza deve eliminar a tabela efêmera de coordenação sem deixá-la residual');
});

test('16. R5: Divergência em fingerprints de catálogo (triggers, RLS, functions, coordination table) é estritamente recusada', () => {
  const baseline = createSimulatedBaselineSnapshot();
  const postRev = createSimulatedPostReversalSnapshot();

  // Snapshot canônico contra pós-reversão deve casar
  const matchRes = compareSnapshots(baseline, postRev);
  assert.equal(matchRes.matches, true, matchRes.differences.join('; '));

  // Triggers de catálogo alterados (ex: trigger deixado desativado)
  const alteredTriggers = JSON.parse(JSON.stringify(postRev));
  alteredTriggers.catalogue_fingerprints.triggers = 'different_triggers_hash';
  const compTriggers = compareSnapshots(baseline, alteredTriggers);
  assert.equal(compTriggers.matches, false);
  assert.ok(compTriggers.differences.some(d => d.includes('catalogue_fingerprints.triggers divergiu')));

  // Funções alteradas
  const alteredFunctions = JSON.parse(JSON.stringify(postRev));
  alteredFunctions.catalogue_fingerprints.functions = 'different_functions_hash';
  const compFunctions = compareSnapshots(baseline, alteredFunctions);
  assert.equal(compFunctions.matches, false);
  assert.ok(compFunctions.differences.some(d => d.includes('catalogue_fingerprints.functions divergiu')));

  // Tabela de coordenação não eliminada pós-ensaio
  const coordResidual = JSON.parse(JSON.stringify(postRev));
  coordResidual.catalogue_fingerprints.has_coordination_table = true;
  const compCoord = compareSnapshots(baseline, coordResidual);
  assert.equal(compCoord.matches, false);
  assert.ok(compCoord.differences.some(d => d.includes('has_coordination_table divergiu')));

  // Dados de Auth alterados
  const authAltered = JSON.parse(JSON.stringify(postRev));
  authAltered.content_hashes.auth_users = 'different_auth_hash';
  const compAuth = compareSnapshots(baseline, authAltered);
  assert.equal(compAuth.matches, false);
  assert.ok(compAuth.differences.some(d => d.includes('content_hashes.auth_users divergiu')));
});

test('17. B1: Modo físico governa decisão com 014 real e exige execução dos scripts concorrentes A/B', async () => {
  const calls = [];
  const validIndicators = {};
  VERIFY_014_INDICATORS.forEach(ind => { validIndicators[ind] = true; });

  const spyTransport = {
    executeSql: async (sql) => {
      calls.push({ type: 'sql', snippet: sql.slice(0, 30) });
      return { success: true, output: '' };
    },
    executeFile: async (filePath) => {
      calls.push({ type: 'file', file: path.basename(filePath) });
      return { success: true, output: '' };
    },
    captureSnapshot: async () => {
      calls.push({ type: 'snapshot' });
      return createSimulatedBaselineSnapshot();
    },
    executeVerify014: async () => {
      calls.push({ type: 'verify_014' });
      return [validIndicators];
    },
    executeConcurrency: async ({ sessionAPath, sessionBPath }) => {
      calls.push({
        type: 'concurrency',
        fileA: path.basename(sessionAPath),
        fileB: path.basename(sessionBPath)
      });
      return {
        success: true,
        scenarios: ['c1a', 'c1b1', 'c1b2', 'c2', 'c3']
      };
    },
    close: async () => ({ confirmed: true })
  };

  const orchestrator = new RehearsalOrchestrator013({ dryRun: false, transport: spyTransport });
  const result = await orchestrator.runRehearsalPlan('all');

  assert.equal(result.success, true, `Plano falhou: ${result.error}`);
  assert.ok(calls.some(c => c.type === 'verify_014'), 'executeVerify014 DEVE ser chamado no transporte físico');
  assert.ok(calls.some(c => c.type === 'concurrency' && c.fileA.includes('session_a') && c.fileB.includes('session_b')),
    'executeConcurrency DEVE ser chamado com os scripts A e B');
});

test('18. B1: Verificação 014 com indicador FALSE ou NULL aborta execução antes de chegar à concorrência', async () => {
  const calls = [];
  const badIndicators = {};
  VERIFY_014_INDICATORS.forEach(ind => { badIndicators[ind] = true; });
  badIndicators['private_schema_still_blocked'] = false; // falha de segurança!

  const spyTransport = {
    executeSql: async (sql) => { calls.push({ type: 'sql' }); return { success: true }; },
    executeFile: async (filePath) => { calls.push({ type: 'file', file: path.basename(filePath) }); return { success: true }; },
    captureSnapshot: async () => { calls.push({ type: 'snapshot' }); return createSimulatedBaselineSnapshot(); },
    executeVerify014: async () => {
      calls.push({ type: 'verify_014' });
      return [badIndicators];
    },
    executeConcurrency: async () => {
      calls.push({ type: 'concurrency' });
      return { success: true, scenarios: ['c1a', 'c1b1', 'c1b2', 'c2', 'c3'] };
    }
  };

  const orchestrator = new RehearsalOrchestrator013({ dryRun: false, transport: spyTransport });
  const result = await orchestrator.runRehearsalPlan('all');

  assert.equal(result.success, false);
  assert.ok(result.error.includes('Verificação 014 falhou'));
  assert.equal(calls.some(c => c.type === 'concurrency'), false,
    'Concorrência NUNCA pode ser executada se 014 falhar!');
});

test('19. B1: Concorrência com cenário faltante ou falho bloqueia PASS', async () => {
  const validIndicators = {};
  VERIFY_014_INDICATORS.forEach(ind => { validIndicators[ind] = true; });

  const spyTransport = {
    executeSql: async () => ({ success: true }),
    executeFile: async () => ({ success: true }),
    captureSnapshot: async () => createSimulatedBaselineSnapshot(),
    executeVerify014: async () => [validIndicators],
    executeConcurrency: async () => {
      // Cenário c3 ausente!
      return { success: true, scenarios: ['c1a', 'c1b1', 'c1b2', 'c2'] };
    }
  };

  const orchestrator = new RehearsalOrchestrator013({ dryRun: false, transport: spyTransport });
  const result = await orchestrator.runRehearsalPlan('all');

  assert.equal(result.success, false);
  assert.ok(result.error.includes('Cenários de concorrência não comprovados: c3'));
});

test('20. B1: Transporte psql rejeita alvos, databases e portas não autorizados', () => {
  assert.throws(() => {
    const badTransport = new PsqlCommandTransport({ targetContainer: 'wrong_container' });
    badTransport.assertAuthorizedTarget();
  }, /ALVO NÃO AUTORIZADO/);

  assert.throws(() => {
    const badDb = new PsqlCommandTransport({ database: 'production_db' });
    badDb.assertAuthorizedTarget();
  }, /ALVO NÃO AUTORIZADO/);

  assert.throws(() => {
    const badPort = new PsqlCommandTransport({ targetPort: 5432 });
    badPort.assertAuthorizedTarget();
  }, /ALVO NÃO AUTORIZADO/);
});

test('21. B2: Rollback físico sem baseline real persistido ou sem propriedade comprovada produz ZERO mutações', async () => {
  const mutations = [];
  const transport = {
    executeSql: async (sql) => { mutations.push(sql); return { success: true }; },
    captureSnapshot: async () => createSimulatedBaselineSnapshot()
  };

  const orchestrator = new RehearsalOrchestrator013({ dryRun: false, transport });

  // 1. Rollback sem baselineSnapshot
  const resNoBaseline = await orchestrator.rollback();
  assert.equal(resNoBaseline.success, false);
  assert.ok(resNoBaseline.error.includes('requer baseline real persistido'));
  assert.equal(mutations.length, 0, 'Zero mutações permitidas sem baseline real persistido!');

  // 2. Rollback com baseline mas sem propriedade comprovada (nenhum objeto alterado por esta execução)
  const baseline = createSimulatedBaselineSnapshot();
  const resNoOwnership = await orchestrator.rollback({ baselineSnapshot: baseline });
  assert.equal(resNoOwnership.success, false);
  assert.ok(resNoOwnership.error.includes('propriedade das alterações'));
  assert.equal(mutations.length, 0, 'Zero mutações permitidas sem propriedade comprovada!');
});

test('22. B2: Falha pré-fixtures não executa deleção de fixtures por IDs fixos', async () => {
  const executedSqls = [];
  const transport = {
    executeSql: async (sql) => {
      executedSqls.push(sql);
      return { success: true };
    },
    executeFile: async (filePath) => {
      if (filePath.includes('013_member_lifecycle.sql')) {
        throw new Error('SIMULATED_INSTALL_ERROR: Syntax error or lock conflict');
      }
      return { success: true };
    },
    captureSnapshot: async () => createSimulatedBaselineSnapshot()
  };

  const orchestrator = new RehearsalOrchestrator013({ dryRun: false, transport });
  const planRes = await orchestrator.runRehearsalPlan('all');

  assert.equal(planRes.success, false);
  assert.ok(planRes.error.includes('SIMULATED_INSTALL_ERROR'));
  assert.equal(orchestrator.provenOwnership.installed013, false);
  assert.equal(orchestrator.provenOwnership.fixturesCreated, false);

  // Como falhou antes da instalação e antes de criar fixtures, NÃO pode deletar fixtures nem tentar reverter 013
  const deletedFixtures = executedSqls.some(sql => sql.includes('01300000-0000-4000-8000-000000000011'));
  assert.equal(deletedFixtures, false, 'Falha pré-fixtures não deve tentar apagar fixtures fixas!');
});

test('23. B3: Alteração de permissões (ACLs de schema/tabelas/funções ou policies) é rejeitada mesmo com contagens e dados iguais', () => {
  const baseline = createSimulatedBaselineSnapshot();
  const postRev = createSimulatedPostReversalSnapshot();

  // 1. Alteração de ACL de schema
  const alteredSchemaAcl = JSON.parse(JSON.stringify(postRev));
  alteredSchemaAcl.catalogue_fingerprints.schema_acls = 'different_schema_acls_md5';
  const compSchema = compareSnapshots(baseline, alteredSchemaAcl);
  assert.equal(compSchema.matches, false);
  assert.ok(compSchema.differences.some(d => d.includes('catalogue_fingerprints.schema_acls divergiu')));

  // 2. Alteração de ACL de tabela
  const alteredTableAcl = JSON.parse(JSON.stringify(postRev));
  alteredTableAcl.catalogue_fingerprints.table_acls = 'different_table_acls_md5';
  const compTable = compareSnapshots(baseline, alteredTableAcl);
  assert.equal(compTable.matches, false);
  assert.ok(compTable.differences.some(d => d.includes('catalogue_fingerprints.table_acls divergiu')));

  // 3. Alteração de ACL de função
  const alteredFuncAcl = JSON.parse(JSON.stringify(postRev));
  alteredFuncAcl.catalogue_fingerprints.function_acls = 'different_function_acls_md5';
  const compFunc = compareSnapshots(baseline, alteredFuncAcl);
  assert.equal(compFunc.matches, false);
  assert.ok(compFunc.differences.some(d => d.includes('catalogue_fingerprints.function_acls divergiu')));

  // 4. Alteração de RLS policies (USING, WITH CHECK, roles)
  const alteredRls = JSON.parse(JSON.stringify(postRev));
  alteredRls.catalogue_fingerprints.rls_policies = 'different_rls_policies_md5';
  const compRls = compareSnapshots(baseline, alteredRls);
  assert.equal(compRls.matches, false);
  assert.ok(compRls.differences.some(d => d.includes('catalogue_fingerprints.rls_policies divergiu')));
});

test('24. B4: Roteiro de navegador respeita administração única, is_admin e limpeza por manifesto exato', () => {
  const roteiroPath = path.join(rootDir, 'docs', 'ROTEIRO-NAVEGADOR-LOCAL-013.md');
  const content = fs.readFileSync(roteiroPath, 'utf8');

  // Não usar a coluna inexistente role em church_access
  assert.equal(content.includes("role = 'admin'") || content.includes("role='admin'"), false,
    'ROTEIRO-NAVEGADOR-LOCAL-013.md não deve usar a coluna inexistente role em church_access');

  // Respeito ao índice único de administração única
  assert.ok(content.includes('church_access_single_active_admin_idx'),
    'Roteiro deve referenciar e respeitar a trava church_access_single_active_admin_idx');
  assert.ok(content.includes('is_admin = true') && content.includes('is_admin = false'),
    'Roteiro deve especificar is_admin booleano para alternância de contexto');

  // Limpeza: audit_entries não tem user_id
  assert.equal(content.includes('audit_entries where church_id') && content.includes('user_id::text'), false,
    'audit_entries não possui coluna user_id');
  assert.ok(content.includes('target_id in'),
    'Limpeza de audit_entries deve utilizar target_id vinculado aos membros da jornada');

  // Limpeza de command_receipts não presume command_id com prefixo 013b%
  assert.equal(content.includes("command_id::text like '013b%'"), false,
    'Limpeza não deve presumir prefixo fixo em command_id gerado pelo navegador');
  assert.ok(content.includes('result_member_id in'),
    'Limpeza de command_receipts deve utilizar result_member_id');

  // Deleção de membros por manifesto exato (sem id between)
  assert.equal(content.toLowerCase().includes('id between'), false,
    'Deleção de membros no roteiro não deve usar id between genérico');
  assert.ok(content.includes('013b0000-0000-4000-8000-000000000012'),
    'Deleção deve conter lista explícita dos 12 membros do manifesto');

  // Distinção expressa entre igreja persistente e igreja efêmera
  assert.ok(content.includes('Igreja Efêmera') && content.includes('Igreja Persistente'),
    'Roteiro deve distinguir a igreja persistente da jornada de navegador da igreja efêmera do ensaio SQL');
});

test('25. C1: Retomada em nova instância/processo via journal atômico durável e recusa com zero mutações', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rehearsal-c1-journal-'));
  const journalPath = path.join(tempDir, '.rehearsal-013-journal.json');

  try {
    const executedSqls1 = [];
    const baseline = createSimulatedBaselineSnapshot();

    const transport1 = {
      executeSql: async (sql) => { executedSqls1.push(sql); return { success: true }; },
      executeFile: async () => ({ success: true }),
      captureSnapshot: async () => baseline,
      executeVerify014: async () => {
        const rows = {};
        VERIFY_014_INDICATORS.forEach(k => { rows[k] = true; });
        return [rows];
      }
    };

    // Processo 1: executa install-keep apontando para journal temporário
    const orchestrator1 = new RehearsalOrchestrator013({
      dryRun: false,
      transport: transport1,
      journalPath
    });

    const resInstallKeep = await orchestrator1.executePlan('install-keep');
    assert.equal(resInstallKeep.success, true);
    assert.equal(fs.existsSync(journalPath), true, 'Journal DEVE ser gravado atomicamente no disco');

    // Conferir dados duráveis do journal gravado
    const savedJournal = readJournal(journalPath);
    assert.equal(savedJournal.status, 'completed');
    assert.equal(savedJournal.provenOwnership.installed013, true);
    assert.equal(savedJournal.provenOwnership.fixturesCreated, false);
    assert.deepEqual(savedJournal.baselineSnapshot, baseline);

    // Processo 2: Nova instância isolada (simulando reinício de SO / nova CLI) carregando o mesmo journal
    const executedSqls2 = [];
    const postReversalSnap = createSimulatedPostReversalSnapshot();
    const transport2 = {
      executeSql: async (sql) => { executedSqls2.push(sql); return { success: true }; },
      captureSnapshot: async () => postReversalSnap,
      close: async () => ({ confirmed: true })
    };

    const orchestrator2 = new RehearsalOrchestrator013({
      dryRun: false,
      transport: transport2,
      journalPath
    });

    // Verifica que o baseline e propriedade foram herdados do arquivo, não da memória
    assert.deepEqual(orchestrator2.persistedBaselineSnapshot, baseline);
    assert.equal(orchestrator2.provenOwnership.installed013, true);

    const rollbackRes = await orchestrator2.rollback();
    assert.equal(rollbackRes.success, true);
    assert.ok(executedSqls2.some(sql => sql === EXACT_REVERSAL_013_SQL), '013 deve ser revertido');
    assert.equal(executedSqls2.some(sql => sql === EXACT_FIXTURE_CLEANUP_013_SQL), false,
      'Fixtures não devem ser apagadas pois fixturesCreated era false');

    const updatedJournal = readJournal(journalPath);
    assert.equal(updatedJournal.status, 'rolled_back');
    assert.equal(updatedJournal.provenOwnership.installed013, false);

    // Processo 3: Instância com journal incompatível (container divergente) e flags de propriedade preenchidas
    // Deve resultar em ZERO mutações em todas as rotas (rollback, executePlan, performRecovery), cleanupAttempted=false
    // e preservação do arquivo de journal no disco para investigação forense.
    const executedSqls3 = [];
    const transport3 = {
      executeSql: async (sql) => { executedSqls3.push(sql); return { success: true }; },
      captureSnapshot: async () => postReversalSnap
    };

    const invalidJournal = createInitialJournal();
    invalidJournal.target.container = 'different-container';
    invalidJournal.baselineSnapshot = baseline;
    invalidJournal.provenOwnership.baselineCaptured = true;
    invalidJournal.provenOwnership.installed013 = true;
    invalidJournal.provenOwnership.fixturesCreated = true;
    invalidJournal.provenOwnership.uncertainCommit = true;

    const badJournalPath = path.join(tempDir, 'incompatible-journal.json');
    writeJournal(badJournalPath, invalidJournal);

    const orchestrator3 = new RehearsalOrchestrator013({
      dryRun: false,
      transport: transport3,
      journalPath: badJournalPath
    });

    // 1. rollback()
    const badRes = await orchestrator3.rollback();
    assert.equal(badRes.success, false);
    assert.equal(badRes.cleanupAttempted, false, 'cleanupAttempted deve ser false em journal rejeitado');
    assert.ok(badRes.error.includes('inválido ou incompatível') || badRes.error.includes('Zero mutações'));
    assert.equal(executedSqls3.length, 0, 'rollback() com journal incompatível DEVE produzir ZERO mutações!');

    // 2. executePlan('all')
    const badPlanRes = await orchestrator3.executePlan('all');
    assert.equal(badPlanRes.success, false);
    assert.equal(badPlanRes.cleanupAttempted, false, 'cleanupAttempted no finally deve ser false em journal rejeitado');
    assert.equal(executedSqls3.length, 0, 'executePlan() com journal incompatível DEVE produzir ZERO mutações no try e finally!');

    // 3. performRecovery() direto
    const badRecRes = await orchestrator3.performRecovery();
    assert.equal(badRecRes.success, false);
    assert.equal(badRecRes.attempted, false);
    assert.equal(executedSqls3.length, 0, 'performRecovery() direto com journal incompatível DEVE produzir ZERO mutações!');

    // 4. Preservação do journal no disco intacto para investigação
    const diskJournal = readJournal(badJournalPath);
    assert.equal(diskJournal.target.container, 'different-container');
    assert.equal(diskJournal.provenOwnership.installed013, true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('26. C1: Falha após seed de fixtures sem edição manual do journal reconcilia resíduos por inspeção e recupera', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rehearsal-seed-fail-'));
  const journalPath = path.join(tempDir, '.rehearsal-013-journal.json');

  try {
    const baseline = createSimulatedBaselineSnapshot();
    let fixturesSeeded = false;
    const executedSqls1 = [];

    // Instância 1: Simula falha durante concorrência APÓS fixtures terem sido commitadas na sessão A
    const transport1 = {
      executeSql: async (sql) => {
        executedSqls1.push(sql);
        if (sql === EXACT_FIXTURE_CLEANUP_013_SQL) fixturesSeeded = false;
        return { success: true };
      },
      executeFile: async () => ({ success: true }),
      captureSnapshot: async () => {
        const snap = structuredClone(baseline);
        if (fixturesSeeded) {
          snap.row_counts.members += 1;
          snap.residual_fixtures_count = 1;
        }
        return snap;
      },
      executeVerify014: async () => {
        const rows = {};
        VERIFY_014_INDICATORS.forEach(k => { rows[k] = true; });
        return [rows];
      },
      executeConcurrency: async () => {
        fixturesSeeded = true; // Fixtures commitadas
        throw new Error('SIMULATED_POWER_LOSS_OR_CRASH: Concurrency run interrupted after fixtures committed');
      },
      close: async () => ({ confirmed: true })
    };

    const orchestrator1 = new RehearsalOrchestrator013({
      dryRun: false,
      transport: transport1,
      journalPath
    });

    const runRes = await orchestrator1.executePlan('all');
    assert.equal(runRes.success, false);
    assert.ok(runRes.error.includes('SIMULATED_POWER_LOSS_OR_CRASH'));

    // Recuperação cirúrgica no finally da própria execução sem edição manual:
    assert.equal(runRes.cleanupAttempted, true);
    assert.equal(runRes.cleanupSuccess, true);
    assert.ok(executedSqls1.includes(EXACT_FIXTURE_CLEANUP_013_SQL), 'Deve executar limpeza de fixtures');
    assert.ok(executedSqls1.includes(EXACT_REVERSAL_013_SQL), 'Deve executar reversão de 013');
    assert.equal(fixturesSeeded, false, 'Fixtures não devem permanecer');

    // Cenário de retomada em NOVO PROCESSO sem edição manual do journal:
    // Simula nova instância executando performRecovery a partir de journal de concorrência com resíduos no banco
    const tempDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'rehearsal-new-proc-'));
    const journalPath2 = path.join(tempDir2, '.rehearsal-013-journal.json');
    let fixturesSeeded2 = true;
    const executedSqls2 = [];

    const transport2 = {
      executeSql: async (sql) => {
        executedSqls2.push(sql);
        if (sql === EXACT_FIXTURE_CLEANUP_013_SQL) fixturesSeeded2 = false;
        return { success: true };
      },
      captureSnapshot: async () => {
        const snap = structuredClone(baseline);
        if (fixturesSeeded2) {
          snap.row_counts.members += 1;
          snap.residual_fixtures_count = 1;
        }
        return snap;
      },
      close: async () => ({ confirmed: true })
    };

    // Journal gravado pelo orquestrador antes da queda (com concurrencyAttempted registrado duravelmente)
    const initialInterruptedJournal = createInitialJournal();
    initialInterruptedJournal.baselineSnapshot = baseline;
    initialInterruptedJournal.provenOwnership.baselineCaptured = true;
    initialInterruptedJournal.provenOwnership.installed013 = true;
    initialInterruptedJournal.provenOwnership.concurrencyAttempted = true;
    initialInterruptedJournal.status = 'concurrency_rehearsal';
    writeJournal(journalPath2, initialInterruptedJournal);

    const orchestrator2 = new RehearsalOrchestrator013({
      dryRun: false,
      transport: transport2,
      journalPath: journalPath2
    });

    // Reconciliação automática por inspeção do snapshot — sem edição manual do journal:
    const recoveryRes = await orchestrator2.performRecovery();
    assert.equal(recoveryRes.success, true);
    assert.equal(recoveryRes.fixtureCleanupExecuted, true, 'Deve reconciliar por inspeção e limpar fixtures');
    assert.equal(recoveryRes.reversalExecuted, true, 'Deve reverter 013');
    assert.ok(executedSqls2.includes(EXACT_FIXTURE_CLEANUP_013_SQL));
    assert.ok(executedSqls2.includes(EXACT_REVERSAL_013_SQL));
    assert.equal(fixturesSeeded2, false);

    const journalAfter2 = readJournal(journalPath2);
    assert.equal(journalAfter2.status, 'rolled_back');
    assert.equal(journalAfter2.provenOwnership.fixturesCreated, false);
    assert.equal(journalAfter2.provenOwnership.installed013, false);
    fs.rmSync(tempDir2, { recursive: true, force: true });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('27. C2: Falha 014=false com transporte concreto não executa fixture cleanup e confere snapshot pós-reversão', async () => {
  const boundaryCalls = [];
  const baseline = createSimulatedBaselineSnapshot();
  const postSnap = createSimulatedPostReversalSnapshot();

  // Instanciar a classe concreta PsqlCommandTransport substituindo APENAS a fronteira _runProcess
  const concreteTransport = new PsqlCommandTransport();
  concreteTransport._runProcess = async (args = [], inputSql = '', options = {}) => {
    if (inputSql.includes('all_four_lifecycle_rpcs_present')) {
      boundaryCalls.push('verify014_false');
      const badIndicators = {};
      VERIFY_014_INDICATORS.forEach(k => { badIndicators[k] = true; });
      badIndicators['all_four_lifecycle_rpcs_present'] = false;
      return { stdout: JSON.stringify(badIndicators), stderr: '', code: 0 };
    }
    if (inputSql.includes('installed_013_rpcs_count')) {
      boundaryCalls.push('snapshot');
      const isPostReversal = boundaryCalls.includes('catalogue_reversal');
      return { stdout: JSON.stringify(isPostReversal ? postSnap : baseline), stderr: '', code: 0 };
    }
    if (inputSql.includes('pré-validação somente leitura')) {
      boundaryCalls.push('preflight');
      return { stdout: 'PREFLIGHT_OK', stderr: '', code: 0 };
    }
    if (inputSql.includes('ciclo de vida de membros')) {
      boundaryCalls.push('install013');
      return { stdout: 'INSTALL_013_OK', stderr: '', code: 0 };
    }
    if (inputSql === EXACT_FIXTURE_CLEANUP_013_SQL) {
      boundaryCalls.push('fixture_cleanup');
      return { stdout: 'CLEANUP_FIXTURES_OK', stderr: '', code: 0 };
    }
    if (inputSql === EXACT_REVERSAL_013_SQL) {
      boundaryCalls.push('catalogue_reversal');
      return { stdout: 'REVERSAL_013_OK', stderr: '', code: 0 };
    }
    return { stdout: '', stderr: '', code: 0 };
  };

  const orchestrator = new RehearsalOrchestrator013({
    dryRun: false,
    transport: concreteTransport
  });

  const planRes = await orchestrator.runRehearsalPlan('all');

  assert.equal(planRes.success, false);
  assert.ok(planRes.error.includes('Verificação 014 falhou'));
  assert.equal(orchestrator.provenOwnership.fixturesCreated, false, 'fixturesCreated deve ser false');
  assert.equal(orchestrator.provenOwnership.installed013, false, 'installed013 deve ser resetado após recuperação');

  // Contraprova C2 verificada: NÃO deve chamar fixture_cleanup!
  assert.equal(boundaryCalls.includes('fixture_cleanup'), false,
    'FALHA CRÍTICA C2: fixture_cleanup não pode ser solicitado quando fixturesCreated=false!');

  // Deve chamar catalogue_reversal
  assert.ok(boundaryCalls.includes('catalogue_reversal'), 'catalogue_reversal deve ser executado para reverter 013');

  // Snapshot pós-reversão deve ser solicitado e conferido
  const snapshotCalls = boundaryCalls.filter(c => c === 'snapshot');
  assert.ok(snapshotCalls.length >= 2, 'Deve solicitar snapshot inicial e snapshot pós-reversão');
  assert.equal(planRes.cleanupSuccess, true, 'cleanupSuccess deve ser true apenas com comparação aprovada');
  assert.equal(planRes.cleanupError, null);
});

test('28. C3: Concorrência com cancelamento mútuo e confirmação de encerramento das duas sessões', async () => {
  // Cenário 1: Sessão A falha imediatamente
  {
    const transport = new PsqlCommandTransport();
    let sessionBWasAborted = false;
    let sessionBStarted = false;

    transport._runProcess = async (args = [], inputSql = '', options = {}) => {
      const sessionId = options.sessionId;
      if (sessionId === 'session_a_013') {
        throw new Error('INJECTED_SESSION_A_IMMEDIATE_FAILURE');
      } else if (sessionId === 'session_b_013') {
        sessionBStarted = true;
        return new Promise((resolve, reject) => {
          if (options.signal) {
            options.signal.addEventListener('abort', () => {
              sessionBWasAborted = true;
              const err = new Error('Session B aborted');
              err.name = 'AbortError';
              reject(err);
            });
          }
        });
      }
      return { stdout: '', stderr: '', code: 0 };
    };

    let caughtErr = null;
    try {
      await transport.executeConcurrency({ staggerMs: 50 });
    } catch (e) {
      caughtErr = e;
    }

    assert.ok(caughtErr, 'executeConcurrency deve rejeitar em falha imediata de A');
    assert.ok(caughtErr.message.includes('INJECTED_SESSION_A_IMMEDIATE_FAILURE'));
    assert.equal(transport.activeSessions.size, 0, 'Zero sessões ativas permitidas após retorno');
  }

  // Cenário 2: Sessão A falha após Sessão B ter iniciado
  {
    const transport = new PsqlCommandTransport();
    let sessionBRunning = false;
    let sessionBSettled = false;

    transport._runProcess = async (args = [], inputSql = '', options = {}) => {
      const sessionId = options.sessionId;
      if (sessionId === 'session_a_013') {
        while (!sessionBRunning) {
          await new Promise(r => setTimeout(r, 10));
        }
        throw new Error('INJECTED_SESSION_A_FAILURE_AFTER_B_STARTED');
      } else if (sessionId === 'session_b_013') {
        sessionBRunning = true;
        return new Promise((resolve, reject) => {
          if (options.signal) {
            options.signal.addEventListener('abort', () => {
              sessionBRunning = false;
              sessionBSettled = true;
              const err = new Error('Session B aborted by cancellation signal');
              err.name = 'AbortError';
              reject(err);
            });
          }
        });
      }
      return { stdout: '', stderr: '', code: 0 };
    };

    let caughtErr = null;
    try {
      await transport.executeConcurrency({ staggerMs: 20 });
    } catch (e) {
      caughtErr = e;
    }

    assert.ok(caughtErr, 'executeConcurrency deve rejeitar');
    assert.ok(caughtErr.message.includes('INJECTED_SESSION_A_FAILURE_AFTER_B_STARTED'));
    assert.equal(sessionBSettled, true, 'Sessão B DEVE estar liquidada/encerrada antes do retorno!');
    assert.equal(sessionBRunning, false, 'Sessão B NÃO pode continuar em execução após retorno!');
    assert.equal(transport.activeSessions.size, 0, 'activeSessions deve estar vazio ao retornar');
  }

  // Cenário 3: Sessão B falha
  {
    const transport = new PsqlCommandTransport();
    let sessionARunning = false;
    let sessionASettled = false;

    transport._runProcess = async (args = [], inputSql = '', options = {}) => {
      const sessionId = options.sessionId;
      if (sessionId === 'session_a_013') {
        sessionARunning = true;
        return new Promise((resolve, reject) => {
          if (options.signal) {
            options.signal.addEventListener('abort', () => {
              sessionARunning = false;
              sessionASettled = true;
              const err = new Error('Session A aborted because sibling failed');
              err.name = 'AbortError';
              reject(err);
            });
          }
        });
      } else if (sessionId === 'session_b_013') {
        throw new Error('INJECTED_SESSION_B_FAILURE');
      }
      return { stdout: '', stderr: '', code: 0 };
    };

    let caughtErr = null;
    try {
      await transport.executeConcurrency({ staggerMs: 10 });
    } catch (e) {
      caughtErr = e;
    }

    assert.ok(caughtErr, 'executeConcurrency deve rejeitar em falha de B');
    assert.ok(caughtErr.message.includes('INJECTED_SESSION_B_FAILURE'));
    assert.equal(sessionASettled, true, 'Sessão A DEVE ser liquidada antes do retorno');
    assert.equal(sessionARunning, false, 'Sessão A NÃO pode permanecer executando');
    assert.equal(transport.activeSessions.size, 0);
  }

  // Cenário 4: Timeout cancela ambas as sessões
  {
    const transport = new PsqlCommandTransport({ timeoutMs: 100 });

    transport._runProcess = async (args = [], inputSql = '', options = {}) => {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const timeoutErr = new Error(`TIMEOUT (${options.timeoutMs}ms) excedido`);
          timeoutErr.name = 'TimeoutError';
          reject(timeoutErr);
        }, options.timeoutMs);

        if (options.signal) {
          options.signal.addEventListener('abort', () => {
            clearTimeout(timer);
            const err = new Error('Aborted by sibling timeout');
            err.name = 'AbortError';
            reject(err);
          });
        }
      });
    };

    let caughtErr = null;
    try {
      await transport.executeConcurrency({ staggerMs: 10 });
    } catch (e) {
      caughtErr = e;
    }

    assert.ok(caughtErr, 'Timeout deve lançar erro');
    assert.equal(transport.activeSessions.size, 0, 'Nenhuma sessão ativa deve restar após timeout');
  }
});

test('29. C1: Interrupção abrupta de subprocesso em fronteira externa persiste intenção e novo processo recupera sem edição manual', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rehearsal-crash-child-'));
  const journalPath = path.join(tempDir, 'crash-journal.json');
  const runnerPathUrl = `file:///${path.resolve(rootDir, 'tools/rehearsal-runner-013.js').replace(/\\/g, '/')}`;

  const childScript = `
    import * as runner from ${JSON.stringify(runnerPathUrl)};
    const baseline = runner.createSimulatedBaselineSnapshot();
    const transport = {
      executeFile: async p => {
        if (p.endsWith('013_member_lifecycle.sql')) {
          process.exit(77);
        }
        return { success: true };
      },
      captureSnapshot: async () => baseline,
      executeSql: async () => { throw new Error('Inesperado'); }
    };
    await new runner.RehearsalOrchestrator013({
      dryRun: false,
      transport,
      journalPath: ${JSON.stringify(journalPath)}
    }).executePlan('install-keep');
  `;

  try {
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', childScript], { encoding: 'utf8' });
    assert.equal(child.status, 77, `Filho deve encerrar abruptamente com código 77. stderr: ${child.stderr}`);

    // Verifica que o journal durável gravou a intenção antes da queda abrupta:
    const persisted = readJournal(journalPath);
    assert.ok(persisted, 'Journal deve ter sido gravado atomicamente');
    assert.equal(persisted.provenOwnership.uncertainCommit, true, 'uncertainCommit deve estar gravado no journal antes da queda');
    assert.equal(persisted.provenOwnership.installed013, false);
    assert.equal(persisted.status, 'installing_013');

    // Novo processo / instância limpa lê o journal exatamente como deixado em disco (sem edição manual!):
    const baseline = createSimulatedBaselineSnapshot();
    const recoveryCalls = [];
    const fresh = new RehearsalOrchestrator013({
      dryRun: false,
      journalPath,
      transport: {
        executeSql: async sql => {
          if (sql === EXACT_REVERSAL_013_SQL) recoveryCalls.push('catalogue_reversal');
          else if (sql === EXACT_FIXTURE_CLEANUP_013_SQL) recoveryCalls.push('fixture_cleanup');
          return { success: true };
        },
        captureSnapshot: async () => baseline,
        close: async () => ({ confirmed: true })
      }
    });

    const recResult = await fresh.rollback();
    assert.equal(recResult.success, true, 'Rollback em nova instância deve ter sucesso');
    assert.deepEqual(recoveryCalls, ['catalogue_reversal'], 'Deve reverter 013 e não tentar apagar fixtures inexistentes');

    const journalAfterRecovery = readJournal(journalPath);
    assert.equal(journalAfterRecovery.status, 'rolled_back');
    assert.equal(journalAfterRecovery.provenOwnership.uncertainCommit, false);
    assert.equal(journalAfterRecovery.provenOwnership.installed013, false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('30. C3: Término não confirmado de sessões no PostgreSQL bloqueia limpeza e preserva estado para investigação', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rehearsal-unconfirmed-term-'));
  const journalPath = path.join(tempDir, 'unconfirmed-journal.json');
  const baseline = createSimulatedBaselineSnapshot();
  const executedSqls = [];

  try {
    const transport = {
      executeFile: async () => ({ success: true }),
      executeVerify014: async () => {
        const rows = {};
        VERIFY_014_INDICATORS.forEach(k => { rows[k] = true; });
        return [rows];
      },
      executeConcurrency: async () => {
        throw new Error('SIMULATED_FAILURE_MID_RUN');
      },
      executeSql: async (sql) => {
        executedSqls.push(sql);
        return { success: true };
      },
      captureSnapshot: async () => baseline,
      close: async () => {
        // Simula cliente local encerrado mas verificação no PostgreSQL não pôde confirmar término do backend
        return {
          confirmed: false,
          error: 'Sessões backend ainda ativas no PostgreSQL: PID 9999 (application_name: rehearsal_013_session_a)'
        };
      }
    };

    const orchestrator = new RehearsalOrchestrator013({
      dryRun: false,
      transport,
      journalPath
    });

    const report = await orchestrator.executePlan('all');
    assert.equal(report.success, false);
    assert.equal(report.cleanupAttempted, false, 'cleanupAttempted DEVE ser false quando encerramento de sessões não foi confirmado!');
    assert.equal(report.cleanupSuccess, false);
    assert.ok(report.cleanupError.includes('Limpeza bloqueada: Sessões backend ainda ativas no PostgreSQL'));
    assert.ok(report.error.includes('Sessões backend ainda ativas no PostgreSQL'));

    // Nenhuma mutação de limpeza ou reversão pode ter sido enviada:
    assert.equal(executedSqls.length, 0, 'Zero mutações de limpeza permitidas quando encerramento do backend é incerto!');

    // Journal deve registrar estado não confirmado e preservar ownership para investigação forense:
    const persisted = readJournal(journalPath);
    assert.equal(persisted.status, 'unconfirmed_session_termination');
    assert.ok(persisted.error.includes('Sessões backend ainda ativas'));
    assert.equal(persisted.provenOwnership.installed013, true, 'Propriedade instalada deve ser preservada intacta');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('31. C3: PsqlCommandTransport executa comando de verificação e término no servidor via pg_stat_activity', async () => {
  const runId = 'test_run_31';
  const transport = new PsqlCommandTransport({ timeoutMs: 500, runId });
  const appName = `rehearsal_013_${runId}_session_a`;
  const backendStart = '2026-10-16 10:00:00+00';
  transport.recordSession({
    id: 'session_a',
    pid: 12345,
    backend_start: backendStart,
    application_name: appName
  });
  const processCalls = [];

  transport._runProcess = async (args = [], inputSql = '', options = {}) => {
    processCalls.push({ args, inputSql });
    // Primeira chamada: checkSql -> simula encontrar uma sessão ativa no servidor pertencente à execução
    if (processCalls.length === 1) {
      return { stdout: `12345|${appName}|${backendStart}`, stderr: '', code: 0 };
    }
    // Segunda chamada: termSql -> simula sucesso no terminate_backend
    if (processCalls.length === 2) {
      return { stdout: 't', stderr: '', code: 0 };
    }
    // Terceira chamada: recheck -> lista vazia (todas encerradas)
    if (processCalls.length === 3) {
      return { stdout: '', stderr: '', code: 0 };
    }
    return { stdout: '', stderr: '', code: 0 };
  };

  const res = await transport.confirmBackendSessionsClosed();
  assert.equal(res.confirmed, true);
  assert.equal(processCalls.length, 3, 'Deve ter feito check, terminate e recheck');

  // Verifica que os comandos contêm pg_stat_activity e pg_terminate_backend com escopo estrito
  assert.ok(processCalls[0].args.some(a => String(a).includes('pg_stat_activity')));
  assert.ok(processCalls[1].args.some(a => String(a).includes('pg_terminate_backend')));
  assert.ok(processCalls[1].args.some(a => String(a).includes(appName)));
  assert.ok(processCalls[2].args.some(a => String(a).includes('pg_stat_activity')));
});



