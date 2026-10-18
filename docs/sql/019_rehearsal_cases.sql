-- Fragmento para ensaio transacional do candidato 019 (Issue #22).
-- NÃO executar isoladamente. Executa dentro da transação do candidato 019 terminando em ROLLBACK.

create function pg_temp.name_id(n integer) returns uuid language sql immutable as
$$ select ('01900000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid $$;

create function pg_temp.name_as(n integer, q text, expected text default '00000') returns jsonb
language plpgsql security invoker as $$
declare
  payload jsonb;
  code text := '00000';
  message text;
begin
  perform set_config('request.jwt.claim.sub', coalesce(pg_temp.name_id(n)::text, ''), true);
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
select pg_temp.name_id(n), 'name019_' || n || '@example.com', clock_timestamp(), '{"provider":"email"}'::jsonb,
  '{}'::jsonb, clock_timestamp(), clock_timestamp() from generate_series(1, 4) n;

insert into app_private.churches(id, name, timezone, default_duration_policy) values
  (pg_temp.name_id(100), 'Igreja Original 019', 'America/Sao_Paulo', 'warn'),
  (pg_temp.name_id(200), 'Igreja Outra 019', 'America/Sao_Paulo', 'warn');

insert into app_private.members(id, church_id, display_name, created_by_user_id) values
  (pg_temp.name_id(11), pg_temp.name_id(100), 'Admin Igreja 100', pg_temp.name_id(1)),
  (pg_temp.name_id(12), pg_temp.name_id(100), 'Membro Igreja 100', pg_temp.name_id(1)),
  (pg_temp.name_id(13), pg_temp.name_id(200), 'Admin Igreja 200', pg_temp.name_id(3)),
  (pg_temp.name_id(14), pg_temp.name_id(100), 'Segundo Admin Igreja 100', pg_temp.name_id(4));

insert into app_private.church_access(church_id, user_id, member_id, is_admin, onboarding_completed_at, granted_by_user_id) values
  (pg_temp.name_id(100), pg_temp.name_id(1), pg_temp.name_id(11), true, clock_timestamp(), pg_temp.name_id(1)),
  (pg_temp.name_id(100), pg_temp.name_id(2), pg_temp.name_id(12), false, clock_timestamp(), pg_temp.name_id(1)),
  (pg_temp.name_id(200), pg_temp.name_id(3), pg_temp.name_id(13), true, clock_timestamp(), pg_temp.name_id(3)),
  (pg_temp.name_id(100), pg_temp.name_id(4), pg_temp.name_id(14), true, clock_timestamp(), pg_temp.name_id(4));

do $cases$
declare
  result jsonb;
  q text;
  audit_rec record;
  receipt_rec record;
begin
  -- N01 (CA01): Membro comum da mesma igreja não consegue atualizar o nome (42501)
  perform pg_temp.name_as(2, format('select to_jsonb(r) from public.update_church_settings(%L, %L, 0, %L, null, null, null) r',
    pg_temp.name_id(100), pg_temp.name_id(1001), 'Novo Nome'), '42501');

  -- N02 (CA01): Administrador de outra igreja não consegue atualizar o nome da Igreja 100 (42501)
  perform pg_temp.name_as(3, format('select to_jsonb(r) from public.update_church_settings(%L, %L, 0, %L, null, null, null) r',
    pg_temp.name_id(100), pg_temp.name_id(1002), 'Novo Nome Invasor'), '42501');

  -- N03 (CA02): Nome vazio ou com apenas espaços em branco é rejeitado (23514)
  perform pg_temp.name_as(1, format('select to_jsonb(r) from public.update_church_settings(%L, %L, 0, %L, null, null, null) r',
    pg_temp.name_id(100), pg_temp.name_id(1003), '   '), '23514');

  -- N04 (CA02): Nome excedendo 160 caracteres é rejeitado (23514)
  perform pg_temp.name_as(1, format('select to_jsonb(r) from public.update_church_settings(%L, %L, 0, %L, null, null, null) r',
    pg_temp.name_id(100), pg_temp.name_id(1004), repeat('A', 161)), '23514');

  -- N05 (CA02, CA03, CA05, CA07): Atualização bem-sucedida com normalização NFC e trim de espaços
  q := format('select to_jsonb(r) from public.update_church_settings(%L, %L, 0, %L, %L, null, null) r',
    pg_temp.name_id(100), pg_temp.name_id(1005), '  Igreja do Reino Renovada  ', 'Rua das Flores, 123');
  result := pg_temp.name_as(1, q);

  if (result->>'profile_revision')::integer is distinct from 1 then
    raise exception 'N05: profile_revision deveria ser 1 após primeira atualização.';
  end if;

  if not exists (
    select 1 from app_private.churches c
    where c.id = pg_temp.name_id(100)
      and c.name = 'Igreja do Reino Renovada'
      and c.address = 'Rua das Flores, 123'
      and c.profile_revision = 1
  ) then
    raise exception 'N05: Nome normalizado não persistido na tabela app_private.churches.';
  end if;

  -- N06 (CA07): Auditoria registra nomes anterior e novo, igreja, ator e timestamps
  select * into audit_rec from app_private.audit_entries
    where church_id = pg_temp.name_id(100) and action = 'update_church_settings';
  if not found
    or audit_rec.details->>'previous_name' is distinct from 'Igreja Original 019'
    or audit_rec.details->>'new_name' is distinct from 'Igreja do Reino Renovada'
    or (audit_rec.details->'changed_fields'->>'name')::boolean is not true then
    raise exception 'N06: Registro de auditoria divergente do esperado.';
  end if;

  -- N07 (CA06, CA07): Replay idempotente do mesmo comando retorna o mesmo resultado sem duplicar auditoria ou recibo
  result := pg_temp.name_as(1, q);
  if (result->>'profile_revision')::integer is distinct from 1
    or (select count(*) from app_private.audit_entries where church_id = pg_temp.name_id(100) and action = 'update_church_settings') <> 1
    or (select count(*) from app_private.church_settings_receipts where church_id = pg_temp.name_id(100) and command_id = pg_temp.name_id(1005)) <> 1 then
    raise exception 'N07: Replay idempotente falhou ou duplicou recibo/auditoria.';
  end if;

  -- N08 (CA06): Reuso do mesmo command_id com outros dados é rejeitado (23505)
  perform pg_temp.name_as(1, replace(q, 'Igreja do Reino Renovada', 'Outro Nome Divergente'), '23505');

  -- N09 (CA06): Conflito de versão (expected_revision desatualizada) é rejeitado (40001)
  perform pg_temp.name_as(4, format('select to_jsonb(r) from public.update_church_settings(%L, %L, 0, %L, null, null, null) r',
    pg_temp.name_id(100), pg_temp.name_id(1006), 'Nome Concorrente'), '40001');

  -- N10 (Retrocompatibilidade): Chamada com 6 parâmetros preserva o nome atualizado e funciona
  result := pg_temp.name_as(1, format('select to_jsonb(r) from public.update_church_settings(%L, %L, 1, %L, null, null) r',
    pg_temp.name_id(100), pg_temp.name_id(1007), 'Rua Nova, 456'));
  if (result->>'profile_revision')::integer is distinct from 2
    or (select name from app_private.churches where id = pg_temp.name_id(100)) <> 'Igreja do Reino Renovada'
    or (select address from app_private.churches where id = pg_temp.name_id(100)) <> 'Rua Nova, 456' then
    raise exception 'N10: Sobrecarga retrocompatível de 6 parâmetros falhou em preservar o nome.';
  end if;

  -- N11 (CA01): Perda de permissão de admin bloqueia escrita e replay subsequente (42501)
  update app_private.church_access set is_admin = false
    where church_id = pg_temp.name_id(100) and user_id = pg_temp.name_id(1);

  perform pg_temp.name_as(1, format('select to_jsonb(r) from public.update_church_settings(%L, %L, 2, %L, null, null, null) r',
    pg_temp.name_id(100), pg_temp.name_id(1008), 'Tentativa Pós-Revogação'), '42501');

  -- Replay de comando anterior também é bloqueado após perda de privilégio
  perform pg_temp.name_as(1, q, '42501');

  raise notice 'N01–N11 aprovados com sucesso.';
end;
$cases$;
