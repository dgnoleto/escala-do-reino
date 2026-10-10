-- 1. Evolução compatível de command_receipts para replay estruturado
do $evolve_receipts$
declare
  v_col_entity record;
  v_col_payload record;
  v_con_def text;
begin
  select data_type, is_nullable, column_default
  into v_col_entity
  from information_schema.columns
  where table_schema = 'app_private' and table_name = 'command_receipts' and column_name = 'result_entity_id';

  if v_col_entity.data_type is not null then
    if v_col_entity.data_type <> 'uuid' or v_col_entity.is_nullable <> 'YES' or v_col_entity.column_default is not null then
      raise exception 'Coluna result_entity_id preexistente incompatível (esperado uuid, nullable, sem default). Parar e revisar.';
    end if;
  else
    alter table app_private.command_receipts add column result_entity_id uuid;
  end if;

  select data_type, is_nullable, column_default
  into v_col_payload
  from information_schema.columns
  where table_schema = 'app_private' and table_name = 'command_receipts' and column_name = 'result_payload';

  if v_col_payload.data_type is not null then
    if v_col_payload.data_type <> 'jsonb' or v_col_payload.is_nullable <> 'YES' or v_col_payload.column_default is not null then
      raise exception 'Coluna result_payload preexistente incompatível (esperado jsonb, nullable, sem default). Parar e revisar.';
    end if;
  else
    alter table app_private.command_receipts add column result_payload jsonb;
  end if;

  select pg_get_constraintdef(c.oid)
  into v_con_def
  from pg_catalog.pg_constraint c
  join pg_catalog.pg_namespace n on n.oid = c.connamespace
  where n.nspname = 'app_private' and c.conrelid = 'app_private.command_receipts'::regclass
    and c.conname = 'command_receipts_payload_check';

  if v_con_def is not null then
    if v_con_def !~* 'result_payload\s+is\s+null'
       or v_con_def !~* 'jsonb_typeof\s*\(\s*result_payload\s*\)\s*=\s*''object'''
       or v_con_def !~* 'octet_length\s*\(\s*\(?\s*result_payload\s*\)?::text\s*\)\s*<=\s*4096' then
      raise exception 'Constraint command_receipts_payload_check preexistente incompatível: %. Parar e revisar.', v_con_def;
    end if;
  else
    alter table app_private.command_receipts
      add constraint command_receipts_payload_check
      check (
        result_payload is null
        or (jsonb_typeof(result_payload) = 'object' and octet_length(result_payload::text) <= 4096)
      );
  end if;
end;
$evolve_receipts$;
