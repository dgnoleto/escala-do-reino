-- Fragmento para composição pelo preparador. Não executar isoladamente.
-- Exige uma base descartável vazia e executa dentro da transação do candidato 017.
create function pg_temp.settings_id(n integer) returns uuid language sql immutable as
$$ select ('01700000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid $$;
create function pg_temp.settings_as(n integer, q text, expected text default '00000') returns jsonb
language plpgsql security invoker as $$
declare payload jsonb; code text := '00000'; message text;
begin
  perform set_config('request.jwt.claim.sub', coalesce(pg_temp.settings_id(n)::text, ''), true);
  begin
    set local role authenticated;
    execute q into payload;
    reset role;
  exception when others then
    get stacked diagnostics code = returned_sqlstate, message = message_text;
    reset role;
  end;
  if code <> expected then raise exception 'Esperado %, recebido %: %', expected, code, message; end if;
  return payload;
end $$;

insert into auth.users(id, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  select pg_temp.settings_id(n), 'settings017_' || n || '@example.com', clock_timestamp(), '{"provider":"email"}'::jsonb,
    '{}'::jsonb, clock_timestamp(), clock_timestamp() from generate_series(1,4) n;
insert into app_private.churches(id, name, timezone, default_duration_policy) values
  (pg_temp.settings_id(100), 'Igreja A 017', 'America/Sao_Paulo', 'warn'),
  (pg_temp.settings_id(200), 'Igreja B 017', 'America/Sao_Paulo', 'warn');
insert into app_private.members(id, church_id, display_name, created_by_user_id) values
  (pg_temp.settings_id(11), pg_temp.settings_id(100), 'Admin A', pg_temp.settings_id(1)),
  (pg_temp.settings_id(12), pg_temp.settings_id(100), 'Membro A', pg_temp.settings_id(1)),
  (pg_temp.settings_id(13), pg_temp.settings_id(200), 'Admin B', pg_temp.settings_id(3)),
  (pg_temp.settings_id(14), pg_temp.settings_id(100), 'Segundo Admin A', pg_temp.settings_id(4));
insert into app_private.church_access(church_id, user_id, member_id, is_admin, onboarding_completed_at, granted_by_user_id) values
  (pg_temp.settings_id(100), pg_temp.settings_id(1), pg_temp.settings_id(11), true, clock_timestamp(), pg_temp.settings_id(1)),
  (pg_temp.settings_id(100), pg_temp.settings_id(2), pg_temp.settings_id(12), false, clock_timestamp(), pg_temp.settings_id(1)),
  (pg_temp.settings_id(200), pg_temp.settings_id(3), pg_temp.settings_id(13), true, clock_timestamp(), pg_temp.settings_id(3)),
  (pg_temp.settings_id(100), pg_temp.settings_id(4), pg_temp.settings_id(14), true, clock_timestamp(), pg_temp.settings_id(4));

do $cases$
declare result jsonb; q text; current_revision integer;
begin
  -- S01: admin consulta o cadastro completo e o membro não consulta.
  result := pg_temp.settings_as(1, format('select to_jsonb(r) from public.get_church_settings(%L) r', pg_temp.settings_id(100)));
  if result->>'name' is distinct from 'Igreja A 017' then raise exception 'S01: cadastro incorreto.'; end if;
  perform pg_temp.settings_as(2, format('select to_jsonb(r) from public.get_church_settings(%L) r', pg_temp.settings_id(100)), '42501');
  -- S02: escrita autorizada, recibo, versão e auditoria.
  q := format('select to_jsonb(r) from public.update_church_settings(%L,%L,0,%L,%L,null) r',
    pg_temp.settings_id(100), pg_temp.settings_id(1001), 'Rua corrigida', 'https://maps.app.goo.gl/teste017');
  result := pg_temp.settings_as(1, q);
  if (result->>'profile_revision')::integer is distinct from 1 then raise exception 'S02: revisão incorreta.'; end if;
  if not exists(select 1 from app_private.churches c where c.id=pg_temp.settings_id(100) and c.address='Rua corrigida') then
    raise exception 'S02: endereço não persistido.'; end if;
  -- S03: replay retorna a revisão original sem nova auditoria.
  result := pg_temp.settings_as(1, q);
  if (result->>'profile_revision')::integer is distinct from 1
    or (select count(*) from app_private.audit_entries a where a.action='update_church_settings') <> 1
    or (select count(*) from app_private.church_settings_receipts) <> 1 then raise exception 'S03: replay duplicado.'; end if;
  -- S04: mesmo ID com outro conteúdo não é aceito.
  perform pg_temp.settings_as(1, replace(q, 'Rua corrigida', 'Outro endereço'), '23505');
  -- S05: outra edição com revisão vencida é recusada.
  perform pg_temp.settings_as(4, replace(q, pg_temp.settings_id(1001)::text, pg_temp.settings_id(1002)::text), '40001');
  -- S06/S07: membro e administrador de outra igreja não escrevem.
  perform pg_temp.settings_as(2, q, '42501');
  perform pg_temp.settings_as(3, q, '42501');
  perform pg_temp.settings_as(3, format('select to_jsonb(r) from public.get_church_settings(%L) r', pg_temp.settings_id(100)), '42501');
  -- S08: servidor rejeita host falso, sem depender do formulário.
  perform pg_temp.settings_as(1, format('select to_jsonb(r) from public.update_church_settings(%L,%L,1,null,%L,null) r',
    pg_temp.settings_id(100), pg_temp.settings_id(1003), 'https://google.com.evil.test/maps/igreja'), '22023');
  -- S09/S10: caminho de outra igreja e arquivo inexistente não viram logo.
  perform pg_temp.settings_as(1, format('select to_jsonb(r) from public.update_church_settings(%L,%L,1,null,null,%L) r',
    pg_temp.settings_id(100), pg_temp.settings_id(1004), pg_temp.settings_id(200)::text || '/' || pg_temp.settings_id(900)::text || '.png'), '22023');
  perform pg_temp.settings_as(1, format('select to_jsonb(r) from public.update_church_settings(%L,%L,1,null,null,%L) r',
    pg_temp.settings_id(100), pg_temp.settings_id(1005), pg_temp.settings_id(100)::text || '/' || pg_temp.settings_id(900)::text || '.png'), '22023');
  -- S11: membro consulta apenas identidade visual; não ganha permissão de envio.
  perform pg_temp.settings_as(2, format('select to_jsonb(r) from public.get_church_logo(%L) r', pg_temp.settings_id(100)));
  result := pg_temp.settings_as(2, format('select to_jsonb(public.can_access_church_logo(%L,true))', pg_temp.settings_id(100)::text || '/' || pg_temp.settings_id(900)::text || '.png'));
  if result is distinct from 'false'::jsonb then raise exception 'S11: membro recebeu escrita no Storage.'; end if;
  -- S12: nem replay concede resultado após perda de administração.
  update app_private.church_access ca set is_admin=false where ca.user_id=pg_temp.settings_id(1);
  perform pg_temp.settings_as(1, q, '42501');
  perform pg_temp.settings_as(1, format('select to_jsonb(r) from public.get_church_settings(%L) r', pg_temp.settings_id(100)), '42501');
  -- S13: ausência de autenticação.
  perform pg_temp.settings_as(null, q, '28000');
  -- S14: falhas não alteraram revisão, auditoria ou recibos.
  select c.profile_revision into current_revision from app_private.churches c where c.id=pg_temp.settings_id(100);
  if current_revision is distinct from 1 or (select count(*) from app_private.church_settings_receipts) <> 1
    or (select count(*) from app_private.audit_entries a where a.action='update_church_settings') <> 1 then
    raise exception 'S14: efeitos colaterais após recusas.'; end if;
  if not exists(select 1 from storage.buckets b where b.id='church-logos' and not b.public and b.file_size_limit=2097152) then
    raise exception 'S14: bucket fora do contrato.'; end if;
  raise notice 'S01–S14 aprovados. Storage HTTP, arquivos reais e concorrência exigem provas separadas.';
end;
$cases$;

-- Prova adicional de RLS real com metadados nativos, sem envio de arquivos físicos.
-- Uma política permissiva adversária simula políticas antigas excessivamente abertas.
create policy settings017_adversarial_policy on storage.objects for all to public using(true) with check(true);
insert into storage.buckets(id,name,public) values('settings017-other-bucket','settings017-other-bucket',false);
insert into storage.objects(bucket_id,name,metadata) values
  ('church-logos',pg_temp.settings_id(100)::text || '/' || pg_temp.settings_id(901)::text || '.png','{"mimetype":"image/png","size":100}'::jsonb),
  ('church-logos',pg_temp.settings_id(200)::text || '/' || pg_temp.settings_id(902)::text || '.png','{"mimetype":"image/png","size":100}'::jsonb),
  ('church-logos',pg_temp.settings_id(100)::text || '/' || pg_temp.settings_id(903)::text || '.png','{"mimetype":"image/svg+xml","size":100}'::jsonb),
  ('settings017-other-bucket','preserved-policy.txt','{"mimetype":"text/plain","size":10}'::jsonb);
create function pg_temp.settings_storage_as(p_role text, n integer, q text, expected text default '00000') returns jsonb
language plpgsql security invoker as $$
declare payload jsonb; code text := '00000'; message text;
begin
  if p_role not in ('authenticated','anon') then raise exception 'Papel de teste inválido.'; end if;
  perform set_config('request.jwt.claim.sub', coalesce(pg_temp.settings_id(n)::text, ''), true);
  begin
    execute format('set local role %I', p_role);
    execute q into payload;
    reset role;
  exception when others then
    get stacked diagnostics code=returned_sqlstate, message=message_text;
    reset role;
  end;
  if code <> expected then raise exception 'Esperado %, recebido %: %', expected, code, message; end if;
  return payload;
end $$;
do $storage_cases$
declare result jsonb; q text; logo text := pg_temp.settings_id(100)::text || '/' || pg_temp.settings_id(900)::text || '.png';
begin
  -- S15: membro, admin de outra igreja e anônimo não inserem mesmo com política permissiva true.
  q := format('with x as(insert into storage.objects(bucket_id,name,metadata) values(''church-logos'',%L,''{"mimetype":"image/png","size":100}''::jsonb) returning name) select to_jsonb(x) from x', logo);
  perform pg_temp.settings_storage_as('authenticated',2,q,'42501');
  perform pg_temp.settings_storage_as('authenticated',3,q,'42501');
  perform pg_temp.settings_storage_as('anon',null,q,'42501');
  -- S16: admin da própria igreja insere metadados e referencia a imagem existente.
  result := pg_temp.settings_storage_as('authenticated',4,q);
  if result->>'name' is distinct from logo then raise exception 'S16: inserção autorizada falhou.'; end if;
  result := pg_temp.settings_as(4,format('select to_jsonb(r) from public.update_church_settings(%L,%L,1,%L,%L,%L) r',
    pg_temp.settings_id(100),pg_temp.settings_id(1006),'Rua corrigida','https://maps.app.goo.gl/teste017',logo));
  if (result->>'profile_revision')::integer is distinct from 2 then raise exception 'S16: logo não referenciada.'; end if;
  -- S17: membro lê somente logo atual; admin da outra igreja lê somente os seus objetos; anônimo não lê.
  q := 'select to_jsonb(count(*)) from storage.objects where bucket_id=''church-logos''';
  result := pg_temp.settings_storage_as('authenticated',2,q);
  if result is distinct from '1'::jsonb then raise exception 'S17: membro leu logos antigas/outra igreja.'; end if;
  result := pg_temp.settings_storage_as('authenticated',3,q);
  if result is distinct from '1'::jsonb then raise exception 'S17: vazamento entre igrejas.'; end if;
  result := pg_temp.settings_storage_as('anon',null,q);
  if result is distinct from '0'::jsonb then raise exception 'S17: leitura anônima.'; end if;
  -- S18: guardas não alteram a política de outros buckets.
  result := pg_temp.settings_storage_as('anon',null,'select to_jsonb(count(*)) from storage.objects where bucket_id=''settings017-other-bucket''');
  if result is distinct from '1'::jsonb then raise exception 'S18: interferência em outro bucket.'; end if;
  -- S19: nem admin sobrescreve/apaga objetos. A flag corresponde ao executor de exclusão do Storage.
  perform set_config('storage.allow_delete_query','true',true);
  result := pg_temp.settings_storage_as('authenticated',4,format('with x as(update storage.objects set metadata=''{}''::jsonb where bucket_id=''church-logos'' and name=%L returning id) select to_jsonb(count(*)) from x',logo));
  if result is distinct from '0'::jsonb then raise exception 'S19: sobrescrita de arquivo imutável.'; end if;
  result := pg_temp.settings_storage_as('authenticated',4,format('with x as(delete from storage.objects where bucket_id=''church-logos'' and name=%L returning id) select to_jsonb(count(*)) from x',logo));
  if result is distinct from '0'::jsonb then raise exception 'S19: exclusão de arquivo imutável.'; end if;
  -- S20: mesmo um objeto existente com MIME recusado não pode virar logo.
  perform pg_temp.settings_as(4,format('select to_jsonb(r) from public.update_church_settings(%L,%L,2,null,null,%L) r',
    pg_temp.settings_id(100),pg_temp.settings_id(1007),pg_temp.settings_id(100)::text || '/' || pg_temp.settings_id(903)::text || '.png'),'22023');
  -- S21: remover logo muda a referência e impede nova leitura do objeto pelos membros.
  result := pg_temp.settings_as(4,format('select to_jsonb(r) from public.update_church_settings(%L,%L,2,%L,%L,null) r',
    pg_temp.settings_id(100),pg_temp.settings_id(1008),'Rua corrigida','https://maps.app.goo.gl/teste017'));
  if (result->>'profile_revision')::integer is distinct from 3 then raise exception 'S21: remoção não persistiu.'; end if;
  result := pg_temp.settings_storage_as('authenticated',2,q);
  if result is distinct from '0'::jsonb then raise exception 'S21: membro continuou lendo arquivo removido.'; end if;
  if not exists(select 1 from storage.objects o where o.bucket_id='church-logos' and o.name=logo) then raise exception 'S21: arquivo foi apagado.'; end if;
  -- S22: tabela e helper privados continuam sem acesso direto de cliente; definers permanecem postgres.
  perform pg_temp.settings_as(4,'select to_jsonb(count(*)) from app_private.church_settings_receipts','42501');
  if has_function_privilege('authenticated','app_private.has_church_settings_access(uuid,boolean)','EXECUTE')
    or has_function_privilege('anon','public.get_church_settings(uuid)','EXECUTE')
    or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where (n.nspname='public' and p.proname in ('get_church_settings','update_church_settings','get_church_logo','can_access_church_logo')
        or n.nspname='app_private' and p.proname='has_church_settings_access') and pg_get_userbyid(p.proowner)<>'postgres') then
    raise exception 'S22: grants/proprietários fora do contrato.'; end if;
  raise notice 'S15–S22 aprovados: RLS nativa, políticas permissivas adversárias, isolamento e imutabilidade. Sem arquivos físicos/HTTP.';
end;
$storage_cases$;
