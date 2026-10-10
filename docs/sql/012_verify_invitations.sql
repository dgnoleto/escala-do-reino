-- Escala do Reino: verificação somente leitura após aplicar 011_invitations_and_requests.sql.
-- Valida definição efetiva de tipos, constraints, assinaturas completas das 9 RPCs,
-- endurecimento de segurança, privilégios efetivos, RLS e bloqueio de app_private.
-- Esperado: todas as colunas true. Não altera dados nem permissões.

with procs as (
  select
    to_regprocedure('public.issue_church_invitation(uuid, uuid, uuid, text)') as issue_proc,
    to_regprocedure('public.get_invitation_details(text)') as details_proc,
    to_regprocedure('public.redeem_invitation_confirm_name(uuid, text, text)') as redeem_confirm_proc,
    to_regprocedure('public.redeem_invitation_propose_name(uuid, text, text)') as redeem_propose_proc,
    to_regprocedure('public.get_my_access_request(uuid)') as my_request_proc,
    to_regprocedure('public.list_church_invitations(uuid, text, integer, integer)') as list_inv_proc,
    to_regprocedure('public.list_church_access_requests(uuid, text, integer, integer)') as list_req_proc,
    to_regprocedure('public.decide_access_request(uuid, uuid, uuid, text)') as decide_proc,
    to_regprocedure('public.get_invitation_command_receipt(uuid)') as receipt_proc
)
select
  -- 1. Verificação da evolução compatível e efetiva de command_receipts
  (
    exists (
      select 1 from information_schema.columns
      where table_schema = 'app_private' and table_name = 'command_receipts'
        and column_name = 'result_entity_id' and data_type = 'uuid'
        and is_nullable = 'YES' and column_default is null
    )
    and exists (
      select 1 from information_schema.columns
      where table_schema = 'app_private' and table_name = 'command_receipts'
        and column_name = 'result_payload' and data_type = 'jsonb'
        and is_nullable = 'YES' and column_default is null
    )
    and exists (
      select 1 from information_schema.check_constraints
      where constraint_schema = 'app_private'
        and constraint_name = 'command_receipts_payload_check'
    )
    and exists (
      select 1 from pg_catalog.pg_constraint con
      join pg_catalog.pg_class c on c.oid = con.conrelid
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'app_private' and c.relname = 'command_receipts'
        and con.conname = 'command_receipts_payload_check'
        and pg_catalog.pg_get_constraintdef(con.oid) ~* 'result_payload\s+is\s+null'
        and pg_catalog.pg_get_constraintdef(con.oid) ~* 'jsonb_typeof\s*\(\s*result_payload\s*\)\s*=\s*''object'''
        and pg_catalog.pg_get_constraintdef(con.oid) ~* 'octet_length\s*\(\s*\(?\s*result_payload\s*\)?::text\s*\)\s*<=\s*4096'
    )
  ) as command_receipts_evolution_verified,

  -- 2. Verificação de presença e assinaturas exatas das 9 RPCs
  (
    p.issue_proc is not null
    and p.details_proc is not null
    and p.redeem_confirm_proc is not null
    and p.redeem_propose_proc is not null
    and p.my_request_proc is not null
    and p.list_inv_proc is not null
    and p.list_req_proc is not null
    and p.decide_proc is not null
    and p.receipt_proc is not null
  ) as all_nine_rpcs_present,

  -- 3. Verificação de configuração de segurança das 9 RPCs (SECURITY DEFINER, search_path vazio e timeout de 5s)
  (
    select bool_and(
      pr.prosecdef = true
      and (pr.proconfig @> array['search_path=""'] or pr.proconfig @> array['search_path='])
      and pr.proconfig @> array['statement_timeout=5s']
    )
    from pg_catalog.pg_proc pr
    where pr.oid in (
      p.issue_proc, p.details_proc, p.redeem_confirm_proc, p.redeem_propose_proc,
      p.my_request_proc, p.list_inv_proc, p.list_req_proc, p.decide_proc, p.receipt_proc
    )
  ) as all_nine_rpcs_hardened,

  -- 4. Verificação de privilégios estritos sobre as 9 RPCs (somente authenticated; anon, service_role e public revogados)
  (
    select bool_and(
      has_function_privilege('authenticated', pr.oid, 'EXECUTE')
      and not has_function_privilege('anon', pr.oid, 'EXECUTE')
      and not has_function_privilege('service_role', pr.oid, 'EXECUTE')
      and not exists (
        select 1 from lateral pg_catalog.aclexplode(coalesce(pr.proacl, pg_catalog.acldefault('f', pr.proowner))) a
        where a.grantee = 0 and a.privilege_type = 'EXECUTE'
      )
    )
    from pg_catalog.pg_proc pr
    where pr.oid in (
      p.issue_proc, p.details_proc, p.redeem_confirm_proc, p.redeem_propose_proc,
      p.my_request_proc, p.list_inv_proc, p.list_req_proc, p.decide_proc, p.receipt_proc
    )
  ) as all_nine_rpcs_privileges_verified,

  -- 5. Todas as 7 tabelas privadas de app_private continuam com RLS ativo
  (
    select count(*) = 7 and bool_and(c.relrowsecurity)
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'app_private' and c.relkind = 'r'
      and c.relname in (
        'churches', 'members', 'church_access', 'access_invitations',
        'access_requests', 'audit_entries', 'command_receipts'
      )
  ) as all_seven_private_tables_have_rls,

  -- 6. Schema app_private continua estritamente inacessível para clientes
  not exists (
    select 1
    from unnest(array['anon', 'authenticated', 'service_role']) r(role_name)
    where has_schema_privilege(r.role_name, 'app_private', 'USAGE,CREATE')
       or exists (
         select 1 from pg_catalog.pg_class c
         join pg_catalog.pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'app_private' and c.relkind = 'r'
           and has_table_privilege(r.role_name, c.oid,
             'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
       )
  ) as private_schema_still_blocked

from procs p;
