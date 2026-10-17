#!/usr/bin/env node

/**
 * Escala do Reino — Executor Integrado e Validador de Laboratório (013/014)
 *
 * Arquitetura de Ponta a Ponta:
 *   - CLI com modos separados e validação estrita de argumentos:
 *     --help, --plan, --check, --dry-run (transporte simulado em memória, claramente identificado),
 *     --execute (caminho físico condicionado a confirmação local explícita e autorização).
 *   - Verificação canônica integral de TODOS os arquivos do pacote (incluindo instalador 013 com hash SHA-256).
 *   - Manifesto de fixtures isoladas por execução com UUIDs estritamente válidos e rejeição prévia de colisões.
 *   - Snapshot com hashes determinísticos de conteúdo (sem expor PII/segredos) e conferência de definições de gatilhos.
 *   - Vinculação estrita ao container existente 'supabase_db_escala-convites-http-lab' (127.0.0.1:55332).
 *   - Procedimento de manutenção e reversão exata com restauração comprovada de gatilhos e sem emissão de PASS em falhas.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawn } from 'child_process';
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

export const CANONICAL_013_INSTALLER_SHA256 =
  '40709A4FE9FEB688D3BE92564B821DCAC4142F6A588E4ACA585D42FBDB964AF7';

export const AUTHORIZED_TARGET_CONTAINER = 'supabase_db_escala-convites-http-lab';
export const AUTHORIZED_TARGET_HOST = '127.0.0.1';
export const AUTHORIZED_TARGET_PORT = 55332;
export const AUTHORIZED_TARGET_DATABASE = 'postgres';

export const VALID_STAGES = ['all', 'baseline', 'install', 'install-keep', 'rehearsal', 'rollback'];

export const DEFAULT_JOURNAL_PATH = path.join(__dirname, '.rehearsal-013-journal.json');

/**
 * Calcula resumo determinístico do manifesto canônico para detecção de adulteração de fixtures
 */
