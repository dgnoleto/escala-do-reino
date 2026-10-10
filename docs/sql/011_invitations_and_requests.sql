-- ============================================================================
-- ARQUIVO GERADO AUTOMATICAMENTE A PARTIR DE docs/sql/src_011/
-- NÃO EDITE ESTE ARQUIVO DIRETAMENTE. EDITE OS ARQUIVOS FONTE EM src_011/
-- E REEXECUTE: node tools/generate-sql-011.js
-- ============================================================================
-- Escala do Reino: convites de acesso, aprovação de nome e ciclo de recibos idempotente.
-- Instalação transacional das 9 RPCs e evolução compatível de app_private.command_receipts.
-- app_private continua fora da Data API e sem acesso direto para clientes.
-- Apenas executar permanentemente após aprovação formal do responsável e ensaio com PASS.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $preflight$
declare
  v_role text;
begin
  if current_setting('server_encoding') <> 'UTF8'
     or current_setting('client_encoding') <> 'UTF8' then
    raise exception 'Banco e conexão precisam usar UTF8.';
  end if;

  if to_regclass('auth.users') is null
     or to_regclass('app_private.churches') is null
     or to_regclass('app_private.members') is null
     or to_regclass('app_private.church_access') is null
     or to_regclass('app_private.access_invitations') is null
     or to_regclass('app_private.access_requests') is null
     or to_regclass('app_private.audit_entries') is null
     or to_regclass('app_private.command_receipts') is null
     or to_regprocedure('public.get_my_church_access()') is null
     or to_regprocedure('public.list_church_members(uuid, integer, integer)') is null
     or to_regprocedure('public.create_church_member(uuid, uuid, text)') is null
     or to_regprocedure('public.get_create_member_receipt(uuid, uuid)') is null
     or to_regprocedure('public.check_church_creation_eligibility()') is null
     or to_regprocedure('public.create_my_church(uuid, text, text, text, text, text, text)') is null
     or to_regprocedure('public.get_create_church_receipt(uuid)') is null then
    raise exception 'Estrutura dos incrementos anteriores (001–010) ausente. Parar e conferir.';
  end if;

  -- Exige função gen_random_bytes(integer) com retorno bytea em schema confiável e pertencente à extensão confiável pgcrypto ou catálogo nativo
  if not exists (
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
  ) then
    raise exception 'Função gen_random_bytes(integer) com retorno bytea não encontrada em schema/extensão confiável (pgcrypto/pg_catalog). Parar e conferir.';
  end if;

  -- Detecta previamente colunas ou constraint em command_receipts com configurações incompatíveis
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'app_private' and table_name = 'command_receipts'
      and (
        (column_name = 'result_entity_id' and (data_type <> 'uuid' or is_nullable <> 'YES' or column_default is not null))
        or (column_name = 'result_payload' and (data_type <> 'jsonb' or is_nullable <> 'YES' or column_default is not null))
      )
  ) or exists (
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
  ) then
    raise exception 'Tabela app_private.command_receipts possui colunas ou constraint de resultado incompatíveis. Parar e revisar.';
  end if;

  if exists (
    select 1 from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'issue_church_invitation',
        'get_invitation_details',
        'redeem_invitation_confirm_name',
        'redeem_invitation_propose_name',
        'get_my_access_request',
        'list_church_invitations',
        'list_church_access_requests',
        'decide_access_request',
        'get_invitation_command_receipt'
      )
  ) then
    raise exception 'Um ou mais endpoints de convites já existem em public. Parar e revisar.';
  end if;

  foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
    if has_schema_privilege(v_role, 'app_private', 'USAGE,CREATE')
       or exists (
         select 1 from pg_catalog.pg_class c
         join pg_catalog.pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'app_private' and c.relkind = 'r'
           and has_table_privilege(v_role, c.oid,
             'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
       ) then
      raise exception 'Permissões internas inesperadas em app_private para %. Parar e revisar.', v_role;
    end if;
  end loop;
end;
$preflight$;

-- 1. Evolução compatível de command_receipts para replay estruturado
do $evolve_receipts$
declare
  v_col_entity record;
  v_col_payload record;
  v_con_def text;
begin
  select data_type, is_nullable, column_default
  into v_col_entity
  from information_schema.columns
  where table_schema = 'app_private' and table_name = 'command_receipts' and column_name = 'result_entity_id';

  if v_col_entity.data_type is not null then
    if v_col_entity.data_type <> 'uuid' or v_col_entity.is_nullable <> 'YES' or v_col_entity.column_default is not null then
      raise exception 'Coluna result_entity_id preexistente incompatível (esperado uuid, nullable, sem default). Parar e revisar.';
    end if;
  else
    alter table app_private.command_receipts add column result_entity_id uuid;
  end if;

  select data_type, is_nullable, column_default
  into v_col_payload
  from information_schema.columns
  where table_schema = 'app_private' and table_name = 'command_receipts' and column_name = 'result_payload';

  if v_col_payload.data_type is not null then
    if v_col_payload.data_type <> 'jsonb' or v_col_payload.is_nullable <> 'YES' or v_col_payload.column_default is not null then
      raise exception 'Coluna result_payload preexistente incompatível (esperado jsonb, nullable, sem default). Parar e revisar.';
    end if;
  else
    alter table app_private.command_receipts add column result_payload jsonb;
  end if;

  select pg_get_constraintdef(c.oid)
  into v_con_def
  from pg_catalog.pg_constraint c
  join pg_catalog.pg_namespace n on n.oid = c.connamespace
  where n.nspname = 'app_private' and c.conrelid = 'app_private.command_receipts'::regclass
    and c.conname = 'command_receipts_payload_check';

  if v_con_def is not null then
    if v_con_def !~* 'result_payload\s+is\s+null'
       or v_con_def !~* 'jsonb_typeof\s*\(\s*result_payload\s*\)\s*=\s*''object'''
       or v_con_def !~* 'octet_length\s*\(\s*\(?\s*result_payload\s*\)?::text\s*\)\s*<=\s*4096' then
      raise exception 'Constraint command_receipts_payload_check preexistente incompatível: %. Parar e revisar.', v_con_def;
    end if;
  else
    alter table app_private.command_receipts
      add constraint command_receipts_payload_check
      check (
        result_payload is null
        or (jsonb_typeof(result_payload) = 'object' and octet_length(result_payload::text) <= 4096)
      );
  end if;
end;
$evolve_receipts$;

-- 2. Endpoint: issue_church_invitation (Emissão e Reemissão Administrativa)
create function public.issue_church_invitation(
  p_command_id uuid,
  p_church_id uuid,
  p_member_id uuid,
  p_recipient_email text
)
returns table (
  invitation_id uuid,
  church_id uuid,
  member_id uuid,
  recipient_email text,
  raw_token text,
  expires_at timestamptz,
  issued_at timestamptz,
  previous_invitation_revoked boolean,
  previous_request_cancelled boolean
)
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $function$
declare
  v_user_id uuid;
  v_clean_email text;
  v_params_json jsonb;
  v_params_hash bytea;
  v_existing_action text;
  v_existing_hash bytea;
  v_existing_payload jsonb;
  v_church_id uuid;
  v_access_id uuid;
  v_target_member_id uuid;
  v_prev_invitation_id uuid;
  v_prev_request_id uuid;
  v_prev_request_expires timestamptz;
  v_crypto_ns text;
  v_raw_bytes bytea;
  v_raw_token text;
  v_token_digest bytea;
  v_now timestamptz;
  v_expires_at timestamptz;
  v_new_invitation_id uuid;
  v_result_payload jsonb;
  v_prev_inv_revoked boolean := false;
  v_prev_req_cancelled boolean := false;
begin
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if p_command_id is null or p_church_id is null or p_member_id is null or p_recipient_email is null then
    raise exception 'Parâmetros obrigatórios incompletos.' using errcode = '22004';
  end if;

  v_clean_email := pg_catalog.lower(pg_catalog.btrim(p_recipient_email));
  if char_length(v_clean_email) < 3 or char_length(v_clean_email) > 254
     or v_clean_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Endereço de e-mail inválido.' using errcode = '23514';
  end if;

  v_params_json := jsonb_build_object(
    'v', 2,
    'action', 'issue_invitation',
    'church_id', p_church_id,
    'member_id', p_member_id,
    'recipient_email', v_clean_email
  );
  v_params_hash := pg_catalog.sha256(pg_catalog.convert_to(v_params_json::text, 'UTF8'));

  -- Serialização transacional do comando por (auth.uid(), command_id) antes de bloqueios de domínio
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(v_user_id::text), pg_catalog.hashtext(p_command_id::text));

  -- Reconsulta de recibo existente
  select cr.action, cr.params_hash, cr.result_payload
  into v_existing_action, v_existing_hash, v_existing_payload
  from app_private.command_receipts cr
  where cr.user_id = v_user_id and cr.command_id = p_command_id;

  if v_existing_hash is not null then
    if v_existing_action <> 'issue_invitation' or v_existing_hash <> v_params_hash then
      raise exception 'Comando já executado com parâmetros diferentes.' using errcode = '23505';
    end if;

    -- Revalidação estrita da autorização administrativa atual antes do replay
    if not exists (
      select 1
      from app_private.church_access ca
      join auth.users u on u.id = ca.user_id
      join app_private.churches c on c.id = ca.church_id
      join app_private.members m on m.church_id = ca.church_id and m.id = ca.member_id
      where ca.church_id = p_church_id
        and ca.user_id = v_user_id
        and ca.is_admin = true
        and ca.status = 'active'
        and ca.onboarding_completed_at is not null
        and c.status = 'active'
        and m.status = 'active'
        and u.email_confirmed_at is not null
        and u.deleted_at is null
        and not coalesce(u.is_anonymous, false)
        and (u.banned_until is null or u.banned_until <= clock_timestamp())
    ) then
      raise exception 'Acesso administrativo não autorizado nesta igreja.' using errcode = '42501';
    end if;

    -- Replay de emissão: raw_token não recuperável por segurança
    return query
    select
      (v_existing_payload->>'invitation_id')::uuid,
      (v_existing_payload->>'church_id')::uuid,
      (v_existing_payload->>'member_id')::uuid,
      (v_existing_payload->>'recipient_email')::text,
      null::text,
      (v_existing_payload->>'expires_at')::timestamptz,
      (v_existing_payload->>'issued_at')::timestamptz,
      coalesce((v_existing_payload->>'previous_invitation_revoked')::boolean, false),
      coalesce((v_existing_payload->>'previous_request_cancelled')::boolean, false);
    return;
  end if;

  -- Bloqueios de domínio na ordem canônica:
  -- 1) Igreja SHARE
  select c.id into v_church_id
  from app_private.churches c
  where c.id = p_church_id and c.status = 'active'
  for share;

  if v_church_id is null then
    raise exception 'Igreja não encontrada ou inativa.' using errcode = 'P0002';
  end if;

  -- 2) Operador SHARE
  select ca.id into v_access_id
  from app_private.church_access ca
  join auth.users u on u.id = ca.user_id
  join app_private.members m on m.church_id = ca.church_id and m.id = ca.member_id
  where ca.church_id = p_church_id
    and ca.user_id = v_user_id
    and ca.is_admin = true
    and ca.status = 'active'
    and ca.onboarding_completed_at is not null
    and m.status = 'active'
    and u.email_confirmed_at is not null
    and u.deleted_at is null
    and not coalesce(u.is_anonymous, false)
    and (u.banned_until is null or u.banned_until <= clock_timestamp())
  for share;

  if v_access_id is null then
    raise exception 'Acesso administrativo não autorizado nesta igreja.' using errcode = '42501';
  end if;

  -- 3) Membro Alvo FOR UPDATE
  select m.id into v_target_member_id
  from app_private.members m
  where m.church_id = p_church_id and m.id = p_member_id and m.status = 'active'
  for update;

  if v_target_member_id is null then
    raise exception 'Membro não encontrado ou inativo.' using errcode = 'P0002';
  end if;

  -- Revalida ausência de vínculo ativo para o membro
  if exists (
    select 1 from app_private.church_access ca
    where ca.church_id = p_church_id and ca.member_id = p_member_id and ca.status = 'active'
  ) then
    raise exception 'Membro já possui acesso ativo na igreja.' using errcode = '23505';
  end if;

  -- Proibição de bypass de revogação
  if exists (
    select 1 from app_private.church_access ca
    where ca.church_id = p_church_id and ca.member_id = p_member_id and ca.status = 'revoked'
  ) then
    raise exception 'Membro possui vínculo anterior revogado. Convite não pode reativar vínculo revogado.' using errcode = '42501';
  end if;

  -- 4) Finalização de convite aberto anterior
  select ai.id into v_prev_invitation_id
  from app_private.access_invitations ai
  where ai.church_id = p_church_id and ai.member_id = p_member_id
    and ai.redeemed_at is null and ai.revoked_at is null
  for update;

  if v_prev_invitation_id is not null then
    update app_private.access_invitations
    set revoked_at = clock_timestamp(),
        revoked_by_user_id = v_user_id
    where id = v_prev_invitation_id;

    v_prev_inv_revoked := true;

    insert into app_private.audit_entries (
      church_id, action, actor_user_id, actor_source, maintenance_operator,
      target_type, target_id, details, occurred_at
    ) values (
      p_church_id, 'revoke_access_invitation', v_user_id, 'application', null,
      'access_invitations', v_prev_invitation_id,
      jsonb_build_object('reason', 'reissued_by_admin', 'member_id', p_member_id),
      clock_timestamp()
    );
  end if;

  -- 5) Se houver solicitação de alteração de nome pendente para este membro
  select ar.id, ar.expires_at into v_prev_request_id, v_prev_request_expires
  from app_private.access_requests ar
  where ar.church_id = p_church_id and ar.member_id = p_member_id and ar.status = 'pending'
  for update;

  if v_prev_request_id is not null then
    v_now := clock_timestamp();
    if v_now < v_prev_request_expires then
      update app_private.access_requests
      set status = 'cancelled',
          decided_at = v_now,
          decided_by_user_id = v_user_id
      where id = v_prev_request_id;

      v_prev_req_cancelled := true;

      insert into app_private.audit_entries (
        church_id, action, actor_user_id, actor_source, maintenance_operator,
        target_type, target_id, details, occurred_at
      ) values (
        p_church_id, 'cancel_access_request', v_user_id, 'application', null,
        'access_requests', v_prev_request_id,
        jsonb_build_object('reason', 'cancelled_due_to_invitation_reissue', 'member_id', p_member_id),
        v_now
      );
    else
      update app_private.access_requests
      set status = 'expired',
          decided_at = v_now,
          decided_by_user_id = null
      where id = v_prev_request_id;

      insert into app_private.audit_entries (
        church_id, action, actor_user_id, actor_source, maintenance_operator,
        target_type, target_id, details, occurred_at
      ) values (
        p_church_id, 'expire_access_request', v_user_id, 'application', null,
        'access_requests', v_prev_request_id,
        jsonb_build_object('reason', 'expired_without_decision', 'member_id', p_member_id),
        v_now
      );
    end if;
  end if;

  -- Geração CSPRNG estrita de 32 bytes (256 bits) sem fallbacks fracos
  select n.nspname into v_crypto_ns
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  left join pg_catalog.pg_depend d on d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e'
  left join pg_catalog.pg_extension ext on ext.oid = d.refobjid
  where p.proname = 'gen_random_bytes'
    and n.nspname in ('extensions', 'public', 'pg_catalog')
    and p.pronargs = 1
    and p.proargtypes[0] = 'integer'::regtype
    and p.prorettype = 'bytea'::regtype
    and (n.nspname = 'pg_catalog' or ext.extname = 'pgcrypto')
  order by case when n.nspname = 'extensions' then 1 when n.nspname = 'public' then 2 else 3 end
  limit 1;

  if v_crypto_ns is null then
    raise exception 'Função gen_random_bytes(integer) não disponível no ambiente.' using errcode = '0A000';
  end if;

  execute format('select %I.gen_random_bytes(32)', v_crypto_ns) into v_raw_bytes;

  if v_raw_bytes is null or octet_length(v_raw_bytes) <> 32 then
    raise exception 'Falha na geração de entropia criptográfica.' using errcode = 'XX000';
  end if;

  v_raw_token := pg_catalog.rtrim(
    pg_catalog.replace(
      pg_catalog.replace(
        pg_catalog.replace(
          pg_catalog.encode(v_raw_bytes, 'base64'),
          '+', '-'
        ),
        '/', '_'
      ),
      E'\n', ''
    ),
    '='
  );

  v_token_digest := pg_catalog.sha256(pg_catalog.convert_to(v_raw_token, 'UTF8'));

  -- Captura do relógio no instante exato pós-bloqueios para cumprimento da restrição física de 72h
  v_now := clock_timestamp();
  v_expires_at := v_now + interval '72 hours';
  v_new_invitation_id := gen_random_uuid();

  insert into app_private.access_invitations (
    id, church_id, member_id, recipient_email, token_digest,
    issued_by_user_id, issued_at, expires_at
  ) values (
    v_new_invitation_id, p_church_id, p_member_id, v_clean_email, v_token_digest,
    v_user_id, v_now, v_expires_at
  );

  insert into app_private.audit_entries (
    church_id, action, actor_user_id, actor_source, maintenance_operator,
    target_type, target_id, details, occurred_at
  ) values (
    p_church_id, 'issue_access_invitation', v_user_id, 'application', null,
    'access_invitations', v_new_invitation_id,
    jsonb_build_object(
      'member_id', p_member_id,
      'expires_at', v_expires_at,
      'reissue', (v_prev_inv_revoked or v_prev_req_cancelled)
    ),
    v_now
  );

  v_result_payload := jsonb_build_object(
    'invitation_id', v_new_invitation_id,
    'church_id', p_church_id,
    'member_id', p_member_id,
    'recipient_email', v_clean_email,
    'expires_at', v_expires_at,
    'issued_at', v_now,
    'previous_invitation_revoked', v_prev_inv_revoked,
    'previous_request_cancelled', v_prev_req_cancelled,
    'link_unrecoverable', true
  );

  insert into app_private.command_receipts (
    church_id, user_id, command_id, action, params_hash,
    result_member_id, result_entity_id, result_payload, created_at
  ) values (
    p_church_id, v_user_id, p_command_id, 'issue_invitation', v_params_hash,
    p_member_id, v_new_invitation_id, v_result_payload, v_now
  );

  return query
  select
    v_new_invitation_id,
    p_church_id,
    p_member_id,
    v_clean_email,
    v_raw_token,
    v_expires_at,
    v_now,
    v_prev_inv_revoked,
    v_prev_req_cancelled;
