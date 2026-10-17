do $test$
declare
 before_auth text; before_other text; before_consumed text; before_closed text; before_revoked text;
 before_history text; before_attempts text; before_access text; original_revision text;
 receipt jsonb; replay jsonb; payload jsonb; target integer; mode text; code text;
begin
 perform set_config('request.jwt.claim.sub',pg_temp.id(1)::text,true);
 select md5(string_agg(to_jsonb(u)::text,'' order by u.id)) into before_auth from auth.users u;
 select md5(string_agg(to_jsonb(c)::text,'' order by c.id)) into before_other from app_private.church_access c where church_id=pg_temp.id(2000);
 select md5(string_agg(to_jsonb(i)::text,'' order by i.id)) into before_consumed from app_private.access_invitations i where redeemed_at is not null;
 select md5(string_agg(to_jsonb(i)::text,'' order by i.id)) into before_closed from app_private.access_invitations i where id in (pg_temp.id(104),pg_temp.id(105));
 select to_jsonb(r)::text into before_revoked from app_private.church_access r where member_id=pg_temp.id(15);
 original_revision:=pg_temp.revision(13);
 receipt:=pg_temp.deactivate(13,301);
 if receipt->'result_payload'->>'status'<>'inactive' or receipt->'result_payload'->>'updated_at'=original_revision
 or (select status from app_private.members where id=pg_temp.id(13))<>'inactive'
 or not exists(select 1 from app_private.church_access where member_id=pg_temp.id(13) and status='revoked' and revoked_by_user_id=pg_temp.id(1)) then
   raise exception 'Exclusão/revisão/revogação não confirmada'; end if;
 if (receipt->'result_payload'->>'invitations_revoked')::int<>1
 or (receipt->'result_payload'->>'requests_cancelled')::int<>1
 or (receipt->'result_payload'->>'requests_expired')::int<>1 then raise exception 'Contagem de tentativas divergente'; end if;
 if not exists(select 1 from app_private.access_requests where id=pg_temp.id(201) and status='cancelled' and decided_by_user_id=pg_temp.id(1))
 or not exists(select 1 from app_private.access_requests where id=pg_temp.id(202) and status='expired' and decided_by_user_id is null)
 or not exists(select 1 from app_private.access_requests where id=pg_temp.id(203) and status='rejected' and decided_by_user_id=pg_temp.id(2)) then
   raise exception 'Temporalidade/histórico das solicitações divergente'; end if;
 if (select md5(string_agg(to_jsonb(u)::text,'' order by u.id)) from auth.users u)<>before_auth
 or (select md5(string_agg(to_jsonb(c)::text,'' order by c.id)) from app_private.church_access c where church_id=pg_temp.id(2000))<>before_other
 or (select md5(string_agg(to_jsonb(i)::text,'' order by i.id)) from app_private.access_invitations i where redeemed_at is not null)<>before_consumed
 or (select md5(string_agg(to_jsonb(i)::text,'' order by i.id)) from app_private.access_invitations i where id in (pg_temp.id(104),pg_temp.id(105)))<>before_closed then
   raise exception 'Auth/outra igreja/tentativas históricas foram alterados'; end if;
 replay:=pg_temp.deactivate(13,301,'00000',original_revision);
 if replay<>receipt then raise exception 'Replay divergente'; end if;
 perform pg_temp.deactivate(13,301,'23505','revisão divergente');
 perform pg_temp.deactivate(13,302,'P0019');
 perform pg_temp.restore(13,303);
 replay:=pg_temp.deactivate(13,301,'00000',original_revision);
 if replay<>receipt or (select status from app_private.members where id=pg_temp.id(13))<>'active'
 or (select status from app_private.church_access where member_id=pg_temp.id(13))<>'revoked'
 or (select revoked_at is null from app_private.access_invitations where id=pg_temp.id(100))
 or (select count(*) from app_private.audit_entries where action='deactivate_member' and target_id=pg_temp.id(13))<>1
 then raise exception 'Replay reaplicou exclusão após restauração ou duplicou auditoria'; end if;
 raise notice 'PASS016|ciclo_integrado_temporalidade_outra_igreja_replay';
 perform pg_temp.deactivate(15,304); perform pg_temp.restore(15,305);
 if (select to_jsonb(r)::text from app_private.church_access r where member_id=pg_temp.id(15))<>before_revoked then
   raise exception 'Revogação anterior reescrita'; end if;
 -- Um convite expirado ainda ocupa a posição de convite aberto; por isso usa outro membro.
 receipt:=pg_temp.deactivate(20,351);
 if (receipt->'result_payload'->>'invitations_revoked')::int<>0
 or (select md5(string_agg(to_jsonb(i)::text,'' order by i.id)) from app_private.access_invitations i where id in (pg_temp.id(104),pg_temp.id(105)))<>before_closed then
   raise exception 'Convite expirado/fechado reescrito pela exclusão'; end if;
 perform pg_temp.restore(20,352);
 raise notice 'PASS016|revogacao_anterior_intacta';
 -- Recusas de autorização/contexto/revisão sem efeitos ou recibos.
 perform pg_temp.deactivate(11,306,'P0016');
 perform pg_temp.deactivate(14,307,'P0019','2020-01-01T00:00:00.000000Z');
 perform pg_temp.deactivate(23,308,'P0002');
 perform set_config('request.jwt.claim.sub',pg_temp.id(3)::text,true);
 perform pg_temp.deactivate(14,309,'42501');
 perform pg_temp.deactivate(13,301,'42501',original_revision);
 perform set_config('request.jwt.claim.sub','',true);
 perform pg_temp.deactivate(14,310,'28000');
 perform set_config('request.jwt.claim.sub',pg_temp.id(1)::text,true);
 -- Um inativo legado com acesso ainda ativo continua sem saneamento silencioso.
 update app_private.members set status='inactive' where id=pg_temp.id(12);
 perform pg_temp.restore(12,311,'P0018');
 update app_private.members set status='active' where id=pg_temp.id(12);
 raise notice 'PASS016|autorizacao_autoexclusao_contexto_revisao_legado';
 -- Membro 16 lidera equipe ativa; 17 lidera liturgia; 18 tem escala; 19 é responsável nominal.
 insert into app_private.teams(id,church_id,name,leader_member_id) values(pg_temp.id(400),pg_temp.id(1000),'Equipe prova 016',pg_temp.id(16));
 insert into app_private.events(id,church_id,title,timezone,status,planned_start_at,planned_end_at,liturgy_leader_member_id)
 values(pg_temp.id(500),pg_temp.id(1000),'Evento prova 016','America/Sao_Paulo','scheduled',clock_timestamp()+interval '1 day',clock_timestamp()+interval '2 days',pg_temp.id(17));
 insert into app_private.event_items(id,church_id,event_id,title,nominal_leader_member_id) values
 (pg_temp.id(501),pg_temp.id(1000),pg_temp.id(500),'Item prova 016',pg_temp.id(19));
 insert into app_private.assignments(id,church_id,event_id,team_id,member_id) values
 (pg_temp.id(502),pg_temp.id(1000),pg_temp.id(500),pg_temp.id(400),pg_temp.id(18));
 perform pg_temp.deactivate(16,312,'P0022');
 -- Transferência é um comando prévio explícito; restauração não recupera a liderança antiga.
 perform pg_temp.as_authenticated(format('select to_jsonb(r) from public.assign_team_leader(%L,%L,%L,%L,1) r',
   pg_temp.id(1000),pg_temp.id(353),pg_temp.id(400),pg_temp.id(11)));
 perform pg_temp.deactivate(16,354);perform pg_temp.restore(16,355);
 if (select leader_member_id from app_private.teams where id=pg_temp.id(400))<>pg_temp.id(11) then
   raise exception 'Restauração modificou liderança transferida'; end if;
 perform pg_temp.deactivate(17,313,'P0023');
 perform pg_temp.deactivate(18,314,'P0024');
 perform pg_temp.deactivate(19,315,'P0024');
 update app_private.events set planned_start_at=clock_timestamp()-interval '2 days',planned_end_at=clock_timestamp()-interval '1 day' where id=pg_temp.id(500);
 perform pg_temp.deactivate(18,316,'P0025');
 update app_private.events set status='in_progress' where id=pg_temp.id(500);
 perform pg_temp.deactivate(18,317,'P0024');
 raise notice 'PASS016|E20_dependencias_reais_futuras_em_andamento_expiradas';
 -- Encerramento real pela liturgia, antes da exclusão; escalas e referências não são apagadas.
 insert into app_private.church_access(church_id,user_id,member_id,is_admin,status,onboarding_completed_at,granted_by_user_id)
 values(pg_temp.id(1000),pg_temp.id(7),pg_temp.id(17),false,'active',clock_timestamp(),pg_temp.id(1));
 perform set_config('request.jwt.claim.sub',pg_temp.id(7)::text,true);
 perform pg_temp.as_authenticated(format('select to_jsonb(r) from public.finish_event_service(%L,%L,%L,1) r',pg_temp.id(1000),pg_temp.id(318),pg_temp.id(500)));
 perform set_config('request.jwt.claim.sub',pg_temp.id(1)::text,true);
 select to_jsonb(e)::text into before_history from app_private.events e where id=pg_temp.id(500);
 select to_jsonb(a)::text into before_access from app_private.assignments a where id=pg_temp.id(502);
 perform pg_temp.deactivate(17,319); perform pg_temp.deactivate(18,320); perform pg_temp.deactivate(19,321);
 if (select to_jsonb(e)::text from app_private.events e where id=pg_temp.id(500))<>before_history
 or (select to_jsonb(a)::text from app_private.assignments a where id=pg_temp.id(502))<>before_access
 or not exists(select 1 from app_private.event_items where id=pg_temp.id(501) and nominal_leader_member_id=pg_temp.id(19)) then
   raise exception 'Histórico encerrado foi alterado'; end if;
 raise notice 'PASS016|E21_historico_encerrado_preservado';
 -- Responsável inativo recusado em cada criação que antes só lia status sem bloquear.
 perform pg_temp.as_authenticated(format('select to_jsonb(r) from public.create_church_team(%L,%L,%L,%L) r',pg_temp.id(1000),pg_temp.id(322),'Equipe indevida',pg_temp.id(18)),'P0020');
 perform pg_temp.as_authenticated(format('select to_jsonb(r) from public.create_church_event(%L,%L,%L,%L,%L,%L,%L) r',pg_temp.id(1000),pg_temp.id(323),'Evento indevido','culto',clock_timestamp()+interval '1 day',clock_timestamp()+interval '2 days',pg_temp.id(18)),'P0020');
 perform pg_temp.as_authenticated(format('select to_jsonb(r) from public.create_event_item(%L,%L,%L,%L,%L,1,300,null,%L) r',pg_temp.id(1000),pg_temp.id(324),pg_temp.id(500),'Item indevido','liturgical',pg_temp.id(18)),'P0020');
 raise notice 'PASS016|escritores_recusam_responsavel_inativo';
 -- A inexistência da fonte precisa continuar bloqueando, mesmo após a integração.
 alter table app_private.assignments rename to assignments_016_temporarily_unavailable;
 perform pg_temp.deactivate(14,325,'P0021');
 alter table app_private.assignments_016_temporarily_unavailable rename to assignments;
 -- Cada contraprova desfaz também a própria alteração de fixture.
 foreach mode in array array['unconfirmed','anonymous','banned','deleted','member_inactive','church_inactive','not_admin'] loop
  begin
   case mode
    when 'unconfirmed' then update auth.users set email_confirmed_at=null where id=pg_temp.id(1);
    when 'anonymous' then update auth.users set is_anonymous=true where id=pg_temp.id(1);
    when 'banned' then update auth.users set banned_until=clock_timestamp()+interval '1 day' where id=pg_temp.id(1);
    when 'deleted' then update auth.users set deleted_at=clock_timestamp() where id=pg_temp.id(1);
    when 'member_inactive' then update app_private.members set status='inactive' where id=pg_temp.id(11);
    when 'church_inactive' then update app_private.churches set status='inactive' where id=pg_temp.id(1000);
    when 'not_admin' then update app_private.church_access set is_admin=false where church_id=pg_temp.id(1000) and user_id=pg_temp.id(1);
   end case;
   perform pg_temp.deactivate(14,350,'42501');
   perform pg_temp.as_authenticated(format('select to_jsonb(r) from public.get_member_lifecycle_receipt(%L) r',pg_temp.id(301)),'42501');
   raise exception 'Desfazer contraprova' using errcode='P0098';
  exception when sqlstate 'P0098' then null;
  end;
 end loop;
 raise notice 'PASS016|predicados_Auth_membro_igreja_admin_recibo';
 -- O operador pode desativar outro administrador quando há sucessor elegível, nunca a si.
 perform pg_temp.deactivate(12,326);
 begin
   update app_private.church_access set status='revoked',revoked_at=clock_timestamp(),revoked_by_user_id=pg_temp.id(1)
   where church_id=pg_temp.id(1000) and user_id=pg_temp.id(1);
   raise exception 'A trava do último administrador deveria recusar';
 exception when check_violation then null;
 end;
 if (select count(*) from app_private.church_access where church_id=pg_temp.id(1000) and is_admin and status='active')<>1 then
   raise exception 'Continuidade administrativa violada'; end if;
 raise notice 'PASS016|fonte_ausente_continuidade_administrativa';
