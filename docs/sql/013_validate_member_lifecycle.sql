-- Escala do Reino: ensaio transacional completo do incremento 013 (Ciclo de Vida de Membros).
-- Executa em transação isolada com ROLLBACK obrigatório ao final.
-- NENHUM dado ou alteração persiste no banco de dados.
-- Testa: gatilho monotônico, listagem administrativa com filtros e has_revoked_access, restauração elegível,
-- permanência inalterada de vínculo revogado, atomicidade/rollback em falha de auditoria,
-- idempotência/replay, conflito de parâmetros, guarda de acesso ativo legado (P0018),
-- controle de concorrência por revisão (P0019), consulta de recibo e recusa P0021 autorizada.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $test_suite$
declare
  v_admin_user_id uuid := '11111111-1111-4111-8111-111111111111'::uuid;
  v_other_user_id uuid := '22222222-2222-4222-8222-222222222222'::uuid;
  v_church_id uuid := '33333333-3333-4333-8333-333333333333'::uuid;
  v_admin_member_id uuid := '44444444-4444-4444-8444-444444444444'::uuid;
  v_target_member_id uuid := '55555555-5555-4555-8555-555555555555'::uuid;
  v_legacy_member_id uuid := '66666666-6666-4666-8666-666666666666'::uuid;
  v_legacy_user_id uuid := '77777777-7777-4777-8777-777777777777'::uuid;
  v_revoked_member_id uuid := '88888888-8888-4888-8888-888888888888'::uuid;
  v_revoked_user_id uuid := '99999999-9999-4999-8999-999999999999'::uuid;
  v_audit_fail_member_id uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid;
  v_receipt_fail_member_id uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid;

  v_cmd_id_1 uuid := gen_random_uuid();
  v_cmd_id_2 uuid := gen_random_uuid();
  v_cmd_id_3 uuid := gen_random_uuid();
  v_cmd_id_revoked uuid := gen_random_uuid();
  v_cmd_id_audit_fail uuid := gen_random_uuid();
  v_cmd_id_receipt_fail uuid := gen_random_uuid();

  v_list_rec record;
  v_restore_rec record;
  v_receipt_rec record;

  v_updated_at_1 timestamptz;
  v_updated_at_2 timestamptz;
  v_updated_at_str text;
  v_updated_at_target_str text;
  v_updated_at_revoked_str text;
  v_updated_at_audit_fail_str text;
  v_updated_at_receipt_fail_str text;
  v_stale_updated_at_str text;
  v_access_before jsonb;
  v_access_after jsonb;
  v_audit_count integer;
  v_receipt_count integer;
  v_caught_error text;
