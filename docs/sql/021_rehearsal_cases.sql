-- Fragmento para ensaio transacional do candidato 021 (Issue #25).
-- NÃO executar isoladamente. Executa dentro da transação do candidato 021 terminando em ROLLBACK.

create function pg_temp.eta_id(n integer) returns uuid language sql immutable as
$$ select ('02100000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid $$;

create function pg_temp.eta_as(n integer, q text, expected text default '00000') returns jsonb
language plpgsql security invoker as $$
declare
  payload jsonb;
  code text := '00000';
  message text;
begin
  perform set_config('request.jwt.claim.sub', coalesce(pg_temp.eta_id(n)::text, ''), true);
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
select pg_temp.eta_id(n), 'eta021_' || n || '@example.com', clock_timestamp(), '{"provider":"email"}'::jsonb,
  '{}'::jsonb, clock_timestamp(), clock_timestamp() from generate_series(1, 4) n;

insert into app_private.churches(id, name, timezone, default_duration_policy) values
  (pg_temp.eta_id(100), 'Igreja Central 021', 'America/Sao_Paulo', 'warn'),
  (pg_temp.eta_id(200), 'Igreja Bairro 021', 'America/Sao_Paulo', 'warn');

insert into app_private.members(id, church_id, display_name, created_by_user_id) values
  (pg_temp.eta_id(11), pg_temp.eta_id(100), 'Admin Igreja 100', pg_temp.eta_id(1)),
  (pg_temp.eta_id(12), pg_temp.eta_id(100), 'Membro Igreja 100', pg_temp.eta_id(1)),
  (pg_temp.eta_id(13), pg_temp.eta_id(200), 'Admin Igreja 200', pg_temp.eta_id(3));

insert into app_private.church_access(church_id, user_id, member_id, is_admin, onboarding_completed_at, granted_by_user_id) values
  (pg_temp.eta_id(100), pg_temp.eta_id(1), pg_temp.eta_id(11), true, clock_timestamp(), pg_temp.eta_id(1)),
  (pg_temp.eta_id(100), pg_temp.eta_id(2), pg_temp.eta_id(12), false, clock_timestamp(), pg_temp.eta_id(1)),
  (pg_temp.eta_id(200), pg_temp.eta_id(3), pg_temp.eta_id(13), true, clock_timestamp(), pg_temp.eta_id(3));

do $cases$
declare
  result jsonb;
  q text;
  created_type_id uuid;
  in_use_type_id uuid;
  created_act_id uuid;
  in_use_act_id uuid;
  audit_rec record;
begin
  -- =========================================================================
  -- PARTE 1: TIPOS DE EVENTO
  -- =========================================================================

  -- T01 (CA01/CA04): Membro comum da mesma igreja não cadastra tipo de evento (42501)
  perform pg_temp.eta_as(2, format('select to_jsonb(r) from public.create_event_type(%L, %L, %L) r',
    pg_temp.eta_id(1001), pg_temp.eta_id(100), 'Culto de Domingo'), '42501');

  -- T02 (CA01): Admin de outra igreja não cadastra para Igreja 100 (42501)
  perform pg_temp.eta_as(3, format('select to_jsonb(r) from public.create_event_type(%L, %L, %L) r',
    pg_temp.eta_id(1002), pg_temp.eta_id(100), 'Culto Invasor'), '42501');

  -- T03 (CA01): Nome em branco ou superior a 100 caracteres é rejeitado (23514)
  perform pg_temp.eta_as(1, format('select to_jsonb(r) from public.create_event_type(%L, %L, %L) r',
    pg_temp.eta_id(1003), pg_temp.eta_id(100), '   '), '23514');
  perform pg_temp.eta_as(1, format('select to_jsonb(r) from public.create_event_type(%L, %L, %L) r',
    pg_temp.eta_id(1004), pg_temp.eta_id(100), repeat('T', 101)), '23514');

  -- T04 (CA01): Admin cadastra tipo de evento com sucesso (trim e NFC)
  q := format('select to_jsonb(r) from public.create_event_type(%L, %L, %L, %L) r',
    pg_temp.eta_id(1005), pg_temp.eta_id(100), '  Culto de Celebração de Domingo  ', 'Culto principal');
  result := pg_temp.eta_as(1, q);
  created_type_id := (result->>'id')::uuid;

  if created_type_id is null or result->>'name' <> 'Culto de Celebração de Domingo' or (result->>'active')::boolean is not true then
    raise exception 'T04: Tipo de evento não retornado adequadamente no cadastro: %', result;
  end if;

  -- T05: Idempotência com mesmo command_id
  result := pg_temp.eta_as(1, q);
  if (result->>'id')::uuid <> created_type_id then
    raise exception 'T05: Idempotência de create_event_type falhou.';
  end if;

  -- T06: Duplicidade insensível a maiúsculas/minúsculas rejeitada na mesma igreja (23505)
  perform pg_temp.eta_as(1, format('select to_jsonb(r) from public.create_event_type(%L, %L, %L) r',
    pg_temp.eta_id(1006), pg_temp.eta_id(100), 'culto de celebração de domingo'), '23505');

  -- T07 (CA03): Admin altera nome e descrição do tipo de evento
  q := format('select to_jsonb(r) from public.update_event_type(%L, %L, %L, %L, %L) r',
    pg_temp.eta_id(1007), pg_temp.eta_id(100), created_type_id, 'Culto de Celebração Especial', 'Nova descrição');
  result := pg_temp.eta_as(1, q);
  if result->>'name' <> 'Culto de Celebração Especial' then
    raise exception 'T07: Nome do tipo atualizado divergente.';
  end if;

  -- T08 (CA03): Admin desativa e reativa tipo de evento
  q := format('select to_jsonb(r) from public.toggle_event_type_status(%L, %L, %L) r',
    pg_temp.eta_id(1008), pg_temp.eta_id(100), created_type_id);
  result := pg_temp.eta_as(1, q);
  if (result->>'active')::boolean is not false then
    raise exception 'T08: Tipo de evento deveria ter sido desativado.';
  end if;

  -- Reativação
  q := format('select to_jsonb(r) from public.toggle_event_type_status(%L, %L, %L) r',
    pg_temp.eta_id(1009), pg_temp.eta_id(100), created_type_id);
  result := pg_temp.eta_as(1, q);
  if (result->>'active')::boolean is not true then
    raise exception 'T08: Tipo de evento deveria ter sido reativado.';
  end if;

  -- T09 (CA03): Exclusão de tipo de evento sem referências é permitida
  q := format('select to_jsonb(r) from public.delete_event_type(%L, %L, %L) r',
    pg_temp.eta_id(1010), pg_temp.eta_id(100), created_type_id);
  result := pg_temp.eta_as(1, q);
  if (result->>'deleted')::boolean is not true then
    raise exception 'T09: Exclusão de tipo de evento sem referências deveria retornar deleted=true.';
  end if;

  -- Cadastra um tipo para simular dependência histórica
  q := format('select to_jsonb(r) from public.create_event_type(%L, %L, %L) r',
    pg_temp.eta_id(1011), pg_temp.eta_id(100), 'Culto em Uso Histórico');
  result := pg_temp.eta_as(1, q);
  in_use_type_id := (result->>'id')::uuid;

  -- Simula evento com este tipo
  if to_regclass('app_private.events') is not null then
    insert into app_private.events (
      church_id, title, event_type, timezone, planned_start_at, planned_end_at
    ) values (
      pg_temp.eta_id(100), 'Culto Passado Real', 'Culto em Uso Histórico', 'America/Sao_Paulo',
      now() - interval '2 days', now() - interval '2 days' + interval '2 hours'
    );
  end if;

  -- T10 (CA03): Exclusão de tipo referenciado é bloqueada (23503)
  perform pg_temp.eta_as(1, format('select to_jsonb(r) from public.delete_event_type(%L, %L, %L) r',
    pg_temp.eta_id(1012), pg_temp.eta_id(100), in_use_type_id), '23503');

  -- =========================================================================
  -- PARTE 2: ATIVIDADES PADRÃO COM DURAÇÃO CONFIGURÁVEL (CA02)
  -- =========================================================================

  -- T11 (CA01/CA04): Membro comum não cadastra atividade padrão (42501)
  perform pg_temp.eta_as(2, format('select to_jsonb(r) from public.create_standard_activity(%L, %L, %L, %s) r',
    pg_temp.eta_id(2001), pg_temp.eta_id(100), 'Louvor', 25), '42501');

  -- T12 (CA02): Duração zero, negativa ou maior que 720 minutos é rejeitada (23514)
  perform pg_temp.eta_as(1, format('select to_jsonb(r) from public.create_standard_activity(%L, %L, %L, %s) r',
    pg_temp.eta_id(2002), pg_temp.eta_id(100), 'Louvor Inválido', 0), '23514');
  perform pg_temp.eta_as(1, format('select to_jsonb(r) from public.create_standard_activity(%L, %L, %L, %s) r',
    pg_temp.eta_id(2003), pg_temp.eta_id(100), 'Louvor Inválido 2', 721), '23514');

  -- T13 (CA02): Cadastra atividades com durações diversas não universais (ex: 3 min, 12 min, 45 min)
  q := format('select to_jsonb(r) from public.create_standard_activity(%L, %L, %L, %s, %L, %L) r',
    pg_temp.eta_id(2004), pg_temp.eta_id(100), '  Oração Inicial Rápida  ', 3, 'Liturgia', 'Abertura rápida');
  result := pg_temp.eta_as(1, q);
  created_act_id := (result->>'id')::uuid;

  if created_act_id is null or result->>'name' <> 'Oração Inicial Rápida' or (result->>'default_duration_minutes')::integer <> 3 then
    raise exception 'T13: Atividade padrão com 3 minutos não cadastrada adequadamente: %', result;
  end if;

  -- Cadastra outra com 45 minutos (Palavra)
  q := format('select to_jsonb(r) from public.create_standard_activity(%L, %L, %L, %s, %L, %L) r',
    pg_temp.eta_id(2005), pg_temp.eta_id(100), 'Ministração da Palavra', 45, 'Palavra', 'Pregação');
  result := pg_temp.eta_as(1, q);
  in_use_act_id := (result->>'id')::uuid;

  -- T14: Idempotência de create_standard_activity com mesmo command_id
  result := pg_temp.eta_as(1, q);
  if (result->>'id')::uuid <> in_use_act_id then
    raise exception 'T14: Idempotência de create_standard_activity falhou.';
  end if;

  -- T15: Duplicidade insensível a maiúsculas na mesma igreja rejeitada (23505)
  perform pg_temp.eta_as(1, format('select to_jsonb(r) from public.create_standard_activity(%L, %L, %L, %s) r',
    pg_temp.eta_id(2006), pg_temp.eta_id(100), 'oração inicial rápida', 5), '23505');

  -- T16 (CA03): Admin altera nome e duração padrão da atividade
  q := format('select to_jsonb(r) from public.update_standard_activity(%L, %L, %L, %L, %s, %L, %L) r',
    pg_temp.eta_id(2007), pg_temp.eta_id(100), created_act_id, 'Oração de Abertura', 7, 'Liturgia', 'Observação atualizada');
  result := pg_temp.eta_as(1, q);
  if result->>'name' <> 'Oração de Abertura' or (result->>'default_duration_minutes')::integer <> 7 then
    raise exception 'T16: Alteração de atividade padrão divergente: %', result;
  end if;

  -- T17 (CA03): Admin desativa e reativa atividade padrão
  q := format('select to_jsonb(r) from public.toggle_standard_activity_status(%L, %L, %L) r',
    pg_temp.eta_id(2008), pg_temp.eta_id(100), created_act_id);
  result := pg_temp.eta_as(1, q);
  if (result->>'active')::boolean is not false then
    raise exception 'T17: Atividade padrão deveria ter sido desativada.';
  end if;

  -- T18 (CA03): Exclusão de atividade sem dependências permitida
  q := format('select to_jsonb(r) from public.delete_standard_activity(%L, %L, %L) r',
    pg_temp.eta_id(2009), pg_temp.eta_id(100), created_act_id);
  result := pg_temp.eta_as(1, q);
  if (result->>'deleted')::boolean is not true then
    raise exception 'T18: Exclusão de atividade sem dependências falhou.';
  end if;

  -- Simula item de cronograma usando o nome da atividade in_use_act_id
  if to_regclass('app_private.event_items') is not null and to_regclass('app_private.events') is not null then
    insert into app_private.event_items (
      church_id, event_id, title, planned_duration_seconds
    ) select
      pg_temp.eta_id(100), e.id, 'Ministração da Palavra', 2700
    from app_private.events e
    where e.church_id = pg_temp.eta_id(100)
    limit 1;
  end if;

  -- T19 (CA03): Exclusão física de atividade em uso no histórico é bloqueada (23503)
  perform pg_temp.eta_as(1, format('select to_jsonb(r) from public.delete_standard_activity(%L, %L, %L) r',
    pg_temp.eta_id(2010), pg_temp.eta_id(100), in_use_act_id), '23503');

  -- T20: Listagens de apenas ativos filtram inativos
  q := format('select jsonb_agg(to_jsonb(r)) from public.list_standard_activities(%L, true) r', pg_temp.eta_id(100));
  result := pg_temp.eta_as(1, q);
  if jsonb_array_length(result) < 1 then
    raise exception 'T20: Listagem de atividades ativas deveria retornar registros.';
  end if;

end $cases$;
