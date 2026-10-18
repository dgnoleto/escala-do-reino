// Apenas gera um artefato local; não conecta, inicia serviços nem executa SQL.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const candidate = fs.readFileSync('docs/sql/019_church_name_update.sql', 'utf8');
const cases = fs.readFileSync('docs/sql/019_rehearsal_cases.sql', 'utf8');

if ((candidate.match(/^begin;\s*$/gm) || []).length !== 1 || (candidate.match(/^commit;\s*$/gm) || []).length !== 1) {
  throw new Error('Transação do candidato fora do formato esperado. Parar.');
}

const body = candidate.replace(/^begin;\s*$/m, '').replace(/^commit;\s*$/m, '');

const guard = `do $guard$ begin
  if current_setting('escala.settings_rehearsal',true) is distinct from 'disposable-authorized' then
    raise exception 'Identifique explicitamente a base descartável autorizada.';
  end if;
end $guard$;`;

const post = `do $post$ begin
  if exists(select 1 from auth.users where email like 'name019_%') then
    raise exception 'Resíduo de fixtures após ROLLBACK.';
  end if;
end $post$;`;

const destination = path.resolve('node_modules/.cache/church-name-update-rehearsal.sql');
fs.mkdirSync(path.dirname(destination), { recursive: true });
const sha = createHash('sha256').update(candidate).digest('hex');

fs.writeFileSync(destination, `\\set ON_ERROR_STOP on\n-- Candidato 019 SHA256: ${sha}\nbegin;\n${guard}\n${body}\n${cases}\nrollback;\n${post}\n`, 'utf8');
console.log(`Ensaio preparado, NÃO executado: ${destination}\nCandidato 019 SHA256: ${sha}`);
