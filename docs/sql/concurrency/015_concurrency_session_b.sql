-- ============================================================================
-- Escala do Reino — Ensaio de Concorrência Física: Conexão B (Sessão 2)
-- Incremento: 015 (Fonte Real de Dependências Litúrgicas)
-- ============================================================================
-- Executar em uma conexão dedicada (Terminal 2 / psql Conexão B).
-- Coordena passos com a Conexão A (Terminal 1) para demonstrar serialização real
-- e rejeição determinística de dupla substituição concorrente (B2-04).
--
-- ATENÇÃO E GOVERNANÇA:
-- 1. Executar apenas em base local autorizada de laboratório (127.0.0.1 / container local).
-- 2. NUNCA execute este script em banco de piloto remoto, homologação compartilhada ou produção.
-- ============================================================================
\set ON_ERROR_STOP on

do $set_app_name$
begin
  perform set_config('application_name', 'rehearsal_015_session_b', false);
end
$set_app_name$;

-- GUARDA ANTECIPADA: Bloqueio estrito contra execução em piloto, produção ou base remota
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
    or host(v_server_addr) like '172.%'
    or host(v_server_addr) like '10.%'
    or host(v_server_addr) like '192.168.%'
  ) then
    raise exception 'EXECUÇÃO ABORTADA: Conexão não está em loopback ou rede de container efêmero (inet_server_addr = %).', v_server_addr;
  end if;
end
$guard_target$;

\echo '----------------------------------------------------------------------'
\echo 'SESSÃO B: Aguardando sinal de sincronização da Sessão A (Barreira 1015001)...'
\echo '----------------------------------------------------------------------'

-- Aguarda a Sessão A adquirir o lock no original e liberar a barreira
select pg_advisory_lock(1015001);
select pg_advisory_unlock(1015001);

\echo 'SESSÃO B: Barreira liberada! Disparando tentativa de substituição concorrente do mesmo original...'

-- PASSO 1: Sessão B tenta substituir a MESMA alocação original para outro voluntário
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '01500000-0000-4000-8000-000000000003', true); -- Líder de Louvor

do $attempt_double_replace$
declare
  v_err_code text;
  v_err_msg text;
begin
  begin
    perform public.replace_event_participant(
      '01500000-0000-4000-8000-000000000001'::uuid,
      '01500000-0000-4000-8000-0000000000bb'::uuid,
      '01500000-0000-4000-8000-000000000040'::uuid, -- Mesma alocação do Voluntário 1
      '01500000-0000-4000-8000-000000000016'::uuid, -- Substituto B (Voluntário 3)
      'Substituição concorrente pela Sessão B'
    );
    raise exception 'FALHA: A Sessão B não foi bloqueada ou permitiu dupla substituição!';
  exception when others then
    get stacked diagnostics v_err_code = returned_sqlstate, v_err_msg = message_text;
    if v_err_code = 'P0020' then
      raise notice 'PASS SESSÃO B: Concorrência bloqueada com sucesso! Código recebido: % — %', v_err_code, v_err_msg;
    else
      raise exception 'FALHA SESSÃO B: Código inesperado recebido: % — %', v_err_code, v_err_msg;
    end if;
  end;
end
$attempt_double_replace$;

commit;

\echo '----------------------------------------------------------------------'
\echo 'SESSÃO B: Ensaio de concorrência física concluído com PASS determinístico.'
\echo 'Apenas uma única substituição foi homologada (Sessão A); a Sessão B foi rejeitada com P0020.'
\echo '----------------------------------------------------------------------'
