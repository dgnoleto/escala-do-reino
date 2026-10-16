-- ============================================================================
-- Escala do Reino — Ensaio de Concorrência Física: Conexão A (Sessão 1)
-- Incremento: 013 / 014 (Ciclo de Vida de Membros e Restauração Elegível)
-- ============================================================================
-- Executar em uma conexão dedicada (Terminal 1 / psql Conexão A).
-- Coordena passos com a Conexão B (Terminal 2) para demonstrar serialização real,
-- bloqueios físicos comprovados (pg_blocking_pids), ausência de deadlocks e
-- resolução determinística das corridas C1.A, E17/C1.B.1, E17/C1.B.2, C2 e C3.
--
-- ATENÇÃO E GOVERNANÇA:
-- 1. Executar apenas em base local autorizada de laboratório (127.0.0.1:55332).
-- 2. NUNCA execute este script em banco de piloto remoto, homologação compartilhada ou produção.
-- 3. A Conexão A comuta para papel authenticated apenas durante as execuções de RPC.
-- 4. O script utiliza fixtures sintéticas isoladas sob prefixo de UUIDs 01300000-...
--    sem tocar nos membros, usuários ou igrejas preexistentes do laboratório.
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

-- TABELA DE COORDENAÇÃO DE SESSÕES DO LABORATÓRIO (Identificação inequívoca de PIDs)
create table if not exists app_private.rehearsal_coordination (
  session_role text primary key,
  pid integer not null,
  registered_at timestamptz not null default clock_timestamp(),
  step_status text not null default 'idle',
  last_step text,
  last_error text,
  result_payload jsonb
);

-- Registra Conexão A
insert into app_private.rehearsal_coordination (session_role, pid, step_status, last_step)
values ('session_a_013', pg_backend_pid(), 'ready', 'init')
on conflict (session_role) do update
set pid = excluded.pid, step_status = 'ready', last_step = 'init', registered_at = clock_timestamp();

-- ============================================================================
-- PASSO A0: Preparação de Fixtures Sintéticas Mínimas e Isoladas
-- ============================================================================
-- As fixtures são criadas em transação e COMITADAS para que fiquem visíveis
-- à Conexão B sob o nível de isolamento READ COMMITTED.
-- Não tocam nos 7 membros, 4 contas nem nas 2 igrejas preexistentes do laboratório.
begin;

-- 1. Usuários Auth sintéticos dedicados
insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('01300000-0000-4000-8000-0000000000a1', 'admin_a_conc013@test.lab', statement_timestamp(), '{"provider":"email"}'::jsonb, '{"name":"Admin A Conc"}'::jsonb, statement_timestamp(), statement_timestamp()),
  ('01300000-0000-4000-8000-0000000000a2', 'admin_b_conc013@test.lab', statement_timestamp(), '{"provider":"email"}'::jsonb, '{"name":"Admin B Conc"}'::jsonb, statement_timestamp(), statement_timestamp()),
  ('01300000-0000-4000-8000-0000000000u2', 'user_c1b1_conc013@test.lab', statement_timestamp(), '{"provider":"email"}'::jsonb, '{"name":"User C1B1 Conc"}'::jsonb, statement_timestamp(), statement_timestamp()),
  ('01300000-0000-4000-8000-0000000000u3', 'user_c1b2_conc013@test.lab', statement_timestamp(), '{"provider":"email"}'::jsonb, '{"name":"User C1B2 Conc"}'::jsonb, statement_timestamp(), statement_timestamp())
on conflict (id) do nothing;

-- 2. Igreja sintética dedicada ao ensaio concorrente 013
insert into app_private.churches (id, name, timezone, default_duration_policy, status, created_at, updated_at)
values
  ('01300000-0000-4000-8000-0000000000c1', 'Igreja Laboratório Concorrência 013', 'America/Sao_Paulo', 'warn', 'active', statement_timestamp(), statement_timestamp())
on conflict (id) do nothing;