end;
$function$;

-- 3. Endpoint: get_invitation_details (Consulta Autorizada Estrita)
create function public.get_invitation_details(
  p_raw_token text
)
returns table (
  invitation_id uuid,
  church_id uuid,
  church_name text,
  member_id uuid,
  member_display_name text,
  expires_at timestamptz,
  is_valid boolean
)
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '5s'
as $function$
declare
  v_user_id uuid;
  v_user_email text;
  v_email_confirmed boolean;
  v_not_deleted boolean;
  v_not_banned boolean;
  v_not_anon boolean;
  v_token_digest bytea;
  v_invitation_id uuid;
  v_church_id uuid;
  v_church_name text;
  v_member_id uuid;
  v_member_display_name text;
  v_expires_at timestamptz;
  v_recipient_email text;
  v_redeemed_at timestamptz;
  v_revoked_at timestamptz;
  v_church_status text;
  v_member_status text;
begin
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  select
    u.email,
    (u.email_confirmed_at is not null),
    (u.deleted_at is null),
    (u.banned_until is null or u.banned_until <= clock_timestamp()),
    not coalesce(u.is_anonymous, false)
  into v_user_email, v_email_confirmed, v_not_deleted, v_not_banned, v_not_anon
  from auth.users u
  where u.id = v_user_id;

  -- Resposta estritamente genérica caso a conta Auth seja inelegível
  if not coalesce(v_email_confirmed, false)
     or not coalesce(v_not_deleted, false)
     or not coalesce(v_not_banned, false)
     or not coalesce(v_not_anon, false) then
    return query select null::uuid, null::uuid, null::text, null::uuid, null::text, null::timestamptz, false;
    return;
  end if;

  -- Token deve possuir formato Base64URL exato
  if p_raw_token is null or char_length(p_raw_token) not between 43 and 44
     or p_raw_token !~ '^[A-Za-z0-9_-]+$' then
    return query select null::uuid, null::uuid, null::text, null::uuid, null::text, null::timestamptz, false;
    return;
  end if;

  v_token_digest := pg_catalog.sha256(pg_catalog.convert_to(p_raw_token, 'UTF8'));

  select
    ai.id, ai.church_id, c.name, ai.member_id, m.display_name, ai.expires_at,
    ai.recipient_email, ai.redeemed_at, ai.revoked_at, c.status, m.status
  into
    v_invitation_id, v_church_id, v_church_name, v_member_id, v_member_display_name, v_expires_at,
    v_recipient_email, v_redeemed_at, v_revoked_at, v_church_status, v_member_status
  from app_private.access_invitations ai
  join app_private.churches c on c.id = ai.church_id
  join app_private.members m on m.church_id = ai.church_id and m.id = ai.member_id
  where ai.token_digest = v_token_digest;

  -- Proteção contra enumeração e correspondência exata de e-mail confirmado
  if v_invitation_id is not null
     and v_redeemed_at is null
     and v_revoked_at is null
     and clock_timestamp() < v_expires_at
     and v_church_status = 'active'
     and v_member_status = 'active'
     and pg_catalog.lower(pg_catalog.btrim(v_user_email)) = pg_catalog.lower(pg_catalog.btrim(v_recipient_email))
  then
    return query
    select v_invitation_id, v_church_id, v_church_name, v_member_id, v_member_display_name, v_expires_at, true;
  else
    return query
    select null::uuid, null::uuid, null::text, null::uuid, null::text, null::timestamptz, false;
  end if;
