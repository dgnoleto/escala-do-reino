-- ==============================================================================
-- 026_rehearsal_cases.sql
-- Roteiro de Ensaios Transacionais e Protocolos de Validação: B2 v1.0
-- Issues #29 e #30 (Programação de Eventos, Edição, Remoção e Governança)
--
-- ESTRUTURA METODOLÓGICA DESTE ROTEIRO:
-- PARTE I   - Procedimento Documental de Contraprova do Preflight (fail-closed)
-- PARTE II  - Bateria Automatizada de Sessão Única sob ROLLBACK (Statements Distintos)
-- PARTE III - Protocolo Explícito Multissessão (Sessão A / Sessão B passo a passo)
-- PARTE IV  - Procedimento Operacional de Ensaio de Rollback (026_rollback.sql)
-- PARTE V   - Procedimento Metodológico de Verificação de Delta Zero (F10)
-- PARTE VI  - Procedimento de Conferência do Catálogo com 026_verify.sql
--
-- NOTA DE TRANSPARÊNCIA CONTRATUAL:
-- A Parte II contém asserções executadas em sessão única sob transação descartada
-- (ROLLBACK), estruturada em statements distintos com espera temporal determinística
-- para comprovar avanço estrito de statement_timestamp() entre mutações (F8).
-- O Caso 8 preserva variáveis desacopladas garantindo replay de parâmetros estritamente
-- idênticos pós-exclusão do item (F1).
-- ==============================================================================

\set ON_ERROR_STOP on

-- ==============================================================================
-- DRIVER DE ENSAIO (B5). Execução obrigatória do fluxo COMPLETO, a partir da raiz do repositório:
--   psql -v ON_ERROR_STOP=1 -v b2_rehearsal_confirm=full -d escala_rehearsal_<nome> -f docs/sql/026_rehearsal_cases.sql
-- Os caminhos \i são relativos ao diretório de execução (raiz do repositório). Não há execução parcial:
-- sem a variável b2_rehearsal_confirm o arquivo recusa; fora de banco escala_rehearsal_* também recusa.
-- Fases: F0 (M0, instalador, verificador, M1) -> Parte II sob ROLLBACK (M2, M3) -> F2 (rollback, M4,
-- reinstalação, M5, rollback, M6) -> comparador final, que só roda depois de M0..M6 existirem.
-- ==============================================================================
\if :{?b2_rehearsal_confirm}
  select :'b2_rehearsal_confirm' = 'full' as b2_confirm_ok \gset
  \if :b2_confirm_ok
  \else
    \echo 'RECUSADO: b2_rehearsal_confirm deve ser exatamente full.'
    do $b2_refuse$ begin raise exception 'B5 RECUSADO: b2_rehearsal_confirm deve ser exatamente full.'; end $b2_refuse$;
  \endif
\else
  \echo 'RECUSADO: informe -v b2_rehearsal_confirm=full.'
  do $b2_refuse$ begin raise exception 'B5 RECUSADO: informe -v b2_rehearsal_confirm=full.'; end $b2_refuse$;
\endif
select left(
  current_database(),
  length('escala_rehearsal_')
) = 'escala_rehearsal_' as b2_db_ok \gset
\if :b2_db_ok
\else
  do $b2_wrong_database$
  begin
    raise exception 'RECUSADO: o ensaio 026 só pode executar em banco descartável escala_rehearsal_*.';
  end;
  $b2_wrong_database$;
\endif

-- ==============================================================================
-- PARTE I — PROCEDIMENTO DOCUMENTAL DE CONTRAPROVA DO PREFLIGHT
-- ==============================================================================
/*
Instruções para o operador/revisor validar o comportamento fail-closed de 026_event_program_editing.sql:
1. Em banco de ensaio no baseline do SQL 025:
2. Altere propositalmente o tipo ou remova temporariamente uma das colunas obrigatórias
   do baseline (ex.: alter table app_private.event_items drop column sequence_order cascade;).
3. Execute:
   psql -v ON_ERROR_STOP=1 -f docs/sql/026_event_program_editing.sql
4. Comprove que a execução é imediatamente abortada com código de erro e mensagem descritiva
   'PREFLIGHT FALHOU: ...' antes de qualquer DDL (sem adicionar prep_required_minutes e sem criar RPCs).
5. Restaure o esquema original antes de prosseguir com os ensaios normais.
*/

-- ==============================================================================
-- PARTE II — BATERIA AUTOMATIZADA EM SESSÃO ÚNICA SOB ROLLBACK
-- ==============================================================================
-- ==============================================================================
-- DEFINIÇÕES DO DELTA ZERO (G8), FORA DA TRANSAÇÃO DAS FIXTURES
-- Criadas antes do BEGIN da Parte II para sobreviver ao ROLLBACK dela.
-- Requer psql. Todas as etapas devem ocorrer NA MESMA SESSÃO psql (pg_temp é por sessão).
-- ==============================================================================
create table if not exists pg_temp.b2_snapshots (
  label text primary key,
  captured_at timestamptz not null,
  snapshot jsonb,
  sha256 text not null
);