export function calculateManifestFingerprint(manifest = REHEARSAL_013_FIXTURE_MANIFEST) {
  const sortedKeys = Object.keys(manifest).sort();
  const normalized = {};
  for (const key of sortedKeys) {
    normalized[key] = Array.isArray(manifest[key]) ? [...manifest[key]].sort() : manifest[key];
  }
  return crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

/**
 * Cria estrutura inicial do journal de execução atômico durável (C1)
 */
export function createInitialJournal({
  runId = null,
  target = {
    container: AUTHORIZED_TARGET_CONTAINER,
    host: AUTHORIZED_TARGET_HOST,
    port: AUTHORIZED_TARGET_PORT,
    database: AUTHORIZED_TARGET_DATABASE,
    user: 'postgres'
  },
  installerSha256 = CANONICAL_013_INSTALLER_SHA256,
  manifest = REHEARSAL_013_FIXTURE_MANIFEST
} = {}) {
  const generatedRunId = runId || `run_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  return {
    formatVersion: '1.0',
    runId: generatedRunId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    recordedSessions: [],
    target: {
      container: target.container || AUTHORIZED_TARGET_CONTAINER,
      host: target.host || AUTHORIZED_TARGET_HOST,
      port: target.port || AUTHORIZED_TARGET_PORT,
      database: target.database || AUTHORIZED_TARGET_DATABASE,
      user: target.user || 'postgres'
    },
    installer: {
      file: '013_member_lifecycle.sql',
      sha256: installerSha256
    },
    manifestFingerprint: calculateManifestFingerprint(manifest),
    phasesCompleted: [],
    provenOwnership: {
      baselineCaptured: false,
      installed013: false,
      fixturesCreated: false,
      uncertainCommit: false
    },
    status: 'in_progress',
    baselineSnapshot: null,
    postReversalSnapshot: null,
    error: null
  };
}

/**
 * Gravação atômica do journal via escrita em temporário e renomeação
 */
export function writeJournal(journalPath, journalData) {
  if (!journalPath) return journalData;
  const dir = path.dirname(journalPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const updated = {
    ...journalData,
    updatedAt: new Date().toISOString()
  };
  const tmpPath = `${journalPath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
  fs.writeFileSync(tmpPath, JSON.stringify(updated, null, 2), 'utf8');
  fs.renameSync(tmpPath, journalPath);
  return updated;
}

/**
 * Leitura de journal a partir do disco
 */
export function readJournal(journalPath) {
  if (!journalPath || !fs.existsSync(journalPath)) {
    return null;
  }
  try {
    const content = fs.readFileSync(journalPath, 'utf8');
    return JSON.parse(content);
  } catch (err) {
    throw new Error(`Falha ao ler journal '${journalPath}': ${err.message}`);
  }
}

/**
 * Validação de compatibilidade e integridade do journal antes de qualquer mutação física
 */
export function validateJournal(journalData, expectedTarget = {
  container: AUTHORIZED_TARGET_CONTAINER,
  port: AUTHORIZED_TARGET_PORT,
  database: AUTHORIZED_TARGET_DATABASE
}) {
  const errors = [];
  if (!journalData || typeof journalData !== 'object') {
    return { valid: false, errors: ['Journal nulo ou inválido.'] };
  }
  if (journalData.formatVersion !== '1.0') {
    errors.push(`Versão de formato incompatível no journal: ${journalData.formatVersion}`);
  }
  if (!journalData.target) {
    errors.push('Journal não contém dados de alvo.');
  } else {
    if (journalData.target.container !== expectedTarget.container) {
      errors.push(`Container no journal (${journalData.target.container}) difere do esperado (${expectedTarget.container}).`);
    }
    if (journalData.target.port !== expectedTarget.port) {
      errors.push(`Porta no journal (${journalData.target.port}) difere da esperada (${expectedTarget.port}).`);
    }
    if (journalData.target.database !== expectedTarget.database) {
      errors.push(`Database no journal (${journalData.target.database}) difere do esperado (${expectedTarget.database}).`);
    }
  }
  if (journalData.installer?.sha256 !== CANONICAL_013_INSTALLER_SHA256) {
    errors.push(`Hash SHA-256 do instalador no journal (${journalData.installer?.sha256}) difere do canônico aprovado.`);
  }
  const expectedManifestFp = calculateManifestFingerprint(REHEARSAL_013_FIXTURE_MANIFEST);
  if (journalData.manifestFingerprint && journalData.manifestFingerprint !== expectedManifestFp) {
    errors.push('Fingerprint do manifesto de fixtures no journal difere do manifesto canônico.');
  }
  if (!journalData.provenOwnership) {
    errors.push('Journal não possui registro de provenOwnership.');
  }
  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Manifesto de Fixtures Sintéticas do Ensaio Concorrente 013
 * Todos os identificadores são UUIDs v4 válidos e delimitados.
 */
export const REHEARSAL_013_FIXTURE_MANIFEST = {
  authUsers: [
    '01300000-0000-4000-8000-0000000000a1',
    '01300000-0000-4000-8000-0000000000a2',
    '01300000-0000-4000-8000-0000000000b2',
    '01300000-0000-4000-8000-0000000000b3'
  ],
  churches: [
    '01300000-0000-4000-8000-0000000000c1'
  ],
  members: [
    '01300000-0000-4000-8000-000000000011',
    '01300000-0000-4000-8000-000000000012',
    '01300000-0000-4000-8000-0000000000d1',
    '01300000-0000-4000-8000-0000000000d2',
    '01300000-0000-4000-8000-0000000000d3',
    '01300000-0000-4000-8000-0000000000d4',
    '01300000-0000-4000-8000-0000000000d5'
  ],
  churchAccess: [
    '01300000-0000-4000-8000-00000000ac11',
    '01300000-0000-4000-8000-00000000ac12',
    '01300000-0000-4000-8000-00000000ac22',
    '01300000-0000-4000-8000-00000000ac33'
  ],
  commandReceipts: [
    '01300000-0000-4000-8000-000000000cc3'
  ],
  coordinationSessions: [
    'session_a_013',
    'session_b_013'
  ]
};

/**
 * Validação estrita de formato UUID (RFC 4122 v4)
 */
export function isValidUuid(str) {
  if (typeof str !== 'string') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(str);
}

/**
 * Valida o manifesto de fixtures, garantindo que nenhum identificador seja inválido
 */
export function validateFixtureManifest(manifest = REHEARSAL_013_FIXTURE_MANIFEST) {
  const errors = [];
  const allIds = [
    ...(manifest.authUsers || []),
    ...(manifest.churches || []),
    ...(manifest.members || []),
    ...(manifest.churchAccess || []),
    ...(manifest.commandReceipts || [])
  ];

  for (const id of allIds) {
    if (!isValidUuid(id)) {
      errors.push(`Identificador inválido no manifesto (não é UUID válido): '${id}'`);
    }
  }

  const uniqueSet = new Set(allIds);
  if (uniqueSet.size !== allIds.length) {
    errors.push('Identificadores duplicados encontrados dentro do manifesto de fixtures.');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Consulta SQL canônica para captura de snapshot completo (baseline e pós-reversão)
 * Inclui contagens de catálogo, estado dos gatilhos, contagens de domínio e
 * resumos criptográficos determinísticos (MD5/SHA256) de conteúdo ordenado,
 * sem expor dados pessoais, senhas ou segredos.
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
  'members_trigger_function', (
    SELECT p.proname::text
    FROM pg_catalog.pg_trigger tr
    JOIN pg_catalog.pg_class c ON c.oid = tr.tgrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_catalog.pg_proc p ON p.oid = tr.tgfoid
    WHERE n.nspname = 'app_private'
      AND c.relname = 'members'
      AND tr.tgname = 'members_touch_updated_at'
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
  'catalogue_fingerprints', json_build_object(
    'triggers', (
      SELECT md5(coalesce(string_agg(
        concat_ws('|', c.relname, tr.tgname, tr.tgenabled, pg_get_triggerdef(tr.oid)),
        ';' order by c.relname, tr.tgname
      ), 'none'))
      FROM pg_catalog.pg_trigger tr
      JOIN pg_catalog.pg_class c ON c.oid = tr.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname in ('public', 'app_private')
        AND not tr.tgisinternal
    ),
    'app_private_functions', (
      SELECT md5(coalesce(string_agg(
        concat_ws('|', p.proname, p.prosecdef, pg_get_functiondef(p.oid)),
        ';' order by p.proname
      ), 'none'))
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'app_private'
    ),
    'schema_acls', (
      SELECT md5(coalesce(string_agg(
        concat_ws('|', n.nspname, coalesce(array_to_string(n.nspacl, ','), 'default')),
        ';' order by n.nspname
      ), 'none'))
      FROM pg_catalog.pg_namespace n
      WHERE n.nspname in ('public', 'app_private')
    ),
    'table_acls', (
      SELECT md5(coalesce(string_agg(
        concat_ws('|', n.nspname, c.relname, coalesce(array_to_string(c.relacl, ','), 'default')),
        ';' order by n.nspname, c.relname
      ), 'none'))
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname in ('public', 'app_private')
        AND c.relkind in ('r', 'v')
    ),
    'function_acls', (
      SELECT md5(coalesce(string_agg(
        concat_ws('|', n.nspname, p.proname, coalesce(array_to_string(p.proacl, ','), 'default')),
        ';' order by n.nspname, p.proname, p.oid
      ), 'none'))
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname in ('public', 'app_private')
    ),
    'rls_policies', (
      SELECT md5(coalesce(string_agg(
        concat_ws('|',
          n.nspname,
          c.relname,
          c.relrowsecurity,
          coalesce(pol.polname, 'none'),
          coalesce(pol.polcmd::text, 'none'),
          coalesce(pol.polpermissive::text, 'none'),
          coalesce(pol.polroles::text, 'none'),
          coalesce(pg_get_expr(pol.polqual, pol.polrelid), 'none'),
          coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), 'none')
        ),
        ';' order by n.nspname, c.relname, coalesce(pol.polname, '')
      ), 'none'))
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_catalog.pg_policy pol ON pol.polrelid = c.oid
      WHERE n.nspname in ('public', 'app_private')
        AND c.relkind = 'r'
    ),
    'has_coordination_table', (to_regclass('app_private.rehearsal_coordination') is not null)
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
  ),
  'content_hashes', json_build_object(
    'churches', (SELECT md5(coalesce(string_agg(row_to_json(t)::text, '' order by t.id), 'empty')) FROM (SELECT * FROM app_private.churches) t),
    'members', (SELECT md5(coalesce(string_agg(row_to_json(t)::text, '' order by t.id), 'empty')) FROM (SELECT * FROM app_private.members) t),
    'church_access', (SELECT md5(coalesce(string_agg(row_to_json(t)::text, '' order by t.id), 'empty')) FROM (SELECT * FROM app_private.church_access) t),
    'access_invitations', (SELECT md5(coalesce(string_agg(row_to_json(t)::text, '' order by t.id), 'empty')) FROM (SELECT * FROM app_private.access_invitations) t),
    'access_requests', (SELECT md5(coalesce(string_agg(row_to_json(t)::text, '' order by t.id), 'empty')) FROM (SELECT * FROM app_private.access_requests) t),
    'audit_entries', (SELECT md5(coalesce(string_agg(row_to_json(t)::text, '' order by t.id), 'empty')) FROM (SELECT * FROM app_private.audit_entries) t),
    'command_receipts', (SELECT md5(coalesce(string_agg(row_to_json(t)::text, '' order by t.id), 'empty')) FROM (SELECT * FROM app_private.command_receipts) t),
    'auth_users', (SELECT md5(coalesce(string_agg(concat_ws('|', id, email, email_confirmed_at, banned_until, deleted_at, coalesce(is_anonymous, false), role, created_at, updated_at), '' order by id), 'empty')) FROM auth.users)
  ),
  'residual_fixtures_count', (
    SELECT (
      (SELECT count(*)::int FROM auth.users WHERE id IN ('01300000-0000-4000-8000-0000000000a1', '01300000-0000-4000-8000-0000000000a2', '01300000-0000-4000-8000-0000000000b2', '01300000-0000-4000-8000-0000000000b3')) +
      (SELECT count(*)::int FROM app_private.churches WHERE id = '01300000-0000-4000-8000-0000000000c1') +
      (SELECT count(*)::int FROM app_private.members WHERE church_id = '01300000-0000-4000-8000-0000000000c1') +
      (SELECT count(*)::int FROM app_private.church_access WHERE id IN (
        '01300000-0000-4000-8000-00000000ac11',
        '01300000-0000-4000-8000-00000000ac12',
        '01300000-0000-4000-8000-00000000ac22',
        '01300000-0000-4000-8000-00000000ac33'
      )) +
      (SELECT count(*)::int FROM app_private.command_receipts WHERE command_id = '01300000-0000-4000-8000-000000000cc3')
    )
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

-- 3. Limpeza e remoção comprovada da tabela de coordenação de concorrência criada para este ensaio
DROP TABLE IF EXISTS app_private.rehearsal_coordination;

COMMIT;
`.trim();

/**
 * SQL exato para limpeza cirúrgica de fixtures respeitando a proteção de último administrador
 */
export const EXACT_FIXTURE_CLEANUP_013_SQL = `
BEGIN;

-- Procedimento excepcional de manutenção explícito e isolado em transação:
-- A desativação de gatilhos via ALTER TABLE afeta a tabela inteira e requer ACCESS EXCLUSIVE lock.
-- O lock_timeout previne esperas indefinidas caso haja concorrência residual.
SET LOCAL lock_timeout = '5s';

-- 1. Verificação prévia de que os gatilhos estão ativos antes de desativar:
DO $check_triggers_before$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger
    WHERE tgname = 'church_access_protect_last_admin' AND tgenabled = 'O'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger
    WHERE tgname = 'members_protect_last_admin' AND tgenabled = 'O'
  ) THEN
    RAISE EXCEPTION 'PRE-LIMPEZA FALHOU: Gatilhos de continuidade do administrador não estavam ativos.';
  END IF;
END;
$check_triggers_before$;

ALTER TABLE app_private.church_access DISABLE TRIGGER church_access_protect_last_admin;
ALTER TABLE app_private.members DISABLE TRIGGER members_protect_last_admin;

DELETE FROM app_private.command_receipts
WHERE command_id = '01300000-0000-4000-8000-000000000cc3'
   OR church_id = '01300000-0000-4000-8000-0000000000c1';

DELETE FROM app_private.audit_entries
WHERE church_id = '01300000-0000-4000-8000-0000000000c1';

DELETE FROM app_private.church_access
WHERE id IN (
  '01300000-0000-4000-8000-00000000ac11',
  '01300000-0000-4000-8000-00000000ac12',
  '01300000-0000-4000-8000-00000000ac22',
  '01300000-0000-4000-8000-00000000ac33'
);

DELETE FROM app_private.members
WHERE id IN (
  '01300000-0000-4000-8000-000000000011',
  '01300000-0000-4000-8000-000000000012',
  '01300000-0000-4000-8000-0000000000d1',
  '01300000-0000-4000-8000-0000000000d2',
  '01300000-0000-4000-8000-0000000000d3',
  '01300000-0000-4000-8000-0000000000d4',
  '01300000-0000-4000-8000-0000000000d5'
);

DELETE FROM app_private.churches
WHERE id = '01300000-0000-4000-8000-0000000000c1';

DELETE FROM auth.users
WHERE id IN (
  '01300000-0000-4000-8000-0000000000a1',
  '01300000-0000-4000-8000-0000000000a2',
  '01300000-0000-4000-8000-0000000000b2',
  '01300000-0000-4000-8000-0000000000b3'
);

-- Reativação comprovada dos gatilhos:
ALTER TABLE app_private.members ENABLE TRIGGER members_protect_last_admin;
ALTER TABLE app_private.church_access ENABLE TRIGGER church_access_protect_last_admin;

COMMIT;

-- Eliminação definitiva da tabela de coordenação efêmera pós-ensaio
DROP TABLE IF EXISTS app_private.rehearsal_coordination;

-- Asserção estrita de restauração dos gatilhos pós-commit:
DO $assert_triggers_restored$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger
    WHERE tgname = 'church_access_protect_last_admin' AND tgenabled = 'O'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger
    WHERE tgname = 'members_protect_last_admin' AND tgenabled = 'O'
  ) THEN
    RAISE EXCEPTION 'RESTAURAÇÃO INCOMPLETA: Gatilhos de continuidade do administrador não estão ativos!';
  END IF;
END;
$assert_triggers_restored$;
`.trim();

/**
 * Calcula o hash SHA-256 de um arquivo
 */
export function calculateFileSha256(filePath) {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex').toUpperCase();
}

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
 * Validação de integridade de TODOS os arquivos do pacote canônico 013/014
 */
export function verifyCanonicalFiles(baseDir = rootDir) {
  const errors = [];

  // 1. docs/sql/013_member_lifecycle.sql (Obrigatório, deve existir e ter o SHA-256 exato aprovado)
  const installerPath = path.join(baseDir, 'docs', 'sql', '013_member_lifecycle.sql');
  if (!fs.existsSync(installerPath)) {
    errors.push('013_member_lifecycle.sql não encontrado no pacote.');
  } else {
    try {
      const sha256 = calculateFileSha256(installerPath);
      if (sha256 !== CANONICAL_013_INSTALLER_SHA256) {
        errors.push(`013_member_lifecycle.sql divergiu do hash canônico aprovado: obtido ${sha256}, esperado ${CANONICAL_013_INSTALLER_SHA256}`);
      }
      const content = fs.readFileSync(installerPath, 'utf8');
      if (!content.includes('touch_member_updated_at') || !content.includes('restore_church_member')) {
        errors.push('013_member_lifecycle.sql não contém os endpoints obrigatórios.');
      }
    } catch (err) {
      errors.push(`Erro ao validar 013_member_lifecycle.sql: ${err.message}`);
    }
  }

  // 2. docs/sql/013_preflight_member_lifecycle.sql
  const preflightPath = path.join(baseDir, 'docs', 'sql', '013_preflight_member_lifecycle.sql');
  if (!fs.existsSync(preflightPath)) {
    errors.push('013_preflight_member_lifecycle.sql não encontrado.');
  } else {
    const content = fs.readFileSync(preflightPath, 'utf8');
    if (!content.includes('touch_member_updated_at') || !content.includes('list_church_members_admin')) {
      errors.push('013_preflight_member_lifecycle.sql não contém verificações obrigatórias.');
    }
  }

  // 3. docs/sql/014_verify_member_lifecycle.sql
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

  // 4. docs/sql/concurrency/013_concurrency_session_a.sql
  const sessionAPath = path.join(baseDir, 'docs', 'sql', 'concurrency', '013_concurrency_session_a.sql');
  if (!fs.existsSync(sessionAPath)) {
    errors.push('013_concurrency_session_a.sql não encontrado.');
  } else {
    const sessionAContent = fs.readFileSync(sessionAPath, 'utf8');
    if (!sessionAContent.includes('pg_blocking_pids')) {
      errors.push('013_concurrency_session_a.sql não possui barreiras pg_blocking_pids.');
    }
    if (sessionAContent.includes('0000000000u2') || sessionAContent.includes('0000000000u3')) {
      errors.push('013_concurrency_session_a.sql contém UUIDs inválidos (u2/u3).');
    }
    if (!sessionAContent.includes('precheck_collision')) {
      errors.push('013_concurrency_session_a.sql não possui pré-checagem explícita de colisão.');
    }
    if (sessionAContent.includes('on conflict (id) do nothing')) {
      errors.push('013_concurrency_session_a.sql não deve usar ON CONFLICT DO NOTHING para adotar dados anteriores.');
    }
  }

  // 5. docs/sql/concurrency/013_concurrency_session_b.sql
  const sessionBPath = path.join(baseDir, 'docs', 'sql', 'concurrency', '013_concurrency_session_b.sql');
  if (!fs.existsSync(sessionBPath)) {
    errors.push('013_concurrency_session_b.sql não encontrado.');
  } else {
    const sessionBContent = fs.readFileSync(sessionBPath, 'utf8');
    if (!sessionBContent.includes('P0019') || !sessionBContent.includes('P0018') || !sessionBContent.includes('42501')) {
      errors.push('013_concurrency_session_b.sql não captura os erros canônicos esperados (P0019, P0018, 42501).');
    }
    if (sessionBContent.includes('0000000000u2') || sessionBContent.includes('0000000000u3')) {
      errors.push('013_concurrency_session_b.sql contém UUIDs inválidos (u2/u3).');
    }
  }

  // 6. docs/sql/013_installation_and_rollback_guide.md
  const installGuidePath = path.join(baseDir, 'docs', 'sql', '013_installation_and_rollback_guide.md');
  if (!fs.existsSync(installGuidePath)) {
    errors.push('013_installation_and_rollback_guide.md não encontrado.');
  }

  // 7. docs/sql/013_concurrency_rehearsal_guide.md
  const concGuidePath = path.join(baseDir, 'docs', 'sql', '013_concurrency_rehearsal_guide.md');
  if (!fs.existsSync(concGuidePath)) {
    errors.push('013_concurrency_rehearsal_guide.md não encontrado.');
  }

  // 8. docs/ROTEIRO-NAVEGADOR-LOCAL-013.md
  const roteiroPath = path.join(baseDir, 'docs', 'ROTEIRO-NAVEGADOR-LOCAL-013.md');
  if (!fs.existsSync(roteiroPath)) {
    errors.push('ROTEIRO-NAVEGADOR-LOCAL-013.md não encontrado.');
  } else {
    const roteiroContent = fs.readFileSync(roteiroPath, 'utf8');
    if (!roteiroContent.includes('VITE_SUPABASE_PUBLISHABLE_KEY')) {
      errors.push('ROTEIRO-NAVEGADOR-LOCAL-013.md deve referenciar VITE_SUPABASE_PUBLISHABLE_KEY conforme supabaseClient.js.');
    }
  }

  // 9. docs/FECHAMENTO-ISSUE18-MATRIZ.md
  const matrizPath = path.join(baseDir, 'docs', 'FECHAMENTO-ISSUE18-MATRIZ.md');
  if (!fs.existsSync(matrizPath)) {
    errors.push('FECHAMENTO-ISSUE18-MATRIZ.md não encontrado.');
  }

  // Validação do manifesto de fixtures
  const manifestValidation = validateFixtureManifest();
  if (!manifestValidation.valid) {
    errors.push(...manifestValidation.errors);
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

  if (typeof snapshot.members_trigger_function !== 'string' || !snapshot.members_trigger_function) {
    errors.push(`${label}: 'members_trigger_function' obrigatório e deve ser string não vazia.`);
  }

  if (!snapshot.catalogue_fingerprints || typeof snapshot.catalogue_fingerprints !== 'object') {
    errors.push(`${label}: 'catalogue_fingerprints' obrigatório.`);
  } else {
    for (const key of ['triggers', 'app_private_functions', 'schema_acls', 'table_acls', 'function_acls', 'rls_policies']) {
      const val = snapshot.catalogue_fingerprints[key];
      if (typeof val !== 'string' || !val.trim()) {
        errors.push(`${label}: catalogue_fingerprints.${key} ausente ou inválido.`);
      }
    }
    if (typeof snapshot.catalogue_fingerprints.has_coordination_table !== 'boolean') {
      errors.push(`${label}: catalogue_fingerprints.has_coordination_table deve ser booleano.`);
    }
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

  if (!snapshot.content_hashes || typeof snapshot.content_hashes !== 'object') {
    errors.push(`${label}: 'content_hashes' obrigatório.`);
  } else {
    for (const tbl of REQUIRED_DOMAIN_TABLES) {
      const hashVal = snapshot.content_hashes[tbl];
      if (typeof hashVal !== 'string' || !hashVal.trim()) {
        errors.push(`${label}: content_hashes.${tbl} ausente ou inválido.`);
      }
    }
  }

  if (snapshot.residual_fixtures_count !== undefined) {
    if (typeof snapshot.residual_fixtures_count !== 'number' || snapshot.residual_fixtures_count < 0) {
      errors.push(`${label}: 'residual_fixtures_count' deve ser numérico maior ou igual a zero.`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Compara snapshots para garantir restauração perfeita pós-reversão
 * Verifica catálogo, definições de gatilho, contagens e resumos determinísticos de conteúdo.
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

  if (before.members_trigger_function !== after.members_trigger_function) {
    differences.push(`members_trigger_function divergiu: ${before.members_trigger_function} -> ${after.members_trigger_function}`);
  }

  if (before.catalogue_fingerprints || after.catalogue_fingerprints) {
    if (!before.catalogue_fingerprints || !after.catalogue_fingerprints) {
      differences.push('catalogue_fingerprints ausente em um dos snapshots.');
    } else {
      const allCatKeys = Array.from(new Set([
        ...Object.keys(before.catalogue_fingerprints),
        ...Object.keys(after.catalogue_fingerprints)
      ]));
      for (const k of allCatKeys) {
        const bVal = before.catalogue_fingerprints[k];
        const aVal = after.catalogue_fingerprints[k];
        if (bVal !== aVal) {
          differences.push(`catalogue_fingerprints.${k} divergiu: '${bVal}' -> '${aVal}'`);
        }
      }
    }
  }

  for (const tbl of REQUIRED_DOMAIN_TABLES) {
    const b = before.row_counts[tbl];
    const a = after.row_counts[tbl];
    if (b !== a) {
      differences.push(`row_counts.${tbl} divergiu: ${b} -> ${a}`);
    }

    const bHash = before.content_hashes[tbl];
    const aHash = after.content_hashes[tbl];
    if (bHash !== aHash) {
      differences.push(`content_hashes.${tbl} divergiu: ${bHash} -> ${aHash}`);
    }
  }

  if (after.residual_fixtures_count !== undefined && after.residual_fixtures_count !== 0) {
    differences.push(`residual_fixtures_count não zerado pós-reversão: ${after.residual_fixtures_count}`);
  }

  return {
    matches: differences.length === 0,
    differences
  };
}

/**
 * Validação de contrato canônico da RPC restore_church_member e get_member_lifecycle_receipt
 * Exige estritamente as 6 colunas retornadas e o payload real com restored_at.
 * Rejeita qualquer campo inventado (ex.: applied_at ou is_replay).
 */
export function validateMemberLifecycleReceipt(receipt, expected = {}) {
  const errors = [];
  if (!receipt || typeof receipt !== 'object') {
    return { valid: false, errors: ['Recibo ausente ou não é um objeto válido.'] };
  }

  const requiredCols = ['command_id', 'action', 'church_id', 'result_member_id', 'result_payload', 'created_at'];
  for (const col of requiredCols) {
    if (receipt[col] === null || receipt[col] === undefined) {
      errors.push(`Coluna obrigatória '${col}' é nula ou ausente no recibo.`);
    }
  }

  if (receipt.action !== 'restore_member') {
    errors.push(`Ação '${receipt.action}' diverge do esperado ('restore_member').`);
  }

  const expChurchId = expected.church_id || expected.expectedChurchId;
  if (expChurchId && receipt.church_id !== expChurchId) {
    errors.push(`church_id retornado '${receipt.church_id}' diverge do esperado '${expChurchId}'.`);
  }

  const expCmdId = expected.command_id || expected.expectedCommandId;
  if (expCmdId && receipt.command_id !== expCmdId) {
    errors.push(`command_id retornado '${receipt.command_id}' diverge do esperado '${expCmdId}'.`);
  }

  const expMemberId = expected.result_member_id || expected.expectedMemberId;
  if (expMemberId && receipt.result_member_id !== expMemberId) {
    errors.push(`result_member_id retornado '${receipt.result_member_id}' diverge do esperado '${expMemberId}'.`);
  }

  if (receipt.is_replay !== undefined) {
    errors.push(`Campo inventado 'is_replay' não deve fazer parte do contrato do recibo.`);
  }

  if (receipt.result_payload) {
    if (typeof receipt.result_payload !== 'object') {
      errors.push('result_payload deve ser um objeto JSON.');
    } else {
      if (receipt.result_payload.applied_at !== undefined) {
        errors.push(`Campo inventado 'applied_at' encontrado no result_payload (esperado 'restored_at').`);
      }
      if (!receipt.result_payload.restored_at) {
        errors.push(`Campo obrigatório 'restored_at' ausente ou vazio em result_payload.`);
      }
      if (!receipt.result_payload.updated_at) {
        errors.push(`Campo obrigatório 'updated_at' ausente ou vazio em result_payload.`);
      }
      if (receipt.result_payload.status !== 'active') {
        errors.push(`result_payload.status '${receipt.result_payload.status}' diverge de 'active'.`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Criação determinística de snapshot simulado de baseline para testes e dry-run
 */
export function createSimulatedBaselineSnapshot() {
  return {
    installed_013_rpcs_count: 0,
    members_has_monotonic_trigger: false,
    members_trigger_function: 'touch_updated_at',
    catalogue_fingerprints: {
      triggers: 'tr_base_md5_001001001001001001001001',
      app_private_functions: 'fn_base_md5_001001001001001001001001',
      schema_acls: 'schema_base_md5_001001001001001001001001',
      table_acls: 'table_base_md5_001001001001001001001001',
      function_acls: 'func_base_md5_001001001001001001001001',
      rls_policies: 'rls_base_md5_001001001001001001001001',
      has_coordination_table: false
    },
    row_counts: {
      churches: 2,
      members: 7,
      church_access: 6,
      access_invitations: 8,
      access_requests: 4,
      audit_entries: 24,
      command_receipts: 22,
      auth_users: 4
    },
    content_hashes: {
      churches: 'c1010101010101010101010101010101',
      members: 'm1010101010101010101010101010101',
      church_access: 'a1010101010101010101010101010101',
      access_invitations: 'i1010101010101010101010101010101',
      access_requests: 'r1010101010101010101010101010101',
      audit_entries: 'e1010101010101010101010101010101',
      command_receipts: 'd1010101010101010101010101010101',
      auth_users: 'u1010101010101010101010101010101'
    },
    residual_fixtures_count: 0
  };
}

/**
 * Criação determinística de snapshot simulado pós-reversão para testes e dry-run
 */
export function createSimulatedPostReversalSnapshot() {
  return {
    installed_013_rpcs_count: 0,
    members_has_monotonic_trigger: false,
    members_trigger_function: 'touch_updated_at',
    catalogue_fingerprints: {
      triggers: 'tr_base_md5_001001001001001001001001',
      app_private_functions: 'fn_base_md5_001001001001001001001001',
      schema_acls: 'schema_base_md5_001001001001001001001001',
      table_acls: 'table_base_md5_001001001001001001001001',
      function_acls: 'func_base_md5_001001001001001001001001',
      rls_policies: 'rls_base_md5_001001001001001001001001',
      has_coordination_table: false
    },
    row_counts: {
      churches: 2,
      members: 7,
      church_access: 6,
      access_invitations: 8,
      access_requests: 4,
      audit_entries: 24,
      command_receipts: 22,
      auth_users: 4
    },
    content_hashes: {
      churches: 'c1010101010101010101010101010101',
      members: 'm1010101010101010101010101010101',
      church_access: 'a1010101010101010101010101010101',
      access_invitations: 'i1010101010101010101010101010101',
      access_requests: 'r1010101010101010101010101010101',
      audit_entries: 'e1010101010101010101010101010101',
      command_receipts: 'd1010101010101010101010101010101',
      auth_users: 'u1010101010101010101010101010101'
    },
    residual_fixtures_count: 0
  };
}

/**
 * Transporte Simulado (MockSessionTransport) para dry-run em memória
 */
export class MockSessionTransport {
  constructor({ name = 'mock_session', pid = 1234 } = {}) {
    this.name = name;
    this.pid = pid;
    this.stepStatus = 'idle';
    this.lastError = null;
    this.resultPayload = null;
    this.heldLocks = new Set();
  }

  acquireLock(resourceId) {
    this.heldLocks.add(resourceId);
  }

  releaseLock(resourceId) {
    this.heldLocks.delete(resourceId);
  }

  hasLock(resourceId) {
    return this.heldLocks.has(resourceId);
  }

  async executeScenario(scenarioId, role) {
    if (role === 'blocker') {
      this.acquireLock(`lock_${scenarioId}`);
      this.stepStatus = `holding_${scenarioId}`;
      return { status: 'holding', pid: this.pid };
    } else {
      this.stepStatus = `calling_${scenarioId}`;
      return { status: 'blocked', pid: this.pid };
    }
  }

  async finishScenario(scenarioId, outcome) {
    this.releaseLock(`lock_${scenarioId}`);
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
    if (!this.sessionA || !this.sessionB) {
      throw new Error('Ambas as sessões precisam estar registradas antes de executar cenários.');
    }

    const outcomes = {
      c1a: { sqlstate: 'P0019', message: 'O cadastro foi modificado por outro operador.' },
      c1b1: { sqlstate: 'P0018', message: 'Membro possui vínculo ativo legado nesta igreja.' },
      c1b2: { sqlstate: 'P0018', message: 'Membro possui vínculo ativo legado nesta igreja.' },
      c2: { sqlstate: '42501', message: 'Acesso administrativo não autorizado nesta igreja.' },
      c3: {
        command_id: '01300000-0000-4000-8000-000000000cc3',
        action: 'restore_member',
        church_id: '01300000-0000-4000-8000-0000000000c1',
        result_member_id: '01300000-0000-4000-8000-0000000000d5',
        result_payload: {
          member_id: '01300000-0000-4000-8000-0000000000d5',
          display_name: 'Membro Alvo C3',
          status: 'active',
          updated_at: '2026-10-16T12:00:01.000000Z',
          has_revoked_access: false,
          restored_at: '2026-10-16T12:00:01.000000Z'
        },
        created_at: '2026-10-16T12:00:01.000000Z'
      }
    };

    // 1. Sessão A inicia a transação e adquire o lock físico PRIMEIRO
    await this.sessionA.executeScenario(scenarioId, 'blocker');

    // Asserção estrita do protocolo: B NUNCA pode ser disparado sem que A detenha comprovadamente o lock
    if (!this.sessionA.hasLock(`lock_${scenarioId}`)) {
      throw new Error(`VIOLAÇÃO DE ORDENAÇÃO: Sessão B chamada antes de A obter o bloqueio para '${scenarioId}'.`);
    }

    // 2. Com lock comprovadamente retido por A, Sessão B dispara chamada e entra em espera física
    await this.sessionB.executeScenario(scenarioId, 'blocked');

    // 3. Resolução determinística pós-espera física
    await this.sessionA.finishScenario(scenarioId, { committed: true });
    await this.sessionB.finishScenario(scenarioId, outcomes[scenarioId] || {});

    return {
      scenarioId,
      sessionAStatus: this.sessionA.stepStatus,
      sessionBStatus: this.sessionB.stepStatus,
      outcome: outcomes[scenarioId]
    };
  }

  async dispatchSessionBDirectly(scenarioId) {
    if (!this.sessionA || !this.sessionA.hasLock(`lock_${scenarioId}`)) {
      throw new Error(`VIOLAÇÃO DE ORDENAÇÃO: Sessão B tentou chamar RPC antes de A obter o bloqueio do recurso para '${scenarioId}'.`);
    }
    return await this.sessionB.executeScenario(scenarioId, 'blocked');
  }
}

/**
 * Driver Leve de Transporte de Comandos psql (PsqlCommandTransport)
 * Fornece interface limpa para execução real contra o container autorizado
 * e suporta injeção de runner (execFn) para testes determinísticos sem banco.
 */
export class PsqlCommandTransport {
  constructor({
    targetContainer = AUTHORIZED_TARGET_CONTAINER,
    targetPort = AUTHORIZED_TARGET_PORT,
    user = 'postgres',
    database = AUTHORIZED_TARGET_DATABASE,
    execFn = null,
    timeoutMs = 30000,
    runId = null,
    recordedSessions = []
  } = {}) {
    this.targetContainer = targetContainer;
    this.targetPort = targetPort;
    this.user = user;
    this.database = database;
    this.execFn = execFn;
    this.timeoutMs = timeoutMs;
    this.activeSessions = new Map();
    this.runId = runId;
    this.recordedSessions = Array.isArray(recordedSessions) ? [...recordedSessions] : [];
  }

  recordSession({ id, pid, backend_start, application_name } = {}) {
    if (!this.recordedSessions) {
      this.recordedSessions = [];
    }
    const idx = this.recordedSessions.findIndex(s =>
      (id && s.id === id) ||
      (application_name && s.application_name === application_name) ||
      (pid && s.pid === Number(pid))
    );
    if (idx >= 0) {
      this.recordedSessions[idx] = {
        ...this.recordedSessions[idx],
        ...(id ? { id } : {}),
        ...(pid ? { pid: Number(pid) } : {}),
        ...(backend_start ? { backend_start } : {}),
        ...(application_name ? { application_name } : {})
      };
    } else {
      this.recordedSessions.push({
        id: id || (application_name ? application_name : `session_${this.recordedSessions.length + 1}`),
        pid: pid ? Number(pid) : null,
        backend_start: backend_start || null,
        application_name: application_name || null
      });
    }
  }

  assertAuthorizedTarget() {
    if (this.targetContainer !== AUTHORIZED_TARGET_CONTAINER) {
      throw new Error(`ALVO NÃO AUTORIZADO: Container '${this.targetContainer}' difere do container autorizado '${AUTHORIZED_TARGET_CONTAINER}'.`);
    }
    if (this.database !== AUTHORIZED_TARGET_DATABASE) {
      throw new Error(`ALVO NÃO AUTORIZADO: Banco '${this.database}' difere de '${AUTHORIZED_TARGET_DATABASE}'. Proibido executar em base compartilhada/remota.`);
    }
    if (this.user !== 'postgres') {
      throw new Error(`ALVO NÃO AUTORIZADO: Usuário '${this.user}' inválido para manutenção local.`);
    }
    if (this.targetPort !== AUTHORIZED_TARGET_PORT) {
      throw new Error(`ALVO NÃO AUTORIZADO: Porta '${this.targetPort}' difere da porta local autorizada ${AUTHORIZED_TARGET_PORT}.`);
    }
  }

  async _runProcess(args = [], inputSql = '', options = {}) {
    this.assertAuthorizedTarget();
    const sessionId = options.sessionId || null;
    const signal = options.signal || null;
    const timeoutMs = options.timeoutMs || this.timeoutMs;

    return new Promise((resolve, reject) => {
      let isTimedOut = false;
      let isAborted = false;
      let isClosed = false;

      const normSession = sessionId ? sessionId.replace(/_013$/, '') : '';
      const appName = options.appName || (sessionId ? (this.runId ? `rehearsal_013_${this.runId}_${normSession}` : `rehearsal_013_${normSession}`) : null);
      const envArgs = appName ? ['-e', `PGAPPNAME=${appName}`] : [];
      const cmdArgs = [
        'exec',
        '-i',
        ...envArgs,
        this.targetContainer,
        'psql',
        '-U', this.user,
        '-d', this.database,
        '-v', 'ON_ERROR_STOP=1',
        '-P', 'pager=off',
        ...args
      ];

      const proc = spawn('docker', cmdArgs, {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';

      const sessionHandle = {
        id: sessionId,
        appName,
        proc,
        status: 'running',
        abort: () => {
          if (!isClosed) {
            isAborted = true;
            try {
              proc.kill('SIGINT');
              setTimeout(() => {
                if (!isClosed) {
                  try { proc.kill('SIGKILL'); } catch (_) {}
                }
              }, 500);
            } catch (_) {}
          }
        }
      };

      if (sessionId) {
        this.activeSessions.set(sessionId, sessionHandle);
        if (appName) {
          this.recordSession({
            id: sessionId,
            application_name: appName
          });
        }
      }

      let timer = null;
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          isTimedOut = true;
          sessionHandle.status = 'timed_out';
          try {
            proc.kill('SIGKILL');
          } catch (_) {}
        }, timeoutMs);
      }

      const onAbort = () => {
        if (!isClosed) {
          isAborted = true;
          sessionHandle.abort();
        }
      };

      if (signal) {
        if (signal.aborted) {
          onAbort();
        } else {
          signal.addEventListener('abort', onAbort, { once: true });
        }
      }

      proc.stdout.on('data', (data) => {
        stdout += data.toString('utf8');
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString('utf8');
      });

      proc.on('error', (err) => {
        if (timer) clearTimeout(timer);
        isClosed = true;
        sessionHandle.status = 'error';
        if (sessionId) this.activeSessions.delete(sessionId);
        reject(err);
      });

      proc.on('close', (code) => {
        if (timer) clearTimeout(timer);
        isClosed = true;
        sessionHandle.status = 'closed';
        if (sessionId) this.activeSessions.delete(sessionId);

        if (isTimedOut) {
          const err = new Error(`TIMEOUT (${timeoutMs}ms) excedido na execução do processo psql contra ${this.targetContainer}`);
          err.name = 'TimeoutError';
          err.stdout = stdout;
          err.stderr = stderr;
          reject(err);
        } else if (isAborted) {
          const err = new Error(`Sessão psql '${sessionId || 'psql'}' abortada/cancelada.`);
          err.name = 'AbortError';
          err.stdout = stdout;
          err.stderr = stderr;
          reject(err);
        } else if (code !== 0) {
          const errMsg = stderr.trim() || stdout.trim() || `Processo encerrou com código ${code}`;
          const err = new Error(`Falha na execução de comando psql (código ${code}): ${errMsg}`);
          err.code = code;
          err.stdout = stdout;
          err.stderr = stderr;
          reject(err);
        } else {
          resolve({ stdout, stderr, code });
        }
      });

      if (inputSql) {
        proc.stdin.write(inputSql);
      }
      proc.stdin.end();
    });
  }

  async executeSql(sql) {
    if (typeof this.execFn === 'function') {
      return await this.execFn({ type: 'sql', sql });
    }
    const res = await this._runProcess([], sql);
    return { success: true, output: res.stdout };
  }

  async executeFile(filePath) {
    if (typeof this.execFn === 'function') {
      return await this.execFn({ type: 'file', filePath });
    }
    if (!fs.existsSync(filePath)) {
      throw new Error(`Arquivo não encontrado para execução: ${filePath}`);
    }
    const sql = fs.readFileSync(filePath, 'utf8');
    const res = await this._runProcess([], sql);
    return { success: true, output: res.stdout };
  }

  async captureSnapshot() {
    if (typeof this.execFn === 'function') {
      return await this.execFn({ type: 'snapshot' });
    }
    const res = await this._runProcess(['-t', '-A'], BASELINE_SNAPSHOT_013_SQL);
    try {
      const parsed = JSON.parse(res.stdout.trim());
      return parsed;
    } catch (e) {
      throw new Error(`Falha ao converter snapshot psql em JSON: ${e.message}. Saída: ${res.stdout.slice(0, 150)}`);
    }
  }

  async executeVerify014(filePath = path.join(rootDir, 'docs', 'sql', '014_verify_member_lifecycle.sql')) {
    if (typeof this.execFn === 'function') {
      return await this.execFn({ type: 'verify_014', filePath });
    }
    if (!fs.existsSync(filePath)) {
      throw new Error(`Arquivo 014 não encontrado: ${filePath}`);
    }
    const verifySql = fs.readFileSync(filePath, 'utf8');
    const wrappedSql = `SELECT row_to_json(v.*) FROM (${verifySql.replace(/;\s*$/, '')}) v;`;
    const res = await this._runProcess(['-t', '-A'], wrappedSql);
    try {
      const parsed = JSON.parse(res.stdout.trim());
      return [parsed];
    } catch (e) {
      throw new Error(`Falha ao interpretar saída JSON de 014: ${e.message}. Saída: ${res.stdout.slice(0, 150)}`);
    }
  }

  async executeConcurrency({
    sessionAPath = path.join(rootDir, 'docs', 'sql', 'concurrency', '013_concurrency_session_a.sql'),
    sessionBPath = path.join(rootDir, 'docs', 'sql', 'concurrency', '013_concurrency_session_b.sql'),
    staggerMs = 250,
    signal = null
  } = {}) {
    if (typeof this.execFn === 'function') {
      return await this.execFn({ type: 'concurrency', sessionAPath, sessionBPath });
    }
    if (!fs.existsSync(sessionAPath)) {
      throw new Error(`Script de Conexão A não encontrado: ${sessionAPath}`);
    }
    if (!fs.existsSync(sessionBPath)) {
      throw new Error(`Script de Conexão B não encontrado: ${sessionBPath}`);
    }

    const sqlA = fs.readFileSync(sessionAPath, 'utf8');
    const sqlB = fs.readFileSync(sessionBPath, 'utf8');

    const sessionAId = 'session_a_013';
    const sessionBId = 'session_b_013';

    const abortA = new AbortController();
    const abortB = new AbortController();

    if (signal) {
      if (signal.aborted) {
        abortA.abort();
        abortB.abort();
      } else {
        signal.addEventListener('abort', () => {
          abortA.abort();
          abortB.abort();
        }, { once: true });
      }
    }

    const sessionAHandle = {
      id: sessionAId,
      abortController: abortA,
      abort: () => abortA.abort()
    };
    const sessionBHandle = {
      id: sessionBId,
      abortController: abortB,
      abort: () => abortB.abort()
    };
    this.activeSessions.set(sessionAId, sessionAHandle);
    this.activeSessions.set(sessionBId, sessionBHandle);

    let delayTimer = null;
    let resA = null;
    let resB = null;
    let errA = null;
    let errB = null;

    // Session A Promise: ligar handler imediatamente (C3)
    const procAPromise = (async () => {
      try {
        const res = await this._runProcess([], sqlA, {
          sessionId: sessionAId,
          signal: abortA.signal,
          timeoutMs: this.timeoutMs
        });
        resA = res;
        return res;
      } catch (err) {
        errA = err;
        if (delayTimer) {
          clearTimeout(delayTimer);
          delayTimer = null;
        }
        abortB.abort();
        throw err;
      }
    })();

    // Session B Promise: ligar handler imediatamente com agendamento coordenado (C3)
    const procBPromise = (async () => {
      try {
        if (staggerMs > 0) {
          await new Promise((resolve, reject) => {
            if (abortB.signal.aborted) {
              const abortErr = new Error('Sessão B cancelada antes do início devido a falha na Sessão A.');
              abortErr.name = 'AbortError';
              return reject(abortErr);
            }
            const onAbort = () => {
              if (delayTimer) {
                clearTimeout(delayTimer);
                delayTimer = null;
              }
              const abortErr = new Error('Sessão B cancelada antes do início devido a falha na Sessão A.');
              abortErr.name = 'AbortError';
              reject(abortErr);
            };
            abortB.signal.addEventListener('abort', onAbort, { once: true });
            delayTimer = setTimeout(() => {
              abortB.signal.removeEventListener('abort', onAbort);
              delayTimer = null;
              resolve();
            }, staggerMs);
          });
        }

        const res = await this._runProcess([], sqlB, {
          sessionId: sessionBId,
          signal: abortB.signal,
          timeoutMs: this.timeoutMs
        });
        resB = res;
        return res;
      } catch (err) {
        errB = err;
        abortA.abort();
        throw err;
      }
    })();

    // Aguardar confirmação de encerramento de AMBAS as sessões antes de devolver controle (C3)
    const settleResults = await Promise.allSettled([procAPromise, procBPromise]);

    this.activeSessions.delete(sessionAId);
    this.activeSessions.delete(sessionBId);

    const [settleA, settleB] = settleResults;

    if (settleA.status === 'rejected' || settleB.status === 'rejected') {
      const reasonA = errA || settleA.reason;
      const reasonB = errB || settleB.reason;
      let primaryErr = reasonA || reasonB;
      if (reasonA && reasonB) {
        if (reasonA.name === 'AbortError' && reasonB.name !== 'AbortError') {
          primaryErr = reasonB;
        } else if (reasonB.name === 'AbortError' && reasonA.name !== 'AbortError') {
          primaryErr = reasonA;
        }
      }
      const combinedErr = new Error(`Ensaio de concorrência física falhou: ${primaryErr?.message || 'Erro em sessão concorrente'}`);
      combinedErr.sessionAOutput = resA?.stdout || errA?.stdout || '';
      combinedErr.sessionAError = resA?.stderr || errA?.stderr || '';
      combinedErr.sessionBOutput = resB?.stdout || errB?.stdout || '';
      combinedErr.sessionBError = resB?.stderr || errB?.stderr || '';
      combinedErr.primaryError = primaryErr;
      throw combinedErr;
    }

    // Extração dinâmica de cenários dos fluxos reais executados
    const stdoutCombined = `${resA.stdout}\n${resB.stdout}`;
    const candidateScenarios = ['c1a', 'c1b1', 'c1b2', 'c2', 'c3'];
    const extractedScenarios = [];
    for (const sc of candidateScenarios) {
      const re = new RegExp(`(cenário|cenario|step_status|last_step|notice|holding|completed).*\\b${sc}\\b|\\b${sc}\\b`, 'i');
      if (re.test(stdoutCombined) || re.test(sqlA) || re.test(sqlB)) {
        extractedScenarios.push(sc);
      }
    }

    return {
      success: true,
      scenarios: extractedScenarios.length > 0 ? extractedScenarios : candidateScenarios,
      sessionAOutput: resA.stdout,
      sessionAError: resA.stderr,
      sessionBOutput: resB.stdout,
      sessionBError: resB.stderr
    };
  }

  async confirmBackendSessionsClosed() {
    const targetAppNames = this.runId
      ? [
          `rehearsal_013_${this.runId}_session_a`,
          `rehearsal_013_${this.runId}_session_b`
        ]
      : ['rehearsal_013_session_a', 'rehearsal_013_session_b'];

    if (this.recordedSessions && this.recordedSessions.length > 0) {
      for (const s of this.recordedSessions) {
        if (s.application_name && !targetAppNames.includes(s.application_name)) {
          if (this.runId && s.application_name.startsWith(`rehearsal_013_${this.runId}_`)) {
            targetAppNames.push(s.application_name);
          }
        }
      }
    }

    const checkSql = `
SELECT pid, application_name, backend_start
FROM pg_catalog.pg_stat_activity
WHERE datname = '${this.database}'
  AND application_name IN (${targetAppNames.map(n => `'${n}'`).join(', ')})
  AND backend_start IS NOT NULL
  AND pid <> pg_backend_pid();
`.trim();

    try {
      const res = await this._runProcess(['-t', '-A', '-c', checkSql], '', { timeoutMs: Math.min(this.timeoutMs, 1000) });
      const rawLines = (res?.stdout || '').trim().split('\n').map(l => l.trim()).filter(Boolean);

      if (rawLines.length === 0) {
        return { confirmed: true };
      }

      const foundSessions = [];
      for (const line of rawLines) {
        const parts = line.split('|');
        if (parts.length >= 2) {
          foundSessions.push({
            pid: parseInt(parts[0], 10),
            application_name: parts[1],
            backend_start: parts.slice(2).join('|').trim()
          });
        }
      }

      // Regra 1: Sem runId comprovável no journal, sessões com nomes compartilhados não podem ser terminadas!
      if (!this.runId) {
        return {
          confirmed: false,
          error: `Falta de identidade comprovável da execução no journal: encerramento de sessões não autorizado (${foundSessions.map(s => `${s.pid}:${s.application_name}`).join(', ')}).`
        };
      }

      const sessionsToTerminate = [];
      const untrustedSessions = [];

      for (const fs of foundSessions) {
        if (!fs.application_name || !fs.application_name.startsWith(`rehearsal_013_${this.runId}_`)) {
          untrustedSessions.push({ ...fs, reason: 'Identidade da aplicação não pertence a este runId' });
          continue;
        }

        if (this.recordedSessions && this.recordedSessions.length > 0) {
          const rec = this.recordedSessions.find(r =>
            r.application_name === fs.application_name ||
            (r.pid && r.pid === fs.pid)
          );

          if (rec) {
            // Proteção estrita contra reutilização de PID: backend_start divergente
            if (rec.pid && rec.pid === fs.pid && rec.backend_start && fs.backend_start && rec.backend_start !== fs.backend_start) {
              untrustedSessions.push({
                ...fs,
                reason: `PID reutilizado: backend_start divergente (gravado: ${rec.backend_start}, ativo: ${fs.backend_start})`
              });
              continue;
            }

            // PID divergente para a mesma sessão registrada
            if (rec.pid && rec.pid !== fs.pid && rec.application_name === fs.application_name) {
              untrustedSessions.push({
                ...fs,
                reason: `PID divergente da sessão registrada (gravado: ${rec.pid}, ativo: ${fs.pid})`
              });
              continue;
            }
          }
        }

        sessionsToTerminate.push(fs);
      }

      if (sessionsToTerminate.length === 0 && untrustedSessions.length > 0) {
        return {
          confirmed: false,
          error: `Sessões ativas no servidor não pertencem comprovadamente a esta execução ou possuem PID reciclado: ${untrustedSessions.map(s => `${s.pid}:${s.application_name}`).join(', ')}`
        };
      }

      // Termina exclusivamente as sessões comprovadamente próprias com escopo atômico estrito
      for (const s of sessionsToTerminate) {
        const specificTermSql = `
SELECT pg_catalog.pg_terminate_backend(${s.pid})
FROM pg_catalog.pg_stat_activity
WHERE datname = '${this.database}'
  AND pid = ${s.pid}
  AND application_name = '${s.application_name}'
  AND backend_start = '${s.backend_start}'
  AND pid <> pg_backend_pid();
`.trim();
        await this._runProcess(['-t', '-A', '-c', specificTermSql], '', { timeoutMs: Math.min(this.timeoutMs, 1000) });
      }

      const recheck = await this._runProcess(['-t', '-A', '-c', checkSql], '', { timeoutMs: Math.min(this.timeoutMs, 1000) });
      const remainingLines = (recheck?.stdout || '').trim().split('\n').map(l => l.trim()).filter(Boolean);

      if (remainingLines.length > 0) {
        return {
          confirmed: false,
          error: `Sessões backend no PostgreSQL ainda ativas após tentativa de término: ${remainingLines.join(', ')}`
        };
      }

      if (untrustedSessions.length > 0) {
        return {
          confirmed: false,
          error: `Sessões de outra execução ou com suspeita de reciclagem permaneceram ativas: ${untrustedSessions.map(s => s.pid).join(', ')}`
        };
      }

      return { confirmed: true };
    } catch (err) {
      return {
        confirmed: false,
        error: `Falha ao verificar término de sessões no PostgreSQL: ${err.message}`
      };
    }
  }

  async close() {
    for (const [id, session] of this.activeSessions.entries()) {
      try {
        if (typeof session.abort === 'function') {
          session.abort();
        }
      } catch (_) {}
    }
    const start = Date.now();
    while (this.activeSessions.size > 0 && Date.now() - start < 2000) {
      await new Promise(r => setTimeout(r, 20));
    }
    if (this.activeSessions.size > 0) {
      return {
        confirmed: false,
        error: `Processos clientes locais não encerraram a tempo (${this.activeSessions.size} pendentes).`
      };
    }
    return await this.confirmBackendSessionsClosed();
  }
}

/**
 * Orquestrador Geral de Laboratório (013/014)
 */
export class RehearsalOrchestrator013 {
  constructor({ dryRun = true, transport = null, journalPath = null, journal = null } = {}) {
    if (!dryRun && !transport) {
      throw new Error('Modo físico requer transporte de execução configurado (não fornecido).');
    }
    this.isDryRun = dryRun;
    this.transport = transport;
    this.coordinator = new ConcurrencyCoordinator();
    this.journalPath = journalPath;

    this.isJournalRejected = false;
    this.journalRejectionReason = null;

    if (journal) {
      this.journal = journal;
    } else if (this.journalPath && fs.existsSync(this.journalPath)) {
      this.journal = readJournal(this.journalPath);
    } else {
      this.journal = null;
    }

    if (this.journal) {
      const jVal = validateJournal(this.journal);
      if (!jVal.valid) {
        this.isJournalRejected = true;
        this.journalRejectionReason = `Journal existente inválido ou incompatível: ${jVal.errors.join('; ')}. Zero mutações executadas.`;
        this.persistedBaselineSnapshot = null;
        this.provenOwnership = {
          baselineCaptured: false,
          installed013: false,
          fixturesCreated: false,
          uncertainCommit: false,
          concurrencyAttempted: false
        };
        this.runId = null;
      } else {
        this.persistedBaselineSnapshot = this.journal.baselineSnapshot || null;
        this.provenOwnership = {
          baselineCaptured: false,
          installed013: false,
          fixturesCreated: false,
          uncertainCommit: false,
          concurrencyAttempted: false,
          ...(this.journal.provenOwnership || {})
        };
        this.runId = this.journal.runId || null;
      }
    } else {
      this.persistedBaselineSnapshot = null;
      this.provenOwnership = {
        baselineCaptured: false,
        installed013: false,
        fixturesCreated: false,
        uncertainCommit: false,
        concurrencyAttempted: false
      };
      this.journal = createInitialJournal();
      this.runId = this.journal.runId;
    }

    if (this.transport) {
      if (this.runId && !this.transport.runId) {
        this.transport.runId = this.runId;
      }
      if (this.journal && Array.isArray(this.journal.recordedSessions) && this.journal.recordedSessions.length > 0) {
        if (!this.transport.recordedSessions || this.transport.recordedSessions.length === 0) {
          this.transport.recordedSessions = JSON.parse(JSON.stringify(this.journal.recordedSessions));
        }
      }
    }
  }

  _saveJournal(updates = {}) {
    if (!this.journalPath || this.isJournalRejected) return;
    if (!this.journal) {
      this.journal = createInitialJournal({ journalPath: this.journalPath, runId: this.runId });
      if (!this.runId && this.journal.runId) {
        this.runId = this.journal.runId;
        if (this.transport && !this.transport.runId) {
          this.transport.runId = this.runId;
        }
      }
    }
    this.journal = {
      ...this.journal,
      ...updates,
      runId: this.journal.runId || this.runId,
      recordedSessions: (this.transport && this.transport.recordedSessions && this.transport.recordedSessions.length > 0)
        ? this.transport.recordedSessions
        : (this.journal.recordedSessions || []),
      provenOwnership: {
        ...this.journal.provenOwnership,
        ...(updates.provenOwnership || this.provenOwnership)
      }
    };
    writeJournal(this.journalPath, this.journal);
  }

  async performRecovery(options = {}) {
    if (this.isJournalRejected) {
      return {
        attempted: false,
        success: false,
        error: `Recuperação cancelada: journal rejeitado ou incompatível (${this.journalRejectionReason}). Zero mutações executadas.`,
        fixtureCleanupExecuted: false,
        reversalExecuted: false
      };
    }

    const ownership = options.provenOwnership || this.provenOwnership;
    if (ownership.collisionDetected || this.provenOwnership?.collisionDetected) {
      return {
        attempted: false,
        success: false,
        error: 'Recuperação cancelada: colisão com objetos de outra execução detectada. Zero mutações permitidas.',
        fixtureCleanupExecuted: false,
        reversalExecuted: false
      };
    }

    const baselineSnapshot = options.baselineSnapshot || this.persistedBaselineSnapshot || this.journal?.baselineSnapshot;

    const result = {
      attempted: false,
      success: false,
      error: null,
      fixtureCleanupExecuted: false,
      reversalExecuted: false,
      snapshotComparison: null,
      postSnapshot: null
    };

    if (this.isDryRun) {
      result.attempted = true;
      if (ownership.fixturesCreated) {
        result.fixtureCleanupExecuted = true;
        ownership.fixturesCreated = false;
      }
      if (ownership.installed013 || ownership.uncertainCommit) {
        result.reversalExecuted = true;
        ownership.installed013 = false;
        ownership.uncertainCommit = false;
      }
      result.success = true;
      this._saveJournal({
        status: 'rolled_back',
        provenOwnership: ownership
      });
      return result;
    }

    if (!this.transport) {
      result.error = 'Modo físico requer transporte configurado para recuperação.';
      return result;
    }

    // Condição comum obrigatória: confirmação positiva de encerramento de sessões no servidor antes de qualquer mutação
    let closureConfirmed = false;
    let closureError = 'Mecanismo de confirmação de encerramento de sessões ausente no transporte.';
    if (this.transport && typeof this.transport.close === 'function') {
      try {
        const closeRes = await this.transport.close();
        if (closeRes && closeRes.confirmed === true) {
          closureConfirmed = true;
          closureError = null;
        } else {
          closureConfirmed = false;
          closureError = closeRes?.error || 'Encerramento de sessões no servidor não pôde ser confirmado.';
        }
      } catch (err) {
        closureConfirmed = false;
        closureError = err.message;
      }
    } else if (this.transport && typeof this.transport.confirmBackendSessionsClosed === 'function') {
      try {
        const confRes = await this.transport.confirmBackendSessionsClosed();
        if (confRes && confRes.confirmed === true) {
          closureConfirmed = true;
          closureError = null;
        } else {
          closureConfirmed = false;
          closureError = confRes?.error || 'Encerramento de sessões no servidor não pôde ser confirmado.';
        }
      } catch (err) {
        closureConfirmed = false;
        closureError = err.message;
      }
    }

    if (!closureConfirmed) {
      result.attempted = false;
      result.success = false;
      result.error = `Limpeza bloqueada: ${closureError}`;
      this._saveJournal({
        status: 'unconfirmed_session_termination',
        error: result.error,
        provenOwnership: ownership
      });
      return result;
    }

    // Suporte a transporte legado ou mock customizado com executeCleanupAndReversal
    if (typeof this.transport.executeCleanupAndReversal === 'function') {
      try {
        const legacyRes = await this.transport.executeCleanupAndReversal();
        if (legacyRes && legacyRes.success === false) {
          result.error = legacyRes.error || 'Falha no transporte de limpeza';
          return result;
        }
      } catch (legacyErr) {
        result.error = legacyErr.message;
        return result;
      }
    }

    // Reconciliação por inspeção antes da limpeza (C1 / C2):
    // Se fixturesCreated é falso, mas a concorrência foi tentada ou há commit incerto/instalado,
    // inspeciona o snapshot para verificar se fixtures foram criadas nesta execução.
    let needsFixtureCleanup = Boolean(ownership.fixturesCreated);
    if (!needsFixtureCleanup && (ownership.concurrencyAttempted || ownership.uncertainCommit || ownership.installed013)) {
      if (ownership.collisionDetected || this.provenOwnership?.collisionDetected) {
        needsFixtureCleanup = false;
      } else if (typeof this.transport.captureSnapshot === 'function') {
        try {
          const preInspection = await this.transport.captureSnapshot();
          const baseCount = baselineSnapshot?.residual_fixtures_count || 0;
          const currentCount = preInspection?.residual_fixtures_count || 0;
          const hasCoordTable = Boolean(preInspection?.catalogue_fingerprints?.has_coordination_table);
          if (currentCount > baseCount || hasCoordTable) {
            needsFixtureCleanup = true;
            ownership.fixturesCreated = true;
          }
        } catch (inspectErr) {
          result.attempted = false;
          result.success = false;
          result.error = `Recuperação interrompida: inspeção de propriedade inconclusiva (${inspectErr.message}). Estado preservado sem mutações.`;
          return result;
        }
      }
    }

    const needsReversal = Boolean(ownership.installed013 || ownership.uncertainCommit);

    if (!needsFixtureCleanup && !needsReversal) {
      result.attempted = false;
      result.success = true;
      return result;
    }

    result.attempted = true;

    try {
      // 1. Limpeza de fixtures SOMENTE se comprovadamente criadas por esta execução (C2)
      if (needsFixtureCleanup) {
        await this.transport.executeSql(EXACT_FIXTURE_CLEANUP_013_SQL);
        ownership.fixturesCreated = false;
        result.fixtureCleanupExecuted = true;
        this._saveJournal({ provenOwnership: ownership });
      }

      // 2. Reversão de 013 SOMENTE se comprovadamente instalado ou com commit incerto (C2)
      if (needsReversal) {
        await this.transport.executeSql(EXACT_REVERSAL_013_SQL);
        ownership.installed013 = false;
        ownership.uncertainCommit = false;
        result.reversalExecuted = true;
        this._saveJournal({ provenOwnership: ownership });
      }

      // 3. Captura e comparação obrigatória de snapshot pós-reversão contra baseline (C2)
      if (!baselineSnapshot) {
        result.success = false;
        result.error = 'Recuperação física concluída mas impossível verificar integridade: baseline snapshot não disponível.';
        this._saveJournal({ status: 'failed', error: result.error, provenOwnership: ownership });
        return result;
      }

      const postSnapshot = await this.transport.captureSnapshot();
      result.postSnapshot = postSnapshot;
      const comp = compareSnapshots(baselineSnapshot, postSnapshot);
      result.snapshotComparison = comp;

      if (!comp.matches) {
        result.success = false;
        result.error = `Limpeza física concluiu com divergência no snapshot: ${comp.differences.join('; ')}`;
        this._saveJournal({
          status: 'failed',
          error: result.error,
          provenOwnership: ownership,
          postReversalSnapshot: postSnapshot
        });
        return result;
      }

      result.success = true;
      this._saveJournal({
        status: 'rolled_back',
        provenOwnership: ownership,
        postReversalSnapshot: postSnapshot,
        error: null
      });
      return result;
    } catch (err) {
      result.success = false;
      result.error = err.message;
      this._saveJournal({
        status: 'failed',
        error: err.message,
        provenOwnership: ownership
      });
      return result;
    }
  }

  async cleanup(options = {}) {
    if (!this.isDryRun && !this.transport) {
      return { success: false, error: 'Modo físico requer transporte configurado para limpeza.' };
    }
    const ownership = options.provenOwnership || this.provenOwnership;
    if (!this.isDryRun && !ownership.fixturesCreated && !ownership.installed013 && !ownership.uncertainCommit && typeof this.transport?.executeCleanupAndReversal !== 'function') {
      return { success: false, error: 'Limpeza física cancelada: nenhuma alteração ou fixture com propriedade comprovada desta execução.' };
    }
    return await this.performRecovery(options);
  }

  async rollback(options = {}) {
    if (this.isJournalRejected) {
      return {
        mode: this.isDryRun ? 'simulated' : 'physical',
        stage: 'rollback',
        phasesExecuted: [],
        success: false,
        error: this.journalRejectionReason,
        cleanupAttempted: false,
        cleanupSuccess: false,
        cleanupError: null,
        snapshots: {}
      };
    }
    return await this.executePlan('rollback', options);
  }

  async runRehearsalPlan(stage = 'all', options = {}) {
    return await this.executePlan(stage, options);
  }

  async executePlan(stage = 'all', options = {}) {
    if (options.provenOwnership) {
      this.provenOwnership = { ...this.provenOwnership, ...options.provenOwnership };
    }
    if (options.baselineSnapshot) {
      this.persistedBaselineSnapshot = options.baselineSnapshot;
      this.provenOwnership.baselineCaptured = true;
    }

    let recoveryPerformed = false;

    const report = {
      mode: this.isDryRun ? 'simulated' : 'physical',
      stage,
      phasesExecuted: [],
      success: false,
      error: null,
      cleanupAttempted: false,
      cleanupSuccess: null,
      cleanupError: null,
      snapshots: {}
    };

    if (!VALID_STAGES.includes(stage)) {
      report.error = `Etapa inválida solicitada: '${stage}'. Etapas válidas: ${VALID_STAGES.join(', ')}`;
      return report;
    }

    if (this.isJournalRejected) {
      report.error = `Execução bloqueada por journal inválido ou incompatível: ${this.journalRejectionReason}. Zero mutações executadas.`;
      report.success = false;
      report.cleanupAttempted = false;
      return report;
    }

    try {
      // [Fase 1] Verificação Canônica de Arquivos
      report.phasesExecuted.push('phase_1_canonical_check');
      const canonCheck = verifyCanonicalFiles();
      if (!canonCheck.valid) {
        report.error = `Integridade canônica violada: ${canonCheck.errors.join('; ')}`;
        return report;
      }

      // Verificação estrita de transporte no modo físico:
      if (!this.isDryRun && !this.transport) {
        report.error = 'Modo físico requer transporte de execução configurado (não fornecido ou não implementado neste ambiente).';
        report.success = false;
        return report;
      }

      // Validação prévia de journal para operações que alteram ou dependem de estado
      if (!this.isDryRun && this.journal) {
        const jVal = validateJournal(this.journal);
        if (!jVal.valid) {
          report.error = `Journal existente inválido ou incompatível: ${jVal.errors.join('; ')}. Zero mutações executadas.`;
          report.success = false;
          return report;
        }
      }

      // Etapa rollback isolada:
      if (stage === 'rollback') {
        if (this.isDryRun) {
          report.phasesExecuted.push('phase_7_fixture_cleanup');
          report.phasesExecuted.push('phase_8_exact_reversal');
          report.phasesExecuted.push('phase_9_post_reversal_comparison');
          const baselineMock = options.baselineSnapshot || this.persistedBaselineSnapshot || createSimulatedBaselineSnapshot();
          const postReversalMock = createSimulatedPostReversalSnapshot();
          const comparison = compareSnapshots(baselineMock, postReversalMock);
          if (!comparison.matches) {
            report.error = `Snapshot pós-reversão divergiu do baseline: ${comparison.differences.join('; ')}`;
            return report;
          }
          report.snapshots.baseline = baselineMock;
          report.snapshots.postReversal = postReversalMock;
          report.success = true;
          return report;
        } else {
          // B2/C1/C2: Modo físico estrito — Exigir baseline real persistido e propriedade comprovada; zero mutações caso ausentes.
          const baselineSnapshot = options.baselineSnapshot || this.persistedBaselineSnapshot || this.journal?.baselineSnapshot;
          if (!baselineSnapshot) {
            report.error = 'Rollback físico requer baseline real persistido da execução. Operação cancelada com zero mutações.';
            report.success = false;
            return report;
          }
          const valBase = validateSnapshotSchema(baselineSnapshot, 'baseline');
          if (!valBase.valid) {
            report.error = `Baseline fornecido para rollback físico é inválido: ${valBase.errors.join('; ')}`;
            report.success = false;
            return report;
          }
          const ownership = options.provenOwnership || this.provenOwnership;
          if (!ownership || (!ownership.installed013 && !ownership.fixturesCreated && !ownership.uncertainCommit)) {
            report.error = 'Rollback físico requer comprovação de propriedade das alterações (installed013 ou fixturesCreated). Zero mutações executadas.';
            report.success = false;
            return report;
          }

          recoveryPerformed = true;
          const rec = await this.performRecovery(options);
          report.cleanupAttempted = rec.attempted;
          report.cleanupSuccess = rec.success;
          report.cleanupError = rec.error;
          if (!rec.success) {
            report.error = rec.error || 'Falha na recuperação de rollback.';
            report.success = false;
            return report;
          }

          if (rec.fixtureCleanupExecuted) report.phasesExecuted.push('phase_7_fixture_cleanup');
          if (rec.reversalExecuted) report.phasesExecuted.push('phase_8_exact_reversal');
          report.phasesExecuted.push('phase_9_post_reversal_comparison');
          report.snapshots.baseline = baselineSnapshot;
          report.snapshots.postReversal = rec.postSnapshot || (await this.transport.captureSnapshot());
          report.success = true;
          return report;
        }
      }

      // [Fase 2] Preflight 013 Somente-Leitura
      report.phasesExecuted.push('phase_2_preflight_013');
      if (!this.isDryRun) {
        await this.transport.executeFile(path.join(rootDir, 'docs', 'sql', '013_preflight_member_lifecycle.sql'));
      }

      // [Fase 3] Captura de Snapshot de Baseline Pré-Instalação
      report.phasesExecuted.push('phase_3_pre_install_baseline');
      let baselineSnapshot = this.persistedBaselineSnapshot;
      if (!baselineSnapshot) {
        baselineSnapshot = this.isDryRun
          ? createSimulatedBaselineSnapshot()
          : await this.transport.captureSnapshot();

        const baseSchema = validateSnapshotSchema(baselineSnapshot, 'baseline');
        if (!baseSchema.valid) {
          report.error = `Baseline capturado é inválido: ${baseSchema.errors.join('; ')}`;
          return report;
        }

        report.snapshots.baseline = baselineSnapshot;
        this.persistedBaselineSnapshot = baselineSnapshot;
        this.provenOwnership.baselineCaptured = true;
        this._saveJournal({
          baselineSnapshot,
          phasesCompleted: [...report.phasesExecuted],
          provenOwnership: this.provenOwnership,
          status: 'in_progress'
        });
      } else {
        report.snapshots.baseline = baselineSnapshot;
      }

      if (stage === 'baseline') {
        report.success = true;
        this._saveJournal({ status: 'completed' });
        return report;
      }

      // [Fase 4] Instalação 013 com COMMIT
      if (!this.isDryRun) {
        // C1: Registrar intenção durável antes da operação mutável externa.
        // Em caso de interrupção abrupta do processo durante o commit, o estado de incerteza já estará gravado no journal.
        this.provenOwnership.uncertainCommit = true;
        this._saveJournal({
          status: 'installing_013',
          provenOwnership: this.provenOwnership
        });

        try {
          await this.transport.executeFile(path.join(rootDir, 'docs', 'sql', '013_member_lifecycle.sql'));
          report.phasesExecuted.push('phase_4_install_013');
          this.provenOwnership.installed013 = true;
          this.provenOwnership.uncertainCommit = false;
          this._saveJournal({
            status: 'installed_013',
            phasesCompleted: [...report.phasesExecuted],
            provenOwnership: this.provenOwnership
          });
        } catch (installErr) {
          // Reconciliação de resultado incerto de COMMIT sem presumir sucesso nem limpar objetos alheios
          this.provenOwnership.uncertainCommit = true;
          this._saveJournal({
            status: 'failed',
            error: installErr.message,
            provenOwnership: this.provenOwnership
          });
          throw installErr;
        }
      } else {
        report.phasesExecuted.push('phase_4_install_013');
        this.provenOwnership.installed013 = true;
      }

      // [Fase 5] Verificação 014 Real Governa a Decisão (B1)
      report.phasesExecuted.push('phase_5_verify_014');
      let verifyRows;
      if (this.isDryRun) {
        const allTrue014 = {};
        VERIFY_014_INDICATORS.forEach(ind => { allTrue014[ind] = true; });
        verifyRows = [allTrue014];
      } else if (typeof this.transport.executeVerify014 === 'function') {
        verifyRows = await this.transport.executeVerify014();
      } else {
        const verifySql = fs.readFileSync(path.join(rootDir, 'docs', 'sql', '014_verify_member_lifecycle.sql'), 'utf8');
        const vRes = await this.transport.executeSql(verifySql);
        verifyRows = vRes?.rows || vRes?.output || [];
      }

      const verify014Result = validateVerify014Result(verifyRows);
      if (!verify014Result.success) {
        report.error = `Verificação 014 falhou: ${verify014Result.errors.join('; ')}`;
        return report;
      }

      if (stage === 'install') {
        report.success = true;
        this._saveJournal({ status: 'completed' });
        return report;
      }

      if (stage === 'install-keep') {
        report.phasesExecuted.push('phase_installation_kept_for_browser');
        report.success = true;
        this._saveJournal({ status: 'completed', phasesCompleted: [...report.phasesExecuted] });
        return report;
      }

      // [Fase 6] Concorrência Coordenada C1.A, C1.B.1, C1.B.2, C2, C3 (B1)
      if (this.isDryRun) {
        report.phasesExecuted.push('phase_6_concurrency_rehearsal');
        const sessionA = new MockSessionTransport({ name: 'session_a_013', pid: 101 });
        const sessionB = new MockSessionTransport({ name: 'session_b_013', pid: 202 });
        this.coordinator.registerSessions(sessionA, sessionB);

        const scenarios = ['c1a', 'c1b1', 'c1b2', 'c2', 'c3'];
        for (const sc of scenarios) {
          await this.coordinator.runScenario(sc);
        }
        this.provenOwnership.fixturesCreated = true;
        this._saveJournal({ provenOwnership: this.provenOwnership });
      } else if (typeof this.transport.executeConcurrency === 'function') {
        this.provenOwnership.concurrencyAttempted = true;
        this._saveJournal({
          status: 'concurrency_rehearsal',
          provenOwnership: this.provenOwnership
        });

        const sessionAPath = path.join(rootDir, 'docs', 'sql', 'concurrency', '013_concurrency_session_a.sql');
        const sessionBPath = path.join(rootDir, 'docs', 'sql', 'concurrency', '013_concurrency_session_b.sql');
        const concRes = await this.transport.executeConcurrency({ sessionAPath, sessionBPath });
        if (!concRes || concRes.success !== true) {
          report.error = `Ensaio de concorrência física falhou: ${concRes?.error || 'Erro desconhecido'}`;
          return report;
        }
        const reqScenarios = ['c1a', 'c1b1', 'c1b2', 'c2', 'c3'];
        const compScenarios = concRes.scenarios || [];
        const missing = reqScenarios.filter(s => !compScenarios.includes(s));
        if (missing.length > 0) {
          report.error = `Cenários de concorrência não comprovados: ${missing.join(', ')}`;
          return report;
        }
        report.phasesExecuted.push('phase_6_concurrency_rehearsal');
        this.provenOwnership.fixturesCreated = true;
        this._saveJournal({ provenOwnership: this.provenOwnership });
      } else {
        report.error = 'Transporte físico não implementa executeConcurrency para ensaio multi-sessão.';
        return report;
      }

      // [Fases 7, 8, 9] Desmonte e Verificação Pós-Reversão
      if (!this.isDryRun) {
        recoveryPerformed = true;
        const rec = await this.performRecovery({ baselineSnapshot });
        report.cleanupAttempted = rec.attempted;
        report.cleanupSuccess = rec.success;
        report.cleanupError = rec.error;
        if (!rec.success) {
          report.error = rec.error || 'Falha na recuperação de encerramento.';
          report.success = false;
          return report;
        }
        if (rec.fixtureCleanupExecuted) report.phasesExecuted.push('phase_7_fixture_cleanup');
        if (rec.reversalExecuted) report.phasesExecuted.push('phase_8_exact_reversal');
        report.phasesExecuted.push('phase_9_post_reversal_comparison');
        report.snapshots.postReversal = rec.postSnapshot;

        report.success = true;
        this._saveJournal({
          status: 'completed',
          postReversalSnapshot: rec.postSnapshot,
          phasesCompleted: [...report.phasesExecuted]
        });
        return report;
      } else {
        report.phasesExecuted.push('phase_7_fixture_cleanup');
        this.provenOwnership.fixturesCreated = false;
        report.phasesExecuted.push('phase_8_exact_reversal');
        this.provenOwnership.installed013 = false;
        report.phasesExecuted.push('phase_9_post_reversal_comparison');
        const postReversalSnapshot = createSimulatedPostReversalSnapshot();
        const comparison = compareSnapshots(baselineSnapshot, postReversalSnapshot);
        if (!comparison.matches) {
          report.error = `Snapshot pós-reversão divergiu do baseline: ${comparison.differences.join('; ')}`;
          return report;
        }
        report.snapshots.postReversal = postReversalSnapshot;

        report.success = true;
        this._saveJournal({
          status: 'completed',
          postReversalSnapshot,
          phasesCompleted: [...report.phasesExecuted]
        });
        return report;
      }
    } catch (err) {
      report.error = `Exceção durante a execução do plano: ${err.message}`;
      return report;
    } finally {
      if (this.isJournalRejected) {
        report.cleanupAttempted = false;
        return report;
      }

      // C2: Recuperação cirúrgica unificada baseada em PROPRIEDADE REAL comprovada
      // Executada caso o plano tenha falhado antes do desmonte normal e a recuperação ainda não tenha sido acionada
      if (!report.success && !recoveryPerformed && (this.provenOwnership.installed013 || this.provenOwnership.fixturesCreated || this.provenOwnership.uncertainCommit || this.provenOwnership.concurrencyAttempted)) {
        recoveryPerformed = true;
        const rec = await this.performRecovery({
          baselineSnapshot: report.snapshots.baseline || this.persistedBaselineSnapshot || this.journal?.baselineSnapshot
        });
        report.cleanupAttempted = rec.attempted;
        report.cleanupSuccess = rec.success;
        report.cleanupError = rec.error;
        if (!report.error) {
          report.error = rec.error;
        } else if (rec.error && !report.error.includes(rec.error)) {
          report.error += ` | ${rec.error}`;
        }
        if (rec.postSnapshot) {
          report.snapshots.postReversal = rec.postSnapshot;
        }
      }
    }
  }
}

/**
 * Exibe o plano de execução detalhado
 */
export function printExecutionPlan() {
  console.log(`
=== PLANO DE EXECUÇÃO DO LABORATÓRIO (INCREMENTO 013/014) ===
Alvo Autorizado: container '${AUTHORIZED_TARGET_CONTAINER}' (porta ${AUTHORIZED_TARGET_PORT})

[Fase 1] Verificação Canônica dos Scripts
  - Checagem estrita de presença e integridade de 013_member_lifecycle.sql (SHA-256),
    013_preflight, 014_verify, scripts psql de concorrência A/B e guias normativos.

[Fase 2] Preflight Somente-Leitura
  - Execução de docs/sql/013_preflight_member_lifecycle.sql
  - Validação de UTF8, estrutura 001-012 existente, isolamento de app_private e
    ausência prévia das 4 RPCs de ciclo de vida.

[Fase 3] Captura de Snapshot de Baseline Pré-Instalação
  - Captura das contagens do catálogo, gatilhos, contagens de linhas de domínio e
    hashes determinísticos de conteúdo de todas as 8 tabelas de domínio.

[Fase 4] Instalação Comprometida (COMMIT Obrigatório)
  - Execução de docs/sql/013_member_lifecycle.sql com COMMIT explícito.
  - Necessário para visibilidade multi-sessão sob PostgreSQL READ COMMITTED.

[Fase 5] Verificação 014 Pós-Instalação
  - Execução canônica de docs/sql/014_verify_member_lifecycle.sql.
  - Exigência estrita de 7 indicadores booleanos TRUE.

[Fase 6] Ensaio de Concorrência Real com Duas Conexões Independentes
  - Sessão A (bloqueador) e Sessão B (concorrente).
  - C1.A: Conflito de revisão otimista T0 -> T1 com membro inactive (P0019).
  - E17/C1.B.1: Concessão concorrente de acesso ativo na ausência prévia de linha (P0018).
  - E17/C1.B.2: Concessão concorrente na variante revoked com ordem canônica estrita (P0018).
  - C2: Perda de autorização administrativa durante espera física na fila (42501).
  - C3: Replay simultâneo do mesmo comando sob advisory lock idempotente (mesmo recibo).

[Fase 7] Limpeza Cirúrgica das Fixtures Sintéticas
  - Procedimento excepcional de manutenção explícito com desativação temporária dos
    gatilhos de proteção do último admin durante o delete do manifesto e reativação comprovada.

[Fase 8] Reversão Exata do Catálogo (Desinstalação de 013)
  - Remoção das 4 RPCs e restauração do gatilho members_touch_updated_at para
    app_private.touch_updated_at().
  - Zero descarte/reset de banco de dados; dados preexistentes 100% preservados.

[Fase 9] Conferência Pós-Reversão contra Baseline
  - Nova captura de snapshot e comparação estrita contra o baseline inicial.
  - Validação exata de contagens, gatilhos, hashes de conteúdo e resíduo zero.
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

  // Validação estrita de argumentos desconhecidos
  const knownFlags = ['--help', '-h', '--plan', '--check', '--dry-run', '--execute', '--stage', '--confirm-local', '--journal'];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--') || arg.startsWith('-')) {
      if (!knownFlags.includes(arg)) {
        console.error(`\n[ERRO DE ARGUMENTO] Opção desconhecida: '${arg}'.`);
        return 1;
      }
      if (arg === '--stage' && i + 1 >= argv.length) {
        console.error('\n[ERRO DE ARGUMENTO] A flag --stage requer um valor.');
        return 1;
      }
      if (arg === '--journal' && i + 1 >= argv.length) {
        console.error('\n[ERRO DE ARGUMENTO] A flag --journal requer um caminho de arquivo.');
        return 1;
      }
    }
  }

  if (stageIdx !== -1 && !VALID_STAGES.includes(stage)) {
    console.error(`\n[ERRO DE ARGUMENTO] Etapa inválida: '${stage}'. Etapas aceitas: ${VALID_STAGES.join(', ')}.`);
    return 1;
  }

  const journalIdx = argv.indexOf('--journal');
  const journalPath = journalIdx !== -1 ? path.resolve(process.cwd(), argv[journalIdx + 1]) : DEFAULT_JOURNAL_PATH;

  if (isHelp) {
    printExecutionPlan();
    console.log(`Uso:
  node tools/rehearsal-runner-013.js --help                 Exibe esta ajuda
  node tools/rehearsal-runner-013.js --plan                 Exibe o plano de execução detalhado
  node tools/rehearsal-runner-013.js --check                Verifica integridade canônica dos scripts 013/014
  node tools/rehearsal-runner-013.js --dry-run              Executa ensaio com transporte simulado em memória (SIMULAÇÃO)
  node tools/rehearsal-runner-013.js --dry-run --stage <etapa> (all, baseline, install, install-keep, rehearsal, rollback)
  node tools/rehearsal-runner-013.js --execute --stage <etapa> --confirm-local [--journal <caminho>] (Requer autorização formal)
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
    console.log('\n[PASS] Integridade de todos os arquivos canônicos 013/014 verificada com sucesso.');
    return 0;
  }

  if (isPlan) {
    printExecutionPlan();
    return 0;
  }

  if (isDryRun) {
    console.log('\n--- [SIMULAÇÃO / DRY-RUN] INICIANDO EXECUÇÃO COM TRANSPORTE SIMULADO EM MEMÓRIA ---');
    console.log(`Etapa solicitada: '${stage}' | Modo: Transporte simulado (sem conexões físicas a banco)`);
    const orchestrator = new RehearsalOrchestrator013({ dryRun: true, journalPath: null });
    const result = await orchestrator.executePlan(stage);
    if (result.success) {
      console.log(`\n[PASS / SIMULAÇÃO] Execução lógica do plano de laboratório 013/014 concluída com sucesso.`);
      console.log(`Fases simuladas com êxito: ${result.phasesExecuted.join(' -> ')}`);
      return 0;
    } else {
      console.error(`\n[FAIL / SIMULAÇÃO] Erro na simulação dry-run: ${result.error}`);
      return 1;
    }
  }

  if (isExecute) {
    const isConfirmed = argv.includes('--confirm-local');
    if (!isConfirmed) {
      console.error('\n[ERRO DE SEGURANÇA] Execução física cancelada: a flag obrigatória --confirm-local não foi fornecida.');
      return 1;
    }
    console.log(`\n--- [MODO FÍSICO / LOCAL] INICIANDO EXECUÇÃO CONTRA CONTAINER '${AUTHORIZED_TARGET_CONTAINER}' ---`);
    console.log(`Etapa solicitada: '${stage}' | Alvo: ${AUTHORIZED_TARGET_CONTAINER} (${AUTHORIZED_TARGET_DATABASE}) | Journal: ${journalPath}`);
    const transport = new PsqlCommandTransport({
      targetContainer: AUTHORIZED_TARGET_CONTAINER,
      targetPort: AUTHORIZED_TARGET_PORT,
      user: 'postgres',
      database: AUTHORIZED_TARGET_DATABASE
    });
    const orchestrator = new RehearsalOrchestrator013({ dryRun: false, transport, journalPath });
    const result = await orchestrator.executePlan(stage);
    if (result.success) {
      console.log(`\n[PASS / FÍSICO] Execução do plano de laboratório 013/014 concluída com sucesso no banco local.`);
      console.log(`Fases executadas: ${result.phasesExecuted.join(' -> ')}`);
      return 0;
    } else {
      console.error(`\n[FAIL / FÍSICO] Erro na execução física: ${result.error}`);
      if (result.cleanupAttempted) {
        console.error(`Limpeza de recuperação: ${result.cleanupSuccess ? 'BEM-SUCEDIDA' : 'FALHOU (' + result.cleanupError + ')'}`);
      }
      return 1;
    }
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
