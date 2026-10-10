-- ============================================================================
-- Escala do Reino — Ensaio de Concorrência Real: Conexão A (Sessão 1)
-- ============================================================================
-- Executar em uma conexão dedicada (Terminal 1 / psql Conexão A).
-- Coordena passos com a Conexão B (Terminal 2) para demonstrar serialização real,
-- ausência de deadlocks e resolução determinística de corridas.
--
-- ATENÇÃO:
-- 1. O operador de testes (usuário privilegiado postgres/laboratório) prepara as fixtures
--    e estabelece bloqueios/inspeções em app_private sob papel administrativo autorizado.
-- 2. As chamadas às RPCs comutam explicitamente para papel authenticated com claims definidos.
-- 3. NUNCA execute este script em banco de piloto ou produção.
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
values ('session_a', pg_backend_pid(), 'ready', 'init')
on conflict (session_role) do update
set pid = excluded.pid, step_status = 'ready', last_step = 'init', registered_at = clock_timestamp();

-- PASSO A0: Preparação de Fixtures pelo Operador de Testes (Terminal 1)
-- Executar como operador de laboratório (superuser/postgres)
begin;

-- 1. Usuários Auth sintéticos
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin1_conc@example.test', statement_timestamp()),
  ('00000000-0000-0000-0000-0000000000a2', 'admin2_conc@example.test', statement_timestamp()),
  ('00000000-0000-0000-0000-0000000000b1', 'guest1_conc@example.test', statement_timestamp()),
  ('00000000-0000-0000-0000-0000000000b2', 'guest2_conc@example.test', statement_timestamp()),
  ('00000000-0000-0000-0000-0000000000b3', 'guest3_conc@example.test', statement_timestamp()),
  ('00000000-0000-0000-0000-0000000000b4', 'guest4_conc@example.test', statement_timestamp());

-- 2. Igreja sintética de ensaio
insert into app_private.churches (id, name, timezone, default_duration_policy, status) values
  ('00000000-0000-0000-0000-0000000000c1', 'Comunidade Concorrência Real', 'America/Sao_Paulo', 'warn', 'active');

-- 3. Membros sintéticos independentes por cenário (C1 a C4) com UUIDs hexadecimais válidos
insert into app_private.members (id, church_id, display_name, status, created_by_user_id) values
  ('00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-0000000000c1', 'Admin Concorrência 1', 'active', '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-0000000000c1', 'Admin Concorrência 2', 'active', '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1', 'Membro Alvo C1', 'active', '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000c1', 'Membro Alvo C2', 'active', '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000c1', 'Membro Alvo C3', 'active', '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000000d4', '00000000-0000-0000-0000-0000000000c1', 'Membro Alvo C4', 'active', '00000000-0000-0000-0000-0000000000a1');

-- 4. Administradores ativos da igreja (atendendo à regra de continuidade de administradores do 009)
insert into app_private.church_access (
  id, church_id, user_id, member_id, is_admin, status, onboarding_completed_at, granted_by_user_id
) values
  (gen_random_uuid(), '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000011', true, 'active', statement_timestamp(), '00000000-0000-0000-0000-0000000000a1'),
  (gen_random_uuid(), '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000012', true, 'active', statement_timestamp(), '00000000-0000-0000-0000-0000000000a1');

-- 5. Convite pré-existente para C2 (aberto para o guest 2) com token de 43 caracteres válido
insert into app_private.access_invitations (
  id, church_id, member_id, recipient_email, token_digest, issued_by_user_id, issued_at, expires_at
) values (
  '00000000-0000-0000-0000-0000000000e2',
  '00000000-0000-0000-0000-0000000000c1',
  '00000000-0000-0000-0000-0000000000d2',
  'guest2_conc@example.test',
  pg_catalog.sha256(pg_catalog.convert_to('token_conc_c2_exato_synthetic_43chars_abc12', 'UTF8')),
  '00000000-0000-0000-0000-0000000000a1',
  statement_timestamp(),
  statement_timestamp() + interval '72 hours'
);

