import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const WORKSPACE_ROOT = path.resolve('.');

const CANDIDATE_DEFINITIONS = [
  {
    relativePath: 'docs/sql/023a_event_planning_structural.sql',
    expectedHash: '279BF22D5CDED8366D77236684C777378BC488A3A296E6C94CEBB1038DEE237E',
    expectedOrder: 1,
  },
  {
    relativePath: 'docs/sql/023b_event_creation_security_hardening.sql',
    expectedHash: '634E21DC9D448529882721F3EE83B063BC56B8B442AA80716811A7B46FCD71B6',
    expectedOrder: 2,
  },
  {
    relativePath: 'docs/sql/025_event_planning_security_hardening.sql',
    expectedHash: '48A572FF2F1EBDD26099DEFE9EFFA6BDB24AF41E5BDC552EAC67903116E5D3BF',
    expectedOrder: 3,
  },
];

const WRAPPER_RELATIVE_PATH = 'docs/sql/025_atomic_event_planning_installer.sql';
const VULNERABLE_ORIGINAL_FILE = '023_event_planning_and_durations.sql';

const REQUIRED_PLANNING_COLUMNS = [
  'duration_policy',
  'program_status',
  'program_version',
  'published_at',
  'published_by_member_id',
];

/**
 * Remove comentários de linha (--) e blocos de um script SQL.
 */
function stripSqlComments(sqlText) {
  let result = sqlText.replace(/\/\*[\s\S]*?\*\//g, '');
  result = result.replace(/--.*$/gm, '');
  return result;
}

/**
 * Detecta comandos de controle transacional no nível do script (fora de funções PL/pgSQL).
 */
function findTopLevelTransactionCommands(sqlText) {
  // Remove blocos dollar-quoted ($$...$$ ou $tag$...$tag$)
  const withoutDollarQuotes = sqlText.replace(/\$([a-zA-Z0-9_]*)\$[\s\S]*?\$\1\$/g, ' ');
  const cleanSql = stripSqlComments(withoutDollarQuotes);

  const txMatches = [];
  const txRegex = /\b(BEGIN|COMMIT|ROLLBACK|START\s+TRANSACTION|END)\s*;/gi;
  let match;
  while ((match = txRegex.exec(cleanSql)) !== null) {
    txMatches.push({
      command: match[1].toUpperCase(),
      index: match.index,
    });
  }
  return txMatches;
}

/**
 * Extrai a lista ordenada de inclusões (\ir ou \i) em um script SQL.
 */
function extractIncludedFiles(sqlText) {
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
      });
    }
  }
  return includes;
}

/**
 * Validador estático contra a forma sintática inválida de IF em PL/pgSQL:
 * "if not (...) from pg_catalog... then" ou "if (...) from ... then"
 */
function detectInvalidIfFromSyntax(sqlText) {
  const clean = stripSqlComments(sqlText);
  const invalidRegex = /if\s+(?:not\s+)?\([\s\S]*?\)\s+from\s+[\s\S]*?\bthen\b/gi;
  const matches = [];
  let m;
  while ((m = invalidRegex.exec(clean)) !== null) {
    matches.push({
      snippet: m[0].substring(0, 80),
      index: m.index,
    });
  }
  return matches;
}

/**
 * Extrai o bloco do preflight_guard do texto do instalador.
 */
function extractPreflightBlock(sqlText) {
  const match = sqlText.match(/do\s+\$preflight_guard\$([\s\S]*?)\$preflight_guard\$;/i);
  return match ? match[1] : '';
}

/**
 * Extrai o bloco de post_install_verification do texto do instalador.
 */
function extractPostInstallBlock(sqlText) {
  const match = sqlText.match(/do\s+\$post_install_verification\$([\s\S]*?)\$post_install_verification\$;/i);
  return match ? match[1] : '';
}

/**
 * Verifica se todas as 5 colunas de planejamento são cobertas na guarda de preflight.
 */
function verifyPreflightCoversAllColumns(preflightSql) {
  const missing = [];
  for (const col of REQUIRED_PLANNING_COLUMNS) {
    // Exige o literal delimitado por aspas para não confundir 'duration_policy' com 'set_event_duration_policy'
    const colRegex = new RegExp(`['"]${col}['"]`, 'i');
    if (!colRegex.test(preflightSql)) {
      missing.push(col);
    }
  }
  return missing;
}

