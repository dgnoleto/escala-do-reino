  -- [CENÁRIO 11] Consulta da Própria Solicitação (get_my_access_request com church_name e matriz de estados)
  -- =========================================================================
  -- 11.1: Solicitação pendente dentro do prazo
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_guest_2::text, true);

  v_req_id := null;
  v_church_name_out := null;
  v_prop_name := null;
  v_status := null;
  v_is_exp := null;
  select request_id, church_name, proposed_display_name, status, is_expired
  into v_req_id, v_church_name_out, v_prop_name, v_status, v_is_exp
  from public.get_my_access_request(v_church_alpha);

  if v_req_id is distinct from v_expected_req_id_2
     or v_church_name_out is distinct from 'Comunidade Alpha Sintética'
     or v_prop_name is distinct from 'Mariana dos Santos'
     or v_status is distinct from 'pending'
     or v_is_exp is not false then
    raise exception 'Falha: get_my_access_request deveria retornar a solicitação pendente com church_name e is_expired false';
  end if;

  -- Outro usuário não vê essa solicitação
  perform set_config('request.jwt.claim.sub', v_guest_1::text, true);
  if exists (select 1 from public.get_my_access_request(v_church_alpha)) then
    raise exception 'Falha: usuário não deve ver solicitação de terceiros';
  end if;

  -- 11.2: Solicitação pendente com prazo transcorrido (status efetivo 'expired', is_expired = true)
  execute 'reset role';
  declare
    v_u_pending_exp uuid := gen_random_uuid();
    v_m_pending_exp uuid := gen_random_uuid();
    v_inv_pending_exp uuid := gen_random_uuid();
    v_req_pending_exp uuid := gen_random_uuid();
  begin
    insert into auth.users (id, email, email_confirmed_at)
    values (v_u_pending_exp, 'pending_exp_' || v_u_pending_exp::text || '@example.test', statement_timestamp());

    insert into app_private.members (id, church_id, display_name, status, created_by_user_id)
    values (v_m_pending_exp, v_church_alpha, 'Membro Prazo Vencido', 'active', v_admin_1);

    insert into app_private.access_invitations (
      id, church_id, member_id, recipient_email, token_digest, issued_by_user_id, issued_at, expires_at, redeemed_at, redeemed_by_user_id
    ) values (
      v_inv_pending_exp, v_church_alpha, v_m_pending_exp, 'pending_exp_' || v_u_pending_exp::text || '@example.test',
      pg_catalog.sha256('dummy_digest_pending_exp_bytes'::bytea),
      v_admin_1, statement_timestamp() - interval '73 hours', statement_timestamp() - interval '1 hour',
      statement_timestamp() - interval '72 hours', v_u_pending_exp
    );

    insert into app_private.access_requests (
      id, church_id, member_id, invitation_id, requester_user_id, original_display_name, proposed_display_name,
      submitted_at, expires_at, status
    ) values (
      v_req_pending_exp, v_church_alpha, v_m_pending_exp, v_inv_pending_exp, v_u_pending_exp,
      'Membro Prazo Vencido', 'Nome Proposto Vencido',
      statement_timestamp() - interval '72 hours', statement_timestamp() - interval '1 hour',
      'pending'
    );

    execute 'set local role authenticated';
    perform set_config('request.jwt.claim.sub', v_u_pending_exp::text, true);

    v_status := null;
    v_is_exp := null;
    select status, is_expired into v_status, v_is_exp
    from public.get_my_access_request(v_church_alpha);

    if v_status is distinct from 'expired' or v_is_exp is not true then
      raise exception 'Falha TC-INV-REQUEST-01: pendente vencido deve retornar status effective expired e is_expired true';
    end if;
  end;

  -- 11.3: Solicitação com status persistido 'expired' (independente, com decided_at >= expires_at e decided_by nulo)
  execute 'reset role';
  declare
    v_u_exp_persisted uuid := gen_random_uuid();
    v_m_exp_persisted uuid := gen_random_uuid();
    v_inv_exp_persisted uuid := gen_random_uuid();
    v_req_exp_persisted uuid := gen_random_uuid();
    v_t_exp timestamptz := statement_timestamp() - interval '74 hours';
  begin
    insert into auth.users (id, email, email_confirmed_at)
    values (v_u_exp_persisted, 'exp_persisted_' || v_u_exp_persisted::text || '@example.test', statement_timestamp());

    insert into app_private.members (id, church_id, display_name, status, created_by_user_id)
    values (v_m_exp_persisted, v_church_alpha, 'Membro Expirado Persistido', 'active', v_admin_1);

    insert into app_private.access_invitations (
      id, church_id, member_id, recipient_email, token_digest, issued_by_user_id, issued_at, expires_at, redeemed_at, redeemed_by_user_id
    ) values (
      v_inv_exp_persisted, v_church_alpha, v_m_exp_persisted, 'exp_persisted_' || v_u_exp_persisted::text || '@example.test',
      pg_catalog.sha256('dummy_digest_exp_persisted_bytes'::bytea),
      v_admin_1, v_t_exp, v_t_exp + interval '72 hours',
      v_t_exp + interval '1 hour', v_u_exp_persisted
    );

    insert into app_private.access_requests (
      id, church_id, member_id, invitation_id, requester_user_id, original_display_name, proposed_display_name,
      submitted_at, expires_at, status, decided_at, decided_by_user_id
    ) values (
      v_req_exp_persisted, v_church_alpha, v_m_exp_persisted, v_inv_exp_persisted, v_u_exp_persisted,
      'Membro Expirado Persistido', 'Nome Proposto Expirado Persistido',
      v_t_exp + interval '1 hour', v_t_exp + interval '72 hours',
      'expired', v_t_exp + interval '72 hours', null
    );

    execute 'set local role authenticated';
    perform set_config('request.jwt.claim.sub', v_u_exp_persisted::text, true);

    v_status := null;
    v_is_exp := null;
    select status, is_expired into v_status, v_is_exp
    from public.get_my_access_request(v_church_alpha);

    if v_status is distinct from 'expired' or v_is_exp is not true then
      raise exception 'Falha TC-INV-REQUEST-02: expired persistido deve retornar status expired e is_expired true';
    end if;
  end;

  -- 11.4: Solicitação com status persistido 'approved' (independente, com decided_at < expires_at e decided_by preenchido)
  execute 'reset role';
  declare
    v_u_approved uuid := gen_random_uuid();
    v_m_approved uuid := gen_random_uuid();
    v_inv_approved uuid := gen_random_uuid();
    v_req_approved uuid := gen_random_uuid();
    v_t_app timestamptz := statement_timestamp() - interval '10 hours';
  begin
    insert into auth.users (id, email, email_confirmed_at)
    values (v_u_approved, 'approved_' || v_u_approved::text || '@example.test', statement_timestamp());

    insert into app_private.members (id, church_id, display_name, status, created_by_user_id)
    values (v_m_approved, v_church_alpha, 'Membro Aprovado Fixture', 'active', v_admin_1);

    insert into app_private.access_invitations (
      id, church_id, member_id, recipient_email, token_digest, issued_by_user_id, issued_at, expires_at, redeemed_at, redeemed_by_user_id
    ) values (
      v_inv_approved, v_church_alpha, v_m_approved, 'approved_' || v_u_approved::text || '@example.test',
      pg_catalog.sha256('dummy_digest_approved_bytes'::bytea),
      v_admin_1, v_t_app, v_t_app + interval '72 hours',
      v_t_app + interval '1 hour', v_u_approved
    );

    insert into app_private.access_requests (
      id, church_id, member_id, invitation_id, requester_user_id, original_display_name, proposed_display_name,
      submitted_at, expires_at, status, decided_at, decided_by_user_id
    ) values (
      v_req_approved, v_church_alpha, v_m_approved, v_inv_approved, v_u_approved,
      'Membro Aprovado Fixture', 'Nome Proposto Aprovado Fixture',
      v_t_app + interval '1 hour', v_t_app + interval '72 hours',
      'approved', v_t_app + interval '2 hours', v_admin_1
    );

    execute 'set local role authenticated';
    perform set_config('request.jwt.claim.sub', v_u_approved::text, true);

    v_status := null;
    v_is_exp := null;
    select status, is_expired into v_status, v_is_exp
    from public.get_my_access_request(v_church_alpha);

    if v_status is distinct from 'approved' or v_is_exp is not false then
      raise exception 'Falha TC-INV-REQUEST-03: solicitação approved deve retornar status approved e is_expired false';
    end if;
  end;

  -- 11.5: Solicitação com status persistido 'rejected' (independente, com decided_at >= submitted_at e decided_by preenchido)
  execute 'reset role';
  declare
    v_u_rejected uuid := gen_random_uuid();
    v_m_rejected uuid := gen_random_uuid();
    v_inv_rejected uuid := gen_random_uuid();
    v_req_rejected uuid := gen_random_uuid();
    v_t_rej timestamptz := statement_timestamp() - interval '10 hours';
  begin
    insert into auth.users (id, email, email_confirmed_at)
    values (v_u_rejected, 'rejected_' || v_u_rejected::text || '@example.test', statement_timestamp());

    insert into app_private.members (id, church_id, display_name, status, created_by_user_id)
    values (v_m_rejected, v_church_alpha, 'Membro Rejeitado Fixture', 'active', v_admin_1);

    insert into app_private.access_invitations (
      id, church_id, member_id, recipient_email, token_digest, issued_by_user_id, issued_at, expires_at, redeemed_at, redeemed_by_user_id
    ) values (
      v_inv_rejected, v_church_alpha, v_m_rejected, 'rejected_' || v_u_rejected::text || '@example.test',
      pg_catalog.sha256('dummy_digest_rejected_bytes'::bytea),
      v_admin_1, v_t_rej, v_t_rej + interval '72 hours',
      v_t_rej + interval '1 hour', v_u_rejected
    );

    insert into app_private.access_requests (
      id, church_id, member_id, invitation_id, requester_user_id, original_display_name, proposed_display_name,
      submitted_at, expires_at, status, decided_at, decided_by_user_id
    ) values (
      v_req_rejected, v_church_alpha, v_m_rejected, v_inv_rejected, v_u_rejected,
      'Membro Rejeitado Fixture', 'Nome Proposto Rejeitado Fixture',
      v_t_rej + interval '1 hour', v_t_rej + interval '72 hours',
      'rejected', v_t_rej + interval '2 hours', v_admin_1
    );

    execute 'set local role authenticated';
    perform set_config('request.jwt.claim.sub', v_u_rejected::text, true);

    v_status := null;
    v_is_exp := null;
    select status, is_expired into v_status, v_is_exp
    from public.get_my_access_request(v_church_alpha);

    if v_status is distinct from 'rejected' or v_is_exp is not false then
      raise exception 'Falha TC-INV-REQUEST-04: solicitação rejected deve retornar status rejected e is_expired false';
    end if;
  end;

  -- =========================================================================
  -- [CENÁRIO 12] Consulta de Recibo Próprio pelo Solicitante com Solicitação Pendente (TC-INV-REPLAY-03 / Priority 4)
  -- =========================================================================
  perform set_config('request.jwt.claim.sub', v_guest_2::text, true);

  v_receipt_cmd := null;
  v_receipt_action := null;
  v_receipt_church_id := null;
  v_receipt_member_id := null;
  v_req_id := null;
  v_receipt_payload := null;
  v_receipt_unrecoverable := null;

  select command_id, action, church_id, result_member_id, result_entity_id, result_payload, link_unrecoverable
  into v_receipt_cmd, v_receipt_action, v_receipt_church_id, v_receipt_member_id, v_req_id, v_receipt_payload, v_receipt_unrecoverable
  from public.get_invitation_command_receipt(v_cmd_propose_2);

  if v_receipt_cmd is distinct from v_cmd_propose_2
     or v_receipt_action is distinct from 'redeem_propose_name'
     or v_receipt_church_id is distinct from v_church_alpha
     or v_receipt_member_id is distinct from v_m_target_2
     or v_req_id is distinct from v_expected_req_id_2
     or v_receipt_unrecoverable is not false
     or (v_receipt_payload ->> 'status') is distinct from 'pending' then
    raise exception 'Falha TC-INV-REPLAY-03: campos do recibo de proposta pendente incorretos ou nulos';
  end if;

  if v_receipt_member_id is distinct from v_m_target_2 then
    raise exception 'Falha TC-INV-REPLAY-03: result_member_id no recibo incorreto ou nulo';
  end if;

  if v_req_id is distinct from v_expected_req_id_2 then
    raise exception 'Falha TC-INV-REPLAY-03: result_entity_id no recibo incorreto ou nulo';
  end if;

  if (v_receipt_payload->>'status') is distinct from 'pending' then
    raise exception 'Falha TC-INV-REPLAY-03: payload status no recibo incorreto ou nulo';
  end if;

  if v_receipt_unrecoverable is not false then
    raise exception 'Falha TC-INV-REPLAY-03: link_unrecoverable deveria ser false para proposta';
  end if;

  -- Negativa de acesso ao recibo desta proposta por outro usuário
  perform set_config('request.jwt.claim.sub', v_guest_1::text, true);
  begin
    perform public.get_invitation_command_receipt(v_cmd_propose_2);
    raise exception 'Falha: outro usuário não deve acessar recibo alheio';
  exception when no_data_found then null; end;

  -- =========================================================================
  -- [CENÁRIO 13] Replay com Conta Inelegível / Banida (Priority 2)
  -- =========================================================================
  -- Operador simula banimento temporário da conta
  execute 'reset role';
  update auth.users set banned_until = clock_timestamp() + interval '1 hour' where id = v_guest_2;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_guest_2::text, true);
  begin
    perform public.redeem_invitation_propose_name(v_cmd_propose_2, v_raw_token, 'Mariana dos Santos');
    raise exception 'Falha Priority 2: replay com conta suspensa/banida não deve ser permitido';
  exception when insufficient_privilege then null; end;

  -- Restaura conta
  execute 'reset role';
  update auth.users set banned_until = null where id = v_guest_2;

  -- =========================================================================
  -- [CENÁRIO 14] Decisão Administrativa: Aprovação (TC-INV-APPROVE-01)
  -- =========================================================================
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_admin_1::text, true);
  v_cmd_id := gen_random_uuid();

  v_decision := null;
  v_access_granted := null;
  v_final_name := null;

  select decision, access_granted, final_display_name
  into v_decision, v_access_granted, v_final_name
  from public.decide_access_request(
    v_cmd_id,
    v_church_alpha,
    v_expected_req_id_2,
    'approve'
  );

  if v_decision is distinct from 'approved' or v_access_granted is not true or v_final_name is distinct from 'Mariana dos Santos' then
    raise exception 'Falha TC-INV-APPROVE-01: aprovação administrativa falhou';
  end if;

  -- Inspeciona pelo operador: membro atualizado e acesso concedido
  execute 'reset role';
  if not exists (
    select 1 from app_private.members
    where id = v_m_target_2 and display_name = 'Mariana dos Santos'
  ) then
    raise exception 'Falha TC-INV-APPROVE-01: nome do membro não foi atualizado no cadastro';
  end if;

  if not exists (
    select 1 from app_private.church_access
    where church_id = v_church_alpha and user_id = v_guest_2 and member_id = v_m_target_2
      and status = 'active' and is_admin = false
  ) then
    raise exception 'Falha TC-INV-APPROVE-01: acesso não concedido para o solicitante';
  end if;

  -- =========================================================================
  -- [CENÁRIO 15] Tentativa de Decidir Solicitação já Decidida
  -- =========================================================================
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_admin_2::text, true);
  begin
    perform public.decide_access_request(
      gen_random_uuid(),
      v_church_alpha,
      v_expected_req_id_2,
      'reject'
    );
    raise exception 'Falha: solicitação já aprovada não deve ser decidida novamente';
  exception when unique_violation then null; end;

  -- =========================================================================
  -- [CENÁRIO 16] Decisão com Nome Original Alterado Concorrentemente (TC-INV-APPROVE-02)
  -- =========================================================================
  -- Emite convite para Pedro
  perform set_config('request.jwt.claim.sub', v_admin_1::text, true);
  v_cmd_id := gen_random_uuid();
  select raw_token into v_raw_token
  from public.issue_church_invitation(
    v_cmd_id,
    v_church_alpha,
    v_m_target_3,
    'wrong_' || v_guest_wrong::text || '@example.test'
  );

  -- Pedro propõe outro nome usando conta sintética do guest_wrong
  perform set_config('request.jwt.claim.sub', v_guest_wrong::text, true);
  v_cmd_id := gen_random_uuid();
  select request_id into v_req_id_pedro
  from public.redeem_invitation_propose_name(
    v_cmd_id,
    v_raw_token,
    'Pedro dos Santos Proposto'
  );

  -- Outro admin altera o nome de Pedro antes da aprovação
  execute 'reset role';
  update app_private.members
  set display_name = 'Pedro Santos Modificado Concorrentemente'
  where id = v_m_target_3;

  -- Admin 1 tenta aprovar
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_admin_1::text, true);
  begin
    perform public.decide_access_request(
      gen_random_uuid(),
      v_church_alpha,
      v_req_id_pedro,
      'approve'
    );
    raise exception 'Falha TC-INV-APPROVE-02: aprovação deveria falhar com nome modificado concorrentemente';
  exception when sqlstate 'P0005' then null; end;

  -- =========================================================================
  -- [CENÁRIO 17] Bloqueio de Aprovação por Troca de E-mail pós-proposta (Priority 1)
  -- =========================================================================
  -- Emite convite para Membro Troca Email
  perform set_config('request.jwt.claim.sub', v_admin_1::text, true);
  v_cmd_id := gen_random_uuid();
  select raw_token into v_raw_token
  from public.issue_church_invitation(
    v_cmd_id,
    v_church_alpha,
    v_m_target_email_change,
    'email_change@example.test'
  );

  -- Convidado propõe outro nome
  perform set_config('request.jwt.claim.sub', v_user_email_change::text, true);
  v_cmd_id := gen_random_uuid();
  select request_id into v_req_id
  from public.redeem_invitation_propose_name(
    v_cmd_id,
    v_raw_token,
    'Membro Troca Email Proposto'
  );

  -- Operador simula alteração de e-mail no Auth do solicitante antes da aprovação do admin
  execute 'reset role';
  update auth.users
  set email = 'hacker_alterado@example.test'
  where id = v_user_email_change;

  -- Admin tenta aprovar: DEVE FALHAR com 42501 (e-mail não corresponde mais ao convite original)
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_admin_1::text, true);
  begin
    perform public.decide_access_request(
      gen_random_uuid(),
      v_church_alpha,
      v_req_id,
      'approve'
    );
    raise exception 'Falha Priority 1: aprovação deveria falhar pois o e-mail do solicitante mudou após a proposta';
  exception when insufficient_privilege then null; end;

  -- Confere que membro não foi alterado e nenhum acesso foi concedido
  execute 'reset role';
  if not exists (
    select 1 from app_private.members
    where id = v_m_target_email_change and display_name = 'Membro Troca Email'
  ) then
    raise exception 'Falha: membro não deveria ser alterado';
  end if;
  if exists (
    select 1 from app_private.church_access
    where church_id = v_church_alpha and user_id = v_user_email_change
  ) then
    raise exception 'Falha: nenhum acesso deveria ser concedido em aprovação com e-mail divergente';
  end if;

  -- =========================================================================
  -- [CENÁRIO 18] Decisão Administrativa: Rejeição (TC-INV-REJECT-01)
  -- =========================================================================
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_admin_1::text, true);

  -- Rejeita a solicitação de Pedro do Cenário 16
  v_cmd_id := gen_random_uuid();
  v_decision := null;
  v_access_granted := null;

  select decision, access_granted into v_decision, v_access_granted
  from public.decide_access_request(
    v_cmd_id,
    v_church_alpha,
    v_req_id_pedro,
    'reject'
  );

  if v_decision is distinct from 'rejected' or v_access_granted is not false then
    raise exception 'Falha TC-INV-REJECT-01: rejeição administrativa falhou';
  end if;

  -- =========================================================================
  -- [CENÁRIO 19] Reemissão Cancela Solicitação Pendente (M65 / Decisão 1)
  -- =========================================================================
  -- Admin emite primeiro convite
  v_cmd_id := gen_random_uuid();
  select raw_token into v_raw_token
  from public.issue_church_invitation(
    v_cmd_id,
    v_church_alpha,
    v_m_target_5,
    'roberto_test@example.test'
  );

  -- Ajusta usuário do teste para bater com o email
  execute 'reset role';
  update auth.users set email = 'roberto_test@example.test' where id = v_guest_wrong;

  -- Convidado propõe outro nome (solicitação pendente)
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_guest_wrong::text, true);
  v_cmd_id := gen_random_uuid();
  select request_id into v_req_id
  from public.redeem_invitation_propose_name(
    v_cmd_id,
    v_raw_token,
    'Roberto Proposto'
  );

  -- Admin reemite convite para o mesmo membro enquanto solicitação está pendente
  perform set_config('request.jwt.claim.sub', v_admin_1::text, true);
  v_cmd_id := gen_random_uuid();
  perform public.issue_church_invitation(
    v_cmd_id,
    v_church_alpha,
    v_m_target_5,
    'roberto_novo@example.test'
  );

  -- Inspeciona pelo operador
  execute 'reset role';
  -- 1) Solicitação antiga cancelada
  if not exists (
    select 1 from app_private.access_requests
    where id = v_req_id and status = 'cancelled' and decided_by_user_id = v_admin_1
  ) then
    raise exception 'Falha M65: solicitação pendente anterior não foi cancelada na reemissão';
  end if;

  -- 2) Convite consumido antigo preservado intacto (revoked_at IS NULL, respeitando terminal_state)
  if exists (
    select 1 from app_private.access_invitations
    where church_id = v_church_alpha and member_id = v_m_target_5 and redeemed_at is not null and revoked_at is not null
  ) then
    raise exception 'Falha M65: convite consumido foi indevidamente revogado violando terminal_state';
  end if;

  -- 3) Novo convite aberto criado
  if not exists (
    select 1 from app_private.access_invitations
    where church_id = v_church_alpha and member_id = v_m_target_5 and recipient_email = 'roberto_novo@example.test'
      and redeemed_at is null and revoked_at is null
  ) then
    raise exception 'Falha M65: novo convite aberto não foi criado';
  end if;

  -- =========================================================================
  -- [CENÁRIO 20] Reemissão com Convite Aberto Vencido (TC-INV-ISSUE-03)
  -- =========================================================================
  -- Simula convite aberto que venceu no passado
  update app_private.access_invitations
  set expires_at = statement_timestamp() - interval '1 hour',
      issued_at = statement_timestamp() - interval '73 hours'
  where church_id = v_church_alpha and member_id = v_m_target_5 and redeemed_at is null and revoked_at is null;

  -- Reemissão finaliza a linha anterior com revoked_at, liberando o índice parcial
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_admin_1::text, true);
  v_cmd_id := gen_random_uuid();
  perform public.issue_church_invitation(
    v_cmd_id,
    v_church_alpha,
    v_m_target_5,
    'roberto_v3@example.test'
  );

  execute 'reset role';
  if not exists (
    select 1 from app_private.access_invitations
    where church_id = v_church_alpha and member_id = v_m_target_5 and recipient_email = 'roberto_novo@example.test'
      and revoked_at is not null
  ) then
    raise exception 'Falha TC-INV-ISSUE-03: convite vencido anterior não foi encerrado com revoked_at';
  end if;

  -- =========================================================================
