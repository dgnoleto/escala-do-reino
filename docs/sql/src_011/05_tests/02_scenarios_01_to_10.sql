  -- [CENÁRIO 1] Emissão de Convite (TC-INV-ISSUE-01)
  -- =========================================================================
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_admin_1::text, true);

  v_cmd_id := gen_random_uuid();
  select invitation_id, raw_token, expires_at, issued_at
  into v_inv_id, v_raw_token, v_expires_at, v_issued_at
  from public.issue_church_invitation(
    v_cmd_id,
    v_church_alpha,
    v_m_target_1,
    'carlos_guest_' || v_guest_1::text || '@example.test'
  );

  if v_inv_id is null or v_raw_token is null then
    raise exception 'Falha TC-INV-ISSUE-01: emissão não retornou identificador ou token';
  end if;

  if v_expires_at is distinct from (v_issued_at + interval '72 hours') then
    raise exception 'Falha TC-INV-ISSUE-01: prazo diverge de 72 horas exatas';
  end if;

  -- Inspeciona pelo operador
  execute 'reset role';
  v_token_digest := pg_catalog.sha256(pg_catalog.convert_to(v_raw_token, 'UTF8'));

  if not exists (
    select 1 from app_private.access_invitations
    where id = v_inv_id and token_digest = v_token_digest and redeemed_at is null and revoked_at is null
  ) then
    raise exception 'Falha TC-INV-ISSUE-01: convite não persistido corretamente com digest';
  end if;

  if not exists (
    select 1 from app_private.audit_entries
    where target_type = 'access_invitations' and target_id = v_inv_id and action = 'issue_access_invitation'
  ) then
    raise exception 'Falha TC-INV-ISSUE-01: auditoria de emissão ausente';
  end if;

  if not exists (
    select 1 from app_private.command_receipts
    where command_id = v_cmd_id and action = 'issue_invitation' and result_entity_id = v_inv_id
  ) then
    raise exception 'Falha TC-INV-ISSUE-01: recibo de emissão ausente';
  end if;

  -- =========================================================================
  -- [CENÁRIO 2] Replay de Emissão (TC-INV-REPLAY-01)
  -- =========================================================================
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_admin_1::text, true);

  select invitation_id, raw_token into v_inv_id, v_raw_token
  from public.issue_church_invitation(
    v_cmd_id,
    v_church_alpha,
    v_m_target_1,
    'carlos_guest_' || v_guest_1::text || '@example.test'
  );

  if v_inv_id is null or v_raw_token is not null then
    raise exception 'Falha TC-INV-REPLAY-01: replay de emissão deve ocultar o raw_token';
  end if;

  -- =========================================================================
  -- [CENÁRIO 3] Conflito de Parâmetros em Replay (TC-INV-REPLAY-02)
  -- =========================================================================
  begin
    perform public.issue_church_invitation(
      v_cmd_id,
      v_church_alpha,
      v_m_target_1,
      'outro_email@example.test'
    );
    raise exception 'Falha TC-INV-REPLAY-02: deveria lançar erro de conflito de parâmetros';
  exception when unique_violation then null; end;

  -- =========================================================================
  -- [CENÁRIO 4] Emissão para Membro com Acesso Ativo (TC-INV-ISSUE-02)
  -- =========================================================================
  begin
    perform public.issue_church_invitation(
      gen_random_uuid(),
      v_church_alpha,
      v_m_admin_2,
      'qualquer@example.test'
    );
    raise exception 'Falha TC-INV-ISSUE-02: não deve emitir convite para membro com acesso ativo';
  exception when unique_violation then null; end;

  -- =========================================================================
  -- [CENÁRIO 5] Consulta de Detalhes (TC-INV-DETAILS-01, 02, 03, TC-INV-TOKEN-01)
  -- =========================================================================
  -- Emite novo convite para ter token em mãos
  v_cmd_id := gen_random_uuid();
  select raw_token into v_raw_token
  from public.issue_church_invitation(
    v_cmd_id,
    v_church_alpha,
    v_m_target_1,
    'carlos_guest_' || v_guest_1::text || '@example.test'
  );

  -- 5.1 Destinatário legítimo
  perform set_config('request.jwt.claim.sub', v_guest_1::text, true);
  v_is_valid := null;
  v_c_name := null;
  v_m_name := null;
  select is_valid, church_name, member_display_name
  into v_is_valid, v_c_name, v_m_name
  from public.get_invitation_details(v_raw_token);

  if v_is_valid is not true or v_c_name is distinct from 'Comunidade Alpha Sintética' or v_m_name is distinct from 'Carlos Silva' then
    raise exception 'Falha TC-INV-DETAILS-01: consulta de detalhes legítima falhou';
  end if;

  -- 5.2 Conta divergente (não vaza dados)
  perform set_config('request.jwt.claim.sub', v_guest_wrong::text, true);
  v_is_valid := null;
  v_c_name := null;
  select is_valid, church_name into v_is_valid, v_c_name
  from public.get_invitation_details(v_raw_token);

  if v_is_valid is not false or v_c_name is not null then
    raise exception 'Falha TC-INV-DETAILS-02: conta divergente não deve ver detalhes do convite';
  end if;

  -- 5.3 Conta sem e-mail confirmado
  perform set_config('request.jwt.claim.sub', v_guest_unconfirmed::text, true);
  select is_valid into v_is_valid from public.get_invitation_details(v_raw_token);
  if v_is_valid then
    raise exception 'Falha TC-INV-DETAILS-03: conta sem e-mail confirmado não deve validar convite';
  end if;

  -- 5.4 Token com caixa invertida (sensibilidade à caixa - TC-INV-TOKEN-01)
  perform set_config('request.jwt.claim.sub', v_guest_1::text, true);
  select is_valid into v_is_valid from public.get_invitation_details(upper(v_raw_token));
  if v_is_valid then
    raise exception 'Falha TC-INV-TOKEN-01: alteração de caixa do token não deve validar convite';
  end if;

  -- =========================================================================
  -- [CENÁRIO 6] Resgate com Confirmação de Nome (TC-INV-CONFIRM-01)
  -- =========================================================================
  perform set_config('request.jwt.claim.sub', v_guest_1::text, true);
  v_cmd_id := gen_random_uuid();

  v_access_granted := null;
  v_cur_name := null;
  select access_granted, display_name into v_access_granted, v_cur_name
  from public.redeem_invitation_confirm_name(
    v_cmd_id,
    v_raw_token,
    'Carlos Silva'
  );

  if v_access_granted is not true or v_cur_name is distinct from 'Carlos Silva' then
    raise exception 'Falha TC-INV-CONFIRM-01: resgate com confirmação falhou';
  end if;

  -- Inspeciona pelo operador
  execute 'reset role';
  if not exists (
    select 1 from app_private.church_access
    where church_id = v_church_alpha and user_id = v_guest_1 and member_id = v_m_target_1
      and status = 'active' and is_admin = false
  ) then
    raise exception 'Falha TC-INV-CONFIRM-01: vínculo de acesso básico não foi criado';
  end if;

  v_token_digest := pg_catalog.sha256(pg_catalog.convert_to(v_raw_token, 'UTF8'));

  if not exists (
    select 1 from app_private.access_invitations
    where token_digest = v_token_digest and redeemed_at is not null and redeemed_by_user_id = v_guest_1
  ) then
    raise exception 'Falha TC-INV-CONFIRM-01: convite não foi marcado como consumido';
  end if;

  -- =========================================================================
  -- [CENÁRIO 7] Replay de Resgate com Confirmação (TC-INV-REPLAY-01)
  -- =========================================================================
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_guest_1::text, true);

  select access_granted into v_access_granted
  from public.redeem_invitation_confirm_name(
    v_cmd_id,
    v_raw_token,
    'Carlos Silva'
  );

  if not v_access_granted then
    raise exception 'Falha TC-INV-REPLAY-01: replay de resgate falhou';
  end if;

  -- =========================================================================
  -- [CENÁRIO 8] Tentativa de Resgate em Convite já Consumido
  -- =========================================================================
  begin
    perform public.redeem_invitation_confirm_name(
      gen_random_uuid(),
      v_raw_token,
      'Carlos Silva'
    );
    raise exception 'Falha: convite já consumido não deve ser resgatado com novo comando';
  exception when no_data_found then null; end;

  -- =========================================================================
  -- [CENÁRIO 9] Concorrência: Nome Alterado antes da Confirmação (TC-INV-CONFIRM-02)
  -- =========================================================================
  -- Emite convite para Mariana
  perform set_config('request.jwt.claim.sub', v_admin_1::text, true);
  v_cmd_id := gen_random_uuid();
  select raw_token into v_raw_token
  from public.issue_church_invitation(
    v_cmd_id,
    v_church_alpha,
    v_m_target_2,
    'mariana_guest_' || v_guest_2::text || '@example.test'
  );

  -- Admin 2 altera o nome de Mariana no cadastro antes que ela confirme
  perform set_config('request.jwt.claim.sub', v_admin_2::text, true);
  execute 'reset role';
  update app_private.members
  set display_name = 'Mariana Silva Santos Modificada'
  where id = v_m_target_2;

  -- Mariana tenta confirmar o nome original 'Mariana Silva Santos'
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_guest_2::text, true);
  begin
    perform public.redeem_invitation_confirm_name(
      gen_random_uuid(),
      v_raw_token,
      'Mariana Silva Santos'
    );
    raise exception 'Falha TC-INV-CONFIRM-02: não deve confirmar se o nome cadastrado foi modificado';
  exception when sqlstate 'P0005' then null; end;

  -- Restaura o nome de Mariana para o próximo teste
  execute 'reset role';
  update app_private.members
  set display_name = 'Mariana Silva Santos'
  where id = v_m_target_2;

  -- Reemite o convite de Mariana
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_admin_1::text, true);
  v_cmd_id := gen_random_uuid();
  select raw_token into v_raw_token
  from public.issue_church_invitation(
    v_cmd_id,
    v_church_alpha,
    v_m_target_2,
    'mariana_guest_' || v_guest_2::text || '@example.test'
  );

  -- =========================================================================
  -- [CENÁRIO 10] Resgate com Proposta de Outro Nome (TC-INV-PROPOSE-01, 02)
  -- =========================================================================
  perform set_config('request.jwt.claim.sub', v_guest_2::text, true);
  v_cmd_propose_2 := gen_random_uuid();

  v_expected_req_id_2 := null;
  v_status := null;
  select request_id, status into v_expected_req_id_2, v_status
  from public.redeem_invitation_propose_name(
    v_cmd_propose_2,
    v_raw_token,
    'Mariana dos Santos'
  );

  if v_expected_req_id_2 is null or v_status is distinct from 'pending' then
    raise exception 'Falha TC-INV-PROPOSE-01: proposta de nome não criou solicitação pendente';
  end if;

  -- Inspeciona pelo operador: cadastro de membro não alterado e sem acesso
  execute 'reset role';
  if not exists (
    select 1 from app_private.members
    where id = v_m_target_2 and display_name = 'Mariana Silva Santos'
  ) then
    raise exception 'Falha TC-INV-PROPOSE-01: proposta não deveria alterar cadastro do membro';
  end if;

  if exists (
    select 1 from app_private.church_access
    where church_id = v_church_alpha and user_id = v_guest_2
  ) then
    raise exception 'Falha TC-INV-PROPOSE-01: proposta de nome não deve conceder acesso';
  end if;

  -- =========================================================================
