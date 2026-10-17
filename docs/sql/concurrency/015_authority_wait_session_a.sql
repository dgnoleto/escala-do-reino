-- Operador autenticado: deve falhar com 42501 após revogação durante a espera.
\set ON_ERROR_STOP on
\ir 015_concurrency_guard.sql
\if :{?checkpoint}
\else
  \echo 'FALHA: informe checkpoint.'
  do $missing_parameter$ begin raise exception 'Parâmetro obrigatório do ensaio ausente'; end $missing_parameter$;
\endif
\if :{?expect}
\else
  \echo 'FALHA: informe expect=deny ou expect=allow.'
  do $missing_parameter$ begin raise exception 'Parâmetro obrigatório do ensaio ausente'; end $missing_parameter$;
\endif
select set_config('escala.checkpoint', :'checkpoint', false);
select set_config('escala.expect', :'expect', false);
set application_name='rehearsal_015_authority_a';
set statement_timeout='15s';
begin isolation level read committed;
set local lock_timeout='10s';
set local role authenticated;
select set_config('request.jwt.claim.sub','01500000-0000-4000-8000-000000000003',true);
do $attempt$
declare
  v_case text:=current_setting('escala.checkpoint');
  v_denied boolean:=false;
begin
  if current_setting('escala.expect') not in ('deny','allow') then raise exception 'expect inválido'; end if;
  begin
    if v_case in ('assign_membership','assign_role','assign_qualification') then
      perform public.assign_event_participant(
        '01500000-0000-4000-8000-000000000001','01500000-0000-4000-8000-0000000000e1',
        '01500000-0000-4000-8000-000000000030','01500000-0000-4000-8000-000000000020',
        '01500000-0000-4000-8000-000000000016','01500000-0000-4000-8000-000000000031',
        '01500000-0000-4000-8000-000000000021','Prova de autoridade após espera');
    elsif v_case in ('replace_membership','replace_qualification','replace_assignment') then
      perform public.replace_event_participant(
        '01500000-0000-4000-8000-000000000001','01500000-0000-4000-8000-0000000000e1',
        '01500000-0000-4000-8000-000000000040','01500000-0000-4000-8000-000000000015',
        'Prova de autoridade após espera');
    elsif v_case in ('remove_membership','remove_qualification') then
      perform public.remove_team_member(
        '01500000-0000-4000-8000-000000000001','01500000-0000-4000-8000-0000000000e1',
        '01500000-0000-4000-8000-000000000020','01500000-0000-4000-8000-000000000016');
    elsif v_case='revoke_qualification' then
      perform public.revoke_member_qualification(
        '01500000-0000-4000-8000-000000000001','01500000-0000-4000-8000-0000000000e1',
        '01500000-0000-4000-8000-000000000016','01500000-0000-4000-8000-000000000020',
        '01500000-0000-4000-8000-000000000021');
    else
      raise exception 'Checkpoint desconhecido';
    end if;
  exception when sqlstate '42501' then
    v_denied:=true;
  end;
  if v_denied is distinct from (current_setting('escala.expect')='deny') then
    raise exception 'FAIL: resultado de autorização divergente; denied=%',v_denied;
  end if;
  raise notice 'RPC_OUTCOME|checkpoint=%|denied=%',v_case,v_denied;
end
$attempt$;
reset role;
do $assert_effects$
declare
  v_case text:=current_setting('escala.checkpoint');
  v_deny boolean:=current_setting('escala.expect')='deny';
  v_expected integer;
  v_count integer;
  v_status text;
begin
  v_expected:=case when v_deny then 0 else 1 end;
  select count(*) into v_count from app_private.command_receipts
  where user_id='01500000-0000-4000-8000-000000000003'
    and command_id='01500000-0000-4000-8000-0000000000e1';
  if v_count<>v_expected then raise exception 'FAIL: recibos %; esperado %',v_count,v_expected; end if;
  select count(*) into v_count from app_private.audit_entries
  where church_id='01500000-0000-4000-8000-000000000001';
  if v_count<>v_expected then raise exception 'FAIL: auditorias %; esperado %',v_count,v_expected; end if;
  select status into v_status from app_private.church_access
  where church_id='01500000-0000-4000-8000-000000000001' and user_id='01500000-0000-4000-8000-000000000003';
  if v_status is distinct from (case when v_deny then 'revoked' else 'active' end) then
    raise exception 'FAIL: resultado não corresponde ao estado de acesso atual';
  end if;
  select count(*) into v_count from app_private.assignments
  where church_id='01500000-0000-4000-8000-000000000001';
  v_expected:=case when not v_deny and (v_case like 'assign_%' or v_case like 'replace_%') then 2 else 1 end;
  if v_count<>v_expected then raise exception 'FAIL: contagem de alocações %; esperado %',v_count,v_expected; end if;
  select status into v_status from app_private.assignments where id='01500000-0000-4000-8000-000000000040';
  if v_status is distinct from (case when not v_deny and v_case like 'replace_%' then 'replaced' else 'active' end) then
    raise exception 'FAIL: estado inesperado da alocação original';
  end if;
  select count(*) into v_count from app_private.team_memberships
  where church_id='01500000-0000-4000-8000-000000000001' and status='active';
  v_expected:=case when not v_deny and v_case like 'remove_%' then 3 else 4 end;
  if v_count<>v_expected then raise exception 'FAIL: vínculos ativos %; esperado %',v_count,v_expected; end if;
  select count(*) into v_count from app_private.member_qualifications
  where church_id='01500000-0000-4000-8000-000000000001' and status='active';
  v_expected:=case when not v_deny and (v_case like 'remove_%' or v_case='revoke_qualification') then 2 else 3 end;
  if v_count<>v_expected then raise exception 'FAIL: aptidões ativas %; esperado %',v_count,v_expected; end if;
  if (select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='app_private' and t.tgname in ('church_access_protect_last_admin','members_protect_last_admin') and t.tgenabled='O')<>2 then
    raise exception 'FAIL: proteções administrativas alteradas';
  end if;
  raise notice 'PASS_AUTHORITY_WAIT|checkpoint=%|expect=%',v_case,current_setting('escala.expect');
end
$assert_effects$;
commit;