-- 6. Convite consumido e solicitação pré-existente para C3
insert into app_private.access_invitations (
  id, church_id, member_id, recipient_email, token_digest, issued_by_user_id, issued_at, expires_at,
  redeemed_at, redeemed_by_user_id
) values (
  '00000000-0000-0000-0000-0000000000e3',
  '00000000-0000-0000-0000-0000000000c1',
  '00000000-0000-0000-0000-0000000000d3',
  'guest3_conc@example.test',
  pg_catalog.sha256(pg_catalog.convert_to('token_conc_c3_exato_synthetic_43chars_abc12', 'UTF8')),
  '00000000-0000-0000-0000-0000000000a1',
  statement_timestamp() - interval '2 hours',
  statement_timestamp() + interval '70 hours',
  statement_timestamp() - interval '1 hour',
  '00000000-0000-0000-0000-0000000000b3'
);

-- Reutiliza exatamente o mesmo expires_at do convite para cumprir a restrição da FK composta
insert into app_private.access_requests (
  id, church_id, member_id, invitation_id, requester_user_id,
  original_display_name, proposed_display_name, submitted_at, expires_at, status
)
select
  '00000000-0000-0000-0000-0000000000f3',
  ai.church_id,
  ai.member_id,
  ai.id,
  ai.redeemed_by_user_id,
  'Membro Alvo C3',
  'Membro C3 Nome Proposto',
  ai.redeemed_at,
  ai.expires_at,
  'pending'
from app_private.access_invitations ai
where ai.id = '00000000-0000-0000-0000-0000000000e3';

commit;
-- Fixtures iniciais comitadas: visíveis para Conexão A e Conexão B.
-- (C4 será preparado imediatamente antes de sua respectiva corrida no Passo A4.0).

-- ============================================================================
-- TESTE C1: Duas Chamadas Concorrentes de Mesmo Comando Antes do Recibo Existir
-- Cenário TC-INV-RACE-03
-- ============================================================================

-- Passo A1.1: Operador inicia transação e adquire advisory lock transacional de serialização
begin;
select pg_advisory_xact_lock(
  hashtext('00000000-0000-0000-0000-0000000000a1'),
  hashtext('11111111-1111-1111-1111-111111111111')
);

-- Barreira Ativa: Comprova que Conexão B entrou na fila bloqueada pelo PID exato de A
do $barrier_c1$
declare
  v_b_pid integer;
  v_attempts integer := 0;
begin
  select pid into v_b_pid from app_private.rehearsal_coordination where session_role = 'session_b';
  if v_b_pid is null then
    raise exception 'C1 FALHA: Conexão B não registrou seu PID em rehearsal_coordination.';
  end if;

  loop
    if pg_backend_pid() = any(pg_blocking_pids(v_b_pid)) then
      exit;
    end if;
    v_attempts := v_attempts + 1;
    if v_attempts > 60 then
      raise exception 'C1 TIMEOUT: Conexão B (PID %) não entrou em bloqueio pelo PID % em 6 segundos.', v_b_pid, pg_backend_pid();
    end if;
    perform pg_sleep(0.1);
  end loop;

  raise notice 'C1 CONFIRMADO: Conexão B (PID %) comprovadamente bloqueada pelo PID %.', v_b_pid, pg_backend_pid();
end;
$barrier_c1$;

-- Passo A1.2: Conexão A comuta para papel authenticated para executar a emissão e comita
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);

select * from public.issue_church_invitation(
  '11111111-1111-1111-1111-111111111111'::uuid,
  '00000000-0000-0000-0000-0000000000c1'::uuid,
  '00000000-0000-0000-0000-0000000000d1'::uuid,
  'guest1_conc@example.test'
);

commit;
-- Ao comitar, Conexão B desbloqueia instantaneamente e retorna o replay idêntico!

-- Asserção ativa C1 pelo operador (aguarda e valida término de B):
do $assert_c1$
declare
  v_inv_count integer;
  v_receipt_count integer;
  v_status_b text;
  v_attempts integer := 0;