-- Representação canônica (jsonb) do catálogo e dos dados monitorados. Não contém data/rótulo.
-- Ordenação: por nome/attnum/chave de catálogo; dados por texto canônico da linha inteira (total e independente da ordem física).
create or replace function pg_temp.b2_snapshot()
returns jsonb
language sql
stable
as $snap$
select jsonb_build_object(
  'columns', (
    select coalesce(jsonb_agg(c.x order by c.k), '[]'::jsonb)
    from (
      select jsonb_build_object(
               'table', v.relname, 'ordinal_position', v.ordinal_position, 'name', v.attname,
               'type', format_type(v.atttypid, v.atttypmod), 'notnull', v.attnotnull,
               'default', regexp_replace(coalesce(pg_get_expr(d.adbin, d.adrelid), ''), '\s+', ' ', 'g'),
               'identity', v.attidentity::text, 'generated', v.attgenerated::text) as x,
             v.relname || '/' || lpad(v.ordinal_position::text, 4, '0') as k
      from (
        select cl.relname, a.attrelid, a.attnum, a.attname, a.atttypid, a.atttypmod,
               a.attnotnull, a.attidentity, a.attgenerated,
               row_number() over (partition by a.attrelid order by a.attnum) as ordinal_position
        from pg_attribute a
        join pg_class cl on cl.oid = a.attrelid
        join pg_namespace n on n.oid = cl.relnamespace
        where n.nspname = 'app_private'
          and cl.relname in ('events', 'event_items', 'assignments', 'event_planning_receipts')
          and a.attnum > 0 and not a.attisdropped
      ) v
      left join pg_attrdef d on d.adrelid = v.attrelid and d.adnum = v.attnum
    ) c
  ),
  'constraints', (
    select coalesce(jsonb_agg(k.x order by k.k), '[]'::jsonb)
    from (
      select jsonb_build_object(
               'name', x.conname, 'table', n.nspname || '.' || c.relname, 'contype', x.contype::text,
               'def', regexp_replace(pg_get_constraintdef(x.oid), '\s+', ' ', 'g'),
               'valid', x.convalidated, 'deferrable', x.condeferrable, 'deferred', x.condeferred,
               'upd', case when x.contype = 'f' then x.confupdtype::text else '' end,
               'del', case when x.contype = 'f' then x.confdeltype::text else '' end,
               'match', case when x.contype = 'f' then x.confmatchtype::text else '' end) as x,
             n.nspname || '.' || c.relname || '/' || x.conname as k
      from pg_constraint x
      join pg_class c on c.oid = x.conrelid
      join pg_namespace n on n.oid = c.relnamespace
      where x.conrelid in ('app_private.events'::regclass, 'app_private.event_items'::regclass,
                           'app_private.assignments'::regclass, 'app_private.event_planning_receipts'::regclass)
        and x.contype <> 'n'
    ) k
  ),
  'indexes', (
    select coalesce(jsonb_agg(i.x order by i.k), '[]'::jsonb)
    from (
      select jsonb_build_object(
               'index', ic.relname, 'def', regexp_replace(pg_get_indexdef(x.indexrelid), '\s+', ' ', 'g'),
               'valid', x.indisvalid, 'ready', x.indisready, 'live', x.indislive) as x,
             ic.relname::text as k
      from pg_index x
      join pg_class ic on ic.oid = x.indexrelid
      where x.indrelid in ('app_private.events'::regclass, 'app_private.event_items'::regclass,
                           'app_private.assignments'::regclass, 'app_private.event_planning_receipts'::regclass)
    ) i
  ),
  'triggers', (
    select coalesce(jsonb_agg(t.x order by t.k), '[]'::jsonb)
    from (
      select jsonb_build_object(
               'name', tg.tgname::text, 'table', n.nspname || '.' || c.relname,
               'enabled', tg.tgenabled::text,
               'def', regexp_replace(pg_get_triggerdef(tg.oid), '\s+', ' ', 'g')) as x,
             n.nspname || '.' || c.relname || '/' || tg.tgname::text as k
      from pg_trigger tg
      join pg_class c on c.oid = tg.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      where not tg.tgisinternal
        and tg.tgrelid in ('app_private.events'::regclass, 'app_private.event_items'::regclass,
                           'app_private.assignments'::regclass, 'app_private.event_planning_receipts'::regclass)
    ) t
  ),
  'functions', (
    select coalesce(jsonb_agg(f.x order by f.k), '[]'::jsonb)
    from (
      select jsonb_build_object(
               'identity', p.oid::regprocedure::text,
               'arguments', pg_get_function_arguments(p.oid),
               'result', pg_get_function_result(p.oid),
               'retset', p.proretset, 'language', l.lanname::text, 'volatility', p.provolatile::text,
               'kind', p.prokind::text, 'secdef', p.prosecdef, 'config', coalesce((select jsonb_agg(c.v order by c.v collate "C") from unnest(coalesce(p.proconfig, '{}'::text[])) as c(v)), '[]'::jsonb),
               'owner', own.rolname::text,
               'acl', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'grantee', coalesce(ge.rolname::text, 'PUBLIC'),
                          'grantor', gr.rolname::text,
                          'privilege', ae.privilege_type, 'grantable', ae.is_grantable)
                        order by coalesce(ge.rolname::text, 'PUBLIC'), gr.rolname::text, ae.privilege_type, ae.is_grantable)
                 from aclexplode(coalesce(p.proacl, '{}'::aclitem[])) ae
                 left join pg_roles ge on ge.oid = ae.grantee
                 left join pg_roles gr on gr.oid = ae.grantor
               ), '[]'::jsonb),
               'fingerprint', encode(pg_catalog.sha256(convert_to(btrim(replace(p.prosrc, E'\r\n', E'\n'), E' \t\r\n'), 'UTF8')), 'hex')) as x,
             p.oid::regprocedure::text as k
      from pg_proc p
      join pg_language l on l.oid = p.prolang
      join pg_roles own on own.oid = p.proowner
      where p.pronamespace = 'public'::regnamespace
        and p.proname in ('create_church_event_edition', 'create_event_item', 'list_church_events',
                          'reorder_event_items', 'set_event_duration_policy', 'publish_event_program',
                          'save_event_program_draft', 'get_event_program', 'update_event_item',
                          'remove_event_item', 'assign_event_liturgy_leader')
    ) f
  ),
  'data', jsonb_build_object(
    'events', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from app_private.events t),
    'event_items', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from app_private.event_items t),
    'assignments', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from app_private.assignments t),
    'event_planning_receipts', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from app_private.event_planning_receipts t),
    'command_receipts', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from app_private.command_receipts t),
    'audit_entries', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from app_private.audit_entries t)
  )
);
$snap$;

-- Captura de um momento (M0, M1, M4, M5, M6 e M3): grava rótulo, data (metadado fora do conteúdo) e SHA-256 canônico.
create or replace function pg_temp.b2_capture(p_label text)
returns void
language sql
as $cap$
insert into pg_temp.b2_snapshots (label, captured_at, snapshot, sha256)
select p_label, clock_timestamp(), s, encode(pg_catalog.sha256(convert_to(s::text, 'UTF8')), 'hex')
from (select pg_temp.b2_snapshot() as s) x;
$cap$;


