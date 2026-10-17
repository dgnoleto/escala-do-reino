-- Corrida A/B: primeiro escritor; somente base descartável guardada.
\set ON_ERROR_STOP on
\ir 015_concurrency_guard.sql
set application_name='rehearsal_015_session_a';
set statement_timeout='15s';
\ir 015_concurrency_fixtures.sql

-- BARREIRA 1: Inicializa Barreira Síncrona 1015001
select pg_advisory_lock(1015001);

\echo '----------------------------------------------------------------------'
\echo 'SESSÃO A: Fixtures configuradas com sucesso e com exclusividade provada.'
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

reset role;

-- BARREIRA OBSERVÁVEL (B2-06): Comprova que Sessão B está efetivamente bloqueada pela Sessão A via pg_blocking_pids
do $observe_lock_barrier$
declare
  v_session_a_pid integer := pg_backend_pid();
  v_session_b_pid integer;
  v_blocked boolean := false;
  v_attempts integer := 0;
begin
  loop
    perform pg_stat_clear_snapshot();
    if (select count(*) from pg_stat_activity where datname=current_database() and application_name='rehearsal_015_session_b') > 1 then
      raise exception 'Identidade ambígua: mais de uma sessão B';
    end if;
    select pid into v_session_b_pid
    from pg_stat_activity
    where datname = current_database()
      and application_name = 'rehearsal_015_session_b'
      and pid <> v_session_a_pid
    order by backend_start desc
    limit 1;

    if v_session_b_pid is not null then
      if v_session_a_pid = any(pg_blocking_pids(v_session_b_pid)) then
        v_blocked := true;
        exit;
      end if;
    end if;

    v_attempts := v_attempts + 1;
    exit when v_attempts >= 50;
    perform pg_sleep(0.1);
  end loop;

  if not v_blocked then
    raise exception 'FALHA NA BARREIRA OBSERVÁVEL: Sessão B (PID %) não foi bloqueada pela Sessão A (PID %) no tempo limite (5s)! Ensaio sequencial reprovado.', v_session_b_pid, v_session_a_pid;
  end if;

  raise notice 'BARREIRA OBSERVÁVEL COMPROVADA: Sessão B (PID %) está efetivamente bloqueada pela Sessão A (PID %). pg_blocking_pids = %', v_session_b_pid, v_session_a_pid, pg_blocking_pids(v_session_b_pid);
end
$observe_lock_barrier$;

-- Confirma transação da Sessão A
commit;
\echo 'SESSÃO A: Transação comitada com sucesso! O original agora é status=replaced.'