begin
  loop
    select step_status into v_status_b from app_private.rehearsal_coordination where session_role = 'session_b';
    if v_status_b = 'completed_c1' then
      exit;
    end if;
    if v_status_b = 'error_c1' then
      raise exception 'C1 FALHA: Conexão B reportou erro em C1.';
    end if;
    v_attempts := v_attempts + 1;
    if v_attempts > 50 then
      raise exception 'C1 TIMEOUT: Conexão B não concluiu dentro de 5s após liberação do lock.';
    end if;
    perform pg_sleep(0.1);
  end loop;

  select count(*) into v_inv_count
  from app_private.access_invitations
  where member_id = '00000000-0000-0000-0000-0000000000d1';

  select count(*) into v_receipt_count
  from app_private.command_receipts
  where command_id = '11111111-1111-1111-1111-111111111111';

  if v_inv_count <> 1 or v_receipt_count <> 1 then
    raise exception 'C1 FALHA: Esperado exatamente 1 convite (obtido %) e 1 recibo (obtido %).', v_inv_count, v_receipt_count;
  end if;

  raise notice 'C1 CONFIRMADO: Idempotência garantida sem duplicação de entidades (Replay validado em B).';
end;
$assert_c1$;

-- ============================================================================
-- TESTE C2: Reemissão Concorrente vs. Resgate do Mesmo Convite
-- Cenário TC-INV-RACE-01
-- ============================================================================

-- Passo A2.1: Operador do laboratório inicia transação e bloqueia na ordem canônica
begin;
select id from app_private.churches where id = '00000000-0000-0000-0000-0000000000c1' for share;
select id from app_private.members where id = '00000000-0000-0000-0000-0000000000d2' for update;

-- Barreira Ativa: Comprova que Conexão B está na fila de lock aguardando o PID de A
do $barrier_c2$
declare
  v_b_pid integer;
  v_attempts integer := 0;
begin
  select pid into v_b_pid from app_private.rehearsal_coordination where session_role = 'session_b';
  loop
    if pg_backend_pid() = any(pg_blocking_pids(v_b_pid)) then
      exit;
    end if;
    v_attempts := v_attempts + 1;
    if v_attempts > 60 then
      raise exception 'C2 TIMEOUT: Conexão B (PID %) não entrou em bloqueio pelo PID % em 6 segundos.', v_b_pid, pg_backend_pid();
    end if;
    perform pg_sleep(0.1);
  end loop;

  raise notice 'C2 CONFIRMADO: Conexão B (PID %) bloqueada aguardando o lock do membro de A.', v_b_pid;
end;
$barrier_c2$;

-- Passo A2.2: Conexão A comuta para papel authenticated, executa a reemissão e comita
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);

select * from public.issue_church_invitation(
  '22222222-2222-2222-2222-222222222222'::uuid,
  '00000000-0000-0000-0000-0000000000c1'::uuid,
  '00000000-0000-0000-0000-0000000000d2'::uuid,
  'guest2_novo@example.test'
);

commit;
-- Ao comitar, Conexão B desbloqueia e aborta deterministicamente com P0002!

-- Asserção ativa C2 pelo operador:
do $assert_c2$
declare
  v_old_revoked boolean;
  v_new_open boolean;
  v_status_b text;
  v_attempts integer := 0;
begin
  loop
    select step_status into v_status_b from app_private.rehearsal_coordination where session_role = 'session_b';
    if v_status_b = 'completed_c2' then
      exit;
    end if;
    if v_status_b = 'error_c2' then
      raise exception 'C2 FALHA: Conexão B não capturou o erro esperado P0002.';
    end if;
    v_attempts := v_attempts + 1;
    if v_attempts > 50 then
      raise exception 'C2 TIMEOUT: Conexão B não concluiu dentro de 5s.';
    end if;
    perform pg_sleep(0.1);
  end loop;

  select (revoked_at is not null) into v_old_revoked
  from app_private.access_invitations
  where id = '00000000-0000-0000-0000-0000000000e2';

  select exists (
    select 1 from app_private.access_invitations
    where member_id = '00000000-0000-0000-0000-0000000000d2'
      and id <> '00000000-0000-0000-0000-0000000000e2'
      and redeemed_at is null and revoked_at is null
  ) into v_new_open;

  if not coalesce(v_old_revoked, false) or not coalesce(v_new_open, false) then
    raise exception 'C2 FALHA: Convite original não revogado ou novo convite aberto ausente (old_revoked=%, new_open=%).', v_old_revoked, v_new_open;
  end if;

  raise notice 'C2 CONFIRMADO: Reemissão prevaleceu e convite anterior revogado com sucesso.';