-- 3. Membros sintéticos dedicados
insert into app_private.members (id, church_id, display_name, status, created_by_user_id, created_at, updated_at)
values
  -- Administradores
  ('01300000-0000-4000-8000-000000000011', '01300000-0000-4000-8000-0000000000c1', 'Pastor Admin A', 'active', '01300000-0000-4000-8000-0000000000a1', statement_timestamp(), statement_timestamp()),
  ('01300000-0000-4000-8000-000000000012', '01300000-0000-4000-8000-0000000000c1', 'Pastor Admin B', 'active', '01300000-0000-4000-8000-0000000000a1', statement_timestamp(), statement_timestamp()),
  -- Alvo C1.A (conflito de revisão updated_at)
  ('01300000-0000-4000-8000-0000000000d1', '01300000-0000-4000-8000-0000000000c1', 'Membro Alvo C1A', 'inactive', '01300000-0000-4000-8000-0000000000a1', statement_timestamp(), statement_timestamp()),
  -- Alvo C1.B.1 (E17: sem linha prévia em church_access)
  ('01300000-0000-4000-8000-0000000000d2', '01300000-0000-4000-8000-0000000000c1', 'Membro Alvo C1B1', 'inactive', '01300000-0000-4000-8000-0000000000a1', statement_timestamp(), statement_timestamp()),
  -- Alvo C1.B.2 (E17: com linha revoked existente em church_access)
  ('01300000-0000-4000-8000-0000000000d3', '01300000-0000-4000-8000-0000000000c1', 'Membro Alvo C1B2', 'inactive', '01300000-0000-4000-8000-0000000000a1', statement_timestamp(), statement_timestamp()),
  -- Alvo C2 (perda de autorização administrativa durante espera)
  ('01300000-0000-4000-8000-0000000000d4', '01300000-0000-4000-8000-0000000000c1', 'Membro Alvo C2', 'inactive', '01300000-0000-4000-8000-0000000000a1', statement_timestamp(), statement_timestamp()),
  -- Alvo C3 (replay simultâneo sob advisory lock)
  ('01300000-0000-4000-8000-0000000000d5', '01300000-0000-4000-8000-0000000000c1', 'Membro Alvo C3', 'inactive', '01300000-0000-4000-8000-0000000000a1', statement_timestamp(), statement_timestamp())
on conflict (id) do nothing;

-- 4. Vínculos de acesso em church_access
insert into app_private.church_access (
  id, church_id, user_id, member_id, is_admin, status, onboarding_completed_at, granted_by_user_id, granted_at, created_at, updated_at
) values
  -- Admin A (titular elegível)
  ('01300000-0000-4000-8000-00000000ac11', '01300000-0000-4000-8000-0000000000c1', '01300000-0000-4000-8000-0000000000a1', '01300000-0000-4000-8000-000000000011', true, 'active', statement_timestamp(), '01300000-0000-4000-8000-0000000000a1', statement_timestamp(), statement_timestamp(), statement_timestamp()),
  -- Admin B (auxiliar elegível, será revogado concorrentemente em C2)
  ('01300000-0000-4000-8000-00000000ac12', '01300000-0000-4000-8000-0000000000c1', '01300000-0000-4000-8000-0000000000a2', '01300000-0000-4000-8000-000000000012', true, 'active', statement_timestamp(), '01300000-0000-4000-8000-0000000000a1', statement_timestamp(), statement_timestamp(), statement_timestamp()),
  -- Membro C1.B.2: vínculo PRÉVIO com status = 'revoked'
  ('01300000-0000-4000-8000-00000000ac33', '01300000-0000-4000-8000-0000000000c1', '01300000-0000-4000-8000-0000000000u3', '01300000-0000-4000-8000-0000000000d3', false, 'revoked', null, '01300000-0000-4000-8000-0000000000a1', statement_timestamp(), statement_timestamp(), statement_timestamp())
on conflict (id) do nothing;

commit;

-- ============================================================================
-- CENÁRIO C1.A: Disputa Concorrente de Revisão (T0 -> T1) com Membro Inactive
-- ============================================================================
-- Objetivo: Demonstrar que a Conexão B, ao chamar restore_church_member sob revisão T0,
-- entra em espera real na linha do membro mantida por A.
-- Enquanto B espera, A altera os dados cadastrais (avançando updated_at para T1 via
-- gatilho monotônico members_touch_updated_at, mantendo status = 'inactive') e comita.
-- Ao acordar pós-commit, B valida que o status permanece inactive, mas rejeita com P0019
-- devido ao conflito de revisão otimista. Isola estritamente a revisão.

-- Passo A1.A.1: Inicia transação e retém lock de linha no membro alvo C1.A
begin;
select id from app_private.members
where id = '01300000-0000-4000-8000-0000000000d1'
for update;

