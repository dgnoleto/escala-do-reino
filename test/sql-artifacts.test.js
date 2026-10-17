import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  runChecks,
  testDemoFailures,
  loadManifest,
  CANONICAL_RPCS,
  CANONICAL_AUDIT_ACTIONS,
  CANONICAL_RECEIPT_ACTIONS,
  parseReturns,
  normalizeType
} from '../tools/verify-sql-011.js';
import { generateArtifacts } from '../tools/generate-sql-011.js';
import {
  PREFLIGHT_INDICATORS,
  VERIFY_012_INDICATORS,
  REQUIRED_DOMAIN_TABLES,
  validatePreflightResult,
  validateVerify012Result,
  validateRollbackIntegrity,
  validateDisposalTarget,
  validateSnapshotSchema,
  ConcurrencyCoordinator,
  MockSessionTransport,
  PsqlSessionTransport,
  RehearsalOrchestrator,
  getCanonicalConcurrencyScenarios,
  runCli,
  verifyCanonicalFiles
} from '../tools/rehearsal-runner.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

describe('Validação Estática e Proteção contra Recorrência (Incremento 011/012)', () => {

  test('1. Geração determinística e sincronismo bit-a-bit dos artefatos com a fonte única em src_011/', () => {
    const { installSql, validateSql } = generateArtifacts();
    const diskInstall = fs.readFileSync(path.join(rootDir, 'docs', 'sql', '011_invitations_and_requests.sql'), 'utf8').replace(/\r\n/g, '\n');
    const diskValidate = fs.readFileSync(path.join(rootDir, 'docs', 'sql', '011_validate_invitations.sql'), 'utf8').replace(/\r\n/g, '\n');

    assert.equal(diskInstall, installSql, '011_invitations_and_requests.sql deve ser idêntico à saída do gerador');
    assert.equal(diskValidate, validateSql, '011_validate_invitations.sql deve ser idêntico à saída do gerador');
  });

  test('2. Verificador estático integrado passa com zero erros e zero advertências na base válida', () => {
    const { errors, warnings } = runChecks({ silent: true });
    assert.equal(errors.length, 0, `Erros inesperados na base válida: ${errors.join('; ')}`);
    assert.equal(warnings.length, 0, `Avisos inesperados na base válida: ${warnings.join('; ')}`);
  });

  test('3. Manifesto JSON derivado no caminho real contém 9 RPCs, ações disjuntas e hashes de 000-010', () => {
    const manifest = loadManifest();
    assert.ok(manifest, 'Manifesto deve ser carregado');
    assert.equal((manifest.rpcs || []).length, 9, 'Manifesto deve definir exatamente 9 RPCs');

    // Assinaturas completas
    for (const rpc of manifest.rpcs) {
      assert.ok(rpc.name, 'RPC deve possuir nome');
      assert.ok(Array.isArray(rpc.parameters), `RPC ${rpc.name} deve ter lista de parâmetros`);
      assert.ok(typeof rpc.returns === 'string' && rpc.returns.length > 0, `RPC ${rpc.name} deve ter retorno definido`);
    }

    // Disjunção entre auditoria e recibos
    for (const auditAction of CANONICAL_AUDIT_ACTIONS) {
      assert.equal(
        CANONICAL_RECEIPT_ACTIONS.has(auditAction),
        false,
        `Ação "${auditAction}" não pode pertencer a auditoria e recibo ao mesmo tempo`
      );
    }

    // Constantes de injeção mapeadas corretamente
    const injectionConstants = manifest.injection_constants || {};
    assert.ok(Object.keys(injectionConstants).length >= 12, 'Deve mapear todas as constantes de auditoria e recibo');
    for (const [cName, cVal] of Object.entries(injectionConstants)) {
      if (cName.startsWith('c_audit_')) {
        assert.ok(CANONICAL_AUDIT_ACTIONS.has(cVal), `Constante ${cName} deve apontar para ação de auditoria válida`);
      }
      if (cName.startsWith('c_receipt_')) {
        assert.ok(CANONICAL_RECEIPT_ACTIONS.has(cVal), `Constante ${cName} deve apontar para ação de recibo válida`);
      }
    }

    // Hashes baseline para 000-010
    assert.ok(manifest.baseline_hashes, 'Manifesto deve conter hashes baseline');
    assert.ok(manifest.baseline_hashes['001_initial_access_structure.sql'], 'Hash de 001 obrigatório');
    assert.ok(manifest.baseline_hashes['010_verify_create_my_church.sql'], 'Hash de 010 obrigatório');
  });

  test('4. Contraprova: UUID inválido com caractere "g" e variações é rejeitado com código e diagnóstico', () => {
    const originalTests = fs.readFileSync(path.join(rootDir, 'docs', 'sql', 'src_011', '05_tests', '03_scenarios_11_to_20.sql'), 'utf8');

    // Variação 1: 'g' minúsculo
    const mutated1 = originalTests.replace(
      'v_u_approved uuid := gen_random_uuid();',
      "v_u_approved uuid := 'a0000000-0000-0000-0000-00000000000g'::uuid;"
    );
    const result1 = runChecks({
      silent: true,
      overrides: { '05_tests/03_scenarios_11_to_20.sql': mutated1 }
    });
    assert.ok(
      result1.errors.some(e => e.includes('não-hexadecimal inválido') && e.includes('a0000000-0000-0000-0000-00000000000g')),
      'Deve diagnosticar UUID com caractere g inválido'
    );

    // Variação 2: com espaços e 'G' maiúsculo
    const mutated2 = originalTests.replace(
      'v_u_approved uuid := gen_random_uuid();',
      "v_u_approved uuid :=   'B0000000-0000-0000-0000-00000000000G'::uuid  ;"
    );
    const result2 = runChecks({
      silent: true,
      overrides: { '05_tests/03_scenarios_11_to_20.sql': mutated2 }
    });
    assert.ok(
      result2.errors.some(e => e.includes('não-hexadecimal inválido')),
      'Deve diagnosticar UUID com caractere G maiúsculo'
    );
  });

  test('5. Contraprova: Assinatura de RPC com tipo divergente (p_command_id text) é rejeitada com diagnóstico', () => {
    const originalRpcs = fs.readFileSync(path.join(rootDir, 'docs', 'sql', 'src_011', '03_rpcs', '01_issue_church_invitation.sql'), 'utf8');

    // Variação com quebras de linha e múltiplos espaços
    const mutated = originalRpcs.replace(
      /p_command_id\s+uuid/i,
      '  p_command_id \n    text  '
    );
    const result = runChecks({
      silent: true,
      overrides: { '03_rpcs/01_issue_church_invitation.sql': mutated }
    });
    assert.ok(
      result.errors.some(e => e.includes('p_command_id') && e.includes("tipo incorreto 'text'")),
      'Deve detectar divergência no tipo do parâmetro da assinatura'
    );
  });

  test('6. Contraprova: SECURITY DEFINER ausente ou SECURITY INVOKER presente é detectado em diferentes posições', () => {
    // Caso A: Primeira RPC com security invoker
    const rpc1 = fs.readFileSync(path.join(rootDir, 'docs', 'sql', 'src_011', '03_rpcs', '01_issue_church_invitation.sql'), 'utf8');
    const mutatedRpc1 = rpc1.replace(/security\s+definer/i, 'security invoker');
    const resultA = runChecks({
      silent: true,
      overrides: { '03_rpcs/01_issue_church_invitation.sql': mutatedRpc1 }
    });
    assert.ok(
      resultA.errors.some(e => e.includes('SECURITY INVOKER') || e.includes('SECURITY DEFINER')),
      'Deve rejeitar security invoker na primeira RPC'
    );

    // Caso B: RPC intermediária (decide_access_request) sem security definer
    const rpcDecide = fs.readFileSync(path.join(rootDir, 'docs', 'sql', 'src_011', '03_rpcs', '08_decide_access_request.sql'), 'utf8');
    const mutatedRpcDecide = rpcDecide.replace(/security\s+definer/i, '');
    const resultB = runChecks({
      silent: true,
      overrides: { '03_rpcs/08_decide_access_request.sql': mutatedRpcDecide }
    });
    assert.ok(
      resultB.errors.some(e => e.includes('decide_access_request') && e.includes('SECURITY DEFINER')),
      'Deve rejeitar ausência de security definer em RPC intermediária'
    );
  });

  test('7. Contraprova: Ausência de search_path ou statement_timeout em RPC intermediária é detectada', () => {
    const rpcAccept = fs.readFileSync(path.join(rootDir, 'docs', 'sql', 'src_011', '03_rpcs', '03_redeem_invitation_confirm_name.sql'), 'utf8');

    // Remover search_path
    const mutatedNoSearchPath = rpcAccept.replace(/set\s+search_path\s*=\s*''/i, '');
    const resultNoSearchPath = runChecks({
      silent: true,
      overrides: { '03_rpcs/03_redeem_invitation_confirm_name.sql': mutatedNoSearchPath }
    });
    assert.ok(
      resultNoSearchPath.errors.some(e => e.includes('redeem_invitation_confirm_name') && e.includes("search_path = ''")),
      'Deve detectar ausência de search_path'
    );

    // Remover statement_timeout
    const mutatedNoTimeout = rpcAccept.replace(/set\s+statement_timeout\s*=\s*'5s'/i, '');
    const resultNoTimeout = runChecks({
      silent: true,
      overrides: { '03_rpcs/03_redeem_invitation_confirm_name.sql': mutatedNoTimeout }
    });
    assert.ok(
      resultNoTimeout.errors.some(e => e.includes('redeem_invitation_confirm_name') && e.includes("statement_timeout = '5s'")),
      'Deve detectar ausência de statement_timeout'
    );
  });

  test('8. Contraprova: Transação interna ilegal (COMMIT; ou ROLLBACK;) dentro de RPC é rejeitada', () => {
    const rpcCancel = fs.readFileSync(path.join(rootDir, 'docs', 'sql', 'src_011', '03_rpcs', '08_decide_access_request.sql'), 'utf8');

    // Injetar commit;
    const mutatedCommit = rpcCancel.replace('begin', 'begin\n  commit;\n');
    const resultCommit = runChecks({
      silent: true,
      overrides: { '03_rpcs/08_decide_access_request.sql': mutatedCommit }
    });
    assert.ok(
      resultCommit.errors.some(e => e.includes('decide_access_request') && e.includes('COMMIT')),
      'Deve rejeitar comando COMMIT no corpo da função'
    );

    // Injetar rollback;
    const mutatedRollback = rpcCancel.replace('begin', 'begin\n  rollback;\n');
    const resultRollback = runChecks({
      silent: true,
      overrides: { '03_rpcs/08_decide_access_request.sql': mutatedRollback }
    });
    assert.ok(
      resultRollback.errors.some(e => e.includes('decide_access_request') && e.includes('ROLLBACK')),
      'Deve rejeitar comando ROLLBACK no corpo da função'
    );
  });

  test('9. Contraprova: Constante divergente de ação (c_audit_approve) é rejeitada pelo verificador', () => {
    const preamble = fs.readFileSync(path.join(rootDir, 'docs', 'sql', 'src_011', '05_tests', '01_fixtures_helpers.sql'), 'utf8');
    const mutated = preamble.replace(
      "c_audit_approve constant text := 'approve_access_request';",
      "c_audit_approve constant text := 'decide_access_request_approve';"
    );
    const result = runChecks({
      silent: true,
      overrides: { '05_tests/01_fixtures_helpers.sql': mutated }
    });
    assert.ok(
      result.errors.some(e => e.includes('c_audit_approve') && e.includes('decide_access_request_approve')),
      'Deve rejeitar valor de constante divergente do manifesto'
    );
  });

  test('10. Contraprova: Ação divergente somente no manifesto JSON é detectada e rejeitada', () => {
    const originalManifest = fs.readFileSync(path.join(rootDir, 'docs', 'sql', 'src_011', '00_actions_manifest.json'), 'utf8');
    const mutatedManifest = originalManifest.replace('"approve_access_request"', '"approve_access_divergent_action"');
    const result = runChecks({
      silent: true,
      overrides: { 'docs/sql/src_011/00_actions_manifest.json': mutatedManifest }
    });
    assert.ok(
      result.errors.some(e => e.includes('Ação de auditoria não-canônica') || e.includes('c_audit_approve')),
      'Deve detectar divergência entre ação no manifesto e implementação/constante'
    );
  });

  test('11. Contraprova: Fixture com submissão posterior ao vencimento (+73h > +72h) é rejeitada por invariante', () => {
    const originalTests = fs.readFileSync(path.join(rootDir, 'docs', 'sql', 'src_011', '05_tests', '03_scenarios_11_to_20.sql'), 'utf8');
    const mutatedTests = originalTests.replace(
      "v_t_app + interval '1 hour', v_t_app + interval '72 hours',",
      "v_t_app + interval '73 hours', v_t_app + interval '72 hours',"
    );
    const result = runChecks({
      silent: true,
      overrides: { '05_tests/03_scenarios_11_to_20.sql': mutatedTests }
    });
    assert.ok(
      result.errors.some(e => e.includes('submitted_at') && e.includes('posterior ou igual a expires_at')),
      'Deve rejeitar submissão posterior ao vencimento na preparação de fixtures'
    );
  });

  test('12. Contraprova: Modificação não autorizada em 001_initial_access_structure.sql detectada via hash baseline', () => {
    const original001 = fs.readFileSync(path.join(rootDir, 'docs', 'sql', '001_initial_access_structure.sql'), 'utf8');
    const mutated001 = original001 + '\n-- alteracao deliberada de teste para violar integridade';
    const result = runChecks({
      silent: true,
      overrides: { 'docs/sql/001_initial_access_structure.sql': mutated001 }
    });
    assert.ok(
      result.errors.some(e => e.includes('001_initial_access_structure.sql foi modificado ou corrompido! Hash SHA-256 divergente')),
      'Deve detectar e rejeitar qualquer alteração em arquivos anteriores 000-010'
    );
  });

  test('13. Contraprova: Referência a coluna inexistente em schema conhecido é rejeitada', () => {
    const originalTests = fs.readFileSync(path.join(rootDir, 'docs', 'sql', 'src_011', '05_tests', '03_scenarios_11_to_20.sql'), 'utf8');
    const mutatedTests = originalTests.replace(
      /insert\s+into\s+app_private\.access_requests\s*\(/i,
      'insert into app_private.access_requests (non_existent_column, '
    );
    const result = runChecks({
      silent: true,
      overrides: { '05_tests/03_scenarios_11_to_20.sql': mutatedTests }
    });
    assert.ok(
      result.errors.some(e => e.includes('non_existent_column') && e.includes('app_private.access_requests')),
      'Deve rejeitar colunas inexistentes contra o catálogo conhecido'
    );
  });

  test('14. Contraprova: Bloco PL/pgSQL desbalanceado (begin sem end;) é rejeitado pelo analisador sintático', () => {
    const originalTests = fs.readFileSync(path.join(rootDir, 'docs', 'sql', 'src_011', '05_tests', '03_scenarios_11_to_20.sql'), 'utf8');
    const mutatedTests = originalTests.replace(
      "-- 11.2:",
      "-- 11.2:\n  begin\n"
    );
    const result = runChecks({
      silent: true,
      overrides: { '05_tests/03_scenarios_11_to_20.sql': mutatedTests }
    });
    assert.ok(
      result.errors.some(e => e.includes('está desbalanceado')),
      'Deve detectar desequilíbrio entre BEGIN e END;'
    );
  });

  test('15. Contraprova: Desatualização entre fontes em src_011/ e derivados em disco é detectada', () => {
    // Simula que o arquivo em disco foi adulterado sem regenerar as fontes
    const result = runChecks({
      silent: true,
      overrides: {
        'docs/sql/011_invitations_and_requests.sql': '-- arquivo obsoleto em disco'
      }
    });
    assert.ok(
      result.errors.some(e => e.includes('011_invitations_and_requests.sql não corresponde à geração determinística')),
      'Deve rejeitar artefato derivado desatualizado'
    );
  });

  test('16. Suíte de demonstração testDemoFailures() executa todas as 8 contraprovas com sucesso', () => {
    assert.doesNotThrow(() => {
      testDemoFailures();
    }, 'testDemoFailures() deve rodar todas as contraprovas sem lançar exceções');
  });

  test('17. Coordenação de concorrência em C4 e script de laboratório possuem guardas de segurança', () => {
    const sessionA = fs.readFileSync(path.join(rootDir, 'docs', 'sql', 'concurrency', '011_concurrency_session_a.sql'), 'utf8');
    assert.ok(sessionA.includes('v_t0 timestamptz := clock_timestamp()'), 'C4 deve capturar instante único');
    assert.ok(sessionA.includes('v_exp timestamptz := v_t0 + interval \'72 hours\''), 'C4 deve derivar 72h exatas');
    assert.ok(sessionA.includes('do $assert_c4_waiting$'), 'C4 deve conter asserção ativa de espera');
    assert.ok(sessionA.includes('do $assert_c4_expired$'), 'C4 deve conter asserção ativa pós-desbloqueio');
    assert.ok(sessionA.includes("current_database() <> 'escala_rehearsal_tmp'"), 'Descarte deve possuir guarda restrita ao banco escala_rehearsal_tmp');
  });

  test('18. Contraprova (Entrega 1): Tipo de retorno alterado em returns table é rejeitado pelo motor real com artefatos sincronizados (cenário Codex)', () => {
    const origRpc = fs.readFileSync(path.join(rootDir, 'docs', 'sql', 'src_011', '03_rpcs', '01_issue_church_invitation.sql'), 'utf8');
    const mutatedRpc = origRpc.replace('invitation_id uuid,', 'invitation_id text,');

    // Reprodução exata da contraprova do Codex: artefatos são regenerados fisicamente ou via overrides
    const { installSql, validateSql } = generateArtifacts({
      overrides: { '03_rpcs/01_issue_church_invitation.sql': mutatedRpc }
    });

    const result = runChecks({
      silent: true,
      overrides: {
        '03_rpcs/01_issue_church_invitation.sql': mutatedRpc,
        'docs/sql/011_invitations_and_requests.sql': installSql,
        'docs/sql/011_validate_invitations.sql': validateSql
      }
    });

    // Sincronismo passou, mas a conferência de retorno DEVE falhar
    assert.ok(
      result.errors.some(e => e.includes('RPC issue_church_invitation') && e.includes("coluna de retorno 'invitation_id' com tipo incorreto 'text' (esperado 'uuid')")),
      'Deve diagnosticar tipo de coluna de retorno incorreto com mensagem canônica'
    );
  });

  test('19. Contraprova (Entrega 1): Coluna ausente em returns table é rejeitada com diagnóstico de contagem e nome', () => {
    const origRpc = fs.readFileSync(path.join(rootDir, 'docs', 'sql', 'src_011', '03_rpcs', '01_issue_church_invitation.sql'), 'utf8').replace(/\r\n/g, '\n');
    const mutatedRpc = origRpc.replace(',\n  previous_request_cancelled boolean', '');

    const { installSql, validateSql } = generateArtifacts({
      overrides: { '03_rpcs/01_issue_church_invitation.sql': mutatedRpc }
    });

    const result = runChecks({
      silent: true,
      overrides: {
        '03_rpcs/01_issue_church_invitation.sql': mutatedRpc,
        'docs/sql/011_invitations_and_requests.sql': installSql,
        'docs/sql/011_validate_invitations.sql': validateSql
      }
    });

    assert.ok(
      result.errors.some(e => e.includes('RPC issue_church_invitation') && e.includes('quantidade de colunas de retorno divergente (esperado 9, encontrado 8)')),
      'Deve detectar divergência na contagem de colunas'
    );
    assert.ok(
      result.errors.some(e => e.includes("coluna de retorno ausente: 'previous_request_cancelled' (boolean)")),
      'Deve diagnosticar o nome exato da coluna de retorno ausente'
    );
  });

  test('20. Contraprova (Entrega 1): Ordem ou nomes divergentes de colunas em returns table são rejeitados', () => {
    const origRpc = fs.readFileSync(path.join(rootDir, 'docs', 'sql', 'src_011', '03_rpcs', '01_issue_church_invitation.sql'), 'utf8').replace(/\r\n/g, '\n');
    // Inverter church_id e member_id
    const mutatedRpc = origRpc.replace(
      'church_id uuid,\n  member_id uuid,',
      'member_id uuid,\n  church_id uuid,'
    );

    const { installSql, validateSql } = generateArtifacts({
      overrides: { '03_rpcs/01_issue_church_invitation.sql': mutatedRpc }
    });

    const result = runChecks({
      silent: true,
      overrides: {
        '03_rpcs/01_issue_church_invitation.sql': mutatedRpc,
        'docs/sql/011_invitations_and_requests.sql': installSql,
        'docs/sql/011_validate_invitations.sql': validateSql
      }
    });

    assert.ok(
      result.errors.some(e => e.includes('coluna de retorno 2 com nome divergente \'member_id\' (esperado \'church_id\')')),
      'Deve detectar coluna 2 fora de ordem'
    );
    assert.ok(
      result.errors.some(e => e.includes('coluna de retorno 3 com nome divergente \'church_id\' (esperado \'member_id\')')),
      'Deve detectar coluna 3 fora de ordem'
    );
  });

  test('21. Validação (Entrega 1): Normalização de tipos e espaços suportados em returns table e rejeição de formato', () => {
    // 1. Normalização de sinônimos aceita
    assert.equal(normalizeType('timestamp with time zone'), 'timestamptz');
    assert.equal(normalizeType('integer'), 'integer');
    assert.equal(normalizeType('int4'), 'integer');
    assert.equal(normalizeType('bigint'), 'bigint');
    assert.equal(normalizeType('int8'), 'bigint');
    assert.equal(normalizeType('boolean'), 'boolean');
    assert.equal(normalizeType('bool'), 'boolean');

    // Substituir timestamptz por "timestamp with time zone" na fonte única
    const origRpc = fs.readFileSync(path.join(rootDir, 'docs', 'sql', 'src_011', '03_rpcs', '01_issue_church_invitation.sql'), 'utf8');
    const mutatedRpc = origRpc.replace('expires_at timestamptz,', 'expires_at timestamp with time zone,');

    const { installSql, validateSql } = generateArtifacts({
      overrides: { '03_rpcs/01_issue_church_invitation.sql': mutatedRpc }
    });

    const resultSynonym = runChecks({
      silent: true,
      overrides: {
        '03_rpcs/01_issue_church_invitation.sql': mutatedRpc,
        'docs/sql/011_invitations_and_requests.sql': installSql,
        'docs/sql/011_validate_invitations.sql': validateSql
      }
    });
    assert.equal(resultSynonym.errors.length, 0, 'Sinônimo válido "timestamp with time zone" deve ser normalizado com sucesso');

    // 2. Rejeição de formato escalar vs table
    const mutatedScalar = origRpc.replace(/returns\s+table\s*\([\s\S]*?\)\s*language/i, 'returns uuid\nlanguage');
    const { installSql: installScalar } = generateArtifacts({
      overrides: { '03_rpcs/01_issue_church_invitation.sql': mutatedScalar }
    });
    const resultScalar = runChecks({
      silent: true,
      overrides: {
        '03_rpcs/01_issue_church_invitation.sql': mutatedScalar,
        'docs/sql/011_invitations_and_requests.sql': installScalar
      }
    });
    assert.ok(
      resultScalar.errors.some(e => e.includes('formato de retorno divergente (esperado \'table\', encontrado \'scalar\')')),
      'Deve diagnosticar divergência no formato de retorno'
    );
  });

  test('22. Validação (Entrega 2.A): Script canônico de bootstrap cobre todos os objetos necessários sem passos fictícios', () => {
    const bootstrapSql = fs.readFileSync(path.join(rootDir, 'docs', 'sql', 'bootstrap_lab_environment.sql'), 'utf8');

    // pgcrypto
    assert.ok(bootstrapSql.includes('create extension if not exists pgcrypto;'), 'Extensão pgcrypto deve ser criada');

    // papéis anon, authenticated, service_role
    assert.ok(bootstrapSql.includes("'anon'"), 'Papel anon obrigatório');
    assert.ok(bootstrapSql.includes("'authenticated'"), 'Papel authenticated obrigatório');
    assert.ok(bootstrapSql.includes("'service_role'"), 'Papel service_role obrigatório');

    // schema auth e tabela auth.users com todas as 8 colunas necessárias
    assert.ok(bootstrapSql.includes('create schema if not exists auth;'), 'Schema auth obrigatório');
    assert.ok(bootstrapSql.includes('email_confirmed_at timestamptz'), 'auth.users.email_confirmed_at obrigatório');
    assert.ok(bootstrapSql.includes('deleted_at timestamptz'), 'auth.users.deleted_at obrigatório');
    assert.ok(bootstrapSql.includes('banned_until timestamptz'), 'auth.users.banned_until obrigatório');
    assert.ok(bootstrapSql.includes('is_anonymous boolean'), 'auth.users.is_anonymous obrigatório');

    // auth.uid() e grants
    assert.ok(bootstrapSql.includes('create or replace function auth.uid()'), 'auth.uid() obrigatória');
    assert.ok(bootstrapSql.includes('grant usage on schema auth to anon, authenticated, service_role;'), 'Grants no schema auth obrigatórios');
    assert.ok(bootstrapSql.includes('grant select on auth.users to anon, authenticated, service_role;'), 'Grants em auth.users obrigatórios');

    // Declaração de escopo expressa
    assert.ok(
      bootstrapSql.includes('MAS NÃO VALIDA O SERVIÇO HTTP/REDE SUPABASE AUTH'),
      'Deve declarar explicitamente que não valida o serviço de rede GoTrue/Supabase Auth'
    );
  });

  test('23. Validação (Entrega 2.B): Decisão do executor de preflight consome os 11 indicadores reais de 011', () => {
    const allTrueRow = {};
    for (const ind of PREFLIGHT_INDICATORS) {
      allTrueRow[ind] = true;
    }

    // Caso A: 11 indicadores TRUE completos -> aprova
    const resA = validatePreflightResult([allTrueRow]);
    assert.equal(resA.success, true, 'Preflight com 11 TRUEs deve passar');
    assert.equal(resA.errors.length, 0);

    // Caso B: Um indicador FALSE -> rejeita com diagnóstico
    const rowFalse = { ...allTrueRow, crypto_primitives_available: false };
    const resB = validatePreflightResult([rowFalse]);
    assert.equal(resB.success, false, 'Preflight com indicador FALSE deve falhar');
    assert.ok(resB.errors.some(e => e.includes('crypto_primitives_available') && e.includes('FALSE')));

    // Caso C: Indicador NULL -> rejeita com diagnóstico
    const rowNull = { ...allTrueRow, server_and_client_utf8: null };
    const resC = validatePreflightResult([rowNull]);
    assert.equal(resC.success, false, 'Preflight com indicador NULL deve falhar');
    assert.ok(resC.errors.some(e => e.includes('server_and_client_utf8') && e.includes('NULL')));

    // Caso D: Coluna ausente -> rejeita com diagnóstico
    const rowMissing = { ...allTrueRow };
    delete rowMissing.new_nine_rpcs_not_yet_installed;
    const resD = validatePreflightResult([rowMissing]);
    assert.equal(resD.success, false, 'Preflight com coluna ausente deve falhar');
    assert.ok(resD.errors.some(e => e.includes('new_nine_rpcs_not_yet_installed') && e.includes('ausente')));

    // Caso E: Quantidade de linhas incorreta (0 ou 2) -> rejeita
    assert.equal(validatePreflightResult([]).success, false, 'Zero linhas deve falhar');
    assert.equal(validatePreflightResult([allTrueRow, allTrueRow]).success, false, 'Múltiplas linhas deve falhar');

    // Caso F: Saída inválida / erro de processo -> rejeita
    assert.equal(validatePreflightResult('ERROR: relation does not exist').success, false, 'Erro de SQL deve falhar');
  });

  test('24. Validação (Entrega 2.B): Decisão do executor de 012 e verificação de resíduos pós-ROLLBACK', () => {
    // 1. Verificador de 012
    const allTrue012 = {};
    for (const ind of VERIFY_012_INDICATORS) {
      allTrue012[ind] = true;
    }
    const res012 = validateVerify012Result([allTrue012]);
    assert.equal(res012.success, true, '012 com todos os indicadores deve passar');

    const false012 = { ...allTrue012, all_nine_rpcs_hardened: false };
    const resFalse012 = validateVerify012Result([false012]);
    assert.equal(resFalse012.success, false, '012 com FALSE deve falhar');

    // 2. Verificador de integridade pós-ROLLBACK contra baseline
    const baseline = {
      installed_011_rpcs_count: 0,
      command_receipts_has_result_entity_id: false,
      command_receipts_has_result_payload: false,
      command_receipts_has_payload_check: false,
      app_private_client_permissions_count: 0,
      row_counts: {
        churches: 2,
        members: 4,
        church_access: 2,
        access_invitations: 0,
        access_requests: 0,
        audit_entries: 0,
        command_receipts: 0,
        auth_users: 3
      }
    };
    const cleanPostRollback = JSON.parse(JSON.stringify(baseline));
    const resRollbackOk = validateRollbackIntegrity(baseline, cleanPostRollback);
    assert.equal(resRollbackOk.success, true, 'Rollback limpo deve passar na validação de resíduos');

    // Resíduo de RPC instalada
    const dirtyRpc = { ...cleanPostRollback, installed_011_rpcs_count: 1 };
    assert.equal(validateRollbackIntegrity(baseline, dirtyRpc).success, false, 'RPC residual deve ser detectada');

    // Resíduo de coluna em receipts
    const dirtyCol = { ...cleanPostRollback, command_receipts_has_result_entity_id: true };
    assert.equal(validateRollbackIntegrity(baseline, dirtyCol).success, false, 'Coluna residual deve ser detectada');

    // Resíduo de linhas em tabelas
    const dirtyRows = { ...cleanPostRollback, row_counts: { ...cleanPostRollback.row_counts, members: 5 } };
    assert.equal(validateRollbackIntegrity(baseline, dirtyRows).success, false, 'Linhas residuais devem ser detectadas');
  });

  test('25. Validação (Entrega 2.C): Correção do contrato C1 e proibição de ler link_unrecoverable de issue_church_invitation', () => {
    const sessionB = fs.readFileSync(path.join(rootDir, 'docs', 'sql', 'concurrency', '011_concurrency_session_b.sql'), 'utf8');

    // Verifica que NÃO acessa v_rec.link_unrecoverable
    assert.ok(!sessionB.includes('v_rec.link_unrecoverable'), 'v_rec de issue_church_invitation NÃO deve acessar link_unrecoverable');

    // Verifica que consulta get_invitation_command_receipt para aferir link_unrecoverable
    assert.ok(sessionB.includes('public.get_invitation_command_receipt'), 'Deve consultar get_invitation_command_receipt para conferir recibo');
    assert.ok(sessionB.includes('v_receipt.link_unrecoverable'), 'v_receipt deve conferir link_unrecoverable');

    // Confere contra o manifesto oficial
    const manifest = loadManifest();
    const issueRpc = manifest.rpcs.find(r => r.name === 'issue_church_invitation');
    const receiptRpc = manifest.rpcs.find(r => r.name === 'get_invitation_command_receipt');

    assert.ok(!issueRpc.returns.includes('link_unrecoverable'), 'Manifesto de issue_church_invitation não contém link_unrecoverable');
    assert.ok(receiptRpc.returns.includes('link_unrecoverable boolean'), 'Manifesto de get_invitation_command_receipt contém link_unrecoverable boolean');
  });

  test('26. Validação (Entrega 2.C): Coordenador de concorrência com sessões simuladas — sequência obrigatória e rejeição de anomalias', async () => {
    const coordinator = new ConcurrencyCoordinator({ runId: 'test_coord_01' });

    // Sessões simuladas com PIDs distintos
    const mockSessionA = { pid: 101 };
    const mockSessionB = { pid: 202 };
    coordinator.registerSessions(mockSessionA, mockSessionB);

    // 1. Cenário normal bem-sucedido (C1 a C3)
    let aLockHeld = false;
    let bWaitingDetected = false;

    const normalDefinition = {
      async holdLocksA(sessA, bPid) {
        aLockHeld = true;
        return { success: true };
      },
      async dispatchRpcB(sessB) {
        if (!aLockHeld) throw new Error('B adiantada: RPC disparada antes do lock de A!');
        return { success: true, invitation_id: '00000000-0000-0000-0000-0000000000e1', raw_token_null: true, link_unrecoverable: true };
      },
      async confirmWaitingA(sessA, bPid) {
        bWaitingDetected = true;
        return { success: true };
      },
      async releaseA(sessA) {
        aLockHeld = false;
      },
      validateOutcomeB(result) {
        return { success: result.raw_token_null && result.link_unrecoverable };
      },
      async verifyFinalStateA(sessA) {
        return { success: true };
      }
    };

    const resNormal = await coordinator.runScenario('c1', normalDefinition);
    assert.equal(resNormal.success, true, 'Execução coordenada válida deve suceder');

    // 2. Anomalia: B adiantada (falha de protocolo se B for invocada antes dos locks de A)
    const earlyBDefinition = {
      ...normalDefinition,
      async holdLocksA() {
        return { success: false, error: 'A não conseguiu obter o lock' };
      }
    };
    await assert.rejects(
      coordinator.runScenario('c1_early', earlyBDefinition),
      /Falha ao reter locks na Conexão A/,
      'Coordenador deve rejeitar avanço quando A não retém o lock'
    );

    // 3. Anomalia: Timeout de espera de B (B não entra na fila)
    const timeoutDefinition = {
      ...normalDefinition,
      async confirmWaitingA() {
        return { success: false, error: 'TIMEOUT esperando PID 202 entrar em bloqueio' };
      }
    };
    await assert.rejects(
      coordinator.runScenario('c1_timeout', timeoutDefinition),
      /Conexão B não entrou em espera/,
      'Coordenador deve abortar ensaio em timeout de bloqueio'
    );

    // 4. Anomalia: Janela perdida em C4 (B entra pós-expiração)
    const now = Date.now();
    const missedWindowC4 = {
      ...normalDefinition,
      expiresAt: now - 100, // Já expirado
      async confirmWaitingA() {
        return { success: true, waitStartedAt: now }; // Bloqueio detectado pós-expiração
      }
    };
    await assert.rejects(
      coordinator.runScenario('c4', missedWindowC4),
      /JANELA PERDIDA/,
      'C4 deve abortar se Conexão B não estiver na fila comprovadamente antes da expiração'
    );
  });

  test('27. Validação (Entrega 2.D): Descarte integral exclusivo e ausência de cleanup parcial por DML', () => {
    // 1. Guardas do alvo de descarte
    const validTarget = {
      host: '127.0.0.1',
      port: 5432,
      database: 'escala_rehearsal_tmp',
      user: 'postgres',
      runId: 'rehearsal_20261009'
    };
    assert.equal(validateDisposalTarget(validTarget).valid, true, 'Alvo explícito escala_rehearsal_tmp deve ser aceito');

    const invalidDbTarget = { ...validTarget, database: 'escala_prod' };
    assert.equal(validateDisposalTarget(invalidDbTarget).valid, false, 'Alvo prod deve ser rejeitado');

    const pilotTarget = { ...validTarget, database: 'jvpctgqudvjealzileib' };
    assert.equal(validateDisposalTarget(pilotTarget).valid, false, 'Piloto remoto deve ser rejeitado');

    // 2. Confirmação de ausência de DML cleanup em session A
    const sessionA = fs.readFileSync(path.join(rootDir, 'docs', 'sql', 'concurrency', '011_concurrency_session_a.sql'), 'utf8');
    assert.ok(!sessionA.includes('delete from app_private.members'), 'Cleanup parcial por DML em members não deve existir');
    assert.ok(!sessionA.includes('delete from auth.users'), 'Cleanup parcial por DML em auth.users não deve existir');
    assert.ok(sessionA.includes('MÉTODO NORMATIVO EXCLUSIVO: Descarte integral da base escala_rehearsal_tmp via dropdb'), 'Deve instruir descarte integral via dropdb');
  });

  test('28. Validação do Executor Integrado: CLI e modos de execução (--help, --plan, --check, --dry-run, --execute, sem opções)', async () => {
    // 1. Invocação sem opções retorna exitCode 1 (não declara PASS silenciosamente)
    const codeNoArgs = await runCli([]);
    assert.equal(codeNoArgs, 1, 'Invocação sem argumentos deve falhar com código 1');

    // 2. --help retorna exitCode 0
    const codeHelp = await runCli(['--help']);
    assert.equal(codeHelp, 0, '--help deve retornar código 0');

    // 3. --plan retorna exitCode 0 (exibe plano sem mutações)
    const codePlan = await runCli(['--plan']);
    assert.equal(codePlan, 0, '--plan deve retornar código 0');

    // 4. --check retorna exitCode 0 (fontes canônicas válidas e sem wrappers manuais obsoletos)
    const codeCheck = await runCli(['--check']);
    assert.equal(codeCheck, 0, '--check deve retornar código 0');

    // 5. --dry-run percorre todas as 8 fases com transporte simulado e retorna 0
    const codeDryRun = await runCli(['--dry-run']);
    assert.equal(codeDryRun, 0, '--dry-run deve executar com sucesso e retornar código 0');

    // 6. --dry-run --stage rollback para formalmente na Fase 4 (sem avanço indevido)
    const orchestratorRollback = new RehearsalOrchestrator({ dryRun: true });
    const resRollbackStage = await orchestratorRollback.executePlan('rollback');
    assert.equal(resRollbackStage.success, true);
    assert.equal(resRollbackStage.stoppedAtStage, 'rollback');
    assert.deepEqual(
      resRollbackStage.phasesExecuted,
      ['phase_1_provisioning', 'phase_2_preflight', 'phase_3_rollback_validation', 'phase_4_post_rollback_audit'],
      'Deve parar na Fase 4 sem avançar para instalação (Fase 5+)'
    );

    // 7. --execute sem --confirm-local deve falhar com código 1
    const codeExecNoConfirm = await runCli(['--execute']);
    assert.equal(codeExecNoConfirm, 1, '--execute sem --confirm-local deve falhar');

    // 8. --execute com --confirm-local falha com código 1 nesta rodada (governança: sem conexão física)
    const codeExecWithConfirm = await runCli(['--execute', '--confirm-local']);
    assert.equal(codeExecWithConfirm, 1, '--execute deve abortar com aviso de governança sem conexão real autorizada');
  });

  test('29. Contraprovas de Transporte e Evidência: Preflight e 012 rejeitam erros de transporte, saídas parciais ou inválidas', () => {
    const allTruePreflight = {};
    for (const ind of PREFLIGHT_INDICATORS) allTruePreflight[ind] = true;

    // Caso 1: Preflight com linhas TRUE mas erro de transporte (exitCode 1) -> REJEITA
    const resExitCode1 = validatePreflightResult({ exitCode: 1, stderr: 'conexão recusada', rows: [allTruePreflight] });
    assert.equal(resExitCode1.success, false, 'Preflight com exitCode 1 deve falhar mesmo com linhas TRUE');
    assert.ok(resExitCode1.errors.some(e => e.includes('Falha de transporte')));

    // Caso 2: Preflight com transportError explícito -> REJEITA
    const resTransportErr = validatePreflightResult({ transportError: 'timeout', rows: [allTruePreflight] });
    assert.equal(resTransportErr.success, false, 'Preflight com transportError deve falhar');

    // Caso 3: Preflight com indicador NULL -> REJEITA
    const nullIndicator = { ...allTruePreflight, crypto_primitives_available: null };
    const resNull = validatePreflightResult([nullIndicator]);
    assert.equal(resNull.success, false, 'Indicador NULL deve falhar');
    assert.ok(resNull.errors.some(e => e.includes('é NULL')));

    // Caso 4: Preflight com indicador ausente -> REJEITA
    const missingIndicator = { ...allTruePreflight };
    delete missingIndicator.server_and_client_utf8;
    const resMissing = validatePreflightResult([missingIndicator]);
    assert.equal(resMissing.success, false, 'Indicador ausente deve falhar');
    assert.ok(resMissing.errors.some(e => e.includes('Indicador de preflight ausente')));

    // Caso 5: 012 com 2 linhas ({ rows: [linhaTrue, linhaTrue] }) -> REJEITA (contraprova direta)
    const allTrue012 = {};
    for (const ind of VERIFY_012_INDICATORS) allTrue012[ind] = true;
    const res012TwoRows = validateVerify012Result({ rows: [allTrue012, allTrue012] });
    assert.equal(res012TwoRows.success, false, '012 com 2 linhas deve falhar');
    assert.ok(res012TwoRows.errors.some(e => e.includes('Esperado exatamente 1 linha')));

    // Caso 6: 012 com 0 linhas ({ rows: [] }) -> REJEITA
    const res012ZeroRows = validateVerify012Result({ rows: [] });
    assert.equal(res012ZeroRows.success, false, '012 com 0 linhas deve falhar');

    // Caso 7: 012 com erro de transporte (exitCode 1) -> REJEITA antes dos indicadores
    const res012TransportErr = validateVerify012Result({ exitCode: 1, rows: [allTrue012] });
    assert.equal(res012TransportErr.success, false, '012 com erro de transporte deve falhar');
  });

  test('30. Contraprovas de Integridade pós-ROLLBACK: Rejeição de snapshots vazios/parciais e de qualquer resíduo estrutural ou de dados', () => {
    // Caso 1: validateRollbackIntegrity({}, {}) -> REJEITA por schema inválido (contraprova direta)
    const resEmpty = validateRollbackIntegrity({}, {});
    assert.equal(resEmpty.success, false, 'validateRollbackIntegrity({}, {}) deve falhar');
    assert.ok(resEmpty.errors.length > 0, 'Deve diagnosticar ausência de schema completo');

    // Caso 2: Snapshot com contagem ausente ou NaN -> REJEITA
    const incompleteSnapshot = {
      installed_011_rpcs_count: NaN,
      command_receipts_has_result_entity_id: false,
      command_receipts_has_result_payload: false,
      command_receipts_has_payload_check: false,
      app_private_client_permissions_count: 0,
      row_counts: { churches: 1 } // faltam tabelas
    };
    const checkSchema = validateSnapshotSchema(incompleteSnapshot, 'teste');
    assert.equal(checkSchema.valid, false, 'Snapshot incompleto ou com NaN deve ser inválido');

    // Baseline completo válido
    const validBaseline = {
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

    // Caso 3: Pós-rollback com command_receipts_has_result_payload: true -> REJEITA (contraprova direta)
    const dirtyPayloadCol = { ...validBaseline, command_receipts_has_result_payload: true };
    const resPayloadCol = validateRollbackIntegrity(validBaseline, dirtyPayloadCol);
    assert.equal(resPayloadCol.success, false, 'Resíduo de result_payload deve ser rejeitado');
    assert.ok(resPayloadCol.errors.some(e => e.includes('result_payload')));

    // Caso 4: Pós-rollback com command_receipts_has_result_entity_id: true -> REJEITA
    const dirtyEntityCol = { ...validBaseline, command_receipts_has_result_entity_id: true };
    const resEntityCol = validateRollbackIntegrity(validBaseline, dirtyEntityCol);
    assert.equal(resEntityCol.success, false, 'Resíduo de result_entity_id deve ser rejeitado');

    // Caso 5: Pós-rollback com command_receipts_has_payload_check: true -> REJEITA
    const dirtyCheckConstraint = { ...validBaseline, command_receipts_has_payload_check: true };
    const resCheckConstraint = validateRollbackIntegrity(validBaseline, dirtyCheckConstraint);
    assert.equal(resCheckConstraint.success, false, 'Resíduo de constraint deve ser rejeitado');

    // Caso 6: Pós-rollback com permissões residuais em app_private -> REJEITA
    const dirtyPerms = { ...validBaseline, app_private_client_permissions_count: 1 };
    const resPerms = validateRollbackIntegrity(validBaseline, dirtyPerms);
    assert.equal(resPerms.success, false, 'Permissões residuais devem ser rejeitadas');

    // Caso 7: Cada uma das 8 tabelas de domínio com contagem divergente pós-rollback -> REJEITA
    for (const table of REQUIRED_DOMAIN_TABLES) {
      const mutatedCounts = { ...validBaseline.row_counts, [table]: validBaseline.row_counts[table] + 1 };
      const dirtyTableSnapshot = { ...validBaseline, row_counts: mutatedCounts };
      const resDirtyTable = validateRollbackIntegrity(validBaseline, dirtyTableSnapshot);
      assert.equal(resDirtyTable.success, false, `Resíduo na tabela '${table}' deve ser rejeitado`);
      assert.ok(resDirtyTable.errors.some(e => e.includes(table)));
    }
  });

  test('31. Contraprovas de Concorrência (C1 a C4): Rejeição de evidência ausente, janelas temporais e garantia de liberação de locks em finally', async () => {
    const coordinator = new ConcurrencyCoordinator({ runId: 'test_coord_negative' });

    // Caso 1: C4 com callbacks positivos mas sem expiresAt ou sem waitStartedAt -> REJEITA (contraprova direta)
    const sessA = new MockSessionTransport({ name: 'session_a', pid: 301 });
    const sessB = new MockSessionTransport({ name: 'session_b', pid: 302 });
    coordinator.registerSessions(sessA, sessB);

    const c4NoTiming = {
      async holdLocksA(sA) { await sA.query('BEGIN;'); return { success: true }; },
      async dispatchRpcB(sB) { return { success: true }; },
      async confirmWaitingA() { return { success: true }; }, // sem waitStartedAt
      async releaseA(sA) { await sA.query('COMMIT;'); },
      validateOutcomeB() { return { success: true }; },
      async verifyFinalStateA() { return { success: true }; }
    };
    await assert.rejects(
      coordinator.runScenario('c4', c4NoTiming),
      /EVIDÊNCIA TEMPORAL AUSENTE/,
      'C4 sem tempos válidos deve falhar categoricamente'
    );

    // Caso 2: C4 com janela perdida (waitStartedAt >= expiresAt) -> REJEITA
    const c4LateWait = {
      ...c4NoTiming,
      expiresAt: 1000,
      async confirmWaitingA() { return { success: true, waitStartedAt: 1005 }; } // posterior ao vencimento
    };
    await assert.rejects(
      coordinator.runScenario('c4', c4LateWait),
      /JANELA PERDIDA/,
      'C4 com retenção após expiração deve falhar por janela perdida'
    );

    // Caso 3: Erro na confirmação de bloqueio garante rollback de A e liberação em finally (contraprova direta)
    const sessAForFail = new MockSessionTransport({ name: 'session_a_fail', pid: 401 });
    const sessBForFail = new MockSessionTransport({ name: 'session_b_fail', pid: 402 });
    coordinator.registerSessions(sessAForFail, sessBForFail);

    let rollbackACalled = false;
    const failingWaitDef = {
      async holdLocksA(sA) {
        await sA.query('BEGIN;');
        sA.locksHeld = ['advisory_lock_c1'];
        return { success: true };
      },
      async dispatchRpcB(sB) { return { success: true }; },
      async confirmWaitingA() {
        throw new Error('Falha simulada na verificação de pg_blocking_pids');
      },
      async releaseA(sA) { await sA.query('COMMIT;'); },
      async rollbackA(sA) {
        rollbackACalled = true;
        await sA.query('ROLLBACK;');
      },
      validateOutcomeB() { return { success: true }; },
      async verifyFinalStateA() { return { success: true }; }
    };

    await assert.rejects(
      coordinator.runScenario('c1', failingWaitDef),
      /Falha simulada na verificação de pg_blocking_pids/,
      'Erro em confirmWaitingA deve ser propagado'
    );
    assert.equal(rollbackACalled, true, 'rollbackA DEVE ter sido invocado para liberar recursos de A');
    assert.equal(sessAForFail.inTransaction, false, 'Transação de A não pode permanecer aberta');
    assert.equal(sessAForFail.locksHeld.length, 0, 'Locks retidos em A devem ter sido limpos');

    // Caso 4: Resultado de outro cenário retornado por B -> REJEITADO
    const wrongOutcomeDef = {
      async holdLocksA(sA) { await sA.query('BEGIN;'); return { success: true }; },
      async dispatchRpcB(sB) { return { success: true, link_unrecoverable: false }; }, // resultado incorreto para C1
      async confirmWaitingA() { return { success: true }; },
      async releaseA(sA) { await sA.query('COMMIT;'); },
      validateOutcomeB(res) {
        if (res.link_unrecoverable !== true) return { success: false, error: 'Esperado link_unrecoverable = true' };
        return { success: true };
      },
      async verifyFinalStateA() { return { success: true }; }
    };
    await assert.rejects(
      coordinator.runScenario('c1', wrongOutcomeDef),
      /Asserção do resultado de B falhou/,
      'Resultado de outro cenário deve ser rejeitado na asserção'
    );
  });

  test('32. Contraprovas de Destino e Guarda de Instância: Rejeição de endpoint remoto, assinatura incompatível e aborto seguro', () => {
    // Caso 1: validateDisposalTarget com host remoto piloto Supabase -> REJEITA (contraprova direta)
    const remotePilot = {
      host: 'jvpctgqudvjealzileib.supabase.co',
      port: 5432,
      database: 'escala_rehearsal_tmp',
      user: 'postgres',
      runId: 'probe'
    };
    const resRemotePilot = validateDisposalTarget(remotePilot);
    assert.equal(resRemotePilot.valid, false, 'Host piloto remoto deve ser rejeitado');
    assert.ok(resRemotePilot.errors.some(e => e.includes('Host de destino inválido ou remoto') || e.includes('Tentativa perigosa')));

    // Caso 2: Host remoto arbitrário (ex.: IP externo 192.168.1.50) -> REJEITA
    const remoteIp = {
      host: '192.168.1.50',
      port: 5432,
      database: 'escala_rehearsal_tmp',
      user: 'postgres',
      runId: 'probe'
    };
    const resRemoteIp = validateDisposalTarget(remoteIp);
    assert.equal(resRemoteIp.valid, false, 'Host IP remoto não-localhost deve ser rejeitado');

    // Caso 3: Assinatura de instância incompatível com runId -> REJEITA
    const mismatchedMarker = {
      host: '127.0.0.1',
      port: 5432,
      database: 'escala_rehearsal_tmp',
      user: 'postgres',
      runId: 'exec_001',
      instanceMarker: 'escala_rehearsal_exec_OTHER',
      requiresMarkerCheck: true
    };
    const resMarkerMismatch = validateDisposalTarget(mismatchedMarker);
    assert.equal(resMarkerMismatch.valid, false, 'Assinatura de instância divergente de runId deve ser rejeitada');
    assert.ok(resMarkerMismatch.errors.some(e => e.includes('Assinatura de instância incompatível')));

    // Caso 4: Assinatura de instância ausente com requiresMarkerCheck: true -> REJEITA
    const missingMarker = {
      host: '127.0.0.1',
      port: 5432,
      database: 'escala_rehearsal_tmp',
      user: 'postgres',
      runId: 'exec_001',
      requiresMarkerCheck: true
    };
    const resMissingMarker = validateDisposalTarget(missingMarker);
    assert.equal(resMissingMarker.valid, false, 'Assinatura de instância ausente para descarte deve ser rejeitada');

    // Caso 5: Alvo válido local com assinatura compatível -> APROVADO
    const validLocalTarget = {
      host: '127.0.0.1',
      port: 5432,
      database: 'escala_rehearsal_tmp',
      user: 'postgres',
      runId: 'exec_001',
      instanceMarker: 'escala_rehearsal_exec_001',
      requiresMarkerCheck: true
    };
    const resValidTarget = validateDisposalTarget(validLocalTarget);
    assert.equal(resValidTarget.valid, true, 'Alvo local 127.0.0.1 com assinatura compatível deve ser aprovado');
  });

  test('33. Contraprova (Laboratório Real Codex): Variável não declarada no bloco de testes (v_church_id ou v_target_member_id) é detectada e rejeitada pelo verificador estático', () => {
    // Reproduz o erro exato que reprovou o ensaio no PostgreSQL:
    // v_church_id utilizada sem declaração em 03_scenarios_11_to_20.sql
    const origScenarios = fs.readFileSync(path.join(rootDir, 'docs', 'sql', 'src_011', '05_tests', '03_scenarios_11_to_20.sql'), 'utf8');
    const mutated = origScenarios.replace(
      'v_receipt_church_id := null;',
      'v_church_id := null;'
    );

    const result = runChecks({
      silent: true,
      overrides: { '05_tests/03_scenarios_11_to_20.sql': mutated }
    });

    assert.ok(
      result.errors.some(e => e.includes("Variável 'v_church_id' utilizada sem declaração")),
      'Verificador estático deve detectar e rejeitar variável v_church_id não declarada'
    );

    // Também verifica detecção para v_target_member_id
    const mutated2 = origScenarios.replace(
      'v_receipt_member_id := null;',
      'v_target_member_id := null;'
    );
    const result2 = runChecks({
      silent: true,
      overrides: { '05_tests/03_scenarios_11_to_20.sql': mutated2 }
    });

    assert.ok(
      result2.errors.some(e => e.includes("Variável 'v_target_member_id' utilizada sem declaração")),
      'Verificador estático deve detectar e rejeitar variável v_target_member_id não declarada'
    );
  });

  test('34. Regressão e Contraprova: Compatibilidade com Supabase Auth nativo (auth.users.email varchar(255)) e cast explícito em list_church_access_requests', () => {
    // 1. Verifica bootstrap_lab_environment.sql com varchar(255)
    const bootstrapSql = fs.readFileSync(path.join(rootDir, 'docs', 'sql', 'bootstrap_lab_environment.sql'), 'utf8');
    assert.ok(
      bootstrapSql.includes('email varchar(255) unique'),
      'bootstrap_lab_environment.sql deve declarar email como varchar(255) correspondendo ao Auth nativo'
    );

    // 2. Verifica fonte canônica de 07_list_church_access_requests.sql
    const origRpc = fs.readFileSync(path.join(rootDir, 'docs', 'sql', 'src_011', '03_rpcs', '07_list_church_access_requests.sql'), 'utf8');
    assert.ok(
      /coalesce\s*\(\s*u\.email\s*,\s*''\s*\)\s*::\s*text\s+as\s+req_email/i.test(origRpc),
      'Fonte 07_list_church_access_requests.sql deve conter cast explícito ::text em coalesce(u.email, \'\')'
    );

    // 3. Contraprova: Omissão de ::text em 07_list_church_access_requests.sql DEVE ser rejeitada pelo verificador
    const mutatedRpc = origRpc.replace("coalesce(u.email, '')::text as req_email", "coalesce(u.email, '') as req_email");
    const { installSql, validateSql } = generateArtifacts({
      overrides: { '03_rpcs/07_list_church_access_requests.sql': mutatedRpc }
    });

    const result = runChecks({
      silent: true,
      overrides: {
        '03_rpcs/07_list_church_access_requests.sql': mutatedRpc,
        'docs/sql/011_invitations_and_requests.sql': installSql,
        'docs/sql/011_validate_invitations.sql': validateSql
      }
    });

    assert.ok(
      result.errors.some(e => e.includes('RPC list_church_access_requests: deve conter cast explícito \'coalesce(u.email, \'\')::text\'')),
      'Contraprova: verificador estático deve rejeitar list_church_access_requests sem cast explícito ::text'
    );

    // 4. Verifica presença do Cenário 26 no artefato gerado 011_validate_invitations.sql
    const validateSqlDisk = fs.readFileSync(path.join(rootDir, 'docs', 'sql', '011_validate_invitations.sql'), 'utf8');
    assert.ok(
      validateSqlDisk.includes('[CENÁRIO 26] Regressão Supabase Auth Nativo (auth.users.email varchar(255))'),
      '011_validate_invitations.sql deve conter o Cenário 26 de regressão executável'
    );
  });

});

