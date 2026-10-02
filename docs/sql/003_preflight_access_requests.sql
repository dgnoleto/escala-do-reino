-- Somente leitura. Esperado: todos os campos true.
select
  current_setting('server_encoding') = 'UTF8' as server_is_utf8,
  current_setting('client_encoding') = 'UTF8' as client_is_utf8,
  to_regclass('app_private.churches') is not null
    and to_regclass('app_private.members') is not null
    and to_regclass('app_private.church_access') is not null
    and to_regclass('app_private.access_invitations') is not null as initial_tables_present,
  to_regclass('app_private.access_requests') is null as requests_table_available,
  to_regclass('app_private.audit_entries') is null as audit_table_available,
  not exists (
    select 1 from app_private.access_invitations
    where redeemed_at is null and revoked_at is null
    group by church_id, member_id having count(*) > 1
  ) as one_open_invitation_compatible;
