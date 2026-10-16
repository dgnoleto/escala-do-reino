import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

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
  runCli,
  CANONICAL_013_INSTALLER_SHA256,
  REHEARSAL_013_FIXTURE_MANIFEST,
  EXACT_FIXTURE_CLEANUP_013_SQL,
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
    close: async () => {}
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
