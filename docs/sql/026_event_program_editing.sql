-- ==============================================================================
-- 026_event_program_editing.sql
-- Incremento B2 v1.0: Persistência, Leitura, Edição, Remoção e Consistência da
-- Programação de Eventos (Issues #29 e #30)
--
-- Rastreabilidade: Issues #29, #30, #58 e #59
-- Decisões do Responsável: Contrato B2 v1.0 (Revisão Pós-Auditoria Independente)
--
-- ESCOPO DESTE ARTEFATO:
-- 1. Preflight fail-closed determinístico de baseline esperado (reconciliado 015–025).
-- 2. DDL: coluna prep_required_minutes e constraints em app_private.event_items.
-- 3. Nova RPC de leitura: public.get_event_program(uuid, uuid).
-- 4. Extensão de listagem: public.list_church_events(uuid, text, integer, integer)
--    acrescentando program_status, duration_policy, program_version, published_at e items_count,
--    com ordenação total determinística (planned_start_at desc, id desc).
-- 5. Evolução da assinatura de public.create_event_item com p_prep_required_minutes,
--    serialização FOR UPDATE, deslocamento de posições, trava scheduled+draft e captura de updated_at.
-- 6. Novas RPCs de mutação com protocolo de replay seguro (antes do lock do item),
--    concorrência otimista, token updated_at efetivo e auditoria antes/depois:
--    - public.update_event_item(uuid, uuid, uuid, uuid, text, integer, integer, uuid, uuid, timestamptz)
--    - public.remove_event_item(uuid, uuid, uuid, uuid, timestamptz) (checagem canônica de assignments.item_id)
-- 7. Endurecimento das 4 RPCs de planejamento para scheduled+draft:
--    - public.reorder_event_items(uuid, uuid, uuid, uuid[])
--    - public.set_event_duration_policy(uuid, uuid, uuid, text)
--    - public.publish_event_program(uuid, uuid, uuid)
--    - public.save_event_program_draft(uuid, uuid, uuid) (transição estrita published -> draft)
-- 8. Asserções pós-instalação de catálogo, privilégios e ownership antes do COMMIT.
-- ==============================================================================

\set ON_ERROR_STOP on

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- ------------------------------------------------------------------------------
-- ETAPA 1: PREFLIGHT FAIL-CLOSED DE BASELINE E INTEGRIDADE DE DADOS (C12, F2-F7)
-- ------------------------------------------------------------------------------
do $preflight$
declare
  v_count integer;
  v_missing_cols integer;
  v_rec record;
  v_hash text;
begin
  -- 1.0 Encoding obrigatório UTF8
  if current_setting('server_encoding') <> 'UTF8' or current_setting('client_encoding') <> 'UTF8' then
    raise exception 'PREFLIGHT FALHOU: Banco e conexão precisam usar UTF8.' using errcode = '22023';
  end if;

  -- 1.1 Pré-requisitos fundamentais de tabelas obrigatórias (001–025)
  if to_regclass('app_private.churches') is null
    or to_regclass('app_private.church_access') is null
    or to_regclass('app_private.members') is null
    or to_regclass('app_private.events') is null
    or to_regclass('app_private.event_items') is null
    or to_regclass('app_private.audit_entries') is null
    or to_regclass('app_private.event_planning_receipts') is null
    or to_regclass('app_private.command_receipts') is null
    or to_regclass('app_private.assignments') is null
    or to_regclass('app_private.teams') is null then
    raise exception 'PREFLIGHT FALHOU: Estrutura base de tabelas obrigatórias não encontrada.'
      using errcode = 'P0002';
  end if;

  -- 1.2 Matriz canônica de colunas (G2): para cada coluna esperada das quatro tabelas, compara
  -- nome, tipo (format_type), attnotnull, default (pg_get_expr normalizado), identidade e geração.
  -- A identidade lógica da coluna é o nome; attnum é posição física, não faz parte do contrato
  -- nem da igualdade (pode haver lacunas por colunas removidas e posições diferentes entre bancos).
  -- O attnum permanece apenas como chave interna de pg_attribute -> pg_attrdef e do filtro attnum > 0.
  -- O full join casa por nome e reprova coluna ausente, divergente ou extra.
  -- 1.2.1 app_private.events (20 colunas canônicas)
  select count(*) into v_missing_cols
  from (
    values
      ('id', 'uuid', true, 'gen_random_uuid()'),
      ('church_id', 'uuid', true, ''),
      ('title', 'text', true, ''),
      ('event_type', 'text', true, '''culto''::text'),
      ('timezone', 'text', true, ''),
      ('status', 'text', true, '''scheduled''::text'),
      ('planned_start_at', 'timestamp with time zone', true, ''),
      ('planned_end_at', 'timestamp with time zone', true, ''),
      ('actual_start_at', 'timestamp with time zone', false, ''),
      ('actual_end_at', 'timestamp with time zone', false, ''),
      ('liturgy_leader_member_id', 'uuid', false, ''),
      ('version', 'integer', true, '1'),
      ('cancel_reason', 'text', false, ''),
      ('created_at', 'timestamp with time zone', true, 'clock_timestamp()'),
      ('updated_at', 'timestamp with time zone', true, 'clock_timestamp()'),
      ('duration_policy', 'text', true, '''warn''::text'),
      ('program_status', 'text', true, '''draft''::text'),
      ('program_version', 'integer', true, '1'),
      ('published_at', 'timestamp with time zone', false, ''),
      ('published_by_member_id', 'uuid', false, '')
  ) as e(col, typ, nn, def)
  full join (
    select a.attname::text as col,
           format_type(a.atttypid, a.atttypmod) as typ, a.attnotnull as nn,
           coalesce(regexp_replace(pg_get_expr(d.adbin, d.adrelid), '\s+', ' ', 'g'), '') as def,
           a.attidentity::text as ident, a.attgenerated::text as gen
    from pg_attribute a
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    where a.attrelid = 'app_private.events'::regclass and a.attnum > 0 and not a.attisdropped
  ) as r on r.col = e.col
  where e.col is null or r.col is null
     or r.col <> e.col or r.typ <> e.typ or r.nn <> e.nn or r.def <> e.def
     or r.ident <> '' or r.gen <> '';
  if v_missing_cols > 0 then
    raise exception 'PREFLIGHT FALHOU: Matriz de colunas de app_private.events diverge do baseline (% divergências).', v_missing_cols
      using errcode = '42P07';
  end if;

  -- 1.2.2 app_private.event_items (15 colunas canônicas pré-026)
  select count(*) into v_missing_cols
  from (
    values
      ('id', 'uuid', true, 'gen_random_uuid()'),
      ('church_id', 'uuid', true, ''),
      ('event_id', 'uuid', true, ''),
      ('title', 'text', true, ''),
      ('item_nature', 'text', true, '''liturgical''::text'),
      ('sequence_order', 'integer', true, '1'),
      ('planned_duration_seconds', 'integer', true, '300'),
      ('status', 'text', true, '''pending''::text'),
      ('designated_team_id', 'uuid', false, ''),
      ('nominal_leader_member_id', 'uuid', false, ''),
      ('actual_start_at', 'timestamp with time zone', false, ''),
      ('actual_end_at', 'timestamp with time zone', false, ''),
      ('cancel_reason', 'text', false, ''),
      ('created_at', 'timestamp with time zone', true, 'clock_timestamp()'),
      ('updated_at', 'timestamp with time zone', true, 'clock_timestamp()')
  ) as e(col, typ, nn, def)
  full join (
    select a.attname::text as col,
           format_type(a.atttypid, a.atttypmod) as typ, a.attnotnull as nn,
           coalesce(regexp_replace(pg_get_expr(d.adbin, d.adrelid), '\s+', ' ', 'g'), '') as def,
           a.attidentity::text as ident, a.attgenerated::text as gen
    from pg_attribute a
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    where a.attrelid = 'app_private.event_items'::regclass and a.attnum > 0 and not a.attisdropped
  ) as r on r.col = e.col
  where e.col is null or r.col is null
     or r.col <> e.col or r.typ <> e.typ or r.nn <> e.nn or r.def <> e.def
     or r.ident <> '' or r.gen <> '';
  if v_missing_cols > 0 then
    raise exception 'PREFLIGHT FALHOU: Matriz de colunas de app_private.event_items diverge do baseline pré-026 (% divergências).', v_missing_cols
      using errcode = '42P07';
  end if;

  -- Ausência estrita de prep_required_minutes pré-026 (também coberta pela matriz acima)
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'app_private' and table_name = 'event_items' and column_name = 'prep_required_minutes'
  ) then
    raise exception 'PREFLIGHT BLOQUEADO: Coluna prep_required_minutes já existe em app_private.event_items.'
      using errcode = '42701';
  end if;

  -- 1.2.3 app_private.assignments (13 colunas canônicas)
  select count(*) into v_missing_cols
  from (
    values
      ('id', 'uuid', true, 'gen_random_uuid()'),
      ('church_id', 'uuid', true, ''),
      ('event_id', 'uuid', true, ''),
      ('item_id', 'uuid', false, ''),
      ('team_id', 'uuid', true, ''),
      ('team_role_id', 'uuid', false, ''),
      ('member_id', 'uuid', true, ''),
      ('status', 'text', true, '''active''::text'),
      ('replaced_assignment_id', 'uuid', false, ''),
      ('replacement_assignment_id', 'uuid', false, ''),
      ('notes', 'text', false, ''),
      ('created_at', 'timestamp with time zone', true, 'clock_timestamp()'),
      ('updated_at', 'timestamp with time zone', true, 'clock_timestamp()')
  ) as e(col, typ, nn, def)
  full join (
    select a.attname::text as col,
           format_type(a.atttypid, a.atttypmod) as typ, a.attnotnull as nn,
           coalesce(regexp_replace(pg_get_expr(d.adbin, d.adrelid), '\s+', ' ', 'g'), '') as def,
           a.attidentity::text as ident, a.attgenerated::text as gen
    from pg_attribute a
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    where a.attrelid = 'app_private.assignments'::regclass and a.attnum > 0 and not a.attisdropped
  ) as r on r.col = e.col
  where e.col is null or r.col is null
     or r.col <> e.col or r.typ <> e.typ or r.nn <> e.nn or r.def <> e.def
     or r.ident <> '' or r.gen <> '';
  if v_missing_cols > 0 then
    raise exception 'PREFLIGHT FALHOU: Matriz de colunas de app_private.assignments diverge do baseline (% divergências).', v_missing_cols
      using errcode = '42P07';
  end if;

  -- 1.2.4 app_private.event_planning_receipts (7 colunas canônicas)
  select count(*) into v_missing_cols
  from (
    values
      ('user_id', 'uuid', true, ''),
      ('command_id', 'uuid', true, ''),
      ('church_id', 'uuid', true, ''),
      ('action', 'text', true, ''),
      ('params', 'jsonb', true, ''),
      ('result', 'jsonb', true, ''),
      ('created_at', 'timestamp with time zone', true, 'statement_timestamp()')
  ) as e(col, typ, nn, def)
  full join (
    select a.attname::text as col,
           format_type(a.atttypid, a.atttypmod) as typ, a.attnotnull as nn,
           coalesce(regexp_replace(pg_get_expr(d.adbin, d.adrelid), '\s+', ' ', 'g'), '') as def,
           a.attidentity::text as ident, a.attgenerated::text as gen
    from pg_attribute a
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    where a.attrelid = 'app_private.event_planning_receipts'::regclass and a.attnum > 0 and not a.attisdropped
  ) as r on r.col = e.col
  where e.col is null or r.col is null
     or r.col <> e.col or r.typ <> e.typ or r.nn <> e.nn or r.def <> e.def
     or r.ident <> '' or r.gen <> '';
  if v_missing_cols > 0 then
    raise exception 'PREFLIGHT FALHOU: Matriz de colunas de app_private.event_planning_receipts diverge do baseline (% divergências).', v_missing_cols
      using errcode = '42P07';
  end if;

  -- Ausência estrita de event_item_id em assignments (obsoleto)
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'app_private' and table_name = 'assignments' and column_name = 'event_item_id'
  ) then
    raise exception 'PREFLIGHT BLOQUEADO: Coluna obsoleta/inexistente event_item_id detectada em app_private.assignments.'
      using errcode = '42701';
  end if;

  -- 1.3 Matriz canônica de constraints (G3): nome, contype, pg_get_constraintdef normalizado,
  -- convalidated, condeferrable, condeferred e, para FKs, confupdtype, confdeltype e confmatchtype.
  -- Mesmo nome com definição diferente reprova. Constraints fora da matriz também reprovam.
  select count(*) into v_missing_cols
  from (
    values
      ('app_private.events', 'events_pkey', 'p', 'PRIMARY KEY (id)', '', '', ''),
      ('app_private.events', 'events_church_id_id_unique', 'u', 'UNIQUE (church_id, id)', '', '', ''),
      ('app_private.events', 'events_church_id_fkey', 'f', 'FOREIGN KEY (church_id) REFERENCES app_private.churches(id) ON DELETE RESTRICT', 'a', 'r', 's'),
      ('app_private.events', 'events_church_liturgy_fkey', 'f', 'FOREIGN KEY (church_id, liturgy_leader_member_id) REFERENCES app_private.members(church_id, id) ON DELETE RESTRICT', 'a', 'r', 's'),
      ('app_private.events', 'events_published_by_member_id_fkey', 'f', 'FOREIGN KEY (published_by_member_id) REFERENCES app_private.members(id) ON DELETE SET NULL', 'a', 'n', 's'),
      ('app_private.events', 'events_status_check', 'c', 'CHECK ((status = ANY (ARRAY[''scheduled''::text, ''in_progress''::text, ''completed''::text, ''cancelled''::text])))', '', '', ''),
      ('app_private.events', 'events_title_clean', 'c', 'CHECK (((title = btrim(title)) AND ((char_length(title) >= 1) AND (char_length(title) <= 200))))', '', '', ''),
      ('app_private.events', 'events_timezone_clean', 'c', 'CHECK (((timezone = btrim(timezone)) AND ((char_length(timezone) >= 1) AND (char_length(timezone) <= 80))))', '', '', ''),
      ('app_private.events', 'events_dates_order', 'c', 'CHECK ((planned_end_at > planned_start_at))', '', '', ''),
      ('app_private.events', 'events_duration_policy_check', 'c', 'CHECK ((duration_policy = ANY (ARRAY[''warn''::text, ''block''::text])))', '', '', ''),
      ('app_private.events', 'events_program_status_check', 'c', 'CHECK ((program_status = ANY (ARRAY[''draft''::text, ''published''::text])))', '', '', ''),
      ('app_private.event_items', 'event_items_pkey', 'p', 'PRIMARY KEY (id)', '', '', ''),
      ('app_private.event_items', 'ei_church_id_id_unique', 'u', 'UNIQUE (church_id, id)', '', '', ''),
      ('app_private.event_items', 'ei_church_event_item_unique', 'u', 'UNIQUE (church_id, event_id, id)', '', '', ''),
      ('app_private.event_items', 'ei_church_event_fkey', 'f', 'FOREIGN KEY (church_id, event_id) REFERENCES app_private.events(church_id, id) ON DELETE RESTRICT', 'a', 'r', 's'),
      ('app_private.event_items', 'ei_church_team_fkey', 'f', 'FOREIGN KEY (church_id, designated_team_id) REFERENCES app_private.teams(church_id, id) ON DELETE RESTRICT', 'a', 'r', 's'),
      ('app_private.event_items', 'ei_church_leader_fkey', 'f', 'FOREIGN KEY (church_id, nominal_leader_member_id) REFERENCES app_private.members(church_id, id) ON DELETE RESTRICT', 'a', 'r', 's'),
      ('app_private.event_items', 'event_items_item_nature_check', 'c', 'CHECK ((item_nature = ANY (ARRAY[''liturgical''::text, ''parallel_support''::text])))', '', '', ''),
      ('app_private.event_items', 'event_items_status_check', 'c', 'CHECK ((status = ANY (ARRAY[''pending''::text, ''in_progress''::text, ''completed''::text, ''cancelled''::text])))', '', '', ''),
      ('app_private.event_items', 'event_items_planned_duration_seconds_check', 'c', 'CHECK ((planned_duration_seconds > 0))', '', '', ''),
      ('app_private.assignments', 'assignments_pkey', 'p', 'PRIMARY KEY (id)', '', '', ''),
      ('app_private.assignments', 'asg_church_id_id_unique', 'u', 'UNIQUE (church_id, id)', '', '', ''),
      ('app_private.assignments', 'asg_church_event_fkey', 'f', 'FOREIGN KEY (church_id, event_id) REFERENCES app_private.events(church_id, id) ON DELETE RESTRICT', 'a', 'r', 's'),
      ('app_private.assignments', 'asg_church_event_item_fkey', 'f', 'FOREIGN KEY (church_id, event_id, item_id) REFERENCES app_private.event_items(church_id, event_id, id) ON DELETE RESTRICT', 'a', 'r', 's'),
      ('app_private.assignments', 'asg_church_member_fkey', 'f', 'FOREIGN KEY (church_id, member_id) REFERENCES app_private.members(church_id, id) ON DELETE RESTRICT', 'a', 'r', 's'),
      ('app_private.assignments', 'asg_church_team_fkey', 'f', 'FOREIGN KEY (church_id, team_id) REFERENCES app_private.teams(church_id, id) ON DELETE RESTRICT', 'a', 'r', 's'),
      ('app_private.assignments', 'asg_church_team_role_fkey', 'f', 'FOREIGN KEY (church_id, team_id, team_role_id) REFERENCES app_private.team_roles(church_id, team_id, id) ON DELETE RESTRICT', 'a', 'r', 's'),
      ('app_private.assignments', 'asg_replaced_fkey', 'f', 'FOREIGN KEY (church_id, replaced_assignment_id) REFERENCES app_private.assignments(church_id, id) ON DELETE RESTRICT', 'a', 'r', 's'),
      ('app_private.assignments', 'asg_replacement_fkey', 'f', 'FOREIGN KEY (church_id, replacement_assignment_id) REFERENCES app_private.assignments(church_id, id) ON DELETE RESTRICT', 'a', 'r', 's'),
      ('app_private.assignments', 'assignments_status_check', 'c', 'CHECK ((status = ANY (ARRAY[''active''::text, ''replaced''::text, ''cancelled''::text])))', '', '', ''),
      ('app_private.event_planning_receipts', 'event_planning_receipts_pkey', 'p', 'PRIMARY KEY (user_id, command_id)', '', '', ''),
      ('app_private.event_planning_receipts', 'event_planning_receipts_user_id_fkey', 'f', 'FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE RESTRICT', 'a', 'r', 's'),
      ('app_private.event_planning_receipts', 'event_planning_receipts_church_id_fkey', 'f', 'FOREIGN KEY (church_id) REFERENCES app_private.churches(id) ON DELETE RESTRICT', 'a', 'r', 's')
  ) as e(tbl, cname, ctype, cdef, upd, del, mtch)
  full join (
    select n.nspname || '.' || c.relname as tbl, k.conname::text as cname, k.contype::text as ctype,
           regexp_replace(pg_get_constraintdef(k.oid), '\s+', ' ', 'g') as cdef,
           case when k.contype = 'f' then k.confupdtype::text else '' end as upd,
           case when k.contype = 'f' then k.confdeltype::text else '' end as del,
           case when k.contype = 'f' then k.confmatchtype::text else '' end as mtch,
           k.convalidated as valid, k.condeferrable as dfr, k.condeferred as dfd
    from pg_constraint k
    join pg_class c on c.oid = k.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    where k.conrelid in (
            'app_private.events'::regclass, 'app_private.event_items'::regclass,
            'app_private.assignments'::regclass, 'app_private.event_planning_receipts'::regclass)
      and k.contype <> 'n'
  ) as r on r.tbl = e.tbl and r.cname = e.cname
  where e.cname is null or r.cname is null
     or r.ctype <> e.ctype or r.cdef <> e.cdef
     or r.upd <> e.upd or r.del <> e.del or r.mtch <> e.mtch
     or r.valid is not true or r.dfr is not false or r.dfd is not false;
  if v_missing_cols > 0 then
    raise exception 'PREFLIGHT FALHOU: Matriz de constraints das tabelas do domínio diverge do baseline (% divergências).', v_missing_cols
      using errcode = '42P07';
  end if;

  -- Ausência obrigatória de constraints novas do 026
  if exists (select 1 from pg_constraint where conrelid = 'app_private.event_items'::regclass and conname in ('ei_prep_minutes_range', 'ei_liturgical_prep_zero', 'ei_sequence_order_positive')) then
    raise exception 'PREFLIGHT BLOQUEADO: Constraints exclusivas do incremento 026 já detectadas no catálogo.'
      using errcode = '42710';
  end if;

  -- 1.4 Ausência semântica de unicidade incompatível cobrindo sequence_order (F5)
  select count(*) into v_count
  from pg_index i
  join pg_class c on c.oid = i.indrelid
  join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid and a.attnum = any(i.indkey)
  where n.nspname = 'app_private'
    and c.relname = 'event_items'
    and i.indisunique = true
    and a.attname = 'sequence_order';
  if v_count > 0 then
    raise exception 'PREFLIGHT FALHOU: Detectada restrição/índice de unicidade incompatível sobre sequence_order em app_private.event_items.'
      using errcode = '42P07';
  end if;

  -- 1.5 Matriz canônica de índices (G4): nome, tabela, método, unicidade, validade, readiness
  -- e pg_get_indexdef completo (colunas, ordem, predicado). Índices extras reprovam.
  select count(*) into v_missing_cols
  from (
    values
      ('app_private.events', 'events_pkey', 'CREATE UNIQUE INDEX events_pkey ON app_private.events USING btree (id)'),
      ('app_private.events', 'events_church_id_id_unique', 'CREATE UNIQUE INDEX events_church_id_id_unique ON app_private.events USING btree (church_id, id)'),
      ('app_private.events', 'events_church_status_start_idx', 'CREATE INDEX events_church_status_start_idx ON app_private.events USING btree (church_id, status, planned_start_at)'),
      ('app_private.event_items', 'event_items_pkey', 'CREATE UNIQUE INDEX event_items_pkey ON app_private.event_items USING btree (id)'),
      ('app_private.event_items', 'ei_church_id_id_unique', 'CREATE UNIQUE INDEX ei_church_id_id_unique ON app_private.event_items USING btree (church_id, id)'),
      ('app_private.event_items', 'ei_church_event_item_unique', 'CREATE UNIQUE INDEX ei_church_event_item_unique ON app_private.event_items USING btree (church_id, event_id, id)'),
      ('app_private.event_items', 'ei_church_event_order_idx', 'CREATE INDEX ei_church_event_order_idx ON app_private.event_items USING btree (church_id, event_id, sequence_order)'),
      ('app_private.assignments', 'assignments_pkey', 'CREATE UNIQUE INDEX assignments_pkey ON app_private.assignments USING btree (id)'),
      ('app_private.assignments', 'asg_church_id_id_unique', 'CREATE UNIQUE INDEX asg_church_id_id_unique ON app_private.assignments USING btree (church_id, id)'),
      ('app_private.assignments', 'asg_church_event_active_idx', 'CREATE INDEX asg_church_event_active_idx ON app_private.assignments USING btree (church_id, event_id, status) WHERE (status = ''active''::text)'),
      ('app_private.assignments', 'asg_church_member_active_idx', 'CREATE INDEX asg_church_member_active_idx ON app_private.assignments USING btree (church_id, member_id, status) WHERE (status = ''active''::text)'),
      ('app_private.event_planning_receipts', 'event_planning_receipts_pkey', 'CREATE UNIQUE INDEX event_planning_receipts_pkey ON app_private.event_planning_receipts USING btree (user_id, command_id)')
  ) as e(tbl, iname, idef)
  full join (
    select n.nspname || '.' || t.relname as tbl, i.relname::text as iname,
           regexp_replace(pg_get_indexdef(x.indexrelid), '\s+', ' ', 'g') as idef,
           (x.indisvalid and x.indisready and x.indislive) as ok
    from pg_index x
    join pg_class i on i.oid = x.indexrelid
    join pg_class t on t.oid = x.indrelid
    join pg_namespace n on n.oid = t.relnamespace
    where x.indrelid in (
            'app_private.events'::regclass, 'app_private.event_items'::regclass,
            'app_private.assignments'::regclass, 'app_private.event_planning_receipts'::regclass)
  ) as r on r.tbl = e.tbl and r.iname = e.iname
  where e.iname is null or r.iname is null or r.idef <> e.idef or r.ok is not true;
  if v_missing_cols > 0 then
    raise exception 'PREFLIGHT FALHOU: Matriz de índices das tabelas do domínio diverge do baseline (% divergências).', v_missing_cols
      using errcode = '42P07';
  end if;

  -- 1.5.1 Matriz canônica de triggers (G4): nome, função, habilitação ('O') e pg_get_triggerdef.
  -- Triggers internos de FK (tgisinternal) ficam fora da matriz; triggers extras reprovam.
  select count(*) into v_missing_cols
  from (
    values
      ('app_private.events', 'events_touch_updated_at', 'CREATE TRIGGER events_touch_updated_at BEFORE UPDATE ON app_private.events FOR EACH ROW EXECUTE FUNCTION app_private.touch_updated_at()'),
      ('app_private.event_items', 'ei_touch_updated_at', 'CREATE TRIGGER ei_touch_updated_at BEFORE UPDATE ON app_private.event_items FOR EACH ROW EXECUTE FUNCTION app_private.touch_updated_at()'),
      ('app_private.assignments', 'asg_touch_updated_at', 'CREATE TRIGGER asg_touch_updated_at BEFORE UPDATE ON app_private.assignments FOR EACH ROW EXECUTE FUNCTION app_private.touch_updated_at()')
  ) as e(tbl, tname, tdef)
  full join (
    select n.nspname || '.' || c.relname as tbl, t.tgname::text as tname,
           regexp_replace(pg_get_triggerdef(t.oid), '\s+', ' ', 'g') as tdef,
           (t.tgenabled = 'O') as ok
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where not t.tgisinternal
      and t.tgrelid in (
            'app_private.events'::regclass, 'app_private.event_items'::regclass,
            'app_private.assignments'::regclass, 'app_private.event_planning_receipts'::regclass)
  ) as r on r.tbl = e.tbl and r.tname = e.tname
  where e.tname is null or r.tname is null or r.tdef <> e.tdef or r.ok is not true;
  if v_missing_cols > 0 then
    raise exception 'PREFLIGHT FALHOU: Matriz de triggers das tabelas do domínio diverge do baseline (% divergências).', v_missing_cols
      using errcode = '42P07';
  end if;

  -- 1.6 Ausência estrita de objetos e assinaturas novas do 026
  if to_regprocedure('public.get_event_program(uuid,uuid)') is not null
    or to_regprocedure('public.update_event_item(uuid,uuid,uuid,uuid,text,integer,integer,uuid,uuid,timestamptz)') is not null
    or to_regprocedure('public.remove_event_item(uuid,uuid,uuid,uuid,timestamptz)') is not null
    or to_regprocedure('public.create_event_item(uuid,uuid,uuid,text,text,integer,integer,uuid,uuid,integer)') is not null then
    raise exception 'PREFLIGHT BLOQUEADO: RPCs novas do incremento 026 já detectadas no catálogo.'
      using errcode = '42710';
  end if;

  -- 1.7 Matriz de metadados (G6) das 6 RPCs canônicas do baseline pré-026: overload, pronargs,
  -- pronargdefaults, argumentos e defaults (pg_get_function_arguments), retorno
  -- (pg_get_function_result), proretset, linguagem, volatilidade, prokind, SECURITY DEFINER,
  -- proconfig, proargnames, proallargtypes/proargmodes nulos e owner postgres.
  select count(*) into v_missing_cols
  from (
    values
      ('create_event_item', 'public.create_event_item(uuid,uuid,uuid,text,text,integer,integer,uuid,uuid)', 9, 5,
       'p_church_id uuid, p_command_id uuid, p_event_id uuid, p_title text, p_item_nature text DEFAULT ''liturgical''::text, p_sequence_order integer DEFAULT 1, p_planned_duration_seconds integer DEFAULT 300, p_designated_team_id uuid DEFAULT NULL::uuid, p_nominal_leader_member_id uuid DEFAULT NULL::uuid',
       'TABLE(command_id uuid, action text, church_id uuid, result_entity_id uuid, result_payload jsonb, created_at timestamp with time zone)',
       'v', 'i:p_church_id:uuid,i:p_command_id:uuid,i:p_event_id:uuid,i:p_title:text,i:p_item_nature:text,i:p_sequence_order:integer,i:p_planned_duration_seconds:integer,i:p_designated_team_id:uuid,i:p_nominal_leader_member_id:uuid,t:command_id:uuid,t:action:text,t:church_id:uuid,t:result_entity_id:uuid,t:result_payload:jsonb,t:created_at:timestamp with time zone'),
      ('list_church_events', 'public.list_church_events(uuid,text,integer,integer)', 4, 3,
       'p_church_id uuid, p_status_filter text DEFAULT ''all''::text, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0',
       'TABLE(events jsonb, total_count bigint)',
       's', 'i:p_church_id:uuid,i:p_status_filter:text,i:p_limit:integer,i:p_offset:integer,t:events:jsonb,t:total_count:bigint'),
      ('reorder_event_items', 'public.reorder_event_items(uuid,uuid,uuid,uuid[])', 4, 0,
       'p_church_id uuid, p_command_id uuid, p_event_id uuid, p_ordered_item_ids uuid[]',
       'TABLE(command_id uuid, action text, church_id uuid, result_entity_id uuid, result_payload jsonb, created_at timestamp with time zone)',
       'v', 'i:p_church_id:uuid,i:p_command_id:uuid,i:p_event_id:uuid,i:p_ordered_item_ids:uuid[],t:command_id:uuid,t:action:text,t:church_id:uuid,t:result_entity_id:uuid,t:result_payload:jsonb,t:created_at:timestamp with time zone'),
      ('set_event_duration_policy', 'public.set_event_duration_policy(uuid,uuid,uuid,text)', 4, 0,
       'p_church_id uuid, p_command_id uuid, p_event_id uuid, p_duration_policy text',
       'TABLE(command_id uuid, action text, church_id uuid, result_entity_id uuid, result_payload jsonb, created_at timestamp with time zone)',
       'v', 'i:p_church_id:uuid,i:p_command_id:uuid,i:p_event_id:uuid,i:p_duration_policy:text,t:command_id:uuid,t:action:text,t:church_id:uuid,t:result_entity_id:uuid,t:result_payload:jsonb,t:created_at:timestamp with time zone'),
      ('publish_event_program', 'public.publish_event_program(uuid,uuid,uuid)', 3, 0,
       'p_church_id uuid, p_command_id uuid, p_event_id uuid',
       'TABLE(command_id uuid, action text, church_id uuid, result_entity_id uuid, result_payload jsonb, created_at timestamp with time zone)',
       'v', 'i:p_church_id:uuid,i:p_command_id:uuid,i:p_event_id:uuid,t:command_id:uuid,t:action:text,t:church_id:uuid,t:result_entity_id:uuid,t:result_payload:jsonb,t:created_at:timestamp with time zone'),
      ('save_event_program_draft', 'public.save_event_program_draft(uuid,uuid,uuid)', 3, 0,
       'p_church_id uuid, p_command_id uuid, p_event_id uuid',
       'TABLE(command_id uuid, action text, church_id uuid, result_entity_id uuid, result_payload jsonb, created_at timestamp with time zone)',
       'v', 'i:p_church_id:uuid,i:p_command_id:uuid,i:p_event_id:uuid,t:command_id:uuid,t:action:text,t:church_id:uuid,t:result_entity_id:uuid,t:result_payload:jsonb,t:created_at:timestamp with time zone')
  ) as t(p_name, p_sig, p_nargs, p_ndef, p_args, p_result, p_vol, p_canon)
  left join pg_proc p on p.oid = to_regprocedure(t.p_sig)
  left join pg_language l on l.oid = p.prolang
  where p.oid is null
     or (select count(*) from pg_proc x where x.proname = t.p_name and x.pronamespace = 'public'::regnamespace) <> 1
     or p.pronargs <> t.p_nargs
     or p.pronargdefaults <> t.p_ndef
     or pg_get_function_arguments(p.oid) <> t.p_args
     or pg_get_function_result(p.oid) <> t.p_result
     or p.proretset is not true
     or l.lanname is distinct from 'plpgsql'
     or p.provolatile::text <> t.p_vol
     or p.prokind::text <> 'f'
     or p.prosecdef is not true
     or coalesce((
          select string_agg(
                   coalesce(p.proargmodes[x.k]::text, 'i') || ':' || coalesce(p.proargnames[x.k], '') || ':' || format_type(x.typ, null),
                   ',' order by x.k)
          from unnest(coalesce(p.proallargtypes, p.proargtypes::oid[])) with ordinality as x(typ, k)
        ), '') is distinct from t.p_canon
     or coalesce(cardinality(p.proconfig), 0) <> 2
     or coalesce(p.proconfig @> array['statement_timeout=5s'], false) is not true
     or coalesce(p.proconfig @> array['search_path=""'] or p.proconfig @> array['search_path='], false) is not true
     or p.proowner <> (select oid from pg_roles where rolname = 'postgres');
  if v_missing_cols > 0 then
    raise exception 'PREFLIGHT FALHOU: Matriz de metadados das RPCs do baseline pré-026 diverge (% divergências).', v_missing_cols
      using errcode = '42883';
  end if;

  -- 1.8 Fingerprint canônico (F2) e ACL uniforme (G5) das 6 RPCs do baseline pré-026.
  -- ACL: entrada direta de authenticated com EXECUTE, is_grantable = false e grantor = owner;
  -- nenhum outro grantee (inclusive PUBLIC = 0, anon ou service_role); nenhum privilégio
  -- diferente de EXECUTE; owner aceito apenas como EXECUTE concedido por ele próprio; ACL nula ou vazia rejeitada.
  -- has_function_privilege não é usado como prova de concessão direta.
  for v_rec in
    select * from (
      values
        ('create_event_item', 'public.create_event_item(uuid,uuid,uuid,text,text,integer,integer,uuid,uuid)',
         '63bf49c5e106cb9b15424417967b1b0b7986766ddb690c2c1ab0ace279db73b4', '016_member_lifecycle_effective.sql'),
        ('list_church_events', 'public.list_church_events(uuid,text,integer,integer)',
         'fa36797053c2d1aebbf0da75ee359cd0eedcdbc89b23cee6d8e96074e235e734', '015_liturgical_dependencies.sql'),
        ('reorder_event_items', 'public.reorder_event_items(uuid,uuid,uuid,uuid[])',
         'a0327eace61492b88d7e58e454abbf9ad79e375035828a0d89fcbd39f61da7c4', '025_event_planning_security_hardening.sql'),
        ('set_event_duration_policy', 'public.set_event_duration_policy(uuid,uuid,uuid,text)',
         '0aaa502846b032dece64e494cc7a0e98cefa73a1a864da5b77122890d6b95892', '025_event_planning_security_hardening.sql'),
        ('publish_event_program', 'public.publish_event_program(uuid,uuid,uuid)',
         '54fdbb6e779ba0922edcf41adb5dc269f11c48e88d2f0f34727b0e08d5a23407', '025_event_planning_security_hardening.sql'),
        ('save_event_program_draft', 'public.save_event_program_draft(uuid,uuid,uuid)',
         '401eefea3c2383292b9af888daec5e3764680b1d8a2141543e2da8d5a7676ea6', '025_event_planning_security_hardening.sql')
    ) as t(p_name, p_sig, p_expected_hash, p_source)
  loop
    if exists (
      select 1 from pg_proc p
      where p.oid = to_regprocedure(v_rec.p_sig)
        and (
          p.proacl is null
          or cardinality(p.proacl) = 0
          or p.proowner <> (select oid from pg_roles where rolname = 'postgres')
          or not exists (
            select 1 from aclexplode(p.proacl) ae
            where ae.grantee = (select oid from pg_roles where rolname = 'authenticated')
              and ae.privilege_type = 'EXECUTE'
              and ae.is_grantable = false
              and ae.grantor = p.proowner
          )
          or exists (
            select 1 from aclexplode(p.proacl) ae
            where ae.grantee not in ((select oid from pg_roles where rolname = 'authenticated'), p.proowner)
               or ae.privilege_type <> 'EXECUTE'
               or (ae.grantee = p.proowner and ae.grantor <> p.proowner)
               or (ae.grantee = (select oid from pg_roles where rolname = 'authenticated') and ae.is_grantable)
               or (ae.grantee = (select oid from pg_roles where rolname = 'authenticated') and ae.grantor <> p.proowner)
          )
        )
    ) then
      raise exception 'PREFLIGHT FALHOU: ACL de % viola a política uniforme de allowlist direta do baseline.', v_rec.p_name
        using errcode = '42501';
    end if;

    select encode(pg_catalog.sha256(convert_to(btrim(replace(p.prosrc, E'\r\n', E'\n'), E' \t\r\n'), 'UTF8')), 'hex')
    into v_hash
    from pg_proc p
    where p.oid = to_regprocedure(v_rec.p_sig);

    if v_hash <> v_rec.p_expected_hash then
      raise exception 'PREFLIGHT FALHOU: Fingerprint de % (%) diverge do hash esperado (%) derivado de %.',
        v_rec.p_name, v_hash, v_rec.p_expected_hash, v_rec.p_source
        using errcode = '42883';
    end if;
  end loop;

end;
$preflight$;


-- ------------------------------------------------------------------------------
-- ETAPA 2: DDL EM app_private.event_items
-- ------------------------------------------------------------------------------
alter table app_private.event_items
  add column prep_required_minutes integer not null default 0,
  add constraint ei_prep_minutes_range check (prep_required_minutes >= 0 and prep_required_minutes <= 180),
  add constraint ei_liturgical_prep_zero check (item_nature <> 'liturgical' or prep_required_minutes = 0),
  add constraint ei_sequence_order_positive check (sequence_order >= 1);

-- ------------------------------------------------------------------------------
-- ETAPA 3: NOVA RPC DE LEITURA public.get_event_program
-- ------------------------------------------------------------------------------
create or replace function public.get_event_program(
  p_church_id uuid,
  p_event_id uuid
)
returns table (
  event jsonb,
  items jsonb
)
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '5s'
as $function$
declare
  v_user_id uuid;
  v_caller_member_id uuid;
  v_is_admin boolean;
  v_event app_private.events%rowtype;
  v_liturgy_leader_name text;
  v_event_json jsonb;
  v_items_json jsonb;
begin
  -- 1. Autenticação obrigatória
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  -- 2. Parâmetros obrigatórios
  if p_church_id is null or p_event_id is null then
    raise exception 'Parâmetros obrigatórios ausentes.' using errcode = '22004';
  end if;

  -- 3. Verificação de vínculo ativo do chamador na igreja
  select ca.member_id, coalesce(ca.is_admin, false)
  into v_caller_member_id, v_is_admin
  from app_private.church_access ca
  join auth.users u on u.id = ca.user_id
  join app_private.churches c on c.id = ca.church_id
  join app_private.members m on m.id = ca.member_id and m.church_id = ca.church_id
  where ca.user_id = v_user_id
    and ca.church_id = p_church_id
    and ca.status = 'active'
    and ca.onboarding_completed_at is not null
    and c.status = 'active'
    and m.status = 'active'
    and u.email_confirmed_at is not null
    and u.deleted_at is null
    and not coalesce(u.is_anonymous, false)
    and (u.banned_until is null or u.banned_until <= clock_timestamp());

  if v_caller_member_id is null then
    raise exception 'Usuário sem vínculo ativo com a igreja.' using errcode = '42501';
  end if;

  -- 4. Busca do evento com isolamento estrito por church_id
  select e.*
  into v_event
  from app_private.events e
  where e.church_id = p_church_id
    and e.id = p_event_id;

  if v_event.id is null then
    raise exception 'Evento não encontrado.' using errcode = 'P0002';
  end if;

  -- 4.1 Nome do dirigente de liturgia, consultado somente após o evento existir
  select m.display_name
  into v_liturgy_leader_name
  from app_private.members m
  where m.id = v_event.liturgy_leader_member_id
    and m.church_id = v_event.church_id;

  -- 5. Autorização: Administrador ativo ou líder de liturgia deste evento
  if not (
    coalesce(v_is_admin, false) = true
    or (
      v_event.liturgy_leader_member_id is not null
      and v_event.liturgy_leader_member_id = v_caller_member_id
    )
  ) then
    raise exception 'Permissão insuficiente para visualizar a programação deste evento.' using errcode = '42501';
  end if;

  -- 6. Construção do objeto do evento
  v_event_json := jsonb_build_object(
    'id', v_event.id,
    'church_id', v_event.church_id,
    'title', v_event.title,
    'event_type', v_event.event_type,
    'timezone', v_event.timezone,
    'status', v_event.status,
    'planned_start_at', v_event.planned_start_at,
    'planned_end_at', v_event.planned_end_at,
    'actual_start_at', v_event.actual_start_at,
    'actual_end_at', v_event.actual_end_at,
    'liturgy_leader_member_id', v_event.liturgy_leader_member_id,
    'liturgy_leader_name', v_liturgy_leader_name,
    'version', v_event.version,
    'cancel_reason', v_event.cancel_reason,
    'duration_policy', v_event.duration_policy,
    'program_status', v_event.program_status,
    'program_version', v_event.program_version,
    'published_at', v_event.published_at,
    'published_by_member_id', v_event.published_by_member_id,
    'created_at', v_event.created_at,
    'updated_at', v_event.updated_at
  );

  -- 7. Construção dos itens ordenados por natureza (liturgical primeiro), ordem, criação e id
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', ei.id,
        'church_id', ei.church_id,
        'event_id', ei.event_id,
        'title', ei.title,
        'item_nature', ei.item_nature,
        'sequence_order', ei.sequence_order,
        'planned_duration_seconds', ei.planned_duration_seconds,
        'prep_required_minutes', ei.prep_required_minutes,
        'status', ei.status,
        'designated_team_id', ei.designated_team_id,
        'designated_team_name', t.name,
        'nominal_leader_member_id', ei.nominal_leader_member_id,
        'nominal_leader_name', m.display_name,
        'actual_start_at', ei.actual_start_at,
        'actual_end_at', ei.actual_end_at,
        'cancel_reason', ei.cancel_reason,
        'created_at', ei.created_at,
        'updated_at', ei.updated_at
      )
      order by
        case when ei.item_nature = 'liturgical' then 1 else 2 end,
        ei.sequence_order asc,
        ei.created_at asc,
        ei.id asc
    ),
    '[]'::jsonb
  )
  into v_items_json
  from app_private.event_items ei
  left join app_private.teams t on t.id = ei.designated_team_id and t.church_id = ei.church_id
  left join app_private.members m on m.id = ei.nominal_leader_member_id and m.church_id = ei.church_id
  where ei.church_id = p_church_id
    and ei.event_id = p_event_id;

  return query select v_event_json, v_items_json;
end;
$function$;

-- ------------------------------------------------------------------------------
-- ETAPA 4: EXTENSÃO DE public.list_church_events (PAGINAÇÃO DETERMINÍSTICA C7)
-- ------------------------------------------------------------------------------
create or replace function public.list_church_events(
  p_church_id uuid,
  p_status_filter text default 'all',
  p_limit integer default 20,
  p_offset integer default 0
)
returns table (
  events jsonb,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '5s'
as $function$
declare
  v_user_id uuid;
  v_caller_member_id uuid;
  v_is_admin boolean;
  v_status text;
  v_limit integer;
  v_offset integer;
  v_total bigint;
  v_items jsonb;
begin
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if p_church_id is null then
    raise exception 'Identificador de igreja obrigatório.' using errcode = '22004';
  end if;

  select ca.member_id, ca.is_admin
  into v_caller_member_id, v_is_admin
  from app_private.church_access ca
  join auth.users u on u.id = ca.user_id
  join app_private.churches c on c.id = ca.church_id
  join app_private.members m on m.id = ca.member_id and m.church_id = ca.church_id
  where ca.user_id = v_user_id
    and ca.church_id = p_church_id
    and ca.status = 'active'
    and ca.onboarding_completed_at is not null
    and c.status = 'active'
    and m.status = 'active'
    and u.email_confirmed_at is not null
    and u.deleted_at is null
    and not coalesce(u.is_anonymous, false)
    and (u.banned_until is null or u.banned_until <= clock_timestamp());

  if v_caller_member_id is null then
    raise exception 'Acesso não autorizado nesta igreja.' using errcode = '42501';
  end if;

  v_status := lower(coalesce(btrim(p_status_filter), 'all'));
  if v_status not in ('all', 'scheduled', 'in_progress', 'completed', 'cancelled') then
    raise exception 'Filtro de status inválido.' using errcode = '22000';
  end if;

  v_limit := greatest(1, least(coalesce(p_limit, 20), 100));
  v_offset := greatest(0, coalesce(p_offset, 0));

  select count(*)
  into v_total
  from app_private.events as e
  where e.church_id = p_church_id
    and (v_status = 'all' or e.status = v_status);

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', e.id,
        'church_id', e.church_id,
        'title', e.title,
        'event_type', e.event_type,
        'timezone', e.timezone,
        'status', e.status,
        'planned_start_at', e.planned_start_at,
        'planned_end_at', e.planned_end_at,
        'actual_start_at', e.actual_start_at,
        'actual_end_at', e.actual_end_at,
        'liturgy_leader_member_id', e.liturgy_leader_member_id,
        'liturgy_leader_name', m.display_name,
        'version', e.version,
        'cancel_reason', e.cancel_reason,
        'created_at', e.created_at,
        'updated_at', e.updated_at,
        'program_status', e.program_status,
        'duration_policy', e.duration_policy,
        'program_version', e.program_version,
        'published_at', e.published_at,
        'items_count', (
          select count(*)::integer
          from app_private.event_items ei
          where ei.church_id = e.church_id and ei.event_id = e.id
        )
      ) order by e.planned_start_at desc, e.id desc
    ),
    '[]'::jsonb
  )
  into v_items
  from (
    select e.*
    from app_private.events as e
    where e.church_id = p_church_id
      and (v_status = 'all' or e.status = v_status)
    order by e.planned_start_at desc, e.id desc
    limit v_limit
    offset v_offset
  ) as e
  left join app_private.members as m on m.id = e.liturgy_leader_member_id and m.church_id = e.church_id;

  return query select v_items, v_total;
end;
$function$;

-- ------------------------------------------------------------------------------
-- ETAPA 5: EVOLUÇÃO DE public.create_event_item (COM PREP E DESLOCAMENTO)
-- ------------------------------------------------------------------------------
drop function public.create_event_item(uuid, uuid, uuid, text, text, integer, integer, uuid, uuid);

create or replace function public.create_event_item(
  p_church_id uuid,
  p_command_id uuid,
  p_event_id uuid,
  p_title text,
  p_item_nature text default 'liturgical',
  p_sequence_order integer default 1,
  p_planned_duration_seconds integer default 300,
  p_designated_team_id uuid default null,
  p_nominal_leader_member_id uuid default null,
  p_prep_required_minutes integer default 0
)
returns table (
  command_id uuid,
  action text,
  church_id uuid,
  result_entity_id uuid,
  result_payload jsonb,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $function$
declare
  v_user_id uuid;
  v_preliminary_member_id uuid;
  v_caller_member_id uuid;
  v_is_admin boolean;
  v_event app_private.events%rowtype;
  v_title_clean text;
  v_nature_clean text;
  v_prep_clean integer;
  v_params_hash bytea;
  v_existing_receipt record;
  v_item_id uuid;
  v_payload jsonb;
  v_created_at timestamptz;
  v_persisted_updated_at timestamptz;
  v_current_count integer;
  v_target_order integer;
  c_action constant text := 'create_event_item';
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Esta operação exige READ COMMITTED.' using errcode = '42501';
  end if;

  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if p_church_id is null or p_command_id is null or p_event_id is null or p_title is null then
    raise exception 'Parâmetros obrigatórios ausentes.' using errcode = '22004';
  end if;

  v_title_clean := btrim(normalize(p_title, NFC));
  if char_length(v_title_clean) < 1 or char_length(v_title_clean) > 200 then
    raise exception 'Título do item deve ter entre 1 e 200 caracteres.' using errcode = '22000';
  end if;

  v_nature_clean := lower(coalesce(p_item_nature, 'liturgical'));
  if v_nature_clean not in ('liturgical', 'parallel_support') then
    raise exception 'Natureza do item deve ser liturgical ou parallel_support.' using errcode = '22000';
  end if;

  if coalesce(p_planned_duration_seconds, 0) <= 0 then
    raise exception 'Duração planejada em segundos deve ser maior que zero.' using errcode = '22000';
  end if;

  v_prep_clean := coalesce(p_prep_required_minutes, 0);
  if v_prep_clean < 0 or v_prep_clean > 180 then
    raise exception 'Tempo de preparação deve estar entre 0 e 180 minutos.' using errcode = '22000';
  end if;

  if v_nature_clean = 'liturgical' and v_prep_clean <> 0 then
    raise exception 'Itens litúrgicos não podem ter tempo de preparação.' using errcode = '22000';
  end if;

  -- Checagem preliminar fail-fast
  select ca.member_id, coalesce(ca.is_admin, false)
  into v_preliminary_member_id, v_is_admin
  from app_private.church_access ca
  join auth.users u on u.id = ca.user_id
  join app_private.churches c on c.id = ca.church_id
  join app_private.members m on m.id = ca.member_id and m.church_id = ca.church_id
  where ca.user_id = v_user_id
    and ca.church_id = p_church_id
    and ca.status = 'active'
    and ca.onboarding_completed_at is not null
    and c.status = 'active'
    and m.status = 'active'
    and u.email_confirmed_at is not null
    and u.deleted_at is null
    and not coalesce(u.is_anonymous, false)
    and (u.banned_until is null or u.banned_until <= clock_timestamp());

  if v_preliminary_member_id is null then
    raise exception 'Usuário sem vínculo ativo com a igreja.' using errcode = '42501';
  end if;

  -- 1º: Lock advisory de idempotência de comando
  perform pg_catalog.pg_advisory_xact_lock(hashtext(v_user_id::text), hashtext(p_command_id::text));

  -- Cálculo do hash com compatibilidade estrita para recibos históricos (prep = 0)
  if v_prep_clean = 0 then
    v_params_hash := pg_catalog.sha256(convert_to(jsonb_build_object(
      'action', c_action,
      'church_id', p_church_id,
      'event_id', p_event_id,
      'title', v_title_clean,
      'item_nature', v_nature_clean,
      'sequence_order', p_sequence_order,
      'planned_duration_seconds', p_planned_duration_seconds,
      'designated_team_id', p_designated_team_id,
      'nominal_leader_member_id', p_nominal_leader_member_id
    )::text, 'UTF8'));
  else
    v_params_hash := pg_catalog.sha256(convert_to(jsonb_build_object(
      'action', c_action,
      'church_id', p_church_id,
      'event_id', p_event_id,
      'title', v_title_clean,
      'item_nature', v_nature_clean,
      'sequence_order', p_sequence_order,
      'planned_duration_seconds', p_planned_duration_seconds,
      'designated_team_id', p_designated_team_id,
      'nominal_leader_member_id', p_nominal_leader_member_id,
      'prep_required_minutes', v_prep_clean
    )::text, 'UTF8'));
  end if;

  select cr.command_id, cr.action, cr.church_id, cr.result_entity_id, cr.result_payload, cr.created_at, cr.params_hash
  into v_existing_receipt
  from app_private.command_receipts cr
  where cr.user_id = v_user_id
    and cr.command_id = p_command_id;

  if v_existing_receipt.command_id is not null then
    if v_existing_receipt.action <> c_action or v_existing_receipt.church_id <> p_church_id then
      raise exception 'Identificador de comando já utilizado para outra operação.' using errcode = 'P0020';
    end if;
    if v_existing_receipt.params_hash <> v_params_hash then
      raise exception 'Comando já executado com parâmetros divergentes.' using errcode = 'P0020';
    end if;
  end if;

  -- 2º: Lock Igreja FOR SHARE
  perform 1 from app_private.churches c where c.id = p_church_id and c.status = 'active' for share;
  if not found then
    raise exception 'Igreja inativa ou inexistente.' using errcode = '42501';
  end if;

  -- 3º: Lock Vínculo Acesso FOR SHARE
  select ca.member_id, coalesce(ca.is_admin, false)
  into v_caller_member_id, v_is_admin
  from app_private.church_access ca
  where ca.church_id = p_church_id
    and ca.user_id = v_user_id
    and ca.status = 'active'
    and ca.onboarding_completed_at is not null
  for share;

  if v_caller_member_id is null or v_caller_member_id <> v_preliminary_member_id then
    raise exception 'Vínculo de acesso inativo ou revogado nesta igreja.' using errcode = '42501';
  end if;

  -- 4º: Lock Membro FOR SHARE
  perform 1 from app_private.members m
  where m.church_id = p_church_id and m.id = v_caller_member_id and m.status = 'active'
  for share;
  if not found then
    raise exception 'Membro inativo ou inexistente nesta igreja.' using errcode = '42501';
  end if;

  -- 5º: Lock Auth User FOR SHARE
  perform 1 from auth.users u
  where u.id = v_user_id
    and u.email_confirmed_at is not null
    and u.deleted_at is null
    and not coalesce(u.is_anonymous, false)
    and (u.banned_until is null or u.banned_until <= clock_timestamp())
  for share;
  if not found then
    raise exception 'Conta de usuário inativa, não confirmada ou suspensa.' using errcode = '42501';
  end if;

  -- 6º: Lock Evento FOR UPDATE (serializa mutações concorrentes na programação)
  select * into v_event
  from app_private.events e
  where e.church_id = p_church_id and e.id = p_event_id
  for update;

  if not found then
    raise exception 'Evento não encontrado nesta igreja.' using errcode = 'P0020';
  end if;

  -- Revalidação de autoridade pós-espera de locks
  select ca.member_id, coalesce(ca.is_admin, false)
  into v_caller_member_id, v_is_admin
  from app_private.church_access ca
  join app_private.members m on m.id = ca.member_id and m.church_id = ca.church_id
  join auth.users u on u.id = ca.user_id
  join app_private.churches c on c.id = ca.church_id
  where ca.church_id = p_church_id
    and ca.user_id = v_user_id
    and ca.status = 'active'
    and ca.onboarding_completed_at is not null
    and c.status = 'active'
    and m.status = 'active'
    and u.email_confirmed_at is not null
    and u.deleted_at is null
    and not coalesce(u.is_anonymous, false)
    and (u.banned_until is null or u.banned_until <= clock_timestamp());

  if v_caller_member_id is null then
    raise exception 'Acesso revogado durante a espera pelo evento.' using errcode = '42501';
  end if;

  -- Autoridade exclusiva: Administrador ou Dirigente de Liturgia do evento
  if not (
    coalesce(v_is_admin, false) = true
    or (
      v_event.liturgy_leader_member_id is not null
      and v_event.liturgy_leader_member_id = v_caller_member_id
    )
  ) then
    raise exception 'Apenas o líder de liturgia ou administrador pode criar itens de cronograma.' using errcode = '42501';
  end if;

  -- Devolução de replay após confirmação de autoridade atual
  if v_existing_receipt.command_id is not null then
    return query
    select v_existing_receipt.command_id, v_existing_receipt.action, v_existing_receipt.church_id,
           v_existing_receipt.result_entity_id, v_existing_receipt.result_payload, v_existing_receipt.created_at;
    return;
  end if;

  -- Exigência de evento scheduled e programação draft
  if v_event.status <> 'scheduled' then
    raise exception 'Não é possível adicionar itens a eventos que não estejam agendados.' using errcode = 'P0020';
  end if;

  if v_event.program_status <> 'draft' then
    raise exception 'Não é possível adicionar itens a programações que não estejam em rascunho.' using errcode = 'P0020';
  end if;

  if p_designated_team_id is not null then
    if not exists (
      select 1 from app_private.teams as t
      where t.church_id = p_church_id and t.id = p_designated_team_id and t.status = 'active'
    ) then
      raise exception 'Equipe designada não encontrada ou inativa nesta igreja.' using errcode = 'P0020';
    end if;
  end if;

  if p_nominal_leader_member_id is not null then
    if not exists (
      select 1 from app_private.members as m
      where m.church_id = p_church_id and m.id = p_nominal_leader_member_id and m.status = 'active'
    ) then
      raise exception 'Responsável nominal não encontrado ou inativo nesta igreja.' using errcode = 'P0020';
    end if;
  end if;

  -- Validação de posição entre 1 e n + 1
  select count(*) into v_current_count
  from app_private.event_items ei
  where ei.church_id = p_church_id and ei.event_id = p_event_id and ei.item_nature = v_nature_clean;

  v_target_order := coalesce(p_sequence_order, v_current_count + 1);
  if v_target_order < 1 or v_target_order > v_current_count + 1 then
    raise exception 'Posição inválida. A ordem deve estar entre 1 e %.', v_current_count + 1 using errcode = '22023';
  end if;

  -- Deslocamento determinístico dos itens seguintes da mesma natureza
  if v_target_order <= v_current_count then
    update app_private.event_items ei
    set sequence_order = ei.sequence_order + 1
    where ei.church_id = p_church_id
      and ei.event_id = p_event_id
      and ei.item_nature = v_nature_clean
      and ei.sequence_order >= v_target_order;
  end if;

  -- Inserção do novo item
  insert into app_private.event_items as ei (
    church_id, event_id, title, item_nature, sequence_order,
    planned_duration_seconds, prep_required_minutes,
    designated_team_id, nominal_leader_member_id, status
  ) values (
    p_church_id, p_event_id, v_title_clean, v_nature_clean, v_target_order,
    p_planned_duration_seconds, v_prep_clean,
    p_designated_team_id, p_nominal_leader_member_id, 'pending'
  )
  returning ei.id, ei.created_at, ei.updated_at into v_item_id, v_created_at, v_persisted_updated_at;

  update app_private.events e
  set updated_at = default
  where e.church_id = p_church_id and e.id = p_event_id;

  v_payload := jsonb_build_object(
    'item_id', v_item_id,
    'event_id', p_event_id,
    'title', v_title_clean,
    'item_nature', v_nature_clean,
    'sequence_order', v_target_order,
    'planned_duration_seconds', p_planned_duration_seconds,
    'prep_required_minutes', v_prep_clean,
    'designated_team_id', p_designated_team_id,
    'nominal_leader_member_id', p_nominal_leader_member_id,
    'status', 'pending',
    'updated_at', v_persisted_updated_at
  );

  insert into app_private.audit_entries (
    church_id, action, actor_user_id, actor_source, maintenance_operator,
    target_type, target_id, details, occurred_at
  ) values (
    p_church_id, c_action, v_user_id, 'application', null,
    'event_item', v_item_id, v_payload, v_created_at
  );

  insert into app_private.command_receipts (
    church_id, user_id, command_id, action, params_hash,
    result_member_id, result_entity_id, result_payload, created_at
  ) values (
    p_church_id, v_user_id, p_command_id, c_action, v_params_hash,
    null, v_item_id, v_payload, v_created_at
  );

  return query
  select p_command_id, c_action, p_church_id, v_item_id, v_payload, v_created_at;
end;
$function$;

-- ------------------------------------------------------------------------------
-- ETAPA 6: NOVA RPC DE EDIÇÃO public.update_event_item (C2 + C3)
-- ------------------------------------------------------------------------------
create or replace function public.update_event_item(
  p_church_id uuid,
  p_command_id uuid,
  p_event_id uuid,
  p_item_id uuid,
  p_title text,
  p_planned_duration_seconds integer,
  p_prep_required_minutes integer,
  p_designated_team_id uuid,
  p_nominal_leader_member_id uuid,
  p_expected_updated_at timestamptz
)
returns table (
  command_id uuid,
  action text,
  church_id uuid,
  result_entity_id uuid,
  result_payload jsonb,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $function$
declare
  v_user_id uuid;
  v_preliminary_member_id uuid;
  v_caller_member_id uuid;
  v_is_admin boolean;
  v_event app_private.events%rowtype;
  v_item app_private.event_items%rowtype;
  v_title_clean text;
  v_prep_clean integer;
  v_persisted_updated_at timestamptz;
  v_payload jsonb;
  v_existing_receipt app_private.event_planning_receipts%rowtype;
  v_params_hash jsonb;
  c_action constant text := 'update_event_item';
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Esta operação exige READ COMMITTED.' using errcode = '42501';
  end if;

  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if p_church_id is null or p_command_id is null or p_event_id is null
     or p_item_id is null or p_title is null or p_expected_updated_at is null then
    raise exception 'Parâmetros obrigatórios ausentes.' using errcode = '22004';
  end if;

  v_title_clean := btrim(normalize(p_title, NFC));
  if char_length(v_title_clean) < 1 or char_length(v_title_clean) > 200 then
    raise exception 'Título do item deve ter entre 1 e 200 caracteres.' using errcode = '22000';
  end if;

  if coalesce(p_planned_duration_seconds, 0) <= 0 then
    raise exception 'Duração planejada em segundos deve ser maior que zero.' using errcode = '22000';
  end if;

  v_prep_clean := coalesce(p_prep_required_minutes, 0);
  if v_prep_clean < 0 or v_prep_clean > 180 then
    raise exception 'Tempo de preparação deve estar entre 0 e 180 minutos.' using errcode = '22000';
  end if;

  -- Checagem preliminar fail-fast
  select ca.member_id, coalesce(ca.is_admin, false)
  into v_preliminary_member_id, v_is_admin
  from app_private.church_access ca
  join auth.users u on u.id = ca.user_id
  join app_private.churches c on c.id = ca.church_id
  join app_private.members m on m.id = ca.member_id and m.church_id = ca.church_id
  where ca.church_id = p_church_id
    and ca.user_id = v_user_id
    and ca.status = 'active'
    and ca.onboarding_completed_at is not null
    and c.status = 'active'
    and m.status = 'active'
    and u.email_confirmed_at is not null
    and u.deleted_at is null
    and not coalesce(u.is_anonymous, false)
    and (u.banned_until is null or u.banned_until <= clock_timestamp());

  if v_preliminary_member_id is null then
    raise exception 'Usuário sem vínculo ativo com a igreja.' using errcode = '42501';
  end if;

  v_params_hash := jsonb_build_object(
    'event_id', p_event_id,
    'item_id', p_item_id,
    'title', v_title_clean,
    'planned_duration_seconds', p_planned_duration_seconds,
    'prep_required_minutes', v_prep_clean,
    'designated_team_id', p_designated_team_id,
    'nominal_leader_member_id', p_nominal_leader_member_id,
    'expected_updated_at', p_expected_updated_at
  );

  -- 1º: Lock advisory de idempotência
  perform pg_catalog.pg_advisory_xact_lock(hashtext(v_user_id::text), hashtext(p_command_id::text));

  select r.* into v_existing_receipt
  from app_private.event_planning_receipts r
  where r.user_id = v_user_id and r.command_id = p_command_id;

  if found then
    if v_existing_receipt.church_id <> p_church_id
       or v_existing_receipt.action <> c_action
       or v_existing_receipt.params <> v_params_hash then
      raise exception 'Comando já utilizado com outros parâmetros.' using errcode = '23505';
    end if;
  end if;

  -- 2º: Lock Igreja FOR SHARE
  perform 1 from app_private.churches c where c.id = p_church_id and c.status = 'active' for share;
  if not found then
    raise exception 'Igreja inativa ou inexistente.' using errcode = '42501';
  end if;

  -- 3º: Lock Acesso FOR SHARE
  select ca.member_id, coalesce(ca.is_admin, false)
  into v_caller_member_id, v_is_admin
  from app_private.church_access ca
  where ca.church_id = p_church_id
    and ca.user_id = v_user_id
    and ca.status = 'active'
    and ca.onboarding_completed_at is not null
  for share;

  if v_caller_member_id is null or v_caller_member_id <> v_preliminary_member_id then
    raise exception 'Vínculo de acesso inativo ou revogado nesta igreja.' using errcode = '42501';
  end if;

  -- 4º: Lock Membro FOR SHARE
  perform 1 from app_private.members m
  where m.church_id = p_church_id and m.id = v_caller_member_id and m.status = 'active'
  for share;
  if not found then
    raise exception 'Membro inativo ou inexistente nesta igreja.' using errcode = '42501';
  end if;

  -- 5º: Lock Auth User FOR SHARE
  perform 1 from auth.users u
  where u.id = v_user_id
    and u.email_confirmed_at is not null
    and u.deleted_at is null
    and not coalesce(u.is_anonymous, false)
    and (u.banned_until is null or u.banned_until <= clock_timestamp())
  for share;
  if not found then
    raise exception 'Conta de usuário inativa, não confirmada ou suspensa.' using errcode = '42501';
  end if;

  -- 6º: Lock Evento FOR UPDATE
  select * into v_event
  from app_private.events e
  where e.church_id = p_church_id and e.id = p_event_id
  for update;

  if not found then
    raise exception 'Evento não encontrado.' using errcode = 'P0002';
  end if;

  -- Revalidação de autoridade pós-espera de locks
  select ca.member_id, coalesce(ca.is_admin, false)
  into v_caller_member_id, v_is_admin
  from app_private.church_access ca
  join app_private.members m on m.id = ca.member_id and m.church_id = ca.church_id
  join auth.users u on u.id = ca.user_id
  join app_private.churches c on c.id = ca.church_id
  where ca.church_id = p_church_id
    and ca.user_id = v_user_id
    and ca.status = 'active'
    and ca.onboarding_completed_at is not null
    and c.status = 'active'
    and m.status = 'active'
    and u.email_confirmed_at is not null
    and u.deleted_at is null
    and not coalesce(u.is_anonymous, false)
    and (u.banned_until is null or u.banned_until <= clock_timestamp());

  if v_caller_member_id is null then
    raise exception 'Acesso revogado durante a espera pelo evento.' using errcode = '42501';
  end if;

  if not (
    coalesce(v_is_admin, false) = true
    or (
      v_event.liturgy_leader_member_id is not null
      and v_event.liturgy_leader_member_id = v_caller_member_id
    )
  ) then
    raise exception 'Permissão insuficiente para editar itens deste evento.' using errcode = '42501';
  end if;

  -- PROTOCOLO C2: Replay devolvido aqui após revalidação de autoridade, sem exigir existência do item
  if v_existing_receipt.command_id is not null then
    return query select
      p_command_id,
      c_action,
      p_church_id,
      (v_existing_receipt.result->>'item_id')::uuid,
      v_existing_receipt.result,
      v_existing_receipt.created_at;
    return;
  end if;

  -- Somente em comando novo localizar e bloquear o item (7º lock)
  select * into v_item
  from app_private.event_items ei
  where ei.church_id = p_church_id and ei.event_id = p_event_id and ei.id = p_item_id
  for update;

  if not found then
    raise exception 'Item não encontrado neste evento.' using errcode = 'P0002';
  end if;

  -- Pré-condições de estado
  if v_event.status <> 'scheduled' or v_event.program_status <> 'draft' then
    raise exception 'Edição permitida apenas para eventos agendados com programação em rascunho.' using errcode = 'P0020';
  end if;

  if v_item.status <> 'pending' then
    raise exception 'Apenas itens pendentes podem ser editados.' using errcode = 'P0020';
  end if;

  -- Concorrência otimista (conflito 40001)
  if v_item.updated_at <> p_expected_updated_at then
    raise exception 'Conflito de concorrência: o item foi alterado por outro usuário.' using errcode = '40001';
  end if;

  -- Validação de item litúrgico vs preparação
  if v_item.item_nature = 'liturgical' and v_prep_clean <> 0 then
    raise exception 'Itens litúrgicos não podem ter tempo de preparação.' using errcode = '22000';
  end if;

  if p_designated_team_id is not null then
    if not exists (
      select 1 from app_private.teams t
      where t.church_id = p_church_id and t.id = p_designated_team_id and t.status = 'active'
    ) then
      raise exception 'Equipe designada não encontrada ou inativa nesta igreja.' using errcode = 'P0020';
    end if;
  end if;

  if p_nominal_leader_member_id is not null then
    if not exists (
      select 1 from app_private.members m
      where m.church_id = p_church_id and m.id = p_nominal_leader_member_id and m.status = 'active'
    ) then
      raise exception 'Responsável nominal não encontrado ou inativo nesta igreja.' using errcode = 'P0020';
    end if;
  end if;

  -- PROTOCOLO C3: Atualização deixando o trigger determinar updated_at e capturando com RETURNING
  update app_private.event_items ei
  set title = v_title_clean,
      planned_duration_seconds = p_planned_duration_seconds,
      prep_required_minutes = v_prep_clean,
      designated_team_id = p_designated_team_id,
      nominal_leader_member_id = p_nominal_leader_member_id
  where ei.church_id = p_church_id and ei.event_id = p_event_id and ei.id = p_item_id
  returning ei.updated_at into v_persisted_updated_at;

  update app_private.events e
  set updated_at = default
  where e.church_id = p_church_id and e.id = p_event_id;

  v_payload := jsonb_build_object(
    'item_id', p_item_id,
    'event_id', p_event_id,
    'before', jsonb_build_object(
      'title', v_item.title,
      'planned_duration_seconds', v_item.planned_duration_seconds,
      'prep_required_minutes', v_item.prep_required_minutes,
      'designated_team_id', v_item.designated_team_id,
      'nominal_leader_member_id', v_item.nominal_leader_member_id,
      'updated_at', v_item.updated_at
    ),
    'after', jsonb_build_object(
      'title', v_title_clean,
      'planned_duration_seconds', p_planned_duration_seconds,
      'prep_required_minutes', v_prep_clean,
      'designated_team_id', p_designated_team_id,
      'nominal_leader_member_id', p_nominal_leader_member_id,
      'updated_at', v_persisted_updated_at
    )
  );

  insert into app_private.event_planning_receipts (
    user_id, command_id, church_id, action, params, result, created_at
  ) values (
    v_user_id, p_command_id, p_church_id, c_action, v_params_hash, v_payload, v_persisted_updated_at
  );

  insert into app_private.audit_entries (
    church_id, action, actor_user_id, actor_source, target_type, target_id, details, occurred_at
  ) values (
    p_church_id, c_action, v_user_id, 'application', 'event_item', p_item_id, v_payload, v_persisted_updated_at
  );

  return query select
    p_command_id,
    c_action,
    p_church_id,
    p_item_id,
    v_payload,
    v_persisted_updated_at;
end;
$function$;

-- ------------------------------------------------------------------------------
-- ETAPA 7: NOVA RPC DE REMOÇÃO public.remove_event_item (C1 + C2)
-- ------------------------------------------------------------------------------
create or replace function public.remove_event_item(
  p_church_id uuid,
  p_command_id uuid,
  p_event_id uuid,
  p_item_id uuid,
  p_expected_updated_at timestamptz
)
returns table (
  command_id uuid,
  action text,
  church_id uuid,
  result_entity_id uuid,
  result_payload jsonb,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $function$
declare
  v_user_id uuid;
  v_preliminary_member_id uuid;
  v_caller_member_id uuid;
  v_is_admin boolean;
  v_event app_private.events%rowtype;
  v_item app_private.event_items%rowtype;
  v_created_at timestamptz;
  v_payload jsonb;
  v_deleted_snapshot jsonb;
  v_existing_receipt app_private.event_planning_receipts%rowtype;
  v_params_hash jsonb;
  c_action constant text := 'remove_event_item';
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Esta operação exige READ COMMITTED.' using errcode = '42501';
  end if;

  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if p_church_id is null or p_command_id is null or p_event_id is null
     or p_item_id is null or p_expected_updated_at is null then
    raise exception 'Parâmetros obrigatórios ausentes.' using errcode = '22004';
  end if;

  -- Checagem preliminar fail-fast
  select ca.member_id, coalesce(ca.is_admin, false)
  into v_preliminary_member_id, v_is_admin
  from app_private.church_access ca
  join auth.users u on u.id = ca.user_id
  join app_private.churches c on c.id = ca.church_id
  join app_private.members m on m.id = ca.member_id and m.church_id = ca.church_id
  where ca.church_id = p_church_id
    and ca.user_id = v_user_id
    and ca.status = 'active'
    and ca.onboarding_completed_at is not null
    and c.status = 'active'
    and m.status = 'active'
    and u.email_confirmed_at is not null
    and u.deleted_at is null
    and not coalesce(u.is_anonymous, false)
    and (u.banned_until is null or u.banned_until <= clock_timestamp());

  if v_preliminary_member_id is null then
    raise exception 'Usuário sem vínculo ativo com a igreja.' using errcode = '42501';
  end if;

  v_params_hash := jsonb_build_object(
    'event_id', p_event_id,
    'item_id', p_item_id,
    'expected_updated_at', p_expected_updated_at
  );

  -- 1º: Lock advisory de idempotência
  perform pg_catalog.pg_advisory_xact_lock(hashtext(v_user_id::text), hashtext(p_command_id::text));

  select r.* into v_existing_receipt
  from app_private.event_planning_receipts r
  where r.user_id = v_user_id and r.command_id = p_command_id;

  if found then
    if v_existing_receipt.church_id <> p_church_id
       or v_existing_receipt.action <> c_action
       or v_existing_receipt.params <> v_params_hash then
      raise exception 'Comando já utilizado com outros parâmetros.' using errcode = '23505';
    end if;
  end if;

  -- 2º: Lock Igreja FOR SHARE
  perform 1 from app_private.churches c where c.id = p_church_id and c.status = 'active' for share;
  if not found then
    raise exception 'Igreja inativa ou inexistente.' using errcode = '42501';
  end if;

  -- 3º: Lock Acesso FOR SHARE
  select ca.member_id, coalesce(ca.is_admin, false)
  into v_caller_member_id, v_is_admin
  from app_private.church_access ca
  where ca.church_id = p_church_id
    and ca.user_id = v_user_id
    and ca.status = 'active'
    and ca.onboarding_completed_at is not null
  for share;

  if v_caller_member_id is null or v_caller_member_id <> v_preliminary_member_id then
    raise exception 'Vínculo de acesso inativo ou revogado nesta igreja.' using errcode = '42501';
  end if;

  -- 4º: Lock Membro FOR SHARE
  perform 1 from app_private.members m
  where m.church_id = p_church_id and m.id = v_caller_member_id and m.status = 'active'
  for share;
  if not found then
    raise exception 'Membro inativo ou inexistente nesta igreja.' using errcode = '42501';
  end if;

  -- 5º: Lock Auth User FOR SHARE
  perform 1 from auth.users u
  where u.id = v_user_id
    and u.email_confirmed_at is not null
    and u.deleted_at is null
    and not coalesce(u.is_anonymous, false)
    and (u.banned_until is null or u.banned_until <= clock_timestamp())
  for share;
  if not found then
    raise exception 'Conta de usuário inativa, não confirmada ou suspensa.' using errcode = '42501';
  end if;

  -- 6º: Lock Evento FOR UPDATE
  select * into v_event
  from app_private.events e
  where e.church_id = p_church_id and e.id = p_event_id
  for update;

  if not found then
    raise exception 'Evento não encontrado.' using errcode = 'P0002';
  end if;

  -- Revalidação de autoridade pós-espera de locks
  select ca.member_id, coalesce(ca.is_admin, false)
  into v_caller_member_id, v_is_admin
  from app_private.church_access ca
  join app_private.members m on m.id = ca.member_id and m.church_id = ca.church_id
  join auth.users u on u.id = ca.user_id
  join app_private.churches c on c.id = ca.church_id
  where ca.church_id = p_church_id
    and ca.user_id = v_user_id
    and ca.status = 'active'
    and ca.onboarding_completed_at is not null
    and c.status = 'active'
    and m.status = 'active'
    and u.email_confirmed_at is not null
    and u.deleted_at is null
    and not coalesce(u.is_anonymous, false)
    and (u.banned_until is null or u.banned_until <= clock_timestamp());

  if v_caller_member_id is null then
    raise exception 'Acesso revogado durante a espera pelo evento.' using errcode = '42501';
  end if;

  if not (
    coalesce(v_is_admin, false) = true
    or (
      v_event.liturgy_leader_member_id is not null
      and v_event.liturgy_leader_member_id = v_caller_member_id
    )
  ) then
    raise exception 'Permissão insuficiente para remover itens deste evento.' using errcode = '42501';
  end if;

  -- PROTOCOLO C2: Replay seguro após autoridade confirmada, permitindo retorno de item já excluído
  if v_existing_receipt.command_id is not null then
    return query select
      p_command_id,
      c_action,
      p_church_id,
      (v_existing_receipt.result->>'item_id')::uuid,
      v_existing_receipt.result,
      v_existing_receipt.created_at;
    return;
  end if;

  -- Somente em comando novo localizar e bloquear o item (7º lock)
  select * into v_item
  from app_private.event_items ei
  where ei.church_id = p_church_id and ei.event_id = p_event_id and ei.id = p_item_id
  for update;

  if not found then
    raise exception 'Item não encontrado neste evento.' using errcode = 'P0002';
  end if;

  -- Pré-condições de estado
  if v_event.status <> 'scheduled' or v_event.program_status <> 'draft' then
    raise exception 'Remoção permitida apenas para eventos agendados com programação em rascunho.' using errcode = 'P0020';
  end if;

  if v_item.status <> 'pending' then
    raise exception 'Apenas itens pendentes podem ser removidos.' using errcode = 'P0020';
  end if;

  -- Concorrência otimista (conflito 40001)
  if v_item.updated_at <> p_expected_updated_at then
    raise exception 'Conflito de concorrência: o item foi alterado por outro usuário.' using errcode = '40001';
  end if;

  -- PROTOCOLO C1: Bloqueio estrito se houver escalações vinculadas via coluna canônica assignments.item_id
  if exists (
    select 1 from app_private.assignments a
    where a.church_id = p_church_id and a.item_id = p_item_id
  ) then
    raise exception 'Não é possível remover item com escalações vinculadas. Desfaça as escalas antes.' using errcode = 'P0020';
  end if;

  v_deleted_snapshot := jsonb_build_object(
    'id', v_item.id,
    'title', v_item.title,
    'item_nature', v_item.item_nature,
    'sequence_order', v_item.sequence_order,
    'planned_duration_seconds', v_item.planned_duration_seconds,
    'prep_required_minutes', v_item.prep_required_minutes,
    'designated_team_id', v_item.designated_team_id,
    'nominal_leader_member_id', v_item.nominal_leader_member_id,
    'status', v_item.status
  );

  v_created_at := clock_timestamp();

  -- Remoção física do item
  delete from app_private.event_items ei
  where ei.church_id = p_church_id and ei.event_id = p_event_id and ei.id = p_item_id;

  -- Renumeração contígua dos itens restantes da mesma natureza (1..n)
  with ranked as (
    select ri.id, row_number() over (order by ri.sequence_order, ri.created_at, ri.id) as new_order
    from app_private.event_items ri
    where ri.church_id = p_church_id and ri.event_id = p_event_id and ri.item_nature = v_item.item_nature
  )
  update app_private.event_items ei
  set sequence_order = ranked.new_order
  from ranked
  where ei.id = ranked.id
    and ei.sequence_order <> ranked.new_order;

  update app_private.events e
  set updated_at = default
  where e.church_id = p_church_id and e.id = p_event_id;

  v_payload := jsonb_build_object(
    'item_id', p_item_id,
    'event_id', p_event_id,
    'deleted_item', v_deleted_snapshot
  );

  insert into app_private.event_planning_receipts (
    user_id, command_id, church_id, action, params, result, created_at
  ) values (
    v_user_id, p_command_id, p_church_id, c_action, v_params_hash, v_payload, v_created_at
  );

  insert into app_private.audit_entries (
    church_id, action, actor_user_id, actor_source, target_type, target_id, details, occurred_at
  ) values (
    p_church_id, c_action, v_user_id, 'application', 'event_item', p_item_id, v_payload, v_created_at
  );

  return query select
    p_command_id,
    c_action,
    p_church_id,
    p_item_id,
    v_payload,
    v_created_at;
end;
$function$;

-- ------------------------------------------------------------------------------
-- ETAPA 8: ENDURECIMENTO DAS 4 RPCs EXISTENTES DO SQL 025
-- ------------------------------------------------------------------------------

-- 8.1 public.reorder_event_items
create or replace function public.reorder_event_items(
  p_church_id uuid,
  p_command_id uuid,
  p_event_id uuid,
  p_ordered_item_ids uuid[]
)
returns table (
  command_id uuid,
  action text,
  church_id uuid,
  result_entity_id uuid,
  result_payload jsonb,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $function$
declare
  v_user_id uuid;
  v_preliminary_member_id uuid;
  v_caller_member_id uuid;
  v_is_admin boolean;
  v_event app_private.events%rowtype;
  v_item_id uuid;
  v_order integer := 1;
  v_created_at timestamptz;
  v_payload jsonb;
  v_existing_receipt app_private.event_planning_receipts%rowtype;
  v_params_hash jsonb;
  v_items_count integer;
  v_matching_items_count integer;
  v_nature_count integer;
  v_single_nature text;
  v_non_pending_count integer;
  v_total_nature_items integer;
  c_action constant text := 'reorder_event_items';
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Esta operação exige READ COMMITTED.' using errcode = '42501';
  end if;

  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if p_church_id is null or p_command_id is null or p_event_id is null or p_ordered_item_ids is null then
    raise exception 'Parâmetros obrigatórios ausentes.' using errcode = '22004';
  end if;

  if array_position(p_ordered_item_ids, null) is not null then
    raise exception 'Lista de itens ordenada não pode conter valores nulos.' using errcode = '22023';
  end if;

  v_items_count := coalesce(cardinality(p_ordered_item_ids), 0);
  if v_items_count = 0 then
    raise exception 'Lista de itens ordenada não pode ser vazia.' using errcode = '22023';
  end if;

  -- Checagem preliminar fail-fast
  select ca.member_id, coalesce(ca.is_admin, false)
  into v_preliminary_member_id, v_is_admin
  from app_private.church_access ca
  join auth.users u on u.id = ca.user_id
  join app_private.churches c on c.id = ca.church_id
  join app_private.members m on m.id = ca.member_id and m.church_id = ca.church_id
  where ca.church_id = p_church_id
    and ca.user_id = v_user_id
    and ca.status = 'active'
    and ca.onboarding_completed_at is not null
    and c.status = 'active'
    and m.status = 'active'
    and u.email_confirmed_at is not null
    and u.deleted_at is null
    and not coalesce(u.is_anonymous, false)
    and (u.banned_until is null or u.banned_until <= clock_timestamp());

  if v_preliminary_member_id is null then
    raise exception 'Usuário sem vínculo ativo com a igreja.' using errcode = '42501';
  end if;

  v_params_hash := jsonb_build_object(
    'event_id', p_event_id,
    'ordered_item_ids', to_jsonb(p_ordered_item_ids)
  );

  -- 1º: Advisory lock de comando
  perform pg_catalog.pg_advisory_xact_lock(hashtext(v_user_id::text), hashtext(p_command_id::text));

  select r.* into v_existing_receipt
  from app_private.event_planning_receipts r
  where r.user_id = v_user_id and r.command_id = p_command_id;

  if found then
    if v_existing_receipt.church_id <> p_church_id
       or v_existing_receipt.action <> c_action
       or v_existing_receipt.params <> v_params_hash then
      raise exception 'Comando já utilizado com outros parâmetros.' using errcode = '23505';
    end if;
  end if;

  -- 2º: Lock Igreja FOR SHARE
  perform 1 from app_private.churches c where c.id = p_church_id and c.status = 'active' for share;
  if not found then
    raise exception 'Igreja inativa ou inexistente.' using errcode = '42501';
  end if;

  -- 3º: Lock Acesso FOR SHARE
  select ca.member_id, coalesce(ca.is_admin, false)
  into v_caller_member_id, v_is_admin
  from app_private.church_access ca
  where ca.church_id = p_church_id
    and ca.user_id = v_user_id
    and ca.status = 'active'
    and ca.onboarding_completed_at is not null
  for share;

  if v_caller_member_id is null or v_caller_member_id <> v_preliminary_member_id then
    raise exception 'Vínculo de acesso inativo ou revogado nesta igreja.' using errcode = '42501';
  end if;

  -- 4º: Lock Membro FOR SHARE
  perform 1 from app_private.members m
  where m.church_id = p_church_id and m.id = v_caller_member_id and m.status = 'active'
  for share;
  if not found then
    raise exception 'Membro inativo ou inexistente nesta igreja.' using errcode = '42501';
  end if;

  -- 5º: Lock Auth User FOR SHARE
  perform 1 from auth.users u
  where u.id = v_user_id
    and u.email_confirmed_at is not null
    and u.deleted_at is null
    and not coalesce(u.is_anonymous, false)
    and (u.banned_until is null or u.banned_until <= clock_timestamp())
  for share;
  if not found then
    raise exception 'Conta de usuário inativa, não confirmada ou suspensa.' using errcode = '42501';
  end if;

  -- 6º: Lock Evento FOR UPDATE
  select * into v_event
  from app_private.events e
  where e.church_id = p_church_id and e.id = p_event_id
  for update;

  if not found then
    raise exception 'Evento não encontrado.' using errcode = 'P0002';
  end if;

  -- Revalidação de autoridade pós-espera de locks
  select ca.member_id, coalesce(ca.is_admin, false)
  into v_caller_member_id, v_is_admin
  from app_private.church_access ca
  join app_private.members m on m.id = ca.member_id and m.church_id = ca.church_id
  join auth.users u on u.id = ca.user_id
  join app_private.churches c on c.id = ca.church_id
  where ca.church_id = p_church_id
    and ca.user_id = v_user_id
    and ca.status = 'active'
    and ca.onboarding_completed_at is not null
    and c.status = 'active'
    and m.status = 'active'
    and u.email_confirmed_at is not null
    and u.deleted_at is null
    and not coalesce(u.is_anonymous, false)
    and (u.banned_until is null or u.banned_until <= clock_timestamp());

  if v_caller_member_id is null then
    raise exception 'Acesso revogado durante a espera pelo evento.' using errcode = '42501';
  end if;

  if not (
    coalesce(v_is_admin, false) = true
    or (
      v_event.liturgy_leader_member_id is not null
      and v_event.liturgy_leader_member_id = v_caller_member_id
    )
  ) then
    raise exception 'Permissão insuficiente para reordenar este evento.' using errcode = '42501';
  end if;

  if v_existing_receipt.command_id is not null then
    return query select
      p_command_id,
      c_action,
      p_church_id,
      (v_existing_receipt.result->>'event_id')::uuid,
      v_existing_receipt.result,
      v_existing_receipt.created_at;
    return;
  end if;

  -- Exigência estrita: scheduled + draft
  if v_event.status <> 'scheduled' or v_event.program_status <> 'draft' then
    raise exception 'Reordenação permitida apenas para eventos agendados com programação em rascunho.' using errcode = 'P0020';
  end if;

  -- Validação de integridade: pertencimento, unicidade da natureza, status pending e lista completa
  select
    count(distinct ei.id),
    count(distinct ei.item_nature),
    min(ei.item_nature),
    count(*) filter (where ei.status <> 'pending')
  into
    v_matching_items_count,
    v_nature_count,
    v_single_nature,
    v_non_pending_count
  from app_private.event_items ei
  where ei.church_id = p_church_id
    and ei.event_id = p_event_id
    and ei.id = any(p_ordered_item_ids);

  if v_matching_items_count <> v_items_count then
    raise exception 'Um ou mais itens não pertencem a este evento ou foram informados em duplicidade.' using errcode = '22023';
  end if;

  if v_nature_count <> 1 then
    raise exception 'A reordenação deve contemplar itens de uma única natureza por operação.' using errcode = '22023';
  end if;

  if v_non_pending_count > 0 then
    raise exception 'Apenas itens pendentes podem ser reordenados.' using errcode = 'P0020';
  end if;

  select count(*) into v_total_nature_items
  from app_private.event_items ei
  where ei.church_id = p_church_id
    and ei.event_id = p_event_id
    and ei.item_nature = v_single_nature;

  if v_matching_items_count <> v_total_nature_items then
    raise exception 'A lista de reordenação deve conter a totalidade dos itens da mesma natureza.' using errcode = '22023';
  end if;

  v_created_at := clock_timestamp();

  foreach v_item_id in array p_ordered_item_ids
  loop
    update app_private.event_items ei
    set sequence_order = v_order
    where ei.church_id = p_church_id
      and ei.event_id = p_event_id
      and ei.id = v_item_id;
    v_order := v_order + 1;
  end loop;

  update app_private.events e
  set updated_at = default
  where e.church_id = p_church_id and e.id = p_event_id;

  v_payload := jsonb_build_object(
    'event_id', p_event_id,
    'item_nature', v_single_nature,
    'total_items_reordered', v_items_count
  );

  insert into app_private.event_planning_receipts (
    user_id, command_id, church_id, action, params, result, created_at
  ) values (
    v_user_id, p_command_id, p_church_id, c_action, v_params_hash, v_payload, v_created_at
  );

  insert into app_private.audit_entries (
    church_id, action, actor_user_id, actor_source, target_type, target_id, details, occurred_at
  ) values (
    p_church_id, c_action, v_user_id, 'application', 'events', p_event_id, v_payload, v_created_at
  );

  return query select
    p_command_id,
    c_action,
    p_church_id,
    p_event_id,
    v_payload,
    v_created_at;
end;
$function$;

-- 8.2 public.set_event_duration_policy
create or replace function public.set_event_duration_policy(
  p_church_id uuid,
  p_command_id uuid,
  p_event_id uuid,
  p_duration_policy text
)
returns table (
  command_id uuid,
  action text,
  church_id uuid,
  result_entity_id uuid,
  result_payload jsonb,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $function$
declare
  v_user_id uuid;
  v_preliminary_member_id uuid;
  v_caller_member_id uuid;
  v_is_admin boolean;
  v_event app_private.events%rowtype;
  v_policy_clean text;
  v_created_at timestamptz;
  v_payload jsonb;
  v_existing_receipt app_private.event_planning_receipts%rowtype;
  v_params_hash jsonb;
  c_action constant text := 'set_event_duration_policy';
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Esta operação exige READ COMMITTED.' using errcode = '42501';
  end if;

  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if p_church_id is null or p_command_id is null or p_event_id is null or p_duration_policy is null then
    raise exception 'Parâmetros obrigatórios ausentes.' using errcode = '22004';
  end if;

  v_policy_clean := lower(btrim(p_duration_policy));
  if v_policy_clean not in ('warn', 'block') then
    raise exception 'Política de duração inválida. Valores aceitos: warn, block.' using errcode = '22000';
  end if;

  -- Checagem preliminar fail-fast
  select ca.member_id, coalesce(ca.is_admin, false)
  into v_preliminary_member_id, v_is_admin
  from app_private.church_access ca
  join auth.users u on u.id = ca.user_id
  join app_private.churches c on c.id = ca.church_id
  join app_private.members m on m.id = ca.member_id and m.church_id = ca.church_id
  where ca.church_id = p_church_id
    and ca.user_id = v_user_id
    and ca.status = 'active'
    and ca.onboarding_completed_at is not null
    and c.status = 'active'
    and m.status = 'active'
    and u.email_confirmed_at is not null
    and u.deleted_at is null
    and not coalesce(u.is_anonymous, false)
    and (u.banned_until is null or u.banned_until <= clock_timestamp());

  if v_preliminary_member_id is null then
    raise exception 'Usuário sem vínculo ativo com a igreja.' using errcode = '42501';
  end if;

  v_params_hash := jsonb_build_object(
    'event_id', p_event_id,
    'duration_policy', v_policy_clean
  );

  -- 1º: Advisory lock de comando
  perform pg_catalog.pg_advisory_xact_lock(hashtext(v_user_id::text), hashtext(p_command_id::text));

  select r.* into v_existing_receipt
  from app_private.event_planning_receipts r
  where r.user_id = v_user_id and r.command_id = p_command_id;

  if found then
    if v_existing_receipt.church_id <> p_church_id
       or v_existing_receipt.action <> c_action
       or v_existing_receipt.params <> v_params_hash then
      raise exception 'Comando já utilizado com outros parâmetros.' using errcode = '23505';
    end if;
  end if;

  -- 2º: Lock Igreja FOR SHARE
  perform 1 from app_private.churches c where c.id = p_church_id and c.status = 'active' for share;
  if not found then
    raise exception 'Igreja inativa ou inexistente.' using errcode = '42501';
  end if;

  -- 3º: Lock Acesso FOR SHARE
  select ca.member_id, coalesce(ca.is_admin, false)
  into v_caller_member_id, v_is_admin
  from app_private.church_access ca
  where ca.church_id = p_church_id
    and ca.user_id = v_user_id
    and ca.status = 'active'
    and ca.onboarding_completed_at is not null
  for share;

  if v_caller_member_id is null or v_caller_member_id <> v_preliminary_member_id then
    raise exception 'Vínculo de acesso inativo ou revogado nesta igreja.' using errcode = '42501';
  end if;

  -- 4º: Lock Membro FOR SHARE
  perform 1 from app_private.members m
  where m.church_id = p_church_id and m.id = v_caller_member_id and m.status = 'active'
  for share;
  if not found then
    raise exception 'Membro inativo ou inexistente nesta igreja.' using errcode = '42501';
  end if;

  -- 5º: Lock Auth User FOR SHARE
  perform 1 from auth.users u
  where u.id = v_user_id
    and u.email_confirmed_at is not null
    and u.deleted_at is null
    and not coalesce(u.is_anonymous, false)
    and (u.banned_until is null or u.banned_until <= clock_timestamp())
  for share;
  if not found then
    raise exception 'Conta de usuário inativa, não confirmada ou suspensa.' using errcode = '42501';
  end if;

  -- 6º: Lock Evento FOR UPDATE
  select * into v_event
  from app_private.events e
  where e.church_id = p_church_id and e.id = p_event_id
  for update;

  if not found then
    raise exception 'Evento não encontrado.' using errcode = 'P0002';
  end if;

  -- Revalidação de autoridade pós-espera de locks
  select ca.member_id, coalesce(ca.is_admin, false)
  into v_caller_member_id, v_is_admin
  from app_private.church_access ca
  join app_private.members m on m.id = ca.member_id and m.church_id = ca.church_id
  join auth.users u on u.id = ca.user_id
  join app_private.churches c on c.id = ca.church_id
  where ca.church_id = p_church_id
    and ca.user_id = v_user_id
    and ca.status = 'active'
    and ca.onboarding_completed_at is not null
    and c.status = 'active'
    and m.status = 'active'
    and u.email_confirmed_at is not null
    and u.deleted_at is null
    and not coalesce(u.is_anonymous, false)
    and (u.banned_until is null or u.banned_until <= clock_timestamp());

  if v_caller_member_id is null then
    raise exception 'Acesso revogado durante a espera pelo evento.' using errcode = '42501';
  end if;

  if not (
    coalesce(v_is_admin, false) = true
    or (
      v_event.liturgy_leader_member_id is not null
      and v_event.liturgy_leader_member_id = v_caller_member_id
    )
  ) then
    raise exception 'Permissão insuficiente para alterar a política de duração.' using errcode = '42501';
  end if;

  if v_existing_receipt.command_id is not null then
    return query select
      p_command_id,
      c_action,
      p_church_id,
      (v_existing_receipt.result->>'event_id')::uuid,
      v_existing_receipt.result,
      v_existing_receipt.created_at;
    return;
  end if;

  -- Exigência estrita: scheduled + draft
  if v_event.status <> 'scheduled' or v_event.program_status <> 'draft' then
    raise exception 'Alteração da política de duração permitida apenas para eventos agendados com programação em rascunho.' using errcode = 'P0020';
  end if;

  v_created_at := clock_timestamp();

  update app_private.events e
  set duration_policy = v_policy_clean,
      updated_at = default
  where e.church_id = p_church_id and e.id = p_event_id;

  v_payload := jsonb_build_object(
    'event_id', p_event_id,
    'duration_policy', v_policy_clean
  );

  insert into app_private.event_planning_receipts (
    user_id, command_id, church_id, action, params, result, created_at
  ) values (
    v_user_id, p_command_id, p_church_id, c_action, v_params_hash, v_payload, v_created_at
  );

  insert into app_private.audit_entries (
    church_id, action, actor_user_id, actor_source, target_type, target_id, details, occurred_at
  ) values (
    p_church_id, c_action, v_user_id, 'application', 'events', p_event_id, v_payload, v_created_at
  );

  return query select
    p_command_id,
    c_action,
    p_church_id,
    p_event_id,
    v_payload,
    v_created_at;
end;
$function$;

-- 8.3 public.publish_event_program
create or replace function public.publish_event_program(
  p_church_id uuid,
  p_command_id uuid,
  p_event_id uuid
)
returns table (
  command_id uuid,
  action text,
  church_id uuid,
  result_entity_id uuid,
  result_payload jsonb,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $function$
declare
  v_user_id uuid;
  v_preliminary_member_id uuid;
  v_caller_member_id uuid;
  v_is_admin boolean;
  v_event app_private.events%rowtype;
  v_total_occupied_seconds integer;
  v_available_seconds integer;
  v_overflow_seconds integer;
  v_created_at timestamptz;
  v_payload jsonb;
  v_existing_receipt app_private.event_planning_receipts%rowtype;
  v_params_hash jsonb;
  c_action constant text := 'publish_event_program';
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Esta operação exige READ COMMITTED.' using errcode = '42501';
  end if;

  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if p_church_id is null or p_command_id is null or p_event_id is null then
    raise exception 'Parâmetros obrigatórios ausentes.' using errcode = '22004';
  end if;

  -- Checagem preliminar fail-fast
  select ca.member_id, coalesce(ca.is_admin, false)
  into v_preliminary_member_id, v_is_admin
  from app_private.church_access ca
  join auth.users u on u.id = ca.user_id
  join app_private.churches c on c.id = ca.church_id
  join app_private.members m on m.id = ca.member_id and m.church_id = ca.church_id
  where ca.church_id = p_church_id
    and ca.user_id = v_user_id
    and ca.status = 'active'
    and ca.onboarding_completed_at is not null
    and c.status = 'active'
    and m.status = 'active'
    and u.email_confirmed_at is not null
    and u.deleted_at is null
    and not coalesce(u.is_anonymous, false)
    and (u.banned_until is null or u.banned_until <= clock_timestamp());

  if v_preliminary_member_id is null then
    raise exception 'Usuário sem vínculo ativo com a igreja.' using errcode = '42501';
  end if;

  v_params_hash := jsonb_build_object('event_id', p_event_id);

  -- 1º: Advisory lock de comando
  perform pg_catalog.pg_advisory_xact_lock(hashtext(v_user_id::text), hashtext(p_command_id::text));

  select r.* into v_existing_receipt
  from app_private.event_planning_receipts r
  where r.user_id = v_user_id and r.command_id = p_command_id;

  if found then
    if v_existing_receipt.church_id <> p_church_id
       or v_existing_receipt.action <> c_action
       or v_existing_receipt.params <> v_params_hash then
      raise exception 'Comando já utilizado com outros parâmetros.' using errcode = '23505';
    end if;
  end if;

  -- 2º: Lock Igreja FOR SHARE
  perform 1 from app_private.churches c where c.id = p_church_id and c.status = 'active' for share;
  if not found then
    raise exception 'Igreja inativa ou inexistente.' using errcode = '42501';
  end if;

  -- 3º: Lock Acesso FOR SHARE
  select ca.member_id, coalesce(ca.is_admin, false)
  into v_caller_member_id, v_is_admin
  from app_private.church_access ca
  where ca.church_id = p_church_id
    and ca.user_id = v_user_id
    and ca.status = 'active'
    and ca.onboarding_completed_at is not null
  for share;

  if v_caller_member_id is null or v_caller_member_id <> v_preliminary_member_id then
    raise exception 'Vínculo de acesso inativo ou revogado nesta igreja.' using errcode = '42501';
  end if;

  -- 4º: Lock Membro FOR SHARE
  perform 1 from app_private.members m
  where m.church_id = p_church_id and m.id = v_caller_member_id and m.status = 'active'
  for share;
  if not found then
    raise exception 'Membro inativo ou inexistente nesta igreja.' using errcode = '42501';
  end if;

  -- 5º: Lock Auth User FOR SHARE
  perform 1 from auth.users u
  where u.id = v_user_id
    and u.email_confirmed_at is not null
    and u.deleted_at is null
    and not coalesce(u.is_anonymous, false)
    and (u.banned_until is null or u.banned_until <= clock_timestamp())
  for share;
  if not found then
    raise exception 'Conta de usuário inativa, não confirmada ou suspensa.' using errcode = '42501';
  end if;

  -- 6º: Lock Evento FOR UPDATE
  select * into v_event
  from app_private.events e
  where e.church_id = p_church_id and e.id = p_event_id
  for update;

  if not found then
    raise exception 'Evento não encontrado.' using errcode = 'P0002';
  end if;

  -- Revalidação de autoridade pós-espera de locks
  select ca.member_id, coalesce(ca.is_admin, false)
  into v_caller_member_id, v_is_admin
  from app_private.church_access ca
  join app_private.members m on m.id = ca.member_id and m.church_id = ca.church_id
  join auth.users u on u.id = ca.user_id
  join app_private.churches c on c.id = ca.church_id
  where ca.church_id = p_church_id
    and ca.user_id = v_user_id
    and ca.status = 'active'
    and ca.onboarding_completed_at is not null
    and c.status = 'active'
    and m.status = 'active'
    and u.email_confirmed_at is not null
    and u.deleted_at is null
    and not coalesce(u.is_anonymous, false)
    and (u.banned_until is null or u.banned_until <= clock_timestamp());

  if v_caller_member_id is null then
    raise exception 'Acesso revogado durante a espera pelo evento.' using errcode = '42501';
  end if;

  if not (
    coalesce(v_is_admin, false) = true
    or (
      v_event.liturgy_leader_member_id is not null
      and v_event.liturgy_leader_member_id = v_caller_member_id
    )
  ) then
    raise exception 'Permissão insuficiente para publicar a programação deste evento.' using errcode = '42501';
  end if;

  if v_existing_receipt.command_id is not null then
    return query select
      p_command_id,
      c_action,
      p_church_id,
      (v_existing_receipt.result->>'event_id')::uuid,
      v_existing_receipt.result,
      v_existing_receipt.created_at;
    return;
  end if;

  -- Exigência estrita: scheduled + draft
  if v_event.status <> 'scheduled' or v_event.program_status <> 'draft' then
    raise exception 'Publicação permitida apenas para eventos agendados com programação em rascunho.' using errcode = 'P0020';
  end if;

  -- Apuração de duração e política de bloqueio
  v_available_seconds := extract(epoch from (v_event.planned_end_at - v_event.planned_start_at))::integer;

  select coalesce(sum(ei.planned_duration_seconds), 0)
  into v_total_occupied_seconds
  from app_private.event_items ei
  where ei.church_id = p_church_id
    and ei.event_id = p_event_id
    and ei.item_nature = 'liturgical'
    and ei.status <> 'cancelled';

  v_overflow_seconds := greatest(0, v_total_occupied_seconds - v_available_seconds);

  if v_event.duration_policy = 'block' and v_overflow_seconds > 0 then
    raise exception 'A programação excede o limite planejado em % segundos. No modo de bloqueio, ajuste a duração antes de publicar.',
      v_overflow_seconds using errcode = '22000';
  end if;

  v_created_at := clock_timestamp();

  -- Publicação com incremento estrito de versão
  update app_private.events e
  set program_status = 'published',
      published_at = v_created_at,
      published_by_member_id = v_caller_member_id,
      program_version = program_version + 1,
      updated_at = default
  where e.church_id = p_church_id and e.id = p_event_id;

  v_payload := jsonb_build_object(
    'event_id', p_event_id,
    'program_status', 'published',
    'program_version', v_event.program_version + 1,
    'duration_policy', v_event.duration_policy,
    'available_seconds', v_available_seconds,
    'occupied_seconds', v_total_occupied_seconds,
    'overflow_seconds', v_overflow_seconds,
    'published_at', v_created_at
  );

  insert into app_private.event_planning_receipts (
    user_id, command_id, church_id, action, params, result, created_at
  ) values (
    v_user_id, p_command_id, p_church_id, c_action, v_params_hash, v_payload, v_created_at
  );

  insert into app_private.audit_entries (
    church_id, action, actor_user_id, actor_source, target_type, target_id, details, occurred_at
  ) values (
    p_church_id, c_action, v_user_id, 'application', 'events', p_event_id, v_payload, v_created_at
  );

  return query select
    p_command_id,
    c_action,
    p_church_id,
    p_event_id,
    v_payload,
    v_created_at;
end;
$function$;

-- 8.4 public.save_event_program_draft (TRANSIÇÃO NOVA SOMENTE published -> draft)
create or replace function public.save_event_program_draft(
  p_church_id uuid,
  p_command_id uuid,
  p_event_id uuid
)
returns table (
  command_id uuid,
  action text,
  church_id uuid,
  result_entity_id uuid,
  result_payload jsonb,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $function$
declare
  v_user_id uuid;
  v_preliminary_member_id uuid;
  v_caller_member_id uuid;
  v_is_admin boolean;
  v_event app_private.events%rowtype;
  v_created_at timestamptz;
  v_payload jsonb;
  v_existing_receipt app_private.event_planning_receipts%rowtype;
  v_params_hash jsonb;
  c_action constant text := 'save_event_program_draft';
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Esta operação exige READ COMMITTED.' using errcode = '42501';
  end if;

  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if p_church_id is null or p_command_id is null or p_event_id is null then
    raise exception 'Parâmetros obrigatórios ausentes.' using errcode = '22004';
  end if;

  -- Checagem preliminar fail-fast
  select ca.member_id, coalesce(ca.is_admin, false)
  into v_preliminary_member_id, v_is_admin
  from app_private.church_access ca
  join auth.users u on u.id = ca.user_id
  join app_private.churches c on c.id = ca.church_id
  join app_private.members m on m.id = ca.member_id and m.church_id = ca.church_id
  where ca.church_id = p_church_id
    and ca.user_id = v_user_id
    and ca.status = 'active'
    and ca.onboarding_completed_at is not null
    and c.status = 'active'
    and m.status = 'active'
    and u.email_confirmed_at is not null
    and u.deleted_at is null
    and not coalesce(u.is_anonymous, false)
    and (u.banned_until is null or u.banned_until <= clock_timestamp());

  if v_preliminary_member_id is null then
    raise exception 'Usuário sem vínculo ativo com a igreja.' using errcode = '42501';
  end if;

  v_params_hash := jsonb_build_object('event_id', p_event_id);

  -- 1º: Advisory lock de comando
  perform pg_catalog.pg_advisory_xact_lock(hashtext(v_user_id::text), hashtext(p_command_id::text));

  select r.* into v_existing_receipt
  from app_private.event_planning_receipts r
  where r.user_id = v_user_id and r.command_id = p_command_id;

  if found then
    if v_existing_receipt.church_id <> p_church_id
       or v_existing_receipt.action <> c_action
       or v_existing_receipt.params <> v_params_hash then
      raise exception 'Comando já utilizado com outros parâmetros.' using errcode = '23505';
    end if;
  end if;

  -- 2º: Lock Igreja FOR SHARE
  perform 1 from app_private.churches c where c.id = p_church_id and c.status = 'active' for share;
  if not found then
    raise exception 'Igreja inativa ou inexistente.' using errcode = '42501';
  end if;

  -- 3º: Lock Acesso FOR SHARE
  select ca.member_id, coalesce(ca.is_admin, false)
  into v_caller_member_id, v_is_admin
  from app_private.church_access ca
  where ca.church_id = p_church_id
    and ca.user_id = v_user_id
    and ca.status = 'active'
    and ca.onboarding_completed_at is not null
  for share;

  if v_caller_member_id is null or v_caller_member_id <> v_preliminary_member_id then
    raise exception 'Vínculo de acesso inativo ou revogado nesta igreja.' using errcode = '42501';
  end if;

  -- 4º: Lock Membro FOR SHARE
  perform 1 from app_private.members m
  where m.church_id = p_church_id and m.id = v_caller_member_id and m.status = 'active'
  for share;
  if not found then
    raise exception 'Membro inativo ou inexistente nesta igreja.' using errcode = '42501';
  end if;

  -- 5º: Lock Auth User FOR SHARE
  perform 1 from auth.users u
  where u.id = v_user_id
    and u.email_confirmed_at is not null
    and u.deleted_at is null
    and not coalesce(u.is_anonymous, false)
    and (u.banned_until is null or u.banned_until <= clock_timestamp())
  for share;
  if not found then
    raise exception 'Conta de usuário inativa, não confirmada ou suspensa.' using errcode = '42501';
  end if;

  -- 6º: Lock Evento FOR UPDATE
  select * into v_event
  from app_private.events e
  where e.church_id = p_church_id and e.id = p_event_id
  for update;

  if not found then
    raise exception 'Evento não encontrado.' using errcode = 'P0002';
  end if;

  -- Revalidação de autoridade pós-espera de locks
  select ca.member_id, coalesce(ca.is_admin, false)
  into v_caller_member_id, v_is_admin
  from app_private.church_access ca
  join app_private.members m on m.id = ca.member_id and m.church_id = ca.church_id
  join auth.users u on u.id = ca.user_id
  join app_private.churches c on c.id = ca.church_id
  where ca.church_id = p_church_id
    and ca.user_id = v_user_id
    and ca.status = 'active'
    and ca.onboarding_completed_at is not null
    and c.status = 'active'
    and m.status = 'active'
    and u.email_confirmed_at is not null
    and u.deleted_at is null
    and not coalesce(u.is_anonymous, false)
    and (u.banned_until is null or u.banned_until <= clock_timestamp());

  if v_caller_member_id is null then
    raise exception 'Acesso revogado durante a espera pelo evento.' using errcode = '42501';
  end if;

  if not (
    coalesce(v_is_admin, false) = true
    or (
      v_event.liturgy_leader_member_id is not null
      and v_event.liturgy_leader_member_id = v_caller_member_id
    )
  ) then
    raise exception 'Permissão insuficiente para salvar rascunho deste evento.' using errcode = '42501';
  end if;

  if v_existing_receipt.command_id is not null then
    return query select
      p_command_id,
      c_action,
      p_church_id,
      (v_existing_receipt.result->>'event_id')::uuid,
      v_existing_receipt.result,
      v_existing_receipt.created_at;
    return;
  end if;

  -- Exigência estrita: evento scheduled
  if v_event.status <> 'scheduled' then
    raise exception 'Transição para rascunho permitida apenas para eventos agendados.' using errcode = 'P0020';
  end if;

  -- Transição nova: somente de published para draft
  if v_event.program_status <> 'published' then
    raise exception 'Transição para rascunho permitida apenas para eventos com programação publicada.' using errcode = 'P0020';
  end if;

  v_created_at := clock_timestamp();

  -- Preserva metadados da última publicação (published_at, published_by_member_id, program_version)
  update app_private.events e
  set program_status = 'draft',
      updated_at = default
  where e.church_id = p_church_id and e.id = p_event_id;

  v_payload := jsonb_build_object(
    'event_id', p_event_id,
    'program_status', 'draft',
    'program_version', v_event.program_version,
    'published_at', v_event.published_at,
    'published_by_member_id', v_event.published_by_member_id
  );

  insert into app_private.event_planning_receipts (
    user_id, command_id, church_id, action, params, result, created_at
  ) values (
    v_user_id, p_command_id, p_church_id, c_action, v_params_hash, v_payload, v_created_at
  );

  insert into app_private.audit_entries (
    church_id, action, actor_user_id, actor_source, target_type, target_id, details, occurred_at
  ) values (
    p_church_id, c_action, v_user_id, 'application', 'events', p_event_id, v_payload, v_created_at
  );

  return query select
    p_command_id,
    c_action,
    p_church_id,
    p_event_id,
    v_payload,
    v_created_at;
end;
$function$;

-- ------------------------------------------------------------------------------
-- ETAPA 9: PERMISSÕES, PROPRIETÁRIO E POSTGREST NOTIFY
-- ------------------------------------------------------------------------------
revoke all on function public.get_event_program(uuid, uuid) from public, anon, service_role;
grant execute on function public.get_event_program(uuid, uuid) to authenticated;
alter function public.get_event_program(uuid, uuid) owner to postgres;

revoke all on function public.list_church_events(uuid, text, integer, integer) from public, anon, service_role;
grant execute on function public.list_church_events(uuid, text, integer, integer) to authenticated;
alter function public.list_church_events(uuid, text, integer, integer) owner to postgres;

revoke all on function public.create_event_item(uuid, uuid, uuid, text, text, integer, integer, uuid, uuid, integer) from public, anon, service_role;
grant execute on function public.create_event_item(uuid, uuid, uuid, text, text, integer, integer, uuid, uuid, integer) to authenticated;
alter function public.create_event_item(uuid, uuid, uuid, text, text, integer, integer, uuid, uuid, integer) owner to postgres;

revoke all on function public.update_event_item(uuid, uuid, uuid, uuid, text, integer, integer, uuid, uuid, timestamptz) from public, anon, service_role;
grant execute on function public.update_event_item(uuid, uuid, uuid, uuid, text, integer, integer, uuid, uuid, timestamptz) to authenticated;
alter function public.update_event_item(uuid, uuid, uuid, uuid, text, integer, integer, uuid, uuid, timestamptz) owner to postgres;

revoke all on function public.remove_event_item(uuid, uuid, uuid, uuid, timestamptz) from public, anon, service_role;
grant execute on function public.remove_event_item(uuid, uuid, uuid, uuid, timestamptz) to authenticated;
alter function public.remove_event_item(uuid, uuid, uuid, uuid, timestamptz) owner to postgres;

revoke all on function public.reorder_event_items(uuid, uuid, uuid, uuid[]) from public, anon, service_role;
grant execute on function public.reorder_event_items(uuid, uuid, uuid, uuid[]) to authenticated;
alter function public.reorder_event_items(uuid, uuid, uuid, uuid[]) owner to postgres;

revoke all on function public.set_event_duration_policy(uuid, uuid, uuid, text) from public, anon, service_role;
grant execute on function public.set_event_duration_policy(uuid, uuid, uuid, text) to authenticated;
alter function public.set_event_duration_policy(uuid, uuid, uuid, text) owner to postgres;

revoke all on function public.publish_event_program(uuid, uuid, uuid) from public, anon, service_role;
grant execute on function public.publish_event_program(uuid, uuid, uuid) to authenticated;
alter function public.publish_event_program(uuid, uuid, uuid) owner to postgres;

revoke all on function public.save_event_program_draft(uuid, uuid, uuid) from public, anon, service_role;
grant execute on function public.save_event_program_draft(uuid, uuid, uuid) to authenticated;
alter function public.save_event_program_draft(uuid, uuid, uuid) owner to postgres;

notify pgrst, 'reload schema';

-- ------------------------------------------------------------------------------
-- ETAPA 10: ASSERÇÕES PÓS-INSTALAÇÃO DE CATÁLOGO E PERMISSÕES
-- ------------------------------------------------------------------------------
do $assertions$
declare
  v_rpcs oid[];
  v_oid oid;
  v_count integer;
  v_detail text;
  v_rec record;
  v_hash text;
begin
  -- 10.1 Coluna e constraints em event_items com verificação de expressão
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'app_private' and table_name = 'event_items'
      and column_name = 'prep_required_minutes'
      and data_type = 'integer' and is_nullable = 'NO' and column_default = '0'
  ) then
    raise exception 'ASSERÇÃO FALHOU: Coluna prep_required_minutes ausente ou com tipo/default divergente em app_private.event_items.'
      using errcode = 'P0002';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'app_private.event_items'::regclass
      and conname = 'ei_prep_minutes_range'
      and pg_get_constraintdef(oid) = 'CHECK (((prep_required_minutes >= 0) AND (prep_required_minutes <= 180)))'
  ) or not exists (
    select 1 from pg_constraint
    where conrelid = 'app_private.event_items'::regclass
      and conname = 'ei_liturgical_prep_zero'
      and pg_get_constraintdef(oid) = 'CHECK (((item_nature <> ''liturgical''::text) OR (prep_required_minutes = 0)))'
  ) or not exists (
    select 1 from pg_constraint
    where conrelid = 'app_private.event_items'::regclass
      and conname = 'ei_sequence_order_positive'
      and pg_get_constraintdef(oid) = 'CHECK ((sequence_order >= 1))'
  ) then
    raise exception 'ASSERÇÃO FALHOU: Constraints de validação com expressões divergentes em app_private.event_items.'
      using errcode = 'P0002';
  end if;

  -- 10.2 Presença e assinaturas exatas de todas as 9 RPCs do ecossistema B2
  v_rpcs := array[
    to_regprocedure('public.get_event_program(uuid,uuid)'),
    to_regprocedure('public.list_church_events(uuid,text,integer,integer)'),
    to_regprocedure('public.create_event_item(uuid,uuid,uuid,text,text,integer,integer,uuid,uuid,integer)'),
    to_regprocedure('public.update_event_item(uuid,uuid,uuid,uuid,text,integer,integer,uuid,uuid,timestamptz)'),
    to_regprocedure('public.remove_event_item(uuid,uuid,uuid,uuid,timestamptz)'),
    to_regprocedure('public.reorder_event_items(uuid,uuid,uuid,uuid[])'),
    to_regprocedure('public.set_event_duration_policy(uuid,uuid,uuid,text)'),
    to_regprocedure('public.publish_event_program(uuid,uuid,uuid)'),
    to_regprocedure('public.save_event_program_draft(uuid,uuid,uuid)')
  ];

  if array_position(v_rpcs, null) is not null then
    raise exception 'ASSERÇÃO FALHOU: Uma ou mais RPCs não foram registradas corretamente.'
      using errcode = '42883';
  end if;

  -- 10.3 Antiga assinatura de create_event_item deve ter sido removida (exatamente 1 overload)
  if (select count(*) from pg_proc where proname = 'create_event_item' and pronamespace = 'public'::regnamespace) <> 1
     or to_regprocedure('public.create_event_item(uuid,uuid,uuid,text,text,integer,integer,uuid,uuid)') is not null then
    raise exception 'ASSERÇÃO FALHOU: Assinatura obsoleta ou overload indevido de create_event_item detectado.'
      using errcode = '42710';
  end if;

  -- 10.4 Matriz de metadados (G6) das 9 RPCs do ecossistema B2 (mesma política do preflight e do verificador)
  -- Além da contagem, v_detail lista cada RPC divergente com os atributos que falharam (fail-closed mantido).
  select count(*),
         string_agg(
           t.p_name || ' [' || concat_ws(' ',
             case when p.oid is null then 'ausente' end,
             case when (select count(*) from pg_proc x where x.proname = t.p_name and x.pronamespace = 'public'::regnamespace) <> 1
               then 'overloads=' || (select count(*) from pg_proc x where x.proname = t.p_name and x.pronamespace = 'public'::regnamespace)::text end,
             case when p.pronargs <> t.p_nargs then 'nargs=' || p.pronargs::text || '/' || t.p_nargs::text end,
             case when p.pronargdefaults <> t.p_ndef then 'ndefaults=' || p.pronargdefaults::text || '/' || t.p_ndef::text end,
             case when pg_get_function_arguments(p.oid) <> t.p_args then 'args' end,
             case when pg_get_function_result(p.oid) <> t.p_result then 'result' end,
             case when p.proretset is not true then 'retset' end,
             case when l.lanname is distinct from 'plpgsql' then 'lang=' || coalesce(l.lanname, 'null') end,
             case when p.provolatile::text <> t.p_vol then 'vol=' || p.provolatile::text || '/' || t.p_vol end,
             case when p.prokind::text <> 'f' then 'kind=' || p.prokind::text end,
             case when p.prosecdef is not true then 'secdef' end,
             case when coalesce((
                    select string_agg(
                             coalesce(p.proargmodes[x.k]::text, 'i') || ':' || coalesce(p.proargnames[x.k], '') || ':' || format_type(x.typ, null),
                             ',' order by x.k)
                    from unnest(coalesce(p.proallargtypes, p.proargtypes::oid[])) with ordinality as x(typ, k)
                  ), '') is distinct from t.p_canon then 'canon' end,
             case when coalesce(cardinality(p.proconfig), 0) <> 2 then 'proconfig_n=' || coalesce(cardinality(p.proconfig), 0)::text end,
             case when coalesce(p.proconfig @> array['statement_timeout=5s'], false) is not true then 'timeout' end,
             case when coalesce(p.proconfig @> array['search_path=""'] or p.proconfig @> array['search_path='], false) is not true then 'search_path' end,
             case when p.proowner <> (select oid from pg_roles where rolname = 'postgres') then 'owner' end
           ) || ']',
           ' | ' order by t.p_name)
  into v_count, v_detail
  from (
    values
      ('get_event_program', 'public.get_event_program(uuid,uuid)', 2, 0,
       'p_church_id uuid, p_event_id uuid',
       'TABLE(event jsonb, items jsonb)',
       's', 'i:p_church_id:uuid,i:p_event_id:uuid,t:event:jsonb,t:items:jsonb'),
      ('list_church_events', 'public.list_church_events(uuid,text,integer,integer)', 4, 3,
       'p_church_id uuid, p_status_filter text DEFAULT ''all''::text, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0',
       'TABLE(events jsonb, total_count bigint)',
       's', 'i:p_church_id:uuid,i:p_status_filter:text,i:p_limit:integer,i:p_offset:integer,t:events:jsonb,t:total_count:bigint'),
      ('create_event_item', 'public.create_event_item(uuid,uuid,uuid,text,text,integer,integer,uuid,uuid,integer)', 10, 6,
       'p_church_id uuid, p_command_id uuid, p_event_id uuid, p_title text, p_item_nature text DEFAULT ''liturgical''::text, p_sequence_order integer DEFAULT 1, p_planned_duration_seconds integer DEFAULT 300, p_designated_team_id uuid DEFAULT NULL::uuid, p_nominal_leader_member_id uuid DEFAULT NULL::uuid, p_prep_required_minutes integer DEFAULT 0',
       'TABLE(command_id uuid, action text, church_id uuid, result_entity_id uuid, result_payload jsonb, created_at timestamp with time zone)',
       'v', 'i:p_church_id:uuid,i:p_command_id:uuid,i:p_event_id:uuid,i:p_title:text,i:p_item_nature:text,i:p_sequence_order:integer,i:p_planned_duration_seconds:integer,i:p_designated_team_id:uuid,i:p_nominal_leader_member_id:uuid,i:p_prep_required_minutes:integer,t:command_id:uuid,t:action:text,t:church_id:uuid,t:result_entity_id:uuid,t:result_payload:jsonb,t:created_at:timestamp with time zone'),
      ('update_event_item', 'public.update_event_item(uuid,uuid,uuid,uuid,text,integer,integer,uuid,uuid,timestamptz)', 10, 0,
       'p_church_id uuid, p_command_id uuid, p_event_id uuid, p_item_id uuid, p_title text, p_planned_duration_seconds integer, p_prep_required_minutes integer, p_designated_team_id uuid, p_nominal_leader_member_id uuid, p_expected_updated_at timestamp with time zone',
       'TABLE(command_id uuid, action text, church_id uuid, result_entity_id uuid, result_payload jsonb, created_at timestamp with time zone)',
       'v', 'i:p_church_id:uuid,i:p_command_id:uuid,i:p_event_id:uuid,i:p_item_id:uuid,i:p_title:text,i:p_planned_duration_seconds:integer,i:p_prep_required_minutes:integer,i:p_designated_team_id:uuid,i:p_nominal_leader_member_id:uuid,i:p_expected_updated_at:timestamp with time zone,t:command_id:uuid,t:action:text,t:church_id:uuid,t:result_entity_id:uuid,t:result_payload:jsonb,t:created_at:timestamp with time zone'),
      ('remove_event_item', 'public.remove_event_item(uuid,uuid,uuid,uuid,timestamptz)', 5, 0,
       'p_church_id uuid, p_command_id uuid, p_event_id uuid, p_item_id uuid, p_expected_updated_at timestamp with time zone',
       'TABLE(command_id uuid, action text, church_id uuid, result_entity_id uuid, result_payload jsonb, created_at timestamp with time zone)',
       'v', 'i:p_church_id:uuid,i:p_command_id:uuid,i:p_event_id:uuid,i:p_item_id:uuid,i:p_expected_updated_at:timestamp with time zone,t:command_id:uuid,t:action:text,t:church_id:uuid,t:result_entity_id:uuid,t:result_payload:jsonb,t:created_at:timestamp with time zone'),
      ('reorder_event_items', 'public.reorder_event_items(uuid,uuid,uuid,uuid[])', 4, 0,
       'p_church_id uuid, p_command_id uuid, p_event_id uuid, p_ordered_item_ids uuid[]',
       'TABLE(command_id uuid, action text, church_id uuid, result_entity_id uuid, result_payload jsonb, created_at timestamp with time zone)',
       'v', 'i:p_church_id:uuid,i:p_command_id:uuid,i:p_event_id:uuid,i:p_ordered_item_ids:uuid[],t:command_id:uuid,t:action:text,t:church_id:uuid,t:result_entity_id:uuid,t:result_payload:jsonb,t:created_at:timestamp with time zone'),
      ('set_event_duration_policy', 'public.set_event_duration_policy(uuid,uuid,uuid,text)', 4, 0,
       'p_church_id uuid, p_command_id uuid, p_event_id uuid, p_duration_policy text',
       'TABLE(command_id uuid, action text, church_id uuid, result_entity_id uuid, result_payload jsonb, created_at timestamp with time zone)',
       'v', 'i:p_church_id:uuid,i:p_command_id:uuid,i:p_event_id:uuid,i:p_duration_policy:text,t:command_id:uuid,t:action:text,t:church_id:uuid,t:result_entity_id:uuid,t:result_payload:jsonb,t:created_at:timestamp with time zone'),
      ('publish_event_program', 'public.publish_event_program(uuid,uuid,uuid)', 3, 0,
       'p_church_id uuid, p_command_id uuid, p_event_id uuid',
       'TABLE(command_id uuid, action text, church_id uuid, result_entity_id uuid, result_payload jsonb, created_at timestamp with time zone)',
       'v', 'i:p_church_id:uuid,i:p_command_id:uuid,i:p_event_id:uuid,t:command_id:uuid,t:action:text,t:church_id:uuid,t:result_entity_id:uuid,t:result_payload:jsonb,t:created_at:timestamp with time zone'),
      ('save_event_program_draft', 'public.save_event_program_draft(uuid,uuid,uuid)', 3, 0,
       'p_church_id uuid, p_command_id uuid, p_event_id uuid',
       'TABLE(command_id uuid, action text, church_id uuid, result_entity_id uuid, result_payload jsonb, created_at timestamp with time zone)',
       'v', 'i:p_church_id:uuid,i:p_command_id:uuid,i:p_event_id:uuid,t:command_id:uuid,t:action:text,t:church_id:uuid,t:result_entity_id:uuid,t:result_payload:jsonb,t:created_at:timestamp with time zone')
  ) as t(p_name, p_sig, p_nargs, p_ndef, p_args, p_result, p_vol, p_canon)
  left join pg_proc p on p.oid = to_regprocedure(t.p_sig)
  left join pg_language l on l.oid = p.prolang
  where p.oid is null
     or (select count(*) from pg_proc x where x.proname = t.p_name and x.pronamespace = 'public'::regnamespace) <> 1
     or p.pronargs <> t.p_nargs
     or p.pronargdefaults <> t.p_ndef
     or pg_get_function_arguments(p.oid) <> t.p_args
     or pg_get_function_result(p.oid) <> t.p_result
     or p.proretset is not true
     or l.lanname is distinct from 'plpgsql'
     or p.provolatile::text <> t.p_vol
     or p.prokind::text <> 'f'
     or p.prosecdef is not true
     or coalesce((
          select string_agg(
                   coalesce(p.proargmodes[x.k]::text, 'i') || ':' || coalesce(p.proargnames[x.k], '') || ':' || format_type(x.typ, null),
                   ',' order by x.k)
          from unnest(coalesce(p.proallargtypes, p.proargtypes::oid[])) with ordinality as x(typ, k)
        ), '') is distinct from t.p_canon
     or coalesce(cardinality(p.proconfig), 0) <> 2
     or coalesce(p.proconfig @> array['statement_timeout=5s'], false) is not true
     or coalesce(p.proconfig @> array['search_path=""'] or p.proconfig @> array['search_path='], false) is not true
     or p.proowner <> (select oid from pg_roles where rolname = 'postgres');
  if v_count > 0 then
    raise exception 'ASSERÇÃO FALHOU: Matriz de metadados das 9 RPCs do B2 diverge (% divergências): %', v_count, v_detail
      using errcode = '42883';
  end if;

  -- 10.5 ACL uniforme (G5) das 9 RPCs: entrada direta de authenticated com EXECUTE, is_grantable = false,
  -- grantor = owner; nenhum outro grantee (PUBLIC, anon, service_role); nenhum privilégio além de EXECUTE;
  -- owner apenas como EXECUTE concedido por ele próprio; ACL nula ou vazia rejeitada.
  foreach v_oid in array v_rpcs
  loop
    if exists (
      select 1 from pg_proc p
      where p.oid = v_oid
        and (
          p.proacl is null
          or cardinality(p.proacl) = 0
          or p.proowner <> (select oid from pg_roles where rolname = 'postgres')
          or not exists (
            select 1 from aclexplode(p.proacl) ae
            where ae.grantee = (select oid from pg_roles where rolname = 'authenticated')
              and ae.privilege_type = 'EXECUTE'
              and ae.is_grantable = false
              and ae.grantor = p.proowner
          )
          or exists (
            select 1 from aclexplode(p.proacl) ae
            where ae.grantee not in ((select oid from pg_roles where rolname = 'authenticated'), p.proowner)
               or ae.privilege_type <> 'EXECUTE'
               or (ae.grantee = p.proowner and ae.grantor <> p.proowner)
               or (ae.grantee = (select oid from pg_roles where rolname = 'authenticated') and ae.is_grantable)
               or (ae.grantee = (select oid from pg_roles where rolname = 'authenticated') and ae.grantor <> p.proowner)
          )
        )
    ) then
      raise exception 'ASSERÇÃO FALHOU: Política ACL uniforme violada na RPC % (oid %).', v_oid::regprocedure, v_oid
        using errcode = '42501';
    end if;
  end loop;

  -- 10.6 Fingerprints canônicos (B3) das 9 RPCs pós-026, aprovados pelo parecer. Divergência lança exceção antes do COMMIT.
  for v_rec in
    select * from (
      values
        ('create_event_item', 'public.create_event_item(uuid,uuid,uuid,text,text,integer,integer,uuid,uuid,integer)', '83a64964487c35d0c4a3c035193bd5bc6948aef481e52323c64e18ef2284a6de'),
        ('list_church_events', 'public.list_church_events(uuid,text,integer,integer)', '3db624acdb1a6bc4619afd385388194e3dcc56e1269e636649a8eaa72234389e'),
        ('reorder_event_items', 'public.reorder_event_items(uuid,uuid,uuid,uuid[])', 'f729dc0b61f489b6923e4db82ea6d6e2b9494ad420c2ac96b33fb36093d48e4e'),
        ('set_event_duration_policy', 'public.set_event_duration_policy(uuid,uuid,uuid,text)', '5995ae5833cc0e26b11060e11b26cfe8724f2e3c2ae99c9b732206438ff37e88'),
        ('publish_event_program', 'public.publish_event_program(uuid,uuid,uuid)', '756401dd9b66ee27fb87abb6dfbc1d8487301dcf1a3f3b997a217e47ada4e501'),
        ('save_event_program_draft', 'public.save_event_program_draft(uuid,uuid,uuid)', '69c3c27505cba8e1a97eab71429b98c807b25561cb1f213e465a8f58e238e96e'),
        ('get_event_program', 'public.get_event_program(uuid,uuid)', 'a2ca283d8fb297bff2ea035884189f09c1b44e77cbb081dafec079ea13cfec52'),
        ('update_event_item', 'public.update_event_item(uuid,uuid,uuid,uuid,text,integer,integer,uuid,uuid,timestamptz)', '4603c79776c7f061ac8998e97a78408fc08ffc2181f735b91f33f043a93fcd89'),
        ('remove_event_item', 'public.remove_event_item(uuid,uuid,uuid,uuid,timestamptz)', '70b3d9264b39df8fcaeebc8614707bccd5f0adf2a9a02fd50d8db31f0147d8f1')
    ) as t(p_name, p_sig, p_expected_hash)
  loop
    select encode(pg_catalog.sha256(convert_to(btrim(replace(p.prosrc, E'\r\n', E'\n'), E' \t\r\n'), 'UTF8')), 'hex')
    into v_hash
    from pg_proc p
    where p.oid = to_regprocedure(v_rec.p_sig);

    if v_hash is distinct from v_rec.p_expected_hash then
      raise exception 'ASSERÇÃO FALHOU: Fingerprint de % (%) diverge do hash aprovado (%).', v_rec.p_name, v_hash, v_rec.p_expected_hash
        using errcode = '42883';
    end if;
  end loop;
end;
$assertions$;

commit;
