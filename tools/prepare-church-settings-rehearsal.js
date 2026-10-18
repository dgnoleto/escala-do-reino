// Apenas gera um artefato local; não conecta, inicia serviços nem executa SQL.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
const candidate = fs.readFileSync('docs/sql/017_church_settings.sql', 'utf8');
const cases = fs.readFileSync('docs/sql/017_rehearsal_cases.sql', 'utf8');
if ((candidate.match(/^begin;\s*$/gm) || []).length !== 1 || (candidate.match(/^commit;\s*$/gm) || []).length !== 1) {
  throw new Error('Transação do candidato fora do formato esperado. Parar.');
}
const body = candidate.replace(/^begin;\s*$/m, '').replace(/^commit;\s*$/m, '');
const guard = `do $guard$ begin
  if current_setting('escala.settings_rehearsal',true) is distinct from 'disposable-authorized' then
    raise exception 'Identifique explicitamente a base descartável autorizada.';
  end if;
  if exists(select 1 from auth.users) or exists(select 1 from app_private.churches) then
    raise exception 'Ensaio exclusivo de base descartável vazia. Não usar piloto/laboratório existente.';
  end if;
end $guard$;`;
const post = `do $post$ begin
  if to_regprocedure('public.get_church_settings(uuid)') is not null
    or to_regclass('app_private.church_settings_receipts') is not null
    or exists(select 1 from storage.buckets where id='church-logos')
    or exists(select 1 from information_schema.columns where table_schema='app_private' and table_name='churches' and column_name in ('logo_path','profile_revision'))
    or exists(select 1 from auth.users) or exists(select 1 from app_private.churches) then
    raise exception 'Resíduo após ROLLBACK.';
  end if;
end $post$;`;
const destination = path.resolve('node_modules/.cache/church-settings-rehearsal.sql');
fs.mkdirSync(path.dirname(destination), { recursive: true });
const sha = createHash('sha256').update(candidate).digest('hex');
fs.writeFileSync(destination, `\\set ON_ERROR_STOP on\n-- Candidato SHA256: ${sha}\nbegin;\n${guard}\n${body}\n${cases}\nrollback;\n${post}\n`, 'utf8');
console.log(`Ensaio preparado, NÃO executado: ${destination}\nCandidato SHA256: ${sha}`);
