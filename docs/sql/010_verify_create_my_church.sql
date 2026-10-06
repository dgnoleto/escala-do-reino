-- Escala do Reino: verificação somente leitura após aplicar 009_create_my_church.sql.
-- Esperado: todas as colunas true. Não altera dados nem permissões.
with procs as (
  select
    to_regprocedure('public.check_church_creation_eligibility()') as elig_proc,
    to_regprocedure('public.create_my_church(uuid, text, text, text, text, text, text)') as create_proc,
    to_regprocedure('public.get_create_church_receipt(uuid)') as receipt_proc
)
select
  -- 1. Verificação detalhada do índice de administração única (unicidade, validade e predicado)
  exists (
    select 1
    from pg_catalog.pg_index ix
    join pg_catalog.pg_class c on c.oid = ix.indexrelid
    join pg_catalog.pg_class t on t.oid = ix.indrelid
    join pg_catalog.pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'app_private'
      and t.relname = 'church_access'
      and c.relname = 'church_access_single_active_admin_idx'
      and ix.indisunique = true
      and ix.indisvalid = true
      and pg_get_expr(ix.indpred, ix.indrelid) ~* 'is_admin.*true.*status.*active'
  ) as single_admin_index_verified,

  -- 2. Verificação dos gatilhos de proteção do último administrador (habilitação, função vinculada e tabela)
  (
    exists (
      select 1 from pg_catalog.pg_trigger tr
      where tr.tgname = 'church_access_protect_last_admin'
        and tr.tgrelid = 'app_private.church_access'::regclass
        and tr.tgfoid = 'app_private.protect_last_active_admin'::regproc
        and tr.tgenabled = 'O'
    )
    and exists (
      select 1 from pg_catalog.pg_trigger tr
      where tr.tgname = 'members_protect_last_admin'
        and tr.tgrelid = 'app_private.members'::regclass
        and tr.tgfoid = 'app_private.protect_last_active_admin_member'::regproc
        and tr.tgenabled = 'O'
    )
  ) as protect_last_admin_triggers_verified,

  -- 3. Verificação de segurança da RPC check_church_creation_eligibility
  p.elig_proc is not null
    and (select prosecdef from pg_catalog.pg_proc where oid = p.elig_proc)
    and (select proconfig @> array['search_path=""'] or proconfig @> array['search_path='] from pg_catalog.pg_proc where oid = p.elig_proc)
    and (select proconfig @> array['statement_timeout=5s'] from pg_catalog.pg_proc where oid = p.elig_proc)
    and has_function_privilege('authenticated', p.elig_proc, 'EXECUTE')
    and not has_function_privilege('anon', p.elig_proc, 'EXECUTE')
    and not has_function_privilege('service_role', p.elig_proc, 'EXECUTE')
    and not exists (
      select 1 from pg_catalog.pg_proc pr, lateral pg_catalog.aclexplode(coalesce(pr.proacl, pg_catalog.acldefault('f', pr.proowner))) a
      where pr.oid = p.elig_proc and a.grantee = 0 and a.privilege_type = 'EXECUTE'
    ) as check_eligibility_rpc_secure,

  -- 4. Verificação de segurança da RPC create_my_church
  p.create_proc is not null
    and (select prosecdef from pg_catalog.pg_proc where oid = p.create_proc)
    and (select proconfig @> array['search_path=""'] or proconfig @> array['search_path='] from pg_catalog.pg_proc where oid = p.create_proc)
    and (select proconfig @> array['statement_timeout=5s'] from pg_catalog.pg_proc where oid = p.create_proc)
    and has_function_privilege('authenticated', p.create_proc, 'EXECUTE')
    and not has_function_privilege('anon', p.create_proc, 'EXECUTE')
    and not has_function_privilege('service_role', p.create_proc, 'EXECUTE')
    and not exists (
      select 1 from pg_catalog.pg_proc pr, lateral pg_catalog.aclexplode(coalesce(pr.proacl, pg_catalog.acldefault('f', pr.proowner))) a
      where pr.oid = p.create_proc and a.grantee = 0 and a.privilege_type = 'EXECUTE'
    ) as create_church_rpc_secure,

  -- 5. Verificação de segurança da RPC get_create_church_receipt
  p.receipt_proc is not null
    and (select prosecdef from pg_catalog.pg_proc where oid = p.receipt_proc)
    and (select proconfig @> array['search_path=""'] or proconfig @> array['search_path='] from pg_catalog.pg_proc where oid = p.receipt_proc)
    and (select proconfig @> array['statement_timeout=5s'] from pg_catalog.pg_proc where oid = p.receipt_proc)
    and has_function_privilege('authenticated', p.receipt_proc, 'EXECUTE')
    and not has_function_privilege('anon', p.receipt_proc, 'EXECUTE')
    and not has_function_privilege('service_role', p.receipt_proc, 'EXECUTE')
    and not exists (
      select 1 from pg_catalog.pg_proc pr, lateral pg_catalog.aclexplode(coalesce(pr.proacl, pg_catalog.acldefault('f', pr.proowner))) a
      where pr.oid = p.receipt_proc and a.grantee = 0 and a.privilege_type = 'EXECUTE'
    ) as get_create_church_receipt_secure,

  -- 6. Todas as 7 tabelas de app_private continuam com RLS ativo
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

  -- 7. Schema app_private continua inacessível diretamente para clientes
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