-- Barreira Ativa: Comprova espera física da Conexão B retida pelo PID da Conexão A
do $barrier_c1a$
declare
  v_b_pid integer;
  v_attempts integer := 0;
begin
  select pid into v_b_pid from app_private.rehearsal_coordination where session_role = 'session_b_013';
  if v_b_pid is null then
    raise exception 'C1.A FALHA: Conexão B não registrou seu PID em rehearsal_coordination.';
  end if;

  loop
    if pg_backend_pid() = any(pg_blocking_pids(v_b_pid)) then
      exit;
    end if;
    v_attempts := v_attempts + 1;
    if v_attempts > 100 then
      raise exception 'C1.A TIMEOUT: Conexão B (PID %) não entrou em bloqueio pelo PID % em 10s.', v_b_pid, pg_backend_pid();
    end if;
    perform pg_sleep(0.1);
  end loop;

  raise notice 'C1.A CONFIRMADO: Conexão B (PID %) comprovadamente bloqueada pelo PID % em members.', v_b_pid, pg_backend_pid();
end;
$barrier_c1a$;

-- Passo A1.A.2: Mutação cadastral que avança updated_at para T1 via gatilho monotônico
update app_private.members
set display_name = 'Nome Atualizado Concorrente C1A'
where id = '01300000-0000-4000-8000-0000000000d1';

commit;
-- Ao comitar, Conexão B acorda, detecta conflito de revisão (T1 != T0) e recusa com P0019!

-- Asserção Ativa C1.A pelo Coordenador (Terminal 1 aguarda término de B):
do $assert_c1a$
declare
  v_status_b text;
  v_err_b text;
  v_member_status text;
  v_audit_count integer;
  v_receipt_count integer;
  v_attempts integer := 0;
begin
  loop
    select step_status, last_error into v_status_b, v_err_b
    from app_private.rehearsal_coordination where session_role = 'session_b_013';
    if v_status_b = 'completed_c1a' then
      exit;
    end if;
    if v_status_b = 'error_c1a' then
      raise exception 'C1.A FALHA: Conexão B reportou erro inesperado: %', v_err_b;
    end if;
    v_attempts := v_attempts + 1;
    if v_attempts > 60 then
      raise exception 'C1.A TIMEOUT: Conexão B não concluiu dentro de 6s pós-commit de A.';
    end if;
    perform pg_sleep(0.1);
  end loop;

  -- Comprova invariância do membro e ausência de efeitos colaterais
  select status into v_member_status from app_private.members where id = '01300000-0000-4000-8000-0000000000d1';
  select count(*) into v_audit_count from app_private.audit_entries where church_id = '01300000-0000-4000-8000-0000000000c1' and action = 'restore_member';
  select count(*) into v_receipt_count from app_private.command_receipts where command_id = '01300000-0000-4000-8000-000000000cb1';

  if v_member_status <> 'inactive' or v_audit_count <> 0 or v_receipt_count <> 0 then
    raise exception 'C1.A FALHA DE INVARIÂNCIA: status=%, auditorias=%, recibos=% (esperado: inactive, 0, 0)',
      v_member_status, v_audit_count, v_receipt_count;
  end if;

  raise notice 'C1.A SUCESSO: Conflito de revisão otimista P0019 comprovado com espera física e zero efeitos residuais.';
end;
$assert_c1a$;

-- ============================================================================
-- CENÁRIO E17 / C1.B.1: Concessão Concorrente de Acesso Ativo (Sem Linha Prévia)
-- ============================================================================
-- Objetivo: Alvo C1.B.1 NÃO possui linha prévia em church_access.
-- B tenta restore_church_member. No passo 3 da RPC, B faz lookup em church_access
-- (não encontra linha) e em seguida entra em espera bloqueado em members FOR UPDATE de A.
-- Enquanto B espera em members, A insere um vínculo active em church_access e comita.
-- B acorda, obtém o lock de members, e na consulta passo 4 detecta o vínculo ativo recém-comitado.
-- Desfecho esperado: B aborta com SQLSTATE P0018.

-- Passo A1.B1.1: Retém lock de linha em members no alvo C1.B.1
begin;
select id from app_private.members
where church_id = '01300000-0000-4000-8000-0000000000c1' and id = '01300000-0000-4000-8000-0000000000d2'
for update;

-- Barreira Ativa: Comprova que Conexão B entrou na fila bloqueada pelo PID de A
do $barrier_c1b1$
declare
  v_b_pid integer;
  v_attempts integer := 0;
