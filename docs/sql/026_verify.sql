-- ==============================================================================
-- 026_verify.sql
-- Verificador Canônico e Fail-Closed: Incremento B2 v1.0 (Issues #29 e #30)
--
-- ESCOPO:
-- Script de verificação estrita de catálogo pós-instalação de 026_event_program_editing.sql.
-- Não altera dados, tabelas ou permissões.
--
-- COMPORTAMENTO FAIL-CLOSED (C13, F2-F7):
-- Executado via `psql -v ON_ERROR_STOP=1 -f docs/sql/026_verify.sql`:
-- 1. Executa asserções rigorosas em bloco procedural PL/pgSQL;
-- 2. Emite diagnóstico legível de cada gate;
-- 3. LANÇA EXCEÇÃO (código diferente de zero) se QUALQUER verificação falhar;
-- 4. Retorna linha de status somente se 100% dos gates forem aprovados.
--
-- MATRIZES (G3, G4, G5, G6): constraints e FKs integrais, índices e triggers por definição
-- completa, ACL uniforme (sem has_function_privilege) e metadados completos das funções.
-- ==============================================================================

\set ON_ERROR_STOP on

do $verify$
declare
  v_count integer;
  v_rec record;
  v_hash text;
begin
  -- ----------------------------------------------------------------------------
  -- 1. Colunas em app_private.event_items pós-026 (exatamente 16 colunas canônicas)
  -- ----------------------------------------------------------------------------
  select count(*) into v_count from information_schema.columns
  where table_schema = 'app_private' and table_name = 'event_items';
  if v_count <> 16 then
    raise exception '026_verify FALHOU [1.1]: app_private.event_items possui % colunas (esperado exatamente 16 pós-026).', v_count
      using errcode = '42P07';
  end if;

  if not exists (
    select 1 from pg_attribute a
    join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    where a.attrelid = 'app_private.event_items'::regclass
      and a.attname = 'prep_required_minutes'
      and a.attnum > 0
      and not a.attisdropped
      and format_type(a.atttypid, a.atttypmod) = 'integer'
      and a.attnotnull
      and pg_get_expr(d.adbin, d.adrelid) = '0'
  ) then
    raise exception '026_verify FALHOU [1.2]: Coluna prep_required_minutes ausente ou divergente (tipo, nulabilidade ou default) em app_private.event_items.'
      using errcode = '42P07';
  end if;

  -- ----------------------------------------------------------------------------
  -- 2. Matriz canônica de constraints e FKs (G3) das tabelas do domínio, pós-026
  -- ----------------------------------------------------------------------------
  select count(*) into v_count
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
      ('app_private.event_items', 'ei_prep_minutes_range', 'c', 'CHECK (((prep_required_minutes >= 0) AND (prep_required_minutes <= 180)))', '', '', ''),
      ('app_private.event_items', 'ei_liturgical_prep_zero', 'c', 'CHECK (((item_nature <> ''liturgical''::text) OR (prep_required_minutes = 0)))', '', '', ''),
      ('app_private.event_items', 'ei_sequence_order_positive', 'c', 'CHECK ((sequence_order >= 1))', '', '', ''),
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
  if v_count > 0 then
    raise exception '026_verify FALHOU [2]: Matriz de constraints/FKs diverge do canônico pós-026 (% divergências).', v_count
      using errcode = '42P07';
  end if;

  -- ----------------------------------------------------------------------------
  -- 3. Ausência semântica de unicidade incompatível cobrindo sequence_order (F5)
  -- ----------------------------------------------------------------------------
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
    raise exception '026_verify FALHOU [3]: Detectada restrição/índice único incompatível sobre sequence_order em app_private.event_items.'
      using errcode = '42P07';
  end if;

  -- ----------------------------------------------------------------------------
  -- 4. Ausência de assinaturas obsoletas (create_event_item com 9 argumentos)
  -- ----------------------------------------------------------------------------
  if to_regprocedure('public.create_event_item(uuid,uuid,uuid,text,text,integer,integer,uuid,uuid)') is not null then
    raise exception '026_verify FALHOU [4]: Assinatura obsoleta de create_event_item (9 argumentos) ainda presente no catálogo.'
      using errcode = '42710';
  end if;

  -- ----------------------------------------------------------------------------
  -- 5. Metadados completos (G6), ACL uniforme (G5) e fingerprints das 9 RPCs do B2
  -- ----------------------------------------------------------------------------
  select count(*) into v_count
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
    raise exception '026_verify FALHOU [5.1]: Matriz de metadados das 9 RPCs do B2 diverge (% divergências).', v_count
      using errcode = '42883';
  end if;

  for v_rec in
    select * from (
      values
        ('create_event_item', 'public.create_event_item(uuid,uuid,uuid,text,text,integer,integer,uuid,uuid,integer)',
         '83a64964487c35d0c4a3c035193bd5bc6948aef481e52323c64e18ef2284a6de'),
        ('list_church_events', 'public.list_church_events(uuid,text,integer,integer)',
         '3db624acdb1a6bc4619afd385388194e3dcc56e1269e636649a8eaa72234389e'),
        ('reorder_event_items', 'public.reorder_event_items(uuid,uuid,uuid,uuid[])',
         'f729dc0b61f489b6923e4db82ea6d6e2b9494ad420c2ac96b33fb36093d48e4e'),
        ('set_event_duration_policy', 'public.set_event_duration_policy(uuid,uuid,uuid,text)',
         '5995ae5833cc0e26b11060e11b26cfe8724f2e3c2ae99c9b732206438ff37e88'),
        ('publish_event_program', 'public.publish_event_program(uuid,uuid,uuid)',
         '756401dd9b66ee27fb87abb6dfbc1d8487301dcf1a3f3b997a217e47ada4e501'),
        ('save_event_program_draft', 'public.save_event_program_draft(uuid,uuid,uuid)',
         '69c3c27505cba8e1a97eab71429b98c807b25561cb1f213e465a8f58e238e96e'),
        ('get_event_program', 'public.get_event_program(uuid,uuid)',
         'a2ca283d8fb297bff2ea035884189f09c1b44e77cbb081dafec079ea13cfec52'),
        ('update_event_item', 'public.update_event_item(uuid,uuid,uuid,uuid,text,integer,integer,uuid,uuid,timestamptz)',
         '4603c79776c7f061ac8998e97a78408fc08ffc2181f735b91f33f043a93fcd89'),
        ('remove_event_item', 'public.remove_event_item(uuid,uuid,uuid,uuid,timestamptz)',
         '70b3d9264b39df8fcaeebc8614707bccd5f0adf2a9a02fd50d8db31f0147d8f1')
    ) as t(p_name, p_sig, p_expected_hash)
  loop
    -- ACL uniforme (G5): sem has_function_privilege como prova de concessão direta
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
      raise exception '026_verify FALHOU [5.3]: ACL de % viola a política uniforme de allowlist direta.', v_rec.p_name
        using errcode = '42501';
    end if;

    -- Fingerprint canônico SHA-256 (F2): mesma fórmula do preflight
    select encode(pg_catalog.sha256(convert_to(btrim(replace(p.prosrc, E'\r\n', E'\n'), E' \t\r\n'), 'UTF8')), 'hex')
    into v_hash
    from pg_proc p
    where p.oid = to_regprocedure(v_rec.p_sig);

    if v_hash <> v_rec.p_expected_hash then
      raise exception '026_verify FALHOU [5.4]: Fingerprint de % (%) diverge do hash canônico esperado (%).',
        v_rec.p_name, v_hash, v_rec.p_expected_hash
        using errcode = '42883';
    end if;
  end loop;

  -- ----------------------------------------------------------------------------
  -- 6. Matriz canônica de índices (G4) pós-026
  -- ----------------------------------------------------------------------------
  select count(*) into v_count
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
  if v_count > 0 then
    raise exception '026_verify FALHOU [6.1]: Matriz de índices diverge do canônico pós-026 (% divergências).', v_count
      using errcode = '42P07';
  end if;

  -- ----------------------------------------------------------------------------
  -- 7. Matriz canônica de triggers (G4) pós-026
  -- ----------------------------------------------------------------------------
  select count(*) into v_count
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
  if v_count > 0 then
    raise exception '026_verify FALHOU [7.1]: Matriz de triggers diverge do canônico pós-026 (% divergências).', v_count
      using errcode = '42P07';
  end if;

  raise notice '026_verify: Todos os gates de catálogo, constraints, índices, triggers, metadados, ACL e fingerprints foram 100%% APROVADOS.';
end;
$verify$;

-- SELECT diagnóstico informativo emitido apenas após aprovação completa do bloco procedural fail-closed
select
  true as event_items_prep_column_verified,
  true as constraints_matrix_verified,
  true as sequence_order_unique_absence_verified,
  true as all_b2_rpcs_signatures_and_overloads_verified,
  true as all_b2_rpcs_metadata_matrix_verified,
  true as all_b2_rpcs_canonical_fingerprints_verified,
  true as privileges_strictly_enforced_by_uniform_acl,
  true as required_indexes_and_triggers_matrix_verified;
