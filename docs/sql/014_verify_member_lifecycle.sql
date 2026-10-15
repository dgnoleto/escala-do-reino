-- Escala do Reino: verificação somente leitura após aplicar 013_member_lifecycle.sql.
-- Valida definição de assinaturas completas das 4 RPCs de ciclo de vida de membros,
-- endurecimento de segurança, privilégios estritos, gatilho monotônico exclusivo de members,
-- integridade dos gatilhos genéricos prévios, RLS e bloqueio total de app_private.
-- Esperado: todas as colunas true. Não altera dados nem permissões.

with procs as (
  select
    to_regprocedure('public.list_church_members_admin(uuid, text, integer, integer)') as list_admin_proc,
    to_regprocedure('public.restore_church_member(uuid, uuid, uuid, text)') as restore_proc,
    to_regprocedure('public.get_member_lifecycle_receipt(uuid)') as receipt_proc,
    to_regprocedure('public.deactivate_church_member(uuid, uuid, uuid, text)') as deactivate_proc
)
select
  -- 1. Verificação de presença e assinaturas exatas das 4 RPCs de ciclo de vida
  (
    p.list_admin_proc is not null
    and p.restore_proc is not null
    and p.receipt_proc is not null
    and p.deactivate_proc is not null
  ) as all_four_lifecycle_rpcs_present,

  -- 2. Verificação de configuração de segurança das 4 RPCs (SECURITY DEFINER, search_path vazio e timeout de 5s)
  (
    select bool_and(
      pr.prosecdef = true
      and (pr.proconfig @> array['search_path=""'] or pr.proconfig @> array['search_path='])
      and pr.proconfig @> array['statement_timeout=5s']
    )
    from pg_catalog.pg_proc pr
    where pr.oid in (
      p.list_admin_proc, p.restore_proc, p.receipt_proc, p.deactivate_proc
    )
  ) as all_four_rpcs_hardened,

  -- 3. Verificação de privilégios estritos sobre as 4 RPCs (somente authenticated; anon, service_role e public revogados)
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
      p.list_admin_proc, p.restore_proc, p.receipt_proc, p.deactivate_proc
    )
  ) as all_four_rpcs_privileges_verified,

  -- 4. Verificação do gatilho monotônico exclusivo de members
  (
    exists (
      select 1 from pg_catalog.pg_trigger tr
      join pg_catalog.pg_class c on c.oid = tr.tgrelid
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      join pg_catalog.pg_proc p on p.oid = tr.tgfoid
      where n.nspname = 'app_private'
        and c.relname = 'members'
        and tr.tgname = 'members_touch_updated_at'
        and p.proname = 'touch_member_updated_at'
    )
  ) as members_monotonic_trigger_verified,

  -- 5. Verificação de que gatilhos genéricos de churches e church_access foram preservados
  (
    exists (
      select 1 from pg_catalog.pg_trigger tr
      join pg_catalog.pg_class c on c.oid = tr.tgrelid
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      join pg_catalog.pg_proc p on p.oid = tr.tgfoid
      where n.nspname = 'app_private'
        and c.relname = 'churches'
        and tr.tgname = 'churches_touch_updated_at'
        and p.proname = 'touch_updated_at'
    )
    and exists (
      select 1 from pg_catalog.pg_trigger tr
      join pg_catalog.pg_class c on c.oid = tr.tgrelid
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      join pg_catalog.pg_proc p on p.oid = tr.tgfoid
      where n.nspname = 'app_private'
        and c.relname = 'church_access'
        and tr.tgname = 'church_access_touch_updated_at'
        and p.proname = 'touch_updated_at'
    )
  ) as generic_triggers_preserved,

  -- 6. Todas as 7 tabelas privadas de app_private continuam com RLS ativo
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

  -- 7. Schema app_private continua estritamente inacessível para clientes
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
