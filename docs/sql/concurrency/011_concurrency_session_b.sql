-- ============================================================================
-- Escala do Reino — Ensaio de Concorrência Real: Conexão B (Sessão 2)
-- ============================================================================
-- Executar em uma segunda conexão independente (Terminal 2 / psql Conexão B).
-- Demonstra a entrada em espera observável na fila de locks do PostgreSQL,
-- seguida de desbloqueio, captura de resultados e asserções estritas dos desfechos.
-- ============================================================================

-- GUARDA ANTECIPADA: Bloqueio estrito contra execução em piloto, produção ou base compartilhada
do $guard_target$
begin
  if current_database() in ('postgres', 'template1') or current_database() ~* 'prod|pilot|jvpctgqudvjealzileib' then
    raise exception 'EXECUÇÃO ABORTADA: Base inválida ou potencialmente compartilhada/remota: %', current_database();
  end if;
  if current_database() <> 'escala_rehearsal_tmp' then
    raise exception 'EXECUÇÃO ABORTADA: O ensaio de concorrência exige base efêmera dedicada "escala_rehearsal_tmp". Base atual: %', current_database();
  end if;
end;
$guard_target$;

-- REGISTRO DE IDENTIDADE DA SESSÃO B
insert into app_private.rehearsal_coordination (session_role, pid, step_status, last_step)
values ('session_b', pg_backend_pid(), 'ready', 'init')
on conflict (session_role) do update
set pid = excluded.pid, step_status = 'ready', last_step = 'init', registered_at = clock_timestamp();

-- ============================================================================
-- TESTE C1: Segunda Chamada Concorrente de Mesmo Comando
-- Cenário TC-INV-RACE-03
-- ============================================================================

-- Passo B1.1: Conexão B executa chamada com mesmo command_id
-- Fica BLOQUEADA na fila aguardando a Conexão A comitar.
-- Ao desbloquear, valida ativamente replay com raw_token nulo na RPC de emissão
-- e consulta get_invitation_command_receipt para comprovar link_unrecoverable = true.
do $exec_c1_b$
declare
  v_rec record;
  v_receipt record;
begin
  update app_private.rehearsal_coordination
  set step_status = 'waiting_c1', last_step = 'c1'
  where session_role = 'session_b';

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);

  -- 1. Executa chamada concorrente de emissão (desbloqueia após commit de A)
  select * into v_rec
  from public.issue_church_invitation(
    '11111111-1111-1111-1111-111111111111'::uuid,
    '00000000-0000-0000-0000-0000000000c1'::uuid,
    '00000000-0000-0000-0000-0000000000d1'::uuid,
    'guest1_conc@example.test'
  );

  -- Contrato real de issue_church_invitation: no replay, raw_token deve ser nulo
  if v_rec.raw_token is not null or v_rec.invitation_id is null then
    execute 'reset role';
    update app_private.rehearsal_coordination
    set step_status = 'error_c1', last_error = 'Replay não retornou raw_token nulo ou invitation_id'
    where session_role = 'session_b';
    raise exception 'C1 FALHA EM B: Replay deve retornar raw_token nulo e invitation_id válido.';
  end if;

  -- 2. Consulta formal do recibo de comando para validar link_unrecoverable
  select * into v_receipt
  from public.get_invitation_command_receipt(
    '11111111-1111-1111-1111-111111111111'::uuid
  );

  execute 'reset role';

  if v_receipt.link_unrecoverable is not true or v_receipt.action <> 'issue_invitation' then
    update app_private.rehearsal_coordination
    set step_status = 'error_c1', last_error = 'Recibo de comando não confirmou link_unrecoverable true ou action issue_invitation'
    where session_role = 'session_b';
    raise exception 'C1 FALHA EM B: Recibo deve retornar link_unrecoverable true e action issue_invitation.';
  end if;

  update app_private.rehearsal_coordination
  set step_status = 'completed_c1',
      result_payload = jsonb_build_object(
        'invitation_id', v_rec.invitation_id,
        'link_unrecoverable', v_receipt.link_unrecoverable,
        'raw_token_null', (v_rec.raw_token is null),
        'receipt_action', v_receipt.action
      )
  where session_role = 'session_b';

  raise notice 'B1 CONCLUÍDO: Replay idêntico e recibo conferidos com sucesso (raw_token = null, link_unrecoverable = true).';
end;
$exec_c1_b$;

-- ============================================================================
-- TESTE C2: Resgate Concorrente vs. Reemissão
-- Cenário TC-INV-RACE-01
-- ============================================================================

-- Passo B2.1: Convidado 2 tenta resgatar convite enquanto reemissão ocorre em A
-- Fica BLOQUEADO na fila aguardando lock do membro.
-- Ao desbloquear após o commit de A, detecta revogação e captura P0002.
do $exec_c2_b$
declare
  v_err_code text;
  v_err_msg text;
