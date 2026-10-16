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
-- 1. Executar apenas em base local autorizada de laboratório (127.0.0.1:55332 / container local).
-- 2. NUNCA execute este script em banco de piloto remoto, homologação compartilhada ou produção.
-- 3. A Conexão A comuta para papel authenticated apenas durante as execuções de RPC.
-- 4. O script utiliza fixtures sintéticas isoladas sob manifesto estrito de UUIDs 01300000-...
--    sem tocar nos membros, usuários ou igrejas preexistentes do laboratório.
-- 5. Interrupção imediata em caso de erro (\set ON_ERROR_STOP on).
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

-- TABELA DE COORDENAÇÃO DE SESSÕES DO LABORATÓRIO (Identificação inequívoca de PIDs)
-- Comprova ausência prévia e cria a tabela exclusivamente para este ensaio
do $check_coord_table$
begin
  if to_regclass('app_private.rehearsal_coordination') is not null then
    raise exception 'COLISÃO PRÉVIA DETECTADA: Tabela app_private.rehearsal_coordination já existe. Abortando para evitar sobrescrever coordenação preexistente.'
      using errcode = '23505';
  end if;
end;
$check_coord_table$;

create table app_private.rehearsal_coordination (
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
values ('session_a_013', pg_backend_pid(), 'ready', 'init');

-- ============================================================================
-- PASSO A0: Pré-Checagem de Colisão e Preparação de Fixtures Mínimas Isoladas
-- ============================================================================
-- Verifica previamente se qualquer um dos identificadores do manifesto já existe.
-- Rejeita imediatamente em caso de colisão, sem adoção silenciosa via ON CONFLICT DO NOTHING.
do $precheck_collision$
begin
  if exists (
    select 1 from auth.users
    where id in (
      '01300000-0000-4000-8000-0000000000a1',
      '01300000-0000-4000-8000-0000000000a2',
      '01300000-0000-4000-8000-0000000000b2',
      '01300000-0000-4000-8000-0000000000b3'
    )
  ) or exists (
    select 1 from app_private.churches
    where id = '01300000-0000-4000-8000-0000000000c1'
  ) or exists (
    select 1 from app_private.members
    where id in (
      '01300000-0000-4000-8000-000000000011',
      '01300000-0000-4000-8000-000000000012',
      '01300000-0000-4000-8000-0000000000d1',
      '01300000-0000-4000-8000-0000000000d2',
      '01300000-0000-4000-8000-0000000000d3',
      '01300000-0000-4000-8000-0000000000d4',
      '01300000-0000-4000-8000-0000000000d5'
    )
  ) or exists (
    select 1 from app_private.church_access
    where id in (
      '01300000-0000-4000-8000-00000000ac11',
      '01300000-0000-4000-8000-00000000ac12',
      '01300000-0000-4000-8000-00000000ac22',
      '01300000-0000-4000-8000-00000000ac33'
    )
  ) then
    raise exception 'COLISÃO PRÉVIA DETECTADA: Identificadores de fixtures do ensaio 013 já existem no banco. Abortando sem adotar dados preexistentes.'
      using errcode = '23505';
  end if;
end;
$precheck_collision$;

begin;

-- 1. Usuários Auth sintéticos dedicados (UUIDs estritamente válidos, sem caracteres ilegais)
insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('01300000-0000-4000-8000-0000000000a1', 'admin_a_conc013@test.lab', statement_timestamp(), '{"provider":"email"}'::jsonb, '{"name":"Admin A Conc"}'::jsonb, statement_timestamp(), statement_timestamp()),
  ('01300000-0000-4000-8000-0000000000a2', 'admin_b_conc013@test.lab', statement_timestamp(), '{"provider":"email"}'::jsonb, '{"name":"Admin B Conc"}'::jsonb, statement_timestamp(), statement_timestamp()),
  ('01300000-0000-4000-8000-0000000000b2', 'user_c1b1_conc013@test.lab', statement_timestamp(), '{"provider":"email"}'::jsonb, '{"name":"User C1B1 Conc"}'::jsonb, statement_timestamp(), statement_timestamp()),
  ('01300000-0000-4000-8000-0000000000b3', 'user_c1b2_conc013@test.lab', statement_timestamp(), '{"provider":"email"}'::jsonb, '{"name":"User C1B2 Conc"}'::jsonb, statement_timestamp(), statement_timestamp());

-- 2. Igreja sintética dedicada ao ensaio concorrente 013
insert into app_private.churches (id, name, timezone, default_duration_policy, status, created_at, updated_at)
values
  ('01300000-0000-4000-8000-0000000000c1', 'Igreja Laboratório Concorrência 013', 'America/Sao_Paulo', 'warn', 'active', statement_timestamp(), statement_timestamp());

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
  ('01300000-0000-4000-8000-0000000000d5', '01300000-0000-4000-8000-0000000000c1', 'Membro Alvo C3', 'inactive', '01300000-0000-4000-8000-0000000000a1', statement_timestamp(), statement_timestamp());

-- 4. Vínculos de acesso em church_access
insert into app_private.church_access (
  id, church_id, user_id, member_id, is_admin, status, onboarding_completed_at,
  granted_by_user_id, granted_at, revoked_by_user_id, revoked_at, created_at, updated_at
) values
  -- Admin A (titular elegível)
  ('01300000-0000-4000-8000-00000000ac11', '01300000-0000-4000-8000-0000000000c1', '01300000-0000-4000-8000-0000000000a1', '01300000-0000-4000-8000-000000000011', true, 'active', statement_timestamp(), '01300000-0000-4000-8000-0000000000a1', statement_timestamp(), null, null, statement_timestamp(), statement_timestamp()),
  -- Admin B (auxiliar elegível, será revogado concorrentemente em C2)
  ('01300000-0000-4000-8000-00000000ac12', '01300000-0000-4000-8000-0000000000c1', '01300000-0000-4000-8000-0000000000a2', '01300000-0000-4000-8000-000000000012', true, 'active', statement_timestamp(), '01300000-0000-4000-8000-0000000000a1', statement_timestamp(), null, null, statement_timestamp(), statement_timestamp()),
  -- Membro C1.B.2: vínculo PRÉVIO com status = 'revoked' (com metadados completos de revogação exigidos pelo schema)
  ('01300000-0000-4000-8000-00000000ac33', '01300000-0000-4000-8000-0000000000c1', '01300000-0000-4000-8000-0000000000b3', '01300000-0000-4000-8000-0000000000d3', false, 'revoked', null, '01300000-0000-4000-8000-0000000000a1', statement_timestamp(), '01300000-0000-4000-8000-0000000000a1', statement_timestamp(), statement_timestamp(), statement_timestamp());

commit;

-- Handshake Inicial: Conexão A aguarda Conexão B registrar seu PID em rehearsal_coordination
do $wait_session_b_init$
declare
  v_b_pid integer;
  v_attempts integer := 0;
begin
  loop
    select pid into v_b_pid from app_private.rehearsal_coordination where session_role = 'session_b_013';
    if v_b_pid is not null then
      exit;
    end if;
    v_attempts := v_attempts + 1;
    if v_attempts > 100 then
      raise exception 'TIMEOUT: Conexão B não registrou seu PID em rehearsal_coordination em 10s.';
    end if;
    perform pg_sleep(0.1);
  end loop;
  raise notice 'Conexão B detectada com PID %.', v_b_pid;
end;
$wait_session_b_init$;

-- ============================================================================
-- CENÁRIO C1.A: Disputa Concorrente de Revisão (T0 -> T1) com Membro Inactive
-- ============================================================================
-- Handshake: A retém portão consultivo (gate_c1a) -> publica holding_c1a -> inicia transação e retém lock FOR UPDATE
-- Lock obtido comprovadamente -> A libera portão consultivo -> B dispara RPC e entra em espera física
-- A verifica bloqueio físico via pg_blocking_pids -> comita mutação cadastral (avançando T0 -> T1)
-- B acorda pós-commit de A e captura P0019 -> A aguarda B registrar término e consome o resultado

select pg_advisory_lock(hashtext('gate_c1a'));

update app_private.rehearsal_coordination
set step_status = 'holding_c1a', last_step = 'c1a'
where session_role = 'session_a_013';

begin;
select id from app_private.members
where id = '01300000-0000-4000-8000-0000000000d1'
for update;

-- Lock em members GARANTIDAMENTE obtido por A. Libera o portão para B:
select pg_advisory_unlock(hashtext('gate_c1a'));

do $barrier_c1a$
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
      raise exception 'C1.A TIMEOUT: Conexão B (PID %) não entrou em bloqueio pelo PID % em 10s.', v_b_pid, pg_backend_pid();
    end if;
    perform pg_sleep(0.1);
  end loop;

  raise notice 'C1.A CONFIRMADO: Conexão B (PID %) comprovadamente bloqueada pelo PID % em members.', v_b_pid, pg_backend_pid();
end;
$barrier_c1a$;

update app_private.members
set display_name = 'Nome Atualizado Concorrente C1A'
where id = '01300000-0000-4000-8000-0000000000d1';

commit;

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

  select status into v_member_status from app_private.members where id = '01300000-0000-4000-8000-0000000000d1';
  select count(*) into v_audit_count from app_private.audit_entries where church_id = '01300000-0000-4000-8000-0000000000c1' and action = 'restore_member';
  select count(*) into v_receipt_count from app_private.command_receipts where command_id = '01300000-0000-4000-8000-000000000cb1';

  if v_member_status is distinct from 'inactive' or v_audit_count is distinct from 0 or v_receipt_count is distinct from 0 then
    raise exception 'C1.A FALHA DE INVARIÂNCIA: status=%, auditorias=%, recibos=% (esperado: inactive, 0, 0)',
      v_member_status, v_audit_count, v_receipt_count;
  end if;

  raise notice 'C1.A SUCESSO: Conflito de revisão otimista P0019 comprovado com espera física e zero efeitos colaterais.';
end;
$assert_c1a$;

-- ============================================================================
-- CENÁRIO E17 / C1.B.1: Concessão Concorrente de Acesso Ativo (Sem Linha Prévia)
-- ============================================================================
select pg_advisory_lock(hashtext('gate_c1b1'));

update app_private.rehearsal_coordination
set step_status = 'holding_c1b1', last_step = 'c1b1'
where session_role = 'session_a_013';

begin;
select id from app_private.members
where church_id = '01300000-0000-4000-8000-0000000000c1' and id = '01300000-0000-4000-8000-0000000000d2'
for update;

-- Lock em members GARANTIDAMENTE obtido por A. Libera o portão para B:
select pg_advisory_unlock(hashtext('gate_c1b1'));

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

  raise notice 'C1.B.1 CONFIRMADO: Conexão B (PID %) retida na linha de members de A.', v_b_pid;
end;
$barrier_c1b1$;

insert into app_private.church_access (
  id, church_id, user_id, member_id, is_admin, status,
  onboarding_completed_at, granted_by_user_id, granted_at, created_at, updated_at
) values (
  '01300000-0000-4000-8000-00000000ac22',
  '01300000-0000-4000-8000-0000000000c1',
  '01300000-0000-4000-8000-0000000000b2',
  '01300000-0000-4000-8000-0000000000d2',
  false, 'active', statement_timestamp(),
  '01300000-0000-4000-8000-0000000000a1',
  statement_timestamp(), statement_timestamp(), statement_timestamp()
);

commit;

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

  if v_member_status is distinct from 'inactive' or v_audit_count is distinct from 0 then
    raise exception 'C1.B.1 FALHA DE INVARIÂNCIA: status=%, auditorias=% (esperado: inactive, 0)', v_member_status, v_audit_count;
  end if;

  raise notice 'C1.B.1 SUCESSO: Guarda de acesso ativo legado (P0018) comprovada na ausência prévia de vínculo.';
end;
$assert_c1b1$;

-- ============================================================================
-- CENÁRIO E17 / C1.B.2: Concessão Concorrente de Acesso Ativo (Com Linha Revoked)
-- ============================================================================
select pg_advisory_lock(hashtext('gate_c1b2'));

update app_private.rehearsal_coordination
set step_status = 'holding_c1b2', last_step = 'c1b2'
where session_role = 'session_a_013';

begin;
select id from app_private.church_access
where church_id = '01300000-0000-4000-8000-0000000000c1' and member_id = '01300000-0000-4000-8000-0000000000d3'
for update;

select id from app_private.members
where church_id = '01300000-0000-4000-8000-0000000000c1' and id = '01300000-0000-4000-8000-0000000000d3'
for update;

-- Lock em church_access e members GARANTIDAMENTE obtido por A. Libera portão:
select pg_advisory_unlock(hashtext('gate_c1b2'));

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

  if v_member_status is distinct from 'inactive' or v_audit_count is distinct from 0 then
    raise exception 'C1.B.2 FALHA DE INVARIÂNCIA: status=%, auditorias=% (esperado: inactive, 0)', v_member_status, v_audit_count;
  end if;

  raise notice 'C1.B.2 SUCESSO: Guarda de acesso ativo legado (P0018) comprovada na variante revoked com ordem canônica.';
end;
$assert_c1b2$;

-- ============================================================================
-- CENÁRIO C2: Perda de Autorização Administrativa Durante a Espera
-- ============================================================================
select pg_advisory_lock(hashtext('gate_c2'));

update app_private.rehearsal_coordination
set step_status = 'holding_c2', last_step = 'c2'
where session_role = 'session_a_013';

begin;
select id from app_private.members
where id = '01300000-0000-4000-8000-0000000000d4'
for update;

-- Lock em members GARANTIDAMENTE obtido por A. Libera portão:
select pg_advisory_unlock(hashtext('gate_c2'));

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

update app_private.church_access
set status = 'revoked',
    revoked_by_user_id = '01300000-0000-4000-8000-0000000000a1',
    revoked_at = statement_timestamp(),
    updated_at = statement_timestamp()
where church_id = '01300000-0000-4000-8000-0000000000c1'
  and user_id = '01300000-0000-4000-8000-0000000000a2';

commit;

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

  if v_member_status is distinct from 'inactive' or v_audit_count is distinct from 0 then
    raise exception 'C2 FALHA DE INVARIÂNCIA: status=%, auditorias=% (esperado: inactive, 0)', v_member_status, v_audit_count;
  end if;

  raise notice 'C2 SUCESSO: Perda de autorização durante espera física detectada com 42501 e zero mutação.';
end;
$assert_c2$;

-- ============================================================================
-- CENÁRIO C3: Replay Simultâneo do Mesmo Comando com Advisory Lock Transacional
-- ============================================================================
-- 1. Captura da revisão T0 estritamente sob o papel de manutenção antes de qualquer lock
do $prep_c3$
declare
  v_t0_str text;
begin
  select to_char(m.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') into v_t0_str
  from app_private.members m
  where m.id = '01300000-0000-4000-8000-0000000000d5';

  -- Salva v_t0_str para ser compartilhado deterministicamente com B antes de anunciar holding_c3
  update app_private.rehearsal_coordination
  set result_payload = jsonb_build_object('c3_t0_str', v_t0_str)
  where session_role = 'session_a_013';
end;
$prep_c3$;

-- 2. Conexão A retém o portão consultivo gate_c3 antes de sinalizar holding_c3
select pg_advisory_lock(hashtext('gate_c3'));

update app_private.rehearsal_coordination
set step_status = 'holding_c3', last_step = 'c3'
where session_role = 'session_a_013';

begin;
select pg_advisory_xact_lock(
  hashtext('01300000-0000-4000-8000-0000000000a1'),
  hashtext('01300000-0000-4000-8000-000000000cc3')
);

-- Advisory xact lock garantidamente retido por A. Libera portão para B:
select pg_advisory_unlock(hashtext('gate_c3'));

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

-- Executa chamada sob authenticated passando o parâmetro pré-capturado
do $call_c3_a$
declare
  v_t0_str text;
  v_rec record;
begin
  select result_payload->>'c3_t0_str' into v_t0_str
  from app_private.rehearsal_coordination where session_role = 'session_a_013';

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', '01300000-0000-4000-8000-0000000000a1', true);

  select * into v_rec from public.restore_church_member(
    '01300000-0000-4000-8000-0000000000c1'::uuid,
    '01300000-0000-4000-8000-000000000cc3'::uuid,
    '01300000-0000-4000-8000-0000000000d5'::uuid,
    v_t0_str
  );

  execute 'reset role';

  update app_private.rehearsal_coordination
  set result_payload = jsonb_build_object(
    'command_id', v_rec.command_id,
    'action', v_rec.action,
    'church_id', v_rec.church_id,
    'result_member_id', v_rec.result_member_id,
    'result_payload', v_rec.result_payload,
    'created_at', to_char(v_rec.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  )
  where session_role = 'session_a_013';
end;
$call_c3_a$;

commit;

-- Asserção Ativa C3 pelo Coordenador (Compara todas as seis colunas reais e payload com o replay de B)
do $assert_c3$
declare
  v_status_b text;
  v_err_b text;
  v_payload_a jsonb;
  v_payload_b jsonb;
  v_member_status text;
  v_audit_count integer;
  v_receipt_count integer;
  v_attempts integer := 0;
begin
  loop
    select step_status, last_error, result_payload into v_status_b, v_err_b, v_payload_b
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

  select result_payload into v_payload_a
  from app_private.rehearsal_coordination where session_role = 'session_a_013';

  -- Comparação estrita campo a campo das seis colunas e dados reais do payload
  if (v_payload_a->>'command_id') is null
     or (v_payload_a->>'command_id') is distinct from (v_payload_b->>'command_id')
     or (v_payload_a->>'action') is distinct from 'restore_member'
     or (v_payload_b->>'action') is distinct from 'restore_member'
     or (v_payload_a->>'church_id') is distinct from '01300000-0000-4000-8000-0000000000c1'
     or (v_payload_b->>'church_id') is distinct from '01300000-0000-4000-8000-0000000000c1'
     or (v_payload_a->>'result_member_id') is distinct from '01300000-0000-4000-8000-0000000000d5'
     or (v_payload_b->>'result_member_id') is distinct from '01300000-0000-4000-8000-0000000000d5'
     or (v_payload_a->'result_payload'->>'status') is distinct from 'active'
     or (v_payload_b->'result_payload'->>'status') is distinct from 'active'
     or (v_payload_a->'result_payload'->>'restored_at') is null
     or (v_payload_b->'result_payload'->>'restored_at') is null
     or (v_payload_a->'result_payload'->>'restored_at') is distinct from (v_payload_b->'result_payload'->>'restored_at')
     or (v_payload_a->'result_payload'->>'updated_at') is null
     or (v_payload_b->'result_payload'->>'updated_at') is null
     or (v_payload_a->'result_payload'->>'updated_at') is distinct from (v_payload_b->'result_payload'->>'updated_at')
     or (v_payload_a->>'created_at') is null
     or (v_payload_b->>'created_at') is null
     or (v_payload_a->>'created_at') is distinct from (v_payload_b->>'created_at') then
    raise exception 'C3 FALHA DE REPLAY: Campos reais do recibo e replay divergiram: A=%, B=%',
      v_payload_a, v_payload_b;
  end if;

  select status into v_member_status from app_private.members where id = '01300000-0000-4000-8000-0000000000d5';
  select count(*) into v_audit_count from app_private.audit_entries where church_id = '01300000-0000-4000-8000-0000000000c1' and action = 'restore_member';
  select count(*) into v_receipt_count from app_private.command_receipts where command_id = '01300000-0000-4000-8000-000000000cc3';

  if v_member_status is distinct from 'active' or v_audit_count is distinct from 1 or v_receipt_count is distinct from 1 then
    raise exception 'C3 FALHA: status=%, auditorias=% (esperado 1), recibos=% (esperado 1)',
      v_member_status, v_audit_count, v_receipt_count;
  end if;

  raise notice 'C3 SUCESSO: Replay simultâneo sob advisory lock comprovado com campos idênticos e efeito único (1 auditoria, 1 recibo).';
end;
$assert_c3$;

-- ============================================================================
-- PROTOCOLO DE LIMPEZA E REVERSÃO EXATA DAS FIXTURES SINTÉTICAS
-- ============================================================================
-- Correção F5/R4: Procedimento excepcional de manutenção explícito e revisável,
-- restrito às fixtures do manifesto. 
-- ATENÇÃO AO ESCOPO: ALTER TABLE ... DISABLE TRIGGER atua em nível de tabela
-- inteira (requer ACCESS EXCLUSIVE lock no PostgreSQL), e NÃO apenas nas linhas
-- da fixture sintética. Por isso, é MANDATÓRIO estabelecer lock_timeout curto
-- (5s) para não enfileirar bloqueios em produção, executar em transação ultra-curta,
-- verificar previamente o estado ativo dos gatilhos e comprovar imediatamente
-- a reativação (tgenabled = 'O'). Ao final, a tabela efêmera de coordenação
-- app_private.rehearsal_coordination é eliminada (DROP TABLE).
do $verify_triggers_active_before_cleanup$
begin
  if (
    select count(*) from pg_catalog.pg_trigger
    where tgname in ('church_access_protect_last_admin', 'members_protect_last_admin')
      and tgenabled = 'O'
  ) <> 2 then
    raise exception 'ABORTANDO LIMPEZA: Os gatilhos de segurança não estão em estado normal (O) antes da manutenção!';
  end if;
end;
$verify_triggers_active_before_cleanup$;

begin;

set local lock_timeout = '5s';

alter table app_private.church_access disable trigger church_access_protect_last_admin;
alter table app_private.members disable trigger members_protect_last_admin;

delete from app_private.command_receipts
where command_id = '01300000-0000-4000-8000-000000000cc3'
   or church_id = '01300000-0000-4000-8000-0000000000c1';

delete from app_private.audit_entries
where church_id = '01300000-0000-4000-8000-0000000000c1';

delete from app_private.church_access
where id in (
  '01300000-0000-4000-8000-00000000ac11',
  '01300000-0000-4000-8000-00000000ac12',
  '01300000-0000-4000-8000-00000000ac22',
  '01300000-0000-4000-8000-00000000ac33'
);

delete from app_private.members
where id in (
  '01300000-0000-4000-8000-000000000011',
  '01300000-0000-4000-8000-000000000012',
  '01300000-0000-4000-8000-0000000000d1',
  '01300000-0000-4000-8000-0000000000d2',
  '01300000-0000-4000-8000-0000000000d3',
  '01300000-0000-4000-8000-0000000000d4',
  '01300000-0000-4000-8000-0000000000d5'
);

delete from app_private.churches
where id = '01300000-0000-4000-8000-0000000000c1';

delete from auth.users
where id in (
  '01300000-0000-4000-8000-0000000000a1',
  '01300000-0000-4000-8000-0000000000a2',
  '01300000-0000-4000-8000-0000000000b2',
  '01300000-0000-4000-8000-0000000000b3'
);

alter table app_private.members enable trigger members_protect_last_admin;
alter table app_private.church_access enable trigger church_access_protect_last_admin;

commit;

-- Elimina a tabela efêmera de coordenação após conclusão de ambas as sessões
drop table if exists app_private.rehearsal_coordination;

-- Conferência estrita de restauração dos gatilhos de segurança
do $verify_triggers_restored$
begin
  if not exists (
    select 1 from pg_catalog.pg_trigger
    where tgname = 'church_access_protect_last_admin' and tgenabled = 'O'
  ) or not exists (
    select 1 from pg_catalog.pg_trigger
    where tgname = 'members_protect_last_admin' and tgenabled = 'O'
  ) then
    raise exception 'FALHA DE RESTAURAÇÃO: Gatilhos de proteção do último administrador não foram reativados!';
  end if;
end;
$verify_triggers_restored$;

-- Conferência final de ausência da tabela de coordenação e contagens residuais do laboratório
do $assert_preservation$
declare
  v_member_count integer;
  v_user_count integer;
  v_church_count integer;
  v_access_count integer;
  v_coordination_exists boolean;
  v_residual_fixtures integer;
begin
  select count(*) into v_member_count from app_private.members;
  select count(*) into v_user_count from auth.users;
  select count(*) into v_church_count from app_private.churches;
  select count(*) into v_access_count from app_private.church_access;
  
  select exists (
    select 1 from pg_catalog.pg_tables
    where schemaname = 'app_private' and tablename = 'rehearsal_coordination'
  ) into v_coordination_exists;

  if v_coordination_exists then
    raise exception 'PRESERVAÇÃO FALHOU: Tabela app_private.rehearsal_coordination ainda existe no catálogo pós-ensaio!';
  end if;

  select (
    (select count(*) from auth.users where id in ('01300000-0000-4000-8000-0000000000a1', '01300000-0000-4000-8000-0000000000a2', '01300000-0000-4000-8000-0000000000b2', '01300000-0000-4000-8000-0000000000b3')) +
    (select count(*) from app_private.churches where id = '01300000-0000-4000-8000-0000000000c1') +
    (select count(*) from app_private.members where id in ('01300000-0000-4000-8000-000000000011', '01300000-0000-4000-8000-000000000012', '01300000-0000-4000-8000-0000000000d1', '01300000-0000-4000-8000-0000000000d2', '01300000-0000-4000-8000-0000000000d3', '01300000-0000-4000-8000-0000000000d4', '01300000-0000-4000-8000-0000000000d5')) +
    (select count(*) from app_private.church_access where id in ('01300000-0000-4000-8000-00000000ac11', '01300000-0000-4000-8000-00000000ac12', '01300000-0000-4000-8000-00000000ac22', '01300000-0000-4000-8000-00000000ac33'))
  ) into v_residual_fixtures;

  if v_residual_fixtures is distinct from 0 then
    raise exception 'PRESERVAÇÃO FALHOU: Existem % fixtures sintéticas residuais da 013 no banco!', v_residual_fixtures;
  end if;

  if v_member_count is distinct from 7
     or v_user_count is distinct from 4
     or v_church_count is distinct from 2
     or v_access_count is distinct from 6 then
    raise exception 'PRESERVAÇÃO FALHOU: Contagens residuais divergiram do baseline original (members: %, users: %, churches: %, access: %).',
      v_member_count, v_user_count, v_church_count, v_access_count;
  end if;

  raise notice 'ENSAIO 013 CONCLUÍDO COM SUCESSO: todas as 5 disputas concorrentes validadas e fixtures sintéticas revertidas com perfeição.';
end;
$assert_preservation$;
