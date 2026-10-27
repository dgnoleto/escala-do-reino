-- ==============================================================================
-- 023_independent_inspection.sql
-- Auditoria Independente Pós-Ensaio em Conexão Separada (psql -X)
-- Alvo: escala_rehearsal_024
-- ==============================================================================

\set ON_ERROR_STOP on
\set VERBOSITY verbose

-- 1. Guarda de Identidade do Alvo
do $target_guard$
declare
  v_db_oid oid;
  v_sys_id text;
begin
  if current_database() <> 'escala_rehearsal_024' then
    raise exception 'INSPEÇÃO INTERROMPIDA: Banco conectado "%" diverge de escala_rehearsal_024.',
      current_database() using errcode = 'P0002';
  end if;

  select d.oid into v_db_oid from pg_database d where d.datname = current_database();
  if v_db_oid is distinct from 198690::oid then
    raise exception 'INSPEÇÃO INTERROMPIDA: OID do banco diverge (esperado 198690, obtido %).',
      v_db_oid using errcode = 'P0002';
  end if;

  select c.system_identifier::text into v_sys_id from pg_control_system() c;
  if v_sys_id is distinct from '7695064938894594085' then
    raise exception 'INSPEÇÃO INTERROMPIDA: system_identifier diverge do esperado.' using errcode = 'P0002';
  end if;
end;
$target_guard$;

-- 2. Inspeção Fail-Closed no Catálogo e Preservação de Objetos
do $independent_audit$
declare
  v_residual_funcs text[];
  v_residual_cols text[];
  v_fixture_count integer;
  v_instantiate_valid boolean;
begin
  -- Configura search_path vazio de forma limpa e segura
  execute 'set local search_path = ''''';

  -- A. Assegurar que nenhuma das 5 RPCs dos candidatos permaneceu instalada
  select coalesce(array_agg(p.proname::text), array[]::text[]) into v_residual_funcs
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (
      'create_church_event_edition',
      'reorder_event_items',
      'set_event_duration_policy',
      'publish_event_program',
      'save_event_program_draft'
    );

  if cardinality(v_residual_funcs) is distinct from 0 then
    raise exception 'FALHA DE ISOLAMENTO: RPCs residuais encontradas no catálogo public: %',
      v_residual_funcs using errcode = 'P0001';
  end if;

  -- B. Assegurar que a tabela de recibos não foi persistida
  if pg_catalog.to_regclass('app_private.event_planning_receipts') is not null then
    raise exception 'FALHA DE ISOLAMENTO: Tabela app_private.event_planning_receipts persistiu pós-rollback.'
      using errcode = 'P0001';
  end if;

  -- C. Assegurar que as 5 colunas de planejamento não foram persistidas em events
  select coalesce(array_agg(a.attname::text), array[]::text[]) into v_residual_cols
  from pg_catalog.pg_attribute a
  join pg_catalog.pg_class c on c.oid = a.attrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'app_private'
    and c.relname = 'events'
    and a.attnum > 0
    and not a.attisdropped
    and a.attname in (
      'duration_policy',
      'program_status',
      'program_version',
      'published_at',
      'published_by_member_id'
    );

  if cardinality(v_residual_cols) is distinct from 0 then
    raise exception 'FALHA DE ISOLAMENTO: Colunas de planejamento residuais em events: %',
      v_residual_cols using errcode = 'P0001';
  end if;

  -- D. Assegurar que fixtures e dados fictícios do ensaio não vazaram
  select count(*) into v_fixture_count
  from (
    select 1 from auth.users where id in (
      'a0000000-0000-0000-0000-000000000001'::uuid,
      'a0000000-0000-0000-0000-000000000002'::uuid,
      'a0000000-0000-0000-0000-000000000003'::uuid,
      'a0000000-0000-0000-0000-000000000004'::uuid
    )
    union all
    select 1 from app_private.churches where id = 'c0000000-0000-0000-0000-000000000001'::uuid
    union all
    select 1 from app_private.members where id in (
      'b0000000-0000-0000-0000-000000000001'::uuid,
      'b0000000-0000-0000-0000-000000000002'::uuid,
      'b0000000-0000-0000-0000-000000000003'::uuid,
      'b0000000-0000-0000-0000-000000000004'::uuid
    )
    union all
    select 1 from app_private.teams where id = 'd0000000-0000-0000-0000-000000000001'::uuid
    union all
    select 1 from app_private.event_items where id in (
      'e0000000-0000-0000-0000-000000000001'::uuid,
      'e0000000-0000-0000-0000-000000000002'::uuid
    )
  ) f;

  if v_fixture_count is distinct from 0 then
    raise exception 'FALHA DE ISOLAMENTO: Detectadas % fixtures residuais persistidas.',
      v_fixture_count using errcode = 'P0001';
  end if;

  -- E. Confronto Estrito de instantiate_service_template com a Referência Aprovada
  select (
    p.oid = 200297
    and p.proowner::regrole::text = 'postgres'
    and md5(pg_get_functiondef(p.oid)) = '913c68a50c7035aef49c33f70a0b0177'
    and p.proconfig = array['search_path=""', 'statement_timeout=5s']
  ) into v_instantiate_valid
  from pg_proc p
  where p.oid = 'public.instantiate_service_template(uuid,uuid,uuid)'::regprocedure;

  if v_instantiate_valid is not true then
    raise exception 'INSPEÇÃO FALHOU: Função pública instantiate_service_template diverge da referência aprovada.'
      using errcode = 'P0001';
  end if;

  -- Emissão obrigatória do marcador de auditoria independente
  raise notice 'INDEPENDENT_INSPECTION_OK';
end;
$independent_audit$;
