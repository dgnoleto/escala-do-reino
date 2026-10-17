-- Verificação somente leitura após instalar 016 na base descartável autorizada.
select p.proname,
 p.prosecdef as security_definer,p.provolatile='v' as volatile,
 p.proconfig @> array['search_path=""','statement_timeout=5s'] as config_restrita,
 has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute,
 not has_function_privilege('anon',p.oid,'EXECUTE') as anon_blocked,
 not has_function_privilege('service_role',p.oid,'EXECUTE') as service_role_blocked,
 not exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE') as public_blocked
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('deactivate_church_member','restore_church_member','create_church_member',
 'issue_church_invitation','redeem_invitation_confirm_name','redeem_invitation_propose_name','decide_access_request',
 'create_church_team','create_church_event','create_event_item') order by p.proname;