end;
$assert_c2$;

-- ============================================================================
-- TESTE C3: Duas Decisões Concorrentes na Mesma Solicitação
-- Cenário TC-INV-RACE-02 (Hierarquia Canônica Preservada)
-- ============================================================================

-- Passo A3.1: Operador inicia transação e adquire locks na ordem canônica
begin;
select id from app_private.churches where id = '00000000-0000-0000-0000-0000000000c1' for share;
select id from app_private.members where id = '00000000-0000-0000-0000-0000000000d3' for update;
select id from app_private.access_invitations where id = '00000000-0000-0000-0000-0000000000e3' for update;
select id from app_private.access_requests where id = '00000000-0000-0000-0000-0000000000f3' for update;

-- Barreira Ativa: Comprova que Conexão B está na fila de lock aguardando A
do $barrier_c3$
declare
  v_b_pid integer;
  v_attempts integer := 0;
begin
  select pid into v_b_pid from app_private.rehearsal_coordination where session_role = 'session_b';
  loop
    if pg_backend_pid() = any(pg_blocking_pids(v_b_pid)) then
      exit;
    end if;
    v_attempts := v_attempts + 1;
    if v_attempts > 60 then
      raise exception 'C3 TIMEOUT: Conexão B (PID %) não entrou em bloqueio pelo PID % em 6 segundos.', v_b_pid, pg_backend_pid();
    end if;
    perform pg_sleep(0.1);
  end loop;

  raise notice 'C3 CONFIRMADO: Conexão B (PID %) bloqueada aguardando decisão de A.', v_b_pid;
end;
$barrier_c3$;

-- Passo A3.2: Conexão A comuta para role authenticated, aprova a solicitação e comita
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);

select * from public.decide_access_request(
  '33333333-3333-3333-3333-333333333333'::uuid,
  '00000000-0000-0000-0000-0000000000c1'::uuid,
  '00000000-0000-0000-0000-0000000000f3'::uuid,
  'approve'
);

commit;
-- Ao comitar, Conexão B desbloqueia e aborta deterministicamente com 23505!

-- Asserção ativa C3 pelo operador:
do $assert_c3$
declare
  v_status text;
  v_decided_by uuid;
  v_status_b text;
  v_attempts integer := 0;
begin
  loop
    select step_status into v_status_b from app_private.rehearsal_coordination where session_role = 'session_b';
    if v_status_b = 'completed_c3' then
      exit;
    end if;
    if v_status_b = 'error_c3' then
      raise exception 'C3 FALHA: Conexão B não capturou o erro 23505 esperado.';
    end if;
    v_attempts := v_attempts + 1;
    if v_attempts > 50 then
      raise exception 'C3 TIMEOUT: Conexão B não concluiu dentro de 5s.';
    end if;
    perform pg_sleep(0.1);
  end loop;

  select status, decided_by_user_id into v_status, v_decided_by
  from app_private.access_requests
  where id = '00000000-0000-0000-0000-0000000000f3';

  if v_status is distinct from 'approved' or v_decided_by is distinct from '00000000-0000-0000-0000-0000000000a1'::uuid then
    raise exception 'C3 FALHA: Solicitação não aprovada pelo Admin 1 (status=%, decided_by=%).', v_status, v_decided_by;
  end if;

  raise notice 'C3 CONFIRMADO: Aprovação de A prevaleceu e segunda decisão de B abortou deterministicamente.';
end;
$assert_c3$;

-- ============================================================================
-- TESTE C4: Espera por Lock Cruzando o Prazo de Expiração
-- Cenário TC-INV-RACE-05
-- ============================================================================

-- Passo A4.0: Preparação Imediata de Fixture C4 pelo Operador
-- Captura um único instante temporal para derivação atômica de 72h
do $prep_c4$
declare
  v_t0 timestamptz := clock_timestamp() - interval '71 hours' - interval '59 minutes' - interval '58 seconds';
  v_exp timestamptz := v_t0 + interval '72 hours';