end;
$function$;

-- 4. Endpoint: redeem_invitation_confirm_name (Resgate Confirmando Nome Cadastrado)
create function public.redeem_invitation_confirm_name(
  p_command_id uuid,
  p_raw_token text,
  p_expected_display_name text
)
returns table (
  church_id uuid,
  church_name text,
  member_id uuid,
  display_name text,
  access_granted boolean,
  onboarding_completed_at timestamptz
)
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $function$
declare
  v_user_id uuid;
  v_user_email text;
  v_clean_expected_name text;
  v_token_digest bytea;
  v_params_json jsonb;
  v_params_hash bytea;
  v_existing_action text;
  v_existing_hash bytea;
  v_existing_payload jsonb;
  v_invitation_id uuid;
  v_church_id uuid;
  v_church_name text;
  v_member_id uuid;
  v_recipient_email text;
  v_expires_at timestamptz;
  v_issuer_id uuid;
  v_redeemed_at timestamptz;
  v_revoked_at timestamptz;
  v_locked_church_id uuid;
  v_locked_member_id uuid;
  v_current_display_name text;
  v_locked_inv_id uuid;
  v_locked_expires_at timestamptz;
  v_now timestamptz;
  v_new_access_id uuid;
  v_result_payload jsonb;
begin
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if p_command_id is null or p_raw_token is null or p_expected_display_name is null then
    raise exception 'Parâmetros obrigatórios incompletos.' using errcode = '22004';
  end if;

  if char_length(p_raw_token) not between 43 and 44 or p_raw_token !~ '^[A-Za-z0-9_-]+$' then
    raise exception 'Token de convite em formato inválido.' using errcode = '23514';
  end if;

  v_clean_expected_name := pg_catalog.btrim(pg_catalog.normalize(p_expected_display_name, 'NFC'));
  v_token_digest := pg_catalog.sha256(pg_catalog.convert_to(p_raw_token, 'UTF8'));

  v_params_json := jsonb_build_object(
    'v', 2,
    'action', 'redeem_confirm_name',
    'token_digest', pg_catalog.encode(v_token_digest, 'hex'),
    'expected_display_name', v_clean_expected_name
  );
  v_params_hash := pg_catalog.sha256(pg_catalog.convert_to(v_params_json::text, 'UTF8'));

  -- Serialização transacional do comando por (auth.uid(), command_id) antes de bloqueios de domínio
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(v_user_id::text), pg_catalog.hashtext(p_command_id::text));

  -- Reconsulta de recibo existente
  select cr.action, cr.params_hash, cr.result_payload
  into v_existing_action, v_existing_hash, v_existing_payload
  from app_private.command_receipts cr
  where cr.user_id = v_user_id and cr.command_id = p_command_id;

  if v_existing_hash is not null then
    if v_existing_action <> 'redeem_confirm_name' or v_existing_hash <> v_params_hash then
      raise exception 'Comando já executado com parâmetros diferentes.' using errcode = '23505';
    end if;

    -- Revalidação estrita da conta atual antes da entrega do replay
    if not exists (
      select 1 from auth.users u
      where u.id = v_user_id
        and u.email_confirmed_at is not null
        and u.deleted_at is null
        and not coalesce(u.is_anonymous, false)
        and (u.banned_until is null or u.banned_until <= clock_timestamp())
    ) then
      raise exception 'Conta inelegível ou e-mail não confirmado.' using errcode = '42501';
    end if;

    return query
    select
      (v_existing_payload->>'church_id')::uuid,
      (v_existing_payload->>'church_name')::text,
      (v_existing_payload->>'member_id')::uuid,
      (v_existing_payload->>'display_name')::text,
      coalesce((v_existing_payload->>'access_granted')::boolean, true),
      (v_existing_payload->>'onboarding_completed_at')::timestamptz;
    return;
  end if;

  -- Localização prévia do convite pelo digest para ordenação canônica de bloqueios
  select ai.id, ai.church_id, ai.member_id, ai.recipient_email, ai.expires_at,
         ai.issued_by_user_id, ai.redeemed_at, ai.revoked_at
  into v_invitation_id, v_church_id, v_member_id, v_recipient_email, v_expires_at,
       v_issuer_id, v_redeemed_at, v_revoked_at
  from app_private.access_invitations ai
  where ai.token_digest = v_token_digest;

  if v_invitation_id is null or v_revoked_at is not null or v_redeemed_at is not null
     or clock_timestamp() >= v_expires_at then
    raise exception 'Convite inválido, revogado ou expirado.' using errcode = 'P0002';
  end if;

  -- Bloqueios de domínio na ordem canônica:
  -- 1) Igreja SHARE
  select c.id, c.name into v_locked_church_id, v_church_name
  from app_private.churches c
  where c.id = v_church_id and c.status = 'active'
  for share;

  if v_locked_church_id is null then
    raise exception 'Igreja inativa ou não encontrada.' using errcode = 'P0002';
  end if;

  -- 2) Membro Alvo UPDATE
  select m.id, m.display_name into v_locked_member_id, v_current_display_name
  from app_private.members m
  where m.church_id = v_church_id and m.id = v_member_id and m.status = 'active'
  for update;

  if v_locked_member_id is null then
    raise exception 'Membro inativo ou não encontrado.' using errcode = 'P0002';
  end if;

  -- 3) Convite UPDATE
  select ai.id, ai.expires_at, ai.recipient_email into v_locked_inv_id, v_locked_expires_at, v_recipient_email
  from app_private.access_invitations ai
  where ai.id = v_invitation_id and ai.redeemed_at is null and ai.revoked_at is null
  for update;

  if v_locked_inv_id is null then
    raise exception 'Convite não está mais aberto.' using errcode = 'P0002';
  end if;

  -- Revalidações estritas no instante pós-bloqueio no relógio atual
  v_now := clock_timestamp();
  if v_now >= v_locked_expires_at then
    raise exception 'Convite expirado.' using errcode = 'P0004';
  end if;

  -- Releitura da conta Auth no instante final pós-locks
  select u.email into v_user_email
  from auth.users u
  where u.id = v_user_id
    and u.email_confirmed_at is not null
    and u.deleted_at is null
    and not coalesce(u.is_anonymous, false)
    and (u.banned_until is null or u.banned_until <= v_now);

  if v_user_email is null then
    raise exception 'Conta inelegível ou e-mail não confirmado.' using errcode = '42501';
  end if;

  if pg_catalog.lower(pg_catalog.btrim(v_user_email)) <> pg_catalog.lower(pg_catalog.btrim(v_recipient_email)) then
    raise exception 'Convite não associado a esta conta.' using errcode = '42501';
  end if;

  if exists (
    select 1 from app_private.church_access ca
    where ca.church_id = v_church_id and ca.user_id = v_user_id and ca.status = 'active'
  ) then
    raise exception 'Usuário já possui acesso ativo nesta igreja.' using errcode = '23505';
  end if;

  if exists (
    select 1 from app_private.church_access ca
    where ca.church_id = v_church_id and ca.member_id = v_member_id and ca.status = 'active'
  ) then
    raise exception 'Membro já vinculado a outro acesso ativo.' using errcode = '23505';
  end if;

  -- Proibição de bypass de revogação
  if exists (
    select 1 from app_private.church_access ca
    where ca.church_id = v_church_id and (ca.user_id = v_user_id or ca.member_id = v_member_id)
      and ca.status = 'revoked'
  ) then
    raise exception 'Vínculo anterior revogado detectado. Resgate não pode reativar acesso revogado.' using errcode = '42501';
  end if;

  if v_current_display_name <> v_clean_expected_name then
    raise exception 'Nome do membro foi alterado antes da confirmação.' using errcode = 'P0005';
  end if;

  -- Consumo atômico do convite
  update app_private.access_invitations
  set redeemed_at = v_now,
      redeemed_by_user_id = v_user_id
  where id = v_invitation_id;

  v_new_access_id := gen_random_uuid();

  insert into app_private.church_access (
    id, church_id, user_id, member_id, status, is_admin,
    onboarding_completed_at, granted_by_user_id, granted_at, created_at, updated_at
  ) values (
    v_new_access_id, v_church_id, v_user_id, v_member_id, 'active', false,
    v_now, v_issuer_id, v_now, v_now, v_now
  );

  insert into app_private.audit_entries (
    church_id, action, actor_user_id, actor_source, maintenance_operator,
    target_type, target_id, details, occurred_at
  ) values (
    v_church_id, 'redeem_invitation_confirm_name', v_user_id, 'application', null,
    'church_access', v_new_access_id,
    jsonb_build_object('invitation_id', v_invitation_id, 'member_id', v_member_id),
    v_now
  );

  v_result_payload := jsonb_build_object(
    'church_id', v_church_id,
    'church_name', v_church_name,
    'member_id', v_member_id,
    'display_name', v_current_display_name,
    'access_granted', true,
    'onboarding_completed_at', v_now
  );

  insert into app_private.command_receipts (
    church_id, user_id, command_id, action, params_hash,
    result_member_id, result_entity_id, result_payload, created_at
  ) values (
    v_church_id, v_user_id, p_command_id, 'redeem_confirm_name', v_params_hash,
    v_member_id, v_new_access_id, v_result_payload, v_now
  );

  return query
  select v_church_id, v_church_name, v_member_id, v_current_display_name, true, v_now;