-- FASE 0 (driver): M0 antes da instalação; instalador 026; verificador; M1 depois da instalação.
select pg_temp.b2_capture('M0');
\i docs/sql/026_event_program_editing.sql
\i docs/sql/026_verify.sql
select pg_temp.b2_capture('M1');

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- ------------------------------------------------------------------------------
-- FIXTURES TEMPORÁRIAS E TABELA DE ESTADO INTERMEDIÁRIO ENTRE STATEMENTS (F1, F8)
-- ------------------------------------------------------------------------------
create table pg_temp.b2_state (
  k text primary key,
  v_uuid uuid,
  v_time timestamptz,
  v_json jsonb
);

create function pg_temp.b2_id(n integer) returns uuid language sql immutable as
$$ select ('02600000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid $$;

create function pg_temp.b2_as(n integer, q text, expected text default '00000') returns jsonb
language plpgsql security invoker as $$
declare
  payload jsonb;
  code text := '00000';
  message text;
  ctx text;
begin
  perform set_config('request.jwt.claim.sub', coalesce(pg_temp.b2_id(n)::text, ''), true);
  begin
    set local role authenticated;
    execute q into payload;
    reset role;
  exception when others then
    get stacked diagnostics code = returned_sqlstate, message = message_text, ctx = pg_exception_context;
    reset role;
  end;
  if code <> expected then
    raise exception 'Ensaio falhou! Esperado código %, recebido %: % (context: %)', expected, code, message, ctx;
  end if;
  return payload;
end $$;

-- Usuários Auth
insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data) values
  (pg_temp.b2_id(1), 'admin@igreja.com', clock_timestamp(), '{"provider":"email"}'::jsonb),
  (pg_temp.b2_id(2), 'liturgia@igreja.com', clock_timestamp(), '{"provider":"email"}'::jsonb),
  (pg_temp.b2_id(3), 'membro@igreja.com', clock_timestamp(), '{"provider":"email"}'::jsonb),
  (pg_temp.b2_id(4), 'lider_equipe@igreja.com', clock_timestamp(), '{"provider":"email"}'::jsonb),
  (pg_temp.b2_id(99), 'externo@outra.com', clock_timestamp(), '{"provider":"email"}'::jsonb)
on conflict do nothing;

-- Igrejas
insert into app_private.churches (id, name, timezone, default_duration_policy, status) values
  (pg_temp.b2_id(10), 'Igreja Central 026', 'America/Sao_Paulo', 'warn', 'active'),
  (pg_temp.b2_id(20), 'Outra Igreja 026', 'America/Manaus', 'warn', 'active')
on conflict do nothing;

-- Membros
insert into app_private.members (id, church_id, display_name, created_by_user_id, status) values
  (pg_temp.b2_id(1), pg_temp.b2_id(10), 'Pastor Marcos Admin', pg_temp.b2_id(1), 'active'),
  (pg_temp.b2_id(2), pg_temp.b2_id(10), 'Carlos Dirigente Liturgia', pg_temp.b2_id(1), 'active'),
  (pg_temp.b2_id(3), pg_temp.b2_id(10), 'Membro Voluntário', pg_temp.b2_id(1), 'active'),
  (pg_temp.b2_id(4), pg_temp.b2_id(10), 'Líder de Louvor', pg_temp.b2_id(1), 'active'),
  (pg_temp.b2_id(99), pg_temp.b2_id(20), 'Pastor Outra Igreja', pg_temp.b2_id(99), 'active')
on conflict do nothing;

-- Equipes
insert into app_private.teams (id, church_id, name, leader_member_id, status) values
  (pg_temp.b2_id(40), pg_temp.b2_id(10), 'Equipe de Louvor', pg_temp.b2_id(4), 'active'),
  (pg_temp.b2_id(41), pg_temp.b2_id(10), 'Equipe de Transmissão', pg_temp.b2_id(3), 'active')
on conflict do nothing;

-- Acessos
insert into app_private.church_access (church_id, user_id, member_id, is_admin, status, granted_by_user_id, onboarding_completed_at) values
  (pg_temp.b2_id(10), pg_temp.b2_id(1), pg_temp.b2_id(1), true, 'active', pg_temp.b2_id(1), clock_timestamp()),
  (pg_temp.b2_id(10), pg_temp.b2_id(2), pg_temp.b2_id(2), false, 'active', pg_temp.b2_id(1), clock_timestamp()),
  (pg_temp.b2_id(10), pg_temp.b2_id(3), pg_temp.b2_id(3), false, 'active', pg_temp.b2_id(1), clock_timestamp()),
  (pg_temp.b2_id(10), pg_temp.b2_id(4), pg_temp.b2_id(4), false, 'active', pg_temp.b2_id(1), clock_timestamp()),
  (pg_temp.b2_id(20), pg_temp.b2_id(99), pg_temp.b2_id(99), true, 'active', pg_temp.b2_id(99), clock_timestamp())
on conflict do nothing;

-- ------------------------------------------------------------------------------
-- STATEMENT 1: CASOS 1 A 6 (CRIAÇÃO, ITENS, LEITURA E LISTAGEM)
-- ------------------------------------------------------------------------------
do $stmt1$
declare
  res jsonb;
  res_prog jsonb;
  v_evt_id uuid;
  v_item1_id uuid;
  v_item2_id uuid;
  v_item3_id uuid;
  v_item4_id uuid;
  v_cmd_id uuid;
  v_token_init timestamptz;