begin
  insert into app_private.access_invitations (
    id, church_id, member_id, recipient_email, token_digest, issued_by_user_id, issued_at, expires_at,
    redeemed_at, redeemed_by_user_id
  ) values (
    '00000000-0000-0000-0000-0000000000e4',
    '00000000-0000-0000-0000-0000000000c1',
    '00000000-0000-0000-0000-0000000000d4',
    'guest4_conc@example.test',
    pg_catalog.sha256(pg_catalog.convert_to('token_conc_c4_exato_synthetic_43chars_abc12', 'UTF8')),
    '00000000-0000-0000-0000-0000000000a1',
    v_t0,
    v_exp,
    v_t0 + interval '10 minutes',
    '00000000-0000-0000-0000-0000000000b4'
  );

  insert into app_private.access_requests (
    id, church_id, member_id, invitation_id, requester_user_id,
    original_display_name, proposed_display_name, submitted_at, expires_at, status
  ) values (
    '00000000-0000-0000-0000-0000000000f4',
    '00000000-0000-0000-0000-0000000000c1',
    '00000000-0000-0000-0000-0000000000d4',
    '00000000-0000-0000-0000-0000000000e4',
    '00000000-0000-0000-0000-0000000000b4',
    'Membro Alvo C4',
    'Membro C4 Nome Expirando',
    v_t0 + interval '10 minutes',
    v_exp,
    'pending'
  );
end;
$prep_c4$;

-- Passo A4.1: Operador adquire bloqueios canônicos antes do vencimento
begin;
select id from app_private.churches where id = '00000000-0000-0000-0000-0000000000c1' for share;
select id from app_private.members where id = '00000000-0000-0000-0000-0000000000d4' for update;
select id from app_private.access_requests where id = '00000000-0000-0000-0000-0000000000f4' for update;

-- Prova ativa de espera: Operador confere que Conexão B entrou na fila ANTES do vencimento
do $assert_c4_waiting$
declare
  v_b_pid integer;
  v_waiting_before_expiry boolean;
  v_window_remaining interval;
  v_expires_at timestamptz;
  v_attempts integer := 0;
begin
  select r.expires_at into v_expires_at
  from app_private.access_requests r
  where r.id = '00000000-0000-0000-0000-0000000000f4';

  select pid into v_b_pid from app_private.rehearsal_coordination where session_role = 'session_b';
  if v_b_pid is null then
    raise exception 'C4 FALHA: Conexão B não registrou seu PID em rehearsal_coordination.';
  end if;

  loop
    if pg_backend_pid() = any(pg_blocking_pids(v_b_pid)) then
      v_waiting_before_expiry := (clock_timestamp() < v_expires_at);
      v_window_remaining := (v_expires_at - clock_timestamp());
      exit;
    end if;
    v_attempts := v_attempts + 1;
    if v_attempts > 60 then
      raise exception 'C4 TIMEOUT: Conexão B (PID %) não entrou em espera pelo lock de A.', v_b_pid;
    end if;
    perform pg_sleep(0.05);
  end loop;

  if v_waiting_before_expiry is not true then
    raise exception 'C4 FALHA: Conexão B entrou na fila mas janela expirou antes de confirmar espera (waiting_before_expiry = %, janela perdida).', v_waiting_before_expiry;
  end if;

  raise notice 'C4 CONFIRMADO: Conexão B (PID %) bloqueada e aguardando ANTES da expiração. Janela restante: %', v_b_pid, v_window_remaining;
end;
$assert_c4_waiting$;

-- Temporização Dinâmica: Calcula o tempo exato para cruzar a expiração mantendo-se sob timeout de 5s
do $dynamic_sleep_c4$
declare
  v_expires_at timestamptz;
  v_remaining_sec double precision;
begin
  select r.expires_at into v_expires_at
  from app_private.access_requests r
  where r.id = '00000000-0000-0000-0000-0000000000f4';

  v_remaining_sec := extract(epoch from (v_expires_at - clock_timestamp()));
  if v_remaining_sec > 0 then
    -- Dorme tempo restante + 300ms de margem
    perform pg_sleep(v_remaining_sec + 0.3);
  else
    perform pg_sleep(0.3);
  end if;
end;
$dynamic_sleep_c4$;

