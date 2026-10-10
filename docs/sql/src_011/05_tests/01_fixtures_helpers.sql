do $test$
declare
  v_operator text := current_user;
  v_role text;

  -- Nomes canônicos de ações centralizados para injeção e asserções
  c_audit_issue constant text := 'issue_access_invitation';
  c_audit_redeem_confirm constant text := 'redeem_invitation_confirm_name';
  c_audit_redeem_propose constant text := 'redeem_invitation_propose_name';
  c_audit_approve constant text := 'approve_access_request';
  c_audit_reject constant text := 'reject_access_request';
  c_audit_expire constant text := 'expire_access_request';
  c_audit_revoke constant text := 'revoke_access_invitation';
  c_audit_cancel constant text := 'cancel_access_request';

  c_receipt_issue constant text := 'issue_invitation';
  c_receipt_redeem_confirm constant text := 'redeem_confirm_name';
  c_receipt_redeem_propose constant text := 'redeem_propose_name';
  c_receipt_decide constant text := 'decide_access_request';

  -- Identificadores sintéticos
  v_admin_1 uuid := gen_random_uuid();
  v_admin_2 uuid := gen_random_uuid();
  v_guest_1 uuid := gen_random_uuid();
  v_guest_2 uuid := gen_random_uuid();
  v_guest_unconfirmed uuid := gen_random_uuid();
  v_guest_wrong uuid := gen_random_uuid();
  v_user_beta uuid := gen_random_uuid();
  v_user_revoked uuid := gen_random_uuid();
  v_user_email_change uuid := gen_random_uuid();

  v_church_alpha uuid := gen_random_uuid();
  v_church_beta uuid := gen_random_uuid();

  v_m_admin_1 uuid := gen_random_uuid();
  v_m_admin_2 uuid := gen_random_uuid();
  v_m_admin_beta uuid := gen_random_uuid();
  v_m_target_1 uuid := gen_random_uuid();
  v_m_target_2 uuid := gen_random_uuid();
  v_m_target_3 uuid := gen_random_uuid();
  v_m_revoked uuid := gen_random_uuid();
  v_m_target_5 uuid := gen_random_uuid();
  v_m_target_email_change uuid := gen_random_uuid();
  v_m_target_fail_audit uuid := gen_random_uuid();

  v_cmd_id uuid;
  v_cmd_propose_2 uuid;
  v_inv_id uuid;
  v_raw_token text;
  v_expires_at timestamptz;
  v_issued_at timestamptz;
  v_is_valid boolean;
  v_c_name text;
  v_m_name text;
  v_token_digest bytea;
  v_access_id uuid;
  v_req_id uuid;
  v_req_id_pedro uuid;
  v_expected_req_id_2 uuid;
  v_cur_name text;
  v_orig_name text;
  v_prop_name text;
  v_status text;
  v_is_exp boolean;
  v_total bigint;
  v_err_code text;
  v_decided_at timestamptz;
  v_final_name text;
  v_decision text;
  v_access_granted boolean;
  v_receipt_cmd uuid;
  v_receipt_action text;
  v_receipt_church_id uuid;
  v_receipt_member_id uuid;
  v_receipt_unrecoverable boolean;
  v_receipt_payload jsonb;
  v_church_name_out text;
  v_caught_error boolean;
  v_err_msg text;