begin
  -- CASO 1: Criação de Evento Alvo
  res := pg_temp.b2_as(1, format(
    'select to_jsonb(r) from public.create_church_event_edition(%L, %L, %L, %L, %L, %L, %L, %L) r',
    pg_temp.b2_id(10), gen_random_uuid(), 'Culto da Família B2', 'Celebração',
    '2026-11-22 18:00:00-03', '2026-11-22 20:00:00-03', pg_temp.b2_id(2), 'warn'
  ));
  v_evt_id := (res->'result_payload'->>'event_id')::uuid;
  if v_evt_id is null then raise exception 'Caso 1 falhou: evento não criado.'; end if;

  -- CASO 2: Compatibilidade da Criação Legada (9 parâmetros, default prep=0)
  v_cmd_id := gen_random_uuid();
  res := pg_temp.b2_as(1, format(
    'select to_jsonb(r) from public.create_event_item(%L, %L, %L, %L, %L, 1, 900, %L, %L) r',
    pg_temp.b2_id(10), v_cmd_id, v_evt_id, 'Abertura e Boas-Vindas', 'liturgical',
    pg_temp.b2_id(40), pg_temp.b2_id(4)
  ));
  v_item1_id := (res->>'result_entity_id')::uuid;
  if v_item1_id is null or (res->'result_payload'->>'prep_required_minutes')::integer is distinct from 0 then
    raise exception 'Caso 2 falhou: chamada legada com 9 parâmetros não preservou prep=0.';
  end if;

  -- CASO 3: Validação Estrita de Preparação (Faixa 0..180 e Natureza Litúrgica)
  perform pg_temp.b2_as(1, format(
    'select to_jsonb(r) from public.create_event_item(%L, %L, %L, %L, %L, 2, 600, null, null, 15) r',
    pg_temp.b2_id(10), gen_random_uuid(), v_evt_id, 'Oração Inicial', 'liturgical'
  ), '22000');

  perform pg_temp.b2_as(1, format(
    'select to_jsonb(r) from public.create_event_item(%L, %L, %L, %L, %L, 1, 600, null, null, 200) r',
    pg_temp.b2_id(10), gen_random_uuid(), v_evt_id, 'Transmissão Ao Vivo', 'parallel_support'
  ), '22000');

  res := pg_temp.b2_as(1, format(
    'select to_jsonb(r) from public.create_event_item(%L, %L, %L, %L, %L, 1, 7200, %L, %L, 30) r',
    pg_temp.b2_id(10), gen_random_uuid(), v_evt_id, 'Operação de Transmissão', 'parallel_support',
    pg_temp.b2_id(41), pg_temp.b2_id(3)
  ));
  v_item2_id := (res->>'result_entity_id')::uuid;
  if v_item2_id is null then
    raise exception 'Caso 3 falhou: criação do item paralelo não retornou result_entity_id.';
  end if;

  -- CASO 4: Deslocamento Sequencial Automático na Criação
  res := pg_temp.b2_as(2, format(
    'select to_jsonb(r) from public.create_event_item(%L, %L, %L, %L, %L, 2, 1800, null, null, 0) r',
    pg_temp.b2_id(10), gen_random_uuid(), v_evt_id, 'Mensagem Pastoral', 'liturgical'
  ));
  v_item3_id := (res->>'result_entity_id')::uuid;
  if v_item3_id is null then
    raise exception 'Caso 4 falhou: criação de v_item3_id não retornou result_entity_id.';
  end if;

  res := pg_temp.b2_as(2, format(
    'select to_jsonb(r) from public.create_event_item(%L, %L, %L, %L, %L, 1, 1200, null, null, 0) r',
    pg_temp.b2_id(10), gen_random_uuid(), v_evt_id, 'Louvor Congregacional', 'liturgical'
  ));
  v_item4_id := (res->>'result_entity_id')::uuid;
  if v_item4_id is null then
    raise exception 'Caso 4 falhou: criação de v_item4_id não retornou result_entity_id.';
  end if;

  if (select sequence_order from app_private.event_items where id = v_item4_id) is distinct from 1
     or (select sequence_order from app_private.event_items where id = v_item1_id) is distinct from 2
     or (select sequence_order from app_private.event_items where id = v_item3_id) is distinct from 3 then
    raise exception 'Caso 4 falhou: deslocamento sequencial de itens não ocorreu como esperado.';
  end if;

  -- CASO 5: Leitura Completa e Isolamento Multi-Tenant (public.get_event_program)
  res_prog := pg_temp.b2_as(2, format(
    'select to_jsonb(r) from public.get_event_program(%L, %L) r',
    pg_temp.b2_id(10), v_evt_id
  ));
  if res_prog->'event'->>'program_status' is distinct from 'draft'
     or jsonb_array_length(res_prog->'items') is distinct from 4 then
    raise exception 'Caso 5 falhou: get_event_program não retornou os 4 itens esperados.';
  end if;

  perform pg_temp.b2_as(3, format(
    'select to_jsonb(r) from public.get_event_program(%L, %L) r',
    pg_temp.b2_id(10), v_evt_id
  ), '42501');

  perform pg_temp.b2_as(99, format(
    'select to_jsonb(r) from public.get_event_program(%L, %L) r',
    pg_temp.b2_id(20), v_evt_id
  ), 'P0002');

  -- CASO 6: Listagem com 5 Novas Chaves e Paginação Total (public.list_church_events)
  res := pg_temp.b2_as(1, format(
    'select to_jsonb(r) from public.list_church_events(%L, %L, 10, 0) r',
    pg_temp.b2_id(10), 'scheduled'
  ));
  if (
    (res->'events'->0 ? 'program_status')
    and (res->'events'->0 ? 'duration_policy')
    and (res->'events'->0 ? 'program_version')
    and (res->'events'->0 ? 'published_at')
    and (res->'events'->0 ? 'items_count')
  ) is not true then
    raise exception 'Caso 6 falhou: list_church_events não incluiu as 5 novas chaves.';
  end if;

  -- Captura do token inicial T0 de v_item4_id para o Caso 7
  select updated_at into v_token_init from app_private.event_items where id = v_item4_id;
  if v_token_init is null then
    raise exception 'Caso 7 falhou: token inicial T0 não foi capturado.';
  end if;

  -- Persistência de estado na tabela temporária
  insert into pg_temp.b2_state (k, v_uuid, v_time) values
    ('evt_id', v_evt_id, null),
    ('item1_id', v_item1_id, null),
    ('item2_id', v_item2_id, null),
    ('item3_id', v_item3_id, null),
    ('item4_id', v_item4_id, null),
    ('token_init', null, v_token_init);
end;
$stmt1$;

-- ------------------------------------------------------------------------------
-- STATEMENT 1.5: ESPERA TEMPORAL CONTROLADA PARA SEPARAÇÃO ESTRETA DE TIMESTAMP (F8)
-- ------------------------------------------------------------------------------
select pg_catalog.pg_sleep(0.01);

-- ------------------------------------------------------------------------------
-- STATEMENT 2: CASO 7.1 E 7.2 (PRIMEIRA ATUALIZAÇÃO, CAPTURA DE T1 E PROVA T1 > T0 - F8)
-- ------------------------------------------------------------------------------
do $stmt2$
declare
  v_evt_id uuid;
  v_item4_id uuid;
  v_token_init timestamptz;
  v_token_ret timestamptz;
  v_token_db timestamptz;
  res jsonb;
  v_cmd_id uuid := gen_random_uuid();
