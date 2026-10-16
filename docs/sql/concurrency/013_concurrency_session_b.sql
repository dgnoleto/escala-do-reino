-- ============================================================================
-- Escala do Reino — Ensaio de Concorrência Física: Conexão B (Sessão 2)
-- Incremento: 013 / 014 (Ciclo de Vida de Membros e Restauração Elegível)
-- ============================================================================
-- Executar em uma segunda conexão dedicada (Terminal 2 / psql Conexão B).
-- Demonstra a entrada em espera física comprovável na fila de locks do PostgreSQL,
-- seguida de desbloqueio determinístico pós-commit de A e captura estrita dos
-- desfechos esperados (P0019, P0018, 42501 e Replay Idêntico).
--
-- ATENÇÃO E GOVERNANÇA:
-- 1. Executar apenas em base local autorizada de laboratório (127.0.0.1:55332 / container local).
-- 2. NUNCA execute este script em banco de piloto remoto, homologação compartilhada ou produção.
-- 3. Interrupção imediata em caso de erro (\set ON_ERROR_STOP on).
-- ============================================================================

\set ON_ERROR_STOP on

-- GUARDA ANTECIPADA: Bloqueio estrito contra execução em piloto, produção ou base remota
do $guard_target$
declare
  v_server_addr inet;
begin
  if current_database() <> 'postgres' or current_database() ~* 'prod|pilot|jvpctgqudvjealzileib' then
    raise exception 'EXECUÇÃO ABORTADA: Base inválida ou potencialmente compartilhada/remota: %', current_database();
  end if;

  v_server_addr := inet_server_addr();
  if v_server_addr is not null and not (
    v_server_addr = '127.0.0.1'::inet
    or v_server_addr = '::1'::inet
    or host(v_server_addr) like '172.%'
    or host(v_server_addr) like '10.%'
    or host(v_server_addr) like '192.168.%'
  ) then
    raise exception 'EXECUÇÃO ABORTADA: Conexão não está em loopback ou rede de container efêmero (inet_server_addr = %).', v_server_addr;
  end if;

  if current_setting('server_encoding') <> 'UTF8' or current_setting('client_encoding') <> 'UTF8' then
    raise exception 'EXECUÇÃO ABORTADA: Conexão e banco precisam usar codificação UTF8.';
  end if;
end;
$guard_target$;

-- AGUARDA INICIALIZAÇÃO DA TABELA DE COORDENAÇÃO PELA SESSÃO A
do $wait_table$
declare
  v_attempts integer := 0;
begin
  loop
    if exists (
      select 1 from pg_catalog.pg_tables
      where schemaname = 'app_private' and tablename = 'rehearsal_coordination'
    ) then
      exit;
    end if;
    v_attempts := v_attempts + 1;
    if v_attempts > 60 then
      raise exception 'TIMEOUT: Tabela app_private.rehearsal_coordination não foi criada pela Sessão A após 6s.';
    end if;
    perform pg_sleep(0.1);
  end loop;
end;
$wait_table$;

-- REGISTRO DE IDENTIDADE DA SESSÃO B
insert into app_private.rehearsal_coordination (session_role, pid, step_status, last_step)
values ('session_b_013', pg_backend_pid(), 'ready', 'init')
on conflict (session_role) do update
set pid = excluded.pid, step_status = 'ready', last_step = 'init', registered_at = clock_timestamp();

-- ============================================================================
-- CENÁRIO C1.A: Disputa Concorrente de Revisão (T0 -> T1) com Membro Inactive
-- ============================================================================
-- Passo B1.A: Conexão B aguarda sinal de A ('holding_c1a'), sincroniza via
-- gate de advisory lock (garantindo que A já adquiriu o lock de linha),
-- lê revisão T0, comuta para authenticated e chama restore_church_member.
-- Fica retida em bloqueio físico em members de A.
-- Ao acordar pós-commit de A, lê membro com updated_at avançado para T1 e captura P0019.
do $exec_c1a_b$
declare
  v_err_code text;
  v_err_msg text;
  v_t0_str text;
  v_cmd_id uuid := '01300000-0000-4000-8000-000000000cb1'::uuid;
  v_attempts integer := 0;
  v_status_a text;
