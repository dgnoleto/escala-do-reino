-- ==============================================================================
-- 024_rehearsal_consolidated.sql
-- Ensaio Transacional Completo e Reversível de Laboratório (SQL Puro / Sem \i)
-- Issue #27 / Parecer do Codex / Homologação
--
-- COMPATIBILIDADE DE AMBIENTE E EXECUTOR:
-- 1. Supabase SQL Editor (Dashboard Web):
--    - Este arquivo contém EXCLUSIVAMENTE SQL padrão e blocos PL/pgSQL.
--    - NÃO contém comandos de barra invertida (\i ou \set) do CLI psql.
--    - Pode ser colado e executado integralmente no SQL Editor do Supabase Studio.
--
-- 2. Windows PowerShell com Docker Local (Recomendado na ausência de psql no PATH):
--    Get-Content docs\sql\024_rehearsal_consolidated.sql -Raw | docker exec -i supabase_db_escala-convites-http-lab psql -U postgres -d postgres -v ON_ERROR_STOP=1
--
-- 3. CLI psql (em ambientes Linux/macOS ou com psql instalado no PATH):
--    psql -v ON_ERROR_STOP=1 -f docs/sql/024_rehearsal_consolidated.sql
--
-- GARANTIAS TRANSACIONAIS:
-- - Inicia estritamente com BEGIN;
-- - lock_timeout e statement_timeout restritos;
-- - Interrompe imediatamente com RAISE EXCEPTION diante de qualquer divergência;
-- - NÃO contém nenhum COMMIT interno;
-- - Termina estritamente com ROLLBACK; revertendo 100% das alterações e fixtures.
-- ==============================================================================

begin;

set local lock_timeout = '2s';
set local statement_timeout = '5s';

-- ------------------------------------------------------------------------------
-- ETAPA 1: PREFLIGHT DE SEGURANÇA E CONTRATO (024_preflight.sql)
-- ------------------------------------------------------------------------------
do $preflight$
declare
  v_proc regprocedure;
  v_helper regprocedure;
  v_func_def text;
  v_owner text;
  v_is_secdef boolean;
  v_config text[];
  v_proc_rettype text;
  v_helper_rettype text;
  v_auth_has_exec boolean;
  v_anon_has_exec boolean;
  v_service_role_has_exec boolean;
  v_public_has_exec boolean;
