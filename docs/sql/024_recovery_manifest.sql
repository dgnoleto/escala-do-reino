-- ==============================================================================
-- docs/sql/024_recovery_manifest.sql
-- Extração do Manifesto Canônico de Recuperação do Laboratório (Issue #58)
-- Alvo: Banco sob proteção (escala_rehearsal_024) ou Banco de Validação (escala_recovery_verify_024)
-- Versão do Contrato: 1.1 (Conforme Parecer Independente R1-R7 do Codex)
-- ==============================================================================
--
-- DIRETRIZES TÉCNICAS E DE GOVERNANÇA:
-- 1. Este script não executa comandos DDL de mutação, não cria tabelas temporárias e
--    opera com segurança estrita em transações "READ ONLY" (REPEATABLE READ READ ONLY).
-- 2. Não expõe dados pessoais, contas de usuários, JWTs ou dados sensíveis (LGPD).
-- 3. Utiliza nomes e assinaturas nominais estáveis, sem depender de igualdade de OIDs
--    numéricos de cluster entre origem e destino.
-- 4. O escopo cobre dinamicamente todos os esquemas persistidos do banco incluídos
--    no backup (nspname NOT LIKE 'pg_%' AND nspname <> 'information_schema').
-- 5. Privilégios são decompostos via aclexplode() com acldefault tipado por objeto:
--    'r' (tabelas/visões), 's' (sequências), 'f' (funções), 'n' (schemas), 'c' (colunas)
--    e 'T' (tipos customizados/enums).
-- 6. Cobre integralmente: extensões, tipos/enums, visões (com definições), sequências
--    (definições e estado last_value/is_called), funções (tratando prokind para agregados),
--    políticas RLS (tratando PUBLIC no unnest de polroles) e vetor de nulidade SQL.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- SEÇÃO 0: PADRONIZAÇÃO OBRIGATÓRIA DE SESSÃO
-- (Deve ser executada dentro da transação READ ONLY ativa)
-- ------------------------------------------------------------------------------
SET LOCAL TimeZone = 'UTC';
SET LOCAL datestyle = 'ISO, YMD';
SET LOCAL intervalstyle = 'iso_8601';
SET LOCAL extra_float_digits = 3;
SET LOCAL client_encoding = 'UTF8';

-- BEGIN_SECTION_1_STRUCTURAL_MANIFEST
WITH
target_schemas AS (
    SELECT
        n.nspname AS schema_name,
        r.rolname AS owner_name,
        COALESCE(
            jsonb_agg(
                jsonb_build_object(
                    'grantee', CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE rg.rolname END,
                    'grantor', rgo.rolname,
                    'privilege_type', a.privilege_type,
                    'is_grantable', a.is_grantable
                ) ORDER BY CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE rg.rolname END, a.privilege_type, rgo.rolname, a.is_grantable
            ) FILTER (WHERE a.privilege_type IS NOT NULL),
            '[]'::jsonb
        ) AS schema_acls
    FROM pg_namespace n
    JOIN pg_roles r ON r.oid = n.nspowner
    LEFT JOIN LATERAL aclexplode(COALESCE(n.nspacl, acldefault('n', n.nspowner))) a ON true
    LEFT JOIN pg_roles rg ON rg.oid = a.grantee
    LEFT JOIN pg_roles rgo ON rgo.oid = a.grantor
    WHERE n.nspname NOT LIKE 'pg_%'
      AND n.nspname <> 'information_schema'
    GROUP BY n.nspname, r.rolname
),
target_extensions AS (
    SELECT
        e.extname AS extension_name,
        n.nspname AS schema_name,
        e.extversion AS version,
        e.extrelocatable AS is_relocatable
    FROM pg_extension e
    JOIN pg_namespace n ON n.oid = e.extnamespace
    WHERE n.nspname NOT LIKE 'pg_%'
      AND n.nspname <> 'information_schema'
),
target_types AS (
    SELECT
        n.nspname AS schema_name,
        t.typname AS type_name,
        t.typtype::text AS type_kind,
        r.rolname AS owner_name,
        CASE
            WHEN t.typtype = 'e' THEN (
                SELECT jsonb_agg(en.enumlabel ORDER BY en.enumsortorder)
                FROM pg_enum en
                WHERE en.enumtypid = t.oid
            )
            ELSE '[]'::jsonb
        END AS enum_labels,
        CASE
            WHEN t.typtype = 'd' THEN jsonb_build_object(
                'base_type', format_type(t.typbasetype, t.typtypmod),
                'is_not_null', t.typnotnull,
                'default_expression', pg_get_expr(t.typdefaultbin, 0, true),
                'collation', (SELECT col.collname FROM pg_collation col WHERE col.oid = t.typcollation AND t.typcollation <> 0),
                'check_constraints', (
                    SELECT COALESCE(jsonb_agg(
                        jsonb_build_object(
                            'name', con.conname,
                            'expression', pg_get_constraintdef(con.oid, true)
                        ) ORDER BY con.conname
                    ), '[]'::jsonb)
                    FROM pg_constraint con
                    WHERE con.contypid = t.oid
                )
            )
            WHEN t.typtype = 'r' THEN jsonb_build_object(
                'subtype', (SELECT format_type(rng.rngsubtype, NULL) FROM pg_range rng WHERE rng.rngtypid = t.oid),
                'collation', (SELECT col.collname FROM pg_range rng JOIN pg_collation col ON col.oid = rng.rngcollation WHERE rng.rngtypid = t.oid AND rng.rngcollation <> 0),
                'subopclass', (SELECT opc.opcname FROM pg_range rng JOIN pg_opclass opc ON opc.oid = rng.rngsubopc WHERE rng.rngtypid = t.oid),
                'canonical_func', (SELECT rng.rngcanonical::regproc::text FROM pg_range rng WHERE rng.rngtypid = t.oid AND rng.rngcanonical <> 0),
                'subdiff_func', (SELECT rng.rngsubdiff::regproc::text FROM pg_range rng WHERE rng.rngtypid = t.oid AND rng.rngsubdiff <> 0)
            )
            ELSE '{}'::jsonb
        END AS type_definition,
        COALESCE(
            jsonb_agg(
                jsonb_build_object(
                    'grantee', CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE rg.rolname END,
                    'grantor', rgo.rolname,
                    'privilege_type', a.privilege_type,
                    'is_grantable', a.is_grantable
                ) ORDER BY CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE rg.rolname END, a.privilege_type, rgo.rolname, a.is_grantable
            ) FILTER (WHERE a.privilege_type IS NOT NULL),
            '[]'::jsonb
        ) AS type_acls
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    JOIN pg_roles r ON r.oid = t.typowner
    LEFT JOIN LATERAL aclexplode(COALESCE(t.typacl, acldefault('T', t.typowner))) a ON true
    LEFT JOIN pg_roles rg ON rg.oid = a.grantee
    LEFT JOIN pg_roles rgo ON rgo.oid = a.grantor
    WHERE n.nspname NOT LIKE 'pg_%'
      AND n.nspname <> 'information_schema'
      AND t.typtype IN ('e', 'd', 'r', 'm')
      AND (t.typrelid = 0 OR t.typtype = 'e')
    GROUP BY n.nspname, t.typname, t.typtype, r.rolname, t.oid, t.typbasetype, t.typtypmod, t.typnotnull, t.typdefaultbin
),
target_tables_and_views AS (
    SELECT
        n.nspname AS schema_name,
        c.relname AS object_name,
        c.relkind::text AS relkind,
        CASE c.relkind
            WHEN 'r' THEN 'table'
            WHEN 'p' THEN 'partitioned_table'
            WHEN 'v' THEN 'view'
            WHEN 'm' THEN 'materialized_view'
        END AS object_type,
        r.rolname AS owner_name,
        c.relrowsecurity AS rls_enabled,
        c.relforcerowsecurity AS rls_forced,
        c.relpersistence::text AS persistence,
        COALESCE(to_jsonb(c.reloptions), '[]'::jsonb) AS options,
        CASE
            WHEN c.relkind IN ('v', 'm') THEN pg_get_viewdef(c.oid, true)
            ELSE NULL
        END AS view_definition,
        COALESCE(
            jsonb_agg(
                jsonb_build_object(
                    'grantee', CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE rg.rolname END,
                    'grantor', rgo.rolname,
                    'privilege_type', a.privilege_type,
                    'is_grantable', a.is_grantable
                ) ORDER BY CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE rg.rolname END, a.privilege_type, rgo.rolname, a.is_grantable
            ) FILTER (WHERE a.privilege_type IS NOT NULL),
            '[]'::jsonb
        ) AS obj_acls
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_roles r ON r.oid = c.relowner
    LEFT JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) a ON true
    LEFT JOIN pg_roles rg ON rg.oid = a.grantee
    LEFT JOIN pg_roles rgo ON rgo.oid = a.grantor
    WHERE n.nspname NOT LIKE 'pg_%'
      AND n.nspname <> 'information_schema'
      AND c.relkind IN ('r', 'p', 'v', 'm')
    GROUP BY n.nspname, c.relname, c.relkind, r.rolname, c.relrowsecurity, c.relforcerowsecurity, c.relpersistence, c.reloptions, c.oid
),
target_columns AS (
    SELECT
        n.nspname AS schema_name,
        c.relname AS table_name,
        att.attnum AS ordinal_position,
        att.attname AS column_name,
        format_type(att.atttypid, att.atttypmod) AS data_type,
        att.attnotnull AS is_not_null,
        pg_get_expr(ad.adbin, ad.adrelid) AS default_expression,
        att.attidentity::text AS identity_type,
        att.attgenerated::text AS generated_type,
        COALESCE(
            jsonb_agg(
                jsonb_build_object(
                    'grantee', CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE rg.rolname END,
                    'grantor', rgo.rolname,
                    'privilege_type', a.privilege_type,
                    'is_grantable', a.is_grantable
                ) ORDER BY CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE rg.rolname END, a.privilege_type, rgo.rolname, a.is_grantable
            ) FILTER (WHERE a.privilege_type IS NOT NULL),
            '[]'::jsonb
        ) AS column_acls
    FROM pg_attribute att
    JOIN pg_class c ON c.oid = att.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_attrdef ad ON ad.adrelid = att.attrelid AND ad.adnum = att.attnum
    LEFT JOIN LATERAL aclexplode(att.attacl) a ON att.attacl IS NOT NULL
    LEFT JOIN pg_roles rg ON rg.oid = a.grantee
    LEFT JOIN pg_roles rgo ON rgo.oid = a.grantor
    WHERE n.nspname NOT LIKE 'pg_%'
      AND n.nspname <> 'information_schema'
      AND c.relkind IN ('r', 'p', 'v', 'm')
      AND att.attnum > 0
      AND NOT att.attisdropped
    GROUP BY n.nspname, c.relname, att.attnum, att.attname, att.atttypid, att.atttypmod, att.attnotnull, ad.adbin, ad.adrelid, att.attidentity, att.attgenerated
),
target_sequences AS (
    SELECT
        n.nspname AS schema_name,
        c.relname AS sequence_name,
        r.rolname AS owner_name,
        s.seqtypid::regtype::text AS data_type,
        s.seqstart AS start_value,
        s.seqmin AS min_value,
        s.seqmax AS max_value,
        s.seqincrement AS increment_by,
        s.seqcycle AS is_cycled,
        s.seqcache AS cache_size,
        ps.last_value AS last_value,
        COALESCE(
            jsonb_agg(
                jsonb_build_object(
                    'grantee', CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE rg.rolname END,
                    'grantor', rgo.rolname,
                    'privilege_type', a.privilege_type,
                    'is_grantable', a.is_grantable
                ) ORDER BY CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE rg.rolname END, a.privilege_type, rgo.rolname, a.is_grantable
            ) FILTER (WHERE a.privilege_type IS NOT NULL),
            '[]'::jsonb
        ) AS seq_acls
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_roles r ON r.oid = c.relowner
    JOIN pg_sequence s ON s.seqrelid = c.oid
    LEFT JOIN pg_sequences ps ON ps.schemaname = n.nspname AND ps.sequencename = c.relname
    LEFT JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('s', c.relowner))) a ON true
    LEFT JOIN pg_roles rg ON rg.oid = a.grantee
    LEFT JOIN pg_roles rgo ON rgo.oid = a.grantor
    WHERE n.nspname NOT LIKE 'pg_%'
      AND n.nspname <> 'information_schema'
      AND c.relkind = 'S'
    GROUP BY n.nspname, c.relname, r.rolname, s.seqtypid, s.seqstart, s.seqmin, s.seqmax, s.seqincrement, s.seqcycle, s.seqcache, ps.last_value
),
target_functions AS (
    SELECT
        n.nspname AS schema_name,
        p.proname AS function_name,
        pg_get_function_identity_arguments(p.oid) AS identity_arguments,
        format_type(p.prorettype, NULL) AS result_type,
        r.rolname AS owner_name,
        p.prokind::text AS prokind,
        p.prosecdef AS is_security_definer,
        p.proleakproof AS is_leakproof,
        p.provolatile::text AS volatility,
        p.proparallel::text AS parallel_safety,
        p.procost AS execution_cost,
        COALESCE(to_jsonb(p.proconfig), '[]'::jsonb) AS configuration_settings,
        -- R4/F6: Reconstrução canônica de agregados com cobertura de atributos parcial.
        -- Atributos avançados (aggkind, aggnumdirectargs, aggfinalmodify, aggmfinalmodify) permanecem pendentes;
        -- o comparador bloqueia conservadoramente o PASS integral caso funções agregadas sejam encontradas.
        CASE
            WHEN p.prokind = 'a' THEN (
                SELECT format(
                    'CREATE AGGREGATE %I.%I (%s) (SFUNC = %s, STYPE = %s%s%s%s%s%s%s%s%s%s%s%s%s%s);',
                    n.nspname,
                    p.proname,
                    pg_get_function_arguments(p.oid),
                    ag.aggtransfn::regproc::text,
                    ag.aggtranstype::regtype::text,
                    CASE WHEN ag.aggfinalfn <> 0 THEN format(', FINALFUNC = %s', ag.aggfinalfn::regproc::text) ELSE '' END,
                    CASE WHEN ag.aggcombinefn <> 0 THEN format(', COMBINEFUNC = %s', ag.aggcombinefn::regproc::text) ELSE '' END,
                    CASE WHEN ag.aggserialfn <> 0 THEN format(', SERIALFUNC = %s', ag.aggserialfn::regproc::text) ELSE '' END,
                    CASE WHEN ag.aggdeserialfn <> 0 THEN format(', DESERIALFUNC = %s', ag.aggdeserialfn::regproc::text) ELSE '' END,
                    CASE WHEN ag.agginitval IS NOT NULL THEN format(', INITCOND = %L', ag.agginitval) ELSE '' END,
                    CASE WHEN ag.aggmtransfn <> 0 THEN format(', MSFUNC = %s', ag.aggmtransfn::regproc::text) ELSE '' END,
                    CASE WHEN ag.aggminvtransfn <> 0 THEN format(', MINVFUNC = %s', ag.aggminvtransfn::regproc::text) ELSE '' END,
                    CASE WHEN ag.aggmtranstype <> 0 THEN format(', MSTYPE = %s', ag.aggmtranstype::regtype::text) ELSE '' END,
                    CASE WHEN ag.aggmfinalfn <> 0 THEN format(', MFINALFUNC = %s', ag.aggmfinalfn::regproc::text) ELSE '' END,
                    CASE WHEN ag.aggminitval IS NOT NULL THEN format(', MINITCOND = %L', ag.aggminitval) ELSE '' END,
                    CASE WHEN ag.aggsortop <> 0 THEN format(', SORTOP = %s', ag.aggsortop::regoperator::text) ELSE '' END,
                    CASE WHEN ag.aggfinalextra THEN ', FINALFUNC_EXTRA' ELSE '' END,
                    CASE WHEN ag.aggmfinalextra THEN ', MFINALFUNC_EXTRA' ELSE '' END
                )
                FROM pg_aggregate ag
                WHERE ag.aggfnoid = p.oid
            )
            ELSE pg_get_functiondef(p.oid)
        END AS function_definition,
        COALESCE(
            jsonb_agg(
                jsonb_build_object(
                    'grantee', CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE rg.rolname END,
                    'grantor', rgo.rolname,
                    'privilege_type', a.privilege_type,
                    'is_grantable', a.is_grantable
                ) ORDER BY CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE rg.rolname END, a.privilege_type, rgo.rolname, a.is_grantable
            ) FILTER (WHERE a.privilege_type IS NOT NULL),
            '[]'::jsonb
        ) AS func_acls
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_roles r ON r.oid = p.proowner
    LEFT JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a ON true
    LEFT JOIN pg_roles rg ON rg.oid = a.grantee
    LEFT JOIN pg_roles rgo ON rgo.oid = a.grantor
    WHERE n.nspname NOT LIKE 'pg_%'
      AND n.nspname <> 'information_schema'
    GROUP BY n.nspname, p.proname, p.oid, p.prorettype, r.rolname, p.prokind, p.prosecdef, p.proleakproof, p.provolatile, p.proparallel, p.procost, p.proconfig
),
target_constraints AS (
    SELECT
        n.nspname AS schema_name,
        c.relname AS table_name,
        con.conname AS constraint_name,
        con.contype::text AS constraint_type,
        con.condeferrable AS is_deferrable,
        con.condeferred AS is_deferred,
        pg_get_constraintdef(con.oid, true) AS constraint_definition
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname NOT LIKE 'pg_%'
      AND n.nspname <> 'information_schema'
),
target_indexes AS (
    SELECT
        n.nspname AS schema_name,
        c.relname AS table_name,
        ci.relname AS index_name,
        i.indisunique AS is_unique,
        i.indisprimary AS is_primary,
        (i.indexrelid IN (SELECT conindid FROM pg_constraint WHERE contype = 'x')) AS is_exclusion,
        pg_get_indexdef(i.indexrelid, 0, true) AS index_definition
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indrelid
    JOIN pg_class ci ON ci.oid = i.indexrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname NOT LIKE 'pg_%'
      AND n.nspname <> 'information_schema'
),
target_policies AS (
    SELECT
        n.nspname AS schema_name,
        c.relname AS table_name,
        pol.polname AS policy_name,
        pol.polcmd::text AS command_type,
        pol.polpermissive AS policy_permissive,
        COALESCE(
            (
                SELECT jsonb_agg(CASE WHEN role_oid = 0 THEN 'PUBLIC' ELSE r_role.rolname END ORDER BY CASE WHEN role_oid = 0 THEN 'PUBLIC' ELSE r_role.rolname END)
                FROM unnest(pol.polroles) AS role_oid
                LEFT JOIN pg_roles r_role ON r_role.oid = role_oid
            ),
            '["PUBLIC"]'::jsonb
        ) AS policy_roles,
        pg_get_expr(pol.polqual, pol.polrelid, true) AS using_expression,
        pg_get_expr(pol.polwithcheck, pol.polrelid, true) AS with_check_expression
    FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname NOT LIKE 'pg_%'
      AND n.nspname <> 'information_schema'
),
target_triggers AS (
    SELECT
        n.nspname AS schema_name,
        c.relname AS table_name,
        t.tgname AS trigger_name,
        t.tgenabled::text AS is_enabled,
        pg_get_triggerdef(t.oid, true) AS trigger_definition
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname NOT LIKE 'pg_%'
      AND n.nspname <> 'information_schema'
      AND NOT t.tgisinternal
)
SELECT jsonb_build_object(
    'contract_version', '1.1',
    'catalog_metadata', jsonb_build_object(
        'database_name', current_database(),
        'extracted_at_utc', to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'server_version', version()
    ),
    'schemas', (SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.schema_name), '[]'::jsonb) FROM target_schemas s),
    'extensions', (SELECT COALESCE(jsonb_agg(to_jsonb(ext) ORDER BY ext.extension_name), '[]'::jsonb) FROM target_extensions ext),
    'custom_types', (SELECT COALESCE(jsonb_agg(to_jsonb(typ) ORDER BY typ.schema_name, typ.type_name), '[]'::jsonb) FROM target_types typ),
    'tables_and_views', (SELECT COALESCE(jsonb_agg(to_jsonb(tv) ORDER BY tv.schema_name, tv.object_name), '[]'::jsonb) FROM target_tables_and_views tv),
    'columns', (SELECT COALESCE(jsonb_agg(to_jsonb(col) ORDER BY col.schema_name, col.table_name, col.ordinal_position), '[]'::jsonb) FROM target_columns col),
    'sequences', (SELECT COALESCE(jsonb_agg(to_jsonb(seq) ORDER BY seq.schema_name, seq.sequence_name), '[]'::jsonb) FROM target_sequences seq),
    'functions', (SELECT COALESCE(jsonb_agg(to_jsonb(fn) ORDER BY fn.schema_name, fn.function_name, fn.identity_arguments), '[]'::jsonb) FROM target_functions fn),
    'constraints', (SELECT COALESCE(jsonb_agg(to_jsonb(cnt) ORDER BY cnt.schema_name, cnt.table_name, cnt.constraint_name), '[]'::jsonb) FROM target_constraints cnt),
    'indexes', (SELECT COALESCE(jsonb_agg(to_jsonb(idx) ORDER BY idx.schema_name, idx.table_name, idx.index_name), '[]'::jsonb) FROM target_indexes idx),
    'policies', (SELECT COALESCE(jsonb_agg(to_jsonb(pol) ORDER BY pol.schema_name, pol.table_name, pol.policy_name), '[]'::jsonb) FROM target_policies pol),
    'triggers', (SELECT COALESCE(jsonb_agg(to_jsonb(trg) ORDER BY trg.schema_name, trg.table_name, trg.trigger_name), '[]'::jsonb) FROM target_triggers trg)
) AS structural_manifest_json;
-- END_SECTION_1_STRUCTURAL_MANIFEST