end;
$function$;

-- 5. Endpoint: redeem_invitation_propose_name (Resgate Propondo Outro Nome)
create function public.redeem_invitation_propose_name(
  p_command_id uuid,
  p_raw_token text,
  p_proposed_display_name text
)
returns table (
  request_id uuid,
  church_id uuid,
  member_id uuid,
  original_display_name text,
  proposed_display_name text,
  status text,
  expires_at timestamptz,
  submitted_at timestamptz
)
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $function$
declare
  v_user_id uuid;
  v_user_email text;
  v_clean_proposed_name text;
  v_token_digest bytea;
  v_params_json jsonb;
  v_params_hash bytea;
  v_existing_action text;
  v_existing_hash bytea;
  v_existing_payload jsonb;
  v_invitation_id uuid;
  v_church_id uuid;
  v_member_id uuid;
  v_recipient_email text;
  v_expires_at timestamptz;
  v_redeemed_at timestamptz;
  v_revoked_at timestamptz;
  v_locked_church_id uuid;
  v_locked_member_id uuid;
  v_current_display_name text;
  v_locked_inv_id uuid;
  v_locked_expires_at timestamptz;
  v_now timestamptz;
  v_new_request_id uuid;
  v_result_payload jsonb;
begin
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if p_command_id is null or p_raw_token is null or p_proposed_display_name is null then
    raise exception 'Parâmetros obrigatórios incompletos.' using errcode = '22004';
  end if;

  if char_length(p_raw_token) not between 43 and 44 or p_raw_token !~ '^[A-Za-z0-9_-]+$' then
    raise exception 'Token de convite em formato inválido.' using errcode = '23514';
  end if;

  v_clean_proposed_name := pg_catalog.btrim(pg_catalog.normalize(p_proposed_display_name, 'NFC'));
  if char_length(v_clean_proposed_name) < 1 or char_length(v_clean_proposed_name) > 120 then
    raise exception 'Nome proposto deve ter entre 1 e 120 caracteres.' using errcode = '23514';
  end if;

  v_token_digest := pg_catalog.sha256(pg_catalog.convert_to(p_raw_token, 'UTF8'));

  v_params_json := jsonb_build_object(
    'v', 2,
    'action', 'redeem_propose_name',
    'token_digest', pg_catalog.encode(v_token_digest, 'hex'),
    'proposed_display_name', v_clean_proposed_name
  );
  v_params_hash := pg_catalog.sha256(pg_catalog.convert_to(v_params_json::text, 'UTF8'));

  -- Serialização transacional do comando por (auth.uid(), command_id) antes de bloqueios de domínio
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(v_user_id::text), pg_catalog.hashtext(p_command_id::text));

  -- Reconsulta de recibo existente
  select cr.action, cr.params_hash, cr.result_payload
  into v_existing_action, v_existing_hash, v_existing_payload
  from app_private.command_receipts cr
  where cr.user_id = v_user_id and cr.command_id = p_command_id;

  if v_existing_hash is not null then
    if v_existing_action <> 'redeem_propose_name' or v_existing_hash <> v_params_hash then
      raise exception 'Comando já executado com parâmetros diferentes.' using errcode = '23505';
    end if;

    -- Revalidação estrita da conta atual antes da entrega do replay
    if not exists (
      select 1 from auth.users u
      where u.id = v_user_id
        and u.email_confirmed_at is not null
        and u.deleted_at is null
        and not coalesce(u.is_anonymous, false)
        and (u.banned_until is null or u.banned_until <= clock_timestamp())
    ) then
      raise exception 'Conta inelegível ou e-mail não confirmado.' using errcode = '42501';
    end if;

    return query
    select
      (v_existing_payload->>'request_id')::uuid,
      (v_existing_payload->>'church_id')::uuid,
      (v_existing_payload->>'member_id')::uuid,
      (v_existing_payload->>'original_display_name')::text,
      (v_existing_payload->>'proposed_display_name')::text,
      (v_existing_payload->>'status')::text,
      (v_existing_payload->>'expires_at')::timestamptz,
      (v_existing_payload->>'submitted_at')::timestamptz;
    return;
  end if;

  -- Localização prévia do convite pelo digest
  select ai.id, ai.church_id, ai.member_id, ai.recipient_email, ai.expires_at,
         ai.redeemed_at, ai.revoked_at
  into v_invitation_id, v_church_id, v_member_id, v_recipient_email, v_expires_at,
       v_redeemed_at, v_revoked_at
  from app_private.access_invitations ai
  where ai.token_digest = v_token_digest;

  if v_invitation_id is null or v_revoked_at is not null or v_redeemed_at is not null
     or clock_timestamp() >= v_expires_at then
    raise exception 'Convite inválido, revogado ou expirado.' using errcode = 'P0002';
  end if;

  -- Bloqueios de domínio na ordem canônica:
  -- 1) Igreja SHARE
  select c.id into v_locked_church_id
  from app_private.churches c
  where c.id = v_church_id and c.status = 'active'
  for share;

  if v_locked_church_id is null then
    raise exception 'Igreja inativa ou não encontrada.' using errcode = 'P0002';
  end if;

  -- 2) Membro Alvo UPDATE
  select m.id, m.display_name into v_locked_member_id, v_current_display_name
  from app_private.members m
  where m.church_id = v_church_id and m.id = v_member_id and m.status = 'active'
  for update;

  if v_locked_member_id is null then
    raise exception 'Membro inativo ou não encontrado.' using errcode = 'P0002';
  end if;

  -- 3) Convite UPDATE
  select ai.id, ai.expires_at, ai.recipient_email into v_locked_inv_id, v_locked_expires_at, v_recipient_email
  from app_private.access_invitations ai
  where ai.id = v_invitation_id and ai.redeemed_at is null and ai.revoked_at is null
  for update;

  if v_locked_inv_id is null then
    raise exception 'Convite não está mais aberto.' using errcode = 'P0002';
  end if;

  -- Revalidações estritas no instante pós-bloqueio no relógio atual
  v_now := clock_timestamp();
  if v_now >= v_locked_expires_at then
    raise exception 'Convite expirado.' using errcode = 'P0004';
  end if;

  -- Releitura da conta Auth no instante final pós-locks
  select u.email into v_user_email
  from auth.users u
  where u.id = v_user_id
    and u.email_confirmed_at is not null
    and u.deleted_at is null
    and not coalesce(u.is_anonymous, false)
    and (u.banned_until is null or u.banned_until <= v_now);

  if v_user_email is null then
    raise exception 'Conta inelegível ou e-mail não confirmado.' using errcode = '42501';
  end if;

  if pg_catalog.lower(pg_catalog.btrim(v_user_email)) <> pg_catalog.lower(pg_catalog.btrim(v_recipient_email)) then
    raise exception 'Convite não associado a esta conta.' using errcode = '42501';
  end if;

  if exists (
    select 1 from app_private.church_access ca
    where ca.church_id = v_church_id and ca.user_id = v_user_id and ca.status = 'active'
  ) then
    raise exception 'Usuário já possui acesso ativo nesta igreja.' using errcode = '23505';
  end if;

  if exists (
    select 1 from app_private.church_access ca
    where ca.church_id = v_church_id and ca.member_id = v_member_id and ca.status = 'active'
  ) then
    raise exception 'Membro já vinculado a outro acesso ativo.' using errcode = '23505';
  end if;

  -- Proibição de bypass de revogação
  if exists (
    select 1 from app_private.church_access ca
    where ca.church_id = v_church_id and (ca.user_id = v_user_id or ca.member_id = v_member_id)
      and ca.status = 'revoked'
  ) then
    raise exception 'Vínculo anterior revogado detectado. Proposta de acesso não permitida.' using errcode = '42501';
  end if;

  if v_clean_proposed_name = v_current_display_name then
    raise exception 'Nome proposto deve ser diferente do nome atualmente cadastrado.' using errcode = '23514';
  end if;

  -- Consumo do convite primeiro (para satisfazer a FK requests_consumed_invitation_fk)
  update app_private.access_invitations
  set redeemed_at = v_now,
      redeemed_by_user_id = v_user_id
  where id = v_invitation_id;

  v_new_request_id := gen_random_uuid();

  insert into app_private.access_requests (
    id, church_id, member_id, invitation_id, requester_user_id,
    original_display_name, proposed_display_name, submitted_at, expires_at,
    status, created_at, updated_at
  ) values (
    v_new_request_id, v_church_id, v_member_id, v_invitation_id, v_user_id,
    v_current_display_name, v_clean_proposed_name, v_now, v_locked_expires_at,
    'pending', v_now, v_now
  );

  insert into app_private.audit_entries (
    church_id, action, actor_user_id, actor_source, maintenance_operator,
    target_type, target_id, details, occurred_at
  ) values (
    v_church_id, 'redeem_invitation_propose_name', v_user_id, 'application', null,
    'access_requests', v_new_request_id,
    jsonb_build_object('invitation_id', v_invitation_id, 'member_id', v_member_id),
    v_now
  );

  v_result_payload := jsonb_build_object(
    'request_id', v_new_request_id,
    'church_id', v_church_id,
    'member_id', v_member_id,
    'original_display_name', v_current_display_name,
    'proposed_display_name', v_clean_proposed_name,
    'status', 'pending',
    'expires_at', v_locked_expires_at,
    'submitted_at', v_now
  );

  insert into app_private.command_receipts (
    church_id, user_id, command_id, action, params_hash,
    result_member_id, result_entity_id, result_payload, created_at
  ) values (
    v_church_id, v_user_id, p_command_id, 'redeem_propose_name', v_params_hash,
    v_member_id, v_new_request_id, v_result_payload, v_now
  );

  return query
  select v_new_request_id, v_church_id, v_member_id, v_current_display_name, v_clean_proposed_name,
         'pending'::text, v_locked_expires_at, v_now;
