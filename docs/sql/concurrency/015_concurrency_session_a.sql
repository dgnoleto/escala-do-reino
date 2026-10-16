-- ============================================================================
-- Escala do Reino — Ensaio de Concorrência Física: Conexão A (Sessão 1)
-- Incremento: 015 (Fonte Real de Dependências Litúrgicas)
-- ============================================================================
-- Executar em uma conexão dedicada (Terminal 1 / psql Conexão A).
-- Coordena passos com a Conexão B (Terminal 2) para demonstrar serialização real,
-- resolução determinística da corrida de substituição concorrente (B2-04),
-- observação de barreira em pg_locks e integridade final.
--
-- ATENÇÃO E GOVERNANÇA:
-- 1. Executar apenas em base local autorizada de laboratório (127.0.0.1 / ::1).
-- 2. NUNCA execute este script em banco de piloto remoto, homologação compartilhada ou produção.
-- 3. Scripts contêm barreiras síncronas via pg_advisory_lock e monitoramento de pg_locks.
-- ============================================================================
\set ON_ERROR_STOP on

do $set_app_name$
begin
  perform set_config('application_name', 'rehearsal_015_session_a', false);
end
$set_app_name$;

-- GUARDA ANTECIPADA: Bloqueio estrito contra execução fora do loopback local
do $guard_target$
declare
  v_server_addr inet;
begin
  if current_database() ~* 'prod|pilot|jvpctgqudvjealzileib' then
    raise exception 'EXECUÇÃO ABORTADA: Base potencialmente compartilhada ou remota: %', current_database();
  end if;

  v_server_addr := inet_server_addr();
  if v_server_addr is not null and not (
    v_server_addr = '127.0.0.1'::inet
    or v_server_addr = '::1'::inet
  ) then
    raise exception 'EXECUÇÃO ABORTADA: Conexão deve ser estritamente loopback local (inet_server_addr = %).', v_server_addr;
  end if;
end
$guard_target$;

-- PASSO 0: Configuração de Fixtures Sintéticas do Ensaio (Igreja, Membros, Equipe, Culto, Alocação)
do $setup_fixtures$
declare
  v_church_id uuid := '01500000-0000-4000-8000-000000000001'::uuid;
  v_admin_user_id uuid := '01500000-0000-4000-8000-000000000002'::uuid;
  v_leader_user_id uuid := '01500000-0000-4000-8000-000000000003'::uuid;
  v_vol1_user_id uuid := '01500000-0000-4000-8000-000000000004'::uuid;
  v_vol2_user_id uuid := '01500000-0000-4000-8000-000000000005'::uuid;
  v_vol3_user_id uuid := '01500000-0000-4000-8000-000000000006'::uuid;

  v_admin_member_id uuid := '01500000-0000-4000-8000-000000000012'::uuid;
  v_leader_member_id uuid := '01500000-0000-4000-8000-000000000013'::uuid;
  v_vol1_member_id uuid := '01500000-0000-4000-8000-000000000014'::uuid;
  v_vol2_member_id uuid := '01500000-0000-4000-8000-000000000015'::uuid;
  v_vol3_member_id uuid := '01500000-0000-4000-8000-000000000016'::uuid;

  v_team_id uuid := '01500000-0000-4000-8000-000000000020'::uuid;
  v_role_id uuid := '01500000-0000-4000-8000-000000000021'::uuid;
  v_event_id uuid := '01500000-0000-4000-8000-000000000030'::uuid;
  v_item_id uuid := '01500000-0000-4000-8000-000000000031'::uuid;
  v_asg_id uuid := '01500000-0000-4000-8000-000000000040'::uuid;