end $test$;
-- Falhas injetadas por triggers exclusivamente no ensaio, sem desabilitar os gatilhos reais.
create function pg_temp.fail_lifecycle_write() returns trigger language plpgsql as $$
begin raise exception 'Falha injetada de atomicidade 016' using errcode='P0099'; end $$;
do $atomic$
declare table_name text; before_member text; before_access text; before_attempts text; before_requests text; before_audit text; before_receipts text;
begin
 perform set_config('request.jwt.claim.sub',pg_temp.id(1)::text,true);
 insert into app_private.church_access(church_id,user_id,member_id,is_admin,status,onboarding_completed_at,granted_by_user_id)
 values(pg_temp.id(1000),pg_temp.id(6),pg_temp.id(14),false,'active',clock_timestamp(),pg_temp.id(1));
 insert into app_private.access_invitations(id,church_id,member_id,recipient_email,token_digest,issued_by_user_id,issued_at,expires_at,redeemed_at,redeemed_by_user_id)
 select pg_temp.id(n),pg_temp.id(1000),pg_temp.id(14),'prova016_6@rehearsal.test',sha256(convert_to('fixture-'||n,'UTF8')),pg_temp.id(1),
 t,t+interval '72 hours',case when n=107 then t+interval '1 hour' end,case when n=107 then pg_temp.id(6) end
 from generate_series(106,107) n cross join lateral (select clock_timestamp()-interval '3 hours' as t) times;
 insert into app_private.access_requests(id,church_id,member_id,invitation_id,requester_user_id,original_display_name,proposed_display_name,submitted_at,expires_at)
 select pg_temp.id(207),church_id,member_id,id,pg_temp.id(6),'Membro 016 14','Outro nome',issued_at+interval '1 hour',expires_at
 from app_private.access_invitations where id=pg_temp.id(107);
 foreach table_name in array array['audit_entries','command_receipts'] loop
  select md5(string_agg(to_jsonb(m)::text,'' order by m.id)) into before_member from app_private.members m;
  select md5(string_agg(to_jsonb(c)::text,'' order by c.id)) into before_access from app_private.church_access c;
  select md5(string_agg(to_jsonb(i)::text,'' order by i.id)) into before_attempts from app_private.access_invitations i;
  select md5(string_agg(to_jsonb(r)::text,'' order by r.id)) into before_requests from app_private.access_requests r;
  select md5(coalesce(string_agg(to_jsonb(a)::text,'' order by a.id),'')) into before_audit from app_private.audit_entries a;
  select md5(coalesce(string_agg(to_jsonb(r)::text,'' order by r.id),'')) into before_receipts from app_private.command_receipts r;
  execute format('create trigger fail_016 before insert on app_private.%I for each row execute function pg_temp.fail_lifecycle_write()',table_name);
  perform pg_temp.deactivate(14,330,'P0099');
  execute format('drop trigger fail_016 on app_private.%I',table_name);
  if (select md5(string_agg(to_jsonb(m)::text,'' order by m.id)) from app_private.members m)<>before_member
  or (select md5(string_agg(to_jsonb(c)::text,'' order by c.id)) from app_private.church_access c)<>before_access
  or (select md5(string_agg(to_jsonb(i)::text,'' order by i.id)) from app_private.access_invitations i)<>before_attempts
  or (select md5(string_agg(to_jsonb(r)::text,'' order by r.id)) from app_private.access_requests r)<>before_requests
  or (select md5(coalesce(string_agg(to_jsonb(a)::text,'' order by a.id),'')) from app_private.audit_entries a)<>before_audit
  or (select md5(coalesce(string_agg(to_jsonb(r)::text,'' order by r.id),'')) from app_private.command_receipts r)<>before_receipts then
   raise exception 'Falha de % deixou efeitos parciais',table_name; end if;
  raise notice 'PASS016|atomicidade_%',table_name;
 end loop;
end $atomic$;
