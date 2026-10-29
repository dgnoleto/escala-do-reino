-- Fragmento para ensaio transacional do candidato 021 (Issue #25).
-- NÃO executar isoladamente. Executa dentro da transação do candidato 021 terminando em ROLLBACK.

create function pg_temp.eta_id(n integer) returns uuid language sql immutable as
$$ select ('02100000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid $$;

create function pg_temp.eta_as(n integer, q text, expected text default '00000', expected_msg text default null) returns jsonb
language plpgsql security invoker as $$
declare
  payload jsonb;
  code text := '00000';
  message text := '';
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
  if expected_msg is not null and message not like ('%' || expected_msg || '%') then
    raise exception 'Esperado trecho de mensagem "%", recebido: "%"', expected_msg, message;
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
  in_use_event_id uuid;
  insufficient_type_id uuid;
  template_type_id uuid;
  other_church_type_id uuid;
  created_act_id uuid;
  in_use_act_id uuid;
  in_use_item_id uuid;
  insufficient_act_id uuid;
  template_act_id uuid;
  other_church_act_id uuid;
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

  -- T09 (CA03): Exclusão de tipo sem dependências é contida no servidor (23503 com mensagem de ausência de comprovação)
  perform pg_temp.eta_as(1, format('select to_jsonb(r) from public.delete_event_type(%L, %L, %L) r',
    pg_temp.eta_id(1010), pg_temp.eta_id(100), created_type_id), '23503', 'Não é possível comprovar ausência de uso histórico');
  if not exists (
    select 1 from app_private.event_types
    where id = created_type_id and church_id = pg_temp.eta_id(100)
  ) then
    raise exception 'T09: Tipo de evento deveria permanecer cadastrado sob contenção explícita.';
  end if;

  -- Cadastra um tipo para simular dependência histórica
  q := format('select to_jsonb(r) from public.create_event_type(%L, %L, %L) r',
    pg_temp.eta_id(1011), pg_temp.eta_id(100), 'Culto em Uso Histórico');
  result := pg_temp.eta_as(1, q);
  in_use_type_id := (result->>'id')::uuid;

  -- Simula evento com este tipo com UUID fixo e determinístico
  if to_regclass('app_private.events') is not null then
    insert into app_private.events (
      id, church_id, title, event_type, timezone, planned_start_at, planned_end_at
    ) values (
      pg_temp.eta_id(1050), pg_temp.eta_id(100), 'Culto Passado Real', 'Culto em Uso Histórico', 'America/Sao_Paulo',
      now() - interval '2 days', now() - interval '2 days' + interval '2 hours'
    ) returning id into in_use_event_id;
  end if;

  -- T10 (CA03): Exclusão de tipo referenciado diretamente é bloqueada (23503 com mensagem de em uso) e snapshot é preservado
  perform pg_temp.eta_as(1, format('select to_jsonb(r) from public.delete_event_type(%L, %L, %L) r',
    pg_temp.eta_id(1012), pg_temp.eta_id(100), in_use_type_id), '23503', 'já foi utilizado em cultos históricos');
  if not exists (
    select 1 from app_private.event_types
    where id = in_use_type_id and church_id = pg_temp.eta_id(100) and name = 'Culto em Uso Histórico'
  ) then
    raise exception 'T10: Tipo em uso deveria permanecer cadastrado após tentativa de exclusão.';
  end if;
  if in_use_event_id is not null and not exists (
    select 1 from app_private.events
    where id = in_use_event_id and church_id = pg_temp.eta_id(100) and event_type = 'Culto em Uso Histórico'
  ) then
    raise exception 'T10: Snapshot do evento histórico exato foi corrompido.';
  end if;

  -- T10b (CA03: usar -> renomear -> tentar excluir): renomear tipo usado preserva proteção histórica (23503 com mensagem de em uso)
  q := format('select to_jsonb(r) from public.update_event_type(%L, %L, %L, %L) r',
    pg_temp.eta_id(1013), pg_temp.eta_id(100), in_use_type_id, 'Culto com Nome Alterado');
  result := pg_temp.eta_as(1, q);
  if result->>'name' <> 'Culto com Nome Alterado' then
    raise exception 'T10b: Falha ao renomear tipo em uso.';
  end if;

  perform pg_temp.eta_as(1, format('select to_jsonb(r) from public.delete_event_type(%L, %L, %L) r',
    pg_temp.eta_id(1014), pg_temp.eta_id(100), in_use_type_id), '23503', 'já foi utilizado em cultos históricos');

  if not exists (
    select 1 from app_private.event_types
    where id = in_use_type_id and church_id = pg_temp.eta_id(100) and name = 'Culto com Nome Alterado'
  ) then
    raise exception 'T10b: Cadastro deveria permanecer com nome atualizado após recusa.';
  end if;
  if in_use_event_id is not null and not exists (
    select 1 from app_private.events
    where id = in_use_event_id and church_id = pg_temp.eta_id(100) and event_type = 'Culto em Uso Histórico'
  ) then
    raise exception 'T10b: Snapshot histórico do evento exato foi indevidamente modificado.';
  end if;

  -- T10c (CA03: informação insuficiente): sem auditoria ou com auditoria incompleta, exclusão física é contida no servidor (23503 com mensagem de ausência de comprovação)
  q := format('select to_jsonb(r) from public.create_event_type(%L, %L, %L) r',
    pg_temp.eta_id(1015), pg_temp.eta_id(100), 'Tipo Sem Trilha Completa');
  result := pg_temp.eta_as(1, q);
  insufficient_type_id := (result->>'id')::uuid;

  delete from app_private.audit_entries
  where church_id = pg_temp.eta_id(100) and target_type = 'event_type' and target_id = insufficient_type_id;

  perform pg_temp.eta_as(1, format('select to_jsonb(r) from public.delete_event_type(%L, %L, %L) r',
    pg_temp.eta_id(1016), pg_temp.eta_id(100), insufficient_type_id), '23503', 'Não é possível comprovar ausência de uso histórico');

  if not exists (
    select 1 from app_private.event_types
    where id = insufficient_type_id and church_id = pg_temp.eta_id(100)
  ) then
    raise exception 'T10c: Cadastro com informação insuficiente deveria permanecer sob contenção.';
  end if;

  -- T10d (CA03: referências estáveis disponíveis): referência em service_templates bloqueia exclusão (23503)
  if to_regclass('app_private.service_templates') is not null then
    q := format('select to_jsonb(r) from public.create_event_type(%L, %L, %L) r',
      pg_temp.eta_id(1017), pg_temp.eta_id(100), 'Tipo Vinculado a Modelo');
    result := pg_temp.eta_as(1, q);
    template_type_id := (result->>'id')::uuid;

    insert into app_private.service_templates (church_id, name, event_type_id)
    values (pg_temp.eta_id(100), 'Modelo Teste 100', template_type_id);

    perform pg_temp.eta_as(1, format('select to_jsonb(r) from public.delete_event_type(%L, %L, %L) r',
      pg_temp.eta_id(1018), pg_temp.eta_id(100), template_type_id), '23503', 'já foi utilizado em cultos históricos');

    if not exists (
      select 1 from app_private.event_types
      where id = template_type_id and church_id = pg_temp.eta_id(100)
    ) then
      raise exception 'T10d: Tipo vinculado a modelo deveria permanecer cadastrado.';
    end if;
  else
    raise notice 'T10d: Cenário condicional de modelos 022 NÃO EXECUTADO (service_templates ausente).';
  end if;

  -- T10e (CA03: isolamento por igreja e autorização):
  -- Membro comum não exclui (42501)
  perform pg_temp.eta_as(2, format('select to_jsonb(r) from public.delete_event_type(%L, %L, %L) r',
    pg_temp.eta_id(1019), pg_temp.eta_id(100), in_use_type_id), '42501');

  -- Admin da Igreja 200 não exclui tipo da Igreja 100 (42501)
  perform pg_temp.eta_as(3, format('select to_jsonb(r) from public.delete_event_type(%L, %L, %L) r',
    pg_temp.eta_id(1020), pg_temp.eta_id(100), in_use_type_id), '42501');

  -- Tentativa com identificador inexistente na igreja retorna P0002
  perform pg_temp.eta_as(1, format('select to_jsonb(r) from public.delete_event_type(%L, %L, %L) r',
    pg_temp.eta_id(1023), pg_temp.eta_id(100), pg_temp.eta_id(9999)), 'P0002');

  -- Tipo livre na Igreja 200 é contido sob as mesmas regras do servidor e permanece intacto
  q := format('select to_jsonb(r) from public.create_event_type(%L, %L, %L) r',
    pg_temp.eta_id(1021), pg_temp.eta_id(200), 'Culto em Uso Histórico');
  result := pg_temp.eta_as(3, q);
  other_church_type_id := (result->>'id')::uuid;

  perform pg_temp.eta_as(3, format('select to_jsonb(r) from public.delete_event_type(%L, %L, %L) r',
    pg_temp.eta_id(1022), pg_temp.eta_id(200), other_church_type_id), '23503', 'Não é possível comprovar ausência de uso histórico');

  if not exists (
    select 1 from app_private.event_types
    where id = other_church_type_id and church_id = pg_temp.eta_id(200)
  ) then
    raise exception 'T10e: Tipo da Igreja 200 deveria permanecer cadastrado sob contenção.';
  end if;

  -- T10f (CA03: tratamento estrito de recibos e replays para delete_event_type):
  -- 1. Reutilização de command_id de outra operação (criação T04/1005) em exclusão é rejeitada com 23505
  perform pg_temp.eta_as(1, format('select to_jsonb(r) from public.delete_event_type(%L, %L, %L) r',
    pg_temp.eta_id(1005), pg_temp.eta_id(100), created_type_id), '23505', 'Conflito de command_id');

  -- 2. Autorização sobre recibo próprio (Correção 1):
  -- Prepara recibo correspondente ao próprio usuário 2 (sem autorização administrativa vigente),
  -- demonstrando coincidência de user_id (2), command_id (1031), igreja (100), ação ('delete_event_type')
  -- e alvo (created_type_id). A condição impeditiva é exclusivamente a falta de autorização atual (42501).
  insert into app_private.event_type_activity_receipts (
    user_id, command_id, church_id, action, params, result
  ) values (
    pg_temp.eta_id(2), pg_temp.eta_id(1031), pg_temp.eta_id(100),
    'delete_event_type', jsonb_build_object('type_id', created_type_id),
    jsonb_build_object('status', 'ok', 'id', created_type_id, 'deleted', true)
  );

  perform pg_temp.eta_as(2, format('select to_jsonb(r) from public.delete_event_type(%L, %L, %L) r',
    pg_temp.eta_id(1031), pg_temp.eta_id(100), created_type_id), '42501', 'Permissão insuficiente');

  -- 3. Replay com alvo ausente pelo administrador autorizado (Correção 2):
  -- Prepara recibo histórico simulado para um UUID comprovadamente inexistente na tabela event_types.
  -- Confere explicitamente a ausência sem efetuar exclusão física ou depender de apagar cadastro real.
  if exists (
    select 1 from app_private.event_types
    where id = pg_temp.eta_id(9100)
  ) then
    raise exception 'T10f: Alvo para ensaio de inexistência não deveria constar em event_types.';
  end if;

  insert into app_private.event_type_activity_receipts (
    user_id, command_id, church_id, action, params, result
  ) values (
    pg_temp.eta_id(1), pg_temp.eta_id(1032), pg_temp.eta_id(100),
    'delete_event_type', jsonb_build_object('type_id', pg_temp.eta_id(9100)),
    jsonb_build_object('status', 'ok', 'id', pg_temp.eta_id(9100), 'deleted', true)
  );

  q := format('select to_jsonb(r) from public.delete_event_type(%L, %L, %L) r',
    pg_temp.eta_id(1032), pg_temp.eta_id(100), pg_temp.eta_id(9100));
  result := pg_temp.eta_as(1, q);
  if (result->>'deleted')::boolean is not true or (result->>'id')::uuid is distinct from pg_temp.eta_id(9100) then
    raise exception 'T10f: Replay com alvo ausente deveria retornar sucesso coerente do recibo: %', result;
  end if;

  if exists (
    select 1 from app_private.event_types
    where id = pg_temp.eta_id(9100)
  ) then
    raise exception 'T10f: Replay de alvo ausente não deve reinserir registro físico na tabela.';
  end if;

  -- 4. Simula recibo de exclusão prévia para alvo cadastrado (created_type_id)
  insert into app_private.event_type_activity_receipts (
    user_id, command_id, church_id, action, params, result
  ) values (
    pg_temp.eta_id(1), pg_temp.eta_id(1030), pg_temp.eta_id(100),
    'delete_event_type', jsonb_build_object('type_id', created_type_id),
    jsonb_build_object('status', 'ok', 'id', created_type_id, 'deleted', true)
  );

  -- 5. Replay legítimo pelo Admin autorizado retorna o resultado da exclusão previamente concluída
  q := format('select to_jsonb(r) from public.delete_event_type(%L, %L, %L) r',
    pg_temp.eta_id(1030), pg_temp.eta_id(100), created_type_id);
  result := pg_temp.eta_as(1, q);
  if (result->>'deleted')::boolean is not true then
    raise exception 'T10f: Replay legítimo de exclusão deveria retornar deleted=true.';
  end if;

  -- 6. Replay com target_id divergente é rejeitado com 23505
  perform pg_temp.eta_as(1, format('select to_jsonb(r) from public.delete_event_type(%L, %L, %L) r',
    pg_temp.eta_id(1030), pg_temp.eta_id(100), in_use_type_id), '23505', 'Conflito de command_id');

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

  -- T18 (CA03): Exclusão física de atividade sem dependências é contida no servidor (23503 com mensagem de ausência de comprovação)
  perform pg_temp.eta_as(1, format('select to_jsonb(r) from public.delete_standard_activity(%L, %L, %L) r',
    pg_temp.eta_id(2009), pg_temp.eta_id(100), created_act_id), '23503', 'Não é possível comprovar ausência de uso histórico');
  if not exists (
    select 1 from app_private.standard_activities
    where id = created_act_id and church_id = pg_temp.eta_id(100)
  ) then
    raise exception 'T18: Atividade padrão deveria permanecer cadastrada sob contenção explícita.';
  end if;

  -- Simula item de cronograma usando o nome da atividade in_use_act_id vinculado ao evento exato
  if to_regclass('app_private.event_items') is not null and in_use_event_id is not null then
    insert into app_private.event_items (
      id, church_id, event_id, title, planned_duration_seconds
    ) values (
      pg_temp.eta_id(2050), pg_temp.eta_id(100), in_use_event_id, 'Ministração da Palavra', 2700
    ) returning id into in_use_item_id;
  end if;

  -- T19 (CA03): Exclusão física de atividade em uso no histórico é bloqueada (23503 com mensagem de em uso) e snapshot é preservado
  perform pg_temp.eta_as(1, format('select to_jsonb(r) from public.delete_standard_activity(%L, %L, %L) r',
    pg_temp.eta_id(2010), pg_temp.eta_id(100), in_use_act_id), '23503', 'já foi utilizada em cultos históricos');
  if not exists (
    select 1 from app_private.standard_activities
    where id = in_use_act_id and church_id = pg_temp.eta_id(100) and name = 'Ministração da Palavra'
  ) then
    raise exception 'T19: Atividade em uso deveria permanecer cadastrada após tentativa de exclusão.';
  end if;
  if in_use_item_id is not null and not exists (
    select 1 from app_private.event_items
    where id = in_use_item_id and church_id = pg_temp.eta_id(100) and title = 'Ministração da Palavra'
  ) then
    raise exception 'T19: Snapshot do item histórico exato foi corrompido.';
  end if;

  -- T19b (CA03: usar -> renomear -> tentar excluir): renomear atividade usada preserva proteção histórica (23503 com mensagem de em uso)
  q := format('select to_jsonb(r) from public.update_standard_activity(%L, %L, %L, %L, %s) r',
    pg_temp.eta_id(2011), pg_temp.eta_id(100), in_use_act_id, 'Palavra Expositiva', 50);
  result := pg_temp.eta_as(1, q);
  if result->>'name' <> 'Palavra Expositiva' then
    raise exception 'T19b: Falha ao renomear atividade em uso.';
  end if;

  perform pg_temp.eta_as(1, format('select to_jsonb(r) from public.delete_standard_activity(%L, %L, %L) r',
    pg_temp.eta_id(2012), pg_temp.eta_id(100), in_use_act_id), '23503', 'já foi utilizada em cultos históricos');

  if not exists (
    select 1 from app_private.standard_activities
    where id = in_use_act_id and church_id = pg_temp.eta_id(100) and name = 'Palavra Expositiva'
  ) then
    raise exception 'T19b: Cadastro de atividade deveria permanecer com nome atualizado após recusa.';
  end if;
  if in_use_item_id is not null and not exists (
    select 1 from app_private.event_items
    where id = in_use_item_id and church_id = pg_temp.eta_id(100) and title = 'Ministração da Palavra'
  ) then
    raise exception 'T19b: Snapshot histórico do item de evento exato foi indevidamente modificado.';
  end if;

  -- T19c (CA03: informação insuficiente): sem auditoria ou com auditoria incompleta, exclusão física é contida no servidor (23503 com mensagem de ausência de comprovação)
  q := format('select to_jsonb(r) from public.create_standard_activity(%L, %L, %L, %s) r',
    pg_temp.eta_id(2013), pg_temp.eta_id(100), 'Atividade Sem Trilha', 15);
  result := pg_temp.eta_as(1, q);
  insufficient_act_id := (result->>'id')::uuid;

  delete from app_private.audit_entries
  where church_id = pg_temp.eta_id(100) and target_type = 'standard_activity' and target_id = insufficient_act_id;

  perform pg_temp.eta_as(1, format('select to_jsonb(r) from public.delete_standard_activity(%L, %L, %L) r',
    pg_temp.eta_id(2014), pg_temp.eta_id(100), insufficient_act_id), '23503', 'Não é possível comprovar ausência de uso histórico');

  if not exists (
    select 1 from app_private.standard_activities
    where id = insufficient_act_id and church_id = pg_temp.eta_id(100)
  ) then
    raise exception 'T19c: Atividade com informação insuficiente deveria permanecer sob contenção.';
  end if;

  -- T19d (CA03: referências estáveis disponíveis): referência em service_template_activities bloqueia exclusão (23503)
  if to_regclass('app_private.service_template_activities') is not null and to_regclass('app_private.service_templates') is not null then
    q := format('select to_jsonb(r) from public.create_standard_activity(%L, %L, %L, %s) r',
      pg_temp.eta_id(2015), pg_temp.eta_id(100), 'Atividade Vinculada a Modelo', 20);
    result := pg_temp.eta_as(1, q);
    template_act_id := (result->>'id')::uuid;

    insert into app_private.service_templates (id, church_id, name)
    values (pg_temp.eta_id(999), pg_temp.eta_id(100), 'Modelo Para Atividades')
    on conflict do nothing;

    insert into app_private.service_template_activities (church_id, template_id, standard_activity_id, title, planned_duration_minutes, display_order)
    values (pg_temp.eta_id(100), pg_temp.eta_id(999), template_act_id, 'Atividade Vinculada a Modelo', 20, 1);

    perform pg_temp.eta_as(1, format('select to_jsonb(r) from public.delete_standard_activity(%L, %L, %L) r',
      pg_temp.eta_id(2016), pg_temp.eta_id(100), template_act_id), '23503', 'já foi utilizada em cultos históricos');

    if not exists (
      select 1 from app_private.standard_activities
      where id = template_act_id and church_id = pg_temp.eta_id(100)
    ) then
      raise exception 'T19d: Atividade vinculada a modelo deveria permanecer cadastrada.';
    end if;
  else
    raise notice 'T19d: Cenário condicional de modelos 022 NÃO EXECUTADO (service_template_activities ausente).';
  end if;

  -- T19e (CA03: isolamento por igreja e autorização):
  -- Membro comum não exclui (42501)
  perform pg_temp.eta_as(2, format('select to_jsonb(r) from public.delete_standard_activity(%L, %L, %L) r',
    pg_temp.eta_id(2017), pg_temp.eta_id(100), in_use_act_id), '42501');

  -- Admin da Igreja 200 não exclui atividade da Igreja 100 (42501)
  perform pg_temp.eta_as(3, format('select to_jsonb(r) from public.delete_standard_activity(%L, %L, %L) r',
    pg_temp.eta_id(2018), pg_temp.eta_id(100), in_use_act_id), '42501');

  -- Tentativa com identificador inexistente na igreja retorna P0002
  perform pg_temp.eta_as(1, format('select to_jsonb(r) from public.delete_standard_activity(%L, %L, %L) r',
    pg_temp.eta_id(2021), pg_temp.eta_id(100), pg_temp.eta_id(9999)), 'P0002');

  -- Atividade livre na Igreja 200 é contida sob as mesmas regras do servidor e permanece intacta
  q := format('select to_jsonb(r) from public.create_standard_activity(%L, %L, %L, %s) r',
    pg_temp.eta_id(2019), pg_temp.eta_id(200), 'Ministração da Palavra', 45);
  result := pg_temp.eta_as(3, q);
  other_church_act_id := (result->>'id')::uuid;

  perform pg_temp.eta_as(3, format('select to_jsonb(r) from public.delete_standard_activity(%L, %L, %L) r',
    pg_temp.eta_id(2020), pg_temp.eta_id(200), other_church_act_id), '23503', 'Não é possível comprovar ausência de uso histórico');

  if not exists (
    select 1 from app_private.standard_activities
    where id = other_church_act_id and church_id = pg_temp.eta_id(200)
  ) then
    raise exception 'T19e: Atividade da Igreja 200 deveria permanecer cadastrada sob contenção.';
  end if;

  -- T19f (CA03: tratamento estrito de recibos e replays para delete_standard_activity):
  -- 1. Reutilização de command_id de outra operação (criação T13/2004) em exclusão é rejeitada com 23505
  perform pg_temp.eta_as(1, format('select to_jsonb(r) from public.delete_standard_activity(%L, %L, %L) r',
    pg_temp.eta_id(2004), pg_temp.eta_id(100), created_act_id), '23505', 'Conflito de command_id');

  -- 2. Autorização sobre recibo próprio (Correção 1):
  -- Prepara recibo correspondente ao próprio usuário 2 (sem autorização administrativa vigente),
  -- demonstrando coincidência de user_id (2), command_id (2031), igreja (100), ação ('delete_standard_activity')
  -- e alvo (created_act_id). A condição impeditiva é exclusivamente a falta de autorização atual (42501).
  insert into app_private.event_type_activity_receipts (
    user_id, command_id, church_id, action, params, result
  ) values (
    pg_temp.eta_id(2), pg_temp.eta_id(2031), pg_temp.eta_id(100),
    'delete_standard_activity', jsonb_build_object('activity_id', created_act_id),
    jsonb_build_object('status', 'ok', 'id', created_act_id, 'deleted', true)
  );

  perform pg_temp.eta_as(2, format('select to_jsonb(r) from public.delete_standard_activity(%L, %L, %L) r',
    pg_temp.eta_id(2031), pg_temp.eta_id(100), created_act_id), '42501', 'Permissão insuficiente');

  -- 3. Replay com alvo ausente pelo administrador autorizado (Correção 2):
  -- Prepara recibo histórico simulado para um UUID comprovadamente inexistente na tabela standard_activities.
  -- Confere explicitamente a ausência sem efetuar exclusão física ou depender de apagar cadastro real.
  if exists (
    select 1 from app_private.standard_activities
    where id = pg_temp.eta_id(9200)
  ) then
    raise exception 'T19f: Alvo para ensaio de inexistência não deveria constar em standard_activities.';
  end if;

  insert into app_private.event_type_activity_receipts (
    user_id, command_id, church_id, action, params, result
  ) values (
    pg_temp.eta_id(1), pg_temp.eta_id(2032), pg_temp.eta_id(100),
    'delete_standard_activity', jsonb_build_object('activity_id', pg_temp.eta_id(9200)),
    jsonb_build_object('status', 'ok', 'id', pg_temp.eta_id(9200), 'deleted', true)
  );

  q := format('select to_jsonb(r) from public.delete_standard_activity(%L, %L, %L) r',
    pg_temp.eta_id(2032), pg_temp.eta_id(100), pg_temp.eta_id(9200));
  result := pg_temp.eta_as(1, q);
  if (result->>'deleted')::boolean is not true or (result->>'id')::uuid is distinct from pg_temp.eta_id(9200) then
    raise exception 'T19f: Replay com alvo ausente deveria retornar sucesso coerente do recibo: %', result;
  end if;

  if exists (
    select 1 from app_private.standard_activities
    where id = pg_temp.eta_id(9200)
  ) then
    raise exception 'T19f: Replay de alvo ausente não deve reinserir registro físico na tabela.';
  end if;

  -- 4. Simula recibo de exclusão legítima prévia do admin para created_act_id
  insert into app_private.event_type_activity_receipts (
    user_id, command_id, church_id, action, params, result
  ) values (
    pg_temp.eta_id(1), pg_temp.eta_id(2030), pg_temp.eta_id(100),
    'delete_standard_activity', jsonb_build_object('activity_id', created_act_id),
    jsonb_build_object('status', 'ok', 'id', created_act_id, 'deleted', true)
  );

  -- 5. Replay legítimo pelo Admin autorizado retorna o resultado da exclusão previamente concluída
  q := format('select to_jsonb(r) from public.delete_standard_activity(%L, %L, %L) r',
    pg_temp.eta_id(2030), pg_temp.eta_id(100), created_act_id);
  result := pg_temp.eta_as(1, q);
  if (result->>'deleted')::boolean is not true then
    raise exception 'T19f: Replay legítimo de exclusão deveria retornar deleted=true.';
  end if;

  -- 6. Replay com target_id divergente é rejeitado com 23505
  perform pg_temp.eta_as(1, format('select to_jsonb(r) from public.delete_standard_activity(%L, %L, %L) r',
    pg_temp.eta_id(2030), pg_temp.eta_id(100), in_use_act_id), '23505', 'Conflito de command_id');

  -- T20: Listagens de apenas ativos filtram inativos
  q := format('select jsonb_agg(to_jsonb(r)) from public.list_standard_activities(%L, true) r', pg_temp.eta_id(100));
  result := pg_temp.eta_as(1, q);
  if jsonb_array_length(result) < 1 then
    raise exception 'T20: Listagem de atividades ativas deveria retornar registros.';
  end if;

end $cases$;