begin
  -- 1. Conferir assinatura exata da RPC alvo
  v_proc := to_regprocedure('public.instantiate_service_template(uuid, uuid, uuid)');
  if v_proc is null then
    raise exception 'PREFLIGHT FALHOU: RPC public.instantiate_service_template(uuid, uuid, uuid) não encontrada.'
      using errcode = 'P0002';
  end if;

  -- 2. Obter metadados da RPC alvo
  select
    pg_get_functiondef(v_proc),
    r.rolname,
    p.prosecdef,
    p.proconfig,
    format_type(p.prorettype, null)
  into
    v_func_def,
    v_owner,
    v_is_secdef,
    v_config,
    v_proc_rettype
  from pg_catalog.pg_proc p
  join pg_catalog.pg_roles r on r.oid = p.proowner
  where p.oid = v_proc;

  -- 3. Conferir tipo de retorno da RPC (espera-se jsonb)
  if v_proc_rettype <> 'jsonb' then
    raise exception 'PREFLIGHT FALHOU: Tipo de retorno da RPC é "%", esperava-se "jsonb".', v_proc_rettype
      using errcode = 'P0003';
  end if;

  -- 4. Conferir owner atual (espera-se postgres) - Interrompe imediatamente se divergir
  if v_owner <> 'postgres' then
    raise exception 'PREFLIGHT FALHOU: Owner atual da RPC é "%", esperava-se estritamente "postgres".', v_owner
      using errcode = 'P0003';
  end if;

  -- 5. Conferir SECURITY DEFINER e configurações de segurança (B4: hardening de proconfig NULL)
  if v_is_secdef is not true then
    raise exception 'PREFLIGHT FALHOU: A RPC atual não está configurada como SECURITY DEFINER.'
      using errcode = 'P0003';
  end if;

  if v_config is null then
    raise exception 'PREFLIGHT FALHOU: Configurações de segurança ausentes (proconfig é NULL).'
      using errcode = 'P0003';
  end if;

  if (v_config @> array['search_path=""'] or v_config @> array['search_path=']) is not true then
    raise exception 'PREFLIGHT FALHOU: A RPC atual não possui search_path vazio configurado.'
      using errcode = 'P0003';
  end if;

  if (v_config @> array['statement_timeout=5s']) is not true then
    raise exception 'PREFLIGHT FALHOU: A RPC atual não possui statement_timeout=5s configurado.'
      using errcode = 'P0003';
  end if;

  -- 6. Conferir existência e tipo da função auxiliar de autorização
  v_helper := to_regprocedure('app_private.has_church_settings_access(uuid, boolean)');
  if v_helper is null then
    raise exception 'PREFLIGHT FALHOU: Função auxiliar app_private.has_church_settings_access(uuid, boolean) não encontrada.'
      using errcode = 'P0002';
  end if;

  select format_type(p.prorettype, null) into v_helper_rettype
  from pg_catalog.pg_proc p where p.oid = v_helper;

  if v_helper_rettype <> 'boolean' then
    raise exception 'PREFLIGHT FALHOU: Tipo de retorno da função auxiliar é "%", esperava-se "boolean".', v_helper_rettype
      using errcode = 'P0003';
  end if;

  -- 7. Conferir definição-base esperada (SQL 022) antes da substituição (B3: escape de _)
  if (v_func_def like '%''parallelServices''%') is not true then
    raise exception 'PREFLIGHT FALHOU: A definição atual não contém a propriedade JSON camelCase "parallelServices".'
      using errcode = 'P0003';
  end if;

  if v_func_def like '%''parallel\_services''%' escape '\' then
    raise exception 'PREFLIGHT FALHOU: A definição atual contém incorretamente a chave JSON "parallel_services".'
      using errcode = 'P0003';
  end if;

  if (v_func_def like '%is\_default\_active = true%' escape '\') is not true then
    raise exception 'PREFLIGHT FALHOU: A definição atual não filtra apoios ativos por "is_default_active = true".'
      using errcode = 'P0003';
  end if;

  if (v_func_def like '%plannedDurationMinutes%') is not true then
    raise exception 'PREFLIGHT FALHOU: A definição atual não contém o campo "plannedDurationMinutes" no contrato de atividades.'
      using errcode = 'P0003';
  end if;

  if (v_func_def like '%roster%') is not true then
    raise exception 'PREFLIGHT FALHOU: A definição atual não contém o campo "roster" no contrato de atividades.'
      using errcode = 'P0003';
  end if;

  if (v_func_def like '%musics%') is not true then
    raise exception 'PREFLIGHT FALHOU: A definição atual não contém o campo "musics" no contrato de atividades.'
      using errcode = 'P0003';
  end if;

  if (v_func_def like '%responsibleMemberId%' and v_func_def like '%responsibleTeamId%') is not true then
    raise exception 'PREFLIGHT FALHOU: A definição atual não contém os campos de responsabilidade esperados.'
      using errcode = 'P0003';
  end if;

  if (v_func_def like '%leaderId%' and v_func_def like '%volunteers%') is not true then
    raise exception 'PREFLIGHT FALHOU: A definição atual não contém os campos de liderança e voluntários esperados em apoios.'
      using errcode = 'P0003';
  end if;

  -- 8. Conferir privilégios e ACLs existentes
  v_auth_has_exec := has_function_privilege('authenticated', v_proc, 'EXECUTE');
  v_anon_has_exec := has_function_privilege('anon', v_proc, 'EXECUTE');
  v_service_role_has_exec := has_function_privilege('service_role', v_proc, 'EXECUTE');
  select exists (
    select 1 from lateral pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
    where a.grantee = 0 and a.privilege_type = 'EXECUTE'
  ) into v_public_has_exec
  from pg_catalog.pg_proc p where p.oid = v_proc;

  if not v_auth_has_exec then
    raise exception 'PREFLIGHT FALHOU: Role authenticated não possui permissão de EXECUTE na RPC base.'
      using errcode = '42501';
  end if;

  if v_anon_has_exec then
    raise exception 'PREFLIGHT FALHOU: Role anon possui indevidamente permissão de EXECUTE na RPC base.'
      using errcode = '42501';
  end if;

  if v_service_role_has_exec then
    raise exception 'PREFLIGHT FALHOU: Role service_role possui indevidamente permissão de EXECUTE na RPC base.'
      using errcode = '42501';
  end if;

  if v_public_has_exec then
    raise exception 'PREFLIGHT FALHOU: Role public possui indevidamente permissão de EXECUTE na RPC base.'
      using errcode = '42501';
  end if;

  raise notice '>> [1/4] Preflight aprovado com sucesso.';
end $preflight$;

-- ------------------------------------------------------------------------------
-- ETAPA 2: APLICAÇÃO DO INCREMENTO DE SEGURANÇA (024_service_template_instantiation_security.sql)
-- ------------------------------------------------------------------------------
create or replace function public.instantiate_service_template(
  p_command_id uuid,
  p_church_id uuid,
  p_template_id uuid
)
returns jsonb
language plpgsql stable security definer set search_path = '' set statement_timeout = '5s'
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_st app_private.service_templates%rowtype;
  v_activities jsonb;
  v_parallel_services jsonb;
begin
  -- 1. Autenticação obrigatória
  if v_uid is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  -- 2. Verificação estrita de autorização de vínculo com a igreja (PRD §3.2 & #27)
  -- Consulta app_private.church_access e app_private.members para confirmar vínculo ativo
  -- Permite administradores e líderes da liturgia/membros autorizados (false = não exige admin)
  if not app_private.has_church_settings_access(p_church_id, false) then
    raise exception 'Acesso negado à igreja especificada.' using errcode = '42501';
  end if;

  -- 3. Existência do modelo no escopo da igreja informada
  select * into v_st from app_private.service_templates
  where id = p_template_id and church_id = p_church_id;

  if not found then
    raise exception 'Modelo de culto não encontrado na igreja especificada.' using errcode = 'P0002';
  end if;

  -- 4. Atividades como cópia independente e sem alocação nominal de pessoas (CA03)
  -- Contrato fiel ao SQL 022
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', 'act-' || gen_random_uuid(),
      'title', sta.title,
      'category', sta.category,
      'plannedDurationMinutes', sta.planned_duration_minutes,
      'status', 'pendente',
      'responsibleMemberId', null,
      'responsibleTeamId', null,
      'notes', sta.notes,
      'requiresPlayback', sta.requires_playback,
      'musics', '[]'::jsonb,
      'roster', '[]'::jsonb
    ) order by sta.display_order asc
  ), '[]'::jsonb)
  into v_activities
  from app_private.service_template_activities sta
  where sta.template_id = p_template_id;

  -- 5. Serviços paralelos como cópia independente e sem voluntários escalados (CA03)
  -- Contrato fiel ao SQL 022: apenas ativos por padrão (is_default_active = true) e chave 'parallelServices'
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', 'serv-' || gen_random_uuid(),
      'name', stps.service_name,
      'teamId', stps.team_id,
      'leaderId', null,
      'volunteers', '[]'::jsonb,
      'status', 'Aguardando culto',
      'prepRequiredMinutes', stps.prep_required_minutes
    ) order by stps.display_order asc
  ), '[]'::jsonb)
  into v_parallel_services
  from app_private.service_template_parallel_services stps
  where stps.template_id = p_template_id and stps.is_default_active = true;

  return jsonb_build_object(
    'success', true,
    'template_id', v_st.id,
    'template_name', v_st.name,
    'event_type_id', v_st.event_type_id,
    'activities', v_activities,
    'parallelServices', v_parallel_services
  );
end;
$function$;

-- Privilégios e Ownership fiéis ao SQL 022
revoke all on function public.instantiate_service_template(uuid, uuid, uuid) from public, anon, service_role;
grant execute on function public.instantiate_service_template(uuid, uuid, uuid) to authenticated;
alter function public.instantiate_service_template(uuid, uuid, uuid) owner to postgres;

-- ------------------------------------------------------------------------------
-- ETAPA 3: VERIFICAÇÃO PÓS-APLICAÇÃO (024_verify.sql)
-- ------------------------------------------------------------------------------
do $verify$
declare
  v_proc regprocedure;
  v_func_def text;
  v_owner text;
  v_is_secdef boolean;
  v_config text[];
  v_has_access_check boolean;
  v_has_parallel_camel boolean;
  v_has_parallel_snake_key boolean;
  v_has_active_filter boolean;
  v_has_musics boolean;
  v_has_resp_member boolean;
  v_has_resp_team boolean;
  v_auth_has_exec boolean;
  v_anon_has_exec boolean;
  v_service_role_has_exec boolean;
  v_public_has_exec boolean;
