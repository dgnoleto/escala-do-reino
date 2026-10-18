-- Fragmento para ensaio transacional do candidato 020 (Issue #26).
-- NÃO executar isoladamente. Executa dentro da transação do candidato 020 terminando em ROLLBACK.

create function pg_temp.reason_id(n integer) returns uuid language sql immutable as
$$ select ('02000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid $$;

create function pg_temp.reason_as(n integer, q text, expected text default '00000') returns jsonb
language plpgsql security invoker as $$
declare
  payload jsonb;
  code text := '00000';
  message text;
begin
  perform set_config('request.jwt.claim.sub', coalesce(pg_temp.reason_id(n)::text, ''), true);
  begin
    set local role authenticated;
    execute q into payload;
    reset role;
  exception when others then
    get stacked diagnostics code = returned_sqlstate, message = message_text;
    reset role;
  end;
  if code <> expected then
    raise exception 'Esperado %, recebido %: %', expected, code, message;
  end if;
  return payload;
end $$;

-- Fixtures de teste
insert into auth.users(id, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select pg_temp.reason_id(n), 'reason020_' || n || '@example.com', clock_timestamp(), '{"provider":"email"}'::jsonb,
  '{}'::jsonb, clock_timestamp(), clock_timestamp() from generate_series(1, 4) n;

insert into app_private.churches(id, name, timezone, default_duration_policy) values
  (pg_temp.reason_id(100), 'Igreja Central 020', 'America/Sao_Paulo', 'warn'),
  (pg_temp.reason_id(200), 'Igreja Bairro 020', 'America/Sao_Paulo', 'warn');

insert into app_private.members(id, church_id, display_name, created_by_user_id) values
  (pg_temp.reason_id(11), pg_temp.reason_id(100), 'Admin Igreja 100', pg_temp.reason_id(1)),
  (pg_temp.reason_id(12), pg_temp.reason_id(100), 'Membro Igreja 100', pg_temp.reason_id(1)),
  (pg_temp.reason_id(13), pg_temp.reason_id(200), 'Admin Igreja 200', pg_temp.reason_id(3));

insert into app_private.church_access(church_id, user_id, member_id, is_admin, onboarding_completed_at, granted_by_user_id) values
  (pg_temp.reason_id(100), pg_temp.reason_id(1), pg_temp.reason_id(11), true, clock_timestamp(), pg_temp.reason_id(1)),
  (pg_temp.reason_id(100), pg_temp.reason_id(2), pg_temp.reason_id(12), false, clock_timestamp(), pg_temp.reason_id(1)),
  (pg_temp.reason_id(200), pg_temp.reason_id(3), pg_temp.reason_id(13), true, clock_timestamp(), pg_temp.reason_id(3));

do $cases$
declare
  result jsonb;
  q text;
  created_reason_id uuid;
  in_use_reason_id uuid;
  audit_rec record;
begin
  -- R01 (CA01): Membro comum da mesma igreja não tem permissão para cadastrar motivo (42501)
  perform pg_temp.reason_as(2, format('select to_jsonb(r) from public.create_cancellation_reason(%L, %L, %L) r',
    pg_temp.reason_id(100), pg_temp.reason_id(1001), 'Problema Técnico'), '42501');

  -- R02 (CA01): Administrador de outra igreja não consegue cadastrar motivo para Igreja 100 (42501)
  perform pg_temp.reason_as(3, format('select to_jsonb(r) from public.create_cancellation_reason(%L, %L, %L) r',
    pg_temp.reason_id(100), pg_temp.reason_id(1002), 'Problema Técnico Invasor'), '42501');

  -- R03 (CA01): Nome em branco ou apenas espaços é rejeitado (23514)
  perform pg_temp.reason_as(1, format('select to_jsonb(r) from public.create_cancellation_reason(%L, %L, %L) r',
    pg_temp.reason_id(100), pg_temp.reason_id(1003), '   '), '23514');

  -- R04 (CA01): Nome superior a 120 caracteres é rejeitado (23514)
  perform pg_temp.reason_as(1, format('select to_jsonb(r) from public.create_cancellation_reason(%L, %L, %L) r',
    pg_temp.reason_id(100), pg_temp.reason_id(1004), repeat('M', 121)), '23514');

  -- R05 (CA01): Administrador cadastra novo motivo com sucesso (com trim e normalização NFC)
  q := format('select to_jsonb(r) from public.create_cancellation_reason(%L, %L, %L) r',
    pg_temp.reason_id(100), pg_temp.reason_id(1005), '  Chuva Forte e Queda de Energia  ');
  result := pg_temp.reason_as(1, q);

  created_reason_id := (result->>'id')::uuid;
  if created_reason_id is null or result->>'name' <> 'Chuva Forte e Queda de Energia' or (result->>'active')::boolean is not true then
    raise exception 'R05: Motivo não retornado adequadamente no cadastro: %', result;
  end if;

  -- R06: Idempotência de create_cancellation_reason com mesmo command_id
  result := pg_temp.reason_as(1, q);
  if (result->>'id')::uuid <> created_reason_id then
    raise exception 'R06: Idempotência falhou ao reutilizar command_id.';
  end if;

  -- R07: Duplicidade insensível a maiúsculas/minúsculas rejeitada na mesma igreja (23505)
  perform pg_temp.reason_as(1, format('select to_jsonb(r) from public.create_cancellation_reason(%L, %L, %L) r',
    pg_temp.reason_id(100), pg_temp.reason_id(1007), 'chuva forte e queda de energia'), '23505');

  -- R08: Mesmo nome em outra igreja permitido
  perform pg_temp.reason_as(3, format('select to_jsonb(r) from public.create_cancellation_reason(%L, %L, %L) r',
    pg_temp.reason_id(200), pg_temp.reason_id(2001), 'Chuva Forte e Queda de Energia'));

  -- R09: Listagem de motivos ativos
  q := format('select jsonb_agg(to_jsonb(r)) from public.list_cancellation_reasons(%L, true) r', pg_temp.reason_id(100));
  result := pg_temp.reason_as(1, q);
  if jsonb_array_length(result) < 1 then
    raise exception 'R09: Listagem de motivos ativos deveria retornar ao menos 1 registro.';
  end if;

  -- R10 (CA03): Administrador altera descrição do motivo
  q := format('select to_jsonb(r) from public.update_cancellation_reason(%L, %L, %L, %L) r',
    pg_temp.reason_id(100), pg_temp.reason_id(1010), created_reason_id, '  Queda de Energia Local  ');
  result := pg_temp.reason_as(1, q);
  if result->>'name' <> 'Queda de Energia Local' then
    raise exception 'R10: Nome atualizado divergente do esperado.';
  end if;

  -- Verifica registro de auditoria da alteração
  select * into audit_rec from app_private.audit_entries
  where church_id = pg_temp.reason_id(100) and action = 'update_cancellation_reason';
  if not found or audit_rec.details->>'previous_name' <> 'Chuva Forte e Queda de Energia'
    or audit_rec.details->>'new_name' <> 'Queda de Energia Local' then
    raise exception 'R10: Auditoria de atualização divergente do esperado.';
  end if;

  -- R11: Cadastrar segundo motivo para testar colisão e exclusão
  q := format('select to_jsonb(r) from public.create_cancellation_reason(%L, %L, %L) r',
    pg_temp.reason_id(100), pg_temp.reason_id(1011), 'Ajuste de Cronograma');
  result := pg_temp.reason_as(1, q);
  in_use_reason_id := (result->>'id')::uuid;

  -- Alteração para nome existente é rejeitada (23505)
  perform pg_temp.reason_as(1, format('select to_jsonb(r) from public.update_cancellation_reason(%L, %L, %L, %L) r',
    pg_temp.reason_id(100), pg_temp.reason_id(1012), created_reason_id, 'Ajuste de Cronograma'), '23505');

  -- R12 (CA03): Desativar motivo com sucesso
  q := format('select to_jsonb(r) from public.toggle_cancellation_reason_status(%L, %L, %L, false) r',
    pg_temp.reason_id(100), pg_temp.reason_id(1013), created_reason_id);
  result := pg_temp.reason_as(1, q);
  if (result->>'active')::boolean is not false then
    raise exception 'R12: Motivo deveria ter sido desativado.';
  end if;

  -- Listagem com p_only_active = true não deve trazer o motivo desativado
  q := format('select jsonb_agg(to_jsonb(r)) from public.list_cancellation_reasons(%L, true) r', pg_temp.reason_id(100));
  result := pg_temp.reason_as(1, q);
  if result @> jsonb_build_array(jsonb_build_object('id', created_reason_id)) then
    raise exception 'R12: Motivo desativado não deveria constar na lista de apenas ativos.';
  end if;

  -- R13 (CA03): Excluir motivo não utilizado no histórico é permitido
  q := format('select to_jsonb(r) from public.delete_cancellation_reason(%L, %L, %L) r',
    pg_temp.reason_id(100), pg_temp.reason_id(1014), created_reason_id);
  result := pg_temp.reason_as(1, q);
  if (result->>'deleted')::boolean is not true then
    raise exception 'R13: Exclusão de motivo sem histórico deveria retornar deleted=true.';
  end if;

  -- R14 (CA03): Simular uso do motivo in_use_reason_id no histórico de auditoria/atividades
  insert into app_private.audit_entries (
    church_id, entity_type, entity_id, action, actor_user_id, details
  ) values (
    pg_temp.reason_id(100), 'activity_cancellation', gen_random_uuid(), 'cancel_activity', pg_temp.reason_id(1),
    jsonb_build_object('cancellation_reason_id', in_use_reason_id, 'reason', 'Ajuste de Cronograma')
  );

  -- Tentativa de exclusão de motivo usado em histórico é estritamente bloqueada (23503)
  perform pg_temp.reason_as(1, format('select to_jsonb(r) from public.delete_cancellation_reason(%L, %L, %L) r',
    pg_temp.reason_id(100), pg_temp.reason_id(1015), in_use_reason_id), '23503');

  -- R15: Desativação do motivo em uso é permitida como alternativa à exclusão física
  perform pg_temp.reason_as(1, format('select to_jsonb(r) from public.toggle_cancellation_reason_status(%L, %L, %L, false) r',
    pg_temp.reason_id(100), pg_temp.reason_id(1016), in_use_reason_id));

end $cases$;
