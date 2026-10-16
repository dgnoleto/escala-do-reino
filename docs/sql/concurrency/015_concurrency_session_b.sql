-- ============================================================================
-- Escala do Reino — Ensaio de Concorrência Física: Conexão B (Sessão 2)
-- Incremento: 015 (Fonte Real de Dependências Litúrgicas)
-- ============================================================================
-- Executar em uma conexão dedicada (Terminal 2 / psql Conexão B).
-- Coordena passos com a Conexão A (Terminal 1) para demonstrar serialização real,
-- rejeição determinística de dupla substituição concorrente (B2-04),
-- assertivas exatas de estado final e limpeza total de fixtures sintéticas.
--
-- ATENÇÃO E GOVERNANÇA:
-- 1. Executar apenas em base local autorizada de laboratório (127.0.0.1 / ::1).
-- 2. NUNCA execute este script em banco de piloto remoto, homologação compartilhada ou produção.
-- ============================================================================
\set ON_ERROR_STOP on

do $set_app_name$
begin
  perform set_config('application_name', 'rehearsal_015_session_b', false);
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
    -- B2-06: Assertiva estrita do código e da mensagem de alocação já substituída
    if v_err_code = 'P0020' and v_err_msg ~* 'já substituída' then
      raise notice 'PASS SESSÃO B: Concorrência bloqueada e serializada com sucesso! Código: %, Mensagem: %', v_err_code, v_err_msg;
    else
      raise exception 'FALHA SESSÃO B: Erro inesperado recebido: % — % (esperava P0020 com menção a alocação já substituída)', v_err_code, v_err_msg;
    end if;
  end;
end
$attempt_double_replace$;

commit;

-- PASSO 2: Assertivas Exatas de Estado Final (B2-06)
do $assert_final_state$
declare
  v_church_id uuid := '01500000-0000-4000-8000-000000000001'::uuid;
  v_event_id uuid := '01500000-0000-4000-8000-000000000030'::uuid;
  v_item_id uuid := '01500000-0000-4000-8000-000000000031'::uuid;
  v_asg_orig_id uuid := '01500000-0000-4000-8000-000000000040'::uuid;
  v_orig_status text;
  v_replacement_id uuid;
  v_active_count integer;
  v_sub_member_id uuid;
begin
  -- 1. Verifica estado da alocação original
  select status, replacement_assignment_id
  into v_orig_status, v_replacement_id
  from app_private.assignments
  where id = v_asg_orig_id and church_id = v_church_id;

  if v_orig_status <> 'replaced' then
    raise exception 'FALHA: Alocação original deveria ter status=replaced, encontrado: %', v_orig_status;
  end if;

  if v_replacement_id is null then
    raise exception 'FALHA: Alocação original deveria apontar para o replacement_assignment_id homologado.';
  end if;

  -- 2. Verifica que o substituto ativo é exclusivamente o da Sessão A (Voluntário 2)
  select member_id into v_sub_member_id
  from app_private.assignments
  where id = v_replacement_id and church_id = v_church_id and status = 'active';

  if v_sub_member_id <> '01500000-0000-4000-8000-000000000015'::uuid then
    raise exception 'FALHA: Substituto ativo deveria ser o Voluntário 2 (Sessão A), encontrado: %', v_sub_member_id;
  end if;

  -- 3. Verifica contagem de substitutos ativos para o item (deve ser exatamente 1)
  select count(*) into v_active_count
  from app_private.assignments
  where church_id = v_church_id
    and event_id = v_event_id
    and item_id = v_item_id
    and status = 'active';

  if v_active_count <> 1 then
    raise exception 'FALHA: Esperado exatamente 1 alocação ativa neste item, encontrado: %', v_active_count;
  end if;

  raise notice 'ASSERTIVAS FINAIS CONFIRMADAS: Exatamente 1 substituto ativo homologado. Zero duplicações ou inconsistências.';
end
$assert_final_state$;

-- PASSO 3: Limpeza completa de todas as fixtures sintéticas do ensaio (Zero Resíduos - B2-06)
do $cleanup_fixtures$
declare
  v_church_id uuid := '01500000-0000-4000-8000-000000000001'::uuid;
begin
  delete from app_private.command_receipts where church_id = v_church_id;
  delete from app_private.audit_entries where church_id = v_church_id;
  delete from app_private.assignments where church_id = v_church_id;
  delete from app_private.event_items where church_id = v_church_id;
  delete from app_private.events where church_id = v_church_id;
  delete from app_private.member_qualifications where church_id = v_church_id;
  delete from app_private.team_memberships where church_id = v_church_id;
  delete from app_private.team_roles where church_id = v_church_id;
  delete from app_private.teams where church_id = v_church_id;
  delete from app_private.church_access where church_id = v_church_id;
  delete from app_private.members where church_id = v_church_id;
  delete from app_private.churches where id = v_church_id;

  delete from auth.users where id in (
    '01500000-0000-4000-8000-000000000002'::uuid,
    '01500000-0000-4000-8000-000000000003'::uuid,
    '01500000-0000-4000-8000-000000000004'::uuid,
    '01500000-0000-4000-8000-000000000005'::uuid,
    '01500000-0000-4000-8000-000000000006'::uuid
  );

  raise notice 'TEARDOWN COMPLETO: Todas as fixtures sintéticas do ensaio foram removidas com sucesso. Zero resíduos no banco.';
end
$cleanup_fixtures$;

\echo '----------------------------------------------------------------------'
\echo 'SESSÃO B: Ensaio de concorrência física concluído com PASS determinístico.'
\echo 'Apenas uma única substituição foi homologada (Sessão A); a Sessão B foi rejeitada com P0020.'
\echo 'Fixtures sintéticas limpas com sucesso.'
\echo '----------------------------------------------------------------------'