begin
  update app_private.rehearsal_coordination
  set step_status = 'waiting_c2', last_step = 'c2'
  where session_role = 'session_b';

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b2', true);

  begin
    perform public.redeem_invitation_confirm_name(
      '44444444-4444-4444-4444-444444444444'::uuid,
      'token_conc_c2_exato_synthetic_43chars_abc12',
      'Membro Alvo C2'
    );
    execute 'reset role';
    update app_private.rehearsal_coordination
    set step_status = 'error_c2', last_error = 'Resgate deveria ter sido rejeitado com P0002'
    where session_role = 'session_b';
    raise exception 'C2 FALHA EM B: Resgate com convite revogado deveria ter abortado com P0002.';
  exception when sqlstate 'P0002' then
    get stacked diagnostics v_err_code = returned_sqlstate, v_err_msg = message_text;
    execute 'reset role';
    update app_private.rehearsal_coordination
    set step_status = 'completed_c2',
        result_payload = jsonb_build_object('sqlstate', v_err_code, 'message', v_err_msg)
    where session_role = 'session_b';
    raise notice 'B2 CONCLUÍDO: Exceção esperada P0002 capturada com sucesso ("%").', v_err_msg;
  end;
end;
$exec_c2_b$;

-- ============================================================================
-- TESTE C3: Segunda Decisão Concorrente na Mesma Solicitação
-- Cenário TC-INV-RACE-02
-- ============================================================================

-- Passo B3.1: Admin 2 tenta decidir solicitação enquanto A decide
-- Fica BLOQUEADO na fila aguardando lock.
-- Ao desbloquear após o commit de A, detecta status != pending e captura 23505.
do $exec_c3_b$
declare
  v_err_code text;
  v_err_msg text;
begin
  update app_private.rehearsal_coordination
  set step_status = 'waiting_c3', last_step = 'c3'
  where session_role = 'session_b';

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);

  begin
    perform public.decide_access_request(
      '55555555-5555-5555-5555-555555555555'::uuid,
      '00000000-0000-0000-0000-0000000000c1'::uuid,
      '00000000-0000-0000-0000-0000000000f3'::uuid,
      'reject'
    );
    execute 'reset role';
    update app_private.rehearsal_coordination
    set step_status = 'error_c3', last_error = 'Segunda decisão deveria ter falhado com 23505'
    where session_role = 'session_b';
    raise exception 'C3 FALHA EM B: Segunda decisão deveria abortar com 23505.';
  exception when sqlstate '23505' then
    get stacked diagnostics v_err_code = returned_sqlstate, v_err_msg = message_text;
    execute 'reset role';
    update app_private.rehearsal_coordination
    set step_status = 'completed_c3',
        result_payload = jsonb_build_object('sqlstate', v_err_code, 'message', v_err_msg)
    where session_role = 'session_b';
    raise notice 'B3 CONCLUÍDO: Exceção esperada 23505 capturada com sucesso ("%").', v_err_msg;
  end;
end;
$exec_c3_b$;

-- ============================================================================
-- TESTE C4: Decisão Concorrente com Vencimento do Prazo na Fila
-- Cenário TC-INV-RACE-05
-- ============================================================================

-- Passo B4.1: Admin 2 tenta aprovar a solicitação C4 enquanto A segura o lock
-- Fica BLOQUEADO na fila até que a Conexão A cruze o prazo e execute ROLLBACK.
-- Ao desbloquear, a verificação temporal pós-lock detecta expiração e retorna REQUEST_EXPIRED.
do $exec_c4_b$
declare
  v_rec record;
begin
  update app_private.rehearsal_coordination
  set step_status = 'waiting_c4', last_step = 'c4'
  where session_role = 'session_b';

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);

  select * into v_rec
  from public.decide_access_request(
    '66666666-6666-6666-6666-666666666666'::uuid,
    '00000000-0000-0000-0000-0000000000c1'::uuid,
    '00000000-0000-0000-0000-0000000000f4'::uuid,
    'approve'
  );

  execute 'reset role';

  if v_rec.decision is distinct from 'expired'
     or v_rec.access_granted is not false
     or v_rec.error_code is distinct from 'REQUEST_EXPIRED' then
    update app_private.rehearsal_coordination
    set step_status = 'error_c4',
        last_error = format('Resultado inesperado: decision=%s, access_granted=%s, error_code=%s', v_rec.decision, v_rec.access_granted, v_rec.error_code)
    where session_role = 'session_b';
    raise exception 'C4 FALHA EM B: Retorno esperado decision=expired, access_granted=false, error_code=REQUEST_EXPIRED.';
  end if;

  update app_private.rehearsal_coordination
  set step_status = 'completed_c4',
      result_payload = jsonb_build_object(
        'decision', v_rec.decision,
        'access_granted', v_rec.access_granted,
        'error_code', v_rec.error_code
      )
  where session_role = 'session_b';

  raise notice 'B4 CONCLUÍDO: Solicitação finalizada com sucesso como expirada (REQUEST_EXPIRED).';
end;
$exec_c4_b$;
