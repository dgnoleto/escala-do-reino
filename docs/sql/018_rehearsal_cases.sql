-- Fragmento para ensaio transacional do candidato 018 (Issue #23).
-- NÃO executar isoladamente. Executa dentro da transação do candidato 018 terminando em ROLLBACK.

create function pg_temp.admin_id(n integer) returns uuid language sql immutable as
$$ select ('01800000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid $$;

create function pg_temp.admin_as(n integer, q text, expected text default '00000') returns jsonb
language plpgsql security invoker as $$
declare
  payload jsonb;
  code text := '00000';
  message text;
begin
  perform set_config('request.jwt.claim.sub', coalesce(pg_temp.admin_id(n)::text, ''), true);
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
select pg_temp.admin_id(n), 'admin018_' || n || '@example.com', clock_timestamp(), '{"provider":"email"}'::jsonb,
  '{}'::jsonb, clock_timestamp(), clock_timestamp() from generate_series(1, 5) n;

insert into app_private.churches(id, name, timezone, default_duration_policy) values
  (pg_temp.admin_id(100), 'Igreja A 018', 'America/Sao_Paulo', 'warn'),
  (pg_temp.admin_id(200), 'Igreja B 018', 'America/Sao_Paulo', 'warn');

insert into app_private.members(id, church_id, display_name, created_by_user_id) values
  (pg_temp.admin_id(11), pg_temp.admin_id(100), 'Admin 1 Igreja A', pg_temp.admin_id(1)),
  (pg_temp.admin_id(12), pg_temp.admin_id(100), 'Membro Comum Igreja A', pg_temp.admin_id(1)),
  (pg_temp.admin_id(13), pg_temp.admin_id(100), 'Admin 2 Igreja A', pg_temp.admin_id(1)),
  (pg_temp.admin_id(14), pg_temp.admin_id(200), 'Admin 1 Igreja B', pg_temp.admin_id(4)),
  (pg_temp.admin_id(15), pg_temp.admin_id(100), 'Membro Multi Igreja A', pg_temp.admin_id(1));

insert into app_private.church_access(church_id, user_id, member_id, is_admin, onboarding_completed_at, granted_by_user_id) values
  -- User 1: Admin 1 da Igreja A
  (pg_temp.admin_id(100), pg_temp.admin_id(1), pg_temp.admin_id(11), true, clock_timestamp(), pg_temp.admin_id(1)),
  -- User 2: Membro comum da Igreja A (elegível para promoção)
  (pg_temp.admin_id(100), pg_temp.admin_id(2), pg_temp.admin_id(12), false, clock_timestamp(), pg_temp.admin_id(1)),
  -- User 3: Admin 2 da Igreja A
  (pg_temp.admin_id(100), pg_temp.admin_id(3), pg_temp.admin_id(13), true, clock_timestamp(), pg_temp.admin_id(1)),
  -- User 4: Admin na Igreja B (e membro comum na Igreja A - User 5 vinculado à Igreja B)
  (pg_temp.admin_id(200), pg_temp.admin_id(4), pg_temp.admin_id(14), true, clock_timestamp(), pg_temp.admin_id(4)),
  -- User 4 também é membro comum na Igreja A!
  (pg_temp.admin_id(100), pg_temp.admin_id(4), pg_temp.admin_id(15), false, clock_timestamp(), pg_temp.admin_id(1));

do $cases$
declare
  result jsonb;
  q text;
begin
  -- C01: Membro não-admin tentando executar comando é recusado (42501)
  perform pg_temp.admin_as(2, format('select to_jsonb(r) from public.manage_church_admin(%L, %L, %L, %L) r',
    pg_temp.admin_id(100), pg_temp.admin_id(11), 'revoke', pg_temp.admin_id(1002)), '42501');

  -- C02: Concessão com sucesso por admin ativo a membro elegível (CA01)
  q := format('select to_jsonb(r) from public.manage_church_admin(%L, %L, %L, %L) r',
    pg_temp.admin_id(100), pg_temp.admin_id(12), 'grant', pg_temp.admin_id(1001));
  result := pg_temp.admin_as(1, q);
  if (result->>'is_admin')::boolean is not true then
    raise exception 'C02: is_admin deveria ser true após grant.';
  end if;
  if not exists(
    select 1 from app_private.church_access ca
    where ca.church_id = pg_temp.admin_id(100) and ca.member_id = pg_temp.admin_id(12) and ca.is_admin = true
  ) then
    raise exception 'C02: banco não refletiu is_admin = true.';
  end if;

  -- C03: Replay idempotente do mesmo comando retorna o mesmo resultado sem duplicar recibo ou auditoria (CA04)
  result := pg_temp.admin_as(1, q);
  if (result->>'is_admin')::boolean is not true
    or (select count(*) from app_private.member_permission_receipts where command_id = pg_temp.admin_id(1001)) <> 1
    or (select count(*) from app_private.audit_entries where action = 'grant_church_admin') <> 1 then
    raise exception 'C03: replay idempotente falhou.';
  end if;

  -- C04: Reuso do mesmo command_id com outros parâmetros deve ser recusado (23505)
  perform pg_temp.admin_as(1, replace(q, 'grant', 'revoke'), '23505');

  -- C05: Bloqueio de concessão para quem já é admin em outra igreja (CA01 / 23514)
  -- User 4 já é admin na Igreja B, logo não pode ser admin na Igreja A
  perform pg_temp.admin_as(1, format('select to_jsonb(r) from public.manage_church_admin(%L, %L, %L, %L) r',
    pg_temp.admin_id(100), pg_temp.admin_id(15), 'grant', pg_temp.admin_id(1003)), '23514');

  -- C06: Revogação com sucesso quando há sucessor elegível (CA02)
  -- User 1 revoga User 3 (Igreja A ainda tem User 1 e User 2 como admins)
  q := format('select to_jsonb(r) from public.manage_church_admin(%L, %L, %L, %L) r',
    pg_temp.admin_id(100), pg_temp.admin_id(13), 'revoke', pg_temp.admin_id(1004));
  result := pg_temp.admin_as(1, q);
  if (result->>'is_admin')::boolean is not false then
    raise exception 'C06: is_admin deveria ser false após revoke.';
  end if;

  -- C07: Saída voluntária (renúncia do próprio admin logado) quando há outro admin
  -- User 2 (promovido em C01) renuncia à sua administração na Igreja A (User 1 continua admin)
  result := pg_temp.admin_as(2, format('select to_jsonb(r) from public.manage_church_admin(%L, %L, %L, %L) r',
    pg_temp.admin_id(100), pg_temp.admin_id(12), 'revoke', pg_temp.admin_id(1005)));
  if (result->>'is_admin')::boolean is not false then
    raise exception 'C07: saída voluntária com sucessor deveria ter sucesso.';
  end if;

  -- C08: Bloqueio de saída / revogação do ÚLTIMO administrador ativo (CA02 / 23514)
  -- Agora apenas User 1 é admin na Igreja A. Tentativa de revogar User 1 deve falhar!
  perform pg_temp.admin_as(1, format('select to_jsonb(r) from public.manage_church_admin(%L, %L, %L, %L) r',
    pg_temp.admin_id(100), pg_temp.admin_id(11), 'revoke', pg_temp.admin_id(1006)), '23514');

  -- C09: list_church_members_admin retorna is_admin e is_current_user corretamente
  result := pg_temp.admin_as(1, format('select to_jsonb(r) from public.list_church_members_admin(%L, %L) r',
    pg_temp.admin_id(100), 'all'));
  if jsonb_array_length(result->'items') < 4 then
    raise exception 'C09: contagem de itens incorreta.';
  end if;
  if not exists(
    select 1 from jsonb_array_elements(result->'items') elem
    where (elem->>'member_id')::uuid = pg_temp.admin_id(11)
      and (elem->>'is_admin')::boolean = true
      and (elem->>'is_current_user')::boolean = true
  ) then
    raise exception 'C09: flags is_admin ou is_current_user incorretas para admin logado.';
  end if;
end;
$cases$;