end;
$function$;

-- 6. Endpoint: get_my_access_request (Consulta da Própria Solicitação)
create function public.get_my_access_request(
  p_church_id uuid
)
returns table (
  request_id uuid,
  church_id uuid,
  church_name text,
  member_id uuid,
  original_display_name text,
  proposed_display_name text,
  status text,
  expires_at timestamptz,
  submitted_at timestamptz,
  decided_at timestamptz,
  is_expired boolean
)
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '5s'
as $function$
declare
  v_user_id uuid;
begin
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if p_church_id is null then
    raise exception 'Identificador de igreja obrigatório.' using errcode = '22004';
  end if;

  -- Revalida conta elegível do solicitante (sem exigir vínculo prévio de church_access)
  if not exists (
    select 1 from auth.users u
    where u.id = v_user_id
      and u.email_confirmed_at is not null
      and u.deleted_at is null
      and not coalesce(u.is_anonymous, false)
      and (u.banned_until is null or u.banned_until <= clock_timestamp())
  ) then
    raise exception 'Conta inelegível ou e-mail não confirmado.' using errcode = '42501';
  end if;

  return query
  select
    ar.id,
    ar.church_id,
    c.name as church_name,
    ar.member_id,
    ar.original_display_name,
    ar.proposed_display_name,
    case
      when ar.status = 'pending' and clock_timestamp() >= ar.expires_at then 'expired'
      else ar.status
    end as status,
    ar.expires_at,
    ar.submitted_at,
    ar.decided_at,
    (ar.status = 'expired' or (ar.status = 'pending' and clock_timestamp() >= ar.expires_at)) as is_expired
  from app_private.access_requests ar
  join app_private.churches c on c.id = ar.church_id
  where ar.church_id = p_church_id
    and ar.requester_user_id = v_user_id
  order by ar.submitted_at desc, ar.id desc
  limit 1;