begin
  -- Aguarda sinal da Conexão A
  loop
    select step_status into v_status_a from app_private.rehearsal_coordination where session_role = 'session_a_013';
    if v_status_a = 'holding_c1a' then
      exit;
    end if;
    v_attempts := v_attempts + 1;
    if v_attempts > 100 then
      raise exception 'C1.A TIMEOUT: Conexão A não sinalizou holding_c1a em 10s.';
    end if;
    perform pg_sleep(0.1);
  end loop;

  -- Sincronização via advisory gate: garante que A já travou a linha antes de B chamar a RPC
  perform pg_advisory_lock(hashtext('gate_c1a'));
  perform pg_advisory_unlock(hashtext('gate_c1a'));

  update app_private.rehearsal_coordination
  set step_status = 'calling_c1a', last_step = 'c1a'
  where session_role = 'session_b_013';

  -- Lê a revisão original T0 antes de assumir o papel authenticated
  select to_char(m.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') into v_t0_str
  from app_private.members m
  where m.id = '01300000-0000-4000-8000-0000000000d1';

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', '01300000-0000-4000-8000-0000000000a1', true);

  begin
    perform public.restore_church_member(
      '01300000-0000-4000-8000-0000000000c1'::uuid,
      v_cmd_id,
      '01300000-0000-4000-8000-0000000000d1'::uuid,
      v_t0_str
    );

    execute 'reset role';
    update app_private.rehearsal_coordination
    set step_status = 'error_c1a', last_error = 'C1.A esperava erro P0019, mas RPC sucedeu indevidamente'
    where session_role = 'session_b_013';
    raise exception 'C1.A FALHA EM B: Esperado erro P0019 de conflito de revisão.';
  exception when others then
    get stacked diagnostics v_err_code = returned_sqlstate, v_err_msg = message_text;
    execute 'reset role';

    if v_err_code = 'P0019' then
      update app_private.rehearsal_coordination
      set step_status = 'completed_c1a',
          result_payload = jsonb_build_object('sqlstate', v_err_code, 'message', v_err_msg)
      where session_role = 'session_b_013';
      raise notice 'B1.A CONCLUÍDO COM SUCESSO: P0019 capturado conforme contrato ("%").', v_err_msg;
    else
      update app_private.rehearsal_coordination
      set step_status = 'error_c1a', last_error = format('SQLSTATE inesperado: %s (%s)', v_err_code, v_err_msg)
      where session_role = 'session_b_013';
      raise exception 'C1.A FALHA EM B: Esperado P0019, obtido %: %', v_err_code, v_err_msg;
    end if;
  end;
end;
$exec_c1a_b$;

-- ============================================================================
-- CENÁRIO E17 / C1.B.1: Concessão Concorrente de Acesso Ativo (Sem Linha Prévia)
-- ============================================================================
do $exec_c1b1_b$
declare
  v_err_code text;
  v_err_msg text;
  v_t0_str text;
  v_cmd_id uuid := '01300000-0000-4000-8000-000000000cb2'::uuid;
  v_attempts integer := 0;
  v_status_a text;
begin
  loop
    select step_status into v_status_a from app_private.rehearsal_coordination where session_role = 'session_a_013';
    if v_status_a = 'holding_c1b1' then
      exit;
    end if;
    v_attempts := v_attempts + 1;
    if v_attempts > 100 then
      raise exception 'C1.B.1 TIMEOUT: Conexão A não sinalizou holding_c1b1 em 10s.';
    end if;
    perform pg_sleep(0.1);
  end loop;

  -- Sincronização via advisory gate: garante que A já travou o membro antes de B chamar a RPC
  perform pg_advisory_lock(hashtext('gate_c1b1'));
  perform pg_advisory_unlock(hashtext('gate_c1b1'));

  update app_private.rehearsal_coordination
  set step_status = 'calling_c1b1', last_step = 'c1b1'
  where session_role = 'session_b_013';

  select to_char(m.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') into v_t0_str
  from app_private.members m
  where m.id = '01300000-0000-4000-8000-0000000000d2';

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', '01300000-0000-4000-8000-0000000000a1', true);

  begin
    perform public.restore_church_member(
      '01300000-0000-4000-8000-0000000000c1'::uuid,
      v_cmd_id,
      '01300000-0000-4000-8000-0000000000d2'::uuid,
      v_t0_str
    );

    execute 'reset role';
    update app_private.rehearsal_coordination
    set step_status = 'error_c1b1', last_error = 'C1.B.1 esperava erro P0018, mas RPC sucedeu indevidamente'
    where session_role = 'session_b_013';
    raise exception 'C1.B.1 FALHA EM B: Esperado erro P0018 de vínculo legado ativo.';
  exception when others then
    get stacked diagnostics v_err_code = returned_sqlstate, v_err_msg = message_text;
    execute 'reset role';

    if v_err_code = 'P0018' then
      update app_private.rehearsal_coordination
      set step_status = 'completed_c1b1',
          result_payload = jsonb_build_object('sqlstate', v_err_code, 'message', v_err_msg)
      where session_role = 'session_b_013';
      raise notice 'B1.B.1 CONCLUÍDO COM SUCESSO: P0018 capturado conforme contrato ("%").', v_err_msg;
    else
      update app_private.rehearsal_coordination
      set step_status = 'error_c1b1', last_error = format('SQLSTATE inesperado: %s (%s)', v_err_code, v_err_msg)
      where session_role = 'session_b_013';
      raise exception 'C1.B.1 FALHA EM B: Esperado P0018, obtido %: %', v_err_code, v_err_msg;
    end if;
  end;
end;
$exec_c1b1_b$;

-- ============================================================================
-- CENÁRIO E17 / C1.B.2: Concessão Concorrente de Acesso Ativo (Com Linha Revoked)
-- ============================================================================
do $exec_c1b2_b$
declare
  v_err_code text;
  v_err_msg text;
  v_t0_str text;
  v_cmd_id uuid := '01300000-0000-4000-8000-000000000cb3'::uuid;
  v_attempts integer := 0;
  v_status_a text;
begin
  loop
    select step_status into v_status_a from app_private.rehearsal_coordination where session_role = 'session_a_013';
    if v_status_a = 'holding_c1b2' then
      exit;
    end if;
    v_attempts := v_attempts + 1;
    if v_attempts > 100 then
      raise exception 'C1.B.2 TIMEOUT: Conexão A não sinalizou holding_c1b2 em 10s.';
    end if;
    perform pg_sleep(0.1);
  end loop;

  -- Sincronização via advisory gate: garante que A já travou a linha de access antes de B chamar a RPC
  perform pg_advisory_lock(hashtext('gate_c1b2'));
  perform pg_advisory_unlock(hashtext('gate_c1b2'));

  update app_private.rehearsal_coordination
  set step_status = 'calling_c1b2', last_step = 'c1b2'
  where session_role = 'session_b_013';

  select to_char(m.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') into v_t0_str
  from app_private.members m
  where m.id = '01300000-0000-4000-8000-0000000000d3';

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', '01300000-0000-4000-8000-0000000000a1', true);

  begin
    perform public.restore_church_member(
      '01300000-0000-4000-8000-0000000000c1'::uuid,
      v_cmd_id,
      '01300000-0000-4000-8000-0000000000d3'::uuid,
      v_t0_str
    );

    execute 'reset role';
    update app_private.rehearsal_coordination
    set step_status = 'error_c1b2', last_error = 'C1.B.2 esperava erro P0018, mas RPC sucedeu indevidamente'
    where session_role = 'session_b_013';
    raise exception 'C1.B.2 FALHA EM B: Esperado erro P0018 de vínculo legado ativo.';
  exception when others then
    get stacked diagnostics v_err_code = returned_sqlstate, v_err_msg = message_text;
    execute 'reset role';

    if v_err_code = 'P0018' then
      update app_private.rehearsal_coordination
      set step_status = 'completed_c1b2',
          result_payload = jsonb_build_object('sqlstate', v_err_code, 'message', v_err_msg)
      where session_role = 'session_b_013';
      raise notice 'B1.B.2 CONCLUÍDO COM SUCESSO: P0018 capturado conforme contrato ("%").', v_err_msg;
    else
      update app_private.rehearsal_coordination
      set step_status = 'error_c1b2', last_error = format('SQLSTATE inesperado: %s (%s)', v_err_code, v_err_msg)
      where session_role = 'session_b_013';
      raise exception 'C1.B.2 FALHA EM B: Esperado P0018, obtido %: %', v_err_code, v_err_msg;
    end if;
  end;
end;
$exec_c1b2_b$;

-- ============================================================================
-- CENÁRIO C2: Perda de Autorização Administrativa Durante a Espera
-- ============================================================================
do $exec_c2_b$
declare
  v_err_code text;
  v_err_msg text;
  v_t0_str text;
  v_cmd_id uuid := '01300000-0000-4000-8000-000000000cb4'::uuid;
  v_attempts integer := 0;
  v_status_a text;
begin
  loop
    select step_status into v_status_a from app_private.rehearsal_coordination where session_role = 'session_a_013';
    if v_status_a = 'holding_c2' then
      exit;
    end if;
    v_attempts := v_attempts + 1;
    if v_attempts > 100 then
      raise exception 'C2 TIMEOUT: Conexão A não sinalizou holding_c2 em 10s.';
    end if;
    perform pg_sleep(0.1);
  end loop;

  -- Sincronização via advisory gate: garante que A já revogou o acesso antes de B chamar a RPC
  perform pg_advisory_lock(hashtext('gate_c2'));
  perform pg_advisory_unlock(hashtext('gate_c2'));

  update app_private.rehearsal_coordination
  set step_status = 'calling_c2', last_step = 'c2'
  where session_role = 'session_b_013';

  select to_char(m.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') into v_t0_str
  from app_private.members m
  where m.id = '01300000-0000-4000-8000-0000000000d4';

  execute 'set local role authenticated';
  -- Conexão B atua como Admin B (01300000-0000-4000-8000-0000000000a2)
  perform set_config('request.jwt.claim.sub', '01300000-0000-4000-8000-0000000000a2', true);

  begin
    perform public.restore_church_member(
      '01300000-0000-4000-8000-0000000000c1'::uuid,
      v_cmd_id,
      '01300000-0000-4000-8000-0000000000d4'::uuid,
      v_t0_str
    );

    execute 'reset role';
    update app_private.rehearsal_coordination
    set step_status = 'error_c2', last_error = 'C2 esperava erro 42501, mas RPC sucedeu indevidamente'
    where session_role = 'session_b_013';
    raise exception 'C2 FALHA EM B: Esperado erro 42501 de acesso não autorizado.';
  exception when others then
    get stacked diagnostics v_err_code = returned_sqlstate, v_err_msg = message_text;
    execute 'reset role';

    if v_err_code = '42501' then
      update app_private.rehearsal_coordination
      set step_status = 'completed_c2',
          result_payload = jsonb_build_object('sqlstate', v_err_code, 'message', v_err_msg)
      where session_role = 'session_b_013';
      raise notice 'B2 CONCLUÍDO COM SUCESSO: 42501 capturado conforme contrato ("%").', v_err_msg;
    else
      update app_private.rehearsal_coordination
      set step_status = 'error_c2', last_error = format('SQLSTATE inesperado: %s (%s)', v_err_code, v_err_msg)
      where session_role = 'session_b_013';
      raise exception 'C2 FALHA EM B: Esperado 42501, obtido %: %', v_err_code, v_err_msg;
    end if;
  end;
end;
$exec_c2_b$;

-- ============================================================================
-- CENÁRIO C3: Replay Simultâneo do Mesmo Comando com Advisory Lock
-- ============================================================================
-- Passo B3: Conexão B chama restore_church_member com o MESMO command_id de A.
-- Fica retida no advisory lock mantido por A.
-- Ao acordar pós-commit de A, localiza o recibo comitado, valida params_hash e
-- retorna replay idêntico com as 6 colunas reais sem reexecutar mutação.
do $exec_c3_b$
declare
  v_rec record;
  v_receipt record;
  v_t0_str text;
  v_cmd_id uuid := '01300000-0000-4000-8000-000000000cc3'::uuid;
  v_attempts integer := 0;
  v_status_a text;
begin
  loop
    select step_status into v_status_a from app_private.rehearsal_coordination where session_role = 'session_a_013';
    if v_status_a = 'holding_c3' then
      exit;
    end if;
    v_attempts := v_attempts + 1;
    if v_attempts > 100 then
      raise exception 'C3 TIMEOUT: Conexão A não sinalizou holding_c3 em 10s.';
    end if;
    perform pg_sleep(0.1);
  end loop;

  -- Lê a revisão pré-capturada e comutada por A sob papel de manutenção
  select result_payload->>'c3_t0_str' into v_t0_str
  from app_private.rehearsal_coordination where session_role = 'session_a_013';

  if v_t0_str is null then
    select to_char(m.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') into v_t0_str
    from app_private.members m
    where m.id = '01300000-0000-4000-8000-0000000000d5';
  end if;

  -- Sincronização via advisory gate: garante que A já detém o advisory lock do comando antes de B chamar a RPC
  perform pg_advisory_lock(hashtext('gate_c3'));
  perform pg_advisory_unlock(hashtext('gate_c3'));

  update app_private.rehearsal_coordination
  set step_status = 'waiting_c3', last_step = 'c3'
  where session_role = 'session_b_013';

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', '01300000-0000-4000-8000-0000000000a1', true);

  -- 1. Executa chamada concorrente (bloqueia no advisory lock e desbloqueia após commit de A, retornando o recibo de A)
  select * into v_rec
  from public.restore_church_member(
    '01300000-0000-4000-8000-0000000000c1'::uuid,
    v_cmd_id,
    '01300000-0000-4000-8000-0000000000d5'::uuid,
    v_t0_str
  );

  -- Contrato real: no replay idêntico, todas as 6 colunas reais devem ser retornadas
  if v_rec.command_id is distinct from v_cmd_id
     or v_rec.action is distinct from 'restore_member'
     or v_rec.church_id is distinct from '01300000-0000-4000-8000-0000000000c1'::uuid
     or v_rec.result_member_id is distinct from '01300000-0000-4000-8000-0000000000d5'::uuid
     or (v_rec.result_payload->>'status') is distinct from 'active'
     or (v_rec.result_payload->>'restored_at') is null
     or (v_rec.result_payload->>'updated_at') is null
     or v_rec.created_at is null then
    execute 'reset role';
    update app_private.rehearsal_coordination
    set step_status = 'error_c3', last_error = format('Replay retornou campos divergentes do contrato real de 6 colunas: %s', row_to_json(v_rec))
    where session_role = 'session_b_013';
    raise exception 'C3 FALHA EM B: Replay deve retornar todas as 6 colunas do recibo com status active e timestamps.';
  end if;

  -- 2. Consulta formal via endpoint get_member_lifecycle_receipt
  select * into v_receipt
  from public.get_member_lifecycle_receipt(v_cmd_id);

  execute 'reset role';

  if v_receipt.command_id is distinct from v_cmd_id
     or v_receipt.action is distinct from 'restore_member'
     or v_receipt.church_id is distinct from '01300000-0000-4000-8000-0000000000c1'::uuid
     or v_receipt.result_member_id is distinct from '01300000-0000-4000-8000-0000000000d5'::uuid
     or (v_receipt.result_payload->>'status') is distinct from 'active'
     or (v_receipt.result_payload->>'restored_at') is distinct from (v_rec.result_payload->>'restored_at')
     or v_receipt.created_at is distinct from v_rec.created_at then
    update app_private.rehearsal_coordination
    set step_status = 'error_c3', last_error = 'Endpoint get_member_lifecycle_receipt divergiu do retorno da RPC'
    where session_role = 'session_b_013';
    raise exception 'C3 FALHA EM B: get_member_lifecycle_receipt divergiu da RPC de restauração.';
  end if;

  -- Grava as 6 colunas reais e os timestamps no payload de coordenação (sem campos fictícios como applied_at ou is_replay)
  update app_private.rehearsal_coordination
  set step_status = 'completed_c3',
      result_payload = jsonb_build_object(
        'command_id', v_rec.command_id,
        'action', v_rec.action,
        'church_id', v_rec.church_id,
        'result_member_id', v_rec.result_member_id,
        'result_payload', v_rec.result_payload,
        'created_at', to_char(v_rec.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
      )
  where session_role = 'session_b_013';

  raise notice 'B3 CONCLUÍDO COM SUCESSO: Replay idêntico validado pós-espera de advisory lock.';
end;
$exec_c3_b$;
