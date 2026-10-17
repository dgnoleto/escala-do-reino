-- Guarda comum: somente a base descartável marcada pelo executor autorizado.
\set ON_ERROR_STOP on
\if :{?run_id}
\else
  \echo 'FALHA: informe -v run_id=r015_<16 caracteres hexadecimais>.'
  do $missing_parameter$ begin raise exception 'Parâmetro obrigatório do ensaio ausente'; end $missing_parameter$;
\endif
select set_config('escala.rehearsal_run', :'run_id', false);
do $guard$
declare
  v_comment text;
begin
  if current_database() <> 'escala_rehearsal_015'
     or session_user <> 'postgres' or current_user <> 'postgres'
     or inet_server_addr() is not null
     or current_setting('port') <> '5432'
     or current_setting('server_encoding') <> 'UTF8'
     or current_setting('client_encoding') <> 'UTF8' then
    raise exception 'Alvo recusado: exige base descartável escala_rehearsal_015, postgres, socket local e UTF8.';
  end if;
  if current_setting('escala.rehearsal_run') !~ '^r015_[a-f0-9]{16}$' then
    raise exception 'run_id inválido';
  end if;
  select shobj_description(d.oid,'pg_database') into v_comment
  from pg_database d where d.datname=current_database() and not d.datistemplate;
  if v_comment is distinct from 'escala-rehearsal-015:'||current_setting('escala.rehearsal_run') then
    raise exception 'Propriedade da base não comprovada: marcador diverge da execução autorizada.';
  end if;
end
$guard$;
