\set ON_ERROR_STOP on
\ir 015_concurrency_guard.sql
begin isolation level repeatable read;
set local role authenticated;
select set_config('request.jwt.claim.sub','01500000-0000-4000-8000-000000000003',true);
do $isolation$
declare
  v_i integer;
  v_denied boolean;
begin
  for v_i in 1..4 loop
    v_denied:=false;
    begin
      case v_i
        when 1 then perform public.assign_event_participant(
          '01500000-0000-4000-8000-000000000001','01500000-0000-4000-8000-0000000000e2',
          '01500000-0000-4000-8000-000000000030','01500000-0000-4000-8000-000000000020',
          '01500000-0000-4000-8000-000000000016','01500000-0000-4000-8000-000000000031',
          '01500000-0000-4000-8000-000000000021');
        when 2 then perform public.replace_event_participant(
          '01500000-0000-4000-8000-000000000001','01500000-0000-4000-8000-0000000000e2',
          '01500000-0000-4000-8000-000000000040','01500000-0000-4000-8000-000000000015','Prova de isolamento');
        when 3 then perform public.remove_team_member(
          '01500000-0000-4000-8000-000000000001','01500000-0000-4000-8000-0000000000e2',
          '01500000-0000-4000-8000-000000000020','01500000-0000-4000-8000-000000000016');
        when 4 then perform public.revoke_member_qualification(
          '01500000-0000-4000-8000-000000000001','01500000-0000-4000-8000-0000000000e2',
          '01500000-0000-4000-8000-000000000016','01500000-0000-4000-8000-000000000020',
          '01500000-0000-4000-8000-000000000021');
      end case;
    exception when sqlstate '42501' then
      if sqlerrm not like '%READ COMMITTED%' then raise; end if;
      v_denied:=true;
    end;
    if not v_denied then raise exception 'FAIL: RPC % aceitou isolamento sem revalidação atual',v_i; end if;
  end loop;
  raise notice 'PASS_ISOLATION|%',current_setting('transaction_isolation');
end
$isolation$;
rollback;

begin isolation level serializable;
set local role authenticated;
select set_config('request.jwt.claim.sub','01500000-0000-4000-8000-000000000003',true);
do $isolation$
declare
  v_i integer;
  v_denied boolean;
begin
  for v_i in 1..4 loop
    v_denied:=false;
    begin
      case v_i
        when 1 then perform public.assign_event_participant(
          '01500000-0000-4000-8000-000000000001','01500000-0000-4000-8000-0000000000e2',
          '01500000-0000-4000-8000-000000000030','01500000-0000-4000-8000-000000000020',
          '01500000-0000-4000-8000-000000000016','01500000-0000-4000-8000-000000000031',
          '01500000-0000-4000-8000-000000000021');
        when 2 then perform public.replace_event_participant(
          '01500000-0000-4000-8000-000000000001','01500000-0000-4000-8000-0000000000e2',
          '01500000-0000-4000-8000-000000000040','01500000-0000-4000-8000-000000000015','Prova de isolamento');
        when 3 then perform public.remove_team_member(
          '01500000-0000-4000-8000-000000000001','01500000-0000-4000-8000-0000000000e2',
          '01500000-0000-4000-8000-000000000020','01500000-0000-4000-8000-000000000016');
        when 4 then perform public.revoke_member_qualification(
          '01500000-0000-4000-8000-000000000001','01500000-0000-4000-8000-0000000000e2',
          '01500000-0000-4000-8000-000000000016','01500000-0000-4000-8000-000000000020',
          '01500000-0000-4000-8000-000000000021');
      end case;
    exception when sqlstate '42501' then
      if sqlerrm not like '%READ COMMITTED%' then raise; end if;
      v_denied:=true;
    end;
    if not v_denied then raise exception 'FAIL: RPC % aceitou isolamento sem revalidação atual',v_i; end if;
  end loop;
  raise notice 'PASS_ISOLATION|%',current_setting('transaction_isolation');
end
$isolation$;
rollback;
