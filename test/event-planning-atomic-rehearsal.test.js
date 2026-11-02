/**
 * test/event-planning-atomic-rehearsal.test.js
 *
 * Suíte de testes estáticos e unitários (sem acesso a banco) para validação
 * do gerador de payload de ensaio reversível (Issue #57).
 *
 * Cobertura de Testes:
 * 1. Hashes canônicos de entrada calculados sobre bytes reais de disco (sem alteração de LF).
 * 2. Geração determinística em memória e métricas do payload de ensaio.
 * 3. Demonstração de expansão byte a byte:
 *    - Leitura dos candidatos como bytes reais;
 *    - Comprovação de que cada sequência aparece integralmente e exatamente 1 vez;
 *    - Comprovação da ordem estrita 023a -> 023b -> 025.
 * 4. Envoltória transacional segura (1 BEGIN, 0 COMMIT, 1 ROLLBACK terminal).
 * 5. Ancoragem da substituição transacional no marcador canônico:
 *    - Marcador único '-- Confirmação atômica indivisível de todo o pacote';
 *    - Bloco $post_install_verification$ fechado antes do marcador;
 *    - Contraprovas contra instruções intermediárias ou após o COMMIT.
 * 6. Função reutilizável validateRehearsalPayload:
 *    - Validação positiva do payload legítimo;
 *    - Contraprova: injeção de COMMIT; em payload já transformado é rejeitada;
 *    - Contraprova: injeção de ROLLBACK extra é rejeitada.
 * 7. Contraprovas completas de inclusões (faltante, extra real, ordem invertida, diretiva \i).
 * 8. Contraprovas de alinhamento estrutural nos blocos de preflight e pós-instalação.
 * 9. Contraprovas de integridade de hash de entrada e comandos de transação interna nos candidatos.
 * 10. Segurança atomicamente fail-closed da CLI (dry-run padrão e recusa exclusiva em EEXIST).
 *
 * Governança: Não abre conexões de banco, Docker, Supabase, HTTP ou subprocessos de banco.
 * Não persiste nenhum payload de ensaio no disco.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  buildRehearsalPayload,
  validateRehearsalPayload,
  validateInstallerStructuralBlocks,
  parseCliArgs,
  runCli,
  CANONICAL_HASHES,
  EXPECTED_COMPONENTS,
  EXPECTED_RPCS,
  REQUIRED_PLANNING_COLUMNS,
  DEFAULT_INSTALLER_RELATIVE_PATH,
  FINAL_CONFIRMATION_MARKER,
  computeSha256,
  stripSqlComments,
  findTopLevelTransactionCommands,
  extractIncludedDirectives,
} from '../tools/build-event-planning-atomic-rehearsal.js';

const WORKSPACE_ROOT = path.resolve('.');

describe('Issue #57 — Validação Estática do Gerador de Ensaio Reversível', () => {

  test('1. Hashes SHA-256 canônicos das entradas calculados sobre bytes reais de disco', () => {
    // 023a, 023b, 025
    for (const comp of EXPECTED_COMPONENTS) {
      const filePath = path.resolve(WORKSPACE_ROOT, comp.relativePath);
      assert.ok(fs.existsSync(filePath), `Arquivo componente ${comp.relativePath} deve existir.`);
      const rawBytes = fs.readFileSync(filePath);
      const actualHash = crypto.createHash('sha256').update(rawBytes).digest('hex').toUpperCase();
      assert.strictEqual(
        actualHash,
        comp.expectedHash,
        `Hash do candidato ${comp.fileName} divergiu do valor canônico aprovado.`
      );
    }

    // Instalador template
    const instPath = path.resolve(WORKSPACE_ROOT, DEFAULT_INSTALLER_RELATIVE_PATH);
    assert.ok(fs.existsSync(instPath), 'Instalador atômico deve existir.');
    const instBytes = fs.readFileSync(instPath);
    const instHash = crypto.createHash('sha256').update(instBytes).digest('hex').toUpperCase();
    assert.strictEqual(
      instHash,
      CANONICAL_HASHES.installer,
      'Hash do instalador atômico divergiu do valor esperado.'
    );
  });

  test('2. Geração determinística em memória produz payload conforme com todos os componentes', () => {
    const result = buildRehearsalPayload({ workspaceRoot: WORKSPACE_ROOT });

    assert.ok(result.payload, 'Payload gerado não deve ser vazio.');
    assert.strictEqual(typeof result.payload, 'string');
    assert.strictEqual(result.components.length, 3);

    // Ordem e hashes dos componentes reportados
    assert.strictEqual(result.components[0].fileName, '023a_event_planning_structural.sql');
    assert.strictEqual(result.components[0].order, 1);
    assert.strictEqual(result.components[1].fileName, '023b_event_creation_security_hardening.sql');
    assert.strictEqual(result.components[1].order, 2);
    assert.strictEqual(result.components[2].fileName, '025_event_planning_security_hardening.sql');
    assert.strictEqual(result.components[2].order, 3);

    // Hash SHA-256 determinístico calculado sobre os bytes reais do payload
    const expectedHash = computeSha256(result.payload);
    assert.strictEqual(result.sha256, expectedHash);
    assert.strictEqual(result.byteLength, Buffer.byteLength(result.payload, 'utf8'));
    assert.strictEqual(result.lineCount, result.payload.split(/\r?\n/).length);
  });

  test('3. Demonstração de expansão byte a byte: presença integral, ocorrência única e ordem estrita', () => {
    const { payload } = buildRehearsalPayload({ workspaceRoot: WORKSPACE_ROOT });

    // Leitura dos bytes reais de cada candidato
    const bytes023a = fs.readFileSync(path.resolve(WORKSPACE_ROOT, 'docs/sql/023a_event_planning_structural.sql'), 'utf8');
    const bytes023b = fs.readFileSync(path.resolve(WORKSPACE_ROOT, 'docs/sql/023b_event_creation_security_hardening.sql'), 'utf8');
    const bytes025  = fs.readFileSync(path.resolve(WORKSPACE_ROOT, 'docs/sql/025_event_planning_security_hardening.sql'), 'utf8');

    // 1. Cada candidato deve aparecer integralmente no payload
    const idx023a = payload.indexOf(bytes023a);
    const lastIdx023a = payload.lastIndexOf(bytes023a);
    assert.ok(idx023a !== -1, 'Bytes de 023a devem estar presentes integralmente no payload.');
    assert.strictEqual(idx023a, lastIdx023a, 'Bytes de 023a devem aparecer exatamente UMA vez no payload.');

    const idx023b = payload.indexOf(bytes023b);
    const lastIdx023b = payload.lastIndexOf(bytes023b);
    assert.ok(idx023b !== -1, 'Bytes de 023b devem estar presentes integralmente no payload.');
    assert.strictEqual(idx023b, lastIdx023b, 'Bytes de 023b devem aparecer exatamente UMA vez no payload.');

    const idx025 = payload.indexOf(bytes025);
    const lastIdx025 = payload.lastIndexOf(bytes025);
    assert.ok(idx025 !== -1, 'Bytes de 025 devem estar presentes integralmente no payload.');
    assert.strictEqual(idx025, lastIdx025, 'Bytes de 025 devem aparecer exatamente UMA vez no payload.');

    // 2. Ordem estrita dos offsets de inclusão
    assert.ok(
      idx023a < idx023b,
      `Ordem incorreta: 023a (pos ${idx023a}) deve preceder 023b (pos ${idx023b}).`
    );
    assert.ok(
      idx023b < idx025,
      `Ordem incorreta: 023b (pos ${idx023b}) deve preceder 025 (pos ${idx025}).`
    );
  });

  test('4. Envoltória transacional do payload: exatamente 1 BEGIN, 0 COMMIT e 1 ROLLBACK terminal', () => {
    const { payload } = buildRehearsalPayload({ workspaceRoot: WORKSPACE_ROOT });
    const txCmds = findTopLevelTransactionCommands(payload);

    const begins = txCmds.filter(t => t.command === 'BEGIN' || t.command.startsWith('START'));
    const commits = txCmds.filter(t => t.command === 'COMMIT' || t.command === 'END');
    const rollbacks = txCmds.filter(t => t.command === 'ROLLBACK');

    assert.strictEqual(begins.length, 1, 'Deve existir exatamente 1 comando BEGIN de topo.');
    assert.strictEqual(commits.length, 0, 'Não deve existir NENHUM comando COMMIT no payload de ensaio.');
    assert.strictEqual(rollbacks.length, 1, 'Deve existir exatamente 1 comando ROLLBACK de topo.');

    // O comando ROLLBACK deve ser terminal (nada executável após ele)
    const rollbackEntry = rollbacks[0];
    const afterRollback = payload.substring(rollbackEntry.index + rollbackEntry.length);
    const cleanAfter = stripSqlComments(afterRollback).trim();
    assert.strictEqual(
      cleanAfter.length,
      0,
      'Não deve haver instruções SQL executáveis após o ROLLBACK terminal.'
    );
  });

  test('5. Ancoragem da substituição transacional e contraprovas contra comandos intermediários', () => {
    const instPath = path.resolve(WORKSPACE_ROOT, DEFAULT_INSTALLER_RELATIVE_PATH);
    const instContent = fs.readFileSync(instPath, 'utf8');

    // Confirma presença e unicidade do marcador canônico
    const matches = instContent.match(new RegExp(FINAL_CONFIRMATION_MARKER, 'g')) || [];
    assert.strictEqual(matches.length, 1, 'Marcador canônico deve aparecer exatamente uma vez no instalador.');

    // Contraprova: injeção de instrução SQL entre $post_install_verification$ e o marcador
    const tamperedWithSqlBeforeMarker = instContent.replace(
      FINAL_CONFIRMATION_MARKER,
      'SELECT 1; -- INJECTED SQL\n' + FINAL_CONFIRMATION_MARKER
    );
    assert.throws(
      () => {
        buildRehearsalPayload({
          workspaceRoot: WORKSPACE_ROOT,
          skipHashVerification: true,
          installerContentOverride: tamperedWithSqlBeforeMarker,
        });
      },
      /Existem instruções SQL executáveis entre o fechamento de \$post_install_verification\$ e o marcador final/,
      'Deve rejeitar instruções executáveis entre o fechamento de post-install e o marcador final.'
    );

    // Contraprova: injeção de instrução SQL após o COMMIT final
    const tamperedWithSqlAfterCommit = instContent.replace(
      /commit;\s*$/i,
      'commit;\nSELECT 1; -- INJECTED AFTER COMMIT\n'
    );
    assert.throws(
      () => {
        buildRehearsalPayload({
          workspaceRoot: WORKSPACE_ROOT,
          skipHashVerification: true,
          installerContentOverride: tamperedWithSqlAfterCommit,
        });
      },
      /O comando COMMIT do instalador não é terminal/,
      'Deve rejeitar instruções SQL executáveis após o COMMIT final.'
    );
  });

  test('6. Função validateRehearsalPayload: validação positiva e contraprova contra COMMIT injetado', () => {
    const { payload } = buildRehearsalPayload({ workspaceRoot: WORKSPACE_ROOT });

    // Validação positiva direta
    assert.strictEqual(validateRehearsalPayload(payload), true);

    // Contraprova: injeção de COMMIT; no meio do payload transformado
    const tamperedPayloadWithCommit = payload.replace(
      'rollback;',
      'commit;\nrollback;'
    );
    assert.throws(
      () => {
        validateRehearsalPayload(tamperedPayloadWithCommit);
      },
      /Payload final não pode conter nenhum COMMIT\. Encontrados: 1/,
      'validateRehearsalPayload deve barrar injeção de COMMIT no payload transformado.'
    );

    // Contraprova: injeção de segundo ROLLBACK;
    const tamperedPayloadWithExtraRollback = payload + '\nrollback;';
    assert.throws(
      () => {
        validateRehearsalPayload(tamperedPayloadWithExtraRollback);
      },
      /Payload final deve conter exatamente 1 ROLLBACK de topo\. Encontrados: 2/,
      'validateRehearsalPayload deve barrar múltiplos comandos ROLLBACK.'
    );
  });

  test('7. Contraprovas completas de inclusões: faltante, extra real, ordem invertida e diretiva \\i', () => {
    const instContent = fs.readFileSync(
      path.resolve(WORKSPACE_ROOT, DEFAULT_INSTALLER_RELATIVE_PATH),
      'utf8'
    );

    // 1. Inclusão faltante (omissão de 025)
    const missingOne = instContent.replace('\\ir 025_event_planning_security_hardening.sql', '');
    assert.throws(
      () => {
        buildRehearsalPayload({
          workspaceRoot: WORKSPACE_ROOT,
          skipHashVerification: true,
          installerContentOverride: missingOne,
        });
      },
      /Instalador deve conter exatamente 3 inclusões '\\ir'\. Encontradas: 2/,
      'Deve barrar instalador com inclusão faltante.'
    );

    // 2. Inclusão extra real (adiciona um 4º candidato fictício)
    const extraInclude = instContent.replace(
      '\\ir 025_event_planning_security_hardening.sql',
      '\\ir 025_event_planning_security_hardening.sql\n\\ir 026_extra_unauthorized_step.sql'
    );
    assert.throws(
      () => {
        buildRehearsalPayload({
          workspaceRoot: WORKSPACE_ROOT,
          skipHashVerification: true,
          installerContentOverride: extraInclude,
        });
      },
      /Instalador deve conter exatamente 3 inclusões '\\ir'\. Encontradas: 4/,
      'Deve barrar instalador com inclusão extra real.'
    );

    // 3. Ordem invertida (swapped 023a e 023b)
    const swapped = instContent.replace(
      '\\ir 023a_event_planning_structural.sql\n\n-- 2.2 Candidato RPC Seguro: Criação de Edições com Opção B e Hardening D1–D7\n\\ir 023b_event_creation_security_hardening.sql',
      '\\ir 023b_event_creation_security_hardening.sql\n\n-- 2.2 Candidato RPC Seguro: Criação de Edições com Opção B e Hardening D1–D7\n\\ir 023a_event_planning_structural.sql'
    );
    assert.throws(
      () => {
        buildRehearsalPayload({
          workspaceRoot: WORKSPACE_ROOT,
          skipHashVerification: true,
          installerContentOverride: swapped,
        });
      },
      /Ordem ou arquivo de inclusão incorreto na posição 1/,
      'Deve barrar alteração na ordem das inclusões.'
    );

    // 4. Uso de \i em vez de \ir
    const usingI = instContent.replace(
      '\\ir 023a_event_planning_structural.sql',
      '\\i 023a_event_planning_structural.sql'
    );
    assert.throws(
      () => {
        buildRehearsalPayload({
          workspaceRoot: WORKSPACE_ROOT,
          skipHashVerification: true,
          installerContentOverride: usingI,
        });
      },
      /Inclusão na linha \d+ usa diretiva '\\i'\. Exigido estritamente '\\ir'\./,
      'Deve barrar uso da diretiva \\i em vez de \\ir.'
    );
  });

  test('8. Contraprovas de alinhamento estrutural nos blocos $preflight_guard$ e $post_install_verification$', () => {
    const instContent = fs.readFileSync(
      path.resolve(WORKSPACE_ROOT, DEFAULT_INSTALLER_RELATIVE_PATH),
      'utf8'
    );

    // Validação positiva do conteúdo canônico
    assert.strictEqual(validateInstallerStructuralBlocks(instContent), true);

    // Contraprova A: Remoção de RPC do preflight
    const preflightMissingRpc = instContent.replace("'create_church_event_edition',", '');
    assert.throws(
      () => {
        buildRehearsalPayload({
          workspaceRoot: WORKSPACE_ROOT,
          skipHashVerification: true,
          installerContentOverride: preflightMissingRpc,
        });
      },
      /Guarda de preflight não confere a RPC obrigatória "create_church_event_edition"/,
      'Deve rejeitar preflight sem todas as 5 RPCs.'
    );

    // Contraprova B: Remoção da tabela de recibos do preflight
    const preflightMissingReceipts = instContent.replace(
      /if to_regclass\('app_private\.event_planning_receipts'\)[\s\S]*?end if;/i,
      '-- RECIBOS REMOVIDOS'
    );
    assert.throws(
      () => {
        buildRehearsalPayload({
          workspaceRoot: WORKSPACE_ROOT,
          skipHashVerification: true,
          installerContentOverride: preflightMissingReceipts,
        });
      },
      /Guarda de preflight não cobre a tabela de recibos "event_planning_receipts"/,
      'Deve rejeitar preflight sem verificação da tabela de recibos.'
    );

    // Contraprova C: Remoção de coluna do preflight
    const preflightMissingCol = instContent.replace("'duration_policy',", '');
    assert.throws(
      () => {
        buildRehearsalPayload({
          workspaceRoot: WORKSPACE_ROOT,
          skipHashVerification: true,
          installerContentOverride: preflightMissingCol,
        });
      },
      /Guarda de preflight não cobre a coluna obrigatória "duration_policy"/,
      'Deve rejeitar preflight sem todas as 5 colunas de planejamento.'
    );

    // Contraprova D: Remoção de aclexplode do post-install
    const postMissingAclexplode = instContent.replace(/aclexplode/g, 'foo_acl_explode');
    assert.throws(
      () => {
        buildRehearsalPayload({
          workspaceRoot: WORKSPACE_ROOT,
          skipHashVerification: true,
          installerContentOverride: postMissingAclexplode,
        });
      },
      /Pós-instalação não contém a auditoria direta via "aclexplode"/,
      'Deve rejeitar pós-instalação sem auditoria aclexplode.'
    );

    // Contraprova E: Remoção de has_function_privilege do post-install
    const postMissingPrivilege = instContent.replace(/has_function_privilege/g, 'fake_privilege');
    assert.throws(
      () => {
        buildRehearsalPayload({
          workspaceRoot: WORKSPACE_ROOT,
          skipHashVerification: true,
          installerContentOverride: postMissingPrivilege,
        });
      },
      /Pós-instalação não confere privilégio efetivo via "has_function_privilege"/,
      'Deve rejeitar pós-instalação sem checagem de privilégio efetivo.'
    );

    // Contraprova F: Remoção de relrowsecurity do post-install
    const postMissingRls = instContent.replace('and relrowsecurity = true', '');
    assert.throws(
      () => {
        buildRehearsalPayload({
          workspaceRoot: WORKSPACE_ROOT,
          skipHashVerification: true,
          installerContentOverride: postMissingRls,
        });
      },
      /Pós-instalação não confere RLS habilitado \(relrowsecurity = true\) na tabela "event_planning_receipts"/,
      'Deve rejeitar pós-instalação sem verificação de RLS.'
    );

    // Contraprova G: Remoção de RPC do post-install
    const postMissingRpc = instContent.replace(
      "'create_church_event_edition(uuid,uuid,text,text,timestamp with time zone,timestamp with time zone,uuid,text)',",
      ''
    );
    assert.throws(
      () => {
        buildRehearsalPayload({
          workspaceRoot: WORKSPACE_ROOT,
          skipHashVerification: true,
          installerContentOverride: postMissingRpc,
        });
      },
      /Pós-instalação não confere a RPC obrigatória "create_church_event_edition"/,
      'Deve rejeitar pós-instalação sem todas as 5 RPCs.'
    );
  });

  test('9. Contraprovas de integridade de hash de entrada e comandos de transação interna nos candidatos', () => {
    // 1. Divergência no candidato 023a
    const tampered023a = {
      '023a_event_planning_structural.sql': '-- TAMPERED\nSELECT 1;',
    };
    assert.throws(
      () => {
        buildRehearsalPayload({
          workspaceRoot: WORKSPACE_ROOT,
          candidateContentOverrides: tampered023a,
        });
      },
      /Divergência de hash SHA-256 no candidato "023a_event_planning_structural\.sql"/,
      'Deve rejeitar candidato com hash divergente.'
    );

    // 2. Divergência no instalador
    assert.throws(
      () => {
        buildRehearsalPayload({
          workspaceRoot: WORKSPACE_ROOT,
          installerContentOverride: '-- TAMPERED INSTALLER\nBEGIN;\nCOMMIT;',
        });
      },
      /Divergência de hash SHA-256 no instalador atômico/,
      'Deve rejeitar instalador template com hash divergente.'
    );

    // 3. Injeção de transação interna de topo em candidato
    const injected023b = {
      '023b_event_creation_security_hardening.sql': 'COMMIT; -- INJECTED COMMIT\nCREATE OR REPLACE FUNCTION ...',
    };
    assert.throws(
      () => {
        buildRehearsalPayload({
          workspaceRoot: WORKSPACE_ROOT,
          skipHashVerification: true,
          candidateContentOverrides: injected023b,
        });
      },
      /Candidato "023b_event_creation_security_hardening\.sql" contém 1 comando\(s\) transacional\(is\) de topo proibido\(s\): COMMIT/,
      'Deve barrar transação interna de topo em candidato.'
    );
  });

  test('10. Presença das 5 RPCs públicas e suas assinaturas canônicas no payload final', () => {
    const { payload } = buildRehearsalPayload({ workspaceRoot: WORKSPACE_ROOT });

    for (const rpc of EXPECTED_RPCS) {
      const regex = new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${rpc}`, 'i');
      assert.match(
        payload,
        regex,
        `Payload de ensaio deve conter a definição da RPC "public.${rpc}".`
      );
    }
  });

  test('11. Contrato do parser de CLI (parseCliArgs) para modos válidos', () => {
    // 1. Chamada vazia opera em dry-run padrão
    const resEmpty = parseCliArgs([]);
    assert.deepStrictEqual(resEmpty, { mode: 'dry-run', dryRun: true, outPath: null });

    // 2. Chamada sem argumentos (default undefined) opera em dry-run
    const resDefault = parseCliArgs();
    assert.deepStrictEqual(resDefault, { mode: 'dry-run', dryRun: true, outPath: null });

    // 3. --dry-run explícito opera em dry-run
    const resDry = parseCliArgs(['--dry-run']);
    assert.deepStrictEqual(resDry, { mode: 'dry-run', dryRun: true, outPath: null });

    // 4. --help e -h isolados retornam modo help
    const resHelp = parseCliArgs(['--help']);
    assert.deepStrictEqual(resHelp, { mode: 'help', dryRun: true, outPath: null });

    const resH = parseCliArgs(['-h']);
    assert.deepStrictEqual(resH, { mode: 'help', dryRun: true, outPath: null });

    // 5. --out com caminho válido retorna modo out
    const resOut = parseCliArgs(['--out', 'caminho_ensaio.sql']);
    assert.deepStrictEqual(resOut, { mode: 'out', dryRun: false, outPath: 'caminho_ensaio.sql' });
  });

  test('12. Contraprovas obrigatórias do parser fail-closed (parseCliArgs)', () => {
    // 1. Conflito --dry-run antes de --out
    assert.throws(
      () => parseCliArgs(['--dry-run', '--out', 'alvo.sql']),
      /Conflito de opções: "--dry-run" e "--out" são mutuamente exclusivas/,
      'Deve rejeitar --dry-run antes de --out.'
    );

    // 2. Conflito --dry-run depois de --out
    assert.throws(
      () => parseCliArgs(['--out', 'alvo.sql', '--dry-run']),
      /Conflito de opções: "--dry-run" e "--out" são mutuamente exclusivas/,
      'Deve rejeitar --dry-run depois de --out.'
    );

    // 3. --out sem argumento (fim do array)
    assert.throws(
      () => parseCliArgs(['--out']),
      /Opção "--out" requer um caminho de destino\./,
      'Deve rejeitar --out sem caminho especificado.'
    );

    // 4. --out com caminho vazio ou em branco
    assert.throws(
      () => parseCliArgs(['--out', '   ']),
      /Opção "--out" requer um caminho de destino não vazio\./,
      'Deve rejeitar --out com caminho vazio.'
    );

    // 5. --out seguido de outra opção (--dry-run)
    assert.throws(
      () => parseCliArgs(['--out', '--dry-run']),
      /Caminho inválido para "--out": "--dry-run"\. Valores iniciados por "-" não são permitidos\./,
      'Deve rejeitar --out seguido de --dry-run.'
    );

    // 6. --out seguido de --help
    assert.throws(
      () => parseCliArgs(['--out', '--help']),
      /Caminho inválido para "--out": "--help"\. Valores iniciados por "-" não são permitidos\./,
      'Deve rejeitar --out seguido de --help.'
    );

    // 7. Argumentos desconhecidos (opção e posicional)
    assert.throws(
      () => parseCliArgs(['--opcao-desconhecida']),
      /Argumento ou opção desconhecida: "--opcao-desconhecida"\./,
      'Deve rejeitar opções desconhecidas.'
    );

    assert.throws(
      () => parseCliArgs(['posicional_invalido.sql']),
      /Argumento ou opção desconhecida: "posicional_invalido\.sql"\./,
      'Deve rejeitar argumentos posicionais avulsos.'
    );

    // 8. --out duplicado
    assert.throws(
      () => parseCliArgs(['--out', 'a.sql', '--out', 'b.sql']),
      /Opção "--out" duplicada\./,
      'Deve rejeitar --out duplicado.'
    );

    // 9. --dry-run duplicado
    assert.throws(
      () => parseCliArgs(['--dry-run', '--dry-run']),
      /Opção "--dry-run" duplicada\./,
      'Deve rejeitar --dry-run duplicado.'
    );

    // 10. --help combinado com outras opções
    assert.throws(
      () => parseCliArgs(['--help', '--dry-run']),
      /Opção de ajuda \(--help \/ -h\) não pode ser combinada com outros argumentos\./,
      'Deve rejeitar --help combinado com --dry-run.'
    );

    assert.throws(
      () => parseCliArgs(['--out', 'alvo.sql', '-h']),
      /Opção de ajuda \(--help \/ -h\) não pode ser combinada com outros argumentos\./,
      'Deve rejeitar -h combinado com --out.'
    );
  });

  test('13. Execução e segurança da CLI (runCli): dry-run sem gravação, erros fail-closed e proteção EEXIST', () => {
    // 1. Chamada vazia runCli([]) opera em dry-run e retorna código 0
    const codeEmpty = runCli([]);
    assert.strictEqual(codeEmpty, 0, 'runCli([]) deve retornar 0.');

    // 2. runCli(['--dry-run']) retorna código 0
    const codeDry = runCli(['--dry-run']);
    assert.strictEqual(codeDry, 0, 'runCli(["--dry-run"]) deve retornar 0.');

    // 3. runCli(['--help']) e runCli(['-h']) retornam código 0
    const codeHelp = runCli(['--help']);
    assert.strictEqual(codeHelp, 0, 'runCli(["--help"]) deve retornar 0.');

    const codeH = runCli(['-h']);
    assert.strictEqual(codeH, 0, 'runCli(["-h"]) deve retornar 0.');

    // 4. Casos inválidos de linha de comando: todos retornam código 1 (fail-closed) sem gravar arquivos
    const targetCandidatePath = path.resolve(WORKSPACE_ROOT, 'arquivo_nao_deve_existir.sql');
    assert.strictEqual(fs.existsSync(targetCandidatePath), false);

    // Conflito --dry-run e --out
    const codeConflict1 = runCli(['--dry-run', '--out', targetCandidatePath]);
    assert.strictEqual(codeConflict1, 1, 'Conflito --dry-run antes de --out deve retornar 1.');
    assert.strictEqual(fs.existsSync(targetCandidatePath), false, 'Nenhum arquivo deve ser criado em conflito.');

    const codeConflict2 = runCli(['--out', targetCandidatePath, '--dry-run']);
    assert.strictEqual(codeConflict2, 1, 'Conflito --dry-run depois de --out deve retornar 1.');
    assert.strictEqual(fs.existsSync(targetCandidatePath), false, 'Nenhum arquivo deve ser criado em conflito.');

    // --out sem argumento
    const codeNoArg = runCli(['--out']);
    assert.strictEqual(codeNoArg, 1, '--out sem argumento deve retornar 1.');

    // --out --dry-run
    const codeOutDry = runCli(['--out', '--dry-run']);
    assert.strictEqual(codeOutDry, 1, '--out --dry-run deve retornar 1.');

    // Argumento desconhecido
    const codeUnknown = runCli(['--parametro-invalido']);
    assert.strictEqual(codeUnknown, 1, 'Opção desconhecida deve retornar 1.');

    // --help combinado com --dry-run
    const codeHelpCombined = runCli(['--help', '--dry-run']);
    assert.strictEqual(codeHelpCombined, 1, '--help combinado deve retornar 1.');

    // 5. Criação exclusiva atômica: destino já existente dispara EEXIST e retorna código 1
    const existingFile = path.resolve(WORKSPACE_ROOT, 'package.json');
    const codeOverwrite = runCli(['--out', existingFile]);
    assert.strictEqual(
      codeOverwrite,
      1,
      'CLI deve retornar código 1 ao detectar arquivo existente com flag wx.'
    );

    // 6. Confirmação de que nenhum arquivo de payload foi persistido no repositório
    const tempPayloadFile = path.resolve(WORKSPACE_ROOT, '025_atomic_event_planning_rehearsal.sql');
    assert.strictEqual(
      fs.existsSync(tempPayloadFile),
      false,
      'Nenhum payload de ensaio deve existir no disco do repositório.'
    );
  });
});
