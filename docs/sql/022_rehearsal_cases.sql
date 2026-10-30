-- Fragmento para ensaio transacional do candidato 022 (Issue #27).
-- NÃO executar isoladamente. Executa dentro da transação do candidato 022 terminando em ROLLBACK.

create function pg_temp.st_id(n integer) returns uuid language sql immutable as
$$ select ('02200000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid $$;

create function pg_temp.st_as(
  n integer,
  q text,
  expected text default '00000',
  expected_msg text default null
) returns jsonb
language plpgsql security invoker as $$
declare
  payload jsonb;
  code text := '00000';
  message text := '';
begin
  perform set_config('request.jwt.claim.sub', coalesce(pg_temp.st_id(n)::text, ''), true);
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
  if expected_msg is not null and position(lower(expected_msg) in lower(coalesce(message, ''))) = 0 then
    raise exception 'Mensagem esperada contendo "%" não encontrada em "%"', expected_msg, message;
  end if;
  return payload;
end $$;

-- Fixtures de teste
insert into auth.users(id, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select pg_temp.st_id(n), 'st022_' || n || '@example.com', clock_timestamp(), '{"provider":"email"}'::jsonb,
  '{}'::jsonb, clock_timestamp(), clock_timestamp() from generate_series(1, 4) n;

insert into app_private.churches(id, name, timezone, default_duration_policy) values
  (pg_temp.st_id(100), 'Igreja Central 022', 'America/Sao_Paulo', 'warn'),
  (pg_temp.st_id(200), 'Igreja Bairro 022', 'America/Sao_Paulo', 'warn');

insert into app_private.members(id, church_id, display_name, created_by_user_id) values
  (pg_temp.st_id(11), pg_temp.st_id(100), 'Admin Igreja 100', pg_temp.st_id(1)),
  (pg_temp.st_id(12), pg_temp.st_id(100), 'Membro Igreja 100', pg_temp.st_id(1)),
  (pg_temp.st_id(13), pg_temp.st_id(200), 'Admin Igreja 200', pg_temp.st_id(3));

insert into app_private.church_access(church_id, user_id, member_id, is_admin, onboarding_completed_at, granted_by_user_id) values
  (pg_temp.st_id(100), pg_temp.st_id(1), pg_temp.st_id(11), true, clock_timestamp(), pg_temp.st_id(1)),
  (pg_temp.st_id(100), pg_temp.st_id(2), pg_temp.st_id(12), false, clock_timestamp(), pg_temp.st_id(1)),
  (pg_temp.st_id(200), pg_temp.st_id(3), pg_temp.st_id(13), true, clock_timestamp(), pg_temp.st_id(3));

-- Tipo de Evento base
insert into app_private.event_types(id, church_id, name, active) values
  (pg_temp.st_id(50), pg_temp.st_id(100), 'Celebração Dominical', true);

do $cases$
declare
  result jsonb;
  q text;
  created_template_id uuid;
  in_use_template_id uuid;
  instantiated jsonb;
begin
  -- S01: Membro não-administrador tentando cadastrar modelo é rejeitado com 42501 (CA01)
  q := format('select public.create_service_template(%L, %L, %L, %L, %L, %L::jsonb, %L::jsonb)',
    pg_temp.st_id(901), pg_temp.st_id(100), pg_temp.st_id(50), 'Modelo Não Autorizado', 'Desc', '[]', '[]');
  perform pg_temp.st_as(2, q, '42501');

  -- S02: Usuário não autenticado é rejeitado com 28000
  q := format('select public.create_service_template(%L, %L, %L, %L, %L, %L::jsonb, %L::jsonb)',
    pg_temp.st_id(902), pg_temp.st_id(100), pg_temp.st_id(50), 'Modelo Anônimo', 'Desc', '[]', '[]');
  perform pg_temp.st_as(null, q, '28000');

  -- S03: Admin de Igreja 100 cadastra modelo com atividades e apoios (portaria e transmissão) (CA01)
  q := format('select public.create_service_template(%L, %L, %L, %L, %L, %L::jsonb, %L::jsonb)',
    pg_temp.st_id(903), pg_temp.st_id(100), pg_temp.st_id(50), 'Culto de Domingo Completo', 'Modelo com louvor, palavra e apoios',
    '[{"title":"Boas-Vindas","category":"Liturgia","planned_duration_minutes":5,"display_order":1},{"title":"Louvor Congregacional","category":"Louvor","planned_duration_minutes":25,"display_order":2}]',
    '[{"team_id":"recepcao","service_name":"Portaria e Recepção","prep_required_minutes":15,"is_default_active":true,"display_order":1},{"team_id":"midia","service_name":"Transmissão ao Vivo","prep_required_minutes":20,"is_default_active":true,"display_order":2}]'
  );
  result := pg_temp.st_as(1, q, '00000');
  if (result->>'success')::boolean is not true then
    raise exception 'S03 falhou: %', result;
  end if;
  created_template_id := (result->>'template_id')::uuid;

  -- S04: Idempotência de comando: reenvio com mesmo command_id retorna mesmo resultado
  result := pg_temp.st_as(1, q, '00000');
  if (result->>'template_id')::uuid <> created_template_id then
    raise exception 'S04 idempotência falhou';
  end if;

  -- S05: Nome duplicado na mesma igreja é rejeitado com 23505
  q := format('select public.create_service_template(%L, %L, %L, %L, %L, %L::jsonb, %L::jsonb)',
    pg_temp.st_id(905), pg_temp.st_id(100), pg_temp.st_id(50), 'culto de domingo completo', 'Desc', '[]', '[]');
  perform pg_temp.st_as(1, q, '23505');

  -- S06: Mesmo nome em outra igreja (Igreja 200) é permitido (multi-tenant)
  q := format('select public.create_service_template(%L, %L, null, %L, %L, %L::jsonb, %L::jsonb)',
    pg_temp.st_id(906), pg_temp.st_id(200), 'Culto de Domingo Completo', 'Outra igreja', '[]', '[]');
  result := pg_temp.st_as(3, q, '00000');
  if (result->>'success')::boolean is not true then
    raise exception 'S06 multi-tenant falhou';
  end if;

  -- S07: Admin atualiza modelo com sucesso
  q := format('select public.update_service_template(%L, %L, %L, %L, %L, %L::jsonb, %L::jsonb)',
    pg_temp.st_id(907), created_template_id, pg_temp.st_id(50), 'Culto Dominical Renovado', 'Descrição atualizada',
    '[{"title":"Abertura","category":"Liturgia","planned_duration_minutes":10,"display_order":1}]',
    '[{"team_id":"recepcao","service_name":"Portaria","prep_required_minutes":10,"is_default_active":true,"display_order":1}]'
  );
  result := pg_temp.st_as(1, q, '00000');
  if (result->>'success')::boolean is not true then
    raise exception 'S07 update falhou';
  end if;

  -- S08: Admin desativa modelo (active = false)
  q := format('select public.toggle_service_template_status(%L, %L, false)',
    pg_temp.st_id(908), created_template_id);
  result := pg_temp.st_as(1, q, '00000');
  if (result->>'active')::boolean is not false then
    raise exception 'S08 toggle deactivation falhou';
  end if;

  -- S08b: Modelo desativado (active = false) NÃO pode ser instanciado para novos planejamentos (CA04)
  q := format('select public.instantiate_service_template(%L, %L, %L)',
    pg_temp.st_id(9081), pg_temp.st_id(100), created_template_id);
  perform pg_temp.st_as(1, q, '23514', 'desativado');

  -- S09: Admin reativa modelo (active = true)
  q := format('select public.toggle_service_template_status(%L, %L, true)',
    pg_temp.st_id(909), created_template_id);
  result := pg_temp.st_as(1, q, '00000');
  if (result->>'active')::boolean is not true then
    raise exception 'S09 toggle reactivation falhou';
  end if;

  -- S10: Instanciação do modelo para evento (CA02, CA03)
  q := format('select public.instantiate_service_template(%L, %L, %L)',
    pg_temp.st_id(910), pg_temp.st_id(100), created_template_id);
  instantiated := pg_temp.st_as(1, q, '00000');
  if (instantiated->>'success')::boolean is not true then
    raise exception 'S10 instantiate falhou: %', instantiated;
  end if;

  -- S11: Verifica que atividades instanciadas NÃO possuem escala de pessoas nem responsáveis (CA03)
  if jsonb_array_length(instantiated->'activities') > 0 then
    if (instantiated->'activities'->0->>'responsibleMemberId') is not null then
      raise exception 'S11 violou CA03: responsibleMemberId veio preenchido';
    end if;
    if jsonb_array_length(instantiated->'activities'->0->'roster') <> 0 then
      raise exception 'S11 violou CA03: roster não veio vazio';
    end if;
  end if;

  -- S12: Verifica que apoios paralelos NÃO possuem voluntários nem líderes (CA03)
  if jsonb_array_length(instantiated->'parallelServices') > 0 then
    if (instantiated->'parallelServices'->0->>'leaderId') is not null then
      raise exception 'S12 violou CA03: leaderId veio preenchido';
    end if;
    if jsonb_array_length(instantiated->'parallelServices'->0->'volunteers') <> 0 then
      raise exception 'S12 violou CA03: volunteers não veio vazio';
    end if;
  end if;

  -- S13: Exclusão com proteção histórica se em uso (CA04), inclusive após renomeação do modelo
  q := format('select public.create_service_template(%L, %L, %L, %L, %L, %L::jsonb, %L::jsonb)',
    pg_temp.st_id(913), pg_temp.st_id(100), pg_temp.st_id(50), 'Modelo Em Uso Histórico', 'Desc', '[]', '[]');
  result := pg_temp.st_as(1, q, '00000');
  in_use_template_id := (result->>'template_id')::uuid;

  if to_regclass('app_private.events') is not null then
    insert into app_private.events(id, church_id, title, event_type, timezone, planned_start_at, planned_end_at) values
      (pg_temp.st_id(880), pg_temp.st_id(100), 'Modelo Em Uso Histórico', 'Celebração', 'America/Sao_Paulo',
       now() - interval '1 day', now() - interval '1 day' + interval '2 hours');

    q := format('select public.delete_service_template(%L, %L)', pg_temp.st_id(914), in_use_template_id);
    perform pg_temp.st_as(1, q, '23503', 'já foi utilizado');

    -- S13b: Renomear o modelo NÃO libera exclusão física: a RPC recusa com 23503 e preserva o modelo (CA04)
    q := format('select public.update_service_template(%L, %L, %L, %L, %L, %L::jsonb, %L::jsonb)',
      pg_temp.st_id(9141), in_use_template_id, pg_temp.st_id(50), 'Modelo Em Uso Renomeado', 'Desc', '[]', '[]');
    perform pg_temp.st_as(1, q, '00000');

    q := format('select public.delete_service_template(%L, %L)', pg_temp.st_id(9142), in_use_template_id);
    perform pg_temp.st_as(1, q, '23503');

    if not exists (select 1 from app_private.service_templates where id = in_use_template_id) then
      raise exception 'S13b falhou: modelo renomeado foi excluído fisicamente';
    end if;
  end if;

  -- S14: Contenção explícita no servidor quando não há prova global de desuso (CA04)
  q := format('select public.delete_service_template(%L, %L)', pg_temp.st_id(915), created_template_id);
  perform pg_temp.st_as(1, q, '23503', 'Não é possível comprovar ausência de uso histórico');

  if not exists (select 1 from app_private.service_templates where id = created_template_id) then
    raise exception 'S14 falhou: modelo foi excluído fisicamente apesar da contenção server-side';
  end if;

  -- S14b: Matriz de autorização e compatibilidade estrita de replay em delete_service_template
  -- 1. Membro não-admin (2) e Admin de outra igreja (3) são barrados com 42501
  q := format('select public.delete_service_template(%L, %L)', pg_temp.st_id(9151), created_template_id);
  perform pg_temp.st_as(2, q, '42501');
  perform pg_temp.st_as(3, q, '42501');

  -- 2. Reuso de command_id de create_service_template (903) deve lançar 23505 (e não retornar falso sucesso)
  q := format('select public.delete_service_template(%L, %L)', pg_temp.st_id(903), created_template_id);
  perform pg_temp.st_as(1, q, '23505', 'Conflito de command_id');

  -- 3. Recibos malformados, incompletos ou divergentes devem todos resultar em 23505 (sem escapar com 22P02):
  -- 3a. result.template_id ausente
  insert into app_private.service_template_receipts (user_id, command_id, church_id, action, params, result)
  values (
    pg_temp.st_id(1), pg_temp.st_id(9201), pg_temp.st_id(100), 'delete_service_template',
    jsonb_build_object('template_id', created_template_id),
    jsonb_build_object('success', true, 'deleted', true)
  );
  q := format('select public.delete_service_template(%L, %L)', pg_temp.st_id(9201), created_template_id);
  perform pg_temp.st_as(1, q, '23505', 'Conflito de command_id');

  -- 3b. result.template_id nulo
  insert into app_private.service_template_receipts (user_id, command_id, church_id, action, params, result)
  values (
    pg_temp.st_id(1), pg_temp.st_id(9202), pg_temp.st_id(100), 'delete_service_template',
    jsonb_build_object('template_id', created_template_id),
    jsonb_build_object('success', true, 'deleted', true, 'template_id', null)
  );
  q := format('select public.delete_service_template(%L, %L)', pg_temp.st_id(9202), created_template_id);
  perform pg_temp.st_as(1, q, '23505', 'Conflito de command_id');

  -- 3c. result.template_id inválido (não-UUID)
  insert into app_private.service_template_receipts (user_id, command_id, church_id, action, params, result)
  values (
    pg_temp.st_id(1), pg_temp.st_id(9203), pg_temp.st_id(100), 'delete_service_template',
    jsonb_build_object('template_id', created_template_id),
    jsonb_build_object('success', true, 'deleted', true, 'template_id', 'id-malformado')
  );
  q := format('select public.delete_service_template(%L, %L)', pg_temp.st_id(9203), created_template_id);
  perform pg_temp.st_as(1, q, '23505', 'Conflito de command_id');

  -- 3d. result.template_id divergente (aponta para outro modelo)
  insert into app_private.service_template_receipts (user_id, command_id, church_id, action, params, result)
  values (
    pg_temp.st_id(1), pg_temp.st_id(9204), pg_temp.st_id(100), 'delete_service_template',
    jsonb_build_object('template_id', created_template_id),
    jsonb_build_object('success', true, 'deleted', true, 'template_id', in_use_template_id)
  );
  q := format('select public.delete_service_template(%L, %L)', pg_temp.st_id(9204), created_template_id);
  perform pg_temp.st_as(1, q, '23505', 'Conflito de command_id');

  -- 3e. params incompatíveis / tipos inválidos (não-UUID em params.template_id ou params array)
  insert into app_private.service_template_receipts (user_id, command_id, church_id, action, params, result)
  values (
    pg_temp.st_id(1), pg_temp.st_id(9205), pg_temp.st_id(100), 'delete_service_template',
    jsonb_build_object('template_id', 'nao-uuid'),
    jsonb_build_object('success', true, 'deleted', true, 'template_id', created_template_id)
  );
  q := format('select public.delete_service_template(%L, %L)', pg_temp.st_id(9205), created_template_id);
  perform pg_temp.st_as(1, q, '23505', 'Conflito de command_id');

  insert into app_private.service_template_receipts (user_id, command_id, church_id, action, params, result)
  values (
    pg_temp.st_id(1), pg_temp.st_id(9206), pg_temp.st_id(100), 'delete_service_template',
    '[]'::jsonb,
    jsonb_build_object('success', true, 'deleted', true, 'template_id', created_template_id)
  );
  q := format('select public.delete_service_template(%L, %L)', pg_temp.st_id(9206), created_template_id);
  perform pg_temp.st_as(1, q, '23505', 'Conflito de command_id');

  -- 3f. Booleanos representados como strings ("true") em success ou deleted
  insert into app_private.service_template_receipts (user_id, command_id, church_id, action, params, result)
  values (
    pg_temp.st_id(1), pg_temp.st_id(9207), pg_temp.st_id(100), 'delete_service_template',
    jsonb_build_object('template_id', created_template_id),
    jsonb_build_object('success', 'true', 'deleted', true, 'template_id', created_template_id)
  );
  q := format('select public.delete_service_template(%L, %L)', pg_temp.st_id(9207), created_template_id);
  perform pg_temp.st_as(1, q, '23505', 'Conflito de command_id');

  insert into app_private.service_template_receipts (user_id, command_id, church_id, action, params, result)
  values (
    pg_temp.st_id(1), pg_temp.st_id(9208), pg_temp.st_id(100), 'delete_service_template',
    jsonb_build_object('template_id', created_template_id),
    jsonb_build_object('success', true, 'deleted', 'true', 'template_id', created_template_id)
  );
  q := format('select public.delete_service_template(%L, %L)', pg_temp.st_id(9208), created_template_id);
  perform pg_temp.st_as(1, q, '23505', 'Conflito de command_id');

  -- 4. Replay histórico legítimo com alvo já ausente (modelo 899 já removido anteriormente)
  insert into app_private.service_template_receipts (user_id, command_id, church_id, action, params, result)
  values (
    pg_temp.st_id(1), pg_temp.st_id(9209), pg_temp.st_id(100), 'delete_service_template',
    jsonb_build_object('template_id', pg_temp.st_id(899)),
    jsonb_build_object('success', true, 'deleted', true, 'template_id', pg_temp.st_id(899))
  );
  q := format('select public.delete_service_template(%L, %L)', pg_temp.st_id(9209), pg_temp.st_id(899));
  result := pg_temp.st_as(1, q, '00000');
  if result is null
     or jsonb_typeof(result) is distinct from 'object'
     or jsonb_typeof(result->'success') is distinct from 'boolean'
     or jsonb_typeof(result->'deleted') is distinct from 'boolean'
     or jsonb_typeof(result->'template_id') is distinct from 'string'
     or result is distinct from jsonb_build_object('success', true, 'deleted', true, 'template_id', pg_temp.st_id(899)) then
    raise exception 'S14b replay histórico legítimo falhou: %', result;
  end if;

  -- 5. Autorização administrativa revogada bloqueia replay mesmo com recibo histórico íntegro (42501)
  -- Prepara o usuário 2 (membro ativo com onboarding concluído na igreja 100) como administrador elegível
  -- antes de revogar o usuário 1, respeitando o gatilho protect_last_active_admin.
  update app_private.church_access set is_admin = true
  where church_id = pg_temp.st_id(100) and user_id = pg_temp.st_id(2);
  update app_private.church_access set is_admin = false
  where church_id = pg_temp.st_id(100) and user_id = pg_temp.st_id(1);
  perform pg_temp.st_as(1, q, '42501');
  -- Restaura os papéis originais mantendo pelo menos um administrador elegível em cada etapa
  update app_private.church_access set is_admin = true
  where church_id = pg_temp.st_id(100) and user_id = pg_temp.st_id(1);
  update app_private.church_access set is_admin = false
  where church_id = pg_temp.st_id(100) and user_id = pg_temp.st_id(2);

  -- S15: Exclusão de template inexistente retorna P0002
  q := format('select public.delete_service_template(%L, %L)', pg_temp.st_id(916), pg_temp.st_id(999));
  perform pg_temp.st_as(1, q, 'P0002');
end;
$cases$;
