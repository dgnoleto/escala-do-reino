-- Somente base de prova vazia: sem fixture em piloto e sem limpeza por DML.
do $guard$ begin
 if exists(select 1 from auth.users) or exists(select 1 from app_private.churches)
 or exists(select 1 from app_private.command_receipts) or exists(select 1 from app_private.audit_entries) then
   raise exception 'O ensaio 016 exige uma base descartável vazia, preparada e identificada pelo executor.';
 end if;
end $guard$;
create function pg_temp.id(n integer) returns uuid language sql immutable as
$$ select ('01600000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid $$;
create function pg_temp.revision(n integer) returns text language sql as
$$ select to_char(m.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') from app_private.members m where m.id=pg_temp.id(n) $$;
create function pg_temp.as_authenticated(q text, expected text default '00000') returns jsonb
language plpgsql security invoker as $$
declare payload jsonb; code text:='00000'; msg text;
begin
 begin
   set local role authenticated;
   execute q into payload;
   reset role;
 exception when others then
   get stacked diagnostics code=returned_sqlstate,msg=message_text;
   reset role;
 end;
 if code<>expected then raise exception 'FALHA: esperado %, recebido %: %',expected,code,msg; end if;
 return payload;
end $$;
create function pg_temp.deactivate(n integer, cmd integer, expected text default '00000', revision text default null) returns jsonb
language plpgsql security invoker as $$
begin
 return pg_temp.as_authenticated(format('select to_jsonb(r) from public.deactivate_church_member(%L,%L,%L,%L) r',
   pg_temp.id(1000),pg_temp.id(cmd),pg_temp.id(n),coalesce(revision,pg_temp.revision(n))),expected);
end $$;
create function pg_temp.restore(n integer, cmd integer, expected text default '00000') returns jsonb
language plpgsql security invoker as $$
begin
 return pg_temp.as_authenticated(format('select to_jsonb(r) from public.restore_church_member(%L,%L,%L,%L) r',
   pg_temp.id(1000),pg_temp.id(cmd),pg_temp.id(n),pg_temp.revision(n)),expected);
end $$;
insert into app_private.churches(id,name,timezone,default_duration_policy,status) values
 (pg_temp.id(1000),'Igreja Prova 016','America/Sao_Paulo','warn','active'),
 (pg_temp.id(2000),'Outra Igreja Prova 016','America/Sao_Paulo','warn','active');
insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select pg_temp.id(n),'prova016_'||n||'@rehearsal.test',clock_timestamp(),'{"provider":"email"}'::jsonb,'{}'::jsonb,clock_timestamp(),clock_timestamp()
from generate_series(1,8) n;
insert into app_private.members(id,church_id,display_name,status,created_by_user_id)
select pg_temp.id(n),pg_temp.id(1000),'Membro 016 '||n,'active',pg_temp.id(1) from generate_series(11,20) n;
insert into app_private.members(id,church_id,display_name,status,created_by_user_id) values
 (pg_temp.id(21),pg_temp.id(2000),'Administrador outra igreja','active',pg_temp.id(4)),
 (pg_temp.id(23),pg_temp.id(2000),'Mesmo Auth outra igreja','active',pg_temp.id(4));
insert into app_private.church_access(church_id,user_id,member_id,is_admin,status,onboarding_completed_at,granted_by_user_id) values
 (pg_temp.id(1000),pg_temp.id(1),pg_temp.id(11),true,'active',clock_timestamp(),pg_temp.id(1)),
 (pg_temp.id(1000),pg_temp.id(2),pg_temp.id(12),true,'active',clock_timestamp(),pg_temp.id(1)),
 (pg_temp.id(1000),pg_temp.id(3),pg_temp.id(13),false,'active',clock_timestamp(),pg_temp.id(1)),
 (pg_temp.id(2000),pg_temp.id(4),pg_temp.id(21),true,'active',clock_timestamp(),pg_temp.id(4)),
 (pg_temp.id(2000),pg_temp.id(3),pg_temp.id(23),false,'active',clock_timestamp(),pg_temp.id(4));
insert into app_private.church_access(church_id,user_id,member_id,is_admin,status,onboarding_completed_at,granted_by_user_id,granted_at,revoked_at,revoked_by_user_id)
values(pg_temp.id(1000),pg_temp.id(5),pg_temp.id(15),false,'revoked',clock_timestamp()-interval '1 day',pg_temp.id(1),clock_timestamp()-interval '1 day',clock_timestamp()-interval '1 hour',pg_temp.id(2));
-- Seis tentativas do mesmo membro: aberta válida, consumidas, revogada e expirada.
insert into app_private.access_invitations(id,church_id,member_id,recipient_email,token_digest,issued_by_user_id,
 issued_at,expires_at,redeemed_at,redeemed_by_user_id,revoked_at,revoked_by_user_id)
select pg_temp.id(n),pg_temp.id(1000),case when n=105 then pg_temp.id(20) else pg_temp.id(13) end,'prova016_3@rehearsal.test',sha256(convert_to('fixture-'||n,'UTF8')),pg_temp.id(1),
 t,t+interval '72 hours',case when n in (101,102,103) then t+interval '1 hour' end,
 case when n in (101,102,103) then pg_temp.id(3) end,
 case when n=104 then t+interval '2 hours' end,case when n=104 then pg_temp.id(2) end
from generate_series(100,105) n cross join lateral
 (select clock_timestamp()-case when n in (102,105) then interval '4 days' else interval '3 hours' end as t) times;
insert into app_private.access_requests(id,church_id,member_id,invitation_id,requester_user_id,original_display_name,
 proposed_display_name,submitted_at,expires_at,status,decided_at,decided_by_user_id)
select pg_temp.id(right(id::text,12)::int+100),church_id,member_id,id,pg_temp.id(3),'Membro 016 13','Nome proposto 016',
 issued_at+interval '1 hour',expires_at,case when id=pg_temp.id(103) then 'rejected' else 'pending' end,
 case when id=pg_temp.id(103) then issued_at+interval '2 hours' end,case when id=pg_temp.id(103) then pg_temp.id(2) end
from app_private.access_invitations where id in (pg_temp.id(101),pg_temp.id(102),pg_temp.id(103));