begin
  -- [Cenário 0.1] Negativa de execução das novas RPCs para anon e service_role
  foreach v_role in array array['anon', 'service_role'] loop
    execute 'set local role ' || quote_ident(v_role);

    begin
      perform public.issue_church_invitation(gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'test@example.com');
      raise exception 'Falha: % não deve executar issue_church_invitation', v_role;
    exception when insufficient_privilege then null; end;

    begin
      perform public.get_invitation_details('dGVzdF90b2tlbl9iYXNlNjR1cmxfZXhhY3RfMTIzNDU2Nw');
      raise exception 'Falha: % não deve executar get_invitation_details', v_role;
    exception when insufficient_privilege then null; end;

    begin
      perform public.redeem_invitation_confirm_name(gen_random_uuid(), 'dGVzdF90b2tlbl9iYXNlNjR1cmxfZXhhY3RfMTIzNDU2Nw', 'Nome');
      raise exception 'Falha: % não deve executar redeem_invitation_confirm_name', v_role;
    exception when insufficient_privilege then null; end;

    begin
      perform public.redeem_invitation_propose_name(gen_random_uuid(), 'dGVzdF90b2tlbl9iYXNlNjR1cmxfZXhhY3RfMTIzNDU2Nw', 'Outro Nome');
      raise exception 'Falha: % não deve executar redeem_invitation_propose_name', v_role;
    exception when insufficient_privilege then null; end;

    begin
      perform public.get_my_access_request(gen_random_uuid());
      raise exception 'Falha: % não deve executar get_my_access_request', v_role;
    exception when insufficient_privilege then null; end;

    begin
      perform public.list_church_invitations(gen_random_uuid());
      raise exception 'Falha: % não deve executar list_church_invitations', v_role;
    exception when insufficient_privilege then null; end;

    begin
      perform public.list_church_access_requests(gen_random_uuid());
      raise exception 'Falha: % não deve executar list_church_access_requests', v_role;
    exception when insufficient_privilege then null; end;

    begin
      perform public.decide_access_request(gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'approve');
      raise exception 'Falha: % não deve executar decide_access_request', v_role;
    exception when insufficient_privilege then null; end;

    begin
      perform public.get_invitation_command_receipt(gen_random_uuid());
      raise exception 'Falha: % não deve executar get_invitation_command_receipt', v_role;
    exception when insufficient_privilege then null; end;

    execute 'reset role';
  end loop;

  -- 2. Criação das Fixtures Sintéticas pelo Operador (com contas Auth válidas e preenchimento atômico)
  insert into auth.users (id, email, email_confirmed_at) values
    (v_admin_1, 'admin1_' || v_admin_1::text || '@example.test', statement_timestamp()),
    (v_admin_2, 'admin2_' || v_admin_2::text || '@example.test', statement_timestamp()),
    (v_guest_1, 'carlos_guest_' || v_guest_1::text || '@example.test', statement_timestamp()),
    (v_guest_2, 'mariana_guest_' || v_guest_2::text || '@example.test', statement_timestamp()),
    (v_guest_unconfirmed, 'unconfirmed_' || v_guest_unconfirmed::text || '@example.test', null),
    (v_guest_wrong, 'wrong_' || v_guest_wrong::text || '@example.test', statement_timestamp()),
    (v_user_beta, 'admin_beta_' || v_user_beta::text || '@example.test', statement_timestamp()),
    (v_user_revoked, 'revoked_' || v_user_revoked::text || '@example.test', statement_timestamp()),
    (v_user_email_change, 'email_change@example.test', statement_timestamp());

  insert into app_private.churches (id, name, timezone, default_duration_policy, status) values
    (v_church_alpha, 'Comunidade Alpha Sintética', 'America/Sao_Paulo', 'warn', 'active'),
    (v_church_beta, 'Igreja Beta Sintética', 'America/Sao_Paulo', 'warn', 'active');

  insert into app_private.members (id, church_id, display_name, status, created_by_user_id) values
    (v_m_admin_1, v_church_alpha, 'Admin Um', 'active', v_admin_1),
    (v_m_admin_2, v_church_alpha, 'Admin Dois', 'active', v_admin_1),
    (v_m_admin_beta, v_church_beta, 'Admin Beta', 'active', v_user_beta),
    (v_m_target_1, v_church_alpha, 'Carlos Silva', 'active', v_admin_1),
    (v_m_target_2, v_church_alpha, 'Mariana Silva Santos', 'active', v_admin_1),
    (v_m_target_3, v_church_alpha, 'Pedro Santos', 'active', v_admin_1),
    (v_m_revoked, v_church_alpha, 'Lucas Pereira', 'active', v_admin_1),
    (v_m_target_5, v_church_alpha, 'Roberto Souza', 'active', v_admin_1),
    (v_m_target_email_change, v_church_alpha, 'Membro Troca Email', 'active', v_admin_1),
    (v_m_target_fail_audit, v_church_alpha, 'Membro Falha Audit', 'active', v_admin_1);

  -- Inserção de church_access incluindo vínculo revogado com todos os campos obrigatórios na mesma instrução
  insert into app_private.church_access (
    id, church_id, user_id, member_id, is_admin, status, onboarding_completed_at, granted_by_user_id,
    revoked_by_user_id, revoked_at, granted_at, created_at, updated_at
  ) values
    (gen_random_uuid(), v_church_alpha, v_admin_1, v_m_admin_1, true, 'active', statement_timestamp(), v_admin_1,
     null, null, statement_timestamp(), statement_timestamp(), statement_timestamp()),
    (gen_random_uuid(), v_church_alpha, v_admin_2, v_m_admin_2, true, 'active', statement_timestamp(), v_admin_1,
     null, null, statement_timestamp(), statement_timestamp(), statement_timestamp()),
    (gen_random_uuid(), v_church_beta, v_user_beta, v_m_admin_beta, true, 'active', statement_timestamp(), v_user_beta,
     null, null, statement_timestamp(), statement_timestamp(), statement_timestamp()),
    (gen_random_uuid(), v_church_alpha, v_user_revoked, v_m_revoked, false, 'revoked', statement_timestamp(), v_admin_1,
     v_admin_1, statement_timestamp(), statement_timestamp(), statement_timestamp(), statement_timestamp());