begin
  select pid into v_b_pid from app_private.rehearsal_coordination where session_role = 'session_b_013';
  loop
    if pg_backend_pid() = any(pg_blocking_pids(v_b_pid)) then
      exit;
    end if;
    v_attempts := v_attempts + 1;
    if v_attempts > 100 then
      raise exception 'C1.B.1 TIMEOUT: Conexão B (PID %) não entrou em bloqueio pelo PID % em 10s.', v_b_pid, pg_backend_pid();
    end if;
    perform pg_sleep(0.1);
  end loop;

  raise notice 'C1.B.1 CONFIRMADO: Conexão B (PID %) comprovadamente retida na linha de members de A.', v_b_pid;
end;
$barrier_c1b1$;

-- Passo A1.B1.2: Conexão A insere vínculo ativo em church_access (simulando estado legado autorizado)
insert into app_private.church_access (
  id, church_id, user_id, member_id, is_admin, status,
  onboarding_completed_at, granted_by_user_id, granted_at, created_at, updated_at
) values (
  '01300000-0000-4000-8000-00000000ac22',
  '01300000-0000-4000-8000-0000000000c1',
  '01300000-0000-4000-8000-0000000000u2',
  '01300000-0000-4000-8000-0000000000d2',
  false, 'active', statement_timestamp(),
  '01300000-0000-4000-8000-0000000000a1',
  statement_timestamp(), statement_timestamp(), statement_timestamp()
);
-- app_private.members permanece rigorosamente inalterada (status = 'inactive')
commit;

-- Asserção Ativa C1.B.1 pelo Coordenador:
do $assert_c1b1$
declare
  v_status_b text;
  v_err_b text;
  v_member_status text;
  v_audit_count integer;
  v_attempts integer := 0;
begin
  loop
    select step_status, last_error into v_status_b, v_err_b
    from app_private.rehearsal_coordination where session_role = 'session_b_013';
    if v_status_b = 'completed_c1b1' then
      exit;
    end if;
    if v_status_b = 'error_c1b1' then
      raise exception 'C1.B.1 FALHA: Conexão B reportou erro inesperado: %', v_err_b;
    end if;
    v_attempts := v_attempts + 1;
    if v_attempts > 60 then
      raise exception 'C1.B.1 TIMEOUT: Conexão B não concluiu dentro de 6s pós-commit de A.';
    end if;
    perform pg_sleep(0.1);
  end loop;

  select status into v_member_status from app_private.members where id = '01300000-0000-4000-8000-0000000000d2';
  select count(*) into v_audit_count from app_private.audit_entries where church_id = '01300000-0000-4000-8000-0000000000c1' and action = 'restore_member';

  if v_member_status <> 'inactive' or v_audit_count <> 0 then
    raise exception 'C1.B.1 FALHA DE INVARIÂNCIA: status=%, auditorias=% (esperado: inactive, 0)', v_member_status, v_audit_count;
  end if;

  raise notice 'C1.B.1 SUCESSO: Guarda de acesso ativo legado (P0018) comprovada na ausência prévia de vínculo.';
end;
$assert_c1b1$;

-- ============================================================================
-- CENÁRIO E17 / C1.B.2: Concessão Concorrente de Acesso Ativo (Com Linha Revoked)
-- ============================================================================
-- Objetivo: Alvo C1.B.2 POSSUI linha prévia com status = 'revoked' em church_access.
-- Ordem canônica estrita da RPC 013: church_access FOR UPDATE e depois members FOR UPDATE.
-- Para prevenir deadlocks circulares de teste, Conexão A bloqueia na MESMA ordem canônica.
-- Conexão B bloqueia na linha de church_access retida por A antes de alcançar members.
-- Conexão A reativa o acesso para active e comita.
-- Conexão B acorda, obtém church_access e members, e no passo 4 detecta active access.
-- Desfecho esperado: B recusa com P0018, sem mutação em members e sem auditoria/recibo de B.

-- Passo A1.B2.1: Inicia transação retendo church_access e depois members na ordem canônica
begin;
select id from app_private.church_access
where church_id = '01300000-0000-4000-8000-0000000000c1' and member_id = '01300000-0000-4000-8000-0000000000d3'
for update;

select id from app_private.members
where church_id = '01300000-0000-4000-8000-0000000000c1' and id = '01300000-0000-4000-8000-0000000000d3'
for update;