begin
  select v_uuid into v_evt_id from pg_temp.b2_state where k = 'evt_id';
  select v_uuid into v_item4_id from pg_temp.b2_state where k = 'item4_id';
  select v_time into v_token_init from pg_temp.b2_state where k = 'token_init';

  -- 7.1 Conflito otimista com updated_at desatualizado rejeitado com 40001
  perform pg_temp.b2_as(1, format(
    'select to_jsonb(r) from public.update_event_item(%L, %L, %L, %L, %L, 1500, 0, null, null, %L) r',
    pg_temp.b2_id(10), gen_random_uuid(), v_evt_id, v_item4_id, 'Louvor Desatualizado',
    v_token_init - interval '1 minute'
  ), '40001');

  -- 7.2 Primeira atualização em statement próprio pós-espera: statement_timestamp() avançado
  res := pg_temp.b2_as(1, format(
    'select to_jsonb(r) from public.update_event_item(%L, %L, %L, %L, %L, 1500, 0, null, null, %L) r',
    pg_temp.b2_id(10), v_cmd_id, v_evt_id, v_item4_id, 'Louvor Congregacional Fase 1',
    v_token_init
  ));

  v_token_ret := (res->'result_payload'->'after'->>'updated_at')::timestamptz;
  select updated_at into v_token_db from app_private.event_items where id = v_item4_id;

  -- Comprova expressamente que T1 > T0 (F8)
  if v_token_ret is null
     or v_token_init is null
     or not (v_token_ret > v_token_init) then
    raise exception 'Caso 7 falhou: T1 (%) não é estritamente posterior a T0 (%).', v_token_ret, v_token_init;
  end if;

  -- Comprova que o valor retornado é igual ao persistido pelo trigger touch_updated_at
  if v_token_ret is null or v_token_ret is distinct from v_token_db then
    raise exception 'Caso 7 falhou: token retornado (%) diverge do persistido no banco (%).', v_token_ret, v_token_db;
  end if;

  insert into pg_temp.b2_state (k, v_time) values ('token_fase1', v_token_ret);
end;
$stmt2$;

-- ------------------------------------------------------------------------------
-- STATEMENT 3: CASO 7.3 (PROVA DE REJEIÇÃO 40001 COM TOKEN T0 EM NOVO COMANDO - F8)
-- ------------------------------------------------------------------------------
do $stmt3$
declare
  v_evt_id uuid;
  v_item4_id uuid;
  v_token_init timestamptz;
begin
  select v_uuid into v_evt_id from pg_temp.b2_state where k = 'evt_id';
  select v_uuid into v_item4_id from pg_temp.b2_state where k = 'item4_id';
  select v_time into v_token_init from pg_temp.b2_state where k = 'token_init';

  -- Comando novo utilizando T0 desatualizado deve ser recusado com 40001
  perform pg_temp.b2_as(1, format(
    'select to_jsonb(r) from public.update_event_item(%L, %L, %L, %L, %L, 1550, 0, null, null, %L) r',
    pg_temp.b2_id(10), gen_random_uuid(), v_evt_id, v_item4_id, 'Tentativa Concorrente Inválida',
    v_token_init
  ), '40001');
end;
$stmt3$;

-- ------------------------------------------------------------------------------
-- STATEMENT 4: CASO 7.4 (SUCESSO COM NOVO TOKEN T1 EM NOVO STATEMENT - F8)
-- ------------------------------------------------------------------------------
do $stmt4$
declare
  v_evt_id uuid;
  v_item4_id uuid;
  v_token_fase1 timestamptz;
  res jsonb;
begin
  select v_uuid into v_evt_id from pg_temp.b2_state where k = 'evt_id';
  select v_uuid into v_item4_id from pg_temp.b2_state where k = 'item4_id';
  select v_time into v_token_fase1 from pg_temp.b2_state where k = 'token_fase1';

  -- Atualização encadeada usando o token novo T1: deve ter sucesso imediato sem 40001
  res := pg_temp.b2_as(1, format(
    'select to_jsonb(r) from public.update_event_item(%L, %L, %L, %L, %L, 1600, 0, null, null, %L) r',
    pg_temp.b2_id(10), gen_random_uuid(), v_evt_id, v_item4_id, 'Louvor Congregacional Fase 2',
    v_token_fase1
  ));

  if res->'result_payload'->'after'->>'title' is distinct from 'Louvor Congregacional Fase 2' then
    raise exception 'Caso 7.4 falhou: encadeamento do token updated_at não aplicou a alteração.';
  end if;
end;
$stmt4$;

-- ------------------------------------------------------------------------------
-- STATEMENT 5: CASOS 8 A 15 (REPLAY FOCAL F1, ASSIGNMENTS, ROLLBACK E GOVERNANÇA)
-- ------------------------------------------------------------------------------
do $stmt5$
declare
  res jsonb;
  v_evt_id uuid;
  v_item1_id uuid;
  v_item2_id uuid;
  v_item3_id uuid;
  v_item4_id uuid;
  v_cmd_id uuid;
  v_cmd_upd2 uuid;
  v_cmd_del2 uuid;
  v_updated_at timestamptz;
  v_assignment_id uuid;

  -- Variáveis desacopladas para o Caso 8 (F1)
  v_update_expected_at_original timestamptz;
  v_update_persisted_at timestamptz;
  v_remove_expected_at timestamptz;