-- BEGIN_SECTION_2_GENERATOR
SELECT COALESCE(
    jsonb_agg(
        jsonb_build_object(
            'schema_name', sub.schema_name,
            'table_name', sub.table_name,
            'table_hash_query', sub.table_hash_query
        )
        ORDER BY sub.schema_name, sub.table_name
    ),
    '[]'::jsonb
)::text AS generator_payload_json
FROM (
    SELECT
        n.nspname AS schema_name,
        c.relname AS table_name,
        format(
            $query$
            SELECT jsonb_build_object(
                'schema_name', %L,
                'table_name', %L,
                'row_count', count(*),
                'data_hash', coalesce(
                    encode(sha256(convert_to(string_agg(row_hash, E'\n' ORDER BY row_hash), 'UTF8')), 'hex'),
                    encode(sha256(''::bytea), 'hex')
                )
            )::text AS table_hash_json
            FROM (
                SELECT encode(sha256(convert_to(payload_linha::text, 'UTF8')), 'hex') AS row_hash
                FROM (
                    SELECT jsonb_build_object(
                        'values', to_jsonb(t),
                        'sql_nulls', jsonb_build_array(%s)
                    ) AS payload_linha
                    FROM %I.%I t
                ) linhas
            ) sub;
            $query$,
            n.nspname,
            c.relname,
            string_agg(format('t.%I IS NULL', att.attname), ', ' ORDER BY att.attnum),
            n.nspname,
            c.relname
        ) AS table_hash_query
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute att ON att.attrelid = c.oid
    WHERE n.nspname NOT LIKE 'pg_%'
      AND n.nspname <> 'information_schema'
      AND c.relkind IN ('r', 'p', 'm')
      AND att.attnum > 0
      AND NOT att.attisdropped
    GROUP BY n.nspname, c.relname
) sub;
-- END_SECTION_2_GENERATOR
