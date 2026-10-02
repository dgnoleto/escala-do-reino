-- Escala do Reino — verificação pós-aplicação de get_my_church_access
-- Somente leitura; sem alterações. Executar após 005_get_my_church_access.sql.
--
-- Todas as colunas devem retornar true.

select
  -- A função existe
  to_regproc('app_private.get_my_church_access') is not null
    as function_exists,

  -- É SECURITY DEFINER
  (
    select p.prosecdef
      from pg_catalog.pg_proc      as p
      join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
     where n.nspname = 'app_private'
       and p.proname = 'get_my_church_access'
       and p.pronargs = 0
  ) = true
    as is_security_definer,

  -- search_path está configurado (não é herança do ambiente)
  (
    select array_to_string(p.proconfig, ',') ilike '%search_path=%'
      from pg_catalog.pg_proc      as p
      join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
     where n.nspname = 'app_private'
       and p.proname = 'get_my_church_access'
       and p.pronargs = 0
  ) = true
    as has_fixed_search_path,

  -- authenticated tem EXECUTE
  exists (
    select 1
      from information_schema.routine_privileges as rp
     where rp.specific_schema = 'app_private'
       and rp.routine_name    = 'get_my_church_access'
       and rp.grantee         = 'authenticated'
       and rp.privilege_type  = 'EXECUTE'
  )
    as authenticated_has_execute,

  -- PUBLIC, anon e service_role NÃO têm EXECUTE
  not exists (
    select 1
      from information_schema.routine_privileges as rp
     where rp.specific_schema = 'app_private'
       and rp.routine_name    = 'get_my_church_access'
       and rp.grantee in ('PUBLIC', 'anon', 'service_role')
       and rp.privilege_type  = 'EXECUTE'
  )
    as restricted_roles_have_no_execute;