end;
$function$;

-- 7. Endpoint: list_church_invitations (Listagem Administrativa com Paginação)
create function public.list_church_invitations(
  p_church_id uuid,
  p_status_filter text default null,
  p_limit integer default 20,
  p_offset integer default 0
)
returns table (
  invitation_id uuid,
  member_id uuid,
  member_display_name text,
  recipient_email text,
  issued_at timestamptz,
  expires_at timestamptz,
  status text,
  redeemed_at timestamptz,
  revoked_at timestamptz,
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
  v_limit integer;
  v_offset integer;
begin
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if p_church_id is null then
    raise exception 'Identificador de igreja obrigatório.' using errcode = '22004';
  end if;

  -- Autorização administrativa rigorosa
  if not exists (
    select 1
    from app_private.church_access ca
    join auth.users u on u.id = ca.user_id
    join app_private.churches c on c.id = ca.church_id
    join app_private.members m on m.church_id = ca.church_id and m.id = ca.member_id
    where ca.church_id = p_church_id
      and ca.user_id = v_user_id
      and ca.is_admin = true
      and ca.status = 'active'
      and ca.onboarding_completed_at is not null
      and c.status = 'active'
      and m.status = 'active'
      and u.email_confirmed_at is not null
      and u.deleted_at is null
      and not coalesce(u.is_anonymous, false)
      and (u.banned_until is null or u.banned_until <= clock_timestamp())
  ) then
    raise exception 'Acesso administrativo não autorizado nesta igreja.' using errcode = '42501';
  end if;

  v_limit := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_offset := greatest(coalesce(p_offset, 0), 0);

  return query
  with computed_invitations as (
    select
      ai.id as inv_id,
      ai.member_id as m_id,
      m.display_name as m_name,
      ai.recipient_email as rec_email,
      ai.issued_at as iss_at,
      ai.expires_at as exp_at,
      case
        when ai.redeemed_at is not null then 'redeemed'
        when ai.revoked_at is not null then 'revoked'
        when clock_timestamp() >= ai.expires_at then 'expired'
        else 'open'
      end as eff_status,
      ai.redeemed_at as red_at,
      ai.revoked_at as rev_at
    from app_private.access_invitations ai
    join app_private.members m on m.church_id = ai.church_id and m.id = ai.member_id
    where ai.church_id = p_church_id
  )
  select
    ci.inv_id,
    ci.m_id,
    ci.m_name,
    ci.rec_email,
    ci.iss_at,
    ci.exp_at,
    ci.eff_status as status,
    ci.red_at,
    ci.rev_at,
    count(*) over() as total_count
  from computed_invitations ci
  where p_status_filter is null or p_status_filter = 'all' or ci.eff_status = p_status_filter
  order by ci.iss_at desc, ci.inv_id desc
  limit v_limit
  offset v_offset;
end;
$function$;

-- 8. Endpoint: list_church_access_requests (Listagem Administrativa com Paginação)
create function public.list_church_access_requests(
  p_church_id uuid,
  p_status_filter text default 'pending',
  p_limit integer default 20,
  p_offset integer default 0
)
returns table (
  request_id uuid,
  member_id uuid,
  current_display_name text,
  original_display_name text,
  proposed_display_name text,
  requester_email text,
  submitted_at timestamptz,
  expires_at timestamptz,
  status text,
  decided_at timestamptz,
  decided_by_name text,
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
  v_limit integer;
  v_offset integer;
begin
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if p_church_id is null then
    raise exception 'Identificador de igreja obrigatório.' using errcode = '22004';
  end if;

  -- Autorização administrativa rigorosa
  if not exists (
    select 1
    from app_private.church_access ca
    join auth.users u on u.id = ca.user_id
    join app_private.churches c on c.id = ca.church_id
    join app_private.members m on m.church_id = ca.church_id and m.id = ca.member_id
    where ca.church_id = p_church_id
      and ca.user_id = v_user_id
      and ca.is_admin = true
      and ca.status = 'active'
      and ca.onboarding_completed_at is not null
      and c.status = 'active'
      and m.status = 'active'
      and u.email_confirmed_at is not null
      and u.deleted_at is null
      and not coalesce(u.is_anonymous, false)
      and (u.banned_until is null or u.banned_until <= clock_timestamp())
  ) then
    raise exception 'Acesso administrativo não autorizado nesta igreja.' using errcode = '42501';
  end if;

  v_limit := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_offset := greatest(coalesce(p_offset, 0), 0);

  return query
  with computed_requests as (
    select
      ar.id as req_id,
      ar.member_id as m_id,
      m.display_name as cur_name,
      ar.original_display_name as orig_name,
      ar.proposed_display_name as prop_name,
      coalesce(u.email, '')::text as req_email,
      ar.submitted_at as sub_at,
      ar.expires_at as exp_at,
      case
        when ar.status = 'pending' and clock_timestamp() >= ar.expires_at then 'expired'
        else ar.status
      end as eff_status,
      ar.decided_at as dec_at,
      dm.display_name as dec_name
    from app_private.access_requests ar
    join app_private.members m on m.church_id = ar.church_id and m.id = ar.member_id
    join auth.users u on u.id = ar.requester_user_id
    left join app_private.church_access dca on dca.church_id = ar.church_id and dca.user_id = ar.decided_by_user_id
    left join app_private.members dm on dm.church_id = ar.church_id and dm.id = dca.member_id
    where ar.church_id = p_church_id
  )
  select
    cr.req_id,
    cr.m_id,
    cr.cur_name,
    cr.orig_name,
    cr.prop_name,
    cr.req_email,
    cr.sub_at,
    cr.exp_at,
    cr.eff_status as status,
    cr.dec_at,
    cr.dec_name as decided_by_name,
    count(*) over() as total_count
  from computed_requests cr
  where p_status_filter is null or p_status_filter = 'all' or cr.eff_status = p_status_filter
  order by cr.sub_at desc, cr.req_id desc
  limit v_limit
  offset v_offset;
end;
$function$;

-- 9. Endpoint: decide_access_request (Aprovação ou Rejeição Administrativa de Nome)
create function public.decide_access_request(
  p_command_id uuid,
  p_church_id uuid,
  p_request_id uuid,
  p_decision text
)
returns table (
  request_id uuid,
  member_id uuid,
  final_display_name text,
  decision text,
  access_granted boolean,
  decided_at timestamptz,
  error_code text
)
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $function$
declare
  v_user_id uuid;
  v_params_json jsonb;
  v_params_hash bytea;
  v_existing_action text;
  v_existing_hash bytea;
  v_existing_payload jsonb;
  v_church_id uuid;
  v_access_id uuid;
  v_target_member_id uuid;
  v_current_display_name text;
  v_req_id uuid;
  v_original_name text;
  v_proposed_name text;
  v_requester_user_id uuid;
  v_req_expires_at timestamptz;
  v_req_status text;
  v_invitation_id uuid;
  v_inv_id uuid;
  v_inv_recipient_email text;
  v_inv_redeemed_at timestamptz;
  v_inv_redeemed_by uuid;
  v_inv_revoked_at timestamptz;
  v_requester_email text;
  v_now timestamptz;
  v_new_access_id uuid;
  v_result_payload jsonb;
begin
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if p_command_id is null or p_church_id is null or p_request_id is null or p_decision is null then
    raise exception 'Parâmetros obrigatórios incompletos.' using errcode = '22004';
  end if;

  if p_decision not in ('approve', 'reject') then
    raise exception 'Decisão deve ser approve ou reject.' using errcode = '23514';
  end if;

  v_params_json := jsonb_build_object(
    'v', 2,
    'action', 'decide_access_request',
    'church_id', p_church_id,
    'request_id', p_request_id,
    'decision', p_decision
  );
  v_params_hash := pg_catalog.sha256(pg_catalog.convert_to(v_params_json::text, 'UTF8'));

  -- Serialização transacional do comando por (auth.uid(), command_id) antes de bloqueios de domínio
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(v_user_id::text), pg_catalog.hashtext(p_command_id::text));

  -- Reconsulta de recibo existente
  select cr.action, cr.params_hash, cr.result_payload
  into v_existing_action, v_existing_hash, v_existing_payload
  from app_private.command_receipts cr
  where cr.user_id = v_user_id and cr.command_id = p_command_id;

  if v_existing_hash is not null then
    if v_existing_action <> 'decide_access_request' or v_existing_hash <> v_params_hash then
      raise exception 'Comando já executado com parâmetros diferentes.' using errcode = '23505';
    end if;

    -- Revalida autorização administrativa atual antes da entrega do replay
    if not exists (
      select 1
      from app_private.church_access ca
      join auth.users u on u.id = ca.user_id
      join app_private.churches c on c.id = ca.church_id
      join app_private.members m on m.church_id = ca.church_id and m.id = ca.member_id
      where ca.church_id = p_church_id
        and ca.user_id = v_user_id
        and ca.is_admin = true
        and ca.status = 'active'
        and ca.onboarding_completed_at is not null
        and c.status = 'active'
        and m.status = 'active'
        and u.email_confirmed_at is not null
        and u.deleted_at is null
        and not coalesce(u.is_anonymous, false)
        and (u.banned_until is null or u.banned_until <= clock_timestamp())
    ) then
      raise exception 'Acesso administrativo não autorizado nesta igreja.' using errcode = '42501';
    end if;

    return query
    select
      (v_existing_payload->>'request_id')::uuid,
      (v_existing_payload->>'member_id')::uuid,
      (v_existing_payload->>'final_display_name')::text,
      (v_existing_payload->>'decision')::text,
      coalesce((v_existing_payload->>'access_granted')::boolean, false),
      (v_existing_payload->>'decided_at')::timestamptz,
      (v_existing_payload->>'error_code')::text;
    return;
  end if;

  -- Localização prévia da solicitação para identificar member_id e invitation_id
  select ar.member_id, ar.invitation_id
  into v_target_member_id, v_invitation_id
  from app_private.access_requests ar
  where ar.id = p_request_id and ar.church_id = p_church_id;

  if v_target_member_id is null or v_invitation_id is null then
    raise exception 'Solicitação não encontrada nesta igreja.' using errcode = 'P0002';
  end if;

  -- Bloqueios de domínio na ordem canônica estrita:
  -- 1) Igreja SHARE
  select c.id into v_church_id
  from app_private.churches c
  where c.id = p_church_id and c.status = 'active'
  for share;

  if v_church_id is null then
    raise exception 'Igreja não encontrada ou inativa.' using errcode = 'P0002';
  end if;

  -- 2) Operador SHARE
  select ca.id into v_access_id
  from app_private.church_access ca
  join auth.users u on u.id = ca.user_id
  join app_private.members m on m.church_id = ca.church_id and m.id = ca.member_id
  where ca.church_id = p_church_id
    and ca.user_id = v_user_id
    and ca.is_admin = true
    and ca.status = 'active'
    and ca.onboarding_completed_at is not null
    and m.status = 'active'
    and u.email_confirmed_at is not null
    and u.deleted_at is null
    and not coalesce(u.is_anonymous, false)
    and (u.banned_until is null or u.banned_until <= clock_timestamp())
  for share;

  if v_access_id is null then
    raise exception 'Acesso administrativo não autorizado nesta igreja.' using errcode = '42501';
  end if;

  -- 3) Membro Alvo UPDATE
  select m.id, m.display_name into v_target_member_id, v_current_display_name
  from app_private.members m
  where m.church_id = p_church_id and m.id = v_target_member_id and m.status = 'active'
  for update;

  if v_target_member_id is null then
    raise exception 'Membro inativo ou não encontrado.' using errcode = 'P0002';
  end if;

  -- 4) Convite Original Consumido UPDATE (adquirido e revalidado antes da solicitação)
  select ai.id, ai.recipient_email, ai.redeemed_at, ai.redeemed_by_user_id, ai.revoked_at
  into v_inv_id, v_inv_recipient_email, v_inv_redeemed_at, v_inv_redeemed_by, v_inv_revoked_at
  from app_private.access_invitations ai
  where ai.id = v_invitation_id and ai.church_id = p_church_id and ai.member_id = v_target_member_id
  for update;

  if v_inv_id is null then
    raise exception 'Convite original associado não encontrado.' using errcode = 'P0002';
  end if;

  -- 5) Solicitação UPDATE
  select ar.id, ar.original_display_name, ar.proposed_display_name, ar.requester_user_id,
         ar.expires_at, ar.status
  into v_req_id, v_original_name, v_proposed_name, v_requester_user_id,
       v_req_expires_at, v_req_status
  from app_private.access_requests ar
  where ar.id = p_request_id and ar.church_id = p_church_id
  for update;

  if v_req_status <> 'pending' then
    raise exception 'Solicitação já foi decidida anteriormente.' using errcode = '23505';
  end if;

  v_now := clock_timestamp();

  -- Validação de expiração no instante pós-bloqueio: retorno estruturado com finalização persistida
  if v_now >= v_req_expires_at then
    update app_private.access_requests
    set status = 'expired',
        decided_at = v_now,
        decided_by_user_id = null
    where id = p_request_id;

    insert into app_private.audit_entries (
      church_id, action, actor_user_id, actor_source, maintenance_operator,
      target_type, target_id, details, occurred_at
    ) values (
      p_church_id, 'expire_access_request', v_user_id, 'application', null,
      'access_requests', p_request_id,
      jsonb_build_object('member_id', v_target_member_id, 'reason', 'expired_without_decision'),
      v_now
    );

    v_result_payload := jsonb_build_object(
      'request_id', p_request_id,
      'member_id', v_target_member_id,
      'final_display_name', v_current_display_name,
      'decision', 'expired',
      'access_granted', false,
      'decided_at', v_now,
      'error_code', 'REQUEST_EXPIRED'
    );

    insert into app_private.command_receipts (
      church_id, user_id, command_id, action, params_hash,
      result_member_id, result_entity_id, result_payload, created_at
    ) values (
      p_church_id, v_user_id, p_command_id, 'decide_access_request', v_params_hash,
      v_target_member_id, p_request_id, v_result_payload, v_now
    );

    return query
    select p_request_id, v_target_member_id, v_current_display_name, 'expired'::text, false, v_now, 'REQUEST_EXPIRED'::text;
    return;
  end if;

  -- Ramo APROVAÇÃO
  if p_decision = 'approve' then
    -- Revalida convite original: consumido pelo solicitante e não revogado
    if v_inv_redeemed_at is null or v_inv_redeemed_by <> v_requester_user_id or v_inv_revoked_at is not null then
      raise exception 'Convite original não está em estado consumido válido para aprovação.' using errcode = 'P0002';
    end if;

    -- Comparação obrigatória do nome original: impede sobrescrita silenciosa em modificação concorrente
    if v_current_display_name <> v_original_name then
      raise exception 'Cadastro do membro foi modificado concorrentemente durante a análise da solicitação.' using errcode = 'P0005';
    end if;

    -- Revalida conta do solicitante no instante final pós-locks
    select u.email into v_requester_email
    from auth.users u
    where u.id = v_requester_user_id
      and u.email_confirmed_at is not null
      and u.deleted_at is null
      and not coalesce(u.is_anonymous, false)
      and (u.banned_until is null or u.banned_until <= v_now);

    if v_requester_email is null then
      raise exception 'Conta do solicitante inelegível ou e-mail não confirmado.' using errcode = '42501';
    end if;

    -- Correspondência estrita de e-mail atual do solicitante com recipient_email do convite original
    if pg_catalog.lower(pg_catalog.btrim(v_requester_email)) <> pg_catalog.lower(pg_catalog.btrim(v_inv_recipient_email)) then
      raise exception 'E-mail atual do solicitante não corresponde mais ao convite original.' using errcode = '42501';
    end if;

    -- Revalida ausência de vínculo ativo
    if exists (
      select 1 from app_private.church_access ca
      where ca.church_id = p_church_id and ca.user_id = v_requester_user_id and ca.status = 'active'
    ) then
      raise exception 'Solicitante já possui acesso ativo nesta igreja.' using errcode = '23505';
    end if;

    if exists (
      select 1 from app_private.church_access ca
      where ca.church_id = p_church_id and ca.member_id = v_target_member_id and ca.status = 'active'
    ) then
      raise exception 'Membro já vinculado a outro acesso ativo.' using errcode = '23505';
    end if;

    -- Proibição de bypass de revogação
    if exists (
      select 1 from app_private.church_access ca
      where ca.church_id = p_church_id
        and (ca.user_id = v_requester_user_id or ca.member_id = v_target_member_id)
        and ca.status = 'revoked'
    ) then
      raise exception 'Vínculo anterior revogado detectado. Aprovação não pode reativar acesso revogado.' using errcode = '42501';
    end if;

    -- Atualização do cadastro do membro com o nome proposto aprovado
    update app_private.members
    set display_name = v_proposed_name,
        updated_at = v_now
    where id = v_target_member_id;

    v_new_access_id := gen_random_uuid();

    insert into app_private.church_access (
      id, church_id, user_id, member_id, status, is_admin,
      onboarding_completed_at, granted_by_user_id, granted_at, created_at, updated_at
    ) values (
      v_new_access_id, p_church_id, v_requester_user_id, v_target_member_id, 'active', false,
      v_now, v_user_id, v_now, v_now, v_now
    );

    update app_private.access_requests
    set status = 'approved',
        decided_at = v_now,
        decided_by_user_id = v_user_id
    where id = p_request_id;

    insert into app_private.audit_entries (
      church_id, action, actor_user_id, actor_source, maintenance_operator,
      target_type, target_id, details, occurred_at
    ) values (
      p_church_id, 'approve_access_request', v_user_id, 'application', null,
      'access_requests', p_request_id,
      jsonb_build_object('member_id', v_target_member_id, 'access_id', v_new_access_id),
      v_now
    );

    v_result_payload := jsonb_build_object(
      'request_id', p_request_id,
      'member_id', v_target_member_id,
      'final_display_name', v_proposed_name,
      'decision', 'approved',
      'access_granted', true,
      'decided_at', v_now,
      'error_code', null
    );

    insert into app_private.command_receipts (
      church_id, user_id, command_id, action, params_hash,
      result_member_id, result_entity_id, result_payload, created_at
    ) values (
      p_church_id, v_user_id, p_command_id, 'decide_access_request', v_params_hash,
      v_target_member_id, p_request_id, v_result_payload, v_now
    );

    return query
    select p_request_id, v_target_member_id, v_proposed_name, 'approved'::text, true, v_now, null::text;
    return;
  end if;

  -- Ramo REJEIÇÃO
  -- A rejeição encerra definitivamente a tentativa sem alterar membro e sem conceder acesso
  update app_private.access_requests
  set status = 'rejected',
      decided_at = v_now,
      decided_by_user_id = v_user_id
  where id = p_request_id;

  insert into app_private.audit_entries (
    church_id, action, actor_user_id, actor_source, maintenance_operator,
    target_type, target_id, details, occurred_at
  ) values (
    p_church_id, 'reject_access_request', v_user_id, 'application', null,
    'access_requests', p_request_id,
    jsonb_build_object('member_id', v_target_member_id),
    v_now
  );

  v_result_payload := jsonb_build_object(
    'request_id', p_request_id,
    'member_id', v_target_member_id,
    'final_display_name', v_current_display_name,
    'decision', 'rejected',
    'access_granted', false,
    'decided_at', v_now,
    'error_code', null
  );

  insert into app_private.command_receipts (
    church_id, user_id, command_id, action, params_hash,
    result_member_id, result_entity_id, result_payload, created_at
  ) values (
    p_church_id, v_user_id, p_command_id, 'decide_access_request', v_params_hash,
    v_target_member_id, p_request_id, v_result_payload, v_now
  );

  return query
  select p_request_id, v_target_member_id, v_current_display_name, 'rejected'::text, false, v_now, null::text;