begin
  select v_uuid into v_evt_id from pg_temp.b2_state where k = 'evt_id';
  select v_uuid into v_item1_id from pg_temp.b2_state where k = 'item1_id';
  select v_uuid into v_item2_id from pg_temp.b2_state where k = 'item2_id';
  select v_uuid into v_item3_id from pg_temp.b2_state where k = 'item3_id';
  select v_uuid into v_item4_id from pg_temp.b2_state where k = 'item4_id';

  -- ============================================================================
  -- CASO 8: Replay Idempotente de Edição com Parâmetros Preservados Pós-Exclusão (F1)
  -- ============================================================================
  -- 1. Captura do token anterior à edição em variável própria
  select updated_at into v_update_expected_at_original from app_private.event_items where id = v_item2_id;
  v_cmd_upd2 := gen_random_uuid();

  -- 2. Executa a primeira edição usando v_update_expected_at_original
  res := pg_temp.b2_as(1, format(
    'select to_jsonb(r) from public.update_event_item(%L, %L, %L, %L, %L, 7500, 30, %L, %L, %L) r',
    pg_temp.b2_id(10), v_cmd_upd2, v_evt_id, v_item2_id, 'Transmissão Ao Vivo Ajustada',
    pg_temp.b2_id(41), pg_temp.b2_id(3), v_update_expected_at_original
  ));
  if (res->>'result_entity_id')::uuid is distinct from v_item2_id then
    raise exception 'Caso 8.1 falhou: edição inicial de v_item2_id não retornou recibo.';
  end if;

  -- 3. Captura o novo token persistido retornado no payload
  v_update_persisted_at := (res->'result_payload'->'after'->>'updated_at')::timestamptz;
  if v_update_persisted_at is null then
    raise exception 'Caso 8.1 falhou: edição inicial não retornou updated_at persistido.';
  end if;

  -- 4. Remove o item usando o token persistido por meio de v_remove_expected_at
  v_remove_expected_at := v_update_persisted_at;
  v_cmd_del2 := gen_random_uuid();
  perform pg_temp.b2_as(1, format(
    'select to_jsonb(r) from public.remove_event_item(%L, %L, %L, %L, %L) r',
    pg_temp.b2_id(10), v_cmd_del2, v_evt_id, v_item2_id, v_remove_expected_at
  ));

  -- 5. Confirma que o item foi fisicamente excluído
  if exists (select 1 from app_private.event_items where id = v_item2_id) then
    raise exception 'Caso 8.2 falhou: item não foi excluído fisicamente.';
  end if;

  -- 6. Repete a edição original usando exatamente v_update_expected_at_original e os mesmos parâmetros (F1)
  res := pg_temp.b2_as(1, format(
    'select to_jsonb(r) from public.update_event_item(%L, %L, %L, %L, %L, 7500, 30, %L, %L, %L) r',
    pg_temp.b2_id(10), v_cmd_upd2, v_evt_id, v_item2_id, 'Transmissão Ao Vivo Ajustada',
    pg_temp.b2_id(41), pg_temp.b2_id(3), v_update_expected_at_original
  ));

  -- 7. Confirma devolução do recibo original com sucesso após revalidação de autoridade
  if (res->>'result_entity_id')::uuid is distinct from v_item2_id
     or res->'result_payload'->'after'->>'title' is distinct from 'Transmissão Ao Vivo Ajustada' then
    raise exception 'Caso 8.3 falhou: replay de update_event_item pós-exclusão falhou em devolver o recibo original.';
  end if;

  -- ============================================================================
  -- CASO 9: Bloqueio Estrito de Remoção Diante de Assignment Vinculado
  -- ============================================================================
  v_assignment_id := gen_random_uuid();
  insert into app_private.assignments (
    id, church_id, event_id, item_id, team_id, member_id, status
  ) values (
    v_assignment_id, pg_temp.b2_id(10), v_evt_id, v_item3_id, pg_temp.b2_id(40), pg_temp.b2_id(3), 'active'
  );

  select updated_at into v_updated_at from app_private.event_items where id = v_item3_id;

  perform pg_temp.b2_as(1, format(
    'select to_jsonb(r) from public.remove_event_item(%L, %L, %L, %L, %L) r',
    pg_temp.b2_id(10), gen_random_uuid(), v_evt_id, v_item3_id, v_updated_at
  ), 'P0020');

  delete from app_private.assignments where id = v_assignment_id;

  -- ============================================================================
  -- CASO 10: Remoção Física, Renumeração Contígua e Replay Pós-Exclusão
  -- ============================================================================
  select updated_at into v_updated_at from app_private.event_items where id = v_item1_id;
  v_cmd_id := gen_random_uuid();

  res := pg_temp.b2_as(2, format(
    'select to_jsonb(r) from public.remove_event_item(%L, %L, %L, %L, %L) r',
    pg_temp.b2_id(10), v_cmd_id, v_evt_id, v_item1_id, v_updated_at
  ));

  if exists (select 1 from app_private.event_items where id = v_item1_id) then
    raise exception 'Caso 10.1 falhou: item não foi removido fisicamente.';
  end if;
  if (select sequence_order from app_private.event_items where id = v_item3_id) is distinct from 2 then
    raise exception 'Caso 10.1 falhou: renumeração para sequência contígua 1..n não ocorreu.';
  end if;

  -- 10.2 Replay pós-exclusão: repetição da mesma chamada com mesmo command_id
  res := pg_temp.b2_as(2, format(
    'select to_jsonb(r) from public.remove_event_item(%L, %L, %L, %L, %L) r',
    pg_temp.b2_id(10), v_cmd_id, v_evt_id, v_item1_id, v_updated_at
  ));
  if (res->>'result_entity_id')::uuid is distinct from v_item1_id then
    raise exception 'Caso 10.2 falhou: replay de remoção pós-exclusão falhou em devolver o recibo.';
  end if;

  -- 10.3 Replay com parâmetros divergentes para mesmo command_id rejeitado com 23505 (C9)
  perform pg_temp.b2_as(2, format(
    'select to_jsonb(r) from public.remove_event_item(%L, %L, %L, %L, %L) r',
    pg_temp.b2_id(10), v_cmd_id, v_evt_id, v_item3_id, v_updated_at
  ), '23505');

  -- ============================================================================
  -- CASO 11: Reordenação em Lote (public.reorder_event_items)
  -- ============================================================================
  perform pg_temp.b2_as(1, format(
    'select to_jsonb(r) from public.reorder_event_items(%L, %L, %L, array[]::uuid[]) r',
    pg_temp.b2_id(10), gen_random_uuid(), v_evt_id
  ), '22023');

  perform pg_temp.b2_as(1, format(
    'select to_jsonb(r) from public.reorder_event_items(%L, %L, %L, array[%L::uuid]) r',
    pg_temp.b2_id(10), gen_random_uuid(), v_evt_id, v_item4_id
  ), '22023');

  res := pg_temp.b2_as(1, format(
    'select to_jsonb(r) from public.reorder_event_items(%L, %L, %L, array[%L::uuid, %L::uuid]) r',
    pg_temp.b2_id(10), gen_random_uuid(), v_evt_id, v_item3_id, v_item4_id
  ));
  if (select sequence_order from app_private.event_items where id = v_item3_id) is distinct from 1
     or (select sequence_order from app_private.event_items where id = v_item4_id) is distinct from 2 then
    raise exception 'Caso 11 falhou: reordenação válida não inverteu a ordem.';
  end if;

  -- ============================================================================
  -- CASO 12: Publicação Imutável e Bloqueio de Mutações Subsequentes
  -- ============================================================================
  res := pg_temp.b2_as(1, format(
    'select to_jsonb(r) from public.publish_event_program(%L, %L, %L) r',
    pg_temp.b2_id(10), gen_random_uuid(), v_evt_id
  ));
  if res->'result_payload'->>'program_status' is distinct from 'published'
     or (res->'result_payload'->>'program_version')::integer is distinct from 2 then
    raise exception 'Caso 12 falhou: publicação não gerou status published ou versão 2.';
  end if;

  perform pg_temp.b2_as(1, format(
    'select to_jsonb(r) from public.publish_event_program(%L, %L, %L) r',
    pg_temp.b2_id(10), gen_random_uuid(), v_evt_id
  ), 'P0020');

  perform pg_temp.b2_as(1, format(
    'select to_jsonb(r) from public.create_event_item(%L, %L, %L, %L, %L, 3, 300, null, null, 0) r',
    pg_temp.b2_id(10), gen_random_uuid(), v_evt_id, 'Item Bloqueado', 'liturgical'
  ), 'P0020');

  -- ============================================================================
  -- CASO 13: Transição Explícita para Rascunho (save_event_program_draft)
  -- ============================================================================
  res := pg_temp.b2_as(1, format(
    'select to_jsonb(r) from public.save_event_program_draft(%L, %L, %L) r',
    pg_temp.b2_id(10), gen_random_uuid(), v_evt_id
  ));
  if res->'result_payload'->>'program_status' is distinct from 'draft'
     or (res->'result_payload'->>'program_version')::integer is distinct from 2 then
    raise exception 'Caso 13 falhou: transição para rascunho alterou versão indevidamente.';
  end if;

  perform pg_temp.b2_as(1, format(
    'select to_jsonb(r) from public.save_event_program_draft(%L, %L, %L) r',
    pg_temp.b2_id(10), gen_random_uuid(), v_evt_id
  ), 'P0020');

  -- ============================================================================
  -- CASO 14: Bloqueio de Mutações em Eventos Não Agendados
  -- ============================================================================
  update app_private.events set status = 'in_progress' where id = v_evt_id;
  select updated_at into v_updated_at from app_private.event_items where id = v_item3_id;

  perform pg_temp.b2_as(1, format(
    'select to_jsonb(r) from public.update_event_item(%L, %L, %L, %L, %L, 1800, 0, null, null, %L) r',
    pg_temp.b2_id(10), gen_random_uuid(), v_evt_id, v_item3_id, 'Tentativa em Andamento',
    v_updated_at
  ), 'P0020');

  -- ============================================================================
  -- CASO 15: Perda de Autoridade Barrando Replay
  -- ============================================================================
  update app_private.events set status = 'scheduled', program_status = 'draft' where id = v_evt_id;
  select updated_at into v_updated_at from app_private.event_items where id = v_item3_id;

  v_cmd_id := gen_random_uuid();
  res := pg_temp.b2_as(2, format(
    'select to_jsonb(r) from public.update_event_item(%L, %L, %L, %L, %L, 1900, 0, null, null, %L) r',
    pg_temp.b2_id(10), v_cmd_id, v_evt_id, v_item3_id, 'Mensagem Atualizada',
    v_updated_at
  ));

  update app_private.events set liturgy_leader_member_id = null where id = v_evt_id;

  perform pg_temp.b2_as(2, format(
    'select to_jsonb(r) from public.update_event_item(%L, %L, %L, %L, %L, 1900, 0, null, null, %L) r',
    pg_temp.b2_id(10), v_cmd_id, v_evt_id, v_item3_id, 'Mensagem Atualizada',
    v_updated_at
  ), '42501');

