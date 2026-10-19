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

async function runSql(sql) {
  return new Promise((resolve, reject) => {
    const proc = spawn('docker', [
      'exec', '-i', TARGET_CONTAINER,
      'psql', '-U', 'postgres', '-d', 'postgres',
      '-v', 'ON_ERROR_STOP=1',
      '-P', 'pager=off',
      '-t', '-A'
    ], { stdio: ['pipe', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.stderr.on('data', d => { stderr += d.toString(); });

    proc.on('close', code => {
      resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() });
    });

    proc.on('error', err => {
      reject(err);
    });

    proc.stdin.write(sql);
    proc.stdin.end();
  });
}

function assertVerification(output, scriptName) {
  const parts = output.split('|');
  const allTrue = parts.length > 0 && parts.every(p => p.trim() === 't');
  if (!allTrue) {
    throw new Error(`Verificação falhou em ${scriptName}. Resultado: ${output}`);
  }
}

async function main() {
  console.log('--- Iniciando Teste de Ciclo de Vida: Deploy, Verify e Rollback (020 a 023) ---');

  // Setup preamble helper
  await runSql(PREAMBLE_HELPER);

  const increments = ['020', '021', '022', '023'];

  console.log('\n[Etapa 1] Teste Acumulativo de Dependências: Deploy -> Verify -> Rollback cirúrgico');

  // Teste 020 (autônomo)
  console.log('\nTestando incremento 020 (autônomo)...');
  await runSql(fs.readFileSync('docs/sql/020_cancellation_reasons.sql', 'utf8'));
  let vRes = await runSql(fs.readFileSync('docs/sql/020_verify.sql', 'utf8'));
  assertVerification(vRes.stdout, '020_verify.sql');
  console.log(`  -> 020_verify.sql APROVADO: [${vRes.stdout}]`);
  await runSql(fs.readFileSync('docs/sql/020_rollback.sql', 'utf8'));
  console.log('  -> 020_rollback.sql revertido com sucesso.');

  // Teste 021 (autônomo)
  console.log('\nTestando incremento 021 (autônomo)...');
  await runSql(fs.readFileSync('docs/sql/021_event_types_and_activities.sql', 'utf8'));
  vRes = await runSql(fs.readFileSync('docs/sql/021_verify.sql', 'utf8'));
  assertVerification(vRes.stdout, '021_verify.sql');
  console.log(`  -> 021_verify.sql APROVADO: [${vRes.stdout}]`);
  await runSql(fs.readFileSync('docs/sql/021_rollback.sql', 'utf8'));
  console.log('  -> 021_rollback.sql revertido com sucesso.');

  // Teste 022 (depende de 021)
  console.log('\nTestando incremento 022 (sobre base 021)...');
  await runSql(fs.readFileSync('docs/sql/021_event_types_and_activities.sql', 'utf8'));
  await runSql(fs.readFileSync('docs/sql/022_service_templates.sql', 'utf8'));
  vRes = await runSql(fs.readFileSync('docs/sql/022_verify.sql', 'utf8'));
  assertVerification(vRes.stdout, '022_verify.sql');
  console.log(`  -> 022_verify.sql APROVADO: [${vRes.stdout}]`);
  await runSql(fs.readFileSync('docs/sql/022_rollback.sql', 'utf8'));
  console.log('  -> 022_rollback.sql revertido com sucesso.');
  await runSql(fs.readFileSync('docs/sql/021_rollback.sql', 'utf8'));
  console.log('  -> 021 limpo após teste de 022.');

  // Teste 023 (depende de 021 e 022)
  console.log('\nTestando incremento 023 (sobre base 021 + 022)...');
  await runSql(fs.readFileSync('docs/sql/021_event_types_and_activities.sql', 'utf8'));
  await runSql(fs.readFileSync('docs/sql/022_service_templates.sql', 'utf8'));
  await runSql(fs.readFileSync('docs/sql/023_event_planning_and_durations.sql', 'utf8'));
  vRes = await runSql(fs.readFileSync('docs/sql/023_verify.sql', 'utf8'));
  assertVerification(vRes.stdout, '023_verify.sql');
  console.log(`  -> 023_verify.sql APROVADO: [${vRes.stdout}]`);
  await runSql(fs.readFileSync('docs/sql/023_rollback.sql', 'utf8'));
  console.log('  -> 023_rollback.sql revertido com sucesso.');
  await runSql(fs.readFileSync('docs/sql/022_rollback.sql', 'utf8'));
  await runSql(fs.readFileSync('docs/sql/021_rollback.sql', 'utf8'));
  console.log('  -> 022 e 021 limpos após teste de 023.');

  console.log('\n[Etapa 2] Teste em Cadeia Completa (020 -> 021 -> 022 -> 023) e Reversão Inversa (023 -> 022 -> 021 -> 020)');
  
  // Forward chain
  for (const inc of increments) {
    const sqlFile = fs.readdirSync('docs/sql').find(f => f.startsWith(`${inc}_`) && !f.includes('rehearsal') && !f.includes('verify') && !f.includes('rollback'));
    const verifyFile = `docs/sql/${inc}_verify.sql`;

    console.log(`Cadeia: aplicando ${inc} (${sqlFile})...`);
    const ddl = fs.readFileSync(`docs/sql/${sqlFile}`, 'utf8');
    const applyRes = await runSql(ddl);
    if (applyRes.code !== 0) {
      throw new Error(`Falha na cadeia ao aplicar ${sqlFile}:\n${applyRes.stderr}`);
    }

    const verifySql = fs.readFileSync(verifyFile, 'utf8');
    const verifyRes = await runSql(verifySql);
    assertVerification(verifyRes.stdout, verifyFile);
    console.log(`  -> ${verifyFile} verificado com sucesso na cadeia.`);
  }

  // Reverse rollback
  for (const inc of [...increments].reverse()) {
    const rollbackFile = `docs/sql/${inc}_rollback.sql`;
    console.log(`Cadeia reversa: revertendo ${inc} (${rollbackFile})...`);
    const rollbackSql = fs.readFileSync(rollbackFile, 'utf8');
    const rollbackRes = await runSql(rollbackSql);
    if (rollbackRes.code !== 0) {
      throw new Error(`Falha na cadeia ao reverter ${rollbackFile}:\n${rollbackRes.stderr}`);
    }
    console.log(`  -> ${rollbackFile} revertido com sucesso.`);
  }

  console.log('\n--- TODOS OS ENSAIOS DE DEPLOY, VERIFY E ROLLBACK CONCLUÍDOS COM 100% DE SUCESSO! ---');
}

main().catch(err => {
  console.error('\nERRO NO TESTE DE CICLO DE VIDA:', err.message);
  process.exit(1);
});
