-- Corrida A/B: segundo escritor; exigir PASS das duas sessões.
\set ON_ERROR_STOP on
\ir 015_concurrency_guard.sql
set application_name='rehearsal_015_session_b';
set statement_timeout='15s';

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

  if v_orig_status is distinct from 'replaced' then
    raise exception 'FALHA: Alocação original deveria ter status=replaced, encontrado: %', v_orig_status;
  end if;

  if v_replacement_id is null then
    raise exception 'FALHA: Alocação original deveria apontar para o replacement_assignment_id homologado.';
  end if;

  -- 2. Verifica que o substituto ativo é exclusivamente o da Sessão A (Voluntário 2)
  select member_id into v_sub_member_id
  from app_private.assignments
  where id = v_replacement_id and church_id = v_church_id and status = 'active';

  if v_sub_member_id is distinct from '01500000-0000-4000-8000-000000000015'::uuid then
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

  if not exists(select 1 from app_private.assignments where id=v_replacement_id and church_id=v_church_id
    and replaced_assignment_id=v_asg_orig_id and status='active') then
    raise exception 'FALHA: encadeamento recíproco da substituição ausente';
  end if;
  if (select count(*) from app_private.command_receipts where church_id=v_church_id
    and command_id='01500000-0000-4000-8000-0000000000aa')<>1
    or exists(select 1 from app_private.command_receipts where church_id=v_church_id
    and command_id='01500000-0000-4000-8000-0000000000bb')
    or (select count(*) from app_private.audit_entries where church_id=v_church_id
    and action='replace_event_participant')<>1 then
    raise exception 'FALHA: recibos/auditoria não correspondem a um único vencedor';
  end if;

  raise notice 'ASSERTIVAS FINAIS CONFIRMADAS: Exatamente 1 substituto ativo homologado. Zero duplicações ou inconsistências.';
end
$assert_final_state$;

-- PASSO 3: Validação da Integridade dos Gatilhos de Segurança e Conclusão do Ensaio
-- Preservação irrestrita das garantias de último administrador (church_access_protect_last_admin e members_protect_last_admin).
-- Nenhuma diretiva DISABLE TRIGGER é executada.
do $verify_triggers_intact$
begin
  if (
    select count(*) from pg_catalog.pg_trigger t
    join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='app_private' and t.tgname in ('church_access_protect_last_admin', 'members_protect_last_admin')
      and tgenabled = 'O'
  ) <> 2 then
    raise exception 'FALHA DE GOVERNANÇA: Os gatilhos de proteção do último admin não estão em estado normal (O)!';
  end if;

  raise notice '======================================================================';
  raise notice 'ENSAIO DE CONCORRÊNCIA A/B CONCLUÍDO COM SUCESSO.';
  raise notice 'Gatilhos de segurança permanecem 100%% ativos (tgenabled = O).';
  raise notice 'Descarte e limpeza do laboratório efêmero devem ser realizados via dropdb da base dedicada.';
  raise notice '======================================================================';
end;
$verify_triggers_intact$;