end;
$stmt5$;

-- M2 (G8): captura dentro do ensaio, com dados fictícios visíveis, antes do ROLLBACK.
-- Como o ROLLBACK descarta a transação, o SHA-256 é guardado em variável psql (sobrevive ao ROLLBACK).
select encode(pg_catalog.sha256(convert_to(pg_temp.b2_snapshot()::text, 'UTF8')), 'hex') as b2_m2_sha256 \gset

-- Encerramento da Parte II sob ROLLBACK (limpeza dos dados fictícios por descarte transacional)
rollback;

insert into pg_temp.b2_snapshots (label, captured_at, snapshot, sha256)
values ('M2', clock_timestamp(), null, :'b2_m2_sha256');

-- M3 (G8): depois da limpeza dos dados fictícios
select pg_temp.b2_capture('M3');

-- ==============================================================================
-- PARTE III — PROTOCOLO EXPLÍCITO MULTISSESSÃO (SESSÃO A / SESSÃO B)
-- ==============================================================================
/*
Protocolo para validar serialização e concorrência pessimista/otimista entre conexões independentes.

PREPARAÇÃO:
  Conectar dois terminais psql ao banco de ensaio (Sessão A e Sessão B) com usuários autenticados da mesma igreja.

PASSO 1 (Sessão A — Bloqueio Transacional do Evento):
  begin;
  select set_config('request.jwt.claim.sub', '<id-admin>', true);
  set local role authenticated;
  -- Invoca create_event_item mantendo a transação aberta:
  select * from public.create_event_item(
    '<church-id>', gen_random_uuid(), '<event-id>', 'Item em Concorrência A', 'liturgical', 1, 600, null, null, 0
  );
  -- NÃO executar commit ou rollback ainda. O lock FOR UPDATE em app_private.events está retido pela Sessão A.

PASSO 2 (Sessão B — Espera de Lock e Serialização):
  begin;
  set local lock_timeout = '2s';
  select set_config('request.jwt.claim.sub', '<id-liturgia>', true);
  set local role authenticated;
  -- Tenta inserir itens no mesmo evento:
  select * from public.create_event_item(
    '<church-id>', gen_random_uuid(), '<event-id>', 'Item em Concorrência B', 'liturgical', 1, 600, null, null, 0
  );
  -- RESULTADO ESPERADO: Sessão B aguarda o lock retido pela Sessão A. Se decorrerem 2s, é abortada por lock_timeout (55P03).
  -- Se a Sessão A fizer commit antes do timeout, Sessão B adquire o lock, lê a sequência atualizada e insere na ordem correta.

PASSO 3 (Sessão B — Conflito Otimista em Edição Simultânea):
  -- Sessão A e Sessão B lêem o mesmo item com updated_at = T0.
  -- Sessão A executa update_event_item com p_expected_updated_at = T0 e faz commit (updated_at passa para T1).
  -- Sessão B tenta executar update_event_item passando p_expected_updated_at = T0.
  -- RESULTADO ESPERADO: Sessão B recebe imediatamente erro 40001 (conflito de concorrência otimista).
*/