begin
  -- 1. Criação de usuários simulados em auth.users
  insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    (v_admin_user_id, 'admin@example.com', statement_timestamp(), '{"provider":"email"}'::jsonb, '{"name":"Admin"}'::jsonb, statement_timestamp(), statement_timestamp()),
    (v_other_user_id, 'outro@example.com', statement_timestamp(), '{"provider":"email"}'::jsonb, '{"name":"Outro"}'::jsonb, statement_timestamp(), statement_timestamp()),
    (v_legacy_user_id, 'legacy@example.com', statement_timestamp(), '{"provider":"email"}'::jsonb, '{"name":"Legacy"}'::jsonb, statement_timestamp(), statement_timestamp()),
    (v_revoked_user_id, 'revoked@example.com', statement_timestamp(), '{"provider":"email"}'::jsonb, '{"name":"Revoked"}'::jsonb, statement_timestamp(), statement_timestamp());

  -- 2. Criação da igreja de teste (conforme esquema 001: sem slug, default_duration_policy obrigatória)
  insert into app_private.churches (id, name, timezone, default_duration_policy, status, created_at, updated_at)
  values (v_church_id, 'Igreja Ensaio 013', 'America/Sao_Paulo', 'warn', 'active', statement_timestamp(), statement_timestamp());

  -- 3. Criação dos membros de teste
  -- Membro operador admin
  insert into app_private.members (id, church_id, display_name, status, created_by_user_id, created_at, updated_at)
  values (v_admin_member_id, v_church_id, 'Pastor Operador', 'active', v_admin_user_id, statement_timestamp(), statement_timestamp());

  -- Membro alvo para ciclo de vida (inicialmente inactive)
  insert into app_private.members (id, church_id, display_name, status, created_by_user_id, created_at, updated_at)
  values (v_target_member_id, v_church_id, 'Irmão Inativo', 'inactive', v_admin_user_id, statement_timestamp(), statement_timestamp());

  -- Membro com acesso ativo legado (para teste da guarda P0018)
  insert into app_private.members (id, church_id, display_name, status, created_by_user_id, created_at, updated_at)
  values (v_legacy_member_id, v_church_id, 'Irmão Acesso Legado', 'inactive', v_admin_user_id, statement_timestamp(), statement_timestamp());

  -- Membro com acesso previamente revogado (para conferir que permanece inalterado)
  insert into app_private.members (id, church_id, display_name, status, created_by_user_id, created_at, updated_at)
  values (v_revoked_member_id, v_church_id, 'Irmão Acesso Revogado', 'inactive', v_admin_user_id, statement_timestamp(), statement_timestamp());

  -- Membro alvo para teste de falha atômica em auditoria
  insert into app_private.members (id, church_id, display_name, status, created_by_user_id, created_at, updated_at)
  values (v_audit_fail_member_id, v_church_id, 'Irmão Falha Auditoria', 'inactive', v_admin_user_id, statement_timestamp(), statement_timestamp());

  -- Membro alvo para teste de falha atômica em command_receipts
  insert into app_private.members (id, church_id, display_name, status, created_by_user_id, created_at, updated_at)
  values (v_receipt_fail_member_id, v_church_id, 'Irmão Falha Recibo', 'inactive', v_admin_user_id, statement_timestamp(), statement_timestamp());

  -- 4. Vínculos de acesso em church_access
  -- Vínculo administrativo do operador
  insert into app_private.church_access (church_id, user_id, member_id, is_admin, status, onboarding_completed_at, granted_by_user_id, created_at, updated_at)
  values (v_church_id, v_admin_user_id, v_admin_member_id, true, 'active', statement_timestamp(), v_admin_user_id, statement_timestamp(), statement_timestamp());

  -- Vínculo ativo legado no membro v_legacy_member_id
  insert into app_private.church_access (church_id, user_id, member_id, is_admin, status, onboarding_completed_at, granted_by_user_id, created_at, updated_at)
  values (v_church_id, v_legacy_user_id, v_legacy_member_id, false, 'active', statement_timestamp(), v_admin_user_id, statement_timestamp(), statement_timestamp());

  -- Vínculo revogado anterior no membro v_revoked_member_id (com metadados completos exigidos por 001)
  insert into app_private.church_access (
    church_id, user_id, member_id, is_admin, status,
    onboarding_completed_at, granted_by_user_id, granted_at,
    revoked_by_user_id, revoked_at, created_at, updated_at
  )
  values (
    v_church_id, v_revoked_user_id, v_revoked_member_id, false, 'revoked',
    statement_timestamp(), v_admin_user_id, statement_timestamp(),
    v_admin_user_id, statement_timestamp(), statement_timestamp(), statement_timestamp()
  );

  -- =========================================================================
  -- TESTE A: Gatilho monotônico de app_private.members
  -- =========================================================================
  select updated_at into v_updated_at_1 from app_private.members where id = v_target_member_id;

  update app_private.members set display_name = 'Irmão Inativo Modificado' where id = v_target_member_id;
  select updated_at into v_updated_at_2 from app_private.members where id = v_target_member_id;

  if v_updated_at_2 <= v_updated_at_1 then
    raise exception 'TESTE A FALHOU: updated_at não avançou monotonicamente (t1=%, t2=%)', v_updated_at_1, v_updated_at_2;
  end if;

  -- Reverte o nome para prosseguir e guarda a revisão original específica de cada membro
  update app_private.members set display_name = 'Irmão Inativo' where id = v_target_member_id;
  select updated_at into v_updated_at_1 from app_private.members where id = v_target_member_id;
  v_updated_at_target_str := to_char(v_updated_at_1 at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
  v_updated_at_str := v_updated_at_target_str;

  select to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  into v_updated_at_revoked_str from app_private.members where id = v_revoked_member_id;

  select to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  into v_updated_at_audit_fail_str from app_private.members where id = v_audit_fail_member_id;

  select to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  into v_updated_at_receipt_fail_str from app_private.members where id = v_receipt_fail_member_id;

  v_stale_updated_at_str := '2020-01-01T00:00:00.000000Z';

  -- =========================================================================
  -- TESTE B: list_church_members_admin
  -- =========================================================================
  -- Simula sessão autenticada do admin
  perform set_config('request.jwt.claim.sub', v_admin_user_id::text, true);

  -- Filtro 'all': deve conter 6 membros
  select * into v_list_rec from public.list_church_members_admin(v_church_id, 'all', 10, 0);
  if v_list_rec.total_count is null or v_list_rec.items is null or v_list_rec.total_count <> 6 or jsonb_array_length(v_list_rec.items) <> 6 then
    raise exception 'TESTE B FALHOU: filtro all esperado 6, encontrado total=%, items=%', v_list_rec.total_count, jsonb_array_length(v_list_rec.items);
  end if;

  -- Filtro 'active': deve conter 1 membro (Pastor Operador)
  select * into v_list_rec from public.list_church_members_admin(v_church_id, 'active', 10, 0);
  if v_list_rec.total_count is null or v_list_rec.items is null or v_list_rec.total_count <> 1 or jsonb_array_length(v_list_rec.items) <> 1 then
    raise exception 'TESTE B FALHOU: filtro active esperado 1, encontrado %', v_list_rec.total_count;
  end if;

  -- Filtro 'inactive': deve conter 5 membros
  select * into v_list_rec from public.list_church_members_admin(v_church_id, 'inactive', 10, 0);
  if v_list_rec.total_count is null or v_list_rec.items is null or v_list_rec.total_count <> 5 or jsonb_array_length(v_list_rec.items) <> 5 then
    raise exception 'TESTE B FALHOU: filtro inactive esperado 5, encontrado %', v_list_rec.total_count;
  end if;

  -- Verifica estrutura dos itens retornados (has_active_access, has_church_access, has_revoked_access e updated_at)
  if not (
    v_list_rec.items->0 ? 'member_id'
    and v_list_rec.items->0 ? 'display_name'
    and v_list_rec.items->0 ? 'status'
    and v_list_rec.items->0 ? 'updated_at'
    and v_list_rec.items->0 ? 'has_active_access'
    and v_list_rec.items->0 ? 'has_church_access'
    and v_list_rec.items->0 ? 'has_revoked_access'
  ) then
    raise exception 'TESTE B FALHOU: payload do item não contém as chaves requeridas';
  end if;

  -- Teste de acesso não autorizado à listagem
  perform set_config('request.jwt.claim.sub', v_other_user_id::text, true);
  v_caught_error := null;
  begin
    perform * from public.list_church_members_admin(v_church_id, 'all', 10, 0);
  exception when others then
    v_caught_error := SQLSTATE;
  end;
  if v_caught_error is distinct from '42501' then
    raise exception 'TESTE B FALHOU: usuário sem acesso devia receber 42501, recebeu %', v_caught_error;
  end if;

  -- Restaura sessão admin
  perform set_config('request.jwt.claim.sub', v_admin_user_id::text, true);

  -- =========================================================================
  -- TESTE C: restore_church_member — Validações de Guarda
  -- =========================================================================
  -- C.1: Guarda de revisão desatualizada (P0019)
  v_caught_error := null;
  begin
    perform * from public.restore_church_member(v_church_id, v_cmd_id_1, v_target_member_id, v_stale_updated_at_str);
  exception when others then
    v_caught_error := SQLSTATE;
  end;
  if v_caught_error is distinct from 'P0019' then
    raise exception 'TESTE C.1 FALHOU: revisão obsoleta devia lançar P0019, lançou %', v_caught_error;
  end if;

  -- C.2: Guarda de vínculo ativo legado (P0018)
  select to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  into v_updated_at_str
  from app_private.members where id = v_legacy_member_id;

  v_caught_error := null;
  begin
    perform * from public.restore_church_member(v_church_id, v_cmd_id_1, v_legacy_member_id, v_updated_at_str);
  exception when others then
    v_caught_error := SQLSTATE;
  end;
  if v_caught_error is distinct from 'P0018' then
    raise exception 'TESTE C.2 FALHOU: membro com acesso ativo legado devia lançar P0018, lançou %', v_caught_error;
  end if;

  -- =========================================================================
  -- TESTE D: restore_church_member — Execução Válida, Auditoria e Recibo
  -- =========================================================================
  -- D.1: Restauração ordinária de membro sem acesso
  select * into v_restore_rec
  from public.restore_church_member(v_church_id, v_cmd_id_1, v_target_member_id, v_updated_at_target_str);

  if v_restore_rec.command_id is null or v_restore_rec.command_id <> v_cmd_id_1
     or v_restore_rec.action is null or v_restore_rec.action <> 'restore_member'
     or v_restore_rec.church_id is null or v_restore_rec.church_id <> v_church_id
     or v_restore_rec.result_member_id is null or v_restore_rec.result_member_id <> v_target_member_id
     or v_restore_rec.result_payload is null then
    raise exception 'TESTE D.1 FALHOU: retorno inesperado ou nulo da restauração %', v_restore_rec;
  end if;

  if (v_restore_rec.result_payload->>'has_revoked_access')::boolean <> false then
    raise exception 'TESTE D.1 FALHOU: has_revoked_access devia ser false';
  end if;

  -- Verifica que a nova revisão atualizada está presente no payload
  if (v_restore_rec.result_payload->>'updated_at') is null then
    raise exception 'TESTE D.1 FALHOU: payload não contém nova revisão updated_at';
  end if;

  -- Verifica que o membro agora está 'active'
  if not exists (select 1 from app_private.members where id = v_target_member_id and status = 'active') then
    raise exception 'TESTE D.1 FALHOU: status do membro não foi atualizado para active';
  end if;

  -- Verifica auditoria gravada com schema 003 (actor_user_id e actor_source = 'application')
  select count(*) into v_audit_count from app_private.audit_entries
  where church_id = v_church_id
    and action = 'restore_member'
    and target_id = v_target_member_id
    and actor_user_id = v_admin_user_id
    and actor_source = 'application';
  if v_audit_count <> 1 then
    raise exception 'TESTE D.1 FALHOU: audit_entries esperado 1 registro com actor_source=application, encontrado %', v_audit_count;
  end if;

  -- D.2: Restauração de membro com vínculo prévio revogado:
  -- O membro passa a active, has_revoked_access é true no payload, e church_access REMAINS 'revoked'
  -- Captura a linha completa de church_access antes da restauração para comparação estrita
  select row_to_json(ca.*) into v_access_before
  from app_private.church_access ca
  where church_id = v_church_id and member_id = v_revoked_member_id;

  if v_access_before is null then
    raise exception 'TESTE D.2 FALHOU: church_access prévio não localizado para o membro com acesso revogado';
  end if;

  select * into v_restore_rec
  from public.restore_church_member(v_church_id, v_cmd_id_revoked, v_revoked_member_id, v_updated_at_revoked_str);

  if v_restore_rec.command_id is null or v_restore_rec.command_id <> v_cmd_id_revoked
     or v_restore_rec.action is null or v_restore_rec.action <> 'restore_member'
     or v_restore_rec.result_payload is null then
    raise exception 'TESTE D.2 FALHOU: retorno inesperado ou nulo da restauração D.2 %', v_restore_rec;
  end if;

  if (v_restore_rec.result_payload->>'has_revoked_access')::boolean <> true then
    raise exception 'TESTE D.2 FALHOU: has_revoked_access devia ser true para membro com acesso revogado';
  end if;

  if not exists (select 1 from app_private.members where id = v_revoked_member_id and status = 'active') then
    raise exception 'TESTE D.2 FALHOU: membro com vínculo revogado devia ter sido ativado no cadastro';
  end if;

  -- Compara a linha completa de church_access pós-restauração comprovando invariância absoluta
  select row_to_json(ca.*) into v_access_after
  from app_private.church_access ca
  where church_id = v_church_id and member_id = v_revoked_member_id;

  if v_access_before is distinct from v_access_after then
    raise exception 'TESTE D.2 FALHOU: church_access foi modificado durante a restauração! (antes=%, depois=%)', v_access_before, v_access_after;
  end if;

  -- D.3: Atomicidade estrita — falha forçada em audit_entries desfaz toda a restauração
  create or replace function pg_temp.simula_falha_audit() returns trigger language plpgsql as $$
  begin
    raise exception 'Simulação de erro em audit_entries' using errcode = 'XX000';
  end;
  $$;

  create trigger trg_simula_falha_audit
  before insert on app_private.audit_entries
  for each row execute function pg_temp.simula_falha_audit();

  v_caught_error := null;
  begin
    perform * from public.restore_church_member(v_church_id, v_cmd_id_audit_fail, v_audit_fail_member_id, v_updated_at_audit_fail_str);
  exception when others then
    v_caught_error := SQLSTATE;
  end;

  drop trigger trg_simula_falha_audit on app_private.audit_entries;

  if v_caught_error is distinct from 'XX000' then
    raise exception 'TESTE D.3 FALHOU: erro forçado de auditoria devia lançar XX000, lançou %', v_caught_error;
  end if;

  -- Comprova que membro não foi ativado e nenhum recibo foi gerado
  if exists (select 1 from app_private.members where id = v_audit_fail_member_id and status = 'active') then
    raise exception 'TESTE D.3 FALHOU: membro não pode ter status active após aborto de auditoria';
  end if;

  if exists (select 1 from app_private.command_receipts where command_id = v_cmd_id_audit_fail) then
    raise exception 'TESTE D.3 FALHOU: recibo não pode existir após aborto de auditoria';
  end if;

  -- D.4: Atomicidade estrita — falha forçada em command_receipts desfaz toda a restauração
  -- (inclusive o update de status em members e o registro de auditoria em audit_entries)
  create or replace function pg_temp.simula_falha_receipt() returns trigger language plpgsql as $$
  begin
    raise exception 'Simulação de erro em command_receipts' using errcode = 'XX000';
  end;
  $$;

  create trigger trg_simula_falha_receipt
  before insert on app_private.command_receipts
  for each row execute function pg_temp.simula_falha_receipt();

  v_caught_error := null;
  begin
    perform * from public.restore_church_member(v_church_id, v_cmd_id_receipt_fail, v_receipt_fail_member_id, v_updated_at_receipt_fail_str);
  exception when others then
    v_caught_error := SQLSTATE;
  end;

  drop trigger trg_simula_falha_receipt on app_private.command_receipts;

  if v_caught_error is distinct from 'XX000' then
    raise exception 'TESTE D.4 FALHOU: erro forçado de recibo devia lançar XX000, lançou %', v_caught_error;
  end if;

  if exists (select 1 from app_private.members where id = v_receipt_fail_member_id and status = 'active') then
    raise exception 'TESTE D.4 FALHOU: membro não pode ter status active após aborto de recibo';
  end if;

  if exists (select 1 from app_private.audit_entries where church_id = v_church_id and target_id = v_receipt_fail_member_id) then
    raise exception 'TESTE D.4 FALHOU: audit_entries não pode existir após aborto de recibo';
  end if;

  if exists (select 1 from app_private.command_receipts where command_id = v_cmd_id_receipt_fail) then
    raise exception 'TESTE D.4 FALHOU: recibo não pode existir após aborto de recibo';
  end if;

  -- =========================================================================
  -- TESTE E: Replay Seguro Idempotente e Conflito de Parâmetros
  -- =========================================================================
  -- E.1: Replay idêntico (reenvia chave de D.1 com a revisão original correspondente v_updated_at_target_str)
  select * into v_restore_rec
  from public.restore_church_member(v_church_id, v_cmd_id_1, v_target_member_id, v_updated_at_target_str);

  if v_restore_rec.command_id is null or v_restore_rec.command_id <> v_cmd_id_1
     or v_restore_rec.action is null or v_restore_rec.action <> 'restore_member'
     or v_restore_rec.church_id is null or v_restore_rec.church_id <> v_church_id
     or v_restore_rec.result_member_id is null or v_restore_rec.result_member_id <> v_target_member_id
     or v_restore_rec.result_payload is null then
    raise exception 'TESTE E.1 FALHOU: replay falhou em retornar o recibo existente %', v_restore_rec;
  end if;

  -- Auditoria não pode ter duplicado
  select count(*) into v_audit_count from app_private.audit_entries
  where church_id = v_church_id and action = 'restore_member' and target_id = v_target_member_id;
  if v_audit_count <> 1 then
    raise exception 'TESTE E.1 FALHOU: replay não pode gerar nova auditoria (encontrado %)', v_audit_count;
  end if;

  -- E.2: Conflito de parâmetros no mesmo command_id (23505)
  v_caught_error := null;
  begin
    perform * from public.restore_church_member(v_church_id, v_cmd_id_1, v_admin_member_id, v_updated_at_target_str);
  exception when others then
    v_caught_error := SQLSTATE;
  end;
  if v_caught_error is distinct from '23505' then
    raise exception 'TESTE E.2 FALHOU: reuso de command_id com parâmetros divergentes devia lançar 23505, lançou %', v_caught_error;
  end if;

  -- E.3: Tentativa de restaurar membro já ativo com novo comando (P0019)
  select to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  into v_updated_at_str
  from app_private.members where id = v_target_member_id;

  v_caught_error := null;
  begin
    perform * from public.restore_church_member(v_church_id, v_cmd_id_2, v_target_member_id, v_updated_at_str);
  exception when others then
    v_caught_error := SQLSTATE;
  end;
  if v_caught_error is distinct from 'P0019' then
    raise exception 'TESTE E.3 FALHOU: membro já ativo devia lançar P0019, lançou %', v_caught_error;
  end if;

  -- =========================================================================
  -- TESTE F: get_member_lifecycle_receipt
  -- =========================================================================
  select * into v_receipt_rec from public.get_member_lifecycle_receipt(v_cmd_id_1);
  if v_receipt_rec.command_id is null or v_receipt_rec.command_id <> v_cmd_id_1
     or v_receipt_rec.action is null or v_receipt_rec.action <> 'restore_member'
     or v_receipt_rec.church_id is null or v_receipt_rec.church_id <> v_church_id
     or v_receipt_rec.result_payload is null then
    raise exception 'TESTE F FALHOU: recibo consultado divergente ou nulo %', v_receipt_rec;
  end if;

  -- Recibo inexistente (P0002)
  v_caught_error := null;
  begin
    perform * from public.get_member_lifecycle_receipt(gen_random_uuid());
  exception when others then
    v_caught_error := SQLSTATE;
  end;
  if v_caught_error is distinct from 'P0002' then
    raise exception 'TESTE F FALHOU: recibo inexistente devia lançar P0002, lançou %', v_caught_error;
  end if;

  -- =========================================================================
  -- TESTE G: deactivate_church_member — Autorização prévia e Recusa P0021
  -- =========================================================================
  -- G.1: Não autorizado é bloqueado por 42501 ANTES de P0021
  perform set_config('request.jwt.claim.sub', v_other_user_id::text, true);
  v_caught_error := null;
  begin
    perform * from public.deactivate_church_member(v_church_id, v_cmd_id_3, v_target_member_id, v_updated_at_str);
  exception when others then
    v_caught_error := SQLSTATE;
  end;
  if v_caught_error is distinct from '42501' then
    raise exception 'TESTE G.1 FALHOU: operador não autorizado devia ser barrado com 42501 antes de P0021, recebeu %', v_caught_error;
  end if;

  -- G.2: Operador plenamente autorizado recebe P0021 (indisponibilidade litúrgica)
  perform set_config('request.jwt.claim.sub', v_admin_user_id::text, true);
  v_caught_error := null;
  begin
    perform * from public.deactivate_church_member(v_church_id, v_cmd_id_3, v_target_member_id, v_updated_at_str);
  exception when others then
    v_caught_error := SQLSTATE;
  end;
  if v_caught_error is distinct from 'P0021' then
    raise exception 'TESTE G.2 FALHOU: operador autorizado devia receber P0021, recebeu %', v_caught_error;
  end if;

  -- G.3: Nenhuma mutação ou recibo gravado após P0021
  if exists (select 1 from app_private.command_receipts where command_id = v_cmd_id_3) then
    raise exception 'TESTE G.3 FALHOU: não pode existir recibo para comando recusado por P0021';
  end if;

  raise notice '013_validate_member_lifecycle: TODOS OS TESTES PASSARAM COM SUCESSO.';
end;
$test_suite$;

rollback;