describe('Issue #57 — Validação Estática e Correção Focal da Instalação Atômica (023a + 023b + 025)', () => {

  test('1. Hashes SHA-256 dos três candidatos aprovados permanecem rigorosamente idênticos', () => {
    for (const cand of CANDIDATE_DEFINITIONS) {
      const fullPath = path.join(WORKSPACE_ROOT, cand.relativePath);
      assert.ok(fs.existsSync(fullPath), `Arquivo candidato ausente: ${cand.relativePath}`);

      const fileBuffer = fs.readFileSync(fullPath);
      const computedHash = crypto.createHash('sha256').update(fileBuffer).digest('hex').toUpperCase();

      assert.equal(
        computedHash,
        cand.expectedHash,
        `Hash SHA-256 divergente para ${cand.relativePath}. Esperado: ${cand.expectedHash}; Obtido: ${computedHash}`
      );
    }
  });

  test('2. Candidatos aprovados não devem conter comandos de transação BEGIN/COMMIT/ROLLBACK de topo', () => {
    for (const cand of CANDIDATE_DEFINITIONS) {
      const fullPath = path.join(WORKSPACE_ROOT, cand.relativePath);
      const content = fs.readFileSync(fullPath, 'utf8');
      const txCommands = findTopLevelTransactionCommands(content);

      assert.equal(
        txCommands.length,
        0,
        `Candidato ${cand.relativePath} contém comandos transacionais internos proibidos: ${JSON.stringify(txCommands)}`
      );
    }
  });

  test('3. Teste Adversarial / Detecção de Falha: Injeção de transação interna de topo é detectada', () => {
    const maliciousSql = `
      create table app_private.test_table (id int);
      COMMIT; -- injected commit
      create function test_func() returns void as $$ begin null; end; $$;
    `;
    const detected = findTopLevelTransactionCommands(maliciousSql);
    assert.equal(detected.length, 1, 'Deveria detectar o COMMIT de topo injetado');
    assert.equal(detected[0].command, 'COMMIT');
  });

  test('4. O invólucro atômico deve existir e conter configuração ON_ERROR_STOP on', () => {
    const wrapperPath = path.join(WORKSPACE_ROOT, WRAPPER_RELATIVE_PATH);
    assert.ok(fs.existsSync(wrapperPath), `Invólucro atômico não encontrado em: ${WRAPPER_RELATIVE_PATH}`);

    const wrapperContent = fs.readFileSync(wrapperPath, 'utf8');
    assert.match(
      wrapperContent,
      /\\set\s+ON_ERROR_STOP\s+on/i,
      'O invólucro deve declarar "\\set ON_ERROR_STOP on" para abortar no primeiro erro'
    );
  });

  test('5. Ordem da cadeia e referências aos candidatos no invólucro atômico', () => {
    const wrapperPath = path.join(WORKSPACE_ROOT, WRAPPER_RELATIVE_PATH);
    const wrapperContent = fs.readFileSync(wrapperPath, 'utf8');
    const includes = extractIncludedFiles(wrapperContent);

    assert.equal(includes.length, 3, 'O invólucro deve conter exatamente 3 diretivas de inclusão');

    // Ordem estrita: 023a -> 023b -> 025
    assert.equal(includes[0].fileName, '023a_event_planning_structural.sql', 'Primeiro deve ser 023a');
    assert.equal(includes[1].fileName, '023b_event_creation_security_hardening.sql', 'Segundo deve ser 023b');
    assert.equal(includes[2].fileName, '025_event_planning_security_hardening.sql', 'Terceiro deve ser 025');

    for (const inc of includes) {
      assert.equal(inc.directive, 'ir', `Diretiva de inclusão para ${inc.fileName} deve ser \\ir (include relative)`);
    }
  });

  test('6. Política de Baseline Preflight: Bloqueio estritamente fail-closed para RPCs, recibos e as 5 colunas antes dos \\ir', () => {
    const wrapperPath = path.join(WORKSPACE_ROOT, WRAPPER_RELATIVE_PATH);
    const wrapperContent = fs.readFileSync(wrapperPath, 'utf8');

    // JAMAIS deve incluir o arquivo vulnerável
    const includes = extractIncludedFiles(wrapperContent);
    const hasVulnerable = includes.some((inc) => inc.fileName === VULNERABLE_ORIGINAL_FILE);
    assert.equal(hasVulnerable, false, 'O invólucro JAMAIS deve incluir 023_event_planning_and_durations.sql');

    // Preflight deve ocorrer antes da primeira inclusão \ir efetiva
    assert.ok(includes.length > 0, 'Deve conter inclusões \\ir');
    const firstIrLine = includes[0].lineNumber;

    const lines = wrapperContent.split(/\r?\n/);
    let preflightLine = -1;
    for (let i = 0; i < lines.length; i++) {
      if (/do\s+\$preflight_guard\$/i.test(lines[i])) {
        preflightLine = i + 1;
        break;
      }
    }
    assert.ok(preflightLine > 0, 'Preflight guard deve existir');
    assert.ok(
      firstIrLine > preflightLine,
      `Preflight (linha ${preflightLine}) deve ser executado estritamente antes do primeiro \\ir (linha ${firstIrLine})`
    );

    const preflightBlock = extractPreflightBlock(wrapperContent);
    assert.ok(preflightBlock.length > 0, 'Bloco do preflight deve ser extraível');

    // 1. Rejeição de RPCs pré-existentes
    assert.match(
      preflightBlock,
      /RPC de planejamento pré-existente detectada/i,
      'Preflight deve abortar fail-closed se qualquer RPC pré-existir'
    );

    // 2. Rejeição da tabela de recibos pré-existente
    assert.match(
      preflightBlock,
      /Tabela app_private\.event_planning_receipts já existente/i,
      'Preflight deve abortar fail-closed se a tabela de recibos já existir'
    );

    // 3. Rejeição de colunas pré-existentes em app_private.events
    assert.match(
      preflightBlock,
      /Coluna de planejamento pré-existente detectada em app_private\.events/i,
      'Preflight deve abortar fail-closed se qualquer coluna de planejamento pré-existir'
    );

    // Confere que TODAS as 5 colunas estão cobertas no preflight
    const missingInPreflight = verifyPreflightCoversAllColumns(preflightBlock);
    assert.equal(
      missingInPreflight.length,
      0,
      `Preflight deve cobrir todas as 5 colunas de planejamento. Faltando: ${missingInPreflight.join(', ')}`
    );

    // NÃO deve usar heurística de inspeção textual em prosrc / functiondef
    assert.doesNotMatch(
      wrapperContent,
      /pg_get_functiondef/i,
      'Preflight NÃO deve usar pg_get_functiondef ou heurística frágil de busca textual em código'
    );

    // Cabeçalho deve declarar formalmente que "baseline limpo" exige simultaneamente as 3 ausências
    assert.match(
      wrapperContent,
      /SIMULTANEAMENTE/i,
      'Cabeçalho deve exigir simultaneidade das condições de baseline limpo'
    );
    assert.match(
      wrapperContent,
      /ausência\s+prévia\s+das\s+cinco\s+RPCs-alvo/i,
      'Cabeçalho deve declarar ausência prévia das cinco RPCs-alvo'
    );
    assert.match(
      wrapperContent,
      /ausência\s+da\s+tabela\s+app_private\.event_planning_receipts/i,
      'Cabeçalho deve declarar ausência da tabela de recibos'
    );
    assert.match(
      wrapperContent,
      /colunas\s+de\s+planejamento\s+em\s+app_private\.events/i,
      'Cabeçalho deve declarar ausência das cinco colunas em app_private.events'
    );
  });

  test('7. Contraprova em memória: Ausência de qualquer uma das 5 colunas na guarda de preflight faz o validador falhar', () => {
    const wrapperPath = path.join(WORKSPACE_ROOT, WRAPPER_RELATIVE_PATH);
    const wrapperContent = fs.readFileSync(wrapperPath, 'utf8');
    const preflightBlock = extractPreflightBlock(wrapperContent);

    for (const col of REQUIRED_PLANNING_COLUMNS) {
      // Simula a remoção da coluna da lista do preflight
      const simulatedIncomplete = preflightBlock.replace(new RegExp(`'${col}'`, 'g'), `'--removed--'`);
      const missing = verifyPreflightCoversAllColumns(simulatedIncomplete);
      assert.ok(
        missing.includes(col),
        `Validador deveria detectar a omissão da coluna ${col} na contraprova em memória`
      );
    }
  });

  test('8. Garantia de envoltória de transação única (sem confirmação intermediária)', () => {
    const wrapperPath = path.join(WORKSPACE_ROOT, WRAPPER_RELATIVE_PATH);
    const wrapperContent = fs.readFileSync(wrapperPath, 'utf8');
    const txCommands = findTopLevelTransactionCommands(wrapperContent);

    assert.equal(txCommands.length, 2, 'O invólucro deve conter exatamente 2 comandos de transação de topo');
    assert.equal(txCommands[0].command, 'BEGIN', 'Primeiro comando deve ser BEGIN');
    assert.equal(txCommands[1].command, 'COMMIT', 'Segundo comando deve ser COMMIT');

    const lines = wrapperContent.split(/\r?\n/);
    let beginLine = -1;
    let commitLine = -1;
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim().toLowerCase();
      if (trimmed.startsWith('begin;')) beginLine = i + 1;
      if (trimmed.startsWith('commit;')) commitLine = i + 1;
    }

    assert.ok(beginLine > 0, 'BEGIN deve estar presente');
    assert.ok(commitLine > beginLine, 'COMMIT deve estar após o BEGIN');

    const includes = extractIncludedFiles(wrapperContent);
    for (const inc of includes) {
      assert.ok(
        inc.lineNumber > beginLine && inc.lineNumber < commitLine,
        `Inclusão ${inc.fileName} (linha ${inc.lineNumber}) deve estar estritamente dentro da transação (entre ${beginLine} e ${commitLine})`
      );
    }
  });

  test('9. Sintaxe PL/pgSQL e auditoria completa de ACLs na pós-condição', () => {
    const wrapperPath = path.join(WORKSPACE_ROOT, WRAPPER_RELATIVE_PATH);
    const wrapperContent = fs.readFileSync(wrapperPath, 'utf8');

    // Verifica que o wrapper NÃO contém a sintaxe inválida "if not (...) from pg_catalog... then"
    const invalidSyntaxMatches = detectInvalidIfFromSyntax(wrapperContent);
    assert.equal(
      invalidSyntaxMatches.length,
      0,
      `Sintaxe inválida de IF em PL/pgSQL detectada no wrapper: ${JSON.stringify(invalidSyntaxMatches)}`
    );

    const postInstallBlock = extractPostInstallBlock(wrapperContent);
    assert.ok(postInstallBlock.length > 0, 'Bloco pós-instalação deve existir');

    // 1. Resolução fail-closed dos OIDs das roles obrigatórias
    assert.match(postInstallBlock, /select\s+oid\s+into\s+v_auth_role_oid\s+from\s+pg_catalog\.pg_roles\s+where\s+rolname\s*=\s*'authenticated'/i);
    assert.match(postInstallBlock, /select\s+oid\s+into\s+v_owner_role_oid\s+from\s+pg_catalog\.pg_roles\s+where\s+rolname\s*=\s*'postgres'/i);
    assert.match(postInstallBlock, /select\s+oid\s+into\s+v_anon_role_oid\s+from\s+pg_catalog\.pg_roles\s+where\s+rolname\s*=\s*'anon'/i);
    assert.match(postInstallBlock, /select\s+oid\s+into\s+v_service_role_oid\s+from\s+pg_catalog\.pg_roles\s+where\s+rolname\s*=\s*'service_role'/i);

    // 2. Uso de aclexplode para inspeção de ACL direta
    assert.match(postInstallBlock, /aclexplode\(coalesce\(pr\.proacl,\s*pg_catalog\.acldefault\('f',\s*pr\.proowner\)\)\)/i);

    // 3. Exigência de concessão direta a authenticated com is_grantable = false
    assert.match(postInstallBlock, /a\.grantee\s*=\s*v_auth_role_oid\s+and\s+a\.privilege_type\s*=\s*'EXECUTE'\s+and\s+a\.is_grantable\s*=\s*false/i);

    // 4. Rejeição de qualquer outro grantee fora do allowlist (v_auth_role_oid e proowner)
    assert.match(postInstallBlock, /a\.grantee\s+not\s+in\s*\(\s*v_auth_role_oid,\s*pr\.proowner\s*\)/i);

    // 5. Rejeição expressa de PUBLIC (grantee = 0)
    assert.match(postInstallBlock, /a\.grantee\s*=\s*0\s+and\s+a\.privilege_type\s*=\s*'EXECUTE'/i);

    // 6. Privilégio efetivo das roles conhecidas
    assert.match(postInstallBlock, /has_function_privilege\(v_auth_role_oid,\s*v_proc_oid,\s*'EXECUTE'\)/i);
    assert.match(postInstallBlock, /not\s+has_function_privilege\(v_anon_role_oid,\s*v_proc_oid,\s*'EXECUTE'\)/i);
    assert.match(postInstallBlock, /not\s+has_function_privilege\(v_service_role_oid,\s*v_proc_oid,\s*'EXECUTE'\)/i);
  });

  test('10. Contraprova estática: Injeção de role extraordinária fictícia na ACL direta é barrada pelo allowlist', () => {
    // Simula a lógica de allowlist contra uma role não autorizada (ex: OID 99999 = auditor_externo)
    const v_auth_role_oid = 1001;
    const v_owner_role_oid = 10;
    const extraordinaryRoleOid = 99999;

    const mockAclExplodeEntries = [
      { grantee: v_owner_role_oid, privilege_type: 'EXECUTE', is_grantable: false },
      { grantee: v_auth_role_oid, privilege_type: 'EXECUTE', is_grantable: false },
      { grantee: extraordinaryRoleOid, privilege_type: 'EXECUTE', is_grantable: false }, // role extraordinária
    ];

    // Lógica canônica de verificação de allowlist correspondente à linha SQL:
    // a.grantee not in (v_auth_role_oid, pr.proowner)
    const unauthorizedGrantees = mockAclExplodeEntries.filter(
      (a) => a.privilege_type === 'EXECUTE' && a.grantee !== v_auth_role_oid && a.grantee !== v_owner_role_oid
    );

    assert.equal(
      unauthorizedGrantees.length,
      1,
      'O allowlist de ACL deve detectar e barrar a concessão à role extraordinária'
    );
    assert.equal(unauthorizedGrantees[0].grantee, extraordinaryRoleOid);
  });

  test('11. Contrato operacional de execução: Rejeição de afirmação absoluta e exigência de delimitação psql -f vs \\i', () => {
    const wrapperPath = path.join(WORKSPACE_ROOT, WRAPPER_RELATIVE_PATH);
    const wrapperContent = fs.readFileSync(wrapperPath, 'utf8');

    // Rejeição estrita da expressão absoluta "ROLLBACK integral e imediato"
    assert.doesNotMatch(
      wrapperContent,
      /ROLLBACK\s+integral\s+e\s+imediato/i,
      'O cabeçalho NÃO deve conter a afirmação absoluta "ROLLBACK integral e imediato"'
    );

    // Exigência da delimitação contratual entre psql -f em sessão exclusiva e \i interativo
    assert.match(
      wrapperContent,
      /psql\s+-f/i,
      'O cabeçalho deve citar a execução não interativa por psql -f em sessão exclusiva como contrato a validar'
    );
    assert.match(
      wrapperContent,
      /sessão\s+interativa\s+persistente/i,
      'O cabeçalho deve explicitar o comportamento sob \\i em sessão interativa (modo não recomendado)'
    );
    assert.match(
      wrapperContent,
      /nenhum\s+estado\s+parcial\s+recebe\s+`?COMMIT`?/i,
      'O cabeçalho deve garantir que nenhum estado parcial recebe COMMIT'
    );
  });

  test('12. Declaração explícita no cabeçalho de limites estáticos (Parsing, Runtime, Execução e Grants Herdados não comprovados)', () => {
    const wrapperPath = path.join(WORKSPACE_ROOT, WRAPPER_RELATIVE_PATH);
    const wrapperContent = fs.readFileSync(wrapperPath, 'utf8');

    // Confere se o cabeçalho delimita formalmente o que somente um ensaio PostgreSQL pode comprovar
    assert.match(
      wrapperContent,
      /O que SOMENTE um ensaio dinâmico PostgreSQL poderá comprovar/i,
      'Cabeçalho deve declarar formalmente que comportamento dinâmico depende de ensaio PostgreSQL'
    );

    // Exige diretamente do wrapperContent a declaração explícita de limites estáticos
    assert.match(
      wrapperContent,
      /parsing\s+ou\s+compilação\s+pelo\s+PostgreSQL/i,
      'Cabeçalho deve declarar ausência de comprovação de parsing ou compilação pelo PostgreSQL'
    );
    assert.match(
      wrapperContent,
      /validade\s+semântica\s+PL\/pgSQL\s+em\s+runtime/i,
      'Cabeçalho deve declarar ausência de comprovação de validade semântica PL/pgSQL em runtime'
    );
    assert.match(
      wrapperContent,
      /execução\s+dinâmica\s+do\s+wrapper/i,
      'Cabeçalho deve declarar ausência de comprovação de execução dinâmica do wrapper'
    );

    // Confere a distinção explícita sobre grants herdados e default privileges
    assert.match(
      wrapperContent,
      /Ressalva sobre privilégios herdados e default privileges/i,
      'Cabeçalho deve distinguir ACL direta de privilégios herdados/default privileges'
    );

    // Contraprova local demonstrando que um cabeçalho sem essa declaração falharia
    const mockMissingDeclaration = wrapperContent.replace(
      /DECLARAÇÃO EXPLÍCITA DE LIMITES ESTÁTICOS:[\s\S]*?execução dinâmica do wrapper\./i,
      ''
    );
    assert.throws(
      () => {
        assert.match(
          mockMissingDeclaration,
          /parsing\s+ou\s+compilação\s+pelo\s+PostgreSQL/i
        );
      },
      (err) => {
        assert.ok(err instanceof assert.AssertionError, 'Deveria lançar AssertionError na ausência da declaração');
        return true;
      }
    );
  });

  test('13. Resolução integral determinística da composição em memória', () => {
    const wrapperPath = path.join(WORKSPACE_ROOT, WRAPPER_RELATIVE_PATH);
    const wrapperDir = path.dirname(wrapperPath);
    const wrapperContent = fs.readFileSync(wrapperPath, 'utf8');

    const lines = wrapperContent.split(/\r?\n/);
    const expandedParts = [];

    for (const line of lines) {
      const match = line.trim().match(/^\\ir\s+([^\s;]+)/i);
      if (match) {
        const targetRel = match[1];
        const targetFull = path.join(wrapperDir, targetRel);
        assert.ok(fs.existsSync(targetFull), `Arquivo incluído via \\ir não existe: ${targetFull}`);

        const candidateBytes = fs.readFileSync(targetFull);
        const candidateHash = crypto.createHash('sha256').update(candidateBytes).digest('hex').toUpperCase();

        const expectedCandidate = CANDIDATE_DEFINITIONS.find(
          (c) => path.basename(c.relativePath) === path.basename(targetRel)
        );
        assert.ok(expectedCandidate, `Arquivo inesperado incluído via \\ir: ${targetRel}`);
        assert.equal(candidateHash, expectedCandidate.expectedHash, `Hash incorreto para ${targetRel}`);

        expandedParts.push(`-- >>> EXPANSION START: ${targetRel} <<<`);
        expandedParts.push(candidateBytes.toString('utf8'));
        expandedParts.push(`-- >>> EXPANSION END: ${targetRel} <<<`);
      } else {
        expandedParts.push(line);
      }
    }

    const composedSql = expandedParts.join('\n');

    // Confere se as 5 funções estão no SQL expandido
    assert.match(composedSql, /create or replace function public\.create_church_event_edition/i);
    assert.match(composedSql, /create or replace function public\.reorder_event_items/i);
    assert.match(composedSql, /create or replace function public\.set_event_duration_policy/i);
    assert.match(composedSql, /create or replace function public\.publish_event_program/i);
    assert.match(composedSql, /create or replace function public\.save_event_program_draft/i);

    // Confere se todas as RPCs exigem READ COMMITTED
    const matchesReadCommitted = (composedSql.match(/current_setting\('transaction_isolation'\)\s*<>\s*'read committed'/g) || []);
    assert.equal(matchesReadCommitted.length, 5, 'Todas as 5 RPCs devem exigir READ COMMITTED no preâmbulo');

    // Confere se notify pgrst está presente no final
    assert.match(composedSql, /notify pgrst,\s*'reload schema'/i, 'Deve notificar recarga de schema para PostgREST');
  });

});