end;
$function$;

-- 10. Endpoint: get_invitation_command_receipt (Consulta Idempotente de Recibo)
create function public.get_invitation_command_receipt(
  p_command_id uuid
)
returns table (
  command_id uuid,
  action text,
  church_id uuid,
  result_member_id uuid,
  result_entity_id uuid,
  result_payload jsonb,
  created_at timestamptz,
  link_unrecoverable boolean
)
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '5s'
as $function$
declare
  v_user_id uuid;
  v_cmd_id uuid;
  v_action text;
  v_church_id uuid;
  v_member_id uuid;
  v_entity_id uuid;
  v_payload jsonb;
  v_created_at timestamptz;
begin
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;

  if p_command_id is null then
    raise exception 'Identificador de comando obrigatório.' using errcode = '22004';
  end if;

  -- Revalidação estrita da elegibilidade da conta chamadora em TODOS os caminhos
  if not exists (
    select 1 from auth.users u
    where u.id = v_user_id
      and u.email_confirmed_at is not null
      and u.deleted_at is null
      and not coalesce(u.is_anonymous, false)
      and (u.banned_until is null or u.banned_until <= clock_timestamp())
  ) then
    raise exception 'Conta inelegível ou e-mail não confirmado.' using errcode = '42501';
  end if;

  select cr.command_id, cr.action, cr.church_id, cr.result_member_id,
         cr.result_entity_id, cr.result_payload, cr.created_at
  into v_cmd_id, v_action, v_church_id, v_member_id, v_entity_id, v_payload, v_created_at
  from app_private.command_receipts cr
  where cr.user_id = v_user_id and cr.command_id = p_command_id;

  if v_cmd_id is null then
    raise exception 'Recibo de comando não encontrado.' using errcode = 'P0002';
  end if;

  -- Nega ações não reconhecidas pelo subsistema de convites
  if v_action not in ('issue_invitation', 'decide_access_request', 'redeem_confirm_name', 'redeem_propose_name') then
    raise exception 'Ação de comando não reconhecida para convites.' using errcode = '42501';
  end if;

  -- Matriz de autorização da consulta de recibo:
  -- Comandos administrativos exigem autorização administrativa atual
  if v_action in ('issue_invitation', 'decide_access_request') then
    if not exists (
      select 1
      from app_private.church_access ca
      join auth.users u on u.id = ca.user_id
      join app_private.churches c on c.id = ca.church_id
      join app_private.members m on m.church_id = ca.church_id and m.id = ca.member_id
      where ca.church_id = v_church_id
        and ca.user_id = v_user_id
        and ca.is_admin = true
        and ca.status = 'active'
        and ca.onboarding_completed_at is not null
        and c.status = 'active'
        and m.status = 'active'
        and u.email_confirmed_at is not null
        and u.deleted_at is null
        and not coalesce(u.is_anonymous, false)
        and (u.banned_until is null or u.banned_until <= clock_timestamp())
    ) then
      raise exception 'Acesso não autorizado ao recibo administrativo.' using errcode = '42501';
    end if;
  end if;
  -- Para ações de destinatário (redeem_confirm_name, redeem_propose_name),
  -- a elegibilidade da conta chamadora autora já foi validada acima;
  -- o convidado pode consultar seu próprio recibo sem necessitar de church_access.

  return query
  select
    v_cmd_id,
    v_action,
    v_church_id,
    v_member_id,
    v_entity_id,
    v_payload,
    v_created_at,
    (v_action = 'issue_invitation') as link_unrecoverable;