-- ==============================================================================
-- PARTE IV — PROCEDIMENTO DE ENSAIO DE ROLLBACK
-- ==============================================================================
/*
Instruções para o operador validar a reversão do pacote B2:
1. Em banco de ensaio no baseline do SQL 025:
2. Execute docs/sql/026_event_program_editing.sql.
3. Execute docs/sql/026_verify.sql e comprove retorno de 0 violações (código de saída zero).
4. Execute docs/sql/026_rollback.sql.
5. Verifique que o script executa sem erros, passa nas asserções pós-rollback e restaura as assinaturas e corpos do 015, 016 e 025.
*/

-- ==============================================================================
-- PARTE V — PROCEDIMENTO EXECUTÁVEL E DETERMINÍSTICO DE DELTA ZERO (F10, G8)
--
-- Execução: pelo próprio driver (ver cabeçalho do roteiro). Fases executadas em sequência:
--   F0: M0 -> \i instalador -> \i verificador -> M1
--   Parte II: fixtures sob ROLLBACK, com M2 (antes do ROLLBACK) e M3 (depois)
--   F2: \i rollback -> M4 -> \i instalador -> M5 -> \i rollback -> M6
--   Comparador: exige exatamente M0..M6, sem nulos, sem duplicados e sem rótulos extras.
--
-- Conteúdo comparado (pg_temp.b2_snapshot): colunas e defaults, constraints e FKs, índices, triggers,
-- funções/overloads, argumentos, retornos, configurações, owners, ACLs ordenadas, fingerprints e
-- dados completos de app_private.events, event_items, assignments, event_planning_receipts,
-- command_receipts e audit_entries (ordenados pelo texto canônico da linha). Data e rótulo ficam fora.
--
-- Qualquer diferença não prevista reprova o delta zero, incluindo dados, defaults, constraints, FKs,
-- índices, triggers, funções, overloads, owner ou ACL.
--
-- M5 comprova reinstalabilidade após rollback; NÃO é prova de idempotência. O preflight continua
-- recusando aplicação direta repetida sem rollback.

-- F2 (driver): rollback, M4, reinstalação, M5, segundo rollback, M6. Executado somente após Parte II.
\i docs/sql/026_rollback.sql
select pg_temp.b2_capture('M4');
\i docs/sql/026_event_program_editing.sql
select pg_temp.b2_capture('M5');
\i docs/sql/026_rollback.sql
select pg_temp.b2_capture('M6');

-- Comparador final (B4): gate de existência exata antes de qualquer comparação.
do $delta_zero$
declare
  v_labels text[];
  v_total integer;
  v_distinct integer;
  v_bad integer;
  r record;
begin
  select count(*), count(distinct label), count(*) filter (where sha256 is null or sha256 !~ '^[0-9a-f]{64}$')
  into v_total, v_distinct, v_bad
  from pg_temp.b2_snapshots;
  select array_agg(label order by label) into v_labels from pg_temp.b2_snapshots;

  if v_total <> 7 or v_distinct <> 7 then
    raise exception 'GATE M0-M6 FALHOU: esperados exatamente 7 registros distintos, encontrados % (distintos %).', v_total, v_distinct
      using errcode = 'P0001';
  end if;
  if v_labels is distinct from array['M0','M1','M2','M3','M4','M5','M6'] then
    raise exception 'GATE M0-M6 FALHOU: rótulos presentes % divergem do conjunto exato M0..M6.', v_labels
      using errcode = 'P0001';
  end if;
  if v_bad <> 0 then
    raise exception 'GATE M0-M6 FALHOU: % registro(s) com SHA-256 nulo ou malformado.', v_bad
      using errcode = 'P0001';
  end if;

  for r in select * from (values ('M0', 'M4'), ('M0', 'M6'), ('M1', 'M5'), ('M1', 'M3')) as t(a, b) loop
    if (select sha256 from pg_temp.b2_snapshots where label = r.a)
       is distinct from (select sha256 from pg_temp.b2_snapshots where label = r.b) then
      raise exception 'DELTA ZERO REPROVADO: % difere de % (diferença não prevista em catálogo ou dados).', r.a, r.b
        using errcode = 'P0001';
    end if;
  end loop;

  if (select sha256 from pg_temp.b2_snapshots where label = 'M2')
     is not distinct from (select sha256 from pg_temp.b2_snapshots where label = 'M1') then
    raise exception 'ENSAIO INCONCLUSIVO: M2 é igual a M1; os dados fictícios não foram comprovadamente criados.'
      using errcode = 'P0001';
  end if;

  raise notice 'DELTA ZERO APROVADO PELO COMPARADOR: M0 = M4 = M6; M1 = M5 = M3; M2 difere de M1.';
end;
$delta_zero$;

-- Nota: este bloco somente tem efeito após as capturas M0 a M6 da mesma sessão. Sem elas, a consulta falha.

-- ==============================================================================
-- PARTE VI — PROCEDIMENTO DE CONFERÊNCIA COM 026_VERIFY.SQL
-- ==============================================================================
/*
Após aplicação definitiva ou ensaio com commit de 026_event_program_editing.sql:
1. Executar:
   psql -v ON_ERROR_STOP=1 -f docs/sql/026_verify.sql
2. Critério de aprovação: o script encerra com código de retorno zero e emite a linha de status com todos os booleanos TRUE.
3. Se qualquer assertion falhar, o bloco procedural levanta EXCEPTION detalhando o gate reprovado e encerra com erro.
*/