-- Barreira Ativa: Comprova que Conexão B bloqueou no lock de church_access mantido por A
do $barrier_c1b2$
declare
  v_b_pid integer;
  v_attempts integer := 0;
begin
  select pid into v_b_pid from app_private.rehearsal_coordination where session_role = 'session_b_013';
  loop
    if pg_backend_pid() = any(pg_blocking_pids(v_b_pid)) then
      exit;
    end if;
    v_attempts := v_attempts + 1;
    if v_attempts > 100 then
      raise exception 'C1.B.2 TIMEOUT: Conexão B (PID %) não entrou em bloqueio pelo PID % em 10s.', v_b_pid, pg_backend_pid();
    end if;
    perform pg_sleep(0.1);
  end loop;

  raise notice 'C1.B.2 CONFIRMADO: Conexão B (PID %) bloqueada na linha de church_access antes de members.', v_b_pid;
end;
$barrier_c1b2$;

-- Passo A1.B2.2: Conexão A atualiza o vínculo para active preservando members intacto
update app_private.church_access
set status = 'active',
    onboarding_completed_at = statement_timestamp(),
    granted_by_user_id = '01300000-0000-4000-8000-0000000000a1',
    granted_at = statement_timestamp(),
    revoked_at = null,
    revoked_by_user_id = null,
    updated_at = statement_timestamp()
where church_id = '01300000-0000-4000-8000-0000000000c1' and member_id = '01300000-0000-4000-8000-0000000000d3';

commit;

-- Asserção Ativa C1.B.2 pelo Coordenador:
do $assert_c1b2$
declare
  v_status_b text;
  v_err_b text;
  v_member_status text;
  v_audit_count integer;
  v_attempts integer := 0;
begin
  loop
    select step_status, last_error into v_status_b, v_err_b
    from app_private.rehearsal_coordination where session_role = 'session_b_013';
    if v_status_b = 'completed_c1b2' then
      exit;
    end if;
    if v_status_b = 'error_c1b2' then
      raise exception 'C1.B.2 FALHA: Conexão B reportou erro inesperado: %', v_err_b;
    end if;
    v_attempts := v_attempts + 1;
    if v_attempts > 60 then
      raise exception 'C1.B.2 TIMEOUT: Conexão B não concluiu dentro de 6s pós-commit de A.';
    end if;
    perform pg_sleep(0.1);
  end loop;

  select status into v_member_status from app_private.members where id = '01300000-0000-4000-8000-0000000000d3';
  select count(*) into v_audit_count from app_private.audit_entries where church_id = '01300000-0000-4000-8000-0000000000c1' and action = 'restore_member';

  if v_member_status <> 'inactive' or v_audit_count <> 0 then
    raise exception 'C1.B.2 FALHA DE INVARIÂNCIA: status=%, auditorias=% (esperado: inactive, 0)', v_member_status, v_audit_count;
  end if;

  raise notice 'C1.B.2 SUCESSO: Guarda de acesso ativo legado (P0018) comprovada na variante revoked com ordem canônica.';
end;
$assert_c1b2$;

-- ============================================================================
-- CENÁRIO C2: Perda de Autorização Administrativa do Operador Durante a Espera
-- ============================================================================
-- Objetivo: Operador B é admin autorizado ao iniciar a RPC. Bloqueia aguardando members.
-- Enquanto B espera na fila de lock, Operador A revoga formalmente o privilégio de B
-- em church_access (status = 'revoked') e comita.
-- B acorda pós-commit de A. A revalidação passo 5 da RPC detecta a perda de elegibilidade
-- antes de qualquer mutação e aborta com 42501.

-- Passo A2.1: Conexão A retém lock de linha no membro alvo C2
begin;
select id from app_private.members
where id = '01300000-0000-4000-8000-0000000000d4'
for update;

-- Barreira Ativa: Comprova que Conexão B (atuando como Admin B) bloqueou pelo PID de A
do $barrier_c2$
declare
  v_b_pid integer;
  v_attempts integer := 0;
begin
  select pid into v_b_pid from app_private.rehearsal_coordination where session_role = 'session_b_013';
  loop
    if pg_backend_pid() = any(pg_blocking_pids(v_b_pid)) then
      exit;
    end if;
    v_attempts := v_attempts + 1;
    if v_attempts > 100 then
      raise exception 'C2 TIMEOUT: Conexão B (PID %) não entrou em bloqueio pelo PID % em 10s.', v_b_pid, pg_backend_pid();
    end if;
    perform pg_sleep(0.1);
  end loop;

  raise notice 'C2 CONFIRMADO: Conexão B (PID %) bloqueada na linha de members do alvo C2.', v_b_pid;