end;
$function$;

-- 11. Concessão e revogação de privilégios estritos sobre as novas RPCs
revoke all on function public.issue_church_invitation(uuid, uuid, uuid, text) from public, anon, service_role;
grant execute on function public.issue_church_invitation(uuid, uuid, uuid, text) to authenticated;

revoke all on function public.get_invitation_details(text) from public, anon, service_role;
grant execute on function public.get_invitation_details(text) to authenticated;

revoke all on function public.redeem_invitation_confirm_name(uuid, text, text) from public, anon, service_role;
grant execute on function public.redeem_invitation_confirm_name(uuid, text, text) to authenticated;

revoke all on function public.redeem_invitation_propose_name(uuid, text, text) from public, anon, service_role;
grant execute on function public.redeem_invitation_propose_name(uuid, text, text) to authenticated;

revoke all on function public.get_my_access_request(uuid) from public, anon, service_role;
grant execute on function public.get_my_access_request(uuid) to authenticated;

revoke all on function public.list_church_invitations(uuid, text, integer, integer) from public, anon, service_role;
grant execute on function public.list_church_invitations(uuid, text, integer, integer) to authenticated;

revoke all on function public.list_church_access_requests(uuid, text, integer, integer) from public, anon, service_role;
grant execute on function public.list_church_access_requests(uuid, text, integer, integer) to authenticated;

revoke all on function public.decide_access_request(uuid, uuid, uuid, text) from public, anon, service_role;
grant execute on function public.decide_access_request(uuid, uuid, uuid, text) to authenticated;

revoke all on function public.get_invitation_command_receipt(uuid) from public, anon, service_role;
grant execute on function public.get_invitation_command_receipt(uuid) to authenticated;

-- Preserva bloqueio estrito em command_receipts
alter table app_private.command_receipts enable row level security;
revoke all on table app_private.command_receipts from public, anon, authenticated, service_role;

commit;
