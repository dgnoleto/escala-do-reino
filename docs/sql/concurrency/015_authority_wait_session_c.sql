-- Sessão privilegiada: retém o lock tardio, observa a espera e revoga antes de liberá-lo.
-- Executar em base recém-provisionada e fixtures montadas pelo script comum.
\set ON_ERROR_STOP on
\ir 015_concurrency_guard.sql
\if :{?checkpoint}
\else
  \echo 'FALHA: informe checkpoint.'
  do $missing_parameter$ begin raise exception 'Parâmetro obrigatório do ensaio ausente'; end $missing_parameter$;
\endif
\if :{?revoke}
\else
  \echo 'FALHA: informe revoke=on (negativo) ou revoke=off (controle).'
  do $missing_parameter$ begin raise exception 'Parâmetro obrigatório do ensaio ausente'; end $missing_parameter$;
\endif
select set_config('escala.checkpoint', :'checkpoint', false);
select set_config('escala.revoke', :'revoke', false);
set application_name='rehearsal_015_authority_c';
set statement_timeout='45s';
begin isolation level read committed;
set local lock_timeout='5s';
do $retain_late_lock$
declare
  v_case text:=current_setting('escala.checkpoint');
  v_member uuid;
begin
  if current_setting('escala.revoke') not in ('on','off') then
    raise exception 'revoke deve ser on ou off';
  end if;
  if v_case not in ('assign_membership','assign_role','assign_qualification',
    'replace_membership','replace_qualification','replace_assignment',
    'remove_membership','remove_qualification','revoke_qualification') then
    raise exception 'Checkpoint desconhecido: %',v_case;
  end if;
  v_member := case when v_case like 'replace_%'
    then '01500000-0000-4000-8000-000000000015'::uuid
    else '01500000-0000-4000-8000-000000000016'::uuid end;
  if v_case like '%membership' then
    perform 1 from app_private.team_memberships tm
    where tm.church_id='01500000-0000-4000-8000-000000000001'
      and tm.team_id='01500000-0000-4000-8000-000000000020' and tm.member_id=v_member for update;
  elsif v_case like '%qualification' then
    perform 1 from app_private.member_qualifications mq
    where mq.church_id='01500000-0000-4000-8000-000000000001'
      and mq.team_role_id='01500000-0000-4000-8000-000000000021' and mq.member_id=v_member for update;
  elsif v_case='assign_role' then
    perform 1 from app_private.team_roles tr
    where tr.church_id='01500000-0000-4000-8000-000000000001'
      and tr.id='01500000-0000-4000-8000-000000000021' for update;
  else
    perform 1 from app_private.assignments a
    where a.church_id='01500000-0000-4000-8000-000000000001'
      and a.id='01500000-0000-4000-8000-000000000040' for update;
  end if;
  if not found then raise exception 'Fixture do lock não encontrada'; end if;
end
$retain_late_lock$;
\echo 'LOCK TARDIO RETIDO. Inicie a sessão A agora, em até 30 segundos.'
do $observe_and_revoke$
declare
  v_deadline timestamptz:=clock_timestamp()+interval '30 seconds';
  v_pid integer;
  v_count integer;
  v_observed boolean:=false;
begin
  loop
    perform pg_stat_clear_snapshot();
    select count(*),min(pid) into v_count,v_pid from pg_stat_activity
    where datname=current_database() and application_name='rehearsal_015_authority_a';
    if v_count>1 then raise exception 'Mais de uma sessão A: identidade ambígua'; end if;
    if v_count=1 and pg_backend_pid()=any(pg_blocking_pids(v_pid))
       and exists(select 1 from pg_stat_activity where pid=v_pid and wait_event_type='Lock'
         and wait_event in ('transactionid','tuple')) then
      v_observed:=true;
      exit;
    end if;
    exit when clock_timestamp()>v_deadline;
    perform pg_sleep(0.05);
  end loop;
  if not v_observed then raise exception 'FAIL: espera real pelo lock tardio não observada'; end if;
  raise notice 'WAIT_OBSERVED|checkpoint=%|operator_pid=%|blocker_pid=%',current_setting('escala.checkpoint'),v_pid,pg_backend_pid();
  if current_setting('escala.revoke')='on' then
    -- O líder operador não é administrador: não contornar continuidade do último admin.
    update app_private.church_access
    set status='revoked',revoked_at=clock_timestamp(),
        revoked_by_user_id='01500000-0000-4000-8000-000000000002'
    where church_id='01500000-0000-4000-8000-000000000001'
      and user_id='01500000-0000-4000-8000-000000000003'
      and status='active' and not is_admin;
    get diagnostics v_count=row_count;
    if v_count<>1 then raise exception 'FAIL: a revogação deveria afetar exatamente um líder não administrador'; end if;
    raise notice 'ACCESS_REVOKED_BEFORE_RELEASE';
  end if;
end
$observe_and_revoke$;
-- O commit torna a revogação visível antes que A termine de adquirir o lock retido por C.
commit;
\echo 'SESSÃO C CONCLUÍDA. Exigir também PASS e asserções privadas na sessão A.'
