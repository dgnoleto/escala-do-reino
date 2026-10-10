  -- [CENÁRIO 21] Decisão em Solicitação Expirada (TC-INV-APPROVE-03)
  -- =========================================================================
  -- Simula convite consumido e solicitação que venceu no passado
  v_inv_id := gen_random_uuid();
  v_req_id := gen_random_uuid();

  insert into app_private.access_invitations (
    id, church_id, member_id, recipient_email, token_digest,
    issued_by_user_id, issued_at, expires_at, redeemed_at, redeemed_by_user_id
  ) values (
    v_inv_id, v_church_alpha, v_m_target_5, 'roberto_v3@example.test',
    pg_catalog.sha256('dummy_digest_bytes_v3_expirado'::bytea),
    v_admin_1, statement_timestamp() - interval '73 hours', statement_timestamp() - interval '1 hour',
    statement_timestamp() - interval '70 hours', v_guest_wrong
  );

  insert into app_private.access_requests (
    id, church_id, member_id, invitation_id, requester_user_id,
    original_display_name, proposed_display_name, submitted_at, expires_at, status
  ) values (
    v_req_id, v_church_alpha, v_m_target_5, v_inv_id, v_guest_wrong,
    'Roberto Souza', 'Roberto Expirado',
    statement_timestamp() - interval '70 hours', statement_timestamp() - interval '1 hour',
    'pending'
  );

  -- Admin tenta aprovar solicitação cujo prazo de 72h já transcorreu
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_admin_1::text, true);
  v_cmd_id := gen_random_uuid();
  v_decision := null;
  v_access_granted := null;
  v_err_code := null;

  select decision, access_granted, error_code
  into v_decision, v_access_granted, v_err_code
  from public.decide_access_request(
    v_cmd_id,
    v_church_alpha,
    v_req_id,
    'approve'
  );

  if v_decision is distinct from 'expired' or v_access_granted is not false or v_err_code is distinct from 'REQUEST_EXPIRED' then
    raise exception 'Falha TC-INV-APPROVE-03: decisão sobre solicitação expirada não retornou REQUEST_EXPIRED estruturado';
  end if;

  -- Inspeciona pelo operador: status persistido expired no banco
  execute 'reset role';
  if not exists (
    select 1 from app_private.access_requests
    where id = v_req_id and status = 'expired'
  ) then
    raise exception 'Falha TC-INV-APPROVE-03: solicitação não foi persistida como expired';
  end if;

  -- =========================================================================
  -- [CENÁRIO 22] Proibição Estrita de Bypass de Revogação
  -- =========================================================================
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_admin_1::text, true);
  begin
    perform public.issue_church_invitation(
      gen_random_uuid(),
      v_church_alpha,
      v_m_revoked,
      'revoked@example.test'
    );
    raise exception 'Falha: emissão de convite não deve permitir bypass de vínculo revogado';
  exception when insufficient_privilege then null; end;

  -- =========================================================================
  -- [CENÁRIO 23] Múltiplos Vínculos (M60)
  -- =========================================================================
  -- Usuário Beta é administrador na Igreja Beta.
  -- Recebe convite para Membro 5 na Igreja Alpha.
  v_cmd_id := gen_random_uuid();
  select raw_token into v_raw_token
  from public.issue_church_invitation(
    v_cmd_id,
    v_church_alpha,
    v_m_target_5,
    'admin_beta_' || v_user_beta::text || '@example.test'
  );

  -- Usuário Beta resgata convite na Igreja Alpha
  perform set_config('request.jwt.claim.sub', v_user_beta::text, true);
  v_cmd_id := gen_random_uuid();
  perform public.redeem_invitation_confirm_name(
    v_cmd_id,
    v_raw_token,
    'Roberto Souza'
  );

  execute 'reset role';
  -- Confere que em Alpha é membro básico (is_admin = false)
  if not exists (
    select 1 from app_private.church_access
    where church_id = v_church_alpha and user_id = v_user_beta and is_admin = false and status = 'active'
  ) then
    raise exception 'Falha M60: acesso em Alpha deveria ser básico';
  end if;

  -- Confere que sua administração em Beta permanece perfeitamente intacta (is_admin = true)
  if not exists (
    select 1 from app_private.church_access
    where church_id = v_church_beta and user_id = v_user_beta and is_admin = true and status = 'active'
  ) then
    raise exception 'Falha M60: administração em Beta foi corrompida';
  end if;

  -- =========================================================================

  -- =========================================================================
  -- [CENÁRIO 24] Falhas Forçadas de Auditoria e Recibo com Rollback Atômico Completo (Priority 4)
  -- =========================================================================
  execute 'reset role';

  -- Cria gatilhos parametrizáveis por sessão para forçar erro em ações específicas
  create or replace function app_private.fail_test_trigger_audit()
  returns trigger language plpgsql as $t$
  begin
    if NEW.action = current_setting('app.fail_audit_action', true) then
      raise exception 'Simulação de falha forçada em audit_entries: %', NEW.action using errcode = 'XX000';
    end if;
    return NEW;
  end;
  $t$;

  create or replace trigger test_fail_audit
  before insert on app_private.audit_entries
  for each row execute function app_private.fail_test_trigger_audit();

  create or replace function app_private.fail_test_trigger_receipt()
  returns trigger language plpgsql as $t$
  begin
    if NEW.action = current_setting('app.fail_receipt_action', true) then
      raise exception 'Simulação de falha forçada em command_receipts: %', NEW.action using errcode = 'XX000';
    end if;
    return NEW;
  end;
  $t$;

  create or replace trigger test_fail_receipt
  before insert on app_private.command_receipts
  for each row execute function app_private.fail_test_trigger_receipt();

  -- 24.1: Falha em Emissão de Convite
  -- 24.1.A: Auditoria
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_admin_1::text, true);
  perform set_config('app.fail_audit_action', c_audit_issue, true);
  perform set_config('app.fail_receipt_action', '', true);
  v_cmd_id := gen_random_uuid();
  v_caught_error := false;
  begin
    perform public.issue_church_invitation(v_cmd_id, v_church_alpha, v_m_target_fail_audit, 'fail_audit_1@example.test');
  exception when internal_error then
    get stacked diagnostics v_err_msg = message_text;
    if v_err_msg ~* 'Simulação de falha forçada' then
      v_caught_error := true;
    else
      raise;
    end if;
  end;
  if not v_caught_error then
    raise exception 'Falha 24.1.A: emissão deveria abortar por falha em audit_entries';
  end if;

  execute 'reset role';
  if exists (select 1 from app_private.access_invitations where church_id = v_church_alpha and member_id = v_m_target_fail_audit)
     or exists (select 1 from app_private.command_receipts where command_id = v_cmd_id) then
    raise exception 'Falha 24.1.A: efeitos de emissão não sofreram rollback após erro de auditoria';
  end if;

  -- 24.1.B: Recibo
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_admin_1::text, true);
  perform set_config('app.fail_audit_action', '', true);
  perform set_config('app.fail_receipt_action', c_receipt_issue, true);
  v_cmd_id := gen_random_uuid();
  v_caught_error := false;
  begin
    perform public.issue_church_invitation(v_cmd_id, v_church_alpha, v_m_target_fail_audit, 'fail_receipt_1@example.test');
  exception when internal_error then
    get stacked diagnostics v_err_msg = message_text;
    if v_err_msg ~* 'Simulação de falha forçada' then
      v_caught_error := true;
    else
      raise;
    end if;
  end;
  if not v_caught_error then
    raise exception 'Falha 24.1.B: emissão deveria abortar por falha em command_receipts';
  end if;

  execute 'reset role';
  if exists (select 1 from app_private.access_invitations where church_id = v_church_alpha and member_id = v_m_target_fail_audit)
     or exists (select 1 from app_private.audit_entries where church_id = v_church_alpha and target_id = v_m_target_fail_audit) then
    raise exception 'Falha 24.1.B: efeitos de emissão não sofreram rollback após erro de recibo';
  end if;

  -- 24.2: Falha em Reemissão de Convite
  declare
    v_m_reissue_fail uuid := gen_random_uuid();
    v_inv_open_fail uuid := gen_random_uuid();
    v_u_guest_fail uuid := gen_random_uuid();
    v_raw_tok_fail text;
  begin
    insert into app_private.members (id, church_id, display_name, status, created_by_user_id)
    values (v_m_reissue_fail, v_church_alpha, 'Membro Reemissao Falha', 'active', v_admin_1);

    insert into app_private.access_invitations (
      id, church_id, member_id, recipient_email, token_digest, issued_by_user_id, issued_at, expires_at
    ) values (
      v_inv_open_fail, v_church_alpha, v_m_reissue_fail, 'reissue_open@example.test',
      pg_catalog.sha256('dummy_digest_reissue_fail_bytes'::bytea), v_admin_1,
      statement_timestamp(), statement_timestamp() + interval '72 hours'
    );

    execute 'set local role authenticated';
    perform set_config('request.jwt.claim.sub', v_admin_1::text, true);
    perform set_config('app.fail_audit_action', '', true);
    perform set_config('app.fail_receipt_action', c_receipt_issue, true);
    v_cmd_id := gen_random_uuid();
    v_caught_error := false;
    begin
      perform public.issue_church_invitation(v_cmd_id, v_church_alpha, v_m_reissue_fail, 'reissue_new@example.test');
    exception when internal_error then
      get stacked diagnostics v_err_msg = message_text;
      if v_err_msg ~* 'Simulação de falha forçada' then
        v_caught_error := true;
      else
        raise;
      end if;
    end;
    if not v_caught_error then
      raise exception 'Falha 24.2: reemissão deveria abortar por falha de recibo';
    end if;

    execute 'reset role';

    -- Convite original NÃO pode ter sido revogado no banco
    if not exists (
      select 1 from app_private.access_invitations
      where id = v_inv_open_fail and revoked_at is null
    ) then
      raise exception 'Falha 24.2: convite original foi indevidamente revogado apesar do abort da reemissão';
    end if;

    -- 24.3: Falha em Confirmação de Nome (redeem_invitation_confirm_name)
    insert into auth.users (id, email, email_confirmed_at)
    values (v_u_guest_fail, 'guest_fail_' || v_u_guest_fail::text || '@example.test', statement_timestamp());

    execute 'set local role authenticated';
    perform set_config('request.jwt.claim.sub', v_admin_1::text, true);
    perform set_config('app.fail_audit_action', '', true);
    perform set_config('app.fail_receipt_action', '', true);
    v_cmd_id := gen_random_uuid();
    select raw_token into v_raw_tok_fail
    from public.issue_church_invitation(v_cmd_id, v_church_alpha, v_m_reissue_fail, 'guest_fail_' || v_u_guest_fail::text || '@example.test');

    perform set_config('request.jwt.claim.sub', v_u_guest_fail::text, true);
    perform set_config('app.fail_audit_action', c_audit_redeem_confirm, true);
    perform set_config('app.fail_receipt_action', '', true);
    v_cmd_id := gen_random_uuid();
    v_caught_error := false;
    begin
      perform public.redeem_invitation_confirm_name(v_cmd_id, v_raw_tok_fail, 'Membro Reemissao Falha');
    exception when internal_error then
      get stacked diagnostics v_err_msg = message_text;
      if v_err_msg ~* 'Simulação de falha forçada' then
        v_caught_error := true;
      else
        raise;
      end if;
    end;
    if not v_caught_error then
      raise exception 'Falha 24.3.A: confirmação deveria abortar por falha em auditoria';
    end if;

    execute 'reset role';
    if exists (select 1 from app_private.church_access where user_id = v_u_guest_fail and church_id = v_church_alpha)
       or exists (select 1 from app_private.access_invitations where member_id = v_m_reissue_fail and redeemed_at is not null) then
      raise exception 'Falha 24.3.A: confirmação com falha de auditoria gerou efeitos indevidos';
    end if;

    execute 'set local role authenticated';
    perform set_config('request.jwt.claim.sub', v_u_guest_fail::text, true);
    perform set_config('app.fail_audit_action', '', true);
    perform set_config('app.fail_receipt_action', c_receipt_redeem_confirm, true);
    v_cmd_id := gen_random_uuid();
    v_caught_error := false;
    begin
      perform public.redeem_invitation_confirm_name(v_cmd_id, v_raw_tok_fail, 'Membro Reemissao Falha');
    exception when internal_error then
      get stacked diagnostics v_err_msg = message_text;
      if v_err_msg ~* 'Simulação de falha forçada' then
        v_caught_error := true;
      else
        raise;
      end if;
    end;
    if not v_caught_error then
      raise exception 'Falha 24.3.B: confirmação deveria abortar por falha em recibo';
    end if;

    execute 'reset role';
    if exists (select 1 from app_private.church_access where user_id = v_u_guest_fail and church_id = v_church_alpha)
       or exists (select 1 from app_private.access_invitations where member_id = v_m_reissue_fail and redeemed_at is not null) then
      raise exception 'Falha 24.3.B: confirmação com falha de recibo gerou efeitos indevidos';
    end if;

    -- 24.4: Falha em Proposta de Nome (redeem_invitation_propose_name)
    execute 'set local role authenticated';
    perform set_config('request.jwt.claim.sub', v_u_guest_fail::text, true);
    perform set_config('app.fail_audit_action', c_audit_redeem_propose, true);
    perform set_config('app.fail_receipt_action', '', true);
    v_cmd_id := gen_random_uuid();
    v_caught_error := false;
    begin
      perform public.redeem_invitation_propose_name(v_cmd_id, v_raw_tok_fail, 'Nome Proposto Falha');
    exception when internal_error then
      get stacked diagnostics v_err_msg = message_text;
      if v_err_msg ~* 'Simulação de falha forçada' then
        v_caught_error := true;
      else
        raise;
      end if;
    end;
    if not v_caught_error then
      raise exception 'Falha 24.4.A: proposta deveria abortar por falha em auditoria';
    end if;

    execute 'reset role';
    if exists (select 1 from app_private.access_requests where member_id = v_m_reissue_fail) then
      raise exception 'Falha 24.4.A: proposta com falha de auditoria inseriu access_requests';
    end if;

    execute 'set local role authenticated';
    perform set_config('request.jwt.claim.sub', v_u_guest_fail::text, true);
    perform set_config('app.fail_audit_action', '', true);
    perform set_config('app.fail_receipt_action', c_receipt_redeem_propose, true);
    v_cmd_id := gen_random_uuid();
    v_caught_error := false;
    begin
      perform public.redeem_invitation_propose_name(v_cmd_id, v_raw_tok_fail, 'Nome Proposto Falha');
    exception when internal_error then
      get stacked diagnostics v_err_msg = message_text;
      if v_err_msg ~* 'Simulação de falha forçada' then
        v_caught_error := true;
      else
        raise;
      end if;
    end;
    if not v_caught_error then
      raise exception 'Falha 24.4.B: proposta deveria abortar por falha em recibo';
    end if;

    execute 'reset role';
    if exists (select 1 from app_private.access_requests where member_id = v_m_reissue_fail) then
      raise exception 'Falha 24.4.B: proposta com falha de recibo inseriu access_requests';
    end if;

    -- Conclui a proposta de nome com sucesso para testar aprovação/rejeição
    execute 'set local role authenticated';
    perform set_config('request.jwt.claim.sub', v_u_guest_fail::text, true);
    perform set_config('app.fail_audit_action', '', true);
    perform set_config('app.fail_receipt_action', '', true);
    v_cmd_id := gen_random_uuid();
    select request_id into v_req_id
    from public.redeem_invitation_propose_name(v_cmd_id, v_raw_tok_fail, 'Nome Proposto Para Decisao');

    -- 24.5: Falha em Decisão: Aprovação
    execute 'set local role authenticated';
    perform set_config('request.jwt.claim.sub', v_admin_1::text, true);
    perform set_config('app.fail_audit_action', c_audit_approve, true);
    perform set_config('app.fail_receipt_action', '', true);
    v_cmd_id := gen_random_uuid();
    v_caught_error := false;
    begin
      perform public.decide_access_request(v_cmd_id, v_church_alpha, v_req_id, 'approve');
    exception when internal_error then
      get stacked diagnostics v_err_msg = message_text;
      if v_err_msg ~* 'Simulação de falha forçada' then
        v_caught_error := true;
      else
        raise;
      end if;
    end;
    if not v_caught_error then
      raise exception 'Falha 24.5.A: aprovação deveria abortar por falha de auditoria';
    end if;

    execute 'reset role';
    if exists (select 1 from app_private.church_access where user_id = v_u_guest_fail and church_id = v_church_alpha)
       or not exists (select 1 from app_private.access_requests where id = v_req_id and status = 'pending') then
      raise exception 'Falha 24.5.A: aprovação com falha de auditoria alterou estado';
    end if;

    execute 'set local role authenticated';
    perform set_config('request.jwt.claim.sub', v_admin_1::text, true);
    perform set_config('app.fail_audit_action', '', true);
    perform set_config('app.fail_receipt_action', c_receipt_decide, true);
    v_cmd_id := gen_random_uuid();
    v_caught_error := false;
    begin
      perform public.decide_access_request(v_cmd_id, v_church_alpha, v_req_id, 'approve');
    exception when internal_error then
      get stacked diagnostics v_err_msg = message_text;
      if v_err_msg ~* 'Simulação de falha forçada' then
        v_caught_error := true;
      else
        raise;
      end if;
    end;
    if not v_caught_error then
      raise exception 'Falha 24.5.B: aprovação deveria abortar por falha de recibo';
    end if;

    execute 'reset role';
    if exists (select 1 from app_private.church_access where user_id = v_u_guest_fail and church_id = v_church_alpha)
       or not exists (select 1 from app_private.access_requests where id = v_req_id and status = 'pending') then
      raise exception 'Falha 24.5.B: aprovação com falha de recibo alterou estado';
    end if;

    -- 24.6: Falha em Decisão: Rejeição
    execute 'set local role authenticated';
    perform set_config('request.jwt.claim.sub', v_admin_1::text, true);
    perform set_config('app.fail_audit_action', c_audit_reject, true);
    perform set_config('app.fail_receipt_action', '', true);
    v_cmd_id := gen_random_uuid();
    v_caught_error := false;
    begin
      perform public.decide_access_request(v_cmd_id, v_church_alpha, v_req_id, 'reject');
    exception when internal_error then
      get stacked diagnostics v_err_msg = message_text;
      if v_err_msg ~* 'Simulação de falha forçada' then
        v_caught_error := true;
      else
        raise;
      end if;
    end;
    if not v_caught_error then
      raise exception 'Falha 24.6.A: rejeição deveria abortar por falha de auditoria';
    end if;

    execute 'reset role';
    if not exists (select 1 from app_private.access_requests where id = v_req_id and status = 'pending') then
      raise exception 'Falha 24.6.A: rejeição com falha de auditoria alterou status';
    end if;

    execute 'set local role authenticated';
    perform set_config('request.jwt.claim.sub', v_admin_1::text, true);
    perform set_config('app.fail_audit_action', '', true);
    perform set_config('app.fail_receipt_action', c_receipt_decide, true);
    v_cmd_id := gen_random_uuid();
    v_caught_error := false;
    begin
      perform public.decide_access_request(v_cmd_id, v_church_alpha, v_req_id, 'reject');
    exception when internal_error then
      get stacked diagnostics v_err_msg = message_text;
      if v_err_msg ~* 'Simulação de falha forçada' then
        v_caught_error := true;
      else
        raise;
      end if;
    end;
    if not v_caught_error then
      raise exception 'Falha 24.6.B: rejeição deveria abortar por falha de recibo';
    end if;

    execute 'reset role';
    if not exists (select 1 from app_private.access_requests where id = v_req_id and status = 'pending') then
      raise exception 'Falha 24.6.B: rejeição com falha de recibo alterou status';
    end if;

    -- 24.7: Falha em Finalização Expirada (expire_access_request)
    -- Cria convites consumidos e solicitações pendentes já vencidas com tempos históricos coerentes desde o início
    -- (não altera isoladamente o prazo de solicitação existente, preservando FK e submitted_at < expires_at).

    -- 24.7.A: Falha de Auditoria em Expiração
    declare
      v_u_exp_fail_1 uuid := gen_random_uuid();
      v_m_exp_fail_1 uuid := gen_random_uuid();
      v_inv_exp_fail_1 uuid := gen_random_uuid();
      v_req_exp_fail_1 uuid := gen_random_uuid();
      v_t_exp_1 timestamptz := statement_timestamp() - interval '73 hours';
    begin
      insert into auth.users (id, email, email_confirmed_at)
      values (v_u_exp_fail_1, 'exp_fail_1_' || v_u_exp_fail_1::text || '@example.test', statement_timestamp());

      insert into app_private.members (id, church_id, display_name, status, created_by_user_id)
      values (v_m_exp_fail_1, v_church_alpha, 'Membro Expire Falha 1', 'active', v_admin_1);

      insert into app_private.access_invitations (
        id, church_id, member_id, recipient_email, token_digest, issued_by_user_id, issued_at, expires_at, redeemed_at, redeemed_by_user_id
      ) values (
        v_inv_exp_fail_1, v_church_alpha, v_m_exp_fail_1, 'exp_fail_1_' || v_u_exp_fail_1::text || '@example.test',
        pg_catalog.sha256('dummy_digest_exp_fail_1_bytes'::bytea),
        v_admin_1, v_t_exp_1, v_t_exp_1 + interval '72 hours',
        v_t_exp_1 + interval '1 hour', v_u_exp_fail_1
      );

      insert into app_private.access_requests (
        id, church_id, member_id, invitation_id, requester_user_id, original_display_name, proposed_display_name,
        submitted_at, expires_at, status
      ) values (
        v_req_exp_fail_1, v_church_alpha, v_m_exp_fail_1, v_inv_exp_fail_1, v_u_exp_fail_1,
        'Membro Expire Falha 1', 'Nome Proposto Expire Falha 1',
        v_t_exp_1 + interval '1 hour', v_t_exp_1 + interval '72 hours',
        'pending'
      );

      execute 'set local role authenticated';
      perform set_config('request.jwt.claim.sub', v_admin_1::text, true);
      perform set_config('app.fail_audit_action', c_audit_expire, true);
      perform set_config('app.fail_receipt_action', '', true);
      v_cmd_id := gen_random_uuid();
      v_caught_error := false;
      begin
        perform public.decide_access_request(v_cmd_id, v_church_alpha, v_req_exp_fail_1, 'approve');
      exception when internal_error then
        get stacked diagnostics v_err_msg = message_text;
        if v_err_msg ~* 'Simulação de falha forçada' then
          v_caught_error := true;
        else
          raise;
        end if;
      end;
      if not v_caught_error then
        raise exception 'Falha 24.7.A: expire deveria abortar por falha de auditoria';
      end if;

      execute 'reset role';
      if not exists (
        select 1 from app_private.access_requests
        where id = v_req_exp_fail_1 and status = 'pending' and decided_at is null
      ) then
        raise exception 'Falha 24.7.A: rollback de expire não desfez a alteração de status';
      end if;
    end;

    -- 24.7.B: Falha de Recibo em Expiração
    declare
      v_u_exp_fail_2 uuid := gen_random_uuid();
      v_m_exp_fail_2 uuid := gen_random_uuid();
      v_inv_exp_fail_2 uuid := gen_random_uuid();
      v_req_exp_fail_2 uuid := gen_random_uuid();
      v_t_exp_2 timestamptz := statement_timestamp() - interval '73 hours';
    begin
      insert into auth.users (id, email, email_confirmed_at)
      values (v_u_exp_fail_2, 'exp_fail_2_' || v_u_exp_fail_2::text || '@example.test', statement_timestamp());

      insert into app_private.members (id, church_id, display_name, status, created_by_user_id)
      values (v_m_exp_fail_2, v_church_alpha, 'Membro Expire Falha 2', 'active', v_admin_1);

      insert into app_private.access_invitations (
        id, church_id, member_id, recipient_email, token_digest, issued_by_user_id, issued_at, expires_at, redeemed_at, redeemed_by_user_id
      ) values (
        v_inv_exp_fail_2, v_church_alpha, v_m_exp_fail_2, 'exp_fail_2_' || v_u_exp_fail_2::text || '@example.test',
        pg_catalog.sha256('dummy_digest_exp_fail_2_bytes'::bytea),
        v_admin_1, v_t_exp_2, v_t_exp_2 + interval '72 hours',
        v_t_exp_2 + interval '1 hour', v_u_exp_fail_2
      );

      insert into app_private.access_requests (
        id, church_id, member_id, invitation_id, requester_user_id, original_display_name, proposed_display_name,
        submitted_at, expires_at, status
      ) values (
        v_req_exp_fail_2, v_church_alpha, v_m_exp_fail_2, v_inv_exp_fail_2, v_u_exp_fail_2,
        'Membro Expire Falha 2', 'Nome Proposto Expire Falha 2',
        v_t_exp_2 + interval '1 hour', v_t_exp_2 + interval '72 hours',
        'pending'
      );

      execute 'set local role authenticated';
      perform set_config('request.jwt.claim.sub', v_admin_1::text, true);
      perform set_config('app.fail_audit_action', '', true);
      perform set_config('app.fail_receipt_action', c_receipt_decide, true);
      v_cmd_id := gen_random_uuid();
      v_caught_error := false;
      begin
        perform public.decide_access_request(v_cmd_id, v_church_alpha, v_req_exp_fail_2, 'approve');
      exception when internal_error then
        get stacked diagnostics v_err_msg = message_text;
        if v_err_msg ~* 'Simulação de falha forçada' then
          v_caught_error := true;
        else
          raise;
        end if;
      end;
      if not v_caught_error then
        raise exception 'Falha 24.7.B: expire deveria abortar por falha de recibo';
      end if;

      execute 'reset role';
      if not exists (
        select 1 from app_private.access_requests
        where id = v_req_exp_fail_2 and status = 'pending' and decided_at is null
      ) then
        raise exception 'Falha 24.7.B: rollback de expire com falha de recibo não desfez a alteração de status';
      end if;
    end;
  end;

  -- Desinstala gatilhos e funções de teste de falha forçada com cascade
  execute 'reset role';
  perform set_config('app.fail_audit_action', '', true);
  perform set_config('app.fail_receipt_action', '', true);
  drop trigger if exists test_fail_audit on app_private.audit_entries;
  drop trigger if exists test_fail_receipt on app_private.command_receipts;
  drop function if exists app_private.fail_test_trigger_audit() cascade;
  drop function if exists app_private.fail_test_trigger_receipt() cascade;

  -- =========================================================================
  -- [CENÁRIO 25] Regressão dos Incrementos 007 e 009
  -- =========================================================================
  -- Regressão 007: criação de membro
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_admin_1::text, true);

  declare
    v_reg_cmd uuid := gen_random_uuid();
    v_created_m uuid;
  begin
    select member_id into v_created_m
    from public.create_church_member(v_church_alpha, v_reg_cmd, 'Membro Regressao');

    if v_created_m is null then
      raise exception 'Falha Regressão 007: create_church_member falhou com command_receipts evoluída';
    end if;

    if not exists (
      select 1 from public.get_create_member_receipt(v_church_alpha, v_reg_cmd)
    ) then
      raise exception 'Falha Regressão 007: get_create_member_receipt falhou';
    end if;
  end;

  -- Regressão 009: criação de igreja
  declare
    v_u_creator uuid := gen_random_uuid();
    v_ch_cmd uuid := gen_random_uuid();
    v_created_ch uuid;
  begin
    execute 'reset role';
    insert into auth.users (id, email, email_confirmed_at)
    values (v_u_creator, 'creator_' || v_u_creator::text || '@example.test', statement_timestamp());

    execute 'set local role authenticated';
    perform set_config('request.jwt.claim.sub', v_u_creator::text, true);

    select church_id into v_created_ch
    from public.create_my_church(
      v_ch_cmd,
      'Igreja Regressao 009',
      'Pastor Regressao',
      'America/Sao_Paulo',
      null, null, 'warn'
    );

    if v_created_ch is null then
      raise exception 'Falha Regressão 009: create_my_church falhou';
    end if;

    if not exists (
      select 1 from public.get_create_church_receipt(v_ch_cmd)
    ) then
      raise exception 'Falha Regressão 009: get_create_church_receipt falhou';
    end if;
  end;

  -- =========================================================================
  -- [CENÁRIO 26] Regressão Supabase Auth Nativo (auth.users.email varchar(255))
  -- =========================================================================
  -- No Supabase Auth nativo (GoTrue), auth.users.email é varchar(255).
  -- A função public.list_church_access_requests declara requester_email text.
  -- Esta regressão insere uma solicitação com usuário de e-mail varchar(255)
  -- e executa a chamada real sob identidade administrativa elegível,
  -- comprovando que a conversão na fronteira SQL retorna text sem erro 42804.
  declare
    v_u_req_native uuid := gen_random_uuid();
    v_m_req_native uuid := gen_random_uuid();
    v_inv_native uuid := gen_random_uuid();
    v_req_native uuid := gen_random_uuid();
    v_inv_expires_at timestamptz;
    v_ret_req_id uuid;
    v_ret_email text;
    v_ret_status text;
    v_ret_total bigint;
  begin
    execute 'reset role';

    insert into auth.users (id, email, email_confirmed_at)
    values (v_u_req_native, ('native_auth_' || v_u_req_native::text || '@example.test')::varchar(255), statement_timestamp());

    insert into app_private.members (id, church_id, display_name, created_by_user_id)
    values (v_m_req_native, v_church_alpha, 'Membro Auth Nativo', v_admin_1);

    insert into app_private.access_invitations (
      id, church_id, member_id, recipient_email, token_digest,
      issued_by_user_id, issued_at, expires_at, redeemed_at, redeemed_by_user_id
    ) values (
      v_inv_native, v_church_alpha, v_m_req_native, 'native_auth@example.test',
      pg_catalog.sha256('dummy_digest_native_auth'::bytea),
      v_admin_1, statement_timestamp() - interval '2 hours', statement_timestamp() + interval '70 hours',
      statement_timestamp() - interval '1 hour', v_u_req_native
    ) returning expires_at into v_inv_expires_at;

    insert into app_private.access_requests (
      id, church_id, member_id, invitation_id, requester_user_id,
      original_display_name, proposed_display_name, submitted_at, expires_at, status
    ) values (
      v_req_native, v_church_alpha, v_m_req_native, v_inv_native, v_u_req_native,
      'Membro Auth Nativo', 'Nome Proposto Nativo',
      statement_timestamp() - interval '1 hour', v_inv_expires_at,
      'pending'
    );

    -- Executa sob identidade administrativa elegível na Igreja Alpha
    execute 'set local role authenticated';
    perform set_config('request.jwt.claim.sub', v_admin_1::text, true);

    select request_id, requester_email, status, total_count
    into v_ret_req_id, v_ret_email, v_ret_status, v_ret_total
    from public.list_church_access_requests(v_church_alpha, 'pending', 10, 0)
    where request_id = v_req_native;

    if v_ret_req_id is null or v_ret_req_id is distinct from v_req_native then
      raise exception 'Falha Regressão Auth Nativo: list_church_access_requests não retornou a solicitação criada';
    end if;

    if v_ret_email is distinct from ('native_auth_' || v_u_req_native::text || '@example.test') then
      raise exception 'Falha Regressão Auth Nativo: requester_email divergente do e-mail varchar(255) de auth.users';
    end if;

    if v_ret_status is distinct from 'pending' or v_ret_total < 1 then
      raise exception 'Falha Regressão Auth Nativo: status ou total_count inconsistente';
    end if;
  end;

  -- Restaura operador
  execute 'reset role';
  if current_user is distinct from v_operator then
    raise exception 'Falha ao retornar ao operador';
  end if;

  raise notice 'ENSAIO TRANSACIONAL DE CONVITES CONCLUIDO COM SUCESSO.';
end;
$test$;