-- Operador comprova ativamente que a expiração foi ultrapassada enquanto Conexão B permanecia retida:
do $assert_c4_crossed$
declare
  v_expires_at timestamptz;
  v_b_pid integer;
begin
  select r.expires_at into v_expires_at
  from app_private.access_requests r
  where r.id = '00000000-0000-0000-0000-0000000000f4';

  select pid into v_b_pid from app_private.rehearsal_coordination where session_role = 'session_b';

  if clock_timestamp() <= v_expires_at then
    raise exception 'C4 FALHA: Relógio ainda não cruzou a expiração antes da liberação do lock.';
  end if;

  if not (pg_backend_pid() = any(pg_blocking_pids(v_b_pid))) then
    raise exception 'C4 FALHA: Conexão B não permaneceu retida até cruzar a expiração!';
  end if;

  raise notice 'C4 CONFIRMADO: Expiração ultrapassada com Conexão B retida na fila. Liberando lock com rollback...';
end;
$assert_c4_crossed$;

-- Passo A4.2: Conexão A aborta/libera a transação sem decidir
rollback;

-- RESULTADO ESPERADO PÓS-ROLLBACK DE A:
-- A Conexão B desbloqueia dentro do timeout, detecta o vencimento pós-lock,
-- persiste a solicitação com status = 'expired' e retorna structured REQUEST_EXPIRED!

-- Asserção ativa de finalização C4 pelo operador (aguarda confirmação de B):
do $assert_c4_expired$
declare
  v_status text;
  v_decided_at timestamptz;
  v_decided_by uuid;
  v_status_b text;
  v_attempts integer := 0;
begin
  loop
    select step_status into v_status_b from app_private.rehearsal_coordination where session_role = 'session_b';
    if v_status_b = 'completed_c4' then
      exit;
    end if;
    if v_status_b = 'error_c4' then
      raise exception 'C4 FALHA: Conexão B reportou erro ao processar finalização por expiração.';
    end if;
    v_attempts := v_attempts + 1;
    if v_attempts > 60 then
      raise exception 'C4 TIMEOUT: Conexão B não concluiu dentro de 6s pós-rollback.';
    end if;
    perform pg_sleep(0.1);
  end loop;

  select status, decided_at, decided_by_user_id
  into v_status, v_decided_at, v_decided_by
  from app_private.access_requests
  where id = '00000000-0000-0000-0000-0000000000f4';

  if v_status is distinct from 'expired' or v_decided_at is null or v_decided_by is not null then
    raise exception 'C4 FALHA: Solicitação não foi persistida como expired pós-desbloqueio (status=%, decided_at=%, decided_by=%).', v_status, v_decided_at, v_decided_by;
  end if;

  raise notice 'C4 CONCLUÍDO COM SUCESSO: Solicitação finalizada como expired após corrida no limite do prazo.';
end;
$assert_c4_expired$;

-- ============================================================================
-- ENCERRAMENTO E DESCARTE INTEGRAL DA BASE EFÊMERA IDENTIFICADA
-- ============================================================================
-- MÉTODO NORMATIVO EXCLUSIVO: Descarte integral da base escala_rehearsal_tmp via dropdb.
-- Proibido cleanup parcial por DML: as FKs de 001 com ON DELETE RESTRICT (como church_access gerado em C3)
-- e os gatilhos de proteção administrativa (009) impedem exclusões parciais seguras e determinísticas.
--
-- O descarte definitivo DEVE ser executado pelo operador/executor a partir de outra conexão:
--   psql -X -v ON_ERROR_STOP=1 -h <host> -p <port> -U <user> -d postgres -c \
--     "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'escala_rehearsal_tmp' AND pid <> pg_backend_pid();"
--   dropdb -h <host> -p <port> -U <user> escala_rehearsal_tmp
-- ============================================================================
do $assert_finished$
begin
  if current_database() <> 'escala_rehearsal_tmp' then
    raise exception 'SEGURANÇA: Banco atual (%) não é o banco efêmero de laboratório escala_rehearsal_tmp.', current_database();
  end if;

  raise notice 'ENSAIOS CONCLUÍDOS COM SUCESSO: Todas as sessões devem ser encerradas e o banco escala_rehearsal_tmp descartado integralmente via dropdb.';
end;
$assert_finished$;