begin
  -- 1. Conferir existência da RPC
  v_proc := to_regprocedure('public.instantiate_service_template(uuid, uuid, uuid)');
  if v_proc is null then
    raise exception 'VERIFY FALHOU: RPC public.instantiate_service_template(uuid, uuid, uuid) não encontrada.'
      using errcode = 'P0002';
  end if;

  -- 2. Metadados e código da função
  select
    pg_get_functiondef(v_proc),
    r.rolname,
    p.prosecdef,
    p.proconfig
  into
    v_func_def,
    v_owner,
    v_is_secdef,
    v_config
  from pg_catalog.pg_proc p
  join pg_catalog.pg_roles r on r.oid = p.proowner
  where p.oid = v_proc;

  -- 3. Validação de hardening (B4: proconfig is null / is not true)
  if v_is_secdef is not true then
    raise exception 'VERIFY FALHOU: RPC não está configurada como SECURITY DEFINER.'
      using errcode = 'P0003';
  end if;

  if v_config is null then
    raise exception 'VERIFY FALHOU: Configurações de segurança ausentes (proconfig é NULL).'
      using errcode = 'P0003';
  end if;

  if (v_config @> array['search_path=""'] or v_config @> array['search_path=']) is not true then
    raise exception 'VERIFY FALHOU: RPC não possui search_path vazio configurado.'
      using errcode = 'P0003';
  end if;

  if (v_config @> array['statement_timeout=5s']) is not true then
    raise exception 'VERIFY FALHOU: RPC não possui statement_timeout=5s configurado.'
      using errcode = 'P0003';
  end if;

  -- 4. Validação da verificação de autorização de vínculo
  v_has_access_check := (v_func_def like '%has_church_settings_access(p_church_id, false)%');
  if not v_has_access_check then
    raise exception 'VERIFY FALHOU: Chamada a has_church_settings_access(p_church_id, false) não encontrada no corpo da RPC.'
      using errcode = 'P0003';
  end if;

  -- 5. Validação precisa da preservação do contrato SQL 022 (B3: escape de _ e checagem integral)
  v_has_parallel_camel := (v_func_def like '%''parallelServices''%');
  v_has_parallel_snake_key := (v_func_def like '%''parallel\_services''%' escape '\');
  v_has_active_filter := (v_func_def like '%where stps.template\_id = p\_template\_id and stps.is\_default\_active = true%' escape '\');
  v_has_musics := (v_func_def like '%musics%');
  v_has_resp_member := (v_func_def like '%responsibleMemberId%');
  v_has_resp_team := (v_func_def like '%responsibleTeamId%');

  if not v_has_parallel_camel then
    raise exception 'VERIFY FALHOU: Chave JSON camelCase "parallelServices" ausente no retorno da RPC.'
      using errcode = 'P0003';
  end if;

  if v_has_parallel_snake_key then
    raise exception 'VERIFY FALHOU: Chave JSON snake_case "parallel_services" incorretamente detectada no retorno da RPC.'
      using errcode = 'P0003';
  end if;

  if not v_has_active_filter then
    raise exception 'VERIFY FALHOU: Filtro de apoios ativos "is_default_active = true" ausente ou modificado na RPC.'
      using errcode = 'P0003';
  end if;

  if (v_func_def like '%plannedDurationMinutes%') is not true then
    raise exception 'VERIFY FALHOU: Campo plannedDurationMinutes ausente ou renomeado no contrato da RPC.'
      using errcode = 'P0003';
  end if;

  if (v_func_def like '%roster%') is not true then
    raise exception 'VERIFY FALHOU: Campo roster ausente ou renomeado no contrato de atividades da RPC.'
      using errcode = 'P0003';
  end if;

  if not (v_has_musics and v_has_resp_member and v_has_resp_team) then
    raise exception 'VERIFY FALHOU: Campos contratuais de atividades (musics, responsibleMemberId, responsibleTeamId) incompletos.'
      using errcode = 'P0003';
  end if;

  if (v_func_def like '%leaderId%' and v_func_def like '%volunteers%') is not true then
    raise exception 'VERIFY FALHOU: Campos contratuais de serviços paralelos (leaderId, volunteers) incompletos.'
      using errcode = 'P0003';
  end if;

  -- 6. Validação de ownership
  if v_owner <> 'postgres' then
    raise exception 'VERIFY FALHOU: Owner da RPC é "%", esperava-se "postgres".', v_owner
      using errcode = 'P0003';
  end if;

  -- 7. Validação de privilégios
  v_auth_has_exec := has_function_privilege('authenticated', v_proc, 'EXECUTE');
  v_anon_has_exec := has_function_privilege('anon', v_proc, 'EXECUTE');
  v_service_role_has_exec := has_function_privilege('service_role', v_proc, 'EXECUTE');
  select exists (
    select 1 from lateral pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
    where a.grantee = 0 and a.privilege_type = 'EXECUTE'
  ) into v_public_has_exec
  from pg_catalog.pg_proc p where p.oid = v_proc;

  if not v_auth_has_exec then
    raise exception 'VERIFY FALHOU: Role authenticated não possui permissão de EXECUTE na RPC.'
      using errcode = '42501';
  end if;

  if v_anon_has_exec then
    raise exception 'VERIFY FALHOU: Role anon possui indevidamente permissão de EXECUTE na RPC.'
      using errcode = '42501';
  end if;

  if v_service_role_has_exec then
    raise exception 'VERIFY FALHOU: Role service_role possui indevidamente permissão de EXECUTE na RPC.'
      using errcode = '42501';
  end if;

  if v_public_has_exec then
    raise exception 'VERIFY FALHOU: Role public possui indevidamente permissão de EXECUTE na RPC.'
      using errcode = '42501';
  end if;

  raise notice '>> [2/4] Verificação contratual e de segurança aprovada.';
end $verify$;

-- ------------------------------------------------------------------------------
-- ETAPA 4: CASOS DE ENSAIO COMPORTAMENTAIS E DE AUTORIZAÇÃO (024_rehearsal_cases.sql)
-- ------------------------------------------------------------------------------
create or replace function pg_temp.st024_id(n integer) returns uuid language sql immutable as
$$ select ('02400000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid $$;

create or replace function pg_temp.st024_as(
  n integer,
  q text,
  expected text default '00000'
) returns jsonb
language plpgsql security invoker as $$
declare
  payload jsonb;
  v_code text := '00000';
  v_message text := 'OK';
begin
  if n is null then
    perform set_config('request.jwt.claim.sub', '', true);
  else
    perform set_config('request.jwt.claim.sub', pg_temp.st024_id(n)::text, true);
  end if;

  begin
    if n is null then
      set local role anon;
    else
      set local role authenticated;
    end if;

    execute q into payload;
    reset role;
  exception when others then
    get stacked diagnostics
      v_code = returned_sqlstate,
      v_message = message_text;
    reset role;
  end;

  -- Garante ausência de privilégios residuais e restauração de contexto
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);

  if expected = '00000' then
    if v_code <> '00000' then
      raise exception 'Esperado sucesso (00000), mas recebeu SQLSTATE %: %', v_code, v_message;
    end if;
    return payload;
  else
    if v_code = '00000' then
      raise exception 'Esperada rejeição %, mas execução obteve sucesso indevido', expected;
    end if;

    if v_code <> expected and not (string_to_array(expected, ',') @> array[v_code]) then
      raise exception 'Esperado SQLSTATE %, mas recebeu %: %', expected, v_code, v_message;
    end if;

    return jsonb_build_object('rejected', true, 'sqlstate', v_code, 'message', v_message);
  end if;
end $$;

-- Fixtures de teste (B1: DDL 022 completo com church_id em todas as tabelas filhas)
insert into auth.users(id, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select pg_temp.st024_id(n), 'st024_' || n || '@example.com', clock_timestamp(), '{"provider":"email"}'::jsonb,
  '{}'::jsonb, clock_timestamp(), clock_timestamp() from generate_series(1, 6) n
on conflict (id) do nothing;

insert into app_private.churches(id, name, timezone, default_duration_policy, status) values
  (pg_temp.st024_id(100), 'Igreja Central 024', 'America/Sao_Paulo', 'warn', 'active'),
  (pg_temp.st024_id(200), 'Igreja Bairro 024', 'America/Sao_Paulo', 'warn', 'active')
on conflict (id) do nothing;

insert into app_private.members(id, church_id, display_name, status, created_by_user_id) values
  (pg_temp.st024_id(11), pg_temp.st024_id(100), 'Admin Igreja 100', 'active', pg_temp.st024_id(1)),
  (pg_temp.st024_id(12), pg_temp.st024_id(100), 'Membro Igreja 100', 'active', pg_temp.st024_id(1)),
  (pg_temp.st024_id(13), pg_temp.st024_id(200), 'Admin Igreja 200', 'active', pg_temp.st024_id(3)),
  (pg_temp.st024_id(15), pg_temp.st024_id(100), 'Membro Revogado 100', 'active', pg_temp.st024_id(1)),
  (pg_temp.st024_id(16), pg_temp.st024_id(100), 'Líder Liturgia 100', 'active', pg_temp.st024_id(1))
on conflict (id) do nothing;

insert into app_private.church_access(
  church_id, user_id, member_id, is_admin, status,
  onboarding_completed_at, granted_by_user_id, granted_at,
  revoked_by_user_id, revoked_at
) values
  (pg_temp.st024_id(100), pg_temp.st024_id(1), pg_temp.st024_id(11), true, 'active', clock_timestamp(), pg_temp.st024_id(1), clock_timestamp(), null, null),
  (pg_temp.st024_id(100), pg_temp.st024_id(2), pg_temp.st024_id(12), false, 'active', clock_timestamp(), pg_temp.st024_id(1), clock_timestamp(), null, null),
  (pg_temp.st024_id(200), pg_temp.st024_id(3), pg_temp.st024_id(13), true, 'active', clock_timestamp(), pg_temp.st024_id(3), clock_timestamp(), null, null),
  (pg_temp.st024_id(100), pg_temp.st024_id(5), pg_temp.st024_id(15), false, 'revoked', null, pg_temp.st024_id(1), clock_timestamp() - interval '1 hour', pg_temp.st024_id(1), clock_timestamp()),
  (pg_temp.st024_id(100), pg_temp.st024_id(6), pg_temp.st024_id(16), false, 'active', clock_timestamp(), pg_temp.st024_id(1), clock_timestamp(), null, null)
on conflict (church_id, user_id) do nothing;

insert into app_private.event_types(id, church_id, name, active) values
  (pg_temp.st024_id(50), pg_temp.st024_id(100), 'Culto 024', true),
  (pg_temp.st024_id(60), pg_temp.st024_id(200), 'Culto Bairro 024', true)
on conflict (id) do nothing;

insert into app_private.service_templates(id, church_id, event_type_id, name, description, active) values
  (pg_temp.st024_id(70), pg_temp.st024_id(100), pg_temp.st024_id(50), 'Modelo Domingo 024', 'Descrição teste', true),
  (pg_temp.st024_id(79), pg_temp.st024_id(200), pg_temp.st024_id(60), 'Modelo Bairro 024', 'Descrição bairro', true)
on conflict (id) do nothing;

insert into app_private.service_template_activities(id, church_id, template_id, title, category, planned_duration_minutes, display_order, notes, requires_playback) values
  (pg_temp.st024_id(71), pg_temp.st024_id(100), pg_temp.st024_id(70), 'Abertura', 'Liturgia', 10, 1, 'Notas de abertura', false),
  (pg_temp.st024_id(72), pg_temp.st024_id(100), pg_temp.st024_id(70), 'Louvor', 'Louvor', 30, 2, 'Cânticos', true)
on conflict (id) do nothing;

insert into app_private.service_template_parallel_services(id, church_id, template_id, team_id, service_name, prep_required_minutes, is_default_active, display_order) values
  (pg_temp.st024_id(81), pg_temp.st024_id(100), pg_temp.st024_id(70), 'recepcao', 'Portaria', 15, true, 1),
  (pg_temp.st024_id(82), pg_temp.st024_id(100), pg_temp.st024_id(70), 'apoio', 'Apoio Especial', 10, false, 2)
on conflict (id) do nothing;

do $cases$
declare
  result jsonb;
  q text;
  v_count_tpl_before integer;
  v_count_act_before integer;
  v_count_par_before integer;
  v_count_tpl_after integer;
  v_count_act_after integer;
  v_count_par_after integer;
  v_hash_tpl_before text;
  v_hash_act_before text;
  v_hash_par_before text;
  v_hash_tpl_after text;
  v_hash_act_after text;
  v_hash_par_after text;
  v_act1 jsonb;
  v_act2 jsonb;
  v_par1 jsonb;
  v_normalized jsonb;
  v_expected jsonb;
begin
  -- Snapshot prévio de contagens e integridade de conteúdo para validar ausência de mutação persistente (B3 / B5 / CA03)
  select count(*) into v_count_tpl_before from app_private.service_templates;
  select count(*) into v_count_act_before from app_private.service_template_activities;
  select count(*) into v_count_par_before from app_private.service_template_parallel_services;

  select md5(coalesce(string_agg(t.*::text, ',' order by t.id), '')) into v_hash_tpl_before from app_private.service_templates t;
  select md5(coalesce(string_agg(a.*::text, ',' order by a.id), '')) into v_hash_act_before from app_private.service_template_activities a;
  select md5(coalesce(string_agg(p.*::text, ',' order by p.id), '')) into v_hash_par_before from app_private.service_template_parallel_services p;

  -- C01: Usuário anônimo
  q := format('select public.instantiate_service_template(%L, %L, %L)',
    pg_temp.st024_id(901), pg_temp.st024_id(100), pg_temp.st024_id(70));
  perform pg_temp.st024_as(null, q, '28000,42501');

  -- C02: Autenticado sem vínculo (Usuário 4)
  q := format('select public.instantiate_service_template(%L, %L, %L)',
    pg_temp.st024_id(902), pg_temp.st024_id(100), pg_temp.st024_id(70));
  perform pg_temp.st024_as(4, q, '42501');

  -- C03: Admin de outra igreja (Usuário 3 - Admin Igreja 200)
  q := format('select public.instantiate_service_template(%L, %L, %L)',
    pg_temp.st024_id(903), pg_temp.st024_id(100), pg_temp.st024_id(70));
  perform pg_temp.st024_as(3, q, '42501');

  -- C04: Vínculo revogado (Usuário 5)
  q := format('select public.instantiate_service_template(%L, %L, %L)',
    pg_temp.st024_id(904), pg_temp.st024_id(100), pg_temp.st024_id(70));
  perform pg_temp.st024_as(5, q, '42501');

  -- C05: Membro básico elegível (Usuário 2)
  q := format('select public.instantiate_service_template(%L, %L, %L)',
    pg_temp.st024_id(905), pg_temp.st024_id(100), pg_temp.st024_id(70));
  result := pg_temp.st024_as(2, q, '00000');
  if (result->>'success')::boolean is not true then
    raise exception 'C05 falhou: membro básico deve ter sucesso (200), recebido %', result;
  end if;

  -- C06: Líder não admin (Usuário 6)
  q := format('select public.instantiate_service_template(%L, %L, %L)',
    pg_temp.st024_id(906), pg_temp.st024_id(100), pg_temp.st024_id(70));
  result := pg_temp.st024_as(6, q, '00000');
  if (result->>'success')::boolean is not true then
    raise exception 'C06 falhou: líder não admin deve ter sucesso (200), recebido %', result;
  end if;

  -- C07: Admin autorizado (Usuário 1)
  q := format('select public.instantiate_service_template(%L, %L, %L)',
    pg_temp.st024_id(907), pg_temp.st024_id(100), pg_temp.st024_id(70));
  result := pg_temp.st024_as(1, q, '00000');
  if (result->>'success')::boolean is not true then
    raise exception 'C07 falhou: admin autorizado deve ter sucesso (200), recebido %', result;
  end if;

  -- C08: Igreja/modelo incompatíveis
  q := format('select public.instantiate_service_template(%L, %L, %L)',
    pg_temp.st024_id(908), pg_temp.st024_id(100), pg_temp.st024_id(79));
  perform pg_temp.st024_as(1, q, 'P0002');

  q := format('select public.instantiate_service_template(%L, %L, %L)',
    pg_temp.st024_id(909), pg_temp.st024_id(100), pg_temp.st024_id(999));
  perform pg_temp.st024_as(1, q, 'P0002');

  -- ==========================================================================
  -- C09: Verificação Integral e Comportamental do Contrato SQL 022
  -- ==========================================================================
  -- 1. Chaves de primeiro nível e integridade estrutural
  if not (result ? 'success' and result ? 'template_id' and result ? 'template_name'
          and result ? 'event_type_id' and result ? 'activities' and result ? 'parallelServices') then
    raise exception 'C09 falhou: chaves obrigatórias ausentes no objeto retornado: %', result;
  end if;

  if result ? 'parallel_services' then
    raise exception 'C09 falhou: chave snake_case "parallel_services" detectada indevidamente no retorno';
  end if;

  if (result - array['success', 'template_id', 'template_name', 'event_type_id', 'activities', 'parallelServices']) <> '{}'::jsonb then
    raise exception 'C09 falhou: chaves não previstas encontradas na raiz do JSON: %', result;
  end if;

  if jsonb_typeof(result->'success') is distinct from 'boolean' or (result->>'success')::boolean is distinct from true then
    raise exception 'C09 falhou: campo success deve ser true';
  end if;

  if jsonb_typeof(result->'template_id') is distinct from 'string' or (result->>'template_id')::uuid is distinct from pg_temp.st024_id(70) then
    raise exception 'C09 falhou: template_id diverge do esperado';
  end if;

  if jsonb_typeof(result->'template_name') is distinct from 'string' or (result->>'template_name') is distinct from 'Modelo Domingo 024' then
    raise exception 'C09 falhou: template_name diverge do esperado';
  end if;

  if jsonb_typeof(result->'event_type_id') is distinct from 'string' or (result->>'event_type_id')::uuid is distinct from pg_temp.st024_id(50) then
    raise exception 'C09 falhou: event_type_id diverge do esperado';
  end if;

  if jsonb_typeof(result->'activities') is distinct from 'array' then
    raise exception 'C09 falhou: campo activities deve ser um array JSON';
  end if;

  if jsonb_typeof(result->'parallelServices') is distinct from 'array' then
    raise exception 'C09 falhou: campo parallelServices deve ser um array JSON';
  end if;

  -- 2. Apoios padrão / Serviços Paralelos:
  -- - Chave camelCase 'parallelServices'
  -- - Exclusão estrita do serviço inativo (apenas 1 serviço deve vir no array)
  -- - Ausência de pessoas escaladas (leaderId null, volunteers vazio)
  -- - Formato de ID serv-<uuid>
  if jsonb_array_length(result->'parallelServices') <> 1 then
    raise exception 'C09 falhou: esperava exatamente 1 serviço paralelo ativo, vieram %',
      jsonb_array_length(result->'parallelServices');
  end if;

  v_par1 := result->'parallelServices'->0;
  if not (v_par1 ? 'id' and v_par1 ? 'name' and v_par1 ? 'teamId'
          and v_par1 ? 'leaderId' and v_par1 ? 'volunteers'
          and v_par1 ? 'status' and v_par1 ? 'prepRequiredMinutes') then
    raise exception 'C09 falhou: campos de serviço paralelo incompletos ou renomeados: %', v_par1;
  end if;

  if (v_par1 - array['id', 'name', 'teamId', 'leaderId', 'volunteers', 'status', 'prepRequiredMinutes']) <> '{}'::jsonb then
    raise exception 'C09 falhou: campos adicionais desconhecidos no serviço paralelo: %', v_par1;
  end if;

  -- Validação de ID do serviço (formato serv-<uuid>, resistente a NULL)
  if not (v_par1 ? 'id')
     or jsonb_typeof(v_par1->'id') is distinct from 'string'
     or (v_par1->>'id') is null
     or coalesce((v_par1->>'id') ~ '^serv-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', false) is not true then
    raise exception 'C09 falhou: formato de ID do serviço paralelo inválido: %', v_par1->'id';
  end if;

  if jsonb_typeof(v_par1->'name') is distinct from 'string' or (v_par1->>'name') is distinct from 'Portaria'
     or jsonb_typeof(v_par1->'teamId') is distinct from 'string' or (v_par1->>'teamId') is distinct from 'recepcao' then
    raise exception 'C09 falhou: serviço ativo incorreto no retorno: %', v_par1;
  end if;

  if jsonb_typeof(v_par1->'prepRequiredMinutes') is distinct from 'number'
     or (v_par1->>'prepRequiredMinutes')::integer is distinct from 15 then
    raise exception 'C09 falhou: prepRequiredMinutes incorreto: %', v_par1;
  end if;

  if jsonb_typeof(v_par1->'status') is distinct from 'string' or (v_par1->>'status') is distinct from 'Aguardando culto' then
    raise exception 'C09 falhou: status do apoio deve ser "Aguardando culto", veio %', v_par1->>'status';
  end if;

  if not (v_par1 ? 'leaderId')
     or jsonb_typeof(v_par1->'leaderId') is distinct from 'null'
     or (v_par1->>'leaderId') is not null then
    raise exception 'C09 falhou: leaderId deve ser null na instanciação (CA03)';
  end if;

  if not (v_par1 ? 'volunteers')
     or jsonb_typeof(v_par1->'volunteers') is distinct from 'array'
     or jsonb_array_length(v_par1->'volunteers') <> 0 then
    raise exception 'C09 falhou: volunteers deve vir como array vazio na instanciação (CA03)';
  end if;

  -- Confirmação expressa de exclusão de serviço inativo ('Apoio Especial')
  if exists (
    select 1 from jsonb_array_elements(result->'parallelServices') elem
    where elem->>'name' = 'Apoio Especial'
  ) then
    raise exception 'C09 falhou: serviço inativo "Apoio Especial" foi indevidamente incluído';
  end if;

  -- 3. Atividades do Modelo:
  -- - Quantidade esperada = 2
  -- - Ordenação preservada por display_order asc
  -- - plannedDurationMinutes presente e não renomeado
  -- - notes conferidas em cada atividade
  -- - IDs no formato act-<uuid> e distintos entre si
  -- - roster presente como array vazio e não removido
  -- - musics presente como array vazio
  -- - responsibleMemberId e responsibleTeamId nulos
  if jsonb_array_length(result->'activities') <> 2 then
    raise exception 'C09 falhou: esperava 2 atividades, vieram %', jsonb_array_length(result->'activities');
  end if;

  v_act1 := result->'activities'->0;
  v_act2 := result->'activities'->1;

  -- Atividade 1 (Abertura, display_order 1)
  if not (v_act1 ? 'id' and v_act1 ? 'title' and v_act1 ? 'category'
          and v_act1 ? 'plannedDurationMinutes' and v_act1 ? 'status'
          and v_act1 ? 'responsibleMemberId' and v_act1 ? 'responsibleTeamId'
          and v_act1 ? 'notes' and v_act1 ? 'requiresPlayback'
          and v_act1 ? 'musics' and v_act1 ? 'roster') then
    raise exception 'C09 falhou: campos obrigatórios ausentes na atividade 1: %', v_act1;
  end if;

  if (v_act1 - array['id', 'title', 'category', 'plannedDurationMinutes', 'status', 'responsibleMemberId', 'responsibleTeamId', 'notes', 'requiresPlayback', 'musics', 'roster']) <> '{}'::jsonb then
    raise exception 'C09 falhou: campos adicionais desconhecidos na atividade 1: %', v_act1;
  end if;

  if not (v_act1 ? 'id')
     or jsonb_typeof(v_act1->'id') is distinct from 'string'
     or (v_act1->>'id') is null
     or coalesce((v_act1->>'id') ~ '^act-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', false) is not true then
    raise exception 'C09 falhou: formato de ID da atividade 1 inválido: %', v_act1->'id';
  end if;

  if jsonb_typeof(v_act1->'title') is distinct from 'string' or (v_act1->>'title') is distinct from 'Abertura'
     or jsonb_typeof(v_act1->'category') is distinct from 'string' or (v_act1->>'category') is distinct from 'Liturgia' then
    raise exception 'C09 falhou: ordenação ou dados da atividade 1 incorretos: %', v_act1;
  end if;

  if not (v_act1 ? 'plannedDurationMinutes')
     or jsonb_typeof(v_act1->'plannedDurationMinutes') is distinct from 'number'
     or (v_act1->>'plannedDurationMinutes')::integer is distinct from 10 then
    raise exception 'C09 falhou: plannedDurationMinutes da atividade 1 incorreto: %', v_act1;
  end if;

  if jsonb_typeof(v_act1->'status') is distinct from 'string' or (v_act1->>'status') is distinct from 'pendente' then
    raise exception 'C09 falhou: status da atividade 1 deve ser "pendente"';
  end if;

  if not (v_act1 ? 'responsibleMemberId')
     or jsonb_typeof(v_act1->'responsibleMemberId') is distinct from 'null'
     or not (v_act1 ? 'responsibleTeamId')
     or jsonb_typeof(v_act1->'responsibleTeamId') is distinct from 'null'
     or (v_act1->>'responsibleMemberId') is not null
     or (v_act1->>'responsibleTeamId') is not null then
    raise exception 'C09 falhou: responsibleMemberId e responsibleTeamId devem ser null na atividade (CA03)';
  end if;

  if jsonb_typeof(v_act1->'notes') is distinct from 'string' or (v_act1->>'notes') is distinct from 'Notas de abertura' then
    raise exception 'C09 falhou: notes da atividade 1 incorreto, esperado "Notas de abertura", recebido %', v_act1->>'notes';
  end if;

  if not (v_act1 ? 'roster') or jsonb_typeof(v_act1->'roster') is distinct from 'array' or jsonb_array_length(v_act1->'roster') <> 0 then
    raise exception 'C09 falhou: campo roster ausente ou não vazio na atividade 1';
  end if;

  if not (v_act1 ? 'musics') or jsonb_typeof(v_act1->'musics') is distinct from 'array' or jsonb_array_length(v_act1->'musics') <> 0 then
    raise exception 'C09 falhou: campo musics ausente ou não vazio na atividade 1';
  end if;

  if not (v_act1 ? 'requiresPlayback')
     or jsonb_typeof(v_act1->'requiresPlayback') is distinct from 'boolean'
     or (v_act1->>'requiresPlayback')::boolean is distinct from false then
    raise exception 'C09 falhou: requiresPlayback da atividade 1 deve ser false';
  end if;

  -- Atividade 2 (Louvor, display_order 2)
  if not (v_act2 ? 'id' and v_act2 ? 'title' and v_act2 ? 'category'
          and v_act2 ? 'plannedDurationMinutes' and v_act2 ? 'status'
          and v_act2 ? 'responsibleMemberId' and v_act2 ? 'responsibleTeamId'
          and v_act2 ? 'notes' and v_act2 ? 'requiresPlayback'
          and v_act2 ? 'musics' and v_act2 ? 'roster') then
    raise exception 'C09 falhou: campos obrigatórios ausentes na atividade 2: %', v_act2;
  end if;

  if (v_act2 - array['id', 'title', 'category', 'plannedDurationMinutes', 'status', 'responsibleMemberId', 'responsibleTeamId', 'notes', 'requiresPlayback', 'musics', 'roster']) <> '{}'::jsonb then
    raise exception 'C09 falhou: campos adicionais desconhecidos na atividade 2: %', v_act2;
  end if;

  if not (v_act2 ? 'id')
     or jsonb_typeof(v_act2->'id') is distinct from 'string'
     or (v_act2->>'id') is null
     or coalesce((v_act2->>'id') ~ '^act-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', false) is not true then
    raise exception 'C09 falhou: formato de ID da atividade 2 inválido: %', v_act2->'id';
  end if;

  if (v_act1->>'id') is not distinct from (v_act2->>'id') then
    raise exception 'C09 falhou: IDs das atividades devem ser únicos e distintos';
  end if;

  if jsonb_typeof(v_act2->'title') is distinct from 'string' or (v_act2->>'title') is distinct from 'Louvor'
     or jsonb_typeof(v_act2->'category') is distinct from 'string' or (v_act2->>'category') is distinct from 'Louvor' then
    raise exception 'C09 falhou: ordenação ou dados da atividade 2 incorretos: %', v_act2;
  end if;

  if not (v_act2 ? 'plannedDurationMinutes')
     or jsonb_typeof(v_act2->'plannedDurationMinutes') is distinct from 'number'
     or (v_act2->>'plannedDurationMinutes')::integer is distinct from 30 then
    raise exception 'C09 falhou: plannedDurationMinutes da atividade 2 incorreto: %', v_act2;
  end if;

  if jsonb_typeof(v_act2->'status') is distinct from 'string' or (v_act2->>'status') is distinct from 'pendente' then
    raise exception 'C09 falhou: status da atividade 2 deve ser "pendente"';
  end if;

  if not (v_act2 ? 'responsibleMemberId')
     or jsonb_typeof(v_act2->'responsibleMemberId') is distinct from 'null'
     or not (v_act2 ? 'responsibleTeamId')
     or jsonb_typeof(v_act2->'responsibleTeamId') is distinct from 'null'
     or (v_act2->>'responsibleMemberId') is not null
     or (v_act2->>'responsibleTeamId') is not null then
    raise exception 'C09 falhou: responsibleMemberId e responsibleTeamId devem ser null na atividade (CA03)';
  end if;

  if jsonb_typeof(v_act2->'notes') is distinct from 'string' or (v_act2->>'notes') is distinct from 'Cânticos' then
    raise exception 'C09 falhou: notes da atividade 2 incorreto, esperado "Cânticos", recebido %', v_act2->>'notes';
  end if;

  if not (v_act2 ? 'requiresPlayback')
     or jsonb_typeof(v_act2->'requiresPlayback') is distinct from 'boolean'
     or (v_act2->>'requiresPlayback')::boolean is distinct from true then
    raise exception 'C09 falhou: requiresPlayback da atividade 2 deve ser true';
  end if;

  if not (v_act2 ? 'roster') or jsonb_typeof(v_act2->'roster') is distinct from 'array' or jsonb_array_length(v_act2->'roster') <> 0 then
    raise exception 'C09 falhou: campo roster ausente ou não vazio na atividade 2';
  end if;

  if not (v_act2 ? 'musics') or jsonb_typeof(v_act2->'musics') is distinct from 'array' or jsonb_array_length(v_act2->'musics') <> 0 then
    raise exception 'C09 falhou: campo musics ausente ou não vazio na atividade 2';
  end if;

  -- 4. Comparação exata dos objetos esperados em JSONB normalizando os IDs dinâmicos
  v_normalized := jsonb_set(
    jsonb_set(
      jsonb_set(result, '{parallelServices,0,id}', '"<serv-id-norm>"'::jsonb),
      '{activities,0,id}', '"<act-id-norm-1>"'::jsonb
    ),
    '{activities,1,id}', '"<act-id-norm-2>"'::jsonb
  );

  v_expected := jsonb_build_object(
    'success', true,
    'template_id', pg_temp.st024_id(70),
    'template_name', 'Modelo Domingo 024',
    'event_type_id', pg_temp.st024_id(50),
    'activities', jsonb_build_array(
      jsonb_build_object(
        'id', '<act-id-norm-1>',
        'title', 'Abertura',
        'category', 'Liturgia',
        'plannedDurationMinutes', 10,
        'status', 'pendente',
        'responsibleMemberId', null,
        'responsibleTeamId', null,
        'notes', 'Notas de abertura',
        'requiresPlayback', false,
        'musics', '[]'::jsonb,
        'roster', '[]'::jsonb
      ),
      jsonb_build_object(
        'id', '<act-id-norm-2>',
        'title', 'Louvor',
        'category', 'Louvor',
        'plannedDurationMinutes', 30,
        'status', 'pendente',
        'responsibleMemberId', null,
        'responsibleTeamId', null,
        'notes', 'Cânticos',
        'requiresPlayback', true,
        'musics', '[]'::jsonb,
        'roster', '[]'::jsonb
      )
    ),
    'parallelServices', jsonb_build_array(
      jsonb_build_object(
        'id', '<serv-id-norm>',
        'name', 'Portaria',
        'teamId', 'recepcao',
        'leaderId', null,
        'volunteers', '[]'::jsonb,
        'status', 'Aguardando culto',
        'prepRequiredMinutes', 15
      )
    )
  );

  if v_normalized is distinct from v_expected then
    raise exception 'C09 falhou: divergência na comparação estrutural e tipológica exata com o contrato canônico do SQL 022: %', v_normalized;
  end if;

  -- ==========================================================================
  -- Contraprovas Formais do Cenário C09 (Rejeição das 7 anomalias de contrato)
  -- ==========================================================================
  -- 1. Contraprova 1: ID de serviço igual a JSON null deve ser reprovado
  if coalesce(('{"id": null}'::jsonb->>'id') ~ '^serv-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', false) is not false
     or jsonb_typeof('{"id": null}'::jsonb->'id') is distinct from 'null' then
    raise exception 'Contraprova 1 falhou: validador permitiria ID de serviço igual a JSON null';
  end if;

  -- 2. Contraprova 2: ID de atividade ausente ou nulo deve ser reprovado
  if ('{}'::jsonb ? 'id')
     or coalesce(('{}'::jsonb->>'id') ~ '^act-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', false) is not false
     or coalesce(('{"id": null}'::jsonb->>'id') ~ '^act-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', false) is not false
     or jsonb_typeof('{"id": null}'::jsonb->'id') is distinct from 'null' then
    raise exception 'Contraprova 2 falhou: validador permitiria ID de atividade ausente ou nulo';
  end if;

  -- 3. Contraprova 3: responsibleMemberId ausente deve ser reprovado
  if ('{}'::jsonb ? 'responsibleMemberId')
     or jsonb_typeof('{}'::jsonb->'responsibleMemberId') is not null then
    raise exception 'Contraprova 3 falhou: validador permitiria responsibleMemberId ausente';
  end if;

  -- 4. Contraprova 4: responsibleTeamId ausente deve ser reprovado
  if ('{}'::jsonb ? 'responsibleTeamId')
     or jsonb_typeof('{}'::jsonb->'responsibleTeamId') is not null then
    raise exception 'Contraprova 4 falhou: validador permitiria responsibleTeamId ausente';
  end if;

  -- 5. Contraprova 5: prepRequiredMinutes como string deve ser reprovado
  if jsonb_typeof('{"prepRequiredMinutes": "15"}'::jsonb->'prepRequiredMinutes') is distinct from 'string'
     or '{"prepRequiredMinutes": "15"}'::jsonb = '{"prepRequiredMinutes": 15}'::jsonb then
    raise exception 'Contraprova 5 falhou: validador aceitaria prepRequiredMinutes como string';
  end if;

  -- 6. Contraprova 6: plannedDurationMinutes como string deve ser reprovado
  if jsonb_typeof('{"plannedDurationMinutes": "10"}'::jsonb->'plannedDurationMinutes') is distinct from 'string'
     or '{"plannedDurationMinutes": "10"}'::jsonb = '{"plannedDurationMinutes": 10}'::jsonb then
    raise exception 'Contraprova 6 falhou: validador aceitaria plannedDurationMinutes como string';
  end if;

  -- 7. Contraprova 7: requiresPlayback como string deve ser reprovado
  if jsonb_typeof('{"requiresPlayback": "false"}'::jsonb->'requiresPlayback') is distinct from 'string'
     or '{"requiresPlayback": "false"}'::jsonb = '{"requiresPlayback": false}'::jsonb then
    raise exception 'Contraprova 7 falhou: validador aceitaria requiresPlayback como string';
  end if;

  -- ==========================================================================
  -- C10: Ausência de Gravação Persistente e Integridade dos Dados
  -- A instanciação prepara cópia em memória (preview) e NÃO persiste nem altera itens no banco
  -- ==========================================================================
  select count(*) into v_count_tpl_after from app_private.service_templates;
  select count(*) into v_count_act_after from app_private.service_template_activities;
  select count(*) into v_count_par_after from app_private.service_template_parallel_services;

  select md5(coalesce(string_agg(t.*::text, ',' order by t.id), '')) into v_hash_tpl_after from app_private.service_templates t;
  select md5(coalesce(string_agg(a.*::text, ',' order by a.id), '')) into v_hash_act_after from app_private.service_template_activities a;
  select md5(coalesce(string_agg(p.*::text, ',' order by p.id), '')) into v_hash_par_after from app_private.service_template_parallel_services p;

  if v_count_tpl_before is distinct from v_count_tpl_after
     or v_count_act_before is distinct from v_count_act_after
     or v_count_par_before is distinct from v_count_par_after
     or v_hash_tpl_before is distinct from v_hash_tpl_after
     or v_hash_act_before is distinct from v_hash_act_after
     or v_hash_par_before is distinct from v_hash_par_after then
    raise exception 'C10 falhou: instanciação provocou alteração ou gravação persistente indevida nas tabelas';
  end if;

  raise notice '>> [3/4] Todos os 8 perfis de autorização e asserções contratuais C01 a C10 aprovados.';
end $cases$;

-- Limpeza de helpers temporários da sessão
drop function if exists pg_temp.st024_as(integer, text, text);
drop function if exists pg_temp.st024_id(integer);

-- ------------------------------------------------------------------------------
-- ETAPA 5: REVERSÃO TOTAL E INCONDICIONAL DO ENSAIO (ROLLBACK)
-- ------------------------------------------------------------------------------
rollback;

-- Confirmação final da reversão
select 'ENSAIO 024 CONCLUÍDO COM 100% DE SUCESSO E REVERTIDO (ROLLBACK EFETUADO).' as status;
