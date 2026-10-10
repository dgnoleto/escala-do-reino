-- Escala do Reino: pré-verificação somente leitura para o incremento de convites de acesso.
-- Valida estrutura prévia, codificação UTF-8, extensões e funções criptográficas (SHA-256 e CSPRNG),
-- tipos/atributos de colunas, restrições físicas, gatilhos de continuidade administrativa,
-- ausência de dados corrompidos ou evolução parcial inesperada, e bloqueio estrito de app_private.
-- Retorna exatamente 11 indicadores booleanos. Esperado: todos true.
-- Não altera dados, esquemas ou privilégios.

with checks as (
  select
    -- 1. Codificação e ambiente da sessão
    (
      current_setting('server_encoding') = 'UTF8'
      and current_setting('client_encoding') = 'UTF8'
    ) as server_and_client_utf8,

    -- 2. Presença íntegra das 7 tabelas dos incrementos 001–009
    (
      to_regclass('app_private.churches') is not null
      and to_regclass('app_private.members') is not null
      and to_regclass('app_private.church_access') is not null
      and to_regclass('app_private.access_invitations') is not null
      and to_regclass('app_private.access_requests') is not null
      and to_regclass('app_private.audit_entries') is not null
      and to_regclass('app_private.command_receipts') is not null
    ) as previous_seven_tables_present,

    -- 3. Presença íntegra das 7 RPCs instaladas dos incrementos 005, 007 e 009
    (
      to_regprocedure('public.get_my_church_access()') is not null
      and to_regprocedure('public.list_church_members(uuid, integer, integer)') is not null
      and to_regprocedure('public.create_church_member(uuid, uuid, text)') is not null
      and to_regprocedure('public.get_create_member_receipt(uuid, uuid)') is not null
      and to_regprocedure('public.check_church_creation_eligibility()') is not null
      and to_regprocedure('public.create_my_church(uuid, text, text, text, text, text, text)') is not null
      and to_regprocedure('public.get_create_church_receipt(uuid)') is not null
    ) as previous_seven_rpcs_present,

    -- 4. Primitivas criptográficas necessárias (SHA-256 e CSPRNG confiável sem fallbacks fracos)
    (
      -- sha256 nativo do pg_catalog
      exists (
        select 1 from pg_catalog.pg_proc p
        join pg_catalog.pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'pg_catalog' and p.proname = 'sha256'
      )
      -- gen_random_uuid nativo no catálogo
      and exists (
        select 1 from pg_catalog.pg_proc p
        join pg_catalog.pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'pg_catalog' and p.proname = 'gen_random_uuid'
      )
      -- gen_random_bytes(integer) estritamente disponível com assinatura integer, retorno bytea e pertencimento a pgcrypto ou pg_catalog
      and exists (
        select 1 from pg_catalog.pg_proc p
        join pg_catalog.pg_namespace n on n.oid = p.pronamespace
        left join pg_catalog.pg_depend d on d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e'
        left join pg_catalog.pg_extension ext on ext.oid = d.refobjid
        where p.proname = 'gen_random_bytes'
          and n.nspname in ('extensions', 'public', 'pg_catalog')
          and p.pronargs = 1
          and p.proargtypes[0] = 'integer'::regtype
          and p.prorettype = 'bytea'::regtype
          and (n.nspname = 'pg_catalog' or ext.extname = 'pgcrypto')
      )
    ) as crypto_primitives_available,

    -- 5. Tipos e atributos de colunas essenciais nas tabelas existentes
    (
      -- auth.users
      exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name = 'email_confirmed_at' and data_type = 'timestamp with time zone')
      and exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name = 'deleted_at' and data_type = 'timestamp with time zone')
      and exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name = 'banned_until' and data_type = 'timestamp with time zone')
      and exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name = 'is_anonymous' and data_type = 'boolean')
      -- app_private.access_invitations
      and exists (select 1 from information_schema.columns where table_schema = 'app_private' and table_name = 'access_invitations' and column_name = 'token_digest' and data_type = 'bytea')
      and exists (select 1 from information_schema.columns where table_schema = 'app_private' and table_name = 'access_invitations' and column_name = 'recipient_email' and data_type = 'text')
      and exists (select 1 from information_schema.columns where table_schema = 'app_private' and table_name = 'access_invitations' and column_name = 'issued_at' and data_type = 'timestamp with time zone')
      and exists (select 1 from information_schema.columns where table_schema = 'app_private' and table_name = 'access_invitations' and column_name = 'expires_at' and data_type = 'timestamp with time zone')
      and exists (select 1 from information_schema.columns where table_schema = 'app_private' and table_name = 'access_invitations' and column_name = 'redeemed_at' and data_type = 'timestamp with time zone')
      and exists (select 1 from information_schema.columns where table_schema = 'app_private' and table_name = 'access_invitations' and column_name = 'redeemed_by_user_id' and data_type = 'uuid')
      and exists (select 1 from information_schema.columns where table_schema = 'app_private' and table_name = 'access_invitations' and column_name = 'revoked_at' and data_type = 'timestamp with time zone')
      and exists (select 1 from information_schema.columns where table_schema = 'app_private' and table_name = 'access_invitations' and column_name = 'revoked_by_user_id' and data_type = 'uuid')
      -- app_private.access_requests
      and exists (select 1 from information_schema.columns where table_schema = 'app_private' and table_name = 'access_requests' and column_name = 'invitation_id' and data_type = 'uuid')
      and exists (select 1 from information_schema.columns where table_schema = 'app_private' and table_name = 'access_requests' and column_name = 'original_display_name' and data_type = 'text')
      and exists (select 1 from information_schema.columns where table_schema = 'app_private' and table_name = 'access_requests' and column_name = 'proposed_display_name' and data_type = 'text')
      and exists (select 1 from information_schema.columns where table_schema = 'app_private' and table_name = 'access_requests' and column_name = 'submitted_at' and data_type = 'timestamp with time zone')
      and exists (select 1 from information_schema.columns where table_schema = 'app_private' and table_name = 'access_requests' and column_name = 'expires_at' and data_type = 'timestamp with time zone')
      and exists (select 1 from information_schema.columns where table_schema = 'app_private' and table_name = 'access_requests' and column_name = 'status' and data_type = 'text')
      and exists (select 1 from information_schema.columns where table_schema = 'app_private' and table_name = 'access_requests' and column_name = 'decided_at' and data_type = 'timestamp with time zone')
      and exists (select 1 from information_schema.columns where table_schema = 'app_private' and table_name = 'access_requests' and column_name = 'decided_by_user_id' and data_type = 'uuid')
      -- app_private.command_receipts
      and exists (select 1 from information_schema.columns where table_schema = 'app_private' and table_name = 'command_receipts' and column_name = 'action' and data_type = 'text')
      and exists (select 1 from information_schema.columns where table_schema = 'app_private' and table_name = 'command_receipts' and column_name = 'params_hash' and data_type = 'bytea')
      and exists (select 1 from information_schema.columns where table_schema = 'app_private' and table_name = 'command_receipts' and column_name = 'result_member_id' and data_type = 'uuid')
    ) as required_table_columns_present,

    -- 6. Índices estruturais e seus predicados exatos
    (
      -- Índice parcial único: um convite aberto por membro
      exists (
        select 1 from pg_catalog.pg_index ix
        join pg_catalog.pg_class c on c.oid = ix.indexrelid
        join pg_catalog.pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'app_private' and c.relname = 'access_invitations_one_open_per_member'
          and ix.indisunique = true
          and pg_catalog.pg_get_expr(ix.indpred, ix.indrelid) ~* 'redeemed_at.*is.*null.*revoked_at.*is.*null'
      )
      -- Índice parcial único: administração única por conta
      and exists (
        select 1 from pg_catalog.pg_index ix
        join pg_catalog.pg_class c on c.oid = ix.indexrelid
        join pg_catalog.pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'app_private' and c.relname = 'church_access_single_active_admin_idx'
          and ix.indisunique = true
          and pg_catalog.pg_get_expr(ix.indpred, ix.indrelid) ~* 'is_admin.*true.*status.*active'
      )
    ) as required_indexes_and_predicates_present,

    -- 7. Gatilhos de salvaguarda de continuidade administrativa habilitados e vinculados
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
    ) as required_triggers_and_functions_present,

    -- 8. Restrições físicas (FK e CHECKs) essenciais
    (
      -- FK composta de solicitações sobre convites consumidos
      exists (
        select 1 from information_schema.table_constraints
        where table_schema = 'app_private' and table_name = 'access_requests'
          and constraint_name = 'requests_consumed_invitation_fk'
      )
      -- Restrição de 72 horas exatas
      and exists (
        select 1 from information_schema.check_constraints
        where constraint_schema = 'app_private'
          and constraint_name = 'access_invitations_expiration'
      )
      -- Restrição de terminalidade de convites
      and exists (
        select 1 from information_schema.check_constraints
        where constraint_schema = 'app_private'
          and constraint_name = 'access_invitations_terminal_state'
      )
      -- Restrição de estado de revogação de acessos
      and exists (
        select 1 from information_schema.check_constraints
        where constraint_schema = 'app_private'
          and constraint_name = 'church_access_revocation_state'
      )
    ) as required_physical_constraints_present,

    -- 9. Integridade de dados e ausência de evolução parcial conflitante
    (
      -- Ausência de dados corrompidos
      not exists (
        select 1 from app_private.access_invitations
        where redeemed_at is not null and revoked_at is not null
      )
      and not exists (
        select 1 from app_private.access_invitations
        where expires_at <> issued_at + interval '72 hours'
      )
      and not exists (
        select 1 from app_private.access_requests
        where status = 'approved' and decided_at >= expires_at
      )
      -- Ausência de colunas parciais conflitantes em command_receipts
      and not exists (
        select 1 from information_schema.columns
        where table_schema = 'app_private' and table_name = 'command_receipts'
          and (
            (column_name = 'result_entity_id' and (data_type <> 'uuid' or is_nullable <> 'YES' or column_default is not null))
            or (column_name = 'result_payload' and (data_type <> 'jsonb' or is_nullable <> 'YES' or column_default is not null))
          )
      )
      -- E se command_receipts_payload_check já existir, ausência de constraint conflitante
      and not exists (
        select 1 from pg_catalog.pg_constraint con
        join pg_catalog.pg_class c on c.oid = con.conrelid
        join pg_catalog.pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'app_private' and c.relname = 'command_receipts'
          and con.conname = 'command_receipts_payload_check'
          and (
            pg_catalog.pg_get_constraintdef(con.oid) !~* 'result_payload\s+is\s+null'
            or pg_catalog.pg_get_constraintdef(con.oid) !~* 'jsonb_typeof\s*\(\s*result_payload\s*\)\s*=\s*''object'''
            or pg_catalog.pg_get_constraintdef(con.oid) !~* 'octet_length\s*\(\s*\(?\s*result_payload\s*\)?::text\s*\)\s*<=\s*4096'
          )
      )
    ) as no_corrupted_data_or_partial_evolution_in_existing_tables,

    -- 10. Ausência prévia das novas 9 RPCs em public
    (
      to_regprocedure('public.issue_church_invitation(uuid, uuid, uuid, text)') is null
      and to_regprocedure('public.get_invitation_details(text)') is null
      and to_regprocedure('public.redeem_invitation_confirm_name(uuid, text, text)') is null
      and to_regprocedure('public.redeem_invitation_propose_name(uuid, text, text)') is null
      and to_regprocedure('public.get_my_access_request(uuid)') is null
      and to_regprocedure('public.list_church_invitations(uuid, text, integer, integer)') is null
      and to_regprocedure('public.list_church_access_requests(uuid, text, integer, integer)') is null
      and to_regprocedure('public.decide_access_request(uuid, uuid, uuid, text)') is null
      and to_regprocedure('public.get_invitation_command_receipt(uuid)') is null
    ) as new_nine_rpcs_not_yet_installed,

    -- 11. Schema e tabelas app_private com RLS ativo e estritamente inacessíveis
    (
      (
        select count(*) = 7 and bool_and(c.relrowsecurity)
        from pg_catalog.pg_class c
        join pg_catalog.pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'app_private' and c.relkind = 'r'
          and c.relname in (
            'churches', 'members', 'church_access', 'access_invitations',
            'access_requests', 'audit_entries', 'command_receipts'
          )
      )
      and not exists (
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
      )
    ) as app_private_strictly_blocked_and_rls_active
)
select * from checks;
