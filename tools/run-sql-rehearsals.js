import fs from 'node:fs';
import { spawn } from 'node:child_process';

const TARGET_CONTAINER = 'supabase_db_escala-convites-http-lab';

const PREAMBLE_HELPER = `
create or replace function app_private.has_church_settings_access(p_church_id uuid, p_require_admin boolean)
returns boolean language sql stable security definer set search_path = ''
as $function$
  select exists (
    select 1 from app_private.church_access ca
    join app_private.churches c on c.id = ca.church_id
    join app_private.members m on m.id = ca.member_id and m.church_id = ca.church_id
    join auth.users u on u.id = ca.user_id
    where ca.church_id = p_church_id and ca.user_id = (select auth.uid())
      and ca.status = 'active' and ca.onboarding_completed_at is not null
      and (not p_require_admin or ca.is_admin)
      and c.status = 'active' and m.status = 'active'
      and u.email_confirmed_at is not null and u.deleted_at is null
      and not coalesce(u.is_anonymous, false)
      and (u.banned_until is null or u.banned_until <= statement_timestamp())
  );
$function$;
`;

function stripTransaction(sql) {
  return sql
    .replace(/^begin;\s*$/mi, '')
    .replace(/^commit;\s*$/mi, '');
}

async function runSqlInContainer(sql) {
  return new Promise((resolve, reject) => {
    const proc = spawn('docker', [
      'exec', '-i', TARGET_CONTAINER,
      'psql', '-U', 'postgres', '-d', 'postgres',
      '-v', 'ON_ERROR_STOP=1',
      '-P', 'pager=off'
    ], { stdio: ['pipe', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.stderr.on('data', d => { stderr += d.toString(); });

    proc.on('close', code => {
      resolve({ code, stdout, stderr });
    });

    proc.on('error', err => {
      reject(err);
    });

    proc.stdin.write(sql);
    proc.stdin.end();
  });
}

async function runRehearsal020() {
  console.log('=== Iniciando Ensaio Transacional do Candidato 020 (Cancellation Reasons) ===');
  const ddl = fs.readFileSync('docs/sql/020_cancellation_reasons.sql', 'utf8');
  const cases = fs.readFileSync('docs/sql/020_rehearsal_cases.sql', 'utf8');

  const fullRehearsalSql = `
\\set ON_ERROR_STOP on
begin;
${PREAMBLE_HELPER}
${stripTransaction(ddl)}

-- Casos de Ensaio 020
${cases}

rollback;
`;

  const result = await runSqlInContainer(fullRehearsalSql);
  if (result.code !== 0) {
    console.error('FALHA no ensaio 020:');
    console.error(result.stderr || result.stdout);
    process.exit(1);
  }

  console.log('SUCESSO no ensaio 020!');
  console.log('Output:', result.stdout.trim().split('\n').slice(-10).join('\n'));
}

async function runRehearsal021() {
  console.log('\n=== Iniciando Ensaio Transacional do Candidato 021 (Event Types & Activities) ===');
  const ddl = fs.readFileSync('docs/sql/021_event_types_and_activities.sql', 'utf8');
  const cases = fs.readFileSync('docs/sql/021_rehearsal_cases.sql', 'utf8');

  const fullRehearsalSql = `
\\set ON_ERROR_STOP on
begin;
${PREAMBLE_HELPER}
${stripTransaction(ddl)}

-- Casos de Ensaio 021
${cases}

rollback;
`;

  const result = await runSqlInContainer(fullRehearsalSql);
  if (result.code !== 0) {
    console.error('FALHA no ensaio 021:');
    console.error(result.stderr || result.stdout);
    process.exit(1);
  }

  console.log('SUCESSO no ensaio 021!');
  console.log('Output:', result.stdout.trim().split('\n').slice(-10).join('\n'));
}

async function runRehearsal022() {
  console.log('\n=== Iniciando Ensaio Transacional do Candidato 022 (Service Templates) ===');
  const ddl021 = fs.readFileSync('docs/sql/021_event_types_and_activities.sql', 'utf8');
  const ddl022 = fs.readFileSync('docs/sql/022_service_templates.sql', 'utf8');
  const cases = fs.readFileSync('docs/sql/022_rehearsal_cases.sql', 'utf8');

  const fullRehearsalSql = `
\\set ON_ERROR_STOP on
begin;
${PREAMBLE_HELPER}
${stripTransaction(ddl021)}
${stripTransaction(ddl022)}

-- Casos de Ensaio 022
${cases}

rollback;
`;

  const result = await runSqlInContainer(fullRehearsalSql);
  if (result.code !== 0) {
    console.error('FALHA no ensaio 022:');
    console.error(result.stderr || result.stdout);
    process.exit(1);
  }

  console.log('SUCESSO no ensaio 022!');
  console.log('Output:', result.stdout.trim().split('\n').slice(-10).join('\n'));
}

async function runRehearsal023() {
  console.log('\n=== Iniciando Ensaio Transacional do Candidato 023 (Event Planning & Durations) ===');
  const ddl = fs.readFileSync('docs/sql/023_event_planning_and_durations.sql', 'utf8');
  const cases = fs.readFileSync('docs/sql/023_rehearsal_cases.sql', 'utf8');

  const fullRehearsalSql = `
\\set ON_ERROR_STOP on
begin;
${PREAMBLE_HELPER}
${stripTransaction(ddl)}

-- Casos de Ensaio 023 (já possui rollback no final)
${cases}
`;

  const result = await runSqlInContainer(fullRehearsalSql);
  if (result.code !== 0) {
    console.error('FALHA no ensaio 023:');
    console.error(result.stderr || result.stdout);
    process.exit(1);
  }

  console.log('SUCESSO no ensaio 023!');
  console.log('Output:', result.stdout.trim().split('\n').slice(-10).join('\n'));
}

async function main() {
  await runRehearsal020();
  await runRehearsal021();
  await runRehearsal022();
  await runRehearsal023();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