begin
  -- Inserir igreja
  insert into app_private.churches (id, name, timezone, default_duration_policy, status)
  values (v_church_id, 'Igreja Concorrência 015', 'America/Sao_Paulo', 'warn', 'active')
  on conflict (id) do nothing;

  -- Inserir usuários auth
  insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    (v_admin_user_id, 'admin_015@rehearsal.test', clock_timestamp(), '{"provider":"email"}'::jsonb, '{}'::jsonb, clock_timestamp(), clock_timestamp()),
    (v_leader_user_id, 'leader_015@rehearsal.test', clock_timestamp(), '{"provider":"email"}'::jsonb, '{}'::jsonb, clock_timestamp(), clock_timestamp()),
    (v_vol1_user_id, 'vol1_015@rehearsal.test', clock_timestamp(), '{"provider":"email"}'::jsonb, '{}'::jsonb, clock_timestamp(), clock_timestamp()),
    (v_vol2_user_id, 'vol2_015@rehearsal.test', clock_timestamp(), '{"provider":"email"}'::jsonb, '{}'::jsonb, clock_timestamp(), clock_timestamp()),
    (v_vol3_user_id, 'vol3_015@rehearsal.test', clock_timestamp(), '{"provider":"email"}'::jsonb, '{}'::jsonb, clock_timestamp(), clock_timestamp())
  on conflict (id) do nothing;

  -- Inserir membros
  insert into app_private.members (id, church_id, display_name, status)
  values
    (v_admin_member_id, v_church_id, 'Pr Marcos (Admin 015)', 'active'),
    (v_leader_member_id, v_church_id, 'Líder Louvor (015)', 'active'),
    (v_vol1_member_id, v_church_id, 'Voluntário Titular 1', 'active'),
    (v_vol2_member_id, v_church_id, 'Voluntário Substituto A', 'active'),
    (v_vol3_member_id, v_church_id, 'Voluntário Substituto B', 'active')
  on conflict (church_id, id) do nothing;

  -- Inserir church_access
  insert into app_private.church_access (church_id, user_id, member_id, is_admin, status, onboarding_completed_at)
  values
    (v_church_id, v_admin_user_id, v_admin_member_id, true, 'active', clock_timestamp()),
    (v_church_id, v_leader_user_id, v_leader_member_id, false, 'active', clock_timestamp()),
    (v_church_id, v_vol1_user_id, v_vol1_member_id, false, 'active', clock_timestamp()),
    (v_church_id, v_vol2_user_id, v_vol2_member_id, false, 'active', clock_timestamp()),
    (v_church_id, v_vol3_user_id, v_vol3_member_id, false, 'active', clock_timestamp())
  on conflict (church_id, user_id) do update set status = 'active';

  -- Inserir equipe e função técnica
  insert into app_private.teams (id, church_id, name, leader_member_id, status, version)
  values (v_team_id, v_church_id, 'Louvor Concorrência 015', v_leader_member_id, 'active', 1)
  on conflict (church_id, id) do nothing;

  insert into app_private.team_roles (id, church_id, team_id, name, description, status)
  values (v_role_id, v_church_id, v_team_id, 'Vocal Solo', 'Canto', 'active')
  on conflict (church_id, id) do nothing;

  -- Inserir memberships
  insert into app_private.team_memberships (church_id, team_id, member_id, status)
  values
    (v_church_id, v_team_id, v_leader_member_id, 'active'),
    (v_church_id, v_team_id, v_vol1_member_id, 'active'),
    (v_church_id, v_team_id, v_vol2_member_id, 'active'),
    (v_church_id, v_team_id, v_vol3_member_id, 'active')
  on conflict (church_id, team_id, member_id) do update set status = 'active';

  -- Homologar aptidões de todos os voluntários para a função técnica
  insert into app_private.member_qualifications (church_id, member_id, team_id, team_role_id, status)
  values
    (v_church_id, v_vol1_member_id, v_team_id, v_role_id, 'active'),
    (v_church_id, v_vol2_member_id, v_team_id, v_role_id, 'active'),
    (v_church_id, v_vol3_member_id, v_team_id, v_role_id, 'active')
  on conflict (church_id, member_id, team_role_id) do update set status = 'active';

  -- Inserir evento com timezone herdado e item pendente
  insert into app_private.events (id, church_id, title, event_type, timezone, status, planned_start_at, planned_end_at, liturgy_leader_member_id, version)
  values (v_event_id, v_church_id, 'Culto Concorrência 015', 'culto', 'America/Sao_Paulo', 'scheduled', clock_timestamp() + interval '1 day', clock_timestamp() + interval '1 day 2 hours', v_admin_member_id, 1)
  on conflict (church_id, id) do nothing;

  insert into app_private.event_items (id, church_id, event_id, title, sequence_order, planned_duration_seconds, status, designated_team_id)
  values (v_item_id, v_church_id, v_event_id, 'Momento de Louvor', 1, 900, 'pending', v_team_id)
  on conflict (church_id, id) do nothing;

  -- Inserir alocação ativa inicial do Voluntário 1
  insert into app_private.assignments (id, church_id, event_id, item_id, team_id, team_role_id, member_id, status)
  values (v_asg_id, v_church_id, v_event_id, v_item_id, v_team_id, v_role_id, v_vol1_member_id, 'active')
  on conflict (church_id, id) do update set status = 'active', replaced_assignment_id = null, replacement_assignment_id = null;
end
$setup_fixtures$;

-- BARREIRA 1: Inicializa Barreira Síncrona 1015001
select pg_advisory_lock(1015001);

\echo '----------------------------------------------------------------------'
\echo 'SESSÃO A: Pronto para corrida de substituição concorrente.'
\echo 'Inicie a Sessão B agora. A Sessão A irá disparar substituição para o Voluntário 2,'
\echo 'segurar a transação com lock e liberar a Sessão B para tentar substituir o mesmo original.'
\echo '----------------------------------------------------------------------'

-- PASSO 1: Sessão A inicia transação e substitui o voluntário
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '01500000-0000-4000-8000-000000000003', true); -- Líder de Louvor

-- Dispara substituição
select * from public.replace_event_participant(
  '01500000-0000-4000-8000-000000000001'::uuid,
  '01500000-0000-4000-8000-0000000000aa'::uuid,
  '01500000-0000-4000-8000-000000000040'::uuid, -- Alocação do Voluntário 1
  '01500000-0000-4000-8000-000000000015'::uuid, -- Substituto A (Voluntário 2)
  'Substituição pela Sessão A'
);

\echo 'SESSÃO A: Alocação atualizada sob lock. Liberando Sessão B...'
select pg_advisory_unlock(1015001);

-- BARREIRA OBSERVÁVEL (B2-06): Observa se a Conexão B enfileirou em pg_locks
do $observe_lock_barrier$
declare
  v_waiting boolean := false;
  v_attempts integer := 0;
begin
  loop
    select exists (
      select 1
      from pg_locks l
      join pg_stat_activity a on a.pid = l.pid
      where a.application_name = 'rehearsal_015_session_b'
        and not l.granted
    ) into v_waiting;

    exit when v_waiting or v_attempts >= 30;
    perform pg_sleep(0.1);
    v_attempts := v_attempts + 1;
  end loop;

  if v_waiting then
    raise notice 'BARREIRA OBSERVÁVEL: Sessão B detectada em espera no lock da Sessão A.';
  else
    raise notice 'BARREIRA: Tempo limite de observação atingido; prosseguindo com commit.';
  end if;
end
$observe_lock_barrier$;

-- Confirma transação da Sessão A
commit;
\echo 'SESSÃO A: Transação comitada com sucesso! O original agora é status=replaced.'
