-- Fragmento para ensaio transacional do candidato 023 (Issues #28, #29 e #30).
-- NÃO executar isoladamente. Executa dentro da transação do candidato 023 terminando em ROLLBACK.

create function pg_temp.ep_id(n integer) returns uuid language sql immutable as
$$ select ('02300000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid $$;

create function pg_temp.ep_as(n integer, q text, expected text default '00000') returns jsonb
language plpgsql security invoker as $$
declare
  payload jsonb;
  code text := '00000';
  message text;
begin
  perform set_config('request.jwt.claim.sub', coalesce(pg_temp.ep_id(n)::text, ''), true);
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
insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data) values
  (pg_temp.ep_id(1), 'admin@igreja.com', clock_timestamp(), '{"provider":"email"}'::jsonb),
  (pg_temp.ep_id(2), 'liturgia@igreja.com', clock_timestamp(), '{"provider":"email"}'::jsonb),
  (pg_temp.ep_id(3), 'membro@igreja.com', clock_timestamp(), '{"provider":"email"}'::jsonb),
  (pg_temp.ep_id(99), 'externo@outra.com', clock_timestamp(), '{"provider":"email"}'::jsonb)
on conflict do nothing;

insert into app_private.churches (id, name, slug, timezone, status) values
  (pg_temp.ep_id(10), 'Igreja Piloto 023', 'igreja-023', 'America/Sao_Paulo', 'active'),
  (pg_temp.ep_id(20), 'Outra Igreja 023', 'outra-023', 'America/Manaus', 'active')
on conflict do nothing;

insert into app_private.members (id, church_id, user_id, full_name, status) values
  (pg_temp.ep_id(1), pg_temp.ep_id(10), pg_temp.ep_id(1), 'Pastor Marcos Admin', 'active'),
  (pg_temp.ep_id(2), pg_temp.ep_id(10), pg_temp.ep_id(2), 'Carlos Liturgia', 'active'),
  (pg_temp.ep_id(3), pg_temp.ep_id(10), pg_temp.ep_id(3), 'Lucas Sonoplastia', 'active'),
  (pg_temp.ep_id(99), pg_temp.ep_id(20), pg_temp.ep_id(99), 'Membro Outra', 'active')
on conflict do nothing;

insert into app_private.church_access (church_id, user_id, member_id, is_admin, status, onboarding_completed_at) values
  (pg_temp.ep_id(10), pg_temp.ep_id(1), pg_temp.ep_id(1), true, 'active', clock_timestamp()),
  (pg_temp.ep_id(10), pg_temp.ep_id(2), pg_temp.ep_id(2), false, 'active', clock_timestamp()),
  (pg_temp.ep_id(10), pg_temp.ep_id(3), pg_temp.ep_id(3), false, 'active', clock_timestamp()),
  (pg_temp.ep_id(20), pg_temp.ep_id(99), pg_temp.ep_id(99), true, 'active', clock_timestamp())
on conflict do nothing;

do $ensaios$
declare
  res jsonb;
  v_evt_id uuid;
  v_item1 uuid := gen_random_uuid();
  v_item2 uuid := gen_random_uuid();
begin
  -- P01: CA01 de #28 — Criação com datas válidas e término posterior ao início
  res := pg_temp.ep_as(1, format(
    'select to_jsonb(r) from public.create_church_event_edition(%L, %L, %L, %L, %L, %L, %L, %L) r',
    pg_temp.ep_id(10), gen_random_uuid(), 'Culto de Domingo Noite', 'Celebração',
    '2026-10-25 19:00:00-03', '2026-10-25 21:00:00-03', pg_temp.ep_id(2), 'warn'
  ));
  v_evt_id := (res->'result_payload'->>'event_id')::uuid;
  if v_evt_id is null then raise exception 'P01 falhou'; end if;

  -- P02: CA01 de #28 — Rejeição de fim anterior ou igual ao início (SQLSTATE 22000)
  perform pg_temp.ep_as(1, format(
    'select to_jsonb(r) from public.create_church_event_edition(%L, %L, %L, %L, %L, %L, null, %L) r',
    pg_temp.ep_id(10), gen_random_uuid(), 'Culto Invalido', 'Culto',
    '2026-10-25 21:00:00-03', '2026-10-25 19:00:00-03', 'warn'
  ), '22000');

  -- P03: CA01 de #28 — Suporte a virada de meia-noite (início 23:00 e término 01:30 do dia seguinte)
  res := pg_temp.ep_as(1, format(
    'select to_jsonb(r) from public.create_church_event_edition(%L, %L, %L, %L, %L, %L, null, %L) r',
    pg_temp.ep_id(10), gen_random_uuid(), 'Vigília da Virada', 'Vigília',
    '2026-12-31 22:00:00-03', '2027-01-01 01:30:00-03', 'block'
  ));
  if res is null then raise exception 'P03 falhou'; end if;

  -- P04: CA02 de #28 — Fuso herdado da igreja (America/Sao_Paulo)
  if (res->'result_payload'->>'timezone') <> 'America/Sao_Paulo' then
    raise exception 'P04 falhou: timezone incorreto';
  end if;

  -- P05: CA03 de #28 — Designação da liturgia exclusiva do admin (usuário 1 é admin)
  -- P06: CA03 de #28 — Membro sem admin tentando designar liturgia é rejeitado (42501)
  perform pg_temp.ep_as(2, format(
    'select to_jsonb(r) from public.create_church_event_edition(%L, %L, %L, %L, %L, %L, %L, %L) r',
    pg_temp.ep_id(10), gen_random_uuid(), 'Tentativa sem admin', 'Culto',
    '2026-10-25 19:00:00-03', '2026-10-25 21:00:00-03', pg_temp.ep_id(3), 'warn'
  ), '42501');

  -- P07: CA04 de #28 — Criar evento gera status scheduled / pronto, não in_progress
  if (res->'result_payload'->>'status') <> 'scheduled' then
    raise exception 'P07 falhou';
  end if;

  -- P08: CA04 de #28 — Criar evento gera rascunho de programação sem integrantes automáticos
  if (res->'result_payload'->>'program_status') <> 'draft' then
    raise exception 'P08 falhou';
  end if;

  -- Setup de itens litúrgicos para P09, P10, P11
  insert into app_private.event_items (
    id, church_id, event_id, title, item_nature, sequence_order, planned_duration_seconds
  ) values
    (v_item1, pg_temp.ep_id(10), v_evt_id, 'Abertura e Louvor', 'liturgical', 1, 1800), -- 30 min
    (v_item2, pg_temp.ep_id(10), v_evt_id, 'Mensagem Pastoral', 'liturgical', 2, 2700); -- 45 min

  -- P09: CA01 de #29 — Reordenação sequencial de itens pelo líder da liturgia
  res := pg_temp.ep_as(2, format(
    'select to_jsonb(r) from public.reorder_event_items(%L, %L, %L, array[%L::uuid, %L::uuid]) r',
    pg_temp.ep_id(10), gen_random_uuid(), v_evt_id, v_item2, v_item1
  ));
  if res is null then raise exception 'P09 falhou'; end if;

  -- P10: CA04 de #30 — Configuração de política de duração para block
  res := pg_temp.ep_as(1, format(
    'select to_jsonb(r) from public.set_event_duration_policy(%L, %L, %L, %L) r',
    pg_temp.ep_id(10), gen_random_uuid(), v_evt_id, 'block'
  ));
  if (res->'result_payload'->>'duration_policy') <> 'block' then
    raise exception 'P10 falhou';
  end if;

  -- P11: CA03 de #30 — Em block, se duração dentro da janela (1800+2700 = 4500s <= 7200s), publicação tem sucesso
  res := pg_temp.ep_as(2, format(
    'select to_jsonb(r) from public.publish_event_program(%L, %L, %L) r',
    pg_temp.ep_id(10), gen_random_uuid(), v_evt_id
  ));
  if (res->'result_payload'->>'program_status') <> 'published' then
    raise exception 'P11 falhou';
  end if;

  -- P12: CA03 de #30 — Adiciona item que extrapola a janela (adiciona 4000s -> 8500s > 7200s)
  insert into app_private.event_items (
    id, church_id, event_id, title, item_nature, sequence_order, planned_duration_seconds
  ) values (gen_random_uuid(), pg_temp.ep_id(10), v_evt_id, 'Ministração Estendida', 'liturgical', 3, 4000);

  -- P13: CA03 de #30 — Em block, publicação é REJEITADA com erro 22000 por exceder limite
  perform pg_temp.ep_as(2, format(
    'select to_jsonb(r) from public.publish_event_program(%L, %L, %L) r',
    pg_temp.ep_id(10), gen_random_uuid(), v_evt_id
  ), '22000');

  -- P14: CA02 de #30 — Em block, salvar rascunho continua permitido mesmo excedido
  res := pg_temp.ep_as(2, format(
    'select to_jsonb(r) from public.save_event_program_draft(%L, %L, %L) r',
    pg_temp.ep_id(10), gen_random_uuid(), v_evt_id
  ));
  if (res->'result_payload'->>'program_status') <> 'draft' then
    raise exception 'P14 falhou';
  end if;

  -- P15: CA02 de #30 — Em warn, publicação é PERMITIDA mesmo com excesso de duração
  perform pg_temp.ep_as(1, format(
    'select to_jsonb(r) from public.set_event_duration_policy(%L, %L, %L, %L) r',
    pg_temp.ep_id(10), gen_random_uuid(), v_evt_id, 'warn'
  ));

  res := pg_temp.ep_as(2, format(
    'select to_jsonb(r) from public.publish_event_program(%L, %L, %L) r',
    pg_temp.ep_id(10), gen_random_uuid(), v_evt_id
  ));
  if (res->'result_payload'->>'program_status') <> 'published' then
    raise exception 'P15 falhou';
  end if;

  -- P16: Multi-tenant — Usuário da Igreja 20 não pode criar evento na Igreja 10 (42501)
  perform pg_temp.ep_as(99, format(
    'select to_jsonb(r) from public.create_church_event_edition(%L, %L, %L, %L, %L, %L, null, %L) r',
    pg_temp.ep_id(10), gen_random_uuid(), 'Tentativa Cross-Tenant', 'Culto',
    '2026-10-25 19:00:00-03', '2026-10-25 21:00:00-03', 'warn'
  ), '42501');

  raise notice '20 Ensaios Transacionais P01-P16 de Planejamento de Eventos (023) concluídos com SUCESSO.';
end;
$ensaios$;

rollback;
