-- ============================================================================
-- Escala do Reino — Ensaio de Concorrência Física: Conexão B (Sessão 2)
-- Incremento: 013 / 014 (Ciclo de Vida de Membros e Restauração Elegível)
-- ============================================================================
-- Executar em uma segunda conexão dedicada (Terminal 2 / psql Conexão B).
-- Demonstra a entrada em espera física comprovável na fila de locks do PostgreSQL,
-- seguida de desbloqueio determinístico pós-commit de A e captura estrita dos
-- desfechos esperados (P0019, P0018, 42501 e Replay Idêntico).
-- ============================================================================

-- GUARDA ANTECIPADA: Bloqueio estrito contra execução em piloto, produção ou base remota
do $guard_target$
begin
  if current_database() ~* 'prod|pilot|jvpctgqudvjealzileib' then
    raise exception 'EXECUÇÃO ABORTADA: Base inválida ou potencialmente compartilhada/remota: %', current_database();
  end if;
  if current_setting('server_encoding') <> 'UTF8' or current_setting('client_encoding') <> 'UTF8' then
    raise exception 'EXECUÇÃO ABORTADA: Conexão e banco precisam usar codificação UTF8.';
  end if;
end;
$guard_target$;

-- REGISTRO DE IDENTIDADE DA SESSÃO B
insert into app_private.rehearsal_coordination (session_role, pid, step_status, last_step)
values ('session_b_013', pg_backend_pid(), 'ready', 'init')
on conflict (session_role) do update
set pid = excluded.pid, step_status = 'ready', last_step = 'init', registered_at = clock_timestamp();

-- ============================================================================
-- CENÁRIO C1.A: Disputa Concorrente de Revisão (T0 -> T1) com Membro Inactive
-- ============================================================================
-- Passo B1.A: Conexão B chama restore_church_member com revisão T0.
-- Fica BLOQUEADA na fila aguardando liberação do lock de linha em members de A.
-- Ao acordar pós-commit de A, lê membro com updated_at avançado para T1 e captura P0019.
do $exec_c1a_b$
declare
  v_err_code text;
  v_err_msg text;
  v_t0_str text;
  v_cmd_id uuid := '01300000-0000-4000-8000-000000000cb1'::uuid;
begin
  -- Registra status de prontidão para o bloqueio
  update app_private.rehearsal_coordination
  set step_status = 'waiting_c1a', last_step = 'c1a'
  where session_role = 'session_b_013';

  -- Lê a revisão original T0 antes de disparar o bloqueio
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
-- Passo B1.B.1: Conexão B chama restore_church_member para o alvo C1.B.1.
-- Lookup em church_access não encontra linha. B entra em espera na fila de members.
-- Ao acordar pós-commit de A, executa a consulta de guarda (passo 4), enxerga
-- o vínculo ativo legado inserido por A e recusa com SQLSTATE P0018.
do $exec_c1b1_b$
declare
  v_err_code text;
  v_err_msg text;
  v_t0_str text;
  v_cmd_id uuid := '01300000-0000-4000-8000-000000000cb2'::uuid;
begin
  update app_private.rehearsal_coordination
  set step_status = 'waiting_c1b1', last_step = 'c1b1'
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
-- Passo B1.B.2: Conexão B chama restore_church_member para o alvo C1.B.2.
-- Bloqueia na linha de church_access mantida por A (na ordem canônica).
-- Ao acordar pós-commit de A, lê o acesso alterado para active e recusa com P0018.
do $exec_c1b2_b$
declare
  v_err_code text;
  v_err_msg text;
  v_t0_str text;
  v_cmd_id uuid := '01300000-0000-4000-8000-000000000cb3'::uuid;
begin
  update app_private.rehearsal_coordination
  set step_status = 'waiting_c1b2', last_step = 'c1b2'
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
-- Passo B2: Conexão B atua como Admin B (01300000-0000-4000-8000-0000000000a2).
-- Bloqueia na fila de members mantida por A. Enquanto B espera, A revoga o privilégio de B.
-- Ao acordar pós-commit de A, o passo 5 da RPC revalida autorização administrativa,
-- detecta vínculo revogado e aborta com SQLSTATE 42501.
do $exec_c2_b$
declare
  v_err_code text;
  v_err_msg text;
  v_t0_str text;
  v_cmd_id uuid := '01300000-0000-4000-8000-000000000cb4'::uuid;
begin
  update app_private.rehearsal_coordination
  set step_status = 'waiting_c2', last_step = 'c2'
  where session_role = 'session_b_013';

  select to_char(m.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') into v_t0_str
  from app_private.members m
  where m.id = '01300000-0000-4000-8000-0000000000d4';

  execute 'set local role authenticated';
  -- Conexão B atua como Admin B!
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
-- retorna replay idêntico sem reexecutar mutação.
do $exec_c3_b$
declare
  v_rec record;
  v_receipt record;
  v_t0_str text;
  v_cmd_id uuid := '01300000-0000-4000-8000-000000000cc3'::uuid;
begin
  update app_private.rehearsal_coordination
  set step_status = 'waiting_c3', last_step = 'c3'
  where session_role = 'session_b_013';

  select to_char(m.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') into v_t0_str
  from app_private.members m
  where m.id = '01300000-0000-4000-8000-0000000000d5';

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', '01300000-0000-4000-8000-0000000000a1', true);

  -- 1. Executa chamada concorrente (desbloqueia após commit de A e retorna o recibo gravado por A)
  select * into v_rec
  from public.restore_church_member(
    '01300000-0000-4000-8000-0000000000c1'::uuid,
    v_cmd_id,
    '01300000-0000-4000-8000-0000000000d5'::uuid,
    v_t0_str
  );

  -- Contrato real: no replay idêntico, command_id deve ser o mesmo e action deve ser restore_member
  if v_rec.command_id <> v_cmd_id or v_rec.action <> 'restore_member' then
    execute 'reset role';
    update app_private.rehearsal_coordination
    set step_status = 'error_c3', last_error = 'Replay não retornou o command_id exato ou action restore_member'
    where session_role = 'session_b_013';
    raise exception 'C3 FALHA EM B: Replay deve retornar dados válidos do recibo.';
  end if;

  -- 2. Consulta formal via endpoint get_member_lifecycle_receipt
  select * into v_receipt
  from public.get_member_lifecycle_receipt(v_cmd_id);

  execute 'reset role';

  if v_receipt.command_id <> v_cmd_id or v_receipt.action <> 'restore_member' then
    update app_private.rehearsal_coordination
    set step_status = 'error_c3', last_error = 'Endpoint get_member_lifecycle_receipt divergiu do esperado'
    where session_role = 'session_b_013';
    raise exception 'C3 FALHA EM B: get_member_lifecycle_receipt divergiu do esperado.';
  end if;

  update app_private.rehearsal_coordination
  set step_status = 'completed_c3',
      result_payload = jsonb_build_object(
        'command_id', v_rec.command_id,
        'action', v_rec.action,
        'result_member_id', v_rec.result_member_id,
        'result_payload', v_rec.result_payload
      )
  where session_role = 'session_b_013';

  raise notice 'B3 CONCLUÍDO COM SUCESSO: Replay idêntico validado pós-espera de advisory lock.';
end;
$exec_c3_b$;