end;
$barrier_c2$;

-- Passo A2.2: Conexão A revoga o vínculo de acesso de Admin B com metadados completos
update app_private.church_access
set status = 'revoked',
    revoked_by_user_id = '01300000-0000-4000-8000-0000000000a1',
    revoked_at = statement_timestamp(),
    updated_at = statement_timestamp()
where church_id = '01300000-0000-4000-8000-0000000000c1'
  and user_id = '01300000-0000-4000-8000-0000000000a2';

commit;

-- Asserção Ativa C2 pelo Coordenador:
do $assert_c2$
declare
  v_status_b text;
  v_err_b text;
  v_member_status text;
  v_audit_count integer;
  v_attempts integer := 0;
begin
  loop
    select step_status, last_error into v_status_b, v_err_b
    from app_private.rehearsal_coordination where session_role = 'session_b_013';
    if v_status_b = 'completed_c2' then
      exit;
    end if;
    if v_status_b = 'error_c2' then
      raise exception 'C2 FALHA: Conexão B reportou erro inesperado: %', v_err_b;
    end if;
    v_attempts := v_attempts + 1;
    if v_attempts > 60 then
      raise exception 'C2 TIMEOUT: Conexão B não concluiu dentro de 6s pós-commit de A.';
    end if;
    perform pg_sleep(0.1);
  end loop;

  select status into v_member_status from app_private.members where id = '01300000-0000-4000-8000-0000000000d4';
  select count(*) into v_audit_count from app_private.audit_entries where church_id = '01300000-0000-4000-8000-0000000000c1' and action = 'restore_member';

  if v_member_status <> 'inactive' or v_audit_count <> 0 then
    raise exception 'C2 FALHA DE INVARIÂNCIA: status=%, auditorias=% (esperado: inactive, 0)', v_member_status, v_audit_count;
  end if;

  raise notice 'C2 SUCESSO: Perda de autorização durante espera física detectada com 42501 e zero mutação.';
end;
$assert_c2$;

-- ============================================================================
-- CENÁRIO C3: Replay Simultâneo do Mesmo Comando com Advisory Lock Transacional
-- ============================================================================
-- Objetivo: Duas conexões concorrentes chamam restore_church_member com o MESMO command_id.
-- Conexão A adquire o advisory lock pg_advisory_xact_lock(hashtext(user_id), hashtext(command_id)).
-- Conexão B tenta chamar a RPC com o mesmo command_id e fica retida no advisory lock de A.
-- Conexão A executa a restauração com sucesso, gravando recibo e auditoria, e comita.
-- Conexão B acorda pós-commit de A, detecta o recibo gravado, valida params_hash e retorna
-- o replay idempotente com sucesso idêntico sem duplicar mutação em members nem em audit_entries.

-- Passo A3.1: Conexão A inicia transação e adquire o advisory lock transacional
begin;
select pg_advisory_xact_lock(
  hashtext('01300000-0000-4000-8000-0000000000a1'),
  hashtext('01300000-0000-4000-8000-000000000cc3')
);

-- Barreira Ativa: Comprova que Conexão B está na fila de espera do advisory lock de A
do $barrier_c3$
declare
  v_b_pid integer;
  v_attempts integer := 0;
begin
  select pid into v_b_pid from app_private.rehearsal_coordination where session_role = 'session_b_013';
  loop
    if pg_backend_pid() = any(pg_blocking_pids(v_b_pid)) then
      exit;
    end if;
    v_attempts := v_attempts + 1;
    if v_attempts > 100 then
      raise exception 'C3 TIMEOUT: Conexão B (PID %) não entrou em bloqueio pelo PID % em 10s.', v_b_pid, pg_backend_pid();
    end if;
    perform pg_sleep(0.1);
  end loop;

  raise notice 'C3 CONFIRMADO: Conexão B (PID %) retida no advisory lock transacional de A.', v_b_pid;
end;
$barrier_c3$;

-- Passo A3.2: Conexão A comuta para papel authenticated e executa a restauração elegível
set local role authenticated;
select set_config('request.jwt.claim.sub', '01300000-0000-4000-8000-0000000000a1', true);

select * from public.restore_church_member(
  '01300000-0000-4000-8000-0000000000c1'::uuid,
  '01300000-0000-4000-8000-000000000cc3'::uuid,
  '01300000-0000-4000-8000-0000000000d5'::uuid,
  (
    select to_char(m.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    from app_private.members m
    where m.id = '01300000-0000-4000-8000-0000000000d5'
  )
);

commit;
-- Ao comitar, Conexão B acorda, localiza o recibo comitado por A e retorna replay idêntico!

-- Asserção Ativa C3 pelo Coordenador:
do $assert_c3$
declare
  v_status_b text;
  v_err_b text;
  v_member_status text;
  v_audit_count integer;
  v_receipt_count integer;
  v_attempts integer := 0;
begin
  loop
    select step_status, last_error into v_status_b, v_err_b
    from app_private.rehearsal_coordination where session_role = 'session_b_013';
    if v_status_b = 'completed_c3' then
      exit;
    end if;
    if v_status_b = 'error_c3' then
      raise exception 'C3 FALHA: Conexão B reportou erro inesperado: %', v_err_b;
    end if;
    v_attempts := v_attempts + 1;
    if v_attempts > 60 then
      raise exception 'C3 TIMEOUT: Conexão B não concluiu dentro de 6s pós-commit de A.';
    end if;
    perform pg_sleep(0.1);
  end loop;

  select status into v_member_status from app_private.members where id = '01300000-0000-4000-8000-0000000000d5';
  select count(*) into v_audit_count from app_private.audit_entries where church_id = '01300000-0000-4000-8000-0000000000c1' and action = 'restore_member';
  select count(*) into v_receipt_count from app_private.command_receipts where command_id = '01300000-0000-4000-8000-000000000cc3';

  if v_member_status <> 'active' or v_audit_count <> 1 or v_receipt_count <> 1 then
    raise exception 'C3 FALHA: status=%, auditorias=% (esperado 1), recibos=% (esperado 1)',
      v_member_status, v_audit_count, v_receipt_count;
  end if;

  raise notice 'C3 SUCESSO: Replay simultâneo sob advisory lock comprovado sem duplicidade de recibo ou auditoria.';
end;
$assert_c3$;

-- ============================================================================
-- PROTOCOLO DE LIMPEZA E REVERSÃO EXATA DAS FIXTURES SINTÉTICAS
-- ============================================================================
-- Remove estritamente as entidades criadas para este ensaio concorrente,
-- checando identificadores explícitos (01300000-...).
-- Preserva integralmente os 7 membros, 4 usuários e 2 igrejas originais do laboratório.
begin;

delete from app_private.command_receipts
where command_id = '01300000-0000-4000-8000-000000000cc3'
   or church_id = '01300000-0000-4000-8000-0000000000c1';

delete from app_private.audit_entries
where church_id = '01300000-0000-4000-8000-0000000000c1';

delete from app_private.church_access
where church_id = '01300000-0000-4000-8000-0000000000c1';

delete from app_private.members
where church_id = '01300000-0000-4000-8000-0000000000c1';

delete from app_private.churches
where id = '01300000-0000-4000-8000-0000000000c1';

delete from auth.users
where id in (
  '01300000-0000-4000-8000-0000000000a1',
  '01300000-0000-4000-8000-0000000000a2',
  '01300000-0000-4000-8000-0000000000u2',
  '01300000-0000-4000-8000-0000000000u3'
);

delete from app_private.rehearsal_coordination
where session_role in ('session_a_013', 'session_b_013');

commit;

-- Conferência final de preservação do laboratório original
do $assert_preservation$
declare
  v_member_count integer;
  v_user_count integer;
  v_church_count integer;
begin
  select count(*) into v_member_count from app_private.members;
  select count(*) into v_user_count from auth.users;
  select count(*) into v_church_count from app_private.churches;

  if v_member_count < 7 or v_user_count < 4 or v_church_count < 2 then
    raise exception 'PRESERVAÇÃO FALHOU: Contagem residual abaixo do baseline original (members: %, users: %, churches: %).',
      v_member_count, v_user_count, v_church_count;
  end if;

  raise notice 'ENSAIO 013 CONCLUÍDO COM SUCESSO: todas as corridas validadas e fixtures sintéticas revertidas com perfeição.';
end;
$assert_preservation$;
